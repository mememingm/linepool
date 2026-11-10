# 接口代码中文分区导读

整理日期：2026-11-02。这里把当前项目的接口相关 TypeScript 代码复制成了中文注释版，风格沿用 [admin.annotated.ts](../admin.annotated.ts)：先说明整体用途、英文名字和为什么这样组织，再按功能块读代码，并提示改值时要同步哪些位置。

**共 46 份完整源码副本：前端接口 3 份、共享数据契约 7 份、后端入口及配套业务 36 份。** 覆盖 `src/linepool/api/*.ts`、`packages/contracts/src/*.ts`、`backend/src/**/*.ts`。页面组件、数据库迁移和运维脚本作为相关修改位置引用，不在这次复制范围中。

副本保留原代码和声明顺序，仅增加注释并把相对导入调整为指向原源码。它们不参与应用构建或运行；实际修改功能时，进入每份副本顶部标出的“原文件”。不要执行启动文件的阅读副本或把副本导入应用。源码以后变化时，需要同步阅读资料。

## 1. 推荐先读这五份

不必从头读完全部文件。先看一条请求怎样经过前后端，再按正在开发的功能找对应方法。

| 顺序 | 注释版 | 先理解什么 |
| --- | --- | --- |
| 1 | [client.annotated.ts](./frontend/client.annotated.ts) | 页面怎样发请求；`request` 统一处理 Cookie、超时、错误和返回格式，84 个业务方法分别做什么 |
| 2 | [contracts/index.annotated.ts](./contracts/index.annotated.ts) | 前后端约定传哪些字段、允许哪些值、返回什么；schema 是检查规则，Input 是提交数据 |
| 3 | [controllers.annotated.ts](./backend/controllers.annotated.ts) | 后端怎样根据 GET/POST/PATCH 和网址找到对应方法，再交给业务处理 |
| 4 | [workspace.annotated.ts](./backend/workspace.annotated.ts) | 怎样按用户归属查询数据库，再整理成页面需要的字段 |
| 5 | [number-service-provider.annotated.ts](./backend/number-service-provider.annotated.ts) | 结合你刚看的例子，理解“能力约定、模拟实现、日期计算”和实际接口是否启用 |

例如“查看我的号码”：

```text
页面调用 api.numbers(...)
  → client.ts：整理查询条件，发送 GET /api/numbers
  → contracts/index.ts：numbersQuerySchema 规定输入格式
  → controllers.ts：SessionGuard 检查登录，numbers 方法接收请求
  → workspace.ts：只查询当前用户的号码分配
  → 数据库 → 返回号码资料与分页
  → client.ts：检查返回格式 → 页面展示
```

“读取字段/传字段”的约定在契约中；“这个人能不能操作、实际扣多少、库存是否足够”还要看后端业务。详细接口清单和具体改值示例见 [接口导读报告](../api-guide.md)。

## 2. 按正在做的功能查

| 你正在看或修改的功能 | 推荐阅读链 |
| --- | --- |
| 登录、注册、会话 | [前端调用](./frontend/client.annotated.ts) → [普通契约](./contracts/index.annotated.ts) → [普通入口](./backend/controllers.annotated.ts) → [认证业务](./backend/authentication.annotated.ts) |
| 忘记密码、邮件重置 | [普通契约](./contracts/index.annotated.ts) → [普通入口](./backend/controllers.annotated.ts) → [密码找回业务](./backend/password-recovery.annotated.ts) |
| 商品目录、购买、扣积分 | [普通契约](./contracts/index.annotated.ts) → [目录查询](./backend/workspace.annotated.ts) → [下单业务](./backend/ordering.annotated.ts) → [模拟号码预留/分配](./backend/providers/mock-receiving-provider.annotated.ts) |
| 后台用户、号码、商品 | [后台契约](../admin.annotated.ts) → [后台入口](./backend/admin-controller.annotated.ts) → [后台业务](./backend/administration.annotated.ts) |
| 号码用量、续期相关 | [号码服务契约](./contracts/number-services.annotated.ts) → [号码服务业务](./backend/number-services.annotated.ts) → [号码服务模拟提供器](./backend/number-service-provider.annotated.ts) |
| 代理、下级和客户 | [代理契约](./contracts/agent-inventory.annotated.ts) → [代理入口](./backend/agent-inventory-controller.annotated.ts) → [代理业务](./backend/agent-inventory.annotated.ts) |
| 代理库存、号码流转 | [统一库存](./backend/unified-agent-stock.annotated.ts) → [代理业务](./backend/agent-inventory.annotated.ts) → [批量流转](./backend/holding-batch.annotated.ts) |
| 代理价格、报价、余额 | [代理契约](./contracts/agent-inventory.annotated.ts) → [代理业务](./backend/agent-inventory.annotated.ts) → [结算计算](./backend/agent-settlement.annotated.ts) |
| 充值规则、金额和记录 | [充值契约](./contracts/recharge.annotated.ts) → [充值业务及入口](./backend/recharge.annotated.ts) |
| 上游短信回调和重试 | [回调入口](./backend/providers/pingcode-webhook.annotated.ts) → [回执收件箱](./backend/providers/webhook-inbox.annotated.ts) → [后台接入状态](./backend/upstream-integration.annotated.ts) |
| 接口错误、跨域、端口、限流 | [公共 HTTP 处理](./backend/http.annotated.ts) → [启动配置](./backend/main.annotated.ts) → [环境规则](./backend/environment.annotated.ts) → [限流身份](./backend/business-throttler.annotated.ts) |

## 3. 全部注释副本目录

### 前端：调用接口与缓存

| 注释副本 | 原文件 | 中文用途 |
| --- | --- | --- |
| [client](./frontend/client.annotated.ts) | `src/linepool/api/client.ts` | 84 个业务调用方法、统一发送请求及错误处理 |
| [contracts](./frontend/contracts.annotated.ts) | `src/linepool/api/contracts.ts` | 转发共享契约，兼容原前端导入路径 |
| [query-client](./frontend/query-client.annotated.ts) | `src/linepool/api/query-client.ts` | 查询缓存、登录后预加载 |

### 共享契约：请求与返回的数据约定

| 注释副本 | 原文件 | 中文用途 |
| --- | --- | --- |
| [primitives](./contracts/primitives.annotated.ts) | `packages/contracts/src/primitives.ts` | 密码、编号、国家、平台及分页基础规则 |
| [index](./contracts/index.annotated.ts) | `packages/contracts/src/index.ts` | 登录、账户、商城、号码、短信和积分 |
| [admin](../admin.annotated.ts) | `packages/contracts/src/admin.ts` | 后台管理查询、操作与返回数据；保留已有修改示例 |
| [number-services](./contracts/number-services.annotated.ts) | `packages/contracts/src/number-services.ts` | 续期选项、续期记录、用量场景 |
| [agent-inventory](./contracts/agent-inventory.annotated.ts) | `packages/contracts/src/agent-inventory.ts` | 代理、客户、库存、流转、价格和结算 |
| [recharge](./contracts/recharge.annotated.ts) | `packages/contracts/src/recharge.ts` | 充值规则、精确金额与积分换算 |
| [platform-catalog](./contracts/platform-catalog.annotated.ts) | `packages/contracts/src/platform-catalog.ts` | 品牌展示目录；不代表已接入或有库存 |

### 后端：请求入口与业务处理

下表原文件均位于 `backend/src/`。

| 注释副本 | 原文件 | 中文用途 |
| --- | --- | --- |
| [controllers](./backend/controllers.annotated.ts) | `controllers.ts` | 普通用户、号码服务、认证与健康检查入口 |
| [admin-controller](./backend/admin-controller.annotated.ts) | `admin-controller.ts` | 管理后台接口入口 |
| [agent-inventory-controller](./backend/agent-inventory-controller.annotated.ts) | `agent-inventory-controller.ts` | 代理库存接口入口 |
| [authentication](./backend/authentication.annotated.ts) | `authentication.ts` | 登录、注册、会话、资料修改、登录守卫 |
| [password-recovery](./backend/password-recovery.annotated.ts) | `password-recovery.ts` | 重置令牌、邮件投递、密码重置 |
| [workspace](./backend/workspace.annotated.ts) | `workspace.ts` | 普通工作台查询、分页、字段转换 |
| [ordering](./backend/ordering.annotated.ts) | `ordering.ts` | 商品检查、号码预留、下单、积分扣减 |
| [administration](./backend/administration.annotated.ts) | `administration.ts` | 后台管理业务与审计 |
| [number-services](./backend/number-services.annotated.ts) | `number-services.ts` | 号码归属、用量、续期历史及禁用边界 |
| [number-service-provider](./backend/number-service-provider.annotated.ts) | `number-service-provider.ts` | 号码服务能力约定和模拟实现 |
| [recharge](./backend/recharge.annotated.ts) | `recharge.ts` | 充值设置、记录、订单、可信入账入口及控制器 |
| [agent-inventory](./backend/agent-inventory.annotated.ts) | `agent-inventory.ts` | 代理身份、权限、客户、库存、流转和财务业务 |
| [agent-settlement](./backend/agent-settlement.annotated.ts) | `agent-settlement.ts` | 报价计算、价格校验、余额结算、明细保存 |
| [holding-batch](./backend/holding-batch.annotated.ts) | `holding-batch.ts` | 跨页批量选择、预览与事务内执行 |
| [unified-agent-stock](./backend/unified-agent-stock.annotated.ts) | `unified-agent-stock.ts` | 商城与代理的共享号码平台库存 |
| [platform-inventory](./backend/platform-inventory.annotated.ts) | `platform-inventory.ts` | 可售库存条件、到期释放 |
| [allocation-expiry](./backend/allocation-expiry.annotated.ts) | `allocation-expiry.ts` | 号码平台分配到期任务 |
| [agent-inventory-expiry](./backend/agent-inventory-expiry.annotated.ts) | `agent-inventory-expiry.ts` | 代理持有与服务权益到期任务 |
| [provider-sync](./backend/provider-sync.annotated.ts) | `provider-sync.ts` | 供应商库存同步、任务和冲突处理能力 |
| [upstream-integration](./backend/upstream-integration.annotated.ts) | `upstream-integration.ts` | 后台上游接入配置和回执统计 |
| [sandbox](./backend/sandbox.annotated.ts) | `sandbox.ts` | 本地沙盒入口、模拟积分和消息 |
| [mock-fulfillment](./backend/mock-fulfillment.annotated.ts) | `mock-fulfillment.ts` | 模拟履行领取、确认、分配与退款 |
| [main](./backend/main.annotated.ts) | `main.ts` | 服务装配、API 前缀、请求体、跨域及启动 |
| [http](./backend/http.annotated.ts) | `http.ts` | 输入规则检查、请求来源和统一错误 |
| [environment](./backend/environment.annotated.ts) | `environment.ts` | 环境变量默认值、转换与约束 |
| [database](./backend/database.annotated.ts) | `database.ts` | 数据库连接池、参数化查询和事务 |
| [business-throttler](./backend/business-throttler.annotated.ts) | `business-throttler.ts` | 按账户或 IP 确定限流身份 |
| [error-summary](./backend/error-summary.annotated.ts) | `error-summary.ts` | 生成受限错误日志摘要 |
| [test-database](./backend/test-database.annotated.ts) | `test-database.ts` | 测试环境配置隔离辅助，供理解 Environment 的测试分支；本次不执行 |

### 后端供应商边界：模拟数据、适配、回调

下表原文件均位于 `backend/src/providers/`。

| 注释副本 | 原文件 | 中文用途 |
| --- | --- | --- |
| [receiving-provider](./backend/providers/receiving-provider.annotated.ts) | `receiving-provider.ts` | 预留/分配号码的抽象能力 |
| [mock-receiving-provider](./backend/providers/mock-receiving-provider.annotated.ts) | `mock-receiving-provider.ts` | 本地模拟库存预留与用户分配 |
| [receiving-sync](./backend/providers/receiving-sync.annotated.ts) | `receiving-sync.ts` | 模拟号码绑定、短信拉取与归属 |
| [pingcode-adapter](./backend/providers/pingcode-adapter.annotated.ts) | `pingcode-adapter.ts` | 上游读取报文检查与内部字段转换 |
| [mock-pingcode-transport](./backend/providers/mock-pingcode-transport.annotated.ts) | `mock-pingcode-transport.ts` | 用预置数组模拟上游读取请求 |
| [pingcode-webhook](./backend/providers/pingcode-webhook.annotated.ts) | `pingcode-webhook.ts` | 已注册短信回调入口与验签 |
| [webhook-inbox](./backend/providers/webhook-inbox.annotated.ts) | `webhook-inbox.ts` | 已验证回执落库、短信路由与重试 |

## 4. 阅读时注意当前启用情况

文件或方法存在，表示项目有这部分结构；是否已经开放，要沿调用链看业务检查和 `main.ts` 的注册。

| 能力 | 当前源码中的实际行为 |
| --- | --- |
| 续期选项、提交续期 | `NumberServices.options/create` 核对归属和国家后返回 `RENEWAL_DISABLED`；不会调用模拟提供器完成续期 |
| 模拟用量 | `NumberServices.usage` 会调用当前绑定的模拟提供器，返回固定示例额度 |
| 直接导入代理库存、手工创建持有 | 对应业务方法返回 `USE_SHARED_NUMBER_INVENTORY`，要求通过总库存分配与结算 |
| 总库存分配与释放 | 当前要求管理员身份；普通代理的转售、客户分配另有直属关系限制 |
| 代理通用 `PURCHASE` 交易 | 返回 `PROVIDER_UNAVAILABLE`；其他允许类型建立待处理记录也不代表供应商完成 |
| 真实充值支付 | 状态为 `not_connected`；创建充值订单与可信付款后入账是两个阶段 |
| 供应商读取适配器 | 通过注入的 transport 读取；当前没有真实 HTTP transport，main 使用模拟接收实现 |
| 供应商库存同步服务 | 有任务和冲突处理代码，当前 `main.ts` 未注册该服务 |
| 上游短信回调 | 入口已注册，依赖回调密钥及原始字节验签；项目感知协议仍需上游确认 |

`pingcode-adapter.ts` 中的本地回调解码辅助，与 `pingcode-webhook.ts` 中实际注册的项目感知回调是两处代码，不能把其中一处的字段或旧注释直接套到另一处。

## 5. 怎么修改值、怎样维护副本

每份副本顶部有“修改提示”，关键位置再补具体说明。例如：

- 想改模拟续期选项：看 `number-service-provider.annotated.ts` 中的 `[7, 30]`，并注意实际续期入口禁用。
- 想改后台分配/商品期限：看已有 `admin.annotated.ts` 和 [报告第 10 节](../api-guide.md#10-怎样修改具体值以-730-天改为-1460-天为例)，同步页面、后端限制和商品数据。
- 想改请求等待时间：看 `client.annotated.ts` 的 `timeoutMs`；数据库 SQL 超时和批量请求超时另有配置。
- 想改售价：先区分商城积分单价、代理每 30 天的金额价格、充值兑换比例，找到对应数据/规则后再改。

副本不自动跟随业务源码更新。[manifest.json](./manifest.json) 保存原文件、副本和原始哈希的对应清单；[verify-annotations.mjs](./verify-annotations.mjs) 用于核对覆盖范围、原始哈希、导入路径、非注释代码及文档链接。

在项目根目录运行源码完整性检查：

```powershell
node docs/code-reading/api/verify-annotations.mjs
```

同时检查前端、契约与后端副本的 TypeScript 类型：

```powershell
node docs/code-reading/api/verify-annotations.mjs --typecheck
```

这些检查不运行应用、不调用接口、不连接数据库，也不运行测试。检查通过表示副本与当前源码结构一致、语法/类型可检查；实际接口行为仍需在运行环境中另行确认。
