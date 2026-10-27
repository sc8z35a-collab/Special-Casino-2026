import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../../js/core/lazy.js', import.meta.url), 'utf8');
async function settle() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
function scene(paths = ['rules.js', 'screen.js'], existing = null) {
  const tags = [], errors = [];
  const BR = { resources: { load: () => Promise.resolve() }, LAZY: { gacha: paths }, util: { codeUrl: (path) => path + '?v=1234567890' }, kit: { fail: (error) => errors.push(error) } };
  if (existing) BR.gacha = existing;
  const context = { BR, document: { createElement: () => ({ remove() { this.removed = true; } }), head: { appendChild(tag) { tags.push(tag); } } } };
  context.window = context; vm.runInNewContext(source, context);
  const real = { initialized: 0, opened: [], init() { this.initialized++; }, open(...args) { this.opened.push(args); } };
  return { BR, tags, errors, real, complete(index, last = false) { if (last) BR.gacha = real; tags[index].onload(); } };
}
test('optional screens fetch nothing at startup, share a first load, preserve dependency order and open only the latest request', async () => {
  const s = scene(); s.BR.gacha.init(); assert.equal(s.tags.length, 0);
  const a = s.BR.gacha.open('old'), b = s.BR.gacha.open('latest'); await settle();
  assert.equal(s.tags.length, 1); assert.match(s.tags[0].src, /^rules.js\?v=/);
  s.complete(0); await settle(); assert.equal(s.tags.length, 2); assert.match(s.tags[1].src, /^screen.js\?v=/);
  s.complete(1, true); await Promise.all([a, b]);
  assert.equal(s.real.initialized, 1); assert.deepEqual(s.real.opened, [['latest']]);
  await s.BR.lazy.load('gacha'); assert.equal(s.tags.length, 2); assert.equal(s.real.initialized, 1);
});
test('logout during a screen load cancels its pending open without a late modal', async () => {
  const s = scene(['screen.js']); const job = s.BR.gacha.open(); await settle();
  s.BR.lazy.cancelPending(); s.complete(0, true); await job;
  assert.equal(s.real.initialized, 1); assert.equal(s.real.opened.length, 0); assert.equal(s.errors.length, 0);
});
test('a failed optional download can be retried, and already bundled screens never fetch or initialize twice', async () => {
  const s = scene(['screen.js']); const failed = s.BR.gacha.open(); await settle(); s.tags[0].onerror(); await failed;
  assert.equal(s.errors.length, 1); assert.equal(s.tags[0].removed, true);
  const retry = s.BR.gacha.open(); await settle(); assert.equal(s.tags.length, 2); s.complete(1, true); await retry;
  assert.equal(s.real.opened.length, 1);
  const bundled = scene(['screen.js'], s.real); bundled.BR.gacha.init(); const count = s.real.initialized;
  assert.equal(await bundled.BR.lazy.load('gacha'), s.real); assert.equal(s.real.initialized, count); assert.equal(bundled.tags.length, 0);
});
