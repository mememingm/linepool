# API Client Regression Sources

Run commands from `D:/llinepool/linepool-ui`, only after explicit authorization to execute tests. The current task prohibits suite execution.

Prerequisites: root workspace install by the integration owner, `@linepool/contracts` built, Vitest 4 installed. Compile-only check: `tsc -p tests/api/tsconfig.json --noEmit`. Dedicated suite configuration: `vitest run --config tests/api/vitest.config.ts`.

All fetch calls are mocked; the suite does not use the Vite application config, open a browser, contact the API, or write any database. The tests cover the existing client contract and transport behavior, not a browser login-to-order acceptance flow. The backend suites separately require an explicitly validated isolated `_test` database and must not use business credentials.
