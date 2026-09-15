const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('manual service dialog captures clock type, duration, optional room and technician allocations', () => {
  assert.match(html, /id="manual-service-config-dialog"/);
  assert.match(html, /name="clockType"/);
  assert.match(html, /name="duration"[^>]*min="15"[^>]*max="360"/);
  assert.match(html, /name="roomId"/);
  assert.match(html, /id="manual-service-add-technician"/);
  assert.match(app, /data-manual-technician/);
  assert.match(app, /data-manual-allocation/);
  assert.match(app, /allocationBp:\s*Math\.round/);
  assert.match(app, /new Set\(manualServiceDraft\.technicians\.map/);
  assert.match(css, /\.manual-service-technician-row/);
});

test('manual service metadata is retained on the order and submitted through the settlement contract', () => {
  assert.match(app, /manualService:\s*\{\s*clockType:/);
  assert.match(app, /clockType:item\.manualService\?\.clockType\|\|null/);
  assert.match(app, /roomId:item\.manualService\?\.roomId\|\|null/);
  assert.match(app, /technicians:item\.manualService\?\.technicians\|\|null/);
  assert.match(app, /fetch\('http:\/\/localhost:8080\/api\/v1\/sales-orders\/settle'/);
});
