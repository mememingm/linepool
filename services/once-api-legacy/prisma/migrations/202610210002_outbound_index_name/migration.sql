BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER INDEX "OutboundMessage_provider_providerAccountId_providerMessageId_ke" RENAME TO "OutboundMessage_provider_identity_key";
COMMIT;
