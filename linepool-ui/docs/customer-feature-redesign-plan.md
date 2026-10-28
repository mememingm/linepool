# 代理“客户”功能改造方案

- 日期：2026-10-27
- 状态：方案待确认，尚未实施
- 关联文档：`docs/agent-workbench-ux-review.md`、`docs/agent-center-handoff.md`、`docs/subagent-management-plan.md`

## 一、目标

“客户”功能要解决的只有一件事：**代理能把手里的号码交给一个真实用户，这个用户登录 LinePool 后能看到这个号码并收到短信。**

改造后，代理侧的操作应当只有一步：

> 库存 → 选号码 → “分配给用户” → 输入对方注册邮箱、选使用时长 → 确认

完成后，对方在自己的普通工作台“我的号码”里看到这个号码，短信会进入对方的收件箱。代理不需要知道 UUID，也不需要先去单独“绑定客户”。

## 二、现状与问题

| 环节 | 现状 | 问题 |
|------|------|------|
| 绑定客户 | 客户管理 → 绑定客户，需要填写对方的用户 UUID | 普通工作台不展示用户 ID，代理和用户都拿不到这个值，流程实际走不通 |
| 分配号码 | 库存 → 分配给客户；写入 `number_holdings(owner_type='CUSTOMER')` 和 `service_entitlements` | 只在代理库存体系内记账 |
| 客户看号 | 普通工作台读取 `number_allocations JOIN phone_numbers`（`backend/src/workspace.ts`） | 读不到代理库存里的号码，**客户看不到分给自己的号** |
| 收短信 | Webhook 只按 `phone_numbers → number_allocations` 匹配用户（`backend/src/providers/webhook-inbox.ts`） | 代理库存号码收到的短信一律匹配为 `UNMATCHED`，**客户收不到短信** |
| 客户管理页 | 名称、ID、状态、编辑 | 看不到每个客户手里有哪些号码，代理无法追踪分出去的号 |
| 收费 | 分配金额固定为 0，价格规则不参与 | 暂不处理（见第七节） |

根因：代理号码池（`agent_number_stock` / `number_holdings`）和平台直销号码池（`phone_numbers` / `number_allocations`）是两套独立的数据。普通工作台和短信路由只认后者。

## 三、改造内容

按优先级分三个阶段。**P0 不完成，后面两个阶段都没有意义。**

### P0：客户能看到号码并收到短信（打通链路）

**推荐方案：让工作台和短信路由同时识别代理库存里的客户号码（方案 B）。**

1. **短信路由**（`backend/src/providers/webhook-inbox.ts`）
   - 现有的 `phone_numbers → number_allocations` 匹配保持不变。只有匹配不到时，才追加第二条匹配路径：
     `agent_number_stock(external_project_id, external_number_id, phone_number)` → `number_holdings`（`owner_type='CUSTOMER'`，`status='ACTIVE'`）→ `service_entitlements`（平台一致，且短信接收时间落在 `starts_at ~ expires_at` 内）→ `customers.user_id`。
   - 两条路径合计必须**恰好匹配一条**才算成功，否则仍然记为 `UNMATCHED`，与现有“唯一归属”原则一致。
   - `sms_messages` 需要能记录来源。新增可空列 `entitlement_id`，与 `allocation_id` 二选一，用一个 CHECK 约束保证两者恰好有一个。
2. **普通工作台“我的号码”**（`backend/src/workspace.ts`）
   - 号码列表、号码详情、首页统计都要合并当前用户作为客户持有的号码。用 `UNION ALL` 合并两个来源，并统一映射到现有的 `numberSchema`。
   - 来源字段标为 `AGENT`。前端在号码卡片上显示“由 XX 代理提供”，并隐藏“续期 / 购买”入口，改为提示“续期请联系你的代理”。
3. **短信列表与收件箱**：通过 `entitlement_id` 关联到号码，展示方式与直销号码一致。
4. **到期处理**：`agent-inventory-expiry.ts` 已经负责持有到期。需要确认它也会把客户的 entitlement 置为 `EXPIRED`；过期后，短信路由不再命中。

**备选方案 A（不推荐）**：分配时同时往 `phone_numbers` / `number_allocations` 写一份镜像数据，工作台和路由完全不用改。
- 好处是改动最少。
- 但同一个号码会出现在两个号码池里，需要保证两边状态同步，并且 `phone_numbers` 上还有上架、下架和直销订单这些语义，一旦错位就可能被平台再次卖出。风险较高。

**数据库迁移**：新增 `027_customer_service_routing.sql`
- `sms_messages.entitlement_id`、`provider_message_receipts.entitlement_id`
- 来源互斥约束
- 索引 `service_entitlements(service, status, starts_at, expires_at)`，以及 `agent_number_stock(external_project_id, external_number_id)` 上的路由查询索引

### P1：一步完成“分配给用户”（去掉 UUID）

1. **新增按邮箱查找用户的接口**：`POST /agent-inventory/customers/lookup`，请求体 `{ email }`
   - 只返回能否绑定的结果，不暴露其他信息：
     - `{ eligible: true, maskedName: "a***@gmail.com", existingCustomerId?: uuid }`
     - 或 `{ eligible: false, reason: 'NOT_FOUND' | 'NOT_ELIGIBLE' | 'OWNED_BY_OTHER_AGENT' }`
   - 防止被用来探测账号是否存在：接入现有的 `business-throttler` 限流，每个代理每分钟最多 10 次。`OWNED_BY_OTHER_AGENT` 和 `NOT_ELIGIBLE` 对外统一显示为“该账号暂时不能绑定”。
2. **分配接口支持按邮箱分配**：`POST /holdings/assign-customer` 新增 `{ email, customerName? }`，与 `customerId` 二选一。
   - 对方已经是自己的客户：直接分配。
   - 对方还不是任何代理的客户：在同一个事务里自动创建 `customers` 记录（`agent_id` 为当前代理），然后分配。
   - 对方已经属于别的代理：返回 409，提示“该账号已由其他代理服务”。
3. **前端分配弹窗**（`src/linepool/agent/pages/InventoryPage.tsx`）
   - 字段改为“用户”：输入邮箱，下拉中同时列出已有客户以便快速选择。确认前展示脱敏后的邮箱，用来核对。
   - 保留已经上线的“使用时长”选择。
   - 结算方案实施后，增加可选的“售价（记账）”字段（见结算方案 7.3）。
4. **“绑定客户”入口**：客户页中的绑定也改为输入邮箱。UUID 输入框整体移除。

### P2：客户页改为“我的用户”

1. 页面标题改为“我的用户”，侧栏同步修改；底层仍然是 `customers` 表，不改名。
2. 列表列：用户（脱敏邮箱 + 备注名）、在用号码数、最近到期时间、状态、操作。
3. 详情抽屉：列出该用户当前和历史持有的号码，包括号码、平台、有效期、来源订单。后端已有 `GET /agent-inventory/customers/:customerId/holdings` 可以直接使用。
4. 操作：
   - 修改备注名
   - 暂停 / 恢复
   - **收回号码**：提前结束某个号码的 entitlement，号码回到代理库存，需要填写原因并记录审计。新增接口 `POST /holdings/:holdingId/revoke-customer`。
5. 文案统一为“用户”，并加一句说明：“用户是你名下使用号码的人，用他自己的 LinePool 账号登录收短信。”

## 四、不做 / 暂缓

- **收费与结算**：已另立方案，见 `docs/agent-distribution-settlement-plan.md`。分销采用“批发进货、先付后拿”：代理之间的转交按价扣款；代理分配给客户**不扣款**，只在弹窗中填写可选的“售价（记账）”，客户的钱由代理在系统外收取。
- **价格规则表单简化**：并入上述结算方案的第七节 7.1。
- **由代理创建用户账号**：仍然要求对方先自行注册，避免代理代持他人账号和密码。

## 五、二级代理

二级代理与一级代理使用同一套能力：可以把号码分给自己的用户。区别是不能转交下级，这一点现有逻辑已经限制。所有查询仍按 `customers.agent_id = 当前代理` 隔离。

## 六、验收标准

1. 一级代理 A 用邮箱把号码分给普通用户 U（U 之前不是任何代理的客户），一步完成，全程不需要输入 UUID。
2. U 登录普通工作台，“我的号码”里出现该号码，标注“由 A 提供”，不显示续期 / 购买按钮。
3. 用 Mock Webhook 向该号码推送一条短信，并且接收时间在有效期内：U 的收件箱收到这条短信，管理后台的接收记录显示为“已分发”。
4. 接收时间在有效期之外的短信，或者分配被收回之后的短信，都记为 `UNMATCHED`。
5. 代理 B 尝试用 U 的邮箱分配号码时，被拒绝，提示“该账号暂时不能绑定”。
6. A 在“我的用户”里能看到 U 的号码和到期时间，并能收回号码；收回后号码回到 A 的库存，U 不再收到该号码的短信。
7. 平台直销号码的购买、续期、短信路由行为没有任何变化（回归核对）。
8. 按项目约定不运行测试套件；用 typecheck、构建，再加上本地 Mock 数据和浏览器走查来核验。

## 七、工作量与顺序（估算）

| 阶段 | 主要改动 | 预估 |
|------|----------|------|
| P0 | 迁移 027、Webhook 第二匹配路径、workspace 合并查询、前端号码卡片来源标识 | 2–3 天 |
| P1 | 邮箱查找接口与限流、assign 按邮箱分配、分配弹窗和绑定弹窗改造 | 1–1.5 天 |
| P2 | “我的用户”列表与详情、收回接口与审计、文案 | 1–1.5 天 |

建议按 P0 → P1 → P2 的顺序实施，每个阶段单独提交，便于回滚。

## 八、需要确认的业务问题

1. **一个用户只能属于一个代理吗？** 现有 `customers.user_id` 是唯一约束，即“是”。如果允许一个用户同时从多个代理拿号，需要改表结构，工作量会明显增加。
2. **用户已经从平台直接买过号，还能再成为代理的客户吗？** 本方案默认可以，两种来源的号码在工作台里并列显示。
3. **绑定前需要对方同意吗？** 本方案默认不需要，代理凭邮箱即可绑定，用户在号码卡片上能看到来源代理。如果需要对方确认，P1 要增加邀请和确认流程，大约多 1 天。
4. **收回号码时要通知用户吗？** 目前没有站内通知能力，本方案只在号码卡片上显示“已结束”。
