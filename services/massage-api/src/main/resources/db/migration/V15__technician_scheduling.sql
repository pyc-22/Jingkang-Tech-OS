CREATE TABLE technician_shift_schedule (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  technician_id UUID NOT NULL REFERENCES technician(id),
  schedule_date DATE NOT NULL,
  shift_type VARCHAR(20) NOT NULL CHECK (shift_type IN ('MORNING','EVENING','CUSTOM','REST')),
  start_time TIME,
  end_time TIME,
  status VARCHAR(20) NOT NULL CHECK (status IN ('SCHEDULED','REST','CANCELLED')),
  note VARCHAR(240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(store_id, technician_id, schedule_date),
  CHECK ((shift_type = 'REST' AND status = 'REST' AND start_time IS NULL AND end_time IS NULL)
         OR (shift_type <> 'REST' AND status IN ('SCHEDULED','CANCELLED') AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time))
);

CREATE INDEX technician_shift_schedule_store_date_idx ON technician_shift_schedule(store_id, schedule_date, status);

CREATE TABLE technician_leave_request (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  technician_id UUID NOT NULL REFERENCES technician(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING','APPROVED','CANCELLED')),
  reason VARCHAR(240),
  review_note VARCHAR(240),
  reviewed_by_name VARCHAR(120),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  CHECK (end_date >= start_date)
);

CREATE INDEX technician_leave_request_store_dates_idx ON technician_leave_request(store_id, start_date, end_date, status);
