/* The operator site's background worker (scope /ops/): the vault's uploads
   (ops/vault-upload.js) run here, so they go on with the vault closed and
   with the site's page closed, as long as the browser lets this run (Chrome
   and Edge come back to them by themselves with Background Sync); what is
   left goes on the next time the site is opened. It caches nothing and
   takes no part in the site's requests. */
importScripts('vault-upload.js');

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
