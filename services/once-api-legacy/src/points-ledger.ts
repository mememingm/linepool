import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, PointAccount } from '@prisma/client';
import { lockUser } from './business';
import { settings } from './config';

type Tx = Prisma.TransactionClient;
export const maxPoints = 1_000_000_000;
export function pointError(message: string, code: string): never { throw new ConflictException({ message, code }); }
export function pointsInteger(value: number, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > maxPoints) pointError('积分数量无效。', 'INVALID_POINTS');
}
/** All wallet writers lock user -> account -> phone -> business rows. Never call a provider under these locks. */
export async function lockPointAccount(tx: Tx, userId: string, writable = true) {
  await lockUser(tx, userId);
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  await tx.pointAccount.upsert({ where: { userId }, create: { userId }, update: {} });
  await tx.$queryRaw`SELECT "id" FROM "PointAccount" WHERE "userId"=${userId}::uuid FOR UPDATE`;
  const account = await tx.pointAccount.findUniqueOrThrow({ where: { userId } });
  if (writable && (account.status !== 'ACTIVE' || user.status !== 'ACTIVE')) throw new ForbiddenException('账户已受限，请联系客服核对余额或办理退款。');
  return account;
}
async function ledger(tx: Tx, accountId: string, kind: string, businessId: string, availableDelta: number, frozenDelta: number, reason = '', actorId?: string) {
  const current = await tx.pointAccount.findUniqueOrThrow({ where: { id: accountId } });
  pointsInteger(current.availablePoints + availableDelta, true);
  pointsInteger(current.frozenPoints + frozenDelta, true);
  const account = await tx.pointAccount.update({ where: { id: accountId }, data: {
    availablePoints: { increment: availableDelta }, frozenPoints: { increment: frozenDelta }, sequence: { increment: 1 },
  } });
  const totals = await tx.pointLot.aggregate({ where: { accountId }, _sum: { availablePoints: true, frozenPoints: true } });
  if ((totals._sum.availablePoints ?? 0) !== account.availablePoints || (totals._sum.frozenPoints ?? 0) !== account.frozenPoints)
    pointError('积分账目需要核对，操作已回滚。', 'POINTS_INVARIANT');
  return tx.pointLedger.create({ data: { accountId, sequence: account.sequence, kind, businessId, availableDelta, frozenDelta,
    availableAfter: account.availablePoints, frozenAfter: account.frozenPoints, reason, actorId } });
}
export async function grantPoints(tx: Tx, account: PointAccount, points: number, source: 'PAID' | 'DEMO' | 'COMPENSATION', businessId: string, reason: string, actorId?: string, rechargeId?: string) {
  pointsInteger(points);
  if (source === 'DEMO' && (!settings.demo || settings.production)) throw new ForbiddenException('模拟积分已禁用。');
  const kind = source === 'COMPENSATION' ? 'COMPENSATION' : 'RECHARGE';
  const existing = await tx.pointLedger.findUnique({ where: { accountId_kind_businessId: { accountId: account.id, kind, businessId } } });
  if (existing) return existing;
  await tx.pointLot.create({ data: { accountId: account.id, rechargeId, source, issuedPoints: points, availablePoints: points } });
  return ledger(tx, account.id, kind, businessId, points, 0, reason, actorId);
}
export async function reservePoints(tx: Tx, account: PointAccount, points: number, kind: 'ORDER' | 'REFUND', businessId: string, lotId?: string) {
  pointsInteger(points, true);
  const existing = await tx.pointReservation.findUnique({ where: { accountId_kind_businessId: { accountId: account.id, kind, businessId } } });
  if (existing) return existing;
  const current = await tx.pointAccount.findUniqueOrThrow({ where: { id: account.id } });
  if (current.availablePoints < points) pointError('可用积分不足，请充值后返回确认。', 'INSUFFICIENT_POINTS');
  const lots = await tx.pointLot.findMany({ where: { accountId: account.id, availablePoints: { gt: 0 }, ...(lotId ? { id: lotId } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  // Compensation first; paid/demo lots retain FIFO order within their source.
  lots.sort((a, b) => Number(b.source === 'COMPENSATION') - Number(a.source === 'COMPENSATION'));
  if (lots.reduce((sum, lot) => sum + lot.availablePoints, 0) < points) pointError('该笔充值的可用积分已变化，请重新申请。', 'REFUND_BALANCE_CHANGED');
  const reservation = await tx.pointReservation.create({ data: { accountId: account.id, kind, businessId, points } });
  let remaining = points;
  for (const lot of lots) {
    const take = Math.min(remaining, lot.availablePoints);
    if (!take) break;
    const changed = await tx.pointLot.updateMany({ where: { id: lot.id, availablePoints: { gte: take } }, data: { availablePoints: { decrement: take }, frozenPoints: { increment: take } } });
    if (changed.count !== 1) pointError('积分来源已变化，请重试原请求。', 'POINTS_CONFLICT');
    await tx.pointAllocation.create({ data: { reservationId: reservation.id, lotId: lot.id, points: take } });
    remaining -= take;
  }
  await ledger(tx, account.id, kind + '_RESERVE', businessId, -points, points);
  return reservation;
}
export async function settlePoints(tx: Tx, reservationId: string, outcome: 'CAPTURED' | 'RELEASED') {
  const reservation = await tx.pointReservation.findUniqueOrThrow({ where: { id: reservationId }, include: { allocations: true } });
  if (reservation.status === outcome) return reservation;
  if (reservation.status !== 'RESERVED') pointError('冻结积分已处理，不能重复操作。', 'RESERVATION_SETTLED');
  for (const allocation of reservation.allocations) {
    const changed = await tx.pointLot.updateMany({ where: { id: allocation.lotId, frozenPoints: { gte: allocation.points } }, data: {
      frozenPoints: { decrement: allocation.points }, ...(outcome === 'RELEASED' ? { availablePoints: { increment: allocation.points } } : {}),
    } });
    if (changed.count !== 1) pointError('冻结来源需要核对。', 'POINTS_INVARIANT');
  }
  const released = outcome === 'RELEASED';
  await ledger(tx, reservation.accountId, reservation.kind + '_' + (released ? 'RELEASE' : 'CAPTURE'), reservation.businessId,
    released ? reservation.points : 0, -reservation.points);
  return tx.pointReservation.update({ where: { id: reservationId }, data: { status: outcome } });
}
export async function refundConsumedPoints(tx: Tx, reservationId: string, points: number, businessId: string, reason: string, actorId: string) {
  pointsInteger(points);
  const reservation = await tx.pointReservation.findUniqueOrThrow({ where: { id: reservationId }, include: { allocations: { orderBy: { id: 'asc' } } } });
  const previous = await tx.pointLedger.findUnique({ where: { accountId_kind_businessId: { accountId: reservation.accountId, kind: 'ORDER_REFUND', businessId } } });
  if (previous) return previous;
  if (reservation.kind !== 'ORDER' || reservation.status !== 'CAPTURED' || reservation.points - reservation.refundedPoints < points)
    pointError('退分超出原订单的实际消费。', 'REFUND_EXCEEDS_CAPTURE');
  let remaining = points;
  for (const allocation of reservation.allocations) {
    const take = Math.min(remaining, allocation.points - allocation.refundedPoints);
    if (!take) continue;
    await tx.pointLot.update({ where: { id: allocation.lotId }, data: { availablePoints: { increment: take } } });
    await tx.pointAllocation.update({ where: { id: allocation.id }, data: { refundedPoints: { increment: take } } });
    remaining -= take;
    if (!remaining) break;
  }
  if (remaining) pointError('原消费分配不完整。', 'POINTS_INVARIANT');
  await tx.pointReservation.update({ where: { id: reservationId }, data: { refundedPoints: { increment: points } } });
  return ledger(tx, reservation.accountId, 'ORDER_REFUND', businessId, points, 0, reason, actorId);
}
export async function removeCompensation(tx: Tx, account: PointAccount, points: number, businessId: string, reason: string, actorId: string) {
  pointsInteger(points);
  const lots = await tx.pointLot.findMany({ where: { accountId: account.id, source: 'COMPENSATION', availablePoints: { gt: 0 } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (lots.reduce((sum, lot) => sum + lot.availablePoints, 0) < points) pointError('只能扣减可用补偿积分，不能扣实付或冻结积分。', 'COMPENSATION_ONLY');
  let remaining = points;
  for (const lot of lots) {
    const take = Math.min(remaining, lot.availablePoints);
    await tx.pointLot.update({ where: { id: lot.id }, data: { availablePoints: { decrement: take } } });
    remaining -= take;
    if (!remaining) break;
  }
  return ledger(tx, account.id, 'COMPENSATION_REVOKE', businessId, -points, 0, reason, actorId);
}
