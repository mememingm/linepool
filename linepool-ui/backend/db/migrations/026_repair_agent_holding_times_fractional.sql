-- The initial repair window was one minute too narrow for rows created with
-- fractional seconds. Complete the same targeted eight-hour shift for those rows.
UPDATE number_holdings
SET starts_at = created_at,
    expires_at = expires_at + (created_at - starts_at)
WHERE created_at > starts_at
  AND created_at - starts_at BETWEEN interval '8 hours' AND interval '8 hours 2 minutes'
  AND expires_at IS NOT NULL;
