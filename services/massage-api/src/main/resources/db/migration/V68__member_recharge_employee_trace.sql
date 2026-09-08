ALTER TABLE wallet_transaction ADD COLUMN employee_id UUID REFERENCES employee(id);
ALTER TABLE wallet_transaction ADD COLUMN employee_name_snapshot VARCHAR(120);

CREATE INDEX wallet_transaction_store_employee_idx
  ON wallet_transaction(store_id, employee_id, created_at DESC)
  WHERE employee_id IS NOT NULL;
