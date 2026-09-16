const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomBytes, randomUUID, pbkdf2Sync } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

// Always starts a new localhost cluster. Existing database URLs are never used.
const root = path.resolve(__dirname, '../..');
const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/16/bin';
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java.exe') : 'java';
const tenant = '11111111-1111-1111-1111-111111111111';
const store = '22222222-2222-2222-2222-222222222222';
const item = '50000000-0000-0000-0000-000000000001';
const technician = '30000000-0000-0000-0000-000000000001';
const password = randomBytes(24).toString('base64url');
let dir, connection, base, app, started = false, admin, cashier, reader, mobile;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function command(tool, args, options = {}) {
  const result = spawnSync(path.join(bin, `${tool}.exe`), args, {
    encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 16 * 1024 * 1024, ...options
  });
  assert.equal(result.status, 0, `${tool}: ${result.error || ''}\n${result.stdout || ''}\n${result.stderr || ''}`);
  return (result.stdout || '').trim();
}
function sql(text) {
  return command('psql', [...connection, '-v', 'ON_ERROR_STOP=1', '-Atq'], { input: text });
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function api(url, body, token = admin, headers = {}, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', 'X-Store-Id': store,
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
function ok(result, status = 200) {
  assert.equal(result.status, status, JSON.stringify(result.data));
  return result.data;
}
async function newMember(amountCents = 10000, bonusCents = 0) {
  return ok(await api('/api/v1/members/open-card', {
    name: 'Review fixture', phone: randomUUID().replaceAll('-', '').slice(0, 20),
    amountCents, bonusCents, paymentMethod: 'CASH'
  }));
}
function original(member) {
  return sql(`SELECT id FROM wallet_transaction WHERE member_id='${member.id}' AND transaction_type='RECHARGE' ORDER BY created_at,id LIMIT 1;`);
}
async function refund(member, amountCents, token = admin) {
  return api('/api/v1/member-recharge-refunds', {
    memberId: member.id, originalTransactionId: original(member), amountCents,
    reason: 'Review fixture', requestKey: randomUUID()
  }, token);
}
function backfill(overrides = {}) {
  return { backfillDate: sql('SELECT current_date::text;'), confirmed: true,
    settlementAmountCents: 100, lines: [{ serviceItemId: item, technicianId: technician }],
    payments: [{ method: 'CASH', amountCents: 100 }], ...overrides };
}
function counts() {
  return sql(`SELECT (SELECT count(*) FROM sales_order)||':'||(SELECT count(*) FROM sales_order_line)||':'||
    (SELECT count(*) FROM service_session)||':'||(SELECT count(*) FROM technician_commission_record)||':'||
    (SELECT count(*) FROM payment_record)||':'||(SELECT count(*) FROM wallet_transaction);`);
}

function roomFixture() {
  const id = randomUUID();
  sql(`INSERT INTO room(id,tenant_id,store_id,code,name,bed_count) VALUES('${id}','${tenant}','${store}','${id}','Review room',2);`);
  return id;
}
function activeService(room, tech) {
  const id = randomUUID(), bed = randomUUID();
  sql(`INSERT INTO room_bed(id,tenant_id,store_id,room_id,code,name) VALUES('${bed}','${tenant}','${store}','${room}','${bed}','Review bed');
    INSERT INTO service_session(id,tenant_id,store_id,technician_id,room_id,bed_id,service_item_id,service_name_snapshot,service_price_cents,
      planned_duration_minutes,started_at,expected_end_at,status,business_date)
    VALUES('${id}','${tenant}','${store}','${tech}','${room}','${bed}','${item}','Review service',100,60,now()-interval '5 minutes',now()+interval '55 minutes','IN_SERVICE',current_date);
    INSERT INTO service_session_participant(id,tenant_id,store_id,service_session_id,technician_id,slot_no,sequence_no,participation_type,allocation_bp,status,service_started_at)
    VALUES(gen_random_uuid(),'${tenant}','${store}','${id}','${tech}',1,1,'PRIMARY',10000,'IN_SERVICE',now()-interval '5 minutes');
    INSERT INTO room_status_event(id,tenant_id,store_id,room_id,status,source) VALUES(gen_random_uuid(),'${tenant}','${store}','${room}','IN_SERVICE','FRONTDESK');`);
  return id;
}

test.before(async () => {
  const pgPort = await freePort();
  const apiPort = await freePort();
  fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });
  dir = fs.mkdtempSync(path.join(root, '.artifacts/quality-review-'));
  command('initdb', ['-D', path.join(dir, 'pgdata'), '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C']);
  command('pg_ctl', ['-D', path.join(dir, 'pgdata'), '-l', path.join(dir, 'postgres.log'),
    '-o', `-h 127.0.0.1 -p ${pgPort}`, '-w', 'start'], { stdio: 'ignore' });
  started = true;
  command('createdb', ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', 'review_fixture']);
  connection = ['-X', '-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', '-d', 'review_fixture'];
  base = `http://127.0.0.1:${apiPort}`;
  const log = fs.openSync(path.join(dir, 'api.log'), 'a');
  const socketDir = path.join(process.env.SystemDrive || 'C:', '/tmp/jdsock');
  fs.mkdirSync(socketDir, { recursive: true });
  app = spawn(java, [`-Djdk.net.unixdomain.tmpdir=${socketDir}`, '-jar', path.join(root, 'services/massage-api/target/massage-api-0.1.0.jar')], {
    cwd: dir, windowsHide: true, stdio: ['ignore', log, log],
    env: { ...process.env, MASSAGE_DB_URL: `jdbc:postgresql://127.0.0.1:${pgPort}/review_fixture`,
      MASSAGE_DB_USER: 'postgres', MASSAGE_DB_PASSWORD: '', MASSAGE_API_PORT: String(apiPort),
      MASSAGE_API_ADDRESS: '127.0.0.1' }
  });
  fs.closeSync(log);
  let spawnError;
  app.on('error', error => { spawnError = error; });
  let healthy = false;
  for (let n = 0; n < 120; n++) {
    if (spawnError || app.exitCode !== null) break;
    try { healthy = (await api('/api/health', undefined, null)).data.status === 'UP'; } catch {}
    if (healthy) break;
    await delay(500);
  }
  assert.ok(healthy, `App startup failed: ${spawnError || ''}\n${fs.readFileSync(path.join(dir, 'api.log'), 'utf8').slice(-2500)}`);
  const salt = randomBytes(16);
  const hash = `PBKDF2$310000$${salt.toString('base64url')}$${pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('base64url')}`;
  sql(`INSERT INTO role(id,tenant_id,code,name) VALUES(gen_random_uuid(),'${tenant}','REVIEW_READER','Review reader');`);
  for (const [name, role] of [['review-admin', 'TENANT_ADMIN'], ['review-cashier', 'CASHIER'], ['review-reader', 'REVIEW_READER']]) {
    const user = randomUUID();
    sql(`INSERT INTO app_user(id,tenant_id,login_name,display_name,password_hash) VALUES('${user}','${tenant}','${name}','Review fixture','${hash}');
      INSERT INTO user_role SELECT '${user}',id FROM role WHERE code='${role}';
      INSERT INTO user_store_scope VALUES('${user}','${store}');`);
  }
  admin = ok(await api('/api/v1/admin/auth/login', { loginName: 'review-admin', password }, null)).accessToken;
  cashier = ok(await api('/api/v1/admin/auth/login', { loginName: 'review-cashier', password }, null)).accessToken;
  reader = ok(await api('/api/v1/admin/auth/login', { loginName: 'review-reader', password }, null)).accessToken;
  assert.ok(admin && cashier && reader, 'Login must return all fixture tokens');
  sql(`UPDATE app_user SET password_hash='${hash}' WHERE login_name='tech-liqing';`);
  mobile = ok(await api('/api/v1/mobile/auth/login', { loginName: 'tech-liqing', password }, null)).accessToken;
  assert.ok(mobile);
  // Fix the fixture business cutoff to midnight, independently of runner timezone.
  sql("UPDATE store SET business_day_cutoff='00:00',timezone='UTC';");
});

test.after(async () => {
  try {
    if (app && app.exitCode === null && app.pid) {
      const exited = new Promise(resolve => app.once('exit', resolve));
      app.kill();
      await exited;
    }
  } finally {
    if (started) command('pg_ctl', ['-D', path.join(dir, 'pgdata'), '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
  }
});

test('authentication and normal member permission boundary', async () => {
  assert.equal((await api('/api/v1/members', undefined, null)).status, 401);
  assert.equal((await api('/api/v1/members', { name: 'Fixture', phone: 'fixture-denied' }, reader)).status, 403);
});

test('inspection is read-only and finds no anomalies on the migrated seed', () => {
  const before = counts();
  const output = command('psql', [...connection, '-v', 'ON_ERROR_STOP=1', '-Atq',
    '-f', path.join(root, 'tools/maintenance/inspect_data_quality.sql')]);
  assert.match(output, /INSPECTION_COMPLETE_READ_ONLY/);
  assert.match(output, /\|on\|repeatable read\|/);
  for (const line of output.split(/\r?\n/).filter(line => /\|(P1|P2|REVIEW)\|/.test(line))) {
    assert.equal(line.split('|')[2], '0', line);
  }
  assert.equal(counts(), before);
});

test('cashier cannot select another store', async () => {
  const other = randomUUID();
  sql(`INSERT INTO store(id,tenant_id,name,code) VALUES('${other}','${tenant}','Other fixture','${other}');`);
  assert.equal((await api('/api/v1/members', undefined, cashier, { 'X-Store-Id': other })).status, 403);
});

test('open card creates conserved principal and bonus ledger rows', async () => {
  const member = await newMember(10000, 2000);
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`), '12000');
  assert.equal(sql(`SELECT count(*) FROM wallet_transaction WHERE member_id='${member.id}' AND balance_before_cents+amount_cents<>balance_after_cents;`), '0');
});

test('invalid recharge and duplicate member leave wallet unchanged', async () => {
  const member = await newMember();
  const before = counts();
  assert.equal((await api(`/api/v1/members/${member.id}/recharges`, { amountCents: 0, bonusCents: 0, paymentMethod: 'CASH' })).status, 400);
  assert.equal((await api('/api/v1/members', { name: 'Duplicate', phone: member.phone })).status, 409);
  assert.equal(counts(), before);
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`), '10000');
});

test('refund quota, cancellation and repeated completion', async () => {
  const member = await newMember();
  const first = ok(await refund(member, 8000));
  assert.equal((await refund(member, 3000)).status, 409);
  ok(await api(`/api/v1/member-recharge-refunds/${first.id}/cancel`, {}));
  const final = ok(await refund(member, 10000));
  ok(await api(`/api/v1/member-recharge-refunds/${final.id}/complete`, {}));
  const before = counts();
  ok(await api(`/api/v1/member-recharge-refunds/${final.id}/complete`, {}));
  assert.equal(counts(), before);
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`), '0');
  assert.equal((await api(`/api/v1/member-recharge-refunds/${final.id}/cancel`, {})).status, 409);
});

test('historical backfill rejects future dates, missing confirmation and cashier permission', async () => {
  const before = counts();
  assert.equal((await api('/api/v1/sales-orders/historical-backfill', backfill({ backfillDate: '2099-01-01' }))).status, 400);
  assert.equal((await api('/api/v1/sales-orders/historical-backfill', backfill({ confirmed: false }))).status, 400);
  assert.equal((await api('/api/v1/sales-orders/historical-backfill', backfill(), cashier)).status, 403);
  assert.equal(counts(), before);
});

test('historical backfill commits attributed services, commission, payment and audit together', async () => {
  const result = ok(await api('/api/v1/sales-orders/historical-backfill', backfill()));
  const id = result.orderId;
  assert.ok(id, JSON.stringify(result));
  assert.equal(sql(`SELECT count(*) FROM sales_order_service_session l JOIN service_session s ON s.id=l.service_session_id
    JOIN sales_order o ON o.id=l.order_id WHERE o.id='${id}' AND s.business_date=o.business_date AND s.status='COMPLETED';`), '1');
  assert.equal(sql(`SELECT count(*) FROM technician_commission_record WHERE order_id='${id}';`), '1');
  assert.equal(sql(`SELECT sum(amount_cents) FROM payment_record WHERE order_id='${id}';`), '100');
  assert.equal(sql(`SELECT count(*) FROM audit_log WHERE entity_id='${id}' AND action='HISTORICAL_ORDER_BACKFILLED';`), '1');
});

test('invalid final payment rolls back materialized historical services and commissions', async () => {
  const before = counts();
  assert.equal((await api('/api/v1/sales-orders/historical-backfill', backfill({ payments: [{ method: 'FIXTURE_MISSING', amountCents: 100 }] }))).status, 400);
  assert.equal(counts(), before);
});

test('insufficient member funds roll back all historical order writes', async () => {
  const member = await newMember(0);
  const before = counts();
  assert.equal((await api('/api/v1/sales-orders/historical-backfill', backfill({ memberId: member.id,
    payments: [{ method: 'MEMBER_BALANCE', amountCents: 100 }] }))).status, 409);
  assert.equal(counts(), before);
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`), '0');
});

test('same idempotency key and body recharge once', async () => {
  const member = await newMember(0);
  const headers = { 'X-Offline-Operation-Id': randomUUID() };
  const body = { amountCents: 100, bonusCents: 0, paymentMethod: 'CASH' };
  ok(await api(`/api/v1/members/${member.id}/recharges`, body, admin, headers));
  ok(await api(`/api/v1/members/${member.id}/recharges`, body, admin, headers), 204);
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`), '100');
});

test('technician clock-in is idempotent and synchronizes employee attendance', async () => {
  ok(await api('/api/v1/technicians/clock-in', {}, mobile));
  ok(await api('/api/v1/technicians/clock-in', {}, mobile));
  assert.equal(sql(`SELECT count(*) FROM technician_clock_in WHERE technician_id='30000000-0000-0000-0000-000000000002' AND business_date=current_date;`), '1');
  assert.equal(sql(`SELECT count(*) FROM employee_attendance a JOIN technician t ON t.employee_id=a.employee_id
    JOIN technician_clock_in c ON c.technician_id=t.id AND c.business_date=a.attendance_date
    WHERE t.id='30000000-0000-0000-0000-000000000002' AND a.clock_in_at=c.clock_in_time AND a.source='TECHNICIAN';`), '1');
});

test('dispatch, accept, start, extend, end, settle and full refund remain consistent', async () => {
  const tech = '30000000-0000-0000-0000-000000000002';
  const room = roomFixture();
  const assigned = ok(await api('/api/v1/service-sessions/clock-in', {
    technicianId: tech, roomId: room, serviceItemId: item, plannedDurationMinutes: 60, clockType: 'QUEUE'
  }));
  ok(await api('/api/v1/mobile/technician/dispatch-notification/confirm', {}, mobile));
  ok(await api('/api/v1/mobile/technician/start-service', {}, mobile));
  assert.equal((await api('/api/v1/mobile/technician/extensions', { serviceItemId: item }, mobile)).status, 403);
  ok(await api(`/api/v1/service-sessions/${assigned.id}/extensions`, { serviceItemId: item, technicianId: tech }));
  assert.equal(sql(`SELECT count(*) FROM service_session WHERE id='${assigned.id}' AND expected_end_at=started_at+planned_duration_minutes*interval '1 minute';`), '1');
  ok(await api('/api/v1/mobile/technician/clock-out', {}, mobile));
  const amount = Number(sql(`SELECT s.service_price_cents+coalesce(sum(e.service_price_cents),0) FROM service_session s
    LEFT JOIN service_session_extension e ON e.service_session_id=s.id WHERE s.id='${assigned.id}' GROUP BY s.id;`));
  const payload = { lines: [{ serviceSessionId: assigned.id }], payments: [{ method: 'CASH', amountCents: amount }] };
  const order = ok(await api('/api/v1/sales-orders/settle', payload));
  assert.equal(ok(await api('/api/v1/sales-orders/settle', payload)).id, order.id);
  const line = sql(`SELECT id FROM sales_order_line WHERE order_id='${order.id}';`);
  const payment = sql(`SELECT id FROM payment_record WHERE order_id='${order.id}';`);
  const request = { requestKey: randomUUID(), refundKind: 'FULL_REVERSAL', reason: 'Review fixture',
    lines: [{ orderLineId: line, quantity: 1, refundCents: amount }],
    payments: [{ originalPaymentId: payment, paymentMethod: 'CASH', amountCents: amount }] };
  const reversal = ok(await api(`/api/v1/sales-orders/${order.id}/refunds`, request));
  assert.equal(ok(await api(`/api/v1/sales-orders/${order.id}/refunds`, request)).id, reversal.id);
  const refundPayment = sql(`SELECT id FROM refund_payment_record WHERE refund_id='${reversal.id}';`);
  ok(await api(`/api/v1/refunds/${reversal.id}/payments/${refundPayment}/complete`, {}));
  const before = counts();
  ok(await api(`/api/v1/refunds/${reversal.id}/payments/${refundPayment}/complete`, {}));
  assert.equal(counts(), before);
  assert.equal(sql(`SELECT refund_status FROM sales_order WHERE id='${order.id}';`), 'FULL');
  assert.equal(sql(`SELECT coalesce(sum(commission_cents),0) FROM technician_commission_record WHERE order_id='${order.id}';`), '0');
});

// These assert the required behavior, not the defective behavior. TODO failures
// are review evidence and must not be counted as passing business regressions.
test('R02: matrix path must enforce the same member write permission', { todo: 'Unfixed permission canonicalization' }, async () => {
  const response = await api('/api/v1;x=fixture/members', { name: 'Path fixture', phone: randomUUID().slice(0, 20) }, reader);
  assert.equal(response.status, 403);
});

test('R04: every bonus refund ledger row conserves balance', { todo: 'Unfixed refund intermediate balance' }, async () => {
  const member = await newMember(10000, 2000);
  const row = ok(await refund(member, 10000));
  ok(await api(`/api/v1/member-recharge-refunds/${row.id}/complete`, {}));
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`), '0');
  assert.equal(sql(`SELECT count(*) FROM wallet_transaction WHERE member_id='${member.id}' AND balance_before_cents+amount_cents<>balance_after_cents;`), '0');
});

test('R05: later recharge bonus must not be reclaimed by an earlier recharge', { todo: 'Unfixed timestamp-based bonus association' }, async () => {
  const member = await newMember(10000, 0);
  const first = original(member);
  ok(await api(`/api/v1/members/${member.id}/recharges`, { amountCents: 10000, bonusCents: 2000, paymentMethod: 'CASH' }));
  // Deterministic fixture timestamps: separate operations one second apart.
  sql(`UPDATE wallet_transaction SET created_at='2026-09-01 00:00:01+00' WHERE member_id='${member.id}';
    UPDATE wallet_transaction SET created_at='2026-09-01 00:00:00+00' WHERE id='${first}';`);
  const row = ok(await refund(member, 10000));
  assert.equal(row.bonusReclaimCents, 0);
});

test('R06: reusing an operation key with changed content must conflict', { todo: 'Unfixed request digest binding' }, async () => {
  const member = await newMember(0);
  const headers = { 'X-Offline-Operation-Id': randomUUID() };
  ok(await api(`/api/v1/members/${member.id}/recharges`, { amountCents: 100, bonusCents: 0, paymentMethod: 'CASH' }, admin, headers));
  assert.equal((await api(`/api/v1/members/${member.id}/recharges`, { amountCents: 900, bonusCents: 0, paymentMethod: 'CASH' }, admin, headers)).status, 409);
});

test('R03: concurrent refund reservations must not exceed the original principal', { todo: 'Unfixed original recharge lock' }, async () => {
  const member = await newMember(10000);
  sql(`CREATE FUNCTION review_refund_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.member_id='${member.id}'::uuid THEN PERFORM pg_sleep(1); END IF; RETURN NEW; END $$;
    CREATE TRIGGER review_refund_barrier BEFORE INSERT ON member_recharge_refund FOR EACH ROW EXECUTE FUNCTION review_refund_barrier();`);
  try {
    const results = await Promise.all([refund(member, 8000, admin), refund(member, 8000, cashier)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  } finally {
    sql('DROP TRIGGER review_refund_barrier ON member_recharge_refund; DROP FUNCTION review_refund_barrier();');
  }
});

test('R15: mobile clock-out preserves another active service room state', { todo: 'Unfixed multi-bed room aggregation' }, async () => {
  const room = roomFixture();
  const own = activeService(room, '30000000-0000-0000-0000-000000000002');
  const other = activeService(room, technician);
  try {
    ok(await api('/api/v1/mobile/technician/clock-out', {}, mobile));
    assert.equal(sql(`SELECT status FROM service_session WHERE id='${other}';`), 'IN_SERVICE');
    assert.equal(sql(`SELECT status FROM room_status_event WHERE room_id='${room}' ORDER BY occurred_at DESC,id DESC LIMIT 1;`), 'IN_SERVICE');
  } finally {
    sql(`UPDATE service_session SET status='COMPLETED',ended_at=now() WHERE id IN ('${own}','${other}');
      UPDATE service_session_participant SET status='COMPLETED',service_ended_at=now() WHERE service_session_id IN ('${own}','${other}');`);
  }
});

test('R16: approving room transfer reassigns a bed in the destination room', { todo: 'Unfixed transfer bed ownership' }, async () => {
  const from = roomFixture(), to = roomFixture();
  const session = activeService(from, technician);
  const request = ok(await api('/api/v1/service-room-transfers', { serviceSessionId: session, toRoomId: to, reason: 'Review fixture' }));
  ok(await api(`/api/v1/service-room-transfers/${request.id}/approve`, {}));
  assert.equal(sql(`SELECT count(*) FROM service_session s JOIN room_bed b ON b.id=s.bed_id WHERE s.id='${session}' AND s.room_id=b.room_id;`), '1');
});

test('inspection detects injected equation, quota and orphan anomalies and preserves data', async () => {
  const member = await newMember(10000);
  const transaction = original(member);
  const anomaly = randomUUID();
  sql(`UPDATE wallet_transaction SET balance_after_cents=balance_after_cents+1 WHERE id='${transaction}';
    INSERT INTO member_recharge_refund(id,tenant_id,store_id,member_id,original_transaction_id,refund_no,request_key,status,amount_cents,reason,requested_by_name_snapshot)
    VALUES('${anomaly}','${tenant}','${store}','${member.id}','${transaction}','${anomaly}','${anomaly}','PENDING',15000,'Review fixture','Review fixture');
    CREATE TABLE review_fk_parent(id uuid PRIMARY KEY);
    CREATE TABLE review_fk_child(id uuid PRIMARY KEY,parent_id uuid);
    INSERT INTO review_fk_child VALUES(gen_random_uuid(),gen_random_uuid());
    ALTER TABLE review_fk_child ADD CONSTRAINT review_orphan FOREIGN KEY(parent_id) REFERENCES review_fk_parent(id) NOT VALID;`);
  try {
    const before = counts();
    const output = command('psql', [...connection, '-v', 'ON_ERROR_STOP=1', '-Atq',
      '-f', path.join(root, 'tools/maintenance/inspect_data_quality.sql')]);
    assert.match(output, /FK_ORPHAN\|review_fk_child\|review_orphan\|1\|/);
    for (const [check, id] of [['WALLET_ROW_EQUATION', transaction], ['RECHARGE_OVER_REFUND', transaction]]) {
      const line = output.split(/\r?\n/).find(line => line.startsWith(check + '|'));
      assert.ok(Number(line.split('|')[2]) >= 1, line);
      assert.ok(JSON.parse(line.split('|')[3]).some(row => row.id === id), line);
    }
    assert.match(output, /INSPECTION_COMPLETE_READ_ONLY/);
    assert.equal(counts(), before);
    assert.equal(sql(`SELECT balance_after_cents FROM wallet_transaction WHERE id='${transaction}';`), '10001');
  } finally {
    sql(`UPDATE wallet_transaction SET balance_after_cents=balance_after_cents-1 WHERE id='${transaction}';
      DELETE FROM member_recharge_refund WHERE id='${anomaly}'; DROP TABLE review_fk_child; DROP TABLE review_fk_parent;`);
  }
});

test('store-scoped inspection reconciles the entire shared wallet history', async () => {
  const member = await newMember(10000);
  const other = randomUUID();
  sql(`INSERT INTO store(id,tenant_id,name,code) VALUES('${other}','${tenant}','Shared wallet fixture','${other}');
    INSERT INTO wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,business_date)
    SELECT gen_random_uuid(),'${tenant}','${other}',id,'${member.id}','RECHARGE',100,10000,10100,'REVIEW_FIXTURE',current_date
    FROM member_wallet WHERE member_id='${member.id}';
    UPDATE member_wallet SET balance_cents=10100 WHERE member_id='${member.id}';`);
  const output = command('psql', [...connection, '-Atq', '-v', `store_id=${other}`,
    '-f', path.join(root, 'tools/maintenance/inspect_data_quality.sql')]);
  assert.match(output, /WALLET_HISTORY_REVIEW\|REVIEW\|0\|/);
  assert.match(output, /WALLET_MEMBER_SCOPE\|P1\|0\|/);
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`), '10100');
});

test('inspection rejects reversed dates before scanning or changing business data', () => {
  const before = counts();
  const result = spawnSync(path.join(bin, 'psql.exe'), [...connection, '-Atq',
    '-v', 'from_date=2026-09-07', '-v', 'to_date=2026-09-05',
    '-f', path.join(root, 'tools/maintenance/inspect_data_quality.sql')],
  { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /from_date must be on or before to_date/);
  assert.doesNotMatch(result.stdout, /INSPECTION_COMPLETE_READ_ONLY/);
  assert.equal(counts(), before);
});
