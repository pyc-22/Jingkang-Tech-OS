const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {JSDOM} = require('jsdom');
const {chromium} = require('playwright');
const root = path.resolve(__dirname,'../..');
const source = fs.readFileSync(path.join(root,'apps/massage-console/app.js'),'utf8');
function functionSource(name) {
  const start=source.indexOf(`function ${name}(`);
  assert.ok(start>=0,name);
  return source.slice(start,source.indexOf('\n}',start)+2);
}
let browser,server,base;
test.before(async()=>{
  const reservation=net.createServer();
  reservation.listen(0,'127.0.0.1'); await once(reservation,'listening');
  const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  base=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,[path.join(root,'server.massage.js')],{windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,MASSAGE_ADDRESS:'127.0.0.1',MASSAGE_PORT:String(port)}});
  await once(server.stdout,'data');
  browser=await chromium.launch({channel:'msedge',headless:true});
});
test.after(async()=>{
  await browser?.close();
  if(server?.pid && server.exitCode===null) {const done=once(server,'exit');server.kill();await done;}
});
for(const width of [1920,1440,1200,390]) {
  test(`compact technician cards retain horizontal layout and selection at ${width}px`,async()=>{
    const page=await browser.newPage({viewport:{width,height:1000}});
    try {
      await page.route('**/index.html',async route=>{
        const dom=new JSDOM(fs.readFileSync(path.join(root,'apps/massage-console/index.html'),'utf8'));
        dom.window.document.querySelectorAll('script').forEach(script=>script.remove());
        await route.fulfill({contentType:'text/html',body:dom.serialize()});
        dom.window.close();
      });
      await page.goto(base+'/index.html');
      await page.evaluate(()=>{
        window.state={technicians:[
          {id:'t1',code:'001',name:'王晨阳',state:'available',clockedIn:true,queue:1,detail:'可立即安排服务',queueCount:2,callCount:1,extensionCount:0},
          {id:'t2',code:'002',name:'李思思',state:'available',clockedIn:true,queue:2,detail:'可立即安排服务',queueCount:0,callCount:0,extensionCount:0},
          {id:'t3',code:'003',name:'张小雨',state:'serving',clockedIn:true,queue:3,detail:'101 房',queueCount:1,callCount:2,extensionCount:1},
          {id:'t4',code:'A001234567890123456789',name:'王小明完整姓名展示',state:'available',clockedIn:true,queue:4,detail:'可立即安排服务',queueCount:0,callCount:0,extensionCount:0},
          {id:'t5',code:null,name:'李清',state:'available',clockedIn:true,queue:5,detail:'可立即安排服务',queueCount:0,callCount:0,extensionCount:0},
          {id:'t6',code:'006',name:'陈晓',state:'pending',clockedIn:true,queue:6,detail:'待接单',queueCount:0,callCount:0,extensionCount:0},
          {id:'t7',code:'007',name:'林小雨',state:'accepted',clockedIn:true,queue:7,detail:'待服务',queueCount:0,callCount:0,extensionCount:0},
          {id:'t8',code:'008',name:'王玲',state:'off',clockedIn:false,queue:8,detail:'排班休息',queueCount:0,callCount:0,extensionCount:0}
        ],rooms:[{id:'101',apiId:'room1',bedCount:2,availableBedCount:2,status:'idle'}],services:[]};
        window.clockingTechIds=[]; window.dispatchSelections=new Map(); window.dispatchFocusTechId=null;
        window.dispatchDefaultSelection=null; window.clockTypeLabels={QUEUE:'排钟'};
        window.renderDispatchServiceCatalog=()=>{}; window.toast=()=>{};
        window.dispatchEscape=value=>String(value);
        window.activeSessionForTechnician=id=>({id});
        window.startServiceFromFrontdesk=id=>{window.startedTech=id;};
        window.sessionParticipantIds=()=>['t3'];
        window.state.activeSessions=[{id:'session3'}];
        window.openClockOutConfirmation=(session,tech)=>{window.stoppedTech=tech.id;};
      });
      await page.addScriptTag({content:['roomTransferEscape','renderTechnicians','renderDispatchSelection','openClockDialog'].map(functionSource).join('\n')});
      const clockTypeSetup=source.split(/\r?\n/).find(line=>line.startsWith("document.querySelector('#clock-room').closest('label').insertAdjacentHTML"));
      await page.addScriptTag({content:clockTypeSetup});
      const start=source.indexOf("document.querySelector('#dispatch-tech-list').addEventListener('click'");
      await page.addScriptTag({content:source.slice(start,source.indexOf('\n});',start)+4)});
      const queueStart=source.indexOf("document.querySelector('#technician-list').addEventListener('click'");
      await page.addScriptTag({content:source.slice(queueStart,source.indexOf('\n});',queueStart)+4)});
      await page.evaluate(()=>renderTechnicians());
      assert.equal(await page.locator('[data-tech-card="t1"] .tech-avatar').textContent(),'001');
      assert.doesNotMatch(await page.locator('#technician-list').textContent(),/可立即安排服务/);
      const queueGeometry=await page.evaluate(()=>{
        const cards=[...document.querySelectorAll('.tech-card')].map(card=>card.getBoundingClientRect());
        const list=document.querySelector('#technician-list');
        return {columns:cards.filter(card=>card.top===cards[0].top).length,height:cards[0].height,width:list.clientWidth};
      });
      assert.equal(queueGeometry.columns,Math.floor((queueGeometry.width-20+10)/(260+10)));
      assert.ok(queueGeometry.height<=150,`compact card height ${queueGeometry.height}`);
      await page.locator('.technician-panel').screenshot({path:path.join(root,`.artifacts/technician-queue-${width}.png`)});
      if(width>=1200) {
        await page.locator('[data-tech="t6"]').click();
        assert.equal(await page.evaluate(()=>window.startedTech),'t6');
        await page.locator('[data-tech="t3"]').click();
        assert.equal(await page.evaluate(()=>window.stoppedTech),'t3');
        assert.equal(await page.locator('[data-tech="t8"]').isDisabled(),true);
        await page.locator('[data-tech="t1"]').click();
      } else {
        // The existing desktop shell has a minimum width; exercise the narrow dialog independently.
        await page.evaluate(()=>openClockDialog(state.technicians[0]));
      }
      assert.equal(await page.locator('#clock-tech-name').textContent(),'001 · 王晨阳');
      assert.match(await page.locator('[data-dispatch-tech="t1"]').getAttribute('class'),/selected/);
      await page.locator('[data-dispatch-tech="t1"]').click();
      assert.doesNotMatch(await page.locator('[data-dispatch-tech="t1"]').getAttribute('class'),/selected/);
      await page.locator('[data-dispatch-tech="t3"]').click();
      assert.doesNotMatch(await page.locator('[data-dispatch-tech="t3"]').getAttribute('class'),/selected/);
      await page.locator('#clock-type').selectOption('BOOKED_QUEUE');
      await page.locator('[data-dispatch-tech="t3"]').click();
      assert.match(await page.locator('[data-dispatch-tech="t3"]').getAttribute('class'),/selected/);
      assert.equal(await page.locator('[data-dispatch-tech="t8"]').count(),0);
      const problems=await page.evaluate(()=>{
        const problems=[];
        for(const card of document.querySelectorAll('.tech-card,.dispatch-tech-choice')) {
          if(card.scrollWidth>card.clientWidth+1) problems.push('card overflow');
          const avatar=card.querySelector('.tech-avatar');
          if(avatar.scrollHeight>avatar.clientHeight+1 || avatar.scrollWidth>avatar.clientWidth+1) problems.push('avatar overflow');
          if(getComputedStyle(avatar).color!=='rgb(255, 255, 255)') problems.push('avatar number is not white');
          if(getComputedStyle(avatar).backgroundColor!=='rgb(35, 138, 88)') problems.push('avatar is not green');
          const name=card.querySelector('.technician-full-name');
          if(getComputedStyle(name).fontWeight!=='400') problems.push('name weight');
          const a=avatar.getBoundingClientRect(), b=name.parentElement.getBoundingClientRect();
          if(a.right>b.left) problems.push('name overlaps avatar');
          if(Math.abs((a.top+a.bottom)-(b.top+b.bottom))>2) problems.push('name is not vertically centered');
          if(card.querySelector('.technician-name b')) problems.push('repeated number heading');
          const action=card.querySelector('.tech-action'), badge=card.querySelector('.tech-state,.dispatch-tech-status');
          if(action) {
            const button=action.getBoundingClientRect(), status=badge.getBoundingClientRect();
            if(button.height<44) problems.push('action touch target');
            if(button.bottom>status.top || Math.abs(button.right-status.right)>1) problems.push('badge is not below action');
          } else {
            const status=badge.getBoundingClientRect();
            if(status.left<b.right || status.bottom<a.bottom-1) problems.push('dispatch badge placement');
            if(card.querySelectorAll('button').length) problems.push('nested dispatch action');
          }
        }
        return problems;
      });
      assert.deepEqual(problems,[]);
      await page.locator('#clock-dialog').screenshot({path:path.join(root,`.artifacts/technician-dispatch-${width}.png`)});
    } finally { await page.close(); }
  });
}
