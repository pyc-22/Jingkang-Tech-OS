const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manager = fs.readFileSync(path.join(root, 'manager-mobile.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'manager-mobile.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'manager-mobile.css'), 'utf8');

test('manager dispatch dialog exposes the front desk clock types and required selectors', () => {
  assert.match(html, /id="manager-open-dispatch"/);
  assert.match(html, /id="manager-clock-dialog"/);
  assert.match(html, /id="manager-clock-type"[\s\S]*QUEUE[\s\S]*CALL[\s\S]*SELECTED[\s\S]*BOOKED_QUEUE[\s\S]*BOOKED_CALL/);
  assert.match(html, /id="manager-clock-room"/);
  assert.match(html, /id="manager-clock-service"/);
  assert.match(html, /id="manager-clock-tech-list"/);
  assert.match(html, /id="manager-clock-allocation"/);
});

test('manager loads shared eligibility, queue and live data and offers both entry points', () => {
  assert.match(manager, /managerOptionalJson\('\/technician-schedules\/clock-eligibility'/);
  assert.match(manager, /managerOptionalJson\('\/technician-queue'/);
  assert.match(manager, /managerOptionalJson\('\/operations\/live-room-status'/);
  assert.match(manager, /managerOptionalJson\('\/operations\/live-technician-status'/);
  assert.match(manager, /data-manager-clock-room/);
  assert.match(manager, /data-manager-clock-tech/);
  assert.match(manager, /manager-live-room-list.*openManagerClockDialog|openManagerClockDialog.*manager-live-room-list/);
  assert.match(manager, /manager-live-technician-groups.*openManagerClockDialog|openManagerClockDialog.*manager-live-technician-groups/);
});

test('manager submits the same immediate and reservation payload routes as front desk', () => {
  assert.match(manager, /service-sessions\/clock-in/);
  assert.match(manager, /service-reservations/);
  assert.match(manager, /participants/);
  assert.match(manager, /allocationBp/);
  assert.match(manager, /plannedDurationMinutes:duration/);
  assert.match(manager, /reservationType:clockType/);
  assert.match(manager, /selected\.length!==1/);
  assert.match(manager, /participants\.reduce\(\(sum,item\)=>sum\+item\.allocationBp,0\)!==10000/);
});

test('manager dispatch styling keeps the compact prototype card and picker treatment', () => {
  assert.match(css, /\.manager-clock-dialog-card/);
  assert.match(css, /\.manager-clock-tech-choice\.selected/);
  assert.match(css, /\.manager-clock-allocation/);
  assert.match(css, /\.manager-live-arrange-button/);
});
