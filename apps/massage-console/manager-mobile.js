const managerApi = '/api/v1';
const managerTokenKey = 'chengxin-manager-mobile-access-token';
const managerStoreKey = 'chengxin-manager-mobile-store-id';
const managerRolesKey = 'chengxin-manager-mobile-roles';
const managerPermissionsKey = 'chengxin-manager-mobile-permissions';
const managerPageKey = 'chengxin-manager-mobile-page';
const managerMoney = (cents) => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
const managerToast = (message) => { const element=document.querySelector('#manager-toast'); element.textContent=message; element.classList.remove('hidden'); window.setTimeout(()=>element.classList.add('hidden'),2600); };
const managerHeaders = () => ({ Authorization:`Bearer ${localStorage.getItem(managerTokenKey)}` });
const managerStoredList = key => { try { return JSON.parse(localStorage.getItem(key)||'[]'); } catch { return []; } };
const managerRoles = () => managerStoredList(managerRolesKey);
const managerPermissions = () => managerStoredList(managerPermissionsKey);
const managerIsTenantAdmin = () => managerRoles().includes('TENANT_ADMIN');
const managerHasPermission = permission => managerIsTenantAdmin() || managerPermissions().includes(permission);
let managerStores=[];
let managerLoading=false;
let managerCommissionSummaries=[];
let managerCommissionDetails=[];
let managerCommissionAdjustments=[];
let managerPaymentMethods=[];
let managerFoundationRooms=[];
let managerFoundationTechnicians=[];
let managerFoundationServices=[];
let managerFoundationRoomStatuses=new Map();
let managerTechnicianEligibility=new Map();
let managerQueuePositions=new Map();
let managerLiveTechnicianOverview={technicians:[]};
let managerClockingTechIds=[];
let managerClockingRoomId='';
let managerCanArrange=false;
let managerCurrentBusinessDate='';
let managerExtensionSessionId=null;
let managerExtensionTechnicianId=null;
let managerActiveSessions=[];
let managerExtensionRequestToken=0;

function clearManagerSession() {
  [managerTokenKey,managerStoreKey,managerRolesKey,managerPermissionsKey].forEach(key=>localStorage.removeItem(key));
  managerStores=[];
  resetManagerExtensionState({close:true});
}
function managerCurrentStoreId() {
  const stored=localStorage.getItem(managerStoreKey);
  const selected=managerStores.find(store=>store.id===stored)?.id||managerStores[0]?.id||'';
  if(selected) localStorage.setItem(managerStoreKey,selected);
  else localStorage.removeItem(managerStoreKey);
  return selected;
}
function managerToday() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function managerBackfillMaxDate(){ return managerCurrentBusinessDate || managerToday(); }
function ensureManagerReportDate() { const input=document.querySelector('#manager-report-date'); if(input&&!input.value) input.value=managerToday(); return input?.value||''; }
const managerStoreHeaders = () => ({ ...managerHeaders(), 'X-Store-Id':managerCurrentStoreId() });
function applyManagerPermissions() {
  document.querySelectorAll('[data-manager-permission]').forEach(element=>{
    element.classList.toggle('hidden',!managerHasPermission(element.dataset.managerPermission));
  });
}
function saveManagerIdentity(session) {
  localStorage.setItem(managerRolesKey,JSON.stringify(session.roles||[]));
  localStorage.setItem(managerPermissionsKey,JSON.stringify(session.permissions||[]));
}
function isManagerIdentity(session) {
  const roles=session.roles||[];
  const permissions=session.permissions||[];
  return (roles.includes('STORE_MANAGER')||roles.includes('TENANT_ADMIN'))&&(roles.includes('TENANT_ADMIN')||permissions.includes('REPORT_VIEW'));
}

function showManagerLogin(message='') {
  document.querySelector('#manager-login-screen').classList.remove('hidden');
  document.querySelector('#manager-dashboard').classList.add('hidden');
  document.querySelector('#manager-refresh').classList.add('hidden');
  if(message) managerToast(message);
}
function showManagerDashboard() {
  document.querySelector('#manager-login-screen').classList.add('hidden');
  document.querySelector('#manager-dashboard').classList.remove('hidden');
  document.querySelector('#manager-refresh').classList.remove('hidden');
  restoreManagerPage();
}
function switchManagerPage(page,{remember=true}={}) {
  const allowedPages=['home','business','commission','expense','more'];
  let targetPage=allowedPages.includes(page)?page:'home';
  let targetButton=document.querySelector(`[data-manager-nav="${targetPage}"]`);
  if(!targetButton||targetButton.classList.contains('hidden')){
    targetButton=[...document.querySelectorAll('[data-manager-nav]')].find(button=>!button.classList.contains('hidden'));
    targetPage=targetButton?.dataset.managerNav||'home';
  }
  document.querySelectorAll('[data-manager-page-panel]').forEach(panel=>{panel.hidden=panel.dataset.managerPagePanel!==targetPage;});
  document.querySelectorAll('[data-manager-nav]').forEach(button=>{const selected=button.dataset.managerNav===targetPage;button.classList.toggle('selected',selected);button.setAttribute('aria-current',selected?'page':'false');});
  if(remember)localStorage.setItem(managerPageKey,targetPage);
  window.scrollTo({top:0,behavior:'auto'});
}
function restoreManagerPage(){switchManagerPage(localStorage.getItem(managerPageKey)||'home',{remember:false});}
async function managerJson(path, headers=managerStoreHeaders()) {
  const response=await fetch(`${managerApi}${path}`,{headers});
  if(response.status===401) throw new Error('UNAUTHORIZED');
  if(response.status===403) throw new Error('FORBIDDEN');
  if(!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}
async function managerOptionalJson(path, fallback, headers=managerStoreHeaders()) {
  try { return await managerJson(path, headers); }
  catch(error) { if(error.message==='UNAUTHORIZED'||error.message==='FORBIDDEN') throw error; return fallback; }
}
async function managerOptionalTask(task) {
  try { return await task(); }
  catch(error) { if(error.message==='UNAUTHORIZED'||error.message==='FORBIDDEN') throw error; }
}
function renderManagerStores() {
  const select=document.querySelector('#manager-store-select');
  const selected=managerCurrentStoreId();
  select.innerHTML=managerStores.map(store=>`<option value="${store.id}" ${store.id===selected?'selected':''}>${store.name}</option>`).join('');
  select.disabled=managerStores.length<2;
}
function countRoomStatuses(rooms,statuses) {
  const latest=new Map(statuses.map(status=>[status.roomId,status.status]));
  return rooms.reduce((count,room)=>{const status=latest.get(room.id)||'IDLE';count[status]=(count[status]||0)+1;return count;},{});
}
const managerRoomStatusLabel={IN_SERVICE:'服务中',RESERVED:'待接单/待开始',PENDING_PAYMENT:'待结算',CLEANING:'待清洁',IDLE:'空闲',MAINTENANCE:'维修中'};
const managerServiceStatusLabel={IN_SERVICE:'正在上钟',PENDING_ACCEPTANCE:'等待接单',ACCEPTED:'已接单待开始',REASSIGNMENT_REQUIRED:'待重新派单',DISPATCH_CANCELLED:'待与顾客沟通',COMPLETED:'已完成待结算'};
const managerRoomStatusOrder={IN_SERVICE:0,RESERVED:1,PENDING_PAYMENT:2,CLEANING:3,MAINTENANCE:4,IDLE:5};
function managerTime(value){if(!value)return'—';const date=new Date(value);return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(date);}
function renderManagerLiveRooms(rooms=[]){
  const target=document.querySelector('#manager-live-room-list');
  const summary=document.querySelector('#manager-live-room-summary');
  if(!target||!summary)return;
  const active=rooms.filter(room=>['IN_SERVICE','RESERVED'].includes(room.status)).length;
  summary.textContent=`使用中 ${active} / ${rooms.length} 间`;
  const sorted=[...rooms].sort((left,right)=>(managerRoomStatusOrder[left.status]??9)-(managerRoomStatusOrder[right.status]??9)||String(left.roomCode||'').localeCompare(String(right.roomCode||''),'zh-CN',{numeric:true}));
  target.innerHTML=sorted.map(room=>{
    const services=room.services||[];
    const serviceRows=services.map(service=>{
      const servingTechnicians=(managerLiveTechnicianOverview.technicians||[]).filter(item=>String(item.serviceSessionId||'')===String(service.serviceSessionId||'')&&item.status==='IN_SERVICE');
      const extensionButtons=managerCanArrange&&service.serviceStatus==='IN_SERVICE'
        ?servingTechnicians.map(technician=>`<button class="manager-live-service-action" type="button" data-manager-extension-session="${managerEscape(service.serviceSessionId)}" data-manager-extension-tech="${managerEscape(technician.technicianId)}" aria-label="为${managerEscape(technician.technicianName||'技师')}安排加钟">${servingTechnicians.length>1?`加钟 · ${managerEscape(technician.technicianName||'技师')}`:'加钟'}</button>`).join(''):'';
      const extensionActions=extensionButtons?`<div class="manager-live-service-actions">${extensionButtons}</div>`:'';
      return `<div class="manager-live-service"><div class="manager-live-service-title"><b>${managerEscape(service.serviceNameSnapshot||'未命名项目')}</b><span>${managerEscape(managerClockTypeLabel[service.clockType]||service.clockType||'排钟')}</span></div><p>${managerEscape(service.technicianDisplay||'待安排技师')}</p><small>${managerEscape(service.bedName||service.bedCode||'未指定床位')} · ${managerEscape(managerServiceStatusLabel[service.serviceStatus]||service.serviceStatus||'')}</small><small>${service.startedAt?`上钟 ${managerTime(service.startedAt)} · 预计 ${managerTime(service.expectedEndAt)}结束`:`尚未上钟${service.expectedEndAt?` · 预计 ${managerTime(service.expectedEndAt)}`:''}`}</small>${extensionActions}</div>`;
    }).join('');
    const emptyText=room.status==='IDLE'?'当前可立即安排':room.status==='CLEANING'?'等待完成清洁':room.status==='PENDING_PAYMENT'?'服务已完成，等待结算':room.status==='MAINTENANCE'?'当前暂停使用':'暂无进行中的服务记录';
    const canArrangeRoom=managerCanArrange&&managerClockAvailableRooms().some(item=>String(item.id)===String(room.roomId));
    const arrangeButton=canArrangeRoom?`<button class="manager-live-arrange-button" type="button" data-manager-clock-room="${managerEscape(room.roomId)}">安排上钟</button>`:'';
    return `<article class="manager-live-room ${managerEscape(room.status||'IDLE')}"><div class="manager-live-room-top"><div><strong>${managerEscape(room.roomCode)} 房</strong><small>${managerEscape(room.roomName||'')}</small></div><div class="manager-live-room-actions"><span class="manager-room-status ${managerEscape(room.status||'IDLE')}">${managerEscape(managerRoomStatusLabel[room.status]||room.status||'空闲')}</span>${arrangeButton}</div></div><div class="manager-live-room-capacity"><span>床位 ${Number(room.occupiedBedCount||0)}/${Number(room.bedCount||1)} 已用</span><span>剩余 ${Number(room.availableBedCount||0)}</span></div><div class="manager-live-services">${serviceRows||`<p class="manager-live-room-empty">${emptyText}</p>`}</div></article>`;
  }).join('')||'<p class="comparison-empty">当前门店暂无启用房间</p>';
}
function ensureManagerExtensionDialog(){
  if(document.querySelector('#manager-extension-dialog'))return;
  document.body.insertAdjacentHTML('beforeend','<dialog id="manager-extension-dialog"><form id="manager-extension-form" class="manager-extension-dialog-card"><div class="expense-editor-title"><div><p>服务中加钟</p><h3>安排加钟</h3></div><button class="manager-quiet-button" id="manager-extension-close" type="button">关闭</button></div><p id="manager-extension-summary" class="manager-extension-summary"></p><label>加钟项目<select id="manager-extension-service" name="serviceItemId" required></select></label><div id="manager-extension-preview" class="manager-extension-preview"></div><div class="expense-editor-actions"><button class="manager-secondary-button" id="manager-extension-cancel" type="button">取消</button><button class="manager-primary-button" type="submit">确认加钟</button></div></form></dialog>');
  const close=()=>resetManagerExtensionState({close:true});
  document.querySelector('#manager-extension-close').addEventListener('click',close);
  document.querySelector('#manager-extension-cancel').addEventListener('click',close);
  document.querySelector('#manager-extension-dialog').addEventListener('cancel',()=>resetManagerExtensionState());
  document.querySelector('#manager-extension-service').addEventListener('change',renderManagerExtensionPreview);
  document.querySelector('#manager-extension-form').addEventListener('submit',event=>submitManagerExtension(event).catch(handleManagerExtensionFailure));
}
function resetManagerExtensionState({close=false}={}){
  managerExtensionRequestToken+=1;
  managerExtensionSessionId=null;
  managerExtensionTechnicianId=null;
  const dialog=document.querySelector('#manager-extension-dialog');
  if(close&&dialog?.open)dialog.close();
}
function handleManagerExtensionFailure(error){
  resetManagerExtensionState({close:true});
  if(error?.message==='UNAUTHORIZED'){clearManagerSession();showManagerLogin('登录已失效，请重新登录');return;}
  if(error?.message==='FORBIDDEN'){clearManagerSession();showManagerLogin('当前账号权限已变更，请重新登录');return;}
  managerToast('加钟失败，请刷新后重试');
}
function renderManagerExtensionPreview(){
  const service=managerFoundationServices.find(item=>String(item.id)===String(document.querySelector('#manager-extension-service')?.value));
  const target=document.querySelector('#manager-extension-preview');
  if(target)target.innerHTML=service?`<span>${managerEscape(service.name)} · 增加 ${Number(service.defaultDurationMinutes||0)} 分钟</span><b>${managerMoney(service.priceCents)}</b>`:'';
}
async function openManagerExtension(sessionId,technicianId){
  if(!managerCanArrange)return managerToast('当前账号没有安排加钟权限');
  ensureManagerExtensionDialog();
  resetManagerExtensionState({close:true});
  const requestToken=managerExtensionRequestToken;
  try{
    const [sessions,policy]=await Promise.all([managerJson('/service-sessions?status=IN_SERVICE'),managerJson('/service-duration-policy')]);
    if(requestToken!==managerExtensionRequestToken)return;
    managerActiveSessions=sessions||[];
    const session=managerActiveSessions.find(item=>String(item.id)===String(sessionId));
    if(!session)return managerToast('未找到进行中的服务，请刷新后重试');
    if(session.status!=='IN_SERVICE')return managerToast('该服务已结束或状态已变化，请刷新后重试');
    const currentMinutes=Number(session.extensionTotalMinutes||0);
    const remaining=Math.max(0,Math.min(Number(policy.technicianExtensionMaxMinutes||0)-currentMinutes,Number(policy.serviceDurationMaxMinutes||0)-Number(session.plannedDurationMinutes||0)));
    const services=managerFoundationServices.filter(item=>item.allowsExtension===true&&Number(item.defaultDurationMinutes||0)<=remaining);
    if(remaining<=0)return managerToast('本次服务已达到加钟上限');
    if(!services.length)return managerToast('门店当前没有符合剩余额度的加钟项目');
    const servingTechnician=(managerLiveTechnicianOverview.technicians||[]).find(item=>String(item.technicianId||'')===String(technicianId)&&String(item.serviceSessionId||'')===String(sessionId)&&item.status==='IN_SERVICE');
    if(!servingTechnician)return managerToast('该技师已不在服务中，请刷新后重试');
    if(requestToken!==managerExtensionRequestToken)return;
    managerExtensionSessionId=sessionId;
    managerExtensionTechnicianId=technicianId;
    document.querySelector('#manager-extension-summary').textContent=`${servingTechnician.technicianName||session.activeTechnicianName||session.technicianName||'技师'} · ${session.roomCode||'—'} 房 · 已加 ${currentMinutes} 分钟 · 最多可再加 ${remaining} 分钟`;
    document.querySelector('#manager-extension-service').innerHTML=services.map(item=>`<option value="${item.id}">${managerEscape(item.name)} · ${Number(item.defaultDurationMinutes||0)} 分钟 · ${managerMoney(item.priceCents)}</option>`).join('');
    renderManagerExtensionPreview();
    document.querySelector('#manager-extension-dialog').showModal();
  }catch(error){
    if(requestToken!==managerExtensionRequestToken)return;
    throw error;
  }
}
async function submitManagerExtension(event){
  event.preventDefault();
  const requestToken=managerExtensionRequestToken;
  const sessionId=managerExtensionSessionId;
  const technicianId=managerExtensionTechnicianId;
  if(!sessionId||!technicianId)return;
  const submit=event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled=true;
  try{
    const response=await fetch(`${managerApi}/service-sessions/${sessionId}/extensions`,{method:'POST',headers:{...managerStoreHeaders(),'Content-Type':'application/json'},body:JSON.stringify({technicianId,serviceItemId:new FormData(event.currentTarget).get('serviceItemId')})});
    if(requestToken!==managerExtensionRequestToken)return;
    if(!response.ok){const detail=(await response.text()).replace(/^"|"$/g,'');resetManagerExtensionState({close:true});if(response.status===401){return handleManagerExtensionFailure(new Error('UNAUTHORIZED'));}if(response.status===403){return handleManagerExtensionFailure(new Error('FORBIDDEN'));}return managerToast(`加钟失败：${detail||'服务状态已变化，请刷新后重试'}`);}
    const result=await response.json();
    if(requestToken!==managerExtensionRequestToken)return;
    resetManagerExtensionState({close:true});
    const postResetToken=managerExtensionRequestToken;
    const refreshed=await loadManagerDashboard({manual:false});
    if(postResetToken!==managerExtensionRequestToken)return;
    managerToast(refreshed===true?`${result.serviceName} 已加钟，新的结束时间已同步`:`${result.serviceName} 已加钟，但看板刷新失败，请手动刷新`);
  }catch(error){
    if(requestToken!==managerExtensionRequestToken)return;
    throw error;
  }finally{if(requestToken===managerExtensionRequestToken)submit.disabled=false;}
}
const managerTechnicianStatusLabel={IN_SERVICE:'服务中',PENDING_ACCEPTANCE:'待接单',ACCEPTED:'已接单待开始',IDLE:'空闲'};
const managerTechnicianStatusOrder={PENDING_ACCEPTANCE:0,ACCEPTED:1,IN_SERVICE:2,IDLE:3};
function managerTechnicianLiveStatus(technicianId){
  return (managerLiveTechnicianOverview.technicians||[]).find(item=>String(item.technicianId||item.id)===String(technicianId))?.status||'IDLE';
}
function managerClockAvailableRooms(){
  const liveById=new Map((managerLiveRoomsSnapshot||[]).map(room=>[String(room.roomId),room]));
  return managerFoundationRooms.filter(room=>{
    const live=liveById.get(String(room.id));
    const status=live?.status||managerFoundationRoomStatuses.get(String(room.id))||'IDLE';
    const hasCapacity=live?Number(live.availableBedCount||0)>0:status==='IDLE';
    return room.active!==false && hasCapacity && !['PENDING_PAYMENT','CLEANING','MAINTENANCE'].includes(status);
  });
}
function managerClockEligibleTechnicians(reservation=false){
  return managerFoundationTechnicians.filter(tech=>{
    if(tech.active===false||tech.queueEnabled===false)return false;
    const eligibility=managerTechnicianEligibility.get(String(tech.id));
    if(eligibility&&!eligibility.eligible)return false;
    return reservation || managerTechnicianLiveStatus(tech.id)==='IDLE';
  });
}
function managerClockEqualAllocation(index,count){const base=Math.floor(10000/count);return ((base+(index===0?10000-base*count:0))/100).toFixed(2);}
function renderManagerClockAllocation(){
  const target=document.querySelector('#manager-clock-allocation');
  const selected=managerClockingTechIds.map(id=>managerFoundationTechnicians.find(tech=>String(tech.id)===String(id))).filter(Boolean);
  target.innerHTML=selected.length>1?`<div class="manager-clock-allocation-heading"><b>业绩分配</b><small>合计必须为 100%</small></div>${selected.map((tech,index)=>`<label><span>${managerEscape(tech.name)}</span><input data-manager-tech-allocation="${tech.id}" type="number" min="0.01" max="100" step="0.01" value="${managerClockEqualAllocation(index,selected.length)}"><em>%</em></label>`).join('')}`:'';
}
function renderManagerClockDialog(){
  const reservation=['BOOKED_QUEUE','BOOKED_CALL'].includes(document.querySelector('#manager-clock-type').value);
  const rooms=managerClockAvailableRooms();
  const techs=managerClockEligibleTechnicians(reservation);
  const eligibleIds=new Set(techs.map(item=>String(item.id)));
  managerClockingTechIds=managerClockingTechIds.filter(id=>eligibleIds.has(String(id)));
  const room=document.querySelector('#manager-clock-room');
  const service=document.querySelector('#manager-clock-service');
  const currentRoom=room.value;
  const currentService=service.value;
  room.innerHTML=rooms.map(item=>`<option value="${item.id}">${managerEscape(item.code)} 房 · ${managerEscape(item.name||'')} · ${Number(item.bedCount||1)} 床</option>`).join('');
  room.value=rooms.some(item=>String(item.id)===String(managerClockingRoomId||currentRoom))?(managerClockingRoomId||currentRoom):rooms[0]?.id||'';
  service.innerHTML=managerFoundationServices.map(item=>`<option value="${item.id}">${managerEscape(item.name)} · ${Number(item.defaultDurationMinutes||0)} 分钟 · ${managerMoney(item.priceCents)}</option>`).join('');
  service.value=managerFoundationServices.some(item=>String(item.id)===String(currentService))?currentService:managerFoundationServices[0]?.id||'';
  const durationInput=document.querySelector('#manager-clock-duration');
  if(durationInput&&!durationInput.value){
    const selectedService=managerFoundationServices.find(item=>String(item.id)===String(service.value));
    durationInput.value=Number(selectedService?.defaultDurationMinutes||0)||'';
  }
  document.querySelector('#manager-clock-tech-count').textContent=`${techs.length} 位可安排${reservation?'，预定钟可选择忙碌技师':''}`;
  document.querySelector('#manager-clock-tech-list').innerHTML=techs.map(item=>`<button class="manager-clock-tech-choice ${managerClockingTechIds.some(id=>String(id)===String(item.id))?'selected':''}" data-manager-clock-tech="${item.id}" type="button"><span class="manager-clock-tech-avatar">${managerEscape(String(item.name||'').slice(0,1))}</span><span><b>${managerEscape(item.name)}</b><small>轮钟 ${String(managerQueuePositions.get(String(item.id))||item.queueOrder||'—').padStart(2,'0')}</small></span><em>${managerTechnicianLiveStatus(item.id)==='IDLE'?'可派':'可预定'}</em></button>`).join('')||'<p class="comparison-empty">当前没有符合条件的技师</p>';
  renderManagerClockAllocation();
}
function openManagerClockDialog({technicianId=null,roomId=null}={}){
  if(!managerCanArrange)return managerToast('当前账号没有安排上钟权限');
  const dialog=document.querySelector('#manager-clock-dialog');
  managerClockingTechIds=technicianId?[technicianId]:[];
  managerClockingRoomId=roomId||'';
  document.querySelector('#manager-clock-form').reset();
  document.querySelector('#manager-clock-type').value='QUEUE';
  renderManagerClockDialog();
  if(!managerClockAvailableRooms().length)return managerToast('当前没有可安排的空闲房间');
  const immediateEligibleTechnicians=managerClockEligibleTechnicians(false).length;
  const reservationEligibleTechnicians=managerClockEligibleTechnicians(true).length;
  if(!immediateEligibleTechnicians&&!reservationEligibleTechnicians)return managerToast('当前没有可安排的在岗技师');
  if(!managerFoundationServices.length)return managerToast('当前没有可安排的服务项目');
  dialog.showModal();
}
async function submitManagerClock(event){
  event.preventDefault();
  const submit=event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled=true;
  try{
  const form=new FormData(event.currentTarget);
  const clockType=String(form.get('clockType')||'QUEUE');
  const reservation=['BOOKED_QUEUE','BOOKED_CALL'].includes(clockType);
  const service=managerFoundationServices.find(item=>String(item.id)===String(form.get('serviceItemId')));
  const selected=managerClockingTechIds.map(id=>managerFoundationTechnicians.find(item=>String(item.id)===String(id))).filter(Boolean);
  const duration=Number(form.get('duration'));
  if(!selected.length)return managerToast('请至少选择一位技师');
  if(!service||!form.get('roomId'))return managerToast('请选择房间和服务项目');
  if(!Number.isInteger(duration)||duration<15||duration>360)return managerToast('服务时长必须是 15-360 分钟的整数');
  if(reservation&&selected.length!==1)return managerToast('预定排钟和预定点钟每单只能选择一位技师');
  const participants=selected.map((tech,index)=>{const input=document.querySelector(`[data-manager-tech-allocation="${tech.id}"]`);return {technicianId:tech.id,allocationBp:reservation?10000:selected.length===1?10000:Math.round(Number(input?.value||0)*100)};});
  if(!reservation&&(participants.some(item=>!Number.isInteger(item.allocationBp)||item.allocationBp<=0)||participants.reduce((sum,item)=>sum+item.allocationBp,0)!==10000))return managerToast('技师业绩分配比例必须大于 0%，且合计正好为 100%');
  const endpoint=reservation?`${managerApi}/service-reservations`:`${managerApi}/service-sessions/clock-in`;
  const body=reservation?{technicianId:selected[0].id,roomId:form.get('roomId'),serviceItemId:service.id,plannedDurationMinutes:duration,reservationType:clockType,note:null}:{technicianId:selected[0].id,participants,roomId:form.get('roomId'),serviceItemId:service.id,plannedDurationMinutes:duration,clockType};
  const response=await fetch(endpoint,{method:'POST',headers:{...managerStoreHeaders(),'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok){const detail=(await response.text()).replace(/^"|"$/g,'');return managerToast(`${reservation?'预约登记':'上钟'}失败：${detail||'技师或房间状态已变化'}`);}
  document.querySelector('#manager-clock-dialog').close();
  managerClockingTechIds=[]; managerClockingRoomId='';
  await loadManagerDashboard({manual:false});
  managerToast(reservation?`${selected[0].name} 已登记${managerClockTypeLabel[clockType]}`:`${selected.map(item=>item.name).join('、')} 已安排上钟`);
  }finally{submit.disabled=false;}
}
let managerLiveRoomsSnapshot=[];
function managerLiveTechnicianCard(technician){
  const status=technician.status||'IDLE';
  const queue=Number(technician.queuePosition||0);
  const location=technician.roomCode?`${managerEscape(technician.roomCode)} 房${technician.roomName?` · ${managerEscape(technician.roomName)}`:''}`:'尚未安排房间';
  const service=technician.serviceNameSnapshot?managerEscape(technician.serviceNameSnapshot):'当前无进行中项目';
  const clock=technician.clockType?` · ${managerEscape(managerClockTypeLabel[technician.clockType]||technician.clockType)}`:'';
  let timing='可立即安排';
  if(status==='IN_SERVICE')timing=`上钟 ${managerTime(technician.startedAt)} · 预计 ${managerTime(technician.expectedEndAt)}结束`;
  else if(status==='PENDING_ACCEPTANCE')timing=`等待接单${technician.acceptanceDeadlineAt?` · ${managerTime(technician.acceptanceDeadlineAt)}前确认`:''}`;
  else if(status==='ACCEPTED')timing='已接单，等待开始服务';
  const arrangeButton=managerCanArrange&&status==='IDLE'?`<button class="manager-live-arrange-button" type="button" data-manager-clock-tech="${managerEscape(technician.technicianId)}">安排上钟</button>`:'';
  return `<article class="manager-live-technician ${managerEscape(status)}"><div class="manager-live-technician-top"><div><strong>${managerEscape(technician.technicianCode)} · ${managerEscape(technician.technicianName)}</strong><small>${queue?`当日轮钟第 ${queue} 位`:'暂未进入当日轮钟'}</small></div><div class="manager-live-technician-actions"><span class="manager-technician-status ${managerEscape(status)}">${managerEscape(managerTechnicianStatusLabel[status]||status)}</span>${arrangeButton}</div></div><p>${location}</p><small>${service}${clock}</small><small>${timing}</small></article>`;
}
function renderManagerLiveTechnicians(overview={}){
  const target=document.querySelector('#manager-live-technician-groups');
  const summary=document.querySelector('#manager-live-technician-summary');
  const attention=document.querySelector('#manager-live-technician-attention');
  if(!target||!summary||!attention)return;
  const technicians=[...(overview.technicians||[])].sort((left,right)=>(managerTechnicianStatusOrder[left.status]??9)-(managerTechnicianStatusOrder[right.status]??9)||Number(left.queuePosition||999999)-Number(right.queuePosition||999999)||String(left.technicianCode||'').localeCompare(String(right.technicianCode||''),'zh-CN',{numeric:true}));
  const serving=technicians.filter(item=>item.status==='IN_SERVICE').length;
  const waiting=technicians.filter(item=>['PENDING_ACCEPTANCE','ACCEPTED'].includes(item.status)).length;
  const idle=technicians.filter(item=>item.status==='IDLE').length;
  summary.textContent=`服务 ${serving} · 待处理 ${waiting} · 空闲 ${idle}`;
  const reassignment=Number(overview.reassignmentRequiredCount||0);
  const cancelled=Number(overview.dispatchCancelledCount||0);
  attention.classList.toggle('hidden',reassignment+cancelled===0);
  attention.innerHTML=[reassignment?`待重新派单 ${reassignment} 项`:'',cancelled?`待与顾客沟通 ${cancelled} 项`:''].filter(Boolean).join(' · ');
  const groups=[
    ['待接单/待开始',technicians.filter(item=>['PENDING_ACCEPTANCE','ACCEPTED'].includes(item.status))],
    ['正在上钟',technicians.filter(item=>item.status==='IN_SERVICE')],
    ['空闲轮钟',technicians.filter(item=>item.status==='IDLE')]
  ];
  target.innerHTML=groups.map(([title,rows])=>`<section class="manager-live-technician-group"><div><b>${title}</b><span>${rows.length} 位</span></div><div>${rows.map(managerLiveTechnicianCard).join('')||'<p class="manager-live-technician-empty">当前无技师</p>'}</div></section>`).join('')||'<p class="comparison-empty">当前门店暂无启用技师</p>';
}
function renderManagerDashboard(report,dailyReport,rooms,statuses,technicians,sessions,pending,refunds,liveRooms=[],liveTechnicians={}) {
  managerCurrentBusinessDate=report?.businessDate||managerToday();
  const roomCount=liveRooms.length?liveRooms.reduce((count,room)=>{count[room.status]=(count[room.status]||0)+1;return count;},{}):countRoomStatuses(rooms,statuses);
  const dailyValues=dailyReport?.currentValues;
  const hasDailyReport=Number.isFinite(Number(dailyValues?.dailySalesCents))&&Number.isFinite(Number(dailyValues?.dailyCashFlowCents));
  const dailySalesText=hasDailyReport?managerMoney(dailyValues.dailySalesCents):'--';
  const dailyCashFlowText=hasDailyReport?managerMoney(dailyValues.dailyCashFlowCents):'--';
  const dailyReportLabel=hasDailyReport?'前台日报同步':'前台日报暂不可用';
  document.querySelector('#manager-business-date').textContent=`${report.businessDate} 经营概览`;
  document.querySelector('#manager-sync-time').textContent=`${new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date())} 已同步`;
  document.querySelector('#metric-sales').textContent=dailySalesText;
  document.querySelector('#metric-order-count').textContent=dailyReportLabel;
  document.querySelector('#metric-service').textContent=dailyCashFlowText;
  document.querySelector('#metric-service-count').textContent=dailyReportLabel;
  document.querySelector('#metric-recharge').textContent=managerMoney(report.rechargeAmountCents);
  document.querySelector('#metric-bonus').textContent=`赠送 ${managerMoney(report.bonusAmountCents)}`;
  document.querySelector('#metric-card-open-count').textContent=Number(report.cardOpenCount||0).toLocaleString('zh-CN');
  document.querySelector('#metric-consumption').textContent=managerMoney(report.consumptionAmountCents);
  document.querySelector('#metric-net-sales').textContent=`净订单收入 ${managerMoney(report.netSalesAmountCents)}`;
  document.querySelector('#room-idle-count').textContent=roomCount.IDLE||0;
  document.querySelector('#room-serving-count').textContent=roomCount.IN_SERVICE||0;
  document.querySelector('#room-cleaning-count').textContent=roomCount.CLEANING||0;
  const liveTechnicianCount=liveRooms.flatMap(room=>room.services||[]).filter(service=>service.serviceStatus==='IN_SERVICE').reduce((count,service)=>count+Number(service.technicianCount||0),0);
  document.querySelector('#active-tech-count').textContent=liveRooms.length?liveTechnicianCount:sessions.length;
  const activeTechnicianCount=(liveTechnicians.technicians||[]).length||technicians.filter(technician=>technician.active).length;
  document.querySelector('#technician-count').textContent=`启用技师 ${activeTechnicianCount} 位`;
  document.querySelector('#pending-service-count').textContent=pending.length;
  document.querySelector('#pending-refund-count').textContent=refunds.length;
  document.querySelector('#manager-business-page-date').textContent=`${report.businessDate} 营业日`;
  document.querySelector('#manager-business-sales').textContent=dailySalesText;
  document.querySelector('#manager-business-order-count').textContent=dailyReportLabel;
  document.querySelector('#manager-business-service').textContent=dailyCashFlowText;
  document.querySelector('#manager-business-service-count').textContent=dailyReportLabel;
  document.querySelector('#manager-business-recharge').textContent=managerMoney(report.rechargeAmountCents);
  document.querySelector('#manager-business-bonus').textContent=`赠送 ${managerMoney(report.bonusAmountCents)}`;
  document.querySelector('#manager-business-card-open-count').textContent=Number(report.cardOpenCount||0).toLocaleString('zh-CN');
  document.querySelector('#manager-business-consumption').textContent=managerMoney(report.consumptionAmountCents);
  document.querySelector('#manager-business-net-sales').textContent=`净收入 ${managerMoney(report.netSalesAmountCents)}`;
  document.querySelector('#manager-business-room-idle').textContent=roomCount.IDLE||0;
  document.querySelector('#manager-business-room-serving').textContent=roomCount.IN_SERVICE||0;
  document.querySelector('#manager-business-room-cleaning').textContent=roomCount.CLEANING||0;
  document.querySelector('#manager-business-active-tech').textContent=liveRooms.length?liveTechnicianCount:sessions.length;
  renderManagerLiveRooms(liveRooms);
  renderManagerLiveTechnicians(liveTechnicians);
}
const managerPercent=value=>`${Number(value||0).toFixed(2)}%`;
function managerServiceMetric(label,value,tone,percent=false){return `<article class="${tone}"><span>${label}</span><strong>${percent?managerPercent(value):Number(value||0).toLocaleString('zh-CN')}</strong></article>`;}
function renderManagerServiceStructure(report,clockSummary){
  const daily=document.querySelector('#manager-service-daily');
  const monthly=document.querySelector('#manager-service-monthly');
  if(!daily||!monthly)return;
  const values=report?.currentValues||{};
  const month=report?.monthly||{};
  const derived=report?.derived||{};
  const dailyClocks=clockSummary?.daily||{};
  const monthlyClocks=clockSummary?.monthly||{};
  daily.innerHTML=[managerServiceMetric('总客流',values.dailyCustomerCount,'traffic'),managerServiceMetric('排钟',dailyClocks.queueCount,'queue'),managerServiceMetric('点钟',dailyClocks.callCount,'call'),managerServiceMetric('加钟',dailyClocks.extensionCount,'extension'),managerServiceMetric('加点钟率',derived.dailyServiceClockRate,'rate',true)].join('');
  monthly.innerHTML=[managerServiceMetric('总客流',month.customerCount,'traffic'),managerServiceMetric('累计排钟',monthlyClocks.queueCount,'queue'),managerServiceMetric('累计点钟',monthlyClocks.callCount,'call'),managerServiceMetric('累计加钟',monthlyClocks.extensionCount,'extension'),managerServiceMetric('加点钟率',derived.monthlyServiceClockRate,'rate',true)].join('');
}
const managerEscape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const managerSignedMoney=cents=>`${Number(cents||0)<0?'-':''}${managerMoney(Math.abs(Number(cents||0)))}`;
const managerClockTypeLabel={QUEUE:'排钟',CALL:'点钟',SELECTED:'选钟',BOOKED_QUEUE:'预定排钟',BOOKED_CALL:'预定点钟',EXTENSION:'加钟'};
function managerCommissionPeriod(){
  const input=document.querySelector('#manager-commission-month');
  if(!input.value)input.value=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7);
  const [year,month]=input.value.split('-').map(Number);
  const from=`${year}-${String(month).padStart(2,'0')}-01`;
  const to=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(year,month,0));
  return {from,to};
}
function renderManagerCommissions(){
  const technicianId=document.querySelector('#manager-commission-technician').value;
  const selectedSummary=managerCommissionSummaries.find(row=>row.technicianId===technicianId);
  const totalBase=selectedSummary?Number(selectedSummary.baseAmountCents||0):managerCommissionSummaries.reduce((sum,row)=>sum+Number(row.baseAmountCents||0),0);
  const totalCommission=selectedSummary?Number(selectedSummary.commissionCents||0):managerCommissionSummaries.reduce((sum,row)=>sum+Number(row.commissionCents||0),0);
  document.querySelector('#manager-commission-base').textContent=managerSignedMoney(totalBase);
  document.querySelector('#manager-commission-total').textContent=managerSignedMoney(totalCommission);
  document.querySelector('#manager-commission-tech-count').textContent=managerCommissionSummaries.length;
  const selectedName=selectedSummary?.technicianNameSnapshot||'';
  document.querySelector('#manager-commission-record-title').textContent=selectedName?`${selectedName} · 项目明细`:'技师汇总';
  const target=document.querySelector('#manager-commission-records');
  if(!technicianId){
    target.innerHTML=managerCommissionSummaries.map(row=>`<article><div><b>${managerEscape(row.technicianNameSnapshot)}</b><small>${row.recordCount} 条有效提成记录 · 项目业绩 ${managerSignedMoney(row.baseAmountCents)}</small></div><div><strong>${managerSignedMoney(row.commissionCents)}</strong><em>实际提成</em></div><button type="button" data-manager-commission-tech="${row.technicianId}">查看项目明细</button></article>`).join('')||'<p class="comparison-empty">本月暂无有效技师提成</p>';
  } else {
    const rows=managerCommissionDetails.filter(row=>row.technicianId===technicianId);
    target.innerHTML=rows.map(row=>{const tier=row.commissionTierNameSnapshot||'基础档';const multiplier=(Number(row.commissionMultiplierBpSnapshot||10000)/100).toFixed(2).replace(/\.00$/,'');return `<article><div><b>${managerEscape(row.serviceNameSnapshot)}</b><small>${managerEscape(managerClockTypeLabel[row.clockType]||row.clockType||'—')} · ${managerEscape(row.orderNoSnapshot)} · ${managerEscape(tier)} ${multiplier}%</small></div><div><strong>${managerSignedMoney(row.commissionCents)}</strong><em>业绩 ${managerSignedMoney(row.baseAmountCents)}</em></div></article>`;}).join('')||'<p class="comparison-empty">该技师本月暂无有效提成明细</p>';
  }
  renderManagerCommissionAdjustments();
}
const managerCommissionAdjustmentLabel={REFUND_REVERSAL:'退款冲回',ORDER_VOID_REVERSAL:'作废冲回',BUSINESS_CORRECTION_REVERSAL:'改单冲回'};
function renderManagerCommissionAdjustments(){
  const technicianId=document.querySelector('#manager-commission-technician').value;
  const rows=managerCommissionAdjustments.filter(row=>!technicianId||row.technicianId===technicianId);
  const target=document.querySelector('#manager-commission-adjustments');
  target.innerHTML=rows.map(row=>`<article class="reversal"><div><b>${managerEscape(managerCommissionAdjustmentLabel[row.recordType]||'提成调整')}</b><small>${managerEscape(row.serviceNameSnapshot||'—')} · ${managerEscape(row.adjustmentReferenceNo||row.orderNoSnapshot||'—')} · ${managerEscape(row.adjustmentReason||'系统调整')}</small></div><div><strong>${managerSignedMoney(row.commissionCents)}</strong><em>业绩 ${managerSignedMoney(row.baseAmountCents)}</em></div></article>`).join('')||'<p class="comparison-empty">所选月份暂无提成调整记录</p>';
}
async function loadManagerCommissions(){
  const {from,to}=managerCommissionPeriod();
  const [summaries,details,adjustments]=await Promise.all([
    managerJson(`/commissions/summary?from=${from}&to=${to}`),
    managerJson(`/commissions/records?from=${from}&to=${to}`),
    managerJson(`/commissions/adjustments?from=${from}&to=${to}`)
  ]);
  managerCommissionSummaries=summaries;
  managerCommissionDetails=details;
  managerCommissionAdjustments=adjustments;
  const select=document.querySelector('#manager-commission-technician');
  const selected=select.value;
  select.innerHTML='<option value="">全部技师汇总</option>'+summaries.map(row=>`<option value="${row.technicianId}">${managerEscape(row.technicianNameSnapshot)}</option>`).join('');
  select.value=summaries.some(row=>row.technicianId===selected)?selected:'';
  renderManagerCommissions();
}
function channelAmount(items,method){return (items.find(item=>item.paymentMethod===method)||{}).amountCents||0;}
function renderManagerChannels(summary,methods=[]){const configured=methods.length?methods:[{code:'CASH',name:'现金'},{code:'WECHAT',name:'微信'},{code:'MEMBER_BALANCE',name:'会员余额'},{code:'OTHER',name:'其他'}];const activeCodes=new Set([...summary.sales,...summary.refunds].map(item=>item.paymentMethod));const rows=configured.filter(method=>method.active!==false||activeCodes.has(method.code)).map(method=>({method:method.code,label:method.name,amount:channelAmount(summary.sales,method.code)-channelAmount(summary.refunds,method.code),refund:channelAmount(summary.refunds,method.code)}));const maximum=Math.max(1,...rows.map(row=>Math.abs(Number(row.amount||0))));document.querySelector('#manager-channel-list').innerHTML=rows.map(row=>`<article><div class="manager-channel-head"><span>${managerEscape(row.label)}</span><strong>${managerSignedMoney(row.amount)}</strong></div><div class="manager-channel-track"><i style="width:${Math.max(3,Math.round(Math.abs(Number(row.amount||0))/maximum*100))}%"></i></div><small>订单退款 ${managerMoney(row.refund)}</small></article>`).join('')+`<article class="manager-channel-cash"><div class="manager-channel-head"><span>现金净额</span><strong>${managerSignedMoney(summary.cashNetCents)}</strong></div><small>仅统计前台订单现金收款减订单现金退款</small></article>`;}
function renderManagerStoreComparison(rows){const target=document.querySelector('#manager-store-comparison');target.innerHTML=rows.map((row,index)=>`<article><div class="comparison-store"><span>${index+1}</span><b>${row.storeName}</b><small>${row.storeCode}</small></div><div class="comparison-metrics"><div><span>净营业额</span><strong>${managerMoney(row.salesAmountCents)}</strong></div><div><span>服务业绩</span><strong>${managerMoney(row.serviceAmountCents)} / ${row.completedServiceCount} 次</strong></div><div><span>会员充值</span><strong>${managerMoney(row.rechargeAmountCents)}</strong></div><div><span>现金净额</span><strong>${managerMoney(row.cashNetCents)}</strong></div></div><p class="comparison-operation">服务中 ${row.roomServingCount}/${row.activeRoomCount} 间 · 清洁 ${row.roomCleaningCount} 间 · 技师 ${row.activeTechnicianCount} 位 · 待结算 ${row.pendingSettlementCount} · 待退款 ${row.pendingRefundCount}</p></article>`).join('')||'<p class="comparison-empty">当前账号未分配可对比门店</p>';}
async function loadManagerStoreComparison(){const sort=document.querySelector('#manager-comparison-sort').value;const rows=await managerJson(`/operations/store-comparison?sort=${encodeURIComponent(sort)}`,managerHeaders());renderManagerStoreComparison(rows);}
const managerAlertLabel={PENDING_REFUND:'待确认退款',PENDING_SETTLEMENT:'待结算服务',CLEANING_ROOM:'待完成清洁'};
function renderManagerStoreAlerts(rows){document.querySelector('#manager-alert-subtitle').textContent=rows.length?`${rows.length} 项需要处理`:'当前没有待处理事项';document.querySelector('#manager-store-alerts').innerHTML=rows.map(row=>`<article><span class="manager-alert-type ${row.alertType}">${managerAlertLabel[row.alertType]||row.alertTitle}</span><div><b>${row.storeName}</b><small>${row.storeCode} · ${row.alertCount} 项</small></div><button type="button" data-manager-alert-store="${row.storeId}">查看</button></article>`).join('')||'<p class="comparison-empty">当前没有需要处理的经营待办</p>';}
async function loadManagerStoreAlerts(){renderManagerStoreAlerts(await managerJson('/operations/store-alerts',managerHeaders()));}
let managerCrossStoreTimer=null;
const managerCrossStoreLabel={ORDER:'订单',REFUND:'退款',CONSUMPTION:'会员消费'};
function renderManagerCrossStoreTransactions(rows){document.querySelector('#manager-cross-store-records').innerHTML=rows.map(row=>{const amount=Number(row.amountCents||0);const signed=row.transactionType==='CONSUMPTION'?`-${managerMoney(Math.abs(amount))}`:managerMoney(amount);return `<article><span class="manager-cross-store-type ${row.transactionType}">${managerCrossStoreLabel[row.transactionType]||row.transactionType}</span><div><b>${row.memberName} · ${signed}</b><small>${row.storeName} · ${row.referenceNo} · ${row.paymentMethod||row.status||'—'}</small><small>${row.serviceTrace||'无关联服务'}</small></div><button type="button" data-manager-cross-store="${row.storeId}">切换</button></article>`;}).join('')||'<p class="comparison-empty">没有符合条件的记录</p>';}
async function loadManagerCrossStoreTransactions(){const query=document.querySelector('#manager-cross-store-search').value.trim();const type=document.querySelector('#manager-cross-store-type').value;renderManagerCrossStoreTransactions(await managerJson(`/operations/cross-store-transactions?query=${encodeURIComponent(query)}&type=${type}`,managerHeaders()));}
async function loadManagerDashboard({manual=false}={}) {
  if(managerLoading) return null;
  managerLoading=true;
  try {
    if(!managerCurrentStoreId()) throw new Error('NO_STORE');
    const canBackfill=managerHasPermission('HISTORICAL_ORDER_CREATE');
    const canViewFoundation=managerHasPermission('FRONTDESK_SETTLE')||managerHasPermission('FOUNDATION_MANAGE')||canBackfill;
    const canSettle=managerHasPermission('FRONTDESK_SETTLE');
    const canRefund=managerHasPermission('ORDER_REFUND');
    const canViewDailyReport=managerHasPermission('DAILY_REPORT_VIEW');
    const canViewExpenses=managerHasPermission('EXPENSE_STORE_VIEW');
    const canViewCommissions=managerHasPermission('REPORT_VIEW');
    const canViewPaymentMethods=managerHasPermission('FRONTDESK_SETTLE')||managerHasPermission('FOUNDATION_MANAGE')||canBackfill;
    const date=ensureManagerReportDate();
    const dateQuery=date?`?date=${encodeURIComponent(date)}`:'';
    const [report,dailyReport,clockSummary,rooms,statuses,technicians,sessions,pending,refunds,channels,paymentMethods,liveRooms,liveTechnicians,eligibility,queueSnapshot,services]=await Promise.all([
      managerJson(`/operations/daily-report${dateQuery}`),
      canViewDailyReport?managerOptionalJson(`/daily-reports${dateQuery}`,null):null,
      managerOptionalJson(`/operations/service-clock-summary${dateQuery}`,{daily:{},monthly:{}}),
      canViewFoundation?managerOptionalJson('/foundation/rooms',[]):[],
      canViewFoundation?managerOptionalJson('/rooms/statuses',[]):[],
      canViewFoundation?managerOptionalJson('/foundation/technicians',[]):[],
      canSettle?managerOptionalJson('/service-sessions?status=IN_SERVICE',[]):[],
      canSettle?managerOptionalJson('/sales-orders/pending-service-sessions',[]):[],
      canRefund?managerOptionalJson('/refunds?status=PENDING',[]):[],
      managerOptionalJson(`/operations/payment-channel-summary${dateQuery}`,{sales:[],refunds:[],recharges:[],cashNetCents:0}),
      canViewPaymentMethods?managerOptionalJson('/payment-methods?includeInactive=true',[]):[],
      managerOptionalJson('/operations/live-room-status',[]),
      managerOptionalJson('/operations/live-technician-status',{technicians:[],reassignmentRequiredCount:0,dispatchCancelledCount:0}),
      canSettle?managerOptionalJson('/technician-schedules/clock-eligibility',{technicians:[]}):{technicians:[]},
      canSettle?managerOptionalJson('/technician-queue',{technicians:[]}):{technicians:[]},
      canViewFoundation?managerOptionalJson('/foundation/service-items',[]):[]
    ]);
    managerCanArrange=canSettle;
    managerFoundationRooms=rooms||[];
    managerFoundationTechnicians=technicians||[];
    managerFoundationServices=services||[];
    managerActiveSessions=sessions||[];
    managerFoundationRoomStatuses=new Map((statuses||[]).map(item=>[String(item.roomId),item.status]));
    managerLiveRoomsSnapshot=liveRooms||[];
    managerLiveTechnicianOverview=liveTechnicians||{technicians:[]};
    managerTechnicianEligibility=new Map((eligibility?.technicians||[]).map(item=>[String(item.technicianId),item]));
    managerQueuePositions=new Map((queueSnapshot?.technicians||[]).map(item=>[String(item.technicianId),item.queuePosition]));
    renderManagerDashboard(report,dailyReport,rooms,statuses,technicians,sessions,pending,refunds,liveRooms,liveTechnicians);
    managerPaymentMethods=paymentMethods;
    renderManagerHistoricalBackfillControls();
    if(canBackfill) await managerOptionalTask(loadManagerHistoricalBackfills);
    renderManagerServiceStructure(dailyReport,clockSummary);
    renderManagerChannels(channels,managerPaymentMethods);
    if(canViewCommissions)await managerOptionalTask(loadManagerCommissions);
    await managerOptionalTask(loadManagerStoreComparison);
    await managerOptionalTask(loadManagerStoreAlerts);
    await managerOptionalTask(loadManagerCrossStoreTransactions);
    if(canViewExpenses) await managerOptionalTask(loadManagerExpenses);
    if(manual) managerToast('经营数据已刷新');
    return true;
  } catch(error) {
    if(error.message==='UNAUTHORIZED') { clearManagerSession(); showManagerLogin('登录已失效，请重新登录'); }
    else if(error.message==='FORBIDDEN') { clearManagerSession(); showManagerLogin('当前账号权限已变更，请重新登录'); }
    else if(manual) managerToast('经营数据暂时无法加载');
    return false;
  } finally { managerLoading=false; }
}
async function loadManagerStores() {
  try {
    const session=await managerJson('/admin/auth/session',managerHeaders());
    if(!isManagerIdentity(session)) throw new Error('ROLE_DENIED');
    saveManagerIdentity(session);
    applyManagerPermissions();
    managerStores=await managerJson('/admin/access/my-stores',managerHeaders());
    if(!managerStores.length) throw new Error('NO_STORE');
    renderManagerStores();
    showManagerDashboard();
    await loadManagerDashboard();
  } catch(error) {
    clearManagerSession();
    const message=error.message==='NO_STORE'?'当前账号未分配可访问门店':error.message==='ROLE_DENIED'?'请使用店长账号登录':'管理登录已失效，请重新登录';
    showManagerLogin(message);
  }
}

document.querySelector('#manager-login-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const formElement=event.currentTarget;
  const form=new FormData(formElement);
  const response=await fetch(`${managerApi}/admin/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({loginName:form.get('loginName'),password:form.get('password')})});
  if(!response.ok) return managerToast('管理账号或密码错误');
  const session=await response.json();
  if(!isManagerIdentity(session)) return managerToast('请使用店长账号登录');
  localStorage.setItem(managerTokenKey,session.accessToken);
  saveManagerIdentity(session);
  formElement.reset();
  await loadManagerStores();
});
document.querySelector('#manager-store-select').addEventListener('change',async event=>{if(!managerStores.some(store=>store.id===event.target.value)){renderManagerStores();return managerToast('该门店未分配给当前账号');}resetManagerExtensionState({close:true});localStorage.setItem(managerStoreKey,event.target.value);await loadManagerDashboard();});
document.querySelector('#manager-report-date').addEventListener('change',()=>loadManagerDashboard({manual:true}).catch(()=>managerToast('所选营业日数据暂时无法加载')));
document.querySelector('#manager-tabbar').addEventListener('click',event=>{const button=event.target.closest('[data-manager-nav]');if(!button||button.classList.contains('hidden'))return;switchManagerPage(button.dataset.managerNav);});
document.querySelector('.manager-home-shortcuts').addEventListener('click',event=>{const button=event.target.closest('[data-manager-shortcut]');if(!button)return;const nav=document.querySelector(`[data-manager-nav="${button.dataset.managerShortcut}"]`);if(!nav||nav.classList.contains('hidden'))return managerToast('当前账号没有该模块权限');switchManagerPage(button.dataset.managerShortcut);});
document.querySelector('#manager-open-dispatch').addEventListener('click',()=>openManagerClockDialog());
document.querySelector('#manager-live-room-list').addEventListener('click',event=>{const extension=event.target.closest('[data-manager-extension-session]');if(extension)return openManagerExtension(extension.dataset.managerExtensionSession,extension.dataset.managerExtensionTech).catch(handleManagerExtensionFailure);const button=event.target.closest('[data-manager-clock-room]');if(button)openManagerClockDialog({roomId:button.dataset.managerClockRoom});});
document.querySelector('#manager-live-technician-groups').addEventListener('click',event=>{const button=event.target.closest('[data-manager-clock-tech]');if(button)openManagerClockDialog({technicianId:button.dataset.managerClockTech});});
document.querySelector('#manager-clock-close').addEventListener('click',()=>document.querySelector('#manager-clock-dialog').close());
document.querySelector('#manager-clock-cancel').addEventListener('click',()=>document.querySelector('#manager-clock-dialog').close());
document.querySelector('#manager-clock-form').addEventListener('submit',event=>submitManagerClock(event).catch(()=>managerToast('安排上钟失败，请刷新后重试')));
document.querySelector('#manager-clock-type').addEventListener('change',event=>{const reservation=['BOOKED_QUEUE','BOOKED_CALL'].includes(event.target.value);if(reservation&&managerClockingTechIds.length>1){managerClockingTechIds=[managerClockingTechIds[0]];managerToast('预约服务保持单技师，已保留第一位技师');}renderManagerClockDialog();});
document.querySelector('#manager-clock-service').addEventListener('change',event=>{const service=managerFoundationServices.find(item=>String(item.id)===String(event.target.value));const duration=document.querySelector('#manager-clock-duration');if(duration)duration.value=Number(service?.defaultDurationMinutes||0)||'';});
document.querySelector('#manager-clock-room').addEventListener('change',event=>{managerClockingRoomId=event.target.value;});
document.querySelector('#manager-clock-tech-list').addEventListener('click',event=>{const button=event.target.closest('[data-manager-clock-tech]');if(!button)return;const id=button.dataset.managerClockTech;const selectedIndex=managerClockingTechIds.findIndex(item=>String(item)===String(id));const reservation=['BOOKED_QUEUE','BOOKED_CALL'].includes(document.querySelector('#manager-clock-type').value);if(selectedIndex>=0)managerClockingTechIds.splice(selectedIndex,1);else if(reservation&&managerClockingTechIds.length)managerClockingTechIds=[id];else if(managerClockingTechIds.length>=4)return managerToast('一单最多安排 4 位技师');else managerClockingTechIds.push(id);renderManagerClockDialog();});
document.querySelector('#manager-business-period-tabs').addEventListener('click',event=>{const button=event.target.closest('[data-business-period]');if(!button)return;const period=button.dataset.businessPeriod;document.querySelectorAll('[data-business-period]').forEach(item=>item.classList.toggle('selected',item===button));document.querySelectorAll('[data-business-period-panel]').forEach(panel=>{panel.hidden=panel.dataset.businessPeriodPanel!==period;});});
document.querySelector('#manager-commission-month').addEventListener('change',()=>loadManagerCommissions().catch(()=>managerToast('提成数据暂时无法加载')));
document.querySelector('#manager-commission-technician').addEventListener('change',renderManagerCommissions);
document.querySelector('#manager-commission-records').addEventListener('click',event=>{const button=event.target.closest('[data-manager-commission-tech]');if(!button)return;const select=document.querySelector('#manager-commission-technician');select.value=button.dataset.managerCommissionTech;renderManagerCommissions();});
document.querySelector('#manager-comparison-sort').addEventListener('change',()=>loadManagerStoreComparison().catch(()=>managerToast('多门店对比暂时无法加载')));
document.querySelector('#manager-store-alerts').addEventListener('click',async event=>{const button=event.target.closest('[data-manager-alert-store]');if(!button)return;localStorage.setItem(managerStoreKey,button.dataset.managerAlertStore);document.querySelector('#manager-store-select').value=button.dataset.managerAlertStore;await loadManagerDashboard({manual:true});});
document.querySelector('#manager-cross-store-search').addEventListener('input',()=>{window.clearTimeout(managerCrossStoreTimer);managerCrossStoreTimer=window.setTimeout(()=>loadManagerCrossStoreTransactions().catch(()=>managerToast('跨门店记录暂时无法加载')),260);});
document.querySelector('#manager-cross-store-type').addEventListener('change',()=>loadManagerCrossStoreTransactions().catch(()=>managerToast('跨门店记录暂时无法加载')));
document.querySelector('#manager-cross-store-records').addEventListener('click',async event=>{const button=event.target.closest('[data-manager-cross-store]');if(!button)return;localStorage.setItem(managerStoreKey,button.dataset.managerCrossStore);document.querySelector('#manager-store-select').value=button.dataset.managerCrossStore;await loadManagerDashboard({manual:true});});
document.querySelector('#manager-refresh').addEventListener('click',()=>loadManagerDashboard({manual:true}));
document.querySelector('#manager-logout').addEventListener('click',()=>{clearManagerSession();showManagerLogin('已退出管理端');});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!document.querySelector('#manager-dashboard').classList.contains('hidden'))loadManagerDashboard();});
window.setInterval(()=>{if(document.visibilityState==='visible'&&!document.querySelector('#manager-dashboard').classList.contains('hidden'))loadManagerDashboard();},30000);

let managerExpenseCategories=[];
let managerExpenseEditingId=null;
let managerExpenseDetail=null;
const managerExpenseStatusLabel={DRAFT:'\u8349\u7A3F',SUBMITTED:'\u5F85\u5BA1\u6838',RETURNED:'\u5DF2\u9000\u56DE',APPROVED:'\u5DF2\u901A\u8FC7',REJECTED:'\u5DF2\u9A73\u56DE',PAID:'\u5DF2\u4ED8\u6B3E',WITHDRAWN:'\u5DF2\u64A4\u56DE'};
const managerExpenseAccountingStatuses=['SUBMITTED','APPROVED','PAID'];
const managerExpenseEscape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const managerExpenseMoney=cents=>`\u00a5${(Number(cents||0)/100).toFixed(2)}`;
const managerExpenseToday=()=>{const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;};
const managerExpenseCategoryName=id=>managerExpenseCategories.find(item=>item.id===id)?.name||'\u672A\u5206\u7C7B';
async function managerExpenseError(response){try{const body=await response.json();const message=body.message||body.error||`HTTP_${response.status}`;return message==='Internal Server Error'?'服务器处理报销资料失败，请刷新后重试':message;}catch{return `HTTP_${response.status}`;}}
async function loadManagerExpenseCategories(){managerExpenseCategories=await managerJson('/expense-claims/categories');const select=document.querySelector('#manager-expense-category');if(!select)return;const pending=managerExpenseCategories.find(item=>item.code==='PENDING_FINANCE_CLASSIFICATION');const specific=managerExpenseCategories.filter(item=>item.code!=='PENDING_FINANCE_CLASSIFICATION');select.innerHTML=(pending?`<option value="${pending.id}">\u5F85\u8D22\u52A1\u5206\u7C7B\uFF08\u4E0D\u786E\u5B9A\u65F6\u9009\u62E9\uFF09</option>`:'')+specific.map(item=>`<option value="${item.id}">${managerExpenseEscape(item.name)}${item.categoryLevel===1?' - \u5927\u7C7B':''}</option>`).join('');syncManagerExpenseReceiptPolicy();}
function renderManagerExpenseAttachments(attachments=[]){const target=document.querySelector('#manager-expense-attachments');if(!target)return;target.innerHTML=attachments.map(item=>`<article><span>${managerExpenseEscape(item.originalFilename)} · ${(Number(item.fileSizeBytes||0)/1024).toFixed(0)} KB</span><button type="button" data-expense-attachment="${item.id}">\u5220\u9664</button></article>`).join('');}
function renderManagerExpenseSummary(rows=[]){const amount=rows.filter(row=>managerExpenseAccountingStatuses.includes(row.status)).reduce((sum,row)=>sum+Number(row.amountCents||0),0);const pending=rows.filter(row=>row.status==='SUBMITTED').length;document.querySelector('#manager-expense-visible-count').textContent=rows.length;document.querySelector('#manager-expense-visible-amount').textContent=managerExpenseMoney(amount);document.querySelector('#manager-expense-pending-count').textContent=pending;}
function renderManagerExpenseList(rows=[]){const target=document.querySelector('#manager-expense-list');if(!target)return;target.innerHTML=rows.map(row=>{const status=row.status||'DRAFT';const canEdit=managerHasPermission('EXPENSE_SUBMIT')&&(status==='DRAFT'||status==='RETURNED');const canSubmit=canEdit;const canWithdraw=managerHasPermission('EXPENSE_SUBMIT')&&status==='SUBMITTED';const statusHint=status==='SUBMITTED'?'等待财务审核':status==='APPROVED'?'等待付款':status==='PAID'?'已完成付款':managerExpenseAccountingStatuses.includes(status)?'已进入有效金额':'不计入有效金额';return `<article class="expense-card ${status}"><div class="expense-row-head"><span class="expense-category-mark" aria-hidden="true">¥</span><div><b>${managerExpenseEscape(row.categoryName||managerExpenseCategoryName(row.expenseCategoryId))}</b><small>${managerExpenseEscape(row.expenseDate)} · ${managerExpenseEscape(row.claimNo)}</small></div><strong>${managerExpenseMoney(row.amountCents)}</strong></div><div class="expense-row-meta"><span class="expense-status ${status}">${managerExpenseStatusLabel[status]||status}</span><small>${statusHint}</small></div><div class="expense-row-actions">${canEdit?`<button type="button" data-expense-edit="${row.id}">编辑</button>`:''}${canSubmit?`<button type="button" data-expense-submit="${row.id}">提交审核</button>`:''}${canWithdraw?`<button class="danger" type="button" data-expense-withdraw="${row.id}">撤回</button>`:''}<button type="button" data-expense-detail="${row.id}">详情</button></div></article>`;}).join('')||'<p class="comparison-empty">暂无报销记录</p>';}
async function loadManagerExpenses(){if(!managerHasPermission('EXPENSE_STORE_VIEW'))return;const status=document.querySelector('#manager-expense-status')?.value||'';const [rows]=await Promise.all([managerJson(`/expense-claims?status=${encodeURIComponent(status)}`),managerExpenseCategories.length?Promise.resolve():loadManagerExpenseCategories()]);renderManagerExpenseList(rows);}
function managerExpenseFormReset(){const form=document.querySelector('#manager-expense-form');form.reset();document.querySelector('#manager-expense-date').value=managerExpenseToday();document.querySelector('#manager-expense-editor-title').textContent='\u65B0\u589E\u62A5\u9500';document.querySelector('#manager-expense-reason-field').classList.add('hidden');document.querySelector('#manager-expense-attachments').innerHTML='';managerExpenseEditingId=null;managerExpenseDetail=null;}
async function openManagerExpenseEditor(id=null){if(!managerHasPermission('EXPENSE_SUBMIT'))return managerToast('\u5F53\u524D\u8D26\u53F7\u6CA1\u6709\u62A5\u9500\u6743\u9650');await loadManagerExpenseCategories();managerExpenseFormReset();if(id){const detail=await managerJson(`/expense-claims/${id}`);const claim=detail.claim;managerExpenseEditingId=id;managerExpenseDetail=detail;const form=document.querySelector('#manager-expense-form');form.elements.expenseCategoryId.value=claim.expenseCategoryId;form.elements.expenseDate.value=claim.expenseDate;form.elements.amount.value=(Number(claim.amountCents||0)/100).toFixed(2);form.elements.paymentSource.value=claim.paymentSource;form.elements.receiptType.value=claim.receiptType;form.elements.payeeName.value=claim.payeeName||'';form.elements.invoiceNo.value=claim.invoiceNo||'';form.elements.description.value=claim.description||'';form.elements.noReceiptReason.value=claim.noReceiptReason||'';document.querySelector('#manager-expense-editor-title').textContent='\u7F16\u8F91\u62A5\u9500';renderManagerExpenseAttachments(detail.attachments||[]);}document.querySelector('#manager-expense-browser').classList.add('hidden');document.querySelector('#manager-expense-editor').classList.remove('hidden');toggleManagerExpenseReason();document.querySelector('#manager-expense-editor').scrollIntoView({behavior:'smooth',block:'start'});}
function closeManagerExpenseEditor(){document.querySelector('#manager-expense-editor').classList.add('hidden');document.querySelector('#manager-expense-browser').classList.remove('hidden');managerExpenseFormReset();}
function toggleManagerExpenseReason(){const noReceipt=document.querySelector('#manager-expense-receipt').value==='NO_RECEIPT';document.querySelector('#manager-expense-reason-field').classList.toggle('hidden',!noReceipt);document.querySelector('#manager-expense-reason-field textarea').required=noReceipt;}
function syncManagerExpenseReceiptPolicy(){const category=managerExpenseCategories.find(item=>item.id===document.querySelector('#manager-expense-category').value);const noReceiptOption=document.querySelector('#manager-expense-receipt option[value="NO_RECEIPT"]');if(!noReceiptOption||!category)return;noReceiptOption.disabled=!category.noReceiptAllowed||category.receiptRequired;if(noReceiptOption.disabled&&document.querySelector('#manager-expense-receipt').value==='NO_RECEIPT')document.querySelector('#manager-expense-receipt').value='INVOICE';toggleManagerExpenseReason();}
async function uploadManagerExpenseFiles(claimId,receiptType){const input=document.querySelector('#manager-expense-files');const files=[...(input.files||[])];if(!files.length)return true;const existing=managerExpenseDetail?.attachments?.length||0;if(existing+files.length>9){managerToast('\u5355\u636E\u6700\u591A\u4E0A\u4F20 9 \u4E2A\u51ED\u8BC1');return false;}const kind=receiptType==='NO_RECEIPT'?'NO_RECEIPT_EXPLANATION':'EXPENSE_PROOF';for(const file of files){const formData=new FormData();formData.append('file',file);const response=await fetch(`${managerApi}/expense-claims/${claimId}/attachments?attachmentKind=${kind}`,{method:'POST',headers:managerStoreHeaders(),body:formData});if(!response.ok){managerToast(`\u51ED\u8BC1\u4E0A\u4F20\u5931\u8D25: ${await managerExpenseError(response)}`);return false;}}return true;}
async function saveManagerExpense(event){event.preventDefault();const form=event.currentTarget;const data=new FormData(form);const amount=Number(data.get('amount'));if(!Number.isFinite(amount)||amount<=0)return managerToast('\u8BF7\u586B\u5199\u6B63\u786E\u91D1\u989D');const body={expenseCategoryId:data.get('expenseCategoryId'),expenseDate:data.get('expenseDate'),amountCents:Math.round(amount*100),payeeName:data.get('payeeName')||null,paymentSource:data.get('paymentSource'),receiptType:data.get('receiptType'),invoiceNo:data.get('invoiceNo')||null,description:data.get('description'),noReceiptReason:data.get('noReceiptReason')||null};const url=managerExpenseEditingId?`${managerApi}/expense-claims/${managerExpenseEditingId}`:`${managerApi}/expense-claims`;const response=await fetch(url,{method:managerExpenseEditingId?'PUT':'POST',headers:{...managerStoreHeaders(),'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)return managerToast(`\u4FDD\u5B58\u5931\u8D25: ${await managerExpenseError(response)}`);const detail=await response.json();managerExpenseEditingId=detail.claim.id;managerExpenseDetail=detail;const uploaded=await uploadManagerExpenseFiles(detail.claim.id,body.receiptType);if(!uploaded)return;closeManagerExpenseEditor();await loadManagerExpenses();managerToast('\u62A5\u9500\u8349\u7A3F\u5DF2\u4FDD\u5B58');}
async function managerExpenseAction(id,action,message){const response=await fetch(`${managerApi}/expense-claims/${id}/${action}`,{method:'POST',headers:managerStoreHeaders()});if(!response.ok)return managerToast(`${message}: ${await managerExpenseError(response)}`);await loadManagerExpenses();managerToast(message+'\u6210\u529F');}
async function deleteManagerExpenseAttachment(attachmentId){if(!managerExpenseEditingId)return;const response=await fetch(`${managerApi}/expense-claims/${managerExpenseEditingId}/attachments/${attachmentId}`,{method:'DELETE',headers:managerStoreHeaders()});if(!response.ok)return managerToast(`\u5220\u9664\u5931\u8D25: ${await managerExpenseError(response)}`);const detail=await managerJson(`/expense-claims/${managerExpenseEditingId}`);managerExpenseDetail=detail;renderManagerExpenseAttachments(detail.attachments||[]);managerToast('\u51ED\u8BC1\u5DF2\u5220\u9664');}
document.querySelector('#manager-expense-new').addEventListener('click',()=>openManagerExpenseEditor().catch(()=>managerToast('\u65E0\u6CD5\u6253\u5F00\u62A5\u9500\u8868\u5355')));document.querySelector('#manager-expense-category').addEventListener('change',syncManagerExpenseReceiptPolicy);
document.querySelector('#manager-expense-close').addEventListener('click',closeManagerExpenseEditor);document.querySelector('#manager-expense-cancel').addEventListener('click',closeManagerExpenseEditor);document.querySelector('#manager-expense-form').addEventListener('submit',saveManagerExpense);document.querySelector('#manager-expense-receipt').addEventListener('change',toggleManagerExpenseReason);document.querySelector('#manager-expense-status').addEventListener('change',()=>loadManagerExpenses().catch(()=>managerToast('\u62A5\u9500\u8BB0\u5F55\u52A0\u8F7D\u5931\u8D25')));document.querySelector('#manager-expense-refresh').addEventListener('click',()=>loadManagerExpenses().then(()=>managerToast('\u62A5\u9500\u8BB0\u5F55\u5DF2\u5237\u65B0')).catch(()=>managerToast('\u62A5\u9500\u8BB0\u5F55\u52A0\u8F7D\u5931\u8D25')));
document.querySelector('#manager-expense-list').addEventListener('click',async event=>{const edit=event.target.closest('[data-expense-edit]');if(edit)return openManagerExpenseEditor(edit.dataset.expenseEdit).catch(()=>managerToast('\u62A5\u9500\u8BE6\u60C5\u52A0\u8F7D\u5931\u8D25'));const detail=event.target.closest('[data-expense-detail]');if(detail){try{const data=await managerJson(`/expense-claims/${detail.dataset.expenseDetail}`);const note=data.claim.reviewNote?`\n\u5BA1\u6838\u610F\u89C1: ${data.claim.reviewNote}`:'';managerToast(`${managerExpenseStatusLabel[data.claim.status]||data.claim.status}${note}`);}catch{managerToast('\u8BE6\u60C5\u52A0\u8F7D\u5931\u8D25');}return;}const submit=event.target.closest('[data-expense-submit]');if(submit){if(!window.confirm('\u786E\u8BA4\u63D0\u4EA4\u8BE5\u62A5\u9500\uFF1F'))return;return managerExpenseAction(submit.dataset.expenseSubmit,'submit','\u63D0\u4EA4');}const withdraw=event.target.closest('[data-expense-withdraw]');if(withdraw){if(!window.confirm('\u786E\u8BA4\u64A4\u56DE\u8BE5\u62A5\u9500\uFF1F'))return;return managerExpenseAction(withdraw.dataset.expenseWithdraw,'withdraw','\u64A4\u56DE');}});
document.querySelector('#manager-expense-attachments').addEventListener('click',event=>{const button=event.target.closest('[data-expense-attachment]');if(button)deleteManagerExpenseAttachment(button.dataset.expenseAttachment);});

let managerExpensePreviewUrl=null;
let managerExpenseLocalUrls=[];
function managerExpenseFormReset(){const form=document.querySelector('#manager-expense-form');form.reset();document.querySelector('#manager-expense-date').value=managerExpenseToday();document.querySelector('#manager-expense-editor-title').textContent='新增报销';document.querySelector('#manager-expense-reason-field').classList.add('hidden');document.querySelector('#manager-expense-attachments').innerHTML='';document.querySelector('#manager-expense-local-files').innerHTML='';managerExpenseLocalUrls.forEach(url=>URL.revokeObjectURL(url));managerExpenseLocalUrls=[];managerExpenseEditingId=null;managerExpenseDetail=null;}
function renderManagerExpenseAttachments(attachments=[]){const target=document.querySelector('#manager-expense-attachments');if(!target)return;target.innerHTML=attachments.map(item=>`<article><span title="${managerExpenseEscape(item.originalFilename)}">${managerExpenseEscape(item.originalFilename)} · ${(Number(item.fileSizeBytes||0)/1024).toFixed(0)} KB</span><span><button type="button" data-expense-preview="${item.id}" data-expense-preview-name="${managerExpenseEscape(item.originalFilename)}" data-expense-preview-type="${managerExpenseEscape(item.contentType)}">预览</button><button class="danger" type="button" data-expense-attachment="${item.id}">删除</button></span></article>`).join('');}
function renderManagerExpenseLocalFiles(){const target=document.querySelector('#manager-expense-local-files');const files=[...(document.querySelector('#manager-expense-files')?.files||[])];managerExpenseLocalUrls.forEach(url=>URL.revokeObjectURL(url));managerExpenseLocalUrls=[];target.innerHTML=files.map(file=>{const url=URL.createObjectURL(file);managerExpenseLocalUrls.push(url);return `<article><span title="${managerExpenseEscape(file.name)}">待上传：${managerExpenseEscape(file.name)} · ${(file.size/1024).toFixed(0)} KB</span><button type="button" data-local-preview="${managerExpenseLocalUrls.at(-1)}" data-local-preview-name="${managerExpenseEscape(file.name)}" data-local-preview-type="${managerExpenseEscape(file.type)}">预览</button></article>`;}).join('');}
function validateManagerExpenseFiles(files,existingCount=0){const allowed=['image/jpeg','image/png','application/pdf'];if(existingCount+files.length>9)return '单据最多上传 9 个凭证';for(const file of files){if(!allowed.includes(file.type))return '只支持 JPG、PNG、PDF 文件';if(file.size>10*1024*1024)return '单个凭证不能超过 10MB';}return '';}
async function uploadManagerExpenseFilesSafe(claimId,receiptType,detail){const input=document.querySelector('#manager-expense-files');const files=[...(input.files||[])];const error=validateManagerExpenseFiles(files,detail?.attachments?.length||0);if(error){managerToast(error);return false;}const kind=receiptType==='NO_RECEIPT'?'NO_RECEIPT_EXPLANATION':'EXPENSE_PROOF';for(const file of files){const formData=new FormData();formData.append('file',file);const response=await fetch(`${managerApi}/expense-claims/${claimId}/attachments?attachmentKind=${kind}`,{method:'POST',headers:managerStoreHeaders(),body:formData});if(!response.ok){managerToast(`凭证上传失败：${await managerExpenseError(response)}`);return false;}}return true;}
async function saveManagerExpenseEnhanced(submitAfter=false){const form=document.querySelector('#manager-expense-form');const data=new FormData(form);const amount=Number(data.get('amount'));if(!data.get('expenseDate')||!Number.isFinite(amount)||amount<=0)return managerToast('请填写正确的日期和金额');if(!String(data.get('description')||'').trim())return managerToast('请填写费用说明');const currentAttachments=managerExpenseDetail?.attachments?.length||0;const fileError=validateManagerExpenseFiles([...(document.querySelector('#manager-expense-files').files||[])],currentAttachments);if(fileError)return managerToast(fileError);const body={expenseCategoryId:data.get('expenseCategoryId'),expenseDate:data.get('expenseDate'),amountCents:Math.round(amount*100),payeeName:data.get('payeeName')||null,paymentSource:data.get('paymentSource'),receiptType:data.get('receiptType'),invoiceNo:data.get('invoiceNo')||null,description:String(data.get('description')).trim(),noReceiptReason:data.get('noReceiptReason')||null};const url=managerExpenseEditingId?`${managerApi}/expense-claims/${managerExpenseEditingId}`:`${managerApi}/expense-claims`;const response=await fetch(url,{method:managerExpenseEditingId?'PUT':'POST',headers:{...managerStoreHeaders(),'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)return managerToast(`保存失败：${await managerExpenseError(response)}`);let detail=await response.json();managerExpenseEditingId=detail.claim.id;managerExpenseDetail=detail;if(!await uploadManagerExpenseFilesSafe(detail.claim.id,body.receiptType,detail))return;detail=await managerJson(`/expense-claims/${detail.claim.id}`);managerExpenseDetail=detail;if(submitAfter){const claim=detail.claim;const attachments=detail.attachments||[];const hasProof=attachments.some(item=>item.attachmentKind==='EXPENSE_PROOF');const hasExplanation=attachments.some(item=>item.attachmentKind==='NO_RECEIPT_EXPLANATION');if(claim.receiptType==='NO_RECEIPT'&&!String(claim.noReceiptReason||'').trim())return managerToast('无票报销必须填写无票说明');if(claim.receiptType==='NO_RECEIPT'&&!hasExplanation)return managerToast('无票报销必须上传说明凭证');if(claim.receiptType!=='NO_RECEIPT'&&!hasProof)return managerToast('请先上传发票或收据凭证');const submitResponse=await fetch(`${managerApi}/expense-claims/${claim.id}/submit`,{method:'POST',headers:managerStoreHeaders()});if(!submitResponse.ok)return managerToast(`提交失败：${await managerExpenseError(submitResponse)}`);}closeManagerExpenseEditor();await loadManagerExpenses();managerToast(submitAfter?'报销已提交审核':'报销草稿已保存');}
async function previewManagerExpenseAttachment(id,name,type){const response=await fetch(`${managerApi}/expense-claims/${managerExpenseEditingId}/attachments/${id}`,{headers:managerStoreHeaders()});if(!response.ok)return managerToast(`附件预览失败：${await managerExpenseError(response)}`);const blob=await response.blob();if(managerExpensePreviewUrl)URL.revokeObjectURL(managerExpensePreviewUrl);managerExpensePreviewUrl=URL.createObjectURL(blob);document.querySelector('#manager-expense-preview-title').textContent=name||'凭证预览';const target=document.querySelector('#manager-expense-preview-content');if((type||blob.type).startsWith('image/'))target.innerHTML=`<img src="${managerExpensePreviewUrl}" alt="${managerExpenseEscape(name||'凭证')}" />`;else if((type||blob.type)==='application/pdf')target.innerHTML=`<iframe src="${managerExpensePreviewUrl}" title="${managerExpenseEscape(name||'凭证')}"></iframe>`;else target.innerHTML='<p>当前文件类型不支持在线预览。</p>';document.querySelector('#manager-expense-preview').showModal();}
function previewManagerLocalFile(url,name,type){if(managerExpensePreviewUrl)URL.revokeObjectURL(managerExpensePreviewUrl);managerExpensePreviewUrl=url;document.querySelector('#manager-expense-preview-title').textContent=name||'凭证预览';const target=document.querySelector('#manager-expense-preview-content');if((type||'').startsWith('image/'))target.innerHTML=`<img src="${url}" alt="${managerExpenseEscape(name||'凭证')}" />`;else if(type==='application/pdf')target.innerHTML=`<iframe src="${url}" title="${managerExpenseEscape(name||'凭证')}"></iframe>`;else target.innerHTML='<p>当前文件类型不支持在线预览。</p>';document.querySelector('#manager-expense-preview').showModal();}
document.querySelector('#manager-expense-files').addEventListener('change',renderManagerExpenseLocalFiles);document.querySelector('#manager-expense-save-submit').addEventListener('click',()=>saveManagerExpenseEnhanced(true).catch(()=>managerToast('提交失败，请稍后重试')));document.querySelector('#manager-expense-form').addEventListener('submit',event=>{event.preventDefault();event.stopImmediatePropagation();saveManagerExpenseEnhanced(false).catch(()=>managerToast('保存失败，请稍后重试'));},true);document.querySelector('#manager-expense-attachments').addEventListener('click',event=>{const preview=event.target.closest('[data-expense-preview]');if(preview)previewManagerExpenseAttachment(preview.dataset.expensePreview,preview.dataset.expensePreviewName,preview.dataset.expensePreviewType).catch(()=>managerToast('附件预览失败'));});document.querySelector('#manager-expense-local-files').addEventListener('click',event=>{const preview=event.target.closest('[data-local-preview]');if(preview)previewManagerLocalFile(preview.dataset.localPreview,preview.dataset.localPreviewName,preview.dataset.localPreviewType);});document.querySelector('#manager-expense-preview-close').addEventListener('click',()=>document.querySelector('#manager-expense-preview').close());document.querySelector('#manager-expense-preview').addEventListener('close',()=>{document.querySelector('#manager-expense-preview-content').innerHTML='';if(managerExpensePreviewUrl&&!managerExpensePreviewUrl.startsWith('blob:')){URL.revokeObjectURL(managerExpensePreviewUrl);managerExpensePreviewUrl=null;}});

const managerExpenseDetailAction={SUBMIT:'提交审核',RESUBMIT:'重新提交',WITHDRAW:'撤回',APPROVE:'审核通过',RETURN:'退回修改',REJECT:'驳回',PAY:'确认付款'};
const managerExpenseDetailStatus={DRAFT:'草稿',SUBMITTED:'待审核',RETURNED:'已退回',APPROVED:'已通过',REJECTED:'已驳回',PAID:'已付款',WITHDRAWN:'已撤回'};
let managerExpenseDetailPreviewClaimId=null;
function renderManagerExpenseDetail(data){const claim=data.claim||{};const attachments=data.attachments||[];const history=data.history||[];const files=attachments.map(item=>`<button type="button" data-detail-attachment="${item.id}" data-detail-attachment-name="${managerExpenseEscape(item.originalFilename)}" data-detail-attachment-type="${managerExpenseEscape(item.contentType)}">${managerExpenseEscape(item.originalFilename)} · ${managerExpenseEscape(item.attachmentKind)} · ${(Number(item.fileSizeBytes||0)/1024).toFixed(0)} KB</button>`).join('')||'<span class="comparison-empty">暂无凭证</span>';const historyRows=history.map(item=>`<li><b>${managerExpenseDetailAction[item.action]||managerExpenseEscape(item.action)}：${managerExpenseDetailStatus[item.toStatus]||managerExpenseEscape(item.toStatus)}</b><small>${managerExpenseEscape(item.actorName||'系统')} · ${managerExpenseEscape(item.createdAt||'')}${item.comment?` · ${managerExpenseEscape(item.comment)}`:''}</small></li>`).join('')||'<li>暂无审核记录</li>';document.querySelector('#manager-expense-detail-title').textContent=`${claim.claimNo||'报销详情'} · ${managerExpenseDetailStatus[claim.status]||claim.status||''}`;document.querySelector('#manager-expense-detail-content').innerHTML=`<section class="manager-expense-detail-section"><h4>基本信息</h4><div class="manager-expense-detail-grid"><span>费用分类<strong>${managerExpenseEscape(claim.categoryName||managerExpenseCategoryName(claim.expenseCategoryId))}</strong></span><span>发生日期<strong>${managerExpenseEscape(claim.expenseDate)}</strong></span><span>申请金额<strong>${managerExpenseMoney(claim.amountCents)}</strong></span><span>收款方<strong>${managerExpenseEscape(claim.payeeName||'—')}</strong></span><span>付款来源<strong>${managerExpenseEscape(claim.paymentSource||'—')}</strong></span><span>票据类型<strong>${managerExpenseEscape(claim.receiptType||'—')}</strong></span><span>发票号码<strong>${managerExpenseEscape(claim.invoiceNo||'—')}</strong></span><span>提交时间<strong>${managerExpenseEscape(claim.submittedAt||'—')}</strong></span></div><p class="manager-expense-detail-note">${managerExpenseEscape(claim.description||'—')}</p>${claim.noReceiptReason?`<p class="manager-expense-detail-note warning">无票说明：${managerExpenseEscape(claim.noReceiptReason)}</p>`:''}${claim.reviewNote?`<p class="manager-expense-detail-note warning">财务审核意见：${managerExpenseEscape(claim.reviewNote)}</p>`:''}</section><section class="manager-expense-detail-section"><h4>凭证附件</h4><div class="manager-expense-detail-files">${files}</div></section><section class="manager-expense-detail-section"><h4>审核轨迹</h4><ul class="manager-expense-detail-history">${historyRows}</ul></section>`;const actions=document.querySelector('#manager-expense-detail-actions');const editable=managerHasPermission('EXPENSE_SUBMIT')&&(claim.status==='DRAFT'||claim.status==='RETURNED');actions.innerHTML=editable?`<button class="manager-secondary-button" type="button" data-detail-edit="${claim.id}">编辑</button><button class="manager-primary-button" type="button" data-detail-submit="${claim.id}">提交审核</button>`:claim.status==='SUBMITTED'?`<button class="manager-secondary-button" type="button" data-detail-withdraw="${claim.id}">撤回</button>`:'';}
async function openManagerExpenseDetail(id){const data=await managerJson(`/expense-claims/${id}`);managerExpenseDetailPreviewClaimId=id;renderManagerExpenseDetail(data);document.querySelector('#manager-expense-detail-dialog').showModal();}
async function previewManagerExpenseDetailAttachment(id,name,type){const response=await fetch(`${managerApi}/expense-claims/${managerExpenseDetailPreviewClaimId}/attachments/${id}`,{headers:managerStoreHeaders()});if(!response.ok)return managerToast(`附件预览失败：${await managerExpenseError(response)}`);const blob=await response.blob();if(managerExpensePreviewUrl)URL.revokeObjectURL(managerExpensePreviewUrl);managerExpensePreviewUrl=URL.createObjectURL(blob);document.querySelector('#manager-expense-preview-title').textContent=name||'凭证预览';const target=document.querySelector('#manager-expense-preview-content');if((type||blob.type).startsWith('image/'))target.innerHTML=`<img src="${managerExpensePreviewUrl}" alt="${managerExpenseEscape(name||'凭证')}" />`;else if((type||blob.type)==='application/pdf')target.innerHTML=`<iframe src="${managerExpensePreviewUrl}" title="${managerExpenseEscape(name||'凭证')}"></iframe>`;else target.innerHTML='<p>当前文件类型不支持在线预览。</p>';document.querySelector('#manager-expense-preview').showModal();}
async function submitManagerExpenseFromDetail(id){const data=await managerJson(`/expense-claims/${id}`);const claim=data.claim||{};const attachments=data.attachments||[];if(claim.receiptType==='NO_RECEIPT'&&!String(claim.noReceiptReason||'').trim())return managerToast('无票报销必须填写无票说明');if(claim.receiptType==='NO_RECEIPT'&&!attachments.some(item=>item.attachmentKind==='NO_RECEIPT_EXPLANATION'))return managerToast('无票报销必须上传说明凭证');if(claim.receiptType!=='NO_RECEIPT'&&!attachments.some(item=>item.attachmentKind==='EXPENSE_PROOF'))return managerToast('请先上传发票或收据凭证');if(!window.confirm('确认提交该报销？'))return;await managerExpenseAction(id,'submit','提交');document.querySelector('#manager-expense-detail-dialog').close();}
document.querySelector('#manager-expense-detail-close').addEventListener('click',()=>document.querySelector('#manager-expense-detail-dialog').close());document.querySelector('#manager-expense-list').addEventListener('click',event=>{const detail=event.target.closest('[data-expense-detail]');if(!detail)return;event.preventDefault();event.stopImmediatePropagation();openManagerExpenseDetail(detail.dataset.expenseDetail).catch(()=>managerToast('报销详情加载失败'));},true);document.querySelector('#manager-expense-detail-content').addEventListener('click',event=>{const file=event.target.closest('[data-detail-attachment]');if(file)return previewManagerExpenseDetailAttachment(file.dataset.detailAttachment,file.dataset.detailAttachmentName,file.dataset.detailAttachmentType).catch(()=>managerToast('附件预览失败'));});document.querySelector('#manager-expense-detail-actions').addEventListener('click',event=>{const edit=event.target.closest('[data-detail-edit]');if(edit){document.querySelector('#manager-expense-detail-dialog').close();return openManagerExpenseEditor(edit.dataset.detailEdit).catch(()=>managerToast('报销编辑加载失败'));}const submit=event.target.closest('[data-detail-submit]');if(submit)return submitManagerExpenseFromDetail(submit.dataset.detailSubmit).catch(()=>managerToast('提交失败，请稍后重试'));const withdraw=event.target.closest('[data-detail-withdraw]');if(withdraw){if(!window.confirm('确认撤回该报销？'))return;return managerExpenseAction(withdraw.dataset.detailWithdraw,'withdraw','撤回').then(()=>document.querySelector('#manager-expense-detail-dialog').close());}});

let managerExpenseSyncSnapshot=new Map();
let managerExpenseSyncInitialized=false;
async function loadManagerExpenses(){if(!managerHasPermission('EXPENSE_STORE_VIEW'))return;const status=document.querySelector('#manager-expense-status')?.value||'';const [rows]=await Promise.all([managerJson(`/expense-claims?status=${encodeURIComponent(status)}`),managerExpenseCategories.length?Promise.resolve():loadManagerExpenseCategories()]);const changed=managerExpenseSyncInitialized&&rows.some(row=>managerExpenseSyncSnapshot.get(row.id)&&managerExpenseSyncSnapshot.get(row.id)!==row.status)||(managerExpenseSyncInitialized&&rows.length!==managerExpenseSyncSnapshot.size);managerExpenseSyncSnapshot=new Map(rows.map(row=>[row.id,row.status]));managerExpenseSyncInitialized=true;renderManagerExpenseSummary(rows);renderManagerExpenseList(rows);if(changed){managerToast('报销状态已更新，请查看详情');if(navigator.vibrate)navigator.vibrate(140);}const sync=document.querySelector('#manager-sync-time');if(sync)sync.textContent=`${new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date())} 已同步`;}

if(localStorage.getItem(managerTokenKey))loadManagerStores(); else showManagerLogin();

// Keep payment proofs visible in the same manager detail view as expense receipts.
(function labelManagerPaymentProofs() {
  const renderer = renderManagerExpenseDetail;
  renderManagerExpenseDetail = function (data) {
    renderer(data);
    const kinds = new Map((data.attachments || []).map(item => [item.id, item.attachmentKind]));
    document.querySelectorAll('#manager-expense-detail-content [data-detail-attachment]').forEach(button => {
      const kind = kinds.get(button.dataset.detailAttachment);
      const label = kind === 'PAYMENT_PROOF' ? '付款凭证' : kind === 'EXPENSE_PROOF' ? '报销凭证' : kind === 'NO_RECEIPT_EXPLANATION' ? '无票说明' : kind;
      if (label) button.textContent = button.textContent.replace(kind, label);
    });
  };
})();

// The manager mobile surface is read-only for historical backfills. Creation
// is intentionally available only in the front-desk workflow.
let managerHistoricalBackfillRows=[];
const managerHistoricalStatusLabel={SETTLED:'已结算',CANCELLED:'已作废',DRAFT:'草稿'};
function renderManagerHistoricalBackfillControls(){
  const section=document.querySelector('#manager-backfill-section');
  if(!section)return;
  const allowed=managerHasPermission('HISTORICAL_ORDER_CREATE');
  section.classList.toggle('hidden',!allowed);
  if(!allowed)return;
  const date=document.querySelector('#manager-historical-filter-date');
  if(date&&!date.max)date.max=managerBackfillMaxDate();
  renderManagerHistoricalBackfills(managerHistoricalBackfillRows);
}
function renderManagerHistoricalBackfills(rows=managerHistoricalBackfillRows){
  const target=document.querySelector('#manager-historical-backfill-list');
  if(!target)return;
  managerHistoricalBackfillRows=Array.isArray(rows)?rows:[];
  const selectedDate=String(document.querySelector('#manager-historical-filter-date')?.value||'');
  const visible=managerHistoricalBackfillRows.filter(row=>!selectedDate||String(row.backfillDate||'')===selectedDate);
  target.innerHTML=visible.map(row=>`<article class="${managerEscape(row.status||'')} historical-backfill-row" data-manager-historical-order="${managerEscape(row.orderId||'')}"><div class="expense-row-head"><span class="expense-category-mark" aria-hidden="true">↺</span><div><b>${managerEscape(row.orderNo||'历史补单')}</b><small>${managerEscape(row.backfillDate||'—')} · ${managerEscape(row.paymentMethods||'未记录收款方式')}</small></div><strong>${managerMoney(row.paidCents||row.receivableCents)}</strong></div><div class="expense-row-meta"><small>${managerEscape(managerHistoricalStatusLabel[row.status]||row.status||'—')} · ${managerEscape(row.refundStatus||'NONE')}</small><small>${managerEscape(row.backfillByName||'操作人未记录')} · ${managerEscape(row.backfillAt||'')}</small></div></article>`).join('')||'<p class="comparison-empty">当前门店暂无匹配的历史补单记录</p>';
}
async function loadManagerHistoricalBackfills(){
  if(!managerHasPermission('HISTORICAL_ORDER_CREATE'))return;
  const rows=await managerOptionalJson('/sales-orders/historical-backfills/mine',[]);
  renderManagerHistoricalBackfills(rows);
}
(function setupManagerHistoricalBackfillReadOnly(){
  document.querySelector('#manager-historical-filter-date')?.addEventListener('change',()=>renderManagerHistoricalBackfills());
  document.querySelector('#manager-refresh-historical-backfills')?.addEventListener('click',()=>loadManagerHistoricalBackfills().catch(()=>managerToast('历史补单记录刷新失败')));
  document.querySelector('#manager-historical-backfill-list')?.addEventListener('click',event=>{
    const row=event.target.closest('[data-manager-historical-order]');
    if(row?.dataset.managerHistoricalOrder)managerToast('订单详情请在前台订单管理中查看');
  });
})();
