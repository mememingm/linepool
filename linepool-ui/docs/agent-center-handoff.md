# LINEPOOL 代理中心开发交接

> 交接状态：部分实现，尚未完成业务验收。  
> 核对时间：2026-10-26，本机时区 UTC+08:00。  
> 工作目录：`D:/llinepool`；应用目录：`D:/llinepool/linepool-ui`。  
> 核对时 Git 分支：`main`；HEAD：`4e030e3 docs: add subagent management plan`。  
> 本文依据交接时的工作区源码和本次静态检查编写，不能据此认定线上、数据库或真实上游已经验证通过。

## 1. 接手目标与范围

用户此前反馈：登录代理账号后看不到正确的代理功能，代理的产品定位、层级与业务逻辑存在问题。随后用户安排其他 Agent 搭建了新的前端，要求继续完善；本次最新要求是先写交接文档，交由其他人继续解决。

接手目标是沿用新前端，完成代理中心的数据接入、权限和本地业务流程，使功能能够实际操作。菜单、卡片或表格已经出现，不代表对应业务已经完成。

本阶段继续暂缓 PC/PingCode 的真实采购、库存同步、真实成本同步、真实收信联调及支付接入。可以完善本地数据库和 Mock 场景，但必须标明数据性质；没有权威成本时不得编造真实利润。

先读以下文件：

1. [项目执行边界](../AGENTS.md)。其中要求保留上游组件原件，且**不要运行测试**；允许构建、类型检查和源码完整性检查。
2. [代理中心重构方案](agent-portal-redesign-plan.md)：最新产品方向、角色、流程和验收要求。该文档开头仍是方案状态，实际实现进度以本文和源码为准。
3. [下级代理管理方案](subagent-management-plan.md)：既有下级管理设计，遇到与重构方案冲突的产品方向时以重构方案为准。

原非 PC 后端审查的背景文件在 `C:/Users/27792/Desktop/LINEPOOL 后端代码审查报告.md`。它不是本次代理中心交付已完成的证明。

## 2. 已明确的产品要求

- 普通用户和代理账号默认都先进入普通用户工作台；具备代理身份的账号显示“代理中心”入口。
- 点击入口后进入 `/agent`，采用与平台 `/admin` 一致的后台布局和交互方式。
- 一级代理为平台直接合作的伙伴：管理自己的客户、库存、价格、订单和财务，并管理直属二级代理。
- 二级代理只能管理自己的客户和业务，接收上级分配；不能创建三级代理，也不能查看上级、兄弟代理或平台全部数据。
- 伙伴允许查看直属下级的经营汇总；这一权限不能扩大成任意读取下级明细、余额、成本或全部历史数据。
- 库存业务方向为：平台分配给伙伴，伙伴转交直属下级，代理向客户提供服务。号码归属、有效期、价格快照和流水必须一致。
- 销售额来自客户实际支付，成本来自对应层级的结算价，利润按历史价格快照计算。后续改价不能重算旧订单利润。

## 3. 当前实现状态

| 模块 | 工作区已有内容 | 未完成或未验收部分 |
| --- | --- | --- |
| 登录与普通工作台入口 | 默认登录目的地已回到普通工作台；有条件的代理中心入口 | 四种身份的浏览器流程、身份切换和缓存隔离仍需核验 |
| 代理中心外壳 | `AgentAdminShell`、侧栏、顶栏、权限守卫、后台风格样式 | 需要实际账号验证身份、菜单、直接访问 URL 和禁用状态 |
| 概览 | KPI、图表、下级经营表；前后端已有 dashboard 接口链路 | 有前端类型错误、统计范围和时间口径问题，见下一节 |
| 下级代理管理 | 列表、搜索、筛选、分页、详情、绑定既有用户、改名、启停、库存转交相关代码 | 页面仍包装旧实现并引入 `AgentShell.css`；不能当作已完成后台组件统一或已通过业务验收 |
| 客户管理 | 已接 `agentCustomers()`，显示当前代理直属客户 | 目前只读；没有完成创建/绑定及完整管理流程 |
| 库存管理 | 后端已有持有、平台库存、分配、转交、释放等接口 | `/agent/inventory` 仍是占位页面 |
| 商品与价格 | 后端已有价格查询和写入能力 | `/agent/products` 仍是占位页面；价格在实际销售流程中的应用需核验 |
| 订单管理 | 后端存在 `transactions` 与 `orders` 相关入口 | `/agent/orders` 仍是占位页面；客户订单与代理交易链路尚不能认定已统一 |
| 财务流水 | 后端已有余额、账本、转账能力 | `/agent/finance` 仍是占位页面；收入、成本、利润闭环未完成 |
| 报表、设置 | 有路由和规划文案 | `/agent/reports`、`/agent/settings` 仍是占位页面 |

页面是否占位以 `src/linepool/agent/pages.tsx` 的 `agentPageComponents` 为准。目前只有 dashboard、agents、customers 装配了实际页面。

旧 `src/linepool/agent/AgentShell.tsx` 在工作区中已被删除，新入口使用 `AgentAdminShell.tsx`；不要恢复旧的简化页签式产品方向。

## 4. 优先处理的问题

### P0：前端当前存在明确的类型检查失败

文件：`src/linepool/agent/dashboard/AgentSettlementTable.tsx:15`。

本次执行 `npm exec -- tsc --noEmit` 的准确报错为：

```text
src/linepool/agent/dashboard/AgentSettlementTable.tsx(15,126): error TS18048: 'data' is possibly 'undefined'.
src/linepool/agent/dashboard/AgentSettlementTable.tsx(15,203): error TS18048: 'data' is possibly 'undefined'.
```

`data` 是可选属性，`rows` 来自 `data?.subagents ?? []`；`rows.length` 的判断没有让 TypeScript 在后面的回调中确认 `data` 一定存在。应采用明确的数据存在判断或安全的局部变量收窄，保留加载和空数据状态，不要通过强制断言掩盖缺口。

同时检查销售额展示：当前表格把 `salesMinor` 是否显示也绑定到 `costStatus === 'SYNCED'`。成本未同步不应自动隐藏已经有权威来源的销售额；成本、利润和销售额应分别表达可用状态。

### P0：看板库存汇总没有限制代理范围

位置：`backend/src/agent-inventory.ts` 的 `AgentInventory.dashboard()`，交接时约第 188 行起。

其中库存统计直接读取整个表：

```sql
SELECT count(*) FILTER (WHERE status='AVAILABLE')::int AS available,
       count(*) FILTER (WHERE resource_status='ERROR')::int AS error
FROM agent_number_stock
```

这会把平台全部可售库存和异常数量带入代理看板，与代理范围不符。列表接口 `stock()` 最近已收紧为 `h.agent_id = ANY(...)`，但看板没有同步收紧，两者口径也不一致。

修复时要先定义“代理可用库存”的含义：平台尚未分配的库存属于平台；代理持有库存应结合持有人、有效期、资源状态和可用服务计算。仅添加 `status='AVAILABLE'` 不能表达代理拥有并可销售的库存。

对伙伴允许汇总的直属下级库存，与伙伴自己能够操作的库存，返回和界面展示必须明确区分。

### P1：今日 KPI 和趋势时间范围错误

仍在 `AgentInventory.dashboard()`：

- `todayOrders` 和 `todayCodes` 使用当前 `period` 的起点。默认 `7d` 时，界面标注“今日”的卡片实际统计近七天；切换趋势周期还会改变今日 KPI。
- `7d`、`30d` 的起点采用当前时刻减整天，SQL 又按 UTC 自然日分组；输出固定 7/30 个日期时会漏掉当天的柱，边界日也只统计半天。
- `today` 目前只有一条按天数据；方案允许今日按小时展示，接手时应明确并统一接口含义。

修复要求：今日 KPI 使用独立的今日边界；趋势采用确定的时区和完整时间区间，日期补齐覆盖当天，汇总与柱状图总数一致。至少核验临近午夜、跨日和切换周期。

### P1：订单、接码和财务统计还只是初步实现

目前看板：

- 订单数来自旧 `orders` 表，代理分配、转交和转账等另记在 `tx_orders`；不能把交易数、销售订单数和转账数混用。
- 接码数主要通过 `sms_messages.user_id = customers.user_id` 和客户当前归属统计，尚不足以证明短信属于该代理的有效号码、对应服务和当时有效期。
- 部分查询按客户当前 `ACTIVE` 状态过滤历史数据；客户状态或归属变化可能改变历史统计。下级行的过滤条件也与上方汇总不同。
- `lastActiveAt` 实际来自最近短信时间，并非完整的账号最近活跃时间，文案和定义需要一致。
- `USED`、`EXPIRED` 固定返回 `0`，`serviceRanking` 固定为空数组。未知或未接入不能包装成真实的零业务量。
- `todaySales`、`todayProfit`、销售/成本/利润趋势和下级销售/利润目前都是 `null`，成本状态固定 `UNAVAILABLE`。这是明确缺少数据源的状态，不是财务功能已完成。

应从订单、号码持有/服务权益、归属历史和短信建立可追溯关联，再计算汇总。价格和财务来源未接好时继续显示不可用状态。

### P1：接口默认值和失败状态需要补全

- 控制器给 `period` 参数写了 `= '7d'`，但 `SchemaPipe(agentMetricPeriodSchema)` 会先执行，且枚举 schema 本身没有默认值。直接请求不带 `period` 的 dashboard 存在先被校验拒绝的风险，应将默认处理放在校验链路内并实际核验。前端当前总会传入周期，因此可能掩盖此问题。
- `dashboard/AgentDashboard.tsx` 的查询 hook 只返回 data/loading，没有暴露 error/refetch；请求失败容易看起来像“数据待接入”。需要单独显示请求失败及重试入口。
- 顶栏刷新通过 query invalidation 加 `revision` 实现；新页面接入时检查刷新确实更新当前页，避免只是改变数字却保留旧结果。

### P1：客户端权限与后端数据范围需要一起核对

- `visibleAgentIds()` 仍返回递归子树，不能对所有资源机械复用。列表、可操作库存、下级汇总和财务明细应按各自权限确定范围。
- `stock()` 已收紧列表范围，但持有列表与看板的“自身”“下级”语义尚未统一。
- 隐藏二级代理的“代理管理”菜单只是前端行为；后端的创建代理、转交、价格、账本和目标归属校验都要独立成立。
- 原测试账号曾有层级和称呼不一致的问题。必须核对 `agents.level`、`parent_agent_id`、`user_id`；不要只凭 UI 昵称判断是不是下级代理。

这些问题需要按实际 API 和数据验证；本文没有把静态阅读当成越权场景已经复现或修复。

## 5. 代码导航和已有接口

以下路径均相对于 `D:/llinepool/linepool-ui`。

| 位置 | 用途 |
| --- | --- |
| `src/app/App.tsx`、`src/app/router.ts` | 应用入口与路由分发 |
| `src/linepool/welcome/WelcomeLogin.tsx` | 登录目的地，保留普通工作台为默认入口 |
| `src/linepool/workspace-reference/WorkspaceReferenceShell.tsx` | 普通工作台及代理中心入口 |
| `src/linepool/agent/access.ts` | 会话、代理身份、入口状态、按代理隔离的查询 key |
| `src/linepool/agent/navigation.ts`、`AgentPermissionGuard.tsx` | 伙伴/下级菜单、路由、能力检查、旧链接转换 |
| `src/linepool/agent/AgentAdminShell.tsx`、`AgentSidebar.tsx`、`AgentTopbar.tsx` | 新后台外壳、刷新及退出 |
| `src/linepool/agent/pages.tsx` | 实际页面与占位页面注册 |
| `src/linepool/agent/pages/CustomersPage.tsx` | 直属客户只读列表，可作为数据查询写法参考 |
| `src/linepool/agent/pages/AgentsPage.tsx`、`SubagentsPage.tsx`、`SubagentDetail.tsx`、`SubagentActions.tsx` | 旧下级管理页面在新外壳中的包装和业务操作 |
| `src/linepool/agent/dashboard/` | 看板 hook、卡片、图表、下级表和类型 |
| `src/linepool/admin/primitives.tsx`、`Presentation.tsx`、`admin.css` | 可复用后台表格、状态、展示与视觉组件 |
| `src/linepool/api/client.ts`、`query-client.ts`、`contracts.ts` | 类型化 API、共享 QueryClient、契约导出 |
| `packages/contracts/src/agent-inventory.ts` | 代理、客户、库存、价格、财务和新增看板的 Zod 契约 |
| `backend/src/agent-inventory-controller.ts` | `/api/agent-inventory/*` 入口 |
| `backend/src/agent-inventory.ts` | `AgentInventory` 业务、权限、SQL 和事务 |
| `backend/src/agent-inventory-expiry.ts` | 代理库存/权益到期处理 |
| `backend/src/ordering.ts`、`workspace.ts` | 普通用户原有购买与工作台链路，接代理销售时要检查其与代理链路的关系 |

现有 API 可复用，但“有接口”不等于该接口已满足新流程或已通过联调：

| 能力 | 相对 `/api/agent-inventory` 的路由 | 前端方法示例 |
| --- | --- | --- |
| 身份、看板 | `GET /context`、`GET /dashboard?period=7d` | `agentContext`、`agentDashboard` |
| 直属下级管理 | `GET/POST /subagents`、`GET /subagents/:agentId`、`PATCH /subagents/:agentId/name`、`PATCH /subagents/:agentId/status` | `agentSubagents`、`agentCreateSubagent`、`agentSubagent`、`agentRenameSubagent`、`agentSubagentStatus` |
| 下级库存和交易 | `GET /subagents/:agentId/holdings`、`GET /subagents/:agentId/transactions` | `agentSubagentHoldings`、`agentSubagentTransactions` |
| 可转交库存 | `GET /transferable-holdings`、`POST /holdings/resell` | `agentTransferableHoldings`、`agentResellHolding` |
| 客户 | `GET/POST /customers` | `agentCustomers`、`agentCreateCustomer` |
| 库存 | `GET /holdings`、`GET /stock` | `agentHoldings`、`agentStock` |
| 平台分配与回收 | `POST /stock/import`、`POST /stock/claim`、`POST /stock/claim-batch`、`POST /holdings/:holdingId/release` | `agentImportStock`、`agentClaimStock`、`agentClaimStockBatch`、`agentReleaseHolding` |
| 价格 | `GET/POST /prices` | `agentPrices`、`agentSavePrice` |
| 交易、余额、账本 | `GET /transactions`、`GET /balances`、`GET /ledger/:ownerType/:ownerId` | `agentTransactions`、`agentBalances`、`agentLedger` |
| 余额转移 | `POST /transfers` | `agentTransfer` |

平台导入/分配接口当前要求管理员。不能为了让代理页面能点通，放开平台操作权限。

`AgentInventory.createTxOrder()` 对 `kind === 'PURCHASE'` 明确返回 `409 PROVIDER_UNAVAILABLE`，文案为 `PingCode purchase is not available; no supplier contract is connected`；其他部分仍有只创建 `PENDING` 记录的骨架。不要删除这类显式失败来制造采购成功，也不要把它直接当成已经实现的本地销售入口。

## 6. 数据、迁移与环境注意事项

已有核心表：`agents`、`customers`、`number_holdings`、`service_entitlements`、`agent_number_stock`、`agent_number_stock_events`、`tx_orders`、`balance_accounts`、`balance_ledger`、`price_rules`，另有原用户链路的 `orders`、`sms_messages`。

- 代理/库存相关迁移从 `015_agent_inventory.sql` 延续到后续加固迁移。`022_subagent_management.sql` 在核对时为未跟踪文件，不能遗漏。
- 工作区还存在其他任务的 `023_password_recovery.sql` 和密码找回相关文件；保留它们，不要因本任务回滚或覆盖。
- 迁移系统校验已应用迁移的摘要；结构变更应新增迁移，不要重写已应用文件。
- 本次没有连接数据库核查实际已应用版本，也没有执行迁移、导入数据或修改账号。
- `backend/scripts/seed-agent-inventory.ts` 当前用于补充本地 Mock 号码库存，不负责建立完整的伙伴/下级代理账号关系。不能把执行此脚本等同于准备好层级验收数据。
- 本地配置由 `backend/.env` 管理；所需键和默认值参考 `.env.example` 与 `backend/src/environment.ts`。文档中不要复制密码、会话 Cookie、密钥或数据库连接凭据。

建议在现有本地库先只读核对用户与代理身份：

```sql
SELECT a.id, a.user_id, u.email, a.name, a.level,
       a.parent_agent_id, a.status
FROM agents a
JOIN users u ON u.id = a.user_id
ORDER BY a.level, a.parent_agent_id NULLS FIRST, a.created_at;
```

用独立的普通用户、伙伴 A、A 的直属下级 A1、另一伙伴 B 准备验收场景；需要验证客户隔离时再核对客户实际归属。不要复用层级不明的账号得出权限结论。

## 7. 建议执行顺序与完成标准

1. **恢复前端类型检查**：修复下级经营表的可空数据处理，确认空数据、加载和有数据都能正常渲染。
2. **修复看板范围与时间口径**：先处理全平台库存泄露，再处理今日 KPI、趋势日期、有效库存与接码关联；对未具备的数据继续明确标记不可用。
3. **核对角色与接口权限**：从普通用户、伙伴 A、下级 A1、伙伴 B 逐项验证入口、直接访问 URL 和实际 API 范围。
4. **完成库存页面**：接现有库存接口，区分自身和直属下级；打通平台分配与伙伴转交，核对有效期、源持有关系、幂等和流水。
5. **完成客户、价格、订单、财务页面**：沿用后台组件，把真实操作接上；厘清原 C 端 `orders` 和代理 `tx_orders` 的对应关系，完成本地客户销售/服务权益交付所需的行为，不接真实上游。
6. **补报表与财务快照**：有可追溯的订单、归属、结算价之后再展示收入、成本、利润和服务排行；补全失败、重试和刷新行为。
7. **完成组件统一与交付核对**：把下级页面逐步迁到已有后台组件，再清理已无引用的旧样式。保留普通工作台、管理员后台及其他现有功能。

完成标准：

- 普通用户登录看不到代理入口，直接访问代理 API 也不能取得数据。
- 伙伴和下级默认先到普通工作台，入口能进入各自有权限的代理中心。
- 二级代理无法通过菜单、URL 或直接 API 请求创建三级代理或操作其他代理数据。
- 伙伴 A 看不到伙伴 B 的库存、客户和财务；下级 A1 看不到上级和兄弟代理数据。
- 平台分配、伙伴转交和客户服务使用的归属、期限、价格、订单、权益及流水可以相互核对；重复提交不重复分配或扣款。
- 今日卡片不随趋势周期变成七日/三十日数据；趋势包含当天，汇总可追溯。
- 已知零值、数据不可用和请求失败可区分；没有权威成本时不显示真实利润。
- 页面注册中仍为占位的功能必须在交付中明确标注，不以菜单齐全宣称业务完成。

## 8. 本次实际验证结果与后续命令

以下命令均在 `D:/llinepool/linepool-ui` 执行。仓库根目录 `D:/llinepool` 没有本应用的 `package.json`，从根目录直接运行应用 npm script 会出现 ENOENT。

| 本次执行 | 结果 | 说明 |
| --- | --- | --- |
| `npm run contracts:build` | 通过 | 最新共享契约可生成产物 |
| `npm run typecheck --workspace @linepool/react-backend` | 通过 | 后端 TypeScript 通过，不代表 SQL 或接口运行已验证 |
| `npm exec -- tsc --noEmit` | 失败 | `AgentSettlementTable.tsx:15` 两处 TS18048，准确报错见第 4 节 |

本次没有运行测试，没有启动服务进行浏览器验收，没有连接数据库进行接口/数据核对，也没有将旧版本的构建成功记录当作本版本通过。完整网站构建仍待前端类型错误修复后执行。

接手后按顺序运行：

```powershell
Set-Location D:/llinepool/linepool-ui
npm run contracts:build
npm run typecheck
npm run api:typecheck
npm run build:web
```

逐条检查退出码，失败后先解决原错误。`typecheck` 自带组件包构建和上游完整性检查，`build:web` 生成实际网站产物 `web-dist/`；仅 Vite 转译成功不能替代类型检查。遵循项目要求，不运行 `npm test` 或各类 `*:test` 命令。

需要本地业务核验时，先确认数据库、环境和当前已运行服务，再启动：

```powershell
Set-Location D:/llinepool/linepool-ui
npm run dev:all
```

默认前端 `http://127.0.0.1:5178`，API `http://127.0.0.1:3010`，以当前环境配置为准。HTTP 业务接口带 `/api` 前缀。认证使用服务端会话 Cookie，写请求要求匹配 `WEB_ORIGIN` 的 `Origin`；不要误改成 JWT 或因为缺 Cookie/Origin 就削弱守卫。

## 9. 工作区交接边界

- 工作区存在大量未提交修改与未跟踪文件，包含新前端、前期后端加固、密码找回、文档整理和其他任务。HEAD 不是完整交接内容。
- 接手前查看 `git status --short` 和相关文件 diff；不要 `reset --hard`、`clean`、切回旧分支或整文件覆盖他人实现。转交代码时必须包含需要的未跟踪文件。
- `src/vendor/**`、`public/**`、`upstream-lock.json` 是只读基线；业务前端修改放在 `src/linepool/**`，应用装配在现有入口按需调整。
- 本次交接仅新增本文并在应用文档索引增加入口；没有修复上述业务问题，没有提交 Git，也没有发布或操作真实服务。
- 本文和重构方案已能确定当前方向，接手人应从明确失败和已有实现继续，避免重新设计一套代理产品。

## 10. 可直接转交的任务说明

> 请继续处理 `D:/llinepool/linepool-ui` 的代理中心。先读 `AGENTS.md`、`docs/agent-center-handoff.md` 和 `docs/agent-portal-redesign-plan.md`。沿用现有 `AgentAdminShell` 和新前端，保持“普通工作台 → 条件显示代理中心”的产品方向。先修复 `AgentSettlementTable.tsx:15` 的 TS18048，再修复 `AgentInventory.dashboard()` 全平台库存统计、今日 KPI 与趋势日期问题，随后接入仍为占位的库存、价格、订单和财务页面并完善本地业务流程。核对一级伙伴和直属二级代理的实际关系，后端必须独立限制操作和数据范围。PC/PingCode 真实采购、同步、成本和支付继续暂缓；不得编造真实利润。遵循项目不运行测试的要求，进行类型检查、构建、源码完整性检查和必要的人工业务核验，明确报告未验收部分。保留工作区其他人已有修改及未跟踪文件。
