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
  const declarations = names.map(name => {
    const node = ast.body.find(n => n.id?.name === name || n.declarations?.some(d => d.id.name === name));
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
