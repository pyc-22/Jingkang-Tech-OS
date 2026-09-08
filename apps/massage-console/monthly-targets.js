(() => {
  const api = '/api/v1/monthly-targets';
  const nav = document.querySelector('nav');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  const money = cents => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
  const percent = value => `${Number(value || 0).toFixed(2)}%`;
  const monthValue = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; };
  let data = null;

  nav.insertAdjacentHTML('beforeend', '<button class="nav-item" data-view="monthly-targets"><span>目</span>月度目标</button>');
  document.querySelector('#management-view').insertAdjacentHTML('beforebegin', `
    <section class="view monthly-target-view hidden" id="monthly-target-view">
      <div class="page-heading monthly-target-heading"><div><p class="eyebrow">经营目标</p><h1>月度目标拆分</h1><p>门店目标统一沿用每日营业日报设置；项目与技师目标用于本月经营跟进。</p></div><div class="page-actions"><button class="button secondary" id="monthly-target-reload" type="button">刷新数据</button><button class="button primary" id="monthly-target-save" type="button">保存目标</button></div></div>
      <section class="panel monthly-target-query"><label>门店<select id="monthly-target-store"></select></label><label>目标月份<input id="monthly-target-month" type="month"></label><p>项目与技师的分配金额可分别逐步配置，单个维度合计不得超过门店月目标。</p></section>
      <section id="monthly-target-overview" class="monthly-target-overview"></section>
      <section class="panel monthly-target-allocation-panel"><div class="monthly-target-panel-heading"><div><p class="eyebrow">门店目标</p><h2>本月营业目标</h2></div><label>门店月目标（元）<input id="monthly-target-store-amount" type="number" min="0" step="0.01"></label></div><p class="monthly-target-note">当月净营业额按已结算订单实收减已完成退款统计，与经营日报和门店对比保持同一口径。</p></section>
      <div class="monthly-target-grid">
        <section class="panel monthly-target-allocation-panel"><div class="monthly-target-panel-heading"><div><p class="eyebrow">项目拆分</p><h2>项目月度目标</h2></div><span id="monthly-target-project-unallocated" class="monthly-target-unallocated"></span></div><div class="ledger-table-wrap"><table><thead><tr><th>项目</th><th>分类</th><th class="align-right">目标</th><th class="align-right">净业绩</th><th class="align-right">完成率</th></tr></thead><tbody id="monthly-target-projects"></tbody></table></div></section>
        <section class="panel monthly-target-allocation-panel"><div class="monthly-target-panel-heading"><div><p class="eyebrow">技师拆分</p><h2>技师月度目标</h2></div><span id="monthly-target-technician-unallocated" class="monthly-target-unallocated"></span></div><div class="ledger-table-wrap"><table><thead><tr><th>技师</th><th class="align-right">目标</th><th class="align-right">净业绩</th><th class="align-right">完成率</th></tr></thead><tbody id="monthly-target-technicians"></tbody></table></div></section>
      </div>
    </section>`);

  const view = document.querySelector('#monthly-target-view');
  const button = document.querySelector('[data-view="monthly-targets"]');
  const storeInput = document.querySelector('#monthly-target-store');
  const monthInput = document.querySelector('#monthly-target-month');
  const storeAmountInput = document.querySelector('#monthly-target-store-amount');
  monthInput.value = monthValue();

  const headers = json => storeContextHeaders(json);
  const selectedStore = () => storeInput.value || localStorage.getItem(currentStoreKey) || defaultStoreId;
  const canEdit = () => Boolean(data?.canConfigure);
  function renderStores() {
    storeInput.innerHTML = (selectableStores || []).map(store => `<option value="${store.id}">${escape(store.name)}</option>`).join('');
    storeInput.value = localStorage.getItem(currentStoreKey) || selectableStores?.[0]?.id || '';
  }
  function rateClass(value) { return Number(value || 0) >= 100 ? 'met' : Number(value || 0) >= 70 ? 'near' : ''; }
  function allocationInput(kind, id, cents) {
    return `<input class="monthly-target-input" data-target-${kind}="${id}" type="number" min="0" step="0.01" value="${(Number(cents || 0) / 100).toFixed(2)}" ${canEdit() ? '' : 'disabled'}>`;
  }
  function render(plan) {
    data = plan;
    renderStores();
    storeInput.value = selectedStore();
    monthInput.value = String(plan.targetMonth).slice(0, 7);
    storeAmountInput.value = (Number(plan.storeTargetCents || 0) / 100).toFixed(2);
    storeAmountInput.disabled = !canEdit();
    document.querySelector('#monthly-target-save').disabled = !canEdit();
    const remaining = Math.max(0, Number(plan.storeTargetCents || 0) - Number(plan.storeActualCents || 0));
    document.querySelector('#monthly-target-overview').innerHTML = [
      ['门店月目标', money(plan.storeTargetCents), '目标月份'], ['已结算营业额', money(plan.storeActualCents), '收银订单累计'], ['目标完成率', percent(plan.storeCompletionRate), `尚差 ${money(remaining)}`], ['项目已分配', money(plan.projectAllocatedCents), `未分配 ${money(plan.projectUnallocatedCents)}`], ['技师已分配', money(plan.technicianAllocatedCents), `未分配 ${money(plan.technicianUnallocatedCents)}`]
    ].map(([label, value, note]) => `<article><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
    document.querySelector('#monthly-target-project-unallocated').textContent = `未分配 ${money(plan.projectUnallocatedCents)}`;
    document.querySelector('#monthly-target-technician-unallocated').textContent = `未分配 ${money(plan.technicianUnallocatedCents)}`;
    document.querySelector('#monthly-target-projects').innerHTML = plan.projects.map(row => `<tr><td><b>${escape(row.projectName)}</b><small class="muted-cell">${escape(row.projectCode)}</small></td><td>${escape(row.category)}</td><td class="align-right">${allocationInput('project', row.projectId, row.targetCents)}</td><td class="align-right amount-cell">${money(row.actualCents)}</td><td class="align-right"><span class="monthly-target-rate ${rateClass(row.completionRate)}">${percent(row.completionRate)}</span></td></tr>`).join('') || '<tr><td colspan="5" class="table-empty">当前门店没有启用项目</td></tr>';
    document.querySelector('#monthly-target-technicians').innerHTML = plan.technicians.map(row => `<tr><td><b>${escape(row.technicianName)}</b><small class="muted-cell">${escape(row.technicianCode)}</small></td><td class="align-right">${allocationInput('technician', row.technicianId, row.targetCents)}</td><td class="align-right amount-cell">${money(row.actualCents)}</td><td class="align-right"><span class="monthly-target-rate ${rateClass(row.completionRate)}">${percent(row.completionRate)}</span></td></tr>`).join('') || '<tr><td colspan="4" class="table-empty">当前门店没有启用技师</td></tr>';
  }
  function targetRows(kind) {
    return [...view.querySelectorAll(`[data-target-${kind}]`)].map(input => {
      const yuan = Number(input.value || 0);
      if (!Number.isFinite(yuan) || yuan < 0) throw new Error('目标金额必须为非负数');
      return { id: input.dataset[`target${kind[0].toUpperCase()}${kind.slice(1)}`], targetCents: Math.round(yuan * 100) };
    });
  }
  async function load() {
    if (!localStorage.getItem(adminTokenKey)) { showAdminLogin(); return; }
    renderStores();
    const response = await fetch(`${api}?month=${encodeURIComponent(monthInput.value)}`, { headers: headers() });
    if (!response.ok) { toast(response.status === 403 ? '当前账号没有月度目标权限' : '月度目标数据加载失败'); return; }
    render(await response.json());
  }
  async function save() {
    if (!canEdit()) return;
    const yuan = Number(storeAmountInput.value || 0);
    if (!Number.isFinite(yuan) || yuan < 0) { toast('请填写有效的门店月目标'); return; }
    let projects; let technicians;
    try { projects = targetRows('project'); technicians = targetRows('technician'); }
    catch (error) { toast(error.message); return; }
    const response = await fetch(api, { method:'PUT', headers:headers(true), body:JSON.stringify({ targetMonth:`${monthInput.value}-01`, storeTargetCents:Math.round(yuan * 100), projects, technicians }) });
    if (!response.ok) { const message = (await response.text()).replace(/^"|"$/g, ''); toast(message || '月度目标保存失败'); return; }
    render(await response.json());
    toast('月度目标已保存');
  }
  function open() {
    if (button.hidden || !window.isAdminViewAllowed?.('monthly-targets')) { toast('当前账号没有月度目标权限'); return; }
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    document.querySelectorAll('.view').forEach(section => { if (section !== view) section.classList.add('hidden'); });
    view.classList.remove('hidden');
    load();
  }
  button.addEventListener('click', open);
  document.querySelectorAll('.nav-item[data-view]:not([data-view="monthly-targets"])').forEach(item => item.addEventListener('click', () => view.classList.add('hidden')));
  storeInput.addEventListener('change', () => { localStorage.setItem(currentStoreKey, selectedStore()); load(); });
  monthInput.addEventListener('change', load);
  document.querySelector('#monthly-target-reload').addEventListener('click', load);
  document.querySelector('#monthly-target-save').addEventListener('click', save);
  window.applyAdminPermissions?.();
})();
