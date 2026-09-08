CREATE TABLE employee (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(30),
  employment_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (employment_status IN ('ACTIVE','INACTIVE','LEFT')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  note VARCHAR(240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX employee_tenant_active_idx
  ON employee(tenant_id,active,full_name);

CREATE TABLE employee_store_assignment (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  employee_id UUID NOT NULL REFERENCES employee(id),
  store_id UUID NOT NULL REFERENCES store(id),
  employee_no VARCHAR(40),
  position_type VARCHAR(30) NOT NULL
    CHECK (position_type IN ('STORE_MANAGER','CASHIER','TECHNICIAN','CLEANER','CHEF','FINANCE','OTHER')),
  position_name VARCHAR(80) NOT NULL,
  employment_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (employment_status IN ('ACTIVE','INACTIVE','LEFT')),
  hired_on DATE,
  left_on DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  note VARCHAR(240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  CHECK (left_on IS NULL OR hired_on IS NULL OR left_on >= hired_on),
  UNIQUE(employee_id,store_id)
);

CREATE UNIQUE INDEX employee_store_assignment_no_idx
  ON employee_store_assignment(store_id,employee_no)
  WHERE employee_no IS NOT NULL;

CREATE INDEX employee_store_assignment_scope_idx
  ON employee_store_assignment(tenant_id,store_id,active,position_type);

CREATE TABLE employee_user_link (
  employee_id UUID PRIMARY KEY REFERENCES employee(id),
  user_id UUID NOT NULL UNIQUE REFERENCES app_user(id),
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE technician
  ADD COLUMN employee_id UUID REFERENCES employee(id);

WITH source AS (
  SELECT technician.id technician_id,gen_random_uuid() employee_id,technician.tenant_id,
         technician.name full_name,technician.phone,technician.employment_status,
         technician.active,technician.created_at,technician.updated_at
  FROM technician
), inserted AS (
  INSERT INTO employee(id,tenant_id,full_name,phone,employment_status,active,note,created_at,updated_at)
  SELECT employee_id,tenant_id,full_name,phone,employment_status,active,
         '由历史技师档案回填',created_at,updated_at
  FROM source
  RETURNING id
)
UPDATE technician
SET employee_id=source.employee_id
FROM source
WHERE technician.id=source.technician_id;

INSERT INTO employee_store_assignment(
  id,tenant_id,employee_id,store_id,employee_no,position_type,position_name,
  employment_status,active,note,created_at,updated_at
)
SELECT gen_random_uuid(),technician.tenant_id,technician.employee_id,technician.store_id,
       technician.code,'TECHNICIAN','技师',technician.employment_status,technician.active,
       '由历史技师档案回填',technician.created_at,technician.updated_at
FROM technician;

INSERT INTO employee_user_link(employee_id,user_id,tenant_id)
SELECT technician.employee_id,binding.user_id,technician.tenant_id
FROM technician_account_binding binding
JOIN technician ON technician.id=binding.technician_id
ON CONFLICT (employee_id) DO NOTHING;

CREATE UNIQUE INDEX technician_store_employee_idx
  ON technician(store_id,employee_id)
  WHERE employee_id IS NOT NULL;
