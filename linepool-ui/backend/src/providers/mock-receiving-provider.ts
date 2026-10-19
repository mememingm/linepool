import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { CreateOrderInput } from '@linepool/contracts';
import { ApiFailure } from '../http.js';
import { ReceivingProvider } from './receiving-provider.js';
import { PingCodeAdapter } from './pingcode-adapter.js';
import { MockPingCodeTransport } from './mock-pingcode-transport.js';

/** Database-backed simulation. No network or supplier side effects, including on rollback. */
@Injectable()
export class MockReceivingProvider extends ReceivingProvider {
  readonly source = 'mock' as const;
  constructor(readonly reader = new PingCodeAdapter(new MockPingCodeTransport())) { super(); }
  async reserve(client: PoolClient, input: CreateOrderInput, offer: { capability: string; area_prefix: string }) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM phone_numbers WHERE region_id=$1 AND service=$2 AND assigned_user_id IS NULL
       AND sale_enabled AND resource_status IN ('LOCAL','ONLINE') AND capability=$4 AND starts_with(phone_number,$5)
       AND ($6::text IS NULL OR (phone_number ~ '^\\+1[2-9][0-9]{9}$' AND substring(phone_number FROM 3 FOR 3)=$6))
       ORDER BY created_at,id LIMIT $3 FOR UPDATE SKIP LOCKED`,
      [input.region, input.service, input.quantity, offer.capability, offer.area_prefix, input.areaCode ?? null],
    );
    if (rows.length !== input.quantity) throw new ApiFailure(409, 'INSUFFICIENT_STOCK', 'Not enough inventory is currently available');
    return rows.map(row => row.id);
  }
  async allocate(client: PoolClient, input: { userId: string; orderId: string; durationDays: number; numberIds: string[] }) {
    const result = await client.query(
      `UPDATE phone_numbers SET assigned_user_id=$1,order_id=$2,assigned_at=now(),expires_at=now()+($3*interval '1 day')
       WHERE id=ANY($4::uuid[]) AND assigned_user_id IS NULL`,
      [input.userId, input.orderId, input.durationDays, input.numberIds],
    );
    if (result.rowCount !== input.numberIds.length) throw new ApiFailure(409, 'INSUFFICIENT_STOCK', 'Resource allocation did not complete');
  }
}
