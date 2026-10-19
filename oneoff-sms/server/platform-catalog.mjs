import { readFileSync } from 'node:fs';
import { transaction } from './db.mjs';

const platforms = JSON.parse(readFileSync(new URL('../shared/platforms.json', import.meta.url), 'utf8'));
const countries = [['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada']];

export function syncPlatformCatalog(db) {
  transaction(db, () => {
    const insertService = db.prepare('INSERT OR IGNORE INTO services (id,name) VALUES (?,?)');
    const findService = db.prepare('SELECT id FROM services WHERE name = ?');
    const findProduct = db.prepare('SELECT 1 FROM products WHERE service_id = ? AND country_code = ?');
    const insertProduct = db.prepare(`INSERT OR IGNORE INTO products
      (id,service,service_id,country,country_code,price_cents,currency,duration_seconds,enabled,can_cancel,description,icon_key)
      VALUES (?,?,?,?,?,120,'USD',1200,1,1,?,?)`);
    for (const platform of platforms) {
      insertService.run(platform.id, platform.name);
      const serviceId = findService.get(platform.name)?.id;
      if (!serviceId) continue;
      for (const [code, country] of countries) {
        if (findProduct.get(serviceId, code)) continue;
        insertProduct.run(`${serviceId}-${code.toLowerCase()}`, platform.name, serviceId, country, code,
          'Local demo catalog only. Price and duration are illustrative; platform compatibility and number inventory are not configured by catalog import.', platform.id);
      }
    }
    // A logo establishes catalog identity, never number compatibility or inventory.
  });
}
