-- Mutable retry state for unmatched delivery failures. The immutable delivery fact stays in 052.
CREATE TABLE shop_delivery_attempts (
  provider text NOT NULL,
  external_message_id text NOT NULL,
  connection_id uuid NOT NULL REFERENCES upstream_accounts(id),
  number_id uuid NOT NULL REFERENCES phone_numbers(id),
  attempts integer NOT NULL CHECK (attempts >= 1),
  last_error text NOT NULL CHECK (length(last_error) BETWEEN 1 AND 300),
  status text NOT NULL CHECK (status IN ('RETRYING','FAILED')),
  next_attempt_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_message_id),
  FOREIGN KEY (provider, external_message_id) REFERENCES provider_message_receipts(provider, external_message_id)
);
CREATE INDEX shop_delivery_attempts_due ON shop_delivery_attempts(status, next_attempt_at)
  WHERE status = 'RETRYING';

CREATE FUNCTION guard_shop_delivery_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.external_message_id IS DISTINCT FROM OLD.external_message_id
    OR NEW.connection_id IS DISTINCT FROM OLD.connection_id
    OR NEW.number_id IS DISTINCT FROM OLD.number_id
  ) THEN
    RAISE EXCEPTION 'Shop delivery attempt identity is immutable';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.status = 'RETRYING')
    AND EXISTS (SELECT 1 FROM shop_message_deliveries d
      WHERE d.provider = NEW.provider AND d.external_message_id = NEW.external_message_id) THEN
    RAISE EXCEPTION 'A delivered or recorded shop message cannot be retried';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shop_delivery_attempt_guard BEFORE INSERT OR UPDATE OR DELETE ON shop_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_shop_delivery_attempt();
