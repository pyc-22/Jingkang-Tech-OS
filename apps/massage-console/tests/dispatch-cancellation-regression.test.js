const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const migration = fs.readFileSync(path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main', 'resources', 'db', 'migration', 'V70__frontdesk_dispatch_cancellation.sql'), 'utf8');

test('front desk can cancel a failed dispatch without deleting the service', () => {
  assert.match(app, /id="open-dispatch-cancellation"[^>]*>取消派单</);
  assert.match(app, /service-sessions\/\$\{dispatchReassignmentSessionId\}\/cancel-dispatch/);
  assert.match(app, /已取消派单，服务已转入待与客沟通/);
  assert.match(app, /id="dispatch-cancelled-list"/);
});

test('dispatch cancellation has a dedicated pre-service state and remains room-exclusive', () => {
  assert.match(migration, /DISPATCH_CANCELLED/);
  assert.match(migration, /status IN \('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE'\)/);
  assert.match(migration, /DISPATCH_CANCELLED','TRANSFER_REQUESTED/);
});
