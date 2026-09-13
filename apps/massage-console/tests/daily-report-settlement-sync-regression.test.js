const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const daily = fs.readFileSync(path.join(root, 'daily-report.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'manager-mobile.js'), 'utf8');
const controller = fs.readFileSync(path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main', 'java', 'com', 'chengxin', 'massage', 'operations', 'DailyOperatingReportController.java'), 'utf8');
const service = fs.readFileSync(path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main', 'java', 'com', 'chengxin', 'massage', 'operations', 'DailyReportService.java'), 'utf8');
const operations = fs.readFileSync(path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main', 'java', 'com', 'chengxin', 'massage', 'operations', 'OperationsReportController.java'), 'utf8');

test('saved reports merge manual fields with live front desk settlement values', () => {
  assert.match(controller, /operationalValues\(report\.values\(\), live\)/);
  assert.match(controller, /saved\.dailyTargetCents\(\)[\s\S]*live\.dailySalesCents\(\)/);
  assert.match(controller, /live\.dailyCustomerCount\(\)[\s\S]*saved\.managerCount\(\)/);
});

test('daily report renders configured payment channels and channel refunds dynamically', () => {
  assert.match(controller, /from store_payment_method where store_id=:store/);
  assert.match(controller, /paymentChannels\(storeId, date, date\)/);
  assert.match(controller, /sales\.getOrDefault\(method\.code\(\), 0L\), refunds\.getOrDefault\(method\.code\(\), 0L\)/);
  assert.match(controller, /recharges\.getOrDefault\(method\.code\(\), 0L\), rechargeRefunds\.getOrDefault\(method\.code\(\), 0L\)/);
  assert.match(daily, /reportData\.paymentChannels/);
  assert.match(daily, /reportData\.monthlyPaymentChannels/);
  assert.match(daily, /退款 \$\{cents\(channel\.refundCents\)\}/);
  assert.match(daily, /充值 \$\{cents\(recharge\)\}/);
});

test('daily report form renders configured payment methods in the data entry section', () => {
  assert.match(daily, /id="daily-report-payment-fields"/);
  assert.match(daily, /renderDailyPaymentFields\(reportData\.paymentChannels\)/);
  assert.match(daily, /按订单实际收款渠道自动汇总，金额只读；会员充值按支付方式计入/);
  assert.match(daily, /data-report-payment-field/);
  assert.doesNotMatch(daily, /<label>当日微信/);
  assert.doesNotMatch(daily, /<label>当日支付宝（元）/);
});

test('daily report payment method fields are escaped and read-only', () => {
  assert.match(daily, /dailyReportEscape = value =>/);
  assert.match(daily, /readonly aria-label="当日\$\{name\}"/);
  assert.match(daily, /channel\.salesCents/);
  assert.match(daily, /channel\.refundCents/);
  assert.match(index, /daily-report\.css\?v=20260913-next-optimization-v2/);
});

test('daily customer count exposes an independent correction and restore workflow', () => {
  assert.match(daily, /id="daily-customer-count-edit"/);
  assert.match(daily, /id="daily-customer-count-reset"/);
  assert.match(daily, /customer-count-override/);
  assert.match(daily, /实际客流（人）/);
  assert.match(daily, /修改原因/);
  assert.match(controller, /PutMapping\("\/customer-count-override"\)/);
  assert.match(controller, /DeleteMapping\("\/customer-count-override"\)/);
  assert.match(controller, /coalesce\(correction\.customer_count, daily_counts\.auto_count, 0\)/);
});

test('report save payload only contains target personnel and handover fields', () => {
  assert.match(daily, /dailyTargetCents: Math\.round\(target \* 100\)/);
  assert.match(daily, /countFields\.filter\(name => !autoCountFields\.includes\(name\)\)/);
  assert.match(daily, /legacyPaymentFields\.includes\(code\)/);
});

test('manager channel totals use settled order payments minus completed order refunds', () => {
  assert.match(operations, /sales\.status='SETTLED'/);
  assert.match(operations, /amount\(sales,"CASH"\) - amount\(refunds,"CASH"\) \+ amount\(recharges,"CASH"\)/);
  assert.match(manager, /function channelNetAmount\(summary,method\)\{return channelAmount\(summary\.sales\|\|\[\],method\)-channelAmount\(summary\.refunds\|\|\[\],method\)\+channelAmount\(summary\.recharges\|\|\[\],method\);\}/);
  assert.match(manager, /summary\.recharges/);
  assert.match(manager, /payment-methods\?includeInactive=true/);
});

test('recharge movements retain their payment channel and flow into daily totals', () => {
  assert.match(service, /transaction_type='RECHARGE'/);
  assert.match(service, /wt\.payment_method_name_snapshot/);
  assert.match(service, /transaction_type='ADJUSTMENT' and wt\.source='RECHARGE_REFUND'/);
  assert.match(service, /rechargeCents - rechargeRefundCents/);
  assert.match(controller, /rechargeCents\(\)/);
  assert.match(daily, /rechargeCents/);
  assert.match(daily, /rechargeRefundCents/);
  assert.match(manager, /充值净额/);
});

test('monthly turnover excludes card sales while cash flow separates member balance orders', () => {
  assert.match(controller, /new MonthlySummary\(target, totals\.turnoverCents\(\), totals\.cashFlowCents\(\)/);
  assert.match(controller, /DailyFinancialPolicy\.calculate\(settledOrderCents, completedOrderRefundCents, movements, rechargeNetCents\)/);
  assert.match(controller, /filter\(channel -> !"MEMBER_BALANCE"\.equalsIgnoreCase\(channel\.methodKind\(\)\)\)/);
  assert.match(controller, /cards\.rechargeNetCents\(\)/);
  assert.match(controller, /field\("cashFlowCents","MONTHLY","累计现金流"/);
  assert.match(daily, /\['累计现金流','cashFlowCents','amount'\]/);
  assert.doesNotMatch(daily, /\['累计净实收','cashFlowCents','amount'\]/);
});

test('cash flow includes actual recharge movements but excludes gifted balance', () => {
  assert.match(controller, /transaction_type='RECHARGE'[\s\S]*source='RECHARGE_REFUND'/);
  assert.match(controller, /cards\.rechargeNetCents\(\)/);
  assert.doesNotMatch(controller, /recharge_net_cents[\s\S]{0,240}transaction_type='BONUS'/);
});

test('daily cash flow label and browser cache version use the current report wording', () => {
  assert.match(controller, /field\("dailyCashFlowCents","DAILY","当日现金流"/);
  assert.match(controller, /"dailyCashFlowCents"\.equals\(base\.fieldCode\(\)\)[\s\S]*"当日净实收"\.equals\(configured\.fieldLabel\(\)\)/);
  assert.match(daily, /<label>当日现金流（元）<input name="dailyCashFlowCents"/);
  assert.doesNotMatch(daily, /当日净实收/);
  assert.match(index, /daily-report\.js\?v=20260913-next-optimization-v2/);
});

test('daily report exposes card-opening counts and refund occurrence dates', () => {
  assert.match(daily, /dailyCardOpenCount/);
  assert.match(daily, /\['累计开卡数量','cardOpenCount','count'\]/);
  assert.match(daily, /reportData\.unifiedMetrics\?\.refundOccurrences/);
  assert.match(daily, /退款完成时间/);
  assert.match(daily, /原订单营业日：/);
  assert.match(index, /daily-report\.js\?v=20260913-next-optimization-v2/);
});

test('daily payment totals use settlement business day while refunds keep the original order business day', () => {
  assert.match(controller, /coalesce\(sales\.settled_at,sales\.created_at\) at time zone reporting_store\.timezone/);
  assert.match(controller, /reporting_store\.business_day_cutoff/);
  assert.match(controller, /refund\.business_date between :from and :to/);
  assert.match(daily, /按原订单营业日归集/);
  assert.doesNotMatch(daily, /按实际完成营业日归集|按完成营业日归集/);
  assert.doesNotMatch(controller, /sum\(greatest\(0,sales\.paid_cents-coalesce\(order_refund\.refunded_cents,0\)\)\)/);
  assert.match(operations, /coalesce\(sales\.settled_at,sales\.created_at\) at time zone reporting_store\.timezone/);
  assert.match(operations, /Math\.subtractExact\(orders\.salesAmountCents\(\), refunds\.refundAmountCents\(\)\)/);
});

test('historical settled orders without a settlement timestamp remain visible without rewriting saved reports', () => {
  assert.doesNotMatch(controller, /\(\(sales\.settled_at at time zone reporting_store\.timezone/);
  assert.doesNotMatch(operations, /\(\(sales\.settled_at at time zone reporting_store\.timezone/);
  assert.match(controller, /ReportValues current = report == null \? live : operationalValues\(report\.values\(\), live\)/);
  assert.match(controller, /saved\.dailyTargetCents\(\)[\s\S]*saved\.managerCount\(\)[\s\S]*saved\.nextDayImprovementNote\(\)/);
});
