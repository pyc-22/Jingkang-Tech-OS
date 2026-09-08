CREATE TABLE service_item_category (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  parent_id UUID REFERENCES service_item_category(id),
  code VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(store_id, code)
);

ALTER TABLE service_item ADD COLUMN category_id UUID REFERENCES service_item_category(id);
CREATE INDEX service_item_category_store_idx ON service_item(store_id, category_id, active);
CREATE INDEX service_item_category_parent_idx ON service_item_category(store_id, parent_id, sort_order, name);
