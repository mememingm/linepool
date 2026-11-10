-- Align the outbound provenance guard with 043 while retaining original local demo IDs/statuses.
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
    IF NEW.provider IS DISTINCT FROM 'pingcode-mock' OR resource.capability IS DISTINCT FROM 'SEND_RECEIVE' THEN
      RAISE EXCEPTION 'New outbound requires the Mock sender capability'; END IF;
  ELSIF NEW.claim_token IS NOT NULL OR (NEW.status NOT IN ('DELIVERED','UNDELIVERABLE','FAILED')
    AND NOT (NEW.provider='demo' AND NEW.status='SENT')) THEN
    RAISE EXCEPTION 'Historical outbound must have a final source outcome without an active claim';
  END IF;
  -- Historical imports preserve original acceptance time; live writers separately verify now() authorization.
  IF NOT(allocation.service_period @> NEW.created_at) THEN RAISE EXCEPTION 'Outbound creation is outside its service period'; END IF;
  RETURN NEW;
END $$;
