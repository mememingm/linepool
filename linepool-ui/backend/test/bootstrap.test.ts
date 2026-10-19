import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { migrateDatabase } from '../db/migrate.js';
import { seedDemo } from '../db/demo-seed.js';
import { demoInput, isolatedDatabase, migrationDirectory } from './isolated-database.js';

test('migration reruns leave schema/checksums unchanged and reject edits to applied SQL', async t => {
  const fixture = await isolatedDatabase();
  t.after(() => fixture.close());
  const before = await fixture.client.query('SELECT version,checksum,applied_at FROM schema_migrations ORDER BY version');
  assert.deepEqual(await migrateDatabase(fixture.client, migrationDirectory), []);
  assert.deepEqual((await fixture.client.query('SELECT version,checksum,applied_at FROM schema_migrations ORDER BY version')).rows, before.rows);
  const directory = await mkdtemp(join(tmpdir(), 'linepool-migrations-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sql = await readFile(new URL('001_initial.sql', migrationDirectory), 'utf8');
  await writeFile(join(directory, '001_initial.sql'), sql + '\n-- changed isolated fixture\n');
  await assert.rejects(migrateDatabase(fixture.client, pathToFileURL(directory + '/')), /Applied migration changed: 001_initial.sql/);
  assert.deepEqual((await fixture.client.query('SELECT version,checksum,applied_at FROM schema_migrations ORDER BY version')).rows, before.rows);
  assert.equal((await fixture.client.query('SELECT count(*)::int AS total FROM regions')).rows[0]!.total, 6);
});

test('demo seed reruns do not reset passwords, balances, orders, sessions, read flags or preferences', async t => {
  const fixture = await isolatedDatabase();
  t.after(() => fixture.close());
  const { rows: [user] } = await fixture.client.query('SELECT id FROM users WHERE email=$1', [demoInput.email]);
  const id = user!.id as string;
  await fixture.workspace.preferences(id, false);
  const { rows: [message] } = await fixture.client.query('SELECT id FROM sms_messages WHERE user_id=$1 AND NOT is_read LIMIT 1', [id]);
  await fixture.workspace.markRead(id, [message!.id]);
  await fixture.client.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'1 hour\')', ['a'.repeat(64), id]);
  const tables = ['users', 'sessions', 'regions', 'offers', 'orders', 'phone_numbers', 'point_ledger', 'sms_messages'];
  const snapshots = new Map<string, string[]>();
  for (const table of tables) {
    const result = await fixture.client.query(`SELECT row_to_json(t)::text AS value FROM ${table} t ORDER BY row_to_json(t)::text`);
    snapshots.set(table, result.rows.map(row => row.value));
  }
  assert.deepEqual(await seedDemo(fixture.client, { ...demoInput, password: 'different-fixture-password', displayName: 'Do not replace' }), { created: false });
  assert.deepEqual(await seedDemo(fixture.client, demoInput), { created: false });
  for (const table of tables) {
    const result = await fixture.client.query(`SELECT row_to_json(t)::text AS value FROM ${table} t ORDER BY row_to_json(t)::text`);
    assert.deepEqual(result.rows.map(row => row.value), snapshots.get(table), `${table} changed on seed rerun`);
  }
  const points = await fixture.workspace.points(id, { page: 1, pageSize: 100 });
  assert.equal(points.data.balance, points.data.entries.reduce((sum, entry) => sum + entry.delta, 0));
});
