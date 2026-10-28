import type { PoolClient } from 'pg';
import { ApiFailure } from './http.js';

/** Distribution is a view of the same number x platform stock sold by the storefront. */
export const sharedAgentStockSql = `(
  SELECT COALESCE(link.id,p.id) AS id,p.id AS inventory_id,p.provider,p.platform_id,p.external_project_id,
    binding.external_number_id,n.phone_number,n.region_id,n.resource_status,n.resource_expires_at,
    CASE WHEN allocation.id IS NOT NULL THEN 'ALLOCATED'
      -- Storefront/F1 availability remains limited to US resources.
      WHEN n.region_id='us' AND p.is_available AND p.sale_enabled AND n.sale_enabled
        AND p.reserved_order_id IS NULL AND n.resource_status IN ('LOCAL','ONLINE')
        AND project.is_active AND platform.is_active
        AND (n.resource_expires_at IS NULL OR n.resource_expires_at>now())
        AND (p.provider<>'pingcode' OR (n.resource_status='ONLINE' AND n.resource_expires_at IS NOT NULL))
        THEN 'AVAILABLE'
      -- Linked agent stock is a separate distribution path and may include non-US resources.
      WHEN link.id IS NOT NULL AND link.status='AVAILABLE' AND p.is_available
        AND p.reserved_order_id IS NULL AND n.resource_status IN ('LOCAL','ONLINE')
        AND project.is_active AND platform.is_active
        AND (n.resource_expires_at IS NULL OR n.resource_expires_at>now())
        AND (p.provider<>'pingcode' OR (n.resource_status='ONLINE' AND n.resource_expires_at IS NOT NULL))
        THEN 'AVAILABLE' ELSE 'RELEASED' END AS status,
    CASE WHEN allocation.agent_entitlement_id IS NOT NULL THEN link.holding_id ELSE NULL END AS holding_id,
    COALESCE(link.imported_at,p.synced_at) AS imported_at,link.import_idempotency_key
  FROM number_platforms p JOIN phone_numbers n ON n.id=p.number_id
  JOIN provider_projects project ON project.provider=p.provider AND project.external_project_id=p.external_project_id
    AND project.platform_id=p.platform_id
  JOIN platforms platform ON platform.id=p.platform_id
  LEFT JOIN agent_number_stock link ON link.inventory_id=p.id
  LEFT JOIN provider_resource_bindings binding ON binding.provider=p.provider AND binding.number_id=n.id
  LEFT JOIN number_allocations allocation ON allocation.number_id=p.number_id AND allocation.platform_id=p.platform_id
    AND allocation.released_at IS NULL
  WHERE (n.region_id='us' OR link.id IS NOT NULL)
    AND (allocation.id IS NULL OR allocation.agent_entitlement_id IS NOT NULL)
)`;

export type SharedStockRow = Record<string, unknown> & {
  id: string; inventory_id: string; platform_id: string; phone_number: string; region_id: string;
  status: 'AVAILABLE' | 'ALLOCATED' | 'RELEASED'; resource_status: string; resource_expires_at: Date | null;
};

export async function sharedStockRows(client: PoolClient, ids: string[], lock = false) {
  if (lock) {
    // The storefront locks these exact platform rows too; both sales channels share one reservation boundary.
    await client.query(`SELECT p.id FROM number_platforms p LEFT JOIN agent_number_stock link ON link.inventory_id=p.id
      WHERE link.id=ANY($1::uuid[]) OR p.id=ANY($1::uuid[]) ORDER BY p.id FOR UPDATE OF p`, [ids]);
  }
  const { rows } = await client.query<SharedStockRow>(
    `SELECT s.* FROM ${sharedAgentStockSql} s WHERE s.id=ANY($1::uuid[]) OR s.inventory_id=ANY($1::uuid[])
     ORDER BY COALESCE(array_position($1::uuid[],s.id),array_position($1::uuid[],s.inventory_id))`, [ids]);
  if (rows.length !== ids.length) throw new ApiFailure(409, 'STOCK_UNAVAILABLE', '号码已被分配或不在可分配的总库存中，请刷新后重试');
  return rows;
}

export async function ensureStockLinks(client: PoolClient, rows: Record<string, unknown>[]) {
  for (const row of rows) {
    await client.query(`INSERT INTO agent_number_stock(id,inventory_id,provider,platform_id,external_project_id,
      external_number_id,phone_number,region_id,resource_status,resource_expires_at,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'AVAILABLE') ON CONFLICT(inventory_id) DO NOTHING`,
    [row.id,row.inventory_id,row.provider,row.platform_id,row.external_project_id,row.external_number_id,
      row.phone_number,row.region_id,row.resource_status,row.resource_expires_at]);
  }
}
