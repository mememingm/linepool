-- Unknown prices remain NULL. Never invent a price or a successful execution.
ALTER TABLE renewals ALTER COLUMN total_points DROP NOT NULL;
ALTER TABLE renewals ADD COLUMN data_source text NOT NULL DEFAULT 'mock' CHECK (data_source IN ('mock','live'));
ALTER TABLE renewals ADD COLUMN estimated_expires_at timestamptz;
ALTER TABLE renewals ADD COLUMN confirmed_expires_at timestamptz;
ALTER TABLE renewals ADD COLUMN failure_reason text;
-- Existing records are retained. Enforce supplier confirmation on every new/updated record.
ALTER TABLE renewals ADD CONSTRAINT renewals_live_confirmation CHECK (
  execution_status <> 'COMPLETED' OR (
    data_source='live' AND confirmed_expires_at IS NOT NULL AND confirmed_expires_at > original_expires_at
    AND total_points IS NOT NULL AND payment_status='CONFIRMED'
    AND effective_at IS NOT NULL AND evidence IS NOT NULL AND length(trim(evidence))>=3
  )
) NOT VALID;
CREATE INDEX renewals_allocation_created ON renewals(allocation_id,created_at DESC,id DESC);
