import { randomUUID } from 'node:crypto';
import { Controller, Get, Injectable, Post, Body, Req, UseGuards, Query } from '@nestjs/common';
import { calculateRechargePoints, createRechargeOrderInputSchema, rechargeQuerySchema, rechargeRulesSchema, type AdminRechargeQuery, type CreateRechargeOrderInput, type RechargeOverview, type RechargeQuery, type RechargeSettings, type RechargeSettingsInput } from '@linepool/contracts';
import { SessionGuard, type SessionRequest } from './authentication.js';
import { Database } from './database.js';
import { Environment } from './environment.js';
import { ApiFailure, SchemaPipe } from './http.js';
import { pagination, Workspace } from './workspace.js';
import { creditPoints, lockPointAccount, type WalletClient } from './points-wallet.js';

const recordFields = `r.id,r.order_number AS "orderNumber",r.currency,r.fraction_digits AS "fractionDigits",
  r.amount_minor::float8 AS "amountMinor",r.points,r.status,r.payment_method AS "paymentMethod",
  r.created_at AS "createdAt",r.paid_at AS "paidAt",r.credited_at AS "creditedAt"`;
type SettingsRow = { rules: unknown; version: number; updated_at: Date; updated_by: string | null };

type CreditInput = { providerTransactionId: string; amountMinor: number; currency: string; paidAt?: string };
@Injectable()
export class Recharge {
  constructor(private readonly workspace: Workspace, private readonly environment: Environment, private readonly db: Database) {}
  private site(storefrontId = this.environment.siteId) {
    if (storefrontId !== this.environment.siteId) throw new ApiFailure(404, 'STOREFRONT_NOT_FOUND', 'Storefront is not available on this site');
    return storefrontId;
  }
  async settings(storefrontId = this.environment.siteId): Promise<RechargeSettings> {
    storefrontId = this.site(storefrontId);
    const { rows: [row] } = await this.db.query<SettingsRow>(`SELECT s.rules,s.version,s.updated_at,u.display_name AS updated_by
      FROM recharge_settings s LEFT JOIN users u ON u.id=s.updated_by WHERE s.storefront_id=$1`, [storefrontId]);
    if (row) return { rules: row.rules === null ? null : rechargeRulesSchema.parse(row.rules), version: row.version,
      source: 'database', updatedAt: row.updated_at.toISOString(), updatedBy: row.updated_by };
    const rules = storefrontId === 'linepool' ? this.environment.values.RECHARGE_RULES : null;
    return { rules, version: 0, source: rules ? 'environment' : 'unconfigured', updatedAt: null, updatedBy: null };
  }
  async saveSettings(actorId: string, input: RechargeSettingsInput, storefrontId = this.environment.siteId): Promise<RechargeSettings> {
    return this.db.transaction(client => this.saveSettingsInTransaction(client, actorId, input, storefrontId));
  }
  async saveSettingsInTransaction(client: WalletClient, actorId: string, input: RechargeSettingsInput,
    storefrontId = this.environment.siteId): Promise<RechargeSettings> {
    storefrontId = this.site(storefrontId);
    if (storefrontId === 'once' && input.rules !== null && !input.rules.dailyMinor) {
      throw new ApiFailure(400, 'RECHARGE_POLICY_INVALID', 'Once recharge requires a positive daily limit');
    }
    await client.query('SELECT pg_advisory_xact_lock(734102613)');
    const { rows: [before] } = await client.query<SettingsRow>('SELECT rules,version,updated_at,updated_by FROM recharge_settings WHERE storefront_id=$1', [storefrontId]);
    if ((before?.version ?? 0) !== input.expectedVersion) throw new ApiFailure(409, 'RECHARGE_SETTINGS_CHANGED', 'Recharge settings changed; refresh before saving');
    const { rows: [after] } = await client.query<SettingsRow>(`INSERT INTO recharge_settings(storefront_id,rules,version,updated_by)
      VALUES($1,$2,1,$3) ON CONFLICT(storefront_id) DO UPDATE SET rules=excluded.rules,version=recharge_settings.version+1,
      updated_by=excluded.updated_by,updated_at=now() RETURNING rules,version,updated_at,updated_by`, [storefrontId, input.rules, actorId]);
    await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)`,
      [actorId, storefrontId === 'once' ? 'ONCE_RECHARGE_SETTINGS' : 'RECHARGE_SETTINGS', storefrontId, input.reason,
        before ? { rules: before.rules, version: before.version } : { rules: storefrontId === 'linepool' ? this.environment.values.RECHARGE_RULES : null, version: 0 },
        { rules: after!.rules, version: after!.version }]);
    const { rows: [actor] } = await client.query<{ display_name: string }>('SELECT display_name FROM users WHERE id=$1', [actorId]);
    return { rules: input.rules, version: after!.version, source: 'database', updatedAt: after!.updated_at.toISOString(), updatedBy: actor!.display_name };
  }
  async records(input: RechargeQuery | AdminRechargeQuery, userId: string | undefined, admin = false, storefrontId = this.environment.siteId) {
    const values: unknown[] = [this.site(storefrontId)]; const clauses = ['r.sales_storefront_id=$1'];
    const add = (clause: string, value: unknown) => { values.push(value); clauses.push(clause.replaceAll('?', `$${values.length}`)); };
    if (!admin && !userId) throw new ApiFailure(401, 'AUTH_REQUIRED', 'Authentication required');
    if (userId) add('r.user_id=?', userId);
    if (input.status) add('r.status=?', input.status);
    if (input.search) {
      const search = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`;
      if (admin) add('(r.order_number ILIKE ? OR u.email ILIKE ? OR u.display_name ILIKE ? OR r.provider_transaction_id ILIKE ?)', search);
      else add('r.order_number ILIKE ?', search);
    }
    const where = clauses.join(' AND '); const from = 'FROM recharge_orders r JOIN users u ON u.id=r.user_id';
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { rows: [count] } = await client.query<{ total: number }>(`SELECT count(*)::int AS total ${from} WHERE ${where}`, values);
      const fields = recordFields + (admin ? ',r.user_id AS "userId",u.display_name AS "ownerName",u.email,r.provider_transaction_id AS "providerTransactionId"' : '');
      const { rows } = await client.query(`SELECT ${fields} ${from} WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, input.pageSize, (input.page - 1) * input.pageSize]);
      return { data: rows, pagination: pagination(input, count!.total) };
    });
  }
  async overview(userId: string): Promise<RechargeOverview> {
    const [account, settings] = await Promise.all([this.workspace.account(userId), this.settings()]);
    return { pointsBalance: account.pointsBalance, rules: settings.rules, paymentStatus: 'not_connected', paymentMethods: [] };
  }

  async createOrder(userId: string, input: CreateRechargeOrderInput) {
    if (this.environment.siteId !== 'linepool') throw new ApiFailure(409, 'ONCE_RECHARGE_REQUIRED', 'Use this site’s Once recharge checkout');
    const parsed = createRechargeOrderInputSchema.parse(input);
    const requestPayload = { amountMinor: parsed.amountMinor, paymentMethod: parsed.paymentMethod ?? null };
    return this.db.transaction(async client => {
      const account = await lockPointAccount(client, userId, true);
      const { rows: [existing] } = await client.query<{ id: string; order_number: string; status: string; same_request: boolean }>(
        'SELECT id,order_number,status,request_payload=$3::jsonb AND sales_storefront_id=$4 AS same_request FROM recharge_orders WHERE user_id=$1 AND idempotency_key=$2 FOR SHARE',
        [userId, parsed.idempotencyKey, requestPayload, this.environment.siteId]);
      if (existing) {
        if (!existing.same_request) {
          throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different recharge request');
        }
        return { id: existing.id, orderNumber: existing.order_number, status: existing.status, paymentStatus: 'not_connected' as const };
      }
      const { rows: [user] } = await client.query<{ account_status: string }>('SELECT account_status FROM users WHERE id=$1', [userId]);
      if (account.status !== 'ACTIVE' || user!.account_status !== 'ACTIVE') throw new ApiFailure(403, 'ACCOUNT_RESTRICTED', 'Point account is restricted');
      await client.query('SELECT pg_advisory_xact_lock(734102613)');
      const { rows: [settings] } = await client.query<SettingsRow>('SELECT rules,version,updated_at,updated_by FROM recharge_settings WHERE storefront_id=$1 FOR SHARE', [this.environment.siteId]);
      const rules = settings ? (settings.rules === null ? null : rechargeRulesSchema.parse(settings.rules)) : this.environment.values.RECHARGE_RULES;
      if (!rules) throw new ApiFailure(409, 'RECHARGE_NOT_CONFIGURED', 'Recharge rules are not configured');
      if (!rules.enabled) throw new ApiFailure(409, 'RECHARGE_DISABLED', 'Recharge is disabled');
      const converted = calculateRechargePoints(parsed.amountMinor, rules);
      if (converted.error) throw new ApiFailure(400, 'RECHARGE_AMOUNT_INVALID', `Recharge amount cannot be converted: ${converted.error}`);
      const conversionSnapshot = { kind: 'RULES', rulesVersion: settings?.version ?? 0,
        exchangeAmountMinor: rules.exchangeAmountMinor, exchangePoints: rules.exchangePoints,
        currency: rules.currency, fractionDigits: rules.fractionDigits };
      const { rows: [row] } = await client.query<{ id: string; order_number: string }>(`INSERT INTO recharge_orders(order_number,user_id,currency,fraction_digits,amount_minor,points,payment_method,idempotency_key,request_payload,conversion_snapshot,sales_storefront_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,order_number`, [`LP-R-${randomUUID().toUpperCase()}`, userId, rules.currency,
        rules.fractionDigits, parsed.amountMinor, converted.points, requestPayload.paymentMethod, parsed.idempotencyKey, requestPayload, conversionSnapshot, this.environment.siteId]);
      return { id: row!.id, orderNumber: row!.order_number, status: 'PENDING' as const, paymentStatus: 'not_connected' as const };
    });
  }

  /** Payment provider callback boundary: caller must verify signature externally before invoking this transaction. */
  async creditVerified(orderId: string, input: CreditInput) {
    if (typeof input.providerTransactionId !== 'string' || !input.providerTransactionId.trim()) throw new ApiFailure(400, 'PAYMENT_TRANSACTION_REQUIRED', 'A provider transaction ID is required');
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !/^[A-Z]{3}$/.test(input.currency)
      || (input.paidAt !== undefined && !Number.isFinite(Date.parse(input.paidAt)))) throw new ApiFailure(400, 'PAYMENT_EVIDENCE_INVALID', 'Payment amount, currency and paid time must be valid');
    return this.db.transaction(async client => {
      const { rows: [owner] } = await client.query<{ user_id: string }>('SELECT user_id FROM recharge_orders WHERE id=$1 AND sales_storefront_id=$2', [orderId, this.environment.siteId]);
      if (!owner) throw new ApiFailure(404, 'RECHARGE_ORDER_NOT_FOUND', 'Recharge order not found');
      const account = await lockPointAccount(client, owner.user_id, true);
      const { rows: [order] } = await client.query<{ id: string; user_id: string; currency: string; amount_minor: number; points: number; status: string; provider_transaction_id: string | null; points_ledger_id: string | null }>(
        'SELECT id,user_id,currency,amount_minor::float8,points,status,provider_transaction_id,points_ledger_id FROM recharge_orders WHERE id=$1 FOR UPDATE', [orderId]);
      if (!order) throw new ApiFailure(404, 'RECHARGE_ORDER_NOT_FOUND', 'Recharge order not found');
      if (order.user_id !== account.user_id) throw new ApiFailure(409, 'RECHARGE_OWNER_MISMATCH', 'Recharge owner changed');
      if (order.currency !== input.currency || order.amount_minor !== input.amountMinor) throw new ApiFailure(409, 'PAYMENT_AMOUNT_MISMATCH', 'Payment amount or currency does not match the order');
      if ((order.provider_transaction_id !== null || order.status === 'SUCCEEDED') && order.provider_transaction_id !== input.providerTransactionId) {
        throw new ApiFailure(409, 'PAYMENT_TRANSACTION_MISMATCH', 'Payment transaction does not match the order');
      }
      const { rows: [duplicate] } = await client.query<{ id: string }>('SELECT id FROM recharge_orders WHERE provider_transaction_id=$1', [input.providerTransactionId]);
      if (duplicate && duplicate.id !== orderId) throw new ApiFailure(409, 'PAYMENT_TRANSACTION_REUSED', 'Payment transaction is already linked to another order');
      if (order.status === 'SUCCEEDED') return { orderId, status: 'SUCCEEDED' as const, idempotent: true };
      if (!['PENDING','CHECKING','EXPIRED','PAID_UNCREDITED'].includes(order.status)) throw new ApiFailure(409, 'RECHARGE_ORDER_NOT_PENDING', 'Recharge order cannot accept payment observation');
      await client.query(`UPDATE recharge_orders SET status='PAID_UNCREDITED',provider_transaction_id=$2,
        paid_at=COALESCE(paid_at,$3::timestamptz,now()) WHERE id=$1`, [orderId, input.providerTransactionId, input.paidAt ?? null]);
      const { rows: [user] } = await client.query<{ account_status: string }>('SELECT account_status FROM users WHERE id=$1', [owner.user_id]);
      const restricted = account.status !== 'ACTIVE' || user!.account_status !== 'ACTIVE';
      if (restricted || account.available_points + account.frozen_points + order.points > 2147483647) {
        const code = restricted ? 'ACCOUNT_RESTRICTED' : 'POINT_BALANCE_LIMIT';
        await client.query(`INSERT INTO point_exceptions(user_id,recharge_order_id,kind,details)
          SELECT $1,$2,'PAID_UNCREDITED',$3::jsonb WHERE NOT EXISTS(SELECT 1 FROM point_exceptions
            WHERE user_id=$1 AND recharge_order_id=$2 AND kind='PAID_UNCREDITED' AND status='OPEN')`,
        [owner.user_id, orderId, JSON.stringify({ code, transactionId: input.providerTransactionId, amountMinor: order.amount_minor, points: order.points })]);
        await client.query('UPDATE recharge_orders SET last_error=$2 WHERE id=$1', [orderId, code]);
        return { orderId, status: 'PAID_UNCREDITED' as const, idempotent: false, points: order.points };
      }
      const ledger = await creditPoints(client, account, { points: order.points, type: 'RECHARGE',
        businessId: orderId, description: `Recharge ${orderId}`, rechargeOrderId: orderId });
      await client.query(`UPDATE recharge_orders SET status='SUCCEEDED',credited_at=now(),points_ledger_id=$2,last_error=NULL WHERE id=$1`,
        [orderId, ledger.id]);
      return { orderId, status: 'SUCCEEDED' as const, idempotent: false, points: order.points, balance: ledger.balance_after };
    });
  }
}
@Controller('account/recharge')
@UseGuards(SessionGuard)
export class RechargeController {
  constructor(private readonly recharge: Recharge) {}
  private userId(request: SessionRequest) {
    if (request.user.authKind !== 'LOCAL') throw new ApiFailure(403, 'SELF_SERVICE_REQUIRED', 'Point wallets are available to self-service accounts only');
    return request.user.id;
  }
  @Get() async overview(@Req() request: SessionRequest) { return { data: await this.recharge.overview(this.userId(request)) }; }
  @Post('orders')
  async createOrder(@Req() request: SessionRequest, @Body(new SchemaPipe(createRechargeOrderInputSchema)) input: CreateRechargeOrderInput) {
    return { data: await this.recharge.createOrder(this.userId(request), input) };
  }
  @Get('records') records(@Req() request: SessionRequest, @Query(new SchemaPipe(rechargeQuerySchema)) input: RechargeQuery) { return this.recharge.records(input, this.userId(request)); }
}
