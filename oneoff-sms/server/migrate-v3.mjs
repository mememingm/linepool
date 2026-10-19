import { transaction } from './db.mjs';

export function migrateV3(db) {
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version = 3').get()) return;
    db.exec(`
      ALTER TABLE resources ADD COLUMN purpose TEXT NOT NULL DEFAULT 'SHARED' CHECK(purpose IN ('SHARED','EXCLUSIVE','CUSTOMER_OWNED'));
      ALTER TABLE resources ADD COLUMN lease_availability TEXT NOT NULL DEFAULT 'UNLISTED' CHECK(lease_availability IN ('UNLISTED','AVAILABLE','LEASED','REVIEW'));
      CREATE TABLE lease_plans (
        id TEXT PRIMARY KEY, days INTEGER NOT NULL CHECK(days IN (7,30)), price_cents INTEGER NOT NULL CHECK(price_cents > 0),
        version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))
      );
      INSERT INTO lease_plans (id,days,price_cents) VALUES ('lease-7',7,700),('lease-30',30,2400);
      CREATE TABLE leases (
        id TEXT PRIMARY KEY, viewer_id TEXT NOT NULL REFERENCES viewers(id), resource_id TEXT NOT NULL REFERENCES resources(id),
        status TEXT NOT NULL CHECK(status IN ('ACTIVE','FAILED','EXPIRED','RELEASED')),
        started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ended_at INTEGER,
        CHECK(expires_at > started_at)
      );
      CREATE UNIQUE INDEX exclusive_active_lease ON leases(resource_id) WHERE status = 'ACTIVE';
      CREATE TABLE lease_orders (
        id TEXT PRIMARY KEY, lease_id TEXT NOT NULL REFERENCES leases(id), viewer_id TEXT NOT NULL REFERENCES viewers(id),
        kind TEXT NOT NULL CHECK(kind IN ('OPEN','RENEW')), status TEXT NOT NULL CHECK(status IN ('TEST_PAID','FAILED')),
        plan_id TEXT NOT NULL REFERENCES lease_plans(id), plan_version INTEGER NOT NULL, days INTEGER NOT NULL,
        price_cents INTEGER NOT NULL, previous_expires_at INTEGER, expires_at INTEGER NOT NULL,
        ledger_id TEXT UNIQUE REFERENCES wallet_transactions(id), created_at INTEGER NOT NULL,
        request_key TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(viewer_id,request_key)
      );
      CREATE TABLE lease_events (
        id TEXT PRIMARY KEY, lease_id TEXT NOT NULL REFERENCES leases(id), kind TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE lease_incoming_sms (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL, event_id TEXT NOT NULL, message_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
        resource_id TEXT NOT NULL, lease_id TEXT NOT NULL, occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
        text TEXT NOT NULL, code TEXT, status TEXT NOT NULL CHECK(status IN ('MATCHED','QUARANTINED')), reason TEXT NOT NULL,
        UNIQUE(provider,event_id), UNIQUE(provider,message_id)
      );
      CREATE INDEX lease_messages ON lease_incoming_sms(lease_id,status,occurred_at);
      CREATE TABLE lease_sms_conflicts (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL, message_id TEXT NOT NULL, reason TEXT NOT NULL, received_at INTEGER NOT NULL
      );
      CREATE TRIGGER lease_insert_guard BEFORE INSERT ON leases WHEN NEW.status = 'ACTIVE' BEGIN
        SELECT RAISE(ABORT,'RESOURCE_BUSY') WHERE EXISTS(SELECT 1 FROM assignments WHERE resource_id = NEW.resource_id AND ended_at IS NULL);
        SELECT RAISE(ABORT,'RESOURCE_NOT_LEASABLE') WHERE NOT EXISTS(SELECT 1 FROM resources WHERE id = NEW.resource_id AND purpose = 'EXCLUSIVE' AND lease_availability = 'AVAILABLE');
      END;
      CREATE TRIGGER lease_update_guard BEFORE UPDATE ON leases WHEN NEW.status = 'ACTIVE' BEGIN
        SELECT RAISE(ABORT,'RESOURCE_BUSY') WHERE EXISTS(SELECT 1 FROM assignments WHERE resource_id = NEW.resource_id AND ended_at IS NULL);
        SELECT RAISE(ABORT,'LEASE_OWNERSHIP_IMMUTABLE') WHERE NEW.resource_id != OLD.resource_id OR NEW.viewer_id != OLD.viewer_id OR OLD.status != 'ACTIVE';
      END;
      CREATE TRIGGER assignment_insert_lease_guard BEFORE INSERT ON assignments WHEN NEW.ended_at IS NULL BEGIN
        SELECT RAISE(ABORT,'RESOURCE_BUSY') WHERE EXISTS(SELECT 1 FROM leases WHERE resource_id = NEW.resource_id AND status = 'ACTIVE');
        SELECT RAISE(ABORT,'RESOURCE_NOT_SHARED') WHERE EXISTS(SELECT 1 FROM resources WHERE id = NEW.resource_id AND purpose != 'SHARED');
      END;
      CREATE TRIGGER assignment_update_lease_guard BEFORE UPDATE ON assignments WHEN NEW.ended_at IS NULL BEGIN
        SELECT RAISE(ABORT,'RESOURCE_BUSY') WHERE EXISTS(SELECT 1 FROM leases WHERE resource_id = NEW.resource_id AND status = 'ACTIVE');
        SELECT RAISE(ABORT,'RESOURCE_NOT_SHARED') WHERE EXISTS(SELECT 1 FROM resources WHERE id = NEW.resource_id AND purpose != 'SHARED');
      END;
      CREATE TRIGGER resource_lease_guard BEFORE UPDATE OF purpose,lease_availability ON resources BEGIN
        SELECT RAISE(ABORT,'RESOURCE_BUSY') WHERE EXISTS(SELECT 1 FROM leases WHERE resource_id = OLD.id AND status = 'ACTIVE') AND (NEW.purpose != 'EXCLUSIVE' OR NEW.lease_availability != 'LEASED');
        SELECT RAISE(ABORT,'RESOURCE_BUSY') WHERE EXISTS(SELECT 1 FROM assignments WHERE resource_id = OLD.id AND ended_at IS NULL) AND (NEW.purpose != OLD.purpose OR NEW.lease_availability != OLD.lease_availability);
      END;
    `);
    // Only unused, designated fictional fixtures become lease inventory. Legacy occupancy/history is never converted.
    db.exec(`UPDATE resources SET purpose = 'EXCLUSIVE', lease_availability = 'AVAILABLE'
      WHERE id IN ('resource-90','resource-91','resource-92','resource-93','resource-94','resource-95','resource-96','resource-97','resource-98','resource-99')
      AND source = 'mock' AND NOT EXISTS(SELECT 1 FROM assignments WHERE resource_id = resources.id)
      AND NOT EXISTS(SELECT 1 FROM usage_history WHERE resource_id = resources.id)`);
    db.prepare('INSERT INTO schema_migrations VALUES (3,?)').run(Date.now());
  });
}
