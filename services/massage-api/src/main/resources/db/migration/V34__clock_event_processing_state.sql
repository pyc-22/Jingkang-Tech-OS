ALTER TABLE clock_device_event
  ADD COLUMN processing_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (processing_status IN ('PENDING', 'CONFIRMED', 'MATCH_FAILED', 'REJECTED')),
  ADD COLUMN matched_technician_id UUID REFERENCES technician(id),
  ADD COLUMN processing_note VARCHAR(500),
  ADD COLUMN processed_at TIMESTAMPTZ,
  ADD COLUMN processed_by UUID REFERENCES app_user(id);

CREATE INDEX clock_device_event_processing_idx
  ON clock_device_event(tenant_id, store_id, processing_status, received_at DESC);
