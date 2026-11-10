-- v4.2 durable inbox/outbox after037; preserve global provider keys and historical raw evidence.
ALTER TABLE sms_messages ADD COLUMN title text NOT NULL DEFAULT '', ADD COLUMN read_at timestamptz,
  ADD COLUMN ingested_at timestamptz;
CREATE INDEX sms_ingested_revision ON sms_messages(user_id,ingested_at,id) WHERE ingested_at IS NOT NULL;
CREATE INDEX sms_read_revision ON sms_messages(user_id,read_at,id) WHERE read_at IS NOT NULL;
ALTER TABLE provider_message_receipts ALTER COLUMN fingerprint DROP NOT NULL,
  ADD COLUMN normalized_payload jsonb, ADD COLUMN ingested_at timestamptz, ADD COLUMN import_batch_id uuid,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN last_error text, DROP CONSTRAINT provider_message_receipts_processing_status_check,
  DROP CONSTRAINT message_receipt_provider;
ALTER TABLE provider_message_receipts ADD CONSTRAINT receipt_processing_status_check
  CHECK(processing_status IN ('PENDING','IMPORTED','UNMATCHED','FAILED','QUARANTINED'));
ALTER TABLE provider_message_receipts ADD CONSTRAINT message_receipt_provider CHECK((
  provider IN ('pingcode','pingcode-mock') OR
  (import_batch_id IS NOT NULL AND processing_status='IMPORTED' AND message_id IS NOT NULL AND allocation_id IS NOT NULL
    AND external_number_id IS NULL AND external_project_id IS NULL
    AND (provider IN ('demo','demo-chat') OR provider ~ '^demo-inbox:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'))
  ) IS TRUE);
CREATE INDEX provider_receipts_retry ON provider_message_receipts(next_attempt_at,received_at)
  WHERE processing_status IN ('PENDING','UNMATCHED','FAILED');

CREATE TABLE outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lease_id uuid NOT NULL REFERENCES leases(id),
  allocation_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id), number_id uuid NOT NULL REFERENCES phone_numbers(id),
  upstream_account_id uuid NOT NULL REFERENCES upstream_accounts(id), provider text NOT NULL,
  external_number_id text, sender_number text NOT NULL, recipient text NOT NULL, content text NOT NULL,
  request_payload jsonb NOT NULL, idempotency_key text NOT NULL, provider_message_id text,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SUBMITTING','QUEUED','SENDING','SENT','UNCERTAIN','DELIVERED','UNDELIVERABLE','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), claim_token uuid, claim_deadline timestamptz,
  last_event_at timestamptz, last_checked_at timestamptz, error_message text, import_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbound_lease_idempotency UNIQUE(lease_id,idempotency_key),
  CONSTRAINT outbound_allocation_identity FOREIGN KEY(allocation_id,number_id,user_id) REFERENCES number_allocations(id,number_id,user_id),
  CONSTRAINT outbound_lease_identity FOREIGN KEY(lease_id,number_id,user_id) REFERENCES leases(id,number_id,user_id),
  CONSTRAINT outbound_binding_identity FOREIGN KEY(provider,external_number_id) REFERENCES provider_resource_bindings(provider,external_number_id),
  CONSTRAINT outbound_account_provider FOREIGN KEY(upstream_account_id,provider) REFERENCES upstream_accounts(id,provider),
  CONSTRAINT outbound_claim_shape CHECK((claim_token IS NULL)=(claim_deadline IS NULL)),
  CONSTRAINT outbound_external_identity CHECK(external_number_id IS NOT NULL OR
    (import_batch_id IS NOT NULL AND provider='demo' AND provider_message_id IS NULL)),
  CONSTRAINT outbound_content_shape CHECK(length(content) BETWEEN 1 AND 4000 AND length(recipient) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX outbound_provider_message ON outbound_messages(provider,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX outbound_lease_created ON outbound_messages(lease_id,created_at DESC,id DESC);
CREATE INDEX outbound_recovery ON outbound_messages(status,claim_deadline,updated_at,id)
  WHERE import_batch_id IS NULL AND status IN ('PENDING','SUBMITTING','QUEUED','SENDING','SENT','UNCERTAIN');
CREATE TABLE mock_sms_operations (
  outbound_id uuid PRIMARY KEY REFERENCES outbound_messages(id), request_payload jsonb NOT NULL,
  scenario text NOT NULL CHECK(scenario IN ('SUCCESS','FAILURE','UNKNOWN_SUCCESS','UNKNOWN_FAILURE')),
  provider_message_id text NOT NULL UNIQUE, status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE provider_event_receipts ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT provider_event_internal_identity UNIQUE(id),
  ADD COLUMN event_kind text NOT NULL DEFAULT 'INBOUND' CHECK(event_kind IN ('INBOUND','OUTBOUND')),
  ADD COLUMN payload jsonb, ADD COLUMN normalized_payload jsonb,
  ADD COLUMN upstream_account_id uuid REFERENCES upstream_accounts(id), ADD COLUMN number_id uuid REFERENCES phone_numbers(id),
  ADD COLUMN outbound_id uuid REFERENCES outbound_messages(id), ADD COLUMN provider_message_id text,
  ADD COLUMN status text NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','IMPORTED','UNMATCHED','FAILED','QUARANTINED','IGNORED')),
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN last_error text, ADD COLUMN created_at timestamptz,
  ADD COLUMN processed_at timestamptz, ADD COLUMN updated_at timestamptz, ADD COLUMN import_batch_id uuid,
  ALTER COLUMN external_message_id DROP NOT NULL;
-- Existing event receipt times are retained; unknown historical processing/update times stay NULL.
UPDATE provider_event_receipts SET created_at=received_at;
ALTER TABLE provider_event_receipts ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN updated_at SET DEFAULT now();
-- Existing received_at is retained. Existing event rows do not claim new processing/ingestion facts.
UPDATE provider_event_receipts e SET upstream_account_id=r.upstream_account_id
  FROM provider_message_receipts r WHERE r.provider=e.provider AND r.external_message_id=e.external_message_id;
ALTER TABLE provider_event_receipts ADD CONSTRAINT provider_event_typed_shape CHECK((
  (event_kind='INBOUND' AND outbound_id IS NULL AND provider_message_id IS NULL
    AND ((external_message_id IS NOT NULL AND status IN ('PENDING','IMPORTED','UNMATCHED','FAILED','QUARANTINED','IGNORED'))
      OR (external_message_id IS NULL AND status IN ('PENDING','UNMATCHED','FAILED','QUARANTINED','IGNORED'))))
  OR (event_kind='OUTBOUND' AND external_message_id IS NULL AND provider_message_id IS NOT NULL)) IS TRUE);
CREATE INDEX provider_events_retry ON provider_event_receipts(next_attempt_at,created_at,id) WHERE status IN ('PENDING','UNMATCHED','FAILED');
CREATE INDEX provider_events_account_created ON provider_event_receipts(upstream_account_id,created_at DESC,id DESC);
CREATE INDEX provider_events_unmatched_outbound ON provider_event_receipts(provider,provider_message_id,created_at,id)
  WHERE event_kind='OUTBOUND' AND outbound_id IS NULL;
CREATE TABLE provider_event_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES provider_event_receipts(id),
  from_status text NOT NULL, to_status text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_event_attempts_history ON provider_event_attempts(event_id,created_at,id);
CREATE TABLE provider_event_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES provider_event_receipts(id),
  payload jsonb NOT NULL, normalized_payload jsonb, reason text NOT NULL,
  status text NOT NULL DEFAULT 'QUARANTINED' CHECK(status='QUARANTINED'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_event_conflicts_history ON provider_event_conflicts(event_id,created_at,id);

CREATE OR REPLACE FUNCTION guard_sms_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate number_allocations%ROWTYPE; candidates bigint; candidate_id uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.number_id IS DISTINCT FROM OLD.number_id
      OR NEW.received_at IS DISTINCT FROM OLD.received_at
      OR (OLD.allocation_id IS NOT NULL AND NEW.allocation_id IS DISTINCT FROM OLD.allocation_id)
      OR (OLD.allocation_id IS NOT NULL AND NEW.platform_id IS DISTINCT FROM OLD.platform_id) THEN
      RAISE EXCEPTION 'SMS historical ownership is immutable'; END IF;
    -- Historical unresolved SMS remain unchanged; read-state updates never invent a service identity.
    IF NEW.allocation_id IS NULL THEN RETURN NEW; END IF;
  ELSIF NEW.allocation_id IS NULL THEN
    SELECT count(*),(array_agg(a.id ORDER BY a.id))[1] INTO candidates,candidate_id FROM number_allocations a
      WHERE a.number_id=NEW.number_id AND a.user_id=NEW.user_id
        AND a.platform_id IS NOT DISTINCT FROM NEW.platform_id AND a.service_period @> NEW.received_at;
    IF candidates<>1 THEN RAISE EXCEPTION 'SMS requires one trusted historical service period'; END IF;
    NEW.allocation_id:=candidate_id;
  END IF;
  SELECT * INTO candidate FROM number_allocations WHERE id=NEW.allocation_id;
  IF candidate.id IS NULL OR candidate.number_id IS DISTINCT FROM NEW.number_id OR candidate.user_id IS DISTINCT FROM NEW.user_id
    OR candidate.platform_id IS DISTINCT FROM NEW.platform_id
    OR (candidate.allocation_type='WHOLE_NUMBER' AND NEW.platform_id IS NOT NULL)
    OR (candidate.allocation_type='PLATFORM' AND NEW.platform_id IS NULL)
    OR NOT(candidate.service_period @> NEW.received_at) THEN RAISE EXCEPTION 'SMS is outside its typed service period'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_receipt_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE message sms_messages%ROWTYPE; allocation number_allocations%ROWTYPE; resource phone_numbers%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.fingerprint IS DISTINCT FROM OLD.fingerprint OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.external_message_id IS DISTINCT FROM OLD.external_message_id OR NEW.upstream_account_id IS DISTINCT FROM OLD.upstream_account_id
    OR NEW.external_number_id IS DISTINCT FROM OLD.external_number_id OR NEW.external_project_id IS DISTINCT FROM OLD.external_project_id
    OR NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id
    OR (OLD.message_id IS NOT NULL AND NEW.message_id IS DISTINCT FROM OLD.message_id)
    OR (OLD.allocation_id IS NOT NULL AND NEW.allocation_id IS DISTINCT FROM OLD.allocation_id)
    OR (OLD.raw_payload IS NOT NULL AND NEW.raw_payload IS DISTINCT FROM OLD.raw_payload)
    OR (OLD.normalized_payload IS NOT NULL AND NEW.normalized_payload IS DISTINCT FROM OLD.normalized_payload)
    OR (OLD.processing_status='IMPORTED' AND NEW.processing_status IS DISTINCT FROM 'IMPORTED')) THEN
    RAISE EXCEPTION 'Provider receipt identity and imported message are immutable'; END IF;
  IF NEW.message_id IS NULL AND NEW.allocation_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO message FROM sms_messages WHERE id=NEW.message_id FOR UPDATE;
  SELECT * INTO allocation FROM number_allocations WHERE id=NEW.allocation_id;
  SELECT * INTO resource FROM phone_numbers WHERE id=allocation.number_id;
  IF allocation.id IS NULL OR message.id IS NULL OR allocation.number_id IS DISTINCT FROM message.number_id
    OR allocation.user_id IS DISTINCT FROM message.user_id OR allocation.platform_id IS DISTINCT FROM message.platform_id
    OR resource.upstream_account_id IS DISTINCT FROM NEW.upstream_account_id
    OR (message.allocation_id IS NOT NULL AND message.allocation_id IS DISTINCT FROM NEW.allocation_id) THEN
    RAISE EXCEPTION 'Receipt allocation conflicts with SMS ownership or account'; END IF;
  IF NEW.provider NOT IN ('pingcode','pingcode-mock') THEN
    --039 supplies the source-registry assertion; local demo history has no upstream binding to invent.
    PERFORM assert_once_local_inbox_receipt(NEW);
  ELSIF NEW.normalized_payload IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM upstream_accounts a WHERE a.id=NEW.upstream_account_id AND a.provider=NEW.provider)
      OR NOT EXISTS(SELECT 1 FROM provider_resource_bindings b WHERE b.provider=NEW.provider
        AND b.external_number_id=NEW.external_number_id AND b.number_id=message.number_id
        AND b.external_project_id IS NOT DISTINCT FROM NEW.external_project_id) THEN
      RAISE EXCEPTION 'Normalized receipt requires matching trusted provider/resource binding'; END IF;
  END IF;
  UPDATE sms_messages SET allocation_id=NEW.allocation_id WHERE id=NEW.message_id AND allocation_id IS NULL;
  NEW.processing_status:='IMPORTED'; NEW.processed_at:=COALESCE(NEW.processed_at,now());
  RETURN NEW;
END $$;

CREATE FUNCTION guard_outbound_message() RETURNS trigger LANGUAGE plpgsql AS $$
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
  ELSIF NEW.import_batch_id IS NULL OR NEW.provider IS DISTINCT FROM 'demo' OR NEW.provider_message_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only source-backed local demo history may lack external number identity';
  END IF;
  IF NEW.import_batch_id IS NULL THEN
    IF NEW.provider IS DISTINCT FROM 'pingcode-mock' OR resource.capability IS DISTINCT FROM 'SEND_RECEIVE' THEN
      RAISE EXCEPTION 'New outbound requires the Mock sender capability'; END IF;
  ELSIF NEW.claim_token IS NOT NULL OR (NEW.status NOT IN ('DELIVERED','UNDELIVERABLE','FAILED')
    AND NOT (NEW.provider='demo' AND NEW.status='SENT' AND NEW.provider_message_id IS NULL)) THEN
    RAISE EXCEPTION 'Historical outbound must have a final source outcome without an active claim';
  END IF;
  -- Historical imports preserve original acceptance time; live writers separately verify now() authorization.
  IF NOT(allocation.service_period @> NEW.created_at) THEN RAISE EXCEPTION 'Outbound creation is outside its service period'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbound_message_guard BEFORE INSERT OR UPDATE ON outbound_messages FOR EACH ROW EXECUTE FUNCTION guard_outbound_message();
CREATE FUNCTION guard_provider_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inbound provider_message_receipts%ROWTYPE; outbound outbound_messages%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.event_id IS DISTINCT FROM OLD.event_id
      OR NEW.event_kind IS DISTINCT FROM OLD.event_kind
      OR (OLD.external_message_id IS NOT NULL AND NEW.external_message_id IS DISTINCT FROM OLD.external_message_id)
      OR NEW.upstream_account_id IS DISTINCT FROM OLD.upstream_account_id
      OR NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id
      OR (OLD.number_id IS NOT NULL AND NEW.number_id IS DISTINCT FROM OLD.number_id)
      OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
      OR (OLD.payload IS NOT NULL AND NEW.payload IS DISTINCT FROM OLD.payload)
      OR (OLD.normalized_payload IS NOT NULL AND NEW.normalized_payload IS DISTINCT FROM OLD.normalized_payload)
      OR (OLD.outbound_id IS NOT NULL AND NEW.outbound_id IS DISTINCT FROM OLD.outbound_id) THEN
      RAISE EXCEPTION 'Provider event identity and payload are immutable'; END IF;
  END IF;
  IF NEW.provider='demo' OR NEW.provider LIKE 'demo-inbox:%' THEN
    PERFORM assert_once_local_inbox_event(NEW);
    RETURN NEW;
  END IF;
  IF NEW.event_kind='INBOUND' AND NEW.external_message_id IS NOT NULL THEN
    SELECT * INTO inbound FROM provider_message_receipts WHERE provider=NEW.provider AND external_message_id=NEW.external_message_id;
    IF NOT FOUND OR inbound.upstream_account_id IS DISTINCT FROM NEW.upstream_account_id THEN
      RAISE EXCEPTION 'Inbound event requires matching trusted receipt and account'; END IF;
    IF NEW.status='IMPORTED' AND inbound.processing_status IS DISTINCT FROM 'IMPORTED' THEN
      RAISE EXCEPTION 'Imported inbound event requires imported receipt'; END IF;
    IF NEW.number_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM provider_resource_bindings b JOIN phone_numbers n ON n.id=b.number_id
      WHERE b.provider=NEW.provider AND b.number_id=NEW.number_id AND n.upstream_account_id=NEW.upstream_account_id
        AND b.external_number_id=NEW.normalized_payload->>'externalNumberId') THEN
      RAISE EXCEPTION 'Inbound event number must match trusted provider binding and account'; END IF;
  ELSIF NEW.event_kind='OUTBOUND' AND NEW.outbound_id IS NOT NULL THEN
    SELECT * INTO outbound FROM outbound_messages WHERE id=NEW.outbound_id;
    IF outbound.provider IS DISTINCT FROM NEW.provider OR outbound.upstream_account_id IS DISTINCT FROM NEW.upstream_account_id
      OR outbound.number_id IS DISTINCT FROM NEW.number_id OR outbound.provider_message_id IS DISTINCT FROM NEW.provider_message_id THEN
      RAISE EXCEPTION 'Outbound event does not match accepted message identity'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_event_identity_guard BEFORE INSERT OR UPDATE ON provider_event_receipts FOR EACH ROW EXECUTE FUNCTION guard_provider_event();
CREATE FUNCTION guard_mock_sms_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.outbound_id IS DISTINCT FROM OLD.outbound_id OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
    OR NEW.scenario IS DISTINCT FROM OLD.scenario OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id THEN
    RAISE EXCEPTION 'Durable Mock acceptance identity is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mock_sms_identity_guard BEFORE UPDATE ON mock_sms_operations FOR EACH ROW EXECUTE FUNCTION guard_mock_sms_identity();
