# WP1 统一库存接口验收（2026-10-28）

- 执行分支：`feature/wp1`
- 基线：`f8c6bf5 Land feature/wp1-030`
- 服务：`127.0.0.1:3010`、`127.0.0.1:5178`；`/api/health` 200
- 证据：`C:/Users/27792/.rove/worktrees/llinepool-5e751a034ad2/nuthatch/linepool-ui/.local/wp1-api-20261028/safe-read.json`
- 备份（统筹提供）：`D:/llinepool/linepool-ui/backend/.local/backups/before-short-term-2026-10-28T06-19-46-414Z.dump`
- 统筹已确认迁移成功：`cutover=2026-10-28T06:46:03.958Z`、`retained_holdings=30043`、`connected_allocations=10028`。

## 结论

本次完成真实本地接口只读验收；普通用户两个目标接口和一级代理库存列表均 200，且用户可见库存包含代理分配号码。未执行任何业务写接口：当前 QA root 仅有 2 条 ACTIVE 且可转移的现有持有记录（`+16475562011`、`+65815562004`），不足以在不复用/破坏许可数据的前提下同时完成“转交直属下级、分配客户、批量划转”三类互相消耗来源持有记录的成功写操作。按边界停止，没有猜测通过。

## 实际请求记录

| 身份 | 端点 | 结果 | 关键信息 |
|---|---|---:|---|
| `qa-user-1027@linepool.test` | `GET /api/numbers` | 200 | 返回 3 条：代理来源 `+44740051020`（ACTIVE，providedBy=测试下级代理）、直销 `+19598119199`（ACTIVE）、已过期 `+6581242065`；无重复号码。 |
| `qa-user-1027@linepool.test` | `GET /api/dashboard/overview` | 200 | `activeNumbers=2`、`totalNumbers=3`、`totalMessages=2`、积分 985；概览 recentNumbers 与 numbers 可见性一致。 |
| QA root `1111111@111.com`（统筹创建的临时 session） | `GET /api/agent-inventory/context` | 200 | 一级代理 `f5c75ba6-93d8-4521-b3c4-6bd847b637b8`，`manageSubagents=true`、`transferHoldings=true`。 |
| QA root | `GET /api/agent-inventory/holdings?limit=100` | 200 | 5 条历史/当前记录，其中 ACTIVE 且 `transferable=true` 仅 2 条：`+16475562011`（WhatsApp，加拿大）和 `+65815562004`（WhatsApp，新加坡）。`+44740051020`、`+65815561006` 已为 RETIRED 并分别产生客户/二级代理后继记录。 |
| QA root | `GET /api/agent-inventory/stock?limit=100` | 200 | 2 条已分配库存，AVAILABLE=0（root 可见范围）；无可直接“拿号”的 root 现有 AVAILABLE 记录。 |
| QA root | `GET /api/agent-inventory/customers` | 200 | 直属客户：`小王`（客户 ID `77e0da2f-cfa1-4b4f-a69f-5d4242d4220b`）及测试客户。 |
| QA root | `GET /api/agent-inventory/subagents?limit=100` | 200 | 直属二级代理：小李、体验核验二级代理。 |
| QA root | `GET /api/agent-inventory/balances` | 200 | root USD 余额 1570 cents；无本次写入前后变化。 |
| 管理员临时 session | `GET /api/agent-inventory/stock?status=AVAILABLE&limit=5` | 200 | 平台仍有 AVAILABLE 库存；仅作状态确认，未领取任何号码。 |

## 写接口执行与阻塞

- `POST /api/agent-inventory/stock/claim`：未执行。此前准备脚本在管理员登录失败（`INVALID_CREDENTIALS`）后立即停止，未发生 claim；随后按要求废止了任意 AVAILABLE 领取逻辑。
- `POST /api/agent-inventory/holdings/resell`（转交直属下级）：未执行。
- `POST /api/agent-inventory/holdings/assign-customer`（分配客户）：未执行。
- `POST /api/agent-inventory/holdings/batch-preview` / `batch-transfer`（批量划转）：未执行。
- 原因：许可且已有 QA root 归属的可转移 ACTIVE 持有只有 2 条，而三种写操作至少需要互不复用的来源记录；另有许可号码已归属客户/二级代理，不能冒充 root 来源或重复占用。为避免产生无法安全恢复的业务变化，未做部分写入。
- 未执行直接 SQL、迁移、服务重启、清理或恢复；没有新增账号、没有新拿号、没有数据变化、无需恢复脚本。

## 缺陷 / 后续

未将阻塞误报为产品缺陷。请统筹提供/准备一组明确许可且归属 QA root 的额外 ACTIVE 可转移号码（或明确允许按顺序执行并由统筹恢复的夹具），再继续三类写接口验收；执行前应记录每条 holding 的原状态、归属、期限及对应 stock 状态。

## 受控快照循环（blocked）

统筹提供了快照 `D:/llinepool/linepool-ui/backend/.local/backups/before-wp1-write-cycles-2026-10-28T07-20-40-974Z.dump`，并明确许可只使用 `+16475562011` 对应 holding `828e2774-ea88-4d51-935f-4377f31bd6e3` / stock `099f7cb5-4460-4cdf-a86c-f4bf368d4d15`。开始前通过 root/admin session 记录：该 holding 为 root ACTIVE、`transferable=true`，stock 为 ALLOCATED 且指向该 holding；root 另有 `+65815562004` 一条 ACTIVE 可转移记录。完整逐请求回执：`C:/Users/27792/.rove/worktrees/llinepool-5e751a034ad2/nuthatch/linepool-ui/.local/wp1-api-20261028/write-cycle-receipts.json`。

首个实际写请求：

- `POST /api/agent-inventory/holdings/resell`（root → 小李，`+16475562011`，新 UUID idempotencyKey）返回 **409 `PRICE_NOT_SET`**，提示 `WhatsApp / ca` 未设置价格。
- 按要求立即停止；未执行 release、claim、assign-customer、batch-preview、batch-transfer，也未产生任何数据库变化。快照无需本次恢复。
- 因为没有设置价格依据，不能安全猜测价格或追加价格写入；本循环标记 **blocked**，不是通过。

## 价格与结算预览只读核对

- 证据：`C:/Users/27792/.rove/worktrees/llinepool-5e751a034ad2/nuthatch/linepool-ui/.local/wp1-api-20261028/price-quote-receipts.json`。
- `GET /api/agent-inventory/prices`（root）返回 200。现有规则仅 1 条：`service=Google`、`regionId=null`、`pricingKind=WHOLESALE`、`unitAmountMinor=300`、`isActive=true`；没有 WhatsApp/ca 或 WhatsApp/sg 规则。
- `POST /api/agent-inventory/settlement-preview`（root，`operation=RESELL`、目标小李）对 `+16475562011` / ca 返回 409 `PRICE_NOT_SET`，`sufficient/price` 不生成。
- 同一只读预览对 `+65815562004` / sg 返回 409 `PRICE_NOT_SET`，`sufficient/price` 不生成。
- 该接口在 `backend/src/agent-inventory.ts` 使用 `READ ONLY` 事务；本次只读请求没有写价格、库存或账本。两个许可号码均无可用结算价格，因此 WP1 写验收继续 **blocked**；不自行新增或修改价格规则。

## 临时价格夹具后的受控循环（blocked）

- 统筹授权使用 USD 3.00（300 cents）临时价格；证据：`C:/Users/27792/.rove/worktrees/llinepool-5e751a034ad2/nuthatch/linepool-ui/.local/wp1-api-20261028/price-fixture-cycle-receipts.json`。
- 管理员仅新增两条规则，均返回 **201**：WhatsApp/ca 规则 ID `a8a3959d-8a56-4956-bea0-bbcbc775d474`；WhatsApp/sg 规则 ID `7ebda651-612f-445d-b66b-6f06fbe9a7be`。两条均 AGENT seller、root sellerAgent、WHOLESALE、P30D、USD、300、active；未写其他价格。
- root 对许可号码 `+16475562011` 的 RESELL settlement preview 返回 **201**，`sufficient=true`、`unitAmountMinor=300`、`amountMinor=270`、`billedDays=27`；随后 `POST /api/agent-inventory/holdings/resell` 返回 **201**，生成小李目标 holding `b4213a4d-fb0d-40cd-a392-8d49ce3d406b`。
- 管理员 release 该目标 holding 返回 **201**，同一 stock `099f7cb5-4460-4cdf-a86c-f4bf368d4d15` 正确变为 AVAILABLE、`holdingId=null`。
- 受控复位的 claim 只读结算预览随后返回 **409 `STOCK_UNAVAILABLE`**（号码不可用或超过资源期限），因此立即停止；未执行 claim、客户分配、批量预览/划转或后续复位。该循环已发生一次临时 resell/release 写入，统筹必须用快照 `D:/llinepool/linepool-ui/backend/.local/backups/before-wp1-write-cycles-2026-10-28T07-20-40-974Z.dump` 恢复，包含临时价格规则和本次交易记录。
- 本轮结果为 **blocked**，不能视为完整 WP1 写验收通过；没有自行恢复数据库，也没有操作第二条 WhatsApp/sg stock、其他账号或其他号码。
