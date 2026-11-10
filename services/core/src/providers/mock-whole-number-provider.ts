import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { Database } from '../database.js';
import { ApiFailure } from '../http.js';
import { Environment } from '../environment.js';
import { OnceInventory } from '../once/inventory.js';
import { DAY, fail, type Scenario } from '../once/lease-common.js';

const decisionSchema = z.strictObject({
  requestId: z.uuid(), source: z.literal('LOCAL_SERVICE'),
  outcome: z.enum(['SUCCEEDED', 'FAILED']), acceptedAt: z.iso.datetime(),
});
export type WholeResult = z.infer<typeof decisionSchema>;
export type WholeObservation = { result: WholeResult | null; phase: 'LOCAL_SERVICE' | 'LOOKUP' };
export type WholeOrder = {
  id: string; user_id: string; target_number_id: string; lease_id: string | null;
  duration_days: number; operation_kind: string;
};
/** Confirms local service from synchronized stock. This class never buys or renews a PC resource. */
@Injectable()
export class MockWholeNumberProvider {
  constructor(private readonly db: Database, private readonly environment: Environment, private readonly inventory: OnceInventory) {}
  get real() { return this.environment.pcProvider === 'pingcode'; }
  async submit(orderId: string): Promise<WholeObservation> {
    if (this.real) fail('ONCE_MOCK_DISABLED', 'Real inventory is fulfilled from actual local allocation results');
    if (this.environment.siteId !== 'once') fail('NOT_FOUND', 'Whole-number service is unavailable on this site', 404);
    return this.db.transaction(async client => {
      const { rows: [op] } = await client.query<{ scenario: Scenario; mock_result: unknown; request_id: string }>(
        `SELECT op.scenario,op.mock_result,op.request_id FROM mock_fulfillment_operations op
         JOIN orders o ON o.id=op.order_id WHERE op.order_id=$1 AND o.product_type='NUMBER_LEASE'
         AND o.sales_storefront_id='once' FOR UPDATE OF op`, [orderId]);
      if (!op || op.request_id !== orderId) fail('MOCK_REQUEST_CONFLICT', 'Stable local request identity differs');
      let result = op.mock_result === null ? null : decisionSchema.parse(op.mock_result);
      if (result && result.requestId !== orderId) fail('MOCK_REQUEST_CONFLICT', 'Stored local decision belongs to another request');
      if (!result) {
        result = { requestId: orderId, source: 'LOCAL_SERVICE', outcome: op.scenario.endsWith('SUCCESS') ? 'SUCCEEDED' : 'FAILED', acceptedAt: new Date().toISOString() };
        await client.query('UPDATE mock_fulfillment_operations SET mock_result=$2::jsonb WHERE order_id=$1', [orderId, JSON.stringify(result)]);
      }
      return { result: op.scenario.startsWith('UNKNOWN_') ? null : result, phase: 'LOCAL_SERVICE' };
    });
  }
  async lookup(orderId: string): Promise<WholeObservation> {
    if (this.real) fail('ONCE_MOCK_DISABLED', 'Real inventory does not use Mock decisions');
    const { rows: [op] } = await this.db.query<{ mock_result: unknown; request_id: string }>(
      `SELECT op.mock_result,op.request_id FROM mock_fulfillment_operations op JOIN orders o ON o.id=op.order_id
       WHERE op.order_id=$1 AND o.product_type='NUMBER_LEASE' AND o.sales_storefront_id='once'`, [orderId]);
    if (!op || op.request_id !== orderId) fail('MOCK_REQUEST_CONFLICT', 'Stable local request identity differs');
    const result = op.mock_result === null ? null : decisionSchema.parse(op.mock_result);
    if (result && result.requestId !== orderId) fail('MOCK_REQUEST_CONFLICT', 'Stored local decision belongs to another request');
    return { result, phase: 'LOOKUP' };
  }
  /** Caller holds user, wallet, order and operation locks before locking the number. */
  async prepare(client: PoolClient, order: WholeOrder) {
    const n = await this.inventory.detail(order.target_number_id, client, true, false).catch(error => {
      if (error instanceof ApiFailure && error.getStatus() === 404) return null;
      throw error;
    });
    if (!n) return null;
    if (!n.upstream_ready || n.source_missing || !n.pc_capabilities.includes('NUMBER_LEASE') || n.manual_hold || !n.sale_enabled || !['LOCAL', 'ONLINE'].includes(n.resource_status)
      || !n.external_number_id || !n.resource_expires_at || !Number.isFinite(new Date(n.resource_expires_at).getTime())) return null;
    const leaseId = order.lease_id;
    if (leaseId) {
      const { rows: [l] } = await client.query<{ status: string; number_id: string; user_id: string }>('SELECT * FROM leases WHERE id=$1 FOR UPDATE', [leaseId]);
      if (!l || l.number_id !== n.id || l.user_id !== order.user_id || !['ACTIVE', 'EXPIRED_HELD'].includes(l.status)) return null;
    } else if ((await client.query("SELECT 1 FROM leases WHERE number_id=$1 AND status IN ('ACTIVE','EXPIRED_HELD')", [n.id])).rowCount) return null;
    const { rows: periods } = await client.query<{ expires_at: Date; released_at: Date | null }>(
      'SELECT expires_at,released_at FROM number_allocations WHERE lease_id=$1 ORDER BY id FOR UPDATE', [leaseId]);
    const { rows: [reservation] } = await client.query<{ lease_id: string | null }>(
      'SELECT lease_id FROM whole_number_reservations WHERE number_id=$1 AND order_id=$2 FOR UPDATE', [n.id, order.id]);
    if (!reservation || reservation.lease_id !== leaseId) return null;
    const { rows: [clock] } = await client.query<{ time: Date }>('SELECT clock_timestamp() AS time');
    // After expiry the next period starts at confirmation; elapsed gaps never receive access.
    const tail = periods.filter(p => p.released_at === null).reduce((end, p) => Math.max(end, new Date(p.expires_at).getTime()), new Date(clock!.time).getTime());
    const starts = new Date(tail), ends = new Date(tail + order.duration_days * DAY);
    if (new Date(n.resource_expires_at) < ends) return null;
    if ((await client.query(`SELECT 1 FROM number_allocations WHERE number_id=$1 AND lease_id IS DISTINCT FROM $2::uuid
      AND tstzrange(assigned_at,LEAST(expires_at,COALESCE(released_at,expires_at)),'[)')
        && tstzrange($3::timestamptz,$4::timestamptz,'[)') LIMIT 1`, [n.id, leaseId, starts, ends])).rowCount) return null;
    return { number: n, leaseId, starts, ends };
  }
  async allocate(client: PoolClient, order: WholeOrder) {
    const period = await this.prepare(client, order);
    if (!period) return null;
    const { number: n, starts, ends } = period;
    let leaseId = period.leaseId;
    if (!leaseId) {
      leaseId = randomUUID();
      await client.query("INSERT INTO leases(id,user_id,number_id,initial_order_id,status) VALUES($1,$2,$3,$4,'ACTIVE')", [leaseId, order.user_id, n.id, order.id]);
      await client.query('UPDATE orders SET lease_id=$2 WHERE id=$1', [order.id, leaseId]);
    }
    await client.query(`INSERT INTO number_allocations(number_id,user_id,order_id,allocation_type,lease_id,platform_id,assigned_at,expires_at)
      VALUES($1,$2,$3,'WHOLE_NUMBER',$4,NULL,$5,$6)`, [n.id, order.user_id, order.id, leaseId, starts, ends]);
    await client.query("UPDATE leases SET status='ACTIVE',held_at=NULL,updated_at=now() WHERE id=$1", [leaseId]);
    await client.query('DELETE FROM whole_number_reservations WHERE order_id=$1', [order.id]);
    return leaseId;
  }
}
