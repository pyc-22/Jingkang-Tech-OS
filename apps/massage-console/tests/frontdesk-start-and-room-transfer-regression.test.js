const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const controller = fs.readFileSync(path.resolve(
  root,
  '..',
  '..',
  'services',
  'massage-api',
  'src',
  'main',
  'java',
  'com',
  'chengxin',
  'massage',
  'catalog',
  'ServiceSessionController.java'
), 'utf8');
const participantController = fs.readFileSync(path.resolve(
  root,
  '..',
  '..',
  'services',
  'massage-api',
  'src',
  'main',
  'java',
  'com',
  'chengxin',
  'massage',
  'catalog',
  'ServiceParticipantController.java'
), 'utf8');

test('front desk can start an accepted service', () => {
  assert.match(app, /data-tech-context-action="start-service"/);
  assert.match(app, /startServiceFromFrontdesk\(sessionId\)/);
  assert.match(app, /service-sessions\/\$\{sessionId\}\/start-service/);
  assert.match(controller, /@PostMapping\("\/\{id\}\/start-service"\)/);
  assert.match(controller, /status='IN_SERVICE'.*status in \(\'PENDING_ACCEPTANCE\',\'ACCEPTED\'\)/s);
  assert.match(controller, /rotateAfterServiceStart/);
});

test('front desk can start a service before technician acceptance', () => {
  assert.match(app, /\['accepted', 'pending'\]\.includes\(technician\.state\)/);
  assert.ok(app.includes('(state.pendingAcceptanceSessions || []), ...(state.acceptedSessions || [])'));
  assert.ok(controller.includes("status in ('PENDING_ACCEPTANCE','ACCEPTED')"));
});

test('front desk start clears acceptance deadlines from session and participants', () => {
  assert.match(controller, /set status='IN_SERVICE'.*acceptance_deadline_at=null/s);
  assert.match(controller, /set status='IN_SERVICE',service_started_at=:started,acceptance_deadline_at=null/);
});

test('front desk assignment provisions legacy room beds and locks the selected bed', () => {
  assert.match(controller, /ensureRoomBeds\(storeId, roomId\)/);
  assert.match(controller, /from room where id=:room and store_id=:store for update/);
  assert.match(controller, /generate_series\(1,r\.bed_count\)/);
  assert.match(controller, /on conflict \(room_id,code\) do nothing/i);
  assert.match(controller, /order by b\.sort_order limit 1 for update/);
  assert.doesNotMatch(controller, /for update skip locked/);
});

test('front desk start surfaces the server error detail', () => {
  assert.match(app, /const detail = \(await response\.text\(\)\)/);
  assert.match(app, /开始服务失败：\$\{detail \|\|/);
  assert.match(app, /服务器暂时不可用，请刷新后重试/);
});

test('technician-card room transfer uses its own dialog and form', () => {
  assert.match(app, /id="technician-room-transfer-dialog"/);
  assert.match(app, /id="technician-room-transfer-form"/);
  assert.match(app, /querySelector\('#technician-room-transfer-form'\).*submitTechnicianRoomTransfer/);
  assert.match(app, /function openTechnicianRoomTransfer\(sessionId\)/);
  assert.match(app, /transfer-room'\) return openTechnicianRoomTransfer\(sessionId\)/);
  assert.match(app, /serviceSessionId:technicianContextSessionId/);
});

test('front desk room transfer forms use distinct submit handlers', () => {
  assert.equal((app.match(/async function submitTechnicianRoomTransfer\(/g) || []).length, 1);
  assert.equal((app.match(/async function submitFrontdeskRoomTransfer\(/g) || []).length, 1);
  assert.match(app, /querySelector\('#frontdesk-room-transfer-form'\).*submitFrontdeskRoomTransfer/);
  assert.match(app, /serviceSessionId:data\.get\('serviceSessionId'\)/);
});

test('pending technician card exposes a direct start-service action', () => {
  assert.match(app, /\['pending', 'accepted'\]\.includes\(tech\.state\) \? '开始服务'/);
  assert.match(app, /if \(tech\.state === 'pending' \|\| tech\.state === 'accepted'\)/);
  assert.match(app, /await startServiceFromFrontdesk\(session\.id\)/);
});

test('front desk loads the updated application script without stale browser cache', () => {
  assert.match(index, /app\.js\?v=20260915-next-optimization-v5/);
});

test('technician-card and settlement room-transfer dialogs have unique ids', () => {
  assert.equal((app.match(/id="technician-room-transfer-dialog"/g) || []).length, 1);
  assert.equal((app.match(/id="frontdesk-room-transfer-dialog"/g) || []).length, 1);
  assert.equal((app.match(/id="technician-room-transfer-form"/g) || []).length, 1);
  assert.equal((app.match(/id="frontdesk-room-transfer-form"/g) || []).length, 1);
});

test('replaced technicians are removed from live front-desk state while history remains available', () => {
  assert.match(app, /activeParticipantTechnicianIds \|\| session\?\.participantTechnicianIds/);
  assert.match(app, /return \[\.\.\.new Set\(String\(raw\)\.split\(','\)/);
  assert.match(app, /sessionParticipantIds\(item\)/);
  assert.match(app, /const roomSessions = new Map\(\)/);
  assert.match(controller, /active_participant_technician_ids/);
  assert.match(controller, /participant\.status in \('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE'\)/);
  assert.match(controller, /participant\.status in \('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE','COMPLETED'\)/);
  assert.match(participantController, /queue_enabled=true for update/);
  assert.match(participantController, /slot_no=:slot and status='IN_SERVICE' for update/);
  assert.match(participantController, /activeSlotParticipants\.size\(\) != 1/);
  assert.match(participantController, /activeSlotCount != 1/);
});
