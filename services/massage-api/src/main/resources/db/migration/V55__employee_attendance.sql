CREATE TABLE employee_attendance (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  employee_id UUID NOT NULL REFERENCES employee(id),
  attendance_date DATE NOT NULL,
  scheduled_start TIME,
  scheduled_end TIME,
  schedule_status VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (status IN ('NOT_SCHEDULED','NOT_STARTED','PRESENT','LATE','COMPLETED','LEFT_EARLY','ABSENT','REST','LEAVE')),
  clock_in_at TIMESTAMPTZ,
  clock_out_at TIMESTAMPTZ,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  early_leave_minutes INTEGER NOT NULL DEFAULT 0,
  source VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  note VARCHAR(240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(store_id, employee_id, attendance_date)
);

CREATE INDEX employee_attendance_date_idx
  ON employee_attendance(tenant_id, store_id, attendance_date, status);
