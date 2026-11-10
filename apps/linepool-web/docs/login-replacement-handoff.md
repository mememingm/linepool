# 交接：用新版登录页替换 `/login` 和 `/register`

> 执行前请完整读完本文，尤其是最后的「边界」部分。只做本文写明的改动，其余一律不动。

## 背景（只读）

- 项目目录：`D:\llinepool\linepool-ui`。dev server 已在 http://127.0.0.1:5178 运行，**不要另启服务**。
- 新版登录 / 注册页已完成，目前挂在预览路由 `/login-v2`、`/register-v2`：
  - `src/linepool/auth/AuthPage.tsx`（页面组件，`register` 属性区分登录和注册）
  - `src/linepool/auth/auth.css`
  - `src/linepool/i18n/auth-messages.ts`（已接入 `src/linepool/i18n/messages.ts`）
  - `src/linepool/home/Flaps.tsx`（翻牌组件，首页和登录页共用）
- 以上文件及相关改动**可能尚未提交**。这是正常状态，**不要还原、stash 或重写**。
- 旧版登录页是 `src/linepool/welcome/WelcomeLogin.tsx`，外面套着 `OriginalScene` 星空背景。
- 新页面的登录逻辑复用了旧文件导出的 `loginDestination`（`import { loginDestination } from '../welcome/WelcomeLogin'`）。因此**旧文件必须保留**。

## 目标

1. 访问 `/login`、`/register` 时显示新版 `AuthPage`，不再渲染 `OriginalScene` 星空背景。
2. 访问 `/login-v2`、`/register-v2` 时自动跳转到 `/login`、`/register`，并保留 `?redirect=...` 等查询参数。
3. 新页面里「登录 ⇄ 注册」的切换改为跳到正式路由 `/login`、`/register`。
4. 以下行为保持不变：
   - `/forgot-password`、`/reset-password` 页面（继续使用旧样式和 `OriginalScene`）
   - 首页 `/`
   - 工作台 `/app`、管理后台 `/admin`、代理中心 `/agent`
   - 未登录时跳转到 `/login?redirect=...` 的逻辑

## 允许修改的文件（只有这 3 个）

### 1. `src/app/App.tsx`

- 删除这一行：`import WelcomeLogin from '../linepool/welcome/WelcomeLogin';`
- **保留** `import { OriginalScene } from '../linepool/welcome/WelcomeShared';`，找回密码页还在用。
- 保留 `const AuthPage = lazy(() => import('../linepool/auth/AuthPage'));`，不改。
- 把这一行：
  ```tsx
  if (path === '/login-v2' || path === '/register-v2') return <Suspense fallback={null}><AuthPage key={path} register={path === '/register-v2'} /></Suspense>;
  ```
  改成：
  ```tsx
  if (path === '/login' || path === '/register') return <Suspense fallback={null}><AuthPage key={path} register={path === '/register'} /></Suspense>;
  ```
- 删除下面这两行（旧登录路由）：
  ```tsx
  const welcomePath = path === '/login' || path === '/register';
  if (welcomePath) return <><OriginalScene /><WelcomeLogin key={path} /></>;
  ```
- `/forgot-password`、`/reset-password` 那一行**原样保留**。
- 其余代码一律不动，不要调整其他路由的顺序。

### 2. `src/app/router.ts`

- 在 `normalizeAddress` 的 `aliases` 对象里增加两项：
  ```ts
  '/login-v2': '/login', '/register-v2': '/register'
  ```
  改完后应为：
  ```ts
  const aliases: Record<string, string> = { '/welcome': '/', '/home-v2': '/', '/sign-in': '/login', '/sign-up': '/register', '/login-v2': '/login', '/register-v2': '/register' };
  ```
  现有逻辑会自动把 `search` 拼回去，不需要额外处理。
- 在 `isAppPage` 中删除 `path === '/login-v2' || path === '/register-v2' || `。`'/login'`、`'/register'` 保留。
- 其余代码一律不动。

### 3. `src/linepool/auth/AuthPage.tsx`

只改这两行：

```ts
// Preview routes; switch to /login and /register once this page replaces WelcomeLogin.
export const AUTH_PATHS = { login: '/login-v2', register: '/register-v2' } as const;
```

改为：

```ts
export const AUTH_PATHS = { login: '/login', register: '/register' } as const;
```

页面的其余内容（结构、文案、样式、交互、登录逻辑）**一律不动**。

## 验证（只做这些）

1. `npx tsc --noEmit`：必须无报错。
2. `node scripts/verify-upstream.mjs`：必须输出 `Upstream integrity: 117 files unchanged`。
3. 在浏览器中检查以下各项：
   - `/login`：显示新版页面，左边是深色收码看板，右边是登机牌样式的表单，没有星空背景。
   - `/register`：显示新版注册表单（昵称 / 邮箱 / 密码 / 确认密码）。
   - 访问 `/login-v2?redirect=%2Fapp`：地址栏变为 `/login?redirect=%2Fapp`。
   - 在 `/login` 点「注册」标签：地址变为 `/register`，查询参数保留。再点「登录」能切回来。
   - 「忘记密码？」跳到 `/forgot-password`，这个页面仍是旧样式，属于正常现象。
   - 首页的「登录」「注册」链接能进入新页面。
   - 中 / 英文切换、深浅色切换正常。
   - 用一个错误密码提交（比如账号 `nobody@example.test`、密码 `wrong-pass-123`），显示「账号或密码不正确」。**不要用任何真实账号或密码**，也不要创建账号。
   - 控制台除了未登录时 `/api/auth/me` 返回的 401 之外，没有新的报错。
4. 汇报：贴出 `git diff -- src/app/App.tsx src/app/router.ts src/linepool/auth/AuthPage.tsx`，以及上述每一项的检查结果。

## 边界（禁止事项，务必遵守）

- ❌ **只允许修改上面列出的 3 个文件。** 如果认为其他文件也必须改，**立即停下来报告**，不要自行处理。
- ❌ **不准删除或修改**以下旧文件和资源，它们仍在被使用，或者要由用户之后另行决定：
  - `src/linepool/welcome/WelcomeLogin.tsx`（`AuthPage` 依赖它的 `loginDestination`，`WorkspaceAccess.tsx` 依赖 `WelcomeAccess`）
  - `src/linepool/welcome/WelcomeShared.tsx`、`welcome.css`、`WelcomePasswordRecovery.tsx`（找回密码页在用）
  - `src/linepool/welcome/WelcomePage.tsx`、`src/linepool/welcome/reference/**`（`reference/messages.ts` 被 `i18n/format.ts` 引用）
  - `src/linepool/workspace-reference/WorkspaceAccess.tsx`
  - `public/login-scene/**`、`public/authkit-reference/**`
- ❌ 不准修改 `src/vendor/**`、`public/**`、`upstream-lock.json`，也不准重新生成 lock。
- ❌ 不准修改新登录页的设计、文案、CSS 或翻译：`auth.css`、`auth-messages.ts`、`home.css`、`Flaps.tsx`、`messages.ts` 都不碰。
- ❌ 不准改动找回密码 / 重置密码页面，也不准把它们迁到新样式。这是另一项任务。
- ❌ 不准修改 `backend/`、`packages/contracts/`、`vite.config.ts`、`package.json`，也不准安装或升级依赖。
- ❌ 不准修改 `AdminShell.tsx`、`AgentAdminShell.tsx`、`AgentPermissionGuard.tsx`、`WorkspaceReferenceShell.tsx` 中跳转到 `/login` 的代码。路由名没变，它们不需要改。
- ❌ 不准跑测试：`npm test`、`vitest`、任何 `*:test` 脚本都不行。只允许类型检查、构建和 upstream 校验。
- ❌ 不准顺手重构、格式化、整理 import 顺序或改命名。diff 只能包含本文列出的改动。
- ❌ 不准 commit、push、建分支、stash，也不准还原任何未提交的改动，除非用户明确要求。
- ❌ 不准用真实账号登录，不准注册账号，不准接入真实的号码供应商或支付。
- ❌ 不准另启 dev server，5178 端口已在运行。
- ⚠️ 不要理会仓库外的 `../ccam/` 目录和 `docs/` 下的其他文件。
