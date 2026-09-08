const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..', '..', '..');
const filter = fs.readFileSync(path.join(root, 'services/massage-api/src/main/java/com/chengxin/massage/admin/OfflineOperationIdempotencyFilter.java'), 'utf8');
const sales = fs.readFileSync(path.join(root, 'services/massage-api/src/main/java/com/chengxin/massage/sales/SalesOrderController.java'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'services/massage-api/src/main/resources/db/migration/V87__idempotency_duplicate_prevention.sql'), 'utf8');
const offline = fs.readFileSync(path.join(__dirname, '..', 'offline-sync.js'), 'utf8');
const home = fs.readFileSync(path.join(root, 'services/massage-api/src/main/java/com/chengxin/massage/HomeController.java'), 'utf8');

test('idempotency filter covers financial and recharge writes', () => {
  assert.match(filter, /sales-orders\/\(settle\|\[\^\/\]\+\/\(void\|refunds\)\)/);
  assert.match(filter, /path\.startsWith\("\/api\/v1\/refunds"\)/);
  assert.match(filter, /members\/\[\^\/\]\+\/recharges/);
});

test('settlement uses a sequence and returns an existing settled order', () => {
  assert.match(sales, /findExistingSettledOrder\(storeId, input\.lines\(\)\)/);
  assert.match(sales, /nextval\('order_number_seq'\)/);
  assert.doesNotMatch(sales, /String orderNo = "SO" \+ System\.currentTimeMillis\(\)/);
});

test('V87 adds only the requested sequence and active participant index', () => {
  assert.match(migration, /CREATE SEQUENCE IF NOT EXISTS order_number_seq/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uk_participant_technician_active/);
  assert.match(migration, /PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE/);
  assert.doesNotMatch(migration, /sales_order.*ADD CONSTRAINT/i);
});

test('browser writes receive an operation id and duplicate-submit guard', () => {
  assert.match(offline, /window\.idempotentFetch/);
  assert.match(offline, /X-Offline-Operation-Id/);
  assert.match(offline, /let isSubmitting = false/);
  assert.match(offline, /response\.status === 204/);
  assert.match(offline, /status:409/);
  assert.match(offline, /if \(!queueable\(request\.url, request\.method, init\.body\)\) throw error/);
});

test('rapid duplicate writes issue one request and restore the submit button', async () => {
  let finishRequest;
  const requests = [];
  const button = { disabled:false, closest:selector => selector === 'button' ? button : null };
  const toast = { textContent:'', classList:{ add() {}, remove() {} } };
  const window = {
    crypto:{ randomUUID },
    fetch:(input, init) => {
      requests.push({ input, init });
      return new Promise(resolve => { finishRequest = resolve; });
    },
    setTimeout() {},
    addEventListener() {},
    setInterval() {},
    dispatchEvent() {}
  };
  const document = { activeElement:button, querySelector:() => toast };
  const executable = offline.slice(0, offline.indexOf('  document.body.insertAdjacentHTML')) + '})();';
  vm.runInNewContext(executable, {
    window, document, location:{ href:'http://localhost/' }, navigator:{ onLine:true },
    URL, Headers, Response, FormData, Blob, CustomEvent:class {}, indexedDB:{}, console
  });

  const first = window.fetch('/api/v1/sales-orders/settle', { method:'POST', body:'{}' });
  await Promise.resolve();
  assert.equal(button.disabled, true);
  assert.equal(requests.length, 1);
  assert.match(requests[0].init.headers.get('X-Offline-Operation-Id'), /^[0-9a-f-]{36}$/);

  const duplicate = await window.fetch('/api/v1/sales-orders/settle', { method:'POST', body:'{}' });
  assert.equal(duplicate.status, 409);
  assert.equal(requests.length, 1);

  finishRequest(new Response(JSON.stringify({ orderNo:'SO26090700000001' }), { status:200 }));
  assert.equal((await first).status, 200);
  assert.equal(button.disabled, false);
});

test('a 204 idempotency replay is exposed to callers as success', async () => {
  const button = { disabled:false, closest:selector => selector === 'button' ? button : null };
  const window = {
    crypto:{ randomUUID }, fetch:async () => new Response(null, { status:204 }),
    setTimeout() {}, addEventListener() {}, setInterval() {}, dispatchEvent() {}
  };
  const document = { activeElement:button, querySelector:() => null };
  const executable = offline.slice(0, offline.indexOf('  document.body.insertAdjacentHTML')) + '})();';
  vm.runInNewContext(executable, {
    window, document, location:{ href:'http://localhost/' }, navigator:{ onLine:true },
    URL, Headers, Response, FormData, Blob, CustomEvent:class {}, indexedDB:{}, console
  });

  const response = await window.fetch('/api/v1/service-sessions/clock-in', { method:'POST', body:'{}' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Offline-Operation-Replayed'), 'true');
  assert.equal(button.disabled, false);
});

test('release health endpoint reports the daily report release', () => {
  assert.match(home, /20260907-daily-report-unification-v1/);
});
