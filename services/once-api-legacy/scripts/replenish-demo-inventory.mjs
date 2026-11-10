import { config } from 'dotenv';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: resolve(root, 'backend/.env'), quiet: true });
const target = new URL(process.env.DATABASE_URL);
if (process.env.DEMO_MODE !== 'true' || process.env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
  throw new Error('This replenishment is restricted to a local development demo database.');
}
const apply = process.argv.includes('--apply');
const nationwide = process.argv.includes('--us');
const minimum = nationwide ? 12 : 100;
const fixtures = nationwide
  ? JSON.parse(readFileSync(resolve(root, 'src/lib/us-states.json'), 'utf8')).flatMap(state => state.areaCodes.map(area => ({
      countryCode: 'US', countryName: '美国', regionId: state.id, regionName: state.name, number: `+1 ${area} 555 0100`,
    })))
  : JSON.parse(readFileSync(resolve(root, 'backend/prisma/demo-inventory.json'), 'utf8'));
const groups = new Map();
for (const row of fixtures) {
  const key = `${row.countryCode}:${row.regionId}`;
  if (!groups.has(key)) groups.set(key, { countryCode: row.countryCode, countryName: row.countryName, regionId: row.regionId, regionName: row.regionName, areaCodes: new Set() });
  const match = row.number.match(/^\+1 (\d{3}) 555 01\d{2}$/);
  if (!match) throw new Error('Expected reserved demonstration number format.');
  groups.get(key).areaCodes.add(match[1]);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  if (apply) {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('once:demo-inventory'))");
  }
  const existing = (await db.query('SELECT * FROM "PhoneNumber" ORDER BY "number"')).rows;
  const used = new Set(existing.map(row => row.number));
  const available = rows => rows.filter(row => row.provider === 'demo' && !row.occupied && row.holdReason == null);
  const plan = [], summary = [];
  for (const group of groups.values()) {
    const { areaCodes, ...metadata } = group;
    const before = available(existing).filter(row => row.countryCode === group.countryCode && row.regionId === group.regionId).length;
    let needed = Math.max(0, minimum - before);
    const codes = [...areaCodes];
    for (let i = 0; i < codes.length * 100 && needed > 0; i++) {
      const number = `+1 ${codes[i % codes.length]} 555 ${String(100 + Math.floor(i / codes.length)).padStart(4, '0')}`;
      if (used.has(number)) continue;
      plan.push({ ...metadata, number, provider: 'demo', occupied: false, holdReason: null, smsEnabled: true });
      used.add(number);
      needed--;
    }
    if (needed) throw new Error(`Reserved demo number capacity exhausted for ${group.countryCode}/${group.regionId}`);
    summary.push({ country: group.countryName, region: group.regionName, before, add: Math.max(0, minimum - before) });
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', database: `${target.hostname}:${target.port}${target.pathname}`, existing: existing.length, available: available(existing).length, planned: plan.length, regions: summary }, null, 2));
  if (apply && plan.length) {
    const directory = resolve(root, 'output/inventory');
    mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(':', '-');
    const evidencePath = resolve(directory, `replenish-${stamp}.json`);
    writeFileSync(evidencePath, JSON.stringify({ database: `${target.hostname}:${target.port}${target.pathname}`, before: existing, plannedNumbers: plan.map(row => row.number), regions: summary }, null, 2), { flag: 'wx' });
    const inserted = await db.query(`
      INSERT INTO "PhoneNumber" ("id", "number", "countryCode", "countryName", "regionId", "regionName", "provider", "occupied", "smsEnabled")
      SELECT x.id, x.number, x."countryCode", x."countryName", x."regionId", x."regionName", 'demo', false, true
      FROM json_to_recordset($1::json) AS x(id uuid, number text, "countryCode" text, "countryName" text, "regionId" text, "regionName" text)
      ON CONFLICT ("number") DO NOTHING
      RETURNING "id", "number"
    `, [JSON.stringify(plan.map(row => ({ ...row, id: randomUUID() })))]);
    await db.query('COMMIT');
    const result = { inserted: inserted.rowCount, created: inserted.rows };
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    writeFileSync(evidencePath, JSON.stringify({ ...evidence, ...result }, null, 2));
    console.log(JSON.stringify({ inserted: result.inserted, evidence: evidencePath }));
  } else if (apply) {
    await db.query('COMMIT');
    console.log(`All regions already have at least ${minimum} available demo numbers; nothing changed.`);
  }
} catch (error) {
  if (apply) await db.query('ROLLBACK').catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
