import { ApiFailure } from '../http.js';
import type { WalletClient } from '../points-wallet.js';

export type PointHistoryQuery = { limit?: number; cursor?: string; userId?: string; status?: string };
export type PointIntentInput = { kind: 'RENT' | 'RENEW'; number?: string; leaseId?: string; term: number; quoteVersion: number };
export type PaymentScenario = 'SUCCESS' | 'FAILURE' | 'UNKNOWN_SUCCESS' | 'UNKNOWN_FAILURE';
export function pointKey(key: string) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new ApiFailure(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must contain 16–128 letters, digits, underscores or hyphens');
  return key;
}
export function pointReason(reason: string) {
  if (typeof reason !== 'string' || reason.trim().length < 2 || reason.length > 500) throw new ApiFailure(400, 'REASON_REQUIRED', 'A reason of 2–500 characters is required');
  return reason.trim();
}
export function cashRefundDisabled(): never { throw new ApiFailure(409, 'CASH_REFUND_DISABLED', 'Cash refunds are unavailable; historical refunds are read only'); }
export async function requirePointAdmin(client: WalletClient, actorId: string) {
  const { rowCount } = await client.query("SELECT 1 FROM users WHERE id=$1 AND role='ADMIN' AND account_status='ACTIVE' AND auth_kind='LOCAL'", [actorId]);
  if (rowCount !== 1) throw new ApiFailure(403, 'ADMIN_REQUIRED', 'Active administrator access is required');
}
export async function requirePointUser(client: WalletClient, userId: string) {
  const { rows: [user] } = await client.query<{ auth_kind: string }>('SELECT auth_kind FROM users WHERE id=$1', [userId]);
  if (!user) throw new ApiFailure(404, 'USER_NOT_FOUND', 'User was not found');
  if (user.auth_kind !== 'LOCAL') throw new ApiFailure(403, 'SELF_SERVICE_REQUIRED', 'Point wallets are available to self-service accounts only');
}
export async function pointAudit(client: WalletClient, actorId: string, action: string, targetId: string, reason: string, after: unknown, before: unknown = null) {
  await client.query('INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)', [actorId, action, targetId, reason, JSON.stringify(before), JSON.stringify(after)]);
}
export async function adminPointReplay(client: WalletClient, actorId: string, action: string, key: string, payload: unknown) {
  pointKey(key);
  await client.query('SELECT pg_advisory_xact_lock(734102614)');
  await requirePointAdmin(client, actorId);
  const { rows: [row] } = await client.query<{ result: unknown; same: boolean }>('SELECT result,request_payload=$4::jsonb AS same FROM once_admin_idempotency WHERE actor_id=$1 AND action=$2 AND idempotency_key=$3', [actorId, action, key, JSON.stringify(payload)]);
  if (row && !row.same) throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Administrative request key was already used with different parameters');
  return row;
}
export async function saveAdminPointResult(client: WalletClient, actorId: string, action: string, key: string, targetId: string, payload: unknown, result: unknown) {
  await client.query('INSERT INTO once_admin_idempotency(actor_id,action,idempotency_key,target_id,request_payload,result) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)', [actorId, action, key, targetId, JSON.stringify(payload), JSON.stringify(result)]);
}
export function pointPagePosition(cursor: string | undefined, scope: string): { time: string; id: string } | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 1024) throw new Error('cursor');
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { scope?: string; time?: string; id?: string };
    if (value.scope !== scope || !value.time || !Number.isFinite(Date.parse(value.time)) || !value.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)) throw new Error('cursor');
    return { time: value.time, id: value.id };
  } catch { throw new ApiFailure(400, 'INVALID_CURSOR', 'History cursor is invalid for this query'); }
}
export function pointPage<T extends { id: string; createdAt: Date | string; cursorTime?: string }>(rows: T[], limit: number, scope: string) {
  const hasMore = rows.length > limit, page = rows.slice(0, limit), last = page.at(-1);
  const items = page.map(({ cursorTime: _cursorTime, ...row }) => row);
  return { items, hasMore, nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ scope,
    time: last.cursorTime ?? new Date(last.createdAt).toISOString(), id: last.id })).toString('base64url') : null };
}
