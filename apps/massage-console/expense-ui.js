/* Shared date and download behavior for the two reimbursement browsers. */
const ExpenseUI = {
  date(value) { return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(value); },
  range(preset = 'recent', now = new Date()) {
    const today = this.date(now), end = new Date(today + 'T00:00:00Z'), start = new Date(end);
    if (preset === 'week') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    else if (preset === 'month') start.setUTCDate(1);
    else if (preset === 'last-month') { start.setUTCDate(1); start.setUTCMonth(start.getUTCMonth() - 1); end.setUTCDate(0); }
    else if (preset !== 'today') start.setUTCDate(start.getUTCDate() - 29);
    return { from:start.toISOString().slice(0,10), to:end.toISOString().slice(0,10) };
  },
  time(value) { return value ? new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(value)) : '未提交'; },
  async download(url, headers) {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error((await response.json()).message || '导出失败');
    const href = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = href; link.download = '费用报销.xlsx';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
};
if (typeof module !== 'undefined') module.exports = ExpenseUI;
