const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mobile = fs.readFileSync(path.join(root, 'manager-rewards.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'manager-rewards-admin.js'), 'utf8');
const home = fs.readFileSync(path.resolve(root, '../..', 'services/massage-api/src/main/java/com/chengxin/massage/HomeController.java'), 'utf8');
const service = fs.readFileSync(path.resolve(root, '../..', 'services/massage-api/src/main/java/com/chengxin/massage/operations/ManagerRewardService.java'), 'utf8');

test('mobile manager reward records expose same-day correction form and PUT workflow', () => {
  assert.match(mobile, /当天更正约客/);
  assert.match(mobile, /name="orderId"/);
  assert.match(mobile, /name="customerName"/);
  assert.match(mobile, /name="customerPhone"/);
  assert.match(mobile, /name="note"/);
  assert.match(mobile, /method:'PUT'/);
  assert.match(mobile, /\/yue\/\$\{encodeURIComponent\(form\.dataset\.id\)\}/);
});

test('same-day correction is not exposed in admin console', () => {
  assert.doesNotMatch(admin, /data-reward-admin-correction/);
  assert.doesNotMatch(admin, /manager-reward-admin-correction-dialog/);
});

test('health endpoint reports the manager rewards release', () => {
  assert.match(home, /20261001-manager-ownership-conversion-v1/);
  assert.doesNotMatch(home, /20260924-|20260929-manager-rewards-v1/);
});

test('yue order submitted flags follow the active corrected order', () => {
  assert.match(service, /exists\(select 1 from manager_yue_record r[^]*r\.order_id=o\.id[^]*r\.active\) submitted/);
  assert.match(service, /update manager_yue_record set order_id=:order/);
  assert.match(service, /where id=:id and store_id=:store and active/);
});
