import { z } from 'zod';
import type { PoolClient } from 'pg';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure, SchemaPipe } from '../http.js';

export const historyQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100), cursor: z.string().min(1).max(2048).optional() });
export const outboundInputSchema = z.strictObject({ to: z.string().min(2).max(40), content: z.string().min(1).max(4000).refine(value => /\S/.test(value)) });
export const mockSmsScenarioSchema = z.enum(['SUCCESS', 'FAILURE', 'UNKNOWN_SUCCESS', 'UNKNOWN_FAILURE']);
export type MockSmsScenario = z.infer<typeof mockSmsScenarioSchema>;
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> { return new SchemaPipe(schema).transform(value); }
export function smsPhone(value: string) {
  const phone = value.replace(/[\s()_-]/g, '');
  if (!/^\+[1-9]\d{1,14}$/.test(phone)) throw new ApiFailure(400, 'INVALID_PHONE_NUMBER', 'A valid international phone number is required');
  return phone;
}
export function smsKey(value: unknown) {
  if (typeof value !== 'string' || !/^[\x20-\x7e]{1,120}$/.test(value)) throw new ApiFailure(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A 1–120 character Idempotency-Key is required');
  return value;
}
export function requireMessageSandbox(environment: Environment) {
  const values = environment.values, database = new URL(values.DATABASE_URL);
  if (environment.pcProvider !== 'pingcode-mock' || values.NODE_ENV === 'production' || !values.LOCAL_SANDBOX || values.API_HOST !== '127.0.0.1'
    || !['127.0.0.1', 'localhost'].includes(database.hostname) || !/_(sandbox|test)$/.test(database.pathname)
    || new URL(values.WEB_ORIGIN).hostname !== '127.0.0.1') {
    throw new ApiFailure(403, 'SANDBOX_DISABLED', 'Message simulation requires an isolated local sandbox');
  }
}
export type OwnedMessageLease = { id: string; number_id: string; user_id: string; status: string; phone_number: string;
  upstream_account_id: string; external_number_id: string | null; resource_status: string; resource_expires_at: Date | null;
  account_status: string; capability: string; source_missing: boolean; historical_only: boolean; auth_status: string;
  access_expires_at: Date | null; enabled_capabilities: string[]; send_connection: boolean; provider: string };
export async function ownedMessageLease(db: Pick<Database, 'query'>, environment: Environment, userId: string, leaseId: string) {
  if (environment.siteId !== 'once') throw new ApiFailure(404, 'LEASE_NOT_FOUND', 'Lease not found');
  const { rows: [row] } = await db.query<OwnedMessageLease>(`SELECT l.id,l.number_id,l.user_id,l.status,n.phone_number,
    n.upstream_account_id,b.external_number_id,n.resource_status,n.resource_expires_at,n.capability,n.source_missing,
    a.status AS account_status,a.historical_only,a.auth_status,a.access_expires_at,a.enabled_capabilities,a.provider,
    (a.provider=$4 AND a.external_account_id=$3 AND a.application_id=$5 AND a.issuer=$6 AND a.subject IS NOT NULL AND NOT a.historical_only) AS send_connection
    FROM leases l JOIN phone_numbers n ON n.id=l.number_id JOIN upstream_accounts a ON a.id=n.upstream_account_id
    JOIN storefronts f ON f.id=a.storefront_id
    LEFT JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=a.provider AND b.external_project_id IS NULL
    WHERE l.id=$1 AND l.user_id=$2
      AND a.owner_kind='SELF_SERVICE' AND a.agent_id IS NULL AND a.storefront_id='once' AND f.product='NUMBER_LEASE'`, [leaseId, userId, environment.selfServiceExternalAccountId, environment.pcProvider, environment.values.PC_APPLICATION_ID, environment.values.PC_ISSUER]);
  if (!row) throw new ApiFailure(404, 'LEASE_NOT_FOUND', 'Lease not found');
  return row;
}
export async function activeMessageAllocation(client: PoolClient, lease: OwnedMessageLease) {
  const { rows } = await client.query<{ id: string }>(`SELECT a.id FROM number_allocations a
    WHERE a.lease_id=$1 AND a.number_id=$2 AND a.user_id=$3 AND a.allocation_type='WHOLE_NUMBER'
      AND a.assigned_at<=now() AND now()<LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at))
      AND EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND o.fulfillment_status='COMPLETED') ORDER BY a.id FOR SHARE`,
  [lease.id, lease.number_id, lease.user_id]);
  if (lease.status !== 'ACTIVE' || lease.account_status !== 'ACTIVE' || lease.resource_status !== 'ONLINE' || lease.capability !== 'SEND_RECEIVE'
    || !lease.send_connection || lease.source_missing || lease.historical_only || lease.auth_status !== 'ACTIVE' || !lease.enabled_capabilities.includes('SEND_SMS')
    || !lease.access_expires_at || lease.access_expires_at.getTime() <= Date.now()
    || !lease.external_number_id || !lease.resource_expires_at || lease.resource_expires_at.getTime() <= Date.now() || rows.length !== 1) {
    throw new ApiFailure(409, 'SMS_SERVICE_UNAVAILABLE', 'The lease has no current messaging service');
  }
  return rows[0]!.id;
}
type Position = { scope: string; time: string; id: string };
export function messageCursor(cursor: string | undefined, scope: string): Position | null {
  if (!cursor) return null;
  try {
    const decoded = z.strictObject({ v: z.literal(1), scope: z.string(), time: z.iso.datetime(), id: z.uuid() }).parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (decoded.scope !== scope) throw new Error('scope');
    return decoded;
  } catch { throw new ApiFailure(400, 'INVALID_CURSOR', 'History cursor is invalid for this query'); }
}
export function messagePage<T extends { id: string }>(rows: T[], limit: number, scope: string, time: (row: T) => Date) {
  const hasMore = rows.length > limit, items = rows.slice(0, limit), last = items.at(-1);
  return { items, nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ v: 1, scope, time: time(last).toISOString(), id: last.id })).toString('base64url') : null, hasMore };
}
