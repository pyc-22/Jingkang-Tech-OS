-- Order numbers need a database-backed allocator so concurrent settlements never
-- derive the same value from the wall clock.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1;

-- A technician may have only one active participant record per store. Historical
-- duplicate checks are performed before deployment; this predicate leaves
-- completed/rejected history untouched.
CREATE UNIQUE INDEX IF NOT EXISTS uk_participant_technician_active
  ON service_session_participant(store_id, technician_id)
  WHERE status IN ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE');
