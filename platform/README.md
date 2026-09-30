# LINEPOOL To C Platform

LINEPOOL 的本地 To C 演示应用。前端使用 Vue 3 + TypeScript，后端使用 NestJS + TypeScript，业务数据保存在 PostgreSQL。当前实现覆盖登录、项目浏览、事务下单、订单、号码、积分、短信收件箱和账户资料；不接入真实公司接口、支付、短信采集、设备或管理员后台。

## Prerequisites

- Node.js 22+
- npm 10+
- PostgreSQL 17+，或 Docker Desktop

## Quick Start With Local PostgreSQL

本机已安装 PostgreSQL 时推荐此路径。以下示例使用 `5432`，不要把超级用户凭据写入 `.env`；请创建只拥有 `linepool` 与 `linepool_test` 所需权限的应用角色。

```powershell
cd D:\linepool\platform
npm install
Copy-Item .env.example .env
```

编辑 `.env`，将两个数据库 URL 改为本机应用角色和 `5432`：

```dotenv
DATABASE_URL=postgresql://<app_user>:<app_password>@127.0.0.1:5432/linepool
TEST_DATABASE_URL=postgresql://<app_user>:<app_password>@127.0.0.1:5432/linepool_test
```

同时替换 `DEMO_USER_PASSWORD` 的示例值，然后执行：

```powershell
npm run db:migrate
npm run db:seed
npm run dev
```

打开 <http://127.0.0.1:5174/>。API 健康检查位于 <http://127.0.0.1:3000/api/health>。

## Optional Docker Database

`.env.example` 默认连接 Docker 映射端口 `55432`，避免与本机 `5432` 冲突。

```powershell
cd D:\linepool\platform
npm install
Copy-Item .env.example .env
# 编辑 .env 中的演示账号密码
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

停止应用后可用 `npm run db:down` 停止容器。数据库数据保存在命名卷中，重复迁移与 seed 不会创建重复的基础演示记录。

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | 启动 NestJS 与 Vue 开发服务 |
| `npm run db:migrate` | 执行尚未应用的 SQL migration |
| `npm run db:seed` | 创建或更新演示账户和基础数据 |
| `npm test` | 运行 contracts、API 和 Web 测试 |
| `npm run typecheck` | 运行全工作区严格类型检查 |
| `npm run build` | 构建全部生产产物 |
| `npm audit --registry=https://registry.npmjs.org` | 使用官方 registry 执行依赖审计 |

API 集成测试会重建 `TEST_DATABASE_URL` 指向数据库的 `public` schema，因此测试数据库名必须以 `_test` 结尾，且不得指向开发或生产数据库。

## Architecture

```text
apps/web/              Vue 3, Router, Pinia, Element Plus
apps/api/              NestJS REST API and PostgreSQL access
packages/contracts/    Shared Zod schemas and TypeScript contracts
db/migrations/         Ordered SQL migrations
docs/decisions/        Architecture decision records
tasks/                 Implementation plan and delivery status
```

- 认证使用服务端会话和 HttpOnly Cookie，不在浏览器存储认证令牌。
- 下单、库存分配、积分扣减和流水写入位于同一 PostgreSQL 事务。
- 列表和详情按当前用户过滤；前端不能直接修改余额、库存或订单状态。
- 界面采用内容优先的浅色极简设计，业务功能不依赖 WebGL。Three.js/GSAP 增强已按 [ADR-004](docs/decisions/0004-defer-three-gsap-enhancements.md) 暂缓。

完整边界见 [spec.md](docs/spec.md)，设计规则见 [design-system.md](docs/design-system.md)，当前验证记录见 [verification.md](docs/verification.md)。

## Demo Boundaries

- 仓库只包含无敏感信息的环境变量示例。
- 不使用真实站点账号、公司端点、真实支付或真实短信。
- `.env`、构建产物和浏览器验收截图不会提交到 Git。
