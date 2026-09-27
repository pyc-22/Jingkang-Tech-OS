const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'mobile.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'mobile.js'), 'utf8');

function response(data) {
  return { ok: true, status: 200, json: async () => data };
}

function setup() {
  const dom = new JSDOM(html, { url: 'https://tech.jkyygl.xyz/mobile.html', runScripts: 'outside-only' });
  const { window } = dom;
  const calls = [];
  const timers = new Map();
  let nextTimer = 1;
  let hidden = false;
  let releaseNotification;
  let notification = { dispatch: null, reservation: null };
  Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
  window.scrollTo = () => {};
  window.setInterval = (callback, ms) => { const id = nextTimer++; timers.set(id, { callback, ms }); return id; };
  window.clearInterval = id => timers.delete(id);
  window.setTimeout = () => 0;
  window.fetch = async url => {
    calls.push(String(url));
    if (url.endsWith('/technician/me')) return response({
      technician: { name: '测试技师', storeName: '测试门店' },
      summary: { todayCompletedCount: 0, todayAmountCents: 0, monthCompletedCount: 0, monthAmountCents: 0 },
      activeSession: null, acceptedSession: null, pendingSession: null, recentSessions: [], reservations: [],
      clockInEligible: true, clockInReason: 'AVAILABLE', clockedIn: true
    });
    if (url.endsWith('/technician/dispatch-notification')) {
      if (releaseNotification) return new Promise(resolve => { releaseNotification = () => resolve(response({ dispatch: null, reservation: null })); });
      return response(notification);
    }
    if (url.includes('/technician/performance')) return response({ range: 'MONTH', amountCents: 0, completedCount: 0, totalMinutes: 0 });
    if (url.includes('/technician/daily-data')) return response({ businessDate: '2026-09-27', summary: {}, services: [] });
    if (url.includes('/technician/commissions/summary')) return response({ commissionCents: 0 });
    return response([]);
  };
  window.localStorage.setItem('chengxin-mobile-access-token', 'TOKEN');
  window.eval(source);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return {
    window, calls, timers, flush,
    setHidden: value => { hidden = value; },
    setNotification: value => { notification = value; },
    holdNextNotification: () => { releaseNotification = true; },
    releaseNotification: () => { if (typeof releaseNotification === 'function') releaseNotification(); releaseNotification = null; },
    close: () => dom.window.close()
  };
}

test('technician polling does not repeatedly load the dashboard or hidden performance data', async t => {
  const app = setup();
  t.after(app.close);
  await app.flush();
  await app.flush();
  assert.equal(app.calls.filter(url => url.endsWith('/technician/me')).length, 1);
  assert.equal(app.calls.filter(url => url.includes('/technician/performance')).length, 0);
  const poll = [...app.timers.values()].find(timer => timer.ms >= 10000 && timer.ms <= 15000);
  assert.ok(poll, 'dispatch notifications should poll every 10-15 seconds');
  await poll.callback();
  await app.flush();
  assert.equal(app.calls.filter(url => url.endsWith('/technician/me')).length, 1);
  app.setHidden(true);
  const before = app.calls.length;
  await poll.callback();
  await app.flush();
  assert.equal(app.calls.length, before);
});

test('technician notification poll is single-flight and timers stop on pagehide', async t => {
  const app = setup();
  t.after(app.close);
  await app.flush();
  await app.flush();
  const poll = [...app.timers.values()].find(timer => timer.ms >= 10000 && timer.ms <= 15000);
  assert.ok(poll);
  app.holdNextNotification();
  const first = poll.callback();
  await app.flush();
  const before = app.calls.length;
  const second = poll.callback();
  assert.equal(app.calls.length, before);
  app.releaseNotification();
  await Promise.all([first, second]);
  app.window.dispatchEvent(new app.window.Event('pagehide'));
  assert.equal(app.timers.size, 0);
});

test('technician dashboard refreshes on return to visible and on dispatch change', async t => {
  const app = setup();
  t.after(app.close);
  await app.flush();
  await app.flush();
  const poll = [...app.timers.values()].find(timer => timer.ms === 12000);
  app.setNotification({ dispatch: { sessionId:'session-1', serviceNameSnapshot:'服务', roomCode:'101', plannedDurationMinutes:60 }, reservation:null });
  await poll.callback();
  assert.equal(app.calls.filter(url => url.endsWith('/technician/me')).length, 2);
  app.setHidden(true);
  app.window.document.dispatchEvent(new app.window.Event('visibilitychange'));
  const before = app.calls.length;
  await poll.callback();
  assert.equal(app.calls.length, before);
  app.setHidden(false);
  app.window.document.dispatchEvent(new app.window.Event('visibilitychange'));
  await app.flush();
  await app.flush();
  assert.equal(app.calls.filter(url => url.endsWith('/technician/me')).length, 3);
});

test('technician service state refresh is 30-second, single-flight and does not reload performance', async t => {
  const app = setup();
  t.after(app.close);
  await app.flush();
  await app.flush();
  const refresh = [...app.timers.values()].find(timer => timer.ms === 30000);
  assert.ok(refresh);
  const now = app.window.Date.now();
  app.window.Date.now = () => now + 30001;
  refresh.callback();
  await app.flush();
  assert.equal(app.calls.filter(url => url.endsWith('/technician/me')).length, 2);
  assert.equal(app.calls.filter(url => url.includes('/technician/performance')).length, 0);
  app.setHidden(true);
  app.window.Date.now = () => now + 60002;
  refresh.callback();
  await app.flush();
  assert.equal(app.calls.filter(url => url.endsWith('/technician/me')).length, 2);
});

test('technician performance requests start when its tab opens, not during dashboard startup', async t => {
  const app = setup();
  t.after(app.close);
  await app.flush();
  await app.flush();
  assert.equal(app.calls.filter(url => url.includes('/technician/performance')).length, 0);
  app.window.document.querySelector('[data-mobile-nav="performance-section"]').click();
  await app.flush();
  await app.flush();
  assert.equal(app.calls.filter(url => url.includes('/technician/performance')).length, 1);
  assert.equal(app.calls.filter(url => url.includes('/technician/daily-data')).length, 1);
});
