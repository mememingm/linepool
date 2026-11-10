-- LinePool real self-service source. Forward only; no existing row is rewritten by this migration.
-- 1) A self-service connection may be retired exactly once (historical_only false -> true) when it is
--    simultaneously stripped of authorization, so a site can move its self-service source to another account.
-- 2) A real PinClode self-service number on LinePool binds to its own connection without an inferred
--    upstream project, like real agent numbers. Platform slots use LinePool-local projects instead.
-- 3) A platform allocation on a LinePool-local slot ('lp:' project) accepts that project-less binding.
--    guard_platform_allocation is otherwise copied unchanged from 047; expiry rules stay strict.

CREATE OR REPLACE FUNCTION guard_pc_connection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.owner_kind IS DISTINCT FROM OLD.owner_kind OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.external_account_id IS DISTINCT FROM OLD.external_account_id OR NEW.storefront_id IS DISTINCT FROM OLD.storefront_id
    OR (NEW.historical_only IS DISTINCT FROM OLD.historical_only
      AND NOT (OLD.historical_only=false AND NEW.historical_only=true AND OLD.owner_kind='SELF_SERVICE'))
    OR (OLD.application_id IS NOT NULL AND NEW.application_id IS DISTINCT FROM OLD.application_id)
    OR (OLD.issuer IS NOT NULL AND NEW.issuer IS DISTINCT FROM OLD.issuer)
    OR (OLD.subject IS NOT NULL AND NEW.subject IS DISTINCT FROM OLD.subject)) THEN
    RAISE EXCEPTION 'Connection owner and authorized identity are immutable'; END IF;
  IF NEW.historical_only AND (NEW.owner_kind<>'SELF_SERVICE' OR NEW.auth_status<>'UNAUTHORIZED' OR NEW.access_token IS NOT NULL
    OR NEW.refresh_token IS NOT NULL OR cardinality(NEW.capabilities)>0 OR cardinality(NEW.enabled_capabilities)>0) THEN
    RAISE EXCEPTION 'Historical provenance accounts cannot authorize or operate'; END IF;
  IF NEW.owner_kind='AGENT' AND NOT EXISTS(SELECT 1 FROM pc_agent_identities i WHERE i.agent_id=NEW.agent_id
    AND i.site_id=NEW.storefront_id AND i.application_id=NEW.application_id AND i.issuer=NEW.issuer AND i.subject=NEW.subject) THEN
    RAISE EXCEPTION 'Agent connection requires matching trusted identity'; END IF;
  IF NOT(NEW.capabilities <@ CASE WHEN NEW.storefront_id='linepool' THEN ARRAY['SMS_CODE']::text[]
    WHEN NEW.storefront_id='once' THEN ARRAY['NUMBER_LEASE','SEND_SMS']::text[] ELSE '{}'::text[] END) THEN
    RAISE EXCEPTION 'Connection capabilities exceed storefront product'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_resource_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource record; project provider_projects%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.provider IS DISTINCT FROM OLD.provider OR NEW.external_number_id IS DISTINCT FROM OLD.external_number_id
    OR NEW.number_id IS DISTINCT FROM OLD.number_id OR NEW.external_project_id IS DISTINCT FROM OLD.external_project_id) THEN
    RAISE EXCEPTION 'Resource binding identity is immutable'; END IF;
  SELECT n.upstream_account_id,a.provider,a.storefront_id,a.owner_kind,s.product INTO resource FROM phone_numbers n
    JOIN upstream_accounts a ON a.id=n.upstream_account_id JOIN storefronts s ON s.id=a.storefront_id WHERE n.id=NEW.number_id;
  IF NOT FOUND OR resource.provider IS DISTINCT FROM NEW.provider THEN RAISE EXCEPTION 'Resource binding account/provider mismatch'; END IF;
  IF resource.product='NUMBER_LEASE' THEN
    IF NEW.external_project_id IS NOT NULL OR resource.storefront_id IS DISTINCT FROM 'once' THEN
      RAISE EXCEPTION 'Whole-number binding must have no project and use its trusted lease account'; END IF;
  ELSIF resource.product='SMS_CODE' AND resource.owner_kind IN ('AGENT','SELF_SERVICE') AND resource.provider='pingcode' THEN
    IF resource.storefront_id IS DISTINCT FROM 'linepool' OR NEW.external_project_id IS NOT NULL THEN
      RAISE EXCEPTION 'Real LinePool binding must use its own connection without an inferred project'; END IF;
  ELSIF resource.product='SMS_CODE' THEN
    SELECT * INTO project FROM provider_projects WHERE provider=NEW.provider AND external_project_id=NEW.external_project_id;
    IF project.upstream_account_id IS DISTINCT FROM resource.upstream_account_id THEN RAISE EXCEPTION 'Resource binding requires same-account real project'; END IF;
  ELSE RAISE EXCEPTION 'Unsupported resource product'; END IF;
  RETURN NEW;
END $$;

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
      OR account.owner_kind IS DISTINCT FROM 'SELF_SERVICE' OR account.historical_only OR account.status IS DISTINCT FROM 'ACTIVE'
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
