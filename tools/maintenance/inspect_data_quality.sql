-- PostgreSQL 16 / psql. Baseline: migrations through V99.
-- Run in a NEW psql connection, preferably with a read-only database account.
-- Optional -v store_id=UUID -v from_date=YYYY-MM-DD -v to_date=YYYY-MM-DD.
-- Empty store_id means all stores. Default dates are the last 30 days, inclusive.
-- FK checks are schema-wide; wallets use complete history; live occupancy is current.
\set ON_ERROR_STOP on
\pset pager off
\if :{?store_id}
\else
  \set store_id ''
\endif
\if :{?from_date}
\else
  \set from_date ''
\endif
\if :{?to_date}
\else
  \set to_date ''
\endif

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SELECT set_config('review.store_id', coalesce(nullif(:'store_id','')::uuid::text,''), true),
       set_config('review.from_date', coalesce(nullif(:'from_date','')::date,current_date-29)::text, true),
       set_config('review.to_date', coalesce(nullif(:'to_date','')::date,current_date)::text, true);
DO $$ BEGIN
  IF current_setting('review.from_date')::date > current_setting('review.to_date')::date THEN
    RAISE EXCEPTION 'from_date must be on or before to_date';
  END IF;
  IF current_setting('review.store_id') <> '' AND NOT EXISTS (
    SELECT 1 FROM store WHERE id=nullif(current_setting('review.store_id'),'')::uuid
  ) THEN RAISE EXCEPTION 'Selected store does not exist'; END IF;
END $$;
SELECT 'inspection_context' AS section, current_database() AS database,
       now() AS snapshot_time, current_setting('transaction_read_only') AS read_only,
       current_setting('transaction_isolation') AS isolation,
       current_setting('review.store_id') AS selected_store,
       current_setting('review.from_date') AS from_date, current_setting('review.to_date') AS to_date;

-- Inventory is useful even when an FK was installed NOT VALID or its trigger disabled.
SELECT 'constraint_inventory' AS section, c.conrelid::regclass AS child_table,
       c.conname, c.confrelid::regclass AS parent_table, c.convalidated,
       pg_get_constraintdef(c.oid) AS definition,
       EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgconstraint=c.oid AND t.tgenabled IN ('D','R')) AS inactive_in_origin_mode
FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
WHERE c.contype='f' AND n.nspname='public'
ORDER BY c.conrelid::regclass::text,c.conname;

-- Catalog-quoted identifiers; generated commands are SELECT only.
-- MATCH SIMPLE: a partially NULL key is not an orphan. MATCH FULL rejects partial NULLs.
SELECT format(
  'SELECT ''FK_ORPHAN'' AS check_id,%L AS relation,%L AS constraint_name,count(*) AS anomaly_count,min(c.ctid::text) AS sample_ctid FROM %s c WHERE (%s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)) %s;',
  c.conrelid::regclass::text,c.conname,c.conrelid::regclass,
  string_agg(format('c.%I IS NOT NULL',ca.attname),' AND ' ORDER BY k.ord),
  c.confrelid::regclass,
  string_agg(format('p.%I=c.%I',pa.attname,ca.attname),' AND ' ORDER BY k.ord),
  CASE WHEN c.confmatchtype='f' THEN 'OR (('||
    string_agg(format('c.%I IS NULL',ca.attname),' OR ' ORDER BY k.ord)||') AND ('||
    string_agg(format('c.%I IS NOT NULL',ca.attname),' OR ' ORDER BY k.ord)||'))' ELSE '' END)
FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
CROSS JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY k(child_att,parent_att,ord)
JOIN pg_attribute ca ON ca.attrelid=c.conrelid AND ca.attnum=k.child_att
JOIN pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=k.parent_att
WHERE c.contype='f' AND n.nspname='public'
GROUP BY c.oid ORDER BY c.conrelid::regclass::text,c.conname
\gexec

WITH params AS (
  SELECT nullif(current_setting('review.store_id'),'')::uuid store_id,
         current_setting('review.from_date')::date first_date,
         current_setting('review.to_date')::date last_date
), orders AS (
  SELECT o.* FROM sales_order o CROSS JOIN params p
  WHERE (p.store_id IS NULL OR o.store_id=p.store_id) AND o.business_date BETWEEN p.first_date AND p.last_date
), sessions AS (
  SELECT s.* FROM service_session s CROSS JOIN params p WHERE p.store_id IS NULL OR s.store_id=p.store_id
), wallets AS (
  SELECT w.* FROM member_wallet w CROSS JOIN params p
  WHERE p.store_id IS NULL OR w.opened_store_id=p.store_id
     OR EXISTS(SELECT 1 FROM wallet_transaction t WHERE t.wallet_id=w.id AND t.store_id=p.store_id)
), issues(check_id,entity_id,details) AS (
  SELECT 'ORDER_PAYMENT_TOTAL',o.id::text,
    jsonb_build_object('paid',o.paid_cents,'payments',coalesce(sum(t.amount_cents),0))
  FROM orders o LEFT JOIN payment_record t ON t.order_id=o.id WHERE o.status='SETTLED'
  GROUP BY o.id,o.paid_cents HAVING o.paid_cents<>coalesce(sum(t.amount_cents),0)
  UNION ALL
  SELECT 'ORDER_LINE_PRICE_REVIEW',o.id::text,jsonb_build_object('receivable',o.receivable_cents,'lines',coalesce(sum(l.line_amount_cents),0))
  FROM orders o LEFT JOIN sales_order_line l ON l.order_id=o.id WHERE o.status='SETTLED'
  GROUP BY o.id,o.receivable_cents HAVING o.receivable_cents<>coalesce(sum(l.line_amount_cents),0)
  UNION ALL
  SELECT 'PAYMENT_SCOPE',t.id::text,jsonb_build_object('order_id',o.id)
  FROM payment_record t JOIN sales_order o ON o.id=t.order_id CROSS JOIN params p
  WHERE (t.store_id<>o.store_id OR t.tenant_id<>o.tenant_id)
    AND (p.store_id IS NULL OR p.store_id IN (t.store_id,o.store_id)) AND o.business_date BETWEEN p.first_date AND p.last_date
  UNION ALL
  SELECT 'ORDER_OVER_REFUND',o.id::text,jsonb_build_object('paid',o.paid_cents,'reserved_refunds',sum(r.total_cents))
  FROM orders o JOIN sales_refund r ON r.order_id=o.id WHERE r.status<>'CANCELLED'
  GROUP BY o.id,o.paid_cents HAVING sum(r.total_cents)>o.paid_cents
  UNION ALL
  SELECT 'REFUND_TOTAL',r.id::text,jsonb_build_object('total',r.total_cents,'payments',tot.paid,'lines',tot.lines)
  FROM sales_refund r JOIN orders o ON o.id=r.order_id
  CROSS JOIN LATERAL (SELECT
    (SELECT coalesce(sum(amount_cents),0) FROM refund_payment_record WHERE refund_id=r.id AND status='COMPLETED') paid,
    (SELECT coalesce(sum(refund_cents),0) FROM sales_refund_line WHERE refund_id=r.id) lines) tot
  WHERE r.status='COMPLETED' AND (r.total_cents<>tot.paid OR r.total_cents<>tot.lines)
  UNION ALL
  SELECT 'REFUND_PAYMENT_SCOPE',rp.id::text,jsonb_build_object('refund_id',r.id,'payment_id',t.id)
  FROM refund_payment_record rp JOIN sales_refund r ON r.id=rp.refund_id JOIN orders o ON o.id=r.order_id
  JOIN payment_record t ON t.id=rp.original_payment_id
  WHERE t.order_id<>r.order_id OR rp.store_id<>r.store_id OR rp.tenant_id<>r.tenant_id OR t.payment_method<>rp.payment_method
  UNION ALL
  SELECT 'REFUND_LINE_SCOPE',l.id::text,jsonb_build_object('refund_id',r.id)
  FROM sales_refund_line l JOIN sales_refund r ON r.id=l.refund_id JOIN orders o ON o.id=r.order_id
  JOIN sales_order_line ol ON ol.id=l.order_line_id WHERE ol.order_id<>r.order_id
  UNION ALL
  SELECT 'SERVICE_ORDER_SCOPE',l.id::text,jsonb_build_object('order_id',o.id,'session_id',s.id)
  FROM sales_order_service_session l JOIN orders o ON o.id=l.order_id
  JOIN service_session s ON s.id=l.service_session_id JOIN sales_order_line ol ON ol.id=l.order_line_id
  WHERE s.store_id<>o.store_id OR s.tenant_id<>o.tenant_id OR ol.order_id<>o.id
  UNION ALL
  SELECT 'COMMISSION_SCOPE',c.id::text,jsonb_build_object('order_id',o.id,'line_order_id',l.order_id)
  FROM technician_commission_record c JOIN sales_order o ON o.id=c.order_id JOIN sales_order_line l ON l.id=c.order_line_id CROSS JOIN params p
  WHERE (c.store_id<>o.store_id OR c.tenant_id<>o.tenant_id OR l.order_id<>o.id)
    AND (p.store_id IS NULL OR p.store_id IN (o.store_id,c.store_id)) AND o.business_date BETWEEN p.first_date AND p.last_date
  UNION ALL
  SELECT 'COMMISSION_DATE_REVIEW',c.id::text,jsonb_build_object('order_id',o.id,'order_date',o.business_date,'commission_date',c.business_date,'record_type',c.record_type)
  FROM technician_commission_record c JOIN orders o ON o.id=c.order_id WHERE c.business_date IS DISTINCT FROM o.business_date
  UNION ALL
  SELECT 'COMMISSION_REVERSAL_SCOPE',c.id::text,jsonb_build_object('original_id',a.id)
  FROM technician_commission_record c JOIN orders o ON o.id=c.order_id JOIN technician_commission_record a ON a.id=c.original_commission_record_id
  WHERE c.order_id<>a.order_id OR c.technician_id<>a.technician_id OR c.store_id<>a.store_id
  UNION ALL
  SELECT 'SESSION_BED_SCOPE',s.id::text,jsonb_build_object('room_id',s.room_id,'bed_room_id',b.room_id)
  FROM sessions s JOIN room_bed b ON b.id=s.bed_id
  WHERE s.room_id IS DISTINCT FROM b.room_id OR s.store_id<>b.store_id OR s.tenant_id<>b.tenant_id
  UNION ALL
  SELECT 'ACTIVE_BED_DUPLICATE',s.bed_id::text,jsonb_build_object('sessions',count(*)) FROM sessions s
  WHERE s.bed_id IS NOT NULL AND s.status IN ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE')
  GROUP BY s.bed_id HAVING count(*)>1
  UNION ALL
  SELECT 'ROOM_IN_SERVICE_STATE',s.room_id::text,jsonb_build_object('latest_status',e.status)
  FROM sessions s LEFT JOIN LATERAL (
    SELECT status FROM room_status_event WHERE room_id=s.room_id AND store_id=s.store_id ORDER BY occurred_at DESC,id DESC LIMIT 1
  ) e ON true WHERE s.status='IN_SERVICE' AND s.room_id IS NOT NULL AND e.status IS DISTINCT FROM 'IN_SERVICE'
  GROUP BY s.room_id,e.status
  UNION ALL
  SELECT 'PARTICIPANT_SCOPE',a.id::text,jsonb_build_object('session_id',s.id)
  FROM service_session_participant a JOIN sessions s ON s.id=a.service_session_id
  JOIN technician t ON t.id=a.technician_id WHERE a.store_id<>s.store_id OR a.tenant_id<>s.tenant_id OR t.store_id<>s.store_id
  UNION ALL
  SELECT 'WALLET_ROW_EQUATION',t.id::text,jsonb_build_object('wallet_id',w.id,'before',t.balance_before_cents,'amount',t.amount_cents,'after',t.balance_after_cents)
  FROM wallet_transaction t JOIN wallets w ON w.id=t.wallet_id
  WHERE t.balance_before_cents::numeric+t.amount_cents<>t.balance_after_cents
  UNION ALL
  SELECT 'WALLET_MEMBER_SCOPE',t.id::text,jsonb_build_object('wallet_id',w.id)
  FROM wallet_transaction t JOIN wallets w ON w.id=t.wallet_id WHERE t.member_id<>w.member_id OR t.tenant_id<>w.tenant_id
  UNION ALL
  SELECT 'WALLET_HISTORY_REVIEW',w.id::text,jsonb_build_object('balance',w.balance_cents,'all_store_net',coalesce(sum(t.amount_cents),0))
  FROM wallets w LEFT JOIN wallet_transaction t ON t.wallet_id=w.id
  GROUP BY w.id,w.balance_cents HAVING w.balance_cents<>coalesce(sum(t.amount_cents),0)
  UNION ALL
  SELECT 'RECHARGE_OVER_REFUND',t.id::text,jsonb_build_object('principal',coalesce(t.corrected_amount_cents,t.amount_cents),'reserved_refunds',sum(r.amount_cents))
  FROM member_recharge_refund r JOIN wallet_transaction t ON t.id=r.original_transaction_id JOIN wallets w ON w.id=t.wallet_id
  WHERE r.status<>'CANCELLED' GROUP BY t.id,t.amount_cents HAVING sum(r.amount_cents)>coalesce(t.corrected_amount_cents,t.amount_cents)
  UNION ALL
  SELECT 'RECHARGE_REFUND_SCOPE',r.id::text,jsonb_build_object('transaction_id',t.id)
  FROM member_recharge_refund r JOIN wallet_transaction t ON t.id=r.original_transaction_id JOIN wallets w ON w.id=t.wallet_id
  WHERE r.member_id<>t.member_id OR r.store_id<>t.store_id OR r.tenant_id<>t.tenant_id OR t.transaction_type<>'RECHARGE'
  UNION ALL
  SELECT 'REFUND_NUMBER_DUPLICATE',min(r.id::text),jsonb_build_object('count',count(*))
  FROM member_recharge_refund r CROSS JOIN params p WHERE p.store_id IS NULL OR p.store_id=r.store_id
  GROUP BY r.store_id,r.refund_no HAVING count(*)>1
  UNION ALL
  SELECT 'BACKFILL_METADATA',o.id::text,jsonb_build_object('business_date',o.business_date,'backfill_date',o.backfill_date)
  FROM orders o WHERE o.is_historical_backfill AND
    (o.backfill_date IS DISTINCT FROM o.business_date OR o.backfill_by IS NULL OR o.backfill_at IS NULL)
  UNION ALL
  SELECT 'BACKFILL_AUDIT_REVIEW',o.id::text,'{}'::jsonb FROM orders o WHERE o.is_historical_backfill
    AND NOT EXISTS(SELECT 1 FROM audit_log a WHERE a.entity_id=o.id AND a.action='HISTORICAL_ORDER_BACKFILLED')
  UNION ALL
  SELECT 'DAILY_SNAPSHOT_REVIEW',d.id::text,jsonb_build_object('stored_sales',d.daily_sales_amount_cents,'live_sales',live.sales,'status',d.status)
  FROM daily_operating_report d CROSS JOIN params p CROSS JOIN LATERAL (
    SELECT coalesce(sum(t.amount_cents),0)-(SELECT coalesce(sum(r.total_cents),0) FROM sales_refund r
      WHERE r.store_id=d.store_id AND r.business_date=d.business_date AND r.status='COMPLETED') sales
    FROM payment_record t JOIN sales_order o ON o.id=t.order_id
    WHERE o.store_id=d.store_id AND o.business_date=d.business_date AND o.status='SETTLED' AND o.paid_cents>0
  ) live WHERE (p.store_id IS NULL OR p.store_id=d.store_id) AND d.business_date BETWEEN p.first_date AND p.last_date
    AND d.daily_sales_amount_cents<>live.sales
  UNION ALL
  SELECT 'SHIFT_CASH_EQUATION',s.id::text,jsonb_build_object('expected',s.expected_cash_cents,'actual',s.actual_cash_cents,'difference',s.cash_difference_cents)
  FROM cashier_shift s CROSS JOIN params p WHERE (p.store_id IS NULL OR p.store_id=s.store_id)
    AND s.business_date BETWEEN p.first_date AND p.last_date AND s.status='CLOSED'
    AND (s.expected_cash_cents IS NULL OR s.actual_cash_cents IS NULL OR s.cash_difference_cents IS DISTINCT FROM s.actual_cash_cents-s.expected_cash_cents)
  UNION ALL
  SELECT 'STALE_OFFLINE_RECEIPT_REVIEW',r.operation_id::text,jsonb_build_object('created_at',r.created_at)
  FROM offline_operation_receipt r WHERE r.status='PROCESSING' AND r.created_at<now()-interval '15 minutes'
), checks(check_id,severity) AS (VALUES
  ('ORDER_PAYMENT_TOTAL','P1'),('ORDER_LINE_PRICE_REVIEW','REVIEW'),('PAYMENT_SCOPE','P1'),('ORDER_OVER_REFUND','P1'),
  ('REFUND_TOTAL','P1'),('REFUND_PAYMENT_SCOPE','P1'),('REFUND_LINE_SCOPE','P1'),('SERVICE_ORDER_SCOPE','P1'),
  ('COMMISSION_SCOPE','P1'),('COMMISSION_DATE_REVIEW','REVIEW'),('COMMISSION_REVERSAL_SCOPE','P1'),
  ('SESSION_BED_SCOPE','P1'),('ACTIVE_BED_DUPLICATE','P1'),('ROOM_IN_SERVICE_STATE','P1'),('PARTICIPANT_SCOPE','P1'),
  ('WALLET_ROW_EQUATION','P1'),('WALLET_MEMBER_SCOPE','P1'),('WALLET_HISTORY_REVIEW','REVIEW'),
  ('RECHARGE_OVER_REFUND','P1'),('RECHARGE_REFUND_SCOPE','P1'),('REFUND_NUMBER_DUPLICATE','P2'),
  ('BACKFILL_METADATA','P2'),('BACKFILL_AUDIT_REVIEW','REVIEW'),('DAILY_SNAPSHOT_REVIEW','REVIEW'),
  ('SHIFT_CASH_EQUATION','P1'),('STALE_OFFLINE_RECEIPT_REVIEW','REVIEW')
), ranked AS (
  SELECT issues.*,row_number() OVER(PARTITION BY check_id ORDER BY entity_id) rn FROM issues
)
SELECT c.check_id,c.severity,count(r.entity_id) anomaly_count,
  coalesce(jsonb_agg(jsonb_build_object('id',r.entity_id,'details',r.details) ORDER BY r.entity_id)
    FILTER(WHERE r.rn<=20),'[]'::jsonb) samples
FROM checks c LEFT JOIN ranked r ON r.check_id=c.check_id GROUP BY c.check_id,c.severity ORDER BY c.severity,c.check_id;

-- REVIEW means reconcile policy/history before drawing a corruption conclusion.
-- Never sort equal-time wallet rows by UUID to invent an accounting sequence.
ROLLBACK;
\echo INSPECTION_COMPLETE_READ_ONLY
