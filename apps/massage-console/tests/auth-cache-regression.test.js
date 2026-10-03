const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..', '..', '..');
const consoleRoot = path.join(root, 'apps', 'massage-console');
const app = fs.readFileSync(path.join(consoleRoot, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(consoleRoot, 'index.html'), 'utf8');
const managerHtml = fs.readFileSync(path.join(consoleRoot, 'manager-mobile.html'), 'utf8');

function response(body, status = 200, headers = { 'Content-Type': 'application/json' }) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

async function loadConsole({ html = index, token = null, fetchImpl = async () => response([]) } = {}) {
  const errors = [];
  const warnings = [];
  const requests = [];
  const intervals = [];
  const clearedIntervals = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(`jsdom: ${error.message}`));
  virtualConsole.on('error', (...args) => errors.push(`error: ${args.join(' ')}`));
  virtualConsole.on('warn', (...args) => warnings.push(`warn: ${args.join(' ')}`));
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole });
  const { window } = dom;
  window.addEventListener('error', event => errors.push(`window: ${event.message}`));
  window.addEventListener('unhandledrejection', event => errors.push(`rejection: ${event.reason}`));
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function close() { this.open = false; };
  let promptCount = 0;
  const originalShowModal = window.HTMLDialogElement.prototype.showModal;
  window.HTMLDialogElement.prototype.showModal = function showModalWithCount() {
    if (this.id === 'admin-login-dialog') promptCount += 1;
    originalShowModal.call(this);
  };
  let visibility = 'visible';
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => visibility !== 'visible' });
  window.setInterval = (callback, delay) => { const id = intervals.length + 1; intervals.push({ id, callback, delay }); return id; };
  window.clearInterval = id => clearedIntervals.push(id);
  if (token) window.localStorage.setItem('chengxin-admin-access-token', token);
  window.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), headers: Object.fromEntries(new window.Headers(init.headers || {}).entries()) });
    return fetchImpl(url, init, window);
  };
  window.eval(app);
  await new Promise(resolve => window.setTimeout(resolve, 60));
  return { dom, window, errors, warnings, requests, intervals, clearedIntervals,
    setVisibility(value) { visibility = value; window.document.dispatchEvent(new window.Event('visibilitychange')); },
    get promptCount() { return promptCount; } };
}

function frontdeskResponse(url) {
  const value = String(url);
  if (value.endsWith('/admin/auth/session')) return response({ displayName: '前台', roles: ['FRONTDESK'], permissions: [] });
  if (value.includes('/admin/access/my-stores')) return response([{ id: 'store-1', name: '门店', active: true }]);
  if (value.includes('/technician-queue') && !value.includes('/events')) return response({ businessDate: '2026-09-27', technicians: [] });
  if (value.includes('/clock-eligibility')) return response({ technicians: [] });
  if (value.includes('/foundation/rooms')) return response([{ id: 'room-1', code: '201', bedCount: 1 }]);
  if (value.includes('/foundation/technicians')) return response([{ id: 'tech-1', code: '01', name: '张三', queueOrder: 1 }]);
  return response([]);
}

test('fresh entry opens the login dialog before any protected request', async () => {
  const fixture = await loadConsole();
  try {
    const dialog = fixture.window.document.querySelector('#admin-login-dialog');
    assert.ok(dialog);
    assert.equal(dialog.open, true);
    assert.equal(fixture.window.document.body.classList.contains('frontdesk-auth-locked'), true);
    assert.deepEqual(fixture.requests, []);
    assert.deepEqual(fixture.errors, []);
  } finally {
    fixture.dom.window.close();
  }
});

test('old entry without the new idle counter keeps auth startup alive', async () => {
  const oldEntry = index.replace('<span id="idle-room-count">0</span>', '');
  const fixture = await loadConsole({ html: oldEntry });
  try {
    assert.equal(fixture.window.document.querySelector('#admin-login-dialog').open, true);
    assert.equal(fixture.window.document.body.classList.contains('frontdesk-auth-locked'), true);
    assert.equal(typeof fixture.window.renderRooms, 'function');
    fixture.window.renderRooms();
    assert.deepEqual(fixture.errors, []);
  } finally {
    fixture.dom.window.close();
  }
});

test('a foundation 401 clears the session and shows one login prompt without a retry loop', async () => {
  const fixture = await loadConsole({
    token: 'expired-token',
    fetchImpl: async (url, _init, window) => {
      const value = String(url);
      if (value.endsWith('/admin/auth/session')) return response({ displayName: '前台', roles: ['FRONTDESK'], permissions: [] });
      if (value.includes('/admin/access/my-stores')) return response([{ id: 'store-1', name: '门店', active: true }]);
      if (value.includes('/foundation/technicians')) return response('', 401, { 'Content-Type': 'text/plain' });
      return response([]);
    }
  });
  try {
    const dialog = fixture.window.document.querySelector('#admin-login-dialog');
    const foundationRequest = fixture.requests.find(item => item.url.includes('/foundation/technicians'));
    assert.ok(foundationRequest);
    assert.equal(foundationRequest.headers.authorization, 'Bearer expired-token');
    assert.equal(foundationRequest.headers['x-store-id'], 'store-1');
    assert.equal(dialog.open, true);
    assert.equal(fixture.window.document.body.classList.contains('frontdesk-auth-locked'), true);
    assert.equal(fixture.window.localStorage.getItem('chengxin-admin-access-token'), null);
    assert.equal(fixture.promptCount, 1);
    const requestCount = fixture.requests.length;
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(fixture.requests.length, requestCount);
    assert.deepEqual(fixture.errors, []);
  } finally {
    fixture.dom.window.close();
  }
});

test('frontdesk renders before daily completed counts and never requests all service sessions', async () => {
  let finishCounts;
  const counts = new Promise(resolve => { finishCounts = resolve; });
  const fixture = await loadConsole({ token: 'valid-token', fetchImpl: url => String(url).includes('status=COMPLETED&businessDate=') ? counts : frontdeskResponse(url) });
  try {
    assert.ok(fixture.window.document.querySelector('[data-room="201"]'));
    assert.ok(fixture.requests.some(item => item.url.includes('status=COMPLETED&businessDate=2026-09-27')));
    assert.equal(fixture.requests.some(item => /\/service-sessions$/.test(item.url)), false);
    finishCounts(response([{ status: 'COMPLETED', businessDate: '2026-09-27', clockType: 'QUEUE', technicianId: 'tech-1' }]));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.match(fixture.window.document.querySelector('[data-tech-card="tech-1"]').textContent, /排钟 1/);
    assert.deepEqual(fixture.errors, []);
  } finally { fixture.dom.window.close(); }
});

test('frontdesk polling is 30 seconds, shares in-flight load, pauses while hidden and cleans up', async () => {
  let finishRooms;
  const rooms = new Promise(resolve => { finishRooms = resolve; });
  const fixture = await loadConsole({ token: 'valid-token', fetchImpl: url => String(url).includes('/foundation/rooms') ? rooms : frontdeskResponse(url) });
  try {
    const poll = fixture.intervals.find(item => item.delay === 30000);
    assert.ok(poll);
    poll.callback();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fixture.requests.filter(item => item.url.includes('/foundation/rooms')).length, 1);
    fixture.setVisibility('hidden');
    poll.callback();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fixture.requests.filter(item => item.url.includes('/foundation/rooms')).length, 1);
    finishRooms(frontdeskResponse('/foundation/rooms'));
    await new Promise(resolve => setTimeout(resolve, 40));
    fixture.setVisibility('visible');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(fixture.requests.filter(item => item.url.includes('/foundation/rooms')).length, 2);
    fixture.window.dispatchEvent(new fixture.window.Event('pagehide'));
    assert.ok(fixture.intervals.every(item => fixture.clearedIntervals.includes(item.id)));
  } finally { fixture.dom.window.close(); }
});

test('entry versions changed assets independently and keeps the new room node', () => {
  const appVersion = index.match(/app\.js\?v=([^"']+)/)?.[1];
  const cssVersion = index.match(/styles\.css\?v=([^"']+)/)?.[1];
  assert.ok(appVersion);
  assert.equal(appVersion, '20261002-yue-backfill-v1');
  assert.equal(cssVersion, '20261002-yue-backfill-v1');
  assert.ok(index.includes('expense-ui.js?v=20261002-yue-backfill-v1'));
  assert.ok(managerHtml.includes('expense-ui.js?v=20261002-yue-backfill-v1'));
  assert.ok(managerHtml.includes('manager-mobile.js?v=20261002-yue-backfill-v1'));
  assert.match(index, /id="idle-room-count"/);
  assert.match(app, /if \(idleCount\) idleCount\.textContent/);
  assert.match(app, /if \(availableCount\) availableCount\.textContent/);
});

let staticChild;
let staticBase;

test.before(async () => {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  staticBase = `http://127.0.0.1:${port}`;
  staticChild = spawn(process.execPath, [path.join(root, 'server.massage.js')], {
    cwd: root,
    env: { ...process.env, MASSAGE_ADDRESS: '127.0.0.1', MASSAGE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Static server startup timed out')), 10000);
    staticChild.once('error', error => { clearTimeout(timer); reject(error); });
    staticChild.once('exit', code => { clearTimeout(timer); reject(new Error(`Static server exited: ${code}`)); });
    staticChild.stdout.on('data', data => {
      if (data.toString().includes('Massage console:')) { clearTimeout(timer); resolve(); }
    });
  });
});

test.after(async () => {
  if (staticChild && staticChild.exitCode === null) {
    const exited = once(staticChild, 'exit');
    staticChild.kill();
    await exited;
  }
});

test('static server sends entry no-cache, versioned asset long-cache, validators and 304', async () => {
  const entry = await fetch(`${staticBase}/`);
  assert.equal(entry.status, 200);
  assert.equal(entry.headers.get('cache-control'), 'no-cache, no-store, must-revalidate');
  assert.ok(entry.headers.get('etag'));
  assert.ok(entry.headers.get('last-modified'));

  const asset = await fetch(`${staticBase}/app.js?v=20261002-yue-backfill-v1`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const etag = asset.headers.get('etag');
  const lastModified = asset.headers.get('last-modified');
  assert.ok(etag);
  assert.ok(lastModified);

  const byTag = await fetch(`${staticBase}/app.js?v=20261002-yue-backfill-v1`, { headers: { 'If-None-Match': etag } });
  assert.equal(byTag.status, 304);
  assert.equal(await byTag.text(), '');
  const byDate = await fetch(`${staticBase}/app.js?v=20261002-yue-backfill-v1`, { headers: { 'If-Modified-Since': lastModified } });
  assert.equal(byDate.status, 304);
  assert.equal(await byDate.text(), '');

  const head = await fetch(`${staticBase}/styles.css?v=20261002-yue-backfill-v1`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('content-length'), String(fs.statSync(path.join(consoleRoot, 'styles.css')).size));
});

test('nginx keeps gzip and the same cache and validator policy', () => {
  const config = fs.readFileSync(path.join(root, 'deploy', 'nginx', 'massage-platform.conf'), 'utf8');
  assert.match(config, /gzip on;/);
  assert.match(config, /gzip_types[^;]*application\/javascript/);
  assert.match(config, /add_header Cache-Control "no-cache, no-store, must-revalidate" always;/);
  assert.match(config, /add_header Cache-Control "public, max-age=31536000, immutable" always;/);
  assert.doesNotMatch(config, /proxy_hide_header\s+(?:ETag|Last-Modified)/i);
});
