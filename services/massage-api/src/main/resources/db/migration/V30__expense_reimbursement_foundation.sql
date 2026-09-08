CREATE TABLE expense_category (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  parent_id UUID REFERENCES expense_category(id),
  code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  category_level SMALLINT NOT NULL CHECK (category_level IN (1, 2)),
  receipt_required BOOLEAN NOT NULL DEFAULT TRUE,
  no_receipt_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 100 CHECK (sort_order >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(tenant_id, code),
  CHECK ((category_level = 1 AND parent_id IS NULL) OR (category_level = 2 AND parent_id IS NOT NULL))
);

CREATE INDEX expense_category_tenant_parent_idx
  ON expense_category(tenant_id, parent_id, active, sort_order);

CREATE TABLE expense_claim (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  claim_no VARCHAR(50) NOT NULL,
  applicant_user_id UUID NOT NULL REFERENCES app_user(id),
  expense_category_id UUID NOT NULL REFERENCES expense_category(id),
  expense_date DATE NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  payee_name VARCHAR(160),
  payment_source VARCHAR(30) NOT NULL CHECK (payment_source IN ('PERSONAL_ADVANCE','STORE_PETTY_CASH','COMPANY_DIRECT')),
  receipt_type VARCHAR(20) NOT NULL CHECK (receipt_type IN ('INVOICE','RECEIPT','NO_RECEIPT')),
  invoice_no VARCHAR(100),
  description TEXT NOT NULL,
  no_receipt_reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','RETURNED','APPROVED','REJECTED','WITHDRAWN','PAID')),
  duplicate_warning JSONB,
  submitted_at TIMESTAMPTZ,
  reviewed_by_user_id UUID REFERENCES app_user(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(tenant_id, claim_no),
  CHECK (receipt_type <> 'NO_RECEIPT' OR status = 'DRAFT' OR NULLIF(BTRIM(no_receipt_reason), '') IS NOT NULL)
);

CREATE INDEX expense_claim_store_status_date_idx
  ON expense_claim(tenant_id, store_id, status, expense_date DESC);
CREATE INDEX expense_claim_finance_queue_idx
  ON expense_claim(tenant_id, status, submitted_at, store_id)
  WHERE status IN ('SUBMITTED','APPROVED');
CREATE INDEX expense_claim_applicant_idx
  ON expense_claim(applicant_user_id, created_at DESC);
CREATE INDEX expense_claim_duplicate_check_idx
  ON expense_claim(tenant_id, store_id, expense_date, amount_cents, expense_category_id);
CREATE INDEX expense_claim_invoice_idx
  ON expense_claim(tenant_id, invoice_no)
  WHERE invoice_no IS NOT NULL AND invoice_no <> '';

CREATE TABLE expense_attachment (
  id UUID PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES expense_claim(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  attachment_kind VARCHAR(30) NOT NULL CHECK (attachment_kind IN ('EXPENSE_PROOF','NO_RECEIPT_EXPLANATION','PAYMENT_PROOF')),
  storage_key VARCHAR(500) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(120) NOT NULL CHECK (content_type IN ('image/jpeg','image/png','application/pdf')),
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  sha256 VARCHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-fA-F]{64}$'),
  uploaded_by_user_id UUID NOT NULL REFERENCES app_user(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(claim_id, storage_key)
);

CREATE INDEX expense_attachment_claim_idx
  ON expense_attachment(claim_id, active, created_at);
CREATE INDEX expense_attachment_duplicate_idx
  ON expense_attachment(tenant_id, sha256, created_at DESC);

CREATE TABLE expense_review_history (
  id UUID PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES expense_claim(id),
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  action VARCHAR(20) NOT NULL CHECK (action IN ('SUBMIT','RESUBMIT','WITHDRAW','APPROVE','RETURN','REJECT','PAY','VOID_PAYMENT')),
  from_status VARCHAR(20) CHECK (from_status IN ('DRAFT','SUBMITTED','RETURNED','APPROVED','REJECTED','WITHDRAWN','PAID')),
  to_status VARCHAR(20) NOT NULL CHECK (to_status IN ('DRAFT','SUBMITTED','RETURNED','APPROVED','REJECTED','WITHDRAWN','PAID')),
  comment TEXT,
  snapshot JSONB,
  actor_user_id UUID NOT NULL REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX expense_review_history_claim_idx
  ON expense_review_history(claim_id, created_at DESC);
CREATE INDEX expense_review_history_actor_idx
  ON expense_review_history(tenant_id, actor_user_id, created_at DESC);

CREATE TABLE expense_payment (
  id UUID PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES expense_claim(id),
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  payment_method VARCHAR(50) NOT NULL,
  payment_date DATE NOT NULL,
  payment_reference VARCHAR(160),
  note TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','VOIDED')),
  created_by_user_id UUID NOT NULL REFERENCES app_user(id),
  voided_by_user_id UUID REFERENCES app_user(id),
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  UNIQUE(claim_id)
);

CREATE INDEX expense_payment_store_date_idx
  ON expense_payment(tenant_id, store_id, payment_date DESC, status);

COMMENT ON TABLE expense_category IS 'Tenant-level expense and reimbursement categories';
COMMENT ON TABLE expense_claim IS 'Store-scoped reimbursement claims submitted for finance approval';
COMMENT ON TABLE expense_attachment IS 'Receipt, explanation and payment proof metadata';
COMMENT ON TABLE expense_review_history IS 'Immutable reimbursement workflow history';
COMMENT ON TABLE expense_payment IS 'Finance-confirmed reimbursement payment record';
COMMENT ON COLUMN expense_claim.duplicate_warning IS 'Structured duplicate-check result captured at submission time';

INSERT INTO permission(id, code, name, module) VALUES
  ('91000000-0000-0000-0000-000000000018', 'EXPENSE_SUBMIT', '提交费用报销', 'EXPENSE'),
  ('91000000-0000-0000-0000-000000000019', 'EXPENSE_STORE_VIEW', '查看本门店报销', 'EXPENSE'),
  ('91000000-0000-0000-0000-000000000020', 'EXPENSE_REVIEW', '审核费用报销', 'EXPENSE'),
  ('91000000-0000-0000-0000-000000000021', 'EXPENSE_PAY', '确认报销付款', 'EXPENSE'),
  ('91000000-0000-0000-0000-000000000022', 'EXPENSE_CONFIG', '配置费用分类', 'EXPENSE'),
  ('91000000-0000-0000-0000-000000000023', 'EXPENSE_ALL_STORE_VIEW', '查看全部门店报销', 'EXPENSE');

INSERT INTO role(id, tenant_id, code, name) VALUES
  ('90000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'FINANCE', '财务人员');

INSERT INTO role_permission(role_id, permission_id)
SELECT role.id, permission.id
FROM role
JOIN permission ON permission.code LIKE 'EXPENSE_%'
WHERE role.code = 'TENANT_ADMIN';

INSERT INTO role_permission(role_id, permission_id)
SELECT role.id, permission.id
FROM role
JOIN permission ON permission.code IN ('EXPENSE_SUBMIT','EXPENSE_STORE_VIEW')
WHERE role.code = 'STORE_MANAGER';

INSERT INTO role_permission(role_id, permission_id)
SELECT role.id, permission.id
FROM role
JOIN permission ON permission.code IN ('EXPENSE_STORE_VIEW','EXPENSE_REVIEW','EXPENSE_PAY','EXPENSE_CONFIG','EXPENSE_ALL_STORE_VIEW')
WHERE role.code = 'FINANCE';

INSERT INTO expense_category(id, tenant_id, parent_id, code, name, category_level, receipt_required, no_receipt_allowed, sort_order) VALUES
  ('93000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', NULL, 'SALARY_BENEFITS', '工资福利', 1, TRUE, FALSE, 10),
  ('93000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', NULL, 'OPERATING_COST', '运营费用', 1, TRUE, FALSE, 20),
  ('93000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', NULL, 'FIXED_COST', '固定成本', 1, TRUE, FALSE, 30),
  ('93000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', NULL, 'DAILY_CONSUMABLES', '日常消耗', 1, TRUE, FALSE, 40),
  ('93000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', NULL, 'NO_RECEIPT_EXPENSE', '无票消费', 1, FALSE, TRUE, 50),
  ('93000000-0000-0000-0000-000000000101', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000001', 'EMPLOYEE_WAGES', '员工工资', 2, TRUE, FALSE, 10),
  ('93000000-0000-0000-0000-000000000102', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000001', 'EMPLOYEE_ACCOMMODATION', '员工住宿', 2, TRUE, FALSE, 20),
  ('93000000-0000-0000-0000-000000000103', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000001', 'EMPLOYEE_BENEFITS', '员工福利', 2, TRUE, FALSE, 30),
  ('93000000-0000-0000-0000-000000000201', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000002', 'LOGISTICS_DELIVERY', '运输配送', 2, TRUE, FALSE, 10),
  ('93000000-0000-0000-0000-000000000202', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000002', 'MARKETING_PROMOTION', '营销推广', 2, TRUE, FALSE, 20),
  ('93000000-0000-0000-0000-000000000203', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000002', 'OFFICE_ADMIN', '办公行政', 2, TRUE, FALSE, 30),
  ('93000000-0000-0000-0000-000000000301', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000003', 'RENT_PROPERTY', '房租物业', 2, TRUE, FALSE, 10),
  ('93000000-0000-0000-0000-000000000302', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000003', 'WATER_ELECTRICITY', '水电费用', 2, TRUE, FALSE, 20),
  ('93000000-0000-0000-0000-000000000303', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000003', 'EQUIPMENT_MAINTENANCE', '设备维护', 2, TRUE, FALSE, 30),
  ('93000000-0000-0000-0000-000000000401', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000004', 'KITCHEN_CONSUMABLES', '后厨耗材', 2, TRUE, FALSE, 10),
  ('93000000-0000-0000-0000-000000000402', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000004', 'STORE_CONSUMABLES', '店面耗材', 2, TRUE, FALSE, 20),
  ('93000000-0000-0000-0000-000000000403', '11111111-1111-1111-1111-111111111111', '93000000-0000-0000-0000-000000000004', 'GUEST_ROOM_CONSUMABLES', '客房耗材', 2, TRUE, FALSE, 30);
