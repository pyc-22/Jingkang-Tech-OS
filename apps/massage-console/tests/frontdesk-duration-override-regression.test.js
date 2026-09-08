const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const migration = fs.readFileSync(path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main', 'resources', 'db', 'migration', 'V69__frontdesk_service_duration_override.sql'), 'utf8');

test('front desk can reach audited duration override from a serving technician card', () => {
  assert.match(app, /data-tech-context-action="adjust-duration"/);
  assert.match(app, /hasAdminPermission\('SERVICE_DURATION_OVERRIDE'\)/);
  assert.match(app, /overrideServiceDuration\(sessionId\)/);
  assert.match(app, /\(state\.serviceSessions \|\| \[\]\)\.find\(item => String\(item\.id\) === String\(sessionId\)\)\s*\|\|\s*state\.activeSessions\.find/);
});

test('default cashier role receives the independent duration permission', () => {
  assert.match(migration, /role\.code\s*=\s*'CASHIER'/);
  assert.match(migration, /permission\.code\s*=\s*'SERVICE_DURATION_OVERRIDE'/);
});

test('front desk exposes pre-start sessions to duration and room controls', () => {
  assert.match(app, /\['serving', 'accepted', 'pending'\]\.includes\(technician\.state\)/);
  assert.match(app, /\['PENDING_ACCEPTANCE', 'ACCEPTED', 'IN_SERVICE'\]\.includes\(session\.status\)/);
  assert.match(app, /state\.pendingAcceptanceSessions.*state\.acceptedSessions/);
});
