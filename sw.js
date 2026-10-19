/* Service worker: makes the game installable as an app ("ホーム画面に追加",
   Chrome's install) and lets it open without a connection. Always the
   network first, the cache only as a fallback; the API is never cached. */
const BUILD = '7520fe9fb4a0';          // written by tools/stamp.mjs
const CACHE = 'two-state-' + BUILD;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.add('./')).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('two-state-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/download/') || url.pathname === '/version.json') return;
  // the story plays once per player: not worth keeping
  if (url.pathname === '/video/intro.mp4') return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate'
    ? caches.match('./')
    : Response.error()))));
});
