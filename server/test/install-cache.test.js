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
