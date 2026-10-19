# Workbench details handoff (Phase 2)

## Scope and status

Owner: LoudKnight. DarkBear explicitly authorized Phase 2 START after Phase 1 release and root integration. Implementation is complete within the approved navigation/page/detail boundaries. No package installation, manifest/lock/entry modification, API/DTO/backend modification, database command, test-suite execution or commit occurred. Existing user changes are preserved. D:/linepool, vendor, public and upstream locks were not edited.

## Files

Modified existing business sources:

- src/linepool/workspace-reference/navigation.ts
- src/linepool/workspace-reference/WorkspacePages.tsx
- src/linepool/workspace-reference/WorkspaceReferenceShell.tsx

Added business sources:

- src/linepool/workspace-reference/WorkspaceDetails.tsx
- src/linepool/workspace-reference/WorkspaceDetails.css
- src/linepool/workspace-reference/detail-data.ts

Added test SOURCES/configuration, not executed:

- tests/workspace-details/navigation.test.ts
- tests/workspace-details/catalog.test.ts
- tests/workspace-details/order-detail.test.ts
- tests/workspace-details/fixtures.ts
- tests/workspace-details/vitest.config.ts
- tests/workspace-details/tsconfig.json

This document: docs/platform-details-handoff.md.

## Addressable URLs

Paths remain under the existing hash namespace. Root website and standalone preview routing are untouched. The existing web service was observed listening at http://127.0.0.1:5178; no new server was launched or stopped.

| Resource | Pattern | Example |
| --- | --- | --- |
| Region | #workspace-reference-shell/regions/:region | http://127.0.0.1:5178/#workspace-reference-shell/regions/us |
| Service | #workspace-reference-shell/services/:service | http://127.0.0.1:5178/#workspace-reference-shell/services/Telegram |
| Offer | #workspace-reference-shell/offers/:region/:service/:plan | http://127.0.0.1:5178/#workspace-reference-shell/offers/us/Telegram/month |
| Order | #workspace-reference-shell/orders/:uuid | Use an actual UUID owned by the current account, not its display orderNumber. |
| Offer preselection | #workspace-reference-shell/purchase?region=:region&service=:service&plan=:plan | http://127.0.0.1:5178/#workspace-reference-shell/purchase?region=us&service=Telegram&plan=week |

Regions/services/offers use the current catalog identifiers and exact tuple, not translated names, display order numbers, or invented platform project/plan UUIDs. `detailHref` encodes each identifier independently; `parseShellRoute` decodes once and rejects malformed encoding, invalid shapes, empty/dot/control segments and invalid order UUIDs. Encoded delimiters stay inside the identifier. Unknown catalog identifiers or absent tuples render a 404 state. The SPA host still returns its normal HTML status; this is a client-side not-found page, not a new HTTP endpoint.

## Compatibility and behavior

- Preserved root #workspace-reference-shell, explicit /dashboard and all original list pages: purchase, numbers, inbox, orders, regions, points, account and settings. Existing region/number query filters and standalone previews remain supported.
- Region cards and purchase selection now link to catalog details. Region/service pages list exact associated offers. Offer detail links back to its parents and forwards to the existing purchase form with region/service/plan preselected.
- Order rows retain their original details/summary expansion and GET loading. A separate independent-detail link is outside summary, so it does not replace expansion. Successful purchase summaries also link to the new UUID detail route.
- Breadcrumbs and return links use deterministic parent/list URLs; they do not assume a browser history entry exists. Direct opening, refreshing and hash back/forward are wired through the existing hash listener. Shell component identity includes all detail identifiers and account identity; document titles, focus on navigation and sidebar active state handle same-kind detail changes.
- Catalog titles update on refresh without stealing focus/resetting scroll. Scoped layouts reuse existing business tables, flags, service logos, Beautiful UI button/status composition and theme variables; no upstream CSS selectors are overridden.
- Catalog details use loaded workspace data. Known empty directories and sold-out offers remain valid pages; absence is distinct from empty inventory. Refresh/error access behavior remains the existing shell behavior.
- Order detail always uses actions.order(UUID), even if no matching item is present in the locally loaded list. States cover loading, owned-resource 404, 401, retryable API/network errors, mismatched response identity and empty assigned numbers. Linked inbox views only navigate; they do not mark messages read.
- The order loader disposes UI publishing on unmount/route/account/refresh/retry changes. The old request may finish at the API layer because the current actions.order interface has no AbortSignal; it cannot overwrite the new detail state. Existing adapter-level session expiry remains authoritative, including 401 responses, and is not suppressed or changed.
- Existing workspace-data 401 handling clears account data and shows inline WorkspaceAccess; the current detail hash is retained for post-authentication restoration. No new login/logout/session behavior was introduced.
- Pending purchase data is still schema-validated under sessionStorage key linepool:purchase:<account UUID>. Pending selection takes precedence over competing deep-link filters, even if catalog/inventory changed. submit, request freezing, idempotency UUID creation, persisted intent and network/timeout/same-key retry logic are unchanged. The initializer now copies only selection fields; the original pending request/key remains untouched and is the submitted payload.

## Verification actually performed

Run serially from D:/llinepool/linepool-ui (actual invocations used npm --prefix with the absolute directory):

```sh
npm run typecheck
npm exec -- tsc -p tests/workspace-details/tsconfig.json --noEmit
npm run build:catalog
```

All passed. `npm run typecheck` automatically runs the existing pretypecheck library build, contracts build, upstream verification and declaration finalization first. The final sources were typechecked again after the focus/CSS refinements, and the final website/catalog build was rerun. Never run frontend build and typecheck concurrently because declarations share dist.

- Library integrity: 117 upstream files unchanged.
- Catalog integrity: 13 upstream files unchanged.
- Library exports/declarations still build; no changes to public package exports.
- git diff --check passed, but the project remains mostly untracked, so this is not complete whitespace/diff evidence for all new files.
- Catalog build emits existing Zod pure-comment warnings and a large-chunk warning (about 984 kB minified entry). Build succeeds. Entry separation/lazy loading belongs to DarkBear's later integration phase.

## Test configuration and parent integration

Focused runner: Vitest ^4, environment node; no jsdom/DOM dependency or new runtime dependency requested. `tests/workspace-details/vitest.config.ts` includes only tests/workspace-details/**/*.test.ts. `tests/workspace-details/tsconfig.json` extends the root config with vite/client types and includes only the test sources and imported parser/detail helpers. Tests are outside production src/catalog includes and are not built into the website or library.

Suggested root scripts for DarkBear to integrate after release:

```json
{
  "details:typecheck": "tsc -p tests/workspace-details/tsconfig.json --noEmit",
  "details:test": "vitest run --config tests/workspace-details/vitest.config.ts"
}
```

Only the typecheck command is permitted under the current instruction. The runner command is documented for later explicit test authorization and was NOT executed. Parent may add details:typecheck to unified typecheck after contracts preparation; no root scripts were edited here.

Source coverage includes legacy hash/query compatibility, strict identifier round trips and malformed paths, UUID validation/casing, component identity/sidebar mapping, exact catalog tuples/missing parents/empty/sold-out states, pending-selection/key preservation over new URL filters, loading/404/401/network-retry handling, mismatched UUID responses and late success/failure isolation after route changes/retries/disposal. These are regression sources, not passing test evidence. Browser/component lifecycle wiring and actual purchase persistence are not validated merely by helper source coverage.

## Phase 3 integration

New detail copy is centralized in detail-data.ts (`detailCopy`), including titles, labels, states, links and units. Catalog names remain API-provided identifiers/labels. Navigation titles and details import that module; LoudTiger can translate this together with the existing pages. ServiceLabel moved from WorkspacePages into WorkspaceDetails and keeps the existing logos/markup. Theme styling uses inherited workbench variables and scoped selectors. No animation or chart sources were changed in this phase.

## Explicitly unverified

- No suites were executed, including pure helper tests. Compiled source does not prove assertion success.
- No browser/API business mutation was performed: registration, order submission/recovery, mark-read, preference mutation and logout are not acceptance evidence in this phase.
- No authenticated desktop/mobile detail visual inspection, keyboard/back-forward/refresh/expired-session restoration or live 404/retry flow was performed. Implementation wiring was source-reviewed only; parent should record any later permitted read-only observations separately.
- Prior user task: purple chart-marker/tooltip 180ms CSS smoothing was implemented in showcase/Reference.css before Phase 2. Its actual browser motion acceptance remains outstanding and those existing chart edits were not touched here.
- No production supplier/payment integration or deployment claim. Production fallback/website entry separation remains parent-owned.
