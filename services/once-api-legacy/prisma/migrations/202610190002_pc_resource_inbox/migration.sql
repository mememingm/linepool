BEGIN;
SET LOCAL lock_timeout = '5s';

-- Account-scoped identities preserve legacy/demo rows in the empty-account namespace.
-- Do not invent upstream resource IDs or resource expiry for existing numbers.
ALTER TABLE "PhoneNumber"
  ADD COLUMN "providerAccountId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "providerNumberId" TEXT,
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "resourceExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "lastSyncedAt" TIMESTAMPTZ(3);
ALTER TABLE "PhoneNumber" ADD CONSTRAINT "PhoneNumber_provider_mapping_check" CHECK (
  (("providerAccountId"='' AND "providerNumberId" IS NULL) OR
   (btrim("providerAccountId")<>'' AND "providerNumberId" IS NOT NULL AND btrim("providerNumberId")<>'')) AND
  (provider<>'pingcode' OR "providerAccountId"<>''));
CREATE UNIQUE INDEX "PhoneNumber_provider_account_number_key" ON "PhoneNumber"(provider,"providerAccountId","providerNumberId");
CREATE INDEX "PhoneNumber_provider_inventory_idx" ON "PhoneNumber"(provider,"providerAccountId","providerStatus");

ALTER TABLE "Message" ADD COLUMN "providerAccountId" TEXT NOT NULL DEFAULT '';
DROP INDEX "Message_provider_providerMessageId_key";
CREATE UNIQUE INDEX "Message_provider_account_message_key" ON "Message"(provider,"providerAccountId","providerMessageId");
ALTER TABLE "Message" ADD CONSTRAINT "Message_provider_identity_check" CHECK (
  ("providerAccountId"='' OR (btrim("providerAccountId")<>'' AND "providerMessageId" IS NOT NULL AND btrim("providerMessageId")<>'')) AND
  (provider<>'pingcode' OR "providerAccountId"<>''));

-- Store callbacks before a number/lease can be resolved. Unmatched callbacks retain their raw payload.
ALTER TABLE "WebhookEvent"
  ADD COLUMN "providerAccountId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "providerNumberId" TEXT,
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "occurredAt" TIMESTAMPTZ(3);
DROP INDEX "WebhookEvent_provider_eventId_key";
CREATE UNIQUE INDEX "WebhookEvent_provider_account_event_key" ON "WebhookEvent"(provider,"providerAccountId","eventId");
CREATE INDEX "WebhookEvent_leaseId_idx" ON "WebhookEvent"("leaseId");
CREATE INDEX "WebhookEvent_provider_retry_idx" ON "WebhookEvent"(provider,"providerAccountId",status,"nextAttemptAt");
CREATE INDEX "WebhookEvent_number_time_idx" ON "WebhookEvent"(provider,"providerAccountId","providerNumberId","occurredAt");
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_leaseId_fkey"
  FOREIGN KEY ("leaseId") REFERENCES "Lease"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_provider_identity_check" CHECK (
  ("providerAccountId"='' OR btrim("providerAccountId")<>'') AND btrim("eventId")<>'' AND
  (provider<>'pingcode' OR "providerAccountId"<>''));
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_live_processed_check" CHECK (
  "providerAccountId"='' OR status<>'PROCESSED' OR ("leaseId" IS NOT NULL AND "processedAt" IS NOT NULL));

-- Inclusive start / exclusive end: back-to-back leases are allowed, overlaps are not.
-- endedAt is the actual end for an early release; historical message ownership is unchanged.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_number_service_window_excl"
  EXCLUDE USING gist ("phoneNumberId" WITH =,
    tstzrange("startedAt",COALESCE("endedAt","expiresAt"),'[)') WITH &&)
  DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "Lease_number_window_idx" ON "Lease"("phoneNumberId","startedAt","expiresAt");

-- A live purchase/renewal cannot outlast confirmed upstream resource coverage.
CREATE FUNCTION once_check_lease_resource() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource "PhoneNumber"%ROWTYPE;
BEGIN
  SELECT * INTO resource FROM "PhoneNumber" WHERE id=NEW."phoneNumberId" FOR SHARE;
  IF resource."providerAccountId"<>'' AND
     (resource."resourceExpiresAt" IS NULL OR NEW."expiresAt">resource."resourceExpiresAt") THEN
    RAISE EXCEPTION 'Lease exceeds confirmed provider resource expiry' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Lease_provider_resource_check" BEFORE INSERT OR UPDATE OF "expiresAt" ON "Lease"
  FOR EACH ROW EXECUTE FUNCTION once_check_lease_resource();

-- Once leased, a resource cannot be relabelled as a different account/number.
CREATE FUNCTION once_keep_phone_provider_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.number,NEW.provider,NEW."providerAccountId",NEW."providerNumberId") IS DISTINCT FROM
     (OLD.number,OLD.provider,OLD."providerAccountId",OLD."providerNumberId") AND
     EXISTS(SELECT 1 FROM "Lease" WHERE "phoneNumberId"=OLD.id) THEN
    RAISE EXCEPTION 'Leased number provider identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PhoneNumber_provider_identity_check" BEFORE UPDATE ON "PhoneNumber"
  FOR EACH ROW EXECUTE FUNCTION once_keep_phone_provider_identity();

-- Live messages and matched callbacks must agree with the historical lease's account
-- and service window. Legacy/demo records are intentionally not reclassified.
CREATE FUNCTION once_check_provider_lease() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource "PhoneNumber"%ROWTYPE; service "Lease"%ROWTYPE; event_time timestamptz;
BEGIN
  IF NEW."providerAccountId"='' OR NEW."leaseId" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO service FROM "Lease" WHERE id=NEW."leaseId";
  SELECT * INTO resource FROM "PhoneNumber" WHERE id=service."phoneNumberId" FOR SHARE;
  IF NOT FOUND OR (NEW.provider,NEW."providerAccountId") IS DISTINCT FROM (resource.provider,resource."providerAccountId") THEN
    RAISE EXCEPTION 'Provider account does not match lease' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='Message' THEN event_time:=NEW."receivedAt";
  ELSE
    IF NEW."providerNumberId" IS DISTINCT FROM resource."providerNumberId" THEN
      RAISE EXCEPTION 'Provider number does not match lease' USING ERRCODE='23514';
    END IF;
    event_time:=NEW."occurredAt";
  END IF;
  IF event_time IS NULL OR event_time<service."startedAt" OR event_time>=COALESCE(service."endedAt",service."expiresAt") THEN
    RAISE EXCEPTION 'Provider event is outside lease window' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Message_provider_lease_check" BEFORE INSERT OR UPDATE ON "Message"
  FOR EACH ROW EXECUTE FUNCTION once_check_provider_lease();
CREATE TRIGGER "WebhookEvent_provider_lease_check" BEFORE INSERT OR UPDATE ON "WebhookEvent"
  FOR EACH ROW EXECUTE FUNCTION once_check_provider_lease();

COMMIT;
