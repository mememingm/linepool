# LINEPOOL To C 平台架构详解与讲解稿

> 适用范围：`D:\linepool\platform`。本文依据 2026-09-30 的代码、规格和架构决策记录整理，描述的是**本地演示平台**，不是已上线的生产系统。设计理由中，ADR 明确写出的部分标为“决策记录”；其余是根据当前实现可解释的工程取舍。文末列出尚未实现或尚未验证的部分。

## 1. 先把项目讲清楚

### 1.1 30 秒版本

LINEPOOL To C 是一个本地可运行的号码服务演示平台。用户登录后，能浏览项目与套餐，用演示积分购买号码，再查看订单、已分配号码、积分流水和演示短信。浏览器负责展示和交互；NestJS API 负责认证、校验和业务规则；PostgreSQL 保存数据，并在一次事务中完成下单的所有变更。前后端通过 HTTP/JSON 通信，双方共用一份 TypeScript/Zod 契约。

### 1.2 用户实际在做什么

```text
登录 -> 浏览项目 -> 选择套餐与数量 -> 确认购买
                                       |
                                       v
                   查看订单 / 我的号码 / 积分流水
                                       |
                                       v
                            查看演示短信并标记已读
```

这里的“购买”只扣本地演示积分，不接真实支付。“号码”和“短信”来自本地演示数据，不代表真实号码采购或短信采集。范围依据：[项目规格](spec.md)、[项目说明](../README.md)。

### 1.3 一句话架构

**Vue 页面发起操作，NestJS 判定能否执行，PostgreSQL 保存唯一可信的业务结果。**

## 2. 系统全景：谁是谁，谁找谁

```text
                    用户的浏览器
                        |
                        v
     Vue 3 页面 + Router + Pinia + API Client
                        |
            HTTP/JSON 请求；Cookie 自动携带
                        v
       /api 入口（开发时由 Vite 代理）
                        |
                        v
       NestJS Controller -> Guard -> Service
                        |             |
             Zod 校验输入       pg 参数化 SQL / 事务
                                      |
                                      v
                                  PostgreSQL

  @linepool/contracts：Web 与 API 共同引用的字段类型和校验规则
```

一个容易混淆的点：**Vite 不是业务后端**。开发环境中它提供前端页面并把 `/api` 代理到 NestJS；认证、订单、库存和积分规则仍在 NestJS 与数据库。生产环境目前没有部署配置，不能把开发代理当成现成的生产网关。[前端代理配置](../apps/web/vite.config.ts)、[API 启动入口](../apps/api/src/main.ts)。

| 组件 | 用大白话说 | 职责 | 直接通信对象 | 不负责 |
|---|---|---|---|---|
| `apps/web` | 用户看到和操作的窗口 | 页面、路由、表单、加载与错误反馈 | 浏览器用户、NestJS API | 裁定余额、分配库存、保存订单真相 |
| `apps/api` | 办理业务的柜台 | 认证、输入校验、权限、下单规则、数据查询 | Web、PostgreSQL | 渲染 Vue 页面、采集真实短信 |
| `packages/contracts` | 双方共用的字段说明书 | Zod schema、请求/响应类型 | 被 Web 和 API 在构建时引用 | 自动保证数据库或网络响应绝对正确 |
| PostgreSQL | 业务账本与仓库 | 持久化、约束、行锁和事务 | API、迁移/seed 脚本 | 理解页面交互、发起业务请求 |
| Vite | 开发环境的前端服务 | 编译/热更新前端、代理 `/api` | 浏览器、API | 生产部署、下单业务 |
| Docker Compose | 可选的本地数据库启动器 | 启动 PostgreSQL 17 容器和数据卷 | 本地开发者、PostgreSQL | 启动完整生产平台 |

仓库采用 npm workspaces：根目录负责统一脚本，`apps/web` 与 `apps/api` 是两个应用，`packages/contracts` 是共享包。依赖方向是 `web -> contracts`、`api -> contracts`；浏览器不会直接连 PostgreSQL。[工作区配置](../package.json)、[前端依赖](../apps/web/package.json)、[后端依赖](../apps/api/package.json)。

## 3. 为什么这样分层

### 3.1 前端用 Vue 3，而不是把业务页面画进 3D 场景

浏览项目、填写登录表单、比较套餐和阅读流水，核心是文字、表单与列表。Vue 的 DOM 页面更容易处理键盘导航、响应式布局、可读文本和自动化测试。仓库根目录另有 WebGL 原型，但正式应用放在 `platform/`，避免把原型的浏览器模拟状态当作真实业务数据。这个取舍明确记录在 [ADR-001](decisions/0001-formal-app-and-bounded-webgl.md)。

ADR-001 曾允许少量 Three.js/GSAP 增强；[ADR-004](decisions/0004-defer-three-gsap-enhancements.md) 后来**暂缓**了它们。因此当前运行时依赖里没有 Three.js/GSAP，功能也不依赖 WebGL。讲解时要以较新的 ADR-004 为准。

### 3.2 后端用 NestJS，但业务并没有被拆成微服务

NestJS 用 Controller 接住 HTTP 请求，用 Guard 检查登录态，用 Service 实现业务，用依赖注入连接服务。代码按 `auth`、`projects`、`orders`、`numbers`、`points`、`inbox` 等业务领域分目录，但当前它们都注册在**一个** `AppModule`、运行于**一个** API 进程。可以称为“模块化单体”，不能说成已经部署了多个微服务。[模块注册](../apps/api/src/app.module.ts)。

此阶段规模小、下单又需要同一数据库事务。模块化单体能明确职责，同时避免分布式事务、服务发现和跨服务网络故障等额外成本。这是对当前实现的工程解释；仓库未记录“必须永远保持单体”的决定。

### 3.3 PostgreSQL 既保存数据，也保证关键业务一致性

项目不是只展示静态页面：订单、号码归属和积分扣减必须在刷新后仍一致。PostgreSQL 提供持久化、主外键/唯一约束、事务和行锁。这些能力正好对应“重复点击不能重复扣款”“两个请求不能分到同一个号码”“失败不能留半张订单”。[数据表定义](../db/migrations/001_initial_schema.sql)、[ADR-002](decisions/0002-cookie-sessions-and-transactional-orders.md)。

## 4. 前端内部怎么组织

```text
main.ts
  -> 创建 Vue 应用，安装 Pinia 和 Vue Router
  -> router.ts：决定当前路由和是否需要登录
  -> AppShell.vue：桌面侧栏 / 移动端导航 / 页面容器
  -> 各 View：展示数据、收集输入、调用 API Client
  -> api-client.ts：统一发送请求、携带 Cookie、转换错误
```

### 4.1 页面与导航

`router.ts` 将登录页设为公开路由，其余用户页面放在 `AppShell` 下；页面组件按路由动态导入，以便访问某个页面时再加载对应代码。进入路由前，前端尝试 `/auth/me` 恢复会话；未登录则转到登录页，并保留原本要访问的地址。登录后的用户访问登录页会回到首页。[路由定义](../apps/web/src/router.ts)、[应用入口](../apps/web/src/main.ts)。

`AppShell.vue` 把桌面侧栏、移动端顶栏和底部主导航集中实现，业务页面只关心自己的内容。[页面框架](../apps/web/src/layouts/AppShell.vue)。页面包括首页、项目列表/详情、订单、号码、短信、积分和账户；它们对应后端资源，不是互相复制一套业务状态。

### 4.2 Pinia 只缓存当前会话视图

`session.ts` 存当前用户、正在检查状态，并封装 `restore/login/logout`。这只是浏览器内存中的**登录视图状态**；真正的登录凭据是浏览器保存的 HttpOnly Cookie，真正的会话记录在数据库。刷新页面后，Pinia 重新调用 `/auth/me`，而不是从本地存储取一个自认有效的用户对象。[会话 store](../apps/web/src/stores/session.ts)。

### 4.3 API Client 是统一的网络出口

`apiFetch` 给请求加 `/api` 前缀并设置 `credentials: 'include'`，使浏览器按规则带上 Cookie；有 JSON 请求体时设置 `Content-Type`。成功时按统一 `{ data: ... }` 或分页响应解包；失败时把后端错误包装成包含 HTTP 状态和业务错误码的 `ApiClientError`。页面因而不必各自重复实现底层 `fetch` 和错误解析。[API Client](../apps/web/src/services/api-client.ts)。

注意：前端对成功响应使用的是 TypeScript 类型断言，**没有对每个响应执行 Zod 运行时解析**。共享契约减少开发时字段漂移，但网络实际返回什么仍要靠后端实现和测试保证。

### 4.4 页面状态和交互

各页面从 API 拉取自己的数据；`DataState.vue` 集中处理加载骨架、错误提示与重试、空状态。项目页分页；号码页按使用中/已过期筛选；短信标记已读后更新当前页面数据；项目详情页计算预计积分，并提交购买。[状态组件](../apps/web/src/components/DataState.vue)、[项目详情页](../apps/web/src/views/ProjectDetailView.vue)、[短信页](../apps/web/src/views/InboxView.vue)。

布局选择内容优先、浅色中性色、蓝色主操作，移动端改变导航位置而不是改业务流程。设计原则见 [设计系统](design-system.md) 与 [ADR-003](decisions/0003-kimi-k3-inspired-content-first-ui.md)。

## 5. 一个 API 请求进来后发生什么

以 `POST /api/orders` 为例：

```text
浏览器点击“确认购买”
  -> api-client.ts 发 POST /api/orders，浏览器附上会话 Cookie
  -> NestJS 收到请求；全局限流 Guard 检查请求量
  -> AuthGuard 查 Cookie 对应的有效会话，放入 request.user
  -> OrdersController 用共享 Zod schema 校验请求体
  -> OrdersService 按当前用户执行下单事务
  -> DatabaseService 用 pg 向 PostgreSQL 发参数化 SQL
  -> 成功：Controller 返回 { data: 订单详情 }
  -> 失败：异常过滤器返回统一 { error: { code, message, ... } }
  -> 前端显示结果，并重新获取会话中的积分余额
```

Controller 是 HTTP 边界，负责接收参数、校验和调用 Service；Service 负责业务判断与 SQL；`DatabaseService` 负责连接池、`BEGIN/COMMIT/ROLLBACK` 和释放连接。这样的职责划分使“HTTP 格式”“业务规则”“数据库生命周期”各有固定位置。[Controller](../apps/api/src/orders/orders.controller.ts)、[Service](../apps/api/src/orders/orders.service.ts)、[数据库服务](../apps/api/src/database/database.service.ts)。

`configureApp` 设置全局 `/api` 前缀、Cookie 解析、Helmet、指定来源的 CORS 和异常过滤器；限流 Guard 在 `AppModule` 注册。Zod 校验错误映射为 HTTP 422 `VALIDATION_ERROR`，普通业务异常返回相应状态和错误码，未处理异常返回 HTTP 500 且不把内部堆栈发给浏览器。[应用配置](../apps/api/src/configure-app.ts)、[异常过滤器](../apps/api/src/errors/api-exception.filter.ts)。

## 6. 三条最值得讲的业务链路

### 6.1 登录与恢复会话

```text
用户输入邮箱/密码
  -> AuthController 校验格式
  -> AuthService 按邮箱找用户，bcrypt 核对密码
  -> 生成随机会话 token，数据库只存其 SHA-256 哈希和到期时间
  -> 响应设置 HttpOnly、SameSite=Lax Cookie
  -> 后续请求：AuthGuard 哈希 Cookie token，查未过期 session 和用户
  -> 退出：删 session，并清除 Cookie
```

Cookie 就像浏览器自动携带的“临时通行证”；这个类比只帮助理解。真实机制是随机 token 与数据库里的哈希记录匹配，服务端还会检查是否过期。密码在 seed 时用 bcrypt cost 12 哈希，登录时比对；不存在的邮箱也走一次假哈希比对，减少直接暴露用户是否存在的差异。具体实现见 [认证 Controller](../apps/api/src/auth/auth.controller.ts)、[认证 Service](../apps/api/src/auth/auth.service.ts)、[认证 Guard](../apps/api/src/auth/auth.guard.ts)、[seed](../apps/api/scripts/seed.ts)。

为什么这样设计：服务端可以主动撤销会话，浏览器 JavaScript 不能直接读取 HttpOnly Cookie；相比把令牌放在 `localStorage`，降低了脚本直接窃取可复用令牌的风险。它**不等于**已经解决全部 Web 安全问题。这个选择见 [ADR-002](decisions/0002-cookie-sessions-and-transactional-orders.md)。

### 6.2 浏览项目与套餐

```text
项目市场 -> GET /api/projects?page=1&pageSize=6
            -> 查询已上架项目、项目可用号码数、最低套餐积分
项目详情 -> GET /api/projects/:id
            -> 查询项目及其已上架套餐
```

页面显示的库存和价格由后端查询，而不是写死在 Vue 组件里。`plans` 定义单价与有效天数；库存位于 `phone_numbers`，按 `project_id` 归属项目，当前没有“每个套餐单独一池号码”的模型。项目详情中各套餐显示的可用数来自**该项目同一号码池**，讲解时不能把它说成各套餐独立库存。[项目查询服务](../apps/api/src/projects/projects.service.ts)、[数据表定义](../db/migrations/001_initial_schema.sql)。

页面显示的是查询时快照。用户看到“还有 5 个”并不保证几秒后仍有 5 个；提交时会在事务内重新挑选并锁住号码，不够就返回库存不足。这是读页面与执行交易之间应有的边界。

### 6.3 下单：整套架构的核心

下单请求带 `projectId`、`planId`、`quantity` 和 `idempotencyKey`。其中 `idempotencyKey` 是这次用户操作的唯一标识；前端使用 `crypto.randomUUID()` 生成，改变套餐或数量时换一个，成功后也换一个。失败或网络异常时，在当前页面继续重试会沿用原 key。[购买页面](../apps/web/src/views/ProjectDetailView.vue)、[输入契约](../packages/contracts/src/index.ts)。

```text
1. 开始 PostgreSQL 事务
2. 查当前用户是否已有相同 idempotencyKey 的订单；有则直接返回原订单
3. SELECT users ... FOR UPDATE，锁住当前用户的积分余额行
4. 再查一次相同 key，处理“另一个同用户请求刚完成”的并发情况
5. 确认项目和套餐都已上架，计算 单价 x 数量
6. 检查积分够不够
7. SELECT 可用号码 ... FOR UPDATE SKIP LOCKED LIMIT 数量
8. 库存足够时：插入订单、把号码标为已分配、扣用户余额、写积分流水
9. 读取完整订单详情，COMMIT；任何一步抛错则 ROLLBACK
```

为什么必须放在一个事务：如果订单写成了、积分扣了、号码分配却失败，用户会看到互相矛盾的数据。事务让这些更新一起成功或一起撤销。`FOR UPDATE` 让同一用户的并发扣款串行化；`SKIP LOCKED` 避免不同请求拿到同一批正在分配的号码；数据库唯一约束 `UNIQUE(user_id, idempotency_key)` 再兜住重复订单。[下单实现](../apps/api/src/orders/orders.service.ts)、[事务封装](../apps/api/src/database/database.service.ts)、[数据库约束](../db/migrations/001_initial_schema.sql)。

一个具体例子：单价 1,200 积分、买 2 个，服务端算出总价 2,400。用户余额和库存都满足时，最终应出现 **1 张订单、2 个归属该订单的号码、1 条 -2,400 的积分流水，以及扣减后的余额**。重复提交同一个 key 返回原订单，不再产生第二套结果。API 集成测试覆盖了顺序重放、余额不足和库存不足的回滚；当前测试里**没有专门的真正并发压测**，不能据此宣称高并发容量已验证。[API 测试](../apps/api/test/app.e2e.test.ts)。

### 6.4 下单后为什么几个页面能对上

订单页查 `orders`，号码页查归属当前用户的 `phone_numbers`，积分页查 `users.points_balance` 和 `point_ledger`。这几个页面是从同一个数据库的同一次已提交交易读取结果，刷新后仍能对上。首页取当前用户积分、前三个可用项目和最近五张订单。[订单查询](../apps/api/src/orders/orders.service.ts)、[号码查询](../apps/api/src/numbers/numbers.service.ts)、[积分查询](../apps/api/src/points/points.service.ts)、[首页聚合](../apps/api/src/dashboard/dashboard.service.ts)。

号码列表中的 `ACTIVE/EXPIRED` 是查询时根据 `expires_at` 算出的展示状态；数据库行的 `status` 不会因为时钟走过到期点自动更新。短信由 seed 提供，列表按 `user_id` 过滤，标记已读的 SQL 同时限定消息 ID 和当前用户 ID。[号码服务](../apps/api/src/numbers/numbers.service.ts)、[短信服务](../apps/api/src/inbox/inbox.service.ts)。

## 7. 数据模型：八张业务表如何连起来

```text
users ──< sessions                一个用户可有多个会话
  |
  +─────< orders >──── projects ──< plans
  |          |             |
  |          +────< phone_numbers  订单分配的号码来自项目库存
  |                    |
  +─────< sms_messages >─+        消息指向用户和号码
  |
  +─────< point_ledger            每次积分变化留一条记录
```

上图的 `─<` 表示“一对多”；它只说明主要关系，实际外键与检查约束以 [SQL migration](../db/migrations/001_initial_schema.sql) 为准。

| 表 | 主要字段/关系 | 为什么存在 |
|---|---|---|
| `users` | 邮箱、密码哈希、演示标识、当前积分余额 | 登录身份与当前余额的查询入口 |
| `sessions` | token 哈希、用户、过期时间 | 服务端验证和撤销登录态 |
| `projects` | 国家、名称、展示元数据、是否上架 | 项目目录 |
| `plans` | 所属项目、单价、有效天数、是否上架 | 定价与服务期限 |
| `phone_numbers` | 所属项目、号码、可用/分配状态、归属用户和订单、到期时间 | 可分配库存与购买结果 |
| `orders` | 用户、项目、套餐、数量、总积分、幂等 key | 一次购买的主记录 |
| `point_ledger` | 用户、增减额、变动后余额、关联订单 | 积分变化的审计线索 |
| `sms_messages` | 所属用户、号码、内容、收到时间、已读状态 | 演示收件箱 |

这里同时存 `users.points_balance` 和 `point_ledger`，并非前后端各算一份余额：前者用于快速读取“现在有多少”，后者解释“为什么变成这样”。下单时二者在同一个事务里更新。数据库用主键、外键、唯一约束和非负余额等 `CHECK` 约束做最后防线；业务层仍必须先检查并给出可理解的错误。[Schema](../db/migrations/001_initial_schema.sql)、[积分查询](../apps/api/src/points/points.service.ts)。

## 8. API 对照表

所有路径都有 `/api` 前缀。除健康检查与登录外，下面的用户数据接口都依赖 Cookie 会话；退出接口会尝试撤销 Cookie 对应的会话，但未使用 `AuthGuard`。代码依据：[API 模块](../apps/api/src/app.module.ts)、各 Controller。

| 方法 | 路径 | 主要用途 | 主要代码 |
|---|---|---|---|
| GET | `/api/health` | API 与数据库连通检查 | [HealthController](../apps/api/src/health.controller.ts) |
| POST | `/api/auth/login` | 登录并设置会话 Cookie | [AuthController](../apps/api/src/auth/auth.controller.ts) |
| GET | `/api/auth/me` | 根据当前 Cookie 恢复用户 | [AuthController](../apps/api/src/auth/auth.controller.ts) |
| POST | `/api/auth/logout` | 撤销会话并清 Cookie | [AuthController](../apps/api/src/auth/auth.controller.ts) |
| GET | `/api/dashboard` | 首页摘要 | [DashboardController](../apps/api/src/dashboard/dashboard.controller.ts) |
| GET | `/api/projects`、`/api/projects/:id` | 分页项目与套餐详情 | [ProjectsController](../apps/api/src/projects/projects.controller.ts) |
| POST | `/api/orders` | 幂等事务下单 | [OrdersController](../apps/api/src/orders/orders.controller.ts) |
| GET | `/api/orders`、`/api/orders/:id` | 本人订单列表/详情 | [OrdersController](../apps/api/src/orders/orders.controller.ts) |
| GET | `/api/numbers` | 本人号码，可按有效状态筛选 | [NumbersController](../apps/api/src/numbers/numbers.controller.ts) |
| GET | `/api/points` | 本人余额和分页流水 | [PointsController](../apps/api/src/points/points.controller.ts) |
| GET | `/api/inbox` | 本人演示短信 | [InboxController](../apps/api/src/inbox/inbox.controller.ts) |
| POST | `/api/inbox/:id/read` | 标记本人的一条短信已读 | [InboxController](../apps/api/src/inbox/inbox.controller.ts) |
| GET | `/api/account` | 本人公开账户资料 | [AccountController](../apps/api/src/account/account.controller.ts) |

普通成功结果是 `{ "data": ... }`；列表附加 `pagination`；失败结果是 `{ "error": { "code": "...", "message": "..." } }`，某些错误附 `details`。分页查询默认每页 20，后端限制最大 100；页面可选用更小的页大小。接口契约在 [共享包](../packages/contracts/src/index.ts)，实际 HTTP 返回格式在各 Controller/Service 与 [异常过滤器](../apps/api/src/errors/api-exception.filter.ts)。

## 9. 安全与数据边界：可以明确说到什么程度

1. **身份边界**：Cookie 使用 HttpOnly、SameSite=Lax；生产模式才设置 `Secure`，因此真正上线必须配 HTTPS 和部署配置。服务端只存 token 哈希，可过期、可登出删除。[认证实现](../apps/api/src/auth/auth.service.ts)、[Cookie 配置](../apps/api/src/auth/auth.controller.ts)。
2. **权限边界**：受保护 Controller 用 `AuthGuard` 取当前用户；订单、号码、积分、短信等查询按该用户 ID 过滤。前端传来的用户 ID 不被当作资源归属依据。[订单服务](../apps/api/src/orders/orders.service.ts)、[短信服务](../apps/api/src/inbox/inbox.service.ts)。
3. **输入与 SQL 边界**：登录、下单、分页、路径 ID 在 HTTP 入口用 Zod 检查；数据库查询使用 `$1` 等参数，不把用户输入拼成 SQL。号码状态筛选的 SQL 片段来自固定枚举分支。[共享 schema](../packages/contracts/src/index.ts)、[号码查询](../apps/api/src/numbers/numbers.service.ts)。
4. **请求保护**：全局请求限流和登录专用限流已配置；Helmet、指定来源 CORS 已配置。这些只是现有防护，不能直接推导出已经完成生产安全审计。[API 模块](../apps/api/src/app.module.ts)、[应用配置](../apps/api/src/configure-app.ts)。
5. **数据来源边界**：seed 只写本地演示数据；没有真实公司端点、真实支付、真实短信采集、设备或管理员功能。[seed](../apps/api/scripts/seed.ts)、[规格](spec.md)。

## 10. 本地运行、迁移与测试如何配合架构

```text
npm workspace 根脚本
  -> 先构建 contracts（Web/API 导入它的 dist）
  -> 启动 API 与 Web 开发服务
  -> Web: 127.0.0.1:5174，/api 代理到 API
  -> API: 127.0.0.1:3000，连接 PostgreSQL
  -> PostgreSQL: 本机 5432，或 Compose 映射主机 55432
```

迁移脚本按文件名顺序执行 SQL，并把文件名记在 `schema_migrations`；使用 PostgreSQL advisory lock，避免两个迁移进程同时改结构。seed 在事务里写入演示账户、3 个项目、5 个套餐、16 个号码、1 张历史订单和 2 条演示短信；固定 ID 与冲突处理使重复 seed 不重复创建这些基础记录，且不会重置已有用户的积分余额。[迁移脚本](../apps/api/scripts/migrate.ts)、[seed 脚本](../apps/api/scripts/seed.ts)、[Compose](../docker-compose.yml)。

数据库连接地址、演示用户信息和会话时长来自环境变量；仓库提供的是 [.env.example](../.env.example)，真实本地 `.env` 不应提交。`DATABASE_URL` 是应用库，`TEST_DATABASE_URL` 是测试库。API 集成测试会**删除并重建测试库的 `public` schema**，代码仅检查数据库名以 `_test` 结尾，所以运行测试前仍须亲自核对连接目标。[测试初始化](../apps/api/test/app.e2e.test.ts)、[数据库集成测试](../apps/api/test/database.integration.test.ts)。

现有测试分三层：共享契约的 schema 测试；API 用 Supertest 和真实 PostgreSQL 测请求、认证、事务与归属；Web 用 Vitest/Vue Test Utils 测 API 客户端、会话和页面状态。历史验证记录称依赖修复前这些测试、类型检查和构建曾通过，但修复后未复跑；这不是本次文档整理的运行验证结果。[验证记录](verification.md)。

## 11. 设计取舍与当前限制：讲解时主动说清

| 设计/现状 | 解决的问题 | 代价或边界 |
|---|---|---|
| 单体 API + 按领域分目录 | 当前业务清晰，事务可在一个数据库完成 | 还没有多服务独立部署能力；扩展前应评估真实瓶颈 |
| 共享 TypeScript/Zod 契约 | 双端字段名和请求校验集中 | 前端成功响应未逐条做运行时 schema 校验 |
| 服务端 Cookie 会话 | 支持过期与登出撤销，令牌不暴露给页面脚本 | 需要管理 session 表、HTTPS/域名和跨站请求策略 |
| 数据库事务 + 行锁 + 幂等 key | 防止部分下单、重复扣积分和重复分配 | 当前同 key 不核对请求内容是否相同；真正并发压力未专项验证 |
| 项目共享号码库存 | 演示模型简单，套餐只决定价格和时长 | 不能表达“每个套餐独立库存” |
| 号码到期按时间即时计算 | 页面状态不依赖定时任务 | DB 中 `status` 不会自动改为 `EXPIRED`，后续外部集成需明确状态语义 |
| seed 驱动的本地演示 | 可以重复演示闭环，不依赖外部系统 | 没有真实支付、号码供给、短信入站或生产运营能力 |
| Vite 开发代理 | 本地 Web 调 API 简单 | 生产部署需要另行设计 `/api` 路由、静态站点回退和 HTTPS |

另有几个具体边界值得面对提问时说明：当前没有独立 CSRF token 机制；SameSite=Lax 与本地同站部署提供一定约束，但接入不同域名或真实支付前要重新做跨站请求威胁评估。项目没有生产部署、监控、备份或密钥管理方案。共享手机号/短信的真实隐私要求也尚未纳入。它们是未来接入真实业务时需要设计的工作，不能说成当前已完成。[规格中的延期项](spec.md)、[ADR-002](decisions/0002-cookie-sessions-and-transactional-orders.md)。

## 12. 给别人讲时可以直接按这个顺序

1. **先说业务目标（约 1 分钟）**：这是本地 To C 演示，用户登录、选套餐、用演示积分下单，之后在多个页面看到一致结果；明确不接真实系统。
2. **画三层图（约 2 分钟）**：浏览器 Vue 负责界面，NestJS 负责规则，PostgreSQL 负责可靠保存；`contracts` 是两端共用的字段说明书。
3. **走登录（约 2 分钟）**：输入密码 -> 服务端比对 -> Cookie 会话 -> Guard 识别当前用户；说明 Pinia 不是认证权威。
4. **重点走下单（约 4 分钟）**：重新校验价格、余额、库存；用户行锁和号码行锁；同事务写订单、号码、余额、流水；失败回滚、重复 key 返回旧结果。
5. **说明为什么页面一致（约 1 分钟）**：订单、号码、积分读同一数据库的已提交结果，而不是前端各自维护假数据。
6. **收尾说边界（约 1 分钟）**：目前是本地演示，真实支付/短信/公司接口、生产部署和并发容量验证仍未完成。

面对“为什么不直接前端存数据”的问题，可以答：**浏览器刷新、换设备或并发请求时无法保证订单、库存和积分一致，更不能信任浏览器决定扣款。**面对“为什么要事务”的问题，可以答：**购买有四种相互依赖的写入，它们必须作为一次成功或失败。**面对“为什么要幂等”的问题，可以答：**用户双击或网络超时重试时，同一操作不能变成两次购买。**

## 13. 代码导航：追一遍最短路径

| 想看什么 | 从这里开始，再看哪里 |
|---|---|
| 项目总入口 | [README](../README.md) -> [根 package.json](../package.json) |
| 前端路由与登录恢复 | [router.ts](../apps/web/src/router.ts) -> [session.ts](../apps/web/src/stores/session.ts) -> [api-client.ts](../apps/web/src/services/api-client.ts) |
| 一个 HTTP 请求怎么进后端 | [main.ts](../apps/api/src/main.ts) -> [configure-app.ts](../apps/api/src/configure-app.ts) -> [app.module.ts](../apps/api/src/app.module.ts) |
| 登录链路 | [auth.controller.ts](../apps/api/src/auth/auth.controller.ts) -> [auth.service.ts](../apps/api/src/auth/auth.service.ts) -> [auth.guard.ts](../apps/api/src/auth/auth.guard.ts) |
| 下单链路 | [ProjectDetailView.vue](../apps/web/src/views/ProjectDetailView.vue) -> [orders.controller.ts](../apps/api/src/orders/orders.controller.ts) -> [orders.service.ts](../apps/api/src/orders/orders.service.ts) -> [database.service.ts](../apps/api/src/database/database.service.ts) |
| 字段与数据库 | [contracts/index.ts](../packages/contracts/src/index.ts) -> [001_initial_schema.sql](../db/migrations/001_initial_schema.sql) |
| 设计决策与证据 | [ADR-001](decisions/0001-formal-app-and-bounded-webgl.md) -> [ADR-002](decisions/0002-cookie-sessions-and-transactional-orders.md) -> [ADR-004](decisions/0004-defer-three-gsap-enhancements.md) -> [verification.md](verification.md) |

**最后压缩成一句话：页面负责操作，API 负责判断，数据库负责记账；共享契约让双方说同一种数据语言，事务和幂等让一次购买只产生一套一致结果。**
