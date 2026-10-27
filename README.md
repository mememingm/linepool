# LINEPOOL 工作目录

LP 主应用位于 [`linepool-ui/`](linepool-ui/README.md)，使用 React + Vite、NestJS、PostgreSQL，前后端通过 TypeScript / Zod 共享契约。先阅读[目录与架构导航](docs/README.md)，再进入对应代码或专题文档。

## 目录导航

| 目录 | 内容与用途 |
| --- | --- |
| [`linepool-ui/`](linepool-ui/README.md) | LP 网站、API、共享契约、数据库迁移及构建脚本；日常开发入口 |
| [`deploy/`](deploy/README.md) | Linux 部署说明与 Nginx / systemd 模板 |
| [`docs/`](docs/README.md) | 当前架构导航与归档文档索引 |
| [`oneoff-sms/`](oneoff-sms/README.md) | 本仓库保留的 ONCE / ONE 独立应用；依赖、构建和服务端独立 |
| [`webhook-lab/`](webhook-lab/README.md) | PC Webhook 本地联调工具与收包记录 |
| [`output/`](output/README.md) | 本地产物导航：报告、截图、资料、备份与运行记录 |
| `tmp/` | 临时抓取数据、长任务 TODO 和结果；不纳入 Git |

`linepool-ui/src/vendor/`、`linepool-ui/public/` 和 `upstream-lock.json` 是只读上游基线；`src/linepool/showcase/` 仍被工作台引用。整理目录时须保留这些资源及许可证。

## 当前 LP 边界

网站包含用户工作台 `/app/*`、管理后台 `/admin/*` 和代理工作台 `/agent/*`，共用 NestJS API、Cookie 会话与 PostgreSQL。短期收信服务提供 7 / 30 天方案；新续费入口关闭，历史记录保留。

当前供号与收信仍装配 Mock provider；代码已有 Webhook 接收入口，但真实 PC 供号、短信投递、支付及生产部署尚未完成验收。旧文档中的测试结果仅对应其当时的版本与环境。代码定位和资料阅读顺序见[目录与架构导航](docs/README.md)。

## 启动与构建

需要 Node.js 22+。从仓库根目录进入 LP 工作区，统一使用其中的锁文件：

```sh
cd linepool-ui
npm ci
npm run build:all
npm run typecheck:all
```

本地开发：配置 `linepool-ui/backend/.env`（参考同目录 `.env.example`），准备 PostgreSQL 后执行 `npm run dev:all`。前端默认端口 5178，API 默认端口 3010。详细命令见[应用说明](linepool-ui/README.md)。

服务器发布见[部署说明](deploy/README.md)。网站产物为 `linepool-ui/web-dist/`；API 运行入口为 `linepool-ui/backend/dist/backend/src/main.js`，还需要工作区依赖、数据库迁移及共享契约产物。

本地 `output/`、`tmp/`、浏览器记录、日志、`.pi/`、环境配置和数据库目录不属于发布文件。采用干净源码检出并构建，不要直接上传整个本机目录。
