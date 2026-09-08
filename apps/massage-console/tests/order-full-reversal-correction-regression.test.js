const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const controller = fs.readFileSync(path.join(root, 'services/massage-api/src/main/java/com/chengxin/massage/sales/SalesOrderController.java'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'services/massage-api/src/main/resources/db/migration/V65__sales_order_corrections.sql'), 'utf8');

test('full reversal correction keeps the original service-record set intact', () => {
  assert.match(controller, /validateCorrectionServiceSessions\(storeId, correctionSource\.id\(\), lines\)/);
  assert.match(controller, /sourceSessions\.equals\(correctionSessions\)/);
  assert.match(controller, /重新结算必须包含原订单的全部服务记录/);
  assert.match(controller, /重新结算只能使用原订单对应的服务记录/);
});

test('only one active correction can be linked to an original order', () => {
  assert.match(migration, /sales_order_active_correction_unique_idx/);
  assert.match(migration, /WHERE corrected_from_order_id IS NOT NULL[\s\S]*status <> 'CANCELLED'[\s\S]*refund_status <> 'FULL'/);
});
