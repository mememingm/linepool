-- Preserve obsolete physical assignment snapshots before removing their columns.
-- v4.2 after037-039, only in the authorized stopped-writer cutover transaction.
CREATE TABLE once_legacy_assignment_snapshots (
  number_id uuid PRIMARY KEY REFERENCES phone_numbers(id),
  original_fields jsonb NOT NULL CHECK(jsonb_typeof(original_fields)='object'),
  preserved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO once_legacy_assignment_snapshots(number_id,original_fields)
SELECT id,jsonb_build_object(
  'assigned_user_id',assigned_user_id,'order_id',order_id,'assigned_at',assigned_at,'expires_at',expires_at,
  'service',service,'reserved_order_id',reserved_order_id,'sale_enabled',sale_enabled)
FROM phone_numbers;

DO $$
DECLARE problem record;
BEGIN
  SELECT id,assigned_user_id,order_id,assigned_at,expires_at INTO problem FROM phone_numbers
  WHERE NOT (
    (assigned_user_id IS NULL AND order_id IS NULL AND assigned_at IS NULL AND expires_at IS NULL)
    OR (assigned_user_id IS NOT NULL AND assigned_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at>assigned_at)
  ) ORDER BY id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'S4 cutover prerequisite: legacy whole-number assignment snapshot is inconsistent'
      USING DETAIL=format('number_id=%s user_id=%s order_id=%s assigned_at=%s expires_at=%s',
        problem.id,problem.assigned_user_id,problem.order_id,problem.assigned_at,problem.expires_at),
      HINT='Resolve and preserve the original assignment evidence before retrying; this migration does not infer periods.';
  END IF;

  SELECT n.id,n.assigned_user_id,n.order_id,n.assigned_at,n.expires_at,e.matches INTO problem
  FROM phone_numbers n LEFT JOIN LATERAL(SELECT count(*) AS matches FROM number_allocations a
    JOIN orders o ON o.id=a.order_id WHERE a.number_id=n.id AND a.allocation_type='PLATFORM'
      AND a.platform_id IS NOT DISTINCT FROM n.service AND a.user_id=n.assigned_user_id
      AND a.order_id IS NOT DISTINCT FROM n.order_id AND a.assigned_at=n.assigned_at AND a.expires_at=n.expires_at
      AND o.user_id IS NOT DISTINCT FROM n.assigned_user_id AND o.service IS NOT DISTINCT FROM n.service) e ON true
  WHERE n.assigned_user_id IS NOT NULL AND e.matches<>1 ORDER BY n.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'S4 cutover prerequisite: legacy assignment lacks unique matching immutable PLATFORM allocation evidence'
      USING DETAIL=format('number_id=%s user_id=%s order_id=%s assigned_at=%s expires_at=%s matches=%s',
        problem.id,problem.assigned_user_id,problem.order_id,problem.assigned_at,problem.expires_at,problem.matches),
      HINT='Reconcile the original allocation history explicitly; no allocation is fabricated by the cleanup migration.';
  END IF;

  SELECT c.conname,src.relname AS source_table,dst.relname AS target_table INTO problem
  FROM pg_constraint c JOIN pg_class src ON src.oid=c.conrelid JOIN pg_class dst ON dst.oid=c.confrelid
  JOIN pg_attribute referenced ON referenced.attrelid=c.confrelid AND referenced.attnum=ANY(c.confkey)
  WHERE c.contype='f' AND c.confrelid='phone_numbers'::regclass
    AND referenced.attname IN ('assigned_user_id','order_id','assigned_at','expires_at','service','reserved_order_id')
  ORDER BY c.conname LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'S4 cutover prerequisite: another table still references obsolete phone assignment columns'
      USING DETAIL=format('constraint=%s source_table=%s target_table=%s',problem.conname,problem.source_table,problem.target_table),
      HINT='Migrate the dependent identity constraint to number_allocations before removing its legacy target.';
  END IF;

  SELECT n.id,n.reserved_order_id INTO problem FROM phone_numbers n
  WHERE n.reserved_order_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM number_platforms s WHERE s.number_id=n.id AND s.platform_id=n.service AND s.reserved_order_id=n.reserved_order_id
  ) ORDER BY n.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'S4 cutover prerequisite: physical legacy reservation has no matching platform reservation'
      USING DETAIL=format('number_id=%s reserved_order_id=%s',problem.id,problem.reserved_order_id),
      HINT='Resolve the reservation against its explicit product before removing the physical snapshot.';
  END IF;
END $$;

CREATE FUNCTION reject_once_legacy_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Legacy number assignment snapshots are immutable';
END $$;
CREATE TRIGGER once_legacy_snapshot_append_only BEFORE UPDATE OR DELETE ON once_legacy_assignment_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_once_legacy_snapshot_mutation();

DROP INDEX IF EXISTS phone_numbers_inventory;
DROP INDEX IF EXISTS phone_numbers_user;
DROP INDEX IF EXISTS phone_numbers_expiry;
DROP INDEX IF EXISTS phone_numbers_reservation;
DROP TRIGGER IF EXISTS phone_number_allocation ON phone_numbers;
DROP FUNCTION IF EXISTS record_number_allocation();

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT DISTINCT c.conname FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.conrelid='phone_numbers'::regclass
      AND a.attname IN ('assigned_user_id','order_id','assigned_at','expires_at','service','reserved_order_id')
  LOOP
    EXECUTE format('ALTER TABLE phone_numbers DROP CONSTRAINT %I',constraint_name);
  END LOOP;
END $$;

ALTER TABLE phone_numbers
  DROP COLUMN assigned_user_id,
  DROP COLUMN order_id,
  DROP COLUMN assigned_at,
  DROP COLUMN expires_at,
  DROP COLUMN service,
  DROP COLUMN reserved_order_id;
