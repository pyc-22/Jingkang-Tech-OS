const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/16/bin';
const script = fs.readFileSync(path.join(__dirname, '../clear_orders_20260905_07.sql'), 'utf8');
const diagnosis = fs.readFileSync(path.join(__dirname, '../diagnose_commissions_20260905_07.sql'), 'utf8');
const store = 'f3448132-92a9-4263-af9f-f34acf5c310e';
const other = '00000000-0000-0000-0000-000000000002';
let dir, port, connection, sql, started = false;

function command(tool, args, options = {}) {
  const result = spawnSync(path.join(bin, `${tool}.exe`), args, {
    encoding:'utf8', windowsHide:true, timeout:60000, maxBuffer:8 * 1024 * 1024, ...options
  });
  assert.equal(result.status, 0, `${tool}: ${result.error || ''}\n${result.stdout || ''}\n${result.stderr || ''}`);
  return (result.stdout || '') + (result.stderr || '');
}
function query(text) {
  return command('psql', [...connection, '-v', 'ON_ERROR_STOP=1', '-At'], { input:text });
}
function execute(extra = '', finish = 'ROLLBACK;') {
  return query(`${extra}\n${sql}\n${finish}\n`);
}

test.before(async () => {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  fs.mkdirSync(path.join(root, '.artifacts'), { recursive:true });
  dir = fs.mkdtempSync(path.join(root, '.artifacts/clear-orders-test-'));
  command('initdb', ['-D', path.join(dir,'pgdata'), '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C']);
  command('pg_ctl', ['-D', path.join(dir,'pgdata'), '-l', path.join(dir,'postgres.log'),
    '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], { stdio:'ignore' });
  started = true;
  command('createdb', ['-h','127.0.0.1','-p',String(port),'-U','postgres','massage_platform']);
  connection = ['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','massage_platform'];
  const backup = path.join(dir, 'backup.dump').replaceAll('\\','/');
  command('pg_dump', ['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','massage_platform','-Fc','-f',backup]);
  sql = script.replace('C:/wwwroot/jingkang-platform/backup/massage_platform_before_clear_20260916_144857.dump',backup);
});
test.after(() => {
  if (started) command('pg_ctl', ['-D',path.join(dir,'pgdata'),'-m','fast','-w','stop'], { stdio:'ignore' });
});

test.beforeEach(() => {
  query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    CREATE TABLE store(id uuid PRIMARY KEY,name text);
    INSERT INTO store VALUES('${store}','Fixture'),('${other}','Other fixture');
    CREATE TABLE sales_order(id uuid PRIMARY KEY,store_id uuid REFERENCES store,business_date date,corrected_from_order_id uuid REFERENCES sales_order);
    CREATE TABLE sales_order_line(id uuid PRIMARY KEY,order_id uuid REFERENCES sales_order);
    CREATE TABLE payment_record(id uuid PRIMARY KEY,store_id uuid,order_id uuid REFERENCES sales_order,payment_method text);
    CREATE TABLE service_session(id uuid PRIMARY KEY,store_id uuid,business_date date);
    CREATE TABLE sales_order_service_session(id uuid PRIMARY KEY,order_id uuid REFERENCES sales_order,order_line_id uuid REFERENCES sales_order_line,service_session_id uuid REFERENCES service_session);
    CREATE TABLE service_session_participant(id uuid PRIMARY KEY,service_session_id uuid REFERENCES service_session,replaced_participant_id uuid REFERENCES service_session_participant);
    CREATE TABLE service_session_extension(id uuid PRIMARY KEY,service_session_id uuid REFERENCES service_session);
    CREATE TABLE sales_refund(id uuid PRIMARY KEY,order_id uuid REFERENCES sales_order);
    CREATE TABLE sales_refund_line(id uuid PRIMARY KEY,refund_id uuid REFERENCES sales_refund,order_line_id uuid REFERENCES sales_order_line);
    CREATE TABLE refund_payment_record(id uuid PRIMARY KEY,refund_id uuid REFERENCES sales_refund,original_payment_id uuid REFERENCES payment_record);
    CREATE TABLE sales_order_business_correction(id uuid PRIMARY KEY,order_id uuid REFERENCES sales_order,order_line_id uuid REFERENCES sales_order_line,service_session_id uuid REFERENCES service_session);
    CREATE TABLE sales_order_financial_correction(id uuid PRIMARY KEY,order_id uuid REFERENCES sales_order);
    CREATE TABLE sales_order_financial_correction_payment(id uuid PRIMARY KEY,correction_id uuid REFERENCES sales_order_financial_correction ON DELETE CASCADE);
    CREATE TABLE technician_commission_record(id uuid PRIMARY KEY,order_id uuid REFERENCES sales_order,order_line_id uuid REFERENCES sales_order_line,service_session_id uuid REFERENCES service_session,service_session_extension_id uuid REFERENCES service_session_extension,service_participant_id uuid REFERENCES service_session_participant,refund_id uuid REFERENCES sales_refund,original_commission_record_id uuid REFERENCES technician_commission_record,business_correction_id uuid REFERENCES sales_order_business_correction,store_id uuid NOT NULL,business_date date NOT NULL);
    CREATE TABLE daily_operating_report(id uuid PRIMARY KEY,store_id uuid,business_date date);
    CREATE TABLE daily_operating_report_revision(id uuid PRIMARY KEY,report_id uuid REFERENCES daily_operating_report);
    CREATE TABLE cashier_shift(id uuid PRIMARY KEY,store_id uuid,business_date date,status text);
    CREATE TABLE cashier_shift_payment_summary(id uuid PRIMARY KEY,shift_id uuid REFERENCES cashier_shift);
    CREATE TABLE member_wallet(id uuid PRIMARY KEY,balance_cents bigint);
    CREATE TABLE wallet_transaction(id uuid PRIMARY KEY,wallet_id uuid REFERENCES member_wallet,amount_cents bigint,source text,note text);
    INSERT INTO member_wallet VALUES(md5('wallet')::uuid,12345);
    INSERT INTO wallet_transaction VALUES(md5('transaction')::uuid,md5('wallet')::uuid,-100,'ORDER',md5('order1')::uuid::text);
    CREATE TABLE fixture_ids AS SELECT n,md5('order'||n)::uuid id,
      CASE WHEN n=71 THEN '${other}'::uuid ELSE '${store}'::uuid END store_id,
      CASE WHEN n<=40 OR n=71 THEN DATE '2026-09-05' WHEN n<=51 THEN DATE '2026-09-06' WHEN n=72 THEN DATE '2026-09-08' ELSE DATE '2026-09-07' END business_date FROM generate_series(1,72) n;
    INSERT INTO sales_order SELECT id,store_id,business_date,NULL FROM fixture_ids;
    INSERT INTO sales_order_line SELECT id,id FROM fixture_ids;
    INSERT INTO payment_record SELECT id,store_id,id,CASE WHEN n<=2 THEN 'MEMBER_BALANCE' ELSE 'CASH' END FROM fixture_ids;
    INSERT INTO payment_record VALUES(md5('mixed')::uuid,'${store}',md5('order2')::uuid,'CASH');
    INSERT INTO service_session SELECT id,store_id,business_date FROM fixture_ids;
    INSERT INTO sales_order_service_session SELECT id,id,id,id FROM fixture_ids;
    INSERT INTO service_session_participant SELECT id,id,NULL FROM fixture_ids;
    INSERT INTO service_session_extension SELECT id,id FROM fixture_ids;
    INSERT INTO sales_refund SELECT id,id FROM fixture_ids;
    INSERT INTO sales_refund_line SELECT id,id,id FROM fixture_ids;
    INSERT INTO refund_payment_record SELECT id,id,id FROM fixture_ids;
    INSERT INTO sales_order_business_correction SELECT id,id,id,id FROM fixture_ids;
    INSERT INTO sales_order_financial_correction SELECT id,id FROM fixture_ids;
    INSERT INTO sales_order_financial_correction_payment SELECT id,id FROM fixture_ids;
    INSERT INTO technician_commission_record SELECT id,id,id,id,id,id,id,NULL,id,store_id,business_date FROM fixture_ids;
    INSERT INTO daily_operating_report SELECT id,store_id,business_date FROM fixture_ids WHERE n IN(1,41,52,71,72);
    INSERT INTO daily_operating_report_revision SELECT id,id FROM daily_operating_report;
    INSERT INTO cashier_shift SELECT id,store_id,business_date,'CLOSED' FROM fixture_ids WHERE n IN(1,41,52,71,72);
    INSERT INTO cashier_shift_payment_summary SELECT id,id FROM cashier_shift;
    UPDATE sales_order SET corrected_from_order_id=md5('order3')::uuid WHERE id=md5('order4')::uuid;
    INSERT INTO service_session_participant VALUES(md5('replacement')::uuid,md5('order3')::uuid,md5('order3')::uuid);
    INSERT INTO technician_commission_record(id,order_id,original_commission_record_id,store_id,business_date) VALUES(md5('reversal')::uuid,md5('order3')::uuid,md5('order3')::uuid,'${store}','2026-09-05');
  `);
});

test('deletes 68 orders in dependency order; retains mixed payments, wallets and outside scope; no implicit commit', () => {
  const output = execute('', `
    SELECT 'remaining='||count(*) FROM sales_order;
    SELECT 'wallet='||balance_cents FROM member_wallet;
    SELECT 'transactions='||count(*) FROM wallet_transaction;
    ROLLBACK;
    SELECT 'restored='||count(*) FROM sales_order;`);
  assert.match(output, /CHECKS PASSED/);
  assert.match(output, /remaining=4/);
  assert.match(output, /wallet=12345/);
  assert.match(output, /transactions=1/);
  assert.match(output, /restored=72/);
  assert.match(output, /2026-09-05\|40\|2\|2/);
  assert.match(output, /2026-09-06\|11\|0\|0/);
  assert.match(output, /2026-09-07\|19\|0\|0/);
  assert.doesNotMatch(output, /ERROR:/);
  assert.doesNotMatch(script, /^\s*COMMIT\s*;/mi);
});

for (const [name, setup, expected] of [
  ['wrong counts', "UPDATE payment_record SET payment_method='CASH' WHERE payment_method='MEMBER_BALANCE';", /Expected orders/],
  ['shared protected service', "UPDATE sales_order_service_session SET service_session_id=md5('order3')::uuid WHERE order_id=md5('order1')::uuid;", /retained record/],
  ['cross-date service', "UPDATE service_session SET business_date='2026-09-08' WHERE id=md5('order3')::uuid;", /Cross-store\/date/],
  ['unknown cascade child', "CREATE TABLE unknown_child(id uuid PRIMARY KEY,order_id uuid REFERENCES sales_order ON DELETE CASCADE); INSERT INTO unknown_child VALUES(gen_random_uuid(),md5('order3')::uuid);", /Protected\/unknown/],
  ['wallet logical reference', "UPDATE wallet_transaction SET note=md5('order3')::uuid::text;", /wallet history/],
  ['protected correction', "UPDATE sales_order SET corrected_from_order_id=md5('order3')::uuid WHERE id=md5('order1')::uuid;", /Protected\/unknown/],
  ['custom delete trigger', "CREATE FUNCTION deny_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected delete error'; END $$; CREATE CONSTRAINT TRIGGER test_delete AFTER DELETE ON sales_order DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION deny_delete();", /Unexpected table/]
]) {
  test(`rolls back without deleting orders on ${name}`, () => {
    const output = execute(setup, "SELECT 'remaining='||count(*) FROM sales_order;");
    assert.match(output, expected);
    assert.match(output, /FAILED: transaction rolled back/);
    assert.match(output, /remaining=72/);
    assert.doesNotMatch(output, /CHECKS PASSED/);
  });
}

test('an error after earlier DELETE statements automatically rolls back the entire transaction', () => {
  const failing = sql.replace("GET DIAGNOSTICS n = ROW_COUNT;\n    IF n <>",
    "GET DIAGNOSTICS n = ROW_COUNT;\n    IF item.name='sales_order' THEN RAISE EXCEPTION 'injected mid-delete failure'; END IF;\n    IF n <>");
  const output = query(`${failing}\nSELECT 'orders='||count(*) FROM sales_order;
    SELECT 'payments='||count(*) FROM payment_record;
    SELECT 'refund_payments='||count(*) FROM refund_payment_record;
    SELECT 'commissions='||count(*) FROM technician_commission_record;`);
  assert.match(output, /injected mid-delete failure/);
  assert.match(output, /FAILED: transaction rolled back/);
  assert.match(output, /orders=72/);
  assert.match(output, /payments=73/);
  assert.match(output, /refund_payments=72/);
  assert.match(output, /commissions=73/);
});

test('four next-day commissions on one September 7 target order are reported and deleted without review IDs', () => {
  const output = execute(`UPDATE technician_commission_record SET business_date='2026-09-08' WHERE order_id=md5('order52')::uuid;
    INSERT INTO technician_commission_record(id,order_id,order_line_id,store_id,business_date)
    SELECT md5('next-day-commission'||n)::uuid,md5('order52')::uuid,md5('order52')::uuid,'${store}','2026-09-08'
    FROM generate_series(1,3) n;`, `
    SELECT 'target_commissions='||count(*) FROM technician_commission_record WHERE order_id=md5('order52')::uuid;
    SELECT 'reported_dates='||count(*) FROM pg_temp._clear_commission_review
      WHERE order_id=md5('order52')::uuid AND date_mismatch AND NOT store_mismatch;
    SELECT 'commissions='||count(*) FROM technician_commission_record;
    SELECT 'orders='||count(*) FROM sales_order;
    ROLLBACK;
    SELECT 'restored_commissions='||count(*) FROM technician_commission_record;
    SELECT 'restored_orders='||count(*) FROM sales_order;`);
  assert.match(output, /COMMISSION_REVIEW id=/);
  assert.equal((output.match(/commission_date=2026-09-08, order_date=2026-09-07/g) || []).length, 4);
  assert.match(output, /CHECKS PASSED/);
  assert.match(output, /target_commissions=0/);
  assert.match(output, /reported_dates=4/);
  assert.match(output, /commissions=4/);
  assert.match(output, /orders=4/);
  assert.match(output, /restored_commissions=76/);
  assert.match(output, /restored_orders=72/);
  assert.doesNotMatch(output, /ERROR:/);
  assert.doesNotMatch(script, /reviewed_commission_date_ids/);
});

test('same-store date anomalies delete by order ID, preserving member and other-order commissions regardless of dates', () => {
  const output = query(`UPDATE technician_commission_record SET business_date='2026-09-08' WHERE id=md5('order3')::uuid;
    UPDATE technician_commission_record SET business_date='2026-09-04' WHERE id=md5('order4')::uuid;
    UPDATE technician_commission_record SET business_date='2026-09-06' WHERE id=md5('order5')::uuid;
    UPDATE technician_commission_record SET business_date='2026-09-08' WHERE order_id IN (md5('order1')::uuid,md5('order2')::uuid);
    UPDATE technician_commission_record SET store_id='${store}',business_date='2026-09-05'
      WHERE order_id IN (md5('order71')::uuid,md5('order72')::uuid);
    ${sql}
    SELECT 'remaining_commissions='||count(*) FROM technician_commission_record;
    SELECT 'protected_commissions='||count(*) FROM technician_commission_record WHERE order_id IN (md5('order1')::uuid,md5('order2')::uuid);
    SELECT 'other_commissions='||count(*) FROM technician_commission_record WHERE order_id IN (md5('order71')::uuid,md5('order72')::uuid);
    ROLLBACK; SELECT 'restored_commissions='||count(*) FROM technician_commission_record;`);
  assert.match(output, /CHECKS PASSED/);
  assert.match(output, /remaining_commissions=4/);
  assert.match(output, /protected_commissions=2/);
  assert.match(output, /other_commissions=2/);
  assert.match(output, /restored_commissions=73/);
  assert.doesNotMatch(output, /ERROR:/);
});

for (const [name, setup, expected] of [
  ['commission store mismatch', `UPDATE technician_commission_record SET store_id='${other}' WHERE id=md5('order3')::uuid;`, /Commission store mismatch/],
  ['commission store and date mismatch', `UPDATE technician_commission_record SET store_id='${other}',business_date='2026-09-08' WHERE id=md5('order3')::uuid;`, /Commission store mismatch/],
  ['protected commission linked to target service', "UPDATE technician_commission_record SET service_session_id=md5('order3')::uuid WHERE order_id=md5('order1')::uuid;", /Protected\/unknown dependent rows via technician_commission_record/],
  ['protected commission linked to target original commission', "UPDATE technician_commission_record SET original_commission_record_id=md5('order3')::uuid WHERE order_id=md5('order1')::uuid;", /Protected\/unknown dependent rows via technician_commission_record/],
  ['other-date commission linked to target participant', "UPDATE technician_commission_record SET service_participant_id=md5('order3')::uuid WHERE order_id=md5('order72')::uuid;", /Protected\/unknown dependent rows via technician_commission_record/]
]) {
  test(`preserves all data on ${name}`, () => {
    const output = execute(setup, "SELECT 'orders='||count(*) FROM sales_order; SELECT 'commissions='||count(*) FROM technician_commission_record;");
    assert.match(output, expected);
    assert.match(output, /FAILED: transaction rolled back/);
    assert.match(output, /orders=72/);
    assert.match(output, /commissions=73/);
    assert.doesNotMatch(output, /CHECKS PASSED/);
  });
}

test('diagnosis reports real columns, date/store anomalies and protected dependency conflicts without changing data', () => {
  query(`UPDATE technician_commission_record SET business_date='2026-09-08' WHERE id=md5('order3')::uuid;
    UPDATE technician_commission_record SET store_id='${other}' WHERE id=md5('order4')::uuid;
    UPDATE technician_commission_record SET store_id='${store}',business_date='2026-09-05' WHERE id=md5('order71')::uuid;
    UPDATE technician_commission_record SET service_session_id=md5('order3')::uuid WHERE id=md5('order72')::uuid;`);
  const snapshot = `SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM technician_commission_record c;
    SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM sales_order o;
    SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM member_wallet w;
    SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM wallet_transaction w;`;
  const before = query(snapshot);
  const output = query(diagnosis);
  assert.match(output, /order_id\|uuid/);
  assert.match(output, /store_id\|uuid/);
  assert.match(output, /business_date\|date/);
  assert.match(output, /FOREIGN KEY \(original_commission_record_id\)/);
  assert.match(output, /2026-09-05\|40\|2\|38/);
  assert.match(output, /DELETE_BY_ORDER_ID_DATE_MISMATCH/);
  assert.match(output, /BLOCK_STORE_MISMATCH/);
  assert.match(output, /KEEP_MEMBER_BALANCE/);
  assert.match(output, /KEEP_OTHER_ORDER/);
  assert.match(output, /2026-09-08\|service_session_id\|/);
  assert.doesNotMatch(output, /ERROR:/);
  assert.equal(query(snapshot), before);
});

test('schema checks and delete planning also work against every repository migration', () => {
  query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const migrations = path.join(root,'services/massage-api/src/main/resources/db/migration');
  const files = fs.readdirSync(migrations).filter(file => /^V\d+__.*\.sql$/.test(file))
    .sort((a,b) => Number(a.match(/^V(\d+)/)[1]) - Number(b.match(/^V(\d+)/)[1]));
  query(files.map(file => fs.readFileSync(path.join(migrations,file),'utf8')).join('\n'));
  query(`INSERT INTO store(id,tenant_id,name,code) VALUES('${store}','11111111-1111-1111-1111-111111111111','Cleanup fixture','cleanup-test');
    INSERT INTO sales_order(id,tenant_id,store_id,order_no,status,receivable_cents,paid_cents,business_date)
    SELECT md5('order'||n)::uuid,'11111111-1111-1111-1111-111111111111','${store}', 'TEST-'||n,'SETTLED',100,100,
      CASE WHEN n<=40 THEN DATE '2026-09-05' WHEN n<=51 THEN DATE '2026-09-06' ELSE DATE '2026-09-07' END
    FROM generate_series(1,70) n;
    INSERT INTO sales_order_line(id,order_id,item_name_snapshot,unit_price_cents,duration_minutes,line_amount_cents)
    SELECT id,id,'Fixture',100,60,100 FROM sales_order;
    INSERT INTO payment_record(id,tenant_id,store_id,order_id,payment_method,amount_cents,payment_method_name_snapshot)
    SELECT id,tenant_id,store_id,id,CASE WHEN order_no IN ('TEST-1','TEST-2') THEN 'MEMBER_BALANCE' ELSE 'CASH' END,100,'Fixture' FROM sales_order;
    INSERT INTO technician(id,tenant_id,store_id,code,name)
    VALUES(md5('technician')::uuid,'11111111-1111-1111-1111-111111111111','${store}','FIXTURE','Fixture');
    INSERT INTO technician_commission_record(id,tenant_id,store_id,order_id,order_line_id,technician_id,
      source_type,clock_type,order_no_snapshot,technician_name_snapshot,service_name_snapshot,
      rule_type,base_amount_cents,commission_cents,settled_at,business_date)
    SELECT id,tenant_id,store_id,id,id,md5('technician')::uuid,'MAIN','QUEUE',order_no,'Fixture','Fixture',
      'NONE',100,0,TIMESTAMPTZ '2026-09-05 12:00:00+08',business_date FROM sales_order;`);
  assert.doesNotMatch(query(diagnosis), /ERROR:/);
  const output = execute('', "SELECT 'remaining='||count(*) FROM sales_order; SELECT 'commissions='||count(*) FROM technician_commission_record; ROLLBACK; SELECT 'restored='||count(*) FROM sales_order;");
  assert.match(output, /CHECKS PASSED/);
  assert.match(output, /remaining=2/);
  assert.match(output, /commissions=2/);
  assert.match(output, /restored=70/);
  assert.doesNotMatch(output, /ERROR:/);
  query("UPDATE technician_commission_record SET business_date='2026-09-08' WHERE id=md5('order3')::uuid;");
  const withDateMismatch = execute('', "SELECT 'commissions='||count(*) FROM technician_commission_record; ROLLBACK;");
  assert.match(withDateMismatch, /CHECKS PASSED/);
  assert.match(withDateMismatch, /commissions=2/);
  assert.doesNotMatch(withDateMismatch, /ERROR:/);
});
