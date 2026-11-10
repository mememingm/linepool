import type { PoolClient } from 'pg';

export const linePoolOrderScope = (order = 'o') => `${order}.product_type='SMS_CODE' AND ${order}.sales_storefront_id='linepool'`;
/** A connection whose numbers the LinePool storefront sells: an ACTIVE shop's agent connection (unified agent model). */
export const shopConnection = (account: string) => `EXISTS(SELECT 1 FROM shops resource_shop
  WHERE resource_shop.connection_id=${account}.id AND resource_shop.site_id='linepool' AND resource_shop.status='ACTIVE')`;
/** Storefront resources: numbers of an ACTIVE shop's connection, or of the legacy self-service connection (Mock mode). */
export const linePoolResourceScope = (number = 'n') => `EXISTS(SELECT 1 FROM upstream_accounts resource_account
  JOIN storefronts resource_store ON resource_store.id=resource_account.storefront_id
  WHERE resource_account.id=${number}.upstream_account_id AND resource_account.storefront_id='linepool'
    AND (resource_account.owner_kind='SELF_SERVICE' OR ${shopConnection('resource_account')}) AND resource_store.product='SMS_CODE')`;
export const linePoolAllocationScope = (allocation = 'a') => `${allocation}.allocation_type='PLATFORM'
  AND EXISTS(SELECT 1 FROM phone_numbers scope_number WHERE scope_number.id=${allocation}.number_id AND ${linePoolResourceScope('scope_number')})
  AND (${allocation}.order_id IS NULL OR EXISTS(SELECT 1 FROM orders scope_order WHERE scope_order.id=${allocation}.order_id AND ${linePoolOrderScope('scope_order')}))`;
export const linePoolMessageScope = (message = 'm') => `EXISTS(SELECT 1 FROM number_allocations scope_allocation
  WHERE scope_allocation.id=${message}.allocation_id AND scope_allocation.number_id=${message}.number_id
  AND scope_allocation.user_id=${message}.user_id AND scope_allocation.platform_id=${message}.platform_id AND ${linePoolAllocationScope('scope_allocation')}
  AND (scope_allocation.receiving_mode='HOSTED' OR (scope_allocation.receiving_status='SUCCESS' AND scope_allocation.first_message_id=${message}.id)))`;

/** Real shop slot under a LinePool-local project (see pc/local-inventory.ts): PC binds the number without a project,
 * and (plan B, migration 050) a number PC returns without an expiry has no known limit. Mock slots keep strict rules. */
const localSlot = "(s.provider='pingcode' AND starts_with(s.external_project_id,'lp:'))";

/** Shared stock predicate. Alias n=physical number, s=number/platform inventory slot. */
export function availableStock(duration: string, mode = "'HOSTED'") {
  return `s.is_available AND s.sale_enabled AND s.reserved_order_id IS NULL
    AND n.sale_enabled AND n.resource_status IN ('LOCAL','ONLINE')
    AND ${linePoolResourceScope()} AND NOT n.manual_hold
    AND NOT n.source_missing
    AND NOT EXISTS(SELECT 1 FROM lp_platform_sales sold WHERE sold.phone_number=n.phone_number AND sold.platform_id=s.platform_id)
    AND NOT EXISTS(SELECT 1 FROM number_allocations pending JOIN phone_numbers pending_number ON pending_number.id=pending.number_id
      WHERE pending_number.phone_number=n.phone_number AND pending.platform_id=s.platform_id AND pending.receiving_status='WAITING')
    AND EXISTS(SELECT 1 FROM upstream_accounts resource_account WHERE resource_account.id=n.upstream_account_id
      AND resource_account.status='ACTIVE' AND NOT resource_account.historical_only AND resource_account.auth_status='ACTIVE'
      AND resource_account.access_expires_at>now() AND 'SMS_CODE'=ANY(resource_account.enabled_capabilities))
    AND EXISTS(SELECT 1 FROM provider_projects p JOIN platforms f ON f.id=p.platform_id
      WHERE p.provider=s.provider AND p.external_project_id=s.external_project_id AND p.platform_id=s.platform_id AND p.upstream_account_id=n.upstream_account_id
      AND p.is_active AND f.is_active)
    AND EXISTS(SELECT 1 FROM provider_resource_bindings binding WHERE binding.number_id=n.id AND binding.provider=s.provider
      AND (binding.external_project_id=s.external_project_id OR (${localSlot} AND binding.external_project_id IS NULL)))
    AND ((${localSlot} AND n.resource_expires_at IS NULL) OR (n.resource_expires_at IS NOT NULL AND isfinite(n.resource_expires_at)
      AND n.resource_expires_at>=clock_timestamp()+CASE WHEN ${mode}='ONE_TIME' THEN interval '15 minutes' ELSE ${duration}*interval '24 hours' END))
    AND NOT EXISTS(SELECT 1 FROM number_allocations a WHERE a.number_id=s.number_id
      AND (a.allocation_type='WHOLE_NUMBER' OR a.platform_id=s.platform_id) AND a.released_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM whole_number_reservations reservation WHERE reservation.number_id=n.id)
    AND NOT EXISTS(SELECT 1 FROM leases lease WHERE lease.number_id=n.id AND lease.status IN ('ACTIVE','EXPIRED_HELD'))`;
}

export const receivingOfferEligibility = (offer = 'o') => `((${offer}.receiving_mode='HOSTED' AND ${offer}.duration_days IN (7,30) AND ${offer}.window_minutes IS NULL)
  OR (${offer}.receiving_mode='ONE_TIME' AND ${offer}.duration_days IS NULL AND ${offer}.window_minutes=15 AND EXISTS(
    SELECT 1 FROM lp_platform_code_rules code_rule WHERE code_rule.platform_id=${offer}.service AND code_rule.enabled)))`;

/** Available for at least one explicitly priced, active receiving product. */
export function sellableStock() {
  return `EXISTS(SELECT 1 FROM offers stock_offer WHERE stock_offer.region_id=n.region_id AND stock_offer.service=s.platform_id
    AND stock_offer.is_active AND stock_offer.capability=n.capability AND NOT stock_offer.allow_renewal
    AND starts_with(n.phone_number,stock_offer.area_prefix) AND ${receivingOfferEligibility('stock_offer')}
    AND ${availableStock('stock_offer.duration_days', 'stock_offer.receiving_mode')})`;
}

export async function releaseExpired(client: PoolClient, platform?: string, limit = 500) {
  // Periods are half-open [assigned_at, expires_at). Closing a service never closes other platforms.
  return client.query(`WITH due AS (
    SELECT a.id FROM number_allocations a WHERE ${linePoolAllocationScope()} AND a.released_at IS NULL AND a.expires_at<=now()
    AND a.receiving_status IS DISTINCT FROM 'WAITING'
    AND ($1::text IS NULL OR a.platform_id=$1) ORDER BY a.expires_at,a.id LIMIT $2 FOR UPDATE OF a SKIP LOCKED
  ), closed AS (
    UPDATE number_allocations a SET released_at=a.expires_at,release_reason='EXPIRED'
    FROM due WHERE a.id=due.id RETURNING a.id
  ) INSERT INTO number_lifecycle_events(allocation_id,reason)
    SELECT id,'EXPIRED' FROM closed ON CONFLICT(allocation_id) DO NOTHING`, [platform ?? null, limit]);
}
