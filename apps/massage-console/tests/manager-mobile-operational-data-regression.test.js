const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manager = fs.readFileSync(path.join(root, 'manager-mobile.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'manager-mobile.html'), 'utf8');

test('manager business data supports a selected business date and all clock types', () => {
  assert.match(html, /id="manager-report-date"[^>]*type="date"/);
  assert.match(manager, /operations\/service-clock-summary\$\{dateQuery\}/);
  assert.match(manager, /managerServiceMetric\('排钟'/);
  assert.match(manager, /managerServiceMetric\('累计排钟'/);
  assert.match(manager, /managerJson\(`\/operations\/daily-report\$\{dateQuery\}`/);
  assert.match(manager, /managerOptionalJson\(`\/operations\/payment-channel-summary\$\{dateQuery\}`/);
});

test('manager payment channels are sourced from the store configuration', () => {
  assert.match(manager, /managerOptionalJson\('\/payment-methods\?includeInactive=true',\[\]\)/);
  assert.match(manager, /renderManagerChannels\(channels,managerPaymentMethods\)/);
  assert.match(manager, /configured=methods\.length\?methods/);
});

test('an unavailable daily report does not block core store data', () => {
  assert.match(manager, /managerOptionalJson\(`\/daily-reports\$\{dateQuery\}`\,null\)/);
  assert.match(manager, /managerOptionalJson\(`\/operations\/service-clock-summary\$\{dateQuery\}`\,\{daily:\{\}\,monthly:\{\}\}\)/);
  assert.match(manager, /managerOptionalTask\(loadManagerStoreComparison\)/);
  assert.match(manager, /const values=report\?\.currentValues\|\|\{\}/);
});

test('manager headline amounts use the frontdesk daily report definitions', () => {
  assert.match(html, /<span>当日营业额<\/span>/);
  assert.match(html, /<span>当日现金流<\/span>/);
  assert.match(manager, /const dailyValues=dailyReport\?\.currentValues;/);
  assert.match(manager, /dailyValues\.dailySalesCents/);
  assert.match(manager, /dailyValues\.dailyCashFlowCents/);
  assert.match(manager, /renderManagerDashboard\(report,dailyReport,/);
  assert.doesNotMatch(manager, /#metric-sales'\)\.textContent=managerMoney\(report\.salesAmountCents\)/);
  assert.doesNotMatch(manager, /#metric-service'\)\.textContent=managerMoney\(report\.serviceAmountCents\)/);
});
