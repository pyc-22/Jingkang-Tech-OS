const browserFetch = window.fetch.bind(window);
window.fetch = (input, init) => browserFetch(
  typeof input === 'string' ? input.replace('http://localhost:8080', '') : input,
  init
);

const state = {
  rooms: [
    { id: '201', status: 'idle', label: '空闲' }, { id: '202', status: 'serving', label: '服务中', detail: '周悦 · 42 分钟' },
    { id: '203', status: 'idle', label: '空闲' }, { id: '205', status: 'reserved', label: '已预留', detail: '18:30 到店' },
    { id: '208', status: 'cleaning', label: '清洁中', detail: '已 12 分钟' }, { id: '301', status: 'idle', label: '空闲' },
    { id: '303', status: 'cleaning', label: '清洁中', detail: '已 14 分钟' }, { id: '306', status: 'serving', label: '服务中', detail: '张艺 · 26 分钟' }
  ],
  technicians: [
    { id: 1, name: '陈安', initials: '陈', state: 'available', queue: 1, detail: '上次下钟 17:18' },
    { id: 2, name: '李清', initials: '李', state: 'available', queue: 2, detail: '上次下钟 17:06' },
    { id: 3, name: '王宁', initials: '王', state: 'available', queue: 3, detail: '上次下钟 16:54' },
    { id: 4, name: '孙悦', initials: '孙', state: 'serving', queue: 4, detail: '202 · 剩余 48 分钟' },
    { id: 5, name: '周悦', initials: '周', state: 'serving', queue: 5, detail: '306 · 剩余 31 分钟' },
    { id: 6, name: '张艺', initials: '张', state: 'available', queue: 6, detail: '上次下钟 16:35' },
    { id: 7, name: '赵静', initials: '赵', state: 'serving', queue: 7, detail: '305 · 剩余 17 分钟' },
    { id: 8, name: '吴岚', initials: '吴', state: 'off', queue: 8, detail: '休息中' }
  ],
  orderItems: [],
  services: [
    { id: 'neck', name: '肩颈舒缓', duration: '90 分钟', price: 298 },
    { id: 'body', name: '全身经络舒压', duration: '120 分钟', price: 398 },
    { id: 'head', name: '头疗放松', duration: '60 分钟', price: 198 },
    { id: 'foot', name: '足部调理', duration: '75 分钟', price: 238 }
  ],
  serviceCategories: [],
  members: [
    { id: 'm-001', name: '林女士', phone: '138 0013 8000', level: '金卡会员', balance: 2860 },
    { id: 'm-002', name: '王女士', phone: '139 2026 6688', level: '银卡会员', balance: 1280 },
    { id: 'm-003', name: '陈先生', phone: '136 8844 1206', level: '普通会员', balance: 320 }
  ],
  selectedMemberId: null,
  activeSessions: [],
  pendingAcceptanceSessions: [],
  reassignmentSessions: [],
  dispatchCancelledSessions: [],
  acceptedSessions: [],
  pendingServiceSessions: [],
  pendingRoomTransfers: [],
  reservations: [],
  queueEvents: [],
  dispatchTransferRequests: []
};

let clockingTechIds = [];
// Each selected technician owns an independent dispatch choice.  Keep this
// client-side map separate from the legacy single-service fields so existing
// one-technician and reservation submissions remain backward compatible.
let dispatchSelections = new Map();
let dispatchFocusTechId = null;
let dispatchDefaultSelection = null;
let clockOutConfirmation = null;
let frontdeskOperationalReady = false;
let singleRoomSettlementRoomId = null;
let singleRoomSettlementRoom = null;
let singleRoomSettlementSessions = [];
let singleRoomSettlementSelection = new Set();
let managedTechnicians = [];
let editingTechnicianId = null;
let includeInactiveTechnicians = false;
let managedRooms = [];
let editingRoomId = null;
let editingBedId = null;
let managedServiceItems = [];
let editingServiceItemId = null;
let includeInactiveServices = false;
let selectedManagedServiceCategoryId = 'ALL';
let orderServiceCategoryId = 'ALL';
let orderServiceSearch = '';
let manualServiceTarget = null;
let manualServiceDraft = null;
let activeDispatchTransferRequestId = null;
// 20260912 P0: keep the pending-workflow APIs available, but do not surface
// their unstable front-desk panels in the settlement workspace.
const frontdeskPendingPanelsEnabled = false;
let dispatchServiceCategoryId = 'ALL';
let dispatchServiceSearch = '';
let serviceItemCommissionRules = [];
let editingCommissionServiceItemId = null;
let managedPaymentMethods = [];
let activePaymentMethods = [];
let historicalBackfillLines = [];
let historicalBackfillPayments = [];
let historicalBackfillPaymentMethods = [];
let historicalBackfillMember = null;
let frontdeskHistoricalBackfillRows = [];
let historicalBackfillSequence = 0;
let historicalBackfillMemberSearchTimer = null;
let editingPaymentMethodId = null;
let includeInactivePaymentMethods = false;
let storePrintSetting = null;
let localPrintBridgeOnline = false;
let changingRoom = null;
let participantTransferSessionId = null;
let dispatchReassignmentSessionId = null;
let technicianContextSessionId = null;
let serviceItemChangeSessionId = null;
let serviceItemChangeExtensions = [];
let clockTypeChangeSessionId = null;
let frontdeskExtensionSessionId = null;
let frontdeskExtensionTechnicianId = null;
let frontdeskExtensionCancelSessionId = null;
let extensionSyncInitialized = false;
let extensionSyncSnapshot = new Map();
// The participant list returned by the service-session endpoint contains both
// the historical assignment and the currently active assignment.  A replaced
// technician remains in the historical list with COMPLETED status, so all
// live-room and technician-state views must prefer the active list.  Keep the
// historical fallback for older API payloads and completed-service reports.
const sessionParticipantIds = session => {
  const raw = session?.activeParticipantTechnicianIds || session?.participantTechnicianIds || session?.technicianId || '';
  return [...new Set(String(raw).split(',').map(value => value.trim()).filter(Boolean))];
};
const sessionDisplayTechnicianName = session => session?.activeTechnicianName || session?.technicianName || '';
let serviceSessionFilter = 'ALL';
let currentAdminSession = null;
const money = (value) => `¥${value.toFixed(2)}`;
const signedMoneyCents = (cents) => `${Number(cents||0)<0?'-':''}${money(Math.abs(Number(cents||0))/100)}`;
const clockTypeLabels = { QUEUE:'排钟', CALL:'点钟', SELECTED:'选钟', BOOKED_QUEUE:'预定排钟', BOOKED_CALL:'预定点钟', EXTENSION:'加钟' };
const receiptClockTypeLabel = value => clockTypeLabels[value] || value || '—';
const dispatchTypeLabel = (value) => clockTypeLabels[value] || '排钟';
const isCallClockType = (value) => value === 'CALL' || value === 'BOOKED_CALL';
const toast = (message) => { const el = document.querySelector('#toast'); el.textContent = message; el.classList.remove('hidden'); window.setTimeout(() => el.classList.add('hidden'), 2200); };
const technicianScheduleReasonLabel={APPROVED_LEAVE:'今日已批准请假',QUEUE_DISABLED:'前台队列未启用',INACTIVE:'技师已停用',REST:'今日安排休息',CANCELLED:'今日班次已取消',NOT_SCHEDULED:'今日未排班',NOT_STARTED:'未到上班时间',SHIFT_ENDED:'班次已结束',SERVICE_OVERTIME:'服务结束后下班',AVAILABLE:'可安排服务',SCHEDULED:'已排班'};
function formatRoomCountdown(expectedEndAt) {
  const seconds = Math.ceil((new Date(expectedEndAt).getTime() - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const hours = String(Math.floor(absolute / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((absolute % 3600) / 60)).padStart(2, '0');
  const remainingSeconds = String(absolute % 60).padStart(2, '0');
  return `${seconds >= 0 ? '剩余' : '超时'} ${hours}:${minutes}:${remainingSeconds}`;
}
function refreshRoomServiceTimers() {
  document.querySelectorAll('[data-room-countdown]').forEach(element => {
    element.textContent = formatRoomCountdown(element.dataset.roomCountdown);
    element.classList.toggle('overtime', new Date(element.dataset.roomCountdown).getTime() < Date.now());
  });
}

let activeRoomTransferRejectId = null;
function roomTransferEscape(value) {
  return String(value ?? '').replace(/[&<>\"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[character]));
}

function serviceCategoryChildren() {
  const children = new Map();
  state.serviceCategories.forEach(item => {
    const key = item.parentId || 'ROOT';
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(item);
  });
  children.forEach(items => items.sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || left.name.localeCompare(right.name, 'zh-CN')));
  return children;
}

function serviceCategoryPath(categoryId) {
  if (!categoryId) return '未分类';
  const byId = new Map(state.serviceCategories.map(item => [String(item.id), item]));
  const names = [];
  const visited = new Set();
  let current = byId.get(String(categoryId));
  while (current && !visited.has(String(current.id))) {
    visited.add(String(current.id));
    names.unshift(current.name);
    current = current.parentId ? byId.get(String(current.parentId)) : null;
  }
  return names.join(' / ') || '未分类';
}

function serviceCategoryDescendantIds(categoryId) {
  const children = serviceCategoryChildren();
  const ids = new Set();
  const visit = id => {
    if (ids.has(String(id))) return;
    ids.add(String(id));
    (children.get(String(id)) || []).forEach(item => visit(item.id));
  };
  visit(categoryId);
  return ids;
}

function serviceMatchesCategory(service, categoryId) {
  if (categoryId === 'ALL') return true;
  if (categoryId === 'UNCATEGORIZED') return !service.categoryId;
  return service.categoryId && serviceCategoryDescendantIds(categoryId).has(String(service.categoryId));
}

function serviceCategoryOptions(selectedId = '', excludedId = '') {
  const children = serviceCategoryChildren();
  const excluded = excludedId ? serviceCategoryDescendantIds(excludedId) : new Set();
  const render = (parentId = 'ROOT', depth = 0) => (children.get(parentId) || []).map(item => {
    if (excluded.has(String(item.id))) return '';
    const selected = String(item.id) === String(selectedId) ? ' selected' : '';
    return `<option value="${roomTransferEscape(item.id)}"${selected}>${'　'.repeat(depth)}${roomTransferEscape(item.name)}</option>${render(String(item.id), depth + 1)}`;
  }).join('');
  return render();
}

function serviceCategoryNavigation(selectedId, dataAttribute, includeCounts = false) {
  const children = serviceCategoryChildren();
  const count = categoryId => state.services.filter(service => serviceMatchesCategory(service, categoryId)).length;
  const button = (id, name, depth = 0) => `<button type="button" class="service-category-button${String(selectedId) === String(id) ? ' selected' : ''}" data-${dataAttribute}="${id}" style="--category-depth:${depth}"><span>${roomTransferEscape(name)}</span>${includeCounts ? `<small>${count(id)}</small>` : ''}</button>`;
  const render = (parentId = 'ROOT', depth = 0) => (children.get(parentId) || []).map(item => `${button(item.id, item.name, depth)}${render(String(item.id), depth + 1)}`).join('');
  return `${button('ALL', '全部项目')}${button('UNCATEGORIZED', '未分类')}${render()}`;
}

function groupedServiceSelectOptions(services) {
  const groups = new Map();
  services.forEach(service => {
    const path = serviceCategoryPath(service.categoryId);
    if (!groups.has(path)) groups.set(path, []);
    groups.get(path).push(service);
  });
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'zh-CN')).map(([path, items]) => `<optgroup label="${roomTransferEscape(path)}">${items.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')).map(item => `<option value="${roomTransferEscape(item.id)}">${roomTransferEscape(item.name)} · ${roomTransferEscape(item.duration)} · ¥${Number(item.price || 0).toFixed(2)}</option>`).join('')}</optgroup>`).join('');
}
async function loadRoomTransferRequests({ silent = false } = {}) {
  if (!frontdeskPendingPanelsEnabled) {
    state.pendingRoomTransfers = [];
    return [];
  }
  ensureRoomTransferPanel();
  const panel = document.querySelector('#room-transfer-panel');
  if (typeof hasAdminPermission !== 'function' || !hasAdminPermission('ROOM_TRANSFER_APPROVE')) {
    if (panel) panel.hidden = true;
    state.pendingRoomTransfers = [];
    return [];
  }
  if (panel) panel.hidden = false;
  const response = await fetch('http://localhost:8080/api/v1/service-room-transfers?status=REQUESTED', { headers: storeContextHeaders() });
  if (response.status === 403) { if (panel) panel.hidden = true; state.pendingRoomTransfers = []; return []; }
  if (!response.ok) { if (!silent) toast('换房申请加载失败'); throw new Error(`ROOM_TRANSFER_${response.status}`); }
  state.pendingRoomTransfers = await response.json();
  renderRoomTransferRequests();
  return state.pendingRoomTransfers;
}
async function approveRoomTransfer(id) {
  const response = await fetch(`http://localhost:8080/api/v1/service-room-transfers/${id}/approve`, { method:'POST', headers:storeContextHeaders() });
  if (!response.ok) { toast('确认换房失败，房间状态可能已变化'); return; }
  await Promise.all([loadFoundationData({ silent:true }), loadRoomTransferRequests({ silent:true })]);
  toast('换房已确认，原房间已进入清洁');
}
function openRoomTransferReject(id) {
  activeRoomTransferRejectId = id;
  const form = document.querySelector('#room-transfer-reject-form');
  form.reset();
  document.querySelector('#room-transfer-reject-dialog').showModal();
}

function ensureServiceExtensionIntentPanel() {
  if (!frontdeskPendingPanelsEnabled) return;
  if (document.querySelector('#service-extension-intent-panel')) return;
  ensureDispatchReassignmentPanel();
  const eventPanel = document.querySelector('#dispatch-reassignment-panel');
  const list = document.querySelector('#technician-list');
  if (!eventPanel && !list) return;
  const markup = '<div class="pending-event-group service-extension-intent-panel" id="service-extension-intent-panel"><div class="pending-event-group-heading"><h3>意向加钟</h3><button class="text-button" type="button" id="refresh-service-extension-intents">刷新</button></div><p class="pending-event-hint">技师提交后，由前台与顾客沟通</p><div id="service-extension-intent-list"><p class="table-empty">暂无待处理意向</p></div></div>';
  if (eventPanel) eventPanel.insertAdjacentHTML('beforeend', markup);
  else list.insertAdjacentHTML('beforebegin', markup);
  document.querySelector('#refresh-service-extension-intents').addEventListener('click', () => loadServiceExtensionIntents());
  document.querySelector('#service-extension-intent-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-extension-intent-action]');
    if (!button) return;
    const id = button.dataset.extensionIntentId;
    const action = button.dataset.extensionIntentAction;
    const url = action === 'contacted' ? `http://localhost:8080/api/v1/service-extension-intents/${id}/contacted` : `http://localhost:8080/api/v1/service-extension-intents/${id}/reject`;
    const body = action === 'reject' ? { reason: window.prompt('可填写拒绝原因（可不填）', '') || null } : null;
    button.disabled = true;
    const response = await fetch(url, { method:'PUT', headers: body ? storeContextHeaders(true) : storeContextHeaders(), ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) { button.disabled = false; return toast('意向加钟处理失败，请刷新后重试'); }
    await loadServiceExtensionIntents();
    toast(action === 'contacted' ? '已标记为已沟通' : '已拒绝意向加钟');
  });
}

async function loadServiceExtensionIntents() {
  if (!frontdeskPendingPanelsEnabled) return;
  ensureServiceExtensionIntentPanel();
  const target = document.querySelector('#service-extension-intent-list');
  if (!target) return;
  try {
    const response = await fetch('http://localhost:8080/api/v1/service-extension-intents?status=PENDING', { headers: storeContextHeaders() });
    if (!response.ok) throw new Error(response.status);
    const rows = await response.json();
    target.innerHTML = rows.map(row => `<article class="extension-intent-row"><div><b>${memberBusinessEscape(row.roomCode || '')} 房 · ${memberBusinessEscape(row.memberName || '散客')}</b><small>${memberBusinessEscape(row.technicianName)} · ${memberBusinessEscape(row.serviceName)} · ${new Date(row.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}${row.technicianNote ? ` · ${memberBusinessEscape(row.technicianNote)}` : ''}</small>${row.hasUpcomingAssignment ? '<em>该技师后续已有点钟，无法继续加钟</em>' : ''}</div><div class="extension-intent-actions"><button class="text-button" type="button" data-extension-intent-action="contacted" data-extension-intent-id="${roomTransferEscape(row.id)}">已沟通</button><button class="text-button danger" type="button" data-extension-intent-action="reject" data-extension-intent-id="${roomTransferEscape(row.id)}">拒绝意向</button></div></article>`).join('') || '<p class="table-empty">暂无待处理意向</p>';
  } catch { target.innerHTML = '<p class="table-empty">意向消息暂时无法加载</p>'; }
}

async function loadFoundationData({ silent = false } = {}) {
  try {
    const base = 'http://localhost:8080/api/v1/foundation';
    const [technicians, rooms, services, serviceCategories, statuses, sessions, pendingAcceptance, reassignment, dispatchCancelled, accepted, eligibility, queueSnapshot, allSessions, waitingReservations] = await Promise.all([`${base}/technicians`, `${base}/rooms`, `${base}/service-items`, 'http://localhost:8080/api/v1/service-categories', 'http://localhost:8080/api/v1/rooms/statuses', 'http://localhost:8080/api/v1/service-sessions?status=IN_SERVICE', 'http://localhost:8080/api/v1/service-sessions?status=PENDING_ACCEPTANCE', 'http://localhost:8080/api/v1/service-sessions?status=REASSIGNMENT_REQUIRED', 'http://localhost:8080/api/v1/service-sessions?status=DISPATCH_CANCELLED', 'http://localhost:8080/api/v1/service-sessions?status=ACCEPTED', 'http://localhost:8080/api/v1/technician-schedules/clock-eligibility', 'http://localhost:8080/api/v1/technician-queue', 'http://localhost:8080/api/v1/service-sessions', 'http://localhost:8080/api/v1/service-reservations?status=WAITING'].map(url => fetch(url, { headers: storeContextHeaders() }).then(response => { if (!response.ok) throw new Error(response.status); return response.json(); })));
    const eligibilityByTechnician=new Map((eligibility.technicians||[]).map(item=>[item.technicianId,item]));
    const queueByTechnician = new Map((queueSnapshot.technicians||[]).map(item => [String(item.technicianId), item.queuePosition]));
    const businessDate = String(queueSnapshot.businessDate || '');
    const waitingReservationByTechnician = new Map((waitingReservations||[]).filter(item => item.technicianId).map(item => [String(item.technicianId), item]));
    state.technicians = technicians.map((tech, index) => { const schedule=eligibilityByTechnician.get(tech.id); const eligible=!schedule||schedule.eligible; const clockedIn=!schedule||schedule.clockedIn||schedule.legacyCompatible; return { id: tech.id, code:tech.code, name: tech.name, initials: tech.name.slice(0, 1), queueEnabled: tech.queueEnabled !== false, clockedIn, state: eligible?'available':'off', queue: queueByTechnician.get(String(tech.id)) ?? tech.queueOrder ?? index + 1, detail:eligible?'可立即安排服务':(technicianScheduleReasonLabel[schedule?.reason]||'当前不可上钟'), queueCount:0, callCount:0, extensionCount:0, nextReservation:waitingReservationByTechnician.get(String(tech.id)) || null }; });
    const labels = { IDLE:['idle','空闲'], IN_SERVICE:['serving','服务中'], PENDING_PAYMENT:['pending-payment','待付款'], CLEANING:['cleaning','清洁中'], RESERVED:['reserved','已预留'] };
    labels.MAINTENANCE=['maintenance','维修中'];
    const roomStatusSelect=document.querySelector('#room-status-form select[name="status"]');
    if(roomStatusSelect && !roomStatusSelect.querySelector('option[value="MAINTENANCE"]')) roomStatusSelect.insertAdjacentHTML('beforeend','<option value="MAINTENANCE">维修中</option>');
    const roomSessions = new Map();
    [...sessions, ...pendingAcceptance, ...reassignment, ...dispatchCancelled, ...accepted].forEach(session => {
      const key = String(session.roomId);
      if (!roomSessions.has(key)) roomSessions.set(key, []);
      roomSessions.get(key).push(session);
    });
    const nextExtensionSnapshot = new Map(sessions.map(session => [String(session.id), String(session.extensionSummary || '')]));
    if (extensionSyncInitialized) {
      sessions.forEach(session => {
        const previous = extensionSyncSnapshot.get(String(session.id)) || '';
        const current = String(session.extensionSummary || '');
        if (current && current !== previous) toast(`${sessionDisplayTechnicianName(session) || '技师'} 已提交加钟：${current}`);
      });
    }
    extensionSyncSnapshot = nextExtensionSnapshot;
    extensionSyncInitialized = true;
    state.rooms = rooms.map(room => {
      const current = statuses.find(item => item.roomId === room.id);
      const roomList = roomSessions.get(String(room.id)) || [];
      const capacity = Number(room.bedCount || 1);
      const session = roomList[0];
      const displayStatus = roomList.some(item => item.status === 'IN_SERVICE') ? 'IN_SERVICE' : roomList.some(item => item.status === 'PENDING_ACCEPTANCE' || item.status === 'ACCEPTED') ? 'RESERVED' : current?.status || 'IDLE';
      const [status,label] = labels[displayStatus] || labels.IDLE;
      const services = roomList.flatMap(item => {
        const participantIds = sessionParticipantIds(item);
        const participants = participantIds.length ? participantIds : [null];
        return participants.map((technicianId, index) => {
          const technician = technicianId ? state.technicians.find(candidate => String(candidate.id) === String(technicianId)) : null;
          const fallbackNames = String(sessionDisplayTechnicianName(item)).split('、').map(value => value.trim()).filter(Boolean);
          return {
            sessionId: item.id,
            technicianId,
            technicianName: technician?.name || fallbackNames[index] || '待派单',
            serviceName: item.serviceNameSnapshot,
            status: item.status,
            plannedDurationMinutes: item.plannedDurationMinutes,
            expectedEndAt: item.expectedEndAt,
            extensionSummary: item.extensionSummary || ''
          };
        });
      });
      const serviceCount = services.length;
      const bedText = `${serviceCount}/${capacity} 床已用 · 余 ${Math.max(0, capacity - serviceCount)} 床`;
      const details = roomList.length ? bedText : `${bedText}${current?.reason ? ` · ${current.reason}` : ''}`;
      const exceptionSession = roomList.find(item => ['REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED'].includes(item.status));
      return { id: room.code, apiId: room.id, sessionId: session?.id || null, exceptionSessionId: exceptionSession?.id || null, exceptionStatus: exceptionSession?.status || null, status, label, detail: details, services, expectedEndAt: session?.expectedEndAt, bedCount: capacity, occupiedBedCount: serviceCount, availableBedCount: Math.max(0, capacity - serviceCount) };
    });
    state.serviceCategories = serviceCategories || [];
    state.services = services.map(service => ({ id: service.id, code: service.code, name: service.name, category: service.category || '未分类', categoryId: service.categoryId || null, duration: `${service.defaultDurationMinutes} 分钟`, durationMinutes:service.defaultDurationMinutes, price: service.priceCents / 100, dispatchType: service.dispatchType || 'QUEUE', allowsExtension:service.allowsExtension !== false }));
    state.activeSessions = sessions;
    state.pendingAcceptanceSessions = pendingAcceptance;
    state.reassignmentSessions = reassignment;
    state.dispatchCancelledSessions = dispatchCancelled;
    state.acceptedSessions = accepted;
    sessions.forEach(session => sessionParticipantIds(session).forEach(id => {
      const tech = state.technicians.find(item => String(item.id) === id);
      if (tech) { tech.state = 'serving'; tech.detail = `${session.roomCode} 房 · ${session.serviceNameSnapshot} · ${session.plannedDurationMinutes} 分钟${session.extensionSummary ? ` · 加钟：${session.extensionSummary}` : ''}`; }
    }));
    pendingAcceptance.forEach(session => sessionParticipantIds(session).forEach(id => {
      const tech = state.technicians.find(item => String(item.id) === id);
      if (tech) { tech.state = 'pending'; tech.detail = `${session.roomCode} 房 · 等待接单`; }
    }));
    // Rejected and expired participants are no longer assigned to the session.
    // Keep the service in the reassignment panel, but leave those technicians available.
    accepted.forEach(session => sessionParticipantIds(session).forEach(id => {
      const tech = state.technicians.find(item => String(item.id) === id);
      if (tech) { tech.state = 'accepted'; tech.detail = `${session.roomCode} 房 · 已接单，待开始服务`; }
    }));
    allSessions.filter(session => ['IN_SERVICE','COMPLETED'].includes(session.status) && String(session.businessDate) === businessDate).forEach(session => {
      const field = ['QUEUE','BOOKED_QUEUE'].includes(session.clockType) ? 'queueCount' : ['CALL','BOOKED_CALL'].includes(session.clockType) ? 'callCount' : null;
      if (field) sessionParticipantIds(session).forEach(id => { const tech = state.technicians.find(item => String(item.id) === id); if (tech) tech[field] += 1; });
      String(session.extensionTechnicianIds || '').split(',').filter(Boolean).forEach(id => {
        const tech = state.technicians.find(item => String(item.id) === String(id));
        if (tech) tech.extensionCount += 1;
      });
    });
    frontdeskOperationalReady = true;
    renderRooms(); renderTechnicians(); renderOrder();
    if (frontdeskPendingPanelsEnabled) {
      await loadServiceExtensionIntents();
      renderDispatchReassignmentPanel();
      await loadDispatchTransferRequests({ silent: true });
    }
    await loadQueueEvents({ silent: true });
    await loadReservations({ silent: true });
    await loadPendingServiceSessions({ silent: true });
    updateOperationalSyncStatus(true);
    return true;
  } catch {
    frontdeskOperationalReady = false;
    state.rooms = [];
    state.technicians = [];
    state.services = [];
    state.serviceCategories = [];
    state.members = [];
    state.selectedMemberId = null;
    state.activeSessions = [];
    state.pendingAcceptanceSessions = [];
    state.reassignmentSessions = [];
    state.dispatchCancelledSessions = [];
    state.acceptedSessions = [];
    state.pendingServiceSessions = [];
    state.orderItems = [];
    state.pendingRoomTransfers = [];
    state.queueEvents = [];
    state.dispatchTransferRequests = [];
    renderRooms(); renderTechnicians(); renderOrder(); renderMemberCard();
    renderDispatchReassignmentPanel();
    renderDispatchTransferRequests();
    renderQueueEvents();
    updateOperationalSyncStatus(false);
    if (!silent) toast('基础资料服务不可用，已停止收银操作');
    return false;
  }
}

const queueEventLabels = { DAY_INITIALIZED:'\u8425\u4e1a\u65e5\u521d\u59cb\u5316', TECHNICIAN_JOINED:'\u6280\u5e08\u52a0\u5165\u961f\u5217', MANUAL_REORDER:'\u624b\u52a8\u8c03\u6574', SERVICE_ROTATED:'\u6392\u949f\u8f6e\u8f6c' };
function ensureQueueEventPanel() {
  const existing = document.querySelector('#queue-event-panel');
  const management = document.querySelector('#management-view');
  if (existing) {
    if (management && !existing.closest('#management-view')) management.querySelector('.management-grid')?.insertAdjacentElement('beforebegin', existing);
    return;
  }
  const anchor = management?.querySelector('.management-grid') || document.querySelector('#dispatch-reassignment-panel') || document.querySelector('.pending-service-queue');
  anchor?.insertAdjacentHTML('afterend', '<section class="pending-service-queue queue-event-panel" id="queue-event-panel"><div class="pending-service-heading"><span>\u4eca\u65e5\u8f6e\u949f\u8bb0\u5f55</span><button class="icon-button" id="refresh-queue-events" type="button" title="\u5237\u65b0\u8f6e\u949f\u8bb0\u5f55" aria-label="\u5237\u65b0\u8f6e\u949f\u8bb0\u5f55">\u21bb</button></div><div id="queue-event-list"><p class="pending-service-empty">\u6b63\u5728\u52a0\u8f7d</p></div></section>');
  document.querySelector('#refresh-queue-events')?.addEventListener('click', () => loadQueueEvents());
}
function queueEventEscape(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character])); }
function renderQueueEvents() {
  ensureQueueEventPanel();
  const list = document.querySelector('#queue-event-list');
  if (!list) return;
  list.innerHTML = state.queueEvents.map(item => {
    const position = item.toPosition == null ? '' : (item.fromPosition == null ? `\u7b2c ${item.toPosition} \u4f4d` : `\u7b2c ${item.fromPosition} \u4f4d \u2192 \u7b2c ${item.toPosition} \u4f4d`);
    const time = item.occurredAt ? new Date(item.occurredAt).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', hour12:false }) : '';
    return `<article class="queue-event-item"><span><b>${queueEventEscape(queueEventLabels[item.eventType] || item.eventType)}</b><small>${queueEventEscape(item.technicianName || '\u7cfb\u7edf')} ${position}${item.reason ? `\u00b7 ${queueEventEscape(item.reason)}` : ''}</small></span><time>${time}</time></article>`;
  }).join('') || '<p class="pending-service-empty">\u6682\u65e0\u4eca\u65e5\u8f6e\u949f\u53d8\u52a8</p>';
}
async function loadQueueEvents({ silent = false } = {}) {
  ensureQueueEventPanel();
  try {
    const response = await fetch('http://localhost:8080/api/v1/technician-queue/events?limit=24', { headers:storeContextHeaders() });
    if (!response.ok) throw new Error(response.status);
    state.queueEvents = await response.json();
  } catch {
    state.queueEvents = [];
    if (!silent) toast('\u8f6e\u949f\u8bb0\u5f55\u52a0\u8f7d\u5931\u8d25');
  }
  renderQueueEvents();
}

function ensureReservationPanel() {
  if (document.querySelector('#service-reservation-list')) return;
  document.querySelector('.pending-service-queue')?.insertAdjacentHTML('afterend', '<section class="pending-service-queue" id="service-reservation-panel"><div class="pending-service-heading"><span>待派预约</span><button class="icon-button" id="refresh-reservations" type="button" title="刷新预约" aria-label="刷新预约">↻</button></div><div id="service-reservation-list"><p class="pending-service-empty">正在加载</p></div></section>');
}

function renderReservations() {
  ensureReservationPanel();
  const list = document.querySelector('#service-reservation-list');
  if (!list) return;
  list.innerHTML = state.reservations.map(item => { const room = state.rooms.find(candidate => String(candidate.apiId) === String(item.roomId)); const tech = state.technicians.find(candidate => String(candidate.id) === String(item.technicianId)); const busy = tech?.state === 'serving' || tech?.state === 'pending' || tech?.state === 'accepted'; const blocked = room?.status === 'pending-payment' || room?.status === 'cleaning' || room?.status === 'maintenance' || busy && room?.status === 'serving'; const reason = room?.status === 'pending-payment' ? '等待当前订单收款' : room?.status === 'cleaning' ? '等待房间清洁完成' : room?.status === 'maintenance' ? '房间维修中' : busy ? '等待当前服务结束' : '可确认派单'; return `<article class="pending-service-item"><span><b>${roomTransferEscape(clockTypeLabels[item.reservationType] || item.reservationType)} · ${roomTransferEscape(item.roomCode)} 房</b><small>${roomTransferEscape(item.serviceNameSnapshot)} · ${roomTransferEscape(item.technicianName || '待指定技师')} · ${roomTransferEscape(item.plannedDurationMinutes)} 分钟 · ${reason}</small></span><button class="record-delete edit-technician" type="button" data-reservation-dispatch="${roomTransferEscape(item.id)}" ${blocked ? 'disabled' : ''}>${blocked ? reason : '确认派单'}</button></article>`; }).join('') || '<p class="pending-service-empty">暂无待派预约</p>';
}

async function loadReservations({ silent = false } = {}) {
  ensureReservationPanel();
  const response = await fetch('http://localhost:8080/api/v1/service-reservations?status=WAITING', { headers: storeContextHeaders() });
  if (!response.ok) { state.reservations = []; renderReservations(); if (!silent) toast('预约记录加载失败'); return; }
  state.reservations = await response.json();
  renderReservations();
}

async function dispatchReservation(id) {
  const item = state.reservations.find(candidate => candidate.id === id);
  if (!item) return;
  const response = await fetch(`http://localhost:8080/api/v1/service-reservations/${id}/dispatch`, { method:'POST', headers:storeContextHeaders(true), body:JSON.stringify({ technicianId:item.technicianId, serviceItemId:item.serviceItemId, plannedDurationMinutes:item.plannedDurationMinutes }) });
  if (!response.ok) { const detail = (await response.text()).replace(/^"|"$/g, ''); toast(detail || '预约当前不可派单，请先完成当前服务、收款或清洁'); return; }
  await Promise.all([loadFoundationData({ silent:true }), loadReservations({ silent:true })]);
  toast('预约已转为正式派单，等待技师接单');
}

let operationalRefreshInFlight = false;
const isFrontdeskVisible = () => document.querySelector('#frontdesk-view') && !document.querySelector('#frontdesk-view').classList.contains('hidden');
function updateOperationalSyncStatus(success) {
  const status = document.querySelector('#operational-sync-status');
  if (!status) return;
  if (!success) { status.textContent = '同步失败'; status.classList.add('stale'); return; }
  const time = new Intl.DateTimeFormat('zh-CN', { hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date());
  status.textContent = `${time} 已同步`;
  status.classList.remove('stale');
}
async function syncOperationalState({ manual = false } = {}) {
  if (operationalRefreshInFlight) return;
  operationalRefreshInFlight = true;
  try {
    const success = await loadFoundationData({ silent: true });
    if (manual) toast(success ? '门店状态已同步' : '门店状态同步失败');
  } finally { operationalRefreshInFlight = false; }
}
function syncFrontdeskWhenVisible() {
  if (document.visibilityState === 'visible' && isFrontdeskVisible()) syncOperationalState();
}
window.setInterval(syncFrontdeskWhenVisible, 5000);
window.setInterval(refreshRoomServiceTimers, 1000);
document.addEventListener('visibilitychange', syncFrontdeskWhenVisible);

function renderRooms() {
  console.log('renderRooms called', state.rooms.length);
  document.querySelector('#room-grid').innerHTML = state.rooms.map(room => {
    const pendingSessions = room.status === 'pending-payment'
      ? state.pendingServiceSessions.filter(session => String(session.roomId) === String(room.apiId))
      : [];
    const primaryPending = pendingSessions[0];
    const pendingTechnician = primaryPending
      ? state.technicians.find(technician => String(technician.id) === String(primaryPending.technicianId))
        || state.technicians.find(technician => technician.name === primaryPending.technicianName)
      : null;
    const pendingSummary = primaryPending
      ? `<span class="room-pending-summary"><b>${roomTransferEscape(primaryPending.technicianName)}${pendingTechnician?.code ? `（${roomTransferEscape(pendingTechnician.code)}）` : ''}${pendingSessions.length > 1 ? roomTransferEscape(`等 ${pendingSessions.length} 人`) : ''}</b><small>${roomTransferEscape(primaryPending.serviceNameSnapshot)}${pendingSessions.length > 1 ? roomTransferEscape(` 等 ${pendingSessions.length} 项`) : ''}</small></span>`
      : '';
    const serviceRows = (room.services || []).map(service => {
      const timer = service.status === 'IN_SERVICE' && service.expectedEndAt
        ? `<span class="room-service-timer" data-room-countdown="${roomTransferEscape(service.expectedEndAt)}">${formatRoomCountdown(service.expectedEndAt)}</span>`
        : `<span class="room-service-state">${service.status === 'PENDING_ACCEPTANCE' ? '待接单' : service.status === 'ACCEPTED' ? '待开始' : ''}</span>`;
      const extension = service.extensionSummary ? ` · 加钟：${service.extensionSummary}` : '';
      return `<span class="room-service-row"><span class="room-service-main"><b>${roomTransferEscape(service.technicianName)}</b><small>${roomTransferEscape(service.serviceName)}${roomTransferEscape(extension)} · ${Number(service.plannedDurationMinutes || 0)} 分钟</small></span>${timer}</span>`;
    }).join('');
    const exceptionActions = room.exceptionSessionId && room.apiId ? `<button class="room-dispatch-action" data-dispatch-reassignment="${roomTransferEscape(room.exceptionSessionId)}" type="button">重新派单</button>${room.exceptionStatus === 'REASSIGNMENT_REQUIRED' ? `<button class="room-dispatch-action danger" data-dispatch-cancellation="${roomTransferEscape(room.exceptionSessionId)}" type="button">取消派单</button>` : ''}` : '';
    return `<article class="room ${roomTransferEscape(room.status)}"><div class="room-card" data-room="${roomTransferEscape(room.id)}" role="button" tabindex="0"><span class="room-top"><span class="dot ${roomTransferEscape(room.status)}"></span><span>${roomTransferEscape(room.label)}</span></span><strong>${roomTransferEscape(room.id)}</strong><small>${roomTransferEscape(room.detail || '可立即安排服务')}</small>${pendingSummary}${serviceRows ? `<span class="room-services">${serviceRows}</span>` : ''}</div><div class="room-actions">${exceptionActions}${room.status === 'serving' && room.apiId ? `<button class="room-transfer-tech-action" data-transfer-technician="${roomTransferEscape(room.id)}" type="button">换技师</button>` : ''}${room.status === 'pending-payment' && room.apiId ? `<button class="room-paid-action" data-confirm-payment="${roomTransferEscape(room.id)}" type="button">已付款</button>` : ''}${room.status === 'cleaning' && room.apiId ? `<button class="room-clean-action" data-complete-cleaning="${roomTransferEscape(room.id)}" type="button">完成清洁</button>` : ''}${room.apiId ? `<button class="room-status-action" data-room-status="${roomTransferEscape(room.id)}" type="button">状态</button>` : ''}</div></article>`;
  }).join('');
  document.querySelector('#available-room-count').textContent = state.rooms.reduce((total, room) => total + Number(room.availableBedCount || 0), 0);
  const reassignmentButtons = document.querySelectorAll('#room-grid [data-dispatch-reassignment]');
  console.log('found buttons', reassignmentButtons.length);
  reassignmentButtons.forEach(button => {
    button.addEventListener('click', event => { console.log('dispatch button clicked', event.target); event.preventDefault(); event.stopPropagation(); openDispatchReassignment(button.dataset.dispatchReassignment); });
  });
  document.querySelectorAll('#room-grid [data-dispatch-cancellation]').forEach(button => {
    button.addEventListener('click', event => { console.log('dispatch button clicked', event.target); event.preventDefault(); event.stopPropagation(); dispatchReassignmentSessionId = button.dataset.dispatchCancellation; openDispatchCancellation(); });
  });
}

const dispatchEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const dispatchEventLabel = { ASSIGNED:'已派单', ACCEPTED:'已接单', REJECTED:'已拒单', EXPIRED:'接单超时', REASSIGNED:'已重新派单', DISPATCH_CANCELLED:'已取消派单' };

function ensureDispatchReassignmentDialogs() {
  if (!document.querySelector('#dispatch-reassignment-dialog')) {
    document.body.insertAdjacentHTML('beforeend', '<dialog id="dispatch-reassignment-dialog"><form id="dispatch-reassignment-form" class="dialog-card compact dispatch-reassignment-dialog"><div class="dialog-heading"><div><p class="eyebrow">派单异常处理</p><h2>人工重新派单</h2></div><button class="icon-button" id="close-dispatch-reassignment" type="button" aria-label="关闭">×</button></div><div class="dispatch-reassignment-summary" id="dispatch-reassignment-summary"></div><div class="form-grid"><label class="form-full">待替换技师位<select id="dispatch-reassignment-slot" name="slotNo" required></select></label><label class="form-full">重新安排技师<select id="dispatch-reassignment-technician" name="technicianId" required></select></label><label class="form-full">重新派单说明<textarea name="reason" rows="3" maxlength="240" required placeholder="例如：技师临时有事，改由其他技师服务"></textarea></label></div><section class="dispatch-event-history"><h3>派单记录</h3><div id="dispatch-event-history-list"></div></section><div class="dialog-actions"><button class="button secondary" id="cancel-dispatch-reassignment" type="button">关闭</button><button class="button danger" id="open-dispatch-cancellation" type="button">取消派单</button><button class="button primary" type="submit">确认重新派单</button></div></form></dialog>');
    const close = () => document.querySelector('#dispatch-reassignment-dialog').close();
    document.querySelector('#close-dispatch-reassignment').addEventListener('click', close);
    document.querySelector('#cancel-dispatch-reassignment').addEventListener('click', close);
    document.querySelector('#open-dispatch-cancellation').addEventListener('click', openDispatchCancellation);
    document.querySelector('#dispatch-reassignment-form').addEventListener('submit', submitDispatchReassignment);
  }
  if (!document.querySelector('#dispatch-cancellation-dialog')) {
    document.body.insertAdjacentHTML('beforeend', '<dialog id="dispatch-cancellation-dialog"><form id="dispatch-cancellation-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">派单异常处理</p><h2>取消本次派单</h2></div><button class="icon-button" id="close-dispatch-cancellation" type="button" aria-label="关闭">×</button></div><p class="participant-transfer-note">取消后不会删除服务单，房间会保留在“待与客沟通”，技师立即解除占用。</p><label class="form-full">取消原因<textarea name="reason" rows="3" maxlength="240" required placeholder="例如：当前没有其他空闲技师，前台先与客人沟通"></textarea></label><div class="dialog-actions"><button class="button secondary" id="back-dispatch-cancellation" type="button">返回</button><button class="button danger" type="submit">确认取消派单</button></div></form></dialog>');
    const closeCancellation = () => document.querySelector('#dispatch-cancellation-dialog').close();
    document.querySelector('#close-dispatch-cancellation').addEventListener('click', closeCancellation);
    document.querySelector('#back-dispatch-cancellation').addEventListener('click', closeCancellation);
    document.querySelector('#dispatch-cancellation-form').addEventListener('submit', submitDispatchCancellation);
  }
}

function ensureDispatchReassignmentPanel() {
  if (!frontdeskPendingPanelsEnabled) return;
  const frontdeskLayout = document.querySelector('#frontdesk-view .frontdesk-layout');
  const existingPanel = document.querySelector('#dispatch-reassignment-panel');
  if (existingPanel && existingPanel.closest('#order-panel')) {
    frontdeskLayout?.insertAdjacentElement('afterend', existingPanel);
  }
  if (!document.querySelector('#dispatch-reassignment-panel')) {
    frontdeskLayout?.insertAdjacentHTML('afterend', '<section class="panel room-transfer-panel dispatch-reassignment-panel" id="dispatch-reassignment-panel"><div class="panel-heading"><div><h2>待处理事件</h2><p>拒单、超时、待沟通和技师转单统一在这里处理</p></div><button class="text-button" id="refresh-dispatch-reassignments" type="button" title="刷新待处理事件">刷新</button></div><div class="pending-event-group"><h3>重新派单</h3><div class="room-transfer-list" id="dispatch-reassignment-list"><p class="table-empty">正在加载</p></div></div><div class="pending-event-group"><h3>待与客沟通</h3><div class="room-transfer-list" id="dispatch-cancelled-list"><p class="table-empty">正在加载</p></div></div><div class="pending-event-group"><h3>技师转单申请</h3><div class="room-transfer-list" id="dispatch-transfer-list"><p class="table-empty">正在加载</p></div></div></section>');
  }
  ensureDispatchReassignmentDialogs();
  const panel = document.querySelector('#dispatch-reassignment-panel');
  if (panel && panel.dataset.bound !== 'true') {
    panel.dataset.bound = 'true';
    document.querySelector('#refresh-dispatch-reassignments')?.addEventListener('click', () => loadFoundationData({ silent:true }));
    document.querySelector('#dispatch-reassignment-list')?.addEventListener('click', event => {
      const button = event.target.closest('[data-dispatch-reassignment]');
      if (button) openDispatchReassignment(button.dataset.dispatchReassignment);
    });
    document.querySelector('#dispatch-cancelled-list')?.addEventListener('click', event => {
      const button = event.target.closest('[data-dispatch-reassignment]');
      if (button) openDispatchReassignment(button.dataset.dispatchReassignment);
    });
    document.querySelector('#dispatch-transfer-list')?.addEventListener('click', event => {
      const button = event.target.closest('[data-dispatch-transfer]');
      if (button) openDispatchTransferReview(button.dataset.dispatchTransfer);
    });
  }
}

function renderDispatchReassignmentPanel() {
  if (!frontdeskPendingPanelsEnabled) return;
  ensureDispatchReassignmentPanel();
  const list = document.querySelector('#dispatch-reassignment-list');
  if (!list) return;
  list.innerHTML = (state.reassignmentSessions || []).map(session => `<article class="room-transfer-row dispatch-reassignment-item"><div class="room-transfer-main"><p>${dispatchEscape(session.serviceNameSnapshot)} · ${dispatchEscape(session.roomCode)} 房</p><small>${dispatchEscape(sessionDisplayTechnicianName(session))} · ${roomTransferEscape(dispatchTypeLabel(session.clockType))} · 等待前台重新安排</small></div><div class="room-transfer-actions"><button class="button secondary" type="button" data-dispatch-reassignment="${roomTransferEscape(session.id)}">重新派单</button></div></article>`).join('') || '<p class="table-empty">暂无待重新派单服务</p>';
  const cancelledList = document.querySelector('#dispatch-cancelled-list');
  if (cancelledList) cancelledList.innerHTML = (state.dispatchCancelledSessions || []).map(session => `<article class="room-transfer-row dispatch-reassignment-item"><div class="room-transfer-main"><p>${dispatchEscape(session.serviceNameSnapshot)} · ${dispatchEscape(session.roomCode)} 房</p><small>${roomTransferEscape(dispatchTypeLabel(session.clockType))} · 已取消派单，等待前台与客人沟通</small></div><div class="room-transfer-actions"><button class="button secondary" type="button" data-dispatch-reassignment="${roomTransferEscape(session.id)}">重新派单</button></div></article>`).join('') || '<p class="table-empty">暂无待沟通服务</p>';
}

async function loadDispatchTransferRequests({ silent = false } = {}) {
  if (!frontdeskPendingPanelsEnabled) {
    state.dispatchTransferRequests = [];
    return [];
  }
  ensureDispatchReassignmentPanel();
  try {
    const response = await fetch('http://localhost:8080/api/v1/service-transfer-requests?status=REQUESTED', { headers: storeContextHeaders() });
    if (!response.ok) throw new Error(response.status);
    state.dispatchTransferRequests = await response.json();
    renderDispatchTransferRequests();
  } catch {
    state.dispatchTransferRequests = [];
    renderDispatchTransferRequests();
    if (!silent) toast('转单申请加载失败');
  }
}

function renderDispatchTransferRequests() {
  const list = document.querySelector('#dispatch-transfer-list');
  if (!list) return;
  list.innerHTML = (state.dispatchTransferRequests || []).map(item => `<article class="room-transfer-row dispatch-transfer-item"><div class="room-transfer-main"><p>${dispatchEscape(item.serviceNameSnapshot)} · ${dispatchEscape(item.roomCode)} 房</p><small>${dispatchEscape(item.fromTechnicianName)} → ${dispatchEscape(item.toTechnicianName)} · 原因：${dispatchEscape(item.reason)}</small><small>${item.requestedAt ? new Date(item.requestedAt).toLocaleString('zh-CN') : ''}</small></div><div class="room-transfer-actions"><button class="button primary" type="button" data-dispatch-transfer="${roomTransferEscape(item.id)}">审核</button></div></article>`).join('') || '<p class="table-empty">暂无待审核转单</p>';
}

function ensureDispatchTransferDialog() {
  if (document.querySelector('#dispatch-transfer-dialog')) return;
  document.body.insertAdjacentHTML('beforeend', '<dialog id="dispatch-transfer-dialog"><form id="dispatch-transfer-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">待处理事件</p><h2>审核技师转单</h2></div><button class="icon-button" id="close-dispatch-transfer" type="button" aria-label="关闭">×</button></div><div id="dispatch-transfer-summary" class="dispatch-reassignment-summary"></div><label class="form-full">审核说明<textarea name="note" rows="3" maxlength="240" placeholder="驳回时必须填写说明，同意时可选"></textarea></label><div class="dialog-actions"><button class="button secondary" id="cancel-dispatch-transfer" type="button">取消</button><button class="button secondary" id="reject-dispatch-transfer" type="button">驳回</button><button class="button primary" id="approve-dispatch-transfer" type="button">同意转单</button></div></form></dialog>');
  const close = () => document.querySelector('#dispatch-transfer-dialog').close();
  document.querySelector('#close-dispatch-transfer').addEventListener('click', close);
  document.querySelector('#cancel-dispatch-transfer').addEventListener('click', close);
  document.querySelector('#approve-dispatch-transfer').addEventListener('click', () => submitDispatchTransferReview('approve'));
  document.querySelector('#reject-dispatch-transfer').addEventListener('click', () => submitDispatchTransferReview('reject'));
}

function openDispatchTransferReview(requestId) {
  const item = (state.dispatchTransferRequests || []).find(row => String(row.id) === String(requestId));
  if (!item) return;
  ensureDispatchTransferDialog();
  activeDispatchTransferRequestId = requestId;
  document.querySelector('#dispatch-transfer-form').reset();
  document.querySelector('#dispatch-transfer-summary').innerHTML = `<b>${dispatchEscape(item.roomCode)} 房 · ${dispatchEscape(item.serviceNameSnapshot)}</b><small>${dispatchEscape(item.fromTechnicianName)} 申请转给 ${dispatchEscape(item.toTechnicianName)}<br>原因：${dispatchEscape(item.reason)}<br>申请时间：${item.requestedAt ? new Date(item.requestedAt).toLocaleString('zh-CN') : ''}</small>`;
  document.querySelector('#dispatch-transfer-dialog').showModal();
}

async function submitDispatchTransferReview(action) {
  if (!activeDispatchTransferRequestId) return;
  const form = document.querySelector('#dispatch-transfer-form');
  const note = String(new FormData(form).get('note') || '').trim();
  if (action === 'reject' && !note) return toast('驳回转单必须填写说明');
  const buttons = form.querySelectorAll('button'); buttons.forEach(button => { button.disabled = true; });
  try {
    const response = await fetch(`http://localhost:8080/api/v1/service-transfer-requests/${activeDispatchTransferRequestId}/${action}`, { method:'POST', headers:storeContextHeaders(true), body:JSON.stringify({ note }) });
    if (!response.ok) { toast(action === 'approve' ? '同意转单失败，技师状态可能已变化' : '驳回转单失败，请刷新后重试'); return; }
    document.querySelector('#dispatch-transfer-dialog').close();
    activeDispatchTransferRequestId = null;
    await loadFoundationData({ silent:true });
    await loadDispatchTransferRequests({ silent:true });
    toast(action === 'approve' ? '已同意转单，目标技师将收到派单提示' : '已驳回转单申请');
  } finally { buttons.forEach(button => { button.disabled = false; }); }
}

async function openDispatchReassignment(sessionId) {
  ensureDispatchReassignmentDialogs();
  const [participantsResponse, eventsResponse] = await Promise.all([
    fetch(`http://localhost:8080/api/v1/service-sessions/${sessionId}/participants`, { headers:storeContextHeaders() }),
    fetch(`http://localhost:8080/api/v1/service-sessions/${sessionId}/dispatch-events`, { headers:storeContextHeaders() })
  ]);
  if (!participantsResponse.ok || !eventsResponse.ok) { toast('派单明细加载失败，请刷新后重试'); return; }
  const participants = await participantsResponse.json();
  const events = await eventsResponse.json();
  const unresolved = participants.filter(item => item.status === 'REJECTED' || item.status === 'EXPIRED');
  if (!unresolved.length) { toast('该服务已不需要重新派单'); await loadFoundationData({ silent:true }); return; }
  dispatchReassignmentSessionId = sessionId;
  const session = [...(state.reassignmentSessions || []), ...(state.dispatchCancelledSessions || [])].find(item => item.id === sessionId);
  const allowedIds = new Set([...state.technicians.filter(item => item.state === 'available').map(item => String(item.id)), ...unresolved.map(item => String(item.technicianId))]);
  const candidates = state.technicians.filter(item => allowedIds.has(String(item.id)));
  const form = document.querySelector('#dispatch-reassignment-form');
  const dialog = document.querySelector('#dispatch-reassignment-dialog');
  if (!form || !dialog) { toast('重新派单窗口初始化失败，请刷新后重试'); return; }
  form.reset();
  document.querySelector('#dispatch-reassignment-summary').innerHTML = `<b>${dispatchEscape(session?.roomCode)} 房 · ${dispatchEscape(session?.serviceNameSnapshot)}</b><small>${session?.status === 'DISPATCH_CANCELLED' ? '当前处于待与客沟通状态，可在确认继续服务后重新派单。' : '仅替换被拒单或超时的技师位，已接单技师和业绩分配保持不变。'}</small>`;
  document.querySelector('#dispatch-reassignment-slot').innerHTML = unresolved.map(item => `<option value="${roomTransferEscape(item.slotNo)}">${item.technicianCode ? `工号 ${dispatchEscape(item.technicianCode)}` : '未设置工号'} · ${dispatchEscape(item.technicianName)} · ${item.status === 'REJECTED' ? '已拒单' : '接单超时'} · 技师位 ${roomTransferEscape(item.slotNo)}</option>`).join('');
  document.querySelector('#dispatch-reassignment-technician').innerHTML = candidates.map(item => `<option value="${roomTransferEscape(item.id)}">${item.code ? `工号 ${dispatchEscape(item.code)}` : '未设置工号'} · ${dispatchEscape(item.name)} · 轮钟 ${roomTransferEscape(String(item.queue).padStart(2, '0'))}${item.state === 'reassign' ? ' · 可重新安排' : ''}</option>`).join('') || '<option value="">当前没有可安排技师</option>';
  form.querySelector('button[type="submit"]').disabled = candidates.length === 0;
  document.querySelector('#open-dispatch-cancellation').hidden = session?.status === 'DISPATCH_CANCELLED';
  document.querySelector('#dispatch-event-history-list').innerHTML = events.map(item => `<div class="dispatch-event-row"><b>${roomTransferEscape(dispatchEventLabel[item.eventType] || item.eventType)}</b><span>${dispatchEscape(item.reason || item.actorNameSnapshot || '系统记录')}</span><time>${item.occurredAt ? new Date(item.occurredAt).toLocaleString('zh-CN') : ''}</time></div>`).join('') || '<p class="table-empty">暂无派单记录</p>';
  document.querySelector('#dispatch-reassignment-dialog').showModal();
}

function openDispatchCancellation() {
  ensureDispatchReassignmentDialogs();
  if (!dispatchReassignmentSessionId) return;
  const cancelForm = document.querySelector('#dispatch-cancellation-form');
  const reassignmentDialog = document.querySelector('#dispatch-reassignment-dialog');
  const cancellationDialog = document.querySelector('#dispatch-cancellation-dialog');
  if (!cancelForm || !reassignmentDialog || !cancellationDialog) { toast('取消派单窗口初始化失败，请刷新后重试'); return; }
  cancelForm.reset();
  if (reassignmentDialog.open) reassignmentDialog.close();
  cancellationDialog.showModal();
}

async function submitDispatchCancellation(event) {
  event.preventDefault();
  if (!dispatchReassignmentSessionId) return;
  const form = event.currentTarget;
  const reason = String(new FormData(form).get('reason') || '').trim();
  if (!reason) return toast('请填写取消派单原因');
  const buttons = form.querySelectorAll('button');
  buttons.forEach(button => { button.disabled = true; });
  try {
    const response = await fetch(`http://localhost:8080/api/v1/service-sessions/${dispatchReassignmentSessionId}/cancel-dispatch`, { method:'POST', headers:storeContextHeaders(true), body:JSON.stringify({ reason }) });
    if (!response.ok) { toast('取消派单失败，服务状态可能已变化'); return; }
    document.querySelector('#dispatch-cancellation-dialog').close();
    dispatchReassignmentSessionId = null;
    await loadFoundationData({ silent:true });
    toast('已取消派单，服务已转入待与客沟通');
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

async function submitDispatchReassignment(event) {
  event.preventDefault();
  if (!dispatchReassignmentSessionId) return;
  const form = new FormData(event.currentTarget);
  const body = { slotNo:Number(form.get('slotNo')), technicianId:form.get('technicianId'), reason:String(form.get('reason') || '').trim() };
  if (!body.reason) return toast('请填写重新派单说明');
  const response = await fetch(`http://localhost:8080/api/v1/service-sessions/${dispatchReassignmentSessionId}/reassign`, { method:'POST', headers:storeContextHeaders(true), body:JSON.stringify(body) });
  if (!response.ok) { toast('重新派单失败，技师或服务状态可能已变化'); return; }
  document.querySelector('#dispatch-reassignment-dialog').close();
  dispatchReassignmentSessionId = null;
  await loadFoundationData({ silent:true });
  toast('已重新派单，等待技师接单');
}

document.body.insertAdjacentHTML('beforeend', '<dialog id="participant-transfer-dialog"><form id="participant-transfer-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">服务人员调整</p><h2>中途换技师</h2></div><button class="icon-button" type="button" id="close-participant-transfer" aria-label="关闭">×</button></div><p class="participant-transfer-note">原技师的业绩按已服务时间保留，接替技师继续同一份比例与剩余服务。</p><div class="form-grid"><label class="form-full">当前技师<select id="participant-transfer-from" name="fromTechnicianId" required></select></label><label class="form-full">接替技师<select id="participant-transfer-to" name="toTechnicianId" required></select></label><label class="form-full">换人原因<textarea name="reason" maxlength="240" rows="3" required placeholder="例如：身体不适，由其他技师继续服务"></textarea></label></div><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-participant-transfer">取消</button><button class="button primary" type="submit">确认换技师</button></div></form></dialog>');

async function openParticipantTransfer(sessionId) {
  const response = await fetch(`http://localhost:8080/api/v1/service-sessions/${sessionId}/participants`, { headers:storeContextHeaders() });
  if (!response.ok) { toast('参与技师资料加载失败'); return; }
  const participants = await response.json();
  const active = participants.filter(item => item.status === 'IN_SERVICE');
  const activeIds = new Set(active.map(item => String(item.technicianId)));
  const replacements = state.technicians.filter(item => item.state === 'available' && !activeIds.has(String(item.id)));
  if (!active.length) { toast('当前服务没有可更换的在钟技师'); return; }
  if (!replacements.length) { toast('当前没有空闲技师可以接替'); return; }
  participantTransferSessionId = sessionId;
  const form = document.querySelector('#participant-transfer-form');
  form.reset();
  document.querySelector('#participant-transfer-from').innerHTML = active.map(item => `<option value="${roomTransferEscape(item.technicianId)}">${item.technicianCode ? `工号 ${roomTransferEscape(item.technicianCode)}` : '未设置工号'} · ${roomTransferEscape(item.technicianName)} · ${Number(item.allocationBp) / 100}%</option>`).join('');
  document.querySelector('#participant-transfer-to').innerHTML = replacements.map(item => `<option value="${roomTransferEscape(item.id)}">${item.code ? `工号 ${roomTransferEscape(item.code)}` : '未设置工号'} · ${roomTransferEscape(item.name)} · 轮钟 ${roomTransferEscape(String(item.queue).padStart(2,'0'))}</option>`).join('');
  document.querySelector('#participant-transfer-dialog').showModal();
}

function activeSessionForTechnician(technicianId) {
  const sessions = [...state.activeSessions, ...(state.pendingAcceptanceSessions || []), ...(state.acceptedSessions || [])];
  return sessions.find(session => sessionParticipantIds(session).some(id => String(id) === String(technicianId))) || null;
}

function closeTechnicianContextMenu() {
  const menu = document.querySelector('#technician-context-menu');
  if (!menu) return;
  menu.hidden = true;
  delete menu.dataset.technicianId;
  delete menu.dataset.sessionId;
}

function ensureServiceItemChangeDialog() {
  if (document.querySelector('#frontdesk-service-item-change-dialog')) return;
  document.body.insertAdjacentHTML('beforeend', '<dialog id="frontdesk-service-item-change-dialog"><form id="frontdesk-service-item-change-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">服务项目调整</p><h2>更换项目</h2></div><button class="icon-button" type="button" id="close-frontdesk-service-item-change" aria-label="关闭">×</button></div><p class="participant-transfer-note" id="frontdesk-service-item-change-summary"></p><div class="form-grid"><label class="form-full" id="frontdesk-service-item-change-kind-wrap">更换对象<select id="frontdesk-service-item-change-kind" name="changeKind"><option value="MAIN">首钟项目</option><option value="EXTENSION">加钟项目</option></select></label><label class="form-full" id="frontdesk-service-item-change-extension-wrap" hidden>加钟记录<select id="frontdesk-service-item-change-extension" name="extensionId"></select></label><label class="form-full">新项目<select id="frontdesk-service-item-change-target" name="serviceItemId" required></select></label><label class="form-full">变更原因<textarea name="reason" maxlength="240" rows="3" required placeholder="例如：客户临时更换服务项目"></textarea></label></div><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-frontdesk-service-item-change">取消</button><button class="button primary" type="submit">确认更换</button></div></form></dialog>');
  document.querySelector('#close-frontdesk-service-item-change').addEventListener('click', () => document.querySelector('#frontdesk-service-item-change-dialog').close());
  document.querySelector('#cancel-frontdesk-service-item-change').addEventListener('click', () => document.querySelector('#frontdesk-service-item-change-dialog').close());
  document.querySelector('#frontdesk-service-item-change-kind').addEventListener('change', () => renderServiceItemChangeOptions());
  document.querySelector('#frontdesk-service-item-change-extension').addEventListener('change', () => renderServiceItemChangeOptions());
  document.querySelector('#frontdesk-service-item-change-form').addEventListener('submit', submitServiceItemChange);
}

function ensureFrontdeskExtensionDialog() {
  if (document.querySelector('#frontdesk-extension-dialog')) return;
  document.body.insertAdjacentHTML('beforeend', '<dialog id="frontdesk-extension-dialog"><form id="frontdesk-extension-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">服务中加钟</p><h2>客人加钟</h2></div><button class="icon-button" type="button" id="close-frontdesk-extension" aria-label="关闭">×</button></div><p class="participant-transfer-note" id="frontdesk-extension-summary"></p><div class="form-grid"><label class="form-full">加钟项目<select id="frontdesk-extension-service" name="serviceItemId" required></select></label></div><div class="frontdesk-extension-preview" id="frontdesk-extension-preview"></div><p class="participant-transfer-note">技师也可在手机端自主提交，无需前台确认；提交后会自动同步到当前服务和最终结算。</p><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-frontdesk-extension">取消</button><button class="button primary" type="submit">确认加钟</button></div></form></dialog>');
  document.querySelector('#close-frontdesk-extension').addEventListener('click', () => document.querySelector('#frontdesk-extension-dialog').close());
  document.querySelector('#cancel-frontdesk-extension').addEventListener('click', () => document.querySelector('#frontdesk-extension-dialog').close());
  document.querySelector('#frontdesk-extension-service').addEventListener('change', renderFrontdeskExtensionPreview);
  document.querySelector('#frontdesk-extension-form').addEventListener('submit', submitFrontdeskExtension);
}

function ensureFrontdeskExtensionCancelDialog() {
  if (document.querySelector('#frontdesk-extension-cancel-dialog')) return;
  document.body.insertAdjacentHTML('beforeend', '<dialog id="frontdesk-extension-cancel-dialog"><form id="frontdesk-extension-cancel-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">服务中退钟</p><h2>取消加钟</h2></div><button class="icon-button" type="button" id="close-frontdesk-extension-cancel" aria-label="关闭">×</button></div><p class="participant-transfer-note" id="frontdesk-extension-cancel-summary"></p><div class="form-grid"><label class="form-full">退钟项目<select id="frontdesk-extension-cancel-target" name="extensionId" required></select></label><label class="form-full">退钟原因<textarea name="reason" maxlength="240" rows="3" required placeholder="例如：客户临时取消加钟"></textarea></label></div><p class="participant-transfer-note">仅能取消未结算服务中的加钟项目；取消后会恢复剩余服务时长，并保留退钟审计记录。</p><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-extension-cancel">取消</button><button class="button primary" type="submit">确认退钟</button></div></form></dialog>');
  document.querySelector('#close-frontdesk-extension-cancel').addEventListener('click', () => document.querySelector('#frontdesk-extension-cancel-dialog').close());
  document.querySelector('#cancel-extension-cancel').addEventListener('click', () => document.querySelector('#frontdesk-extension-cancel-dialog').close());
  document.querySelector('#frontdesk-extension-cancel-form').addEventListener('submit', submitFrontdeskExtensionCancel);
}

async function openFrontdeskExtensionCancel(sessionId) {
  ensureFrontdeskExtensionCancelDialog();
  const session = state.activeSessions.find(item => String(item.id) === String(sessionId));
  if (!session) return toast('未找到进行中的服务记录，请刷新后重试');
  const response = await fetch(`http://localhost:8080/api/v1/service-sessions/${sessionId}/extensions`, { headers:storeContextHeaders() });
  if (!response.ok) return toast('加钟记录加载失败，请刷新后重试');
  const extensions = await response.json();
  if (!extensions.length) return toast('当前服务没有可退的加钟项目');
  frontdeskExtensionCancelSessionId = sessionId;
  document.querySelector('#frontdesk-extension-cancel-form').reset();
  document.querySelector('#frontdesk-extension-cancel-summary').textContent = `${sessionDisplayTechnicianName(session)} · ${session.roomCode} 房 · 当前总时长 ${session.plannedDurationMinutes} 分钟`;
  document.querySelector('#frontdesk-extension-cancel-target').innerHTML = extensions.map(item => `<option value="${roomTransferEscape(item.id)}">${roomTransferEscape(item.serviceNameSnapshot)} · ${roomTransferEscape(item.plannedDurationMinutes)} 分钟 · ¥${(Number(item.servicePriceCents || 0) / 100).toFixed(2)}</option>`).join('');
  document.querySelector('#frontdesk-extension-cancel-dialog').showModal();
}

async function submitFrontdeskExtensionCancel(event) {
  event.preventDefault();
  if (!frontdeskExtensionCancelSessionId) return;
  const form = new FormData(event.currentTarget);
  const reason = String(form.get('reason') || '').trim();
  const extensionId = String(form.get('extensionId') || '');
  if (!reason || !extensionId) return toast('请选择退钟项目并填写原因');
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const response = await fetch(`http://localhost:8080/api/v1/service-sessions/${frontdeskExtensionCancelSessionId}/extensions/${extensionId}/cancel`, { method:'POST', headers:storeContextHeaders(true), body:JSON.stringify({ reason }) });
    if (!response.ok) { const detail=(await response.text()).replace(/^"|"$/g,''); toast(`退钟失败：${detail || '服务状态已变化'}`); return; }
    const result = await response.json();
    document.querySelector('#frontdesk-extension-cancel-dialog').close();
    frontdeskExtensionCancelSessionId = null;
    extensionSyncInitialized = false;
    extensionSyncSnapshot = new Map();
    await loadFoundationData({ silent:true });
    toast(`${result.serviceName} 已退钟，服务剩余 ${result.remainingDurationMinutes} 分钟`);
  } finally { submit.disabled = false; }
}

function renderFrontdeskExtensionPreview() {
  const service = state.services.find(item => String(item.id) === String(document.querySelector('#frontdesk-extension-service')?.value));
  const target = document.querySelector('#frontdesk-extension-preview');
  if (!target) return;
  target.innerHTML = service ? `<span><b>${roomTransferEscape(service.name)}</b><small>增加 ${roomTransferEscape(service.duration)}</small></span><strong>+¥${Number(service.price || 0).toFixed(2)}</strong>` : '';
}

async function openFrontdeskExtension(sessionId, technicianId) {
  ensureFrontdeskExtensionDialog();
  const session = state.activeSessions.find(item => String(item.id) === String(sessionId));
  const technician = state.technicians.find(item => String(item.id) === String(technicianId));
  if (!session) return toast('未找到进行中的服务记录，请刷新后重试');
  const policyResponse = await fetch('http://localhost:8080/api/v1/service-duration-policy', { headers:storeContextHeaders() });
  if (!policyResponse.ok) return toast('加钟规则加载失败，请刷新后重试');
  const policy = await policyResponse.json();
  const remainingExtensionMinutes = Math.max(0,
    Number(policy.serviceDurationMaxMinutes || 0) - Number(session.plannedDurationMinutes || 0));
  const services = state.services.filter(item => item.allowsExtension && Number(item.durationMinutes || 0) <= remainingExtensionMinutes);
  if (remainingExtensionMinutes <= 0) return toast('本次服务已达到门店总时长上限');
  if (!services.length) return toast('门店当前没有符合总时长上限的加钟项目');
  frontdeskExtensionSessionId = session.id;
  frontdeskExtensionTechnicianId = technicianId;
  document.querySelector('#frontdesk-extension-form').reset();
  document.querySelector('#frontdesk-extension-summary').textContent = `${technician?.name || sessionDisplayTechnicianName(session)} · ${session.roomCode} 房 · 当前总时长 ${Number(session.plannedDurationMinutes || 0)} 分钟 · 门店总时长剩余 ${remainingExtensionMinutes} 分钟。`;
  document.querySelector('#frontdesk-extension-service').innerHTML = groupedServiceSelectOptions(services);
  renderFrontdeskExtensionPreview();
  document.querySelector('#frontdesk-extension-dialog').showModal();
}

async function submitFrontdeskExtension(event) {
  event.preventDefault();
  if (!frontdeskExtensionSessionId || !frontdeskExtensionTechnicianId) return;
  const form = new FormData(event.currentTarget);
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const response = await fetch(`http://localhost:8080/api/v1/service-sessions/${frontdeskExtensionSessionId}/extensions`, { method:'POST', headers:storeContextHeaders(true), body:JSON.stringify({ technicianId:frontdeskExtensionTechnicianId, serviceItemId:form.get('serviceItemId') }) });
    if (!response.ok) {
      const message = response.status === 400
        ? '所选项目不可用或总服务时长超限'
        : response.status === 409
          ? '服务状态已变化，请刷新后重试'
          : '加钟提交失败，请检查网络后重试';
      toast(message);
      return;
    }
    const extension = await response.json();
    document.querySelector('#frontdesk-extension-dialog').close();
    frontdeskExtensionSessionId = null;
    frontdeskExtensionTechnicianId = null;
    extensionSyncInitialized = false;
    extensionSyncSnapshot = new Map();
    await loadFoundationData({ silent:true });
    toast(`${extension.serviceName} 已加钟，新的结束时间已同步`);
  } finally { submit.disabled = false; }
}

function renderServiceItemChangeOptions() {
  const session = state.activeSessions.find(item => String(item.id) === String(serviceItemChangeSessionId));
  if (!session) return;
  const kind = document.querySelector('#frontdesk-service-item-change-kind');
  const extensionWrap = document.querySelector('#frontdesk-service-item-change-extension-wrap');
  const extensionSelect = document.querySelector('#frontdesk-service-item-change-extension');
  const kindWrap = document.querySelector('#frontdesk-service-item-change-kind-wrap');
  const target = document.querySelector('#frontdesk-service-item-change-target');
  if (!target) return;
  const hasExtensions = serviceItemChangeExtensions.length > 0;
  const selectedKind = hasExtensions
    ? (['MAIN', 'EXTENSION'].includes(kind?.value) ? kind.value : '')
    : 'MAIN';
  if (kind && kind.value !== selectedKind) kind.value = selectedKind;
  if (kindWrap) {
    kindWrap.hidden = !hasExtensions;
    kindWrap.style.display = hasExtensions ? '' : 'none';
  }
  if (!selectedKind) {
    extensionWrap.hidden = true;
    extensionWrap.style.display = 'none';
    target.innerHTML = '<option value="">请先选择更换对象</option>';
    target.disabled = true;
  } else if (selectedKind === 'EXTENSION') {
    extensionWrap.hidden = false;
    extensionWrap.style.display = '';
    const selectedExtension = serviceItemChangeExtensions.find(item => String(item.id) === String(extensionSelect.value)) || serviceItemChangeExtensions[0];
    if (!selectedExtension) {
      target.innerHTML = '<option value="">暂无可更换的加钟项目</option>';
      target.disabled = true;
      return;
    }
    extensionSelect.value = selectedExtension.id;
    const choices = state.services.filter(item => item.allowsExtension !== false && String(item.id) !== String(selectedExtension.serviceItemId));
    target.innerHTML = groupedServiceSelectOptions(choices);
    target.disabled = choices.length === 0;
  } else {
    extensionWrap.hidden = true;
    extensionWrap.style.display = 'none';
    const choices = state.services.filter(item => String(item.id) !== String(session.serviceItemId));
    target.innerHTML = groupedServiceSelectOptions(choices);
    target.disabled = choices.length === 0;
  }
}

async function openServiceItemChange(sessionId) {
  ensureServiceItemChangeDialog();
  const session = state.activeSessions.find(item => String(item.id) === String(sessionId));
  if (!session) return toast('未找到进行中的服务记录，请刷新后重试');
  const choices = state.services.filter(item => String(item.id) !== String(session.serviceItemId));
  if (!choices.length) return toast('当前没有可更换的项目');
  serviceItemChangeSessionId = session.id;
  serviceItemChangeExtensions = [];
  const form = document.querySelector('#frontdesk-service-item-change-form');
  form.reset();
  document.querySelector('#frontdesk-service-item-change-summary').textContent = `${sessionDisplayTechnicianName(session) || '技师'} · ${session.roomCode || ''} 房 · 首钟：${session.serviceNameSnapshot}。可单独更换已添加的加钟项目。`;
  const extensionResponse = await fetch(`http://localhost:8080/api/v1/service-sessions/${session.id}/extensions`, { headers:storeContextHeaders() });
  if (extensionResponse.ok) serviceItemChangeExtensions = await extensionResponse.json();
  const kindWrap = document.querySelector('#frontdesk-service-item-change-kind-wrap');
  const kind = document.querySelector('#frontdesk-service-item-change-kind');
  const extensionSelect = document.querySelector('#frontdesk-service-item-change-extension');
  const hasExtensions = serviceItemChangeExtensions.length > 0;
  kindWrap.hidden = !hasExtensions;
  kindWrap.style.display = hasExtensions ? '' : 'none';
  kind.innerHTML = hasExtensions
    ? '<option value="">请选择更换对象</option><option value="MAIN">首钟项目</option><option value="EXTENSION">加钟项目</option>'
    : '<option value="MAIN">首钟项目</option>';
  extensionSelect.innerHTML = serviceItemChangeExtensions.map(item => `<option value="${roomTransferEscape(item.id)}">${roomTransferEscape(item.serviceNameSnapshot)} · ${roomTransferEscape(item.plannedDurationMinutes)} 分钟 · ¥${(Number(item.servicePriceCents || 0) / 100).toFixed(2)}</option>`).join('');
  extensionSelect.disabled = serviceItemChangeExtensions.length === 0;
  document.querySelector('#frontdesk-service-item-change-extension-wrap').style.display = 'none';
  kind.value = hasExtensions ? '' : 'MAIN';
  renderServiceItemChangeOptions();
  document.querySelector('#frontdesk-service-item-change-dialog').showModal();
}

async function submitServiceItemChange(event) {
  event.preventDefault();
  if (!serviceItemChangeSessionId) return;
  const form = new FormData(event.currentTarget);
  const reason = String(form.get('reason') || '').trim();
  if (!reason) return toast('请填写项目变更原因');
  const changeKind = String(form.get('changeKind') || '');
  if (!['MAIN','EXTENSION'].includes(changeKind)) return toast('请选择要更换的项目类型');
  const extensionId = String(form.get('extensionId') || '');
  if (changeKind === 'EXTENSION' && !extensionId) return toast('请选择要更换的加钟记录');
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const endpoint = changeKind === 'EXTENSION'
      ? `http://localhost:8080/api/v1/service-sessions/${serviceItemChangeSessionId}/extensions/${extensionId}/service-item`
      : `http://localhost:8080/api/v1/service-sessions/${serviceItemChangeSessionId}/service-item`;
    const response = await fetch(endpoint, { method:'PUT', headers:storeContextHeaders(true), body:JSON.stringify({ serviceItemId:form.get('serviceItemId'), reason }) });
    if (!response.ok) { const detail = (await response.text()).replace(/^"|"$/g, ''); toast(`更换项目失败：${detail || '服务状态已变化'}`); return; }
    document.querySelector('#frontdesk-service-item-change-dialog').close();
    serviceItemChangeSessionId = null;
    serviceItemChangeExtensions = [];
    await loadFoundationData({ silent:true });
    toast(changeKind === 'EXTENSION' ? '加钟项目已更换，服务时长已同步' : '首钟项目已更换，原有加钟记录已保留');
  } finally { submit.disabled = false; }
}

function ensureClockTypeChangeDialog() {
  if (document.querySelector('#frontdesk-clock-type-change-dialog')) return;
  document.body.insertAdjacentHTML('beforeend', '<dialog id="frontdesk-clock-type-change-dialog"><form id="frontdesk-clock-type-change-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">服务类型调整</p><h2>更换钟类</h2></div><button class="icon-button" type="button" id="close-frontdesk-clock-type-change" aria-label="关闭">×</button></div><p class="participant-transfer-note" id="frontdesk-clock-type-change-summary"></p><div class="form-grid"><label class="form-full">修改为<select name="clockType" required><option value="QUEUE">排钟</option><option value="CALL">点钟</option></select></label><label class="form-full">修改原因<textarea name="reason" maxlength="240" rows="3" required placeholder="例如：客人实际为点钟，前台安排时误选排钟"></textarea></label></div><p class="participant-transfer-note">只修改本次服务的钟类，不会改变项目、技师、房间、时长、金额或收款方式。</p><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-frontdesk-clock-type-change">取消</button><button class="button primary" type="submit">确认修改</button></div></form></dialog>');
  const close = () => { clockTypeChangeSessionId = null; document.querySelector('#frontdesk-clock-type-change-dialog').close(); };
  document.querySelector('#close-frontdesk-clock-type-change').addEventListener('click', close);
  document.querySelector('#cancel-frontdesk-clock-type-change').addEventListener('click', close);
  document.querySelector('#frontdesk-clock-type-change-form').addEventListener('submit', submitClockTypeChange);
}

function findOperationalSession(sessionId) {
  return [...state.activeSessions, ...(state.pendingAcceptanceSessions || []), ...(state.acceptedSessions || [])]
    .find(item => String(item.id) === String(sessionId));
}

function openClockTypeChange(sessionId) {
  ensureClockTypeChangeDialog();
  const session = findOperationalSession(sessionId);
  if (!session) return toast('未找到进行中的服务记录，请刷新后重试');
  if (!['IN_SERVICE', 'PENDING_ACCEPTANCE', 'ACCEPTED'].includes(session.status)) return toast('当前服务状态不允许更换钟类');
  clockTypeChangeSessionId = session.id;
  const form = document.querySelector('#frontdesk-clock-type-change-form');
  form.reset();
  form.clockType.value = session.clockType === 'CALL' || session.clockType === 'BOOKED_CALL' ? 'CALL' : 'QUEUE';
  document.querySelector('#frontdesk-clock-type-change-summary').textContent = `${sessionDisplayTechnicianName(session) || '技师'} · ${session.roomCode || ''} 房 · ${session.serviceNameSnapshot} · 当前${clockTypeLabels[session.clockType] || session.clockType || '排钟'}`;
  document.querySelector('#frontdesk-clock-type-change-dialog').showModal();
}

async function submitClockTypeChange(event) {
  event.preventDefault();
  if (!clockTypeChangeSessionId) return;
  const form = new FormData(event.currentTarget);
  const reason = String(form.get('reason') || '').trim();
  if (!reason) return toast('请填写更换钟类原因');
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const response = await fetch(`http://localhost:8080/api/v1/service-sessions/${clockTypeChangeSessionId}/clock-type`, {
      method: 'PUT', headers: storeContextHeaders(true), body: JSON.stringify({ clockType: form.get('clockType'), reason })
    });
    if (!response.ok) {
      const detail = (await response.text()).replace(/^"|"$/g, '').trim();
      return toast(`更换钟类失败：${detail || '服务状态已变化，请刷新后重试'}`);
    }
    document.querySelector('#frontdesk-clock-type-change-dialog').close();
    clockTypeChangeSessionId = null;
    await loadFoundationData({ silent: true });
    toast('服务钟类已更新');
  } finally { submit.disabled = false; }
}

function clockOutElapsedText(startedAt) {
  if (!startedAt) return '时间未记录';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
}

function openClockOutConfirmation(session, technician) {
  if (!session || !technician) return toast('未找到进行中的服务记录，请刷新后重试');
  clockOutConfirmation = { session, technician };
  document.querySelector('#clock-out-confirm-message').textContent = `确认给技师 ${technician.name}（工号 ${technician.code || '未设置'}）下钟吗？`;
  document.querySelector('#clock-out-confirm-details').innerHTML = `<span>房间号<b>${roomTransferEscape(session.roomCode || '—')}</b></span><span>服务项目<b>${roomTransferEscape(session.serviceNameSnapshot || '—')}</b></span><span>已服务时长<b>${clockOutElapsedText(session.startedAt)}</b></span>`;
  document.querySelector('#clock-out-confirm-dialog').showModal();
}

async function submitClockOutConfirmation(event) {
  event.preventDefault();
  if (!clockOutConfirmation) return;
  const { session, technician } = clockOutConfirmation;
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const response = await fetch(`http://localhost:8080/api/v1/service-sessions/${session.id}/clock-out`, { method:'POST', headers:storeContextHeaders() });
    if (!response.ok) return toast('下钟失败，请刷新后重试');
    document.querySelector('#clock-out-confirm-dialog').close();
    clockOutConfirmation = null;
    await loadFoundationData({ silent:true });
    toast(`${technician.name} 已下钟，房间等待付款`);
  } catch {
    toast('下钟失败，请检查服务连接后重试');
  } finally {
    submit.disabled = false;
  }
}

function ensureTechnicianContextTools() {
  ensureServiceItemChangeDialog();
  ensureClockTypeChangeDialog();
  ensureFrontdeskExtensionDialog();
  ensureFrontdeskExtensionCancelDialog();
  if (!document.querySelector('#technician-context-menu')) {
     document.body.insertAdjacentHTML('beforeend', '<div class="technician-context-menu" id="technician-context-menu" role="menu" hidden><div class="technician-context-summary"><b>技师状态</b><small>正在读取当前服务</small></div><button type="button" role="menuitem" data-tech-context-action="start-service">开始服务</button><button type="button" role="menuitem" data-tech-context-action="clock-out">下钟</button><button type="button" role="menuitem" data-tech-context-action="change-clock-type">更换钟类</button><button type="button" role="menuitem" data-tech-context-action="transfer-technician">更换技师</button><button type="button" role="menuitem" data-tech-context-action="change-service" disabled title="将在项目变更模块完成后启用">更换项目</button><button type="button" role="menuitem" data-tech-context-action="extend-service" disabled title="将在前台加钟模块完成后启用">客人加钟</button><button type="button" role="menuitem" data-tech-context-action="reduce-service" disabled title="将在退钟审计模块完成后启用">客人退钟</button><button type="button" role="menuitem" data-tech-context-action="adjust-duration" hidden>调整服务时长</button><button type="button" role="menuitem" data-tech-context-action="transfer-room">更换房间</button></div><dialog id="technician-room-transfer-dialog"><form id="technician-room-transfer-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">服务房间调整</p><h2>更换房间</h2></div><button class="icon-button" type="button" id="close-technician-room-transfer" aria-label="关闭">×</button></div><p class="participant-transfer-note" id="technician-room-transfer-summary"></p><div class="form-grid"><label class="form-full">目标房间<select id="technician-room-transfer-target" name="toRoomId" required></select></label><label class="form-full">换房原因<textarea name="reason" maxlength="240" rows="3" required placeholder="例如：客户加项，需要调整至更合适的房间"></textarea></label></div><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-technician-room-transfer">取消</button><button class="button primary" type="submit">确认换房</button></div></form></dialog>');
     document.querySelector('#close-technician-room-transfer').addEventListener('click', () => document.querySelector('#technician-room-transfer-dialog').close());
     document.querySelector('#cancel-technician-room-transfer').addEventListener('click', () => document.querySelector('#technician-room-transfer-dialog').close());
     document.querySelector('#technician-room-transfer-form').addEventListener('submit', submitTechnicianRoomTransfer);
    document.querySelector('#technician-context-menu').addEventListener('click', async event => {
      const button = event.target.closest('[data-tech-context-action]');
      if (!button) return;
      if (button.disabled) { toast(button.title || '该操作尚未启用'); return; }
      const sessionId = event.currentTarget.dataset.sessionId;
      const technicianId = event.currentTarget.dataset.technicianId;
      closeTechnicianContextMenu();
       if (!sessionId) return toast('该技师当前没有进行中的服务');
      if (button.dataset.techContextAction === 'start-service') return startServiceFromFrontdesk(sessionId);
      if (button.dataset.techContextAction === 'change-clock-type') return openClockTypeChange(sessionId);
      if (button.dataset.techContextAction === 'clock-out') {
        const session = state.activeSessions.find(item => String(item.id) === String(sessionId));
        const technician = state.technicians.find(item => String(item.id) === String(technicianId));
        return openClockOutConfirmation(session, technician);
      }
      if (button.dataset.techContextAction === 'transfer-technician') return openParticipantTransfer(sessionId);
      if (button.dataset.techContextAction === 'change-service') return openServiceItemChange(sessionId);
       if (button.dataset.techContextAction === 'extend-service') return openFrontdeskExtension(sessionId, technicianId).catch(() => toast('加钟规则加载失败，请检查网络后重试'));
       if (button.dataset.techContextAction === 'reduce-service') return openFrontdeskExtensionCancel(sessionId);
       if (button.dataset.techContextAction === 'adjust-duration') return overrideServiceDuration(sessionId);
       if (button.dataset.techContextAction === 'transfer-room') return openTechnicianRoomTransfer(sessionId);
    });
    document.addEventListener('pointerdown', event => { if (!event.target.closest('#technician-context-menu')) closeTechnicianContextMenu(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeTechnicianContextMenu(); });
    window.addEventListener('resize', closeTechnicianContextMenu);
    window.addEventListener('scroll', closeTechnicianContextMenu, true);
  }
}

function openTechnicianContextMenu(event, technician) {
  ensureTechnicianContextTools();
  event.preventDefault();
  const menu = document.querySelector('#technician-context-menu');
  const session = activeSessionForTechnician(technician.id);
  const enabled = Boolean(session && ['serving', 'accepted', 'pending'].includes(technician.state));
  const stateLabel = technician.state === 'serving' ? '服务中' : technician.state === 'pending' ? '待接单' : technician.state === 'accepted' ? '待开始服务' : technician.state === 'reassign' ? '待重新派单' : technician.state === 'available' ? '可派钟' : '休息 / 下班';
  const summary = menu.querySelector('.technician-context-summary');
  summary.querySelector('b').textContent = `${technician.code || ''} ${technician.name}`.trim();
  summary.querySelector('small').textContent = `${stateLabel} · ${technician.detail || '暂无服务信息'}`;
  menu.dataset.technicianId = technician.id;
  if (session) menu.dataset.sessionId = session.id;
  else delete menu.dataset.sessionId;
   menu.querySelectorAll('[data-tech-context-action]').forEach(button => {
     const preStartAllowed = ['adjust-duration', 'transfer-room', 'change-clock-type'].includes(button.dataset.techContextAction);
     const buttonEnabled = button.dataset.techContextAction === 'start-service'
       ? ['accepted', 'pending'].includes(technician.state)
       : technician.state === 'serving' || (preStartAllowed && ['accepted', 'pending'].includes(technician.state));
     button.disabled = !buttonEnabled;
     button.title = buttonEnabled ? '' : '仅待接单、待开始或服务中技师可操作';
   });
   const durationButton = menu.querySelector('[data-tech-context-action="adjust-duration"]');
   if (durationButton) {
     const allowed = hasAdminPermission('SERVICE_DURATION_OVERRIDE');
     durationButton.hidden = !allowed;
     durationButton.disabled = !enabled || !allowed;
     durationButton.title = allowed ? (enabled ? '' : '仅待开始或服务中的技师可操作') : '当前账号没有调整服务时长权限';
   }
  menu.hidden = false;
  const margin = 10;
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - width - margin)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - height - margin)}px`;
}

function openTechnicianRoomTransfer(sessionId) {
  ensureTechnicianContextTools();
  const session = [...state.activeSessions, ...(state.pendingAcceptanceSessions || []), ...(state.acceptedSessions || [])]
    .find(item => String(item.id) === String(sessionId));
  if (!session) return toast('未找到进行中的服务记录，请刷新后重试');
  const rooms = state.rooms.filter(room => room.status === 'idle' && String(room.apiId) !== String(session.roomId));
  if (!rooms.length) return toast('当前没有空闲房间可供换房');
  technicianContextSessionId = session.id;
   const form = document.querySelector('#technician-room-transfer-form');
  form.reset();
   document.querySelector('#technician-room-transfer-summary').textContent = `${sessionDisplayTechnicianName(session)} · ${session.serviceNameSnapshot} · 当前 ${session.roomCode} 房`;
   document.querySelector('#technician-room-transfer-target').innerHTML = rooms.map(room => `<option value="${roomTransferEscape(room.apiId)}">${roomTransferEscape(room.id)} 房</option>`).join('');
  document.querySelector('#technician-room-transfer-dialog').showModal();
}

async function startServiceFromFrontdesk(sessionId) {
  const session = [...(state.pendingAcceptanceSessions || []), ...(state.acceptedSessions || [])]
    .find(item => String(item.id) === String(sessionId));
  if (!session) return toast('只有待接单或已接单、待开始的服务可由前台开始');
  if (!window.confirm(`确认由前台为 ${sessionDisplayTechnicianName(session)} 开始 ${session.roomCode} 房服务？`)) return;
  try {
    const response = await fetch(`http://localhost:8080/api/v1/service-sessions/${sessionId}/start-service`, {
      method:'POST', headers:storeContextHeaders()
    });
    if (!response.ok) {
      // Surface the server's actionable conflict (room/technician/queue state)
      // instead of hiding it behind a generic message.  This also makes a
      // failed start safe to retry after refreshing the current dispatch list.
      const detail = (await response.text()).replace(/^"|"$/g, '').trim();
      return toast(`开始服务失败：${detail || '服务状态可能已变化，请刷新后重试'}`);
    }
    await loadFoundationData({ silent:true });
    toast('服务已由前台开始计时，技师端将同步显示');
  } catch {
    toast('开始服务失败：服务器暂时不可用，请刷新后重试');
  }
}

async function submitTechnicianRoomTransfer(event) {
  event.preventDefault();
  if (!technicianContextSessionId) return;
  const form = new FormData(event.currentTarget);
  const reason = String(form.get('reason') || '').trim();
  if (!reason) return toast('请填写换房原因');
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const requested = await fetch('http://localhost:8080/api/v1/service-room-transfers', { method:'POST', headers:storeContextHeaders(true), body:JSON.stringify({ serviceSessionId:technicianContextSessionId, toRoomId:form.get('toRoomId'), reason }) });
    if (!requested.ok) { const detail = await requested.text(); toast(`换房失败：${detail.replace(/^"|"$/g, '') || '服务或房间状态已变化'}`); return; }
    const transfer = await requested.json();
    const approved = await fetch(`http://localhost:8080/api/v1/service-room-transfers/${transfer.id}/approve`, { method:'POST', headers:storeContextHeaders() });
    if (!approved.ok) { toast('换房申请已创建，请稍后刷新房间状态'); return; }
     document.querySelector('#technician-room-transfer-dialog').close();
    technicianContextSessionId = null;
    await Promise.all([loadFoundationData({ silent:true }), loadRoomTransferRequests({ silent:true })]);
    toast('换房已确认，原房间已进入清洁中');
  } finally {
    submit.disabled = false;
  }
}

function renderTechnicians() {
  const stateOrder = { available:0, pending:1, accepted:2, serving:3, reassign:4, off:5 };
  const sorted = [...state.technicians].sort((a, b) => (stateOrder[a.state] ?? 9) - (stateOrder[b.state] ?? 9) || a.queue - b.queue || String(a.code||'').localeCompare(String(b.code||'')));
  document.querySelector('#technician-list').innerHTML = sorted.map(tech => {
    const unavailable = !['available', 'serving', 'pending', 'accepted'].includes(tech.state);
    const label = tech.state === 'available' ? '可派钟' : tech.state === 'serving' ? '服务中' : tech.state === 'pending' ? '待接单' : tech.state === 'accepted' ? '待服务' : tech.state === 'reassign' ? '待重新派单' : '休息 / 下班';
    const action = tech.state === 'available' ? '上钟' : tech.state === 'serving' ? '下钟' : ['pending', 'accepted'].includes(tech.state) ? '开始服务' : tech.state === 'reassign' ? '待重派' : '不可上钟';
    const room = /([^\s·]+)\s*房/.exec(tech.detail||'')?.[1] || '';
    const next = tech.nextReservation ? `<small class="tech-next-service">下一单：${roomTransferEscape(clockTypeLabels[tech.nextReservation.reservationType] || tech.nextReservation.reservationType)} · ${roomTransferEscape(tech.nextReservation.roomCode)}房</small>` : '';
    return `<article class="technician tech-card state-${roomTransferEscape(tech.state)} ${unavailable ? 'unavailable' : ''}" data-tech-card="${roomTransferEscape(tech.id)}"><div class="tech-card-main"><span class="tech-avatar">${roomTransferEscape(tech.initials)}</span><span class="technician-name"><b>${tech.code ? `工号 ${roomTransferEscape(tech.code)}` : '未设置工号'}</b><span class="technician-full-name">${roomTransferEscape(tech.name)}</span><small>${room ? `房间 ${roomTransferEscape(room)}` : roomTransferEscape(tech.detail)}</small></span><span class="tech-state ${roomTransferEscape(tech.state)}">${label}</span></div><div class="tech-card-meta"><span>排钟 <b>${roomTransferEscape(tech.queueCount)}</b> · 点钟 <b>${roomTransferEscape(tech.callCount)}</b> · 加钟 <b>${roomTransferEscape(tech.extensionCount)}</b></span><span>轮排 ${roomTransferEscape(String(tech.queue).padStart(2, '0'))}</span></div>${next}<button class="tech-action" data-tech="${roomTransferEscape(tech.id)}"${unavailable ? ' disabled title="当前不可上钟"' : ''}>${action}</button></article>`;
  }).join('');
  document.querySelector('#clocked-in-tech-count').textContent = state.technicians.filter(tech => tech.clockedIn).length;
  document.querySelector('#total-tech-count').textContent = state.technicians.length;
  document.querySelector('#on-duty-count').textContent = state.technicians.filter(tech => tech.state !== 'off').length;
  document.querySelector('#available-tech-count').textContent = state.technicians.filter(tech => tech.state === 'available').length;
  document.querySelector('#serving-tech-count').textContent = state.technicians.filter(tech => tech.state === 'serving').length;
}

async function loadManagedTechnicians() {
  const response = await fetch(`http://localhost:8080/api/v1/foundation/technicians?includeInactive=${includeInactiveTechnicians}&includeQueueDisabled=true`, { headers: storeContextHeaders() });
  if (!response.ok) throw new Error(response.status);
  managedTechnicians = await response.json();
  renderManagedTechnicians();
}

function renderManagedTechnicians() {
  const keyword = document.querySelector('#technician-search').value.trim();
  const rows = managedTechnicians.filter(tech => !keyword || `${tech.code} ${tech.name} ${tech.phone || ''}`.includes(keyword));
  document.querySelector('#technician-total').textContent = `${rows.length} 位技师`;
  document.querySelector('#technician-records').innerHTML = rows.map(tech => {
    const queueState = tech.queueEnabled === false ? '未启用' : '已启用';
    const queueClass = tech.queueEnabled === false ? 'consumption' : 'order';
    const queueAction = tech.queueEnabled === false ? '启用队列' : '停用队列';
    return `<tr><td>${roomTransferEscape(tech.queueOrder)}</td><td>${roomTransferEscape(tech.code)}</td><td><b>${roomTransferEscape(tech.name)}</b></td><td class="muted-cell">${roomTransferEscape(tech.phone || '—')}</td><td><span class="record-type ${tech.active ? 'order' : 'consumption'}">${tech.active ? '在职' : '已离职'}</span></td><td><span class="record-type ${queueClass}">${tech.active ? queueState : '—'}</span></td><td class="align-right">${tech.active ? `<button class="record-delete edit-technician" data-edit="${roomTransferEscape(tech.id)}">编辑</button><button class="record-delete" data-queue-toggle="${roomTransferEscape(tech.id)}" data-enabled="${tech.queueEnabled !== false}">${queueAction}</button><button class="record-delete" data-toggle="${roomTransferEscape(tech.id)}" data-active="true">删除</button>` : '<span class="muted-cell">—</span>'}</td></tr>`;
  }).join('') || '<tr><td colspan="7" class="table-empty">没有匹配的技师</td></tr>';
}

let managedEmployees = [];
let includeInactiveEmployees = false;
let editingEmployee = null;
let employeeManagementTab = 'employees';
const employeePositionLabel = { STORE_MANAGER:'店长', CASHIER:'前台', TECHNICIAN:'技师', CLEANER:'保洁', CHEF:'厨师', FINANCE:'财务', OTHER:'其他' };
const employeeStatusLabel = { ACTIVE:'在职', INACTIVE:'停用', LEFT:'已离职' };
let employeeAttendance = [];
const attendanceStatusLabel = { NOT_SCHEDULED:'未排班', NOT_STARTED:'待上班', PRESENT:'正常出勤', LATE:'迟到', COMPLETED:'已下班', LEFT_EARLY:'早退', ABSENT:'旷工', REST:'休息', LEAVE:'请假' };

async function loadManagedEmployees() {
  const response = await fetch(`http://localhost:8080/api/v1/employees?includeInactive=${includeInactiveEmployees}`, { headers: storeContextHeaders() });
  if (!response.ok) throw new Error(response.status);
  managedEmployees = await response.json();
  renderManagedEmployees();
  renderEmployeeAccounts();
}

function renderManagedEmployees() {
  const keyword = document.querySelector('#employee-search').value.trim().toLowerCase();
  const rows = managedEmployees.filter(employee => !keyword || `${employee.employeeNo || ''} ${employee.fullName} ${employee.phone || ''} ${employee.positionName} ${employee.positionType}`.toLowerCase().includes(keyword));
  document.querySelector('#employee-total').textContent = `${rows.length} 名员工`;
  document.querySelector('#employee-records').innerHTML = rows.map(employee => {
    const statusClass = employee.employmentStatus === 'ACTIVE' ? 'order' : 'consumption';
    const tech = employee.technicianId ? '<small class="muted-cell">已关联技师档案</small>' : '';
    const createProfile = employee.active && employee.employmentStatus === 'ACTIVE' && employee.positionType === 'TECHNICIAN' && !employee.technicianId
      ? `<button class="record-delete edit-technician" type="button" data-employee-create-technician="${roomTransferEscape(employee.employeeId)}">创建技师档案</button>` : '';
    return `<tr><td>${roomTransferEscape(employee.employeeNo || '—')}</td><td><b>${roomTransferEscape(employee.fullName)}</b>${tech}</td><td>${roomTransferEscape(employee.positionName)}<small class="muted-cell">${roomTransferEscape(employeePositionLabel[employee.positionType] || employee.positionType)}</small></td><td class="muted-cell">${roomTransferEscape(employee.phone || '—')}</td><td>${roomTransferEscape(employee.hiredOn || '—')}</td><td>${roomTransferEscape(employee.loginName) || '<span class="muted-cell">未关联</span>'}</td><td><span class="record-type ${statusClass}">${roomTransferEscape(employeeStatusLabel[employee.employmentStatus] || employee.employmentStatus)}</span></td><td class="align-right"><button class="record-delete edit-technician" type="button" data-employee-edit="${roomTransferEscape(employee.employeeId)}">编辑</button>${createProfile}${employee.employmentStatus === 'ACTIVE' ? `<button class="record-delete" type="button" data-employee-leave="${roomTransferEscape(employee.assignmentId)}">登记离职</button>` : ''}</td></tr>`;
  }).join('') || '<tr><td colspan="8" class="table-empty">没有匹配的员工</td></tr>';
}

function renderEmployeeAccounts() {
  const target = document.querySelector('#employee-account-records');
  if (!target) return;
  target.innerHTML = managedEmployees.map(employee => `<tr><td><b>${roomTransferEscape(employee.fullName)}</b><small class="muted-cell"> ${roomTransferEscape(employee.employeeNo || '未设置员工号')}</small></td><td>${roomTransferEscape(employee.positionName)}</td><td>${roomTransferEscape(employee.loginName) || '<span class="muted-cell">未关联</span>'}</td><td>${employee.technicianId ? '<span class="record-type order">已关联</span>' : '<span class="muted-cell">普通员工</span>'}</td><td><span class="record-type ${employee.userId ? 'order' : 'consumption'}">${employee.userId ? '已关联' : '未关联'}</span></td><td class="align-right"><button class="record-delete edit-technician" type="button" data-employee-account="${roomTransferEscape(employee.employeeId)}">${employee.userId ? '调整账号' : '关联账号'}</button></td></tr>`).join('') || '<tr><td colspan="6" class="table-empty">当前门店没有员工档案</td></tr>';
}

async function loadEmployeeAccountOptions(employee) {
  const response = await fetch('http://localhost:8080/api/v1/employees/account-options', { headers: storeContextHeaders() });
  if (!response.ok) throw new Error(response.status);
  const options = await response.json();
  const selected = employee?.userId ? [{ id: employee.userId, loginName: employee.loginName, displayName: '当前已关联' }, ...options.filter(item => item.id !== employee.userId)] : options;
  document.querySelector('#employee-account-select').innerHTML = `<option value="">暂不关联账号</option>${selected.map(item => `<option value="${roomTransferEscape(item.id)}">${roomTransferEscape(item.loginName)}${item.displayName ? roomTransferEscape(` · ${item.displayName}`) : ''}</option>`).join('')}`;
  document.querySelector('#employee-account-select').value = employee?.userId || '';
}

async function openEmployeeDialog(employee) {
  editingEmployee = employee || null;
  const form = document.querySelector('#employee-form');
  form.reset();
  document.querySelector('#employee-dialog-title').textContent = employee ? '编辑员工' : '新增员工';
  form.fullName.value = employee?.fullName || '';
  form.phone.value = employee?.phone || '';
  form.employeeNo.value = employee?.employeeNo || '';
  form.hiredOn.value = employee?.hiredOn || '';
  form.positionType.value = employee?.positionType || 'OTHER';
  form.positionName.value = employee?.positionName || '';
  form.note.value = employee?.note || '';
  form.employeeNo.readOnly = Boolean(employee?.technicianId);
  await loadEmployeeAccountOptions(employee);
  document.querySelector('#employee-dialog').showModal();
}

function employeeFormValues(form) {
  return { fullName:form.get('fullName'), phone:form.get('phone') || null, employeeNo:form.get('employeeNo') || null,
    hiredOn:form.get('hiredOn') || null, positionType:form.get('positionType'), positionName:form.get('positionName'),
    note:form.get('note') || null, userId:form.get('userId') || null };
}

function formatAttendanceTime(value) {
  return value ? new Date(value).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', hour12:false }) : '—';
}

function renderEmployeeAttendance() {
  const target = document.querySelector('#employee-attendance-records');
  if (!target) return;
  target.innerHTML = employeeAttendance.map(item => {
    const shift = item.scheduledStart && item.scheduledEnd ? `${String(item.scheduledStart).slice(0,5)} - ${String(item.scheduledEnd).slice(0,5)}` : '未排班';
    const minutes = `迟到 ${Number(item.lateMinutes || 0)} 分 / 早退 ${Number(item.earlyLeaveMinutes || 0)} 分`;
    const inAction = !item.clockInAt && !['REST','ABSENT','LEAVE'].includes(item.status) ? `<button class="record-delete edit-technician" type="button" data-attendance-clock-in="${roomTransferEscape(item.employeeId)}">上班打卡</button>` : '';
    const outAction = item.clockInAt && !item.clockOutAt ? `<button class="record-delete" type="button" data-attendance-clock-out="${roomTransferEscape(item.employeeId)}">下班打卡</button>` : '';
    const stateClass = ['LATE','LEFT_EARLY','ABSENT'].includes(item.status) ? 'refund-state' : ['PRESENT','COMPLETED'].includes(item.status) ? 'order' : 'consumption';
    return `<tr><td><b>${roomTransferEscape(item.employeeName)}</b></td><td>${roomTransferEscape(item.positionName)}<small class="muted-cell">${roomTransferEscape(employeePositionLabel[item.positionType] || item.positionType)}</small></td><td>${shift}</td><td>${formatAttendanceTime(item.clockInAt)}</td><td>${formatAttendanceTime(item.clockOutAt)}</td><td>${minutes}</td><td><span class="record-type ${stateClass}">${roomTransferEscape(attendanceStatusLabel[item.status] || item.status)}</span></td><td class="align-right">${inAction}${outAction || '<span class="muted-cell">—</span>'}</td></tr>`;
  }).join('') || '<tr><td colspan="8" class="table-empty">当前日期没有在职员工</td></tr>';
}

async function loadEmployeeAttendance() {
  const date = document.querySelector('#attendance-date');
  if (!date.value) date.value = localDateValue();
  const response = await fetch(`http://localhost:8080/api/v1/employee-attendance?date=${encodeURIComponent(date.value)}`, { headers:storeContextHeaders() });
  if (!response.ok) throw new Error(`ATTENDANCE_${response.status}`);
  employeeAttendance = await response.json();
  renderEmployeeAttendance();
}

async function loadEmployeeManagementTab(tab) {
  if (tab === 'employees' || tab === 'accounts') return loadManagedEmployees();
  if (tab === 'technicians') return loadManagedTechnicians();
  if (tab === 'attendance') return loadEmployeeAttendance();
  return Promise.all([loadManagedTechnicians(), loadSchedulingData()]);
}

function switchEmployeeManagementTab(tab) {
  employeeManagementTab = tab;
  document.querySelectorAll('#employee-tabs [data-employee-tab]').forEach(button => button.classList.toggle('selected', button.dataset.employeeTab === tab));
  document.querySelector('#employee-archive-panel').classList.toggle('hidden', tab !== 'employees');
  document.querySelector('#technician-archive-panel').classList.toggle('hidden', tab !== 'technicians');
  document.querySelector('#employee-scheduling-panel').classList.toggle('hidden', tab !== 'scheduling');
  document.querySelector('#employee-attendance-panel').classList.toggle('hidden', tab !== 'attendance');
  document.querySelector('#employee-account-panel').classList.toggle('hidden', tab !== 'accounts');
  document.querySelector('#show-inactive-employees').classList.toggle('hidden', tab !== 'employees');
  document.querySelector('#add-employee').classList.toggle('hidden', tab !== 'employees');
  document.querySelector('#show-inactive-techs').classList.toggle('hidden', tab !== 'technicians');
  document.querySelector('#add-technician').classList.toggle('hidden', tab !== 'technicians');
  document.querySelector('#manage-tech-accounts')?.classList.toggle('hidden', tab !== 'technicians');
  loadEmployeeManagementTab(tab).catch(() => toast('员工管理数据加载失败，请检查登录权限'));
}

function ensureServiceCategoryPanel() {
  if (document.querySelector('#service-category-insights')) return;
  const table = document.querySelector('.services-view .admin-table-panel');
  if (!table) return;
  table.insertAdjacentHTML('beforebegin', `<section class="panel service-category-insights" id="service-category-insights"><div class="panel-heading"><div><p class="eyebrow">项目经营分析</p><h2>分类导航与销售排行</h2></div><button class="button secondary" type="button" id="service-category-refresh">刷新</button></div><div class="service-category-toolbar"><button class="button secondary" type="button" id="service-category-add">新增分类</button><span id="service-category-range" class="muted-count"></span></div><div class="service-category-columns"><div><h3>分类树</h3><div id="service-category-tree" class="service-category-tree"></div></div><div><h3>项目排行</h3><div class="ledger-table-wrap"><table><thead><tr><th>项目</th><th>分类</th><th>销量</th><th class="align-right">销售额</th></tr></thead><tbody id="service-project-ranking"></tbody></table></div></div></div></section>`);
  document.querySelector('#service-category-refresh').addEventListener('click', () => loadServiceCategoryInsights().catch(() => toast('项目分析加载失败')));
  document.querySelector('#service-category-add').addEventListener('click', () => openServiceCategoryDialog());
  document.querySelector('#service-category-tree').addEventListener('click', event => {
    const button = event.target.closest('[data-managed-category]');
    if (!button) return;
    selectedManagedServiceCategoryId = button.dataset.managedCategory;
    renderManagedServiceItems();
    document.querySelectorAll('[data-managed-category]').forEach(item => item.classList.toggle('selected', item === button));
  });
  if (!document.querySelector('#service-category-dialog')) {
    document.body.insertAdjacentHTML('beforeend', '<dialog id="service-category-dialog"><form id="service-category-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">项目分类</p><h2 id="service-category-dialog-title">新增分类</h2></div><button class="icon-button" type="button" id="close-service-category-dialog" aria-label="关闭">×</button></div><div class="form-grid"><label>分类名称<input name="name" maxlength="80" required /></label><label>分类编码<input name="code" maxlength="40" required /></label><label class="form-full">上级分类<select name="parentId"><option value="">顶级分类</option></select></label><label>排序<input name="sortOrder" type="number" min="0" max="9999" value="100" required /></label></div><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-service-category">取消</button><button class="button primary" type="submit">保存分类</button></div></form></dialog>');
    document.querySelector('#close-service-category-dialog').addEventListener('click', () => document.querySelector('#service-category-dialog').close());
    document.querySelector('#cancel-service-category').addEventListener('click', () => document.querySelector('#service-category-dialog').close());
    document.querySelector('#service-category-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const response = await fetch('http://localhost:8080/api/v1/service-categories', { method:'POST', headers:storeContextHeaders(true), body:JSON.stringify({ parentId:form.get('parentId') || null, code:String(form.get('code')).trim(), name:String(form.get('name')).trim(), sortOrder:Number(form.get('sortOrder') || 100) }) });
      if (!response.ok) return toast('分类保存失败，请检查名称、编码或上级分类');
      document.querySelector('#service-category-dialog').close();
      await Promise.all([loadServiceCategoryInsights(), loadFoundationData({ silent:true })]);
      toast('项目分类已新增');
    });
  }
}

function openServiceCategoryDialog() {
  ensureServiceCategoryPanel();
  const form = document.querySelector('#service-category-form');
  form.reset();
  form.parentId.innerHTML = '<option value="">顶级分类</option>' + serviceCategoryOptions();
  document.querySelector('#service-category-dialog').showModal();
}

async function loadServiceCategoryInsights() {
  ensureServiceCategoryPanel();
  const [categoryResponse, analyticsResponse] = await Promise.all([
    fetch('http://localhost:8080/api/v1/service-categories', { headers:storeContextHeaders() }),
    fetch('http://localhost:8080/api/v1/service-categories/analytics', { headers:storeContextHeaders() })
  ]);
  if (!categoryResponse.ok || !analyticsResponse.ok) throw new Error('SERVICE_CATEGORY_LOAD_FAILED');
  const categories = await categoryResponse.json();
  state.serviceCategories = categories;
  const analytics = await analyticsResponse.json();
  const serviceForm=document.querySelector('#service-item-form');
  if(serviceForm && !serviceForm.elements.categoryId) serviceForm.elements.category.closest('label').insertAdjacentHTML('afterend','<label>多级分类<select name="categoryId"><option value="">未关联分类树</option></select></label>');
  if(serviceForm?.elements.categoryId){const selected=serviceForm.elements.categoryId.value;serviceForm.elements.categoryId.innerHTML='<option value="">未关联分类树</option>'+serviceCategoryOptions(selected);serviceForm.elements.categoryId.value=categories.some(item=>item.id===selected)?selected:'';}
  document.querySelector('#service-category-range').textContent = `${analytics.from} 至 ${analytics.to}`;
  document.querySelector('#service-category-tree').innerHTML = serviceCategoryNavigation(selectedManagedServiceCategoryId, 'managed-category', true) || '<span class="muted-cell">暂未建立分类</span>';
  document.querySelector('#service-project-ranking').innerHTML = (analytics.projects || []).map(item => { const service=managedServiceItems.find(candidate=>String(candidate.id)===String(item.projectId))||state.services.find(candidate=>String(candidate.id)===String(item.projectId)); const categoryName=service?.categoryId?serviceCategoryPath(service.categoryId):item.categoryName; return `<tr><td><b>${roomTransferEscape(item.projectName)}</b></td><td>${roomTransferEscape(categoryName)}</td><td>${roomTransferEscape(item.soldQuantity)}</td><td class="amount-cell">${money(Number(item.salesAmountCents || 0) / 100)}</td></tr>`; }).join('') || '<tr><td colspan="4" class="table-empty">当前日期范围没有销售数据</td></tr>';
}

function ensureAdministrativeCommissionPanel() {
  if (document.querySelector('#administrative-commission-panel')) return;
  const grid=document.querySelector('#management-view .management-grid');
  if(!grid) return;
  grid.insertAdjacentHTML('beforebegin','<section class="panel admin-table-panel" id="administrative-commission-panel"><div class="panel-heading"><div><p class="eyebrow">行政推荐提成</p><h2>本月推荐提成汇总</h2></div><button class="button secondary" type="button" id="administrative-commission-refresh">刷新</button></div><div class="ledger-table-wrap"><table><thead><tr><th>员工</th><th>登记笔数</th><th>推荐金额</th><th class="align-right">应发提成</th></tr></thead><tbody id="administrative-commission-records"></tbody></table></div></section>');
  grid.insertAdjacentHTML('beforebegin','<section class="panel administrative-commission-config"><div class="panel-heading"><div><h2>推荐登记与规则</h2><p>门店员工推荐项目或办理充值后登记，系统按当前规则计算提成</p></div></div><div class="administrative-commission-forms"><form id="administrative-rule-form" class="form-grid"><label>员工<select name="employeeId" required></select></label><label>项目<select name="serviceItemId"><option value="">全部项目</option></select></label><label>计算方式<select name="ruleType"><option value="PERCENT">按比例</option><option value="FIXED">固定金额</option><option value="NONE">不计提成</option></select></label><label>比例（%）<input name="ratePercent" type="number" min="0" max="100" step="0.01" value="5" /></label><label>固定金额（元）<input name="fixedYuan" type="number" min="0" step="0.01" value="0" /></label><button class="button secondary" type="submit">保存规则</button></form><form id="administrative-referral-form" class="form-grid"><label>推荐员工<select name="employeeId" required></select></label><label>推荐项目<select name="serviceItemId" required></select></label><label>推荐金额（元）<input name="baseYuan" type="number" min="0" step="0.01" required /></label><label>业务日期<input name="businessDate" type="date" readonly /></label><label>备注<input name="note" maxlength="240" /></label><button class="button primary" type="submit">登记推荐</button></form></div></section>');
  document.querySelector('#administrative-commission-refresh').addEventListener('click',()=>loadAdministrativeCommissionSummary().catch(()=>toast('行政推荐提成加载失败')));
  document.querySelector('#administrative-rule-form').addEventListener('submit',saveAdministrativeCommissionRule);
  document.querySelector('#administrative-referral-form').addEventListener('submit',saveAdministrativeReferral);
}

async function loadAdministrativeCommissionSummary() {
  ensureAdministrativeCommissionPanel();
  const [response,employeeResponse,serviceResponse]=await Promise.all([fetch('http://localhost:8080/api/v1/commissions/administrative/summary',{headers:storeContextHeaders()}),fetch('http://localhost:8080/api/v1/employees?includeInactive=false',{headers:storeContextHeaders()}),fetch('http://localhost:8080/api/v1/foundation/service-items',{headers:storeContextHeaders()})]);
  if(!response.ok||!employeeResponse.ok||!serviceResponse.ok) throw new Error('ADMINISTRATIVE_COMMISSION_LOAD_FAILED');
  const rows=await response.json();
  const employees=await employeeResponse.json();
  const services=await serviceResponse.json();
  const employeeOptions=employees.map(item=>`<option value="${roomTransferEscape(item.employeeId)}">${roomTransferEscape(item.fullName)} · ${roomTransferEscape(item.positionName)}</option>`).join('');
  document.querySelectorAll('.administrative-commission-config select[name="employeeId"]').forEach(select=>{const current=select.value;select.innerHTML=employeeOptions||'<option value="">暂无行政员工</option>';if([...select.options].some(option=>option.value===current))select.value=current;});
  const serviceOptions=services.map(item=>`<option value="${roomTransferEscape(item.id)}">${roomTransferEscape(item.name)}</option>`).join('');
  const ruleService=document.querySelector('#administrative-rule-form select[name="serviceItemId"]');const referralService=document.querySelector('#administrative-referral-form select[name="serviceItemId"]');if(ruleService){const current=ruleService.value;ruleService.innerHTML='<option value="">全部项目</option>'+serviceOptions;ruleService.value=current;}if(referralService){const current=referralService.value;referralService.innerHTML=serviceOptions;referralService.value=current||referralService.options[0]?.value||'';}
  const businessDate=document.querySelector('#administrative-referral-form input[name="businessDate"]');if(businessDate)businessDate.value=localDateValue();
  document.querySelector('#administrative-commission-records').innerHTML=rows.map(item=>`<tr><td><b>${roomTransferEscape(item.employeeNameSnapshot)}</b></td><td>${roomTransferEscape(item.recordCount)}</td><td>${money(Number(item.baseAmountCents||0)/100)}</td><td class="amount-cell">${money(Number(item.commissionCents||0)/100)}</td></tr>`).join('')||'<tr><td colspan="4" class="table-empty">本月暂无行政推荐记录</td></tr>';
  applyManagementTab();
}

async function saveAdministrativeCommissionRule(event){event.preventDefault();const form=new FormData(event.currentTarget);const type=form.get('ruleType');const body={employeeId:form.get('employeeId'),serviceItemId:form.get('serviceItemId')||null,ruleType:type,fixedCents:type==='FIXED'?Math.round(Number(form.get('fixedYuan')||0)*100):0,rateBp:type==='PERCENT'?Math.round(Number(form.get('ratePercent')||0)*100):0,active:true};const response=await fetch('http://localhost:8080/api/v1/commissions/administrative/rules',{method:'PUT',headers:storeContextHeaders(true),body:JSON.stringify(body)});if(!response.ok)return toast('行政推荐提成规则保存失败');toast('行政推荐提成规则已保存');}
async function saveAdministrativeReferral(event){event.preventDefault();const form=new FormData(event.currentTarget);const body={employeeId:form.get('employeeId'),serviceItemId:form.get('serviceItemId'),baseAmountCents:Math.round(Number(form.get('baseYuan')||0)*100),businessDate:form.get('businessDate')||localDateValue(),note:form.get('note')||null};const response=await fetch('http://localhost:8080/api/v1/commissions/administrative/referrals',{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify(body)});if(!response.ok)return toast('行政推荐登记失败，请先设置提成规则');event.currentTarget.reset();const dateField=event.currentTarget.querySelector('[name="businessDate"]');if(dateField)dateField.value=localDateValue();await loadAdministrativeCommissionSummary();toast('行政推荐已登记');}

async function loadManagedServiceItems() {
  const response = await fetch(`http://localhost:8080/api/v1/foundation/service-items?includeInactive=${includeInactiveServices}`, { headers: storeContextHeaders() });
  if (!response.ok) throw new Error(response.status);
  managedServiceItems = await response.json();
  if (localStorage.getItem(adminTokenKey)) {
    const rulesResponse = await fetch('http://localhost:8080/api/v1/commissions/service-item-rules', { headers: storeContextHeaders() });
    if (!rulesResponse.ok) throw new Error(rulesResponse.status);
    serviceItemCommissionRules = await rulesResponse.json();
  } else {
    serviceItemCommissionRules = [];
  }
  renderManagedServiceItems();
  loadServiceCategoryInsights().catch(() => {});
}

const commissionRuleTypeLabel = { NONE: '未设置', FIXED: '固定金额', PERCENT: '项目比例' };
function commissionRuleText(type, fixedCents, rateBp) {
  if (type === 'FIXED') return money(Number(fixedCents || 0) / 100);
  if (type === 'PERCENT') return `${(Number(rateBp || 0) / 100).toFixed(2).replace(/\.00$/, '')}%`;
  return '未设置';
}
function commissionRuleSummary(rule) {
  const lines = [
    ['排钟', rule?.queueRuleType, rule?.queueFixedCents, rule?.queueRateBp],
    ['点钟', rule?.callRuleType, rule?.callFixedCents, rule?.callRateBp],
    ['加钟', rule?.extensionRuleType, rule?.extensionFixedCents, rule?.extensionRateBp]
  ];
  return `<div class="commission-summary">${lines.map(([label, type, fixed, rate]) => `<span>${label} <b class="${type && type !== 'NONE' ? '' : 'unset'}">${commissionRuleText(type, fixed, rate)}</b></span>`).join('')}</div>`;
}

function versionDateLabel(value) {
  return !value || value === '1970-01-01' ? '初始版本' : value;
}

function priceVersionSummary(item) {
  const scheduled = item.scheduledPriceEffectiveBusinessDate
    ? `<span class="version-scheduled">预约 ${roomTransferEscape(item.scheduledPriceEffectiveBusinessDate)}：${money(item.scheduledPriceCents / 100)}</span>`
    : '';
  return `<div class="version-cell"><b>${money(item.priceCents / 100)}</b><small>${roomTransferEscape(versionDateLabel(item.priceEffectiveBusinessDate))}生效</small>${scheduled}</div>`;
}

function commissionVersionSummary(rule) {
  if (!rule) return '<span class="muted-cell">登录后查看</span>';
  const scheduled = rule.scheduledEffectiveBusinessDate
    ? `<small class="version-scheduled">预约 ${roomTransferEscape(rule.scheduledEffectiveBusinessDate)}</small>`
    : '';
  return `${commissionRuleSummary(rule)}<small class="version-current">${roomTransferEscape(versionDateLabel(rule.effectiveBusinessDate))}生效</small>${scheduled}`;
}

function renderManagedServiceItems() {
  const keyword = document.querySelector('#service-item-search').value.trim();
  const rows = managedServiceItems.filter(item => serviceMatchesCategory(item, selectedManagedServiceCategoryId) && (!keyword || `${item.code} ${item.name} ${item.category} ${serviceCategoryPath(item.categoryId)}`.toLowerCase().includes(keyword.toLowerCase())));
  document.querySelector('#service-item-total').textContent = `${rows.length} 个项目`;
  const rulesByServiceItem = new Map(serviceItemCommissionRules.map(rule => [rule.serviceItemId, rule]));
  document.querySelector('#service-item-records').innerHTML = rows.map(item => {
    const rule = rulesByServiceItem.get(item.id);
    return `<tr><td>${roomTransferEscape(item.code)}</td><td><b>${roomTransferEscape(item.name)}</b></td><td>${roomTransferEscape(item.categoryId ? serviceCategoryPath(item.categoryId) : item.category)}</td><td><span class="record-type ${item.countsAsClock ? 'order' : 'consumption'}">${item.countsAsClock ? '计钟' : '不计钟'}</span></td><td>${roomTransferEscape(item.defaultDurationMinutes)} 分钟</td><td class="amount-cell">${priceVersionSummary(item)}</td><td>${item.requiresRoom ? '需要房间' : '不需要房间'}</td><td>${item.allowsExtension ? '可加钟' : '不可加钟'}</td><td>${commissionVersionSummary(rule)}</td><td><span class="record-type ${item.active ? 'order' : 'consumption'}">${item.active ? '启用' : '已删除'}</span></td><td class="align-right">${item.active ? `<button class="record-delete edit-technician" type="button" data-service-item-commission="${roomTransferEscape(item.id)}">提成</button><button class="record-delete edit-technician" type="button" data-service-item-edit="${roomTransferEscape(item.id)}">编辑</button><button class="record-delete" type="button" data-service-item-active="${roomTransferEscape(item.id)}" data-active="true">删除</button>` : '<span class="muted-cell">—</span>'}</td></tr>`;
  }).join('') || '<tr><td colspan="11" class="table-empty">没有匹配的服务项目</td></tr>';
}

async function loadPriceVersionHistory(item) {
  const target = document.querySelector('#service-price-version-history');
  if (!item) { target.innerHTML = '<b>价格版本</b><div class="version-history-list"><span>保存后生成首个版本</span></div>'; return; }
  target.innerHTML = '<b>价格版本</b><div class="version-history-list"><span>加载中</span></div>';
  const response = await fetch(`http://localhost:8080/api/v1/foundation/service-items/${item.id}/price-versions`, { headers: storeContextHeaders() });
  if (!response.ok || editingServiceItemId !== item.id) return;
  const versions = await response.json();
  target.innerHTML = `<b>价格版本（新版本生效前沿用上一版本）</b><div class="version-history-list">${versions.map(version => `<span class="${version.effectiveBusinessDate === item.scheduledPriceEffectiveBusinessDate ? 'version-scheduled' : version.effectiveBusinessDate === item.priceEffectiveBusinessDate ? 'version-current' : ''}">${roomTransferEscape(versionDateLabel(version.effectiveBusinessDate))} · ${money(version.priceCents / 100)}</span>`).join('')}</div>`;
}

async function openServiceItemDialog(item) {
  editingServiceItemId = item?.id || null;
  const form = document.querySelector('#service-item-form');
  form.reset();
  document.querySelector('#service-item-dialog-title').textContent = item ? '编辑项目' : '新增项目';
  form.code.value = item?.code || '';
  form.name.value = item?.name || '';
  if (form.elements.categoryId) form.elements.categoryId.value = item?.categoryId || '';
  form.category.value = item?.category || '按摩';
  form.defaultDurationMinutes.value = item?.defaultDurationMinutes || 60;
  form.price.value = item ? (item.priceCents / 100).toFixed(2) : '0.00';
  form.priceEffectiveBusinessDate.value = '';
  form.requiresRoom.checked = item?.requiresRoom ?? true;
  form.allowsExtension.checked = item?.allowsExtension ?? true;
  form.countsAsClock.checked = item?.countsAsClock ?? true;
  document.querySelector('#service-item-dialog').showModal();
  try { await loadPriceVersionHistory(item); } catch { document.querySelector('#service-price-version-history').innerHTML = '<b>价格版本</b><div class="version-history-list"><span>加载失败</span></div>'; }
}

function setCommissionRuleFields(form, prefix, type = 'NONE', fixedCents = 0, rateBp = 0) {
  form.elements[`${prefix}RuleType`].value = type || 'NONE';
  form.elements[`${prefix}FixedYuan`].value = (Number(fixedCents || 0) / 100).toFixed(2);
  form.elements[`${prefix}RatePercent`].value = (Number(rateBp || 0) / 100).toFixed(2).replace(/\.00$/, '');
}

function syncCommissionRuleFields() {
  const form = document.querySelector('#service-commission-form');
  ['queue', 'call', 'extension'].forEach(prefix => {
    const type = form.elements[`${prefix}RuleType`].value;
    form.elements[`${prefix}FixedYuan`].disabled = type !== 'FIXED';
    form.elements[`${prefix}RatePercent`].disabled = type !== 'PERCENT';
  });
}

async function loadCommissionVersionHistory(item, currentRule) {
  const target = document.querySelector('#service-commission-version-history');
  target.innerHTML = '<b>提成版本</b><div class="version-history-list"><span>加载中</span></div>';
  const response = await fetch(`http://localhost:8080/api/v1/commissions/service-item-rules/${item.id}/versions`, { headers: storeContextHeaders() });
  if (!response.ok || editingCommissionServiceItemId !== item.id) return;
  const versions = await response.json();
  target.innerHTML = `<b>提成版本（新版本生效前沿用上一版本）</b><div class="version-history-list">${versions.map(version => `<span class="${version.effectiveBusinessDate === currentRule?.scheduledEffectiveBusinessDate ? 'version-scheduled' : version.effectiveBusinessDate === currentRule?.effectiveBusinessDate ? 'version-current' : ''}">${roomTransferEscape(versionDateLabel(version.effectiveBusinessDate))} · 排 ${commissionRuleText(version.queueRuleType, version.queueFixedCents, version.queueRateBp)} / 点 ${commissionRuleText(version.callRuleType, version.callFixedCents, version.callRateBp)} / 加 ${commissionRuleText(version.extensionRuleType, version.extensionFixedCents, version.extensionRateBp)}</span>`).join('')}</div>`;
}

async function openServiceCommissionDialog(item) {
  editingCommissionServiceItemId = item?.id || null;
  if (!editingCommissionServiceItemId) return;
  const form = document.querySelector('#service-commission-form');
  const rule = serviceItemCommissionRules.find(candidate => candidate.serviceItemId === item.id);
  form.reset();
  document.querySelector('#service-commission-dialog-title').textContent = `${item.name} · 提成设置`;
  setCommissionRuleFields(form, 'queue', rule?.queueRuleType, rule?.queueFixedCents, rule?.queueRateBp);
  setCommissionRuleFields(form, 'call', rule?.callRuleType, rule?.callFixedCents, rule?.callRateBp);
  setCommissionRuleFields(form, 'extension', rule?.extensionRuleType, rule?.extensionFixedCents, rule?.extensionRateBp);
  form.effectiveBusinessDate.value = '';
  syncCommissionRuleFields();
  document.querySelector('#service-commission-dialog').showModal();
  try { await loadCommissionVersionHistory(item, rule); } catch { document.querySelector('#service-commission-version-history').innerHTML = '<b>提成版本</b><div class="version-history-list"><span>加载失败</span></div>'; }
}

function commissionRulePayload(form, prefix) {
  const type = form.elements[`${prefix}RuleType`].value;
  const fixedYuan = Number(form.elements[`${prefix}FixedYuan`].value);
  const ratePercent = Number(form.elements[`${prefix}RatePercent`].value);
  if (!Number.isFinite(fixedYuan) || fixedYuan < 0 || !Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) throw new Error('INVALID_COMMISSION_VALUE');
  return {
    [`${prefix}RuleType`]: type,
    [`${prefix}FixedCents`]: type === 'FIXED' ? Math.round(fixedYuan * 100) : 0,
    [`${prefix}RateBp`]: type === 'PERCENT' ? Math.round(ratePercent * 100) : 0
  };
}

async function loadManagedPaymentMethods() {
  const response = await fetch(`http://localhost:8080/api/v1/payment-methods?includeInactive=${includeInactivePaymentMethods}`, { headers: storeContextHeaders() });
  if (!response.ok) throw new Error(response.status);
  managedPaymentMethods = await response.json();
  renderManagedPaymentMethods();
}

function renderManagedPaymentMethods() {
  const keyword = document.querySelector('#payment-method-search').value.trim().toLowerCase();
  const rows = managedPaymentMethods.filter(item => !keyword || `${item.code} ${item.name}`.toLowerCase().includes(keyword));
  document.querySelector('#payment-method-total').textContent = `${rows.length} 种收款方式`;
  document.querySelector('#payment-method-records').innerHTML = rows.map(item => `<tr><td>${roomTransferEscape(item.code)}</td><td><b>${roomTransferEscape(item.name)}</b>${item.builtIn ? '<small class="muted-cell"> 系统内置</small>' : ''}</td><td>${item.cashCounted ? '计入现金统计' : '不计入现金统计'}</td><td class="muted-cell">${roomTransferEscape(item.note || '—')}</td><td><span class="record-type ${item.active ? 'order' : 'consumption'}">${item.active ? '启用' : '已删除'}</span></td><td class="align-right">${item.builtIn || !item.active ? '<span class="muted-cell">—</span>' : `<button class="record-delete edit-technician" type="button" data-payment-method-edit="${roomTransferEscape(item.id)}">编辑</button><button class="record-delete" type="button" data-payment-method-active="${roomTransferEscape(item.id)}" data-active="true">删除</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="table-empty">没有匹配的收款方式</td></tr>';
}

function openPaymentMethodDialog(item) {
  editingPaymentMethodId = item?.id || null;
  const form = document.querySelector('#payment-method-form'); form.reset();
  document.querySelector('#payment-method-dialog-title').textContent = item ? '编辑收款方式' : '新增收款方式';
  form.code.value = item?.code || '';
  form.name.value = item?.name || '';
  form.sortOrder.value = item?.sortOrder || 100;
  form.cashCounted.checked = item?.cashCounted || false;
  form.note.value = item?.note || '';
  document.querySelector('#payment-method-dialog').showModal();
}

async function loadActivePaymentMethods() {
  const response = await fetch('http://localhost:8080/api/v1/payment-methods', { headers: storeContextHeaders() });
  if (!response.ok) throw new Error(response.status);
  activePaymentMethods = await response.json();
}

let settlementPaymentDraft = new Map();

function settlementTotalCents() {
  return Math.round(state.orderItems.reduce((sum,item)=>sum+item.price,0)*100);
}

function settlementAmountCents() {
  const input = document.querySelector('#settlement-amount');
  return Math.round(Math.max(0, Number(input?.value) || 0) * 100);
}

function settlementIsWaived() {
  return Boolean(document.querySelector('#settlement-waive')?.checked);
}

function settlementPayments() {
  return [...document.querySelectorAll('[data-payment-amount]')].map(input => ({
    method: input.dataset.paymentAmount,
    amountCents: Math.round(Math.max(0, Number(input.value) || 0) * 100)
  })).filter(payment => payment.amountCents > 0);
}

function updateSettlementAllocation() {
  document.querySelectorAll('[data-payment-amount]').forEach(input => settlementPaymentDraft.set(input.dataset.paymentAmount, input.value));
  const totalCents = settlementAmountCents();
  const allocatedCents = settlementPayments().reduce((sum,payment)=>sum+payment.amountCents,0);
  const remainingCents = totalCents-allocatedCents;
  const receivable = document.querySelector('#settlement-receivable');
  if (receivable) receivable.textContent=(totalCents/100).toFixed(2);
  const discount = document.querySelector('#settlement-discount');
  if (discount) discount.textContent=((settlementTotalCents()-totalCents)/100).toFixed(2);
  document.querySelector('#settlement-allocated').textContent=money(allocatedCents/100);
  document.querySelector('#settlement-remaining').textContent=remainingCents===0?money(0):`${remainingCents<0?'-':''}${money(Math.abs(remainingCents)/100)}`;
  document.querySelector('#settlement-remaining').classList.toggle('settlement-overpaid',remainingCents<0);
  const submitButton=document.querySelector('#settlement-dialog .pay-button');
  if(submitButton) submitButton.disabled=(!settlementIsWaived() && totalCents < 1)||remainingCents!==0||(totalCents > 0 && settlementPayments().length===0);
}

function renderSettlementPaymentMethods({ reset = false } = {}) {
  const container = document.querySelector('#payment-options');
  const hasMember = Boolean(state.selectedMemberId);
  const methods = activePaymentMethods.filter(item => item.active !== false);
  const firstEnabledCode = methods.find(item => hasMember || item.code !== 'MEMBER_BALANCE')?.code;
  if(reset){settlementPaymentDraft=new Map();if(firstEnabledCode)settlementPaymentDraft.set(firstEnabledCode,(settlementAmountCents()/100).toFixed(2));}
  container.innerHTML = methods.map(item => {
    const memberRequired = item.methodKind === 'MEMBER_BALANCE' && !hasMember;
    const member = state.members.find(memberItem=>memberItem.id===state.selectedMemberId);
    const note = item.methodKind === 'MEMBER_BALANCE' ? (memberRequired ? '需先选择会员' : `余额 ${money(member?.balance||0)}`) : (item.cashCounted ? '计入现金' : '');
    const value = memberRequired ? '' : (settlementPaymentDraft.get(item.code)||'');
    return `<label class="payment-option${memberRequired?' disabled':''}"><span><b>${memberBusinessEscape(item.name)}</b><small>${memberBusinessEscape(note)}</small></span><span class="payment-amount-control"><i>¥</i><input type="number" min="0" step="0.01" inputmode="decimal" data-payment-amount="${memberBusinessEscape(item.code)}" value="${memberBusinessEscape(value)}" ${memberRequired?'disabled':''} aria-label="${memberBusinessEscape(item.name)}收款金额"><button type="button" data-fill-payment="${memberBusinessEscape(item.code)}" ${memberRequired?'disabled':''}>填入剩余</button></span></label>`;
  }).join('') || '<p class="empty-state payment-empty-state">当前门店没有可用于散客结算的收款方式，请先启用现金、支付宝等收款方式</p>';
  updateSettlementAllocation();
}

async function loadStorePrintSetting({ render = true } = {}) {
  const response = await fetch('http://localhost:8080/api/v1/print-settings', { headers: storeContextHeaders() });
  if (!response.ok) throw new Error(response.status);
  storePrintSetting = await response.json();
  if (render) renderPrintSetting();
  return storePrintSetting;
}

function renderPrintSetting() {
  if (!storePrintSetting) return;
  const form = document.querySelector('#print-setting-form');
  Object.entries(storePrintSetting).forEach(([key, value]) => {
    const input = form.elements.namedItem(key);
    if (!input) return;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value ?? '';
  });
  renderPrintContentOptions();
  renderPrintPreview();
}

function receiptEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
}

const printContentGroups = [
  ['门店信息', [['showStoreName','门店名称'],['showStoreAddress','门店地址'],['showStorePhone','联系电话'],['showHeader','顶部提示'],['showFooter','底部备注']]],
  ['订单与服务', [['showOrderNumbers','消费单号与结算单号'],['showRoom','房间'],['showServiceArea','服务区'],['showProjects','服务项目'],['showClockType','显示钟类'],['showTechnician','技师'],['showDuration','服务时长'],['showQuantity','数量'],['showUnitPrice','项目单价'],['showLineAmount','项目金额']]],
  ['金额与收款', [['showSubtotal','消费与小计'],['showBeforeDiscount','折前金额'],['showDiscount','折扣金额'],['showReceivable','应收金额'],['showPayment','收款方式与金额'],['showChange','找零']]],
  ['会员与操作', [['showMember','会员姓名'],['showMemberPhone','会员手机号'],['showBalance','会员余额'],['showCashier','收银员'],['showCreatedAt','开单时间'],['showSettledAt','结算时间'],['showPrintedAt','打印时间'],['showPrintCopies','打印次数']]]
];
const defaultPrintContentOptions = Object.fromEntries(printContentGroups.flatMap(([, fields]) => fields.map(([key]) => [key, true])));
function printContentOptions(setting = storePrintSetting) {
  try { return { ...defaultPrintContentOptions, ...(setting?.contentOptions ? JSON.parse(setting.contentOptions) : {}) }; }
  catch { return { ...defaultPrintContentOptions }; }
}
function shouldPrint(setting, key) { return printContentOptions(setting)[key] !== false; }
function renderPrintContentOptions() {
  const form = document.querySelector('#print-setting-form');
  const legacy = form.querySelector('.print-setting-options');
  if (legacy && !legacy.dataset.fieldTemplateReady) {
    legacy.dataset.fieldTemplateReady = 'true';
    legacy.querySelectorAll('label:not(:first-child)').forEach(item => item.remove());
    legacy.classList.add('print-auto-option');
    legacy.insertAdjacentHTML('afterend', '<section class="print-content-options form-full"><div><h3>订单打印字段</h3><p>每笔订单按真实项目、房间、技师和收款记录生成小票</p></div><div id="print-content-option-list"></div></section>');
  }
  const container = document.querySelector('#print-content-option-list');
  if (!container) return;
  const options = printContentOptions();
  container.innerHTML = printContentGroups.map(([title, fields]) => `<section class="print-field-group"><h4>${title}</h4>${fields.map(([key, label]) => `<label><input type="checkbox" name="contentOption" value="${key}" ${options[key] ? 'checked' : ''} /> ${label}</label>`).join('')}</section>`).join('');
}
function selectedPrintContentOptions() {
  const selected = new Set([...document.querySelectorAll('#print-content-option-list input:checked')].map(input => input.value));
  return Object.fromEntries(Object.keys(defaultPrintContentOptions).map(key => [key, selected.has(key)]));
}

function renderPrintPreview() {
  const form = document.querySelector('#print-setting-form');
  const field = name => form.elements.namedItem(name);
  const liveContentOptions = document.querySelector('#print-content-option-list') ? selectedPrintContentOptions() : printContentOptions();
  const selected = name => Object.prototype.hasOwnProperty.call(defaultPrintContentOptions, name) ? liveContentOptions[name] : Boolean(field(name)?.checked);
  const text = name => receiptEscape(field(name)?.value || '');
  const optional = (enabled, value) => enabled && value ? `<p>${value}</p>` : '';
  const preview = document.querySelector('#print-receipt-preview');
  preview.style.setProperty('--receipt-width', `${field('paperWidthMm').value || 80}mm`);
  preview.style.setProperty('--receipt-font-size', `${field('fontSizePx').value || 12}px`);
  const title = text('receiptTitle') === '消费小票' ? (text('storeName') || '门店名称') : text('receiptTitle');
  preview.innerHTML = `<h3>${title}</h3><div class="preview-dash"></div><p>消费单号：SO202607290001</p><p>结算单号：JS2607290100001</p><div class="preview-dash"></div>${selected('showRoom') ? '<p><b>房：201</b><span>服务区</span></p>' : ''}<table><thead><tr><th>序</th><th>消费项目</th><th>技师</th><th>数量</th><th>金额</th></tr></thead><tbody><tr><td>1</td><td>舒缓按摩${selected('showClockType') ? '<small>钟类：点钟</small>' : ''}</td><td>${selected('showTechnician') ? '示例技师' : '—'}</td><td>1</td><td>¥298.00</td></tr></tbody></table><p class="preview-total">消费：¥298.00 <span>小计：¥298.00</span></p><div class="preview-dash"></div><p>总消费额：¥298.00 <span>折前金额：¥298.00</span></p><p>折扣金额：¥0.00</p><div class="preview-dash"></div><strong>应收：¥298.00</strong>${selected('showPayment') ? '<p>现金 <span>¥298.00</span></p>' : ''}${selected('showBalance') ? '<p>会员余额：¥500.00</p>' : ''}<div class="preview-dash"></div><p>收银员：店长</p><p>结算时间：2026-07-29 15:50:00</p>${optional(true, text('footerNote'))}`;
}

async function printReceipt(orderDetail, openedWindow = null) {
  const setting = storePrintSetting || await loadStorePrintSetting({ render: false });
  const popup = openedWindow || window.open('', 'massage-receipt', 'popup,width=480,height=720');
  if (!popup) throw new Error('PRINT_WINDOW_BLOCKED');
  const { order, lines, payments } = orderDetail;
  const show = key => shouldPrint(setting, key);
  const storeInfo = [show('showStoreAddress') && setting.storeAddress, show('showStorePhone') && setting.storePhone].filter(Boolean).map(value => `<div>${receiptEscape(value)}</div>`).join('');
  const memberInfo = show('showMember') && order.memberName ? `<div>会员：${receiptEscape(order.memberName)}${order.memberPhone ? ` ${receiptEscape(order.memberPhone)}` : ''}</div>` : '';
  const lineRows = lines.map(line => `<tr><td>${receiptEscape(line.itemNameSnapshot)}${show('showClockType') ? `<small>钟类：${receiptEscape(receiptClockTypeLabel(line.clockType))}</small>` : ''}${show('showTechnician') && line.technicianName ? `<small>技师：${receiptEscape(line.technicianName)}</small>` : ''}${show('showRoom') && line.roomCode ? `<small>房间：${receiptEscape(line.roomCode)}</small>` : ''}</td><td>${roomTransferEscape(line.durationMinutes)}分</td><td>¥${(line.lineAmountCents / 100).toFixed(2)}</td></tr>`).join('');
  const paymentRows = show('showPayment') ? payments.map(payment => `<div class="line"><span>${receiptEscape(payment.paymentMethodNameSnapshot || payment.paymentMethod)}</span><span>¥${(payment.amountCents / 100).toFixed(2)}</span></div>`).join('') : '';
  const balance = show('showBalance') && order.memberName ? `<div class="line"><span>会员余额</span><span>¥${((order.memberBalanceCents || 0) / 100).toFixed(2)}</span></div>` : '';
  const content = `<section class="receipt"><header><b>${receiptEscape(setting.receiptTitle)}</b><h1>${receiptEscape(setting.storeName)}</h1>${storeInfo}${setting.headerNote ? `<p>${receiptEscape(setting.headerNote)}</p>` : ''}</header>${show('showOrderNo') ? `<div>订单号：${receiptEscape(order.orderNo)}</div>` : ''}<div>结算时间：${new Date(order.settledAt).toLocaleString('zh-CN', { hour12:false })}</div>${memberInfo}<table>${lineRows}</table><div class="total"><span>合计</span><strong>¥${(order.paidCents / 100).toFixed(2)}</strong></div>${paymentRows}${balance}${setting.footerNote ? `<footer>${receiptEscape(setting.footerNote)}</footer>` : ''}</section>`;
  const copies = Array.from({ length: setting.copies || 1 }, () => content).join('');
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>小票</title><style>@page{size:${roomTransferEscape(setting.paperWidthMm)}mm auto;margin:${roomTransferEscape(setting.marginMm)}mm}*{box-sizing:border-box}body{margin:0;font-family:"Microsoft YaHei",sans-serif;font-size:${roomTransferEscape(setting.fontSizePx)}px;color:#000}.receipt{width:${roomTransferEscape(setting.paperWidthMm)}mm;page-break-after:always}.receipt:last-child{page-break-after:auto}header{text-align:center;margin-bottom:8px}header b{font-size:1.08em}h1{margin:4px 0;font-size:1.15em}p{margin:3px 0}table{width:100%;margin:8px 0;border-collapse:collapse}td{padding:3px 0;vertical-align:top}td:nth-child(2),td:nth-child(3){text-align:right;white-space:nowrap}small{display:block;color:#333;font-size:.88em}.total,.line{display:flex;justify-content:space-between;padding:3px 0}.total{margin-top:6px;border-top:1px dashed #000;font-size:1.12em}footer{margin-top:10px;text-align:center}</style></head><body>${copies}</body></html>`);
  popup.document.close();
  window.setTimeout(() => { popup.focus(); popup.print(); }, 240);
}

async function printReferenceReceipt(orderDetail, openedWindow = null) {
  const setting = storePrintSetting || await loadStorePrintSetting({ render:false });
  const popup = openedWindow || window.open('', 'massage-receipt', 'popup,width=480,height=720');
  if (!popup) throw new Error('PRINT_WINDOW_BLOCKED');
  const { order, lines, payments } = orderDetail;
  const show = key => shouldPrint(setting, key);
  const moneyText = cents => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
  const timeText = value => value ? new Date(value).toLocaleString('zh-CN', { hour12:false }) : '—';
  const primaryRoom = lines.find(line => line.roomCode || line.roomName);
  const roomLabel = primaryRoom?.roomName || primaryRoom?.roomCode || '—';
  const subtotal = lines.reduce((sum, line) => sum + Number(line.lineAmountCents || 0), 0);
  const beforeDiscount = Number(order.receivableCents || subtotal);
  const discount = Math.max(0, beforeDiscount - Number(order.paidCents || 0));
  const receiptTitle = setting.receiptTitle === '消费小票' ? setting.storeName : setting.receiptTitle;
  const titleSubline = receiptTitle === setting.storeName ? '' : `<p>${receiptEscape(setting.storeName)}</p>`;
  const narrowPaper = Number(setting.paperWidthMm) <= 58;
  const lineRows = lines.map((line, index) => `<tr><td>${index + 1}</td><td>${receiptEscape(line.itemNameSnapshot)}${show('showClockType') ? `<small>钟类：${receiptEscape(receiptClockTypeLabel(line.clockType))}</small>` : ''}</td><td>${show('showTechnician') ? receiptEscape(line.technicianName || '—') : ''}</td><td>${roomTransferEscape(line.quantity || 1)}</td><td>${moneyText(line.lineAmountCents)}</td><td>—</td></tr>`).join('');
  const compactLineRows = lines.map((line, index) => `<article class="reference-compact-item"><div><b>${index + 1}. ${receiptEscape(line.itemNameSnapshot)}</b><strong>${moneyText(line.lineAmountCents)}</strong></div>${show('showClockType') ? `<small>钟类：${receiptEscape(receiptClockTypeLabel(line.clockType))}</small>` : ''}${show('showTechnician') ? `<small>技师：${receiptEscape(line.technicianName || '—')}</small>` : ''}<small>${roomTransferEscape(line.quantity || 1)} × ${roomTransferEscape(line.durationMinutes || 0)}分</small></article>`).join('');
  const paymentRows = show('showPayment') ? payments.map(payment => `<tr><td>${receiptEscape(payment.paymentMethodNameSnapshot || payment.paymentMethod)}</td><td>${moneyText(payment.amountCents)}</td><td>¥0.00</td></tr>`).join('') : '';
  const memberBlock = show('showMember') && order.memberName ? `<p>会员：${receiptEscape(order.memberName)}${order.memberPhone ? ` ${receiptEscape(order.memberPhone)}` : ''}</p>` : '';
  const balanceBlock = show('showBalance') && order.memberName ? `<p>会员余额：${moneyText(order.memberBalanceCents)}</p>` : '';
  const orderNumbers = show('showOrderNumbers') ? `<p>消费单号：${receiptEscape(order.orderNo)}</p><p>结算单号：${receiptEscape(order.settlementNo || '—')}</p>` : '';
  const roomBlock = show('showRoom') ? `<p class="room-line">房：${receiptEscape(roomLabel)} <span>服务区</span></p>` : '';
  const itemSection = narrowPaper
    ? `<div class="reference-compact-items">${compactLineRows}</div>`
    : `<table class="item-table"><thead><tr><th>序</th><th>消费项目</th><th>技师</th><th>数量</th><th>金额</th><th>折</th></tr></thead><tbody>${lineRows}</tbody></table>`;
  const content = `<section class="reference-receipt"><header><h1>${receiptEscape(receiptTitle)}</h1>${titleSubline}</header><div class="dash"></div>${orderNumbers}${memberBlock}<div class="dash"></div>${roomBlock}${itemSection}<div class="subtotal"><span>消费：${moneyText(subtotal)}</span><span>小计：${moneyText(subtotal)}</span></div><div class="dash"></div><div class="summary"><span>总消费额：${moneyText(beforeDiscount)}</span><span>折前金额：${moneyText(beforeDiscount)}</span><span>折扣金额：${moneyText(discount)}</span></div><div class="dash"></div><div class="receivable">应收：${moneyText(order.paidCents)}</div><div class="dash"></div>${show('showPayment') ? `<table class="payment-table"><thead><tr><th>收款方式</th><th>收款</th><th>找零</th></tr></thead><tbody>${paymentRows}</tbody></table>` : ''}${balanceBlock}<div class="dash"></div><div class="metadata"><p>收银员：${receiptEscape(order.cashierNameSnapshot || '—')} <span>打印次数：${roomTransferEscape(setting.copies || 1)}</span></p><p>打印时间：${timeText(new Date())}</p><p>开单时间：${timeText(order.createdAt)}</p><p>结算时间：${timeText(order.settledAt)}</p></div>${setting.footerNote ? `<footer>${receiptEscape(setting.footerNote)}</footer>` : ''}</section>`;
  const copies = Array.from({ length:setting.copies || 1 }, () => content).join('');
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>消费小票</title><style>@page{size:${roomTransferEscape(setting.paperWidthMm)}mm auto;margin:${roomTransferEscape(setting.marginMm)}mm}*{box-sizing:border-box}body{margin:0;color:#000;font-family:"Microsoft YaHei",sans-serif;font-size:${roomTransferEscape(setting.fontSizePx)}px;line-height:1.45}.reference-receipt{width:${roomTransferEscape(setting.paperWidthMm)}mm;page-break-after:always}.reference-receipt:last-child{page-break-after:auto}header{text-align:center;padding:2px 0 7px}header h1{margin:0;font-size:1.65em;letter-spacing:0}header p{margin:3px 0 0}.dash{height:1px;margin:7px 0;border-top:1px dashed #000}.reference-receipt p{margin:2px 0}.room-line{display:flex;justify-content:space-between;font-size:1.1em;font-weight:700}.item-table,.payment-table{width:100%;border-collapse:collapse}.item-table th,.item-table td,.payment-table th,.payment-table td{padding:3px 1px;text-align:left;vertical-align:top;font-weight:400}.item-table th,.payment-table th{font-weight:700;white-space:nowrap}.item-table th:nth-child(1),.item-table td:nth-child(1){width:7%}.item-table th:nth-child(2),.item-table td:nth-child(2){width:35%}.item-table th:nth-child(3),.item-table td:nth-child(3){width:18%}.item-table th:nth-child(n+4),.item-table td:nth-child(n+4),.payment-table th:nth-child(n+2),.payment-table td:nth-child(n+2){text-align:right;white-space:nowrap}.item-table td small{display:block;color:#333;font-size:.9em}.reference-compact-items{display:grid;gap:5px}.reference-compact-item{padding:3px 0;border-bottom:1px dotted #999}.reference-compact-item>div{display:flex;justify-content:space-between;gap:6px}.reference-compact-item b{overflow-wrap:anywhere}.reference-compact-item strong{white-space:nowrap}.reference-compact-item small{display:block;color:#333;font-size:.9em}.subtotal,.summary{display:flex;justify-content:space-between;gap:8px}.summary{display:grid;grid-template-columns:1fr 1fr}.summary span:nth-child(2){text-align:right}.summary span:nth-child(3){grid-column:1}.receivable{text-align:right;font-size:1.7em;font-weight:800}.metadata p span{float:right}footer{margin-top:8px;text-align:center}</style></head><body>${copies}</body></html>`);
  popup.document.close();
  window.setTimeout(() => { popup.focus(); popup.print(); }, 240);
}

async function refreshLocalPrintBridge() {
  try {
    const response = await fetch('http://127.0.0.1:9178/health');
    localPrintBridgeOnline = response.ok;
  } catch { localPrintBridgeOnline = false; }
  return localPrintBridgeOnline;
}

async function localReceiptText(orderDetail) {
  const setting = storePrintSetting || await loadStorePrintSetting({ render:false });
  const { order, lines, payments } = orderDetail;
  const moneyText = cents => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
  const timeText = value => value ? new Date(value).toLocaleString('zh-CN', { hour12:false }) : '—';
  const subtotal = lines.reduce((sum, line) => sum + Number(line.lineAmountCents || 0), 0);
  const room = lines.find(line => line.roomCode || line.roomName);
  const output = [setting.receiptTitle === '消费小票' ? setting.storeName : setting.receiptTitle, '--------------------------------', `消费单号：${order.orderNo}`, `结算单号：${order.settlementNo || '—'}`, `房：${room?.roomName || room?.roomCode || '—'}`, '序  消费项目  技师  数量  金额'];
  lines.forEach((line, index) => {
    output.push(`${index + 1}. ${line.itemNameSnapshot}`);
    if (shouldPrint(setting, 'showClockType')) output.push(`   钟类：${receiptClockTypeLabel(line.clockType)}`);
    output.push(`   技师：${line.technicianName || '—'}  数量${line.quantity || 1}  ${moneyText(line.lineAmountCents)}`);
  });
  output.push(`消费：${moneyText(subtotal)}  小计：${moneyText(subtotal)}`, `总消费额：${moneyText(order.receivableCents)}`, '折扣金额：¥0.00', '--------------------------------', `应收：${moneyText(order.paidCents)}`, '收款方式  收款  找零');
  payments.forEach(payment => output.push(`${payment.paymentMethodNameSnapshot || payment.paymentMethod}  ${moneyText(payment.amountCents)}  ¥0.00`));
  output.push('--------------------------------', `收银员：${order.cashierNameSnapshot || '—'}  打印次数：${setting.copies || 1}`, `打印时间：${timeText(new Date())}`, `开单时间：${timeText(order.createdAt)}`, `结算时间：${timeText(order.settledAt)}`);
  if (setting.footerNote) output.push(setting.footerNote);
  return { text:output.join('\n'), setting };
}

async function localReceiptTextByOptions(orderDetail) {
  const setting = storePrintSetting || await loadStorePrintSetting({ render:false });
  const { order, lines, payments } = orderDetail;
  const show = key => shouldPrint(setting, key);
  const moneyText = cents => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
  const timeText = value => value ? new Date(value).toLocaleString('zh-CN', { hour12:false }) : '—';
  const subtotal = lines.reduce((sum, line) => sum + Number(line.lineAmountCents || 0), 0);
  const room = lines.find(line => line.roomCode || line.roomName);
  const narrowPaper = Number(setting.paperWidthMm) <= 58;
  const output = [];
  if (show('showStoreName')) output.push(setting.receiptTitle === '消费小票' ? setting.storeName : setting.receiptTitle);
  if (show('showStoreAddress') && setting.storeAddress) output.push(setting.storeAddress);
  if (show('showStorePhone') && setting.storePhone) output.push(setting.storePhone);
  if (show('showHeader') && setting.headerNote) output.push(setting.headerNote);
  output.push('--------------------------------');
  if (show('showOrderNumbers')) output.push(`消费单号：${order.orderNo}`, `结算单号：${order.settlementNo || '—'}`);
  if (show('showMember') && order.memberName) output.push(`会员：${order.memberName}${show('showMemberPhone') && order.memberPhone ? ` ${order.memberPhone}` : ''}`);
  if (show('showRoom')) output.push(`房：${room?.roomName || room?.roomCode || '—'}`);
  if (show('showServiceArea')) output.push('服务区：—');
  if (show('showProjects')) {
    output.push(show('showTechnician') ? '序  消费项目（技师）' : '序  消费项目');
    lines.forEach((line, index) => {
      const itemName = String(line.itemNameSnapshot || '未命名项目').replace(/\s+/g, ' ').trim();
      const technician = show('showTechnician') ? `（${String(line.technicianName || '—').replace(/\s+/g, ' ').trim()}）` : '';
      output.push(`${index + 1}. ${itemName}${show('showClockType') ? ` · 钟类：${receiptClockTypeLabel(line.clockType)}` : ''}${technician}`);
      const detail = [];
      if (show('showDuration')) detail.push(`${line.durationMinutes || 0}分`);
      if (show('showQuantity')) detail.push(`数量${line.quantity || 1}`);
      if (detail.length) output.push(`   ${detail.join('  ')}`);
      if (show('showUnitPrice')) output.push(`   单价 ${moneyText(line.unitPriceCents || line.lineAmountCents)}${!narrowPaper && show('showLineAmount') ? `  金额 ${moneyText(line.lineAmountCents)}` : ''}`);
      if (show('showLineAmount') && (!show('showUnitPrice') || narrowPaper)) output.push(`   金额 ${moneyText(line.lineAmountCents)}`);
    });
  }
  if (show('showSubtotal')) output.push(`消费：${moneyText(subtotal)}  小计：${moneyText(subtotal)}`);
  if (show('showBeforeDiscount')) output.push(`折前金额：${moneyText(order.receivableCents)}`);
  if (show('showDiscount')) output.push('折扣金额：¥0.00');
  if (show('showReceivable')) { output.push('--------------------------------', `应收：${moneyText(order.paidCents)}`); }
  if (show('showPayment')) {
    output.push('收款方式  收款' + (show('showChange') ? '  找零' : ''));
    payments.forEach(payment => output.push(`${payment.paymentMethodNameSnapshot || payment.paymentMethod}  ${moneyText(payment.amountCents)}${show('showChange') ? '  ¥0.00' : ''}`));
  }
  if (show('showBalance') && order.memberName) output.push(`会员余额：${moneyText(order.memberBalanceCents)}`);
  output.push('--------------------------------');
  if (show('showCashier')) output.push(`收银员：${order.cashierNameSnapshot || '—'}`);
  if (show('showPrintCopies')) output.push(`打印次数：${setting.copies || 1}`);
  if (show('showPrintedAt')) output.push(`打印时间：${timeText(new Date())}`);
  if (show('showCreatedAt')) output.push(`开单时间：${timeText(order.createdAt)}`);
  if (show('showSettledAt')) output.push(`结算时间：${timeText(order.settledAt)}`);
  if (show('showFooter') && setting.footerNote) output.push(setting.footerNote);
  return { text:output.join('\n'), setting };
}

async function printBrowserReceiptByOptions(orderDetail, openedWindow = null) {
  const { order, lines, payments } = orderDetail;
  const setting = storePrintSetting || await loadStorePrintSetting({ render:false });
  const show = key => shouldPrint(setting, key);
  const moneyText = cents => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
  const timeText = value => value ? new Date(value).toLocaleString('zh-CN', { hour12:false }) : '—';
  const subtotal = lines.reduce((sum, line) => sum + Number(line.lineAmountCents || 0), 0);
  const room = lines.find(line => line.roomCode || line.roomName);
  const receiptTitle = setting.receiptTitle === '消费小票' ? setting.storeName : setting.receiptTitle;
  const optional = (enabled, value) => enabled && value ? `<p>${receiptEscape(value)}</p>` : '';
  const itemColumns = [
    { key:'index', label:'序', className:'col-index' },
    { key:'project', label:show('showTechnician') ? '项目 / 技师' : '消费项目', className:'col-project' },
    ...(show('showDuration') ? [{ key:'duration', label:'时长', className:'col-duration' }] : []),
    ...(show('showQuantity') ? [{ key:'quantity', label:'数量', className:'col-quantity' }] : []),
    ...(show('showUnitPrice') ? [{ key:'unitPrice', label:'单价', className:'col-unit' }] : []),
    ...(show('showLineAmount') ? [{ key:'lineAmount', label:'金额', className:'col-amount' }] : [])
  ];
  const itemRows = lines.map((line, index) => {
    const cells = {
      index: index + 1,
      project: `<strong>${receiptEscape(line.itemNameSnapshot || '未命名项目')}</strong>${show('showClockType') ? `<small>钟类：${receiptEscape(receiptClockTypeLabel(line.clockType))}</small>` : ''}${show('showTechnician') ? `<small>技师：${receiptEscape(line.technicianName || '—')}</small>` : ''}`,
      duration: `${Number(line.durationMinutes || 0)}分`,
      quantity: Number(line.quantity || 1),
      unitPrice: moneyText(line.unitPriceCents || line.lineAmountCents),
      lineAmount: moneyText(line.lineAmountCents)
    };
    return `<tr>${itemColumns.map(column => `<td class="${roomTransferEscape(column.className)}">${cells[column.key]}</td>`).join('')}</tr>`;
  }).join('');
  const compactRows = lines.map((line, index) => `<article class="compact-item"><div class="compact-title"><strong>${index + 1}. ${receiptEscape(line.itemNameSnapshot || '未命名项目')}</strong>${show('showLineAmount') ? `<b>${moneyText(line.lineAmountCents)}</b>` : ''}</div>${show('showClockType') ? `<div class="compact-sub">钟类：${receiptEscape(receiptClockTypeLabel(line.clockType))}</div>` : ''}${show('showTechnician') ? `<div class="compact-sub">技师：${receiptEscape(line.technicianName || '—')}</div>` : ''}<div class="compact-meta">${show('showDuration') ? roomTransferEscape(`${Number(line.durationMinutes || 0)}分`) : ''}${show('showQuantity') ? roomTransferEscape(`　数量 ${Number(line.quantity || 1)}`) : ''}</div>${show('showUnitPrice') ? `<div class="compact-price">单价 ${moneyText(line.unitPriceCents || line.lineAmountCents)}${show('showLineAmount') ? roomTransferEscape(`　金额 ${moneyText(line.lineAmountCents)}`) : ''}</div>` : ''}</article>`).join('');
  const isNarrow = Number(setting.paperWidthMm) <= 58;
  const itemSection = show('showProjects') ? (isNarrow
    ? `<section class="compact-items">${compactRows}</section>`
    : `<table class="item-table"><colgroup>${itemColumns.map(column => `<col class="${roomTransferEscape(column.className)}">`).join('')}</colgroup><thead><tr>${itemColumns.map(column => `<th class="${roomTransferEscape(column.className)}">${roomTransferEscape(column.label)}</th>`).join('')}</tr></thead><tbody>${itemRows}</tbody></table>`) : '';
  const paymentRows = show('showPayment') ? payments.map(payment => `<tr><td>${receiptEscape(payment.paymentMethodNameSnapshot || payment.paymentMethod)}</td><td>${moneyText(payment.amountCents)}</td>${show('showChange') ? '<td>¥0.00</td>' : ''}</tr>`).join('') : '';
  const paymentHeader = show('showChange') ? '<th>找零</th>' : '';
  const member = show('showMember') && order.memberName ? `<p>会员：${receiptEscape(order.memberName)}${show('showMemberPhone') && order.memberPhone ? ` ${receiptEscape(order.memberPhone)}` : ''}</p>` : '';
  const balance = show('showBalance') && order.memberName ? `<p>会员余额：${moneyText(order.memberBalanceCents)}</p>` : '';
  const orderNumbers = show('showOrderNumbers') ? `<p>消费单号：${receiptEscape(order.orderNo)}</p><p>结算单号：${receiptEscape(order.settlementNo || '—')}</p>` : '';
  const content = `<section class="browser-receipt"><header>${show('showStoreName') ? `<h1>${receiptEscape(receiptTitle)}</h1>` : ''}${show('showStoreName') && receiptTitle !== setting.storeName ? `<p>${receiptEscape(setting.storeName)}</p>` : ''}${optional(show('showStoreAddress'), setting.storeAddress)}${optional(show('showStorePhone'), setting.storePhone)}${optional(show('showHeader'), setting.headerNote)}</header><div class="dash"></div>${orderNumbers}${member}${show('showRoom') ? `<p class="room-line"><b>房：${receiptEscape(room?.roomName || room?.roomCode || '—')}</b>${show('showServiceArea') ? '<span>服务区：—</span>' : ''}</p>` : ''}${itemSection}<div class="subtotal">${show('showSubtotal') ? `<span>消费：${moneyText(subtotal)}</span><span>小计：${moneyText(subtotal)}</span>` : ''}</div>${show('showBeforeDiscount') || show('showDiscount') ? '<div class="dash"></div>' : ''}<div class="summary">${show('showBeforeDiscount') ? `<span>折前金额：${moneyText(order.receivableCents || subtotal)}</span>` : ''}${show('showDiscount') ? `<span>折扣金额：${moneyText(Math.max(0, Number(order.receivableCents || subtotal) - Number(order.paidCents || 0)))}</span>` : ''}</div>${show('showReceivable') ? `<div class="dash"></div><div class="receivable">应收：${moneyText(order.paidCents)}</div>` : ''}${show('showPayment') ? `<div class="dash"></div><table class="payment-table"><thead><tr><th>收款方式</th><th>收款</th>${paymentHeader}</tr></thead><tbody>${paymentRows}</tbody></table>` : ''}${balance}<div class="dash"></div><div class="metadata">${show('showCashier') || show('showPrintCopies') ? `<p>${show('showCashier') ? `收银员：${receiptEscape(order.cashierNameSnapshot || '—')}` : ''}${show('showPrintCopies') ? `<span>打印次数：${roomTransferEscape(setting.copies || 1)}</span>` : ''}</p>` : ''}${show('showPrintedAt') ? `<p>打印时间：${timeText(new Date())}</p>` : ''}${show('showCreatedAt') ? `<p>开单时间：${timeText(order.createdAt)}</p>` : ''}${show('showSettledAt') ? `<p>结算时间：${timeText(order.settledAt)}</p>` : ''}</div>${optional(show('showFooter'), setting.footerNote)}</section>`;
  const copies = Array.from({ length: setting.copies || 1 }, () => content).join('');
  const popup = openedWindow || window.open('', 'massage-receipt', 'popup,width=480,height=720');
  if (!popup) throw new Error('PRINT_WINDOW_BLOCKED');
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>消费小票</title><style>@page{size:${roomTransferEscape(setting.paperWidthMm)}mm auto;margin:${roomTransferEscape(setting.marginMm)}mm}*{box-sizing:border-box}body{margin:0;color:#000;font-family:"Microsoft YaHei",sans-serif;font-size:${roomTransferEscape(setting.fontSizePx)}px;line-height:1.4}.browser-receipt{width:100%;max-width:${Math.max(20, Number(setting.paperWidthMm) - Number(setting.marginMm || 0) * 2)}mm;page-break-after:always}.browser-receipt:last-child{page-break-after:auto}header{text-align:center;padding:2px 0 5px}header h1{margin:0;font-size:1.35em}header p,.browser-receipt p{margin:2px 0}.dash{height:1px;margin:6px 0;border-top:1px dashed #000}.room-line{display:flex;justify-content:space-between;gap:6px}.room-line span{white-space:nowrap}.item-table,.payment-table{width:100%;border-collapse:collapse;table-layout:fixed}.item-table th,.item-table td,.payment-table th,.payment-table td{padding:3px 1px;vertical-align:top;text-align:left;overflow-wrap:anywhere}.item-table th{font-weight:700;white-space:nowrap}.item-table td strong,.item-table td small{display:block}.item-table td small{margin-top:1px;color:#333}.item-table .col-index{width:7%;text-align:center}.item-table .col-project{width:34%}.item-table .col-duration{width:12%;text-align:center;white-space:nowrap}.item-table .col-quantity{width:9%;text-align:center;white-space:nowrap}.item-table .col-unit,.item-table .col-amount{width:19%;text-align:right;white-space:nowrap;overflow-wrap:normal}.compact-items{display:grid;gap:5px}.compact-item{padding:3px 0;border-bottom:1px dotted #999}.compact-title{display:flex;justify-content:space-between;gap:5px}.compact-title strong{min-width:0;overflow-wrap:anywhere}.compact-title b,.compact-price{white-space:nowrap}.compact-sub,.compact-meta,.compact-price{font-size:.92em;color:#333}.compact-meta{min-height:1.2em}.subtotal,.summary{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.summary span{white-space:nowrap}.receivable{text-align:right;font-size:1.4em;font-weight:800}.payment-table th,.payment-table td{padding:3px 1px}.payment-table th:nth-child(n+2),.payment-table td:nth-child(n+2){text-align:right;white-space:nowrap}.metadata p{display:flex;justify-content:space-between;gap:4px}.metadata span{white-space:nowrap}footer{margin-top:7px;text-align:center}</style></head><body>${copies}</body></html>`);
  popup.document.close();
  window.setTimeout(() => { popup.focus(); popup.print(); }, 240);
}

async function printOrder(orderDetail, openedWindow = null) {
  const { text, setting } = await localReceiptTextByOptions(orderDetail);
  if (localPrintBridgeOnline || await refreshLocalPrintBridge()) {
    const response = await fetch('http://127.0.0.1:9178/print', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ text, paperWidthMm:setting.paperWidthMm, fontSizePx:setting.fontSizePx, copies:setting.copies }) });
    if (response.ok) { if (openedWindow) openedWindow.close(); toast('小票已发送到本机打印机'); return; }
    localPrintBridgeOnline = false;
  }
  return printBrowserReceiptByOptions(orderDetail, openedWindow);
}

async function loadManagedRooms() {
  const response = await fetch('http://localhost:8080/api/v1/rooms', { headers: storeContextHeaders() });
  if (!response.ok) throw new Error(response.status);
  managedRooms = await response.json();
  document.querySelector('#room-total').textContent = `${managedRooms.length} 间房间`;
  document.querySelector('#room-records').innerHTML = managedRooms.map(room => `<tr><td>${roomTransferEscape(room.code)}</td><td><b>${roomTransferEscape(room.name)}</b></td><td>${roomTransferEscape(room.roomType)}</td><td>${roomTransferEscape(room.bedCount)}</td><td><span class="record-type ${room.active ? 'order' : 'consumption'}">${room.active ? '启用' : '已删除'}</span></td><td class="align-right">${room.active ? `<button class="record-delete edit-technician" data-room-edit="${roomTransferEscape(room.id)}">编辑</button><button class="record-delete" data-room-active="${roomTransferEscape(room.id)}" data-active="true">删除</button>` : '<span class="muted-cell">—</span>'}</td></tr>`).join('');
}

function openRoomDialog(room) {
  editingRoomId = room?.id || null;
  const form = document.querySelector('#room-form'); form.reset();
  form.code.value = room?.code || ''; form.name.value = room?.name || ''; form.roomType.value = room?.roomType || 'STANDARD'; form.bedCount.value = room?.bedCount || 1;
  document.querySelector('#room-dialog').showModal();
}

function openTechnicianDialog(technician) {
  editingTechnicianId = technician?.id || null;
  const form = document.querySelector('#technician-form');
  form.reset();
  document.querySelector('#technician-dialog-title').textContent = technician ? '编辑技师' : '新增技师';
  form.code.value = technician?.code || '';
  form.name.value = technician?.name || '';
  form.phone.value = technician?.phone || '';
  form.queueOrder.value = technician?.queueOrder || managedTechnicians.length + 1;
  document.querySelector('#technician-dialog').showModal();
}

function renderOrder() {
  const list = document.querySelector('#order-lines');
  const correctionBanner = orderCorrectionContext ? `<div class="order-line order-correction-banner"><span><b>正在修正 ${memberBusinessEscape(orderCorrectionContext.originalOrderNo)}</b><small>${memberBusinessEscape(orderCorrectionContext.reason)}</small></span><button type="button" data-cancel-order-correction>取消修正</button></div>` : '';
  list.innerHTML = correctionBanner + (state.orderItems.length ? state.orderItems.map(item => `<div class="order-line"><span><b>${memberBusinessEscape(item.name)}</b><small>${memberBusinessEscape(item.duration)}${item.manualService ? roomTransferEscape(` · ${clockTypeLabels[item.manualService.clockType] || item.manualService.clockType} · ${item.manualService.technicians.length} 位技师`) : ''}</small></span><span><b>${money(item.price)}</b><button data-remove="${roomTransferEscape(item.lineId)}">移除</button></span></div>`).join('') : '<p class="empty-state">请选择服务项目</p>');
  const review = document.querySelector('#settlement-order-review-list');
  if (review) review.innerHTML = state.orderItems.length ? state.orderItems.map(item => `<article><span><b>${memberBusinessEscape(item.name)}</b><small>${memberBusinessEscape(item.roomCode ? `${item.roomCode} 房 · ${item.serviceNo || ''}` : item.duration)}</small></span><strong>${money(item.price)}</strong></article>`).join('') : '<p class="empty-state">尚未选择待结算服务</p>';
  const total = state.orderItems.reduce((sum, item) => sum + item.price, 0);
  document.querySelector('#order-total').textContent = money(total);
  document.querySelector('#settlement-total').textContent = total.toFixed(2);
  document.querySelector('#new-order').disabled = !frontdeskOperationalReady;
  document.querySelector('#settle-order').disabled = !frontdeskOperationalReady || total === 0;
  const selectedSessionItems=state.orderItems.filter(item=>item.serviceSessionId);const selectedRoom=selectedSessionItems.find(item=>item.roomCode)?.roomCode;document.querySelector('#order-number').textContent=orderCorrectionContext?`修正 ${orderCorrectionContext.originalOrderNo}`:state.orderItems.length?(selectedRoom?`${selectedRoom} 房 · ${state.orderItems.length} 项待结算`:`${state.orderItems.length} 项待结算`):'待开单';
  renderPendingServiceSessions();
}

function renderPendingServiceSessions() {
  const list = document.querySelector('#pending-service-list');
  if (!list) return;
  const keyword = document.querySelector('#pending-service-search')?.value.trim().toLowerCase() || '';
  const sourceSessions = singleRoomSettlementRoomId ? singleRoomSettlementSessions : state.pendingServiceSessions;
  const sessions = sourceSessions
    .filter(session => !singleRoomSettlementRoomId || String(session.roomId) === String(singleRoomSettlementRoomId))
    .filter(session => !keyword || `${session.roomCode || ''} ${session.serviceNo || ''} ${session.serviceNameSnapshot || ''} ${session.technicianName || ''}`.toLowerCase().includes(keyword));
  list.innerHTML = sessions.map(session => {
    const selected = state.orderItems.some(item => item.serviceSessionId === session.id);
  const clockType = clockTypeLabels[session.clockType] || session.clockType;
    const extension = session.extensionSummary ? ` · 加钟：${session.extensionSummary}` : '';
    return `<div class="pending-service-row"><button class="pending-service-item" type="button" data-pending-service="${roomTransferEscape(session.id)}" ${selected ? 'disabled' : ''}><span><b>${memberBusinessEscape(session.serviceNameSnapshot)}</b><small>${memberBusinessEscape(session.serviceNo || '')} · ${roomTransferEscape(clockType)} · ${memberBusinessEscape(session.technicianName)} · ${memberBusinessEscape(session.roomCode)} 房 · ${roomTransferEscape(session.plannedDurationMinutes)} 分钟${memberBusinessEscape(extension)}</small></span><em>${selected ? '已加入' : money(session.servicePriceCents / 100)}</em></button><button class="pending-service-void" type="button" data-void-service="${roomTransferEscape(session.id)}" title="作废未结算服务" aria-label="作废 ${memberBusinessEscape(session.serviceNameSnapshot)}">作废</button></div>`;
  }).join('') || `<p class="pending-service-empty">${keyword ? '没有匹配的待结算服务' : '暂无待结算服务'}</p>`;
}

async function responseMessage(response, fallback) {
  try {
    const body = await response.json();
    return body.detail || body.message || body.error || fallback;
  } catch {
    return fallback;
  }
}

let pendingServiceVoidId = null;

function ensurePendingServiceVoidDialog() {
  if (document.querySelector('#pending-service-void-dialog')) return;
  document.body.insertAdjacentHTML('beforeend', '<dialog id="pending-service-void-dialog"><form id="pending-service-void-form" class="dialog-card pending-service-void-card"><div class="dialog-heading"><div><p class="eyebrow">异常订单处理</p><h2>作废未结算服务</h2></div><button class="icon-button" id="close-pending-service-void" type="button" aria-label="关闭">×</button></div><div class="pending-service-void-summary" id="pending-service-void-summary"></div><p class="pending-service-void-warning">作废后不计入营业额和技师提成，操作会永久保留在审计记录中。</p><label class="pending-service-void-reason">作废原因<textarea name="reason" rows="3" maxlength="240" required placeholder="例如：系统测试订单、重复派单或录入错误"></textarea></label><div class="dialog-actions"><button class="button secondary" id="cancel-pending-service-void" type="button">取消</button><button class="button danger" type="submit">确认作废</button></div></form></dialog>');
  const close = () => { pendingServiceVoidId = null; document.querySelector('#pending-service-void-dialog').close(); };
  document.querySelector('#close-pending-service-void').addEventListener('click', close);
  document.querySelector('#cancel-pending-service-void').addEventListener('click', close);
  document.querySelector('#pending-service-void-form').addEventListener('submit', submitPendingServiceVoid);
}

function openPendingServiceVoid(sessionId) {
  const session = state.pendingServiceSessions.find(item => item.id === sessionId);
  if (!session) return;
  if (state.orderItems.some(item => item.serviceSessionId === sessionId)) return toast('请先从当前订单移除该服务');
  ensurePendingServiceVoidDialog();
  pendingServiceVoidId = sessionId;
  document.querySelector('#pending-service-void-summary').innerHTML = `<span><b>${memberBusinessEscape(session.roomCode)} 房 · ${memberBusinessEscape(session.serviceNameSnapshot)}</b><small>${memberBusinessEscape(session.technicianName)} · ${roomTransferEscape(session.plannedDurationMinutes)} 分钟 · ${roomTransferEscape(session.businessDate || '当前营业日')}</small></span><strong>${money(Number(session.servicePriceCents || 0) / 100)}</strong>`;
  document.querySelector('#pending-service-void-form').reason.value = '';
  document.querySelector('#pending-service-void-dialog').showModal();
}

async function submitPendingServiceVoid(event) {
  event.preventDefault();
  const sessionId = pendingServiceVoidId;
  const reason = String(new FormData(event.currentTarget).get('reason') || '').trim();
  if (!sessionId) return;
  if (!reason) return toast('作废原因不能为空');
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const response = await fetch(`http://localhost:8080/api/v1/service-sessions/${sessionId}/void`, {
      method: 'POST', headers: storeContextHeaders(true), body: JSON.stringify({ reason })
    });
    if (!response.ok) return toast(await responseMessage(response, '作废失败，请刷新订单状态后重试'));
    state.orderItems = state.orderItems.filter(item => item.serviceSessionId !== sessionId);
    pendingServiceVoidId = null;
    document.querySelector('#pending-service-void-dialog').close();
    await Promise.all([loadPendingServiceSessions({ silent: true }), loadFoundationData({ silent: true })]);
    renderOrder();
    toast('未结算服务已作废，记录已保存');
  } catch {
    toast('作废服务连接失败，请稍后重试');
  } finally {
    submit.disabled = false;
  }
}

async function loadPendingServiceSessions({ silent = false, roomId = null, updateState = true } = {}) {
  const query = roomId ? `?roomId=${encodeURIComponent(roomId)}` : '';
  const response = await fetch(`http://localhost:8080/api/v1/sales-orders/pending-service-sessions${query}`, { headers: storeContextHeaders() });
  if (!response.ok) { if (!silent) toast('待结算服务加载失败'); return false; }
  const sessions = await response.json();
  if (updateState) {
    state.pendingServiceSessions = sessions;
    renderPendingServiceSessions();
  }
  if (updateState) renderRooms();
  return sessions;
}

function addPendingServiceToOrder(sessionId) {
  const sourceSessions = singleRoomSettlementRoomId ? singleRoomSettlementSessions : state.pendingServiceSessions;
  const session = sourceSessions.find(item => item.id === sessionId);
  if (!session || state.orderItems.some(item => item.serviceSessionId === session.id)) return;
  if (singleRoomSettlementRoomId && String(session.roomId) !== String(singleRoomSettlementRoomId)) return toast('当前为单房结算，不能加入其他房间服务');
  const selectedRoom = state.orderItems.find(item => item.serviceSessionId)?.roomCode;
  if (selectedRoom && selectedRoom !== session.roomCode) return toast(`单房结算已选择 ${selectedRoom} 房；多个房间请使用多房结算`);
  const extension = session.extensionSummary ? `（加钟：${session.extensionSummary}）` : '';
  state.orderItems.push({ id: session.serviceItemId, serviceSessionId: session.id, serviceNo: session.serviceNo, roomCode: session.roomCode, name: `${session.serviceNameSnapshot}${extension}`, duration: `${session.plannedDurationMinutes} 分钟`, price: session.servicePriceCents / 100, lineId: `session-${session.id}` });
  renderOrder();
  toast(`${session.serviceNameSnapshot} 已加入订单`);
}

function renderMemberCard() {
  const member = state.members.find(item => item.id === state.selectedMemberId);
  if (!member) { document.querySelector('#order-member-avatar').textContent = '会'; document.querySelector('#order-member-name').textContent = '请选择会员'; document.querySelector('#order-member-meta').textContent = '余额支付前需要选择真实会员'; renderSettlementMember(); return; }
  document.querySelector('#order-member-avatar').textContent = member.name.slice(0, 1);
  document.querySelector('#order-member-name').textContent = member.name;
  document.querySelector('#order-member-meta').textContent = `${member.phone}${member.code ? ` · ${member.code}` : ''} · ${member.level}`;
  renderSettlementMember();
}

function renderSettlementMember() {
  const name = document.querySelector('#settlement-member-name');
  const meta = document.querySelector('#settlement-member-meta');
  if (!name || !meta) return;
  const member = state.members.find(item => item.id === state.selectedMemberId);
  name.textContent = member?.name || '散客';
  meta.textContent = member ? `${member.phone}${member.code ? ` · ${member.code}` : ''} · 余额 ${money(member.balance)}` : '非会员结算';
}

async function renderMemberResults() {
  const keyword = document.querySelector('#member-search').value.trim();
  const target = document.querySelector('#member-results');
  target.innerHTML = '<p class="empty-state">正在查询会员</p>';
  try {
    const response = await fetch(`http://localhost:8080/api/v1/members?query=${encodeURIComponent(keyword)}`, { headers: storeContextHeaders() });
    if (!response.ok) throw new Error(response.status);
    const members = (await response.json()).map(member => ({ id:member.id, code:member.code, name:member.name, phone:member.phone, level:'储值会员', balance:Number(member.balanceCents || 0) / 100 }));
    const ids = new Set(members.map(member => member.id));
    state.members = [...members, ...state.members.filter(member => !ids.has(member.id))];
    target.innerHTML = members.map(member => `<button class="member-result" type="button" data-member="${roomTransferEscape(member.id)}"><span class="member-avatar">${memberBusinessEscape(member.name.slice(0, 1))}</span><span><b>${memberBusinessEscape(member.name)}</b><small>${memberBusinessEscape(member.phone)} · ${memberBusinessEscape(member.code || '未生成卡号')}</small></span><em>余额 ${money(member.balance)}</em></button>`).join('') || '<p class="empty-state">没有匹配的会员</p>';
  } catch {
    target.innerHTML = '<p class="empty-state">会员查询失败，请稍后重试</p>';
  }
}

const historicalBackfillClockTypes = [
  ['QUEUE', '排钟'], ['CALL', '点钟'], ['SELECTED', '选钟'],
  ['EXTENSION', '加钟'], ['BOOKED_QUEUE', '预定排钟'], ['BOOKED_CALL', '预定点钟']
];

function historicalBackfillDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createHistoricalBackfillLine() {
  const service = state.services[0];
  const technician = state.technicians[0];
  return {
    id: ++historicalBackfillSequence,
    serviceItemId: service?.id || '',
    durationMinutes: Number(service?.durationMinutes || 60),
    clockType: 'QUEUE',
    roomId: state.rooms[0]?.apiId || '',
    technicians: technician ? [{ technicianId: technician.id, allocationBp: 10000 }] : []
  };
}

function rebalanceHistoricalBackfillTechnicians(line) {
  const count = line.technicians.length;
  if (!count) return;
  const base = Math.floor(10000 / count);
  line.technicians.forEach((item, index) => {
    item.allocationBp = base + (index === count - 1 ? 10000 - base * count : 0);
  });
}

const historicalBackfillTechnicianStates = {
  available: '空闲', serving: '服务中', pending: '待接单', accepted: '待服务', reassign: '待重派', off: '休息 / 下班'
};

function historicalBackfillRoomLabel(room) {
  const labels = { idle: '空闲', serving: '服务中', pending: '待接单', 'pending-payment': '待付款', cleaning: '清洁中', reserved: '已预留' };
  return `${room.id} · ${labels[room.status] || room.label || room.status}`;
}

function renderHistoricalBackfillLines() {
  const target = document.querySelector('#historical-backfill-line-list');
  if (!target) return;
  target.innerHTML = historicalBackfillLines.map((line, index) => {
    const services = state.services.map(service => `<option value="${memberBusinessEscape(service.id)}" ${String(service.id) === String(line.serviceItemId) ? 'selected' : ''}>${memberBusinessEscape(service.name)} · ${money(service.price)}</option>`).join('');
    const rooms = state.rooms.map(room => `<option value="${memberBusinessEscape(room.apiId || '')}" ${String(room.apiId) === String(line.roomId) ? 'selected' : ''}>${memberBusinessEscape(historicalBackfillRoomLabel(room))}</option>`).join('');
    const clockTypes = historicalBackfillClockTypes.map(([value, label]) => `<option value="${value}" ${value === line.clockType ? 'selected' : ''}>${label}</option>`).join('');
    const allocations = new Map(line.technicians.map(item => [String(item.technicianId), item.allocationBp]));
    const technicians = state.technicians.map(technician => {
      const allocation = allocations.get(String(technician.id));
      const checked = allocation != null;
      const capped = !checked && line.technicians.length >= 4;
      return `<label class="historical-backfill-technician ${checked ? 'selected' : ''}"><input type="checkbox" data-historical-technician="${memberBusinessEscape(technician.id)}" ${checked ? 'checked' : ''} ${capped ? 'disabled' : ''}><span class="historical-backfill-technician-info"><b>${memberBusinessEscape(technician.name)}</b><small>工号 ${memberBusinessEscape(technician.code || '未设置')} · ${roomTransferEscape(historicalBackfillTechnicianStates[technician.state] || '状态未知')}</small></span><span class="historical-backfill-allocation"><input type="number" min="0.01" max="100" step="0.01" value="${checked ? (allocation / 100).toFixed(2) : '0.00'}" data-historical-allocation="${memberBusinessEscape(technician.id)}" ${checked ? '' : 'disabled'}><em>%</em></span></label>`;
    }).join('');
    const service = state.services.find(item => String(item.id) === String(line.serviceItemId));
    return `<article class="historical-backfill-line" data-historical-line="${roomTransferEscape(line.id)}"><div class="historical-backfill-line-heading"><b>项目 ${index + 1}</b><button class="icon-button" type="button" data-historical-remove-line="${roomTransferEscape(line.id)}" title="移除项目" aria-label="移除项目" ${historicalBackfillLines.length === 1 ? 'disabled' : ''}>×</button></div><div class="historical-backfill-line-fields"><label class="historical-backfill-field historical-backfill-service-field">服务项目<select data-historical-service required>${services}</select></label><label class="historical-backfill-field historical-backfill-clock-field">钟类<select data-historical-clock-type>${clockTypes}</select></label><label class="historical-backfill-field historical-backfill-duration-field">服务时长（分钟）<input data-historical-duration type="number" min="15" max="360" step="5" value="${roomTransferEscape(line.durationMinutes)}" required></label><label class="historical-backfill-field historical-backfill-room-field">房间状态<select data-historical-room><option value="">不关联房间</option>${rooms}</select></label><div class="historical-backfill-field historical-backfill-line-total"><span>项目金额</span><strong>${money(Number(service?.price || 0))}</strong></div></div><div class="historical-backfill-technicians"><div class="historical-backfill-technicians-heading"><b>技师业绩分配</b><small>合计必须为 100%</small></div><div class="historical-backfill-technician-list">${technicians || '<p class="table-empty">当前门店没有可用技师</p>'}</div></div></article>`;
  }).join('');
  renderHistoricalBackfillSummary(true);
}

function historicalBackfillReceivableCents() {
  return historicalBackfillLines.reduce((sum, line) => {
    const service = state.services.find(item => String(item.id) === String(line.serviceItemId));
    return sum + Math.round(Number(service?.price || 0) * 100);
  }, 0);
}

function renderHistoricalBackfillPayments() {
  const target = document.querySelector('#historical-backfill-payment-list');
  if (!target) return;
  target.innerHTML = historicalBackfillPayments.map(payment => {
    const methods = historicalBackfillPaymentMethods.map(method => `<option value="${memberBusinessEscape(method.code)}" ${method.code === payment.method ? 'selected' : ''}>${memberBusinessEscape(method.name)}</option>`).join('');
    return `<div class="historical-backfill-payment" data-historical-payment="${roomTransferEscape(payment.id)}"><label class="historical-backfill-payment-method"><span>支付方式</span><select data-historical-payment-method aria-label="支付方式">${methods}</select></label><label class="historical-backfill-payment-amount"><span>金额（元）</span><span class="historical-backfill-currency-input"><i>¥</i><input data-historical-payment-amount type="number" min="0" step="0.01" value="${(payment.amountCents / 100).toFixed(2)}" aria-label="支付金额"></span></label><button class="icon-button historical-backfill-payment-remove" type="button" data-historical-remove-payment="${roomTransferEscape(payment.id)}" title="移除支付方式" aria-label="移除支付方式" ${historicalBackfillPayments.length === 1 ? 'disabled' : ''}>×</button></div>`;
  }).join('');
  renderHistoricalBackfillSummary(false);
}

function renderHistoricalBackfillSummary(resetAmount) {
  const receivable = historicalBackfillReceivableCents();
  const amount = document.querySelector('#historical-backfill-amount');
  document.querySelector('#historical-backfill-receivable').textContent = money(receivable / 100);
  if (resetAmount) {
    amount.value = (receivable / 100).toFixed(2);
    if (historicalBackfillPayments.length === 1) historicalBackfillPayments[0].amountCents = receivable;
  }
  const settlement = Math.round(Number(amount.value || 0) * 100);
  const paid = historicalBackfillPayments.reduce((sum, payment) => sum + Number(payment.amountCents || 0), 0);
  document.querySelector('#historical-backfill-paid').textContent = money(paid / 100);
  document.querySelector('#historical-backfill-remaining').textContent = money((settlement - paid) / 100);
  const singleAmount = document.querySelector('[data-historical-payment-amount]');
  if (resetAmount && historicalBackfillPayments.length === 1 && singleAmount) singleAmount.value = (receivable / 100).toFixed(2);
}

function renderHistoricalBackfillMember() {
  document.querySelector('#historical-backfill-member-name').textContent = historicalBackfillMember?.name || '散客';
  document.querySelector('#historical-backfill-member-meta').textContent = historicalBackfillMember
    ? `${historicalBackfillMember.phone || '未留手机号'} · ${historicalBackfillMember.code || '未生成卡号'} · 余额 ${money(Number(historicalBackfillMember.balanceCents || 0) / 100)}`
    : '未关联会员';
}

async function searchHistoricalBackfillMembers() {
  const query = document.querySelector('#historical-backfill-member-search').value.trim();
  const target = document.querySelector('#historical-backfill-member-results');
  if (!query) { target.innerHTML = ''; return; }
  target.innerHTML = '<p class="empty-state">正在查询会员</p>';
  try {
    const response = await fetch(`http://localhost:8080/api/v1/members?query=${encodeURIComponent(query)}`, { headers: storeContextHeaders() });
    if (!response.ok) { target.innerHTML = '<p class="empty-state">会员查询失败</p>'; return; }
    const members = await response.json();
    target.innerHTML = members.map(member => `<button class="member-result" type="button" data-historical-member="${memberBusinessEscape(member.id)}"><span class="member-avatar">${memberBusinessEscape(member.name.slice(0, 1))}</span><span><b>${memberBusinessEscape(member.name)}</b><small>${memberBusinessEscape(member.phone || '')} · ${memberBusinessEscape(member.code || '未生成卡号')}</small></span><em>余额 ${money(Number(member.balanceCents || 0) / 100)}</em></button>`).join('') || '<p class="empty-state">没有匹配的会员</p>';
    target.querySelectorAll('[data-historical-member]').forEach(button => button.addEventListener('click', () => {
      historicalBackfillMember = members.find(member => String(member.id) === String(button.dataset.historicalMember)) || null;
      target.innerHTML = '';
      document.querySelector('#historical-backfill-member-search').value = '';
      renderHistoricalBackfillMember();
    }));
  } catch {
    target.innerHTML = '<p class="empty-state">会员查询失败，请检查服务连接</p>';
  }
}

async function openHistoricalBackfill() {
  if (!hasAdminPermission('HISTORICAL_ORDER_CREATE')) return toast('当前账号没有历史补单权限');
  try {
    if ((!state.services.length || !state.technicians.length) && !await loadFoundationData({ silent: true })) return toast('项目、房间或技师状态加载失败');
    const response = await fetch('http://localhost:8080/api/v1/payment-methods', { headers: storeContextHeaders() });
    if (!response.ok) return toast('收款方式加载失败');
    historicalBackfillPaymentMethods = (await response.json()).filter(item => item.active !== false);
    if (!historicalBackfillPaymentMethods.length) return toast('请先启用至少一种收款方式');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = document.querySelector('#historical-backfill-date');
    date.max = historicalBackfillDateValue(new Date());
    date.value = historicalBackfillDateValue(yesterday);
    historicalBackfillMember = null;
    historicalBackfillLines = [createHistoricalBackfillLine()];
    historicalBackfillPayments = [{ id: ++historicalBackfillSequence, method: historicalBackfillPaymentMethods[0].code, amountCents: 0 }];
    document.querySelector('#historical-backfill-member-search').value = '';
    document.querySelector('#historical-backfill-member-results').innerHTML = '';
    renderHistoricalBackfillMember();
    renderHistoricalBackfillLines();
    renderHistoricalBackfillPayments();
    document.querySelector('#historical-backfill-dialog').showModal();
  } catch {
    toast('历史补单资料加载失败，请检查服务连接');
  }
}

function renderFrontdeskHistoricalBackfills() {
  const target = document.querySelector('#frontdesk-historical-backfill-records');
  if (!target) return;
  const date = document.querySelector('#frontdesk-historical-backfill-filter-date').value;
  const operator = document.querySelector('#frontdesk-historical-backfill-filter-operator').value.trim().toLowerCase();
  const rows = frontdeskHistoricalBackfillRows.filter(row => (!date || row.backfillDate === date) && (!operator || String(row.backfillByName || '').toLowerCase().includes(operator)));
  target.innerHTML = rows.map(row => `<tr><td>${memberBusinessEscape(row.backfillDate || '—')}</td><td><b>${memberBusinessEscape(row.orderNo || '—')}</b></td><td>${memberBusinessEscape(row.settlementNo || '—')}</td><td>${memberBusinessEscape(row.paymentMethods || '—')}</td><td>${memberBusinessEscape(row.backfillByName || '—')}<small class="muted-cell">${row.backfillAt ? new Date(row.backfillAt).toLocaleString('zh-CN') : ''}</small></td><td class="amount-cell">${money(Number(row.paidCents || 0) / 100)}</td><td><span class="record-type ${row.refundStatus === 'NONE' ? 'order' : 'refund-state'}">${row.status === 'CANCELLED' ? '已作废' : roomTransferEscape(refundStatusLabel[row.refundStatus] || '已结算')}</span></td><td class="align-right"><button class="record-delete edit-technician" type="button" data-historical-order-detail="${memberBusinessEscape(row.orderId)}">查看/退款</button></td></tr>`).join('') || '<tr><td colspan="8" class="table-empty">暂无匹配的历史补单记录</td></tr>';
}

async function loadFrontdeskHistoricalBackfills() {
  if (!hasAdminPermission('HISTORICAL_ORDER_CREATE')) return;
  const target = document.querySelector('#frontdesk-historical-backfill-records');
  try {
    const response = await fetch('http://localhost:8080/api/v1/sales-orders?historicalBackfill=true&page=0&size=200', { headers: storeContextHeaders() });
    if (!response.ok) { target.innerHTML = '<tr><td colspan="8" class="table-empty">历史补单记录加载失败</td></tr>'; return; }
    frontdeskHistoricalBackfillRows = (await response.json()).map(row => ({ ...row, orderId:row.id, paymentMethods:'详情中查看' }));
    renderFrontdeskHistoricalBackfills();
  } catch {
    target.innerHTML = '<tr><td colspan="8" class="table-empty">历史补单记录加载失败，请检查服务连接</td></tr>';
  }
}

function historicalBackfillOperationId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function submitHistoricalBackfill(event) {
  event.preventDefault();
  const date = document.querySelector('#historical-backfill-date').value;
  if (!date || date > historicalBackfillDateValue(new Date())) return toast('补单日期不能晚于今天');
  const invalidLine = historicalBackfillLines.find(line => !line.serviceItemId || !Number.isFinite(Number(line.durationMinutes)) || Number(line.durationMinutes) < 15 || Number(line.durationMinutes) > 360 || !line.technicians.length || line.technicians.length > 4 || line.technicians.reduce((sum, item) => sum + Number(item.allocationBp || 0), 0) !== 10000);
  if (invalidLine) return toast('请检查每个项目的服务时长及技师分配，比例合计必须为 100%');
  const receivable = historicalBackfillReceivableCents();
  const settlement = Math.round(Number(document.querySelector('#historical-backfill-amount').value || 0) * 100);
  const payments = historicalBackfillPayments.filter(payment => Number(payment.amountCents) > 0).map(payment => ({ method: payment.method, amountCents: Number(payment.amountCents) }));
  if (settlement < 1 || settlement > receivable) return toast('实收金额必须大于 0 且不能超过项目合计');
  if (!payments.length || payments.reduce((sum, payment) => sum + payment.amountCents, 0) !== settlement) return toast('各支付方式金额合计必须等于实收金额');
  const balanceTotal = payments.filter(payment => historicalBackfillPaymentMethods.find(method => method.code === payment.method)?.methodKind === 'MEMBER_BALANCE').reduce((sum, payment) => sum + payment.amountCents, 0);
  if (balanceTotal && !historicalBackfillMember) return toast('使用会员余额支付前必须选择会员');
  if (balanceTotal > Number(historicalBackfillMember?.balanceCents || 0)) return toast('会员余额不足，请调整会员余额金额或补充其他收款方式');
  if (!window.confirm(`确认补录 ${date} 的历史订单，实收 ${money(settlement / 100)} 吗？`)) return;
  const payload = {
    backfillDate: date,
    memberId: historicalBackfillMember?.id || null,
    lines: historicalBackfillLines.map(line => ({
      serviceItemId: line.serviceItemId,
      technicians: line.technicians.map(item => ({ technicianId: item.technicianId, allocationBp: item.allocationBp })),
      durationMinutes: Number(line.durationMinutes),
      clockType: line.clockType,
      roomId: line.roomId || null
    })),
    payments,
    settlementAmountCents: settlement,
    confirmed: true
  };
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  let result;
  try {
    const response = await fetch('http://localhost:8080/api/v1/sales-orders/historical-backfill', { method: 'POST', headers: { ...storeContextHeaders(true), 'X-Offline-Operation-Id': historicalBackfillOperationId() }, body: JSON.stringify(payload) });
    if (!response.ok) return toast(await responseMessage(response, '历史补单提交失败'));
    result = await response.json();
    document.querySelector('#historical-backfill-dialog').close();
  } catch {
    toast('历史补单提交失败，请检查服务连接后重试');
    return;
  } finally {
    submit.disabled = false;
  }
  const refreshResults = await Promise.allSettled([loadFrontdeskHistoricalBackfills(), loadSalesOrders({ resetPage: true }), loadDailyReport(), loadOrderCommissionRecords()]);
  toast(refreshResults.some(item => item.status === 'rejected') ? `历史补单 ${result.orderNo} 已完成，部分列表刷新失败，请手动刷新` : `历史补单 ${result.orderNo} 已完成`);
}

document.querySelector('#management-view').insertAdjacentHTML('beforeend','<section class="panel admin-table-panel service-record-panel" id="order-history-panel"><div class="admin-toolbar"><div><h2>订单查询</h2><p>前台已结算订单，可按订单、会员、日期和支付方式查询</p></div><div class="order-history-filters"><label class="search-field"><span>⌕</span><input id="order-search" placeholder="订单号、结算单号、会员或手机号" /></label><input id="order-history-from" type="date" aria-label="订单开始日期" title="开始日期"><span>至</span><input id="order-history-to" type="date" aria-label="订单结束日期" title="结束日期"><select id="order-history-payment" aria-label="支付方式"><option value="">全部支付方式</option></select><select id="order-history-status" aria-label="订单状态"><option value="">全部状态</option><option value="SETTLED">已结算</option><option value="REFUNDED">已退款</option><option value="CANCELLED">已作废</option></select><button class="icon-button" type="button" id="reset-order-history" title="清空筛选" aria-label="清空筛选">↺</button></div></div><div class="ledger-table-wrap"><table><thead><tr><th>订单号</th><th>结算单号</th><th>会员</th><th>应收</th><th>实收</th><th>结算时间</th><th>状态</th><th></th></tr></thead><tbody id="order-records"><tr><td colspan="8" class="table-empty">打开经营管理后加载</td></tr></tbody></table></div><div class="order-history-pagination"><span id="order-history-page">第 1 页</span><div><button class="button secondary" type="button" id="order-history-prev" disabled>上一页</button><button class="button secondary" type="button" id="order-history-next" disabled>下一页</button></div></div></section><dialog id="order-detail-dialog"><div class="dialog-card compact order-detail-card"><div class="dialog-heading"><h2>订单明细</h2><button class="icon-button" id="close-order-detail" title="关闭" aria-label="关闭">×</button></div><div id="order-detail-content"></div></div></dialog><dialog id="refund-dialog"><form id="refund-form" class="dialog-card refund-dialog-card"><div class="dialog-heading"><div><p class="eyebrow" id="refund-dialog-eyebrow">订单退款</p><h2 id="refund-dialog-title">创建部分退款</h2></div><button class="icon-button" type="button" id="close-refund-dialog" title="关闭" aria-label="关闭">×</button></div><p class="refund-dialog-note" id="refund-dialog-note">选择退款项目并填写本次退款金额，退款金额将按原支付记录自动分配。</p><div id="refund-draft-lines" class="refund-draft-lines"></div><div class="refund-preview"><div><span id="refund-total-label">本次退款</span><strong id="refund-total">-¥0.00</strong></div><div id="refund-payment-preview" class="refund-payment-preview"></div></div><label class="refund-reason">操作原因<textarea name="reason" maxlength="240" placeholder="请填写退款或红冲原因" required></textarea></label><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-refund">取消</button><button class="button primary" type="submit" id="submit-refund">提交部分退款</button></div></form></dialog>');
const orderHistoryPanel = document.querySelector('#order-history-panel');
const servicePanel = document.querySelector('#management-view #service-session-record-panel');
servicePanel?.before(orderHistoryPanel);
let salesOrders=[];
let activeOrderDetail=null;
let activeRefundContext=null;
let businessCorrectionLine=null;
document.addEventListener('click',event=>{const business=event.target.closest('[data-business-correct-line]');if(business)openBusinessCorrection(business.dataset.businessCorrectLine);});
let orderVoidId=null;
let orderCorrectionContext=null;
let orderCorrectionCandidate=null;

document.body.insertAdjacentHTML('beforeend','<dialog id="business-correction-dialog"><form id="business-correction-form" class="dialog-card business-correction-card"><div class="dialog-heading"><div><p class="eyebrow">订单业务更正</p><h2>修改技师与钟类</h2></div><button class="icon-button" type="button" id="close-business-correction" aria-label="关闭">×</button></div><div class="business-correction-summary" id="business-correction-summary"></div><div class="form-grid"><label class="form-full">服务技师<select name="technicianId" required></select></label><label class="form-full">上钟类型<select name="clockType" required><option value="QUEUE">排钟</option><option value="CALL">点钟</option></select></label><label class="form-full">修改原因<textarea name="reason" rows="3" maxlength="240" required placeholder="例如：前台误选排钟，实际为点钟"></textarea></label></div><p class="business-correction-note">保存后将冲回原技师提成，并按新技师和新钟类重新计算；订单金额与收款方式保持不变。</p><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-business-correction">取消</button><button class="button primary" type="submit">确认修改</button></div></form></dialog>');

function ensureOrderCorrectionDialog(){
  if(document.querySelector('#order-correction-dialog'))return;
  document.body.insertAdjacentHTML('beforeend','<dialog id="order-correction-dialog"><form id="order-correction-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">订单修正</p><h2 id="order-correction-title">重新结算原订单</h2></div><button class="icon-button" type="button" id="close-order-correction" aria-label="关闭">×</button></div><p id="order-correction-summary" class="pending-service-void-summary"></p><p class="pending-service-void-warning">原订单和原支付记录会永久保留；新结算单将记录修正来源和原因。</p><label class="pending-service-void-reason">修正原因<textarea name="reason" rows="3" maxlength="240" required placeholder="例如：会员选择错误、收款方式错误或项目录入错误"></textarea></label><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-order-correction">取消</button><button class="button primary" type="submit">进入修正工作台</button></div></form></dialog>');
  const close=()=>{orderCorrectionCandidate=null;document.querySelector('#order-correction-dialog').close();};
  document.querySelector('#close-order-correction').addEventListener('click',close);
  document.querySelector('#cancel-order-correction').addEventListener('click',close);
  document.querySelector('#order-correction-form').addEventListener('submit',submitOrderCorrection);
}

async function openOrderCorrection(orderId){
  if(!hasAdminPermission('ORDER_REFUND'))return toast('当前账号没有订单修正权限');
  if(!activeOrderDetail||String(activeOrderDetail.detail.order.id)!==String(orderId))await openOrderDetail(orderId);
  const detail=activeOrderDetail?.detail;
  if(!detail)return;
  const order=detail.order;
  const terminal=order.status==='CANCELLED'||order.refundStatus==='FULL';
  if(!terminal&&Number(order.paidCents||0)>0){
    toast('已收款订单需要先完成整单红冲，完成后再重新结算');
    openRefundDialog('FULL_REVERSAL');
    return;
  }
  ensureOrderCorrectionDialog();
  orderCorrectionCandidate=detail;
  document.querySelector('#order-correction-title').textContent=terminal?'重新结算原订单':'作废并修正订单';
  document.querySelector('#order-correction-summary').innerHTML=`<span><b>${memberBusinessEscape(order.orderNo)}</b><small>${roomTransferEscape(detail.lines.length)} 个项目 · ${memberBusinessEscape(order.memberName||'散客')} · 原实收 ${money(Number(order.paidCents||0)/100)}</small></span>`;
  document.querySelector('#order-correction-form').reset();
  document.querySelector('#order-correction-dialog').showModal();
}

async function submitOrderCorrection(event){
  event.preventDefault();
  const detail=orderCorrectionCandidate;
  if(!detail)return;
  const reason=String(new FormData(event.currentTarget).get('reason')||'').trim();
  if(!reason)return toast('修正原因不能为空');
  if(state.orderItems.length&&!window.confirm('当前工作台已有待结算项目，进入修正会替换这些项目。确认继续？'))return;
  const submit=event.currentTarget.querySelector('[type="submit"]');
  submit.disabled=true;
  try{
    const order=detail.order;
    if(order.status!=='CANCELLED'&&order.refundStatus!=='FULL'){
      const response=await fetch(`http://localhost:8080/api/v1/sales-orders/${order.id}/void`,{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({reason})});
      if(!response.ok)return toast(await responseMessage(response,'原订单作废失败，请刷新后重试'));
    }
    const items=[];
    for(const line of detail.lines){
      if(line.serviceSessionId){
        items.push({id:line.serviceItemId,serviceSessionId:line.serviceSessionId,roomCode:line.roomCode,name:line.itemNameSnapshot,duration:`${line.durationMinutes} 分钟`,price:Number(line.lineAmountCents||line.unitPriceCents||0)/100,lineId:`correction-${line.id}`});
        continue;
      }
      const service=state.services.find(item=>String(item.id)===String(line.serviceItemId));
      if(!service)return toast(`项目“${line.itemNameSnapshot}”当前已删除或未生效，请先恢复项目后再修正`);
      items.push({...service,lineId:`correction-${line.id}`});
    }
    if(!items.length)return toast('原订单没有可重新结算的项目');
    orderCorrectionContext={originalOrderId:order.id,originalOrderNo:order.orderNo,reason};
    state.orderItems=items;
    if(order.memberId){
      if(!state.members.some(member=>String(member.id)===String(order.memberId)))state.members.push({id:order.memberId,name:order.memberName||'原订单会员',phone:order.memberPhone||'',code:'',level:'储值会员',balance:Number(order.memberBalanceCents||0)/100});
      state.selectedMemberId=order.memberId;
    }else state.selectedMemberId=null;
    orderCorrectionCandidate=null;
    document.querySelector('#order-correction-dialog').close();
    document.querySelector('#order-detail-dialog').close();
    renderMemberCard();renderOrder();setOrderDrawer(true);
    await Promise.all([loadSalesOrders({resetPage:true}),loadPendingServiceSessions({silent:true})]);
    toast('原订单已载入修正工作台，请核对项目、会员和收款方式后重新结算');
  }finally{submit.disabled=false;}
}

let financialCorrectionOrder=null;
function ensureFinancialCorrectionDialog(){
  if(document.querySelector('#financial-correction-dialog'))return;
  document.body.insertAdjacentHTML('beforeend','<dialog id="financial-correction-dialog"><form id="financial-correction-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">已结算订单</p><h2 id="financial-correction-title">更正收款信息</h2></div><button class="icon-button" type="button" id="close-financial-correction" aria-label="关闭">×</button></div><p id="financial-correction-summary" class="pending-service-void-summary"></p><label>修改后实收金额（元）<input name="settlementAmount" type="number" min="0" step="0.01" required></label><div><b>修改后收款方式</b><div id="financial-correction-payments" class="payment-options"></div><small id="financial-correction-allocation" class="muted-cell"></small></div><label class="pending-service-void-reason">更正原因<textarea name="reason" rows="3" maxlength="240" required placeholder="例如：实际为美团支付，结算时误选微信"></textarea></label><p class="pending-service-void-warning">这里只更正账务归类，不会发起真实退款。会员余额金额变化时，系统会自动补扣或退回差额。</p><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-financial-correction">取消</button><button class="button primary" type="submit">确认更正</button></div></form></dialog>');
  const close=()=>{financialCorrectionOrder=null;document.querySelector('#financial-correction-dialog').close();};
  document.querySelector('#close-financial-correction').addEventListener('click',close);
  document.querySelector('#cancel-financial-correction').addEventListener('click',close);
  document.querySelector('#financial-correction-form').addEventListener('submit',submitFinancialCorrection);
  document.querySelector('#financial-correction-form').addEventListener('input',updateFinancialCorrectionAllocation);
}
function updateFinancialCorrectionAllocation(){
  const form=document.querySelector('#financial-correction-form');if(!form)return;
  const target=Math.round(Math.max(0,Number(form.settlementAmount.value)||0)*100);
  const allocated=[...document.querySelectorAll('[data-financial-payment]')].reduce((sum,input)=>sum+Math.round(Math.max(0,Number(input.value)||0)*100),0);
  const difference=target-allocated;
  document.querySelector('#financial-correction-allocation').textContent=difference===0?`已分配 ${money(allocated/100)}`:`已分配 ${money(allocated/100)}，还差 ${money(Math.abs(difference)/100)}${difference<0?'（超出）':''}`;
}
async function openFinancialCorrection(orderId){
  if(!hasAdminPermission('ORDER_REFUND'))return toast('当前账号没有订单更正权限');
  if(!activeOrderDetail||String(activeOrderDetail.detail.order.id)!==String(orderId))await openOrderDetail(orderId);
  const detail=activeOrderDetail?.detail;if(!detail)return;
  if(detail.order.status!=='SETTLED'||detail.order.refundStatus!=='NONE'||activeOrderDetail.refunds.length)return toast('该订单已有退款、红冲或异常状态，不能直接更正收款');
  try{await loadActivePaymentMethods();}catch{return toast('收款方式加载失败');}
  ensureFinancialCorrectionDialog();financialCorrectionOrder=detail;
  const form=document.querySelector('#financial-correction-form');form.reset();form.settlementAmount.value=(Number(detail.order.paidCents||0)/100).toFixed(2);
  document.querySelector('#financial-correction-title').textContent=`${detail.order.orderNo} · 更正收款`;
  document.querySelector('#financial-correction-summary').innerHTML=`<span><b>原实收 ${money(Number(detail.order.paidCents||0)/100)}</b><small>${memberBusinessEscape(detail.order.memberName||'散客')}${detail.order.memberId?roomTransferEscape(` · 当前会员余额 ${money(Number(detail.order.memberBalanceCents||0)/100)}`):''}</small></span>`;
  document.querySelector('#financial-correction-payments').innerHTML=activePaymentMethods.map(method=>{const amount=detail.payments.filter(payment=>payment.paymentMethod===method.code).reduce((sum,payment)=>sum+Number(payment.amountCents||0),0);return `<label class="payment-option"><span>${memberBusinessEscape(method.name)}</span><input data-financial-payment="${memberBusinessEscape(method.code)}" type="number" min="0" step="0.01" value="${(amount/100).toFixed(2)}"></label>`;}).join('');
  updateFinancialCorrectionAllocation();document.querySelector('#financial-correction-dialog').showModal();
}
async function submitFinancialCorrection(event){
  event.preventDefault();if(!financialCorrectionOrder)return;
  const form=event.currentTarget;const settlementAmountCents=Math.round(Math.max(0,Number(form.settlementAmount.value)||0)*100);
  const payments=[...document.querySelectorAll('[data-financial-payment]')].map(input=>({method:input.dataset.financialPayment,amountCents:Math.round(Math.max(0,Number(input.value)||0)*100)})).filter(payment=>payment.amountCents>0);
  if(payments.reduce((sum,payment)=>sum+payment.amountCents,0)!==settlementAmountCents)return toast('收款方式合计必须等于修改后的实收金额');
  const reason=String(new FormData(form).get('reason')||'').trim();if(!reason)return toast('请填写更正原因');
  if(!window.confirm('确认更正这笔已结算订单的实收金额和收款方式？'))return;
  const submit=form.querySelector('[type="submit"]');submit.disabled=true;
  try{const response=await fetch(`http://localhost:8080/api/v1/sales-orders/${financialCorrectionOrder.order.id}/financial-corrections`,{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({settlementAmountCents,payments,reason,expectedVersion:Number(financialCorrectionOrder.order.financialCorrectionVersion||0)})});if(!response.ok)return toast(await responseMessage(response,'订单收款更正失败'));const orderId=financialCorrectionOrder.order.id;financialCorrectionOrder=null;document.querySelector('#financial-correction-dialog').close();await Promise.all([loadSalesOrders({resetPage:true}),loadMemberCenter(),loadMemberWalletLedger(),loadDailyReport()]);await openOrderDetail(orderId);toast('订单收款信息已更正');}finally{submit.disabled=false;}
}
function ensureOrderVoidDialog(){
  if(document.querySelector('#order-void-dialog'))return;
  document.body.insertAdjacentHTML('beforeend','<dialog id="order-void-dialog"><form id="order-void-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">异常订单处理</p><h2>作废订单</h2></div><button class="icon-button" type="button" id="close-order-void" aria-label="关闭">×</button></div><p id="order-void-summary" class="pending-service-void-summary"></p><p class="pending-service-void-warning">作废只适用于零收款且没有退款记录的异常或测试订单；已有技师业绩会自动生成负数冲销记录，全部操作保留审计。</p><label class="pending-service-void-reason">作废原因<textarea name="reason" rows="3" maxlength="240" required placeholder="例如：系统测试订单、重复结算或录入错误"></textarea></label><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-order-void">取消</button><button class="button danger" type="submit">确认作废</button></div></form></dialog>');
  const close=()=>{orderVoidId=null;document.querySelector('#order-void-dialog').close();};
  document.querySelector('#close-order-void').addEventListener('click',close);
  document.querySelector('#cancel-order-void').addEventListener('click',close);
  document.querySelector('#order-void-form').addEventListener('submit',async event=>{event.preventDefault();if(!orderVoidId)return;const reason=String(new FormData(event.currentTarget).get('reason')||'').trim();if(!reason)return toast('作废原因不能为空');const submit=event.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;try{const response=await fetch(`http://localhost:8080/api/v1/sales-orders/${orderVoidId}/void`,{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({reason})});if(!response.ok)return toast(await responseMessage(response,'订单作废失败，请刷新订单状态后重试'));close();await Promise.all([loadSalesOrders({resetPage:true}),loadRefundManagement()]);if(activeOrderDetail?.detail?.order?.id===orderVoidId)document.querySelector('#order-detail-dialog').close();toast('订单已作废，审计记录已保存');}finally{submit.disabled=false;}});
}
function openOrderVoid(orderId){
  ensureOrderVoidDialog();
  const order=salesOrders.find(item=>String(item.id)===String(orderId))||activeOrderDetail?.detail?.order;
  if(!order)return toast('未找到订单，请刷新后重试');
  orderVoidId=order.id;
  document.querySelector('#order-void-summary').innerHTML=`<span><b>${memberBusinessEscape(order.orderNo)}</b><small>${memberBusinessEscape(order.memberName||'散客')} · 实收 ${money(Number(order.paidCents||0)/100)}</small></span>`;
  document.querySelector('#order-void-form').reset();
  document.querySelector('#order-void-dialog').showModal();
}
document.querySelector('#management-view').insertAdjacentHTML('beforeend','<section class="panel admin-table-panel refund-management-panel"><div class="admin-toolbar"><div><h2>退款与红冲管理</h2><p>独立记录申请、付款确认与负数冲减凭证</p></div><div class="segment-control" id="refund-management-filters"><button type="button" class="selected" data-refund-status="PENDING">待确认</button><button type="button" data-refund-status="COMPLETED">已完成</button><button type="button" data-refund-status="CANCELLED">已取消</button><button type="button" data-refund-status="ALL">全部</button></div></div><div class="ledger-table-wrap"><table><thead><tr><th>退款单号</th><th>类型</th><th>关联订单</th><th>会员</th><th>退款方式</th><th>冲减金额</th><th>申请 / 完成</th><th>状态</th><th class="align-right">操作</th></tr></thead><tbody id="refund-management-records"><tr><td colspan="9" class="table-empty">打开经营管理后加载</td></tr></tbody></table></div></section>');
let refundManagementStatus='PENDING';
document.querySelector('#management-view').insertAdjacentHTML('beforeend','<section class="panel admin-table-panel wallet-ledger-panel"><div class="admin-toolbar"><div><h2>会员资金账本</h2><p>充值、赠送、消费与退款均以独立流水保存</p></div><div class="wallet-ledger-filters"><label class="search-field"><span>⌕</span><input id="wallet-ledger-search" placeholder="会员、手机号或流水备注" /></label><input id="wallet-ledger-from" type="date" title="开始日期" aria-label="开始日期"><span>至</span><input id="wallet-ledger-to" type="date" title="结束日期" aria-label="结束日期"><button class="icon-button" type="button" id="reset-wallet-ledger" title="清空筛选" aria-label="清空筛选">↺</button></div></div><div class="ledger-table-wrap"><table><thead><tr><th>时间</th><th>会员</th><th>交易类型</th><th>变动金额</th><th>变动前</th><th>变动后</th><th>来源</th><th>备注</th></tr></thead><tbody id="wallet-ledger-records"><tr><td colspan="8" class="table-empty">打开经营管理后加载</td></tr></tbody></table></div></section>');
let walletLedgerTimer=null;
document.querySelector('#management-view').insertAdjacentHTML('beforeend','<section class="panel admin-table-panel technician-performance-panel"><div class="admin-toolbar"><div><h2>技师业绩</h2><p>仅统计已完成服务，可按日期查看技师、项目与服务金额</p></div><div class="wallet-ledger-filters"><input id="performance-from" type="date" title="开始日期" aria-label="开始日期"><span>至</span><input id="performance-to" type="date" title="结束日期" aria-label="结束日期"><button class="icon-button" type="button" id="reset-performance" title="清空筛选" aria-label="清空筛选">↺</button></div></div><div class="ledger-table-wrap"><table><thead><tr><th>排名</th><th>技师</th><th>服务项目</th><th>完成服务</th><th>服务时长</th><th>平均单笔</th><th>服务金额</th></tr></thead><tbody id="technician-performance-records"><tr><td colspan="7" class="table-empty">打开经营管理后加载</td></tr></tbody></table></div></section>');
document.querySelector('#management-view').insertAdjacentHTML('beforeend','<section class="panel daily-report-panel"><div class="daily-report-toolbar"><div><p class="eyebrow">经营日报</p><h2>当日经营汇总</h2></div><div class="daily-report-actions"><input id="daily-report-date" type="date" title="经营日期" aria-label="经营日期"><button class="button secondary" type="button" id="export-daily-report">导出 CSV</button></div></div><div class="daily-report-grid"><article><span>订单实收</span><strong id="report-sales-amount">¥0.00</strong><small id="report-order-count">0 笔结算订单</small></article><article><span>已完成退款</span><strong id="report-refund-amount">¥0.00</strong><small>以完成退款为准</small></article><article class="net"><span>净订单收入</span><strong id="report-net-sales">¥0.00</strong><small>订单实收减退款</small></article><article><span>会员充值</span><strong id="report-recharge-amount">¥0.00</strong><small id="report-bonus-amount">赠送 ¥0.00</small></article><article><span>会员余额消费</span><strong id="report-consumption-amount">¥0.00</strong><small>会员钱包扣款</small></article><article><span>服务业绩</span><strong id="report-service-amount">¥0.00</strong><small id="report-service-count">0 次已完成服务</small></article></div></section>');
document.querySelector('.workspace').insertAdjacentHTML('beforeend','<section class="view access-view hidden" id="access-view"><div class="page-heading"><div><p class="eyebrow">组织与权限</p><h1>门店与权限</h1></div><div class="page-actions"><button class="button primary" id="add-access-store">新增门店</button><button class="button secondary" id="add-access-user">新增管理账号</button></div></div><section class="panel admin-table-panel access-panel"><div class="admin-toolbar"><div><h2>门店资料</h2><p>门店停用后不影响历史数据</p></div></div><div class="ledger-table-wrap"><table><thead><tr><th>门店编码</th><th>门店名称</th><th>时区</th><th>营业日切换</th><th>联系方式</th><th>营业时间</th><th>状态</th><th class="align-right">操作</th></tr></thead><tbody id="access-store-records"></tbody></table></div></section><section class="panel admin-table-panel access-panel"><div class="admin-toolbar"><div><h2>管理账号</h2><p>管理账号需要分配角色与可访问门店</p></div></div><div class="ledger-table-wrap"><table><thead><tr><th>账号</th><th>显示名称</th><th>角色</th><th>门店范围</th><th>状态</th><th class="align-right">操作</th></tr></thead><tbody id="access-user-records"></tbody></table></div></section><section class="panel access-role-panel"><div class="admin-toolbar"><div><h2>角色权限</h2><p>角色权限配置将在后续业务接口门店上下文改造时生效</p></div><select id="access-role-select"></select></div><div id="access-permission-list" class="access-permission-list"></div><div class="access-role-actions"><button class="button primary" id="save-role-permissions">保存权限</button></div></section></section><dialog id="access-store-dialog"><form id="access-store-form" class="dialog-card"><div class="dialog-heading"><h2 id="access-store-title">新增门店</h2><button class="icon-button" type="button" id="close-access-store">×</button></div><div class="form-grid"><label>门店编码<input name="code" required maxlength="40"></label><label>门店名称<input name="name" required maxlength="120"></label><label>时区<input name="timezone" value="Asia/Shanghai" required></label><label>营业日切换时间<input name="businessDayCutoff" type="time" value="05:00" required></label><label>联系电话<input name="contactPhone" maxlength="30"></label><label>营业时间<input name="businessHours" placeholder="例如 10:00-02:00" maxlength="120"></label><label class="form-full">门店地址<input name="address" maxlength="240"></label></div><div class="dialog-actions"><button class="button primary" type="submit">保存门店</button></div></form></dialog><dialog id="access-user-dialog"><form id="access-user-form" class="dialog-card"><div class="dialog-heading"><h2 id="access-user-title">新增管理账号</h2><button class="icon-button" type="button" id="close-access-user">×</button></div><div class="form-grid"><label>登录账号<input name="loginName" required maxlength="80"></label><label>显示名称<input name="displayName" required maxlength="120"></label><label id="access-password-field" class="form-full">初始密码<input name="password" type="password" minlength="8"></label></div><div class="access-assignment"><b>角色</b><div id="access-user-roles"></div><b>可访问门店</b><div id="access-user-stores"></div></div><div class="dialog-actions"><button class="button primary" type="submit">保存账号权限</button></div></form></dialog>');
  document.querySelector('#management-view').insertAdjacentHTML('beforeend','<section class="panel admin-table-panel store-comparison-panel"><div class="admin-toolbar"><div><h2>多门店经营对比</h2><p>只汇总当前管理账号被授权门店的当日数据</p></div><div class="store-comparison-sort" id="store-comparison-sort"><button type="button" class="selected" data-store-comparison-sort="SALES">净营业额</button><button type="button" data-store-comparison-sort="SERVICE">服务业绩</button><button type="button" data-store-comparison-sort="CASH">现金净额</button></div></div><div class="ledger-table-wrap"><table><thead><tr><th>排名</th><th>门店</th><th>净营业额</th><th>服务业绩</th><th>会员充值</th><th>退款</th><th>现金净额</th><th>房间与技师</th><th>待处理</th></tr></thead><tbody id="store-comparison-records"><tr><td colspan="9" class="table-empty">登录管理账号后加载</td></tr></tbody></table></div></section>');
document.querySelector('#management-view').insertAdjacentHTML('beforeend','<section class="panel admin-table-panel store-alert-panel"><div class="admin-toolbar"><div><h2>经营预警与待办</h2><p>只显示当前管理账号被授权门店的待处理事项</p></div><span id="store-alert-total" class="muted-count">登录后加载</span></div><div class="ledger-table-wrap"><table><thead><tr><th>优先级</th><th>门店</th><th>待办事项</th><th>数量 / 差异</th><th>处理入口</th></tr></thead><tbody id="store-alert-records"><tr><td colspan="5" class="table-empty">登录管理账号后加载</td></tr></tbody></table></div></section>');
document.querySelector('#management-view').insertAdjacentHTML('beforeend','<section class="panel admin-table-panel cross-store-transaction-panel"><div class="admin-toolbar"><div><h2>跨门店订单与会员消费查询</h2><p>仅查询当前管理账号被授权门店的订单、退款和会员消费</p></div><div class="cross-store-query-controls"><label class="search-field"><span>⌕</span><input id="cross-store-transaction-search" placeholder="订单号、会员姓名或手机号" /></label><div class="segment-control" id="cross-store-transaction-types"><button type="button" class="selected" data-cross-store-transaction-type="ALL">全部</button><button type="button" data-cross-store-transaction-type="ORDER">订单</button><button type="button" data-cross-store-transaction-type="REFUND">退款</button><button type="button" data-cross-store-transaction-type="CONSUMPTION">会员消费</button></div></div></div><div class="ledger-table-wrap"><table><thead><tr><th>类型</th><th>门店</th><th>单号 / 来源</th><th>会员</th><th>金额</th><th>支付 / 状态</th><th>关联服务</th><th>时间</th><th>操作</th></tr></thead><tbody id="cross-store-transaction-records"><tr><td colspan="9" class="table-empty">登录管理账号后加载</td></tr></tbody></table></div></section>');
document.querySelector('#technicians-view').insertAdjacentHTML('beforeend','<section id="employee-scheduling-panel" class="employee-tab-panel panel technician-schedule-panel hidden"><div class="admin-toolbar schedule-toolbar"><div><h2>技师排班</h2><p>按当前门店和日期安排上班、休息与自定义班次</p></div><div class="schedule-toolbar-actions"><input id="schedule-date" type="date" title="排班日期" aria-label="排班日期"><button class="button secondary" id="schedule-admin-login" type="button">管理登录</button><button class="button primary" id="add-tech-schedule" type="button">新增班次</button></div></div><div class="ledger-table-wrap"><table><thead><tr><th>技师</th><th>班次</th><th>时间</th><th>状态</th><th>备注</th><th class="align-right">操作</th></tr></thead><tbody id="technician-schedule-records"><tr><td colspan="6" class="table-empty">打开员工管理后加载</td></tr></tbody></table></div><section class="technician-leave-panel"><div class="admin-toolbar schedule-toolbar"><div><h2>请假管理</h2><p>申请、审批或取消请假记录</p></div><button class="button secondary" id="add-tech-leave" type="button">登记请假</button></div><div class="ledger-table-wrap"><table><thead><tr><th>技师</th><th>请假日期</th><th>原因</th><th>状态</th><th>审批信息</th><th class="align-right">操作</th></tr></thead><tbody id="technician-leave-records"><tr><td colspan="6" class="table-empty">打开员工管理后加载</td></tr></tbody></table></div></section></section>');
document.body.insertAdjacentHTML('beforeend','<dialog id="technician-schedule-dialog"><form id="technician-schedule-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">技师排班</p><h2 id="technician-schedule-title">新增班次</h2></div><button class="icon-button" type="button" id="close-technician-schedule" aria-label="关闭">×</button></div><div class="form-grid"><label class="form-full">技师<select name="technicianId" id="schedule-technician" required></select></label><label>班次类型<select name="shiftType" id="schedule-shift-type" required><option value="MORNING">早班</option><option value="EVENING">晚班</option><option value="CUSTOM">自定义</option><option value="REST">休息</option></select></label><label>排班日期<input name="scheduleDate" id="schedule-form-date" type="date" required></label><label>开始时间<input name="startTime" id="schedule-start-time" type="time" required></label><label>结束时间<input name="endTime" id="schedule-end-time" type="time" required></label><label class="form-full">备注<input name="note" maxlength="240" placeholder="可选" /></label></div><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-technician-schedule">取消</button><button class="button primary" type="submit">保存班次</button></div></form></dialog><dialog id="technician-leave-dialog"><form id="technician-leave-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">请假登记</p><h2>新增请假申请</h2></div><button class="icon-button" type="button" id="close-technician-leave" aria-label="关闭">×</button></div><div class="form-grid"><label class="form-full">技师<select name="technicianId" id="leave-technician" required></select></label><label>开始日期<input name="startDate" id="leave-start-date" type="date" required></label><label>结束日期<input name="endDate" id="leave-end-date" type="date" required></label><label class="form-full">请假原因<input name="reason" maxlength="240" placeholder="可选" /></label></div><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-technician-leave">取消</button><button class="button primary" type="submit">提交申请</button></div></form></dialog><dialog id="technician-leave-review-dialog"><form id="technician-leave-review-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">请假审批</p><h2 id="technician-leave-review-title">审批请假</h2></div><button class="icon-button" type="button" id="close-technician-leave-review" aria-label="关闭">×</button></div><div class="form-grid"><label>审批结果<select name="status"><option value="APPROVED">批准请假</option><option value="CANCELLED">取消申请</option></select></label><label>审批人<input name="reviewerName" value="管理员" maxlength="120" required></label><label class="form-full">审批说明<input name="reviewNote" maxlength="240" placeholder="可选" /></label></div><div class="dialog-actions"><button class="button primary" type="submit">确认审批</button></div></form></dialog>');
document.querySelector('#access-view .access-panel .admin-toolbar p').textContent='门店删除后不影响历史数据';
document.querySelector('#access-view').insertAdjacentHTML('beforeend','<section class="panel admin-table-panel access-panel historical-backfill-access-panel" id="historical-backfill-access-panel"><div class="admin-toolbar"><div><h2>历史补单授权</h2><p>按门店授予或撤销店长的 HISTORICAL_ORDER_CREATE 权限</p></div><label>门店<select id="backfill-access-store"></select></label></div><div class="ledger-table-wrap"><table><thead><tr><th>店长账号</th><th>显示名称</th><th>授权状态</th><th>授权时间</th><th>授权人</th><th class="align-right">操作</th></tr></thead><tbody id="backfill-manager-records"><tr><td colspan="6" class="table-empty">加载中</td></tr></tbody></table></div></section><section class="panel admin-table-panel access-panel historical-backfill-record-panel" id="historical-backfill-record-panel"><div class="admin-toolbar"><div><h2>历史补单记录</h2><p>审核补录订单并导出留档</p></div><div class="wallet-ledger-filters"><select id="historical-backfill-filter-store" aria-label="筛选门店"><option value="">全部门店</option></select><input id="historical-backfill-filter-from" type="date" aria-label="开始日期"><span>至</span><input id="historical-backfill-filter-to" type="date" aria-label="结束日期"><input id="historical-backfill-filter-operator" placeholder="操作人 UUID" aria-label="操作人 UUID"><button class="button secondary" type="button" id="historical-backfill-refresh">刷新</button><button class="button secondary" type="button" id="historical-backfill-export">导出 CSV</button></div></div><div class="ledger-table-wrap"><table><thead><tr><th>营业日期</th><th>门店</th><th>订单/结算单</th><th>应收</th><th>实收</th><th>收款方式</th><th>操作人</th><th>状态</th><th>退款状态</th></tr></thead><tbody id="historical-backfill-records"><tr><td colspan="9" class="table-empty">加载中</td></tr></tbody></table></div></section>');
let accessStores=[],selectableStores=[],accessRoles=[],accessPermissions=[],accessUsers=[],editingAccessStoreId=null,editingAccessUserId=null;
let backfillManagers=[],historicalBackfillRows=[];
const historicalBackfillEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const historicalBackfillStoreId=()=>document.querySelector('#backfill-access-store')?.value||'';
function renderHistoricalBackfillManagers(){const target=document.querySelector('#backfill-manager-records');if(!target)return;target.innerHTML=backfillManagers.map(row=>`<tr><td>${historicalBackfillEscape(row.managerLoginName||'—')}</td><td><b>${historicalBackfillEscape(row.managerName||'—')}</b></td><td><span class="record-type ${row.isActive?'order':'consumption'}">${row.isActive?'已授权':'未授权'}</span></td><td>${row.isActive&&row.grantedAt?new Date(row.grantedAt).toLocaleString('zh-CN'):'—'}</td><td>${historicalBackfillEscape(row.grantedByName||'—')}</td><td class="align-right"><button class="record-delete" type="button" data-backfill-manager-toggle="${roomTransferEscape(row.managerId)}" data-active="${row.isActive?'false':'true'}">${row.isActive?'撤销授权':'授予授权'}</button></td></tr>`).join('')||'<tr><td colspan="6" class="table-empty">当前门店暂无店长账号</td></tr>';}
function renderHistoricalBackfillRows(){const target=document.querySelector('#historical-backfill-records');if(!target)return;target.innerHTML=historicalBackfillRows.map(row=>`<tr><td>${historicalBackfillEscape(row.backfillDate||'—')}</td><td><b>${historicalBackfillEscape(row.storeName||'—')}</b><small class="muted-cell">${historicalBackfillEscape(row.storeCode||'')}</small></td><td><b>${historicalBackfillEscape(row.orderNo||'—')}</b><small class="muted-cell">${historicalBackfillEscape(row.settlementNo||'')}</small></td><td class="amount-cell">${signedMoneyCents(row.receivableCents)}</td><td class="amount-cell">${signedMoneyCents(row.paidCents)}</td><td>${historicalBackfillEscape(row.paymentMethods||'—')}</td><td>${historicalBackfillEscape(row.backfillByName||'—')}<small class="muted-cell">${row.backfillAt?new Date(row.backfillAt).toLocaleString('zh-CN'):''}</small></td><td>${historicalBackfillEscape(row.status||'—')}</td><td>${historicalBackfillEscape(row.refundStatus||'—')}</td></tr>`).join('')||'<tr><td colspan="9" class="table-empty">暂无历史补单记录</td></tr>';}
async function loadBackfillManagers(){const storeId=historicalBackfillStoreId();if(!storeId)return;const response=await fetch(`http://localhost:8080/api/v1/admin/access/stores/${storeId}/backfill-managers`,{headers:adminHeaders()});if(!response.ok)throw new Error('BACKFILL_MANAGER_LOAD_FAILED');backfillManagers=await response.json();renderHistoricalBackfillManagers();}
async function loadHistoricalBackfillRows(){const storeId=document.querySelector('#historical-backfill-filter-store')?.value||'';const from=document.querySelector('#historical-backfill-filter-from')?.value||'';const to=document.querySelector('#historical-backfill-filter-to')?.value||'';const operator=document.querySelector('#historical-backfill-filter-operator')?.value.trim()||'';const query=new URLSearchParams();if(storeId)query.set('storeId',storeId);if(from)query.set('from',from);if(to)query.set('to',to);if(operator)query.set('backfillBy',operator);const response=await fetch(`http://localhost:8080/api/v1/admin/access/historical-backfills?${query}`,{headers:adminHeaders()});if(!response.ok)throw new Error('BACKFILL_RECORD_LOAD_FAILED');historicalBackfillRows=await response.json();renderHistoricalBackfillRows();}
function exportHistoricalBackfills(){const columns=['营业日期','门店编码','门店名称','订单号','结算单号','应收分','实收分','收款方式','操作人','状态','退款状态'];const rows=historicalBackfillRows.map(row=>[row.backfillDate,row.storeCode,row.storeName,row.orderNo,row.settlementNo,row.receivableCents,row.paidCents,row.paymentMethods,row.backfillByName,row.status,row.refundStatus]);const csv='\ufeff'+[columns,...rows].map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`historical-backfills-${localDateValue()}.csv`;anchor.click();URL.revokeObjectURL(url);}
function syncHistoricalBackfillAccessStores(){const options=accessStores.filter(store=>store.active).map(store=>`<option value="${roomTransferEscape(store.id)}">${historicalBackfillEscape(store.code)} · ${historicalBackfillEscape(store.name)}</option>`).join('');for(const selector of ['#backfill-access-store','#historical-backfill-filter-store']){const element=document.querySelector(selector);if(!element)continue;const previous=element.value;element.innerHTML=(selector.endsWith('filter-store')?'<option value="">全部门店</option>':'')+options;if([...element.options].some(option=>option.value===previous))element.value=previous;}if(!historicalBackfillStoreId()&&accessStores.some(store=>store.active))document.querySelector('#backfill-access-store').value=accessStores.find(store=>store.active).id;}
async function loadHistoricalBackfillAccess(){if(!isTenantAdmin())return;syncHistoricalBackfillAccessStores();await Promise.all([loadBackfillManagers(),loadHistoricalBackfillRows()]);}
document.body.insertAdjacentHTML('beforeend','<dialog id="admin-login-dialog"><form id="admin-login-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">管理端验证</p><h2>登录后管理门店权限</h2></div><button class="icon-button" type="button" id="close-admin-login" title="关闭">×</button></div><div class="form-grid"><label class="form-full">账号<input name="loginName" autocomplete="username" required></label><label class="form-full">密码<input name="password" type="password" autocomplete="current-password" minlength="8" required></label></div><div class="dialog-actions"><button class="button primary" type="submit">登录</button></div></form></dialog>');
const adminTokenKey='chengxin-admin-access-token';
const adminRolesKey='chengxin-admin-roles';
const adminPermissionsKey='chengxin-admin-permissions';
const currentStoreKey='chengxin-current-store-id';
const defaultStoreId='22222222-2222-2222-2222-222222222222';
const adminHeaders=()=>({Authorization:`Bearer ${localStorage.getItem(adminTokenKey)}`});
const adminJsonHeaders=()=>({...adminHeaders(),'Content-Type':'application/json'});
const adminRoles=()=>{try{return JSON.parse(localStorage.getItem(adminRolesKey)||'[]');}catch{return [];}};
const adminPermissions=()=>{try{return JSON.parse(localStorage.getItem(adminPermissionsKey)||'[]');}catch{return [];}};
const isTenantAdmin=()=>adminRoles().includes('TENANT_ADMIN');
const hasAdminPermission=permission=>isTenantAdmin()||adminPermissions().includes(permission);
const clearAdminSession=()=>{localStorage.removeItem(adminTokenKey);localStorage.removeItem(adminRolesKey);localStorage.removeItem(adminPermissionsKey);localStorage.removeItem(currentStoreKey);extensionSyncSnapshot=new Map();extensionSyncInitialized=false;};
  const adminViewPermissions={frontdesk:'FRONTDESK_SETTLE',management:'REPORT_VIEW',finance:'EXPENSE_REVIEW',technicians:'FOUNDATION_MANAGE',rooms:'FOUNDATION_MANAGE',services:'FOUNDATION_MANAGE','payment-methods':'FOUNDATION_MANAGE','print-settings':'FOUNDATION_MANAGE',members:'MEMBER_MANAGE',access:'TENANT_ADMIN','daily-report':'DAILY_REPORT_VIEW','monthly-targets':'DAILY_REPORT_CONFIG'};
const isAdminViewAllowed=view=>{
  if(!localStorage.getItem(adminTokenKey))return false;
  const permission=adminViewPermissions[view];
  return !permission||(permission==='TENANT_ADMIN'?isTenantAdmin():hasAdminPermission(permission));
};
function applyAdminPermissions(){
  document.querySelectorAll('.nav-item[data-view]').forEach(button=>{
    const allowed=isAdminViewAllowed(button.dataset.view);
    button.hidden=!allowed;
    button.setAttribute('aria-hidden',String(!allowed));
  });
  document.querySelectorAll('.nav-group').forEach(group=>{
    const hasVisibleItem=[...group.querySelectorAll('.nav-item[data-view]')].some(button=>!button.hidden);
    group.hidden=!hasVisibleItem;
  });
  const sectionPermissions=[
    ['.historical-backfill-panel','HISTORICAL_ORDER_CREATE'],
    ['.refund-management-panel','ORDER_REFUND'],
    ['.wallet-ledger-panel','MEMBER_MANAGE'],
    ['.technician-performance-panel','REPORT_VIEW'],
    ['.daily-report-panel','REPORT_VIEW'],
    ['.store-comparison-panel','REPORT_VIEW'],
    ['.store-alert-panel','REPORT_VIEW'],
    ['.cross-store-transaction-panel','REPORT_VIEW']
  ];
  sectionPermissions.forEach(([selector,permission])=>document.querySelectorAll(selector).forEach(section=>{section.hidden=!hasAdminPermission(permission);}));
  const active=document.querySelector('.nav-item.active[data-view]');
  if(active?.hidden){
    const fallback=[...document.querySelectorAll('.nav-item[data-view]')].find(button=>!button.hidden);
    fallback?.click();
  }
}
window.applyAdminPermissions=applyAdminPermissions;
window.isAdminViewAllowed=isAdminViewAllowed;
const storeContextHeaders=(json=false)=>{
  const token=localStorage.getItem(adminTokenKey);
  const storeId=localStorage.getItem(currentStoreKey);
  return {...(token&&storeId?{Authorization:`Bearer ${token}`,'X-Store-Id':storeId}:{}),...(json?{'Content-Type':'application/json'}:{})};
};
let storeComparisonSort='SALES';
let crossStoreTransactionType='ALL',crossStoreTransactionTimer=null;
let technicianSchedules=[],technicianLeaveRequests=[],editingTechnicianScheduleId=null,reviewingTechnicianLeaveId=null;
const scheduleTypeLabel={MORNING:'早班',EVENING:'晚班',CUSTOM:'自定义',REST:'休息'};
const scheduleStatusLabel={SCHEDULED:'已排班',REST:'休息',CANCELLED:'已取消'};
const leaveStatusLabel={PENDING:'待审批',APPROVED:'已批准',CANCELLED:'已取消'};
const localDateValue=()=>new Date().toISOString().slice(0,10);
const scheduleTime=value=>value?String(value).slice(0,5):'—';
function scheduleTechnicianOptions(selected=''){return managedTechnicians.map(technician=>`<option value="${roomTransferEscape(technician.id)}" ${technician.id===selected?'selected':''}>${roomTransferEscape(technician.code)} · ${roomTransferEscape(technician.name)}${technician.active?'':'（已删除）'}</option>`).join('')||'<option value="">当前门店没有技师</option>';}
function renderTechnicianSchedules(){document.querySelector('#technician-schedule-records').innerHTML=technicianSchedules.map(item=>`<tr><td><b>${roomTransferEscape(item.technicianName)}</b><small class="muted-cell"> ${roomTransferEscape(item.technicianCode)}</small></td><td>${roomTransferEscape(scheduleTypeLabel[item.shiftType]||item.shiftType)}</td><td>${item.shiftType==='REST'?'全天休息':roomTransferEscape(`${scheduleTime(item.startTime)} - ${scheduleTime(item.endTime)}`)}</td><td><span class="record-type ${item.status==='SCHEDULED'?'order':'consumption'}">${roomTransferEscape(scheduleStatusLabel[item.status]||item.status)}</span></td><td class="muted-cell">${roomTransferEscape(item.note||'—')}</td><td class="align-right">${item.status==='SCHEDULED'?`<button class="record-delete edit-technician" data-schedule-edit="${roomTransferEscape(item.id)}">编辑</button><button class="record-delete" data-schedule-cancel="${roomTransferEscape(item.id)}">取消班次</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="6" class="table-empty">当前日期尚未安排班次</td></tr>';}
function renderTechnicianLeaves(){document.querySelector('#technician-leave-records').innerHTML=technicianLeaveRequests.map(item=>`<tr><td><b>${roomTransferEscape(item.technicianName)}</b><small class="muted-cell"> ${roomTransferEscape(item.technicianCode)}</small></td><td>${roomTransferEscape(item.startDate)}${item.endDate===item.startDate?'':roomTransferEscape(` 至 ${item.endDate}`)}</td><td class="muted-cell">${roomTransferEscape(item.reason||'—')}</td><td><span class="record-type ${item.status==='APPROVED'?'consumption':item.status==='PENDING'?'refund-state':'order'}">${roomTransferEscape(leaveStatusLabel[item.status]||item.status)}</span></td><td class="muted-cell">${item.reviewedByName?roomTransferEscape(`${item.reviewedByName}${item.reviewNote?` · ${item.reviewNote}`:''}`):'—'}</td><td class="align-right">${item.status==='PENDING'?`<button class="record-delete edit-technician" data-leave-review="${roomTransferEscape(item.id)}">审批</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="6" class="table-empty">当前日期没有相关请假记录</td></tr>';}
async function loadSchedulingData(){const date=document.querySelector('#schedule-date').value||localDateValue();document.querySelector('#schedule-date').value=date;if(!localStorage.getItem(adminTokenKey)){document.querySelector('#technician-schedule-records').innerHTML='<tr><td colspan="6" class="table-empty">请先管理登录后查看排班</td></tr>';document.querySelector('#technician-leave-records').innerHTML='<tr><td colspan="6" class="table-empty">请先管理登录后查看请假</td></tr>';return;}const [scheduleResponse,leaveResponse]=await Promise.all([fetch(`http://localhost:8080/api/v1/technician-schedules?date=${date}`,{headers:storeContextHeaders()}),fetch(`http://localhost:8080/api/v1/technician-schedules/leave-requests?from=${date}&to=${date}`,{headers:storeContextHeaders()})]);if(!scheduleResponse.ok||!leaveResponse.ok)throw new Error('SCHEDULE_LOAD_FAILED');technicianSchedules=await scheduleResponse.json();technicianLeaveRequests=await leaveResponse.json();renderTechnicianSchedules();renderTechnicianLeaves();}
function syncScheduleShiftFields(){const rest=document.querySelector('#schedule-shift-type').value==='REST';for(const input of [document.querySelector('#schedule-start-time'),document.querySelector('#schedule-end-time')]){input.disabled=rest;input.required=!rest;if(rest)input.value='';}}
async function openTechnicianSchedule(schedule){if(!managedTechnicians.length)await loadManagedTechnicians();editingTechnicianScheduleId=schedule?.id||null;const form=document.querySelector('#technician-schedule-form');form.reset();document.querySelector('#technician-schedule-title').textContent=schedule?'编辑班次':'新增班次';document.querySelector('#schedule-technician').innerHTML=scheduleTechnicianOptions(schedule?.technicianId);form.scheduleDate.value=schedule?.scheduleDate||document.querySelector('#schedule-date').value||localDateValue();form.shiftType.value=schedule?.shiftType||'MORNING';form.startTime.value=schedule?.startTime?String(schedule.startTime).slice(0,5):'09:00';form.endTime.value=schedule?.endTime?String(schedule.endTime).slice(0,5):'18:00';form.note.value=schedule?.note||'';syncScheduleShiftFields();document.querySelector('#technician-schedule-dialog').showModal();}
async function openTechnicianLeave(){if(!managedTechnicians.length)await loadManagedTechnicians();const form=document.querySelector('#technician-leave-form');form.reset();document.querySelector('#leave-technician').innerHTML=scheduleTechnicianOptions();const date=document.querySelector('#schedule-date').value||localDateValue();form.startDate.value=date;form.endDate.value=date;document.querySelector('#technician-leave-dialog').showModal();}
function renderStoreComparison(rows){document.querySelector('#store-comparison-records').innerHTML=rows.map((row,index)=>`<tr><td><span class="performance-rank ${index<3?'top':''}">${index+1}</span></td><td><b>${roomTransferEscape(row.storeName)}</b><small class="muted-cell"> ${roomTransferEscape(row.storeCode)}</small></td><td class="amount-cell">${money(row.salesAmountCents/100)}</td><td class="amount-cell">${money(row.serviceAmountCents/100)}<small class="muted-cell"> ${roomTransferEscape(row.completedServiceCount)} 次</small></td><td class="amount-cell">${money(row.rechargeAmountCents/100)}</td><td class="amount-cell">${money(row.refundAmountCents/100)}</td><td class="amount-cell">${money(row.cashNetCents/100)}</td><td>服务中 ${roomTransferEscape(row.roomServingCount)}/${roomTransferEscape(row.activeRoomCount)}<small class="muted-cell">清洁 ${roomTransferEscape(row.roomCleaningCount)} · 技师 ${roomTransferEscape(row.activeTechnicianCount)}</small></td><td>待结算 ${roomTransferEscape(row.pendingSettlementCount)}<small class="muted-cell">待退款 ${roomTransferEscape(row.pendingRefundCount)}</small></td></tr>`).join('')||'<tr><td colspan="9" class="table-empty">当前账号未分配可对比门店</td></tr>';}
async function loadStoreComparison(){const target=document.querySelector('#store-comparison-records');if(!localStorage.getItem(adminTokenKey)){target.innerHTML='<tr><td colspan="9" class="table-empty">请先在“门店与权限”中登录管理账号</td></tr>';return;}const date=document.querySelector('#daily-report-date').value;const response=await fetch(`http://localhost:8080/api/v1/operations/store-comparison?date=${encodeURIComponent(date)}&sort=${storeComparisonSort}`,{headers:adminHeaders()});if(!response.ok){target.innerHTML=`<tr><td colspan="9" class="table-empty">${response.status===403?'当前账号没有经营报表权限':'多门店经营数据加载失败'}</td></tr>`;return;}renderStoreComparison(await response.json());}
const storeAlertLabel={PENDING_REFUND:'待确认退款',PENDING_SETTLEMENT:'待结算服务',CLEANING_ROOM:'待完成清洁'};
const storeAlertAction={PENDING_REFUND:'查看退款',PENDING_SETTLEMENT:'前往前台',CLEANING_ROOM:'查看房间'};
function renderStoreAlerts(rows){document.querySelector('#store-alert-total').textContent=`${rows.length} 项待处理`;document.querySelector('#store-alert-records').innerHTML=rows.map((row,index)=>`<tr><td><span class="store-alert-priority p${Math.min(index,4)}">${index+1}</span></td><td><b>${roomTransferEscape(row.storeName)}</b><small class="muted-cell"> ${roomTransferEscape(row.storeCode)}</small></td><td><span class="record-type ${row.alertType==='PENDING_REFUND'?'refund-state':'consumption'}">${roomTransferEscape(storeAlertLabel[row.alertType]||row.alertTitle)}</span><small class="muted-cell"> ${roomTransferEscape(row.alertTitle)}</small></td><td class="amount-cell">${roomTransferEscape(row.alertCount)} 项</td><td><button class="record-delete edit-technician" data-store-alert-store="${roomTransferEscape(row.storeId)}" data-store-alert-type="${roomTransferEscape(row.alertType)}">${roomTransferEscape(storeAlertAction[row.alertType]||'查看')}</button></td></tr>`).join('')||'<tr><td colspan="5" class="table-empty">当前没有需要处理的经营待办</td></tr>';}
async function loadStoreAlerts(){const target=document.querySelector('#store-alert-records');if(!localStorage.getItem(adminTokenKey)){document.querySelector('#store-alert-total').textContent='请先登录';target.innerHTML='<tr><td colspan="5" class="table-empty">请先在“门店与权限”中登录管理账号</td></tr>';return;}const date=document.querySelector('#daily-report-date').value;const response=await fetch(`http://localhost:8080/api/v1/operations/store-alerts?date=${encodeURIComponent(date)}`,{headers:adminHeaders()});if(!response.ok){document.querySelector('#store-alert-total').textContent='加载失败';target.innerHTML='<tr><td colspan="5" class="table-empty">经营待办加载失败</td></tr>';return;}renderStoreAlerts(await response.json());}
const crossStoreTransactionLabel={ORDER:'订单',REFUND:'退款',CONSUMPTION:'会员消费'};
function renderCrossStoreTransactions(rows){document.querySelector('#cross-store-transaction-records').innerHTML=rows.map(row=>{const amount=Number(row.amountCents||0);const signed=row.transactionType==='CONSUMPTION'||row.transactionType==='REFUND'?signedMoneyCents(-Math.abs(amount)):signedMoneyCents(amount);const service=row.serviceTrace||'—';return `<tr><td><span class="record-type ${row.transactionType==='REFUND'?'refund-state':row.transactionType==='ORDER'?'order':'consumption'}">${roomTransferEscape(crossStoreTransactionLabel[row.transactionType]||row.transactionType)}</span></td><td><b>${roomTransferEscape(row.storeName)}</b><small class="muted-cell"> ${roomTransferEscape(row.storeCode)}</small></td><td><b>${roomTransferEscape(row.referenceNo)}</b></td><td>${roomTransferEscape(row.memberName)}<small class="muted-cell"> ${roomTransferEscape(row.memberPhone||'')}</small></td><td class="amount-cell">${signed}</td><td>${roomTransferEscape(row.paymentMethod||'—')}<small class="muted-cell"> ${roomTransferEscape(row.status||'')}</small></td><td class="cross-store-service">${roomTransferEscape(service)}</td><td>${row.occurredAt?new Date(row.occurredAt).toLocaleString('zh-CN'):'—'}</td><td><button class="record-delete edit-technician" data-cross-store-transaction-store="${roomTransferEscape(row.storeId)}" data-cross-store-transaction-type="${roomTransferEscape(row.transactionType)}" data-cross-store-transaction-order="${roomTransferEscape(row.orderId||'')}" data-cross-store-transaction-member="${roomTransferEscape(row.memberPhone||'')}">${row.orderId?'查看明细':'查看账本'}</button></td></tr>`;}).join('')||'<tr><td colspan="9" class="table-empty">没有符合条件的跨门店记录</td></tr>';}
async function loadCrossStoreTransactions(){const target=document.querySelector('#cross-store-transaction-records');if(!localStorage.getItem(adminTokenKey)){target.innerHTML='<tr><td colspan="9" class="table-empty">请先在“门店与权限”中登录管理账号</td></tr>';return;}const query=document.querySelector('#cross-store-transaction-search').value.trim();const response=await fetch(`http://localhost:8080/api/v1/operations/cross-store-transactions?query=${encodeURIComponent(query)}&type=${crossStoreTransactionType}`,{headers:adminHeaders()});if(!response.ok){target.innerHTML=`<tr><td colspan="9" class="table-empty">${response.status===403?'当前账号没有经营报表权限':'跨门店记录加载失败'}</td></tr>`;return;}renderCrossStoreTransactions(await response.json());}
async function switchToAlertStore(storeId){localStorage.setItem(currentStoreKey,storeId);extensionSyncSnapshot=new Map();extensionSyncInitialized=false;const selector=document.querySelector('#current-store-select');if(selector)selector.value=storeId;await Promise.all([loadFoundationData(),loadManagedTechnicians(),loadManagedRooms(),loadManagedServiceItems(),loadManagedPaymentMethods(),loadServiceSessions(),loadTechnicianPerformance()]);}
const nativeFetch=window.fetch.bind(window);
const storeScopedApi=/\/api\/v1\/(foundation|rooms|service-sessions|service-reservations|service-extension-intents|members|wallet-transactions|sales-orders|refunds|operations|technician-performance|print-settings|commissions)(?:\/|\?|$)/;
window.fetch=(input,init={})=>{
  const originalUrl=typeof input==='string'?input:input.url;
  const url=typeof originalUrl==='string'?originalUrl.replace(/^http:\/\/localhost:8080(?=\/api\/)/,''):originalUrl;
  if(!storeScopedApi.test(url))return nativeFetch(url,init);
  const headers=new Headers(storeContextHeaders());
  new Headers(init.headers||{}).forEach((value,key)=>headers.set(key,value));
  return nativeFetch(url,{...init,headers});
};
function renderStoreSelector(){
  const container=document.querySelector('.store-select');
  const activeStores=selectableStores;
  if(!activeStores.length)return;
  let selected=localStorage.getItem(currentStoreKey);
  if(!activeStores.some(store=>store.id===selected))selected=activeStores.find(store=>store.id===defaultStoreId)?.id||activeStores[0].id;
  localStorage.setItem(currentStoreKey,selected);
  container.innerHTML=`<select id="current-store-select" aria-label="当前门店">${activeStores.map(store=>`<option value="${roomTransferEscape(store.id)}" ${store.id===selected?'selected':''}>${roomTransferEscape(store.name)}</option>`).join('')}</select>`;
  container.querySelector('select').addEventListener('change',async event=>{
    localStorage.setItem(currentStoreKey,event.target.value); extensionSyncSnapshot=new Map(); extensionSyncInitialized=false;
    await Promise.all([loadFoundationData(),loadManagedTechnicians(),loadManagedRooms(),loadManagedServiceItems(),loadManagedPaymentMethods(),loadServiceSessions(),loadTechnicianPerformance(),loadSchedulingData()]);
    toast('已切换基础资料门店');
  });
}
function syncHeadquartersNavigation(){}
async function loadMyStores(){const response=await fetch('http://localhost:8080/api/v1/admin/access/my-stores',{headers:adminHeaders()});if(!response.ok)throw new Error('STORE_SCOPE_LOAD_FAILED');selectableStores=await response.json();renderStoreSelector();if(document.querySelector('#service-change-query-panel'))renderServiceChangeStoreOptions();}
function renderCurrentOperator(session=currentAdminSession){
  const name=document.querySelector('#current-operator-name');
  const role=document.querySelector('#current-operator-role');
  if(!name||!role)return;
  name.textContent=session?.displayName||'当前账号';
  const roles=session?.roles||[];
  role.textContent=roles.includes('TENANT_ADMIN')?'系统管理员':roles.includes('STORE_MANAGER')?'店长':roles.includes('FRONTDESK')?'前台主管':roles[0]||'运营账号';
}
async function initializeAdminSession(){const response=await fetch('http://localhost:8080/api/v1/admin/auth/session',{headers:adminHeaders()});if(!response.ok)throw new Error('ADMIN_SESSION_INVALID');const session=await response.json();currentAdminSession=session;renderCurrentOperator(session);localStorage.setItem(adminRolesKey,JSON.stringify(session.roles||[]));localStorage.setItem(adminPermissionsKey,JSON.stringify(session.permissions||[]));syncHeadquartersNavigation();await loadMyStores();if(isTenantAdmin())await loadAccessControl();if(selectableStores.length)await Promise.all([loadFoundationData(),loadStorePrintSetting({render:false})]);applyAdminPermissions();}
  function ensureHeadquartersOverview(){let root=document.querySelector('#headquarters-overview');if(root)return root;document.querySelector('#management-view .page-heading').insertAdjacentHTML('afterend','<section class="panel headquarters-overview" id="headquarters-overview"><div class="admin-toolbar headquarters-overview-heading"><div><p class="eyebrow">总部运营中心</p><h2>门店总览</h2><p>汇总所有启用门店的当日经营与待办</p></div><span class="muted-count" id="headquarters-overview-date">加载中</span></div><div class="headquarters-overview-stats" id="headquarters-overview-stats"></div><div class="ledger-table-wrap"><table><thead><tr><th>门店</th><th>净营业额</th><th>服务业绩</th><th>会员充值</th><th>退款</th><th>现金净额</th><th>房间状态</th><th>服务中技师</th><th class="align-right">操作</th></tr></thead><tbody id="headquarters-overview-records"></tbody></table></div></section>');return document.querySelector('#headquarters-overview');}
const headquartersMoney=value=>money(Number(value||0)/100);
function renderHeadquartersOverview(stores,rows,alerts,date){const activeStores=stores.filter(store=>store.active);const total=field=>rows.reduce((sum,row)=>sum+Number(row[field]||0),0);const stats=[['启用门店',`${activeStores.length}`,`共 ${stores.length} 家已建档门店`],['净营业额',headquartersMoney(total('salesAmountCents')),`${total('completedServiceCount')} 次完成服务`],['会员充值',headquartersMoney(total('rechargeAmountCents')),`退款 ${headquartersMoney(total('refundAmountCents'))}`],['待处理事项',`${alerts.length}`,`清洁、退款与待结算提醒`]];document.querySelector('#headquarters-overview-date').textContent=`经营日期 ${date}`;document.querySelector('#headquarters-overview-stats').innerHTML=stats.map(item=>`<article><span>${roomTransferEscape(item[0])}</span><strong>${roomTransferEscape(item[1])}</strong><small>${roomTransferEscape(item[2])}</small></article>`).join('');document.querySelector('#headquarters-overview-records').innerHTML=rows.map(row=>`<tr><td><b>${roomTransferEscape(row.storeName)}</b><small class="muted-cell">${roomTransferEscape(row.storeCode)}</small></td><td class="amount-cell">${headquartersMoney(row.salesAmountCents)}</td><td class="amount-cell">${headquartersMoney(row.serviceAmountCents)}</td><td class="amount-cell">${headquartersMoney(row.rechargeAmountCents)}</td><td class="amount-cell">${headquartersMoney(row.refundAmountCents)}</td><td class="amount-cell">${headquartersMoney(row.cashNetCents)}</td><td>服务中 ${roomTransferEscape(row.roomServingCount)}/${roomTransferEscape(row.activeRoomCount)}<small class="muted-cell">清洁 ${roomTransferEscape(row.roomCleaningCount)}</small></td><td>${roomTransferEscape(row.activeTechnicianCount)}</td><td class="align-right"><button class="record-delete edit-technician" type="button" data-headquarters-store="${roomTransferEscape(row.storeId)}">进入门店</button></td></tr>`).join('')||'<tr><td colspan="9" class="table-empty">当前没有可汇总的启用门店</td></tr>';}
async function loadHeadquartersOverview(){const management=document.querySelector('#management-view');if(!isTenantAdmin()){management.classList.remove('headquarters-active');document.querySelector('#headquarters-overview')?.remove();return;}const root=ensureHeadquartersOverview();const date=document.querySelector('#daily-report-date')?.value||'';const [storesResponse,comparisonResponse,alertsResponse]=await Promise.all([fetch('http://localhost:8080/api/v1/admin/access/stores',{headers:adminHeaders()}),fetch(`http://localhost:8080/api/v1/operations/store-comparison?date=${encodeURIComponent(date)}`,{headers:adminHeaders()}),fetch(`http://localhost:8080/api/v1/operations/store-alerts?date=${encodeURIComponent(date)}`,{headers:adminHeaders()})]);if(!storesResponse.ok||!comparisonResponse.ok||!alertsResponse.ok){root.querySelector('#headquarters-overview-stats').innerHTML='';root.querySelector('#headquarters-overview-records').innerHTML='<tr><td colspan="10" class="table-empty">总部运营数据加载失败</td></tr>';return;}renderHeadquartersOverview(await storesResponse.json(),await comparisonResponse.json(),await alertsResponse.json(),date||'当前营业日');management.classList.add('headquarters-active');}
let frontdeskLoginRequired=false;
const showAdminLogin=()=>{document.querySelector('#admin-login-form').reset();document.querySelector('#admin-login-dialog').showModal();};
const requireFrontdeskLogin=()=>{
  frontdeskLoginRequired=true;
  document.body.classList.add('frontdesk-auth-locked');
  const dialog=document.querySelector('#admin-login-dialog');
  dialog.classList.add('login-portal-dialog');
  const form=dialog.querySelector('form');
  form.classList.add('login-portal-surface');
  if(!form.querySelector('.login-portal-brand'))form.insertAdjacentHTML('afterbegin','<div class="login-portal-brand"><span class="login-portal-mark">JK</span><h1>靖康科技运营</h1><span class="login-portal-role">店长端</span><p>门店运营、前台收银与经营管理</p></div>');
  showAdminLogin();
};
function ensureOperatorDialogs(){
  if(!document.querySelector('#operator-profile-dialog'))document.body.insertAdjacentHTML('beforeend','<dialog id="operator-profile-dialog"><div class="dialog-card compact operator-profile-card"><div class="dialog-heading"><div><p class="eyebrow">账号管理</p><h2>账号信息</h2></div><button class="icon-button" type="button" data-close-operator-dialog aria-label="关闭">×</button></div><div class="operator-profile-content"><b id="operator-profile-name">—</b><span id="operator-profile-role">—</span><small id="operator-profile-login">登录账号：—</small></div><div class="dialog-actions"><button class="button primary" type="button" data-close-operator-dialog>完成</button></div></div></dialog>');
  if(!document.querySelector('#operator-password-dialog'))document.body.insertAdjacentHTML('beforeend','<dialog id="operator-password-dialog"><form id="operator-password-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">账号安全</p><h2>修改密码</h2></div><button class="icon-button" type="button" data-close-password-dialog aria-label="关闭">×</button></div><div class="form-grid"><label class="form-full">当前密码<input name="currentPassword" type="password" minlength="8" autocomplete="current-password" required></label><label class="form-full">新密码<input name="newPassword" type="password" minlength="8" autocomplete="new-password" required></label><label class="form-full">确认新密码<input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></label></div><div class="dialog-actions"><button class="button secondary" type="button" data-close-password-dialog>取消</button><button class="button primary" type="submit">保存新密码</button></div></form></dialog>');
}
function closeOperatorMenu(){const menu=document.querySelector('#operator-menu');const trigger=document.querySelector('#operator-menu-trigger');if(menu)menu.classList.add('hidden');trigger?.setAttribute('aria-expanded','false');}
function openOperatorProfile(){ensureOperatorDialogs();closeOperatorMenu();document.querySelector('#operator-profile-name').textContent=currentAdminSession?.displayName||'当前账号';const roles=currentAdminSession?.roles||[];document.querySelector('#operator-profile-role').textContent=roles.join('、')||'运营账号';document.querySelector('#operator-profile-login').textContent=`登录账号：${currentAdminSession?.loginName||'当前会话'}`;document.querySelector('#operator-profile-dialog').showModal();}
function openOperatorPassword(){ensureOperatorDialogs();closeOperatorMenu();document.querySelector('#operator-password-form').reset();document.querySelector('#operator-password-dialog').showModal();}
async function logoutFrontdesk(){
  closeOperatorMenu();
  const token=localStorage.getItem(adminTokenKey);
  try{if(token)await fetch('/api/v1/admin/auth/logout',{method:'POST',headers:{Authorization:`Bearer ${token}`}});}catch{}
  clearAdminSession();currentAdminSession=null;history.replaceState(null,'',`${location.pathname}${location.search}`);document.body.classList.add('frontdesk-auth-locked');requireFrontdeskLogin();
}
function setupOperatorMenu(){
  ensureOperatorDialogs();
  document.querySelector('#operator-menu-trigger')?.addEventListener('click',()=>{const menu=document.querySelector('#operator-menu');const open=menu?.classList.toggle('hidden')===false;document.querySelector('#operator-menu-trigger')?.setAttribute('aria-expanded',String(open));});
  document.querySelector('#logout-button')?.addEventListener('click',logoutFrontdesk);
  document.querySelector('#operator-menu')?.addEventListener('click',event=>{const action=event.target.closest('[data-account-action]')?.dataset.accountAction;if(action==='profile')openOperatorProfile();if(action==='password')openOperatorPassword();if(action==='store'){closeOperatorMenu();document.querySelector('#current-store-select')?.focus();}if(action==='logout')logoutFrontdesk();});
  document.querySelectorAll('[data-close-operator-dialog]').forEach(button=>button.addEventListener('click',()=>document.querySelector('#operator-profile-dialog')?.close()));
  document.querySelectorAll('[data-close-password-dialog]').forEach(button=>button.addEventListener('click',()=>document.querySelector('#operator-password-dialog')?.close()));
  document.querySelector('#operator-password-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const newPassword=String(form.get('newPassword')||'');if(newPassword!==String(form.get('confirmPassword')||''))return toast('两次输入的新密码不一致');const response=await fetch('/api/v1/admin/auth/password',{method:'PUT',headers:{...adminHeaders(),'Content-Type':'application/json'},body:JSON.stringify({currentPassword:form.get('currentPassword'),newPassword})});if(!response.ok)return toast(response.status===400?'当前密码不正确或密码格式无效':'密码修改失败，请稍后重试');document.querySelector('#operator-password-dialog').close();toast('密码已修改，请重新登录');await logoutFrontdesk();});
}
const paymentMethodLabel={ MEMBER_BALANCE:'会员余额', WECHAT:'微信', CASH:'现金' };
const refundStatusLabel={ NONE:'未退款', PARTIAL:'部分退款', FULL:'全额退款' };
const walletTypeLabel={ RECHARGE:'充值', BONUS:'赠送', CONSUMPTION:'消费', REFUND:'退款', ADJUSTMENT:'调整' };
const yuanToCents=value=>Math.round(Number(value||0)*100);
const remainingBy=(items,key,id,amountKey)=>Math.max(0,items.filter(item=>item[key]===id).reduce((sum,item)=>sum+Number(item[amountKey]||0),0));
let memberCenterRows=[],memberCenterTimer=null,activeMemberProfile=null;
const memberCenterTime=value=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const memberCenterAmount=value=>money(Number(value||0)/100);
function memberRechargeAttribution(row){
  return `<div class="member-recharge-cell"><b>${roomTransferEscape(row.lastRechargeTechnicianName||'未关联技师')}</b><small>${row.lastRechargeEmployeeName?roomTransferEscape(`经办：${row.lastRechargeEmployeeName}`):'未关联经办员工'}</small></div>`;
}
function memberWalletAttribution(row){
  const parts=[];
  if(row.technicianNameSnapshot)parts.push(`技师：${row.technicianNameSnapshot}`);
  if(row.employeeNameSnapshot)parts.push(`经办：${row.employeeNameSnapshot}`);
  if(row.note)parts.push(row.note);
  return parts.join(' · ')||'—';
}
function renderMemberCenter(rows,{replace=true}={}){
  if(replace)memberCenterRows=rows;
  const balanceFilter=document.querySelector('#member-balance-filter')?.value||'ALL';
  const activityFilter=document.querySelector('#member-activity-filter')?.value||'ALL';
  const visible=rows.filter(row=>(balanceFilter==='ALL'||(balanceFilter==='POSITIVE'?Number(row.balanceCents||0)>0:Number(row.balanceCents||0)===0))&&(activityFilter==='ALL'||(activityFilter==='CONSUMED'?Number(row.consumptionCents||0)>0:activityFilter==='RECHARGED'?Number(row.rechargeCents||0)>0:Number(row.consumptionCents||0)===0&&Number(row.rechargeCents||0)===0)));
  const totalBalance=rows.reduce((sum,row)=>sum+Number(row.balanceCents||0),0);
  const totalRecharge=rows.reduce((sum,row)=>sum+Number(row.rechargeCents||0),0);
  const totalBonus=rows.reduce((sum,row)=>sum+Number(row.bonusCents||0),0);
  const totalConsumption=rows.reduce((sum,row)=>sum+Number(row.consumptionCents||0),0);
  document.querySelector('#member-center-total').textContent=rows.length;
  document.querySelector('#member-center-balance').textContent=memberCenterAmount(totalBalance);
  document.querySelector('#member-center-recharge').textContent=memberCenterAmount(totalRecharge);
  document.querySelector('#member-center-bonus').textContent=`赠送 ${memberCenterAmount(totalBonus)}`;
  document.querySelector('#member-center-consumption').textContent=memberCenterAmount(totalConsumption);
  document.querySelector('#member-query-result-count').textContent=`${visible.length} 条结果`;
  document.querySelector('#member-center-records').innerHTML=visible.map(row=>`<tr><td><b>${roomTransferEscape(row.code)}</b></td><td><div class="member-identity"><b>${roomTransferEscape(row.name)}</b><small>${roomTransferEscape(row.phone)}</small></div></td><td><div class="member-recharge-cell"><b>${roomTransferEscape(row.registeredStoreName||'—')}</b><small>开卡 ${memberCenterTime(row.createdAt)}</small></div></td><td class="amount-cell align-right">${memberCenterAmount(row.balanceCents)}</td><td class="amount-cell align-right">${memberCenterAmount(row.rechargeCents)}</td><td class="amount-cell align-right">${memberCenterAmount(row.bonusCents)}</td><td class="amount-cell align-right">${memberCenterAmount(row.consumptionCents)}</td><td><div class="member-recharge-cell"><b>${row.lastActivityAt?roomTransferEscape(walletTypeLabel[row.lastActivityType]||row.lastActivityType):'暂无业务'}</b><small>${memberCenterTime(row.lastActivityAt)}${row.lastConsumptionAt?roomTransferEscape(` · 最近消费 ${memberCenterTime(row.lastConsumptionAt)}`):''}</small></div></td><td>${memberRechargeAttribution(row)}</td><td class="align-right"><button class="record-delete edit-technician" type="button" data-member-profile="${roomTransferEscape(row.id)}">详情</button><button class="record-delete" type="button" data-member-recharge="${roomTransferEscape(row.id)}">充值</button></td></tr>`).join('')||'<tr><td colspan="10" class="table-empty">没有匹配的会员</td></tr>';
}
async function loadMemberCenter(){
  if(!localStorage.getItem(adminTokenKey)){document.querySelector('#member-center-records').innerHTML='<tr><td colspan="10" class="table-empty">请先登录管理账号后查看会员中心</td></tr>';return;}
  const query=document.querySelector('#member-center-search').value.trim();
  const response=await fetch(`http://localhost:8080/api/v1/members/center?query=${encodeURIComponent(query)}`,{headers:storeContextHeaders()});
  if(!response.ok){document.querySelector('#member-center-records').innerHTML='<tr><td colspan="10" class="table-empty">会员资料加载失败</td></tr>';return;}
  renderMemberCenter(await response.json());
}
function renderMemberProfile(profile){
  activeMemberProfile=profile;
  const member=profile.member;
  const heading=document.querySelector('#member-profile-dialog .dialog-heading');
  heading?.querySelector('.dialog-heading-actions')?.remove();
  if(heading) heading.insertAdjacentHTML('beforeend',`<div class="dialog-heading-actions"><button class="button secondary" type="button" data-member-profile-edit>编辑资料</button><button class="button danger" type="button" data-member-profile-deactivate>停用归档</button>${isTenantAdmin()&&Number(member.balanceCents)>0?'<button class="button danger" type="button" data-member-test-balance-cleanup>测试余额清零并归档</button>':''}${isTenantAdmin()?'<button class="button danger" type="button" data-member-profile-purge>彻底清除</button>':''}</div>`);
  document.querySelector('#member-profile-title').textContent=`${member.name} · 会员详情`;
  document.querySelector('#member-profile-overview').innerHTML=`<div><b>${roomTransferEscape(member.name)}</b><small>${roomTransferEscape(member.code)} · ${roomTransferEscape(member.phone)}</small><small>开卡门店：${roomTransferEscape(member.registeredStoreName||'—')}</small></div><div><small>当前余额</small><strong>${memberCenterAmount(member.balanceCents)}</strong></div><div><small>本店累计充值</small><strong>${memberCenterAmount(member.rechargeCents)}</strong><small>赠送 ${memberCenterAmount(member.bonusCents)}</small></div><div><small>本店累计消费</small><strong>${memberCenterAmount(member.consumptionCents)}</strong></div>`;
  const consumptions=profile.transactions.filter(row=>row.transactionType==='CONSUMPTION');
  document.querySelector('#member-profile-transactions').innerHTML=consumptions.map(row=>`<tr><td>${memberCenterTime(row.createdAt)}</td><td><div class="member-recharge-cell"><b>${roomTransferEscape(row.serviceItems||'会员消费')}</b><small>${row.serviceEndedAt?roomTransferEscape(`服务结束 ${memberCenterTime(row.serviceEndedAt)}`):'订单消费'}</small></div></td><td>${roomTransferEscape(row.serviceTechnicianNames||row.technicianNameSnapshot||'未关联技师')}</td><td>${roomTransferEscape(row.roomNames||'—')}</td><td class="wallet-debit align-right">-${memberCenterAmount(Math.abs(row.amountCents))}</td><td class="amount-cell align-right">${memberCenterAmount(row.balanceAfterCents)}</td><td>${roomTransferEscape(row.orderNo||'—')}</td></tr>`).join('')||'<tr><td colspan="7" class="table-empty">当前门店暂无消费明细</td></tr>';
  document.querySelector('#member-profile-wallet-transactions').innerHTML=profile.transactions.map(row=>{const positive=Number(row.amountCents)>=0;const method=row.paymentMethodNameSnapshot||paymentMethodLabel[row.paymentMethod]||row.paymentMethod||'—';return `<tr><td>${memberCenterTime(row.createdAt)}</td><td><span class="record-type ${positive?'order':'consumption'}">${roomTransferEscape(walletTypeLabel[row.transactionType]||row.transactionType)}</span></td><td class="${positive?'wallet-credit':'wallet-debit'} align-right">${positive?'+':'-'}${memberCenterAmount(Math.abs(row.amountCents))}</td><td>${roomTransferEscape(method)}</td><td class="muted-cell">${roomTransferEscape(memberWalletAttribution(row))}</td></tr>`;}).join('')||'<tr><td colspan="5" class="table-empty">当前门店暂无资金流水</td></tr>';
}
function openMemberEditDialog(){
  if(!activeMemberProfile)return;
  const form=document.querySelector('#member-edit-form');
  form.name.value=activeMemberProfile.member.name; form.phone.value=activeMemberProfile.member.phone;
  document.querySelector('#member-edit-dialog').showModal();
}
document.querySelector('#member-edit-form').addEventListener('submit',async event=>{event.preventDefault();if(!activeMemberProfile)return;const form=event.currentTarget;const response=await fetch(`http://localhost:8080/api/v1/members/${activeMemberProfile.member.id}`,{method:'PUT',headers:storeContextHeaders(true),body:JSON.stringify({name:form.name.value,phone:form.phone.value})});if(!response.ok){const error=await response.json().catch(()=>({}));return toast(error.message||'会员资料保存失败');}document.querySelector('#member-edit-dialog').close();await Promise.all([loadMemberCenter(),openMemberProfile(activeMemberProfile.member.id)]);toast('会员资料已更新');});
document.querySelector('#close-member-edit').addEventListener('click',()=>document.querySelector('#member-edit-dialog').close());
document.querySelector('#cancel-member-edit').addEventListener('click',()=>document.querySelector('#member-edit-dialog').close());
document.querySelector('#member-profile-dialog').addEventListener('click',async event=>{if(event.target.closest('[data-member-profile-edit]'))return openMemberEditDialog();const cleanup=event.target.closest('[data-member-test-balance-cleanup]');if(cleanup&&activeMemberProfile){const reason=window.prompt('请输入测试余额清理原因','历史测试数据清理')?.trim();if(!reason)return;if(!window.confirm(`确认将该会员的测试余额 ${memberCenterAmount(activeMemberProfile.member.balanceCents)} 清零并停用归档？此操作会保留调整流水。`))return;const response=await fetch(`http://localhost:8080/api/v1/members/${activeMemberProfile.member.id}/clear-test-balance-and-archive`,{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({reason})});if(!response.ok){const error=await response.json().catch(()=>({}));return toast(error.message||error.detail||'测试余额清理失败');}document.querySelector('#member-profile-dialog').close();activeMemberProfile=null;await loadMemberCenter();return toast('测试余额已清零，会员已停用归档');}const purge=event.target.closest('[data-member-profile-purge]');if(purge&&activeMemberProfile){if(!window.confirm('确认彻底清除该测试会员？此操作不可撤销，仅无余额、无流水、无订单和无退款记录的会员可以清除。'))return;const response=await fetch(`http://localhost:8080/api/v1/members/${activeMemberProfile.member.id}/purge`,{method:'DELETE',headers:storeContextHeaders(true)});if(!response.ok){const error=await response.json().catch(()=>({}));return toast(error.message||error.detail||'会员彻底清除失败');}document.querySelector('#member-profile-dialog').close();activeMemberProfile=null;await loadMemberCenter();return toast('测试会员已彻底清除');}const deactivate=event.target.closest('[data-member-profile-deactivate]');if(!deactivate||!activeMemberProfile)return;if(!window.confirm('确认停用归档该会员？余额为零且没有未结算订单时才可操作，历史流水会保留。'))return;const response=await fetch(`http://localhost:8080/api/v1/members/${activeMemberProfile.member.id}`,{method:'DELETE',headers:storeContextHeaders(true)});if(!response.ok){const error=await response.json().catch(()=>({}));return toast(error.message||error.detail||'会员停用归档失败');}document.querySelector('#member-profile-dialog').close();activeMemberProfile=null;await loadMemberCenter();toast('会员已停用归档，历史记录已保留');});
async function openMemberProfile(memberId){
  const response=await fetch(`http://localhost:8080/api/v1/members/${memberId}/profile`,{headers:storeContextHeaders()});
  if(!response.ok)return toast('会员详情加载失败');
  renderMemberProfile(await response.json());
  const dialog=document.querySelector('#member-profile-dialog');
  if(!dialog.open)dialog.showModal();
}
function ensureMemberAttributionFields(){
  const fields=[
    ['#member-open-technician','member-open-employee'],
    ['#member-renew-technician','member-renew-employee'],
    ['#member-recharge-form select[name="technicianId"]','member-recharge-employee']
  ];
  fields.forEach(([selector,id])=>{
    const technicianSelect=document.querySelector(selector);
    if(!technicianSelect||document.querySelector(`#${id}`))return;
    technicianSelect.closest('label')?.insertAdjacentHTML('afterend',`<label>经办员工<select name="employeeId" id="${id}"><option value="">未关联员工</option></select></label>`);
  });
}

async function loadMemberRechargeOptions(){
  ensureMemberAttributionFields();
  const form=document.querySelector('#member-recharge-form');
  const [technicianResponse,employeeResponse,paymentResponse]=await Promise.all([fetch('http://localhost:8080/api/v1/foundation/technicians',{headers:storeContextHeaders()}),fetch('http://localhost:8080/api/v1/employees?includeInactive=false',{headers:storeContextHeaders()}),fetch('http://localhost:8080/api/v1/payment-methods',{headers:storeContextHeaders()})]);
  if(!technicianResponse.ok||!employeeResponse.ok||!paymentResponse.ok)throw new Error('RECHARGE_OPTIONS_FAILED');
  const technicians=await technicianResponse.json();
  const employees=await employeeResponse.json();
  const methods=(await paymentResponse.json()).filter(item=>item.methodKind==='EXTERNAL');
  form.technicianId.innerHTML=`<option value="">未关联技师</option>${technicians.map(item=>`<option value="${roomTransferEscape(item.id)}">${roomTransferEscape(item.code||'')} · ${roomTransferEscape(item.name)}</option>`).join('')}`;
  form.employeeId.innerHTML=`<option value="">未关联员工</option>${employees.map(item=>`<option value="${roomTransferEscape(item.employeeId)}">${roomTransferEscape(item.employeeNo||'')} · ${roomTransferEscape(item.fullName)}${item.positionName?` · ${roomTransferEscape(item.positionName)}`:''}</option>`).join('')}`;
  form.paymentMethod.innerHTML=methods.map(item=>`<option value="${roomTransferEscape(item.code)}">${roomTransferEscape(item.name)}</option>`).join('');
  return methods.length>0;
}
async function openMemberRecharge(memberId,memberName='会员'){
  state.selectedMemberId=memberId;
  const form=document.querySelector('#member-recharge-form');
  form.reset();form.bonus.value='0';document.querySelector('#member-recharge-title').textContent=`${memberName} · 储值充值`;
  try{if(!await loadMemberRechargeOptions())return toast('请先在收款方式中启用外部收款方式');}catch{return toast('充值选项加载失败');}
  document.querySelector('#member-recharge-dialog').showModal();
}

let orderHistoryPaymentLoaded = false;
let orderHistoryPage = 0;
const orderHistoryPageSize = 50;
async function loadOrderHistoryPaymentMethods() {
  if (orderHistoryPaymentLoaded) return;
  const select = document.querySelector('#order-history-payment');
  if (!select) return;
  try {
    const response = await fetch('http://localhost:8080/api/v1/payment-methods', { headers: storeContextHeaders() });
    if (response.ok) {
      const methods = await response.json();
      select.innerHTML = '<option value="">全部支付方式</option>' + methods.filter(item => item.active !== false).map(item => `<option value="${memberBusinessEscape(item.code)}">${memberBusinessEscape(item.name)}</option>`).join('');
      orderHistoryPaymentLoaded = true;
    }
  } catch { /* Keep the all-methods option when the API is unavailable. */ }
}
async function loadSalesOrders({resetPage=false}={}){
  if(resetPage) orderHistoryPage=0;
  await loadOrderHistoryPaymentMethods();
  const q=document.querySelector('#order-search').value.trim();
  const from=document.querySelector('#order-history-from').value;
  const to=document.querySelector('#order-history-to').value;
  const paymentMethod=document.querySelector('#order-history-payment').value;
  const status=document.querySelector('#order-history-status').value;
  const params=new URLSearchParams({query:q,page:String(orderHistoryPage),size:String(orderHistoryPageSize)});
  if(from) params.set('from',from);
  if(to) params.set('to',to);
  if(paymentMethod) params.set('paymentMethod',paymentMethod);
  if(status) params.set('status',status);
  const r=await fetch(`http://localhost:8080/api/v1/sales-orders?${params.toString()}`,{headers:storeContextHeaders()});
  if(!r.ok){document.querySelector('#order-records').innerHTML='<tr><td colspan="8" class="table-empty">订单查询失败</td></tr>';return;}
  salesOrders=await r.json();
  document.querySelector('#order-records').innerHTML=salesOrders.map(o=>{const statusLabel=o.status==='CANCELLED'?'已作废':(refundStatusLabel[o.refundStatus]||'已结算');const canVoid=o.status!=='CANCELLED'&&Number(o.paidCents||0)===0&&o.refundStatus==='NONE';return `<tr><td>${memberBusinessEscape(o.orderNo)}</td><td>${memberBusinessEscape(o.settlementNo||'—')}</td><td>${memberBusinessEscape(o.memberName||'散客')}<small class="muted-cell"> ${memberBusinessEscape(o.memberPhone||'')}</small></td><td class="amount-cell">${money(o.receivableCents/100)}</td><td class="amount-cell">${money(o.paidCents/100)}</td><td>${o.settledAt?new Date(o.settledAt).toLocaleString('zh-CN'):''}</td><td><span class="record-type ${o.status==='CANCELLED'?'refund-state':o.refundStatus==='NONE'?'order':'refund-state'}">${statusLabel}</span></td><td><button class="record-delete edit-technician" type="button" data-order-detail="${roomTransferEscape(o.id)}">查看/打印</button>${canVoid?`<button class="record-delete" type="button" data-order-void="${roomTransferEscape(o.id)}">作废</button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="8" class="table-empty">暂无订单</td></tr>';
  document.querySelector('#order-history-page').textContent=`第 ${orderHistoryPage+1} 页`;
  document.querySelector('#order-history-prev').disabled=orderHistoryPage===0;
  document.querySelector('#order-history-next').disabled=salesOrders.length<orderHistoryPageSize;
}
const refundKindLabel={FULL_REVERSAL:'整单退款'};
async function loadRefundManagement(){const response=await fetch(`http://localhost:8080/api/v1/refunds?status=${refundManagementStatus}`,{headers:storeContextHeaders()});if(!response.ok){document.querySelector('#refund-management-records').innerHTML='<tr><td colspan="9" class="table-empty">退款与红冲记录加载失败</td></tr>';return;}const rows=await response.json();document.querySelector('#refund-management-records').innerHTML=rows.map(row=>{const refund=row.refund;const pending=row.payments.filter(payment=>payment.status==='PENDING');const hasCompleted=row.payments.some(payment=>payment.status==='COMPLETED');const paymentText=row.payments.map(payment=>`${paymentMethodLabel[payment.paymentMethod]||payment.paymentMethod}${payment.status==='PENDING'?'（待确认退款）':''}`).join('、');const actors=`${roomTransferEscape(refund.requestedByNameSnapshot||'—')}<small class="muted-cell">${refund.completedByNameSnapshot?roomTransferEscape(`完成：${refund.completedByNameSnapshot}`):'尚未完成'}</small>`;return `<tr><td><b>${roomTransferEscape(refund.refundNo)}</b><small class="muted-cell">${roomTransferEscape(refund.reason)}</small></td><td><span class="record-type ${refund.refundKind==='FULL_REVERSAL'?'refund-state':'consumption'}">${roomTransferEscape(refundKindLabel[refund.refundKind]||refund.refundKind)}</span></td><td><button class="record-delete edit-technician" data-order-detail="${roomTransferEscape(refund.orderId)}">${roomTransferEscape(refund.orderNo)}</button></td><td>${roomTransferEscape(refund.memberName||'散客')}<small class="muted-cell">${roomTransferEscape(refund.memberPhone||'')}</small></td><td>${roomTransferEscape(paymentText)}</td><td class="amount-cell refund-signed-amount">${signedMoneyCents(refund.signedTotalCents||-refund.totalCents)}</td><td>${actors}<small class="muted-cell">${new Date(refund.createdAt).toLocaleString('zh-CN')}</small></td><td><span class="record-type ${refund.status==='COMPLETED'?'order':refund.status==='PENDING'?'refund-state':'consumption'}">${refund.status==='PENDING'?'待确认退款':refund.status==='COMPLETED'?'已完成':'已取消'}</span></td><td class="align-right">${pending.map(payment=>`<button class="record-delete edit-technician" data-dashboard-confirm="${roomTransferEscape(refund.id)}" data-dashboard-payment="${roomTransferEscape(payment.id)}">确认${roomTransferEscape(paymentMethodLabel[payment.paymentMethod]||payment.paymentMethod)}</button>`).join('')}${refund.status==='PENDING'&&!hasCompleted?`<button class="record-delete" data-dashboard-cancel="${roomTransferEscape(refund.id)}">取消</button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="9" class="table-empty">暂无符合条件的退款与红冲记录</td></tr>';}
async function loadMemberWalletLedger(){const query=document.querySelector('#wallet-ledger-search').value.trim();const from=document.querySelector('#wallet-ledger-from').value;const to=document.querySelector('#wallet-ledger-to').value;const response=await fetch(`http://localhost:8080/api/v1/wallet-transactions?query=${encodeURIComponent(query)}&from=${from}&to=${to}`,{headers:storeContextHeaders()});if(!response.ok){document.querySelector('#wallet-ledger-records').innerHTML='<tr><td colspan="8" class="table-empty">资金账本加载失败</td></tr>';return;}const rows=await response.json();document.querySelector('#wallet-ledger-records').innerHTML=rows.map(row=>{const positive=Number(row.amountCents)>=0;const signed=`${positive?'+':'-'}${money(Math.abs(row.amountCents)/100)}`;const refundAction=row.transactionType==='RECHARGE'&&hasAdminPermission('ORDER_REFUND')?`<button class="record-delete" type="button" data-recharge-refund="${roomTransferEscape(row.id)}" data-recharge-member="${roomTransferEscape(row.memberId)}" data-recharge-name="${memberBusinessEscape(row.memberName)}" data-recharge-amount="${roomTransferEscape(row.amountCents)}">申请退款</button>`:'';return `<tr><td>${new Date(row.createdAt).toLocaleString('zh-CN')}</td><td><b>${roomTransferEscape(row.memberName)}</b><small class="muted-cell"> ${roomTransferEscape(row.memberPhone||row.memberCode)}</small></td><td><span class="record-type ${positive?'order':'consumption'}">${roomTransferEscape(walletTypeLabel[row.transactionType]||row.transactionType)}</span></td><td class="wallet-amount ${positive?'credit':'debit'}">${signed}</td><td>${money(row.balanceBeforeCents/100)}</td><td class="amount-cell">${money(row.balanceAfterCents/100)}</td><td>${roomTransferEscape(row.source||'—')}</td><td class="muted-cell">${roomTransferEscape(row.note||'—')} ${refundAction}</td></tr>`;}).join('')||'<tr><td colspan="8" class="table-empty">暂无符合条件的资金流水</td></tr>';}
function setupMemberRechargeRefundUi(){if(document.querySelector('#member-recharge-refund-dialog'))return;document.querySelector('.refund-management-panel')?.insertAdjacentHTML('afterend','<section class="panel admin-table-panel member-recharge-refund-panel"><div class="admin-toolbar"><div><h2>充值退款管理</h2><p>充值退款确认后扣减会员余额，并形成独立资金流水</p></div><div class="segment-control" id="member-recharge-refund-filter"><button type="button" class="selected" data-member-recharge-refund-status="PENDING">待确认</button><button type="button" data-member-recharge-refund-status="COMPLETED">已完成</button><button type="button" data-member-recharge-refund-status="CANCELLED">已取消</button><button type="button" data-member-recharge-refund-status="ALL">全部</button></div></div><div class="ledger-table-wrap"><table><thead><tr><th>退款单号</th><th>会员</th><th>退款金额</th><th>原因</th><th>申请人</th><th>状态</th><th class="align-right">操作</th></tr></thead><tbody id="member-recharge-refund-records"><tr><td colspan="7" class="table-empty">打开经营管理后加载</td></tr></tbody></table></div></section>');document.body.insertAdjacentHTML('beforeend','<dialog id="member-recharge-refund-dialog"><form id="member-recharge-refund-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">会员资金退款</p><h2 id="member-recharge-refund-title">充值退款</h2></div><button class="icon-button" type="button" id="close-member-recharge-refund" aria-label="关闭">×</button></div><div class="form-grid"><label>退款金额（元）<input name="amount" type="number" min="0.01" step="0.01" required></label><label class="form-full">退款原因<textarea name="reason" maxlength="240" required placeholder="请填写退款原因"></textarea></label></div><input name="memberId" type="hidden"><input name="transactionId" type="hidden"><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-member-recharge-refund">取消</button><button class="button primary" type="submit">提交退款申请</button></div></form></dialog>');document.querySelector('#close-member-recharge-refund').addEventListener('click',()=>document.querySelector('#member-recharge-refund-dialog').close());document.querySelector('#cancel-member-recharge-refund').addEventListener('click',()=>document.querySelector('#member-recharge-refund-dialog').close());document.querySelector('#member-recharge-refund-form').addEventListener('submit',submitMemberRechargeRefund);document.querySelector('#member-recharge-refund-filter').addEventListener('click',event=>{const button=event.target.closest('[data-member-recharge-refund-status]');if(!button)return;memberRechargeRefundStatus=button.dataset.memberRechargeRefundStatus;document.querySelectorAll('[data-member-recharge-refund-status]').forEach(item=>item.classList.toggle('selected',item===button));loadMemberRechargeRefunds();});document.querySelector('#member-recharge-refund-records').addEventListener('click',handleMemberRechargeRefundAction);document.querySelector('#wallet-ledger-records').addEventListener('click',event=>{const button=event.target.closest('[data-recharge-refund]');if(button)openMemberRechargeRefund(button);});}
let memberRechargeRefundStatus='PENDING';
function openMemberRechargeRefund(button){const form=document.querySelector('#member-recharge-refund-form');form.reset();form.memberId.value=button.dataset.rechargeMember;form.transactionId.value=button.dataset.rechargeRefund;form.amount.value=(Number(button.dataset.rechargeAmount)/100).toFixed(2);form.amount.max=(Number(button.dataset.rechargeAmount)/100).toFixed(2);document.querySelector('#member-recharge-refund-title').textContent=`${button.dataset.rechargeName} · 充值退款`;document.querySelector('#member-recharge-refund-dialog').showModal();}
async function submitMemberRechargeRefund(event){event.preventDefault();const form=event.currentTarget;const data=new FormData(form);const amountCents=Math.round(Number(data.get('amount'))*100);if(!amountCents)return toast('请输入有效退款金额');const response=await fetch('http://localhost:8080/api/v1/member-recharge-refunds',{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({memberId:data.get('memberId'),originalTransactionId:data.get('transactionId'),amountCents,reason:String(data.get('reason')||'').trim(),requestKey:crypto.randomUUID()})});if(!response.ok)return toast(response.status===409?'该充值可退金额不足':'充值退款申请失败');document.querySelector('#member-recharge-refund-dialog').close();await loadMemberRechargeRefunds();toast('充值退款已提交，等待确认打款');}
async function loadMemberRechargeRefunds(){const target=document.querySelector('#member-recharge-refund-records');if(!target)return;const response=await fetch(`http://localhost:8080/api/v1/member-recharge-refunds?status=${memberRechargeRefundStatus}`,{headers:storeContextHeaders()});if(!response.ok){target.innerHTML='<tr><td colspan="7" class="table-empty">充值退款记录加载失败</td></tr>';return;}const rows=await response.json();target.innerHTML=rows.map(row=>`<tr><td><b>${roomTransferEscape(row.refundNo)}</b><small class="muted-cell">${new Date(row.createdAt).toLocaleString('zh-CN')}</small></td><td>${memberBusinessEscape(row.memberName)}<small class="muted-cell">${memberBusinessEscape(row.memberPhone||'')}</small></td><td class="refund-signed-amount">-${money(Number(row.amountCents)/100)}${Number(row.bonusReclaimCents)>0?`<small class="muted-cell">另收回赠送 ${money(Number(row.bonusReclaimCents)/100)}</small>`:''}</td><td>${memberBusinessEscape(row.reason)}</td><td>${memberBusinessEscape(row.requestedByNameSnapshot||'—')}</td><td><span class="record-type ${row.status==='COMPLETED'?'order':row.status==='PENDING'?'refund-state':'consumption'}">${row.status==='PENDING'?'待确认':row.status==='COMPLETED'?'已完成':'已取消'}</span></td><td class="align-right">${row.status==='PENDING'?`<button class="record-delete edit-technician" data-member-recharge-complete="${roomTransferEscape(row.id)}">确认退款</button><button class="record-delete" data-member-recharge-cancel="${roomTransferEscape(row.id)}">取消</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="7" class="table-empty">暂无符合条件的充值退款</td></tr>';}
async function handleMemberRechargeRefundAction(event){const complete=event.target.closest('[data-member-recharge-complete]');const cancel=event.target.closest('[data-member-recharge-cancel]');if(!complete&&!cancel)return;const action=complete?'complete':'cancel';if(!window.confirm(complete?'确认已经向顾客退回款项？确认后将扣减会员余额。':'确认取消该退款申请？'))return;const id=(complete||cancel).dataset[complete?'memberRechargeComplete':'memberRechargeCancel'];const response=await fetch(`http://localhost:8080/api/v1/member-recharge-refunds/${id}/${action}`,{method:'POST',headers:storeContextHeaders()});if(!response.ok)return toast(complete?'确认失败，会员余额可能不足':'取消退款失败');await Promise.all([loadMemberRechargeRefunds(),loadMemberWalletLedger(),loadMemberCenter(),loadDailyReport()]);toast(complete?'充值退款已完成':'退款申请已取消');}
setupMemberRechargeRefundUi();
async function loadTechnicianPerformance(){const from=document.querySelector('#performance-from').value;const to=document.querySelector('#performance-to').value;const response=await fetch(`http://localhost:8080/api/v1/technician-performance?from=${from}&to=${to}`,{headers:storeContextHeaders()});if(!response.ok){document.querySelector('#technician-performance-records').innerHTML='<tr><td colspan="7" class="table-empty">技师业绩加载失败</td></tr>';return;}const rows=await response.json();document.querySelector('#technician-performance-records').innerHTML=rows.map((row,index)=>`<tr><td><span class="performance-rank ${index<3?'top':''}">${index+1}</span></td><td><b>${roomTransferEscape(row.technicianName)}</b><small class="muted-cell"> ${roomTransferEscape(row.technicianCode)}</small></td><td class="performance-projects">${roomTransferEscape(row.projectNames||'—')}</td><td>${roomTransferEscape(row.completedCount)} 次</td><td>${roomTransferEscape(row.totalMinutes)} 分钟</td><td>${money(row.averageAmountCents/100)}</td><td class="amount-cell">${money(row.amountCents/100)}</td></tr>`).join('')||'<tr><td colspan="7" class="table-empty">所选日期没有已完成服务</td></tr>';}
function managementSignedDelta(current, previous, suffix='') { const delta=Number(current||0)-Number(previous||0); const sign=delta>0?'+':delta<0?'':''; return `${sign}${delta}${suffix}`; }
function renderManagementOverview(data) {
  const report=data.report||{}; const previous=data.previousReport||{}; const utilization=data.roomUtilization||{};
  const sales=Number(report.netSalesAmountCents||0); const previousSales=Number(previous.netSalesAmountCents||0);
  const salesChange=previousSales?`${sales>=previousSales?'+':''}${((sales-previousSales)/Math.abs(previousSales)*100).toFixed(1)}% 较昨日`: '暂无昨日数据';
  const businessToday=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  document.querySelector('#management-sales-label').textContent=report.businessDate===businessToday?'今日营收':`${report.businessDate} 营收`;
  document.querySelector('#management-sales-amount').textContent=money(sales/100);
  document.querySelector('#management-sales-comparison').textContent=salesChange;
  document.querySelector('#management-order-count').textContent=Number(report.settledOrderCount||0).toLocaleString('zh-CN');
  document.querySelector('#management-order-comparison').textContent=`${managementSignedDelta(Number(report.settledOrderCount||0),Number(previous.settledOrderCount||0),' 单')} 较昨日`;
  document.querySelector('#management-recharge-amount').textContent=money(Number(report.rechargeAmountCents||0)/100);
  document.querySelector('#management-recharge-detail').textContent=`赠送 ${money(Number(report.bonusAmountCents||0)/100)}`;
  document.querySelector('#management-room-utilization').textContent=`${Number(utilization.utilizationPercent||0)}%`;
  document.querySelector('#management-room-utilization-detail').textContent=`${Number(utilization.occupiedBedCount||0)}/${Number(utilization.totalBedCount||0)} 个床位使用中`;
  const trend=data.trend||[]; const max=Math.max(1,...trend.map(item=>Number(item.netSalesAmountCents||0)+Number(item.rechargeAmountCents||0)));
  document.querySelector('#management-revenue-trend').innerHTML=trend.map(item=>{const value=Number(item.netSalesAmountCents||0)+Number(item.rechargeAmountCents||0);const day=String(item.businessDate||'').slice(5).replace('-','/');const today=item.businessDate===report.businessDate;return `<div class="${today?'today':''}" title="${roomTransferEscape(item.businessDate)} · ${money(value/100)}"><i style="height:${Math.max(4,Math.round(value/max*100))}%"></i><span>${today?'当前':day}</span></div>`;}).join('')||'<p class="management-overview-empty">当前门店暂无营业额</p>';
  const ranking=data.technicianRanking||[]; document.querySelector('#management-ranking-period').textContent=`${report.businessDate.slice(0,7)} 服务业绩`;
  document.querySelector('#management-technician-ranking').innerHTML=ranking.map((row,index)=>`<li><span class="rank ${index===0?'first':''}">${index+1}</span><b>${roomTransferEscape(row.technicianName||'未命名技师')}</b><em>${money(Number(row.amountCents||0)/100)}</em></li>`).join('')||'<li class="management-overview-empty">所选月份暂无已结算技师业绩</li>';
  const attention=data.attention||[]; const attentionLabel={CLEANING_ROOM:'待清洁房间',PENDING_SETTLEMENT:'待结算服务',PENDING_REFUND:'待确认退款'};
  document.querySelector('#management-attention').innerHTML=attention.map(item=>`<div><span class="warning-dot"></span><p><b>${attentionLabel[item.attentionType]||roomTransferEscape(item.title)}</b><small>${Number(item.count||0)} 项需要处理</small></p><button class="text-button" type="button" data-management-attention="${roomTransferEscape(item.attentionType)}">查看</button></div>`).join('')||'<div class="management-overview-empty">当前没有待处理事项</div>';
}
async function loadDailyReport(){const date=document.querySelector('#daily-report-date').value;const query=date?`?date=${encodeURIComponent(date)}`:'';const response=await fetch(`http://localhost:8080/api/v1/operations/management-overview${query}`,{headers:storeContextHeaders()});if(!response.ok)return toast('经营日报加载失败');const data=await response.json();const report=data.report||{};document.querySelector('#daily-report-date').value=report.businessDate;document.querySelector('#report-sales-amount').textContent=money(report.salesAmountCents/100);document.querySelector('#report-order-count').textContent=`${report.settledOrderCount} 笔结算订单`;document.querySelector('#report-refund-amount').textContent=money(report.refundAmountCents/100);document.querySelector('#report-net-sales').textContent=money(report.netSalesAmountCents/100);document.querySelector('#report-recharge-amount').textContent=money(report.rechargeAmountCents/100);document.querySelector('#report-bonus-amount').textContent=`赠送 ${money(report.bonusAmountCents/100)}`;document.querySelector('#report-consumption-amount').textContent=money(report.consumptionAmountCents/100);document.querySelector('#report-service-amount').textContent=money(report.serviceAmountCents/100);document.querySelector('#report-service-count').textContent=`${report.completedServiceCount} 次已完成服务`;renderManagementOverview(data);}
const accessChecks=(items,selected,key,label)=>items.map(item=>`<label><input type="checkbox" value="${roomTransferEscape(item.id)}" ${selected.includes(item.id)?'checked':''}>${roomTransferEscape(item[label]||item[key])}</label>`).join('');
function roleNames(ids){return ids.map(id=>accessRoles.find(role=>role.id===id)?.name).filter(Boolean).join('、')||'未分配';}
function storeNames(ids){return ids.map(id=>accessStores.find(store=>store.id===id)?.name).filter(Boolean).join('、')||'全部门店';}
function selectedAccessIds(selector){return [...document.querySelectorAll(`${selector} input:checked`)].map(input=>input.value);}
function renderAccess(){document.querySelector('#access-store-records').innerHTML=accessStores.map(store=>`<tr><td>${roomTransferEscape(store.code)}</td><td><b>${roomTransferEscape(store.name)}</b><small class="muted-cell"> ${roomTransferEscape(store.address||'')}</small></td><td>${roomTransferEscape(store.timezone)}</td><td>${(store.businessDayCutoff||'05:00').slice(0,5)}</td><td>${roomTransferEscape(store.contactPhone||'—')}</td><td>${roomTransferEscape(store.businessHours||'—')}</td><td><span class="record-type ${store.active?'order':'consumption'}">${store.active?'启用':'已删除'}</span></td><td class="align-right">${store.active?`<button class="record-delete edit-technician" data-access-store-edit="${roomTransferEscape(store.id)}">编辑</button><button class="record-delete" data-access-store-active="${roomTransferEscape(store.id)}" data-active="true">删除</button>`:'<span class="muted-cell">—</span>'}</td></tr>`).join('')||'<tr><td colspan="8" class="table-empty">暂无门店</td></tr>';document.querySelector('#access-user-records').innerHTML=accessUsers.map(user=>`<tr><td>${roomTransferEscape(user.loginName)}</td><td><b>${roomTransferEscape(user.displayName)}</b></td><td>${roomTransferEscape(roleNames(user.roleIds))}</td><td>${roomTransferEscape(storeNames(user.storeIds))}</td><td><span class="record-type ${user.active?'order':'consumption'}">${user.active?'启用':'已删除'}</span></td><td class="align-right">${user.active?`<button class="record-delete edit-technician" data-access-user-edit="${roomTransferEscape(user.id)}">权限</button><button class="record-delete" data-access-user-active="${roomTransferEscape(user.id)}" data-active="true">删除</button>`:'<span class="muted-cell">—</span>'}</td></tr>`).join('')||'<tr><td colspan="6" class="table-empty">暂无管理账号</td></tr>';document.querySelector('#access-role-select').innerHTML=accessRoles.map(role=>`<option value="${roomTransferEscape(role.id)}">${roomTransferEscape(role.name)} · ${roomTransferEscape(role.code)}</option>`).join('');renderRolePermissions();syncHistoricalBackfillAccessStores();renderHistoricalBackfillManagers();renderHistoricalBackfillRows();}
function renderRolePermissions(){const role=accessRoles.find(item=>item.id===document.querySelector('#access-role-select').value)||accessRoles[0];if(!role)return;document.querySelector('#access-permission-list').innerHTML=accessPermissions.map(permission=>`<label><input type="checkbox" value="${roomTransferEscape(permission.id)}" ${role.permissionIds.includes(permission.id)?'checked':''}><span><b>${roomTransferEscape(permission.name)}</b><small>${roomTransferEscape(permission.module)} · ${roomTransferEscape(permission.code)}</small></span></label>`).join('');}
async function loadAccessControl(){if(!isTenantAdmin())return;const [stores,roles,permissions,users]=await Promise.all(['stores','roles','permissions','users'].map(path=>fetch(`http://localhost:8080/api/v1/admin/access/${path}`,{headers:adminHeaders()}).then(response=>response.ok?response.json():Promise.reject())));accessStores=stores;accessRoles=roles;accessPermissions=permissions;accessUsers=users;renderAccess();await loadMyStores();await loadHistoricalBackfillAccess().catch(()=>{document.querySelector('#backfill-manager-records')?.replaceChildren();document.querySelector('#historical-backfill-records')?.replaceChildren();});}
function openAccessStore(store){editingAccessStoreId=store?.id||null;const form=document.querySelector('#access-store-form');form.reset();document.querySelector('#access-store-title').textContent=store?'编辑门店':'新增门店';form.code.value=store?.code||'';form.name.value=store?.name||'';form.timezone.value=store?.timezone||'Asia/Shanghai';form.businessDayCutoff.value=(store?.businessDayCutoff||'05:00').slice(0,5);form.contactPhone.value=store?.contactPhone||'';form.address.value=store?.address||'';form.businessHours.value=store?.businessHours||'';document.querySelector('#access-store-dialog').showModal();}
function openAccessUser(user){editingAccessUserId=user?.id||null;const form=document.querySelector('#access-user-form');form.reset();document.querySelector('#access-user-title').textContent=user?'编辑账号权限':'新增管理账号';form.loginName.disabled=Boolean(user);form.displayName.disabled=Boolean(user);form.loginName.value=user?.loginName||'';form.displayName.value=user?.displayName||'';form.password.required=!user;document.querySelector('#access-password-field').classList.toggle('hidden',Boolean(user));document.querySelector('#access-user-roles').innerHTML=accessChecks(accessRoles,user?.roleIds||[],'code','name');document.querySelector('#access-user-stores').innerHTML=accessChecks(accessStores,user?.storeIds||[],'code','name');document.querySelector('#access-user-dialog').showModal();}

async function loadRefundDetails(orderId){const response=await fetch(`http://localhost:8080/api/v1/sales-orders/${orderId}/refunds`,{headers:storeContextHeaders()});if(!response.ok)return[];const refunds=await response.json();return Promise.all(refunds.map(async refund=>{const detail=await fetch(`http://localhost:8080/api/v1/refunds/${refund.id}`,{headers:storeContextHeaders()});return detail.ok?await detail.json():null;}));}
function refundCapacity(order,refunds){const valid=refunds.filter(item=>item&&item.refund.status!=='CANCELLED');const lines=valid.flatMap(item=>item.lines);const payments=valid.flatMap(item=>item.payments);return {lines:order.lines.map(line=>({...line,remainingCents:Math.max(0,Number(line.lineAmountCents)-remainingBy(lines,'orderLineId',line.id,'refundCents'))})),payments:order.payments.map(payment=>({...payment,remainingCents:Math.max(0,Number(payment.amountCents)-remainingBy(payments,'originalPaymentId',payment.id,'amountCents'))}))};}
function allocateRefundAmounts(totalCents, lines){
  const available=lines.filter(line=>Number(line.remainingCents)>0);
  const capacity=available.reduce((sum,line)=>sum+Number(line.remainingCents),0);
  const total=Math.max(0,Math.min(Number(totalCents)||0,capacity));
  const allocations=new Map(available.map(line=>[String(line.id),0]));
  if(!total||!capacity)return allocations;
  let assigned=0;
  const remainders=available.map(line=>{
    const remaining=Number(line.remainingCents);
    const numerator=total*remaining;
    const base=Math.floor(numerator/capacity);
    allocations.set(String(line.id),base);
    assigned+=base;
    return {id:String(line.id),remainder:numerator%capacity,remaining};
  });
  let left=total-assigned;
  remainders.sort((leftLine,rightLine)=>rightLine.remainder-leftLine.remainder||rightLine.remaining-leftLine.remaining||leftLine.id.localeCompare(rightLine.id));
  for(let index=0;left>0&&index<remainders.length;index++){
    const item=remainders[index];
    const current=allocations.get(item.id)||0;
    if(current<item.remaining){allocations.set(item.id,current+1);left--;}
  }
  if(total>=available.length){
    for(const item of available){
      if((allocations.get(String(item.id))||0)>0)continue;
      const donor=available.slice().sort((leftLine,rightLine)=>(allocations.get(String(rightLine.id))||0)-(allocations.get(String(leftLine.id))||0)).find(candidate=>(allocations.get(String(candidate.id))||0)>1);
      if(!donor)break;
      const donorId=String(donor.id);
      allocations.set(donorId,(allocations.get(donorId)||0)-1);
      allocations.set(String(item.id),1);
    }
  }
  return allocations;
}
function renderRefundHistory(refunds){if(!refunds.length)return'<p class="empty-state refund-empty">暂无退款或红冲记录</p>';return `<section class="refund-history"><h3>退款与红冲记录</h3>${refunds.map(item=>{if(!item)return'';const r=item.refund;const pending=item.payments.filter(payment=>payment.status==='PENDING');const canCancel=r.status==='PENDING'&&!item.payments.some(payment=>payment.status==='COMPLETED');const signed=Number(r.signedTotalCents||-r.totalCents);const actor=`申请：${r.requestedByNameSnapshot||'—'}${r.completedByNameSnapshot?` · 完成：${r.completedByNameSnapshot}`:''}`;return `<div class="refund-history-row"><span><b>${roomTransferEscape(refundKindLabel[r.refundKind]||r.refundKind)} · ${roomTransferEscape(r.refundNo)}</b><small>${roomTransferEscape(r.reason)} · ${roomTransferEscape(actor)} · ${new Date(r.createdAt).toLocaleString('zh-CN')}</small></span><em class="refund-signed-amount">${signedMoneyCents(signed)} · ${r.status==='PENDING'?'待确认退款':r.status==='COMPLETED'?'已完成':'已取消'}</em>${pending.map(payment=>`<button class="record-delete edit-technician" data-confirm-refund="${roomTransferEscape(r.id)}" data-refund-payment="${roomTransferEscape(payment.id)}">确认${roomTransferEscape(paymentMethodLabel[payment.paymentMethod]||payment.paymentMethod)}退款</button>`).join('')}${canCancel?`<button class="record-delete" data-cancel-refund="${roomTransferEscape(r.id)}">取消申请</button>`:''}</div>`;}).join('')}</section>`;}
function serviceTraceLabel(line){if(!line.serviceSessionId)return'手工添加项目';const ended=line.serviceEndedAt?`${formatSessionTime(line.serviceEndedAt)} 完成`:'已完成服务';return `${line.technicianName||'技师'} · ${clockTypeLabels[line.clockType]||line.clockType||'排钟'} · ${line.roomCode||'—'} 房 · ${ended}`;}
function renderBusinessCorrections(corrections){
  const rows=Array.isArray(corrections)?corrections:[];
  if(!rows.length)return'';
  const clock=value=>clockTypeLabels[value]||value||'—';
  const amount=value=>money(Number(value||0)/100);
  return `<section class="business-correction-history"><div class="business-correction-history-heading"><h3>改单记录</h3><small>每次更正已合并原提成冲回与新提成结果</small></div>${rows.map(item=>`<article class="business-correction-history-row"><div class="business-correction-history-meta"><b>第 ${Number(item.version||0)} 次更正</b><small>${item.correctedAt?new Date(item.correctedAt).toLocaleString('zh-CN'):''} · ${memberBusinessEscape(item.correctedByNameSnapshot||'—')}</small></div><div class="business-correction-change"><div class="business-correction-side"><span>原记录</span><b>${memberBusinessEscape(item.oldTechnicianName||'—')} · ${clock(item.oldClockType)}</b><small>项目业绩 ${amount(item.oldBaseAmountCents)} · 提成 ${amount(item.oldCommissionCents)}</small></div><strong aria-hidden="true">→</strong><div class="business-correction-side is-new"><span>更正后</span><b>${memberBusinessEscape(item.newTechnicianName||'—')} · ${clock(item.newClockType)}</b><small>项目业绩 ${amount(item.newBaseAmountCents)} · 提成 ${amount(item.newCommissionCents)}</small></div></div><p class="business-correction-history-reason">原因：${memberBusinessEscape(item.reason||'未填写')}</p></article>`).join('')}</section>`;
}
async function openOrderDetail(orderId){const [orderResponse,refunds]=await Promise.all([fetch(`http://localhost:8080/api/v1/sales-orders/${orderId}`,{headers:storeContextHeaders()}),loadRefundDetails(orderId)]);if(!orderResponse.ok)return toast('订单明细加载失败');const detail=await orderResponse.json();activeOrderDetail={detail,refunds:refunds.filter(Boolean)};const capacity=refundCapacity(detail,activeOrderDetail.refunds);const canRefund=detail.order.refundStatus!=='FULL'&&capacity.lines.some(line=>line.remainingCents>0)&&capacity.payments.some(payment=>payment.remainingCents>0);const refundActions=hasAdminPermission('ORDER_REFUND')?`<button class="button danger" type="button" data-refund-kind="FULL_REVERSAL" ${canRefund?'':'disabled'}>整单退款</button>`:'';const businessAllowed=detail.order.status==='SETTLED'&&detail.order.refundStatus==='NONE'&&!activeOrderDetail.refunds.length;document.querySelector('#order-detail-content').innerHTML=`<div class="order-detail-summary"><span><b>${memberBusinessEscape(detail.order.orderNo)}</b><small>结算单号：${memberBusinessEscape(detail.order.settlementNo||'—')} · ${roomTransferEscape(refundStatusLabel[detail.order.refundStatus]||'未退款')}</small></span><div class="order-detail-actions"><button class="button secondary" type="button" id="print-order-receipt">重新打印</button>${refundActions}</div></div><div class="member-results order-detail-list">${detail.lines.map(line=>`<div class="member-result"><span><b>${memberBusinessEscape(line.itemNameSnapshot)}</b><small>${roomTransferEscape(serviceTraceLabel(line))} · ${roomTransferEscape(line.durationMinutes)} 分钟 · 可退 ${money((capacity.lines.find(item=>item.id===line.id)?.remainingCents||0)/100)}</small><span class="order-line-actions">${line.serviceSessionId?`<button class="text-button order-service-history" type="button" data-order-service-history="${roomTransferEscape(line.serviceSessionId)}">查看服务变更</button>`:''}${line.serviceSessionId?`<button class="text-button" type="button" data-business-correct-line="${roomTransferEscape(line.id)}" ${businessAllowed&&Number(line.participantCount)===1?'':'disabled'}>更正技师/钟类</button>`:''}</span></span><em>${money(line.lineAmountCents/100)}</em></div>`).join('')}${detail.payments.map(payment=>`<div class="member-result"><span><b>${memberBusinessEscape(paymentMethodLabel[payment.paymentMethod]||payment.paymentMethod)}</b><small>支付记录 · 可退 ${money((capacity.payments.find(item=>item.id===payment.id)?.remainingCents||0)/100)}</small></span><em>${money(payment.amountCents/100)}</em></div>`).join('')}</div>${renderBusinessCorrections(detail.businessCorrections)}${renderRefundHistory(activeOrderDetail.refunds)}`;document.querySelector('#order-detail-dialog').showModal();}
const openOrderDetailBeforeVoidAction=openOrderDetail;
async function openBusinessCorrection(lineId){const detail=activeOrderDetail?.detail;const line=detail?.lines?.find(item=>String(item.id)===String(lineId));if(!detail||!line||!line.serviceSessionId)return;businessCorrectionLine=line;const form=document.querySelector('#business-correction-form');form.reset();form.technicianId.innerHTML=state.technicians.filter(item=>item.state==='available'||String(item.id)===String(line.technicianId)).map(item=>`<option value="${roomTransferEscape(item.id)}" ${String(item.id)===String(line.technicianId)?'selected':''}>${memberBusinessEscape(item.code||'')} · ${memberBusinessEscape(item.name)}</option>`).join('');form.clockType.value=['CALL','BOOKED_CALL'].includes(line.clockType)?'CALL':'QUEUE';document.querySelector('#business-correction-summary').innerHTML=`<b>${memberBusinessEscape(line.itemNameSnapshot)}</b><small>${roomTransferEscape(serviceTraceLabel(line))} · 订单 ${memberBusinessEscape(detail.order.orderNo)}</small>`;document.querySelector('#business-correction-dialog').showModal();}
document.querySelector('#business-correction-form').addEventListener('submit',async event=>{event.preventDefault();const line=businessCorrectionLine;const detail=activeOrderDetail?.detail;if(!line||!detail)return;const form=new FormData(event.currentTarget);const reason=String(form.get('reason')||'').trim();if(!reason)return toast('修改原因不能为空');const response=await fetch(`http://localhost:8080/api/v1/sales-orders/${detail.order.id}/business-corrections`,{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({orderLineId:line.id,technicianId:form.get('technicianId'),clockType:form.get('clockType'),reason,expectedVersion:Number(detail.order.businessCorrectionVersion||0)})});if(!response.ok){const message=(await response.text()).replace(/^"|"$/g,'');return toast(`修改失败：${message||'订单状态已变化，请刷新'}`);}document.querySelector('#business-correction-dialog').close();businessCorrectionLine=null;await openOrderDetail(detail.order.id);await Promise.all([loadSalesOrders(),loadTechnicianPerformance(),loadDailyReport(),loadFoundationData({silent:true})]);toast('订单技师和钟类已更新，提成已按新规则重算');});
document.querySelector('#close-business-correction').addEventListener('click',()=>document.querySelector('#business-correction-dialog').close());
document.querySelector('#cancel-business-correction').addEventListener('click',()=>document.querySelector('#business-correction-dialog').close());
openOrderDetail=async function(orderId){
  await openOrderDetailBeforeVoidAction(orderId);
  const order=activeOrderDetail?.detail?.order;
  if(!order||String(order.id)!==String(orderId))return;
  const summary= document.querySelector('#order-detail-content .order-detail-summary small');
  if(summary&&order.status==='CANCELLED')summary.textContent=`结算单号：${order.settlementNo||'—'} · 已作废${order.cancelReason?` · ${order.cancelReason}`:''}`;
  const actions=document.querySelector('#order-detail-content .order-detail-actions');
  const canVoid=order.status!=='CANCELLED'&&Number(order.paidCents||0)===0&&order.refundStatus==='NONE';
  if(actions&&canVoid&&hasAdminPermission('ORDER_REFUND'))actions.insertAdjacentHTML('beforeend',`<button class="button danger" type="button" data-order-void="${roomTransferEscape(order.id)}">作废订单</button>`);
  if(actions&&hasAdminPermission('ORDER_REFUND')){
    const terminal=order.status==='CANCELLED'||order.refundStatus==='FULL';
    const label=terminal?'重新结算':Number(order.paidCents||0)>0?'红冲后修正':'修改订单';
    actions.insertAdjacentHTML('beforeend',`<button class="button primary" type="button" data-order-correct="${roomTransferEscape(order.id)}">${label}</button>`);
    const financialAllowed=order.status==='SETTLED'&&order.refundStatus==='NONE'&&!activeOrderDetail.refunds.length;
    actions.insertAdjacentHTML('beforeend',`<button class="button secondary" type="button" data-order-financial-correct="${roomTransferEscape(order.id)}" ${financialAllowed?'':'disabled'}>更正收款</button>`);
  }
  if(order.correctedFromOrderId){
    const detailList=document.querySelector('#order-detail-content .order-detail-list');
    detailList?.insertAdjacentHTML('beforebegin',`<div class="pending-service-void-warning"><b>修正来源：${memberBusinessEscape(order.correctedFromOrderNo||'原订单')}</b><br>${memberBusinessEscape(order.correctionReason||'未填写修正原因')}</div>`);
  }
};
function updateRefundPreview(){if(!activeRefundContext)return;const selected=[...document.querySelectorAll('[data-refund-amount]')].filter(input=>input.closest('.refund-line-choice').querySelector('input[type="checkbox"]').checked);const total=selected.reduce((sum,input)=>sum+yuanToCents(input.value),0);const full=activeRefundContext.refundKind==='FULL_REVERSAL';const fullHasZeroLine=full&&selected.some(input=>yuanToCents(input.value)<=0);let left=total;const allocations=[];for(const payment of activeRefundContext.capacity.payments){if(left<=0)break;const amount=Math.min(left,payment.remainingCents);if(amount>0)allocations.push({...payment,amount});left-=amount;}document.querySelector('#refund-total').textContent=`-${money(total/100)}`;document.querySelector('#refund-payment-preview').innerHTML=total?allocations.map(item=>`<span>${roomTransferEscape(paymentMethodLabel[item.paymentMethod]||item.paymentMethod)}<b>-${money(item.amount/100)}</b></span>`).join('')+(left?'<small class="refund-warning">原支付可退款金额不足</small>':'')+(fullHasZeroLine?'<small class="refund-warning">金额过低，暂不支持为每个剩余项目分配至少 0.01 元</small>':''):'<small>选择退款项目后显示原路退回方式</small>';document.querySelector('#submit-refund').disabled=total<=0||left>0||fullHasZeroLine;}
function openRefundDialog(refundKind='FULL_REVERSAL'){if(!activeOrderDetail||!hasAdminPermission('ORDER_REFUND'))return;const capacity=refundCapacity(activeOrderDetail.detail,activeOrderDetail.refunds);const full=true;activeRefundContext={...activeOrderDetail,capacity,refundKind:'FULL_REVERSAL'};const form=document.querySelector('#refund-form');form.reset();document.querySelector('#refund-dialog-eyebrow').textContent='订单原路退款';document.querySelector('#refund-dialog-title').textContent=`${activeOrderDetail.detail.order.orderNo} · 整单退款`;document.querySelector('#refund-dialog-note').textContent='系统将按全部剩余可退金额原路退款，退款完成后整笔冲回技师业绩和提成。';document.querySelector('#refund-total-label').textContent='退款金额';document.querySelector('#submit-refund').textContent='确认整单退款';const fullTotal=capacity.payments.reduce((sum,payment)=>sum+Number(payment.remainingCents||0),0);const fullAllocations=allocateRefundAmounts(fullTotal,capacity.lines);document.querySelector('#refund-draft-lines').innerHTML=capacity.lines.map(line=>{const available=line.remainingCents>0;const selected=available;const amountCents=fullAllocations.get(String(line.id))||0;return `<label class="refund-line-choice ${selected?'is-selected ':''}${available?'':'is-exhausted'}"><input type="checkbox" ${selected?'checked':''} disabled><span><b>${roomTransferEscape(line.itemNameSnapshot)}</b><small>${roomTransferEscape(serviceTraceLabel(line))} · 订单金额 ${money(line.lineAmountCents/100)}，本次整单退款 ${money(amountCents/100)}</small></span><input data-refund-amount data-order-line="${roomTransferEscape(line.id)}" type="number" min="0.01" max="${(line.remainingCents/100).toFixed(2)}" step="0.01" value="${(amountCents/100).toFixed(2)}" readonly></label>`;}).join('');updateRefundPreview();document.querySelector('#refund-dialog').showModal();}

function formatSessionTime(value) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

const serviceChangeTypeLabel = {
  SERVICE_ITEM_CHANGED:'更换项目', EXTENSION_ADDED:'服务加钟', EXTENSION_CANCELLED:'客人退钟',
  DURATION_CHANGED:'调整时长', ROOM_TRANSFER:'更换房间', TECHNICIAN_CHANGED:'更换技师'
};

function ensureServiceChangeHistoryDialog() {
  if (document.querySelector('#service-change-history-dialog')) return;
  document.body.insertAdjacentHTML('beforeend', '<dialog id="service-change-history-dialog"><section class="dialog-card service-change-history-card"><div class="dialog-heading"><div><p class="eyebrow">服务过程审计</p><h2 id="service-change-history-title">变更记录</h2></div><button class="icon-button" type="button" id="close-service-change-history" aria-label="关闭">×</button></div><div class="service-change-history-list" id="service-change-history-list"></div><div class="dialog-actions"><button class="button secondary" type="button" id="done-service-change-history">关闭</button></div></section></dialog>');
  document.querySelector('#close-service-change-history').addEventListener('click', () => document.querySelector('#service-change-history-dialog').close());
  document.querySelector('#done-service-change-history').addEventListener('click', () => document.querySelector('#service-change-history-dialog').close());
}

async function openServiceChangeHistory(sessionId) {
  ensureServiceChangeHistoryDialog();
  const session = state.serviceSessions.find(item => String(item.id) === String(sessionId)) || state.activeSessions.find(item => String(item.id) === String(sessionId));
  document.querySelector('#service-change-history-title').textContent = session ? `${session.roomCode} 房 · ${session.serviceNameSnapshot}` : '服务变更记录';
  const target = document.querySelector('#service-change-history-list');
  target.innerHTML = '<p class="table-empty">正在加载变更记录</p>';
  document.querySelector('#service-change-history-dialog').showModal();
  const response = await fetch(`http://localhost:8080/api/v1/service-sessions/${sessionId}/change-history`, { headers:storeContextHeaders() });
  if (!response.ok) { target.innerHTML = '<p class="table-empty">变更记录加载失败</p>'; return; }
  const rows = await response.json();
  target.innerHTML = rows.map(row => `<article class="service-change-history-row"><span class="service-change-type type-${roomTransferEscape(String(row.eventType || '').toLowerCase())}">${serviceChangeTypeLabel[row.eventType] || roomTransferEscape(row.eventType)}</span><div><b>${roomTransferEscape(row.detail || '服务资料已调整')}</b><small>${roomTransferEscape(row.reason || '未填写原因')}</small><em>${roomTransferEscape(row.actorName || '系统')} · ${new Date(row.changedAt).toLocaleString('zh-CN')}</em></div></article>`).join('') || '<p class="table-empty">该服务暂时没有变更记录</p>';
}

let serviceChangeQueryRows = [];
const serviceChangeDateValue = date => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);

function setupServiceChangeHistoryCenter() {
  if (document.querySelector('#service-change-query-panel')) return;
  const servicePanel = document.querySelector('#management-view #service-session-record-panel');
  servicePanel.insertAdjacentHTML('afterend', '<section class="panel admin-table-panel service-change-query-panel" id="service-change-query-panel"><div class="admin-toolbar"><div><h2>服务变更记录</h2><p>汇总更换项目、加钟、退钟、换房、换技师和时长调整</p></div><button class="button secondary" type="button" id="export-service-change-history">导出 Excel</button></div><div class="service-change-query-filters"><label>开始日期<input id="service-change-from" type="date"></label><label>结束日期<input id="service-change-to" type="date"></label><label>门店<select id="service-change-store"><option value="">全部可管理门店</option></select></label><label>技师<select id="service-change-technician"><option value="">全部技师</option></select></label><label>操作类型<select id="service-change-type"><option value="ALL">全部类型</option><option value="SERVICE_ITEM_CHANGED">更换项目</option><option value="EXTENSION_ADDED">服务加钟</option><option value="EXTENSION_CANCELLED">客人退钟</option><option value="DURATION_CHANGED">调整时长</option><option value="ROOM_TRANSFER">更换房间</option><option value="TECHNICIAN_CHANGED">更换技师</option></select></label><button class="button primary" type="button" id="search-service-change-history">查询</button></div><div class="ledger-table-wrap"><table><thead><tr><th>时间</th><th>门店</th><th>类型</th><th>技师/房间</th><th>项目/订单</th><th>变更内容</th><th>原因</th><th>操作人</th><th>详情</th></tr></thead><tbody id="service-change-query-records"><tr><td colspan="9" class="table-empty">选择条件后查询</td></tr></tbody></table></div></section>');
  const today = new Date(); const from = new Date(today); from.setDate(from.getDate()-29);
  document.querySelector('#service-change-from').value = serviceChangeDateValue(from);
  document.querySelector('#service-change-to').value = serviceChangeDateValue(today);
  document.querySelector('#search-service-change-history').addEventListener('click', loadServiceChangeHistoryCenter);
  document.querySelector('#export-service-change-history').addEventListener('click', exportServiceChangeHistoryCenter);
  document.querySelector('#service-change-store').addEventListener('change', loadServiceChangeTechnicians);
  document.querySelector('#service-change-query-records').addEventListener('click', event => { const button=event.target.closest('[data-service-change-session]'); if(button) openServiceChangeHistory(button.dataset.serviceChangeSession); });
}

function renderServiceChangeStoreOptions() {
  setupServiceChangeHistoryCenter();
  const select = document.querySelector('#service-change-store');
  const current = select.value;
  select.innerHTML = `<option value="">全部可管理门店</option>${(selectableStores || []).map(store => `<option value="${roomTransferEscape(store.id)}">${roomTransferEscape(store.name)}</option>`).join('')}`;
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

async function loadServiceChangeTechnicians() {
  const storeId = document.querySelector('#service-change-store').value;
  const select = document.querySelector('#service-change-technician');
  select.innerHTML = '<option value="">全部技师</option>';
  if (!storeId) return;
  const headers = { ...storeContextHeaders(), 'X-Store-Id':storeId };
  const response = await fetch('http://localhost:8080/api/v1/foundation/technicians', { headers });
  if (!response.ok) return;
  const rows = await response.json();
  select.innerHTML += rows.map(item => `<option value="${roomTransferEscape(item.id)}">${roomTransferEscape(item.code)} · ${roomTransferEscape(item.name)}</option>`).join('');
}

function serviceChangeQueryParams() {
  const params = new URLSearchParams({ from:document.querySelector('#service-change-from').value, to:document.querySelector('#service-change-to').value, type:document.querySelector('#service-change-type').value });
  const store = document.querySelector('#service-change-store').value;
  const technician = document.querySelector('#service-change-technician').value;
  if (store) params.set('storeId', store);
  if (technician) params.set('technicianId', technician);
  return params;
}

async function loadServiceChangeHistoryCenter() {
  setupServiceChangeHistoryCenter();
  const target = document.querySelector('#service-change-query-records');
  target.innerHTML = '<tr><td colspan="9" class="table-empty">正在查询服务变更记录</td></tr>';
  const response = await fetch(`http://localhost:8080/api/v1/service-change-history?${serviceChangeQueryParams()}`, { headers:adminHeaders() });
  if (!response.ok) { target.innerHTML = '<tr><td colspan="9" class="table-empty">服务变更记录查询失败</td></tr>'; return; }
  serviceChangeQueryRows = await response.json();
  target.innerHTML = serviceChangeQueryRows.map(row => `<tr><td>${new Date(row.changedAt).toLocaleString('zh-CN')}</td><td>${roomTransferEscape(row.storeName)}</td><td><span class="service-change-type type-${roomTransferEscape(String(row.eventType).toLowerCase())}">${roomTransferEscape(serviceChangeTypeLabel[row.eventType] || row.eventType)}</span></td><td><b>${roomTransferEscape(row.technicianName)}</b><small class="muted-cell">${roomTransferEscape(row.roomCode)} 房</small></td><td><b>${roomTransferEscape(row.serviceNameSnapshot)}</b><small class="muted-cell">${roomTransferEscape(row.orderNo || '未结算')}</small></td><td class="service-change-detail-cell">${roomTransferEscape(row.detail)}</td><td>${roomTransferEscape(row.reason || '—')}</td><td>${roomTransferEscape(row.actorName || '系统')}</td><td><button class="text-button" type="button" data-service-change-session="${roomTransferEscape(row.serviceSessionId)}">查看服务</button></td></tr>`).join('') || '<tr><td colspan="9" class="table-empty">所选条件没有服务变更记录</td></tr>';
}

async function exportServiceChangeHistoryCenter() {
  const response = await fetch(`http://localhost:8080/api/v1/service-change-history/export?${serviceChangeQueryParams()}`, { headers:adminHeaders() });
  if (!response.ok) return toast('服务变更记录导出失败');
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const link=document.createElement('a');
  link.href=url; link.download=`服务变更记录_${document.querySelector('#service-change-from').value}_至_${document.querySelector('#service-change-to').value}.xlsx`; link.click();
  URL.revokeObjectURL(url); toast('服务变更记录已导出');
}

function renderServiceSessions() {
  const keyword = document.querySelector('#service-session-search').value.trim().toLowerCase();
  const filtered = state.serviceSessions.filter(session => {
    const matchesStatus = serviceSessionFilter === 'ALL' || session.status === serviceSessionFilter;
    const searchable = `${session.serviceNo||''} ${session.orderNo||''} ${session.settlementNo||''} ${session.technicianName} ${session.roomCode} ${session.serviceNameSnapshot} ${session.paymentMethods||''}`.toLowerCase();
    return matchesStatus && (!keyword || searchable.includes(keyword));
  });
  const completed = filtered.filter(session => session.status === 'COMPLETED');
  document.querySelector('#service-session-count').textContent = `${filtered.length} 条服务记录`;
  document.querySelector('#service-session-total').textContent = money(completed.reduce((sum, session) => sum + (session.servicePriceCents + (session.extensionTotalCents || 0)) / 100, 0));
  document.querySelector('#service-session-records').innerHTML = filtered.map(session => {
  const status = { PENDING_ACCEPTANCE: ['待接单', 'pending'], REASSIGNMENT_REQUIRED: ['待重新派单', 'reassignment'], DISPATCH_CANCELLED: ['待与客沟通', 'reassignment'], ACCEPTED: ['已接单', 'pending'], IN_SERVICE: ['服务中', 'in-service'], COMPLETED: ['已完成', 'completed'], CANCELLED: ['已取消', 'cancelled'], VOIDED: ['已作废', 'cancelled'] }[session.status] || [session.status, 'cancelled'];
  const clockType = clockTypeLabels[session.clockType] || session.clockType;
    const extension = session.extensionSummary ? ` · 加钟：${session.extensionSummary}` : '';
    const total = session.servicePriceCents + (session.extensionTotalCents || 0);
    const receivable = session.receivableCents == null ? total : session.receivableCents;
    const paid = session.paidCents == null ? null : session.paidCents;
    const commission = session.settlementNo ? money(Number(session.commissionCents||0)/100) : '—';
  const durationAction = session.status === 'IN_SERVICE' && hasAdminPermission('SERVICE_DURATION_OVERRIDE')
    ? `<button type="button" class="text-button" data-duration-session="${roomTransferEscape(session.id)}">调整时长</button>` : '<span class="muted-cell">-</span>';
  return `<tr><td><b>${memberBusinessEscape(session.serviceNo||String(session.id).slice(0,8))}</b></td><td>${formatServiceDateTime(session.startedAt)}</td><td>${formatServiceDateTime(session.endedAt)}</td><td><b>${memberBusinessEscape(session.orderNo||'未结算')}</b><small class="muted-cell">${memberBusinessEscape(session.settlementNo||'—')}</small></td><td><b>${memberBusinessEscape(session.technicianName)}</b><small class="muted-cell">${memberBusinessEscape(session.roomCode)} 房</small></td><td><span class="record-type ${isCallClockType(session.clockType) ? 'consumption' : 'order'}">${roomTransferEscape(clockType)}</span><small class="service-item-detail">${memberBusinessEscape(session.serviceNameSnapshot+extension)}</small></td><td class="amount-cell">${money(receivable/100)}</td><td class="amount-cell">${paid==null?'—':money(paid/100)}</td><td>${memberBusinessEscape(session.paymentMethods||'未结算')}</td><td class="amount-cell commission-amount">${commission}</td><td><span class="service-status ${roomTransferEscape(status[1])}">${roomTransferEscape(status[0])}</span></td><td><div class="service-record-actions">${durationAction}<button type="button" class="text-button" data-change-history-session="${roomTransferEscape(session.id)}">变更记录</button></div></td></tr>`;
  }).join('') || '<tr><td class="table-empty" colspan="12">没有符合条件的服务记录</td></tr>';
}

function formatServiceDateTime(value){return value?new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'—';}

async function loadServiceSessions() {
  const params=new URLSearchParams();
  const from=document.querySelector('#service-session-from')?.value;
  const to=document.querySelector('#service-session-to')?.value;
  if(from)params.set('from',new Date(from).toISOString());
  if(to)params.set('to',new Date(to).toISOString());
  if(from&&to&&new Date(from)>new Date(to)){toast('服务记录开始时间不能晚于结束时间');return;}
  const response = await fetch(`http://localhost:8080/api/v1/service-sessions?${params.toString()}`, { headers: storeContextHeaders() });
  if (!response.ok) { toast('服务记录加载失败'); return; }
  state.serviceSessions = await response.json();
  renderServiceSessions();
}

let orderCommissionRecords=[];
let orderCommissionAdjustments=[];
function commissionRuleLabel(record){if(record.ruleType==='PERCENT')return `${Number(record.ruleRateBp||0)/100}%`;if(record.ruleType==='FIXED')return `固定 ${money(Number(record.ruleFixedCents||0)/100)}`;return '未设置';}
function renderOrderCommissionRecords(){
  const keyword=document.querySelector('#commission-record-search').value.trim().toLowerCase();
  const rows=orderCommissionRecords.filter(row=>!keyword||`${row.orderNoSnapshot||''} ${row.settlementNoSnapshot||''} ${row.technicianNameSnapshot||''} ${row.serviceNameSnapshot||''}`.toLowerCase().includes(keyword));
  document.querySelector('#commission-record-count').textContent=String(rows.length);
  document.querySelector('#commission-record-base').textContent=money(rows.reduce((sum,row)=>sum+Number(row.baseAmountCents||0),0)/100);
  document.querySelector('#commission-record-total').textContent=money(rows.reduce((sum,row)=>sum+Number(row.commissionCents||0),0)/100);
  document.querySelector('#commission-records').innerHTML=rows.map(row=>{const source=row.sourceType==='EXTENSION'?'加钟':(clockTypeLabels[row.clockType]||row.clockType);return `<tr><td>${formatServiceDateTime(row.settledAt)}</td><td><b>${memberBusinessEscape(row.orderNoSnapshot||'—')}</b></td><td>${memberBusinessEscape(row.settlementNoSnapshot||'—')}</td><td>${memberBusinessEscape(row.technicianNameSnapshot||'—')}</td><td>${memberBusinessEscape(row.serviceNameSnapshot||'—')}</td><td><span class="record-type ${isCallClockType(row.clockType)?'consumption':'order'}">${memberBusinessEscape(source)}</span>${row.recordType==='BUSINESS_CORRECTION'?'<small class="muted-cell">改单后有效</small>':''}</td><td class="amount-cell">${money(Number(row.baseAmountCents||0)/100)}</td><td>${commissionRuleLabel(row)}${row.commissionTierNameSnapshot?`<small class="muted-cell">${memberBusinessEscape(row.commissionTierNameSnapshot)}</small>`:''}</td><td class="amount-cell commission-amount">${money(Number(row.commissionCents||0)/100)}</td></tr>`;}).join('')||'<tr><td colspan="9" class="table-empty">所选时间没有有效提成记录</td></tr>';
}
const commissionAdjustmentTypeLabel={REFUND_REVERSAL:'退款冲回',ORDER_VOID_REVERSAL:'作废冲回',BUSINESS_CORRECTION_REVERSAL:'改单冲回'};
function renderOrderCommissionAdjustments(){
  const keyword=document.querySelector('#commission-record-search').value.trim().toLowerCase();
  const rows=orderCommissionAdjustments.filter(row=>!keyword||`${row.orderNoSnapshot||''} ${row.settlementNoSnapshot||''} ${row.technicianNameSnapshot||''} ${row.serviceNameSnapshot||''} ${row.adjustmentReferenceNo||''} ${row.adjustmentReason||''}`.toLowerCase().includes(keyword));
  document.querySelector('#commission-adjustment-count').textContent=String(rows.length);
  document.querySelector('#commission-adjustment-base').textContent=signedMoneyCents(rows.reduce((sum,row)=>sum+Number(row.baseAmountCents||0),0));
  document.querySelector('#commission-adjustment-total').textContent=signedMoneyCents(rows.reduce((sum,row)=>sum+Number(row.commissionCents||0),0));
  document.querySelector('#commission-adjustments').innerHTML=rows.map(row=>`<tr><td>${formatServiceDateTime(row.settledAt)}</td><td><b>${memberBusinessEscape(row.adjustmentReferenceNo||row.orderNoSnapshot||'—')}</b><small class="muted-cell">${memberBusinessEscape(row.orderNoSnapshot||'—')}</small></td><td>${memberBusinessEscape(row.settlementNoSnapshot||'—')}</td><td>${memberBusinessEscape(row.technicianNameSnapshot||'—')}</td><td>${memberBusinessEscape(row.serviceNameSnapshot||'—')}</td><td><span class="record-type refund-state">${roomTransferEscape(commissionAdjustmentTypeLabel[row.recordType]||'提成调整')}</span></td><td class="amount-cell refund-signed-amount">${signedMoneyCents(row.baseAmountCents)}</td><td class="amount-cell refund-signed-amount">${signedMoneyCents(row.commissionCents)}</td><td>${memberBusinessEscape(row.adjustmentReason||'系统调整')}</td></tr>`).join('')||'<tr><td colspan="9" class="table-empty">所选时间没有提成调整记录</td></tr>';
}
async function loadOrderCommissionRecords(){
  const fromInput=document.querySelector('#commission-record-from');
  const toInput=document.querySelector('#commission-record-to');
  if(!fromInput.value||!toInput.value){const now=new Date();const first=new Date(now.getFullYear(),now.getMonth(),1);fromInput.value=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}).format(first);toInput.value=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
  if(fromInput.value>toInput.value)return toast('提成开始日期不能晚于结束日期');
  const params=new URLSearchParams({from:fromInput.value,to:toInput.value});
  const [response,adjustmentResponse]=await Promise.all([
    fetch(`http://localhost:8080/api/v1/commissions/records?${params.toString()}`,{headers:storeContextHeaders()}),
    fetch(`http://localhost:8080/api/v1/commissions/adjustments?${params.toString()}`,{headers:storeContextHeaders()})
  ]);
  if(!response.ok){document.querySelector('#commission-records').innerHTML='<tr><td colspan="9" class="table-empty">有效提成加载失败</td></tr>';return;}
  orderCommissionRecords=await response.json();
  orderCommissionAdjustments=adjustmentResponse.ok?await adjustmentResponse.json():[];
  if(!adjustmentResponse.ok)document.querySelector('#commission-adjustments').innerHTML='<tr><td colspan="9" class="table-empty">提成调整记录加载失败</td></tr>';
  renderOrderCommissionRecords();renderOrderCommissionAdjustments();renderTechnicianCommissionSummary();
}

async function overrideServiceDuration(sessionId) {
  const session = (state.serviceSessions || []).find(item => String(item.id) === String(sessionId))
    || state.activeSessions.find(item => String(item.id) === String(sessionId));
  if (!session || !['PENDING_ACCEPTANCE', 'ACCEPTED', 'IN_SERVICE'].includes(session.status)) return toast('当前服务状态不支持调整时长');
  const value = window.prompt(`当前总时长 ${session.plannedDurationMinutes} 分钟，请输入新的总时长`, String(session.plannedDurationMinutes));
  if (value === null) return;
  const minutes = Number.parseInt(value, 10);
  if (!Number.isInteger(minutes) || minutes < 15) return toast('请输入不少于 15 分钟的整数');
  const reason = String(window.prompt('请输入调整原因', '') || '').trim();
  if (!reason) return toast('调整时长必须填写原因');
  const response = await fetch(`http://localhost:8080/api/v1/service-sessions/${sessionId}/duration`, {
    method: 'PUT', headers: storeContextHeaders(true), body: JSON.stringify({ newDurationMinutes: minutes, reason })
  });
  if (!response.ok) return toast('时长调整失败，请检查权限、上限或服务状态');
  await Promise.all([loadServiceSessions(), loadFoundationData({ silent: true })]);
  toast('服务时长已调整并记录审计');
}

function installServiceDurationPolicyControl() {
  const host = document.querySelector('.service-record-toolbar .service-record-metrics');
  if (!host || !hasAdminPermission('SERVICE_DURATION_OVERRIDE') || document.querySelector('#service-duration-policy-button')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'service-duration-policy-button';
  button.className = 'text-button';
  button.textContent = '时长设置';
  button.addEventListener('click', async () => {
    const current = await fetch('http://localhost:8080/api/v1/service-duration-policy', { headers: storeContextHeaders() });
    if (!current.ok) return toast('时长设置加载失败');
    const policy = await current.json();
    const total = window.prompt('单次服务总时长上限（15-1440 分钟）', String(policy.serviceDurationMaxMinutes));
    if (total === null) return;
    const totalMinutes = Number.parseInt(total, 10);
    if (!Number.isInteger(totalMinutes) || totalMinutes < 15 || totalMinutes > 1440) return toast('请检查时长上限设置');
    const response = await fetch('http://localhost:8080/api/v1/service-duration-policy', {
      method: 'PUT', headers: storeContextHeaders(true), body: JSON.stringify({ serviceDurationMaxMinutes: totalMinutes, technicianExtensionMaxMinutes: 0 })
    });
    if (!response.ok) return toast('时长设置保存失败');
    toast('时长设置已保存');
  });
  host.append(button);
}

const initializeAdminSessionBeforeDurationPolicy = initializeAdminSession;
initializeAdminSession = async function () {
  await initializeAdminSessionBeforeDurationPolicy();
  installServiceDurationPolicyControl();
};
installServiceDurationPolicyControl();

let monthlyCommissionTierPolicy = null;
function tierEscape(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character])); }
function ensureMonthlyCommissionTierPanel() {
  if (document.querySelector('#monthly-commission-tier-panel')) return;
  const servicesView = document.querySelector('#services-view');
  const heading = servicesView?.querySelector('.page-heading');
  if (!servicesView || !heading) return;
  heading.insertAdjacentHTML('afterend', `<section class="panel admin-table-panel monthly-tier-panel" id="monthly-commission-tier-panel"><div class="admin-toolbar"><div><h2>月度阶梯提成</h2><p>按技师当月计钟数量命中倍率；项目的排钟、点钟和加钟提成规则继续作为计算基础。</p></div><button class="button secondary" type="button" id="edit-monthly-commission-tiers">设置阶梯</button></div><div id="monthly-commission-tier-summary" class="monthly-tier-summary"><span>登录后加载</span></div></section>`);
  document.body.insertAdjacentHTML('beforeend', `<dialog id="monthly-commission-tier-dialog"><form id="monthly-commission-tier-form" class="dialog-card service-commission-dialog"><div class="dialog-heading"><div><p class="eyebrow">门店提成策略</p><h2>月度阶梯提成</h2></div><button class="icon-button" type="button" id="close-monthly-commission-tier" aria-label="关闭">×</button></div><p class="commission-dialog-note">达到档位后的新结算按该倍率计算；已结算记录保留原档位快照，退款按原快照冲销。</p><label class="commission-effective-date">生效营业日<input name="effectiveBusinessDate" type="date" /><small>留空表示当前营业日生效；未来日期可预约新阶梯。</small></label><label class="monthly-tier-active"><input name="active" type="checkbox" checked /> 启用月度阶梯倍率</label><div id="monthly-tier-editor" class="monthly-tier-editor"></div><button class="button secondary" type="button" id="add-monthly-tier">新增档位</button><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-monthly-commission-tier">取消</button><button class="button primary" type="submit">保存阶梯</button></div></form></dialog>`);
  document.querySelector('#edit-monthly-commission-tiers').addEventListener('click', openMonthlyCommissionTierDialog);
  document.querySelector('#close-monthly-commission-tier').addEventListener('click', () => document.querySelector('#monthly-commission-tier-dialog').close());
  document.querySelector('#cancel-monthly-commission-tier').addEventListener('click', () => document.querySelector('#monthly-commission-tier-dialog').close());
  document.querySelector('#add-monthly-tier').addEventListener('click', () => addMonthlyTierEditorRow());
  document.querySelector('#monthly-tier-editor').addEventListener('click', event => { const remove = event.target.closest('[data-remove-monthly-tier]'); if (remove) remove.closest('.monthly-tier-editor-row')?.remove(); });
  document.querySelector('#monthly-commission-tier-form').addEventListener('submit', saveMonthlyCommissionTiers);
}

function renderMonthlyCommissionTierPolicy() {
  const panel = document.querySelector('#monthly-commission-tier-panel');
  const target = document.querySelector('#monthly-commission-tier-summary');
  if (!panel || !target) return;
  if (!hasAdminPermission('FOUNDATION_MANAGE')) { panel.hidden = true; return; }
  panel.hidden = false;
  const policy = monthlyCommissionTierPolicy?.current;
  if (!policy) { target.innerHTML = '<span>当前门店未加载阶梯策略</span>'; return; }
  const scheduled = monthlyCommissionTierPolicy.scheduled ? `<small>已预约 ${roomTransferEscape(monthlyCommissionTierPolicy.scheduled.effectiveBusinessDate)} 生效的新策略</small>` : '';
  target.innerHTML = `<div><b>${policy.active ? '已启用' : '未启用'}</b><small>${roomTransferEscape(policy.effectiveBusinessDate)} 起生效</small></div><div class="monthly-tier-pills">${policy.tiers.map(tier => `<span><b>${tierEscape(tier.tierName)}</b> ${roomTransferEscape(tier.minimumMonthlyClockCount)}+ 钟 · ${(Number(tier.commissionMultiplierBp) / 100).toFixed(2)}%</span>`).join('')}</div>${scheduled}`;
}

async function loadMonthlyCommissionTierPolicy() {
  ensureMonthlyCommissionTierPanel();
  if (!hasAdminPermission('FOUNDATION_MANAGE')) return renderMonthlyCommissionTierPolicy();
  const response = await fetch('http://localhost:8080/api/v1/commissions/monthly-tiers', { headers: storeContextHeaders() });
  if (!response.ok) { monthlyCommissionTierPolicy = null; renderMonthlyCommissionTierPolicy(); return; }
  monthlyCommissionTierPolicy = await response.json();
  renderMonthlyCommissionTierPolicy();
}

function addMonthlyTierEditorRow(tier = { tierName:'新档位', minimumMonthlyClockCount:0, commissionMultiplierBp:10000 }) {
  const editor = document.querySelector('#monthly-tier-editor');
  if (!editor) return;
  const row = document.createElement('div');
  row.className = 'monthly-tier-editor-row';
  row.innerHTML = `<label>档位名称<input data-tier-name maxlength="80" required value="${tierEscape(tier.tierName)}" /></label><label>起始钟数<input data-tier-minimum type="number" min="0" max="9999" step="1" required value="${roomTransferEscape(tier.minimumMonthlyClockCount)}" /></label><label>提成倍率（%）<input data-tier-multiplier type="number" min="0" max="300" step="0.01" required value="${(Number(tier.commissionMultiplierBp) / 100).toFixed(2)}" /></label><button class="icon-button" type="button" title="删除档位" aria-label="删除档位" data-remove-monthly-tier>×</button>`;
  editor.append(row);
}

function openMonthlyCommissionTierDialog() {
  const policy = monthlyCommissionTierPolicy?.current;
  const form = document.querySelector('#monthly-commission-tier-form');
  form.reset();
  form.elements.active.checked = policy?.active ?? true;
  form.elements.effectiveBusinessDate.value = '';
  document.querySelector('#monthly-tier-editor').innerHTML = '';
  (policy?.tiers || [{ tierName:'基础档', minimumMonthlyClockCount:0, commissionMultiplierBp:10000 }]).forEach(addMonthlyTierEditorRow);
  document.querySelector('#monthly-commission-tier-dialog').showModal();
}

async function saveMonthlyCommissionTiers(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const tiers = [...document.querySelectorAll('.monthly-tier-editor-row')].map(row => ({
    tierName: String(row.querySelector('[data-tier-name]').value || '').trim(),
    minimumMonthlyClockCount: Number.parseInt(row.querySelector('[data-tier-minimum]').value, 10),
    commissionMultiplierBp: Math.round(Number(row.querySelector('[data-tier-multiplier]').value) * 100)
  }));
  if (!tiers.length || tiers.some(tier => !tier.tierName || !Number.isInteger(tier.minimumMonthlyClockCount) || tier.minimumMonthlyClockCount < 0 || !Number.isInteger(tier.commissionMultiplierBp) || tier.commissionMultiplierBp < 0 || tier.commissionMultiplierBp > 30000) || !tiers.some(tier => tier.minimumMonthlyClockCount === 0) || new Set(tiers.map(tier => tier.minimumMonthlyClockCount)).size !== tiers.length) return toast('请设置唯一的起始钟数，并保留 0 钟基础档');
  const body = { active: form.elements.active.checked, effectiveBusinessDate: form.elements.effectiveBusinessDate.value || null, tiers };
  const response = await fetch('http://localhost:8080/api/v1/commissions/monthly-tiers', { method:'PUT', headers:storeContextHeaders(true), body:JSON.stringify(body) });
  if (!response.ok) return toast('阶梯提成保存失败，请检查生效日期和档位');
  document.querySelector('#monthly-commission-tier-dialog').close();
  await loadMonthlyCommissionTierPolicy();
  toast('月度阶梯提成已保存');
}

const initializeAdminSessionBeforeMonthlyTiers = initializeAdminSession;
initializeAdminSession = async function () {
  await initializeAdminSessionBeforeMonthlyTiers();
  await loadMonthlyCommissionTierPolicy();
};
ensureMonthlyCommissionTierPanel();
document.querySelector('[data-view="services"]')?.addEventListener('click', () => loadMonthlyCommissionTierPolicy());

function openServiceDialog() {
  orderServiceCategoryId = 'ALL';
  orderServiceSearch = '';
  document.querySelector('#order-service-search').value = '';
  renderOrderServiceCatalog();
  document.querySelector('#order-dialog').showModal();
}

function renderOrderServiceCatalog() {
  const search = orderServiceSearch.trim().toLowerCase();
  const rows = state.services.filter(service => serviceMatchesCategory(service, orderServiceCategoryId) && (!search || `${service.code || ''} ${service.name} ${service.category} ${serviceCategoryPath(service.categoryId)}`.toLowerCase().includes(search)));
  document.querySelector('#order-service-categories').innerHTML = serviceCategoryNavigation(orderServiceCategoryId, 'order-category');
  document.querySelector('#service-options').innerHTML = rows.map((service, index) => `<button type="button" class="service-option ${index === 0 ? 'selected' : ''}" data-service="${roomTransferEscape(service.id)}"><b>${roomTransferEscape(service.name)}</b><small>${roomTransferEscape(serviceCategoryPath(service.categoryId))} · ${roomTransferEscape(service.duration)}</small><strong>${money(service.price)}</strong></button>`).join('') || '<p class="table-empty">没有匹配的项目</p>';
}

function renderManualServiceTechnicians() {
  const target = document.querySelector('#manual-service-technician-list');
  if (!target || !manualServiceDraft) return;
  const rows = manualServiceDraft.technicians || [];
  const options = state.technicians.filter(item => item.state !== 'off').map(item => `<option value="${memberBusinessEscape(item.id)}">${memberBusinessEscape(item.name)} · 工号 ${memberBusinessEscape(item.code || '未设置')} · ${roomTransferEscape(historicalBackfillTechnicianStates[item.state] || '可用')}</option>`).join('');
  target.innerHTML = rows.map((row, index) => `<div class="manual-service-technician-row" data-manual-technician-row="${index}"><label>技师<select data-manual-technician required>${options}</select></label><label>分配比例<div class="manual-service-percent"><input data-manual-allocation type="number" min="0.01" max="100" step="0.01" value="${(Number(row.allocationBp || 0) / 100).toFixed(2)}" required><em>%</em></div></label><button type="button" class="manual-service-technician-remove" data-manual-remove="${index}" aria-label="移除技师" ${rows.length === 1 ? 'disabled' : ''}>×</button></div>`).join('');
  target.querySelectorAll('[data-manual-technician]').forEach((select, index) => { select.value = String(rows[index].technicianId || ''); });
}

function openManualServiceConfig(service) {
  manualServiceTarget = service;
  manualServiceDraft = {
    clockType: 'QUEUE', duration: Number(service.durationMinutes || 60), roomId: '',
    technicians: state.technicians.filter(item => item.state !== 'off').slice(0, 1).map(item => ({ technicianId: item.id, allocationBp: 10000 }))
  };
  const form = document.querySelector('#manual-service-config-form');
  form.reset(); form.elements.clockType.value = manualServiceDraft.clockType; form.elements.duration.value = manualServiceDraft.duration;
  document.querySelector('#manual-service-config-title').textContent = service.name;
  document.querySelector('#manual-service-config-summary').innerHTML = `<b>${memberBusinessEscape(service.name)}</b><small>${money(service.price)} · 请补充技师、钟类和时长</small>`;
  const rooms = state.rooms.filter(room => room.apiId && room.status === 'idle' && Number(room.availableBedCount || 0) > 0);
  form.elements.roomId.innerHTML = '<option value="">不关联房间</option>' + rooms.map(room => `<option value="${memberBusinessEscape(room.apiId)}">${memberBusinessEscape(room.id)} 房 · ${Number(room.availableBedCount || 0)} 床可用</option>`).join('');
  renderManualServiceTechnicians();
  document.querySelector('#manual-service-config-dialog').showModal();
}

function closeManualServiceConfig() {
  manualServiceTarget = null; manualServiceDraft = null; document.querySelector('#manual-service-config-dialog').close();
}

function syncManualServiceDraftFromForm() {
  if (!manualServiceDraft) return;
  const form = document.querySelector('#manual-service-config-form');
  manualServiceDraft.clockType = form.elements.clockType.value;
  manualServiceDraft.duration = Number(form.elements.duration.value);
  manualServiceDraft.roomId = form.elements.roomId.value || '';
  manualServiceDraft.technicians = [...document.querySelectorAll('[data-manual-technician-row]')].map(row => ({
    technicianId: row.querySelector('[data-manual-technician]').value,
    allocationBp: Math.round(Number(row.querySelector('[data-manual-allocation]').value || 0) * 100)
  }));
}

function renderDispatchServiceCatalog() {
  const search = dispatchServiceSearch.trim().toLowerCase();
  const rows = state.services.filter(service => serviceMatchesCategory(service, dispatchServiceCategoryId) && (!search || `${service.code || ''} ${service.name} ${service.category} ${serviceCategoryPath(service.categoryId)}`.toLowerCase().includes(search)));
  document.querySelector('#dispatch-service-categories').innerHTML = serviceCategoryNavigation(dispatchServiceCategoryId, 'dispatch-category');
  const selectedServiceId = dispatchSelections.get(String(dispatchFocusTechId))?.serviceItemId;
  document.querySelector('#dispatch-service-list').innerHTML = rows.map(service => `<button class="dispatch-service-choice ${String(service.id) === String(selectedServiceId) ? 'selected' : ''}" data-dispatch-service="${roomTransferEscape(service.id)}" type="button"><span><b>${roomTransferEscape(service.name)}</b><small>${roomTransferEscape(serviceCategoryPath(service.categoryId))} · ${roomTransferEscape(service.duration)}</small></span><strong>${money(service.price)}</strong></button>`).join('') || '<p class="table-empty">没有匹配的项目</p>';
}

function renderDispatchSelection() {
  const selectedTechs = clockingTechIds.map(id => state.technicians.find(item => String(item.id) === String(id))).filter(Boolean);
  const fallbackServiceId = document.querySelector('#clock-service')?.value || state.services[0]?.id || '';
  const fallbackClockType = document.querySelector('#clock-type')?.value || 'QUEUE';
  const defaultSelection = dispatchDefaultSelection || { serviceItemId:fallbackServiceId, clockType:fallbackClockType, durationMinutes:Number(document.querySelector('#clock-duration')?.value || 60) };
  selectedTechs.forEach((tech) => {
    if (!dispatchSelections.has(String(tech.id))) dispatchSelections.set(String(tech.id), {
      serviceItemId: defaultSelection.serviceItemId,
      clockType: defaultSelection.clockType,
      durationMinutes: defaultSelection.durationMinutes
    });
  });
  [...dispatchSelections.keys()].forEach(id => { if (!clockingTechIds.some(value => String(value) === id)) dispatchSelections.delete(id); });
  if (!dispatchFocusTechId || !clockingTechIds.some(id => String(id) === String(dispatchFocusTechId))) dispatchFocusTechId = clockingTechIds[0] || null;
  const focusSelection = dispatchSelections.get(String(dispatchFocusTechId));
  const service = state.services.find(item => String(item.id) === String(focusSelection?.serviceItemId || fallbackServiceId));
  document.querySelector('#clock-tech-name').textContent = selectedTechs.length ? selectedTechs.map(tech => `${tech.code ? `工号 ${tech.code}` : '未设置工号'} · ${tech.name}`).join('、') : '未选择';
  document.querySelector('#clock-service-name').textContent = selectedTechs.length && service ? `${service.name} · ${service.duration}` : '请选择项目';
  document.querySelectorAll('[data-dispatch-tech]').forEach(button => {
    button.classList.toggle('selected', clockingTechIds.some(id => String(id) === String(button.dataset.dispatchTech)));
    button.classList.toggle('focused', String(button.dataset.dispatchTech) === String(dispatchFocusTechId));
  });
  const allocationList = document.querySelector('#dispatch-allocation-list');
  allocationList.innerHTML = selectedTechs.length ? `<div class="dispatch-allocation-heading"><b>技师独立服务配置</b><small>每位技师可单独选择项目、钟类和时长</small></div>${selectedTechs.map(tech => {
    const choice = dispatchSelections.get(String(tech.id)) || { serviceItemId: fallbackServiceId, clockType: fallbackClockType, durationMinutes: 60 };
    const options = state.services.map(item => `<option value="${dispatchEscape(item.id)}" ${String(item.id) === String(choice.serviceItemId) ? 'selected' : ''}>${dispatchEscape(item.name)} · ${dispatchEscape(item.duration)}</option>`).join('');
    return `<fieldset class="dispatch-participant ${String(tech.id) === String(dispatchFocusTechId) ? 'focused' : ''}" data-dispatch-participant="${dispatchEscape(tech.id)}"><legend>${tech.code ? `工号 ${dispatchEscape(tech.code)}` : '未设置工号'} · ${dispatchEscape(tech.name)}</legend><div class="dispatch-participant-grid"><label>项目<select data-tech-service="${dispatchEscape(tech.id)}">${options}</select></label><label>钟类<select data-tech-clock-type="${dispatchEscape(tech.id)}"><option value="QUEUE" ${choice.clockType === 'QUEUE' ? 'selected' : ''}>排钟</option><option value="CALL" ${choice.clockType === 'CALL' ? 'selected' : ''}>点钟</option><option value="SELECTED" ${choice.clockType === 'SELECTED' ? 'selected' : ''}>选钟</option><option value="BOOKED_QUEUE" ${choice.clockType === 'BOOKED_QUEUE' ? 'selected' : ''}>预定排钟</option><option value="BOOKED_CALL" ${choice.clockType === 'BOOKED_CALL' ? 'selected' : ''}>预定点钟</option></select></label><label>时长<input data-tech-duration="${dispatchEscape(tech.id)}" type="number" min="15" max="360" step="5" value="${Number(choice.durationMinutes || 60)}"><small>分钟</small></label></div></fieldset>`;
  }).join('')}` : '<p class="table-empty">请先选择技师</p>';
  const legacyService = state.services.find(item => String(item.id) === String(focusSelection?.serviceItemId || fallbackServiceId));
  if (legacyService) document.querySelector('#clock-service').value = legacyService.id;
  if (focusSelection?.clockType) document.querySelector('#clock-type').value = focusSelection.clockType;
  if (focusSelection?.durationMinutes) document.querySelector('#clock-duration').value = focusSelection.durationMinutes;
  renderDispatchServiceCatalog();
}

function selectedDispatchParticipants() {
  return clockingTechIds.map(id => {
    const choice = dispatchSelections.get(String(id)) || {};
    return {
      technicianId:id,
      serviceItemId: choice.serviceItemId || document.querySelector('#clock-service')?.value,
      clockType: choice.clockType || document.querySelector('#clock-type')?.value || 'QUEUE',
      plannedDurationMinutes: Number(choice.durationMinutes || document.querySelector('#clock-duration')?.value || 60),
      allocationBp: 10000,
      note: null
    };
  });
}

function openClockDialog(tech = null, selectedRoom = null) {
  const availableRooms = state.rooms.filter(room => Number(room.availableBedCount || 0) > 0 && room.apiId && room.status !== 'maintenance');
  const availableTechs = state.technicians.filter(item => item.state !== 'off');
  if (!availableRooms.length) { toast('当前没有可用房间，请先完成清洁或调整房态'); return; }
  if (!availableTechs.length) { toast('当前没有可用技师，请先调整技师状态'); return; }
  clockingTechIds = tech?.id ? [tech.id] : [];
  dispatchSelections = new Map();
  dispatchFocusTechId = tech?.id || null;
  document.querySelector('#clock-room').innerHTML = availableRooms.map(room => `<option value="${roomTransferEscape(room.apiId)}">${roomTransferEscape(room.id)} 房 · ${roomTransferEscape(room.availableBedCount)}/${roomTransferEscape(room.bedCount)} 床可用</option>`).join('');
  document.querySelector('#clock-room').value = selectedRoom?.apiId && availableRooms.some(room => room.apiId === selectedRoom.apiId) ? selectedRoom.apiId : availableRooms[0].apiId;
  document.querySelector('#dispatch-tech-count').textContent = `${availableTechs.length} 位在岗，最多选择 4 位`;
  document.querySelector('#dispatch-tech-list').innerHTML = availableTechs.map(item => `<button class="dispatch-tech-choice" data-dispatch-tech="${roomTransferEscape(item.id)}" type="button"><span class="tech-avatar">${roomTransferEscape(item.initials)}</span><span><b>${item.code ? `工号 ${roomTransferEscape(item.code)}` : '未设置工号'}</b><span class="technician-full-name">${roomTransferEscape(item.name)}</span><small>轮钟 ${roomTransferEscape(String(item.queue).padStart(2, '0'))}</small></span><em>${item.state === 'available' ? '可派' : '服务中'}</em></button>`).join('');
  dispatchServiceCategoryId = 'ALL';
  dispatchServiceSearch = '';
  document.querySelector('#dispatch-service-search').value = '';
  renderDispatchServiceCatalog();
  document.querySelector('#clock-service').value = state.services[0]?.id || '';
  document.querySelector('#clock-duration').value = state.services.length ? Number.parseInt(state.services[0].duration, 10) : 60;
  if (document.querySelector('#clock-type')) document.querySelector('#clock-type').value = 'QUEUE';
  dispatchDefaultSelection = {
    serviceItemId: document.querySelector('#clock-service').value,
    clockType: document.querySelector('#clock-type').value,
    durationMinutes: Number(document.querySelector('#clock-duration').value || 60)
  };
  document.querySelector('#clock-start-time').value = new Date().toTimeString().slice(0, 5);
  renderDispatchSelection(true);
  document.querySelector('#clock-dialog').showModal();
}

let financeClaims=[], financeActiveClaim=null;
const financeStatusLabel={DRAFT:'草稿',SUBMITTED:'待审核',RETURNED:'已退回',APPROVED:'待付款',REJECTED:'已驳回',PAID:'已付款',WITHDRAWN:'已撤回'};
const financeEscape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const financeAmount=cents=>`¥${(Number(cents||0)/100).toFixed(2)}`;
const financeToday=()=>new Date().toISOString().slice(0,10);
async function financeError(response){try{const body=await response.json();return body.message||body.error||`HTTP_${response.status}`;}catch{return `HTTP_${response.status}`;}}
function renderFinanceStoreFilter(rows){const select=document.querySelector('#finance-store-filter');if(!select)return;const current=select.value;const stores=[...new Map(rows.map(row=>[row.storeId,{id:row.storeId,name:row.storeName}])).values()];select.innerHTML='<option value="">全部门店</option>'+stores.map(store=>`<option value="${roomTransferEscape(store.id)}">${financeEscape(store.name)}</option>`).join('');if(stores.some(store=>store.id===current))select.value=current;}
function renderFinanceApplicantFilter(rows){const select=document.querySelector('#finance-applicant-filter');if(!select)return;const current=select.value;const applicants=[...new Map(rows.filter(row=>row.applicantUserId&&row.applicantName).map(row=>[row.applicantUserId,{id:row.applicantUserId,name:row.applicantName}])).values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));select.innerHTML='<option value="">全部店长</option>'+applicants.map(item=>`<option value="${financeEscape(item.id)}">${financeEscape(item.name)}</option>`).join('');if(applicants.some(item=>item.id===current))select.value=current;}
function renderFinanceClaims(rows){const target=document.querySelector('#finance-claim-records');const filteredStore=document.querySelector('#finance-store-filter').value;const filteredApplicant=document.querySelector('#finance-applicant-filter')?.value||'';const visible=rows.filter(row=>(!filteredStore||row.storeId===filteredStore)&&(!filteredApplicant||row.applicantUserId===filteredApplicant));document.querySelector('#finance-pending-count').textContent=visible.filter(row=>row.status==='SUBMITTED').length;document.querySelector('#finance-approved-count').textContent=visible.filter(row=>row.status==='APPROVED').length;document.querySelector('#finance-approved-amount').textContent=financeAmount(visible.filter(row=>row.status==='APPROVED').reduce((sum,row)=>sum+Number(row.amountCents||0),0));document.querySelector('#finance-record-count').textContent=visible.length;target.innerHTML=visible.map(row=>{const status=row.status||'';const action=status==='SUBMITTED'?`<button class="record-delete edit-technician" data-finance-review="${roomTransferEscape(row.id)}">审核</button>`:status==='APPROVED'?`<button class="record-delete edit-technician" data-finance-pay="${roomTransferEscape(row.id)}">付款</button>`:`<button class="record-delete edit-technician" data-finance-detail="${roomTransferEscape(row.id)}">详情</button>`;const attachmentCount=Number(row.attachmentCount||0);const attachmentLabel=attachmentCount?`<button type="button" class="finance-attachment-indicator" data-finance-detail="${roomTransferEscape(row.id)}">${attachmentCount} 个凭证</button>`:'<span class="muted-cell">无凭证</span>';return `<tr><td><b>${financeEscape(row.claimNo)}</b><small class="muted-cell">${financeEscape(row.expenseDate)}</small></td><td>${financeEscape(row.storeName)}</td><td>${financeEscape(row.categoryName)}</td><td>${financeEscape(row.expenseDate)}</td><td class="amount-cell">${financeAmount(row.amountCents)}</td><td>${financeEscape(row.applicantName||'—')}</td><td>${attachmentLabel}</td><td><span class="record-type ${status==='REJECTED'?'refund-state':status==='APPROVED'||status==='PAID'?'consumption':'order'}">${roomTransferEscape(financeStatusLabel[status]||status)}</span></td><td class="align-right">${action}</td></tr>`;}).join('')||'<tr><td colspan="9" class="table-empty">当前没有符合条件的报销单</td></tr>';}
async function legacyLoadFinanceClaims(){if(!hasAdminPermission('EXPENSE_REVIEW'))return;const status=document.querySelector('#finance-status-filter').value;const storeId=document.querySelector('#finance-store-filter').value;const applicant=document.querySelector('#finance-applicant-filter')?.value||'';const from=document.querySelector('#finance-claims-from')?.value||'';const to=document.querySelector('#finance-claims-to')?.value||'';const claimNo=document.querySelector('#finance-claims-number')?.value.trim()||'';const query=new URLSearchParams();if(status)query.set('status',status);if(storeId)query.set('storeId',storeId);if(applicant)query.set('applicantUserId',applicant);if(from)query.set('from',from);if(to)query.set('to',to);if(claimNo)query.set('claimNo',claimNo);const response=await fetch(`http://localhost:8080/api/v1/finance/expense-claims?${query.toString()}`,{headers:adminHeaders()});if(!response.ok){document.querySelector('#finance-claim-records').innerHTML=`<tr><td colspan="9" class="table-empty">${response.status===403?'当前账号没有财务审核权限':'财务报销数据加载失败'}</td></tr>`;return;}financeClaims=await response.json();renderFinanceStoreFilter(financeClaims);renderFinanceApplicantFilter(financeClaims);renderFinanceClaims(financeClaims);}
function legacyRenderFinanceDetail(detail,targetId){const claim=detail.claim;const attachments=(detail.attachments||[]).map(item=>`<li>${financeEscape(item.originalFilename)} · ${roomTransferEscape(item.attachmentKind)}</li>`).join('')||'<li>无附件</li>';document.querySelector(targetId).innerHTML=`<div class="finance-detail-grid"><span>报销单号<strong>${financeEscape(claim.claimNo)}</strong></span><span>门店<strong>${financeEscape(claim.storeName)}</strong></span><span>申请人<strong>${financeEscape(claim.applicantName)}</strong></span><span>申请金额<strong>${financeAmount(claim.amountCents)}</strong></span><span>费用分类<strong>${financeEscape(claim.categoryName)}</strong></span><span>发生日期<strong>${financeEscape(claim.expenseDate)}</strong></span></div><p class="finance-detail-description">${financeEscape(claim.description)}</p><ul class="finance-detail-files">${attachments}</ul>`;}
async function openFinanceReview(id){const detail=await (await fetch(`http://localhost:8080/api/v1/finance/expense-claims/${id}`,{headers:adminHeaders()})).json();financeActiveClaim=detail;document.querySelector('#finance-review-title').textContent=`审核 ${detail.claim.claimNo}`;document.querySelector('#finance-review-comment').value='';renderFinanceDetail(detail,'#finance-review-detail');document.querySelector('#finance-review-dialog').showModal();}
async function openFinancePayment(id){const detail=await (await fetch(`http://localhost:8080/api/v1/finance/expense-claims/${id}`,{headers:adminHeaders()})).json();financeActiveClaim=detail;const form=document.querySelector('#finance-payment-form');form.reset();form.amount.value=(Number(detail.claim.amountCents||0)/100).toFixed(2);form.paymentDate.value=financeToday();renderFinanceDetail(detail,'#finance-payment-detail');document.querySelector('#finance-payment-dialog').showModal();}
async function financeReviewAction(action){if(!financeActiveClaim)return;const comment=document.querySelector('#finance-review-comment').value.trim();if((action==='return'||action==='reject')&&!comment)return toast('退回或驳回必须填写审核意见');const response=await fetch(`http://localhost:8080/api/v1/finance/expense-claims/${financeActiveClaim.claim.id}/${action}`,{method:'POST',headers:adminJsonHeaders(),body:JSON.stringify({comment:comment||null})});if(!response.ok)return toast(`操作失败：${await financeError(response)}`);document.querySelector('#finance-review-dialog').close();await loadFinanceClaims();toast('审核操作已完成');}
document.querySelector('#finance-refresh').addEventListener('click',()=>loadFinanceClaims().then(()=>toast('财务报销已刷新')).catch(()=>toast('财务报销数据加载失败')));document.querySelector('#finance-status-filter').addEventListener('change',()=>loadFinanceClaims().catch(()=>toast('财务报销数据加载失败')));document.querySelector('#finance-store-filter').addEventListener('change',()=>renderFinanceClaims(financeClaims));document.querySelector('#finance-applicant-filter').addEventListener('change',()=>renderFinanceClaims(financeClaims));['#finance-claims-from','#finance-claims-to'].forEach(selector=>document.querySelector(selector)?.addEventListener('change',()=>loadFinanceClaims().catch(()=>toast('财务报销数据加载失败'))));document.querySelector('#finance-claims-number').addEventListener('change',()=>loadFinanceClaims().catch(()=>toast('财务报销数据加载失败')));document.querySelector('#close-finance-review').addEventListener('click',()=>document.querySelector('#finance-review-dialog').close());document.querySelector('#finance-return-claim').addEventListener('click',()=>financeReviewAction('return'));document.querySelector('#finance-reject-claim').addEventListener('click',()=>financeReviewAction('reject'));document.querySelector('#finance-approve-claim').addEventListener('click',()=>financeReviewAction('approve'));document.querySelector('#close-finance-payment').addEventListener('click',()=>document.querySelector('#finance-payment-dialog').close());document.querySelector('#cancel-finance-payment').addEventListener('click',()=>document.querySelector('#finance-payment-dialog').close());document.querySelector('#finance-payment-form').addEventListener('submit',async event=>{event.preventDefault();if(!financeActiveClaim)return;const form=new FormData(event.currentTarget);const amount=Number(form.get('amount'));const response=await fetch(`http://localhost:8080/api/v1/finance/expense-claims/${financeActiveClaim.claim.id}/pay`,{method:'POST',headers:adminJsonHeaders(),body:JSON.stringify({amountCents:Math.round(amount*100),paymentMethod:form.get('paymentMethod'),paymentDate:form.get('paymentDate'),paymentReference:form.get('paymentReference')||null,note:form.get('note')||null})});if(!response.ok)return toast(`付款失败：${await financeError(response)}`);document.querySelector('#finance-payment-dialog').close();await loadFinanceClaims();toast('报销付款已确认');});
document.querySelector('#finance-claim-records').addEventListener('click',event=>{const review=event.target.closest('[data-finance-review]');if(review)return openFinanceReview(review.dataset.financeReview).catch(()=>toast('报销详情加载失败'));const pay=event.target.closest('[data-finance-pay]');if(pay)return openFinancePayment(pay.dataset.financePay).catch(()=>toast('报销详情加载失败'));const detail=event.target.closest('[data-finance-detail]');if(detail)return openFinanceReview(detail.dataset.financeDetail).catch(()=>toast('报销详情加载失败'));});

let financeReport=null;
const financeReportMoney=cents=>`¥${(Number(cents||0)/100).toFixed(2)}`;
const financeReportDate=()=>new Date().toISOString().slice(0,10);
function financeReportSetDefaults(){const today=financeReportDate();const first=today.slice(0,8)+'01';const from=document.querySelector('#finance-report-from');const to=document.querySelector('#finance-report-to');if(from&&!from.value)from.value=first;if(to&&!to.value)to.value=today;}
function financeReportQuery(){const query=new URLSearchParams();const from=document.querySelector('#finance-report-from').value;const to=document.querySelector('#finance-report-to').value;const store=document.querySelector('#finance-report-store').value;if(from)query.set('from',from);if(to)query.set('to',to);if(store)query.set('storeId',store);return query;}
function financeReportStoreOptions(summary){const select=document.querySelector('#finance-report-store');const current=select.value;const stores=summary.stores||[];select.innerHTML='<option value="">全部门店</option>'+stores.map(item=>`<option value="${roomTransferEscape(item.storeId)}">${financeEscape(item.storeName)}</option>`).join('');if(stores.some(item=>item.storeId===current))select.value=current;}
function financeReportMetric(label,value){return `<div class="finance-report-metric"><span>${label}</span><strong>${value}</strong></div>`;}
function renderFinanceReport(summary){financeReport=summary;financeReportStoreOptions(summary);const totals=summary.totals||{};document.querySelector('#finance-report-metrics').innerHTML=[financeReportMetric('报销单数',totals.claimCount||0),financeReportMetric('申请总额',financeReportMoney(totals.totalAmountCents)),financeReportMetric('待审核',`${totals.pendingCount||0} 单`),financeReportMetric('待付款',financeReportMoney(totals.approvedAmountCents)),financeReportMetric('已付款',financeReportMoney(totals.paidAmountCents))].join('');document.querySelector('#finance-report-stores').innerHTML=(summary.stores||[]).map(item=>`<tr><td>${financeEscape(item.storeName)}</td><td>${roomTransferEscape(item.claimCount||0)}</td><td class="amount-cell">${financeReportMoney(item.amountCents)}</td><td class="amount-cell">${financeReportMoney(item.paidAmountCents)}</td></tr>`).join('')||'<tr><td colspan="4" class="table-empty">暂无数据</td></tr>';document.querySelector('#finance-report-categories').innerHTML=(summary.categories||[]).map(item=>`<tr><td>${financeEscape(item.categoryName)}</td><td>${roomTransferEscape(item.claimCount||0)}</td><td class="amount-cell">${financeReportMoney(item.amountCents)}</td><td class="amount-cell">${financeReportMoney(item.paidAmountCents)}</td></tr>`).join('')||'<tr><td colspan="4" class="table-empty">暂无数据</td></tr>';const statusLabel={SUBMITTED:'待审核',APPROVED:'待付款',PAID:'已付款',RETURNED:'已退回',REJECTED:'已驳回'};document.querySelector('#finance-report-statuses').innerHTML=(summary.statuses||[]).map(item=>`<tr><td>${statusLabel[item.status]||financeEscape(item.status)}</td><td>${roomTransferEscape(item.claimCount||0)}</td><td class="amount-cell">${financeReportMoney(item.amountCents)}</td></tr>`).join('')||'<tr><td colspan="3" class="table-empty">暂无数据</td></tr>';}
async function loadFinanceReport(){if(!hasAdminPermission('EXPENSE_REVIEW'))return;financeReportSetDefaults();const response=await fetch(`http://localhost:8080/api/v1/finance/expense-reports/summary?${financeReportQuery().toString()}`,{headers:adminHeaders()});if(!response.ok)throw new Error(await financeError(response));renderFinanceReport(await response.json());}
async function exportFinanceReport(){if(!hasAdminPermission('EXPENSE_REVIEW'))return;financeReportSetDefaults();const response=await fetch(`http://localhost:8080/api/v1/finance/expense-reports/export?${financeReportQuery().toString()}`,{headers:adminHeaders()});if(!response.ok)return toast(`导出失败：${await financeError(response)}`);const blob=await response.blob();const disposition=response.headers.get('content-disposition')||'';const match=disposition.match(/filename\*=UTF-8''([^;]+)/i);const filename=match?decodeURIComponent(match[1]):'财务报销统计.xlsx';const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);toast('财务报销统计已导出');}
document.querySelector('#finance-report-refresh').addEventListener('click',()=>loadFinanceReport().then(()=>toast('财务统计已刷新')).catch(()=>toast('财务统计加载失败')));document.querySelector('#finance-report-export').addEventListener('click',()=>exportFinanceReport());document.querySelector('#finance-report-from').addEventListener('change',()=>loadFinanceReport().catch(()=>toast('财务统计加载失败')));document.querySelector('#finance-report-to').addEventListener('change',()=>loadFinanceReport().catch(()=>toast('财务统计加载失败')));document.querySelector('#finance-report-store').addEventListener('change',()=>loadFinanceReport().catch(()=>toast('财务统计加载失败')));

let financeAttachmentObjectUrl=null;
const financeDetailStatus={SUBMITTED:'待审核',APPROVED:'待付款',PAID:'已付款',RETURNED:'已退回',REJECTED:'已驳回',WITHDRAWN:'已撤回',DRAFT:'草稿'};
const financeDetailAction={SUBMIT:'提交审核',RESUBMIT:'重新提交',APPROVE:'审核通过',RETURN:'退回修改',REJECT:'驳回',PAY:'确认付款',WITHDRAW:'撤回'};
function renderFinanceDetail(detail,targetId){const claim=detail.claim||{};const attachments=detail.attachments||[];const history=detail.history||[];const payment=detail.payment;const attachmentItems=attachments.map(item=>`<li class="finance-detail-attachment"><span title="${financeEscape(item.originalFilename)}">${financeEscape(item.originalFilename)} · ${financeEscape(item.attachmentKind)} · ${(Number(item.fileSizeBytes||0)/1024).toFixed(0)} KB</span><span class="finance-detail-attachment-actions"><button type="button" data-finance-attachment="${roomTransferEscape(item.id)}" data-finance-attachment-name="${financeEscape(item.originalFilename)}" data-finance-attachment-type="${financeEscape(item.contentType)}">预览</button><button type="button" data-finance-attachment-download="${roomTransferEscape(item.id)}" data-finance-attachment-name="${financeEscape(item.originalFilename)}">下载</button></span></li>`).join('')||'<li class="table-empty">无附件</li>';const historyItems=history.map(item=>`<li><b>${financeDetailAction[item.action]||financeEscape(item.action)}：${financeDetailStatus[item.toStatus]||financeEscape(item.toStatus)}</b><small>${financeEscape(item.actorName||'系统')} · ${financeEscape(item.createdAt||'')}${item.comment?` · ${financeEscape(item.comment)}`:''}</small></li>`).join('')||'<li class="table-empty">暂无审核记录</li>';const paymentBlock=payment?`<div class="finance-detail-block"><h3>付款信息</h3><div class="finance-detail-meta"><span>付款金额<strong>${financeReportMoney(payment.amountCents)}</strong></span><span>付款方式<strong>${financeEscape(payment.paymentMethod)}</strong></span><span>付款日期<strong>${financeEscape(payment.paymentDate)}</strong></span><span>凭证号<strong>${financeEscape(payment.paymentReference||'—')}</strong></span><span>付款状态<strong>${financeEscape(payment.status||'—')}</strong></span><span>付款备注<strong>${financeEscape(payment.note||'—')}</strong></span></div></div>`:'';document.querySelector(targetId).innerHTML=`<div class="finance-detail-grid"><span>报销单号<strong>${financeEscape(claim.claimNo)}</strong></span><span>门店<strong>${financeEscape(claim.storeName)}</strong></span><span>申请人<strong>${financeEscape(claim.applicantName)}</strong></span><span>申请金额<strong>${financeReportMoney(claim.amountCents)}</strong></span><span>费用分类<strong>${financeEscape(claim.categoryName)}</strong></span><span>发生日期<strong>${financeEscape(claim.expenseDate)}</strong></span></div><div class="finance-detail-block"><div class="finance-detail-meta"><span>收款方<strong>${financeEscape(claim.payeeName||'—')}</strong></span><span>付款来源<strong>${financeEscape(claim.paymentSource||'—')}</strong></span><span>票据类型<strong>${financeEscape(claim.receiptType||'—')}</strong></span><span>发票号码<strong>${financeEscape(claim.invoiceNo||'—')}</strong></span><span>当前状态<strong>${financeDetailStatus[claim.status]||financeEscape(claim.status||'—')}</strong></span><span>提交时间<strong>${financeEscape(claim.submittedAt||'—')}</strong></span></div><p class="finance-detail-description">${financeEscape(claim.description||'—')}</p>${claim.noReceiptReason?`<p class="finance-detail-warning">无票说明：${financeEscape(claim.noReceiptReason)}</p>`:''}${claim.duplicateWarning?'<p class="finance-detail-warning">系统检测到相似报销记录，请重点复核。</p>':''}</div><div class="finance-detail-block"><h3>附件凭证（${roomTransferEscape(attachments.length)}）</h3><ul class="finance-detail-attachments">${attachmentItems}</ul></div><div class="finance-detail-block"><h3>审核轨迹</h3><ul class="finance-detail-history">${historyItems}</ul></div>${paymentBlock}`;const actions=document.querySelector('#finance-review-actions');if(actions)actions.hidden=claim.status!=='SUBMITTED';}
async function openFinanceAttachment(id,filename,contentType){const response=await fetch(`http://localhost:8080/api/v1/finance/expense-claims/${financeActiveClaim.claim.id}/attachments/${id}`,{headers:adminHeaders()});if(!response.ok)return toast(`附件加载失败：${await financeError(response)}`);const blob=await response.blob();if(financeAttachmentObjectUrl)URL.revokeObjectURL(financeAttachmentObjectUrl);financeAttachmentObjectUrl=URL.createObjectURL(blob);document.querySelector('#finance-attachment-title').textContent=filename||'报销附件';const target=document.querySelector('#finance-attachment-preview');if((contentType||blob.type).startsWith('image/'))target.innerHTML=`<img src="${financeAttachmentObjectUrl}" alt="${financeEscape(filename||'报销附件')}" />`;else if((contentType||blob.type)==='application/pdf')target.innerHTML=`<iframe src="${financeAttachmentObjectUrl}" title="${financeEscape(filename||'报销附件')}"></iframe>`;else target.innerHTML='<p>当前文件类型暂不支持在线预览，请下载后查看。</p>';document.querySelector('#finance-attachment-dialog').showModal();}
async function downloadFinanceAttachment(id,filename){if(!financeActiveClaim)return;const response=await fetch(`http://localhost:8080/api/v1/finance/expense-claims/${financeActiveClaim.claim.id}/attachments/${id}?download=true`,{headers:adminHeaders()});if(!response.ok)return toast(`附件下载失败：${await financeError(response)}`);const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename||'报销附件';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 document.querySelector('#finance-review-detail').addEventListener('click',event=>{const download=event.target.closest('[data-finance-attachment-download]');if(download)return downloadFinanceAttachment(download.dataset.financeAttachmentDownload,download.dataset.financeAttachmentName).catch(()=>toast('附件下载失败'));const button=event.target.closest('[data-finance-attachment]');if(!button)return;openFinanceAttachment(button.dataset.financeAttachment,button.dataset.financeAttachmentName,button.dataset.financeAttachmentType).catch(()=>toast('附件加载失败'));});document.querySelector('#close-finance-attachment').addEventListener('click',()=>document.querySelector('#finance-attachment-dialog').close());document.querySelector('#finance-attachment-dialog').addEventListener('close',()=>{if(financeAttachmentObjectUrl){URL.revokeObjectURL(financeAttachmentObjectUrl);financeAttachmentObjectUrl=null;}});

let financeSyncSnapshot=new Map();
let financeSyncInitialized=false;
async function loadFinanceClaims(){if(!hasAdminPermission('EXPENSE_REVIEW'))return;const status=document.querySelector('#finance-status-filter').value;const storeId=document.querySelector('#finance-store-filter').value;const applicant=document.querySelector('#finance-applicant-filter')?.value||'';const from=document.querySelector('#finance-claims-from')?.value||'';const to=document.querySelector('#finance-claims-to')?.value||'';const claimNo=document.querySelector('#finance-claims-number')?.value.trim()||'';const query=new URLSearchParams();if(status)query.set('status',status);if(storeId)query.set('storeId',storeId);if(applicant)query.set('applicantUserId',applicant);if(from)query.set('from',from);if(to)query.set('to',to);if(claimNo)query.set('claimNo',claimNo);const response=await fetch(`http://localhost:8080/api/v1/finance/expense-claims?${query.toString()}`,{headers:adminHeaders()});if(!response.ok){document.querySelector('#finance-claim-records').innerHTML=`<tr><td colspan="9" class="table-empty">${response.status===403?'当前账号没有财务审核权限':'财务报销数据加载失败'}</td></tr>`;return;}const rows=await response.json();const changed=financeSyncInitialized&&rows.some(row=>financeSyncSnapshot.get(row.id)&&financeSyncSnapshot.get(row.id)!==row.status)||(financeSyncInitialized&&rows.length!==financeSyncSnapshot.size);financeSyncSnapshot=new Map(rows.map(row=>[row.id,row.status]));financeSyncInitialized=true;financeClaims=rows;renderFinanceStoreFilter(rows);renderFinanceApplicantFilter(rows);renderFinanceClaims(rows);const sync=document.querySelector('#finance-sync-status');if(sync)sync.textContent=`${new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date())} 已同步`;if(changed)toast('报销状态已更新，请刷新详情');}
function financeSyncTick(){const view=document.querySelector('#finance-view');if(!view||view.classList.contains('hidden')||!localStorage.getItem(adminTokenKey))return;loadFinanceClaims().catch(()=>{});loadFinanceReport().catch(()=>{});}
window.setInterval(financeSyncTick,20000);

const managementTabGroups = {
  overview: ['.metric-grid', '.ledger-summary-panel', '.daily-report-panel', '.management-grid', '#headquarters-overview'],
  orders: ['#historical-backfill-panel', '#order-history-panel', '#service-session-record-panel', '.refund-management-panel', '.service-change-query-panel'],
  commissions: ['.order-commission-panel', '.commission-adjustment-panel', '#technician-commission-summary-panel', '#administrative-commission-panel', '.administrative-commission-config', '.technician-performance-panel'],
  members: ['.wallet-ledger-panel', '.member-recharge-refund-panel'],
  store: ['.store-comparison-panel', '.store-alert-panel', '.cross-store-transaction-panel'],
  records: ['#queue-event-panel']
};
const managementTabLabels = { overview:'经营概览', orders:'订单与服务', commissions:'提成管理', members:'会员资金', store:'门店经营', records:'轮钟记录' };
const managementTabDescriptions = {
  overview: '查看经营指标、趋势、日报和异常摘要。',
  orders: '筛选服务记录、订单、退款和服务变更；详情操作在记录内完成。',
  commissions: '集中查看技师提成、行政推荐提成和业绩明细。',
  members: '查看会员资金流水、充值记录、卡耗和充值退款。',
  store: '对比门店经营数据、预警、房间利用率和销售表现。',
  records: '只读查看营业日轮钟初始化、轮转和手动调整事件。'
};
let managementActiveTab = 'overview';
function ensureManagementNavigation() {
  const view = document.querySelector('#management-view');
  if (!view) return;
  if (!document.querySelector('#management-tabs')) {
    view.querySelector('.page-heading')?.insertAdjacentHTML('afterend', `<nav class="management-tabs" id="management-tabs" aria-label="经营管理分类">${Object.entries(managementTabLabels).map(([id, label]) => `<button type="button" data-management-tab="${id}" class="${id === managementActiveTab ? 'selected' : ''}">${label}</button>`).join('')}</nav><div class="management-tab-context" id="management-tab-context" aria-live="polite"><h2 id="management-tab-title"></h2><p id="management-tab-description"></p></div>`);
    document.querySelector('#management-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-management-tab]');
    if (!button) return;
    managementActiveTab = button.dataset.managementTab;
    applyManagementTab();
    });
  }
}
function applyManagementTab() {
  ensureManagementNavigation();
  const view = document.querySelector('#management-view');
  if (!view) return;
  const activeSelectors = managementTabGroups[managementActiveTab] || managementTabGroups.overview;
  const allManaged = new Set(Object.values(managementTabGroups).flatMap(selectors => selectors.flatMap(selector => [...view.querySelectorAll(selector)])));
  view.querySelectorAll(':scope > section, :scope > .management-grid').forEach(element => allManaged.add(element));
  allManaged.forEach(element => {
    const permission = element.dataset.adminPermission;
    element.hidden = !activeSelectors.some(selector => element.matches(selector)) || Boolean(permission && !hasAdminPermission(permission));
  });
  document.querySelectorAll('#management-tabs [data-management-tab]').forEach(button => button.classList.toggle('selected', button.dataset.managementTab === managementActiveTab));
  const title = document.querySelector('#management-tab-title');
  const description = document.querySelector('#management-tab-description');
  const headingEyebrow = view.querySelector('.page-heading .eyebrow');
  const pageActions = view.querySelector('.page-heading .page-actions');
  if (headingEyebrow) headingEyebrow.textContent = managementActiveTab === 'overview' ? '经营概览' : `经营管理 · ${managementTabLabels[managementActiveTab] || managementTabLabels.overview}`;
  if (pageActions) pageActions.hidden = managementActiveTab !== 'overview';
  if (title) title.textContent = managementTabLabels[managementActiveTab] || managementTabLabels.overview;
  if (description) description.textContent = managementTabDescriptions[managementActiveTab] || managementTabDescriptions.overview;
}

function ensureTechnicianCommissionSummaryPanel() {
  if (document.querySelector('#technician-commission-summary-panel')) return;
  const anchor = document.querySelector('#management-view .order-commission-panel');
  if (!anchor) return;
  anchor.insertAdjacentHTML('beforebegin', '<section class="panel admin-table-panel technician-commission-summary-panel" id="technician-commission-summary-panel"><div class="admin-toolbar"><div><p class="eyebrow">提成汇总</p><h2>技师提成总汇</h2><p>按当前提成查询时间范围汇总，退款冲减会计入净提成。</p></div><span id="technician-commission-summary-range" class="muted-count"></span></div><div class="ledger-table-wrap"><table><thead><tr><th>技师</th><th>服务笔数</th><th>项目金额</th><th class="align-right">净提成</th></tr></thead><tbody id="technician-commission-summary-records"><tr><td colspan="4" class="table-empty">选择时间后查询</td></tr></tbody></table></div></section>');
}
function renderTechnicianCommissionSummary() {
  ensureTechnicianCommissionSummaryPanel();
  const groups = new Map();
  orderCommissionRecords.forEach(row => {
    const key = row.technicianId || row.technicianNameSnapshot || 'UNKNOWN';
    const current = groups.get(key) || { name: row.technicianNameSnapshot || '未记录技师', count: 0, base: 0, commission: 0 };
    current.count += 1;
    current.base += Number(row.baseAmountCents || 0);
    current.commission += Number(row.commissionCents || 0);
    groups.set(key, current);
  });
  const from = document.querySelector('#commission-record-from')?.value || '—';
  const to = document.querySelector('#commission-record-to')?.value || '—';
  const range = document.querySelector('#technician-commission-summary-range');
  if (range) range.textContent = `${from} 至 ${to}`;
  const target = document.querySelector('#technician-commission-summary-records');
  if (target) target.innerHTML = [...groups.values()].sort((left, right) => right.commission - left.commission).map(row => `<tr><td><b>${memberBusinessEscape(row.name)}</b></td><td>${roomTransferEscape(row.count)}</td><td>${money(row.base / 100)}</td><td class="amount-cell commission-amount">${signedMoneyCents(row.commission)}</td></tr>`).join('') || '<tr><td colspan="4" class="table-empty">所选时间没有技师提成记录</td></tr>';
}

document.querySelectorAll('.nav-item[data-view]').forEach(button => button.addEventListener('click', () => {
  if (button.hidden || !isAdminViewAllowed(button.dataset.view)) { toast('当前账号没有该模块权限'); return; }
  if (button.dataset.view === 'access' && !localStorage.getItem(adminTokenKey)) { showAdminLogin(); return; }
  if (button.dataset.view === 'members' && !localStorage.getItem(adminTokenKey)) { showAdminLogin(); return; }
  if (button.dataset.view === 'access' && !isTenantAdmin()) { toast('仅总部管理员可访问门店与权限'); return; }
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  button.closest('.nav-group')?.setAttribute('open','');
  document.querySelector('#frontdesk-view').classList.toggle('hidden', button.dataset.view !== 'frontdesk');
  document.querySelector('#management-view').classList.toggle('hidden', button.dataset.view !== 'management');
  document.querySelector('#finance-view').classList.toggle('hidden', button.dataset.view !== 'finance');
  document.querySelector('#technicians-view').classList.toggle('hidden', button.dataset.view !== 'technicians');
  document.querySelector('#rooms-view').classList.toggle('hidden', button.dataset.view !== 'rooms');
  document.querySelector('#services-view').classList.toggle('hidden', button.dataset.view !== 'services');
  document.querySelector('#members-view').classList.toggle('hidden', button.dataset.view !== 'members');
  document.querySelector('#payment-methods-view').classList.toggle('hidden', button.dataset.view !== 'payment-methods');
  document.querySelector('#print-settings-view').classList.toggle('hidden', button.dataset.view !== 'print-settings');
  document.querySelector('#access-view').classList.toggle('hidden', button.dataset.view !== 'access');
  if (button.dataset.view === 'frontdesk') syncOperationalState();
  if (button.dataset.view === 'management') { setupServiceChangeHistoryCenter(); renderServiceChangeStoreOptions(); setupMemberRechargeRefundUi(); ensureManagementNavigation(); ensureTechnicianCommissionSummaryPanel(); loadServiceSessions(); loadOrderCommissionRecords(); loadServiceChangeHistoryCenter(); loadSalesOrders(); loadFrontdeskHistoricalBackfills(); loadRefundManagement(); loadMemberWalletLedger(); loadMemberRechargeRefunds(); loadTechnicianPerformance(); loadDailyReport(); loadStoreComparison(); loadStoreAlerts(); loadCrossStoreTransactions(); loadHeadquartersOverview(); loadAdministrativeCommissionSummary().catch(()=>{}); window.setTimeout(applyManagementTab, 0); }
  if (button.dataset.view === 'finance') { loadFinanceClaims().catch(() => toast('财务报销数据加载失败')); loadFinanceReport().catch(() => toast('财务统计加载失败')); }
  if (button.dataset.view === 'technicians') switchEmployeeManagementTab(employeeManagementTab);
  if (button.dataset.view === 'rooms') loadManagedRooms().catch(() => toast('房间资料服务不可用'));
  if (button.dataset.view === 'services') loadManagedServiceItems().catch(() => toast('服务项目资料加载失败'));
  if (button.dataset.view === 'members') loadMemberCenter().catch(() => toast('会员资料服务不可用'));
  if (button.dataset.view === 'payment-methods') loadManagedPaymentMethods().catch(() => toast('收款方式资料加载失败'));
  if (button.dataset.view === 'print-settings') loadStorePrintSetting().catch(() => toast('打印设置加载失败'));
  if (button.dataset.view === 'access') loadAccessControl().catch(() => toast('门店与权限资料加载失败'));
}));

function setOrderDrawer(open) {
  const panel = document.querySelector('#order-panel');
  const backdrop = document.querySelector('#order-drawer-backdrop');
  panel.hidden = !open;
  backdrop.hidden = !open;
  panel.classList.toggle('drawer-open', open);
  backdrop.classList.toggle('visible', open);
  document.body.classList.toggle('order-drawer-open', open);
  panel.style.pointerEvents = open ? 'auto' : 'none';
  panel.style.zIndex = open ? '120' : '';
  backdrop.style.zIndex = open ? '110' : '';
}

async function openSingleRoomSettlement(room) {
  if (!room?.apiId) return;
  const loaded = await loadPendingServiceSessions({ silent: true, roomId: room.apiId, updateState: false });
  if (!loaded) return toast('待结算服务加载失败，请刷新后重试');
  const sessions = loaded;
  if (sessions.some(session => String(session.roomId) !== String(room.apiId))) return toast('待结算服务房间校验失败，请刷新后重试');
  if (!sessions.length) return toast(`${room.id} 房暂无可结算服务`);
  setupSingleRoomServiceSelectionDialog();
  singleRoomSettlementRoom = room;
  singleRoomSettlementSessions = sessions;
  singleRoomSettlementSelection = new Set();
  renderSingleRoomServiceSelection();
  document.querySelector('#single-room-service-selection-dialog').showModal();
}

function setupSingleRoomServiceSelectionDialog() {
  if (document.querySelector('#single-room-service-selection-dialog')) return;
  document.body.insertAdjacentHTML('beforeend', '<dialog id="single-room-service-selection-dialog" class="single-room-service-selection-dialog"><form id="single-room-service-selection-form" class="dialog-card single-room-service-selection-card"><div class="dialog-heading"><div><p class="eyebrow">单房结算</p><h2 id="single-room-service-selection-title">选择待结算项目</h2></div><button class="icon-button" type="button" id="close-single-room-service-selection" aria-label="关闭">×</button></div><div class="single-room-service-selection-toolbar"><div><b id="single-room-service-selection-room">待付款房间</b><small>默认不选中，勾选哪一项就结算哪一项</small></div><button class="button secondary" type="button" id="select-all-single-room-services">全选本房</button></div><div id="single-room-service-selection-list" class="single-room-service-selection-list"></div><div class="single-room-service-selection-summary"><span>已选 <b id="single-room-service-selection-count">0</b> 项</span><strong id="single-room-service-selection-total">¥0.00</strong></div><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-single-room-service-selection">取消</button><button class="button primary" type="submit" id="confirm-single-room-service-selection" disabled>进入结算</button></div></form></dialog>');
  const dialog = document.querySelector('#single-room-service-selection-dialog');
  document.querySelector('#close-single-room-service-selection').addEventListener('click', () => dialog.close());
  document.querySelector('#cancel-single-room-service-selection').addEventListener('click', () => dialog.close());
  document.querySelector('#select-all-single-room-services').addEventListener('click', () => {
    const allSelected = singleRoomSettlementSessions.length > 0 && singleRoomSettlementSelection.size === singleRoomSettlementSessions.length;
    singleRoomSettlementSelection = allSelected ? new Set() : new Set(singleRoomSettlementSessions.map(session => session.id));
    renderSingleRoomServiceSelection();
  });
  document.querySelector('#single-room-service-selection-list').addEventListener('change', event => {
    const checkbox = event.target.closest('[data-single-room-service]');
    if (!checkbox) return;
    if (checkbox.checked) singleRoomSettlementSelection.add(checkbox.dataset.singleRoomService);
    else singleRoomSettlementSelection.delete(checkbox.dataset.singleRoomService);
    renderSingleRoomServiceSelection();
  });
  document.querySelector('#single-room-service-selection-form').addEventListener('submit', confirmSingleRoomServiceSelection);
}

function renderSingleRoomServiceSelection() {
  const room = singleRoomSettlementRoom;
  const list = document.querySelector('#single-room-service-selection-list');
  if (!room || !list) return;
  document.querySelector('#single-room-service-selection-title').textContent = room.id + ' 房待结算项目';
  document.querySelector('#single-room-service-selection-room').textContent = room.id + ' 房 · ' + singleRoomSettlementSessions.length + ' 项待结算';
  list.innerHTML = singleRoomSettlementSessions.map(session => {
    const selected = singleRoomSettlementSelection.has(session.id);
    const clockType = clockTypeLabels[session.clockType] || session.clockType;
    const extension = session.extensionSummary ? ' · 加钟：' + session.extensionSummary : '';
    return '<label class="single-room-service-option' + (selected ? ' selected' : '') + '"><input type="checkbox" data-single-room-service="' + memberBusinessEscape(session.id) + '" ' + (selected ? 'checked' : '') + '><i aria-hidden="true">' + (selected ? '✓' : '') + '</i><span><b>' + memberBusinessEscape(session.serviceNameSnapshot) + '</b><small>' + memberBusinessEscape(session.serviceNo || '') + ' · ' + memberBusinessEscape(clockType) + ' · ' + memberBusinessEscape(session.technicianName) + ' · ' + session.plannedDurationMinutes + ' 分钟' + memberBusinessEscape(extension) + '</small></span><strong>' + money(Number(session.servicePriceCents || 0) / 100) + '</strong></label>';
  }).join('');
  const selectedSessions = singleRoomSettlementSessions.filter(session => singleRoomSettlementSelection.has(session.id));
  const selectedTotal = selectedSessions.reduce((sum, session) => sum + Number(session.servicePriceCents || 0), 0);
  const allSelected = singleRoomSettlementSessions.length > 0 && selectedSessions.length === singleRoomSettlementSessions.length;
  document.querySelector('#single-room-service-selection-count').textContent = selectedSessions.length;
  document.querySelector('#single-room-service-selection-total').textContent = money(selectedTotal / 100);
  document.querySelector('#select-all-single-room-services').textContent = allSelected ? '取消全选' : '全选本房';
  document.querySelector('#confirm-single-room-service-selection').disabled = selectedSessions.length === 0;
}

function confirmSingleRoomServiceSelection(event) {
  event.preventDefault();
  const room = singleRoomSettlementRoom;
  const sessions = singleRoomSettlementSessions.filter(session => singleRoomSettlementSelection.has(session.id));
  if (!room || !sessions.length) return toast('请至少勾选一项待结算服务');
  singleRoomSettlementRoomId = room.apiId;
  state.orderItems = sessions.map(session => ({
    id: session.serviceItemId,
    serviceSessionId: session.id,
    serviceNo: session.serviceNo,
    roomId: session.roomId,
    roomCode: session.roomCode,
    name: session.serviceNameSnapshot + (session.extensionSummary ? '（加钟：' + session.extensionSummary + '）' : ''),
    duration: session.plannedDurationMinutes + ' 分钟',
    price: Number(session.servicePriceCents || 0) / 100,
    lineId: 'session-' + session.id
  }));
  state.selectedMemberId = null;
  document.querySelector('#single-room-service-selection-dialog').close();
  renderMemberCard();
  renderOrder();
  setOrderDrawer(true);
}
document.querySelector('#add-service').addEventListener('click', openServiceDialog);
document.querySelector('#new-order').addEventListener('click', () => document.querySelector('#frontdesk-settlement-actions-dialog').showModal());
const memberBusinessEscape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
let memberBusinessRenewMember=null;
let memberBusinessRenewTimer=null;
let memberBusinessConsumeMember=null;
let memberBusinessBalanceMethodCode=null;
let memberBusinessConsumeSelection=new Set();
function setupMemberConsumePanel(){
  const panel=document.querySelector('[data-member-business-panel="consume"]');
  if(!panel||panel.dataset.consumeReady==='true')return;
  panel.dataset.consumeReady='true';
  panel.innerHTML='<div class="member-business-panel-heading"><div><span class="member-business-mark consume">耗</span><div><h3>会员卡耗</h3><p>选择已完成服务，生成正式订单并从会员余额扣费</p></div></div></div><label class="member-business-search"><span>⌕</span><input id="member-consume-search" placeholder="手机号、卡号或姓名" autocomplete="off"></label><div class="member-business-results" id="member-consume-results"><p>输入会员信息开始查询</p></div><form id="member-consume-form" class="member-consume-form hidden"><div class="member-renew-selected"><div><span class="member-business-mark consume">耗</span><div><b id="member-consume-name">会员</b><small id="member-consume-meta">卡号 · 手机号</small></div></div><div><span>可用余额</span><strong id="member-consume-balance">¥0.00</strong></div><button type="button" id="member-consume-change">更换</button></div><div class="member-consume-heading"><div><b>选择待结算服务</b><small>支持同一营业日多项服务合并卡耗</small></div><button type="button" id="member-consume-refresh">刷新</button></div><div class="member-consume-orders" id="member-consume-orders"><p>正在加载待结算服务</p></div><div class="member-consume-summary"><span>已选 <b id="member-consume-count">0</b> 项</span><span>本次卡耗 <strong id="member-consume-total">¥0.00</strong></span><span>扣后余额 <strong id="member-consume-after">¥0.00</strong></span></div></form>';
  document.querySelector('#member-consume-search').addEventListener('input',()=>{window.clearTimeout(memberBusinessConsumeTimer);memberBusinessConsumeTimer=window.setTimeout(searchMemberConsumeCandidates,240);});
  document.querySelector('#member-consume-results').addEventListener('click',event=>{const button=event.target.closest('[data-member-consume-select]');if(button)selectMemberForConsume(button.dataset.memberConsumeSelect,button);});
  document.querySelector('#member-consume-orders').addEventListener('click',event=>{const button=event.target.closest('[data-member-consume-order]');if(!button)return;const id=button.dataset.memberConsumeOrder;if(memberBusinessConsumeSelection.has(id))memberBusinessConsumeSelection.delete(id);else memberBusinessConsumeSelection.add(id);renderMemberConsumeOrders();});
  document.querySelector('#member-consume-refresh').addEventListener('click',()=>loadPendingServiceSessions().then(renderMemberConsumeOrders));
  document.querySelector('#member-consume-change').addEventListener('click',()=>{memberBusinessConsumeMember=null;memberBusinessConsumeSelection.clear();document.querySelector('#member-consume-form').classList.add('hidden');document.querySelector('#member-consume-search').value='';document.querySelector('#member-consume-results').innerHTML='<p>输入会员信息开始查询</p>';document.querySelector('#continue-member-business').disabled=true;});
  document.querySelector('#member-consume-form').addEventListener('submit',submitMemberConsume);
}
let memberBusinessConsumeTimer=null;
let memberBusinessSalesStatsReady=false;
function setupMemberSalesStats(){const panel=document.querySelector('[data-member-business-panel="sales"]');if(!panel||memberBusinessSalesStatsReady)return;memberBusinessSalesStatsReady=true;panel.innerHTML='<div class="member-business-panel-heading"><div><span class="member-business-mark sales">售</span><div><h3>售卡统计</h3><p>按营业日期汇总开卡、续卡与会员消费</p></div></div></div><div class="member-sales-toolbar"><label>统计日期<input id="member-sales-date" type="date"></label><button type="button" id="member-sales-refresh">刷新</button></div><div class="member-sales-placeholder" id="member-sales-cards"><article><span>开卡数量</span><strong>—</strong></article><article><span>售卡金额</span><strong>—</strong></article><article><span>续卡金额</span><strong>—</strong></article><article><span>卡耗金额</span><strong>—</strong></article></div><div class="member-sales-tech" id="member-sales-tech"><p>正在加载技师归属统计</p></div><small class="member-sales-note">开卡按会员建档日与首笔充值识别；续卡为其他充值流水。金额不含赠送金额。</small>';document.querySelector('#member-sales-date').value=localDateValue();document.querySelector('#member-sales-date').addEventListener('change',loadMemberSalesStats);document.querySelector('#member-sales-refresh').addEventListener('click',loadMemberSalesStats);}
async function loadMemberSalesStats(){setupMemberSalesStats();const date=document.querySelector('#member-sales-date').value||localDateValue();const cards=document.querySelector('#member-sales-cards');const tech=document.querySelector('#member-sales-tech');cards.classList.add('is-loading');try{const txResponse=await fetch(`http://localhost:8080/api/v1/wallet-transactions?from=${date}&to=${date}`,{headers:storeContextHeaders()});if(!txResponse.ok)throw new Error('SALES_STATS_LOAD_FAILED');const rows=await txResponse.json();let openCount=0,openAmount=0,renewAmount=0,consumption=0;const technicians=new Map();for(const row of rows){const amount=Math.abs(Number(row.amountCents||0));if(row.transactionType==='RECHARGE'){if(row.openingRecharge){openCount++;openAmount+=amount;}else renewAmount+=amount;const name=row.technicianNameSnapshot||'未关联技师';technicians.set(name,(technicians.get(name)||0)+amount);}else if(row.transactionType==='CONSUMPTION')consumption+=amount;}document.querySelector('#member-sales-cards').innerHTML=`<article><span>开卡数量</span><strong>${openCount}</strong></article><article><span>售卡金额</span><strong>${money(openAmount/100)}</strong></article><article><span>续卡金额</span><strong>${money(renewAmount/100)}</strong></article><article><span>卡耗金额</span><strong>${money(consumption/100)}</strong></article>`;const ranking=[...technicians.entries()].sort((a,b)=>b[1]-a[1]);tech.innerHTML=`<h4>充值技师归属</h4>${ranking.map(([name,amount])=>`<div><span>${memberBusinessEscape(name)}</span><strong>${money(amount/100)}</strong></div>`).join('')||'<p>该日期暂无充值归属记录</p>'}`;}catch{cards.innerHTML='<p class="member-sales-error">售卡统计加载失败，请稍后重试</p>';tech.innerHTML='';}finally{cards.classList.remove('is-loading');}}
async function searchMemberConsumeCandidates(){const query=document.querySelector('#member-consume-search').value.trim();const target=document.querySelector('#member-consume-results');if(!query){target.innerHTML='<p>输入会员信息开始查询</p>';return;}target.innerHTML='<p>正在查询会员</p>';try{const response=await fetch(`http://localhost:8080/api/v1/members?query=${encodeURIComponent(query)}`,{headers:storeContextHeaders()});if(!response.ok)throw new Error(response.status);const rows=await response.json();target.innerHTML=rows.map(member=>`<button class="member-business-result" type="button" data-member-consume-select="${roomTransferEscape(member.id)}" data-name="${memberBusinessEscape(member.name)}" data-code="${memberBusinessEscape(member.code)}" data-phone="${memberBusinessEscape(member.phone)}" data-balance="${Number(member.balanceCents||0)}"><span><b>${memberBusinessEscape(member.name)}</b><small>${memberBusinessEscape(member.code)} · ${memberBusinessEscape(member.phone)}</small></span><strong>${money(Number(member.balanceCents||0)/100)}</strong></button>`).join('')||'<p>没有找到符合条件的会员</p>';}catch{target.innerHTML='<p>会员查询失败，请稍后重试</p>';}}
function selectMemberForConsume(id,button){memberBusinessConsumeMember={id,name:button.dataset.name,meta:`${button.dataset.code} · ${button.dataset.phone}`,phone:button.dataset.phone,balanceCents:Number(button.dataset.balance||0)};state.selectedMemberId=id;state.members=[{id,name:memberBusinessConsumeMember.name,phone:memberBusinessConsumeMember.phone,level:'储值会员',balance:memberBusinessConsumeMember.balanceCents/100},...state.members.filter(item=>item.id!==id)];document.querySelector('#member-consume-name').textContent=memberBusinessConsumeMember.name;document.querySelector('#member-consume-meta').textContent=memberBusinessConsumeMember.meta;document.querySelector('#member-consume-balance').textContent=money(memberBusinessConsumeMember.balanceCents/100);memberBusinessConsumeSelection.clear();document.querySelector('#member-consume-form').classList.remove('hidden');document.querySelector('#member-consume-results').innerHTML='';document.querySelector('#continue-member-business').disabled=false;renderMemberConsumeOrders();}
function renderMemberConsumeOrders(){const list=document.querySelector('#member-consume-orders');if(!list)return;list.innerHTML=state.pendingServiceSessions.map(session=>{const selected=memberBusinessConsumeSelection.has(session.id);const extension=session.extensionSummary?` · 加钟：${session.extensionSummary}`:'';return `<button type="button" class="member-consume-order${selected?' selected':''}" data-member-consume-order="${roomTransferEscape(session.id)}"><i>${selected?'✓':''}</i><span><b>${memberBusinessEscape(session.serviceNameSnapshot)}</b><small>${roomTransferEscape(clockTypeLabels[session.clockType]||session.clockType)} · ${memberBusinessEscape(session.technicianName)} · ${memberBusinessEscape(session.roomCode)} 房 · ${roomTransferEscape(session.plannedDurationMinutes)} 分钟${memberBusinessEscape(extension)}</small></span><strong>${money(Number(session.servicePriceCents||0)/100)}</strong></button>`;}).join('')||'<p>暂无待结算服务</p>';const total=[...memberBusinessConsumeSelection].map(id=>state.pendingServiceSessions.find(item=>item.id===id)).filter(Boolean).reduce((sum,item)=>sum+Number(item.servicePriceCents||0),0);document.querySelector('#member-consume-count').textContent=memberBusinessConsumeSelection.size;document.querySelector('#member-consume-total').textContent=money(total/100);document.querySelector('#member-consume-after').textContent=money(((memberBusinessConsumeMember?.balanceCents||0)-total)/100);}
async function submitMemberConsume(event){event.preventDefault();if(!memberBusinessConsumeMember)return toast('请先选择会员');const sessions=[...memberBusinessConsumeSelection].map(id=>state.pendingServiceSessions.find(item=>item.id===id)).filter(Boolean);if(!sessions.length)return toast('请至少选择一项待结算服务');const total=sessions.reduce((sum,item)=>sum+Number(item.servicePriceCents||0),0);if(total>memberBusinessConsumeMember.balanceCents)return toast('会员余额不足，无法完成卡耗');if(!memberBusinessBalanceMethodCode)return toast('门店尚未配置会员余额收款方式');const submit=document.querySelector('#continue-member-business');submit.disabled=true;try{const response=await fetch('http://localhost:8080/api/v1/sales-orders/settle',{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({memberId:memberBusinessConsumeMember.id,lines:sessions.map(item=>({serviceItemId:item.serviceItemId,serviceSessionId:item.id,durationMinutes:Number(item.plannedDurationMinutes)})),payments:[{method:memberBusinessBalanceMethodCode,amountCents:total}]})});if(!response.ok){toast(response.status===409?'该服务已结算或会员余额不足':'卡耗结算失败，请检查前台班次和服务状态');return;}const settled=await response.json();memberBusinessConsumeMember.balanceCents-=total;state.members=state.members.map(item=>item.id===memberBusinessConsumeMember.id?{...item,balance:memberBusinessConsumeMember.balanceCents/100}:item);state.pendingServiceSessions=state.pendingServiceSessions.filter(item=>!memberBusinessConsumeSelection.has(item.id));memberBusinessConsumeSelection.clear();renderMemberConsumeOrders();document.querySelector('#member-business-dialog').close();renderMemberCard();await Promise.all([loadMemberCenter(),loadDailyReport(),loadFoundationData({silent:true})]);toast(`卡耗成功，已扣除 ${money(total/100)}，订单 ${settled.orderNo||''}`);}catch{toast('卡耗服务连接失败');}finally{submit.disabled=false;}}
function switchMemberBusinessTab(tab){setupMemberConsumePanel();setupMemberSalesStats();const button=document.querySelector(`[data-member-business-tab="${tab}"]`);if(!button)return;document.querySelectorAll('[data-member-business-tab]').forEach(item=>{const selected=item===button;item.classList.toggle('selected',selected);item.setAttribute('aria-selected',String(selected));});document.querySelectorAll('[data-member-business-panel]').forEach(panel=>{panel.hidden=panel.dataset.memberBusinessPanel!==tab;});const continueButton=document.querySelector('#continue-member-business');continueButton.hidden=tab==='sales';continueButton.textContent={open:'办理开卡',renew:'办理续卡',consume:'办理卡耗'}[tab]||'继续办理';const formId={open:'member-open-card-form',renew:'member-renew-form',consume:'member-consume-form'}[tab];continueButton.type=formId?'submit':'button';if(formId)continueButton.setAttribute('form',formId);else continueButton.removeAttribute('form');continueButton.disabled=(tab==='renew'&&!memberBusinessRenewMember)||(tab==='consume'&&!memberBusinessConsumeMember);if(tab==='renew')document.querySelector('#member-renew-search').focus();if(tab==='consume'){loadPendingServiceSessions({silent:true}).then(renderMemberConsumeOrders);document.querySelector('#member-consume-search')?.focus();}if(tab==='sales')loadMemberSalesStats();}
async function loadMemberOpenCardOptions(){
  ensureMemberAttributionFields();
  const [technicianResponse,employeeResponse,paymentResponse]=await Promise.all([
    fetch('http://localhost:8080/api/v1/foundation/technicians',{headers:storeContextHeaders()}),
    fetch('http://localhost:8080/api/v1/employees?includeInactive=false',{headers:storeContextHeaders()}),
    fetch('http://localhost:8080/api/v1/payment-methods',{headers:storeContextHeaders()})
  ]);
  if(!technicianResponse.ok||!employeeResponse.ok||!paymentResponse.ok)throw new Error('OPEN_CARD_OPTIONS_FAILED');
  const technicians=await technicianResponse.json();
  const employees=await employeeResponse.json();
  const allMethods=await paymentResponse.json();
  memberBusinessBalanceMethodCode=allMethods.find(item=>item.methodKind==='MEMBER_BALANCE'&&item.active!==false)?.code||null;
  const methods=allMethods.filter(item=>item.methodKind==='EXTERNAL');
  const technicianOptions=`<option value="">未关联技师</option>${technicians.map(item=>`<option value="${roomTransferEscape(item.id)}">${memberBusinessEscape(item.code)} · ${memberBusinessEscape(item.name)}</option>`).join('')}`;
  const employeeOptions=`<option value="">未关联员工</option>${employees.map(item=>`<option value="${roomTransferEscape(item.employeeId)}">${memberBusinessEscape(item.employeeNo||'')} · ${memberBusinessEscape(item.fullName)}${item.positionName?` · ${memberBusinessEscape(item.positionName)}`:''}</option>`).join('')}`;
  const methodOptions=methods.map(item=>`<option value="${memberBusinessEscape(item.code)}">${memberBusinessEscape(item.name)}</option>`).join('');
  document.querySelector('#member-open-technician').innerHTML=technicianOptions;
  document.querySelector('#member-renew-technician').innerHTML=technicianOptions;
  document.querySelector('#member-open-employee').innerHTML=employeeOptions;
  document.querySelector('#member-renew-employee').innerHTML=employeeOptions;
  document.querySelector('#member-open-payment').innerHTML=`<option value="">无首次充值</option>${methodOptions}`;
  document.querySelector('#member-renew-payment').innerHTML=methodOptions;
}
function resetMemberRenewForm(){memberBusinessRenewMember=null;window.clearTimeout(memberBusinessRenewTimer);const form=document.querySelector('#member-renew-form');form.reset();form.bonus.value='0.00';form.classList.add('hidden');document.querySelector('#member-renew-search').value='';document.querySelector('#member-renew-results').innerHTML='<p>输入会员信息开始查询</p>';document.querySelector('#continue-member-business').disabled=true;}
async function openMemberBusinessDialog(){setupMemberConsumePanel();const form=document.querySelector('#member-open-card-form');form.reset();form.amount.value='0.00';form.bonus.value='0.00';resetMemberRenewForm();memberBusinessConsumeMember=null;memberBusinessConsumeSelection.clear();switchMemberBusinessTab('open');try{await loadMemberOpenCardOptions();}catch{return toast('会员业务选项加载失败，请检查收款方式和技师资料');}document.querySelector('#member-business-dialog').showModal();}
document.querySelector('#current-order').addEventListener('click',()=>openMemberBusinessDialog());
document.querySelector('#close-member-business').addEventListener('click',()=>document.querySelector('#member-business-dialog').close());
document.querySelector('#cancel-member-business').addEventListener('click',()=>document.querySelector('#member-business-dialog').close());
document.querySelector('#member-business-tabs').addEventListener('click',event=>{const button=event.target.closest('[data-member-business-tab]');if(button)switchMemberBusinessTab(button.dataset.memberBusinessTab);});
document.querySelector('#continue-member-business').addEventListener('click',()=>{const tab=document.querySelector('[data-member-business-tab].selected')?.dataset.memberBusinessTab;if(tab==='open'||tab==='renew'||tab==='consume')return;const label={consume:'卡耗'}[tab]||'会员';toast(`${label}业务将在对应步骤接入`);});
document.querySelector('#member-open-card-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const data=new FormData(form);const amount=Number(data.get('amount')),bonus=Number(data.get('bonus'));if(!Number.isFinite(amount)||amount<0||!Number.isFinite(bonus)||bonus<0)return toast('请输入有效的充值和赠送金额');if(bonus>0&&amount===0)return toast('赠送金额需要同时填写首次充值');if(amount>0&&!data.get('paymentMethod'))return toast('请选择首次充值的收款方式');const submit=document.querySelector('#continue-member-business');submit.disabled=true;try{const response=await fetch('http://localhost:8080/api/v1/members/open-card',{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({name:String(data.get('name')||'').trim(),phone:String(data.get('phone')||'').trim(),amountCents:Math.round(amount*100),bonusCents:Math.round(bonus*100),paymentMethod:data.get('paymentMethod')||null,technicianId:data.get('technicianId')||null,employeeId:data.get('employeeId')||null,note:String(data.get('note')||'').trim()||null})});if(!response.ok){if(response.status===409)return toast('该手机号已经是启用会员');return toast(response.status===400?'请检查开卡金额、收款方式和充值归属':'开卡保存失败，请稍后重试');}const member=await response.json();state.selectedMemberId=member.id;state.members=[{id:member.id,name:member.name,phone:member.phone,level:'储值会员',balance:Number(member.balanceCents||0)/100},...state.members.filter(item=>item.id!==member.id)];document.querySelector('#member-business-dialog').close();renderMemberCard();await Promise.all([loadMemberCenter(),loadDailyReport()]);toast(member.reactivated?`归档会员已恢复，原会员卡号 ${member.code}`:`开卡成功，会员卡号 ${member.code}`);}catch{toast('开卡服务连接失败');}finally{submit.disabled=false;}});
async function searchMemberRenewCandidates(){const query=document.querySelector('#member-renew-search').value.trim();const target=document.querySelector('#member-renew-results');if(!query){target.innerHTML='<p>输入会员信息开始查询</p>';return;}target.innerHTML='<p>正在查询会员</p>';try{const response=await fetch(`http://localhost:8080/api/v1/members?query=${encodeURIComponent(query)}`,{headers:storeContextHeaders()});if(!response.ok)throw new Error(response.status);const rows=await response.json();target.innerHTML=rows.map(member=>`<button class="member-business-result" type="button" data-member-renew-select="${roomTransferEscape(member.id)}"><span><b>${memberBusinessEscape(member.name)}</b><small>${memberBusinessEscape(member.code)} · ${memberBusinessEscape(member.phone)}</small></span><strong>${money(Number(member.balanceCents||0)/100)}</strong></button>`).join('')||'<p>没有找到符合条件的会员</p>';}catch{target.innerHTML='<p>会员查询失败，请稍后重试</p>';}}
document.querySelector('#member-renew-search').addEventListener('input',()=>{window.clearTimeout(memberBusinessRenewTimer);memberBusinessRenewTimer=window.setTimeout(searchMemberRenewCandidates,240);});
document.querySelector('#member-renew-results').addEventListener('click',event=>{const button=event.target.closest('[data-member-renew-select]');if(!button)return;const name=button.querySelector('b').textContent;const meta=button.querySelector('small').textContent;const balance=button.querySelector('strong').textContent;memberBusinessRenewMember={id:button.dataset.memberRenewSelect,name,meta,balance};document.querySelector('#member-renew-name').textContent=name;document.querySelector('#member-renew-meta').textContent=meta;document.querySelector('#member-renew-balance').textContent=balance;document.querySelector('#member-renew-form').classList.remove('hidden');document.querySelector('#member-renew-results').innerHTML='';document.querySelector('#continue-member-business').disabled=false;document.querySelector('#member-renew-form input[name="amount"]').focus();});
document.querySelector('#member-renew-change').addEventListener('click',()=>{resetMemberRenewForm();switchMemberBusinessTab('renew');});
document.querySelector('#member-renew-form').addEventListener('submit',async event=>{event.preventDefault();if(!memberBusinessRenewMember)return toast('请先选择需要续卡的会员');const form=event.currentTarget;const data=new FormData(form);const amount=Number(data.get('amount')),bonus=Number(data.get('bonus'));if(!Number.isFinite(amount)||amount<=0||!Number.isFinite(bonus)||bonus<0)return toast('请输入有效的续卡和赠送金额');const submit=document.querySelector('#continue-member-business');submit.disabled=true;try{const response=await fetch(`http://localhost:8080/api/v1/members/${memberBusinessRenewMember.id}/recharges`,{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({amountCents:Math.round(amount*100),bonusCents:Math.round(bonus*100),paymentMethod:data.get('paymentMethod'),technicianId:data.get('technicianId')||null,employeeId:data.get('employeeId')||null,note:String(data.get('note')||'').trim()||null})});if(!response.ok)return toast(response.status===400?'请检查续卡金额、收款方式和充值归属':'续卡保存失败，请稍后重试');const member=await response.json();state.members=state.members.map(item=>item.id===member.id?{...item,balance:Number(member.balanceCents||0)/100}:item);document.querySelector('#member-business-dialog').close();if(state.selectedMemberId===member.id)renderMemberCard();await Promise.all([loadMemberCenter(),loadDailyReport()]);toast(`续卡成功，当前余额 ${money(Number(member.balanceCents||0)/100)}`);}catch{toast('续卡服务连接失败');}finally{submit.disabled=false;}});
const closeSettlementActions=()=>document.querySelector('#frontdesk-settlement-actions-dialog').close();
function pendingPaymentRooms() {
  return state.rooms.filter(room => room.apiId && room.status === 'pending-payment');
}
function setupSingleRoomSettlementDialog() {
  if (document.querySelector('#single-room-settlement-dialog')) return;
  document.body.insertAdjacentHTML('beforeend', '<dialog id="single-room-settlement-dialog" class="frontdesk-status-dialog"><form id="single-room-settlement-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">单房结算</p><h2>选择待付款房间</h2></div><button class="icon-button" type="button" id="close-single-room-settlement" aria-label="关闭">×</button></div><div class="form-grid"><label class="form-full">结算房间<select id="single-room-settlement-room" name="roomId" required></select><small id="single-room-settlement-summary"></small></label></div><p class="frontdesk-status-note">进入后只显示该房间的待结算服务，其他房间服务不会加入本次订单。</p><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-single-room-settlement">取消</button><button class="button primary" type="submit">进入结算</button></div></form></dialog>');
  document.querySelector('#close-single-room-settlement').addEventListener('click',()=>document.querySelector('#single-room-settlement-dialog').close());
  document.querySelector('#cancel-single-room-settlement').addEventListener('click',()=>document.querySelector('#single-room-settlement-dialog').close());
  document.querySelector('#single-room-settlement-room').addEventListener('change',renderSingleRoomSettlementSelection);
  document.querySelector('#single-room-settlement-form').addEventListener('submit',submitSingleRoomSettlementSelection);
}
function renderSingleRoomSettlementSelection() {
  const select = document.querySelector('#single-room-settlement-room');
  const summary = document.querySelector('#single-room-settlement-summary');
  const room = state.rooms.find(item => String(item.apiId) === String(select?.value));
  if (!room) { summary.textContent = ''; return; }
  summary.textContent = `${room.id} 房 · ${room.detail || '待付款服务'}`;
}
async function openSingleRoomSettlementSelection() {
  setupSingleRoomSettlementDialog();
  const ready = await loadFoundationData({ silent: true });
  if (!ready) return toast('房间与待结算服务加载失败，请刷新后重试');
  const rooms = pendingPaymentRooms();
  if (!rooms.length) return toast('当前没有待付款房间');
  const select = document.querySelector('#single-room-settlement-room');
  select.innerHTML = rooms.map(room => `<option value="${roomTransferEscape(room.apiId)}">${memberBusinessEscape(room.id)} 房 · ${memberBusinessEscape(room.detail || '待付款服务')}</option>`).join('');
  renderSingleRoomSettlementSelection();
  document.querySelector('#single-room-settlement-dialog').showModal();
}
async function submitSingleRoomSettlementSelection(event) {
  event.preventDefault();
  const roomId = document.querySelector('#single-room-settlement-room').value;
  const room = state.rooms.find(item => String(item.apiId) === String(roomId));
  if (!room || room.status !== 'pending-payment') return toast('请选择当前待付款房间');
  document.querySelector('#single-room-settlement-dialog').close();
  await openSingleRoomSettlement(room);
}
let mergeSettlementGroups=[];
let mergeSettlementSelection=new Set();
let mergeSettlementMemberId=null;
let mergeSettlementPaymentDraft=new Map();

function mergeSelectedGroups(){return [...mergeSettlementSelection].map(index=>mergeSettlementGroups[index]).filter(Boolean);}
function mergeSelectedSessions(){return mergeSelectedGroups().flatMap(group=>group.sessions);}
function mergeOriginalCents(){return mergeSelectedSessions().reduce((sum,item)=>sum+Number(item.servicePriceCents||0),0);}
function mergeAmountCents(){return Math.round(Math.max(0,Number(document.querySelector('#merge-settlement-amount')?.value)||0)*100);}
function mergeIsWaived(){return Boolean(document.querySelector('#merge-settlement-waive')?.checked);}
function mergePayments(){return [...document.querySelectorAll('[data-merge-payment-amount]')].map(input=>({method:input.dataset.mergePaymentAmount,amountCents:Math.round(Math.max(0,Number(input.value)||0)*100)})).filter(item=>item.amountCents>0);}

function setupMergeSettlementDialog(){
  if(document.querySelector('#merge-settlement-dialog'))return;
  document.body.insertAdjacentHTML('beforeend','<dialog id="merge-settlement-dialog" class="merge-settlement-dialog"><form id="merge-settlement-form" class="dialog-card merge-settlement-card"><div class="dialog-heading"><div><p class="eyebrow">多房结算工作台</p><h2>选择房间并完成统一收款</h2></div><button class="icon-button" type="button" id="close-merge-settlement" aria-label="关闭">×</button></div><div class="merge-settlement-layout"><section class="merge-settlement-room-pane"><div class="merge-settlement-section-heading"><div><b>待结算房间</b><small>同一营业日的有效订单可以合并</small></div><label class="merge-room-search"><span>⌕</span><input id="merge-room-search" placeholder="搜索房间号、工单号或项目"></label></div><div id="merge-settlement-rooms" class="merge-settlement-rooms"></div><div class="merge-settlement-selected" id="merge-settlement-selected"><p>请选择两个或以上房间</p></div></section><aside class="merge-settlement-summary"><section class="settlement-member merge-settlement-member"><div><span>结算会员</span><b id="merge-member-name">散客</b><small id="merge-member-meta">非会员结算</small></div><button class="button secondary" type="button" id="merge-select-member">查询会员</button></section><section class="settlement-amount-summary"><div><span>项目原价</span><strong id="merge-original-total">¥0.00</strong></div><div><span>优惠/加价</span><strong id="merge-adjustment">¥0.00</strong></div><div class="settlement-received"><span>实收金额</span><label class="settlement-amount-input"><span>¥</span><input id="merge-settlement-amount" type="number" min="0" step="0.01" value="0.00" aria-label="合并结算实收金额"></label></div></section><label class="settlement-waive-option"><input id="merge-settlement-waive" type="checkbox"> 免单</label><label class="settlement-waive-reason" id="merge-waive-reason-wrap" hidden>免单原因<textarea id="merge-waive-reason" rows="2" maxlength="240" placeholder="请输入免单原因"></textarea></label><div class="settlement-payment-heading"><span>支付方式</span><small>支持组合支付</small></div><div class="payment-options" id="merge-payment-options"></div><section class="settlement-allocation-summary"><span>已分配 <b id="merge-allocated">¥0.00</b></span><span>待分配 <b id="merge-remaining">¥0.00</b></span></section><button class="button primary" type="submit" id="submit-merge-settlement" disabled>确认合并收款</button></aside></div></form></dialog>');
  document.querySelector('#close-merge-settlement').addEventListener('click',()=>document.querySelector('#merge-settlement-dialog').close());
  document.querySelector('#merge-settlement-rooms').addEventListener('click',event=>{const button=event.target.closest('[data-merge-room]');if(!button||button.disabled)return;const index=Number(button.dataset.mergeRoom);if(mergeSettlementSelection.has(index))mergeSettlementSelection.delete(index);else mergeSettlementSelection.add(index);renderMergeSettlement({resetAmount:true});});
  document.querySelector('#merge-room-search').addEventListener('input',()=>renderMergeSettlement());
  document.querySelector('#merge-select-member').addEventListener('click',()=>openSettlementMemberSearch('merge'));
  document.querySelector('#merge-settlement-amount').addEventListener('input',()=>{if(mergeIsWaived()){document.querySelector('#merge-settlement-waive').checked=false;document.querySelector('#merge-waive-reason-wrap').hidden=true;}updateMergeSettlementAllocation();});
  document.querySelector('#merge-settlement-waive').addEventListener('change',event=>{const checked=event.currentTarget.checked;document.querySelector('#merge-settlement-amount').value=checked?'0.00':(mergeOriginalCents()/100).toFixed(2);document.querySelector('#merge-waive-reason-wrap').hidden=!checked;mergeSettlementPaymentDraft=new Map();renderMergePaymentMethods();});
  document.querySelector('#merge-waive-reason').addEventListener('input',updateMergeSettlementAllocation);
  document.querySelector('#merge-payment-options').addEventListener('input',event=>{if(event.target.matches('[data-merge-payment-amount]'))updateMergeSettlementAllocation();});
  document.querySelector('#merge-payment-options').addEventListener('click',event=>{const button=event.target.closest('[data-fill-merge-payment]');if(!button||button.disabled)return;const inputs=[...document.querySelectorAll('[data-merge-payment-amount]')];const current=inputs.find(input=>input.dataset.mergePaymentAmount===button.dataset.fillMergePayment);const other=inputs.filter(input=>input!==current).reduce((sum,input)=>sum+Math.round(Math.max(0,Number(input.value)||0)*100),0);current.value=(Math.max(0,mergeAmountCents()-other)/100).toFixed(2);updateMergeSettlementAllocation();});
  document.querySelector('#merge-settlement-form').addEventListener('submit',submitMergeSettlement);
}

function renderMergeMember(){const member=state.members.find(item=>item.id===mergeSettlementMemberId);document.querySelector('#merge-member-name').textContent=member?.name||'散客';document.querySelector('#merge-member-meta').textContent=member?`${member.phone}${member.code?` · ${member.code}`:''} · 余额 ${money(member.balance||0)}`:'非会员结算';renderMergePaymentMethods();}

function renderMergePaymentMethods({reset=false}={}){
  const container=document.querySelector('#merge-payment-options');if(!container)return;
  const methods=activePaymentMethods.filter(item=>item.active!==false);const member=state.members.find(item=>item.id===mergeSettlementMemberId);const first=methods.find(item=>item.methodKind!=='MEMBER_BALANCE'||member)?.code;
  if(reset){mergeSettlementPaymentDraft=new Map();if(first&&mergeAmountCents()>0)mergeSettlementPaymentDraft.set(first,(mergeAmountCents()/100).toFixed(2));}
  container.innerHTML=methods.map(item=>{const blocked=item.methodKind==='MEMBER_BALANCE'&&!member;const note=item.methodKind==='MEMBER_BALANCE'?(blocked?'需先选择会员':`余额 ${money(member.balance||0)}`):(item.cashCounted?'计入现金':'');const value=blocked?'':(mergeSettlementPaymentDraft.get(item.code)||'');return `<label class="payment-option${blocked?' disabled':''}"><span><b>${memberBusinessEscape(item.name)}</b><small>${memberBusinessEscape(note)}</small></span><span class="payment-amount-control"><i>¥</i><input type="number" min="0" step="0.01" data-merge-payment-amount="${memberBusinessEscape(item.code)}" value="${memberBusinessEscape(value)}" ${blocked?'disabled':''}><button type="button" data-fill-merge-payment="${memberBusinessEscape(item.code)}" ${blocked?'disabled':''}>填入剩余</button></span></label>`;}).join('')||'<p class="empty-state">当前门店没有可用的收款方式</p>';
  updateMergeSettlementAllocation();
}

function updateMergeSettlementAllocation(){
  document.querySelectorAll('[data-merge-payment-amount]').forEach(input=>mergeSettlementPaymentDraft.set(input.dataset.mergePaymentAmount,input.value));
  const original=mergeOriginalCents(),amount=mergeAmountCents(),allocated=mergePayments().reduce((sum,item)=>sum+item.amountCents,0),remaining=amount-allocated;
  document.querySelector('#merge-original-total').textContent=money(original/100);document.querySelector('#merge-adjustment').textContent=money((original-amount)/100);document.querySelector('#merge-allocated').textContent=money(allocated/100);document.querySelector('#merge-remaining').textContent=remaining===0?money(0):`${remaining<0?'-':''}${money(Math.abs(remaining)/100)}`;document.querySelector('#merge-remaining').classList.toggle('settlement-overpaid',remaining<0);
  const memberPayment=mergePayments().find(payment=>activePaymentMethods.find(method=>method.code===payment.method)?.methodKind==='MEMBER_BALANCE');const member=state.members.find(item=>item.id===mergeSettlementMemberId);const validMember=!memberPayment||(member&&memberPayment.amountCents<=Math.round(Number(member.balance||0)*100));
  const waiveReason=document.querySelector('#merge-waive-reason')?.value.trim()||'';document.querySelector('#submit-merge-settlement').disabled=mergeSelectedGroups().length<2||(!mergeIsWaived()&&amount<1)||(mergeIsWaived()&&(!waiveReason||amount!==0))||remaining!==0||(amount>0&&!mergePayments().length)||!validMember;
}

async function openMergeSettlement(){
  setupMergeSettlementDialog();closeSettlementActions();mergeSettlementSelection.clear();mergeSettlementMemberId=null;mergeSettlementPaymentDraft=new Map();document.querySelector('#merge-room-search').value='';document.querySelector('#merge-settlement-waive').checked=false;document.querySelector('#merge-waive-reason').value='';document.querySelector('#merge-waive-reason-wrap').hidden=true;
  const [pendingLoaded,paymentResponse]=await Promise.all([loadPendingServiceSessions({silent:true}),fetch('http://localhost:8080/api/v1/payment-methods',{headers:storeContextHeaders()})]);if(!pendingLoaded||!paymentResponse.ok)return toast('合并结算资料加载失败');activePaymentMethods=(await paymentResponse.json()).filter(item=>item.active!==false);
  const groups=new Map();state.pendingServiceSessions.forEach(session=>{const key=`${session.businessDate||''}|${session.roomCode}`;if(!groups.has(key))groups.set(key,{businessDate:session.businessDate||'',roomCode:session.roomCode,sessions:[]});groups.get(key).sessions.push(session);});mergeSettlementGroups=[...groups.values()].sort((a,b)=>String(a.roomCode).localeCompare(String(b.roomCode),'zh-CN',{numeric:true}));renderMergeMember();renderMergeSettlement({resetAmount:true});document.querySelector('#merge-settlement-dialog').showModal();
}

function renderMergeSettlement({resetAmount=false}={}){
  const selectedDates=new Set(mergeSelectedGroups().map(group=>group.businessDate).filter(Boolean));const activeDate=selectedDates.size===1?[...selectedDates][0]:null;const keyword=document.querySelector('#merge-room-search')?.value.trim().toLowerCase()||'';
  document.querySelector('#merge-settlement-rooms').innerHTML=mergeSettlementGroups.map((group,index)=>({group,index})).filter(({group})=>!keyword||`${group.roomCode} ${group.sessions.map(item=>`${item.serviceNo||''} ${item.serviceNameSnapshot||''} ${item.technicianName||''}`).join(' ')}`.toLowerCase().includes(keyword)).map(({group,index})=>{const selected=mergeSettlementSelection.has(index);const disabled=!selected&&activeDate&&group.businessDate!==activeDate;const total=group.sessions.reduce((sum,item)=>sum+Number(item.servicePriceCents||0),0);return `<button type="button" class="merge-settlement-room${selected?' selected':''}" data-merge-room="${index}" ${disabled?'disabled':''}><i>${selected?'✓':''}</i><span><b>${memberBusinessEscape(group.roomCode)} 房</b><small>${roomTransferEscape(group.businessDate||'当前营业日')} · ${roomTransferEscape(group.sessions.length)} 项 · ${group.sessions.map(item=>memberBusinessEscape(item.serviceNo||'')).join('、')}</small></span><strong>${money(total/100)}</strong></button>`;}).join('')||'<p class="merge-settlement-empty">没有匹配的待结算房间</p>';
  const selected=mergeSelectedGroups();document.querySelector('#merge-settlement-selected').innerHTML=selected.length?selected.map(group=>`<div><span><b>${memberBusinessEscape(group.roomCode)} 房</b><small>${group.sessions.map(item=>memberBusinessEscape(item.serviceNameSnapshot)).join('、')}</small></span><strong>${money(group.sessions.reduce((sum,item)=>sum+Number(item.servicePriceCents||0),0)/100)}</strong></div>`).join(''):'<p>请选择两个或以上房间</p>';
  if(resetAmount)document.querySelector('#merge-settlement-amount').value=mergeIsWaived()?'0.00':(mergeOriginalCents()/100).toFixed(2);renderMergePaymentMethods({reset:resetAmount});
}

async function submitMergeSettlement(event){
  event.preventDefault();const groups=mergeSelectedGroups();if(groups.length<2)return toast('请至少选择两个房间');if(new Set(groups.map(group=>group.businessDate)).size>1)return toast('不同营业日的订单需要分开结算');const sessions=mergeSelectedSessions(),amount=mergeAmountCents(),waived=mergeIsWaived(),waiveReason=document.querySelector('#merge-waive-reason').value.trim(),payments=mergePayments();if(waived&&amount!==0)return toast('免单结算的实收金额必须为 0.00 元');if(amount===0&&(!waived||!waiveReason))return toast('0.00 元结算必须勾选免单并填写原因');if(amount>0&&amount<1)return toast('普通结算最低实收金额为 0.01 元');if(payments.reduce((sum,item)=>sum+item.amountCents,0)!==amount)return toast('收款金额合计必须等于实收金额');const member=state.members.find(item=>item.id===mergeSettlementMemberId);const memberPayment=payments.find(payment=>activePaymentMethods.find(method=>method.code===payment.method)?.methodKind==='MEMBER_BALANCE');if(memberPayment&&!member)return toast('会员余额结算必须选择会员');if(memberPayment&&memberPayment.amountCents>Math.round(Number(member.balance||0)*100))return toast('会员余额不足，请调整组合支付金额');
  const submit=document.querySelector('#submit-merge-settlement');submit.disabled=true;const printWindow=storePrintSetting?.autoPrint&&!localPrintBridgeOnline?window.open('','massage-merge-receipt','popup,width=480,height=720'):null;
  try{const response=await fetch('http://localhost:8080/api/v1/sales-orders/settle',{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({memberId:mergeSettlementMemberId,settlementAmountCents:amount,waiveReason:waived?waiveReason:null,lines:sessions.map(item=>({serviceItemId:item.serviceItemId,serviceSessionId:item.id,durationMinutes:Number(item.plannedDurationMinutes)})),payments})});if(!response.ok){if(printWindow)printWindow.close();return toast(await responseMessage(response,'合并结算失败，请刷新订单后重试'));}const order=await response.json();document.querySelector('#merge-settlement-dialog').close();mergeSettlementSelection.clear();await Promise.all([loadPendingServiceSessions({silent:true}),loadFoundationData({silent:true}),loadSalesOrders(),loadDailyReport()]);if(printWindow){const detailResponse=await fetch(`http://localhost:8080/api/v1/sales-orders/${order.id}`,{headers:storeContextHeaders()});if(detailResponse.ok)printOrder(await detailResponse.json(),printWindow).catch(()=>{printWindow.close();toast('订单已完成，小票打印失败');});else printWindow.close();}toast(`合并结算成功，订单 ${order.orderNo}`);}catch{if(printWindow)printWindow.close();toast('合并结算服务连接失败');}finally{submit.disabled=false;updateMergeSettlementAllocation();}
}
function setupFrontdeskRoomTransferDialog(){if(document.querySelector('#frontdesk-room-transfer-dialog'))return;document.body.insertAdjacentHTML('beforeend','<dialog id="frontdesk-room-transfer-dialog" class="frontdesk-room-transfer-dialog"><form id="frontdesk-room-transfer-form" class="dialog-card frontdesk-room-transfer-card"><div class="dialog-heading"><div><p class="eyebrow">前台更换房间</p><h2>转移服务与计时</h2></div><button class="icon-button" type="button" id="close-frontdesk-room-transfer" aria-label="关闭">×</button></div><div class="frontdesk-room-transfer-flow"><label><span>当前服务</span><select name="serviceSessionId" id="frontdesk-transfer-session" required></select></label><span class="frontdesk-transfer-arrow">→</span><label><span>目标空闲房间</span><select name="toRoomId" id="frontdesk-transfer-room" required></select></label></div><div class="frontdesk-transfer-preview" id="frontdesk-transfer-preview"></div><label class="frontdesk-transfer-reason">换房原因<textarea name="reason" rows="3" maxlength="240" required placeholder="例如：顾客临时加项目，需要更换项目房"></textarea></label><p class="frontdesk-transfer-note">确认后原房间进入清洁，新房间继续当前服务倒计时，技师端同步显示新房间。</p><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-frontdesk-room-transfer">取消</button><button class="button primary" type="submit" id="submit-frontdesk-room-transfer">确认更换房间</button></div></form></dialog>');document.querySelector('#close-frontdesk-room-transfer').addEventListener('click',()=>document.querySelector('#frontdesk-room-transfer-dialog').close());document.querySelector('#cancel-frontdesk-room-transfer').addEventListener('click',()=>document.querySelector('#frontdesk-room-transfer-dialog').close());document.querySelector('#frontdesk-transfer-session').addEventListener('change',renderFrontdeskRoomTransferPreview);document.querySelector('#frontdesk-transfer-room').addEventListener('change',renderFrontdeskRoomTransferPreview);document.querySelector('#frontdesk-room-transfer-form').addEventListener('submit',submitFrontdeskRoomTransfer);}
async function openFrontdeskRoomTransfer(){setupFrontdeskRoomTransferDialog();closeSettlementActions();const ready=await loadFoundationData({silent:true});if(!ready)return toast('服务与房间状态加载失败');const sessions=state.activeSessions.filter(session=>session.roomId&&session.status==='IN_SERVICE');const rooms=state.rooms.filter(room=>room.status==='idle');if(!sessions.length)return toast('当前没有服务中的房间');if(!rooms.length)return toast('当前没有可转入的空闲房间');document.querySelector('#frontdesk-transfer-session').innerHTML=sessions.map(session=>`<option value="${roomTransferEscape(session.id)}">${memberBusinessEscape(session.roomCode)} 房 · ${memberBusinessEscape(session.technicianName)} · ${memberBusinessEscape(session.serviceNameSnapshot)}</option>`).join('');document.querySelector('#frontdesk-transfer-room').innerHTML=rooms.map(room=>`<option value="${roomTransferEscape(room.apiId)}">${memberBusinessEscape(room.id)} 房 · ${memberBusinessEscape(room.detail||'空闲')}</option>`).join('');document.querySelector('#frontdesk-room-transfer-form').reason.value='';renderFrontdeskRoomTransferPreview();document.querySelector('#frontdesk-room-transfer-dialog').showModal();}
function renderFrontdeskRoomTransferPreview(){const session=state.activeSessions.find(item=>item.id===document.querySelector('#frontdesk-transfer-session')?.value);const room=state.rooms.find(item=>item.apiId===document.querySelector('#frontdesk-transfer-room')?.value);const target=document.querySelector('#frontdesk-transfer-preview');if(!target)return;target.innerHTML=session&&room?`<div><span><b>${memberBusinessEscape(session.roomCode)} 房</b><small>${memberBusinessEscape(session.technicianName)} · ${memberBusinessEscape(session.serviceNameSnapshot)}</small></span><em>原房转清洁</em></div><i>→</i><div><span><b>${memberBusinessEscape(room.id)} 房</b><small>继续服务与原倒计时</small></span><em>新房服务中</em></div>`:'<p>请选择服务和目标房间</p>';}
async function submitFrontdeskRoomTransfer(event){event.preventDefault();const data=new FormData(event.currentTarget);const submit=document.querySelector('#submit-frontdesk-room-transfer');submit.disabled=true;try{const request=await fetch('http://localhost:8080/api/v1/service-room-transfers',{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({serviceSessionId:data.get('serviceSessionId'),toRoomId:data.get('toRoomId'),reason:String(data.get('reason')||'').trim()})});if(!request.ok)return toast('换房申请失败：目标房间可能已被占用或服务状态已变化');const transfer=await request.json();const approval=await fetch(`http://localhost:8080/api/v1/service-room-transfers/${transfer.id}/approve`,{method:'POST',headers:storeContextHeaders()});if(!approval.ok){return toast('换房申请已保留，请稍后刷新房间状态');}document.querySelector('#frontdesk-room-transfer-dialog').close();await loadFoundationData({silent:true});toast(`${transfer.fromRoomCode} 房已转入 ${transfer.toRoomCode} 房，原房间待清洁`);}catch{toast('更换房间服务连接失败');}finally{submit.disabled=false;}}
function setupFrontdeskStatusDialog(){if(document.querySelector('#frontdesk-status-dialog'))return;document.body.insertAdjacentHTML('beforeend','<dialog id="frontdesk-status-dialog" class="frontdesk-status-dialog"><form id="frontdesk-status-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">前台房间状态</p><h2>快捷处理</h2></div><button class="icon-button" type="button" id="close-frontdesk-status" aria-label="关闭">×</button></div><div class="form-grid"><label class="form-full">选择房间<select name="roomId" id="frontdesk-status-room" required></select></label><label class="form-full">下一状态<select name="action" id="frontdesk-status-action" required></select></label><label class="form-full">备注<input name="reason" maxlength="240" placeholder="可选"></label></div><p class="frontdesk-status-note">待付款确认后进入清洁；清洁完成后恢复空闲。服务中的房间不能直接改状态。</p><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-frontdesk-status">取消</button><button class="button primary" type="submit">确认处理</button></div></form></dialog>');document.querySelector('#close-frontdesk-status').addEventListener('click',()=>document.querySelector('#frontdesk-status-dialog').close());document.querySelector('#cancel-frontdesk-status').addEventListener('click',()=>document.querySelector('#frontdesk-status-dialog').close());document.querySelector('#frontdesk-status-room').addEventListener('change',renderFrontdeskStatusActions);document.querySelector('#frontdesk-status-form').addEventListener('submit',submitFrontdeskStatusAction);}
function openFrontdeskStatusDialog(){setupFrontdeskStatusDialog();closeSettlementActions();const rooms=state.rooms.filter(room=>room.apiId);document.querySelector('#frontdesk-status-room').innerHTML=rooms.map(room=>`<option value="${roomTransferEscape(room.apiId)}">${memberBusinessEscape(room.id)} 房 · ${memberBusinessEscape(room.label)}</option>`).join('');renderFrontdeskStatusActions();document.querySelector('#frontdesk-status-dialog').showModal();}
function renderFrontdeskStatusActions(){const room=state.rooms.find(item=>item.apiId===document.querySelector('#frontdesk-status-room')?.value);const action=document.querySelector('#frontdesk-status-action');if(!action)return;const actions=room?.status==='pending-payment'?[['confirm-payment','已付款并进入清洁']]:room?.status==='cleaning'?[['complete-cleaning','完成清洁并恢复空闲']]:room?.status==='reserved'?[['status-idle','恢复空闲']]:room?.status==='idle'?[['status-reserved','设为预留']]:room?.status==='maintenance'?[['status-idle','恢复空闲']]:[['blocked','服务中不可快捷改状态']];action.innerHTML=actions.map(item=>`<option value="${roomTransferEscape(item[0])}" ${item[0]==='blocked'?'disabled':''}>${roomTransferEscape(item[1])}</option>`).join('');action.disabled=actions[0]?.[0]==='blocked';}
async function submitFrontdeskStatusAction(event){event.preventDefault();const form=new FormData(event.currentTarget);const roomId=form.get('roomId');const action=form.get('action');if(action==='blocked')return toast('服务中的房间请先完成服务或使用更换房间');const reason=String(form.get('reason')||'').trim()||'前台快捷状态处理';let url,body=null;if(action==='confirm-payment')url=`http://localhost:8080/api/v1/rooms/${roomId}/confirm-payment`;else if(action==='complete-cleaning')url=`http://localhost:8080/api/v1/rooms/${roomId}/complete-cleaning`;else{url=`http://localhost:8080/api/v1/rooms/${roomId}/status`;body={status:action==='status-reserved'?'RESERVED':'IDLE',reason};}const response=await fetch(url,{method:'POST',headers:storeContextHeaders(true),...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)return toast('状态处理失败，请刷新房间状态后重试');document.querySelector('#frontdesk-status-dialog').close();await loadFoundationData({silent:true});toast('房间状态已更新');}
document.querySelector('#close-settlement-actions').addEventListener('click',closeSettlementActions);
document.querySelector('#cancel-settlement-actions').addEventListener('click',closeSettlementActions);
document.querySelector('.settlement-action-grid').addEventListener('click',event=>{const button=event.target.closest('[data-settlement-entry]');if(!button)return;const action=button.dataset.settlementEntry;if(action==='single'){closeSettlementActions();openSingleRoomSettlementSelection();return;}if(action==='merge'){openMergeSettlement();return;}if(action==='transfer'){openFrontdeskRoomTransfer();return;}if(action==='status'){openFrontdeskStatusDialog();return;}const label={}[action]||'结算';toast(`${label}将在对应步骤接入`);});
document.querySelector('#close-order-panel').addEventListener('click', () => setOrderDrawer(false));
document.querySelector('#order-drawer-backdrop').addEventListener('click', () => setOrderDrawer(false));
let settlementMemberTarget = 'single';
function openSettlementMemberSearch(target = 'single') {
  settlementMemberTarget = target;
  const input = document.querySelector('#member-search');
  input.value = '';
  document.querySelector('#member-dialog').showModal();
  renderMemberResults();
  window.setTimeout(() => input.focus(), 0);
}
document.querySelector('#change-member').addEventListener('click', openSettlementMemberSearch);
document.querySelector('#settlement-select-member').addEventListener('click', openSettlementMemberSearch);
document.querySelector('#close-member-dialog').addEventListener('click', () => document.querySelector('#member-dialog').close());
document.querySelector('#select-guest-member').addEventListener('click', () => {
  if (settlementMemberTarget === 'merge') { mergeSettlementMemberId = null; renderMergeMember(); }
  else { state.selectedMemberId = null; renderMemberCard(); renderSettlementPaymentMethods(); }
  document.querySelector('#member-dialog').close();
  toast('本单已设为散客结算');
});
document.querySelector('#member-dialog .dialog-heading').insertAdjacentHTML('beforeend','<button class="button secondary" type="button" id="add-member">新增会员</button>');
document.body.insertAdjacentHTML('beforeend','<dialog id="member-create-dialog"><form id="member-create-form" class="dialog-card compact"><div class="dialog-heading"><h2>新增会员</h2><button class="icon-button" type="button" id="close-member-create" aria-label="关闭">×</button></div><div class="form-grid"><label>姓名<input name="name" required /></label><label>手机号<input name="phone" required /></label></div><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-member-create">取消</button><button class="button primary" type="submit">开户</button></div></form></dialog><dialog id="member-recharge-dialog"><form id="member-recharge-form" class="dialog-card compact"><div class="dialog-heading"><h2 id="member-recharge-title">储值充值</h2><button class="icon-button" type="button" id="close-member-recharge" aria-label="关闭">×</button></div><div class="form-grid"><label>充值金额<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>赠送金额<input name="bonus" type="number" min="0" step="0.01" value="0" required /></label><label>收款方式<select name="paymentMethod" required></select></label><label>服务技师<select name="technicianId"></select></label></div><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-member-recharge">取消</button><button class="button primary" type="submit">确认充值</button></div></form></dialog>');
document.querySelector('#add-member').addEventListener('click',()=>document.querySelector('#member-create-dialog').showModal());
document.querySelector('#member-center-add').addEventListener('click',()=>document.querySelector('#member-create-dialog').showModal());
document.querySelector('#close-member-create').addEventListener('click',()=>document.querySelector('#member-create-dialog').close());
document.querySelector('#cancel-member-create').addEventListener('click',()=>document.querySelector('#member-create-dialog').close());
document.querySelector('#member-create-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const r=await fetch('http://localhost:8080/api/v1/members',{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({name:f.get('name'),phone:f.get('phone')})});if(!r.ok)return toast(r.status===409?'该手机号已经是启用会员':'会员开户失败');const m=await r.json();state.members=[{id:m.id,code:m.code,name:m.name,phone:m.phone,level:'储值会员',balance:Number(m.balanceCents||0)/100},...state.members.filter(item=>item.id!==m.id)];if(settlementMemberTarget==='merge'){mergeSettlementMemberId=m.id;renderMergeMember();}else{state.selectedMemberId=m.id;renderMemberCard();}document.querySelector('#member-create-dialog').close();if(document.querySelector('#member-dialog').open)document.querySelector('#member-dialog').close();await loadMemberCenter();toast(m.reactivated?`归档会员已恢复，原会员卡号 ${m.code}`:'会员已开户');});
document.querySelector('#change-member').insertAdjacentHTML('beforebegin','<button class="text-button" id="recharge-member">充值</button>');
document.querySelector('#recharge-member').addEventListener('click',()=>{const member=state.members.find(item=>item.id===state.selectedMemberId);if(state.selectedMemberId)openMemberRecharge(state.selectedMemberId,member?.name||'会员');});
document.querySelector('#close-member-recharge').addEventListener('click',()=>document.querySelector('#member-recharge-dialog').close());
document.querySelector('#cancel-member-recharge').addEventListener('click',()=>document.querySelector('#member-recharge-dialog').close());
document.querySelector('#member-recharge-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const amount=Number(f.get('amount')),bonus=Number(f.get('bonus'));if(!Number.isFinite(amount)||amount<=0||!Number.isFinite(bonus)||bonus<0)return toast('请输入有效的充值和赠送金额');const r=await fetch(`http://localhost:8080/api/v1/members/${state.selectedMemberId}/recharges`,{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({amountCents:Math.round(amount*100),bonusCents:Math.round(bonus*100),paymentMethod:f.get('paymentMethod'),technicianId:f.get('technicianId')||null,employeeId:f.get('employeeId')||null})});if(!r.ok)return toast('充值失败，请检查收款方式和充值归属');const m=await r.json();state.members=state.members.map(x=>x.id===m.id?{...x,balance:m.balanceCents/100}:x);document.querySelector('#member-recharge-dialog').close();renderMemberCard();await loadMemberCenter();if(activeMemberProfile?.member.id===m.id&&document.querySelector('#member-profile-dialog').open)await openMemberProfile(m.id);toast('储值成功，技师和经办员工已保存');});
document.querySelector('#member-center-search').addEventListener('input',()=>{window.clearTimeout(memberCenterTimer);memberCenterTimer=window.setTimeout(loadMemberCenter,220);});
document.querySelector('#member-balance-filter').addEventListener('change',()=>renderMemberCenter(memberCenterRows,{replace:false}));
document.querySelector('#member-activity-filter').addEventListener('change',()=>renderMemberCenter(memberCenterRows,{replace:false}));
document.querySelector('#member-query-reset').addEventListener('click',()=>{document.querySelector('#member-center-search').value='';document.querySelector('#member-balance-filter').value='ALL';document.querySelector('#member-activity-filter').value='ALL';loadMemberCenter();});
document.querySelector('#member-center-records').addEventListener('click',event=>{const detail=event.target.closest('[data-member-profile]');if(detail)return openMemberProfile(detail.dataset.memberProfile);const recharge=event.target.closest('[data-member-recharge]');if(recharge){const member=memberCenterRows.find(item=>item.id===recharge.dataset.memberRecharge);return openMemberRecharge(recharge.dataset.memberRecharge,member?.name||'会员');}});
document.querySelector('#close-member-profile').addEventListener('click',()=>document.querySelector('#member-profile-dialog').close());
document.querySelector('#member-profile-recharge').addEventListener('click',()=>{if(!activeMemberProfile)return;document.querySelector('#member-profile-dialog').close();openMemberRecharge(activeMemberProfile.member.id,activeMemberProfile.member.name);});

let settlementMemberSearchTimer = null;
document.querySelector('#member-search').addEventListener('input', () => {
  window.clearTimeout(settlementMemberSearchTimer);
  settlementMemberSearchTimer = window.setTimeout(renderMemberResults, 220);
});
document.querySelector('#service-session-search').addEventListener('input', renderServiceSessions);
document.querySelector('#query-service-sessions').addEventListener('click',loadServiceSessions);
document.querySelector('#reset-service-sessions').addEventListener('click',()=>{document.querySelector('#service-session-from').value='';document.querySelector('#service-session-to').value='';document.querySelector('#service-session-search').value='';loadServiceSessions();});
document.querySelector('#query-commission-records').addEventListener('click',loadOrderCommissionRecords);
document.querySelector('#commission-record-search').addEventListener('input',()=>{renderOrderCommissionRecords();renderOrderCommissionAdjustments();});
let orderHistoryTimer=null;
document.querySelector('#order-search').addEventListener('input',()=>{window.clearTimeout(orderHistoryTimer);orderHistoryTimer=window.setTimeout(()=>loadSalesOrders({resetPage:true}),220);});
document.querySelector('#order-history-from').addEventListener('change',()=>loadSalesOrders({resetPage:true}));
document.querySelector('#order-history-to').addEventListener('change',()=>loadSalesOrders({resetPage:true}));
document.querySelector('#order-history-payment').addEventListener('change',()=>loadSalesOrders({resetPage:true}));
document.querySelector('#order-history-status').addEventListener('change',()=>loadSalesOrders({resetPage:true}));
document.querySelector('#reset-order-history').addEventListener('click',()=>{document.querySelector('#order-search').value='';document.querySelector('#order-history-from').value='';document.querySelector('#order-history-to').value='';document.querySelector('#order-history-payment').value='';document.querySelector('#order-history-status').value='';loadSalesOrders({resetPage:true});});
document.querySelector('#order-history-prev').addEventListener('click',()=>{if(orderHistoryPage===0)return;orderHistoryPage-=1;loadSalesOrders();});
document.querySelector('#order-history-next').addEventListener('click',()=>{if(salesOrders.length<orderHistoryPageSize)return;orderHistoryPage+=1;loadSalesOrders();});
document.querySelector('#wallet-ledger-search').addEventListener('input',()=>{window.clearTimeout(walletLedgerTimer);walletLedgerTimer=window.setTimeout(loadMemberWalletLedger,220);});
document.querySelector('#wallet-ledger-from').addEventListener('change',loadMemberWalletLedger);
document.querySelector('#wallet-ledger-to').addEventListener('change',loadMemberWalletLedger);
document.querySelector('#reset-wallet-ledger').addEventListener('click',()=>{document.querySelector('#wallet-ledger-search').value='';document.querySelector('#wallet-ledger-from').value='';document.querySelector('#wallet-ledger-to').value='';loadMemberWalletLedger();});
document.querySelector('#performance-from').addEventListener('change',loadTechnicianPerformance);
document.querySelector('#performance-to').addEventListener('change',loadTechnicianPerformance);
document.querySelector('#reset-performance').addEventListener('click',()=>{document.querySelector('#performance-from').value='';document.querySelector('#performance-to').value='';loadTechnicianPerformance();});
document.querySelector('#daily-report-date').addEventListener('change',()=>{loadDailyReport();loadStoreComparison();loadStoreAlerts();loadHeadquartersOverview();});
document.querySelector('#management-view').addEventListener('click',async event=>{const attention=event.target.closest('[data-management-attention]');if(attention){const type=attention.dataset.managementAttention;if(type==='CLEANING_ROOM')return document.querySelector('[data-view="rooms"]').click();if(type==='PENDING_REFUND'){managementActiveTab='orders';applyManagementTab();document.querySelector('.refund-management-panel')?.scrollIntoView({behavior:'smooth',block:'start'});return;}return document.querySelector('[data-view="frontdesk"]').click();}const button=event.target.closest('[data-headquarters-store]');if(!button)return;await switchToAlertStore(button.dataset.headquartersStore);document.querySelector('[data-view="frontdesk"]').click();});
document.querySelector('#store-comparison-sort').addEventListener('click',event=>{const button=event.target.closest('[data-store-comparison-sort]');if(!button)return;storeComparisonSort=button.dataset.storeComparisonSort;document.querySelectorAll('#store-comparison-sort button').forEach(item=>item.classList.toggle('selected',item===button));loadStoreComparison();});
document.querySelector('#store-alert-records').addEventListener('click',async event=>{const button=event.target.closest('[data-store-alert-store]');if(!button)return;await switchToAlertStore(button.dataset.storeAlertStore);const type=button.dataset.storeAlertType;if(type==='PENDING_REFUND'){refundManagementStatus='PENDING';managementActiveTab='orders';document.querySelectorAll('#refund-management-filters button').forEach(item=>item.classList.toggle('selected',item.dataset.refundStatus==='PENDING'));document.querySelector('[data-view="management"]').click();await loadRefundManagement();document.querySelector('.refund-management-panel').scrollIntoView({behavior:'smooth',block:'start'});return;}if(type==='CLEANING_ROOM'){document.querySelector('[data-view="rooms"]').click();return;}document.querySelector('[data-view="frontdesk"]').click();toast('已切换到对应门店，请在前台查看待结算服务');});
document.querySelector('#cross-store-transaction-search').addEventListener('input',()=>{window.clearTimeout(crossStoreTransactionTimer);crossStoreTransactionTimer=window.setTimeout(loadCrossStoreTransactions,260);});
document.querySelector('#cross-store-transaction-types').addEventListener('click',event=>{const button=event.target.closest('[data-cross-store-transaction-type]');if(!button)return;crossStoreTransactionType=button.dataset.crossStoreTransactionType;document.querySelectorAll('#cross-store-transaction-types button').forEach(item=>item.classList.toggle('selected',item===button));loadCrossStoreTransactions();});
document.querySelector('#cross-store-transaction-records').addEventListener('click',async event=>{const button=event.target.closest('[data-cross-store-transaction-store]');if(!button)return;await switchToAlertStore(button.dataset.crossStoreTransactionStore);managementActiveTab=button.dataset.crossStoreTransactionOrder?'orders':'members';document.querySelector('[data-view="management"]').click();if(button.dataset.crossStoreTransactionOrder){await openOrderDetail(button.dataset.crossStoreTransactionOrder);return;}document.querySelector('#wallet-ledger-search').value=button.dataset.crossStoreTransactionMember;await loadMemberWalletLedger();document.querySelector('.wallet-ledger-panel').scrollIntoView({behavior:'smooth',block:'start'});});
document.querySelector('#export-daily-report').addEventListener('click',async()=>{const date=document.querySelector('#daily-report-date').value;const response=await fetch(`http://localhost:8080/api/v1/operations/daily-report/export?date=${date}`);if(!response.ok)return toast('日报导出失败');const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=`daily-report-${date||'today'}.csv`;link.click();URL.revokeObjectURL(url);});
const managementHeaderActions=document.querySelectorAll('#management-view > .page-heading .page-actions button');
managementHeaderActions[0]?.addEventListener('click',()=>document.querySelector('#export-daily-report').click());
managementHeaderActions[1]?.addEventListener('click',()=>{const date=document.querySelector('#daily-report-date');date.value='';date.dispatchEvent(new Event('change'));});
document.querySelector('.revenue-panel .text-button')?.addEventListener('click',()=>document.querySelector('.daily-report-panel')?.scrollIntoView({behavior:'smooth',block:'start'}));
document.querySelector('.ranking-panel .text-button')?.addEventListener('click',()=>{managementActiveTab='commissions';applyManagementTab();document.querySelector('.technician-performance-panel')?.scrollIntoView({behavior:'smooth',block:'start'});});
const managementAlertActions=document.querySelectorAll('.alert-panel .text-button');
managementAlertActions[0]?.addEventListener('click',()=>document.querySelector('[data-view="rooms"]').click());
managementAlertActions[1]?.addEventListener('click',openCashierShiftDialog);
document.querySelector('#close-admin-login').addEventListener('click',()=>{if(!frontdeskLoginRequired)document.querySelector('#admin-login-dialog').close();});
document.querySelector('#admin-login-dialog').addEventListener('cancel',event=>{if(frontdeskLoginRequired)event.preventDefault();});
document.querySelector('#admin-login-form').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{const response=await fetch('/api/v1/admin/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({loginName:form.get('loginName'),password:form.get('password')})});if(!response.ok)return toast('管理账号或密码错误');const session=await response.json();localStorage.setItem(adminTokenKey,session.accessToken);localStorage.setItem(adminRolesKey,JSON.stringify(session.roles||[]));localStorage.setItem(adminPermissionsKey,JSON.stringify(session.permissions||[]));document.querySelector('#admin-login-dialog').close();try{await initializeAdminSession();}catch{clearAdminSession();return toast('账号会话初始化失败');}frontdeskLoginRequired=false;document.body.classList.remove('frontdesk-auth-locked');const preferredView=isTenantAdmin()?'management':'frontdesk';const target=document.querySelector(`[data-view="${preferredView}"]`);(target&&!target.hidden?target:[...document.querySelectorAll('.nav-item[data-view]')].find(button=>!button.hidden))?.click();toast(`已登录：${session.displayName}`);}catch{toast('登录服务连接失败，请检查接口服务是否已启动');}});
document.querySelector('#add-access-store').addEventListener('click',()=>openAccessStore());
document.querySelector('#add-access-store').insertAdjacentHTML('beforebegin','<button class="button primary" id="onboard-store" type="button">开通门店</button>');
document.body.insertAdjacentHTML('beforeend','<dialog id="store-onboarding-dialog"><form id="store-onboarding-form" class="dialog-card onboarding-dialog"><div class="dialog-heading"><div><p class="eyebrow">总部开店</p><h2>新门店开通</h2></div><button class="icon-button" type="button" id="close-store-onboarding" aria-label="关闭">×</button></div><div class="form-grid"><label>门店编码<input name="code" maxlength="40" required placeholder="例如 sh-pudong" /></label><label>门店名称<input name="name" maxlength="120" required /></label><label>联系电话<input name="contactPhone" maxlength="30" /></label><label>营业时间<input name="businessHours" maxlength="120" value="10:00-22:00" required /></label><label>营业日切换时间<input name="businessDayCutoff" type="time" value="05:00" required /></label><label class="form-full">门店地址<input name="address" maxlength="240" /></label><label class="form-full">项目模板<select name="serviceTemplateStoreId" id="onboarding-service-template" required></select></label><label>首个房号<input name="firstRoomNumber" type="number" min="1" max="999" value="201" required /></label><label>初始房间数<input name="roomCount" type="number" min="1" max="50" value="3" required /></label><label class="form-full">每间床位数<input name="bedsPerRoom" type="number" min="1" max="10" value="1" required /></label><label>门店经理账号<input name="managerLoginName" maxlength="80" required /></label><label>经理姓名<input name="managerDisplayName" maxlength="120" required /></label><label class="form-full">初始密码<input name="managerPassword" type="password" minlength="8" maxlength="128" required /></label></div><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-store-onboarding">取消</button><button class="button primary" type="submit">确认开通</button></div></form></dialog>');
async function openStoreOnboarding(){if(!accessStores.length)await loadAccessControl();const form=document.querySelector('#store-onboarding-form');form.reset();form.businessHours.value='10:00-22:00';form.businessDayCutoff.value='05:00';form.firstRoomNumber.value='201';form.roomCount.value='3';form.bedsPerRoom.value='1';document.querySelector('#onboarding-service-template').innerHTML=accessStores.filter(store=>store.active).map(store=>`<option value="${roomTransferEscape(store.id)}">${roomTransferEscape(store.code)} · ${roomTransferEscape(store.name)}</option>`).join('');document.querySelector('#store-onboarding-dialog').showModal();}
document.querySelector('#onboard-store').addEventListener('click',()=>openStoreOnboarding().catch(()=>toast('开通资料加载失败')));
document.querySelector('#close-store-onboarding').addEventListener('click',()=>document.querySelector('#store-onboarding-dialog').close());
document.querySelector('#cancel-store-onboarding').addEventListener('click',()=>document.querySelector('#store-onboarding-dialog').close());
document.querySelector('#store-onboarding-form').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const body={store:{code:form.get('code'),name:form.get('name'),timezone:'Asia/Shanghai',businessDayCutoff:form.get('businessDayCutoff'),address:form.get('address')||null,contactPhone:form.get('contactPhone')||null,businessHours:form.get('businessHours')},serviceTemplateStoreId:form.get('serviceTemplateStoreId'),manager:{loginName:form.get('managerLoginName'),displayName:form.get('managerDisplayName'),password:form.get('managerPassword')},firstRoomNumber:Number(form.get('firstRoomNumber')),roomCount:Number(form.get('roomCount')),bedsPerRoom:Number(form.get('bedsPerRoom'))};const response=await fetch('http://localhost:8080/api/v1/admin/access/stores/onboard',{method:'POST',headers:adminJsonHeaders(),body:JSON.stringify(body)});if(!response.ok)return toast(response.status===409?'门店编码或经理账号已存在':'门店开通失败，请检查填写内容');const result=await response.json();document.querySelector('#store-onboarding-dialog').close();await loadAccessControl();toast(`${result.store.name} 已开通：${result.serviceItemCount} 个项目、${result.roomCount} 间房、${result.bedCount} 个床位`);});
document.querySelector('#close-access-store').addEventListener('click',()=>document.querySelector('#access-store-dialog').close());
document.querySelector('#access-store-form').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const body=Object.fromEntries(form);const url=editingAccessStoreId?`http://localhost:8080/api/v1/admin/access/stores/${editingAccessStoreId}`:'http://localhost:8080/api/v1/admin/access/stores';const response=await fetch(url,{method:editingAccessStoreId?'PUT':'POST',headers:adminJsonHeaders(),body:JSON.stringify(body)});if(!response.ok)return toast('门店保存失败，请检查编码是否重复');document.querySelector('#access-store-dialog').close();await loadAccessControl();toast('门店资料已保存');});
document.querySelector('#access-store-records').addEventListener('click',async event=>{const edit=event.target.closest('[data-access-store-edit]');if(edit)return openAccessStore(accessStores.find(store=>store.id===edit.dataset.accessStoreEdit));const active=event.target.closest('[data-access-store-active]');if(!active)return;if(!window.confirm('确认删除该门店？门店历史订单、会员和报表会继续保留。'))return;const response=await fetch(`http://localhost:8080/api/v1/admin/access/stores/${active.dataset.accessStoreActive}/active`,{method:'PUT',headers:adminJsonHeaders(),body:JSON.stringify({active:false})});if(!response.ok)return toast('门店删除失败');await loadAccessControl();toast('门店已删除');});
document.querySelector('#add-access-user').addEventListener('click',()=>openAccessUser());
document.querySelector('#close-access-user').addEventListener('click',()=>document.querySelector('#access-user-dialog').close());
document.querySelector('#access-user-form').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const roleIds=selectedAccessIds('#access-user-roles');const storeIds=selectedAccessIds('#access-user-stores');if(!roleIds.length)return toast('请至少选择一个角色');const body={roleIds,storeIds};if(editingAccessUserId){const response=await fetch(`http://localhost:8080/api/v1/admin/access/users/${editingAccessUserId}/access`,{method:'PUT',headers:adminJsonHeaders(),body:JSON.stringify(body)});if(!response.ok)return toast('账号权限保存失败');}else{Object.assign(body,{loginName:form.get('loginName'),displayName:form.get('displayName'),password:form.get('password')});const response=await fetch('http://localhost:8080/api/v1/admin/access/users',{method:'POST',headers:adminJsonHeaders(),body:JSON.stringify(body)});if(!response.ok)return toast('账号创建失败，请检查登录账号是否重复');}document.querySelector('#access-user-dialog').close();await loadAccessControl();toast('账号权限已保存');});
document.querySelector('#access-user-records').addEventListener('click',async event=>{const edit=event.target.closest('[data-access-user-edit]');if(edit)return openAccessUser(accessUsers.find(user=>user.id===edit.dataset.accessUserEdit));const active=event.target.closest('[data-access-user-active]');if(!active)return;if(!window.confirm('确认删除该管理账号？该账号现有登录会话将失效。'))return;const response=await fetch(`http://localhost:8080/api/v1/admin/access/users/${active.dataset.accessUserActive}/active`,{method:'PUT',headers:adminJsonHeaders(),body:JSON.stringify({active:false})});if(!response.ok)return toast('账号删除失败');await loadAccessControl();toast('管理账号已删除');});
document.querySelector('#access-role-select').addEventListener('change',renderRolePermissions);
document.querySelector('#save-role-permissions').addEventListener('click',async()=>{const roleId=document.querySelector('#access-role-select').value;const permissionIds=selectedAccessIds('#access-permission-list');if(!permissionIds.length)return toast('角色至少保留一个权限');const response=await fetch(`http://localhost:8080/api/v1/admin/access/roles/${roleId}/permissions`,{method:'PUT',headers:adminJsonHeaders(),body:JSON.stringify({permissionIds})});if(!response.ok)return toast('角色权限保存失败');await loadAccessControl();document.querySelector('#access-role-select').value=roleId;renderRolePermissions();toast('角色权限已保存');});
document.querySelector('#backfill-access-store')?.addEventListener('change',()=>loadBackfillManagers().catch(()=>toast('历史补单授权加载失败')));
document.querySelector('#historical-backfill-filter-store')?.addEventListener('change',()=>loadHistoricalBackfillRows().catch(()=>toast('历史补单记录加载失败')));
document.querySelector('#historical-backfill-refresh')?.addEventListener('click',()=>loadHistoricalBackfillRows().catch(()=>toast('历史补单记录加载失败')));
document.querySelector('#historical-backfill-export')?.addEventListener('click',exportHistoricalBackfills);
document.querySelector('#backfill-manager-records')?.addEventListener('click',async event=>{const button=event.target.closest('[data-backfill-manager-toggle]');if(!button)return;const storeId=historicalBackfillStoreId();const active=button.dataset.active==='true';if(!storeId)return; if(!window.confirm(`${active?'确认授予':'确认撤销'}该店长的历史补单权限？`))return;const response=await fetch(`http://localhost:8080/api/v1/admin/access/stores/${storeId}/backfill-managers/${button.dataset.backfillManagerToggle}`,{method:'PUT',headers:adminJsonHeaders(),body:JSON.stringify({active})});if(!response.ok)return toast('历史补单授权更新失败');await loadBackfillManagers();toast(active?'历史补单权限已授予':'历史补单权限已撤销');});
document.querySelector('#open-historical-backfill')?.addEventListener('click',openHistoricalBackfill);
document.querySelector('#close-historical-backfill')?.addEventListener('click',()=>document.querySelector('#historical-backfill-dialog').close());
document.querySelector('#cancel-historical-backfill')?.addEventListener('click',()=>document.querySelector('#historical-backfill-dialog').close());
document.querySelector('#historical-backfill-form')?.addEventListener('submit',submitHistoricalBackfill);
document.querySelector('#historical-backfill-add-line')?.addEventListener('click',()=>{historicalBackfillLines.push(createHistoricalBackfillLine());renderHistoricalBackfillLines();});
document.querySelector('#historical-backfill-line-list')?.addEventListener('click',event=>{
  const remove=event.target.closest('[data-historical-remove-line]');
  if(!remove||historicalBackfillLines.length===1)return;
  historicalBackfillLines=historicalBackfillLines.filter(line=>String(line.id)!==String(remove.dataset.historicalRemoveLine));
  renderHistoricalBackfillLines();
});
document.querySelector('#historical-backfill-line-list')?.addEventListener('change',event=>{
  const container=event.target.closest('[data-historical-line]');
  const line=historicalBackfillLines.find(item=>String(item.id)===String(container?.dataset.historicalLine));
  if(!line)return;
  if(event.target.matches('[data-historical-service]')){
    line.serviceItemId=event.target.value;
    const service=state.services.find(item=>String(item.id)===String(line.serviceItemId));
    line.durationMinutes=Number(service?.durationMinutes||60);
    renderHistoricalBackfillLines();
    return;
  }
  if(event.target.matches('[data-historical-clock-type]'))line.clockType=event.target.value;
  if(event.target.matches('[data-historical-room]'))line.roomId=event.target.value;
  if(event.target.matches('[data-historical-technician]')){
    const technicianId=event.target.dataset.historicalTechnician;
    if(event.target.checked&&line.technicians.length>=4){event.target.checked=false;return toast('一个项目最多选择 4 位技师');}
    if(event.target.checked&&!line.technicians.some(item=>String(item.technicianId)===String(technicianId)))line.technicians.push({technicianId,allocationBp:0});
    if(!event.target.checked)line.technicians=line.technicians.filter(item=>String(item.technicianId)!==String(technicianId));
    rebalanceHistoricalBackfillTechnicians(line);
    renderHistoricalBackfillLines();
  }
});
document.querySelector('#historical-backfill-line-list')?.addEventListener('input',event=>{
  const container=event.target.closest('[data-historical-line]');
  const line=historicalBackfillLines.find(item=>String(item.id)===String(container?.dataset.historicalLine));
  if(!line)return;
  if(event.target.matches('[data-historical-duration]'))line.durationMinutes=Number(event.target.value);
  if(event.target.matches('[data-historical-allocation]')){
    const allocation=line.technicians.find(item=>String(item.technicianId)===String(event.target.dataset.historicalAllocation));
    if(allocation)allocation.allocationBp=Math.round(Number(event.target.value||0)*100);
  }
});
document.querySelector('#historical-backfill-add-payment')?.addEventListener('click',()=>{
  const method=historicalBackfillPaymentMethods.find(item=>!historicalBackfillPayments.some(payment=>payment.method===item.code));
  if(!method)return toast('所有可用支付方式均已添加');
  historicalBackfillPayments.push({id:++historicalBackfillSequence,method:method.code,amountCents:0});
  renderHistoricalBackfillPayments();
});
document.querySelector('#historical-backfill-payment-list')?.addEventListener('click',event=>{
  const remove=event.target.closest('[data-historical-remove-payment]');
  if(!remove||historicalBackfillPayments.length===1)return;
  historicalBackfillPayments=historicalBackfillPayments.filter(payment=>String(payment.id)!==String(remove.dataset.historicalRemovePayment));
  if(historicalBackfillPayments.length===1)historicalBackfillPayments[0].amountCents=Math.round(Number(document.querySelector('#historical-backfill-amount').value||0)*100);
  renderHistoricalBackfillPayments();
});
document.querySelector('#historical-backfill-payment-list')?.addEventListener('change',event=>{
  const container=event.target.closest('[data-historical-payment]');
  const payment=historicalBackfillPayments.find(item=>String(item.id)===String(container?.dataset.historicalPayment));
  if(payment&&event.target.matches('[data-historical-payment-method]'))payment.method=event.target.value;
});
document.querySelector('#historical-backfill-payment-list')?.addEventListener('input',event=>{
  const container=event.target.closest('[data-historical-payment]');
  const payment=historicalBackfillPayments.find(item=>String(item.id)===String(container?.dataset.historicalPayment));
  if(!payment||!event.target.matches('[data-historical-payment-amount]'))return;
  payment.amountCents=Math.round(Number(event.target.value||0)*100);
  renderHistoricalBackfillSummary(false);
});
document.querySelector('#historical-backfill-amount')?.addEventListener('input',event=>{
  if(historicalBackfillPayments.length===1){
    historicalBackfillPayments[0].amountCents=Math.round(Number(event.target.value||0)*100);
    const paymentAmount=document.querySelector('[data-historical-payment-amount]');
    if(paymentAmount)paymentAmount.value=(historicalBackfillPayments[0].amountCents/100).toFixed(2);
  }
  renderHistoricalBackfillSummary(false);
});
document.querySelector('#historical-backfill-member-search')?.addEventListener('input',()=>{
  window.clearTimeout(historicalBackfillMemberSearchTimer);
  historicalBackfillMemberSearchTimer=window.setTimeout(searchHistoricalBackfillMembers,260);
});
document.querySelector('#historical-backfill-member-clear')?.addEventListener('click',()=>{
  historicalBackfillMember=null;
  document.querySelector('#historical-backfill-member-search').value='';
  document.querySelector('#historical-backfill-member-results').innerHTML='';
  renderHistoricalBackfillMember();
});
document.querySelector('#frontdesk-historical-backfill-filter-date')?.addEventListener('change',renderFrontdeskHistoricalBackfills);
document.querySelector('#frontdesk-historical-backfill-filter-operator')?.addEventListener('input',renderFrontdeskHistoricalBackfills);
document.querySelector('#refresh-historical-backfills')?.addEventListener('click',loadFrontdeskHistoricalBackfills);
document.querySelector('#frontdesk-historical-backfill-records')?.addEventListener('click',event=>{
  const button=event.target.closest('[data-historical-order-detail]');
  if(button)openOrderDetail(button.dataset.historicalOrderDetail).catch(()=>toast('订单详情加载失败'));
});
document.querySelector('#refund-management-filters').addEventListener('click',event=>{const button=event.target.closest('[data-refund-status]');if(!button)return;refundManagementStatus=button.dataset.refundStatus;document.querySelectorAll('#refund-management-filters button').forEach(item=>item.classList.toggle('selected',item===button));loadRefundManagement();});
document.querySelector('#refund-management-records').addEventListener('click',async event=>{const detail=event.target.closest('[data-order-detail]');if(detail)return openOrderDetail(detail.dataset.orderDetail);const confirm=event.target.closest('[data-dashboard-confirm]');if(confirm){const response=await fetch(`http://localhost:8080/api/v1/refunds/${confirm.dataset.dashboardConfirm}/payments/${confirm.dataset.dashboardPayment}/complete`,{method:'POST',headers:storeContextHeaders(true)});if(!response.ok)return toast('退款确认失败，请稍后重试');await loadRefundManagement();await loadSalesOrders();toast('退款已确认完成');return;}const cancel=event.target.closest('[data-dashboard-cancel]');if(cancel){if(!window.confirm('确认取消这笔待确认退款？'))return;const response=await fetch(`http://localhost:8080/api/v1/refunds/${cancel.dataset.dashboardCancel}/cancel`,{method:'POST',headers:storeContextHeaders(true)});if(!response.ok)return toast('该退款已有完成付款，无法取消');await loadRefundManagement();await loadSalesOrders();toast('退款已取消');}});
document.querySelector('#order-records').addEventListener('click',async event=>{const voidButton=event.target.closest('[data-order-void]');if(voidButton){openOrderVoid(voidButton.dataset.orderVoid);return;}const button=event.target.closest('[data-order-detail]');if(!button)return;await openOrderDetail(button.dataset.orderDetail);});
document.querySelector('#close-order-detail').addEventListener('click',()=>document.querySelector('#order-detail-dialog').close());
document.querySelector('#order-detail-content').addEventListener('click',async event=>{const financial=event.target.closest('[data-order-financial-correct]');if(financial){await openFinancialCorrection(financial.dataset.orderFinancialCorrect);return;}const correction=event.target.closest('[data-order-correct]');if(correction){await openOrderCorrection(correction.dataset.orderCorrect);return;}const voidButton=event.target.closest('[data-order-void]');if(voidButton){openOrderVoid(voidButton.dataset.orderVoid);return;}const open=event.target.closest('[data-refund-kind]');if(open)return openRefundDialog(open.dataset.refundKind);const confirm=event.target.closest('[data-confirm-refund]');if(confirm){const response=await fetch(`http://localhost:8080/api/v1/refunds/${confirm.dataset.confirmRefund}/payments/${confirm.dataset.refundPayment}/complete`,{method:'POST',headers:storeContextHeaders(true)});if(!response.ok)return toast('退款确认失败，请稍后重试');await openOrderDetail(activeOrderDetail.detail.order.id);await loadSalesOrders();toast('退款已确认完成');return;}const cancel=event.target.closest('[data-cancel-refund]');if(cancel){if(!window.confirm('确认取消这笔待确认退款或红冲？'))return;const response=await fetch(`http://localhost:8080/api/v1/refunds/${cancel.dataset.cancelRefund}/cancel`,{method:'POST',headers:storeContextHeaders(true)});if(!response.ok)return toast('该申请已有完成付款，无法取消');await openOrderDetail(activeOrderDetail.detail.order.id);await loadSalesOrders();toast('申请已取消');}});
document.querySelector('#order-detail-content').addEventListener('click', event => { if (event.target.closest('#print-order-receipt') && activeOrderDetail) printOrder(activeOrderDetail.detail).catch(() => toast('打印失败，请检查本机打印服务')); });
document.querySelector('#order-detail-content').addEventListener('click', event => { const history=event.target.closest('[data-order-service-history]'); if(history)openServiceChangeHistory(history.dataset.orderServiceHistory); });
document.querySelector('#refund-draft-lines').addEventListener('input',updateRefundPreview);
document.querySelector('#close-refund-dialog').addEventListener('click',()=>document.querySelector('#refund-dialog').close());
document.querySelector('#cancel-refund').addEventListener('click',()=>document.querySelector('#refund-dialog').close());
document.querySelector('#refund-form').addEventListener('submit',async event=>{event.preventDefault();if(!activeRefundContext)return;const selected=[...document.querySelectorAll('[data-refund-amount]')].filter(input=>input.closest('.refund-line-choice').querySelector('input[type="checkbox"]').checked);const lines=selected.map(input=>({orderLineId:input.dataset.orderLine,quantity:1,refundCents:yuanToCents(input.value)})).filter(line=>line.refundCents>0);const total=lines.reduce((sum,line)=>sum+line.refundCents,0);const expectedTotal=activeRefundContext.capacity.payments.reduce((sum,payment)=>sum+Number(payment.remainingCents||0),0);if(!lines.length||total!==expectedTotal)return toast('整单退款必须覆盖全部剩余可退金额');let left=total;const payments=[];for(const payment of activeRefundContext.capacity.payments){if(left<=0)break;const amount=Math.min(left,payment.remainingCents);if(amount>0)payments.push({originalPaymentId:payment.id,paymentMethod:payment.paymentMethod,amountCents:amount});left-=amount;}if(left>0)return toast('原支付记录可退金额不足');const reason=String(new FormData(event.currentTarget).get('reason')||'').trim();if(!reason)return toast('请填写操作原因');if(!window.confirm('确认整单退款？完成后将从营业额和技师业绩中冲减整单数据。'))return;const submit=document.querySelector('#submit-refund');submit.disabled=true;const response=await fetch(`http://localhost:8080/api/v1/sales-orders/${activeRefundContext.detail.order.id}/refunds`,{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({requestKey:crypto.randomUUID(),refundKind:'FULL_REVERSAL',reason,lines,payments})});submit.disabled=false;if(!response.ok){const message=await response.text();return toast(`提交失败：${message||'金额或订单状态已变化'}`);}const refund=await response.json();document.querySelector('#refund-dialog').close();await openOrderDetail(activeRefundContext.detail.order.id);await Promise.all([loadSalesOrders(),loadRefundManagement(),loadTechnicianPerformance(),loadDailyReport()]);toast(refund.status==='PENDING'?'整单退款已提交，状态：待确认退款':'整单退款已完成');});
document.querySelector('#service-session-filters').addEventListener('click', event => { const button = event.target.closest('[data-session-status]'); if (!button) return; serviceSessionFilter = button.dataset.sessionStatus; document.querySelectorAll('#service-session-filters button').forEach(item => item.classList.toggle('selected', item === button)); renderServiceSessions(); });
document.querySelector('#service-session-records').addEventListener('click', event => {
  const duration = event.target.closest('[data-duration-session]');
  if (duration) { overrideServiceDuration(duration.dataset.durationSession); return; }
  const history = event.target.closest('[data-change-history-session]');
  if (history) openServiceChangeHistory(history.dataset.changeHistorySession);
});
document.querySelector('#member-results').addEventListener('click', event => { const button = event.target.closest('[data-member]'); if (!button) return; if(settlementMemberTarget==='merge'){mergeSettlementMemberId=button.dataset.member;renderMergeMember();}else{state.selectedMemberId=button.dataset.member;renderMemberCard();renderSettlementPaymentMethods();}document.querySelector('#member-dialog').close();toast('订单会员已更新'); });
document.querySelector('#refresh-state').addEventListener('click', () => syncOperationalState({ manual: true }));
document.querySelector('#sort-techs').addEventListener('click', () => loadFoundationData({ silent:true }).then(() => toast('已按当日轮钟队列刷新')).catch(() => toast('轮钟队列刷新失败')));
document.querySelector('#close-clock-out-confirm').addEventListener('click', () => { clockOutConfirmation = null; document.querySelector('#clock-out-confirm-dialog').close(); });
document.querySelector('#cancel-clock-out-confirm').addEventListener('click', () => { clockOutConfirmation = null; document.querySelector('#clock-out-confirm-dialog').close(); });
document.querySelector('#clock-out-confirm-form').addEventListener('submit', submitClockOutConfirmation);
document.querySelector('#technician-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-tech]'); if (!button) return;
  const tech = state.technicians.find(item => String(item.id) === String(button.dataset.tech));
  if (tech.state === 'available') { openClockDialog(tech); return; }
  if (tech.state === 'pending' || tech.state === 'accepted') {
    const session = activeSessionForTechnician(tech.id);
    if (!session) { toast('未找到待开始的服务记录，请刷新后重试'); return; }
    await startServiceFromFrontdesk(session.id);
    return;
  }
  if (tech.state === 'off') { toast(`${tech.name} ${tech.detail || '当前不可上钟'}`); return; }
  else if (tech.state === 'serving') {
    const session = state.activeSessions.find(item => sessionParticipantIds(item).some(id => String(id) === String(tech.id)));
    openClockOutConfirmation(session, tech);
    return;
  }
  else { tech.state = 'available'; tech.detail = '刚刚上班'; toast(`${tech.name} 已上班`); }
  renderTechnicians();
});
document.querySelector('#technician-list').addEventListener('contextmenu', event => {
  const card = event.target.closest('[data-tech-card]');
  if (!card) return;
  const technician = state.technicians.find(item => String(item.id) === String(card.dataset.techCard));
  if (technician) openTechnicianContextMenu(event, technician);
});
document.querySelector('#dispatch-tech-list').addEventListener('click', event => {
  const button = event.target.closest('[data-dispatch-tech]'); if (!button) return;
  const id = button.dataset.dispatchTech;
  const tech = state.technicians.find(item => String(item.id) === String(id));
  const reservation = ['BOOKED_QUEUE','BOOKED_CALL'].includes(document.querySelector('#clock-type').value);
  if (!reservation && tech?.state !== 'available') { toast('进行中派单只能选择空闲技师；忙碌技师可用于预定排钟或预定点钟'); return; }
  const selectedIndex = clockingTechIds.findIndex(item => String(item) === String(id));
  if (selectedIndex >= 0) {
    clockingTechIds.splice(selectedIndex, 1);
    dispatchSelections.delete(String(id));
  }
  else {
    if (reservation && clockingTechIds.length) clockingTechIds = [id];
    else if (clockingTechIds.length >= 4) { toast('一单最多安排 4 位技师'); return; }
    else clockingTechIds.push(id);
    dispatchFocusTechId = id;
  }
  renderDispatchSelection();
});
document.querySelector('#dispatch-service-list').addEventListener('click', event => {
  const button = event.target.closest('[data-dispatch-service]'); if (!button) return;
  if (!dispatchFocusTechId) { toast('请先选择要配置的技师'); return; }
  const service = state.services.find(item => String(item.id) === String(button.dataset.dispatchService));
  if (!service) return;
  const selection = dispatchSelections.get(String(dispatchFocusTechId));
  if (!selection) return;
  selection.serviceItemId = service.id;
  selection.durationMinutes = Number(service.durationMinutes || Number.parseInt(service.duration, 10));
  document.querySelector('#clock-service').value = service.id;
  document.querySelector('#clock-duration').value = selection.durationMinutes;
  renderDispatchSelection();
});
document.querySelector('#dispatch-allocation-list').addEventListener('focusin', event => {
  const participant = event.target.closest('[data-dispatch-participant]');
  if (!participant) return;
  dispatchFocusTechId = participant.dataset.dispatchParticipant;
  renderDispatchServiceCatalog();
  document.querySelectorAll('[data-dispatch-participant]').forEach(item => item.classList.toggle('focused', item === participant));
  document.querySelectorAll('[data-dispatch-tech]').forEach(item => item.classList.toggle('focused', String(item.dataset.dispatchTech) === String(dispatchFocusTechId)));
});
document.querySelector('#dispatch-allocation-list').addEventListener('change', event => {
  const technicianId = event.target.dataset.techService || event.target.dataset.techClockType || event.target.dataset.techDuration;
  if (!technicianId) return;
  const selection = dispatchSelections.get(String(technicianId));
  if (!selection) return;
  dispatchFocusTechId = technicianId;
  if (event.target.dataset.techService) {
    selection.serviceItemId = event.target.value;
    const service = state.services.find(item => String(item.id) === String(event.target.value));
    if (service) selection.durationMinutes = Number(service.durationMinutes || Number.parseInt(service.duration, 10));
  }
  if (event.target.dataset.techClockType) {
    if (['BOOKED_QUEUE','BOOKED_CALL'].includes(event.target.value) && clockingTechIds.length > 1) {
      toast('预定排钟和预定点钟每单只能选择一位技师');
      renderDispatchSelection();
      return;
    }
    selection.clockType = event.target.value;
  }
  if (event.target.dataset.techDuration) selection.durationMinutes = Number(event.target.value);
  renderDispatchSelection();
});
document.querySelector('#dispatch-service-categories').addEventListener('click', event => {
  const button = event.target.closest('[data-dispatch-category]');
  if (!button) return;
  dispatchServiceCategoryId = button.dataset.dispatchCategory;
  renderDispatchServiceCatalog();
  renderDispatchSelection();
});
document.querySelector('#dispatch-service-search').addEventListener('input', event => {
  dispatchServiceSearch = event.target.value;
  renderDispatchServiceCatalog();
  renderDispatchSelection();
});
document.querySelector('#close-clock-dialog').addEventListener('click', () => document.querySelector('#clock-dialog').close());
document.querySelector('#cancel-clock').addEventListener('click', () => document.querySelector('#clock-dialog').close());
document.querySelector('#clock-room').closest('label').insertAdjacentHTML('beforebegin', '<label>上钟类别<select id="clock-type" name="clockType"><option value="QUEUE">排钟</option><option value="CALL">点钟</option><option value="SELECTED">选钟</option><option value="BOOKED_QUEUE">预定排钟</option><option value="BOOKED_CALL">预定点钟</option></select><small>由前台按本次服务选择</small></label>');
document.querySelector('#clock-type').addEventListener('change', event => {
  const reservation = ['BOOKED_QUEUE','BOOKED_CALL'].includes(event.target.value);
  if (reservation && clockingTechIds.length > 1) { clockingTechIds = [clockingTechIds[0]]; toast('预约服务保持单技师，已保留第一位技师'); }
  if (!reservation) {
    const busy = clockingTechIds.filter(id => state.technicians.find(tech => String(tech.id) === String(id))?.state !== 'available');
    if (busy.length) { clockingTechIds = clockingTechIds.filter(id => !busy.some(item => String(item) === String(id))); toast('已移除正在服务或待接单的技师'); }
  }
  const focusSelection = dispatchSelections.get(String(dispatchFocusTechId));
  if (focusSelection) focusSelection.clockType = event.target.value;
  renderDispatchSelection();
});
document.querySelector('#clock-duration').addEventListener('change', event => {
  const selection = dispatchSelections.get(String(dispatchFocusTechId));
  if (selection) selection.durationMinutes = Number(event.target.value);
  renderDispatchSelection();
});
document.querySelector('#clock-form').addEventListener('submit', async event => {
  event.preventDefault();
  const selectedTechs = clockingTechIds.map(id => state.technicians.find(item => String(item.id) === String(id))).filter(Boolean);
  const roomId = document.querySelector('#clock-room').value;
  if (!selectedTechs.length) { toast('请至少选择一位技师'); return; }
  const participants = selectedDispatchParticipants();
  const invalidParticipant = participants.find(item => !state.services.some(service => String(service.id) === String(item.serviceItemId)) || !Number.isFinite(item.plannedDurationMinutes) || item.plannedDurationMinutes < 15 || item.plannedDurationMinutes > 360);
  if (!roomId || invalidParticipant) { toast('请检查每位技师的项目和服务时长'); return; }
  const primary = participants[0];
  const service = state.services.find(item => String(item.id) === String(primary.serviceItemId));
  const clockType = primary.clockType;
  const duration = primary.plannedDurationMinutes;
  const reservation = participants.some(item => ['BOOKED_QUEUE','BOOKED_CALL'].includes(item.clockType));
  if (reservation && selectedTechs.length !== 1) { toast('预定排钟和预定点钟每单只能选择一位技师'); return; }
  const batch = selectedTechs.length > 1;
  const endpoint = reservation ? 'http://localhost:8080/api/v1/service-reservations' : batch ? 'http://localhost:8080/api/v1/service-sessions/clock-in-batch' : 'http://localhost:8080/api/v1/service-sessions/clock-in';
  const payload = reservation
    ? { technicianId: selectedTechs[0].id, roomId, serviceItemId: service.id, plannedDurationMinutes: duration, reservationType: clockType, note: null }
    : batch
      ? { roomId, participants }
      : { technicianId: selectedTechs[0].id, roomId, serviceItemId: service.id, plannedDurationMinutes: duration, clockType };
  const response = await fetch(endpoint, { method: 'POST', headers: storeContextHeaders(true), body: JSON.stringify(payload) });
  if (!response.ok) { const detail = (await response.text()).replace(/^"|"$/g, ''); toast(reservation ? `预约登记失败：${detail || '请刷新后重试'}` : `上钟失败：${detail || '技师或房间可能已被占用'}`); return; }
  document.querySelector('#clock-dialog').close();
  await Promise.all([loadFoundationData(), loadReservations()]);
  const technicianNames = selectedTechs.map(tech => tech.name).join('、');
  toast(reservation ? `${technicianNames} 已登记${clockTypeLabels[clockType]}：${service.name}，房间已预留` : batch ? `${selectedTechs.length} 位技师已按独立项目安排，等待接单` : `${technicianNames} 已安排：${service.name} ${duration} 分钟，等待技师接单`);
});
document.querySelector('#add-technician').addEventListener('click', () => openTechnicianDialog());
document.querySelector('#add-technician').insertAdjacentHTML('beforebegin', '<button class="button secondary" id="manage-tech-accounts">账号管理</button>');
document.querySelector('#employee-tabs').addEventListener('click', event => { const button = event.target.closest('[data-employee-tab]'); if (button) switchEmployeeManagementTab(button.dataset.employeeTab); });
document.querySelector('#refresh-attendance').addEventListener('click', () => loadEmployeeAttendance().then(() => toast('考勤已刷新')).catch(() => toast('考勤加载失败')));
document.querySelector('#attendance-date').addEventListener('change', () => loadEmployeeAttendance().catch(() => toast('考勤加载失败')));
document.querySelector('#employee-attendance-records').addEventListener('click', async event => {
  const clockIn = event.target.closest('[data-attendance-clock-in]');
  const clockOut = event.target.closest('[data-attendance-clock-out]');
  const employeeId = clockIn?.dataset.attendanceClockIn || clockOut?.dataset.attendanceClockOut;
  if (!employeeId) return;
  const endpoint = clockIn ? 'clock-in' : 'clock-out';
  const response = await fetch(`http://localhost:8080/api/v1/employee-attendance/${endpoint}`, { method:'POST', headers:storeContextHeaders(true), body:JSON.stringify({ employeeId }) });
  if (!response.ok) { const detail=(await response.text()).replace(/^"|"$/g,''); return toast(`${clockIn ? '上班' : '下班'}打卡失败：${detail || '状态已变化'}`); }
  await loadEmployeeAttendance();
  toast(clockIn ? '上班打卡成功' : '下班打卡成功');
});
document.querySelector('#add-employee').addEventListener('click', () => openEmployeeDialog().catch(() => toast('账号选项加载失败')));
document.querySelector('#show-inactive-employees').addEventListener('click', async event => { includeInactiveEmployees = !includeInactiveEmployees; event.currentTarget.textContent = includeInactiveEmployees ? '仅显示在职员工' : '显示离职员工'; await loadManagedEmployees(); });
document.querySelector('#employee-search').addEventListener('input', renderManagedEmployees);
document.querySelector('#employee-records').addEventListener('click', async event => {
  const edit = event.target.closest('[data-employee-edit]');
  if (edit) return openEmployeeDialog(managedEmployees.find(item => String(item.employeeId) === edit.dataset.employeeEdit)).catch(() => toast('账号选项加载失败'));
  const profile = event.target.closest('[data-employee-create-technician]');
  if (profile) return openEmployeeTechnicianProfile(managedEmployees.find(item => String(item.employeeId) === profile.dataset.employeeCreateTechnician));
  const leave = event.target.closest('[data-employee-leave]');
  if (!leave || !window.confirm('确认登记该员工离职？历史订单、服务与审计记录会继续保留。')) return;
  const response = await fetch(`http://localhost:8080/api/v1/employees/assignments/${leave.dataset.employeeLeave}/employment-status`, { method:'PUT', headers:storeContextHeaders(true), body:JSON.stringify({ employmentStatus:'LEFT' }) });
  if (!response.ok) return toast('登记离职失败');
  await loadManagedEmployees(); toast('员工已登记离职');
});
document.querySelector('#employee-account-records').addEventListener('click', event => { const button = event.target.closest('[data-employee-account]'); if (button) openEmployeeDialog(managedEmployees.find(item => String(item.employeeId) === button.dataset.employeeAccount)).catch(() => toast('账号选项加载失败')); });
document.querySelector('#open-tech-accounts').addEventListener('click', () => document.querySelector('#manage-tech-accounts').click());
document.querySelector('#close-employee-dialog').addEventListener('click', () => document.querySelector('#employee-dialog').close());
document.querySelector('#cancel-employee').addEventListener('click', () => document.querySelector('#employee-dialog').close());
let technicianProfileEmployee = null;
async function openEmployeeTechnicianProfile(employee) {
  technicianProfileEmployee = employee;
  await loadManagedTechnicians();
  const form = document.querySelector('#employee-technician-profile-form');
  form.reset(); form.code.value = employee.employeeNo || '';
  form.queueOrder.value = managedTechnicians.length + 1;
  document.querySelector('#employee-technician-profile-subject').textContent = `${employee.fullName} · ${employee.positionName}`;
  document.querySelector('#employee-technician-profile-dialog').showModal();
}
document.querySelector('#close-employee-technician-profile').addEventListener('click', () => document.querySelector('#employee-technician-profile-dialog').close());
document.querySelector('#cancel-employee-technician-profile').addEventListener('click', () => document.querySelector('#employee-technician-profile-dialog').close());
document.querySelector('#employee-technician-profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const response = await fetch(`http://localhost:8080/api/v1/employees/${technicianProfileEmployee.employeeId}/technician-profile`, { method:'POST', headers:storeContextHeaders(true), body:JSON.stringify({ code:form.get('code'), queueOrder:Number(form.get('queueOrder')) }) });
  if (!response.ok) return toast('创建技师档案失败，请检查技师编号是否重复');
  document.querySelector('#employee-technician-profile-dialog').close();
  await Promise.all([loadManagedEmployees(), loadManagedTechnicians(), loadFoundationData()]);
  toast('技师档案已创建，可进入技师档案维护轮钟和手机端账号');
});
document.querySelector('#employee-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = employeeFormValues(new FormData(event.currentTarget));
  let response;
  if (!editingEmployee) {
    response = await fetch('http://localhost:8080/api/v1/employees', { method:'POST', headers:storeContextHeaders(true), body:JSON.stringify(values) });
  } else {
    response = await fetch(`http://localhost:8080/api/v1/employees/${editingEmployee.employeeId}`, { method:'PUT', headers:storeContextHeaders(true), body:JSON.stringify({ fullName:values.fullName, phone:values.phone, note:values.note }) });
    if (response.ok) response = await fetch(`http://localhost:8080/api/v1/employees/assignments/${editingEmployee.assignmentId}`, { method:'PUT', headers:storeContextHeaders(true), body:JSON.stringify({ employeeNo:values.employeeNo, positionType:values.positionType, positionName:values.positionName, hiredOn:values.hiredOn, note:values.note }) });
    if (response.ok && String(values.userId || '') !== String(editingEmployee.userId || '')) response = await fetch(`http://localhost:8080/api/v1/employees/${editingEmployee.employeeId}/account`, { method:'PUT', headers:storeContextHeaders(true), body:JSON.stringify({ userId:values.userId }) });
  }
  if (!response.ok) return toast('保存员工失败，请检查必填信息、员工号或账号关联');
  document.querySelector('#employee-dialog').close(); await loadManagedEmployees(); toast('员工资料已保存');
});
document.body.insertAdjacentHTML('beforeend', '<dialog id="tech-accounts-dialog"><div class="dialog-card technician-accounts-card"><div class="dialog-heading"><div><p class="eyebrow">技师账号</p><h2>账号与绑定</h2></div><button class="icon-button" type="button" id="close-tech-accounts">×</button></div><form id="tech-account-form" class="form-grid"><label>技师<select name="technicianId" id="account-tech" required></select></label><label>登录账号<input name="loginName" required /></label><label class="form-full">初始密码<input name="password" type="password" minlength="8" required /></label><div class="form-full dialog-actions"><button class="button primary" type="submit">创建账号</button></div></form><p class="account-security-note">登录密码经加密保存，控制端无法查看历史密码；需要时可为指定账号重置新密码。</p><div id="tech-account-records"></div></div></dialog>');
document.body.insertAdjacentHTML('beforeend', '<dialog id="reset-account-dialog"><form id="reset-account-form" class="dialog-card compact reset-account-card"><div class="dialog-heading"><div><p class="eyebrow">账号安全</p><h2>重置密码</h2></div><button class="icon-button" type="button" id="close-reset-account">×</button></div><div class="reset-account-subject"><b id="reset-account-technician">—</b><small id="reset-account-login">登录账号：—</small></div><p class="account-security-note">原密码已加密保存，无法查看。重置后，当前账号的已登录会话将失效。</p><label class="form-full">新密码<input id="reset-account-password" name="password" type="password" minlength="8" required /></label><label class="show-password-option"><input id="show-reset-password" type="checkbox" /> 显示本次输入的新密码</label><div class="dialog-actions"><button class="button primary" type="submit">确认重置</button></div><div class="reset-password-result hidden" id="reset-password-result"><span>本次新密码</span><b id="reset-password-value"></b><small>请立即记录并妥善交给技师；关闭窗口后不会再显示。</small><button class="button secondary" id="finish-reset-account" type="button">完成</button></div></form></dialog>');
let technicianAccounts = [];
async function loadTechnicianAccounts() { const response = await fetch('http://localhost:8080/api/v1/admin/technician-accounts',{headers:storeContextHeaders()}); if (!response.ok) throw new Error(); technicianAccounts = await response.json(); document.querySelector('#account-tech').innerHTML = technicianAccounts.filter(item => !item.bindingId).map(item => `<option value="${roomTransferEscape(item.technicianId)}">${roomTransferEscape(item.technicianCode)} · ${roomTransferEscape(item.technicianName)}</option>`).join('') || '<option value="">所有启用技师均已绑定</option>'; document.querySelector('#tech-account-records').innerHTML = technicianAccounts.map(item => `<article class="technician-account-row"><div class="technician-account-identity"><b>${roomTransferEscape(item.technicianName)}</b><small>技师编号：${roomTransferEscape(item.technicianCode)}</small><small>登录账号：${roomTransferEscape(item.loginName || '未创建账号')}</small></div><div class="technician-account-status"><em class="record-type ${item.bindingId && item.active ? 'order' : 'consumption'}">${item.bindingId ? (item.active ? '已启用' : '已停用') : '未绑定'}</em><small>密码：${item.bindingId ? '已加密保存，不可查看' : '—'}</small></div><div class="technician-account-actions">${item.bindingId && item.active ? `<button class="record-delete edit-technician" type="button" data-account-reset="${roomTransferEscape(item.bindingId)}">重置密码</button><button class="record-delete" type="button" data-account-toggle="${roomTransferEscape(item.bindingId)}" data-active="true">停用</button>` : item.bindingId ? `<button class="record-delete edit-technician" type="button" data-account-toggle="${roomTransferEscape(item.bindingId)}" data-active="false">重新启用</button>` : '<small>请先创建登录账号</small>'}</div></article>`).join('') || '<p class="empty-state">暂无技师账号记录</p>'; }
document.querySelector('#manage-tech-accounts').addEventListener('click', async () => { await loadTechnicianAccounts(); document.querySelector('#tech-accounts-dialog').showModal(); });
document.querySelector('#close-tech-accounts').addEventListener('click', () => document.querySelector('#tech-accounts-dialog').close());
document.querySelector('#tech-account-form').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const response = await fetch('http://localhost:8080/api/v1/admin/technician-accounts', { method:'POST', headers:storeContextHeaders(true), body:JSON.stringify({ technicianId:form.get('technicianId'), loginName:form.get('loginName'), password:form.get('password') }) }); if (!response.ok) return toast('创建账号失败，请检查账号是否重复'); event.currentTarget.reset(); await loadTechnicianAccounts(); toast('技师账号已创建'); });
document.querySelector('#tech-account-records').addEventListener('click', async event => { const button = event.target.closest('[data-account-toggle]'); if (!button) return; const active = button.dataset.active === 'false'; if (!active && !window.confirm('确认停用该技师账号？当前登录会话将立即失效。')) return; const response = await fetch(`http://localhost:8080/api/v1/admin/technician-accounts/${button.dataset.accountToggle}/active`, { method:'PUT', headers:storeContextHeaders(true), body:JSON.stringify({active}) }); if (!response.ok) return toast(active ? '账号重新启用失败' : '账号停用失败'); await loadTechnicianAccounts(); toast(active ? '技师账号已重新启用' : '技师账号已停用，会话已失效'); });
let resettingAccountId = null;
function closeResetAccountDialog() { document.querySelector('#reset-account-form').reset(); document.querySelector('#show-reset-password').checked = false; document.querySelector('#reset-account-password').type = 'password'; document.querySelector('#reset-password-value').textContent = ''; document.querySelector('#reset-password-result').classList.add('hidden'); document.querySelector('#reset-account-dialog').close(); }
document.querySelector('#tech-account-records').addEventListener('click', event => { const button = event.target.closest('[data-account-reset]'); if (!button) return; const account = technicianAccounts.find(item => String(item.bindingId) === button.dataset.accountReset); if (!account) return toast('未找到技师账号'); resettingAccountId = button.dataset.accountReset; document.querySelector('#reset-account-form').reset(); document.querySelector('#reset-account-password').type = 'password'; document.querySelector('#reset-password-result').classList.add('hidden'); document.querySelector('#reset-account-technician').textContent = `${account.technicianName}（${account.technicianCode}）`; document.querySelector('#reset-account-login').textContent = `登录账号：${account.loginName}`; document.querySelector('#reset-account-dialog').showModal(); });
document.querySelector('#close-reset-account').addEventListener('click', closeResetAccountDialog);
document.querySelector('#finish-reset-account').addEventListener('click', closeResetAccountDialog);
document.querySelector('#show-reset-password').addEventListener('change', event => { document.querySelector('#reset-account-password').type = event.currentTarget.checked ? 'text' : 'password'; });
document.querySelector('#reset-account-form').addEventListener('submit', async event => { event.preventDefault(); const password = new FormData(event.currentTarget).get('password'); const response = await fetch(`http://localhost:8080/api/v1/admin/technician-accounts/${resettingAccountId}/password`, { method:'PUT', headers:storeContextHeaders(true), body:JSON.stringify({password}) }); if (!response.ok) return toast('密码重置失败'); document.querySelector('#reset-password-value').textContent = password; document.querySelector('#reset-password-result').classList.remove('hidden'); document.querySelector('#reset-account-password').value = ''; document.querySelector('#show-reset-password').checked = false; document.querySelector('#reset-account-password').type = 'password'; toast('密码已重置，原会话已失效'); });
document.querySelector('#show-inactive-techs').addEventListener('click', async event => { includeInactiveTechnicians = !includeInactiveTechnicians; event.currentTarget.textContent = includeInactiveTechnicians ? '仅显示启用' : '显示已删除'; await loadManagedTechnicians(); });
document.querySelector('#close-technician-dialog').addEventListener('click', () => document.querySelector('#technician-dialog').close());
document.querySelector('#cancel-technician').addEventListener('click', () => document.querySelector('#technician-dialog').close());
document.querySelector('#technician-search').addEventListener('input', renderManagedTechnicians);
document.querySelector('#technician-records').addEventListener('click', async event => {
  const edit = event.target.closest('[data-edit]');
  if (edit) return openTechnicianDialog(managedTechnicians.find(tech => tech.id === edit.dataset.edit));
  const queueToggle = event.target.closest('[data-queue-toggle]');
  if (queueToggle) {
    const enabled = queueToggle.dataset.enabled !== 'true';
    const actionLabel = enabled ? '启用' : '停用';
    if (!window.confirm(`确认${actionLabel}该技师的前台队列？`)) return;
    queueToggle.disabled = true;
    const response = await fetch(`http://localhost:8080/api/v1/foundation/technicians/${queueToggle.dataset.queueToggle}/queue-enabled`, {
      method:'PUT', headers:storeContextHeaders(true), body:JSON.stringify({ enabled })
    });
    if (!response.ok) { queueToggle.disabled = false; return toast(`${actionLabel}队列失败，请刷新后重试`); }
    await Promise.all([loadManagedTechnicians(), loadFoundationData({ silent:true })]);
    return toast(enabled ? '技师已加入前台队列' : '技师已从前台队列移除');
  }
  const toggle = event.target.closest('[data-toggle]');
  if (!toggle) return;
  if (!window.confirm('确认删除该技师？历史服务记录会继续保留。')) return;
  await fetch(`http://localhost:8080/api/v1/foundation/technicians/${toggle.dataset.toggle}/active`, { method: 'PUT', headers: storeContextHeaders(true), body: JSON.stringify({ active: false }) });
  await loadManagedTechnicians(); loadFoundationData(); toast('技师已删除');
});
document.querySelector('#technician-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = { code: form.get('code'), name: form.get('name'), phone: form.get('phone'), queueOrder: Number(form.get('queueOrder')) };
  const url = editingTechnicianId ? `http://localhost:8080/api/v1/foundation/technicians/${editingTechnicianId}` : 'http://localhost:8080/api/v1/foundation/technicians';
  const response = await fetch(url, { method: editingTechnicianId ? 'PUT' : 'POST', headers: storeContextHeaders(true), body: JSON.stringify(body) });
  if (!response.ok) { const error = await response.json().catch(() => ({})); return toast(error.message || '保存失败，请检查技师编号是否重复'); }
  document.querySelector('#technician-dialog').close(); await loadManagedTechnicians(); loadFoundationData(); toast('技师资料已保存');
});
document.querySelector('#add-service-item').addEventListener('click', () => openServiceItemDialog());
document.querySelector('#close-service-item-dialog').addEventListener('click', () => document.querySelector('#service-item-dialog').close());
document.querySelector('#cancel-service-item').addEventListener('click', () => document.querySelector('#service-item-dialog').close());
document.querySelector('#close-service-commission-dialog').addEventListener('click', () => document.querySelector('#service-commission-dialog').close());
document.querySelector('#cancel-service-commission').addEventListener('click', () => document.querySelector('#service-commission-dialog').close());
document.querySelector('#service-commission-form').addEventListener('change', event => {
  if (event.target.matches('[data-commission-type]')) syncCommissionRuleFields();
});
document.querySelector('#show-inactive-services').addEventListener('click', async event => {
  includeInactiveServices = !includeInactiveServices;
  event.currentTarget.textContent = includeInactiveServices ? '仅显示启用' : '显示已删除';
  await loadManagedServiceItems();
});
document.querySelector('#service-item-search').addEventListener('input', renderManagedServiceItems);
document.querySelector('#service-item-form').addEventListener('change', event => {
  if (event.target.name !== 'categoryId' || !event.target.value) return;
  const category = state.serviceCategories.find(item => String(item.id) === String(event.target.value));
  if (category) event.currentTarget.elements.category.value = category.name;
});
document.querySelector('#service-item-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const price = Number(form.get('price'));
  if (!Number.isFinite(price) || price < 0) return toast('请输入有效的项目价格');
  const body = {
    code: form.get('code').trim(),
    name: form.get('name').trim(),
    category: (state.serviceCategories.find(item => String(item.id) === String(form.get('categoryId')))?.name || String(form.get('category') || '未分类')).trim(),
    categoryId: form.get('categoryId') || null,
    defaultDurationMinutes: Number(form.get('defaultDurationMinutes')),
    priceCents: Math.round(price * 100),
    priceEffectiveBusinessDate: form.get('priceEffectiveBusinessDate') || null,
    requiresRoom: form.get('requiresRoom') === 'on',
    allowsExtension: form.get('allowsExtension') === 'on',
    countsAsClock: form.get('countsAsClock') === 'on'
  };
  const url = editingServiceItemId ? `http://localhost:8080/api/v1/foundation/service-items/${editingServiceItemId}` : 'http://localhost:8080/api/v1/foundation/service-items';
  const response = await fetch(url, { method: editingServiceItemId ? 'PUT' : 'POST', headers: storeContextHeaders(true), body: JSON.stringify(body) });
  if (!response.ok) return toast(response.status === 400 ? '项目保存失败，生效营业日不可早于当前营业日' : '项目保存失败，请检查项目编号是否重复');
  document.querySelector('#service-item-dialog').close();
  await Promise.all([loadManagedServiceItems(), loadFoundationData()]);
  toast('服务项目已保存');
});
document.querySelector('#service-commission-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!editingCommissionServiceItemId) return;
  if (!localStorage.getItem(adminTokenKey)) { showAdminLogin(); return; }
  let body;
  try {
    const form = event.currentTarget;
    body = { ...commissionRulePayload(form, 'queue'), ...commissionRulePayload(form, 'call'), ...commissionRulePayload(form, 'extension'), active: true, effectiveBusinessDate: form.elements.effectiveBusinessDate.value || null };
  } catch {
    toast('请输入有效的固定金额或比例');
    return;
  }
  const response = await fetch(`http://localhost:8080/api/v1/commissions/service-item-rules/${editingCommissionServiceItemId}`, { method: 'PUT', headers: storeContextHeaders(true), body: JSON.stringify(body) });
  if (!response.ok) return toast(response.status === 401 ? '请先登录管理账号' : response.status === 400 ? '提成保存失败，生效营业日不可早于当前营业日' : '提成规则保存失败');
  document.querySelector('#service-commission-dialog').close();
  await loadManagedServiceItems();
  toast('项目提成规则已保存');
});
document.querySelector('#service-item-records').addEventListener('click', async event => {
  const commission = event.target.closest('[data-service-item-commission]');
  if (commission) {
    if (!localStorage.getItem(adminTokenKey)) { showAdminLogin(); return; }
    return openServiceCommissionDialog(managedServiceItems.find(item => item.id === commission.dataset.serviceItemCommission));
  }
  const edit = event.target.closest('[data-service-item-edit]');
  if (edit) return openServiceItemDialog(managedServiceItems.find(item => item.id === edit.dataset.serviceItemEdit));
  const toggle = event.target.closest('[data-service-item-active]');
  if (!toggle) return;
  if (!window.confirm('确认删除该服务项目？历史订单和提成记录会继续保留。')) return;
  const response = await fetch(`http://localhost:8080/api/v1/foundation/service-items/${toggle.dataset.serviceItemActive}/active`, { method: 'PUT', headers: storeContextHeaders(true), body: JSON.stringify({ active: false }) });
  if (!response.ok) return toast('项目状态更新失败');
  await Promise.all([loadManagedServiceItems(), loadFoundationData()]);
  toast('服务项目已删除');
});
document.querySelector('#add-payment-method').addEventListener('click', () => openPaymentMethodDialog());
document.querySelector('#close-payment-method-dialog').addEventListener('click', () => document.querySelector('#payment-method-dialog').close());
document.querySelector('#cancel-payment-method').addEventListener('click', () => document.querySelector('#payment-method-dialog').close());
document.querySelector('#show-inactive-payment-methods').addEventListener('click', async event => { includeInactivePaymentMethods = !includeInactivePaymentMethods; event.currentTarget.textContent = includeInactivePaymentMethods ? '仅显示启用' : '显示已删除'; await loadManagedPaymentMethods(); });
document.querySelector('#payment-method-search').addEventListener('input', renderManagedPaymentMethods);
document.querySelector('#payment-method-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const body = { code: form.get('code').trim(), name: form.get('name').trim(), cashCounted: form.get('cashCounted') === 'on', sortOrder: Number(form.get('sortOrder')), note: form.get('note').trim() || null };
  const url = editingPaymentMethodId ? `http://localhost:8080/api/v1/payment-methods/${editingPaymentMethodId}` : 'http://localhost:8080/api/v1/payment-methods';
  const response = await fetch(url, { method: editingPaymentMethodId ? 'PUT' : 'POST', headers: storeContextHeaders(true), body: JSON.stringify(body) });
  if (!response.ok) return toast('收款方式保存失败，请检查编码是否重复');
  document.querySelector('#payment-method-dialog').close(); await Promise.all([loadManagedPaymentMethods(), loadActivePaymentMethods()]); toast('收款方式已保存');
});
document.querySelector('#payment-method-records').addEventListener('click', async event => {
  const edit = event.target.closest('[data-payment-method-edit]');
  if (edit) return openPaymentMethodDialog(managedPaymentMethods.find(item => item.id === edit.dataset.paymentMethodEdit));
  const toggle = event.target.closest('[data-payment-method-active]'); if (!toggle) return;
  if (!window.confirm('确认删除该收款方式？历史订单支付记录会继续保留。')) return;
  const response = await fetch(`http://localhost:8080/api/v1/payment-methods/${toggle.dataset.paymentMethodActive}/active`, { method: 'PUT', headers: storeContextHeaders(true), body: JSON.stringify({ active: false }) });
  if (!response.ok) return toast('收款方式状态更新失败');
  await Promise.all([loadManagedPaymentMethods(), loadActivePaymentMethods()]); toast('收款方式已删除');
});
document.querySelector('#print-setting-form').addEventListener('input', renderPrintPreview);
document.querySelector('#print-setting-form').addEventListener('change', renderPrintPreview);
document.querySelector('#print-setting-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const checked = name => form.get(name) === 'on';
  const contentOptions = selectedPrintContentOptions();
  const body = { storeName:form.get('storeName'), receiptTitle:form.get('receiptTitle'), storeAddress:form.get('storeAddress'), storePhone:form.get('storePhone'), headerNote:form.get('headerNote'), footerNote:form.get('footerNote'), paperWidthMm:Number(form.get('paperWidthMm')), fontSizePx:Number(form.get('fontSizePx')), marginMm:Number(form.get('marginMm')), copies:Number(form.get('copies')), autoPrint:checked('autoPrint'), showStoreAddress:contentOptions.showStoreAddress, showStorePhone:contentOptions.showStorePhone, showOrderNo:contentOptions.showOrderNumbers, showMember:contentOptions.showMember, showTechnician:contentOptions.showTechnician, showRoom:contentOptions.showRoom, showPayment:contentOptions.showPayment, showBalance:contentOptions.showBalance, contentOptions };
  const response = await fetch('http://localhost:8080/api/v1/print-settings', { method:'PUT', headers:storeContextHeaders(true), body:JSON.stringify(body) });
  if (!response.ok) return toast('打印设置保存失败');
  storePrintSetting = await response.json(); renderPrintSetting(); toast('打印设置已保存');
});
document.querySelector('#print-test-receipt').addEventListener('click', () => {
  const popup = window.open('', 'massage-receipt', 'popup,width=480,height=720');
  if (!popup) return toast('浏览器阻止了打印窗口，请允许弹出窗口');
  const now = new Date().toISOString();
  const sample = { order:{ orderNo:'TEST-RECEIPT', settlementNo:'TEST-SETTLEMENT', cashierNameSnapshot:'测试收银员', createdAt:now, settledAt:now, receivableCents:29800, paidCents:29800, memberName:'测试会员', memberPhone:'13800000000', memberBalanceCents:50000 }, lines:[{ itemNameSnapshot:'测试服务项目', durationMinutes:60, quantity:1, unitPriceCents:29800, lineAmountCents:29800, technicianName:'示例技师', roomCode:'201', clockType:'CALL' }], payments:[{ paymentMethod:'CASH', paymentMethodNameSnapshot:'现金', amountCents:29800 }] };
printOrder(sample, popup).catch(() => { popup.close(); toast('打印测试失败，请先保存设置'); });
});
document.addEventListener('change', event => { if (event.target.id === 'current-store-select') loadStorePrintSetting({ render:false }).catch(() => {}); });
document.querySelector('#schedule-admin-login').addEventListener('click',showAdminLogin);
document.querySelector('#schedule-date').addEventListener('change',()=>loadSchedulingData().catch(()=>toast('排班数据加载失败')));
document.querySelector('#add-tech-schedule').addEventListener('click',()=>{if(!localStorage.getItem(adminTokenKey))return showAdminLogin();openTechnicianSchedule();});
document.querySelector('#add-tech-leave').addEventListener('click',()=>{if(!localStorage.getItem(adminTokenKey))return showAdminLogin();openTechnicianLeave();});
document.querySelector('#schedule-shift-type').addEventListener('change',syncScheduleShiftFields);
document.querySelector('#close-technician-schedule').addEventListener('click',()=>document.querySelector('#technician-schedule-dialog').close());
document.querySelector('#cancel-technician-schedule').addEventListener('click',()=>document.querySelector('#technician-schedule-dialog').close());
document.querySelector('#technician-schedule-form').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const rest=form.get('shiftType')==='REST';const body={technicianId:form.get('technicianId'),scheduleDate:form.get('scheduleDate'),shiftType:form.get('shiftType'),startTime:rest?null:form.get('startTime'),endTime:rest?null:form.get('endTime'),note:form.get('note')||null};const url=editingTechnicianScheduleId?`http://localhost:8080/api/v1/technician-schedules/${editingTechnicianScheduleId}`:'http://localhost:8080/api/v1/technician-schedules';const response=await fetch(url,{method:editingTechnicianScheduleId?'PUT':'POST',headers:storeContextHeaders(true),body:JSON.stringify(body)});if(!response.ok)return toast(response.status===409?'该技师当天已有班次':'班次保存失败，请检查时间和技师');document.querySelector('#technician-schedule-dialog').close();await loadSchedulingData();toast('班次已保存');});
document.querySelector('#technician-schedule-records').addEventListener('click',async event=>{const edit=event.target.closest('[data-schedule-edit]');if(edit)return openTechnicianSchedule(technicianSchedules.find(item=>item.id===edit.dataset.scheduleEdit));const cancel=event.target.closest('[data-schedule-cancel]');if(!cancel||!window.confirm('确认取消该班次？'))return;const response=await fetch(`http://localhost:8080/api/v1/technician-schedules/${cancel.dataset.scheduleCancel}/cancel`,{method:'PUT',headers:storeContextHeaders()});if(!response.ok)return toast('取消班次失败');await loadSchedulingData();toast('班次已取消');});
document.querySelector('#close-technician-leave').addEventListener('click',()=>document.querySelector('#technician-leave-dialog').close());
document.querySelector('#cancel-technician-leave').addEventListener('click',()=>document.querySelector('#technician-leave-dialog').close());
document.querySelector('#technician-leave-form').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const response=await fetch('http://localhost:8080/api/v1/technician-schedules/leave-requests',{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({technicianId:form.get('technicianId'),startDate:form.get('startDate'),endDate:form.get('endDate'),reason:form.get('reason')||null})});if(!response.ok)return toast('请假申请失败，请检查日期');document.querySelector('#technician-leave-dialog').close();await loadSchedulingData();toast('请假申请已提交');});
document.querySelector('#technician-leave-records').addEventListener('click',event=>{const button=event.target.closest('[data-leave-review]');if(!button)return;reviewingTechnicianLeaveId=button.dataset.leaveReview;const leave=technicianLeaveRequests.find(item=>item.id===reviewingTechnicianLeaveId);document.querySelector('#technician-leave-review-title').textContent=`审批 ${leave?.technicianName||'技师'} 的请假`;document.querySelector('#technician-leave-review-form').reset();document.querySelector('#technician-leave-review-dialog').showModal();});
document.querySelector('#close-technician-leave-review').addEventListener('click',()=>document.querySelector('#technician-leave-review-dialog').close());
document.querySelector('#technician-leave-review-form').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const response=await fetch(`http://localhost:8080/api/v1/technician-schedules/leave-requests/${reviewingTechnicianLeaveId}/status`,{method:'PUT',headers:storeContextHeaders(true),body:JSON.stringify({status:form.get('status'),reviewerName:form.get('reviewerName'),reviewNote:form.get('reviewNote')||null})});if(!response.ok)return toast('请假审批失败，记录可能已处理');document.querySelector('#technician-leave-review-dialog').close();await loadSchedulingData();toast(form.get('status')==='APPROVED'?'请假已批准':'请假申请已取消');});
document.querySelector('#add-room').addEventListener('click', () => openRoomDialog());
document.querySelector('#close-room-dialog').addEventListener('click', () => document.querySelector('#room-dialog').close());
document.querySelector('#cancel-room').addEventListener('click', () => document.querySelector('#room-dialog').close());
document.querySelector('#room-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const body = { code: form.get('code'), name: form.get('name'), roomType: form.get('roomType'), bedCount: Number(form.get('bedCount')) };
  const url = editingRoomId ? `http://localhost:8080/api/v1/rooms/${editingRoomId}` : 'http://localhost:8080/api/v1/rooms';
  const response = await fetch(url, { method: editingRoomId ? 'PUT' : 'POST', headers: storeContextHeaders(true), body: JSON.stringify(body) });
  if (!response.ok) return toast('保存失败，请检查房间编号是否重复');
  document.querySelector('#room-dialog').close(); event.currentTarget.reset(); await loadManagedRooms(); toast('房间已新增');
});
document.querySelector('#room-records').addEventListener('click', async event => {
  const edit = event.target.closest('[data-room-edit]');
  if (edit) return openRoomDialog(managedRooms.find(room => room.id === edit.dataset.roomEdit));
  const active = event.target.closest('[data-room-active]'); if (!active) return;
  if (!window.confirm('确认删除该房间？历史服务记录会继续保留。')) return;
  const response = await fetch(`http://localhost:8080/api/v1/rooms/${active.dataset.roomActive}/active`, { method: 'PUT', headers: storeContextHeaders(true), body: JSON.stringify({ active: false }) });
  if (!response.ok) return toast('房间删除失败，请确认房间当前没有服务');
  await loadManagedRooms(); toast('房间已删除');
});
document.querySelector('#manage-beds').addEventListener('click', async () => {
  editingBedId = null;
  document.querySelector('#bed-form').reset();
  const [response, roomResponse] = await Promise.all([fetch('http://localhost:8080/api/v1/rooms/beds',{headers:storeContextHeaders()}), fetch('http://localhost:8080/api/v1/rooms',{headers:storeContextHeaders()})]);
  const beds = response.ok ? await response.json() : [];
  const rooms = roomResponse.ok ? await roomResponse.json() : [];
  document.querySelector('#bed-room').innerHTML = rooms.filter(room => room.active).map(room => `<option value="${roomTransferEscape(room.id)}">${roomTransferEscape(room.code)} · ${roomTransferEscape(room.name)}</option>`).join('');
  document.querySelector('#bed-results').innerHTML = beds.map(bed => `<div class="member-result"><span class="member-avatar">床</span><span><b>${roomTransferEscape(bed.code)}</b><small>${roomTransferEscape(bed.name)} · 排序 ${roomTransferEscape(bed.sortOrder)}</small></span><em>${bed.active ? '启用' : '已删除'}</em>${bed.active ? `<button class="record-delete" data-bed-edit="${roomTransferEscape(bed.id)}">编辑</button><button class="record-delete" data-bed-active="${roomTransferEscape(bed.id)}" data-active="true">删除</button>` : '<span class="muted-cell">—</span>'}</div>`).join('') || '<p class="empty-state">暂无床位</p>';
  document.querySelector('#bed-results').dataset.beds = JSON.stringify(beds);
  document.querySelector('#bed-dialog').showModal();
});
document.querySelector('#close-bed-dialog').addEventListener('click', () => document.querySelector('#bed-dialog').close());
document.querySelector('#bed-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const wasEditing = Boolean(editingBedId);
  const body = { code: form.get('code'), name: form.get('name'), sortOrder: Number(form.get('sortOrder')) };
  const url = wasEditing ? `http://localhost:8080/api/v1/rooms/beds/${editingBedId}` : `http://localhost:8080/api/v1/rooms/${form.get('roomId')}/beds`;
  const response = await fetch(url, { method: wasEditing ? 'PUT' : 'POST', headers: storeContextHeaders(true), body: JSON.stringify(body) });
  if (!response.ok) return toast('保存失败，请检查床位编号是否重复');
  event.currentTarget.reset(); document.querySelector('#manage-beds').click(); toast(wasEditing ? '床位已更新' : '床位已新增');
});
document.querySelector('#bed-results').addEventListener('click', async event => {
  const beds = JSON.parse(event.currentTarget.dataset.beds || '[]');
  const edit = event.target.closest('[data-bed-edit]');
  if (edit) { const bed = beds.find(item => item.id === edit.dataset.bedEdit); editingBedId = bed.id; const form = document.querySelector('#bed-form'); form.roomId.value = bed.roomId; form.code.value = bed.code; form.name.value = bed.name; form.sortOrder.value = bed.sortOrder; return; }
  const active = event.target.closest('[data-bed-active]'); if (!active) return;
  if (!window.confirm('确认删除该床位？历史记录会继续保留。')) return;
  const response = await fetch(`http://localhost:8080/api/v1/rooms/beds/${active.dataset.bedActive}/active`, { method: 'PUT', headers: storeContextHeaders(true), body: JSON.stringify({ active: false }) });
  if (!response.ok) return toast('床位删除失败');
  document.querySelector('#manage-beds').click(); toast('床位已删除');
});
async function completeRoomCleaning(room) {
  if (!room || room.status !== 'cleaning' || !room.apiId) return;
  if (!window.confirm(`确认 ${room.id} 房已完成清洁并恢复为空闲？`)) return;
  const response = await fetch(`http://localhost:8080/api/v1/rooms/${room.apiId}/complete-cleaning`, { method:'POST', headers:storeContextHeaders() });
  if (!response.ok) { toast('房间状态已变化，请同步后重试'); return; }
  await loadFoundationData();
  toast(`${room.id} 房已恢复为空闲`);
}
async function confirmRoomPayment(room) {
  if (!room || room.status !== 'pending-payment' || !room.apiId) return;
  if (!window.confirm(`确认 ${room.id} 房已付款并转为清洁中？`)) return;
  const response = await fetch(`http://localhost:8080/api/v1/rooms/${room.apiId}/confirm-payment`, { method:'POST', headers:storeContextHeaders() });
  if (!response.ok) { toast('确认付款失败，房间状态可能已变化'); return; }
  await loadFoundationData();
  toast(`${room.id} 房已确认付款，等待清洁`);
}
document.querySelector('#room-grid').addEventListener('click', async event => {
  console.log('[room-grid] click', event.target, event.target?.closest?.('[data-dispatch-reassignment]'), event.target?.closest?.('[data-dispatch-cancellation]'));
  const reassignment = event.target.closest('[data-dispatch-reassignment]');
  if (reassignment) { await openDispatchReassignment(reassignment.dataset.dispatchReassignment); return; }
  const cancellation = event.target.closest('[data-dispatch-cancellation]');
  if (cancellation) { dispatchReassignmentSessionId = cancellation.dataset.dispatchCancellation; openDispatchCancellation(); return; }
  const transferTechnician = event.target.closest('[data-transfer-technician]');
  if (transferTechnician) {
    const room = state.rooms.find(item => item.id === transferTechnician.dataset.transferTechnician);
    if (!room?.sessionId) { toast('未找到当前房间的服务记录，请刷新后重试'); return; }
    await openParticipantTransfer(room.sessionId);
    return;
  }
  const paid = event.target.closest('[data-confirm-payment]');
  if (paid) { await confirmRoomPayment(state.rooms.find(item => item.id === paid.dataset.confirmPayment)); return; }
  const complete = event.target.closest('[data-complete-cleaning]');
  if (complete) { await completeRoomCleaning(state.rooms.find(item => item.id === complete.dataset.completeCleaning)); return; }
  const statusButton = event.target.closest('[data-room-status]');
  if (statusButton) { const room = state.rooms.find(item => item.id === statusButton.dataset.roomStatus); changingRoom = room; document.querySelector('#room-status-title').textContent = `${room.id} 房间状态`; document.querySelector('#room-status-form').status.value = { idle:'IDLE', serving:'IN_SERVICE', 'pending-payment':'PENDING_PAYMENT', cleaning:'CLEANING', reserved:'RESERVED' }[room.status] || 'IDLE'; document.querySelector('#room-status-dialog').showModal(); return; }
  const roomButton = event.target.closest('[data-room]'); if (!roomButton) return;
  const room = state.rooms.find(item => item.id === roomButton.dataset.room);
  if (room.status === 'idle') { openClockDialog(null, room); return; }
  if (room.status === 'pending-payment') { try { await openSingleRoomSettlement(room); } catch { toast('单房结算资料加载失败，请刷新后重试'); } return; }
  changingRoom = room;
  document.querySelector('#room-status-title').textContent = `${room.id} 房间状态`;
  document.querySelector('#room-status-form').status.value = { idle:'IDLE', serving:'IN_SERVICE', 'pending-payment':'PENDING_PAYMENT', cleaning:'CLEANING', reserved:'RESERVED' }[room.status] || 'IDLE';
   if (changingRoom?.status === 'maintenance') document.querySelector('#room-status-form').status.value='MAINTENANCE';
   document.querySelector('#room-status-dialog').showModal();
});
document.querySelector('#close-participant-transfer').addEventListener('click', () => document.querySelector('#participant-transfer-dialog').close());
document.querySelector('#cancel-participant-transfer').addEventListener('click', () => document.querySelector('#participant-transfer-dialog').close());
document.querySelector('#participant-transfer-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!participantTransferSessionId) return;
  const form = new FormData(event.currentTarget);
  const reason = String(form.get('reason') || '').trim();
  if (!reason) { toast('请填写换技师原因'); return; }
  const response = await fetch(`http://localhost:8080/api/v1/service-sessions/${participantTransferSessionId}/participants/transfer`, {
    method:'POST', headers:storeContextHeaders(true), body:JSON.stringify({ fromTechnicianId:form.get('fromTechnicianId'), toTechnicianId:form.get('toTechnicianId'), reason })
  });
  if (!response.ok) { const detail=(await response.text()).replace(/^"|"$/g,''); toast(`换技师失败：${detail || '技师状态已变化'}`); return; }
  document.querySelector('#participant-transfer-dialog').close();
  participantTransferSessionId = null;
  await Promise.all([loadFoundationData({ silent:true }), loadServiceSessions()]);
  toast('技师已更换，业绩将按各自实际服务时长拆分');
});
document.querySelector('#frontdesk-view').addEventListener('click', async event => {
  const refresh = event.target.closest('#refresh-room-transfers');
  if (refresh) { return; }
  const approve = event.target.closest('[data-transfer-approve]');
  if (approve) { await approveRoomTransfer(approve.dataset.transferApprove); return; }
  const reject = event.target.closest('[data-transfer-reject]');
  if (reject) openRoomTransferReject(reject.dataset.transferReject);
});
document.querySelector('#close-room-status').addEventListener('click', () => document.querySelector('#room-status-dialog').close());
document.querySelector('#room-status-form').addEventListener('submit', async event => { event.preventDefault(); const form=new FormData(event.currentTarget); const response = await fetch(`http://localhost:8080/api/v1/rooms/${changingRoom.apiId}/status`, {method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({status:form.get('status'),reason:form.get('reason')})}); if (!response.ok) { toast('房间存在进行中的服务，请先为技师下钟'); return; } document.querySelector('#room-status-dialog').close(); await loadFoundationData(); toast('房间状态已更新'); });
document.querySelector('#service-options').addEventListener('click', event => { const option = event.target.closest('[data-service]'); if (!option) return; document.querySelectorAll('.service-option').forEach(item => item.classList.remove('selected')); option.classList.add('selected'); });
document.querySelector('#order-service-categories').addEventListener('click', event => {
  const button = event.target.closest('[data-order-category]');
  if (!button) return;
  orderServiceCategoryId = button.dataset.orderCategory;
  renderOrderServiceCatalog();
});
document.querySelector('#order-service-search').addEventListener('input', event => {
  orderServiceSearch = event.target.value;
  renderOrderServiceCatalog();
});
document.querySelector('#confirm-service').addEventListener('click', event => { event.preventDefault(); const selected = document.querySelector('.service-option.selected'); if (!selected) return toast('请先选择服务项目'); const service = state.services.find(item => String(item.id) === String(selected.dataset.service)); if (!service) return toast('项目数据已变化，请刷新后重试'); document.querySelector('#order-dialog').close(); openManualServiceConfig(service); });
document.querySelector('#close-manual-service-config').addEventListener('click', closeManualServiceConfig);
document.querySelector('#cancel-manual-service-config').addEventListener('click', closeManualServiceConfig);
document.querySelector('#manual-service-add-technician').addEventListener('click', () => {
  if (!manualServiceDraft) return;
  if (manualServiceDraft.technicians.length >= 4) return toast('一个项目最多选择 4 位技师');
  syncManualServiceDraftFromForm();
  const selected = new Set(manualServiceDraft.technicians.map(item => String(item.technicianId)));
  const next = state.technicians.find(item => item.state !== 'off' && !selected.has(String(item.id)));
  if (!next) return toast('没有更多可选择的技师');
  manualServiceDraft.technicians.push({ technicianId: next.id, allocationBp: Math.floor(10000 / (manualServiceDraft.technicians.length + 1)) });
  const base = Math.floor(10000 / manualServiceDraft.technicians.length);
  manualServiceDraft.technicians.forEach((item, index) => { item.allocationBp = base + (index === manualServiceDraft.technicians.length - 1 ? 10000 - base * manualServiceDraft.technicians.length : 0); });
  renderManualServiceTechnicians();
});
document.querySelector('#manual-service-technician-list').addEventListener('change', syncManualServiceDraftFromForm);
document.querySelector('#manual-service-technician-list').addEventListener('input', syncManualServiceDraftFromForm);
document.querySelector('#manual-service-technician-list').addEventListener('click', event => {
  const remove = event.target.closest('[data-manual-remove]');
  if (!remove || !manualServiceDraft || manualServiceDraft.technicians.length <= 1) return;
  syncManualServiceDraftFromForm(); manualServiceDraft.technicians.splice(Number(remove.dataset.manualRemove), 1);
  const base = Math.floor(10000 / manualServiceDraft.technicians.length);
  manualServiceDraft.technicians.forEach((item, index) => { item.allocationBp = base + (index === manualServiceDraft.technicians.length - 1 ? 10000 - base * manualServiceDraft.technicians.length : 0); });
  renderManualServiceTechnicians();
});
document.querySelector('#manual-service-config-form').addEventListener('submit', event => {
  event.preventDefault(); syncManualServiceDraftFromForm();
  if (!manualServiceTarget || !manualServiceDraft) return;
  if (!Number.isInteger(manualServiceDraft.duration) || manualServiceDraft.duration < 15 || manualServiceDraft.duration > 360) return toast('服务时长必须在 15 到 360 分钟之间');
  if (manualServiceDraft.technicians.some(item => !item.technicianId) || manualServiceDraft.technicians.reduce((sum, item) => sum + item.allocationBp, 0) !== 10000) return toast('请选择技师，并确保业绩分配合计为 100%');
  if (new Set(manualServiceDraft.technicians.map(item => item.technicianId)).size !== manualServiceDraft.technicians.length) return toast('同一项目不能重复选择技师');
  state.orderItems.push({ ...manualServiceTarget, duration: `${manualServiceDraft.duration} 分钟`, durationMinutes: manualServiceDraft.duration, lineId: `${manualServiceTarget.id}-${Date.now()}`, manualService: { clockType: manualServiceDraft.clockType, roomId: manualServiceDraft.roomId || null, technicians: manualServiceDraft.technicians } });
  const name = manualServiceTarget.name; closeManualServiceConfig(); renderOrder(); toast(`${name} 已加入订单`);
});
document.querySelector('#order-lines').addEventListener('click', event => { const cancel=event.target.closest('[data-cancel-order-correction]');if(cancel){if(window.confirm('取消本次订单修正并清空工作台？')){orderCorrectionContext=null;state.orderItems=[];state.selectedMemberId=null;renderMemberCard();renderOrder();}return;}const button = event.target.closest('[data-remove]'); if (!button) return; state.orderItems = state.orderItems.filter(item => item.lineId !== button.dataset.remove); renderOrder(); });
document.querySelector('#pending-service-list').addEventListener('click', event => { const voidButton = event.target.closest('[data-void-service]'); if (voidButton) { openPendingServiceVoid(voidButton.dataset.voidService); return; } const button = event.target.closest('[data-pending-service]'); if (button) addPendingServiceToOrder(button.dataset.pendingService); });
document.querySelector('#pending-service-list').addEventListener('wheel', event => {
  const list = event.currentTarget;
  if (list.scrollHeight <= list.clientHeight) return;
  const previous = list.scrollTop;
  list.scrollTop += event.deltaY;
  if (list.scrollTop !== previous) event.preventDefault();
  event.stopPropagation();
}, { passive:false });
document.querySelector('#pending-service-search').addEventListener('input', renderPendingServiceSessions);
document.querySelector('#refresh-pending-services').addEventListener('click', async () => {
  if (!singleRoomSettlementRoomId) { await loadPendingServiceSessions(); return; }
  const loaded = await loadPendingServiceSessions({ roomId: singleRoomSettlementRoomId, updateState: false });
  if (!loaded) return;
  singleRoomSettlementSessions = loaded;
  renderPendingServiceSessions();
});
document.querySelector('#frontdesk-view').addEventListener('click', event => { const dispatch = event.target.closest('[data-reservation-dispatch]'); if (dispatch) dispatchReservation(dispatch.dataset.reservationDispatch); const refresh = event.target.closest('#refresh-reservations'); if (refresh) loadReservations(); });
document.querySelector('#settle-order').addEventListener('click', async () => { try { await loadActivePaymentMethods(); renderSettlementMember(); renderOrder(); const amount=document.querySelector('#settlement-amount'); if(amount) amount.value=(settlementTotalCents()/100).toFixed(2); const waive=document.querySelector('#settlement-waive'); if(waive) waive.checked=false; const reason=document.querySelector('#settlement-waive-reason'); if(reason) reason.value=''; document.querySelector('#settlement-waive-reason-wrap')?.setAttribute('hidden',''); renderSettlementPaymentMethods({reset:true}); setOrderDrawer(false); document.querySelector('#settlement-dialog').showModal(); } catch { toast('收款方式加载失败'); } });
document.querySelector('#close-settlement-dialog').addEventListener('click', () => document.querySelector('#settlement-dialog').close());
document.querySelector('#settlement-amount').addEventListener('input', () => { if (settlementIsWaived()) { document.querySelector('#settlement-waive').checked=false; document.querySelector('#settlement-waive-reason-wrap').setAttribute('hidden',''); } updateSettlementAllocation(); });
document.querySelector('#settlement-waive').addEventListener('change', event => { const checked=event.currentTarget.checked; const amount=document.querySelector('#settlement-amount'); const wrap=document.querySelector('#settlement-waive-reason-wrap'); if(checked){ amount.value='0.00'; settlementPaymentDraft=new Map(); } else { amount.value=(settlementTotalCents()/100).toFixed(2); } wrap.toggleAttribute('hidden', !checked); renderSettlementPaymentMethods(); updateSettlementAllocation(); });
document.querySelector('#payment-options').addEventListener('input',event=>{if(event.target.matches('[data-payment-amount]'))updateSettlementAllocation();});
document.querySelector('#payment-options').addEventListener('click',event=>{const button=event.target.closest('[data-fill-payment]');if(!button||button.disabled)return;const totalCents=settlementAmountCents();const inputs=[...document.querySelectorAll('[data-payment-amount]')];const current=inputs.find(input=>input.dataset.paymentAmount===button.dataset.fillPayment);const otherCents=inputs.filter(input=>input!==current).reduce((sum,input)=>sum+Math.round(Math.max(0,Number(input.value)||0)*100),0);current.value=(Math.max(0,totalCents-otherCents)/100).toFixed(2);updateSettlementAllocation();});
document.querySelector('#settlement-dialog form').addEventListener('submit', async event => {
  event.preventDefault();
  const totalCents=settlementAmountCents();
  const waived=settlementIsWaived();
  const waiveReason=document.querySelector('#settlement-waive-reason')?.value.trim() || '';
  const payments=settlementPayments();
  const paidCents=payments.reduce((sum,payment)=>sum+payment.amountCents,0);
  if(totalCents===0 && (!waived || !waiveReason)) return toast('0.00 元结算必须勾选免单并填写原因');
  if(totalCents>0 && totalCents<1) return toast('普通结算最低实收金额为 0.01 元');
  if(totalCents>0 && !payments.length)return toast('请至少填写一种收款金额');
  if(paidCents!==totalCents)return toast(`收款金额与应收不一致，还差 ${money(Math.abs(totalCents-paidCents)/100)}`);
  const memberPayment=payments.find(payment=>activePaymentMethods.find(method=>method.code===payment.method)?.methodKind==='MEMBER_BALANCE');
  const member=state.members.find(item=>item.id===state.selectedMemberId);
  if(memberPayment&&!member)return toast('会员余额付款需要先选择会员');
  if(memberPayment&&memberPayment.amountCents>Math.round(Number(member.balance||0)*100))return toast('会员余额不足，请调整会员余额金额或补充其他收款方式');
  const submitButton = event.currentTarget.querySelector('.pay-button');
  if (submitButton.disabled) return;
  const originalSubmitText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = '正在收款...';
  const printWindow = storePrintSetting?.autoPrint && !localPrintBridgeOnline ? window.open('', 'massage-receipt', 'popup,width=480,height=720') : null;
  try {
    const response = await fetch('http://localhost:8080/api/v1/sales-orders/settle',{method:'POST',headers:storeContextHeaders(true),body:JSON.stringify({memberId:state.selectedMemberId || null,settlementAmountCents:totalCents,waiveReason:waived ? waiveReason : null,correctedFromOrderId:orderCorrectionContext?.originalOrderId||null,correctionReason:orderCorrectionContext?.reason||null,lines:state.orderItems.map(item=>({serviceItemId:item.id,serviceSessionId:item.serviceSessionId||null,durationMinutes:Number(item.durationMinutes || Number.parseInt(item.duration,10)),clockType:item.manualService?.clockType||null,roomId:item.manualService?.roomId||null,technicians:item.manualService?.technicians||null})),payments})});
    if(!response.ok){ if (printWindow) printWindow.close(); toast(await responseMessage(response, memberPayment?'结算失败：会员余额或收款明细有误':'结算失败，请检查当前订单')); return; }
    const settledOrder = await response.json();
    state.orderItems=[]; state.selectedMemberId=null; orderCorrectionContext=null; singleRoomSettlementRoomId=null; singleRoomSettlementRoom=null; singleRoomSettlementSessions=[]; singleRoomSettlementSelection=new Set(); document.querySelector('#settlement-dialog').close(); renderMemberCard(); renderOrder(); await Promise.all([loadPendingServiceSessions({ silent:true }),loadFoundationData({ silent:true })]);
    if (printWindow) {
      const detailResponse = await fetch(`http://localhost:8080/api/v1/sales-orders/${settledOrder.id}`, { headers:storeContextHeaders() });
      if(detailResponse.ok) printOrder(await detailResponse.json(), printWindow).catch(() => { if (printWindow) printWindow.close(); toast('订单已收款，小票打印失败'); });
      else { printWindow.close(); toast('订单已收款，小票加载失败'); }
    }
    toast('收款成功，订单已完成');
  } catch {
    if (printWindow) printWindow.close();
    toast('结算服务连接失败，请稍后重试');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalSubmitText;
  }
});

async function restoreFrontdeskSession(){
  if(!localStorage.getItem(adminTokenKey)){requireFrontdeskLogin();return;}
  try{
    await initializeAdminSession();
    frontdeskLoginRequired=false;
    document.body.classList.remove('frontdesk-auth-locked');
    const requestedView=window.location.hash==='#management'?'management':'frontdesk';
    const requestedButton=document.querySelector(`[data-view="${requestedView}"]`);
    (requestedButton&&!requestedButton.hidden?requestedButton:[...document.querySelectorAll('.nav-item[data-view]')].find(button=>!button.hidden))?.click();
  }catch{
    clearAdminSession();
    requireFrontdeskLogin();
  }
}
renderRooms(); renderTechnicians(); renderOrder(); renderMemberCard(); syncHeadquartersNavigation();
setupOperatorMenu();
restoreFrontdeskSession();

// Payment proof upload is attached to the existing finance payment dialog so the
// current review and settlement workflow stays unchanged for older claims.
(function setupFinancePaymentProof() {
  const form = document.querySelector('#finance-payment-form');
  if (!form || document.querySelector('#finance-payment-proof')) return;
  const label = document.createElement('label');
  label.className = 'form-full finance-payment-proof-field';
  label.innerHTML = '付款凭证（JPG、PNG、PDF，最大 10MB）<input name="paymentProof" id="finance-payment-proof" type="file" accept="image/jpeg,image/png,application/pdf">';
  const note = form.querySelector('textarea[name="note"]');
  const noteLabel = note?.closest('label');
  if (noteLabel) noteLabel.before(label); else form.querySelector('.dialog-actions')?.before(label);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!financeActiveClaim) return;
    const data = new FormData(form);
    const file = data.get('paymentProof');
    const hasPaymentProof = (financeActiveClaim.attachments || []).some(item => item.attachmentKind === 'PAYMENT_PROOF');
    if (file && file.size && !hasPaymentProof) {
      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) return toast('付款凭证只支持 JPG、PNG、PDF');
      if (file.size > 10 * 1024 * 1024) return toast('付款凭证不能超过 10MB');
      const upload = new FormData();
      upload.append('file', file);
      const uploadResponse = await fetch(`http://localhost:8080/api/v1/finance/expense-claims/${financeActiveClaim.claim.id}/payment-proof`, { method: 'POST', headers: adminHeaders(), body: upload });
      if (!uploadResponse.ok) return toast(`付款凭证上传失败：${await financeError(uploadResponse)}`);
      financeActiveClaim.attachments = [...(financeActiveClaim.attachments || []), await uploadResponse.json()];
    }
    const amount = Number(data.get('amount'));
    const response = await fetch(`http://localhost:8080/api/v1/finance/expense-claims/${financeActiveClaim.claim.id}/pay`, { method: 'POST', headers: adminJsonHeaders(), body: JSON.stringify({ amountCents: Math.round(amount * 100), paymentMethod: data.get('paymentMethod'), paymentDate: data.get('paymentDate'), paymentReference: data.get('paymentReference') || null, note: data.get('note') || null }) });
    if (!response.ok) return toast(`付款失败：${await financeError(response)}`);
    document.querySelector('#finance-payment-dialog').close();
    await loadFinanceClaims();
    toast('报销付款已确认');
  }, true);
})();

let financeExpenseCategories = [];
let financeEditingCategoryId = null;

function financeCategoryPolicy(item) {
  if (item.receiptRequired) return '必须提供票据';
  if (item.noReceiptAllowed) return '允许无票说明';
  return '票据可选';
}

function renderFinanceExpenseCategories() {
  const target = document.querySelector('#finance-category-records');
  if (!target) return;
  target.innerHTML = financeExpenseCategories.map(item => {
    const system = item.code === 'PENDING_FINANCE_CLASSIFICATION';
    return `<tr><td><b>${financeEscape(item.name)}</b><small class="muted-cell">${financeEscape(item.code)}</small></td><td>${financeEscape(item.parentName || '一级分类')}</td><td>${financeCategoryPolicy(item)}</td><td><span class="record-type ${item.active ? 'order' : 'consumption'}">${item.active ? '启用' : '已删除'}</span></td><td class="align-right">${system || !item.active ? '<span class="muted-cell">—</span>' : `<button class="record-delete edit-technician" type="button" data-finance-category-edit="${roomTransferEscape(item.id)}">编辑</button><button class="record-delete" type="button" data-finance-category-active="${roomTransferEscape(item.id)}" data-active="true">删除</button>`}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="table-empty">暂无报销类型</td></tr>';
}

async function loadFinanceExpenseCategories() {
  if (!hasAdminPermission('EXPENSE_CONFIG')) return;
  const response = await fetch('http://localhost:8080/api/v1/finance/expense-categories?includeInactive=true', { headers: adminHeaders() });
  if (!response.ok) throw new Error(await financeError(response));
  financeExpenseCategories = await response.json();
  renderFinanceExpenseCategories();
}

function financeCategoryOptions(selectedId = '') {
  return financeExpenseCategories.filter(item => item.active && item.code !== 'PENDING_FINANCE_CLASSIFICATION').map(item => `<option value="${roomTransferEscape(item.id)}"${item.id === selectedId ? ' selected' : ''}>${financeEscape(item.parentName ? `${item.parentName} / ${item.name}` : item.name)}</option>`).join('');
}

function syncFinanceReviewCategory() {
  const select = document.querySelector('#finance-review-category');
  if (!select || !financeActiveClaim) return;
  select.innerHTML = financeCategoryOptions(financeActiveClaim.claim.expenseCategoryId);
  if (!financeExpenseCategories.some(item => item.id === financeActiveClaim.claim.expenseCategoryId && item.active && item.code !== 'PENDING_FINANCE_CLASSIFICATION')) select.insertAdjacentHTML('afterbegin', `<option value="" selected>请选择正确的报销类型</option>`);
}

function openFinanceCategoryDialog(item = null) {
  financeEditingCategoryId = item?.id || null;
  const form = document.querySelector('#finance-category-form');
  form.reset();
  document.querySelector('#finance-category-dialog-title').textContent = item ? '编辑报销类型' : '新增报销类型';
  const parent = document.querySelector('#finance-category-parent');
  parent.innerHTML = '<option value="">作为一级分类</option>' + financeExpenseCategories.filter(row => row.active && row.categoryLevel === 1 && row.code !== 'PENDING_FINANCE_CLASSIFICATION' && row.id !== item?.id).map(row => `<option value="${roomTransferEscape(row.id)}">${financeEscape(row.name)}</option>`).join('');
  form.elements.name.value = item?.name || '';
  form.elements.parentId.value = item?.parentId || '';
  form.elements.receiptRequired.checked = item ? Boolean(item.receiptRequired) : true;
  form.elements.noReceiptAllowed.checked = item ? Boolean(item.noReceiptAllowed) : false;
  form.elements.sortOrder.value = item?.sortOrder ?? 100;
  document.querySelector('#finance-category-dialog').showModal();
}

(function setupFinanceExpenseCategoryManagement() {
  const financeView = document.querySelector('#finance-view');
  if (!financeView || document.querySelector('#finance-category-panel')) return;
  const claimPanel = financeView.querySelector('.finance-claim-panel');
  claimPanel.insertAdjacentHTML('afterend', `<section class="panel admin-table-panel finance-category-panel" id="finance-category-panel"><div class="admin-toolbar finance-toolbar"><div><h2>报销类型管理</h2><p>财务统一维护分类，店长不确定时可选择“待财务分类”</p></div><button class="button primary" id="finance-add-category" type="button">新增报销类型</button></div><div class="ledger-table-wrap"><table><thead><tr><th>类型名称</th><th>所属大类</th><th>票据要求</th><th>状态</th><th class="align-right">操作</th></tr></thead><tbody id="finance-category-records"><tr><td colspan="5" class="table-empty">登录财务账号后加载</td></tr></tbody></table></div></section>`);
  document.body.insertAdjacentHTML('beforeend', `<dialog id="finance-category-dialog"><form id="finance-category-form" class="dialog-card compact"><div class="dialog-heading"><div><p class="eyebrow">财务配置</p><h2 id="finance-category-dialog-title">新增报销类型</h2></div><button class="icon-button" type="button" id="close-finance-category" aria-label="关闭">×</button></div><div class="form-grid"><label class="form-full">类型名称<input name="name" maxlength="120" required placeholder="例如：员工临时采购" /></label><label class="form-full">所属大类<select name="parentId" id="finance-category-parent"></select></label><label>排序<input name="sortOrder" type="number" min="0" max="9999" value="100" required /></label><div class="finance-category-policy"><label><input name="receiptRequired" type="checkbox" checked /> 必须提供票据</label><label><input name="noReceiptAllowed" type="checkbox" /> 允许无票说明</label></div></div><div class="dialog-actions"><button class="button secondary" type="button" id="cancel-finance-category">取消</button><button class="button primary" type="submit">保存类型</button></div></form></dialog>`);
  const reviewActions = document.querySelector('#finance-review-actions');
  reviewActions.insertAdjacentHTML('afterbegin', `<div class="finance-review-category-row"><label>财务确认分类<select id="finance-review-category" aria-label="财务确认分类"></select></label><button class="button secondary" id="finance-review-add-category" type="button">新增类型</button></div>`);

  document.querySelector('#finance-add-category').addEventListener('click', () => openFinanceCategoryDialog());
  document.querySelector('#finance-review-add-category').addEventListener('click', () => openFinanceCategoryDialog());
  document.querySelector('#close-finance-category').addEventListener('click', () => document.querySelector('#finance-category-dialog').close());
  document.querySelector('#cancel-finance-category').addEventListener('click', () => document.querySelector('#finance-category-dialog').close());
  document.querySelector('#finance-category-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { parentId: form.get('parentId') || null, code: financeEditingCategoryId ? financeExpenseCategories.find(item => item.id === financeEditingCategoryId).code : `CUSTOM_${Date.now().toString(36).toUpperCase()}`, name: String(form.get('name')).trim(), receiptRequired: form.get('receiptRequired') === 'on', noReceiptAllowed: form.get('noReceiptAllowed') === 'on', sortOrder: Number(form.get('sortOrder')) };
    if (body.receiptRequired && body.noReceiptAllowed) return toast('必须提供票据与允许无票说明只能选择一项');
    const url = financeEditingCategoryId ? `http://localhost:8080/api/v1/finance/expense-categories/${financeEditingCategoryId}` : 'http://localhost:8080/api/v1/finance/expense-categories';
    const response = await fetch(url, { method: financeEditingCategoryId ? 'PUT' : 'POST', headers: adminJsonHeaders(), body: JSON.stringify(body) });
    if (!response.ok) return toast(`类型保存失败：${await financeError(response)}`);
    document.querySelector('#finance-category-dialog').close();
    await loadFinanceExpenseCategories();
    syncFinanceReviewCategory();
    toast('报销类型已保存');
  });
  document.querySelector('#finance-category-records').addEventListener('click', async event => {
    const edit = event.target.closest('[data-finance-category-edit]');
    if (edit) return openFinanceCategoryDialog(financeExpenseCategories.find(item => item.id === edit.dataset.financeCategoryEdit));
    const toggle = event.target.closest('[data-finance-category-active]');
    if (!toggle) return;
    if (!window.confirm('确认删除该报销类型？历史报销单会继续保留原分类。')) return;
    const response = await fetch(`http://localhost:8080/api/v1/finance/expense-categories/${toggle.dataset.financeCategoryActive}/active`, { method: 'PUT', headers: adminJsonHeaders(), body: JSON.stringify({ active: false }) });
    if (!response.ok) return toast(`类型状态更新失败：${await financeError(response)}`);
    await loadFinanceExpenseCategories();
    toast('报销类型已删除');
  });
  document.querySelector('[data-view="finance"]')?.addEventListener('click', () => loadFinanceExpenseCategories().catch(() => toast('报销类型加载失败')));
})();

const openFinanceReviewBeforeCategory = openFinanceReview;
openFinanceReview = async function (id) {
  if (!financeExpenseCategories.length) await loadFinanceExpenseCategories();
  await openFinanceReviewBeforeCategory(id);
  syncFinanceReviewCategory();
};

const financeReviewActionBeforeCategory = financeReviewAction;
financeReviewAction = async function (action) {
  if (!financeActiveClaim) return;
  const select = document.querySelector('#finance-review-category');
  const selectedCategoryId = select?.value;
  const currentCategory = financeExpenseCategories.find(item => item.id === financeActiveClaim.claim.expenseCategoryId);
  if (action === 'approve' && (!selectedCategoryId || currentCategory?.code === 'PENDING_FINANCE_CLASSIFICATION' && selectedCategoryId === financeActiveClaim.claim.expenseCategoryId)) return toast('请先为该报销选择正确类型');
  if (selectedCategoryId && selectedCategoryId !== financeActiveClaim.claim.expenseCategoryId) {
    const comment = document.querySelector('#finance-review-comment').value.trim();
    const response = await fetch(`http://localhost:8080/api/v1/finance/expense-claims/${financeActiveClaim.claim.id}/classify`, { method: 'POST', headers: adminJsonHeaders(), body: JSON.stringify({ categoryId: selectedCategoryId, comment: comment || null }) });
    if (!response.ok) return toast(`重新分类失败：${await financeError(response)}`);
    financeActiveClaim = await response.json();
  }
  return financeReviewActionBeforeCategory(action);
};
