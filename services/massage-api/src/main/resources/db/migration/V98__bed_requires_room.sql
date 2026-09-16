-- MATCH SIMPLE composite foreign keys skip rows containing NULL components.
ALTER TABLE service_session ADD CONSTRAINT service_bed_requires_room
  CHECK (bed_id IS NULL OR room_id IS NOT NULL) NOT VALID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM service_session WHERE bed_id IS NOT NULL AND room_id IS NULL) THEN
    ALTER TABLE service_session VALIDATE CONSTRAINT service_bed_requires_room;
  END IF;
END $$;
