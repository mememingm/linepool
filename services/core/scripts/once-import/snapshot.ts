import { z } from 'zod';
import { clean, quote, record, sourceColumns, text, type Client, type Decisions, type Entity, type Identity, type Row, type Source, type Target } from './model.js';

const object = z.record(z.string(), z.unknown());
const identity = z.object({ host: z.string(), port: z.int().min(1).max(65535), database: z.string().min(1), user: z.string().min(1) }).strict();
const reason = z.string().trim().min(3);
const uuid = z.uuid();
const evidence = z.array(z.object({ entity: z.enum(Object.keys(sourceColumns) as [Entity, ...Entity[]]), sourceId: z.string().min(1) }).strict()).min(1);
export const decisionsSchema = z.object({
  version: z.literal(1), batchId: uuid, sourceSystem: z.string().min(1), source: identity, target: identity, approvedBy: uuid, reason,
  users: z.record(z.string(), z.object({ targetId: uuid, mode: z.enum(['CREATE', 'EXISTING_ADMIN']), reason, expectedEmail: z.email(), expectedRole: z.enum(['USER', 'ADMIN']), expectedStatus: z.enum(['ACTIVE', 'DISABLED']), access: z.object({ method: z.enum(['EXISTING_CORE', 'ADMIN_RESET']), administratorId: uuid.optional(), procedure: z.literal('POST /api/once/admin/users/:id/password').optional(), reason }).strict() }).strict()),
  accounts: z.record(z.string(), z.object({ targetId: uuid, reason }).strict()),
  numbers: z.record(z.string(), z.object({ targetId: uuid, mode: z.enum(['CREATE', 'MERGE']), reason, regionId: z.string(), provider: z.enum(['demo', 'pingcode', 'pingcode-mock']), externalAccountId: z.string().min(1), externalNumberId: z.string().min(1).nullable(), resourceStatus: z.enum(['LOCAL', 'ONLINE', 'OFFLINE', 'ERROR']), evidence }).strict()),
  ids: z.record(z.string(), z.object({ targetId: uuid, reason }).strict()), settingIds: z.record(z.string(), uuid),
  periods: z.array(z.object({ id: uuid, leaseId: uuid, orderId: uuid, assignedAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }), releasedAt: z.iso.datetime({ offset: true }).nullable(), releaseReason: z.enum(['MANUAL', 'EXPIRED', 'REASSIGNED']).nullable(), evidence, reason,
    serviceEndResolution: z.object({ kind: z.literal('RECORDED_END'), approvedBy: uuid, approvedAt: z.iso.datetime({ offset: true }), approvalReference: reason, reason }).strict().optional(),
  }).strict()),
  requests: z.record(z.string(), z.object({ payload: object, evidence, reason }).strict()),
  adminOperations: z.record(z.string(), z.object({ action: z.string().min(1), targetId: z.string().nullable(), key: z.string().min(1), payload: object, evidence, reason }).strict()),
  provenance: z.record(z.string(), z.object({ provider: z.enum(['demo', 'pingcode', 'pingcode-mock']), externalAccountId: z.string().min(1), evidence, reason }).strict()),
  settings: z.object({ actorId: uuid, rechargeRules: object.optional(), reason }).strict().nullable(),
}).strict();
export function parseDecisions(value: unknown): Decisions { return decisionsSchema.parse(value); }

/** Literal table/column allowlists: source commands can never contain caller-supplied SQL. */
export async function readSource(client: Client): Promise<Source> {
  const result = {} as Source;
  for (const entity of Object.keys(sourceColumns) as Entity[]) {
    const columns = sourceColumns[entity].split(' ').filter(column => column !== 'checkoutUrl' && column !== 'claimToken');
    const where = entity === 'AppSetting' ? ` WHERE "key" IN ('number.cooldownDays','points.rechargeRules')` : '';
    const order = entity === 'AppSetting' ? '"key"' : '"id"';
    const { rows } = await client.query<{ data: unknown }>(`SELECT to_jsonb(s) AS data FROM (SELECT ${columns.map(quote).join(',')} FROM public.${quote(entity)}${where} ORDER BY ${order}) s`);
    result[entity] = rows.map(row => record(clean(row.data)));
  }
  return result;
}
export const targetTables = [
  'users', 'agents', 'customers', 'storefronts', 'upstream_accounts', 'regions', 'lease_plans', 'phone_numbers',
  'provider_resource_bindings', 'leases', 'orders', 'point_accounts', 'point_reservations', 'point_ledger',
  'number_allocations', 'whole_number_reservations', 'purchase_intents', 'recharge_orders', 'refund_orders',
  'point_exceptions', 'admin_audit', 'once_admin_idempotency', 'sms_messages', 'provider_message_receipts',
  'outbound_messages', 'provider_event_receipts', 'provider_event_attempts', 'provider_event_conflicts',
  'mock_fulfillment_operations', 'mock_sms_operations', 'once_settings', 'recharge_settings',
  'once_legacy_assignment_snapshots', 'once_import_batches', 'once_import_entities',
] as const;
export async function readTarget(client: Client, expected: Identity): Promise<Target> {
  const { rows: identities } = await client.query<{ database: string; user: string; site: string | null; durable_site: boolean }>(`SELECT current_database() AS database,current_user AS "user",current_setting('app.site_id',true) AS site,
    EXISTS(SELECT 1 FROM pg_db_role_setting setting JOIN pg_database db ON db.oid=setting.setdatabase
      WHERE db.datname=current_database() AND setting.setrole=0 AND 'app.site_id=once'=ANY(setting.setconfig)) AS durable_site`);
  if (identities[0].database !== expected.database || identities[0].user !== expected.user) throw new Error('Connected database/role differs from explicit URL identity');
  const columns: Record<string, string[]> = {};
  const tables: Record<string, Row[]> = {};
  for (const table of targetTables) {
    const { rows } = await client.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
    columns[table] = rows.map(row => row.column_name);
    if (!rows.length) { tables[table] = []; continue; }
    const safe = columns[table].filter(column => !/password|secret|token|authorization|cookie/i.test(column));
    const selection = safe.map(quote).join(',') + (table === 'users' ? `,(length(password_hash)=60 AND left(password_hash,3) IN ('$2a','$2b','$2y')) AS local_credential_ready` : '');
    const selected = await client.query<{ data: unknown }>(`SELECT to_jsonb(t) AS data FROM (SELECT ${selection} FROM public.${quote(table)}) t ORDER BY to_jsonb(t)::text`);
    tables[table] = selected.rows.map(row => record(clean(row.data)));
  }
  return { identity: expected, siteId: identities[0].durable_site ? identities[0].site : null, columns, tables };
}
export async function assertReadOnly(client: Client): Promise<void> {
  const { rows } = await client.query<{ transaction_read_only: string }>('SHOW transaction_read_only');
  if (rows[0].transaction_read_only !== 'on') throw new Error('Import preflight requires a read-only transaction');
}
export async function assertSourceIdentity(client: Client, expected: Identity): Promise<void> {
  const { rows } = await client.query('SELECT current_database() AS database,current_user AS "user"');
  if (text(rows[0].database) !== expected.database || text(rows[0].user) !== expected.user) throw new Error('Source database/role differs from explicit URL identity');
}
