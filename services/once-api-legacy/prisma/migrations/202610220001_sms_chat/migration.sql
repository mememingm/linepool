BEGIN;
SET LOCAL lock_timeout = '5s';
-- Preserve original receive times and identities. Browser-only read marks cannot be backfilled reliably.
ALTER TABLE "Message" ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "readAt" TIMESTAMPTZ(3);
CREATE INDEX "Message_lease_ingestion_idx" ON "Message"("leaseId", "createdAt");
CREATE INDEX "Message_lease_unread_idx" ON "Message"("leaseId") WHERE "readAt" IS NULL;
COMMIT;
