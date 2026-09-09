const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mobile = fs.readFileSync(path.join(root, 'mobile.js'), 'utf8');
const controller = fs.readFileSync(path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main', 'java', 'com', 'chengxin', 'massage', 'mobile', 'TechnicianMobileController.java'), 'utf8');

test('technician mobile has no self clock-in entry or write request', () => {
  assert.doesNotMatch(mobile, /id="mobile-clock-dialog"/);
  assert.doesNotMatch(mobile, /open-mobile-clock-in/);
  assert.doesNotMatch(mobile, /technician\/clock-in/);
  assert.match(mobile, /等待前台或店长安排上钟/);
  assert.match(mobile, /mobile-confirm-pending/);
  assert.match(mobile, /mobile-clock-out/);
});

test('technician self clock-in uses the active service item default duration on the server', () => {
  assert.match(controller, /short plannedDurationMinutes = service\.defaultDurationMinutes\(\);/);
  assert.match(controller, /\.param\("duration", plannedDurationMinutes\)/);
  assert.doesNotMatch(controller, /input\.plannedDurationMinutes\(\)/);
});
