(() => {
  const tokenKey = 'chengxin-admin-access-token';
  const rolesKey = 'chengxin-admin-roles';
  const permissionsKey = 'chengxin-admin-permissions';
  const state = { page: 0, size: 30, total: 0, totalPages: 0, options: null, loaded: false, sequence: 0 };
  const statusNames = { PENDING: '待处理', PROCESSING: '处理中', RESOLVED: '已解决' };
  const severityNames = { LOW: '低', MEDIUM: '中', HIGH: '高', CRITICAL: '严重' };
  const categoryNames = {
    AUTHENTICATION: '登录安全', AUTHORIZATION: '权限拦截', FINANCIAL: '资金风险',
    ACCESS_CONTROL: '账号权限', SYSTEM: '系统异常'
  };
  const ruleNames = {
    LOGIN_FAILURE_BURST: '连续登录失败', ACCESS_DENIED_BURST: '连续越权访问',
    LARGE_REFUND_CREATED: '大额退款申请', LARGE_MEMBER_RECHARGE: '大额会员充值',
    ROLE_PERMISSION_CHANGED: '角色权限发生修改', USER_ACCESS_CHANGED: '账号权限发生修改'
  };

  const parseStored = key => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
  const hasPermission = permission => parseStored(rolesKey).includes('TENANT_ADMIN') || parseStored(permissionsKey).includes(permission);
  const canView = () => Boolean(localStorage.getItem(tokenKey)) && hasPermission('ALERT_VIEW');
  const canHandle = () => Boolean(localStorage.getItem(tokenKey)) && hasPermission('ALERT_HANDLE');
  const canConfig = () => Boolean(localStorage.getItem(tokenKey)) && hasPermission('ALERT_CONFIG');
  const headers = json => ({ Authorization: `Bearer ${localStorage.getItem(tokenKey)}`, ...(json ? { 'Content-Type': 'application/json' } : {}) });
  const notify = message => typeof window.toast === 'function' ? window.toast(message) : undefined;
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const formatTime = value => value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)).replaceAll('/', '-') : '—';
  const compactId = value => value ? `${String(value).slice(0, 8)}…${String(value).slice(-4)}` : '—';
  const prettyJson = value => { if (!value) return '无'; try { return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2); } catch { return String(value); } };

  const nav = document.querySelector('.sidebar nav');
  const alertButton = document.createElement('button');
  alertButton.className = 'nav-item';
  alertButton.dataset.view = 'security-alerts';
  alertButton.hidden = true;
  alertButton.innerHTML = '<span>警</span>告警中心';
  nav.append(alertButton);

  document.querySelector('.workspace').insertAdjacentHTML('beforeend', `
    <section class="view security-alert-view hidden" id="security-alerts-view">
      <div class="page-heading security-alert-heading">
        <div><p class="eyebrow">风险监控</p><h1>告警中心</h1></div>
        <div class="page-actions"><button class="button secondary" type="button" id="security-alert-rules">规则设置</button><button class="button secondary" type="button" id="security-alert-refresh">刷新告警</button></div>
      </div>
      <div class="security-alert-metrics" aria-label="告警概览">
        <article class="security-alert-metric pending"><span>待处理告警</span><strong id="security-alert-pending">0</strong><small>需要门店或总部处理</small></article>
        <article class="security-alert-metric processing"><span>处理中告警</span><strong id="security-alert-processing">0</strong><small>已经认领核查</small></article>
        <article class="security-alert-metric critical"><span>严重 / 高风险</span><strong id="security-alert-high">0</strong><small>按当前可见范围统计</small></article>
        <article class="security-alert-metric"><span>当前筛选记录</span><strong id="security-alert-total">0</strong><small id="security-alert-page-count">本页 0 条</small></article>
      </div>
      <section class="panel security-alert-panel">
        <form id="security-alert-filter-form">
          <div class="security-alert-filters">
            <label class="security-alert-filter">门店<select id="security-alert-store" name="storeId"><option value="">全部可见门店</option></select></label>
            <label class="security-alert-filter">状态<select id="security-alert-status" name="status"><option value="">全部状态</option></select></label>
            <label class="security-alert-filter">级别<select id="security-alert-severity" name="severity"><option value="">全部级别</option></select></label>
            <label class="security-alert-filter">类型<select id="security-alert-category" name="category"><option value="">全部类型</option></select></label>
            <label class="security-alert-filter">规则<select id="security-alert-rule" name="ruleCode"><option value="">全部规则</option></select></label>
          </div>
          <div class="security-alert-filter-row">
            <label class="security-alert-search"><span>⌕</span><input id="security-alert-query" name="query" maxlength="120" placeholder="搜索告警标题、规则、门店或说明"></label>
            <div class="security-alert-filter-actions"><button class="button secondary" id="security-alert-reset" type="button">重置</button><button class="button primary" type="submit">查询</button></div>
          </div>
        </form>
        <div class="security-alert-table-wrap">
          <table class="security-alert-table">
            <thead><tr><th>最近触发</th><th>门店</th><th>告警内容</th><th>类型 / 规则</th><th>级别</th><th>状态</th><th>次数</th><th class="align-right">详情</th></tr></thead>
            <tbody id="security-alert-records"><tr><td colspan="8" class="table-empty">打开告警中心后加载</td></tr></tbody>
          </table>
        </div>
        <div class="security-alert-pagination">
          <span class="security-alert-pagination-info" id="security-alert-pagination-info">共 0 条记录</span>
          <div class="security-alert-pagination-actions"><button type="button" id="security-alert-first" title="第一页" aria-label="第一页">«</button><button type="button" id="security-alert-prev" title="上一页" aria-label="上一页">‹</button><span id="security-alert-page-label">第 0 / 0 页</span><button type="button" id="security-alert-next" title="下一页" aria-label="下一页">›</button><button type="button" id="security-alert-last" title="最后一页" aria-label="最后一页">»</button></div>
        </div>
      </section>
    </section>
    <dialog id="security-alert-detail-dialog"><div class="dialog-card security-alert-detail-dialog"><div class="dialog-heading"><div><p class="eyebrow">告警详情</p><h2 id="security-alert-detail-title">风险告警</h2></div><button class="icon-button" type="button" id="security-alert-detail-close" aria-label="关闭">×</button></div><div id="security-alert-detail-content"></div></div></dialog>
    <dialog id="security-alert-rules-dialog"><div class="dialog-card security-alert-detail-dialog"><div class="dialog-heading"><div><p class="eyebrow">规则配置</p><h2>告警规则</h2></div><button class="icon-button" type="button" id="security-alert-rules-close" aria-label="关闭">×</button></div><div id="security-alert-rules-content"></div></div></dialog>
  `);

  const elements = {
    view: document.querySelector('#security-alerts-view'), records: document.querySelector('#security-alert-records'),
    form: document.querySelector('#security-alert-filter-form'), store: document.querySelector('#security-alert-store'),
    status: document.querySelector('#security-alert-status'), severity: document.querySelector('#security-alert-severity'),
    category: document.querySelector('#security-alert-category'), rule: document.querySelector('#security-alert-rule'),
    query: document.querySelector('#security-alert-query')
  };

  function setOptions(select, values, placeholder, label, value = item => item) {
    const selected = select.value;
    select.innerHTML = `<option value="">${placeholder}</option>${values.map(item => `<option value="${escapeHtml(value(item))}">${escapeHtml(label(item))}</option>`).join('')}`;
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
  }

  function updateVisibility() {
    const hidden = !canView();
    alertButton.hidden = hidden;
    alertButton.setAttribute('aria-hidden', String(hidden));
    document.querySelector('#security-alert-rules').hidden = !canConfig();
    if (hidden && !elements.view.classList.contains('hidden')) document.querySelector('[data-view="frontdesk"]')?.click();
  }

  async function loadOptions() {
    const response = await fetch('/api/v1/security-alerts/options', { headers: headers() });
    if (!response.ok) throw new Error(response.status === 403 ? 'NO_PERMISSION' : 'OPTIONS_FAILED');
    state.options = await response.json();
    setOptions(elements.store, state.options.stores || [], '全部可见门店', item => `${item.name} · ${item.code}${item.active ? '' : '（已删除）'}`, item => item.id);
    setOptions(elements.status, state.options.statuses || [], '全部状态', item => statusNames[item] || item);
    setOptions(elements.severity, state.options.severities || [], '全部级别', item => severityNames[item] || item);
    const categories = [...new Set((state.options.rules || []).map(rule => rule.category).filter(Boolean))];
    setOptions(elements.category, categories, '全部类型', item => categoryNames[item] || item);
    setOptions(elements.rule, state.options.rules || [], '全部规则', item => `${ruleNames[item.code] || item.name || item.code}`, item => item.code);
  }

  function parameters(overrides = {}) {
    const form = new FormData(elements.form);
    const params = new URLSearchParams({ page: String(overrides.page ?? state.page), size: String(overrides.size ?? state.size) });
    for (const [key, value] of form.entries()) if (String(value).trim()) params.set(key, String(value).trim());
    for (const [key, value] of Object.entries(overrides)) if (!['page', 'size'].includes(key) && value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
    return params;
  }

  async function loadMetricTotal(overrides) {
    const response = await fetch(`/api/v1/security-alerts?${parameters({ ...overrides, page: 0, size: 1 })}`, { headers: headers() });
    if (!response.ok) return 0;
    const page = await response.json();
    return page.totalElements || 0;
  }

  async function loadMetrics() {
    const [pending, processing, high] = await Promise.all([
      loadMetricTotal({ status: 'PENDING' }), loadMetricTotal({ status: 'PROCESSING' }), loadMetricTotal({ severity: 'HIGH' })
    ]);
    const critical = await loadMetricTotal({ severity: 'CRITICAL' });
    document.querySelector('#security-alert-pending').textContent = pending;
    document.querySelector('#security-alert-processing').textContent = processing;
    document.querySelector('#security-alert-high').textContent = Number(high) + Number(critical);
  }

  function renderRows(items) {
    elements.records.innerHTML = items.map(item => {
      const status = item.status || 'PENDING';
      const severity = item.severity || 'LOW';
      return `<tr>
        <td class="security-alert-time"><b>${escapeHtml(formatTime(item.lastOccurredAt || item.createdAt))}</b><small>首次 ${escapeHtml(formatTime(item.firstOccurredAt))}</small></td>
        <td><b>${escapeHtml(item.storeName || '总部 / 系统')}</b><small>${escapeHtml(item.storeCode || '全局记录')}</small></td>
        <td class="security-alert-title"><b>${escapeHtml(item.title || ruleNames[item.ruleCode] || item.ruleCode)}</b><small>${escapeHtml(item.description || '无说明')}</small></td>
        <td><span class="security-alert-code">${escapeHtml(categoryNames[item.category] || item.category || '系统')}</span><small>${escapeHtml(ruleNames[item.ruleCode] || item.ruleName || item.ruleCode)}</small></td>
        <td><span class="security-alert-severity ${severity.toLowerCase()}">${escapeHtml(severityNames[severity] || severity)}</span></td>
        <td><span class="security-alert-status ${status.toLowerCase()}">${escapeHtml(statusNames[status] || status)}</span></td>
        <td><b>${escapeHtml(item.occurrenceCount || 0)}</b><small>风险分 ${escapeHtml(item.riskScore ?? '—')}</small></td>
        <td class="align-right"><button class="record-delete edit-technician" type="button" data-security-alert-detail="${escapeHtml(item.id)}">查看</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="table-empty">当前筛选条件下没有告警记录</td></tr>';
    document.querySelector('#security-alert-total').textContent = new Intl.NumberFormat('zh-CN').format(state.total);
    document.querySelector('#security-alert-page-count').textContent = `本页 ${items.length} 条`;
  }

  function renderPagination() {
    const current = state.totalPages ? state.page + 1 : 0;
    document.querySelector('#security-alert-pagination-info').textContent = `共 ${state.total} 条记录 · 每页 ${state.size} 条`;
    document.querySelector('#security-alert-page-label').textContent = `第 ${current} / ${state.totalPages} 页`;
    const first = state.page <= 0;
    const last = state.totalPages === 0 || state.page >= state.totalPages - 1;
    document.querySelector('#security-alert-first').disabled = first;
    document.querySelector('#security-alert-prev').disabled = first;
    document.querySelector('#security-alert-next').disabled = last;
    document.querySelector('#security-alert-last').disabled = last;
  }

  async function loadAlerts() {
    if (!canView()) return;
    const sequence = ++state.sequence;
    elements.records.innerHTML = '<tr><td colspan="8" class="table-empty">正在加载告警记录…</td></tr>';
    const response = await fetch(`/api/v1/security-alerts?${parameters()}`, { headers: headers() });
    if (sequence !== state.sequence) return;
    if (!response.ok) {
      elements.records.innerHTML = `<tr><td colspan="8" class="table-empty">${response.status === 403 ? '当前账号没有告警查看权限' : '告警记录加载失败'}</td></tr>`;
      return;
    }
    const page = await response.json();
    state.total = page.totalElements || 0;
    state.totalPages = page.totalPages || 0;
    if (state.page > 0 && state.page >= state.totalPages) { state.page = Math.max(0, state.totalPages - 1); return loadAlerts(); }
    renderRows(page.items || []);
    renderPagination();
    state.loaded = true;
    await loadMetrics();
  }

  function renderEvidence(rows) {
    return `<div class="security-alert-detail-table-wrap"><table class="security-alert-detail-table"><thead><tr><th>时间</th><th>动作</th><th>结果</th><th>人员 / IP</th><th>请求编号</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(formatTime(row.occurredAt))}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.result)}</td><td>${escapeHtml(row.actorNameSnapshot || '系统')}<small>${escapeHtml(row.ipAddress || '未记录')}</small></td><td>${escapeHtml(compactId(row.requestId))}</td></tr>`).join('') || '<tr><td colspan="5" class="table-empty">没有关联证据</td></tr>'}</tbody></table></div>`;
  }

  function renderHistory(rows) {
    return `<div class="security-alert-detail-table-wrap"><table class="security-alert-detail-table"><thead><tr><th>时间</th><th>动作</th><th>状态</th><th>处理人</th><th>说明</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(formatTime(row.createdAt))}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(statusNames[row.fromStatus] || row.fromStatus || '—')} → ${escapeHtml(statusNames[row.toStatus] || row.toStatus || '—')}</td><td>${escapeHtml(row.actorNameSnapshot || '系统')}</td><td>${escapeHtml(row.note || '—')}</td></tr>`).join('') || '<tr><td colspan="5" class="table-empty">没有处理记录</td></tr>'}</tbody></table></div>`;
  }

  async function openDetail(id) {
    const response = await fetch(`/api/v1/security-alerts/${encodeURIComponent(id)}`, { headers: headers() });
    if (!response.ok) return notify(response.status === 404 ? '该告警不在当前账号查看范围内' : '告警详情加载失败');
    const detail = await response.json();
    const item = detail.alert;
    document.querySelector('#security-alert-detail-title').textContent = item.title || '风险告警';
    document.querySelector('#security-alert-detail-content').innerHTML = `<div class="security-alert-detail">
      <div class="security-alert-detail-meta">
        <div><span>门店</span><b>${escapeHtml(item.storeName || '总部 / 系统')}</b><small>${escapeHtml(item.storeCode || '全局记录')}</small></div>
        <div><span>规则</span><b>${escapeHtml(ruleNames[item.ruleCode] || item.ruleName || item.ruleCode)}</b><small>${escapeHtml(categoryNames[item.category] || item.category)}</small></div>
        <div><span>级别</span><b>${escapeHtml(severityNames[item.severity] || item.severity)}</b><small>风险分 ${escapeHtml(item.riskScore ?? '—')}</small></div>
        <div><span>状态</span><b>${escapeHtml(statusNames[item.status] || item.status)}</b><small>${escapeHtml(item.occurrenceCount || 0)} 次触发</small></div>
        <div><span>首次触发</span><b>${escapeHtml(formatTime(item.firstOccurredAt))}</b></div>
        <div><span>最近触发</span><b>${escapeHtml(formatTime(item.lastOccurredAt))}</b></div>
        <div><span>处理人</span><b>${escapeHtml(item.handledByName || item.assignedToName || '未处理')}</b><small>${escapeHtml(formatTime(item.handledAt))}</small></div>
        <div><span>告警编号</span><b title="${escapeHtml(item.id)}">${escapeHtml(compactId(item.id))}</b></div>
      </div>
      ${canHandle() ? `<form class="security-alert-status-form" data-security-alert-status-form="${escapeHtml(item.id)}"><label>处理状态<select name="status"><option value="PENDING">待处理</option><option value="PROCESSING">处理中</option><option value="RESOLVED">已解决</option></select></label><label>处理说明<textarea name="note" maxlength="500" placeholder="填写处理说明，解决时建议说明原因和结果"></textarea></label><button class="button primary" type="submit">保存处理</button></form>` : ''}
      <section class="security-alert-detail-block"><h3>告警说明</h3><pre>${escapeHtml(item.description || '无说明')}</pre></section>
      <section class="security-alert-detail-block"><h3>触发证据</h3>${renderEvidence(detail.evidence || [])}</section>
      <section class="security-alert-detail-block"><h3>处理记录</h3>${renderHistory(detail.history || [])}</section>
      <section class="security-alert-detail-block"><h3>规则上下文</h3><pre>${escapeHtml(prettyJson(detail.contextData))}</pre></section>
    </div>`;
    const form = document.querySelector('[data-security-alert-status-form]');
    if (form) form.status.value = item.status;
    document.querySelector('#security-alert-detail-dialog').showModal();
  }

  async function saveStatus(form) {
    const id = form.dataset.securityAlertStatusForm;
    const response = await fetch(`/api/v1/security-alerts/${encodeURIComponent(id)}/status`, {
      method: 'POST', headers: headers(true), body: JSON.stringify({ status: form.status.value, note: form.note.value.trim() })
    });
    if (!response.ok) return notify(response.status === 403 ? '当前账号没有告警处理权限' : '告警处理保存失败');
    notify('告警处理状态已保存');
    document.querySelector('#security-alert-detail-dialog').close();
    await loadAlerts();
  }

  async function openRules() {
    if (!canConfig()) return notify('当前账号没有告警规则配置权限');
    const content = document.querySelector('#security-alert-rules-content');
    content.innerHTML = '<div class="table-empty">正在加载告警规则…</div>';
    document.querySelector('#security-alert-rules-dialog').showModal();
    const response = await fetch('/api/v1/security-alerts/rules', { headers: headers() });
    if (!response.ok) { content.innerHTML = '<div class="table-empty">告警规则加载失败</div>'; return; }
    const rules = await response.json();
    content.innerHTML = `<div class="security-alert-detail-table-wrap"><table class="security-alert-detail-table"><thead><tr><th>规则</th><th>类型</th><th>触发动作</th><th>阈值</th><th>级别</th><th>状态</th></tr></thead><tbody>${rules.map(rule => `<tr><td><b>${escapeHtml(ruleNames[rule.code] || rule.name)}</b><small>${escapeHtml(rule.code)}</small></td><td>${escapeHtml(categoryNames[rule.category] || rule.category)}</td><td>${escapeHtml(rule.triggerAction)}<small>${escapeHtml(rule.triggerResult || '全部结果')}</small></td><td>${escapeHtml(rule.thresholdCount)} 次 / ${escapeHtml(rule.windowMinutes)} 分钟</td><td>${escapeHtml(severityNames[rule.severity] || rule.severity)}</td><td>${rule.active ? '启用' : '已删除'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function enterAlertView() {
    if (!canView()) return notify('当前账号没有告警查看权限');
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    alertButton.classList.add('active');
    document.querySelectorAll('.workspace > .view').forEach(view => view.classList.add('hidden'));
    elements.view.classList.remove('hidden');
    document.body.classList.add('audit-mode');
    if (!state.options) {
      try { await loadOptions(); } catch (error) { return notify(error.message === 'NO_PERMISSION' ? '当前账号没有告警查看权限' : '告警筛选项加载失败'); }
    }
    await loadAlerts();
  }

  alertButton.addEventListener('click', enterAlertView);
  document.querySelectorAll('.nav-item[data-view]:not([data-view="security-alerts"])').forEach(button => button.addEventListener('click', () => { elements.view.classList.add('hidden'); document.body.classList.remove('audit-mode'); }));
  elements.form.addEventListener('submit', event => { event.preventDefault(); state.page = 0; loadAlerts(); });
  document.querySelector('#security-alert-reset').addEventListener('click', () => { elements.form.reset(); state.page = 0; loadAlerts(); });
  document.querySelector('#security-alert-refresh').addEventListener('click', async () => { state.options = null; await loadOptions(); await loadAlerts(); notify('告警记录已刷新'); });
  document.querySelector('#security-alert-rules').addEventListener('click', openRules);
  document.querySelector('#security-alert-records').addEventListener('click', event => { const button = event.target.closest('[data-security-alert-detail]'); if (button) openDetail(button.dataset.securityAlertDetail); });
  document.querySelector('#security-alert-detail-content').addEventListener('submit', event => { const form = event.target.closest('[data-security-alert-status-form]'); if (!form) return; event.preventDefault(); saveStatus(form); });
  document.querySelector('#security-alert-detail-close').addEventListener('click', () => document.querySelector('#security-alert-detail-dialog').close());
  document.querySelector('#security-alert-rules-close').addEventListener('click', () => document.querySelector('#security-alert-rules-dialog').close());
  document.querySelector('#security-alert-first').addEventListener('click', () => { state.page = 0; loadAlerts(); });
  document.querySelector('#security-alert-prev').addEventListener('click', () => { state.page = Math.max(0, state.page - 1); loadAlerts(); });
  document.querySelector('#security-alert-next').addEventListener('click', () => { if (state.page + 1 < state.totalPages) { state.page += 1; loadAlerts(); } });
  document.querySelector('#security-alert-last').addEventListener('click', () => { if (state.totalPages) { state.page = state.totalPages - 1; loadAlerts(); } });
  elements.query.addEventListener('keydown', event => { if (event.key === 'Escape') { elements.query.value = ''; state.page = 0; loadAlerts(); } });
  document.addEventListener('click', () => queueMicrotask(updateVisibility));
  window.addEventListener('focus', updateVisibility);
  updateVisibility();
})();
