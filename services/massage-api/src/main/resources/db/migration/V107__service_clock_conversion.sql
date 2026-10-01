ALTER TABLE service_session
  ADD COLUMN converted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE technician_commission_record
  DROP CONSTRAINT technician_commission_record_clock_type_check,
  ADD CONSTRAINT technician_commission_record_clock_type_check CHECK (
    clock_type IN ('QUEUE','CALL','SELECTED','BOOKED_QUEUE','BOOKED_CALL','EXTENSION','CONVERSION')
  );
