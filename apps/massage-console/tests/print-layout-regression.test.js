const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const clockTypeDefaultMigration = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'services', 'massage-api', 'src', 'main', 'resources', 'db', 'migration', 'V80__store_print_clock_type_default.sql'), 'utf8');

test('print item details use stable narrow and wide layouts', () => {
  assert.match(app, /const isNarrow = Number\(setting\.paperWidthMm\) <= 58/);
  assert.match(app, /class="compact-items"/);
  assert.match(app, /table-layout:fixed/);
  assert.match(app, /col-amount\{width:19%;text-align:right;white-space:nowrap/);
  assert.match(app, /show\('showLineAmount'\) && \(!show\('showUnitPrice'\) \|\| narrowPaper\)/);
  assert.doesNotMatch(app, /printBrowserReceiptByOptions[\s\S]*<pre>\$\{receiptEscape\(text\)\}/);
  assert.match(html, /app\.js\?v=20260913-next-optimization-v2/);
  assert.match(html, /styles\.css\?v=20260913-next-optimization-v2/);
  assert.match(html, /frontdesk-card-settlement\.css\?v=20260913-next-optimization-v2/);
});

test('print settings expose clock type and keep it enabled by default', () => {
  assert.match(app, /\['showClockType','显示钟类'\]/);
  assert.match(app, /const receiptClockTypeLabel = value => clockTypeLabels\[value\] \|\| value \|\| '—'/);
  assert.match(app, /show\('showClockType'\).*钟类：/);
  assert.match(app, /defaultPrintContentOptions/);
  assert.match(clockTypeDefaultMigration, /"showClockType":true/);
  assert.match(clockTypeDefaultMigration, /ALTER COLUMN content_options SET DEFAULT/);
});

test('clock type changes update the preview before settings are saved', () => {
  assert.match(app, /const liveContentOptions = document\.querySelector\('#print-content-option-list'\) \? selectedPrintContentOptions\(\) : printContentOptions\(\)/);
  assert.match(app, /clockType:'CALL'/);
});

test('all receipt paths print the configured clock type', () => {
  assert.match(app, /async function printReceipt[\s\S]*show\('showClockType'\)[\s\S]*receiptClockTypeLabel/);
  assert.match(app, /async function printReferenceReceipt[\s\S]*show\('showClockType'\)[\s\S]*receiptClockTypeLabel/);
  assert.match(app, /async function localReceiptTextByOptions[\s\S]*show\('showClockType'\)[\s\S]*receiptClockTypeLabel/);
  assert.match(app, /async function printBrowserReceiptByOptions[\s\S]*show\('showClockType'\)[\s\S]*receiptClockTypeLabel/);
});

test('clock type supports all configured Chinese labels and narrow reference layout', () => {
  for (const label of ['排钟', '点钟', '选钟', '预定排钟', '预定点钟']) assert.match(app, new RegExp(label));
  assert.match(app, /const narrowPaper = Number\(setting\.paperWidthMm\) <= 58/);
  assert.match(app, /reference-compact-items/);
});
