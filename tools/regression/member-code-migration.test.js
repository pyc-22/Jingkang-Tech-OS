const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {spawn,spawnSync} = require('node:child_process');
const root = path.resolve(__dirname,'../..');
const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/16/bin';
const migrations = path.join(root,'services/massage-api/src/main/resources/db/migration');
const maintenance = path.join(root,'tools/maintenance');
const tenant = '11111111-1111-1111-1111-111111111111';
const store = '22222222-2222-2222-2222-222222222222';
const second = '22222222-2222-2222-2222-222222222223';
const member = '88888888-8888-8888-8888-888888888881';
let dir,connection,port,started;

function command(tool,args,options={}) {
  const result=spawnSync(path.join(bin,tool+'.exe'),args,{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024,...options});
  assert.equal(result.status,0,`${tool}: ${result.error||''}\n${result.stdout}\n${result.stderr}`);
  return (result.stdout || '').trim();
}
function sql(input) { return command('psql',[...connection,'-Atq','-v','ON_ERROR_STOP=1'],{input}); }
function fileSql(file) { return fs.readFileSync(file,'utf8'); }
function migrate() { return sql('BEGIN;\n'+fileSql(path.join(migrations,'V101__member_store_codes.sql'))+'\nCOMMIT;'); }
function fails(input,pattern) {
  const result=spawnSync(path.join(bin,'psql.exe'),[...connection,'-Atq','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,pattern);
}
function concurrentSql(input) {
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(bin,'psql.exe'),[...connection,'-Atq','-v','ON_ERROR_STOP=1'],{windowsHide:true});
    let out='',err='';
    child.stdout.on('data',data=>out+=data);
    child.stderr.on('data',data=>err+=data);
    child.on('error',reject);
    child.on('exit',code=>code===0?resolve(out.trim()):reject(new Error(err)));
    child.stdin.end(input);
  });
}
function businessSnapshot() {
  const tables=sql("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('member','store','flyway_schema_history','member_code_backup','member_code_backup_run') ORDER BY tablename;").split(/\r?\n/);
  return tables.map(table=>[table,sql(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM "${table}" t;`)]);
}

test.before(async()=>{
  const server=net.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  dir=fs.mkdtempSync(path.join(root,'.artifacts/member-code-migration-'));
  command('initdb',['-D',path.join(dir,'pgdata'),'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C']);
  command('pg_ctl',['-D',path.join(dir,'pgdata'),'-l',path.join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start'],{stdio:'ignore'});
  started=true;
  command('createdb',['-h','127.0.0.1','-p',String(port),'-U','postgres','member_codes']);
  connection=['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','member_codes'];
  const scripts=fs.readdirSync(migrations).filter(name=>/^V\d+__/.test(name)&&Number(name.match(/^V(\d+)/)[1])<101)
    .sort((a,b)=>Number(a.match(/^V(\d+)/)[1])-Number(b.match(/^V(\d+)/)[1]));
  for(const script of scripts) sql('BEGIN;\n'+fileSql(path.join(migrations,script))+'\nCOMMIT;');
  sql(`CREATE TABLE flyway_schema_history(installed_rank integer,version varchar(50),success boolean);
    INSERT INTO flyway_schema_history VALUES(100,'100',true);
    UPDATE store SET created_at='2025-01-01' WHERE id='${store}';
    INSERT INTO store(id,tenant_id,code,name,created_at) VALUES('${second}','${tenant}','code-fixture','Second','2025-02-01');
    INSERT INTO member(id,tenant_id,registered_store_id,code,name,phone,created_at,active) VALUES
      ('${member}','${tenant}','${store}','A00002','Earlier','code-earlier','2025-03-01',true),
      ('88888888-8888-8888-8888-888888888882','${tenant}','${store}','A00001','Later','code-later','2025-04-01',false),
      ('88888888-8888-8888-8888-888888888883','${tenant}','${second}','M1788142647459','Other','code-other','2025-03-01',true);
    INSERT INTO member_wallet(id,tenant_id,opened_store_id,member_id,balance_cents)
      SELECT gen_random_uuid(),tenant_id,registered_store_id,id,5000 FROM member;
    INSERT INTO wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,business_date)
      SELECT gen_random_uuid(),tenant_id,opened_store_id,id,member_id,'RECHARGE',6000,0,6000,'FRONTDESK','2025-04-01'::date FROM member_wallet;
    INSERT INTO wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,business_date)
      SELECT gen_random_uuid(),tenant_id,opened_store_id,id,member_id,'CONSUMPTION',-1000,6000,5000,'FRONTDESK','2025-04-01'::date FROM member_wallet;
    INSERT INTO sales_order(id,tenant_id,store_id,member_id,order_no,status,receivable_cents,paid_cents,business_date)
      SELECT gen_random_uuid(),tenant_id,registered_store_id,id,phone,'SETTLED',1000,1000,'2025-04-01' FROM member;`);
});
test.after(()=>{if(started) command('pg_ctl',['-D',path.join(dir,'pgdata'),'-m','fast','-w','stop'],{stdio:'ignore'});});

test('historical migration requires a verified backup, preserves all business data and rolls back',()=>{
  const membersBefore=sql('SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM member m;');
  const businessBefore=businessSnapshot();
  const preflight=fileSql(path.join(maintenance,'check-member-codes.sql'));
  fails(preflight,/V101_NOT_READY: backup snapshot tables are missing/);
  fails('BEGIN;\n'+fileSql(path.join(migrations,'V101__member_store_codes.sql')),/Run backup-member-codes/);
  assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_name='store' AND column_name='member_code_prefix';"),'0');
  const backup=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',path.join(maintenance,'backup-member-codes.ps1'),
    '-Port',String(port),'-Database','member_codes','-BackupDirectory',path.join(dir,'backups'),'-PgBin',bin,'-ApplicationStopped'],
    {encoding:'utf8',windowsHide:true,timeout:120000,
      env:Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='psmodulepath'))});
  assert.equal(backup.status,0,backup.stdout+'\n'+backup.stderr);
  assert.match(backup.stdout,/member_codes/);
  assert.match(backup.stderr,/V101_BACKUP_READY/);
  sql(preflight);
  const dump=path.join(dir,'backups',fs.readdirSync(path.join(dir,'backups'))[0],'before-member-codes.dump');
  command('createdb',['-h','127.0.0.1','-p',String(port),'-U','postgres','restore_check']);
  command('pg_restore',['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','restore_check','--exit-on-error',dump]);
  assert.equal(command('psql',['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','restore_check','-Atqc','SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM member m;']),membersBefore);
  sql(`UPDATE member SET code='changed-after-backup' WHERE id='${member}';`);
  fails(preflight,/V101_NOT_READY: member data changed since backup/);
  fails('BEGIN;\n'+fileSql(path.join(migrations,'V101__member_store_codes.sql')),/Member data changed since backup/);
  sql(`UPDATE member SET code='A00002' WHERE id='${member}';`);
  migrate();
  sql("INSERT INTO flyway_schema_history VALUES(101,'101',true);");
  sql(preflight);
  assert.equal(sql('SELECT string_agg(code,\',\' ORDER BY id) FROM member;'),'A00001,A00002,B00001');
  assert.equal(sql(`SELECT member_code_next_number FROM store WHERE id='${store}';`),'3');
  assert.deepEqual(businessSnapshot(),businessBefore);
  assert.equal(sql("SELECT count(*) FROM sales_order o JOIN member m ON m.id=o.member_id WHERE m.code ~ '^[AB][0-9]{5}$';"),'3');
  const rollback=fileSql(path.join(maintenance,'rollback-member-codes.sql'));
  sql(rollback+'\nROLLBACK;');
  assert.equal(sql(`SELECT code FROM member WHERE id='${member}';`),'A00001');
  sql(`UPDATE member SET version=version+1 WHERE id='${member}';`);
  fails(rollback,/Member set or profile changed/);
  sql(`UPDATE member SET version=version-1 WHERE id='${member}';`);
  sql(rollback+'\nCOMMIT;');
  assert.equal(sql('SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM member m;'),membersBefore);
  assert.deepEqual(businessSnapshot(),businessBefore);
  migrate();
});

test('store creation serializes letters and allocation rollback keeps the next number',async()=>{
  const codes=await Promise.all([1,2].map(n=>concurrentSql(`BEGIN;
    INSERT INTO store(id,tenant_id,code,name) VALUES(gen_random_uuid(),'${tenant}','concurrent-${n}','Concurrent') RETURNING member_code_prefix;
    SELECT pg_sleep(0.15); COMMIT;`)));
  assert.deepEqual(codes.map(s=>s.trim()).sort(),['C','D']);
  const before=sql(`SELECT member_code_next_number FROM store WHERE id='${store}';`);
  fails(`BEGIN; UPDATE store SET member_code_next_number=member_code_next_number+1 WHERE id='${store}';
    INSERT INTO member(id,tenant_id,registered_store_id,code,name,phone) VALUES(gen_random_uuid(),'${tenant}','${store}','A00003','Duplicate phone','code-earlier');`,/member_tenant_phone_key/);
  assert.equal(sql(`SELECT member_code_next_number FROM store WHERE id='${store}';`),before);
});

test('store letters start at A for a new tenant and stop after Z',()=>{
  const otherTenant='11111111-1111-1111-1111-111111111112';
  sql(`INSERT INTO tenant(id,code,name) VALUES('${otherTenant}','code-limit','Code limit fixture');
    INSERT INTO store(id,tenant_id,code,name) VALUES(gen_random_uuid(),'${otherTenant}','first','First');`);
  assert.equal(sql(`SELECT member_code_prefix FROM store WHERE tenant_id='${otherTenant}';`),'A');
  for(let number=2;number<=26;number++) {
    assert.equal(sql(`INSERT INTO store(id,tenant_id,code,name) VALUES(gen_random_uuid(),'${otherTenant}','store-${number}','Limit fixture') RETURNING member_code_prefix;`),String.fromCharCode(64+number));
  }
  fails(`INSERT INTO store(id,tenant_id,code,name) VALUES(gen_random_uuid(),'${otherTenant}','overflow','Overflow');`,/at most 26 stores/);
  assert.equal(sql(`SELECT count(*) FROM store WHERE tenant_id='${otherTenant}';`),'26');
});
