# ONCE V2 / Shared-Pool SMS Verification

An independently runnable, SQLite-backed implementation of platform-specific, one-time verification orders. The customer buys a service, not a phone number. A resource can serve different platforms sequentially when its explicitly configured capabilities and cooldown allow it. **One number can have only one active assignment at a time, across all platforms.**

This is a **local test environment**, not a live verification business. Numbers, capabilities, prices, SMS events, balances, revenue, and costs are explicitly test data. It never contacts PingCode, a payment gateway, or a real SMS provider. LINEPOOL and the eSIM site are not changed.

## Run Locally

Requires Node.js 24 (tested on 24.21.0) and npm. From `oneoff-sms`:

```sh
npm install
npm run dev
```

- Customer UI: `http://127.0.0.1:5188/#/market`.
- Operations UI: `http://127.0.0.1:5188/#/admin`.
- API: `http://127.0.0.1:3028`; binds only to IPv4 loopback.
- Use `127.0.0.1`, not a LAN address or the `localhost` alias. Host and Origin allowlists intentionally reject other addresses.

```sh
npm run dev:api  # API watch mode
npm run dev:web  # Vite, strict loopback port 5188
npm test        # isolated memory/temporary SQLite and ephemeral HTTP servers
npm run build   # TypeScript check and production frontend build
npm start       # API plus built dist/ frontend at port 3028
```

React 19, TypeScript, Vite 7, lucide-react, Radix Dialog/Popover, cmdk, and GSAP are reused. There is no second application or replacement framework.

## Customer Workflow

1. Select a platform card, such as TikTok, WeChat, or RedNote.
2. Search/select a country. Countries without eligible local resources cannot be selected.
3. Review the country-specific price, duration, cancellation/refund policy, and explicit test-mode notice.
4. Confirm one order. The server verifies the current price and eligibility, reserves test credits, and atomically assigns a number.
5. Copy the number and wait in the order drawer. The server owns expiry and SMS matching; SSE invalidations update the result without manual refresh.
6. Copy a matched code, or cancel if the captured order rules allow it. History, wallet entries, and state transitions remain recoverable after refresh.

The default page is the platform market. Navigation retains the existing shell with verification orders, history, wallet, help, account information, and separately protected operations. No customer number picker, project editor, or matching-rule form is introduced. There was no sending-SMS workflow in ONCE; this release does not invent one or alter LINEPOOL's existing sending workflow.

All controls reuse the shared Radix/cmdk dropdowns and dialogs. Modal actions remain fixed while one content region scrolls. Portals, keyboard navigation, ESC, collision handling, focus restoration, stacked cancellation, and background-scroll locks are retained. GSAP is scoped/cleaned up and respects reduced motion. Desktop tables become customer task cards on narrow screens; dense administrator tables scroll inside their own section rather than overflowing the page.

## Local Data and Migration

The database is `data/once.sqlite`, resolved relative to the server source, independent of the working directory. `data/`, secrets, backups, WAL sidecars, `node_modules/`, `dist/`, and browser artifacts are ignored by this project's Git rules. No business state is stored in localStorage.

Migration version 2 is transactional and retains old tasks, orders, messages, and allocation history. Compatibility fields remain for historical V1 rows; authoritative V2 fields are `order_state`, `billing_state`, and `settlement_state`. Existing databases are not reset or refilled with demonstration orders.

Before V2 migration, a consistent SQLite backup was created at `data/backups/pre-v2-1792052983517.sqlite`. `server/backup.mjs` can create another timestamped `VACUUM INTO` backup. This backup covers SQLite data, not a production deployment rollback.

| Existing/adapted table | Responsibility |
| --- | --- |
| `resources` | Phone, country, provider source, online state, cost, global cooldown |
| `services`, `products` | Platforms and versioned platform-country price, duration, and rules |
| `number_services` | Explicit per-number/platform capability, restriction, use state, and cooldown |
| `tasks`, `orders`, `order_events` | Customer ownership, rule/price snapshots, order state, transition history |
| `assignments`, `usage_history` | Exclusive allocation intervals and immutable usage history |
| `incoming_sms`, `messages` | Deduplicated inbound records, quarantine, and confirmed assignment-bound messages |
| `wallets`, `wallet_transactions` | Available/held test credits and idempotent credit/hold/capture/refund ledger |
| `admin_sessions`, `audit_log` | Separate local administrator access and attributable operations |
| `viewers`, `sessions`, `feedback` | Persistent local browser workspace, theme, and local feedback |

A new browser gets an empty order list and a single, recorded **$50 test-credit grant**, not simulated real payment. Historical V1 fixtures, if any, remain explicitly labeled legacy/demo. Clearing the customer cookie creates another workspace, not an account recovery flow.

The default catalog now contains 52 platforms and 156 country product configurations: 50 supplied logo entries plus the retained WeChat and RedNote services. `shared/platforms.json` is the shared identity/description/logo mapping. Database startup adds missing catalog entries without overwriting existing prices, policies, or enablement; newly added entries use illustrative $1.20 / 20-minute test configuration only. The finite fixture pool still contains 100 reserved fictional `+120255501xx` numbers, explicitly assigned to the US. GB/CA configuration does not invent matching inventory. Capability sets differ by resource; catalog import never grants number capabilities, so newly added platforms have zero inventory until a separate capability is explicitly configured. None of these fixture capabilities establish real compatibility with the named platforms.

The 50 supplied SVGs are copied from `D:/llinepool/output/platform-logos/logos/` into `public/services/`, preserving their original colors. Their source and license references remain in `D:/llinepool/output/platform-logos/manifest.json`; brand trademarks remain with their owners. Existing WeChat and RedNote icons are retained.

## Allocation, Reuse, and Settlement

Creation retains the existing `{productId, expectedPriceCents, idempotencyKey}` contract. The server uses `BEGIN IMMEDIATE` to check current product/service availability, expected price, available test balance, country, provider, online state, explicit platform capability, cooldowns, and active assignments. The partial unique index `exclusive_active_resource` prevents duplicate active assignments even across independent SQLite connections/workers.

An identical request-key retry returns the original order; another payload with that key is rejected. Frontend loading guards prevent double submission but are not the concurrency or financial protection.

V2 states are `PAYMENT_PENDING`, `ALLOCATING`, `WAITING_SMS`, `COMPLETED`, `EXPIRED`, `CANCELLED`, `ALLOCATION_FAILED`, `SMS_FAILED`, and `REVIEW_REQUIRED`. Payment/authorization and allocation happen synchronously in local test mode, so intermediate transitions are saved in history rather than artificially delayed for display.

Test wallet entries use integer cents:

- `TEST_CREDIT`: explicit local test grant, never a gateway payment confirmation.
- `HOLD`: moves the order amount from available to held credits.
- `CAPTURE`: consumes that hold once after a matched SMS, without deducting available credits twice.
- `REFUND`: releases a hold once under the order's captured policy.

Terminal orders close their assignment, retain usage history, and apply global/platform cooldowns. Successful platform use becomes `USED` and cannot be reset to fresh inventory, including by administrator capability edits. Other explicitly supported platforms can use the resource after cooldown. Failure/cancellation/expiry reuse and refund behavior follow the captured test policy, not later product edits. Non-automatic settlements remain `REVIEW_REQUIRED` until an administrator records an action and reason.

Default test policies use a 60-second cooldown and refund test holds on failure, cancellation, and expiry; these are configurable **test rules**, not approved live commercial terms. The live business must confirm refund, reuse, cooling, retention, and success criteria before trading.

## SMS Matching and Provider Boundary

`server/providers.mjs` isolates `MockSmsProvider` from the unavailable `PingCodeProvider`. The mock adapter never sends network requests. Tests and an explicit administrator action may submit labeled test SMS; new orders do not automatically fabricate incoming codes.

A normalized inbound event must carry `provider`, `eventId`, `messageId`, `resourceId`, `serviceId`, `assignmentId`, `occurredAt`, and `text`. Matching requires the exact allocation, number resource, service, active order, and a timestamp inside its window and not in the future. Only an unambiguous 4-8 digit mock code is accepted. Wrong-service, missing/old allocation, expired, late, future, or ambiguous events are stored in quarantine and never shown to customers.

Both event IDs and message IDs are unique per provider. Exact repeats do not add messages, settle again, or increment revenue. Conflicting repeats are rejected. Historical message access is assignment-bound, not a query of all SMS for a currently reused phone number.

The mock HTTP webhook requires `x-once-timestamp` and a hex HMAC-SHA256 `x-once-signature` over `timestamp + '.' + rawBody`, with a five-minute timestamp window. This is **our local test contract**, not a claim about PingCode's signature scheme. The live PingCode webhook returns `503 PINGCODE_NOT_CONFIGURED`; choosing a non-mock provider at server startup fails closed.

### Required From PingCode Before Live Integration

- Actual authenticated base URL, credentials/scopes, number identifiers, country/status/source fields, and inventory or managed-number query contracts.
- Explicit number/platform compatibility, reuse restrictions, historical binding limits, and source ownership: do not use numbers promised exclusively to LINEPOOL customers.
- Allocation/lease correlation guarantees, or an agreed ONCE-owned allocator; do not assume an upstream reserve/release/recycle API exists.
- SMS event/message identifiers, trusted occurrence timestamps, recipient and sender/service evidence, and correlation to the actual lease/order interval.
- Callback authentication/signature verification, replay/retry behavior, and a polling/reconciliation API for missed events.
- Online/offline behavior, failure semantics, rate limits, retention rules, operational costs, and supported commercial terms.

A real payment gateway, verified payment notifications, production wallet settlement/refunds, and final business rules are also still required. Shared accounts, shared balances, and production permissions are not assumed.

## Administrator Operations

`#/admin` requires a separate administrator credential. A customer session cannot authorize it. Local credentials are generated in ignored `data/local-secrets.json` (`adminToken` and `webhookSecret`); do not publish this file or put its values in the frontend. `ONCE_ADMIN_TOKEN` and `ONCE_MOCK_WEBHOOK_SECRET` can override them. Administrator cookies last one hour and logout removes the session.

Operations include revenue/success rankings, per-number cost/revenue/reuse history, resource online/cost controls, platform creation/disable, country product price/duration/policy edits, explicit capability restrictions/verification reasons, order search/details, labeled test-SMS injection, manual failure, pending-settlement resolution, quarantined event records, and audit history. These statistics are calculated from local orders and ledger-backed settlement, not decorative numbers.

Unknown capability is not inventory. Used platform history cannot be erased; an active resource cannot have its capability reassigned. Artificially marking an order successful is not an administrator shortcut: success must go through the same matching/settlement path.

## API Summary

All mutations require an `application/json` object no larger than 8192 bytes. Errors use `{error:{code,message}}`. IDs are opaque strings, timestamps UTC ISO 8601, and money integer cents. Customer data is scoped by the persistent HttpOnly `once_session` cookie. Foreign order lookup/mutation returns the same 404 as a missing order.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/bootstrap` | Viewer, products, orders/tasks, wallet/ledger, theme, server time, mode/version |
| GET | `/api/tasks/:id` | Owned order details and matched messages |
| POST | `/api/tasks` | Idempotent create, reserve, and exclusive allocation |
| POST | `/api/tasks/:id/cancel` | Idempotent cancellation and policy-based test refund; body `{}` |
| POST | `/api/tasks/:id/feedback` | Persist local feedback; not an online support ticket |
| PATCH | `/api/preferences` | Persist light/dark preference |
| GET | `/api/events` | Authenticated, customer-scoped SSE invalidations |
| POST | `/api/wallet/test-credit` | Explicit test credits using `{amountCents,idempotencyKey}` |
| POST | `/api/admin/login`, `/api/admin/logout` | Separate administrator session |
| GET | `/api/admin/snapshot` | Protected resources, orders, exceptions, settlements, statistics, audit |
| POST | `/api/admin/services` | Create a platform without inventing resource capabilities |
| PATCH | `/api/admin/products/:id`, `/api/admin/services/:id`, `/api/admin/resources/:id` | Validated configuration changes |
| PATCH | `/api/admin/resources/:id/services/:serviceId` | Reasoned capability update with use/occupancy guards |
| POST | `/api/admin/tasks/:id/fail`, `/api/admin/tasks/:id/settle` | Audited failure or pending settlement with reason |
| POST | `/api/admin/mock-sms` | Explicitly labeled local test event through real matching logic |
| POST | `/api/providers/mock/webhook` | Signed local-test webhook, not customer-accessible injection |
| POST | `/api/providers/pingcode/webhook` | Disabled live integration boundary; always 503 |

SSE sends only invalidations, not another customer's message payload. The client refetches the authoritative scoped snapshot, reconnects automatically, and falls back to polling/focus refresh. Offline errors keep the last known order visible with a stale-data warning. Reconnection never creates a new order. SSE delivery is currently single-process; multi-instance broadcasting/reconciliation is a production integration task.

## Verification

On the final source snapshot, `npm test` passes **26 tests** and `npm run build` passes. Coverage includes real worker-thread SQLite contention, sequential cross-platform reuse, same-platform restrictions, cooldown, no-stock/price/balance rollback, captured policies, idempotent charges/refunds, expiry, allocation failure, matched/ambiguous/late/repeated SMS, customer isolation, independent administrator authentication, signed/replayed HTTP callbacks, and SSE disconnect/reconnect. Tests never open or reset the developer's `data/once.sqlite`.

Current browser scripts and screenshots are in ignored `output/playwright/`:

- `v2-workflow-stage1.js`: platform/country/confirmation flow, double-click protection, persisted orders, copied number, reserved balance, explicit test-credit action, protected admin entry.
- `v2-workflow-stage2.js`: independently authenticated operations, explicit mock SMS, observed SSE event, automatic code display/copy, one settlement, statistics/configuration and audit. Requires local administrator authentication first; no credential is embedded in the script.
- `v2-workflow-stage3.js`: **153 passing checks** for disconnect/reconnect, cancellation/refund/focus, six pages at 1440/1920/390/320 widths in both themes, centered 85vh-limited dialogs, scroll locks, portaled dropdown boundaries, ESC/focus restoration, and mobile navigation.

With the development servers running, use `npx --yes --package @playwright/cli playwright-cli -s=once-v2 open http://127.0.0.1:5188/`, then `run-code --filename oneoff-sms/output/playwright/v2-workflow-stage1.js` in the same named session. Continue with the other stages after local admin login. Older `verify*.js` / `refine*.js` scripts describe earlier UI/business contracts and are not V2 acceptance suites.

Browser checks create local test orders, explicit test grants/events, and configuration/audit records. They do not trigger external services. Chromium desktop/mobile screenshots were visually inspected. This is not an independent security audit or production end-to-end verification.

## Remaining Production Work

This implementation is intentionally loopback-only. Local workspace cookies are not production customer authentication or account recovery. Administrator access is one local role, not production staff RBAC. Before exposure, implement verified customer accounts, staff identities/permissions, TLS/Secure cookies, rate limiting, secure secret management, retention/deletion policy, encryption requirements, payment reconciliation, provider integration, multi-instance events, monitored jobs, and backup/deployment/rollback validation. Do not expose these test servers or sell this fixture inventory.

Main changed modules: `server/migrate-v2.mjs`, `server/providers.mjs`, `server/secrets.mjs`, `server/service.mjs`, `server/http.mjs`, `server/index.mjs`, backend test suites, and existing `src/App.tsx`, `src/types.ts`, `src/api.ts`, `src/pages.tsx`, `src/dialogs.tsx`, `src/components.tsx`, `src/catalog.ts`, `src/styles.css`, plus `src/admin.tsx`, `src/operations.css`, and local platform assets. Shared dropdown, dialog, and motion systems remain in place.

## ONCE V3 独占租约演示

当前默认客户入口是 ONCE 号码商城：客户选择指定虚构号码和 7/30 天方案，成功后获得同号独占租约。租约权益是资源排他和持续收信，不是收到一次短信就结束；普通文本和验证码都可在租期内保存，续费从当前到期时间追加同一号码的租期，开通和续费均使用本地测试账本并带幂等请求键。

V3 在 `server/migrate-v3.mjs` 增量建立 `lease_plans`、`leases`、`lease_orders`、`lease_events` 和租约入站短信表。仅指定的未使用 Mock 号码进入初始独占池；遗留共享任务和历史短信不会转换成长租。租约资源与共享分配有数据库触发器互斥，过期号码先进入 `REVIEW` 待回收，不自动进入共享池；回收/重新上架必须由管理员记录理由。客户自带资源用途不能转入平台可售池。

管理员在独占租赁页可调整 7/30 天测试方案、查看租约、注入明确标记的 Mock 普通短信或验证码，并处理资源用途和待回收状态。发送短信、真实支付、真实上游续费、用量查询、设备管理、写卡和真实短信均未启用，页面显示为禁用或未知，不伪造成功。客户 Cookie 仍只是本地演示工作区。

数据库启动方式：`ONCE_DB_PATH` 可指向临时 SQLite；已有数据库在首次 V3 迁移前自动用 `VACUUM INTO` 写入 `data/backups/pre-v3-<timestamp>.sqlite`。本地演示默认使用 `data/once.sqlite`，启动不会重置旧任务、余额、流水或短信。

验证：`npm test`（34 项，包含租约服务、HTTP、SQLite 并发、迁移和隔离测试）与 `npm run build` 均通过。浏览器验证脚本草稿位于被忽略的 `output/playwright/lease-v3-check.mjs`；本次收尾以隔离临时库的服务/HTTP测试为准，未宣称生产可用。
