/* The operator site's background worker (scope /ops/): the vault's uploads
   (ops/vault-upload.js) run here, so they go on with the vault closed and
   with the site's page closed, as long as the browser lets this run (Chrome
   and Edge come back to them by themselves with Background Sync); what is
   left goes on the next time the site is opened.

   It also keeps the scripts and styles the page names by the hash of their
   file (ops/index.html, tools/stamp.mjs: ops.js?v=0123456789), as the
   game's worker does (sw.js): that address is that file for ever, so a
   visit after the first asks the server nothing about the ~23 files that
   did not change. Nothing else is answered here: the page itself, the API,
   the pictures and everything without such a hash go to the server as ever. */
importScripts('vault-upload.js');

// The code cache is the game's (the files are kept by the hash of their body, so what is shared is the same file whoever put it there), and
// the game's worker clears every other cache of its prefix, so it must keep this name.
const CODE_CACHE = 'two-state-code';
const CODE_MAX = 500;
const CODE_FILE = /^\/(ops|js|css)\/[A-Za-z0-9._/-]+\.(js|css)$/;
const HASH = /^[0-9a-f]{10}$/;

// the hash of the file an address names, if it is one of those addresses
function codeHash(url) {
  const immutable = /^\/immutable\/([a-f0-9]{10})\/(?:js|css|ops|sec|link)\/[A-Za-z0-9._\/-]+\.(?:js|css)$/.exec(url.pathname);
  if (immutable) return immutable[1];
  const v = url.searchParams.get('v');
  return CODE_FILE.test(url.pathname) && HASH.test(v || '') ? v : '';
}

// A body is kept only if it is the file its address names (the first 10 hex digits of its SHA-256, as tools/stamp.mjs writes them): a release
// being deployed, a proxy or a half-sent file can never end up kept under an address that promises another one.
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
  if (req.destination !== 'script' && req.destination !== 'style') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const hash = codeHash(url);
  if (!hash) return;
  // (a cache that cannot be opened — storage turned off, a private window — is no reason for the page not to load: it goes to the server)
  e.respondWith(caches.open(CODE_CACHE).then((c) => c.match(req, { ignoreVary: true })).catch(() => null).then((hit) => hit || fetch(req, { cache: 'no-cache' }).then((res) => {
    e.waitUntil(keepCode(res.clone(), req, hash).catch(() => {}));
    return res;
  })));
});

const engine = VaultUploads.engine({
  // every open page of the site hears how each file is doing
  tell(job) {
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if (new URL(c.url).pathname.startsWith('/ops/')) c.postMessage({ type: 'vault-upload', job });
    });
  },
  // (a file the page keeps in its memory only is the page's to send)
  mine: (job) => !job.mem
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// run: from the page (files added, 再開, now and then while it is open)
self.addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.type === 'kick') e.waitUntil(work());
  // (the connection back, a new login: the stopped files at once)
  else if (m.type === 'wake') e.waitUntil(engine.wake().then(work));
  else if (m.type === 'cancel' && m.key) engine.cancel(m.key);
});
// the browser coming back to what is left (Background Sync, where there is one)
self.addEventListener('sync', (e) => {
  if (e.tag === 'vault-upload') e.waitUntil(engine.run().then(() => engine.pending()).then((left) => { if (left) throw new Error('more to send'); }));
});

function work() {
  return engine.run().then(() => engine.pending()).then((left) => {
    if (left && self.registration.sync) return self.registration.sync.register('vault-upload').catch(() => {});
    return null;
  });
}
