const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mobile = fs.readFileSync(path.join(root, 'mobile.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const controller = fs.readFileSync(path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main', 'java', 'com', 'chengxin', 'massage', 'catalog', 'ServiceExtensionIntentController.java'), 'utf8');
const migration = fs.readFileSync(path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main', 'resources', 'db', 'migration', 'V76__service_extension_intent_messages.sql'), 'utf8');

test('technician submits an intent without duration or order mutation', () => {
  assert.match(mobile, /id="mobile-extension-intent"/);
  assert.match(mobile, /service-extension-intents/);
  assert.match(controller, /@PostMapping/);
  assert.match(controller, /service_session_id/);
  assert.doesNotMatch(controller, /service_session_extension/);
  assert.doesNotMatch(controller, /planned_duration_minutes/);
});

test('front desk can see and resolve pending intents', () => {
  assert.match(app, /service-extension-intent-panel/);
  assert.match(app, /data-extension-intent-action="contacted"/);
  assert.match(app, /data-extension-intent-action="reject"/);
  assert.match(controller, /@PutMapping\("\/\{id\}\/contacted"\)/);
  assert.match(controller, /@PutMapping\("\/\{id\}\/reject"\)/);
});

test('intent records expose upcoming assignment warning and lifecycle states', () => {
  assert.match(migration, /status VARCHAR\(20\).*PENDING.*CONTACTED.*REJECTED/s);
  assert.match(migration, /service_extension_intent_pending_session_idx/);
  assert.match(controller, /has_upcoming_assignment/);
});
