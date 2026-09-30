const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('order detail remains readable after adding more actions', () => {
  assert.match(css, /\.order-detail-card\s*\{[^}]*width:min\(760px,calc\(100vw - 32px\)\)/);
  assert.doesNotMatch(css, /\.order-detail-card\s*\{[^}]*width:510px/);
  assert.match(css, /\.order-detail-actions\s*\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.order-detail-list \.member-result\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(html, /app\.js\?v=20260930-operational-state-v1/);
});

test('order detail opens a read-only full reversal covering every remaining item', () => {
  assert.doesNotMatch(app, /partialSelectionMade/);
  assert.match(app, /const fullAllocations=allocateRefundAmounts\(fullTotal,capacity\.lines\)/);
  assert.match(app, /const selected=available/);
  assert.match(app, /input type="checkbox" \$\{selected\?'checked':''\} disabled/);
  assert.match(app, /type="number"[^>]+readonly/);
  assert.match(app, /整单退款必须覆盖全部剩余可退金额/);
});

test('refund dialog no longer exposes editable row selection controls', () => {
  assert.doesNotMatch(app, /choice\.classList\.toggle\('is-selected',event\.target\.checked\)/);
  assert.doesNotMatch(app, /if\(event\.target\.checked\)amount\.focus\(\)/);
  assert.match(css, /\.refund-line-choice\s*\{\s*cursor:default;\s*\}/);
});

test('refund for re-settlement is distinguished from order void', () => {
  assert.match(app, /订单不会作废，服务回待结算且继续占床/);
  assert.match(app, /已收款订单请先整单退款；订单保留待结算服务/);
});
