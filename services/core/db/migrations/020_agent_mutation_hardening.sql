-- Non-PC mutation hardening: replay-safe holding releases and transaction recipients.
CREATE TABLE IF NOT EXISTS agent_holding_releases (
  idempotency_key uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  holding_id uuid NOT NULL REFERENCES number_holdings(id),
  stock_id uuid NOT NULL REFERENCES agent_number_stock(id),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_holding_releases_holding ON agent_holding_releases(holding_id, created_at DESC);

ALTER TABLE tx_orders
  ADD CONSTRAINT tx_orders_recipient_required CHECK (
    recipient_type IS NULL
    OR (recipient_type='AGENT' AND recipient_agent_id IS NOT NULL AND recipient_customer_id IS NULL)
    OR (recipient_type='CUSTOMER' AND recipient_customer_id IS NOT NULL AND recipient_agent_id IS NULL)
  );
