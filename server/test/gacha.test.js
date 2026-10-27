import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { GACHA } from '../core/rules.js';
import { createGacha } from '../core/gacha.js';
import { readQuests, questTickets } from '../core/quests.js';

const EXPECTED = {
  rare: [['lot', 30], ['royal', 20], ['seed', 0.01], ['grown-tree', 0.005], ['garage', 10], ['reset', 15], ['vip-week', 14], ['onvoro', 7], ['porsche', 2], ['random-car', 1.985]],
  legendary: [['lot', 10], ['royal', 10], ['garage', 20], ['reset', 15], ['vip-week', 24], ['onvoro', 5], ['porsche', 4], ['random-car', 10.995], ['seed', 1], ['grown-tree', 0.005]],
  secret: [['lot', 10], ['royal-high', 19], ['royal', 8], ['garage', 8], ['reset', 10], ['vip-week', 24], ['random-car', 20], ['seed', 1]]
};

test('all three gacha tables match requested odds, total 100%, draw 3/9/30 slots and apply the 1.5x car campaign', () => {
  assert.equal(GACHA.cars.length, 12);
  assert.deepEqual(GACHA.kinds.map((k) => k.id), ['rare', 'legendary', 'secret']);
  for (const [kind, expected] of Object.entries(EXPECTED)) {
    assert.deepEqual(GACHA.odds(kind, false).map((r) => [r.id, r.chance]), expected);
    for (const boost of [false, true]) {
      const table = GACHA.odds(kind, boost);
      assert.ok(Math.abs(table.reduce((n, r) => n + r.chance, 0) - 100) < 1e-10);
      const car = table.filter((r) => r.car).reduce((n, r) => n + r.chance, 0);
      const baseCar = { rare: 10.985, legendary: 19.995, secret: 20 }[kind];
      assert.ok(Math.abs(car - baseCar * (boost ? 1.5 : 1)) < 1e-10);
      for (const count of [1, 3, 10]) assert.equal(GACHA.draw(kind, count, boost, false, () => 0).flatMap((r) => r.rewards).length, count * 3);
    }
  }
  for (const kind of ['normal', 'bad', 'toString', '__proto__', 'constructor']) assert.throws(() => GACHA.odds(kind, false), RangeError);
});

const PRICES = {
  rare: { single: 10000000, three: 27000000, ten: 75000000 },
  legendary: { single: 30000000, three: 81000000, ten: 225000000 },
  secret: { single: 50000000, three: 135000000, ten: 375000000 }
};

test('tier prices use a single 10% discount for 3 pulls and 25% for 10, without stacking the old sale discounts', () => {
  for (const [kind, prices] of Object.entries(PRICES)) {
    assert.equal(GACHA.price(kind, 1), prices.single);
    assert.equal(GACHA.price(kind, 3), prices.three);
    assert.equal(GACHA.price(kind, 10), prices.ten);
  }
  for (const count of [0, 2, 9, 30, -1, 1.5, NaN]) assert.throws(() => GACHA.price('rare', count), RangeError);
  assert.throws(() => GACHA.price('normal', 1), RangeError);
});

test('the random car category in every tier draws equally from all 12 models', () => {
  for (const kind of GACHA.kinds.map((k) => k.id)) {
    const table = GACHA.odds(kind, false);
    const entry = table.findIndex((r) => r.id === 'random-car');
    const chance = (table.slice(0, entry).reduce((n, r) => n + r.chance, 0) + table[entry].chance / 2) / 100;
    for (let i = 0; i < 12; i++) {
      let at = 0;
      const pulls = GACHA.draw(kind, 1, false, false, () => at++ % 2 === 0 ? chance : (i + 0.5) / 12);
      assert.ok(pulls[0].rewards.every((r) => r.carId === GACHA.cars[i].id));
    }
  }
});

test('coin ranges reach their exact endpoints, including both distinct secret royal categories', () => {
  const ranges = {
    rare: { lot: [10000, 25000, 1000], royal: [8, 12, 1] },
    legendary: { lot: [10000, 40000, 1000], royal: [20, 32, 1] },
    secret: { lot: [100000, 300000, 1000], 'royal-high': [90, 120, 1], royal: [30, 60, 1] }
  };
  for (const [kind, expected] of Object.entries(ranges)) {
    let cumulative = 0;
    for (const r of GACHA.odds(kind, false)) {
      const roll = (cumulative + r.chance / 2) / 100; cumulative += r.chance;
      if (!expected[r.id]) continue;
      const [min, max, step] = expected[r.id];
      for (const [amountRoll, amount] of [[0, min], [1 - Number.EPSILON, max]]) {
        let at = 0;
        const pulls = GACHA.draw(kind, 1, false, false, () => at++ % 2 === 0 ? roll : amountRoll);
        for (const reward of pulls[0].rewards) {
          assert.equal(reward.type, r.id === 'lot' ? 'lot' : 'royal');
          assert.equal(reward.amount, amount); assert.equal(reward.amount % step, 0);
        }
      }
    }
  }
});

test('gacha API authenticates, removes normal, validates count/price and settles three-slot rewards with payment', async () => {
  const s = await startServer();
  try {
    assert.equal((await s.call('GET', '/api/gacha')).status, 401);
    const p = await s.register('ガチャ確認'); s.setUser(p.me.id, { dollars: 1000000000, garage_extra: 40 });
    const state = await s.call('GET', '/api/gacha', { token: p.token });
    assert.equal(state.status, 200); assert.deepEqual(state.prices, PRICES); assert.equal(state.prices.normal, undefined);
    for (const body of [{ kind: 'bad', count: 1 }, { kind: 'normal', count: 1 }, { kind: 'rare', count: 2 }]) assert.equal((await s.call('POST', '/api/gacha/spin', { token: p.token, body })).status, 400);
    assert.equal((await s.call('POST', '/api/gacha/spin', { token: p.token, body: { kind: 'rare', count: 1, price: 1 } })).error.code, 'price_changed');
    const r = await s.call('POST', '/api/gacha/spin', { token: p.token, body: { kind: 'secret', count: 10 } });
    assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.pulls.length, 10);
    const rewards = r.pulls.flatMap((pull) => pull.rewards);
    assert.equal(rewards.length, 30);
    assert.equal(r.paid, 375000000); assert.equal(r.me.dollars, 1000000000 - r.paid);
    assert.equal(r.me.tokens, p.me.tokens + rewards.filter((x) => x.type === 'lot').reduce((n, x) => n + x.amount, 0));
    assert.equal(r.me.coins, p.me.coins + rewards.filter((x) => x.type === 'royal').reduce((n, x) => n + x.amount, 0) + r.pulls.reduce((n, pull) => n + (pull.bonus || 0), 0));
    assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM cars WHERE owner_id = ? AND via = 'gacha'").get(p.me.id).n, rewards.filter((x) => x.type === 'car').length);
    s.setUser(p.me.id, { dollars: 0 });
    for (const kind of Object.keys(EXPECTED)) assert.equal((await s.call('POST', '/api/gacha/spin', { token: p.token, body: { kind, count: 1 } })).error.code, 'insufficient');
  } finally { await s.stop(); }
});

test('all tiers settle the exact 3-pull price and nine rewards; a mismatched tier quote cannot debit the account', async () => {
  const s = await startServer();
  try {
    const p = await s.register('三連確認'); s.setUser(p.me.id, { dollars: 2000000000, garage_extra: 100 });
    let before = 2000000000;
    for (const kind of Object.keys(PRICES)) {
      const bad = await s.call('POST', '/api/gacha/spin', { token: p.token, body: { kind, count: 3, price: PRICES[kind].single } });
      assert.equal(bad.error.code, 'price_changed');
      assert.equal(s.app.db.prepare('SELECT dollars FROM users WHERE id = ?').get(p.me.id).dollars, before);
      const result = await s.call('POST', '/api/gacha/spin', { token: p.token, body: { kind, count: 3, price: PRICES[kind].three } });
      assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.pulls.length, 3);
      assert.equal(result.pulls.flatMap((pull) => pull.rewards).length, 9);
      assert.equal(result.paid, PRICES[kind].three); before -= result.paid; assert.equal(result.me.dollars, before);
    }
  } finally { await s.stop(); }
});

test('all tier rewards settle their full quantities; tickets are consumed once and failed pulls roll back', async () => {
  const s = await startServer();
  try {
    const p = await s.register('ガチャ報酬'), db = s.app.db, q = (sql) => db.prepare(sql);
    s.setUser(p.me.id, { dollars: 1000000000, garage_extra: 40 });
    const getUser = (id) => q('SELECT * FROM users WHERE id = ?').get(id);
    const itemsOf = (id) => Object.fromEntries(q('SELECT item, count FROM items WHERE user_id = ?').all(id).map((r) => [r.item, r.count]));
    const addItems = (id, item, n) => q('INSERT INTO items (user_id, item, count) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET count = count + excluded.count').run(id, item, n);
    // Pick a time outside both campaign windows so the base boundary table applies.
    let now = Date.parse('2026-10-26T00:00:00Z');
    while (GACHA.events(now).boost.on || GACHA.events(now).sale.on) now += 3600000;
    let roll = 0;
    const g = createGacha({ q, tx: (fn) => db.tx(fn), getUser, itemsOf, addItems, meDto: (u) => u,
      balanceChanged: getUser, afterSpend: () => {}, now: () => now, rand: () => roll });
    for (const kind of Object.keys(EXPECTED)) {
      let cumulative = 0;
      for (const reward of GACHA.odds(kind, false)) {
        roll = (cumulative + reward.chance / 2) / 100; cumulative += reward.chance;
        const r = await g.routes['POST /api/gacha/spin']({ json: async () => ({ kind, count: 1 }) }, p.me);
        assert.equal(r.pulls[0].rewards.length, 3);
        assert.equal(r.pulls[0].rewards[0].type, reward.car ? 'car' : reward.type || reward.id);
      }
    }
    assert.equal(getUser(p.me.id).garage_extra, 58, 'secret gives 4 slots per reward, three rewards give 12');
    assert.equal(questTickets(readQuests(getUser(p.me.id).quests))['5h'], 18, '3 + 6 + 9 tickets across tiers');
    assert.equal(itemsOf(p.me.id)['gacha-seed'], 9);
    assert.equal(itemsOf(p.me.id)['gacha-vip-week'], 9);
    assert.equal(q('SELECT COUNT(*) AS n FROM trees WHERE user_id = ?').get(p.me.id).n, 6);
    await g.routes['POST /api/gacha/use']({ json: async () => ({ item: 'seed' }) }, p.me);
    assert.equal(itemsOf(p.me.id)['gacha-seed'], 8);
    for (let i = 0; i < 9; i++) await g.routes['POST /api/gacha/use']({ json: async () => ({ item: 'vip-week' }) }, p.me);
    await assert.rejects(g.routes['POST /api/gacha/use']({ json: async () => ({ item: 'vip-week' }) }, p.me), (e) => e.code === 'no_item');
    assert.equal(getUser(p.me.id).vip_until, now + 63 * 86400000);
    const before = getUser(p.me.id).dollars;
    s.setUser(p.me.id, { garage_extra: 0 });
    roll = 0.94; // Onvoro's rare category, all three slots.
    await assert.rejects(g.routes['POST /api/gacha/spin']({ json: async () => ({ kind: 'rare', count: 1 }) }, p.me), (e) => e.code === 'garage_full');
    assert.equal(getUser(p.me.id).dollars, before);
  } finally { await s.stop(); }
});
