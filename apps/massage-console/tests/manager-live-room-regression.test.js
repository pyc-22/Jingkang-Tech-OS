const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manager = fs.readFileSync(path.join(root, 'manager-mobile.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'manager-mobile.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'manager-mobile.css'), 'utf8');

test('manager home loads and renders live room details', () => {
  assert.match(manager, /managerOptionalJson\('\/operations\/live-room-status',\[\]\)/);
  assert.match(manager, /renderManagerLiveRooms\(liveRooms\)/);
  assert.match(html, /id="manager-live-room-list"/);
  assert.match(html, /id="manager-live-room-summary"/);
});

test('live rooms expose service, technician, clock type, beds and timing', () => {
  assert.match(manager, /service\.serviceNameSnapshot/);
  assert.match(manager, /service\.technicianDisplay/);
  assert.match(manager, /managerClockTypeLabel\[service\.clockType\]/);
  assert.match(manager, /service\.startedAt/);
  assert.match(manager, /service\.expectedEndAt/);
  assert.match(manager, /service\.serviceStatus==='IN_SERVICE'/);
  assert.match(manager, /room\.occupiedBedCount/);
  assert.match(manager, /room\.availableBedCount/);
  assert.match(css, /\.manager-live-room\.IN_SERVICE/);
  assert.match(css, /\.manager-live-service/);
});

test('manager mobile assets use the daily report sync cache version', () => {
  assert.match(html, /manager-mobile\.css\?v=20260903-manager-daily-report-sync-v1/);
  assert.match(html, /manager-mobile\.js\?v=20260903-manager-daily-report-sync-v1/);
});

test('manager home loads and groups independent live technician status', () => {
  assert.match(manager, /managerOptionalJson\('\/operations\/live-technician-status'/);
  assert.match(manager, /renderManagerLiveTechnicians\(liveTechnicians\)/);
  assert.match(manager, /\['PENDING_ACCEPTANCE','ACCEPTED'\]\.includes\(item\.status\)/);
  assert.match(manager, /item\.status==='IN_SERVICE'/);
  assert.match(manager, /item\.status==='IDLE'/);
  assert.match(manager, /technician\.queuePosition/);
  assert.match(manager, /technician\.roomCode/);
  assert.match(manager, /technician\.serviceNameSnapshot/);
  assert.match(manager, /technician\.startedAt/);
  assert.match(manager, /technician\.expectedEndAt/);
  assert.match(html, /id="manager-live-technician-groups"/);
  assert.match(html, /id="manager-live-technician-attention"/);
  assert.match(css, /\.manager-live-technician\.IN_SERVICE/);
  assert.match(css, /\.manager-technician-status\.PENDING_ACCEPTANCE/);
});

test('manager bottom navigation uses clear business categories', () => {
  assert.match(html, /data-manager-nav="home"[^>]*title="首页"[^>]*>[\s\S]*?<b>首页<\/b>/);
  assert.match(html, /data-manager-nav="business"[^>]*title="营业数据"[^>]*>[\s\S]*?<b>营业<\/b>/);
  assert.match(html, /data-manager-nav="commission"[^>]*title="技师提成"[^>]*>[\s\S]*?<b>技师<\/b>/);
  assert.match(html, /data-manager-nav="expense"[^>]*title="费用报销"[^>]*>[\s\S]*?<b>费用<\/b>/);
  assert.match(html, /data-manager-nav="more"[^>]*title="门店管理"[^>]*>[\s\S]*?<b>管理<\/b>/);
  assert.equal((html.match(/data-manager-nav="/g)||[]).length,5);
});

test('manager expense errors replace the generic server message with Chinese guidance', () => {
  assert.match(manager, /message==='Internal Server Error'\?'服务器处理报销资料失败，请刷新后重试':message/);
});

test('manager home keeps a clear operational reading order', () => {
  const metricsIndex = html.indexOf('class="manager-metrics"');
  const operationIndex = html.indexOf('id="manager-operation-section"');
  const attentionIndex = html.indexOf('class="manager-section attention-section manager-home-attention"');
  const shortcutsIndex = html.indexOf('class="manager-home-shortcuts-section"');
  assert.ok(metricsIndex >= 0 && operationIndex > metricsIndex);
  assert.ok(attentionIndex > operationIndex);
  assert.ok(shortcutsIndex > attentionIndex);
  assert.match(html, /class="manager-home-shortcuts-section"[^>]*data-manager-page-panel="home"/);
  assert.match(css, /\.manager-home-shortcuts-section \{/);
});
