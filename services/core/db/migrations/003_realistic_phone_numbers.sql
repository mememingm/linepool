ALTER TABLE phone_numbers DROP CONSTRAINT phone_numbers_phone_number_check;

WITH generated AS (
  SELECT
    id,
    region_id,
    translate(substr(md5(id::text), 1, 10), 'abcdef', '123456') AS digits
  FROM phone_numbers
  WHERE phone_number LIKE '% DEMO %'
)
UPDATE phone_numbers AS numbers
SET phone_number = CASE generated.region_id
  WHEN 'us' THEN '+1959' || substr(generated.digits, 1, 7)
  WHEN 'ca' THEN '+1647' || substr(generated.digits, 1, 7)
  WHEN 'gb' THEN '+44740' || substr(generated.digits, 1, 7)
  WHEN 'sg' THEN '+6581' || substr(generated.digits, 1, 6)
  WHEN 'de' THEN '+49151' || substr(generated.digits, 1, 7)
  WHEN 'nl' THEN '+31620' || substr(generated.digits, 1, 6)
  ELSE numbers.phone_number
END
FROM generated
WHERE numbers.id = generated.id;

ALTER TABLE phone_numbers ADD CONSTRAINT phone_numbers_phone_number_format_check
  CHECK (phone_number ~ '^\+[1-9][0-9]{6,14}$');
