# ONCE API Contract

Status: development backend with PostgreSQL persistence. Financial and phone-provider operations are DEMO ONLY. No live SMS, payment, balance, quota or network-status integration exists.

## Transport and Authentication

- Base URL: http://127.0.0.1:3000/api for this local environment.
- Serve the frontend and API from the same origin. Cross-origin requests are not enabled.
- Register/login sets `once_session`: HttpOnly, SameSite=Strict, Path=/, seven-day expiry; Secure in production.
- The browser handles the cookie. Never put a session token or provider key in localStorage.
- POST requests require Content-Type: application/json, including logout and demo-message (send {}).
- Browser Origin must exactly match APP_ORIGIN; use 127.0.0.1 consistently, not localhost.
- API responses have Cache-Control: no-store. Body limit: 32 KiB.
- No existing localStorage records are imported automatically.

```js
const response = await fetch('/api/auth/login', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
const result = await response.json();
if (!response.ok) throw new Error([result.message].flat().join('; '));
```

## Routes

| Method | Route | Authentication | Body / Result |
| --- | --- | --- | --- |
| GET | /health | No | {ok:true,database:"postgresql",demo:boolean} |
| POST | /auth/register | No | {email,password} -> {id,email}, sets cookie |
| POST | /auth/login | No | {email,password} -> {id,email}, sets cookie |
| POST | /auth/forgot-password | No | {email} -> generic {ok:true}; in local demo also returns a one-time `resetToken` valid for 60 minutes |
| POST | /auth/reset-password | No | {token,newPassword} -> {ok:true}; consumes the token and invalidates existing sessions |
| POST | /auth/logout | No | {} -> {ok:true}, invalidates current session |
| GET | /auth/me | Yes | {id,email} |
| GET | /inventory | No | Available demonstration numbers |
| GET | /leases | Yes | All leases owned by the account, newest first |
| GET | /leases/:id | Yes | Owned lease with phoneNumber metadata |
| POST | /leases | Yes | {number,term} -> {leaseId,orderId,replayed} |
| POST | /leases/:id/renew | Yes | {term} -> {leaseId,orderId,replayed} |
| GET | /leases/:id/messages | Yes | Latest 200 messages for owned lease |
| POST | /leases/:id/demo-message | Yes | {} -> created demonstration message |
| GET | /orders | Yes | Latest 200 account orders, mapped as bills |
| GET | /leases/:id/messages/history?limit=50&cursor=... | Yes | {items,hasMore,nextCursor} for the owned lease |
| GET | /orders/history?limit=50&cursor=...&leaseId=UUID | Yes | {items,hasMore,nextCursor}; leaseId is optional |
| POST | /demo/orders | Yes, local demo only | {number,term,scenario}; Idempotency-Key required |
| GET | /demo/orders/:id | Yes, local demo only | Owned mock order and execution evidence |
| POST | /demo/orders/:id/process | Yes, local demo only | {} -> claim and simulate first purchase attempt |
| POST | /demo/orders/:id/reconcile | Yes, local demo only | {} -> look up an uncertain mock outcome |
| POST | /demo/events | Yes, local demo only | Persist and process a mock SMS event |
| GET | /demo/events/:id | Yes, local demo only | Owned event processing/failure/conflict record |
| POST | /demo/events/:id/retry | Yes, local demo only | {} -> retry a persisted event |
| GET | /state?leaseId=UUID | Yes | Dashboard snapshot; leaseId is optional |

All IDs are UUID strings. An absent or inaccessible lease returns 404 rather than revealing another account's resources. GET returns 200; successful POST returns 201, including logout and idempotent replays.

Credentials: valid email (maximum 254 characters), password 12-128 characters. Email is normalized to lowercase. Unrecognized DTO fields are rejected. Supported terms: numeric 7 or 30, not strings.

Forgot-password requests intentionally return the same `{ok:true}` response for unknown and known addresses. In the local demo, the response includes `resetToken` because no mail provider is configured; production delivery requires wiring the token into an email provider before exposing this flow to end users.

Inventory items:
```json
{"id":"UUID","number":"+1 213 555 0148","countryCode":"US","countryName":"美国","regionId":"ca","regionName":"加利福尼亚州"}
```
Only unoccupied demo numbers appear. When DEMO_MODE=false, inventory is empty until a real provider is implemented.

## Dashboard Snapshot

```json
{
  "lease": null,
  "leases": [],
  "messageCount": 0,
  "billsCount": 0,
  "messages": [],
  "bills": [],
  "demo": true,
  "truncated": {"messages":false,"bills":false}
}
```

- `lease`: selected owned lease, or newest owned lease when leaseId is omitted; null for an empty account.
- `leases`: every owned lease, including expired historical leases.
- Lease fields: id, number, countryCode, countryName, regionName, term, price, currency, startedAt, expiresAt, demo; additive fields `status` and `holdReason` expose lifecycle/holding reason.
- `messageCount`: total messages for the selected lease, not the returned list length.
- `billsCount`: total orders for the account, across all its leases.
- Messages: id, sender, title, body, code (nullable), receivedAt. Lists are newest first, capped at 200.
- Bills: id, leaseId, kind, number, term, amount, currency, status, createdAt.
- Bill kind is 号码租赁 or 同号续费; confirmed demo status remains 演示已确认. Mock pending/failure rows use `PENDING`, `PROCESSING`, `UNCERTAIN`, `FAILED`, and can have `leaseId:null`. Render number from its order snapshot. No real paid transaction is implied.
- Dates are ISO 8601 strings. API price/amount are display values in USD; database amounts are integer minor units.
- `truncated` flags indicate incomplete snapshot lists. Use the history routes to continue beyond 200. Do not compute all-time totals from capped snapshot lists.
- `demo` is server configuration; each lease also identifies its demonstration provider independently.

## Renting and Renewal

Both mutations require `Idempotency-Key`, 16-128 characters matching [A-Za-z0-9_-]. A UUID is recommended.

```js
const pendingKey = crypto.randomUUID();
await fetch('/api/leases', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pendingKey },
  body: JSON.stringify({ number: selectedNumber, term: 7 })
});
```

Retain the same key for retries of the same intended operation, including a request whose response was lost. A new key represents a new intended operation. Reusing a key with a different route, number, lease or term returns 409. Keys are scoped to the authenticated account.

The server ignores no price fields: it rejects them. It calculates the demo price itself: 7 days = USD 12, 30 days = USD 35. Frontend price is not authoritative.

After success, fetch /state?leaseId=<returned leaseId>. Number allocation, lease, order snapshot, initial demo message and audit entry commit in one database transaction. Concurrent allocation allows exactly one winner. Renewals keep the current lease and phone; they serialize per account and phone, and extend from the current future expiry. An expired/held lease cannot renew. This matches the current implementation and frontend; the former documentation sentence permitting expired-demo renewal was stale.

This demo does NOT charge money, create payment records, confirm supplier availability or release/reclaim a live number. The maintenance pass changes expired `ACTIVE` leases to `EXPIRED_HELD`, records `endedAt=expiresAt` and keeps inventory occupied with `EXPIRY_RELEASE_RULES_UNCONFIRMED`. Neither expiry nor an API restart makes that number available for resale.

## Historical Pagination

`limit` defaults to 50 and accepts integers 1–200. Results retain the existing message/bill item shape. Pass the returned `nextCursor` unchanged until `hasMore:false` and `nextCursor:null`. The cursor encodes a version, account/lease/filter scope, timestamp and UUID. A malformed cursor or cursor from another scope returns 400; a lease owned by someone else returns 404.

Ordering is `(receivedAt DESC,id ASC)` for messages and `(createdAt DESC,id ASC)` for orders. Equal timestamps are resolved by UUID. The continuation uses keyset comparisons and remains valid if the prior row is deleted. New inserts ahead of the cursor appear on a fresh traversal; backdated inserts can appear on subsequent pages. It is not a fixed historical snapshot across HTTP requests.

Legacy `/orders`, `/leases/:id/messages` and `/state` remain capped at 200 with their existing array/snapshot envelopes. Existing frontend consumers continue to work. Their current UI does not yet offer a history loading button; consumers need to call the new routes for older records. `/orders/history?leaseId=...` filters before pagination, avoiding omission of a selected lease's older orders.

## Local Pending Fulfillment

Example body for `POST /demo/orders`:

```json
{"number":"+1 213 555 0148","term":7,"scenario":"UNKNOWN_SUCCESS"}
```

The four scenarios are `SUCCESS`, `FAILURE`, `UNKNOWN_SUCCESS`, `UNKNOWN_FAILURE`. Creation reserves one demo phone and persists a `PENDING` order with immutable commercial/request snapshots, `leaseId:null`, and no fictional lease. `/process` claims work for 30 seconds, commits, simulates the provider outside any transaction, then applies the result in a second transaction guarded by the claim token/deadline.

State transitions: `PENDING -> PROCESSING -> DEMO_CONFIRMED|FAILED|UNCERTAIN`; reconciliation uses `UNCERTAIN -> PROCESSING -> DEMO_CONFIRMED|FAILED`. Success creates exactly one demo lease and starts its service window at confirmed local delivery. Definite failure frees only that demo reservation. Unknown outcomes keep the reservation and require `/reconcile`; calling `/process` again never repeats a purchase. The stable simulated provider request ID is the order ID. A timed-out worker claim becomes `UNCERTAIN`, with no assumed success or failure. A stale token cannot finalize it.

The result includes `orderId`, nullable `leaseId`, `number`, `status`, `term`, `amount`, `currency`, `demo:true`, `requestId`, `scenario`, `attempts`, `claimUntil`, `lastError`, `checkedAt`, `completedAt`, `providerOrderId`, `evidence`. Inspect or reconcile by order ID after a lost response. Reuse the original idempotency key when order creation itself had an uncertain response. Terminal replays produce no new lease or provider attempt. The existing `/leases` fast demo flow remains available for frontend compatibility.

## Local Event Inbox

Example body for `POST /demo/events`:

```json
{"eventId":"local-event-001","leaseId":"UUID","providerMessageId":"local-message-001","sender":"Demo service","title":"Code","body":"Code 123456","code":"123456","receivedAt":"2026-10-19T03:00:00.000Z"}
```

Use a timestamp within the specified owned lease's service interval `[startedAt,min(endedAt,expiresAt))`, and never in the future. A delayed event can arrive after expiry while keeping the original explicit `leaseId`; event time must be inside that historical interval. No current holder lookup or reassignment occurs. `code` is optional.

Events use existing `WebhookEvent` rows and an account-scoped provider namespace `demo-inbox:<userId>`. `(provider,eventId)` plus a normalized payload hash deduplicates exact repeats. A conflicting payload under the same event ID commits conflict counters/hash/audit evidence, preserves the original payload, then returns 409. A distinct event referring to an existing provider message compares content and lease identity; a mismatch is quarantined without changing the message.

Event states are `RECEIVED -> PROCESSED|FAILED|QUARANTINED`. Processing, SMS insert and success audit commit together. A transient rollback persists `FAILED` in a new transaction with attempt count and backoff. A startup/30-second bounded maintenance pass retries due failures, up to 10 total automatic attempts; `nextAttemptAt:null` stops automatic retries. Inspect and manually retry after fixing a transient cause. `PROCESSED`/`QUARANTINED` replay is inert. Quarantine requires investigation; the retry endpoint does not silently overwrite facts or unquarantine events. Legacy events without a known provider contract remain untouched.

All `/demo/orders` and `/demo/events` routes require an authenticated owning account and `DEMO_MODE=true` outside production. These routes accept no real supplier credentials/signatures and provide no real payment, refund, external release or live webhook endpoint. Maintenance scans at most 100 items per category per pass and uses existing rows/audits, without a separate job system.

## Errors

Typical responses use a JSON object containing `message` (string or string array). Clients should use the HTTP status and must not depend on a fixed English error message.

| Status | Meaning |
| --- | --- |
| 400 | Invalid input, unknown fields, malformed JSON, invalid UUID or idempotency key |
| 401 | No valid session, expired session, incorrect credentials |
| 403 | Cross-origin request or demonstration operations disabled |
| 404 | Missing or inaccessible resource; private server files are not served |
| 409 | Number occupied, incompatible idempotency key, unavailable demo operation or duplicate email |
| 413 | Request body over 32 KiB |
| 415 | POST did not use application/json |
| 429 | Too many authentication or demo-message attempts |
| 500 | Unexpected internal failure; details are not exposed |

Current rate limiter is process-local: 20 attempts per 15 minutes for registration by IP, login by IP/email and demo messages by account. It resets after server restart and is not a production distributed limiter. Reverse-proxy IP handling is not configured.

## Frontend Handoff

Integration requirements: account entry, signed-in state and logout; use /state for account data; switch leases explicitly; keep unknown balance/quota/network values unknown; handle 401 without silently falling back to local demo data. Authentication is not an extra third-party service.
