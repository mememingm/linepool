# LP 目录与架构导航

本页按知识库的 LP 当前状态与本地源码整理。产品现状以当前源码和实际环境为准；专题方案、历史总结与旧验证报告各自保留原有证据边界。

## 架构和代码定位

| 层次 | 路径 | 职责 |
| --- | --- | --- |
| 网站入口 | [`../linepool-ui/src/main.tsx`](../linepool-ui/src/main.tsx)、`src/app/` | 页面入口与路由 |
| 用户端 | `linepool-ui/src/linepool/workspace-reference/` | 购买、号码、收件箱、订单、积分、账户 |
| 管理后台 | `linepool-ui/src/linepool/admin/` | 用户、号码、商品、订单与历史续费管理 |
| 代理端 | `linepool-ui/src/linepool/agent/` | 客户、库存、定价、余额与账本；入口 `/agent/*` |
| 业务请求 | `linepool-ui/src/linepool/api/` | 浏览器端 API 调用与错误处理 |
| API 装配 | [`main.ts`](../linepool-ui/backend/src/main.ts) | NestJS 控制器、守卫、provider、`/api` 前缀 |
| 核心业务 | `linepool-ui/backend/src/` | 会话、工作台查询、下单、后台管理、代理库存等 |
| 收信接入 | `linepool-ui/backend/src/providers/` | Mock 收信、同步、Webhook 接收与入库逻辑 |
| 数据存储 | `linepool-ui/backend/db/migrations/` | PostgreSQL 迁移；已应用文件不得直接修改 |
| 共享契约 | `linepool-ui/packages/contracts/` | 前后端类型与 Zod 校验 |
| 部署 | [`../deploy/`](../deploy/README.md) | Nginx、systemd 和环境变量模板 |

供号与收信 provider 当前仍为 Mock。Webhook 入口的存在不代表真实 PC 链路已打通。用户 Cookie 会话接口也不等于可直接开放给第三方的服务端 API。

## 推荐阅读顺序

1. [根目录说明](../README.md)：各目录职责、启动入口与当前产品边界。
2. [应用 README](../linepool-ui/README.md)：本地启动、构建、页面、接口与权限。
3. [应用专题文档索引](../linepool-ui/docs/README.md)：按需要选择接入、代理方案或历史记录。
4. [部署说明](../deploy/README.md)：正式发布前的环境配置与回退要求。
5. [历史文档索引](archive/README.md)：旧 LP 总结与 ONCE 方案。
6. [本地产物索引](../output/README.md)：审查报告、验证证据、截图和备份。

## 其他应用与工具

- [`oneoff-sms/`](../oneoff-sms/README.md)：本目录中的 ONCE / ONE 应用，使用独立的 Node 服务端与依赖。知识库还登记了 `D:/once` 的另一套实现，两者的主从或迁移关系未确认，本次保留各自边界。
- [`webhook-lab/`](../webhook-lab/README.md)：PC Webhook 联调工具；本地 `.env`、收包和日志仍按工具原有路径保留。

## 本地文件存放约定

- 维护中的 LP 功能说明放在 `linepool-ui/docs/`；跨目录导航放在根 `docs/`。
- 被后续方案取代的根目录文档放在 `docs/archive/<产品>/`，通过索引说明历史背景。
- 报告放在 `output/reports/`；资料放在 `output/data/`；旧快照和备份放在 `output/archive/`。
- 截图、脚本与配套文件已有成组目录时保持原位置；`output/platform-logos/` 是素材来源，保留原路径。
- 运行中可能使用的日志、进程记录、数据库及 `.local/` 保留原路径。`tmp/` 保留任务恢复材料并排除出 Git。
