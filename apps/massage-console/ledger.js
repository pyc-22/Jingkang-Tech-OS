const ledgerScope = new URLSearchParams(window.location.search).get('scope') === 'management' ? 'management' : 'frontdesk';
const ledgerConfig = ledgerScope === 'management'
  ? {
      storageKey: 'chengxin-management-ledger-v1',
      pageTitle: '管理端订单与消费账本 · 靖康科技运营',
      eyebrow: '管理端独立数据区',
      title: '管理端订单与消费账本',
      noticeTitle: '管理端独立账本',
      noticeDescription: '这里的金额和记录只在经营管理中统计，不会写入前台账本、收银订单或会员余额。',
      backHref: './index.html#management',
      backLabel: '返回经营管理',
      seedRecords: [
        { id: 'mgr-001', type: 'order', customer: '总部补录', orderNo: 'MG-20260721-001', note: '管理端订单补录', amount: 480, at: '2026-07-21 17:30' },
        { id: 'mgr-002', type: 'consumption', customer: '总部会员', orderNo: 'MG-20260721-002', note: '管理端消费补录', amount: 328, at: '2026-07-21 16:48' },
        { id: 'mgr-003', type: 'order', customer: '渠道客户', orderNo: 'MG-20260721-003', note: '合作渠道订单', amount: 168, at: '2026-07-21 15:42' },
        { id: 'mgr-004', type: 'consumption', customer: '散客', orderNo: '', note: '管理端消费补记', amount: 200, at: '2026-07-21 15:10' }
      ]
    }
  : {
      storageKey: 'chengxin-independent-ledger-v1',
      pageTitle: '前台订单与消费账本 · 靖康科技运营',
      eyebrow: '前台独立数据区',
      title: '前台订单与消费账本',
      noticeTitle: '前台独立账本',
      noticeDescription: '这里的金额和记录仅在本页面统计，不会写入前台收银订单或会员余额。',
      backHref: './index.html',
      backLabel: '返回前台收银',
      seedRecords: [
        { id: 'rec-001', type: 'order', customer: '林女士', orderNo: 'DL-20260721-001', note: '肩颈舒缓 90 分钟', amount: 298, at: '2026-07-21 17:42' },
        { id: 'rec-002', type: 'consumption', customer: '王女士', orderNo: 'DL-20260721-002', note: '会员储值消费', amount: 398, at: '2026-07-21 17:18' },
        { id: 'rec-003', type: 'order', customer: '陈先生', orderNo: 'DL-20260721-003', note: '全身经络舒压 120 分钟', amount: 398, at: '2026-07-21 16:56' },
        { id: 'rec-004', type: 'consumption', customer: '散客', orderNo: '', note: '足部调理 75 分钟', amount: 238, at: '2026-07-21 16:31' }
      ]
    };
const STORAGE_KEY = ledgerConfig.storageKey;
const seedRecords = ledgerConfig.seedRecords;

let records = loadRecords();
let currentFilter = 'all';
const money = value => `¥${Number(value).toFixed(2)}`;
const ledgerEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));

function loadRecords() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : seedRecords;
  } catch { return seedRecords; }
}

function persistRecords() { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.remove('hidden'); window.setTimeout(() => el.classList.add('hidden'), 2200); }

function renderMetrics() {
  const order = records.filter(record => record.type === 'order');
  const consumption = records.filter(record => record.type === 'consumption');
  document.querySelector('#order-amount').textContent = money(order.reduce((sum, record) => sum + record.amount, 0));
  document.querySelector('#consumption-amount').textContent = money(consumption.reduce((sum, record) => sum + record.amount, 0));
  document.querySelector('#order-count').textContent = order.length;
  document.querySelector('#consumption-count').textContent = consumption.length;
}

function renderRecords() {
  const keyword = document.querySelector('#record-search').value.trim().toLowerCase();
  const visible = records.filter(record => {
    const matchesType = currentFilter === 'all' || record.type === currentFilter;
    const text = `${record.customer} ${record.orderNo} ${record.note}`.toLowerCase();
    return matchesType && (!keyword || text.includes(keyword));
  });
  const table = document.querySelector('#ledger-records');
  table.innerHTML = visible.map(record => `<tr><td>${ledgerEscape(record.at)}</td><td><span class="record-type ${ledgerEscape(record.type)}">${record.type === 'order' ? '订单金额' : '消费记录'}</span></td><td><b>${ledgerEscape(record.customer)}</b></td><td class="muted-cell">${ledgerEscape(record.orderNo || '—')}</td><td>${ledgerEscape(record.note)}</td><td class="align-right amount-cell">${money(record.amount)}</td><td><button class="record-delete" data-delete="${ledgerEscape(record.id)}">删除</button></td></tr>`).join('');
  document.querySelector('#empty-records').classList.toggle('hidden', visible.length !== 0);
}

function render() { renderMetrics(); renderRecords(); }

function applyLedgerContext() {
  document.title = ledgerConfig.pageTitle;
  document.querySelector('#ledger-eyebrow').textContent = ledgerConfig.eyebrow;
  document.querySelector('#ledger-title').textContent = ledgerConfig.title;
  document.querySelector('#ledger-notice-title').textContent = ledgerConfig.noticeTitle;
  document.querySelector('#ledger-notice-description').textContent = ledgerConfig.noticeDescription;
  const back = document.querySelector('#ledger-back');
  back.href = ledgerConfig.backHref;
  back.title = ledgerConfig.backLabel;
  back.setAttribute('aria-label', ledgerConfig.backLabel);
}

document.querySelector('#add-record').addEventListener('click', () => document.querySelector('#record-dialog').showModal());
document.querySelector('#close-record-dialog').addEventListener('click', () => document.querySelector('#record-dialog').close());
document.querySelector('#cancel-record').addEventListener('click', () => document.querySelector('#record-dialog').close());
document.querySelector('#record-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  records.unshift({ id: `rec-${Date.now()}`, type: form.get('type'), customer: form.get('customer').trim(), orderNo: form.get('orderNo').trim(), note: form.get('note').trim(), amount: Number(form.get('amount')), at: new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date()).replaceAll('/', '-').replace(',', '') });
  persistRecords(); render(); event.currentTarget.reset(); document.querySelector('#record-dialog').close(); toast('独立记录已保存');
});
document.querySelector('#ledger-records').addEventListener('click', event => {
  const button = event.target.closest('[data-delete]'); if (!button) return;
  records = records.filter(record => record.id !== button.dataset.delete); persistRecords(); render(); toast('记录已删除');
});
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { currentFilter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('selected', item === button)); renderRecords(); }));
document.querySelector('#record-search').addEventListener('input', renderRecords);
applyLedgerContext();
render();
