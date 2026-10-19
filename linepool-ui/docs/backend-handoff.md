# React 后端交接

## 项目边界

- 当前前端是 `linepool-ui` 的 React 应用。`platform` 是旧 Vue 方案的只读参考，本次未修改。
- 后端位于 `linepool-ui/backend`，使用 Node.js 22+、NestJS 12、TypeScript、Zod、`pg` 与本机 PostgreSQL。
- 用户已明确：当前 API 只用于临时演示/联调，真实 API 后续由公司提供；数据库仍然必须完成，账户、订单、号码、短信、积分和偏好使用 PostgreSQL 持久化，不使用内存 mock 替代。
- 后续拿到公司接口后主要替换 React 请求适配层及 DTO 映射，不把当前临时 API 视为正式生产协议。
- 只使用已安装在 `D:/postgresql` 的本机 PostgreSQL 18，不使用 Docker。原有 `postgresql-x64-18` 服务仍在 `5432` 运行，本批未修改。
- 用户已授权启动独立本地实例，监听 `127.0.0.1:5433`，数据在 `backend/.local/postgres`，业务库为 `linepool_react`；不复用旧系统表，不修改现有 5432 的服务、认证规则或数据库。
- 工作台 `#workspace-reference-shell` 及其购买、号码、短信、订单、积分和账户页面已通过 `src/linepool/api/client.ts` 接入 API，不再读取本地 demo state。首页和其他独立设计展示入口未改成业务工作台。
- 后端仍是 PostgreSQL 持久化的临时联调 API。所有号码均为含 `DEMO` 标记的合成库存，短信来自明确标注的数据库种子；不支持真实收码、供应商接入或充值支付。

## 当前状态

- 已完成代码与依赖安装，前后端类型检查及构建通过。
- 独立 PostgreSQL 18.6 实例已初始化并运行在 `127.0.0.1:5433`；业务库 `linepool_react`、管理角色 `linepool_react_admin`、业务角色 `linepool_react` 已创建。
- `001_initial.sql` 迁移已执行并记录校验值，DEMO 种子已写入；初始化基线为 1 个用户、6 个地区、36 个报价、720 条号码库存（717 条可用）、3 笔订单、9 条短信、4 条积分流水。
- 初始化时账户余额和流水 delta 合计均为 1311；浏览器下单验收后余额为 1236，8 笔订单、8 个已分配号码、9 条短信，其中 2 条未读。业务角色没有超级用户、建库、建角色或复制权限。
- `backend/.env` 已自动配置可用的 5433 连接串。随机生成的管理与业务凭据保存在 `backend/.local/pg-credentials.json`；这两处及整个私有数据目录均已确认被 Git 忽略，文档不展示数据库密码。
- 临时 API 已启动，地址 `http://127.0.0.1:3010/api`；实际请求 `/api/health` 返回 `{ data: { status: 'ok', database: 'ok', mode: 'demo' } }`，API 错误日志为空。
- 原有 5432 服务仍运行，未改其账户、认证或业务数据。原项目现有账号可以连接但没有建库权限，因此本批采用用户批准的独立实例，而不是重置其管理员密码。
- 曾启动的独立 Docker 容器、网络和新建数据卷已移除；Docker Desktop 已停止，项目中的 compose 文件与 Docker 脚本已移除。
- 已完成 Playwright 浏览器端登录、目录加载、实际下单、幂等重试、订单详情、号码、短信已读、积分、偏好持久化，以及网络、500、非法响应、库存冲突、401、404 和移动端验收。正常链路 17 项、登录 3 项、错误与移动端 27 项检查通过，详见 [workspace-api-acceptance.md](workspace-api-acceptance.md)。
- 前端运行在 `http://127.0.0.1:5178/#workspace-reference-shell`，API 在 3010，私有 PostgreSQL 在 5433。重启后进程 PID 会变化，实际状态以端口及 `db:status` 为准。

## 本地启动

在 `linepool-ui` 目录执行。依赖已安装；换机器时再执行前两步。

```powershell
npm install
npm run api:install
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

首次初始化时使用本机 PostgreSQL 二进制。`POSTGRES_BIN` 默认是 `D:/postgresql/bin`，其他机器可在 `.env` 中调整；需要 PostgreSQL 18 的 builtin locale 支持。脚本生成随机密码、启用 SCRAM-SHA-256，并自动写入业务账号的连接串，无需现有 5432 管理员密码。

```powershell
npm run api:build
npm run db:local:setup
npm run db:migrate
npm run db:seed
npm run api:dev
```

日常启动（数据库和迁移已初始化后，不需要重复种子）：

```powershell
npm run db:start
npm run api:start
```

- `db:local:setup` 只处理 `backend/.local/postgres` 和私有实例中的固定业务库；可重复执行，不重置已有凭据，不重新初始化已有数据目录，不修改原有服务。它会更新 `.env` 的 `DATABASE_URL`，首次更新前的副本在 `.local/backend-env.before-local-postgres`。
- `db:status` 查看私有实例进程；`db:stop` 停止私有实例但保留数据；这些命令不会控制 `postgresql-x64-18` 服务。
- 私有实例不是新安装的 Windows 服务，机器重启后执行 `db:start`。数据在磁盘上持久保存，不会因 API 或 PostgreSQL 重启丢失。
- 初次启动时遇到 Windows 子进程继承管道导致 `pg_ctl` 等待超时，实例实际已经就绪。脚本已改成文件输出以避免捕获管道被后台进程占用，随后继续使用同一数据目录完成初始化，没有重建数据。
- 如未来明确要切回现有 5432 服务，可以提供已有具备 `CREATEDB` 权限的账号配置，再用保留的 `db:create` 创建固定 `linepool_react` 业务库。当前默认仍是授权的私有 5433 实例。
- 迁移在事务中执行，使用 advisory lock 串行化，并记录每份 SQL 的 SHA-256；已执行文件改动时拒绝继续。
- 种子也是事务性的、可重复执行；已有演示用户的密码、余额、订单和已读状态不会被重置。
- 种子提供 6 个地区、3 个服务、2 个套餐、720 条合成号码库存，以及演示用户的 3 笔历史订单、3 个号码、9 条样例短信。
- `DEMO_EMAIL` / `DEMO_PASSWORD` 来自 `.env`；本地登录名 `admin` 映射到 `DEMO_EMAIL` 指定的演示账户，默认密码为 `12345678`，原邮箱仍作为账户联系资料。别名只在非生产环境启用，且只能登录演示账户。注册和更换邮箱仍要求有效邮箱，密码仍至少 8 位。仅用于本地演示，生产模式禁止种子操作。
- `api:dev` 使用 `tsc-watch`，源码编译成功后重启 API。API 地址为 `http://127.0.0.1:3010/api`，启动前检查数据库连接。
- 只需运行已构建服务时使用 `npm run api:start`。启动中的 API 在另一终端运行，不要同时重复启动同端口进程。
- 数据库日志在 `.local/postgres.log`，二进制操作输出在 `.local/postgres-bootstrap.log`，本轮后台启动的 API 日志在 `.local/api.stdout.log` 和 `.local/api.stderr.log`。
- 凭据与私有数据仅保存在本地忽略目录；需要备份时一起保管，不要提交到 Git。生产部署需另行配置数据库与账号，不能直接使用这套本地私有实例。

## 接口契约

共享 Zod DTO 位于 `src/linepool/api/contracts.ts`，React 请求适配层位于 `src/linepool/api/client.ts`。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册并设置 HttpOnly 会话；新账户积分为 0 |
| POST | `/api/auth/login` | 登录并设置 HttpOnly 会话 |
| GET | `/api/auth/me` | 当前会话与用户 |
| POST | `/api/auth/logout` | 撤销当前会话并清除 Cookie |
| GET | `/api/catalog` | 数据库地区、服务、套餐、价格与可用库存 |
| GET | `/api/dashboard` | 积分、活跃/即将到期号码、未读短信、最近订单 |
| GET | `/api/numbers` | 当前用户号码，支持分页、搜索、地区和状态筛选 |
| GET | `/api/orders` | 当前用户订单，支持分页、搜索和地区筛选 |
| GET | `/api/orders/:id` | 当前用户订单详情及分配号码 |
| POST | `/api/orders` | 幂等下单、扣积分、分配库存、写流水 |
| GET | `/api/inbox` | 当前用户短信，支持分页、号码、地区、搜索和未读筛选 |
| POST | `/api/inbox/read` | 批量标记本人短信已读 |
| GET | `/api/points` | 当前余额和分页流水，可筛选收入/支出 |
| GET | `/api/account` | 账户资料及偏好 |
| PATCH | `/api/account/preferences` | 保存到期提醒偏好；不代表已接入邮件/推送 |
| GET | `/api/health` | API 和数据库连通状态 |

除注册、登录和健康检查外均要求有效会话。普通响应为 `{ data }`；分页响应附 `pagination`，含 `page`、`pageSize`、`totalItems`、`totalPages`。错误统一为 `{ error: { code, message, details? } }`。

分页默认第 1 页、每页 20 条，上限 100 条。`numbers.status` 为 `ACTIVE`、`EXPIRED` 或 `expiring`（未来 3 天到期）；`inbox.unread` 为字符串 `true/false`；`points.kind` 为 `income/expense`。

下单请求：

```typescript
{
  region: 'us',
  service: 'Telegram',
  plan: 'month', // 'week' 或 'month'
  quantity: 1, // 1 至 10
  idempotencyKey: crypto.randomUUID()
}
```

价格、期限、库存和扣款金额只从数据库读取。会锁定用户积分行和分配库存；重复提交相同请求键返回原订单，键被用于不同请求则返回 `IDEMPOTENCY_CONFLICT`。余额或库存不足时整笔回滚，不产生部分扣款或分配。重试同一次下单必须复用请求键，不能重新生成。

数据库 UUID 是实体标识；界面订单号为 `orderNumber`。不得把原页面的 `n1`、`s1`、`DEMO-*` 标识当成 API UUID。

## React 工作台接入

```typescript
import { createLinepoolApi } from './api/client';
const api = createLinepoolApi({ baseUrl: 'http://127.0.0.1:3010/api' });
const { data: user } = await api.login({ email, password });
const { data: catalog } = await api.catalog();
```

工作台实际请求入口为 `src/linepool/workspace-reference/workspace-data.ts`。它使用上述客户端，地址优先取 `VITE_LINEPOOL_API_URL`，未配置时使用 `http://127.0.0.1:3010/api`；不依赖 Vite API 代理。通用客户端本身仍默认同源 `/api`，其他调用者可自行覆盖。

客户端设置 `credentials: 'include'`，验证输入和响应 DTO，支持 AbortSignal 和超时，不自动重试写操作。会话仅存 HttpOnly Cookie，不返回 Token、不写 localStorage。Cookie 名为 `linepool_react_session`，Path 为 `/api`，默认存活 24 小时，SameSite=Lax；生产模式 Secure。

跨域请求必须与 `WEB_ORIGIN` 完全匹配。保持前后端都使用 `127.0.0.1`，不要将前端 `localhost` 与后端 `127.0.0.1` 混用。所有写请求要求匹配的 Origin，命令行请求也需显式设置 Origin。

当前工作台已接通登录/登出、目录价格与库存、下单 loading/error、真实 UUID、已读后的未读数同步、余额/库存/dashboard 刷新、账户偏好与全量分页加载。一次下单的意图和请求键按账户保存到 sessionStorage，响应丢失后刷新页面仍复用原键；未确认之前冻结地区、服务、套餐和数量。刷新失败保留上次确认的 API 数据并提示重试，401 则清除受保护视图；不会回退到本地演示数据。

## 数据与安全边界

- 表：`users`、`sessions`、`regions`、`offers`、`orders`、`phone_numbers`、`point_ledger`、`sms_messages`、`schema_migrations`。
- 所有用户数据按会话用户筛选；下单用户 ID 不接受来自请求体。
- 密码使用 bcrypt cost 12，并限制在 72 UTF-8 字节内；数据库会话只保存随机 Token 的 SHA-256。
- 使用参数化 SQL、数据库余额/归属约束、严格写请求校验、登录/注册限流、16 KB JSON 上限、Helmet、精确 Origin 与不缓存响应。
- 号码到期后不重新释放库存，避免旧短信或订单的归属被覆盖。真实供应商回收规则应另行设计。
- 注册账户没有赠送积分，也没有充值接口，当前完整演示交易应使用种子账户。
- 本机前后端闭环已完成浏览器验收；尚未接入生产供应商、支付、分布式限流或通知投递，不能称为生产上线。
