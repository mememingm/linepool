import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DbService } from './db.service';
import { settings } from './config';
import { cursorPosition, day, fingerprint, idempotencyKey, pageResult, planFor, transactionOptions } from './business';
import { grantPoints, lockPointAccount, pointsInteger, removeCompensation, reservePoints, settlePoints, refundConsumedPoints, pointError } from './points-ledger';
import { PaymentGateway, PaymentResult } from './payment.gateway';

type Tx = Prisma.TransactionClient;
export const pointRulesKey = 'points.rechargeRules';
export type RechargeRules = { enabled: boolean; minMinor: number; maxMinor: number; dailyMinor: number; presetsMinor: number[] };
const defaults: RechargeRules = { enabled: true, minMinor: 500, maxMinor: 50000, dailyMinor: 50000, presetsMinor: [500, 1000, 2000, 5000, 10000] };
const dayStart = () => new Date(Math.floor((Date.now() + 8 * 3600000) / day) * day - 8 * 3600000);
const keyOf = (userId: string, key: string) => ({ userId_idempotencyKey: { userId, idempotencyKey: key } });
export type IntentInput = { kind: 'RENT' | 'RENEW'; number?: string; leaseId?: string; term: number; quoteVersion: number };

@Injectable()
export class PointsService implements OnModuleInit {
  constructor(private readonly db: DbService, private readonly gateway: PaymentGateway) {}
  private audit(tx: Tx, input: { data: { userId?: string | null; actorId?: string; action: string; resourceId: string; details?: Prisma.InputJsonValue } }) {
    const data = input.data, actor = data.actorId ?? data.userId;
    if (!actor) throw new Error('Audit actor missing');
    const details = data.details as Record<string, Prisma.InputJsonValue> | undefined;
    return tx.auditLog.create({ data: { userId: actor, action: data.action, resourceId: data.resourceId, targetType: 'points',
      reason: typeof details?.reason === 'string' ? details.reason : '', details: data.details } });
  }
  async onModuleInit() {
    if (!settings.demo && await this.db.pointLot.count({ where: { source: 'DEMO' } }))
      throw new Error('This database contains DEMO point assets. Use a separate clean database for live payments.');
  }
  async rules(db: Pick<Tx, 'appSetting'> = this.db): Promise<RechargeRules> {
    const row = await db.appSetting.findUnique({ where: { key: pointRulesKey } });
    return row ? row.value as unknown as RechargeRules : defaults;
  }
  async config() { return { ...await this.rules(), currency: 'USD', pointsPerMinor: 1, timezone: 'Asia/Shanghai', channelAvailable: this.gateway.available, demo: settings.demo }; }
  async account(userId: string) {
    const account = await this.db.pointAccount.findUnique({ where: { userId } });
    const totals = await this.db.pointLot.groupBy({ by: ['source'], where: { account: { userId } }, _sum: { availablePoints: true, frozenPoints: true } });
    return { availablePoints: account?.availablePoints ?? 0, frozenPoints: account?.frozenPoints ?? 0, status: account?.status ?? 'ACTIVE', sources: totals.map(row => ({ source: row.source, availablePoints: row._sum.availablePoints ?? 0, frozenPoints: row._sum.frozenPoints ?? 0 })) };
  }
  async history(userId: string, kind: 'ledger' | 'recharges' | 'refunds', limit: number, cursor?: string) {
    const scope = `points:${kind}:${userId}`;
    const pos = cursorPosition(cursor, scope);
    const page = pos ? { OR: [{ createdAt: { lt: pos.time } }, { createdAt: pos.time, id: { gt: pos.id } }] } : {};
    const args = { orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }], take: limit + 1 };
    if (kind === 'ledger') {
      const rows = await this.db.pointLedger.findMany({ where: { account: { userId }, ...page }, ...args });
      return pageResult(rows, limit, scope, row => row.createdAt);
    }
    if (kind === 'refunds') {
      const rows = await this.db.refundOrder.findMany({ where: { userId, ...page }, ...args, select: { id: true, rechargeId: true, amountMinor: true, points: true, status: true, reason: true, createdAt: true, completedAt: true } });
      return pageResult(rows, limit, scope, row => row.createdAt);
    }
    const rows = await this.db.rechargeOrder.findMany({ where: { userId, ...page }, ...args });
    return pageResult(rows.map(row => this.rechargeView(row)), limit, scope, row => row.createdAt);
  }
  private rechargeView(row: Prisma.RechargeOrderGetPayload<object>) {
    return { id: row.id, amountMinor: row.amountMinor, currency: row.currency, points: row.points, status: row.status, environment: row.environment,
      refundedMinor: row.refundedMinor, refundReservedMinor: row.refundReservedMinor, purchaseIntentId: row.purchaseIntentId,
      expiresAt: row.expiresAt, paidAt: row.paidAt, creditedAt: row.creditedAt, latePayment: row.latePayment, createdAt: row.createdAt };
  }
  async quote(userId: string, input: IntentInput, db: Tx = this.db) {
    const plan = await planFor(db, input.term);
    if (plan.currency !== 'USD' || plan.pointsPrice <= 0) pointError('套餐积分价尚未配置，请联系客服。', 'POINTS_PRICE_UNAVAILABLE');
    if (input.quoteVersion !== plan.version) pointError('套餐价格已变化，请确认新价格后重新提交。', 'QUOTE_CHANGED');
    if (input.kind === 'RENT') {
      const phone = input.number ? await db.phoneNumber.findUnique({ where: { number: input.number } }) : null;
      if (!phone || phone.occupied || phone.holdReason || phone.provider !== 'demo' || !settings.demo) pointError('号码已不可用，请重新选号。', 'NUMBER_UNAVAILABLE');
    } else {
      const lease = input.leaseId ? await db.lease.findFirst({ where: { id: input.leaseId, userId }, include: { phoneNumber: true } }) : null;
      if (!lease || lease.status !== 'ACTIVE' || lease.expiresAt <= new Date() || !lease.phoneNumber.occupied || lease.phoneNumber.holdReason || lease.phoneNumber.provider !== 'demo' || !settings.demo)
        pointError('号码当前不可续费，请重新检查租约。', 'LEASE_UNAVAILABLE');
    }
    return plan;
  }
  async createIntent(userId: string, input: IntentInput) {
    return this.db.$transaction(async tx => {
      await lockPointAccount(tx, userId);
      const plan = await this.quote(userId, input, tx);
      return tx.purchaseIntent.create({ data: { userId, kind: input.kind, number: input.number, leaseId: input.leaseId, termDays: input.term,
        quoteVersion: plan.version, pointsPrice: plan.pointsPrice, expiresAt: new Date(Date.now() + day) } });
    }, transactionOptions);
  }
  async intent(userId: string, id: string) {
    const intent = await this.db.purchaseIntent.findFirst({ where: { id, userId } });
    if (!intent) throw new NotFoundException('购买草稿不存在。');
    const plan = await this.db.plan.findUnique({ where: { days: intent.termDays } });
    let availability = 'AVAILABLE';
    try { await this.quote(userId, { kind: intent.kind as IntentInput['kind'], number: intent.number ?? undefined, leaseId: intent.leaseId ?? undefined, term: intent.termDays, quoteVersion: plan?.version ?? 0 }); }
    catch { availability = 'UNAVAILABLE'; }
    return { ...intent, currentPlan: plan ? { days: plan.days, label: plan.label, pointsPrice: plan.pointsPrice, version: plan.version, active: plan.active } : null,
      priceChanged: intent.quoteVersion !== plan?.version, availability, expired: intent.expiresAt <= new Date() };
  }
  async createRecharge(userId: string, amountMinor: number, key: unknown, purchaseIntentId?: string) {
    pointsInteger(amountMinor);
    if (!this.gateway.available) throw new ForbiddenException('在线支付渠道尚未开放。');
    const requestKey = idempotencyKey(key), requestHash = fingerprint({ amountMinor, purchaseIntentId: purchaseIntentId ?? null });
    const row = await this.db.$transaction(async tx => {
      await lockPointAccount(tx, userId);
      const previous = await tx.rechargeOrder.findUnique({ where: keyOf(userId, requestKey) });
      if (previous) { if (previous.requestHash !== requestHash) pointError('请勿使用同一请求编号修改充值金额。', 'IDEMPOTENCY_CONFLICT'); return previous; }
      const rules = await this.rules(tx);
      if (!rules.enabled || amountMinor < rules.minMinor || amountMinor > rules.maxMinor) throw new BadRequestException('充值已关闭或金额超出单笔限制。');
      if (purchaseIntentId && !await tx.purchaseIntent.findFirst({ where: { id: purchaseIntentId, userId, orderId: null, expiresAt: { gt: new Date() } } })) throw new BadRequestException('购买草稿不存在或已过期。');
      // Paid today + every unclosed attempt, including expired checkouts awaiting a definite provider result.
      const exposure = await tx.rechargeOrder.aggregate({ where: { userId, OR: [{ status: { in: ['PENDING', 'CREATING', 'CHECKING', 'EXPIRED', 'PAID_UNCREDITED'] } }, { paidAt: { gte: dayStart() }, status: { in: ['PAID', 'REFUNDING', 'REFUNDED'] } }] }, _sum: { amountMinor: true } });
      if ((exposure._sum.amountMinor ?? 0) + amountMinor > rules.dailyMinor) pointError('已达到今日充值限额，待确认支付也占用额度。', 'DAILY_RECHARGE_LIMIT');
      return tx.rechargeOrder.create({ data: { userId, amountMinor, points: amountMinor, idempotencyKey: requestKey, requestHash, purchaseIntentId,
        environment: settings.demo ? 'DEMO' : 'LIVE', expiresAt: new Date(Date.now() + 30 * 60000),
        attempt: { create: { provider: this.gateway.provider, merchant: this.gateway.merchant } } } });
    }, transactionOptions);
    const attempt = await this.db.paymentAttempt.findUniqueOrThrow({ where: { rechargeId: row.id } });
    if (!attempt.externalId && row.status === 'PENDING') {
      // The recharge UUID is the channel merchant-order/idempotency key, including after a process restart.
      try {
        const checkout = await this.gateway.checkout(row);
        if (checkout.provider !== attempt.provider || checkout.merchant !== attempt.merchant) throw new Error('Channel identity mismatch');
        await this.db.paymentAttempt.updateMany({ where: { id: attempt.id, externalId: null }, data: checkout });
      } catch (error) {
        await this.db.paymentAttempt.update({ where: { id: attempt.id }, data: { lastError: error instanceof Error ? error.name : 'CheckoutError' } });
      }
    }
    return this.recharge(userId, row.id);
  }
  async recharge(userId: string, id: string) {
    const row = await this.db.rechargeOrder.findFirst({ where: { id, userId }, include: { attempt: true, lot: true } });
    if (!row) throw new NotFoundException('充值记录不存在。');
    return { ...this.rechargeView(row), checkoutUrl: row.attempt?.checkoutUrl ?? null, paymentStatus: row.attempt?.status,
      refundableMinor: row.lot ? Math.min(row.lot.availablePoints, row.amountMinor - row.refundedMinor - row.refundReservedMinor) : 0 };
  }
  async demoPay(userId: string, id: string, scenario: string) {
    if (!settings.demo || settings.production) throw new ForbiddenException('模拟支付已关闭。');
    const row = await this.db.rechargeOrder.findFirst({ where: { id, userId } });
    if (!row || row.environment !== 'DEMO') throw new NotFoundException('模拟充值单不存在。');
    const current = await this.db.paymentAttempt.findUniqueOrThrow({ where: { rechargeId: id } });
    if (current.status === 'SUBMITTED' && current.scenario !== scenario) pointError('同一模拟付款不能修改结果。', 'SCENARIO_CONFLICT');
    if (row.status === 'PAID') return this.recharge(userId, id);
    await this.db.paymentAttempt.updateMany({ where: { rechargeId: id, status: { in: ['CREATED', 'SUBMITTED'] } }, data: { status: 'SUBMITTED', scenario, checkedAt: current.checkedAt ?? new Date() } });
    if (scenario.startsWith('UNKNOWN_')) {
      await this.db.rechargeOrder.updateMany({ where: { id, status: { in: ['PENDING', 'EXPIRED'] } }, data: { status: 'CHECKING' } });
      return this.recharge(userId, id);
    }
    return this.checkRecharge(userId, id);
  }
  async checkRecharge(userId: string, id: string) {
    const claim = await this.db.$transaction(async tx => {
      await lockPointAccount(tx, userId, false);
      const row = await tx.rechargeOrder.findFirst({ where: { id, userId }, include: { attempt: true } });
      if (!row?.attempt) throw new NotFoundException('充值记录不存在。');
      if (row.attempt.claimUntil && row.attempt.claimUntil > new Date()) return null;
      const token = randomUUID();
      await tx.paymentAttempt.update({ where: { rechargeId: id }, data: { claimToken: token, claimUntil: new Date(Date.now() + 30000), attempts: { increment: 1 } } });
      return { row, token };
    }, transactionOptions);
    if (!claim) return this.recharge(userId, id);
    try {
      const result = await this.gateway.queryPayment(claim.row, claim.row.attempt!);
      if (result.status === 'PAID') await this.receiveTrustedPayment(`lookup:${result.transactionId}`, result);
      else if (result.status === 'FAILED') await this.db.$transaction(async tx => {
        await lockPointAccount(tx, userId, false);
        await tx.rechargeOrder.updateMany({ where: { id, status: { in: ['PENDING', 'CHECKING', 'EXPIRED'] } }, data: { status: 'FAILED' } });
      }, transactionOptions);
      else if (claim.row.expiresAt <= new Date()) await this.db.rechargeOrder.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    } catch (error) {
      await this.db.paymentAttempt.updateMany({ where: { rechargeId: id, claimToken: claim.token }, data: { lastError: error instanceof Error ? error.name : 'QueryError' } });
    } finally {
      await this.db.paymentAttempt.updateMany({ where: { rechargeId: id, claimToken: claim.token }, data: { claimToken: null, claimUntil: null } });
    }
    return this.recharge(userId, id);
  }
  /** INTERNAL adapter boundary. Only call after signature, merchant, replay-window and amount verification; no public callback is installed here. */
  async receiveTrustedPayment(eventId: string, result: PaymentResult) {
    const payloadHash = fingerprint(result);
    if (!eventId || eventId.length > 200 || result.provider !== this.gateway.provider || result.merchant !== this.gateway.merchant) throw new ForbiddenException('支付渠道身份不匹配。');
    const identity = { provider_merchant_eventId: { provider: result.provider, merchant: result.merchant, eventId } };
    const event = await this.db.paymentEvent.upsert({ where: identity, create: { provider: result.provider, merchant: result.merchant, eventId, payloadHash, payload: result as unknown as Prisma.InputJsonValue }, update: {} });
    if (event.payloadHash !== payloadHash) {
      await this.db.paymentEvent.update({ where: { id: event.id }, data: { conflictCount: { increment: 1 }, lastError: 'EVENT_PAYLOAD_CONFLICT' } });
      await this.exception(`event:${event.id}`, null, 'EVENT_PAYLOAD_CONFLICT', { eventId });
      throw new ConflictException('同一支付事件出现不同内容，已进入核对。');
    }
    if (event.status === 'APPLIED') return { replayed: true };
    try {
      return await this.db.$transaction(async tx => {
        const reference = await tx.rechargeOrder.findUnique({ where: { id: result.rechargeId } });
        if (!reference) throw new NotFoundException('支付未找到对应充值单。');
        const account = await lockPointAccount(tx, reference.userId, false);
        const order = await tx.rechargeOrder.findUniqueOrThrow({ where: { id: result.rechargeId }, include: { attempt: true, user: true } });
        const receiptKey = { provider_merchant_transactionId: { provider: result.provider, merchant: result.merchant, transactionId: result.transactionId ?? '' } };
        if (result.status !== 'PAID' || !result.transactionId || result.transactionId.length > 200 || result.amountMinor !== order.amountMinor || result.currency !== order.currency || !result.paidAt || !Number.isFinite(Date.parse(result.paidAt)) ||
          order.attempt?.provider !== result.provider || order.attempt?.merchant !== result.merchant || (order.environment === 'DEMO' && (!settings.demo || settings.production)) || (order.environment === 'LIVE' && result.provider === 'local-mock')) {
          await this.exception(`payment:${order.id}`, order.userId, 'PAYMENT_MISMATCH', { eventId }, tx);
          await tx.paymentEvent.update({ where: { id: event.id }, data: { status: 'REJECTED', lastError: 'PAYMENT_MISMATCH' } });
          return { rejected: true };
        }
        const existing = await tx.paymentReceipt.findUnique({ where: receiptKey });
        if (existing && existing.rechargeId !== order.id) {
          await this.exception(`receipt:${existing.id}`, order.userId, 'TRANSACTION_REUSED', { eventId, rechargeId: order.id }, tx);
          await tx.paymentEvent.update({ where: { id: event.id }, data: { status: 'REJECTED', lastError: 'TRANSACTION_REUSED' } });
          return { rejected: true };
        }
        const receipt = existing ?? await tx.paymentReceipt.create({ data: { rechargeId: order.id, provider: result.provider, merchant: result.merchant,
          transactionId: result.transactionId, amountMinor: result.amountMinor, currency: result.currency, paidAt: new Date(result.paidAt) } });
        if (!receipt.applied) {
          if (await tx.refundOrder.count({ where: { receiptId: receipt.id, kind: 'UNAPPLIED', status: { notIn: ['FAILED', 'REJECTED'] } } })) {
            await tx.paymentEvent.update({ where: { id: event.id }, data: { status: 'APPLIED', lastError: 'PAYMENT_BEING_RETURNED' } });
            return { returning: true };
          }
          if (order.creditedAt) {
            await this.exception(`extra-payment:${receipt.id}`, order.userId, 'EXCESS_PAYMENT', { receiptId: receipt.id }, tx);
            await tx.refundOrder.upsert({ where: keyOf(order.userId, `excess_${receipt.id}`), update: {}, create: { userId: order.userId, rechargeId: order.id, receiptId: receipt.id,
              kind: 'EXCESS', amountMinor: receipt.amountMinor, points: 0, status: 'REQUESTED', reason: '同一充值单额外实收，需原路退回', idempotencyKey: `excess_${receipt.id}`, requestHash: fingerprint({ receiptId: receipt.id }) } });
          } else if (account.status !== 'ACTIVE' || order.user.status !== 'ACTIVE') {
            await tx.rechargeOrder.update({ where: { id: order.id }, data: { status: 'PAID_UNCREDITED', paidAt: receipt.paidAt } });
            await this.exception(`payment:${order.id}`, order.userId, 'RESTRICTED_ACCOUNT_PAYMENT', { receiptId: receipt.id }, tx);
          } else {
            await grantPoints(tx, account, order.points, order.environment === 'DEMO' ? 'DEMO' : 'PAID', order.id, '在线充值到账', undefined, order.id);
            await tx.paymentReceipt.update({ where: { id: receipt.id }, data: { applied: true } });
            await tx.rechargeOrder.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: receipt.paidAt, creditedAt: new Date(), latePayment: order.expiresAt <= receipt.paidAt } });
            if (order.expiresAt <= receipt.paidAt) await this.exception(`late-payment:${order.id}`, order.userId, 'LATE_PAYMENT_CREDITED', { receiptId: receipt.id }, tx);
          }
        }
        await tx.paymentEvent.update({ where: { id: event.id }, data: { status: 'APPLIED', lastError: null } });
        return { applied: true };
      }, transactionOptions);
    } catch (error) {
      await this.db.paymentEvent.update({ where: { id: event.id }, data: { status: 'RETRY', lastError: error instanceof Error ? error.name : 'ApplyError' } });
      throw error;
    }
  }
  private async exception(businessKey: string, userId: string | null, kind: string, details: Prisma.InputJsonValue, tx: Pick<Tx, 'pointException'> = this.db) {
    return tx.pointException.upsert({ where: { businessKey }, create: { businessKey, userId, kind, details }, update: {} });
  }
  async requestRefund(userId: string, rechargeId: string, amountMinor: number, reason: string, key: unknown) {
    pointsInteger(amountMinor);
    const requestKey = idempotencyKey(key), requestHash = fingerprint({ rechargeId, amountMinor, reason });
    return this.db.$transaction(async tx => {
      await lockPointAccount(tx, userId, false);
      const previous = await tx.refundOrder.findUnique({ where: keyOf(userId, requestKey) });
      if (previous) { if (previous.requestHash !== requestHash) pointError('请求编号已用于其他退款。', 'IDEMPOTENCY_CONFLICT'); return previous; }
      const order = await tx.rechargeOrder.findFirst({ where: { id: rechargeId, userId }, include: { lot: true } });
      if (!order?.lot || !order.creditedAt || !['PAID', 'REFUNDING'].includes(order.status)) throw new BadRequestException('该笔充值当前不可申请退款。');
      if (amountMinor > Math.min(order.lot.availablePoints, order.amountMinor - order.refundedMinor - order.refundReservedMinor)) pointError('超出这笔充值尚未消费的金额。', 'REFUND_EXCEEDS_REMAINDER');
      if (await tx.refundOrder.count({ where: { rechargeId, status: 'REQUESTED' } })) pointError('该充值已有待审核退款，请等待处理。', 'REFUND_ALREADY_REQUESTED');
      const receipt = await tx.paymentReceipt.findFirst({ where: { rechargeId, applied: true } });
      if (!receipt) pointError('缺少原付款凭证，需人工核对。', 'MISSING_PAYMENT_RECEIPT');
      return tx.refundOrder.create({ data: { userId, rechargeId, receiptId: receipt.id, amountMinor, points: amountMinor, reason, idempotencyKey: requestKey, requestHash } });
    }, transactionOptions);
  }
  async approveRefund(actorId: string, refundId: string, reason: string, scenario = 'SUCCESS') {
    const reference = await this.db.refundOrder.findUnique({ where: { id: refundId } });
    if (!reference) throw new NotFoundException('退款单不存在。');
    await this.db.$transaction(async tx => {
      const account = await lockPointAccount(tx, reference.userId, false);
      const refund = await tx.refundOrder.findUniqueOrThrow({ where: { id: refundId } });
      if (refund.status !== 'REQUESTED') return;
      const recharge = await tx.rechargeOrder.findUniqueOrThrow({ where: { id: refund.rechargeId }, include: { lot: true } });
      if (refund.kind === 'POINTS') {
        if (!recharge.lot || refund.amountMinor > recharge.amountMinor - recharge.refundedMinor - recharge.refundReservedMinor) pointError('剩余可退本金已变化。', 'REFUND_EXCEEDS_REMAINDER');
        const reservation = await reservePoints(tx, account, refund.points, 'REFUND', refund.id, recharge.lot.id);
        await tx.refundOrder.update({ where: { id: refund.id }, data: { reservationId: reservation.id } });
        await tx.rechargeOrder.update({ where: { id: recharge.id }, data: { status: 'REFUNDING', refundReservedMinor: { increment: refund.amountMinor } } });
      }
      await tx.refundOrder.update({ where: { id: refund.id }, data: { status: 'APPROVED', actorId, adminReason: reason, scenario: settings.demo ? scenario : 'SUCCESS' } });
      await this.audit(tx, { data: { userId: refund.userId, actorId, action: 'POINTS_REFUND_APPROVED', resourceId: refund.id, details: { reason, amountMinor: refund.amountMinor } } });
    }, transactionOptions);
    return this.runRefund(refundId);
  }
  async rejectRefund(actorId: string, refundId: string, reason: string) {
    return this.db.$transaction(async tx => {
      const reference = await tx.refundOrder.findUniqueOrThrow({ where: { id: refundId } });
      await lockPointAccount(tx, reference.userId, false);
      const changed = await tx.refundOrder.updateMany({ where: { id: refundId, status: 'REQUESTED' }, data: { status: 'REJECTED', actorId, adminReason: reason, completedAt: new Date() } });
      if (changed.count) await this.audit(tx, { data: { userId: reference.userId, actorId, action: 'POINTS_REFUND_REJECTED', resourceId: refundId, details: { reason } } });
      return tx.refundOrder.findUniqueOrThrow({ where: { id: refundId } });
    }, transactionOptions);
  }
  async runRefund(id: string) {
    const claim = await this.db.$transaction(async tx => {
      const reference = await tx.refundOrder.findUniqueOrThrow({ where: { id } });
      await lockPointAccount(tx, reference.userId, false);
      let row = await tx.refundOrder.findUniqueOrThrow({ where: { id } });
      if (row.claimUntil && row.claimUntil > new Date()) return null;
      if (row.status === 'PROCESSING') row = await tx.refundOrder.update({ where: { id }, data: { status: 'UNKNOWN' } });
      if (!['APPROVED', 'UNKNOWN'].includes(row.status)) return null;
      const token = randomUUID();
      await tx.refundOrder.update({ where: { id }, data: { status: 'PROCESSING', claimToken: token, claimUntil: new Date(Date.now() + 30000), attempts: { increment: 1 } } });
      return { row, token, lookup: row.status === 'UNKNOWN' };
    }, transactionOptions);
    if (!claim) return this.db.refundOrder.findUniqueOrThrow({ where: { id } });
    let result: Awaited<ReturnType<PaymentGateway['refund']>>;
    try { result = claim.lookup ? await this.gateway.queryRefund(claim.row) : await this.gateway.refund(claim.row); }
    catch { result = { status: 'UNKNOWN' }; }
    return this.db.$transaction(async tx => {
      await lockPointAccount(tx, claim.row.userId, false);
      const row = await tx.refundOrder.findUniqueOrThrow({ where: { id } });
      if (row.claimToken !== claim.token || row.status !== 'PROCESSING' || !row.claimUntil || row.claimUntil <= new Date()) return row;
      if (result.status !== 'UNKNOWN' && row.reservationId) {
        await settlePoints(tx, row.reservationId, result.status === 'SUCCEEDED' ? 'CAPTURED' : 'RELEASED');
        const recharge = await tx.rechargeOrder.findUniqueOrThrow({ where: { id: row.rechargeId } });
        const refundedMinor = recharge.refundedMinor + (result.status === 'SUCCEEDED' ? row.amountMinor : 0);
        const reserved = recharge.refundReservedMinor - row.amountMinor;
        await tx.rechargeOrder.update({ where: { id: recharge.id }, data: { refundedMinor, refundReservedMinor: reserved,
          status: refundedMinor === recharge.amountMinor ? 'REFUNDED' : reserved > 0 ? 'REFUNDING' : 'PAID' } });
      }
      const updated = await tx.refundOrder.update({ where: { id }, data: { status: result.status, externalId: result.externalId, claimToken: null, claimUntil: null,
        completedAt: result.status === 'UNKNOWN' ? null : new Date(), lastError: result.status === 'UNKNOWN' ? 'CHANNEL_RESULT_UNKNOWN' : null } });
      await this.audit(tx, { data: { userId: row.userId, action: 'POINTS_CASH_REFUND_' + result.status, resourceId: id, details: { amountMinor: row.amountMinor } } });
      return updated;
    }, transactionOptions);
  }
  async adjust(actorId: string, userId: string, delta: number, reason: string, key: unknown) {
    pointsInteger(Math.abs(delta));
    const requestKey = idempotencyKey(key), requestHash = fingerprint({ userId, delta, reason });
    return this.db.$transaction(async tx => {
      const account = await lockPointAccount(tx, userId, false);
      const existing = await tx.adminIdempotency.findUnique({ where: { key: `points:${actorId}:${requestKey}` } });
      if (existing) { if (existing.requestHash !== requestHash) pointError('调整编号已用于其他请求。', 'IDEMPOTENCY_CONFLICT'); return existing.result; }
      const entry = delta > 0 ? await grantPoints(tx, account, delta, 'COMPENSATION', `${actorId}:${requestKey}`, reason, actorId)
        : await removeCompensation(tx, account, -delta, `${actorId}:${requestKey}`, reason, actorId);
      const result = { ledgerId: entry.id, availablePoints: entry.availableAfter };
      await tx.adminIdempotency.create({ data: { actorId, key: `points:${actorId}:${requestKey}`, requestHash, result } });
      await this.audit(tx, { data: { userId, actorId, action: 'POINTS_COMPENSATION_ADJUSTED', resourceId: entry.id, details: { delta, reason } } });
      return result;
    }, transactionOptions);
  }
  async refundConsumption(actorId: string, orderId: string, points: number, reason: string, key: unknown) {
    const requestKey = idempotencyKey(key), requestHash = fingerprint({ orderId, points, reason });
    return this.db.$transaction(async tx => {
      const reference = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      await lockPointAccount(tx, reference.userId, false);
      const previous = await tx.adminIdempotency.findUnique({ where: { key: `points:${actorId}:${requestKey}` } });
      if (previous) { if (previous.requestHash !== requestHash) pointError('请求编号已用于其他操作。', 'IDEMPOTENCY_CONFLICT'); return previous.result; }
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.settlementType !== 'POINTS' || !order.reservationId || !['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.fundsStatus)) throw new BadRequestException('该订单没有可退积分。');
      const entry = await refundConsumedPoints(tx, order.reservationId, points, `${actorId}:${requestKey}`, reason, actorId);
      const reservation = await tx.pointReservation.findUniqueOrThrow({ where: { id: order.reservationId } });
      await tx.order.update({ where: { id: orderId }, data: { fundsStatus: reservation.refundedPoints === reservation.points ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      const result = { ledgerId: entry.id, points };
      await tx.adminIdempotency.create({ data: { actorId, key: `points:${actorId}:${requestKey}`, requestHash, result } });
      await this.audit(tx, { data: { userId: order.userId, actorId, action: 'ORDER_POINTS_REFUNDED', resourceId: orderId, details: { points, reason } } });
      return result;
    }, transactionOptions);
  }
  async updateRules(actorId: string, rules: RechargeRules, reason: string) {
    if (!Number.isSafeInteger(rules.minMinor) || !Number.isSafeInteger(rules.maxMinor) || !Number.isSafeInteger(rules.dailyMinor) || rules.minMinor < 1 || rules.minMinor > rules.maxMinor || rules.maxMinor > rules.dailyMinor || rules.dailyMinor > 1_000_000_000 ||
      !rules.presetsMinor.length || rules.presetsMinor.length > 10 || rules.presetsMinor.some(value => !Number.isSafeInteger(value) || value < rules.minMinor || value > rules.maxMinor)) throw new BadRequestException('充值限额或快捷金额无效。');
    return this.db.$transaction(async tx => {
      const before = await this.rules(tx);
      await tx.appSetting.upsert({ where: { key: pointRulesKey }, create: { key: pointRulesKey, value: rules as unknown as Prisma.InputJsonValue }, update: { value: rules as unknown as Prisma.InputJsonValue } });
      await this.audit(tx, { data: { actorId, action: 'POINTS_RULES_UPDATED', resourceId: pointRulesKey, details: { reason, before, after: rules } as unknown as Prisma.InputJsonValue } });
      return rules;
    });
  }
  async adminHistory(kind: 'recharges' | 'refunds' | 'exceptions', query: { userId?: string; status?: string; limit: number; cursor?: string }) {
    const scope = `admin-points:${kind}:${query.userId ?? '*'}:${query.status ?? '*'}`;
    const pos = cursorPosition(query.cursor, scope);
    const where = { ...(query.userId ? { userId: query.userId } : {}), ...(query.status ? { status: query.status } : {}),
      ...(pos ? { OR: [{ createdAt: { lt: pos.time } }, { createdAt: pos.time, id: { gt: pos.id } }] } : {}) };
    const args = { where, orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }], take: query.limit + 1 };
    if (kind === 'exceptions') return pageResult(await this.db.pointException.findMany(args), query.limit, scope, row => row.createdAt);
    if (kind === 'refunds') return pageResult(await this.db.refundOrder.findMany({ ...args, include: { user: { select: { email: true } }, recharge: { select: { environment: true, currency: true } } } }), query.limit, scope, row => row.createdAt);
    return pageResult(await this.db.rechargeOrder.findMany({ ...args, include: { user: { select: { email: true } }, attempt: true, lot: true } }), query.limit, scope, row => row.createdAt);
  }
  async adminSummary() {
    return this.db.$transaction(async tx => {
      const balances = await tx.pointLot.groupBy({ by: ['source'], _sum: { availablePoints: true, frozenPoints: true } });
      const cash = await tx.paymentReceipt.aggregate({ where: { recharge: { environment: 'LIVE' } }, _sum: { amountMinor: true } });
      const refunds = await tx.refundOrder.aggregate({ where: { recharge: { environment: 'LIVE' }, status: 'SUCCEEDED' }, _sum: { amountMinor: true } });
      const consumption = await tx.order.aggregate({ where: { settlementType: 'POINTS', fundsStatus: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, _sum: { pointsAmount: true } });
      const returned = await tx.pointLedger.aggregate({ where: { kind: 'ORDER_REFUND' }, _sum: { availableDelta: true } });
      return { currency: 'USD', timezone: 'Asia/Shanghai', environment: settings.demo ? 'DEMO' : 'LIVE', cashReceivedMinor: cash._sum.amountMinor ?? 0,
        cashRefundedMinor: refunds._sum.amountMinor ?? 0, cashNetMinor: (cash._sum.amountMinor ?? 0) - (refunds._sum.amountMinor ?? 0),
        consumedPoints: (consumption._sum.pointsAmount ?? 0) - (returned._sum.availableDelta ?? 0), balances: balances.map(row => ({ source: row.source, availablePoints: row._sum.availablePoints ?? 0, frozenPoints: row._sum.frozenPoints ?? 0 })),
        requestedRefunds: await tx.refundOrder.count({ where: { status: 'REQUESTED' } }), unknownRefunds: await tx.refundOrder.count({ where: { status: { in: ['UNKNOWN', 'PROCESSING'] } } }),
        openExceptions: await tx.pointException.count({ where: { status: 'OPEN' } }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async reconcile(userId: string, actorId?: string, reason = '定期账户对账') {
    return this.db.$transaction(async tx => {
      const account = await lockPointAccount(tx, userId, false);
      const lot = await tx.pointLot.aggregate({ where: { accountId: account.id }, _sum: { availablePoints: true, frozenPoints: true } });
      const ledger = await tx.pointLedger.aggregate({ where: { accountId: account.id }, _sum: { availableDelta: true, frozenDelta: true }, _count: { id: true } });
      const reservations = await tx.pointReservation.aggregate({ where: { accountId: account.id, status: 'RESERVED' }, _sum: { points: true } });
      const allocations = await tx.pointAllocation.aggregate({ where: { reservation: { accountId: account.id, status: 'RESERVED' } }, _sum: { points: true } });
      const balanced = account.availablePoints === (lot._sum.availablePoints ?? 0) && account.availablePoints === (ledger._sum.availableDelta ?? 0) &&
        account.frozenPoints === (lot._sum.frozenPoints ?? 0) && account.frozenPoints === (ledger._sum.frozenDelta ?? 0) &&
        account.frozenPoints === (reservations._sum.points ?? 0) && account.frozenPoints === (allocations._sum.points ?? 0) && account.sequence === ledger._count.id;
      const details = { availablePoints: account.availablePoints, frozenPoints: account.frozenPoints, sequence: account.sequence, balanced, reason };
      await tx.pointAccount.update({ where: { id: account.id }, data: { status: balanced ? 'ACTIVE' : 'REVIEW' } });
      if (!balanced) await this.exception(`account:${account.id}`, userId, 'ACCOUNT_INVARIANT', details, tx);
      else await tx.pointException.updateMany({ where: { businessKey: `account:${account.id}`, status: 'OPEN' }, data: { status: 'RESOLVED', resolution: '重新对账一致；' + reason, actorId, resolvedAt: new Date() } });
      if (actorId || !balanced) await this.audit(tx, { data: { userId, actorId, action: 'POINTS_RECONCILED', resourceId: account.id, details } });
      return details;
    }, transactionOptions);
  }
  async returnUncredited(actorId: string, id: string, reason: string) {
    const reference = await this.db.rechargeOrder.findUniqueOrThrow({ where: { id } });
    return this.db.$transaction(async tx => {
      await lockPointAccount(tx, reference.userId, false);
      const recharge = await tx.rechargeOrder.findUniqueOrThrow({ where: { id }, include: { receipts: true } });
      if (recharge.creditedAt || !recharge.receipts.length) throw new BadRequestException('只有已收款但未入账的充值可以走此处理。');
      const rows = [];
      for (const receipt of recharge.receipts) {
        rows.push(await tx.refundOrder.upsert({ where: keyOf(recharge.userId, `unapplied_${receipt.id}`), update: {}, create: {
          userId: recharge.userId, rechargeId: id, receiptId: receipt.id, kind: 'UNAPPLIED', amountMinor: receipt.amountMinor, points: 0,
          reason, actorId, status: 'REQUESTED', idempotencyKey: `unapplied_${receipt.id}`, requestHash: fingerprint({ receiptId: receipt.id }) } }));
      }
      await this.audit(tx, { data: { userId: recharge.userId, actorId, action: 'UNCREDITED_RETURN_REQUESTED', resourceId: id, details: { reason } } });
      return rows;
    }, transactionOptions);
  }
  async resolveException(actorId: string, id: string, reason: string) {
    const row = await this.db.pointException.findUniqueOrThrow({ where: { id } });
    if (row.status === 'RESOLVED') return row;
    if (row.kind === 'ACCOUNT_INVARIANT') {
      if (!row.userId || !(await this.reconcile(row.userId, actorId, reason)).balanced) pointError('账户仍不平衡，不能关闭异常。', 'UNRESOLVED_ACCOUNT');
    } else if (['EXCESS_PAYMENT', 'RESTRICTED_ACCOUNT_PAYMENT'].includes(row.kind)) {
      const details = row.details as { receiptId?: string };
      if (!details.receiptId || !await this.db.refundOrder.findFirst({ where: { receiptId: details.receiptId, status: 'SUCCEEDED' } })) pointError('该笔实收尚未退回，不能关闭异常。', 'UNRESOLVED_PAYMENT');
    }
    return this.db.$transaction(async tx => {
      const result = await tx.pointException.update({ where: { id }, data: { status: 'RESOLVED', actorId, resolution: reason, resolvedAt: new Date() } });
      await this.audit(tx, { data: { userId: row.userId, actorId, action: 'POINTS_EXCEPTION_RESOLVED', resourceId: id, details: { reason } } });
      return result;
    });
  }
  async recover(limit = 50) {
    if (!this.gateway.available) return;
    const events = await this.db.paymentEvent.findMany({ where: { status: { in: ['RECEIVED', 'RETRY'] } }, orderBy: { createdAt: 'asc' }, take: limit });
    for (const event of events) { try { await this.receiveTrustedPayment(event.eventId, event.payload as unknown as PaymentResult); } catch { /* durable event remains retryable */ } }
    const recharges = await this.db.rechargeOrder.findMany({ where: { status: { in: ['PENDING', 'CHECKING', 'EXPIRED'] } }, orderBy: { createdAt: 'asc' }, take: limit });
    for (const row of recharges) await this.checkRecharge(row.userId, row.id);
    const refunds = await this.db.refundOrder.findMany({ where: { status: { in: ['APPROVED', 'UNKNOWN', 'PROCESSING'] } }, orderBy: { createdAt: 'asc' }, take: limit });
    for (const row of refunds) await this.runRefund(row.id);
  }
}
