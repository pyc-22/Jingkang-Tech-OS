const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const manager = fs.readFileSync(path.join(root, 'apps/massage-console/manager-mobile.js'), 'utf8');
const managerHtml = fs.readFileSync(path.join(root, 'apps/massage-console/manager-mobile.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'apps/massage-console/app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'apps/massage-console/index.html'), 'utf8');
const financeController = fs.readFileSync(path.join(root, 'services/massage-api/src/main/java/com/chengxin/massage/operations/FinanceExpenseClaimController.java'), 'utf8');

test('manager expense summary excludes non-effective claim states', () => {
  assert.match(manager, /managerExpenseAccountingStatuses=\['SUBMITTED','APPROVED','PAID'\]/);
  assert.match(manager, /rows\.filter\(row=>managerExpenseAccountingStatuses\.includes\(row\.status\)\)/);
  assert.match(managerHtml, />有效申请金额</);
  assert.match(manager, /不计入有效金额/);
});

test('finance claim browser exposes manager, date, number and attachment workflows', () => {
  assert.match(index, /id="finance-applicant-filter"/);
  assert.match(index, /id="finance-claims-from"/);
  assert.match(index, /id="finance-claims-to"/);
  assert.match(index, /id="finance-claims-number"/);
  assert.match(index, /<th>凭证<\/th>/);
  assert.match(app, /applicantUserId/);
  assert.match(app, /attachmentCount/);
  assert.match(app, /download=true/);
  assert.match(app, /data-finance-attachment-download/);
});

test('finance API returns attachment metadata and supports authenticated downloads', () => {
  assert.match(financeController, /attachment_count/);
  assert.match(financeController, /has_expense_proof/);
  assert.match(financeController, /applicantUserId/);
  assert.match(financeController, /claimNo/);
  assert.match(financeController, /download \? "attachment" : "inline"/);
});
