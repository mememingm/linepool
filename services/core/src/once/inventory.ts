import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { DAY, fail } from './lease-common.js';

export type OnceNumber = {
  id: string; phone_number: string; region_id: string; country: string; prefix: string;
  display_metadata: Record<string, unknown>; resource_status: string; resource_expires_at: Date | null;
  manual_hold: boolean; hold_reason: string | null; sale_enabled: boolean; capability: string;
  upstream_account_id: string; upstream_status: string; upstream_ready: boolean; source_missing: boolean;
  pc_capabilities: string[]; external_number_id: string | null; provider: string;
};
export const onceNumberFrom = `FROM phone_numbers n
  JOIN upstream_accounts u ON u.id=n.upstream_account_id
  JOIN storefronts s ON s.id=u.storefront_id JOIN regions r ON r.id=n.region_id
  LEFT JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=u.provider`;
export const onceNumberFields = `n.*,r.name AS country,r.prefix,b.external_number_id,u.status AS upstream_status,u.provider,
  (u.status='ACTIVE' AND u.auth_status='ACTIVE' AND u.access_expires_at>now()
    AND 'NUMBER_LEASE'=ANY(u.enabled_capabilities)) AS upstream_ready`;
export const onceSelfService = `u.provider=$2 AND u.external_account_id=$1
  AND u.storefront_id='once' AND u.owner_kind='SELF_SERVICE' AND u.agent_id IS NULL
  AND NOT u.historical_only AND s.product='NUMBER_LEASE'`;
export const trustedOnce = `${onceSelfService} AND u.status='ACTIVE' AND u.auth_status='ACTIVE'
  AND u.access_expires_at>now() AND 'NUMBER_LEASE'=ANY(u.enabled_capabilities)`;
export const onceSaleAvailable = `n.sale_enabled AND NOT n.manual_hold
  AND n.resource_status IN ('LOCAL','ONLINE') AND isfinite(n.resource_expires_at)
  AND n.resource_expires_at>now() AND b.external_number_id IS NOT NULL
  AND NOT n.source_missing AND 'NUMBER_LEASE'=ANY(n.pc_capabilities)
  AND NOT EXISTS(SELECT 1 FROM leases l WHERE l.number_id=n.id AND l.status IN ('ACTIVE','EXPIRED_HELD'))
  AND NOT EXISTS(SELECT 1 FROM whole_number_reservations w WHERE w.number_id=n.id)
  AND NOT EXISTS(SELECT 1 FROM orders pending WHERE pending.target_number_id=n.id AND pending.fulfillment_status='PROCESSING')
  AND NOT EXISTS(SELECT 1 FROM number_allocations a WHERE a.number_id=n.id
    AND LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at))>GREATEST(a.assigned_at,now()))
  AND EXISTS(SELECT 1 FROM lease_plans p WHERE p.storefront_id='once' AND p.active
    AND n.resource_expires_at>=now()+p.days*interval '24 hours')`;
export function numberView(n: OnceNumber) {
  return { id: n.id, number: n.phone_number, countryCode: n.region_id.toUpperCase(), countryName: n.country, demo: n.provider === 'pingcode-mock',
    regionId: n.display_metadata?.regionId ?? null, regionName: n.display_metadata?.regionName ?? null };
}
/** Accepting a purchase requires the caller to lock its physical number first. */
export async function assertWholeAvailable(client: PoolClient, n: OnceNumber, leaseId: string | null, days: number, orderId: string | null = null) {
  if (!n.upstream_ready || n.source_missing || !n.pc_capabilities.includes('NUMBER_LEASE') || n.manual_hold || !n.sale_enabled || !['LOCAL', 'ONLINE'].includes(n.resource_status) || !n.external_number_id) {
    fail('NUMBER_UNAVAILABLE', 'Number is held or unavailable');
  }
  const { rows: [tail] } = await client.query<{ ends: Date | null; checked_at: Date }>(
    `SELECT max(expires_at) AS ends,clock_timestamp() AS checked_at FROM number_allocations WHERE lease_id=$1 AND released_at IS NULL`, [leaseId]);
  const start = Math.max(new Date(tail!.checked_at).getTime(), tail?.ends ? new Date(tail.ends).getTime() : 0);
  if (!n.resource_expires_at || !Number.isFinite(new Date(n.resource_expires_at).getTime())
    || new Date(n.resource_expires_at).getTime() < start + days * DAY) {
    fail('RESOURCE_COVERAGE_INSUFFICIENT', 'Confirmed finite PC resource expiry does not cover this service');
  }
  const conflict = await client.query(`SELECT 1 FROM number_allocations WHERE number_id=$1
      AND lease_id IS DISTINCT FROM $2::uuid AND LEAST(expires_at,COALESCE(released_at,expires_at))>GREATEST(assigned_at,now())
    UNION ALL SELECT 1 FROM whole_number_reservations WHERE number_id=$1
    UNION ALL SELECT 1 FROM orders WHERE target_number_id=$1 AND fulfillment_status='PROCESSING' AND id IS DISTINCT FROM $3::uuid
    UNION ALL SELECT 1 FROM leases WHERE number_id=$1 AND status IN ('ACTIVE','EXPIRED_HELD')
      AND id IS DISTINCT FROM $2::uuid LIMIT 1`, [n.id, leaseId, orderId]);
  if (conflict.rowCount) fail('NUMBER_UNAVAILABLE', 'Number has an allocation, pending purchase or held lease');
}
@Injectable()
export class OnceInventory {
  constructor(private readonly db: Database, private readonly environment: Environment) {}
  async list() {
    const { rows } = await this.db.query<OnceNumber>(`SELECT ${onceNumberFields} ${onceNumberFrom}
      WHERE ${trustedOnce} AND ${onceSaleAvailable} ORDER BY n.phone_number,n.id`, [this.environment.selfServiceExternalAccountId, this.environment.pcProvider]);
    return rows.map(numberView);
  }
  async detail(id: string, client?: PoolClient, lock = false, requireActive = true) {
    const connection: Pick<Database, 'query'> = client ?? this.db;
    const { rows: [row] } = await connection.query<OnceNumber>(`SELECT ${onceNumberFields} ${onceNumberFrom}
      WHERE ${requireActive ? trustedOnce : onceSelfService} AND n.id=$3 ${lock ? 'FOR UPDATE OF n' : ''}`,
      [this.environment.selfServiceExternalAccountId, this.environment.pcProvider, id]);
    if (!row) fail('NUMBER_NOT_FOUND', 'Number not found', 404);
    return row;
  }
}
