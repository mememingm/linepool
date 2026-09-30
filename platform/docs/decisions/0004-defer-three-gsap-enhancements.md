# ADR-004: Defer Three.js and GSAP enhancements

## Status

Accepted

## Date

2026-09-30

## Context

ADR-001 allowed a lazy, non-essential Three.js dashboard decoration and restrained GSAP transitions after the Vue business application was complete. The user has chosen to pause that enhancement. The current product goal is a stable, content-first Vue experience with a smaller dependency and runtime surface.

## Decision

- Do not add Three.js or GSAP to the current `platform` application.
- Keep every route, state and workflow implemented with semantic DOM, Vue and CSS.
- Preserve reduced-motion CSS behavior and the existing progressive-enhancement boundary.
- Reconsider visual libraries only through a later explicit decision and measured bundle/runtime budget.

This decision updates only the optional visual-enhancement part of ADR-001; the Vue, NestJS and PostgreSQL architecture remains accepted.

## Alternatives considered

### Ship a small dashboard decoration now

- Pros: adds spatial motion while keeping business UI in Vue.
- Cons: adds dependencies, WebGL lifecycle handling and verification work without improving the current core flow.
- Deferred by user direction.

### Remove all motion permanently

- Pros: smallest runtime surface.
- Cons: prevents future restrained feedback improvements.
- Rejected; the decision is a deferral, not a permanent ban.

## Consequences

- Current production bundles contain no Three.js or GSAP code.
- Browser acceptance focuses on content, responsiveness, accessibility and transactional consistency.
- Task 10 remains deferred and is not represented as completed work.
