ALTER TABLE number_allocations ADD COLUMN release_reason text
  CHECK (release_reason IN ('MANUAL','EXPIRED','REASSIGNED'));
ALTER TABLE phone_numbers ADD COLUMN reserved_order_id uuid REFERENCES orders(id);
ALTER TABLE phone_numbers ADD CONSTRAINT reservation_without_assignment
  CHECK (reserved_order_id IS NULL OR (assigned_user_id IS NULL AND NOT sale_enabled));
CREATE INDEX phone_numbers_expiry ON phone_numbers(expires_at,id) WHERE assigned_user_id IS NOT NULL;
CREATE INDEX phone_numbers_reservation ON phone_numbers(reserved_order_id) WHERE reserved_order_id IS NOT NULL;

-- phone_numbers remains the only writer of allocation lifecycle. No service inserts history.
CREATE OR REPLACE FUNCTION record_number_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reason text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.assigned_user_id IS NOT NULL AND (
    NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id OR NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
  ) THEN
    reason:=CASE WHEN OLD.expires_at<=now() THEN 'EXPIRED'
      WHEN NEW.assigned_user_id IS NULL THEN 'MANUAL' ELSE 'REASSIGNED' END;
    UPDATE number_allocations SET released_at=GREATEST(assigned_at,LEAST(now(),expires_at)),release_reason=reason
    WHERE number_id=OLD.id AND released_at IS NULL;
  END IF;
  IF NEW.assigned_user_id IS NOT NULL THEN
    INSERT INTO number_allocations(number_id,user_id,order_id,assigned_at,expires_at)
    VALUES(NEW.id,NEW.assigned_user_id,NEW.order_id,NEW.assigned_at,NEW.expires_at)
    ON CONFLICT(number_id) WHERE released_at IS NULL DO UPDATE SET expires_at=EXCLUDED.expires_at;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE number_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id uuid NOT NULL UNIQUE REFERENCES number_allocations(id),
  reason text NOT NULL CHECK (reason='EXPIRED'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- New orders must explicitly finish local delivery before acquiring a completion time.
UPDATE orders SET completed_at=NULL WHERE fulfillment_status<>'COMPLETED';
ALTER TABLE orders ADD CONSTRAINT order_completion_time
  CHECK ((fulfillment_status='COMPLETED')=(completed_at IS NOT NULL)) NOT VALID;
-- Do not invent timestamps for malformed historical COMPLETED orders; report them before validation.

CREATE TABLE mock_fulfillment_operations (
  order_id uuid PRIMARY KEY REFERENCES orders(id),
  source text NOT NULL DEFAULT 'mock' CHECK (source='mock'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','UNCERTAIN','SUCCEEDED','FAILED')),
  request_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  claim_token uuid, claim_until timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  evidence text, updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='PROCESSING' AND claim_token IS NOT NULL AND claim_until IS NOT NULL)
    OR (status<>'PROCESSING' AND claim_token IS NULL AND claim_until IS NULL))
);
CREATE TABLE mock_fulfillment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES mock_fulfillment_operations(order_id),
  from_status text NOT NULL,to_status text NOT NULL,evidence text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One reversal per original debit. Existing ADJUSTMENT keeps its points meaning.
ALTER TABLE point_ledger ADD COLUMN reverses_ledger_id uuid UNIQUE REFERENCES point_ledger(id);
CREATE FUNCTION guard_point_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original point_ledger%ROWTYPE;
BEGIN
  IF NEW.reverses_ledger_id IS NOT NULL THEN
    SELECT * INTO original FROM point_ledger WHERE id=NEW.reverses_ledger_id;
    IF NEW.type<>'ADJUSTMENT' OR original.type IS DISTINCT FROM 'ORDER_DEBIT'
      OR NEW.user_id<>original.user_id OR NEW.reference_id IS DISTINCT FROM original.reference_id
      OR NEW.delta<>-original.delta THEN RAISE EXCEPTION 'Invalid order debit reversal'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER point_reversal_guard BEFORE INSERT OR UPDATE ON point_ledger
FOR EACH ROW EXECUTE FUNCTION guard_point_reversal();
