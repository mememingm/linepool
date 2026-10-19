import pg from 'pg';
import { seedDemo } from '../db/demo-seed.js';
import { Environment } from '../src/environment.js';

const environment = new Environment();
if (environment.values.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production');
const client = new pg.Client({ connectionString: environment.values.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const result = await seedDemo(client, {
    email: process.env.DEMO_EMAIL ?? '', password: process.env.DEMO_PASSWORD ?? '', displayName: 'LINEPOOL Demo',
  });
  console.log(result.created ? 'Created local demo account and fixtures' : 'Existing demo account preserved; password, balance, orders and read flags were not reset');
  console.log('Demo catalog ready: 6 regions, 3 services, 2 plans, 720 synthetic inventory rows');
} catch {
  console.error('Seed failed; verify local configuration and database state');
  process.exitCode = 1;
} finally {
  await client.end();
}
