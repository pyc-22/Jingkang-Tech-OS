-- Assign each store a stable letter and reserve the next member number under
-- the store row so member creation can serialize safely.
-- Flyway executes this entire migration in one PostgreSQL transaction.
LOCK TABLE store, member IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM member) THEN
    IF to_regclass('member_code_backup_run') IS NULL OR to_regclass('member_code_backup') IS NULL THEN
      RAISE EXCEPTION 'Run backup-member-codes.ps1 with the application stopped before V101';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM member_code_backup_run WHERE migration_version = 101 AND dump_sha256 ~ '^[0-9A-Fa-f]{64}$') THEN
      RAISE EXCEPTION 'Verified full backup metadata is missing';
    END IF;
    IF EXISTS (
      SELECT 1 FROM member m FULL JOIN member_code_backup b ON b.member_id=m.id
      WHERE m.id IS NULL OR b.member_id IS NULL OR b.migrated_code IS NOT NULL
         OR (m.tenant_id,m.registered_store_id,m.code,m.created_at,m.updated_at,m.version)
            IS DISTINCT FROM (b.tenant_id,b.registered_store_id,b.old_code,b.created_at,b.updated_at,b.version)
    ) THEN
      RAISE EXCEPTION 'Member data changed since backup; stop the application and take a fresh backup';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM member m JOIN store s ON s.id=m.registered_store_id WHERE m.tenant_id<>s.tenant_id) THEN
    RAISE EXCEPTION 'Member registration store belongs to another tenant';
  END IF;
END $$;

ALTER TABLE store
  ADD COLUMN member_code_prefix CHAR(1),
  ADD COLUMN member_code_next_number INTEGER NOT NULL DEFAULT 1;

-- Rebuild the unique constraint under the table lock so code swaps are atomic.
-- A custom foreign key referencing code makes DROP fail rather than orphan data.
ALTER TABLE member DROP CONSTRAINT member_tenant_code_key;

DO $$
DECLARE
  max_store_count INTEGER;
  max_member_count INTEGER;
BEGIN
  SELECT COALESCE(MAX(store_count), 0) INTO max_store_count
  FROM (
    SELECT tenant_id, COUNT(*)::INTEGER AS store_count
    FROM store
    GROUP BY tenant_id
  ) counts;
  IF max_store_count > 26 THEN
    RAISE EXCEPTION 'Member code format supports at most 26 stores per tenant';
  END IF;

  SELECT COALESCE(MAX(member_count), 0) INTO max_member_count
  FROM (
    SELECT registered_store_id, COUNT(*)::INTEGER AS member_count
    FROM member
    GROUP BY registered_store_id
  ) counts;
  IF max_member_count > 99999 THEN
    RAISE EXCEPTION 'Member code format supports at most 99999 members per store';
  END IF;

  WITH ranked_stores AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS sequence_no
    FROM store
  )
  UPDATE store s
     SET member_code_prefix = CHR(64 + ranked_stores.sequence_no::INTEGER),
         member_code_next_number = 1
    FROM ranked_stores
   WHERE s.id = ranked_stores.id;

  WITH ranked_members AS (
    SELECT m.id,
           s.member_code_prefix,
           ROW_NUMBER() OVER (PARTITION BY m.registered_store_id ORDER BY m.created_at, m.id) AS sequence_no
    FROM member m
    JOIN store s ON s.id = m.registered_store_id
  )
  UPDATE member m
     SET code = ranked_members.member_code_prefix || LPAD(ranked_members.sequence_no::TEXT, 5, '0'),
         updated_at = now(),
         version = version + 1
    FROM ranked_members
   WHERE m.id = ranked_members.id;

  UPDATE store s
     SET member_code_next_number = COALESCE(counts.member_count, 0) + 1
    FROM (
      SELECT registered_store_id, COUNT(*)::INTEGER AS member_count
      FROM member
      GROUP BY registered_store_id
    ) counts
   WHERE s.id = counts.registered_store_id;
END $$;

ALTER TABLE member ADD CONSTRAINT member_tenant_code_key UNIQUE (tenant_id, code);

DO $$
BEGIN
  IF to_regclass('member_code_backup') IS NOT NULL THEN
    UPDATE member_code_backup b SET migrated_code=m.code FROM member m WHERE m.id=b.member_id;
  END IF;
END $$;

ALTER TABLE store
  ALTER COLUMN member_code_prefix SET NOT NULL;

ALTER TABLE store
  ADD CONSTRAINT store_member_code_prefix_check CHECK (member_code_prefix ~ '^[A-Z]$'),
  ADD CONSTRAINT store_member_code_next_number_check CHECK (member_code_next_number BETWEEN 1 AND 100000),
  ADD CONSTRAINT store_tenant_member_code_prefix_key UNIQUE (tenant_id, member_code_prefix);

ALTER TABLE member
  ADD CONSTRAINT member_code_format_check CHECK (code ~ '^[A-Z][0-9]{5}$');

CREATE OR REPLACE FUNCTION assign_store_member_code_prefix()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_prefix INTEGER;
BEGIN
  IF NEW.member_code_prefix IS NULL THEN
    PERFORM id FROM tenant WHERE id=NEW.tenant_id FOR UPDATE;
    SELECT COALESCE(MAX(ASCII(member_code_prefix)), ASCII('A') - 1) + 1
      INTO next_prefix
      FROM store
     WHERE tenant_id = NEW.tenant_id;
    IF next_prefix > ASCII('Z') THEN
      RAISE EXCEPTION 'Member code format supports at most 26 stores per tenant';
    END IF;
    NEW.member_code_prefix := CHR(next_prefix);
  END IF;
  NEW.member_code_next_number := COALESCE(NEW.member_code_next_number, 1);
  RETURN NEW;
END;
$$;

CREATE TRIGGER store_member_code_prefix_before_insert
  BEFORE INSERT ON store
  FOR EACH ROW
  EXECUTE FUNCTION assign_store_member_code_prefix();

COMMENT ON COLUMN store.member_code_prefix IS 'Stable member code letter assigned by tenant store creation order';
COMMENT ON COLUMN store.member_code_next_number IS 'Next five-digit member number; allocation locks the store row';
