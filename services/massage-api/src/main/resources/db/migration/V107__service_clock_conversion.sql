ALTER TABLE service_session
  ADD COLUMN IF NOT EXISTS converted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE technician_commission_record
  DROP CONSTRAINT IF EXISTS technician_commission_record_clock_type_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'technician_commission_record'::regclass
       AND conname = 'technician_commission_record_clock_type_check'
  ) THEN
    ALTER TABLE technician_commission_record
      ADD CONSTRAINT technician_commission_record_clock_type_check CHECK (
        clock_type IN ('QUEUE','CALL','SELECTED','BOOKED_QUEUE','BOOKED_CALL','EXTENSION','CONVERSION')
      );
  END IF;
END $$;
