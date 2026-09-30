# Implementation Plan: LINEPOOL To C platform

## Overview

Build the approved Vue 3 + TypeScript To C web application, NestJS REST API and PostgreSQL data layer as an isolated workspace under `platform/`. Deliver thin vertical slices and keep the root Three.js prototype untouched.

## Architecture decisions

- Contract-first npm workspaces: `contracts` → `api` and `web`.
- SQL migrations and parameterized `pg` queries keep PostgreSQL behavior explicit.
- Opaque server sessions and transactional idempotent purchases own all sensitive state.
- Vue DOM UI is primary; Three.js/GSAP are optional progressive enhancement.

## Dependency graph

```text
workspace + contracts
  ├─ database migration + seed
  │    ├─ auth API + login UI
  │    ├─ projects API + catalogue UI
  │    └─ order transaction API
  │          ├─ order/number/points APIs + pages
  │          └─ inbox API + page
  └─ shared layout, error/loading states and browser acceptance
```

## Phases

### Phase 1: Foundation

- Create the workspace, shared contracts, environment validation and repeatable PostgreSQL migration/seed.
- Add NestJS shell, health endpoint and consistent error envelope.
- Add Vue shell, routes, Pinia session state and API client.

### Checkpoint: Foundation

- Fresh install, database bootstrap, tests, typecheck and build succeed.

### Phase 2: Vertical business slices

- Login and current-user session.
- Project catalogue and project detail.
- Transactional idempotent order creation.
- Orders, numbers and points views.
- Inbox list and mark-read flow.

### Checkpoint: Core flow

- API integration test proves login → browse → purchase → linked state.
- Browser flow proves the same behavior through the Vue UI.

### Phase 3: Product quality

- Responsive navigation and all page states.
- Lazy Three.js dashboard decoration and reduced-motion-aware GSAP transitions.
- README, API contract notes, dependency audit and final browser checks.

### Checkpoint: Complete

- Acceptance criteria in `docs/spec.md` pass and outstanding limitations are explicit.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Root prototype has uncommitted work | High | Touch only `platform/`; stage commits by path |
| Local port 5432 is already used | Medium | Compose maps PostgreSQL to 55432 |
| Docker Desktop is not running | Medium | Document startup and report verification boundary if daemon cannot be started |
| Double submit or concurrent stock allocation | High | Unique idempotency key, row locks, one transaction, integration tests |
| 3D bundle harms initial load | Medium | Lazy-load after dashboard content; UI works without it |
| Demo credentials mistaken for production | Medium | Environment-provided seed, explicit demo labeling, no real endpoints |

## Open questions

None blocking. Company integration and production deployment are explicitly out of scope.

