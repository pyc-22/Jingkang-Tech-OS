const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../manager-mobile.js'), 'utf8');
function render(rows) {
  const start = source.indexOf('function renderManagerCrossStoreTransactions(');
  const end = source.indexOf('\nasync function loadManagerCrossStoreTransactions', start);
  assert.ok(start >= 0 && end > start);
  const target = { innerHTML: '' };
  const context = { document: { querySelector: () => target }, managerMoney: value => String(value),
    managerCrossStoreLabel: { ORDER: 'Order' }, rows };
  vm.runInNewContext(source.slice(start, end) + '\nrenderManagerCrossStoreTransactions(rows);', context);
  return target.innerHTML;
}

test('manager cross-store renderer produces empty and populated states at runtime', () => {
  assert.match(render([]), /comparison-empty/);
  assert.match(render([{ transactionType: 'ORDER', memberName: 'Fixture', storeName: 'Store',
    amountCents: 100, referenceNo: 'Order-1', storeId: 'fixture' }]), /Fixture/);
});

test('R01: manager member names must be rendered as text', { todo: 'Unfixed HTML output encoding' }, () => {
  const html = render([{ transactionType: 'ORDER', memberName: '<b data-review-marker="1">Fixture</b>',
    storeName: 'Store', amountCents: 100, referenceNo: 'Order-1', storeId: 'fixture' }]);
  assert.doesNotMatch(html, /<b data-review-marker/);
  assert.match(html, /&lt;b/);
});
