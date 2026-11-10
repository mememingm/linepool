-- Allow the inventory event log to distinguish a resale to an end customer.
ALTER TABLE agent_number_stock_events
  DROP CONSTRAINT IF EXISTS agent_number_stock_events_action_check;
ALTER TABLE agent_number_stock_events
  ADD CONSTRAINT agent_number_stock_events_action_check
  CHECK (action IN ('IMPORT','CLAIM','RELEASE','RESELL','ASSIGN_CUSTOMER'));
