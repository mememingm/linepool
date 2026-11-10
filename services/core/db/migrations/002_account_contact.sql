-- Account contact details are separate from purchased demo phone numbers.
ALTER TABLE users ADD COLUMN phone_number text;
ALTER TABLE users ADD CONSTRAINT users_contact_phone_format
  CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{6,14}$');
