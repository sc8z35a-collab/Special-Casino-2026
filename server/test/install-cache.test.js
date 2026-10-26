import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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
function worker({ cached = new Map(), offline = false } = {}) {
  const listeners = {}, network = [], kept = new Map(cached);
  const cache = {
    put: async (key, res) => { kept.set(typeof key === 'string' ? key : key.url, res); },
    match: async (key) => kept.get(typeof key === 'string' ? key : key.url)
  };
  const context = vm.createContext({
    self: { location: { origin: 'https://game.test', href: 'https://game.test/sw.js' }, addEventListener: (type, fn) => { listeners[type] = fn; } }, URL,
    fetch: async (req, options) => {
      const url = typeof req === 'string' ? req : req.url;
      network.push({ url, options });
      if (offline) throw Error('offline');
      return { ok: true, status: 200, type: 'basic', url, clone() { return this; } };
    },
    caches: { open: async () => cache, match: async () => undefined, keys: async () => [], delete: async () => true }, Response: { error: () => 'error' }
  });
  const source = fs.readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const build = source.match(/const BUILD = '([^']+)'/)[1];
  const get = async (path, over = {}) => {
    let result;
    const req = { method: 'GET', headers: { has: () => false }, url: 'https://game.test' + path, destination: 'image', mode: 'no-cors', ...over };
    listeners.fetch({ request: req, respondWith: (p) => { result = p; } });
    return result === undefined ? undefined : await result;
  };
  return { get, network, kept, listeners, build };
}

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
