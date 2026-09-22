const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const runtime = process.env.REVIEW_RELEASE_DIR || root;
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java.exe') : 'java';
const jarPath = 'services/massage-api/target/massage-api-0.1.0.jar';
const jar = path.join(runtime, jarPath);
const verifier = path.join(root, 'tools/release/VerifyReleaseJar.java');
const release = '20260922-release-integrity-v3';
let dir;
test.before(() => { dir = fs.mkdtempSync(path.join(root, '.artifacts/release-integrity-')); });
test.after(() => fs.rmSync(dir, {recursive:true, force:true}));
function run(args) {
  return spawnSync(java, args, {encoding:'utf8',windowsHide:true,timeout:60000});
}
function verify(file = jar, expected = release) {
  return run(['--class-path', file, verifier, file, expected]);
}
test('executable JAR loads packaged ThrowableProxy and logs its cause with the Boot classloader', () => {
  const result = verify();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /RELEASE_JAR_OK/);
  assert.match(result.stdout, /Caused by: java.lang.RuntimeException: nested cause/);
});
test('stale release JAR fails even with complete libraries', () => {
  const result = verify(jar, 'stale-release');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Packaged release differs from source/);
});
for (const mode of ['missing-class','missing-library','compressed-libraries']) {
  test(`damaged JAR is rejected: ${mode}`, () => {
    const damaged = path.join(dir, mode+'.jar');
    const rewrite = run([path.join(__dirname,'CorruptReleaseJar.java'),jar,damaged,mode]);
    assert.equal(rewrite.status, 0, rewrite.stderr);
    const result = verify(damaged);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, mode === 'compressed-libraries' ? /Nested library must be STORED/ : /ch.qos.logback.classic.spi.ThrowableProxy/);
  });
}
test('truncated upload is rejected', () => {
  const file = path.join(dir,'truncated.jar');
  const bytes = fs.readFileSync(jar);
  fs.writeFileSync(file,bytes.subarray(0,bytes.length-128));
  assert.notEqual(verify(file).status,0);
});
test('Windows preflight checks release files and the actual installed JAR', () => {
  const fixture = path.join(dir,'package');
  fs.mkdirSync(path.join(fixture,path.dirname(jarPath)),{recursive:true});
  fs.copyFileSync(jar,path.join(fixture,jarPath));
  fs.writeFileSync(path.join(fixture,'release.json'),JSON.stringify({release}));
  fs.writeFileSync(path.join(fixture,'index.html'),'fixture');
  const files = [jarPath,'release.json','index.html'];
  fs.writeFileSync(path.join(fixture,'SHA256SUMS.txt'),files.map(file=>
    createHash('sha256').update(fs.readFileSync(path.join(fixture,file))).digest('hex')+'  '+file).join('\n'));
  const installed = path.join(dir,'installed.jar');
  fs.copyFileSync(jar,installed);
  const preflight = () => spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned',
    '-File',path.join(root,'tools/release/verify-release.ps1'),'-ReleaseDirectory',fixture,'-InstalledJar',installed,'-Java',java],
    {encoding:'utf8',windowsHide:true,timeout:60000,
      env:Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='psmodulepath'))});
  assert.equal(preflight().status,0);
  fs.appendFileSync(installed,'corrupted');
  const mismatch = preflight();
  assert.notEqual(mismatch.status,0);
  assert.match(mismatch.stderr,/Installed JAR differs/);
  fs.writeFileSync(path.join(fixture,'index.html'),'wrong frontend');
  const changed = preflight();
  assert.notEqual(changed.status,0);
  assert.match(changed.stderr,/Checksum mismatch: index.html/);
});
