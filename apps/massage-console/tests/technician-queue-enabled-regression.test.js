const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const migration = fs.readFileSync(path.join(root, 'services/massage-api/src/main/resources/db/migration/V81__technician_queue_enabled.sql'), 'utf8');
const foundation = fs.readFileSync(path.join(root, 'services/massage-api/src/main/java/com/chengxin/massage/catalog/FoundationController.java'), 'utf8');
const schedule = fs.readFileSync(path.join(root, 'services/massage-api/src/main/java/com/chengxin/massage/catalog/TechnicianSchedulePolicy.java'), 'utf8');
const dispatch = fs.readFileSync(path.join(root, 'services/massage-api/src/main/java/com/chengxin/massage/catalog/ServiceParticipantController.java'), 'utf8');
const app = fs.readFileSync(path.join(root, 'apps/massage-console/app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'apps/massage-console/index.html'), 'utf8');

test('queue status migration preserves existing technicians and supports daily filtering', () => {
  assert.match(migration, /ADD COLUMN queue_enabled BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(migration, /technician_store_queue_enabled_idx/);
  assert.match(foundation, /includeQueueDisabled/);
  assert.match(foundation, /technicians\/\{id\}\/queue-enabled/);
});

test('disabled technicians are excluded from assignment paths and can be toggled in management', () => {
  assert.match(schedule, /select id,active,queue_enabled from technician/);
  assert.match(schedule, /Boolean\.TRUE\.equals\(technician\.queueEnabled\(\)\)/);
  assert.match(dispatch, /active=true and queue_enabled=true/);
  assert.match(index, /队列状态/);
  assert.match(app, /启用队列|停用队列/);
  assert.match(app, /data-queue-toggle/);
  assert.match(app, /body:JSON\.stringify\(\{ enabled \}\)/);
});
