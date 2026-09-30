# ADR-001: Build the formal app with Vue, NestJS and PostgreSQL

## Status

Accepted

## Date

2026-09-30

## Context

The original build brief requires a maintainable To C application with mobile support, accessible forms, typed frontend/backend contracts and persistent transactional state. A separate root-level prototype renders all visible UI with Three.js, uses JavaScript and stores mock business state in the browser. That prototype is useful for visual exploration but does not meet the formal application's API, accessibility, responsive or persistence requirements.

## Decision

- Place the formal application in `platform/` so the root WebGL prototype remains untouched.
- Use Vue 3 + TypeScript for the DOM application, NestJS + TypeScript for REST APIs and PostgreSQL for durable state.
- Use Three.js only in a lazy-loaded, non-essential dashboard decoration and GSAP for short, reduced-motion-aware transitions.
- Keep business state exclusively behind the REST API. The browser never owns balance, inventory or order state.

## Alternatives considered

### Continue with pure Three.js

- Pros: distinctive visual identity and reuse of the prototype.
- Cons: costly text/form accessibility, weak mobile ergonomics, larger rendering bundle and difficult automation.
- Rejected as the primary application architecture; retained as a visual reference.

### Replace the prototype in place

- Pros: one root application.
- Cons: overwrites active prototype work and makes later comparison or selective migration harder.
- Rejected to preserve work and avoid cross-session file conflicts.

### Use Vue for every view without Three.js

- Pros: simplest and smallest implementation.
- Cons: loses the approved spatial visual direction entirely.
- Rejected in favor of a tightly bounded enhancement layer.

## Consequences

- The formal app and prototype coexist temporarily.
- Core pages remain usable if WebGL is unavailable or reduced motion is enabled.
- Any future prototype integration must be ported into typed Vue components and may not import its local mock store.

