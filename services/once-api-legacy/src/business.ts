import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

export const day = 86400000;
type Db = Pick<Prisma.TransactionClient, 'plan' | 'appSetting'>;
/** Price for a rental term. Customer purchases need an active plan; operators may use any defined plan. */
export async function planFor(db: Db, days: number, activeOnly = true) {
  const plan = Number.isInteger(days) ? await db.plan.findUnique({ where: { days } }) : null;
  if (!plan || (activeOnly && !plan.active)) throw new BadRequestException({ message: '该租期已下架或不存在，请重新选择。', code: 'PLAN_UNAVAILABLE' });
  return plan;
}
export const cooldownKey = 'number.cooldownDays';
/** Days an expired number stays held for its last user; null means it is only released by an operator. */
export async function cooldownDays(db: Db) {
  const row = await db.appSetting.findUnique({ where: { key: cooldownKey } });
  return typeof row?.value === 'number' ? row.value : null;
}
/**
 * Puts a number back on sale. An expired lease still holding it becomes RELEASED (its history is kept);
 * an active, unexpired lease blocks the release. Caller must hold the phone lock.
 */
export async function releaseNumber(tx: Prisma.TransactionClient, phoneNumberId: string, now = new Date()) {
  const current = await tx.lease.findFirst({ where: { phoneNumberId, status: { in: ['ACTIVE', 'EXPIRED_HELD'] } } });
  if (current && current.status === 'ACTIVE' && current.expiresAt > now) return false;
  if (await tx.order.count({ where: { phoneNumberId, status: { in: ['PENDING', 'PROCESSING', 'UNCERTAIN'] } } })) return false;
  if (current) {
    await tx.lease.update({ where: { id: current.id }, data: { status: 'RELEASED', endedAt: current.endedAt ?? current.expiresAt } });
  }
  await tx.phoneNumber.update({ where: { id: phoneNumberId }, data: { occupied: false, holdReason: null } });
  return true;
}
export const transactionOptions = { maxWait: 10000, timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };
export function idempotencyKey(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(value)) throw new BadRequestException('A 16-128 character Idempotency-Key header is required');
  return value;
}
export function fingerprint(value: unknown): string {
  // Sorted object keys make event and request fingerprints independent of JSON key order.
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,entry]) => [key,canonical(entry)])) : item;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
}
export async function lockPhone(tx: Prisma.TransactionClient, phoneNumberId: string) {
  await tx.$queryRaw`SELECT "id" FROM "PhoneNumber" WHERE "id" = ${phoneNumberId}::uuid FOR UPDATE`;
}

type Position = { v: 1; scope: string; time: string; id: string };
export function cursorPosition(cursor: string | undefined, scope: string) {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Position;
    if (value.v !== 1 || value.scope !== scope || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) || !Number.isFinite(Date.parse(value.time)) || new Date(value.time).toISOString() !== value.time) throw new Error();
    return { time: new Date(value.time), id: value.id };
  } catch { throw new BadRequestException('Invalid cursor for this history'); }
}
export function pageResult<T extends { id: string }>(rows: T[], limit: number, scope: string, date: (row: T) => Date) {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({v:1,scope,time:date(last).toISOString(),id:last.id})).toString('base64url') : null;
  return { items, nextCursor, hasMore };
}
