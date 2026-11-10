import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database } from './database.js';
import { ApiFailure } from './http.js';
import { MockReceivingProvider } from './providers/mock-receiving-provider.js';
import { lockPointAccount, refundOrderPoints, settleOrderPoints, type PointAccount, type PointReservation } from './points-wallet.js';
import { MockWholeNumberProvider, type WholeOrder, type WholeObservation, type WholeResult } from './providers/mock-whole-number-provider.js';

type Operation = { status: string; claim_token: string | null; claim_until: Date | null; source: string; request_id: string };
/** Durable local fulfillment. Whole-number decisions grant service from existing PC stock only. */
@Injectable()
export class MockFulfillment {
  constructor(private readonly db: Database, @Optional() private readonly whole?: MockWholeNumberProvider, @Optional() private readonly platform?: MockReceivingProvider) {}
  private async locked<T>(orderId: string, work: (client: PoolClient, account: PointAccount, operation: Operation) => Promise<T>) {
    return this.db.transaction(async client => {
      const { rows: [order] } = await client.query<{ user_id: string }>('SELECT user_id FROM orders WHERE id=$1', [orderId]);
      if (!order) throw new ApiFailure(404, 'ORDER_NOT_FOUND', 'Order not found');
      // Same user -> wallet -> order -> operation -> sorted resource order for every transition.
      const account = await lockPointAccount(client, order.user_id, true);
      await client.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      const { rows: [operation] } = await client.query<Operation>('SELECT * FROM mock_fulfillment_operations WHERE order_id=$1 FOR UPDATE', [orderId]);
      if (!operation) throw new ApiFailure(409, 'NOT_DEFERRED_MOCK', 'Order has no deferred Mock operation');
      return work(client, account, operation);
    });
  }
  private async event(client: PoolClient, id: string, before: string, after: string, evidence: string) {
    await client.query(`INSERT INTO mock_fulfillment_events(order_id,from_status,to_status,evidence) VALUES($1,$2,$3,$4)`, [id, before, after, evidence]);
  }
  async claim(orderId: string) {
    if (this.whole?.real) throw new ApiFailure(409, 'ONCE_MOCK_DISABLED', 'Manual fulfillment decisions require Mock mode');
    return this.locked(orderId, async (client, _account, op) => {
      if (op.status === 'PROCESSING' && op.claim_until! <= new Date()) {
        await client.query(`UPDATE mock_fulfillment_operations SET status='UNCERTAIN',claim_token=NULL,claim_until=NULL,
          evidence='Local claim expired; outcome requires resolution',updated_at=now() WHERE order_id=$1`, [orderId]);
        await this.event(client, orderId, op.status, 'UNCERTAIN', 'Local claim expired; no automatic retry');
        return { status: 'UNCERTAIN', token: null };
      }
      if (op.status !== 'PENDING') return { status: op.status, token: null };
      const token = randomUUID();
      await client.query(`UPDATE mock_fulfillment_operations SET status='PROCESSING',claim_token=$2,
        claim_until=now()+interval '60 seconds',attempts=attempts+1,updated_at=now() WHERE order_id=$1`, [orderId, token]);
      await this.event(client, orderId, op.status, 'PROCESSING', 'Local simulator claimed');
      return { status: 'PROCESSING', token };
    });
  }
  async resolve(orderId: string, outcome: 'SUCCEEDED' | 'FAILED' | 'UNCERTAIN', evidence: string, token?: string) {
    if (this.whole?.real) throw new ApiFailure(409, 'ONCE_MOCK_DISABLED', 'Manual fulfillment decisions require Mock mode');
    if (evidence.trim().length < 3 || evidence.length > 1000) throw new Error('Mock evidence must be 3..1000 characters');
    const { rows: [product] } = await this.db.query<{ product_type: string }>('SELECT product_type FROM orders WHERE id=$1', [orderId]);
    if (product?.product_type === 'NUMBER_LEASE') return this.resolveWhole(orderId, outcome, evidence, token);
    return this.locked(orderId, async (client, account, op) => {
      if (['SUCCEEDED', 'FAILED'].includes(op.status)) {
        if (op.status === outcome) return { changed: false, status: op.status };
        throw new ApiFailure(409, 'MOCK_TERMINAL', 'A terminal Mock result cannot be overwritten');
      }
      if (op.status === 'PROCESSING') {
        if (!token || token !== op.claim_token || op.claim_until! <= new Date()) {
          throw new ApiFailure(409, 'MOCK_CLAIM_STALE', 'Claim token is stale; run claim to record expiry before resolving');
        }
      } else if (op.status !== 'UNCERTAIN' || token) {
        throw new ApiFailure(409, 'MOCK_TRANSITION', 'Claim pending work first; uncertain results require an explicit token-free resolution');
      }
      if (op.status === 'UNCERTAIN' && outcome === 'UNCERTAIN') return { changed: false, status: op.status };
      if (outcome !== 'UNCERTAIN') {
        const { rows: [order] } = await client.query<{ quantity: number; duration_days: number | null; receiving_mode: 'HOSTED' | 'ONE_TIME'; fulfillment_status: string; point_reservation_id: string | null }>('SELECT quantity,duration_days,receiving_mode,fulfillment_status,point_reservation_id FROM orders WHERE id=$1', [orderId]);
        if (order!.fulfillment_status !== 'PROCESSING') throw new ApiFailure(409, 'ORDER_STATE_CONFLICT', 'Order was already resolved');
        const { rows: [reservation] } = await client.query<PointReservation>(
          `SELECT * FROM point_reservations WHERE id=$1 AND account_id=$2 AND kind='ORDER' AND business_id=$3 FOR UPDATE`,
          [order!.point_reservation_id, account.id, orderId],
        );
        if (!reservation) throw new ApiFailure(409, 'MOCK_RESERVATION_MISSING', 'Order point reservation is missing');
        if (reservation.status === 'RELEASED') throw new ApiFailure(409, 'MOCK_PAYMENT_CONFLICT', 'Order points were already released');
        const { rows: numbers } = await client.query<{ id: string }>('SELECT number_id AS id FROM number_platforms WHERE reserved_order_id=$1 ORDER BY number_id', [orderId]);
        if (numbers.length !== order!.quantity) throw new ApiFailure(409, 'MOCK_RESERVATION_CONFLICT', 'Reserved inventory differs from order');
        if (outcome === 'SUCCEEDED') {
          if (!this.platform) throw new ApiFailure(503, 'PLATFORM_PROVIDER_UNAVAILABLE', 'Configured platform allocation provider is unavailable');
          const allocated = await this.platform.allocate(client, { userId: account.user_id, orderId, durationDays: order!.duration_days, numberIds: numbers.map(n => n.id) });
          if (!allocated) { outcome = 'FAILED'; evidence = 'Reserved resources cannot cover the complete period from actual delivery'; }
        }
        if (outcome === 'SUCCEEDED') {
          await client.query('UPDATE number_platforms SET reserved_order_id=NULL WHERE reserved_order_id=$1', [orderId]);
          if (order!.receiving_mode === 'HOSTED' && reservation.status === 'RESERVED') await settleOrderPoints(client, account, reservation.id, 'CAPTURED');
          await client.query("UPDATE orders SET fulfillment_status='COMPLETED',completed_at=clock_timestamp() WHERE id=$1", [orderId]);
        } else {
          if (reservation.status === 'RESERVED') {
            await settleOrderPoints(client, account, reservation.id, 'RELEASED');
          } else if (reservation.refunded_points < reservation.points) {
            await refundOrderPoints(client, account, {
              reservationId: reservation.id,
              points: reservation.points - reservation.refunded_points,
              businessId: `mock-failure:${orderId}`,
              description: 'Deferred Mock failure reversal',
            });
          }
          // Explicit failure releases the reservation into a quarantined, unsellable state.
          await client.query('UPDATE number_platforms SET reserved_order_id=NULL,sale_enabled=false WHERE reserved_order_id=$1', [orderId]);
          await client.query("UPDATE orders SET fulfillment_status='FAILED',completed_at=NULL WHERE id=$1", [orderId]);
        }
      }
      await client.query(`UPDATE mock_fulfillment_operations SET status=$2,claim_token=NULL,claim_until=NULL,evidence=$3,updated_at=now() WHERE order_id=$1`, [orderId, outcome, evidence]);
      await this.event(client, orderId, op.status, outcome, evidence);
      return { changed: true, status: outcome };
    });
  }
  async runWhole(userId: string, orderId: string) {
    if (!this.whole) throw new ApiFailure(503, 'WHOLE_PROVIDER_UNAVAILABLE', 'Local whole-number fulfillment is unavailable');
    if (this.whole.real) return this.runConnectedWhole(userId, orderId);
    const { rows: [original] } = await this.db.query<{ provider: string | null }>("SELECT product_snapshot->>'upstreamResource' AS provider FROM orders WHERE id=$1", [orderId]);
    if (original?.provider === 'pingcode') throw new ApiFailure(409, 'LOCAL_SERVICE_PROVIDER_MISMATCH', 'Real inventory rental requires real provider mode');
    const claim = await this.locked(orderId, async (client, account, op) => {
      if (account.user_id !== userId) throw new ApiFailure(404, 'ORDER_NOT_FOUND', 'Order not found');
      const { rows: [order] } = await client.query<{ product_type: string; sales_storefront_id: string }>('SELECT product_type,sales_storefront_id FROM orders WHERE id=$1', [orderId]);
      if (order?.product_type !== 'NUMBER_LEASE' || order.sales_storefront_id !== 'once') throw new ApiFailure(404, 'ORDER_NOT_FOUND', 'Order not found');
      if (op.status === 'PROCESSING' && op.claim_until! <= new Date()) {
        await client.query("UPDATE mock_fulfillment_operations SET status='UNCERTAIN',claim_token=NULL,claim_until=NULL,evidence='WORKER_CLAIM_EXPIRED',updated_at=now() WHERE order_id=$1", [orderId]);
        await this.event(client, orderId, 'PROCESSING', 'UNCERTAIN', 'Worker claim expired; look up original local decision');
        op.status = 'UNCERTAIN';
      }
      if (!['PENDING', 'UNCERTAIN'].includes(op.status)) return null;
      const token = randomUUID(), lookup = op.status === 'UNCERTAIN';
      await client.query("UPDATE mock_fulfillment_operations SET status='PROCESSING',claim_token=$2,claim_until=now()+interval '60 seconds',attempts=attempts+1,updated_at=now() WHERE order_id=$1", [orderId, token]);
      await this.event(client, orderId, op.status, 'PROCESSING', lookup ? 'LOOKUP local service decision' : 'Confirm local service');
      return { token, lookup };
    });
    if (!claim) return;
    let observed: WholeObservation;
    try {
      observed = claim.lookup ? await this.whole.lookup(orderId) : await this.whole.submit(orderId);
      if (claim.lookup && !observed.result) {
        // A durable lookup proved there was no local decision; resume the same operation after checking stock.
        const resumable = await this.locked(orderId, async (client, _account, op) => {
          if (op.status !== 'PROCESSING' || op.claim_token !== claim.token || !op.claim_until || op.claim_until <= new Date()) return false;
          const { rows: [order] } = await client.query<WholeOrder>('SELECT * FROM orders WHERE id=$1', [orderId]);
          return Boolean(order && await this.whole!.prepare(client, order));
        });
        if (resumable) observed = await this.whole.submit(orderId);
      }
    } catch {
      return this.resolveWhole(orderId, 'UNCERTAIN', 'Local result unavailable; retain points and number', claim.token);
    }
    const evidence = JSON.stringify({ source: 'LOCAL_SERVICE', requestId: orderId, phase: observed.phase, result: observed.result, observedAt: new Date().toISOString() });
    return this.resolveWhole(orderId, observed.result?.outcome ?? 'UNCERTAIN', evidence, claim.token);
  }
  private async runConnectedWhole(userId: string, orderId: string) {
    return this.locked(orderId, async (client, account, op) => {
      const { rows: [order] } = await client.query<WholeOrder & {
        product_type: string; sales_storefront_id: string; import_batch_id: string | null;
        product_snapshot: { source?: string; upstreamResource?: string }; point_reservation_id: string;
        fulfillment_status: string;
      }>('SELECT * FROM orders WHERE id=$1', [orderId]);
      if (account.user_id !== userId || !order || order.product_type !== 'NUMBER_LEASE'
        || order.sales_storefront_id !== 'once' || order.import_batch_id || op.source !== 'local-service' || op.request_id !== orderId
        || order.product_snapshot?.source !== 'LOCAL_SERVICE' || order.product_snapshot.upstreamResource !== 'pingcode') {
        throw new ApiFailure(409, 'LOCAL_SERVICE_IDENTITY_CONFLICT', 'Only the original real inventory rental can be fulfilled');
      }
      if (['SUCCEEDED', 'FAILED'].includes(op.status)) return { changed: false, status: op.status };
      if (op.claim_until && op.claim_until > new Date()) return { changed: false, status: op.status };
      if (order.fulfillment_status !== 'PROCESSING') throw new ApiFailure(409, 'ORDER_STATE_CONFLICT', 'Order was already resolved');
      const { rows: [reservation] } = await client.query<PointReservation>(
        "SELECT * FROM point_reservations WHERE id=$1 AND account_id=$2 AND kind='ORDER' AND business_id=$3 FOR UPDATE",
        [order.point_reservation_id, account.id, orderId]);
      if (!reservation || reservation.status !== 'RESERVED') throw new ApiFailure(409, 'ORDER_RESERVATION_CONFLICT', 'Order requires its original frozen points');
      const leaseId = await this.whole!.allocate(client, order);
      const outcome = leaseId ? 'SUCCEEDED' : 'FAILED';
      if (!leaseId) {
        await client.query('SELECT id FROM phone_numbers WHERE id=$1 FOR UPDATE', [order.target_number_id]);
        const held = await client.query('DELETE FROM whole_number_reservations WHERE order_id=$1 AND number_id=$2 RETURNING number_id', [orderId, order.target_number_id]);
        if (!held.rowCount) throw new ApiFailure(409, 'ORDER_RESERVATION_CONFLICT', 'Order number reservation is missing');
      }
      await settleOrderPoints(client, account, reservation.id, leaseId ? 'CAPTURED' : 'RELEASED');
      await client.query("UPDATE orders SET fulfillment_status=$2,completed_at=CASE WHEN $2='COMPLETED' THEN now() ELSE NULL END WHERE id=$1",
        [orderId, leaseId ? 'COMPLETED' : 'FAILED']);
      const result: WholeResult = { requestId: orderId, source: 'LOCAL_SERVICE', outcome, acceptedAt: new Date().toISOString() };
      const evidence = leaseId ? 'Connected inventory locally allocated' : 'Connected resource cannot cover the requested service';
      await client.query(`UPDATE mock_fulfillment_operations SET status=$2,claim_token=NULL,claim_until=NULL,
        attempts=attempts+1,evidence=$3,evidence_data=$4::jsonb,
        provider_order_id=NULL,checked_at=now(),updated_at=now() WHERE order_id=$1`,
        [orderId, outcome, evidence, JSON.stringify({ source: 'LOCAL_SERVICE', provider: 'pingcode', result, leaseId })]);
      await this.event(client, orderId, op.status, outcome, evidence);
      return { changed: true, status: outcome };
    });
  }
  private async resolveWhole(orderId: string, outcome: 'SUCCEEDED' | 'FAILED' | 'UNCERTAIN', evidence: string, token?: string) {
    if (!this.whole) throw new ApiFailure(503, 'WHOLE_PROVIDER_UNAVAILABLE', 'Local whole-number fulfillment is unavailable');
    return this.locked(orderId, async (client, account, op) => {
      if (['SUCCEEDED', 'FAILED'].includes(op.status)) {
        if (op.status !== outcome) throw new ApiFailure(409, 'MOCK_TERMINAL', 'A terminal local result cannot be overwritten');
        return { changed: false, status: op.status };
      }
      if (op.status !== 'PROCESSING' || !token || token !== op.claim_token || op.claim_until! <= new Date()) return { changed: false, status: op.status };
      const { rows: [order] } = await client.query<WholeOrder & { point_reservation_id: string; fulfillment_status: string }>('SELECT * FROM orders WHERE id=$1', [orderId]);
      const { rows: [accepted] } = await client.query<{ mock_result: WholeResult | null }>('SELECT mock_result FROM mock_fulfillment_operations WHERE order_id=$1', [orderId]);
      if (outcome !== 'UNCERTAIN' && (accepted?.mock_result?.requestId !== orderId || accepted.mock_result.source !== 'LOCAL_SERVICE' || accepted.mock_result.outcome !== outcome)) {
        throw new ApiFailure(409, 'MOCK_EVIDENCE_CONFLICT', 'Outcome differs from the durable local service decision');
      }
      if (order!.fulfillment_status !== 'PROCESSING') throw new ApiFailure(409, 'ORDER_STATE_CONFLICT', 'Order was already resolved');
      const { rows: [reservation] } = await client.query<PointReservation>(
        "SELECT * FROM point_reservations WHERE id=$1 AND account_id=$2 AND kind='ORDER' AND business_id=$3 FOR UPDATE", [order!.point_reservation_id, account.id, orderId]);
      if (!reservation || reservation.status !== 'RESERVED') throw new ApiFailure(409, 'MOCK_RESERVATION_CONFLICT', 'Order requires its original frozen points');
      const observation = evidence;
      // Confirm coverage again before capture. Changed or missing resources retain the original freeze.
      if (outcome === 'SUCCEEDED' && !await this.whole!.allocate(client, order!)) {
        outcome = 'UNCERTAIN';
        evidence = 'RESOURCE_REQUIRES_RECONCILIATION';
      }
      if (outcome === 'FAILED') {
        await client.query('SELECT id FROM phone_numbers WHERE id=$1 FOR UPDATE', [order!.target_number_id]);
        const held = await client.query('DELETE FROM whole_number_reservations WHERE order_id=$1 AND number_id=$2 RETURNING number_id', [orderId, order!.target_number_id]);
        if (!held.rowCount) throw new ApiFailure(409, 'MOCK_RESERVATION_CONFLICT', 'Order number reservation is missing');
      }
      if (outcome !== 'UNCERTAIN') {
        await settleOrderPoints(client, account, order!.point_reservation_id, outcome === 'SUCCEEDED' ? 'CAPTURED' : 'RELEASED');
        await client.query("UPDATE orders SET fulfillment_status=$2,completed_at=CASE WHEN $2='COMPLETED' THEN now() ELSE NULL END WHERE id=$1", [orderId, outcome === 'SUCCEEDED' ? 'COMPLETED' : 'FAILED']);
      }
      await client.query(`UPDATE mock_fulfillment_operations SET status=$2,claim_token=NULL,claim_until=NULL,evidence=$3,
        evidence_data=$4::jsonb,provider_order_id=NULL,checked_at=now(),updated_at=now() WHERE order_id=$1`,
        [orderId, outcome, evidence, JSON.stringify({ source: 'LOCAL_SERVICE', requestId: orderId, outcome, evidence, observation, localResult: accepted?.mock_result ?? null })]);
      await this.event(client, orderId, op.status, outcome, evidence);
      return { changed: true, status: outcome };
    });
  }
}
