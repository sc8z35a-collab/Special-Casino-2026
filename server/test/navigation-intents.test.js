import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function scene() {
  const tags = [], opened = [], errors = [], nodes = new Map(); let initialized = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { dataset: {}, style: { removeProperty() {} }, classList: { add() {}, toggle() {} }, querySelector: () => null });
    return nodes.get(id);
  };
  const BR = { util: { $: node, $$: () => [], now: () => 0, codeUrl: f => f }, CONFIG: {}, store: { state: {} }, api: { online: true },
    kit: { fail: e => errors.push(e) }, RESOURCES: { cars: ['cars.js'], alpha: ['alpha.css'] }, STYLES: ['alpha.css'],
    LAZY: { diary: ['diary.js'], calendar: ['calendar.js'] } };
  const context = { window: { BR }, document: { createElement: () => ({ dataset: {}, remove() {} }), getElementById: () => null,
    head: { appendChild: t => tags.push(t), insertBefore: t => tags.push(t), querySelectorAll: () => [] } },
    setTimeout: () => 1, clearTimeout() {}, Promise, WeakSet };
  for (const f of ['js/core/resources.js', 'js/ui/screens.js', 'js/core/lazy.js']) vm.runInNewContext(fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8'), context);
  const cars = { init() { initialized++; }, showShop() { opened.push('shop'); BR.screens.show('shop'); }, showGarage() { opened.push('garage'); BR.screens.show('garage'); } };
  async function complete(name) {
    if (name === 'cars') BR.cars = cars;
    else BR[name] = { init() {}, open() { opened.push(name); BR.screens.show(name); } };
    const tag = tags.find(t => t.src === name + '.js'); assert.ok(tag, name); tag.onload(); await flush();
  }
  return { BR, tags, opened, errors, cars, complete, initialized: () => initialized };
}

test('a downloaded controller cannot navigate back over a newer screen selection', async () => {
  const s = scene(), pending = s.BR.cars.showShop(); await flush();
  s.BR.screens.show('other'); await s.complete('cars'); await pending;
  assert.equal(s.BR.screens.current(), 'other'); assert.deepEqual(s.opened, []);
  assert.equal(s.initialized(), 1); s.BR.cars.showShop();
  assert.equal(s.BR.screens.current(), 'shop'); assert.equal(s.initialized(), 1); assert.equal(s.tags.length, 1);
});

test('an older optional screen cannot open while the latest selected screen is still loading', async () => {
  const s = scene(), a = s.BR.calendar.open(), b = s.BR.diary.open(); await flush();
  await s.complete('calendar'); assert.deepEqual(s.opened, []);
  await s.complete('diary'); await Promise.all([a, b]); assert.deepEqual(s.opened, ['diary']);
});

test('an older optional screen cannot replace a newer screen that finished loading first', async () => {
  const s = scene(), a = s.BR.calendar.open(), b = s.BR.diary.open(); await flush();
  await s.complete('diary'); await s.complete('calendar'); await Promise.all([a, b]);
  assert.equal(s.BR.screens.current(), 'diary'); assert.deepEqual(s.opened, ['diary']);
});

test('optional screens and resource controllers share the latest user navigation', async () => {
  const s = scene(), a = s.BR.cars.showShop(), b = s.BR.diary.open(); await flush();
  await s.complete('diary'); await s.complete('cars'); await Promise.all([a, b]);
  assert.equal(s.BR.screens.current(), 'diary'); assert.deepEqual(s.opened, ['diary']);
});

test('only the last pending action for a resource controller runs', async () => {
  const s = scene(), a = s.BR.cars.showShop(), b = s.BR.cars.showGarage(); await flush();
  await s.complete('cars'); await Promise.all([a, b]); assert.deepEqual(s.opened, ['garage']);
});

test('an abandoned controller download failure does not display an obsolete error', async () => {
  const s = scene(), pending = s.BR.cars.showShop(); await flush(); s.BR.screens.show('other');
  s.tags[0].onerror(); await pending; assert.deepEqual(s.errors, []);
});

test('selecting an optional screen also cancels a previously pending ordinary stylesheet navigation', async () => {
  const s = scene(), a = s.BR.screens.show('alpha'), b = s.BR.diary.open(); await flush();
  s.tags.find(t => t.href === 'alpha.css').onload(); await a;
  assert.equal(s.BR.screens.current(), 'start');
  await s.complete('diary'); await b; assert.equal(s.BR.screens.current(), 'diary');
});

test('an abandoned ordinary stylesheet failure does not display an obsolete error', async () => {
  const s = scene(), pending = s.BR.screens.show('alpha'); await flush();
  s.BR.screens.show('other'); s.tags.find(t => t.href === 'alpha.css').onerror(); await pending;
  assert.deepEqual(s.errors, []); assert.equal(s.BR.screens.current(), 'other');
});
