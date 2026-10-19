# Preferences and onboarding handoff (Phase 3)

## Authority and status

Owner: LoudTiger. DarkBear explicitly authorized Phase 3 START after Phase 1/2 release, with one implementation writer in D:/llinepool/linepool-ui. Implementation is ready for parent integration and file reservations are released with the handoff message.

No installation, root manifest/lock/entry edit, backend/contract/client request edit, database command, private credential read, business write, test-suite execution or commit was performed. Existing user changes are retained. D:/linepool/platform, vendor/public and upstream locks remain read-only.

## Files

Added business modules:

- src/linepool/preferences/store.ts
- src/linepool/preferences/useDisplayPreferences.ts
- src/linepool/preferences/DisplayControls.tsx
- src/linepool/preferences/DisplayControls.css
- src/linepool/i18n/format.ts
- src/linepool/i18n/messages.ts
- src/linepool/onboarding/preference.ts
- src/linepool/onboarding/WorkspaceGuide.tsx
- src/linepool/onboarding/WorkspaceGuide.css

Modified display integration:

- src/linepool/welcome/WelcomeShared.tsx
- src/linepool/welcome/WelcomeLogin.tsx
- src/linepool/welcome/WelcomePage.tsx
- src/linepool/workspace-reference/WorkspaceReferenceShell.tsx
- src/linepool/workspace-reference/WorkspaceReferenceShell.css
- src/linepool/workspace-reference/WorkspacePages.tsx
- src/linepool/workspace-reference/WorkspacePages.css
- src/linepool/workspace-reference/WorkspaceDetails.tsx
- src/linepool/workspace-reference/detail-data.ts (catalogDetailTitle presentation only)
- src/linepool/workspace-reference/reference-data.ts (display dates/times only)
- src/linepool/workspace-reference/workspace-data.ts (apiMessage presentation only)
- src/linepool/showcase/Reference.tsx
- src/linepool/showcase/Reference.css
- src/linepool/business.tsx (CopyValue optional labels only; defaults remain compatible)

Existing welcome.css, WorkspaceDetails.css, navigation.ts and API client/contracts were reused without edits in this phase. The existing welcome English dictionary is reused; additional workbench/error/template copy lives in i18n/messages.ts.

Added test SOURCES/configuration, not executed:

- tests/preferences/store.test.ts
- tests/preferences/format.test.ts
- tests/preferences/guide.test.ts
- tests/preferences/vitest.config.ts
- tests/preferences/tsconfig.json

This document: docs/platform-preferences-handoff.md.

## Preference contracts

Language uses a single useSyncExternalStore-backed zh-CN/en-US preference across the public homepage, login/access and workbench/details. The existing useWelcomePreferences export remains a compatible alias. Canonical storage key: linepool:language. Legacy linepool-welcome-language is read when no canonical key exists, then removed on the next local selection. Same-tab subscribers and cross-tab localStorage events update the display; unavailable/denied storage falls back to an in-memory preference.

Locale is a display preference only. API catalog identifiers, UUIDs, route segments and form payloads stay untranslated. User names, email addresses, phone numbers, verification codes and SMS bodies are not translated or persisted by the preference system. Known catalog labels and API errors are localized; unknown external copy is preserved rather than guessed. Dates/times/numbers use Intl; explicit timezone options are accepted, while the normal workbench display retains browser-local time.

Theme uses the existing next-themes provider via useTheme/setTheme/resolvedTheme. There is no second theme provider/store and no root provider or storage-key change. Welcome controls and workbench toolbar share the resolved light/dark theme; settings also expose system mode. Business roots carry data-theme, with dark overrides restricted to owned lp-shell/lp-reference classes. Details inherit workbench tokens. No vendor component CSS selectors are overridden.

CopyValue accepts optional busy/done/success/error labels for business pages. Its click/clipboard behavior and default Chinese labels remain intact for existing library consumers and standalone examples.

## Guide lifecycle and accessibility

Guide is mounted only inside the successfully authenticated workspace; first-run opening additionally waits for a completed data load without an error. It is not mounted in the access/login view. Toolbar and display settings provide reopen actions.

Persisted key linepool:guide contains only { version, status }, with current version 1 and status completed/dismissed. Close, Escape, skip and guide-link navigation dismiss; finishing persists completion. Old completed versions migrate without repeating first-run guidance, completed state cannot be downgraded by later dismissal, and newer stored versions are not downgraded. An outdated dismissed guide may be offered after a version update. No account identifier is persisted with it.

Native dialog.showModal supplies modal isolation and browser Tab/Shift+Tab containment. Opening focuses the heading, changing steps refocuses it, and closing restores the connected trigger when it is not inert. Escape and the close button dismiss. Route changes dismiss; logout/session expiry unmounts and closes the dialog, discards its focus reference, and resets the reopen request. Manual reopening begins at step one.

Opening is deferred while the mobile navigation drawer or another visible dialog/aria-modal is open. A DOM observer handles modal insertion/removal and attribute changes; an already-open guide closes if loading/error/drawer/another-modal makes it ineligible. It does not nest over the existing SMS dialog. Mobile dimensions constrain width/height and permit internal scrolling; entry motion runs only for prefers-reduced-motion: no-preference.

Guide links only navigate to purchase, numbers, inbox and orders. They never submit an order, register, mark a message read, change backend preferences or invoke a business write API.

## Existing behavior retained

All Phase 2 hash URLs, detail identifiers, breadcrumbs and GET detail loading are preserved. catalogDetailTitle gained an optional locale with a Chinese-compatible default; route parsing, purchaseSelection and loadOrderDetail behavior are unchanged. Existing Cookie authentication, protected-data/session clearing, pending sessionStorage purchase intent and same-key recovery remain unchanged. This phase adds only locale/theme/guide preference persistence, not private-data persistence.

The dashboard still uses the same chart geometry, smooth curves, point-selection handlers, range/month filtering and existing 180ms marker/tooltip transitions. Reference changes are labels, formatting, translated search terms and workbench-scoped theme rules. Standalone preview routes and their existing light appearance remain available; workbench dark styling requires a shell ancestor.

## Verification actually performed

Commands were run serially from D:/llinepool/linepool-ui:

```sh
npm run typecheck
npm exec -- tsc -p tests/preferences/tsconfig.json --noEmit
npm run build:catalog
```

All passed. typecheck automatically invokes the existing pretypecheck library build, contracts compilation, upstream verification and declaration finalization. The final catalog build was repeated after source/CSS refinements. No parallel builds/typechecks shared dist.

- Library integrity: 117 upstream files unchanged.
- Catalog integrity: 13 upstream files unchanged.
- Read-only TypeScript-AST copy audit found no missing English dictionary entry among literal display translation calls in the owned components or the detailCopy strings. This is static source coverage, not visual acceptance.
- git diff --check passed; much of the workspace is untracked, so that check is not complete diff evidence for new files.
- HTTP HEAD on http://127.0.0.1:5178/ returned 200. The existing server was not started/stopped or replaced. This proves reachability only, not rendering or interaction.
- Catalog emits the existing Zod pure-comment warnings and a large-chunk warning (entry approximately 1,005 kB minified). It builds successfully; entry separation/lazy loading remains parent-owned.

## Test source integration

Vitest ^4 is already installed. The focused configuration uses environment node and includes only tests/preferences/**/*.test.ts. No jsdom/testing-library/runtime dependency is requested. Tests sit outside the production source includes and do not enter the library or catalog build.

18 regression cases cover canonical/legacy key priority and cleanup, same-tab subscription/unsubscription, cross-tab/remove/clear handling, denied/absent storage, literal interpolation, detail-copy key/label compatibility, dictionary template placeholders, known API error formatting, Intl and invalid date/number fallbacks, guide parse/version/completion/privacy behavior and opening eligibility.

Suggested root scripts for DarkBear to integrate after release:

```json
{
  "preferences:typecheck": "tsc -p tests/preferences/tsconfig.json --noEmit",
  "preferences:test": "vitest run --config tests/preferences/vitest.config.ts"
}
```

Only the compile command is currently permitted. The runner command is documentation for a later explicit test authorization and was NOT executed. Add preferences:typecheck to the parent's aggregate compile flow after contracts preparation. No root scripts were edited here.

## Explicitly unverified

- No suite was run, including pure node helpers. Compiled assertions are not passing assertions.
- No browser checks were performed in this phase, including the allowed manual local locale/theme/guide preference checks. No authenticated desktop/mobile screenshots, actual dark contrast/layout checks, keyboard/focus-return/Tab trapping, modal-conflict behavior, reload/cross-tab persistence or reduced-motion acceptance is claimed.
- Native dialog/browser lifecycle behavior is implemented and source-reviewed, not proven by the pure guide-policy sources. DOM lifecycle coverage would require parent-approved DOM dependencies and/or a separately permitted browser check.
- No registration/login/logout/order/SMS/read/backend-preference business acceptance flow or database mutation was performed.
- Actual chart-marker motion acceptance from the earlier chart task remains outstanding; geometry/transitions were preserved, not newly browser-validated.
- No production provider/payment integration or deployment readiness claim. Parent Phase 4 integration/acceptance remains open.
