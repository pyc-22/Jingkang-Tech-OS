const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'manager-mobile.js'), 'utf8');
const managerHtml = fs.readFileSync(path.join(root, 'manager-mobile.html'), 'utf8');
const mobile = fs.readFileSync(path.join(root, 'mobile.js'), 'utf8');

test('management separates effective commission records from adjustments', () => {
  assert.match(index, /有效提成明细/);
  assert.match(index, /commission-adjustment-panel/);
  assert.match(app, /commissions\/adjustments/);
  assert.match(app, /renderOrderCommissionAdjustments/);
  assert.match(index, /只显示退款、作废和改单处理后的最终有效净额/);
});

test('manager and technician mobile pages consume separate adjustment data', () => {
  assert.match(managerHtml, /manager-commission-adjustments/);
  assert.match(manager, /commissions\/adjustments/);
  assert.match(manager, /managerCommissionAdjustmentLabel/);
  assert.match(mobile, /technician\/commissions\/adjustments/);
  assert.match(mobile, /mobile-commission-adjustments/);
});
