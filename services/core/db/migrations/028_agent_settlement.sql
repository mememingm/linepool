-- Distribution settlement. 027 is reserved for the independent customer redesign.
-- Preserve the complete old price row, including legacy plan/priority, before normalising.
ALTER TABLE price_rules ADD COLUMN seller_type text NOT NULL DEFAULT 'PLATFORM',
  ADD COLUMN legacy_source jsonb, ADD COLUMN legacy_archived boolean NOT NULL DEFAULT false;
UPDATE price_rules SET legacy_source=to_jsonb(price_rules);
DROP INDEX IF EXISTS price_rules_wholesale_unique;
DROP INDEX IF EXISTS price_rules_retail_unique_v2;
DROP INDEX IF EXISTS price_rules_lookup;
DROP INDEX IF EXISTS price_rules_seller_lookup;
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='price_rules'::regclass AND contype='c' LOOP
    EXECUTE format('ALTER TABLE price_rules DROP CONSTRAINT %I',c.conname);
  END LOOP;
END $$;
-- An explicit child buyer identifies a legacy agent settlement rule. Legacy agent retail
-- ownership is already unambiguous. Untargeted wholesale rows used agent_id as the
-- platform's buyer; retain their original row in legacy_source for operator inspection.
UPDATE price_rules SET
  seller_type=CASE WHEN seller_agent_id IS NOT NULL OR (pricing_kind='WHOLESALE' AND buyer_agent_id IS NOT NULL) THEN 'AGENT' ELSE 'PLATFORM' END,
  seller_agent_id=CASE WHEN pricing_kind='WHOLESALE' AND buyer_agent_id IS NOT NULL THEN COALESCE(seller_agent_id,agent_id) ELSE seller_agent_id END,
  buyer_agent_id=CASE WHEN pricing_kind='WHOLESALE' AND buyer_agent_id IS NULL AND seller_agent_id IS NULL THEN agent_id ELSE buyer_agent_id END,
  legacy_archived=lower(plan) NOT IN ('p30d','month','monthly','30d'),
  is_active=is_active AND lower(plan) IN ('p30d','month','monthly','30d'),
  agent_id=NULL,plan='P30D',priority=0;
-- Keep duplicate legacy plans as disabled archive rows, never silently charge an old
-- weekly/yearly rule as a monthly price. New rules use the most recent matching row.
WITH ranked AS (
 SELECT id,row_number() OVER (PARTITION BY pricing_kind,seller_type,seller_agent_id,buyer_agent_id,region_id,service ORDER BY legacy_archived,created_at DESC,id DESC) AS position
 FROM price_rules
) UPDATE price_rules p SET legacy_archived=true,is_active=false FROM ranked r WHERE p.id=r.id AND r.position>1;
ALTER TABLE price_rules ADD CONSTRAINT price_rules_settlement_shape CHECK (
 seller_type IN ('PLATFORM','AGENT') AND pricing_kind IN ('WHOLESALE','RETAIL') AND plan='P30D'
 AND ((seller_type='PLATFORM' AND seller_agent_id IS NULL) OR (seller_type='AGENT' AND seller_agent_id IS NOT NULL))
 AND (pricing_kind<>'RETAIL' OR buyer_agent_id IS NULL)),
 ADD CONSTRAINT price_rules_amount_nonnegative CHECK(unit_amount_minor>=0 AND unit_amount_minor<=9007199254740991),
 ADD CONSTRAINT price_rules_currency_shape CHECK(currency ~ '^[A-Z]{3}$');
CREATE UNIQUE INDEX price_rules_settlement_unique ON price_rules(pricing_kind,seller_type,
 COALESCE(seller_agent_id,'00000000-0000-0000-0000-000000000000'::uuid),
 COALESCE(buyer_agent_id,'00000000-0000-0000-0000-000000000000'::uuid),COALESCE(region_id,''),service) WHERE NOT legacy_archived;
CREATE INDEX price_rules_settlement_lookup ON price_rules(seller_type,seller_agent_id,pricing_kind,service) WHERE is_active AND NOT legacy_archived;
ALTER TABLE tx_orders ADD COLUMN unit_amount_minor bigint CHECK(unit_amount_minor>=0),
 ADD COLUMN billed_days integer CHECK(billed_days>0), ADD COLUMN price_rule_id uuid REFERENCES price_rules(id),
 ADD COLUMN book_amount_minor bigint NOT NULL DEFAULT 0 CHECK(book_amount_minor>=0),
 ADD COLUMN cost_minor bigint NOT NULL DEFAULT 0 CHECK(cost_minor>=0);
ALTER TABLE number_holdings ADD COLUMN cost_minor bigint NOT NULL DEFAULT 0 CHECK(cost_minor>=0);
-- One immutable snapshot per number also supports mixed-price, mixed-duration batches.
CREATE TABLE tx_order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tx_order_id uuid NOT NULL REFERENCES tx_orders(id),
 source_holding_id uuid REFERENCES number_holdings(id), holding_id uuid NOT NULL REFERENCES number_holdings(id),
 phone_number text NOT NULL, region_id text NOT NULL, service text NOT NULL,
 starts_at timestamptz NOT NULL, expires_at timestamptz NOT NULL CHECK(expires_at>starts_at),
 unit_amount_minor bigint CHECK(unit_amount_minor>=0), billed_days integer NOT NULL CHECK(billed_days>0),
 price_rule_id uuid REFERENCES price_rules(id), amount_minor bigint NOT NULL CHECK(amount_minor>=0),
 book_amount_minor bigint NOT NULL CHECK(book_amount_minor>=0), cost_minor bigint NOT NULL CHECK(cost_minor>=0),
 UNIQUE(tx_order_id,holding_id)
);
CREATE INDEX tx_order_items_order ON tx_order_items(tx_order_id,id);
COMMENT ON COLUMN number_holdings.cost_minor IS 'Acquisition amount actually paid by this holder; historical holdings start at zero (not reconstructed).';
