ALTER TABLE store
  ADD COLUMN IF NOT EXISTS primary_manager_user_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'store'::regclass
       AND conname = 'store_primary_manager_user_id_fkey'
  ) THEN
    ALTER TABLE store
      ADD CONSTRAINT store_primary_manager_user_id_fkey
      FOREIGN KEY (primary_manager_user_id) REFERENCES app_user(id);
  END IF;
END $$;

ALTER TABLE manager_reward_day_assignment
  DROP CONSTRAINT IF EXISTS manager_reward_day_assignment_attendance_status_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'manager_reward_day_assignment'::regclass
       AND conname = 'manager_reward_day_assignment_attendance_status_check'
  ) THEN
    ALTER TABLE manager_reward_day_assignment
      ADD CONSTRAINT manager_reward_day_assignment_attendance_status_check
      CHECK (attendance_status IN ('PRESENT','LATE','COMPLETED','LEFT_EARLY','NOT_REQUIRED'));
  END IF;
END $$;

ALTER TABLE manager_reward_month_lock_day
  DROP CONSTRAINT IF EXISTS manager_reward_month_lock_day_attendance_status_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'manager_reward_month_lock_day'::regclass
       AND conname = 'manager_reward_month_lock_day_attendance_status_check'
  ) THEN
    ALTER TABLE manager_reward_month_lock_day
      ADD CONSTRAINT manager_reward_month_lock_day_attendance_status_check
      CHECK (attendance_status IS NULL OR attendance_status IN ('PRESENT','LATE','COMPLETED','LEFT_EARLY','NOT_REQUIRED'));
  END IF;
END $$;
