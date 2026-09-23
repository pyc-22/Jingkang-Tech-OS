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
let dir,connection,pgPort,apiPort,started,app,sequence=0,database='release_startup';
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
    env:{...process.env,MASSAGE_DB_URL:`jdbc:postgresql://127.0.0.1:${pgPort}/${database}`,
      MASSAGE_DB_USER:'massage_app',MASSAGE_DB_PASSWORD:'',MASSAGE_API_ADDRESS:'127.0.0.1',MASSAGE_API_PORT:String(apiPort)}});
  fs.closeSync(log);
  let error,health;
  app.on('error',value=>{error=value;});
  for(let n=0;n<160;n++) {
    if(error || app.exitCode!==null) break;
    try {health=await (await fetch(`http://127.0.0.1:${apiPort}/api/health`,{signal:AbortSignal.timeout(1000)})).json();} catch {}
    if(expectHealthy && health?.status==='UP' && (extra.some(arg=>arg.startsWith('--spring.flyway.target='))
      || fs.readFileSync(logFile,'utf8').includes('Member cleanup report repair checked'))) break;
    await delay(250);
  }
  const text=fs.readFileSync(logFile,'utf8');
  if(expectHealthy) {
    assert.equal(health?.status,'UP',`${error||''}\n${text.slice(-6000)}`);
    assert.equal(health.release,'20260923-member-cleanup-reports-v1');
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
  const snapshot=()=>['member_wallet','wallet_transaction','sales_order'].map(table=>sql(`SELECT jsonb_agg(to_jsonb(t)-'report_excluded' ORDER BY id) FROM ${table} t;`));
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
  assert.equal(sql("SELECT max(version::int) FROM flyway_schema_history WHERE success;"),'102');
  assert.equal(sql("SELECT string_agg(code,',' ORDER BY created_at,id) FROM member;"),'A00001,A00002');
  assert.deepEqual(snapshot(),before);
  assert.equal(sql('SELECT count(*) FROM member_code_backup WHERE migrated_code IS NOT NULL;'),'2');
  await stop();
  await start();
  assert.equal(sql("SELECT count(*) FROM flyway_schema_history WHERE version='101' AND success;"),'1');
  assert.deepEqual(snapshot(),before);
});

test('V102 automatically repairs cleared historical reports without restoring members or changing posted business, and is restart-idempotent',async()=>{
  await stop();
  database='cleanup_history';
  command('createdb',['-h','127.0.0.1','-p',String(pgPort),'-U','postgres','-O','massage_app',database]);
  connection[connection.length-1]=database;
  await start(['--spring.flyway.target=101']);
  await stop();
  const other='22222222-2222-2222-2222-222222222223';
  const member=n=>`88888888-8888-8888-8888-88888888888${n}`;
  sql(`INSERT INTO store(id,tenant_id,code,name) VALUES('${other}','${tenant}','cleanup-other','Other fixture');
    INSERT INTO member(id,tenant_id,registered_store_id,code,name,phone,active,created_at)
      SELECT ('88888888-8888-8888-8888-88888888888'||n)::uuid,'${tenant}','${store}','A0000'||n,
        'Historical cleanup '||n,'cleanup-history-'||n,n NOT IN (1,3),'2025-05-01' FROM generate_series(1,5) n;
    INSERT INTO member_wallet(id,tenant_id,opened_store_id,member_id,balance_cents)
      SELECT id,tenant_id,registered_store_id,id,CASE WHEN id IN ('${member(1)}','${member(3)}') THEN 0 ELSE 3000 END FROM member;
    INSERT INTO wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,payment_method,business_date,created_at,recharge_id)
      SELECT id,tenant_id,registered_store_id,id,id,'RECHARGE',
        CASE code WHEN 'A00001' THEN 128800 WHEN 'A00002' THEN 5000 WHEN 'A00003' THEN 7000 WHEN 'A00004' THEN 8000 ELSE 6000 END,
        0,CASE code WHEN 'A00001' THEN 128800 WHEN 'A00002' THEN 5000 WHEN 'A00003' THEN 7000 WHEN 'A00004' THEN 8000 ELSE 6000 END,
        'FRONTDESK','CASH','2025-05-03','2025-05-03 10:00:00+08',id FROM member;
    INSERT INTO wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,business_date,created_at,recharge_id)
      VALUES(gen_random_uuid(),'${tenant}','${store}','${member(1)}','${member(1)}','BONUS',2000,128800,130800,'FRONTDESK','2025-05-03','2025-05-03 10:00:01+08','${member(1)}');
    INSERT INTO wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,payment_method,business_date,created_at)
      VALUES(gen_random_uuid(),'${tenant}','${other}','${member(1)}','${member(1)}','RECHARGE',2200,130800,133000,'FRONTDESK','WECHAT','2025-05-03','2025-05-03 12:00:00+08'),
        (gen_random_uuid(),'${tenant}','${store}','${member(1)}','${member(1)}','ADJUSTMENT',-133000,133000,0,'ADMIN_TEST_CLEANUP',null,'2025-05-05','2025-05-05 10:00:00+08'),
        (gen_random_uuid(),'${tenant}','${store}','${member(4)}','${member(4)}','RECHARGE',3000,0,3000,'FRONTDESK','CASH','2025-05-04','2025-05-04 12:00:00+08');
    INSERT INTO audit_log(id,tenant_id,store_id,entity_type,entity_id,action,result,created_at) VALUES
      (gen_random_uuid(),'${tenant}','${store}','member','${member(4)}','MEMBER_TEST_BALANCE_CLEARED_AND_DEACTIVATED','SUCCESS','2025-05-04 10:00:00+08'),
      (gen_random_uuid(),'${tenant}','${store}','member','${member(3)}','MEMBER_DEACTIVATED','SUCCESS','2025-05-04 10:00:00+08'),
      (gen_random_uuid(),'${tenant}','${store}','member','${member(5)}','MEMBER_TEST_BALANCE_CLEARED_AND_DEACTIVATED','FAILED','2025-05-04 10:00:00+08'),
      (gen_random_uuid(),'${tenant}','${other}','member',gen_random_uuid(),'MEMBER_PURGED','SUCCESS','2025-05-07 10:00:00+08');
    INSERT INTO member_recharge_refund(id,tenant_id,store_id,member_id,original_transaction_id,refund_no,request_key,status,amount_cents,reason,requested_by_name_snapshot,business_date)
      VALUES(gen_random_uuid(),'${tenant}','${store}','${member(4)}','${member(4)}','cleanup-refund','cleanup-refund','COMPLETED',1000,'Fixture','Fixture','2025-05-05');
    INSERT INTO wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,payment_method,note,business_date,created_at)
      VALUES(gen_random_uuid(),'${tenant}','${store}','${member(4)}','${member(4)}','ADJUSTMENT',-1000,1000,0,'RECHARGE_REFUND','CASH','cleanup-refund','2025-05-05','2025-05-05 12:00:00+08');
    INSERT INTO daily_operating_report(id,tenant_id,store_id,business_date,status,daily_cash_flow_cents,daily_card_sale_cents,daily_card_open_cents,daily_card_renew_cents,daily_card_cancellation_cents,daily_cash_cents,incident_note,manager_count,published_at)
      VALUES(gen_random_uuid(),'${tenant}','${store}','2025-05-03','PUBLISHED',154800,154800,154800,0,0,154800,'Keep published handover',2,'2025-05-04'),
        (gen_random_uuid(),'${tenant}','${store}','2025-05-04','SAVED',3000,3000,0,3000,0,3000,'Keep renewal note',1,null),
        (gen_random_uuid(),'${tenant}','${store}','2025-05-05','PUBLISHED',0,0,0,0,1000,0,'Keep refund note',1,'2025-05-06'),
        (gen_random_uuid(),'${tenant}','${other}','2025-05-03','SAVED',2200,2200,2200,0,0,0,'Keep other store note',1,null),
        (gen_random_uuid(),'${tenant}','${other}','2025-05-06','SAVED',100,100,100,0,0,100,'Purged stale snapshot',1,null),
        (gen_random_uuid(),'${tenant}','${store}','2025-05-07','SAVED',0,0,0,0,0,0,'Untouched normal report',1,null);`);
  const snapshot=()=>['member','member_wallet','wallet_transaction','member_recharge_refund','audit_log','sales_order'].map(table=>
    sql(`SELECT jsonb_agg(to_jsonb(t)-'report_excluded' ORDER BY id) FROM ${table} t;`));
  const before=snapshot();
  const untouched=sql("SELECT to_jsonb(r) FROM daily_operating_report r WHERE business_date='2025-05-07';");
  const dump=path.join(dir,'before-v102.dump');
  command('pg_dump',[...connection.filter(arg=>arg!=='-X'),'--format=custom',`--file=${dump}`]);
  command('createdb',['-h','127.0.0.1','-p',String(pgPort),'-U','postgres','cleanup_restore']);
  command('pg_restore',['-h','127.0.0.1','-p',String(pgPort),'-U','postgres','-d','cleanup_restore','--exit-on-error',dump]);
  assert.equal(command('psql',['-X','-h','127.0.0.1','-p',String(pgPort),'-U','postgres','-d','cleanup_restore','-Atqc','SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM member t;']),before[0]);
  await start();
  assert.deepEqual(snapshot(),before);
  assert.equal(sql("SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1;"),'102');
  assert.equal(sql(`SELECT daily_card_sale_cents||':'||daily_cash_cents||':'||status||':'||incident_note FROM daily_operating_report WHERE store_id='${store}' AND business_date='2025-05-03';`),'18000:18000:PUBLISHED:Keep published handover');
  assert.equal(sql(`SELECT daily_card_open_cents||':'||daily_card_renew_cents FROM daily_operating_report WHERE store_id='${store}' AND business_date='2025-05-04';`),'3000:0');
  assert.equal(sql(`SELECT daily_card_cancellation_cents FROM daily_operating_report WHERE store_id='${store}' AND business_date='2025-05-05';`),'0');
  assert.equal(sql(`SELECT sum(daily_card_sale_cents) FROM daily_operating_report WHERE store_id='${other}';`),'100');
  assert.equal(sql("SELECT count(*) FROM member_cleanup_report_repair;"),'4');
  assert.equal(sql("SELECT to_jsonb(r) FROM daily_operating_report r WHERE business_date='2025-05-07';"),untouched);
  assert.equal(sql(`SELECT count(*) FROM reporting_wallet_transaction WHERE member_id='${member(4)}';`),'1');
  const repaired=sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM daily_operating_report r;');
  await stop();
  await start();
  assert.equal(sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM daily_operating_report r;'),repaired);
  assert.equal(sql("SELECT count(*) FROM member_cleanup_report_repair;"),'4');
  assert.deepEqual(snapshot(),before);
});
