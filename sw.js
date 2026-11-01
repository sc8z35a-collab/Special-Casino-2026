/* Service worker: makes the game installable as an app ("ホーム画面に追加",
   Chrome's install) and lets it open without a connection. The pages and the
   code (scripts, styles) go to the network first, the cache only as a
   fallback; the pictures, fonts, sounds and videos, and the scripts and
   styles the page names by the hash of their file, are answered from the
   cache once it has them (see below); the API is never cached. */
const BUILD = 'f743ddd8210b';         // written by tools/stamp.mjs
const CACHE = 'two-state-' + BUILD;
// what is part of the build and so cannot change inside it
const ASSET = /^\/(img|fonts|sounds|video|icons)\//;
// A script or style the page names by the hash of its file (js/main.js?v=0123456789, tools/stamp.mjs): that address is that file for ever,
// whichever release asks. They live in a cache of their own that outlasts the releases (a release changes a few of ~90 files, the rest
// keep their address), at most CODE_MAX of them, the oldest first out.
const CODE_FILE = /^\/(js|css)\//;
const CODE_CACHE = 'two-state-code';
const CODE_MAX = 500;
const HASH = /^[0-9a-f]{10}$/;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.add('./')).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('two-state-') && k !== CACHE && k !== CODE_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// the hash of the file an address names, if it is one of those addresses
function codeHash(url) {
  const immutable = /^\/immutable\/([a-f0-9]{10})\/(?:js|css|ops|sec|link)\/[A-Za-z0-9._\/-]+\.(?:js|css)$/.exec(url.pathname);
  if (immutable) return immutable[1];
  const v = url.searchParams.get('v');
  return CODE_FILE.test(url.pathname) && HASH.test(v || '') ? v : '';
}

// A body is kept only if it is the file its address names (the first 10 hex digits of its SHA-256, as tools/stamp.mjs writes them): a
// release being deployed, a proxy or a half-sent file can never end up kept under an address that promises another one.
async function genuine(res, hash) {
  try {
    const sum = new Uint8Array(await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer()));
    return Array.from(sum.subarray(0, 5), (b) => b.toString(16).padStart(2, '0')).join('') === hash;
  } catch (x) { return false; }
}

async function keepCode(res, req, hash) {
  if (!res.ok || res.type !== 'basic' || res.status !== 200 || !(await genuine(res, hash))) return;
  const c = await caches.open(CODE_CACHE);
  await c.put(req, res.clone());
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - CODE_MAX))) await c.delete(k);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/download/') || url.pathname === '/version.json') return;
  // Code keeps stable URLs across releases. Revalidate it even when the
  // WebView's HTTP cache still considers the previous response fresh.
  const code = req.mode === 'navigate' || req.destination === 'script' || req.destination === 'style';
  // Scripts and styles by the hash of their file: kept once, never asked about again (a phone paid a round trip for each of ~90 of them
  // on every start). Only a body that really is that file is kept (keepCode).
  const hash = code && req.mode !== 'navigate' ? codeHash(url) : '';
  if (hash) {
    e.respondWith(caches.open(CODE_CACHE).then((c) => c.match(req, { ignoreVary: true })).then((hit) => hit || fetch(req, { cache: 'no-cache' }).then((res) => {
      e.waitUntil(keepCode(res.clone(), req, hash).catch(() => {}));
      return res;
    })));
    return;
  }
  // The pictures, fonts, sounds and videos are part of the build (tools/stamp.mjs hashes them) and this cache is named by the build: what
  // is in it is exactly what this release has at that address, and a new release starts with an empty one. So once it has a file, the file
  // is answered from here, without asking the server whether it changed (the server answers "max-age=0, must-revalidate" for them, and a
  // phone paid a round trip for each of ~70 of them on every start).
  if (!code && ASSET.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') c.put(req, res.clone()).catch(() => {});
      return res;
    }))));
    return;
  }
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

// The first visit is loaded before this worker takes the page over, so its pictures never passed through here. The page tells the worker
// which files it loaded (and which build it is: a page of an older build must not fill the cache of this one; the scripts and styles named
// by the hash of their file are the same for every build, and are checked against that hash), and the worker keeps the ones it does not
// have yet, copied from the browser's own cache (never asked of the server: a start that has just finished should not have the network
// taken by this; a file the browser no longer has is kept the next time it is used).
self.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.type !== 'keep' || d.build !== BUILD || !Array.isArray(d.urls)) return;
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    for (const u of d.urls.slice(0, 400)) {
      let url;
      try { url = new URL(u, self.location.href); } catch (x) { continue; }
      if (url.origin !== self.location.origin) continue;
      const hash = codeHash(url);
      if (!hash && !ASSET.test(url.pathname)) continue;
      try {
        const store = hash ? await caches.open(CODE_CACHE) : c;
        if (await store.match(url.href, { ignoreVary: true })) continue;
        const res = await fetch(url.href, { cache: 'only-if-cached', mode: 'same-origin' });
        if (hash) await keepCode(res, url.href, hash);
        else if (res.ok && res.type === 'basic' && res.status === 200) await c.put(url.href, res);
      } catch (x) { /* kept next time */ }
    }
  }));
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
