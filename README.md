# LINEPOOL 工作目录

LP 主应用位于 [`apps/linepool-web/`](apps/linepool-web/README.md)，使用 React + Vite、NestJS、PostgreSQL，前后端通过 TypeScript / Zod 共享契约。先阅读[目录与架构导航](docs/README.md)，再进入对应代码或专题文档。

## 目录导航

| 目录 | 内容与用途 |
| --- | --- |
| [`apps/linepool-web/`](apps/linepool-web/README.md)、`services/core/`、`packages/contracts/` | LP 网站、API、共享契约、数据库迁移及构建脚本；日常开发入口 |
| [`deploy/`](deploy/README.md) | Linux 部署说明与 Nginx / systemd 模板 |
| [`docs/`](docs/README.md) | 当前架构导航与归档文档索引 |
| [`oneoff-sms/`](oneoff-sms/README.md) | 本仓库保留的 ONCE / ONE 独立应用；依赖、构建和服务端独立 |
| [`webhook-lab/`](webhook-lab/README.md) | PC Webhook 本地联调工具与收包记录 |
| [`output/`](output/README.md) | 本地产物导航：报告、截图、资料、备份与运行记录 |
| `tmp/` | 临时抓取数据、长任务 TODO 和结果；不纳入 Git |

`apps/linepool-web/src/vendor/`、`apps/linepool-web/public/` 和 `apps/linepool-web/upstream-lock.json` 是只读上游基线；`src/linepool/showcase/` 仍被工作台引用。整理目录时须保留这些资源及许可证。

## 当前 LP 边界

网站包含用户工作台 `/app/*`、管理后台 `/admin/*` 和代理工作台 `/agent/*`，共用 NestJS API、Cookie 会话与 PostgreSQL。短期收信服务提供 7 / 30 天方案；新续费入口关闭，历史记录保留。

当前供号与收信仍装配 Mock provider；代码已有 Webhook 接收入口，但真实 PC 供号、短信投递、支付及生产部署尚未完成验收。旧文档中的测试结果仅对应其当时的版本与环境。代码定位和资料阅读顺序见[目录与架构导航](docs/README.md)。

## 启动与构建

需要 Node.js 22+。从仓库根目录操作 LP 工作区，统一使用根目录的锁文件：

```sh
npm ci
npm run build:all
npm run typecheck:all
```

本地开发：配置 `services/core/.env`（参考同目录 `.env.example`），准备 PostgreSQL 后执行 `npm run dev:all`。前端默认端口 5178，API 默认端口 3010。详细命令见[应用说明](apps/linepool-web/README.md)。

本地 Mock PC 资源列表按 `PC_MOCK_SNAPSHOT_PAGE_SIZE` 分页（默认100），一次同步在同一个只读、可重复读事务中读完全部页后才更新号码和确认来源缺失。仅在已授权的隔离 sandbox 中，可将 `PC_MOCK_SNAPSHOT_FAIL_ACCOUNT` 设为某连接的外部账号，并用 `PC_MOCK_SNAPSHOT_FAIL_PAGE` 指定第2页或之后失败；空账号关闭故障。现有同步任务结果记录完整状态、成功页数、已读取资源数及每页游标；分页失败不更新本地资源或缺失标记。观察完成后清空故障账号并恢复 Mock 夹具。

本地 Mock 授权支持当前站点、应用和 issuer 下已持久化的 fixture key，格式为1–120位小写字母、数字或连字符，并以字母或数字开头。服务端继续核对 fixture 的开通状态、所有权及可信身份；容量夹具和负载工具仅在针对具体本机目标的专项授权下准备、运行，实际范围和证据登记在[总执行文档](docs/handoff/lp-once-v41-master-plan.md)。

服务器发布见[部署说明](deploy/README.md)。网站产物为 `apps/linepool-web/web-dist/`；API 运行入口为 `services/core/dist/core/src/main.js`，还需要工作区依赖、数据库迁移及共享契约产物。

本地 `output/`、`tmp/`、浏览器记录、日志、`.pi/`、环境配置和数据库目录不属于发布文件。采用干净源码检出并构建，不要直接上传整个本机目录。
