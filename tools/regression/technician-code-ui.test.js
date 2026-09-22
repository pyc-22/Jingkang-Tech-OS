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
for(const width of [1440,1200,390]) {
  test(`technician cards render full identifiers and retain dispatch selection at ${width}px`,async()=>{
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
          {id:'t1',code:'39',name:'王小明',state:'available',clockedIn:true,queue:3,detail:'可派钟',queueCount:2,callCount:1,extensionCount:0},
          {id:'t2',code:'A001234567890123456789',name:'王小明完整姓名展示',state:'available',clockedIn:true,queue:4,detail:'可派钟',queueCount:0,callCount:0,extensionCount:0},
          {id:'t3',code:null,name:'李清',state:'serving',clockedIn:true,queue:5,detail:'101 房',queueCount:1,callCount:0,extensionCount:0}
        ],rooms:[{id:'101',apiId:'room1',bedCount:2,availableBedCount:2,status:'idle'}],services:[]};
        window.clockingTechIds=[]; window.dispatchSelections=new Map(); window.dispatchFocusTechId=null;
        window.dispatchDefaultSelection=null; window.clockTypeLabels={QUEUE:'排钟'};
        window.renderDispatchServiceCatalog=()=>{}; window.toast=()=>{};
        window.dispatchEscape=value=>String(value);
      });
      await page.addScriptTag({content:['roomTransferEscape','renderTechnicians','renderDispatchSelection','openClockDialog'].map(functionSource).join('\n')});
      const clockTypeSetup=source.split(/\r?\n/).find(line=>line.startsWith("document.querySelector('#clock-room').closest('label').insertAdjacentHTML"));
      await page.addScriptTag({content:clockTypeSetup});
      const start=source.indexOf("document.querySelector('#dispatch-tech-list').addEventListener('click'");
      await page.addScriptTag({content:source.slice(start,source.indexOf('\n});',start)+4)});
      await page.evaluate(()=>renderTechnicians());
      assert.equal(await page.locator('[data-tech-card="t1"] .tech-avatar').textContent(),'39');
      await page.locator('.technician-panel').screenshot({path:path.join(root,`.artifacts/technician-queue-${width}.png`)});
      await page.evaluate(()=>openClockDialog());
      await page.locator('[data-dispatch-tech="t1"]').click();
      assert.equal(await page.locator('#clock-tech-name').textContent(),'39 · 王小明');
      assert.match(await page.locator('[data-dispatch-tech="t1"]').getAttribute('class'),/selected/);
      await page.locator('[data-dispatch-tech="t1"]').click();
      assert.doesNotMatch(await page.locator('[data-dispatch-tech="t1"]').getAttribute('class'),/selected/);
      const problems=await page.evaluate(()=>{
        const problems=[];
        for(const card of document.querySelectorAll('.tech-card,.dispatch-tech-choice')) {
          if(card.scrollWidth>card.clientWidth+1) problems.push('card overflow');
          const avatar=card.querySelector('.tech-avatar');
          if(avatar.scrollHeight>avatar.clientHeight+1) problems.push('avatar overflow');
          const code=card.querySelector('b');
          if(getComputedStyle(code).fontSize!=='20px') problems.push('code size');
          if(getComputedStyle(code).textAlign!=='center') problems.push('code alignment');
          const name=card.querySelector('.technician-full-name');
          const a=code.getBoundingClientRect(), b=name.getBoundingClientRect();
          if(a.bottom>b.top+1) problems.push('name overlap');
        }
        return problems;
      });
      assert.deepEqual(problems,[]);
      await page.locator('#clock-dialog').screenshot({path:path.join(root,`.artifacts/technician-dispatch-${width}.png`)});
    } finally { await page.close(); }
  });
}
