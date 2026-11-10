import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { isStorefrontRegion, type CreateOrderInput } from '@linepool/contracts';
import { Database } from './database.js';
import { ApiFailure } from './http.js';
import { Workspace } from './workspace.js';
import { Environment } from './environment.js';
import { ReceivingProvider } from './providers/receiving-provider.js';
import { PcShopOrdering } from './pc/shop-ordering.js';
import { lockPointAccount, reserveOrderPoints, settleOrderPoints } from './points-wallet.js';
import { OnceLeaseOrdering } from './once/lease-ordering.js';
import type { IntentInput, Scenario } from './once/lease-common.js';
import { LinePoolReceiving } from './linepool-receiving.js';

@Injectable()
export class Ordering {
  constructor(private readonly db: Database, private readonly workspace: Workspace, private readonly provider: ReceivingProvider, private readonly environment: Environment,
    private readonly receiving: LinePoolReceiving, @Optional() private readonly leases?: OnceLeaseOrdering,
    @Optional() private readonly realShop?: PcShopOrdering) {}
  createLease(userId: string, input: IntentInput & { purchaseIntentId?: string }, key: string, scenario: Scenario = 'SUCCESS', demo = false) {
    if (!this.leases) throw new ApiFailure(503, 'LEASE_ORDERING_UNAVAILABLE', 'Whole-number ordering is unavailable');
    return this.leases.create(userId, input, key, scenario, demo);
  }
  async create(userId: string, input: CreateOrderInput, delivery: 'immediate' | 'deferred-mock' = 'immediate') {
    if (this.environment.siteId !== 'linepool') throw new ApiFailure(404, 'NOT_FOUND', 'Platform ordering is unavailable on this site');
    // Real mode sells numbers of the official shop's agent connection through LinePool-local platform slots.
    const real = this.environment.pcProvider === 'pingcode';
    if (real && !this.realShop?.enabled) throw new ApiFailure(503, 'OFFICIAL_SHOP_NOT_CONFIGURED', 'Real storefront ordering is unavailable');
    const provider = real ? this.realShop! : this.provider;
    if (!isStorefrontRegion(input.region)) throw new ApiFailure(409, 'REGION_NOT_AVAILABLE', 'This region is not open for storefront purchases');
    if (input.receivingMode === 'ONE_TIME' && input.quantity !== 1) throw new ApiFailure(400, 'ONE_TIME_QUANTITY', 'One-time receiving requires exactly one number per order');
    // Deferred Mock delivery only exists for the Mock provider; real allocations are local and immediate.
    if (this.environment.values.LOCAL_SANDBOX && !real) delivery = 'deferred-mock';
    return this.db.transaction(async client => {
      const account = await lockPointAccount(client, userId);
      const { rows: [existing] } = await client.query<{ id: string; product_type: string; region_id: string; service: string; plan: string; quantity: number; area_code: string | null; receiving_mode: string }>(
        'SELECT id,product_type,region_id,service,plan,quantity,area_code,receiving_mode FROM orders WHERE user_id=$1 AND idempotency_key=$2', [userId, input.idempotencyKey],
      );
      if (existing) {
        if (existing.product_type !== 'SMS_CODE' || existing.region_id !== input.region || existing.service !== input.service || existing.plan !== input.plan || existing.receiving_mode !== input.receivingMode || existing.quantity !== input.quantity || (existing.area_code ?? undefined) !== input.areaCode) {
          throw new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different request');
        }
        return this.workspace.orderDetail(userId, existing.id, client);
      }
      const { rows: [offer] } = await client.query<{ name: string; unit_points: number; duration_days: number | null; receiving_mode: 'HOSTED' | 'ONE_TIME'; window_minutes: 15 | null; area_prefix: string; sms_quota: number | null; quota_source: string; allow_renewal: boolean; capability: string;
        shop_id?: string; shop_product_id?: string; shop_product_version?: number }>(real
        // The official shop's own product and price; shaped like an offer for the shared order path below.
        ? `SELECT sp.name,sp.unit_points,sp.duration_days,'HOSTED'::text AS receiving_mode,NULL::integer AS window_minutes,''::text AS area_prefix,
             NULL::integer AS sms_quota,''::text AS quota_source,false AS allow_renewal,'RECEIVE'::text AS capability,
             sp.shop_id,sp.id AS shop_product_id,sp.version AS shop_product_version
           FROM shop_products sp JOIN shops sh ON sh.id=sp.shop_id JOIN regions r ON r.id=sp.region_id
           WHERE sp.region_id=$1 AND sp.platform_id=$2 AND sp.plan=$3 AND sp.is_active AND NOT sp.admin_hold AND r.is_active
             AND sh.site_id='linepool' AND sh.kind='OFFICIAL' AND sh.status='ACTIVE'
             AND EXISTS(SELECT 1 FROM platforms p WHERE p.id=sp.platform_id AND p.is_active) FOR SHARE OF sp,sh,r`
        : `SELECT o.* FROM offers o JOIN regions r ON r.id=o.region_id
         WHERE o.region_id=$1 AND o.service=$2 AND o.plan=$3 AND o.is_active AND r.is_active
         AND o.capability='RECEIVE' AND NOT o.allow_renewal AND EXISTS(SELECT 1 FROM platforms p WHERE p.id=o.service AND p.is_active) FOR SHARE OF o,r`,
        [input.region, input.service, input.plan],
      );
      if (!offer) throw new ApiFailure(404, 'OFFER_NOT_FOUND', 'Offer is unavailable');
      if (offer.receiving_mode === 'HOSTED' && ![7,30].includes(offer.duration_days ?? 0)) throw new ApiFailure(404, 'OFFER_NOT_FOUND', 'Offer is unavailable');
      if (offer.receiving_mode !== input.receivingMode) throw new ApiFailure(409, 'OFFER_RECEIVING_MODE_CHANGED', 'The selected product receiving mode changed; refresh the product');
      const codeRule = offer.receiving_mode === 'ONE_TIME' ? await this.receiving.ruleForPurchase(client, input.service) : null;
      const total = BigInt(offer.unit_points) * BigInt(input.quantity);
      if (total > BigInt(account.available_points)) throw new ApiFailure(409, 'INSUFFICIENT_POINTS', 'Insufficient points');
      const totalPoints = Number(total);
      const orderId = randomUUID();
      await client.query(
        `INSERT INTO orders(id,order_number,user_id,region_id,service,plan,plan_name,quantity,unit_points,total_points,duration_days,idempotency_key,product_snapshot,area_code,source_channel,fulfillment_status,receiving_mode,window_minutes,shop_id,shop_product_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'PROCESSING',$16,$17,$18,$19)`,
        [orderId, `LP-${orderId.toUpperCase()}`, userId, input.region, input.service, input.plan, offer.name, input.quantity, offer.unit_points, totalPoints, offer.duration_days, input.idempotencyKey,
          JSON.stringify({ name: offer.name, unitPoints: offer.unit_points, durationDays: offer.duration_days, receivingMode: offer.receiving_mode, windowMinutes: offer.window_minutes,
            codeRule, capability: offer.capability, allowRenewal: false, areaPrefix: offer.area_prefix, areaCode: input.areaCode ?? null,
            allocationMode: input.areaCode ? 'AREA_CODE' : 'AUTO', source: provider.source,
            ...(offer.shop_product_id ? { shopId: offer.shop_id, shopProductId: offer.shop_product_id, shopProductVersion: offer.shop_product_version } : {}) }), input.areaCode ?? null,
          delivery === 'deferred-mock' ? 'SANDBOX' : 'DIRECT', offer.receiving_mode, offer.window_minutes, offer.shop_id ?? null, offer.shop_product_id ?? null],
      );
      const reservation = await reserveOrderPoints(client, account, { orderId, points: totalPoints, description: `Demo order ${orderId}` });
      await client.query('UPDATE orders SET point_reservation_id=$2 WHERE id=$1', [orderId, reservation.id]);
      // Lock inventory only after the account lock; concurrent accounts skip claimed rows.
      const numberIds = await provider.reserve(client, input, offer);
      if (delivery === 'deferred-mock') {
        await client.query('UPDATE number_platforms SET reserved_order_id=$1 WHERE number_id=ANY($2::uuid[]) AND platform_id=$3', [orderId, numberIds, input.service]);
        await client.query('INSERT INTO mock_fulfillment_operations(order_id) VALUES($1)', [orderId]);
      } else {
        const allocated = await provider.allocate(client, { userId, orderId, durationDays: offer.duration_days, numberIds });
        if (allocated) {
          if (offer.receiving_mode === 'HOSTED') await settleOrderPoints(client, account, reservation.id, 'CAPTURED');
          await client.query("UPDATE orders SET fulfillment_status='COMPLETED',completed_at=clock_timestamp() WHERE id=$1", [orderId]);
        } else {
          await settleOrderPoints(client, account, reservation.id, 'RELEASED');
          await client.query("UPDATE orders SET fulfillment_status='FAILED',completed_at=NULL WHERE id=$1", [orderId]);
        }
      }
      return this.workspace.orderDetail(userId, orderId, client);
    });
  }
}
