const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'daily-report.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'daily-report.css'), 'utf8');
const daily = { innerHTML: '' };
const monthly = { innerHTML: '' };
const context = {
  document: { querySelector: selector => selector === '#daily-service-daily' ? daily : monthly },
  configFor: () => ({ visible: true, fieldLabel: '' }),
  percent: value => `${Number(value || 0).toFixed(2)}%`,
  dailyReportEscape: value => String(value),
  data: { currentValues: {}, monthly: {}, derived: {} },
  form: { elements: {
    dailyCustomerCount: { value: '18' },
    dailyExtensionCount: { value: '1' },
    dailyCallClockCount: { value: '7' }
  } }
};
const functions = source.slice(source.indexOf('  function serviceMetric('), source.indexOf('  function renderRefundOccurrences('))
  + source.slice(source.indexOf('  function previewServiceStructure('), source.indexOf('  function renderSettings('));
vm.runInNewContext(functions, context);

test('daily and monthly service structures render six metrics in order', () => {
  context.renderServiceStructure(
    { dailyCustomerCount: 18, dailyExtensionCount: 1, dailyCallClockCount: 7 },
    { customerCount: 439, extensionCount: 62, callClockCount: 95 },
    { dailyExtensionRate: 5.56, dailyCallClockRate: 38.89, dailyServiceClockRate: 44.44,
      monthlyExtensionRate: 14.12, monthlyCallClockRate: 21.64, monthlyServiceClockRate: 35.76 }
  );
  assert.equal((daily.innerHTML.match(/<article /g) || []).length, 6);
  assert.equal((monthly.innerHTML.match(/<article /g) || []).length, 6);
  assert.match(daily.innerHTML, /当日总客流[\s\S]*当日加钟[\s\S]*当日点钟[\s\S]*当日加钟率[\s\S]*5\.56%[\s\S]*当日点钟率[\s\S]*38\.89%[\s\S]*当日加点钟率[\s\S]*44\.44%/);
  assert.match(monthly.innerHTML, /当月总客流[\s\S]*累计加钟[\s\S]*累计点钟[\s\S]*累计加钟率[\s\S]*14\.12%[\s\S]*累计点钟率[\s\S]*21\.64%[\s\S]*累计加点钟率[\s\S]*35\.76%/);
  assert.match(css, /\.daily-service-grid \{ display:grid; grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
});

test('unsaved preview uses customer count for every rate and handles zero customers', () => {
  context.previewServiceStructure();
  assert.match(daily.innerHTML, /5\.56%[\s\S]*38\.89%[\s\S]*44\.44%/);
  context.form.elements.dailyCustomerCount.value = '0';
  context.previewServiceStructure();
  assert.match(daily.innerHTML, /0\.00%[\s\S]*0\.00%[\s\S]*0\.00%/);
});
