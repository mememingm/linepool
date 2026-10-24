import { randomUUID } from 'node:crypto';
import { Controller, Get, Injectable, Post, Body, Req, UseGuards, Query } from '@nestjs/common';
import { calculateRechargePoints, createRechargeOrderInputSchema, rechargeQuerySchema, rechargeRulesSchema, type AdminRechargeQuery, type CreateRechargeOrderInput, type RechargeOverview, type RechargeQuery, type RechargeSettings, type RechargeSettingsInput } from '@linepool/contracts';
import { SessionGuard, type SessionRequest } from './authentication.js';
import { Database } from './database.js';
import { Environment } from './environment.js';
import { ApiFailure, SchemaPipe } from './http.js';
import { pagination, Workspace } from './workspace.js';

const recordFields = `r.id,r.order_number AS "orderNumber",r.currency,r.fraction_digits AS "fractionDigits",
  r.amount_minor::float8 AS "amountMinor",r.points,r.status,r.payment_method AS "paymentMethod",
  r.created_at AS "createdAt",r.paid_at AS "paidAt",r.credited_at AS "creditedAt"`;
type SettingsRow = { rules: unknown; version: number; updated_at: Date; updated_by: string };

type CreditInput = { providerTransactionId: string; amountMinor: number; currency: string; paidAt?: string };
@Injectable()
export class Recharge {
  constructor(private readonly workspace: Workspace, private readonly environment: Environment, private readonly db: Database) {}
  async settings(): Promise<RechargeSettings> {
    const { rows: [row] } = await this.db.query<SettingsRow>(`SELECT s.rules,s.version,s.updated_at,u.display_name AS updated_by
      FROM recharge_settings s JOIN users u ON u.id=s.updated_by WHERE s.id=true`);
    if (row) return { rules: row.rules === null ? null : rechargeRulesSchema.parse(row.rules), version: row.version,
      source: 'database', updatedAt: row.updated_at.toISOString(), updatedBy: row.updated_by };
    const rules = this.environment.values.RECHARGE_RULES;
    return { rules, version: 0, source: rules ? 'environment' : 'unconfigured', updatedAt: null, updatedBy: null };
  }
  async saveSettings(actorId: string, input: RechargeSettingsInput): Promise<RechargeSettings> {
    return this.db.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(734102613)');
      const { rows: [before] } = await client.query<SettingsRow>('SELECT rules,version,updated_at,updated_by FROM recharge_settings WHERE id=true');
      if ((before?.version ?? 0) !== input.expectedVersion) throw new ApiFailure(409, 'RECHARGE_SETTINGS_CHANGED', 'Recharge settings changed; refresh before saving');
      const { rows: [after] } = await client.query<SettingsRow>(`INSERT INTO recharge_settings(id,rules,version,updated_by)
        VALUES(true,$1,1,$2) ON CONFLICT(id) DO UPDATE SET rules=excluded.rules,version=recharge_settings.version+1,
        updated_by=excluded.updated_by,updated_at=now() RETURNING rules,version,updated_at,updated_by`, [input.rules, actorId]);
      await client.query(`INSERT INTO admin_audit(actor_id,action,target_id,reason,before_data,after_data) VALUES($1,'RECHARGE_SETTINGS','recharge',$2,$3,$4)`,
        [actorId, input.reason, before ? { rules: before.rules, version: before.version } : { rules: this.environment.values.RECHARGE_RULES, version: 0 }, { rules: after!.rules, version: after!.version }]);
      const { rows: [actor] } = await client.query<{ display_name: string }>('SELECT display_name FROM users WHERE id=$1', [actorId]);
      return { rules: input.rules, version: after!.version, source: 'database', updatedAt: after!.updated_at.toISOString(), updatedBy: actor!.display_name };
    });
  }
  async records(input: RechargeQuery | AdminRechargeQuery, userId: string | undefined, admin = false) {
    const values: unknown[] = []; const clauses = ['true'];
    const add = (clause: string, value: unknown) => { values.push(value); clauses.push(clause.replaceAll('?', `$${values.length}`)); };
    if (!admin && !userId) throw new ApiFailure(401, 'AUTH_REQUIRED', 'Authentication required');
    if (userId) add('r.user_id=?', userId);
    if (input.status) add('r.status=?', input.status);
    if (input.search) {
      const search = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`;
      if (admin) { add('r.order_number ILIKE ?', search); add('u.email ILIKE ?', search); add('u.display_name ILIKE ?', search); add('r.provider_transaction_id ILIKE ?', search); }
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
    const settings = await this.settings();
    const parsed = createRechargeOrderInputSchema.parse(input);
    const rules = settings.rules;
    if (!rules) throw new ApiFailure(409, 'RECHARGE_NOT_CONFIGURED', 'Recharge rules are not configured');
    const converted = calculateRechargePoints(parsed.amountMinor, rules);
    if (converted.error) throw new ApiFailure(400, 'RECHARGE_AMOUNT_INVALID', `Recharge amount cannot be converted: ${converted.error}`);
    return this.db.transaction(async client => {
      const { rows: [user] } = await client.query<{ id: string }>('SELECT id FROM users WHERE id=$1 AND account_status=\'ACTIVE\' FOR SHARE', [userId]);
      if (!user) throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
      const { rows: [existing] } = await client.query<{ id: string; order_number: string; amount_minor: number; currency: string; points: number; payment_method: string | null; status: string }>(
        'SELECT id,order_number,amount_minor::float8,currency,points,payment_method,status FROM recharge_orders WHERE user_id=$1 AND idempotency_key=$2 FOR SHARE',
        [userId, parsed.idempotencyKey]);
      if (existing) {
        if (existing.amount_minor !== parsed.amountMinor || existing.currency !== rules.currency || existing.points !== converted.points
          || existing.payment_method !== (parsed.paymentMethod ?? null)) {
          throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different recharge request');
        }
        return { id: existing.id, orderNumber: existing.order_number, status: existing.status as 'PENDING', paymentStatus: 'not_connected' as const };
      }
      const { rows: [row] } = await client.query<{ id: string; order_number: string }>(`INSERT INTO recharge_orders(order_number,user_id,currency,fraction_digits,amount_minor,points,payment_method,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,order_number`, [`LP-R-${randomUUID().toUpperCase()}`, userId, rules.currency,
        rules.fractionDigits, parsed.amountMinor, converted.points, parsed.paymentMethod ?? null, parsed.idempotencyKey]);
      return { id: row!.id, orderNumber: row!.order_number, status: 'PENDING' as const, paymentStatus: 'not_connected' as const };
    });
  }

  /** Payment provider callback boundary: caller must verify signature externally before invoking this transaction. */
  async creditVerified(orderId: string, input: CreditInput) {
    if (!input.providerTransactionId.trim()) throw new ApiFailure(400, 'PAYMENT_TRANSACTION_REQUIRED', 'A provider transaction ID is required');
    return this.db.transaction(async client => {
      const { rows: [order] } = await client.query<{ id: string; user_id: string; currency: string; amount_minor: number; points: number; status: string; points_ledger_id: string | null }>(
        'SELECT id,user_id,currency,amount_minor::float8,points,status,points_ledger_id FROM recharge_orders WHERE id=$1 FOR UPDATE', [orderId]);
      if (!order) throw new ApiFailure(404, 'RECHARGE_ORDER_NOT_FOUND', 'Recharge order not found');
      const { rows: [duplicate] } = await client.query<{ id: string; status: string }>('SELECT id,status FROM recharge_orders WHERE provider_transaction_id=$1 FOR UPDATE', [input.providerTransactionId]);
      if (duplicate && duplicate.id !== orderId) throw new ApiFailure(409, 'PAYMENT_TRANSACTION_REUSED', 'Payment transaction is already linked to another order');
      if (order.status === 'SUCCEEDED') return { orderId, status: 'SUCCEEDED' as const, idempotent: true };
      if (order.status !== 'PENDING') throw new ApiFailure(409, 'RECHARGE_ORDER_NOT_PENDING', 'Recharge order is not pending');
      if (order.currency !== input.currency || order.amount_minor !== input.amountMinor) throw new ApiFailure(409, 'PAYMENT_AMOUNT_MISMATCH', 'Payment amount or currency does not match the order');
      const { rows: [user] } = await client.query<{ points_balance: number }>('SELECT points_balance FROM users WHERE id=$1 FOR UPDATE', [order.user_id]);
      if (!user) throw new ApiFailure(404, 'USER_NOT_FOUND', 'Recharge owner not found');
      const { rows: [balance] } = await client.query<{ points_balance: number }>('UPDATE users SET points_balance=points_balance+$2 WHERE id=$1 RETURNING points_balance', [order.user_id, order.points]);
      const { rows: [ledger] } = await client.query<{ id: string }>(`INSERT INTO point_ledger(user_id,type,delta,balance_after,description,recharge_order_id)
        VALUES($1,'RECHARGE',$2,$3,$4,$5) RETURNING id`, [order.user_id, order.points, balance!.points_balance, `Recharge ${orderId}`, orderId]);
      await client.query(`UPDATE recharge_orders SET status='SUCCEEDED',provider_transaction_id=$2,paid_at=COALESCE($3::timestamptz,now()),credited_at=now(),points_ledger_id=$4 WHERE id=$1`,
        [orderId, input.providerTransactionId, input.paidAt ?? null, ledger!.id]);
      return { orderId, status: 'SUCCEEDED' as const, idempotent: false, points: order.points, balance: balance!.points_balance };
    });
  }
}
@Controller('account/recharge')
@UseGuards(SessionGuard)
export class RechargeController {
  constructor(private readonly recharge: Recharge) {}
  @Get() async overview(@Req() request: SessionRequest) { return { data: await this.recharge.overview(request.user.id) }; }
  @Post('orders')
  async createOrder(@Req() request: SessionRequest, @Body(new SchemaPipe(createRechargeOrderInputSchema)) input: CreateRechargeOrderInput) {
    return { data: await this.recharge.createOrder(request.user.id, input) };
  }
  @Get('records') records(@Req() request: SessionRequest, @Query(new SchemaPipe(rechargeQuerySchema)) input: RechargeQuery) { return this.recharge.records(input, request.user.id); }
}
