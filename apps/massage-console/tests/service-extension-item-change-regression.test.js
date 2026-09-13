const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const apiRoot = path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main');
const controller = fs.readFileSync(path.join(apiRoot, 'java', 'com', 'chengxin', 'massage', 'catalog', 'ServiceSessionExtensionItemChangeController.java'), 'utf8');
const sessionController = fs.readFileSync(path.join(apiRoot, 'java', 'com', 'chengxin', 'massage', 'catalog', 'ServiceSessionController.java'), 'utf8');
const migration = fs.readFileSync(path.join(apiRoot, 'resources', 'db', 'migration', 'V82__service_extension_item_changes.sql'), 'utf8');

test('extension changes use a dedicated endpoint and retain the main service route', () => {
  assert.match(controller, /@PutMapping\("\/\{sessionId\}\/extensions\/\{extensionId\}\/service-item"\)/);
  assert.match(app, /extensions\/\$\{extensionId\}\/service-item/);
  assert.match(app, /\/service-item`;/);
  assert.match(controller, /update service_session_extension set service_item_id/);
  assert.doesNotMatch(controller, /update service_session set service_item_id/);
});

test('extension changes retain active-session, settlement and duration safeguards', () => {
  assert.match(controller, /Only an in-service session can change an extension project/);
  assert.match(controller, /Settled services cannot change an extension/);
  assert.match(controller, /filter\(ResolvedServiceItem::allowsExtension\)/);
  assert.match(controller, /requireExtensionWithinLimit/);
  assert.match(controller, /expected_end_at=:expected/);
  assert.match(controller, /SERVICE_EXTENSION_ITEM_CHANGED/);
  assert.match(controller, /if \(deltaMinutes != 0\) \{\s*durationPolicies\.recordChange/);
  assert.doesNotMatch(controller, /newExpectedEnd\.isAfter\(OffsetDateTime\.now\(\)\)/);
});

test('extension change history preserves old and new financial snapshots', () => {
  assert.match(migration, /CREATE TABLE service_session_extension_change_log/);
  assert.match(migration, /previous_price_version_id/);
  assert.match(migration, /new_commission_rule_version_id/);
  assert.match(migration, /previous_counts_as_clock_snapshot/);
  assert.match(migration, /new_counts_as_clock_snapshot/);
});

test('front desk assigns daily extension counts to the extension technician', () => {
  assert.match(sessionController, /extension_count/);
  assert.match(sessionController, /extension_technician_ids/);
  assert.match(app, /extensionCount:0/);
  assert.match(app, /String\(session\.extensionTechnicianIds \|\| ''\)\.split\(','\)/);
  assert.match(app, /加钟 <b>\$\{tech\.extensionCount\}<\/b>/);
});

test('main item changes remain available when a session has no extensions', () => {
  assert.match(app, /kind\.innerHTML = hasExtensions/);
  assert.match(app, /'<option value="MAIN">首钟项目<\/option>'/);
  assert.match(app, /extensionSelect\.disabled = serviceItemChangeExtensions\.length === 0/);
  assert.match(app, /kindWrap\.hidden = !hasExtensions/);
  assert.match(app, /extensionWrap\.style\.display = 'none'/);
  assert.match(index, /app\.js\?v=20260912-full-optimization-v1/);
  assert.match(index, /styles\.css\?v=20260912-full-optimization-v1/);
  assert.match(fs.readFileSync(path.join(root, 'styles.css'), 'utf8'), /\.form-grid label\[hidden\] \{ display:none !important; \}/);
});

test('sessions with extensions require an explicit main or extension target', () => {
  assert.match(app, /<option value="">请选择更换对象<\/option>/);
  assert.match(app, /if \(!\['MAIN','EXTENSION'\]\.includes\(changeKind\)\) return toast\('请选择要更换的项目类型'\)/);
  assert.match(app, /kind\.value = hasExtensions \? '' : 'MAIN'/);
});
