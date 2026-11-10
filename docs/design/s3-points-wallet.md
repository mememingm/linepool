# S3 · 自营统一积分钱包设计

> 2026-11-06 架构更新见 [v4.2 总执行文档](../handoff/lp-once-v41-master-plan.md)：S3 钱包由各站自营消费分别使用，账号和余额不跨站合并；代理套餐/取码不联动钱包，平台不经手代理销售款，旧代理金额账保留历史但首期不启用进货/分货/结算。本文实际实施证据保留；旧 S3 写库授权不适用于新目标库。新结果写回总文档。

日期：2026-11-04。状态：**已批准按“近期不做现金退款”实施；代码集成和检查见第 9 节。**

## 0. 已确认的范围

用户已在本轮明确选择：**近期不做充值退现金。** S3 只实现账户、冻结、流水，保留订单失败解冻和原消费退积分。

本阶段不创建 `point_lots`、`point_allocations` 或 `refund_orders`。现金退款及来源批次等退款规则确定后另行设计；不提前迁入 ONCE 的现金退款接口。此选择已记录，后续无需重复确认。

用户已批准本设计并明确要求并行实施。以下保留设计契约，实际实施记录见第 9 节。

依据：[分阶段执行方案 S3](../handoff/lp-once-unification-plan.md)、[数据库方案第 0 节批准结论](../handoff/unified-core-database-proposal.md)、[交接说明](../handoff/next-session-handoff.md)。数据库方案第 0 节优先于正文中旧的全量迁表建议。

本轮用户明确暂缓 S2 的 F1/F2，批准直接实施 S3。seed 仅适配资金写入，不修其号码账户遗漏；收信实现不改，不将 S2 记成业务验收通过。代理结算保留币种金额已批准，不重复要求确认。

## 1. 本阶段边界

本阶段目标：核心中每个自营用户只有一个积分账户，LinePool 和以后迁入的 ONCE 使用同一余额；原 LinePool 所有积分读写一次切换到该钱包。账户键不含门店；业务记录可以保存销售门店，不能由客户端提供门店来跨用户选择钱包。

核心继续使用现有 NestJS、`pg` 和 `Database.transaction`。不复制 legacy 的 Prisma 访问层，不增加另一套事务框架、钱包服务进程或通用工作流。

S3 不迁 ONCE 用户、租约、租赁订单、充值退款业务模块或前端；不改变邮箱唯一性、会话及代理客户归属。ONCE 在 S5 前仍走 legacy API，不能将“S3 核心钱包可共用”表述为“两站当前已经实时共用余额”。ONCE 现存账户和余额的映射、导入及防重复执行属于 S4 设计。

保留 `number_allocations`、代理币种账及现有两套价格。电话站部分扣款、白标商户、支付渠道三表均不在 S3 实现范围。

## 2. 当前模型与读写清单

以下为设计时读取的迁移前源码行为，不是数据库运行结果。位置以符号和当时行号辅助定位；实施后的对应位置见第 9 节。不把历史迁移当成待编辑文件。

### 2.1 LinePool 积分

| 模型 | 当前事实 | 依据 |
| --- | --- | --- |
| `users.points_balance` | 非负 `integer`，默认 0，是现有可用余额来源 | [001](../../services/core/db/migrations/001_initial.sql) 第 1–9 行 |
| `point_ledger` | 全局 `sequence`；`user_id`、`type`、`delta`、`balance_after`；按订单唯一扣分 | [001](../../services/core/db/migrations/001_initial.sql) 第 74–89 行 |
| 失败冲正 | `reverses_ledger_id` 唯一；必须同用户、同订单、全额反向冲正 | [010](../../services/core/db/migrations/010_allocation_lifecycle_mock_fulfillment.sql) 第 59–73 行 |
| 充值关联 | `RECHARGE` 必须关联充值单，充值单与积分流水互相保留引用；充值只入账一次 | [013](../../services/core/db/migrations/013_recharge_settings_orders.sql)、[014](../../services/core/db/migrations/014_core_sync_recharge_inventory.sql) 第 65–77 行 |
| 演示赠分 | `sandbox_grants.ledger_id` 引用流水，用户只能领一次 | [011](../../services/core/db/migrations/011_local_sandbox_tools.sql) |

| 当前位置 | 读写行为 | S3 切换落点 |
| --- | --- | --- |
| [ordering.ts](../../services/core/src/ordering.ts) `Ordering.create`，第 18–61 行 | 锁用户、检查余额和订单幂等；扣 `points_balance`，写 `ORDER_DEBIT`；延迟 Mock 订单也先扣分 | 改用同事务冻结；即时成功同事务全额扣除，延迟履约保留冻结 |
| [mock-fulfillment.ts](../../services/core/src/mock-fulfillment.ts) `locked`、`resolve`，第 11–20、62–74 行 | 锁用户→订单→操作记录；成功交付，失败查原扣分并全额退回；不确定结果保留原状态 | 新冻结订单成功 capture、失败 release；已迁入的旧扣款订单失败走原消费退款，见第 6 节 |
| [recharge.ts](../../services/core/src/recharge.ts) `creditVerified`，第 94–113 行 | 校验充值单金额/币种和支付流水归属，锁用户，加余额并写 `RECHARGE`；当前先锁充值单后锁用户 | 保留校验及唯一引用，改调用钱包 credit；统一锁顺序，避免与下单/退款相反 |
| 同文件 `createOrder`、`records`、`overview` | 创建/读取 `recharge_orders`；overview 经 `Workspace.account` 取余额 | 保留现有入口、状态和 `not_connected`；金额换算快照由充值单保存 |
| [sandbox.ts](../../services/core/src/sandbox.ts) `Sandbox.credit`，第 18–26 行 | 一次性 100 演示积分、流水与 `sandbox_grants` 同事务 | 使用固定用户业务 ID 调用演示 credit；保留已有 grant 和流水 ID |
| [demo-seed.ts](../../services/core/db/demo-seed.ts) `seedDemo`，第 53–91 行 | 仅首次建演示账号时写初始赠分和演示订单扣分，最后存余额；重复执行不重置账号和历史 | 演示资金写入统一钱包；已有演示账号不重发。号码账户遗漏 F1 不在本轮改动中 |
| [scripts/seed.ts](../../services/core/scripts/seed.ts) | `db:seed` 调用 `seedDemo` | 入口保留，跟随 seed 的钱包适配 |
| [authentication.ts](../../services/core/src/authentication.ts) `UserRow`、`toUser`、`login`、`register`、`updateProfile`、`getSession` | `SELECT *`/`RETURNING *` 隐含依赖旧余额；登录、注册、会话及改资料返回 `pointsBalance` | 所有返回用户的路径从账户 JOIN/同事务读取余额；新注册原子创建零余额账户 |
| [workspace.ts](../../services/core/src/workspace.ts) `points`，第 181–191 行 | 读旧余额、分页流水、正负汇总 | 读钱包账户和扩展后的同一张流水；冻结不计作消费收入，见第 7 节 |
| 同文件 `account`、`dashboard`、`dashboardOverview`，第 194–240 行 | 账号和仪表盘返回旧余额；overview 间接调用 dashboard | 统一读账户可用余额，保留对外 `pointsBalance` 含义 |
| [administration.ts](../../services/core/src/administration.ts) `orderNeedsAttention`、`orderFields`、`userFields`，第 30–41 行 | 依据旧扣分/冲正推断订单支付状态；用户列表读取余额 | 订单资金状态改读冻结记录/历史扣款事实，不能把 RESERVED 判成漏扣；用户列表 JOIN 钱包 |

LinePool 当前不存在正在工作的“续费扣积分→失败退分”写入方：[number-services.ts](../../services/core/src/number-services.ts) `options`、`create` 明确返回 `RENEWAL_DISABLED`。S3 保留禁用；历史 `renewals` 及读取接口不因此重新启用。

### 2.2 代理和客户币种账（保留）

`balance_accounts` 按 AGENT/CUSTOMER 主体和币种记录 `balance_minor`、`version`；`balance_ledger` 保存金额增减及余额。定义见 [015](../../services/core/db/migrations/015_agent_inventory.sql)、唯一约束补充见 [016](../../services/core/db/migrations/016_agent_inventory_hardening.sql)；报价和结算快照见 [028](../../services/core/db/migrations/028_agent_settlement.sql)。这些账户不映射进积分账户。

| 位置 | 直接读写 |
| --- | --- |
| [agent-inventory.ts](../../services/core/src/agent-inventory.ts) `createAgent` 第 180 行、`createCustomer` 第 515 行 | 创建 AGENT/CUSTOMER 的 USD 账户 |
| 同文件 `dashboard` 第 264 行、`subagent` 第 414 行、`balances` 第 908 行、`ledger` 第 991–996 行 | 查询余额和币种流水 |
| 同文件 `adjustBalance` 第 1027–1040 行 | 锁账户，后台金额调整并追加金额流水 |
| 同文件 `transfer` 第 1159–1180 行 | 按 ID 排序锁两账户，双方余额与转账流水同事务变更 |
| [agent-settlement.ts](../../services/core/src/agent-settlement.ts) `quoteSettlement` 第 52–54 行、`settleBalances` 第 70–88 行 | 报价读取买方余额；结算创建/锁账户、扣买方金额、记上级收入及流水 |
| [agent-inventory-controller.ts](../../services/core/src/agent-inventory-controller.ts) `agents` 第 111–112 行 | 管理员代理列表直接查询 USD 余额 |

`claimStocks`、`assignHoldingToCustomer`、`resellHolding` 等通过现有结算函数执行，不在 S3 接入积分钱包。零售只记账、不自动扣客户积分；已经收取的代理进货成本不再重复扣款。代理页面与 `packages/contracts/src/agent-inventory.ts` 保持币种语义。

### 2.3 ONCE 模型

模型位于 [schema.prisma](../../services/once-api-legacy/prisma/schema.prisma) 第 318–425、478–507 行。

| 模型 | 关键字段和约束 | 核心对应 |
| --- | --- | --- |
| `PointAccount` | `userId` 唯一，available/frozen、sequence、status | `point_accounts`；复用核心流水的全局 sequence，无需再维护一套账户 sequence |
| `PointLedger` | available/frozen 双变动与双余额；`(accountId,kind,businessId)` 唯一 | 扩展已有 `point_ledger`，保留旧 ID 和业务引用 |
| `PointReservation` | 业务冻结、RESERVED/CAPTURED/RELEASED、累计退分；业务唯一 | `point_reservations` |
| `PointLot` | PAID/DEMO/COMPENSATION 来源、发行/可用/冻结、充值关联 | 本阶段不创建 `point_lots`；随来源和现金退款规则另行设计 |
| `PointAllocation` | 冻结到批次的分摊、累计退分；冻结+批次唯一 | 本阶段不创建 `point_allocations`；与号码使用权无关 |
| `RechargeOrder` | 原币金额/积分/汇率、幂等请求、状态、退款本金计数 | S3 沿用核心 `recharge_orders`；ONCE 差异在 S4 设计迁入 |
| `RefundOrder` | 原充值和凭证、金额/积分、审批和执行状态、资金冻结及请求参数 | 现金退款延期，不在 S3 建 `refund_orders` 或迁入对应接口 |

ONCE 有独立 `PaymentAttempt`、`PaymentReceipt`、`PaymentEvent`。数据库批准结论已明确暂缓这三表，不能复制 `points.service.ts` 时顺带迁入。

### 2.4 ONCE 读写位置与迁入边界

| 位置 | 当前读写 |
| --- | --- |
| [auth.ts](../../services/once-api-legacy/src/auth.ts) `AuthService.register` 第 39 行 | 注册时嵌套创建 `PointAccount` |
| [points-ledger.ts](../../services/once-api-legacy/src/points-ledger.ts) `lockPointAccount` 第 13–20 行 | 锁用户，upsert/锁账户，读取账户与用户限制状态 |
| 同文件 `ledger` 第 22–33 行 | 更新账户双余额和 sequence，汇总批次检查一致性，追加流水 |
| 同文件 `grantPoints` 第 35–42 行 | 按业务查流水；创建 PAID/DEMO/COMPENSATION 批次并入账 |
| 同文件 `reservePoints` 第 44–65 行 | 查冻结幂等、账户可用余额和批次；先补偿再按时间消费，更新批次、创建冻结/分摊/流水 |
| 同文件 `settlePoints` 第 67–80 行 | 读取冻结和分摊，扣除或释放批次冻结，写账户流水和终态 |
| 同文件 `refundConsumedPoints` 第 82–100 行 | 查原 CAPTURED 冻结和退款幂等，累退不超额，恢复原批次并写退分流水 |
| 同文件 `removeCompensation` 第 102–113 行 | 只扣可用补偿批次，不得扣付费和冻结积分 |
| [fulfillment.service.ts](../../services/once-api-legacy/src/fulfillment.service.ts) `purchase` 第 30–59 行、`claim`、`run` 第 102–130 行 | 账户锁与订单请求幂等；创建冻结并关联订单；成功 capture、失败 release、不确定保留冻结 |
| [points.service.ts](../../services/once-api-legacy/src/points.service.ts) `onModuleInit`、`account` 第 28–40 行 | 检查 DEMO 资产隔离；读取账户和按来源批次汇总 |
| 同文件 `history`、`rechargeView` 第 42–61 行、`adminHistory` 第 356–365 行、`adminSummary` 第 366–378 行 | 读积分流水、充值/退款历史、订单资金与来源/现金汇总 |
| 同文件 `createIntent` 第 77–84 行、`createRecharge` 第 95–125 行、`recharge` 第 126–131 行 | 取得账户锁，创建购买草稿；充值请求幂等、额度汇总、创建充值单；详情读取批次可退额 |
| 同文件 `demoPay`、`checkRecharge` 第 132–171 行 | 设置 Mock 支付结果，领取查询任务并更新充值状态；外部调用在事务外 |
| 同文件 `receiveTrustedPayment` 第 173–231 行 | 校验并保存事件/付款凭证、去重；账户限制时记已收未入账，额外付款建退回单；成功创建批次、到账并更新充值单 |
| 同文件 `requestRefund` 第 235–249 行 | 读取原充值、可用批次和已应用付款凭证；校验剩余本金，创建现金退款申请 |
| 同文件 `approveRefund` 第 251–268 行、`rejectRefund` 第 270–277 行 | 审批重查金额，冻结指定充值批次、预留本金额度；写退款状态和审计 |
| 同文件 `runRefund` 第 279–311 行 | 领取退款任务，事务外调用 Mock；成功扣冻结，失败释放，不确定保留；更新原充值本金计数 |
| 同文件 `adjust` 第 313–326 行、`refundConsumption` 第 328–344 行 | 后台补偿增减及外层参数幂等；退原消费并更新订单累计退款状态 |
| 同文件 `reconcile` 第 380–396 行 | 对账账户、流水、冻结、批次/分摊及计数；更新 REVIEW/ACTIVE 和异常 |
| 同文件 `returnUncredited` 第 398–412 行、`resolveException` 第 414–427 行、`recover` 第 429–436 行 | 未入账实收退款、异常处理，恢复支付事件/充值查询/未知退款 |
| [points.controller.ts](../../services/once-api-legacy/src/points.controller.ts) 第 49–97 行 | 用户及管理员 HTTP 接口调用上述服务，无独立钱包 SQL |
| [maintenance.service.ts](../../services/once-api-legacy/src/maintenance.service.ts) `tick` 第 62–73 行 | 周期调用 `points.recover`，不自行修改积分表 |
| [payment.gateway.ts](../../services/once-api-legacy/src/payment.gateway.ts) | 使用充值/退款订单类型并返回本地 Mock 结果，不直接写积分表 |

ONCE 当前低层 `grantPoints` / `reservePoints` 查到同一业务键后直接返回；参数变化冲突主要由上层业务请求比较保证。核心钱包必须在自身入口比较已保存的业务参数，不能把“键存在”直接当成相同请求。

## 3. 共同目标结构

### 3.1 `point_accounts`（新增）

- `id uuid PRIMARY KEY`；`user_id uuid NOT NULL UNIQUE REFERENCES users(id)`；`UNIQUE(id,user_id)` 用于流水归属约束。
- `available_points integer NOT NULL DEFAULT 0`、`frozen_points integer NOT NULL DEFAULT 0`，分别非负；两者合计用 bigint 表达式检查不超过 `2147483647`，延续核心现有积分数值边界，避免冻结后绕过账户上限。
- `status` 为 ACTIVE/REVIEW，`created_at`、`updated_at`。不额外维护另一套可变的历史积分余额。
- 迁移为全部核心用户建账户；注册在同一事务中建立用户与零账户。正常读取用 JOIN；缺失账户视为完整性问题，不能悄悄按零余额继续扣款。
- REVIEW 钱包可查询；阻止新增消费。已存在冻结的确定结算/解冻和经授权的原消费退分可执行，避免账户受限后永久锁住资金；操作仍校验用户归属、原业务和审计。用户登录限制继续由现有账号规则处理。

### 3.2 `point_reservations`（新增）

- `id uuid PRIMARY KEY`，`account_id` 外键，`kind` 为 ORDER，`business_id text`、`points integer > 0`。
- `status` 仅 RESERVED/CAPTURED/RELEASED；`refunded_points` 默认 0，范围 `[0,points]`，只有已扣消费允许退分。
- 保存规范化的业务参数 `request_payload jsonb`，以及创建/结算时间。
- `UNIQUE(account_id,kind,business_id)`；对账查询索引 `(account_id,status)`。
- `orders` 新增唯一的 `point_reservation_id` 外键。写入约束必须同时校验冻结账户用户、ORDER 业务 ID、订单 ID、`total_points` 一致，不能仅检查“冻结 ID 存在”。无需另存可独立修改的订单余额；资金展示由冻结状态和累计退分导出。
- S3 冻结结算只接受全额 capture 或全额 release。订单已扣后的部分退积分，是独立的消费退款；它不等于电话站需要的“同一次冻结部分扣除并释放余量”。零价补偿业务不伪造正积分冻结，待 S4 业务设计处理。

### 3.3 扩展原 `point_ledger`，保留历史身份

复用表和列名，减少破坏原有引用：保留 `id`、全局 `sequence`、`user_id`、`type`、`delta`、`balance_after`、`description`、`reference_id`、`recharge_order_id`、`reverses_ledger_id`、`created_at`。其中 `delta` / `balance_after` 明确定义为可用积分变动/变动后可用积分。

新增 `account_id`、`frozen_delta`、`frozen_after`、可空 `reservation_id`、`business_id text`、规范化 `request_payload jsonb`。`(account_id,user_id)` 引用账户，杜绝错账；`(account_id,type,business_id)` 唯一。每次真实变更追加一行，至少一个 delta 非零；capture 的可用 delta 为 0，因此需替换旧的 `delta<>0` 检查。

类型保留历史 SEED_CREDIT/ORDER_DEBIT/ADJUSTMENT/RECHARGE，新增 ORDER_RESERVE/ORDER_CAPTURE/ORDER_RELEASE/ORDER_REFUND。原充值唯一入账、订单身份及旧全额冲正约束继续有效；旧订单扣分唯一索引只限制历史 ORDER_DEBIT，不限制新订单的冻结、扣除和多次合法退分。

新退款依赖 `reservation_id` 与独立退款业务 ID，累退额受冻结记录保护，不滥用原来只能全额且一次的 `reverses_ledger_id`。历史冲正仍保留该引用。

流水禁止正常运行时 UPDATE/DELETE，由新迁移增加只追加保护；数据回填在启用该保护之前完成。余额、冻结、流水及必要的原业务状态必须同事务写入，失败全部回滚。

### 3.4 原 `recharge_orders` 的成交与请求快照

保留现有金额、币种、精度、积分、状态、支付交易及流水引用；补充规范化 `request_payload jsonb`（原申请金额、支付方式）和 `conversion_snapshot jsonb`（本次规则版本、兑换金额/积分比例、币种、精度）。请求重放比较原申请参数，不根据当前规则重新报价；入账使用原单 points。

旧充值单的原规则版本可能无法恢复：快照只标明 LEGACY_EFFECTIVE 并保存原单已有金额、积分、币种和精度，不倒填成当前规则或虚构当时配置。新创建充值单保存完整成交换算信息。此变更不开放现金退款或接入支付渠道。

## 4. 钱包操作、幂等和事务

实现位于 `services/core/src/points-wallet.ts`。事务内方法使用调用者的 `WalletClient`（只需要 pg query 接口，同时接受 PoolClient 和 seed 的 pg.Client）；业务已经开启事务时不再嵌套启动事务。

| 内部操作 | 可用变动 | 冻结变动 | 约束 |
| --- | --- | --- | --- |
| credit | `+p` | 0 | 正整数、账户上限、来源/充值或演示业务 ID、同键同参数 |
| reserve ORDER | `-p` | `+p` | 可用余额足够，同业务只有一个冻结 |
| capture | 0 | `-p` | RESERVED→CAPTURED；同终态重放不追加流水 |
| release | `+p` | `-p` | RESERVED→RELEASED；与 capture 互斥 |
| refundConsumption | `+r` | 0 | 原 ORDER 已 CAPTURED，累计不超原扣款，退款业务 ID 唯一 |

所有输入积分为安全整数并处于上述整数范围。中间汇总/乘法用足够宽的整数运算，检查后再转 API number；沿用充值换算已用的 BigInt，不引入金额浮点换算。

同账户写入串行：先锁 `users`，再锁其 `point_accounts`，然后锁该业务订单/充值单、冻结/履约记录，最后按稳定 ID 顺序取得所需资源锁。沿用核心当前下单/延迟履约的基本顺序；`creditVerified` 要先用无锁查询定位用户，再按这一顺序重读并锁定充值单，不能继续“充值单→用户”。S4 引入租约时，所有涉及同组对象的写入方须再次统一这一顺序。

业务参数只存规范化的固定字段并按 JSON 值比较，不新增请求哈希机制。以 `(account_id,type,business_id)` 或冻结业务唯一键判重：相同参数返回已保存结果；金额、原单、来源等改变返回 `IDEMPOTENCY_CONFLICT`。结算目标相反返回 `RESERVATION_SETTLED`，不能覆盖终态。订单/充值已有客户端幂等键继续在原业务表约束，不另建通用幂等服务。

重复请求先识别原业务和已保存快照，不因当前商品价格或充值规则改变而再次计算并拒绝合法重试。充值请求要同时保留原始申请参数和成交换算快照，重放不按新汇率重新入账。

当前 Mock 的同步分配只做本地 SQL，可留在事务中；真实上游仍不接入。任何将来的网络履约遵守“创建订单+冻结+资源预留提交→事务外调用→确定结果同事务结算”。不确定结果及失效领取令牌不能触发自动扣款、解冻或重新购买。

对账共同条件：账户可用等于全部可用 delta 之和；账户冻结等于冻结 delta 之和，也等于当前 RESERVED 的 points 合计。查询同一数据库快照；不要求全局 sequence 连续，也不套用 ONCE 的账户 sequence=流水条数断言。

## 5. 延期的来源批次与现金退款

S3 不创建批次和分摊，不按来源回放旧积分，也不将未知历史余额认定为付费积分。保留充值和演示流水的既有业务标记、原消费引用、累计退分上限和双余额，供未来规则设计使用。

ONCE 当前“后台只能撤回可用补偿积分”的能力依赖批次来源。S4 若迁入该接口，须先补齐来源方案或取得规则调整批准，不能改成能任意扣付费积分。当前核心没有该积分后台扣减入口，S3 不新增一个改变此语义的接口。

现金退款另行设计时需处理原充值凭证、已消费/已冻结余额、原汇率整数换算、剩余本金额度和未知退款结果。不能直接沿用 legacy 的 `points=amountMinor` 假定，也不能用最新汇率退款。S3 不实现这些业务，不创建 PaymentAttempt/Receipt/Event 三表。

## 6. 数据转换与一次切换

实施前最高迁移编号是 031，本次新增 032；没有修改既有迁移或占用 027。迁移文件的生成与本机执行是两件事，实际执行情况见第 9 节。

### 6.1 迁移清单

| 迁移职责 | 具体动作 |
| --- | --- |
| `032_points_wallet.sql`（新增） | 建账户/冻结，扩展流水和充值快照，调整形状与关联约束；回填账户、业务键和订单冻结引用；在同次停写切换中删除 `users.points_balance`，启用只追加保护 |
| S4 后续迁移（本阶段不创建） | ONCE 用户映射、租约/整号使用权和 ONCE 充值；现金退款及来源表延期，支付渠道三表仍暂缓 |

一个事务完成结构与数据转换，应用先停写，数据库迁移与新代码配套上线；不让旧进程继续写已删除的余额列。无需长期双写或旧钱包兼容服务。迁移失败整事务回滚，保留原数据；不清库、不回滚已应用历史迁移、不用 S2 前快照覆盖现状。

### 6.2 余额与历史

1. 对每个用户核对旧 `points_balance`、流水 delta 合计及按 sequence 排序的 balance_after 链。账户从原余额创建，冻结初值为 0。无历史且零余额的用户建零账户，不造赠分。若非零余额无解释流水或余额链不一致，列出具体账户/差额，先解决数据映射；不自动补造调整或可退款充值。
2. 原流水逐行保留 ID、sequence、类型、金额、时间和订单/充值/冲正引用；只回填账户、新业务键/规范化参数及冻结列 0。历史没有经过冻结，不补造当时的 reserve/capture 流水。
3. 每笔能由原 ORDER_DEBIT 证明的旧订单建立 CAPTURED 冻结记录作为原消费身份（已全额冲正的记录保留 CAPTURED 且 `refunded_points=points`）。这是切换时的业务映射，不是再次扣款。缺扣款证据的订单不伪造资金成功，必须列为迁移异常并暂停对应切换。
4. 旧的 PROCESSING/UNCERTAIN 延迟订单已经直接扣过分，也按上述事实保持 CAPTURED：成功只交付，失败调用该原消费的幂等退分；不能再 reserve/capture 一次，也不能把不存在的冻结当作可释放余额。新建延迟订单才使用 RESERVED。履约逻辑按真实资金状态处理，不靠推测创建时间。
5. `recharge_orders.points_ledger_id`、`sandbox_grants.ledger_id`、历史 `reverses_ledger_id` 保留有效；原流水不删不重建。同一事务验证外键和业务归属后移除旧余额列。

现有 seed 的账户字段问题 F1 按用户决定仍未修复，因此不能在实施验收中直接运行 `db:seed` 后宣称钱包初始化成功。seed 已仅适配资金写入；后续若需演示整个 seed，应说明其号码账户依赖和所需修复范围。

### 6.3 应用切换清单

共同钱包实现和迁移的唯一负责人先确定列/方法契约，再并行做：下单与 Mock 履约；认证/账号/仪表盘读取；充值/sandbox/seed 资金写入；contracts 和 LinePool 接口适配。每个写代码 Agent 使用独立 worktree/分支；涉及同一文件的变更合并到一个负责人，不把 `workspace.ts` 或 `index.ts` 分给两个写入者。

本次指定迁移 Agent 独占新 032，主 Agent 独占共享 contracts 和集成工作区；其余写入 Agent 各自使用独立 worktree/分支，文件范围互不重叠。package/锁/全局配置未改，不增加依赖。子任务交付未提交差异，由主 Agent 审查后逐项集成，保留原主工作区未提交改动；没有 commit 或 push。

## 7. HTTP、契约和页面影响

既有路径保留；`pointsBalance` 在用户、账号、dashboard、充值概览中继续表示账户可用积分，是返回字段而非另一份存储。删除旧数据库列不会要求改登录/会话协议或页面布局。

| 接口/调用面 | S3 变化 |
| --- | --- |
| `/api/auth/login`、`register`、`me`；`/api/account`、资料修改返回 | 从统一账户取可用额；所有 `toUser` 调用方一同迁移，注册同事务建账户 |
| `/api/dashboard`、`dashboard/overview` | 余额 JOIN 钱包，号码/短信统计沿用原模型 |
| `POST /api/orders` | 输入幂等键不变；下单冻结、确定成功全额结算；不确定时沿用原订单并保留冻结 |
| `GET /api/points` | 保留分页及现有 balance 字段；增加 frozenBalance，流水补充 frozenDelta/frozenAfter，类型补齐新类型和现有 RECHARGE；不把 capture 的 `delta=0` 过滤丢失 |
| `GET /api/account/recharge`、`/records`、`POST /orders` | 余额来自钱包；保持当前支付未连接表现、充值单状态和查询范围，内部入账调用统一 credit |
| 核心后台用户/订单列表 | 用户余额来自钱包；订单资金状态由 RESERVED/CAPTURED/RELEASED/累计退款导出，保留历史冲正状态 |
| `/api/points/*` 和 `/api/admin/points/*` 的 ONCE 接口 | 当前仍由 legacy API 提供；S4 设计逐项映射，不在 S3 新建同名空接口或提前接前端 |
| 代理金额接口 | 不变，不新增积分兑换入口 |

`packages/contracts/src/index.ts` 的 `ledgerSchema` 目前仅列 SEED_CREDIT/ORDER_DEBIT/ADJUSTMENT，数据库已允许 RECHARGE；S3 切换时统一补齐，不把构建可通过当作响应可解析的证明。共享类型/Schema 由同一负责人修改。

流水收入/支出按经济变化 `delta+frozen_delta` 计算：reserve/release 为内部转移，不增加收入或消费；capture 才记支出，credit/refund 记收入。`kind=income/expense` 按该规则筛选，all 显示冻结/释放等完整记录。分页、计数和汇总使用相同规则，不能只改客户端数字。

需适配的 LinePool 调用方：`src/linepool/api/client.ts`；`wallet/Recharge.tsx`；`workspace-reference/PurchasePage.tsx`、`WorkspacePages.tsx`、`reference-data.ts`；以及返回订单支付状态的后台契约。现有积分明细以单一 delta 计算汇总，须同步改为上述双变动；其它仅显示可用余额的位置可以继续使用 `pointsBalance`。只改业务数据映射和积分状态显示，保持上游组件、布局和视觉；实施前遵守 LinePool 前端规则。

## 8. 两套价格和号码模型

`offers.unit_points` 是直营积分价，`price_rules.unit_amount_minor` 是代理币种批发/零售价。两者可独立定价；不从代理价格反推直营积分，不把客户销售自动改成扣分，不在 S3 新建兑换引擎。只有充值时按配置比例生成积分，金额、币种、精度、比例及结果在充值成交快照中保留。ONCE 套餐积分价在 S4 承接时也以订单成交快照为准。

`number_allocations` 继续是用户实际服务期间与收信归属依据，代理继续其持有和授权链，直营用户不进入代理持有链。S3 不修改号码所有权模型。

S4 需列入其设计和新迁移的字段/约束：

- allocation 类型 PLATFORM/WHOLE_NUMBER；前者必须有 platform_id，后者必须为空，整号不伪造平台库存。
- 租约 ID 及关联用户、号码一致性；一个租约允许多段期间，续租追加期间，不覆写历史。旧 phone_numbers 的 assigned_user_id/order_id/expires_at 是否清理在 S4 决定。
- PLATFORM 按号码+平台+有效期间排斥重叠；WHOLE_NUMBER 按号码+有效期间排斥重叠；额外保证同号码整号与按平台期间也不能交叉，不能让两条分开的部分约束留下空隙。
- 保留半开时间区间、资源有效期、用户/订单/号码身份、门店产品规则，按类型调整当前强制平台关联的外键与触发器。
- `sms_messages.allocation_id` 保留；迟到消息依发生时间归属，不随转让改历史。过期保留 EXPIRED_HELD 不等于可售，LinePool 到期任务不能释放 ONCE 保留号码。

S8 在同一冻结结算入口扩展“实际扣除+释放余量”，届时再设计状态、流水和通话业务引用；本阶段不预先添加部分结算状态或 calls/rate_cards 表。

## 9. 实施验收与本轮证据

S3 代码已完成主工作区集成。新增 `services/core/src/points-wallet.ts` 与 `services/core/db/migrations/032_points_wallet.sql`；下单履约、认证/工作台/后台、充值/沙盒/seed 资金写入、共享契约和 LinePool 流水显示已切换。钱包模块保留用户→账户锁顺序、同参数幂等、冻结终态互斥、原消费退分上限；余额 SQL 及累计流水汇总使用宽整数处理中间值。

已从根目录运行 `npm run build:all`、`npm run typecheck:all`，均通过。build 内置的 `verify:upstream` 确认 117 个上游文件未变。构建有 Zod/Rollup 注释和大 chunk 非阻断提示。没有新增依赖、修改锁文件、运行任何测试、commit 或 push。

用户已选择“批准开发库迁移和演示”。本机目标为 `127.0.0.1:5433/linepool_react`，032 已实际应用；以下为本轮真实运行记录，替代此前“等待写库批准”的状态。S3 完成，未进入 S4。

### 9.1 实际检查

| 命令/检查 | 实际结果 |
| --- | --- |
| 根目录 `npm run db:migrate` | `Applied migrations: 032_points_wallet.sql` |
| 根目录 `npm run build:all` | 最终版本通过；上游完整性检查为 117 个文件未变 |
| 根目录 `npm run typecheck:all` | 最终版本通过，含 contracts、LinePool 和 core |
| 迁移及业务演示后的 SQL 核对 | 30 个用户对应 30 个钱包，账户可用/冻结额与流水汇总差异数为 0；原有 45 条流水的原字段和 ID 保持一致 |
| 代理币种账核对 | 22 个金额账户、26 条金额流水与演示前记录一致 |
| 旧余额列切换 | 当前 `public.users` 的 `points_balance` 已删除；用 `pg_attribute` 限定实际 users 关系确认。早期未限定 schema 的检查混入了既有 sandbox schema，不作为当前业务库列存在的依据；没有改动或删除那些 schema |

余额显示修复后重新运行了完整构建与类型检查。一次中间类型检查发现缓存回调的空值分支可能产生不完整 Account，已改为仅更新现有同用户账户；上述通过结果对应修正后的源码。未运行测试套件或测试脚本，未新增依赖、修改锁、commit 或 push。

### 9.2 已执行的业务路径

1. **注册与赠分：** 通过实际注册页面创建零余额账户；核心赠分相同业务键重放返回同一流水，余额不重复增加，改金额返回 `IDEMPOTENCY_CONFLICT`。
2. **共用账户与并发：** 两个核心调用者取得同一账户 ID；余额为 6、两笔订单各需 6 时，一笔完成，另一笔返回 `INSUFFICIENT_POINTS`，余额归零。此项验证核心账户并发，不声称 ONCE 前端已经接入。
3. **冻结与履约：** 延迟订单先冻结 6；成功全额 capture，失败全额 release，重复结果 `changed=false`。不确定结果保持 RESERVED 和 6 冻结，之后按原订单确认成功；相反履约终态返回 `MOCK_TERMINAL`，相反钱包终态返回 `RESERVATION_SETTLED`。
4. **原消费退分：** 先退 2，再退剩余 4；重复部分退分取得同一流水。改金额、原单或 actor 返回幂等冲突，累计超过原扣款返回 `REFUND_LIMIT_EXCEEDED`；退款仍关联原消费和冻结记录。
5. **已扣分的处理中订单：** 032 前准备的旧订单从 124 退回 130，重复失败不再退，只有一条退分流水。另一个已 CAPTURED 的处理中订单成功履约前后余额均为 88，capture 流水仍只有一条。
6. **Mock 充值：** 本地模拟一笔 1,000 积分充值，只入账一次；同一支付交易跨单返回 `PAYMENT_TRANSACTION_REUSED`，改原请求金额返回幂等冲突。暂时将规则由第 5 版关闭为第 6 版后，旧请求仍返回原 SUCCEEDED 订单及第 5 版快照，新请求返回 `RECHARGE_NOT_CONFIGURED`；原规则及版本已恢复为 5，没有接入支付渠道。
7. **真实 HTTP 下单：** 浏览器登录会话调用 `POST /api/orders` 返回 201 并交付 Mock 号码；同请求再次调用返回同一订单 ID，改数量返回 409 幂等冲突。
8. **读取和实际页面：** 账号、dashboard、积分明细、充值概览均返回可用 1,082，冻结为 0。积分收入为 1,112、支出为 30；income 筛选只返回赠分/充值/退分，expense 只返回 capture，冻结与释放不重复计入收支。实际积分页、账户页已打开观察并截图，充值记录弹窗已实际打开观察；后台服务给出 POINTS_DEBITED、POINTS_RELEASED、POINTS_REVERSED 等正确资金状态。续费选项接口仍返回 403 `RENEWAL_DISABLED`。

页面运行中发现积分页新流水已加载而顶部余额仍停留在旧账户缓存。已在 `workspace-reference/workspace-data.ts` 的流水加载成功路径，按同用户账户同步 `first.data.balance`；没有改变页面布局或上游组件。通过“先加载账户、再从 HTTP 消费、再进入积分页”的实际路径，观察余额从旧缓存更新为 1,082，切换账户页后仍一致。

演示使用的账号为 `s3-wallet-1793807563250@example.invalid`，用户 ID `be4861cc-faa2-4ece-a410-9fbeb698d661`。旧单演示用户 ID 为 `703bd5c6-306b-4d79-be09-b71068ef3ac0`，旧订单为 `745bf860-8149-4764-9c66-91c428727331`。本地演示数据保留，原始记录在 `services/core/.local/s3-demo-20261104/state.json`，不含登录密码或会话 cookie。

### 9.3 原流程切换位置

| 原流程 | 统一钱包落点 |
| --- | --- |
| 注册、登录、会话、账号资料 | `authentication.ts`；注册同事务创建账户，读取统一账户可用额 |
| 下单与即时交付 | `ordering.ts` → `reserveOrderPoints`；确定成功调用 `settleOrderPoints(CAPTURED)` |
| 延迟 Mock 成功、失败、不确定 | `mock-fulfillment.ts` → capture/release；旧 CAPTURED 订单失败调用 `refundOrderPoints` |
| 演示赠分和 seed 的资金写入 | `sandbox.ts`、`db/demo-seed.ts` → `creditPoints`；整个 seed 未执行 |
| 充值到账 | `recharge.ts` 的 `creditVerified` → `creditPoints`，保留支付交易唯一归属和成交快照 |
| 明细、账号、仪表盘及后台 | `workspace.ts`、`administration.ts` 从账户/冻结读取，收支按双变动计算 |
| 契约和 LinePool 显示 | `packages/contracts/**`、`apps/linepool-web/src/linepool/**` 的积分类型、状态及数据适配 |

### 9.4 边界与现场

当前开发库名不符合 HTTP 沙盒入口要求的 `_sandbox`/`_test` 后缀，因此未放宽该限制；赠分、延迟履约和退分通过实际核心钱包/Mock 服务执行，正常注册、下单和查询通过实际 HTTP/页面执行。

F1/F2 继续按用户决定暂缓，没有运行整个 seed 或收信演示；不能把本轮钱包验收当作 F1/F2 已修复。现金退款、积分批次/分摊、真实支付、ONCE 前端接入、S4 及后续阶段均未实施。

临时 API、前端和浏览器页已关闭；本次启动的私有 PostgreSQL 已停止并保留数据。一次性演示脚本移除，仅保留上述本地记录和标明用途的演示数据。
