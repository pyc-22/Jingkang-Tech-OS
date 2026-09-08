CREATE TABLE monthly_target_allocation (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  target_month DATE NOT NULL CHECK (EXTRACT(DAY FROM target_month) = 1),
  allocation_type VARCHAR(20) NOT NULL CHECK (allocation_type IN ('PROJECT','TECHNICIAN')),
  service_item_id UUID REFERENCES service_item(id),
  technician_id UUID REFERENCES technician(id),
  target_cents BIGINT NOT NULL DEFAULT 0 CHECK (target_cents >= 0),
  updated_by_user_id UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  CHECK (
    (allocation_type='PROJECT' AND service_item_id IS NOT NULL AND technician_id IS NULL)
    OR
    (allocation_type='TECHNICIAN' AND technician_id IS NOT NULL AND service_item_id IS NULL)
  )
);

CREATE UNIQUE INDEX monthly_target_allocation_project_unique_idx
  ON monthly_target_allocation(store_id, target_month, service_item_id)
  WHERE allocation_type='PROJECT';

CREATE UNIQUE INDEX monthly_target_allocation_technician_unique_idx
  ON monthly_target_allocation(store_id, target_month, technician_id)
  WHERE allocation_type='TECHNICIAN';

CREATE INDEX monthly_target_allocation_store_month_idx
  ON monthly_target_allocation(tenant_id, store_id, target_month, allocation_type);
