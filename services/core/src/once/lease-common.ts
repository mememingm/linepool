import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  onceIntentInputSchema, onceRentInputSchema, onceRenewInputSchema,
  onceRequestKeySchema, onceScenarioSchema, onceTermSchema,
} from '@linepool/contracts';
import { ApiFailure } from '../http.js';

export const leaseKey = onceRequestKeySchema;
export const leaseTerm = onceTermSchema;
export const leaseInput = onceRentInputSchema;
export const renewInput = onceRenewInputSchema;
export const intentInput = onceIntentInputSchema;
export const scenarioSchema = onceScenarioSchema;
export type IntentInput = z.infer<typeof intentInput>;
export type LeaseInput = z.infer<typeof leaseInput>;
export type RenewInput = z.infer<typeof renewInput>;
export type Scenario = z.infer<typeof scenarioSchema>;
export const DAY = 86400000;
export function fail(code: string, message: string, status = 409): never {
  throw new ApiFailure(status, code, message);
}
export async function requireLeaseAdmin(client: PoolClient, actorId: string) {
  if (!(await client.query("SELECT 1 FROM users WHERE id=$1 AND role='ADMIN' AND account_status='ACTIVE'", [actorId])).rowCount) {
    fail('ADMIN_REQUIRED', 'An active administrator account is required', 403);
  }
}
export async function audit(client: PoolClient, actor: string, action: string, target: string, reason: string, before: unknown, after: unknown) {
  await client.query('INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
    [actor, action, target, reason, JSON.stringify(before), JSON.stringify(after)]);
}
export function historyPosition(cursor: unknown, scope: string) {
  if (cursor === undefined) return null;
  try {
    if (typeof cursor !== 'string') throw Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (value.v !== 1 || value.scope !== scope || !z.uuid().safeParse(value.id).success
      || typeof value.time !== 'string' || new Date(value.time).toISOString() !== value.time) throw Error();
    return { id: value.id as string, time: value.time as string };
  } catch { return fail('INVALID_CURSOR', 'Invalid cursor for this history', 400); }
}
export function historyPage<T extends { id: string; created_at: Date }>(rows: T[], limit: number, scope: string) {
  const hasMore = rows.length > limit, items = rows.slice(0, limit), last = items.at(-1);
  return { items, hasMore, nextCursor: hasMore && last
    ? Buffer.from(JSON.stringify({ v: 1, scope, time: new Date(last.created_at).toISOString(), id: last.id })).toString('base64url') : null };
}
export const historyQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().min(1).max(1024).optional(), leaseId: z.uuid().optional(),
});
