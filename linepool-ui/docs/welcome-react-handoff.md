# React 首页与登录页接入

## 入口

当前开发服务：<http://127.0.0.1:5178/>。

- `/`、`/welcome`：迁移自 `D:/linepool/platform/apps/web/src/views/LandingView.vue` 的首页。
- `/login`、`/sign-in`：参考登录页的 React 实现。
- `/sign-up`：注册表单。
- `/#workspace-reference-shell` 及其子页面：原工作台保留；未登录使用同一登录界面。
- `/catalog` 或原 `#business`、`#beautiful`、`#animata`、`#cult`：组件展示保留。
- 其他原工作台、设计展示 hash 入口保持可用。

参考 Vue 项目和 `http://127.0.0.1:5174/welcome` 未修改。生产静态托管需要为 `/welcome`、`/login`、`/sign-in`、`/sign-up`、`/catalog` 配置 SPA 回退到 `index.html`。

## 实现

- `catalog/main.tsx`：默认首页、路径入口及原 hash 分发。
- `src/linepool/welcome/WelcomePage.tsx`：Shadow DOM 首页、卡片切换、键盘导航、月份选择、观察器与动画生命周期清理。
- `src/linepool/welcome/WelcomeLogin.tsx`：登录/注册表单、确认密码、密码显隐、提交状态、错误和连接重试；仅允许映射到本工作台的登录后目标。
- `src/linepool/welcome/WelcomeShared.tsx`：中英文与主题控制、动态场景和减少动画的静态替代。
- `src/linepool/welcome/welcome.css`：独立登录样式及字体声明。
- `src/linepool/welcome/reference/`：复制的首页 HTML、覆盖 CSS、GSAP 动画和翻译表。
- `src/linepool/workspace-reference/WorkspaceAccess.tsx`：复用新登录界面，保留原认证回调。
- `scripts/prepare-workspace-login.mjs`：旧标题定位更新为 `登录 LINEPOOL`。

按用户迁移授权新增 `public/authkit-reference/`、`public/login-scene/`、`public/illustrations/`，没有覆盖原有 public 资源。插图目录为 HTML 实际引用的额外依赖。新增 `gsap` 依赖以复用原动画模块；原上游锁不变。

登录和注册仍调用原 `useWorkspaceApi().authenticate`，使用现有 API、HttpOnly Cookie 和会话检查。注册密码下限按当前 React 后端契约为 8 字符，而非 Vue 参考页的 12 字符。登录成功后到 `/#workspace-reference-shell`；首页号码、短信、订单和购买链接的 `redirect` 映射到对应工作台页，任意外部地址不会作为跳转目标。

语言仅持久化偏好，不存凭据。主题沿用现有 `next-themes`。静态首页明确保留示意内容，未将首页示例替换为私人 API 数据。

## 本轮验证

- `npm run typecheck` 通过。
- `npm run build` 通过。
- `npm run build:catalog` 通过。
- 上游组件 117 文件和目录展示上游 13 文件完整性校验通过。
- Playwright 用于页面观察、交互和截图，未运行测试套件，未提交注册/下单或修改业务数据。
- 桌面原页与 React 首页截图比较，首页结构、字体及资源正常。
- 390px 首页、登录、注册和原工作台未登录入口，无页面横向溢出。
- 月份按钮实际更新选中值，中英文切换、主题切换可用。
- 动态背景移动端画布 390 x 844，像素取样有 25285 个亮色样本；连续两帧截图不同。桌面画布连续帧也不同。
- 减少动画模式显示 `still.png`，iframe 数量为 0。
- 未观察到缺失首页图片或 Vite 错误遮罩。

截图在已忽略的 `output/playwright/welcome-*.png`。已有主题 provider 在 React 19 下产生 script 标签警告；未登录会话检查的 401 是正常响应。本轮未重新执行既有业务端到端验收，也不增加真实供应商、支付或生产部署能力。
