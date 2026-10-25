// A missing cosmetic asset must not prevent boot from binding controls and
// starting the splash. Run with node --test server/test/install-startup.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../js/ui/install.js', import.meta.url), 'utf8');

function start({ assets, uiAssets, online = true } = {}) {
  const elements = new Map(), styles = [], modals = [], listeners = [];
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: false,
      classList: { toggle() {} },
      addEventListener(event, fn) { this[event] = fn; },
      querySelector(child) { return element(selector + ' ' + child); }
    });
    return elements.get(selector);
  }
  const BR = {
    util: { $: element },
    api: { online },
    kit: { registerModal(name) { modals.push(name); }, toast() {} },
    screens: { current() { return 'slot'; } }
  };
  if (assets !== undefined) BR.LAUNCH_ASSETS = assets;
  if (uiAssets !== undefined) BR.UI_IMG = uiAssets;
  const context = vm.createContext({
    window: { BR, addEventListener(event) { listeners.push(event); } },
    document: {
      head: { appendChild(style) { styles.push(style.textContent); } },
      createElement() { return {}; },
      addEventListener(event) { listeners.push(event); }
    },
    navigator: { userAgent: 'browser' },
    location: { protocol: 'https:', hostname: 'example.test', search: '' },
    fetch: async () => ({ ok: false, status: 404 }),
    setTimeout() {}, setInterval() {}
  });
  vm.runInContext(source, context, { filename: 'js/ui/install.js' });
  BR.install.init();
  return { BR, elements, styles, modals, listeners, native: context.window.BRNative };
}

for (const assets of [undefined, {}, { updateButton: '' }]) {
  test('install startup and update controls work without artwork: ' + JSON.stringify(assets), () => {
    const s = start({ assets });
    assert.deepEqual(s.styles, []); // keep the normal visible CSS/text buttons
    assert.deepEqual(s.modals, ['install', 'update']);
    assert.equal(typeof s.elements.get('#start-app').click, 'function');
    assert.equal(s.elements.get('#start-app span').textContent, 'アプリで遊ぶ');
    assert.ok(s.listeners.includes('beforeinstallprompt'));
    assert.ok(s.listeners.includes('visibilitychange'));
    assert.equal(typeof s.native.back, 'function');
    s.BR.install.outdated();
    assert.equal(s.elements.get('#start-app span').textContent, '今すぐアップデート');
    assert.equal(s.elements.get('#start-app').hidden, false);
  });
}

test('configured update artwork is still applied', () => {
  const s = start({ assets: { updateButton: 'img/update.webp' } });
  assert.equal(s.styles.length, 1);
  assert.match(s.styles[0], /background-image:url\("img\/update\.webp"\)/);
  assert.deepEqual(s.modals, ['install', 'update']);
});

test('offline startup also works without an artwork manifest', () => {
  const s = start({ online: false });
  assert.equal(s.elements.get('#start-app').hidden, true);
  assert.equal(typeof s.elements.get('#start-app').click, 'function');
  assert.deepEqual(s.styles, []);
});

test('the shipped UI image manifest provides the larger update artwork', () => {
  const s = start({ uiAssets: { updateButton: 'img/ui/refresh/update.webp' } });
  assert.equal(s.styles.length, 1);
  assert.match(s.styles[0], /img\/ui\/refresh\/update.webp/);
  assert.match(s.styles[0], /width:320px;height:100px/);
  assert.equal(typeof s.elements.get('#start-app').click, 'function');
  s.BR.install.outdated();
  assert.equal(s.elements.get('#start-app').hidden, false);
  assert.equal(s.elements.get('#start-app span').textContent, '今すぐアップデート');
});
