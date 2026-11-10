import { resolve } from 'node:path';

export type Options = { command: 'help' } | {
  command: 'preflight' | 'apply'; report: string; decisions?: string; template?: string;
  confirmTarget?: string; sourceFrozen: boolean; targetFrozen: boolean; authorized: boolean;
};

export const help = `Legacy ONCE → independent ONCE database importer

Usage (from repository root, after the core build):
  node services/core/dist/core/scripts/import-once.js --help
  node services/core/dist/core/scripts/import-once.js preflight --report <report.json> [--template <decisions.json>] [--decisions <reviewed.json>]
  node services/core/dist/core/scripts/import-once.js apply --report <reviewed-report.json> --decisions <reviewed.json> --confirm-target <database> --source-frozen --target-frozen --authorized

--help and argument validation do not connect PostgreSQL or load Environment, .env or application modules.
Database commands require explicitly supplied process environment:
  SITE_ID=once
  ONCE_IMPORT_SOURCE_URL=postgresql://<read-only-role>:<secret>@127.0.0.1:<port>/<legacy-once>
  ONCE_IMPORT_TARGET_URL=postgresql://<target-role>:<secret>@127.0.0.1:<port>/<independent-once>
No DATABASE_URL fallback, LinePool connection, email merge or database bulk copy is used.
URLs must address local PostgreSQL, with explicit role/database and no query overrides.
Source and target must identify different server-port/database pairs, even under different roles or loopback aliases.

Prerequisites before a separately authorized database operation:
  • Target initialized through migrations001–026,028–032,037–044 (old033–036 candidates are not selected).
  • Target database provisioned with durable app.site_id=once; SITE_ID alone is insufficient.
  • Target contains no LinePool business rows; both sites' schema catalogue rows may exist.
  • Existing active LOCAL administrator with a usable core bcrypt credential and reviewed recovery procedure.
    A source administrator must be preprovisioned with the same UUID and reviewed existing access.
    Any imported source wallet requires its own target wallet; do not precreate or merge that wallet.
  • Preprovision historical-only ONCE upstream_accounts for original source provider/account pairs:
    historical_only=true, owner_kind=SELF_SERVICE, auth_status=UNAUTHORIZED, no tokens/capabilities.
    For legacy demo/empty-account only, use an explicitly reviewed nonempty local provenance label;
    retain provider=demo and original empty source account in the import mapping. Never reuse live accounts.
  • Keep legacy source and payment/lot evidence read-only and retain its backup. No credentials/sessions/reset tokens are copied.
  • Resolve all unfinished/ambiguous financial operations, account/actor conflicts, and period/message attribution gaps in source/review first.

Workflow:
  1. Obtain explicit authorization for the concrete local source/target and preflight connection.
  2. Run preflight to produce the sanitized source facts, blockers, counts and decision template.
     Both connections use REPEATABLE READ READ ONLY transactions; preflight executes no DML.
  3. Complete every reviewed user/wallet/resource/provenance mapping, canonical request, timestamp-backed
     lease period, settings conversion and actor decision. UUIDs stay unchanged unless explicitly mapped.
     New ordinary users retain disabled state and receive a denied password until the protected
     POST /api/once/admin/users/:id/password procedure (newPassword+reason, Idempotency-Key) is performed. No legacy scrypt compatibility,
     administrator promotion, account-by-email matching, or session/token conversion exists.
     An existing administrator may be adopted only with the exact same UUID and reviewed existing access.
     requests are keyed Entity:<original UUID> and contain payload, source evidence references and a reason.
     A RELEASED Lease requires requests[Lease:<UUID>].payload.releasedAt from its actual release audit;
     source Lease.endedAt records service end and is never guessed to be the release time.
     A separately approved final-period conflict may include periods[].serviceEndResolution:
       {kind:"RECORDED_END",approvedBy,approvedAt,approvalReference,reason}.
     The actor must match the reviewed batch approver; preserve the purchased expiry and original facts,
     set releasedAt to the exact source Lease.endedAt and releaseReason=MANUAL. Source expiresAt must
     equal that recorded end inside the final purchased period. This explicit disposition is retained
     with both lease and period facts; it is not a fabricated original end audit or an inventory release.
     ORDER_REFUND ledger decisions need payload.orderId (original order UUID), the matching original
     AdminIdempotency result/ledgerId and ORDER_POINTS_REFUNDED audit/amount evidence.
     Known local demo-chat and demo-inbox:<original user UUID> message keys remain unchanged. Imported
     local event normalized payloads use the original lease payload's message ID/content/time and the
     mapped historical physical account/number. Unmatched events do not fabricate delivered receipts.
     Successful historical orders keep unknown completedAt as NULL. Initial periods use Lease.startedAt;
     a renewal with unknown completion requires original audit proof that it preceded the prior expiry.
     Historical AdminIdempotency rows remain immutable source facts, including original hash/result;
     erased form fields and old passwords are not reconstructed into executable requests.
     An explicit ids[Plan:<UUID>] mapping may adopt an existing plan only when all commercial/configuration
     fields match. The target keeps its local version/timestamps; the immutable source fact keeps the original
     UUID/version/timestamps. Conflicting prices/settings must first be resolved through protected admin operations.
     Reviewed rechargeRules retain legacy minMinor/maxMinor; import converts them to the core
     minimumMinor/maximumMinor contract and validates it without changing limits or exchange values.
     Historical phone numbers remove only display whitespace/parentheses/hyphens for the core E.164 column.
     Original text remains in source facts/display metadata; canonical collisions still block the entire import.
  4. Rerun preflight --decisions with a fresh report. Any blocker prevents apply.
  5. Obtain concrete write authorization, stop source and target API/workers, and keep source frozen.
     --authorized/--source-frozen/--target-frozen record operator attestations; they do not stop services.
  6. Apply using that report, identical decisions and exact target database name. Apply repeats source/target
     inspection, verifies the reviewed digests, locks target tables and writes one SERIALIZABLE transaction.
     It inserts original deltas/reservations/facts directly, never calls reserve/capture/credit/send/provider code.
     It checks resulting wallet chains/references before COMMIT; any failure rolls back the whole batch.
     A completed batch with the identical source/decisions replays without writes or credit.

Historical resources remain unsaleable and held under historical-only provenance accounts. Missing external
IDs/expiry for known local demo history stay NULL; no binding/resource expiry is invented. Historical messages,
periods, orders and balances remain readable; historical sends are never dispatched again.
Report/decision files contain business data; store them locally with restricted access. URLs are never printed.
This command does not migrate, provision accounts, stop services, clear data, or perform cutover.
`;

/** Parse everything before consulting environment or importing any DB-dependent module. */
export function parseArguments(args: string[]): Options {
  if (!args.length || (args.length === 1 && ['--help', '-h', 'help'].includes(args[0]))) return { command: 'help' };
  const [command, ...rest] = args;
  if (command !== 'preflight' && command !== 'apply') throw new Error('Expected preflight, apply, or --help');
  const values = new Map<string, string>(), flags = new Set<string>();
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];
    if (['--source-frozen', '--target-frozen', '--authorized'].includes(argument)) {
      if (flags.has(argument)) throw new Error(`Duplicate option ${argument}`);
      flags.add(argument); continue;
    }
    if (!['--report', '--template', '--decisions', '--confirm-target'].includes(argument)) throw new Error(`Unknown option ${argument}`);
    if (values.has(argument)) throw new Error(`Duplicate option ${argument}`);
    const value = rest[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    values.set(argument, value);
  }
  const report = values.get('--report'), decisions = values.get('--decisions'), template = values.get('--template');
  if (!report) throw new Error('--report is required');
  if (command === 'apply' && (!decisions || !values.get('--confirm-target') || !flags.has('--authorized') || !flags.has('--source-frozen') || !flags.has('--target-frozen'))) throw new Error('Apply requires --decisions, --confirm-target, --authorized, --source-frozen and --target-frozen');
  if (command === 'apply' && template) throw new Error('--template is only available during preflight');
  if (command === 'preflight' && (flags.size || values.has('--confirm-target'))) throw new Error('Apply attestations are not preflight options');
  const paths = [report, decisions, template].filter((value): value is string => value !== undefined).map(value => resolve(value));
  if (new Set(paths.map(value => value.toLowerCase())).size !== paths.length) throw new Error('Report, template and decisions must use different paths');
  return { command, report, decisions, template, confirmTarget: values.get('--confirm-target'), sourceFrozen: flags.has('--source-frozen'), targetFrozen: flags.has('--target-frozen'), authorized: flags.has('--authorized') };
}
