-- Historical ONCE orders may have succeeded without recording a completion timestamp.
-- Their active import batch proves provenance; live orders retain the completion invariant.
ALTER TABLE orders DROP CONSTRAINT order_completion_time;
ALTER TABLE orders ADD CONSTRAINT order_completion_time CHECK (
  (fulfillment_status='COMPLETED' AND (completed_at IS NOT NULL OR
    (product_type='NUMBER_LEASE' AND import_batch_id IS NOT NULL)))
  OR (fulfillment_status<>'COMPLETED' AND completed_at IS NULL)
) NOT VALID;
