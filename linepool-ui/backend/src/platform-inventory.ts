import type { PoolClient } from 'pg';

/** Shared stock predicate. Alias n=physical number, s=number/platform inventory slot. */
export function availableStock(duration: string) {
  return `s.is_available AND s.sale_enabled AND s.reserved_order_id IS NULL
    AND n.sale_enabled AND n.resource_status IN ('LOCAL','ONLINE')
    AND EXISTS(SELECT 1 FROM provider_projects p JOIN platforms f ON f.id=p.platform_id
      WHERE p.provider=s.provider AND p.external_project_id=s.external_project_id AND p.platform_id=s.platform_id
      AND p.is_active AND f.is_active)
    AND (s.provider='pingcode-mock' OR (n.resource_status='ONLINE' AND n.resource_expires_at>=now()+(${duration}*interval '1 day')))
    AND NOT EXISTS(SELECT 1 FROM number_allocations a WHERE a.number_id=s.number_id
      AND a.platform_id=s.platform_id AND a.released_at IS NULL)`;
}

export async function releaseExpired(client: PoolClient, platform?: string, limit = 500) {
  // Periods are half-open [assigned_at, expires_at). Closing a service never closes other platforms.
  return client.query(`WITH due AS (
    SELECT id FROM number_allocations WHERE released_at IS NULL AND expires_at<=now()
    AND ($1::text IS NULL OR platform_id=$1) ORDER BY expires_at,id LIMIT $2 FOR UPDATE SKIP LOCKED
  ), closed AS (
    UPDATE number_allocations a SET released_at=a.expires_at,release_reason='EXPIRED'
    FROM due WHERE a.id=due.id RETURNING a.id
  ) INSERT INTO number_lifecycle_events(allocation_id,reason)
    SELECT id,'EXPIRED' FROM closed ON CONFLICT(allocation_id) DO NOTHING`, [platform ?? null, limit]);
}
