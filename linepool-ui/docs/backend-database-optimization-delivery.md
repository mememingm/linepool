# LINEPOOL 后端与数据库优化交付

> 后续本地修复记录（2026-10-19）：用户授权解决页面连接失败后，已备份 `127.0.0.1:5433/linepool_react`，并通过原迁移执行器应用 007–010（未应用独立沙盒 011）。9/9 条短信已实际关联 allocation，无未解决记录。重启后端后到期占用从 2 降为 0，当前 allocation 缺失或不一致均为 0。API 健康、网页代理健康及网页入口均返回 HTTP 200；没有运行测试或浏览器登录验收。备份位于 `backend/.local/backups/repair-2026-10-19T08-15-57-823Z/linepool_react.dump`，同目录保存迁移版本、回填结果与冻结迁移副本。下文“未迁移”等描述为最初交付时的历史状态。

范围：`D:/llinepool/linepool-ui`。依据 `D:/PingCode-repo/docs/once-linepool-backend-database-optimization-report.md`，保留 NestJS + TypeScript + pg + PostgreSQL。本文记录本次实现及验证边界，不表示已迁移或部署。

## 现场结论与报告差异

- L01 / F06、L02 / F09 在修改前仍存在：用户订单状态硬编码 COMPLETED，短信统计按号码与用户聚合。本次修复。
- F05、F07、F08、F10、F12 属于已有基础：复用履约状态、allocation 历史、三个 provider 表、Mock 接收校验及后台回收，不重新建立另一套机制。
- 报告静态阅读到 008 的 provider 表，但当前本地数据库实际仅应用 001–006；008 尚未执行。因此当前库不存在 provider receipts，不能声称已在数据库中启用这些保护。
- 当前同步 Mock 仍在本地事务完成；可选异步 Mock 仅供本地 CLI。没有真实供应商写接口、支付、队列或新增续费能力。
- 到期后停止本地使用并解除当前占用，保持 `sale_enabled=false`。这不代表上游释放成功或允许自动复售。

## 实际实现与编号

| 报告编号 | 实现 |
| --- | --- |
| L01、C03 | 用户订单 API 读取 fulfillment_status；共享 PROCESSING / COMPLETED / FAILED / CANCELLED 契约；返回可空完成时间；用户列表、订单详情、仪表盘最近订单与后台使用真实状态。只有本地分配完成才写 completed_at。未完成订单的号码不计入有效号码及用量入口。 |
| L02、C04、C05 | sms_messages 增加 nullable allocation_id；可信回执优先，否则按原用户、号码、历史半开区间唯一匹配。当前号码、历史订单与相应未读数按 allocation 统计；收件箱支持 allocationId；历史订单链接携带 allocation。 |
| L04、C01 | 触发器继续独占维护 allocation 历史；按原租期/实际释放时间结束历史；增加释放原因。后台回收同时校验 expectedUserId 与 expectedAllocationId，防止同用户再次取得同号码后被旧请求回收；已完成的相同回收可返回 changed=false。 |
| L04、C01 | 新增到期扫描：启动及每 30 秒扫描，每批默认 100、最多 500，资源行锁 + SKIP LOCKED；事务内记录唯一到期事件并解除本地归属，保持停售。进程重启继续扫描数据库积压；重复扫描不会再次释放已结束占用。 |
| L03、C01、C02 | 保留默认同步 Mock；可选本地 deferred-mock 将库存预占、订单与扣分一并提交，待本地模拟器领取、确认。领取令牌、60 秒有效期、稳定 request_id、尝试次数与转换事件持久化；失联转 UNCERTAIN，不自动重新购买或冲正。 |
| L03、C03 | 模拟成功后才建立 allocation 并开始租期；明确失败时解除预占但保持停售，以 ADJUSTMENT 冲正原 ORDER_DEBIT，记录 reverses_ledger_id，唯一约束防重复。订单、余额、流水、库存与操作终态同事务提交。 |
| L05 | 增加精确 IP 列表 TRUSTED_PROXY_IPS，默认不信任代理；登录/注册按客户端 IP 限流，已认证业务按账号限流。沿用单进程 Throttler 存储。只核对现有 Nginx 示例，没有变更或部署代理。 |

账号锁、库存行锁与 SKIP LOCKED、订单幂等与请求差异检查、商品快照、积分流水唯一约束均保留。Mock 接收仍保留资源绑定、消息/事件去重、指纹、归属、服务和有效期检查；未开放迟到短信接收。所有历史短信仍以原 user_id 授权，回收不会删除或转移短信。

## 文件清单

追加迁移：

- `backend/db/migrations/009_sms_allocation_ownership.sql`
- `backend/db/migrations/010_allocation_lifecycle_mock_fulfillment.sql`

后端实现：

- `backend/src/workspace.ts`：状态映射、allocation 统计、历史订单和收件箱读取。
- `backend/src/ordering.ts`：PROCESSING 创建、完成时间、可选本地延迟交付。
- `backend/src/providers/receiving-sync.ts`：短信直接保存 allocation；接收与生命周期使用资源在先、allocation 在后的锁顺序。
- `backend/src/administration.ts`：带 allocation 身份的回收与预占保护。
- `backend/src/number-services.ts`：失去归属、到期或尚未交付的号码不可继续调用用量入口，续费仍禁用。
- 新增 `backend/src/allocation-expiry.ts`、`backend/src/mock-fulfillment.ts`、`backend/src/business-throttler.ts`。
- `backend/src/main.ts`、`backend/src/environment.ts`、`backend/.env.example`：扫描注册、代理配置与限流。
- `backend/db/demo-seed.ts`：仅补足演示订单显式完成时间，兼容新增约束；没有执行 seed。
- 新增 `backend/scripts/allocation-audit.ts`、`backend/scripts/mock-fulfillment.ts`；`backend/package.json` 增加对应命令。

契约与最小消费方兼容：

- `packages/contracts/src/index.ts`、`packages/contracts/src/admin.ts`。
- `src/linepool/components.tsx`、`src/linepool/admin/AdminShell.tsx`。
- `src/linepool/workspace-reference/navigation.ts`、`WorkspacePages.tsx`、`WorkspaceDetails.tsx`、`PurchasePage.tsx`。

前端只调整业务目录内的状态表达、allocation 链接和回收参数；没有修改上游 UI 基线。根仓库原有未提交/删除文件未处理；linepool-ui 当前整体为未跟踪目录，不能用普通 git diff 当作本次改动的完整清单。

## 数据结构、约束与索引

009：

- `sms_messages.allocation_id` 可空，保留无法确认归属的历史短信。
- `number_allocations` 增加 `(id,number_id,user_id)` 唯一键；短信以三列复合外键保证 allocation、号码、用户一致。
- `sms_allocation_resolution` 视图输出 RECEIPT / RECEIPT_CONFLICT / INTERVAL / AMBIGUOUS / UNMATCHED；回执冲突不会退回当前持有人或时间猜测。
- `sms_allocation_backfill_summary` 保存迁移时各类条数；视图可查询未解决明细。
- 短信保护触发器禁止改动原用户、号码、接收时间及已确认 allocation。新写入未提供 allocation 时也仅在历史区间唯一匹配后关联。回执触发器校验并补齐对应短信归属。
- 新索引：`sms_allocation_received(allocation_id,received_at DESC,id DESC)`、`sms_allocation_unread(allocation_id) WHERE NOT is_read`、`allocations_interval_lookup(number_id,user_id,assigned_at,expires_at)`。

010：

- `number_allocations.release_reason`：MANUAL / EXPIRED / REASSIGNED；由 phone_numbers 触发器维护，业务服务不插入 allocation。
- `phone_numbers.reserved_order_id` 外键指向订单；预占必须没有当前用户且关闭销售。
- `phone_numbers_expiry(expires_at,id) WHERE assigned_user_id IS NOT NULL`；`phone_numbers_reservation(reserved_order_id) WHERE reserved_order_id IS NOT NULL`。
- `number_lifecycle_events`：每个 allocation 最多一条自动到期事件，不冒用后台管理员身份写系统事件。
- `order_completion_time` CHECK 以 NOT VALID 形式新增：新写入必须满足“COMPLETED 当且仅当存在 completed_at”。旧的未完成订单清空无效完成时间；旧 COMPLETED 缺时间时保留异常，不伪造时间。后续核实历史后再显式 VALIDATE。
- `mock_fulfillment_operations`：订单主键、唯一 request_id、Mock 来源限制、状态、领取令牌/截止、尝试次数、证据；`mock_fulfillment_events` 保存转换记录。
- `point_ledger.reverses_ledger_id` 唯一外键；触发器校验 ADJUSTMENT、原 ORDER_DEBIT、同用户/订单和反向等额积分。没有新增现金余额或支付方式。

## 只读历史归属审计

执行：2026-10-19T04:04:12.767Z，本地 `.env` 所指数据库；只读 REPEATABLE READ 事务，无写入。

| 项目 | 数量 |
| --- | ---: |
| 短信总数 | 9 |
| 可信回执可关联 RECEIPT | 0（008 未应用，无回执表） |
| 历史区间唯一匹配 INTERVAL | 9 |
| 回执冲突 RECEIPT_CONFLICT | 0 |
| 歧义 AMBIGUOUS | 0 |
| 未匹配 UNMATCHED | 0 |
| 到期但尚占用的号码 | 2 |
| COMPLETED 缺 completed_at | 0 |
| 当前 allocation 与号码不一致 | 0 |
| 当前有用户但缺 allocation | 0 |

**实际回填条数：尚未执行迁移，未写入。以上是当前数据的回填前预估，不能当成已回填结果。** 执行迁移前必须重新运行审计，最终以迁移生成的 summary 和未解决清单为准。审计工具兼容尚未应用 008 的库，将其解释为没有回执证据；不创建空表或伪造回执。

只读命令（backend 目录）：

```powershell
npm run db:allocation-audit -- --details
```

009 应用后，可读 `sms_allocation_backfill_summary`，并查询 `sms_allocation_resolution WHERE allocation_id IS NULL` 获取 message_id、resolution、interval_matches。歧义与未匹配仍属于原 user_id 的历史，不进入任何具体 allocation 的统计；用户可在全部历史收件箱查看自己的消息。

## 迁移兼容顺序与失败恢复

以下为运维步骤，**本次没有执行**：

1. 备份目标库与当前应用产物，确认目标 DATABASE_URL。停止 API 写入、接收与扫描，重新执行只读审计。缺失/不一致的 allocation 或无法确认的完成时间须先核实，不造历史数据。
2. 构建 contracts、backend 及网页产物。当前本地库需依次补上已有 007、008，再应用新增 009、010。保留 001–008 原文件及校验和，不用 seed 升级旧库。
3. 获得实际数据库迁移授权后，使用现有 `backend` 的 `npm run db:migrate`。执行器按文件名排序，使用 advisory lock，并将全部待应用迁移及版本记录放在同一事务；任一失败全部回滚。
4. 核对版本、回填 summary、未解决记录和订单完成时间；部署匹配版本的 API、契约消费方及前端后再恢复写入。新代码依赖 009/010，不能先启动新 API 再补迁移；旧代码的订单创建不满足新增完成时间约束，也不能在迁移后长期运行。
5. 历史完成时间异常全部有可信修复后，另行授权执行 `ALTER TABLE orders VALIDATE CONSTRAINT order_completion_time`。本次未验证此约束。

009 的历史关联、普通索引及外键和 010 的表变更均在事务内执行，可能持锁并扫描历史表；本地只有 9 条短信，不能由此推断正式库耗时。正式环境先核对数据规模与维护窗口，必要时另行拆分大表回填和索引上线，不直接承诺零停机。

失败时保留错误和审计结果，修复未执行的新迁移或异常数据后重新执行；不要修改已应用迁移或手工跳过 checksum。若迁移已成功而新版本启动失败，优先保持维护状态并前向修复；旧版本写入不兼容 010，不能简单回退旧 API 后恢复写入。需要整体回退时使用迁移前备份，并明确处理备份之后的新写入，禁止直接 DROP 新字段造成历史归属丢失。

## 本地异步 Mock 使用说明

实现已构建，**未运行以下写入流程**。CLI 仅允许 development + localhost / loopback 数据库，未开放 HTTP 入口。

```text
npm run mock:fulfillment -- create USER_ID input.json
npm run mock:fulfillment -- claim ORDER_ID
npm run mock:fulfillment -- resolve ORDER_ID SUCCEEDED "本地模拟成功证据" TOKEN
npm run mock:fulfillment -- resolve ORDER_ID FAILED "本地模拟明确失败证据" TOKEN
npm run mock:fulfillment -- resolve ORDER_ID UNCERTAIN "本地结果未知证据" TOKEN
npm run mock:fulfillment -- list
```

input.json 使用现有 createOrderInputSchema：region、service、plan、quantity、idempotencyKey、可选 areaCode。创建仍按原账号、价格与库存规则扣分和预占，不是免费演示入口。订单幂等键复用时返回原订单。

PENDING → PROCESSING → SUCCEEDED / FAILED / UNCERTAIN。过期的 PROCESSING 再执行 claim 会记录 UNCERTAIN，不重新领取；UNCERTAIN 查证后用不带 TOKEN 的 resolve 明确确认成功或失败，并填写证据。相同终态重复确认返回 changed=false，相反终态拒绝覆盖。未知结果保留预占与原扣分，明确失败才按原扣分流水等额冲正。事件仅记录本地模拟器转换与证据，不宣称真实供应商反馈或管理员身份认证。

未来真实接口必须另行定义供应商契约和权限：短事务记录/领取 → 事务外网络调用 → 校验当前状态与令牌后短事务结算。当前 Mock 没有网络副作用，因此没有为了形式引入队列。

## 代理与限流核对

已有 `D:/llinepool/deploy/nginx.conf.example` 将 API 代理到 127.0.0.1:3010，并用 `$remote_addr` 覆盖 X-Forwarded-For。API 默认监听 loopback。新增 TRUSTED_PROXY_IPS 默认为空；在该单层本机代理拓扑下，部署时可显式配置 `127.0.0.1,::1`，并确认 API 不向公网直连。未修改同级 deploy 文件或运行中的代理。

登录/注册始终按可信客户端 IP，已登录业务按账号；不无条件信任转发头。当前仍使用进程内限流，多实例统一配额尚未实现；是否需要共享存储取决于实际部署。未进行真实代理请求验收。

## 实际允许验证与未执行项

已执行：

- `npm run api:build`：通过，包含共享契约构建与后端 TypeScript 编译；最终后端改动后复验通过。
- `npm run build:web`：通过，包含 contracts、库构建、网页构建、声明生成与源码完整性检查。117 个上游文件未变化。构建有现有 Zod 注释处理及单包大于 500 kB 提示，无构建失败。
- `npm run db:allocation-audit -- --details`：最终执行通过，结果如上。首次因 008 表不存在失败，已修复审计工具兼容性并复验。
- 源码检查：核对所有订单写入、短信与统计路径、触发器职责、锁顺序、后台回收、续费禁用、代理示例及终态/冲正条件。

未执行：

- 任何测试、临时脚本测试、并发或压测；遵守 AGENTS.md 与用户要求。
- 新库/旧库实际迁移、约束 VALIDATE、实际回填及迁移故障恢复演练。
- 到期扫描实际回收、后台重复回收、重新分配与接收竞争。
- Mock CLI 创建/领取/成功/失败/未知/过期/重复冲正流程的运行验收。
- 浏览器/API 业务场景、真实代理限流与转发头防绕过验收。
- 真实供应商、支付、真实回调、上线与部署。

因此本次交付是已实现、已构建的代码与追加迁移，以及当前库只读审计；不能把并发、SQL 执行或业务运行场景写成已经通过。下一步是获得目标库迁移授权后按维护顺序落库；测试指令未改变前，仍不执行测试。真实供应商写操作和迟到消息规则需契约与业务确认后另行实现。
