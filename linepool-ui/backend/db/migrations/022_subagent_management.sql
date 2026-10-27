-- Management request identity lives on the agent; no separate business-number table is needed.
ALTER TABLE agents ADD COLUMN idempotency_key uuid;
ALTER TABLE agents ADD COLUMN idempotency_actor_id uuid REFERENCES users(id);
ALTER TABLE agents ADD COLUMN idempotency_payload jsonb;
CREATE UNIQUE INDEX agents_create_idempotency ON agents(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX agents_parent_created ON agents(parent_agent_id, created_at DESC, id DESC);
CREATE INDEX number_holdings_source_holding ON number_holdings(source_holding_id) WHERE source_holding_id IS NOT NULL;
