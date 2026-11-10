# ONCE Backend

NestJS 12, TypeScript, Prisma 7 with the PostgreSQL driver adapter. Local development uses a real isolated PostgreSQL cluster; no in-memory or JSON database substitutes.

## Scope

Implemented: registration/login/logout, hashed database sessions, account-owned leases/messages/orders, multi-lease reads, transactional demo renting/renewal, expiry-to-held maintenance, cursor history beyond 200, pending mock fulfillment and lookup, persistent event deduplication/conflicts/recovery, audit evidence, atomic inventory allocation, idempotency, PingCode SMS API/receive webhook integration, SMS conversations, server-side operator account checks/number sync/explicit user assignment, and protected same-origin static serving.

Not implemented: real payments, automatic live-number sale/provisioning/renewal/reassignment, SMS backfill from the upstream list API, password reset/email verification, administrative web UI, wallet/balance/quota/network integrations or MMS/Voice. Resource sale, release/reuse and provider renewal rules remain pending. See [PC-INTEGRATION.md](PC-INTEGRATION.md) for the operator/C-end boundary and live SMS setup.

The React frontend lives in the repository root `src/`. See [API.md](API.md) for the HTTP contract.

## Requirements

- Node.js 22.12+; this workstation is verified with Node.js 24.21.
- PostgreSQL 17/18, or a separately provisioned compatible PostgreSQL service.
- npm and access to registry.npmjs.org. Project .npmrc does not alter global npm configuration.
- Docker is not required. This workstation has a Docker CLI but no usable daemon, so native PostgreSQL was used.

## Quick Start on This Workstation

From D:/once:

```powershell
npm --prefix backend ci
npm --prefix backend run db:local
npm --prefix backend run db:generate
npm --prefix backend run db:migrate
npm --prefix backend run db:status
npm --prefix backend run db:seed
npm --prefix backend run build
npm --prefix backend start
```

Open http://127.0.0.1:3000/api/health. The original static page is at http://127.0.0.1:3000/. Use 127.0.0.1 consistently because the allowed Origin and cookies are host-specific.

The helper discovers PostgreSQL binaries in PG_BIN, D:/postgresql/bin or common PostgreSQL installation directories. It creates an independent cluster under the current user's ~/.once/postgres-dev, listens only on 127.0.0.1:55432 and generates separate random administrator/application credentials. Existing PostgreSQL services, accounts, ports and data directories are not modified.

Generated secrets live outside source control: ~/.once/postgres-dev/credentials.json and backend/.env. Do not share them. The helper does not overwrite an existing .env.

The 30 seed numbers are clearly marked demo fixtures, not provisioned phone numbers. Re-running seed uses a no-op update for existing numbers, preserving their provider, occupancy and holding metadata as well as existing users, sessions and leases.

For an existing installation, run `npm --prefix backend run db:preflight` (read-only) before migrating, and back up the database first.

```powershell
npm --prefix backend run db:stop
```

This stops only the isolated development cluster. Do not stop it while the API is serving requests.

## Using a Different Database

Create a dedicated database and restricted application role. Configure backend/.env using .env.example. The local helper is optional; skip it when using a separately managed database.

Minimum configuration:
```dotenv
DATABASE_URL=postgresql://once:YOUR_PASSWORD@127.0.0.1:55432/once?schema=public
HOST=127.0.0.1
PORT=3000
APP_ORIGIN=http://127.0.0.1:3000
NODE_ENV=development
DEMO_MODE=true
```

Set environment variables through your deployment system in production. DATABASE_URL is consumed by the PostgreSQL driver adapter at runtime and by prisma.config.ts for migrations. Provision TLS and connection settings appropriate to your database vendor. Do not use prisma migrate reset on real data.

Run migrations with a controlled deployment role; applications should not require superuser privileges. Back up the database and test restoration before a live release.

## Development

```powershell
npm --prefix backend run start:dev
npm --prefix backend run build
npm --prefix backend audit
```

start:dev uses ts-node to preserve Nest constructor decorator metadata; it does not auto-reload. Seed uses tsx because it has no Nest dependency injection.

## Production Boundary

DEMO_MODE=true is refused when NODE_ENV=production; HTTPS APP_ORIGIN is required in production. This is a development implementation, not a live communications or payment service.

Before a public launch, select and integrate a permitted provider/payment channel; validate webhook signatures and event idempotency; define the allocation/payment/refund lifecycle; add reliable task execution and expiry rules; implement email verification/password recovery, abuse controls and distributed throttling; configure trusted proxy handling and HTTPS; define SMS retention/access policy and backups; add monitoring and operational recovery. Do not expose the development PostgreSQL port publicly.

The Nest server serves only index.html, styles.css, favicon.svg and assets/. It does not expose .env, backend/, output/ or handoff files. Do not run a Python static server from D:/once after adding backend secrets. If a separate frontend server is needed, proxy /api and preserve same-origin cookie behavior.

## Layout

- src/auth.ts: password verification, cookie sessions and initial throttling.
- src/leases.service.ts: ownership, consistent snapshots, history and transactional demo mutations.
- src/business.ts: shared locks, legacy idempotency rules, normalized hashes and scoped keyset cursors.
- src/fulfillment.service.ts: durable mock reservation, claim, delivery, unknown outcome and lookup.
- src/events.service.ts: persistent local inbox, conflict evidence and safe retry.
- src/maintenance.service.ts: bounded expiry, stale-claim and inbox recovery passes.
- src/api.controller.ts: validated HTTP routes.
- src/main.ts: security middleware, static allowlist and application startup.
- prisma/schema.prisma: database models; migrations/ contains committed migration SQL.
- prisma/demo-inventory.json: seed-only demonstration inventory.
- scripts/local-db.mjs: isolated native PostgreSQL development setup.
- scripts/optimization-preflight.mjs and .sql: read-only historical identity/count report.

## SMS sending

- `POST /api/leases/:id/outbound` accepts `{to, content}` and a 1–120 character `Idempotency-Key`; the sender comes from the authenticated user's active lease.
- `GET /api/leases/:id/outbound` lists paginated history; `GET /api/leases/:id/outbound/:messageId` refreshes a result.
- Ordinary `/sms/send` results are refreshed through `/sms/outbound/{messageId}`. This flow does not require a send webhook secret.
- `POST /api/webhooks/pingcode/send` remains an optional signed JSON **send-project receipt** compatibility endpoint. PingCode's documented project callback and xin GET callback are different contracts; do not configure this endpoint assuming ordinary single-SMS sends trigger it.
- Configure the ONCE operator's `PINGCODE_BASE_URL` (including deployment prefix and `/api/open/v1`), `PINGCODE_ACCOUNT_ID`, and `PINGCODE_API_KEY`. All ONCE C-end users share this server-side connector; they do not need PC accounts or API Keys. Account identity is verified through `/me` before sending/lookup, with a shared 60-second verification cache. Use the same operator account namespace on mapped `PhoneNumber` rows.
- Configure `PINGCODE_RECEIVE_WEBHOOK_SECRET` for incoming SMS. `PINGCODE_SEND_WEBHOOK_SECRET` is optional and only applies to the separate project-receipt compatibility endpoint.
- Demo leases cannot send SMS. Live sending requires a mapped, active PC number with confirmed SMS/resource coverage. Missing configuration disables sending.
- Only `DELIVERED` means delivered. `SENT` means sent; `UNCERTAIN` remains unconfirmed. Unknown submission outcomes reuse the same upstream idempotency key, and are never resubmitted after its 24-hour window.
## SMS conversations and receiving

The React `/app/messages` workspace combines inbound and outbound history per lease and peer, with persistent read state, cursor pagination and authenticated SSE updates. Legacy inbox/send links redirect into this workspace. MMS and Voice retain their existing separate boundaries.

- `GET /api/leases/:id/chat/conversations` lists conversations and unread counts; `GET /api/leases/:id/chat/messages?peer=...` reads the merged timeline; `POST /api/leases/:id/chat/read` with `{ids: [...]}` marks the supplied inbound message IDs read.
- `GET /api/leases/:id/chat/events` streams scoped revision events. The client refreshes query data when revisions change; it does not reload the page.
- `POST /api/webhooks/pingcode/receive` accepts the signed PC `sms.received` event. Configure `PINGCODE_RECEIVE_WEBHOOK_SECRET` separately from the send webhook secret, and map the number's `providerAccountId` and `providerNumberId` to PC. Incoming attribution uses the historical lease interval at the provider's receive time. Event/message identity conflicts are retained, and duplicate webhooks do not create duplicate messages.
- Migration `202610220001_sms_chat` adds nullable `Message.readAt`, ingestion `Message.createdAt` and its lease index without replacing historical records. Historical inbound records start unread.
- Real-device send/reply/delivery verification requires provisioned SMS-capable numbers, live PC credentials and publicly reachable signed webhook URLs. Local integration and browser fixture checks do not certify real carrier delivery.

