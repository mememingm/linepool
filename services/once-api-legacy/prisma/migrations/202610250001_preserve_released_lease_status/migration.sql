BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "Lease" DROP CONSTRAINT "Lease_lifecycle_check";
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_lifecycle_check" CHECK (
  "termDays" IN (7,30) AND "priceMinor">=0 AND "expiresAt">"startedAt" AND
  ((status='ACTIVE' AND "endedAt" IS NULL) OR
   (status='EXPIRED_HELD' AND "endedAt" IS NOT NULL AND "endedAt"="expiresAt") OR
   (status IN ('RELEASED','ENDED') AND "endedAt" IS NOT NULL AND "endedAt">="startedAt" AND "endedAt"<="expiresAt")));

CREATE OR REPLACE FUNCTION once_keep_lease_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."userId",NEW."phoneNumberId",NEW."startedAt") IS DISTINCT FROM (OLD."userId",OLD."phoneNumberId",OLD."startedAt") THEN
    RAISE EXCEPTION 'Historical lease identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>NEW.status AND NOT ((OLD.status='ACTIVE' AND NEW.status IN ('EXPIRED_HELD','RELEASED','ENDED')) OR
    (OLD.status='EXPIRED_HELD' AND NEW.status IN ('RELEASED','ENDED'))) THEN
    RAISE EXCEPTION 'Invalid lease state transition: % -> %',OLD.status,NEW.status USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
