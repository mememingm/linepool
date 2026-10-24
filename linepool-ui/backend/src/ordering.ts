import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CreateOrderInput } from '@linepool/contracts';
import { Database } from './database.js';
import { ApiFailure } from './http.js';
import { Workspace } from './workspace.js';
import { Environment } from './environment.js';
import { ReceivingProvider } from './providers/receiving-provider.js';
import { MockReceivingProvider } from './providers/mock-receiving-provider.js';

@Injectable()
export class Ordering {
  constructor(private readonly db: Database, private readonly workspace: Workspace, private readonly provider: ReceivingProvider = new MockReceivingProvider(), private readonly environment?: Environment) {}
  async create(userId: string, input: CreateOrderInput, delivery: 'immediate' | 'deferred-mock' = 'immediate') {
    if (this.environment?.values.LOCAL_SANDBOX) delivery = 'deferred-mock';
    return this.db.transaction(async client => {
      const { rows: [user] } = await client.query<{ points_balance: number; account_status: string }>(
        'SELECT points_balance,account_status FROM users WHERE id=$1 FOR UPDATE', [userId],
      );
      if (!user || user.account_status !== 'ACTIVE') throw new ApiFailure(401, 'UNAUTHENTICATED', 'Login is required');
      const { rows: [existing] } = await client.query<{ id: string; region_id: string; service: string; plan: string; quantity: number; area_code: string | null }>(
        'SELECT id,region_id,service,plan,quantity,area_code FROM orders WHERE user_id=$1 AND idempotency_key=$2', [userId, input.idempotencyKey],
      );
      if (existing) {
        if (existing.region_id !== input.region || existing.service !== input.service || existing.plan !== input.plan || existing.quantity !== input.quantity || (existing.area_code ?? undefined) !== input.areaCode) {
          throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different request');
        }
        return this.workspace.orderDetail(userId, existing.id, client);
      }
      const { rows: [offer] } = await client.query<{ name: string; unit_points: number; duration_days: number; area_prefix: string; sms_quota: number | null; quota_source: string; allow_renewal: boolean; capability: string }>(
        `SELECT o.* FROM offers o JOIN regions r ON r.id=o.region_id
         WHERE o.region_id=$1 AND o.service=$2 AND o.plan=$3 AND o.is_active AND r.is_active
         AND o.duration_days IN (7,30) AND o.capability='RECEIVE' AND NOT o.allow_renewal FOR SHARE OF o,r`,
        [input.region, input.service, input.plan],
      );
      if (!offer) throw new ApiFailure(404, 'OFFER_NOT_FOUND', 'Offer is unavailable');
      const totalPoints = offer.unit_points * input.quantity;
      if (user.points_balance < totalPoints) throw new ApiFailure(409, 'INSUFFICIENT_POINTS', 'Insufficient points');
      // Lock inventory only after the account lock; concurrent accounts skip claimed rows.
      const numberIds = await this.provider.reserve(client, input, offer);
      const orderId = randomUUID();
      await client.query(
        `INSERT INTO orders(id,order_number,user_id,region_id,service,plan,plan_name,quantity,unit_points,total_points,duration_days,idempotency_key,product_snapshot,area_code,source_channel,fulfillment_status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'PROCESSING')`,
        [orderId, `LP-${orderId.toUpperCase()}`, userId, input.region, input.service, input.plan, offer.name, input.quantity, offer.unit_points, totalPoints, offer.duration_days, input.idempotencyKey,
          JSON.stringify({ name: offer.name, unitPoints: offer.unit_points, durationDays: offer.duration_days, capability: offer.capability, smsQuota: offer.sms_quota, quotaSource: offer.quota_source, allowRenewal: false, areaPrefix: offer.area_prefix, areaCode: input.areaCode ?? null, allocationMode: input.areaCode ? 'AREA_CODE' : 'AUTO', source: this.provider.source }), input.areaCode ?? null,
          delivery === 'deferred-mock' ? 'SANDBOX' : 'DIRECT'],
      );
      const balanceAfter = user.points_balance - totalPoints;
      await client.query('UPDATE users SET points_balance=$2 WHERE id=$1', [userId, balanceAfter]);
      if (delivery === 'deferred-mock') {
        await client.query('UPDATE number_platforms SET reserved_order_id=$1 WHERE number_id=ANY($2::uuid[]) AND platform_id=$3', [orderId, numberIds, input.service]);
        await client.query('INSERT INTO mock_fulfillment_operations(order_id) VALUES($1)', [orderId]);
      } else {
        await this.provider.allocate(client, { userId, orderId, durationDays: offer.duration_days, numberIds });
        await client.query("UPDATE orders SET fulfillment_status='COMPLETED',completed_at=now() WHERE id=$1", [orderId]);
      }
      await client.query(
        `INSERT INTO point_ledger(user_id,type,delta,balance_after,description,reference_id)
         VALUES($1,'ORDER_DEBIT',$2,$3,$4,$5)`, [userId, -totalPoints, balanceAfter, `Demo order ${orderId}`, orderId],
      );
      return this.workspace.orderDetail(userId, orderId, client);
    });
  }
}
