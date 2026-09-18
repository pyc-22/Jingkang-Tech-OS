const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '../../..');
const names = ['jingkang-technician.apk', 'jingkang-manager.apk'];
const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36';
let temp, child, base;
// Transport fixtures only; installation/signature checks use the actual release APKs.
const bytes = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(128 * 1024, 42)]);

test.before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'jingkang-downloads-'));
  await fs.cp(path.join(root, 'server.massage.js'), path.join(temp, 'server.massage.js'));
  const downloads = path.join(temp, 'apps/massage-console/downloads');
  await fs.mkdir(downloads, { recursive: true });
  for (const name of ['index.html', 'downloads.css']) {
    await fs.copyFile(path.join(root, 'apps/massage-console/downloads', name), path.join(downloads, name));
  }
  for (const name of names) await fs.writeFile(path.join(downloads, name), bytes);
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(temp, 'server.massage.js')], {
    env: { ...process.env, MASSAGE_ADDRESS: '127.0.0.1', MASSAGE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Static server startup timed out')), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Static server exited: ${code}`)); });
    child.stdout.on('data', data => {
      if (data.toString().includes('Massage console:')) { clearTimeout(timer); resolve(); }
    });
  });
});

test.after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  if (temp) await fs.rm(temp, { recursive: true, force: true });
});

test('download buttons resolve to both same-origin APKs with explicit filenames', async () => {
  const response = await fetch(`${base}/downloads/index.html`, { headers: { 'User-Agent': android } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-disposition'), null);
  const dom = new JSDOM(await response.text(), { url: `${base}/downloads/index.html` });
  try {
    const links = [...dom.window.document.querySelectorAll('a[download]')];
    assert.equal(links.length, 2);
    for (const [index, link] of links.entries()) {
      const url = new URL(link.href);
      assert.equal(url.origin, base);
      assert.equal(url.pathname, `/downloads/${names[index]}`);
      assert.equal(link.download, names[index]);
      assert.equal(url.searchParams.get('v'), '20260918-android-downloads-v1');
    }
  } finally { dom.window.close(); }
});

for (const name of names) {
  test(`${name}: Android GET and HEAD return attachment metadata and exact bytes`, async () => {
    for (const suffix of ['', '?v=20260918-android-downloads-v1']) {
      const url = `${base}/downloads/${name}${suffix}`;
      for (const method of ['HEAD', 'GET']) {
        const response = await fetch(url, { method, headers: { 'User-Agent': android } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'application/vnd.android.package-archive');
        assert.equal(response.headers.get('content-disposition'), `attachment; filename="${name}"`);
        assert.equal(response.headers.get('content-length'), String(bytes.length));
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), method === 'GET' ? bytes : Buffer.alloc(0));
      }
    }
  });
}

test('missing APK stays a 404 and never downloads HTML under an APK filename', async () => {
  const response = await fetch(`${base}/downloads/missing.apk`);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('content-disposition'), null);
  assert.equal(await response.text(), 'Not found');
});

test('Nginx download route preserves URI and upstream MIME/attachment headers without cache', async () => {
  const config = await fs.readFile(path.join(root, 'deploy/nginx/massage-platform.conf'), 'utf8');
  const location = config.match(/location \^~ \/downloads\/ \{([^}]+)\}/)?.[1];
  assert.ok(location);
  assert.match(location, /proxy_pass http:\/\/127\.0\.0\.1:5174;/);
  assert.match(location, /proxy_cache off;/);
  assert.match(location, /expires off;/);
  assert.doesNotMatch(location, /proxy_hide_header|Content-Disposition|Content-Type|Access-Control-Allow-Origin/i);
});
