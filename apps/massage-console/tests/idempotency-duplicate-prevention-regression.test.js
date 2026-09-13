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
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const mobileHtml = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
const mobile = fs.readFileSync(path.join(__dirname, '..', 'mobile.js'), 'utf8');
const technicianWorker = fs.readFileSync(path.join(__dirname, '..', 'technician-service-worker.js'), 'utf8');
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
  assert.match(offline, /const pendingWrites = new Map\(\)/);
  assert.match(offline, /response\.status === 204/);
  assert.match(offline, /if \(!queueable\(request\.url, request\.method, init\.body\)\) throw error/);
});

test('rapid duplicate writes share one request result and restore the submit button', async () => {
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

  const duplicate = window.fetch('/api/v1/sales-orders/settle', { method:'POST', body:'{}' });
  await Promise.resolve();
  assert.equal(requests.length, 1);

  finishRequest(new Response(JSON.stringify({ orderNo:'SO26090700000001' }), { status:200 }));
  assert.equal((await first).status, 200);
  assert.equal((await duplicate).status, 200);
  assert.equal(button.disabled, false);
});

test('different writes are not blocked by an unrelated in-flight request', async () => {
  const finishes = [];
  const requests = [];
  const button = { disabled:false, closest:selector => selector === 'button' ? button : null };
  const window = {
    crypto:{ randomUUID },
    fetch:(input, init) => {
      requests.push({ input, init });
      return new Promise(resolve => finishes.push(resolve));
    },
    setTimeout() {}, addEventListener() {}, setInterval() {}, dispatchEvent() {}
  };
  const document = { activeElement:button, querySelector:() => null };
  const executable = offline.slice(0, offline.indexOf('  document.body.insertAdjacentHTML')) + '})();';
  vm.runInNewContext(executable, {
    window, document, location:{ href:'http://localhost/' }, navigator:{ onLine:true },
    URL, Headers, Response, FormData, Blob, CustomEvent:class {}, indexedDB:{}, console
  });

  const roomStatus = window.fetch('/api/v1/rooms/ROOM_A/status', { method:'POST', body:'{"status":"IDLE"}' });
  const clockIn = window.fetch('/api/v1/service-sessions/clock-in', { method:'POST', body:'{"roomId":"ROOM_B"}' });
  await Promise.resolve();
  assert.equal(requests.length, 2);

  finishes.forEach(resolve => resolve(new Response('{}', { status:200 })));
  assert.equal((await roomStatus).status, 200);
  assert.equal((await clockIn).status, 200);
});

test('duplicate writes that fail offline queue one shared operation id', async () => {
  let failRequest;
  let requestCount = 0;
  const records = new Map();
  const database = {
    transaction() {
      const transaction = {
        objectStore:() => ({
          put:value => { records.set(value.operationId, value); return { result:value.operationId }; },
          getAll:() => ({ result:[...records.values()] })
        })
      };
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    }
  };
  const indexedDB = {
    open() {
      const request = { result:database };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
  };
  const window = {
    crypto:{ randomUUID },
    fetch:() => {
      requestCount++;
      return new Promise((resolve, reject) => { failRequest = reject; });
    },
    setTimeout() {}, addEventListener() {}, setInterval() {}, dispatchEvent() {}
  };
  const document = { activeElement:null, querySelector:() => null };
  const executable = offline.slice(0, offline.indexOf('  document.body.insertAdjacentHTML')) + '})();';
  vm.runInNewContext(executable, {
    window, document, location:{ href:'http://localhost/' }, navigator:{ onLine:false },
    URL, Headers, Response, FormData, Blob, CustomEvent:class {}, indexedDB, console
  });

  const first = window.fetch('/api/v1/service-sessions/clock-in', { method:'POST', body:'{}' });
  const duplicate = window.fetch('/api/v1/service-sessions/clock-in', { method:'POST', body:'{}' });
  await Promise.resolve();
  assert.equal(requestCount, 1);
  failRequest(new TypeError('offline'));
  const [firstResponse, duplicateResponse] = await Promise.all([first, duplicate]);
  const [firstBody, duplicateBody] = await Promise.all([firstResponse.json(), duplicateResponse.json()]);

  assert.equal(firstResponse.status, 202);
  assert.equal(duplicateResponse.status, 202);
  assert.equal(firstBody.operationId, duplicateBody.operationId);
  assert.equal(records.size, 1);
  assert.equal(records.get(firstBody.operationId).body, '{}');
});

test('operation id fallback remains a valid RFC 4122 UUID', async () => {
  const requests = [];
  const window = {
    crypto:{}, fetch:async (input, init) => { requests.push({ input, init }); return new Response('{}', { status:200 }); },
    setTimeout() {}, addEventListener() {}, setInterval() {}, dispatchEvent() {}
  };
  const document = { activeElement:null, querySelector:() => null };
  const executable = offline.slice(0, offline.indexOf('  document.body.insertAdjacentHTML')) + '})();';
  vm.runInNewContext(executable, {
    window, document, location:{ href:'http://localhost/' }, navigator:{ onLine:true },
    URL, Headers, Response, FormData, Blob, CustomEvent:class {}, indexedDB:{}, console, Math
  });

  const response = await window.fetch('/api/v1/service-sessions/clock-in', { method:'POST', body:'{}' });
  assert.equal(response.status, 200);
  assert.match(requests[0].init.headers.get('X-Offline-Operation-Id'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
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

test('room completion commands use the duplicate-submit guard', () => {
  assert.match(offline, /complete-cleaning/);
  assert.match(offline, /confirm-payment/);
});

test('historical backfill uses the same idempotent write and offline queue path', () => {
  assert.match(offline, /sales-orders\/historical-backfill/);
  assert.match(offline, /path === '\/api\/v1\/sales-orders\/historical-backfill'/);
});

test('updated idempotency assets use the P0 release cache version', () => {
  assert.match(index, /offline-sync\.js\?v=20260912-full-optimization-v1/);
  assert.match(mobileHtml, /mobile\.js\?v=20260912-full-optimization-v1/);
  assert.match(mobileHtml, /offline-sync\.js\?v=20260912-full-optimization-v1/);
  assert.match(mobile, /technician-service-worker\.js\?v=20260912-full-optimization-v1/);
  assert.match(technicianWorker, /jingkang-technician-20260912-full-optimization-v1/);
});

test('release health endpoint reports the complete mobile and daily report release', () => {
  assert.match(home, /20260912-full-optimization-v1/);
});
