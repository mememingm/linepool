import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { calculateRechargePoints, rechargeRulesSchema, type RechargeSettings } from '@linepool/contracts';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';
import { Recharge } from '../recharge.js';
import { compensatePoints, lockPointAccount, refundOrderPoints } from '../points-wallet.js';
import { OncePurchaseIntents } from './purchase-intents.js';
import { OnceMockPayment, onceRechargeFields, onceRechargeView, type OnceRechargeRow } from './mock-payment.js';
import { OncePointExceptions } from './point-exceptions.js';
import { OnceRefundHistory, refundHistoryFields } from './refund-history.js';
import { adminPointReplay, pointAudit, pointKey, pointPage, pointPagePosition, pointReason, requirePointUser, saveAdminPointResult,
  type PaymentScenario, type PointHistoryQuery, type PointIntentInput } from './point-support.js';

const ledgerFields = `r.id,r.type,r.type AS kind,r.delta,r.balance_after AS "balanceAfter",r.frozen_delta AS "frozenDelta",
  r.frozen_after AS "frozenAfter",r.description,r.reference_id AS "referenceId",r.reservation_id AS "reservationId",
  r.recharge_order_id AS "rechargeOrderId",r.business_id AS "businessId",r.sequence::text,r.created_at AS "createdAt"`;
type OnceRulesInput = {
  enabled: boolean; minMinor: number; maxMinor: number; dailyMinor: number; presetsMinor: number[];
  currency?: string; fractionDigits?: number; exchangeAmountMinor?: number; exchangePoints?: number;
};

@Injectable()
export class OncePoints {
  constructor(private readonly db: Database, private readonly rechargeService: Recharge,
    private readonly intents: OncePurchaseIntents, private readonly payment: OnceMockPayment,
    private readonly exceptions: OncePointExceptions, private readonly refunds: OnceRefundHistory,
    private readonly environment: Environment) {}
  private requireSite() {
    if (this.environment.siteId !== 'once') throw new ApiFailure(404, 'ONCE_UNAVAILABLE', 'Once is not enabled on this site');
  }
  private configView(settings: RechargeSettings) {
    const rules = settings.rules;
    return { ...(rules ?? {}), minMinor: rules?.minimumMinor ?? null, maxMinor: rules?.maximumMinor ?? null,
      enabled: rules?.enabled ?? false, configured: rules !== null, rules, version: settings.version,
      currency: rules?.currency ?? null, fractionDigits: rules?.fractionDigits ?? null,
      dailyMinor: rules?.dailyMinor ?? null, presetsMinor: rules?.presetsMinor ?? [],
      exchangeAmountMinor: rules?.exchangeAmountMinor ?? null, exchangePoints: rules?.exchangePoints ?? null,
      pointsPerMinor: rules?.exchangeAmountMinor && rules.exchangePoints ? rules.exchangePoints / rules.exchangeAmountMinor : null,
      timezone: 'Asia/Shanghai', dailyQuotaCurrency: rules?.currency ?? null, channelAvailable: this.payment.enabled && Boolean(rules?.enabled), demo: true,
      sourceBreakdownAvailable: false, sources: null, cashRefundAvailable: false, refundableMinor: null,
      source: settings.source, updatedAt: settings.updatedAt, updatedBy: settings.updatedBy };
  }
  async config() { this.requireSite(); return this.configView(await this.rechargeService.settings('once')); }
  async account(userId: string) {
    this.requireSite();
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await requirePointUser(client, userId);
      const { rows: [row] } = await client.query(`SELECT id,available_points AS "availablePoints",frozen_points AS "frozenPoints",status FROM point_accounts WHERE user_id=$1`, [userId]);
      if (!row) throw new ApiFailure(404, 'POINT_ACCOUNT_NOT_FOUND', 'Point account was not found');
      return { ...row, sourceBreakdownAvailable: false, sources: null, cashRefundAvailable: false, refundableMinor: null };
    });
  }
  async history(userId: string, kind: 'ledger' | 'recharges' | 'refunds', limit = 50, cursor?: string) {
    return this.readHistory(kind, { userId, limit, cursor }, false);
  }
  private async readHistory(kind: 'ledger' | 'recharges' | 'refunds' | 'exceptions', query: PointHistoryQuery, admin: boolean) {
    this.requireSite();
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ApiFailure(400, 'INVALID_HISTORY_LIMIT', 'History limit must be 1–200');
    if (query.status && ((kind === 'exceptions' && !['OPEN','RESOLVED'].includes(query.status))
      || (kind === 'refunds' && !['SUCCEEDED','FAILED','REJECTED'].includes(query.status))
      || (kind === 'recharges' && !['PENDING','SUCCEEDED','FAILED','EXPIRED','CANCELLED','CHECKING','PAID_UNCREDITED','PAID','REFUNDING','REFUNDED'].includes(query.status)))) {
      throw new ApiFailure(400, 'INVALID_HISTORY_STATUS', 'Status is invalid for this history');
    }
    const scope = `once-points:${admin ? 'admin' : 'user'}:${kind}:${query.userId ?? '*'}:${query.status ?? ''}`;
    const pos = pointPagePosition(query.cursor, scope), values: unknown[] = [];
    const clauses: string[] = [];
    const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replaceAll('?', `$${values.length}`)); };
    const from = kind === 'ledger' ? 'point_ledger r' : kind === 'recharges' ? 'recharge_orders r' : kind === 'refunds'
      ? 'refund_orders r JOIN recharge_orders c ON c.id=r.recharge_order_id' : 'point_exceptions r';
    if (kind === 'recharges') clauses.push("r.sales_storefront_id='once'");
    if (kind === 'refunds') clauses.push("c.sales_storefront_id='once'");
    if (query.userId) add('r.user_id=?', query.userId);
    if (query.status && kind !== 'ledger') add('r.status=?', query.status);
    if (pos) { values.push(pos.time, pos.id); clauses.push(`(r.created_at<$${values.length - 1}::timestamptz OR (r.created_at=$${values.length - 1}::timestamptz AND r.id>$${values.length}::uuid))`); }
    const fields = kind === 'ledger' ? ledgerFields : kind === 'recharges' ? onceRechargeFields : kind === 'refunds' ? refundHistoryFields
      : `r.id,r.user_id AS "userId",r.recharge_order_id AS "rechargeOrderId",r.kind,r.status,r.details,r.reason,r.resolved_by AS "resolvedBy",r.created_at AS "createdAt",r.updated_at AS "updatedAt",r.resolved_at AS "resolvedAt"`;
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (query.userId) await requirePointUser(client, query.userId);
      const { rows } = await client.query(`SELECT ${fields},r.created_at::text AS "cursorTime" FROM ${from}
        WHERE ${clauses.join(' AND ') || 'true'} ORDER BY r.created_at DESC,r.id ASC LIMIT $${values.length + 1}`, [...values, limit + 1]);
      const items = kind === 'recharges' ? rows.map(row => ({ ...onceRechargeView(row as OnceRechargeRow), cursorTime: row.cursorTime as string }))
        : rows as { id: string; createdAt: Date; cursorTime: string }[];
      return pointPage(items, limit, scope);
    });
  }
  createIntent(userId: string, input: PointIntentInput) { this.requireSite(); return this.intents.create(userId, input); }
  intent(userId: string, id: string) { this.requireSite(); return this.intents.get(userId, id); }
  async createRecharge(userId: string, amountMinor: number, key: string, purchaseIntentId?: string) {
    this.requireSite(); pointKey(key);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new ApiFailure(400, 'RECHARGE_AMOUNT_INVALID', 'Recharge amount must be a positive safe integer');
    const payload = { amountMinor, purchaseIntentId: purchaseIntentId ?? null, salesStorefrontId: 'once' };
    const id = await this.db.transaction(async client => {
      // Replays return accepted facts before mutable policy, intent, account-status or quote checks.
      const account = await lockPointAccount(client, userId, true);
      const { rows: [prior] } = await client.query<{ id: string; same: boolean }>(`SELECT id,request_payload=$3::jsonb AND sales_storefront_id='once' AS same FROM recharge_orders WHERE user_id=$1 AND idempotency_key=$2`, [userId, key, JSON.stringify(payload)]);
      if (prior) { if (!prior.same) throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Recharge request key was already used with different parameters'); return prior.id; }
      this.payment.requireEnabled();
      const { rows: [user] } = await client.query<{ account_status: string }>('SELECT account_status FROM users WHERE id=$1', [userId]);
      if (account.status !== 'ACTIVE' || user!.account_status !== 'ACTIVE') throw new ApiFailure(403, 'ACCOUNT_RESTRICTED', 'Point account is restricted');
      await client.query('SELECT pg_advisory_xact_lock(734102613)');
      const { rows: [settings] } = await client.query<{ rules: unknown; version: number }>("SELECT rules,version FROM recharge_settings WHERE storefront_id='once' FOR SHARE");
      const parsed = rechargeRulesSchema.safeParse(settings?.rules);
      if (!parsed.success || !parsed.data.dailyMinor || !parsed.data.exchangeAmountMinor || !parsed.data.exchangePoints) {
        throw new ApiFailure(409, 'RECHARGE_NOT_CONFIGURED', 'Once recharge requires explicit currency, precision, exchange and daily limit rules');
      }
      const rules = parsed.data;
      if (!rules.enabled) throw new ApiFailure(409, 'RECHARGE_DISABLED', 'Once recharge is disabled');
      const converted = calculateRechargePoints(amountMinor, rules);
      if (converted.error) throw new ApiFailure(400, 'RECHARGE_AMOUNT_INVALID', `Recharge amount cannot be converted: ${converted.error}`);
      if (purchaseIntentId) await this.intents.validateForRecharge(client, userId, purchaseIntentId);
      const { rows: [exposure] } = await client.query<{ total: string }>(`SELECT coalesce(sum(amount_minor::numeric*power(10::numeric,6-fraction_digits)),0)::numeric(50,0)::text AS total
        FROM recharge_orders WHERE user_id=$1 AND sales_storefront_id='once' AND currency=$2 AND
        (status IN ('PENDING','CHECKING','EXPIRED','PAID_UNCREDITED') OR (paid_at >= (date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')
          AND status IN ('SUCCEEDED','PAID','REFUNDING','REFUNDED')))`, [userId, rules.currency]);
      const scale = 10n ** BigInt(6 - rules.fractionDigits);
      if (BigInt(exposure!.total) + BigInt(amountMinor) * scale > BigInt(rules.dailyMinor!) * scale) throw new ApiFailure(409, 'DAILY_RECHARGE_LIMIT', 'Daily recharge limit includes unresolved and expired payments in the configured currency');
      const snapshot = { kind: 'RULES', rulesVersion: settings!.version, exchangeAmountMinor: rules.exchangeAmountMinor,
        exchangePoints: rules.exchangePoints, currency: rules.currency, fractionDigits: rules.fractionDigits };
      const rechargeId = randomUUID();
      await client.query(`INSERT INTO recharge_orders(id,order_number,user_id,currency,fraction_digits,amount_minor,points,payment_method,idempotency_key,request_payload,conversion_snapshot,sales_storefront_id,purchase_intent_id,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'MOCK',$8,$9::jsonb,$10::jsonb,'once',$11,now()+interval '30 minutes')`,
      [rechargeId, `ONCE-R-${rechargeId.toUpperCase()}`, userId, rules.currency, rules.fractionDigits, amountMinor, converted.points, key, JSON.stringify(payload), JSON.stringify(snapshot), purchaseIntentId ?? null]);
      return rechargeId;
    });
    return this.recharge(userId, id);
  }
  recharge(userId: string, id: string) { this.requireSite(); return this.payment.detail(userId, id); }
  checkRecharge(userId: string, id: string) { this.requireSite(); return this.payment.check(userId, id); }
  demoPay(userId: string, id: string, scenario: PaymentScenario) { this.requireSite(); return this.payment.accept(userId, id, scenario); }
  async adminSummary() {
    this.requireSite();
    const [wallets, recharges, exceptions, refunds] = await Promise.all([
      this.db.query(`SELECT count(*)::int AS accounts,coalesce(sum(a.available_points::bigint),0)::text AS "availablePoints",
        coalesce(sum(a.frozen_points::bigint),0)::text AS "frozenPoints",count(*) FILTER(WHERE a.status='REVIEW')::int AS restricted
        FROM point_accounts a JOIN users u ON u.id=a.user_id WHERE u.auth_kind='LOCAL'`),
      this.db.query(`SELECT currency,fraction_digits AS "fractionDigits",payment_method AS "paymentMethod",
        CASE WHEN payment_method='MOCK' THEN 'DEMO' ELSE 'HISTORICAL' END AS environment,status,count(*)::int AS count,
        sum(amount_minor)::text AS "amountMinor",sum(points::bigint)::text AS points FROM recharge_orders
        WHERE sales_storefront_id='once' GROUP BY currency,fraction_digits,payment_method,status ORDER BY currency,fraction_digits,payment_method,status`),
      this.db.query("SELECT kind,count(*)::int AS count FROM point_exceptions WHERE status='OPEN' GROUP BY kind ORDER BY kind"), this.refunds.totals()]);
    return { walletScope: 'SITE_SELF_SERVICE', siteId: this.environment.siteId, wallets: wallets.rows[0], recharges: recharges.rows, exceptions: exceptions.rows,
      refunds, revenueAvailable: false, receivedMinor: null, mockAmountsAreRevenue: false, sourceBreakdownAvailable: false, cashRefundAvailable: false, refundableMinor: null };
  }
  async updateRules(actorId: string, rules: OnceRulesInput, reason: string, expectedVersion: number | undefined, key: string) {
    this.requireSite(); reason = pointReason(reason); pointKey(key);
    const action = 'ONCE_RECHARGE_SETTINGS', payload = { action, targetId: 'once', actorId, reason, rules, expectedVersion: expectedVersion ?? null };
    return this.db.transaction(async client => {
      const prior = await adminPointReplay(client, actorId, action, key, payload); if (prior) return prior.result;
      await client.query('SELECT pg_advisory_xact_lock(734102613)');
      const { rows: [current] } = await client.query<{ rules: unknown; version: number }>("SELECT rules,version FROM recharge_settings WHERE storefront_id='once' FOR SHARE");
      const oldRules = current?.rules == null ? null : rechargeRulesSchema.parse(current.rules);
      const currency = rules.currency ?? oldRules?.currency, fractionDigits = rules.fractionDigits ?? oldRules?.fractionDigits;
      const exchangeAmountMinor = rules.exchangeAmountMinor ?? oldRules?.exchangeAmountMinor;
      const exchangePoints = rules.exchangePoints ?? oldRules?.exchangePoints;
      if (currency === undefined || fractionDigits === undefined || exchangeAmountMinor == null || exchangePoints == null) {
        throw new ApiFailure(400, 'RECHARGE_POLICY_REQUIRED', 'Initial Once configuration requires explicit currency, fractionDigits, exchangeAmountMinor and exchangePoints');
      }
      const result = rechargeRulesSchema.safeParse({ enabled: rules.enabled, dailyMinor: rules.dailyMinor,
        minimumMinor: rules.minMinor, maximumMinor: rules.maxMinor, presetsMinor: rules.presetsMinor,
        currency, fractionDigits, exchangeAmountMinor, exchangePoints });
      if (!result.success || !Number.isSafeInteger(rules.dailyMinor) || rules.dailyMinor <= 0) throw new ApiFailure(400, 'RECHARGE_POLICY_INVALID', 'Recharge range, presets, exchange and daily limit must be consistent');
      const saved = await this.rechargeService.saveSettingsInTransaction(client, actorId,
        { rules: result.data, reason, expectedVersion: expectedVersion ?? current?.version ?? 0 }, 'once');
      const view = this.configView(saved);
      await saveAdminPointResult(client, actorId, action, key, 'once', payload, view);
      return view;
    });
  }
  adminHistory(kind: 'recharges' | 'refunds' | 'exceptions', query: PointHistoryQuery) { return this.readHistory(kind, query, true); }
  async adjust(actorId: string, userId: string, delta: number, reason: string, key: string) {
    this.requireSite();
    if (delta < 0) throw new ApiFailure(409, 'COMPENSATION_WITHDRAWAL_DISABLED', 'Compensation withdrawal requires source funding and is unavailable');
    if (!Number.isInteger(delta) || delta <= 0 || delta > 2147483647) throw new ApiFailure(400, 'INVALID_POINTS', 'Adjustment must be a positive supported integer');
    reason = pointReason(reason); pointKey(key);
    const action = 'ONCE_POINTS_ADJUST', payload = { action, targetId: userId, delta, reason, actorId };
    return this.db.transaction(async client => {
      const prior = await adminPointReplay(client, actorId, action, key, payload); if (prior) return prior.result;
      const account = await lockPointAccount(client, userId, true);
      const entry = await compensatePoints(client, account, { points: delta, actorId, reason, businessId: randomUUID() });
      const result = { ...entry, availablePoints: entry.balance_after, frozenPoints: entry.frozen_after };
      await saveAdminPointResult(client, actorId, action, key, userId, payload, result);
      await pointAudit(client, actorId, action, userId, reason, result); return result;
    });
  }
  async refundConsumption(actorId: string, orderId: string, points: number, reason: string, key: string) {
    this.requireSite(); reason = pointReason(reason); pointKey(key);
    const action = 'ONCE_ORDER_POINTS_REFUND', payload = { action, targetId: orderId, points, reason, actorId };
    return this.db.transaction(async client => {
      const prior = await adminPointReplay(client, actorId, action, key, payload); if (prior) return prior.result;
      const { rows: [owner] } = await client.query<{ user_id: string }>("SELECT user_id FROM orders WHERE id=$1 AND sales_storefront_id='once' AND product_type='NUMBER_LEASE'", [orderId]);
      if (!owner) throw new ApiFailure(404, 'ORDER_NOT_FOUND', 'Once order was not found');
      const account = await lockPointAccount(client, owner.user_id, true);
      const { rows: [order] } = await client.query<{ point_reservation_id: string | null; settlement_type: string }>('SELECT point_reservation_id,settlement_type FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      if (!order?.point_reservation_id || order.settlement_type !== 'POINTS') throw new ApiFailure(409, 'ORDER_NOT_REFUNDABLE', 'Only a funded captured order supports consumption refunds');
      const entry = await refundOrderPoints(client, account, { reservationId: order.point_reservation_id, points, businessId: randomUUID(), description: reason, actorId });
      const result = { ...entry, orderId, refundedPoints: points };
      await saveAdminPointResult(client, actorId, action, key, orderId, payload, result);
      await pointAudit(client, actorId, action, orderId, reason, result); return result;
    });
  }
  reconcile(userId: string, actorId: string, reason: string, key: string) { this.requireSite(); return this.exceptions.reconcile(userId, actorId, reason, key); }
  resolveException(actorId: string, id: string, reason: string, key: string) { this.requireSite(); return this.exceptions.resolve(actorId, id, reason, key); }
}
