CREATE TABLE IF NOT EXISTS technician_clock_in (
  id uuid primary key,
  tenant_id uuid not null references tenant(id),
  technician_id uuid not null references technician(id),
  store_id uuid not null references store(id),
  clock_in_time timestamptz not null,
  clock_out_time timestamptz,
  business_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uk_technician_clock_in_day unique (technician_id, business_date)
);
CREATE INDEX IF NOT EXISTS idx_technician_clock_in_store_date
  ON technician_clock_in(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_technician_clock_in_technician_date
  ON technician_clock_in(technician_id, business_date);
