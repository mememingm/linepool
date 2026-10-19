import pg from 'pg';
import { migrateDatabase } from '../db/migrate.js';
import { seedDemo } from '../db/demo-seed.js';
import { assertTestConnection, validateTestAdmin, validateTestDatabase } from '../src/test-database.js';

async function initialize() {
  if (process.argv.length !== 3 || process.argv[2] !== '--initialize') {
    throw new Error('Explicit --initialize is required; this command never resets or drops databases');
  }
  const target = validateTestDatabase(process.env);
  const adminUrl = validateTestAdmin(process.env, target);
  const owner = decodeURIComponent(target.url.username);
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(owner)) throw new Error('Test owner must be a lowercase PostgreSQL role identifier');
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  try {
    await admin.connect();
    await assertTestConnection(sql => admin.query(sql), { ...target, database: 'postgres' });
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [target.database]);
    if (!rows.length) await admin.query(`CREATE DATABASE "${target.database}" OWNER "${owner}"`);
  } finally {
    await admin.end();
  }
  const client = new pg.Client({ connectionString: target.connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await assertTestConnection(sql => client.query(sql), target);
    await migrateDatabase(client, new URL('../../../db/migrations/', import.meta.url));
    await seedDemo(client, { email: 'test-demo@example.invalid', password: 'isolated-demo-fixture', displayName: 'Isolated test demo' });
    console.log('Isolated test database initialized; existing records were preserved');
  } finally {
    await client.end();
  }
}

initialize().catch(() => {
  console.error('Test database initialization refused or failed; check isolated test configuration and permissions');
  process.exitCode = 1;
});
