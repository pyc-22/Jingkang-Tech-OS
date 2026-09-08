(() => {
  const tokenKey = 'chengxin-admin-access-token';
  const rolesKey = 'chengxin-admin-roles';
  const permissionsKey = 'chengxin-admin-permissions';
  const state = { page: 0, size: 30, total: 0, totalPages: 0, options: null, loaded: false, sequence: 0 };
  const moduleNames = {
    ACCESS: '门店与权限', FOUNDATION: '基础资料', ROOM: '房间管理', SERVICE: '服务管理',
    SALES: '订单收银', REFUND: '退款管理', PAYMENT: '收款设置', CASHIER: '收银交班',
    MEMBER: '会员管理', SCHEDULE: '排班请假', DAILY_REPORT: '营业日报', COMMISSION: '提成管理',
    PRINT: '打印设置', ALERT: '告警中心', SYSTEM: '系统'
  };
  const actionNames = {
    TECHNICIAN_CREATED: '新增技师', TECHNICIAN_UPDATED: '修改技师资料', TECHNICIAN_ENABLED: '启用技师',
    TECHNICIAN_DISABLED: '删除技师', TECHNICIAN_REORDERED: '调整技师排序', SERVICE_ITEM_CREATED: '新增项目',
    SERVICE_ITEM_UPDATED: '修改项目', SERVICE_ITEM_ENABLED: '启用项目', SERVICE_ITEM_DISABLED: '删除项目',
    ROOM_CREATED: '新增房间', ROOM_UPDATED: '修改房间', ROOM_ENABLED: '启用房间', ROOM_DISABLED: '删除房间',
    ROOM_STATUS_CHANGED: '修改房间状态', ROOM_PAYMENT_CONFIRMED: '确认房间付款', ROOM_CLEANING_COMPLETED: '完成房间清洁',
    SERVICE_CLOCKED_IN: '前台安排上钟', SERVICE_CLOCKED_OUT: '前台确认下钟', MOBILE_SERVICE_CLOCKED_IN: '技师手机上钟',
    MOBILE_SERVICE_CLOCKED_OUT: '技师手机下钟', MOBILE_SERVICE_EXTENDED: '技师手机加钟', MOBILE_DISPATCH_CONFIRMED: '技师确认接单',
    MEMBER_CREATED: '会员开户', MEMBER_RECHARGED: '会员充值', ORDER_SETTLED: '订单结算', REFUND_CREATED: '创建退款',
    REFUND_PAYMENT_COMPLETED: '确认退款到账', REFUND_CANCELLED: '取消退款', CASHIER_SHIFT_OPENED: '收银开班',
    CASHIER_SHIFT_CLOSED: '收银交班', STORE_CREATED: '新增门店', STORE_ONBOARDED: '开通门店', STORE_UPDATED: '修改门店',
    STORE_ENABLED: '启用门店', STORE_DISABLED: '删除门店', ROLE_PERMISSIONS_UPDATED: '修改角色权限', USER_CREATED: '新增管理账号',
    USER_ACCESS_UPDATED: '修改账号权限', USER_ENABLED: '启用账号', USER_DISABLED: '删除账号',
    TECHNICIAN_ACCOUNT_CREATED: '创建技师账号', TECHNICIAN_PASSWORD_RESET: '重置技师密码',
    TECHNICIAN_ACCOUNT_ENABLED: '启用技师账号', TECHNICIAN_ACCOUNT_DISABLED: '删除技师账号',
    SCHEDULE_CREATED: '新增排班', SCHEDULE_UPDATED: '修改排班', SCHEDULE_CANCELLED: '取消排班',
    LEAVE_REQUEST_CREATED: '登记请假', LEAVE_REQUEST_REVIEWED: '审批请假', TECHNICIAN_LEAVE_REQUESTED: '技师提交请假',
    DAILY_REPORT_SETTINGS_UPDATED: '修改日报设置', DAILY_REPORT_CREATED: '创建营业日报', DAILY_REPORT_SAVED: '保存营业日报',
    DAILY_REPORT_PUBLISHED: '发布营业日报', PAYMENT_METHOD_CREATED: '新增收款方式', PAYMENT_METHOD_UPDATED: '修改收款方式',
    PAYMENT_METHOD_ENABLED: '启用收款方式', PAYMENT_METHOD_DISABLED: '删除收款方式', SECURITY_ALERT_STATUS_CHANGED: '处理风险告警',
    LOGIN_FAILED: '登录失败', ACCESS_DENIED: '越权访问已拦截', REQUEST_FAILED: '业务操作失败'
  };
  const sourceNames = { ADMIN_WEB: '控制端', TECHNICIAN_MOBILE: '技师手机端', SYSTEM: '系统', API: '接口' };
  const resultNames = { SUCCESS: '成功', FAILED: '失败', DENIED: '已拦截' };

  const parseStored = key => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
  const canView = () => Boolean(localStorage.getItem(tokenKey)) && (parseStored(rolesKey).includes('TENANT_ADMIN') || parseStored(permissionsKey).includes('AUDIT_VIEW'));
  const canExport = () => Boolean(localStorage.getItem(tokenKey)) && (parseStored(rolesKey).includes('TENANT_ADMIN') || parseStored(permissionsKey).includes('AUDIT_EXPORT'));
  const isTenantAdmin = () => parseStored(rolesKey).includes('TENANT_ADMIN');
  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem(tokenKey)}` });
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const notify = message => typeof window.toast === 'function' ? window.toast(message) : undefined;
  const formatTime = value => value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)).replaceAll('/', '-') : '—';
  const compactId = value => value ? `${value.slice(0, 8)}…${value.slice(-4)}` : '—';
  const prettyJson = value => {
    if (!value) return '无数据';
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return String(value); }
  };

  const nav = document.querySelector('.sidebar nav');
  const auditButton = document.createElement('button');
  auditButton.className = 'nav-item';
  auditButton.dataset.view = 'audits';
  auditButton.hidden = true;
  auditButton.innerHTML = '<span>审</span>审计中心';
  nav.append(auditButton);

  document.querySelector('.workspace').insertAdjacentHTML('beforeend', `
    <section class="view audit-view hidden" id="audits-view">
      <div class="page-heading audit-heading">
        <div><p class="eyebrow">操作追溯</p><h1>审计中心</h1></div>
        <div class="page-actions"><button class="button secondary" type="button" id="audit-refresh">刷新记录</button><button class="button primary" type="button" id="audit-export">导出 Excel</button></div>
      </div>
      <div class="audit-metrics" aria-label="审计数据概览">
        <article class="audit-metric"><span>符合条件记录</span><strong id="audit-total">0</strong><small>按当前筛选范围统计</small></article>
        <article class="audit-metric success"><span>当前页成功操作</span><strong id="audit-success-count">0</strong><small id="audit-page-count">本页 0 条</small></article>
        <article class="audit-metric scope"><span>数据查看范围</span><strong id="audit-scope">—</strong><small>由账号门店权限决定</small></article>
        <article class="audit-metric"><span>已启用筛选</span><strong id="audit-filter-count">0</strong><small>日期、门店、人员与动作</small></article>
      </div>
      <section class="panel audit-panel">
        <form id="audit-filter-form">
          <div class="audit-filters">
            <label class="audit-filter">门店<select id="audit-store" name="storeId"><option value="">全部可见门店</option></select></label>
            <label class="audit-filter">开始日期<input id="audit-from" name="from" type="date"></label>
            <label class="audit-filter">结束日期<input id="audit-to" name="to" type="date"></label>
            <label class="audit-filter">业务模块<select id="audit-module" name="module"><option value="">全部模块</option></select></label>
            <label class="audit-filter">操作来源<select id="audit-source" name="source"><option value="">全部来源</option></select></label>
            <label class="audit-filter">操作结果<select id="audit-result" name="result"><option value="">全部结果</option></select></label>
            <label class="audit-filter">操作人员<select id="audit-actor" name="actorUserId"><option value="">全部人员</option></select></label>
            <label class="audit-filter">具体动作<select id="audit-action" name="action"><option value="">全部动作</option></select></label>
          </div>
          <div class="audit-filter-row">
            <label class="audit-search"><span>⌕</span><input id="audit-query" name="query" maxlength="120" placeholder="操作内容、对象编号、人员、门店或请求编号"></label>
            <div class="audit-filter-actions"><button class="button secondary" id="audit-reset" type="button">重置</button><button class="button primary" type="submit">查询</button></div>
          </div>
        </form>
        <div class="audit-table-wrap">
          <table class="audit-table">
            <thead><tr><th>操作时间</th><th>门店</th><th>操作人员</th><th>模块 / 动作</th><th>操作内容</th><th>来源</th><th>结果</th><th class="align-right">详情</th></tr></thead>
            <tbody id="audit-records"><tr><td colspan="8" class="table-empty">打开审计中心后加载</td></tr></tbody>
          </table>
        </div>
        <div class="audit-pagination">
          <span class="audit-pagination-info" id="audit-pagination-info">共 0 条记录</span>
          <div class="audit-pagination-actions"><button type="button" id="audit-first" title="第一页" aria-label="第一页">«</button><button type="button" id="audit-prev" title="上一页" aria-label="上一页">‹</button><span id="audit-page-label">第 0 / 0 页</span><button type="button" id="audit-next" title="下一页" aria-label="下一页">›</button><button type="button" id="audit-last" title="最后一页" aria-label="最后一页">»</button></div>
        </div>
      </section>
    </section>
    <dialog id="audit-detail-dialog"><div class="dialog-card audit-detail-dialog"><div class="dialog-heading"><div><p class="eyebrow">操作详情</p><h2 id="audit-detail-title">审计记录</h2></div><button class="icon-button" type="button" id="audit-detail-close" aria-label="关闭">×</button></div><div id="audit-detail-content"></div></div></dialog>
  `);

  const elements = {
    view: document.querySelector('#audits-view'), records: document.querySelector('#audit-records'), form: document.querySelector('#audit-filter-form'),
    store: document.querySelector('#audit-store'), from: document.querySelector('#audit-from'), to: document.querySelector('#audit-to'),
    module: document.querySelector('#audit-module'), source: document.querySelector('#audit-source'), result: document.querySelector('#audit-result'),
    actor: document.querySelector('#audit-actor'), action: document.querySelector('#audit-action'), query: document.querySelector('#audit-query')
  };

  function updatePermissionVisibility() {
    const hidden = !canView();
    if (auditButton.hidden !== hidden) auditButton.hidden = hidden;
    if (auditButton.getAttribute('aria-hidden') !== String(hidden)) auditButton.setAttribute('aria-hidden', String(hidden));
    document.querySelector('#audit-export').hidden = !canExport();
    if (auditButton.hidden && !elements.view.classList.contains('hidden')) document.querySelector('[data-view="frontdesk"]')?.click();
  }

  function setOptions(select, values, placeholder, label) {
    const selected = select.value;
    select.innerHTML = `<option value="">${placeholder}</option>${values.map(item => `<option value="${escapeHtml(typeof item === 'string' ? item : item.id)}">${escapeHtml(label(item))}</option>`).join('')}`;
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
  }

  async function loadOptions() {
    const response = await fetch('/api/v1/audits/options', { headers: headers() });
    if (!response.ok) throw new Error(response.status === 403 ? 'NO_PERMISSION' : 'OPTIONS_FAILED');
    state.options = await response.json();
    setOptions(elements.store, state.options.stores, isTenantAdmin() ? '全部门店' : '全部所属门店', item => `${item.name} · ${item.code}${item.active ? '' : '（已删除）'}`);
    setOptions(elements.actor, state.options.actors, '全部人员', item => item.name);
    setOptions(elements.module, state.options.modules, '全部模块', item => moduleNames[item] || item);
    setOptions(elements.action, state.options.actions, '全部动作', item => actionNames[item] || item);
    setOptions(elements.source, state.options.sources, '全部来源', item => sourceNames[item] || item);
    setOptions(elements.result, state.options.results, '全部结果', item => resultNames[item] || item);
    document.querySelector('#audit-scope').textContent = isTenantAdmin() ? `全部 ${state.options.stores.length} 家门店` : `${state.options.stores.length} 家所属门店`;
  }

  function parameters() {
    const values = new FormData(elements.form);
    const parameters = new URLSearchParams({ page: String(state.page), size: String(state.size) });
    for (const [key, value] of values.entries()) if (String(value).trim()) parameters.set(key, String(value).trim());
    return parameters;
  }

  function filterCount() {
    return [...new FormData(elements.form).values()].filter(value => String(value).trim()).length;
  }

  function renderRows(items) {
    elements.records.innerHTML = items.map(item => {
      const moduleLabel = moduleNames[item.moduleCode] || item.moduleCode;
      const actionLabel = actionNames[item.action] || item.action;
      const summaryLabel = !item.summary || item.summary === item.action ? actionLabel : item.summary;
      return `<tr>
        <td class="audit-time"><b>${escapeHtml(formatTime(item.createdAt))}</b><small>${escapeHtml(item.requestId || '无请求编号')}</small></td>
        <td><b>${escapeHtml(item.storeName || '总部 / 系统')}</b><small>${escapeHtml(item.storeCode || '全局记录')}</small></td>
        <td><b>${escapeHtml(item.actorName || '系统')}</b><small>${escapeHtml(item.ipAddress || '未记录 IP')}</small></td>
        <td><span class="audit-code">${escapeHtml(moduleLabel)}</span><small>${escapeHtml(actionLabel)}</small></td>
        <td class="audit-summary"><b>${escapeHtml(summaryLabel)}</b><small class="audit-entity">${escapeHtml(item.entityType)} · ${escapeHtml(compactId(item.entityId))}</small></td>
        <td><span class="audit-source ${item.source === 'TECHNICIAN_MOBILE' ? 'mobile' : ''}">${escapeHtml(sourceNames[item.source] || item.source)}</span></td>
        <td><span class="audit-result ${String(item.result).toLowerCase()}">${escapeHtml(resultNames[item.result] || item.result)}</span></td>
        <td class="align-right"><button class="record-delete edit-technician" type="button" data-audit-detail="${escapeHtml(item.id)}">查看</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="table-empty">当前筛选条件下没有审计记录</td></tr>';
    const successCount = items.filter(item => item.result === 'SUCCESS').length;
    document.querySelector('#audit-total').textContent = new Intl.NumberFormat('zh-CN').format(state.total);
    document.querySelector('#audit-success-count').textContent = successCount;
    document.querySelector('#audit-page-count').textContent = `本页 ${items.length} 条`;
    document.querySelector('#audit-filter-count').textContent = filterCount();
  }

  function renderPagination() {
    const current = state.totalPages ? state.page + 1 : 0;
    document.querySelector('#audit-pagination-info').textContent = `共 ${state.total} 条记录 · 每页 ${state.size} 条`;
    document.querySelector('#audit-page-label').textContent = `第 ${current} / ${state.totalPages} 页`;
    const first = state.page <= 0;
    const last = state.totalPages === 0 || state.page >= state.totalPages - 1;
    document.querySelector('#audit-first').disabled = first;
    document.querySelector('#audit-prev').disabled = first;
    document.querySelector('#audit-next').disabled = last;
    document.querySelector('#audit-last').disabled = last;
  }

  async function loadAudits() {
    if (!canView()) return;
    const sequence = ++state.sequence;
    elements.records.innerHTML = '<tr><td colspan="8" class="table-empty">正在加载审计记录…</td></tr>';
    const response = await fetch(`/api/v1/audits?${parameters()}`, { headers: headers() });
    if (sequence !== state.sequence) return;
    if (!response.ok) {
      elements.records.innerHTML = `<tr><td colspan="8" class="table-empty">${response.status === 403 ? '当前账号没有审计查看权限' : '审计记录加载失败'}</td></tr>`;
      return;
    }
    const page = await response.json();
    state.total = page.totalElements;
    state.totalPages = page.totalPages;
    if (state.page > 0 && state.page >= state.totalPages) { state.page = Math.max(0, state.totalPages - 1); return loadAudits(); }
    renderRows(page.items);
    renderPagination();
    state.loaded = true;
  }

  async function exportAudits() {
    if (!canExport()) return notify('当前账号没有审计导出权限');
    const button = document.querySelector('#audit-export');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '正在导出…';
    try {
      const exportParams = new URLSearchParams();
      for (const [key, value] of new FormData(elements.form).entries()) if (String(value).trim()) exportParams.set(key, String(value).trim());
      const response = await fetch(`/api/v1/audits/export?${exportParams}`, { headers: headers() });
      if (!response.ok) {
        notify(response.status === 403 ? '当前账号没有审计导出权限' : response.status === 400 ? '导出范围过大，请增加日期或门店筛选' : '审计记录导出失败');
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const matched = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const filename = matched ? decodeURIComponent(matched[1]) : `操作审计_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      state.options = null;
      await loadOptions();
      await loadAudits();
      notify(`已导出 ${filename}`);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function openDetail(id) {
    const response = await fetch(`/api/v1/audits/${encodeURIComponent(id)}`, { headers: headers() });
    if (!response.ok) return notify(response.status === 404 ? '该记录不在当前账号查看范围内' : '审计详情加载失败');
    const item = await response.json();
    document.querySelector('#audit-detail-title').textContent = actionNames[item.action] || item.action;
    document.querySelector('#audit-detail-content').innerHTML = `
      <div class="audit-detail-meta">
        <div><span>操作时间</span><b>${escapeHtml(formatTime(item.createdAt))}</b></div>
        <div><span>门店</span><b>${escapeHtml(item.storeName || '总部 / 系统')}</b><small>${escapeHtml(item.storeCode || '全局记录')}</small></div>
        <div><span>操作人员</span><b>${escapeHtml(item.actorName || '系统')}</b><small>${escapeHtml(item.actorRoles || '无角色快照')}</small></div>
        <div><span>来源与结果</span><b>${escapeHtml(sourceNames[item.source] || item.source)} · ${escapeHtml(resultNames[item.result] || item.result)}</b></div>
        <div><span>业务模块</span><b>${escapeHtml(moduleNames[item.moduleCode] || item.moduleCode)}</b><small>${escapeHtml(item.action)}</small></div>
        <div><span>操作对象</span><b>${escapeHtml(item.entityType)}</b><small>${escapeHtml(item.entityId)}</small></div>
        <div><span>请求编号</span><b title="${escapeHtml(item.requestId || '')}">${escapeHtml(item.requestId || '未记录')}</b></div>
        <div><span>IP / 设备</span><b>${escapeHtml(item.ipAddress || '未记录')}</b><small title="${escapeHtml(item.userAgent || '')}">${escapeHtml(item.userAgent || '未记录设备信息')}</small></div>
      </div>
      ${item.failureReason ? `<p class="audit-failure-reason">失败原因：${escapeHtml(item.failureReason)}</p>` : ''}
      <div class="audit-change-grid">
        <section class="audit-data-block"><h3>修改前</h3><pre>${escapeHtml(prettyJson(item.beforeData))}</pre></section>
        <section class="audit-data-block"><h3>修改后</h3><pre>${escapeHtml(prettyJson(item.afterData))}</pre></section>
      </div>
      <section class="audit-data-block audit-context-block"><h3>请求环境</h3><pre>${escapeHtml(prettyJson(item.contextData))}</pre></section>`;
    document.querySelector('#audit-detail-dialog').showModal();
  }

  async function enterAuditView() {
    if (!canView()) return notify('当前账号没有审计查看权限');
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    auditButton.classList.add('active');
    document.querySelectorAll('.workspace > .view').forEach(view => view.classList.add('hidden'));
    elements.view.classList.remove('hidden');
    document.body.classList.add('audit-mode');
    if (!state.options) {
      try { await loadOptions(); } catch (error) { return notify(error.message === 'NO_PERMISSION' ? '当前账号没有审计查看权限' : '审计筛选项加载失败'); }
    }
    await loadAudits();
  }

  auditButton.addEventListener('click', enterAuditView);
  document.querySelectorAll('.nav-item[data-view]:not([data-view="audits"])').forEach(button => button.addEventListener('click', () => {
    elements.view.classList.add('hidden');
    document.body.classList.remove('audit-mode');
  }));
  elements.form.addEventListener('submit', event => { event.preventDefault(); state.page = 0; loadAudits(); });
  document.querySelector('#audit-reset').addEventListener('click', () => { elements.form.reset(); state.page = 0; loadAudits(); });
  document.querySelector('#audit-refresh').addEventListener('click', async () => { state.options = null; await loadOptions(); await loadAudits(); notify('审计记录已刷新'); });
  document.querySelector('#audit-export').addEventListener('click', exportAudits);
  elements.records.addEventListener('click', event => { const button = event.target.closest('[data-audit-detail]'); if (button) openDetail(button.dataset.auditDetail); });
  document.querySelector('#audit-detail-close').addEventListener('click', () => document.querySelector('#audit-detail-dialog').close());
  document.querySelector('#audit-first').addEventListener('click', () => { state.page = 0; loadAudits(); });
  document.querySelector('#audit-prev').addEventListener('click', () => { state.page = Math.max(0, state.page - 1); loadAudits(); });
  document.querySelector('#audit-next').addEventListener('click', () => { if (state.page + 1 < state.totalPages) { state.page += 1; loadAudits(); } });
  document.querySelector('#audit-last').addEventListener('click', () => { if (state.totalPages) { state.page = state.totalPages - 1; loadAudits(); } });
  elements.query.addEventListener('keydown', event => { if (event.key === 'Escape') { elements.query.value = ''; state.page = 0; loadAudits(); } });

  const observer = new MutationObserver(updatePermissionVisibility);
  observer.observe(auditButton, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('click', () => queueMicrotask(updatePermissionVisibility));
  window.addEventListener('focus', updatePermissionVisibility);
  updatePermissionVisibility();
})();
