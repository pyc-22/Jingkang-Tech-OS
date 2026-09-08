ALTER TABLE technician
  ADD COLUMN queue_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX technician_store_queue_enabled_idx
  ON technician(store_id, active, queue_enabled, queue_order);
