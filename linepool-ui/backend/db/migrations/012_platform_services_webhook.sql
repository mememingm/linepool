-- LP sells a number + platform service, timed locally. No upstream receive-link records.
-- Existing IDs, orders, balances and immutable SMS owners are retained.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE platforms (
  id text PRIMARY KEY, name text NOT NULL, logo_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platforms(id,name) VALUES ('Telegram','Telegram'),('WhatsApp','WhatsApp'),('Google','Google');
ALTER TABLE offers DROP CONSTRAINT offers_service_check;
ALTER TABLE offers ADD CONSTRAINT offers_platform FOREIGN KEY(service) REFERENCES platforms(id);

CREATE TABLE provider_projects (
  provider text NOT NULL CHECK(provider IN ('pingcode','pingcode-mock')),
  external_project_id text NOT NULL CHECK(length(trim(external_project_id))>0),
  platform_id text NOT NULL REFERENCES platforms(id),
  project_name text NOT NULL, is_active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,external_project_id),
  UNIQUE(provider,external_project_id,platform_id), UNIQUE(provider,platform_id)
);
-- These are explicit local simulation mappings, never real PC IDs.
INSERT INTO provider_projects(provider,external_project_id,platform_id,project_name)
SELECT 'pingcode-mock',id,id,name FROM platforms;

ALTER TABLE phone_numbers ADD COLUMN resource_expires_at timestamptz;
COMMENT ON COLUMN phone_numbers.resource_expires_at IS 'PC physical resource expiry; NULL is unknown, not unlimited for live stock';
COMMENT ON COLUMN phone_numbers.expires_at IS 'Legacy whole-number service expiry snapshot; new service periods live in number_allocations';
COMMENT ON COLUMN phone_numbers.assigned_user_id IS 'Legacy whole-number owner snapshot; not authoritative for platform services';

CREATE TABLE number_platforms (
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  number_id uuid NOT NULL REFERENCES phone_numbers(id),
  platform_id text NOT NULL REFERENCES platforms(id),
  provider text NOT NULL, external_project_id text NOT NULL,
  is_available boolean NOT NULL DEFAULT true,
  sale_enabled boolean NOT NULL DEFAULT true,
  reserved_order_id uuid REFERENCES orders(id),
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(number_id,platform_id),
  FOREIGN KEY(provider,external_project_id,platform_id)
    REFERENCES provider_projects(provider,external_project_id,platform_id)
);
INSERT INTO number_platforms(id,number_id,platform_id,provider,external_project_id,sale_enabled,reserved_order_id)
SELECT id,id,service,'pingcode-mock',service,sale_enabled OR reserved_order_id IS NOT NULL,reserved_order_id FROM phone_numbers;
-- Reservations are now per platform. Preserve old sale flags in slots before clearing the physical gate.
UPDATE phone_numbers SET reserved_order_id=NULL,sale_enabled=true;
CREATE INDEX number_platforms_stock ON number_platforms(platform_id,number_id) WHERE is_available AND sale_enabled;
CREATE INDEX number_platforms_reservations ON number_platforms(reserved_order_id) WHERE reserved_order_id IS NOT NULL;

ALTER TABLE number_allocations ADD COLUMN platform_id text REFERENCES platforms(id);
UPDATE number_allocations a SET platform_id=n.service FROM phone_numbers n WHERE a.number_id=n.id;
-- An order is a stronger historical source than a resource's old default platform.
UPDATE number_allocations a SET platform_id=o.service FROM orders o WHERE o.id=a.order_id;
INSERT INTO number_platforms(number_id,platform_id,provider,external_project_id,is_available,sale_enabled)
SELECT DISTINCT number_id,platform_id,'pingcode-mock',platform_id,false,false FROM number_allocations
ON CONFLICT(number_id,platform_id) DO NOTHING;
ALTER TABLE number_allocations ALTER COLUMN platform_id SET NOT NULL;
ALTER TABLE number_allocations ADD CONSTRAINT allocation_number_platform
  FOREIGN KEY(number_id,platform_id) REFERENCES number_platforms(number_id,platform_id);
ALTER TABLE number_allocations ADD CONSTRAINT allocation_order_owner FOREIGN KEY(order_id,user_id) REFERENCES orders(id,user_id);
ALTER TABLE number_allocations ADD CONSTRAINT allocation_platform_identity UNIQUE(id,number_id,user_id,platform_id);
DROP TRIGGER phone_number_allocation ON phone_numbers;
DROP FUNCTION record_number_allocation();
DROP INDEX number_allocations_current;
CREATE UNIQUE INDEX number_allocations_current ON number_allocations(number_id,platform_id) WHERE released_at IS NULL;
-- Also protects historical intervals, manual backdating and expiry/reassignment races.
ALTER TABLE number_allocations ADD CONSTRAINT allocation_period_no_overlap EXCLUDE USING gist (
  number_id WITH =, platform_id WITH =,
  tstzrange(assigned_at,LEAST(expires_at,COALESCE(released_at,expires_at)),'[)') WITH &&
);
CREATE INDEX allocations_platform_interval ON number_allocations(number_id,platform_id,assigned_at,expires_at);
CREATE INDEX allocations_due ON number_allocations(expires_at,id) WHERE released_at IS NULL;

CREATE FUNCTION guard_platform_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stock number_platforms%ROWTYPE; resource phone_numbers%ROWTYPE; purchased orders%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.number_id<>OLD.number_id OR NEW.platform_id<>OLD.platform_id
    OR NEW.user_id<>OLD.user_id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.assigned_at<>OLD.assigned_at
    OR NEW.expires_at<>OLD.expires_at OR (OLD.released_at IS NOT NULL AND NEW.released_at IS DISTINCT FROM OLD.released_at)) THEN
    RAISE EXCEPTION 'Service ownership and purchased period are immutable';
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT * INTO stock FROM number_platforms WHERE number_id=NEW.number_id AND platform_id=NEW.platform_id FOR UPDATE;
    SELECT * INTO resource FROM phone_numbers WHERE id=NEW.number_id FOR SHARE;
    IF stock.number_id IS NULL OR NOT stock.is_available OR NOT stock.sale_enabled OR NOT resource.sale_enabled
      OR resource.resource_status NOT IN ('LOCAL','ONLINE')
      OR (stock.reserved_order_id IS NOT NULL AND stock.reserved_order_id IS DISTINCT FROM NEW.order_id) THEN
      RAISE EXCEPTION 'Number platform resource is unavailable';
    END IF;
    IF NEW.expires_at-NEW.assigned_at NOT IN (interval '7 days',interval '30 days') THEN
      RAISE EXCEPTION 'Service duration must be 7 or 30 days';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM provider_projects p JOIN platforms f ON f.id=p.platform_id
      WHERE p.provider=stock.provider AND p.external_project_id=stock.external_project_id AND p.platform_id=stock.platform_id
      AND p.is_active AND f.is_active) THEN RAISE EXCEPTION 'Platform project is inactive'; END IF;
    IF stock.provider='pingcode' AND (resource.resource_status<>'ONLINE' OR resource.resource_expires_at IS NULL
      OR resource.resource_expires_at<NEW.expires_at) THEN RAISE EXCEPTION 'Resource expiry does not cover service period'; END IF;
    IF NEW.order_id IS NOT NULL THEN
      SELECT * INTO purchased FROM orders WHERE id=NEW.order_id;
      IF purchased.user_id<>NEW.user_id OR purchased.service<>NEW.platform_id OR purchased.region_id<>resource.region_id
        OR NEW.expires_at<>NEW.assigned_at+purchased.duration_days*interval '1 day' THEN
        RAISE EXCEPTION 'Service does not match purchased order';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_allocation_guard BEFORE INSERT OR UPDATE ON number_allocations
FOR EACH ROW EXECUTE FUNCTION guard_platform_allocation();

ALTER TABLE sms_messages ADD COLUMN platform_id text REFERENCES platforms(id);
-- Do not invoke the old guard while adding platform evidence to historical rows.
UPDATE sms_messages m SET platform_id=a.platform_id FROM number_allocations a WHERE m.allocation_id=a.id;
ALTER TABLE sms_messages ADD CONSTRAINT sms_platform_allocation_identity
  FOREIGN KEY(allocation_id,number_id,user_id,platform_id) REFERENCES number_allocations(id,number_id,user_id,platform_id);
CREATE INDEX sms_user_platform_received ON sms_messages(user_id,platform_id,received_at DESC,id DESC);

CREATE OR REPLACE FUNCTION guard_sms_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate number_allocations%ROWTYPE; candidates bigint; candidate_id uuid;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.user_id<>OLD.user_id OR NEW.number_id<>OLD.number_id OR NEW.received_at<>OLD.received_at
    OR (OLD.allocation_id IS NOT NULL AND NEW.allocation_id IS DISTINCT FROM OLD.allocation_id)
    OR (OLD.platform_id IS NOT NULL AND NEW.platform_id IS DISTINCT FROM OLD.platform_id)) THEN
    RAISE EXCEPTION 'SMS historical ownership is immutable';
  END IF;
  IF NEW.allocation_id IS NULL AND TG_OP='INSERT' THEN
    SELECT count(*),(array_agg(a.id ORDER BY a.id))[1] INTO candidates,candidate_id
    FROM number_allocations a WHERE a.number_id=NEW.number_id AND a.user_id=NEW.user_id
      AND (NEW.platform_id IS NULL OR a.platform_id=NEW.platform_id)
      AND NEW.received_at>=a.assigned_at AND NEW.received_at<LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at));
    IF candidates<>1 THEN RAISE EXCEPTION 'SMS requires one trusted platform service'; END IF;
    NEW.allocation_id:=candidate_id;
  END IF;
  IF NEW.allocation_id IS NOT NULL THEN
    SELECT * INTO candidate FROM number_allocations WHERE id=NEW.allocation_id;
    IF candidate.id IS NULL OR candidate.number_id<>NEW.number_id OR candidate.user_id<>NEW.user_id
      OR (NEW.platform_id IS NOT NULL AND candidate.platform_id<>NEW.platform_id)
      OR NEW.received_at<candidate.assigned_at
      OR NEW.received_at>=LEAST(candidate.expires_at,COALESCE(candidate.released_at,candidate.expires_at)) THEN
      RAISE EXCEPTION 'SMS is outside its platform service period';
    END IF;
    NEW.platform_id:=candidate.platform_id;
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE provider_resource_bindings DROP CONSTRAINT provider_resource_bindings_provider_check;
ALTER TABLE provider_resource_bindings ADD CONSTRAINT resource_binding_provider CHECK(provider IN ('pingcode','pingcode-mock'));
ALTER TABLE provider_message_receipts DROP CONSTRAINT provider_message_receipts_provider_check;
ALTER TABLE provider_message_receipts ADD CONSTRAINT message_receipt_provider CHECK(provider IN ('pingcode','pingcode-mock'));
ALTER TABLE provider_message_receipts ALTER COLUMN message_id DROP NOT NULL;
ALTER TABLE provider_message_receipts ALTER COLUMN allocation_id DROP NOT NULL;
ALTER TABLE provider_message_receipts ADD COLUMN external_project_id text;
ALTER TABLE provider_message_receipts ADD COLUMN external_number_id text;
ALTER TABLE provider_message_receipts ADD COLUMN raw_payload jsonb;
ALTER TABLE provider_message_receipts ADD COLUMN received_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE provider_message_receipts ADD COLUMN processing_status text NOT NULL DEFAULT 'PENDING'
  CHECK(processing_status IN ('PENDING','IMPORTED','UNMATCHED'));
ALTER TABLE provider_message_receipts ADD COLUMN failure_reason text;
ALTER TABLE provider_message_receipts ADD COLUMN processed_at timestamptz;
UPDATE provider_message_receipts SET processing_status='IMPORTED',processed_at=created_at;
ALTER TABLE provider_message_receipts ADD CONSTRAINT receipt_processing_identity CHECK (
  (processing_status='IMPORTED' AND message_id IS NOT NULL AND allocation_id IS NOT NULL)
  OR (processing_status<>'IMPORTED' AND message_id IS NULL AND allocation_id IS NULL)
);
CREATE INDEX provider_receipts_pending ON provider_message_receipts(received_at,external_message_id)
  WHERE processing_status IN ('PENDING','UNMATCHED');
ALTER TABLE provider_event_receipts ADD COLUMN received_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE provider_event_receipts ADD COLUMN delivery_count integer NOT NULL DEFAULT 1 CHECK(delivery_count>0);

CREATE OR REPLACE FUNCTION guard_receipt_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE message sms_messages%ROWTYPE; allocation number_allocations%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.fingerprint<>OLD.fingerprint OR NEW.provider<>OLD.provider
    OR NEW.external_message_id<>OLD.external_message_id
    OR (OLD.message_id IS NOT NULL AND NEW.message_id IS DISTINCT FROM OLD.message_id)
    OR (OLD.allocation_id IS NOT NULL AND NEW.allocation_id IS DISTINCT FROM OLD.allocation_id)
    OR (OLD.raw_payload IS NOT NULL AND NEW.raw_payload IS DISTINCT FROM OLD.raw_payload)) THEN
    RAISE EXCEPTION 'Provider receipt identity is immutable';
  END IF;
  IF NEW.message_id IS NULL AND NEW.allocation_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO message FROM sms_messages WHERE id=NEW.message_id FOR UPDATE;
  SELECT * INTO allocation FROM number_allocations WHERE id=NEW.allocation_id;
  IF allocation.id IS NULL OR message.id IS NULL OR allocation.number_id<>message.number_id
    OR allocation.user_id<>message.user_id OR allocation.platform_id IS DISTINCT FROM message.platform_id
    OR (message.allocation_id IS NOT NULL AND message.allocation_id<>NEW.allocation_id) THEN
    RAISE EXCEPTION 'Receipt allocation conflicts with SMS ownership';
  END IF;
  UPDATE sms_messages SET allocation_id=NEW.allocation_id WHERE id=NEW.message_id AND allocation_id IS NULL;
  NEW.processing_status:='IMPORTED';
  NEW.processed_at:=COALESCE(NEW.processed_at,now());
  RETURN NEW;
END $$;

-- Old whole-number fields remain as migration snapshots, not parallel business writers.
COMMENT ON TABLE number_allocations IS 'LP platform service entitlement: user + order + number + platform + local service period';
COMMENT ON TABLE number_platforms IS 'Number/project stock explicitly supplied to LP; never infer projects from SMS sender';
COMMENT ON TABLE provider_message_receipts IS 'Verified inbound receipt saved before routing; unassigned content is never exposed in user inbox';
