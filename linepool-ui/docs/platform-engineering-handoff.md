# Platform engineering handoff

## Authority and scope

DarkBear authorized Phase 1 only. Existing work was preserved; no root manifest/lock, application pages, Vue reference, vendor/public, upstream locks, PostgreSQL 5432, private `.env` or `.local` files were read or changed. No install, commit, test execution, database command, registration/order/read/preference browser mutation or business database write was performed in this phase. Earlier workspace browser acceptance predates this assignment and is not evidence for these new test sources.

## Implementation

- `packages/contracts/package.json`, `tsconfig.json`, `src/index.ts`: independent `@linepool/contracts@0.1.0`, ESM/NodeNext with JS, declarations, maps and package exports. Existing Zod schemas/types were transferred unchanged, including DEMO literals, strict inputs, quantities, UUID keys, pagination, UTF-8 password limits and `zh-CN` account preferences. It depends on `zod`, not frontend or backend code.
- `src/linepool/api/contracts.ts`: compatibility re-export. Existing frontend imports remain valid after the workspace package is installed and built.
- `backend/src/authentication.ts`, `controllers.ts`, `ordering.ts`, `workspace.ts`: imports now resolve the shared package, not frontend source. No auth, ownership, order, ledger or API endpoint behavior was rewritten.
- `backend/tsconfig.json`: production includes `src`, `scripts`, `db`, not tests or frontend. Existing `rootDir: ..` is retained, so `dist/backend/src/main.js` and `dist/backend/scripts/*.js` remain the start/dev/database script paths.
- `backend/db/migrate.ts`, `demo-seed.ts`: reusable transaction-owning migration/seed functions. Existing `001_initial.sql`, checksums, advisory locks, stable fixture identifiers and non-reset seed semantics are retained. `backend/scripts/migrate.ts` and `seed.ts` call them without changing database selection. Seed logs do not emit credentials or account email.
- `backend/src/test-database.ts`, `environment.ts`, `database.ts`, `scripts/test-database.ts`: isolated test target validation and explicit initialization capability, described below. Development/production environment behavior remains unchanged; `NODE_ENV=test` selects validated `TEST_DATABASE_URL`, never a fallback business connection.
- `backend/tsconfig.test.json`: separately compiles backend regression sources to `dist-test`; they cannot enter production `dist`.
- `packages/contracts/test/contracts.test.mjs`: contract regressions using Node's native test runner.
- `tests/api/client.test.ts`, `vitest.config.ts`, `tsconfig.json`, `README.md`: dedicated mock-fetch client regressions and compile-only configuration. No browser/server/database is launched.
- `backend/test/test-database.test.ts`, `http.test.ts`, `business.test.ts`, `bootstrap.test.ts`, `isolated-database.ts`: safety, HTTP guard/envelope units, real isolated-database service regressions and migration/seed idempotence. These are source-only delivery, not passing suites.

## Root integration requirements

DarkBear owns root configuration and installation. Agreed workspace entries: `packages/contracts`, `backend`. Add root dependency `@linepool/contracts: 0.1.0` and development dependencies `vitest: ^4.0.0`, plus `concurrently` if used for fullstack development. Backend already declares `@linepool/contracts: 0.1.0`; the contracts package declares `zod: ^4.6.5` and `typescript: ~5.9.3`. Use a single root workspace installation/lock. Do not use the old standalone `api:install` without adapting it to workspace installation; do not fetch an unrelated registry package named `@linepool/contracts`.

Keep existing library `build`, exports, peer dependencies and integrity checks intact. Add `build:all`, `typecheck:all`, `dev:all` separately. A clean installation still needs contracts built before frontend/backend consumers, because its package exports intentionally target `dist` rather than TypeScript source.

Suggested root scripts, all run with cwd `D:/llinepool/linepool-ui`:

```json
{
  "contracts:build": "npm run build --workspace @linepool/contracts",
  "contracts:typecheck": "npm run typecheck --workspace @linepool/contracts",
  "contracts:test": "npm run test --workspace @linepool/contracts",
  "client:typecheck": "tsc -p tests/api/tsconfig.json --noEmit",
  "client:test": "vitest run --config tests/api/vitest.config.ts",
  "api:test:typecheck": "npm run test:typecheck --workspace @linepool/react-backend",
  "api:test": "npm run test --workspace @linepool/react-backend"
}
```

Build/typecheck consumers only after `contracts:build`. Future authorized aggregate test command also builds contracts first, then runs contract/client/backend suites. `client:test` uses the exact dedicated config, not the Vite app/catalog config; it has Node environment, only `tests/api/client.test.ts`, no file parallelism, and restored mock globals/environments. Backend test compilation only emits `dist-test`; no production compilation of test files. `dev:all` builds contracts first and runs existing Vite and backend dev scripts; no startup migration or seed. For changes to contracts during dev, rebuild contracts explicitly or add a separate contracts watcher.

Root-owned ignore additions: `packages/contracts/dist/`, `backend/dist-test/`. Production backend `dist` was already ignored. Existing root/backend locks were not edited; normal workspace linking and full integration checks remain DarkBear's work.

## New Package Scripts

| Package | Script | Effect |
| --- | --- | --- |
| contracts | `build` | TypeScript NodeNext JS/declarations to `dist` |
| contracts | `typecheck` | Compile only, no emit |
| contracts | `test` | Build contracts then native Node test suite; NOT run |
| backend | `test:typecheck` | Compile backend/tests without emitting or executing |
| backend | `test:build` | Emit separate `dist-test`, no execution |
| backend | `test` | Compile tests then `node --test --test-concurrency=1 dist-test/backend/test/*.test.js`; NOT run |
| backend | `db:test:setup` | Run built explicit isolated initialization script with `--initialize`; NOT run |

All existing backend start/dev/build/database script names remain available. `backend build` is still required before any built database script; contracts must be built before it.

## Isolated Test Database Capability

No test database was created, connected to, migrated, seeded or reset in this phase. The following describes future capability only and is NOT authorization to run it.

`TEST_DATABASE_URL` is required and has no fallback to `DATABASE_URL`. Validation happens before opening any connection: PostgreSQL protocol, local loopback host, explicit non-5432 port, explicit credentials, no URL options/fragments, and a lowercase database identifier ending in `_test`. Same endpoint/database as `DATABASE_URL` is rejected even with different users, encoded database names or localhost aliases; ambiguous business URL options are rejected. Production execution is rejected. No credentials or URLs are logged.

Explicit initialization additionally requires `TEST_DATABASE_ADMIN_URL`, pointing to the `postgres` maintenance database on the same local non-5432 server, and `TEST_DATABASE_CONFIRM` equal to the exact target database name. The script requires `--initialize`; its package script supplies that flag, but environment confirmation is still mandatory. It checks server identity, creates the `_test` database only when absent, checks target identity, applies migrations and creates synthetic test fixtures idempotently. It never drops, truncates or resets a database. The existing private 5433 server must already be running; the script does not start/stop/reconfigure either PostgreSQL service. Values must be supplied securely by an authorized operator, not read from or copied out of the business `.env`/`.local`.

Backend database tests require that independently provisioned `_test` database and schema-creation permission. The helper validates the URL and server identity, creates a unique `lp_test_<32 hex>` schema, migrates/seeds only that schema and configures all test pool connections with that search path. Cleanup drops only the schema it created; it never cleans another schema or drops the database. A missing/invalid URL fails closed rather than silently skipping or falling back. Tests use synthetic fixture credentials and no business account. Abrupt termination can leave a generated test schema; cleanup is not an unbounded reset command.

## Regression Sources, Not Executed

- Contracts: email normalization, strict input properties, password byte limits, registration display name, query coercion/defaults/filter enums, order quantity/UUID/key validation, response envelopes and unchanged DEMO/account preference semantics.
- Client: normalized auth requests, cookie credentials, no-cache fetch, validation before transport, invalid success JSON/contracts, structured 401/404/409/429/500/503 errors, HTTP fallback, encoded query filters, lost-response same-key retry without implicit mutation retries, logout/read/preferences payloads, network errors, timeouts and caller cancellation.
- Backend: database/admin/schema guards; request validation, write-origin protection and error envelopes; register/login conflict/failure, password/session hashing, cookie policy, guards, expiry and logout; owned orders/numbers/SMS/points/preferences and atomic mixed-owner read rejection; same-key concurrent retry, changed-payload conflict, per-user key scope; insufficient balance/partial stock, unavailable offer and late ledger-error rollback; migration re-run/checksum rejection; seed re-run preserving existing account, ledger, orders, sessions, flags and preferences.

Backend business tests invoke real services against the isolated schema, not a live HTTP server. Full HTTP middleware/throttling and browser/home-login integration remain separate acceptance work. Browser writes and these suites are still forbidden under the current instruction.

## Actual Verification

Commands below were run from `D:/llinepool`, without installing dependencies or touching any database:

| Command | Result |
| --- | --- |
| `npm --prefix linepool-ui/packages/contracts run build` | Passed; NodeNext output/declarations generated |
| `npm --prefix linepool-ui/packages/contracts run typecheck` | Passed |
| `node --check linepool-ui/packages/contracts/test/contracts.test.mjs` | Syntax passed, NOT test execution |
| `npm --prefix linepool-ui/backend run typecheck` | Blocked: TS2307, workspace contracts not linked |
| `npm --prefix linepool-ui/backend run test:typecheck` | Blocked: same missing workspace, cascading type inference errors |
| `node linepool-ui/node_modules/typescript/bin/tsc -p linepool-ui/tests/api/tsconfig.json --noEmit` | Blocked: missing Vitest and contracts workspace, cascading errors |
| `node linepool-ui/backend/node_modules/typescript/bin/tsc -p linepool-ui/backend/tsconfig.preintegration.json --noEmit` | Passed with temporary mapping of contracts to its built declarations; not package-link/runtime integration evidence |
| `npm --prefix linepool-ui run verify:upstream` | Passed: 117 files unchanged |
| `npm --prefix linepool-ui run verify:catalog-upstream` | Passed: 13 files unchanged |
| `git diff --check` | Passed; repo project content is largely untracked, so this alone is not a full source diff review |

The temporary preintegration config is removed before release. Backend source and tests were compiled without execution using it. No full API/front-end runtime build was claimed before workspace installation. DarkBear must install once after release, rebuild contracts, and rerun normal backend/frontend/client/test source typechecks and builds. Tests and bootstrap remain unexecuted unless the user explicitly changes the instruction.
