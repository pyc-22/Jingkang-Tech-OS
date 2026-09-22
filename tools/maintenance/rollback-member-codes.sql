\set ON_ERROR_STOP on
-- Stop all app instances first. Use interactively: psql ... then \i this-file.sql.
-- Restore the previous JAR before restarting. Review the result then COMMIT or ROLLBACK.
BEGIN;
LOCK TABLE store, member IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF (SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1) IS DISTINCT FROM '101' THEN
    RAISE EXCEPTION 'Rollback requires V101 to be the latest applied migration';
  END IF;
  IF to_regclass('member_code_backup') IS NULL OR to_regclass('member_code_backup_run') IS NULL THEN
    RAISE EXCEPTION 'Original member code backup is missing; restore the complete dump instead';
  END IF;
  IF EXISTS (
    SELECT 1 FROM member m FULL JOIN member_code_backup b ON m.id=b.member_id
    WHERE m.id IS NULL OR b.member_id IS NULL OR b.migrated_code IS NULL
       OR (m.tenant_id,m.registered_store_id,m.code,m.created_at,m.version)
          IS DISTINCT FROM (b.tenant_id,b.registered_store_id,b.migrated_code,b.created_at,b.version+1)
  ) THEN
    RAISE EXCEPTION 'Member set or profile changed after migration; review before restoring the full dump';
  END IF;
  IF EXISTS (SELECT 1 FROM store s WHERE member_code_next_number<>(SELECT count(*)+1 FROM member m WHERE m.registered_store_id=s.id)) THEN
    RAISE EXCEPTION 'Member allocations changed after migration; review before restoring the full dump';
  END IF;
END $$;
ALTER TABLE member DROP CONSTRAINT member_code_format_check;
ALTER TABLE member DROP CONSTRAINT member_tenant_code_key;
UPDATE member m SET code=b.old_code,updated_at=b.updated_at,version=b.version
FROM member_code_backup b WHERE b.member_id=m.id;
ALTER TABLE member ADD CONSTRAINT member_tenant_code_key UNIQUE (tenant_id,code);
DROP TRIGGER store_member_code_prefix_before_insert ON store;
DROP FUNCTION assign_store_member_code_prefix();
ALTER TABLE store DROP COLUMN member_code_prefix, DROP COLUMN member_code_next_number;
UPDATE member_code_backup SET migrated_code=NULL;
DELETE FROM flyway_schema_history WHERE version='101';
SELECT count(*) AS restored_members FROM member m JOIN member_code_backup b ON b.member_id=m.id AND b.old_code=m.code;
-- COMMIT;
-- ROLLBACK;
