BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "User"
  ADD COLUMN "role" TEXT NOT NULL DEFAULT 'USER',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "lastLoginAt" TIMESTAMPTZ(3);
ALTER TABLE "User" ADD CONSTRAINT "User_role_check" CHECK ("role" IN ('USER','ADMIN'));
ALTER TABLE "User" ADD CONSTRAINT "User_status_check" CHECK ("status" IN ('ACTIVE','DISABLED'));
CREATE INDEX "User_role_status_idx" ON "User"("role","status");

ALTER TABLE "AuditLog"
  ADD COLUMN "targetType" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "reason" TEXT NOT NULL DEFAULT '';
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"(action,"createdAt");

CREATE TABLE "AdminIdempotency" (
  "id" UUID NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "actorId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "requestHash" TEXT NOT NULL,
  "result" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AdminIdempotency_actorId_createdAt_idx" ON "AdminIdempotency"("actorId","createdAt");

UPDATE "Lease" SET status='ENDED' WHERE status='RELEASED';
ALTER TABLE "Lease" DROP CONSTRAINT "Lease_lifecycle_check";
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_lifecycle_check" CHECK (
  "termDays" IN (7,30) AND "priceMinor">=0 AND "expiresAt">"startedAt" AND
  ((status='ACTIVE' AND "endedAt" IS NULL) OR
   (status='EXPIRED_HELD' AND "endedAt" IS NOT NULL AND "endedAt"="expiresAt") OR
   (status='ENDED' AND "endedAt" IS NOT NULL AND "endedAt">="startedAt" AND "endedAt"<="expiresAt")));

CREATE OR REPLACE FUNCTION once_keep_lease_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."userId",NEW."phoneNumberId",NEW."startedAt") IS DISTINCT FROM (OLD."userId",OLD."phoneNumberId",OLD."startedAt") THEN
    RAISE EXCEPTION 'Historical lease identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>NEW.status AND NOT ((OLD.status='ACTIVE' AND NEW.status IN ('EXPIRED_HELD','ENDED')) OR
    (OLD.status='EXPIRED_HELD' AND NEW.status='ENDED')) THEN
    RAISE EXCEPTION 'Invalid lease state transition: % -> %',OLD.status,NEW.status USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE "Order" DROP CONSTRAINT "Order_workflow_check";
ALTER TABLE "Order" ADD CONSTRAINT "Order_workflow_check" CHECK (
  kind IN ('RENT','RENEW','ADMIN_ASSIGN','ADMIN_EXTEND') AND "termDays" IN (7,30) AND "amountMinor">=0 AND attempts>=0 AND
  status IN ('PENDING','PROCESSING','UNCERTAIN','DEMO_CONFIRMED','FAILED','COMPLETED') AND
  ("mockScenario" IS NULL OR "mockScenario" IN ('SUCCESS','FAILURE','UNKNOWN_SUCCESS','UNKNOWN_FAILURE')) AND
  ((kind IN ('ADMIN_ASSIGN','ADMIN_EXTEND') AND "leaseId" IS NOT NULL AND "amountMinor"=0 AND status='COMPLETED' AND "mockScenario" IS NULL) OR
   (kind IN ('RENT','RENEW') AND
    (status<>'DEMO_CONFIRMED' OR "leaseId" IS NOT NULL) AND
    (status NOT IN ('PENDING','PROCESSING','UNCERTAIN','FAILED') OR "leaseId" IS NULL) AND
    (status NOT IN ('PENDING','PROCESSING','UNCERTAIN') OR ("phoneNumberId" IS NOT NULL AND "mockScenario" IS NOT NULL)))) AND
  ((status='PROCESSING' AND "claimToken" IS NOT NULL AND "claimUntil" IS NOT NULL) OR
   (status<>'PROCESSING' AND "claimToken" IS NULL AND "claimUntil" IS NULL)));

COMMIT;
