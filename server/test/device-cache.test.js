// The device's fingerprint (js/net/device.js) is worked out once and kept while the phone and its browser are the same:
// asking for the graphics chip (a WebGL context) and reading a canvas back is the slowest part of starting the game.
// Run with node --test server/test/device-cache.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../js/net/device.js', import.meta.url), 'utf8');

// one "browser": its storage outlives the pages it loads; each load runs device.js again
function browser({ ua = 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0 Mobile', width = 412, language = 'ja' } = {}) {
  const store = new Map();
  const work = { webgl: 0, canvas2d: 0 };
  const load = (over = {}) => {
    const BR = {};
    const localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); }
    };
    const context = vm.createContext({
      window: { BR, screen: { width: over.width || width, height: 915, colorDepth: 24 }, devicePixelRatio: 2, indexedDB: undefined, crypto: { getRandomValues(b) { for (let i = 0; i < b.length; i++) b[i] = (i * 37 + 11) & 255; return b; } } },
      navigator: { userAgent: over.ua || ua, platform: 'Linux armv8l', languages: [over.language || language], language: over.language || language, hardwareConcurrency: 8, deviceMemory: 4, maxTouchPoints: 5 },
      document: {
        cookie: '',
        createElement() {
          return {
            width: 0, height: 0,
            toDataURL: () => 'data:image/png;base64,AAAA',
            getContext(kind) {
              if (kind === '2d') {
                work.canvas2d++;
                return { fillRect() {}, fillText() {}, beginPath() {}, arc() {}, closePath() {}, fill() {} };
              }
              work.webgl++;
              return { VENDOR: 1, RENDERER: 2, MAX_TEXTURE_SIZE: 3, MAX_RENDERBUFFER_SIZE: 4, getExtension: () => null, getParameter: (p) => 'p' + p, getSupportedExtensions: () => ['a', 'b'] };
            }
          };
        }
      },
      localStorage, Intl, Date, Math, Uint8Array, RegExp, Array, String, Number, JSON, Promise,
      location: { protocol: 'https:' },
      setTimeout() {}, clearTimeout() {}
    });
    vm.runInContext(source, context, { filename: 'js/net/device.js' });
    return BR.device;
  };
  return { load, work, store };
}

test('the second visit does not ask the graphics chip or read a canvas again, and sends the same fingerprint', () => {
  const b = browser();
  const first = b.load().header();
  assert.ok(first.includes('~'), 'a fingerprint is sent');
  assert.deepEqual(b.work, { webgl: 1, canvas2d: 1 });
  const second = b.load().header();
  assert.deepEqual(b.work, { webgl: 1, canvas2d: 1 }, 'no more work the second time');
  assert.equal(second.split('~')[1], first.split('~')[1], 'the same fingerprint');
});

test('another browser, screen or language works the fingerprint out again', () => {
  const b = browser();
  b.load();
  b.load({ ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/131.0.0.0 Mobile' });
  assert.equal(b.work.webgl, 2, 'a new browser version');
  b.load({ width: 360 });
  assert.equal(b.work.webgl, 3, 'another screen');
  b.load({ language: 'en' });
  assert.equal(b.work.webgl, 4, 'another language');
});

test('wiping the storage works it out again, to the same value; a week later too', () => {
  const b = browser();
  const first = b.load().header().split('~')[1];
  b.store.clear();
  assert.equal(b.load().header().split('~')[1], first, 'the same after the storage is wiped');
  assert.equal(b.work.webgl, 2);
  const key = 'blockbuster-reels/device-fp';
  const kept = JSON.parse(b.store.get(key));
  kept.t -= 8 * 86400000;
  b.store.set(key, JSON.stringify(kept));
  b.load();
  assert.equal(b.work.webgl, 3, 'older than a week');
});

test('a kept value that was tampered with into nonsense is not trusted', () => {
  const b = browser();
  b.load();
  b.store.set('blockbuster-reels/device-fp', '{not json');
  assert.ok(b.load().header().includes('~'));
  b.store.set('blockbuster-reels/device-fp', JSON.stringify({ k: 'x', v: 1, t: 0 }));
  assert.ok(b.load().header().includes('~'));
  assert.ok(b.work.webgl >= 3);
});
