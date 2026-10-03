(() => {
  const api = '/api/v1/admin/manager-rewards';
  const tokenKey = 'chengxin-admin-access-token';
  const permissionKey = 'chengxin-admin-permissions';
  const storeKey = 'chengxin-current-store-id';
  const state = {
    period: 'daily', loading: false, stores: [], storeId: '', daily: null, month: null,
    managers: [], records: [], attachmentUrl: null
  };
  const root = () => document.querySelector('#manager-rewards-admin-root');
  const $ = selector => root()?.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const money = cents => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  const month = () => today().slice(0, 7);
  const monthRange = value => {
    const [year, monthNumber] = String(value || month()).split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return { from: `${year}-${String(monthNumber).padStart(2, '0')}-01`, to: `${year}-${String(monthNumber).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` };
  };
  const rewardHeaders = (json = false) => ({
    Authorization: `Bearer ${localStorage.getItem(tokenKey) || ''}`,
    ...(json ? { 'Content-Type': 'application/json' } : {})
  });
  const storedList = key => { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
  const hasLockPermission = () => storedList('chengxin-admin-roles').includes('TENANT_ADMIN') || storedList(permissionKey).includes('MANAGER_REWARD_LOCK');
  const statusLabel = { PRESENT:'出勤', LATE:'迟到', COMPLETED:'已完成', LEFT_EARLY:'早退', NOT_REQUIRED:'管理岗无需打卡' };

  function ensureMarkup() {
    const target = root();
    if (!target || target.dataset.ready) return Boolean(target);
    target.dataset.ready = 'true';
    target.innerHTML = `
      <div class="manager-reward-admin-toolbar">
        <label>门店<select id="manager-reward-admin-store"></select></label>
        <label>营业日期<input id="manager-reward-admin-date" type="date"></label>
        <label>统计月份<input id="manager-reward-admin-month" type="month"></label>
        <div class="manager-reward-admin-tabs" role="tablist" aria-label="奖励统计周期">
          <button type="button" class="selected" data-admin-reward-period="daily">当日</button>
          <button type="button" data-admin-reward-period="monthly">月度</button>
        </div>
      </div>
      <div id="manager-reward-admin-summary" class="manager-reward-admin-summary"></div>
      <section id="manager-reward-admin-assignment" class="manager-reward-admin-panel"></section>
      <section class="manager-reward-admin-panel">
        <div class="manager-reward-admin-panel-heading"><div><h2>约客凭证</h2><p id="manager-reward-admin-yue-count">0 条记录</p></div></div>
        <div class="manager-reward-admin-table-wrap"><table><thead><tr><th>营业日</th><th>订单</th><th>客户</th><th>店长</th><th>提交时间</th><th>凭证</th><th>状态</th></tr></thead><tbody id="manager-reward-admin-yue-records"></tbody></table></div>
      </section>
      <section id="manager-reward-admin-month-panel" class="manager-reward-admin-panel" hidden>
        <div class="manager-reward-admin-panel-heading"><div><h2>月度逐日绩效</h2><p id="manager-reward-admin-month-note"></p></div><button type="button" class="button primary" id="manager-reward-admin-lock">锁定月结</button></div>
        <div class="manager-reward-admin-table-wrap"><table><thead><tr><th>日期</th><th>归属店长</th><th>考勤参考</th><th>现金流</th><th>约客</th><th>大项目</th><th>充卡</th><th>奖励</th></tr></thead><tbody id="manager-reward-admin-month-rows"></tbody></table></div>
      </section>
      <dialog id="manager-reward-admin-attachment-dialog"><div class="manager-reward-admin-attachment"><div class="manager-reward-admin-panel-heading"><h2>约客凭证</h2><button type="button" class="icon-button" data-reward-admin-close>×</button></div><img id="manager-reward-admin-attachment-image" alt="约客凭证"><p id="manager-reward-admin-attachment-note"></p></div></dialog>`;
    $('#manager-reward-admin-store')?.addEventListener('change', event => { state.storeId = event.target.value; localStorage.setItem(storeKey, state.storeId); load(); });
    $('#manager-reward-admin-date')?.addEventListener('change', load);
    $('#manager-reward-admin-month')?.addEventListener('change', load);
    $('#manager-reward-admin-lock')?.addEventListener('click', lockMonth);
    $('#manager-reward-admin-yue-records')?.addEventListener('click', event => {
      const button = event.target.closest('[data-reward-admin-attachment]');
      if (button) openAttachment(button.dataset.rewardAdminAttachment, button.dataset.original === 'true').catch(showError);
    });
    $('#manager-reward-admin-assignment')?.addEventListener('submit', assignManager);
    $('[data-reward-admin-close]')?.addEventListener('click', () => $('#manager-reward-admin-attachment-dialog')?.close());
    $('#manager-reward-admin-attachment-dialog')?.addEventListener('close', () => {
      if (state.attachmentUrl) URL.revokeObjectURL(state.attachmentUrl);
      state.attachmentUrl = null;
    });
    return true;
  }

  async function request(path, options = {}) {
    const response = await fetch(`${api}${path}`, { ...options, headers: { ...rewardHeaders(), ...(options.headers || {}) } });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).message || ''; } catch { /* response may be empty */ }
      throw new Error(detail || `HTTP_${response.status}`);
    }
    return response;
  }
  const json = async (path, options) => (await request(path, options)).json();
  function showError(error) {
    const target = $('#manager-reward-admin-summary');
    if (target) target.innerHTML = `<p class="table-empty">${escape(error?.message || '奖励数据加载失败')}</p>`;
  }
  function setDefaults() {
    const date = $('#manager-reward-admin-date');
    const monthInput = $('#manager-reward-admin-month');
    if (date && !date.value) date.value = today();
    if (monthInput && !monthInput.value) monthInput.value = month();
  }
  function renderStoreOptions() {
    const select = $('#manager-reward-admin-store');
    if (!select) return;
    const selected = state.storeId;
    select.innerHTML = state.stores.map(store => `<option value="${escape(store.id)}">${escape(store.name)}${store.code ? ` · ${escape(store.code)}` : ''}</option>`).join('');
    state.storeId = state.stores.some(store => store.id === selected) ? selected : state.stores[0]?.id || '';
    if (state.storeId) { select.value = state.storeId; localStorage.setItem(storeKey, state.storeId); }
  }
  async function loadStores() {
    if (state.stores.length) return;
    const response = await fetch('/api/v1/admin/access/my-stores', { headers: rewardHeaders() });
    if (!response.ok) throw new Error(`门店列表加载失败（HTTP_${response.status}）`);
    state.stores = await response.json();
    const remembered = localStorage.getItem(storeKey);
    state.storeId = state.stores.some(store => store.id === remembered) ? remembered : state.stores[0]?.id || '';
    renderStoreOptions();
  }
  function queryDate() { return encodeURIComponent($('#manager-reward-admin-date')?.value || today()); }
  function queryMonth() { return encodeURIComponent($('#manager-reward-admin-month')?.value || month()); }
  function renderPeriod() {
    document.querySelectorAll('[data-admin-reward-period]').forEach(button => button.classList.toggle('selected', button.dataset.adminRewardPeriod === state.period));
    const monthInput = $('#manager-reward-admin-month')?.closest('label');
    const dateInput = $('#manager-reward-admin-date')?.closest('label');
    if (monthInput) monthInput.hidden = state.period !== 'monthly';
    if (dateInput) dateInput.hidden = state.period === 'monthly';
    const monthPanel = $('#manager-reward-admin-month-panel');
    if (monthPanel) monthPanel.hidden = state.period !== 'monthly';
  }
  function metric(label, value, reward, tier) {
    return `<article><span>${label}</span><strong>${value}</strong><small>${escape(tier || '未达档')} · 奖励 ${money(reward)}</small></article>`;
  }
  function renderDaily(snapshot) {
    const target = $('#manager-reward-admin-summary');
    if (!target) return;
    target.innerHTML = [
      metric('现金流', money(snapshot.cashFlowCents), snapshot.cashFlowRewardCents, snapshot.cashFlowTierLabel),
      metric('约客', `${snapshot.yueCount || 0} 客`, snapshot.yueRewardCents, snapshot.yueTierLabel),
      metric('大项目（含加钟）', `${snapshot.bigProjectCount || 0} 项`, snapshot.bigProjectRewardCents, snapshot.bigProjectTierLabel),
      metric('充卡', `${snapshot.rechargeCount || 0} 张`, snapshot.rechargeRewardCents, snapshot.rechargeTierLabel),
      `<article class="total"><span>当日奖励合计</span><strong>${money(snapshot.totalRewardCents)}</strong><small>${snapshot.onDutyDay ? `归属店长：${escape(snapshot.managerName || '已归属')}` : '本店未配置有效店长或主店长'}</small></article>`
    ].join('');
    const status = document.querySelector('#manager-rewards-admin-status');
    if (status) status.textContent = `${snapshot.businessDate || ''} · ${snapshot.locked ? '月结已锁定' : '实时计算'}`;
  }
  function renderAssignment(snapshot) {
    const target = $('#manager-reward-admin-assignment');
    if (!target) return;
    const canAssign = hasLockPermission() && !snapshot.locked;
    target.innerHTML = `<div class="manager-reward-admin-panel-heading"><div><h2>当日店长归属</h2><p>${snapshot.onDutyDay ? `当前归属：${escape(snapshot.managerName || '—')} · ${escape(statusLabel[snapshot.attendanceStatus] || snapshot.attendanceStatus || '')}` : state.managers.length ? '多位店长时请设置主店长，特殊日期可单独覆盖' : '请先在门店/员工配置中为该门店指定店长并关联账号'}</p></div></div>${canAssign ? `<form><label>有效店长<select name="managerUserId" required>${state.managers.map(manager => `<option value="${escape(manager.userId)}" ${manager.userId === snapshot.managerUserId ? 'selected' : ''}>${escape(manager.name)}${manager.isPrimary ? ' · 主店长' : ''} · ${escape(statusLabel[manager.attendanceStatus] || manager.attendanceStatus || '')}</option>`).join('') || '<option value="">请先配置店长</option>'}</select></label><input name="note" maxlength="240" placeholder="归属备注（可选）"><button type="submit" class="button secondary" data-assignment-action="daily" ${state.managers.length ? '' : 'disabled'}>保存当日覆盖</button><button type="submit" class="button secondary" data-assignment-action="primary" ${state.managers.length ? '' : 'disabled'}>设为本店主店长</button></form>` : '<p class="manager-reward-admin-readonly">仅锁定权限账号可调整归属；已锁定月份的数据不可更改。</p>'}`;
  }
  function renderMonth(snapshot) {
    const target = $('#manager-reward-admin-month-rows');
    const note = $('#manager-reward-admin-month-note');
    if (note) note.textContent = `${snapshot.rewardMonth || ''} · 现金流 ${money(snapshot.cashFlowCents)} · 约客 ${snapshot.yueCount || 0} · 大项目 ${snapshot.bigProjectCount || 0} · 充卡 ${snapshot.rechargeCount || 0} · 奖励 ${money(snapshot.totalRewardCents)}${snapshot.locked ? ' · 已锁定' : ' · 实时计算'}`;
    if (target) target.innerHTML = (snapshot.rows || []).map(row => `<tr><td>${escape(row.businessDate)}</td><td>${escape(row.managerName || '未归属')}</td><td>${row.onDutyDay ? escape(statusLabel[row.attendanceStatus] || row.attendanceStatus || '管理岗无需打卡') : '不计入'}</td><td class="amount-cell">${money(row.cashFlowCents)}</td><td>${row.yueCount || 0}</td><td>${row.bigProjectCount || 0}</td><td>${row.rechargeCount || 0}</td><td class="amount-cell">${money(row.totalRewardCents)}</td></tr>`).join('') || '<tr><td colspan="8" class="table-empty">该月暂无奖励记录</td></tr>';
    const button = $('#manager-reward-admin-lock');
    if (button) { button.hidden = !hasLockPermission(); button.disabled = Boolean(snapshot.locked); button.textContent = snapshot.locked ? '月结已锁定' : '锁定月结'; }
  }
  function renderRecords(rows) {
    const target = $('#manager-reward-admin-yue-records');
    const count = $('#manager-reward-admin-yue-count');
    const active = (rows || []).filter(row => row.active);
    if (count) count.textContent = `${active.length} 条有效记录 · 共 ${(rows || []).length} 条`;
    if (!target) return;
     target.innerHTML = (rows || []).map(row => `<tr class="${row.active ? '' : 'is-inactive'}"><td>${escape(row.businessDate)}</td><td><b>${escape(row.orderNo || '订单')}</b></td><td>${escape(row.customerNameSnapshot || '散客')}<small>${escape(row.customerPhoneSnapshot || '')}</small></td><td>${escape(row.managerNameSnapshot || '—')}</td><td>${row.submittedAt ? new Date(row.submittedAt).toLocaleString('zh-CN') : '—'}</td><td>${row.attachmentId ? `<button type="button" class="text-button" data-reward-admin-attachment="${escape(row.id)}">水印图</button>${hasLockPermission() ? `<button type="button" class="text-button" data-reward-admin-attachment="${escape(row.id)}" data-original="true">原图</button>` : ''}` : '—'}</td><td>${row.submissionKind === 'BACKFILL' ? '<em class="backfill-badge">补录</em> ' : ''}${row.active ? '有效' : '已替换'}</td></tr>`).join('') || '<tr><td colspan="7" class="table-empty">暂无约客凭证</td></tr>';
  }
  async function loadDaily() {
    const date = $('#manager-reward-admin-date')?.value || today();
    const query = `?storeId=${encodeURIComponent(state.storeId)}&date=${encodeURIComponent(date)}`;
    const [snapshot, managers, records] = await Promise.all([
      json(`/daily${query}`), json(`/managers${query}`), json(`/yue/records?storeId=${encodeURIComponent(state.storeId)}&from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}&includeInactive=true`)
    ]);
    state.daily = snapshot; state.managers = managers; state.records = records;
    renderDaily(snapshot); renderAssignment(snapshot); renderRecords(records);
  }
  async function loadMonth() {
    const selectedMonth = $('#manager-reward-admin-month')?.value || month();
    const range = monthRange(selectedMonth);
    const [snapshot, records] = await Promise.all([
      json(`/month?storeId=${encodeURIComponent(state.storeId)}&month=${encodeURIComponent(selectedMonth)}`),
      json(`/yue/records?storeId=${encodeURIComponent(state.storeId)}&from=${range.from}&to=${range.to}&includeInactive=true`)
    ]);
    state.month = snapshot; state.records = records;
    renderMonth(snapshot); renderRecords(records);
    const status = document.querySelector('#manager-rewards-admin-status');
    if (status) status.textContent = `${snapshot.rewardMonth || selectedMonth} · ${snapshot.locked ? '月结已锁定' : '实时计算'}`;
  }
  async function assignManager(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const managerUserId = String(form.get('managerUserId') || '');
    if (!managerUserId) return;
    const button = event.submitter;
    if (button) button.disabled = true;
    try {
      const primary = button?.dataset.assignmentAction === 'primary';
      await request(primary ? '/primary-manager' : '/assignments', { method: primary ? 'PUT' : 'POST', headers: rewardHeaders(true), body: JSON.stringify(primary ? { storeId: state.storeId, managerUserId } : { storeId: state.storeId, date: $('#manager-reward-admin-date')?.value || today(), managerUserId, note: String(form.get('note') || '').trim() || null }) });
      await load();
    } catch (error) { showError(error); }
    finally { if (button) button.disabled = false; }
  }
  async function lockMonth() {
    const selectedMonth = $('#manager-reward-admin-month')?.value || month();
    if (!window.confirm(`确认锁定 ${selectedMonth} 月绩效？锁定后该月不再随数据变化。`)) return;
    try {
      await request('/month-lock', { method:'POST', headers: rewardHeaders(true), body: JSON.stringify({ storeId: state.storeId, month: selectedMonth }) });
      await load();
    } catch (error) { showError(error); }
  }
  async function openAttachment(id, original) {
    const dialog = $('#manager-reward-admin-attachment-dialog');
    const image = $('#manager-reward-admin-attachment-image');
    if (!dialog || !image) return;
    image.removeAttribute('src');
    $('#manager-reward-admin-attachment-note').textContent = original ? '原图审计查看' : '默认展示水印图';
    dialog.showModal();
    const response = await request(`/yue/${encodeURIComponent(id)}/attachment?storeId=${encodeURIComponent(state.storeId)}&original=${original}`);
    if (state.attachmentUrl) URL.revokeObjectURL(state.attachmentUrl);
    state.attachmentUrl = URL.createObjectURL(await response.blob());
    image.src = state.attachmentUrl;
  }
  async function load() {
    if (state.loading || !ensureMarkup() || !localStorage.getItem(tokenKey)) return;
    state.loading = true;
    try {
      setDefaults();
      await loadStores();
      if (!state.storeId) throw new Error('当前账号没有可查看的门店');
      renderPeriod();
      if (state.period === 'monthly') await loadMonth(); else await loadDaily();
    } catch (error) { showError(error); }
    finally { state.loading = false; }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-admin-reward-period]');
    if (!button) return;
    state.period = button.dataset.adminRewardPeriod === 'monthly' ? 'monthly' : 'daily';
    renderPeriod();
    load();
  });
  document.querySelector('#manager-rewards-admin-refresh')?.addEventListener('click', () => load());
  window.ManagerRewardsAdmin = { load };
})();
