CREATE TABLE sales_order_service_session (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  order_id UUID NOT NULL REFERENCES sales_order(id),
  order_line_id UUID NOT NULL REFERENCES sales_order_line(id),
  service_session_id UUID NOT NULL REFERENCES service_session(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_session_id),
  UNIQUE(order_line_id)
);

CREATE INDEX sales_order_service_session_store_created_idx
  ON sales_order_service_session(tenant_id, store_id, created_at DESC);
CREATE INDEX sales_order_service_session_order_idx
  ON sales_order_service_session(order_id);
