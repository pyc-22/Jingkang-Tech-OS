const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function functionSource(name) {
  const start = app.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert.notEqual(start, -1);
  return app.slice(start, app.indexOf('\n}', start) + 2);
}
function harness(names, extras = {}) {
  const elements = new Map();
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, { value:'', innerHTML:'', textContent:'', showModal() {} });
        return elements.get(selector);
      },
      querySelectorAll() { return []; }
    },
    state: { technicians:[], rooms:[], services:[] },
    ...extras
  });
  vm.runInContext(names.map(functionSource).join('\n'), context);
  return { context, elements };
}
const technician = { id:'t1', code:'007', name:'同名技师', initials:'同', queue:3, state:'available', clockedIn:true, detail:'可派钟', queueCount:0, callCount:0, extensionCount:0 };

test('on-duty dispatch choices show employee code separately from queue position and escape it', () => {
  const { context, elements } = harness(['roomTransferEscape', 'openClockDialog'], {
    renderDispatchServiceCatalog() {}, renderDispatchSelection() {}, toast() {}
  });
  context.state.technicians = [technician, { ...technician, id:'t2', code:'<008>', queue:4 }];
  context.state.rooms = [{ id:'101', apiId:'room1', availableBedCount:1, bedCount:1 }];
  context.openClockDialog();
  const html = elements.get('#dispatch-tech-list').innerHTML;
  assert.match(html, /class="tech-avatar"[^>]*>007<\/span><span class="technician-name"><span class="technician-full-name">同名技师<\/span>/);
  assert.match(html, /轮钟 03/);
  assert.match(html, />&lt;008&gt;<\/span>/);
  assert.doesNotMatch(html, /<b>007<\/b>/);
  assert.doesNotMatch(html, /工号 /);
  assert.doesNotMatch(html, /<008>/);
});

test('queue cards label technician codes explicitly and never use queue position as a missing code', () => {
  const { context, elements } = harness(['roomTransferEscape', 'renderTechnicians']);
  context.state.technicians = [technician, { ...technician, id:'t2', code:null }];
  context.renderTechnicians();
  const html = elements.get('#technician-list').innerHTML;
  assert.match(html, /class="tech-avatar"[^>]*>007<\/span><span class="technician-name"><span class="technician-full-name">同名技师<\/span>/);
  assert.doesNotMatch(html, /<b>007<\/b>/);
  assert.doesNotMatch(html, /工号 /);
  assert.match(html, /未设置工号/);
  assert.match(html, /轮排 03/);
});

test('selected dispatch participants show code in both summary and service configuration', () => {
  const { context, elements } = harness(['roomTransferEscape', 'renderDispatchSelection'], {
    dispatchEscape:value => String(value), clockingTechIds:['t1'], dispatchSelections:new Map(), dispatchFocusTechId:null,
    dispatchDefaultSelection:null, renderDispatchServiceCatalog() {}
  });
  context.state.technicians = [technician];
  context.renderDispatchSelection();
  assert.equal(elements.get('#clock-tech-name').textContent, '007 · 同名技师');
  assert.match(elements.get('#dispatch-allocation-list').innerHTML, /<legend>007 · 同名技师<\/legend>/);
});

test('attendance date selection fetches and renders historical clock-in and clock-out records', async () => {
  const requested = [];
  const { context, elements } = harness(['roomTransferEscape', 'formatAttendanceTime', 'renderEmployeeAttendance', 'loadEmployeeAttendance'], {
    employeeAttendance:[], employeePositionLabel:{ TECHNICIAN:'技师' }, attendanceStatusLabel:{ COMPLETED:'已下班' },
    localDateValue:() => '2026-09-16', storeContextHeaders:() => ({ 'X-Store-Id':'store1' }),
    fetch:async (url, options) => {
      requested.push({ url, options });
      return { ok:true, json:async () => [{ employeeId:'e1', employeeName:'同名技师', positionType:'TECHNICIAN', positionName:'技师', status:'COMPLETED', clockInAt:'2026-09-14T10:00:00+08:00', clockOutAt:'2026-09-14T18:00:00+08:00' }] };
    }
  });
  context.document.querySelector('#attendance-date').value = '2026-09-14';
  await context.loadEmployeeAttendance();
  assert.match(requested[0].url, /date=2026-09-14$/);
  assert.equal(requested[0].options.headers['X-Store-Id'], 'store1');
  assert.match(elements.get('#employee-attendance-records').innerHTML, /同名技师/);
  assert.match(elements.get('#employee-attendance-records').innerHTML, /已下班/);
  assert.doesNotMatch(elements.get('#employee-attendance-records').innerHTML, /data-attendance-clock-(in|out)/);
});


test('dispatch choices keep full long codes and names, with an explicit missing-code label', () => {
  const { context, elements } = harness(['roomTransferEscape', 'openClockDialog'], {
    renderDispatchServiceCatalog() {}, renderDispatchSelection() {}, toast() {}
  });
  context.state.technicians = [
    { ...technician, code:'A001234567890123456789', name:'王小明完整姓名展示' },
    { ...technician, id:'t2', code:null, state:'serving' }
  ];
  context.state.rooms = [{ id:'101', apiId:'room1', availableBedCount:1, bedCount:1 }];
  context.openClockDialog();
  const html = elements.get('#dispatch-tech-list').innerHTML;
  assert.match(html, />A001234567890123456789<\/span><span class="technician-name"><span class="technician-full-name">王小明完整姓名展示<\/span>/);
  assert.match(html, />未设置工号<\/small>/);
  assert.match(html, /class="tech-avatar"/);
  assert.match(html, /轮钟 03/);
  assert.match(html, /<em class="dispatch-tech-status">可派钟<\/em>/);
  assert.match(html, /<em class="dispatch-tech-status">服务中<\/em>/);
});

test('compact queue cards preserve actions, status, statistics and useful service context', () => {
  const { context, elements } = harness(['roomTransferEscape', 'renderTechnicians'], { clockTypeLabels:{ QUEUE:'排钟' }, state:{ technicians:[], rooms:[], services:[], activeSessions:[] } });
  context.state.technicians = ['available','pending','accepted','serving','reassign','off'].map((state,index) => ({
    ...technician, id:state, state, queue:index+1, queueCount:2, callCount:3, extensionCount:1,
    detail:state==='available' ? '可立即安排服务' : state==='serving' ? '101 房' : '排班状态说明',
    name:state==='available' ? '<img src=x onerror=alert(1)>' : '同名技师',
    nextReservation:state==='serving' ? { reservationType:'QUEUE',roomCode:'102' } : null
  }));
  context.renderTechnicians();
  const dom = new JSDOM(elements.get('#technician-list').innerHTML);
  try {
    const cards = dom.window.document.querySelectorAll('.tech-card');
    assert.equal(cards.length,6);
    assert.doesNotMatch(dom.window.document.body.textContent,/可立即安排服务/);
    assert.equal(dom.window.document.querySelector('img'),null);
    assert.equal(cards[0].querySelector('.technician-full-name').textContent,'<img src=x onerror=alert(1)>');
    assert.deepEqual([...cards].map(card => card.querySelector('[data-tech]')?.textContent || null),['安排服务','开始服务','开始服务','下钟',null,null]);
    for (const [index,card] of [...cards].entries()) {
      const controls = card.querySelector('.tech-card-controls');
      if (index < 4) {
        assert.equal(controls.children[0].dataset.tech,card.dataset.techCard);
        assert.ok(controls.children[1].classList.contains('tech-state'));
      } else assert.equal(controls.querySelector('[data-tech]'),null);
      assert.match(card.querySelector('.tech-card-meta').textContent,/排钟 2 · 点钟 3 · 加钟 1/);
      assert.match(card.querySelector('.tech-card-meta').textContent,new RegExp('轮排 0'+(index+1)));
      assert.equal(card.querySelector('.technician-name b'),null);
    }
    assert.match(cards[3].textContent,/房间 101/);
    assert.match(cards[3].textContent,/下一单：排钟 · 102房/);
    assert.match(cards[5].textContent,/排班状态说明/);
  } finally { dom.window.close(); }
});

test('clicking a dispatch card still selects and deselects by technician id', () => {
  const { context } = harness([], {
    clockingTechIds:[], dispatchSelections:new Map(), dispatchFocusTechId:null,
    renderDispatchSelection() {}, toast() {}
  });
  context.state.technicians = [technician, { ...technician, id:'t2', state:'serving' }];
  context.document.querySelector('#clock-type').value = 'QUEUE';
  let click;
  context.document.querySelector('#dispatch-tech-list').addEventListener = (type, handler) => { click = handler; };
  const start = app.indexOf("document.querySelector('#dispatch-tech-list').addEventListener('click'");
  vm.runInContext(app.slice(start, app.indexOf('\n});', start) + 4), context);
  const event = id => ({ target:{ closest:() => ({ dataset:{ dispatchTech:id } }) } });
  click(event('t1'));
  assert.equal(context.clockingTechIds.join(','), 't1');
  click(event('t1'));
  assert.equal(context.clockingTechIds.length, 0);
  click(event('t2'));
  assert.equal(context.clockingTechIds.length, 0);
  context.document.querySelector('#clock-type').value = 'BOOKED_QUEUE';
  click(event('t2'));
  assert.equal(context.clockingTechIds.join(','), 't2');
});
