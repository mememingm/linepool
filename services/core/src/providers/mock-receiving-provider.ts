import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { CreateOrderInput, ReceivingMode } from '@linepool/contracts';
import { ApiFailure } from '../http.js';
import { ReceivingProvider } from './receiving-provider.js';
import { PingCodeAdapter } from './pingcode-adapter.js';
import { MockPingCodeTransport } from './mock-pingcode-transport.js';
import { availableStock, releaseExpired } from '../platform-inventory.js';
import { Environment } from '../environment.js';

/** Database-backed simulation. No network or supplier side effects, including on rollback. */
@Injectable()
export class MockReceivingProvider extends ReceivingProvider {
  readonly source = 'mock' as const;
  constructor(private readonly environment: Environment, readonly reader = new PingCodeAdapter(new MockPingCodeTransport())) { super(); }
  async reserve(client: PoolClient, input: CreateOrderInput, offer: { capability: string; area_prefix: string; duration_days: number | null; receiving_mode: ReceivingMode }) {
    this.requireDocumentedProject();
    await this.lockConnection(client);
    await releaseExpired(client, input.service);
    const { rows } = await client.query<{ id: string }>(
      `SELECT n.id FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id
       JOIN upstream_accounts a ON a.id=n.upstream_account_id
       WHERE a.provider='pingcode-mock' AND a.external_account_id=$8 AND a.storefront_id='linepool' AND a.status='ACTIVE'
         AND a.owner_kind='SELF_SERVICE' AND NOT a.historical_only
         AND n.region_id=$1 AND s.platform_id=$2 AND s.provider='pingcode-mock'
       AND ${availableStock('$7', '$9')} AND n.capability=$4 AND starts_with(n.phone_number,$5)
       AND ($6::text IS NULL OR (n.phone_number ~ '^\\+1[2-9][0-9]{9}$' AND substring(n.phone_number FROM 3 FOR 3)=$6))
       ORDER BY n.created_at,n.id LIMIT $3 FOR UPDATE OF s SKIP LOCKED`,
      [input.region, input.service, input.quantity, offer.capability, offer.area_prefix, input.areaCode ?? null, offer.duration_days, this.environment.selfServiceExternalAccountId, offer.receiving_mode],
    );
    if (rows.length !== input.quantity) throw new ApiFailure(409, 'INSUFFICIENT_STOCK', 'Not enough inventory is currently available');
    return rows.map(row => row.id);
  }
  async allocate(client: PoolClient, input: { userId: string; orderId: string; durationDays: number | null; numberIds: string[] }) {
    this.requireDocumentedProject();
    await this.lockConnection(client);
    // Recheck all reserved resources before inserting any allocation. A delayed Mock delivery never shortens the purchased period.
    const { rows: resources } = await client.query<{ id: string; resource_expires_at: Date; receiving_mode: ReceivingMode; duration_days: number | null }>(`SELECT n.id,n.resource_expires_at,o.receiving_mode,o.duration_days FROM orders o
      JOIN number_platforms s ON s.platform_id=o.service JOIN phone_numbers n ON n.id=s.number_id
      JOIN upstream_accounts a ON a.id=n.upstream_account_id
      WHERE o.id=$1 AND o.user_id=$2 AND n.id=ANY($3::uuid[]) AND s.provider='pingcode-mock'
        AND a.provider='pingcode-mock' AND a.external_account_id=$4 AND a.storefront_id='linepool'
        AND a.owner_kind='SELF_SERVICE' AND NOT a.historical_only AND a.status='ACTIVE' AND a.auth_status='ACTIVE'
        AND a.access_expires_at>clock_timestamp() AND 'SMS_CODE'=ANY(a.enabled_capabilities)
        AND NOT n.source_missing AND NOT n.manual_hold AND n.sale_enabled AND s.is_available AND s.sale_enabled
        AND n.resource_status IN ('LOCAL','ONLINE') AND n.capability='RECEIVE'
        AND (s.reserved_order_id IS NULL OR s.reserved_order_id=o.id)
        AND n.resource_expires_at IS NOT NULL AND isfinite(n.resource_expires_at)
        AND n.resource_expires_at>=clock_timestamp()+CASE WHEN o.receiving_mode='ONE_TIME' THEN interval '15 minutes' ELSE o.duration_days*interval '24 hours' END
        AND NOT EXISTS(SELECT 1 FROM lp_platform_sales sold WHERE sold.phone_number=n.phone_number AND sold.platform_id=s.platform_id)
        AND NOT EXISTS(SELECT 1 FROM number_allocations occupied WHERE occupied.number_id=n.id AND occupied.platform_id=s.platform_id AND occupied.released_at IS NULL)
        AND EXISTS(SELECT 1 FROM provider_resource_bindings b JOIN provider_projects p ON p.provider=b.provider AND p.external_project_id=b.external_project_id
          JOIN platforms f ON f.id=p.platform_id WHERE b.number_id=n.id AND b.provider=s.provider AND b.external_project_id=s.external_project_id
            AND p.platform_id=s.platform_id AND p.upstream_account_id=a.id AND p.is_active AND f.is_active)
      ORDER BY n.id FOR UPDATE OF s FOR SHARE OF n,a`,
    [input.orderId, input.userId, input.numberIds, this.environment.selfServiceExternalAccountId]);
    if (resources.length !== input.numberIds.length) return false;
    const { rows: [clock] } = await client.query<{ delivered_at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS delivered_at");
    if (resources.some(resource => resource.resource_expires_at.getTime() < clock!.delivered_at.getTime()
      + (resource.receiving_mode === 'ONE_TIME' ? 900000 : resource.duration_days! * 86400000))) return false;
    await client.query(`INSERT INTO number_allocations(number_id,platform_id,user_id,order_id,assigned_at,expires_at,receiving_mode,receiving_status,code_rule_snapshot)
      SELECT n.id,o.service,$1,o.id,$4::timestamptz,$4::timestamptz+CASE WHEN o.receiving_mode='ONE_TIME' THEN interval '15 minutes' ELSE o.duration_days*interval '24 hours' END,
        o.receiving_mode,CASE WHEN o.receiving_mode='ONE_TIME' THEN 'WAITING' END,CASE WHEN o.receiving_mode='ONE_TIME' THEN o.product_snapshot->'codeRule' END
      FROM orders o JOIN phone_numbers n ON n.id=ANY($3::uuid[]) WHERE o.id=$2 AND o.user_id=$1`,
    [input.userId, input.orderId, input.numberIds, clock!.delivered_at]);
    return true;
  }
  private async lockConnection(client: PoolClient) {
    await client.query(`SELECT id FROM upstream_accounts WHERE provider='pingcode-mock' AND external_account_id=$1
      AND storefront_id='linepool' AND owner_kind='SELF_SERVICE' AND NOT historical_only FOR SHARE`, [this.environment.selfServiceExternalAccountId]);
  }
  private requireDocumentedProject() {
    if (this.environment.pcProvider === 'pingcode') throw new ApiFailure(409, 'PC_PLATFORM_PROJECT_UNCONFIRMED', 'Real LinePool self-service requires the documented project metadata protocol');
  }
}
