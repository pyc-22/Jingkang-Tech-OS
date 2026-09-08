ALTER TABLE store
  ADD COLUMN business_day_cutoff TIME NOT NULL DEFAULT TIME '05:00';

ALTER TABLE service_session ADD COLUMN business_date DATE;

UPDATE service_session session
SET business_date = (session.started_at AT TIME ZONE store.timezone)::date
  - CASE
      WHEN (session.started_at AT TIME ZONE store.timezone)::time < store.business_day_cutoff THEN 1
      ELSE 0
    END
FROM store
WHERE store.id = session.store_id
  AND session.started_at IS NOT NULL;

ALTER TABLE sales_order ADD COLUMN business_date DATE;

UPDATE sales_order sales
SET business_date = COALESCE(
  (
    SELECT min(session.business_date)
    FROM sales_order_service_session link
    JOIN service_session session ON session.id = link.service_session_id
    WHERE link.order_id = sales.id
  ),
  (COALESCE(sales.settled_at, sales.created_at) AT TIME ZONE store.timezone)::date
    - CASE
        WHEN (COALESCE(sales.settled_at, sales.created_at) AT TIME ZONE store.timezone)::time < store.business_day_cutoff THEN 1
        ELSE 0
      END
)
FROM store
WHERE store.id = sales.store_id;

ALTER TABLE sales_order ALTER COLUMN business_date SET NOT NULL;

ALTER TABLE sales_refund ADD COLUMN business_date DATE;

UPDATE sales_refund refund
SET business_date = (refund.completed_at AT TIME ZONE store.timezone)::date
  - CASE
      WHEN (refund.completed_at AT TIME ZONE store.timezone)::time < store.business_day_cutoff THEN 1
      ELSE 0
    END
FROM store
WHERE store.id = refund.store_id
  AND refund.status = 'COMPLETED'
  AND refund.completed_at IS NOT NULL;

ALTER TABLE technician_commission_record ADD COLUMN business_date DATE;

UPDATE technician_commission_record commission
SET business_date = COALESCE(
  (
    SELECT session.business_date
    FROM service_session session
    WHERE session.id = commission.service_session_id
  ),
  sales.business_date
)
FROM sales_order sales
WHERE sales.id = commission.order_id;

ALTER TABLE technician_commission_record ALTER COLUMN business_date SET NOT NULL;

ALTER TABLE wallet_transaction ADD COLUMN business_date DATE;

UPDATE wallet_transaction wallet_tx
SET business_date = COALESCE(
  CASE
    WHEN wallet_tx.source = 'ORDER' THEN (
      SELECT sales.business_date
      FROM sales_order sales
      WHERE sales.id::text = wallet_tx.note
      LIMIT 1
    )
    ELSE NULL
  END,
  (wallet_tx.created_at AT TIME ZONE store.timezone)::date
    - CASE
        WHEN (wallet_tx.created_at AT TIME ZONE store.timezone)::time < store.business_day_cutoff THEN 1
        ELSE 0
      END
)
FROM store
WHERE store.id = wallet_tx.store_id;

ALTER TABLE wallet_transaction ALTER COLUMN business_date SET NOT NULL;

ALTER TABLE cashier_shift ADD COLUMN business_date DATE;

UPDATE cashier_shift shift
SET business_date = (shift.opened_at AT TIME ZONE store.timezone)::date
  - CASE
      WHEN (shift.opened_at AT TIME ZONE store.timezone)::time < store.business_day_cutoff THEN 1
      ELSE 0
    END
FROM store
WHERE store.id = shift.store_id;

ALTER TABLE cashier_shift ALTER COLUMN business_date SET NOT NULL;

CREATE INDEX service_session_store_business_date_idx
  ON service_session(tenant_id, store_id, business_date, status);
CREATE INDEX sales_order_store_business_date_idx
  ON sales_order(tenant_id, store_id, business_date, status);
CREATE INDEX sales_refund_store_business_date_idx
  ON sales_refund(tenant_id, store_id, business_date, status);
CREATE INDEX technician_commission_store_business_date_idx
  ON technician_commission_record(tenant_id, store_id, business_date, technician_id);
CREATE INDEX wallet_transaction_store_business_date_idx
  ON wallet_transaction(tenant_id, store_id, business_date, transaction_type);
CREATE INDEX cashier_shift_store_business_date_idx
  ON cashier_shift(tenant_id, store_id, business_date, status);
