// Ahead service worker: réseau d'abord (jamais de code périmé en démo), cache = secours hors ligne.
// /api/* n'est jamais mis en cache (Nessie et coach doivent toujours être en direct).
const CACHE = 'ahead-v1';
const SHELL = ['/', '/index.html', '/style.css', '/engine.js', '/app.js', '/assets/icon-192.png', '/assets/logo-192.jpg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
});
