const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const names = new Set(['walletOptions', 'loadSettlementWallets', 'createCombinedPaymentEditor',
  'setupMergeSettlementDialog', 'renderMergeMember', 'renderMergePaymentMethods',
  'updateMergeSettlementAllocation', 'openMergeSettlement', 'renderMergeSettlement', 'submitMergeSettlement',
  'roomTransferEscape', 'memberBusinessEscape', 'money']);
const functions = ast.body.filter(node => names.has(node.id?.name)
  || node.type === 'FunctionDeclaration' && node.id.name.startsWith('merge'));
const declarations = ast.body.filter(node => node.type === 'VariableDeclaration'
  && node.declarations.some(item => names.has(item.id.name) || item.id.name.startsWith('merge')));
const methods = [
  { code: 'MEMBER_BALANCE', name: '会员余额', methodKind: 'MEMBER_BALANCE', active: true },
  { code: 'CASH', name: '现金', methodKind: 'CASH', cashCounted: true, active: true },
  { code: 'WECHAT', name: '微信', methodKind: 'EXTERNAL', active: true },
  { code: 'MEITUAN', name: '美团', methodKind: 'EXTERNAL', active: true }
];
const units = [
  { id: 'unit-1', roomCode: '001', bedId: 'bed-1', bedCode: '001-1', serviceNo: 'FW-001',
    serviceItemId: 'item-1', serviceNameSnapshot: '轻舒', extensionSummary: '港式 60分钟、测试 15分钟、仟指 60分钟',
    servicePriceCents: 97300, plannedDurationMinutes: 195, businessDate: '2026-10-03' },
  { id: 'unit-2', roomCode: '002', bedId: 'bed-2', bedCode: '002-1', serviceNo: 'FW-002',
    serviceItemId: 'item-2', serviceNameSnapshot: '港式按摩', servicePriceCents: 15900,
    plannedDurationMinutes: 60, businessDate: '2026-10-03' },
  { id: 'unit-3', roomCode: '007', bedId: 'bed-3', bedCode: '007-1', serviceNo: 'FW-007',
    serviceItemId: 'item-3', serviceNameSnapshot: '仟指', servicePriceCents: 28900,
    plannedDurationMinutes: 60, businessDate: '2026-10-03' }
];
const cards = {
  alice: [{ id: 'card-a', accountName: 'A卡', balanceCents: 100000, isDefault: true },
    { id: 'card-b', accountName: 'B卡', balanceCents: 100000 }],
  bob: [{ id: 'card-c', accountName: 'C卡', balanceCents: 100000, isDefault: true }]
};
const flush = () => new Promise(resolve => setImmediate(resolve));

async function page(t, sessions = units) {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const requests = [], messages = [], searches = [];
  Object.assign(w, { state: { pendingServiceSessions: sessions, members: [
    { id: 'alice', name: '甲会员', phone: '13800000001' }, { id: 'bob', name: '乙会员', phone: '13800000002' }] },
    activePaymentMethods: methods, storePrintSetting: null, storeContextHeaders: () => ({}),
    closeSettlementActions: () => {}, loadPendingServiceSessions: async () => true,
    loadFoundationData: async () => {}, loadSalesOrders: async () => {}, loadDailyReport: async () => {},
    openSettlementMemberSearch: target => searches.push(target), toast: message => messages.push(message),
    responseMessage: async () => '测试响应', fetch: async (url, options = {}) => {
      if (options.method === 'POST') {
        requests.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ id: 'order-1', orderNo: 'SO-001' }) };
      }
      return { ok: true, json: async () => url.includes('/wallets') ? cards[url.match(/members\/([^/]+)/)[1]] : methods };
    } });
  w.eval('var settlementPaymentTarget=null;\n'
    + declarations.map(node => source.slice(node.start, node.end).replace(/^(let|const) /, 'var ')).join('\n')
    + '\n' + functions.map(node => source.slice(node.start, node.end)).join('\n'));
  await w.openMergeSettlement();
  return { w, requests, messages, searches };
}

function toggle(w, index) { w.document.querySelector(`[data-merge-room="${index}"]`).click(); }
function receipt(w, id) {
  const input = w.document.querySelector(`[data-merge-unit-amount="${id}"]`);
  assert.ok(input, `receipt input for selected ${id}`);
  return input;
}
function input(w, element, value) {
  element.value = value;
  element.dispatchEvent(new w.Event('input', { bubbles: true }));
}
function payment(w, method, value, index = 0) {
  input(w, w.document.querySelectorAll(`[data-combined-method="${method}"] [data-combined-amount]`)[index], value);
}
function fill(w, method, index = 0) {
  w.document.querySelectorAll(`[data-combined-method="${method}"] [data-combined-fill]`)[index].click();
}
function totals(w) {
  return ['#merge-original-total', '#merge-adjustment', '#merge-real-total']
    .map(selector => w.document.querySelector(selector)?.textContent);
}
function submit(w) { return w.document.querySelector('#submit-merge-settlement'); }
function verification(w) { return w.document.querySelector('#merge-payment-verification'); }
function selectAll(w) { units.forEach((_, index) => toggle(w, index)); }
function acceptance(w) {
  selectAll(w);
  input(w, receipt(w, 'unit-2'), '150');
  input(w, receipt(w, 'unit-3'), '280');
}
async function confirm(w) {
  w.document.querySelector('#merge-settlement-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}

test('unchecked units never appear in selected details or monetary totals', async t => {
  const { w } = await page(t);
  assert.equal(w.document.querySelectorAll('[data-merge-unit-amount]').length, 0);
  assert.match(w.document.querySelector('#merge-settlement-selected').textContent, /请.*选择|尚未.*勾选/);
  assert.deepEqual(totals(w), ['¥0.00', '¥0.00', '¥0.00']);
  assert.equal(submit(w).disabled, true);
  toggle(w, 1);
  assert.deepEqual([...w.document.querySelectorAll('[data-merge-unit-amount]')].map(item => item.dataset.mergeUnitAmount), ['unit-2']);
  assert.deepEqual(totals(w), ['¥159.00', '¥0.00', '¥159.00']);
});

test('acceptance sums only selected service units including extensions exactly once', async t => {
  const { w } = await page(t);
  acceptance(w);
  assert.deepEqual(totals(w), ['¥1421.00', '¥18.00', '¥1403.00']);
  assert.match(w.document.querySelector('#merge-settlement-selected').textContent, /港式 60分钟/);
  fill(w, 'CASH');
  assert.equal(w.mergePayments()[0].amountCents, 140300);
  assert.equal(submit(w).disabled, false);
});

test('deselect removes the row and amount immediately; reselect restores edited receipts', async t => {
  const { w } = await page(t);
  acceptance(w);
  fill(w, 'CASH');
  toggle(w, 1);
  assert.equal(w.document.querySelector('[data-merge-unit-amount="unit-2"]'), null);
  assert.deepEqual(totals(w), ['¥1262.00', '¥9.00', '¥1253.00']);
  assert.match(verification(w).textContent, /支付多填.*150\.00/);
  assert.equal(submit(w).disabled, true);
  toggle(w, 1);
  assert.equal(Number(receipt(w, 'unit-2').value), 150);
  assert.deepEqual(totals(w), ['¥1421.00', '¥18.00', '¥1403.00']);
  assert.equal(submit(w).disabled, false);
});

test('payment allocation exposes red underpaid, red overpaid and green matching states', async t => {
  const { w } = await page(t);
  acceptance(w);
  payment(w, 'CASH', '1400');
  assert.match(verification(w).textContent, /还少分配.*3\.00/);
  assert.ok(verification(w).classList.contains('bad'));
  assert.equal(submit(w).disabled, true);
  payment(w, 'CASH', '1404');
  assert.match(verification(w).textContent, /支付多填.*1\.00/);
  assert.ok(verification(w).classList.contains('bad'));
  assert.equal(submit(w).disabled, true);
  payment(w, 'CASH', '1403');
  assert.match(verification(w).textContent, /一致/);
  assert.ok(verification(w).classList.contains('ok'));
  assert.equal(submit(w).disabled, false);
});

test('typing receipts updates only the summary and retains input focus and payment DOM', async t => {
  const { w } = await page(t);
  selectAll(w);
  const element = receipt(w, 'unit-2');
  const cardSelect = w.document.querySelector('[data-combined-wallet]');
  element.focus();
  for (const value of ['1', '15', '150', '150.25']) {
    input(w, element, value);
    assert.equal(w.document.activeElement, element);
    assert.equal(receipt(w, 'unit-2'), element);
    assert.equal(w.document.querySelector('[data-combined-wallet]'), cardSelect);
  }
  assert.deepEqual(totals(w), ['¥1421.00', '¥8.75', '¥1412.25']);
});

test('each external fill button uses actual total minus other allocations and is repeatable', async t => {
  const { w } = await page(t);
  acceptance(w);
  payment(w, 'CASH', '100');
  fill(w, 'MEITUAN');
  fill(w, 'MEITUAN');
  assert.deepEqual(JSON.parse(JSON.stringify(w.mergePayments())), [
    { method: 'CASH', walletId: null, amountCents: 10000 },
    { method: 'MEITUAN', walletId: null, amountCents: 130300 }
  ]);
  assert.equal(submit(w).disabled, false);
});

test('cross-member cards and payer selections survive receipt edits and selection changes', async t => {
  const { w, searches, requests } = await page(t);
  acceptance(w);
  w.document.querySelector('[data-combined-payer]').click();
  assert.deepEqual(searches, ['merge-payment']);
  await w.mergePaymentEditor.selectPayer(w.settlementPaymentTarget.row, 'alice');
  payment(w, 'MEMBER_BALANCE', '300');
  w.document.querySelector('[data-combined-add-card]').click();
  await w.mergePaymentEditor.selectPayer(w.mergePaymentEditor.rows[1], 'bob');
  payment(w, 'CASH', '500');
  fill(w, 'MEMBER_BALANCE', 1);
  toggle(w, 1);
  toggle(w, 1);
  assert.deepEqual([...w.document.querySelectorAll('[data-combined-wallet]')].map(select => select.value), ['card-a', 'card-c']);
  input(w, receipt(w, 'unit-3'), '279');
  assert.match(verification(w).textContent, /支付多填.*1\.00/);
  fill(w, 'MEMBER_BALANCE', 1);
  await confirm(w);
  assert.deepEqual(requests[0].payments, [
    { method: 'MEMBER_BALANCE', walletId: 'card-a', amountCents: 30000 },
    { method: 'MEMBER_BALANCE', walletId: 'card-c', amountCents: 60200 },
    { method: 'CASH', walletId: null, amountCents: 50000 }
  ]);
  assert.equal(requests[0].memberId, null);
});

test('real form submits only selected unit IDs with independent receipts and matching header', async t => {
  const { w, requests } = await page(t);
  acceptance(w);
  toggle(w, 1);
  fill(w, 'CASH');
  await confirm(w);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].settlementAmountCents, 125300);
  assert.deepEqual(requests[0].lines.map(line => [line.serviceSessionId, line.settlementAmountCents]),
    [['unit-1', 97300], ['unit-3', 28000]]);
  assert.equal(requests[0].lines[0].durationMinutes, 195);
});

test('multiple sessions on one bed retain independent receipt inputs and POST lines', async t => {
  const { w, requests } = await page(t, [units[1], { ...units[1], id: 'unit-4', serviceNo: 'FW-004', servicePriceCents: 28900 }]);
  toggle(w, 0);
  assert.equal(w.document.querySelectorAll('[data-merge-unit-amount]').length, 2);
  input(w, receipt(w, 'unit-2'), '150');
  input(w, receipt(w, 'unit-4'), '280');
  fill(w, 'CASH');
  await confirm(w);
  assert.deepEqual(requests[0].lines.map(line => line.settlementAmountCents), [15000, 28000]);
});

test('search filtering does not discard selected units or their edited receipts', async t => {
  const { w } = await page(t);
  acceptance(w);
  input(w, w.document.querySelector('#merge-room-search'), '002');
  assert.equal(w.document.querySelectorAll('[data-merge-room]').length, 1);
  assert.equal(w.document.querySelectorAll('[data-merge-unit-amount]').length, 3);
  assert.equal(Number(receipt(w, 'unit-2').value), 150);
  assert.deepEqual(totals(w), ['¥1421.00', '¥18.00', '¥1403.00']);
});

test('other business dates remain unavailable while a selected business date is active', async t => {
  const { w } = await page(t, [units[0], { ...units[1], businessDate: '2026-10-02' }]);
  toggle(w, 0);
  assert.equal(w.document.querySelector('[data-merge-room="1"]').disabled, true);
  toggle(w, 1);
  assert.equal(w.document.querySelectorAll('[data-merge-unit-amount]').length, 1);
});

test('surcharge displays a negative discount and uses increased actual receipts for payment', async t => {
  const { w } = await page(t);
  selectAll(w);
  input(w, receipt(w, 'unit-1'), '983');
  assert.deepEqual(totals(w), ['¥1421.00', '¥-10.00', '¥1431.00']);
  fill(w, 'CASH');
  assert.equal(w.mergePayments()[0].amountCents, 143100);
  assert.equal(submit(w).disabled, false);
});

for (const value of ['', '-1', '150.001', '999999999999999999999']) {
  test(`invalid unit receipt ${JSON.stringify(value)} disables and rejects submission`, async t => {
    const { w, requests, messages } = await page(t);
    acceptance(w);
    input(w, receipt(w, 'unit-2'), value);
    assert.equal(submit(w).disabled, true);
    assert.ok(verification(w).classList.contains('bad'));
    await confirm(w);
    assert.equal(requests.length, 0);
    assert.ok(messages.length > 0);
  });
}

test('individual zero receipts need a reason and pass it with the per-unit snapshot', async t => {
  const { w, requests } = await page(t);
  acceptance(w);
  input(w, receipt(w, 'unit-2'), '0');
  fill(w, 'CASH');
  assert.equal(submit(w).disabled, true);
  assert.equal(w.document.querySelector('#merge-waive-reason-wrap').hidden, false);
  input(w, w.document.querySelector('#merge-waive-reason'), '第二单免单');
  assert.equal(submit(w).disabled, false);
  await confirm(w);
  assert.equal(requests[0].waiveReason, '第二单免单');
  assert.equal(requests[0].lines[1].settlementAmountCents, 0);
});

test('whole-order waiver preserves edited receipts when unchecked and requires a reason', async t => {
  const { w } = await page(t);
  acceptance(w);
  const waive = w.document.querySelector('#merge-settlement-waive');
  waive.checked = true;
  waive.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(w.mergeAmountCents(), 0);
  assert.equal(submit(w).disabled, true);
  input(w, w.document.querySelector('#merge-waive-reason'), '门店免单');
  assert.equal(submit(w).disabled, false);
  waive.checked = false;
  waive.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(Number(receipt(w, 'unit-2').value), 150);
  assert.equal(w.mergeAmountCents(), 140300);
});

test('reopening a checkout resets receipt edits and selections from the previous checkout', async t => {
  const { w } = await page(t);
  acceptance(w);
  await w.openMergeSettlement();
  assert.equal(w.document.querySelectorAll('[data-merge-unit-amount]').length, 0);
  toggle(w, 1);
  assert.equal(Number(receipt(w, 'unit-2').value), 159);
});

test('waiver reason stays visually hidden until a selected unit has zero receipts', async t => {
  const { w } = await page(t);
  const style = w.document.createElement('style');
  style.textContent = fs.readFileSync(path.join(root, 'styles.css'), 'utf8')
    + '\n' + fs.readFileSync(path.join(root, 'frontdesk-card-settlement.css'), 'utf8');
  w.document.head.append(style);
  const reason = w.document.querySelector('#merge-waive-reason-wrap');
  assert.equal(w.getComputedStyle(reason).display, 'none');
  acceptance(w);
  assert.equal(w.getComputedStyle(reason).display, 'none');
  input(w, receipt(w, 'unit-2'), '0');
  assert.notEqual(w.getComputedStyle(reason).display, 'none');
  input(w, receipt(w, 'unit-2'), '150');
  assert.equal(w.getComputedStyle(reason).display, 'none');
});
