const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = ({test,sql,api,ok,context}) => {
  test('member codes allocate consecutive values for concurrent create and open-card requests', async () => {
    const {store} = context();
    const [prefix,next] = sql(`SELECT member_code_prefix,member_code_next_number FROM store WHERE id='${store}';`).split('|');
    const results = await Promise.all([
      api('/api/v1/members', {name:'Code fixture',phone:randomUUID().slice(0,20)}),
      api('/api/v1/members/open-card', {name:'Code fixture',phone:randomUUID().slice(0,20),amountCents:0,bonusCents:0})
    ]);
    const members = results.map(result => ok(result));
    assert.deepEqual(members.map(m => m.code).sort(), [0,1].map(n => prefix+String(Number(next)+n).padStart(5,'0')));
    for (const member of members) {
      assert.equal(ok(await api(`/api/v1/members?query=${member.code}`))[0].id, member.id);
      assert.equal(ok(await api(`/api/v1/members/${member.id}/profile`)).member.code, member.code);
    }
  });

  test('a new store receives the next letter and its own number sequence', async () => {
    const {tenant} = context();
    const id = randomUUID();
    const next = Number(sql(`SELECT max(ascii(member_code_prefix))+1 FROM store WHERE tenant_id='${tenant}';`));
    sql(`INSERT INTO store(id,tenant_id,code,name) VALUES('${id}','${tenant}','${id}','Member code store');`);
    assert.equal(sql(`SELECT member_code_prefix,member_code_next_number FROM store WHERE id='${id}';`), String.fromCharCode(next)+'|1');
    const created = ok(await api('/api/v1/members', {name:'Second store member',phone:randomUUID().slice(0,20)}, undefined, {'X-Store-Id':id}));
    assert.equal(created.code, String.fromCharCode(next)+'00001');
  });

  test('member allocation permits the last five-digit value and stops at exhaustion', async () => {
    const {tenant} = context();
    const id = randomUUID();
    sql(`INSERT INTO store(id,tenant_id,code,name) VALUES('${id}','${tenant}','${id}','Limit fixture');
      UPDATE store SET member_code_next_number=99999 WHERE id='${id}';`);
    const create = () => api('/api/v1/members', {name:'Limit fixture',phone:randomUUID().slice(0,20)}, undefined, {'X-Store-Id':id});
    const last = ok(await create());
    assert.match(last.code, /^[A-Z]99999$/);
    assert.equal((await create()).status,409);
    assert.equal(sql(`SELECT count(*) FROM member WHERE registered_store_id='${id}';`),'1');
  });
};
