# ADR-005: Use GSAP for restrained interface motion

## Status

Accepted

## Date

2026-09-30

## Context

ADR-004 deferred both GSAP and Three.js to keep the first Vue release focused on business flows. The later redesign brief explicitly asks for GSAP motion while preserving the existing routes, content, API contracts, accessibility and Element Plus components.

## Decision

- Add GSAP to the Web workspace for short entrance and state-feedback transitions.
- Use motion only to clarify hierarchy or confirm a state change. Keep all content and controls usable without animation.
- Create animations after Vue mounts the DOM, scope them with `gsap.context`, and revert them when the component unmounts. Use `gsap.matchMedia` for desktop and reduced-motion conditions.
- Keep mobile and `prefers-reduced-motion: reduce` experiences static or immediate.
- Continue to defer Three.js. No business flow depends on WebGL.

This decision supersedes only ADR-004's GSAP deferral. Its Three.js deferral and the application's architecture remain in force.

## Consequences

- The Web bundle includes GSAP, increasing its runtime size. Keep animations scoped and avoid ScrollTrigger, scroll listeners, looping decoration and layout-property animation.
- Browser acceptance includes reduced-motion behavior, route cleanup, mobile layout and interaction checks.
