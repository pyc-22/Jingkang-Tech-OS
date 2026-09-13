const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('front desk historical backfill is permission gated and supports the full order form', () => {
  const html = read('index.html');
  const js = read('app.js');
  assert.match(html, /id="historical-backfill-panel"[^>]*data-admin-permission="HISTORICAL_ORDER_CREATE"/);
  for (const id of ['historical-backfill-dialog', 'historical-backfill-form', 'historical-backfill-date', 'historical-backfill-member-search', 'historical-backfill-member-clear', 'historical-backfill-add-line', 'historical-backfill-line-list', 'historical-backfill-amount', 'historical-backfill-add-payment', 'historical-backfill-payment-list']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="frontdesk-historical-backfill-filter-date"/);
  assert.match(html, /id="frontdesk-historical-backfill-filter-operator"/);
  assert.match(js, /\['EXTENSION', '加钟'\]/);
  assert.match(js, /data-historical-technician/);
  assert.match(js, /data-historical-allocation/);
  assert.match(js, /rebalanceHistoricalBackfillTechnicians/);
  assert.match(js, /historicalBackfillPaymentMethods/);
  assert.match(js, /api\/v1\/members\?query=/);
});

test('front desk submits confirmed idempotent backfills and loads store records for detail or refund', () => {
  const js = read('app.js');
  assert.match(js, /sales-orders\/historical-backfill'/);
  assert.match(js, /confirmed:\s*true/);
  assert.match(js, /X-Offline-Operation-Id/);
  assert.match(js, /historicalBackfillOperationId\(\)/);
  assert.match(js, /sales-orders\?historicalBackfill=true&page=0&size=200/);
  assert.match(js, /orderId:row\.id/);
  assert.match(js, /data-historical-order-detail/);
  assert.match(js, /openOrderDetail\(button\.dataset\.historicalOrderDetail\)/);
  assert.match(js, /balanceTotal > Number\(historicalBackfillMember\?\.balanceCents \|\| 0\)/);
  assert.match(js, /Promise\.allSettled\(\[loadFrontdeskHistoricalBackfills\(\), loadSalesOrders/);
  assert.match(js, /部分列表刷新失败，请手动刷新/);
});

test('manager mobile keeps historical backfills read only behind the same permission', () => {
  const html = read('manager-mobile.html');
  const js = read('manager-mobile.js');
  assert.match(html, /id="manager-backfill-section"[^>]*data-manager-permission="HISTORICAL_ORDER_CREATE"/);
  assert.match(html, /id="manager-historical-backfill-list"/);
  assert.match(html, /id="manager-refresh-historical-backfills"/);
  assert.doesNotMatch(html, /id="manager-historical-backfill-dialog"/);
  assert.doesNotMatch(html, /data-manager-shortcut="historical-backfill"/);
  assert.match(js, /sales-orders\/historical-backfills\/mine/);
  assert.match(js, /loadManagerHistoricalBackfills/);
  assert.doesNotMatch(js, /openManagerHistoricalBackfill|managerHistoricalOperationId|managerOperationId/);
  assert.doesNotMatch(js, /X-Offline-Operation-Id|confirmed:true/);
});

test('dispatch keeps per-technician choices independent and blocks reservation clock types in a batch', () => {
  const js = read('app.js');
  assert.match(js, /let dispatchDefaultSelection = null/);
  assert.match(js, /serviceItemId: defaultSelection\.serviceItemId/);
  assert.match(js, /data-tech-service/);
  assert.match(js, /data-tech-clock-type/);
  assert.match(js, /data-tech-duration/);
  assert.match(js, /service-sessions\/clock-in-batch/);
  assert.match(js, /participants\.some\(item => \['BOOKED_QUEUE','BOOKED_CALL'\]\.includes\(item\.clockType\)\)/);
});

test('front desk clock-out confirmation and pending-payment room summary expose required context', () => {
  const html = read('index.html');
  const js = read('app.js');
  assert.match(html, /id="clock-out-confirm-dialog"/);
  assert.match(js, /确认给技师 \$\{technician\.name\}（工号 \$\{technician\.code \|\| '未设置'\}）下钟吗？/);
  assert.match(js, /房间号<b>/);
  assert.match(js, /服务项目<b>/);
  assert.match(js, /已服务时长<b>/);
  assert.match(js, /catch \{\s*toast\('下钟失败，请检查服务连接后重试'\);\s*\} finally/);
  assert.match(js, /room-pending-summary/);
  assert.match(js, /pendingTechnician\?\.code/);
  assert.match(js, /primaryPending\.serviceNameSnapshot/);
});

test('admin historical backfill access page exposes grant, records and export flows', () => {
  const js = read('app.js');
  assert.match(js, /backfill-managers/);
  assert.match(js, /historical-backfills/);
  assert.match(js, /data-backfill-manager-toggle/);
  assert.match(js, /exportHistoricalBackfills/);
  assert.match(js, /historical-backfill-filter-store/);
});
