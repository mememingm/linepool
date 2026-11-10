# ONCE

ONCE 前端使用 React 19、TypeScript、Vite、React Router、Zustand、TanStack Query 和 Motion。v4.2 连接独立部署的共享 NestJS core 与独立 ONCE 数据库；legacy 后端继续保留。当前执行依据见 [v4.2 总执行文档](../../docs/handoff/lp-once-v41-master-plan.md)。

## 前端开发

在项目根目录执行：

```sh
npm run dev --workspace once-web
```

开发地址为 `http://127.0.0.1:5174/`。5173 已被其他本地项目使用；ONCE 使用固定的 5174，端口冲突时直接提示，不自动漂移。

开发与 preview 服务器把 `/api` 默认代理到 `http://127.0.0.1:3011`。可通过进程环境变量 `ONCE_API_TARGET` 覆盖目标，例如隔离验收使用的 `http://127.0.0.1:3181`。代理保留浏览器 Origin；core 的 `WEB_ORIGIN` / allowed origins 应包含实际前端地址。LP 3010 与 legacy 3000 保持独立。

## 构建与检查

```sh
npm run build --workspace once-web
```

`build` 先进行 TypeScript 严格类型检查，再生成 `dist/`。

生产静态服务器需要对 `/agent`、`/reset-password`、`/app/*` 和 `/admin/*` 提供 SPA 路由回退，并把 `/api` 转发到 ONCE core。构建与类型检查由集成者统一执行，本切片未启动应用、浏览器、测试或数据库。

## 源码结构

```text
src/
  main.tsx                    React 挂载、全局样式和 Query Provider
  app/
    App.tsx                   路由表、登录守卫、错误边界
    AppProvider.tsx           账户会话与通知、主题的挂载入口
    WorkspaceProvider.tsx     租约查询、按号码缓存、刷新和现有业务操作
  stores/
    ui-store.ts               主题、通知、选号草稿；组件按字段订阅
    workspace-store.ts        每个工作台独立的弹窗与租期选项
  pages/
    PublicPages.tsx           首页、帮助、登录和注册
    WizardPage.tsx            地区、租期、号码选择与现有确认流程
    OverviewPage.tsx          总览
    NumbersPage.tsx           号码列表与详情
    MessagesPages.tsx         收件箱和独立发送页面
    AgentPage.tsx             PinClode 代理登录、连接、号码、套餐、消息与等待状态
    AccountPages.tsx          套餐、账单、设置和语音占位
  components/                 页面壳、号码选择器、复制、租期环、弹层
  lib/
    api.ts                    请求封装、QueryClient、会话失效和幂等请求
    queries.ts                查询键、查询配置、详情缓存复用及已读缓存更新
    models.ts                 数据类型、状态计算和账户隔离的存储键
  react.css                   React 状态边界的少量适配样式
```

原有 `styles.css`、`assets/ux/workspace.css` 和 `assets/ux/product-ui.css` 继续提供现有视觉体系。正式页面由 React 渲染；`assets/ux/` 下的 `workspace.js`、`events.js` 只供本地演示页使用。

当前使用真实路径，例如 `/app/messages?leaseId=...`。已有 `/#/app/*` 与 `/#/admin/*` 书签会在挂载前转换为对应真实路径。密码重置支持 `/reset-password#token=...`，令牌只保存在页面内存并从地址栏移除。

密码规则与共享后端保持一致：最少 8 个字符、最多 72 个字符，且 UTF-8 编码不超过 72 字节；登录、注册、重置密码、修改密码及后台设置密码使用同一规则。中文等多字节字符可能先达到字节上限。修改前端规则不会更改已有账号或重置密码。

## v4.2 请求与代理入口

- `/login` 提供普通邮箱登录与 PinClode 登录；回调先到 `/agent` 读取本站角色，`ADMIN` 自动进入 `/admin/overview`，普通 PinClode 代理留在代理工作台。PC 显示名或上游用户名不自动授予本站管理员。代理不能进入自营钱包、租号与密码修改页面。
- `src/lib/api.ts` 将身份、账户、PC 请求发送到 `/api/auth`、`/api/account`、`/api/pc` 及 `/api/admin/pc`；租约、库存、订单、收发短信、积分和旧管理页面请求保留在 `/api/once/*`。同时处理 core `{data:...}` 与保留的平铺 ONCE JSON，保留分页元数据并读取嵌套 `error`。
- `/agent` 使用 ONCE 既有侧栏、顶栏、主题和账户菜单，按 `section=overview|numbers|messages|plans|connection` 分别展示总览、号码、短信、套餐和连接，默认总览。查询参数切换保留管理员个人连接入口的 `view=connection`；本站ADMIN默认后台及普通邮箱身份切换规则不变。仅操作当前可信代理连接，保留能力开关、套餐增改/停用、短信筛选/分页/已读、等待取码和重新授权；套餐编辑使用现有Dialog/Select/Checkbox组件。查询读取本地数据，离开工作台时停止前端轮询并撤销等待。
- `SOURCE_RESOURCE_ISSUE` 显示为号码资源提示，保留历史记录，不把该提示显示成连接授权失败；本轮不继续处理上游 UNAVAILABLE。
- `/admin/integrations` 查询本站自营与代理连接，提供自营授权及后台轮询请求。连接来源决定Mock或真实状态展示；本地模拟配置表单仅对Mock开放，真实授权以本站连接的`authorized`事实为准。不编辑真实凭据，不提供代理分销、进货、分账或买家功能。
- `/app/points` 使用服务端币种、精度、兑换比例与共享金额契约。模拟支付请求与后台入账分开，只有持久入账事实才能显示已到账。现金退款不可用，历史记录只读；保留消费退积分。
- 聊天 SSE 使用 `/api/once/leases/:id/chat/events`，已读落在服务端。发送返回持久排队状态，状态查询只读本地数据。账单与聊天历史使用服务端游标继续读取，未知历史金额显示未提供。

ONCE 本机真实登录登记使用独立应用编码 `once`，首页 `http://127.0.0.1:5174/agent`，回调 `http://127.0.0.1:5174/api/pc/auth/callback`。首页、回调及浏览器访问保持同一 `127.0.0.1` Origin；应用密钥仅放在后端忽略配置中，不与 LP 共用。界面沿用同一授权入口，不固定宣称为 Mock；未开通 ONCE 应用和过期/错浏览器授权会话显示明确错误。

真实登录启用前须在明确批准的 ONCE 目标应用 `046_pc_real_provider.sql`（登录依赖 `pc_auth_states.code_verifier`），确认独立应用配置、本站标记及必填号码地区。只验证登录时仅切换 API，正常 Mock worker 仍用原配置；不能由登录接入自动推导真实号码/消息同步、发信、资金或自营连接改绑授权。应用元信息可见、构建成功均不等于密钥兑换及实际登录已成功。

需要限定真实联调账号时，在对应worker进程设置 `PC_WORKER_CONNECTION_IDS`，值为逗号分隔的本站连接UUID（不是PC账号编号）。为空时保持处理本站当前应用/issuer/provider全部连接的既有行为；非空时，令牌续期、号码/收信领取、过期领取恢复及同步任务恢复仅处理列出的连接，仍先校验原站点和应用范围。该设置不改变代理所有权或启用真实模式；API无需切换账号。具体实例和授权范围仍登记在总执行文档。

网络失败会显示实际错误，不回退到浏览器模拟成功。正式入口不加载 `assets/ux/mock-data.js`；原有演示和管理文件保留。

## 管理后台

`/admin` 是运营管理入口，代码在 `src/admin/`，按需载入。页面保留概览、用户、号码库存、套餐、积分、租约、订单、短信、上游连接、收件箱事件及审计。写操作提交原因与幂等键；历史归档号码、租约与事件只读，原始未知金额不会补成零。

早期后台与真实上游说明保留在 `docs/` 作为历史资料；当前路径和字段以共享 core 代码、领域控制器及 v4.2 总文档为准。显式 `dev:admin-mock` 仅供独立界面演示，不作为网络失败后的回退；后端通过 `PC_MODE` 明确选择持久 Mock 或真实 PinClode。本站 `ADMIN`（包括经明确授予的可信 PC 身份）可进入本站管理后台。

本机体验入口：代理工作台为 `http://127.0.0.1:5174/agent`，管理员概览为 `/admin/overview`，短信记录为 `/admin/messages`，连接授权与同步为 `/admin/integrations`。普通代理不显示管理后台；管理员默认进入后台。PC 管理员可通过后台侧栏或账户菜单的“我的 PC 连接”访问 `/agent?view=connection`，并由“返回管理后台”切回，不会被自营工作台的代理守卫绕回代理首页。普通邮箱账号进入 `/agent` 仍显示切换身份提示。管理员短信记录读取本站自营租约消息；个人 PC 连接页读取本连接消息。

管理员认证与平台自营连接独立。仅启用真实 PC 登录、尚未配置匹配的真实平台自营连接时，管理概览和上游接入仍可打开：概览沿用本站自营/历史账号范围读取既有数据，并显示“平台自营连接尚未配置”；接入响应为 `configured=false/accountId=null`，平台授权和同步入口禁用。原业务写入校验保留，个人 PC 连接保留原所有权。

积分管理的消费订单使用独立页码和订单搜索，流水仍使用各自游标；切换用户会重置订单查询。真实新订单以`COMPLETED`显示“已完成”，既有Mock的`DEMO_CONFIRMED`仍显示模拟确认。结账提示根据号码的`demo`来源切换，发送状态保留排队、未知、发出与送达的区别。后台成功订单仍按`COMPLETED`筛选。套餐当前保存事件为`ONCE_PLAN_SAVE`，审计筛选同时保留`PLAN_CREATE`、`PLAN_UPDATE`历史事件。

## 状态管理与缓存

- Zustand 负责共享界面状态；主题沿用原存储格式。通知、弹窗和选号草稿保留在内存中，不存储账号凭据或接口数据。退出、会话过期及更换已有账号会清理草稿；未登录选号后登录继续保留当前流程。
- TanStack Query 是账号、号码详情和库存的唯一接口缓存。号码键按数据来源、账号、号码隔离；切号取消旧请求，首次默认详情可直接复用到对应号码 URL。
- 详情与库存保留各自缓存周期。待处理订单按本地状态刷新；聊天由 SSE 通知刷新，代理消息只轮询本地 API。页面卸载会清理流、定时器与等待请求。
- 已读通过服务器接口保存，确认成功后更新相应用户、号码的查询缓存；失败显示错误，不写入浏览器假成功。
- 网络、超时及 5xx 读取错误最多自动重试一次；鉴权、业务校验错误、中止和写操作不自动重试。

## 预览和业务边界

`http://127.0.0.1:3000/assets/ux/demo.html?scenario=common#/app/inbox` 为原有浏览器演示入口。它与真实 API 数据源分开，用于界面检查；演示数据不能证明真实号码开通、付款或短信接收已经接入。

后端缺省仍为本地持久 Mock；真实 PinClode 配置、独立应用登记与本机准备见 [部署说明](../../deploy/README.md#pinclode-本机应用登记)。真实授权、号码/收信和出站状态使用官方应用接口，前端仍只读本站消息与发送队列；源码与构建不等于已用真实账号联调。本站租约只覆盖已同步且期限足够的现货，站内续租不会延长PC资源期限。真实支付、PC买号/上游续期、MMS、语音及买家功能不在此接入范围内。运行证据和后续授权以总执行文档为准。

2026-11-07 用户决定：支付接入暂时搁置，正式价格先调研再讨论；不从本机演示套餐推导正式售价。发布顺序为用户先在本机走完整流程，确认后进入测试服务器验收，最后才正式部署；具体目标和操作范围以总执行文档及专项授权为准。

## 同一 Wi-Fi / 局域网访问
以下局域网脚本与 3000 端口说明属于旧 ONCE 部署记录。v4.2 前端不自动运行它们，不停止或切换旧服务；新 core 的迁移、导入、启动及切流另按总文档执行。

本机作为服务器运行时，同事使用本机的 Wi-Fi IPv4 地址访问，例如 `http://192.168.0.107:3000/`。`127.0.0.1` 始终指访问者自己的电脑。

在项目目录运行局域网启动脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-lan.ps1
```

脚本默认从 `WLAN` 获取 IPv4，输出实际访问地址；也可以传入 `-Address 192.168.0.107 -InterfaceAlias WLAN`。它启动已有本地 PostgreSQL（如已停止），将当前 `backend/dist/main.js` API 监听地址设为 `0.0.0.0:3000`，并把 `APP_ORIGIN` 设置成相同局域网地址，保留登录等写请求的来源校验。环境覆盖仅作用于该服务进程，不修改 `.env` 或执行数据库迁移。脚本只会停止 ONCE 当前 API 或旧兼容 API 的 3000 进程，不会终止占用该端口的其他程序。

首次访问或 Wi-Fi IP 变更后，在**管理员 PowerShell**运行（地址替换为启动脚本输出值）：

```powershell
powershell -ExecutionPolicy Bypass -File D:\once\scripts\allow-lan-firewall.ps1 -Address 192.168.0.107 -InterfaceAlias WLAN
```

防火墙规则 `ONCE-LAN-3000` 仅允许本地子网通过该 Wi-Fi 接口、本机指定 IP 和 TCP 3000 访问 Node；不关闭防火墙、不开放数据库端口、不改变 Windows 网络类别。IP 变更后重新执行这两个命令。

自己和同事都应使用同一个局域网地址；从 `127.0.0.1` 切换地址后需重新登录。保持本机开机、不休眠且服务运行。客户端需位于可互通的同一局域网，访客 Wi-Fi 或路由器的客户端隔离可能阻止连接。当前仍为本地演示模式；后端和数据库版本见下节。

## 当前本地后端运行说明

历史记录：旧 3000 服务使用 `backend/dist/main.js`，旧 `once` 数据库曾记录生命周期、PC 资源映射、套餐库存、积分账本及 `202611030002_webhook_history`。这不代表独立 ONCE core 数据库已迁移或验收。

新增 PC 账号/号码映射、上游状态和资源期限；短信与回调按账号去重；数据库约束阻止号码租期重叠和跨账号短信归属。旧数据保留，原始字段逐表数量与内容摘要核对一致。

后端在 `backend/` 执行 `npm run db:generate`、`npm run build`。新增迁移应先备份数据库，再执行 `npm run db:migrate`。上游配置、号码同步和 Webhook 已提供后台入口；当前真实采购/续费和 C 端付费交付仍待协议与真实联调，支付渠道由支付同事负责。

旧实现曾提供 `test:integrations` 和 `test:points` 脚本；保留此历史信息，不作为本轮执行指令。本轮不运行测试或数据库操作，也不把 Mock 实现等同真实上游或生产验收。
