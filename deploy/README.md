# Linux 服务器部署

本文以单机 Nginx + Node.js + PostgreSQL 为例，模板尚未在实际服务器启用。域名、证书和安装路径需要替换为目标环境的值。

## 目录与依赖

建议每次发布使用独立目录 `/srv/linepool/releases/<版本>/`，`/srv/linepool/current` 指向当前版本。版本目录包含整个仓库源码，但不包含本机 `node_modules/`、`.env`、`.local/`、日志、浏览器记录或 `output/`。安装 Node.js 22+、npm、PostgreSQL（建议 17+）和 Nginx。

只在 `linepool-ui/` 执行 `npm ci`，使用该目录唯一工作区锁文件。不要单独在 `backend/` 或 `packages/contracts/` 安装，也不要把 Windows 的依赖目录拷到 Linux。

```sh
cd /srv/linepool/releases/<版本>/linepool-ui
npm ci
npm run build:all
npm run typecheck:all
npm run verify:catalog-upstream
```

`typecheck:all` 仅编译检查，包括已有测试源码；不会执行测试。构建时需要开发依赖，不要先执行 `npm ci --omit=dev`。

产物与运行依赖：

| 路径（相对 linepool-ui） | 用途 |
| --- | --- |
| `web-dist/` | Nginx 网站根目录 |
| `backend/dist/` | API 及数据库脚本的编译产物 |
| `backend/db/migrations/` | SQL 迁移文件，必须保留 |
| `packages/contracts/dist/` | API 运行时共享契约，必须保留 |
| `node_modules/`、各 workspace 的 package.json | npm 工作区依赖与链接 |

前端默认使用同域 `/api`，无需配置 `VITE_LINEPOOL_API_URL`。该变量若被设置，会进入构建产物；更改后需要重新构建。

## 数据库与环境变量

由数据库管理员创建独立应用角色和数据库，使应用角色可在自己的 schema 中执行迁移；不要使用 PostgreSQL 超级用户作为 API 账号。

将 `deploy/backend.env.example` 复制为 `linepool-ui/backend/.env`，替换 `DATABASE_URL` 与 `WEB_ORIGIN`。`WEB_ORIGIN` 必须是实际 HTTPS origin，不含尾部斜杠。数据库密码中的特殊字符需进行 URL 编码。文件应只允许服务账号读取，不纳入 Git。每个发布目录都需要配置这个文件。

执行迁移前备份数据库：

```sh
cd /srv/linepool/releases/<版本>/linepool-ui
npm run db:migrate
```

迁移命令依赖上一步构建产物。不要在服务器运行 `db:local:setup`，该脚本用于本机开发数据库。

**当前业务数据仍来自演示实现。** 迁移只建表，不导入地区、报价或号码库存；生产模式禁止 `db:seed`，且 `admin` 登录别名不可用。上线真实业务前需要准备正式目录和库存导入流程；真实支付、短信供应商等能力不在本次结构整理范围内。不要为了填充数据把生产模式改为 development。

## API 与 Nginx

创建 `linepool` 服务账号，让它能够读取应用、依赖及 `.env`。将 `current` 指向已构建的版本。按实际路径修改并安装 `linepool-api.service.example` 为 `/etc/systemd/system/linepool-api.service`，确认 Node.js 的绝对路径，然后：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now linepool-api
curl --fail http://127.0.0.1:3010/api/health
```

将 `nginx.conf.example` 中的域名、证书路径和静态目录改为实际值。先准备有效 TLS 证书，再把配置放入 Nginx 已包含的站点配置目录：

```sh
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://<实际域名>/api/health
```

模板保留 `/api` 前缀。`/app`、`/app/*`、`/admin`、`/admin/*` 在返回页面前通过 Nginx `auth_request` 调用现有 API 守卫：未登录跳转 `/login`，普通用户访问后台返回 403；后台 API 仍独立验证管理员权限。Nginx 必须启用 `ngx_http_auth_request_module`（可用 `nginx -V` 检查），不能去掉页面校验而只保留 SPA 回退。API 不可用时页面拒绝访问。

会话 Cookie 使用 `Path=/`、HttpOnly、SameSite=Lax；生产环境仍需要 HTTPS。升级前的 `Path=/api` Cookie 会在共享登录页调用 `/api/auth/me` 时迁移，保留数据库中的原会话到期时间。退出同时清除两种路径。API 监听本机 `127.0.0.1:3010`。Vite dev/preview 仅用于开发或本地预览，也执行相同的页面身份检查。

Nginx 静态根目录只能指向 `web-dist/`，不能指向仓库或 `linepool-ui/`。网站构建会排除组件注册表、说明文件和无关示例图片；不要另外把 `public/`、`catalog/`、`src/`、`.env` 或数据库目录复制到静态根目录。服务器保留的源码和构建依赖不是公开静态资源。

当前 API 的限流以直接连接的 IP 为依据。在 Nginx 后面所有用户可能共享代理 IP 的限额（120 次/分钟）；开放多用户访问前，需要按服务器代理层数配置并验证可信代理与限流策略。本次不改动业务服务器的信任设置。

## API 对接

当前网站接口、会话方式、响应格式和真实业务缺口统一见 [应用 README](../linepool-ui/README.md#api-对接边界)，字段以 `linepool-ui/packages/contracts/src/index.ts` 为准。生产环境不要公开数据库端口或把供应商密钥写进 `VITE_*`。代码已有独立验签的 PingCode Webhook 接收入口，见 [API / Webhook 接入指南](../linepool-ui/docs/api-webhook-integration-guide.md)，真实上游链路仍待联调；网站会话 API 也不能直接当作已完成的第三方开放 API 服务发布。

## 发布核对与回退

在目标服务器检查登录、注册、退出以及 `/app/*` 的直接访问和刷新，确认会话 Cookie、API 和数据库连接正常；本地构建成功不能代替这些检查。

更新时先备份数据库，在新版本目录安装和构建，确认迁移与旧版本兼容后执行迁移，再切换 `current` 并重启 API。保留上一个版本目录。回退代码可把 `current` 指回旧版本并重启服务；数据库迁移不会自动回退，不兼容的迁移需要单独制定数据恢复方案。
