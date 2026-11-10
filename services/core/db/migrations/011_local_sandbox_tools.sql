-- Only explicit LOCAL_SANDBOX services use these records; no changes to existing users.
CREATE TABLE sandbox_grants (
 user_id uuid PRIMARY KEY REFERENCES users(id), ledger_id uuid NOT NULL UNIQUE REFERENCES point_ledger(id)
);
CREATE TABLE sandbox_inbound (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), number_id uuid NOT NULL REFERENCES phone_numbers(id),
 allocation_id uuid NOT NULL REFERENCES number_allocations(id), service text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('SUCCESS','FAILED','UNKNOWN')), received_at timestamptz NOT NULL DEFAULT now()
);
