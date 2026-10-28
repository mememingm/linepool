# LinePool 项目功能与修改进度总览

- 日期：2026-10-28
- 依据：`docs/full-walkthrough-2026-10-28.md`、`docs/p0-fix-plan.md`、`docs/customer-feature-redesign-plan.md`、`docs/agent-distribution-settlement-plan.md`
- 说明：本文件区分“已设计”“源码已有改动”“已通过本地验收”“仍待运行验收”，不能把 typecheck、git diff 或方案状态当成线上完成。

## 一、产品功能现状

### 普通用户

- 已有注册、登录、工作台、购买号码、我的号码、订单、积分明细、短信收件箱、账户设置、地区服务等入口。
- 当前产品决策为**只售美国号码**；其他国家暂不开放，但库存/商品/后台仍存在多国数据，需前后端和后台展示一致。
- 购买依赖积分；支付未接入，新用户没有正常获得积分的途径。F2（积分调整/充值替代方案）已暂缓，不应误报为已完成。
- 直销号码的短信路由可用；代理分配号码的客户短信路由尚未打通。

### 代理与客户

- 已有一级/二级代理、余额、价格、库存、号码转交、客户绑定、客户持有记录、暂停/恢复等能力。
- 客户链路仍不完整：代理分配的号码不能稳定合并到普通用户“我的号码”，代理库存号码短信默认 `UNMATCHED`。
- 客户绑定仍涉及 UUID，按客户改造方案 P1 应改为邮箱流程；“我的用户”、收回号码等 P2 尚未完整落地。

### 管理员

- 已有用户、订单、号码、商品、代理库存、价格、收信记录、Webhook、审计等后台能力。
- 订单状态筛选混入“今天/异常/待核对”等其他维度；F4 方案要求拆分为真实状态 + 独立快捷筛选。
- 管理员可手动分配非美国号码，必须与“只售美国”规则区分：非美国可作为后台补发/测试，但不能误显示为前台可售。

## 二、方案与代码进度

### F1：只售美国号码 — 实施中，尚未完成运行验收

- 产品决定：当前锁定只卖美国；F1 要求前台、后台、接口一致。
- SageXenon 已完成首批前台目录/详情/购买页及文案修改，reservation 已释放；待独立 build/typecheck/隔离前台验收。
- 还必须确认：后端下单/续费拒绝非美国、后台商品显示“前台未开放”、手动分配提示、库存统计口径。
- 不能仅凭前端改动宣称 F1 完成。

### F2：积分获取 — 暂缓

- 支付未接入；管理员调整积分方案尚未实施。
- 方案明确暂缓，不能列为当前待开发缺陷之外的“已完成”。

### F3：中文错误提示 — 源码有改动，需验收

- 涉及 `linepool-ui/src/linepool/workspace-reference/workspace-data.ts`、代理/管理端错误映射和 i18n。
- 原问题是未知错误码直接展示英文原文，例如 `Account is disabled`。
- 需实际触发禁用账号、未知 4xx/5xx 错误并验证中文/英文文案；typecheck 不足以证明完成。

### F4：管理员订单筛选 — 源码有改动，需验收

- 涉及 `linepool-ui/backend/src/administration.ts`、`linepool-ui/packages/contracts/src/admin.ts`、`linepool-ui/src/linepool/admin/AdminShell.tsx`。
- 目标：状态只保留处理中/已完成/失败/已取消；今天/需要处理改用独立 `view` 参数，并兼容旧链接。
- 需实际检查 URL、筛选组合、数量和概览跳转。

### F5：一级代理给下级转余额 — 已有实现/本地 Mock 验收记录，仍需当前基线运行验收

- 涉及 `linepool-ui/src/linepool/agent/SubagentDetail.tsx`、`FinancePage.tsx`、`BalanceTransfer.tsx`、后端 agent inventory/settlement 代码及 contracts。
- 方案记录 S1–S6 已在独立本地环境完成 Mock 验收：余额扣款、流水、价格快照、幂等、报价和报表均有回执。
- 当前第四轮仍发现：暂停代理后转号码返回 `409 AGENT_NOT_ACTIVE`，但余额转账仍返回 `201 COMPLETED`（Q1），必须修复并回归。
- 不能把旧的本地 Mock 回执等同于当前共享环境已验收。

### F6：下级详情转交弹窗 — 已有实现，需界面/接口核对

- 目标是与库存页转交弹窗一致：时长、金额、余额校验、中文关闭按钮、统一“转交”文案。
- 涉及 `linepool-ui/src/linepool/agent/SubagentActions.tsx` 等。
- 方案称已接入 `useSettlementQuote`，但第四轮尚未完成当前环境真实流程验收。

### F7：客户号码与短信链路 — 单独阶段，当前冻结/未完成

- 目标：客户在普通工作台看到代理分配号码，并收到代理库存号码短信。
- 方案涉及新迁移 `027_customer_service_routing.sql`、`backend/src/providers/webhook-inbox.ts`、`backend/src/workspace.ts`、前端号码/收件箱来源展示。
- OakCastle 误启动的 F7 增量已撤回；027 SQL 未应用并已移至 `backend/.local/p0-stale-f7-20261028/`。
- F7 不得与当前第四轮测试、F1 前台修复、统一库存 030 混做，除非单独批准。

### S1–S6：代理分销与结算 — 方案声称已本地实施，当前仍需基线和运行核验

- 相关迁移：`linepool-ui/backend/db/migrations/028_agent_settlement.sql`、`029_archive_ambiguous_legacy_prices.sql`。
- 相关代码：`linepool-ui/backend/src/agent-settlement.ts`、agent inventory/holding batch/ordering、`linepool-ui/src/linepool/agent/Settlement*.tsx`、`BalanceTransfer.tsx`、`HoldingDistributionForm.tsx`。
- 方案记录已完成平台批发价、下级结算价、客户记账售价、余额扣款、流水、价格快照、成本、报表和幂等 Mock 验收。
- 当前共享数据库失联，且存在未批准的 `030_unified_number_inventory.sql` / `unified-agent-stock.ts`；必须先确认基线、迁移版本和批准边界，不能直接继续迁移或依赖新字段。

## 三、第四轮测试结果

### 已完成

- T4 权限/越权接口测试。
- T3 暂停、恢复、终止权限边界测试；T3 状态已恢复 `ACTIVE`，终止未执行。
- T1 Webhook 签名、去重、直销短信匹配、代理/客户短信 `UNMATCHED`、临时夹具恢复。
- JadeJaguar 已将详细回执写入 `full-walkthrough-2026-10-28.md` 第七节。

### 已确认问题

- Q1：暂停代理仍可转余额。
- Q2：迁移前 schema 与运行代码/`dist` 不一致导致 500；不能通过改 `dist` 规避。
- Q3：暂停客户时普通工作台曾出现 500，需在一致版本环境复测。
- Q4：普通客户 holdings 返回自身号码 200，与测试计划预期 403 不一致，需产品确认。
- Q5：恢复代理后旧 session 仍 401，需重新登录或改提示/流程。
- Q6：创建三级返回 `409 MAX_AGENT_LEVEL`，与计划预期 403 不一致，需统一错误码语义。

### 尚未完成

- T5 日常操作：环境失联前未执行。
- T2 到期/提醒：环境失联前未执行，且包含不可逆到期变更。
- T1-09 浏览器交互仅部分完成。

## 四、当前环境与验证边界

- 最后确认：`127.0.0.1:5433` TCP 失败；`127.0.0.1:3010/api/health` 返回 503；`127.0.0.1:5178` 曾返回 502。
- 曾出现固定版 PID 20316 与其他后端进程来源不清的问题，恢复前必须登记 PID、工作目录、启动命令、版本和迁移版本。
- 未经环境负责人批准，不得启动/停止服务、执行迁移或写共享数据库。
- `npm run typecheck`、`npm run api:typecheck`、build、git diff 只能作为静态证据，不能替代接口和数据库运行验收。

## 五、当前工作树与交付状态

- 工作树存在大量未提交源码和新增文件，不能把“有 diff”直接解释为完成，也不能把“diff 为 0”解释为相对已提交基线干净。
- 新增/未提交的重要文件包括：`linepool-ui/backend/db/migrations/028_agent_settlement.sql`、`029_archive_ambiguous_legacy_prices.sql`、`030_unified_number_inventory.sql`、`linepool-ui/backend/src/agent-settlement.ts`、`linepool-ui/backend/src/unified-agent-stock.ts` 及多组 agent/admin/settlement 前端文件。
- 需要下一位负责人先建立已提交基线与变更归属清单，再分别验收 F1、F3、F4、F5、F6；F7 和 030 迁移保持冻结。

## 六、下一步优先级

1. 指定唯一环境负责人，完成 5433/3010/5178 版本和迁移基线登记。
2. 对比已提交基线，确认 030/unified-agent-stock 是否批准；未批准则不迁移、不运行依赖新字段的代码。
3. Sage 完成 F1 隔离 build/typecheck 与前台验收。
4. IronJaguar 完成 F5/F6/030 静态链路核验。
5. 在独立、版本一致的测试环境修复并回归 Q1/Q2/Q3/Q4/Q5/Q6。
6. 环境稳定后 Jade 从 T5 开始，T2 最后。
7. 所有结果分别写入：测试结论放 `full-walkthrough-2026-10-28.md`，协调/环境放 `round4-coordination.md`，本总览只维护状态汇总。
