-- LP receiving products, exact reception windows, audited complete-window review and permanent number/platform sale facts.
-- No product prices, code rules or upstream observations are seeded. Existing financial/history rows are retained.
ALTER TABLE offers ADD COLUMN receiving_mode text NOT NULL DEFAULT 'HOSTED',
  ADD COLUMN window_minutes integer, ALTER COLUMN duration_days DROP NOT NULL;
ALTER TABLE offers ADD CONSTRAINT lp_offer_receiving_shape CHECK((
  (receiving_mode='HOSTED' AND duration_days IN (7,30) AND window_minutes IS NULL)
  OR (receiving_mode='ONE_TIME' AND duration_days IS NULL AND window_minutes=15)) IS TRUE) NOT VALID;
ALTER TABLE orders ADD COLUMN receiving_mode text NOT NULL DEFAULT 'HOSTED',
  ADD COLUMN window_minutes integer, ALTER COLUMN duration_days DROP NOT NULL;
ALTER TABLE orders DROP CONSTRAINT orders_product_shape;
ALTER TABLE orders ADD CONSTRAINT orders_product_shape CHECK((
  (product_type='SMS_CODE' AND operation_kind='PURCHASE' AND settlement_type='POINTS'
    AND sales_storefront_id='linepool' AND service IS NOT NULL AND plan IS NOT NULL
    AND ((receiving_mode='HOSTED' AND duration_days IN (7,30) AND window_minutes IS NULL)
      OR (receiving_mode='ONE_TIME' AND duration_days IS NULL AND window_minutes=15 AND quantity=1))
    AND lease_id IS NULL AND lease_plan_id IS NULL AND target_number_id IS NULL)
  OR (product_type='NUMBER_LEASE' AND sales_storefront_id='once' AND quantity=1
    AND service IS NULL AND plan IS NULL AND target_number_id IS NOT NULL AND number_snapshot IS NOT NULL
    AND operation_kind IN ('RENT','RENEW','ADMIN_ASSIGN','ADMIN_EXTEND')
    AND (operation_kind IN ('RENT','ADMIN_ASSIGN') OR lease_id IS NOT NULL)
    AND (lease_plan_id IS NOT NULL OR operation_kind='ADMIN_EXTEND' OR settlement_type='HISTORICAL_NON_POINT')
    AND (settlement_type<>'POINTS' OR (operation_kind IN ('RENT','RENEW') AND quote_version IS NOT NULL
      AND amount_minor IS NOT NULL AND currency IS NOT NULL)) AND duration_days BETWEEN 1 AND 365)) IS TRUE);
CREATE TABLE lp_platform_code_rules (
  platform_id text PRIMARY KEY REFERENCES platforms(id), enabled boolean NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0), rule jsonb NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((jsonb_typeof(rule)='object' AND jsonb_typeof(rule->'senderAllowlist')='array'
    AND jsonb_array_length(rule->'senderAllowlist') BETWEEN 1 AND 20
    AND jsonb_typeof(rule->'bodyPrefix')='string' AND jsonb_typeof(rule->'bodySuffix')='string'
    AND length(trim((rule->>'bodyPrefix')||(rule->>'bodySuffix')))>=3
    AND (rule->>'codeLength')::integer BETWEEN 4 AND 8) IS TRUE)
);
ALTER TABLE number_allocations ADD COLUMN receiving_mode text NOT NULL DEFAULT 'HOSTED',
  ADD COLUMN receiving_status text, ADD COLUMN first_message_id uuid REFERENCES sms_messages(id),
  ADD COLUMN code_rule_snapshot jsonb, ADD COLUMN source_scope jsonb, ADD COLUMN receiving_review_id uuid;
ALTER TABLE number_allocations DROP CONSTRAINT number_allocations_release_reason_check;
ALTER TABLE number_allocations ADD CONSTRAINT number_allocations_release_reason_check
  CHECK(release_reason IN ('MANUAL','EXPIRED','REASSIGNED','RECEIVING_FAILED'));
CREATE TABLE lp_receiving_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), allocation_id uuid NOT NULL UNIQUE REFERENCES number_allocations(id),
  actor_id uuid NOT NULL REFERENCES users(id), source text NOT NULL CHECK(source IN ('EXTERNAL_PC_REVIEW','MOCK_SOURCE_REVIEW')),
  source_reference text NOT NULL CHECK(length(trim(source_reference)) BETWEEN 3 AND 1000),
  reviewed_at timestamptz NOT NULL, scope jsonb NOT NULL, local_evidence_digest text NOT NULL CHECK(local_evidence_digest ~ '^[a-f0-9]{64}$'),
  complete_window_reviewed boolean NOT NULL CHECK(complete_window_reviewed),
  no_valid_code_confirmed boolean NOT NULL CHECK(no_valid_code_confirmed),
  local_evidence jsonb NOT NULL, reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE number_allocations ADD CONSTRAINT lp_receiving_review_fk FOREIGN KEY(receiving_review_id) REFERENCES lp_receiving_reviews(id),
  ADD CONSTRAINT lp_allocation_receiving_shape CHECK((
    (receiving_mode='HOSTED' AND receiving_status IS NULL AND first_message_id IS NULL AND receiving_review_id IS NULL AND code_rule_snapshot IS NULL)
    OR (receiving_mode='ONE_TIME' AND allocation_type='PLATFORM' AND order_id IS NOT NULL
      AND expires_at=assigned_at+interval '15 minutes' AND source_scope IS NOT NULL AND code_rule_snapshot IS NOT NULL
      AND ((receiving_status='WAITING' AND first_message_id IS NULL AND receiving_review_id IS NULL AND released_at IS NULL)
        OR (receiving_status='SUCCESS' AND first_message_id IS NOT NULL AND receiving_review_id IS NULL)
        OR (receiving_status='FAILED' AND first_message_id IS NULL AND receiving_review_id IS NOT NULL
          AND released_at=expires_at AND release_reason='RECEIVING_FAILED')))) IS TRUE);
CREATE UNIQUE INDEX lp_one_time_order_allocation ON number_allocations(order_id) WHERE receiving_mode='ONE_TIME';
CREATE TABLE lp_platform_sales (
  phone_number text NOT NULL CHECK(phone_number ~ '^\+[1-9][0-9]{6,14}$'), platform_id text NOT NULL REFERENCES platforms(id),
  original_allocation_id uuid NOT NULL REFERENCES number_allocations(id), original_order_id uuid REFERENCES orders(id),
  reason text NOT NULL CHECK(reason IN ('HOSTED_DELIVERED','ONE_TIME_SUCCESS','HISTORICAL_HOSTED')),
  source_scope jsonb NOT NULL, sold_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(phone_number,platform_id)
);
CREATE TABLE lp_platform_sale_origins (
  allocation_id uuid PRIMARY KEY REFERENCES number_allocations(id), phone_number text NOT NULL, platform_id text NOT NULL,
  order_id uuid REFERENCES orders(id), source_scope jsonb NOT NULL,
  FOREIGN KEY(phone_number,platform_id) REFERENCES lp_platform_sales(phone_number,platform_id)
);
-- Protect historical self-service hosted origins, including elapsed/reclaimed services. Legacy distribution allocations remain unchanged.
INSERT INTO lp_platform_sales(phone_number,platform_id,original_allocation_id,original_order_id,reason,source_scope,sold_at)
SELECT DISTINCT ON(n.phone_number,a.platform_id) n.phone_number,a.platform_id,a.id,a.order_id,'HISTORICAL_HOSTED',
  jsonb_build_object('provider',u.provider,'connectionId',u.id,'externalNumberId',b.external_number_id,
    'externalProjectId',s.external_project_id,'phoneNumber',n.phone_number,'mappingProvenance','CURRENT_MAPPING_AT_MIGRATION'),a.assigned_at
FROM number_allocations a JOIN phone_numbers n ON n.id=a.number_id JOIN upstream_accounts u ON u.id=n.upstream_account_id
JOIN number_platforms s ON s.number_id=n.id AND s.platform_id=a.platform_id
LEFT JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=s.provider AND b.external_project_id=s.external_project_id
LEFT JOIN orders o ON o.id=a.order_id
WHERE a.allocation_type='PLATFORM' AND u.storefront_id='linepool' AND u.owner_kind='SELF_SERVICE'
  AND a.agent_entitlement_id IS NULL
  AND (a.order_id IS NULL OR (o.product_type='SMS_CODE' AND o.sales_storefront_id='linepool' AND o.fulfillment_status='COMPLETED'))
ORDER BY n.phone_number,a.platform_id,a.assigned_at,a.id;
INSERT INTO lp_platform_sale_origins(allocation_id,phone_number,platform_id,order_id,source_scope)
SELECT a.id,n.phone_number,a.platform_id,a.order_id,jsonb_build_object('provider',u.provider,'connectionId',u.id,
  'externalNumberId',b.external_number_id,'externalProjectId',s.external_project_id,'phoneNumber',n.phone_number,'mappingProvenance','CURRENT_MAPPING_AT_MIGRATION')
FROM number_allocations a JOIN phone_numbers n ON n.id=a.number_id JOIN upstream_accounts u ON u.id=n.upstream_account_id
JOIN number_platforms s ON s.number_id=n.id AND s.platform_id=a.platform_id
LEFT JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=s.provider AND b.external_project_id=s.external_project_id
LEFT JOIN orders o ON o.id=a.order_id
WHERE a.allocation_type='PLATFORM' AND u.storefront_id='linepool' AND u.owner_kind='SELF_SERVICE'
  AND a.agent_entitlement_id IS NULL
  AND (a.order_id IS NULL OR (o.product_type='SMS_CODE' AND o.sales_storefront_id='linepool' AND o.fulfillment_status='COMPLETED'));
CREATE FUNCTION reject_lp_receiving_fact_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'LP sale facts, origins and external receiving reviews are immutable'; END $$;
CREATE TRIGGER lp_sale_immutable BEFORE UPDATE OR DELETE ON lp_platform_sales FOR EACH ROW EXECUTE FUNCTION reject_lp_receiving_fact_mutation();
CREATE TRIGGER lp_sale_origin_immutable BEFORE UPDATE OR DELETE ON lp_platform_sale_origins FOR EACH ROW EXECUTE FUNCTION reject_lp_receiving_fact_mutation();
CREATE TRIGGER lp_review_immutable BEFORE UPDATE OR DELETE ON lp_receiving_reviews FOR EACH ROW EXECUTE FUNCTION reject_lp_receiving_fact_mutation();
CREATE FUNCTION lp_extract_valid_code(snapshot jsonb,sender text,body text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE rule jsonb; prefix text; suffix text; digits integer; code text;
BEGIN
  rule:=snapshot->'rule'; prefix:=rule->>'bodyPrefix'; suffix:=rule->>'bodySuffix'; digits:=(rule->>'codeLength')::integer;
  IF prefix IS NULL OR suffix IS NULL OR digits NOT BETWEEN 4 AND 8
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(rule->'senderAllowlist') allowed WHERE lower(trim(allowed))=lower(trim(sender)))
    OR length(body)<>length(prefix)+digits+length(suffix)
    OR left(body,length(prefix))<>prefix OR right(body,length(suffix))<>suffix THEN RETURN NULL; END IF;
  code:=substring(body FROM length(prefix)+1 FOR digits);
  IF code ~ '^[0-9]+$' THEN RETURN code; END IF;
  RETURN NULL;
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
  SELECT * INTO binding FROM provider_resource_bindings WHERE provider=stock.provider AND number_id=NEW.number_id AND external_project_id=stock.external_project_id;
  IF binding.number_id IS NULL THEN RAISE EXCEPTION 'Platform allocation requires its original trusted number binding'; END IF;
  NEW.source_scope:=jsonb_build_object('provider',stock.provider,'connectionId',resource.upstream_account_id,
    'externalNumberId',binding.external_number_id,'externalProjectId',stock.external_project_id,'phoneNumber',resource.phone_number);
  RETURN NEW;
END $$;
CREATE FUNCTION record_lp_platform_sale() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phone text;
BEGIN
  IF NEW.allocation_type<>'PLATFORM' OR NEW.source_scope IS NULL THEN RETURN NEW; END IF;
  IF (TG_OP='INSERT' AND NEW.receiving_mode='HOSTED') OR
    (TG_OP='UPDATE' AND OLD.receiving_status='WAITING' AND NEW.receiving_status='SUCCESS') THEN
    phone:=NEW.source_scope->>'phoneNumber';
    INSERT INTO lp_platform_sales(phone_number,platform_id,original_allocation_id,original_order_id,reason,source_scope,sold_at)
      VALUES(phone,NEW.platform_id,NEW.id,NEW.order_id,CASE WHEN NEW.receiving_mode='HOSTED' THEN 'HOSTED_DELIVERED' ELSE 'ONE_TIME_SUCCESS' END,NEW.source_scope,now());
    INSERT INTO lp_platform_sale_origins(allocation_id,phone_number,platform_id,order_id,source_scope)
      VALUES(NEW.id,phone,NEW.platform_id,NEW.order_id,NEW.source_scope);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lp_allocation_sale AFTER INSERT OR UPDATE ON number_allocations FOR EACH ROW EXECUTE FUNCTION record_lp_platform_sale();
CREATE FUNCTION guard_lp_allocation_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.allocation_type='PLATFORM' THEN RAISE EXCEPTION 'Platform receiving history cannot be deleted'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER lp_allocation_history BEFORE DELETE ON number_allocations FOR EACH ROW EXECUTE FUNCTION guard_lp_allocation_delete();
CREATE FUNCTION guard_lp_slot_sale() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phone text;
BEGIN
  SELECT phone_number INTO phone FROM phone_numbers WHERE id=NEW.number_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('lp-sale:'||phone||':'||NEW.platform_id,0));
  IF NEW.reserved_order_id IS NOT NULL AND EXISTS(SELECT 1 FROM lp_platform_sales WHERE phone_number=phone AND platform_id=NEW.platform_id) THEN
    RAISE EXCEPTION 'A permanently sold number/platform cannot be reserved'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lp_slot_reservation_guard BEFORE INSERT OR UPDATE ON number_platforms FOR EACH ROW EXECUTE FUNCTION guard_lp_slot_sale();
CREATE FUNCTION guard_lp_receiving_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.product_type='SMS_CODE' AND (NEW.receiving_mode IS DISTINCT FROM OLD.receiving_mode
    OR NEW.window_minutes IS DISTINCT FROM OLD.window_minutes OR NEW.duration_days IS DISTINCT FROM OLD.duration_days
    OR NEW.product_snapshot IS DISTINCT FROM OLD.product_snapshot) THEN RAISE EXCEPTION 'Purchased LP receiving terms are immutable'; END IF;
  IF TG_OP='INSERT' AND NEW.receiving_mode='ONE_TIME' THEN
    IF NOT EXISTS(SELECT 1 FROM lp_platform_code_rules r WHERE r.platform_id=NEW.service AND r.enabled
      AND NEW.product_snapshot->'codeRule'=jsonb_build_object('version',r.version,'rule',r.rule)) THEN
      RAISE EXCEPTION 'One-time purchase requires its configured platform code rule'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lp_order_receiving_guard BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION guard_lp_receiving_order();
CREATE FUNCTION guard_lp_first_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocation number_allocations%ROWTYPE;
BEGIN
  SELECT * INTO allocation FROM number_allocations WHERE id=NEW.allocation_id;
  IF allocation.receiving_mode='ONE_TIME' THEN
    IF TG_OP='INSERT' THEN
      SELECT * INTO allocation FROM number_allocations WHERE id=allocation.id FOR UPDATE;
      IF allocation.receiving_status<>'WAITING' OR allocation.released_at IS NOT NULL
        OR NEW.verification_code IS DISTINCT FROM lp_extract_valid_code(allocation.code_rule_snapshot,NEW.sender,NEW.body)
        OR NEW.verification_code IS NULL THEN RAISE EXCEPTION 'One-time SMS requires the first valid platform code while waiting'; END IF;
      IF EXISTS(SELECT 1 FROM sms_messages WHERE allocation_id=allocation.id) THEN RAISE EXCEPTION 'One-time allocation already has its first message'; END IF;
    ELSIF NEW.body IS DISTINCT FROM OLD.body OR NEW.sender IS DISTINCT FROM OLD.sender OR NEW.verification_code IS DISTINCT FROM OLD.verification_code
      OR NEW.title IS DISTINCT FROM OLD.title THEN RAISE EXCEPTION 'The successful first code is immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lp_first_message_guard BEFORE INSERT OR UPDATE ON sms_messages FOR EACH ROW EXECUTE FUNCTION guard_lp_first_message();
CREATE FUNCTION assert_lp_receiving_allocation(allocation_uuid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a number_allocations%ROWTYPE; o orders%ROWTYPE; r point_reservations%ROWTYPE; review lp_receiving_reviews%ROWTYPE; message sms_messages%ROWTYPE;
BEGIN
  SELECT * INTO a FROM number_allocations WHERE id=allocation_uuid;
  IF NOT FOUND OR a.receiving_mode<>'ONE_TIME' THEN RETURN; END IF;
  SELECT * INTO o FROM orders WHERE id=a.order_id;
  SELECT * INTO r FROM point_reservations WHERE id=o.point_reservation_id;
  IF o.fulfillment_status<>'COMPLETED' OR r.status IS DISTINCT FROM (CASE a.receiving_status WHEN 'WAITING' THEN 'RESERVED' WHEN 'SUCCESS' THEN 'CAPTURED' ELSE 'RELEASED' END) THEN
    RAISE EXCEPTION 'Receiving outcome, delivered order and points settlement must commit atomically'; END IF;
  IF a.receiving_status='SUCCESS' THEN
    SELECT * INTO message FROM sms_messages WHERE id=a.first_message_id;
    IF message.allocation_id IS DISTINCT FROM a.id OR message.verification_code IS NULL
      OR message.verification_code IS DISTINCT FROM lp_extract_valid_code(a.code_rule_snapshot,message.sender,message.body)
      OR NOT EXISTS(SELECT 1 FROM provider_message_receipts c WHERE c.message_id=message.id AND c.allocation_id=a.id
        AND c.processing_status='IMPORTED' AND c.upstream_account_id::text=a.source_scope->>'connectionId'
        AND c.provider=a.source_scope->>'provider' AND c.external_number_id=a.source_scope->>'externalNumberId'
        AND c.external_project_id=a.source_scope->>'externalProjectId') THEN RAISE EXCEPTION 'Success requires its trusted routed first message'; END IF;
  ELSIF a.receiving_status='FAILED' THEN
    SELECT * INTO review FROM lp_receiving_reviews WHERE id=a.receiving_review_id;
    IF review.allocation_id IS DISTINCT FROM a.id OR review.reviewed_at<a.expires_at OR review.reviewed_at>review.created_at
      OR review.scope->>'windowStart' IS DISTINCT FROM to_char(a.assigned_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      OR review.scope->>'windowEnd' IS DISTINCT FROM to_char(a.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      OR review.scope->>'connectionId' IS DISTINCT FROM a.source_scope->>'connectionId'
      OR review.scope->>'allocationId' IS DISTINCT FROM a.id::text OR review.scope->>'orderId' IS DISTINCT FROM a.order_id::text
      OR review.scope->>'externalNumberId' IS DISTINCT FROM a.source_scope->>'externalNumberId'
      OR review.scope->>'externalProjectId' IS DISTINCT FROM a.source_scope->>'externalProjectId'
      OR review.scope->>'phoneNumber' IS DISTINCT FROM a.source_scope->>'phoneNumber'
      OR review.scope->>'platformId' IS DISTINCT FROM a.platform_id OR review.scope->>'provider' IS DISTINCT FROM a.source_scope->>'provider'
      OR (review.source='MOCK_SOURCE_REVIEW') IS DISTINCT FROM (a.source_scope->>'provider'='pingcode-mock')
      OR EXISTS(SELECT 1 FROM sms_messages WHERE allocation_id=a.id) THEN RAISE EXCEPTION 'Failure requires a matching complete external receiving review and no first message'; END IF;
  ELSIF EXISTS(SELECT 1 FROM sms_messages WHERE allocation_id=a.id) THEN RAISE EXCEPTION 'A valid first message must settle success in the same transaction'; END IF;
END $$;
CREATE FUNCTION guard_lp_receiving_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocation_uuid uuid;
BEGIN
  IF TG_TABLE_NAME='number_allocations' THEN PERFORM assert_lp_receiving_allocation(NEW.id);
  ELSIF TG_TABLE_NAME='sms_messages' THEN PERFORM assert_lp_receiving_allocation(NEW.allocation_id);
  ELSIF TG_TABLE_NAME='orders' THEN
    FOR allocation_uuid IN SELECT id FROM number_allocations WHERE order_id=NEW.id AND receiving_mode='ONE_TIME' LOOP PERFORM assert_lp_receiving_allocation(allocation_uuid); END LOOP;
    IF NEW.receiving_mode='ONE_TIME' AND NEW.fulfillment_status='COMPLETED' AND NOT EXISTS(SELECT 1 FROM number_allocations WHERE order_id=NEW.id AND receiving_mode='ONE_TIME') THEN
      RAISE EXCEPTION 'Delivered one-time order requires its one original receiving allocation'; END IF;
  ELSE
    FOR allocation_uuid IN SELECT a.id FROM number_allocations a JOIN orders o ON o.id=a.order_id WHERE o.point_reservation_id=NEW.id AND a.receiving_mode='ONE_TIME'
      LOOP PERFORM assert_lp_receiving_allocation(allocation_uuid); END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER lp_allocation_settlement AFTER INSERT OR UPDATE ON number_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_lp_receiving_settlement();
CREATE CONSTRAINT TRIGGER lp_order_settlement AFTER INSERT OR UPDATE ON orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_lp_receiving_settlement();
CREATE CONSTRAINT TRIGGER lp_reservation_settlement AFTER UPDATE ON point_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_lp_receiving_settlement();
CREATE CONSTRAINT TRIGGER lp_message_settlement AFTER INSERT OR UPDATE ON sms_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_lp_receiving_settlement();
COMMENT ON TABLE lp_platform_sales IS 'Permanent site-wide phone number + platform exclusion, independent of mutable physical IDs, resource renewal or resynchronization.';
COMMENT ON TABLE lp_receiving_reviews IS 'Explicit externally reviewed full reception window; local empty results and upstream creation checkpoints are not completeness evidence.';

CREATE OR REPLACE VIEW number_platform_inventory AS
SELECT s.id AS id,s.id AS stock_id,d.duration_days,s.number_id,s.platform_id,s.provider,s.external_project_id,
  n.phone_number,n.region_id,n.resource_status,n.resource_expires_at,s.is_available,s.sale_enabled,n.sale_enabled AS resource_sale_enabled,
  s.reserved_order_id,a.id AS allocation_id,a.user_id AS allocated_user_id,a.order_id AS allocation_order_id,a.expires_at AS allocation_expires_at,
  CASE WHEN sold.phone_number IS NOT NULL THEN 'PERMANENTLY_SOLD'
    WHEN a.id IS NOT NULL THEN 'ASSIGNED' WHEN s.reserved_order_id IS NOT NULL THEN 'RESERVED'
    WHEN n.resource_status NOT IN ('LOCAL','ONLINE') OR n.source_missing OR n.resource_expires_at IS NULL
      OR NOT isfinite(n.resource_expires_at) OR n.resource_expires_at<clock_timestamp()+CASE WHEN d.receiving_mode='ONE_TIME' THEN interval '15 minutes' ELSE d.duration_days*interval '24 hours' END THEN 'EXCEPTION'
    WHEN NOT s.is_available OR NOT s.sale_enabled OR NOT n.sale_enabled OR n.manual_hold
      OR NOT COALESCE(p.is_active,false) OR NOT COALESCE(f.is_active,false)
      OR NOT EXISTS(SELECT 1 FROM provider_resource_bindings binding WHERE binding.number_id=n.id
        AND binding.provider=s.provider AND binding.external_project_id=s.external_project_id)
      OR u.storefront_id IS DISTINCT FROM 'linepool' OR u.owner_kind IS DISTINCT FROM 'SELF_SERVICE'
      OR u.historical_only OR u.status IS DISTINCT FROM 'ACTIVE' OR u.auth_status IS DISTINCT FROM 'ACTIVE'
      OR u.access_expires_at IS NULL OR u.access_expires_at<=now() OR NOT ('SMS_CODE'=ANY(u.enabled_capabilities))
      OR EXISTS(SELECT 1 FROM whole_number_reservations r WHERE r.number_id=n.id)
      OR EXISTS(SELECT 1 FROM leases l WHERE l.number_id=n.id AND l.status IN ('ACTIVE','EXPIRED_HELD'))
      OR NOT EXISTS(SELECT 1 FROM offers o WHERE o.region_id=n.region_id AND o.service=s.platform_id AND o.is_active
        AND o.receiving_mode=d.receiving_mode AND o.duration_days IS NOT DISTINCT FROM d.duration_days
        AND o.capability=n.capability AND NOT o.allow_renewal AND starts_with(n.phone_number,o.area_prefix))
      OR (d.receiving_mode='ONE_TIME' AND NOT EXISTS(SELECT 1 FROM lp_platform_code_rules r WHERE r.platform_id=s.platform_id AND r.enabled)) THEN 'OFF_SALE'
    ELSE 'AVAILABLE' END AS sale_status,
  d.receiving_mode,d.window_minutes,a.receiving_status,(sold.phone_number IS NOT NULL) AS permanently_sold
FROM number_platforms s CROSS JOIN (VALUES('HOSTED',7,NULL::integer),('HOSTED',30,NULL::integer),('ONE_TIME',NULL::integer,15)) AS d(receiving_mode,duration_days,window_minutes)
JOIN phone_numbers n ON n.id=s.number_id JOIN upstream_accounts u ON u.id=n.upstream_account_id
LEFT JOIN provider_projects p ON p.provider=s.provider AND p.external_project_id=s.external_project_id AND p.platform_id=s.platform_id AND p.upstream_account_id=u.id
LEFT JOIN platforms f ON f.id=s.platform_id
LEFT JOIN number_allocations a ON a.number_id=s.number_id AND (a.platform_id=s.platform_id OR a.allocation_type='WHOLE_NUMBER') AND a.released_at IS NULL
LEFT JOIN lp_platform_sales sold ON sold.phone_number=n.phone_number AND sold.platform_id=s.platform_id;
COMMENT ON VIEW number_platform_inventory IS 'LP product windows and permanent sale exclusion; expired WAITING reception remains assigned until an explicit complete-window review.';

CREATE FUNCTION lp_receiving_occurrence(payload jsonb) RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN (payload->>'occurredAt')::timestamptz;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  -- Unknown or malformed occurrence remains unresolved evidence; it never proves an empty reception window.
  RETURN NULL;
END $$;
