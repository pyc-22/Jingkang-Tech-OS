const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

test('double rooms render one independent countdown row per technician participant', () => {
  assert.match(app, /const services = roomList\.flatMap\(item =>/);
  assert.match(app, /const participantIds = sessionParticipantIds\(item\)/);
  assert.match(app, /technicianName: technician\?\.name \|\| fallbackNames\[index\]/);
  assert.match(app, /service\.expectedEndAt/);
  assert.match(app, /data-room-countdown="\$\{service\.expectedEndAt\}"/);
  assert.match(app, /class="room-services"/);
  assert.match(styles, /\.room-service-row/);
});

test('receipt duration remains sourced from the settled order line', () => {
  assert.match(app, /line\.durationMinutes\}分/);
  assert.match(app, /line\.durationMinutes \|\| 0\}分/);
  assert.match(app, /duration: `\$\{session\.plannedDurationMinutes\} 分钟`/);
});
