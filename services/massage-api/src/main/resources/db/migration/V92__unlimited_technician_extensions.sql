-- The extension cap column remains for backward-compatible API/schema reads.
-- Runtime extension validation now uses only service_duration_max_minutes.
ALTER TABLE store
  ALTER COLUMN technician_extension_max_minutes SET DEFAULT 0;

UPDATE store
   SET technician_extension_max_minutes = 0,
       updated_at = now(),
       version = version + 1
 WHERE technician_extension_max_minutes <> 0;
