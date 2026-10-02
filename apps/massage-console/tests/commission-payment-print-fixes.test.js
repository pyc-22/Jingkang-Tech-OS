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

function fixture(html) {
  return new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
}

test('commission summary uses the full API result, not the latest 500 detail rows', async () => {
  const dom = fixture('<input id="commission-record-from" value="2026-09-01"><input id="commission-record-to" value="2026-09-30"><input id="commission-record-search"><div id="commission-records"></div><div id="commission-adjustments"></div><div id="commission-record-count"></div><div id="commission-record-base"></div><div id="commission-record-total"></div><div id="commission-adjustment-count"></div><div id="commission-adjustment-base"></div><div id="commission-adjustment-total"></div><div id="technician-commission-summary-panel"></div><div id="technician-commission-summary-range"></div><table><tbody id="technician-commission-summary-records"></tbody></table>');
  const w = dom.window;
  const requested = [];
  const details = Array.from({ length: 500 }, (_, index) => ({ technicianId: 'tech', technicianNameSnapshot: '小徐', orderNoSnapshot: `O${index}`, baseAmountCents: 100, commissionCents: 10 }));
  Object.assign(w, {
    fetch: async url => {
      requested.push(url);
      const data = url.includes('/summary?') ? [{ technicianId: 'tech', technicianNameSnapshot: '小徐', recordCount: 664, baseAmountCents: 66400, commissionCents: 1177000 }]
        : url.includes('/adjustments?') ? [] : details;
      return { ok: true, json: async () => data };
    },
    storeContextHeaders: () => ({}), money: value => `¥${value.toFixed(2)}`,
    signedMoneyCents: value => `¥${(value / 100).toFixed(2)}`,
    memberBusinessEscape: String, roomTransferEscape: String,
    formatServiceDateTime: String, isCallClockType: () => false,
    clockTypeLabels: {}, toast: message => { throw new Error(message); },
    ensureTechnicianCommissionSummaryPanel: () => {}
  });
  w.eval('let orderCommissionRecords=[]; let orderCommissionAdjustments=[]; let orderCommissionSummaries=[];'
    + ['commissionRuleLabel', 'renderOrderCommissionRecords', 'renderOrderCommissionAdjustments', 'loadOrderCommissionRecords', 'renderTechnicianCommissionSummary'].map(functionSource).join('\n'));
  await w.loadOrderCommissionRecords();
  assert.ok(requested.some(url => url.includes('/commissions/summary?from=2026-09-01&to=2026-09-30')));
  const summary = w.document.querySelector('#technician-commission-summary-records').textContent;
  assert.match(summary, /664/);
  assert.match(summary, /¥11770\.00/);
  assert.match(w.document.querySelector('#commission-records').textContent, /O0/);
  dom.window.close();
});

test('merge settlement uses the shared fixed payment list and card-only split controls', () => {
  assert.match(source, /mergePaymentEditor=createCombinedPaymentEditor/);
  assert.match(source, /payerTarget:'merge-payment'/);
  assert.match(source, /data-combined-add-card/);
  assert.doesNotMatch(source, /data-add-merge-payment/);
  assert.doesNotMatch(source, /syncMergePaymentRows/);
});

test('print bridge skips unconfigured probes and reports browser fallback', async () => {
  const dom = fixture('<div></div>');
  const w = dom.window;
  const calls = [];
  const notices = [];
  w.localStorage.setItem('massage-print-bridge-url', '');
  Object.assign(w, { fetch: async url => { calls.push(url); throw new Error('offline'); }, toast: message => notices.push(message),
    localReceiptTextByOptions: async () => ({ text: 'receipt', setting: { paperWidthMm: 80, fontSizePx: 12, copies: 1 } }),
    printBrowserReceiptByOptions: async () => 'browser' });
  w.eval("const localPrintBridgeKey='massage-print-bridge-url'; let localPrintBridgeOnline=false;"
    + functionSource('refreshLocalPrintBridge') + functionSource('printOrder'));
  assert.equal(await w.refreshLocalPrintBridge(), false);
  assert.equal(calls.length, 0);
  assert.equal(await w.printOrder({}), 'browser');
  assert.equal(calls.length, 0);
  assert.match(notices.join(' '), /浏览器打印/);
  w.localStorage.setItem('massage-print-bridge-url', 'http://127.0.0.1:9180');
  assert.equal(await w.printOrder({}), 'browser');
  assert.ok(calls.includes('http://127.0.0.1:9180/health'));
  assert.match(notices.join(' '), /本地打印组件/);
  dom.window.close();
});

test('configured print bridge sends the receipt without opening browser print', async () => {
  const dom = fixture('<div></div>');
  const w = dom.window;
  const calls = [];
  const notices = [];
  const popup = { close: () => calls.push('close') };
  w.localStorage.setItem('massage-print-bridge-url', 'http://127.0.0.1:9180');
  Object.assign(w, {
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true }; },
    toast: message => notices.push(message),
    localReceiptTextByOptions: async () => ({ text: 'receipt', setting: { paperWidthMm: 80, fontSizePx: 12, copies: 1 } }),
    printBrowserReceiptByOptions: async () => { throw new Error('browser print must not run'); }
  });
  w.eval("const localPrintBridgeKey='massage-print-bridge-url'; let localPrintBridgeOnline=false;"
    + functionSource('refreshLocalPrintBridge') + functionSource('printOrder'));
  await w.printOrder({}, popup);
  assert.deepEqual(calls.map(item => typeof item === 'string' ? item : item.url),
    ['http://127.0.0.1:9180/health', 'http://127.0.0.1:9180/print', 'close']);
  assert.deepEqual(JSON.parse(calls[1].options.body),
    { text: 'receipt', paperWidthMm: 80, fontSizePx: 12, copies: 1 });
  assert.match(notices.join(' '), /已发送到本机打印机/);
  dom.window.close();
});

test('blocked browser print does not report that a print window opened', async () => {
  const dom = fixture('<div></div>');
  const w = dom.window;
  const notices = [];
  Object.assign(w, {
    toast: message => notices.push(message),
    printBrowserReceiptByOptions: async () => { throw new Error('PRINT_WINDOW_BLOCKED'); }
  });
  w.eval("const localPrintBridgeKey='massage-print-bridge-url'; let localPrintBridgeOnline=false;"
    + functionSource('refreshLocalPrintBridge') + functionSource('printOrder'));
  await assert.rejects(w.printOrder({}), /PRINT_WINDOW_BLOCKED/);
  assert.doesNotMatch(notices.join(' '), /已打开浏览器打印窗口/);
  dom.window.close();
});
