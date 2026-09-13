const CACHE_NAME = 'jingkang-technician-20260913-next-optimization-v2';
const ASSET_VERSION = '20260913-next-optimization-v2';
const APP_SHELL = [
  `./mobile.html?v=${ASSET_VERSION}`,
  `./technician.webmanifest?v=${ASSET_VERSION}`,
  `./mobile.js?v=${ASSET_VERSION}`,
  `./mobile.css?v=${ASSET_VERSION}`,
  `./mobile-clock.css?v=${ASSET_VERSION}`,
  `./mobile-extension.css?v=${ASSET_VERSION}`,
  `./mobile-dispatch-alert.css?v=${ASSET_VERSION}`,
  `./mobile-auth.css?v=${ASSET_VERSION}`,
  `./mobile-app.css?v=${ASSET_VERSION}`,
  `./offline-sync.css?v=${ASSET_VERSION}`,
  `./offline-sync.js?v=${ASSET_VERSION}`,
  `./login-portal.css?v=${ASSET_VERSION}`,
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
  }).catch(() => caches.match(request, { ignoreSearch: true })));
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
