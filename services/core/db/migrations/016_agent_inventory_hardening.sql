-- Harden the local agent inventory slice without rewriting earlier migrations.
-- This migration makes nullable-owner uniqueness real, preserves inventory provenance,
-- and adds the time window required by wholesale holdings.

ALTER TABLE balance_accounts
  DROP CONSTRAINT IF EXISTS balance_accounts_owner_type_agent_id_customer_id_currency_key;
CREATE UNIQUE INDEX IF NOT EXISTS balance_accounts_agent_currency_unique
  ON balance_accounts(agent_id, currency) WHERE owner_type='AGENT' AND agent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS balance_accounts_customer_currency_unique
  ON balance_accounts(customer_id, currency) WHERE owner_type='CUSTOMER' AND customer_id IS NOT NULL;

ALTER TABLE price_rules
  ADD COLUMN IF NOT EXISTS buyer_agent_id uuid REFERENCES agents(id);
ALTER TABLE price_rules
  DROP CONSTRAINT IF EXISTS price_rules_pricing_kind_agent_id_region_id_service_plan_key;
CREATE UNIQUE INDEX IF NOT EXISTS price_rules_wholesale_unique
  ON price_rules(agent_id, COALESCE(buyer_agent_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(region_id, ''), service, plan)
  WHERE pricing_kind='WHOLESALE' AND agent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS price_rules_retail_unique
  ON price_rules(COALESCE(region_id, ''), service, plan)
  WHERE pricing_kind='RETAIL';
CREATE INDEX IF NOT EXISTS price_rules_lookup
  ON price_rules(pricing_kind, agent_id, buyer_agent_id, region_id, service, plan, priority DESC)
  WHERE is_active;

ALTER TABLE number_holdings
  ADD COLUMN IF NOT EXISTS starts_at timestamptz;
UPDATE number_holdings SET starts_at=acquired_at WHERE starts_at IS NULL;
ALTER TABLE number_holdings ALTER COLUMN starts_at SET NOT NULL;
ALTER TABLE number_holdings
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_holding_id uuid REFERENCES number_holdings(id),
  ADD COLUMN IF NOT EXISTS transferred_at timestamptz;
ALTER TABLE number_holdings
  ADD CONSTRAINT number_holdings_time_window_check CHECK (expires_at IS NULL OR expires_at > starts_at);
CREATE INDEX IF NOT EXISTS number_holdings_expiry ON number_holdings(expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE service_entitlements
  ADD CONSTRAINT service_entitlements_source_order_fk
  FOREIGN KEY (source_tx_order_id) REFERENCES tx_orders(id);
ALTER TABLE number_holdings
  ADD CONSTRAINT number_holdings_source_order_fk
  FOREIGN KEY (source_tx_order_id) REFERENCES tx_orders(id);

DROP INDEX IF EXISTS tx_orders_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS tx_orders_idempotency_global
  ON tx_orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON COLUMN price_rules.buyer_agent_id IS 'Optional child-agent recipient for a seller agent wholesale rule; NULL is the seller default.';
COMMENT ON COLUMN number_holdings.expires_at IS 'Maximum wholesale holding window; child transfers must not exceed this timestamp.';
