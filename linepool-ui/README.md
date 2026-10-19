# LINEPOOL React 网站

项目唯一应用目录为 `linepool-ui/`，包含 React 网站、NestJS API 和共享契约。旧 Vue 项目已移除。

## 目录结构

```text
linepool-ui/
├── src/app/                  网站入口与路由
├── src/linepool/             React 业务页面、API 客户端与状态
├── src/vendor/               上游组件原件（只读）
├── public/                   静态资源原件（只读）
├── backend/src/              NestJS API
├── backend/db/migrations/    PostgreSQL 迁移
├── backend/scripts/          数据库管理脚本
├── packages/contracts/      前后端共享类型与校验
├── catalog/                 上游组件快照及许可证
├── scripts/                 构建与完整性检查
├── tests/                   已有测试源码
└── docs/                    历史开发记录
```

服务器部署说明与配置模板见仓库根目录的 [deploy/README.md](../deploy/README.md)。`docs/` 中的交接记录保留历史背景，其中旧 Vue 路径、端口和命令不作为当前部署依据。

## 页面入口

- `/`：首页，提供注册和登录入口。
- `/register`：注册，成功后进入工作台。
- `/login`：登录，成功后进入工作台；已有会话时直接进入。
- `/app`：工作台总览，未登录时跳转登录页。
- `/app/purchase`、`/app/numbers`、`/app/inbox`、`/app/orders`、`/app/points`、`/app/account`、`/app/settings`、`/app/regions`：业务子页。
- 详情沿用 `/app/regions/:id`、`/app/services/:id`、`/app/offers/:region/:service/:plan`、`/app/orders/:uuid`。

- `/admin`、`/admin/users`、`/admin/numbers`、`/admin/products`、`/admin/orders`、`/admin/renewals`：管理概览及五个管理模块，仅平台管理员可访问。

旧的 `#workspace-reference-shell` 链接自动转换为 `/app`。组件展示、其他工作台方案不再提供页面入口。

## 本地启动与构建

需要 Node.js 22+，首次运行在 `linepool-ui/` 安装依赖：`npm ci`。工作区统一使用此目录的 `package-lock.json`。

```powershell
cd linepool-ui
npm ci
npm run dev:all
```

首页：<http://127.0.0.1:5178/>。React API：`127.0.0.1:3010`。
数据库、API 环境配置仍由 `backend` 管理。仅启动前端可以执行 `npm run dev`。

- `npm run typecheck`：组件包构建及前端类型检查。
- `npm run build:all`：构建网站、共享契约与 API；服务器发布使用此命令。
- `npm run typecheck:all`：前后端及已有测试源码的类型检查，不执行测试。
- `npm run build:web`：组件包与网站构建，网站产物为 `web-dist/`。
- `npm run preview`：预览 `web-dist/`，使用 5178，启动前先停止同端口开发服务。
- `npm run verify:upstream` / `npm run verify:catalog-upstream`：上游源码完整性检查。

## 当前架构

```text
浏览器 -> Nginx / HTTPS
             |-- /、/login、/register、/app/*、/admin/* -> web-dist（React + Vite）
             `-- /api/* -> NestJS（127.0.0.1:3010）-> PostgreSQL
```

前端的所有业务请求经 `src/linepool/api/client.ts`；后端由 `backend/src/controllers.ts` 接收请求，认证、查询和下单分别在 `authentication.ts`、`workspace.ts`、`ordering.ts`。`packages/contracts/src/index.ts` 是前后端共用的字段和 Zod 校验来源，不再复制第二份接口类型。

当前为单体 API，无 Redis、消息队列或微服务；管理员后台与用户端共用一个 React 站点及账号体系。会话保存在 PostgreSQL；下单在一个事务内完成库存分配、积分扣减和订单记账，通过用户级 UUID 幂等键避免重复扣款。数据库结构由 `backend/db/migrations/` 顺序迁移并校验文件摘要，已应用的迁移不能直接修改。

## API 对接边界

所有路径以 `/api` 开头，请求体为 JSON。除登录、注册和健康检查外，都需要登录会话。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/auth/register`、`/auth/login`、`/auth/logout` | 注册、登录、退出 |
| GET | `/auth/me`、`/account` | 会话、账户信息 |
| GET | `/catalog`、`/dashboard` | 可购目录、工作台汇总 |
| GET | `/numbers`、`/orders`、`/orders/:id` | 号码、订单、订单详情 |
| POST | `/orders` | 购买号码，含 `idempotencyKey` UUID |
| GET | `/numbers/:id/renewal-options` | 续费时长、价格和预计到期日期 |
| POST / GET | `/numbers/:id/renewals` | 创建续费申请 / 分页查询本人的申请记录 |
| GET | `/numbers/:id/usage` | 查询套餐用量；Mock 支持 `scenario` 演示场景 |
| GET | `/inbox`、`/points` | 短信、积分及流水 |
| POST | `/inbox/read` | 标记短信已读 |
| PATCH | `/account/profile`、`/account/preferences` | 账户资料、偏好设置 |
| GET | `/health` | API 和数据库健康检查 |

成功详情返回 `{ data: ... }`，分页列表返回 `{ data: [...], pagination: ... }`；积分接口的 `data` 为 `{ balance, entries }`。失败返回 `{ error: { code, message, details? } }`。分页从 1 开始，默认每页 20 条，最多 100 条；筛选字段和精确输入以共享契约为准。

认证使用 `HttpOnly` Cookie `linepool_react_session`，不是 JWT 或 API Key。Cookie 路径为 `/`，以便服务端校验受保护页面；生产环境启用 `Secure`，`SameSite=Lax`；浏览器客户端使用 `credentials: include`。共享登录页检查会话时会将旧版 `/api` 路径 Cookie 迁移至 `/`，不延长会话有效期；退出同时清除两种路径。所有写请求还必须携带与 `WEB_ORIGIN` 完全一致的 `Origin`。默认同域部署，不建议直接改为跨站 Cookie。

这套接口是网站内部会话 API，尚不是供第三方服务器调用的开放 API，也没有供应商回调、Webhook 签名或供应商适配器。若是接入他人的号码 / 短信 API，应在 NestJS 后端接入并保管密钥，不将密钥放入 `VITE_*` 或前端代码。若是让他人调用 LINEPOOL，则需先约定独立的服务端鉴权、权限和限流，不能直接复用用户登录 Cookie 作为正式开放接口方案。

## 平台管理员

本阶段所有管理数据只来自本地 PostgreSQL，不请求 PingCode 或其他上游 API。用户工作台左侧菜单仅保留 C 端业务；只有 `ADMIN` 账号会在顶部看到「管理后台」入口，进入独立的 `/admin` 后台，沿用现有登录页。`USER` 不能访问后台；未登录不能访问 `/app` 或 `/admin`。Vite dev/preview 和部署用 Nginx 模板均在返回受保护页面前调用现有会话守卫；普通用户手动输入后台地址返回 403，未登录跳转 `/login`。所有 `/api/admin/*` 继续通过 `SessionGuard` 和 `AdminGuard` 校验数据库中的当前角色，`GET /api/admin/session` 提供受守卫保护的后台访问检查。生产部署必须使用包含 `auth_request` 的模板，详见 `../deploy/README.md`。

首次授权需要先注册一个有效账号，再在 `linepool-ui/` 执行：

```powershell
npm run api:build
npm run db:migrate
npm run admin:grant -- --email=existing-account@example.com
```

命令仅用于初始化首位管理员，不创建账号、不重设密码，也不允许在已有管理员时继续提权。授权后旧会话失效，需用原密码重新登录。新注册用户固定为 `USER`，注册接口不能设置管理员角色。

当前本地开发库的 `demo@linepool.local` 已授权为管理员；生产环境需使用独立正式账号和密码，不得沿用演示凭据。

已开放用户启停、号码分配/回收/上下架、商品创建/编辑及订单查询。写入要求操作原因，并在同一数据库事务内记录 `admin_audit`。禁用用户会撤销会话；号码回收保留 `number_allocations` 归属历史、原订单与原用户短信，且不会自动重新上架。商品变更不重写已购订单，新增订单记录购买时的商品快照。

续费支持创建和查询本地申请，价格未配置时保存为 `NULL`，前后台显示「待确认」。提交后为待处理，不扣积分、不接入支付、不延长到期时间。现金支付、退款、真实短信接入及通信套餐/托管到期仍为待接入。不得把手工延长到期时间视为实际续费成功。

## 号码续费与套餐用量

在 `/app/numbers` 的「我的号码」列表点击「续费」或「查看用量」。续费窗口可选择 7 / 30 / 90 天演示方案，并查看分页申请记录；提交与查询通过现有 Cookie 会话 API。重试复用原申请的 UUID，后端校验号码归属、原到期时间、可选时长和重复待处理申请。申请写入现有 `renewals` 表，不改写号码有效期。新增迁移为 `005_number_services.sql`；更新其他环境时先执行 `npm run api:build` 和 `npm run db:migrate`。

用量由后端 Mock 返回，短信单位为条、语音为分钟、流量为 MB。窗口醒目标注「模拟数据」，支持标准套餐、不限量、无套餐、不支持查询、接口异常五种演示场景，并显示模拟快照更新时间；加载或请求失败时不补造剩余额度。演示快照时间在 API 启动时确定，刷新查询不会冒充新的实际采集时间。

数据获取位于 `backend/src/number-service-provider.ts`，共享契约位于 `packages/contracts/src/number-services.ts`，UI 位于 `src/linepool/workspace-reference/NumberServices.tsx`。这些都是 LINEPOOL 内部接口，不是 PingCode 请求或返回格式。当前由 NestJS 在 `backend/src/main.ts` 将 `NumberServiceProvider` 绑定到 `MockNumberServiceProvider`。未来在服务端实现适配器并替换此绑定，前端保持使用现有内部接口，密钥不进入浏览器。

PingCode 接入前需确认：

- 号码/租赁实例的稳定标识、鉴权和查询权限；可续费时长、权威报价/计价单位、预计到期规则及报价有效期。
- 续费申请的幂等语义、供应商申请标识、待处理/成功/失败状态、超时后的查询核对，以及失败原因。
- 可信成功确认方式（状态查询或可验签、可防重放的回调）、实际新到期时间、付款确认及执行凭证。申请回执不等于续费成功；需在后端核对当前归属及申请状态后，在同一事务内更新续费记录、号码和分配记录的有效期，并处理重复/乱序确认。前端只在服务确认成功后刷新原有号码与倒计时数据。
- 短信、语音、流量的总量/已用/剩余量、单位和套餐周期、是否不限量；无套餐/不支持/错误的可区分状态、采集时间、缓存时效、限流与错误重试规则。

本阶段未定义或猜测 PingCode 的地址、鉴权字段、请求参数、供应商返回格式或回调路径，也未开放客户端修改续费状态的入口。

## 上线前未完成项

当前账户与订单确实读写 PostgreSQL，但目录、号码库存、短信仍是演示实现，随机号码不代表可收短信的实际号码。共享契约和映射仍固定 `isDemo: true`，地区及服务选项仍固定，套餐标识已支持管理员创建；C 端订单契约仍仅有 `COMPLETED`，后台单独展示本地积分结算与交付状态。接真实供应商时需要同时确认这些契约及异步状态，不能仅替换 API URL。

生产环境禁止演示种子导入；空数据库迁移后没有可购目录、库存或积分充值渠道。尚未实现真实支付、短信接入、密码找回与邮箱验证。当前状态适合部署演示或联调环境，不应宣称真实业务已经可用。

Nginx 后面的可信代理和按访客 IP 限流尚待按实际拓扑确认，不能直接开放为正式多用户业务。全局限流当前为 120 次 / 分钟，登录、注册等另有更低限额。

## 对外部署要求

本地的 `127.0.0.1` 地址只在本机可访问，不是可分享的公网网址。本次整理不包含线上部署。

部署时把 `web-dist/` 作为静态网站，把同域 `/api/*` 转发到 React 后端（API 路径保留 `/api`），其余非文件路径回退 `index.html`，使直接打开、刷新 `/app/numbers` 等页面正常。
使用 HTTPS，并将后端 `WEB_ORIGIN` 设置为实际站点 origin。
前端默认使用同域 `/api`；Vite 开发和预览服务自动转发到本机 3010。
如确需跨域 API，可通过 `VITE_LINEPOOL_API_URL` 配置，但要同时配置后端允许的 origin 与凭据 Cookie。

## 代码与资源边界

首页与认证：`src/linepool/welcome/`；网站入口与路径导航：`src/main.tsx`、`src/app/`；工作台：`src/linepool/workspace-reference/`。
工作台主画布仍依赖 `src/linepool/showcase/Reference.tsx`、`Reference.css` 与 `assets/`，这些不是可删除的演示页。

Beautiful UI / Magic UI 的原组件、许可证、`public/` 静态资源、完整性锁保持原样。
`catalog/vendor/` 只保留上游组件快照与来源信息，不挂载展示页。
网站生产构建只发布 `authkit-reference/`、`illustrations/`、`login-scene/` 下的运行资源及 Vite 生成的 `assets/`；不发布组件注册表 `public/r/`、说明文件或无关的上游示例图片，`public/` 原件仍保留只读。
禁止为消除构建错误改写上游源码或重生成完整性基线。
