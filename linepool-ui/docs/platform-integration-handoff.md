# Parent integration handoff

## Phase 1 integration, 2026-10-10

Work is scoped to `D:/llinepool/linepool-ui`. MintJaguar released all Phase 1 reservations before parent edits. No test suite, database command, private configuration read, business write or commit was performed.

### Root changes

- Root npm workspaces: `packages/contracts` and `backend`; `@linepool/contracts@0.1.0` resolves to the local workspace, not a registry package.
- Root dependencies now include Vitest and concurrently; Node >=22 is required. Installation used `npm install --ignore-scripts --no-audit --no-fund`, so package lifecycle scripts were not executed.
- Root `package-lock.json` is the canonical workspace lock. Existing backend lock was preserved, not rewritten; use installation from the root rather than a standalone backend install.
- Existing UI library `build`, package exports, peer dependencies and license/integrity processing are retained.
- `api:install` now installs from the workspace root. Backend build/typecheck/dev commands use workspace selection. Existing database commands remain available; none was run.
- `prebuild` builds contracts. `pretypecheck` builds the existing UI library and declarations before consumer checks, so a fresh checkout does not rely on old `dist/types`. Do not run library builds and frontend typechecking concurrently: Vite clears that dependent output directory.
- `predev` prepares the library; default Vite port is 5178, matching the backend's default allowed origin. `dev:all` prepares the library then runs website, backend and contracts watcher with concurrently. It does not migrate or seed. Occupied strict ports are an error; existing services were not stopped or relaunched during this integration.
- `linepool-ui/.gitignore` explicitly excludes contracts output and backend `dist-test`; the repository already ignores `dist/` globally.

### Commands

Run from `D:/llinepool/linepool-ui`:

| Command | Purpose |
| --- | --- |
| `npm install --ignore-scripts` | Root workspace installation; does not execute dependency lifecycle scripts |
| `npm run contracts:build` | Build shared JS and declarations |
| `npm run typecheck:all` | Contracts/frontend/backend and test-source compilation; does not execute tests |
| `npm run build:all` | Existing library, current website/catalog and backend production builds |
| `npm run dev:all` | Fullstack development and contracts watcher; no database initialization |
| `npm run test` | Future authorized contract/client/backend suites; NOT executed |
| `npm run db:test:setup` | Future explicit isolated initialization, after backend compilation; NOT executed |

The last two commands are capabilities, not instructions to run them under the current no-tests/no-database-writes policy. Test initialization still requires separately supplied `TEST_DATABASE_URL`, `TEST_DATABASE_ADMIN_URL` and an exact `TEST_DATABASE_CONFIRM`, and rejects unsafe targets before connecting. No private business credentials were copied.

### Actual Evidence

- Local package linking confirmed with `npm ls @linepool/contracts --workspaces --depth=0`.
- `npm run build:all` passed after the final dependency installation.
- `npm run typecheck:all` passed after the final dependency installation and the corrected declarations prerequisite.
- Build integrity checks passed: 117 source upstream files and 13 catalog upstream files unchanged.
- `git diff --check` passed. Existing project content is substantially untracked; this is not comprehensive source-review evidence.
- One attempted parallel build/typecheck hit transient missing library declarations while Vite recreated `dist`; checks were rerun serially and passed. The command prerequisite was tightened as described above.

### Remaining Work

Phase 2 business details/navigation and Phase 3 preferences/onboarding have now been released and integrated, as described below. Final parent entry separation/lazy loading/browser observation remain pending. `build:web` currently wraps the existing library and combined website/catalog build; it is not yet a physically separated website output. The current combined main bundle is approximately 968 kB minified and produces a size warning. Entry separation is reserved for Phase 4. Production deployment and SPA fallback are not completed by these local builds.

Test sources were compiled, not executed. Isolated database initialization, full HTTP middleware regression, browser authentication/order flows and production suppliers/payments remain unverified or outside scope. Do not describe these suites as passing.

## Phase 2 Barrier

LoudKnight released all approved files before parent edits. New region/service/offer/order detail URLs, purchase preselection and compatibility details are recorded in `docs/platform-details-handoff.md`. Root now exposes `details:typecheck` and `details:test`; aggregate compilation includes detail test sources, while the test command remains future capability only. Parent `npm run typecheck:all` passed including all detail sources. Colleague `build:catalog` and 117/13 integrity checks passed before handoff. No suite or business mutation was performed. Phase 3 may start after parent reservation release; earlier owners remain read-only.

## Phase 3 Barrier

LoudTiger released all implementation reservations. Parent added `preferences:typecheck` and `preferences:test`, and included preference source compilation in the aggregate command. Serial `npm run typecheck:all` and `npm run build:all` passed after integration; integrity checks retained 117 source files and 13 catalog files unchanged. No suite, database command or browser interaction was executed. Locale/theme/guide behavior is implemented but visual, keyboard, cross-tab and modal lifecycle acceptance is still unverified. The combined entry remains 1,004.81 kB minified (312.25 kB gzip), with a chunk-size warning; entry separation/lazy loading is still pending parent work. All three colleague implementation phases are released; no colleague is authorized to edit during the final parent phase.
