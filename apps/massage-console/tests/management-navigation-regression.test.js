const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const mobileCss = fs.readFileSync(path.join(root, 'manager-mobile.css'), 'utf8');

test('management tabs keep each operational area isolated', () => {
  assert.match(app, /commissions:\s*\[[^\]]*#technician-commission-summary-panel/);
  assert.match(app, /members:\s*\[[^\]]*\.member-recharge-refund-panel/);
  assert.match(app, /commissions:'提成管理'/);
  assert.match(app, /records:'轮钟记录'/);
  assert.match(app, /managementTabDescriptions\s*=\s*\{/);
  assert.match(app, /allManaged\.forEach\(element => \{ element\.hidden = !activeSelectors/);
  assert.match(app, /view\.querySelectorAll\(':scope > section, :scope > \.management-grid'\)/);
  assert.match(app, /pageActions\.hidden = managementActiveTab !== 'overview'/);
  assert.match(css, /\.management-view \[hidden\] \{ display:none !important; \}/);
  assert.match(css, /\.management-tabs \{ position:sticky/);
  assert.match(css, /\.management-view \.ledger-table-wrap \{ overflow-x:auto/);
});

test('order history is explicitly placed before service records', () => {
  assert.match(app, /class="panel admin-table-panel service-record-panel" id="order-history-panel"/);
  assert.match(app, /const orderHistoryPanel = document\.querySelector\('#order-history-panel'\);/);
  assert.match(app, /const servicePanel = document\.querySelector\('#management-view #service-session-record-panel'\);/);
  assert.match(app, /servicePanel\?\.before\(orderHistoryPanel\);/);
  assert.match(app, /orders:\s*\['#order-history-panel', '#service-session-record-panel'/);
  assert.match(app, /document\.querySelector\('#management-view #service-session-record-panel'\)/);
});

test('technician state colors remain distinct and high contrast on both clients', () => {
  for (const state of ['available', 'pending', 'accepted', 'serving', 'reassign', 'off']) {
    assert.match(css, new RegExp(`\.technician-panel \\.tech-card\\.state-${state} \\{`));
    assert.match(css, new RegExp(`\.technician-panel \\.tech-card \\.tech-state\\.${state} \\{`));
  }
  for (const state of ['IDLE', 'IN_SERVICE', 'PENDING_ACCEPTANCE', 'ACCEPTED']) {
    assert.match(mobileCss, new RegExp(`\\.manager-live-technician\\.${state} \\{`));
    assert.match(mobileCss, new RegExp(`\\.manager-technician-status\\.${state} \\{`));
  }
  assert.match(css, /border:1px solid currentColor/);
  assert.match(mobileCss, /border:1px solid currentColor/);
});
