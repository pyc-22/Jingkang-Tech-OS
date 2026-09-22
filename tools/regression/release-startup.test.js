const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {once} = require('node:events');
const {spawn,spawnSync} = require('node:child_process');
const root = path.resolve(__dirname,'../..');
const runtime = process.env.REVIEW_RELEASE_DIR || root;
const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/16/bin';
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME,'bin/java.exe') : 'java';
const jar = path.join(runtime,'services/massage-api/target/massage-api-0.1.0.jar');
const tenant = '11111111-1111-1111-1111-111111111111';
const store = '22222222-2222-2222-2222-222222222222';
let dir,connection,pgPort,apiPort,started,app,sequence=0;
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
function command(tool,args,options={}) {
  const result=spawnSync(path.join(bin,tool+'.exe'),args,{encoding:'utf8',windowsHide:true,timeout:120000,...options});
  assert.equal(result.status,0,`${tool}: ${result.error||''}\n${result.stderr}`);
  return (result.stdout || '').trim();
}
function sql(input) { return command('psql',[...connection,'-Atq','-v','ON_ERROR_STOP=1'],{input}); }
async function freePort() {
  const server=net.createServer();
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
async function stop() {
  if(app && app.exitCode===null && app.pid) {const exited=once(app,'exit');app.kill();await exited;}
}
async function start(extra=[],expectHealthy=true) {
  const logFile=path.join(dir,`startup-${++sequence}.log`);
  const log=fs.openSync(logFile,'a');
  const socketDir=path.join(process.env.SystemDrive || 'C:','/tmp/jdsock');
  fs.mkdirSync(socketDir,{recursive:true});
  app=spawn(java,[`-Djdk.net.unixdomain.tmpdir=${socketDir}`,'-jar',jar,...extra],{cwd:dir,windowsHide:true,stdio:['ignore',log,log],
    env:{...process.env,MASSAGE_DB_URL:`jdbc:postgresql://127.0.0.1:${pgPort}/release_startup`,
      MASSAGE_DB_USER:'massage_app',MASSAGE_DB_PASSWORD:'',MASSAGE_API_ADDRESS:'127.0.0.1',MASSAGE_API_PORT:String(apiPort)}});
  fs.closeSync(log);
  let error,health;
  app.on('error',value=>{error=value;});
  for(let n=0;n<160;n++) {
    if(error || app.exitCode!==null) break;
    try {health=await (await fetch(`http://127.0.0.1:${apiPort}/api/health`,{signal:AbortSignal.timeout(1000)})).json();} catch {}
    if(health?.status==='UP') break;
    await delay(250);
  }
  const text=fs.readFileSync(logFile,'utf8');
  if(expectHealthy) {
    assert.equal(health?.status,'UP',`${error||''}\n${text.slice(-6000)}`);
    assert.equal(health.release,'20260922-member-backup-permissions-v4');
  } else {
    assert.ok(app.exitCode!==null && app.exitCode!==0,`Expected failed startup\n${text.slice(-6000)}`);
  }
  assert.doesNotMatch(text,/NoClassDefFoundError|ClassNotFoundException|Failed to instantiate.*Logger/);
  return text;
}
test.before(async()=>{
  pgPort=await freePort();apiPort=await freePort();
  dir=fs.mkdtempSync(path.join(root,'.artifacts/release-startup-'));
  command('initdb',['-D',path.join(dir,'pgdata'),'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C']);
  command('pg_ctl',['-D',path.join(dir,'pgdata'),'-l',path.join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${pgPort}`,'-w','start'],{stdio:'ignore'});
  started=true;
  command('createdb',['-h','127.0.0.1','-p',String(pgPort),'-U','postgres','release_startup']);
  connection=['-X','-h','127.0.0.1','-p',String(pgPort),'-U','postgres','-d','release_startup'];
  sql('CREATE ROLE massage_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; ALTER DATABASE release_startup OWNER TO massage_app;');
});
test.after(async()=>{
  try {await stop();} finally {if(started) command('pg_ctl',['-D',path.join(dir,'pgdata'),'-m','fast','-w','stop']);}
});
test('restricted-role Boot startup rejects missing backup privileges, upgrades V101 and restarts after cross-account backup',async()=>{
  await start(['--spring.flyway.target=100']);
  await stop();
  assert.equal(sql("SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1;"),'100');
  sql(`INSERT INTO member(id,tenant_id,registered_store_id,code,name,phone,created_at) VALUES
    ('88888888-8888-8888-8888-888888888881','${tenant}','${store}','M1788142647459','Earlier','release-earlier','2025-01-01'),
    ('88888888-8888-8888-8888-888888888882','${tenant}','${store}','M1788142647460','Later','release-later','2025-02-01');
    INSERT INTO member_wallet(id,tenant_id,opened_store_id,member_id,balance_cents)
      SELECT gen_random_uuid(),tenant_id,registered_store_id,id,5000 FROM member;
    INSERT INTO wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,business_date)
      SELECT gen_random_uuid(),tenant_id,opened_store_id,id,member_id,'RECHARGE',5000,0,5000,'FRONTDESK','2025-01-01' FROM member_wallet;
    INSERT INTO sales_order(id,tenant_id,store_id,member_id,order_no,status,receivable_cents,paid_cents,business_date)
      SELECT gen_random_uuid(),tenant_id,registered_store_id,id,phone,'DRAFT',1000,0,'2025-01-01' FROM member;`);
  const snapshot=()=>['member_wallet','wallet_transaction','sales_order'].map(table=>sql(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM ${table} t;`));
  const before=snapshot();
  const failure=await start([],false);
  assert.match(failure,/Run backup-member-codes.ps1/);
  assert.match(failure,/Application run failed/);
  assert.equal(sql("SELECT max(version::int) FROM flyway_schema_history WHERE success;"),'100');
  const backup=()=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',
    path.join(runtime,'tools/maintenance/backup-member-codes.ps1'),'-Port',String(pgPort),'-Database','release_startup','-MigrationUser','massage_app',
    '-BackupDirectory',path.join(dir,'backup'),'-PgBin',bin,'-ApplicationStopped'],{encoding:'utf8',windowsHide:true,timeout:120000,
      env:Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='psmodulepath'))});
  const firstBackup=backup();
  assert.equal(firstBackup.status,0,firstBackup.stderr+'\n'+firstBackup.stdout);
  assert.match(firstBackup.stdout,/massage_app/);
  assert.match(firstBackup.stderr,/V101_BACKUP_READY/);
  assert.equal(sql("SELECT rolsuper OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname='massage_app';"),'f');
  assert.equal(sql("SELECT string_agg(tableowner,',' ORDER BY tablename) FROM pg_tables WHERE tablename IN ('member_code_backup','member_code_backup_run');"),'postgres,postgres');
  const preflight=()=>spawnSync(path.join(bin,'psql.exe'),['-X','-h','127.0.0.1','-p',String(pgPort),'-U','massage_app',
    '-d','release_startup','-v','ON_ERROR_STOP=1','-f',path.join(runtime,'tools/maintenance/check-member-codes.sql')],
    {encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(preflight().status,0);
  assert.equal(sql(`SELECT has_table_privilege('massage_app','member_code_backup','INSERT')
    OR has_table_privilege('massage_app','member_code_backup','DELETE')
    OR has_column_privilege('massage_app','member_code_backup','old_code','UPDATE')
    OR has_table_privilege('massage_app','member_code_backup_run','UPDATE');`),'f');
  sql('REVOKE UPDATE (migrated_code) ON member_code_backup FROM massage_app;');
  const missingUpdate=preflight();
  assert.notEqual(missingUpdate.status,0);
  assert.match(missingUpdate.stderr,/V101_NOT_READY:.*backup table privileges/);
  const updateFailure=await start([],false);
  assert.match(updateFailure,/permission denied for table member_code_backup/);
  assert.equal(sql("SELECT max(version::int) FROM flyway_schema_history WHERE success;"),'100');
  assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_name='store' AND column_name='member_code_prefix';"),'0');
  assert.equal(sql("SELECT count(*) FROM member WHERE code LIKE 'M%';"),'2');
  assert.deepEqual(snapshot(),before);
  sql('REVOKE SELECT ON member_code_backup_run, member_code_backup FROM massage_app;');
  const missingSelect=preflight();
  assert.notEqual(missingSelect.status,0);
  assert.match(missingSelect.stderr,/V101_NOT_READY:.*backup table privileges/);
  const selectFailure=await start([],false);
  assert.match(selectFailure,/permission denied for table member_code_backup_run/);
  const refreshedBackup=backup();
  assert.equal(refreshedBackup.status,0,refreshedBackup.stderr+'\n'+refreshedBackup.stdout);
  assert.equal(preflight().status,0);
  await start();
  assert.equal(sql("SELECT max(version::int) FROM flyway_schema_history WHERE success;"),'101');
  assert.equal(sql("SELECT string_agg(code,',' ORDER BY created_at,id) FROM member;"),'A00001,A00002');
  assert.deepEqual(snapshot(),before);
  assert.equal(sql('SELECT count(*) FROM member_code_backup WHERE migrated_code IS NOT NULL;'),'2');
  await stop();
  await start();
  assert.equal(sql("SELECT count(*) FROM flyway_schema_history WHERE version='101' AND success;"),'1');
  assert.deepEqual(snapshot(),before);
});
