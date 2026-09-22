const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
  assert.match(html, /<span class="tech-avatar" style="font-size:18px">007<\/span><span><b>007<\/b><span class="technician-full-name">同名技师<\/span>/);
  assert.match(html, /轮钟 03/);
  assert.match(html, /<b>&lt;008&gt;<\/b>/);
  assert.doesNotMatch(html, /工号 /);
  assert.doesNotMatch(html, /<008>/);
});

test('queue cards label technician codes explicitly and never use queue position as a missing code', () => {
  const { context, elements } = harness(['roomTransferEscape', 'renderTechnicians']);
  context.state.technicians = [technician, { ...technician, id:'t2', code:null }];
  context.renderTechnicians();
  const html = elements.get('#technician-list').innerHTML;
  assert.match(html, /<span class="tech-avatar" style="font-size:18px">007<\/span><span class="technician-name"><b>007<\/b><span class="technician-full-name">同名技师<\/span>/);
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
  assert.match(html, /<b>A001234567890123456789<\/b><span class="technician-full-name">王小明完整姓名展示<\/span>/);
  assert.match(html, /<b>未设置工号<\/b>/);
  assert.match(html, /class="tech-avatar"/);
  assert.match(html, /轮钟 03/);
  assert.match(html, /<em>可派<\/em>/);
  assert.match(html, /<em>服务中<\/em>/);
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
