ALTER TABLE daily_operating_report
  ADD COLUMN daily_extension_count INTEGER NOT NULL DEFAULT 0
    CHECK (daily_extension_count >= 0);
