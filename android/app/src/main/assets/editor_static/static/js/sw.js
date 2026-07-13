// Service worker for Termux Extensions PWA
// Version is injected by the server at serve time.
const ASSET_VERSION = '__ASSET_VERSION__';
const CACHE_NAME = 'te2-v' + ASSET_VERSION;

// Critical assets pre-cached on install
const PRECACHE = [
  '/',
  '/static/manifest.webmanifest',
  '/static/icon.png',
  '/static/vendor/socket.io.min.js',
  '/static/vendor/es-module-shims/dist/es-module-shims.js',
  '/static/js/ws_port.js',
  '/static/js/te_state.js',
  '/static/js/te_ui.js',
  '/static/js/jobs_client.js',
  '/static/js/file_picker.js',
  '/static/vendor/codicons/codicon.css',
  '/static/vendor/codicons/codicon.ttf',
];

// Path prefixes eligible for runtime caching (mirrors GeckoView asset_intercept)
const CACHE_PREFIXES = [
  '/static/vendor/codicons/',
  '/static/vendor/seti-icons/',
  '/static/vendor/es-module-shims/',
  '/static/vendor/xterm/',
  '/static/vendor/monaco-editor-core/te2-lang/bootstrap/',
  '/static/vendor/monaco-editor-core/te2-lang/basic-languages/',
  '/static/vendor/monaco-editor-core/te2-lang/language/',
  '/static/vendor/monaco-editor-core/esm/',
  '/static/fonts/',
  '/static/js/',
  '/apps/file_editor_cm6/static/',
  '/api/app/file_editor_cm6/ui/monaco_editor/',
  '/api/app/file_editor_cm6/ui/monaco_vscode/lang/',
  '/api/app/file_editor_cm6/ui/monaco_vscode/esm/',
];

// Workers stay network-only (large, rarely change independently)
const WORKER_RE = /\/te2-lang\/workers\//;

function shouldCache(url) {
  try {
    const path = new URL(url).pathname;
    if (WORKER_RE.test(path)) return false;
    if (path.startsWith('/api/') && !CACHE_PREFIXES.some(p => path.startsWith(p))) return false;
    return CACHE_PREFIXES.some(p => path.startsWith(p));
  } catch (_) {
    return false;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  // Cacheable static assets — cache-first, fallback to network (then cache)
  if (shouldCache(url)) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return resp;
        });
      })
    );
    return;
  }

  // Navigation remains network-first for PWA clients. Other requests bypass the worker.
  if (req.mode !== 'navigate') return;

  event.respondWith(
    fetch(req).then(resp => {
      if (resp.ok) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, clone));
      }
      return resp;
    }).catch(async () => (await caches.match(req)) || caches.match('/'))
  );
});
