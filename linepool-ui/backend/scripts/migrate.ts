import pg from 'pg';
import { migrateDatabase } from '../db/migrate.js';
import { Environment } from '../src/environment.js';

const environment = new Environment();
const client = new pg.Client({ connectionString: environment.values.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const applied = await migrateDatabase(client, new URL('../../../db/migrations/', import.meta.url));
  console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Migrations unchanged');
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
} finally {
  await client.end();
}
