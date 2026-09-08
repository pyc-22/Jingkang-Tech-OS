ALTER TABLE clock_device_event
  DROP CONSTRAINT IF EXISTS clock_device_event_processing_status_check;

ALTER TABLE clock_device_event
  ADD COLUMN matched_room_id UUID REFERENCES room(id),
  ADD COLUMN auto_reply_event_id UUID REFERENCES clock_device_event(id),
  ADD CONSTRAINT clock_device_event_processing_status_check
    CHECK (processing_status IN ('PENDING', 'CONFIRMED', 'MATCH_FAILED', 'REJECTED', 'REPLIED', 'REPLY_FAILED'));
