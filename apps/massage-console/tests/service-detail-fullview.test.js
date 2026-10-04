const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const detailFunctions = ['roomTransferEscape', 'money', 'formatRoomCountdown', 'formatExpectedClockTime',
  'renderRooms', 'ensureRoomServiceDetailDialog', 'openRoomServiceDetail', 'renderRoomServiceDetail'];

function declarations(names) {
  return names.map(name => {
    const node = ast.body.find(item => item.id?.name === name || item.declarations?.some(d => d.id.name === name));
    assert.ok(node, `declaration ${name}`);
    return source.slice(node.start, node.end);
  }).join('\n');
}

function service(overrides = {}) {
  return { serviceSessionId: 'session-1', sessionId: 'session-1', bedId: 'bed-1', bedName: '床位 1',
    technicianId: 'tech-1', technicianCode: '18', technicianName: '张师傅', technicianDisplay: '18 · 张师傅',
    serviceNameSnapshot: '轻舒', serviceName: '轻舒', serviceStatus: 'IN_SERVICE', status: 'IN_SERVICE',
    startedAt: '2026-10-03T14:00:00+08:00', expectedEndAt: '2026-10-03T17:15:00+08:00', businessDate: '2026-10-03',
    plannedDurationMinutes: 195, mainDurationMinutes: 60, totalDurationMinutes: 195,
    servicePriceCents: 16900, totalAmountCents: 97300,
    extensions: [
      { id: 'ext-1', serviceNameSnapshot: '项目加钟甲', technicianId: 'tech-1', technicianCode: '18', technicianName: '张师傅',
        plannedDurationMinutes: 60, servicePriceCents: 15900, addedAt: '2026-10-03T14:20:00+08:00' },
      { id: 'ext-2', serviceNameSnapshot: '项目加钟乙', technicianId: 'tech-2', technicianCode: '22', technicianName: '李师傅',
        plannedDurationMinutes: 15, servicePriceCents: 35600, addedAt: '2026-10-03T14:35:00+08:00' },
      { id: 'ext-3', serviceNameSnapshot: '项目加钟丙', technicianId: 'tech-1', technicianCode: '18', technicianName: '张师傅',
        plannedDurationMinutes: 60, servicePriceCents: 28900, addedAt: '2026-10-03T14:50:00+08:00' }
    ], ...overrides };
}

function room(overrides = {}) {
  const item = service();
  return { id: '001', apiId: 'room-1', status: 'serving', label: '服务中',
    detail: '1/1 床已用 · 余 0 床', services: [item], serviceDetails: [item], ...overrides };
}

function page(rooms = [room()]) {
  const dom = new JSDOM('<section id="frontdesk-view"><div id="room-grid"></div></section><b id="idle-room-count"></b><b id="available-room-count"></b>',
    { runScripts: 'outside-only', url: 'http://localhost/' });
  const { window } = dom;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  Object.assign(window, { state: { rooms, technicians: [{ id: 'tech-1', code: '18', name: '张师傅' }], pendingServiceSessions: [] } });
  window.eval(declarations(detailFunctions));
  const route = ast.body.find(node => node.expression?.callee?.property?.name === 'addEventListener'
    && node.expression.callee.object?.arguments?.[0]?.value === '#room-grid');
  assert.ok(route, 'room click route');
  window.eval(source.slice(route.start, route.end));
  window.renderRooms();
  return dom;
}

test('card separates main duration from three extensions and does not add the old total again', () => {
  const dom = page();
  try {
    const card = dom.window.document.querySelector('.room');
    assert.equal(card.querySelector('.room-service-primary').textContent, '轻舒 60′');
    assert.equal(card.querySelector('.room-service-extensions').textContent, '加钟 3 项 · 共 195′');
    assert.equal(card.querySelector('[data-room-service-detail]').textContent, '详情');
    assert.ok(card.querySelector('[data-room-countdown]'));
    assert.ok(card.querySelector('[data-transfer-technician]'));
    assert.ok(card.querySelector('[data-room-status]'));
  } finally { dom.window.close(); }
});

test('details entry works for serving and pending rooms only and does not trigger room status or settlement', () => {
  const dom = page([room(), room({ id: '002', status: 'pending-payment', label: '待结算' }),
    room({ id: '003', status: 'idle', label: '空闲', services: [], serviceDetails: [] }),
    room({ id: '004', status: 'cleaning', label: '清洁中', services: [], serviceDetails: [] })]);
  try {
    const buttons = [...dom.window.document.querySelectorAll('[data-room-service-detail]')];
    assert.deepEqual(buttons.map(button => button.dataset.roomServiceDetail), ['001', '002']);
    buttons[0].click();
    assert.equal(dom.window.document.querySelector('#room-service-detail-dialog').open, true);
    dom.window.document.querySelector('#close-room-service-detail').click();
    buttons[1].click();
    assert.match(dom.window.document.querySelector('#room-service-detail-state').textContent, /待结算/);
    assert.ok(dom.window.document.querySelector('.pending-payment [data-confirm-payment]'));
  } finally { dom.window.close(); }
});

test('detail contains all timeline nodes, snapshots and exact 195 minute / 973 yuan totals', () => {
  const dom = page();
  try {
    dom.window.openRoomServiceDetail('001');
    const dialog = dom.window.document.querySelector('#room-service-detail-dialog');
    assert.match(dialog.textContent, /001 房/);
    assert.match(dialog.textContent, /会员.*未关联会员.*营业日.*2026-10-03.*上钟时间/s);
    assert.equal(dialog.querySelectorAll('.service-detail-timeline li').length, 4);
    assert.equal(dialog.querySelectorAll('.service-detail-item').length, 4);
    assert.deepEqual([...dialog.querySelectorAll('.service-detail-item .service-detail-duration')].map(node => node.textContent),
      ['60 分钟', '60 分钟', '15 分钟', '60 分钟']);
    assert.deepEqual([...dialog.querySelectorAll('.service-detail-item .service-detail-price')].map(node => node.textContent),
      ['¥169.00', '¥159.00', '¥356.00', '¥289.00']);
    assert.match(dialog.textContent, /22 · 李师傅/);
    const formatter = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    for (const item of service().extensions) assert.ok(dialog.textContent.includes(formatter.format(new Date(item.addedAt))));
    assert.match(dialog.querySelector('.service-detail-footer').textContent, /195 分钟（3 小时 15 分）/);
    assert.match(dialog.querySelector('.service-detail-footer').textContent, /¥973\.00/);
  } finally { dom.window.close(); }
});

test('a zero-extension service shows its main project once without a bogus extension row', () => {
  const item = service({ plannedDurationMinutes: 60, mainDurationMinutes: 60, totalDurationMinutes: 60,
    totalAmountCents: 16900, extensions: [] });
  const dom = page([room({ services: [item], serviceDetails: [item] })]);
  try {
    assert.equal(dom.window.document.querySelector('.room-service-extensions'), null);
    dom.window.openRoomServiceDetail('001');
    const dialog = dom.window.document.querySelector('#room-service-detail-dialog');
    assert.equal(dialog.querySelectorAll('.service-detail-item').length, 1);
    assert.equal(dialog.querySelectorAll('.service-detail-timeline li').length, 1);
    assert.match(dialog.querySelector('.service-detail-footer').textContent, /60 分钟（1 小时）.*¥169\.00/);
  } finally { dom.window.close(); }
});

test('two beds render two service groups and participants do not duplicate extension or footer totals', () => {
  const first = service();
  const second = service({ serviceSessionId: 'session-2', sessionId: 'session-2', bedId: 'bed-2', bedName: '床位 2',
    serviceStatus: 'COMPLETED_UNSETTLED', status: 'COMPLETED_UNSETTLED', mainDurationMinutes: 60,
    totalDurationMinutes: 60, plannedDurationMinutes: 60, servicePriceCents: 15900, totalAmountCents: 15900, extensions: [] });
  const dom = page([room({ services: [first, { ...first, technicianId: 'tech-2' }, second], serviceDetails: [first, second] })]);
  try {
    assert.equal(dom.window.document.querySelectorAll('.room-service-row').length, 3);
    dom.window.openRoomServiceDetail('001');
    const dialog = dom.window.document.querySelector('#room-service-detail-dialog');
    assert.equal(dialog.querySelectorAll('.service-detail-session').length, 2);
    assert.equal(dialog.querySelectorAll('.service-detail-item').length, 5);
    assert.match(dialog.textContent, /床位 1/);
    assert.match(dialog.textContent, /床位 2.*待结算/s);
    assert.match(dialog.querySelector('.service-detail-footer').textContent, /255 分钟（4 小时 15 分）.*¥1132\.00/);
  } finally { dom.window.close(); }
});

test('legacy summary still displays without fabricating extension snapshots', () => {
  const item = service({ mainDurationMinutes: undefined, totalDurationMinutes: undefined,
    extensions: undefined, extensionSummary: '轻舒 60分钟、深舒 15分钟' });
  const dom = page([room({ services: [item], serviceDetails: [item] })]);
  try {
    assert.match(dom.window.document.querySelector('.room-service-extensions').textContent, /轻舒 60分钟、深舒 15分钟/);
    assert.doesNotMatch(dom.window.document.querySelector('.room-service-primary').textContent, /195′/);
  } finally { dom.window.close(); }
});

test('mixed bed states retain pending acceptance and reassignment labels instead of claiming service has started', () => {
  const waiting = service({ serviceSessionId: 'session-2', bedName: '床位 2', serviceStatus: 'PENDING_ACCEPTANCE' });
  const reassignment = service({ serviceSessionId: 'session-3', bedName: '床位 3', serviceStatus: 'REASSIGNMENT_REQUIRED' });
  const dom = page([room({ serviceDetails: [service(), waiting, reassignment] })]);
  try {
    dom.window.openRoomServiceDetail('001');
    assert.deepEqual([...dom.window.document.querySelectorAll('.service-detail-bed')].map(node => node.textContent),
      ['床位 1 · 服务中', '床位 2 · 待接单', '床位 3 · 待重新派单']);
  } finally { dom.window.close(); }
});

test('dialog close, backdrop and periodic state refresh keep details scoped to the current room', () => {
  const dom = page();
  try {
    const { window } = dom;
    window.openRoomServiceDetail('001');
    const dialog = window.document.querySelector('#room-service-detail-dialog');
    dialog.getBoundingClientRect = () => ({ left: 10, right: 300, top: 10, bottom: 400 });
    dialog.dispatchEvent(new window.MouseEvent('click', { clientX: 15, clientY: 15, bubbles: true }));
    assert.equal(dialog.open, true);
    dialog.dispatchEvent(new window.MouseEvent('click', { clientX: 0, clientY: 0, bubbles: true }));
    assert.equal(dialog.open, false);
    window.openRoomServiceDetail('001');
    window.document.querySelector('#close-room-service-detail').click();
    assert.equal(dialog.open, false);
    window.openRoomServiceDetail('001');
    window.state.rooms[0].serviceDetails[0] = service({ totalDurationMinutes: 210 });
    window.renderRooms();
    assert.match(dialog.querySelector('.service-detail-footer').textContent, /210 分钟/);
    window.state.rooms = [];
    window.renderRooms();
    assert.equal(dialog.open, false);
  } finally { dom.window.close(); }
});

test('service and extension names, technicians and member metadata remain escaped text', () => {
  const attack = '<img src=x onerror="window.injected=1"><script>window.injected=2</script>&';
  const item = service({ serviceName: attack, serviceNameSnapshot: attack, technicianDisplay: attack,
    memberName: attack, extensions: service().extensions.map(extension => ({ ...extension, serviceNameSnapshot: attack,
      technicianName: attack, technicianCode: attack })) });
  const dom = page([room({ services: [item], serviceDetails: [item] })]);
  try {
    dom.window.openRoomServiceDetail('001');
    assert.equal(dom.window.document.querySelectorAll('img,script,[onerror],iframe').length, 0);
    assert.equal(dom.window.injected, undefined);
    assert.ok(dom.window.document.querySelector('#room-service-detail-dialog').textContent.includes(attack));
  } finally { dom.window.close(); }
});

test('live-state mapping preserves per-session structured details and expands participants only for board rows', async () => {
  const dom = page([]);
  try {
    const { window } = dom;
    const item = service({ roomId: 'room-1', activeParticipantTechnicianIds: 'tech-1,tech-2' });
    Object.defineProperty(window.document, 'hidden', { value: true });
    window.localStorage.setItem('token', 'fixture');
    window.localStorage.setItem('store', 'store-1');
    const noOp = () => {};
    Object.assign(window, { adminTokenKey: 'token', currentStoreKey: 'store', frontdeskLoginRequired: false,
      foundationRequestSequence: 1, extensionSyncInitialized: false, extensionSyncSnapshot: new Map(),
      completedSessionsForDay: { key: null }, frontdeskPendingPanelsEnabled: false,
      technicianScheduleReasonLabel: {}, storeContextHeaders: () => ({ 'X-Store-Id': 'store-1' }),
      updateOperationalSyncStatus: noOp, applyTechnicianClockCounts: noOp, renderTechnicians: noOp,
      renderOrder: noOp, safeRender: (name, render) => render(),
      fetch: async url => ({ ok: true, json: async () => {
        if (url.endsWith('/live-state')) return { businessDate: '2026-10-03', technicians: [], rooms: [
          { roomId: 'room-1', status: 'IN_SERVICE', bedCount: 2, occupiedBedCount: 1, availableBedCount: 1, services: [item] }] };
        if (url.endsWith('/foundation/rooms')) return [{ id: 'room-1', code: '001', bedCount: 2 }];
        if (url.endsWith('/foundation/technicians')) return [{ id: 'tech-1', code: '18', name: '张师傅' }, { id: 'tech-2', code: '22', name: '李师傅' }];
        if (url.endsWith('/clock-eligibility') || url.endsWith('/technician-queue')) return { technicians: [] };
        return [];
      } }) });
    window.eval(declarations(['sessionParticipantIds', 'loadFoundationDataOnce']));
    assert.equal(await window.loadFoundationDataOnce({ requestSequence: 1 }, 'store-1'), true);
    assert.equal(window.state.rooms[0].serviceDetails.length, 1);
    assert.equal(window.state.rooms[0].services.length, 2);
    for (const row of window.state.rooms[0].services) {
      assert.equal(row.extensions.length, 3);
      assert.equal(row.mainDurationMinutes, 60);
      assert.equal(row.totalDurationMinutes, 195);
    }
    window.openRoomServiceDetail('001');
    assert.equal(window.document.querySelectorAll('.service-detail-item').length, 4);
    assert.match(window.document.querySelector('.service-detail-footer').textContent, /¥973\.00/);
  } finally { dom.window.close(); }
});

test('detail layout is scoped, wraps long text and has accessible 44px buttons', () => {
  assert.match(css, /#frontdesk-view \.room-service-row \.room-service-primary\s*\{[^}]*font-size:14px;[^}]*white-space:normal/s);
  assert.match(css, /#frontdesk-view \.room-service-row \.room-service-extensions\s*\{[^}]*color:#ffe49a;[^}]*font-size:14px;[^}]*white-space:normal/s);
  assert.match(css, /#frontdesk-view \.room-detail-button\s*\{[^}]*min-width:44px;[^}]*min-height:44px;/s);
  assert.match(css, /#room-service-detail-dialog[^}]*width:min\(560px,calc\(100vw - 32px\)\)/s);
  assert.match(css, /#room-service-detail-dialog \.service-detail-item[^}]*minmax\(0,1fr\)/s);
  assert.match(css, /#room-service-detail-dialog[^}]*overflow-wrap:anywhere/s);
});
