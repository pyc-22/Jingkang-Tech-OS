ALTER TABLE room_status_event
  DROP CONSTRAINT room_status_event_status_check;

ALTER TABLE room_status_event
  ADD CONSTRAINT room_status_event_status_check
    CHECK (status IN ('IDLE', 'IN_SERVICE', 'PENDING_PAYMENT', 'CLEANING', 'RESERVED'));
