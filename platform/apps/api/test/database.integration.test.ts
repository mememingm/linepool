import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { runMigrations } from '../scripts/migrate.js';
import { seedDatabase } from '../scripts/seed.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('database bootstrap', () => {
  const pool = new Pool({ connectionString: testDatabaseUrl });

  beforeAll(async () => {
    const database = new URL(testDatabaseUrl as string).pathname.slice(1);
    if (!database.endsWith('_test')) {
      throw new Error('Refusing to reset a database whose name does not end with _test');
    }

    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies migrations once and seeds stable demo records idempotently', async () => {
    const seed = {
      email: 'database-test@linepool.local',
      password: 'database-test-password',
      displayName: 'Database Test User',
    };

    await seedDatabase(pool, seed);
    await runMigrations(pool);
    await seedDatabase(pool, seed);

    const result = await pool.query<{
      users: string;
      projects: string;
      plans: string;
      orders: string;
      numbers: string;
      messages: string;
    }>(`
      SELECT
        (SELECT count(*) FROM users)::text AS users,
        (SELECT count(*) FROM projects)::text AS projects,
        (SELECT count(*) FROM plans)::text AS plans,
        (SELECT count(*) FROM orders)::text AS orders,
        (SELECT count(*) FROM phone_numbers)::text AS numbers,
        (SELECT count(*) FROM sms_messages)::text AS messages
    `);

    expect(result.rows[0]).toEqual({
      users: '1',
      projects: '3',
      plans: '5',
      orders: '1',
      numbers: '16',
      messages: '2',
    });
  });
});
