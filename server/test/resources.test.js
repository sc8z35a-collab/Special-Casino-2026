import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function scene() {
  const tags = [], calls = [], timers = new Map(), status = { hidden: true }; let timer = 0;
  const BR = { api: { online: true }, util: { codeUrl: f => f }, RESOURCES: { cars: ['sale.js', 'cars.js'], carsaleDialog: ['sale.js'] }, kit: { fail: () => calls.push('failed') } };
  const c = { window: { BR }, document: { getElementById: () => status, createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild: t => tags.push(t) } }, Promise, WeakSet,
    setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(fs.readFileSync(new URL('../../js/core/resources.js', import.meta.url), 'utf8'), c);
  const sale = { init: () => calls.push('sale:init'), open: () => calls.push('sale:open') };
  const cars = { init: () => calls.push('cars:init'), showShop: () => calls.push('cars:open') };
  async function finish() { BR.carsaleDialog = sale; tags[0].onload(); await flush(); BR.cars = cars; tags[1].onload(); }
  return { BR, tags, calls, finish, timers, status };
}
test('a screen initializes its shared optional dialog before direct calls, with one fetch/init per controller', async () => {
  const s = scene(), job = s.BR.cars.showShop(); await flush(); assert.equal(s.tags.length, 1); await s.finish(); await job;
  s.BR.carsaleDialog.open(); await s.BR.resources.load('carsaleDialog'); s.BR.cars.showShop();
  assert.deepEqual(s.calls, ['sale:init', 'cars:init', 'cars:open', 'sale:open', 'cars:open']);
  assert.equal(s.tags.length, 2);
});

test('slow screen loads show a nonblocking status and clear it after every concurrent load settles', async () => {
  const s = scene(); let finish, fail;
  const a = s.BR.resources.wait(new Promise(resolve => { finish = resolve; }));
  const b = s.BR.resources.wait(new Promise((_, reject) => { fail = reject; }));
  assert.equal(s.status.hidden, true); [...s.timers.values()][0](); assert.equal(s.status.hidden, false);
  finish('ready'); assert.equal(await a, 'ready'); assert.equal(s.status.hidden, false);
  fail(new Error('network')); await assert.rejects(b, /network/); assert.equal(s.status.hidden, true); assert.equal(s.timers.size, 0);
});
test('logout during a deferred controller download cancels its pending user action', async () => {
  const s = scene(), job = s.BR.cars.showShop(); await flush(); s.BR.resources.cancelPending(); await s.finish(); await job;
  assert.deepEqual(s.calls, ['sale:init', 'cars:init']);
});

test('resource failures provide readable retry guidance while retaining a diagnostic code', async () => {
  const s = scene(), pending = s.BR.resources.file('optional.js'); s.tags[0].onerror();
  await assert.rejects(pending, e => e.code === 'resource_load' && e.message.includes('もう一度お試しください'));
});

test('a failure after the controller was installed retries the missing dependency without losing or reinitializing the controller', async () => {
  const s = scene(); s.BR.RESOURCES.cars = ['cars.js', 'sale.js'];
  const cars = { init: () => s.calls.push('init'), showShop: () => s.calls.push('open') };
  const first = s.BR.cars.showShop(); await flush(); s.BR.cars = cars; s.tags[0].onload(); await flush(); s.tags[1].onerror(); await first;
  assert.deepEqual(s.calls, ['failed']);
  const retry = s.BR.cars.showShop(); await flush(); assert.equal(s.tags.length, 3);
  s.tags[2].onload(); await retry; s.BR.cars.showShop();
  assert.deepEqual(s.calls, ['failed', 'init', 'open', 'open']);
});
