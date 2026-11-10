import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrateDatabase } from '../../db/migrate.js';
import { Database } from '../../src/database.js';
import { Environment } from '../../src/environment.js';
import { runIntegrationTests } from './cases.js';

// Explicit maintenance credentials only: never load .env or fall back to DATABASE_URL/PG*.
function targets() {
  if (process.env.NODE_ENV === 'production') throw new Error('Integration tests are disabled in production');
  let admin: URL;
  try { admin = new URL(process.env.TEST_DATABASE_ADMIN_URL ?? ''); }
  catch { throw new Error('TEST_DATABASE_ADMIN_URL must explicitly name the local postgres maintenance database'); }
  if (!['postgres:', 'postgresql:'].includes(admin.protocol) || admin.hostname !== '127.0.0.1'
    || !/^\d+$/.test(admin.port) || Number(admin.port) < 1 || Number(admin.port) > 65535 || Number(admin.port) === 5432
    || !admin.username || !admin.password || admin.pathname !== '/postgres' || admin.search || admin.hash) {
    throw new Error('Maintenance URL requires credentials, host 127.0.0.1, a non-5432 port, /postgres, and no URL options');
  }
  const database = `linepool_itest_${randomBytes(8).toString('hex')}_itest`;
  const target = new URL(admin.href);
  target.pathname = `/${database}`;
  // Hard-coded target policy; no environment flag can permit sandbox, remote hosts or another database name.
  if (target.hostname !== '127.0.0.1' || Number(target.port) === 5432
    || !/^linepool_itest_[a-f0-9]{16}_itest$/.test(database) || !database.endsWith('_itest')) {
    throw new Error('Integration target must be a fresh local linepool_itest_<suffix>_itest database');
  }
  const config = {
    host: '127.0.0.1', port: Number(admin.port),
    user: decodeURIComponent(admin.username), password: decodeURIComponent(admin.password),
    ssl: false, options: '-c search_path=public', connectionTimeoutMillis: 5000,
  };
  return { database, target, adminConfig: { ...config, database: 'postgres' }, testConfig: { ...config, database } };
}

function environment(target: URL, mode: 'mock' | 'real') {
  const previous = process.env;
  try {
    // The existing NODE_ENV=test helper permits *_test, not *_itest. This harness enforces its own stricter
    // database boundary above and supplies a completely isolated development configuration to the services.
    process.env = {
      NODE_ENV: 'development', SITE_ID: 'linepool', DATABASE_URL: target.href, PC_MODE: mode,
      LOCAL_SANDBOX: 'false', PROCESS_ROLE: 'api',
      // Only the SQL-backed shop ordering/delivery classes are constructed; no real provider client exists.
      PC_BASE_URL: 'http://127.0.0.1:1', PC_CLIENT_SECRET: 'itest-local-unused',
      PC_APPLICATION_ID: 'itest-linepool', PC_ISSUER: 'itest-local',
      PC_AUTH_CALLBACK_URL: 'http://127.0.0.1:5178/api/pc/auth/callback', PC_NUMBER_REGION: 'us',
    };
    return new Environment();
  } finally {
    process.env = previous;
  }
}

async function assertIdentity(client: pg.Client, database: string, port: number) {
  const { rows: [identity] } = await client.query<{ database: string; host: string; port: number }>(
    'SELECT current_database() AS database, host(inet_server_addr()) AS host, inet_server_port() AS port');
  assert.deepEqual(identity, { database, host: '127.0.0.1', port });
}

async function main() {
  const { database, target, adminConfig, testConfig } = targets();
  const admin = new pg.Client(adminConfig);
  let created = false;
  let db: Database | undefined;
  try {
    // /postgres is used only for database lifecycle SQL; all migrations, fixtures and tests use the generated target.
    await admin.connect();
    await assertIdentity(admin, 'postgres', adminConfig.port);
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    created = true;
    await admin.query(`ALTER DATABASE "${database}" SET app.site_id='linepool'`);
    console.log(`Created integration database ${database}`);
    const migration = new pg.Client(testConfig);
    try {
      await migration.connect();
      await assertIdentity(migration, database, testConfig.port);
      const applied = await migrateDatabase(migration, new URL('../../../../db/migrations/', import.meta.url));
      console.log(`Applied ${applied.length} migrations`);
    } finally {
      await migration.end();
    }
    const mock = environment(target, 'mock');
    const shop = environment(target, 'real');
    db = new Database(mock);
    await runIntegrationTests(db, mock, shop);
  } finally {
    try {
      await db?.onModuleDestroy();
    } finally {
      try {
        if (created) {
          await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
          console.log(`Dropped integration database ${database}`);
        }
      } finally {
        await admin.end();
      }
    }
  }
}

try {
  await main();
} catch (error) {
  console.error('Integration harness failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
}
