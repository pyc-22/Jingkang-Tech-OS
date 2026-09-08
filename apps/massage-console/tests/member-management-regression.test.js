const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const controller = fs.readFileSync(path.join(root, 'services/massage-api/src/main/java/com/chengxin/massage/member/MemberController.java'), 'utf8');
const walletController = fs.readFileSync(path.join(root, 'services/massage-api/src/main/java/com/chengxin/massage/member/WalletTransactionController.java'), 'utf8');
const app = fs.readFileSync(path.join(root, 'apps/massage-console/app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'apps/massage-console/index.html'), 'utf8');

test('member profile supports audited edits and protected deactivation', () => {
  assert.match(controller, /@PutMapping\("\/\{id\}"\)/);
  assert.match(controller, /MEMBER_UPDATED/);
  assert.match(controller, /@DeleteMapping\("\/\{id\}"\)/);
  assert.match(controller, /balanceCents\(\) > 0/);
  assert.match(controller, /status not in \('SETTLED','CANCELLED'\)/);
  assert.match(controller, /MEMBER_DEACTIVATED/);
});

test('member center exposes edit and deactivation actions', () => {
  assert.match(index, /id="member-edit-dialog"/);
  assert.match(app, /data-member-profile-edit/);
  assert.match(app, /data-member-profile-deactivate/);
  assert.match(app, /method:'PUT'/);
  assert.match(app, /method:'DELETE'/);
  assert.match(app, />停用归档</);
});

test('member edit dialog is present before scripts initialize', () => {
  const dialogPosition = index.indexOf('id="member-edit-dialog"');
  const scriptPosition = index.indexOf('src="./app.js?v=');
  assert.ok(dialogPosition >= 0 && scriptPosition >= 0 && dialogPosition < scriptPosition);
});

test('tenant administrator can purge only members without business history', () => {
  assert.match(controller, /@DeleteMapping\("\/\{id\}\/purge"\)/);
  assert.match(controller, /requireTenantAdmin\(authorization\)/);
  assert.match(controller, /wallet_transaction where member_id=:member/);
  assert.match(controller, /sales_order where member_id=:member/);
  assert.match(controller, /member_recharge_refund where member_id=:member/);
  assert.match(controller, /MEMBER_PURGED/);
  assert.match(app, /data-member-profile-purge/);
  assert.match(app, /isTenantAdmin\(\)/);
  assert.match(app, /\/purge`/);
});

test('member archive conflicts return actionable messages', () => {
  assert.match(controller, /会员仍有余额，请先处理余额后再停用归档/);
  assert.match(controller, /会员存在未结算订单，请先完成结算或取消订单/);
  assert.match(controller, /ResponseEntity<Map<String, String>> deactivate/);
  assert.match(app, /error\.message\|\|error\.detail\|\|'会员停用归档失败'/);
});

test('tenant administrator can clear test balance through an audited adjustment and archive', () => {
  assert.match(controller, /@PostMapping\("\/\{id\}\/clear-test-balance-and-archive"\)/);
  assert.match(controller, /requireTenantAdmin\(authorization\)/);
  assert.match(controller, /'ADJUSTMENT'/);
  assert.match(controller, /'ADMIN_TEST_CLEANUP'/);
  assert.match(controller, /MEMBER_TEST_BALANCE_CLEARED_AND_DEACTIVATED/);
  assert.match(controller, /balance_cents=0/);
  assert.match(controller, /active=false/);
  assert.match(app, /data-member-test-balance-cleanup/);
  assert.match(app, /querySelector\('\.dialog-heading-actions'\)\?\.remove\(\)/);
  assert.match(app, /历史测试数据清理/);
  assert.match(app, /clear-test-balance-and-archive/);
});

test('an archived phone restores the original member instead of creating a duplicate', () => {
  assert.match(controller, /existingMemberByPhoneForUpdate\(phone\)/);
  assert.match(controller, /active=true/);
  assert.match(controller, /MEMBER_REACTIVATED/);
  assert.match(controller, /MemberWriteResult/);
  assert.match(app, /member\.reactivated/);
  assert.match(app, /m\.reactivated/);
  assert.match(app, /归档会员已恢复/);
});

test('open card, renewal and recharge submit technician and employee independently', () => {
  assert.match(app, /member-open-employee/);
  assert.match(app, /member-renew-employee/);
  assert.match(app, /member-recharge-employee/);
  assert.match(app, /technicianId:data\.get\('technicianId'\)\|\|null,employeeId:data\.get\('employeeId'\)\|\|null/);
  assert.match(app, /technicianId:f\.get\('technicianId'\)\|\|null,employeeId:f\.get\('employeeId'\)\|\|null/);
  assert.match(controller, /input\.technicianId\(\)/);
  assert.match(controller, /input\.employeeId\(\)/);
  assert.match(controller, /technician_name_snapshot,employee_id,employee_name_snapshot/);
  assert.match(walletController, /wt\.employee_id,wt\.employee_name_snapshot/);
});

test('member center search also matches phone numbers', () => {
  assert.match(controller, /m\.code ilike :q or m\.name ilike :q or m\.phone ilike :q/);
});
