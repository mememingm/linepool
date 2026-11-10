import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';
import { creditPoints, lockPointAccount } from '../points-wallet.js';
import { OncePointExceptions } from './point-exceptions.js';
import type { PaymentScenario } from './point-support.js';

export type OnceRechargeRow = {
  id: string; user_id: string; order_number: string; amount_minor: number; currency: string; fraction_digits: number; points: number;
  status: string; payment_method: string | null; sales_storefront_id: string; purchase_intent_id: string | null;
  expires_at: Date | null; paid_at: Date | null; credited_at: Date | null; created_at: Date;
  mock_scenario: PaymentScenario | null; mock_payment_status: string | null; mock_provider_transaction_id: string | null;
  mock_observed_at: Date | null; provider_transaction_id: string | null; points_ledger_id: string | null;
  claim_token: string | null; claim_deadline: Date | null; last_checked_at: Date | null; attempts: number; last_error: string | null;
  claim_live: boolean;
};
export const onceRechargeFields = 'r.*,r.amount_minor::float8 AS amount_minor,coalesce(r.claim_deadline>clock_timestamp(),false) AS claim_live';
export function onceRechargeView(row: OnceRechargeRow) {
  return { id: row.id, orderNumber: row.order_number, amountMinor: row.amount_minor, currency: row.currency,
    fractionDigits: row.fraction_digits, points: row.points, status: row.status, environment: row.payment_method === 'MOCK' ? 'DEMO' : 'HISTORICAL',
    userId: row.user_id, credited: row.points_ledger_id !== null && row.credited_at !== null,
    purchaseIntentId: row.purchase_intent_id, expiresAt: row.expires_at, paidAt: row.paid_at, creditedAt: row.credited_at,
    latePayment: row.paid_at && row.expires_at ? row.paid_at > row.expires_at : false, createdAt: row.created_at,
    checkoutUrl: row.payment_method === 'MOCK' ? `/api/once/points/recharges/${row.id}/demo-pay` : null,
    checkoutMethod: row.payment_method === 'MOCK' ? 'POST' : null,
    paymentStatus: row.paid_at ? 'PAID' : row.status === 'FAILED' ? 'FAILED' : row.status === 'CHECKING' ? 'UNKNOWN' : 'PENDING',
    lastCheckedAt: row.last_checked_at, attempts: row.attempts, lastError: row.last_error,
    sourceBreakdownAvailable: false, sources: null, cashRefundAvailable: false, refundableMinor: null,
    refundedMinor: null, refundReservedMinor: null };
}
@Injectable()
export class OnceMockPayment implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private recovering = false;
  constructor(private readonly db: Database, private readonly environment: Environment, private readonly exceptions: OncePointExceptions) {}
  get enabled() { return this.environment.siteId === 'once' && this.environment.values.NODE_ENV !== 'production' && this.environment.values.LOCAL_SANDBOX; }
  requireEnabled() { if (!this.enabled) throw new ApiFailure(409, 'MOCK_PAYMENT_UNAVAILABLE', 'Mock payment requires the isolated local Once sandbox'); }
  async detail(userId: string, id: string) {
    if (this.environment.siteId !== 'once') throw new ApiFailure(404, 'ONCE_UNAVAILABLE', 'Once is not enabled on this site');
    const { rows: [row] } = await this.db.query<OnceRechargeRow>(`SELECT ${onceRechargeFields} FROM recharge_orders r WHERE r.id=$1 AND r.user_id=$2 AND r.sales_storefront_id='once'`, [id, userId]);
    if (!row) throw new ApiFailure(404, 'RECHARGE_ORDER_NOT_FOUND', 'Recharge order was not found');
    return onceRechargeView(row);
  }
  async accept(userId: string, id: string, scenario: PaymentScenario) {
    this.requireEnabled();
    if (!['SUCCESS','FAILURE','UNKNOWN_SUCCESS','UNKNOWN_FAILURE'].includes(scenario)) throw new ApiFailure(400, 'INVALID_MOCK_SCENARIO', 'Mock payment scenario is invalid');
    await this.db.transaction(async client => {
      await lockPointAccount(client, userId, true);
      const { rows: [row] } = await client.query<OnceRechargeRow>(`SELECT ${onceRechargeFields} FROM recharge_orders r WHERE r.id=$1 AND r.user_id=$2 AND r.sales_storefront_id='once' FOR UPDATE`, [id, userId]);
      if (!row || row.payment_method !== 'MOCK') throw new ApiFailure(404, 'RECHARGE_ORDER_NOT_FOUND', 'Mock recharge order was not found');
      if (row.mock_scenario && row.mock_scenario !== scenario) throw new ApiFailure(409, 'SCENARIO_CONFLICT', 'An accepted Mock payment cannot change its result');
      if (!row.mock_scenario) {
        if (!['PENDING','CHECKING','EXPIRED'].includes(row.status)) throw new ApiFailure(409, 'RECHARGE_ORDER_CLOSED', 'Recharge order does not accept a new payment');
        // This is the durable Mock provider result. Only the worker observes it and credits the wallet.
        await client.query(`UPDATE recharge_orders SET mock_scenario=$2,mock_payment_status=$3,
          mock_provider_transaction_id=$4,mock_observed_at=now(),status='CHECKING',last_checked_at=NULL WHERE id=$1`,
        [id, scenario, scenario.endsWith('SUCCESS') ? 'PAID' : 'FAILED', `mock-payment:${id}`]);
      }
    });
    return this.detail(userId, id);
  }
  async check(userId: string, id: string) {
    if (this.environment.siteId !== 'once') throw new ApiFailure(404, 'ONCE_UNAVAILABLE', 'Once is not enabled on this site');
    await this.db.transaction(async client => {
      await lockPointAccount(client, userId, true);
      const { rows: [row] } = await client.query<OnceRechargeRow>(`SELECT ${onceRechargeFields} FROM recharge_orders r WHERE r.id=$1 AND r.user_id=$2 AND r.sales_storefront_id='once' FOR UPDATE`, [id, userId]);
      if (!row) throw new ApiFailure(404, 'RECHARGE_ORDER_NOT_FOUND', 'Recharge order was not found');
      if (row.payment_method !== 'MOCK' || !['PENDING','EXPIRED','CHECKING','PAID_UNCREDITED'].includes(row.status)) return;
      this.requireEnabled();
      // Reorder local work without stealing an active claim or observing a provider in the API.
      await client.query('UPDATE recharge_orders SET last_checked_at=NULL WHERE id=$1', [id]);
    });
    return this.detail(userId, id);
  }
  private async observe(userId: string, id: string) {
    const claimed = await this.db.transaction(async client => {
      await lockPointAccount(client, userId, true);
      const { rows: [row] } = await client.query<OnceRechargeRow>(`SELECT ${onceRechargeFields} FROM recharge_orders r WHERE r.id=$1 AND r.user_id=$2 AND r.sales_storefront_id='once' FOR UPDATE`, [id, userId]);
      if (!row || row.payment_method !== 'MOCK' || !['PENDING','EXPIRED','CHECKING','PAID_UNCREDITED'].includes(row.status) || row.claim_live) return null;
      const token = randomUUID();
      await client.query(`UPDATE recharge_orders SET claim_token=$2,claim_deadline=clock_timestamp()+interval '60 seconds',attempts=attempts+1 WHERE id=$1`, [id, token]);
      return token;
    });
    if (!claimed) return;
    try {
      // Lookup is outside the wallet transaction and uses the original recharge UUID only.
      const { rows: [observed] } = await this.db.query<OnceRechargeRow>(`SELECT ${onceRechargeFields} FROM recharge_orders r WHERE r.id=$1 AND r.user_id=$2 AND r.sales_storefront_id='once'`, [id, userId]);
      if (!observed) throw new ApiFailure(404, 'RECHARGE_ORDER_NOT_FOUND', 'Recharge order was not found');
      await this.db.transaction(async client => {
        const account = await lockPointAccount(client, userId, true);
        const { rows: [row] } = await client.query<OnceRechargeRow>(`SELECT ${onceRechargeFields} FROM recharge_orders r WHERE r.id=$1 AND r.user_id=$2 AND r.sales_storefront_id='once' FOR UPDATE`, [id, userId]);
        if (!row || row.claim_token !== claimed || !row.claim_live) return;
        if (!['PENDING','EXPIRED','CHECKING','PAID_UNCREDITED'].includes(row.status)) {
          await client.query('UPDATE recharge_orders SET claim_token=NULL,claim_deadline=NULL WHERE id=$1', [id]);
          return;
        }
        if (row.mock_provider_transaction_id !== observed.mock_provider_transaction_id || row.mock_scenario !== observed.mock_scenario) {
          await client.query('UPDATE recharge_orders SET claim_token=NULL,claim_deadline=NULL WHERE id=$1', [id]);
          return;
        }
        if (observed.mock_payment_status === 'PAID') {
          const transactionId = observed.mock_provider_transaction_id;
          if (!transactionId || transactionId !== `mock-payment:${id}` || !observed.mock_observed_at) {
            await this.exceptions.record(client, userId, 'PAYMENT_TRANSACTION_MISMATCH', { transactionId }, id);
            await client.query("UPDATE recharge_orders SET last_error='PAYMENT_TRANSACTION_MISMATCH',claim_token=NULL,claim_deadline=NULL,last_checked_at=now() WHERE id=$1", [id]);
            return;
          }
          const { rows: [duplicate] } = await client.query<{ id: string }>('SELECT id FROM recharge_orders WHERE provider_transaction_id=$1 AND id<>$2', [transactionId, id]);
          if (duplicate || (row.provider_transaction_id && row.provider_transaction_id !== transactionId)) {
            await this.exceptions.record(client, userId, 'PAYMENT_TRANSACTION_CONFLICT', { transactionId, conflictingOrderId: duplicate?.id ?? null }, id);
            await client.query("UPDATE recharge_orders SET last_error='PAYMENT_TRANSACTION_CONFLICT',claim_token=NULL,claim_deadline=NULL,last_checked_at=now() WHERE id=$1", [id]);
            return;
          }
          await client.query(`UPDATE recharge_orders SET status='PAID_UNCREDITED',paid_at=COALESCE(paid_at,$2),provider_transaction_id=$3,last_checked_at=now() WHERE id=$1`, [id, observed.mock_observed_at, transactionId]);
          const { rows: [user] } = await client.query<{ account_status: string }>('SELECT account_status FROM users WHERE id=$1', [userId]);
          const restricted = account.status !== 'ACTIVE' || user!.account_status !== 'ACTIVE';
          if (restricted || account.available_points + account.frozen_points + row.points > 2147483647) {
            const code = restricted ? 'ACCOUNT_RESTRICTED' : 'POINT_BALANCE_LIMIT';
            await this.exceptions.record(client, userId, 'PAID_UNCREDITED', { code, transactionId, amountMinor: row.amount_minor, points: row.points }, id);
            await client.query('UPDATE recharge_orders SET last_error=$2,claim_token=NULL,claim_deadline=NULL WHERE id=$1', [id, code]);
            return;
          }
          const ledger = await creditPoints(client, account, { points: row.points, type: 'RECHARGE', businessId: id, rechargeOrderId: id, description: `Recharge ${id}` });
          await client.query(`UPDATE recharge_orders SET status='SUCCEEDED',points_ledger_id=$2,credited_at=now(),last_error=NULL,claim_token=NULL,claim_deadline=NULL WHERE id=$1`, [id, ledger.id]);
        } else if (observed.mock_payment_status === 'FAILED') {
          if (row.paid_at || row.provider_transaction_id) {
            await this.exceptions.record(client, userId, 'PAYMENT_TRANSACTION_CONFLICT', { code: 'PAID_PAYMENT_FAILED_OBSERVATION' }, id);
            await client.query("UPDATE recharge_orders SET last_error='PAYMENT_TRANSACTION_CONFLICT',claim_token=NULL,claim_deadline=NULL,last_checked_at=now() WHERE id=$1", [id]);
          } else await client.query("UPDATE recharge_orders SET status='FAILED',claim_token=NULL,claim_deadline=NULL,last_checked_at=now(),last_error=NULL WHERE id=$1", [id]);
        } else await client.query(`UPDATE recharge_orders SET status=CASE WHEN expires_at<=now() AND status IN ('PENDING','CHECKING') THEN 'EXPIRED' ELSE status END,
          claim_token=NULL,claim_deadline=NULL,last_checked_at=now() WHERE id=$1`, [id]);
      });
    } catch (error) {
      await this.db.transaction(async client => {
        await lockPointAccount(client, userId, true);
        await client.query(`UPDATE recharge_orders SET claim_token=NULL,claim_deadline=NULL,last_checked_at=now(),
          last_error='PAYMENT_OBSERVATION_FAILED' WHERE id=$1 AND claim_token=$2`, [id, claimed]);
      });
      throw error;
    }
  }
  async recover() {
    if (this.recovering || !this.enabled || !this.environment.isWorker) return;
    this.recovering = true;
    try {
      const { rows } = await this.db.query<{ id: string; user_id: string }>(`SELECT r.id,r.user_id FROM recharge_orders r JOIN users u ON u.id=r.user_id
        WHERE u.auth_kind='LOCAL' AND r.sales_storefront_id='once' AND r.payment_method='MOCK'
        AND r.status IN ('PENDING','CHECKING','EXPIRED','PAID_UNCREDITED') AND (r.claim_deadline IS NULL OR r.claim_deadline<=clock_timestamp())
        ORDER BY r.last_checked_at ASC NULLS FIRST,r.created_at,r.id LIMIT 50`);
      for (const row of rows) {
        try { await this.observe(row.user_id, row.id); }
        catch { console.error('Once Mock payment observation failed'); }
      }
    } finally { this.recovering = false; }
  }
  onModuleInit() {
    if (!this.enabled || !this.environment.isWorker) return;
    const recover = () => { void this.recover().catch(() => console.error('Once Mock payment recovery failed')); };
    this.timer = setInterval(recover, 15000); this.timer.unref(); recover();
  }
  onModuleDestroy() { clearInterval(this.timer); }
}
