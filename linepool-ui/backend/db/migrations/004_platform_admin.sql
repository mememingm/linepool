ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'USER' CHECK (role IN ('USER','ADMIN'));
ALTER TABLE users ADD COLUMN account_status text NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE','DISABLED'));
ALTER TABLE offers DROP CONSTRAINT offers_plan_check;
ALTER TABLE offers ADD CONSTRAINT offers_plan_format CHECK (plan ~ '^[a-z][a-z0-9_-]{0,31}$');
ALTER TABLE offers ADD COLUMN area_prefix text NOT NULL DEFAULT '';
ALTER TABLE offers ADD COLUMN capability text NOT NULL DEFAULT 'RECEIVE' CHECK (capability = 'RECEIVE');
ALTER TABLE offers ADD COLUMN sms_quota integer CHECK (sms_quota BETWEEN 0 AND 1000000);
ALTER TABLE offers ADD COLUMN quota_source text NOT NULL DEFAULT '';
ALTER TABLE offers ADD COLUMN allow_renewal boolean NOT NULL DEFAULT false CHECK (NOT allow_renewal);
ALTER TABLE offers ADD CONSTRAINT offers_quota_source CHECK (sms_quota IS NULL OR length(trim(quota_source)) >= 3);
ALTER TABLE phone_numbers ADD COLUMN capability text NOT NULL DEFAULT 'RECEIVE' CHECK (capability = 'RECEIVE');
ALTER TABLE phone_numbers ADD COLUMN resource_status text NOT NULL DEFAULT 'LOCAL' CHECK (resource_status IN ('LOCAL','ONLINE','OFFLINE','ERROR'));
ALTER TABLE phone_numbers ADD COLUMN sale_enabled boolean NOT NULL DEFAULT true;
-- Manual grants need not fabricate a paid order. Preserve consistent current ownership.
ALTER TABLE phone_numbers DROP CONSTRAINT phone_numbers_check;
ALTER TABLE phone_numbers ADD CONSTRAINT phone_numbers_assignment_check CHECK (
  (assigned_user_id IS NULL AND order_id IS NULL AND assigned_at IS NULL AND expires_at IS NULL)
  OR (assigned_user_id IS NOT NULL AND assigned_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at > assigned_at)
);
-- SMS ownership is immutable; reclaiming a resource must not delete or reassign old messages.
ALTER TABLE sms_messages DROP CONSTRAINT sms_messages_number_id_user_id_fkey;
ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_number_id_fkey FOREIGN KEY(number_id) REFERENCES phone_numbers(id);
CREATE TABLE number_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number_id uuid NOT NULL REFERENCES phone_numbers(id),
  user_id uuid NOT NULL REFERENCES users(id), order_id uuid REFERENCES orders(id),
  assigned_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, released_at timestamptz,
  CHECK (expires_at > assigned_at), CHECK (released_at IS NULL OR released_at >= assigned_at)
);
CREATE UNIQUE INDEX number_allocations_current ON number_allocations(number_id) WHERE released_at IS NULL;
CREATE INDEX number_allocations_user ON number_allocations(user_id,assigned_at DESC);
CREATE INDEX number_allocations_order ON number_allocations(order_id);
INSERT INTO number_allocations(number_id,user_id,order_id,assigned_at,expires_at)
SELECT id,assigned_user_id,order_id,assigned_at,expires_at FROM phone_numbers WHERE assigned_user_id IS NOT NULL;
CREATE FUNCTION record_number_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.assigned_user_id IS NOT NULL AND (
    NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id OR NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
  ) THEN
    UPDATE number_allocations SET released_at=now() WHERE number_id=OLD.id AND released_at IS NULL;
  END IF;
  IF NEW.assigned_user_id IS NOT NULL THEN
    INSERT INTO number_allocations(number_id,user_id,order_id,assigned_at,expires_at)
    VALUES(NEW.id,NEW.assigned_user_id,NEW.order_id,NEW.assigned_at,NEW.expires_at)
    ON CONFLICT(number_id) WHERE released_at IS NULL DO UPDATE SET expires_at=EXCLUDED.expires_at;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER phone_number_allocation AFTER INSERT OR UPDATE OF assigned_user_id,order_id,assigned_at,expires_at
ON phone_numbers FOR EACH ROW EXECUTE FUNCTION record_number_allocation();
ALTER TABLE orders ADD COLUMN product_snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE orders ADD COLUMN fulfillment_status text NOT NULL DEFAULT 'COMPLETED'
CHECK (fulfillment_status IN ('PROCESSING','COMPLETED','FAILED','CANCELLED'));
ALTER TABLE orders ADD COLUMN completed_at timestamptz;
UPDATE orders SET completed_at=created_at,product_snapshot=jsonb_build_object(
  'name',plan_name,'unitPoints',unit_points,'durationDays',duration_days,'smsQuota',NULL,'legacy',true
);
CREATE TABLE admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL, target_id text NOT NULL, reason text NOT NULL,
  before_data jsonb, after_data jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created ON admin_audit(created_at DESC,id DESC);
CREATE TABLE renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), renewal_number text NOT NULL UNIQUE,
  allocation_id uuid NOT NULL REFERENCES number_allocations(id),
  original_expires_at timestamptz NOT NULL, duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
  total_points integer NOT NULL CHECK (total_points > 0),
  payment_status text NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK (payment_status IN ('NOT_CONFIGURED','PENDING','CONFIRMED')),
  execution_status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (execution_status IN ('PENDING_REVIEW','PROCESSING','UNKNOWN','FAILED','COMPLETED')),
  evidence text, effective_at timestamptz, idempotency_key uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (execution_status <> 'COMPLETED' OR (payment_status='CONFIRMED' AND length(trim(evidence))>=3 AND effective_at IS NOT NULL))
);
