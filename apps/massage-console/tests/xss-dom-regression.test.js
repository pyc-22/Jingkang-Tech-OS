const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');

const attack = '\"><img src=x onerror="window.injected=1"><script>window.injected=2</script><b>name</b>&';
function page(file, names, html, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const ast = acorn.parse(source, { ecmaVersion: 'latest' });
  const scope = file === 'daily-report.js' ? ast.body[0].expression.callee.body.body : ast.body;
  const declarations = names.map(name => {
    const node = scope.find(n => n.id?.name === name || n.declarations?.some(d => d.id.name === name));
    assert.ok(node, name);
    return source.slice(node.start, node.end);
  });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/' });
  Object.assign(dom.window, globals);
  dom.window.eval(declarations.join('\n'));
  return dom;
}
function assertTextOnly(dom) {
  const { document } = dom.window;
  assert.equal(document.querySelectorAll('script,img,[onerror],[onclick],iframe').length, 0);
  assert.equal(dom.window.injected, undefined);
  assert.ok(document.body.textContent.includes(attack));
}

test('R01: manager member, store, trace and attribute payloads remain literal text', () => {
  const dom = page('manager-mobile.js', ['managerEscape','managerMoney','managerCrossStoreLabel',
    'renderManagerCrossStoreTransactions','renderManagerStoreComparison','managerAlertLabel','renderManagerStoreAlerts'],
    '<div id="manager-cross-store-records"></div><div id="manager-store-comparison"></div><div id="manager-alert-subtitle"></div><div id="manager-store-alerts"></div>');
  const row = { memberName: attack, storeName: attack, storeCode: attack, serviceTrace: attack,
    storeId: attack, referenceNo: attack, transactionType:'ORDER', amountCents: 100,
    alertType: attack, alertTitle: attack };
  dom.window.renderManagerCrossStoreTransactions([row]);
  dom.window.renderManagerStoreComparison([row]);
  dom.window.renderManagerStoreAlerts([row]);
  assertTextOnly(dom);
  assert.equal(dom.window.document.querySelector('[data-manager-cross-store]').dataset.managerCrossStore, attack);
  dom.window.close();
});

test('R01: frontdesk employee, technician and payment names are escaped without breaking actions', () => {
  const fixture = { id:'fixture', employeeId:'fixture', assignmentId:'assignment', active:true,
    code:attack, name:attack, phone:attack, note:attack, fullName:attack, positionName:attack, loginName:attack,
    positionType:'CASHIER', employmentStatus:'ACTIVE' };
  const html = ['technician','employee','payment-method'].map(id => `<input id="${id}-search"><span id="${id}-total"></span><table><tbody id="${id}-records"></tbody></table>`).join('');
  const dom = page('app.js', ['roomTransferEscape','employeePositionLabel','employeeStatusLabel',
    'renderManagedTechnicians','renderManagedEmployees','renderManagedPaymentMethods'], html,
    { managedTechnicians:[fixture], managedEmployees:[fixture], managedPaymentMethods:[fixture] });
  dom.window.renderManagedTechnicians();
  dom.window.renderManagedEmployees();
  dom.window.renderManagedPaymentMethods();
  assertTextOnly(dom);
  let selected;
  const button = dom.window.document.querySelector('[data-payment-method-edit]');
  button.addEventListener('click', () => { selected = button.dataset.paymentMethodEdit; });
  button.click();
  assert.equal(selected, 'fixture');
  dom.window.close();
});

test('R01: mobile service and leave renderers escape names, notes and unknown labels', () => {
  const dom = page('mobile.js', ['mobileEscape','mobileMoney','mobileTime','mobileClockTypeLabel','mobileLeaveStatus',
    'renderRecentSessions','renderMobileLeaveRequests'], '<div id="recent-count"></div><div id="session-list"></div><div id="mobile-leave-list"></div>');
  dom.window.renderRecentSessions([{ serviceNameSnapshot:attack, roomCode:attack, clockType:attack,
    extensionSummary:attack, status:attack, startedAt:'2026-09-16T12:00:00Z', plannedDurationMinutes:60 }]);
  dom.window.renderMobileLeaveRequests([{ startDate:'2026-09-16', endDate:'2026-09-17', reason:attack, reviewNote:attack, status:attack }]);
  assertTextOnly(dom);
  dom.window.close();
});

test('R01: frontdesk member attribution and service trace encode all derived text', () => {
  const dom = page('app.js', ['roomTransferEscape','memberRechargeAttribution','memberWalletAttribution','serviceTraceLabel'], '<div id="result"></div>',
    { clockTypeLabels:{}, formatSessionTime:()=>'' });
  const row = { lastRechargeTechnicianName:attack, lastRechargeEmployeeName:attack };
  dom.window.document.querySelector('#result').innerHTML = dom.window.memberRechargeAttribution(row);
  assertTextOnly(dom);
  dom.window.close();
});

test('R01: print preview preserves already escaped ampersands without double encoding', () => {
  const dom = page('app.js', ['receiptEscape','renderPrintPreview'],
    '<form id="print-setting-form"><input name="receiptTitle" value="A &amp; B"><input name="paperWidthMm" value="80"><input name="fontSizePx" value="12"></form><div id="print-receipt-preview"></div>',
    { printContentOptions:()=>({}), defaultPrintContentOptions:{} });
  dom.window.renderPrintPreview();
  assert.equal(dom.window.document.querySelector('h3').textContent, 'A & B');
  dom.window.close();
});

test('R01: daily report names, configurable labels and revision actors remain literal text', async () => {
  const ids = ['daily-report-overview','daily-report-status','daily-report-save-meta','daily-report-month-rate',
    'daily-report-payment-total','daily-report-payment-bars','daily-report-publish','daily-report-settings',
    'daily-report-revisions','daily-settings-month','daily-settings-target','daily-report-settings-fields',
    'daily-report-revisions-summary','daily-report-revisions-list'];
  const html = ids.map(id => `<div id="${id}"></div>`).join('')
    + '<select id="stores"></select><form id="form"></form><table><tbody id="daily-report-monthly-records"></tbody></table><dialog id="daily-report-revisions-dialog"></dialog>';
  const dom = page('daily-report.js', ['dailyReportEscape','cents','percent','statuses','revisionAction','dateTime',
    'renderStores','renderSettings','configFor','serviceMetric','render','revisionSummary','openRevisions'], html,
    { selectableStores:[{id:'store',name:attack}], currentStore:()=>'store', selectedStoreName:()=>attack,
      reportSettings:null, amountFields:[],countFields:[],textFields:[],dateInput:{value:'2026-09-16'},
      configuredMonthlyRows:()=>[['label','count','count']], renderRefundOccurrences:()=>{},
      renderServiceStructure:()=>{}, renderDailyPaymentFields:()=>{}, applyFieldSettings:()=>{},
      reportHeaders:()=>({}), apiBase:'/reports', fetch:async()=>({ok:true,json:async()=>[{revisionNo:1,action:'SAVE',actorName:attack}]}) });
  dom.window.storeInput = dom.window.document.querySelector('#stores');
  dom.window.form = dom.window.document.querySelector('#form');
  dom.window.document.querySelector('dialog').showModal = () => {};
  dom.window.renderStores();
  dom.window.renderSettings({ targetMonth:'2026-09-01', fields:[{sectionCode:'DAILY',fieldCode:'count',fieldLabel:attack,visible:true,sortOrder:1}] });
  const report = {id:'report',version:2,status:'PUBLISHED',businessDate:'2026-09-16',updatedByName:attack,publishedByName:attack};
  const channel = {code:attack,name:attack,active:true,netCents:100};
  dom.window.render({report,access:{},paymentChannels:[channel],monthlyPaymentChannels:[channel]});
  await dom.window.openRevisions();
  assertTextOnly(dom);
  assert.equal(dom.window.document.querySelector('[data-setting-label]').value, attack);
  assert.equal(dom.window.document.querySelector('[data-report-payment-channel]').dataset.reportPaymentChannel, attack);
  dom.window.close();
});

test('R17: daily report save and publish send the last observed version', async () => {
  const requests = [], messages = [];
  const dom = page('daily-report.js', ['save'], '<div></div>', {
    data:{report:{id:'report',version:7}}, payload:()=>({businessDate:'2026-09-16'}),
    apiBase:'/reports',reportHeaders:()=>({}),render:()=>{},toast:message=>messages.push(message),
    fetch:async (url, options) => { requests.push({url,...options}); return {ok:true,json:async()=>({report:{id:'report',version:8}})}; }
  });
  await dom.window.save(true);
  assert.equal(JSON.parse(requests[0].body).version, 7);
  assert.equal(requests[1].url, '/reports/report/publish?version=8');
  requests.length = 0;
  dom.window.fetch = async url => { requests.push(url); return {ok:false,status:409}; };
  await dom.window.save(true);
  assert.equal(requests.length, 1);
  assert.match(messages.at(-1), /刷新/);
  dom.window.close();
});

test('R01: independent ledger renders customer input as text and preserves record identifiers', () => {
  const dom = page('ledger.js', ['money','ledgerEscape','renderRecords'],
    '<input id="record-search"><table><tbody id="ledger-records"></tbody></table><div id="empty-records"></div>',
    {currentFilter:'all',records:[{id:'fixture',type:'order',customer:attack,orderNo:attack,note:attack,at:attack,amount:1}]});
  dom.window.renderRecords();
  assertTextOnly(dom);
  assert.equal(dom.window.document.querySelector('[data-delete]').dataset.delete, 'fixture');
  dom.window.close();
});
