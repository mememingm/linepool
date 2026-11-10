-- Real PinClode protocol state and selected-provider whole-number operations.
-- Forward only: no existing account, token, balance or historical message is rewritten.
ALTER TABLE pc_auth_states ADD COLUMN code_verifier text,
  ADD CONSTRAINT pc_auth_code_verifier_shape CHECK(code_verifier IS NULL OR code_verifier ~ '^[A-Za-z0-9._~-]{43,128}$');
ALTER TABLE upstream_accounts ADD COLUMN message_checkpoint jsonb,
  ADD CONSTRAINT pc_message_checkpoint_shape CHECK(message_checkpoint IS NULL OR jsonb_typeof(message_checkpoint)='object');
ALTER TABLE mock_fulfillment_operations
  DROP CONSTRAINT mock_fulfillment_operations_source_check,
  ALTER COLUMN scenario DROP NOT NULL,
  ADD CONSTRAINT fulfillment_operation_source CHECK(source IN ('mock','local-service')),
  ADD CONSTRAINT fulfillment_operation_scenario_shape CHECK(
    (source='mock' AND scenario IS NOT NULL) OR (source='local-service' AND scenario IS NULL));

CREATE OR REPLACE FUNCTION guard_once_order() RETURNS trigger LANGUAGE plpgsql AS $$
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
    SELECT n.*,a.provider,a.storefront_id,a.owner_kind,a.historical_only,s.product INTO resource FROM phone_numbers n
      JOIN upstream_accounts a ON a.id=n.upstream_account_id JOIN storefronts s ON s.id=a.storefront_id
      WHERE n.id=NEW.target_number_id;
    IF NOT FOUND OR resource.region_id IS DISTINCT FROM NEW.region_id OR resource.storefront_id IS DISTINCT FROM NEW.sales_storefront_id
      OR resource.product IS DISTINCT FROM 'NUMBER_LEASE'
      OR (NEW.import_batch_id IS NULL AND (resource.provider NOT IN ('pingcode','pingcode-mock') OR resource.owner_kind IS DISTINCT FROM 'SELF_SERVICE' OR resource.historical_only)) THEN
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
      OR account.provider NOT IN ('pingcode','pingcode-mock') OR account.owner_kind IS DISTINCT FROM 'SELF_SERVICE' OR account.historical_only
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

CREATE OR REPLACE FUNCTION guard_provider_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task provider_sync_tasks%ROWTYPE; account record;
BEGIN
  IF TG_TABLE_NAME='provider_sync_tasks' THEN
    IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.provider IS DISTINCT FROM OLD.provider
      OR NEW.upstream_account_id IS DISTINCT FROM OLD.upstream_account_id
      OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind OR NEW.external_project_id IS DISTINCT FROM OLD.external_project_id) THEN
      RAISE EXCEPTION 'Sync task scope identity is immutable'; END IF;
    SELECT a.*,s.product INTO account FROM upstream_accounts a JOIN storefronts s ON s.id=a.storefront_id WHERE a.id=NEW.upstream_account_id;
    IF NEW.scope_kind='ACCOUNT' AND (account.product IS DISTINCT FROM 'NUMBER_LEASE' OR account.provider NOT IN ('pingcode','pingcode-mock')
      OR account.storefront_id IS DISTINCT FROM 'once') THEN RAISE EXCEPTION 'Account sync requires a matching whole-number account'; END IF;
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

CREATE OR REPLACE FUNCTION guard_outbound_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocation number_allocations%ROWTYPE; resource phone_numbers%ROWTYPE; account record; binding provider_resource_bindings%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.import_batch_id IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Imported outbound facts are immutable'; END IF;
    IF (to_jsonb(NEW)-ARRAY['provider_message_id','status','attempts','claim_token','claim_deadline','last_event_at','last_checked_at','error_message','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['provider_message_id','status','attempts','claim_token','claim_deadline','last_event_at','last_checked_at','error_message','updated_at'])
      OR (OLD.provider_message_id IS NOT NULL AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id) THEN
      RAISE EXCEPTION 'Accepted outbound message identity is immutable'; END IF;
    IF OLD.status IN ('DELIVERED','UNDELIVERABLE','FAILED') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Outbound terminal state cannot change'; END IF;
    IF OLD.status='SENT' AND NEW.status IN ('PENDING','SUBMITTING','QUEUED','SENDING','UNCERTAIN') THEN
      RAISE EXCEPTION 'Sent message cannot regress'; END IF;
    IF OLD.last_event_at IS NOT NULL AND (NEW.last_event_at IS NULL OR NEW.last_event_at<OLD.last_event_at) THEN
      RAISE EXCEPTION 'Outbound event time cannot regress'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO allocation FROM number_allocations WHERE id=NEW.allocation_id;
  SELECT * INTO resource FROM phone_numbers WHERE id=NEW.number_id;
  SELECT a.*,s.product INTO account FROM upstream_accounts a JOIN storefronts s ON s.id=a.storefront_id WHERE a.id=NEW.upstream_account_id;
  SELECT * INTO binding FROM provider_resource_bindings WHERE provider=NEW.provider AND external_number_id=NEW.external_number_id;
  IF allocation.allocation_type IS DISTINCT FROM 'WHOLE_NUMBER' OR allocation.lease_id IS DISTINCT FROM NEW.lease_id
    OR allocation.number_id IS DISTINCT FROM NEW.number_id OR allocation.user_id IS DISTINCT FROM NEW.user_id
    OR resource.upstream_account_id IS DISTINCT FROM NEW.upstream_account_id OR resource.phone_number IS DISTINCT FROM NEW.sender_number
    OR account.provider IS DISTINCT FROM NEW.provider
    OR account.storefront_id IS DISTINCT FROM 'once' OR account.product IS DISTINCT FROM 'NUMBER_LEASE' THEN
    RAISE EXCEPTION 'Outbound identity must match whole lease allocation and trusted account'; END IF;
  IF NEW.external_number_id IS NOT NULL THEN
    IF binding.number_id IS DISTINCT FROM NEW.number_id OR binding.external_project_id IS NOT NULL THEN
      RAISE EXCEPTION 'Outbound external identity must match its whole-number binding'; END IF;
  ELSIF NEW.import_batch_id IS NULL OR NEW.provider IS DISTINCT FROM 'demo' OR NOT account.historical_only
    OR NOT EXISTS (
      SELECT 1 FROM once_import_entities fact
      WHERE fact.batch_id=NEW.import_batch_id AND fact.entity_type='OutboundMessage' AND fact.target_id=NEW.id
        AND fact.source_payload->'source'->>'provider'='demo'
        AND fact.source_payload->'source'->>'providerAccountId'=''
        AND (fact.source_payload->'source'->>'providerMessageId') IS NOT DISTINCT FROM NEW.provider_message_id
        AND fact.source_payload->'source'->>'status'=NEW.status
    ) THEN
    RAISE EXCEPTION 'Only source-backed local demo history may lack external number identity';
  END IF;
  IF NEW.import_batch_id IS NULL THEN
    IF NEW.provider NOT IN ('pingcode','pingcode-mock') OR account.owner_kind IS DISTINCT FROM 'SELF_SERVICE' OR account.historical_only OR resource.capability IS DISTINCT FROM 'SEND_RECEIVE' THEN
      RAISE EXCEPTION 'New outbound requires its self-service sender capability'; END IF;
  ELSIF NEW.claim_token IS NOT NULL OR (NEW.status NOT IN ('DELIVERED','UNDELIVERABLE','FAILED')
    AND NOT (NEW.provider='demo' AND NEW.status='SENT')) THEN
    RAISE EXCEPTION 'Historical outbound must have a final source outcome without an active claim';
  END IF;
  -- Historical imports preserve original acceptance time; live writers separately verify now() authorization.
  IF NOT(allocation.service_period @> NEW.created_at) THEN RAISE EXCEPTION 'Outbound creation is outside its service period'; END IF;
  RETURN NEW;
END $$;

-- An agent receives its own connection's messages without a customer platform allocation.
-- Real LP self-service still requires its authoritative same-account project.
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
  ELSIF resource.product='SMS_CODE' AND resource.owner_kind='AGENT' AND resource.provider='pingcode' THEN
    IF resource.storefront_id IS DISTINCT FROM 'linepool' OR NEW.external_project_id IS NOT NULL THEN
      RAISE EXCEPTION 'Real agent binding must use its own connection without an inferred project'; END IF;
  ELSIF resource.product='SMS_CODE' THEN
    SELECT * INTO project FROM provider_projects WHERE provider=NEW.provider AND external_project_id=NEW.external_project_id;
    IF project.upstream_account_id IS DISTINCT FROM resource.upstream_account_id THEN RAISE EXCEPTION 'Resource binding requires same-account real project'; END IF;
  ELSE RAISE EXCEPTION 'Unsupported resource product'; END IF;
  RETURN NEW;
END $$;
