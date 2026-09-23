const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');

module.exports = ({test,sql,api,ok,context}) => {
  const day='2025-07-03', otherDay='2025-07-04';
  async function open(amount=128800, bonus=0) {
    return ok(await api('/api/v1/members/open-card',{name:'Cleanup report fixture',phone:randomUUID().slice(0,24),
      amountCents:amount,bonusCents:bonus,paymentMethod:'CASH'}));
  }
  const cleanup = (member,token) => api(`/api/v1/members/${member.id}/clear-test-balance-and-archive`,{reason:'Regression test cleanup'},token);
  const report = async date => ok(await api(`/api/v1/daily-reports?date=${date}`));
  const memberSnapshot = id => sql(`SELECT jsonb_build_object('member',(SELECT to_jsonb(m) FROM member m WHERE id='${id}'),
    'wallet',(SELECT to_jsonb(w) FROM member_wallet w WHERE member_id='${id}'),
    'transactions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM wallet_transaction t WHERE member_id='${id}'));`);

  test('cleanup excludes historic corrected recharges, cards, gifts and channels but preserves normal members and report publication',async()=>{
    const {admin,manager,store}=context();
    const normal=await open(5000), member=await open(128800,2000);
    sql(`UPDATE wallet_transaction SET business_date='${day}',created_at='2025-07-03 10:00:00+08' WHERE member_id IN ('${normal.id}','${member.id}');`);
    ok(await api(`/api/v1/members/${member.id}/recharges`,{amountCents:9000,bonusCents:0,paymentMethod:'WECHAT'}));
    sql(`UPDATE wallet_transaction SET business_date='${otherDay}' WHERE member_id='${member.id}' AND amount_cents=9000;`);
    const recharge=sql(`SELECT id FROM wallet_transaction WHERE member_id='${member.id}' AND amount_cents=128800;`);
    ok(await api(`/api/v1/members/${member.id}/recharges/${recharge}/correction`,
      {paymentMethod:'ALIPAY',amountCents:130000,reason:'Correct historical principal',version:0},admin,{},'PUT'));
    let saved=ok(await api('/api/v1/daily-reports',{businessDate:day,incidentNote:'Keep handover',managerCount:2}));
    ok(await api(`/api/v1/daily-reports/${saved.report.id}/publish?version=${saved.report.version}`,{}));
    ok(await api('/api/v1/daily-reports',{businessDate:otherDay,incidentNote:'Keep second day'}));
    assert.equal((await report(day)).currentValues.dailyCardSaleCents,135000);
    const original=memberSnapshot(normal.id);
    const today=sql('SELECT current_date;');
    const todayBefore=(await report(today)).currentValues;
    assert.equal((await cleanup(member,manager)).status,403);
    ok(await cleanup(member,admin));
    const after=await report(day), second=await report(otherDay);
    assert.equal(after.currentValues.dailyCardSaleCents,5000);
    assert.equal(after.currentValues.dailyCardOpenCount,1);
    assert.equal(after.currentValues.dailyCardOpenCents,5000);
    assert.equal(after.unifiedMetrics.bonusAmountCents,0);
    assert.equal(after.report.dailyCardSaleCents,5000);
    assert.equal(after.report.dailyAlipayCents,0);
    assert.equal(after.report.status,'PUBLISHED');
    assert.equal(after.report.incidentNote,'Keep handover');
    assert.equal(after.report.managerCount,2);
    assert.equal(second.currentValues.dailyCardSaleCents,0);
    assert.equal(second.currentValues.dailyCardRenewCents,0);
    assert.equal(second.report.dailyCardSaleCents,0);
    assert.equal(second.monthly.cardSaleCents,5000);
    assert.equal(second.paymentChannels.find(c=>c.code==='WECHAT').rechargeCents,0);
    assert.deepEqual((await report(today)).currentValues,todayBefore);
    assert.equal(memberSnapshot(normal.id),original);
    assert.equal(sql(`SELECT active||':'||balance_cents FROM member m JOIN member_wallet w ON w.member_id=m.id WHERE m.id='${member.id}';`),'false:0');
    assert.equal(sql(`SELECT count(*) FROM wallet_transaction WHERE member_id='${member.id}' AND transaction_type='RECHARGE';`),'2');
    assert.equal(sql(`SELECT count(*) FROM member_cleanup_report_repair WHERE report_id='${saved.report.id}' AND before_data->>'daily_card_sale_cents'='135000' AND after_data->>'daily_card_sale_cents'='5000' AND actor_user_id IS NOT NULL;`),'1');
    assert.ok(!(ok(await api('/api/v1/members/center'))).some(m=>m.id===member.id));
    const ledger=ok(await api(`/api/v1/wallet-transactions?query=${member.phone}`));
    assert.equal(ledger.filter(t=>t.transactionType==='RECHARGE' && t.reportExcluded).length,2);
    assert.equal((await api(`/api/v1/members/${member.id}/recharges`,{amountCents:100,bonusCents:0,paymentMethod:'CASH'})).status,409);
    assert.equal((await api(`/api/v1/members/${member.id}/recharges/${recharge}/correction`,{paymentMethod:'CASH',reason:'Do not revive excluded recharge',version:1},admin,{},'PUT')).status,404);
    assert.equal((await api('/api/v1/member-recharge-refunds',{memberId:member.id,originalTransactionId:recharge,amountCents:100,reason:'Excluded recharge',requestKey:randomUUID()})).status,400);
    // An explicit, existing reactivation action may create new legitimate business; old excluded rows stay excluded.
    ok(await api('/api/v1/members/open-card',{name:member.name,phone:member.phone,amountCents:3000,bonusCents:0,paymentMethod:'CASH'}));
    assert.equal((await report(day)).currentValues.dailyCardSaleCents,5000);
    assert.equal((await report(today)).currentValues.dailyCardSaleCents,todayBefore.dailyCardSaleCents+3000);
    assert.equal(sql(`SELECT count(*) FROM wallet_transaction WHERE member_id='${member.id}' AND transaction_type='RECHARGE' AND report_excluded;`),'2');
  });

  test('ordinary archival retains legitimate recharge history and purge retains its no-business guard',async()=>{
    const member=await open(7000);
    sql(`UPDATE wallet_transaction SET business_date='2025-07-08' WHERE member_id='${member.id}';
      INSERT INTO wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,business_date)
      SELECT gen_random_uuid(),tenant_id,opened_store_id,id,member_id,'ADJUSTMENT',-7000,7000,0,'FIXTURE','2025-07-08' FROM member_wallet WHERE member_id='${member.id}';
      UPDATE member_wallet SET balance_cents=0 WHERE member_id='${member.id}';`);
    ok(await api(`/api/v1/members/${member.id}`,undefined,undefined,{},'DELETE'));
    assert.equal((await report('2025-07-08')).currentValues.dailyCardSaleCents,7000);
    assert.equal((await api(`/api/v1/members/${member.id}/purge`,undefined,undefined,{},'DELETE')).status,409);
    const empty=await open(0);
    const before=(await report('2025-07-08')).currentValues;
    ok(await api(`/api/v1/members/${empty.id}/purge`,undefined,undefined,{},'DELETE'));
    assert.equal(sql(`SELECT count(*) FROM member WHERE id='${empty.id}';`),'0');
    assert.deepEqual((await report('2025-07-08')).currentValues,before);
  });

  test('report repair failure rolls back cleanup, exclusions, balances and audit together',async()=>{
    const member=await open(4000);
    sql(`UPDATE wallet_transaction SET business_date='2025-07-10' WHERE member_id='${member.id}';`);
    const saved=ok(await api('/api/v1/daily-reports',{businessDate:'2025-07-10'}));
    const before=memberSnapshot(member.id);
    sql(`CREATE FUNCTION fail_cleanup_repair() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture repair failure'; END $$;
      CREATE TRIGGER fail_cleanup_repair BEFORE INSERT ON member_cleanup_report_repair FOR EACH ROW EXECUTE FUNCTION fail_cleanup_repair();`);
    try {
      assert.equal((await cleanup(member)).status,500);
      assert.equal(memberSnapshot(member.id),before);
      assert.equal(sql(`SELECT daily_card_sale_cents FROM daily_operating_report WHERE id='${saved.report.id}';`),'4000');
      assert.equal(sql(`SELECT count(*) FROM audit_log WHERE entity_id='${member.id}' AND action='MEMBER_TEST_BALANCE_CLEARED_AND_DEACTIVATED' AND result='SUCCESS';`),'0');
    } finally { sql('DROP TRIGGER fail_cleanup_repair ON member_cleanup_report_repair; DROP FUNCTION fail_cleanup_repair();'); }
    ok(await cleanup(member));
  });

  test('cleanup refreshes every affected store date and preserves other-store normal recharges',async()=>{
    const {tenant,store}=context();
    const other=randomUUID(), member=await open(1000), normal=await open(2000);
    sql(`INSERT INTO store(id,tenant_id,code,name) VALUES('${other}','${tenant}','cleanup-${other.slice(0,8)}','Cleanup other store');
      UPDATE wallet_transaction SET business_date='2025-07-12' WHERE member_id IN ('${member.id}','${normal.id}');
      UPDATE wallet_transaction SET store_id='${other}' WHERE member_id='${normal.id}';
      INSERT INTO wallet_transaction(id,tenant_id,store_id,wallet_id,member_id,transaction_type,amount_cents,balance_before_cents,balance_after_cents,source,payment_method,business_date,recharge_id)
      SELECT gen_random_uuid(),tenant_id,'${other}',id,member_id,'RECHARGE',3000,1000,4000,'FRONTDESK','CASH','2025-07-12',null FROM member_wallet WHERE member_id='${member.id}';
      UPDATE member_wallet SET balance_cents=4000 WHERE member_id='${member.id}';`);
    ok(await api('/api/v1/daily-reports',{businessDate:'2025-07-12'}));
    ok(await api('/api/v1/daily-reports',{businessDate:'2025-07-12'},undefined,{'X-Store-Id':other}));
    const before=memberSnapshot(normal.id);
    ok(await cleanup(member));
    assert.equal((await report('2025-07-12')).currentValues.dailyCardSaleCents,0);
    const second=ok(await api('/api/v1/daily-reports?date=2025-07-12',undefined,undefined,{'X-Store-Id':other}));
    assert.equal(second.currentValues.dailyCardSaleCents,2000);
    assert.equal(second.report.dailyCardSaleCents,2000);
    assert.equal(memberSnapshot(normal.id),before);
    assert.equal(sql(`SELECT daily_card_sale_cents FROM daily_operating_report WHERE store_id='${store}' AND business_date='2025-07-12';`),'0');
  });
};
