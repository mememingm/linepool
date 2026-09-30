# LINEPOOL To C implementation tasks

## Foundation

- [x] Task 1: Create npm workspace and shared API contracts
  - Acceptance: strict TypeScript contracts build; response/error/pagination schemas are tested.
  - Verify: `npm run build -w @linepool/contracts`; `npm test -w @linepool/contracts`.
  - Files: root workspace config, `packages/contracts/*`.

- [ ] Task 2: Add PostgreSQL migration and idempotent seed
  - Acceptance: repeated migrate/seed runs create no duplicate users, projects, plans or inventory.
  - Verify: run migrate and seed twice; query counts in an integration test.
  - Files: `db/migrations/*`, API database scripts, Compose and env example.

- [ ] Task 3: Add API and web application shells
  - Acceptance: health endpoint and Vue routed shell run; error envelopes and API client are typed.
  - Verify: API/web tests, typecheck and build.
  - Files: app bootstrap and focused configuration files.

## Vertical slices

- [ ] Task 4: Login session slice
  - Acceptance: login sets HttpOnly cookie; `/auth/me` works; logout revokes it; invalid login is rate limited and generic.
  - Verify: authentication integration tests and browser login.

- [ ] Task 5: Project browsing slice
  - Acceptance: paginated catalogue and detail are API-backed; home can reach a detail page.
  - Verify: API tests plus component/browser navigation.

- [ ] Task 6: Transactional ordering slice
  - Acceptance: one purchase creates an order, assigns inventory and debits points; replay returns the same result; failure rolls back.
  - Verify: real PostgreSQL integration tests for success, idempotency, insufficient points and stock.

- [ ] Task 7: Orders, numbers and points slice
  - Acceptance: protected paginated pages reflect the purchase and persist after refresh.
  - Verify: API ownership tests and browser refresh check.

- [ ] Task 8: Inbox and account slice
  - Acceptance: owned messages list and mark read; account returns only public fields.
  - Verify: API and component tests plus browser mark-read check.

## Product quality

- [ ] Task 9: Responsive and accessible page states
  - Acceptance: 320/768/1024/1440 layouts have no blocking overflow; keyboard access and loading/empty/error states are present.
  - Verify: component tests and real-browser inspection.

- [ ] Task 10: Add bounded visual enhancements
  - Acceptance: Three.js is lazy and decorative; GSAP honors reduced motion; core flow works with WebGL unavailable.
  - Verify: production bundle inspection and browser fallback test.

- [ ] Task 11: Final documentation and verification
  - Acceptance: README quick start is reproducible; no secrets or real endpoints; test/typecheck/build/audit results are recorded.
  - Verify: clean bootstrap, full automated suite and complete browser flow.

