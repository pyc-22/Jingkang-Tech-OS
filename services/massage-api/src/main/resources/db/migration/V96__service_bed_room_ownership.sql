ALTER TABLE room_bed ADD CONSTRAINT room_bed_ownership_key UNIQUE (id,room_id,store_id,tenant_id);
-- Enforce new writes without guessing replacements for historical mismatches.
ALTER TABLE service_session ADD CONSTRAINT service_bed_room_ownership
  FOREIGN KEY (bed_id,room_id,store_id,tenant_id)
  REFERENCES room_bed(id,room_id,store_id,tenant_id) NOT VALID;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM service_session s LEFT JOIN room_bed b
      ON (b.id,b.room_id,b.store_id,b.tenant_id)=(s.bed_id,s.room_id,s.store_id,s.tenant_id)
    WHERE s.bed_id IS NOT NULL AND b.id IS NULL
  ) THEN
    ALTER TABLE service_session VALIDATE CONSTRAINT service_bed_room_ownership;
  END IF;
END $$;
