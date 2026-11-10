-- LinePool shop pricing ("each shop sells its own"): a shop's agent maintains its own storefront products priced
-- in site points; the storefront sells the ACTIVE official shop's products from that shop's numbers.
-- Forward only. Site-wide offers and historical orders are kept; Mock mode keeps using offers.

CREATE TABLE shop_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id),
  region_id text NOT NULL REFERENCES regions(id),
  platform_id text NOT NULL REFERENCES platforms(id),
  duration_days integer NOT NULL CHECK (duration_days IN (7,30)),
  plan text GENERATED ALWAYS AS (CASE duration_days WHEN 7 THEN 'week' ELSE 'month' END) STORED,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  unit_points integer NOT NULL CHECK (unit_points BETWEEN 1 AND 1000000),
  is_active boolean NOT NULL DEFAULT true,
  admin_hold boolean NOT NULL DEFAULT false,
  admin_hold_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (admin_hold = (admin_hold_reason IS NOT NULL)),
  UNIQUE (shop_id, region_id, platform_id, duration_days),
  UNIQUE (id, shop_id)
);
CREATE INDEX shop_products_listing ON shop_products(shop_id) WHERE is_active AND NOT admin_hold;

CREATE FUNCTION guard_shop_product() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Shop products are delisted, not deleted'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
    OR NEW.region_id IS DISTINCT FROM OLD.region_id OR NEW.platform_id IS DISTINCT FROM OLD.platform_id
    OR NEW.duration_days IS DISTINCT FROM OLD.duration_days OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'Shop product identity is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shop_product_guard BEFORE UPDATE OR DELETE ON shop_products FOR EACH ROW EXECUTE FUNCTION guard_shop_product();

ALTER TABLE orders ADD COLUMN shop_id uuid REFERENCES shops(id), ADD COLUMN shop_product_id uuid,
  ADD CONSTRAINT orders_shop_product_fk FOREIGN KEY(shop_product_id, shop_id) REFERENCES shop_products(id, shop_id),
  ADD CONSTRAINT orders_shop_shape CHECK ((shop_id IS NULL) = (shop_product_id IS NULL));

-- A shop order has no site-wide offer, so the composite orders -> offers foreign key from 001 becomes a trigger:
-- an order references either an existing offer (as before) or its shop product. Offers stay protected below.
DO $$
DECLARE fk text;
BEGIN
  SELECT conname INTO fk FROM pg_constraint WHERE conrelid='orders'::regclass AND confrelid='offers'::regclass AND contype='f';
  IF fk IS NULL THEN RAISE EXCEPTION 'orders -> offers foreign key not found'; END IF;
  EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', fk);
END $$;

CREATE FUNCTION guard_order_product() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE product shop_products%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.shop_id IS DISTINCT FROM OLD.shop_id OR NEW.shop_product_id IS DISTINCT FROM OLD.shop_product_id THEN
      RAISE EXCEPTION 'Order shop identity is immutable'; END IF;
    IF NEW.region_id IS NOT DISTINCT FROM OLD.region_id AND NEW.service IS NOT DISTINCT FROM OLD.service
      AND NEW.plan IS NOT DISTINCT FROM OLD.plan THEN RETURN NEW; END IF;
  END IF;
  IF NEW.shop_product_id IS NOT NULL THEN
    SELECT * INTO product FROM shop_products WHERE id=NEW.shop_product_id;
    IF NEW.product_type IS DISTINCT FROM 'SMS_CODE' OR NEW.sales_storefront_id IS DISTINCT FROM 'linepool'
      OR product.region_id IS DISTINCT FROM NEW.region_id OR product.platform_id IS DISTINCT FROM NEW.service
      OR product.plan IS DISTINCT FROM NEW.plan OR product.duration_days IS DISTINCT FROM NEW.duration_days
      OR (TG_OP='INSERT' AND (product.unit_points IS DISTINCT FROM NEW.unit_points OR NOT product.is_active OR product.admin_hold
        OR NOT EXISTS(SELECT 1 FROM shops s WHERE s.id=NEW.shop_id AND s.status='ACTIVE'))) THEN
      RAISE EXCEPTION 'Shop order must match its listed shop product'; END IF;
  ELSIF NEW.service IS NOT NULL AND NEW.plan IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM offers o WHERE o.region_id=NEW.region_id AND o.service=NEW.service AND o.plan=NEW.plan) THEN
    RAISE EXCEPTION 'Order must reference an existing offer';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_product_guard BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION guard_order_product();

CREATE FUNCTION guard_offer_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP='DELETE' OR NEW.region_id IS DISTINCT FROM OLD.region_id OR NEW.service IS DISTINCT FROM OLD.service OR NEW.plan IS DISTINCT FROM OLD.plan)
    AND EXISTS(SELECT 1 FROM orders o WHERE o.shop_product_id IS NULL AND o.region_id=OLD.region_id AND o.service=OLD.service AND o.plan=OLD.plan) THEN
    RAISE EXCEPTION 'An offer referenced by orders cannot be deleted or re-keyed'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER offer_identity_guard BEFORE UPDATE OR DELETE ON offers FOR EACH ROW EXECUTE FUNCTION guard_offer_identity();
