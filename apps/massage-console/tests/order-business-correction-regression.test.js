const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('settled order exposes technician and clock-type correction without changing payment', () => {
  assert.match(app, /data-business-correct-line/);
  assert.match(app, /business-corrections/);
  assert.match(app, /expectedVersion:Number\(detail\.order\.businessCorrectionVersion\|\|0\)/);
  assert.match(app, /订单金额与收款方式保持不变/);
});

test('order detail merges reversal and replacement commission into one correction result', () => {
  assert.match(app, /function renderBusinessCorrections\(corrections\)/);
  assert.match(app, /每次更正已合并原提成冲回与新提成结果/);
  assert.match(app, /oldBaseAmountCents/);
  assert.match(app, /oldCommissionCents/);
  assert.match(app, /newBaseAmountCents/);
  assert.match(app, /newCommissionCents/);
  assert.match(app, /renderBusinessCorrections\(detail\.businessCorrections\)/);
});

test('business correction dialog is scoped and responsive', () => {
  assert.match(app, /id="business-correction-dialog"/);
  assert.match(app, /name="technicianId"/);
  assert.match(app, /name="clockType"/);
  assert.match(css, /\.business-correction-card\s*\{[^}]*width:min\(520px/);
});
