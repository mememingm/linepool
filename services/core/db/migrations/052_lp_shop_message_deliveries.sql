-- LP shop buyer delivery facts: one immutable outcome per provider message receipt.
-- A DELIVERED row must point at the buyer allocation that was valid for the shop at the message occurrence time.
CREATE TABLE shop_message_deliveries (
  provider text NOT NULL,
  external_message_id text NOT NULL,
  shop_id uuid NOT NULL REFERENCES shops(id),
  connection_id uuid NOT NULL REFERENCES upstream_accounts(id),
  number_id uuid NOT NULL REFERENCES phone_numbers(id),
  outcome text NOT NULL CHECK (outcome IN ('DELIVERED','UNMATCHED','AMBIGUOUS','NO_BUYER')),
  platform_id text REFERENCES platforms(id),
  rule_version integer CHECK (rule_version IS NULL OR rule_version > 0),
  allocation_id uuid REFERENCES number_allocations(id),
  sms_message_id uuid UNIQUE REFERENCES sms_messages(id),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_message_id),
  FOREIGN KEY (provider, external_message_id) REFERENCES provider_message_receipts(provider, external_message_id),
  CHECK ((
    (outcome='DELIVERED' AND platform_id IS NOT NULL AND rule_version IS NOT NULL
      AND allocation_id IS NOT NULL AND sms_message_id IS NOT NULL)
    OR (outcome='NO_BUYER' AND platform_id IS NOT NULL AND rule_version IS NOT NULL
      AND allocation_id IS NULL AND sms_message_id IS NULL)
    OR (outcome='AMBIGUOUS' AND allocation_id IS NULL AND sms_message_id IS NULL
      AND ((platform_id IS NULL AND rule_version IS NULL) OR (platform_id IS NOT NULL AND rule_version IS NOT NULL)))
    OR (outcome='UNMATCHED' AND platform_id IS NULL AND rule_version IS NULL
      AND allocation_id IS NULL AND sms_message_id IS NULL)
  ) IS TRUE)
);
CREATE INDEX shop_message_deliveries_created ON shop_message_deliveries(created_at DESC,provider,external_message_id);
CREATE INDEX shop_message_deliveries_outcome ON shop_message_deliveries(outcome,created_at DESC);

CREATE FUNCTION guard_shop_message_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  allocation number_allocations%ROWTYPE;
  purchased orders%ROWTYPE;
  message sms_messages%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'Shop message delivery facts are immutable';
  END IF;
  IF NEW.outcome<>'DELIVERED' THEN RETURN NEW; END IF;
  SELECT * INTO allocation FROM number_allocations WHERE id=NEW.allocation_id;
  SELECT * INTO purchased FROM orders WHERE id=allocation.order_id;
  SELECT * INTO message FROM sms_messages WHERE id=NEW.sms_message_id;
  IF allocation.id IS NULL OR purchased.id IS NULL OR message.id IS NULL
    OR allocation.number_id IS DISTINCT FROM NEW.number_id
    OR allocation.platform_id IS DISTINCT FROM NEW.platform_id
    OR allocation.allocation_type IS DISTINCT FROM 'PLATFORM'
    OR allocation.receiving_mode IS DISTINCT FROM 'HOSTED'
    OR allocation.assigned_at > NEW.occurred_at
    OR NEW.occurred_at >= LEAST(allocation.expires_at,COALESCE(allocation.released_at,allocation.expires_at))
    OR purchased.shop_id IS DISTINCT FROM NEW.shop_id
    OR purchased.fulfillment_status IS DISTINCT FROM 'COMPLETED'
    OR purchased.user_id IS DISTINCT FROM allocation.user_id
    OR message.user_id IS DISTINCT FROM allocation.user_id
    OR message.number_id IS DISTINCT FROM allocation.number_id
    OR message.allocation_id IS DISTINCT FROM allocation.id
    OR message.platform_id IS DISTINCT FROM allocation.platform_id
    OR message.received_at IS DISTINCT FROM NEW.occurred_at THEN
    RAISE EXCEPTION 'Delivered shop message must match the valid buyer allocation at occurrence time';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shop_message_delivery_guard BEFORE INSERT OR UPDATE OR DELETE ON shop_message_deliveries
  FOR EACH ROW EXECUTE FUNCTION guard_shop_message_delivery();
