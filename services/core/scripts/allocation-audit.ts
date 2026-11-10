import pg from 'pg';
import { Environment } from '../src/environment.js';

// Operational read-only data inventory; it neither generates fixtures nor changes data.
const environment = new Environment();
const client = new pg.Client({ connectionString: environment.values.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const { rows: counts } = await client.query(`SELECT CASE
    WHEN m.allocation_id IS NULL THEN 'LEGACY_UNRESOLVED'
    WHEN a.id IS NULL OR a.number_id<>m.number_id OR a.user_id<>m.user_id OR a.platform_id IS DISTINCT FROM m.platform_id
      OR m.received_at<a.assigned_at OR m.received_at>=LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at)) THEN 'OWNERSHIP_CONFLICT'
    ELSE 'PLATFORM_SERVICE_MATCH' END AS resolution,count(*)::int AS messages
    FROM sms_messages m LEFT JOIN number_allocations a ON a.id=m.allocation_id GROUP BY resolution ORDER BY resolution`);
  const { rows: lifecycle } = await client.query(`SELECT
    (SELECT count(*)::int FROM number_allocations WHERE released_at IS NULL AND expires_at<=now()) AS expired_services_awaiting_release,
    (SELECT count(*)::int FROM orders WHERE fulfillment_status='COMPLETED' AND completed_at IS NULL) AS missing_completion_times,
    (SELECT count(*)::int FROM number_allocations a LEFT JOIN number_platforms s ON s.number_id=a.number_id AND s.platform_id=a.platform_id
      WHERE s.number_id IS NULL) AS missing_platform_stock,
    (SELECT count(*)::int FROM provider_message_receipts WHERE processing_status<>'IMPORTED') AS pending_receipts,
    (SELECT count(*)::int FROM phone_numbers WHERE resource_expires_at IS NOT NULL) AS known_resource_expiries`);
  const { rows: versions } = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  const result: Record<string, unknown> = { auditedAt: new Date().toISOString(), mode: 'READ_ONLY_PLATFORM_SERVICE_AUDIT', versions, counts, lifecycle };
  if (process.argv.includes('--details')) {
    const { rows } = await client.query(`SELECT m.id AS message_id FROM sms_messages m WHERE m.allocation_id IS NULL ORDER BY m.id`);
    result.unresolved = rows;
  }
  console.log(JSON.stringify(result, null, 2));
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(error instanceof Error ? error.message : 'Allocation audit failed');
  process.exitCode = 1;
} finally { await client.end(); }
