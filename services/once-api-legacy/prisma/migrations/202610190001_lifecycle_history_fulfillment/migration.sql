BEGIN;
SET LOCAL lock_timeout = '5s';

-- Preflight and backfill counts are emitted before changing historical data.
-- Ambiguous ownership is a blocker; never guess which historical lease is current.
DO $$
DECLARE total_leases bigint; deterministic bigint; ambiguous bigint; unmatched bigint; invalid bigint;
BEGIN
  SELECT count(*) INTO total_leases FROM "Lease";
  SELECT count(*) INTO ambiguous FROM "Lease" l WHERE EXISTS (
    SELECT 1 FROM "Lease" other WHERE other."phoneNumberId"=l."phoneNumberId" AND other."id"<>l."id");
  SELECT count(*) INTO unmatched FROM "Lease" l LEFT JOIN "PhoneNumber" p ON p.id=l."phoneNumberId" WHERE p.id IS NULL;
  deterministic := total_leases - ambiguous - unmatched;
  RAISE NOTICE 'Lease backfill: total=%, deterministic=%, ambiguous=%, unmatched=%', total_leases,deterministic,ambiguous,unmatched;
  SELECT count(*) INTO invalid FROM "Lease" WHERE "expiresAt" <= "startedAt" OR "termDays" NOT IN (7,30) OR "priceMinor"<0;
  IF ambiguous>0 OR unmatched>0 OR invalid>0 THEN
    RAISE EXCEPTION 'Lease migration blocked: ambiguous=%, unmatched=%, invalid=%. Resolve ownership with evidence, not automatic reassignment.',ambiguous,unmatched,invalid;
  END IF;
  SELECT count(*) INTO unmatched FROM "Order" o LEFT JOIN "Lease" l ON l.id=o."leaseId" WHERE l.id IS NULL;
  SELECT count(*) INTO invalid FROM "Order" o JOIN "Lease" l ON l.id=o."leaseId"
    WHERE o."userId"<>l."userId" OR o."termDays" NOT IN (7,30) OR o."amountMinor"<0 OR o.kind NOT IN ('RENT','RENEW') OR o.status<>'DEMO_CONFIRMED';
  SELECT count(*) INTO deterministic FROM "Order";
  RAISE NOTICE 'Order snapshot backfill: total=%, deterministic=%, ambiguous=0, unmatched=%, invalid=%',deterministic,deterministic-unmatched-invalid,unmatched,invalid;
  IF unmatched>0 OR invalid>0 THEN RAISE EXCEPTION 'Order migration blocked: unmatched=%, invalid=%',unmatched,invalid; END IF;
  SELECT count(*) INTO unmatched FROM "Message" m LEFT JOIN "Lease" l ON l.id=m."leaseId" WHERE l.id IS NULL;
  SELECT count(*) INTO deterministic FROM "Message";
  RAISE NOTICE 'Message ownership: total=%, deterministic=%, ambiguous=0, unmatched=%. Existing leaseId is preserved.',deterministic,deterministic-unmatched,unmatched;
  IF unmatched>0 THEN RAISE EXCEPTION 'Message ownership migration blocked'; END IF;
END $$;

ALTER TABLE "PhoneNumber" ADD COLUMN "holdReason" TEXT;
ALTER TABLE "Lease" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE', ADD COLUMN "endedAt" TIMESTAMPTZ(3);
UPDATE "Lease" SET "status"='EXPIRED_HELD',"endedAt"="expiresAt" WHERE "expiresAt"<=CURRENT_TIMESTAMP;
UPDATE "PhoneNumber" p SET "occupied"=true,"holdReason"=CASE WHEN l.status='EXPIRED_HELD' THEN 'EXPIRY_RELEASE_RULES_UNCONFIRMED' ELSE NULL END
  FROM "Lease" l WHERE l."phoneNumberId"=p.id;
UPDATE "PhoneNumber" p SET "holdReason"='LEGACY_OCCUPANCY_REQUIRES_REVIEW'
  WHERE p.occupied AND NOT EXISTS(SELECT 1 FROM "Lease" l WHERE l."phoneNumberId"=p.id);
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_lifecycle_check" CHECK (
  "termDays" IN (7,30) AND "priceMinor">=0 AND "expiresAt">"startedAt" AND
  ((status='ACTIVE' AND "endedAt" IS NULL) OR (status='EXPIRED_HELD' AND "endedAt" IS NOT NULL AND "endedAt"="expiresAt") OR
   (status='RELEASED' AND "endedAt" IS NOT NULL AND "endedAt">="startedAt" AND "endedAt"<="expiresAt")));
CREATE UNIQUE INDEX "Lease_current_phoneNumber_key" ON "Lease"("phoneNumberId") WHERE status IN ('ACTIVE','EXPIRED_HELD');
CREATE INDEX "Lease_status_expiresAt_id_idx" ON "Lease"(status,"expiresAt",id);

ALTER TABLE "Order" ALTER COLUMN "leaseId" DROP NOT NULL, ALTER COLUMN status SET DEFAULT 'PENDING',
  ADD COLUMN "phoneNumberId" UUID, ADD COLUMN "numberSnapshot" TEXT, ADD COLUMN "mockScenario" TEXT,
  ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0, ADD COLUMN "claimToken" UUID, ADD COLUMN "claimUntil" TIMESTAMPTZ(3),
  ADD COLUMN "checkedAt" TIMESTAMPTZ(3), ADD COLUMN "completedAt" TIMESTAMPTZ(3), ADD COLUMN "providerOrderId" TEXT,
  ADD COLUMN "lastError" TEXT, ADD COLUMN evidence JSONB;
UPDATE "Order" o SET "phoneNumberId"=l."phoneNumberId","numberSnapshot"=p.number FROM "Lease" l JOIN "PhoneNumber" p ON p.id=l."phoneNumberId" WHERE l.id=o."leaseId";
-- Historical completion time is unknown: leave completedAt null rather than fabricate it.
ALTER TABLE "Order" DROP CONSTRAINT "Order_leaseId_fkey";
ALTER TABLE "Order" ADD CONSTRAINT "Order_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "PhoneNumber"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_workflow_check" CHECK (
  kind IN ('RENT','RENEW') AND "termDays" IN (7,30) AND "amountMinor">=0 AND attempts>=0 AND
  status IN ('PENDING','PROCESSING','UNCERTAIN','DEMO_CONFIRMED','FAILED') AND
  ("mockScenario" IS NULL OR "mockScenario" IN ('SUCCESS','FAILURE','UNKNOWN_SUCCESS','UNKNOWN_FAILURE')) AND
  (status<>'DEMO_CONFIRMED' OR "leaseId" IS NOT NULL) AND
  (status NOT IN ('PENDING','PROCESSING','UNCERTAIN','FAILED') OR "leaseId" IS NULL) AND
  (status NOT IN ('PENDING','PROCESSING','UNCERTAIN') OR ("phoneNumberId" IS NOT NULL AND "mockScenario" IS NOT NULL)) AND
  ((status='PROCESSING' AND "claimToken" IS NOT NULL AND "claimUntil" IS NOT NULL) OR
   (status<>'PROCESSING' AND "claimToken" IS NULL AND "claimUntil" IS NULL)));
CREATE UNIQUE INDEX "Order_pending_phoneNumber_key" ON "Order"("phoneNumberId") WHERE status IN ('PENDING','PROCESSING','UNCERTAIN');
CREATE INDEX "Order_status_claimUntil_idx" ON "Order"(status,"claimUntil");
CREATE INDEX "Order_phoneNumberId_idx" ON "Order"("phoneNumberId");
DROP INDEX "Order_userId_createdAt_idx";
CREATE INDEX "Order_userId_createdAt_id_idx" ON "Order"("userId","createdAt" DESC,id);
DROP INDEX "Message_leaseId_receivedAt_idx";
CREATE INDEX "Message_leaseId_receivedAt_id_idx" ON "Message"("leaseId","receivedAt" DESC,id);

ALTER TABLE "WebhookEvent" ADD COLUMN "payloadHash" TEXT, ADD COLUMN "processedAt" TIMESTAMPTZ(3),
  ADD COLUMN "nextAttemptAt" TIMESTAMPTZ(3), ADD COLUMN "lastError" TEXT, ADD COLUMN "leaseId" UUID,
  ADD COLUMN "conflictCount" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "lastConflictHash" TEXT, ADD COLUMN "lastConflictAt" TIMESTAMPTZ(3);
-- Existing provider payload contracts are unknown. Do not invent hashes, routes or processing outcomes.
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_attempts_check" CHECK (attempts>=0 AND "conflictCount">=0);
CREATE INDEX "WebhookEvent_status_nextAttemptAt_idx" ON "WebhookEvent"(status,"nextAttemptAt");
ALTER TABLE "AuditLog" ADD COLUMN details JSONB;

-- Validate a number's final transaction state, allowing reserve -> lease -> confirm in one transaction.
-- occupied=true without a known owner requires an explicit quarantine reason.
CREATE FUNCTION once_check_occupancy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phone_id uuid; target_ids uuid[]; held_count integer; pending_count integer; occupied_value boolean; reason text;
BEGIN
  IF TG_TABLE_NAME='PhoneNumber' THEN
    IF TG_OP='DELETE' THEN target_ids:=ARRAY[OLD.id];
    ELSIF TG_OP='INSERT' THEN target_ids:=ARRAY[NEW.id]; ELSE target_ids:=ARRAY[OLD.id,NEW.id]; END IF;
  ELSE
    IF TG_OP='DELETE' THEN target_ids:=ARRAY[OLD."phoneNumberId"];
    ELSIF TG_OP='INSERT' THEN target_ids:=ARRAY[NEW."phoneNumberId"]; ELSE target_ids:=ARRAY[OLD."phoneNumberId",NEW."phoneNumberId"]; END IF;
  END IF;
  FOR phone_id IN SELECT DISTINCT unnest(target_ids) ORDER BY 1 LOOP
    IF phone_id IS NULL THEN CONTINUE; END IF;
    SELECT p.occupied,p."holdReason" INTO occupied_value,reason FROM "PhoneNumber" p WHERE p.id=phone_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT count(*) INTO held_count FROM "Lease" WHERE "phoneNumberId"=phone_id AND status IN ('ACTIVE','EXPIRED_HELD');
    SELECT count(*) INTO pending_count FROM "Order" WHERE "phoneNumberId"=phone_id AND status IN ('PENDING','PROCESSING','UNCERTAIN');
    IF held_count+pending_count>1 OR (held_count+pending_count>0 AND NOT occupied_value) OR
       (held_count+pending_count=0 AND occupied_value AND reason IS NULL) OR
       (pending_count>0 AND reason IS DISTINCT FROM 'MOCK_ORDER_PENDING') THEN
      RAISE EXCEPTION 'Number occupancy invariant violated for %',phone_id USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "PhoneNumber_occupancy_check" AFTER INSERT OR UPDATE OR DELETE ON "PhoneNumber" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION once_check_occupancy();
CREATE CONSTRAINT TRIGGER "Lease_occupancy_check" AFTER INSERT OR UPDATE OR DELETE ON "Lease" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION once_check_occupancy();
CREATE CONSTRAINT TRIGGER "Order_occupancy_check" AFTER INSERT OR UPDATE OR DELETE ON "Order" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION once_check_occupancy();

-- The account on an order must agree with its historical lease, independently of current inventory ownership.
CREATE FUNCTION once_check_order_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW."userId",NEW."phoneNumberId",NEW."numberSnapshot",NEW.kind,NEW."termDays",NEW."amountMinor",NEW.currency,NEW."idempotencyKey",NEW."requestHash",NEW."createdAt",NEW."mockScenario")
       IS DISTINCT FROM (OLD."userId",OLD."phoneNumberId",OLD."numberSnapshot",OLD.kind,OLD."termDays",OLD."amountMinor",OLD.currency,OLD."idempotencyKey",OLD."requestHash",OLD."createdAt",OLD."mockScenario") THEN
      RAISE EXCEPTION 'Order request and commercial snapshot are immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.status<>NEW.status AND NOT (
      (OLD.status='PENDING' AND NEW.status='PROCESSING') OR
      (OLD.status='PROCESSING' AND NEW.status IN ('UNCERTAIN','DEMO_CONFIRMED','FAILED')) OR
      (OLD.status='UNCERTAIN' AND NEW.status='PROCESSING')) THEN
      RAISE EXCEPTION 'Invalid order state transition: % -> %',OLD.status,NEW.status USING ERRCODE='23514';
    END IF;
    IF OLD."leaseId" IS NOT NULL AND OLD."leaseId" IS DISTINCT FROM NEW."leaseId" THEN
      RAISE EXCEPTION 'Delivered order lease is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW."leaseId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Lease" l WHERE l.id=NEW."leaseId" AND l."userId"=NEW."userId" AND l."phoneNumberId"=NEW."phoneNumberId") THEN
    RAISE EXCEPTION 'Order/lease ownership mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Order_owner_check" BEFORE INSERT OR UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION once_check_order_owner();

CREATE FUNCTION once_keep_lease_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."userId",NEW."phoneNumberId",NEW."startedAt") IS DISTINCT FROM (OLD."userId",OLD."phoneNumberId",OLD."startedAt") THEN
    RAISE EXCEPTION 'Historical lease identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>NEW.status AND NOT ((OLD.status='ACTIVE' AND NEW.status IN ('EXPIRED_HELD','RELEASED')) OR
    (OLD.status='EXPIRED_HELD' AND NEW.status='RELEASED')) THEN
    RAISE EXCEPTION 'Invalid lease state transition: % -> %',OLD.status,NEW.status USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Lease_identity_check" BEFORE UPDATE ON "Lease" FOR EACH ROW EXECUTE FUNCTION once_keep_lease_identity();
CREATE FUNCTION once_keep_message_lease() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."leaseId" IS DISTINCT FROM OLD."leaseId" THEN
    RAISE EXCEPTION 'Historical SMS lease cannot be reassigned' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Message_lease_identity_check" BEFORE UPDATE ON "Message" FOR EACH ROW EXECUTE FUNCTION once_keep_message_lease();
COMMIT;
