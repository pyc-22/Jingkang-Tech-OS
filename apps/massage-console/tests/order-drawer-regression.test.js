const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const baseCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const settlementCss = fs.readFileSync(path.join(root, 'frontdesk-card-settlement.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('closing the order drawer releases the page and technician board', () => {
  assert.match(app, /document\.body\.classList\.toggle\('order-drawer-open', open\)/);
  assert.match(app, /panel\.hidden = !open/);
  assert.match(app, /backdrop\.hidden = !open/);
  assert.match(app, /panel\.style\.pointerEvents = open \? 'auto' : 'none'/);
  assert.match(app, /backdrop\.style\.zIndex = open \? '110' : ''/);
  assert.match(baseCss, /\.order-drawer-backdrop[^}]*pointer-events:none/);
  assert.match(baseCss, /\.order-panel\[hidden\], \.order-drawer-backdrop\[hidden\][^}]*display:none !important[^}]*pointer-events:none !important/);
  assert.match(settlementCss, /\.order-panel\.drawer-open[^}]*pointer-events:auto/);
  assert.match(html, /id="order-panel"[^>]*hidden/);
  assert.match(html, /id="order-drawer-backdrop"[^>]*hidden/);
});
