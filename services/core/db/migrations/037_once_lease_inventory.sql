-- v4.2 forward chain after main032; old033-036 candidates are not prerequisites.
-- Run under the authorized stopped-writer migration transaction. Preserve all existing data.
ALTER TABLE phone_numbers ADD COLUMN display_metadata jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN manual_hold boolean NOT NULL DEFAULT false, ADD COLUMN hold_reason text,
  ADD COLUMN hold_updated_at timestamptz,
  ADD CONSTRAINT phone_numbers_display_metadata_object CHECK(jsonb_typeof(display_metadata)='object');
ALTER TABLE phone_numbers DROP CONSTRAINT phone_numbers_capability_check;
ALTER TABLE phone_numbers ADD CONSTRAINT phone_numbers_capability_check CHECK(capability IN ('RECEIVE','SEND_RECEIVE'));

CREATE TABLE lease_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), storefront_id text NOT NULL REFERENCES storefronts(id),
  days integer NOT NULL CHECK(days BETWEEN 1 AND 365), price_minor bigint NOT NULL CHECK(price_minor>=0),
  points_price integer NOT NULL CHECK(points_price>0), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  version integer NOT NULL DEFAULT 1 CHECK(version>0), label text NOT NULL, note text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lease_plans_storefront_days UNIQUE(storefront_id,days)
);
CREATE TABLE leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  number_id uuid NOT NULL REFERENCES phone_numbers(id), initial_order_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','EXPIRED_HELD','RELEASED','ENDED')),
  held_at timestamptz, released_at timestamptz, ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leases_identity UNIQUE(id,number_id,user_id),
  CONSTRAINT leases_lifecycle_shape CHECK(
    (status IN ('ACTIVE','EXPIRED_HELD') AND released_at IS NULL AND ended_at IS NULL)
    OR (status='RELEASED' AND released_at IS NOT NULL AND ended_at IS NULL)
    OR (status='ENDED' AND ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX leases_retained_number ON leases(number_id) WHERE status IN ('ACTIVE','EXPIRED_HELD');
CREATE INDEX leases_user_created ON leases(user_id,created_at DESC,id DESC);
ALTER TABLE orders
  ADD COLUMN product_type text NOT NULL DEFAULT 'SMS_CODE',
  ADD COLUMN operation_kind text NOT NULL DEFAULT 'PURCHASE',
  ADD COLUMN settlement_type text NOT NULL DEFAULT 'POINTS',
  ADD COLUMN sales_storefront_id text NOT NULL DEFAULT 'linepool' REFERENCES storefronts(id),
  ADD COLUMN lease_plan_id uuid REFERENCES lease_plans(id), ADD COLUMN lease_id uuid,
  ADD COLUMN target_number_id uuid REFERENCES phone_numbers(id), ADD COLUMN number_snapshot text,
  ADD COLUMN quote_version integer CHECK(quote_version>0), ADD COLUMN amount_minor bigint CHECK(amount_minor>=0),
  ADD COLUMN currency text CHECK(currency ~ '^[A-Z]{3}$'), ADD COLUMN request_payload jsonb,
  ADD COLUMN import_batch_id uuid,
  ALTER COLUMN idempotency_key TYPE text USING idempotency_key::text,
  ALTER COLUMN service DROP NOT NULL, ALTER COLUMN plan DROP NOT NULL,
  DROP CONSTRAINT orders_unit_points_check;
UPDATE orders SET request_payload=jsonb_build_object('regionId',region_id,'service',service,'plan',plan,
  'quantity',quantity,'areaCode',area_code,'durationDays',duration_days,'unitPoints',unit_points,'totalPoints',total_points);
ALTER TABLE orders ADD CONSTRAINT orders_region_fk FOREIGN KEY(region_id) REFERENCES regions(id),
  ADD CONSTRAINT orders_lease_identity FOREIGN KEY(lease_id,target_number_id,user_id)
    REFERENCES leases(id,number_id,user_id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT orders_product_shape CHECK((
    (product_type='SMS_CODE' AND operation_kind='PURCHASE' AND settlement_type='POINTS'
      AND sales_storefront_id='linepool' AND service IS NOT NULL AND plan IS NOT NULL
      AND duration_days IN (7,30) AND lease_id IS NULL AND lease_plan_id IS NULL AND target_number_id IS NULL)
    OR (product_type='NUMBER_LEASE' AND sales_storefront_id='once' AND quantity=1
      AND service IS NULL AND plan IS NULL AND target_number_id IS NOT NULL AND number_snapshot IS NOT NULL
      AND operation_kind IN ('RENT','RENEW','ADMIN_ASSIGN','ADMIN_EXTEND')
      AND (operation_kind IN ('RENT','ADMIN_ASSIGN') OR lease_id IS NOT NULL)
      AND (lease_plan_id IS NOT NULL OR operation_kind='ADMIN_EXTEND' OR settlement_type='HISTORICAL_NON_POINT')
      AND (settlement_type<>'POINTS' OR (operation_kind IN ('RENT','RENEW') AND quote_version IS NOT NULL
        AND amount_minor IS NOT NULL AND currency IS NOT NULL)))) IS TRUE),
  ADD CONSTRAINT orders_settlement_shape CHECK((
    (settlement_type='POINTS' AND unit_points>0 AND total_points>0)
    OR (settlement_type='COMPENSATION' AND product_type='NUMBER_LEASE'
      AND operation_kind IN ('ADMIN_ASSIGN','ADMIN_EXTEND') AND unit_points=0 AND total_points=0
      AND amount_minor=0 AND point_reservation_id IS NULL)
    OR (settlement_type='HISTORICAL_NON_POINT' AND import_batch_id IS NOT NULL
      AND unit_points>=0 AND total_points>=0 AND point_reservation_id IS NULL)) IS TRUE);
ALTER TABLE orders ADD CONSTRAINT orders_initial_lease_identity UNIQUE(id,target_number_id,user_id,lease_id);
ALTER TABLE leases ADD CONSTRAINT leases_initial_order_fk
  FOREIGN KEY(initial_order_id,number_id,user_id,id) REFERENCES orders(id,target_number_id,user_id,lease_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX orders_once_history ON orders(user_id,created_at DESC,id DESC) WHERE product_type='NUMBER_LEASE';
ALTER TABLE mock_fulfillment_operations ADD COLUMN scenario text NOT NULL DEFAULT 'SUCCESS'
    CHECK(scenario IN ('SUCCESS','FAILURE','UNKNOWN_SUCCESS','UNKNOWN_FAILURE')),
  ADD COLUMN mock_result jsonb, ADD COLUMN evidence_data jsonb, ADD COLUMN provider_order_id text,
  ADD COLUMN checked_at timestamptz, ADD COLUMN created_at timestamptz;
-- Existing operations have no trustworthy creation timestamp; only new writes receive a default.
ALTER TABLE mock_fulfillment_operations ALTER COLUMN created_at SET DEFAULT now();
CREATE TABLE whole_number_reservations (
  number_id uuid PRIMARY KEY REFERENCES phone_numbers(id), order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  lease_id uuid REFERENCES leases(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE number_allocations ADD COLUMN allocation_type text NOT NULL DEFAULT 'PLATFORM',
  ADD COLUMN lease_id uuid;
ALTER TABLE number_allocations ALTER COLUMN platform_id DROP NOT NULL,
  ADD CONSTRAINT allocation_lease_identity FOREIGN KEY(lease_id,number_id,user_id) REFERENCES leases(id,number_id,user_id),
  ADD CONSTRAINT allocation_type_shape CHECK((
    (allocation_type='PLATFORM' AND platform_id IS NOT NULL AND lease_id IS NULL)
    OR (allocation_type='WHOLE_NUMBER' AND platform_id IS NULL
      AND lease_id IS NOT NULL AND order_id IS NOT NULL AND agent_entitlement_id IS NULL)) IS TRUE),
  ADD COLUMN service_period tstzrange GENERATED ALWAYS AS
    (tstzrange(assigned_at,LEAST(expires_at,COALESCE(released_at,expires_at)),'[)')) STORED;
ALTER TABLE number_allocations DROP CONSTRAINT allocation_period_no_overlap;
-- Each site enforces its own product periods; there is no cross-type scope coordinator.
ALTER TABLE number_allocations ADD CONSTRAINT allocation_period_no_overlap EXCLUDE USING gist
  (number_id WITH =,platform_id WITH =,service_period WITH &&) WHERE (allocation_type='PLATFORM'),
  ADD CONSTRAINT allocation_whole_period_no_overlap EXCLUDE USING gist
    (number_id WITH =,service_period WITH &&) WHERE (allocation_type='WHOLE_NUMBER');
DROP INDEX number_allocations_current_platform;
CREATE UNIQUE INDEX number_allocations_current_platform ON number_allocations(number_id,platform_id)
  WHERE allocation_type='PLATFORM' AND released_at IS NULL;
CREATE INDEX allocations_whole_lease_period ON number_allocations(lease_id,assigned_at,id) WHERE allocation_type='WHOLE_NUMBER';

CREATE OR REPLACE FUNCTION assert_point_order_binding(order_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE bound record;
BEGIN
  SELECT o.*,r.kind AS reservation_kind,r.business_id AS reservation_business_id,r.points AS reservation_points,
    a.user_id AS account_user_id INTO bound FROM orders o
    LEFT JOIN point_reservations r ON r.id=o.point_reservation_id
    LEFT JOIN point_accounts a ON a.id=r.account_id WHERE o.id=order_id;
  IF FOUND THEN
    IF bound.settlement_type='POINTS' THEN
      IF bound.point_reservation_id IS NULL OR bound.reservation_kind IS DISTINCT FROM 'ORDER'
        OR bound.reservation_business_id IS DISTINCT FROM bound.id::text
        OR bound.reservation_points IS DISTINCT FROM bound.total_points
        OR bound.account_user_id IS DISTINCT FROM bound.user_id THEN
        RAISE EXCEPTION 'Order wallet reservation must match order identity, owner and points';
      END IF;
    ELSIF bound.point_reservation_id IS NOT NULL OR NOT (
      (bound.settlement_type='COMPENSATION' AND bound.unit_points=0 AND bound.total_points=0 AND bound.amount_minor=0)
      OR (bound.settlement_type='HISTORICAL_NON_POINT' AND bound.import_batch_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'Non-point settlement lacks its explicit compensation or import evidence';
    END IF;
  ELSIF EXISTS(SELECT 1 FROM point_reservations WHERE kind='ORDER' AND business_id=order_id::text) THEN
    RAISE EXCEPTION 'Order wallet reservation has no order';
  END IF;
END $$;

CREATE FUNCTION guard_once_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource record; selected_plan lease_plans%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['lease_id','point_reservation_id','fulfillment_status','completed_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['lease_id','point_reservation_id','fulfillment_status','completed_at']) THEN
      RAISE EXCEPTION 'Accepted order commercial identity is immutable';
    END IF;
    IF NEW.point_reservation_id IS DISTINCT FROM OLD.point_reservation_id AND NOT
      (OLD.point_reservation_id IS NULL AND NEW.point_reservation_id IS NOT NULL AND NEW.settlement_type='POINTS') THEN
      RAISE EXCEPTION 'Accepted order wallet binding may only be established once';
    END IF;
    IF NEW.lease_id IS DISTINCT FROM OLD.lease_id AND NOT
      (OLD.lease_id IS NULL AND NEW.lease_id IS NOT NULL AND OLD.operation_kind IN ('RENT','ADMIN_ASSIGN')) THEN
      RAISE EXCEPTION 'Accepted order lease identity is immutable';
    END IF;
  END IF;
  IF NEW.product_type='NUMBER_LEASE' THEN
    SELECT n.*,a.provider,a.storefront_id,s.product INTO resource FROM phone_numbers n
      JOIN upstream_accounts a ON a.id=n.upstream_account_id JOIN storefronts s ON s.id=a.storefront_id
      WHERE n.id=NEW.target_number_id;
    IF NOT FOUND OR resource.region_id IS DISTINCT FROM NEW.region_id OR resource.storefront_id IS DISTINCT FROM NEW.sales_storefront_id
      OR resource.product IS DISTINCT FROM 'NUMBER_LEASE'
      OR (NEW.import_batch_id IS NULL AND resource.provider IS DISTINCT FROM 'pingcode-mock') THEN
      RAISE EXCEPTION 'Whole-number order must reference its matching lease resource and allowed source';
    END IF;
    IF NEW.lease_plan_id IS NOT NULL THEN
      SELECT * INTO selected_plan FROM lease_plans WHERE id=NEW.lease_plan_id;
      IF selected_plan.storefront_id IS DISTINCT FROM NEW.sales_storefront_id
        OR selected_plan.days IS DISTINCT FROM NEW.duration_days THEN RAISE EXCEPTION 'Lease plan/order identity mismatch'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER once_order_guard BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION guard_once_order();

CREATE FUNCTION guard_once_lease() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE initial orders%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.number_id IS DISTINCT FROM OLD.number_id OR NEW.initial_order_id IS DISTINCT FROM OLD.initial_order_id
    OR (OLD.status IN ('RELEASED','ENDED') AND NEW.status IS DISTINCT FROM OLD.status)) THEN
    RAISE EXCEPTION 'Lease identity and terminal state are immutable'; END IF;
  SELECT * INTO initial FROM orders WHERE id=NEW.initial_order_id;
  IF initial.product_type IS DISTINCT FROM 'NUMBER_LEASE' OR initial.user_id IS DISTINCT FROM NEW.user_id
    OR initial.target_number_id IS DISTINCT FROM NEW.number_id OR initial.operation_kind NOT IN ('RENT','ADMIN_ASSIGN') THEN
    RAISE EXCEPTION 'Lease initial order must match its owner and number'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER once_lease_guard BEFORE INSERT OR UPDATE ON leases FOR EACH ROW EXECUTE FUNCTION guard_once_lease();
CREATE FUNCTION guard_lease_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.storefront_id IS DISTINCT FROM OLD.storefront_id OR NEW.days IS DISTINCT FROM OLD.days
    OR NEW.version IS DISTINCT FROM OLD.version+1 THEN RAISE EXCEPTION 'Plan identity/days are immutable and edits require next version'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lease_plan_guard BEFORE UPDATE ON lease_plans FOR EACH ROW EXECUTE FUNCTION guard_lease_plan();

CREATE OR REPLACE FUNCTION guard_platform_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stock number_platforms%ROWTYPE; resource phone_numbers%ROWTYPE; purchased orders%ROWTYPE;
  entitlement service_entitlements%ROWTYPE; holding number_holdings%ROWTYPE; owner_id uuid; account record; held leases%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.number_id IS DISTINCT FROM OLD.number_id OR NEW.platform_id IS DISTINCT FROM OLD.platform_id
      OR NEW.allocation_type IS DISTINCT FROM OLD.allocation_type
      OR NEW.lease_id IS DISTINCT FROM OLD.lease_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
      OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.agent_entitlement_id IS DISTINCT FROM OLD.agent_entitlement_id
      OR (OLD.released_at IS NOT NULL AND NEW.released_at IS DISTINCT FROM OLD.released_at) THEN
      RAISE EXCEPTION 'Service ownership and purchased period are immutable'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO resource FROM phone_numbers WHERE id=NEW.number_id FOR SHARE;
  SELECT a.*,s.product INTO account FROM upstream_accounts a JOIN storefronts s ON s.id=a.storefront_id WHERE a.id=resource.upstream_account_id;
  IF NEW.allocation_type='WHOLE_NUMBER' THEN
    SELECT * INTO purchased FROM orders WHERE id=NEW.order_id;
    SELECT * INTO held FROM leases WHERE id=NEW.lease_id;
    IF resource.id IS NULL OR account.storefront_id IS DISTINCT FROM 'once'
      OR account.product IS DISTINCT FROM 'NUMBER_LEASE' OR purchased.product_type IS DISTINCT FROM 'NUMBER_LEASE'
      OR purchased.user_id IS DISTINCT FROM NEW.user_id OR purchased.target_number_id IS DISTINCT FROM NEW.number_id
      OR purchased.lease_id IS DISTINCT FROM NEW.lease_id OR purchased.region_id IS DISTINCT FROM resource.region_id
      OR held.number_id IS DISTINCT FROM NEW.number_id OR held.user_id IS DISTINCT FROM NEW.user_id
      OR NEW.expires_at IS DISTINCT FROM NEW.assigned_at+purchased.duration_days*interval '24 hours'
      OR NEW.platform_id IS NOT NULL OR NEW.agent_entitlement_id IS NOT NULL THEN
      RAISE EXCEPTION 'Whole allocation does not match lease, order, owner, account and purchased period'; END IF;
    IF purchased.import_batch_id IS NULL AND (held.status NOT IN ('ACTIVE','EXPIRED_HELD')
      OR account.provider IS DISTINCT FROM 'pingcode-mock'
      OR account.status IS DISTINCT FROM 'ACTIVE' OR resource.resource_status NOT IN ('LOCAL','ONLINE')
      OR resource.resource_expires_at IS NULL OR NOT isfinite(resource.resource_expires_at)
      OR resource.resource_expires_at<NEW.expires_at OR resource.manual_hold
      OR NOT resource.sale_enabled OR EXISTS(SELECT 1 FROM whole_number_reservations r
        WHERE r.number_id=NEW.number_id AND r.order_id IS DISTINCT FROM NEW.order_id)) THEN
      RAISE EXCEPTION 'Whole resource is unavailable or expiry does not cover purchased service'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.allocation_type IS DISTINCT FROM 'PLATFORM' THEN RAISE EXCEPTION 'Unknown allocation type'; END IF;
  SELECT * INTO stock FROM number_platforms WHERE number_id=NEW.number_id AND platform_id=NEW.platform_id FOR UPDATE;
  IF stock.number_id IS NULL OR account.product IS DISTINCT FROM 'SMS_CODE' OR account.storefront_id IS DISTINCT FROM 'linepool'
    OR account.provider IS DISTINCT FROM stock.provider THEN RAISE EXCEPTION 'Platform resource/account mismatch'; END IF;
  IF NEW.agent_entitlement_id IS NOT NULL THEN
    SELECT * INTO entitlement FROM service_entitlements WHERE id=NEW.agent_entitlement_id;
    SELECT * INTO holding FROM number_holdings WHERE id=entitlement.holding_id;
    IF holding.owner_type='AGENT' THEN SELECT user_id INTO owner_id FROM agents WHERE id=holding.agent_id;
    ELSE SELECT user_id INTO owner_id FROM customers WHERE id=holding.customer_id; END IF;
    IF entitlement.id IS NULL OR entitlement.inventory_id IS DISTINCT FROM stock.id OR entitlement.service IS DISTINCT FROM stock.platform_id
      OR owner_id IS DISTINCT FROM NEW.user_id OR NEW.order_id IS NOT NULL
      OR NEW.assigned_at<GREATEST(entitlement.starts_at,holding.starts_at)
      OR NEW.expires_at>LEAST(entitlement.expires_at,COALESCE(holding.expires_at,entitlement.expires_at)) THEN
      RAISE EXCEPTION 'Agent allocation does not match its resource, owner or service window'; END IF;
    IF NEW.released_at IS NULL AND (holding.status NOT IN ('ACTIVE','SUSPENDED') OR entitlement.status IS DISTINCT FROM 'ACTIVE') THEN
      RAISE EXCEPTION 'Agent service is no longer active'; END IF;
  ELSIF NEW.expires_at-NEW.assigned_at NOT IN (interval '168 hours',interval '720 hours') THEN
    RAISE EXCEPTION 'Service duration must be 7 or 30 days';
  END IF;
  IF NEW.released_at IS NULL THEN
    IF NOT stock.is_available OR resource.resource_status NOT IN ('LOCAL','ONLINE')
      OR ((NEW.agent_entitlement_id IS NULL OR holding.source_holding_id IS NULL) AND (NOT stock.sale_enabled OR NOT resource.sale_enabled))
      OR (stock.reserved_order_id IS NOT NULL AND stock.reserved_order_id IS DISTINCT FROM NEW.order_id) THEN
      RAISE EXCEPTION 'Number platform resource is unavailable'; END IF;
    IF NOT EXISTS(SELECT 1 FROM provider_projects p JOIN platforms f ON f.id=p.platform_id
      WHERE p.provider=stock.provider AND p.external_project_id=stock.external_project_id AND p.platform_id=stock.platform_id
        AND p.upstream_account_id=resource.upstream_account_id AND p.is_active AND f.is_active) THEN
      RAISE EXCEPTION 'Platform project is inactive or belongs to another account'; END IF;
    IF stock.provider='pingcode' AND (resource.resource_status<>'ONLINE' OR resource.resource_expires_at IS NULL
      OR resource.resource_expires_at<NEW.expires_at) THEN RAISE EXCEPTION 'Resource expiry does not cover service period'; END IF;
  END IF;
  IF NEW.order_id IS NOT NULL THEN
    SELECT * INTO purchased FROM orders WHERE id=NEW.order_id;
    IF purchased.product_type IS DISTINCT FROM 'SMS_CODE' OR purchased.sales_storefront_id IS DISTINCT FROM 'linepool'
      OR purchased.user_id IS DISTINCT FROM NEW.user_id OR purchased.service IS DISTINCT FROM NEW.platform_id
      OR purchased.region_id IS DISTINCT FROM resource.region_id
      OR NEW.expires_at IS DISTINCT FROM NEW.assigned_at+purchased.duration_days*interval '24 hours' THEN
      RAISE EXCEPTION 'Service does not match purchased order'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION guard_whole_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purchased orders%ROWTYPE; held leases%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.number_id IS DISTINCT FROM OLD.number_id OR NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.lease_id IS DISTINCT FROM OLD.lease_id) THEN RAISE EXCEPTION 'Whole reservation identity is immutable'; END IF;
  SELECT * INTO purchased FROM orders WHERE id=NEW.order_id;
  IF purchased.product_type IS DISTINCT FROM 'NUMBER_LEASE' OR purchased.target_number_id IS DISTINCT FROM NEW.number_id
    OR purchased.lease_id IS DISTINCT FROM NEW.lease_id OR purchased.fulfillment_status IS DISTINCT FROM 'PROCESSING' THEN
    RAISE EXCEPTION 'Whole reservation must match an unresolved whole order'; END IF;
  IF NEW.lease_id IS NOT NULL THEN
    SELECT * INTO held FROM leases WHERE id=NEW.lease_id;
    IF held.user_id IS DISTINCT FROM purchased.user_id OR held.number_id IS DISTINCT FROM NEW.number_id
      OR held.status NOT IN ('ACTIVE','EXPIRED_HELD') THEN RAISE EXCEPTION 'Whole reservation lease mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER whole_reservation_guard BEFORE INSERT OR UPDATE ON whole_number_reservations FOR EACH ROW EXECUTE FUNCTION guard_whole_reservation();

ALTER TABLE provider_projects ADD CONSTRAINT provider_projects_account_identity UNIQUE(provider,external_project_id,upstream_account_id);
ALTER TABLE provider_resource_bindings ALTER COLUMN external_project_id DROP NOT NULL;
ALTER TABLE provider_sync_tasks ADD COLUMN scope_kind text NOT NULL DEFAULT 'PROJECT', ADD COLUMN upstream_account_id uuid;
UPDATE provider_sync_tasks t SET upstream_account_id=p.upstream_account_id FROM provider_projects p
  WHERE p.provider=t.provider AND p.external_project_id=t.external_project_id;
ALTER TABLE provider_sync_tasks ALTER COLUMN upstream_account_id SET NOT NULL, ALTER COLUMN external_project_id DROP NOT NULL,
  ADD CONSTRAINT sync_task_account_fk FOREIGN KEY(upstream_account_id,provider) REFERENCES upstream_accounts(id,provider),
  ADD CONSTRAINT sync_task_project_account_fk FOREIGN KEY(provider,external_project_id,upstream_account_id)
    REFERENCES provider_projects(provider,external_project_id,upstream_account_id),
  ADD CONSTRAINT sync_task_scope_shape CHECK((scope_kind='PROJECT' AND external_project_id IS NOT NULL)
    OR (scope_kind='ACCOUNT' AND external_project_id IS NULL));
DROP INDEX provider_sync_tasks_running;
CREATE UNIQUE INDEX provider_sync_tasks_project_running ON provider_sync_tasks(provider,external_project_id)
  WHERE scope_kind='PROJECT' AND status IN ('PENDING','RUNNING');
CREATE UNIQUE INDEX provider_sync_tasks_account_running ON provider_sync_tasks(provider,upstream_account_id)
  WHERE scope_kind='ACCOUNT' AND status IN ('PENDING','RUNNING');
CREATE INDEX provider_sync_tasks_account_created ON provider_sync_tasks(upstream_account_id,created_at DESC,id DESC) WHERE scope_kind='ACCOUNT';
ALTER TABLE provider_sync_conflicts ADD COLUMN scope_kind text NOT NULL DEFAULT 'PROJECT', ADD COLUMN upstream_account_id uuid;
UPDATE provider_sync_conflicts c SET scope_kind=t.scope_kind,upstream_account_id=t.upstream_account_id FROM provider_sync_tasks t WHERE t.id=c.task_id;
ALTER TABLE provider_sync_conflicts ALTER COLUMN upstream_account_id SET NOT NULL, ALTER COLUMN external_project_id DROP NOT NULL,
  ADD CONSTRAINT sync_conflict_account_fk FOREIGN KEY(upstream_account_id,provider) REFERENCES upstream_accounts(id,provider),
  ADD CONSTRAINT sync_conflict_project_account_fk FOREIGN KEY(provider,external_project_id,upstream_account_id)
    REFERENCES provider_projects(provider,external_project_id,upstream_account_id),
  ADD CONSTRAINT sync_conflict_scope_shape CHECK((scope_kind='PROJECT' AND external_project_id IS NOT NULL)
    OR (scope_kind='ACCOUNT' AND external_project_id IS NULL));
DROP INDEX provider_sync_conflicts_open;
CREATE UNIQUE INDEX provider_sync_conflicts_project_open ON provider_sync_conflicts(provider,external_project_id,external_number_id,conflict_type)
  WHERE scope_kind='PROJECT' AND status='OPEN';
CREATE UNIQUE INDEX provider_sync_conflicts_account_open ON provider_sync_conflicts(provider,external_number_id,conflict_type)
  WHERE scope_kind='ACCOUNT' AND status='OPEN';
CREATE FUNCTION guard_provider_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task provider_sync_tasks%ROWTYPE; account record;
BEGIN
  IF TG_TABLE_NAME='provider_sync_tasks' THEN
    IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.provider IS DISTINCT FROM OLD.provider
      OR NEW.upstream_account_id IS DISTINCT FROM OLD.upstream_account_id
      OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind OR NEW.external_project_id IS DISTINCT FROM OLD.external_project_id) THEN
      RAISE EXCEPTION 'Sync task scope identity is immutable'; END IF;
    SELECT a.*,s.product INTO account FROM upstream_accounts a JOIN storefronts s ON s.id=a.storefront_id WHERE a.id=NEW.upstream_account_id;
    IF NEW.scope_kind='ACCOUNT' AND (account.product IS DISTINCT FROM 'NUMBER_LEASE' OR account.provider IS DISTINCT FROM 'pingcode-mock'
      OR account.storefront_id IS DISTINCT FROM 'once') THEN RAISE EXCEPTION 'Account sync requires Mock whole-number account'; END IF;
    IF NEW.scope_kind='PROJECT' AND (account.product IS DISTINCT FROM 'SMS_CODE'
      OR account.storefront_id IS DISTINCT FROM 'linepool' OR account.provider IS DISTINCT FROM NEW.provider) THEN
      RAISE EXCEPTION 'Project sync requires matching platform resource account'; END IF;
  ELSE
    IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id
      OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
      OR NEW.upstream_account_id IS DISTINCT FROM OLD.upstream_account_id
      OR NEW.external_project_id IS DISTINCT FROM OLD.external_project_id
      OR NEW.external_number_id IS DISTINCT FROM OLD.external_number_id OR NEW.conflict_type IS DISTINCT FROM OLD.conflict_type
      OR (OLD.number_id IS NOT NULL AND NEW.number_id IS DISTINCT FROM OLD.number_id)) THEN
      RAISE EXCEPTION 'Sync conflict scope/resource identity is immutable'; END IF;
    SELECT * INTO task FROM provider_sync_tasks WHERE id=NEW.task_id;
    IF task.id IS NULL OR NEW.provider IS DISTINCT FROM task.provider OR NEW.upstream_account_id IS DISTINCT FROM task.upstream_account_id
      OR NEW.scope_kind IS DISTINCT FROM task.scope_kind OR NEW.external_project_id IS DISTINCT FROM task.external_project_id THEN
      RAISE EXCEPTION 'Conflict scope must match task identity'; END IF;
    IF NEW.number_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM phone_numbers n WHERE n.id=NEW.number_id AND n.upstream_account_id=NEW.upstream_account_id) THEN
      RAISE EXCEPTION 'Sync conflict number/account mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_sync_task_scope_guard BEFORE INSERT OR UPDATE ON provider_sync_tasks FOR EACH ROW EXECUTE FUNCTION guard_provider_scope();
CREATE TRIGGER provider_sync_conflict_scope_guard BEFORE INSERT OR UPDATE ON provider_sync_conflicts FOR EACH ROW EXECUTE FUNCTION guard_provider_scope();
CREATE FUNCTION guard_resource_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource record; project provider_projects%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.provider IS DISTINCT FROM OLD.provider OR NEW.external_number_id IS DISTINCT FROM OLD.external_number_id
    OR NEW.number_id IS DISTINCT FROM OLD.number_id OR NEW.external_project_id IS DISTINCT FROM OLD.external_project_id) THEN
    RAISE EXCEPTION 'Resource binding identity is immutable'; END IF;
  SELECT n.upstream_account_id,a.provider,a.storefront_id,s.product INTO resource FROM phone_numbers n
    JOIN upstream_accounts a ON a.id=n.upstream_account_id JOIN storefronts s ON s.id=a.storefront_id WHERE n.id=NEW.number_id;
  IF NOT FOUND OR resource.provider IS DISTINCT FROM NEW.provider THEN RAISE EXCEPTION 'Resource binding account/provider mismatch'; END IF;
  IF resource.product='NUMBER_LEASE' THEN
    IF NEW.external_project_id IS NOT NULL OR resource.storefront_id IS DISTINCT FROM 'once' THEN
      RAISE EXCEPTION 'Whole-number binding must have no project and use its trusted lease account'; END IF;
  ELSIF resource.product='SMS_CODE' THEN
    SELECT * INTO project FROM provider_projects WHERE provider=NEW.provider AND external_project_id=NEW.external_project_id;
    IF project.upstream_account_id IS DISTINCT FROM resource.upstream_account_id THEN RAISE EXCEPTION 'Resource binding requires same-account real project'; END IF;
  ELSE RAISE EXCEPTION 'Unsupported resource product'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_binding_identity_guard BEFORE INSERT OR UPDATE ON provider_resource_bindings FOR EACH ROW EXECUTE FUNCTION guard_resource_binding();
CREATE FUNCTION guard_s4_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='platforms' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Platform identity is immutable'; END IF;
  ELSIF TG_TABLE_NAME='phone_numbers' THEN
    IF TG_OP='UPDATE' THEN
      IF (NEW.id IS DISTINCT FROM OLD.id OR NEW.upstream_account_id IS DISTINCT FROM OLD.upstream_account_id
        OR NEW.phone_number IS DISTINCT FROM OLD.phone_number OR NEW.region_id IS DISTINCT FROM OLD.region_id)
        AND (EXISTS(SELECT 1 FROM number_allocations WHERE number_id=OLD.id)
          OR EXISTS(SELECT 1 FROM provider_resource_bindings WHERE number_id=OLD.id)
          OR EXISTS(SELECT 1 FROM leases WHERE number_id=OLD.id)
          OR EXISTS(SELECT 1 FROM orders WHERE target_number_id=OLD.id)
          OR EXISTS(SELECT 1 FROM whole_number_reservations WHERE number_id=OLD.id)
          OR EXISTS(SELECT 1 FROM number_platforms WHERE number_id=OLD.id)) THEN
        RAISE EXCEPTION 'Referenced number identity is immutable'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME='upstream_accounts' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.provider IS DISTINCT FROM OLD.provider
      OR NEW.external_account_id IS DISTINCT FROM OLD.external_account_id OR NEW.storefront_id IS DISTINCT FROM OLD.storefront_id THEN
      RAISE EXCEPTION 'Upstream account identity is immutable'; END IF;
  ELSIF TG_TABLE_NAME='storefronts' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.product IS DISTINCT FROM OLD.product THEN
      RAISE EXCEPTION 'Storefront product identity is immutable'; END IF;
  ELSIF TG_TABLE_NAME='provider_projects' THEN
    IF TG_OP='UPDATE' THEN
      IF NEW.provider IS DISTINCT FROM OLD.provider OR NEW.external_project_id IS DISTINCT FROM OLD.external_project_id
        OR NEW.platform_id IS DISTINCT FROM OLD.platform_id OR NEW.upstream_account_id IS DISTINCT FROM OLD.upstream_account_id THEN
        RAISE EXCEPTION 'Provider project identity is immutable'; END IF;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM upstream_accounts a JOIN storefronts s ON s.id=a.storefront_id
      WHERE a.id=NEW.upstream_account_id AND a.provider=NEW.provider AND a.storefront_id='linepool' AND s.product='SMS_CODE') THEN
      RAISE EXCEPTION 'Projects are only valid for matching platform resource accounts'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_identity_guard BEFORE UPDATE ON platforms FOR EACH ROW EXECUTE FUNCTION guard_s4_identity();
CREATE TRIGGER number_resource_identity_guard BEFORE INSERT OR UPDATE ON phone_numbers FOR EACH ROW EXECUTE FUNCTION guard_s4_identity();
CREATE TRIGGER upstream_account_identity_guard BEFORE UPDATE ON upstream_accounts FOR EACH ROW EXECUTE FUNCTION guard_s4_identity();
CREATE TRIGGER storefront_product_identity_guard BEFORE UPDATE ON storefronts FOR EACH ROW EXECUTE FUNCTION guard_s4_identity();
CREATE TRIGGER provider_project_identity_guard BEFORE INSERT OR UPDATE ON provider_projects FOR EACH ROW EXECUTE FUNCTION guard_s4_identity();
CREATE TABLE once_settings (
  storefront_id text PRIMARY KEY REFERENCES storefronts(id), cooldown_days integer CHECK(cooldown_days BETWEEN 0 AND 365),
  version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES users(id)
);

CREATE FUNCTION guard_number_platform_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.number_id IS DISTINCT FROM OLD.number_id OR NEW.platform_id IS DISTINCT FROM OLD.platform_id
      OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.external_project_id IS DISTINCT FROM OLD.external_project_id THEN
      RAISE EXCEPTION 'Platform inventory resource identity is immutable'; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM phone_numbers n JOIN upstream_accounts a ON a.id=n.upstream_account_id
    JOIN storefronts s ON s.id=a.storefront_id JOIN provider_projects p ON p.provider=NEW.provider
      AND p.external_project_id=NEW.external_project_id AND p.platform_id=NEW.platform_id
    WHERE n.id=NEW.number_id AND a.id=p.upstream_account_id AND a.provider=NEW.provider
      AND a.storefront_id='linepool' AND s.product='SMS_CODE') THEN
    RAISE EXCEPTION 'Platform inventory requires the same real project/account and SMS resource'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER number_platform_identity_guard BEFORE INSERT OR UPDATE ON number_platforms
  FOR EACH ROW EXECUTE FUNCTION guard_number_platform_identity();
