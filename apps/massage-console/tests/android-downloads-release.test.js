const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const apks = ['apps/massage-console/downloads/jingkang-technician.apk', 'apps/massage-console/downloads/jingkang-manager.apk'];
const powershell = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'pwsh';
const releaseFiles = ['apps/massage-console/downloads/index.html', 'apps/massage-console/downloads/downloads.css',
  ...apks, 'server.massage.js', 'deploy/nginx/massage-platform.conf', 'docs/android-downloads-fix.md'];
const qualityDocs = ['fix-batch1.md', 'fix-batch2.md', 'fix-batch3.md', 'final-fix-review.md', 'release-quality-v10.md'];

function fixture(t, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jingkang-download-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = [...releaseFiles, 'services/massage-api/target/massage-api-0.1.0.jar',
    'services/massage-api/src/main/resources/logback-spring.xml', 'tools/maintenance/inspect_data_quality.sql',
    'docs/releases/20260918-member-recharge-correction-v1.md',
    'docs/releases/20260918-expense-workspace-v1.md',
    'docs/releases/20260919-expense-sync-fix-v1.md',
    'docs/releases/20260922-member-codes-technician-ui-v1.md',
    'tools/maintenance/backup-member-codes.ps1', 'tools/maintenance/backup-member-codes.sql',
    'tools/maintenance/rollback-member-codes.sql',
    ...qualityDocs.map(name => `docs/reviews/2026-09-16/${name}`), 'tools/release/' + script];
  for (const file of files) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (file.endsWith('.ps1')) fs.copyFileSync(path.join(root, file), target);
    else fs.writeFileSync(target, `fixture ${file}`);
  }
  const home = path.join(dir, 'services/massage-api/src/main/java/com/chengxin/massage/HomeController.java');
  fs.mkdirSync(path.dirname(home), { recursive: true });
  fs.writeFileSync(home, 'RELEASE = "fixture-release"');
  fs.writeFileSync(path.join(dir, '.gitignore'), '*.apk\n');
  for (const args of [['init', '--quiet'], ['add', '.gitignore', 'apps/massage-console/downloads/index.html']]) {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  // rev-parse HEAD in the quality packager requires a source commit; identity is fixture-local.
  const commit = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture'], { cwd: dir, encoding: 'utf8' });
  assert.equal(commit.status, 0, commit.stderr);
  return dir;
}

function run(dir, script) {
  // Let Windows PowerShell discover its own modules when tests run from PowerShell 7.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
  return spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', path.join(dir, 'tools/release', script)],
    { cwd: dir, env, encoding: 'utf8', timeout: 60000 });
}

for (const script of ['package-android-downloads.ps1', 'package-quality-release.ps1']) {
  test(`${script}: package includes both ignored APKs and checksums`, { skip: process.platform !== 'win32' }, t => {
    const dir = fixture(t, script);
    fs.writeFileSync(path.join(dir, 'apps/massage-console/downloads/private-export.txt'), 'must stay out');
    const result = run(dir, script);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const version = script === 'package-quality-release.ps1' ? 'fixture-release' : '20260918-android-downloads-v1';
    const output = path.join(dir, '.artifacts/releases', version);
    assert.ok(fs.statSync(`${output}.zip`).size > 0);
    const manifest = fs.readFileSync(path.join(output, 'SHA256SUMS.txt'), 'utf8');
    for (const apk of apks) {
      assert.deepEqual(fs.readFileSync(path.join(output, apk)), fs.readFileSync(path.join(dir, apk)));
      assert.ok(manifest.includes(apk));
    }
    if (script === 'package-quality-release.ps1') {
      for (const file of ['backup-member-codes.ps1','backup-member-codes.sql','rollback-member-codes.sql']) {
        assert.ok(manifest.includes('tools/maintenance/'+file));
      }
    }
    assert.equal(fs.existsSync(path.join(output, 'apps/massage-console/downloads/private-export.txt')), false);
    const repeat = run(dir, script);
    assert.notEqual(repeat.status, 0);
    assert.match(repeat.stderr, /Output already exists/);
  });

  test(`${script}: missing or empty APK aborts before any release is produced`, { skip: process.platform !== 'win32' }, t => {
    const dir = fixture(t, script);
    fs.unlinkSync(path.join(dir, apks[1]));
    const missing = run(dir, script);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /missing or empty/);
    assert.equal(fs.existsSync(path.join(dir, '.artifacts/releases')), false);
    fs.writeFileSync(path.join(dir, apks[1]), '');
    const empty = run(dir, script);
    assert.notEqual(empty.status, 0);
    assert.match(empty.stderr, /missing or empty/);
    assert.equal(fs.existsSync(path.join(dir, '.artifacts/releases')), false);
  });
}
