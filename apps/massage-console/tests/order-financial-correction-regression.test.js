const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const controller = fs.readFileSync(path.join(root, 'services/massage-api/src/main/java/com/chengxin/massage/sales/SalesOrderController.java'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'services/massage-api/src/main/resources/db/migration/V73__sales_order_financial_corrections.sql'), 'utf8');
const app = fs.readFileSync(path.join(root, 'apps/massage-console/app.js'), 'utf8');

test('settled payment correction is versioned, audited, and refund protected', () => {
  assert.match(migration, /financial_correction_version/);
  assert.match(migration, /sales_order_financial_correction_payment/);
  assert.match(controller, /@PostMapping\("\/\{id\}\/financial-corrections"\)/);
  assert.match(controller, /!input\.expectedVersion\(\)\.equals\(order\.financialCorrectionVersion\(\)\)/);
  assert.match(controller, /select exists\(select 1 from sales_refund where order_id=:order\)/);
  assert.match(controller, /ORDER_FINANCIAL_CORRECTED/);
  assert.match(controller, /snapshotCorrectionPayment\(correctionId, "BEFORE"/);
  assert.match(controller, /snapshotCorrectionPayment\(correctionId, "AFTER"/);
});

test('member balance difference is synchronized during payment correction', () => {
  assert.match(controller, /newMemberPayment - oldMemberPayment/);
  assert.match(controller, /consumeWallet\(storeId, order\.memberId\(\), memberDelta/);
  assert.match(controller, /restoreWalletForCorrection/);
  assert.match(controller, /'ORDER_CORRECTION'/);
});

test('order detail exposes a dedicated financial correction workflow', () => {
  assert.match(app, /data-order-financial-correct/);
  assert.match(app, /更正收款信息/);
  assert.match(app, /expectedVersion:Number\(financialCorrectionOrder\.order\.financialCorrectionVersion/);
  assert.match(app, /收款方式合计必须等于修改后的实收金额/);
});
