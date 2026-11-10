-- Preserve original message IDs from completed local demo history without inventing a PC binding.
ALTER TABLE outbound_messages DROP CONSTRAINT outbound_external_identity;
ALTER TABLE outbound_messages ADD CONSTRAINT outbound_external_identity CHECK (
  external_number_id IS NOT NULL OR
  (import_batch_id IS NOT NULL AND provider='demo' AND status IN ('SENT','DELIVERED','UNDELIVERABLE','FAILED'))
);
