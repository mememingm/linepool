import pg from 'pg';
import { migrateDatabase } from '../db/migrate.js';
import { Environment } from '../src/environment.js';

const environment = new Environment();
const target = new URL(environment.values.DATABASE_URL);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
  throw new Error('Database migrations are restricted to a local development database');
}
const client = new pg.Client({ connectionString: environment.values.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const { rows: [site] } = await client.query<{ site_id: string | null }>("SELECT current_setting('app.site_id',true) AS site_id");
  if (site?.site_id !== environment.siteId) throw new Error('Database app.site_id must match SITE_ID before migration');
  const applied = await migrateDatabase(client, new URL('../../../db/migrations/', import.meta.url));
  console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Migrations unchanged');
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
} finally {
  await client.end();
}
