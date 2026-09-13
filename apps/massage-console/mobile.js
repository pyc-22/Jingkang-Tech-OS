const mobileApi = '/api/v1/mobile';
const mobileAttendanceApi = '/api/v1/technicians';
const mobileTokenKey = 'chengxin-mobile-access-token';
const mobileMoney = (cents) => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
const mobileSignedMoney = (cents) => `${Number(cents||0)<0?'-':''}${mobileMoney(Math.abs(Number(cents||0)))}`;
const mobileEscape = (value) => String(value ?? '').replace(/[&<>\"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[character]));
const mobileToast = (message) => { const element = document.querySelector('#mobile-toast'); element.textContent = message; element.classList.remove('hidden'); window.setTimeout(() => element.classList.add('hidden'), 2600); };
const mobileTime = (value) => new Intl.DateTimeFormat('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(value));
const mobileAuthHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem(mobileTokenKey)}` });
const mobileClockTypeLabel = (value) => ({ QUEUE:'排钟', CALL:'点钟', SELECTED:'选钟', BOOKED_QUEUE:'预定排钟', BOOKED_CALL:'预定点钟' }[value] || value);
const mobileScheduleReasonLabel={APPROVED_LEAVE:'今日请假',REST:'今日休息',CANCELLED:'班次已取消',NOT_SCHEDULED:'今日未排班',AVAILABLE:'可上钟',SCHEDULED:'已排班'};
document.querySelector('.performance-section').insertAdjacentHTML('beforeend','<div class="mobile-performance-range"><div class="mobile-range-tabs" id="mobile-performance-tabs"><button type="button" data-mobile-range="TODAY">今日</button><button type="button" class="selected" data-mobile-range="MONTH">本月</button><button type="button" data-mobile-range="LAST_7_DAYS">近 7 天</button></div><div class="mobile-range-summary"><span id="mobile-range-label">本月汇总</span><div class="mobile-range-money"><div><small>项目业绩</small><strong id="mobile-range-amount">¥0.00</strong></div><div class="commission-total"><small>实际提成</small><strong id="mobile-range-commission">¥0.00</strong></div></div><small><b id="mobile-range-count">0</b> 次服务 · <b id="mobile-range-minutes">0</b> 分钟 · 提成按结算及退款实时同步</small></div></div>');
document.querySelector('.performance-section .section-title').insertAdjacentHTML('afterend','<section class="mobile-daily-data"><div class="mobile-daily-toolbar"><label>查看日期<input id="mobile-daily-date" type="date"></label><button class="mobile-secondary-action" id="load-mobile-daily-data" type="button">查询</button></div><div class="performance-grid mobile-daily-grid"><article><span>排钟</span><strong id="mobile-daily-queue">0</strong><small>当天已上钟</small></article><article><span>点钟</span><strong id="mobile-daily-call">0</strong><small>含选钟</small></article><article><span>加钟</span><strong id="mobile-daily-extension">0</strong><small>有效加钟</small></article><article><span>完成服务</span><strong id="mobile-daily-completed">0</strong><small>次</small></article><article><span>服务时长</span><strong id="mobile-daily-minutes">0</strong><small>分钟</small></article><article><span>待结算</span><strong id="mobile-daily-pending">0</strong><small>完成但未结算</small></article><article><span>项目业绩</span><strong id="mobile-daily-base">¥0.00</strong><small>结算后金额</small></article><article><span>实际提成</span><strong id="mobile-daily-commission">¥0.00</strong><small>含退款冲减</small></article></div><div class="mobile-daily-list-heading"><h3>当日服务明细</h3><span id="mobile-daily-business-date"></span></div><div class="session-list" id="mobile-daily-service-list"><p class="service-empty">正在加载当日数据</p></div></section>');
document.body.insertAdjacentHTML('beforeend','<dialog id="mobile-extension-dialog"><form id="mobile-extension-form" class="mobile-clock-dialog"><div class="section-title"><div><h2>服务加钟</h2><p id="mobile-extension-subtitle">请选择加钟项目</p></div><button class="mobile-dialog-close" type="button" id="close-mobile-extension" aria-label="关闭">×</button></div><label>加钟项目<select id="mobile-extension-service" name="serviceItemId" required></select></label><div class="mobile-extension-preview" id="mobile-extension-preview"></div><div class="mobile-dialog-actions"><button class="mobile-secondary-action" type="button" id="cancel-mobile-extension">取消</button><button class="mobile-action" type="submit">确认加钟</button></div></form></dialog>');
document.body.insertAdjacentHTML('beforeend','<dialog id="mobile-room-transfer-dialog"><form id="mobile-room-transfer-form" class="mobile-clock-dialog"><div class="section-title"><div><h2>申请换房</h2><p id="mobile-room-transfer-subtitle">选择服务中的目标房间</p></div><button class="mobile-dialog-close" type="button" id="close-mobile-room-transfer" aria-label="关闭">×</button></div><label>目标房间<select id="mobile-room-transfer-room" name="toRoomId" required></select></label><label>换房原因<textarea name="reason" rows="3" maxlength="240" required placeholder="例如：客户加钟后需要更换大房"></textarea></label><div class="mobile-dialog-actions"><button class="mobile-secondary-action" type="button" id="cancel-mobile-room-transfer">取消</button><button class="mobile-action" type="submit">提交申请</button></div></form></dialog>');
document.body.insertAdjacentHTML('beforeend','<dialog id="mobile-leave-dialog" class="mobile-leave-dialog"><form id="mobile-leave-form"><div class="section-title"><div><h2>请假申请</h2><p>提交后需要等待管理员审批</p></div><button class="mobile-dialog-close" type="button" id="close-mobile-leave" aria-label="关闭">×</button></div><label>开始日期<input name="startDate" type="date" required></label><label>结束日期<input name="endDate" type="date" required></label><label>请假原因<input name="reason" maxlength="240" placeholder="可不填"></label><div class="mobile-dialog-actions"><button class="mobile-secondary-action" type="button" id="cancel-mobile-leave">取消</button><button class="mobile-action" type="submit">提交申请</button></div></form></dialog>');
document.body.insertAdjacentHTML('beforeend','<section class="mobile-dispatch-alert hidden" id="mobile-dispatch-alert" role="alertdialog" aria-live="assertive"><h2>有新的派钟安排</h2><p>请确认接单后开始服务</p><strong id="mobile-dispatch-service">服务项目</strong><small id="mobile-dispatch-detail">房间 · 时长</small><time class="mobile-dispatch-countdown" id="mobile-dispatch-countdown">接单倒计时 --:--</time><div class="mobile-dispatch-actions"><button class="mobile-action" id="confirm-mobile-dispatch" type="button">确认接单</button><button class="mobile-secondary-action" id="reject-mobile-dispatch" type="button">拒绝接单</button><button class="mobile-secondary-action" id="request-mobile-transfer" type="button">申请转单</button></div><div class="dispatch-sound-required hidden" id="dispatch-sound-required">请先点击页面顶部“开启提示音”</div></section>');
document.body.insertAdjacentHTML('beforeend','<dialog id="mobile-reject-dispatch-dialog"><form id="mobile-reject-dispatch-form" class="mobile-clock-dialog"><div class="section-title"><div><h2>拒绝接单</h2><p>拒单后前台会重新安排技师</p></div><button class="mobile-dialog-close" type="button" id="close-mobile-reject-dispatch" aria-label="关闭">×</button></div><label>拒单原因<textarea name="reason" rows="4" maxlength="240" required placeholder="请填写原因，便于前台重新派单"></textarea></label><div class="mobile-dialog-actions"><button class="mobile-secondary-action" type="button" id="cancel-mobile-reject-dispatch">取消</button><button class="mobile-action" type="submit">确认拒单</button></div></form></dialog>');
document.body.insertAdjacentHTML('beforeend','<dialog id="mobile-transfer-dialog"><form id="mobile-transfer-form" class="mobile-clock-dialog"><div class="section-title"><div><h2>申请转单</h2><p>前台审核同意后，新技师才会收到派单</p></div><button class="mobile-dialog-close" type="button" id="close-mobile-transfer" aria-label="关闭">×</button></div><label>接收技师<select name="toTechnicianId" id="mobile-transfer-technician" required></select></label><label>转单原因<textarea name="reason" rows="4" maxlength="240" required placeholder="请填写转单原因"></textarea></label><div class="mobile-dialog-actions"><button class="mobile-secondary-action" type="button" id="cancel-mobile-transfer">取消</button><button class="mobile-action" type="submit">提交申请</button></div></form></dialog>');

let mobilePerformanceRange='MONTH';
let mobileExtensionOptions={services:[]};
let mobileRoomTransferOptions={rooms:[]};
let mobileRoomTransferSessionId=null;
let mobileRoomTransferFromCode=null;
let mobileActiveSession=null;
let mobileExtensionIntents=[];
let mobileRoomTransferStatus=null;
let mobileDispatchSessionId=null;
let mobileReservationNoticeId=null;
let mobileDispatchSoundEnabled=false;
let mobileDispatchAudio=null;
let mobileDispatchDeadlineTimer=null;
let mobileTransferNoticeKey=null;
let mobileServiceReminderTimer=null;
let mobileServiceReminderSessionKey=null;
let mobileAttendanceBlocked=false;
const mobileServiceReminderAudioSources={
  'ten-minutes':'./assets/service-reminder-ten-minutes.mp3',
  'five-minutes':'./assets/service-reminder-five-minutes.mp3',
  finished:'./assets/service-reminder-finished.mp3'
};
const mobileServiceReminderAudio={};
const mobileLeaveStatus={PENDING:['待审批','pending'],APPROVED:['已批准','approved'],CANCELLED:['已取消','cancelled']};
const mobileLocalDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

function clearMobileSession() {
  localStorage.removeItem(mobileTokenKey);
  mobileAttendanceBlocked=false;
  stopMobileDispatchAlert();
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
}

function renderMobileLeaveRequests(rows) {
  document.querySelector('#mobile-leave-list').innerHTML=rows.map(row=>{
    const [label,style]=mobileLeaveStatus[row.status]||[row.status,'cancelled'];
    const reason=row.reason?` · ${row.reason}`:'';
    const review=row.reviewNote?` · ${row.reviewNote}`:'';
    return `<article class="mobile-leave-row"><div><b>${row.startDate} 至 ${row.endDate}</b><small>${label}${reason}${review}</small></div><span class="leave-status ${style}">${label}</span></article>`;
  }).join('')||'<p class="service-empty">暂无请假申请</p>';
}

async function loadMobileLeaveRequests() {
  const response=await fetch(`${mobileApi}/technician/leave-requests`,{headers:mobileAuthHeaders()});
  if(response.status===401)throw new Error('UNAUTHORIZED');
  if(!response.ok)throw new Error('LEAVE_LOAD_FAILED');
  renderMobileLeaveRequests(await response.json());
}

function openMobileLeaveDialog() {
  const form=document.querySelector('#mobile-leave-form');
  const today=mobileLocalDate();
  form.reset();
  form.startDate.value=today;
  form.endDate.value=today;
  form.startDate.min=today;
  form.endDate.min=today;
  document.querySelector('#mobile-leave-dialog').showModal();
}

function showLogin(message = '') {
  stopMobileDispatchAlert();
  document.querySelector('#login-screen').classList.remove('hidden');
  document.querySelector('#dashboard-screen').classList.add('hidden');
  document.querySelector('#mobile-tabbar').classList.add('hidden');
  document.querySelector('#logout-button').classList.add('hidden');
  document.querySelector('#technician-name').textContent = '技师端';
  if (message) mobileToast(message);
}

function ensureMobileDispatchAudio() {
  if (mobileDispatchAudio) return mobileDispatchAudio;
  mobileDispatchAudio=new Audio('./assets/technician-dispatch-alert.mp3');
  mobileDispatchAudio.loop=true;
  mobileDispatchAudio.preload='auto';
  mobileDispatchAudio.volume=1;
  return mobileDispatchAudio;
}

function ensureMobileServiceReminderAudio(id) {
  if (mobileServiceReminderAudio[id]) return mobileServiceReminderAudio[id];
  const audio=new Audio(mobileServiceReminderAudioSources[id]);
  audio.preload='auto';
  audio.volume=1;
  mobileServiceReminderAudio[id]=audio;
  return audio;
}

async function primeMobileServiceReminderAudio() {
  await Promise.all(Object.keys(mobileServiceReminderAudioSources).map(async id=>{
    const audio=ensureMobileServiceReminderAudio(id);
    audio.muted=true;
    try { await audio.play(); } catch { /* The current browser may only allow foreground audio. */ }
    audio.pause();
    audio.currentTime=0;
    audio.muted=false;
  }));
}

function startMobileDispatchSoundLoop() {
  if (!mobileDispatchSoundEnabled || !mobileDispatchSessionId) return;
  ensureMobileDispatchAudio().play().catch(()=>{
    document.querySelector('#dispatch-sound-required').classList.remove('hidden');
  });
}

function stopMobileDispatchAlert() {
  mobileDispatchSessionId=null;
  window.clearInterval(mobileDispatchDeadlineTimer);
  mobileDispatchDeadlineTimer=null;
  if (mobileDispatchAudio) {
    mobileDispatchAudio.pause();
    mobileDispatchAudio.currentTime=0;
  }
  document.querySelector('#mobile-dispatch-alert')?.classList.add('hidden');
}

function startMobileDispatchDeadline(dispatch) {
  window.clearInterval(mobileDispatchDeadlineTimer);
  const target=document.querySelector('#mobile-dispatch-countdown');
  const render=()=>{
    if(!target)return;
    const seconds=Math.ceil((new Date(dispatch.acceptanceDeadlineAt||0).getTime()-Date.now())/1000);
    const absolute=Math.max(0,seconds);
    const minutes=String(Math.floor(absolute/60)).padStart(2,'0');
    const remaining=String(absolute%60).padStart(2,'0');
    target.textContent=dispatch.acceptanceDeadlineAt ? `接单倒计时 ${minutes}:${remaining}` : '接单倒计时未设置';
    target.classList.toggle('overtime',seconds<=0);
  };
  render();
  if(dispatch.acceptanceDeadlineAt)mobileDispatchDeadlineTimer=window.setInterval(render,1000);
}

function showMobileDispatchAlert(dispatch) {
  const isNew=mobileDispatchSessionId!==dispatch.sessionId;
  mobileDispatchSessionId=dispatch.sessionId;
  document.querySelector('#mobile-dispatch-service').textContent=dispatch.serviceNameSnapshot;
  document.querySelector('#mobile-dispatch-detail').textContent=`${dispatch.roomCode} 房 · ${dispatch.plannedDurationMinutes} 分钟`;
  startMobileDispatchDeadline(dispatch);
  document.querySelector('#mobile-dispatch-alert').classList.remove('hidden');
  document.querySelector('#dispatch-sound-required').classList.toggle('hidden',mobileDispatchSoundEnabled);
  if (isNew) startMobileDispatchSoundLoop();
}

function openMobileRejectDispatchDialog() {
  if(!mobileDispatchSessionId)return;
  document.querySelector('#mobile-reject-dispatch-form').reset();
  document.querySelector('#mobile-reject-dispatch-dialog').showModal();
}

async function openMobileTransferDialog() {
  const response=await fetch(`${mobileApi}/technician/dispatch-notification/transfer-candidates`,{headers:mobileAuthHeaders()});
  if(!response.ok)return mobileToast('接收技师列表加载失败，请稍后重试');
  const candidates=await response.json();
  if(!candidates.length)return mobileToast('当前没有可接替的空闲技师');
  document.querySelector('#mobile-transfer-form').reset();
  document.querySelector('#mobile-transfer-technician').innerHTML=candidates.map(item=>`<option value="${item.id}">${mobileEscape(item.code||'')} · ${mobileEscape(item.name)}</option>`).join('');
  document.querySelector('#mobile-transfer-dialog').showModal();
}

async function submitMobileTransfer(event) {
  event.preventDefault();
  const form=new FormData(event.currentTarget);
  const reason=String(form.get('reason')||'').trim();
  if(!reason)return mobileToast('请填写转单原因');
  const submit=event.currentTarget.querySelector('[type="submit"]');submit.disabled=true;
  try {
    const response=await fetch(`${mobileApi}/technician/dispatch-notification/transfer`,{method:'POST',headers:{...mobileAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify({toTechnicianId:form.get('toTechnicianId'),reason})});
    if(!response.ok){mobileToast('转单申请提交失败，请刷新后重试');return;}
    document.querySelector('#mobile-transfer-dialog').close();
    stopMobileDispatchAlert();
    await loadMobileDashboard();
    mobileToast('转单申请已提交，等待前台审核');
  } finally { submit.disabled=false; }
}

async function rejectMobileDispatch(event) {
  event.preventDefault();
  if(!mobileDispatchSessionId)return;
  const reason=String(new FormData(event.currentTarget).get('reason')||'').trim();
  if(!reason)return mobileToast('请填写拒单原因');
  const response=await fetch(`${mobileApi}/technician/dispatch-notification/reject`,{method:'POST',headers:{...mobileAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify({reason})});
  if(!response.ok){mobileToast('拒单失败，请刷新后重试');return;}
  document.querySelector('#mobile-reject-dispatch-dialog').close();
  stopMobileDispatchAlert();
  await loadMobileDashboard();
  mobileToast('已拒绝接单，前台将重新安排');
}

async function enableMobileDispatchSound() {
  try {
    const audio=ensureMobileDispatchAudio();
    await audio.play();
    await primeMobileServiceReminderAudio();
    mobileDispatchSoundEnabled=true;
    const button=document.querySelector('#enable-dispatch-sound');
    button.textContent='提示音已开启';
    button.classList.add('enabled');
    document.querySelector('#dispatch-sound-required').classList.add('hidden');
    if (!mobileDispatchSessionId) {
      audio.pause();
      audio.currentTime=0;
    }
    startMobileDispatchSoundLoop();
    mobileToast('派钟提示音已开启');
  } catch { mobileToast('当前浏览器未允许播放提示音'); }
}

async function pollMobileDispatchNotification() {
  if (!localStorage.getItem(mobileTokenKey) || mobileAttendanceBlocked) {
    stopMobileDispatchAlert();
    return;
  }
  try {
    const response=await fetch(`${mobileApi}/technician/dispatch-notification`,{headers:mobileAuthHeaders()});
    if(response.status===401){clearMobileSession();showLogin('登录已失效，请重新登录');return;}
    if(!response.ok)return;
    const notification=await response.json();
    if(notification.dispatch)showMobileDispatchAlert(notification.dispatch);else stopMobileDispatchAlert();
    const reservation=notification.reservation;
    if(reservation && mobileReservationNoticeId!==reservation.reservationId){ mobileReservationNoticeId=reservation.reservationId; mobileToast(`${mobileClockTypeLabel(reservation.reservationType)}：${reservation.serviceNameSnapshot}，${reservation.roomCode} 房已预留`); }
    const transfer=notification.transfer;
    if(transfer){
      const key=`${transfer.requestId}:${transfer.status}`;
      if(mobileTransferNoticeKey!==key){
        mobileTransferNoticeKey=key;
        if(transfer.status==='REQUESTED') mobileToast('转单申请已提交，等待前台审核');
        else if(transfer.status==='APPROVED') mobileToast('转单已审核通过，当前订单已转交其他技师');
        else if(transfer.status==='REJECTED') mobileToast(`转单申请已驳回：${transfer.reason || '请继续当前服务'}`);
      }
    }
  } catch { /* Keep the current alert active until a successful sync clears it. */ }
}

function renderMobileAttendance(dashboard) {
  const gate=document.querySelector('#mobile-attendance-gate');
  const status=document.querySelector('#mobile-attendance-status');
  const clockInButton=document.querySelector('#mobile-clock-in');
  const clockInAt=document.querySelector('#mobile-clock-in-at');
  const date=document.querySelector('#mobile-attendance-date');
  const statusText=status?.querySelector('span:nth-of-type(2)');
  const clockedIn=dashboard.clockedIn===true;
  const legacyCompatible=dashboard.clockInLegacyCompatible===true;
  const reason=dashboard.clockInReason||'AVAILABLE';
  mobileAttendanceBlocked=!clockedIn && !legacyCompatible;
  if(date)date.textContent=`${mobileLocalDate()} 营业日`;
  if(clockInAt)clockInAt.textContent=dashboard.clockInAt ? `上班时间 ${mobileTime(dashboard.clockInAt)}` : '';
  if(statusText)statusText.textContent=clockedIn ? '今日已打卡' : legacyCompatible ? '历史兼容模式' : '今日未打卡';
  if(status)status.classList.toggle('hidden',mobileAttendanceBlocked && !legacyCompatible);
  if(gate){
    gate.classList.toggle('hidden',!mobileAttendanceBlocked);
    const title=gate.querySelector('h2');
    const copy=gate.querySelector('p');
    const clockOut=reason==='CLOCKED_OUT';
    if(title)title.textContent=clockOut?'今日已下班':'请先完成今日打卡';
    if(copy)copy.textContent=clockOut?'今日打卡已结束，请明日再来':'打卡后才能接收派单和开始服务';
    if(clockInButton){
      clockInButton.disabled=clockOut;
      clockInButton.textContent=clockOut?'今日已下班':'上班打卡';
    }
  }
  ['#current-service','#mobile-pending-events','#mobile-reservation-section'].forEach(selector=>{
    const section=document.querySelector(selector);
    if(section)section.classList.toggle('mobile-attendance-locked',mobileAttendanceBlocked);
  });
  if(mobileAttendanceBlocked)stopMobileDispatchAlert();
  return mobileAttendanceBlocked;
}

async function mobileClockIn() {
  const button=document.querySelector('#mobile-clock-in');
  if(!button || button.disabled)return;
  button.disabled=true;
  try {
    const response=await fetch(`${mobileAttendanceApi}/clock-in`,{method:'POST',headers:{...mobileAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify({})});
    if(response.status===401){clearMobileSession();showLogin('登录已失效，请重新登录');return;}
    if(!response.ok){mobileToast(response.status===409?'今日已下班或打卡状态已变化，请刷新页面':'上班打卡失败，请稍后重试');return;}
    await loadMobileDashboard();
    mobileToast('已完成今日上班打卡');
  } catch { mobileToast('上班打卡失败，请检查网络后重试'); }
  finally { button.disabled=false; }
}

function showDashboard() {
  document.querySelector('#login-screen').classList.add('hidden');
  document.querySelector('#dashboard-screen').classList.remove('hidden');
  document.querySelector('#mobile-tabbar').classList.remove('hidden');
  document.querySelector('#logout-button').classList.remove('hidden');
}

function renderRecentSessions(sessions) {
  const labels = { COMPLETED:['已完成','completed'], IN_SERVICE:['服务中','serving'], CANCELLED:['已取消','cancelled'] };
  document.querySelector('#recent-count').textContent = `${sessions.length} 条`;
  document.querySelector('#session-list').innerHTML = sessions.map(session => { const [label, style] = labels[session.status] || [session.status, 'cancelled']; const clockType=mobileClockTypeLabel(session.clockType); const extension=session.extensionSummary?` · 加钟：${session.extensionSummary}`:''; const total=Number(session.servicePriceCents||0)+Number(session.extensionTotalCents||0); return `<article class="session-row"><div><b>${session.serviceNameSnapshot}</b><small>${clockType} · ${mobileTime(session.startedAt)} · ${session.roomCode} 房 · ${session.plannedDurationMinutes} 分钟${extension}</small></div><div class="session-row-right"><strong>${mobileMoney(total)}</strong><span class="session-status ${style}">${label}</span></div></article>`; }).join('') || '<p class="service-empty">暂无服务记录</p>';
}

function renderMobileReservations(reservations) {
  const list = document.querySelector('#mobile-reservation-list');
  const count = document.querySelector('#mobile-reservation-count');
  count.textContent = `${reservations.length} 条`;
  list.innerHTML = reservations.map(item => `<article class="session-row"><div><b>${mobileClockTypeLabel(item.reservationType)} · ${item.serviceNameSnapshot}</b><small>${item.roomCode} 房 · ${item.plannedDurationMinutes} 分钟 · 等待前台确认派单${item.note ? ` · ${mobileEscape(item.note)}` : ''}</small></div><div class="session-row-right"><strong>已预留</strong><span class="session-status serving">等待派单</span></div></article>`).join('') || '<p class="service-empty">暂无等待派单的预约服务</p>';
}

function formatMobileServiceCountdown(expectedEndAt) {
  const remainingSeconds=Math.max(0,Math.ceil((new Date(expectedEndAt).getTime()-Date.now())/1000));
  const hours=String(Math.floor(remainingSeconds/3600)).padStart(2,'0');
  const minutes=String(Math.floor((remainingSeconds%3600)/60)).padStart(2,'0');
  const seconds=String(remainingSeconds%60).padStart(2,'0');
  return `${hours}:${minutes}:${seconds}`;
}

function stopMobileServiceReminders() {
  window.clearInterval(mobileServiceReminderTimer);
  mobileServiceReminderTimer=null;
  mobileServiceReminderSessionKey=null;
}

function playMobileServiceReminder(alert) {
  mobileToast(alert.message);
  const audio=ensureMobileServiceReminderAudio(alert.id);
  audio.pause();
  audio.currentTime=0;
  audio.play().catch(()=>{
    document.querySelector('#dispatch-sound-required').classList.remove('hidden');
  });
}

function processMobileServiceReminders(session) {
  const expectedEndAt=new Date(session.expectedEndAt).getTime();
  const countdown=document.querySelector('#mobile-service-countdown');
  if (countdown) countdown.textContent=formatMobileServiceCountdown(session.expectedEndAt);
  const remainingSeconds=Math.ceil((expectedEndAt-Date.now())/1000);
  const alerts=[
    {id:'ten-minutes',upper:600,lower:540,message:'距离项目服务还剩十分钟'},
    {id:'five-minutes',upper:300,lower:240,message:'距离项目服务还剩五分钟'},
    {id:'finished',upper:0,lower:Number.NEGATIVE_INFINITY,message:'项目服务已经结束，欢迎光临'}
  ];
  const alert=alerts.find(item=>item.id==='finished'?remainingSeconds<=item.upper:(remainingSeconds<=item.upper&&remainingSeconds>item.lower));
  if (!alert) return;
  const storageKey=`mobile-service-reminder:${mobileServiceReminderSessionKey}:${alert.id}`;
  if (sessionStorage.getItem(storageKey)) return;
  sessionStorage.setItem(storageKey,'1');
  playMobileServiceReminder(alert);
}

function startMobileServiceReminders(session) {
  const key=`${session.id}:${session.expectedEndAt}`;
  if (mobileServiceReminderSessionKey!==key) {
    stopMobileServiceReminders();
    mobileServiceReminderSessionKey=key;
  }
  processMobileServiceReminders(session);
  if (!mobileServiceReminderTimer) mobileServiceReminderTimer=window.setInterval(()=>processMobileServiceReminders(session),1000);
}

function renderCurrentService(session, acceptedSession, pendingSession, clockInEligible=true, clockInReason='AVAILABLE') {
  const target = document.querySelector('#current-service');
  if (pendingSession) {
    stopMobileServiceReminders();
    target.innerHTML = `<div class="section-title"><h2>当前服务</h2><span class="status-chip neutral">待接单</span></div><div class="active-service"><div><b>${pendingSession.serviceNameSnapshot}</b><small>${pendingSession.roomCode} 房 · ${pendingSession.plannedDurationMinutes} 分钟</small></div><time>上一单完成后，请确认接单</time></div><div class="mobile-service-actions"><button class="mobile-action" type="button" id="mobile-confirm-pending">确认接单</button></div>`;
    return;
  }
  if (acceptedSession) {
    stopMobileServiceReminders();
    const waitingForOthers=acceptedSession.status==='PENDING_ACCEPTANCE';
    target.innerHTML = `<div class="section-title"><h2>当前服务</h2><span class="status-chip neutral">${waitingForOthers?'等待同单技师':'已接单'}</span></div><div class="active-service"><div><b>${acceptedSession.serviceNameSnapshot}</b><small>${acceptedSession.roomCode} 房 · ${acceptedSession.plannedDurationMinutes} 分钟</small></div><time>${waitingForOthers?'本人已接单，等待其他参与技师确认':'到房间后开始计时'}</time></div>${waitingForOthers?'':'<div class="mobile-service-actions"><button class="mobile-action" type="button" id="mobile-start-service">开始服务</button><button class="mobile-secondary-action" type="button" id="mobile-transfer-current">申请转单</button></div>'}`;
    return;
  }
  if (!session) {
    stopMobileServiceReminders();
    const label=mobileScheduleReasonLabel[clockInReason]||'等待安排';
    target.innerHTML=`<div class="section-title"><h2>当前服务</h2><span class="status-chip ${clockInEligible?'neutral':'blocked'}">${label}</span></div><div class="service-empty">${clockInEligible?'等待前台或店长安排上钟':'请联系门店管理员确认排班或请假状态'}</div>`;
    return;
  }
  const extension = session.extensionSummary ? `<small>加钟：${session.extensionSummary}</small>` : '';
  const transferStorageKey = `mobile-room-transfer:${session.id}`;
  let transferState = null;
  try { transferState = JSON.parse(sessionStorage.getItem(transferStorageKey) || 'null'); } catch { transferState = null; }
  if (transferState?.status === 'REQUESTED' && transferState.fromRoomCode && transferState.fromRoomCode !== session.roomCode) {
    sessionStorage.removeItem(transferStorageKey);
    mobileRoomTransferSessionId=null;
    mobileRoomTransferFromCode=null;
    mobileToast(`换房已确认，当前房间：${session.roomCode}`);
    transferState = null;
  }
  const transfer = mobileRoomTransferStatus?.transfer || null;
  const transferPending = transfer?.status === 'REQUESTED' || (transferState?.status === 'REQUESTED' && transferState.fromRoomCode === session.roomCode);
  if (transfer && transfer.status !== 'REQUESTED') sessionStorage.removeItem(transferStorageKey);
  const transferNotice = transfer?.status === 'REJECTED'
    ? `<p class="mobile-room-transfer-notice rejected">换房申请已拒绝：${mobileEscape(transfer.rejectionNote || '请联系前台')}</p>`
    : transfer?.status === 'APPROVED'
      ? `<p class="mobile-room-transfer-notice approved">已换至 ${mobileEscape(transfer.toRoomCode)} 房</p>`
      : transferPending ? '<p class="mobile-room-transfer-notice pending">换房申请已提交，等待前台确认</p>' : '';
  const intent=mobileExtensionIntents.find(item=>String(item.serviceSessionId)===String(session.id));
  const intentNotice=intent?.status==='PENDING' ? '<p class="mobile-room-transfer-notice pending">意向加钟已提交，等待前台与顾客沟通</p>' : intent?.status==='REJECTED' ? `<p class="mobile-room-transfer-notice rejected">前台已拒绝意向加钟${intent.rejectionReason ? `：${mobileEscape(intent.rejectionReason)}` : ''}</p>` : intent?.status==='CONTACTED' ? '<p class="mobile-room-transfer-notice approved">前台已沟通</p>' : '';
  target.innerHTML = `<div class="section-title"><h2>当前服务</h2><span class="status-chip serving">服务中</span></div><div class="active-service"><div><b>${session.serviceNameSnapshot}</b><small>${session.roomCode} 房 · 共 ${session.plannedDurationMinutes} 分钟</small>${extension}</div><time>剩余 <b id="mobile-service-countdown">${formatMobileServiceCountdown(session.expectedEndAt)}</b><small>预计 ${new Intl.DateTimeFormat('zh-CN', { hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(session.expectedEndAt))} 结束</small></time></div>${transferNotice}${intentNotice}<div class="mobile-service-actions"><button class="mobile-secondary-action" type="button" id="mobile-extension-intent" ${intent?.status==='PENDING' ? 'disabled' : ''}>${intent?.status==='PENDING' ? '意向已提交' : '意向加钟'}</button><button class="mobile-secondary-action" type="button" id="open-mobile-extension">加钟</button><button class="mobile-secondary-action" type="button" id="open-mobile-room-transfer" ${transferPending ? 'disabled' : ''}>${transferPending ? '换房申请处理中' : '申请换房'}</button><button class="mobile-action danger" type="button" id="mobile-clock-out">确认下钟</button></div>`;
  startMobileServiceReminders(session);
}

async function loadMobileExtensionIntents() {
  try {
    const response=await fetch('/api/v1/service-extension-intents/mine',{headers:mobileAuthHeaders()});
    if(response.ok) mobileExtensionIntents=await response.json();
  } catch { mobileExtensionIntents=[]; }
  renderMobilePendingEvents();
}
function renderMobilePendingEvents() {
  const target=document.querySelector('#mobile-pending-event-list');
  const count=document.querySelector('#mobile-pending-event-count');
  if(!target)return;
  const pending=mobileExtensionIntents.filter(item=>item.status==='PENDING');
  if(count)count.textContent=pending.length?`${pending.length} 条`:'';
  target.innerHTML=pending.map(item=>`<article class="session-row mobile-pending-event-row"><div><b>意向加钟</b><small>${mobileEscape(item.roomCode||'')} 房 · ${mobileEscape(item.serviceName||'服务项目')}</small><small>${item.technicianNote?mobileEscape(item.technicianNote):'已通知前台与顾客沟通'}</small></div><span class="session-status serving">待前台处理</span></article>`).join('')||'<p class="service-empty">暂无待处理事件</p>';
}

async function submitMobileExtensionIntent() {
  if(!mobileActiveSession)return mobileToast('当前没有进行中的服务');
  const note=window.prompt('可填写给前台的备注（可不填）','');
  if(note===null)return;
  const response=await fetch('/api/v1/service-extension-intents',{method:'POST',headers:{...mobileAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify({serviceSessionId:mobileActiveSession.id,technicianNote:note.trim()||null})});
  if(!response.ok){const detail=(await response.text()).replace(/^"|"$/g,'');return mobileToast(response.status===404?'意向加钟服务尚未更新，请联系管理员重启 API':(detail||'意向加钟提交失败，请刷新后重试'));}
  const created=await response.json(); mobileExtensionIntents=[created,...mobileExtensionIntents.filter(item=>String(item.id)!==String(created.id))]; renderCurrentService(mobileActiveSession,null,null); mobileToast('意向加钟已通知前台');
}

function renderMobileExtensionForm() {
  const services=document.querySelector('#mobile-extension-service');
  services.innerHTML=mobileExtensionOptions.services.map(service=>`<option value="${service.id}" data-duration="${service.defaultDurationMinutes}" data-price="${service.priceCents}">${service.name} · ${service.defaultDurationMinutes} 分钟 · ${mobileMoney(service.priceCents)}</option>`).join('');
  const renderPreview=()=>{const selected=services.selectedOptions[0];if(!selected)return;document.querySelector('#mobile-extension-preview').textContent=`本次加钟 ${selected.dataset.duration} 分钟，金额 ${mobileMoney(selected.dataset.price)}`;};
  services.onchange=renderPreview;
  renderPreview();
}

async function openMobileExtensionDialog() {
  const response=await fetch(`${mobileApi}/technician/extension-options`,{headers:mobileAuthHeaders()});
  if(response.status===401){clearMobileSession();showLogin('登录已失效，请重新登录');return;}
  if(!response.ok){mobileToast('未找到可加钟的服务，请刷新后重试');return;}
  mobileExtensionOptions=await response.json();
  if(Number(mobileExtensionOptions.remainingExtensionMinutes||0)<=0)return mobileToast('本次服务已达到加钟上限');
  if(!mobileExtensionOptions.services.length)return mobileToast('当前没有符合剩余额度的加钟项目');
  document.querySelector('#mobile-extension-form').reset();
  document.querySelector('#mobile-extension-subtitle').textContent=`${mobileExtensionOptions.roomCode} 房 · 已加 ${mobileExtensionOptions.extensionTotalMinutes} 分钟 · 最多可再加 ${mobileExtensionOptions.remainingExtensionMinutes} 分钟`;
  renderMobileExtensionForm();
  document.querySelector('#mobile-extension-dialog').showModal();
}

async function openMobileRoomTransferDialog(session) {
  if (!session?.id) return;
  const response = await fetch(`${mobileApi}/technician/clock-options`, { headers:mobileAuthHeaders() });
  if (response.status === 401) { clearMobileSession(); showLogin('登录已失效，请重新登录'); return; }
  if (!response.ok) throw new Error(response.status);
  const options = await response.json();
  const rooms = (options.rooms || []).filter(room => room.code !== session.roomCode);
  if (!rooms.length) return mobileToast('当前没有可用的目标房间');
  mobileRoomTransferOptions = { rooms };
  mobileRoomTransferSessionId = session.id;
  mobileRoomTransferFromCode = session.roomCode;
  const form = document.querySelector('#mobile-room-transfer-form');
  form.reset();
  document.querySelector('#mobile-room-transfer-subtitle').textContent = `${session.roomCode} 房 · ${session.serviceNameSnapshot}`;
  document.querySelector('#mobile-room-transfer-room').innerHTML = rooms.map(room => `<option value="${room.id}">${room.code} · ${room.name}</option>`).join('');
  document.querySelector('#mobile-room-transfer-dialog').showModal();
}

async function loadMobileRoomTransferStatus(session) {
  if (!session?.id) { mobileRoomTransferStatus=null; return; }
  const response = await fetch(`${mobileApi}/technician/service-room-transfers?serviceSessionId=${encodeURIComponent(session.id)}`, { headers:mobileAuthHeaders() });
  if (!response.ok) { mobileRoomTransferStatus=null; return; }
  mobileRoomTransferStatus=await response.json();
}

async function mobileClockOut() {
  if(!window.confirm('确认结束当前服务，并将房间标记为待清理？'))return;
  const response=await fetch(`${mobileApi}/technician/clock-out`,{method:'POST',headers:mobileAuthHeaders()});
  if(!response.ok){mobileToast('下钟失败，请刷新后重试');return;}
  await loadMobileDashboard();
  mobileToast('已下钟，房间等待付款');
}

async function startMobileService() {
  const response = await fetch(`${mobileApi}/technician/start-service`, { method:'POST', headers:mobileAuthHeaders() });
  if (!response.ok) {
    const message = response.status === 409
      ? '服务状态已变化，请刷新后重新开始服务'
      : response.status === 415
        ? '技师端页面版本已更新，请刷新页面后重试'
        : '开始服务失败，请检查网络后重试';
    mobileToast(message);
    return;
  }
  await loadMobileDashboard();
  mobileToast('服务已开始，项目开始计时');
}

async function loadMobilePerformanceRange() {
  const response = await fetch(`${mobileApi}/technician/performance?range=${mobilePerformanceRange}`, { headers: mobileAuthHeaders() });
  if (!response.ok) throw new Error(response.status);
  const data = await response.json();
  const labels={TODAY:'今日汇总',MONTH:'本月汇总',LAST_7_DAYS:'近 7 天汇总'};
  document.querySelector('#mobile-range-label').textContent=labels[data.range]||'业绩汇总';
  document.querySelector('#mobile-range-amount').textContent=mobileMoney(data.amountCents);
  document.querySelector('#mobile-range-count').textContent=data.completedCount;
  document.querySelector('#mobile-range-minutes').textContent=data.totalMinutes;
  const end=new Date();
  const start=new Date(end);
  if(mobilePerformanceRange==='TODAY')start.setHours(0,0,0,0);
  else if(mobilePerformanceRange==='LAST_7_DAYS')start.setDate(start.getDate()-6);
  else {start.setDate(1);start.setHours(0,0,0,0);}
  const date=value=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  const [recordsResponse,summaryResponse,adjustmentsResponse]=await Promise.all([
    fetch(`${mobileApi}/technician/commissions?from=${date(start)}&to=${date(end)}`,{headers:mobileAuthHeaders()}),
    fetch(`${mobileApi}/technician/commissions/summary?from=${date(start)}&to=${date(end)}`,{headers:mobileAuthHeaders()}),
    fetch(`${mobileApi}/technician/commissions/adjustments?from=${date(start)}&to=${date(end)}`,{headers:mobileAuthHeaders()})
  ]);
  if(!recordsResponse.ok||!summaryResponse.ok||!adjustmentsResponse.ok)throw new Error(recordsResponse.ok&&summaryResponse.ok?adjustmentsResponse.status:recordsResponse.status);
  const [records,summary,adjustments]=await Promise.all([recordsResponse.json(),summaryResponse.json(),adjustmentsResponse.json()]);
  document.querySelector('#mobile-range-commission').textContent=mobileSignedMoney(summary.commissionCents);
  document.querySelector('#mobile-commission-list').innerHTML=records.map(record=>{const split=record.serviceParticipantId?` · 分配 ${(Number(record.allocationBpSnapshot||0)/100).toFixed(2).replace(/\.00$/,'')}% · 实际 ${Math.round(Number(record.servedSecondsSnapshot||0)/60)} 分钟`:'';const detail=`${mobileClockTypeLabel(record.clockType)} · ${record.orderNoSnapshot}${split}`;const tierName=record.commissionTierNameSnapshot||'基础档';const tierLabel=mobileEscape(tierName);const monthlyClocks=Number.isFinite(Number(record.monthlyClockCountSnapshot))?Number(record.monthlyClockCountSnapshot):0;const multiplier=(Number(record.commissionMultiplierBpSnapshot||10000)/100).toFixed(2).replace(/\.00$/,'');const tierDetail=`${tierLabel} · 当月 ${monthlyClocks} 钟 · 倍率 ${multiplier}%`;return `<article class="session-row"><div><b>${mobileEscape(record.serviceNameSnapshot)}</b><small>${mobileEscape(detail)} · ${mobileTime(record.settledAt)}</small><small class="commission-tier-detail">${tierDetail}</small></div><div class="session-row-right commission-record-money"><small>业绩 ${mobileSignedMoney(record.baseAmountCents)}</small><strong>提成 ${mobileSignedMoney(record.commissionCents)}</strong><span class="session-status completed">已计入</span></div></article>`;}).join('')||'<p class="service-empty">所选日期暂无有效提成</p>';
  const adjustmentLabels={REFUND_REVERSAL:'退款冲回',ORDER_VOID_REVERSAL:'作废冲回',BUSINESS_CORRECTION_REVERSAL:'改单冲回'};
  document.querySelector('#mobile-commission-adjustments').innerHTML=adjustments.map(record=>`<article class="session-row commission-reversal"><div><b>${mobileEscape(adjustmentLabels[record.recordType]||'提成调整')}</b><small>${mobileEscape(record.serviceNameSnapshot||'—')} · ${mobileEscape(record.adjustmentReferenceNo||record.orderNoSnapshot||'—')} · ${mobileEscape(record.adjustmentReason||'系统调整')} · ${mobileTime(record.settledAt)}</small></div><div class="session-row-right commission-record-money"><small>业绩 ${mobileSignedMoney(record.baseAmountCents)}</small><strong>提成 ${mobileSignedMoney(record.commissionCents)}</strong><span class="session-status cancelled">已冲回</span></div></article>`).join('')||'<p class="service-empty">所选日期暂无提成调整记录</p>';
}

const mobileDailyStatusLabel={PENDING_ACCEPTANCE:'待接单',ACCEPTED:'已接单',REASSIGNMENT_REQUIRED:'待重新派单',DISPATCH_CANCELLED:'已取消派单',IN_SERVICE:'服务中',COMPLETED:'已完成',CANCELLED:'已取消',VOIDED:'已作废',REJECTED:'已拒单',EXPIRED:'接单超时'};
const mobileDailyStatusStyle=status=>status==='COMPLETED'?'completed':status==='IN_SERVICE'?'serving':'cancelled';

async function loadTechnicianDailyData() {
  const input=document.querySelector('#mobile-daily-date');
  if(!input.value)input.value=mobileLocalDate();
  const target=document.querySelector('#mobile-daily-service-list');
  try {
    const response=await fetch(`${mobileApi}/technician/daily-data?date=${encodeURIComponent(input.value)}`,{headers:mobileAuthHeaders()});
    if(response.status===401)throw new Error('UNAUTHORIZED');
    if(!response.ok)throw new Error('DAILY_DATA_FAILED');
    const data=await response.json();
    const summary=data.summary||{};
    document.querySelector('#mobile-daily-queue').textContent=Number(summary.queueCount||0);
    document.querySelector('#mobile-daily-call').textContent=Number(summary.callCount||0);
    document.querySelector('#mobile-daily-extension').textContent=Number(summary.extensionCount||0);
    document.querySelector('#mobile-daily-completed').textContent=Number(summary.completedServiceCount||0);
    document.querySelector('#mobile-daily-minutes').textContent=Number(summary.totalMinutes||0);
    document.querySelector('#mobile-daily-pending').textContent=Number(summary.pendingSettlementCount||0);
    document.querySelector('#mobile-daily-base').textContent=mobileSignedMoney(summary.baseAmountCents);
    document.querySelector('#mobile-daily-commission').textContent=mobileSignedMoney(summary.commissionCents);
    document.querySelector('#mobile-daily-business-date').textContent=`${data.businessDate} 营业日`;
    target.innerHTML=(data.services||[]).map(service=>{const status=service.participantStatus||service.status;const time=service.startedAt?`${mobileTime(service.startedAt)}${service.endedAt?` - ${mobileTime(service.endedAt)}`:' 至今'}`:'尚未开始';const extension=service.extensionSummary?` · 加钟 ${mobileEscape(service.extensionSummary)}`:'';const settlement=service.settled?`业绩 ${mobileSignedMoney(service.baseAmountCents)} · 提成 ${mobileSignedMoney(service.commissionCents)}`:'待结算';return `<article class="session-row"><div><b>${mobileEscape(service.serviceNameSnapshot)}</b><small>${mobileEscape(service.roomCode)} 房 · ${mobileEscape(mobileClockTypeLabel(service.clockType))} · ${time}</small><small>实际 ${Number(service.servedMinutes||0)} 分钟${extension}</small></div><div class="session-row-right"><strong>${settlement}</strong><span class="session-status ${mobileDailyStatusStyle(status)}">${mobileEscape(mobileDailyStatusLabel[status]||status)}</span></div></article>`;}).join('')||'<p class="service-empty">所选日期暂无本人服务记录</p>';
  } catch(error) {
    if(error.message==='UNAUTHORIZED')throw error;
    target.innerHTML='<p class="service-empty">当日数据加载失败，请点击查询重试</p>';
  }
}

async function loadMobileDashboard() {
  const token = localStorage.getItem(mobileTokenKey);
  if (!token) { showLogin(); return; }
  try {
    const response = await fetch(`${mobileApi}/technician/me`, { headers: mobileAuthHeaders() });
    if (response.status === 401) { clearMobileSession(); showLogin('登录已失效，请重新登录'); return; }
    if (!response.ok) throw new Error(response.status);
    const dashboard = await response.json();
    document.querySelector('#technician-name').textContent = `${dashboard.technician.name}，你好`;
    document.querySelector('.store-badge').textContent = dashboard.technician.storeName;
    document.querySelector('#performance-date').textContent = new Intl.DateTimeFormat('zh-CN', { month:'long', day:'numeric' }).format(new Date());
    document.querySelector('#today-count').textContent = dashboard.summary.todayCompletedCount;
    document.querySelector('#today-amount').textContent = mobileMoney(dashboard.summary.todayAmountCents);
    document.querySelector('#month-count').textContent = dashboard.summary.monthCompletedCount;
    document.querySelector('#month-amount').textContent = mobileMoney(dashboard.summary.monthAmountCents);
    renderMobileAttendance(dashboard);
    mobileActiveSession=dashboard.activeSession;
    await loadMobileExtensionIntents();
    await loadMobileRoomTransferStatus(dashboard.activeSession);
    renderCurrentService(dashboard.activeSession,dashboard.acceptedSession,dashboard.pendingSession,dashboard.clockInEligible,dashboard.clockInReason);
    renderRecentSessions(dashboard.recentSessions);
    renderMobileReservations(dashboard.reservations || []);
    await loadTechnicianDailyData();
    await loadMobilePerformanceRange();
    await loadMobileLeaveRequests();
    showDashboard();
    await pollMobileDispatchNotification();
  } catch { mobileToast('业绩数据暂时无法加载，请稍后重试'); }
}

document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const response = await fetch(`${mobileApi}/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ loginName:form.get('loginName'), password:form.get('password') }) });
  if (!response.ok) { mobileToast('账号或密码错误'); return; }
  const session = await response.json();
  localStorage.setItem(mobileTokenKey, session.accessToken);
  formElement.reset();
  await loadMobileDashboard();
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  try { await fetch(`${mobileApi}/auth/logout`, { method:'POST', headers:mobileAuthHeaders() }); } finally { clearMobileSession(); showLogin('已退出登录'); }
});
document.querySelector('#enable-dispatch-sound').addEventListener('click',enableMobileDispatchSound);
document.querySelector('#mobile-clock-in').addEventListener('click',mobileClockIn);
document.querySelector('#reject-mobile-dispatch').addEventListener('click',openMobileRejectDispatchDialog);
document.querySelector('#request-mobile-transfer').addEventListener('click',openMobileTransferDialog);
document.querySelector('#close-mobile-transfer').addEventListener('click',()=>document.querySelector('#mobile-transfer-dialog').close());
document.querySelector('#cancel-mobile-transfer').addEventListener('click',()=>document.querySelector('#mobile-transfer-dialog').close());
document.querySelector('#mobile-transfer-form').addEventListener('submit',submitMobileTransfer);
document.querySelector('#close-mobile-reject-dispatch').addEventListener('click',()=>document.querySelector('#mobile-reject-dispatch-dialog').close());
document.querySelector('#cancel-mobile-reject-dispatch').addEventListener('click',()=>document.querySelector('#mobile-reject-dispatch-dialog').close());
document.querySelector('#mobile-reject-dispatch-form').addEventListener('submit',rejectMobileDispatch);
document.querySelector('#confirm-mobile-dispatch').addEventListener('click',async()=>{
  if(!mobileDispatchSessionId && !document.querySelector('#mobile-confirm-pending'))return;
  const response=await fetch(`${mobileApi}/technician/dispatch-notification/confirm`,{method:'POST',headers:mobileAuthHeaders()});
  if(!response.ok){mobileToast('确认接单失败，请刷新后重试');return;}
  stopMobileDispatchAlert();
  await loadMobileDashboard();
  mobileToast('已确认接单');
});
document.querySelector('#current-service').addEventListener('click',async event=>{
  if(event.target.closest('#mobile-confirm-pending')){document.querySelector('#confirm-mobile-dispatch').click();return;}
  if(event.target.closest('#open-mobile-extension')){try{await openMobileExtensionDialog();}catch{mobileToast('加钟资料暂时无法加载，请稍后重试');}}
  if(event.target.closest('#mobile-extension-intent'))await submitMobileExtensionIntent();
  if(event.target.closest('#open-mobile-room-transfer')){const button=event.target.closest('#open-mobile-room-transfer');if(button.disabled)return;try{if(mobileActiveSession)await openMobileRoomTransferDialog(mobileActiveSession);else mobileToast('当前没有可换房的服务');}catch{mobileToast('换房资料暂时无法加载，请稍后重试');}}
  if(event.target.closest('#mobile-start-service'))await startMobileService();
  if(event.target.closest('#mobile-transfer-current'))await openMobileTransferDialog();
  if(event.target.closest('#mobile-clock-out'))await mobileClockOut();
});
document.querySelector('#close-mobile-extension').addEventListener('click',()=>document.querySelector('#mobile-extension-dialog').close());
document.querySelector('#cancel-mobile-extension').addEventListener('click',()=>document.querySelector('#mobile-extension-dialog').close());
document.querySelector('#close-mobile-room-transfer').addEventListener('click',()=>document.querySelector('#mobile-room-transfer-dialog').close());
document.querySelector('#cancel-mobile-room-transfer').addEventListener('click',()=>document.querySelector('#mobile-room-transfer-dialog').close());
document.querySelector('#open-mobile-leave').addEventListener('click',openMobileLeaveDialog);
document.querySelector('#close-mobile-leave').addEventListener('click',()=>document.querySelector('#mobile-leave-dialog').close());
document.querySelector('#cancel-mobile-leave').addEventListener('click',()=>document.querySelector('#mobile-leave-dialog').close());
document.querySelector('#mobile-leave-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=new FormData(event.currentTarget);
  const response=await fetch(`${mobileApi}/technician/leave-requests`,{method:'POST',headers:{...mobileAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify({startDate:form.get('startDate'),endDate:form.get('endDate'),reason:form.get('reason')||null})});
  if(!response.ok){mobileToast(response.status===409?'已有重叠的待审批或已批准请假':'请假申请提交失败，请检查日期');return;}
  document.querySelector('#mobile-leave-dialog').close();
  await loadMobileLeaveRequests();
  mobileToast('请假申请已提交，等待管理员审批');
});
document.querySelector('#mobile-extension-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const serviceItemId=new FormData(event.currentTarget).get('serviceItemId');
  const response=await fetch(`${mobileApi}/technician/extensions`,{method:'POST',headers:{...mobileAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify({serviceItemId})});
  if(!response.ok){mobileToast(response.status===400?'本次服务已达到加钟上限，或所选项目已不可用':response.status===409?'当前服务已结束，请刷新后重试':'加钟提交失败，请检查网络后重试');return;}
  document.querySelector('#mobile-extension-dialog').close();
  await loadMobileDashboard();
  mobileToast('加钟已保存，前台服务明细已同步');
});
document.querySelector('#mobile-room-transfer-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!mobileRoomTransferSessionId)return;
  const form=new FormData(event.currentTarget);
  const reason=String(form.get('reason')||'').trim();
  if(!reason)return mobileToast('请填写换房原因');
  const response=await fetch(`${mobileApi}/technician/service-room-transfers`,{method:'POST',headers:{...mobileAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify({serviceSessionId:mobileRoomTransferSessionId,toRoomId:form.get('toRoomId'),reason})});
  if(!response.ok){mobileToast(response.status===409?'目标房间或当前服务状态已变化，请刷新后重试':'换房申请提交失败，请稍后重试');return;}
  sessionStorage.setItem(`mobile-room-transfer:${mobileRoomTransferSessionId}`,JSON.stringify({status:'REQUESTED',fromRoomCode:mobileRoomTransferFromCode}));
  document.querySelector('#mobile-room-transfer-dialog').close();
  await loadMobileDashboard();
  mobileToast('换房申请已提交，等待前台确认');
});
document.querySelector('#mobile-performance-tabs').addEventListener('click',async event=>{const button=event.target.closest('[data-mobile-range]');if(!button)return;mobilePerformanceRange=button.dataset.mobileRange;document.querySelectorAll('#mobile-performance-tabs button').forEach(item=>item.classList.toggle('selected',item===button));try{await loadMobilePerformanceRange();}catch{mobileToast('业绩数据暂时无法加载，请稍后重试');}});

const mobilePages = ['current-service', 'performance-section', 'recent-section', 'mobile-leave-section'];
const mobileDailyDateInput=document.querySelector('#mobile-daily-date');
mobileDailyDateInput.value=mobileLocalDate();
mobileDailyDateInput.max=mobileLocalDate();
document.querySelector('#load-mobile-daily-data').addEventListener('click',loadTechnicianDailyData);
mobileDailyDateInput.addEventListener('change',loadTechnicianDailyData);
const selectMobilePage = pageId => {
  if (!mobilePages.includes(pageId)) return;
  mobilePages.forEach(id => document.querySelector(`#${id}`).classList.toggle('mobile-page-hidden', id !== pageId));
  const queueSection = document.querySelector('#mobile-reservation-section');
  if (queueSection) {
    queueSection.classList.toggle('mobile-page-hidden', pageId !== 'current-service');
    const title = queueSection.querySelector('h2');
    const description = queueSection.querySelector('p');
    if (title) title.textContent = '下一单服务';
    if (description) description.textContent = '当前服务结束后，按顺序接待以下项目';
  }
  document.querySelector('.mobile-footer').classList.toggle('mobile-page-hidden', pageId !== 'current-service');
  document.querySelectorAll('#mobile-tabbar button').forEach(button => button.classList.toggle('selected', button.dataset.mobileNav === pageId));
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

document.querySelector('#mobile-tabbar').addEventListener('click', event => {
  const button = event.target.closest('[data-mobile-nav]');
  if (button) selectMobilePage(button.dataset.mobileNav);
});

selectMobilePage('current-service');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./technician-service-worker.js?v=20260912-full-optimization-v1').catch(() => {
      // The technician page remains fully available when offline caching is unavailable.
    });
  });
}

if(localStorage.getItem(mobileTokenKey))loadMobileDashboard();
else showLogin();
window.setInterval(() => { if (localStorage.getItem(mobileTokenKey)) loadMobileDashboard(); },5000);
