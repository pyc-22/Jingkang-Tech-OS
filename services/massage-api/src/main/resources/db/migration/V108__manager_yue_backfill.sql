ALTER TABLE manager_yue_record
  ADD COLUMN IF NOT EXISTS submission_kind VARCHAR(20) NOT NULL DEFAULT 'NORMAL';

UPDATE manager_yue_record
   SET submission_kind = 'BACKFILL'
 WHERE (submitted_at AT TIME ZONE 'Asia/Shanghai')::date > business_date
   AND submission_kind <> 'BACKFILL';

ALTER TABLE manager_yue_record
  DROP CONSTRAINT IF EXISTS manager_yue_record_submission_kind_check;

ALTER TABLE manager_yue_record
  ADD CONSTRAINT manager_yue_record_submission_kind_check
  CHECK (submission_kind IN ('NORMAL', 'BACKFILL'));

CREATE INDEX IF NOT EXISTS manager_yue_record_backfill_idx
  ON manager_yue_record(tenant_id, store_id, business_date, submitted_at DESC)
  WHERE submission_kind = 'BACKFILL';

COMMENT ON COLUMN manager_yue_record.submission_kind IS 'NORMAL for same-day submission, BACKFILL for a later submission of an earlier business date';
