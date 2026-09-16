-- PostgreSQL 16 / psql only. Run in a NEW interactive psql session with -X.
-- Stop application writers and scheduled jobs first: table locks block writes.
-- Verify the backup with pg_restore --list (and preferably a test restore).
-- The SQL check below only verifies a readable, nonempty custom-format archive.
-- Run: \i 'C:/wwwroot/jingkang-platform/update/clear_orders_20260905_07.sql'
-- On success, inspect the results, then type COMMIT; or ROLLBACK; in THIS session.
-- Running with psql -f exits without committing and rolls everything back.
-- Never use --single-transaction, disable triggers, or run only selected lines.
-- No password is stored here. No permanent schema objects are created.
-- First run diagnose_commissions_20260905_07.sql. Commission candidates come ONLY
-- from the 68 target order IDs. Retained-order commissions are never added via FKs.
-- Same-store date anomalies need individual review below; store mismatches abort.

\pset pager off
\set ON_ERROR_STOP off
BEGIN;
DO $clear_orders$
DECLARE
  target_store constant uuid := 'f3448132-92a9-4263-af9f-f34acf5c310e';
  first_day constant date := DATE '2026-09-05';
  last_day constant date := DATE '2026-09-07';
  -- After diagnosis, add ONLY reviewed commission UUIDs with date mismatches.
  -- This acknowledges deleting those rows despite their recorded business dates;
  -- it does not change dates, expand the order set, or approve other-store rows.
  reviewed_commission_date_ids constant uuid[] := ARRAY[]::uuid[];
  backup_file constant text := 'C:/wwwroot/jingkang-platform/backup/massage_platform_before_clear_20260916_144857.dump';
  table_names constant text[] := ARRAY[
    'sales_order', 'sales_order_line', 'payment_record',
    'sales_refund', 'sales_refund_line', 'refund_payment_record',
    'sales_order_service_session', 'sales_order_business_correction',
    'sales_order_financial_correction', 'sales_order_financial_correction_payment',
    'technician_commission_record', 'administrative_referral_record',
    'service_session', 'service_session_participant', 'service_session_extension',
    'service_dispatch_event', 'service_transfer_request', 'service_room_transfer',
    'service_session_clock_reminder', 'service_session_duration_change_log',
    'service_session_item_change_log', 'service_session_extension_cancel_log',
    'service_session_extension_change_log', 'service_extension_intent',
    'technician_queue_event', 'daily_operating_report', 'daily_operating_report_revision',
    'cashier_shift', 'cashier_shift_payment_summary'
  ];
  name text;
  relation oid;
  item record;
  fk record;
  n bigint;
  added bigint;
  bad boolean;
BEGIN
  PERFORM set_config('search_path', 'pg_catalog,public,pg_temp', true);
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '5min', true);
  PERFORM set_config('idle_in_transaction_session_timeout', '10min', true);
  IF current_database() <> 'massage_platform' THEN
    RAISE EXCEPTION 'Wrong database: %, expected massage_platform', current_database();
  END IF;
  IF (pg_stat_file(backup_file)).size <= 5
     OR pg_read_binary_file(backup_file, 0, 5) <> decode('5047444d50', 'hex') THEN
    RAISE EXCEPTION 'Backup is empty or not a PostgreSQL custom archive: %', backup_file;
  END IF;
  RAISE NOTICE 'Backup header readable: %. Full restore validation is a separate prerequisite.', backup_file;

  CREATE TEMP TABLE _clear_tables (rel oid PRIMARY KEY, name text NOT NULL, done boolean DEFAULT false) ON COMMIT DROP;
  CREATE TEMP TABLE _clear_rows (rel oid NOT NULL, id uuid NOT NULL, PRIMARY KEY(rel,id)) ON COMMIT DROP;
  CREATE TEMP TABLE _clear_snapshot (rel oid NOT NULL, id uuid NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(rel,id)) ON COMMIT DROP;
  CREATE TEMP TABLE _clear_counts (business_date date PRIMARY KEY, before_count bigint, kept_count bigint, after_count bigint) ON COMMIT DROP;
  CREATE TEMP TABLE _clear_log (step integer GENERATED ALWAYS AS IDENTITY, table_name text, deleted_count bigint) ON COMMIT DROP;

  FOREACH name IN ARRAY table_names LOOP
    relation := to_regclass(format('public.%I', name));
    IF relation IS NOT NULL THEN
      INSERT INTO pg_temp._clear_tables(rel,name) VALUES(relation,name);
    ELSE
      RAISE NOTICE 'Table absent (older/newer schema): %', name;
    END IF;
  END LOOP;
  -- These core tables must exist; optional history tables are discovered above.
  FOREACH name IN ARRAY ARRAY['sales_order','payment_record','sales_order_line',
    'sales_order_service_session','service_session','daily_operating_report',
    'cashier_shift','member_wallet','wallet_transaction','technician_commission_record'] LOOP
    IF to_regclass(format('public.%I',name)) IS NULL THEN
      RAISE EXCEPTION 'Required table missing: %', name;
    END IF;
  END LOOP;

  -- Include EVERY incoming FK, including CASCADE/SET NULL and unknown tables.
  CREATE TEMP TABLE _clear_fk ON COMMIT DROP AS
    SELECT c.oid, c.conname, c.conrelid child, c.confrelid parent,
           c.conkey, c.confkey, c.convalidated,
           a.attname child_column, b.attname parent_column,
           pg_get_constraintdef(c.oid) definition
    FROM pg_constraint c
    LEFT JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    LEFT JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=c.confkey[1]
    WHERE c.contype='f' AND c.confrelid IN (SELECT rel FROM pg_temp._clear_tables);

  FOR item IN
    SELECT rel FROM pg_temp._clear_tables
    UNION SELECT child FROM pg_temp._clear_fk
    UNION SELECT 'public.member_wallet'::regclass::oid
    UNION SELECT 'public.wallet_transaction'::regclass::oid
    ORDER BY 1
  LOOP
    EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE', item.rel::regclass);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_temp._clear_fk WHERE cardinality(conkey)<>1
             OR cardinality(confkey)<>1 OR parent_column<>'id' OR NOT convalidated) THEN
    RAISE EXCEPTION 'Unexpected composite/non-id/unvalidated FK. Inspect pg_constraint before proceeding.';
  END IF;
  FOR item IN SELECT rel FROM pg_temp._clear_tables
              UNION SELECT 'public.member_wallet'::regclass::oid
              UNION SELECT 'public.wallet_transaction'::regclass::oid LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=item.rel AND relkind='r' AND NOT relrowsecurity)
       OR EXISTS (SELECT 1 FROM pg_inherits WHERE inhparent=item.rel OR inhrelid=item.rel)
       OR NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a
                      ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
                      WHERE c.conrelid=item.rel AND c.contype='p' AND cardinality(c.conkey)=1
                        AND a.attname='id' AND a.atttypid='uuid'::regtype)
       OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=item.rel AND NOT tgisinternal AND tgenabled<>'D')
       OR EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class=item.rel AND rulename<>'_RETURN') THEN
      RAISE EXCEPTION 'Unexpected table, key, RLS, trigger or rule on %; review required', item.rel::regclass;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.store WHERE id=target_store) THEN
    RAISE EXCEPTION 'Target store does not exist';
  END IF;
  RAISE NOTICE 'Target store: %', (SELECT s.name FROM public.store s WHERE s.id=target_store);
  INSERT INTO pg_temp._clear_counts
    SELECT d::date, count(o.id), count(o.id) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.payment_record p WHERE p.order_id=o.id AND p.payment_method='MEMBER_BALANCE')), NULL
    FROM generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') d
    LEFT JOIN public.sales_order o ON o.store_id=target_store AND o.business_date=d::date
    GROUP BY d;
  FOR item IN SELECT * FROM pg_temp._clear_counts ORDER BY business_date LOOP
    RAISE NOTICE 'BEFORE %: orders=%, protected=%', item.business_date,item.before_count,item.kept_count;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_temp._clear_counts WHERE
      before_count <> CASE business_date WHEN DATE '2026-09-05' THEN 40 WHEN DATE '2026-09-06' THEN 11 ELSE 19 END
      OR kept_count <> CASE business_date WHEN DATE '2026-09-05' THEN 2 ELSE 0 END) THEN
    RAISE EXCEPTION 'Expected orders 40/11/19 and MEMBER_BALANCE orders 2/0/0; no deletion performed';
  END IF;

  INSERT INTO pg_temp._clear_rows
    SELECT 'public.sales_order'::regclass, o.id FROM public.sales_order o
    WHERE o.store_id=target_store AND o.business_date BETWEEN first_day AND last_day
      AND NOT EXISTS (SELECT 1 FROM public.payment_record p
                      WHERE p.order_id=o.id AND p.payment_method='MEMBER_BALANCE');
  IF (SELECT count(*) FROM pg_temp._clear_rows) <> 68 THEN
    RAISE EXCEPTION 'Expected exactly 68 target orders';
  END IF;

  -- Fix the commission set by order ownership, never by its store/date or other FKs.
  CREATE TEMP TABLE _clear_commission_review ON COMMIT DROP AS
    SELECT c.id,c.order_id,c.store_id AS commission_store_id,o.store_id AS order_store_id,
           c.business_date AS commission_business_date,o.business_date AS order_business_date,
           c.store_id IS DISTINCT FROM o.store_id AS store_mismatch,
           c.business_date IS DISTINCT FROM o.business_date AS date_mismatch
    FROM public.technician_commission_record c
    JOIN pg_temp._clear_rows r ON r.rel='public.sales_order'::regclass AND r.id=c.order_id
    JOIN public.sales_order o ON o.id=c.order_id;
  INSERT INTO pg_temp._clear_rows
    SELECT 'public.technician_commission_record'::regclass,id FROM pg_temp._clear_commission_review;
  FOR item IN SELECT * FROM pg_temp._clear_commission_review
              WHERE store_mismatch OR date_mismatch ORDER BY order_id,id LOOP
    RAISE NOTICE 'COMMISSION_REVIEW id=%, order_id=%, commission_store=%, order_store=%, commission_date=%, order_date=%',
      item.id,item.order_id,item.commission_store_id,item.order_store_id,
      item.commission_business_date,item.order_business_date;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_temp._clear_commission_review WHERE store_mismatch) THEN
    RAISE EXCEPTION 'Commission store mismatch; all data retained. Resolve the listed ownership conflicts separately.';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(reviewed_commission_date_ids) AS approved(id)
             WHERE NOT EXISTS (SELECT 1 FROM pg_temp._clear_commission_review c
                               WHERE c.id=approved.id AND c.date_mismatch AND NOT c.store_mismatch)) THEN
    RAISE EXCEPTION 'Reviewed commission ID is not a same-store date anomaly on a target order';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp._clear_commission_review
             WHERE date_mismatch AND NOT (id=ANY(reviewed_commission_date_ids))) THEN
    RAISE EXCEPTION 'Unreviewed commission date mismatch; all data retained. Inspect diagnosis and explicitly review individual IDs before retrying.';
  END IF;
  INSERT INTO pg_temp._clear_rows
    SELECT DISTINCT 'public.service_session'::regclass, l.service_session_id
    FROM public.sales_order_service_session l JOIN pg_temp._clear_rows r
      ON r.rel='public.sales_order'::regclass AND r.id=l.order_id;
  INSERT INTO pg_temp._clear_rows
    SELECT 'public.daily_operating_report'::regclass,id FROM public.daily_operating_report
    WHERE store_id=target_store AND business_date BETWEEN first_day AND last_day;
  INSERT INTO pg_temp._clear_rows
    SELECT 'public.cashier_shift'::regclass,id FROM public.cashier_shift
    WHERE store_id=target_store AND business_date BETWEEN first_day AND last_day;

  -- Only follow incoming references into the explicit child-table allowlist.
  -- Never enlarge the four root sets or the order-owned commission set.
  LOOP
    added := 0;
    FOR fk IN SELECT f.* FROM pg_temp._clear_fk f JOIN pg_temp._clear_tables t ON t.rel=f.child
      WHERE t.name NOT IN ('sales_order','service_session','daily_operating_report','cashier_shift','technician_commission_record') LOOP
      EXECUTE format('INSERT INTO pg_temp._clear_rows SELECT %s,c.id FROM %s c JOIN pg_temp._clear_rows r ON r.rel=%s AND r.id=c.%I ON CONFLICT DO NOTHING',
                     fk.child,fk.child::regclass,fk.parent,fk.child_column);
      GET DIAGNOSTICS n = ROW_COUNT;
      added := added+n;
    END LOOP;
    EXIT WHEN added=0;
  END LOOP;

  -- Abort instead of removing records belonging to another store/date/order.
  -- Commission ownership/date anomalies were checked individually above.
  FOR item IN SELECT * FROM pg_temp._clear_tables t WHERE t.name<>'technician_commission_record' LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s c JOIN pg_temp._clear_rows r ON r.rel=$1 AND r.id=c.id WHERE (to_jsonb(c)->>''store_id'' IS NOT NULL AND (to_jsonb(c)->>''store_id'')::uuid<>$2) OR (to_jsonb(c)->>''business_date'' IS NOT NULL AND (to_jsonb(c)->>''business_date'')::date NOT BETWEEN $3 AND $4))', item.rel::regclass)
      INTO bad USING item.rel,target_store,first_day,last_day;
    IF bad THEN RAISE EXCEPTION 'Cross-store/date dependency in %', item.name; END IF;
  END LOOP;
  FOR fk IN SELECT * FROM pg_temp._clear_fk LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_temp._clear_tables WHERE rel=fk.child) THEN
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s c JOIN pg_temp._clear_rows r ON r.rel=$1 AND r.id=c.%I)', fk.child::regclass,fk.child_column)
        INTO bad USING fk.parent;
    ELSE
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s c JOIN pg_temp._clear_rows r ON r.rel=$1 AND r.id=c.%I WHERE NOT EXISTS(SELECT 1 FROM pg_temp._clear_rows x WHERE x.rel=$2 AND x.id=c.id))', fk.child::regclass,fk.child_column)
        INTO bad USING fk.parent,fk.child;
    END IF;
    IF bad THEN RAISE EXCEPTION 'Protected/unknown dependent rows via %.%: %', fk.child::regclass,fk.conname,fk.definition; END IF;
    IF EXISTS (SELECT 1 FROM pg_temp._clear_tables WHERE rel=fk.child) THEN
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s c JOIN pg_temp._clear_rows r ON r.rel=$1 AND r.id=c.id WHERE c.%I IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_temp._clear_rows p WHERE p.rel=$2 AND p.id=c.%I))', fk.child::regclass,fk.child_column,fk.child_column)
        INTO bad USING fk.child,fk.parent;
      IF bad THEN RAISE EXCEPTION 'Target row also references a retained record via %.%; inspect shared services/corrections', fk.child::regclass,fk.conname; END IF;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.wallet_transaction w JOIN pg_temp._clear_rows r
             ON w.note=r.id::text
             WHERE (r.rel='public.sales_order'::regclass AND w.source IN ('ORDER','ORDER_CORRECTION'))
                OR (r.rel=to_regclass('public.sales_refund') AND w.source='ORDER_REFUND')) THEN
    RAISE EXCEPTION 'Target order/refund has wallet history; review payment corrections before deleting';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cashier_shift s JOIN pg_temp._clear_rows r
             ON r.rel='public.cashier_shift'::regclass AND r.id=s.id WHERE s.status='OPEN') THEN
    RAISE EXCEPTION 'Target cashier shift is still OPEN; review before deleting';
  END IF;

  -- Exact snapshots of ALL retained rows in touched tables and BOTH wallet tables.
  FOR item IN SELECT rel FROM pg_temp._clear_tables
              UNION SELECT 'public.member_wallet'::regclass::oid
              UNION SELECT 'public.wallet_transaction'::regclass::oid LOOP
    EXECUTE format('INSERT INTO pg_temp._clear_snapshot SELECT $1,c.id,to_jsonb(c) FROM %s c WHERE NOT EXISTS(SELECT 1 FROM pg_temp._clear_rows r WHERE r.rel=$1 AND r.id=c.id)', item.rel::regclass)
      USING item.rel;
  END LOOP;

  -- Sort actual table dependencies. Self references are removed in ONE statement.
  -- Cross-table cycles stop the transaction; no constraints are disabled.
  LOOP
    SELECT t.* INTO item FROM pg_temp._clear_tables t
    WHERE NOT t.done AND NOT EXISTS (
      SELECT 1 FROM pg_temp._clear_fk f JOIN pg_temp._clear_tables child ON child.rel=f.child
      WHERE f.parent=t.rel AND f.child<>f.parent AND NOT child.done)
    ORDER BY t.name LIMIT 1;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM pg_temp._clear_tables WHERE NOT done) THEN
        RAISE EXCEPTION 'Cross-table FK cycle detected; all changes will roll back';
      END IF;
      EXIT;
    END IF;
    EXECUTE format('DELETE FROM %s c USING pg_temp._clear_rows r WHERE r.rel=$1 AND r.id=c.id', item.rel::regclass) USING item.rel;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> (SELECT count(*) FROM pg_temp._clear_rows WHERE rel=item.rel) THEN
      RAISE EXCEPTION 'Unexpected delete count for %', item.name;
    END IF;
    INSERT INTO pg_temp._clear_log(table_name,deleted_count) VALUES(item.name,n);
    UPDATE pg_temp._clear_tables SET done=true WHERE rel=item.rel;
  END LOOP;
  SET CONSTRAINTS ALL IMMEDIATE;

  FOR item IN SELECT rel FROM pg_temp._clear_tables
              UNION SELECT 'public.member_wallet'::regclass::oid
              UNION SELECT 'public.wallet_transaction'::regclass::oid LOOP
    EXECUTE format('SELECT EXISTS((SELECT c.id,to_jsonb(c) FROM %s c EXCEPT SELECT id,payload FROM pg_temp._clear_snapshot WHERE rel=$1) UNION ALL (SELECT id,payload FROM pg_temp._clear_snapshot WHERE rel=$1 EXCEPT SELECT c.id,to_jsonb(c) FROM %s c))', item.rel::regclass,item.rel::regclass)
      INTO bad USING item.rel;
    IF bad THEN RAISE EXCEPTION 'Retained rows changed in %; rolling back', item.rel::regclass; END IF;
  END LOOP;
  UPDATE pg_temp._clear_counts c SET after_count=(
    SELECT count(*) FROM public.sales_order o WHERE o.store_id=target_store AND o.business_date=c.business_date);
  IF EXISTS (SELECT 1 FROM pg_temp._clear_counts WHERE after_count<>kept_count) THEN
    RAISE EXCEPTION 'Final order counts differ from 2/0/0; rolling back';
  END IF;
  RAISE NOTICE 'CHECKS PASSED. 68 orders deleted inside the UNCOMMITTED transaction. Wallets and all retained rows are unchanged.';
END
$clear_orders$;

\if :ERROR
  ROLLBACK;
  \echo 'FAILED: transaction rolled back. Do not issue COMMIT. Review the error above.'
\else
  SELECT business_date,before_count,kept_count,after_count FROM pg_temp._clear_counts ORDER BY business_date;
  SELECT step,table_name,deleted_count FROM pg_temp._clear_log ORDER BY step;
  SELECT * FROM pg_temp._clear_commission_review WHERE date_mismatch ORDER BY order_id,id;
  SELECT rel::regclass AS wallet_table,count(*) AS unchanged_rows
    FROM pg_temp._clear_snapshot
    WHERE rel IN ('public.member_wallet'::regclass,'public.wallet_transaction'::regclass) GROUP BY rel;
  SELECT child::regclass AS child_table,parent::regclass AS parent_table,conname,definition
    FROM pg_temp._clear_fk ORDER BY child::regclass::text,conname;
  \echo 'SUCCESS, NOT COMMITTED. Expected remaining orders: 2026-09-05=2, 2026-09-06=0, 2026-09-07=0.'
  \echo 'Review results, then type COMMIT; or ROLLBACK; in this same session.'
  \echo 'Disconnecting or leaving the transaction idle for 10 minutes rolls it back.'
  -- COMMIT;
\endif
\set ON_ERROR_STOP on
