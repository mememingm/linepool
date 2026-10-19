# LINEPOOL

唯一应用位于 [`linepool-ui/`](linepool-ui/README.md)，使用 React + Vite、NestJS 和 PostgreSQL。原 Vue `platform/` 已移除。

```text
llinepool/
├── linepool-ui/    网站、API、共享契约及构建脚本
├── deploy/         Linux 部署说明、Nginx / systemd 模板
└── README.md       项目入口
```

需要 Node.js 22+。在仓库根目录执行：

```sh
cd linepool-ui
npm ci
npm run build:all
npm run typecheck:all
```

本地开发：配置 `linepool-ui/backend/.env`（参考同目录 `.env.example`），准备 PostgreSQL 后执行 `npm run dev:all`。前端端口 5178，API 端口 3010。详细命令见[应用说明](linepool-ui/README.md)。

服务器发布见 [deploy/README.md](deploy/README.md)。网站产物为 `linepool-ui/web-dist/`；API 运行入口为 `linepool-ui/backend/dist/backend/src/main.js`，还需要工作区依赖和共享契约产物。

本地 `output/`、浏览器记录、日志、`.pi/`、环境配置和数据库目录已排除出 Git，不属于发布文件。不要直接把整个本机目录上传服务器；采用干净源码检出并构建。

`linepool-ui/docs/` 保留历史开发记录，以本说明、应用 README 和部署说明为当前入口。
