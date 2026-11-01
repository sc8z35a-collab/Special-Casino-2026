// What is sold is worth a little less than it costs: nothing bought can be turned into more money than was paid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, carBuyback, rentPay } from '../core/rules.js';
import '../../js/game/gacha.js';

const BR = globalThis.BR, G = BR.GACHA, C = BR.CONFIG;
const DAY = 86400000;

test('a car bought in a sale is never bought back for more than was paid for it, on any day', () => {
  for (const car of RULES.cars) {
    if (!car.price || car.ended) continue;
    // (the deepest sale and VIP's discount on top)
    const paid = Math.round(car.price * (1 - 0.45 - C.vip.carOff31 / 100));
    for (let d = 0; d < 120; d++) {
      const b = carBuyback(car, Date.UTC(2026, 10, 1) + d * DAY, paid);
      assert.ok(b.price < paid, `${car.id} day ${d}: ${b.price} for ${paid}`);
    }
    // (one given, or from before what was paid was kept: by its price then)
    assert.ok(carBuyback(car, Date.UTC(2026, 10, 1), 0).price < car.price);
  }
});

test('renting a car out pays it back in about three months, whatever it costs', () => {
  const R = C.carRental, people = R.customers.reduce((a, b) => a + b, 0), blocks = 24 / R.hours;
  for (const car of RULES.cars) {
    if (!car.price) continue;
    const p = rentPay(car.price), each = (1 - R.vip.chance) * (p.lo + p.hi) / 2 + R.vip.chance * p.vip;
    const days = car.price / (each * people * blocks * 0.85);
    assert.ok(days > 75 && days < 100, `${car.id}: ${days.toFixed(0)} days`);
  }
});

test('a gacha pull is worth less than it costs (its prizes at what they sell for), in a campaign too', () => {
  const off = (C.carBuyback.min + C.carBuyback.max) / 2 / 100;
  const car = (id) => G.carPrice(id) * (1 - off);
  let t = 0, v = 0;
  for (const c of G.cars) { const w = 1 / G.carPrice(c.id); t += w; v += w * car(c.id); }
  const random = v / t;
  const worth = { garage: C.garage.slotPrice, reset: 100000, 'vip-week': 7 * C.vip.coins * C.vip.buyback.each, seed: C.tree.markets.seed.second, 'grown-tree': C.tree.markets.grown.second };
  const slot = (table) => table.reduce((n, x) => {
    const type = x.type || x.id;
    const w = type === 'lot' ? (x.min + x.max) / 2 * RULES.tokenPrice : type === 'royal' ? (x.min + x.max) / 2 * C.vip.buyback.each
      : x.car ? (x.carId ? car(x.carId) : random) : (worth[x.id] || 0) * (x.amount || 1);
    return n + x.chance / 100 * w;
  }, 0);
  const bonus = 0.8 * (0.89 * 4 + 0.1 * 14 + 0.01 * 26) * C.vip.buyback.each;
  for (const k of G.kinds) {
    for (const boost of [false, true]) for (const sale of [false, true]) {
      const pull = 3 * slot(G.odds(k.id, boost)) + (sale ? bonus : 0), cost = G.price(k.id, 10, sale) / 10;
      // (a little dear as it is; at most even when a campaign and the release sale meet)
      assert.ok(pull / cost < (boost || sale ? 1.02 : 0.85), `${k.id} boost ${boost} sale ${sale}: ${(pull / cost).toFixed(2)}`);
    }
  }
});
