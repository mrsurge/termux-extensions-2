// Minimal service worker for Termux Extensions PWA
const CACHE_NAME = 'te2-cache-v1';
const ASSETS = [
  '/',
  '/static/manifest.webmanifest',
  '/static/icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))).then(
      () => self.clients.claim()
    )
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Network-first for API and dynamic content, cache-first for others
  if (req.url.includes('/api/')) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
  } else {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});
