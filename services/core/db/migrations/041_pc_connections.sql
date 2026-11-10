-- v4.2 PinClode connection ownership and durable local Mock protocol. Forward-only after040.
ALTER TABLE users ADD COLUMN auth_kind text NOT NULL DEFAULT 'LOCAL' CHECK(auth_kind IN ('LOCAL','PINCLODE'));
ALTER TABLE upstream_accounts
  ADD COLUMN owner_kind text NOT NULL DEFAULT 'SELF_SERVICE' CHECK(owner_kind IN ('SELF_SERVICE','AGENT')),
  ADD COLUMN historical_only boolean NOT NULL DEFAULT false,
  ADD COLUMN agent_id uuid REFERENCES agents(id),
  ADD COLUMN application_id text, ADD COLUMN issuer text, ADD COLUMN subject text,
  ADD COLUMN auth_status text NOT NULL DEFAULT 'UNAUTHORIZED'
    CHECK(auth_status IN ('ACTIVE','UNAUTHORIZED','REFRESHING','UNKNOWN','REAUTH_REQUIRED')),
  ADD COLUMN capabilities text[] NOT NULL DEFAULT '{}', ADD COLUMN enabled_capabilities text[] NOT NULL DEFAULT '{}',
  ADD COLUMN access_token text, ADD COLUMN refresh_token text,
  ADD COLUMN access_expires_at timestamptz, ADD COLUMN refresh_expires_at timestamptz,
  ADD COLUMN token_version bigint NOT NULL DEFAULT 0 CHECK(token_version>=0),
  ADD COLUMN refresh_claim_id uuid, ADD COLUMN refresh_claim_deadline timestamptz,
  ADD COLUMN poll_claim_id uuid, ADD COLUMN poll_claim_deadline timestamptz,
  ADD COLUMN poll_version bigint NOT NULL DEFAULT 0 CHECK(poll_version>=0),
  ADD COLUMN message_cursor bigint NOT NULL DEFAULT 0 CHECK(message_cursor>=0),
  ADD COLUMN last_synced_at timestamptz, ADD COLUMN next_poll_at timestamptz,
  ADD COLUMN problem text,
  ADD CONSTRAINT pc_owner_shape CHECK((owner_kind='SELF_SERVICE' AND agent_id IS NULL) OR (owner_kind='AGENT' AND agent_id IS NOT NULL)),
  ADD CONSTRAINT pc_identity_shape CHECK(((application_id IS NULL AND issuer IS NULL AND subject IS NULL)
    OR (length(application_id)>0 AND length(issuer)>0 AND length(subject)>0)) IS TRUE),
  ADD CONSTRAINT pc_capability_shape CHECK(capabilities <@ ARRAY['SMS_CODE','NUMBER_LEASE','SEND_SMS']::text[]
    AND enabled_capabilities <@ capabilities),
  ADD CONSTRAINT pc_refresh_claim_shape CHECK((refresh_claim_id IS NULL)=(refresh_claim_deadline IS NULL)),
  ADD CONSTRAINT pc_poll_claim_shape CHECK((poll_claim_id IS NULL)=(poll_claim_deadline IS NULL));
CREATE UNIQUE INDEX pc_self_service_owner ON upstream_accounts(storefront_id) WHERE owner_kind='SELF_SERVICE' AND NOT historical_only;
CREATE UNIQUE INDEX pc_agent_owner ON upstream_accounts(agent_id) WHERE agent_id IS NOT NULL;
CREATE UNIQUE INDEX pc_account_subject ON upstream_accounts(storefront_id,application_id,issuer,subject) WHERE subject IS NOT NULL;
CREATE INDEX pc_refresh_due ON upstream_accounts(storefront_id,auth_status,access_expires_at);
CREATE INDEX pc_poll_due ON upstream_accounts(storefront_id,next_poll_at) WHERE auth_status='ACTIVE';
CREATE TABLE pc_agent_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id text NOT NULL REFERENCES storefronts(id),
  application_id text NOT NULL, issuer text NOT NULL, subject text NOT NULL,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id), agent_id uuid NOT NULL UNIQUE REFERENCES agents(id),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(site_id,application_id,issuer,subject)
);
CREATE FUNCTION guard_pc_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'PinClode identity is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users u JOIN agents a ON a.user_id=u.id
    WHERE u.id=NEW.user_id AND a.id=NEW.agent_id AND u.auth_kind='PINCLODE' AND u.role='USER') THEN
    RAISE EXCEPTION 'PinClode identity requires its own agent user'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pc_agent_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON pc_agent_identities FOR EACH ROW EXECUTE FUNCTION guard_pc_identity();
CREATE FUNCTION guard_pc_connection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.owner_kind IS DISTINCT FROM OLD.owner_kind OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.external_account_id IS DISTINCT FROM OLD.external_account_id OR NEW.storefront_id IS DISTINCT FROM OLD.storefront_id
    OR NEW.historical_only IS DISTINCT FROM OLD.historical_only
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
CREATE TRIGGER pc_connection_guard BEFORE INSERT OR UPDATE ON upstream_accounts FOR EACH ROW EXECUTE FUNCTION guard_pc_connection();
-- Multiple accounts can have a project for the same platform. Global provider/project keys remain unchanged.
ALTER TABLE provider_projects DROP CONSTRAINT provider_projects_provider_platform_id_key;
ALTER TABLE provider_projects ADD CONSTRAINT pc_project_account_platform UNIQUE(provider,upstream_account_id,platform_id);
ALTER TABLE provider_sync_tasks ADD COLUMN pc_poll_claim_id uuid;
ALTER TABLE phone_numbers ADD COLUMN source_missing boolean NOT NULL DEFAULT false,
  ADD COLUMN pc_capabilities text[] NOT NULL DEFAULT '{}';
CREATE TABLE pc_connection_issues (
  connection_id uuid NOT NULL REFERENCES upstream_accounts(id), number_id uuid NOT NULL REFERENCES phone_numbers(id),
  kind text NOT NULL CHECK(kind IN ('SOURCE_MISSING','SOURCE_UNAVAILABLE','RESOURCE_EXPIRED')),
  first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  PRIMARY KEY(connection_id,number_id,kind)
);
CREATE TABLE pc_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL REFERENCES upstream_accounts(id),
  name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120), duration_days integer NOT NULL CHECK(duration_days BETWEEN 1 AND 3650),
  amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 0 AND 9007199254740991), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  capability text NOT NULL CHECK(capability IN ('SMS_CODE','NUMBER_LEASE','SEND_SMS')), enabled boolean NOT NULL,
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pc_plans_connection ON pc_plans(connection_id,created_at,id);
CREATE TABLE pc_wait_demands (
  connection_id uuid NOT NULL REFERENCES upstream_accounts(id), session_hash char(64) NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  number_id uuid REFERENCES phone_numbers(id), waiting_until timestamptz NOT NULL,
  PRIMARY KEY(connection_id,session_hash)
);
CREATE INDEX pc_wait_expiry ON pc_wait_demands(connection_id,waiting_until);
CREATE TABLE pc_auth_states (
  state_hash text PRIMARY KEY, browser_hash text NOT NULL, site_id text NOT NULL REFERENCES storefronts(id),
  application_id text NOT NULL, issuer text NOT NULL, callback_url text NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('AGENT_LOGIN','REAUTHORIZE','SELF_SERVICE')),
  requested_user_id uuid REFERENCES users(id), expected_connection_id uuid REFERENCES upstream_accounts(id),
  expected_subject text, expected_external_account_id text, expires_at timestamptz NOT NULL,
  consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pc_mock_fixtures (
  site_id text NOT NULL REFERENCES storefronts(id), application_id text NOT NULL, issuer text NOT NULL, fixture_key text NOT NULL,
  subject text NOT NULL, external_account_id text NOT NULL, display_name text NOT NULL,
  application_enabled boolean NOT NULL, owner_kind text NOT NULL CHECK(owner_kind IN ('SELF_SERVICE','AGENT')),
  capabilities text[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(site_id,application_id,issuer,fixture_key), UNIQUE(site_id,application_id,issuer,subject)
);
CREATE TABLE pc_mock_codes (
  code_hash text PRIMARY KEY, state_hash text NOT NULL UNIQUE REFERENCES pc_auth_states(state_hash),
  fixture_key text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE pc_mock_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id text NOT NULL REFERENCES storefronts(id), application_id text NOT NULL,
  issuer text NOT NULL, subject text NOT NULL, external_account_id text NOT NULL,
  access_hash text NOT NULL UNIQUE, refresh_hash text NOT NULL UNIQUE, access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL, refresh_consumed_at timestamptz, revoked_at timestamptz,
  parent_grant_id uuid UNIQUE REFERENCES pc_mock_grants(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pc_mock_resources (
  site_id text NOT NULL REFERENCES storefronts(id), application_id text NOT NULL, issuer text NOT NULL, external_account_id text NOT NULL,
  external_number_id text NOT NULL UNIQUE, phone_number text NOT NULL UNIQUE, region_id text NOT NULL REFERENCES regions(id),
  external_project_id text, platform_id text REFERENCES platforms(id), capabilities text[] NOT NULL,
  source_present boolean NOT NULL DEFAULT true, source_available boolean NOT NULL DEFAULT true,
  resource_expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(site_id,application_id,issuer,external_account_id,external_number_id),
  CHECK((external_project_id IS NULL)=(platform_id IS NULL))
);
CREATE TABLE pc_mock_messages (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, external_message_id text NOT NULL UNIQUE,
  external_number_id text NOT NULL REFERENCES pc_mock_resources(external_number_id), sender text NOT NULL, body text NOT NULL,
  occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- The existing receipt is the agent inbox: never manufacture customer allocations or SMS rows.
ALTER TABLE provider_message_receipts ADD COLUMN connection_id uuid REFERENCES upstream_accounts(id),
  ADD COLUMN owner_agent_id uuid REFERENCES agents(id), ADD COLUMN number_id uuid REFERENCES phone_numbers(id),
  ADD COLUMN connection_read_at timestamptz,
  DROP CONSTRAINT receipt_processing_status_check, DROP CONSTRAINT receipt_processing_identity;
ALTER TABLE provider_message_receipts ADD CONSTRAINT receipt_processing_status_check
  CHECK(processing_status IN ('PENDING','IMPORTED','UNMATCHED','FAILED','QUARANTINED','CONNECTION_IMPORTED')),
  ADD CONSTRAINT receipt_processing_identity CHECK((
    (connection_id IS NULL AND owner_agent_id IS NULL AND number_id IS NULL AND connection_read_at IS NULL
      AND ((processing_status='IMPORTED' AND message_id IS NOT NULL AND allocation_id IS NOT NULL)
        OR (processing_status NOT IN ('IMPORTED','CONNECTION_IMPORTED') AND message_id IS NULL AND allocation_id IS NULL)))
    OR (processing_status='CONNECTION_IMPORTED' AND connection_id IS NOT NULL AND owner_agent_id IS NOT NULL
      AND number_id IS NOT NULL AND message_id IS NULL AND allocation_id IS NULL)) IS TRUE);
CREATE INDEX pc_receipt_connection ON provider_message_receipts(connection_id,received_at DESC,external_message_id)
  WHERE processing_status='CONNECTION_IMPORTED';
CREATE OR REPLACE FUNCTION guard_receipt_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE message sms_messages%ROWTYPE; allocation number_allocations%ROWTYPE; resource phone_numbers%ROWTYPE; owner upstream_accounts%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.fingerprint IS DISTINCT FROM OLD.fingerprint OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.external_message_id IS DISTINCT FROM OLD.external_message_id OR NEW.upstream_account_id IS DISTINCT FROM OLD.upstream_account_id
    OR NEW.external_number_id IS DISTINCT FROM OLD.external_number_id OR NEW.external_project_id IS DISTINCT FROM OLD.external_project_id
    OR NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id
    OR NEW.connection_id IS DISTINCT FROM OLD.connection_id OR NEW.owner_agent_id IS DISTINCT FROM OLD.owner_agent_id
    OR NEW.number_id IS DISTINCT FROM OLD.number_id
    OR (OLD.message_id IS NOT NULL AND NEW.message_id IS DISTINCT FROM OLD.message_id)
    OR (OLD.allocation_id IS NOT NULL AND NEW.allocation_id IS DISTINCT FROM OLD.allocation_id)
    OR (OLD.raw_payload IS NOT NULL AND NEW.raw_payload IS DISTINCT FROM OLD.raw_payload)
    OR (OLD.normalized_payload IS NOT NULL AND NEW.normalized_payload IS DISTINCT FROM OLD.normalized_payload)
    OR (OLD.processing_status IN ('IMPORTED','CONNECTION_IMPORTED') AND NEW.processing_status IS DISTINCT FROM OLD.processing_status)
    OR (OLD.connection_read_at IS NOT NULL AND NEW.connection_read_at IS DISTINCT FROM OLD.connection_read_at)) THEN
    RAISE EXCEPTION 'Provider receipt identity and imported message are immutable'; END IF;
  IF NEW.connection_id IS NOT NULL OR NEW.owner_agent_id IS NOT NULL OR NEW.number_id IS NOT NULL
    OR NEW.processing_status='CONNECTION_IMPORTED' OR NEW.connection_read_at IS NOT NULL THEN
    SELECT * INTO owner FROM upstream_accounts WHERE id=NEW.connection_id;
    SELECT * INTO resource FROM phone_numbers WHERE id=NEW.number_id;
    IF NEW.processing_status IS DISTINCT FROM 'CONNECTION_IMPORTED' OR owner.owner_kind IS DISTINCT FROM 'AGENT'
      OR owner.agent_id IS DISTINCT FROM NEW.owner_agent_id OR NEW.owner_agent_id IS NULL
      OR NEW.connection_id IS DISTINCT FROM NEW.upstream_account_id OR resource.upstream_account_id IS DISTINCT FROM NEW.connection_id
      OR NEW.message_id IS NOT NULL OR NEW.allocation_id IS NOT NULL OR NEW.normalized_payload IS NULL
      OR owner.provider IS DISTINCT FROM NEW.provider
      OR NEW.normalized_payload->>'connectionId' IS DISTINCT FROM NEW.connection_id::text
      OR NEW.normalized_payload->>'ownerAgentId' IS DISTINCT FROM NEW.owner_agent_id::text
      OR NEW.normalized_payload->>'upstreamAccountId' IS DISTINCT FROM NEW.connection_id::text
      OR NEW.normalized_payload->>'phoneNumber' IS DISTINCT FROM resource.phone_number
      OR NOT EXISTS(SELECT 1 FROM provider_resource_bindings b WHERE b.provider=NEW.provider
        AND b.external_number_id=NEW.external_number_id AND b.number_id=NEW.number_id
        AND b.external_project_id IS NOT DISTINCT FROM NEW.external_project_id) THEN
      RAISE EXCEPTION 'Connection receipt requires immutable matching agent/account/resource ownership'; END IF;
    NEW.processed_at:=COALESCE(NEW.processed_at,now()); RETURN NEW;
  END IF;
  -- Customer branch retained from038, including strict SMS/allocation and trusted binding checks.
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
    PERFORM assert_once_local_inbox_receipt(NEW);
  ELSIF NEW.normalized_payload IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM upstream_accounts a WHERE a.id=NEW.upstream_account_id AND a.provider=NEW.provider)
      OR NOT EXISTS(SELECT 1 FROM provider_resource_bindings b WHERE b.provider=NEW.provider
        AND b.external_number_id=NEW.external_number_id AND b.number_id=message.number_id
        AND b.external_project_id IS NOT DISTINCT FROM NEW.external_project_id) THEN
      RAISE EXCEPTION 'Normalized receipt requires matching trusted provider/resource binding'; END IF;
  END IF;
  UPDATE sms_messages SET allocation_id=NEW.allocation_id WHERE id=NEW.message_id AND allocation_id IS NULL;
  NEW.processing_status:='IMPORTED'; NEW.processed_at:=COALESCE(NEW.processed_at,now()); RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION guard_provider_event() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF NEW.status='IMPORTED' AND inbound.processing_status NOT IN ('IMPORTED','CONNECTION_IMPORTED') THEN
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
COMMENT ON TABLE pc_mock_fixtures IS 'Local sandbox consent choices: agent-a, agent-b, not-enabled, self-service; seeded by explicit auth action only.';
COMMENT ON TABLE pc_mock_resources IS 'Persisted finite source fixtures: two account-specific US numbers, original resource deadline 90 days, message occurrence fixed on first fixture creation.';
COMMENT ON TABLE pc_mock_grants IS 'Local Mock one-time refresh grants; rotations preserve original seven-day refresh deadline and access expires in one hour.';
