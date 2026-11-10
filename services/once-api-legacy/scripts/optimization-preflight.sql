-- Read-only report, compatible with both the original and upgraded schemas.
-- Counts classify existing identity links; timestamps are flagged separately and never used to reassign SMS.
WITH duplicate_phones AS (
  SELECT "phoneNumberId",count(*) AS n FROM "Lease" GROUP BY "phoneNumberId" HAVING count(*)>1
), lease_stats AS (
  SELECT count(*) AS total,
    count(*) FILTER (WHERE d."phoneNumberId" IS NOT NULL) AS ambiguous,
    count(*) FILTER (WHERE p.id IS NULL) AS unmatched,
    count(*) FILTER (WHERE p.id IS NOT NULL AND d."phoneNumberId" IS NULL) AS deterministic,
    count(*) FILTER (WHERE l."expiresAt"<=l."startedAt" OR l."termDays" NOT IN(7,30) OR l."priceMinor"<0) AS invalid,
    count(*) FILTER (WHERE NOT p.occupied) AS occupancy_to_hold,
    count(*) FILTER (WHERE l."expiresAt"<=CURRENT_TIMESTAMP) AS expired_to_hold
  FROM "Lease" l LEFT JOIN "PhoneNumber" p ON p.id=l."phoneNumberId" LEFT JOIN duplicate_phones d ON d."phoneNumberId"=l."phoneNumberId"
), order_stats AS (
  SELECT count(*) AS total,
    count(*) FILTER (WHERE l.id IS NULL) AS unmatched,
    count(*) FILTER (WHERE l.id IS NOT NULL AND (o."userId"<>l."userId" OR o."termDays" NOT IN(7,30) OR o."amountMinor"<0 OR o.kind NOT IN('RENT','RENEW') OR o.status<>'DEMO_CONFIRMED')) AS invalid,
    count(*) FILTER (WHERE l.id IS NOT NULL AND o."userId"=l."userId" AND o."termDays" IN(7,30) AND o."amountMinor">=0 AND o.kind IN('RENT','RENEW') AND o.status='DEMO_CONFIRMED') AS deterministic
  FROM "Order" o LEFT JOIN "Lease" l ON l.id=o."leaseId"
), message_stats AS (
  SELECT count(*) AS total,count(*) FILTER(WHERE l.id IS NOT NULL) AS deterministic,
    count(*) FILTER(WHERE l.id IS NULL) AS unmatched,
    count(*) FILTER(WHERE m."receivedAt"<l."startedAt" OR m."receivedAt">=l."expiresAt") AS outside_window_preserved
  FROM "Message" m LEFT JOIN "Lease" l ON l.id=m."leaseId"
), legacy_hold AS (
  SELECT count(*) AS occupied_without_lease FROM "PhoneNumber" p WHERE p.occupied AND NOT EXISTS(SELECT 1 FROM "Lease" l WHERE l."phoneNumberId"=p.id)
)
SELECT jsonb_build_object(
  'leases',to_jsonb(lease_stats),
  'orders',to_jsonb(order_stats)||jsonb_build_object('ambiguous',0),
  'messages',to_jsonb(message_stats)||jsonb_build_object('ambiguous',0),
  'inventory',to_jsonb(legacy_hold),
  'blockersBeforeMigration',lease_stats.ambiguous+lease_stats.unmatched+lease_stats.invalid+order_stats.unmatched+order_stats.invalid+message_stats.unmatched,
  'scope','Migration 202610190001 preflight. After adoption, legitimate nullable pending orders or archived multiple leases require the upgraded lifecycle interpretation; do not reapply the old backfill.'
) AS report FROM lease_stats,order_stats,message_stats,legacy_hold;
