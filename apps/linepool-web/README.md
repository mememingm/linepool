# LINEPOOL React 网站

LP 应用目录为 `linepool-ui/`，包含 React 网站、NestJS API 和共享契约。旧 Vue 项目已移除。整个工作目录还保留独立的 ONCE 应用与 Webhook 联调工具，见[仓库导航](../docs/README.md)。

LP本机真实PinClode登录已由用户实际完成，应用编码为linepool；普通PC8保留USER/PINCLODE和自有代理连接。用户选择先用PC8验证两站后，已在原5433 sandbox限定该连接运行真实worker，本站持久号码119个，其中2个在线，历史代理短信238条；新手动SMS仍待逐跳验收。用户随后要求搁置同步，本会话创建的两站worker已停止，数据和前后端保留。应用配置见[部署说明](../../deploy/README.md#pinclode-本机应用登记)，实际目标及服务边界以[总执行文档](../../docs/handoff/lp-once-v41-master-plan.md)最新记录为准；LP自营平台映射和支付不随之开启。

共享契约、LP/ONCE前端和core构建、LP严格类型及两项upstream检查已通过。号码和代理短信页面查询本站本地库，不能把历史短信当作本轮手动SMS已成功接收。密钥仅在忽略的私有配置，不进入网页或本文。

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
└── docs/                    上游接口文档与自查清单
```

服务器部署说明与配置模板见仓库根目录的 [deploy/README.md](../deploy/README.md)。

## 页面入口

- `/`：首页，提供注册和登录入口。
- `/register`：注册，成功后进入工作台。
- `/login`：登录，成功后进入工作台；已有会话时直接进入。
- `/app`：工作台总览，未登录时跳转登录页。
- `/app/purchase`、`/app/numbers`、`/app/inbox`、`/app/orders`、`/app/points`、`/app/account`、`/app/settings`、`/app/regions`：业务子页。
- 详情沿用 `/app/regions/:id`、`/app/services/:id`、`/app/offers/:region/:service/:plan`、`/app/orders/:uuid`。

- `/admin`、`/admin/users`、`/admin/numbers`、`/admin/products`、`/admin/orders`、`/admin/renewals`：管理概览及五个管理模块，仅平台管理员可访问。
- `/agent`：PinClode 代理概览，复用原代理侧栏（分组菜单）、顶栏、指标卡和图表面板；显示四项指标、近期接码数量（今日/7 天/30 天，按最近 100 条短信统计并标注是否完整）、号码状态分布、代理账号与最近短信。
- `/agent/inventory`、`/agent/products`、`/agent/messages`、`/agent/connection`、`/agent/settings`：号码库存（状态/国家/号码筛选、分页、详情抽屉、CSV 导出，`?state=AVAILABLE` 可直接筛选）、套餐价格（汇总条与套餐表）、验证码短信（范围与等待汇总、按号码查看）、PC 连接（授权与能力）及代理设置（身份与主题），支持直接打开、刷新和前进后退。查看短信携带 `numberId`；切号和离开短信页清理等待。页面源码在 `src/linepool/agent/pc/`，`AgentAdminShell.tsx` 只负责身份分流和外壳。

代理数据来自 `GET /api/pc/session` 和 `GET /api/pc/messages`，只查询当前可信代理自己的本地连接数据；刷新页面不发起上游同步。首次同步未完成时明确提示，零条本地记录不代表 PC 没有号码。套餐管理、已读、等待及重授权沿用现有 PC 接口。本站 LOCAL 用户仍使用 `/app`，ADMIN 使用 `/admin`；客户、下级、采购、余额划转及结算不在当前代理工作台开放，代理自行站外收款。

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
- `npm run typecheck:all`：契约、前端和后端的类型检查。
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
| POST | `/inbox/wait` | 为本人有效平台服务登记、续等或取消等待，输入 `allocationId`、`waiting` |
| PATCH | `/account/profile`、`/account/preferences` | 账户资料、偏好设置 |
| GET | `/health` | API 和数据库健康检查 |

成功详情返回 `{ data: ... }`，分页列表返回 `{ data: [...], pagination: ... }`；积分接口的 `data` 为 `{ balance, entries }`。失败返回 `{ error: { code, message, details? } }`。分页从 1 开始，默认每页 20 条，最多 100 条；筛选字段和精确输入以共享契约为准。

收件箱选择具体有效平台服务后可开始等待、续等或停止；“全部号码”只查询本站消息。等待期间每5秒刷新本站数据，上游拉取仍由本站worker执行。等待需求绑定准确的allocation及会话，TTL受服务、号码资源和会话有效期约束；worker复核期间归属及释放状态。切号、离页和退出清理等待，超时回落到常规频率；代理原有`/pc/wait`及权限保持独立。

这条自营等待链路需要`045_pc_self_service_wait.sql`的nullable `allocation_id`列。共享worker查询引用该列，两站目标都需先按具体授权应用迁移，再启动新后端构建。本机两个功能sandbox已在`RUN-20261107-llinepool-29068-03`追加045并恢复后端；这不代表测试服务器或正式环境已经部署。

认证使用 `HttpOnly` Cookie `linepool_react_session`，不是 JWT 或 API Key。Cookie 路径为 `/`，以便服务端校验受保护页面；生产环境启用 `Secure`，`SameSite=Lax`；浏览器客户端使用 `credentials: include`。共享登录页检查会话时会将旧版 `/api` 路径 Cookie 迁移至 `/`，不延长会话有效期；退出同时清除两种路径。所有写请求还必须携带与 `WEB_ORIGIN` 完全一致的 `Origin`。默认同域部署，不建议直接改为跨站 Cookie。

网站接口使用内部会话 API。后端由 `PC_MODE` 明确选择 Mock 或真实 PinClode，真实号码/消息由worker按连接拉取；保留的 `/api/webhooks/pingcode` 及验签协议只服务受控Mock演示，详见 [API / Webhook 接入指南](docs/api-webhook-integration-guide.md)。真实适配不意味着已通过真实账号联调，LP平台项目不能从短信内容推断。密钥只保存在后端，不写入 `VITE_*` 或前端代码。对外开放业务接口仍需另行约定鉴权、权限和限流。

## 平台管理员

本阶段所有管理数据只来自本地 PostgreSQL，不请求 PingCode 或其他上游 API。登录后按服务端返回的 `User.role` 与 `authKind` 导航：`ADMIN` 进入 `/admin`，其他 `PINCLODE` 身份进入 `/agent`，本站 `LOCAL` 普通账号进入 `/app`；前端查询参数不能授予后台权限。管理员与代理的账户菜单均提供「返回首页」和切换本站账号入口；切换使用 `/login?switchAccount=local&redirect=%2Fapp`，进入或取消不会注销当前会话或撤销 PC 连接授权，取消时返回当前身份对应的页面，登录或注册成功后清理查询缓存并按新账号身份导航。React 后台与 Vite dev/preview 的 403 页也提供首页和切换入口。`USER` 不能访问后台；未登录不能访问 `/app` 或 `/admin`。Vite dev/preview 和部署用 Nginx 模板均在返回受保护页面前调用现有会话守卫；普通用户手动输入后台地址返回 403，未登录跳转 `/login`。所有 `/api/admin/*` 继续通过 `SessionGuard` 和 `AdminGuard` 校验数据库中的当前角色，`GET /api/admin/session` 提供受守卫保护的后台访问检查。生产部署必须使用包含 `auth_request` 的模板，详见 `../deploy/README.md`。

首次LOCAL管理员授权从仓库根目录执行。先注册有效本站账号，并在已按具体目标批准准备好的数据库上，显式选择对应`CORE_ENV_FILE`；通过`npm.cmd run admin:grant -- --help`查看当前命令。`--email=...`只允许已有ACTIVE LOCAL账号初始化首位管理员，不创建账号或重置密码；已有管理员时不能用它提权其他账号。新注册用户固定为USER。

PC身份使用独立的`--pc`模式，按database/site/application/issuer/subject精确定位已有可信身份，缺省只读预览；审阅并获准具体目标后才使用同范围的`--target=<预览用户UUID> --apply`。它不依赖用户名或邮箱，也不假设上游SSO返回管理员角色。授予会撤销该用户会话，需通过原可信PC身份重新登录；回调保留已授予ADMIN，新PC身份仍创建为USER。命令、私有配置选择和审批范围见[部署说明](../../deploy/README.md)，实际本机状态见[总文档](../../docs/handoff/lp-once-v41-master-plan.md)。

当前本地开发库的 `demo@linepool.local` 已授权为管理员；生产环境需使用独立正式账号和密码，不得沿用演示凭据。

已开放用户启停、用户密码重置、号码分配/回收/上下架、商品创建/编辑及订单查询。写入要求操作原因，并在同一数据库事务内记录 `admin_audit`。禁用用户会撤销会话；号码回收保留 `number_allocations` 归属历史、原订单与原用户短信，且不会自动重新上架。商品变更不重写已购订单，新增订单记录购买时的商品快照。

LP商品区分一次性接码与7／30天托管。一次性每单一个号码：先冻结积分，号码交付起15分钟内PC实际收到的有效首码使接码结果SUCCESS并结算；同步晚于截止仍按原接收时间处理。到时未完成完整窗口核对保持WAITING，不能先释放库存；确认窗口无有效码才FAILED并全额释放。成功订单只回看首码，不再取得新码。托管保留每单1–10个号码，从实际交付起完整168／720小时，不加本地总条数限制、不自动续期。两种成功销售的实际号码＋平台永久禁售；一次性确认失败后才可按正常库存条件再售。重试按钮和次数本轮不实施。

后台「商品」可选择接码模式、明确填写报价，并配置平台专用验证码规则：精确发送者、完整短信前/后文本与数字位数；未启用规则的一次性商品不能购买，规则版本随成交快照保存。后台号码/订单的分配历史提供「查看接码窗口」：展示原scope、窗口及本地候选；完整来源核对须填写引用、实际核对时间，并明确声明完整窗口无有效码。未决/隔离/冲突、本地证据变化或窗口未结束会阻止失败确认。本地空集、分页完成和创建时间checkpoint不构成上游完整窗口证明。

上述接口为`GET/PUT /api/admin/platforms/:platformId/code-rule`及`GET/POST /api/admin/allocations/:allocationId/receiving-review`，仍由当前本站ADMIN守卫及审计保护。新增源码依赖`047_lp_receiving_products.sql`；本机是否应用、是否重启及业务验收以总文档最新RUN为准，不因源码或构建存在自动执行迁移/写库。真实自营平台归属协议仍未确认，保留`PC_PLATFORM_PROJECT_UNCONFIRMED`拒绝，不自动恢复真实收信。正式价格、真实上游能力和专项执行范围见[接码规则](../../docs/design/lp-code-receiving-and-validity-review-20261107.md)。

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
