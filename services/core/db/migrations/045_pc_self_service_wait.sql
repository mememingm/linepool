-- Self-service waits bind to one platform service; existing agent waits keep NULL.
ALTER TABLE pc_wait_demands
  ADD COLUMN allocation_id uuid REFERENCES number_allocations(id);
