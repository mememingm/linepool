-- S2: model storefront identity and upstream account ownership without changing existing upstream IDs.
CREATE TABLE storefronts (
  id text PRIMARY KEY CHECK (length(trim(id)) BETWEEN 1 AND 100),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  product text NOT NULL CHECK (product IN ('SMS_CODE','NUMBER_LEASE','VOICE')),
  voice_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO storefronts(id,name,product) VALUES
  ('linepool','LinePool','SMS_CODE'),
  ('once','ONCE','NUMBER_LEASE');

CREATE TABLE upstream_accounts (
  id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (length(trim(provider)) BETWEEN 1 AND 80),
  external_account_id text NOT NULL CHECK (length(trim(external_account_id)) BETWEEN 1 AND 200),
  storefront_id text NOT NULL REFERENCES storefronts(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,external_account_id),
  UNIQUE(id,provider)
);
INSERT INTO upstream_accounts(id,provider,external_account_id,storefront_id) VALUES
  ('00000000-0000-4000-8000-000000000031','pingcode-mock','mock-linepool','linepool'),
  ('00000000-0000-4000-8000-000000000032','pingcode-mock','mock-once','once');

ALTER TABLE phone_numbers ADD COLUMN upstream_account_id uuid;
UPDATE phone_numbers SET upstream_account_id='00000000-0000-4000-8000-000000000031';
ALTER TABLE phone_numbers ALTER COLUMN upstream_account_id SET NOT NULL;
ALTER TABLE phone_numbers ADD CONSTRAINT phone_numbers_upstream_account_fk
  FOREIGN KEY(upstream_account_id) REFERENCES upstream_accounts(id);
CREATE INDEX phone_numbers_upstream_account ON phone_numbers(upstream_account_id,id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM provider_projects WHERE provider <> 'pingcode-mock') THEN
    RAISE EXCEPTION '031 only seeds Mock accounts; non-Mock provider_projects require explicit account mapping';
  END IF;
END $$;

ALTER TABLE provider_projects ADD COLUMN upstream_account_id uuid;
-- This pre-ONCE LinePool database has only LinePool-owned resources. The 14 historical receipts had no matching project rows
-- (8 pingcode, 6 pingcode-mock), so their account is retained as LinePool Mock for audit only; unmatched receipts stay unrouted.
UPDATE provider_projects SET upstream_account_id='00000000-0000-4000-8000-000000000031';
ALTER TABLE provider_projects ALTER COLUMN upstream_account_id SET NOT NULL;
ALTER TABLE provider_projects ADD CONSTRAINT provider_projects_upstream_account_fk
  FOREIGN KEY(upstream_account_id,provider) REFERENCES upstream_accounts(id,provider);
CREATE INDEX provider_projects_upstream_account ON provider_projects(upstream_account_id,external_project_id);
ALTER TABLE provider_message_receipts ADD COLUMN upstream_account_id uuid;
UPDATE provider_message_receipts receipt
SET upstream_account_id=project.upstream_account_id
FROM provider_projects project
WHERE project.provider=receipt.provider AND project.external_project_id=receipt.external_project_id;
UPDATE provider_message_receipts SET upstream_account_id='00000000-0000-4000-8000-000000000031'
WHERE upstream_account_id IS NULL;
ALTER TABLE provider_message_receipts ALTER COLUMN upstream_account_id SET NOT NULL;
ALTER TABLE provider_message_receipts ADD CONSTRAINT provider_message_receipts_upstream_account_fk
  FOREIGN KEY(upstream_account_id) REFERENCES upstream_accounts(id);
CREATE INDEX provider_message_receipts_upstream_account ON provider_message_receipts(upstream_account_id,received_at DESC,external_message_id);
