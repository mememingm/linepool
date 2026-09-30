# ADR-002: Use opaque cookie sessions and database-owned order effects

## Status

Accepted

## Date

2026-09-30

## Context

The demo still handles login and point-valued purchases. Authentication must not place reusable tokens in browser storage, and one purchase must not partially debit points or allocate inventory. Repeated submits are expected in browsers and must be safe.

## Decision

- Generate a cryptographically random session token at login, store only its SHA-256 hash in PostgreSQL and send the raw token in an HttpOnly, SameSite=Lax cookie.
- Hash demo passwords with bcrypt at cost 12.
- Require an `idempotencyKey` for order creation and enforce uniqueness per user.
- Lock the user balance and selected inventory rows, then create the order, assign numbers and append the point ledger inside one PostgreSQL transaction.

## Alternatives considered

### JWT in localStorage

- Rejected because script-accessible storage increases token theft exposure and logout cannot revoke an issued token without more infrastructure.

### Client-side mock purchase state

- Rejected because the client could mutate balances and refreshes or concurrent requests could diverge.

### Multiple independent database writes

- Rejected because a failure could leave points, inventory and orders inconsistent.

## Consequences

- Sessions can be revoked on logout and expire server-side.
- Local HTTP uses a non-secure cookie; production mode requires HTTPS and sets `Secure`.
- Integration tests need PostgreSQL to prove locking, rollback and idempotency behavior.

