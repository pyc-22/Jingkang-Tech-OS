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

test('room cards wrap with a stable minimum width and bounded scrolling area', () => {
  assert.match(css, /\.room-panel \.room-grid \{[^}]*grid-template-columns:repeat\(auto-fill,minmax\(150px,1fr\)/s);
  assert.match(css, /\.room-panel \.room-grid \{[^}]*max-height:430px[^}]*overflow-y:auto/s);
  assert.match(css, /\.room-panel \.room \{ min-width:150px/);
});

test('room and technician action buttons keep a 44px touch target and readable type', () => {
  assert.match(css, /\.room-panel \.room-actions > button,\s*\.technician-panel \.tech-card-controls > \.tech-action,\s*\.technician-panel \.technician > \.tech-action\s*\{[^}]*min-height:44px;[^}]*font-size:14px;/s);
});

test('technician queue shows clocked-in and total technician counts', () => {
  assert.match(html, /已打卡\s*<b id="clocked-in-tech-count">/);
  assert.match(html, /共\s*<b id="total-tech-count">/);
  assert.match(app, /schedule\.clockedIn\|\|schedule\.legacyCompatible/);
  assert.match(app, /#clocked-in-tech-count/);
  assert.match(app, /#total-tech-count/);
});
