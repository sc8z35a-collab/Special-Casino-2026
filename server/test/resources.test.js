import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function scene() {
  const tags = [], calls = [];
  const BR = { api: { online: true }, util: { codeUrl: f => f }, RESOURCES: { cars: ['sale.js', 'cars.js'], carsaleDialog: ['sale.js'] }, kit: { fail: () => calls.push('failed') } };
  const c = { window: { BR }, document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild: t => tags.push(t) } }, Promise, WeakSet };
  vm.runInNewContext(fs.readFileSync(new URL('../../js/core/resources.js', import.meta.url), 'utf8'), c);
  const sale = { init: () => calls.push('sale:init'), open: () => calls.push('sale:open') };
  const cars = { init: () => calls.push('cars:init'), showShop: () => calls.push('cars:open') };
  async function finish() { BR.carsaleDialog = sale; tags[0].onload(); await flush(); BR.cars = cars; tags[1].onload(); }
  return { BR, tags, calls, finish };
}
test('a screen initializes its shared optional dialog before direct calls, with one fetch/init per controller', async () => {
  const s = scene(), job = s.BR.cars.showShop(); await flush(); assert.equal(s.tags.length, 1); await s.finish(); await job;
  s.BR.carsaleDialog.open(); await s.BR.resources.load('carsaleDialog'); s.BR.cars.showShop();
  assert.deepEqual(s.calls, ['sale:init', 'cars:init', 'cars:open', 'sale:open', 'cars:open']);
  assert.equal(s.tags.length, 2);
});
test('logout during a deferred controller download cancels its pending user action', async () => {
  const s = scene(), job = s.BR.cars.showShop(); await flush(); s.BR.resources.cancelPending(); await s.finish(); await job;
  assert.deepEqual(s.calls, ['sale:init', 'cars:init']);
});
