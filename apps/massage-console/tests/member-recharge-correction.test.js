const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion:'latest' });
function fixture(role = 'STORE_MANAGER') {
  const dom = new JSDOM('<section class="member-profile-wallet-ledger"></section>', { runScripts:'dangerously', url:'http://localhost/' });
  const requests = [], notices = [], refreshes = [];
  const row = {id:'recharge', transactionType:'RECHARGE', businessDate:'2020-02-03', paymentMethod:'CASH', amountCents:10000, rechargeAmountCents:12000, correctionVersion:2};
  const profile = {member:{id:'member',name:'Test member'},transactions:[row]};
  Object.assign(dom.window, {
    adminRoles:()=>[role], isTenantAdmin:()=>role==='TENANT_ADMIN', hasAdminPermission:()=>true,
    activeMemberProfile:profile, paymentMethodLabel:{CASH:'Cash'}, memberCenterAmount:c=>(Number(c)/100).toFixed(2),
    state:{members:[{id:'member',balance:120}]}, storeContextHeaders:()=>({'X-Store-Id':'store'}),
    toast:message=>notices.push(message), renderMemberCard:()=>{},
    loadMemberCenter:async()=>refreshes.push('center'), openMemberProfile:async id=>refreshes.push(id),
    fetch:async(url,options)=>{
      requests.push({url,options});
      return {ok:true,status:200,json:async()=>options?.method==='PUT'
        ? {memberId:'member',balanceCents:15000}
        : [{code:'CASH',name:'Cash',methodKind:'EXTERNAL'}, {code:'ALIPAY',name:'Alipay',methodKind:'EXTERNAL'},
          {code:'MEMBER_BALANCE',name:'Balance',methodKind:'MEMBER_BALANCE'}, {code:'OLD',name:'Old',methodKind:'EXTERNAL',active:false}]};
    }
  });
  dom.window.HTMLDialogElement.prototype.showModal = function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close = function(){this.open=false;};
  const names = ['roomTransferEscape','memberWalletAttribution','canCorrectMemberRecharge','setupMemberRechargeCorrectionUi',
    'renderMemberRechargeHistory','openMemberRechargeCorrection','submitMemberRechargeCorrection'];
  dom.window.eval(names.map(name=>{const n=ast.body.find(n=>n.id?.name===name);assert.ok(n,name);return source.slice(n.start,n.end);}).join('\n'));
  dom.window.renderMemberRechargeHistory(profile);
  return {dom,window:dom.window,document:dom.window.document,profile,row,requests,notices,refreshes};
}

for (const role of ['STORE_MANAGER','TENANT_ADMIN']) test(`${role} sees correction action and corrected principal`, () => {
  const f=fixture(role);
  try { assert.ok(f.document.querySelector('[data-recharge-correct]')); assert.match(f.document.querySelector('#member-recharge-history').textContent,/120\.00/); }
  finally { f.dom.window.close(); }
});
test('cashier with member management permission neither sees nor opens correction', async () => {
  const f=fixture('CASHIER');
  try { assert.equal(f.document.querySelector('[data-recharge-correct]'),null); await f.window.openMemberRechargeCorrection('recharge'); assert.equal(f.requests.length,0); }
  finally { f.dom.window.close(); }
});

test('historical recharges outside the recent wallet ledger still open for correction', async () => {
  const f=fixture();
  try {
    f.profile.recharges=[f.row]; f.profile.transactions=[];
    f.window.renderMemberRechargeHistory(f.profile);
    assert.ok(f.document.querySelector('[data-recharge-correct]'));
    await f.window.openMemberRechargeCorrection(f.row.id);
    assert.equal(f.document.querySelector('form').elements.amount.value,'120.00');
    assert.equal(f.document.querySelector('dialog').open,true);
  } finally { f.dom.window.close(); }
});
test('refunded recharge is locked and untrusted values stay text', () => {
  const f=fixture(), attack='<img src=x onerror="window.injected=1">';
  try {
    Object.assign(f.row,{refundLocked:true,note:attack,paymentMethodNameSnapshot:attack});
    f.window.renderMemberRechargeHistory(f.profile);
    assert.equal(f.document.querySelector('[data-recharge-correct]').disabled,true);
    assert.equal(f.document.querySelector('img'),null);
    assert.ok(f.document.body.textContent.includes(attack));
  } finally { f.dom.window.close(); }
});
test('dialog submits exact cents, original record and version then refreshes member balance', async () => {
  const f=fixture();
  try {
    await f.window.openMemberRechargeCorrection('recharge');
    const form=f.document.querySelector('form');
    assert.equal(form.elements.amount.value,'120.00');
    assert.equal(form.elements.paymentMethod.options.length,3);
    assert.match(f.document.querySelector('#member-recharge-correction-context').textContent,/2020-02-03/);
    form.elements.amount.value='150.01'; form.elements.paymentMethod.value='ALIPAY'; form.elements.reason.value='  reviewed  ';
    await f.window.submitMemberRechargeCorrection({preventDefault(){},currentTarget:form});
    const sent=f.requests.at(-1);
    assert.match(sent.url,/members\/member\/recharges\/recharge\/correction$/);
    assert.deepEqual(JSON.parse(sent.options.body),{paymentMethod:'ALIPAY',amountCents:15001,reason:'reviewed',version:2});
    assert.deepEqual(f.refreshes,['center','member']);
    assert.equal(f.window.state.members[0].balance,150);
    assert.equal(f.document.querySelector('dialog').open,false);
  } finally { f.dom.window.close(); }
});
test('blank reason and invalid amount block submit; omitted amount stays optional', async () => {
  const f=fixture();
  try {
    await f.window.openMemberRechargeCorrection('recharge');
    const form=f.document.querySelector('form'), event={preventDefault(){},currentTarget:form};
    form.elements.reason.value='  '; await f.window.submitMemberRechargeCorrection(event); assert.equal(f.requests.length,1);
    form.elements.reason.value='review'; form.elements.amount.value='0'; await f.window.submitMemberRechargeCorrection(event); assert.equal(f.requests.length,1);
    form.elements.amount.value=''; await f.window.submitMemberRechargeCorrection(event);
    assert.equal(JSON.parse(f.requests.at(-1).options.body).amountCents,null);
  } finally { f.dom.window.close(); }
});
test('conflict retains edits and unlocks submit; store switch prevents wrong-store submission', async () => {
  const f=fixture();
  try {
    await f.window.openMemberRechargeCorrection('recharge');
    const form=f.document.querySelector('form'), event={preventDefault(){},currentTarget:form};
    form.elements.reason.value='review';
    f.window.fetch=async()=>({ok:false,status:409,json:async()=>({detail:'Insufficient wallet balance for this correction'})});
    await f.window.submitMemberRechargeCorrection(event);
    assert.equal(f.document.querySelector('dialog').open,true); assert.equal(form.querySelector('[type=submit]').disabled,false);
    assert.match(f.notices.at(-1),/余额不足/);
    f.window.storeContextHeaders=()=>({'X-Store-Id':'other'});
    await f.window.submitMemberRechargeCorrection(event); assert.match(f.notices.at(-1),/门店已切换/);
  } finally { f.dom.window.close(); }
});
