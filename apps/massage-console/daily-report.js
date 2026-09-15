(() => {
  const apiBase = '/api/v1/daily-reports';
  const cents = value => { const amount = Number(value || 0) / 100; return `${amount < 0 ? '-' : ''}¥${Math.abs(amount).toFixed(2)}`; };
  const percent = value => `${Number(value || 0).toFixed(2)}%`;
  const statuses = { DRAFT: '草稿', SAVED: '已保存', PUBLISHED: '已发布' };
  const amountFields = ['dailyTargetCents','dailySalesAmountCents','dailyCashFlowCents','dailyCardSaleCents','dailyCardOpenCents','dailyCardRenewCents','dailyCardCancellationCents','dailyCardConsumptionCents','dailyCashCents','dailyAlipayCents','dailyDouyinCents','dailyMeituanCents','dailyFreeOrderCents','dailyEntertainmentCents'];
  const countFields = ['dailyCustomerCount','dailyExtensionCount','dailyCallClockCount','dailyCardOpenCount','managerCount','cashierCount','technicianCount','chefCount','cleanerCount','nextDayRestCount','customerLossCount'];
  const textFields = ['incidentNote','extendedShiftNote','nextDayImprovementNote'];
  const autoAmountFields = amountFields.filter(name => name !== 'dailyTargetCents');
  const autoCountFields = ['dailyCustomerCount','dailyExtensionCount','dailyCallClockCount','dailyCardOpenCount'];
  const legacyCompatibilityFields = ['dailyCardOpenCents'];
  const legacyPaymentFields = ['dailyCashCents','dailyAlipayCents','dailyDouyinCents','dailyMeituanCents','dailyFreeOrderCents','dailyEntertainmentCents'];
  const dailyReportEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  const monthlyRows = [
    ['当月目标','monthlyTargetCents','amount'],['累计营业额','salesAmountCents','amount'],['累计现金流','cashFlowCents','amount'],['累计红冲退款','refundAmountCents','amount'],['累计售卡','cardSaleCents','amount'],['累计开卡数量','cardOpenCount','count'],['累计续卡','cardRenewCents','amount'],['累计卡耗','cardConsumptionCents','amount'],['当月总客流','customerCount','count'],['累计加钟','extensionCount','count'],['累计点钟','callClockCount','count'],['加点钟率','serviceClockRate','percent'],['平均客消','averageCustomerSpendCents','amount']
  ];
  let data = null;
  let reportSettings = null;

  const nav = document.querySelector('nav');
  nav.insertAdjacentHTML('beforeend', '<button class="nav-item" data-view="daily-report"><span>报</span>每日营业日报</button>');
  document.querySelector('#management-view').insertAdjacentHTML('beforebegin', `
    <section class="view daily-report-view hidden" id="daily-report-view">
      <div class="page-heading daily-report-heading"><div><p class="eyebrow">门店经营</p><h1>每日营业日报</h1><p class="daily-report-subtitle">记录每日经营、人员安排与晚班交接</p></div><div class="page-actions"><span id="daily-report-save-meta" class="muted-count">请选择门店和日期</span><button class="button secondary" id="daily-report-revisions" type="button">修改记录</button><button class="button secondary" id="daily-report-export" type="button">导出日报</button><button class="button secondary" id="daily-report-range-export" type="button">批量导出</button><button class="button secondary" id="daily-report-print" type="button">打印日报</button><button class="button secondary" id="daily-report-reload" type="button">刷新数据</button><button class="button primary" id="daily-report-publish" type="button">发布日报</button></div></div>
      <section class="daily-report-query panel"><div class="daily-report-query-fields"><label>门店<select id="daily-report-store"></select></label><label>营业日期<input id="daily-operating-report-date" type="date"></label></div><div class="daily-report-status"><span id="daily-report-status" class="record-type consumption">未创建</span><small>日报提交后将保留最后编辑人与修改记录</small></div></section>
      <section class="daily-report-overview" id="daily-report-overview"></section>
      <section class="panel daily-report-refunds hidden" id="daily-report-refunds"><div class="daily-report-section-heading"><div><p class="eyebrow">退款发生明细</p><h2>当日已完成退款</h2></div><span>按原订单营业日归集</span></div><div id="daily-report-refund-list" class="daily-report-refund-list"></div></section>
      <section class="panel daily-service-panel"><div class="daily-report-section-heading"><div><p class="eyebrow">服务客流</p><h2>加钟与点钟结构</h2></div><span class="daily-service-formula">按总服务次数计算</span></div><div class="daily-service-groups"><section><div class="daily-service-group-heading"><b>当日服务结构</b><small>当前营业日期</small></div><div class="daily-service-grid" id="daily-service-daily"></div></section><section><div class="daily-service-group-heading"><b>本月服务结构</b><small>本月累计至当前日期</small></div><div class="daily-service-grid" id="daily-service-monthly"></div></section></div></section>
      <div class="daily-report-layout"><section class="panel daily-report-data-panel"><div class="daily-report-section-heading"><div><p class="eyebrow">月度累计</p><h2>本月经营进度</h2></div><span id="daily-report-month-rate" class="daily-rate">--</span></div><div class="daily-report-table-wrap"><table><tbody id="daily-report-monthly-records"></tbody></table></div></section><section class="panel daily-report-payment-panel"><div class="daily-report-section-heading"><div><p class="eyebrow">当日收款</p><h2>支付渠道净实收</h2></div><strong id="daily-report-payment-total">¥0.00</strong></div><div id="daily-report-payment-bars" class="daily-payment-bars"></div></section></div>
      <form id="daily-report-form" class="daily-report-form"><section class="panel"><div class="daily-report-section-heading"><div><p class="eyebrow">当日经营</p><h2>当日数据填报</h2></div><button class="button primary" type="submit">保存日报</button></div><div class="daily-report-fields">
        <label>当日目标（元）<input name="dailyTargetCents" type="number" min="0" step="0.01"></label><label>当日营业额（元）<input name="dailySalesAmountCents" type="number" min="0" step="0.01"></label><label>当日现金流（元）<input name="dailyCashFlowCents" type="number" min="0" step="0.01"></label><label>当日售卡（元）<input name="dailyCardSaleCents" type="number" min="0" step="0.01"></label><label>当日开卡数量（张）<input name="dailyCardOpenCount" type="number" min="0" step="1"></label><label hidden>当日开卡金额（兼容）<input name="dailyCardOpenCents" type="number" min="0" step="0.01"></label><label>当日续卡（元）<input name="dailyCardRenewCents" type="number" min="0" step="0.01"></label><label>当日销卡（元）<input name="dailyCardCancellationCents" type="number" min="0" step="0.01"></label><label>当日卡耗（元）<input name="dailyCardConsumptionCents" type="number" min="0" step="0.01"></label><label class="daily-customer-count-field"><span>当日总客流</span><div class="daily-customer-count-control"><input name="dailyCustomerCount" type="number" min="0" step="1"><button class="button secondary daily-customer-count-edit" id="daily-customer-count-edit" type="button">修改</button><button class="button secondary daily-customer-count-reset" id="daily-customer-count-reset" type="button">恢复自动</button></div><small id="daily-customer-count-meta">按有效订单自动统计</small></label><label>当日加钟<input name="dailyExtensionCount" type="number" min="0" step="1"></label><label>当日点钟<input name="dailyCallClockCount" type="number" min="0" step="1"></label><div id="daily-report-payment-fields" class="daily-report-payment-fields form-full" aria-live="polite"></div>
      </div></section><div class="daily-report-layout"><section class="panel"><div class="daily-report-section-heading"><div><p class="eyebrow">人事情况</p><h2>当日岗位人数</h2></div></div><div class="daily-report-fields personnel-fields"><label>店长人数<input name="managerCount" type="number" min="0" step="1"></label><label>前台人数<input name="cashierCount" type="number" min="0" step="1"></label><label>技师人数<input name="technicianCount" type="number" min="0" step="1"></label><label>厨师人数<input name="chefCount" type="number" min="0" step="1"></label><label>保洁人数<input name="cleanerCount" type="number" min="0" step="1"></label></div></section><section class="panel daily-handover-panel"><div class="daily-report-section-heading"><div><p class="eyebrow">晚班交接</p><h2>异常与明日安排</h2></div></div><div class="daily-handover-fields"><label>突发事件<textarea name="incidentNote" maxlength="4000" rows="2"></textarea></label><label>托班人员<textarea name="extendedShiftNote" maxlength="4000" rows="2"></textarea></label><div class="daily-report-fields compact"><label>明日休息人数<input name="nextDayRestCount" type="number" min="0" step="1"></label><label>今日流失人数<input name="customerLossCount" type="number" min="0" step="1"></label></div><label class="daily-improvement">明日改进反省<textarea name="nextDayImprovementNote" maxlength="4000" rows="5"></textarea></label></div></section></div></form>
    </section>`);

  const view = document.querySelector('#daily-report-view');
  const form = document.querySelector('#daily-report-form');
  const dateInput = document.querySelector('#daily-operating-report-date');
  const storeInput = document.querySelector('#daily-report-store');
  document.querySelector('#daily-report-reload').insertAdjacentHTML('afterend', '<button class="button secondary" id="daily-report-settings" type="button">日报设置</button>');
  document.body.insertAdjacentHTML('beforeend', '<dialog id="daily-report-settings-dialog"><form id="daily-report-settings-form" class="dialog-card daily-report-settings-card"><div class="dialog-heading"><div><p class="eyebrow">日报设置</p><h2>字段与月度目标</h2></div><button class="icon-button" id="close-daily-report-settings" type="button" aria-label="关闭">×</button></div><div class="daily-settings-target"><label>目标月份<input id="daily-settings-month" type="month" required></label><label>当月目标（元）<input id="daily-settings-target" type="number" min="0" step="0.01" required></label></div><div id="daily-report-settings-fields" class="daily-settings-fields"></div><div class="dialog-actions"><button class="button secondary" id="cancel-daily-report-settings" type="button">取消</button><button class="button primary" type="submit">保存设置</button></div></form></dialog><dialog id="daily-report-export-dialog"><form id="daily-report-export-form" class="dialog-card daily-report-export-card"><div class="dialog-heading"><div><p class="eyebrow">批量导出</p><h2>选择日报日期范围</h2></div><button class="icon-button" id="close-daily-report-export" type="button" aria-label="关闭">×</button></div><div class="daily-report-export-fields"><label>开始日期<input id="daily-report-export-from" type="date" required></label><label>结束日期<input id="daily-report-export-to" type="date" required></label></div><p class="daily-report-export-hint">将按日期创建独立工作表，最多导出 93 天。</p><div class="dialog-actions"><button class="button secondary" id="cancel-daily-report-export" type="button">取消</button><button class="button primary" type="submit">导出 Excel</button></div></form></dialog><dialog id="daily-report-revisions-dialog"><section class="dialog-card daily-report-revisions-card"><div class="dialog-heading"><div><p class="eyebrow">日报记录</p><h2>修改与发布记录</h2></div><button class="icon-button" id="close-daily-report-revisions" type="button" aria-label="关闭">×</button></div><div id="daily-report-revisions-summary" class="daily-report-revisions-summary"></div><div id="daily-report-revisions-list" class="daily-report-revisions-list"></div><div class="dialog-actions"><button class="button secondary" id="cancel-daily-report-revisions" type="button">关闭</button></div></section></dialog>');
  document.body.insertAdjacentHTML('beforeend', '<dialog id="daily-customer-count-dialog"><form id="daily-customer-count-form" class="dialog-card"><div class="dialog-heading"><div><p class="eyebrow">客流校正</p><h2>修改当日客流</h2></div><button class="icon-button" id="close-daily-customer-count" type="button" aria-label="关闭">×</button></div><p class="daily-customer-count-dialog-note">只调整日报客流显示，不改变订单、营业额、收款、退款或提成数据。</p><label>实际客流（人）<input id="daily-customer-count-value" type="number" min="0" step="1" required></label><label>修改原因<textarea id="daily-customer-count-reason" rows="3" maxlength="500" required placeholder="例如：同一客人加钟拆成两张订单"></textarea></label><div class="dialog-actions"><button class="button secondary" id="cancel-daily-customer-count" type="button">取消</button><button class="button primary" type="submit">保存修改</button></div></form></dialog>');
  dateInput.value = '';

  const currentStore = () => localStorage.getItem(currentStoreKey) || defaultStoreId;
  const apiValueKey = name => name === 'dailySalesAmountCents' ? 'dailySalesCents' : name;
  const selectedStoreName = () => storeInput.selectedOptions[0]?.textContent || '当前门店';
  const reportHeaders = json => storeContextHeaders(json);
  function renderStores() {
    storeInput.innerHTML = (selectableStores || []).map(store => `<option value="${store.id}">${store.name}</option>`).join('');
    storeInput.value = currentStore();
  }
  function configFor(code) { return reportSettings?.fields?.find(field => field.fieldCode === code) || { fieldCode: code, visible: true, required: false, sortOrder: 100, fieldLabel: '' }; }
  function setControlLabel(control, label) {
    const wrapper = control.closest('label');
    if (!wrapper || !label) return;
    const text = [...wrapper.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (text) text.textContent = label;
  }
  function applyFieldSettings() {
    [...amountFields, ...countFields, ...textFields].forEach(code => {
      const control = form.elements[code]; if (!control) return;
      const config = configFor(code); const wrapper = control.closest('label');
      if (wrapper) { wrapper.hidden = legacyPaymentFields.includes(code) || legacyCompatibilityFields.includes(code) || !config.visible; wrapper.style.order = config.sortOrder; }
      control.required = Boolean(config.visible && config.required);
      control.readOnly = autoAmountFields.includes(code) || autoCountFields.includes(code);
      wrapper?.classList.toggle('daily-auto-field', control.readOnly);
      setControlLabel(control, config.fieldLabel);
    });
  }
  function renderDailyPaymentFields(channels) {
    const target = document.querySelector('#daily-report-payment-fields');
    if (!target) return;
    const rows = (channels || []).filter(channel => channel.active
      || Number(channel.salesCents || 0) !== 0
      || Number(channel.refundCents || 0) !== 0
      || Number(channel.rechargeCents || 0) !== 0
      || Number(channel.rechargeRefundCents || 0) !== 0);
    if (!rows.length) {
      target.innerHTML = '<div class="daily-report-payment-fields-heading"><b>当日收款方式</b><small>当前门店暂无启用收款方式</small></div>';
      return;
    }
    target.innerHTML = `<div class="daily-report-payment-fields-heading"><b>当日收款方式</b><small>按订单实际收款渠道自动汇总，金额只读；会员充值按支付方式计入</small></div><div class="daily-report-payment-grid">${rows.map(channel => {
      const name = dailyReportEscape(channel.name || channel.code || '收款方式');
      const code = dailyReportEscape(channel.code || '');
      const net = Number(channel.netCents || 0);
      const recharge = Number(channel.rechargeCents || 0);
      const rechargeRefund = Number(channel.rechargeRefundCents || 0);
      const rechargeNote = recharge || rechargeRefund ? ` · 充值 ${cents(recharge)} · 充值退款 ${cents(rechargeRefund)}` : '';
      return `<label data-report-payment-field="${code}"><span>当日${name}（元）</span><input type="number" step="0.01" value="${(net / 100).toFixed(2)}" readonly aria-label="当日${name}"><small>收款 ${cents(channel.salesCents)} · 退款 ${cents(channel.refundCents)}${rechargeNote} · 净收 ${cents(net)}</small></label>`;
    }).join('')}</div>`;
  }
  function configuredMonthlyRows() {
    return monthlyRows.filter(([, key]) => configFor(key).visible).sort((left, right) => configFor(left[1]).sortOrder - configFor(right[1]).sortOrder);
  }
  function serviceMetric(code, fallbackLabel, value, type, tone) {
    const config = configFor(code);
    if (!config.visible) return '';
    const display = type === 'percent' ? percent(value) : Number(value || 0).toLocaleString('zh-CN');
    return `<article class="daily-service-metric ${tone}" data-service-field="${code}"><span>${config.fieldLabel || fallbackLabel}</span><strong>${display}</strong></article>`;
  }
  function renderServiceStructure(values, monthly, derived) {
    document.querySelector('#daily-service-daily').innerHTML = [
      serviceMetric('dailyCustomerCount', '当日总客流', values.dailyCustomerCount, 'count', 'traffic'),
      serviceMetric('dailyExtensionCount', '当日加钟', values.dailyExtensionCount, 'count', 'extension'),
      serviceMetric('dailyCallClockCount', '当日点钟', values.dailyCallClockCount, 'count', 'call'),
      serviceMetric('dailyServiceClockRate', '当日加点钟率', derived.dailyServiceClockRate, 'percent', 'rate')
    ].join('');
    document.querySelector('#daily-service-monthly').innerHTML = [
      serviceMetric('customerCount', '当月总客流', monthly.customerCount, 'count', 'traffic'),
      serviceMetric('extensionCount', '累计加钟', monthly.extensionCount, 'count', 'extension'),
      serviceMetric('callClockCount', '累计点钟', monthly.callClockCount, 'count', 'call'),
      serviceMetric('serviceClockRate', '加点钟率', derived.monthlyServiceClockRate, 'percent', 'rate')
    ].join('');
  }
  function renderRefundOccurrences(items) {
    const panel = document.querySelector('#daily-report-refunds');
    const target = document.querySelector('#daily-report-refund-list');
    const rows = Array.isArray(items) ? items : [];
    panel.classList.toggle('hidden', rows.length === 0);
    target.innerHTML = rows.map(item => `<article><div><b>${dailyReportEscape(item.refundNo || '退款记录')}</b><span>原订单：${dailyReportEscape(item.orderNo || '--')}</span></div><strong>${cents(item.amountCents)}</strong><p>退款完成时间：${dateTime(item.completedAt)} · 退款营业日：${dailyReportEscape(item.refundBusinessDate || '--')} · 原订单营业日：${dailyReportEscape(item.originalOrderBusinessDate || '--')}</p></article>`).join('');
  }
  function previewServiceStructure() {
    if (!data) return;
    const customers = Number(form.elements.dailyCustomerCount.value || 0);
    const extensions = Number(form.elements.dailyExtensionCount.value || 0);
    const calls = Number(form.elements.dailyCallClockCount.value || 0);
    const total = customers + extensions + calls;
    const dailyRate = total > 0 ? (extensions + calls) * 100 / total : 0;
    renderServiceStructure(
      { ...(data.currentValues || {}), dailyCustomerCount: customers, dailyExtensionCount: extensions, dailyCallClockCount: calls },
      data.monthly || {},
      { ...(data.derived || {}), dailyServiceClockRate: dailyRate }
    );
  }
  function renderSettings(settings) {
    reportSettings = settings;
    document.querySelector('#daily-settings-month').value = settings.targetMonth.slice(0, 7);
    document.querySelector('#daily-settings-target').value = (Number(settings.monthlyTargetCents || 0) / 100).toFixed(2);
    const sections = { MONTHLY: '月度累计', DAILY: '当日经营', PERSONNEL: '人员情况', HANDOVER: '晚班交接' };
    document.querySelector('#daily-report-settings-fields').innerHTML = Object.keys(sections).map(section => {
      const fields = settings.fields.filter(field => field.sectionCode === section).sort((a, b) => a.sortOrder - b.sortOrder);
      return `<section><h3>${sections[section]}</h3><div class="daily-settings-table"><div class="daily-settings-table-head"><span>字段名称</span><span>显示</span><span>必填</span><span>排序</span></div>${fields.map(field => `<div class="daily-settings-row" data-setting-field="${field.fieldCode}"><input data-setting-label value="${field.fieldLabel}"><label><input data-setting-visible type="checkbox" ${field.visible ? 'checked' : ''}>显示</label><label><input data-setting-required type="checkbox" ${field.required ? 'checked' : ''}>必填</label><input data-setting-sort type="number" min="0" step="1" value="${field.sortOrder}"></div>`).join('')}</div></section>`;
    }).join('');
  }
  async function openSettings() {
    if (!localStorage.getItem(adminTokenKey)) { showAdminLogin(); return; }
    const month = dateInput.value.slice(0, 7);
    const response = await fetch(`${apiBase}/settings?month=${encodeURIComponent(month)}`, { headers: reportHeaders() });
    if (!response.ok) { toast(response.status === 403 ? '当前账号没有日报设置权限' : '日报设置加载失败'); return; }
    renderSettings(await response.json());
    document.querySelector('#daily-report-settings-dialog').showModal();
  }
  async function saveSettings() {
    const dialog = document.querySelector('#daily-report-settings-dialog');
    const month = document.querySelector('#daily-settings-month').value;
    const target = Number(document.querySelector('#daily-settings-target').value || 0);
    if (!month || !Number.isFinite(target) || target < 0) { toast('请填写有效的月度目标'); return; }
    const fields = [...document.querySelectorAll('[data-setting-field]')].map(row => ({ fieldCode: row.dataset.settingField, fieldLabel: row.querySelector('[data-setting-label]').value.trim(), visible: row.querySelector('[data-setting-visible]').checked, required: row.querySelector('[data-setting-required]').checked, sortOrder: Number(row.querySelector('[data-setting-sort]').value) }));
    if (fields.some(field => !field.fieldLabel || !Number.isInteger(field.sortOrder) || field.sortOrder < 0)) { toast('请检查字段名称和排序'); return; }
    const response = await fetch(`${apiBase}/settings`, { method: 'PUT', headers: reportHeaders(true), body: JSON.stringify({ targetMonth: `${month}-01`, monthlyTargetCents: Math.round(target * 100), fields }) });
    if (!response.ok) { toast(response.status === 403 ? '当前账号没有日报设置权限' : '日报设置保存失败'); return; }
    reportSettings = await response.json(); dialog.close(); applyFieldSettings(); await load(); toast('日报设置已保存');
  }
  function input(name, value) {
    const control = form.elements[name];
    if (!control) return;
    if (textFields.includes(name)) control.value = value || '';
    else if (amountFields.includes(name)) control.value = (Number(value || 0) / 100).toFixed(2);
    else control.value = Number(value || 0);
  }
  function payload() {
    const target = Number(form.elements.dailyTargetCents.value || 0);
    if (!Number.isFinite(target) || target < 0) throw new Error('请填写有效的当日目标');
    const body = { businessDate: dateInput.value, dailyTargetCents: Math.round(target * 100) };
    countFields.filter(name => !autoCountFields.includes(name)).forEach(name => { const value = Number(form.elements[name].value || 0); if (!Number.isInteger(value) || value < 0) throw new Error('人数和次数请使用整数'); body[name] = value; });
    textFields.forEach(name => body[name] = form.elements[name].value.trim() || null);
    return body;
  }
  function render(reportData) {
    data = reportData;
    renderStores();
    const values = reportData.currentValues || {};
    const monthly = reportData.monthly || {};
    const derived = reportData.derived || {};
    const access = reportData.access || { canEdit: true, canPublish: true, canConfigure: true };
    [...amountFields, ...countFields, ...textFields].forEach(name => input(name, values[apiValueKey(name)]));
    const status = reportData.report?.status || 'DRAFT';
    const statusNode = document.querySelector('#daily-report-status');
    statusNode.textContent = reportData.report ? statuses[status] : '未创建';
    statusNode.className = `record-type ${status === 'PUBLISHED' ? 'order' : 'consumption'}`;
    const savedAt = reportData.report?.lastSavedAt ? new Date(reportData.report.lastSavedAt).toLocaleString('zh-CN') : '尚未保存';
    document.querySelector('#daily-report-save-meta').textContent = `${selectedStoreName()} · ${savedAt} · ${reportData.report?.updatedByName || '--'}`;
    document.querySelector('#daily-report-overview').innerHTML = [
      ['门店名称', selectedStoreName(), '营业日报'], ['营业日期', dateInput.value, '当日数据'], ['当日营业额', cents(values.dailySalesCents), `目标 ${percent(derived.dailyTargetCompletionRate)}`], ['本日红冲退款', cents(reportData.refundAmountCents), '按原订单营业日归集'], ['累计营业额', cents(monthly.salesAmountCents), `本月目标 ${percent(derived.monthlyTargetCompletionRate)}`]
    ].map(([label, value, note]) => `<article><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
    renderRefundOccurrences(reportData.unifiedMetrics?.refundOccurrences);
    document.querySelector('#daily-report-month-rate').textContent = `月度完成 ${percent(derived.monthlyTargetCompletionRate)}`;
    const monthlyChannelRows = (reportData.monthlyPaymentChannels || []).filter(channel => channel.active || channel.salesCents || channel.refundCents || channel.rechargeCents || channel.rechargeRefundCents).map(channel => `<tr data-report-payment-channel="${channel.code}"><th>累计${channel.name}净实收</th><td>${cents(channel.netCents)}</td></tr>`).join('');
    document.querySelector('#daily-report-monthly-records').innerHTML = configuredMonthlyRows().map(([label, key, type]) => { const config = configFor(key); const value = key === 'averageCustomerSpendCents' ? derived[key] : key === 'serviceClockRate' ? derived.monthlyServiceClockRate : monthly[key]; const display = type === 'amount' ? cents(value) : type === 'percent' ? percent(value) : Number(value || 0); return `<tr data-report-field="${key}"><th>${config.fieldLabel || label}</th><td>${display}</td></tr>`; }).join('') + monthlyChannelRows;
    renderServiceStructure(values, monthly, derived);
    const payments = (reportData.paymentChannels || []).filter(channel => channel.active || channel.salesCents || channel.refundCents || channel.rechargeCents || channel.rechargeRefundCents);
    renderDailyPaymentFields(reportData.paymentChannels);
    const colors = ['#0f67b1','#16866f','#d28416','#a94a62','#59636f','#6b57a5'];
    const total = Number(derived.paymentChannelTotalCents || 0);
    const scale = payments.reduce((sum, channel) => sum + Math.abs(Number(channel.netCents || 0)), 0);
    document.querySelector('#daily-report-payment-total').textContent = cents(total);
    document.querySelector('#daily-report-payment-bars').innerHTML = payments.map((channel, index) => { const value = Number(channel.netCents || 0); const ratio = scale ? Math.abs(value) / scale * 100 : 0; const recharge = Number(channel.rechargeCents || 0); const rechargeRefund = Number(channel.rechargeRefundCents || 0); return `<div class="daily-payment-row"><span>${channel.name}</span><div><i style="width:${ratio ? Math.max(2, ratio) : 0}%;background:${colors[index % colors.length]}"></i></div><b>${cents(value)}</b><small>${ratio.toFixed(1)}% · 退款 ${cents(channel.refundCents)}${recharge || rechargeRefund ? ` · 充值净额 ${cents(recharge - rechargeRefund)}` : ''}</small></div>`; }).join('') || '<p class="table-empty">当日暂无前台结算记录</p>';
    const locked = status === 'PUBLISHED';
    form.querySelectorAll('input,textarea,button').forEach(control => control.disabled = locked || !access.canEdit);
    document.querySelector('#daily-report-publish').disabled = locked || !access.canPublish;
    document.querySelector('#daily-report-settings').disabled = !access.canConfigure;
    document.querySelector('#daily-report-revisions').disabled = !reportData.report?.id;
    const correction = reportData.customerCountOverride;
    const customerMeta = document.querySelector('#daily-customer-count-meta');
    const editCustomer = document.querySelector('#daily-customer-count-edit');
    const resetCustomer = document.querySelector('#daily-customer-count-reset');
    if (customerMeta) customerMeta.textContent = correction
      ? `已人工修改为 ${correction.customerCount} 人 · 自动统计 ${correction.automaticCount} 人 · ${correction.reason}`
      : '按有效订单自动统计';
    if (editCustomer) editCustomer.disabled = !access.canEdit;
    if (resetCustomer) resetCustomer.disabled = !access.canEdit || !correction;
    applyFieldSettings();
  }
  function clearUnavailableReport() {
    data = null;
    form.reset();
    form.querySelectorAll('input,textarea,button').forEach(control => control.disabled = true);
    document.querySelector('#daily-report-status').textContent = '暂无可查看日报';
    document.querySelector('#daily-report-status').className = 'record-type consumption';
    document.querySelector('#daily-report-save-meta').textContent = `${selectedStoreName()} · 仅显示已发布日报`;
    document.querySelector('#daily-report-overview').innerHTML = '<article><span>查看范围</span><strong>暂无已发布日报</strong><small>当前日期没有可供查看的已发布记录</small></article>';
    renderRefundOccurrences([]);
    document.querySelector('#daily-report-month-rate').textContent = '--';
    document.querySelector('#daily-report-monthly-records').innerHTML = '<tr><td colspan="2">暂无可查看数据</td></tr>';
    document.querySelector('#daily-service-daily').innerHTML = '';
    document.querySelector('#daily-service-monthly').innerHTML = '';
    document.querySelector('#daily-report-payment-total').textContent = '¥0.00';
    document.querySelector('#daily-report-payment-bars').innerHTML = '';
    renderDailyPaymentFields([]);
    document.querySelector('#daily-report-publish').disabled = true;
    document.querySelector('#daily-report-settings').disabled = true;
    document.querySelector('#daily-report-revisions').disabled = true;
  }
  async function load() {
    if (!localStorage.getItem(adminTokenKey)) { showAdminLogin(); return; }
    renderStores();
    if (!dateInput.value) {
      const current = await fetch('/api/v1/operations/daily-report', { headers: reportHeaders() });
      if (!current.ok) { toast('当前营业日期加载失败'); return; }
      dateInput.value = (await current.json()).businessDate;
    }
    const [response, settingsResponse] = await Promise.all([
      fetch(`${apiBase}?date=${encodeURIComponent(dateInput.value)}`, { headers: reportHeaders() }),
      fetch(`${apiBase}/settings?month=${encodeURIComponent(dateInput.value.slice(0, 7))}`, { headers: reportHeaders() })
    ]);
    reportSettings = settingsResponse.ok ? await settingsResponse.json() : null;
    if (!response.ok) { if (response.status === 404) { clearUnavailableReport(); toast('当前日期暂无可查看的已发布日报'); return; } toast(response.status === 403 ? '当前账号没有日报查看权限' : '日报数据加载失败'); return; }
    render(await response.json());
  }
  async function save(publish) {
    try {
      const body = payload();
      let reportId = data?.report?.id;
      if (!reportId) {
        let response = await fetch(apiBase, { method: 'POST', headers: reportHeaders(true), body: JSON.stringify(body) });
        if (!response.ok) throw new Error('日报创建失败');
        data = await response.json(); reportId = data.report?.id;
      }
      let response = await fetch(`${apiBase}/${reportId}`, { method: 'PUT', headers: reportHeaders(true), body: JSON.stringify(body) });
      if (!response.ok) throw new Error('日报保存失败');
      data = await response.json();
      if (publish) { response = await fetch(`${apiBase}/${reportId}/publish`, { method: 'POST', headers: reportHeaders() }); if (!response.ok) throw new Error('日报发布失败'); data = await response.json(); }
      render(data); toast(publish ? '日报已发布' : '日报已保存');
    } catch (error) { toast(error.message || '日报保存失败'); }
  }
  function openCustomerCountDialog() {
    if (!data?.access?.canEdit) return;
    const correction = data.customerCountOverride;
    document.querySelector('#daily-customer-count-value').value = correction?.customerCount ?? data.currentValues?.dailyCustomerCount ?? 0;
    document.querySelector('#daily-customer-count-reason').value = correction?.reason || '';
    document.querySelector('#daily-customer-count-dialog').showModal();
  }
  async function saveCustomerCountOverride(event) {
    event.preventDefault();
    const count = Number(document.querySelector('#daily-customer-count-value').value);
    const reason = document.querySelector('#daily-customer-count-reason').value.trim();
    if (!Number.isInteger(count) || count < 0 || !reason) { toast('请填写非负整数客流和修改原因'); return; }
    const response = await fetch(`${apiBase}/customer-count-override`, { method: 'PUT', headers: reportHeaders(true), body: JSON.stringify({ businessDate: dateInput.value, customerCount: count, reason }) });
    if (!response.ok) { toast(response.status === 403 ? '当前账号没有客流修改权限' : '客流修改失败'); return; }
    data = await response.json(); document.querySelector('#daily-customer-count-dialog').close(); render(data); toast('客流已修改');
  }
  async function clearCustomerCountOverride() {
    if (!data?.customerCountOverride) return;
    if (!window.confirm('恢复后将重新使用系统自动客流，确定继续吗？')) return;
    const response = await fetch(`${apiBase}/customer-count-override?date=${encodeURIComponent(dateInput.value)}`, { method: 'DELETE', headers: reportHeaders(true) });
    if (!response.ok) { toast(response.status === 403 ? '当前账号没有客流修改权限' : '恢复自动客流失败'); return; }
    data = await response.json(); render(data); toast('已恢复自动客流');
  }
  const revisionAction = { CREATE: '创建日报', SAVE: '保存修改', PUBLISH: '发布日报' };
  const dateTime = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '--';
  function revisionSummary(report) {
    if (!report) return '';
    const published = report.status === 'PUBLISHED' ? `<span><b>发布状态</b>已发布 · ${report.publishedByName || '--'} · ${dateTime(report.publishedAt)}</span>` : `<span><b>当前状态</b>${statuses[report.status] || report.status}</span>`;
    return `<span><b>日报日期</b>${report.businessDate}</span><span><b>最后编辑</b>${report.updatedByName || '--'} · ${dateTime(report.lastSavedAt || report.updatedAt)}</span>${published}`;
  }
  async function openRevisions() {
    const report = data?.report;
    if (!report?.id) { toast('请先保存日报后查看修改记录'); return; }
    const response = await fetch(`${apiBase}/${report.id}/revisions`, { headers: reportHeaders() });
    if (!response.ok) { toast(response.status === 403 ? '当前账号没有日报查看权限' : '修改记录加载失败'); return; }
    const revisions = await response.json();
    document.querySelector('#daily-report-revisions-summary').innerHTML = revisionSummary(report);
    document.querySelector('#daily-report-revisions-list').innerHTML = revisions.map(item => `<article class="daily-report-revision"><span class="daily-report-revision-version">V${item.revisionNo}</span><div><strong>${revisionAction[item.action] || item.action}</strong><p>${item.actorName || item.actorUserId || '--'} · ${dateTime(item.createdAt)}</p></div></article>`).join('') || '<p class="daily-report-revisions-empty">暂无修改记录</p>';
    document.querySelector('#daily-report-revisions-dialog').showModal();
  }
  function exportFilename(from, to) {
    const storeName = selectedStoreName().replace(/[\\/:*?"<>|]/g, '_');
    return from === to ? `${storeName}_每日营业日报_${from}.xlsx` : `${storeName}_每日营业日报_${from}_至_${to}.xlsx`;
  }
  async function downloadReport(from, to = from) {
    if (!localStorage.getItem(adminTokenKey)) { showAdminLogin(); return; }
    const params = new URLSearchParams(from === to ? { date: from } : { from, to });
    const response = await fetch(`${apiBase}/export?${params}`, { headers: reportHeaders() });
    if (!response.ok) { toast(response.status === 403 ? '当前账号没有日报导出权限' : '日报导出失败'); return; }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = exportFilename(from, to); document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    toast('日报 Excel 已开始下载');
  }
  function openExportDialog() {
    document.querySelector('#daily-report-export-from').value = dateInput.value;
    document.querySelector('#daily-report-export-to').value = dateInput.value;
    document.querySelector('#daily-report-export-dialog').showModal();
  }
  function printableReport() {
    const report = view.cloneNode(true);
    report.querySelectorAll('.page-actions, button').forEach(node => node.remove());
    report.querySelectorAll('input, textarea, select').forEach(control => {
      const text = document.createElement('span');
      text.className = 'daily-print-value';
      text.textContent = control.tagName === 'SELECT' ? control.selectedOptions[0]?.textContent || '--' : control.value || '--';
      control.replaceWith(text);
    });
    return report.outerHTML;
  }
  function printReport() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { toast('请允许浏览器打开打印窗口'); return; }
    printWindow.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${selectedStoreName()} 每日营业日报</title><link rel="stylesheet" href="${location.origin}/styles.css?v=20260915-next-optimization-v5"><link rel="stylesheet" href="${location.origin}/daily-report.css?v=20260915-next-optimization-v5"></head><body class="daily-report-print"><main class="workspace">${printableReport()}</main></body></html>`);
    printWindow.document.close();
    printWindow.addEventListener('load', () => { printWindow.focus(); printWindow.print(); });
  }
  function open() {
    const navButton = document.querySelector('[data-view="daily-report"]');
    if (navButton.hidden || (window.isAdminViewAllowed && !window.isAdminViewAllowed('daily-report'))) { toast('当前账号没有该模块权限'); return; }
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    navButton.classList.add('active');
    ['frontdesk','management','technicians','rooms','services','members','payment-methods','print-settings','access'].forEach(name => document.querySelector(`#${name}-view`)?.classList.add('hidden'));
    view.classList.remove('hidden'); document.body.classList.add('daily-report-mobile-mode'); load();
  }
  document.querySelector('[data-view="daily-report"]').addEventListener('click', open);
  document.querySelectorAll('.nav-item[data-view]:not([data-view="daily-report"])').forEach(button => button.addEventListener('click', () => { view.classList.add('hidden'); document.body.classList.remove('daily-report-mobile-mode'); }));
  storeInput.addEventListener('change', () => { localStorage.setItem(currentStoreKey, storeInput.value); const topStore = document.querySelector('#current-store-select'); if (topStore) topStore.value = storeInput.value; load(); });
  dateInput.addEventListener('change', load);
  document.querySelector('#daily-report-export').addEventListener('click', () => downloadReport(dateInput.value));
  document.querySelector('#daily-report-range-export').addEventListener('click', openExportDialog);
  document.querySelector('#daily-report-print').addEventListener('click', printReport);
  document.querySelector('#daily-report-revisions').addEventListener('click', openRevisions);
  document.querySelector('#daily-report-reload').addEventListener('click', load);
  document.querySelector('#daily-customer-count-edit').addEventListener('click', openCustomerCountDialog);
  document.querySelector('#daily-customer-count-reset').addEventListener('click', clearCustomerCountOverride);
  document.querySelector('#daily-customer-count-form').addEventListener('submit', saveCustomerCountOverride);
  document.querySelector('#close-daily-customer-count').addEventListener('click', () => document.querySelector('#daily-customer-count-dialog').close());
  document.querySelector('#cancel-daily-customer-count').addEventListener('click', () => document.querySelector('#daily-customer-count-dialog').close());
  document.querySelector('#daily-report-settings').addEventListener('click', openSettings);
  document.querySelector('#close-daily-report-settings').addEventListener('click', () => document.querySelector('#daily-report-settings-dialog').close());
  document.querySelector('#cancel-daily-report-settings').addEventListener('click', () => document.querySelector('#daily-report-settings-dialog').close());
  document.querySelector('#daily-report-settings-form').addEventListener('submit', event => { event.preventDefault(); saveSettings(); });
  document.querySelector('#close-daily-report-export').addEventListener('click', () => document.querySelector('#daily-report-export-dialog').close());
  document.querySelector('#cancel-daily-report-export').addEventListener('click', () => document.querySelector('#daily-report-export-dialog').close());
  document.querySelector('#close-daily-report-revisions').addEventListener('click', () => document.querySelector('#daily-report-revisions-dialog').close());
  document.querySelector('#cancel-daily-report-revisions').addEventListener('click', () => document.querySelector('#daily-report-revisions-dialog').close());
  document.querySelector('#daily-report-export-form').addEventListener('submit', event => { event.preventDefault(); const from = document.querySelector('#daily-report-export-from').value; const to = document.querySelector('#daily-report-export-to').value; if (!from || !to || to < from) { toast('请选择有效的导出日期范围'); return; } document.querySelector('#daily-report-export-dialog').close(); downloadReport(from, to); });
  form.addEventListener('submit', event => { event.preventDefault(); save(false); });
  form.addEventListener('input', event => { if (['dailyCustomerCount','dailyExtensionCount','dailyCallClockCount'].includes(event.target.name)) previewServiceStructure(); });
  document.querySelector('#daily-report-publish').addEventListener('click', () => save(true));
  window.applyAdminPermissions?.();
})();
