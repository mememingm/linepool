import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { Environment } from '../src/environment.js';

// Operational data audit, not a test: one read-only snapshot, no schema or data mutations.
const environment = new Environment();
const client = new pg.Client({ connectionString: environment.values.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const migration = await readFile(new URL('../../../db/migrations/009_sms_allocation_ownership.sql', import.meta.url), 'utf8');
  const start = migration.indexOf('SELECT m.id AS message_id,');
  const end = migration.indexOf(';', start);
  if (start < 0 || end < start) throw new Error('Allocation resolution SQL not found');
  const { rows: [tables] } = await client.query<{ receipts: string | null }>("SELECT to_regclass('provider_message_receipts')::text AS receipts");
  // 008 may exist in source but not yet be applied locally. No receipts means no receipt evidence.
  const resolution = migration.slice(start, end).replace('provider_message_receipts p', tables!.receipts
    ? 'provider_message_receipts p' : '(SELECT NULL::uuid AS message_id,NULL::uuid AS allocation_id WHERE false) p');
  const { rows: counts } = await client.query(`WITH resolution AS (${resolution}) SELECT resolution,count(*)::int AS messages FROM resolution GROUP BY resolution ORDER BY resolution`);
  const { rows: lifecycle } = await client.query(`SELECT
    (SELECT count(*)::int FROM phone_numbers WHERE assigned_user_id IS NOT NULL AND expires_at<=now()) AS expired_assignments,
    (SELECT count(*)::int FROM orders WHERE fulfillment_status='COMPLETED' AND completed_at IS NULL) AS missing_completion_times,
    (SELECT count(*)::int FROM number_allocations a LEFT JOIN phone_numbers n ON n.id=a.number_id
      WHERE a.released_at IS NULL AND (a.user_id IS DISTINCT FROM n.assigned_user_id OR a.assigned_at IS DISTINCT FROM n.assigned_at
      OR a.order_id IS DISTINCT FROM n.order_id OR a.expires_at IS DISTINCT FROM n.expires_at)) AS mismatched_current_allocations,
    (SELECT count(*)::int FROM phone_numbers n WHERE n.assigned_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM number_allocations a WHERE a.number_id=n.id AND a.released_at IS NULL)) AS missing_current_allocations`);
  const { rows: versions } = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  const result: Record<string, unknown> = { auditedAt: new Date().toISOString(), mode: 'READ_ONLY_PRE_MIGRATION_AUDIT', versions, counts, lifecycle };
  if (process.argv.includes('--details')) {
    const { rows } = await client.query(`WITH resolution AS (${resolution}) SELECT message_id,resolution,interval_matches FROM resolution
      WHERE allocation_id IS NULL ORDER BY resolution,message_id`);
    result.unresolved = rows;
  }
  console.log(JSON.stringify(result, null, 2));
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(error instanceof Error ? error.message : 'Allocation audit failed');
  process.exitCode = 1;
} finally { await client.end(); }
