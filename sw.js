/* Service worker: makes the game installable as an app ("ホーム画面に追加",
   Chrome's install) and lets it open without a connection. Always the
   network first, the cache only as a fallback; the API is never cached. */
const BUILD = '574c4de5679e';          // written by tools/stamp.mjs
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
  // Code keeps stable URLs across releases. Revalidate it even when the
  // WebView's HTTP cache still considers the previous response fresh.
  const code = req.mode === 'navigate' || req.destination === 'script' || req.destination === 'style';
  e.respondWith(fetch(req, code ? { cache: 'no-cache' } : undefined).then((res) => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate'
    ? caches.match('./')
    : Response.error()))));
});

// Phone notifications (server/core/push.js): a message, a call or an
// invitation while the game is not in sight. Shown with the phone's sound and
// vibration; nothing is shown when the game is open in front of the player.
self.addEventListener('push', (e) => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch (x) { n = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    if (list.some((c) => c.visibilityState === 'visible' && c.focused)) return null;
    const call = n.kind === 'call';
    return self.registration.showNotification(n.title || 'Two state Casino RP', {
      body: n.body || '',
      tag: n.tag || 'two-state',
      renotify: true,
      requireInteraction: call,
      silent: false,
      vibrate: call ? [400, 200, 400, 200, 400] : [200, 100, 200],
      icon: 'icons/icon-192.png?v=coin-20261025',
      badge: 'icons/icon-192.png?v=coin-20261025',
      timestamp: n.at || Date.now(),
      data: { open: n.open || '' }
    });
  }));
});

// a tap opens the game (or brings it to the front) where the notification leads
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const open = (e.notification.data && e.notification.data.open) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list.find((w) => new URL(w.url).origin === self.location.origin);
    if (c) {
      c.postMessage({ type: 'open', open });
      return c.focus();
    }
    return self.clients.openWindow('./' + (open ? '?open=' + encodeURIComponent(open) : ''));
  }));
});
