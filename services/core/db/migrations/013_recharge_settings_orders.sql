-- Recharge rules remain unset until an administrator chooses currency, amounts and rate.
CREATE TABLE recharge_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  rules jsonb,
  version integer NOT NULL CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (rules IS NULL OR jsonb_typeof(rules) = 'object')
);

-- Reserved for actual payment orders. Configuration and previews never create orders or credit points.
CREATE TABLE recharge_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  fraction_digits smallint NOT NULL CHECK (fraction_digits BETWEEN 0 AND 6),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  points integer NOT NULL CHECK (points > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUCCEEDED','FAILED','EXPIRED','CANCELLED')),
  payment_method text,
  provider_transaction_id text UNIQUE,
  points_ledger_id uuid UNIQUE REFERENCES point_ledger(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  credited_at timestamptz,
  CHECK ((status = 'SUCCEEDED' AND paid_at IS NOT NULL AND credited_at IS NOT NULL AND points_ledger_id IS NOT NULL)
      OR (status <> 'SUCCEEDED' AND credited_at IS NULL AND points_ledger_id IS NULL))
);
CREATE INDEX recharge_orders_user_created ON recharge_orders(user_id,created_at DESC,id DESC);
CREATE INDEX recharge_orders_status_created ON recharge_orders(status,created_at DESC,id DESC);
