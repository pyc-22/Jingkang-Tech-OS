-- Historical backfills use completed service_session rows so order details,
-- technician performance, commission, and refund paths share one data model.
-- EXTENSION remains restricted to these completed historical records by the API.
ALTER TABLE service_session
  DROP CONSTRAINT IF EXISTS service_session_clock_type_check;

ALTER TABLE service_session
  ADD CONSTRAINT service_session_clock_type_check
  CHECK (clock_type IN ('QUEUE','CALL','SELECTED','BOOKED_QUEUE','BOOKED_CALL','EXTENSION'));
