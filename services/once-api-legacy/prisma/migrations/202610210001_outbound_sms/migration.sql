BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE "OutboundMessage" (
  id UUID NOT NULL PRIMARY KEY,
  "leaseId" UUID NOT NULL REFERENCES "Lease"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  content TEXT NOT NULL,
  provider TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL DEFAULT '',
  "providerMessageId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  "providerStatus" TEXT,
  "lastError" TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  "claimToken" UUID,
  "claimUntil" TIMESTAMPTZ(3),
  "lastCheckedAt" TIMESTAMPTZ(3),
  "lastEventAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "OutboundMessage_content_check" CHECK (length(content) BETWEEN 1 AND 4000 AND length(btrim(content))>0),
  CONSTRAINT "OutboundMessage_recipient_check" CHECK ("to" ~ '^\+?[0-9]{2,32}$'),
  CONSTRAINT "OutboundMessage_status_check" CHECK (status IN ('PENDING','SUBMITTING','QUEUED','SENDING','SENT','DELIVERED','UNDELIVERABLE','FAILED','UNCERTAIN')),
  CONSTRAINT "OutboundMessage_identity_check" CHECK (
    length("idempotencyKey") BETWEEN 1 AND 120 AND
    ((provider='demo' AND "providerAccountId"='') OR (provider='pingcode' AND btrim("providerAccountId")<>'')))
);
CREATE UNIQUE INDEX "OutboundMessage_leaseId_idempotencyKey_key" ON "OutboundMessage"("leaseId","idempotencyKey");
CREATE UNIQUE INDEX "OutboundMessage_provider_providerAccountId_providerMessageId_key" ON "OutboundMessage"(provider,"providerAccountId","providerMessageId");
CREATE INDEX "OutboundMessage_leaseId_createdAt_id_idx" ON "OutboundMessage"("leaseId","createdAt" DESC,id);
CREATE INDEX "OutboundMessage_status_claimUntil_lastCheckedAt_idx" ON "OutboundMessage"(status,"claimUntil","lastCheckedAt");

ALTER TABLE "WebhookEvent" ADD COLUMN "outboundMessageId" UUID;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_outboundMessageId_fkey"
  FOREIGN KEY ("outboundMessageId") REFERENCES "OutboundMessage"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "WebhookEvent_outboundMessageId_idx" ON "WebhookEvent"("outboundMessageId");

CREATE FUNCTION once_check_outbound_lease() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE service "Lease"%ROWTYPE; resource "PhoneNumber"%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW."leaseId",NEW."from",NEW."to",NEW.content,NEW.provider,NEW."providerAccountId",NEW."idempotencyKey",NEW."requestHash",NEW."createdAt")
       IS DISTINCT FROM (OLD."leaseId",OLD."from",OLD."to",OLD.content,OLD.provider,OLD."providerAccountId",OLD."idempotencyKey",OLD."requestHash",OLD."createdAt") THEN
      RAISE EXCEPTION 'Outbound request identity is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD."providerMessageId" IS NOT NULL AND NEW."providerMessageId" IS DISTINCT FROM OLD."providerMessageId" THEN
      RAISE EXCEPTION 'Outbound provider message identity is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO service FROM "Lease" WHERE id=NEW."leaseId";
  SELECT * INTO resource FROM "PhoneNumber" WHERE id=service."phoneNumberId" FOR SHARE;
  IF NOT FOUND OR (NEW.provider,NEW."providerAccountId",NEW."from") IS DISTINCT FROM (resource.provider,resource."providerAccountId",resource.number) OR
     NEW."createdAt"<service."startedAt" OR NEW."createdAt">=COALESCE(service."endedAt",service."expiresAt") THEN
    RAISE EXCEPTION 'Outbound request does not match original lease' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "OutboundMessage_lease_check" BEFORE INSERT OR UPDATE ON "OutboundMessage"
  FOR EACH ROW EXECUTE FUNCTION once_check_outbound_lease();

-- Send receipts belong to the original sending task, even after its lease expires.
-- Inbound callbacks continue to use the original reception-time service window.
CREATE OR REPLACE FUNCTION once_check_provider_lease() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource "PhoneNumber"%ROWTYPE; service "Lease"%ROWTYPE; sent "OutboundMessage"%ROWTYPE; event_time timestamptz;
BEGIN
  IF TG_TABLE_NAME='WebhookEvent' THEN
    IF NEW."outboundMessageId" IS NOT NULL THEN
      SELECT * INTO sent FROM "OutboundMessage" WHERE id=NEW."outboundMessageId";
      IF NOT FOUND OR NEW."leaseId" IS DISTINCT FROM sent."leaseId" OR
         (NEW.provider,NEW."providerAccountId",NEW."providerMessageId") IS DISTINCT FROM (sent.provider,sent."providerAccountId",sent."providerMessageId") THEN
        RAISE EXCEPTION 'Send receipt does not match original outbound task' USING ERRCODE='23514';
      END IF;
      SELECT * INTO service FROM "Lease" WHERE id=sent."leaseId";
      SELECT * INTO resource FROM "PhoneNumber" WHERE id=service."phoneNumberId";
      IF NEW."providerNumberId" IS DISTINCT FROM resource."providerNumberId" THEN
        RAISE EXCEPTION 'Send receipt number does not match original outbound task' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
  END IF;
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

COMMIT;
