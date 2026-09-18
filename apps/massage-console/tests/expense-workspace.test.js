const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');
const ExpenseUI = require('../expense-ui');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function functions(source, names) {
  const nodes = acorn.parse(source, {ecmaVersion:'latest'}).body;
  return names.map(name => {
    const node = nodes.filter(n => n.type === 'FunctionDeclaration' && n.id.name === name).at(-1);
    assert.ok(node, name); return source.slice(node.start, node.end);
  }).join('\n');
}
function dom(html) {
  const result = new JSDOM(read(html), {runScripts:'outside-only', url:'http://localhost/'});
  result.window.HTMLDialogElement.prototype.showModal = function(){this.open=true;};
  result.window.HTMLDialogElement.prototype.close = function(){this.open=false;};
  result.window.HTMLElement.prototype.scrollIntoView = function(){};
  return result;
}
const summary = {claimCount:45,effectiveAmountCents:123400,pendingCount:30,approvedCount:10,paidCount:5,approvedAmountCents:1000,paidAmountCents:500};
const rows = Array.from({length:45}, (_,i) => ({id:String(i),claimNo:`E${i}`,categoryName:'Supplies',amountCents:100,status:'SUBMITTED',submittedAt:'2026-09-18T03:00:00Z'}));
function mobile(saved) {
  const d = dom('manager-mobile.html'), w=d.window, requests=[], notices=[];
  if(saved)w.localStorage.setItem('manager-expense-filters',JSON.stringify(saved));
  Object.assign(w,{ExpenseUI,managerApi:'/api/v1',managerHasPermission:()=>true,managerEscape:escape,managerExpenseEscape:escape,
    managerExpenseMoney:n=>`¥${(n/100).toFixed(2)}`,managerExpenseStatusLabel:{SUBMITTED:'待审核'},managerExpenseCategories:[{}],
    managerStoreHeaders:()=>({'X-Store-Id':'store'}),managerToast:m=>notices.push(m),
    managerJson:async url=>{requests.push(url);const p=Number(new URL(url,'http://localhost').searchParams.get('page'));return {items:rows.slice(p*20,p*20+20),total:45,summary};}});
  const source=read('manager-mobile.js');
  w.eval(functions(source,['renderManagerExpenseSummary','renderManagerExpenseList'])+'\n'+source.slice(source.indexOf('let managerExpenseRows='),source.indexOf('if(localStorage.getItem(managerTokenKey))')));
  return {d,w,requests,notices};
}
function finance() {
  const d=dom('index.html'),w=d.window,requests=[],notices=[];
  Object.assign(w,{ExpenseUI,hasAdminPermission:()=>true,toast:m=>notices.push(m),adminHeaders:()=>({Authorization:'Bearer fixture'}),adminJsonHeaders:()=>({}),
    financeExpenseCategories:[{id:'category',name:'Supplies'}],roomTransferEscape:escape,
    fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({items:rows.slice(0,20),total:45,summary,stores:[{id:'store',name:'Store'}]})};}});
  const source=read('app.js');
  w.eval(source.slice(source.indexOf('let financeClaims='),source.indexOf('function renderFinanceStoreFilter'))+'\n'+functions(source,['renderFinanceClaims','loadFinanceClaims'])+'\nwindow.expenseFixture={clear:()=>financeSelected.clear(),rows:rows=>{financeClaims=rows;renderFinanceClaims(rows);}};');
  return {d,w,requests,notices};
}

test('expense dates use China day and inclusive thirty-day, week and month boundaries',()=>{
  const now=new Date('2026-03-01T16:30:00Z');
  assert.deepEqual(ExpenseUI.range('today',now),{from:'2026-03-02',to:'2026-03-02'});
  assert.deepEqual(ExpenseUI.range('recent',now),{from:'2026-02-01',to:'2026-03-02'});
  assert.deepEqual(ExpenseUI.range('week',now),{from:'2026-03-02',to:'2026-03-02'});
  assert.deepEqual(ExpenseUI.range('month',now),{from:'2026-03-01',to:'2026-03-02'});
  assert.deepEqual(ExpenseUI.range('last-month',now),{from:'2026-02-01',to:'2026-02-28'});
});
test('manager restores filters and shows full summary while loading twenty rows',async()=>{
  const f=mobile({from:'2026-09-01',to:'2026-09-18',status:'SUBMITTED'});
  try{
    await f.w.loadManagerExpenses();
    assert.equal(f.d.window.document.querySelectorAll('.expense-card').length,20);
    assert.equal(f.d.window.document.querySelector('#manager-expense-visible-amount').textContent,'1234.00');
    assert.match(f.requests[0],/from=2026-09-01.*status=SUBMITTED.*page=0&size=20/);
    assert.equal(f.d.window.document.querySelector('[data-expense-status=SUBMITTED]').getAttribute('aria-pressed'),'true');
  }finally{f.d.window.close();}
});
test('manager appends pages, preserves scroll data on background refresh and finishes at total',async()=>{
  const f=mobile();try{
    await f.w.loadManagerExpenses();await f.w.loadManagerExpenses(true);await f.w.loadManagerExpenses(false,true);
    assert.equal(f.requests.length,2);assert.equal(f.w.document.querySelectorAll('.expense-card').length,40);
    await f.w.loadManagerExpenses(true);
    assert.equal(f.w.document.querySelector('#manager-expense-progress').textContent,'已加载 45 条 / 共 45 条');
    assert.equal(f.w.document.querySelector('#manager-expense-more').hidden,true);
  }finally{f.d.window.close();}
});
test('manager rejects reversed dates and persists changed status',async()=>{
  const f=mobile();try{
    await f.w.loadManagerExpenses();
    f.w.document.querySelector('#manager-expense-from').value='2099-01-01';
    await f.w.loadManagerExpenses();assert.equal(f.requests.length,1);assert.match(f.notices.at(-1),/开始日期/);
    f.w.document.querySelector('#manager-expense-from').value='2026-01-01';
    f.w.document.querySelector('[data-expense-status=PAID]').click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(JSON.parse(f.w.localStorage.getItem('manager-expense-filters')).status,'PAID');
    assert.match(f.requests.at(-1),/status=PAID.*page=0/);
  }finally{f.d.window.close();}
});
test('manager ignores an older response after a newer filter response',async()=>{
  const f=mobile();try{
    const pending=[];f.w.managerJson=()=>new Promise(resolve=>pending.push(resolve));
    const first=f.w.loadManagerExpenses(),second=f.w.loadManagerExpenses();
    pending[1]({items:[rows[1]],total:1,summary});await second;
    pending[0]({items:rows,total:45,summary});await first;
    assert.equal(f.w.document.querySelectorAll('.expense-card').length,1);
    assert.match(f.w.document.querySelector('#manager-expense-list').textContent,/E1/);
  }finally{f.d.window.close();}
});
test('untrusted expense values render as text on both clients',()=>{
  const m=mobile(),f=finance(),attack='<img src=x onerror="alert(1)">';try{
    const row={...rows[0],categoryName:attack,claimNo:attack,storeName:attack,applicantName:attack};
    m.w.renderManagerExpenseList([row]);f.w.renderFinanceClaims([row]);
    for(const [fixture,id]of [[m,'manager-expense-list'],[f,'finance-claim-records']]){
      assert.equal(fixture.w.document.getElementById(id).querySelector('img'),null);
      assert.ok(fixture.w.document.getElementById(id).textContent.includes(attack));
    }
  }finally{m.d.window.close();f.d.window.close();}
});
test('invalid date changes invalidate in-flight results on both clients',async()=>{
  const m=mobile(),f=finance();try{
    let resolveMobile,resolveFinance;
    m.w.managerJson=()=>new Promise(resolve=>{resolveMobile=resolve;});
    f.w.fetch=()=>new Promise(resolve=>{resolveFinance=resolve;});
    const mobilePending=m.w.loadManagerExpenses(),financePending=f.w.loadFinanceClaims();
    m.w.document.querySelector('#manager-expense-from').value='2099-01-01';
    f.w.document.querySelector('#finance-claims-from').value='2099-01-01';
    await m.w.loadManagerExpenses();await f.w.loadFinanceClaims();
    resolveMobile({items:rows,total:45,summary});
    resolveFinance({ok:true,json:async()=>({items:rows,total:45,summary,stores:[]})});
    await mobilePending;await financePending;
    assert.equal(m.w.document.querySelectorAll('.expense-card').length,0);
    assert.equal(f.w.document.querySelectorAll('[data-finance-select]').length,0);
    assert.equal(m.w.document.querySelector('#manager-expense-more').disabled,false);
  }finally{m.d.window.close();f.d.window.close();}
});
test('finance sends all filters, uses full summary and sorts with pagination reset',async()=>{
  const f=finance();try{
    await f.w.loadFinanceClaims();
    const doc=f.w.document;doc.querySelector('#finance-applicant-filter').value='Alice';doc.querySelector('#finance-category-filter').value='category';
    doc.querySelector('#finance-store-filter').value='store';
    doc.querySelector('[data-finance-sort=amount]').click();await new Promise(resolve=>setImmediate(resolve));
    const params=new URL(f.requests.at(-1).url).searchParams;
    assert.equal(params.get('applicant'),'Alice');assert.equal(params.get('categoryId'),'category');assert.equal(params.get('storeId'),'store');
    assert.equal(params.get('sort'),'amount');assert.equal(params.get('direction'),'desc');assert.equal(params.get('page'),'0');
    assert.equal(doc.querySelector('#finance-record-count').textContent,'45');
    doc.querySelector('[data-finance-sort=amount]').click();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(new URL(f.requests.at(-1).url).searchParams.get('direction'),'asc');
  }finally{f.d.window.close();}
});
test('finance batch freezes selected IDs, requires comment and submits once',async()=>{
  const f=finance();try{
    await f.w.loadFinanceClaims();f.w.document.querySelector('#finance-select-all').click();f.w.openFinanceBatch('APPROVED');
    const form=f.w.document.querySelector('#finance-batch-form'),event={preventDefault(){},currentTarget:form};
    await f.w.submitFinanceBatch(event);assert.equal(f.requests.length,1);
    f.w.expenseFixture.clear();form.elements.comment.value='  reviewed  ';
    await f.w.submitFinanceBatch(event);
    const request=f.requests.find(r=>r.options?.method==='POST'),body=JSON.parse(request.options.body);
    assert.equal(body.ids.length,20);assert.equal(body.comment,'reviewed');assert.equal(body.action,'APPROVED');
    assert.equal(f.w.document.querySelector('#finance-batch-dialog').open,false);
    assert.equal(form.querySelector('[type=submit]').disabled,false);
  }finally{f.d.window.close();}
});
test('finance select-all excludes non-pending claims and conflict keeps the review dialog',async()=>{
  const f=finance();try{
    f.w.expenseFixture.rows([rows[0],{...rows[1],status:'PAID'}]);
    f.w.document.querySelector('#finance-select-all').click();f.w.openFinanceBatch('REJECTED');
    assert.equal(f.w.document.querySelectorAll('[data-finance-select]').length,1);
    f.w.fetch=async()=>({ok:false,status:409,json:async()=>({message:'Already reviewed'})});
    const form=f.w.document.querySelector('#finance-batch-form');form.elements.comment.value='Rejected';
    await f.w.submitFinanceBatch({preventDefault(){},currentTarget:form});
    assert.equal(f.w.document.querySelector('#finance-batch-dialog').open,true);assert.equal(f.notices.at(-1),'Already reviewed');
  }finally{f.d.window.close();}
});
test('both export buttons send current filters without page limits',async()=>{
  const m=mobile(),f=finance(),exports=[];try{
    const helper={...ExpenseUI,download:async(url,headers)=>exports.push({url,headers})};m.w.ExpenseUI=helper;f.w.ExpenseUI=helper;
    await m.w.loadManagerExpenses();await f.w.loadFinanceClaims();
    m.w.document.querySelector('#manager-expense-export').click();f.w.document.querySelector('#finance-claims-export').click();
    await new Promise(resolve=>setImmediate(resolve));assert.equal(exports.length,2);
    for(const item of exports){const url=new URL(item.url,'http://localhost');assert.match(url.pathname,/\/export$/);assert.ok(url.searchParams.get('from'));assert.equal(url.searchParams.has('page'),false);assert.equal(url.searchParams.has('size'),false);}
  }finally{m.d.window.close();f.d.window.close();}
});
