const CACHE='petcare-public-v4';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/static/offline.html','/static/offline.js','/static/icon-192.png']))); self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
// Never cache API responses, documents, credentials or authenticated HTML.
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.url === new URL('/static/offline.js', self.location.origin).href) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(request)).then(cached => cached ?? fetch(request)));
  } else if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then(cache => cache.match('/static/offline.html'))));
  }
});
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data.json(); } catch {}
  event.waitUntil(self.registration.showNotification(payload.title || 'PetCare', {
    body: payload.body || 'Проверьте запланированные события.',
    icon: '/static/icon-192.png', badge: '/static/icon-192.png', tag: payload.tag || 'petcare',
    data: { inbox: payload.page === 'profile' }
  }));
});

self.addEventListener('notificationclick', event => {
  const inbox = event.notification.data?.inbox;
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const client = windows.find(window => new URL(window.url).origin === self.location.origin);
    if (!client) return clients.openWindow(inbox ? '/#/profile/notifications' : '/');
    if (inbox) client.postMessage({ type: 'petcare-open-inbox' });
    return client.focus();
  }));
});
