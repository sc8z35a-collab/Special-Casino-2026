// The operator site's page names its scripts and styles by the hash of their file (tools/stamp.mjs), and its worker (ops/ops-sw.js) keeps
// them, checked against that hash, so a visit after the first asks the server nothing about the ~23 files that did not change.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startServer } from './helpers.js';
import { stampedOps, opsRef, stampedBuild } from '../../tools/stamp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const html = fs.readFileSync(path.join(ROOT, 'ops/index.html'), 'utf8');
const REFS = [...html.matchAll(/(?:src|href)="((?:\.\.\/js\/net\/)?[A-Za-z0-9._-]+\.(?:js|css))(\?v=[0-9a-f]+)?"/g)];

let s;
before(async () => { s = await startServer({ operators: ['taku'] }); });
after(async () => { await s.stop(); });

test('ops/index.html names every script and style by the hash of its file, and the server serves exactly that file at that address', async () => {
  assert.ok(REFS.length >= 20, 'the page has its scripts and styles');
  assert.equal(stampedOps(html), html, 'stamped (run node tools/stamp.mjs after changing a file of the operator site)');
  for (const [, ref, v] of REFS) assert.equal(v, '?v=' + sha(fs.readFileSync(path.join(ROOT, opsRef(ref)))), ref + ' is named by the hash of its file');
  // (the shared files of the game are named by the hash of the same file the game names)
  assert.ok(REFS.some((r) => r[1].startsWith('../js/net/')));
  for (const [, ref, v] of [REFS[0], REFS.find((r) => r[1].endsWith('.css')), REFS.find((r) => r[1].startsWith('../js/net/')), REFS.at(-1)]) {
    const res = await fetch(new URL(ref + v, s.base + '/ops/').href);
    assert.equal(res.status, 200, ref);
    assert.equal('?v=' + sha(Buffer.from(await res.arrayBuffer())), v, ref);
  }
  // an unstamped page is not a stamped build
  assert.ok(stampedBuild());
});

test('the stamp tool leaves everything else in ops/index.html as it is', () => {
  const other = html.replace(/\?v=[0-9a-f]{10}"/g, '?v=0000000000"');
  assert.notEqual(other, html);
  assert.equal(stampedOps(other), html, 'any hash is put right');
  assert.equal(stampedOps(html.replace(/\?v=[0-9a-f]{10}"/g, '"')), html, 'a missing one is added');
  // addresses that are not scripts or styles (the icons, the manifest, the pictures) keep their own
  for (const keep of ['href="manifest.webmanifest"', 'href="assets/site-192.png"', 'href="assets/wallpaper-login.webp"']) assert.ok(html.includes(keep), keep);
});

// ---- the worker ----
function worker() {
  const listeners = {}, calls = [], kept = new Map();
  let body = new Uint8Array(0), offline = false;
  const cache = {
    match: async (req) => kept.get(typeof req === 'string' ? req : req.url),
    put: async (req, res) => { kept.set(typeof req === 'string' ? req : req.url, res); },
    keys: async () => [...kept.keys()].map((url) => ({ url })),
    delete: async (k) => { kept.delete(k.url); return true; }
  };
  const respond = () => ({ ok: true, status: 200, type: 'basic', clone() { return this; }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) });
  const context = vm.createContext({
    self: { location: { origin: 'https://ops.test' }, addEventListener: (type, fn) => { listeners[type] = fn; }, skipWaiting() {}, clients: { claim() {}, matchAll: async () => [] }, registration: {} },
    URL, crypto: crypto.webcrypto, Uint8Array,
    importScripts() {}, VaultUploads: { engine: () => ({ wake: async () => {}, cancel() {}, run: async () => {}, pending: async () => 0 }) },
    fetch: async (req, options) => { calls.push({ url: typeof req === 'string' ? req : req.url, options }); if (offline) throw new Error('offline'); return respond(); },
    caches: { open: async () => cache }
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'ops/ops-sw.js'), 'utf8'), context);
  async function request(url, { destination = 'script', method = 'GET', range = false } = {}) {
    let result = null; const waits = [];
    listeners.fetch({
      request: { method, url, destination, headers: { has: (h) => range && h === 'range' } },
      respondWith: (p) => { result = p; }, waitUntil: (p) => waits.push(p)
    });
    const answered = result ? await result : null;
    await Promise.all(waits);
    return answered;
  }
  return { request, calls, kept, setBody: (b) => { body = b; }, offline: (v) => { offline = v; } };
}

test('a script named by the hash of its file is asked of the server once, checked against that hash, and then answered from the cache', async () => {
  const w = worker();
  const file = fs.readFileSync(path.join(ROOT, 'ops/ops.js'));
  w.setBody(new Uint8Array(file));
  const url = 'https://ops.test/ops/ops.js?v=' + sha(file);
  const first = await w.request(url);
  assert.ok(first, 'answered');
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].options.cache, 'no-cache', 'the first time, the server is asked afresh');
  assert.ok(w.kept.has(url), 'kept');
  w.offline(true);
  const again = await w.request(url);
  assert.ok(again, 'answered from the cache, with no network');
  assert.equal(w.calls.length, 1, 'the server was not asked again');
  // a shared file of the game, from the same cache the game's worker keeps its code in
  const net = fs.readFileSync(path.join(ROOT, 'js/net/secchannel.js'));
  w.offline(false); w.setBody(new Uint8Array(net));
  const shared = 'https://ops.test/js/net/secchannel.js?v=' + sha(net);
  assert.ok(await w.request(shared));
  assert.ok(w.kept.has(shared));
  assert.match(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), /const CODE_CACHE = 'two-state-code';/);
  assert.match(fs.readFileSync(path.join(ROOT, 'ops/ops-sw.js'), 'utf8'), /const CODE_CACHE = 'two-state-code';/, 'the game\'s worker clears every other cache of its prefix');
});

test('a body that is not the file its address names is shown but never kept; addresses without a hash, other kinds, the API and ranges are left alone', async () => {
  const w = worker();
  const file = fs.readFileSync(path.join(ROOT, 'ops/ops.js'));
  w.setBody(new Uint8Array(Buffer.from('not the file')));
  const url = 'https://ops.test/ops/ops.js?v=' + sha(file);
  assert.ok(await w.request(url), 'shown');
  assert.equal(w.kept.size, 0, 'not kept');
  const before = w.calls.length;
  // (the worker answers none of these: the browser asks the server as it always did)
  for (const [u, o] of [
    ['https://ops.test/ops/ops.js', {}],
    ['https://ops.test/ops/ops.js?v=nothex', {}],
    ['https://ops.test/ops/ops.js?v=' + sha(file), { destination: 'image' }],
    ['https://ops.test/ops/ops.js?v=' + sha(file), { destination: 'document' }],
    ['https://ops.test/ops/ops.js?v=' + sha(file), { method: 'POST' }],
    ['https://ops.test/ops/ops.js?v=' + sha(file), { range: true }],
    ['https://other.test/ops/ops.js?v=' + sha(file), {}],
    ['https://ops.test/api/ops/tick?v=' + sha(file), {}],
    ['https://ops.test/ops/assets/wallpaper.webp?v=' + sha(file), { destination: 'image' }]
  ]) assert.equal(await w.request(u, o), null, u + ' ' + JSON.stringify(o));
  assert.equal(w.calls.length, before, 'and the worker asked the server for none of them');
});
