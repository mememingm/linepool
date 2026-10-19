-- Keep existing catalog rows aligned with the short-term receiving service product.
UPDATE offers
SET name = CASE duration_days
  WHEN 7 THEN '7 天短期服务'
  WHEN 30 THEN '30 天短期服务'
  ELSE name
END
WHERE duration_days IN (7, 30);
