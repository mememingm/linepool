# LINEPOOL React 网站

LP 应用目录为 `linepool-ui/`，包含 React 网站、NestJS API 和共享契约。旧 Vue 项目已移除。整个工作目录还保留独立的 ONCE 应用与 Webhook 联调工具，见[仓库导航](../docs/README.md)。

当前供号与收信仍装配 Mock provider，真实 PC、支付和生产验收待推进。文档阅读入口见[应用文档索引](docs/README.md)。

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
- `/agent`、`/agent/customers`、`/agent/inventory`、`/agent/pricing`、`/agent/balance`、`/agent/ledger`：代理概览、客户、库存、定价、余额与账本。

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
             |-- /、/login、/register、/app/*、/admin/*、/agent/* -> web-dist（React + Vite）
             `-- /api/* -> NestJS（127.0.0.1:3010）-> PostgreSQL
```

前端的所有业务请求经 `src/linepool/api/client.ts`；后端由 `backend/src/controllers.ts` 接收请求，认证、查询和下单分别在 `authentication.ts`、`workspace.ts`、`ordering.ts`。`packages/contracts/src/index.ts` 是前后端共用的字段和 Zod 校验来源，不再复制第二份接口类型。

当前为单体 API，无 Redis、消息队列或微服务；管理员后台与用户端共用一个 React 站点及账号体系。会话保存在 PostgreSQL；下单在一个事务内完成库存分配、积分扣减和订单记账，通过用户级 UUID 幂等键避免重复扣款。数据库结构由 `backend/db/migrations/` 顺序迁移并校验文件摘要，已应用的迁移不能直接修改。

## API 对接边界

所有路径以 `/api` 开头，请求体为 JSON。网站业务接口使用登录会话；登录、注册、健康检查和采用独立验签协议的 Webhook 按各自规则处理。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/auth/register`、`/auth/login`、`/auth/logout` | 注册、登录、退出 |
| GET | `/auth/me`、`/account` | 会话、账户信息 |
| GET | `/catalog`、`/dashboard` | 可购目录、工作台汇总 |
| GET | `/numbers`、`/orders`、`/orders/:id` | 号码、订单、订单详情 |
| POST | `/orders` | 购买号码，含 `idempotencyKey` UUID |
| GET | `/numbers/:id/renewal-options` | 新续费已关闭，返回 `RENEWAL_DISABLED` |
| POST / GET | `/numbers/:id/renewals` | 新建续费申请已关闭；GET 保留本人历史申请查询 |
| GET | `/numbers/:id/usage` | 查询套餐用量；Mock 支持 `scenario` 演示场景 |
| GET | `/inbox`、`/points` | 短信、积分及流水 |
| POST | `/inbox/read` | 标记短信已读 |
| PATCH | `/account/profile`、`/account/preferences` | 账户资料、偏好设置 |
| GET | `/health` | API 和数据库健康检查 |

成功详情返回 `{ data: ... }`，分页列表返回 `{ data: [...], pagination: ... }`；积分接口的 `data` 为 `{ balance, entries }`。失败返回 `{ error: { code, message, details? } }`。分页从 1 开始，默认每页 20 条，最多 100 条；筛选字段和精确输入以共享契约为准。

认证使用 `HttpOnly` Cookie `linepool_react_session`，不是 JWT 或 API Key。Cookie 路径为 `/`，以便服务端校验受保护页面；生产环境启用 `Secure`，`SameSite=Lax`；浏览器客户端使用 `credentials: include`。共享登录页检查会话时会将旧版 `/api` 路径 Cookie 迁移至 `/`，不延长会话有效期；退出同时清除两种路径。所有写请求还必须携带与 `WEB_ORIGIN` 完全一致的 `Origin`。默认同域部署，不建议直接改为跨站 Cookie。

网站接口使用内部会话 API。后端已有 `/api/webhooks/pingcode` 接收入口与验签实现，详见 [API / Webhook 接入指南](docs/api-webhook-integration-guide.md)；这不代表已通过真实 PC 联调，当前收信 provider 仍装配 Mock。真实号码 / 短信供应商须在 NestJS 后端接入并保管密钥，不将密钥放入 `VITE_*` 或前端代码。对外开放业务接口需要另行约定服务端鉴权、权限和限流。

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

已开放用户启停、用户密码重置、号码分配/回收/上下架、商品创建/编辑及订单查询。写入要求操作原因，并在同一数据库事务内记录 `admin_audit`。禁用用户会撤销会话；号码回收保留 `number_allocations` 归属历史、原订单与原用户短信，且不会自动重新上架。商品变更不重写已购订单，新增订单记录购买时的商品快照。

当前 LP 提供 7 / 30 天短期收信，新续费已关闭；后台保留历史续费记录供核对。历史申请及手工到期时间调整均不代表实际续费成功。真实支付、退款与短信上游接入仍待推进。

## 找回与重置密码

登录页的「忘记密码？」进入 `/forgot-password`，向注册邮箱发送重置链接；`/reset-password` 接收邮件链接并设置新密码。先执行 `npm run db:migrate` 应用 `023_password_recovery.sql`，在后端环境中配置 `SMTP_HOST`、`SMTP_FROM` 及 `SMTP_PORT`、`SMTP_SECURE`；需要认证时同时填写 `SMTP_USER` 和 `SMTP_PASSWORD`。邮件链接使用 `WEB_ORIGIN`，生产环境须为本站 HTTPS origin。端口 587 通常使用 `SMTP_SECURE=false`，生产强制 STARTTLS；端口 465 使用 `SMTP_SECURE=true`。示例见 `backend/.env.example` 与 `../deploy/backend.env.example`。更改环境配置后重启 API。

找回接口为 `POST /api/auth/forgot-password`（`email`），重置接口为 `POST /api/auth/reset-password`（`token`、`newPassword`）。令牌随机生成，仅以 SHA-256 摘要保存，链接 30 分钟有效且只能使用一次，同一账号 60 秒内不重复发信。对不存在、禁用或处于发送冷却期的邮箱均返回相同受理结果；SMTP 未配置时明确提示联系管理员，发送失败会在服务端记录不含令牌与邮箱的错误。链接令牌保存在 URL fragment，避免进入 HTTP 请求和访问日志。

管理员在「用户管理」点击「重置密码」，填写新密码、确认密码和操作原因，通过 `POST /api/admin/users/:id/reset-password` 提交（`newPassword`、`reason`）。此入口只处理普通用户，管理员账号使用邮箱找回。操作在同一事务内更新密码、撤销该用户全部会话与旧找回令牌，并记录 `USER_PASSWORD_RESET` 审计；日志不含密码或密码摘要。邮箱找回完成后也撤销全部会话；修改账户邮箱、修改密码或禁用账户会使旧找回链接失效。未配置 SMTP 时，管理员直接重置仍可使用。

## 历史续费与套餐用量

历史版本曾提供 7 / 30 / 90 天本地续费申请演示，并通过 `005_number_services.sql` 保存记录。当前客户续费入口已移除，方案查询和创建申请均返回 `RENEWAL_DISABLED`；历史记录仍保留，不能按照旧交接文档新建续费。7 / 30 天短期服务的产品背景见[历史项目总结](../docs/archive/linepool/LINEPOOL-项目总结.md)。

用量由后端 Mock 返回，短信单位为条、语音为分钟、流量为 MB。窗口醒目标注「模拟数据」，支持标准套餐、不限量、无套餐、不支持查询、接口异常五种演示场景，并显示模拟快照更新时间；加载或请求失败时不补造剩余额度。演示快照时间在 API 启动时确定，刷新查询不会冒充新的实际采集时间。

数据获取位于 `backend/src/number-service-provider.ts`，共享契约位于 `packages/contracts/src/number-services.ts`，UI 位于 `src/linepool/workspace-reference/NumberServices.tsx`。这些都是 LINEPOOL 内部接口，不是 PingCode 请求或返回格式。当前由 NestJS 在 `backend/src/main.ts` 将 `NumberServiceProvider` 绑定到 `MockNumberServiceProvider`。未来在服务端实现适配器并替换此绑定，前端保持使用现有内部接口，密钥不进入浏览器。

PingCode 接入前需确认：

- 号码/租赁实例的稳定标识、鉴权和查询权限；可续费时长、权威报价/计价单位、预计到期规则及报价有效期。
- 续费申请的幂等语义、供应商申请标识、待处理/成功/失败状态、超时后的查询核对，以及失败原因。
- 可信成功确认方式（状态查询或可验签、可防重放的回调）、实际新到期时间、付款确认及执行凭证。申请回执不等于续费成功；需在后端核对当前归属及申请状态后，在同一事务内更新续费记录、号码和分配记录的有效期，并处理重复/乱序确认。前端只在服务确认成功后刷新原有号码与倒计时数据。
- 短信、语音、流量的总量/已用/剩余量、单位和套餐周期、是否不限量；无套餐/不支持/错误的可区分状态、采集时间、缓存时效、限流与错误重试规则。

上述续费和用量事项保留为历史接入清单，当前产品不开放新续费。收信 Webhook 的现有实现与联调边界见 [API / Webhook 接入指南](docs/api-webhook-integration-guide.md)。未开放客户端修改续费状态的入口。

## 上线前未完成项

当前账户与订单确实读写 PostgreSQL，但目录、号码库存、短信仍是演示实现，随机号码不代表可收短信的实际号码。共享契约和映射仍固定 `isDemo: true`，地区及服务选项仍固定，套餐标识已支持管理员创建；C 端订单契约仍仅有 `COMPLETED`，后台单独展示本地积分结算与交付状态。接真实供应商时需要同时确认这些契约及异步状态，不能仅替换 API URL。

生产环境禁止演示种子导入；空数据库迁移后没有可购目录、库存或积分充值渠道。尚未实现真实支付、短信接入与邮箱验证；邮件找回密码需配置 SMTP。当前状态适合部署演示或联调环境，不应宣称真实业务已经可用。

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
