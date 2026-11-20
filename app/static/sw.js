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
self.addEventListener('push',e=>{let p={};try{p=e.data.json();}catch{} e.waitUntil(self.registration.showNotification(p.title||'PetCare',{body:p.body||'Проверьте запланированные события.',icon:'/static/icon-192.png',badge:'/static/icon-192.png',tag:p.tag||'petcare',data:{url:'/'}}));});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{let w=windows.find(w=>new URL(w.url).origin===self.location.origin);return w?w.focus():clients.openWindow('/');}));});
