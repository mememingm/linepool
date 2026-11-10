CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  display_name text NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  points_balance integer NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  expiry_notice boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE regions (
  id text PRIMARY KEY CHECK (id IN ('us','gb','ca','sg','de','nl')),
  name text NOT NULL, english text NOT NULL, prefix text NOT NULL, area text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE offers (
  region_id text NOT NULL REFERENCES regions(id),
  service text NOT NULL CHECK (service IN ('Telegram','WhatsApp','Google')),
  plan text NOT NULL CHECK (plan IN ('week','month')),
  name text NOT NULL,
  duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
  unit_points integer NOT NULL CHECK (unit_points BETWEEN 1 AND 1000000),
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(region_id, service, plan)
);
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  region_id text NOT NULL,
  service text NOT NULL,
  plan text NOT NULL,
  plan_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  unit_points integer NOT NULL CHECK (unit_points > 0),
  total_points integer NOT NULL CHECK (total_points = unit_points * quantity),
  duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(region_id, service, plan) REFERENCES offers(region_id, service, plan),
  UNIQUE(user_id, idempotency_key),
  UNIQUE(id, user_id),
  UNIQUE(id, user_id, region_id, service)
);
CREATE INDEX orders_user_created ON orders(user_id, created_at DESC, id DESC);
CREATE TABLE phone_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id text NOT NULL REFERENCES regions(id),
  service text NOT NULL CHECK (service IN ('Telegram','WhatsApp','Google')),
  phone_number text NOT NULL UNIQUE CHECK (phone_number LIKE '% DEMO %'),
  assigned_user_id uuid REFERENCES users(id),
  order_id uuid,
  assigned_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(order_id, assigned_user_id, region_id, service) REFERENCES orders(id, user_id, region_id, service),
  CHECK (
    (assigned_user_id IS NULL AND order_id IS NULL AND assigned_at IS NULL AND expires_at IS NULL)
    OR (assigned_user_id IS NOT NULL AND order_id IS NOT NULL AND assigned_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at > assigned_at)
  ),
  UNIQUE(id, assigned_user_id)
);
CREATE INDEX phone_numbers_inventory ON phone_numbers(region_id, service, created_at, id) WHERE assigned_user_id IS NULL;
CREATE INDEX phone_numbers_user ON phone_numbers(assigned_user_id, assigned_at DESC, id DESC);
CREATE TABLE point_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('SEED_CREDIT','ORDER_DEBIT','ADJUSTMENT')),
  delta integer NOT NULL CHECK (delta <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  description text NOT NULL,
  reference_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(reference_id, user_id) REFERENCES orders(id, user_id),
  CHECK (type <> 'ORDER_DEBIT' OR (delta < 0 AND reference_id IS NOT NULL)),
  CHECK (type <> 'SEED_CREDIT' OR delta > 0)
);
CREATE UNIQUE INDEX point_ledger_order ON point_ledger(reference_id) WHERE type = 'ORDER_DEBIT';
CREATE INDEX point_ledger_user ON point_ledger(user_id, sequence DESC);
CREATE TABLE sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  number_id uuid NOT NULL,
  sender text NOT NULL,
  body text NOT NULL,
  verification_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  is_read boolean NOT NULL DEFAULT false,
  FOREIGN KEY(number_id, user_id) REFERENCES phone_numbers(id, assigned_user_id)
);
CREATE INDEX sms_user_received ON sms_messages(user_id, received_at DESC, id DESC);
CREATE INDEX sms_number ON sms_messages(number_id);
