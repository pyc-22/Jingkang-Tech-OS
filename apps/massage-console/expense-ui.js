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
  async error(response) {
    let message=`HTTP_${response.status}`;
    try { const body=await response.json(); message=body.message||body.error||message; } catch {}
    if (response.status===400||response.status===404) {
      try {
        const health=await fetch('/api/health',{cache:'no-store'});
        if (health.ok) {
          const api=await health.json();
          if (api.release&&!api.expenseClaimPaging&&api.release!=='20260918-expense-workspace-v1')
            return `费用报销前后端版本不一致（后端 ${api.release}），请同步更新并重启 API 服务。`;
        }
      } catch {}
    }
    return message;
  },
  async download(url, headers) {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(await this.error(response));
    const href = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = href; link.download = '费用报销.xlsx';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
};
if (typeof module !== 'undefined') module.exports = ExpenseUI;
