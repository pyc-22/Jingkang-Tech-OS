const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const app = fs.readFileSync(path.join(root, 'apps/massage-console/app.js'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'services/massage-api/src/main/java/com/chengxin/massage/sales/SalesOrderController.java'), 'utf8');

test('single-room settlement is restricted by the room primary key', () => {
  assert.match(controller, /pendingServiceSessions\(@RequestParam\(required = false\) UUID roomId/);
  assert.match(controller, /ss\.room_id,r\.code room_code/);
  assert.match(controller, /if \(roomId != null\) sql \+= " and ss\.room_id=:roomId"/);
  assert.match(controller, /record PendingServiceSession\([^)]*UUID roomId, String roomCode/);
  assert.match(app, /loadPendingServiceSessions\(\{ silent: true, roomId: room\.apiId, updateState: false \}\)/);
  assert.match(app, /sessions\.some\(session => String\(session\.roomId\) !== String\(room\.apiId\)\)/);
  assert.doesNotMatch(app, /state\.pendingServiceSessions\.filter\(session => String\(session\.roomCode\) === String\(room\.id\)\)/);
});

test('single-room settlement request does not replace the shared pending-service list', () => {
  assert.match(app, /async function loadPendingServiceSessions\(\{ silent = false, roomId = null, updateState = true \} = \{\}\)/);
  assert.match(app, /if \(updateState\) \{\s*state\.pendingServiceSessions = sessions;\s*renderPendingServiceSessions\(\);\s*\}/);
});

test('single-room settlement requires an explicit project selection', () => {
  assert.match(app, /singleRoomSettlementSelection = new Set\(\);\s*renderSingleRoomServiceSelection\(\)/);
  assert.match(app, /type="checkbox" data-single-room-service=/);
  assert.match(app, /id="select-all-single-room-services">全选本房/);
  assert.match(app, /if \(!room \|\| !sessions\.length\) return toast\('请至少勾选一项待结算服务'\)/);
  assert.match(app, /state\.orderItems = sessions\.map\(session => \(\{/);
  assert.match(app, /document\.querySelector\('#confirm-single-room-service-selection'\)\.disabled = selectedSessions\.length === 0/);
});

test('single-room settlement refreshes pending services and room status after payment', () => {
  assert.match(app, /Promise\.all\(\[loadPendingServiceSessions\(\{ silent:true \}\),loadFoundationData\(\{ silent:true \}\)\]\)/);
});

test('partially settled room remains pending until all completed services are linked', () => {
  assert.match(controller, /updateLinkedServiceRoomStates\(storeId, lines, orderNo\)/);
  assert.match(controller, /session\.status='COMPLETED'/);
  assert.match(controller, /linked_order\.status <> 'CANCELLED' and linked_order\.refund_status <> 'FULL'/);
  assert.match(controller, /roomStatusAfterSettlement\(hasUnsettledServices\)/);
  assert.match(controller, /hasUnsettledServices \? "PENDING_PAYMENT" : "CLEANING"/);
});
