(() => {
  const api = '/api/v1/manager-rewards';
  const tokenKey = 'chengxin-manager-mobile-access-token';
  const storeKey = 'chengxin-manager-mobile-store-id';
  const state = { period: 'daily', loading: false, daily: null, month: null, orders: [], records: [], fileUrl: null, attachmentUrl: null };
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const money = cents => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  const currentMonth = () => today().slice(0, 7);
  const toast = message => { const target = $('#manager-toast'); if (target) { target.textContent = message; target.classList.remove('hidden'); window.setTimeout(() => target.classList.add('hidden'), 2600); } };
  const headers = () => ({ Authorization:`Bearer ${localStorage.getItem(tokenKey) || ''}`, 'X-Store-Id':localStorage.getItem(storeKey) || '' });

  async function request(path, options = {}) {
    const response = await fetch(`${api}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
    if (response.status === 401 || response.status === 403) {
      document.querySelector('#manager-logout')?.click();
      throw new Error(response.status === 401 ? '登录已失效，请重新登录' : '当前账号没有奖励权限');
    }
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).message || ''; } catch { /* text is optional */ }
      throw new Error(detail || `HTTP_${response.status}`);
    }
    return response;
  }
  async function json(path) { return (await request(path)).json(); }
  function setDefaults() {
    const date = $('#manager-reward-date');
    const month = $('#manager-reward-month');
    if (date && !date.value) date.value = today();
    if (month && !month.value) month.value = currentMonth();
  }
  function renderCards(snapshot) {
    const target = $('#manager-reward-summary');
    if (!target || !snapshot) return;
    const rows = [
      ['现金流', money(snapshot.cashFlowCents), snapshot.cashFlowRewardCents, snapshot.cashFlowTierLabel],
      ['约客', `${snapshot.yueCount || 0} 客`, snapshot.yueRewardCents, snapshot.yueTierLabel],
      ['大项目（含加钟）', `${snapshot.bigProjectCount || 0} 项`, snapshot.bigProjectRewardCents, snapshot.bigProjectTierLabel],
      ['充卡', `${snapshot.rechargeCount || 0} 张`, snapshot.rechargeRewardCents, snapshot.rechargeTierLabel]
    ];
    target.innerHTML = rows.map(row => `<article class="manager-reward-card"><span>${row[0]}</span><strong>${row[1]}</strong><small>${escape(row[3] || '未达档')} · 奖励 ${money(row[2])}</small></article>`).join('') + `<article class="manager-reward-card total"><span>今日奖励合计</span><strong>${money(snapshot.totalRewardCents)}</strong><small>${snapshot.onDutyDay ? `归属店长：${escape(snapshot.managerName || '已归属')}` : '联系管理员为本店配置店长'}</small></article>`;
    const status = $('#manager-rewards-status');
    if (status) status.textContent = `${snapshot.businessDate || ''} · ${snapshot.locked ? '月结已锁定' : '实时计算'}`;
  }
  function renderMonth(snapshot) {
    const target = $('#manager-reward-month-rows');
    if (!target || !snapshot) return;
    const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    target.innerHTML = `<div class="manager-reward-month-summary"><b>${escape(snapshot.rewardMonth || '')}</b><span>现金流 ${money(snapshot.cashFlowCents)}</span><span>约客 ${snapshot.yueCount || 0} · 大项目 ${snapshot.bigProjectCount || 0} · 充卡 ${snapshot.rechargeCount || 0}</span><strong>奖励 ${money(snapshot.totalRewardCents)}</strong></div><div class="manager-reward-day-list">${rows.map(row => `<article><div><b>${escape(row.businessDate)}</b><small>${escape(row.managerName || '未归属')} · ${row.onDutyDay ? escape(row.attendanceStatus === 'NOT_REQUIRED' ? '管理岗无需打卡' : row.attendanceStatus || '管理岗无需打卡') : '不计入'}</small></div><span>现金 ${money(row.cashFlowCents)}<br>约客 ${row.yueCount || 0} · 大项目 ${row.bigProjectCount || 0} · 充卡 ${row.rechargeCount || 0}</span><strong>${money(row.totalRewardCents)}</strong></article>`).join('') || '<p class="comparison-empty">该月暂无奖励记录</p>'}</div>`;
  }
  function renderOrders(rows) {
    const select = $('#manager-reward-order');
    if (!select) return;
    select.innerHTML = '<option value="">选择今日订单</option>' + (Array.isArray(rows) ? rows : []).map(row => `<option value="${escape(row.orderId)}" ${row.submitted ? 'disabled' : ''}>${escape(row.orderNo || '订单')} · ${escape(row.memberName || '散客')} · ${money(row.paidCents)}${row.submitted ? ' · 已提交' : ''}</option>`).join('');
  }
  function ensureCorrectionDialog() {
    if ($('#manager-reward-correction-dialog')) return;
    document.body.insertAdjacentHTML('beforeend', '<dialog id="manager-reward-correction-dialog"><form id="manager-reward-correction-form" class="manager-reward-correction-card"><div class="manager-reward-subheading"><b>当天更正约客</b><button type="button" class="manager-quiet-button" id="manager-reward-correction-close">关闭</button></div><p id="manager-reward-correction-summary"></p><label>更正订单<select name="orderId" id="manager-reward-correction-order" required></select></label><label>客户姓名<input name="customerName" maxlength="120" placeholder="散客可留空"></label><label>客户手机号<input name="customerPhone" maxlength="40" inputmode="tel"></label><label>更正备注<textarea name="note" maxlength="240" rows="3" required placeholder="说明选错订单或凭证原因"></textarea></label><label>替换凭证（可选）<input name="file" type="file" accept="image/jpeg,image/png"><small>不选则保留原凭证</small></label><div class="manager-reward-dialog-actions"><button type="button" class="manager-secondary-button" id="manager-reward-correction-cancel">取消</button><button type="submit" class="manager-primary-button">保存更正</button></div></form></dialog>');
    $('#manager-reward-correction-close')?.addEventListener('click', () => $('#manager-reward-correction-dialog')?.close());
    $('#manager-reward-correction-cancel')?.addEventListener('click', () => $('#manager-reward-correction-dialog')?.close());
    $('#manager-reward-correction-form')?.addEventListener('submit', submitCorrection);
  }
  function openCorrection(row) {
    ensureCorrectionDialog();
    const form = $('#manager-reward-correction-form');
    const select = $('#manager-reward-correction-order');
    if (!form || !select) return;
    form.dataset.id = row.id;
    select.innerHTML = (state.orders || []).map(order => {
      const taken = order.submitted && order.orderId !== row.orderId;
      return `<option value="${escape(order.orderId)}" ${order.orderId === row.orderId ? 'selected' : ''} ${taken ? 'disabled' : ''}>${escape(order.orderNo || '订单')} · ${escape(order.memberName || '散客')} · ${money(order.paidCents)}${taken ? ' · 已提交' : ''}</option>`;
    }).join('');
    form.customerName.value = row.customerNameSnapshot || '';
    form.customerPhone.value = row.customerPhoneSnapshot || '';
    form.note.value = '';
    $('#manager-reward-correction-summary').textContent = `${row.orderNo || '订单'} · 原记录可在当天原地更正并留痕`;
    $('#manager-reward-correction-dialog').showModal();
  }
  async function submitCorrection(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!String(data.get('note') || '').trim()) return toast('请填写更正备注');
    const button = form.querySelector('button[type="submit"]'); if (button) button.disabled = true;
    try { await request(`/yue/${encodeURIComponent(form.dataset.id)}`, { method:'PUT', body:data }); $('#manager-reward-correction-dialog').close(); toast('约客记录已更正'); await loadDaily(); }
    catch (error) { toast(error.message || '约客记录更正失败'); }
    finally { if (button) button.disabled = false; }
  }
  function renderRecords(rows) {
    const target = $('#manager-reward-yue-records');
    const count = $('#manager-reward-yue-count');
    const active = (rows || []).filter(row => row.active);
    if (count) count.textContent = `${active.length} 条`;
    if (!target) return;
    const canCorrect = Boolean(state.daily && state.daily.businessDate === today() && !state.daily.locked && state.daily.onDutyDay);
    target.innerHTML = active.map(row => `<article><div><b>${escape(row.orderNo || '订单')}</b><small>${escape(row.customerNameSnapshot || '散客')} ${row.customerPhoneSnapshot ? `· ${escape(row.customerPhoneSnapshot)}` : ''} · ${escape(row.managerNameSnapshot || '')}</small><small>${row.submittedAt ? new Date(row.submittedAt).toLocaleString('zh-CN') : ''}</small></div><span>${canCorrect ? `<button type="button" class="manager-secondary-button" data-reward-correction="${escape(row.id)}">当天更正</button>` : ''}<button type="button" class="manager-secondary-button" data-reward-attachment="${escape(row.id)}" ${row.attachmentId ? '' : 'disabled'}>查看水印图</button></span></article>`).join('') || '<p class="comparison-empty">今日还没有约客凭证</p>';
  }
  function ensureAttachmentDialog() {
    if ($('#manager-reward-attachment-dialog')) return;
    document.body.insertAdjacentHTML('beforeend', '<dialog id="manager-reward-attachment-dialog"><div class="manager-reward-attachment-card"><div class="manager-reward-subheading"><b>约客凭证</b><button type="button" class="manager-quiet-button" id="manager-reward-attachment-close">关闭</button></div><img id="manager-reward-attachment-image" alt="约客水印凭证"><p id="manager-reward-attachment-note"></p></div></dialog>');
    $('#manager-reward-attachment-close')?.addEventListener('click', () => $('#manager-reward-attachment-dialog')?.close());
    $('#manager-reward-attachment-dialog')?.addEventListener('close', () => { if (state.attachmentUrl) URL.revokeObjectURL(state.attachmentUrl); state.attachmentUrl = null; });
  }
  async function openAttachment(id) {
    ensureAttachmentDialog();
    const dialog = $('#manager-reward-attachment-dialog');
    const image = $('#manager-reward-attachment-image');
    if (!dialog || !image) return;
    image.removeAttribute('src');
    $('#manager-reward-attachment-note').textContent = '正在加载水印图…';
    dialog.showModal();
    const response = await request(`/yue/${encodeURIComponent(id)}/attachment`);
    const blob = await response.blob();
    if (state.attachmentUrl) URL.revokeObjectURL(state.attachmentUrl);
    state.attachmentUrl = URL.createObjectURL(blob);
    image.src = state.attachmentUrl;
    $('#manager-reward-attachment-note').textContent = '默认展示水印图，原图仅限管理端审计查看。';
  }
  async function loadDaily() {
    const date = $('#manager-reward-date')?.value || today();
    const query = `?date=${encodeURIComponent(date)}`;
    const [snapshot, orders, records] = await Promise.all([json(`/daily${query}`), json(`/yue/orders${query}`), json(`/yue/records${query}`)]);
    state.daily = snapshot; state.orders = orders; state.records = records;
    renderCards(snapshot); renderOrders(orders); renderRecords(records);
  }
  async function loadMonth() {
    const month = $('#manager-reward-month')?.value || currentMonth();
    const snapshot = await json(`/month?month=${encodeURIComponent(month)}`);
    state.month = snapshot; renderMonth(snapshot);
    const status = $('#manager-rewards-status');
    if (status) status.textContent = `${snapshot.rewardMonth || month} · ${snapshot.locked ? '月结已锁定' : '实时计算'}`;
  }
  async function load() {
    if (state.loading || $('#manager-rewards-section')?.hidden || !localStorage.getItem(tokenKey) || !localStorage.getItem(storeKey)) return;
    state.loading = true;
    try {
      setDefaults();
      if (state.period === 'monthly') await loadMonth(); else await loadDaily();
    } catch (error) { toast(error.message || '奖励数据加载失败'); }
    finally { state.loading = false; }
  }
  function setPeriod(period) {
    state.period = period === 'monthly' ? 'monthly' : 'daily';
    document.querySelectorAll('[data-reward-period]').forEach(button => button.classList.toggle('selected', button.dataset.rewardPeriod === state.period));
    document.querySelectorAll('[data-reward-filter]').forEach(element => { element.hidden = element.dataset.rewardFilter !== state.period; });
    const summary = $('#manager-reward-summary');
    const monthRows = $('#manager-reward-month-rows');
    const yue = document.querySelector('.manager-reward-yue');
    if (summary) summary.hidden = state.period === 'monthly';
    if (monthRows) monthRows.hidden = state.period !== 'monthly';
    if (yue) yue.hidden = state.period !== 'daily';
    load();
  }
  $('#manager-reward-tabs')?.addEventListener('click', event => { const button = event.target.closest('[data-reward-period]'); if (button) setPeriod(button.dataset.rewardPeriod); });
  $('#manager-reward-date')?.addEventListener('change', load);
  $('#manager-reward-month')?.addEventListener('change', load);
  $('#manager-rewards-refresh')?.addEventListener('click', load);
  $('#manager-reward-yue-records')?.addEventListener('click', event => { const correction = event.target.closest('[data-reward-correction]'); if (correction) { const row = state.records.find(item => item.id === correction.dataset.rewardCorrection); if (row) openCorrection(row); return; } const button = event.target.closest('[data-reward-attachment]'); if (button) openAttachment(button.dataset.rewardAttachment).catch(error => toast(error.message || '凭证加载失败')); });
  $('#manager-reward-file')?.addEventListener('change', event => { const file = event.target.files?.[0]; const preview = $('#manager-reward-file-preview'); if (state.fileUrl) URL.revokeObjectURL(state.fileUrl); state.fileUrl = null; if (!preview || !file) { if (preview) preview.hidden = true; return; } state.fileUrl = URL.createObjectURL(file); preview.innerHTML = `<img src="${state.fileUrl}" alt="待上传凭证预览"><span>${escape(file.name)}</span>`; preview.hidden = false; });
  $('#manager-reward-yue-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const orderId = $('#manager-reward-order')?.value; const file = $('#manager-reward-file')?.files?.[0];
    if (!orderId || !file) return toast('请选择订单并上传截图');
    const form = new FormData(); form.append('orderId', orderId); form.append('file', file);
    const button = event.currentTarget.querySelector('button[type="submit"]'); if (button) button.disabled = true;
    try { await request('/yue', { method:'POST', body:form }); event.currentTarget.reset(); const preview = $('#manager-reward-file-preview'); if (preview) preview.hidden = true; toast('约客凭证已提交'); await loadDaily(); }
    catch (error) { toast(error.message || '约客凭证提交失败'); }
    finally { if (button) button.disabled = false; }
  });
  window.ManagerRewards = { load, setPeriod };
  setDefaults();
  if (!$('#manager-dashboard')?.classList.contains('hidden') && !$('#manager-rewards-section')?.hidden) load();
})();
