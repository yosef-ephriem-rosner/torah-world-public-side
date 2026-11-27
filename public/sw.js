// Minimal service worker: lets the site install as an app and keeps the shell + fonts available offline. Texts/API are always fetched live.
const V = 'tw-shell-1';
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(['/', '/styles.css', '/app.js', '/fonts.css', '/daf-renderer.js', '/layouts.js'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // network first (so deploys show immediately), cache as fallback when offline
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});
