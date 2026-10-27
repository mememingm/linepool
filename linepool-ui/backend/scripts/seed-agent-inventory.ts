import pg from 'pg';
import { Environment } from '../src/environment.js';

const environment = new Environment();
if (environment.values.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production');

const importIdempotencyKey = '4d6f636b-7374-4e75-9a11-000000000002';
const reason = 'Seed extra mock inventory for batch allocation testing';
const platformCodes = [
  { id: 'Telegram', code: 'TG' },
  { id: 'Google', code: 'GO' },
  { id: 'WhatsApp', code: 'WA' },
] as const;
const regions = ['us'] as const;
const phonePrefixes: Record<(typeof regions)[number], string> = {
  us: '+1959556',
};

const client = new pg.Client({ connectionString: environment.values.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  await client.query('BEGIN');

  const { rows: [actor] } = await client.query<{ id: string }>(
    "SELECT id FROM users WHERE email='demo@linepool.local' LIMIT 1",
  );
  if (!actor) throw new Error('Demo admin user not found; run db:seed first');

  await client.query(
    `INSERT INTO agent_number_imports(idempotency_key,reason,imported_count,created_by)
     VALUES($1,$2,0,$3)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [importIdempotencyKey, reason, actor.id],
  );

  let inserted = 0;
  for (let platformIndex = 0; platformIndex < platformCodes.length; platformIndex += 1) {
    const platform = platformCodes[platformIndex]!;
    for (let itemIndex = 1; itemIndex <= 20; itemIndex += 1) {
      const region = regions[(platformIndex * 20 + itemIndex - 1) % regions.length]!;
      const suffix = String(platformIndex * 1000 + itemIndex).padStart(4, '0');
      const phoneNumber = `${phonePrefixes[region]}${suffix}`;
      const externalNumberId = `PC-MOCK-${platform.code}-${region.toUpperCase()}-${String(itemIndex).padStart(3, '0')}`;
      const resourceStatus = itemIndex % 5 === 0 ? 'ONLINE' : 'LOCAL';
      const resourceExpiresAt = resourceStatus === 'ONLINE'
        ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
        : null;
      const projectId = `mock-${platform.id.toLowerCase()}-${region}`;

      const { rows: [stock] } = await client.query<{ id: string }>(
        `INSERT INTO agent_number_stock(
           provider,platform_id,external_project_id,external_number_id,phone_number,
           region_id,resource_status,resource_expires_at,import_idempotency_key
         ) VALUES('pingcode-mock',$1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [platform.id, projectId, externalNumberId, phoneNumber, region, resourceStatus, resourceExpiresAt, importIdempotencyKey],
      );
      if (!stock) continue;

      await client.query(
        `INSERT INTO agent_number_stock_events(stock_id,action,reason,actor_user_id,metadata)
         VALUES($1,'IMPORT',$2,$3,$4)`,
        [stock.id, reason, actor.id, JSON.stringify({ provider: 'pingcode-mock', seeded: true })],
      );
      inserted += 1;
    }
  }

  await client.query(
    `UPDATE agent_number_imports
     SET imported_count=(SELECT count(*) FROM agent_number_stock WHERE import_idempotency_key=$1)
     WHERE idempotency_key=$1`,
    [importIdempotencyKey],
  );
  await client.query('COMMIT');

  const { rows: [summary] } = await client.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM agent_number_stock',
  );
  console.log(`Mock inventory ready: inserted ${inserted} rows; total stock ${summary?.count ?? 0}`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('Mock inventory seed failed', error);
  process.exitCode = 1;
} finally {
  await client.end();
}
