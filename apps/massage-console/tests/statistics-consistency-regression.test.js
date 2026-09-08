const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readApi = name => fs.readFileSync(path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main', 'java', 'com', 'chengxin', 'massage', name), 'utf8');
const categories = readApi('catalog/ServiceCategoryController.java');
const operations = readApi('operations/OperationsReportController.java');
const targets = readApi('operations/MonthlyTargetController.java');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'manager-mobile.js'), 'utf8');
const monthly = fs.readFileSync(path.join(root, 'monthly-targets.js'), 'utf8');

test('project analytics subtracts completed refunds at line level', () => {
  assert.match(categories, /sales_refund_line refund_line/);
  assert.match(categories, /refund\.status='COMPLETED'/);
  assert.match(categories, /greatest\(0,line\.line_amount_cents-refund_totals\.refunded_cents\)/);
  assert.match(categories, /greatest\(0,line\.quantity-refund_totals\.refunded_quantity\)/);
});

test('store comparison and completed service totals use net settled revenue', () => {
  assert.match(operations, /report\.netSalesAmountCents\(\), report\.completedServiceCount\(\)/);
  assert.match(operations, /sales\.status='SETTLED' and payment\.payment_method='CASH'/);
  assert.match(operations, /order_line\.line_amount_cents,session\.service_price_cents\+extensions\.extension_cents\)-refund_totals\.refunded_cents/);
  assert.match(operations, /active_order\.status='SETTLED'/);
});

test('monthly target actuals share net order, project, and effective technician rules', () => {
  assert.match(targets, /greatest\(0,sales\.paid_cents-coalesce\(order_refund\.refunded_cents,0\)\)/);
  assert.match(targets, /greatest\(0,line\.line_amount_cents-coalesce\(refund_totals\.refunded_cents,0\)\)/);
  assert.match(targets, /EFFECTIVE_COMMISSION_CTE/);
  assert.match(targets, /from effective_records/);
  assert.match(targets, /record_type IN \('REFUND_REVERSAL','ORDER_VOID_REVERSAL','BUSINESS_CORRECTION_REVERSAL'\)/);
});

test('comparison screens label their primary amount as net revenue', () => {
  assert.match(app, /data-store-comparison-sort="SALES">净营业额/);
  assert.match(app, /<th>净营业额<\/th>/);
  assert.match(manager, /<span>净营业额<\/span>/);
  assert.match(monthly, /净营业额按已结算订单实收减已完成退款统计/);
  assert.match(monthly, /净业绩/);
});
