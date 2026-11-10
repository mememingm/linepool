# LinePool UI boundaries

- User requirement: use Beautiful UI and Magic UI; do not modify already-written upstream UI components.
- `src/vendor/**`, `public/**`, and `upstream-lock.json` are a read-only source baseline. Never edit them or regenerate the lock to hide changes without explicit operator approval for an upstream update.
- Add business functionality only in `src/linepool/**`, via composition and existing upstream props. Do not fork/reimplement upstream visual components or globally override their component CSS selectors.
- Keep original license notices and static resources. SidebarNav is excluded because its commercial icon license has not been provided; do not bypass this by rewriting it.
- This is the LinePool frontend in the monorepo, with its API in `services/core/`, shared contracts in `packages/contracts/`, and the ONCE frontend in `apps/once-web/` (paths relative to the repository root). The legacy Vue `platform/` has been removed. Do not wire production suppliers or payments without user authorization.
- Preserve the user's earlier no-tests instruction: do not run tests. Build, typecheck, and source-integrity verification are allowed.
  例外（2026-11-10 用户授权）：允许运行 `npm run test:integration`。它只能连接名称以 `_itest` 结尾、位于 127.0.0.1 的一次性数据库，运行结束即删除；不得连接 sandbox 或任何远程库；其余测试脚本仍然禁止。
