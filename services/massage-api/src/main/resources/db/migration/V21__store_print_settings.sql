CREATE TABLE store_print_setting (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL UNIQUE REFERENCES store(id),
  store_name VARCHAR(120) NOT NULL,
  receipt_title VARCHAR(80) NOT NULL DEFAULT '消费小票',
  store_address VARCHAR(240),
  store_phone VARCHAR(60),
  header_note VARCHAR(240),
  footer_note VARCHAR(240),
  paper_width_mm SMALLINT NOT NULL DEFAULT 80 CHECK (paper_width_mm BETWEEN 50 AND 120),
  font_size_px SMALLINT NOT NULL DEFAULT 12 CHECK (font_size_px BETWEEN 8 AND 22),
  margin_mm SMALLINT NOT NULL DEFAULT 3 CHECK (margin_mm BETWEEN 0 AND 15),
  copies SMALLINT NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 3),
  auto_print BOOLEAN NOT NULL DEFAULT FALSE,
  show_store_address BOOLEAN NOT NULL DEFAULT TRUE,
  show_store_phone BOOLEAN NOT NULL DEFAULT TRUE,
  show_order_no BOOLEAN NOT NULL DEFAULT TRUE,
  show_member BOOLEAN NOT NULL DEFAULT TRUE,
  show_technician BOOLEAN NOT NULL DEFAULT TRUE,
  show_room BOOLEAN NOT NULL DEFAULT TRUE,
  show_payment BOOLEAN NOT NULL DEFAULT TRUE,
  show_balance BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX store_print_setting_scope_idx ON store_print_setting(tenant_id, store_id);

INSERT INTO store_print_setting(id,tenant_id,store_id,store_name,store_address,store_phone)
SELECT md5('print-setting-' || id::text)::uuid,tenant_id,id,name,address,contact_phone
FROM store;
