# LINEPOOL To C 全栈实现规格

## Objective

构建一个可在本地运行、可点击演示的 LINEPOOL To C 用户网站。用户可以登录、浏览项目和套餐、使用积分模拟下单，并在订单、号码、积分与短信收件箱中看到一致且持久化的结果。

本项目是演示系统：业务数据由后端 seed 写入 PostgreSQL，并在页面中标注“演示数据”。不接入公司真实接口、账号、支付、短信采集、设备端、Agent、eSIM 或管理员后台。

## Validated assumptions

1. 正式应用位于 `D:\linepool\platform`；根目录现有 pure WebGL 原型保持不变。
2. 前端采用 Vue 3 + TypeScript；Three.js 与 GSAP 只用于可降级的局部视觉增强。
3. 登录使用服务端保存的随机会话和 HttpOnly Cookie，不在 localStorage 保存认证令牌。
4. 演示账号由 seed 创建，凭据来自本地环境变量；仓库只提交无敏感信息的示例值。
5. PostgreSQL 开发容器映射到主机 `55432`，避免占用本机已有的 `5432`。
6. 支持现代 Chrome、Edge、Firefox 与 Safari；响应式验收宽度为 320、768、1024、1440 px。

## Tech stack

| Layer | Technology |
|---|---|
| Web | Vue 3, TypeScript, Vite, Vue Router, Pinia, Element Plus |
| Visual enhancement | Three.js (lazy-loaded dashboard decoration), GSAP (short transitions) |
| API | NestJS, TypeScript, REST, Zod boundary validation |
| Database | PostgreSQL, parameterized `pg` queries, SQL migrations |
| Shared contract | Workspace package exporting TypeScript types and Zod schemas |
| Tests | Vitest, Vue Test Utils, Supertest, real PostgreSQL integration tests |

## Commands

Run from `D:\linepool\platform`:

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
npm test
npm run typecheck
npm run build
```

## Project structure

```text
apps/web/                 Vue 3 To C application
apps/api/                 NestJS REST API and PostgreSQL access
packages/contracts/       Shared schemas and request/response types
db/migrations/            Ordered SQL migrations
docs/decisions/           Architecture decision records
tasks/                    Implementation plan and status
docker-compose.yml        Local PostgreSQL service
```

## Product design direction

Translate the user-provided Kimi K3 principles to a transactional To C product rather than imitating an AI chat layout:

- Content first: generous whitespace, restrained black/white/gray surfaces and one blue brand accent.
- Clear hierarchy: precise type scale, weight and spacing; use cards only where they clarify a boundary.
- Frictionless feedback: short transitions, visible request states and immediate success/error confirmation.
- Consistent responsive behavior: preserve information priority across mobile and desktop.
- Performance by default: route-level lazy loading, bounded list rendering and lazy optional visual effects.
- Do not introduce chat history, upload or conversational UI unless LINEPOOL later gains an actual conversational workflow.

Detailed tokens and interaction rules live in `docs/design-system.md`.

## Code style

- TypeScript strict mode; exported functions and public API shapes have explicit types.
- Files and routes use kebab-case; TypeScript values use camelCase; database columns use snake_case.
- REST resources are plural nouns and response fields are camelCase.
- External input is validated once at the HTTP boundary.

```ts
export async function createOrder(
  userId: UserId,
  input: CreateOrderInput,
): Promise<OrderDetail> {
  return database.transaction(async (client) => {
    return allocateNumbersAndDebitPoints(client, userId, input);
  });
}
```

## Data model

- `users`: demo identity, password hash, profile, current point balance.
- `sessions`: hashed opaque session token, user, expiry.
- `projects`: public project catalogue and display metadata.
- `plans`: project package, unit point price, active state.
- `phone_numbers`: seeded inventory; assignment links to a user and order.
- `orders`: idempotent purchase record with quantity and total points.
- `point_ledger`: immutable point credits/debits and balance after each entry.
- `sms_messages`: seeded inbox messages owned by the assigned user and number.

## API contract

Every success response is `{ data: ... }`; paginated responses add `pagination`. Every failure is:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数不正确",
    "details": {}
  }
}
```

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Create a server-side session |
| GET | `/api/auth/me` | Return the current demo user |
| POST | `/api/auth/logout` | Revoke the current session |
| GET | `/api/dashboard` | Balance, available projects, recent orders |
| GET | `/api/projects` | Paginated project catalogue |
| GET | `/api/projects/:id` | Project and plans |
| POST | `/api/orders` | Idempotent transactional purchase |
| GET | `/api/orders` | Current user's paginated orders |
| GET | `/api/orders/:id` | Current user's order detail |
| GET | `/api/numbers` | Current user's assigned numbers |
| GET | `/api/inbox` | Current user's messages |
| POST | `/api/inbox/:id/read` | Mark one owned message as read |
| GET | `/api/points` | Balance and ledger |
| GET | `/api/account` | Current user's account profile |

`POST /api/orders` receives an `idempotencyKey`. The API must return the original order for repeated keys without a second debit or allocation.

## Testing strategy

- Unit tests: shared schemas, pure formatting and state helpers.
- Integration tests: real PostgreSQL migration/seed, authentication, ownership checks and transactional ordering.
- Component tests: loading, empty, error and core interaction states.
- Browser acceptance: login → projects → purchase → orders/numbers/points → inbox, at desktop and mobile widths.

## Boundaries

### Always

- Validate external input, parameterize SQL, hash passwords, authorize every protected resource.
- Keep all order effects in one database transaction.
- Run tests, type checking and builds before declaring completion.
- Mark seed-backed content as demo data.

### Ask first

- Add a real company integration, payment, new PII category, administrator role or production deployment.
- Change authentication mechanism or CORS origins outside local development.

### Never

- Commit `.env`, real credentials, tokens or company API endpoints.
- Let the client change balance, inventory, ownership or order status.
- Copy the prototype's local mock state into the formal application.

## Success criteria

1. A documented local flow starts PostgreSQL, API and web application.
2. A seeded demo user can log in; protected pages reject anonymous access.
3. Projects and plans are read from the API and PostgreSQL.
4. A successful order atomically creates one order, assigns the requested numbers and debits points.
5. Repeating the same order request does not duplicate any effect; insufficient balance or inventory creates no partial state.
6. Orders, numbers and point balance remain consistent after refresh.
7. Inbox messages can be listed and marked read by their owner.
8. All listed pages work at mobile and desktop widths with loading, empty and error states.
9. Tests, type checking and production builds pass without relying on the separate WebGL prototype.

## Open questions deliberately deferred

- Company API address, authentication, field mapping and synchronization.
- Production hosting, observability, backups and secret management service.
- Real payment and real SMS ingestion.

