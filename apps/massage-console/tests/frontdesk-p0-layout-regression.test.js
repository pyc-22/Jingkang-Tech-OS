const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('frontdesk P0 pending panels stay disabled while backend workflows remain available', () => {
  assert.match(app, /const frontdeskPendingPanelsEnabled = false/);
  assert.match(app, /if \(!frontdeskPendingPanelsEnabled\)/);
  assert.match(app, /async function loadRoomTransferRequests/);
  assert.match(app, /function ensureDispatchReassignmentPanel/);
});

test('frontdesk preview grids wrap cards without clipping and stack on phones', () => {
  assert.match(css, /#frontdesk-view \.room-grid \{[^}]*grid-template-columns:repeat\(auto-fill,minmax\(170px,1fr\)/s);
  assert.match(css, /#frontdesk-view \.room-grid \{[^}]*max-height:none[^}]*overflow:visible/s);
  assert.match(css, /#frontdesk-view \.technician-list \{[^}]*grid-template-columns:repeat\(auto-fill,minmax\(150px,1fr\)/s);
  assert.match(css, /#frontdesk-view \.room-grid,\s*#frontdesk-view \.technician-list \{ grid-template-columns:1fr; \}/s);
  assert.match(css, /#frontdesk-view \.room \.room-beds \{[^}]*white-space:normal/s);
  assert.match(html, /空闲 <span id="idle-room-count">0<\/span> 间 · 余床 <span id="available-room-count">0<\/span> 位/);
});

test('room and technician action buttons keep a 44px touch target and readable type', () => {
  assert.match(css, /\.room-panel \.room-actions > button,\s*\.technician-panel \.tech-card-controls > \.tech-action,\s*\.technician-panel \.technician > \.tech-action\s*\{[^}]*min-height:44px;[^}]*font-size:14px;/s);
  assert.match(css, /#frontdesk-view \.page-actions button,\s*#frontdesk-view \.panel-heading button \{ min-height:44px; \}/);
  assert.match(css, /#frontdesk-view \.tech-card \{[^}]*align-items:stretch/s);
});

test('technician queue shows clocked-in and total technician counts', () => {
  assert.match(html, /已打卡\s*<b id="clocked-in-tech-count">/);
  assert.match(html, /共\s*<b id="total-tech-count">/);
  assert.match(app, /schedule\.clockedIn\|\|schedule\.legacyCompatible/);
  assert.match(app, /#clocked-in-tech-count/);
  assert.match(app, /#total-tech-count/);
});

test('existing cashier actions retain their original event routes', () => {
  assert.match(html, /id="current-order"[^>]*>开卡<\/button>/);
  assert.match(html, /id="new-order"[^>]*>结算<\/button>/);
  assert.match(app, /querySelector\('#current-order'\)\.addEventListener\('click',\(\)=>openMemberBusinessDialog\(\)\)/);
  assert.match(app, /querySelector\('#new-order'\)\.addEventListener\('click', \(\) => document\.querySelector\('#frontdesk-settlement-actions-dialog'\)\.showModal\(\)\)/);
  assert.match(app, /data-transfer-technician="\$\{roomTransferEscape\(room\.id\)\}"/);
  assert.match(app, /data-confirm-payment="\$\{roomTransferEscape\(room\.id\)\}"/);
  assert.match(app, /data-tech="\$\{roomTransferEscape\(tech\.id\)\}"/);
  assert.match(app, /if \(paid\) \{ await confirmRoomPayment/);
  assert.match(app, /await openParticipantTransfer\(room\.sessionId\)/);
  assert.match(app, /openClockOutConfirmation\(session, tech\)/);
});

test('cleaning room cards use the frontdesk yellow style and preserve actions', () => {
  assert.match(css, /#frontdesk-view \.room\.cleaning \{ background:#ca8a04; border-color:#ca8a04; color:#fff; \}/);
  assert.match(css, /#frontdesk-view \.room\.cleaning \.room-clean-action \{[^}]*background:#fff;[^}]*color:#ca8a04;/s);
  assert.match(css, /#frontdesk-view \.room\.cleaning \.room-status-action \{[^}]*background:rgba\(255,255,255,\.2\);[^}]*color:#fff;/s);
  assert.match(app, /room\.status === 'cleaning' && room\.apiId \? `<button class="room-clean-action" data-complete-cleaning=/);
});

test('room card details contain bed occupancy only, not historical status remarks', () => {
  assert.match(app, /const details = bedText;/);
  assert.match(app, /const bedText = `\$\{occupiedBedCount\}\/\$\{capacity\} 床已用 · 余 \$\{Math\.max\(0, capacity - occupiedBedCount\)\} 床`;/);
  assert.doesNotMatch(app, /const details = .*current\?\.reason/);
});
