CREATE SEQUENCE settlement_number_seq START WITH 100000;

ALTER TABLE sales_order ADD COLUMN settlement_no VARCHAR(40);
ALTER TABLE sales_order ADD COLUMN cashier_name_snapshot VARCHAR(120);

UPDATE sales_order
SET settlement_no = 'JS' || to_char(settled_at AT TIME ZONE 'Asia/Shanghai', 'YYMMDD') || lpad(nextval('settlement_number_seq')::text, 7, '0')
WHERE status = 'SETTLED' AND settlement_no IS NULL;

UPDATE sales_order AS sales
SET cashier_name_snapshot = (
  SELECT operator_name_snapshot
  FROM cashier_shift
  WHERE store_id = sales.store_id
    AND opened_at <= sales.settled_at
    AND (closed_at IS NULL OR closed_at >= sales.settled_at)
  ORDER BY opened_at DESC
  LIMIT 1
)
WHERE sales.status = 'SETTLED' AND sales.cashier_name_snapshot IS NULL;

CREATE UNIQUE INDEX sales_order_store_settlement_no_idx ON sales_order(store_id, settlement_no) WHERE settlement_no IS NOT NULL;
