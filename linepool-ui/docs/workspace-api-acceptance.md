# Workspace API 接入与浏览器验收

## 当前边界

目标入口：<http://127.0.0.1:5178/#workspace-reference-shell>。

React 工作台已经从本地 demo state 切换到 `src/linepool/api/client.ts`，实际请求本机 `http://127.0.0.1:3010/api`，数据由 PostgreSQL 5433 持久化。登录、账户、目录、库存、订单、号码、短信和积分不再从前端 fixtures 读取。首次未登录显示登录表单；刷新失败显示错误与重试，不生成演示记录。

后端目前仍运行在 `mode=demo`：库存号码和既有短信是数据库中的 DEMO 种子，没有真实供应商收码、支付或充值。前端移除本地演示状态不代表这些能力已上线。独立 `#workspace-reference` 设计展示及其他 catalog 入口保留原展示用途。

## 实现位置

- `src/linepool/workspace-reference/workspace-data.ts`：客户端实例、全量分页加载、账户/目录/号码/短信/订单/积分/dashboard 聚合、API 到首页展示模型的适配。
- `src/linepool/workspace-reference/useWorkspaceApi.ts`：登录与登出、加载与刷新、401 处理、写操作、下单意图与幂等恢复。
- `src/linepool/workspace-reference/WorkspaceAccess.tsx`：未登录表单、初始加载和初始失败重试。
- `src/linepool/workspace-reference/Shell.tsx`：认证门禁、导航、刷新状态、未读徽标，以及业务页面的数据/动作注入。
- `src/linepool/workspace-reference/WorkspacePages.tsx`：购买、号码、短信、订单详情、积分、账户偏好。
- `src/linepool/showcase/Reference.tsx`：接收工作台传入的 API 展示数据，短信已读和搜索联动；保留独立展示入口。

`VITE_LINEPOOL_API_URL` 可覆盖 API 地址，未配置时工作台使用 `http://127.0.0.1:3010/api`。请求携带 HttpOnly 会话 Cookie，不向 localStorage 写登录凭据、短信正文或验证码。

下单意图及 UUID 请求键按账户保存在 sessionStorage。服务器已落库但响应丢失时，页面冻结地区、服务、套餐和数量；刷新后的重试仍复用同一个请求键与请求内容，避免重复下单或扣积分。正常刷新失败保留上次确认的 API 数据并提示重试；401 会清除受保护的数据视图。

## 验收结果

Playwright 真实浏览器主验收：登录 3 项、正常业务链路 17 项、错误与移动端链路 27 项断言通过。最后一轮复核还确认订单详情 404 的恢复与账户余额等于持久化积分流水之和。

| 场景 | 已验证结果 |
| --- | --- |
| 登录 | 错误密码得到 401 和可见错误；本机配置账户正常登录；刷新后会话有效 |
| 目录与首页 | 从 API 加载地区、服务、7/30 天报价及库存；首页统计、趋势和最近短信/号码来自 API 记录 |
| 正常下单 | 真实 POST 创建订单并分配号码；积分准确扣减；订单、号码、dashboard 与库存刷新一致 |
| 订单与短信 | 订单列表/详情显示 API UUID 对应记录；短信详情、搜索、已读与未读徽标同步；刷新后仍持久化 |
| 积分 | 余额、购买扣费与流水一致；最终余额等于流水 delta 合计 |
| 账户 | 到期偏好通过 API 保存、刷新后保留；验收后恢复原偏好 |
| 刷新故障 | 网络中断、500、非法 DTO 不引入 fixtures、不覆盖上次成功数据；重试恢复 |
| 下单故障 | 409 库存冲突解除提交状态且不扣积分；非法数量被阻止；响应丢失后的同键恢复只新增一笔订单、只扣一次积分 |
| 空态与详情故障 | 筛选无结果时显示空态，不回填演示号码；详情 404 保留列表和错误提示，重试后恢复 |
| 会话与登出 | 401 清除私有数据；登出使服务器会话失效；登出后刷新不能访问私有记录 |
| 移动端 | 390px 购买页/首页无页面横向溢出，导航切页后关闭；没有 Vite 错误遮罩 |

最终数据库/API 状态：余额 1236，8 笔订单，8 个分配号码，9 条短信，2 条未读；账户原有到期提醒偏好已恢复。初始化基线为 3 笔订单、余额 1311，因此验收共创建 5 笔每笔 15 积分的 DEMO 订单。这些是实际数据库写入，不是前端假成功，刷新或重新登录不会回滚。

编译检查通过：`npm run typecheck`、`npm run api:typecheck`、`npm run build`。生产组件包构建的 117 个上游文件完整性检查通过。此记录不是生产上线、真实供应商收码或完整安全审计证明。

## 可复现脚本

在 `D:/llinepool` 运行；先确认 PostgreSQL、API 与前端已经启动，必要时分别执行 `npm --prefix linepool-ui run db:start`、`npm --prefix linepool-ui run api:start`、`npm --prefix linepool-ui run dev -- --host 127.0.0.1 --port 5178 --strictPort`。凭据使用 `linepool-ui/backend/.env` 中的 `DEMO_EMAIL` / `DEMO_PASSWORD`。截图脚本的路径以此工作目录为基准。

```powershell
node linepool-ui/scripts/prepare-workspace-login.mjs
npx --yes --package @playwright/cli playwright-cli -s=linepool-api-acceptance open "http://127.0.0.1:5178/#workspace-reference-shell"
npx --yes --package @playwright/cli playwright-cli -s=linepool-api-acceptance run-code --filename=linepool-ui/output/playwright/private-login.browser.js | Select-Object -First 4 -Wait
npx --yes --package @playwright/cli playwright-cli -s=linepool-api-acceptance run-code --filename=linepool-ui/scripts/accept-workspace-happy.browser.js | Select-Object -First 4 -Wait
npx --yes --package @playwright/cli playwright-cli -s=linepool-api-acceptance run-code --filename=linepool-ui/scripts/accept-workspace-errors.browser.js | Select-Object -First 4 -Wait
Remove-Item -LiteralPath linepool-ui/output/playwright/private-login.browser.js
```

`Select-Object -First 4 -Wait` 只显示结果，不把包含凭据的登录脚本正文回显到工具日志。`prepare-workspace-login.mjs` 仅把本机配置账户写入已忽略的临时目录，不打印密码；本轮验收结束后已删除该临时文件。不要提交、分享或展示此文件及 `backend/.env`。

复核订单详情 404、余额流水及最终移动端截图时，重新生成并执行登录脚本，再运行 `scripts/accept-workspace-final.browser.js`，随后删除临时登录文件。主错误脚本与最终复核都会登出。

这些脚本会写入真实本机 DEMO 数据库，正常链路和错误链路各可能创建订单；重新运行会增加 DEMO 订单和积分流水。仅在明确授权的本机联调环境执行，不在生产账户或真实付费库存上运行。

## 截图与剩余风险

浏览器截图保存在已忽略的 `linepool-ui/output/playwright/`：`09-dashboard-desktop.png`、`02-purchase-desktop.png`、`04-orders-desktop.png`、`05-points-desktop.png`、`10-purchase-mobile.png`、`11-dashboard-mobile.png`。截图反映 API 记录，验收过程中不同阶段的订单数量可能不同；故障注入及中间诊断截图不表示最终验收失败。

保留的展示组件存在既有的 React prop 警告，不影响本轮链路；注入的 401/404/409/500/网络错误也会出现在浏览器控制台。本轮没有观察到空白工作台或 Vite 错误遮罩。真实供应商、支付充值、短信实时推送与生产部署均不在此次范围。
