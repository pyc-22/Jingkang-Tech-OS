(() => {
  const databaseName = 'jingkang-offline-operations';
  const storeName = 'operations';
  const operationHeader = 'X-Offline-Operation-Id';
  const adminTokenKey = 'chengxin-admin-access-token';
  const mobileTokenKey = 'chengxin-mobile-access-token';
  const nativeFetch = window.fetch.bind(window);
  let flushing = false;
  let isSubmitting = false;

  const id = () => window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const database = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath:'operationId' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function transaction(mode, action) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const result = action(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  const list = async () => (await transaction('readonly', store => store.getAll())) || [];
  const put = operation => transaction('readwrite', store => store.put(operation));
  const remove = operationId => transaction('readwrite', store => store.delete(operationId));
  const queueable = (url, method, body) => {
    if (!['POST','PUT','PATCH','DELETE'].includes(method) || body instanceof FormData || body instanceof Blob) return false;
    const path = new URL(url, location.href).pathname;
    return path.startsWith('/api/v1/service-sessions') || path.startsWith('/api/v1/service-reservations')
      || path.startsWith('/api/v1/service-room-transfers') || /^\/api\/v1\/rooms\/[^/]+\/(status|complete-cleaning|confirm-payment)$/.test(path)
      || /^\/api\/v1\/mobile\/technician\/(dispatch-notification\/(confirm|reject)|start-service|clock-out|extensions|service-room-transfers)$/.test(path);
  };
  const operationLabel = operation => {
    const path = new URL(operation.url, location.href).pathname;
    if (path.endsWith('/start-service')) return '开始服务';
    if (path.endsWith('/clock-out')) return '结束服务';
    if (path.endsWith('/extensions')) return '加钟';
    if (path.includes('room-transfers')) return '换房申请';
    if (path.includes('service-reservations')) return '预约派单';
    if (path.includes('service-sessions')) return '服务安排';
    if (path.includes('/rooms/')) return '房间状态更新';
    return '门店服务操作';
  };
  function authToken(operation) { return localStorage.getItem(new URL(operation.url, location.href).pathname.startsWith('/api/v1/mobile/') ? mobileTokenKey : adminTokenKey); }
  function announce(message) {
    const node = document.querySelector('#offline-sync-message');
    if (node) node.textContent = message;
  }
  async function render() {
    const operations = await list();
    const pending = operations.filter(item => item.state === 'PENDING').length;
    const conflicts = operations.filter(item => item.state === 'CONFLICT').length;
    const button = document.querySelector('#offline-sync-toggle');
    if (!button) return;
    button.hidden = operations.length === 0;
    button.textContent = conflicts ? `离线冲突 ${conflicts}` : `待同步 ${pending}`;
    button.classList.toggle('has-conflict', conflicts > 0);
    const rows = document.querySelector('#offline-sync-list');
    rows.innerHTML = operations.sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map(operation => `<article><div><b>${operationLabel(operation)}</b><small>${operation.state === 'CONFLICT' ? '数据已变化，请刷新后按当前状态重新操作' : '等待网络恢复后自动同步'} · ${new Date(operation.createdAt).toLocaleString('zh-CN')}</small></div><button type="button" data-offline-discard="${operation.operationId}">删除本地记录</button></article>`).join('') || '<p>当前没有待同步操作</p>';
  }
  function openPanel() { document.querySelector('#offline-sync-panel')?.classList.toggle('hidden', false); }
  function closePanel() { document.querySelector('#offline-sync-panel')?.classList.add('hidden'); }
  async function sync() {
    if (flushing || !navigator.onLine) return;
    flushing = true;
    try {
      const operations = (await list()).filter(operation => operation.state === 'PENDING').sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      for (const operation of operations) {
        const token = authToken(operation);
        if (!token) { announce('离线操作等待对应账号重新登录后同步'); break; }
        const headers = new Headers(operation.headers || {});
        headers.set('Authorization', `Bearer ${token}`);
        headers.set(operationHeader, operation.operationId);
        try {
          const response = await nativeFetch(operation.url, { method:operation.method, headers, body:operation.body || undefined });
          if (response.ok) await remove(operation.operationId);
          else if (response.status === 401) { announce('离线操作等待重新登录后同步'); break; }
          else if (response.status === 409 || (response.status >= 400 && response.status < 500)) await put({ ...operation, state:'CONFLICT', lastError:`HTTP ${response.status}` });
        } catch { break; }
      }
    } finally { flushing = false; await render(); }
  }
  function operationRequest(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const method = String(init.method || (typeof input === 'string' ? 'GET' : input.method || 'GET')).toUpperCase();
    const headers = new Headers(init.headers || (typeof input === 'string' ? undefined : input.headers));
    const body = init.body == null ? null : typeof init.body === 'string' ? init.body : null;
    return { url, method, headers, body };
  }
  const writePath = (url, method) => {
    if (!['POST','PUT','PATCH','DELETE'].includes(method)) return false;
    const path = new URL(url, location.href).pathname;
    return path === '/api/v1/sales-orders/settle'
      || /^\/api\/v1\/sales-orders\/[^/]+\/(void|refunds)$/.test(path)
      || /^\/api\/v1\/refunds\/[^/]+\/payments\/[^/]+\/complete$/.test(path)
      || /^\/api\/v1\/service-sessions\/[^/]+\/(start-service|clock-out|extensions)$/.test(path)
      || path === '/api/v1/service-sessions/clock-in'
      || /^\/api\/v1\/members\/[^/]+\/recharges$/.test(path)
      || path === '/api/v1/member-wallet/recharge'
      || /^\/api\/v1\/rooms\/[^/]+\/status$/.test(path)
      || /^\/api\/v1\/mobile\/technician\/(start-service|clock-out|extensions)$/.test(path);
  };
  const notify = message => {
    const node = document.querySelector('#toast, #mobile-toast, #manager-toast');
    if (!node) return;
    node.textContent = message;
    node.classList.remove('hidden');
    window.setTimeout(() => node.classList.add('hidden'), 2200);
  };
  window.idempotentFetch = async (input, init = {}) => {
    const request = operationRequest(input, init);
    if (!writePath(request.url, request.method)) return nativeFetch(input, init);
    if (isSubmitting) {
      notify('操作正在处理，请稍候');
      return new Response(JSON.stringify({ message:'操作正在处理，请稍候' }), { status:409, headers:{ 'Content-Type':'application/json' } });
    }
    const operationId = request.headers.get(operationHeader) || id();
    request.headers.set(operationHeader, operationId);
    const trigger = init.submitter || document.activeElement;
    const button = trigger && trigger.closest
      ? trigger.closest('button') || trigger.form?.querySelector('button[type="submit"], input[type="submit"]')
      : null;
    const wasDisabled = button?.disabled;
    if (button) button.disabled = true;
    isSubmitting = true;
    const options = { ...init, headers:request.headers };
    try {
      const response = await nativeFetch(input, options);
      if (response.status === 204) {
        return new Response('{}', { status:200, headers:{ 'Content-Type':'application/json', 'X-Offline-Operation-Replayed':'true' } });
      }
      return response;
    } finally {
      isSubmitting = false;
      if (button && !wasDisabled) button.disabled = false;
    }
  };
  window.fetch = async (input, init = {}) => {
    const request = operationRequest(input, init);
    if (writePath(request.url, request.method)) {
      const operationId = request.headers.get(operationHeader) || id();
      request.headers.set(operationHeader, operationId);
      const options = { ...init, headers:request.headers };
      try {
        const response = await window.idempotentFetch(input, options);
        if (response.status === 409) notify('操作正在处理，请稍候');
        return response;
      } catch (error) {
        if (!queueable(request.url, request.method, init.body)) throw error;
        if (!(error instanceof TypeError) && navigator.onLine) throw error;
        await put({ operationId, url:request.url, method:request.method, body:request.body, headers:Object.fromEntries([...request.headers].filter(([key]) => !['authorization', operationHeader.toLowerCase()].includes(key.toLowerCase()))), state:'PENDING', createdAt:new Date().toISOString() });
        await render();
        announce(`${operationLabel({ url:request.url })}已离线暂存，将在网络恢复后同步`);
        window.dispatchEvent(new CustomEvent('offline-operation-queued', { detail:{ operationId, url:request.url } }));
        return new Response(JSON.stringify({ offlineQueued:true, operationId }), { status:202, headers:{ 'Content-Type':'application/json', 'X-Offline-Queued':'true' } });
      }
    }
    if (!queueable(request.url, request.method, init.body)) return nativeFetch(input, init);
    const operationId = request.headers.get(operationHeader) || id();
    request.headers.set(operationHeader, operationId);
    const options = { ...init, headers:request.headers };
    try { return await nativeFetch(input, options); }
    catch (error) {
      if (!(error instanceof TypeError) && navigator.onLine) throw error;
      await put({ operationId, url:request.url, method:request.method, body:request.body, headers:Object.fromEntries([...request.headers].filter(([key]) => !['authorization', operationHeader.toLowerCase()].includes(key.toLowerCase()))), state:'PENDING', createdAt:new Date().toISOString() });
      await render();
      announce(`${operationLabel({ url:request.url })}已离线暂存，将在网络恢复后同步`);
      window.dispatchEvent(new CustomEvent('offline-operation-queued', { detail:{ operationId, url:request.url } }));
      return new Response(JSON.stringify({ offlineQueued:true, operationId }), { status:202, headers:{ 'Content-Type':'application/json', 'X-Offline-Queued':'true' } });
    }
  };
  document.body.insertAdjacentHTML('beforeend', '<button class="offline-sync-toggle" id="offline-sync-toggle" type="button" hidden>待同步 0</button><section class="offline-sync-panel hidden" id="offline-sync-panel"><header><div><b>离线操作同步</b><small id="offline-sync-message">网络恢复后将按原顺序同步服务操作</small></div><button type="button" id="offline-sync-close" aria-label="关闭">×</button></header><div id="offline-sync-list"></div><footer><button type="button" id="offline-sync-now">立即同步</button></footer></section>');
  document.querySelector('#offline-sync-toggle').addEventListener('click', openPanel);
  document.querySelector('#offline-sync-close').addEventListener('click', closePanel);
  document.querySelector('#offline-sync-now').addEventListener('click', sync);
  document.querySelector('#offline-sync-list').addEventListener('click', async event => { const discard = event.target.closest('[data-offline-discard]'); if (!discard) return; await remove(discard.dataset.offlineDiscard); await render(); });
  window.addEventListener('online', sync);
  window.setInterval(sync, 15000);
  render();
  window.OfflineOperationQueue = { sync, list, discard:remove };
})();
