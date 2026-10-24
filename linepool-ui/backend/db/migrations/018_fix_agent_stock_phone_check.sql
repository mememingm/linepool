-- Fix the E.164 check introduced with an over-escaped plus sign in 017.
ALTER TABLE agent_number_stock DROP CONSTRAINT IF EXISTS agent_number_stock_phone_number_check;
ALTER TABLE agent_number_stock ADD CONSTRAINT agent_number_stock_phone_number_check
  CHECK (phone_number ~ '^\+[1-9][0-9]{6,14}$');
