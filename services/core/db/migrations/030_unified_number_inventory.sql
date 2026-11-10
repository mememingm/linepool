-- Unified number x platform inventory. Existing ledgers and holding history are retained.
-- Legacy mock resources stay explicitly pingcode-mock; this migration does not contact PC.
-- Old agent SMS ownership is NOT guessed/backdated: current owners receive from cutover onward.
ALTER TABLE agent_number_stock ADD COLUMN inventory_id uuid REFERENCES number_platforms(id);
ALTER TABLE agent_number_stock ALTER COLUMN import_idempotency_key DROP NOT NULL;
ALTER TABLE agent_number_stock DROP CONSTRAINT agent_number_stock_provider_check;
ALTER TABLE agent_number_stock ADD CONSTRAINT agent_stock_provider CHECK(provider IN ('pingcode','pingcode-mock'));
ALTER TABLE number_holdings ADD COLUMN inventory_id uuid REFERENCES number_platforms(id);
ALTER TABLE service_entitlements ADD COLUMN inventory_id uuid REFERENCES number_platforms(id);
ALTER TABLE number_allocations ADD COLUMN agent_entitlement_id uuid UNIQUE REFERENCES service_entitlements(id);

CREATE TEMP TABLE legacy_agent_resources ON COMMIT DROP AS
SELECT s.phone_number,s.region_id,s.platform_id,s.resource_status,s.resource_expires_at
FROM agent_number_stock s
UNION ALL
SELECT h.phone_number,h.region_id,e.service,'LOCAL',NULL::timestamptz
FROM number_holdings h JOIN service_entitlements e ON e.holding_id=h.id
WHERE NOT EXISTS(SELECT 1 FROM agent_number_stock s WHERE s.phone_number=h.phone_number AND s.platform_id=e.service);

INSERT INTO phone_numbers(region_id,service,phone_number,resource_status,resource_expires_at)
SELECT DISTINCT ON(phone_number) region_id,platform_id,phone_number,resource_status,resource_expires_at
FROM legacy_agent_resources ORDER BY phone_number,platform_id
ON CONFLICT(phone_number) DO NOTHING;
INSERT INTO number_platforms(number_id,platform_id,provider,external_project_id)
SELECT DISTINCT n.id,r.platform_id,'pingcode-mock',p.external_project_id
FROM legacy_agent_resources r JOIN phone_numbers n ON n.phone_number=r.phone_number
JOIN provider_projects p ON p.provider='pingcode-mock' AND p.platform_id=r.platform_id
ON CONFLICT(number_id,platform_id) DO NOTHING;
INSERT INTO provider_resource_bindings(provider,external_number_id,number_id,external_project_id)
SELECT DISTINCT ON(n.id) 'pingcode-mock','legacy-agent:'||n.id,n.id,p.external_project_id
FROM legacy_agent_resources r JOIN phone_numbers n ON n.phone_number=r.phone_number
JOIN number_platforms p ON p.number_id=n.id AND p.platform_id=r.platform_id
WHERE p.provider='pingcode-mock' ORDER BY n.id,p.platform_id
ON CONFLICT(provider,number_id) DO NOTHING;

UPDATE service_entitlements e SET inventory_id=p.id
FROM number_holdings h JOIN phone_numbers n ON n.phone_number=h.phone_number
JOIN number_platforms p ON p.number_id=n.id
WHERE e.holding_id=h.id AND p.platform_id=e.service;
ALTER TABLE service_entitlements ALTER COLUMN inventory_id SET NOT NULL;
UPDATE number_holdings h SET inventory_id=resolved.inventory_id
FROM (
  SELECT holding_id,(array_agg(inventory_id ORDER BY inventory_id))[1] AS inventory_id
  FROM service_entitlements GROUP BY holding_id HAVING count(*)=1
) resolved WHERE resolved.holding_id=h.id;
DROP INDEX number_allocations_current;
CREATE UNIQUE INDEX number_allocations_current_platform ON number_allocations(number_id,platform_id) WHERE released_at IS NULL;
UPDATE agent_number_stock s SET inventory_id=p.id
FROM phone_numbers n JOIN number_platforms p ON p.number_id=n.id
WHERE n.phone_number=s.phone_number AND p.platform_id=s.platform_id;
ALTER TABLE agent_number_stock ALTER COLUMN inventory_id SET NOT NULL;
DROP INDEX agent_number_stock_phone_unique;
CREATE UNIQUE INDEX agent_stock_inventory_unique ON agent_number_stock(inventory_id);
ALTER TABLE number_holdings ALTER COLUMN inventory_id DROP NOT NULL;
DROP INDEX number_holdings_active_phone_unique;
CREATE UNIQUE INDEX number_holdings_current_inventory ON number_holdings(inventory_id)
WHERE status IN ('ACTIVE','SUSPENDED');

-- Reconcile already elapsed grants without deleting history or changing money.
UPDATE number_holdings SET status='RETIRED',transferred_at=COALESCE(transferred_at,expires_at)
WHERE status IN ('ACTIVE','SUSPENDED') AND expires_at<=now();
UPDATE service_entitlements e SET status='EXPIRED'
FROM number_holdings h WHERE h.id=e.holding_id AND e.status='ACTIVE' AND e.expires_at<=now();
UPDATE agent_number_stock s SET status='AVAILABLE',holding_id=NULL
FROM number_holdings h WHERE h.id=s.holding_id AND h.status='RETIRED';

CREATE OR REPLACE FUNCTION guard_platform_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stock number_platforms%ROWTYPE; resource phone_numbers%ROWTYPE; purchased orders%ROWTYPE;
  entitlement service_entitlements%ROWTYPE; holding number_holdings%ROWTYPE; owner_id uuid;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.number_id<>OLD.number_id OR NEW.platform_id<>OLD.platform_id
    OR NEW.user_id<>OLD.user_id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.assigned_at<>OLD.assigned_at
    OR NEW.expires_at<>OLD.expires_at OR NEW.agent_entitlement_id IS DISTINCT FROM OLD.agent_entitlement_id
    OR (OLD.released_at IS NOT NULL AND NEW.released_at IS DISTINCT FROM OLD.released_at)) THEN
    RAISE EXCEPTION 'Service ownership and purchased period are immutable';
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT * INTO stock FROM number_platforms WHERE number_id=NEW.number_id AND platform_id=NEW.platform_id FOR UPDATE;
    SELECT * INTO resource FROM phone_numbers WHERE id=NEW.number_id FOR SHARE;
    IF stock.number_id IS NULL THEN RAISE EXCEPTION 'Number platform resource is unavailable'; END IF;
    IF NEW.agent_entitlement_id IS NOT NULL THEN
      SELECT * INTO entitlement FROM service_entitlements WHERE id=NEW.agent_entitlement_id;
      SELECT * INTO holding FROM number_holdings WHERE id=entitlement.holding_id;
      IF holding.owner_type='AGENT' THEN SELECT user_id INTO owner_id FROM agents WHERE id=holding.agent_id;
      ELSE SELECT user_id INTO owner_id FROM customers WHERE id=holding.customer_id; END IF;
      IF entitlement.id IS NULL OR entitlement.inventory_id<>stock.id OR entitlement.service<>stock.platform_id
        OR owner_id IS DISTINCT FROM NEW.user_id OR NEW.order_id IS NOT NULL
        OR NEW.assigned_at<GREATEST(entitlement.starts_at,holding.starts_at)
        OR NEW.expires_at>LEAST(entitlement.expires_at,COALESCE(holding.expires_at,entitlement.expires_at)) THEN
        RAISE EXCEPTION 'Agent allocation does not match its resource, owner or service window';
      END IF;
      IF NEW.released_at IS NULL AND (holding.status NOT IN ('ACTIVE','SUSPENDED') OR entitlement.status<>'ACTIVE') THEN
        RAISE EXCEPTION 'Agent service is no longer active';
      END IF;
    ELSIF NEW.expires_at-NEW.assigned_at NOT IN (interval '7 days',interval '30 days') THEN
      RAISE EXCEPTION 'Service duration must be 7 or 30 days';
    END IF;
    IF NEW.released_at IS NULL THEN
      IF NOT stock.is_available OR resource.resource_status NOT IN ('LOCAL','ONLINE')
        OR ((NEW.agent_entitlement_id IS NULL OR holding.source_holding_id IS NULL)
          AND (NOT stock.sale_enabled OR NOT resource.sale_enabled))
        OR (stock.reserved_order_id IS NOT NULL AND stock.reserved_order_id IS DISTINCT FROM NEW.order_id) THEN
        RAISE EXCEPTION 'Number platform resource is unavailable';
      END IF;
      IF NOT EXISTS(SELECT 1 FROM provider_projects p JOIN platforms f ON f.id=p.platform_id
        WHERE p.provider=stock.provider AND p.external_project_id=stock.external_project_id AND p.platform_id=stock.platform_id
        AND p.is_active AND f.is_active) THEN RAISE EXCEPTION 'Platform project is inactive'; END IF;
      IF stock.provider='pingcode' AND (resource.resource_status<>'ONLINE' OR resource.resource_expires_at IS NULL
        OR resource.resource_expires_at<NEW.expires_at) THEN RAISE EXCEPTION 'Resource expiry does not cover service period'; END IF;
    END IF;
    IF NEW.order_id IS NOT NULL THEN
      SELECT * INTO purchased FROM orders WHERE id=NEW.order_id;
      IF purchased.user_id<>NEW.user_id OR purchased.service<>NEW.platform_id OR purchased.region_id<>resource.region_id
        OR NEW.expires_at<>NEW.assigned_at+purchased.duration_days*interval '1 day' THEN
        RAISE EXCEPTION 'Service does not match purchased order';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION guard_unified_holding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stock number_platforms%ROWTYPE; resource phone_numbers%ROWTYPE; source number_holdings%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.inventory_id IS DISTINCT FROM OLD.inventory_id OR NEW.phone_number<>OLD.phone_number OR NEW.region_id<>OLD.region_id
      OR NEW.owner_type<>OLD.owner_type OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.source_holding_id IS DISTINCT FROM OLD.source_holding_id
      OR (OLD.status='RETIRED' AND NEW.status<>'RETIRED') THEN
      RAISE EXCEPTION 'Holding identity is immutable; transfer requires a new holding';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_holding_id IS NOT NULL THEN
    SELECT * INTO source FROM number_holdings WHERE id=NEW.source_holding_id;
    IF source.inventory_id IS NOT NULL AND NEW.inventory_id IS DISTINCT FROM source.inventory_id THEN RAISE EXCEPTION 'Transfer resource mismatch'; END IF;
    NEW.inventory_id:=COALESCE(NEW.inventory_id,source.inventory_id);
  END IF;
  IF NEW.inventory_id IS NULL THEN RAISE EXCEPTION 'Select an existing shared inventory resource'; END IF;
  SELECT * INTO stock FROM number_platforms WHERE id=NEW.inventory_id FOR UPDATE;
  SELECT * INTO resource FROM phone_numbers WHERE id=stock.number_id FOR SHARE;
  IF stock.id IS NULL THEN RAISE EXCEPTION 'Shared inventory resource not found'; END IF;
  NEW.phone_number:=resource.phone_number;
  NEW.region_id:=resource.region_id;
  IF NEW.status IN ('ACTIVE','SUSPENDED') THEN
    IF NEW.expires_at IS NULL OR NEW.expires_at<=GREATEST(NEW.starts_at,now()) THEN RAISE EXCEPTION 'Holding requires a future service expiry'; END IF;
    IF EXISTS(SELECT 1 FROM number_allocations WHERE number_id=stock.number_id AND platform_id=stock.platform_id AND released_at IS NULL) THEN
      RAISE EXCEPTION 'Shared inventory resource is already allocated';
    END IF;
    IF NEW.source_holding_id IS NULL AND (resource.region_id<>'us' OR NOT stock.is_available OR NOT stock.sale_enabled
      OR NOT resource.sale_enabled OR resource.resource_status NOT IN ('LOCAL','ONLINE') OR stock.reserved_order_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Shared inventory resource is not available for allocation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER unified_holding_guard BEFORE INSERT OR UPDATE ON number_holdings
FOR EACH ROW EXECUTE FUNCTION guard_unified_holding();

CREATE FUNCTION normalize_agent_stock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stock number_platforms%ROWTYPE; resource phone_numbers%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND NEW.inventory_id IS DISTINCT FROM OLD.inventory_id THEN RAISE EXCEPTION 'Stock resource identity is immutable'; END IF;
  SELECT * INTO stock FROM number_platforms WHERE id=NEW.inventory_id;
  SELECT * INTO resource FROM phone_numbers WHERE id=stock.number_id;
  IF stock.id IS NULL THEN RAISE EXCEPTION 'Agent stock requires a shared inventory resource'; END IF;
  NEW.provider:=stock.provider; NEW.external_project_id:=stock.external_project_id;
  NEW.platform_id:=stock.platform_id; NEW.phone_number:=resource.phone_number; NEW.region_id:=resource.region_id;
  NEW.resource_status:=resource.resource_status; NEW.resource_expires_at:=resource.resource_expires_at;
  SELECT external_number_id INTO NEW.external_number_id FROM provider_resource_bindings
  WHERE provider=stock.provider AND number_id=stock.number_id;
  IF NEW.status='ALLOCATED' AND NOT EXISTS(SELECT 1 FROM number_holdings h
    JOIN service_entitlements e ON e.holding_id=h.id AND e.inventory_id=NEW.inventory_id AND e.status='ACTIVE'
    WHERE h.id=NEW.holding_id AND h.status IN ('ACTIVE','SUSPENDED')) THEN
    RAISE EXCEPTION 'Agent stock holding must match its shared resource';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_stock_resource_guard BEFORE INSERT OR UPDATE ON agent_number_stock
FOR EACH ROW EXECUTE FUNCTION normalize_agent_stock();

CREATE FUNCTION connect_agent_entitlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE holding number_holdings%ROWTYPE; stock number_platforms%ROWTYPE; resource phone_numbers%ROWTYPE;
  owner_id uuid; effective_start timestamptz;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.holding_id<>OLD.holding_id OR NEW.inventory_id<>OLD.inventory_id OR NEW.service<>OLD.service OR NEW.starts_at<>OLD.starts_at OR NEW.expires_at<>OLD.expires_at THEN
      RAISE EXCEPTION 'Service entitlement identity is immutable';
    END IF;
    IF OLD.status='ACTIVE' AND NEW.status<>'ACTIVE' THEN
      UPDATE number_allocations SET released_at=GREATEST(assigned_at,LEAST(now(),expires_at)),
        release_reason=CASE WHEN NEW.status='EXPIRED' THEN 'EXPIRED' ELSE 'REASSIGNED' END
      WHERE agent_entitlement_id=NEW.id AND released_at IS NULL;
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO holding FROM number_holdings WHERE id=NEW.holding_id;
  SELECT * INTO stock FROM number_platforms WHERE id=NEW.inventory_id FOR UPDATE;
  SELECT * INTO resource FROM phone_numbers WHERE id=stock.number_id;
  IF stock.platform_id IS DISTINCT FROM NEW.service OR stock.id IS NULL THEN RAISE EXCEPTION 'Entitlement platform must match shared inventory'; END IF;
  IF NEW.status<>'ACTIVE' OR holding.status NOT IN ('ACTIVE','SUSPENDED') THEN RETURN NEW; END IF;
  IF holding.owner_type='AGENT' THEN SELECT user_id INTO owner_id FROM agents WHERE id=holding.agent_id;
  ELSE SELECT user_id INTO owner_id FROM customers WHERE id=holding.customer_id; END IF;
  effective_start:=GREATEST(NEW.starts_at,holding.starts_at,holding.created_at);
  INSERT INTO number_allocations(number_id,platform_id,user_id,order_id,assigned_at,expires_at,agent_entitlement_id)
  VALUES(stock.number_id,stock.platform_id,owner_id,NULL,effective_start,LEAST(NEW.expires_at,holding.expires_at),NEW.id);
  INSERT INTO agent_number_stock(id,inventory_id,provider,platform_id,external_project_id,phone_number,region_id,status,holding_id)
  VALUES(stock.id,stock.id,stock.provider,stock.platform_id,stock.external_project_id,resource.phone_number,resource.region_id,'ALLOCATED',holding.id)
  ON CONFLICT(inventory_id) DO UPDATE SET status='ALLOCATED',holding_id=EXCLUDED.holding_id;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_entitlement_allocation AFTER INSERT OR UPDATE ON service_entitlements
FOR EACH ROW EXECUTE FUNCTION connect_agent_entitlement();

CREATE FUNCTION close_agent_holding_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status<>'RETIRED' AND NEW.status='RETIRED' THEN
    UPDATE number_allocations a SET released_at=GREATEST(a.assigned_at,LEAST(COALESCE(NEW.transferred_at,now()),a.expires_at)),
      release_reason=CASE WHEN a.expires_at<=now() THEN 'EXPIRED' ELSE 'REASSIGNED' END
    FROM service_entitlements e WHERE a.agent_entitlement_id=e.id AND e.holding_id=NEW.id AND a.released_at IS NULL;
    UPDATE service_entitlements SET status=CASE WHEN expires_at<=now() THEN 'EXPIRED' ELSE 'REVOKED' END
    WHERE holding_id=NEW.id AND status='ACTIVE';
    UPDATE agent_number_stock SET status='AVAILABLE',holding_id=NULL WHERE holding_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_holding_allocation_close AFTER UPDATE ON number_holdings
FOR EACH ROW EXECUTE FUNCTION close_agent_holding_allocation();

CREATE FUNCTION close_allocation_agent_holding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.released_at IS NULL AND NEW.released_at IS NOT NULL AND NEW.agent_entitlement_id IS NOT NULL THEN
    UPDATE number_holdings h SET status='RETIRED',transferred_at=COALESCE(h.transferred_at,NEW.released_at)
    FROM service_entitlements e WHERE e.id=NEW.agent_entitlement_id AND h.id=e.holding_id AND h.status<>'RETIRED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER allocation_agent_holding_close AFTER UPDATE ON number_allocations
FOR EACH ROW EXECUTE FUNCTION close_allocation_agent_holding();

-- Existing current grants become real routing evidence only from this cutover onward.
INSERT INTO number_allocations(number_id,platform_id,user_id,order_id,assigned_at,expires_at,agent_entitlement_id)
SELECT p.number_id,p.platform_id,COALESCE(a.user_id,c.user_id),NULL,
  GREATEST(now(),h.starts_at,e.starts_at),LEAST(h.expires_at,e.expires_at),e.id
FROM number_holdings h JOIN service_entitlements e ON e.holding_id=h.id
JOIN number_platforms p ON p.id=e.inventory_id AND p.platform_id=e.service
LEFT JOIN agents a ON a.id=h.agent_id LEFT JOIN customers c ON c.id=h.customer_id
WHERE h.status IN ('ACTIVE','SUSPENDED') AND e.status='ACTIVE' AND LEAST(h.expires_at,e.expires_at)>GREATEST(now(),h.starts_at,e.starts_at);
INSERT INTO agent_number_stock(id,inventory_id,provider,platform_id,external_project_id,phone_number,region_id,status,holding_id)
SELECT p.id,p.id,p.provider,p.platform_id,p.external_project_id,n.phone_number,n.region_id,'ALLOCATED',h.id
FROM number_holdings h JOIN service_entitlements e ON e.holding_id=h.id AND e.status='ACTIVE'
JOIN number_platforms p ON p.id=e.inventory_id JOIN phone_numbers n ON n.id=p.number_id
WHERE h.status IN ('ACTIVE','SUSPENDED')
ON CONFLICT(inventory_id) DO UPDATE SET status='ALLOCATED',holding_id=EXCLUDED.holding_id;
-- Refresh retained resource snapshots through the canonical resource trigger.
UPDATE agent_number_stock SET resource_status=resource_status;

CREATE OR REPLACE FUNCTION record_number_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.assigned_user_id IS NOT NULL AND (
    NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id OR NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at OR NEW.service IS DISTINCT FROM OLD.service
  ) THEN
    UPDATE number_allocations SET released_at=now()
    WHERE number_id=OLD.id AND platform_id=OLD.service AND released_at IS NULL;
  END IF;
  IF NEW.assigned_user_id IS NOT NULL THEN
    INSERT INTO number_allocations(number_id,platform_id,user_id,order_id,assigned_at,expires_at)
    VALUES(NEW.id,NEW.service,NEW.assigned_user_id,NEW.order_id,NEW.assigned_at,NEW.expires_at)
    ON CONFLICT(number_id,platform_id) WHERE released_at IS NULL DO UPDATE SET expires_at=EXCLUDED.expires_at;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE unified_inventory_cutover AS
SELECT now() AS cutover_at,(SELECT count(*) FROM number_holdings) AS retained_holdings,
  (SELECT count(*) FROM number_allocations WHERE agent_entitlement_id IS NOT NULL) AS connected_allocations,
  'Agent history retained; SMS ownership starts at cutover, never guessed retroactively'::text AS note;
COMMENT ON TABLE agent_number_stock IS 'Compatibility distribution index of the shared number_platforms inventory; not a separate supply pool';
COMMENT ON TABLE number_holdings IS 'Distribution ownership history referencing one shared number x platform inventory resource';
COMMENT ON COLUMN number_allocations.agent_entitlement_id IS 'Agent/customer service routed through the same immutable allocation evidence as direct sales';
