-- Before settlement, WHOLESALE agent_id identified either a platform buyer or
-- an agent seller. With neither buyer_agent_id nor seller_agent_id, these two
-- origins cannot be distinguished. Never charge a guessed owner after migration.
-- Keep the complete legacy_source and require an explicit replacement price.
-- Explicit child prices and agent retail prices retain their known ownership.
UPDATE price_rules SET legacy_archived=true,is_active=false
WHERE legacy_source IS NOT NULL
  AND legacy_source->>'pricing_kind'='WHOLESALE'
  AND legacy_source->>'buyer_agent_id' IS NULL
  AND legacy_source->>'seller_agent_id' IS NULL;
