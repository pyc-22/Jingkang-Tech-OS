const CACHE_NAME = 'jingkang-technician-20260911-p0-conflict-fix-v1';
const APP_SHELL = [
  './mobile.html',
  './mobile.js',
  './mobile.css',
  './mobile-clock.css',
  './mobile-extension.css',
  './mobile-dispatch-alert.css',
  './mobile-auth.css',
  './mobile-app.css',
  './offline-sync.css',
  './offline-sync.js',
  './login-portal.css',
  './assets/technician-dispatch-alert.mp3',
  './assets/service-reminder-ten-minutes.mp3',
  './assets/service-reminder-five-minutes.mp3',
  './assets/service-reminder-finished.mp3'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // API responses are user- and room-state-specific, so they must always reach the server.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Keep installed technician apps current while retaining an offline fallback.
  event.respondWith(fetch(request).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    return response;
  }).catch(() => caches.match(request)));
});

self.addEventListener('push', event => {
  const payload = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(payload.title || 'Jingkang Technician', {
    body: payload.body || 'You have a new dispatch. Please confirm it.',
    tag: payload.tag || 'technician-dispatch',
    renotify: true,
    data: { url: './mobile.html' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || './mobile.html'));
});
