const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
function functionSource(name) {
  const node = ast.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, name);
  return source.slice(node.start, node.end);
}
function listenerSource(selector, event) {
  const node = ast.body.find(item => item.type === 'ExpressionStatement'
    && item.expression.callee?.property?.name === 'addEventListener'
    && item.expression.arguments[0]?.value === event
    && item.expression.callee.object?.arguments?.[0]?.value === selector);
  assert.ok(node, `${selector} ${event}`);
  return source.slice(node.start, node.end);
}

const methods = [
  { code: 'MEMBER_BALANCE', name: '会员余额', methodKind: 'MEMBER_BALANCE', active: true },
  { code: 'CASH', name: '现金', methodKind: 'CASH', cashCounted: true, active: true },
  { code: 'WECHAT', name: '微信', methodKind: 'EXTERNAL', cashCounted: true, active: true },
  { code: 'ALIPAY', name: '支付宝', methodKind: 'EXTERNAL', cashCounted: true, active: true },
  { code: 'MEITUAN', name: '美团', methodKind: 'EXTERNAL', active: true },
  { code: 'INACTIVE', name: '停用方式', active: false }
];
const cards = {
  alice: [{ id: 'card-a', accountName: 'A卡', accountCode: '8001', balanceCents: 50000, isDefault: true },
    { id: 'card-b', accountName: 'B卡', accountCode: '8002', balanceCents: 36000 }],
  bob: [{ id: 'card-c', accountName: 'C卡', accountCode: '9001', balanceCents: 70000, isDefault: true }]
};
function fixture(memberId = null) {
  const dom = new JSDOM('<dialog id="settlement-dialog"><form><input id="settlement-amount" value="599.00"><input id="settlement-waive" type="checkbox"><div id="settlement-waive-reason-wrap"><textarea id="settlement-waive-reason"></textarea></div><div id="payment-options"></div><b id="settlement-allocated"></b><b id="settlement-remaining"></b><b id="settlement-discount"></b><button class="pay-button"></button></form></dialog>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  const searches = [];
  Object.assign(w, {
    activePaymentMethods: methods, state: { selectedMemberId: memberId, orderItems: [{ price: 599 }], members: [{ id: 'alice', name: '甲' }, { id: 'bob', name: '乙' }] },
    fetch: async url => ({ ok: true, json: async () => cards[url.match(/members\/([^/]+)/)[1]] || [] }),
    storeContextHeaders: () => ({}), memberBusinessEscape: String, roomTransferEscape: String,
    money: value => `¥${value.toFixed(2)}`, openSettlementMemberSearch: target => searches.push(target)
  });
  w.eval('var settlementPaymentEditor; var settlementPaymentTarget=null;'
    + ['walletOptions', 'loadSettlementWallets', 'createCombinedPaymentEditor', 'settlementTotalCents', 'settlementAmountCents', 'settlementIsWaived', 'settlementPayments', 'updateSettlementAllocation', 'renderSettlementPaymentMethods'].map(functionSource).join('\n'));
  w.renderSettlementPaymentMethods({ reset: true });
  const editor = w.eval('settlementPaymentEditor');
  return { dom, w, editor, searches };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function amount(w, method, value, index = 0) {
  const input = w.document.querySelectorAll(`[data-combined-method="${method}"] [data-combined-amount]`)[index];
  input.value = value;
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  return input;
}
const payments = w => JSON.parse(JSON.stringify(w.settlementPayments()));

function correctionFixture(payerTarget = 'correction-payment', existingPayments = [
  { method: 'MEMBER_BALANCE', walletId: 'card-a', payerMemberId: 'alice', amountCents: 20000 },
  { method: 'MEMBER_BALANCE', walletId: 'card-c', payerMemberId: 'bob', amountCents: 40000 }
]) {
  const dom = new JSDOM('<form id="correction-form"><input name="settlementAmount" value="600.00"><div id="correction-payments"></div><b id="correction-allocation"></b></form>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  const searches = [];
  Object.assign(w, {
    activePaymentMethods: methods,
    state: { members: [{ id: 'alice', name: '甲' }, { id: 'bob', name: '乙' }] },
    fetch: async url => ({ ok: true, json: async () => cards[url.match(/members\/([^/]+)/)[1]] || [] }),
    storeContextHeaders: () => ({}), memberBusinessEscape: String, roomTransferEscape: String,
    money: value => `¥${value.toFixed(2)}`, openSettlementMemberSearch: target => searches.push(target)
  });
  w.eval('var settlementPaymentTarget=null;' + ['walletOptions', 'loadSettlementWallets', 'createCombinedPaymentEditor'].map(functionSource).join('\n'));
  const editor = w.createCombinedPaymentEditor(w.document.querySelector('#correction-payments'), {
    amountCents: () => Math.round(Number(w.document.querySelector('[name="settlementAmount"]').value) * 100),
    memberId: () => 'alice', onChange: () => {}, payerTarget
  });
  editor.reset(60000, existingPayments);
  return { dom, w, editor, searches };
}

test('normal settlement lists every active method and pre-fills the first guest-compatible row', () => {
  const { dom, w } = fixture();
  assert.equal(w.document.querySelectorAll('[data-combined-method]').length, 5);
  assert.equal(w.document.querySelector('[data-payment-method]'), null);
  assert.equal(w.document.querySelector('[data-combined-method="MEMBER_BALANCE"] input').disabled, true);
  assert.match(w.document.querySelector('#payment-options').textContent, /需先选择会员/);
  assert.deepEqual(payments(w), [{ method: 'CASH', walletId: null, amountCents: 59900 }]);
  assert.equal(w.document.querySelector('.pay-button').disabled, false);
  dom.window.close();
});

test('financial correction restores split cards and routes payer search through the correction target', async () => {
  const { dom, w, editor, searches } = correctionFixture();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(editor.payments())), [
    { method: 'MEMBER_BALANCE', walletId: 'card-a', amountCents: 20000 },
    { method: 'MEMBER_BALANCE', walletId: 'card-c', amountCents: 40000 }
  ]);
  w.document.querySelectorAll('[data-combined-payer]')[1].click();
  assert.deepEqual(searches, ['correction-payment']);
  assert.equal(w.eval('settlementPaymentTarget').row.walletId, 'card-c');
  dom.window.close();
});

test('merge settlement shares the fixed list and supports a second cross-member card', async () => {
  const { dom, w, editor, searches } = correctionFixture('merge-payment', [
    { method: 'MEMBER_BALANCE', walletId: 'card-a', payerMemberId: 'alice', amountCents: 20000 }
  ]);
  await flush();
  assert.equal(w.document.querySelectorAll('[data-combined-method]').length, 5);
  w.document.querySelector('[data-combined-add-card]').click();
  const second = editor.rows.filter(row => row.method === 'MEMBER_BALANCE').at(-1);
  w.document.querySelectorAll('[data-combined-payer]')[1].click();
  assert.deepEqual(searches, ['merge-payment']);
  await editor.selectPayer(second, 'bob');
  w.document.querySelectorAll('[data-combined-method="MEMBER_BALANCE"] [data-combined-fill]')[1].click();
  assert.deepEqual(JSON.parse(JSON.stringify(editor.payments())), [
    { method: 'MEMBER_BALANCE', walletId: 'card-a', amountCents: 20000 },
    { method: 'MEMBER_BALANCE', walletId: 'card-c', amountCents: 40000 }
  ]);
  dom.window.close();
});

for (const method of ['CASH', 'WECHAT', 'ALIPAY', 'MEITUAN']) {
  test(`normal settlement fills ${method} with one click without a payment-method dropdown`, () => {
    const { dom, w } = fixture();
    w.document.querySelector(`[data-combined-method="${method}"] [data-combined-fill]`).click();
    assert.deepEqual(payments(w), [{ method, walletId: null, amountCents: 59900 }]);
    assert.equal(w.document.querySelector('.pay-button').disabled, false);
    dom.window.close();
  });
}

test('normal settlement subtracts other manually entered amounts when filling the remainder', () => {
  const { dom, w } = fixture();
  amount(w, 'CASH', '100.00');
  amount(w, 'MEITUAN', '274.55');
  w.document.querySelector('[data-combined-method="WECHAT"] [data-combined-fill]').click();
  assert.equal(payments(w).find(row => row.method === 'WECHAT').amountCents, 22445);
  assert.equal(w.document.querySelector('.pay-button').disabled, false);
  amount(w, 'WECHAT', '225');
  assert.equal(w.document.querySelector('.pay-button').disabled, true);
  dom.window.close();
});

test('normal settlement automatically loads the default card and splits two cards without losing amounts', async () => {
  const { dom, w } = fixture('alice');
  assert.equal(w.document.querySelector('.pay-button').disabled, true);
  await flush();
  assert.deepEqual(payments(w), [{ method: 'MEMBER_BALANCE', walletId: 'card-a', amountCents: 59900 }]);
  amount(w, 'MEMBER_BALANCE', '300');
  w.document.querySelector('[data-combined-add-card]').click();
  await flush();
  w.document.querySelectorAll('[data-combined-method="MEMBER_BALANCE"] [data-combined-fill]')[1].click();
  assert.deepEqual(payments(w), [
    { method: 'MEMBER_BALANCE', walletId: 'card-a', amountCents: 30000 },
    { method: 'MEMBER_BALANCE', walletId: 'card-b', amountCents: 29900 }
  ]);
  w.document.querySelectorAll('[data-combined-remove-card]')[1].click();
  assert.equal(payments(w)[0].amountCents, 30000);
  assert.equal(w.document.querySelector('[data-combined-remove-card]'), null);
  dom.window.close();
});

test('normal guest checkout selects a payer inline and sends their actual card without changing the order member', async () => {
  const { dom, w, editor, searches } = fixture();
  w.document.querySelector('[data-combined-payer]').click();
  assert.deepEqual(searches, ['payment']);
  await editor.selectPayer(w.eval('settlementPaymentTarget').row, 'bob');
  w.document.querySelector('[data-combined-method="MEMBER_BALANCE"] [data-combined-fill]').click();
  assert.deepEqual(payments(w), [{ method: 'MEMBER_BALANCE', walletId: 'card-c', amountCents: 59900 }]);
  assert.equal(w.state.selectedMemberId, null);
  dom.window.close();
});

test('normal settlement supports cross-member cards and external payments without wallet IDs on external rows', async () => {
  const { dom, w, editor } = fixture('alice');
  await flush();
  amount(w, 'MEMBER_BALANCE', '200');
  amount(w, 'CASH', '100');
  w.document.querySelector('[data-combined-add-card]').click();
  await flush();
  const select = w.document.querySelectorAll('[data-combined-wallet]')[1];
  select.value = '__other_payer__';
  select.dispatchEvent(new w.Event('change', { bubbles: true }));
  await editor.selectPayer(w.eval('settlementPaymentTarget').row, 'bob');
  w.document.querySelectorAll('[data-combined-method="MEMBER_BALANCE"] [data-combined-fill]')[1].click();
  assert.deepEqual(payments(w), [
    { method: 'MEMBER_BALANCE', walletId: 'card-a', amountCents: 20000 },
    { method: 'MEMBER_BALANCE', walletId: 'card-c', amountCents: 29900 },
    { method: 'CASH', walletId: null, amountCents: 10000 }
  ]);
  assert.equal(w.state.selectedMemberId, 'alice');
  dom.window.close();
});

test('late card responses from a previous checkout do not replace the current payer or amount', async () => {
  const { dom, w, editor } = fixture();
  let finish;
  w.fetch = () => new Promise(resolve => { finish = () => resolve({ ok: true, json: async () => cards.alice }); });
  const oldRow = editor.rows.find(row => row.method === 'MEMBER_BALANCE');
  const pending = editor.selectPayer(oldRow, 'alice');
  editor.reset(10000);
  finish();
  await pending;
  assert.equal(editor.rows.find(row => row.method === 'MEMBER_BALANCE').memberId, null);
  assert.equal(editor.payments()[0].amountCents, 10000);
  dom.window.close();
});

test('normal settlement waiver clears all allocations and restores a one-click default when unchecked', () => {
  const { dom, w } = fixture();
  w.eval(listenerSource('#settlement-waive', 'change'));
  const waive = w.document.querySelector('#settlement-waive');
  waive.checked = true;
  waive.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.deepEqual(payments(w), []);
  assert.equal(w.document.querySelector('.pay-button').disabled, false);
  waive.checked = false;
  waive.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.deepEqual(payments(w), [{ method: 'CASH', walletId: null, amountCents: 59900 }]);
  dom.window.close();
});

test('card-load failure remains inline and can retry without discarding the payment split', async () => {
  const { dom, w, editor } = fixture();
  w.fetch = async () => ({ ok: false, status: 503 });
  const row = editor.rows.find(item => item.method === 'MEMBER_BALANCE');
  await editor.selectPayer(row, 'bob');
  assert.match(w.document.querySelector('#payment-options').textContent, /会员卡加载失败/);
  assert.equal(w.document.querySelector('[data-combined-method="MEMBER_BALANCE"] input').disabled, true);
  w.fetch = async () => ({ ok: true, json: async () => cards.bob });
  await editor.selectPayer(row, 'bob');
  w.document.querySelector('[data-combined-method="MEMBER_BALANCE"] [data-combined-fill]').click();
  assert.deepEqual(payments(w), [{ method: 'MEMBER_BALANCE', walletId: 'card-c', amountCents: 59900 }]);
  dom.window.close();
});

test('normal settlement submits separate wallet rows and a null wallet for cash through the real form handler', async () => {
  const { dom, w, editor } = fixture('alice');
  await flush();
  amount(w, 'MEMBER_BALANCE', '200');
  amount(w, 'CASH', '100');
  w.document.querySelector('[data-combined-add-card]').click();
  await editor.selectPayer(editor.rows[1], 'bob');
  w.document.querySelectorAll('[data-combined-fill]')[1].click();
  let request;
  Object.assign(w, { storePrintSetting: null, orderCorrectionContext: null, toast: () => {}, responseMessage: async () => 'test response',
    fetch: async (url, options) => { request = JSON.parse(options.body); return { ok: false }; } });
  w.eval(listenerSource('#settlement-dialog form', 'submit'));
  w.document.querySelector('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(request.memberId, 'alice');
  assert.deepEqual(request.payments, payments(w));
  assert.deepEqual(request.payments.map(row => row.walletId), ['card-a', 'card-c', null]);
  dom.window.close();
});
