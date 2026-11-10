-- LinePool unified agent model: every PinClode account is an agent; a site sells the numbers of a shop's agent.
-- Forward only. The official storefront is an OFFICIAL shop pointing at an agent chosen by an administrator.
-- AGENT shops are reserved for the multi-domain storefront plan. Changing the official agent means suspending
-- the old shop and creating a new one, so ownership history is never rewritten.

CREATE TABLE shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL REFERENCES storefronts(id) CHECK (site_id='linepool'),
  kind text NOT NULL CHECK (kind IN ('OFFICIAL','AGENT')),
  agent_id uuid NOT NULL REFERENCES agents(id),
  connection_id uuid NOT NULL REFERENCES upstream_accounts(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz,
  CHECK ((status='SUSPENDED')=(suspended_at IS NOT NULL)),
  UNIQUE (id, connection_id)
);
CREATE UNIQUE INDEX shops_one_active_official ON shops(site_id) WHERE kind='OFFICIAL' AND status='ACTIVE';
CREATE UNIQUE INDEX shops_one_active_per_agent ON shops(agent_id) WHERE status='ACTIVE';
CREATE INDEX shops_connection ON shops(connection_id) WHERE status='ACTIVE';

CREATE FUNCTION guard_shop() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Shop history is immutable'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.agent_id IS DISTINCT FROM OLD.agent_id OR NEW.connection_id IS DISTINCT FROM OLD.connection_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.status='SUSPENDED' AND NEW.status<>'SUSPENDED')) THEN
    RAISE EXCEPTION 'Shop identity is immutable and a suspended shop cannot reopen'; END IF;
  IF NOT EXISTS(SELECT 1 FROM upstream_accounts a JOIN agents g ON g.id=a.agent_id
    WHERE a.id=NEW.connection_id AND a.agent_id=NEW.agent_id AND a.owner_kind='AGENT' AND a.storefront_id=NEW.site_id
      AND NOT a.historical_only AND a.provider='pingcode') THEN
    RAISE EXCEPTION 'A shop must use its own agent''s real PinClode connection on the same site'; END IF;
  IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND role='ADMIN' AND account_status='ACTIVE') THEN
    RAISE EXCEPTION 'Only an active administrator can open a shop'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shop_guard BEFORE INSERT OR UPDATE OR DELETE ON shops FOR EACH ROW EXECUTE FUNCTION guard_shop();

-- Platform allocations may use a self-service connection (Mock compatibility) or an ACTIVE shop's connection.
-- Copied from 048 unchanged except for that one ownership condition.
CREATE OR REPLACE FUNCTION guard_platform_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stock number_platforms%ROWTYPE; resource phone_numbers%ROWTYPE; purchased orders%ROWTYPE;
  entitlement service_entitlements%ROWTYPE; holding number_holdings%ROWTYPE; owner_id uuid; account record; held leases%ROWTYPE; binding provider_resource_bindings%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.number_id IS DISTINCT FROM OLD.number_id OR NEW.platform_id IS DISTINCT FROM OLD.platform_id
      OR NEW.allocation_type IS DISTINCT FROM OLD.allocation_type OR NEW.lease_id IS DISTINCT FROM OLD.lease_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
      OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.agent_entitlement_id IS DISTINCT FROM OLD.agent_entitlement_id
      OR NEW.receiving_mode IS DISTINCT FROM OLD.receiving_mode OR NEW.source_scope IS DISTINCT FROM OLD.source_scope
      OR NEW.code_rule_snapshot IS DISTINCT FROM OLD.code_rule_snapshot
      OR (OLD.released_at IS NOT NULL AND NEW.released_at IS DISTINCT FROM OLD.released_at)
      OR (OLD.receiving_status IN ('SUCCESS','FAILED') AND (NEW.receiving_status IS DISTINCT FROM OLD.receiving_status
        OR NEW.first_message_id IS DISTINCT FROM OLD.first_message_id OR NEW.receiving_review_id IS DISTINCT FROM OLD.receiving_review_id)) THEN
      RAISE EXCEPTION 'Service ownership, receiving evidence and purchased period are immutable'; END IF;
    IF OLD.receiving_status='WAITING' AND NEW.released_at IS NOT NULL AND NEW.receiving_status<>'FAILED' THEN
      RAISE EXCEPTION 'Unresolved one-time receiving cannot be reclaimed or expired'; END IF;
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
      OR account.provider NOT IN ('pingcode','pingcode-mock') OR account.owner_kind IS DISTINCT FROM 'SELF_SERVICE' OR account.historical_only
      OR account.status IS DISTINCT FROM 'ACTIVE' OR resource.resource_status NOT IN ('LOCAL','ONLINE')
      OR resource.resource_expires_at IS NULL OR NOT isfinite(resource.resource_expires_at)
      OR resource.resource_expires_at<NEW.expires_at OR resource.manual_hold OR NOT resource.sale_enabled
      OR EXISTS(SELECT 1 FROM whole_number_reservations r WHERE r.number_id=NEW.number_id AND r.order_id IS DISTINCT FROM NEW.order_id)) THEN
      RAISE EXCEPTION 'Whole resource is unavailable or expiry does not cover purchased service'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.allocation_type IS DISTINCT FROM 'PLATFORM' THEN RAISE EXCEPTION 'Unknown allocation type'; END IF;
  SELECT * INTO stock FROM number_platforms WHERE number_id=NEW.number_id AND platform_id=NEW.platform_id FOR UPDATE;
  IF stock.number_id IS NULL OR account.product IS DISTINCT FROM 'SMS_CODE' OR account.storefront_id IS DISTINCT FROM 'linepool'
    OR account.provider IS DISTINCT FROM stock.provider THEN RAISE EXCEPTION 'Platform resource/account mismatch'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lp-sale:'||resource.phone_number||':'||NEW.platform_id,0));
  IF EXISTS(SELECT 1 FROM lp_platform_sales WHERE phone_number=resource.phone_number AND platform_id=NEW.platform_id) THEN
    RAISE EXCEPTION 'This phone number and platform were permanently sold'; END IF;
  IF EXISTS(SELECT 1 FROM number_allocations a JOIN phone_numbers n ON n.id=a.number_id WHERE n.phone_number=resource.phone_number
    AND a.platform_id=NEW.platform_id AND a.receiving_status='WAITING') THEN RAISE EXCEPTION 'One-time receiving is unresolved'; END IF;
  IF NEW.order_id IS NOT NULL THEN SELECT * INTO purchased FROM orders WHERE id=NEW.order_id; END IF;
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
  ELSIF NEW.receiving_mode='ONE_TIME' THEN
    IF purchased.receiving_mode IS DISTINCT FROM 'ONE_TIME' OR purchased.quantity IS DISTINCT FROM 1
      OR NEW.receiving_status IS DISTINCT FROM 'WAITING' OR NEW.expires_at IS DISTINCT FROM NEW.assigned_at+interval '15 minutes'
      OR NEW.code_rule_snapshot IS DISTINCT FROM purchased.product_snapshot->'codeRule' THEN
      RAISE EXCEPTION 'One-time allocation requires its original purchase rule and exact receiving window'; END IF;
  ELSIF NEW.receiving_mode<>'HOSTED' OR NEW.expires_at-NEW.assigned_at NOT IN (interval '168 hours',interval '720 hours') THEN
    RAISE EXCEPTION 'Hosted service duration must be a complete 168 or 720 hours';
  END IF;
  IF NEW.released_at IS NULL THEN
    IF NOT stock.is_available OR resource.resource_status NOT IN ('LOCAL','ONLINE') OR resource.source_missing OR resource.manual_hold
      OR ((NEW.agent_entitlement_id IS NULL OR holding.source_holding_id IS NULL) AND (NOT stock.sale_enabled OR NOT resource.sale_enabled))
      OR (stock.reserved_order_id IS NOT NULL AND stock.reserved_order_id IS DISTINCT FROM NEW.order_id)
      OR (account.owner_kind IS DISTINCT FROM 'SELF_SERVICE' AND NOT EXISTS(SELECT 1 FROM shops sh
        WHERE sh.connection_id=account.id AND sh.site_id=account.storefront_id AND sh.status='ACTIVE'))
      OR account.historical_only OR account.status IS DISTINCT FROM 'ACTIVE'
      OR account.auth_status IS DISTINCT FROM 'ACTIVE' OR account.access_expires_at<=now()
      OR NOT ('SMS_CODE'=ANY(account.enabled_capabilities)) THEN RAISE EXCEPTION 'Number platform resource is unavailable'; END IF;
    IF NOT EXISTS(SELECT 1 FROM provider_projects p JOIN platforms f ON f.id=p.platform_id
      WHERE p.provider=stock.provider AND p.external_project_id=stock.external_project_id AND p.platform_id=stock.platform_id
        AND p.upstream_account_id=resource.upstream_account_id AND p.is_active AND f.is_active) THEN
      RAISE EXCEPTION 'Platform project is inactive or belongs to another account'; END IF;
    IF resource.resource_expires_at IS NULL OR NOT isfinite(resource.resource_expires_at) OR resource.resource_expires_at<NEW.expires_at THEN
      RAISE EXCEPTION 'Resource expiry does not cover the full service period'; END IF;
  END IF;
  IF NEW.order_id IS NOT NULL THEN
    IF purchased.product_type IS DISTINCT FROM 'SMS_CODE' OR purchased.sales_storefront_id IS DISTINCT FROM 'linepool'
      OR purchased.user_id IS DISTINCT FROM NEW.user_id OR purchased.service IS DISTINCT FROM NEW.platform_id
      OR purchased.region_id IS DISTINCT FROM resource.region_id OR purchased.receiving_mode IS DISTINCT FROM NEW.receiving_mode
      OR NEW.expires_at IS DISTINCT FROM NEW.assigned_at+(CASE WHEN purchased.receiving_mode='ONE_TIME' THEN interval '15 minutes'
        ELSE purchased.duration_days*interval '24 hours' END) THEN RAISE EXCEPTION 'Service does not match purchased order'; END IF;
  END IF;
  SELECT * INTO binding FROM provider_resource_bindings WHERE provider=stock.provider AND number_id=NEW.number_id
    AND (external_project_id=stock.external_project_id
      OR (stock.provider='pingcode' AND starts_with(stock.external_project_id,'lp:') AND external_project_id IS NULL));
  IF binding.number_id IS NULL THEN RAISE EXCEPTION 'Platform allocation requires its original trusted number binding'; END IF;
  NEW.source_scope:=jsonb_build_object('provider',stock.provider,'connectionId',resource.upstream_account_id,
    'externalNumberId',binding.external_number_id,'externalProjectId',stock.external_project_id,'phoneNumber',resource.phone_number);
  RETURN NEW;
END $$;
