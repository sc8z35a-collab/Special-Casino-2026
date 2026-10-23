import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RULES, CARS, carPrice, carPriced, carSale, carBuyback } from '../core/rules.js';
import { startServer } from './helpers.js';

const supplied = [
  ['onvoro', 'オンヴォーロ', 4500000],
  ['ferrari-325', 'フェラーリ325', 55000000],
  ['mercedes-benz-one', 'メルセデスベンツ one', 135000000],
  ['lamborghini-aventador', 'ランボルギーニアベンタドール', 142000000],
  ['lamborghini-urus', 'ランボルギーニウルス', 56500000],
  ['lamborghini-kuia-spyder', 'ランボルギーニクイヤスパイダー', 34000000],
  ['nissan-gt-r', '日産 GT-R', 45000000],
  ['lamborghini-revuelto', 'ランボルギーニ レヴエルト', null],
  ['mercedes-amg-one-white', 'メルセデスAMG ONE（ホワイト）', null]
];
const pending = supplied.filter(c => c[2] === null).map(c => c[0]);
let s;
before(async () => { s = await startServer(); });
after(() => s.stop());

test('all nine supplied cars have their names, prices, real GLBs and fallback pictures', () => {
  assert.equal(new Set(RULES.cars.map(c => c.id)).size, RULES.cars.length);
  for (const [id, name, price] of supplied) {
    const car = RULES.cars.find(c => c.id === id);
    assert.ok(car, id);
    assert.deepEqual([car.name, car.price, car.model], [name, price, true]);
    const bytes = fs.readFileSync(new URL(`../../img/3d/cars/${id}.glb`, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    assert.ok(bytes.length < 25 * 1024 * 1024);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
    assert.ok(gltf.extensionsRequired.includes('EXT_meshopt_compression'));
    assert.ok(gltf.images.every(image => image.mimeType === 'image/webp'));
    const picture = fs.readFileSync(new URL(`../../img/cars/${id}.webp`, import.meta.url));
    assert.equal(picture.toString('ascii', 8, 12), 'WEBP');
  }
});

test('unpriced cars never gain a sale, VIP price or buyback value', () => {
  let annual;
  for (let day = 0; day < 365; day++) {
    const sale = carSale(Date.UTC(2026, 0, 1, 0) + day * 86400000);
    if (!sale) continue;
    for (const id of pending) assert.equal(Object.hasOwn(sale.pct, id), false);
    if (sale.kind === 'year') annual = sale;
  }
  assert.ok(annual);
  assert.equal(Object.keys(annual.pct).length, RULES.cars.filter(carPriced).length);
  for (const id of pending) {
    const car = RULES.cars.find(c => c.id === id);
    assert.equal(CARS.has(id), false);
    assert.deepEqual(carPrice(car, { pct: { [id]: 45 } }, 15), { price: null, pct: 0, vip: 0 });
    assert.equal(carBuyback(car), null);
  }
});

test('pending cars are listed but every direct purchase is rejected without changing money or ownership', async () => {
  const p = await s.register('CarPending');
  s.setUser(p.me.id, { dollars: 1000000000, vip_until: Date.now() + 86400000, vip_exp: 15000 });
  const g = await s.call('GET', '/api/cars', { token: p.token });
  for (const id of pending) {
    assert.equal(g.catalog.find(c => c.id === id).price, null);
    assert.equal(g.buyback[id], null);
    for (const price of [undefined, 0, 1000000, null]) {
      const r = await s.call('POST', '/api/cars/buy', { token: p.token, body: { model: id, price } });
      assert.equal(r.status, 400);
      assert.equal(r.error.code, 'bad_model');
    }
  }
  assert.equal(s.app.db.prepare('SELECT dollars FROM users WHERE id = ?').get(p.me.id).dollars, 1000000000);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM cars WHERE owner_id = ?').get(p.me.id).n, 0);
  assert.equal(s.app.db.prepare('SELECT vip_exp FROM users WHERE id = ?').get(p.me.id).vip_exp, 15000);
});

test('all seven priced cars use existing sale/VIP rules and enter the garage with the amount actually paid', async () => {
  const p = await s.register('CarBuyer');
  s.setUser(p.me.id, { dollars: 1000000000, garage_extra: 8, vip_until: Date.now() + 86400000, vip_exp: 0 });
  let balance = 1000000000;
  for (const [id, , price] of supplied.filter(c => c[2] !== null)) {
    const car = RULES.cars.find(c => c.id === id);
    const g = await s.call('GET', '/api/cars', { token: p.token });
    const cost = carPrice(car, g.sale, 3).price;
    assert.ok(cost > 0 && cost < price);
    const bad = await s.call('POST', '/api/cars/buy', { token: p.token, body: { model: id, price: 0 } });
    assert.equal(bad.error.code, 'price_changed');
    const bought = await s.call('POST', '/api/cars/buy', { token: p.token, body: { model: id, price: cost } });
    assert.equal(bought.status, 200, JSON.stringify(bought));
    assert.deepEqual([bought.paid, bought.car.model, bought.car.paid], [cost, id, cost]);
    balance -= cost;
    assert.equal(bought.me.dollars, balance);
  }
  const g = await s.call('GET', '/api/cars', { token: p.token });
  assert.equal(g.cars.length, 7);
  assert.ok(g.cars.every(c => g.buyback[c.model].price > 0));
});
