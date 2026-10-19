# LINEPOOL workspace-reference-shell 后续优化交接

> **最新状态：工作台已接入 API。** 用户后续明确授权将 React 页面从 demo state 切换到 `src/linepool/api/client.ts` 并做浏览器验收。`#workspace-reference-shell` 现在读写本机 NestJS/PostgreSQL；登录、目录、下单、订单、号码、短信、积分和账户偏好已完成验收，不再使用本地 demo state。详见 [API 接入验收记录](workspace-api-acceptance.md) 和 [后端运行交接](backend-handoff.md)。
>
> 下文第 1 至 13 节保留此前 UI/动效任务的历史记录，其中“未接 API”“不做浏览器验收”、演示统计和 SHA-256 均不是当前工作台状态。API 接入只对目标工作台生效；独立 `#workspace-reference` 设计展示、其他入口和只读上游仍保留。API 里的号码/短信仍是数据库 DEMO 数据，真实供应商与支付尚未接入。

> 更新日期：2026-10-10。最新工作目录是 `D:/llinepool/linepool-ui`，独立业务页面见第 12 节，最新首页动效与交互见第 13 节。
>
> **本批授权变更：** 用户明确要求首页动效及图表点击，并通过结构化确认允许小范围修改 `Reference.tsx/Reference.css` 的必要交互代码和局部动效，保持布局、图片、字体与配色。这是第 1 至 12 节逐字只读规则的有限例外，不授权重排首页、修改共享数据/上游或接生产 API。第 1/9 节旧 SHA-256 是历史记录，不再作为这两个文件当前相等断言；仍不运行测试或浏览器验收。
>
> 优化入口：<http://127.0.0.1:5178/#workspace-reference-shell>。
> 原始独立首页入口：<http://127.0.0.1:5178/#workspace-reference>（复用同一组件，本批图表/动效亦生效，默认导航目的地保留）。
> 旧 `D:/linepool` 保留；5177 是旧目录服务，后续不要在旧目录修改。第 9、11 节的旧日志与截图仍是历史记录，不是本批验证。

## 1. 目标与不可违反的约束

目标是以 workspace-reference 原始主画布作为首页，在外层补齐导航、业务流程和必要动效。其他业务页面必须延续首页的视觉语言，不另做后台管理模板或另一套设计。

- 新前端使用 React + TypeScript，不能继续在 Vue 3 中实现目标页面。
- `src/linepool/showcase/Reference.tsx`、`Reference.css` 保持逐字不变，主画布直接使用 `<ReferenceWorkspace />`，不能复制、重写或替换实现。
- 不改变首页的文字、图表、图片、字体、背景、卡片顺序、尺寸关系、圆角、间距和响应式规则。添加外层功能不能成为重新排版的理由。
- 保留 `#workspace-reference` 原入口及其他现有展示入口；本次优化以独立的 shell 入口为范围。
- 不引用 5174/Vue 的组件、样式、路由、store 或业务实现。旧产品仅用于理解业务流程；后端契约另按授权范围对接。
- `src/vendor/**`、`public/**`、上游锁文件及许可证只读，不能重生成锁文件来掩盖改动。Beautiful UI 的 SidebarNav 因商业图标授权缺失仍不可使用。
- `showcase/shared.tsx`、`shared.css`、`showcase/assets/` 及首页依赖的业务组件也会影响基线。不要通过修改共享数据、资源或全局样式绕过首页只读要求；壳层新增数据和状态应独立维护。
- 依照 [AGENTS.md](../AGENTS.md)，不运行测试套件；最新用户要求亦暂停浏览器交互/视觉验证。允许构建、类型检查和源码完整性校验。生产 API 接入须另行得到授权。
- 工作区已有大量历史修改和未跟踪文件，不清理、不回滚、不覆盖与本任务无关的内容，不自动提交。

### 首页文件 SHA-256 基线

2026-10-10 本次交接重新计算，仍与此前交付一致：

| 文件 | SHA-256 |
| --- | --- |
| `src/linepool/showcase/Reference.tsx` | `a6929cb8e5269d7fd753614361f55b03e4a8cbc5ce72d44026899d4c9bbbd32f` |
| `src/linepool/showcase/Reference.css` | `1e01493023ee299addf450a56d6ea8ab11160d31c494e3debd7f04923956d068` |

哈希一致只能证明这两个文件未变，不能证明共享依赖、CSS 继承、容器宽度和最终像素未变；必须结合视觉验收。

## 2. 技术栈与架构边界

用户指定的架构参考：`C:/Users/27792/Downloads/LINEPOOL_%E6%8A%80%E6%9C%AF%E6%A0%88%E7%AE%80%E4%BB%8B.md`。该文档描述的是旧 Vue 3 前端，用户已明确将新前端改为 React；后端仍沿用 NestJS、Zod/TypeScript contracts、PostgreSQL + pg/原生 SQL 的方向。

**当前实际运行链路：**

```text
浏览器 :5178
  -> linepool-ui/catalog/main.tsx / PreviewApp
  -> LinePoolUIProvider + WorkspaceReferenceShell
  -> 外层侧栏 + shell 专属 hash 子路由
  -> 工作台：原 ReferenceWorkspace（只在工作台页面挂载，不复制）
  -> 其他业务页：WorkspacePages + demo-data 独立会话状态
```

当前没有登录鉴权、网络请求、数据库写入、真实购买、支付或短信订阅。购买页可创建本地演示订单，联动壳层业务页的号码/订单/积分/库存；短信已读联动壳层徽标。刷新后恢复静态快照，不写 localStorage，也不改变原首页封闭状态。`linepool-ui` 是独立 React 预览/组件包，shell 在 catalog 中使用，尚未作为包的公开组件导出。

**后续得到授权后才实施的目标链路：**

```text
React 页面和独立数据层
  -> HTTP/JSON + Zod/共享 contracts
  -> NestJS /api/*
  -> PostgreSQL 事务
```

不要因为后端已有接口就直接把当前演示页连接到生产环境。真实号码上游、支付、短信采集也不属于当前 shell 已实现能力。

## 3. 代码地图与责任范围

以下路径相对于 `D:/llinepool/linepool-ui/`：

| 路径 | 当前职责 | 后续处理 |
| --- | --- | --- |
| [catalog/main.tsx](../catalog/main.tsx) | `PreviewApp` 监听 hash，区分原首页、shell 和其他演示入口；提供 React/provider 挂载 | 可添加 shell 专属入口，保留其他分支 |
| [WorkspaceReferenceShell.tsx](../src/linepool/workspace-reference/WorkspaceReferenceShell.tsx) | 外层布局、侧栏、hash 页面状态、移动抽屉和到期提醒 | React 优化主入口 |
| [navigation.ts](../src/linepool/workspace-reference/navigation.ts) | shell 专属路由解析、标题和链接生成 | 不改变其他 catalog 路由 |
| [WorkspacePages.tsx](../src/linepool/workspace-reference/WorkspacePages.tsx) | 购买、号码、收件箱、订单、积分、账户、设置、地区服务的独立视图 | 延续首页视觉；不用弹窗承载页面 |
| [WorkspacePages.css](../src/linepool/workspace-reference/WorkspacePages.css) | 独立业务页面布局及局部 light token | 只作用于 `lp-shell-view` |
| [demo-data.ts](../src/linepool/workspace-reference/demo-data.ts) | 独立副本、演示订单/号码/库存/积分和已读 reducer | 不 mutate shared，不宣称真实下单 |
| [WorkspaceReferenceShell.css](../src/linepool/workspace-reference/WorkspaceReferenceShell.css) | `lp-shell-*` 样式和 1100/800/540px 断点 | 只优化壳层，不覆盖首页内部选择器 |
| [Reference.tsx](../src/linepool/showcase/Reference.tsx) | 原首页；内部搜索、趋势切换、短信详情与复制 | 只读，原样组合 |
| [Reference.css](../src/linepool/showcase/Reference.css) | 原首页视觉、69/31 主画布比例及响应式 | 只读；新页面以此为视觉依据 |
| [shared.tsx](../src/linepool/showcase/shared.tsx) | 多个 showcase 的静态账户、地区、号码、短信、订单和积分流水 | 只读取；不修改以实现壳层状态联动 |
| `src/linepool/showcase/assets/` | 首页头像、字体和服务图标 | 保持原资源；不要替换 |
| [business.tsx](../src/linepool/business.tsx) | 包括真实剪贴板操作的 `CopyValue` 等业务组合 | 新页面按现有 props 组合，注意首页也依赖它 |
| [vite.config.ts](../vite.config.ts) | catalog 从 `dist/linepool-ui.js` 与 CSS 消费已构建组件包 | 启动前需存在组件包构建产物 |

先阅读 `AGENTS.md`、本文和上述核心文件。旧的 [React 重写方案](workspace-reference-react-rebuild-plan.md) 与 [工作台方案](workspace-reference-plan.md) 是历史讨论，不代表当前 shell 已实现能力；旧文档中的 `shared.ts` 实际文件应为 `shared.tsx`。

分工建议：React 负责人拥有 shell、独立业务页面及其数据状态；后端负责人仅在接口接入授权后拥有 `platform/apps/api/` 和 contracts。多人协作先说明文件范围并预留，一个文件只由一位写入者修改；不能依赖此前同事仍在线或继续占用原分工。

## 4. 本地启动与构建

在项目根目录执行：

```powershell
cd D:\llinepool\linepool-ui
# 仅在依赖尚未安装时执行 npm install；不要无故更新锁文件。
npm run build
npm run dev -- --port 5178
```

`npm run build` 生成组件库到 `dist/`；它不是业务页面的生产构建。`npm run build:catalog` 才生成包含 shell 的独立展示站到 `catalog-dist/`。第一次启动若缺少 `dist/`，先构建组件库，不能只启动 Vite。

```powershell
npm run typecheck
npm run verify:upstream
npm run verify:catalog-upstream
npm run build:catalog
```

默认脚本仍是 `127.0.0.1:5177`，带 `--strictPort`。旧目录服务占用 5177，所以新目录显式使用空闲端口 5178，不停止旧服务。当前新进程为 node PID `37656`，日志在新前端根目录 `preview.stdout.log`、`preview.stderr.log`；PID 是临时信息，下一次需重新查询。

- `http://127.0.0.1:5178/#workspace-reference-shell`：当前优化目标。
- `http://127.0.0.1:5178/#workspace-reference`：原始首页对照。
- `http://127.0.0.1:5178/`：组件 catalog，不是产品首页。

当前任务没有新的关机指令，不要沿用此前已结束任务的延迟关机安排。

## 5. 当前已实现与未实现的功能

壳层持有 `route`、`sidebarOpen`、`sidebarCollapsed`、`alertVisible`、`expiryNotice` 和 `useShellDemoData()` 返回的会话状态。导航使用真实 hash 链接，`hashchange` 同步页面和选中态、关闭移动抽屉；独立页面支持直接打开、刷新恢复当前页面及前进/后退。页面地址会保留，业务数据刷新后重置。

| 区域 | 当前真实行为 | 尚缺能力 |
| --- | --- | --- |
| 工作台 | 原 `<ReferenceWorkspace />`，只在工作台挂载；返回工作台时首页自身筛选状态重置，原内容和入口不改 | 首页旧入口仍指向旧展示方案，见 P0 |
| 购买号码 | 独立页，地区/服务/7天或30天套餐/数量/费用摘要；真实执行本地演示 reducer，校验整数、库存、余额并按请求 id 去重 | 不是真实下单；生产套餐和库存契约未接入 |
| 我的号码 | 独立页，号码/地区/服务搜索、状态/地区筛选、真实复制、关联号码收件箱 | 完整号码详情、续期、分页 |
| 短信收件箱 | 独立列表和页内详情，搜索、号码/未读筛选、打开后标已读、当前筛选批量标已读、复制验证码和全文；徽标联动 | 分页、实时订阅；原首页已读状态不共享 |
| 订单记录 | 独立页，搜索/地区筛选，页内展开订单详情、关联号码 | 实际订单状态、分页、独立详情路由 |
| 积分明细 | 独立页，使用 shared 的完整流水副本，收入/扣除筛选，演示下单扣除联动 | 充值、真实服务端余额和完整账簿 |
| 账户设置 | 独立页，到期提醒即时开关，文案统一为3天 | 语言切换、持久化 |
| 我的账户 | 独立页，统一展示“林晓”，会话余额、活跃号码和未读数量 | 真实会话和资料编辑 |
| 地区服务 | 独立页，全部地区搜索/洲筛选，国家入口按 `?region=...` 显示对应地区，前往带地区预选的购买页 | 服务端地区目录 |
| 到期提醒 | 按 ACTIVE 且 `remaining <= 3`，零记录隐藏、无伪造计数；查看号码前往独立页 | 动态时钟规则、持久化关闭偏好 |
| 桌面侧栏 | >800px 双左箭头收纳为72px图标栏，双右箭头展开，所有图标仍可导航 | 状态不持久化 |
| 移动侧栏 | <=800px 抽屉/遮罩、点菜单关闭、Escape和遮罩关闭恢复触发按钮焦点、跨入桌面关闭；完整菜单不受桌面收纳影响 | 焦点约束/背景不可交互/滚动锁和浏览器复验 |
| 原首页内部 | 原搜索、趋势、短信 dialog 和复制原样保留，不与新数据层共享 | 不宣称首页已与新数据/API同步 |

初始演示快照仍为余额 `1280`、六个地区、六个号码（五个 ACTIVE）、九条短信（四条未读）、三笔订单和四条积分流水。新订单生成明确包含 `DEMO` 的号码，不分配真实号码；原始快照及图表数据不变。

## 6. 后续优化清单

### P0：先修正交互语义与业务缺口

- [x] 移除旧购买弹窗和误导反馈；购买页现在真实执行本地演示下单，显示明确的 DEMO 结果，不宣称真实分配。
- [x] 所有侧栏入口改为 shell 专属子页面，包含账户/设置；支持直接打开、刷新恢复页面、前进/后退及正确选中态。原始参考首页入口保留。
- [ ] 处理首页内部的旧入口：品牌 `#workspaces`；购买和最近购买 `#workspace-a`；号码、短信、指标、常用服务和有效期等多处 `#workspace-b`。目前这些跳转会离开 shell，不能声称已经接入新业务流程。
- [x] 到期规则统一为3天，零记录隐藏，无假计数或最近到期默认值。
- [x] 新业务视图使用独立 reducer，演示下单联动号码/订单/余额/库存，已读联动徽标；不修改 shared 常量。
- [ ] 本批已实现搜索、筛选、复制及空态、下单整数/库存/余额/去重校验；继续补分页、真实请求加载/错误态和浏览器交互验收。

**入口接线限制：** `ReferenceWorkspace()` 不接受 props，没有外部导航或业务数据回调；相同 `#workspace-b` 同时代表多个不同动作，不能只靠 hash 统一猜目的地。先列出动作语义映射，再决定 shell/catalog 中局部适配的方式，不能全局改写 A/B 或其他演示入口，不能用脆弱的中文文本匹配或直接改 DOM 做替代实现。

**状态同步限制：** 原首页 `readIds` 等状态封闭在组件内部。保持首页源码/内容原样时，只能先完善壳层自己的流程，不能宣称原首页实时与新 store/API 同步。若必须提供新的受控接口，先向用户说明冲突并取得明确授权；不能偷偷改 props、复制首页或注入另一份首页实现。

### P1：补齐可访问性、响应式与样式隔离

- [x] 已删除 `ShellPanel` 及其 backdrop、dialog 和相关样式；侧栏入口不再依赖弹窗。原首页自身短信 dialog 不在此次改动范围。
- [ ] 移动菜单已有 `aria-expanded`、`aria-controls`；继续补齐关闭后回到触发按钮，以及抽屉内容过长时的内部滚动检查。
- [x] 外层改为 `<div>`，首页保留自身 `<main>`；新业务页使用独立 `<main>`，有标题关联和导航后焦点/滚动复位。
- [ ] 壳层 CSS 中 `.lp-shell-page *`、button/input 通配规则会触及内部首页。不得继续扩大这些覆盖范围；新增样式优先显式 `lp-shell-*` 类，并确认原画布计算样式未改变。
- [ ] 外层 `overflow: hidden` 可能掩盖真实裁切，不能仅凭没有横向滚动就判断布局正确；检查文字、图表、弹窗和键盘 focus ring 是否完整可见。
- [ ] 原页面 media query 按 viewport 而非壳层内容宽度触发。侧栏占 280px/245px 后，画布空间变小但原断点不变；重点验收 1024px、820/800px 两侧及手机端，不能通过覆盖 Reference.css 来解决。
- [ ] 核查移动菜单按钮是否遮挡首页品牌/搜索；断点切换后无残留遮罩。壳层遮罩 z-index 11、侧栏12，旧弹窗及其20层已移除；独立页面头部为菜单按钮预留空间。
- [ ] 新增动效仅作用于壳层、导航和新页面，短且克制，支持 `prefers-reduced-motion`；保留原首页已有的动画行为。

### P2：流程完善和得到授权后的接口接入

- [x] 壳层、路由、独立数据状态和页面已按职责拆成文件，未引入新视觉系统或路由依赖。
- [ ] 本批购买流程已覆盖地区、服务、套餐、有效期、数量和确认结果；短信已复用 `CopyValue` 成功/失败反馈。继续补号码独立详情页及真实业务契约。
- [ ] 只持久化明确允许的非敏感偏好；不要把登录凭据、短信正文、验证码写入日志或普通 localStorage。
- [ ] API 接入前先确认环境、认证、CORS、分页和错误契约；具体接口范围见下一节。

**当前后续范围：** 本批已完成独立页面、演示下单、到期规则和局部导航语义；下一批再补页内细节及可访问性。首页入口适配与状态同步仍有只读约束，不默认获得修改首页授权。用户暂停测试/浏览器验证的要求仍有效。

## 7. 视觉继承与验收原则

参考页的真实值来自 `Reference.css`，不是旧生图提示词或其他工作台：

| 项目 | 基线 |
| --- | --- |
| 背景 / 白色表面 | `#f4f6fa` / `#fff` |
| 正文 / 次级文字 / 细线 | `#17191c` / `#64686e` / `#dcdee4` |
| 操作蓝 / 珊瑚提醒 | `#2876fa` / `#fa727a` |
| 字体 | Inter + 本地 Reference Noto Sans SC + Microsoft YaHei |
| 原主画布 | 69/31 双栏，已有断点局部调整；不是新后台三栏 |

原首页自身含大圆角与双色渐变指标，必须保留；新业务页按相同层级与控件质感设计，不把整页做成嵌套卡片，不擅自增加新主题或改变原图表。

对照原入口和 shell 时，原画布可用宽度不同，不能把整张截图逐像素硬比就宣称 1:1。分别固定 viewport 和画布尺寸，记录 computed style/区域截图；确认组件比例、规则和断点是否仍符合基线。哈希检查与截图检查缺一不可。

恢复浏览器验证后最低验收：1440x900、1024x768、390x844；补查320px与820/800/540px临界点。检查首屏、滚动、抽屉、独立页面、搜索、复制、长号码/长文本、零到期号码及前进/后退；无重叠、裁切、溢出或布局跳动。本批按用户要求未执行此验收。

## 8. 后端接口接入备忘（当前未接入）

后端目录为 `D:/llinepool/platform/apps/api/`，共享契约为 `D:/llinepool/platform/packages/contracts/src/index.ts`。`configure-app.ts` 设置全局前缀 `/api`，所以不能把控制器裸路径当作实际 URL。

| 用途 | 已存在的接口 |
| --- | --- |
| 认证 | `POST /api/auth/login`、`POST /api/auth/register`、`GET /api/auth/me`、`POST /api/auth/logout` |
| 概览 / 账户 | `GET /api/dashboard`、`GET /api/account` |
| 号码 / 短信 | `GET /api/numbers`、`GET /api/inbox`、`POST /api/inbox/:id/read` |
| 订单 | `POST /api/orders`、`GET /api/orders`、`GET /api/orders/:id` |
| 积分 | `GET /api/points` |

购买还需核对项目/套餐接口与 `createOrderInputSchema`，不能把演示中的 region id 直接作为订单请求。服务端订单详情 id 校验 UUID，演示 `LP202610...` 订单号不能直接传进详情接口。示例日期/验证码/分页字段也须显式转换。

得到授权后在 React 内增加独立 adapter，按 Zod 校验响应，统一加载、错误、分页与会话失效处理。服务端已启用指定 `webOrigin` 的 credentialed CORS；若使用 Cookie 会话，应核对 React origin 被允许并正确配置 credentials，而不是为接入开放任意 origin。真实余额、库存和订单成功以服务端事务结果为准，并处理幂等、防重复提交和限流；不复制 Vue 的 API client/store。

## 9. 验证记录与接手检查

**此前交付记录（历史验收，不是本次重新执行）：** React typecheck、组件库 build、catalog build 通过；上游校验报告 117 个文件未变，catalog 上游报告 13 个文件未变；1440x900 和 390x844 已检查侧栏/遮罩、账户及购买弹窗，原入口保持可用。这不等于所有业务流程、键盘操作或其他宽度都已验收。

**本次文档交接核对：** 源码、路由、技术栈说明和实际文件路径已阅读；首页两个 SHA-256 与基线相同；最近运行服务为 `127.0.0.1:5177`。未重新执行构建、测试套件或浏览器截图。

历史控制台日志包含：`Encountered a script tag while rendering React component. Scripts inside React components are never executed when rendering on the client.`，例如 `D:/linepool/.playwright-cli/console-2026-10-09T16-27-17-102Z.log`。此前将其归因于 ReferenceWorkspace 内部 script 的说法未被当前源码核实：当前 `Reference.tsx` 没有 `<script>`。接手后重现并定位具体依赖/组件栈，不据此修改只读首页或上游组件。

现有视觉参考文件 `D:/linepool/output/playwright/workspace-styles/reference-desktop.png`、`reference-mobile.png` 可用于历史对照；不要把它们当作本次 shell 的新截图。后续按实际变更生成并登记自己的浏览器截图、控制台日志和验证结果。

每批变更前后执行下面的首页校验；上游完整性脚本不代替此校验：

```powershell
cd D:\llinepool\linepool-ui
$baseline = @{
  'src/linepool/showcase/Reference.tsx' = 'a6929cb8e5269d7fd753614361f55b03e4a8cbc5ce72d44026899d4c9bbbd32f'
  'src/linepool/showcase/Reference.css' = '1e01493023ee299addf450a56d6ea8ab11160d31c494e3debd7f04923956d068'
}
foreach ($path in $baseline.Keys) {
  $actual = (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $baseline[$path]) { throw "Read-only homepage changed: $path" }
  Write-Output "$path unchanged"
}
```

交付时说明变更路径、已完成/未完成动作、两项哈希、构建/类型/上游检查结果、浏览器覆盖尺寸和遗留问题。不要只报告“构建通过”就宣布产品功能完成，也不沿用其他入口的测试结果作为 shell 证明。

## 10. 新会话接手说明

```text
你负责 D:/llinepool/linepool-ui 的 React 页面
http://127.0.0.1:5178/#workspace-reference-shell 后续优化。
先完整阅读 AGENTS.md 与 docs/workspace-reference-shell-handoff.md，
再核对 shell TSX/CSS、navigation.ts、demo-data.ts、WorkspacePages.tsx/CSS、
catalog/main.tsx 和只读 Reference 的实际实现。不要修改旧 D:/linepool 副本。

必须保留 #workspace-reference 原入口，Reference.tsx/Reference.css 内容和样式不变，
不复制首页，不通过 shared 数据、资产或全局样式间接改变首页。
新前端用 React，不引用 Vue/5174 实现；其他业务视图依赖原首页的视觉语言。
侧栏入口已经是独立 hash 页面，不要恢复为弹窗。
新业务页只使用独立演示状态，继续补细节及导航可访问性。
原首页缺少外部 props/回调；涉及其导航语义或业务数据同步时先说明约束和方案，
不能擅自修改只读文件，也不能声称未接通的动作成功。
不运行测试套件或浏览器验证；允许 typecheck/build/源码完整性校验。
不接生产 API、不修改 Vue、不回滚历史改动、不自动提交或安排关机。
每批完成后核对首页 SHA-256；视觉验收须等用户恢复验证授权。
```

## 11. 2026-10-10：侧边栏收纳

本批范围仅为侧边栏收纳，不实施上述业务流程待办。

- 修改 `src/linepool/workspace-reference/WorkspaceReferenceShell.tsx` 和同目录 CSS；使用现有 lucide 双箭头，不使用商业 SidebarNav。
- 桌面在侧栏右边缘新增双左箭头，点击收纳至 72px 图标栏；双右箭头恢复原 280px/245px 宽度。收纳不卸载首页，菜单继续打开原有弹窗。
- 图标保留可访问名称及原生 hover tooltip，未读角标保留；到期快捷入口仅在有到期记录且提醒启用时显示。不修改原提醒规则或其他业务语义。
- 手机端保留原抽屉布局；桌面收纳状态不隐藏移动菜单文字，移动菜单新增展开状态语义，切到桌面时清除残留抽屉状态。
- 未改 `Reference.tsx`、`Reference.css`、共享数据、资产或上游文件。变更前首页 SHA-256 与第 1 节一致。

**用户要求暂停验证前已完成的检查：** typecheck、组件库 build、catalog build 通过；上游 117 个文件、catalog 上游 13 个文件完整性通过。没有运行测试套件。

浏览器已检查 1440x900、1024x768，以及 1100/1101/821/820/801/800/540/390/320px 宽度的相关布局；收纳菜单、Enter/Space 切换、移动遮罩和跨断点状态已检查。1440px 展开状态的画布截图对比：764 个差异像素全部位于新增边缘按钮区域，其余画布像素一致。截图在 `D:/linepool/output/playwright/sidebar-collapse/`。

仍复现交接已有的 React script-tag 控制台错误，日志为 `D:/linepool/.playwright-cli/console-2026-10-10T02-32-34-170Z.log`；未因该记录改动只读首页或上游。catalog 构建仍提示 500kB 以上 chunk，本批不处理包体积。

用户随后要求“暂时不要做测试”，已停止后续测试和浏览器验证。第 6 节未完成事项及移动菜单原有焦点/遮挡风险仍保留，不将本批收纳功能交付视为完整产品验收。

## 12. 2026-10-10：新目录与独立业务页面

用户要求先在 `D:/llinepool` 工作，再把侧栏“工作台/购买号码等”改成独立页面，不再点击后弹窗。

**目录：** 已将旧前端复制到 `D:/llinepool/linepool-ui`，包括启动所需依赖和原组件库产物；未复制旧输出截图/日志和 catalog-dist，未移动或删除旧目录，也未覆盖现有 `platform`。本批所有源文件改动只在新目录；git 显示未跟踪的 `linepool-ui/` 和 `.pi/`，后者未纳入本批代码修改，未提交。

**页面地址：**

| 页面 | hash |
| --- | --- |
| 工作台 | `#workspace-reference-shell` |
| 购买号码 | `#workspace-reference-shell/purchase` |
| 我的号码 | `#workspace-reference-shell/numbers` |
| 短信收件箱 | `#workspace-reference-shell/inbox` |
| 订单记录 | `#workspace-reference-shell/orders` |
| 积分明细 | `#workspace-reference-shell/points` |
| 我的账户 | `#workspace-reference-shell/account` |
| 账户设置 | `#workspace-reference-shell/settings` |
| 地区服务 | `#workspace-reference-shell/regions` |

国家导航使用 `.../regions?region=us` 等地址；地区选购使用 `.../purchase?region=us`；号码对应短信使用 `.../inbox?number=n1`。直接打开、刷新和历史导航由 hash 解析处理，未知页面有返回工作台入口。普通链接支持键盘和新标签打开；页内临时搜索筛选不写入 URL。

已删除 `ShellPanel` 和全部旧弹窗样式。工作台直接使用原组件，其他业务页占据整个内容区，不嵌套在首页或弹窗中。页面切换时卸载原首页，避免其原生短信 dialog 在浏览器历史切页后残留于 top layer；再次返回时原首页自身临时状态重置。首页源文件、共享数据/样式、资源和上游均未更改。

独立状态从 shared 生成副本，刷新后重置。演示下单先校验地区/服务/套餐、1至10整数数量、库存、余额，再以请求 id 去重，联动号码/订单/积分流水/库存。新号码含 `DEMO`，不是真实号码。收件箱已读联动壳层徽标，但不宣称原首页封闭状态同步。复制复用现有 `CopyValue`，真实调用 Clipboard API并显示成功/失败。

样式仅新增 `lp-shell-view` 范围和必要的侧栏链接样式。业务页复用 Beautiful UI 的 `ActionButton`/`StatusPill`/`OrderStatusPill`，不改上游源码、不增加依赖、不更换视觉系统；参考页原圆角/图表/字体和图片保持不变。

**本批校验：** `npm run typecheck` 与 `npm run build:catalog` 通过；完整性报告上游117个文件、catalog上游13个文件不变。首页两项SHA-256与第1节一致。构建仍有大于500kB的旧chunk警告。本批没有运行测试套件或浏览器交互/截图验收，响应式与交互结果待用户恢复验证后确认。

**预览：** 新目录服务为 `http://127.0.0.1:5178/`，node PID `37656`，启动日志显示 Vite ready，stderr为空；5177旧服务保留。下次启动命令为 `npm run dev -- --port 5178`，如端口已占用先核对进程，不强杀其他服务。

**后续仍未完成：** 真实登录/API、分页、号码独立详情、完整抽屉焦点约束/滚动锁、首页旧入口接线和首页数据同步。后两项有只读约束，须先取得授权，不能通过改 shared 或 DOM 注入绕过。第11节浏览器覆盖是旧收纳任务记录，不能作为本批独立页面验收。

## 13. 2026-10-10：首页动效与图表交互（用户有限授权）

**授权与分工：** 用户恢复 LoudTiger 与 LoudKnight 的首页协作，随后明确指出 `#workspace-reference-shell` 缺少悬浮/点击效果且图表不能点；经结构化确认选择“允许补交互”，允许 `Reference.tsx/Reference.css` 的必要交互与局部动效。LoudTiger 是本批唯一写入者，LoudKnight 只读讨论/复核。首页的布局轨道、尺寸断点、字体、图片与原配色保留，不新增依赖，不改 `shared.tsx`、`showcase.css`、资产或上游，不接网络/API，不运行测试套件或浏览器验收。

**本批源文件：** `showcase/Reference.tsx`、`showcase/Reference.css`、`workspace-reference/WorkspaceReferenceShell.tsx`、`WorkspaceReferenceShell.css`，以及本交接记录；未修改旧目录或 `platform`。项目仍未提交。

- 首页主要区域短时进入动画，链接、指标、服务图标、月份、短信行、有效期行和图标按钮的悬浮/按下/焦点反馈；原短信 dialog 增加进入反馈，关闭保持即时。
- 图表由独立本地演示周/日序列驱动，曲线、提示和总计使用同一模型，不再用固定路径冒充联动。月份/范围切换更新数据，零数据有空态；短信总计保留 38/47/56/0 及 7 天的 10/12/14/0。样例趋势并非真实短信日志，仍与首页/壳层业务 reducer 的演示数据独立。
- 鼠标悬浮预览、点击或触摸点选并保留选点；离开图表回到已选点。焦点进入图表后支持方向键、Home/End 和 Enter/Space，提供 slider 的可访问数值。图例按钮可隐藏/显示系列，至少保留一组，tooltip 只显示当前可见系列。数据曲线会随演示序列变化，不再承诺旧固定曲线路径逐像素一致。
- 首页增加可选 `links` 映射；shell 明确将购买、号码、短信、订单、服务和品牌入口接至各自独立 hash 页，原独立入口仍有默认导航。使用真实 anchor 保留新标签/修饰键语义，不用文本匹配、DOM 注入或全局改写 catalog 路由。首页数据仍未与壳层 reducer 同步。
- 账户刷新图标现在真实重置演示视图（搜索、月份、范围、图例），不再只提示“数据已更新”；不宣称请求过 API。
- 移动抽屉增加显式关闭按钮、初始焦点、Tab/Shift+Tab 循环、背景内容/触发器 inert、滚动锁及 cleanup。Escape/遮罩/同路由导航恢复触发器焦点，异路由导航交给内容焦点，跨桌面断点恢复到可见导航；桌面 72px 收纳保持即时布局。
- 动效只用于局部 opacity/transform 和背景色等反馈，不做循环装饰、宽高/grid 动画或长期 will-change。`prefers-reduced-motion` 禁用这些动画/过渡和位移，保留即时状态/焦点。
- 静态复核发现原小屏菜单按钮与首页品牌入口重叠；仅 shell 的 dashboard 小屏以导航按钮复用品牌圆形占位，原品牌链接 `visibility:hidden` 保留布局，原蓝色与旁侧 LINEPOOL 文字保留。桌面、独立首页及其他业务页不受该规则影响。此项尚未经浏览器确认。

第 12 节遗留的抽屉焦点约束/滚动锁和首页入口接线已在本批补齐；首页/壳层数据同步仍未实现。7 天样例使用“第 N 天”标签，不虚构将来月末的“过去 7 天”真实日志。

**最终静态/编译校验：** 最新 `npm run typecheck` 与 `npm run build:catalog` 均通过，后者包含上游 117 个文件及 catalog 上游 13 个文件完整性校验；catalog 保留既有大于 500kB 的 chunk 警告。中途同事新增 API contracts 尚未安装 zod 导致过 TS2307；已由 MintJaguar 闭合依赖和包锁，我重跑后通过，我未改 API/包/锁。首页资产 14 个文件与保留的 `D:/linepool/linepool-ui` 原目录相等；`shared.tsx` 与 `showcase.css` 的旧哈希仍一致。本批修改的最新 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `showcase/Reference.tsx` | `5b85e346c8978f00f5271cbf9d549739c279900c210e0f2a6f09a3527929cb27` |
| `showcase/Reference.css` | `62c592dfd37ab4da96a8dbc3350481ca15a7b75da1236421b726d9da38e80224` |
| `workspace-reference/WorkspaceReferenceShell.tsx` | `5ca58204bf26b657d0ebeee94da2411431e53321e98f3e146782c9701146005c` |
| `workspace-reference/WorkspaceReferenceShell.css` | `7e8046a6c996c33407aebacfe150ffbbd6000ccb0d7dc7c86a60f810320755c9` |

**复核边界：** 已完成父会话静态检查；LoudKnight 的最终四文件只读复核已请求，结论尚未返回，不算通过。未运行测试或浏览器验证，因此手机触摸、读屏、焦点和视觉结果仍需用户恢复验证后验收，不能引用第 11 节截图作为本批通过证明。

**服务：** 只读核对 5178 仍由 PID 37656 监听、5177 由 PID 6180 监听；5178 根地址 HTTP HEAD 返回 200，两服务均未重启/停止。当前预览仍为 <http://127.0.0.1:5178/#workspace-reference-shell>。

