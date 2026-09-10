-- Recalculate settled orders with each store's configured timezone and cutoff,
-- then keep every order-derived ledger on the same business date.

UPDATE sales_order AS sales
SET business_date =
  (sales.settled_at AT TIME ZONE store.timezone)::date
  - CASE
      WHEN (sales.settled_at AT TIME ZONE store.timezone)::time < store.business_day_cutoff THEN 1
      ELSE 0
    END
FROM store
WHERE store.id = sales.store_id
  AND sales.settled_at IS NOT NULL
  AND sales.business_date IS DISTINCT FROM (
    (sales.settled_at AT TIME ZONE store.timezone)::date
    - CASE
        WHEN (sales.settled_at AT TIME ZONE store.timezone)::time < store.business_day_cutoff THEN 1
        ELSE 0
      END
  );

-- A completed refund belongs to the original order's business date, regardless
-- of when the refund was requested or completed.
UPDATE sales_refund AS refund
SET business_date = sales.business_date
FROM sales_order AS sales
WHERE sales.id = refund.order_id
  AND sales.store_id = refund.store_id
  AND refund.status = 'COMPLETED'
  AND refund.business_date IS DISTINCT FROM sales.business_date;

-- Order consumption and member-balance financial corrections store the order
-- UUID in note. Align both sources with their order after the recalculation.
UPDATE wallet_transaction AS wallet
SET business_date = sales.business_date
FROM sales_order AS sales
WHERE sales.id::text = wallet.note
  AND sales.store_id = wallet.store_id
  AND (
    (wallet.source = 'ORDER' AND wallet.transaction_type = 'CONSUMPTION')
    OR (wallet.source = 'ORDER_CORRECTION' AND wallet.transaction_type = 'REFUND')
  )
  AND wallet.business_date IS DISTINCT FROM sales.business_date;

-- Order-refund wallet entries store the refund number in note.
UPDATE wallet_transaction AS wallet
SET business_date = refund.business_date
FROM sales_refund AS refund
WHERE refund.refund_no = wallet.note
  AND refund.store_id = wallet.store_id
  AND refund.status = 'COMPLETED'
  AND wallet.source = 'ORDER_REFUND'
  AND wallet.transaction_type = 'REFUND'
  AND wallet.business_date IS DISTINCT FROM refund.business_date;

-- Settlement, refund reversal, void reversal, and correction commission rows
-- are all derived from an order and must remain in that order's business date.
UPDATE technician_commission_record AS commission
SET business_date = sales.business_date
FROM sales_order AS sales
WHERE sales.id = commission.order_id
  AND sales.store_id = commission.store_id
  AND commission.business_date IS DISTINCT FROM sales.business_date;

-- Abort atomically if any derived row remains out of alignment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sales_order AS sales
    JOIN store ON store.id = sales.store_id
    WHERE sales.settled_at IS NOT NULL
      AND sales.business_date IS DISTINCT FROM (
        (sales.settled_at AT TIME ZONE store.timezone)::date
        - CASE
            WHEN (sales.settled_at AT TIME ZONE store.timezone)::time < store.business_day_cutoff THEN 1
            ELSE 0
          END
      )
  ) THEN
    RAISE EXCEPTION 'V89: sales_order business_date validation failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sales_refund AS refund
    JOIN sales_order AS sales ON sales.id = refund.order_id
    WHERE refund.status = 'COMPLETED'
      AND refund.business_date IS DISTINCT FROM sales.business_date
  ) THEN
    RAISE EXCEPTION 'V89: sales_refund business_date validation failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM wallet_transaction AS wallet
    JOIN sales_order AS sales
      ON sales.id::text = wallet.note
     AND sales.store_id = wallet.store_id
    WHERE (
        (wallet.source = 'ORDER' AND wallet.transaction_type = 'CONSUMPTION')
        OR (wallet.source = 'ORDER_CORRECTION' AND wallet.transaction_type = 'REFUND')
      )
      AND wallet.business_date IS DISTINCT FROM sales.business_date
  ) THEN
    RAISE EXCEPTION 'V89: order wallet business_date validation failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM wallet_transaction AS wallet
    JOIN sales_refund AS refund
      ON refund.refund_no = wallet.note
     AND refund.store_id = wallet.store_id
    WHERE refund.status = 'COMPLETED'
      AND wallet.source = 'ORDER_REFUND'
      AND wallet.transaction_type = 'REFUND'
      AND wallet.business_date IS DISTINCT FROM refund.business_date
  ) THEN
    RAISE EXCEPTION 'V89: refund wallet business_date validation failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM technician_commission_record AS commission
    JOIN sales_order AS sales
      ON sales.id = commission.order_id
     AND sales.store_id = commission.store_id
    WHERE commission.business_date IS DISTINCT FROM sales.business_date
  ) THEN
    RAISE EXCEPTION 'V89: technician commission business_date validation failed';
  END IF;
END $$;
