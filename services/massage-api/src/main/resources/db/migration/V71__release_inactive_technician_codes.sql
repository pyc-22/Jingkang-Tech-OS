ALTER TABLE technician
  DROP CONSTRAINT IF EXISTS technician_store_id_code_key;

CREATE UNIQUE INDEX technician_store_active_code_idx
  ON technician(store_id,code)
  WHERE active=true;

DROP INDEX IF EXISTS employee_store_assignment_no_idx;

CREATE UNIQUE INDEX employee_store_assignment_active_no_idx
  ON employee_store_assignment(store_id,employee_no)
  WHERE employee_no IS NOT NULL AND active=true;
