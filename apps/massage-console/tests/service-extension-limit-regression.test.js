const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const mobile = fs.readFileSync(path.join(root, 'mobile.js'), 'utf8');
const controller = fs.readFileSync(path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main', 'java', 'com', 'chengxin', 'massage', 'mobile', 'TechnicianMobileController.java'), 'utf8');

test('front desk filters extension items by both configured limits', () => {
  assert.match(app, /service-duration-policy/);
  assert.match(app, /technicianExtensionMaxMinutes[\s\S]*extensionTotalMinutes/);
  assert.match(app, /serviceDurationMaxMinutes[\s\S]*session\.plannedDurationMinutes/);
  assert.match(app, /item\.durationMinutes[\s\S]*remainingExtensionMinutes/);
});

test('technician options expose and apply the authoritative remaining allowance', () => {
  assert.match(controller, /remainingExtensionMinutes/);
  assert.match(controller, /defaultDurationMinutes\(\) <= remainingExtensionMinutes/);
  assert.match(mobile, /mobileExtensionOptions\.remainingExtensionMinutes/);
  assert.match(mobile, /最多可再加/);
});

test('both clients replace raw 400 responses with a clear limit message', () => {
  assert.match(app, /response\.status === 400[\s\S]*本次服务已达到加钟上限/);
  assert.match(mobile, /response\.status===400\?'本次服务已达到加钟上限/);
});
