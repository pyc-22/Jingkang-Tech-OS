\set ON_ERROR_STOP on
-- Called only after pg_dump and pg_restore --list succeed, with writers stopped.
BEGIN;
LOCK TABLE store, member IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
             AND table_name='store' AND column_name='member_code_prefix') THEN
    RAISE EXCEPTION 'V101 already applied; preserve the original backup';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS member_code_backup_run (
  migration_version INTEGER PRIMARY KEY CHECK (migration_version=101),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dump_file TEXT NOT NULL,
  dump_sha256 TEXT NOT NULL CHECK (dump_sha256 ~ '^[0-9A-Fa-f]{64}$')
);
CREATE TABLE IF NOT EXISTS member_code_backup (
  member_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  registered_store_id UUID NOT NULL,
  old_code VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL,
  migrated_code VARCHAR(40)
);
TRUNCATE member_code_backup, member_code_backup_run;
INSERT INTO member_code_backup_run(migration_version,dump_file,dump_sha256)
VALUES(101, :'dump_file', :'dump_sha256');
INSERT INTO member_code_backup(member_id,tenant_id,registered_store_id,old_code,created_at,updated_at,version)
SELECT id,tenant_id,registered_store_id,code,created_at,updated_at,version FROM member;
COMMIT;
SELECT captured_at,dump_file,dump_sha256,(SELECT count(*) FROM member_code_backup) AS members
FROM member_code_backup_run;
