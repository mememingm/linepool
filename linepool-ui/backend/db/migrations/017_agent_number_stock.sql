-- Local/mock number stock for the agent distribution flow.
-- This is intentionally independent from the legacy DEMO-only phone_numbers table.
-- Real PingCode/API/Webhook synchronization remains a future adapter.
ALTER TABLE number_holdings DROP CONSTRAINT IF EXISTS number_holdings_phone_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS number_holdings_active_phone_unique
  ON number_holdings(phone_number) WHERE status IN ('ACTIVE','SUSPENDED');
CREATE TABLE agent_number_imports (
  idempotency_key uuid PRIMARY KEY,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 200),
  imported_count integer NOT NULL CHECK (imported_count >= 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_number_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'pingcode-mock' CHECK (provider='pingcode-mock'),
  platform_id text NOT NULL REFERENCES platforms(id),
  external_project_id text NOT NULL CHECK (length(trim(external_project_id)) > 0),
  external_number_id text,
  phone_number text NOT NULL CHECK (phone_number ~ '^\\+[1-9][0-9]{6,14}$'),
  region_id text NOT NULL REFERENCES regions(id),
  resource_status text NOT NULL DEFAULT 'LOCAL' CHECK (resource_status IN ('LOCAL','ONLINE','OFFLINE','ERROR')),
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','ALLOCATED','RELEASED')),
  resource_expires_at timestamptz,
  holding_id uuid REFERENCES number_holdings(id),
  import_idempotency_key uuid NOT NULL REFERENCES agent_number_imports(idempotency_key),
  imported_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='ALLOCATED') = (holding_id IS NOT NULL)),
  CHECK (resource_expires_at IS NULL OR resource_expires_at > imported_at)
);
CREATE UNIQUE INDEX agent_number_stock_phone_unique ON agent_number_stock(phone_number);
CREATE UNIQUE INDEX agent_number_stock_external_unique
  ON agent_number_stock(provider,external_project_id,external_number_id)
  WHERE external_number_id IS NOT NULL;
CREATE INDEX agent_number_stock_status ON agent_number_stock(status,platform_id,imported_at DESC);
CREATE INDEX agent_number_stock_holding ON agent_number_stock(holding_id) WHERE holding_id IS NOT NULL;

CREATE TABLE agent_number_stock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id uuid NOT NULL REFERENCES agent_number_stock(id),
  holding_id uuid REFERENCES number_holdings(id),
  action text NOT NULL CHECK (action IN ('IMPORT','CLAIM','RELEASE','RESELL')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 200),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_number_stock_events_stock ON agent_number_stock_events(stock_id,created_at DESC);
COMMENT ON TABLE agent_number_stock IS 'Local/mock staging stock for future PingCode number synchronization; never implies a real upstream purchase.';
