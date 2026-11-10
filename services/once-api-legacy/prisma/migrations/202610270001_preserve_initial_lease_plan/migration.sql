-- Restore the initial plan from its original successful order. Renewal orders
-- remain the source of truth for each additional term and its charge.
WITH initial_plan AS (
  SELECT DISTINCT ON ("leaseId") "leaseId", "termDays", "amountMinor"
  FROM "Order"
  WHERE "leaseId" IS NOT NULL
    AND kind IN ('RENT', 'ADMIN_ASSIGN')
    AND status IN ('DEMO_CONFIRMED', 'COMPLETED')
  ORDER BY "leaseId", "createdAt", id
)
UPDATE "Lease" AS lease
SET "termDays" = initial_plan."termDays", "priceMinor" = initial_plan."amountMinor"
FROM initial_plan
WHERE lease.id = initial_plan."leaseId"
  AND (lease."termDays", lease."priceMinor") IS DISTINCT FROM (initial_plan."termDays", initial_plan."amountMinor");
