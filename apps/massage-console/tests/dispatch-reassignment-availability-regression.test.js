const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const lifecycle = fs.readFileSync(path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main', 'java', 'com', 'chengxin', 'massage', 'catalog', 'ServiceDispatchLifecycle.java'), 'utf8');
const configuration = fs.readFileSync(path.resolve(root, '..', '..', 'services', 'massage-api', 'src', 'main', 'resources', 'application.yml'), 'utf8');

test('expired or rejected technicians remain available while their service waits for reassignment', () => {
  assert.match(app, /Rejected and expired participants are no longer assigned to the session/);
  assert.doesNotMatch(app, /reassignment\.forEach\(session => sessionParticipantIds\(session\)\.forEach\(id =>[\s\S]*tech\.state = 'reassign'/);
  assert.match(app, /state\.reassignmentSessions = reassignment/);
});

test('dispatch acceptance timeout has a shared configurable five-minute default', () => {
  assert.match(lifecycle, /DEFAULT_ACCEPTANCE_TIMEOUT_SECONDS = 300/);
  assert.match(configuration, /acceptance-timeout-seconds: \$\{MASSAGE_DISPATCH_ACCEPTANCE_TIMEOUT_SECONDS:300\}/);
});
