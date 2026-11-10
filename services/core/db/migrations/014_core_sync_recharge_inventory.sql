-- Core sync/recharge/inventory closure. Existing migrations remain immutable.
ALTER TABLE provider_projects
  ADD COLUMN sync_status text NOT NULL DEFAULT 'IDLE' CHECK (sync_status IN ('IDLE','RUNNING','SUCCEEDED','FAILED','UNSUPPORTED')),
  ADD COLUMN last_sync_started_at timestamptz,
  ADD COLUMN last_sync_finished_at timestamptz,
  ADD COLUMN last_sync_result jsonb,
  ADD COLUMN consecutive_sync_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_sync_failures >= 0),
  ADD COLUMN last_sync_error text;

ALTER TABLE provider_resource_bindings ADD COLUMN external_project_id text;
UPDATE provider_resource_bindings b SET external_project_id=s.external_project_id
FROM number_platforms s JOIN phone_numbers n ON n.id=s.number_id AND n.service=s.platform_id
WHERE s.provider=b.provider AND s.number_id=b.number_id;
ALTER TABLE provider_resource_bindings ALTER COLUMN external_project_id SET NOT NULL;
ALTER TABLE provider_resource_bindings ADD CONSTRAINT resource_binding_project_fk
  FOREIGN KEY(provider,external_project_id) REFERENCES provider_projects(provider,external_project_id);
CREATE INDEX resource_bindings_project_number ON provider_resource_bindings(provider,external_project_id,number_id);

CREATE TABLE provider_sync_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_project_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('INCREMENTAL','FULL','MANUAL')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','UNSUPPORTED')),
  started_at timestamptz,
  finished_at timestamptz,
  fetched_count integer NOT NULL DEFAULT 0 CHECK (fetched_count >= 0),
  added_count integer NOT NULL DEFAULT 0 CHECK (added_count >= 0),
  updated_count integer NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  offline_count integer NOT NULL DEFAULT 0 CHECK (offline_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  conflict_count integer NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  error_message text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(provider,external_project_id) REFERENCES provider_projects(provider,external_project_id)
);
CREATE INDEX provider_sync_tasks_project_created ON provider_sync_tasks(provider,external_project_id,created_at DESC,id DESC);
CREATE UNIQUE INDEX provider_sync_tasks_running ON provider_sync_tasks(provider,external_project_id)
  WHERE status IN ('PENDING','RUNNING');

CREATE TABLE provider_sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES provider_sync_tasks(id),
  provider text NOT NULL,
  external_project_id text NOT NULL,
  external_number_id text NOT NULL,
  number_id uuid REFERENCES phone_numbers(id),
  conflict_type text NOT NULL CHECK (conflict_type IN ('RESOURCE_UNAVAILABLE','RESOURCE_EXPIRED','RESOURCE_MISSING','RESOURCE_UNMAPPED')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  details jsonb NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id),
  resolution text,
  FOREIGN KEY(provider,external_project_id) REFERENCES provider_projects(provider,external_project_id),
  CHECK ((status='OPEN' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status='RESOLVED' AND resolved_at IS NOT NULL AND length(trim(resolution))>=3))
);
CREATE UNIQUE INDEX provider_sync_conflicts_open ON provider_sync_conflicts(provider,external_project_id,external_number_id,conflict_type)
  WHERE status='OPEN';
CREATE INDEX provider_sync_conflicts_queue ON provider_sync_conflicts(status,last_seen_at DESC);

ALTER TABLE point_ledger DROP CONSTRAINT point_ledger_type_check;
ALTER TABLE point_ledger ADD CONSTRAINT point_ledger_type_check CHECK (type IN ('SEED_CREDIT','ORDER_DEBIT','ADJUSTMENT','RECHARGE'));
ALTER TABLE point_ledger ADD COLUMN recharge_order_id uuid REFERENCES recharge_orders(id);
ALTER TABLE point_ledger ADD CONSTRAINT point_ledger_recharge_shape CHECK (
  (type='RECHARGE' AND recharge_order_id IS NOT NULL AND reference_id IS NULL AND delta>0)
  OR (type<>'RECHARGE' AND recharge_order_id IS NULL)
);
CREATE UNIQUE INDEX point_ledger_recharge_order ON point_ledger(recharge_order_id) WHERE recharge_order_id IS NOT NULL;

ALTER TABLE recharge_orders ADD COLUMN idempotency_key uuid;
ALTER TABLE recharge_orders ADD COLUMN review_reason text;
ALTER TABLE recharge_orders ADD COLUMN last_payment_issue_at timestamptz;
CREATE UNIQUE INDEX recharge_orders_idempotency ON recharge_orders(user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE orders ADD COLUMN source_channel text NOT NULL DEFAULT 'DIRECT'
  CHECK (source_channel IN ('DIRECT','ADMIN','API','SANDBOX'));
CREATE INDEX orders_source_channel_created ON orders(source_channel,created_at DESC);

CREATE VIEW number_platform_inventory AS
SELECT s.id AS id, s.id AS stock_id, d.duration_days, s.number_id, s.platform_id, s.provider, s.external_project_id,
  n.phone_number, n.region_id, n.resource_status, n.resource_expires_at,
  s.is_available, s.sale_enabled, n.sale_enabled AS resource_sale_enabled,
  s.reserved_order_id, a.id AS allocation_id, a.user_id AS allocated_user_id,
  a.order_id AS allocation_order_id, a.expires_at AS allocation_expires_at,
  CASE
    WHEN n.resource_status NOT IN ('LOCAL','ONLINE')
      OR (s.provider='pingcode' AND (n.resource_status<>'ONLINE' OR n.resource_expires_at IS NULL OR n.resource_expires_at<now()+d.duration_days*interval '1 day')) THEN 'EXCEPTION'
    WHEN a.id IS NOT NULL THEN 'ASSIGNED'
    WHEN s.reserved_order_id IS NOT NULL THEN 'RESERVED'
    WHEN NOT s.is_available OR NOT s.sale_enabled OR NOT n.sale_enabled
      OR NOT COALESCE(p.is_active,false) OR NOT COALESCE(f.is_active,false) THEN 'OFF_SALE'
    ELSE 'AVAILABLE'
  END AS sale_status
FROM number_platforms s
CROSS JOIN (VALUES(7),(30)) AS d(duration_days)
JOIN phone_numbers n ON n.id=s.number_id
LEFT JOIN provider_projects p ON p.provider=s.provider AND p.external_project_id=s.external_project_id
LEFT JOIN platforms f ON f.id=s.platform_id
LEFT JOIN number_allocations a ON a.number_id=s.number_id AND a.platform_id=s.platform_id AND a.released_at IS NULL;
COMMENT ON VIEW number_platform_inventory IS 'Canonical sales state per number, platform and supported service duration; resource problems take precedence over assigned/reserved/off-sale.';
