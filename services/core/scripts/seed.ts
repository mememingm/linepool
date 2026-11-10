import pg from 'pg';
import { seedDemo } from '../db/demo-seed.js';
import { Environment } from '../src/environment.js';

const environment = new Environment();
if (environment.values.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production');
if (environment.siteId !== 'linepool') throw new Error('LinePool demo fixtures must not be seeded into the ONCE database');
const client = new pg.Client({ connectionString: environment.values.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const { rows: [site] } = await client.query<{ site_id: string | null }>("SELECT current_setting('app.site_id',true) AS site_id");
  if (site?.site_id !== environment.siteId) throw new Error('Database app.site_id must match SITE_ID before seeding');
  const result = await seedDemo(client, {
    email: process.env.DEMO_EMAIL ?? '', password: process.env.DEMO_PASSWORD ?? '', displayName: `${environment.siteName} Demo`,
  }, environment.selfServiceExternalAccountId);
  console.log(result.created ? 'Created local demo account and fixtures' : 'Existing demo account preserved; password, balance, orders and read flags were not reset');
  console.log('Demo catalog ready: US, 3 services, 2 plans and 120 synthetic inventory rows; existing rows preserved');
} catch {
  console.error('Seed failed; verify local configuration and database state');
  process.exitCode = 1;
} finally {
  await client.end();
}
