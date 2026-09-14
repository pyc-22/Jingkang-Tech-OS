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
  assert.match(html, /id="manager-clock-duration"[^>]*name="duration"[^>]*min="15"[^>]*max="360"[^>]*step="5"/);
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
  assert.match(manager, /const duration=Number\(form\.get\('duration'\)\)/);
  assert.match(manager, /Number\.isInteger\(duration\).*duration<15.*duration>360/);
  assert.match(manager, /durationInput\.value=Number\(selectedService\?\.defaultDurationMinutes\|\|0\)/);
  assert.match(manager, /manager-clock-service.*addEventListener\('change'/);
  assert.match(manager, /reservationType:clockType/);
  assert.match(manager, /selected\.length!==1/);
  assert.match(manager, /participants\.reduce\(\(sum,item\)=>sum\+item\.allocationBp,0\)!==10000/);
  assert.match(manager, /const submit=event\.currentTarget\.querySelector\('button\[type="submit"\]'\);\s*submit\.disabled=true/);
  assert.match(manager, /finally\{submit\.disabled=false;\}/);
});

test('manager opens reservation registration when all eligible technicians are busy', () => {
  assert.match(manager, /const immediateEligibleTechnicians=managerClockEligibleTechnicians\(false\)\.length;\s*const reservationEligibleTechnicians=managerClockEligibleTechnicians\(true\)\.length;\s*if\(!immediateEligibleTechnicians&&!reservationEligibleTechnicians\)return managerToast/);
  assert.match(manager, /managerClockEligibleTechnicians\(true\)/);
  assert.match(manager, /document\.querySelector\('#manager-clock-type'\)\.addEventListener\('change'/);
});

test('manager dispatch styling keeps the compact prototype card and picker treatment', () => {
  assert.match(css, /\.manager-clock-dialog-card/);
  assert.match(css, /\.manager-clock-tech-choice\.selected/);
  assert.match(css, /\.manager-clock-allocation/);
  assert.match(css, /\.manager-live-arrange-button/);
});

test('manager can add an extension from an in-service room record using the front-desk route', () => {
  assert.match(manager, /data-manager-extension-session/);
  assert.match(manager, /openManagerExtension\(extension\.dataset\.managerExtensionSession/);
  assert.match(manager, /service-sessions\/\$\{sessionId\}\/extensions/);
  assert.match(manager, /service-duration-policy/);
  assert.match(manager, /serviceDurationMaxMinutes/);
  assert.match(manager, /allowsExtension===true/);
  assert.match(manager, /manager-live-service-action/);
  assert.match(css, /\.manager-extension-dialog-card/);
});

test('manager refreshes the active session before opening extension and preserves technician ownership', () => {
  assert.match(manager, /filter\(item=>String\(item\.serviceSessionId\|\|''\)===String\(service\.serviceSessionId\|\|''\)&&item\.status==='IN_SERVICE'\)/);
  assert.match(manager, /servingTechnicians\.map\(technician=>/);
  assert.match(manager, /managerJson\('\/service-sessions\?status=IN_SERVICE'\)/);
  assert.match(manager, /managerActiveSessions=sessions\|\|\[\]/);
  assert.match(manager, /const session=managerActiveSessions\.find\(item=>String\(item\.id\)===String\(sessionId\)\)/);
  assert.match(manager, /data-manager-extension-tech="\$\{managerEscape\(technician\.technicianId\)\}"/);
});

test('manager extension actions catch async failures and clear stale state', () => {
  assert.match(manager, /submitManagerExtension\(event\)\.catch\(handleManagerExtensionFailure\)/);
  assert.match(manager, /openManagerExtension\(extension\.dataset\.managerExtensionSession,extension\.dataset\.managerExtensionTech\)\.catch\(handleManagerExtensionFailure\)/);
  assert.match(manager, /function resetManagerExtensionState\(\{close=false\}=\{\}\)/);
  assert.match(manager, /managerExtensionRequestToken\+=1/);
  assert.match(manager, /if\(requestToken!==managerExtensionRequestToken\)return/);
  assert.match(manager, /该技师已不在服务中，请刷新后重试/);
  assert.match(manager, /managerExtensionSessionId=null/);
  assert.match(manager, /managerExtensionTechnicianId=null/);
  assert.match(manager, /resetManagerExtensionState\(\{close:true\}\)/);
  assert.match(css, /\.manager-live-service-actions/);
});

test('manager extension refresh reports stale dashboard state without overwriting a newer action', () => {
  assert.match(manager, /const postResetToken=managerExtensionRequestToken/);
  assert.match(manager, /const refreshed=await loadManagerDashboard\(\{manual:false\}\)/);
  assert.match(manager, /refreshed===true\?`\$\{result\.serviceName\} 已加钟，新的结束时间已同步`/);
  assert.match(manager, /if\(requestToken!==managerExtensionRequestToken\)return;\s+throw error;/);
  assert.match(manager, /finally\{if\(requestToken===managerExtensionRequestToken\)submit\.disabled=false;\}/);
  assert.match(manager, /if\(managerLoading\) return null/);
  assert.match(manager, /return true;[\s\S]*?return false;/);
});
