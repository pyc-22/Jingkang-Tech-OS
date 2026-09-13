const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('manager historical backfill UI is permission gated and posts a confirmed payload', () => {
  const html = read('manager-mobile.html');
  const js = read('manager-mobile.js');
  assert.match(html, /data-manager-permission="HISTORICAL_ORDER_CREATE"/);
  assert.match(html, /data-manager-shortcut="historical-backfill"/);
  assert.match(html, /id="manager-historical-backfill-dialog"/);
  assert.match(html, /id="manager-historical-backfill-list"/);
  assert.match(html, /id="manager-refresh-historical-backfills"/);
  for (const id of ['manager-backfill-date', 'manager-backfill-room', 'manager-backfill-service', 'manager-backfill-duration', 'manager-backfill-tech-list', 'manager-backfill-payment-method', 'manager-backfill-amount', 'manager-backfill-member']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(js, /sales-orders\/historical-backfill/);
  assert.match(js, /confirmed:true/);
  assert.match(js, /HISTORICAL_ORDER_CREATE/);
  assert.match(js, /X-Offline-Operation-Id/);
  assert.match(js, /managerOperationId/);
  assert.match(js, /window\.confirm\(/);
  assert.match(js, /sales-orders\/historical-backfills\/mine/);
  assert.match(js, /loadManagerHistoricalBackfills/);
});

test('admin historical backfill access page exposes grant, records and export flows', () => {
  const js = read('app.js');
  assert.match(js, /backfill-managers/);
  assert.match(js, /historical-backfills/);
  assert.match(js, /data-backfill-manager-toggle/);
  assert.match(js, /exportHistoricalBackfills/);
  assert.match(js, /historical-backfill-filter-store/);
});
