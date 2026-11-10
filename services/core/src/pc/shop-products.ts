import { Injectable } from '@nestjs/common';
import type { User } from '@linepool/contracts';
import { storefrontRegionIds } from '@linepool/contracts';
import type { AgentShop, ShopProduct, ShopProductInput } from '@linepool/contracts/admin';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';
import { availableStock } from '../platform-inventory.js';

export type ShopProductRow = {
  id: string; shop_id: string; region_id: ShopProduct['region']; platform_id: string; platform_name: string; duration_days: number; plan: string;
  name: string; unit_points: number; is_active: boolean; admin_hold: boolean; admin_hold_reason: string | null; version: number;
  available_count: number; updated_at: Date;
};
/** Shop products with the number of that shop's numbers currently sellable for each. Aliases: sp, sh, f. */
export const shopProductSelect = `SELECT sp.*,f.name AS platform_name,sh.kind AS shop_kind,
  (SELECT count(*)::int FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id
    WHERE n.upstream_account_id=sh.connection_id AND n.region_id=sp.region_id AND s.platform_id=sp.platform_id
      AND s.provider='pingcode' AND n.capability='RECEIVE' AND ${availableStock('sp.duration_days')}) AS available_count
  FROM shop_products sp JOIN shops sh ON sh.id=sp.shop_id JOIN platforms f ON f.id=sp.platform_id`;
export const shopProductView = (row: ShopProductRow): ShopProduct => ({
  id: row.id, shopId: row.shop_id, region: row.region_id, platformId: row.platform_id, platformName: row.platform_name,
  durationDays: row.duration_days, plan: row.plan, name: row.name, unitPoints: row.unit_points, isActive: row.is_active,
  adminHold: row.admin_hold, adminHoldReason: row.admin_hold_reason, version: row.version, availableCount: row.available_count,
  updatedAt: row.updated_at.toISOString(),
});

/** "Each shop sells its own": only the agent who runs an ACTIVE shop edits that shop's products and prices. */
@Injectable()
export class ShopProducts {
  constructor(private readonly db: Database, private readonly environment: Environment) {}
  private requireSite() {
    if (this.environment.siteId !== 'linepool') throw new ApiFailure(404, 'NOT_FOUND', 'Shops are unavailable on this site');
  }
  async own(user: User): Promise<AgentShop> {
    this.requireSite();
    if (user.authKind !== 'PINCLODE' || !user.agentId) throw new ApiFailure(403, 'PC_AGENT_REQUIRED', 'PinClode agent login is required');
    const { rows: [shop] } = await this.db.query<{ id: string; kind: 'OFFICIAL' | 'AGENT' }>(
      `SELECT id,kind FROM shops WHERE agent_id=$1 AND site_id='linepool' AND status='ACTIVE'`, [user.agentId]);
    const [products, platforms] = await Promise.all([
      shop ? this.db.query<ShopProductRow>(`${shopProductSelect} WHERE sp.shop_id=$1 ORDER BY sp.region_id,sp.platform_id,sp.duration_days`, [shop.id]) : { rows: [] },
      this.db.query<{ id: string; name: string }>('SELECT id,name FROM platforms WHERE is_active ORDER BY created_at,id'),
    ]);
    return { shop: shop ?? null, products: products.rows.map(shopProductView), platforms: platforms.rows, regions: [...storefrontRegionIds] };
  }
  /** Create (no id) or update a product of the caller's own shop. Region, platform and duration identify a product. */
  async save(user: User, input: ShopProductInput, id?: string) {
    this.requireSite();
    if (user.authKind !== 'PINCLODE' || !user.agentId) throw new ApiFailure(403, 'PC_AGENT_REQUIRED', 'PinClode agent login is required');
    if (!storefrontRegionIds.some(region => region === input.region)) throw new ApiFailure(409, 'REGION_NOT_AVAILABLE', 'This region is not open for storefront sales');
    return this.db.transaction(async client => {
      const { rows: [shop] } = await client.query<{ id: string }>(
        `SELECT id FROM shops WHERE agent_id=$1 AND site_id='linepool' AND status='ACTIVE' FOR SHARE`, [user.agentId]);
      if (!shop) throw new ApiFailure(409, 'SHOP_NOT_OPEN', 'This agent does not run an active shop');
      const platform = await client.query('SELECT 1 FROM platforms WHERE id=$1 AND is_active FOR SHARE', [input.platformId]);
      if (!platform.rowCount) throw new ApiFailure(404, 'PLATFORM_NOT_FOUND', 'Platform is unavailable');
      if (id) {
        const { rows: [before] } = await client.query<{ region_id: string; platform_id: string; duration_days: number }>(
          'SELECT region_id,platform_id,duration_days FROM shop_products WHERE id=$1 AND shop_id=$2 FOR UPDATE', [id, shop.id]);
        if (!before) throw new ApiFailure(404, 'NOT_FOUND', 'Shop product not found');
        if (before.region_id !== input.region || before.platform_id !== input.platformId || before.duration_days !== input.durationDays) {
          throw new ApiFailure(409, 'SHOP_PRODUCT_IDENTITY', 'Country, platform and duration cannot change; create another product instead');
        }
        await client.query(`UPDATE shop_products SET name=$3,unit_points=$4,is_active=$5,version=version+1,updated_at=now()
          WHERE id=$1 AND shop_id=$2`, [id, shop.id, input.name, input.unitPoints, input.isActive]);
        return { id };
      }
      const { rows: [created] } = await client.query<{ id: string }>(`INSERT INTO shop_products(shop_id,region_id,platform_id,duration_days,name,unit_points,is_active)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(shop_id,region_id,platform_id,duration_days) DO NOTHING RETURNING id`,
      [shop.id, input.region, input.platformId, input.durationDays, input.name, input.unitPoints, input.isActive]);
      if (!created) throw new ApiFailure(409, 'SHOP_PRODUCT_EXISTS', 'This shop already has a product for that country, platform and duration');
      return { id: created.id };
    });
  }
}
