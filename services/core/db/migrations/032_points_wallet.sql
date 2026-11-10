-- Run under migrateDatabase's transaction, with application writers stopped for cutover.
-- Abort on unexplained legacy data; never manufacture funding or historical rules.
LOCK TABLE users, orders, point_ledger, recharge_orders, sandbox_grants IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE problem record;
BEGIN
  -- The window must cover every row before selecting a broken link.
  SELECT * INTO problem FROM (
    SELECT id, user_id, sequence, balance_after,
      sum(delta::bigint) OVER (PARTITION BY user_id ORDER BY sequence ROWS UNBOUNDED PRECEDING) AS expected_balance
    FROM point_ledger
  ) chain WHERE balance_after::bigint <> expected_balance ORDER BY sequence LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'S3 conversion prerequisite: legacy ledger balance chain is inconsistent'
      USING DETAIL = format('user_id=%s ledger_id=%s sequence=%s stored=%s expected=%s',
        problem.user_id, problem.id, problem.sequence, problem.balance_after, problem.expected_balance),
      HINT = 'Resolve the original ledger history before retrying; this migration does not create balancing entries.';
  END IF;

  SELECT u.id, u.points_balance, coalesce(sum(l.delta::bigint), 0) AS expected_balance
  INTO problem FROM users u LEFT JOIN point_ledger l ON l.user_id=u.id
  GROUP BY u.id, u.points_balance
  HAVING u.points_balance::bigint <> coalesce(sum(l.delta::bigint), 0)
  ORDER BY u.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'S3 conversion prerequisite: legacy user balance is unexplained'
      USING DETAIL = format('user_id=%s stored=%s ledger_total=%s difference=%s',
        problem.id, problem.points_balance, problem.expected_balance, problem.points_balance::bigint-problem.expected_balance);
  END IF;

  SELECT o.id, o.user_id, o.total_points, d.id AS ledger_id, d.delta
  INTO problem FROM orders o
  LEFT JOIN point_ledger d ON d.reference_id=o.id AND d.type='ORDER_DEBIT'
  WHERE d.id IS NULL OR d.user_id<>o.user_id OR -d.delta::bigint<>o.total_points::bigint
  ORDER BY o.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'S3 conversion prerequisite: order lacks matching original debit evidence'
      USING DETAIL = format('order_id=%s user_id=%s total_points=%s ledger_id=%s delta=%s',
        problem.id, problem.user_id, problem.total_points, problem.ledger_id, problem.delta),
      HINT = 'Resolve source order/debit ownership and amount; no order is assigned fabricated funding.';
  END IF;

  SELECT r.id, r.reverses_ledger_id INTO problem
  FROM point_ledger r LEFT JOIN point_ledger d ON d.id=r.reverses_ledger_id
  WHERE r.reverses_ledger_id IS NOT NULL AND (
    r.type<>'ADJUSTMENT' OR d.type IS DISTINCT FROM 'ORDER_DEBIT'
    OR r.user_id IS DISTINCT FROM d.user_id OR r.reference_id IS DISTINCT FROM d.reference_id
    OR r.delta::bigint IS DISTINCT FROM -d.delta::bigint
  ) ORDER BY r.sequence LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'S3 conversion prerequisite: invalid original order reversal'
      USING DETAIL = format('ledger_id=%s reverses_ledger_id=%s', problem.id, problem.reverses_ledger_id);
  END IF;

  SELECT r.id, r.user_id, r.points_ledger_id, l.id AS ledger_id INTO problem
  FROM recharge_orders r LEFT JOIN point_ledger l ON l.recharge_order_id=r.id
  WHERE (r.status='SUCCEEDED' AND (
    l.id IS NULL OR r.points_ledger_id IS DISTINCT FROM l.id OR l.user_id<>r.user_id OR l.delta<>r.points
  )) OR (r.status<>'SUCCEEDED' AND l.id IS NOT NULL)
  ORDER BY r.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'S3 conversion prerequisite: recharge funding identity is inconsistent'
      USING DETAIL = format('recharge_order_id=%s user_id=%s points_ledger_id=%s linked_ledger_id=%s',
        problem.id, problem.user_id, problem.points_ledger_id, problem.ledger_id);
  END IF;

  SELECT g.user_id, g.ledger_id INTO problem
  FROM sandbox_grants g JOIN point_ledger l ON l.id=g.ledger_id
  WHERE l.user_id<>g.user_id OR l.type<>'SEED_CREDIT' ORDER BY g.user_id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'S3 conversion prerequisite: sandbox grant ledger identity is inconsistent'
      USING DETAIL = format('user_id=%s ledger_id=%s', problem.user_id, problem.ledger_id);
  END IF;
END $$;

CREATE TABLE point_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  available_points integer NOT NULL DEFAULT 0 CHECK (available_points>=0),
  frozen_points integer NOT NULL DEFAULT 0 CHECK (frozen_points>=0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVIEW')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,user_id),
  CHECK (available_points::bigint+frozen_points::bigint<=2147483647)
);

INSERT INTO point_accounts(user_id,available_points,created_at)
SELECT id,points_balance,created_at FROM users;

CREATE TABLE point_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES point_accounts(id),
  kind text NOT NULL CHECK (kind='ORDER'),
  business_id text NOT NULL,
  points integer NOT NULL CHECK (points>0),
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','CAPTURED','RELEASED')),
  refunded_points integer NOT NULL DEFAULT 0 CHECK (refunded_points>=0 AND refunded_points<=points),
  request_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(account_id,kind,business_id),
  UNIQUE(id,account_id),
  CHECK (status='CAPTURED' OR refunded_points=0)
);
CREATE INDEX point_reservations_account_status ON point_reservations(account_id,status);

ALTER TABLE orders ADD COLUMN point_reservation_id uuid UNIQUE REFERENCES point_reservations(id);
ALTER TABLE point_ledger
  ADD COLUMN account_id uuid,
  ADD COLUMN frozen_delta integer NOT NULL DEFAULT 0,
  ADD COLUMN frozen_after integer NOT NULL DEFAULT 0 CHECK (frozen_after>=0),
  ADD COLUMN reservation_id uuid,
  ADD COLUMN business_id text,
  ADD COLUMN request_payload jsonb;

-- Old debits, including reversed and still-processing orders, were already consumed.
-- They acquire consumption identities, never synthetic reserve/capture ledger rows.
INSERT INTO point_reservations(account_id,kind,business_id,points,status,refunded_points,request_payload,created_at,settled_at)
SELECT a.id,'ORDER',d.reference_id::text,(-d.delta::bigint)::integer,'CAPTURED',coalesce(r.delta,0),
  jsonb_build_object('orderId',d.reference_id::text,'points',(-d.delta::bigint)::integer),d.created_at,d.created_at
FROM point_ledger d JOIN point_accounts a ON a.user_id=d.user_id
LEFT JOIN point_ledger r ON r.reverses_ledger_id=d.id
WHERE d.type='ORDER_DEBIT';

UPDATE orders o SET point_reservation_id=r.id
FROM point_reservations r JOIN point_accounts a ON a.id=r.account_id
WHERE r.kind='ORDER' AND r.business_id=o.id::text AND a.user_id=o.user_id;

UPDATE point_ledger l SET account_id=a.id, business_id='legacy:'||l.id::text,
  request_payload=jsonb_build_object(
    'type',l.type,'delta',l.delta,'balanceAfter',l.balance_after,'description',l.description,
    'referenceId',l.reference_id,'rechargeOrderId',l.recharge_order_id,'reversesLedgerId',l.reverses_ledger_id)
FROM point_accounts a WHERE a.user_id=l.user_id;

UPDATE point_ledger l SET reservation_id=o.point_reservation_id
FROM orders o WHERE l.reference_id=o.id;

ALTER TABLE point_ledger
  ALTER COLUMN account_id SET NOT NULL,
  ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN request_payload SET NOT NULL,
  ADD CONSTRAINT point_ledger_account_user_fk FOREIGN KEY(account_id,user_id) REFERENCES point_accounts(id,user_id),
  ADD CONSTRAINT point_ledger_reservation_account_fk FOREIGN KEY(reservation_id,account_id) REFERENCES point_reservations(id,account_id),
  ADD CONSTRAINT point_ledger_business_identity UNIQUE(account_id,type,business_id),
  DROP CONSTRAINT point_ledger_delta_check,
  DROP CONSTRAINT point_ledger_type_check;
ALTER TABLE point_ledger
  ADD CONSTRAINT point_ledger_type_check CHECK (type IN (
    'SEED_CREDIT','ORDER_DEBIT','ADJUSTMENT','RECHARGE','ORDER_RESERVE','ORDER_CAPTURE','ORDER_RELEASE','ORDER_REFUND'
  )),
  ADD CONSTRAINT point_ledger_nonzero_change CHECK (delta<>0 OR frozen_delta<>0),
  ADD CONSTRAINT point_ledger_total_after CHECK (balance_after::bigint+frozen_after::bigint<=2147483647),
  ADD CONSTRAINT point_ledger_wallet_shape CHECK (
    (type IN ('SEED_CREDIT','ORDER_DEBIT','ADJUSTMENT','RECHARGE') AND frozen_delta=0)
    OR (type='ORDER_RESERVE' AND delta<0 AND frozen_delta::bigint=-delta::bigint)
    OR (type='ORDER_CAPTURE' AND delta=0 AND frozen_delta<0)
    OR (type='ORDER_RELEASE' AND delta>0 AND frozen_delta::bigint=-delta::bigint)
    OR (type='ORDER_REFUND' AND delta>0 AND frozen_delta=0)
  ),
  ADD CONSTRAINT point_ledger_order_reservation_shape CHECK (
    type NOT IN ('ORDER_DEBIT','ORDER_RESERVE','ORDER_CAPTURE','ORDER_RELEASE','ORDER_REFUND')
    OR (reservation_id IS NOT NULL AND reference_id IS NOT NULL)
  );
CREATE INDEX point_ledger_reservation ON point_ledger(reservation_id) WHERE reservation_id IS NOT NULL;
-- Keep the existing ORDER_DEBIT partial unique index, recharge partial unique index,
-- full-reversal unique FK/trigger, recharge shape and original order ownership FK.

ALTER TABLE recharge_orders ADD COLUMN request_payload jsonb, ADD COLUMN conversion_snapshot jsonb;
UPDATE recharge_orders SET
  request_payload=jsonb_build_object('amountMinor',amount_minor,'paymentMethod',payment_method),
  conversion_snapshot=jsonb_build_object('kind','LEGACY_EFFECTIVE','amountMinor',amount_minor,
    'points',points,'currency',currency,'fractionDigits',fraction_digits);
ALTER TABLE recharge_orders ALTER COLUMN request_payload SET NOT NULL, ALTER COLUMN conversion_snapshot SET NOT NULL;

-- Deferred checks read current rows, not the event's NEW snapshot: creating an order,
-- reserving, and then binding the order must be legal within a single transaction.
CREATE FUNCTION assert_point_order_binding(order_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE bound record;
BEGIN
  SELECT o.id,o.user_id,o.total_points,o.point_reservation_id,r.kind,r.business_id,r.points,a.user_id AS account_user_id
  INTO bound FROM orders o
  LEFT JOIN point_reservations r ON r.id=o.point_reservation_id
  LEFT JOIN point_accounts a ON a.id=r.account_id WHERE o.id=order_id;
  IF FOUND THEN
    IF bound.point_reservation_id IS NULL OR bound.kind IS DISTINCT FROM 'ORDER'
      OR bound.business_id IS DISTINCT FROM bound.id::text OR bound.points IS DISTINCT FROM bound.total_points
      OR bound.account_user_id IS DISTINCT FROM bound.user_id THEN
      RAISE EXCEPTION 'Order wallet reservation must match order identity, owner and points'
        USING DETAIL = format('order_id=%s reservation_id=%s',bound.id,bound.point_reservation_id);
    END IF;
  ELSIF EXISTS (SELECT 1 FROM point_reservations WHERE kind='ORDER' AND business_id=order_id::text) THEN
    RAISE EXCEPTION 'Order wallet reservation has no order' USING DETAIL = format('order_id=%s',order_id);
  END IF;
END $$;

CREATE FUNCTION guard_point_order_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN PERFORM assert_point_order_binding(OLD.id); END IF;
  IF TG_OP='DELETE' THEN
    PERFORM assert_point_reservation_binding(OLD.point_reservation_id);
  ELSIF TG_OP='UPDATE' AND OLD.point_reservation_id IS DISTINCT FROM NEW.point_reservation_id THEN
    PERFORM assert_point_reservation_binding(OLD.point_reservation_id);
  END IF;
  IF TG_OP<>'DELETE' THEN PERFORM assert_point_order_binding(NEW.id); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER point_order_binding_guard AFTER INSERT OR UPDATE OR DELETE ON orders
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_point_order_binding();

CREATE FUNCTION assert_point_reservation_binding(reservation_uuid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE bound record;
BEGIN
  SELECT r.id,r.kind,r.business_id,r.points,r.account_id,o.id AS order_id,o.user_id,o.total_points,a.user_id AS account_user_id
  INTO bound FROM point_reservations r JOIN point_accounts a ON a.id=r.account_id
  LEFT JOIN orders o ON o.point_reservation_id=r.id WHERE r.id=reservation_uuid;
  IF NOT FOUND THEN RETURN; END IF;
  IF bound.order_id IS NULL OR bound.kind<>'ORDER' OR bound.business_id<>bound.order_id::text
    OR bound.points<>bound.total_points OR bound.account_user_id<>bound.user_id THEN
    RAISE EXCEPTION 'Wallet reservation must be bound to its matching order'
      USING DETAIL = format('reservation_id=%s business_id=%s',bound.id,bound.business_id);
  END IF;
  IF EXISTS (SELECT 1 FROM point_ledger l WHERE l.reservation_id=bound.id AND (
    l.account_id<>bound.account_id OR l.reference_id IS DISTINCT FROM bound.order_id
    OR (l.type IN ('ORDER_DEBIT','ORDER_RESERVE') AND -l.delta::bigint<>bound.points::bigint)
    OR (l.type IN ('ORDER_CAPTURE','ORDER_RELEASE') AND -l.frozen_delta::bigint<>bound.points::bigint)
    OR (l.type='ORDER_REFUND' AND l.delta>bound.points)
  )) THEN
    RAISE EXCEPTION 'Reservation conflicts with its existing ledger identity'
      USING DETAIL = format('reservation_id=%s',bound.id);
  END IF;
END $$;

CREATE FUNCTION guard_point_reservation_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN PERFORM assert_point_reservation_binding(OLD.id); END IF;
  IF TG_OP<>'DELETE' THEN PERFORM assert_point_reservation_binding(NEW.id); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER point_reservation_binding_guard AFTER INSERT OR UPDATE OR DELETE ON point_reservations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_point_reservation_binding();

CREATE FUNCTION guard_point_account_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reservation_uuid uuid;
BEGIN
  FOR reservation_uuid IN SELECT id FROM point_reservations WHERE account_id=NEW.id LOOP
    PERFORM assert_point_reservation_binding(reservation_uuid);
  END LOOP;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER point_account_owner_guard AFTER UPDATE OF user_id ON point_accounts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_point_account_owner();

CREATE FUNCTION guard_point_ledger_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reservation point_reservations%ROWTYPE;
BEGIN
  IF NEW.reservation_id IS NOT NULL THEN
    SELECT * INTO reservation FROM point_reservations WHERE id=NEW.reservation_id;
    IF NOT FOUND OR reservation.account_id<>NEW.account_id OR reservation.kind<>'ORDER'
      OR NEW.reference_id IS NULL OR reservation.business_id<>NEW.reference_id::text
      OR (NEW.type IN ('ORDER_DEBIT','ORDER_RESERVE') AND -NEW.delta::bigint<>reservation.points::bigint)
      OR (NEW.type IN ('ORDER_CAPTURE','ORDER_RELEASE') AND -NEW.frozen_delta::bigint<>reservation.points::bigint)
      OR (NEW.type='ORDER_REFUND' AND NEW.delta>reservation.points) THEN
      RAISE EXCEPTION 'Ledger reservation must match account, order and points';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER point_ledger_reservation_guard BEFORE INSERT ON point_ledger
FOR EACH ROW EXECUTE FUNCTION guard_point_ledger_reservation();

CREATE FUNCTION assert_point_recharge_identity(recharge_uuid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE credited record;
BEGIN
  SELECT r.id,r.user_id,r.points,r.status,r.points_ledger_id,l.id AS ledger_id,l.user_id AS ledger_user_id,l.delta
  INTO credited FROM recharge_orders r LEFT JOIN point_ledger l ON l.recharge_order_id=r.id WHERE r.id=recharge_uuid;
  IF NOT FOUND THEN RETURN; END IF;
  IF (credited.status='SUCCEEDED' AND (credited.ledger_id IS NULL
      OR credited.points_ledger_id IS DISTINCT FROM credited.ledger_id
      OR credited.ledger_user_id IS DISTINCT FROM credited.user_id OR credited.delta IS DISTINCT FROM credited.points))
    OR (credited.status<>'SUCCEEDED' AND credited.ledger_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Recharge order and credit ledger must have the same owner, points and identity'
      USING DETAIL = format('recharge_order_id=%s',recharge_uuid);
  END IF;
END $$;

CREATE FUNCTION guard_point_recharge_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='point_ledger' THEN
    IF NEW.recharge_order_id IS NOT NULL THEN PERFORM assert_point_recharge_identity(NEW.recharge_order_id); END IF;
  ELSE
    IF TG_OP<>'INSERT' THEN PERFORM assert_point_recharge_identity(OLD.id); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM assert_point_recharge_identity(NEW.id); END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER point_recharge_credit_guard AFTER INSERT ON point_ledger
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_point_recharge_identity();
CREATE CONSTRAINT TRIGGER recharge_point_credit_guard AFTER INSERT OR UPDATE OR DELETE ON recharge_orders
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_point_recharge_identity();

-- Validate all converted bindings before removing the sole old balance column.
DO $$
DECLARE bound record;
BEGIN
  FOR bound IN SELECT id FROM orders LOOP PERFORM assert_point_order_binding(bound.id); END LOOP;
  FOR bound IN SELECT id FROM point_reservations LOOP PERFORM assert_point_reservation_binding(bound.id); END LOOP;
  FOR bound IN SELECT id FROM recharge_orders LOOP PERFORM assert_point_recharge_identity(bound.id); END LOOP;
END $$;

ALTER TABLE users DROP COLUMN points_balance;

-- Install only after all historical enrichment; ledger IDs and all old financial facts stay unchanged.
CREATE FUNCTION reject_point_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Point ledger is append-only: UPDATE and DELETE are forbidden';
END $$;
CREATE TRIGGER point_ledger_append_only BEFORE UPDATE OR DELETE ON point_ledger
FOR EACH ROW EXECUTE FUNCTION reject_point_ledger_mutation();
