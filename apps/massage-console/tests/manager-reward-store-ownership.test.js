const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'manager-rewards-admin.js'), 'utf8');
const mobile = fs.readFileSync(path.join(root, 'manager-rewards.js'), 'utf8');
const service = fs.readFileSync(path.resolve(root, '../..', 'services/massage-api/src/main/java/com/chengxin/massage/operations/ManagerRewardService.java'), 'utf8');

test('manager candidates come from active linked store assignments, not attendance', () => {
  assert.match(service, /assignment\.position_type='STORE_MANAGER' and assignment\.active and assignment\.employment_status='ACTIVE'/);
  assert.match(service, /where e\.active and e\.employment_status='ACTIVE'/);
  assert.match(service, /left join lateral \(select attendance\.status from employee_attendance/);
  assert.match(service, /case when a\.status in \('PRESENT','LATE','COMPLETED','LEFT_EARLY'\) then a\.status else 'NOT_REQUIRED' end attendance_status/);
  assert.doesNotMatch(service, /join employee_attendance a on/);
  assert.match(service, /preferredManager\(candidates\(storeId, date\), assignedUserId\)/);
});

test('admin can choose a store primary or a daily override without clock-in', () => {
  assert.match(admin, /设为本店主店长/);
  assert.match(admin, /保存当日覆盖/);
  assert.match(admin, /primary \? '\/primary-manager' : '\/assignments'/);
  assert.match(admin, /请先在门店\/员工配置中为该门店指定店长并关联账号/);
  assert.doesNotMatch(admin, /当天没有符合排班和打卡条件的店长/);
});

test('mobile keeps direct yue submission and shows configuration guidance', () => {
  assert.match(mobile, /await request\('\/yue', \{ method:'POST', body:form \}\)/);
  assert.match(mobile, /联系管理员为本店配置店长/);
  assert.doesNotMatch(mobile, /请先由管理端指定归属/);
});
