CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  points_balance integer NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  country_code char(2) NOT NULL,
  country_name text NOT NULL,
  description text NOT NULL,
  accent_color char(7) NOT NULL CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL,
  unit_points integer NOT NULL CHECK (unit_points > 0),
  duration_days integer NOT NULL CHECK (duration_days > 0),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, name)
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  plan_id uuid NOT NULL REFERENCES plans(id),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  total_points integer NOT NULL CHECK (total_points > 0),
  status text NOT NULL CHECK (status IN ('COMPLETED', 'CANCELLED')),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX orders_user_created_idx ON orders(user_id, created_at DESC);

CREATE TABLE phone_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  phone_number text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('AVAILABLE', 'ASSIGNED', 'EXPIRED')),
  assigned_user_id uuid REFERENCES users(id),
  assigned_order_id uuid REFERENCES orders(id),
  assigned_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    status = 'AVAILABLE'
    OR (assigned_user_id IS NOT NULL AND assigned_order_id IS NOT NULL AND assigned_at IS NOT NULL AND expires_at IS NOT NULL)
  )
);

CREATE INDEX phone_numbers_inventory_idx ON phone_numbers(project_id, status, created_at);
CREATE INDEX phone_numbers_user_idx ON phone_numbers(assigned_user_id, assigned_at DESC);

CREATE TABLE point_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('SEED_CREDIT', 'ORDER_DEBIT', 'ADJUSTMENT')),
  delta integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  description text NOT NULL,
  reference_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX point_ledger_user_created_idx ON point_ledger(user_id, created_at DESC);

CREATE TABLE sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  phone_number_id uuid NOT NULL REFERENCES phone_numbers(id),
  sender text NOT NULL,
  body text NOT NULL,
  verification_code text,
  received_at timestamptz NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sms_messages_user_received_idx ON sms_messages(user_id, received_at DESC);
