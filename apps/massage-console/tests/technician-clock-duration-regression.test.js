const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mobile = fs.readFileSync(path.join(root, 'mobile.js'), 'utf8');
const controller = fs.readFileSync(path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main', 'java', 'com', 'chengxin', 'massage', 'mobile', 'TechnicianMobileController.java'), 'utf8');

test('technician self clock-in displays the project-managed duration without an editable duration field', () => {
  assert.match(mobile, /mobile-clock-duration-summary/);
  assert.match(mobile, /data-duration="\$\{service\.defaultDurationMinutes\}"/);
  assert.doesNotMatch(mobile, /id="mobile-clock-duration"/);
  assert.doesNotMatch(mobile, /mobileDurationOptions/);
  assert.doesNotMatch(mobile, /plannedDurationMinutes:Number\(form\.get\('plannedDurationMinutes'\)\)/);
});

test('technician self clock-in uses the active service item default duration on the server', () => {
  assert.match(controller, /short plannedDurationMinutes = service\.defaultDurationMinutes\(\);/);
  assert.match(controller, /\.param\("duration", plannedDurationMinutes\)/);
  assert.doesNotMatch(controller, /input\.plannedDurationMinutes\(\)/);
});
