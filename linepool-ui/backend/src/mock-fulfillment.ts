import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Database } from './database.js';
import { ApiFailure } from './http.js';
import { MockReceivingProvider } from './providers/mock-receiving-provider.js';

type Operation = { status: string; claim_token: string | null; claim_until: Date | null };
/** Explicit local simulation, used only by the local CLI. No HTTP, queue or supplier write API. */
export class MockFulfillment {
  constructor(private readonly db: Database) {}
  private async locked<T>(orderId: string, work: (client: PoolClient, userId: string, operation: Operation) => Promise<T>) {
    return this.db.transaction(async client => {
      const { rows: [order] } = await client.query<{ user_id: string }>('SELECT user_id FROM orders WHERE id=$1', [orderId]);
      if (!order) throw new ApiFailure(404, 'ORDER_NOT_FOUND', 'Order not found');
      // Same account -> order -> operation -> sorted resource order for every transition.
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [order.user_id]);
      await client.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      const { rows: [operation] } = await client.query<Operation>('SELECT * FROM mock_fulfillment_operations WHERE order_id=$1 FOR UPDATE', [orderId]);
      if (!operation) throw new ApiFailure(409, 'NOT_DEFERRED_MOCK', 'Order has no deferred Mock operation');
      return work(client, order.user_id, operation);
    });
  }
  private async event(client: PoolClient, id: string, before: string, after: string, evidence: string) {
    await client.query(`INSERT INTO mock_fulfillment_events(order_id,from_status,to_status,evidence) VALUES($1,$2,$3,$4)`, [id, before, after, evidence]);
  }
  async claim(orderId: string) {
    return this.locked(orderId, async (client, _userId, op) => {
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
    if (evidence.trim().length < 3 || evidence.length > 1000) throw new Error('Mock evidence must be 3..1000 characters');
    return this.locked(orderId, async (client, userId, op) => {
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
        const { rows: [order] } = await client.query<{ quantity: number; duration_days: number; fulfillment_status: string }>('SELECT quantity,duration_days,fulfillment_status FROM orders WHERE id=$1', [orderId]);
        if (order!.fulfillment_status !== 'PROCESSING') throw new ApiFailure(409, 'ORDER_STATE_CONFLICT', 'Order was already resolved');
        const { rows: numbers } = await client.query<{ id: string }>('SELECT number_id AS id FROM number_platforms WHERE reserved_order_id=$1 ORDER BY number_id FOR UPDATE', [orderId]);
        if (numbers.length !== order!.quantity) throw new ApiFailure(409, 'MOCK_RESERVATION_CONFLICT', 'Reserved inventory differs from order');
        if (outcome === 'SUCCEEDED') {
          await client.query('UPDATE number_platforms SET reserved_order_id=NULL WHERE reserved_order_id=$1', [orderId]);
          await new MockReceivingProvider().allocate(client, { userId, orderId, durationDays: order!.duration_days, numberIds: numbers.map(n => n.id) });
          await client.query("UPDATE orders SET fulfillment_status='COMPLETED',completed_at=now() WHERE id=$1", [orderId]);
        } else {
          const { rows: [debit] } = await client.query<{ id: string; delta: number }>("SELECT id,delta FROM point_ledger WHERE reference_id=$1 AND user_id=$2 AND type='ORDER_DEBIT'", [orderId, userId]);
          if (!debit) throw new ApiFailure(409, 'MOCK_DEBIT_MISSING', 'Original order debit is missing');
          const { rows: [balance] } = await client.query<{ points_balance: number }>('UPDATE users SET points_balance=points_balance-$2 WHERE id=$1 RETURNING points_balance', [userId, debit.delta]);
          await client.query(`INSERT INTO point_ledger(user_id,type,delta,balance_after,description,reference_id,reverses_ledger_id)
            VALUES($1,'ADJUSTMENT',$2,$3,'Deferred Mock failure reversal',$4,$5)`, [userId, -debit.delta, balance!.points_balance, orderId, debit.id]);
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
}
