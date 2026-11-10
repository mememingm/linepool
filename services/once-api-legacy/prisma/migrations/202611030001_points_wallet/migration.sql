-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "fundsStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "pointsAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quoteVersion" INTEGER,
ADD COLUMN     "reservationId" UUID,
ADD COLUMN     "settlementType" TEXT NOT NULL DEFAULT 'LEGACY';

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "pointsPrice" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "PointAccount" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "availablePoints" INTEGER NOT NULL DEFAULT 0,
    "frozenPoints" INTEGER NOT NULL DEFAULT 0,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "PointAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointLot" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "rechargeId" UUID,
    "source" TEXT NOT NULL,
    "issuedPoints" INTEGER NOT NULL,
    "availablePoints" INTEGER NOT NULL,
    "frozenPoints" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "pointsPerMinor" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointLedger" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "availableDelta" INTEGER NOT NULL,
    "frozenDelta" INTEGER NOT NULL,
    "availableAfter" INTEGER NOT NULL,
    "frozenAfter" INTEGER NOT NULL,
    "actorId" UUID,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointReservation" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "refundedPoints" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PointReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointAllocation" (
    "id" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "refundedPoints" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PointAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RechargeOrder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "points" INTEGER NOT NULL,
    "pointsPerMinor" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "environment" TEXT NOT NULL,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "refundReservedMinor" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "purchaseIntentId" UUID,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "creditedAt" TIMESTAMPTZ(3),
    "latePayment" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RechargeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" UUID NOT NULL,
    "rechargeId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "scenario" TEXT NOT NULL DEFAULT 'SUCCESS',
    "checkoutUrl" TEXT,
    "checkedAt" TIMESTAMPTZ(3),
    "claimToken" UUID,
    "claimUntil" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReceipt" (
    "id" UUID NOT NULL,
    "rechargeId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "paidAt" TIMESTAMPTZ(3) NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundOrder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rechargeId" UUID NOT NULL,
    "receiptId" UUID,
    "amountMinor" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "kind" TEXT NOT NULL DEFAULT 'POINTS',
    "reason" TEXT NOT NULL,
    "adminReason" TEXT,
    "actorId" UUID,
    "scenario" TEXT NOT NULL DEFAULT 'SUCCESS',
    "externalId" TEXT,
    "claimToken" UUID,
    "claimUntil" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "reservationId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RefundOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseIntent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT,
    "leaseId" UUID,
    "termDays" INTEGER NOT NULL,
    "quoteVersion" INTEGER NOT NULL,
    "pointsPrice" INTEGER NOT NULL,
    "orderId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PurchaseIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointException" (
    "id" UUID NOT NULL,
    "businessKey" TEXT NOT NULL,
    "userId" UUID,
    "kind" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PointException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PointAccount_userId_key" ON "PointAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PointLot_rechargeId_key" ON "PointLot"("rechargeId");

-- CreateIndex
CREATE INDEX "PointLot_accountId_source_createdAt_id_idx" ON "PointLot"("accountId", "source", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PointLedger_accountId_createdAt_id_idx" ON "PointLedger"("accountId", "createdAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "PointLedger_accountId_sequence_key" ON "PointLedger"("accountId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PointLedger_accountId_kind_businessId_key" ON "PointLedger"("accountId", "kind", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "PointReservation_accountId_kind_businessId_key" ON "PointReservation"("accountId", "kind", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "PointAllocation_reservationId_lotId_key" ON "PointAllocation"("reservationId", "lotId");

-- CreateIndex
CREATE INDEX "RechargeOrder_userId_createdAt_id_idx" ON "RechargeOrder"("userId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "RechargeOrder_status_expiresAt_idx" ON "RechargeOrder"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RechargeOrder_userId_idempotencyKey_key" ON "RechargeOrder"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_rechargeId_key" ON "PaymentAttempt"("rechargeId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_provider_merchant_externalId_key" ON "PaymentAttempt"("provider", "merchant", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReceipt_provider_merchant_transactionId_key" ON "PaymentReceipt"("provider", "merchant", "transactionId");

-- CreateIndex
CREATE INDEX "PaymentEvent_status_createdAt_idx" ON "PaymentEvent"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_provider_merchant_eventId_key" ON "PaymentEvent"("provider", "merchant", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundOrder_reservationId_key" ON "RefundOrder"("reservationId");

-- CreateIndex
CREATE INDEX "RefundOrder_status_createdAt_idx" ON "RefundOrder"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefundOrder_userId_idempotencyKey_key" ON "RefundOrder"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseIntent_orderId_key" ON "PurchaseIntent"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseIntent_userId_createdAt_idx" ON "PurchaseIntent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointException_businessKey_key" ON "PointException"("businessKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_reservationId_key" ON "Order"("reservationId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PointReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAccount" ADD CONSTRAINT "PointAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointLot" ADD CONSTRAINT "PointLot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PointAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointLot" ADD CONSTRAINT "PointLot_rechargeId_fkey" FOREIGN KEY ("rechargeId") REFERENCES "RechargeOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointLedger" ADD CONSTRAINT "PointLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PointAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointReservation" ADD CONSTRAINT "PointReservation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PointAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAllocation" ADD CONSTRAINT "PointAllocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PointReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAllocation" ADD CONSTRAINT "PointAllocation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "PointLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RechargeOrder" ADD CONSTRAINT "RechargeOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RechargeOrder" ADD CONSTRAINT "RechargeOrder_purchaseIntentId_fkey" FOREIGN KEY ("purchaseIntentId") REFERENCES "PurchaseIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_rechargeId_fkey" FOREIGN KEY ("rechargeId") REFERENCES "RechargeOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_rechargeId_fkey" FOREIGN KEY ("rechargeId") REFERENCES "RechargeOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundOrder" ADD CONSTRAINT "RefundOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundOrder" ADD CONSTRAINT "RefundOrder_rechargeId_fkey" FOREIGN KEY ("rechargeId") REFERENCES "RechargeOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundOrder" ADD CONSTRAINT "RefundOrder_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PointReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseIntent" ADD CONSTRAINT "PurchaseIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseIntent" ADD CONSTRAINT "PurchaseIntent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing USD prices become the initial points price; historical orders remain LEGACY.
UPDATE "Plan" SET "pointsPrice" = "priceMinor" WHERE "currency" = 'USD';
INSERT INTO "PointAccount" ("id", "userId") SELECT gen_random_uuid(), "id" FROM "User";

ALTER TABLE "PointAccount" ADD CONSTRAINT "PointAccount_balances_check" CHECK (
  "availablePoints" BETWEEN 0 AND 1000000000 AND "frozenPoints" BETWEEN 0 AND 1000000000 AND "sequence" >= 0 AND "status" IN ('ACTIVE','REVIEW'));
ALTER TABLE "PointLot" ADD CONSTRAINT "PointLot_amounts_check" CHECK (
  "issuedPoints" BETWEEN 1 AND 1000000000 AND "availablePoints" >= 0 AND "frozenPoints" >= 0 AND
  "availablePoints"::bigint + "frozenPoints" <= "issuedPoints" AND "currency"='USD' AND "pointsPerMinor"=1 AND "source" IN ('PAID','DEMO','COMPENSATION') AND
  (("source"='COMPENSATION' AND "rechargeId" IS NULL) OR ("source" IN ('PAID','DEMO') AND "rechargeId" IS NOT NULL)));
ALTER TABLE "PointLedger" ADD CONSTRAINT "PointLedger_amounts_check" CHECK (
  "sequence">0 AND "availableAfter" BETWEEN 0 AND 1000000000 AND "frozenAfter" BETWEEN 0 AND 1000000000);
ALTER TABLE "PointReservation" ADD CONSTRAINT "PointReservation_amounts_check" CHECK (
  "points" BETWEEN 0 AND 1000000000 AND "refundedPoints" BETWEEN 0 AND "points" AND "kind" IN ('ORDER','REFUND') AND "status" IN ('RESERVED','CAPTURED','RELEASED'));
ALTER TABLE "PointAllocation" ADD CONSTRAINT "PointAllocation_amounts_check" CHECK (
  "points">0 AND "refundedPoints" BETWEEN 0 AND "points");
ALTER TABLE "RechargeOrder" ADD CONSTRAINT "RechargeOrder_amounts_check" CHECK (
  "amountMinor" BETWEEN 1 AND 1000000000 AND "points"="amountMinor" AND "pointsPerMinor"=1 AND "currency"='USD' AND
  "refundedMinor">=0 AND "refundReservedMinor">=0 AND "refundedMinor"::bigint+"refundReservedMinor"<="amountMinor" AND "environment" IN ('DEMO','LIVE'));
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_amount_check" CHECK ("amountMinor">0 AND "currency"='USD');
ALTER TABLE "RefundOrder" ADD CONSTRAINT "RefundOrder_amounts_check" CHECK (
  "amountMinor">0 AND "points">=0 AND (("kind"='POINTS' AND "points"="amountMinor") OR ("kind" IN ('EXCESS','UNAPPLIED') AND "points"=0)));
ALTER TABLE "RefundOrder" ADD CONSTRAINT "RefundOrder_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PaymentReceipt"("id") ON DELETE RESTRICT;
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_points_check" CHECK ("pointsPrice" BETWEEN 0 AND 1000000000 AND "version">0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_points_check" CHECK ("pointsAmount">=0 AND "settlementType" IN ('LEGACY','POINTS','COMPENSATION') AND
  ("settlementType"<>'POINTS' OR ("reservationId" IS NOT NULL AND "pointsAmount">0 AND "quoteVersion">0)));

CREATE FUNCTION "pointLedgerImmutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PointLedger is append-only'; END $$;
CREATE TRIGGER "PointLedger_immutable" BEFORE UPDATE OR DELETE ON "PointLedger" FOR EACH ROW EXECUTE FUNCTION "pointLedgerImmutable"();

-- Reject a forged running balance even if application code accidentally writes an inconsistent entry.
CREATE FUNCTION "pointLedgerCheck"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "PointAccount"; prior "PointLedger";
BEGIN
  SELECT * INTO a FROM "PointAccount" WHERE "id"=NEW."accountId" FOR UPDATE;
  IF a."sequence"<>NEW."sequence" OR a."availablePoints"<>NEW."availableAfter" OR a."frozenPoints"<>NEW."frozenAfter" THEN
    RAISE EXCEPTION 'PointLedger balance does not match PointAccount';
  END IF;
  SELECT * INTO prior FROM "PointLedger" WHERE "accountId"=NEW."accountId" AND "sequence"=NEW."sequence"-1;
  IF (NEW."sequence">1 AND prior."id" IS NULL) OR
     COALESCE(prior."availableAfter",0)::bigint+NEW."availableDelta"<>NEW."availableAfter" OR
     COALESCE(prior."frozenAfter",0)::bigint+NEW."frozenDelta"<>NEW."frozenAfter" THEN
    RAISE EXCEPTION 'PointLedger delta does not match previous balance';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PointLedger_running_balance" BEFORE INSERT ON "PointLedger" FOR EACH ROW EXECUTE FUNCTION "pointLedgerCheck"();

-- Renewals keep their existing lease reference while funds and fulfillment are pending.
ALTER TABLE "Order" DROP CONSTRAINT "Order_workflow_check";
ALTER TABLE "Order" ADD CONSTRAINT "Order_workflow_check" CHECK (
  kind IN ('RENT','RENEW','ADMIN_ASSIGN','ADMIN_EXTEND') AND "termDays" BETWEEN 1 AND 365 AND "amountMinor">=0 AND attempts>=0 AND
  status IN ('PENDING','PROCESSING','UNCERTAIN','DEMO_CONFIRMED','FAILED','COMPLETED') AND
  ("mockScenario" IS NULL OR "mockScenario" IN ('SUCCESS','FAILURE','UNKNOWN_SUCCESS','UNKNOWN_FAILURE')) AND
  ((kind IN ('ADMIN_ASSIGN','ADMIN_EXTEND') AND "leaseId" IS NOT NULL AND status='COMPLETED' AND "mockScenario" IS NULL) OR
   (kind IN ('RENT','RENEW') AND
    (status<>'DEMO_CONFIRMED' OR "leaseId" IS NOT NULL) AND
    (kind<>'RENEW' OR "leaseId" IS NOT NULL) AND
    (kind<>'RENT' OR status NOT IN ('PENDING','PROCESSING','UNCERTAIN','FAILED') OR "leaseId" IS NULL) AND
    (status NOT IN ('PENDING','PROCESSING','UNCERTAIN') OR ("phoneNumberId" IS NOT NULL AND "mockScenario" IS NOT NULL)))) AND
  ((status='PROCESSING' AND "claimToken" IS NOT NULL AND "claimUntil" IS NOT NULL) OR
   (status<>'PROCESSING' AND "claimToken" IS NULL AND "claimUntil" IS NULL)));

-- Rent reserves an empty number; renewal reserves funds against the existing held lease.
CREATE OR REPLACE FUNCTION once_check_occupancy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phone_id uuid; target_ids uuid[]; held_count integer; rent_count integer; pending_count integer; occupied_value boolean; reason text;
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
    SELECT count(*),count(*) FILTER (WHERE kind='RENT') INTO pending_count,rent_count FROM "Order"
      WHERE "phoneNumberId"=phone_id AND status IN ('PENDING','PROCESSING','UNCERTAIN');
    IF held_count+rent_count>1 OR pending_count>1 OR (held_count+rent_count>0 AND NOT occupied_value) OR
       (held_count+rent_count=0 AND occupied_value AND reason IS NULL) OR
       EXISTS (SELECT 1 FROM "Order" o WHERE o."phoneNumberId"=phone_id AND o.kind='RENT' AND o.status IN ('PENDING','PROCESSING','UNCERTAIN')
         AND reason IS DISTINCT FROM CASE WHEN o."settlementType"='POINTS' THEN 'POINTS_ORDER_PENDING' ELSE 'MOCK_ORDER_PENDING' END) OR
       EXISTS (SELECT 1 FROM "Order" o WHERE o."phoneNumberId"=phone_id AND o.kind='RENEW' AND o.status IN ('PENDING','PROCESSING','UNCERTAIN')
         AND NOT EXISTS (SELECT 1 FROM "Lease" l WHERE l.id=o."leaseId" AND l."phoneNumberId"=phone_id AND l."userId"=o."userId" AND l.status IN ('ACTIVE','EXPIRED_HELD'))) THEN
      RAISE EXCEPTION 'Number occupancy invariant violated for %',phone_id USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
