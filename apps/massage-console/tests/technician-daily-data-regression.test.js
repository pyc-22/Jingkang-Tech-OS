const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mobile = fs.readFileSync(path.join(root, 'mobile.js'), 'utf8');
const controller = fs.readFileSync(path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main', 'java', 'com', 'chengxin', 'massage', 'mobile', 'TechnicianMobileController.java'), 'utf8');

test('technician can select a business date and view personal daily service data', () => {
  assert.match(mobile, /id="mobile-daily-date" type="date"/);
  assert.match(mobile, /technician\/daily-data\?date=/);
  assert.match(mobile, /mobile-daily-queue/);
  assert.match(mobile, /mobile-daily-extension/);
  assert.match(mobile, /待结算/);
});

test('daily endpoint scopes records to the authenticated technician and business date', () => {
  assert.match(controller, /@GetMapping\("\/daily-data"\)/);
  assert.match(controller, /participant\.technician_id=:technician and session\.business_date=:date/);
  assert.match(controller, /effective_records where store_id=:store and technician_id=:technician and business_date=:date/);
  assert.match(controller, /effective_by_participant AS/);
});
