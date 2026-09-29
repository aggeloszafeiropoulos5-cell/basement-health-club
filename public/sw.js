// Only the static offline page is cached, never sessions, APIs or member data.
const CACHE = 'basement-offline-v25';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add('/offline.html')).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('basement-offline-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
});
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}
  const allowed = ['/dashboard?tab=calendar', '/dashboard?tab=packages', '/dashboard?tab=notifications'];
  event.waitUntil(self.registration.showNotification(String(data.title || 'Basement Health Club'), {
    body: String(data.body || 'Έχεις μια νέα ενημέρωση. Άνοιξε την εφαρμογή.'),
    icon: '/icons/icon-192.png', badge: '/icons/badge.png',
    tag: String(data.tag || 'basement-update'), renotify: false,
    data: { url: allowed.includes(data.url) ? data.url : '/dashboard' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/dashboard', self.location.origin);
  if (target.origin !== self.location.origin || target.pathname !== '/dashboard') return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const client = clients.find(item => new URL(item.url).origin === self.location.origin);
    if (client) { await client.navigate(target.href); return client.focus(); }
    return self.clients.openWindow(target.href);
  }));
});
