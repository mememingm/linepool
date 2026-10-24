-- Agent & inventory slice for LINEPOOL design v1.1 phase 1.
-- Existing users, orders, point_ledger and platform-direct customers remain authoritative and untouched;
-- platform-direct customers are represented as customers with agent_id IS NULL and never require conversion.

CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  parent_agent_id uuid REFERENCES agents(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 10),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','TERMINATED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_agent_id IS NULL OR parent_agent_id <> id)
);
CREATE INDEX agents_parent ON agents(parent_agent_id) WHERE parent_agent_id IS NOT NULL;
COMMENT ON TABLE agents IS 'Distribution agents; parent_agent_id builds the agent hierarchy (level 1 = top level).';

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  agent_id uuid REFERENCES agents(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','TERMINATED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_agent ON customers(agent_id) WHERE agent_id IS NOT NULL;
COMMENT ON TABLE customers IS 'End customers. agent_id NULL means a platform-direct customer; existing users map 1:1 by user_id without data conversion.';

-- One balance account per owner. Currency-scoped; existing points balances in users stay as-is.
CREATE TABLE balance_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('AGENT','CUSTOMER')),
  agent_id uuid REFERENCES agents(id),
  customer_id uuid REFERENCES customers(id),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  balance_minor bigint NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_type='AGENT' AND agent_id IS NOT NULL AND customer_id IS NULL)
      OR (owner_type='CUSTOMER' AND customer_id IS NOT NULL AND agent_id IS NULL)),
  UNIQUE(owner_type, agent_id, customer_id, currency)
);
COMMENT ON TABLE balance_accounts IS 'Per-owner monetary balance; users.points_balance remains the legacy points ledger source.';

-- Numbers held by the agent/customer inventory (distinct from the physical phone_numbers supply pool).
CREATE TABLE number_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('AGENT','CUSTOMER')),
  agent_id uuid REFERENCES agents(id),
  customer_id uuid REFERENCES customers(id),
  region_id text NOT NULL,
  phone_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','RETIRED')),
  source_tx_order_id uuid,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_type='AGENT' AND agent_id IS NOT NULL AND customer_id IS NULL)
      OR (owner_type='CUSTOMER' AND customer_id IS NOT NULL AND agent_id IS NULL))
);
CREATE INDEX number_holdings_owner ON number_holdings(owner_type, agent_id, customer_id, status);
CREATE INDEX number_holdings_region ON number_holdings(region_id, status);
COMMENT ON TABLE number_holdings IS 'Numbers owned/held in the agent & customer inventory, independent of the sale supply pool in phone_numbers.';

-- Timed service entitlements attached to a holding (or owner) per platform service.
CREATE TABLE service_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holding_id uuid NOT NULL REFERENCES number_holdings(id),
  service text NOT NULL,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
  source_tx_order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > starts_at)
);
CREATE INDEX service_entitlements_holding ON service_entitlements(holding_id, status, expires_at);
COMMENT ON TABLE service_entitlements IS 'Per-number platform service windows (e.g. Telegram/WhatsApp receiving) within the inventory.';

-- Wholesale (agent) and retail (customer/platform-direct) pricing rules.
CREATE TABLE price_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_kind text NOT NULL CHECK (pricing_kind IN ('WHOLESALE','RETAIL')),
  agent_id uuid REFERENCES agents(id),
  region_id text,
  service text NOT NULL,
  plan text NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  unit_amount_minor bigint NOT NULL CHECK (unit_amount_minor > 0),
  priority integer NOT NULL DEFAULT 0 CHECK (priority >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pricing_kind <> 'WHOLESALE' OR agent_id IS NOT NULL),
  CHECK (pricing_kind <> 'RETAIL' OR agent_id IS NULL),
  UNIQUE(pricing_kind, agent_id, region_id, service, plan)
);
COMMENT ON COLUMN price_rules.agent_id IS 'WHOLESALE rules are per-agent; agent_id NULL with same region/service/plan acts as the wholesale default at lower priority.';
COMMENT ON TABLE price_rules IS 'Pricing: RETAIL for customers/platform-direct, WHOLESALE per agent (tiered via priority).';

-- Transaction orders across the agent/customer inventory, optionally linked to legacy orders.
CREATE TABLE tx_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('PURCHASE','RENEW','TRANSFER','ADJUSTMENT')),
  buyer_type text NOT NULL CHECK (buyer_type IN ('AGENT','CUSTOMER')),
  buyer_agent_id uuid REFERENCES agents(id),
  buyer_customer_id uuid REFERENCES customers(id),
  seller_type text NOT NULL DEFAULT 'PLATFORM' CHECK (seller_type IN ('PLATFORM','AGENT')),
  seller_agent_id uuid REFERENCES agents(id),
  pricing_kind text NOT NULL CHECK (pricing_kind IN ('WHOLESALE','RETAIL')),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  points integer CHECK (points IS NULL OR points > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','FAILED','CANCELLED')),
  source_order_id uuid REFERENCES orders(id),
  idempotency_key uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((buyer_type='AGENT' AND buyer_agent_id IS NOT NULL AND buyer_customer_id IS NULL)
      OR (buyer_type='CUSTOMER' AND buyer_customer_id IS NOT NULL AND buyer_agent_id IS NULL)),
  CHECK (seller_type <> 'AGENT' OR seller_agent_id IS NOT NULL),
  CHECK ((status='COMPLETED') = (completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX tx_orders_idempotency ON tx_orders(buyer_type, buyer_agent_id, buyer_customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX tx_orders_buyer_created ON tx_orders(buyer_type, buyer_agent_id, buyer_customer_id, created_at DESC, id DESC);
COMMENT ON TABLE tx_orders IS 'Inventory transaction orders; source_order_id links to the legacy direct-sale orders table when applicable.';

-- Monetary ledger for balance accounts (mirrors point_ledger semantics, money-scoped).
CREATE TABLE balance_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  account_id uuid NOT NULL REFERENCES balance_accounts(id),
  type text NOT NULL CHECK (type IN ('TOPUP','ORDER_DEBIT','COMMISSION','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT')),
  delta bigint NOT NULL CHECK (delta <> 0),
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  description text NOT NULL,
  tx_order_id uuid REFERENCES tx_orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (type <> 'ORDER_DEBIT' OR (delta < 0 AND tx_order_id IS NOT NULL)),
  CHECK (type NOT IN ('TOPUP','COMMISSION','TRANSFER_IN') OR delta > 0),
  CHECK (type NOT IN ('TRANSFER_OUT') OR delta < 0)
);
CREATE INDEX balance_ledger_account ON balance_ledger(account_id, sequence DESC);
COMMENT ON TABLE balance_ledger IS 'Append-only monetary ledger per balance account; point_ledger keeps legacy points history.';
