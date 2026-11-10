-- Historical evidence is authoritative only when it agrees with immutable SMS ownership.
ALTER TABLE sms_messages ADD COLUMN allocation_id uuid;
ALTER TABLE number_allocations ADD CONSTRAINT allocation_identity UNIQUE(id,number_id,user_id);
ALTER TABLE sms_messages ADD CONSTRAINT sms_allocation_identity
  FOREIGN KEY(allocation_id,number_id,user_id) REFERENCES number_allocations(id,number_id,user_id);

CREATE VIEW sms_allocation_resolution AS
SELECT m.id AS message_id,
  CASE WHEN p.message_id IS NOT NULL THEN
    CASE WHEN a.number_id=m.number_id AND a.user_id=m.user_id THEN p.allocation_id END
    WHEN c.matches=1 THEN c.allocation_id END AS allocation_id,
  CASE WHEN p.message_id IS NOT NULL THEN
    CASE WHEN a.number_id=m.number_id AND a.user_id=m.user_id THEN 'RECEIPT' ELSE 'RECEIPT_CONFLICT' END
    WHEN c.matches=1 THEN 'INTERVAL' WHEN c.matches>1 THEN 'AMBIGUOUS' ELSE 'UNMATCHED' END AS resolution,
  c.matches AS interval_matches
FROM sms_messages m
LEFT JOIN provider_message_receipts p ON p.message_id=m.id
LEFT JOIN number_allocations a ON a.id=p.allocation_id
LEFT JOIN LATERAL (
  SELECT count(*) AS matches,(array_agg(h.id ORDER BY h.id))[1] AS allocation_id
  FROM number_allocations h WHERE h.number_id=m.number_id AND h.user_id=m.user_id
    AND m.received_at>=h.assigned_at
    AND m.received_at<LEAST(h.expires_at,COALESCE(h.released_at,h.expires_at))
) c ON true;

-- Preserve the pre-backfill counts as a migration artifact; no message content is copied.
CREATE TABLE sms_allocation_backfill_summary AS
SELECT resolution,count(*)::bigint AS message_count,now() AS recorded_at
FROM sms_allocation_resolution GROUP BY resolution;
UPDATE sms_messages m SET allocation_id=r.allocation_id
FROM sms_allocation_resolution r WHERE r.message_id=m.id AND r.allocation_id IS NOT NULL;
CREATE INDEX sms_allocation_received ON sms_messages(allocation_id,received_at DESC,id DESC);
CREATE INDEX sms_allocation_unread ON sms_messages(allocation_id) WHERE NOT is_read;
CREATE INDEX allocations_interval_lookup ON number_allocations(number_id,user_id,assigned_at,expires_at);

CREATE FUNCTION guard_sms_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate uuid; matches bigint;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.number_id IS DISTINCT FROM OLD.number_id
       OR NEW.received_at IS DISTINCT FROM OLD.received_at
       OR (OLD.allocation_id IS NOT NULL AND NEW.allocation_id IS DISTINCT FROM OLD.allocation_id) THEN
      RAISE EXCEPTION 'SMS historical ownership is immutable';
    END IF;
  END IF;
  IF NEW.allocation_id IS NULL AND TG_OP='INSERT' THEN
    SELECT count(*),(array_agg(a.id ORDER BY a.id))[1] INTO matches,candidate
    FROM number_allocations a WHERE a.number_id=NEW.number_id AND a.user_id=NEW.user_id
      AND NEW.received_at>=a.assigned_at
      AND NEW.received_at<LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at));
    IF matches=1 THEN NEW.allocation_id:=candidate; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sms_allocation_guard BEFORE INSERT OR UPDATE ON sms_messages
FOR EACH ROW EXECUTE FUNCTION guard_sms_allocation();

CREATE FUNCTION guard_receipt_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE message sms_messages%ROWTYPE; allocation number_allocations%ROWTYPE;
BEGIN
  SELECT * INTO message FROM sms_messages WHERE id=NEW.message_id FOR UPDATE;
  SELECT * INTO allocation FROM number_allocations WHERE id=NEW.allocation_id;
  IF allocation.id IS NULL OR message.id IS NULL OR allocation.number_id<>message.number_id
     OR allocation.user_id<>message.user_id
     OR (message.allocation_id IS NOT NULL AND message.allocation_id<>NEW.allocation_id) THEN
    RAISE EXCEPTION 'Receipt allocation conflicts with SMS ownership';
  END IF;
  UPDATE sms_messages SET allocation_id=NEW.allocation_id WHERE id=NEW.message_id AND allocation_id IS NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER receipt_allocation_guard BEFORE INSERT OR UPDATE ON provider_message_receipts
FOR EACH ROW EXECUTE FUNCTION guard_receipt_allocation();
