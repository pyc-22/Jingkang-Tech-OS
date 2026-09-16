-- PostgreSQL 16 / psql. Run in a NEW session, before the cleanup transaction.
-- Read-only diagnostics: no business data or schema changes, always ROLLBACK.
-- Order scope uses sales_order.business_date, not timestamps or commission dates.
\pset pager off
\set ON_ERROR_STOP off
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

\echo '1. Actual commission columns and incoming/outgoing constraints'
SELECT ordinal_position,column_name,data_type,is_nullable,column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='technician_commission_record'
ORDER BY ordinal_position;

SELECT c.conrelid::regclass AS table_name,c.conname,c.contype,
       c.confrelid::regclass AS referenced_table,pg_get_constraintdef(c.oid) AS definition
FROM pg_catalog.pg_constraint c
WHERE c.conrelid='public.technician_commission_record'::regclass
   OR (c.contype='f' AND c.confrelid='public.technician_commission_record'::regclass)
ORDER BY c.conrelid::regclass::text,c.conname;

\echo '2. Expected orders 40/11/19; protected MEMBER_BALANCE orders 2/0/0; deletion orders 38/11/19'
SELECT d::date AS business_date,count(o.id) AS orders,
       count(o.id) FILTER (WHERE EXISTS (SELECT 1 FROM public.payment_record p
         WHERE p.order_id=o.id AND p.payment_method='MEMBER_BALANCE')) AS protected_orders,
       count(o.id) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.payment_record p
         WHERE p.order_id=o.id AND p.payment_method='MEMBER_BALANCE')) AS delete_orders
FROM generate_series(TIMESTAMP '2026-09-05',TIMESTAMP '2026-09-07',INTERVAL '1 day') d
LEFT JOIN public.sales_order o
  ON o.store_id='f3448132-92a9-4263-af9f-f34acf5c310e' AND o.business_date=d::date
GROUP BY d ORDER BY d;

\echo '3. Commissions: order scope wins; matching commission store/date alone never selects a row for deletion'
WITH orders AS (
  SELECT o.*,o.store_id='f3448132-92a9-4263-af9f-f34acf5c310e'
               AND o.business_date BETWEEN DATE '2026-09-05' AND DATE '2026-09-07' AS in_scope,
         EXISTS (SELECT 1 FROM public.payment_record p
                 WHERE p.order_id=o.id AND p.payment_method='MEMBER_BALANCE') AS member_balance
  FROM public.sales_order o
)
SELECT c.id AS commission_id,c.order_id,
       c.store_id AS commission_store_id,o.store_id AS order_store_id,
       c.business_date AS commission_business_date,o.business_date AS order_business_date,
       c.store_id IS DISTINCT FROM o.store_id AS store_mismatch,
       c.business_date IS DISTINCT FROM o.business_date AS date_mismatch,
       (c.business_date IS NULL OR c.business_date NOT BETWEEN DATE '2026-09-05' AND DATE '2026-09-07') AS date_outside_range,
       to_jsonb(c)->>'record_type' AS record_type,to_jsonb(c)->>'commission_cents' AS commission_cents,
       CASE WHEN o.id IS NULL THEN 'BLOCK_MISSING_ORDER'
            WHEN NOT o.in_scope THEN 'KEEP_OTHER_ORDER'
            WHEN o.member_balance THEN 'KEEP_MEMBER_BALANCE'
            WHEN c.store_id IS DISTINCT FROM o.store_id THEN 'BLOCK_STORE_MISMATCH'
            WHEN c.business_date IS DISTINCT FROM o.business_date THEN 'REVIEW_DATE_MISMATCH'
            ELSE 'DELETE_BY_ORDER_ID' END AS disposition
FROM public.technician_commission_record c
LEFT JOIN orders o ON o.id=c.order_id
WHERE o.in_scope OR (c.store_id='f3448132-92a9-4263-af9f-f34acf5c310e'
                    AND c.business_date BETWEEN DATE '2026-09-05' AND DATE '2026-09-07')
ORDER BY o.business_date,c.order_id,c.id;

\echo '4. Retained-order commissions referencing target-order dependencies: review separately; cleanup will roll back'
WITH target_orders AS (
  SELECT o.id FROM public.sales_order o
  WHERE o.store_id='f3448132-92a9-4263-af9f-f34acf5c310e'
    AND o.business_date BETWEEN DATE '2026-09-05' AND DATE '2026-09-07'
    AND NOT EXISTS (SELECT 1 FROM public.payment_record p
                    WHERE p.order_id=o.id AND p.payment_method='MEMBER_BALANCE')
), target_services AS (
  SELECT DISTINCT l.service_session_id AS id FROM public.sales_order_service_session l
  JOIN target_orders o ON o.id=l.order_id
), target_references AS (
  SELECT 'order_line_id' AS column_name,l.id FROM public.sales_order_line l JOIN target_orders o ON o.id=l.order_id
  UNION ALL SELECT 'service_session_id',s.id FROM target_services s
  UNION ALL SELECT 'service_session_extension_id',e.id FROM public.service_session_extension e JOIN target_services s ON s.id=e.service_session_id
  UNION ALL SELECT 'service_participant_id',p.id FROM public.service_session_participant p JOIN target_services s ON s.id=p.service_session_id
  UNION ALL SELECT 'refund_id',r.id FROM public.sales_refund r JOIN target_orders o ON o.id=r.order_id
  UNION ALL SELECT 'business_correction_id',b.id FROM public.sales_order_business_correction b JOIN target_orders o ON o.id=b.order_id
  UNION ALL SELECT 'original_commission_record_id',c.id FROM public.technician_commission_record c JOIN target_orders o ON o.id=c.order_id
)
SELECT c.id AS retained_commission_id,c.order_id,c.store_id,c.business_date,
       r.column_name AS conflicting_column,r.id AS referenced_target_id
FROM public.technician_commission_record c
JOIN target_references r ON to_jsonb(c)->>r.column_name=r.id::text
WHERE NOT EXISTS (SELECT 1 FROM target_orders o WHERE o.id=c.order_id)
ORDER BY c.order_id,c.id,r.column_name;

-- An error leaves this read-only transaction aborted; this also ends that state.
ROLLBACK;
\set ON_ERROR_STOP on
