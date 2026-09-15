-- Manual settlement lines may be attributed to technicians and clock types
-- without occupying a physical room. Existing operational sessions retain
-- their room references; nullable rows are excluded from room-state updates.
ALTER TABLE service_session
  ALTER COLUMN room_id DROP NOT NULL;
