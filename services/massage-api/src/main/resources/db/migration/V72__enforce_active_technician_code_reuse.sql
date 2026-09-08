DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'technician'
      AND con.contype = 'u'
      AND pg_get_constraintdef(con.oid) LIKE '%(store_id, code)%'
  LOOP
    EXECUTE format('ALTER TABLE technician DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END $$;

DROP INDEX IF EXISTS technician_store_id_code_key;
DROP INDEX IF EXISTS technician_store_active_code_idx;

CREATE UNIQUE INDEX technician_store_active_code_idx
  ON technician(store_id,code)
  WHERE active=true;
