import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrateV2 } from './migrate-v2.mjs';
import { migrateV3 } from './migrate-v3.mjs';
import { syncPlatformCatalog } from './platform-catalog.mjs';

export function openDatabase(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const existed = path !== ':memory:' && existsSync(path);
  const db = new DatabaseSync(path);
  // Back up existing databases consistently before any V3 schema/seed writes.
  if (existed && db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'tasks'").get()) {
    const migrated = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'schema_migrations'").get()
      && db.prepare('SELECT 1 FROM schema_migrations WHERE version = 3').get();
    if (!migrated) {
      const directory = `${dirname(path)}/backups`;
      mkdirSync(directory, { recursive: true });
      db.prepare('VACUUM INTO ?').run(`${directory}/pre-v3-${Date.now()}.sqlite`);
    }
  }
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS viewers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
      theme TEXT NOT NULL DEFAULT 'light' CHECK(theme IN ('light','dark'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, viewer_id TEXT NOT NULL REFERENCES viewers(id)
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, service TEXT NOT NULL, country TEXT NOT NULL,
      country_code TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
      currency TEXT NOT NULL, duration_seconds INTEGER NOT NULL,
      enabled INTEGER NOT NULL, can_cancel INTEGER NOT NULL,
      description TEXT NOT NULL, icon_key TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE CHECK(phone GLOB '+120255501[0-9][0-9]')
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, viewer_id TEXT NOT NULL REFERENCES viewers(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      service TEXT NOT NULL, country TEXT NOT NULL, country_code TEXT NOT NULL,
      price_cents INTEGER NOT NULL, currency TEXT NOT NULL, can_cancel INTEGER NOT NULL,
      product_version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ALLOCATING','WAITING_SMS','COMPLETED','EXPIRED','CANCELLED','REVIEW_REQUIRED')),
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'DEMO_ONLY' CHECK(payment_status = 'DEMO_ONLY'),
      settlement_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK(settlement_status = 'NOT_APPLICABLE')
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id)
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES resources(id),
      task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
      started_at INTEGER NOT NULL, ended_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS exclusive_active_resource ON assignments(resource_id) WHERE ended_at IS NULL;
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES assignments(id),
      text TEXT NOT NULL, code TEXT NOT NULL, received_at INTEGER NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 1 CHECK(is_demo = 1)
    );
    CREATE TABLE IF NOT EXISTS idempotency (
      viewer_id TEXT NOT NULL REFERENCES viewers(id), key TEXT NOT NULL,
      payload TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES tasks(id),
      PRIMARY KEY(viewer_id, key)
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
      viewer_id TEXT NOT NULL REFERENCES viewers(id), message TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `);
  transaction(db, () => {
    const services = [
      ['telegram', 'Telegram', 120], ['whatsapp', 'WhatsApp', 180],
      ['google', 'Google', 150], ['discord', 'Discord', 90],
      ['instagram', 'Instagram', 160], ['facebook', 'Facebook', 140],
      ['microsoft', 'Microsoft', 110], ['openai', 'OpenAI', 220],
    ];
    const countries = [['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada']];
    const insert = db.prepare(`INSERT OR IGNORE INTO products
      (id,service,country,country_code,price_cents,currency,duration_seconds,enabled,can_cancel,description,icon_key)
      VALUES (?,?,?,?,?,'USD',1200,1,?,?,?)`);
    for (const [icon, service, price] of services) {
      for (const [code, country] of countries) {
        insert.run(`${icon}-${code.toLowerCase()}`, service, country, code,
          price + (code === 'GB' ? 30 : code === 'CA' ? 10 : 0), icon === 'openai' ? 0 : 1,
          'Local demo inventory only. Fictional US-reserved numbers are used for every country; no service compatibility or SMS delivery is claimed.', icon);
      }
    }
    const resource = db.prepare('INSERT OR IGNORE INTO resources (id,phone) VALUES (?,?)');
    for (let i = 0; i < 100; i++) resource.run(`resource-${i}`, `+120255501${String(i).padStart(2, '0')}`);
  });
  migrateV2(db);
  syncPlatformCatalog(db);
  migrateV3(db);
  return db;
}

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
