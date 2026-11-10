BEGIN;
SET LOCAL lock_timeout = '5s';

-- Sellable rental terms, seeded with the prices previously hard-coded in business.ts.
CREATE TABLE "Plan" (
  "id" UUID NOT NULL,
  "days" INTEGER NOT NULL,
  "priceMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "label" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Plan_values_check" CHECK ("days" BETWEEN 1 AND 365 AND "priceMinor" BETWEEN 0 AND 100000000 AND btrim("label") <> '')
);
CREATE UNIQUE INDEX "Plan_days_key" ON "Plan"("days");
CREATE INDEX "Plan_active_sortOrder_idx" ON "Plan"("active", "sortOrder");
INSERT INTO "Plan" ("id","days","priceMinor","currency","label","note","active","sortOrder","updatedAt") VALUES
  ('8a0e5f3e-7b1d-4c2a-9f6e-000000000007', 7, 1200, 'USD', '短期使用', '适合临时项目或验证', true, 10, CURRENT_TIMESTAMP),
  ('8a0e5f3e-7b1d-4c2a-9f6e-000000000030', 30, 3500, 'USD', '整月独享', '每天约 $1.17，更省心', true, 20, CURRENT_TIMESTAMP);

CREATE TABLE "AppSetting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- Where each number came from, plus an operator note.
ALTER TABLE "PhoneNumber" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'SEED', ADD COLUMN "note" TEXT;
UPDATE "PhoneNumber" SET "source" = 'SYNC' WHERE provider = 'pingcode';
ALTER TABLE "PhoneNumber" ADD CONSTRAINT "PhoneNumber_source_check" CHECK ("source" IN ('SEED','ADMIN','SYNC'));

-- Terms now come from Plan rows instead of a fixed 7/30 list.
ALTER TABLE "Lease" DROP CONSTRAINT "Lease_lifecycle_check";
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_lifecycle_check" CHECK (
  "termDays" BETWEEN 1 AND 365 AND "priceMinor">=0 AND "expiresAt">"startedAt" AND
  ((status='ACTIVE' AND "endedAt" IS NULL) OR
   (status='EXPIRED_HELD' AND "endedAt" IS NOT NULL AND "endedAt"="expiresAt") OR
   (status IN ('RELEASED','ENDED') AND "endedAt" IS NOT NULL AND "endedAt">="startedAt" AND "endedAt"<="expiresAt")));

-- Admin activations and extensions may record an offline payment, so their amount is no longer forced to 0.
ALTER TABLE "Order" DROP CONSTRAINT "Order_workflow_check";
ALTER TABLE "Order" ADD CONSTRAINT "Order_workflow_check" CHECK (
  kind IN ('RENT','RENEW','ADMIN_ASSIGN','ADMIN_EXTEND') AND "termDays" BETWEEN 1 AND 365 AND "amountMinor">=0 AND attempts>=0 AND
  status IN ('PENDING','PROCESSING','UNCERTAIN','DEMO_CONFIRMED','FAILED','COMPLETED') AND
  ("mockScenario" IS NULL OR "mockScenario" IN ('SUCCESS','FAILURE','UNKNOWN_SUCCESS','UNKNOWN_FAILURE')) AND
  ((kind IN ('ADMIN_ASSIGN','ADMIN_EXTEND') AND "leaseId" IS NOT NULL AND status='COMPLETED' AND "mockScenario" IS NULL) OR
   (kind IN ('RENT','RENEW') AND
    (status<>'DEMO_CONFIRMED' OR "leaseId" IS NOT NULL) AND
    (status NOT IN ('PENDING','PROCESSING','UNCERTAIN','FAILED') OR "leaseId" IS NULL) AND
    (status NOT IN ('PENDING','PROCESSING','UNCERTAIN') OR ("phoneNumberId" IS NOT NULL AND "mockScenario" IS NOT NULL)))) AND
  ((status='PROCESSING' AND "claimToken" IS NOT NULL AND "claimUntil" IS NOT NULL) OR
   (status<>'PROCESSING' AND "claimToken" IS NULL AND "claimUntil" IS NULL)));

COMMIT;
