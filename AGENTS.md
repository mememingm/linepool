# Repository boundaries

This is a multi-application workspace. Read `docs/handoff/lp-once-v41-master-plan.md` as the current v4.2 execution authority (the filename is retained), including its progress table and latest execution records; execute only the user-authorized scope. The old S1–S8 plan is historical. LinePool UI rules are in `apps/linepool-web/AGENTS.md`.

- `apps/linepool-web/`: LinePool React frontend; port 5178.
- `apps/once-web/`: ONCE React frontend; port 5174; keep the legacy API on port 3000 until an authorized cutover.
- `services/core/`: shared NestJS source, originally the LinePool backend; target separate LP/ONCE instances and logical databases, with API and worker in separate processes per site. LP currently uses port 3010; record the ONCE instance port when implemented.
- `packages/contracts/`: shared TypeScript and Zod contracts.
- `services/once-api-legacy/`: copied ONCE backend; independent installation and lockfile, outside the root workspaces.
- Root `package.json` and `package-lock.json`: workspace installation and coordinating scripts. Run installation, build and typecheck from the repository root.
- Before ending an execution session, update the master plan's acceptance/progress tables and append an actual result record under section 10.3, including evidence, blockers and the next action. A chat-only report is not a completed handoff.

## Global rules

- Do not run tests, including `npm test`, `test:points`, `test:integrations`, or test scripts. Build, typecheck, `verify:upstream` and `verify:catalog-upstream` are allowed; follow the stage's explicitly required installation and generation commands.
- Do not commit, push, create branches or change Git configuration without explicit user authorization.
- Preserve the bytes of LinePool `src/vendor/**`, `public/**`, `upstream-lock.json` and `catalog-upstream-lock.json`. Do not regenerate upstream locks. S1 may move these directories intact.
- Do not connect real PingCode/PC, SIP or payment providers, or add real keys. Use Mock implementations. Keep local `.env*` and credentials ignored; never force-add them or print secrets.
- Do not delete content from `D:/once`, `oneoff-sms/`, `webhook-lab/`, `ccam/`, `output/`, `tmp/` or `deploy/`. `D:/once` is a read-only copy source. `oneoff-sms/` is an unrelated experiment; do not modify it.
- Preserve ONCE's existing visual style and LinePool's upstream visual components. LinePool business changes belong only in `apps/linepool-web/src/linepool/**`, using composition and existing upstream props. Preserve licenses and static resources.
- Do not refactor unrelated code, upgrade dependency versions, change formatting configuration or rename unrelated files.
- Never edit existing database migrations. Allocate new numbers after checking the current maximum across the main workspace and relevant worktrees; do not fill the historical gap at 027. Creating databases, executing migrations or imports, seeding and write-producing demonstrations require explicit authorization for the concrete local target; never run migrations on a remote database or reuse old S3 approval for a new target.
- Stop and report if work requires files outside the authorized stage, conflicts with the current decisions, needs deletion of tracked files, or a build/typecheck fix would change business logic. Respect explicit exceptions authorized in the conversation.
- The target is shared code with independently deployed LP/ONCE sites, databases, users and funds. Self-service customers use site points; agents sign in through PinClode with a trusted subject, use their own connection and may view its verification codes. The platform does not handle agent sales proceeds; wholesale purchasing, stock distribution, settlement and agent-customer site accounts are disabled/deferred, with historical tables preserved. Follow R0–R5 in the master plan; do not infer real-provider or database-operation authorization from the architecture update.
