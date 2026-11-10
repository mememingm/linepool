-- Repair the first local inventory records written by the datetime-local conversion bug.
-- The bug stored starts_at and expires_at exactly eight hours before the creation
-- timestamp. Shift only that unmistakable legacy pattern; future records are untouched.
UPDATE number_holdings
SET starts_at = created_at,
    expires_at = expires_at + (created_at - starts_at)
WHERE created_at > starts_at
  AND created_at - starts_at BETWEEN interval '7 hours 59 minutes' AND interval '8 hours 1 minute'
  AND expires_at IS NOT NULL;
