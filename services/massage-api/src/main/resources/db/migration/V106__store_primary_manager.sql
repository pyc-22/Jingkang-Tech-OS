ALTER TABLE store
  ADD COLUMN primary_manager_user_id UUID REFERENCES app_user(id);

ALTER TABLE manager_reward_day_assignment
  DROP CONSTRAINT manager_reward_day_assignment_attendance_status_check,
  ADD CONSTRAINT manager_reward_day_assignment_attendance_status_check
    CHECK (attendance_status IN ('PRESENT','LATE','COMPLETED','LEFT_EARLY','NOT_REQUIRED'));

ALTER TABLE manager_reward_month_lock_day
  DROP CONSTRAINT manager_reward_month_lock_day_attendance_status_check,
  ADD CONSTRAINT manager_reward_month_lock_day_attendance_status_check
    CHECK (attendance_status IS NULL OR attendance_status IN ('PRESENT','LATE','COMPLETED','LEFT_EARLY','NOT_REQUIRED'));
