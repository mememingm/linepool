import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { CreateOrderInput } from '@linepool/contracts';
import { ApiFailure } from '../http.js';
import { ReceivingProvider } from './receiving-provider.js';
import { PingCodeAdapter } from './pingcode-adapter.js';
import { MockPingCodeTransport } from './mock-pingcode-transport.js';
import { availableStock, releaseExpired } from '../platform-inventory.js';

/** Database-backed simulation. No network or supplier side effects, including on rollback. */
@Injectable()
export class MockReceivingProvider extends ReceivingProvider {
  readonly source = 'mock' as const;
  constructor(readonly reader = new PingCodeAdapter(new MockPingCodeTransport())) { super(); }
  async reserve(client: PoolClient, input: CreateOrderInput, offer: { capability: string; area_prefix: string; duration_days: number }) {
    await releaseExpired(client, input.service);
    const { rows } = await client.query<{ id: string }>(
      `SELECT n.id FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id
       WHERE n.region_id=$1 AND s.platform_id=$2 AND s.provider='pingcode-mock'
       AND ${availableStock('$7')} AND n.capability=$4 AND starts_with(n.phone_number,$5)
       AND ($6::text IS NULL OR (n.phone_number ~ '^\\+1[2-9][0-9]{9}$' AND substring(n.phone_number FROM 3 FOR 3)=$6))
       ORDER BY n.created_at,n.id LIMIT $3 FOR UPDATE OF s SKIP LOCKED`,
      [input.region, input.service, input.quantity, offer.capability, offer.area_prefix, input.areaCode ?? null, offer.duration_days],
    );
    if (rows.length !== input.quantity) throw new ApiFailure(409, 'INSUFFICIENT_STOCK', 'Not enough inventory is currently available');
    return rows.map(row => row.id);
  }
  async allocate(client: PoolClient, input: { userId: string; orderId: string; durationDays: number; numberIds: string[] }) {
    const result = await client.query(
      `INSERT INTO number_allocations(number_id,platform_id,user_id,order_id,assigned_at,expires_at)
       SELECT n.id,o.service,$1,o.id,now(),now()+($3*interval '1 day')
       FROM orders o JOIN number_platforms s ON s.platform_id=o.service
       JOIN phone_numbers n ON n.id=s.number_id
       WHERE o.id=$2 AND n.id=ANY($4::uuid[]) AND s.provider='pingcode-mock'`,
      [input.userId, input.orderId, input.durationDays, input.numberIds],
    );
    if (result.rowCount !== input.numberIds.length) throw new ApiFailure(409, 'INSUFFICIENT_STOCK', 'Resource allocation did not complete');
  }
}
