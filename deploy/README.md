# Linux 服务器部署

本文以单机 Nginx + Node.js + PostgreSQL 为例，模板尚未在实际服务器启用。LP 和 ONCE 使用同一份核心代码，分别部署 API、worker、网站与逻辑数据库。域名、证书和安装路径需要替换为目标环境的值；建库、设置数据库标记、迁移、启动会写库的 worker 和切流量仍须按 v4.2 总文档取得具体执行授权。

## 目录与依赖

建议每次发布使用独立目录，例如 LP 的 `/srv/linepool/releases/<版本>/`、ONCE 的 `/srv/once/releases/<版本>/`，各自的 `current` 指向本站版本。版本目录包含整个仓库源码，但不包含本机 `node_modules/`、`.env*`、`.local/`、日志、浏览器记录或 `output/`。安装 Node.js 22.12+、npm、PostgreSQL（建议 17+）和 Nginx。

只在仓库根目录执行 `npm ci`，使用根目录唯一工作区锁文件。不要单独在 `services/core/` 或 `packages/contracts/` 安装，也不要把 Windows 的依赖目录拷到 Linux。

```sh
cd /srv/linepool/releases/<版本>
npm ci
npm run build:all
npm run typecheck:all
npm --prefix apps/linepool-web run verify:catalog-upstream
```

根 `build:all` 与 `typecheck:all` 覆盖 contracts、LinePool 前端、ONCE 前端和 core。ONCE 的 build 包含 `tsc --noEmit`；这些命令不执行测试。构建时需要开发依赖，不要先执行 `npm ci --omit=dev`。

产物与运行依赖：

| 路径（相对仓库根目录） | 用途 |
| --- | --- |
| `apps/linepool-web/web-dist/` | Nginx 网站根目录 |
| `apps/once-web/dist/` | ONCE Nginx 网站根目录 |
| `services/core/dist/` | API、worker 及数据库脚本的编译产物 |
| `services/core/db/migrations/` | SQL 迁移文件，必须保留 |
| `packages/contracts/dist/` | API 运行时共享契约，必须保留 |
| `node_modules/`、各 workspace 的 package.json | npm 工作区依赖与链接 |

两个前端分别通过本站同域 `/api` 连接本站 API；不能把 ONCE 代理到 LP 实例。LinePool 的 `VITE_LINEPOOL_API_URL` 若被设置，会进入构建产物；更改后需要重新构建。ONCE 本机代理默认 `127.0.0.1:3011`，LP 保持 `3010`，legacy ONCE 的 `3000` 不受这些模板影响。

## 数据库与环境变量

由数据库管理员分别准备 LP 与 ONCE 的独立应用角色和逻辑数据库，不共享用户、会话或资金，不使用 PostgreSQL 超级用户作为应用账号。API 与 worker 使用本站同一个 `DATABASE_URL`；客户端 header、body 或 URL 不能选择数据库。

LP 将 `deploy/backend.env.example` 复制为本站 `services/core/.env`；ONCE 将 `deploy/once-backend.env.example` 复制为本站 `services/core/.env.once`。替换本站连接与域名，数据库密码中的特殊字符需 URL 编码。配置文件仅供本站服务账号读取，不纳入 Git。

| 配置 | LP | ONCE |
| --- | --- | --- |
| `SITE_ID` | `linepool` | `once` |
| `PRODUCT` / `ENABLED_MODULES` | `SMS_CODE` | `NUMBER_LEASE` |
| API 本机默认端口 | `3010` | `3011` |
| 开发前端 Origin | `http://127.0.0.1:5178` | `http://127.0.0.1:5174` |
| Cookie 名 | `linepool_react_session` | `once_core_session` |
| 数据库 `app.site_id` 标记 | `linepool` | `once` |

`WEB_ORIGIN` 是本站完整 Origin，不含尾部斜杠；`SELF_SERVICE_ORIGINS` 为明确的逗号分隔准入列表，默认仅本站 `WEB_ORIGIN`，不能用通配符。`PASSWORD_RESET_URL` 默认 `${WEB_ORIGIN}/reset-password`，可配置本站实际落地路径，必须属于准入 Origin，不能预带查询或 fragment；重置令牌只追加在 fragment 中。生产 Origin 必须使用 HTTPS。两个本机端口不能隔离同名 Cookie，因此 ONCE 使用独立 Cookie，既不接受旧 `once_session` 也不接受 LP Cookie。

`SITE_ID` 决定产品与模块边界。`PRODUCT` 或 `ENABLED_MODULES` 若指定另一站产品，启动直接拒绝；`ENABLED_MODULES` 缺省启用本站产品，显式空值停用该业务 API 和任务，但保留账号及历史读取。模块开关不建删表。旧 `agent-inventory` 的受控 GET 历史接口保留，所有写入都返回 `LEGACY_DISTRIBUTION_DISABLED`；旧持有到期任务与分货 seed npm 入口停用，不删除历史表。

API 和 worker 在 Nest 生命周期启动前只读检查 `current_setting('app.site_id',true)`。必须在另行授权的数据库准备中预设本站标记；缺失或不匹配会拒绝启动，应用不会自动创建标记、建库、迁移或初始化账户。

每站配置独立的 `PC_APPLICATION_ID`、`PC_ISSUER` 与 `PC_AUTH_CALLBACK_URL`。默认回调是 `${WEB_ORIGIN}/api/pc/auth/callback`，走本站代理。`PC_MODE=mock` 为缺省；`PC_MODE=real` 使用官方应用 SSO 与 `/api/app/v1`，还需配置 `PC_BASE_URL`、服务端 `PC_CLIENT_SECRET`、权威号码地区 `PC_NUMBER_REGION`，并先在指定目标应用 `046_pc_real_provider.sql`。收信能力由站点产品确定；额外的 `PC_NUMBER_CAPABILITIES` 留空表示仅收信，明确具备发信能力时设为 `SEND_SMS`。真实请求失败不会回退 Mock。应用登记和本机准备见下节。

`PC_POLL_IDLE_SECONDS=60`、`PC_POLL_WAIT_SECONDS=5`、`PC_WAIT_SECONDS=120`、`PC_REFRESH_EARLY_SECONDS=300` 是本站调度配置，不是官方限额。`PC_MOCK_REFRESH_MODE` 只影响 Mock。自营外部账号分别由 `PINGCODE_EXTERNAL_ACCOUNT_ID`、`ONCE_PINGCODE_EXTERNAL_ACCOUNT_ID` 选择；真实连接必须使用独立准备的真实来源行，不可改绑现有 Mock 连接。

### PinClode 本机应用登记

在「应用服务 → 应用管理」分别登记两站应用；本轮已通过上游公开client查询确认LP实际编码为`linepool`，ONCE仍使用下面的建议值。`PC_APPLICATION_ID`必须使用后台实际编码，不能把应用名称或本机建议值代入。

| 字段 | LinePool 本机 | ONCE 本机 |
| --- | --- | --- |
| 应用编码 | `linepool`（上游已确认） | `once-local`（建议） |
| 名称 | LinePool 本机联调 | ONCE 本机联调 |
| 首页 URL | `http://127.0.0.1:5178/agent` | `http://127.0.0.1:5174/agent` |
| 登录回调 URL | `http://127.0.0.1:5178/api/pc/auth/callback` | `http://127.0.0.1:5174/api/pc/auth/callback` |

首页供用户进入代理工作台；回调由本站 Vite `/api` 代理转给本站 API。使用浏览器的电脑须运行这两个本机网站，`127.0.0.1` 不能作为其他设备或服务器的回调。发布应用后，测试 PC 账号须先在目录开通本站应用。GooseMsg 只作填写方式参考，不复用其应用编码、地址或密钥。

本机先准备独立的真实 PC 联调数据库与角色、本站标记、目录和真实自营连接，再按具体授权执行至046；API与worker使用同一站配置。当前功能sandbox仍保留 Mock 历史和不可改绑连接，不直接切成真实来源。尤其031会创建Mock账号，占据041的单个自营连接约束；新目标的初始账号处置及真实来源行须在具体准备方案中列明，不自动覆盖或删除。上述登记地址不授权建库、迁移或写库联调。

若仅先做LP真实代理授权/自有号码收信，可在具体授权下复用现有LP sandbox并追加046，保留原Mock自营及代理行；新真实代理由独立app/issuer/subject建立，不触碰单个自营连接约束。这与后续替换真实自营来源的准备范围不同，不要求为了代理联调先新建库。实际应用编码及号码国家必须确认，不能把上表建议编码或Mock号码地区当成事实。

自营真实连接的`provider`为`pingcode`，`external_account_id`及本站对应的`PINGCODE_EXTERNAL_ACCOUNT_ID`／`ONCE_PINGCODE_EXTERNAL_ACCOUNT_ID`使用该PC账号可信`subject`（文档定义为用户ID字符串），不是用户名。`PC_ISSUER`使用运营为该真实部署确定的独立签发方标识，例如本机联调的`http://120.55.75.51/pingcode`。原Mock标识不能作为真实来源继续沿用。首次自营授权仍要求本站管理员会话，后续只能由原subject重新授权。

官方号码对象没有地区或LP项目映射，地区必须由运营确认，未知有效期不补造。LP自营按平台交付仍待真实项目协议，代理可先授权并读取自有号码/消息。ONCE的站内租约只覆盖已经同步、期限足够的号码；续租不调用PC资源延期。发送超时且没有取得`OUT-...`标识时保留未知，不能按未发送自动重发。实际发信联调须点明发送号码及接收方。

本机模板分别为 `services/core/.env.example` 和 `services/core/.env.once.example`。`LOCAL_SANDBOX` 缺省关闭，仅可在已准备的隔离本机 `_sandbox` / `_test` 库上显式启用；模板落盘不授权写库演示。

从仓库根目录选择进程，以下为执行授权后的命令入口：

| 进程 | 开发编译监听 | 已构建版本 |
| --- | --- | --- |
| LP API | `npm run api:dev` | `npm run api:start` |
| LP worker | `npm run worker:dev` | `npm run worker:start` |
| ONCE API | `npm run once:api:dev` | `npm run once:api:start` |
| ONCE worker | `npm run once:worker:dev` | `npm run once:worker:start` |

运行脚本跨平台设置 `PROCESS_ROLE=api|worker`，默认分别读取 `.env` / `.env.once`；需要不同配置路径时设置 `CORE_ENV_FILE`（相对 `services/core` 或绝对路径）。API 只开放 HTTP，不启动维护、收件箱恢复、轮询或到期任务。worker 使用 Nest application context，不绑定用户 HTTP 端口。`dev:all` 只启动 LP 网站、API 和契约编译，不隐式启动 worker。

授权后的 ONCE 运营 CLI 入口是 `npm run once:operator --workspace @linepool/react-backend -- <参数>`，读取 `.env.once`；API 同步操作只入队，由 worker 执行。导入与迁移仍按各自明确授权执行，不因存在脚本自动运行。

执行迁移前备份数据库：

```sh
cd /srv/linepool/releases/<版本>
npm run db:migrate
```

迁移命令依赖上一步构建产物。不要在服务器运行 `db:local:setup`，该脚本用于本机开发数据库。

**当前业务数据仍来自演示实现。** 迁移只建表，不导入地区、报价或号码库存；生产模式禁止 `db:seed`，且 `admin` 登录别名不可用。上线真实业务前需要准备正式目录和库存导入流程；真实支付、短信供应商等能力不在本次结构整理范围内。不要为了填充数据把生产模式改为 development。

### LP 管理员受控授权

PC 的公开 SSO 契约没有管理员角色。LP 不会自动识别或继承 PC 管理员权限，也不按用户名 `admin`、相同邮箱、前端 `role` 或未约定的上游字段提权。首次可信 PC 登录仍创建 `PINCLODE / USER`；只有本地受控流程对精确可信身份授予 `ADMIN` 后，该用户才具有 LP 管理员权限。再次 SSO 沿原站点、应用、issuer、subject 和 ACTIVE agent 登录，连接保持不可改绑，后台 API 继续由服务端会话和管理员 guard 鉴权。

已有 `admin:grant -- --email=existing-local-account@example.com` 仅用于首个 ACTIVE `LOCAL` 管理员 bootstrap；已有任何管理员后不能用它增加管理员，且它不接受 PC 身份。定向 PC 授权使用独立 `--pc` 模式，允许本站已有 LOCAL 管理员，但只接受 `SITE_ID=linepool`、`PC_MODE=real`、实际应用编码 `linepool`、精确配置的 issuer，以及已经持久化且与 ACTIVE 用户、agent 和真实连接一致的 `pc_agent_identities` 记录。命令不创建身份、不按邮箱找 PC 用户、不改绑连接；本文不宣称某个 subject 的绑定已经存在。

先在服务账户环境中设置 `CORE_ENV_FILE`，指向正在用于 LP 真实登录的已审阅配置（相对 `services/core` 或绝对路径）。入口按 `run-runtime` 的同一规则读取它，未指定时才用 `.env`；不要复制或输出其中密钥。`--database` 必须完整写成配置对应的 `host:port/database`，且只能是非 production 的本机直连目标。脚本在连接前比对该地址和 site/application/issuer，连接后再比对实际数据库、数据库角色、端口和 `app.site_id`，防止默认 `.env` 误选其他库。

以下从仓库根目录调用已有构建产物；`REVIEWED_TRUSTED_SUBJECT` 和 `REVIEWED_USER_UUID` 必须替换成用户点名并审阅的真实值。先执行只读预览，检查输出中的具体数据库/角色、完整 scope、identity/user/agent/connection UUID 和前后角色，再取得该具体 target 的执行批准。不要把示例占位符作为已有绑定或已获赋权批准的证据。

```sh
npm run admin:grant -- --help
npm run admin:grant -- --pc --database=127.0.0.1:5433/linepool_v42_sandbox --site=linepool --application=linepool --issuer=http://120.55.75.51/pingcode --subject=REVIEWED_TRUSTED_SUBJECT
```

仅在用户审阅并批准上述完整 scope 与 target 后，保持相同配置和参数，添加预览中对应用户 UUID 与 `--apply`：

```sh
npm run admin:grant -- --pc --database=127.0.0.1:5433/linepool_v42_sandbox --site=linepool --application=linepool --issuer=http://120.55.75.51/pingcode --subject=REVIEWED_TRUSTED_SUBJECT --target=REVIEWED_USER_UUID --apply
```

赋权在事务和相同身份锁内执行，只将该用户的 `USER` 改为 `ADMIN`、撤销该用户现有会话，并审计本机数据库操作者角色、精确 scope/target、前后角色及撤销会话数；完成后需用同一 PC 身份重新登录。已是 `ADMIN` 时重复执行不再改角色、撤会话或追加赋权审计。`--help` 在读取配置、构造 `Environment` 或连接数据库前退出。部署文档和命令入口本身不执行授权，本轮没有实际赋权或更改真实登录配置。

## API 与 Nginx

创建各站服务账号，使其只能读取本站配置。按实际安装位置调整 `linepool-api.service.example`、`linepool-worker.service.example` 或 `once-api.service.example`、`once-worker.service.example`，API 与 worker 必须使用同一站配置和相容版本。worker 不对外监听端口。下例仅在已获得具体启动授权后执行；ONCE 对应使用 `once-api` / `once-worker`：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now linepool-api
sudo systemctl enable --now linepool-worker
curl --fail http://127.0.0.1:3010/api/health
```

LP 使用 `nginx.conf.example`，ONCE 使用 `once-nginx.conf.example`；替换本站域名、证书路径与静态目录。ONCE 模板保留 SSE 流且关闭 API 响应缓冲，不能代理到 LP 或 legacy API。先准备有效 TLS 证书，再把配置放入 Nginx 已包含的站点配置目录：

```sh
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://<实际域名>/api/health
```

模板保留 `/api` 前缀。`/app`、`/app/*`、`/admin`、`/admin/*` 在返回页面前通过 Nginx `auth_request` 调用本站 API 守卫：未登录跳转 `/login`，普通用户访问后台返回 403；后台 API 仍独立验证 ACTIVE 会话与 ADMIN 权限。ONCE 管理会话端点为 `/api/once/admin/session`，LP 为 `/api/admin/session`。Nginx 必须启用 `ngx_http_auth_request_module`（可用 `nginx -V` 检查），不能去掉页面校验而只保留 SPA 回退。API 不可用时页面拒绝访问。

会话 Cookie 使用 `Path=/`、HttpOnly、SameSite=Lax；生产 Secure。登录、读取、注销和清理均使用本站 Cookie 名。LP 原 `Path=/api` Cookie 在 `/api/auth/me` 时迁移，保留数据库会话到期时间；退出只清理本站两种路径。两个站点之间没有 SSO。PinClode 代理不能通过自营订单、充值、租约或短信接口消费；账号展示与偏好仍可用，密码由身份提供方管理。

Nginx 静态根目录只能指向本站前端构建产物：LP 的 `apps/linepool-web/web-dist/` 或 ONCE 的 `apps/once-web/dist/`，不能指向仓库或源码目录。不要额外把 `.env*`、数据库目录或源码复制到静态根目录。服务器保留的源码和构建依赖不是公开静态资源。

模板将 API 绑定本机地址，代理覆盖 `X-Forwarded-For`；`TRUSTED_PROXY_IPS=127.0.0.1,::1` 仅信任列出的本机代理。部署时按实际代理地址配置，不回显客户端任意转发链。CORS 与写入 OriginGuard 使用同一准入列表，代理保留实际浏览器 Origin。

## API 对接

当前网站接口、会话方式、响应格式和真实业务缺口统一见 [应用 README](../apps/linepool-web/README.md#api-对接边界)，字段以 `packages/contracts/src/index.ts` 为准。生产环境不要公开数据库端口或把供应商密钥写进 `VITE_*`。PC 上游由本站 worker 按连接拉取；保留的验签 Webhook 仅用于受控本地 Mock 演示，不是实际 PC 推送依赖。历史入口说明见 [API / Webhook 接入指南](../apps/linepool-web/docs/api-webhook-integration-guide.md)。真实适配源码、构建结果与真实联调分别登记于总文档；网站会话 API 不能直接作为第三方开放 API 发布。

## 发布核对与回退

在目标服务器检查登录、注册、退出以及 `/app/*` 的直接访问和刷新，确认会话 Cookie、API 和数据库连接正常；本地构建成功不能代替这些检查。

更新时先备份数据库，在新版本目录安装和构建，确认迁移与旧版本兼容后执行迁移，再切换 `current` 并重启 API。保留上一个版本目录。回退代码可把 `current` 指回旧版本并重启服务；数据库迁移不会自动回退，不兼容的迁移需要单独制定数据恢复方案。
