-- Additive change: keep existing orders, allocations and renewal history intact.
ALTER TABLE orders ADD COLUMN area_code text;
ALTER TABLE orders ADD CONSTRAINT orders_area_code_check
  CHECK (area_code IS NULL OR (region_id = 'us' AND area_code ~ '^[2-9][0-9]{2}$'));
