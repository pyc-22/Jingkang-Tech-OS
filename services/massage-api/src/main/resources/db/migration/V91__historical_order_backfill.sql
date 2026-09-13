-- Historical order backfill: additive schema only.
-- Existing orders remain ordinary orders (is_historical_backfill=false).

-- The legacy permission UUID range is occupied by existing permissions.
-- Keep the stable code identity while allocating a collision-free key.
INSERT INTO permission(id, code, name, module)
SELECT gen_random_uuid(), 'HISTORICAL_ORDER_CREATE', '历史补单', 'ORDER'
WHERE NOT EXISTS (
  SELECT 1 FROM permission WHERE code = 'HISTORICAL_ORDER_CREATE'
)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS store_manager_backfill_permission (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  manager_id UUID NOT NULL REFERENCES app_user(id),
  granted_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, manager_id)
);

CREATE INDEX IF NOT EXISTS store_manager_backfill_permission_active_idx
  ON store_manager_backfill_permission(store_id, manager_id, is_active);
CREATE INDEX IF NOT EXISTS store_manager_backfill_permission_manager_idx
  ON store_manager_backfill_permission(tenant_id, manager_id, is_active);

ALTER TABLE sales_order
  ADD COLUMN IF NOT EXISTS is_historical_backfill BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS backfill_date DATE,
  ADD COLUMN IF NOT EXISTS backfill_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS backfill_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sales_order_historical_backfill_idx
  ON sales_order(tenant_id, store_id, is_historical_backfill, backfill_date DESC);
CREATE INDEX IF NOT EXISTS sales_order_historical_backfill_actor_idx
  ON sales_order(tenant_id, store_id, backfill_by, backfill_date DESC)
  WHERE is_historical_backfill = TRUE;

COMMENT ON COLUMN sales_order.is_historical_backfill IS '订单是否由历史补单流程创建';
COMMENT ON COLUMN sales_order.backfill_date IS '历史补单选择的营业日期';
COMMENT ON COLUMN sales_order.backfill_by IS '历史补单实际操作人';
COMMENT ON COLUMN sales_order.backfill_at IS '历史补单实际操作时间';
