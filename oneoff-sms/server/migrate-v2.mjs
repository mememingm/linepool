import { transaction } from './db.mjs';

const definitions = {
  resources: { country_code: "TEXT NOT NULL DEFAULT 'US'", source: "TEXT NOT NULL DEFAULT 'mock'", online: 'INTEGER NOT NULL DEFAULT 1', cost_cents: 'INTEGER NOT NULL DEFAULT 100', cooldown_until: 'INTEGER NOT NULL DEFAULT 0' },
  products: { service_id: 'TEXT', policy_json: `TEXT NOT NULL DEFAULT '{"refundOnExpiry":true,"refundOnCancel":true,"refundOnFailure":true,"cooldownSeconds":60,"blockSameServiceAfterUse":true}'` },
  tasks: { order_state: 'TEXT', billing_state: "TEXT NOT NULL DEFAULT 'DEMO_ONLY'", settlement_state: "TEXT NOT NULL DEFAULT 'NOT_APPLICABLE'", policy_json: "TEXT NOT NULL DEFAULT '{}'" },
};

export function migrateV2(db) {
  transaction(db, () => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`);
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version = 2').get()) return;
    for (const [table, columns] of Object.entries(definitions)) {
      const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
      for (const [name, sql] of Object.entries(columns)) if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${sql}`);
    }
    db.exec(`
      CREATE TABLE services (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE number_services (
        resource_id TEXT NOT NULL REFERENCES resources(id), service_id TEXT NOT NULL REFERENCES services(id),
        state TEXT NOT NULL CHECK(state IN ('AVAILABLE','USED','RESTRICTED','UNKNOWN')),
        cooldown_until INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(resource_id,service_id)
      );
      CREATE TABLE wallets (
        viewer_id TEXT PRIMARY KEY REFERENCES viewers(id), balance_cents INTEGER NOT NULL CHECK(balance_cents >= 0),
        held_cents INTEGER NOT NULL DEFAULT 0 CHECK(held_cents >= 0), currency TEXT NOT NULL DEFAULT 'USD'
      );
      CREATE TABLE wallet_transactions (
        id TEXT PRIMARY KEY, viewer_id TEXT NOT NULL REFERENCES viewers(id), task_id TEXT REFERENCES tasks(id),
        kind TEXT NOT NULL CHECK(kind IN ('TEST_CREDIT','HOLD','CAPTURE','REFUND')),
        balance_delta INTEGER NOT NULL, held_delta INTEGER NOT NULL, balance_after INTEGER NOT NULL, held_after INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(viewer_id,idempotency_key), UNIQUE(task_id,kind)
      );
      CREATE TABLE usage_history (
        id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL UNIQUE REFERENCES assignments(id),
        resource_id TEXT NOT NULL REFERENCES resources(id), service_id TEXT NOT NULL REFERENCES services(id),
        task_id TEXT NOT NULL REFERENCES tasks(id), started_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT
      );
      CREATE TABLE incoming_sms (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL, event_id TEXT NOT NULL, message_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL, resource_id TEXT, service_id TEXT, assignment_id TEXT, text TEXT NOT NULL,
        occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('RECEIVED','MATCHED','QUARANTINED')), reason TEXT NOT NULL DEFAULT '',
        UNIQUE(provider,event_id), UNIQUE(provider,message_id)
      );
      CREATE TABLE order_events (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), state TEXT NOT NULL,
        detail TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE admin_sessions (token TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
        detail TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX usage_resource_service ON usage_history(resource_id,service_id);
      CREATE INDEX sms_assignment ON incoming_sms(assignment_id);
      CREATE INDEX wallet_viewer_date ON wallet_transactions(viewer_id,created_at);
    `);
    const extra = [['tiktok', 'TikTok', 160], ['wechat', 'WeChat', 210], ['rednote', 'RedNote', 190]];
    for (const [key, name, price] of extra) {
      for (const [country, label] of [['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada']]) {
        db.prepare(`INSERT OR IGNORE INTO products
          (id,service,country,country_code,price_cents,currency,duration_seconds,enabled,can_cancel,description,icon_key)
          VALUES (?,?,?,?,?,'USD',1200,1,1,?,?)`).run(`${key}-${country.toLowerCase()}`, name, label, country, price,
            'Local mock service. Compatibility and stock are not live inventory.', key);
      }
    }
    for (const product of db.prepare('SELECT * FROM products').all()) {
      db.prepare('INSERT OR IGNORE INTO services (id,name) VALUES (?,?)').run(product.icon_key, product.service);
      db.prepare('UPDATE products SET service_id = ? WHERE id = ?').run(product.icon_key, product.id);
    }
    // Explicit fixture capability sets, not a claim that every number supports every service.
    const fixtures = [['telegram', 'tiktok', 'wechat', 'rednote'], ['telegram', 'whatsapp', 'google', 'discord'], ['tiktok', 'instagram', 'facebook', 'microsoft', 'openai']];
    for (const resource of db.prepare('SELECT id FROM resources ORDER BY id').all()) {
      const number = Number(resource.id.replace('resource-', ''));
      for (const service of fixtures[number % fixtures.length] ?? []) {
        db.prepare('INSERT INTO number_services (resource_id,service_id,state) VALUES (?, ?, ?)').run(resource.id, service, 'AVAILABLE');
      }
    }
    for (const row of db.prepare(`SELECT a.*,p.service_id,t.status FROM assignments a JOIN tasks t ON t.id = a.task_id
      JOIN products p ON p.id = t.product_id`).all()) {
      db.prepare(`INSERT INTO usage_history (id,assignment_id,resource_id,service_id,task_id,started_at,ended_at,outcome)
        VALUES (?,?,?,?,?,?,?,?)`).run(`legacy-${row.id}`, row.id, row.resource_id, row.service_id, row.task_id, row.started_at, row.ended_at, row.ended_at === null ? null : row.status);
      if (row.ended_at !== null) db.prepare(`UPDATE number_services SET state = 'USED', reason = 'Legacy use; repeat availability unconfirmed'
        WHERE resource_id = ? AND service_id = ?`).run(row.resource_id, row.service_id);
    }
    db.prepare('INSERT INTO schema_migrations (version,applied_at) VALUES (2,?)').run(Date.now());
  });
}
