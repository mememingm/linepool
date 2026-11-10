import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { CreateOrderInput, ReceivingMode } from '@linepool/contracts';
import { ApiFailure } from '../http.js';
import { Environment } from '../environment.js';
import { availableStock, releaseExpired } from '../platform-inventory.js';
import { localProjectPrefix } from './local-inventory.js';

/**
 * Real LinePool storefront ordering in the unified agent model: the official storefront sells numbers of the
 * agent connection behind the site's ACTIVE OFFICIAL shop, through LinePool-local platform slots. No upstream
 * call is made: PC numbers already belong to that agent, so a sale is a local allocation. Code receiving for
 * these allocations is not enabled yet. All writes stay in the caller's transaction.
 */
@Injectable()
export class PcShopOrdering {
  readonly source = 'pinclode' as const;
  constructor(private readonly environment: Environment) {}
  get enabled() { return this.environment.siteId === 'linepool' && this.environment.pcProvider === 'pingcode'; }

  async reserve(client: PoolClient, input: CreateOrderInput, offer: { capability: string; area_prefix: string; duration_days: number | null; receiving_mode: ReceivingMode }) {
    if (offer.receiving_mode !== 'HOSTED') throw new ApiFailure(409, 'PC_ONE_TIME_RECEIVING_UNAVAILABLE', 'One-time receiving is not available for real shop numbers yet');
    const connectionId = await this.lockOfficialConnection(client);
    await releaseExpired(client, input.service);
    const { rows } = await client.query<{ id: string }>(
      `SELECT n.id FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id
       WHERE n.upstream_account_id=$8 AND n.region_id=$1 AND s.platform_id=$2 AND s.provider='pingcode' AND starts_with(s.external_project_id,$10)
       AND ${availableStock('$7', '$9')} AND n.capability=$4 AND starts_with(n.phone_number,$5)
       AND ($6::text IS NULL OR (n.phone_number ~ '^\\+1[2-9][0-9]{9}$' AND substring(n.phone_number FROM 3 FOR 3)=$6))
       ORDER BY n.created_at,n.id LIMIT $3 FOR UPDATE OF s SKIP LOCKED`,
      [input.region, input.service, input.quantity, offer.capability, offer.area_prefix, input.areaCode ?? null, offer.duration_days,
        connectionId, offer.receiving_mode, localProjectPrefix],
    );
    if (rows.length !== input.quantity) throw new ApiFailure(409, 'INSUFFICIENT_STOCK', 'Not enough inventory is currently available');
    return rows.map(row => row.id);
  }

  async allocate(client: PoolClient, input: { userId: string; orderId: string; durationDays: number | null; numberIds: string[] }) {
    const connectionId = await this.lockOfficialConnection(client);
    // Recheck every reserved resource under lock; the database allocation guard repeats the same checks.
    const { rows: resources } = await client.query<{ id: string; resource_expires_at: Date | null; duration_days: number }>(`SELECT n.id,n.resource_expires_at,o.duration_days FROM orders o
      JOIN number_platforms s ON s.platform_id=o.service JOIN phone_numbers n ON n.id=s.number_id
      JOIN upstream_accounts a ON a.id=n.upstream_account_id
      WHERE o.id=$1 AND o.user_id=$2 AND n.id=ANY($3::uuid[]) AND o.receiving_mode='HOSTED' AND a.id=$4
        AND s.provider='pingcode' AND starts_with(s.external_project_id,$5)
        AND a.provider='pingcode' AND a.storefront_id='linepool' AND NOT a.historical_only AND a.status='ACTIVE' AND a.auth_status='ACTIVE'
        AND a.access_expires_at>clock_timestamp() AND 'SMS_CODE'=ANY(a.enabled_capabilities)
        AND NOT n.source_missing AND NOT n.manual_hold AND n.sale_enabled AND s.is_available AND s.sale_enabled
        AND n.resource_status='ONLINE' AND n.capability='RECEIVE' AND s.reserved_order_id IS NULL
        AND (n.resource_expires_at IS NULL OR (isfinite(n.resource_expires_at)
          AND n.resource_expires_at>=clock_timestamp()+o.duration_days*interval '24 hours'))
        AND NOT EXISTS(SELECT 1 FROM lp_platform_sales sold WHERE sold.phone_number=n.phone_number AND sold.platform_id=s.platform_id)
        AND NOT EXISTS(SELECT 1 FROM number_allocations occupied WHERE occupied.number_id=n.id AND occupied.platform_id=s.platform_id AND occupied.released_at IS NULL)
        AND EXISTS(SELECT 1 FROM provider_projects p JOIN platforms f ON f.id=p.platform_id
          WHERE p.provider=s.provider AND p.external_project_id=s.external_project_id AND p.platform_id=s.platform_id
            AND p.upstream_account_id=a.id AND p.is_active AND f.is_active)
        AND EXISTS(SELECT 1 FROM provider_resource_bindings b WHERE b.number_id=n.id AND b.provider='pingcode' AND b.external_project_id IS NULL)
      ORDER BY n.id FOR UPDATE OF s FOR SHARE OF n,a`,
    [input.orderId, input.userId, input.numberIds, connectionId, localProjectPrefix]);
    if (resources.length !== input.numberIds.length) return false;
    const { rows: [clock] } = await client.query<{ delivered_at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS delivered_at");
    // Plan B: no PinClode expiry means no known limit; a known expiry must cover the whole purchased period.
    if (resources.some(resource => resource.resource_expires_at !== null
      && resource.resource_expires_at.getTime() < clock!.delivered_at.getTime() + resource.duration_days * 86400000)) return false;
    await client.query(`INSERT INTO number_allocations(number_id,platform_id,user_id,order_id,assigned_at,expires_at,receiving_mode)
      SELECT n.id,o.service,$1,o.id,$4::timestamptz,$4::timestamptz+o.duration_days*interval '24 hours','HOSTED'
      FROM orders o JOIN phone_numbers n ON n.id=ANY($3::uuid[]) WHERE o.id=$2 AND o.user_id=$1`,
    [input.userId, input.orderId, input.numberIds, clock!.delivered_at]);
    return true;
  }

  /** Locks the official shop and its connection for this order; the storefront sells nothing without one. */
  private async lockOfficialConnection(client: PoolClient) {
    const { rows: [shop] } = await client.query<{ connection_id: string }>(`SELECT s.connection_id FROM shops s
      JOIN upstream_accounts a ON a.id=s.connection_id
      WHERE s.site_id='linepool' AND s.kind='OFFICIAL' AND s.status='ACTIVE' FOR SHARE OF s,a`);
    if (!shop) throw new ApiFailure(503, 'OFFICIAL_SHOP_NOT_CONFIGURED', 'No official shop is configured for this site');
    return shop.connection_id;
  }
}
