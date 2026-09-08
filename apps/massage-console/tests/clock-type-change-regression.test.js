const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const controller = fs.readFileSync(path.resolve(
  root, '..', '..', 'services', 'massage-api', 'src', 'main', 'java', 'com',
  'chengxin', 'massage', 'catalog', 'ServiceSessionController.java'
), 'utf8');
const history = fs.readFileSync(path.resolve(
  root, '..', '..', 'services', 'massage-api', 'src', 'main', 'java', 'com',
  'chengxin', 'massage', 'catalog', 'ServiceSessionChangeHistoryController.java'
), 'utf8');

test('front desk exposes a service-in-progress clock type action', () => {
  assert.match(app, /data-tech-context-action="change-clock-type"/);
  assert.match(app, /function openClockTypeChange\(sessionId\)/);
  assert.match(app, /service-sessions\/\$\{clockTypeChangeSessionId\}\/clock-type/);
  assert.match(app, /method: 'PUT'/);
  assert.match(app, /name="clockType".*排钟.*点钟/s);
});

test('clock type action is enabled only for an operational service', () => {
  assert.match(app, /preStartAllowed = \['adjust-duration', 'transfer-room', 'change-clock-type'\]/);
  assert.match(app, /\['IN_SERVICE', 'PENDING_ACCEPTANCE', 'ACCEPTED'\]\.includes\(session\.status\)/);
  assert.match(controller, /@PutMapping\("\/\{id\}\/clock-type"\)/);
  assert.match(controller, /status in \('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE'\)/);
});

test('clock type change only updates the clock type and records an audit history event', () => {
  assert.match(controller, /update service_session set clock_type=:clockType,updated_at=now\(\),version=version\+1/);
  assert.doesNotMatch(controller, /update service_session set clock_type=:clockType[^\n]*service_item_id/);
  assert.match(controller, /SERVICE_CLOCK_TYPE_CHANGED/);
  assert.match(history, /'CLOCK_TYPE_CHANGED'/);
});
