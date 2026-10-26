import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

test('an app update clears only game caches, detaches only the game worker and navigates once', async () => {
  const elements = new Map(), removed = [], unregistered = [], navigations = [], registrations = [];
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, { classList: { toggle() {} }, querySelector: child => $(selector + ' ' + child), addEventListener() {} });
    return elements.get(selector);
  };
  const caches = { keys: async () => ['two-state-old', 'other-application'], delete: async key => removed.push(key) };
  const workers = ['/sw.js', '/ops/ops-sw.js'].map(path => ({ active: { scriptURL: 'https://game.test' + path }, unregister: async () => unregistered.push(path) }));
  let nativeClears = 0;
  const serviceWorker = { register: async (...args) => { registrations.push(args); }, getRegistrations: async () => workers };
  const BR = { util: { $ }, api: { online: true }, kit: { sfx() {}, toast() {}, registerModal() {} } };
  const context = vm.createContext({
    window: { BR, caches, TwoStateApp: { clearWebCache() { nativeClears++; } }, addEventListener() {} },
    navigator: { userAgent: 'Android TwoStateCasinoApp/1.0.12', serviceWorker }, caches,
    location: { href: 'https://game.test/?open=friends', protocol: 'https:', hostname: 'game.test', search: '?open=friends', replace: url => navigations.push(url) },
    document: { addEventListener() {}, head: { appendChild() {} } }, URL,
    sessionStorage: { setItem() {} }, fetch: async () => ({ ok: false }),
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() {}
  });
  vm.runInContext(fs.readFileSync(new URL('../../js/ui/install.js', import.meta.url), 'utf8'), context);
  BR.install.init(); BR.install.update(); BR.install.update();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(nativeClears, 1);
  assert.deepEqual(removed, ['two-state-old']);
  assert.deepEqual(unregistered, ['/sw.js']);
  assert.equal(navigations.length, 1);
  const target = new URL(navigations[0]);
  assert.equal(target.searchParams.get('open'), 'friends'); assert.ok(target.searchParams.has('_update'));
  assert.equal(registrations[0][1].updateViaCache, 'none');
});

test('the game worker revalidates scripts and styles while retaining network-failure fallback', async () => {
  const listeners = {}, calls = [];
  let offline = false;
  const response = { ok: true, type: 'basic', clone() { return this; } };
  const context = vm.createContext({
    self: { location: { origin: 'https://game.test' }, addEventListener: (type, fn) => listeners[type] = fn }, URL,
    fetch: async (req, options) => { calls.push({ req, options }); if (offline) throw Error('offline'); return response; },
    caches: { open: async () => ({ put() {} }), match: async () => 'offline-copy' }, Response: { error() { return 'error'; } }
  });
  vm.runInContext(fs.readFileSync(new URL('../../sw.js', import.meta.url), 'utf8'), context);
  async function request(destination, mode = 'cors') {
    let result;
    listeners.fetch({ request: { method: 'GET', headers: { has: () => false }, url: 'https://game.test/js/main.js', destination, mode }, respondWith: p => result = p });
    return await result;
  }
  assert.equal(await request('script'), response); assert.equal(calls.at(-1).options.cache, 'no-cache');
  assert.equal(await request('style'), response); assert.equal(calls.at(-1).options.cache, 'no-cache');
  await request('document', 'navigate'); assert.equal(calls.at(-1).options.cache, 'no-cache');
  await request('image'); assert.equal(calls.at(-1).options, undefined);
  offline = true; assert.equal(await request('script'), 'offline-copy');
});

// ---- the pictures, fonts, sounds and videos: answered from the build's cache once it has them ----
function worker({ cached = new Map(), offline = false, bodies = {}, cacheNames = [] } = {}) {
  const listeners = {}, network = [], kept = new Map(cached), deleted = [], gone = [];
  const keyOf = (key) => (typeof key === 'string' ? key : key.url);
  const cache = {
    put: async (key, res) => { kept.set(keyOf(key), res); },
    match: async (key) => kept.get(keyOf(key)),
    keys: async () => [...kept.keys()].map((url) => ({ url })),
    delete: async (key) => { deleted.push(keyOf(key)); return kept.delete(keyOf(key)); }
  };
  const context = vm.createContext({
    self: { location: { origin: 'https://game.test', href: 'https://game.test/sw.js' }, addEventListener: (type, fn) => { listeners[type] = fn; }, skipWaiting() {}, clients: { claim: async () => {} } }, URL, crypto: crypto.webcrypto,
    fetch: async (req, options) => {
      const url = typeof req === 'string' ? req : req.url;
      network.push({ url, options });
      if (offline) throw Error('offline');
      const body = Buffer.from(bodies[new URL(url).pathname] ?? 'x');
      return { ok: true, status: 200, type: 'basic', url, clone() { return this; }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
    },
    caches: { open: async () => cache, match: async () => undefined, keys: async () => cacheNames, delete: async (k) => { gone.push(k); return true; } }, Response: { error: () => 'error' }
  });
  const source = fs.readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const build = source.match(/const BUILD = '([^']+)'/)[1];
  const get = async (path, over = {}) => {
    let result;
    const waits = [];
    const req = { method: 'GET', headers: { has: () => false }, url: 'https://game.test' + path, destination: 'image', mode: 'no-cors', ...over };
    listeners.fetch({ request: req, respondWith: (p) => { result = p; }, waitUntil: (p) => { waits.push(p); } });
    const answer = result === undefined ? undefined : await result;
    await Promise.all(waits);
    return answer;
  };
  return { get, network, kept, deleted, gone, listeners, build };
}
const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 10);

test('a file of the build is answered from the cache when it is there, and asked of the server only the first time', async () => {
  const w = worker();
  const first = await w.get('/img/ui/refresh/vip.webp');
  assert.equal(w.network.length, 1, 'the first time it goes to the server');
  assert.ok(w.kept.has('https://game.test/img/ui/refresh/vip.webp'), 'and is kept');
  const second = await w.get('/img/ui/refresh/vip.webp');
  assert.equal(w.network.length, 1, 'the second time it does not');
  assert.equal(second, first);
  for (const p of ['/fonts/NotoJP-500.woff2', '/sounds/click.wav', '/video/studio-low.mp4', '/icons/icon-192.png?v=coin-20261025']) {
    await w.get(p);
    await w.get(p);
  }
  assert.equal(w.network.length, 5, 'one trip each');
});

test('the code, the pages, the API, other origins and ranges are not served from the cache', async () => {
  const w = worker({ cached: new Map([['https://game.test/js/main.js', 'old'], ['https://game.test/', 'old'], ['https://game.test/api/me', 'old']]) });
  assert.notEqual(await w.get('/js/main.js', { destination: 'script' }), 'old');
  assert.equal(w.network.at(-1).options.cache, 'no-cache');
  assert.notEqual(await w.get('/', { destination: 'document', mode: 'navigate' }), 'old');
  assert.equal(await w.get('/api/me'), undefined);
  assert.equal(await w.get('/img/a.webp', { headers: { has: (n) => n === 'range' } }), undefined);
  assert.equal(await w.get('/img/a.webp', { url: 'https://cdn.test/img/a.webp' }), undefined);
  assert.equal(await w.get('/img/a.webp', { method: 'POST' }), undefined);
  // (a script under /img/ is still code)
  await w.get('/img/odd.js', { destination: 'script' });
  assert.equal(w.network.at(-1).options.cache, 'no-cache');
});

test('the page can ask the worker to keep what it loaded: only this build, only the build\'s files, only what is missing, and never from the server', async () => {
  const w = worker({ cached: new Map([['https://game.test/img/have.webp', 'x']]) });
  const keep = (data) => w.listeners.message({ data, waitUntil: (p) => { keep.p = p; } });
  keep({ type: 'keep', build: 'another', urls: ['https://game.test/img/old.webp'] });
  assert.equal(keep.p, undefined, 'a page of another build is ignored');
  keep({ type: 'other' });
  assert.equal(keep.p, undefined);
  keep({ type: 'keep', build: w.build, urls: ['https://game.test/img/have.webp', 'https://game.test/img/new.webp', 'https://game.test/fonts/a.woff2', 'https://evil.test/img/x.webp', 'https://game.test/js/main.js', 'https://game.test/api/me', 'not a url ::'] });
  await keep.p;
  assert.deepEqual(w.network.map((n) => n.url), ['https://game.test/img/new.webp', 'https://game.test/fonts/a.woff2'], 'only the missing files of the build');
  assert.ok(w.network.every((n) => n.options.cache === 'only-if-cached' && n.options.mode === 'same-origin'), 'copied from the browser\'s own cache, never asked of the server');
  assert.ok(w.kept.has('https://game.test/img/new.webp') && w.kept.has('https://game.test/fonts/a.woff2'));
  // a file the browser no longer has is left for the next time it is used
  const lost = worker({ offline: true });
  const k2 = (data) => lost.listeners.message({ data, waitUntil: (p) => { k2.p = p; } });
  k2({ type: 'keep', build: lost.build, urls: ['https://game.test/img/gone.webp'] });
  await k2.p;
  assert.equal(lost.kept.size, 0);
});

// ---- scripts and styles named by the hash of their file (tools/stamp.mjs writes the addresses into index.html) ----
test('a script named by the hash of its file is asked of the server once, checked against that hash, and then answered from the cache', async () => {
  const code = 'window.BR = 1;';
  const path = '/js/main.js?v=' + hashOf(code);
  const w = worker({ bodies: { '/js/main.js': code } });
  const first = await w.get(path, { destination: 'script' });
  assert.equal(w.network.length, 1);
  assert.equal(w.network[0].options.cache, 'no-cache');
  assert.ok(w.kept.has('https://game.test' + path), 'kept under its address');
  const second = await w.get(path, { destination: 'script' });
  assert.equal(w.network.length, 1, 'the second time the server is not asked at all');
  assert.equal(second, first);
  // styles too; a new release of the file has a new address and is asked for
  const css = 'a{}';
  const w2 = worker({ bodies: { '/css/style.css': css } });
  await w2.get('/css/style.css?v=' + hashOf(css), { destination: 'style' });
  await w2.get('/css/style.css?v=' + hashOf(css), { destination: 'style' });
  await w2.get('/css/style.css?v=' + hashOf('b{}'), { destination: 'style' });
  assert.equal(w2.network.length, 2);
});

test('a body that is not the file its address names is shown but never kept, and addresses without a hash stay network first', async () => {
  const w = worker({ bodies: { '/js/main.js': 'another release, half sent, or a proxy page' } });
  const path = '/js/main.js?v=' + hashOf('the real file');
  await w.get(path, { destination: 'script' });
  assert.equal(w.kept.has('https://game.test' + path), false, 'not kept');
  await w.get(path, { destination: 'script' });
  assert.equal(w.network.length, 2, 'so it is asked for again');
  // not a hash (or not code at all): the usual way
  for (const p of ['/js/main.js', '/js/main.js?v=dev', '/js/main.js?v=' + hashOf('x') + 'ff', '/img/odd.js?v=' + hashOf('x')]) await w.get(p, { destination: 'script' });
  assert.ok(w.network.slice(2).every((n) => n.options.cache === 'no-cache'));
  assert.equal(w.kept.has('https://game.test/js/main.js?v=dev'), true, 'kept as a fallback for a lost connection, as any code is');
  // the page (navigation) with a ?v= is still a page
  await w.get('/?v=' + hashOf('x'), { destination: 'document', mode: 'navigate' });
  assert.equal(w.network.at(-1).options.cache, 'no-cache');
});

test('the code cache outlives the releases and holds the newest 500 files', async () => {
  const old = new Map();
  for (let i = 0; i < 500; i++) old.set('https://game.test/js/f' + i + '.js?v=' + String(i).padStart(10, '0'), 'x');
  const w = worker({ cached: old, bodies: { '/js/new.js': 'new' } });
  await w.get('/js/new.js?v=' + hashOf('new'), { destination: 'script' });
  assert.equal(w.kept.size, 500);
  assert.deepEqual(w.deleted, ['https://game.test/js/f0.js?v=0000000000'], 'the oldest one goes');
  // a new release's worker deletes the other caches of the game, not the code cache and not its own
  const act = worker({ cacheNames: ['two-state-code', 'two-state-oldbuild', 'other-application'] });
  const own = 'two-state-' + act.build;
  act.listeners.activate({ waitUntil: (p) => { act.listeners.activate.p = p; } });
  await act.listeners.activate.p;
  assert.deepEqual(act.gone, ['two-state-oldbuild']);
  assert.ok(own);
});

test('the page can have its scripts and styles kept too: only the files whose body matches their hash, copied from the browser\'s cache', async () => {
  const code = 'var a = 1;', other = 'var b = 2;';
  const w = worker({ bodies: { '/js/a.js': code, '/js/b.js': 'not what the hash says' } });
  const keep = (data) => w.listeners.message({ data, waitUntil: (p) => { keep.p = p; } });
  const urls = ['https://game.test/js/a.js?v=' + hashOf(code), 'https://game.test/js/b.js?v=' + hashOf(other), 'https://game.test/js/c.js', 'https://evil.test/js/a.js?v=' + hashOf(code)];
  keep({ type: 'keep', build: w.build, urls });
  await keep.p;
  assert.ok(w.kept.has(urls[0]), 'a genuine file is kept');
  assert.equal(w.kept.has(urls[1]), false, 'a file that is not what its address says is not');
  assert.deepEqual(w.network.map((n) => n.url), [urls[0], urls[1]], 'no address without a hash, no other origin');
  assert.ok(w.network.every((n) => n.options.cache === 'only-if-cached'));
});
