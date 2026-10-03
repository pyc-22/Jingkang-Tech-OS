const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const mobile = fs.readFileSync(path.join(root, 'manager-rewards.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'manager-rewards-admin.js'), 'utf8');
const home = fs.readFileSync(path.resolve(root, '../..', 'services/massage-api/src/main/java/com/chengxin/massage/HomeController.java'), 'utf8');
const service = fs.readFileSync(path.resolve(root, '../..', 'services/massage-api/src/main/java/com/chengxin/massage/operations/ManagerRewardService.java'), 'utf8');

test('mobile manager reward records expose historical correction form and PUT workflow', () => {
  assert.match(mobile, /更正约客/);
  assert.match(mobile, /name="orderId"/);
  assert.match(mobile, /name="customerName"/);
  assert.match(mobile, /name="customerPhone"/);
  assert.match(mobile, /name="note"/);
  assert.match(mobile, /method:'PUT'/);
  assert.match(mobile, /\/yue\/\$\{encodeURIComponent\(form\.dataset\.id\)\}/);
  assert.match(mobile, /businessDate <= today\(\)/);
  assert.match(mobile, /submissionKind === 'BACKFILL'/);
  assert.match(mobile, /class="backfill-badge">补录/);
  assert.match(mobile, /已补录 \$\{date\} 约客/);
});

test('same-day correction is not exposed in admin console', () => {
  assert.doesNotMatch(admin, /data-reward-admin-correction/);
  assert.doesNotMatch(admin, /manager-reward-admin-correction-dialog/);
  assert.match(admin, /row\.submissionKind === 'BACKFILL'/);
  assert.match(admin, /class="backfill-badge">补录/);
});

test('health endpoint reports the manager rewards release', () => {
  assert.match(home, /20261002-yue-backfill-v1/);
  assert.doesNotMatch(home, /20260924-|20260929-manager-rewards-v1/);
});

test('yue order submitted flags follow the active corrected order', () => {
  assert.match(service, /exists\(select 1 from manager_yue_record r[^]*r\.order_id=o\.id[^]*r\.active\) submitted/);
  assert.match(service, /update manager_yue_record set order_id=:order/);
  assert.match(service, /where id=:id and store_id=:store and active/);
});

test('historical submission resets the dispatched form and reloads its backfill record', async () => {
  const dom = new JSDOM(`<div id="manager-dashboard" class="hidden"></div><section id="manager-rewards-section">
    <input id="manager-reward-date" type="date" value="2026-09-30">
    <form id="manager-reward-yue-form"><select id="manager-reward-order"></select>
      <input id="manager-reward-file" type="file"><button type="submit">Submit</button></form>
    <div id="manager-reward-file-preview"></div><div id="manager-reward-yue-records"></div>
    <div id="manager-toast" class="hidden"></div></section>`, { url: 'http://localhost/', runScripts: 'outside-only' });
  const { window } = dom;
  try {
    window.localStorage.setItem('chengxin-manager-mobile-access-token', 'FIXTURE_TOKEN');
    window.localStorage.setItem('chengxin-manager-mobile-store-id', 'FIXTURE_STORE');
    let submitted = false;
    let recordLoads = 0;
    window.fetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        assert.equal(options.body.get('orderId'), 'ORDER');
        assert.equal(options.body.get('file').name, 'proof.png');
        submitted = true;
      }
      const pathname = new URL(url, window.location.href).pathname;
      let result = {};
      if (pathname.endsWith('/daily')) result = { businessDate: '2026-09-30', locked: false, onDutyDay: true };
      if (pathname.endsWith('/orders')) result = [{ orderId: 'ORDER', orderNo: 'ORDER', submitted }];
      if (pathname.endsWith('/records')) {
        recordLoads++;
        result = submitted ? [{ id: 'RECORD', orderNo: 'ORDER', submissionKind: 'BACKFILL', active: true }] : [];
      }
      return { ok: true, status: 200, json: async () => result };
    };
    window.eval(mobile);
    await window.ManagerRewards.load();
    const form = window.document.querySelector('#manager-reward-yue-form');
    window.document.querySelector('#manager-reward-order').value = 'ORDER';
    Object.defineProperty(window.document.querySelector('#manager-reward-file'), 'files', {
      value: [new window.File(['proof'], 'proof.png', { type: 'image/png' })]
    });
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(submitted, true);
    assert.equal(recordLoads, 2);
    assert.equal(window.document.querySelector('#manager-toast').textContent, '已补录 2026-09-30 约客');
    assert.equal(window.document.querySelector('#manager-reward-order').value, '');
    assert.equal(window.document.querySelector('#manager-reward-order option[value="ORDER"]').disabled, true);
    assert.equal(window.document.querySelector('.backfill-badge').textContent, '补录');
    assert.equal(form.querySelector('button').disabled, false);
  } finally {
    window.close();
  }
});
