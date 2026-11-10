-- Isolated Mock integration metadata only. Existing numbers, orders and messages are preserved.
CREATE TABLE provider_resource_bindings (
  provider text NOT NULL CHECK (provider='pingcode-mock'),
  external_number_id text NOT NULL,
  number_id uuid NOT NULL REFERENCES phone_numbers(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,external_number_id), UNIQUE(provider,number_id)
);
CREATE TABLE provider_message_receipts (
  provider text NOT NULL CHECK (provider='pingcode-mock'),
  external_message_id text NOT NULL,
  message_id uuid NOT NULL UNIQUE REFERENCES sms_messages(id),
  allocation_id uuid NOT NULL REFERENCES number_allocations(id),
  fingerprint text NOT NULL,
  upstream_created_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,external_message_id)
);
CREATE TABLE provider_event_receipts (
  provider text NOT NULL,
  event_id text NOT NULL,
  external_message_id text NOT NULL,
  PRIMARY KEY(provider,event_id),
  FOREIGN KEY(provider,external_message_id) REFERENCES provider_message_receipts(provider,external_message_id)
);
