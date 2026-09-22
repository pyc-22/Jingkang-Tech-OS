const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomBytes, randomUUID, pbkdf2Sync } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');

// Always starts a new localhost cluster. Existing database URLs are never used.
const root = path.resolve(__dirname, '../..');
const runtimeRoot = process.env.REVIEW_RELEASE_DIR || root;
const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/16/bin';
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java.exe') : 'java';
const tenant = '11111111-1111-1111-1111-111111111111';
const store = '22222222-2222-2222-2222-222222222222';
const item = '50000000-0000-0000-0000-000000000001';
const technician = '30000000-0000-0000-0000-000000000001';
const password = randomBytes(24).toString('base64url');
let dir, connection, base, app, consoleApp, consoleBase, started = false, admin, cashier, reader, manager, mobile, coveragePort;
const coverage = process.env.REVIEW_COVERAGE === '1';
require('./expense-workspace.cases')({test,sql,api,ok,context:()=>({tenant,store,base,consoleBase,admin,manager,cashier,reader,dir,password})});
require('./member-codes.cases')({test,sql,api,ok,context:()=>({tenant,store})});
const jacocoRoot = path.join(process.env.USERPROFILE, '.m2/repository/org/jacoco');
const jacocoAgent = path.join(jacocoRoot, 'org.jacoco.agent/0.8.12/org.jacoco.agent-0.8.12-runtime.jar');
const jacocoCli = process.env.JACOCO_CLI || path.join(jacocoRoot, 'org.jacoco.cli/0.8.12/org.jacoco.cli-0.8.12-nodeps.jar');
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
  if (coverage) coveragePort = await freePort();
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
  const instrumentation = coverage ? [`-javaagent:${jacocoAgent}=output=tcpserver,address=127.0.0.1,port=${coveragePort},includes=com.chengxin.massage.*`] : [];
  app = spawn(java, [...instrumentation, `-Djdk.net.unixdomain.tmpdir=${socketDir}`, '-jar', path.join(runtimeRoot, 'services/massage-api/target/massage-api-0.1.0.jar')], {
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
  const consolePort = await freePort();
  consoleBase = `http://127.0.0.1:${consolePort}`;
  consoleApp = spawn(process.execPath, [path.join(runtimeRoot, 'server.massage.js')], {
    windowsHide:true, stdio:'ignore', env:{...process.env, MASSAGE_ADDRESS:'127.0.0.1',
      MASSAGE_PORT:String(consolePort), MASSAGE_API_HOST:'127.0.0.1', MASSAGE_API_PORT:String(apiPort)}
  });
  let consoleHealthy = false;
  for (let n=0; n<60; n++) {
    try { consoleHealthy = (await (await fetch(consoleBase+'/api/health')).json()).status === 'UP'; } catch {}
    if (consoleHealthy) break;
    await delay(100);
  }
  assert.ok(consoleHealthy, 'Packaged console proxy must reach the API');
  const salt = randomBytes(16);
  const hash = `PBKDF2$310000$${salt.toString('base64url')}$${pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('base64url')}`;
  sql(`INSERT INTO role(id,tenant_id,code,name) VALUES(gen_random_uuid(),'${tenant}','REVIEW_READER','Review reader');`);
  for (const [name, role] of [['review-admin', 'TENANT_ADMIN'], ['review-cashier', 'CASHIER'], ['review-reader', 'REVIEW_READER'], ['review-manager', 'STORE_MANAGER']]) {
    const user = randomUUID();
    sql(`INSERT INTO app_user(id,tenant_id,login_name,display_name,password_hash) VALUES('${user}','${tenant}','${name}','Review fixture','${hash}');
      INSERT INTO user_role SELECT '${user}',id FROM role WHERE code='${role}';
      INSERT INTO user_store_scope VALUES('${user}','${store}');`);
  }
  admin = ok(await api('/api/v1/admin/auth/login', { loginName: 'review-admin', password }, null)).accessToken;
  cashier = ok(await api('/api/v1/admin/auth/login', { loginName: 'review-cashier', password }, null)).accessToken;
  reader = ok(await api('/api/v1/admin/auth/login', { loginName: 'review-reader', password }, null)).accessToken;
  manager = ok(await api('/api/v1/admin/auth/login', { loginName: 'review-manager', password }, null)).accessToken;
  assert.ok(admin && cashier && reader, 'Login must return all fixture tokens');
  sql(`UPDATE app_user SET password_hash='${hash}' WHERE login_name='tech-liqing';`);
  mobile = ok(await api('/api/v1/mobile/auth/login', { loginName: 'tech-liqing', password }, null)).accessToken;
  assert.ok(mobile);
  // Fix the fixture business cutoff to midnight, independently of runner timezone.
  sql("UPDATE store SET business_day_cutoff='00:00',timezone='UTC';");
  sql(`INSERT INTO store_payment_method(id,tenant_id,store_id,code,name,method_kind)
    VALUES(gen_random_uuid(),'${tenant}','${store}','ALIPAY','Alipay','EXTERNAL');`);
});

test.after(async () => {
  try {
    if (app && app.exitCode === null && app.pid) {
      try {
        if (coverage) {
          const result = spawnSync(java, ['-jar', jacocoCli, 'dump', '--address', '127.0.0.1', '--port', String(coveragePort),
            '--destfile', path.join(dir, 'http.exec')], { encoding:'utf8', windowsHide:true, timeout:30000 });
          assert.equal(result.status, 0, result.stderr || result.stdout);
          fs.copyFileSync(path.join(dir, 'http.exec'), path.join(root, '.artifacts/quality-http.exec'));
        }
      } finally {
        const exited = new Promise(resolve => app.once('exit', resolve));
        app.kill();
        await exited;
      }
    }
  } finally {
    if (consoleApp?.pid && consoleApp.exitCode === null) {
      const exited = new Promise(resolve => consoleApp.once('exit', resolve));
      consoleApp.kill();
      await exited;
    }
    if (started) command('pg_ctl', ['-D', path.join(dir, 'pgdata'), '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
  }
});

test('authentication and normal member permission boundary', async () => {
  assert.equal((await api('/api/v1/members', undefined, null)).status, 401);
  assert.equal((await api('/api/v1/members', { name: 'Fixture', phone: 'fixture-denied' }, reader)).status, 403);
});

test('release health and complete Flyway migrations succeed on an empty database', async () => {
  const health = ok(await api('/api/health', undefined, null));
  assert.equal(health.status, 'UP');
  assert.equal(health.release, '20260922-member-backup-permissions-v4');
  assert.equal(health.expenseClaimPaging, true);
  assert.equal(sql("SELECT version FROM flyway_schema_history WHERE success=true ORDER BY installed_rank DESC LIMIT 1;"), '101');
  assert.equal(sql("SELECT convalidated FROM pg_constraint WHERE conname='service_bed_room_ownership';"), 't');
  assert.equal(sql("SELECT convalidated FROM pg_constraint WHERE conname='service_bed_requires_room';"), 't');
});

test('all console entry points and referenced scripts and styles load through the release server', async () => {
  for (const entry of ['index.html','mobile.html','manager-mobile.html','ledger.html']) {
    const response = await fetch(`${consoleBase}/${entry}`);
    assert.equal(response.status,200,entry);
    const dom = new JSDOM(await response.text(), {url:`${consoleBase}/${entry}`});
    try {
      for (const element of dom.window.document.querySelectorAll('script[src],link[rel="stylesheet"]')) {
        const url = element.src || element.href;
        if (url.startsWith(consoleBase)) assert.equal((await fetch(url)).status,200,url);
      }
    } finally { dom.window.close(); }
  }
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
test('R02: matrix paths enforce member permissions and unknown API paths fail closed', async () => {
  const before = sql('SELECT count(*) FROM member;');
  for (const url of ['/api/v1;x=fixture/members', '/api/v1/members;x=fixture', '/api/v1/%6dembers', '/api/v1/not-a-route']) {
    assert.equal((await api(url, { name: 'Path fixture', phone: randomUUID().slice(0, 20) }, reader)).status, 403, url);
  }
  assert.equal((await api('/api/v1/admin/auth/not-a-route', {}, admin)).status, 403);
  assert.equal(sql('SELECT count(*) FROM member;'), before);
  ok(await api('/api/v1;x=fixture/members', { name: 'Permitted fixture', phone: randomUUID().slice(0, 20) }));
});

test('R04: every bonus refund ledger row conserves balance', async () => {
  const member = await newMember(10000, 2000);
  const row = ok(await refund(member, 10000));
  ok(await api(`/api/v1/member-recharge-refunds/${row.id}/complete`, {}));
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`), '0');
  assert.equal(sql(`SELECT count(*) FROM wallet_transaction WHERE member_id='${member.id}' AND balance_before_cents+amount_cents<>balance_after_cents;`), '0');
});

test('R05: later recharge bonus must not be reclaimed by an earlier recharge', async () => {
  const member = await newMember(10000, 0);
  const first = original(member);
  ok(await api(`/api/v1/members/${member.id}/recharges`, { amountCents: 10000, bonusCents: 2000, paymentMethod: 'CASH' }));
  // Deterministic fixture timestamps: separate operations one second apart.
  sql(`UPDATE wallet_transaction SET created_at='2026-09-01 00:00:01+00' WHERE member_id='${member.id}';
    UPDATE wallet_transaction SET created_at='2026-09-01 00:00:00+00' WHERE id='${first}';`);
  const row = ok(await refund(member, 10000));
  assert.equal(row.bonusReclaimCents, 0);
});

test('R06: operation receipts bind content, actor and store and replay identical requests', async () => {
  const member = await newMember(0);
  const headers = { 'X-Offline-Operation-Id': randomUUID() };
  ok(await api(`/api/v1/members/${member.id}/recharges`, { amountCents: 100, bonusCents: 0, paymentMethod: 'CASH' }, admin, headers));
  assert.equal((await api(`/api/v1/members/${member.id}/recharges`, { amountCents: 900, bonusCents: 0, paymentMethod: 'CASH' }, admin, headers)).status, 409);
  const body = { amountCents: 100, bonusCents: 0, paymentMethod: 'CASH' };
  assert.equal((await api(`/api/v1/members/${member.id}/recharges`, body, admin, headers)).status, 204);
  assert.equal((await api(`/api/v1/members/${member.id}/recharges`, body, cashier, headers)).status, 409);
  const otherStore = sql(`SELECT id FROM store WHERE id<>'${store}' LIMIT 1;`);
  assert.ok(otherStore);
  assert.equal((await api(`/api/v1/members/${member.id}/recharges`, body, admin, { ...headers, 'X-Store-Id': otherStore })).status, 409);
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`), '100');
});

test('R06: receipt completion failure rolls back wallet, ledger and claim together', async () => {
  const member = await newMember(0), key = randomUUID();
  const body = { amountCents: 100, bonusCents: 0, paymentMethod: 'CASH' };
  const headers = { 'X-Offline-Operation-Id': key };
  sql(`CREATE FUNCTION review_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.operation_id='${key}'::uuid THEN RAISE EXCEPTION 'fixture receipt failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER review_receipt_failure BEFORE UPDATE ON offline_operation_receipt FOR EACH ROW EXECUTE FUNCTION review_receipt_failure();`);
  try {
    assert.equal((await api(`/api/v1/members/${member.id}/recharges`, body, admin, headers)).status, 500);
    assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`), '0');
    assert.equal(sql(`SELECT count(*) FROM wallet_transaction WHERE member_id='${member.id}';`), '0');
    assert.equal(sql(`SELECT count(*) FROM offline_operation_receipt WHERE operation_id='${key}';`), '0');
  } finally {
    sql('DROP TRIGGER review_receipt_failure ON offline_operation_receipt; DROP FUNCTION review_receipt_failure();');
  }
  const results = await Promise.all([api(`/api/v1/members/${member.id}/recharges`, body, admin, headers),
    api(`/api/v1/members/${member.id}/recharges`, body, admin, headers)]);
  assert.deepEqual(results.map(row => row.status).sort(), [200, 204]);
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`), '100');
});

test('R06: legacy processing receipts require reconciliation instead of another debit', async () => {
  const member = await newMember(0), key = randomUUID();
  const url = `/api/v1/members/${member.id}/recharges`;
  sql(`INSERT INTO offline_operation_receipt(operation_id,request_method,request_path,status,created_at)
    VALUES('${key}','POST','${url}','PROCESSING',now()-interval '3 days');`);
  assert.equal((await api(url, { amountCents: 100, bonusCents: 0, paymentMethod: 'CASH' }, admin, { 'X-Offline-Operation-Id': key })).status, 409);
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`), '0');
});

test('R03: concurrent refund reservations must not exceed the original principal', async () => {
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

test('R05: unreviewed legacy recharges require manual reconciliation before refund', async () => {
  const member = await newMember();
  sql(`UPDATE wallet_transaction SET recharge_id=NULL WHERE id='${original(member)}';`);
  const result = await refund(member, 1000);
  assert.equal(result.status, 409);
  assert.match(result.data.message, /人工核对/);
  assert.equal(sql(`SELECT count(*) FROM member_recharge_refund WHERE member_id='${member.id}';`), '0');
});

test('R03: completion rejects legacy over-reservations without debiting the wallet', async () => {
  const member = await newMember();
  const row = ok(await refund(member, 8000));
  sql(`INSERT INTO member_recharge_refund(id,tenant_id,store_id,member_id,original_transaction_id,refund_no,request_key,status,amount_cents,reason,requested_by_name_snapshot)
    SELECT gen_random_uuid(),tenant_id,store_id,member_id,original_transaction_id,'legacy-'||refund_no,gen_random_uuid()::text,'PENDING',8000,reason,requested_by_name_snapshot FROM member_recharge_refund WHERE id='${row.id}';`);
  assert.equal((await api(`/api/v1/member-recharge-refunds/${row.id}/complete`, {})).status, 409);
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`), '10000');
});

test('R15: mobile clock-out preserves another active service room state', async () => {
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

test('R16: approving room transfer reassigns a bed in the destination room', async () => {
  const from = roomFixture(), to = roomFixture();
  sql(`INSERT INTO room_bed(id,tenant_id,store_id,room_id,code,name,sort_order)
    SELECT gen_random_uuid(),'${tenant}','${store}','${to}','CUSTOM-'||n,'Custom bed',n FROM generate_series(10,20,10) n;`);
  const session = activeService(from, technician);
  const other = activeService(from, '30000000-0000-0000-0000-000000000002');
  const oldBed = sql(`SELECT bed_id FROM service_session WHERE id='${session}';`);
  const request = ok(await api('/api/v1/service-room-transfers', { serviceSessionId: session, toRoomId: to, reason: 'Review fixture' }));
  ok(await api(`/api/v1/service-room-transfers/${request.id}/approve`, {}));
  assert.equal(sql(`SELECT count(*) FROM service_session s JOIN room_bed b ON b.id=s.bed_id WHERE s.id='${session}' AND s.room_id=b.room_id;`), '1');
  assert.equal(sql(`SELECT count(*) FROM service_session WHERE bed_id='${oldBed}' AND status='IN_SERVICE';`), '0');
  assert.equal(sql(`SELECT count(*) FROM service_session WHERE room_id='${to}' AND status='IN_SERVICE';`), '1');
  assert.equal(sql(`SELECT count(*) FROM room_bed WHERE room_id='${to}';`), '2');
  assert.equal(sql(`SELECT status FROM room_status_event WHERE room_id='${from}' ORDER BY occurred_at DESC,id DESC LIMIT 1;`), 'IN_SERVICE');
  assert.throws(() => sql(`UPDATE service_session SET bed_id='${oldBed}' WHERE id='${session}';`), /service_bed_room_ownership/);
  assert.throws(() => sql(`UPDATE service_session SET room_id=null WHERE id='${session}';`), /service_bed_requires_room/);
  sql(`UPDATE service_session SET status='COMPLETED',ended_at=now() WHERE id IN ('${session}','${other}');
    UPDATE service_session_participant SET status='COMPLETED',service_ended_at=now() WHERE service_session_id IN ('${session}','${other}');`);
});

test('R07: concurrent settlements cross a monthly tier exactly once', async () => {
  const date = sql('SELECT current_date::text;');
  const prior = Number(sql(`SELECT coalesce(sum(clock_count_adjustment),0) FROM technician_commission_record
    WHERE store_id='${store}' AND technician_id='${technician}' AND source_type='MAIN'
      AND business_date>=date_trunc('month',current_date) AND business_date<date_trunc('month',current_date)+interval '1 month';`));
  const policy = randomUUID();
  sql(`INSERT INTO store_commission_tier_policy_version(id,tenant_id,store_id,active,effective_business_date)
      VALUES('${policy}','${tenant}','${store}',true,current_date);
    INSERT INTO store_commission_tier(id,tenant_id,store_id,policy_version_id,tier_name,minimum_monthly_clock_count,commission_multiplier_bp,sort_order)
      VALUES(gen_random_uuid(),'${tenant}','${store}','${policy}','Fixture base',0,10000,1),
        (gen_random_uuid(),'${tenant}','${store}','${policy}','Fixture next',${prior + 2},12000,2);
    CREATE FUNCTION review_tier_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$;
    CREATE TRIGGER review_tier_barrier BEFORE INSERT ON technician_commission_record FOR EACH ROW EXECUTE FUNCTION review_tier_barrier();`);
  const second = ok(await api('/api/v1/admin/auth/login', { loginName:'review-admin', password }, null)).accessToken;
  try {
    const results = await Promise.all([api('/api/v1/sales-orders/historical-backfill', backfill(), admin),
      api('/api/v1/sales-orders/historical-backfill', backfill(), second)]);
    results.forEach(row => ok(row));
    assert.equal(sql(`SELECT string_agg(monthly_clock_count_snapshot||':'||commission_multiplier_bp_snapshot,',' ORDER BY monthly_clock_count_snapshot)
      FROM technician_commission_record WHERE commission_tier_policy_version_id='${policy}' AND record_type='SETTLEMENT' AND source_type='MAIN';`),
    `${prior+1}:10000,${prior+2}:12000`);
  } finally {
    sql('DROP TRIGGER review_tier_barrier ON technician_commission_record; DROP FUNCTION review_tier_barrier();');
  }
});

test('R15: settled historical services do not keep a transferred-from room awaiting payment', async () => {
  const from = roomFixture(), to = roomFixture();
  const order = ok(await api('/api/v1/sales-orders/historical-backfill', backfill()));
  const old = sql(`SELECT service_session_id FROM sales_order_service_session WHERE order_id='${order.orderId}' LIMIT 1;`);
  sql(`UPDATE service_session SET room_id='${from}',bed_id=null WHERE id='${old}';`);
  const session = activeService(from, technician);
  const request = ok(await api('/api/v1/service-room-transfers', {serviceSessionId:session,toRoomId:to,reason:'Review fixture'}));
  ok(await api(`/api/v1/service-room-transfers/${request.id}/approve`, {}));
  assert.equal(sql(`SELECT status FROM room_status_event WHERE room_id='${from}' ORDER BY occurred_at DESC,id DESC LIMIT 1;`), 'CLEANING');
  sql(`UPDATE service_session SET status='COMPLETED',ended_at=now() WHERE id='${session}';
    UPDATE service_session_participant SET status='COMPLETED',service_ended_at=now() WHERE service_session_id='${session}';`);
});

test('R12: concurrent payment changes cannot mix report totals and channel snapshots', async () => {
  const date = sql('SELECT current_date::text;');
  const url = `/api/v1/operations/daily-report?date=${date}`;
  const before = ok(await api(url));
  const payment = sql(`SELECT p.id FROM payment_record p JOIN sales_order o ON o.id=p.order_id
    WHERE o.store_id='${store}' AND o.status='SETTLED' AND o.paid_cents>0 AND o.business_date=current_date LIMIT 1;`);
  assert.ok(payment);
  // Pause the first aggregate after its snapshot starts, before later channel queries.
  sql(`ALTER TABLE payment_record RENAME TO review_payment_backing;
    CREATE FUNCTION review_snapshot_pause() RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$ BEGIN
      IF current_setting('review.paused',true) IS DISTINCT FROM 'yes' THEN
        PERFORM set_config('review.paused','yes',true); PERFORM pg_sleep(2);
      END IF; RETURN true; END $$;
    CREATE VIEW payment_record AS SELECT * FROM review_payment_backing WHERE review_snapshot_pause();`);
  let pending, changed = false;
  try {
    pending = api(url);
    let paused = false;
    for (let n=0; n<100; n++) {
      paused = sql("SELECT exists(SELECT 1 FROM pg_stat_activity WHERE wait_event='PgSleep' AND query LIKE '%payment_record%');") === 't';
      if (paused) break;
      await delay(20);
    }
    assert.ok(paused, 'Report must reach the read barrier');
    sql(`UPDATE review_payment_backing SET amount_cents=amount_cents+100 WHERE id='${payment}';`);
    changed = true;
    const during = ok(await pending);
    assert.equal(during.salesAmountCents, before.salesAmountCents);
    assert.deepEqual(during.unifiedMetrics.channels, before.unifiedMetrics.channels);
    const after = ok(await api(url));
    assert.equal(after.salesAmountCents, before.salesAmountCents+100);
    assert.equal(after.unifiedMetrics.channels.reduce((sum,c)=>sum+c.salesCents,0), after.salesAmountCents);
  } finally {
    if (pending) await pending.catch(()=>{});
    if (changed) sql(`UPDATE review_payment_backing SET amount_cents=amount_cents-100 WHERE id='${payment}';`);
    sql('DROP VIEW payment_record; ALTER TABLE review_payment_backing RENAME TO payment_record; DROP FUNCTION review_snapshot_pause();');
  }
});

test('R17: stale save and competing publish respect version and published status', async () => {
  const date = sql("SELECT (current_date-2)::text;");
  const created = ok(await api('/api/v1/daily-reports', { businessDate:date }));
  const id = created.report.id, version = created.report.version;
  const second = ok(await api('/api/v1/admin/auth/login', { loginName:'review-admin', password }, null)).accessToken;
  sql(`CREATE FUNCTION review_report_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$;
    CREATE TRIGGER review_report_barrier BEFORE UPDATE ON daily_operating_report FOR EACH ROW EXECUTE FUNCTION review_report_barrier();`);
  try {
    const result = await Promise.all([api(`/api/v1/daily-reports/${id}`, { businessDate:date, version, incidentNote:'competing save' }, admin, {}, 'PUT'),
      api(`/api/v1/daily-reports/${id}/publish?version=${version}`, {}, second)]);
    assert.deepEqual(result.map(row=>row.status).sort(), [200,409]);
  } finally {
    sql('DROP TRIGGER review_report_barrier ON daily_operating_report; DROP FUNCTION review_report_barrier();');
  }
  assert.equal((await api(`/api/v1/daily-reports/${id}`, { businessDate:date, version }, admin, {}, 'PUT')).status, 409);
  if (sql(`SELECT status FROM daily_operating_report WHERE id='${id}';`) !== 'PUBLISHED') {
    const latest = sql(`SELECT version FROM daily_operating_report WHERE id='${id}';`);
    ok(await api(`/api/v1/daily-reports/${id}/publish?version=${latest}`, {}));
  }
  assert.equal((await api(`/api/v1/daily-reports/${id}`, { businessDate:date }, admin, {}, 'PUT')).status, 409);
  assert.equal(sql(`SELECT status FROM daily_operating_report WHERE id='${id}';`), 'PUBLISHED');
});

test('R13: a missing historical price rejects posting without fallback or partial writes', async () => {
  const before = counts();
  sql(`UPDATE service_item_price_version SET effective_business_date=current_date+1 WHERE service_item_id='${item}';`);
  try {
    const result = await api('/api/v1/sales-orders/historical-backfill', backfill());
    assert.equal(result.status, 422);
    assert.match(result.data.message, /Missing historical price/);
    assert.equal(counts(), before);
  } finally { sql(`UPDATE service_item_price_version SET effective_business_date='1970-01-01' WHERE service_item_id='${item}';`); }
});

test('R11: room capacity changes synchronize beds and reject occupied shrink or disable', async () => {
  const code = randomUUID();
  const room = ok(await api('/api/v1/rooms', { code, name:'Capacity fixture', roomType:'PRIVATE', bedCount:2 }));
  const update = bedCount => api(`/api/v1/rooms/${room.id}`, { code, name:'Capacity fixture', roomType:'PRIVATE', bedCount }, admin, {}, 'PUT');
  assert.equal(sql(`SELECT count(*) FROM room_bed WHERE room_id='${room.id}' AND active;`), '2');
  ok(await update(3));
  assert.equal(sql(`SELECT count(*) FROM room_bed WHERE room_id='${room.id}' AND active;`), '3');
  const session = activeService(room.id, technician);
  const bed = sql(`SELECT bed_id FROM service_session WHERE id='${session}';`);
  sql(`UPDATE room_bed SET sort_order=999 WHERE id='${bed}';`);
  assert.equal((await update(1)).status, 409);
  assert.equal((await api(`/api/v1/rooms/${room.id}/active`, { active:false }, admin, {}, 'PUT')).status, 409);
  assert.equal((await api(`/api/v1/rooms/beds/${bed}/active`, { active:false }, admin, {}, 'PUT')).status, 409);
  sql(`UPDATE service_session SET status='COMPLETED',ended_at=now() WHERE id='${session}';
    UPDATE service_session_participant SET status='COMPLETED',service_ended_at=now() WHERE service_session_id='${session}';`);
  ok(await update(1));
  assert.equal(sql(`SELECT count(*) FROM room_bed WHERE room_id='${room.id}' AND active;`), '1');
  ok(await api(`/api/v1/rooms/${room.id}/active`, { active:false }, admin, {}, 'PUT'));
});

test('R14: malformed forwarding does not roll back a valid business write and missing rows return 404', async () => {
  const result = ok(await api('/api/v1/members', { name:'IP fixture', phone:randomUUID().slice(0,20) }, admin, { 'X-Forwarded-For':'not-an-ip' }));
  assert.equal(sql(`SELECT host(ip_address) FROM audit_log WHERE entity_id='${result.id}' ORDER BY created_at DESC LIMIT 1;`), '127.0.0.1');
  assert.equal((await api(`/api/v1/member-recharge-refunds/${randomUUID()}/complete`, {})).status, 404);
});

test('R14: employee attendance conflicts return 409 and invalid employee input returns 422', async () => {
  const employeeId = randomUUID();
  sql(`INSERT INTO employee(id,tenant_id,full_name) VALUES('${employeeId}','${tenant}','Review employee');
    INSERT INTO employee_store_assignment(id,tenant_id,employee_id,store_id,position_type,position_name)
    VALUES(gen_random_uuid(),'${tenant}','${employeeId}','${store}','CASHIER','Review cashier');`);
  const input = {employeeId};
  assert.equal((await api('/api/v1/employee-attendance/clock-out',input)).status,409);
  ok(await api('/api/v1/employee-attendance/clock-in',input));
  assert.equal((await api('/api/v1/employee-attendance/clock-in',input)).status,409);
  ok(await api('/api/v1/employee-attendance/clock-out',input));
  assert.equal((await api('/api/v1/employee-attendance/clock-out',input)).status,409);
  assert.equal((await api('/api/v1/employee-attendance/clock-in',{employeeId:randomUUID()})).status,422);
});

test('R09: changing a password revokes other sessions but keeps the current session', async () => {
  const old = ok(await api('/api/v1/admin/auth/login', { loginName:'review-cashier', password }, null)).accessToken;
  const nextPassword = randomBytes(24).toString('base64url');
  ok(await api('/api/v1/admin/auth/password', { currentPassword:password, newPassword:nextPassword }, cashier, {}, 'PUT'));
  assert.equal((await api('/api/v1/admin/auth/session', undefined, old)).status, 401);
  ok(await api('/api/v1/admin/auth/session', undefined, cashier));
  assert.equal((await api('/api/v1/admin/auth/login', { loginName:'review-cashier', password }, null)).status, 401);
  ok(await api('/api/v1/admin/auth/login', { loginName:'review-cashier', password:nextPassword }, null));
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

function correctRecharge(member, overrides = {}, token = manager, headers = {}) {
  return api(`/api/v1/members/${member.id}/recharges/${original(member)}/correction`,
    {paymentMethod:'ALIPAY',reason:'Reviewed historical payment',version:0,...overrides}, token, headers, 'PUT');
}

test('recharge correction: manager updates original-day channels, persisted report and audit only', async () => {
  const member = await newMember(10000,2000), recharge = original(member), date='2020-02-03';
  sql(`UPDATE wallet_transaction SET business_date='${date}' WHERE member_id='${member.id}';
    INSERT INTO daily_operating_report(id,tenant_id,store_id,business_date,status,manager_count,incident_note)
    VALUES(gen_random_uuid(),'${tenant}','${store}','${date}','PUBLISHED',5,'preserved');
    INSERT INTO daily_operating_report(id,tenant_id,store_id,business_date)
    VALUES(gen_random_uuid(),'${tenant}','${store}',current_date) ON CONFLICT(store_id,business_date) DO NOTHING;`);
  const today = sql('SELECT current_date::text;');
  const todayReport = ok(await api(`/api/v1/daily-reports?date=${today}`));
  const untouched = sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY id)::text FROM daily_operating_report r WHERE NOT(store_id='${store}' AND business_date='${date}');`);
  const beforeLedger = sql(`SELECT amount_cents||':'||balance_before_cents||':'||balance_after_cents||':'||created_at FROM wallet_transaction WHERE id='${recharge}';`);
  const changed = ok(await correctRecharge(member));
  assert.equal(changed.businessDate,date); assert.equal(changed.balanceCents,12000); assert.equal(changed.adjustmentId,null);
  const historical = ok(await api(`/api/v1/daily-reports?date=${date}`));
  assert.equal(historical.currentValues.dailyCashFlowCents,10000);
  assert.equal(historical.paymentChannels.find(c=>c.code==='CASH').rechargeCents,0);
  assert.equal(historical.paymentChannels.find(c=>c.code==='ALIPAY').rechargeCents,10000);
  assert.equal(historical.report.dailyAlipayCents,10000); assert.equal(historical.report.dailyCashCents,0);
  assert.equal(historical.report.status,'PUBLISHED'); assert.equal(historical.report.managerCount,5);
  assert.equal(historical.report.incidentNote,'preserved');
  assert.deepEqual(ok(await api(`/api/v1/daily-reports?date=${today}`)),todayReport);
  assert.equal(sql(`SELECT jsonb_agg(to_jsonb(r) ORDER BY id)::text FROM daily_operating_report r WHERE NOT(store_id='${store}' AND business_date='${date}');`),untouched);
  assert.equal(sql(`SELECT amount_cents||':'||balance_before_cents||':'||balance_after_cents||':'||created_at FROM wallet_transaction WHERE id='${recharge}';`),beforeLedger);
  const audit = JSON.parse(sql(`SELECT json_build_object('before',before_data,'after',after_data,'actor',actor_user_id,'at',created_at)::text FROM audit_log WHERE action='MEMBER_RECHARGE_CORRECTED' AND entity_id='${recharge}';`));
  assert.equal(audit.before.businessDate,date); assert.equal(audit.after.businessDate,date);
  assert.equal(audit.before.paymentMethod,'CASH'); assert.equal(audit.after.paymentMethod,'ALIPAY');
  assert.equal(audit.before.amountCents,10000); assert.equal(audit.after.amountCents,10000);
  assert.equal(audit.after.reason,'Reviewed historical payment'); assert.ok(audit.at);
  assert.equal(audit.actor,sql("SELECT id FROM app_user WHERE login_name='review-manager';"));
});

test('recharge correction: principal changes preserve the ledger, bonus and refund ceiling', async () => {
  const member = await newMember(10000,2000), recharge = original(member), date='2020-02-04';
  sql(`UPDATE wallet_transaction SET business_date='${date}' WHERE member_id='${member.id}';
    INSERT INTO daily_operating_report(id,tenant_id,store_id,business_date)
    VALUES(gen_random_uuid(),'${tenant}','${store}','${date}');`);
  const today = ok(await api('/api/v1/operations/daily-report'));
  const increased = ok(await correctRecharge(member,{amountCents:15000}));
  assert.equal(increased.balanceCents,17000);
  assert.equal(sql(`SELECT daily_card_sale_cents||':'||daily_card_open_cents||':'||daily_alipay_cents FROM daily_operating_report WHERE store_id='${store}' AND business_date='${date}';`),'15000:15000:15000');
  assert.equal(sql(`SELECT amount_cents||':'||balance_before_cents||':'||balance_after_cents||':'||business_date FROM wallet_transaction WHERE id='${increased.adjustmentId}';`),`5000:12000:17000:${date}`);
  const decreased = ok(await correctRecharge(member,{amountCents:8000,version:1},admin));
  assert.equal(decreased.balanceCents,10000);
  assert.equal(sql(`SELECT daily_card_sale_cents||':'||daily_card_open_cents||':'||daily_alipay_cents FROM daily_operating_report WHERE store_id='${store}' AND business_date='${date}';`),'8000:8000:8000');
  assert.equal(sql(`SELECT count(*) FROM wallet_transaction WHERE member_id='${member.id}' AND balance_before_cents+amount_cents<>balance_after_cents;`),'0');
  assert.equal(sql(`SELECT sum(amount_cents) FROM wallet_transaction WHERE member_id='${member.id}';`),'10000');
  assert.equal(sql(`SELECT amount_cents FROM wallet_transaction WHERE member_id='${member.id}' AND transaction_type='BONUS';`),'2000');
  const profile = ok(await api(`/api/v1/members/${member.id}/profile`));
  assert.equal(profile.member.rechargeCents,8000); assert.equal(profile.member.lastRechargeCents,8000);
  assert.equal(profile.transactions.find(t=>t.id===recharge).rechargeAmountCents,8000);
  const report = ok(await api(`/api/v1/operations/daily-report?date=${date}`));
  assert.equal(report.rechargeAmountCents,8000);
  const detail = ok(await api(`/api/v1/daily-reports?date=${date}`));
  assert.equal(detail.currentValues.dailyCardOpenCents,8000); assert.equal(detail.currentValues.dailyCashFlowCents,8000);
  assert.deepEqual(ok(await api('/api/v1/operations/daily-report')),today);
  assert.equal((await refund(member,9000)).status,409);
  const request = ok(await refund(member,8000));
  ok(await api(`/api/v1/member-recharge-refunds/${request.id}/complete`,{}));
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`),'0');
  const raised=await newMember(10000), raisedId=original(raised);
  ok(await correctRecharge(raised,{amountCents:15000}));
  const raisedRefund=ok(await refund(raised,15000));
  ok(await api(`/api/v1/member-recharge-refunds/${raisedRefund.id}/complete`,{}));
  const output = command('psql',[...connection,'-Atq','-v','from_date=2020-02-04','-f',path.join(root,'tools/maintenance/inspect_data_quality.sql')]);
  for (const check of ['RECHARGE_OVER_REFUND','WALLET_ROW_EQUATION']) {
    const line=output.split(/\r?\n/).find(line=>line.startsWith(check+'|'));
    assert.ok(line,check);
    assert.ok(!JSON.parse(line.split('|')[3]).some(row=>[recharge,raisedId].includes(row.id)),line);
  }
});

test('recharge correction: original recharge remains accessible after more than 200 wallet entries', async () => {
  const member=await newMember(), recharge=original(member);
  sql(`UPDATE wallet_transaction SET created_at=now()-interval '2 years',business_date='2020-02-06' WHERE id='${recharge}';
    INSERT INTO wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,business_date)
    SELECT gen_random_uuid(),'${tenant}','${store}',w.id,'${member.id}','ADJUSTMENT',0,10000,10000,'REVIEW_FIXTURE',current_date
    FROM member_wallet w CROSS JOIN generate_series(1,201) WHERE w.member_id='${member.id}';`);
  const profile=ok(await api(`/api/v1/members/${member.id}/profile`));
  assert.equal(profile.transactions.length,200);
  assert.ok(!profile.transactions.some(row=>row.id===recharge));
  assert.equal(profile.recharges.length,1); assert.equal(profile.recharges[0].id,recharge);
  assert.equal(ok(await correctRecharge(member)).businessDate,'2020-02-06');
});

test('recharge correction: historical renewal changes renewal totals without changing opening principal', async () => {
  const member=await newMember(), date='2020-02-07';
  sql(`UPDATE wallet_transaction SET business_date='2020-02-06' WHERE member_id='${member.id}';`);
  ok(await api(`/api/v1/members/${member.id}/recharges`,{amountCents:20000,bonusCents:0,paymentMethod:'CASH'}));
  const renewal=sql(`SELECT id FROM wallet_transaction WHERE member_id='${member.id}' AND transaction_type='RECHARGE' ORDER BY created_at DESC LIMIT 1;`);
  sql(`UPDATE wallet_transaction SET business_date='${date}' WHERE id='${renewal}';
    INSERT INTO daily_operating_report(id,tenant_id,store_id,business_date) VALUES(gen_random_uuid(),'${tenant}','${store}','${date}');`);
  ok(await api(`/api/v1/members/${member.id}/recharges/${renewal}/correction`,
    {paymentMethod:'WECHAT',amountCents:18000,reason:'Reviewed renewal',version:0},manager,{},'PUT'));
  const report=ok(await api(`/api/v1/daily-reports?date=${date}`));
  assert.equal(report.currentValues.dailyCardOpenCents,0); assert.equal(report.currentValues.dailyCardRenewCents,18000);
  assert.equal(report.report.dailyCardRenewCents,18000);
  assert.equal(report.paymentChannels.find(c=>c.code==='WECHAT').rechargeCents,18000);
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`),'28000');
  assert.equal(sql(`SELECT coalesce(corrected_amount_cents,amount_cents) FROM wallet_transaction WHERE id='${original(member)}';`),'10000');
});

test('recharge correction: role, matrix path and cross-store boundaries prevent writes', async () => {
  const member=await newMember(), recharge=original(member), before=counts();
  assert.equal((await correctRecharge(member,{},cashier)).status,403);
  assert.equal((await api(`/api/v1/members;test=1/${member.id}/recharges/${recharge}/correction`,
    {paymentMethod:'ALIPAY',reason:'review',version:0},cashier,{},'PUT')).status,403);
  const other=randomUUID();
  sql(`INSERT INTO store(id,tenant_id,name,code) VALUES('${other}','${tenant}','Correction boundary','${other}');`);
  assert.equal((await correctRecharge(member,{},manager,{'X-Store-Id':other})).status,403);
  assert.equal((await correctRecharge(member,{},admin,{'X-Store-Id':other})).status,404);
  assert.equal((await api(`/api/v1/members/${randomUUID()}/recharges/${recharge}/correction`,
    {paymentMethod:'ALIPAY',reason:'review',version:0},admin,{},'PUT')).status,404);
  assert.equal(counts(),before);
  assert.equal(sql(`SELECT correction_version FROM wallet_transaction WHERE id='${recharge}';`),'0');
});

test('recharge correction: mandatory reason, valid amount, channel and optimistic version', async () => {
  const member=await newMember(), recharge=original(member);
  for(const input of [{reason:' '},{amountCents:0},{amountCents:-1},{version:null}]) {
    assert.equal((await correctRecharge(member,input)).status,400);
  }
  assert.equal((await correctRecharge(member,{paymentMethod:'MEMBER_BALANCE'})).status,422);
  assert.equal((await correctRecharge(member,{paymentMethod:'NOT_A_METHOD'})).status,422);
  assert.equal((await correctRecharge(member,{paymentMethod:'CASH'})).status,409);
  assert.equal((await correctRecharge(member,{version:1})).status,409);
  assert.equal(sql(`SELECT count(*) FROM audit_log WHERE entity_id='${recharge}' AND action='MEMBER_RECHARGE_CORRECTED';`),'0');
  ok(await correctRecharge(member));
  assert.equal((await correctRecharge(member,{amountCents:20000})).status,409);
});

test('recharge correction: pending and completed refunds block changes; cancelled refunds permit correction', async () => {
  const member=await newMember(), recharge=original(member);
  const pending=ok(await refund(member,100));
  assert.equal((await correctRecharge(member,{version:1})).status,409);
  ok(await api(`/api/v1/member-recharge-refunds/${pending.id}/cancel`,{}));
  ok(await correctRecharge(member,{version:1}));
  const second=ok(await refund(member,100));
  ok(await api(`/api/v1/member-recharge-refunds/${second.id}/complete`,{}));
  const version=Number(sql(`SELECT correction_version FROM wallet_transaction WHERE id='${recharge}';`));
  assert.equal((await correctRecharge(member,{paymentMethod:'CASH',version})).status,409);
  assert.equal(ok(await api(`/api/v1/members/${member.id}/profile`)).transactions.find(t=>t.id===recharge).refundLocked,true);
});

test('recharge correction: spent principal cannot make wallet negative and rejection is atomic', async () => {
  const member=await newMember(), recharge=original(member);
  sql(`INSERT INTO wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,business_date)
    SELECT gen_random_uuid(),'${tenant}','${store}',id,'${member.id}','ADJUSTMENT',-9000,10000,1000,'REVIEW_FIXTURE',current_date
    FROM member_wallet WHERE member_id='${member.id}'; UPDATE member_wallet SET balance_cents=1000 WHERE member_id='${member.id}';`);
  const before=sql(`SELECT row_to_json(t)::text FROM wallet_transaction t WHERE id='${recharge}';`), count=counts();
  assert.equal((await correctRecharge(member,{amountCents:8999})).status,409);
  assert.equal(counts(),count);
  assert.equal(sql(`SELECT row_to_json(t)::text FROM wallet_transaction t WHERE id='${recharge}';`),before);
  assert.equal(ok(await correctRecharge(member,{amountCents:9000})).balanceCents,0);
});

test('recharge correction: two sessions editing one version apply only one financial delta', async () => {
  const member=await newMember();
  const results=await Promise.all([correctRecharge(member,{amountCents:12000},manager),correctRecharge(member,{amountCents:13000},admin)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winner=results.find(r=>r.status===200).data;
  assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`),String(winner.amountCents));
  assert.equal(sql(`SELECT count(*) FROM wallet_transaction WHERE member_id='${member.id}' AND source='RECHARGE_CORRECTION';`),'1');
});

test('recharge correction: a concurrent refund reservation invalidates the correction snapshot', async () => {
  const member=await newMember(), recharge=original(member);
  sql(`CREATE FUNCTION review_correction_refund_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.member_id='${member.id}'::uuid THEN PERFORM pg_sleep(2); END IF; RETURN NEW; END $$;
    CREATE TRIGGER review_correction_refund_barrier BEFORE INSERT ON member_recharge_refund FOR EACH ROW EXECUTE FUNCTION review_correction_refund_barrier();`);
  try {
    const pending=refund(member,8000,admin);
    let sleeping=false;
    for(let n=0;n<40;n++) {
      sleeping=sql("SELECT exists(select 1 from pg_stat_activity where wait_event='PgSleep' and query like 'insert into member_recharge_refund%');")==='t';
      if(sleeping)break;
      await delay(50);
    }
    assert.ok(sleeping,'refund must hold the principal before correction starts');
    const correction=correctRecharge(member,{amountCents:1000});
    ok(await pending);
    assert.equal((await correction).status,409);
    assert.equal(sql(`SELECT coalesce(corrected_amount_cents,amount_cents) FROM wallet_transaction WHERE id='${recharge}';`),'10000');
  } finally { sql('DROP TRIGGER review_correction_refund_barrier ON member_recharge_refund; DROP FUNCTION review_correction_refund_barrier();'); }
});

test('recharge correction: audit persistence failure rolls back principal, wallet, ledger and report', async () => {
  const member=await newMember(), recharge=original(member), date='2020-02-05';
  sql(`UPDATE wallet_transaction SET business_date='${date}' WHERE id='${recharge}';
    INSERT INTO daily_operating_report(id,tenant_id,store_id,business_date) VALUES(gen_random_uuid(),'${tenant}','${store}','${date}');
    CREATE FUNCTION review_correction_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='MEMBER_RECHARGE_CORRECTED' AND NEW.entity_id='${recharge}'::uuid THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER review_correction_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION review_correction_audit_failure();`);
  const snapshot=()=>sql(`SELECT json_build_object('principal',(SELECT row_to_json(t) FROM wallet_transaction t WHERE id='${recharge}'),
    'wallet',(SELECT row_to_json(w) FROM member_wallet w WHERE member_id='${member.id}'),
    'report',(SELECT row_to_json(r) FROM daily_operating_report r WHERE store_id='${store}' AND business_date='${date}'))::text;`);
  const before=snapshot(), count=counts();
  try { assert.equal((await correctRecharge(member,{amountCents:12000})).status,500); assert.equal(snapshot(),before); assert.equal(counts(),count); }
  finally { sql('DROP TRIGGER review_correction_audit_failure ON audit_log; DROP FUNCTION review_correction_audit_failure();'); }
});

if (process.env.REVIEW_BROWSER) test('recharge correction: real browser manager edit, mobile layout and cashier visibility', async () => {
  const {chromium}=require(process.env.REVIEW_BROWSER);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const errors=[];
  try {
    for(const width of [1440,390]) {
      const member=await newMember(), recharge=original(member);
      sql(`UPDATE wallet_transaction SET business_date='2020-02-08' WHERE id='${recharge}';`);
      const page=await browser.newPage({viewport:{width,height:900}});
      page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(({token,store})=>{
        if(!localStorage.getItem('chengxin-admin-access-token'))localStorage.setItem('chengxin-admin-access-token',token);
        localStorage.setItem('chengxin-current-store-id',store);
      },{token:manager,store});
      await page.goto(consoleBase);
      await page.waitForFunction(()=>typeof frontdeskLoginRequired!=='undefined'&&!frontdeskLoginRequired);
      await page.evaluate(id=>openMemberProfile(id),member.id);
      await page.locator(`[data-recharge-correct="${recharge}"]`).click();
      const dialog=page.locator('#member-recharge-correction-dialog');
      await dialog.waitFor({state:'visible'});
      const box=await dialog.boundingBox();
      assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=900);
      assert.equal(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
      await dialog.locator('[name=paymentMethod]').selectOption('ALIPAY');
      await dialog.locator('[name=amount]').fill('125.00');
      await dialog.locator('[name=reason]').fill('Browser historical correction');
      await page.screenshot({path:path.join(dir,`recharge-dialog-${width}.png`)});
      const response=page.waitForResponse(r=>r.url().endsWith(`/${recharge}/correction`)&&r.request().method()==='PUT');
      await dialog.locator('[type=submit]').click();
      assert.equal((await response).status(),200);
      await page.waitForFunction(()=>!document.querySelector('#member-recharge-correction-dialog').open);
      await page.waitForFunction(()=>document.querySelector('#member-recharge-history').textContent.includes('125.00'));
      assert.equal(sql(`SELECT balance_cents FROM member_wallet WHERE member_id='${member.id}';`),'12500');
      await page.evaluate(token=>localStorage.setItem('chengxin-admin-access-token',token),cashier);
      await page.reload();
      await page.waitForFunction(()=>typeof frontdeskLoginRequired!=='undefined'&&!frontdeskLoginRequired);
      await page.evaluate(id=>openMemberProfile(id),member.id);
      assert.equal(await page.locator('[data-recharge-correct]').count(),0);
      await page.close();
    }
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
