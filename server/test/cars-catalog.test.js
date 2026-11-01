import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RULES, CARS, carPrice, carSold, carSale, carBuyback } from '../core/rules.js';
import { startServer } from './helpers.js';

// every car is MAGITA's now (no maker's name of its own); the Two state セダン is no longer sold (only bought back)
const supplied = [
  ['onvoro', 'MAGITA オンヴォーロ', 4200000],
  ['ferrari-325', 'MAGITA 325', 27000000],
  ['mercedes-benz-one', 'MAGITA ONE', 55000000],
  ['lamborghini-aventador', 'MAGITA アベンタドール', 80000000],
  ['lamborghini-urus', 'MAGITA ウルス', 30000000],
  ['lamborghini-kuia-spyder', 'MAGITA クイヤスパイダー', 20000000],
  ['nissan-gt-r', 'MAGITA GT-R', 34000000],
  ['lamborghini-revuelto', 'MAGITA レヴエルト', 65000000],
  ['mercedes-amg-one-white', 'MAGITA ONE（ホワイト）', 300000000]
];
const ended = RULES.cars.filter((c) => c.ended).map((c) => c.id);
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
  // (no car carries a real carmaker's name: MAGITA's, or its rival YOSIDA's YOSHIDA series)
  for (const c of RULES.cars) assert.match(c.name, /^(MAGITA|YOSHIDA) /, c.id);
});

test('a car no longer sold never gains a sale, but is still bought back', () => {
  assert.deepEqual(ended, ['two-state-sedan']);
  let annual;
  for (let day = 0; day < 365; day++) {
    const sale = carSale(Date.UTC(2026, 0, 1, 0) + day * 86400000);
    if (!sale) continue;
    for (const id of ended) assert.equal(Object.hasOwn(sale.pct, id), false);
    if (sale.kind === 'year') annual = sale;
  }
  assert.ok(annual);
  assert.equal(Object.keys(annual.pct).length, RULES.cars.filter(carSold).length);
  for (const id of ended) {
    const car = RULES.cars.find(c => c.id === id);
    assert.equal(CARS.has(id), true);
    assert.ok(carBuyback(car).price > 0);
  }
});

test('a car no longer sold is listed, every direct purchase is rejected without changing money or ownership, and one owned sells back', async () => {
  const p = await s.register('CarEnded');
  s.setUser(p.me.id, { dollars: 1000000000, vip_until: Date.now() + 86400000, vip_exp: 15000 });
  const g = await s.call('GET', '/api/cars', { token: p.token });
  for (const id of ended) {
    assert.equal(g.catalog.find(c => c.id === id).ended, true);
    assert.ok(g.buyback[id].price > 0);
    for (const price of [undefined, 0, 1000000, null]) {
      const r = await s.call('POST', '/api/cars/buy', { token: p.token, body: { model: id, price } });
      assert.equal(r.status, 400);
      assert.equal(r.error.code, 'bad_model');
    }
  }
  assert.equal(s.app.db.prepare('SELECT dollars FROM users WHERE id = ?').get(p.me.id).dollars, 1000000000);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM cars WHERE owner_id = ?').get(p.me.id).n, 0);
  assert.equal(s.app.db.prepare('SELECT vip_exp FROM users WHERE id = ?').get(p.me.id).vip_exp, 15000);
  // one bought before it ended: sold back at its price now less the day's rate
  const id = Number(s.app.db.prepare("INSERT INTO cars (owner_id, model, created_at, acquired_at) VALUES (?, 'two-state-sedan', ?, ?)").run(p.me.id, Date.now(), Date.now()).lastInsertRowid);
  const sold = await s.call('POST', '/api/cars/sell', { token: p.token, body: { car: id } });
  assert.equal(sold.status, 200, JSON.stringify(sold));
  assert.equal(sold.paid, g.buyback['two-state-sedan'].price);
});

test('all nine supplied cars use existing sale/VIP rules and enter the garage with the amount actually paid', async () => {
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
  assert.equal(g.cars.length, 9);
  assert.ok(g.cars.every(c => g.buyback[c.model].price > 0));
});
