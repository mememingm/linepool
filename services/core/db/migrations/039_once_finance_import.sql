-- v4.2 finance/import after037-038; preserve source facts without replaying wallet routines.
CREATE TABLE once_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_name text NOT NULL,
  status text NOT NULL DEFAULT 'IMPORTING' CHECK(status IN ('IMPORTING','COMPLETED')),
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  CONSTRAINT once_import_batch_completion CHECK((status='COMPLETED')=(completed_at IS NOT NULL))
);
CREATE TABLE once_import_entities (
  batch_id uuid NOT NULL REFERENCES once_import_batches(id), source_system text NOT NULL, entity_type text NOT NULL,
  source_id uuid NOT NULL, target_id uuid NOT NULL, source_payload jsonb NOT NULL,
  PRIMARY KEY(source_system,entity_type,source_id)
);
CREATE INDEX once_import_entities_target ON once_import_entities(entity_type,target_id);
ALTER TABLE orders ADD CONSTRAINT orders_import_batch_fk FOREIGN KEY(import_batch_id) REFERENCES once_import_batches(id);
ALTER TABLE outbound_messages ADD CONSTRAINT outbound_import_batch_fk FOREIGN KEY(import_batch_id) REFERENCES once_import_batches(id);
ALTER TABLE provider_message_receipts ADD CONSTRAINT receipt_import_batch_fk FOREIGN KEY(import_batch_id) REFERENCES once_import_batches(id);
ALTER TABLE provider_event_receipts ADD CONSTRAINT event_import_batch_fk FOREIGN KEY(import_batch_id) REFERENCES once_import_batches(id);
ALTER TABLE point_ledger ADD COLUMN import_batch_id uuid REFERENCES once_import_batches(id);
-- Source reservations have no timestamp; only provenance-backed imports may retain unknown time.
ALTER TABLE point_reservations ADD COLUMN import_batch_id uuid REFERENCES once_import_batches(id),
  ALTER COLUMN created_at DROP NOT NULL,
  ADD CONSTRAINT point_reservation_time_source CHECK(created_at IS NOT NULL OR
    (import_batch_id IS NOT NULL AND jsonb_typeof(request_payload)='object'));
CREATE TABLE purchase_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  storefront_id text NOT NULL DEFAULT 'once' REFERENCES storefronts(id), kind text NOT NULL CHECK(kind IN ('RENT','RENEW')),
  number_id uuid REFERENCES phone_numbers(id), lease_id uuid REFERENCES leases(id), number_snapshot text,
  term integer NOT NULL CHECK(term BETWEEN 1 AND 365), quote_version integer NOT NULL CHECK(quote_version>0),
  points_price integer NOT NULL CHECK(points_price>0), request_payload jsonb NOT NULL,
  order_id uuid UNIQUE REFERENCES orders(id), created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  CONSTRAINT purchase_intent_shape CHECK((kind='RENT' AND number_id IS NOT NULL AND lease_id IS NULL AND number_snapshot IS NOT NULL)
    OR (kind='RENEW' AND lease_id IS NOT NULL)),
  CONSTRAINT purchase_intent_expiry CHECK(expires_at>created_at)
);
CREATE INDEX purchase_intents_user_created ON purchase_intents(user_id,created_at DESC,id DESC);
ALTER TABLE recharge_orders ADD COLUMN sales_storefront_id text NOT NULL DEFAULT 'linepool' REFERENCES storefronts(id),
  ADD COLUMN purchase_intent_id uuid REFERENCES purchase_intents(id),
  ALTER COLUMN idempotency_key TYPE text USING idempotency_key::text,
  ADD COLUMN mock_scenario text CHECK(mock_scenario IN ('SUCCESS','FAILURE','UNKNOWN_SUCCESS','UNKNOWN_FAILURE')),
  ADD COLUMN mock_payment_status text, ADD COLUMN mock_provider_transaction_id text,
  ADD COLUMN mock_observed_at timestamptz, ADD COLUMN expires_at timestamptz, ADD COLUMN claim_deadline timestamptz,
  ADD COLUMN claim_token uuid, ADD COLUMN last_checked_at timestamptz, ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  ADD COLUMN last_error text, ADD COLUMN import_batch_id uuid REFERENCES once_import_batches(id), ADD COLUMN source_payload jsonb,
  DROP CONSTRAINT recharge_orders_status_check, DROP CONSTRAINT recharge_orders_check;
-- Import the original credit ID before its ledger row; deferred wallet checks validate the final pair.
ALTER TABLE recharge_orders ALTER CONSTRAINT recharge_orders_points_ledger_id_fkey
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE recharge_orders ADD CONSTRAINT recharge_orders_status_check CHECK(status IN
  ('PENDING','SUCCEEDED','FAILED','EXPIRED','CANCELLED','CHECKING','PAID_UNCREDITED','PAID','REFUNDING','REFUNDED')),
  ADD CONSTRAINT recharge_orders_credit_shape CHECK(
    (status='SUCCEEDED' AND paid_at IS NOT NULL AND credited_at IS NOT NULL AND points_ledger_id IS NOT NULL)
    OR (status IN ('PAID','REFUNDING','REFUNDED') AND import_batch_id IS NOT NULL AND source_payload IS NOT NULL
      AND jsonb_typeof(source_payload)='object' AND paid_at IS NOT NULL
      AND ((credited_at IS NOT NULL AND points_ledger_id IS NOT NULL) OR (credited_at IS NULL AND points_ledger_id IS NULL)))
    OR (status='PAID_UNCREDITED' AND paid_at IS NOT NULL AND credited_at IS NULL AND points_ledger_id IS NULL)
    OR (status IN ('PENDING','FAILED','EXPIRED','CANCELLED','CHECKING') AND credited_at IS NULL AND points_ledger_id IS NULL)),
  ADD CONSTRAINT recharge_claim_shape CHECK((claim_token IS NULL)=(claim_deadline IS NULL));
CREATE UNIQUE INDEX recharge_mock_provider_transaction ON recharge_orders(mock_provider_transaction_id) WHERE mock_provider_transaction_id IS NOT NULL;
CREATE INDEX recharge_recovery ON recharge_orders(status,claim_deadline,created_at,id) WHERE status IN ('PENDING','CHECKING','PAID_UNCREDITED');
ALTER TABLE recharge_settings ADD COLUMN storefront_id text NOT NULL DEFAULT 'linepool' REFERENCES storefronts(id);
ALTER TABLE recharge_settings DROP CONSTRAINT recharge_settings_pkey;
ALTER TABLE recharge_settings ADD CONSTRAINT recharge_settings_pkey PRIMARY KEY(storefront_id);
ALTER TABLE recharge_settings DROP COLUMN id;
-- Preserve the original LinePool exchange/currency/precision/version and unlimited daily policy.
UPDATE recharge_settings SET rules=rules || jsonb_build_object('enabled',true,'dailyMinor',NULL)
  WHERE storefront_id='linepool' AND rules IS NOT NULL;
ALTER TABLE recharge_settings ADD CONSTRAINT recharge_rules_scope_shape CHECK((rules IS NULL OR (
  jsonb_typeof(rules)='object' AND jsonb_typeof(rules->'enabled')='boolean'
  AND rules ? 'dailyMinor' AND ((rules->'dailyMinor')='null'::jsonb OR
    (jsonb_typeof(rules->'dailyMinor')='number' AND (rules->>'dailyMinor')::numeric>0
      AND (rules->>'dailyMinor')::numeric=trunc((rules->>'dailyMinor')::numeric)))
  AND (storefront_id<>'once' OR (rules->'dailyMinor')<>'null'::jsonb))) IS TRUE);
CREATE TABLE once_admin_idempotency (
  actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL, idempotency_key text NOT NULL, target_id text,
  request_payload jsonb NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,action,idempotency_key)
);
CREATE TABLE point_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id), recharge_order_id uuid REFERENCES recharge_orders(id),
  kind text NOT NULL, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')), details jsonb NOT NULL,
  reason text, resolved_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  CONSTRAINT point_exception_resolution CHECK(((status='OPEN' AND resolved_by IS NULL AND resolved_at IS NULL)
    OR (status='RESOLVED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND length(trim(reason))>=2)) IS TRUE)
);
CREATE INDEX point_exceptions_queue ON point_exceptions(status,created_at,id);
CREATE TABLE refund_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  recharge_order_id uuid NOT NULL REFERENCES recharge_orders(id), actor_id uuid REFERENCES users(id), kind text NOT NULL,
  status text NOT NULL CHECK(status IN ('SUCCEEDED','FAILED','REJECTED')), amount_minor bigint NOT NULL CHECK(amount_minor>=0),
  currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), points integer NOT NULL CHECK(points>=0),
  reason text NOT NULL, source_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, completed_at timestamptz
);
CREATE INDEX refund_orders_user_created ON refund_orders(user_id,created_at DESC,id DESC);
ALTER TABLE point_ledger DROP CONSTRAINT point_ledger_type_check, DROP CONSTRAINT point_ledger_nonzero_change,
  DROP CONSTRAINT point_ledger_wallet_shape;
ALTER TABLE point_ledger ADD CONSTRAINT point_ledger_type_check CHECK(type IN (
  'SEED_CREDIT','ORDER_DEBIT','ADJUSTMENT','RECHARGE','ORDER_RESERVE','ORDER_CAPTURE','ORDER_RELEASE','ORDER_REFUND',
  'COMPENSATION','COMPENSATION_REVOKE','REFUND_RESERVE','REFUND_CAPTURE','REFUND_RELEASE','LEGACY_ZERO')),
  ADD CONSTRAINT point_ledger_nonzero_change CHECK(delta<>0 OR frozen_delta<>0 OR (type='LEGACY_ZERO' AND import_batch_id IS NOT NULL)),
  ADD CONSTRAINT point_ledger_wallet_shape CHECK(
    (type IN ('SEED_CREDIT','ORDER_DEBIT','ADJUSTMENT','RECHARGE') AND frozen_delta=0)
    OR (type IN ('ORDER_RESERVE','REFUND_RESERVE') AND delta<0 AND frozen_delta::bigint=-delta::bigint)
    OR (type IN ('ORDER_CAPTURE','REFUND_CAPTURE') AND delta=0 AND frozen_delta<0)
    OR (type IN ('ORDER_RELEASE','REFUND_RELEASE') AND delta>0 AND frozen_delta::bigint=-delta::bigint)
    OR (type IN ('ORDER_REFUND','COMPENSATION') AND delta>0 AND frozen_delta=0)
    OR (type='COMPENSATION_REVOKE' AND delta<0 AND frozen_delta=0)
    OR (type='LEGACY_ZERO' AND delta=0 AND frozen_delta=0 AND import_batch_id IS NOT NULL)),
  ADD CONSTRAINT point_ledger_historical_source CHECK((type NOT IN
    ('COMPENSATION_REVOKE','REFUND_RESERVE','REFUND_CAPTURE','REFUND_RELEASE','LEGACY_ZERO')
    OR (import_batch_id IS NOT NULL AND jsonb_typeof(request_payload)='object' AND reservation_id IS NULL)) IS TRUE),
  ADD CONSTRAINT point_ledger_compensation_actor CHECK((type<>'COMPENSATION' OR import_batch_id IS NOT NULL OR
    (jsonb_typeof(request_payload)='object' AND length(trim(request_payload->>'reason'))>=2
      AND COALESCE(request_payload->>'actorId','')<>'')) IS TRUE);

CREATE OR REPLACE FUNCTION assert_point_recharge_identity(recharge_uuid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE credited record;
BEGIN
  SELECT r.*,l.id AS linked_ledger_id,l.user_id AS ledger_user_id,l.delta AS ledger_delta,l.type AS ledger_type,
    l.frozen_delta AS ledger_frozen_delta INTO credited FROM recharge_orders r
    LEFT JOIN point_ledger l ON l.recharge_order_id=r.id WHERE r.id=recharge_uuid;
  IF NOT FOUND THEN RETURN; END IF;
  IF credited.points_ledger_id IS NOT NULL OR credited.linked_ledger_id IS NOT NULL THEN
    IF credited.status NOT IN ('SUCCEEDED','PAID','REFUNDING','REFUNDED')
      OR credited.points_ledger_id IS DISTINCT FROM credited.linked_ledger_id
      OR credited.ledger_user_id IS DISTINCT FROM credited.user_id OR credited.ledger_delta IS DISTINCT FROM credited.points
      OR credited.ledger_type IS DISTINCT FROM 'RECHARGE' OR credited.ledger_frozen_delta IS DISTINCT FROM 0
      OR credited.paid_at IS NULL OR credited.credited_at IS NULL
      OR (credited.status<>'SUCCEEDED' AND (credited.import_batch_id IS NULL OR credited.source_payload IS NULL)) THEN
      RAISE EXCEPTION 'Recharge order and unique credit ledger must match owner, points, source and identity'; END IF;
  ELSIF credited.status='SUCCEEDED' OR credited.credited_at IS NOT NULL THEN
    RAISE EXCEPTION 'Credited recharge lacks its exact original ledger';
  END IF;
END $$;
CREATE FUNCTION guard_once_recharge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE intent purchase_intents%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.order_number IS DISTINCT FROM OLD.order_number
      OR NEW.sales_storefront_id IS DISTINCT FROM OLD.sales_storefront_id OR NEW.purchase_intent_id IS DISTINCT FROM OLD.purchase_intent_id
      OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.fraction_digits IS DISTINCT FROM OLD.fraction_digits
      OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.points IS DISTINCT FROM OLD.points
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
      OR NEW.payment_method IS DISTINCT FROM OLD.payment_method OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
      OR NEW.conversion_snapshot IS DISTINCT FROM OLD.conversion_snapshot OR NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id
      OR NEW.source_payload IS DISTINCT FROM OLD.source_payload
      OR (OLD.mock_scenario IS NOT NULL AND NEW.mock_scenario IS DISTINCT FROM OLD.mock_scenario)
      OR (OLD.mock_payment_status IS NOT NULL AND NEW.mock_payment_status IS DISTINCT FROM OLD.mock_payment_status)
      OR (OLD.mock_observed_at IS NOT NULL AND NEW.mock_observed_at IS DISTINCT FROM OLD.mock_observed_at)
      OR (OLD.mock_provider_transaction_id IS NOT NULL AND NEW.mock_provider_transaction_id IS DISTINCT FROM OLD.mock_provider_transaction_id)
      OR (OLD.provider_transaction_id IS NOT NULL AND NEW.provider_transaction_id IS DISTINCT FROM OLD.provider_transaction_id)
      OR (OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at)
      OR (OLD.points_ledger_id IS NOT NULL AND NEW.points_ledger_id IS DISTINCT FROM OLD.points_ledger_id) THEN
      RAISE EXCEPTION 'Accepted recharge identity and conversion are immutable'; END IF;
  END IF;
  IF NEW.purchase_intent_id IS NOT NULL THEN
    SELECT * INTO intent FROM purchase_intents WHERE id=NEW.purchase_intent_id;
    IF intent.user_id IS DISTINCT FROM NEW.user_id OR intent.storefront_id IS DISTINCT FROM NEW.sales_storefront_id THEN
      RAISE EXCEPTION 'Recharge purchase intent owner/storefront mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER once_recharge_identity_guard BEFORE INSERT OR UPDATE ON recharge_orders FOR EACH ROW EXECUTE FUNCTION guard_once_recharge();
CREATE FUNCTION guard_purchase_intent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE held leases%ROWTYPE; resource record; purchased orders%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'order_id') IS DISTINCT FROM (to_jsonb(OLD)-'order_id')
    OR (OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id)) THEN
    RAISE EXCEPTION 'Purchase intent selection is immutable and binds only once'; END IF;
  IF NEW.lease_id IS NOT NULL THEN
    SELECT * INTO held FROM leases WHERE id=NEW.lease_id;
    IF held.user_id IS DISTINCT FROM NEW.user_id OR (NEW.number_id IS NOT NULL AND NEW.number_id IS DISTINCT FROM held.number_id) THEN
      RAISE EXCEPTION 'Purchase intent lease owner/number mismatch'; END IF;
  END IF;
  SELECT a.storefront_id,s.product INTO resource FROM phone_numbers n JOIN upstream_accounts a ON a.id=n.upstream_account_id
    JOIN storefronts s ON s.id=a.storefront_id WHERE n.id=COALESCE(NEW.number_id,held.number_id);
  IF NOT FOUND OR resource.storefront_id IS DISTINCT FROM NEW.storefront_id OR resource.product IS DISTINCT FROM 'NUMBER_LEASE' THEN
    RAISE EXCEPTION 'Purchase intent requires matching lease storefront resource'; END IF;
  IF NEW.order_id IS NOT NULL THEN
    SELECT * INTO purchased FROM orders WHERE id=NEW.order_id;
    IF purchased.user_id IS DISTINCT FROM NEW.user_id OR purchased.sales_storefront_id IS DISTINCT FROM NEW.storefront_id
      OR purchased.operation_kind IS DISTINCT FROM NEW.kind OR purchased.target_number_id IS DISTINCT FROM COALESCE(NEW.number_id,held.number_id)
      OR purchased.duration_days IS DISTINCT FROM NEW.term OR purchased.quote_version IS DISTINCT FROM NEW.quote_version THEN
      RAISE EXCEPTION 'Purchase intent bound order mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_intent_identity_guard BEFORE INSERT OR UPDATE ON purchase_intents FOR EACH ROW EXECUTE FUNCTION guard_purchase_intent();
CREATE FUNCTION guard_import_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Imported source mappings and historical refunds are immutable';
END $$;
CREATE TRIGGER once_import_entity_immutable BEFORE UPDATE OR DELETE ON once_import_entities FOR EACH ROW EXECUTE FUNCTION guard_import_fact();
CREATE TRIGGER refund_history_immutable BEFORE UPDATE OR DELETE ON refund_orders FOR EACH ROW EXECUTE FUNCTION guard_import_fact();
CREATE FUNCTION guard_once_admin_idempotency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.action IS DISTINCT FROM OLD.action
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.target_id IS DISTINCT FROM OLD.target_id
    OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
    OR (OLD.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result) THEN
    RAISE EXCEPTION 'Admin idempotency identity and completed result are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER once_admin_idempotency_guard BEFORE UPDATE ON once_admin_idempotency FOR EACH ROW EXECUTE FUNCTION guard_once_admin_idempotency();

-- Historical eligibility exceptions require an active, explicitly identified import transaction.
-- Live writes have no import_batch_id and keep the normal Mock/wallet guards above.
CREATE FUNCTION guard_once_import_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_uuid uuid;
BEGIN
  IF TG_TABLE_NAME='number_allocations' THEN
    SELECT import_batch_id INTO batch_uuid FROM orders WHERE id=NEW.order_id;
  ELSE
    batch_uuid:=NEW.import_batch_id;
  END IF;
  IF batch_uuid IS NOT NULL THEN
    PERFORM 1 FROM once_import_batches WHERE id=batch_uuid AND status='IMPORTING' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Historical facts require an active import batch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_import_reference_guard BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION guard_once_import_reference();
CREATE TRIGGER outbound_import_reference_guard BEFORE INSERT ON outbound_messages
  FOR EACH ROW EXECUTE FUNCTION guard_once_import_reference();
CREATE TRIGGER recharge_import_reference_guard BEFORE INSERT ON recharge_orders
  FOR EACH ROW EXECUTE FUNCTION guard_once_import_reference();
CREATE TRIGGER ledger_import_reference_guard BEFORE INSERT ON point_ledger
  FOR EACH ROW EXECUTE FUNCTION guard_once_import_reference();
CREATE TRIGGER reservation_import_reference_guard BEFORE INSERT ON point_reservations
  FOR EACH ROW EXECUTE FUNCTION guard_once_import_reference();
CREATE TRIGGER allocation_import_reference_guard BEFORE INSERT ON number_allocations
  FOR EACH ROW EXECUTE FUNCTION guard_once_import_reference();
CREATE TRIGGER receipt_import_reference_guard BEFORE INSERT ON provider_message_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_once_import_reference();
CREATE TRIGGER event_import_reference_guard BEFORE INSERT ON provider_event_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_once_import_reference();

-- Legacy EventsService used a local user namespace, not an upstream connection or external number.
-- Immutable import facts prove the original user/lease/number; no provider binding is fabricated.
CREATE FUNCTION assert_once_local_inbox_receipt(receipt provider_message_receipts) RETURNS void LANGUAGE plpgsql AS $$
DECLARE message sms_messages%ROWTYPE; allocation number_allocations%ROWTYPE; resource phone_numbers%ROWTYPE;
BEGIN
  SELECT * INTO message FROM sms_messages WHERE id=receipt.message_id;
  SELECT * INTO allocation FROM number_allocations WHERE id=receipt.allocation_id;
  SELECT * INTO resource FROM phone_numbers WHERE id=message.number_id;
  IF receipt.import_batch_id IS NULL OR receipt.external_number_id IS NOT NULL OR receipt.external_project_id IS NOT NULL
    OR message.id IS NULL OR allocation.id IS NULL OR allocation.allocation_type IS DISTINCT FROM 'WHOLE_NUMBER'
    OR message.allocation_id IS DISTINCT FROM allocation.id OR message.number_id IS DISTINCT FROM allocation.number_id
    OR message.user_id IS DISTINCT FROM allocation.user_id OR resource.upstream_account_id IS DISTINCT FROM receipt.upstream_account_id
    OR NOT (allocation.service_period @> message.received_at)
    OR NOT EXISTS(SELECT 1 FROM upstream_accounts a WHERE a.id=receipt.upstream_account_id AND a.provider='demo' AND a.storefront_id='once')
    OR receipt.normalized_payload->>'kind' IS DISTINCT FROM 'INBOUND'
    OR receipt.normalized_payload->>'provider' IS DISTINCT FROM receipt.provider
    OR receipt.normalized_payload->>'upstreamAccountId' IS DISTINCT FROM receipt.upstream_account_id::text
    OR receipt.normalized_payload->>'externalMessageId' IS DISTINCT FROM receipt.external_message_id
    OR receipt.normalized_payload->>'externalNumberId' IS NOT NULL OR receipt.normalized_payload->>'externalProjectId' IS NOT NULL
    OR receipt.normalized_payload->>'phoneNumber' IS DISTINCT FROM resource.phone_number
    OR receipt.normalized_payload->>'sender' IS DISTINCT FROM message.sender
    OR receipt.normalized_payload->>'title' IS DISTINCT FROM message.title
    OR receipt.normalized_payload->>'content' IS DISTINCT FROM message.body
    OR receipt.normalized_payload->>'code' IS DISTINCT FROM message.verification_code
    OR (receipt.normalized_payload->>'occurredAt')::timestamptz IS DISTINCT FROM message.received_at THEN
    RAISE EXCEPTION 'Historical local inbox receipt requires exact imported SMS, period, payload and demo account';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM once_import_batches batch
    JOIN once_import_entities original_message ON original_message.batch_id=batch.id AND original_message.source_system=batch.source_name
      AND original_message.entity_type='Message' AND original_message.target_id=message.id
    JOIN once_import_entities original_lease ON original_lease.batch_id=batch.id AND original_lease.source_system=batch.source_name
      AND original_lease.entity_type='Lease' AND original_lease.target_id=allocation.lease_id
      AND original_lease.source_id::text=original_message.source_payload->'source'->>'leaseId'
    JOIN once_import_entities original_user ON original_user.batch_id=batch.id AND original_user.source_system=batch.source_name
      AND original_user.entity_type='User' AND original_user.target_id=message.user_id
      AND original_user.source_id::text=original_lease.source_payload->'source'->>'userId'
    JOIN once_import_entities original_number ON original_number.batch_id=batch.id AND original_number.source_system=batch.source_name
      AND original_number.entity_type='PhoneNumber' AND original_number.target_id=resource.id
      AND original_number.source_id::text=original_lease.source_payload->'source'->>'phoneNumberId'
    WHERE batch.id=receipt.import_batch_id
      AND (receipt.provider IN ('demo','demo-chat') OR receipt.provider='demo-inbox:'||original_user.source_id::text)
      AND original_number.source_payload->'source'->>'provider'='demo'
      AND original_message.source_payload->'source'->>'provider'=receipt.provider
      AND original_message.source_payload->'source'->>'providerMessageId'=receipt.external_message_id
      AND original_message.source_payload->'source'->>'sender'=message.sender
      AND original_message.source_payload->'source'->>'title'=message.title
      AND original_message.source_payload->'source'->>'body'=message.body
      AND (original_message.source_payload->'source'->>'code') IS NOT DISTINCT FROM message.verification_code
      AND (original_message.source_payload->'source'->>'receivedAt')::timestamptz=message.received_at
      AND receipt.raw_payload->'source'=original_message.source_payload->'source'
  ) THEN
    RAISE EXCEPTION 'Historical local inbox receipt lacks matching immutable source user/message/lease/number facts';
  END IF;
END $$;

CREATE FUNCTION assert_once_local_inbox_event(event provider_event_receipts) RETURNS void LANGUAGE plpgsql AS $$
DECLARE original jsonb; held leases%ROWTYPE; resource phone_numbers%ROWTYPE; original_user_id uuid;
  receipt provider_message_receipts%ROWTYPE;
BEGIN
  SELECT fact.source_payload->'source' INTO original FROM once_import_entities fact
    JOIN once_import_batches batch ON batch.id=fact.batch_id AND batch.source_name=fact.source_system
    WHERE fact.batch_id=event.import_batch_id AND fact.entity_type='WebhookEvent' AND fact.target_id=event.id;
  IF NOT FOUND OR original->>'provider' IS DISTINCT FROM event.provider OR original->>'eventId' IS DISTINCT FROM event.event_id
    OR original->'payload' IS DISTINCT FROM event.payload OR event.event_kind IS DISTINCT FROM 'INBOUND'
    OR event.provider_message_id IS NOT NULL OR event.outbound_id IS NOT NULL THEN
    RAISE EXCEPTION 'Historical local inbox event requires its exact immutable original event';
  END IF;
  SELECT lease.* INTO held FROM leases lease JOIN once_import_entities fact ON fact.target_id=lease.id
    JOIN once_import_batches batch ON batch.id=fact.batch_id AND batch.source_name=fact.source_system
    JOIN once_import_entities original_number ON original_number.batch_id=fact.batch_id AND original_number.source_system=fact.source_system
      AND original_number.entity_type='PhoneNumber' AND original_number.target_id=lease.number_id
      AND original_number.source_id::text=fact.source_payload->'source'->>'phoneNumberId'
      AND original_number.source_payload->'source'->>'provider'='demo'
    WHERE fact.batch_id=event.import_batch_id AND fact.entity_type='Lease' AND fact.source_id::text=original->>'leaseId';
  IF NOT FOUND THEN RAISE EXCEPTION 'Historical local inbox event lacks its original lease mapping'; END IF;
  SELECT * INTO resource FROM phone_numbers WHERE id=held.number_id;
  SELECT original_user.source_id INTO original_user_id FROM once_import_entities original_user
    JOIN once_import_batches batch ON batch.id=original_user.batch_id AND batch.source_name=original_user.source_system
    JOIN once_import_entities original_lease ON original_lease.batch_id=original_user.batch_id
      AND original_lease.source_system=original_user.source_system AND original_lease.entity_type='Lease'
      AND original_lease.target_id=held.id
      AND original_lease.source_id::text=original->>'leaseId'
      AND original_lease.source_payload->'source'->>'userId'=original_user.source_id::text
    WHERE original_user.batch_id=event.import_batch_id AND original_user.entity_type='User' AND original_user.target_id=held.user_id;
  IF NOT FOUND OR (event.provider<>'demo' AND event.provider IS DISTINCT FROM 'demo-inbox:'||original_user_id::text)
    OR event.number_id IS DISTINCT FROM held.number_id OR resource.upstream_account_id IS DISTINCT FROM event.upstream_account_id
    OR NOT EXISTS(SELECT 1 FROM upstream_accounts a WHERE a.id=event.upstream_account_id AND a.provider='demo' AND a.storefront_id='once')
    OR event.payload->>'leaseId' IS DISTINCT FROM original->>'leaseId'
    OR event.normalized_payload->>'kind' IS DISTINCT FROM 'INBOUND'
    OR event.normalized_payload->>'provider' IS DISTINCT FROM event.provider
    OR event.normalized_payload->>'upstreamAccountId' IS DISTINCT FROM event.upstream_account_id::text
    OR event.normalized_payload->>'externalNumberId' IS NOT NULL OR event.normalized_payload->>'externalProjectId' IS NOT NULL
    OR event.normalized_payload->>'externalMessageId' IS DISTINCT FROM event.payload->>'providerMessageId'
    OR event.normalized_payload->>'phoneNumber' IS DISTINCT FROM resource.phone_number
    OR event.normalized_payload->>'sender' IS DISTINCT FROM event.payload->>'sender'
    OR event.normalized_payload->>'title' IS DISTINCT FROM event.payload->>'title'
    OR event.normalized_payload->>'content' IS DISTINCT FROM event.payload->>'body'
    OR event.normalized_payload->>'code' IS DISTINCT FROM event.payload->>'code'
    OR (event.normalized_payload->>'occurredAt')::timestamptz IS DISTINCT FROM (event.payload->>'receivedAt')::timestamptz THEN
    RAISE EXCEPTION 'Historical local inbox event namespace, payload and physical account must match its source lease';
  END IF;
  IF event.external_message_id IS NOT NULL THEN
    SELECT * INTO receipt FROM provider_message_receipts WHERE provider=event.provider AND external_message_id=event.external_message_id;
    IF NOT FOUND OR receipt.import_batch_id IS DISTINCT FROM event.import_batch_id
      OR receipt.upstream_account_id IS DISTINCT FROM event.upstream_account_id
      OR event.external_message_id IS DISTINCT FROM event.payload->>'providerMessageId'
      OR NOT EXISTS(SELECT 1 FROM sms_messages m JOIN number_allocations a ON a.id=m.allocation_id
        WHERE m.id=receipt.message_id AND m.user_id=held.user_id AND m.number_id=held.number_id AND a.lease_id=held.id) THEN
      RAISE EXCEPTION 'Historical local inbox event receipt must match its actual delivered SMS and source lease';
    END IF;
    IF event.status='IMPORTED' AND (receipt.processing_status IS DISTINCT FROM 'IMPORTED'
      OR receipt.normalized_payload IS DISTINCT FROM event.normalized_payload) THEN
      RAISE EXCEPTION 'Imported local inbox event must match its delivered receipt payload';
    END IF;
  ELSIF event.status='IMPORTED' THEN
    RAISE EXCEPTION 'Imported local inbox event requires its delivered receipt identity';
  END IF;
END $$;
