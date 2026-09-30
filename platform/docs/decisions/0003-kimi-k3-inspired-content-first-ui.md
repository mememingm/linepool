# ADR-003: Use a Kimi K3-inspired content-first UI language

## Status

Accepted

## Date

2026-09-30

## Context

The requested direction values Kimi K3's minimal visual presentation, readable information hierarchy, fluid feedback and performance. LINEPOOL, however, is a project marketplace and account workspace rather than a conversational AI product.

## Decision

- Adopt the principles—restrained neutrals, generous whitespace, precise typography, strong information hierarchy and short feedback motion.
- Keep the product's task-oriented routes and conventional forms/lists instead of copying chat history, composer or upload patterns.
- Use one blue accent for primary actions and selection.
- Make route content and API feedback primary; visual enhancement remains optional and lazy.

## Alternatives considered

### Copy a Kimi chat layout directly

- Rejected because a conversation stream is not the user's primary mental model for buying and managing phone numbers.

### Preserve the dark spatial WebGL language for every page

- Rejected because it conflicts with the requested content-first direction and adds readability, accessibility and mobile costs.

### Use a generic dashboard card grid

- Rejected because uniform cards flatten information priority and produce the template-like appearance the direction is intended to avoid.

## Consequences

- The Vue application uses a light, neutral design system documented in `docs/design-system.md`.
- The existing dark pure-WebGL prototype remains a separate experiment, not the formal product skin.
- Visual review must check information density and hierarchy, not just component completeness.
