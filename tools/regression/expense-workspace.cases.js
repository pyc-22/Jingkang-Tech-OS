const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {spawnSync} = require('node:child_process');

module.exports = ({test,sql,api,ok,context}) => {
  const category = () => sql("SELECT id FROM expense_category WHERE active AND category_level=2 ORDER BY code LIMIT 1;");
  function claims({count=1,status='SUBMITTED',date='2030-02-03',scope=context().store,prefix=randomUUID().slice(0,8),amount=100}={}) {
    const {tenant}=context(), ids=Array.from({length:count},()=>randomUUID()), cat=category();
    sql(`INSERT INTO expense_claim(id,tenant_id,store_id,claim_no,applicant_user_id,expense_category_id,expense_date,amount_cents,payment_source,receipt_type,description,status,submitted_at,created_at)
      VALUES ${ids.map((id,i)=>`('${id}','${tenant}','${scope}','${prefix}-${i}',(SELECT id FROM app_user WHERE login_name='review-manager'),'${cat}','2020-01-01',${amount+i},'PERSONAL_ADVANCE','INVOICE','Review expense','${status}',${status==='DRAFT'?'null':`'${date} 12:00:00+08'`},'${date} 12:00:00+08')`).join(',')};`);
    return {ids,prefix,cat};
  }
  const query = values => new URLSearchParams({from:'2030-02-03',to:'2030-02-03',...values}).toString();
  const browse = async (q,finance=false,token) => ok(await api(`/api/v1/${finance?'finance/':''}expense-claims/page?${q}`,undefined,token||context()[finance?'admin':'manager']));
  const batch = (ids,action='APPROVED',comment='Shared review',token=context().admin) => api('/api/v1/finance/expense-claims/batch-review',{ids,action,comment},token);

  test('expense: full totals, twenty-row pagination and both clients share identical scope',async()=>{
    const {store}=context(),f=claims({count:505});
    for(const status of ['DRAFT','RETURNED','REJECTED','WITHDRAWN','APPROVED','PAID'])claims({status,prefix:f.prefix+status});
    const q=query({claimNo:f.prefix,storeId:store});
    const mobile=await browse(q),finance=await browse(q,true);
    assert.deepEqual(mobile.summary,finance.summary);assert.deepEqual(mobile.items,finance.items);
    assert.equal(mobile.total,511);assert.equal(mobile.items.length,20);
    assert.equal(mobile.summary.effectiveAmountCents,505*100+504*505/2+200);
    assert.equal(mobile.summary.pendingCount,505);assert.equal(mobile.summary.approvedCount,1);assert.equal(mobile.summary.paidCount,1);
    const second=await browse(q+'&page=1');assert.equal(second.items.length,20);
    assert.equal(new Set([...mobile.items,...second.items].map(x=>x.id)).size,40);
    const report=ok(await api('/api/v1/finance/expense-reports/summary?'+query({storeId:store})));
    assert.equal(report.totals.totalAmountCents,mobile.summary.effectiveAmountCents);assert.equal(report.totals.claimCount,mobile.total);
    const effective=await browse(q+'&status=EFFECTIVE');assert.equal(effective.total,507);
  });
  test('expense: filters use submitted China date, literal applicant text, parent category and stable amount sort',async()=>{
    const f=claims({count:3}),ids=f.ids;
    sql(`UPDATE expense_claim SET submitted_at='2030-02-02 16:00:00+00' WHERE id='${ids[0]}';
      UPDATE expense_claim SET submitted_at='2030-02-03 15:59:59+00' WHERE id='${ids[1]}';
      UPDATE expense_claim SET submitted_at='2030-02-03 16:00:00+00' WHERE id='${ids[2]}';`);
    const parent=sql(`SELECT parent_id FROM expense_category WHERE id='${f.cat}';`);
    const q=query({claimNo:f.prefix,applicant:'Review fixture',categoryId:parent,sort:'amount',direction:'asc'});
    assert.deepEqual((await browse(q)).items.map(x=>x.id),ids.slice(0,2));
    assert.deepEqual((await browse(q.replace('direction=asc','direction=desc'))).items.map(x=>x.id),ids.slice(0,2).reverse());
    assert.equal((await browse(query({claimNo:f.prefix,applicant:'%'}))).total,0);
    assert.equal((await api('/api/v1/expense-claims/page?from=2030-03-01&to=2030-02-01')).status,400);
    assert.equal((await api('/api/v1/expense-claims/page?sort=amount%3Bdelete')).status,400);
  });
  test('expense: report snapshot does not conflict with simultaneous session activity',async()=>{
    const responses=await Promise.all(Array.from({length:12},(_,i)=>api(i%2?'/api/v1/finance/expense-reports/summary?'+query({}):'/api/v1/admin/auth/session')));
    responses.forEach(response=>ok(response));
  });
  test('expense: store and finance permission boundaries also apply to exports and batches',async()=>{
    const {store,tenant,manager,cashier,reader}=context(),other=randomUUID();
    sql(`INSERT INTO store(id,tenant_id,code,name,timezone) VALUES('${other}','${tenant}','${other}','Expense other store','Asia/Shanghai');`);
    const f=claims({scope:other});
    assert.equal((await browse(query({storeId:other,claimNo:f.prefix}))).total,0);
    assert.equal((await browse(query({storeId:other,claimNo:f.prefix}),true)).total,1);
    assert.equal((await api('/api/v1/expense-claims/page',undefined,manager,{'X-Store-Id':other})).status,403);
    for(const token of [manager,cashier,reader]){
      for(const endpoint of ['page','export'])assert.equal((await api('/api/v1/finance/expense-claims/'+endpoint,undefined,token)).status,403);
      assert.equal((await batch(f.ids,'APPROVED','Review',token)).status,403);
    }
    assert.equal((await api('/api/v1/expense-claims/export',undefined,reader,{'X-Store-Id':store})).status,403);
  });
  test('expense: XLSX exports all filtered rows beyond both old list limits',async()=>{
    const {base,admin,manager,store,dir}=context(),f=claims({count:505});
    for(const finance of [false,true]){
      const response=await fetch(`${base}/api/v1/${finance?'finance/':''}expense-claims/export?${query({claimNo:f.prefix,storeId:store,page:9,size:1})}`,{headers:{Authorization:`Bearer ${finance?admin:manager}`,'X-Store-Id':store}});
      assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);
      const file=path.join(dir,`expenses-${finance}.xlsx`);fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));
      const result=spawnSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('${file.replaceAll("'","''")}'); try { $r=[IO.StreamReader]::new($z.GetEntry('xl/worksheets/sheet1.xml').Open()); try { [xml]$x=$r.ReadToEnd(); $x.SelectNodes('//*[local-name()="row"]').Count } finally { $r.Dispose() } } finally { $z.Dispose() }`],{encoding:'utf8',windowsHide:true});
      assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'506');
    }
  });
  test('expense: atomic batch review persists common comment, actor, audit and history',async()=>{
    for(const action of ['APPROVED','REJECTED']){
      const f=claims({count:2}),result=ok(await batch(f.ids,action,'  Shared review  '));
      assert.equal(result.length,2);
      for(const detail of result){
        assert.equal(detail.claim.status,action);assert.equal(detail.claim.reviewNote,'Shared review');
        assert.equal(detail.history[0].comment,'Shared review');assert.ok(detail.history[0].actorUserId);
      }
      assert.equal(sql(`SELECT count(*) FROM audit_log WHERE entity_id IN (${f.ids.map(x=>`'${x}'`).join(',')}) AND action='EXPENSE_CLAIM_${action==='APPROVED'?'APPROVE':'REJECT'}';`),'2');
    }
  });
  test('expense: invalid batches and stale records roll back every selected claim',async()=>{
    const f=claims({count:2}),ordered=[...f.ids].sort();
    sql(`UPDATE expense_claim SET status='PAID' WHERE id='${ordered[1]}';`);
    assert.equal((await batch(ordered)).status,409);
    assert.equal(sql(`SELECT status FROM expense_claim WHERE id='${ordered[0]}';`),'SUBMITTED');
    assert.equal(sql(`SELECT count(*) FROM expense_review_history WHERE claim_id='${ordered[0]}';`),'0');
    for(const ids of [[],[ordered[0],ordered[0]],[null]])assert.equal((await batch(ids)).status,400);
    assert.equal((await batch([ordered[0]],'APPROVED','   ')).status,400);
    assert.equal((await batch([ordered[0]],'PAID')).status,400);
    assert.equal((await batch([ordered[0],randomUUID()])).status,404);
    assert.equal(sql(`SELECT status FROM expense_claim WHERE id='${ordered[0]}';`),'SUBMITTED');
  });
  test('expense: overlapping batches and single review commit one transition per claim',async()=>{
    const secondAdmin=ok(await api('/api/v1/admin/auth/login',{loginName:'review-admin',password:context().password},null)).accessToken;
    const f=claims({count:2});
    const results=await Promise.all([batch(f.ids),batch([...f.ids].reverse(),'REJECTED','Second session',secondAdmin)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    for(const id of f.ids)assert.equal(sql(`SELECT count(*) FROM expense_review_history WHERE claim_id='${id}';`),'1');
    const single=claims();
    const mixed=await Promise.all([batch(single.ids),api(`/api/v1/finance/expense-claims/${single.ids[0]}/reject`,{comment:'Single review'},secondAdmin)]);
    assert.deepEqual(mixed.map(r=>r.status).sort(),[200,409]);
    assert.equal(sql(`SELECT count(*) FROM expense_review_history WHERE claim_id='${single.ids[0]}';`),'1');
  });

  if(process.env.REVIEW_BROWSER)test('expense: real browser mobile paging and desktop filters, batch, attachments and layout',async()=>{
    const {base,consoleBase,store,manager,admin,dir}=context();
    const today=sql("SELECT (now() AT TIME ZONE 'Asia/Shanghai')::date;");
    const f=claims({count:45,date:today,prefix:'BrowserExpense'});
    const draft=ok(await api('/api/v1/expense-claims',{expenseCategoryId:f.cat,expenseDate:today,amountCents:2500,paymentSource:'PERSONAL_ADVANCE',receiptType:'INVOICE',description:'Browser attachments'},manager));
    for(const name of ['first.png','second.png']){
      const form=new FormData();form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')],{type:'image/png'}),name);
      const response=await fetch(`${base}/api/v1/expense-claims/${draft.claim.id}/attachments?attachmentKind=EXPENSE_PROOF`,{method:'POST',headers:{Authorization:`Bearer ${manager}`,'X-Store-Id':store},body:form});
      assert.equal(response.status,200,await response.text());
    }
    ok(await api(`/api/v1/expense-claims/${draft.claim.id}/submit`,{},manager));
    const {chromium}=require(process.env.REVIEW_BROWSER),browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
    try{
      const mobile=await browser.newPage({viewport:{width:390,height:844}});mobile.on('pageerror',e=>errors.push(e.message));
      await mobile.addInitScript(({manager,store})=>{localStorage.setItem('chengxin-manager-mobile-access-token',manager);localStorage.setItem('chengxin-manager-mobile-store-id',store);localStorage.setItem('chengxin-manager-mobile-page','expense');},{manager,store});
      await mobile.goto(consoleBase+'/manager-mobile.html');
      await mobile.waitForFunction(()=>document.querySelectorAll('#manager-expense-list .expense-card').length===20);
      assert.equal(await mobile.locator('#manager-expense-from').inputValue(),require('../../apps/massage-console/expense-ui').range().from);
      await mobile.screenshot({path:path.join(dir,'expense-manager-390.png'),fullPage:true});
      assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await mobile.locator('#manager-expense-more').scrollIntoViewIfNeeded();
      await mobile.waitForFunction(()=>document.querySelectorAll('#manager-expense-list .expense-card').length>=40);
      await mobile.locator('#manager-expense-from').fill(today);await mobile.locator('#manager-expense-from').dispatchEvent('change');
      await mobile.locator('[data-expense-status=SUBMITTED]').click();
      await mobile.waitForFunction(()=>document.querySelector('[data-expense-status=SUBMITTED]').getAttribute('aria-pressed')==='true');
      await mobile.reload();await mobile.waitForFunction(()=>document.querySelectorAll('#manager-expense-list .expense-card').length===20);
      assert.equal(await mobile.locator('#manager-expense-from').inputValue(),today);assert.equal(await mobile.locator('#manager-expense-status').inputValue(),'SUBMITTED');
      const download=mobile.waitForEvent('download');await mobile.locator('#manager-expense-export').click();assert.match((await download).suggestedFilename(),/\.xlsx$/);
      await mobile.close();
      for(const width of [1200,1440]){
        const page=await browser.newPage({viewport:{width,height:1000}});page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(({admin,store})=>{localStorage.setItem('chengxin-admin-access-token',admin);localStorage.setItem('chengxin-current-store-id',store);},{admin,store});
        await page.goto(consoleBase);await page.waitForFunction(()=>typeof isTenantAdmin==='function'&&isTenantAdmin()&&!document.querySelector('[data-view=finance]').hidden);
        await page.locator('.nav-group > summary').filter({hasText:'财务与配置'}).click();
        const report=page.waitForResponse(r=>r.url().includes('/expense-reports/summary?'));
        await page.locator('[data-view=finance]').click();assert.equal((await report).status(),200);
        await page.waitForFunction(()=>document.querySelectorAll('#finance-claim-records tr').length===20&&document.querySelectorAll('#finance-report-metrics button').length===5);
        await page.locator('#finance-claims-number').fill('BrowserExpense');await page.locator('#finance-claims-number').dispatchEvent('change');
        await page.waitForFunction(()=>document.querySelector('#finance-record-count').textContent==='45');
        await page.locator('[data-finance-sort=amount]').click();
        await page.waitForFunction(()=>document.querySelector('#finance-claim-records tr .amount-cell').textContent.includes('1.44'));
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        assert.equal(await page.locator('.expense-metric-icon').evaluateAll(images=>images.length===5&&images.every(img=>img.complete&&img.naturalWidth>0)),true);
        await page.screenshot({path:path.join(dir,`expense-finance-${width}.png`),fullPage:true});
        if(width===1200){
          await page.locator('#finance-select-all').check();await page.locator('#finance-batch-approve').click();
          await page.locator('#finance-batch-form [name=comment]').fill('Browser bulk review');
          const reviewed=page.waitForResponse(r=>r.url().endsWith('/batch-review'));
          await page.locator('#finance-batch-form [type=submit]').click();assert.equal((await reviewed).status(),200);
          await page.waitForFunction(()=>!document.querySelector('#finance-batch-dialog').open);
        }
        await page.evaluate(async id=>{await openFinanceReview(id);},draft.claim.id);
        const dialog=page.locator('#finance-review-dialog');await dialog.waitFor({state:'visible'});
        assert.equal(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
        for(const label of ['基本信息','费用信息','审核信息','付款信息','操作历史'])assert.ok((await dialog.textContent()).includes(label));
        await page.screenshot({path:path.join(dir,`expense-detail-${width}.png`)});
        await page.locator('[data-finance-attachment]').first().click();
        await page.waitForFunction(()=>document.querySelector('#finance-attachment-position').textContent==='1 / 2');
        await page.locator('#finance-attachment-next').click();await page.waitForFunction(()=>document.querySelector('#finance-attachment-position').textContent==='2 / 2');
        await page.waitForFunction(()=>{const img=document.querySelector('#finance-attachment-preview img');return img?.complete&&img.naturalWidth>0;});
        await page.locator('#finance-attachment-prev').click();await page.waitForFunction(()=>document.querySelector('#finance-attachment-position').textContent==='1 / 2');
        await page.close();
      }
      assert.deepEqual(errors,[]);
    }finally{await browser.close();}
  });
};
