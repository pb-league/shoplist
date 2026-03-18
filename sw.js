// ============================================================
// PANTRY — Service Worker (sw.js)
// Caches app shell for offline access / fast loads
// ============================================================

const CACHE     = 'pantry-v1';
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './style.css',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Never intercept calls to Google (sheet API, fonts)
  if (e.request.url.includes('google') || e.request.url.includes('fonts')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      // Return cache first, fetch in background to update
      const network = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
