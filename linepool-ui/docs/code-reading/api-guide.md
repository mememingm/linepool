# LinePool 接口导读报告

整理日期：2026-11-02。依据：当前工作区源码。阅读目标：理解接口的用途、前后端怎样配合，以及开发时去哪里修改。

如果更喜欢直接对照代码阅读，先打开 [接口代码中文注释总目录](./api/README.md)：前端调用、共享契约、后端入口及业务均有完整注释副本。

本报告已核对前端调用、后端路由和主要数据约定；核对方式为静态源码检查。运行环境、登录状态和接口实际返回结果，需要在启动服务后另行验证。

## 1. 先认识项目里的接口

接口可以理解成前端向后端提出请求的入口。比如点击“查看订单”，前端发送查询请求，后端读取数据库，再返回订单数据。

一次调用主要看四样东西：

| 项目 | 中文含义 | 示例 |
| --- | --- | --- |
| Method | 请求方法，说明这次要查询还是执行操作 | `GET` 查询、`POST` 提交操作、`PATCH` 修改 |
| Path | 接口地址，说明找哪个功能 | `/api/admin/users` 查询后台用户列表 |
| Input | 请求携带的数据，说明具体要求 | 页码、搜索词、用户编号、新状态 |
| Response | 后端返回的数据，供页面继续处理和展示 | 用户列表、订单详情、操作结果 |

同一个地址配上不同方法，可以代表不同操作。例如 `/api/admin/products` 的 `GET` 用于查询商品列表，`POST` 用于新建商品，`PATCH` 用于编辑商品。

语言和工具：前端调用文件、后端入口和共享约定都使用 **TypeScript**。前端界面使用 React；后端使用 NestJS；Zod 负责数据检查；数据库由后端通过 PostgreSQL 连接访问。

## 2. 一次请求经过哪些文件

```text
页面：收集用户操作和输入
    ↓
client.ts：选择接口、检查输入、发送请求
    ↓
后端 Controller：匹配地址、检查登录/权限和参数
    ↓
业务处理类：执行查询、分配、保存、记账等操作
    ↓
数据库：读取或保存数据
    ↓
后端返回 JSON → client.ts 检查响应 → 页面展示或更新状态
```

| 文件或目录 | 中文职责 | 开发时什么时候看 |
| --- | --- | --- |
| [client.ts](../../src/linepool/api/client.ts) | 前端接口调用的集中封装 | 查页面调用哪个地址、提交什么、期待返回什么 |
| [query-client.ts](../../src/linepool/api/query-client.ts) | 工作台查询缓存和预加载 | 查部分页面的数据缓存、重新获取和登录后预加载 |
| [packages/contracts/src](../../packages/contracts/src) | 前后端共用的数据格式约定 | 查字段、可选值、默认值和检查规则 |
| [controllers.ts](../../backend/src/controllers.ts) | 登录、工作台、号码服务和健康检查的接口入口 | 查这些请求由哪个方法接收 |
| [admin-controller.ts](../../backend/src/admin-controller.ts) | 管理后台接口入口 | 查后台列表、用户管理、商品管理等操作 |
| [agent-inventory-controller.ts](../../backend/src/agent-inventory-controller.ts) | 代理库存业务接口入口 | 查代理、客户、号码库存、流转和结算 |
| [administration.ts](../../backend/src/administration.ts) | 管理后台的具体业务和数据库操作 | 查后台筛选逻辑、分配回收、商品保存 |
| [agent-inventory.ts](../../backend/src/agent-inventory.ts) | 代理库存的具体业务入口 | 查代理关系、持有记录、余额及相关业务 |
| [main.ts](../../backend/src/main.ts) | 后端启动与公共配置 | 查统一前缀、跨域、请求体限制和供应商注入 |

共享约定也分块：`admin.ts` 管后台数据；`agent-inventory.ts` 管代理库存数据；`number-services.ts` 管号码服务；`recharge.ts` 管充值；`index.ts` 还有登录、普通工作台及公共响应格式。前端的 `src/linepool/api/contracts.ts` 转发共享包的导出。

## 3. 怎样整体阅读 client.ts

这个文件主要有四块，先理解每块用途即可。

| 代码名字 | 中文含义 | 功能及这样组织的原因 |
| --- | --- | --- |
| `LinepoolApiError` | 项目接口错误 | 保存状态码、错误编号、说明和详情，让页面统一处理错误 |
| `createLinepoolApi` | 创建项目接口调用工具 | 集中设置服务地址和超时，返回各业务调用方法 |
| `request` | 统一发送请求的内部方法 | 共用 Cookie、JSON、超时、取消、错误处理和响应检查，减少重复代码 |
| `query` | 查询条件转地址参数 | 把页码、搜索词等变成地址中 `?` 后面的内容，统一处理编码 |
| 返回对象中的业务方法 | 页面可以直接调用的接口方法 | 如 `login` 登录、`adminList` 后台列表、`agentStock` 代理库存 |
| `LinepoolApi` | 接口调用工具的数据类型 | 让 TypeScript 提示有哪些方法，以及各方法怎么传参数 |

当前 `client.ts` 有 **84 个业务调用方法**；注册进后端应用的控制器中有 **89 条路由声明**。两种数量的统计口径不同：`adminList` 可查询多个后台板块，`adminSaveProduct` 可发送两种方法，三个后台详情调用共用一条后端通用路由，还有部分后端路由尚未在此文件封装。

### 地址和公共行为

- 基础地址依次采用：调用时的 `configuration.baseUrl` → `VITE_LINEPOOL_API_URL` → 默认 `/api`。
- 后端统一使用 `/api` 前缀。开发配置中，Vite 将 `/api` 转发给 `LINEPOOL_API_TARGET`，该目标默认是 `http://127.0.0.1:3010`。这些是源码默认配置，实际运行值取决于环境。
- 默认超时为 15 秒；号码批量操作的预览和执行方法分别设置为 120 秒。
- `request` 携带浏览器 Cookie；有请求体时按 JSON 发送。GET 查询条件由 `query` 拼进地址，忽略 `undefined` 和空字符串。
- 请求与响应都设置了不使用 HTTP 缓存的相关行为；工作台的 React Query 内存缓存单独管理，默认新鲜时间为 60 秒。
- `request` 本身没有自动重试循环；公共 QueryClient 的查询和修改也配置为不自动重试。其他业务重试应看各自实现。

## 4. 用“搜索后台用户”串起整条链

页面调用示意：

```ts
import { adminUserSchema } from '@linepool/contracts/admin';
import { createLinepoolApi } from './client';

const api = createLinepoolApi();
const result = await api.adminList('users', adminUserSchema, {
  page: 1,
  pageSize: 20,
  search: '张三',
});
```

上面的相对导入写法按与 `client.ts` 同目录的示例文件展示，实际页面应使用自己的相对路径。

这里的名字与用途：

| 名字 | 中文含义和功能 |
| --- | --- |
| `api` | 创建好的接口调用工具，页面通过它发请求 |
| `adminList` | 查询后台列表，根据 `users`、`orders` 等板块选择地址 |
| `adminQuerySchema` | 后台通用查询条件规则，检查和整理分页、搜索、筛选 |
| `adminUserSchema` | 后台用户返回数据规则，检查列表里的每一条用户数据 |
| `result.data` | 返回的用户列表 |
| `result.pagination` | 返回的页码、每页条数、总条数和总页数 |

这次查询会形成如下请求，实际地址中的中文会进行 URL 编码：

```text
GET /api/admin/users?page=1&pageSize=20&search=张三
```

处理过程：

1. `client.ts` 用 `adminQuerySchema` 检查和整理查询条件，然后通过 `request` 发送。
2. 后端 `AdminController` 检查登录和管理员身份，接收 `users` 板块及查询条件。
3. `Administration.list` 根据板块选择查询逻辑；用户搜索会匹配显示名称、邮箱或用户编号。
4. 数据库返回结果，后端组装 `data` 和 `pagination`。
5. 前端按 `adminUserSchema` 等约定检查响应，把结果交给页面。

如果改的是“用户列表多显示一个字段”，通常需要核对：后端查询有没有返回该字段、`adminUserSchema` 有没有约定该字段、页面有没有展示。前端字段名与后端返回值需要一致。

## 5. 输入和返回格式去哪里看

请求输入主要有三种位置：

| 位置 | 用途 | 示例 |
| --- | --- | --- |
| Path 参数 | 指定操作对象 | `/admin/users/:id` 中的用户编号 |
| Query 参数 | 指定查询条件 | `?page=1&search=张三` |
| JSON Body | 提交操作内容 | 修改用户状态时提交 `status` 和 `reason` |

共享约定定义字段和格式；前端常通过 `.parse(...)` 先检查输入。后端的 `SchemaPipe` 会再次检查收到的数据，格式错误返回 `400 / VALIDATION_ERROR`。检查失败发生在哪一层，要看浏览器 Network 中有没有真正发出请求。

常见响应形状如下，具体业务字段继续查对应 schema。

普通操作结果示例：

```json
{
  "data": {
    "changed": true
  }
}
```

分页列表的空结果示例，字段名采用当前公共约定：

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 0,
    "totalPages": 0
  }
}
```

后台权限错误示例：

```json
{
  "error": {
    "code": "ADMIN_REQUIRED",
    "message": "Platform administrator access is required"
  }
}
```

部分业务响应还有额外字段。例如统一库存列表同时返回 `counts`（库存统计），积分接口和账本接口也有各自结构；具体以调用方法传给 `request` 的响应规则为准。

## 6. 登录、权限和错误怎么看

### 登录和权限

登录成功后，后端设置名为 `linepool_react_session` 的会话 Cookie。前端请求配置了 `credentials: 'include'`，浏览器据此在适用的 Cookie 规则下携带会话。Cookie 配置为 HttpOnly、SameSite=Lax，生产环境还要求 Secure。

普通受保护接口使用 `SessionGuard` 检查登录；管理后台还使用 `AdminGuard` 检查管理员身份。代理库存接口还要在业务层核对代理身份、层级和资源归属，登录成功只是进入业务检查的前提。

后端对普通写请求还检查 `Origin` 是否等于配置的 `WEB_ORIGIN`；签名回调使用专门的签名校验流程。手工调接口遇到 `ORIGIN_REJECTED` 时，应核对请求来源和环境配置。

### 常见错误定位

| 现象或错误 | 含义 | 优先检查 |
| --- | --- | --- |
| 操作后没有对应网络请求，出现 Zod 校验错误 | 前端在发送前检查输入失败 | 方法要求的参数和输入 schema |
| `400 / VALIDATION_ERROR` | 后端认为参数格式不符合约定 | Path、Query、Body 字段及 `details` |
| HTTP 401 | 登录会话无效，或回调签名未通过等身份校验问题 | 结合错误编号检查 Cookie 或签名流程 |
| `403 / ADMIN_REQUIRED` | 当前身份没有后台管理员权限 | 用户角色和访问的接口 |
| `403 / ORIGIN_REJECTED` | 写请求的来源不符合配置 | `Origin` 和 `WEB_ORIGIN` |
| HTTP 404 | 地址不存在、对象不存在或功能未开放等 | URL、对象编号、功能开关和错误编号 |
| HTTP 409 | 当前业务状态不允许操作 | 余额、归属、资源占用、版本或幂等冲突等具体错误 |
| `429 / RATE_LIMITED` | 请求触发限流 | 操作频率、页面是否重复提交 |
| `INVALID_RESPONSE` | HTTP 请求成功，但返回结构不符合前端约定 | 后端返回字段与前端响应 schema |
| `REQUEST_TIMEOUT` | 前端设定的等待时间已到 | 服务响应时间；批量操作是否使用对应方法 |
| `NETWORK_ERROR` | 请求或读取响应时发生了未归类的连接等异常 | 后端、代理、跨域及浏览器网络面板 |
| `DATABASE_UNAVAILABLE` | 后端识别到数据库连接不可用 | 数据库状态和后端日志 |

`LinepoolApiError` 保存 `status`、`code`、`message`、`details`，页面可据此展示或处理错误。主动取消请求会保留取消异常，不统一转换为网络错误。

## 7. 业务调用速查表

下表覆盖当前 `client.ts` 的 84 个业务方法。地址统一省略 `/api` 前缀，`:id` 等表示运行时填入的编号；查询参数需到对应方法和 schema 中查看。

### 7.1 登录与身份：6 个方法

| 前端方法 | 请求 | 中文用途 |
| --- | --- | --- |
| `login` | POST `/auth/login` | 登录并建立会话 |
| `register` | POST `/auth/register` | 注册账号 |
| `forgotPassword` | POST `/auth/forgot-password` | 提交找回密码请求 |
| `resetPassword` | POST `/auth/reset-password` | 使用重置凭据设置新密码 |
| `me` | GET `/auth/me` | 获取当前登录用户 |
| `logout` | POST `/auth/logout` | 退出登录 |

### 7.2 工作台与账户：9 个方法

| 前端方法 | 请求 | 中文用途 |
| --- | --- | --- |
| `catalog` | GET `/catalog` | 查询可购买的目录 |
| `dashboard` | GET `/dashboard` | 查询工作台汇总 |
| `dashboardOverview` | GET `/dashboard/overview` | 查询工作台概览 |
| `account` | GET `/account` | 查询账户资料和相关状态 |
| `updateProfile` | PATCH `/account/profile` | 修改账户资料 |
| `preferences` | PATCH `/account/preferences` | 修改到期提醒偏好 |
| `points` | GET `/points` | 查询积分信息和记录 |
| `rechargeOverview` | GET `/account/recharge` | 查询充值概览 |
| `rechargeRecords` | GET `/account/recharge/records` | 查询充值记录 |

### 7.3 号码、订单和短信：10 个方法

| 前端方法 | 请求 | 中文用途 |
| --- | --- | --- |
| `numbers` | GET `/numbers` | 查询当前用户的号码列表 |
| `renewalOptions` | GET `/numbers/:id/renewal-options` | 查询号码续期选项 |
| `renewals` | GET `/numbers/:id/renewals` | 查询号码续期记录 |
| `createRenewal` | POST `/numbers/:id/renewals` | 提交号码续期请求 |
| `numberUsage` | GET `/numbers/:id/usage` | 查询号码使用情况 |
| `orders` | GET `/orders` | 查询当前用户的订单列表 |
| `order` | GET `/orders/:id` | 查询订单详情 |
| `createOrder` | POST `/orders` | 提交购买订单 |
| `inbox` | GET `/inbox` | 查询短信收件箱 |
| `markRead` | POST `/inbox/read` | 将指定短信标记为已读 |

### 7.4 管理后台：16 个方法

| 前端方法 | 请求 | 中文用途 |
| --- | --- | --- |
| `adminSession` | GET `/admin/session` | 确认后台会话和管理员身份 |
| `adminSummary` | GET `/admin/summary` | 查询后台首页统计 |
| `adminList` | GET `/admin/:section` | 查询用户、号码、商品、订单、审计、项目或回执列表 |
| `adminUser` | GET `/admin/users/:id` | 查询用户详情及关联号码、订单 |
| `adminNumber` | GET `/admin/numbers/:id` | 查询号码详情和分配记录 |
| `adminOrder` | GET `/admin/orders/:id` | 查询订单详情和分配记录 |
| `adminResetPassword` | POST `/admin/users/:id/reset-password` | 管理员重置用户密码 |
| `adminUserStatus` | PATCH `/admin/users/:id/status` | 启用或停用用户 |
| `adminNumberAction` | POST `/admin/numbers/:id/actions` | 分配、回收或设置号码可售状态 |
| `adminProductOptions` | GET `/admin/product-options` | 查询上游有资源的商品组合 |
| `adminSyncProducts` | POST `/admin/products/sync` | 按上游组合补建缺少的商品草稿 |
| `adminSaveProduct` | POST 或 PATCH `/admin/products` | 新建或编辑商品 |
| `adminUpstreamStatus` | GET `/admin/integrations/pingcode` | 查询上游接入配置和回执处理统计 |
| `adminRetryWebhook` | POST `/admin/integrations/pingcode/retry` | 重试处理指定短信回执 |
| `adminRechargeSettings` | GET `/admin/recharge-settings` | 查询充值规则配置 |
| `adminSaveRechargeSettings` | PATCH `/admin/recharge-settings` | 保存充值规则配置 |

`section` 的允许值为 `users / numbers / products / orders / audit / projects / receipts`，分别对应用户、号码、商品、订单、审计、上游项目和短信回执。订单查询会使用专用规则整理旧链接条件。

### 7.5 代理身份、下级和客户：16 个方法

以下地址均以 `/agent-inventory` 开头，表中省略这一段。

| 前端方法 | 请求 | 中文用途 |
| --- | --- | --- |
| `agentContext` | GET `/context` | 查询当前代理业务身份和上下文 |
| `agentUpdateProfile` | PATCH `/profile` | 修改当前代理资料 |
| `agentDashboard` | GET `/dashboard` | 查询代理业务概览 |
| `agentAgents` | GET `/agents` | 查询可见代理列表 |
| `agentCreateAgent` | POST `/agents` | 创建代理 |
| `agentSubagents` | GET `/subagents` | 查询下级代理列表 |
| `agentSubagent` | GET `/subagents/:id` | 查询下级代理详情 |
| `agentCreateSubagent` | POST `/subagents` | 创建下级代理 |
| `agentRenameSubagent` | PATCH `/subagents/:id/name` | 修改下级代理名称 |
| `agentSubagentStatus` | PATCH `/subagents/:id/status` | 修改下级代理状态 |
| `agentSubagentHoldings` | GET `/subagents/:id/holdings` | 查询下级代理相关持有记录 |
| `agentSubagentTransactions` | GET `/subagents/:id/transactions` | 查询下级代理交易记录 |
| `agentCustomers` | GET `/customers` | 查询客户列表 |
| `agentCreateCustomer` | POST `/customers` | 创建客户 |
| `agentUpdateCustomer` | PATCH `/customers/:id` | 修改客户资料 |
| `agentCustomerHoldings` | GET `/customers/:id/holdings` | 查询客户持有的号码 |

### 7.6 统一库存与号码流转：12 个方法

以下地址均以 `/agent-inventory` 开头。`stock` 表示统一库存中的号码资源，`holding` 表示号码的持有记录。

| 前端方法 | 请求 | 中文用途 |
| --- | --- | --- |
| `agentStock` | GET `/stock` | 查询统一号码库存和库存统计 |
| `agentImportStock` | POST `/stock/import` | 导入号码库存 |
| `agentClaimStock` | POST `/stock/claim` | 领用单个库存号码 |
| `agentClaimStockBatch` | POST `/stock/claim-batch` | 批量领用库存号码 |
| `agentHoldings` | GET `/holdings` | 查询持有记录 |
| `agentTransferableHoldings` | GET `/transferable-holdings` | 查询可转移的持有记录 |
| `agentCreateHolding` | POST `/holdings` | 创建持有记录 |
| `agentReleaseHolding` | POST `/holdings/:id/release` | 释放持有记录并回收库存 |
| `agentAssignHoldingToCustomer` | POST `/holdings/assign-customer` | 将号码分配给客户 |
| `agentResellHolding` | POST `/holdings/resell` | 转售号码持有记录 |
| `agentHoldingBatchPreview` | POST `/holdings/batch-preview` | 预览批量流转的选择和结果 |
| `agentTransferHoldingBatch` | POST `/holdings/batch-transfer` | 执行批量流转 |

### 7.7 代理报价、余额和结算：11 个方法

以下地址均以 `/agent-inventory` 开头。

| 前端方法 | 请求 | 中文用途 |
| --- | --- | --- |
| `agentBalances` | GET `/balances` | 查询可见余额账户 |
| `agentLedger` | GET `/ledger/:ownerType/:ownerId` | 查询代理或客户的账本 |
| `agentTransactions` | GET `/transactions` | 查询交易记录 |
| `agentSettlementOrder` | GET `/transactions/:id` | 查询结算交易详情 |
| `agentSettlementPreview` | POST `/settlement-preview` | 预览结算报价 |
| `agentPlatformSettlement` | GET `/platform-settlement` | 查询平台结算汇总 |
| `agentPriceOptions` | GET `/price-options` | 查询价格配置可用的平台和地区 |
| `agentPrices` | GET `/prices` | 查询价格规则 |
| `agentSavePrice` | POST `/prices` | 保存价格规则 |
| `agentTransfer` | POST `/transfers` | 提交余额转账 |
| `adminAdjustBalance` | POST `/balance-adjustments` | 管理员调整余额 |

商城积分字段和代理账务的货币金额字段采用不同约定。展示和计算前应查对应 schema 的单位，例如 `unit_points` 表示积分，而 `balanceMinor` 表示相应币种的最小货币单位余额。

### 7.8 本地沙盒：4 个方法

| 前端方法 | 请求 | 中文用途 |
| --- | --- | --- |
| `sandboxStatus` | GET `/sandbox` | 查询本地沙盒是否开放 |
| `sandboxCredit` | POST `/sandbox/credit` | 执行本地沙盒积分操作 |
| `sandboxFulfill` | POST `/sandbox/fulfill` | 模拟订单履行结果 |
| `sandboxInbound` | POST `/sandbox/inbound` | 模拟接收短信结果 |

源码要求非生产环境且 `LOCAL_SANDBOX=true` 才启用沙盒。功能关闭时相关请求会返回 404。

## 8. 后端已有、client.ts 尚未封装的入口

下表列出当前后端存在，但上述 84 个方法中没有对应调用封装的路由。此处统一写完整 `/api` 前缀。

| 后端路由 | 用途 | 定义位置 |
| --- | --- | --- |
| GET `/api/health` | 检查后端和数据库连接 | `controllers.ts` |
| GET `/api/admin/recharges` | 管理员查询充值记录 | `admin-controller.ts` |
| POST `/api/account/recharge/orders` | 创建充值订单 | `recharge.ts` |
| PATCH `/api/agent-inventory/agents/:agentId/status` | 修改代理状态 | `agent-inventory-controller.ts` |
| POST `/api/agent-inventory/orders` | 创建代理业务交易订单 | `agent-inventory-controller.ts` |
| POST `/api/webhooks/pingcode` | 接收上游短信事件回调 | `providers/pingcode-webhook.ts` |

上游回调由供应商向后端推送数据，与页面调用后端的入口方向不同。当前回调实现校验签名、时间戳和事件编号；其注释注明协议还需上游确认。

当前 `main.ts` 注入模拟号码服务和模拟接收供应商，接入状态中的 `providerTransport` 也固定为 `mock`。充值下单代码返回 `paymentStatus: 'not_connected'`。这些源码边界说明：真实供应商和真实支付链路仍需单独接入、确认和验证。

## 9. 开发时按需求找位置

| 要改的需求 | 推荐查阅顺序 |
| --- | --- |
| 页面多显示一个字段 | 页面 → 对应响应 schema → 后端返回字段 |
| 列表增加搜索或筛选 | 页面输入 → `client.ts` 查询参数 → 查询 schema → 后端筛选逻辑 |
| 新增一个操作按钮 | 页面 → 输入/结果 schema → 前端调用方法 → Controller → 业务处理 |
| 调整参数限制或默认值 | 对应共享 schema → 前后端使用位置 → 页面提示和业务限制 |
| 改登录状态或权限 | `authentication.ts`、对应 Guard 和业务层归属检查 |
| 改地址或开发代理 | `createLinepoolApi` 配置、Vite 代理、后端端口与 `/api` 前缀 |
| 排查按钮点击后失败 | 浏览器 Network → 请求方法/地址/参数 → 响应 code/details → 后端处理及日志 |

阅读单个调用方法时，先找“中文用途、方法、地址、输入规则、返回规则”这五项；需要修改对应逻辑时，再深入具体表达式。

可搭配阅读：[admin.ts 中文分区注释副本](./admin.annotated.ts)。该副本按完整代码顺序说明后台查询、管理员操作、返回数据、上游接入、汇总和商品同步。

## 10. 怎样修改具体值：以 7/30 天改为 14/60 天为例

这一节按“改哪里 → 改成什么 → 哪些地方要跟着改”来读。下面都是修改示例，当前业务仍保持 7/30 天。

### 10.1 先找到真正生效的文件

实际要修改的是 [packages/contracts/src/admin.ts](../../packages/contracts/src/admin.ts)：

```ts
export const serviceDurationSchema = z.union([z.literal(7), z.literal(30)]);
```

这段是 **TypeScript**，其中 `z` 来自 Zod 数据检查工具包。`serviceDurationSchema` 的中文意思是“服务时长检查规则”，功能是规定管理员分配号码、创建或编辑商品时，允许提交哪些服务天数。

`z.literal(7)` 表示“只允许数字 7”；`z.union([...])` 表示“这些选项中任意一个都可以”。因此，修改括号里的数字，就改变了这条规则接受的天数。

**如果想取消 7/30 天，只允许 14 天或 60 天，把这一整行替换为：**

```ts
export const serviceDurationSchema = z.union([z.literal(14), z.literal(60)]);
```

这里允许的是 **14、60 两个准确值**，28 天不符合规则；也不是允许 14～60 天的所有数字。此处写数字 `14`、`60`，不是文字 `'14'`、`'60'`。

**如果想保留 7/30 天，再新增 14/60 天，则替换为：**

```ts
export const serviceDurationSchema = z.union([
  z.literal(7),
  z.literal(14),
  z.literal(30),
  z.literal(60),
]);
```

这两种方案选一种。只修改 [admin.annotated.ts](./admin.annotated.ts) 这份导读副本，应用不会生效；它是阅读资料，业务使用上面的原文件。

### 10.2 允许的值、默认值、实际数据分别在哪里

| 你真正想做的事 | 应该改什么 |
| --- | --- |
| 允许提交 14/60 天 | `serviceDurationSchema`，以及对应后端业务的额外限制 |
| 下拉框出现“14 天 / 60 天” | 页面下拉选项及提交时的值转换 |
| 打开表单默认选择 60 天 | 页面状态的初始值；允许 60 天并不会自动默认选择它 |
| 某个商品变成 60 天、卖 25 积分 | 后台商品数据；规则变化不会自动改商品记录 |
| 普通用户能看到并购买 14/60 天商品 | 商品配置、目录查询、购买页面筛选和后端下单限制 |

先确认自己要改到哪一步，就能避免漏改，也能避免扩大修改范围。

### 10.3 后台页面需要同步哪些地方

打开 [AdminShell.tsx](../../src/linepool/admin/AdminShell.tsx)，重点找两个功能：`ConfirmAction`（管理操作确认弹窗）和 `ProductEditor`（商品编辑表单）。

以“只保留 14/60 天，默认选 60 天”为例：

| 位置或搜索词 | 当前写法/行为 | 修改方向 |
| --- | --- | --- |
| `const [days, setDays]` | `useState('30')` | 改为 `useState('60')`，调整手动分配的默认选择 |
| `分配服务天数` | 下拉选项为 `'7'`、`'30'` | 改为 `'14'`、`'60'`，显示文字也改成“14 天”“60 天” |
| `adminNumberAction` | `days === '7' ? 7 : 30` | 改为 `days === '14' ? 14 : 60`，让提交值和选项一致 |
| `ProductEditor` 的新建初始值 | `durationDays: 30` | 改为 `durationDays: 60` |
| `商品服务天数` | 下拉选项及 `v === '7' ? 7 : 30` | 同步改选项和转换；只改显示文字，提交的仍可能是旧值 |
| `product.duration_days === 7 ? 7 : 30` | 编辑商品时，把非 7 天的记录都回填为 30 天 | 重新处理新旧期限的回填，避免把已有商品静默换成其他天数 |
| `defaultPlan` | 7 天默认代号 `week`，其他默认 `month` | 新套餐可使用 `p14d` / `p60d`；编辑旧商品时保留并核对已有代号 |
| `原商品为` | 提示保存时使用 7/30 天 | 同步修改提示及判断条件 |

页面下拉框的 `value` 当前使用文字，所以这里仍写 `'14'`、`'60'`；接口字段 `durationDays` 需要数字，所以提交时再转换。

如果是**四种期限都保留**，就不能继续用“选 7，否则全部算 30”这种二选一写法。可以在页面现有的共享契约导入中加入 `serviceDurationSchema`，提交时使用：

```ts
// days 是下拉框选中的文字，例如 '60'。
// Number 转为数字，parse 按共享规则检查，得到实际选择的天数。
durationDays: serviceDurationSchema.parse(Number(days))
```

商品下拉框也可采用同样思路：

```ts
onValueChange={v => set('durationDays', serviceDurationSchema.parse(Number(v)))}
```

这两个片段分别放在原有请求对象和组件属性的位置，配合四个下拉选项使用。旧商品回填也要按允许值处理，不能保留原来把所有非 7 天归为 30 天的逻辑。

### 10.4 后端和前台还有哪些关联限制

下面这些位置是从当前源码中查到的。按自己的修改范围查看，不必把所有出现的数字都替换掉。

| 修改范围 | 文件与定位关键词 | 需要同步的内容 |
| --- | --- | --- |
| 后台手动分配 | [administration.ts](../../backend/src/administration.ts) → `INVALID_DURATION` | 后端还单独检查 `[7,30]`，并提示 `Choose 7 or 30 days`；仅替换期限时改为 `[14,60]`，同时更新提示 |
| 使用“同步商品”补建新套餐 | 同文件 → `syncProducts` | `['week', 7, 10]`、`['month', 30, 20]` 分别是“套餐代号、天数、兜底积分价”；天数和代号要对应新套餐，价格另行确定 |
| 后台可售状态、筛选与库存统计 | 同文件 → `availableStock('7')` | 当前按至少满足 7 天服务的库存条件判断；若最短套餐改为 14 天，需核对相关门槛与统计口径 |
| 普通用户的商品目录 | [workspace.ts](../../backend/src/workspace.ts) → `duration_days IN (7,30)` | `catalog()` 的三处查询都有限期筛选；只保留新期限时改为 `IN (14,60)`，新增时保留四种 |
| 普通用户下单 | [ordering.ts](../../backend/src/ordering.ts) → `duration_days IN (7,30)` | 下单查询也限制天数，需与目录一致，否则能看到商品仍可能下单失败 |
| 普通用户购买页面 | [PurchasePage.tsx](../../src/linepool/workspace-reference/PurchasePage.tsx) → `[7, 30].includes`、`durationDays === 30` | 修改可选套餐筛选，以及两处优先选择 30 天的默认逻辑；需要默认 60 天时改为优先 60 天 |
| 首页宣传与翻译 | [HomePage.tsx](../../src/linepool/home/HomePage.tsx)、[后台翻译](../../src/linepool/i18n/admin-messages.ts)、[欢迎页翻译](../../src/linepool/welcome/reference/messages.ts) | 核对相关套餐、价格与提示文字，避免页面仍宣传旧套餐 |

例如后端手动分配的检查，可由：

```ts
if (![7,30].includes(input.durationDays)) {
  throw new ApiFailure(400, 'INVALID_DURATION', 'Choose 7 or 30 days');
}
```

改为：

```ts
if (![14,60].includes(input.durationDays)) {
  throw new ApiFailure(400, 'INVALID_DURATION', 'Choose 14 or 60 days');
}
```

如果保留四种期限，则数组与提示都写四种。**只想支持后台手动分配时，先完成共享规则、分配表单和分配业务的修改；由于共享规则也供商品编辑使用，商品表单仍需保持兼容。要同时开放前台购买，再处理目录、下单和购买页面。**

### 10.5 数据库已有数据会怎样

改规则不会把数据库里原来的 7 天商品变成 14 天，也不会把 30 天商品变成 60 天。已有订单、号码分配的到期时间和价格也不会随之改变。

实际启用前，需要决定：旧套餐是否继续卖、是否新增 14/60 天商品、新套餐叫什么、售价多少。新增商品可用独立代号 `p14d`、`p60d`，避免和旧 `week` / `month` 商品混用；不要因为换期限就推断价格一定翻倍。

从迁移源码看，商品和订单的天数限制是 1～365，14/60 在范围内；[004_platform_admin.sql](../../backend/db/migrations/004_platform_admin.sql) 已放开原有 `week` / `month` 代号限制，允许符合格式的新代号。**这里核对的是源码，没有连接数据库确认实际迁移状态。**

另外，[014_core_sync_recharge_inventory.sql](../../backend/db/migrations/014_core_sync_recharge_inventory.sql) 中的 `number_platform_inventory` 视图按 7/30 天生成库存维度。当前未在 `backend/src` 找到直接查询该视图的代码，可作为额外核对项；如果实际使用它且需要新期限，应新增迁移调整视图，不要只修改已经执行过的旧迁移文件。

### 10.6 其他常见值，应该怎样改

| 想修改的内容 | 修改示例 | 实际影响与需要留意的地方 |
| --- | --- | --- |
| 搜索词最多 200 字改为 300 字 | 原 `admin.ts` 中，`search` 的 `.max(200)` → `.max(300)` | 调整搜索输入检查；若页面也有长度限制，需要同步 |
| 操作理由最少 3 字改为 5 字 | `reasonSchema` 的 `.min(3)` → `.min(5)` | 所有复用这条规则的管理操作都受影响，也要核对页面限制和提示 |
| 默认每页 20 条改为 50 条 | [primitives.ts](../../packages/contracts/src/primitives.ts) 中，`pageSize` 的 `.default(20)` → `.default(50)` | 只有没传 `pageSize` 时才补默认；页面明确传 20 的调用仍是 20，需按目标同步页面 |
| 某商品售价改为 25 积分 | 后台编辑该商品的价格，保存为 25 | 修改商品数据；不是把 `unitPoints` 的 `.max(1000000)` 改成 25 |
| 新建商品预填价从 15 改为 25 积分 | `AdminShell.tsx` → `ProductEditor` 新建初始值的 `unitPoints: 15` → `unitPoints: 25` | 只影响新建表单预填值，不改变已有商品，也不改变同步商品的兜底价 |
| 允许的积分单价上限改为 200 万 | 原 `admin.ts` 中，`unitPoints` 的 `.max(1000000)` → `.max(2000000)` | 只放宽输入上限，需同步商品价格输入框的 `max`；实际售价仍由商品记录决定 |
| 接口默认等待 15 秒改为 30 秒 | [client.ts](../../src/linepool/api/client.ts) 中，`configuration.timeoutMs ?? 15000` → `configuration.timeoutMs ?? 30000` | 单位是毫秒；调用方显式配置的值优先，两个批量方法单独指定的 120000 也不会随之变化 |

续期选项也有自己的规则：[number-services.ts](../../packages/contracts/src/number-services.ts) 允许 1～365 天，而当前模拟供应商 [number-service-provider.ts](../../backend/src/number-service-provider.ts) 单独提供 7/30 天选项。改 `serviceDurationSchema` 不会自动更改模拟选项。**实际业务 [backend/src/number-services.ts](../../backend/src/number-services.ts) 的 `options/create` 当前返回 `RENEWAL_DISABLED`，不会调用模拟提供器开放续期；修改这些天数也不会自动启用续期接口。**

统计中的 `7d/30d`、代理报价中的“每 30 天价格”，分别代表统计周期和计价基准，不能因为修改套餐期限就全局替换所有 `7` 和 `30`。

### 10.7 真正修改业务后，怎样确认生效

按“共享规则 → 页面选项和提交值 → 后端限制 → 商品配置与前台购买”的顺序修改。共享包通过编译后的 `dist` 导出，修改源码后需要重新构建或保持监听构建运行。

在项目根目录可运行以下检查命令；它会构建相关产物并检查类型：

```powershell
npm run typecheck:all
```

确认前后端加载了新构建结果后，重新打开相关表单，在浏览器 Network 中核对请求的 `durationDays` 是否真的是数字 `14` / `60`。商品价格、目录显示、分配到期时间和下单结果按实际修改范围另行核对。按本项目约定，不运行测试。

本次仅补充导读资料，未执行上述业务变更，也未连接数据库修改数据。
