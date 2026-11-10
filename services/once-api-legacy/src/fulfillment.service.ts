import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Order } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DbService } from './db.service';
import { settings } from './config';
import { day, fingerprint, idempotencyKey, lockPhone, transactionOptions } from './business';
import { lockPointAccount, reservePoints, settlePoints, pointError } from './points-ledger';
import { PointsService, IntentInput } from './points.service';

export type MockScenario = 'SUCCESS' | 'FAILURE' | 'UNKNOWN_SUCCESS' | 'UNKNOWN_FAILURE';
const terminal = ['DEMO_CONFIRMED', 'CONFIRMED', 'FAILED'];
function view(order: Order) {
  return { orderId: order.id, leaseId: order.leaseId, number: order.numberSnapshot, status: order.status, term: order.termDays,
    amount: order.amountMinor / 100, points: order.pointsAmount, fundsStatus: order.fundsStatus, quoteVersion: order.quoteVersion,
    currency: order.currency, demo: order.mockScenario !== null, requestId: order.id, scenario: order.mockScenario,
    attempts: order.attempts, claimUntil: order.claimUntil, lastError: order.lastError, checkedAt: order.checkedAt,
    completedAt: order.completedAt, providerOrderId: order.providerOrderId, evidence: order.evidence };
}
@Injectable()
export class FulfillmentService {
  constructor(private readonly db: DbService, private readonly points: PointsService) {}
  private demoOnly() {
    if (!settings.demo || settings.production) throw new ForbiddenException('号码供应商尚未接入，当前仅支持隔离演示环境。');
  }
  async purchase(userId: string, input: IntentInput & { purchaseIntentId?: string }, key: unknown, scenario: MockScenario = 'SUCCESS') {
    this.demoOnly();
    const requestKey = idempotencyKey(key);
    const requestHash = fingerprint({ ...input, scenario, settlement: 'POINTS_V1' });
    return this.db.$transaction(async tx => {
      const account = await lockPointAccount(tx, userId);
      const existing = await tx.order.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: requestKey } } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ConflictException('Idempotency key was already used for a different request');
        return { ...view(existing), replayed: true };
      }
      if (input.purchaseIntentId) {
        const intent = await tx.purchaseIntent.findFirst({ where: { id: input.purchaseIntentId, userId } });
        if (!intent || intent.expiresAt <= new Date() || intent.kind !== input.kind || intent.termDays !== input.term ||
          (intent.number ?? undefined) !== input.number || (intent.leaseId ?? undefined) !== input.leaseId) pointError('购买草稿已过期或与本次选择不符。', 'INTENT_CHANGED');
        if (intent.orderId) return { ...view(await tx.order.findUniqueOrThrow({ where: { id: intent.orderId } })), replayed: true };
      }
      const plan = await this.points.quote(userId, input, tx);
      const reference = input.kind === 'RENT' ? await tx.phoneNumber.findUnique({ where: { number: input.number! } })
        : await tx.lease.findFirst({ where: { id: input.leaseId, userId } }).then(row => row ? tx.phoneNumber.findUnique({ where: { id: row.phoneNumberId } }) : null);
      if (!reference) throw new NotFoundException('号码不存在。');
      await lockPhone(tx, reference.id);
      // The quotation was checked before locking; repeat under the phone lock to prevent overselling.
      await this.points.quote(userId, input, tx);
      if (await tx.order.count({ where: { phoneNumberId: reference.id, status: { in: ['PENDING', 'PROCESSING', 'UNCERTAIN'] } } })) pointError('该号码已有处理中的订单，请等待查单结果。', 'ORDER_PENDING');
      if (input.kind === 'RENT') {
        const claimed = await tx.phoneNumber.updateMany({ where: { id: reference.id, occupied: false, holdReason: null, provider: 'demo' }, data: { occupied: true, holdReason: 'POINTS_ORDER_PENDING' } });
        if (claimed.count !== 1) throw new ConflictException('号码已被选走，请重新选择。');
      }
      const id = randomUUID();
      const reservation = await reservePoints(tx, account, plan.pointsPrice, 'ORDER', id);
      const order = await tx.order.create({ data: { id, userId, phoneNumberId: reference.id, leaseId: input.kind === 'RENEW' ? input.leaseId : undefined,
        numberSnapshot: reference.number, kind: input.kind, termDays: input.term, amountMinor: plan.priceMinor, pointsAmount: plan.pointsPrice,
        quoteVersion: plan.version, currency: plan.currency, settlementType: 'POINTS', fundsStatus: 'RESERVED', reservationId: reservation.id,
        idempotencyKey: requestKey, requestHash, mockScenario: scenario, status: 'PENDING' } });
      if (input.purchaseIntentId) await tx.purchaseIntent.update({ where: { id: input.purchaseIntentId }, data: { orderId: order.id } });
      await tx.auditLog.create({ data: { userId, action: 'POINTS_ORDER_CREATED', resourceId: order.id, details: { points: plan.pointsPrice, kind: input.kind, scenario } } });
      return { ...view(order), replayed: false };
    }, transactionOptions);
  }
  /** Compatibility simulation entry uses the same paid-in-points path; it cannot create free leases. */
  async create(userId: string, number: string, term: number, scenario: MockScenario, key: unknown) {
    const plan = await this.db.plan.findUnique({ where: { days: term } });
    if (!plan) throw new NotFoundException('套餐不存在。');
    return this.purchase(userId, { kind: 'RENT', number, term, quoteVersion: plan.version }, key, scenario);
  }
  async get(userId: string, id: string) {
    const order = await this.db.order.findFirst({ where: { id, userId } });
    if (!order) throw new NotFoundException('订单不存在。');
    return view(order);
  }
  private async claim(userId: string, id: string, reconcile: boolean) {
    return this.db.$transaction(async tx => {
      await lockPointAccount(tx, userId, false);
      let order = await tx.order.findFirst({ where: { id, userId, mockScenario: { not: null } } });
      if (!order) throw new NotFoundException('模拟订单不存在。');
      if (terminal.includes(order.status)) return { order, token: null };
      if (order.status === 'PROCESSING') {
        if (order.claimUntil && order.claimUntil > new Date()) return { order, token: null };
        order = await tx.order.update({ where: { id }, data: { status: 'UNCERTAIN', claimToken: null, claimUntil: null, lastError: 'WORKER_CLAIM_EXPIRED' } });
      }
      if (reconcile ? order.status !== 'UNCERTAIN' : order.status !== 'PENDING') return { order, token: null };
      const token = randomUUID();
      order = await tx.order.update({ where: { id }, data: { status: 'PROCESSING', claimToken: token, claimUntil: new Date(Date.now() + 30000), attempts: { increment: 1 } } });
      await tx.auditLog.create({ data: { userId, action: reconcile ? 'POINTS_FULFILLMENT_LOOKUP' : 'POINTS_FULFILLMENT_SUBMIT', resourceId: id, details: { token, requestId: id, attempt: order.attempts } } });
      return { order, token };
    }, transactionOptions);
  }
  async run(userId: string, id: string, reconcile = false) {
    this.demoOnly();
    const claim = await this.claim(userId, id, reconcile);
    if (!claim.token) return view(claim.order);
    // Local provider boundary. In a live adapter, repeat LOOKUP after an unknown result, never PURCHASE.
    const outcome = !reconcile && claim.order.mockScenario!.startsWith('UNKNOWN_') ? 'UNCERTAIN'
      : claim.order.mockScenario!.endsWith('SUCCESS') ? 'DEMO_CONFIRMED' : 'FAILED';
    const evidence = { provider: 'local-mock', requestId: id, phase: reconcile ? 'LOOKUP' : 'PURCHASE', outcome, observedAt: new Date().toISOString() };
    return this.db.$transaction(async tx => {
      await lockPointAccount(tx, userId, false);
      await lockPhone(tx, claim.order.phoneNumberId!);
      const order = await tx.order.findFirstOrThrow({ where: { id, userId } });
      if (order.status !== 'PROCESSING' || order.claimToken !== claim.token || !order.claimUntil || order.claimUntil <= new Date()) return view(order);
      const phone = await tx.phoneNumber.findUniqueOrThrow({ where: { id: order.phoneNumberId! } });
      const expectedHold = order.settlementType === 'POINTS' ? 'POINTS_ORDER_PENDING' : 'MOCK_ORDER_PENDING';
      if (order.kind === 'RENT' && (!phone.occupied || phone.holdReason !== expectedHold)) throw new ConflictException('号码预留状态需要核对。');
      let leaseId = order.leaseId;
      const now = new Date();
      if (outcome === 'DEMO_CONFIRMED') {
        if (order.kind === 'RENT') {
          const lease = await tx.lease.create({ data: { userId, phoneNumberId: phone.id, termDays: order.termDays, priceMinor: order.amountMinor,
            currency: order.currency, startedAt: now, expiresAt: new Date(now.getTime() + order.termDays * day) } });
          leaseId = lease.id;
          await tx.phoneNumber.update({ where: { id: phone.id }, data: { holdReason: null } });
          await tx.message.create({ data: { leaseId: lease.id, sender: 'ONCE 服务', title: '演示号码已准备好', body: '积分结算已完成。这是隔离演示号码，真实短信服务尚未开放。', receivedAt: now } });
        } else {
          const lease = await tx.lease.findFirst({ where: { id: order.leaseId!, userId, status: { in: ['ACTIVE', 'EXPIRED_HELD'] } } });
          if (!lease || !phone.occupied) throw new ConflictException('续费服务结果需要人工核对。');
          await tx.lease.update({ where: { id: lease.id }, data: { status: 'ACTIVE', endedAt: null, expiresAt: new Date(Math.max(lease.expiresAt.getTime(), now.getTime()) + order.termDays * day) } });
          await tx.phoneNumber.update({ where: { id: phone.id }, data: { holdReason: null } });
        }
        if (order.reservationId) await settlePoints(tx, order.reservationId, 'CAPTURED');
      } else if (outcome === 'FAILED') {
        if (order.kind === 'RENT') await tx.phoneNumber.update({ where: { id: phone.id }, data: { occupied: false, holdReason: null } });
        if (order.reservationId) await settlePoints(tx, order.reservationId, 'RELEASED');
      }
      const updated = await tx.order.update({ where: { id }, data: { status: outcome, leaseId, claimToken: null, claimUntil: null, evidence,
        fundsStatus: order.reservationId ? outcome === 'UNCERTAIN' ? 'RESERVED' : outcome === 'FAILED' ? 'RELEASED' : 'CAPTURED' : order.fundsStatus,
        checkedAt: reconcile ? now : undefined, completedAt: outcome === 'UNCERTAIN' ? null : now,
        providerOrderId: outcome === 'DEMO_CONFIRMED' ? `mock:${id}` : undefined,
        lastError: outcome === 'UNCERTAIN' ? 'MOCK_RESPONSE_LOST' : outcome === 'FAILED' ? 'MOCK_DEFINITE_FAILURE' : null } });
      await tx.auditLog.create({ data: { userId, action: 'POINTS_ORDER_' + outcome, resourceId: id, details: { evidence, fundsStatus: updated.fundsStatus } } });
      return view(updated);
    }, transactionOptions);
  }
  async recoverClaims(limit = 100) {
    if (!settings.demo || settings.production) return;
    const rows = await this.db.order.findMany({ where: { mockScenario: { not: null }, OR: [{ status: { in: ['PENDING', 'UNCERTAIN'] } }, { status: 'PROCESSING', claimUntil: { lte: new Date() } }] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit });
    for (const row of rows) {
      if (row.status === 'PROCESSING') await this.claim(row.userId, row.id, false);
      await this.run(row.userId, row.id, row.status !== 'PENDING');
    }
  }
}
