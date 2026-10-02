const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(app, name), 'utf8');
const version = '20260927-remove-login-bg-v1';

test('all three login pages use the image-free portal stylesheet', () => {
  const css = read('login-portal.css');
  assert.doesNotMatch(css, /url\s*\(/i);
  assert.equal(fs.existsSync(path.join(app, 'assets/jingkang-login-background.png')), false);
  for (const name of ['index.html', 'mobile.html', 'manager-mobile.html', 'mobile.css', 'mobile.js', 'login-portal.css']) {
    assert.doesNotMatch(read(name), /jingkang-login-background\.png/i, name);
  }
  for (const name of ['index.html', 'mobile.html', 'manager-mobile.html']) {
    assert.ok(read(name).includes(`login-portal.css?v=${version}`), name);
  }
});

test('technician service worker and page use matching updated asset versions', () => {
  const appVersion = '20261001-manager-ownership-conversion-v2';
  assert.ok(read('mobile.html').includes(`mobile.js?v=${appVersion}`));
  assert.ok(read('mobile.js').includes(`technician-service-worker.js?v=${appVersion}`));
  const worker = read('technician-service-worker.js');
  assert.ok(worker.includes(`jingkang-technician-${appVersion}`));
  assert.ok(worker.includes(`login-portal.css?v=\${PORTAL_VERSION}`));
});
