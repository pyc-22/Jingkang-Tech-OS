ALTER TABLE service_item
  ADD COLUMN dispatch_type VARCHAR(12) NOT NULL DEFAULT 'QUEUE'
    CHECK (dispatch_type IN ('QUEUE', 'CALL'));
