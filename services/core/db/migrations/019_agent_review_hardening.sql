-- Non-PC hardening from the backend review: agent lifecycle, replay integrity,
-- transaction recipients, agent retail price ownership, and audit visibility.
ALTER TABLE tx_orders
  ADD COLUMN IF NOT EXISTS recipient_type text,
  ADD COLUMN IF NOT EXISTS recipient_agent_id uuid REFERENCES agents(id),
  ADD COLUMN IF NOT EXISTS recipient_customer_id uuid REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS idempotency_actor_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS idempotency_payload jsonb;
ALTER TABLE tx_orders
  DROP CONSTRAINT IF EXISTS tx_orders_recipient_shape;
ALTER TABLE tx_orders
  ADD CONSTRAINT tx_orders_recipient_shape CHECK (
    (recipient_type IS NULL AND recipient_agent_id IS NULL AND recipient_customer_id IS NULL)
    OR (recipient_type='AGENT' AND recipient_agent_id IS NOT NULL AND recipient_customer_id IS NULL)
    OR (recipient_type='CUSTOMER' AND recipient_customer_id IS NOT NULL AND recipient_agent_id IS NULL)
  );
CREATE INDEX IF NOT EXISTS tx_orders_recipient_created
  ON tx_orders(recipient_type, recipient_agent_id, recipient_customer_id, created_at DESC, id DESC);

ALTER TABLE price_rules
  ADD COLUMN IF NOT EXISTS seller_agent_id uuid REFERENCES agents(id);
DROP INDEX IF EXISTS price_rules_retail_unique;
CREATE UNIQUE INDEX IF NOT EXISTS price_rules_retail_unique_v2
  ON price_rules(COALESCE(seller_agent_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(region_id, ''), service, plan)
  WHERE pricing_kind='RETAIL';
CREATE INDEX IF NOT EXISTS price_rules_seller_lookup
  ON price_rules(pricing_kind, seller_agent_id, agent_id, buyer_agent_id, region_id, service, plan, priority DESC)
  WHERE is_active;
