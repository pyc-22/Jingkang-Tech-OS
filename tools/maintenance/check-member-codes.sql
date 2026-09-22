\set ON_ERROR_STOP on
-- Run with the same database, login and search_path as the API. No data is changed.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database() AS database, current_user AS login,
       inet_server_addr() AS server_address, inet_server_port() AS server_port,
       current_schema() AS schema, current_setting('search_path') AS search_path,
       to_regclass('member') AS member_table,
       to_regclass('member_code_backup_run') AS backup_metadata,
       to_regclass('member_code_backup') AS backup_members;

SELECT version, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM flyway_schema_history WHERE version='101' AND success) THEN
    RAISE NOTICE 'V101_ALREADY_APPLIED: preserve its original backup; do not rerun backup-member-codes.ps1';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM member) THEN
    RAISE NOTICE 'V101_READY_EMPTY: no historical members to renumber';
    RETURN;
  END IF;
  IF to_regclass('member_code_backup_run') IS NULL OR to_regclass('member_code_backup') IS NULL THEN
    RAISE EXCEPTION 'V101_NOT_READY: backup snapshot tables are missing in this database/search_path. Stop all writers and run backup-member-codes.ps1 against this exact database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM member_code_backup_run WHERE migration_version=101 AND dump_sha256 ~ '^[0-9A-Fa-f]{64}$') THEN
    RAISE EXCEPTION 'V101_NOT_READY: verified full backup metadata is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM member m FULL JOIN member_code_backup b ON b.member_id=m.id
    WHERE m.id IS NULL OR b.member_id IS NULL OR b.migrated_code IS NOT NULL
       OR (m.tenant_id,m.registered_store_id,m.code,m.created_at,m.updated_at,m.version)
          IS DISTINCT FROM (b.tenant_id,b.registered_store_id,b.old_code,b.created_at,b.updated_at,b.version)
  ) THEN
    RAISE EXCEPTION 'V101_NOT_READY: member data changed since backup. Keep all writers stopped and take a fresh backup';
  END IF;
  RAISE NOTICE 'V101_BACKUP_READY: backup snapshot matches historical members in this database';
END $$;
COMMIT;
