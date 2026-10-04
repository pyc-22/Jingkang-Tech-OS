const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const ExpenseUI = require('../expense-ui');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'manager-mobile.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'manager-mobile.html'), 'utf8');
const permissions = ['REPORT_VIEW', 'DAILY_REPORT_VIEW', 'FRONTDESK_SETTLE', 'EXPENSE_STORE_VIEW', 'MANAGER_REWARD_VIEW'];
const stores = [{ id: 'store-a', name: 'Store A' }, { id: 'store-b', name: 'Store B' }];
const rooms = ['IDLE', 'IDLE', 'IDLE', 'IN_SERVICE', 'IN_SERVICE', 'PENDING_PAYMENT', 'CLEANING', 'RESERVED']
  .map((status, index) => ({ roomId: `room-${index}`, roomCode: String(index + 1), status,
    bedCount: 2, occupiedBedCount: status === 'IDLE' ? 0 : 1, availableBedCount: status === 'IDLE' ? 2 : 1, services: [] }));
const live = { businessDate: '2026-10-03', rooms, technicians: [
  { technicianId: 'tech-1', technicianName: 'One', status: 'IN_SERVICE' },
  { technicianId: 'tech-2', technicianName: 'Two', status: 'IN_SERVICE' },
  { technicianId: 'tech-3', technicianName: 'Three', status: 'PENDING_ACCEPTANCE' },
  { technicianId: 'tech-4', technicianName: 'Four', status: 'IDLE' }
] };
const emptySummary = { effectiveAmountCents: 0, pendingCount: 0, approvedCount: 0, paidCount: 0 };
const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, options = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/manager-mobile.html' });
  t.after(() => dom.window.close());
  const w = dom.window, requests = [], scrolled = [];
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.id); };
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.setInterval = () => 0;
  w.ExpenseUI = ExpenseUI;
  w.fetch = async (input, init = {}) => {
    const url = new URL(input, 'http://localhost');
    const request = { url, ...init };
    requests.push(request);
    let data = [];
    if (url.pathname.endsWith('/admin/auth/session')) data = { roles: ['STORE_MANAGER'], permissions: options.permissions || permissions };
    else if (url.pathname.endsWith('/my-stores')) data = options.stores || stores;
    else if (url.pathname.endsWith('/live-state')) data = options.live || live;
    else if (url.pathname.endsWith('/rooms/beds')) data = options.beds || [];
    else if (url.pathname.endsWith('/operations/daily-report')) data = { businessDate: url.searchParams.get('date') || live.businessDate,
      rechargeAmountCents: 20000, bonusAmountCents: 500, cardOpenCount: 2, salesAmountCents: 99999, serviceAmountCents: 88888 };
    else if (url.pathname.endsWith('/daily-reports')) data = { currentValues: {
      dailySalesCents: url.searchParams.get('date') === '2026-09-01' ? 100 : 142100, dailyCashFlowCents: 140300 } };
    else if (url.pathname.endsWith('/pending-service-sessions')) data = options.pending || [{ id: 'pending-1' }, { id: 'pending-2' }];
    else if (url.pathname.endsWith('/expense-claims/page')) data = {
      items: [], total: url.searchParams.get('size') === '1' ? (options.expenseCount ?? 305) : 0, summary: emptySummary };
    if (options.respond) data = await options.respond(request, data);
    return { ok: true, status: 200, json: async () => data };
  };
  w.eval(source);
  w.managerToday = () => '2026-10-03';
  w.localStorage.setItem('chengxin-manager-mobile-access-token', 'fixture-token');
  if (options.storedStore) w.localStorage.setItem('chengxin-manager-mobile-store-id', options.storedStore);
  await w.loadManagerStores();
  assert.equal(w.document.querySelector('#manager-dashboard').classList.contains('hidden'), false);
  return { w, requests, scrolled, $: selector => w.document.querySelector(selector) };
}

test('home has one topbar, exactly four business cells and no room, technician or dispatch details', async t => {
  const f = await fixture(t);
  assert.equal(f.$('.manager-header'), null);
  assert.equal(f.$('.manager-context'), null);
  assert.equal(f.w.document.querySelectorAll('.manager-topbar').length, 1);
  assert.equal(f.w.document.querySelectorAll('.manager-metrics article').length, 4);
  for (const id of ['manager-live-room-list', 'manager-live-technician-groups', 'manager-open-dispatch']) {
    assert.equal(f.$(`#${id}`).closest('[data-manager-page-panel]').dataset.managerPagePanel, 'rooms');
  }
  assert.equal(f.$('#manager-room-workspace').hidden, true);
  const ids = [...f.w.document.querySelectorAll('[id]')].map(element => element.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('home amounts follow the frontdesk daily report, with recharge and card count preserved', async t => {
  const f = await fixture(t);
  assert.equal(f.$('#metric-sales').textContent, '\u00a51421.00');
  assert.equal(f.$('#metric-service').textContent, '\u00a51403.00');
  assert.equal(f.$('#metric-recharge').textContent, '\u00a5200.00');
  assert.equal(f.$('#metric-card-open-count').textContent, '2');
  assert.match(f.$('#manager-sync-time').textContent, /^\d{2}:\d{2} \u5df2\u540c\u6b65$/);
});

test('home remains on the live business day when the business tab selects a historical date', async t => {
  const f = await fixture(t, { respond: (request, data) => {
    if (request.url.pathname.endsWith('/daily-reports')) data.currentValues.dailyCustomerCount = request.url.searchParams.get('date') === '2026-09-01' ? 7 : 23;
    return data;
  } });
  f.$('#manager-report-date').value = '2026-09-01';
  assert.equal(await f.w.loadManagerDashboard(), true);
  assert.equal(f.$('#manager-report-date').value, '2026-09-01');
  assert.equal(f.$('#manager-service-daily .traffic strong').textContent, '7');
  assert.equal(f.$('#manager-business-page-date').textContent, '2026-09-01 营业日');
  assert.equal(f.$('#metric-sales').textContent, '\u00a51421.00');
  assert.equal(f.$('#manager-business-date').textContent, '2026-10-03');
});

test('business tab has only service counts and payment channels without duplicate home data', async t => {
  const f = await fixture(t);
  f.$('[data-manager-nav="business"]').click();
  assert.deepEqual([...f.w.document.querySelectorAll('[data-manager-page-panel="business"] h2')].map(node => node.textContent), ['客流与钟数', '资金渠道']);
  assert.equal(f.$('.manager-business-metrics'), null);
  assert.equal(f.$('.manager-business-operation'), null);
  assert.equal(f.$('#manager-business-sales'), null);
  assert.equal(f.$('#manager-business-room-idle'), null);
  assert.equal(f.$('#manager-service-section').hidden, false);
  assert.equal(f.$('.manager-business-channels').hidden, false);
  assert.equal(f.$('.manager-metrics').hidden, true);
  assert.equal(await f.w.loadManagerDashboard(), true);
});

test('business day and month toggle preserves all counts and rates across refresh', async t => {
  const f = await fixture(t, { respond: (request, data) => {
    if (request.url.pathname.endsWith('/daily-reports')) return { currentValues: { dailyCustomerCount: 23 }, monthly: { customerCount: 312 }, derived: { dailyServiceClockRate: 27.5, monthlyServiceClockRate: 36.25 } };
    if (request.url.pathname.endsWith('/service-clock-summary')) return { daily: { queueCount: 15, callCount: 6, extensionCount: 4 }, monthly: { queueCount: 180, callCount: 85, extensionCount: 49 } };
    return data;
  } });
  const metrics = id => [...f.$(id).querySelectorAll('strong')].map(node => node.textContent);
  assert.deepEqual(metrics('#manager-service-daily'), ['23', '15', '6', '4', '27.50%']);
  assert.deepEqual(metrics('#manager-service-monthly'), ['312', '180', '85', '49', '36.25%']);
  f.$('[data-business-period="monthly"]').click();
  assert.equal(f.$('[data-business-period-panel="daily"]').hidden, true);
  assert.equal(f.$('[data-business-period-panel="monthly"]').hidden, false);
  assert.equal(f.$('[data-business-period="monthly"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await f.w.loadManagerDashboard(), true);
  assert.equal(f.$('[data-business-period-panel="monthly"]').hidden, false);
  assert.deepEqual(metrics('#manager-service-monthly'), ['312', '180', '85', '49', '36.25%']);
  f.$('[data-business-period="daily"]').click();
  assert.equal(f.$('[data-business-period-panel="daily"]').hidden, false);
  assert.equal(f.$('[data-business-period-panel="monthly"]').hidden, true);
  assert.equal(f.$('[data-business-period="monthly"]').getAttribute('aria-pressed'), 'false');
});

test('compact payment rows retain configured channels, refunds, recharge net and negative net amounts', async t => {
  const f = await fixture(t);
  f.w.renderManagerChannels({
    sales: [{ paymentMethod: 'CASH', amountCents: 20000 }, { paymentMethod: 'WECHAT', amountCents: 10000 }],
    refunds: [{ paymentMethod: 'CASH', amountCents: 3000 }, { paymentMethod: 'WECHAT', amountCents: 15000 }],
    recharges: [{ paymentMethod: 'CASH', amountCents: 5000 }, { paymentMethod: 'WECHAT', amountCents: -1000 }], cashNetCents: 22000
  }, [{ code: 'CASH', name: '现金', active: true }, { code: 'WECHAT', name: '微信支付', active: false },
    { code: 'MEMBER_BALANCE', name: '会员余额', active: true }, { code: 'HIDDEN', name: '无流水停用渠道', active: false },
    { code: 'CUSTOM', name: '<img src=x>', active: true }]);
  const rows = [...f.$('#manager-channel-list').querySelectorAll('.manager-channel-row')];
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.querySelector('.manager-channel-name').textContent), ['现金', '微信支付', '会员余额', '<img src=x>']);
  assert.deepEqual(rows.map(row => row.querySelector('strong').textContent), ['¥220.00', '-¥60.00', '¥0.00', '¥0.00']);
  assert.deepEqual(rows.map(row => row.querySelector('small').textContent), ['退款 ¥30.00', '退款 ¥150.00', '退款 ¥0.00', '退款 ¥0.00']);
  assert.equal(f.$('.manager-channel-cash strong').textContent, '¥220.00');
  assert.equal(f.$('#manager-channel-list img'), null);
  assert.equal(f.$('.manager-channel-track'), null);
});

test('empty business data renders zero counts, rates and channels without losing the date control', async t => {
  const f = await fixture(t);
  f.w.renderManagerServiceStructure(null, null);
  f.w.renderManagerChannels({});
  for (const id of ['manager-service-daily', 'manager-service-monthly']) {
    assert.deepEqual([...f.$(`#${id}`).querySelectorAll('strong')].map(node => node.textContent), ['0', '0', '0', '0', '0.00%']);
  }
  assert.equal(f.$('#manager-channel-list').querySelectorAll('.manager-channel-row').length, 4);
  assert.equal(f.$('.manager-channel-cash strong').textContent, '¥0.00');
  assert.equal(f.$('#manager-report-date').type, 'date');
});

test('live-state drives counts and occupancy includes pending payment and reserved rooms', async t => {
  const f = await fixture(t);
  assert.deepEqual(['room-idle-count', 'room-serving-count', 'room-cleaning-count', 'active-tech-count'].map(id => f.$(`#${id}`).textContent), ['3', '2', '1', '2']);
  assert.equal(f.$('#manager-occupancy-bar').getAttribute('aria-valuenow'), '50');
  assert.equal(f.$('#manager-occupancy-serving').style.width, '37.5%');
  assert.equal(f.$('#manager-occupancy-pending').style.width, '12.5%');
  assert.equal(f.$('#manager-occupancy-cleaning').style.width, '12.5%');
  assert.equal(f.$('#pending-service-count').textContent, '2');
  assert.equal(f.$('#pending-cleaning-count').textContent, '1');
  assert.equal(f.$('#pending-expense-count').textContent, '305');
});

test('all home live and todo entries open the same independent page and return to home', async t => {
  const f = await fixture(t);
  const entries = [...f.w.document.querySelectorAll('[data-manager-page-panel="home"] [data-manager-shortcut="rooms"]')];
  assert.equal(entries.length, 4);
  for (const entry of entries) {
    entry.click();
    assert.equal(f.$('#manager-room-workspace').hidden, false);
    assert.equal(f.$('#manager-tabbar').hidden, true);
    assert.equal(f.$('#manager-topbar').hidden, true);
    assert.equal(f.$('.manager-metrics').hidden, true);
    assert.equal(f.w.document.activeElement.id, 'manager-room-title');
    f.$('#manager-room-workspace [data-manager-shortcut="home"]').click();
    assert.equal(f.$('#manager-room-workspace').hidden, true);
    assert.equal(f.$('.manager-metrics').hidden, false);
    assert.equal(f.$('#manager-tabbar').hidden, false);
  }
});

test('room workspace switches views, folds idle entries and renders structured service detail', async t => {
  const session = { serviceSessionId: 'session-1', serviceNameSnapshot: 'Main', technicianDisplay: '018 · One', clockType: 'QUEUE',
    serviceStatus: 'IN_SERVICE', bedId: 'bed-1', bedName: '1 床', mainDurationMinutes: 60, totalDurationMinutes: 90,
    plannedDurationMinutes: 90, startedAt: '2026-10-03T09:00:00+08:00', expectedEndAt: '2099-10-03T10:30:00+08:00',
    extensions: [{ serviceNameSnapshot: 'Extension', technicianCode: '018', technicianName: 'One', plannedDurationMinutes: 30,
      servicePriceCents: 5000, addedAt: '2026-10-03T10:00:00+08:00' }] };
  const f = await fixture(t, { live: { ...live, rooms: [
    { roomId: 'room-1', roomCode: '1', status: 'IN_SERVICE', bedCount: 2, occupiedBedCount: 1, availableBedCount: 1, services: [session] },
    { roomId: 'room-2', roomCode: '2', status: 'PENDING_PAYMENT', bedCount: 1, occupiedBedCount: 1, availableBedCount: 0,
      services: [{ ...session, serviceSessionId: 'session-2', serviceStatus: 'COMPLETED_UNSETTLED', totalAmountCents: 16900 }] },
    { roomId: 'room-3', roomCode: '3', status: 'IDLE', bedCount: 1, occupiedBedCount: 0, availableBedCount: 1, services: [] }
  ], technicians: [{ technicianId: 'tech-1', technicianCode: '018', technicianName: 'One', status: 'IN_SERVICE', serviceSessionId: 'session-1' },
    { technicianId: 'tech-2', technicianCode: '019', technicianName: 'Two', status: 'IDLE' }] },
    respond: (request, data) => data });
  f.$('.manager-live-entry').click();
  assert.equal(f.$('#manager-live-room-list').querySelectorAll('.manager-live-room').length, 2);
  assert.match(f.$('#manager-live-room-list').textContent, /主项目 60 分钟 · 共 90 分钟/);
  assert.match(f.$('#manager-live-room-list').textContent, /018 · One/);
  assert.match(f.$('#manager-live-room-list').textContent, /Extension/);
  assert.match(f.$('#manager-live-room-list').textContent, /¥50\.00/);
  assert.match(f.$('#manager-live-room-list').textContent, /待结算 ¥169\.00/);
  assert.match(f.$('#manager-live-room-list').textContent, /剩余 \d+:\d{2}/);
  f.$('[data-manager-toggle-idle-rooms]').click();
  assert.equal(f.$('#manager-live-room-list').querySelectorAll('.manager-live-room').length, 3);
  f.$('[data-manager-room-view="technicians"]').click();
  assert.equal(f.$('#manager-room-view-rooms').hidden, true);
  assert.equal(f.$('#manager-room-view-technicians').hidden, false);
  assert.match(f.$('#manager-live-technician-summary').textContent, /空闲 1/);
  assert.equal(f.$('#manager-live-technician-groups').querySelectorAll('.manager-live-technician').length, 1);
  f.$('[data-manager-toggle-idle-technicians]').click();
  assert.equal(f.$('#manager-live-technician-groups').querySelectorAll('.manager-live-technician').length, 2);
  assert.ok(f.$('#manager-live-technician-groups [data-manager-clock-tech="tech-2"]'));
});

test('dispatch selects a free bed for immediate service and leaves reservations on automatic bed allocation', async t => {
  const posted = [];
  const f = await fixture(t, { live: { ...live, rooms: [
    { roomId: 'room-1', roomCode: '1', status: 'PENDING_PAYMENT', bedCount: 2, occupiedBedCount: 1, availableBedCount: 1,
      services: [{ serviceSessionId: 'session-1', bedId: 'bed-1', serviceStatus: 'COMPLETED_UNSETTLED' }] }
  ], technicians: [{ technicianId: 'tech-1', technicianName: 'One', status: 'IDLE' }] },
  beds: [{ id: 'bed-1', roomId: 'room-1', name: '1 床', active: true }, { id: 'bed-2', roomId: 'room-1', name: '2 床', active: true }],
  respond: (request, data) => {
    if (request.url.pathname.endsWith('/foundation/rooms')) return [{ id: 'room-1', code: '1', active: true, bedCount: 2 }];
    if (request.url.pathname.endsWith('/foundation/technicians')) return [{ id: 'tech-1', name: 'One', active: true, queueEnabled: true }];
    if (request.url.pathname.endsWith('/foundation/service-items')) return [{ id: 'item-1', name: 'Main', defaultDurationMinutes: 60, priceCents: 16900 }];
    if (request.method === 'POST') posted.push(request);
    return data;
  } });
  f.$('.manager-live-entry').click();
  f.$('#manager-open-dispatch').click();
  assert.equal(f.$('#manager-clock-dialog').open, true);
  assert.deepEqual([...f.$('#manager-clock-bed').options].map(option => option.value), ['bed-2']);
  f.$('#manager-clock-tech-list [data-manager-clock-tech="tech-1"]').click();
  f.$('#manager-clock-form').dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(posted[0].url.pathname, '/api/v1/service-sessions/clock-in');
  assert.equal(JSON.parse(posted[0].body).bedId, 'bed-2');
  f.$('#manager-open-dispatch').click();
  f.$('#manager-clock-type').value = 'BOOKED_QUEUE';
  f.$('#manager-clock-type').dispatchEvent(new f.w.Event('change'));
  assert.equal(f.$('#manager-clock-bed').disabled, true);
  f.$('#manager-clock-tech-list [data-manager-clock-tech="tech-1"]').click();
  f.$('#manager-clock-form').dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(posted[1].url.pathname, '/api/v1/service-reservations');
  assert.equal('bedId' in JSON.parse(posted[1].body), false);
  f.$('#manager-open-dispatch').click();
  f.$('#manager-clock-close').click();
  assert.equal(f.$('#manager-clock-dialog').open, false);
});

test('zero todos disappear and an empty store has a zero meter without invalid widths', async t => {
  const f = await fixture(t, { live: { ...live, rooms: [], technicians: [] }, pending: [], expenseCount: 0 });
  for (const kind of ['settlement', 'cleaning', 'expense']) assert.equal(f.$(`#manager-todo-${kind}`).hidden, true);
  assert.equal(f.$('#manager-home-todo-status').hidden, false);
  assert.match(f.$('#manager-home-todo-status').textContent, /\u6682\u65e0/);
  assert.equal(f.$('#manager-occupancy-bar').getAttribute('aria-valuenow'), '0');
  for (const kind of ['serving', 'pending', 'cleaning']) assert.equal(f.$(`#manager-occupancy-${kind}`).style.width, '0%');
});

test('empty live-state remains authoritative over foundation rooms and legacy sessions', async t => {
  const f = await fixture(t, { live: { ...live, rooms: [], technicians: [] }, pending: [], expenseCount: 0,
    respond: (request, data) => {
      if (request.url.pathname.endsWith('/foundation/rooms')) return [{ id: 'legacy-room', active: true }];
      if (request.url.pathname.endsWith('/service-sessions')) return [{ id: 'legacy-session' }];
      return data;
    } });
  for (const id of ['room-idle-count', 'room-serving-count', 'room-cleaning-count', 'active-tech-count']) {
    assert.equal(f.$(`#${id}`).textContent, '0');
  }
  assert.equal(f.$('#manager-occupancy-bar').getAttribute('aria-valuenow'), '0');
});

test('four shortcuts reach their tabs and the relocated rewards entry remains reachable', async t => {
  const f = await fixture(t);
  const buttons = [...f.w.document.querySelectorAll('.manager-home-shortcuts button')];
  assert.deepEqual(buttons.map(button => button.dataset.managerShortcut), ['commission', 'expense', 'business', 'more']);
  for (const button of buttons) {
    button.click();
    assert.equal(f.$(`[data-manager-page-panel="${button.dataset.managerShortcut}"]`).hidden, false);
  }
  assert.deepEqual(f.scrolled, ['manager-store-comparison']);
  let rewardsLoads = 0;
  f.w.ManagerRewards = { load: () => rewardsLoads++ };
  f.$('[data-manager-shortcut="rewards"]').click();
  assert.equal(f.$('[data-manager-page-panel="rewards"]').hidden, false);
  assert.equal(rewardsLoads, 1);
});

test('store switch only lists authorized stores and rejects injected choices', async t => {
  const f = await fixture(t, { storedStore: 'unauthorized', stores: [{ id: 'store-a', name: '<img src=x>' }] });
  const select = f.$('#manager-store-select');
  assert.equal(select.options.length, 1);
  assert.equal(select.value, 'store-a');
  assert.equal(select.options[0].textContent, '<img src=x>');
  assert.equal(select.querySelector('img'), null);
  assert.equal(select.disabled, true);
  const count = f.requests.length;
  select.add(new f.w.Option('Injected', 'unauthorized'));
  select.value = 'unauthorized';
  select.dispatchEvent(new f.w.Event('change'));
  await flush();
  assert.equal(select.value, 'store-a');
  assert.equal(select.options.length, 1);
  assert.equal(f.requests.length, count);
});

test('shortcuts and expense requests respect permissions, including the moved rewards entry', async t => {
  const f = await fixture(t, { permissions: ['REPORT_VIEW'] });
  for (const page of ['expense', 'business']) assert.equal(f.$(`.manager-home-shortcuts [data-manager-shortcut="${page}"]`).classList.contains('hidden'), true);
  assert.equal(f.$('.manager-rewards-entry').classList.contains('hidden'), true);
  assert.equal(f.$('#manager-todo-expense').hidden, true);
  assert.equal(f.requests.some(request => request.url.pathname.includes('/expense-claims')), false);
  f.w.switchManagerPage('rewards');
  assert.equal(f.$('.manager-metrics').hidden, false);
});

test('home expenses use full history and total count independently of expense tab filters', async t => {
  const f = await fixture(t);
  const request = f.requests.find(item => item.url.searchParams.get('size') === '1');
  assert.equal(request.url.searchParams.get('from'), '0001-01-01');
  assert.equal(request.url.searchParams.get('status'), 'SUBMITTED');
  assert.equal(request.headers['X-Store-Id'], 'store-a');
  assert.ok(f.requests.every(item => item.cache === 'no-store'));
  f.$('#manager-expense-status').value = 'PAID';
  await f.w.loadManagerExpenses();
  assert.equal(f.$('#pending-expense-count').textContent, '305');
  assert.equal(f.$('#manager-expense-pending-count').textContent, '0');
});

test('a delayed response from the previous store does not overwrite new store home state', async t => {
  let delay = false, release;
  const f = await fixture(t, { respond: async (request, data) => {
    if (request.url.searchParams.get('size') !== '1') return data;
    if (request.headers['X-Store-Id'] === 'store-b') return { ...data, total: 7 };
    if (delay) await new Promise(resolve => { release = resolve; });
    return data;
  } });
  delay = true;
  const older = f.w.loadManagerDashboard();
  await flush();
  f.$('#manager-store-select').value = 'store-b';
  f.$('#manager-store-select').dispatchEvent(new f.w.Event('change'));
  await flush();
  assert.equal(f.$('#pending-expense-count').textContent, '7');
  release();
  assert.equal(await older, null);
  assert.equal(f.$('#pending-expense-count').textContent, '7');
  assert.equal(f.$('#manager-store-select').title, 'Store B');
});

test('a delayed older refresh of the same store is also ignored', async t => {
  let delay = false, release;
  const f = await fixture(t, { respond: async (request, data) => {
    if (request.url.searchParams.get('size') === '1' && delay) {
      delay = false;
      await new Promise(resolve => { release = resolve; });
      return { ...data, total: 999 };
    }
    return data;
  } });
  delay = true;
  const older = f.w.loadManagerDashboard();
  await flush();
  await f.w.loadManagerDashboard();
  release();
  assert.equal(await older, null);
  assert.equal(f.$('#pending-expense-count').textContent, '305');
});

test('an unavailable home expense count is reported rather than displayed as zero', async t => {
  const f = await fixture(t, { respond: (request, data) => {
    if (request.url.searchParams.get('size') === '1') throw new Error('offline');
    return data;
  } });
  assert.equal(f.$('#manager-todo-expense').hidden, true);
  assert.equal(f.$('#manager-home-todo-status').hidden, false);
  assert.match(f.$('#manager-home-todo-status').textContent, /\u6682\u672a\u540c\u6b65/);
});

test('both refresh buttons reload live-state and logout hides all operational content', async t => {
  const f = await fixture(t);
  const count = () => f.requests.filter(request => request.url.pathname.endsWith('/live-state')).length;
  assert.equal(count(), 1);
  f.$('#manager-refresh').click();
  await flush();
  assert.equal(count(), 2);
  f.$('.manager-live-entry').click();
  f.$('#manager-room-refresh').click();
  await flush();
  assert.equal(count(), 3);
  f.$('#manager-room-workspace [data-manager-shortcut="home"]').click();
  f.$('#manager-logout').click();
  assert.equal(f.$('#manager-dashboard').classList.contains('hidden'), true);
  assert.equal(f.$('#manager-login-screen').classList.contains('hidden'), false);
  assert.equal(f.w.localStorage.getItem('chengxin-manager-mobile-access-token'), null);
});
