import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { GACHA } from '../core/rules.js';
import { createGacha } from '../core/gacha.js';
import { readQuests, questTickets } from '../core/quests.js';
import crypto from 'node:crypto';
import { answerOnSocket } from '../core/socketapi.js';

const EXPECTED = {
  rare: [['lot', 30], ['royal', 20], ['seed', 0.01], ['grown-tree', 0.005], ['garage', 10], ['reset', 23.3], ['vip-week', 14], ['onvoro', 1.7], ['porsche', 0.5], ['random-car', 0.485]],
  legendary: [['lot', 10], ['royal', 10], ['garage', 20], ['reset', 21.06], ['vip-week', 24], ['onvoro', 3.5], ['porsche', 2.8], ['random-car', 7.635], ['seed', 1], ['grown-tree', 0.005]],
  secret: [['lot', 10], ['royal-high', 19], ['royal', 8], ['garage', 8], ['reset', 10], ['vip-week', 24], ['random-car', 20], ['seed', 1]]
};

test('all three gacha tables match requested odds, total 100%, draw 2/6/20 slots and apply the 1.5x car campaign', () => {
  assert.equal(GACHA.cars.length, 12);
  assert.equal(GACHA.slots, 2);
  assert.deepEqual(GACHA.kinds.map((k) => k.id), ['rare', 'legendary', 'secret']);
  for (const [kind, expected] of Object.entries(EXPECTED)) {
    assert.deepEqual(GACHA.odds(kind, false).map((r) => [r.id, r.chance]), expected);
    for (const boost of [false, true]) {
      const table = GACHA.odds(kind, boost);
      assert.ok(Math.abs(table.reduce((n, r) => n + r.chance, 0) - 100) < 1e-10);
      const car = table.filter((r) => r.car).reduce((n, r) => n + r.chance, 0);
      const baseCar = { rare: 2.685, legendary: 13.935, secret: 20 }[kind];
      assert.ok(Math.abs(car - baseCar * (boost ? 1.5 : 1)) < 1e-10);
      for (const count of [1, 3, 10]) assert.equal(GACHA.draw(kind, count, boost, false, () => 0).flatMap((r) => r.rewards).length, count * GACHA.slots);
    }
  }
  for (const kind of ['normal', 'bad', 'toString', '__proto__', 'constructor']) assert.throws(() => GACHA.odds(kind, false), RangeError);
});

const BASE = {
  rare: { single: 4500000, three: 12150000, ten: 33750000 },
  legendary: { single: 27000000, three: 72900000, ten: 202500000 },
  secret: { single: 45000000, three: 121500000, ten: 337500000 }
};
// what a server asks during its first 100 hours: the リリース記念セール, the secret tier at $40M a pull
const PRICES = {
  ...BASE,
  secret: { single: 40000000, three: 108000000, ten: 300000000 }
};

test('tier prices use a single 10% discount for 3 pulls and 25% for 10, without stacking the old sale discounts', () => {
  for (const [kind, prices] of Object.entries(BASE)) {
    assert.equal(GACHA.price(kind, 1), prices.single);
    assert.equal(GACHA.price(kind, 3), prices.three);
    assert.equal(GACHA.price(kind, 10), prices.ten);
  }
  // the release sale lowers the secret tier only
  for (const [kind, prices] of Object.entries(PRICES)) for (const [count, key] of [[1, 'single'], [3, 'three'], [10, 'ten']]) assert.equal(GACHA.price(kind, count, true), prices[key]);
  for (const count of [0, 2, 9, 30, -1, 1.5, NaN]) assert.throws(() => GACHA.price('rare', count), RangeError);
  assert.throws(() => GACHA.price('normal', 1), RangeError);
});

test('the random car category in every tier draws all 12 models, the cheaper the likelier (by one over the price)', () => {
  const w = GACHA.cars.map((c) => 1 / GACHA.carPrice(c.id)), total = w.reduce((a, b) => a + b, 0);
  for (const kind of GACHA.kinds.map((k) => k.id)) {
    const table = GACHA.odds(kind, false);
    const entry = table.findIndex((r) => r.id === 'random-car');
    const chance = (table.slice(0, entry).reduce((n, r) => n + r.chance, 0) + table[entry].chance / 2) / 100;
    let at = 0;
    for (let i = 0; i < 12; i++) {
      const mid = (w.slice(0, i).reduce((a, b) => a + b, 0) + w[i] / 2) / total;
      let k = 0;
      const pulls = GACHA.draw(kind, 1, false, false, () => k++ % 2 === 0 ? chance : mid);
      assert.ok(pulls[0].rewards.every((r) => r.carId === GACHA.cars[i].id), `${kind} ${i}`);
      at++;
    }
    assert.equal(at, 12);
  }
  // (the onvoro, the cheapest, comes about 70 times as often as the MAGITA ONE（ホワイト）)
  const one = GACHA.cars.findIndex((c) => c.id === 'mercedes-amg-one-white'), onvoro = GACHA.cars.findIndex((c) => c.id === 'onvoro');
  assert.ok(w[onvoro] / w[one] > 70);
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

test('gacha API authenticates, removes normal, validates count/price and settles two-slot rewards with payment', async () => {
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
    assert.equal(rewards.length, 20);
    // (a money tree that had no room: its $3M paid instead, YOSIDA's)
    const treePaid = rewards.filter((x) => x.paid).reduce((n, x) => n + x.paid, 0);
    assert.equal(r.paid, PRICES.secret.ten); assert.equal(r.me.dollars, 1000000000 - r.paid + treePaid);
    assert.equal(r.me.tokens, p.me.tokens + rewards.filter((x) => x.type === 'lot').reduce((n, x) => n + x.amount, 0));
    assert.equal(r.me.coins, p.me.coins + rewards.filter((x) => x.type === 'royal').reduce((n, x) => n + x.amount, 0) + r.pulls.reduce((n, pull) => n + (pull.bonus || 0), 0));
    assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM cars WHERE owner_id = ? AND via = 'gacha'").get(p.me.id).n, rewards.filter((x) => x.type === 'car').length);
    s.setUser(p.me.id, { dollars: 0 });
    for (const kind of Object.keys(EXPECTED)) assert.equal((await s.call('POST', '/api/gacha/spin', { token: p.token, body: { kind, count: 1 } })).error.code, 'insufficient');
  } finally { await s.stop(); }
});

test('the リリース記念セール: the secret tier at $40M a pull for the first 100 hours of the server, then its price again', async () => {
  const s = await startServer();
  try {
    const p = await s.register('セール確認'); s.setUser(p.me.id, { dollars: 1000000000, garage_extra: 40 });
    const on = await s.call('GET', '/api/gacha', { token: p.token });
    assert.equal(on.releaseSale.kind, 'secret');
    const start = Number(s.app.db.prepare("SELECT value FROM meta WHERE key = 'gacha_release_sale'").get().value);
    assert.equal(on.releaseSale.end, start + 100 * 3600000);
    // (a quote of the old price is refused while the sale is on)
    assert.equal((await s.call('POST', '/api/gacha/spin', { token: p.token, body: { kind: 'secret', count: 1, price: BASE.secret.single } })).error.code, 'price_changed');
    const sale = await s.call('POST', '/api/gacha/spin', { token: p.token, body: { kind: 'secret', count: 1, price: PRICES.secret.single } });
    assert.equal(sale.paid, 40000000);
    // over: a service started after the 100 hours (the start is kept in meta, never moved)
    const q = (sql) => s.app.db.prepare(sql);
    const getUser = (id) => q('SELECT * FROM users WHERE id = ?').get(id);
    const later = createGacha({ q, tx: (fn) => s.app.db.tx(fn), getUser, meDto: (u) => u, balanceChanged: getUser, afterSpend: () => {},
      itemsOf: (id) => Object.fromEntries(q('SELECT item, count FROM items WHERE user_id = ?').all(id).map((r) => [r.item, r.count])),
      addItems: (id, item, n) => q('INSERT INTO items (user_id, item, count) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET count = count + excluded.count').run(id, item, n),
      now: () => start + 100 * 3600000 });
    const off = await later.routes['GET /api/gacha']({}, getUser(p.me.id));
    assert.deepEqual(off.prices, BASE); assert.equal(off.releaseSale, undefined);
    const before = getUser(p.me.id).dollars;
    const one = await later.routes['POST /api/gacha/spin']({ json: async () => ({ kind: 'secret', count: 1 }) }, getUser(p.me.id));
    const treePaid = one.pulls.flatMap((x) => x.rewards).filter((x) => x.paid).reduce((n, x) => n + x.paid, 0);
    assert.equal(getUser(p.me.id).dollars, before - BASE.secret.single + treePaid);
  } finally { await s.stop(); }
});

test('all tiers settle the exact 3-pull price and six rewards; a mismatched tier quote cannot debit the account', async () => {
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
      assert.equal(result.pulls.flatMap((pull) => pull.rewards).length, 6);
      const treePaid = result.pulls.flatMap((x) => x.rewards).filter((x) => x.paid).reduce((n, x) => n + x.paid, 0);
      assert.equal(result.paid, PRICES[kind].three); before += treePaid - result.paid; assert.equal(result.me.dollars, before);
    }
  } finally { await s.stop(); }
});

test('all tier rewards settle their full quantities; tickets are consumed once and full garages preserve prizes', async () => {
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
        assert.equal(r.pulls[0].rewards.length, 2);
        assert.equal(r.pulls[0].rewards[0].type, reward.car ? 'car' : reward.type || reward.id);
      }
    }
    assert.equal(getUser(p.me.id).garage_extra, 52, 'secret gives 4 slots per reward, two rewards give 8');
    assert.equal(questTickets(readQuests(getUser(p.me.id).quests))['5h'], 12, '2 + 4 + 6 tickets across tiers');
    // (the money trees: the starter, then seeds and grown ones until the player's trees are all there — 8 —, after
    // that each paid as $3M instead: rare 2 seeds + 2 grown, legendary 2 seeds and 1 grown, the rest paid)
    assert.equal(itemsOf(p.me.id)['gacha-seed'], 4);
    assert.equal(q('SELECT COUNT(*) AS n FROM trees WHERE user_id = ?').get(p.me.id).n, 4);
    assert.equal(q('SELECT COUNT(*) AS n FROM trees WHERE user_id = ? AND given = ?').get(p.me.id, GACHA.grownGiven).n, 3);
    assert.equal(itemsOf(p.me.id)['gacha-vip-week'], 6);
    await g.routes['POST /api/gacha/use']({ json: async () => ({ item: 'seed' }) }, p.me);
    assert.equal(itemsOf(p.me.id)['gacha-seed'], 3);
    for (let i = 0; i < 6; i++) await g.routes['POST /api/gacha/use']({ json: async () => ({ item: 'vip-week' }) }, p.me);
    await assert.rejects(g.routes['POST /api/gacha/use']({ json: async () => ({ item: 'vip-week' }) }, p.me), (e) => e.code === 'no_item');
    assert.equal(getUser(p.me.id).vip_until, now + 42 * 86400000);
    const before = getUser(p.me.id).dollars;
    s.setUser(p.me.id, { garage_extra: 0 });
    roll = 0.98; // Onvoro's rare category (97.315-99.015), both slots.
    const full = await g.routes['POST /api/gacha/spin']({ json: async () => ({ kind: 'rare', count: 1 }) }, p.me);
    assert.equal(getUser(p.me.id).dollars, before - PRICES.rare.single);
    assert.ok(full.pulls[0].rewards.every(r => r.type === 'car' && r.pending));
    assert.equal(itemsOf(p.me.id)['gacha-car:onvoro'], 2);
    await assert.rejects(g.routes['POST /api/gacha/use']({ json: async () => ({ item: 'gacha-car:onvoro' }) }, p.me), e => e.code === 'garage_full');
    s.setUser(p.me.id, { garage_extra: 100 });
    const n = q('SELECT COUNT(*) AS n FROM cars WHERE owner_id = ?').get(p.me.id).n;
    await g.routes['POST /api/gacha/use']({ json: async () => ({ item: 'gacha-car:onvoro' }) }, p.me);
    assert.equal(itemsOf(p.me.id)['gacha-car:onvoro'], 1);
    assert.equal(q('SELECT COUNT(*) AS n FROM cars WHERE owner_id = ?').get(p.me.id).n, n + 1);
  } finally { await s.stop(); }
});

test('gacha retries across HTTP/live and recreated services debit once and preserve all 20 rewards', async t => {
  const s = await startServer(); t.after(() => s.stop()); const p = await s.register('GachaReceipt');
  s.setUser(p.me.id, { dollars: 1000000000, garage_extra: 100 });
  const body = { key: Date.now() + '-' + crypto.randomBytes(16).toString('hex'), kind: 'secret', count: 10, price: PRICES.secret.ten };
  const replies = await Promise.all(Array.from({ length: 4 }, () => s.call('POST', '/api/gacha/spin', { token: p.token, body })));
  assert.ok(replies.every(r => r.status === 200)); for (const r of replies) { assert.deepEqual(r.pulls, replies[0].pulls); assert.equal(r.paid, replies[0].paid); }
  const live = JSON.parse(await answerOnSocket(s.app.api, { ip: '127.0.0.1' }, { id: 1, m: 'POST', p: '/api/gacha/spin', h: { authorization: 'Bearer ' + p.token }, b: body }));
  assert.equal(live.s, 200); assert.deepEqual(live.b.pulls, replies[0].pulls);
  const treePaid = replies[0].pulls.flatMap(r => r.rewards).filter(r => r.paid).reduce((n, r) => n + r.paid, 0);
  assert.equal(s.app.db.prepare('SELECT dollars FROM users WHERE id = ?').get(p.me.id).dollars, 1000000000 - PRICES.secret.ten + treePaid);
  assert.equal(replies[0].pulls.flatMap(r => r.rewards).length, 20);
  const conflict = await s.call('POST', '/api/gacha/spin', { token: p.token, body: { ...body, count: 1 } }); assert.equal(conflict.error.code, 'gacha_conflict');
  const q = sql => s.app.db.prepare(sql);
  q('UPDATE users SET dollars = dollars - 1, rev = rev + 1 WHERE id = ?').run(p.me.id);
  const restarted = createGacha({ q, tx: fn => s.app.db.tx(fn), getUser: id => q('SELECT id, dollars, tokens, coins, rev FROM users WHERE id = ?').get(id), meDto: u => u,
    itemsOf: id => Object.fromEntries(q('SELECT item, count FROM items WHERE user_id = ?').all(id).map(r => [r.item, r.count])) });
  const again = await restarted.routes['POST /api/gacha/spin']({ json: async () => body }, p.me);
  assert.deepEqual(again.pulls, replies[0].pulls);
  assert.equal(again.me.dollars, 1000000000 - PRICES.secret.ten + treePaid - 1, 'replayed rewards never roll back newer wallet or inventory state');
});

// (YOSIDA's: a tree that has no room paid as $3M to the player instead — never more trees than the limit)
test('full trees: every mature-tree reward paid as $3M instead, never exceeding the active limit', async t => {
  const s = await startServer(); t.after(() => s.stop()); const p = await s.register('TreePrizes'), q = sql => s.app.db.prepare(sql);
  s.setUser(p.me.id, { dollars: 1000000000 });
  for (let i = 0; i < 8; i++) q("INSERT INTO trees (user_id, name, super, given, price, created_at) VALUES (?, '木', 0, 0, 0, ?)").run(p.me.id, Date.now());
  const getUser = id => q('SELECT * FROM users WHERE id = ?').get(id), itemsOf = id => Object.fromEntries(q('SELECT item, count FROM items WHERE user_id = ?').all(id).map(r => [r.item, r.count]));
  const addItems = (id, item, n) => q('INSERT INTO items (user_id, item, count) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET count = count + excluded.count').run(id, item, n);
  const g = createGacha({ q, tx: fn => s.app.db.tx(fn), getUser, meDto: u => u, addItems, itemsOf, balanceChanged: getUser, afterSpend() {}, now: () => Date.parse('2026-10-26T00:00:00Z'), rand: () => 0.500125 });
  const result = await g.routes['POST /api/gacha/spin']({ json: async () => ({ kind: 'rare', count: 10 }) }, p.me);
  assert.ok(result.pulls.flatMap(p => p.rewards).every(r => r.type === 'grown-tree' && r.paid === 3000000 && !r.pending));
  assert.equal(itemsOf(p.me.id)['gacha-grown-tree'] || 0, 0); assert.equal(q('SELECT COUNT(*) AS n FROM trees WHERE user_id = ?').get(p.me.id).n, 8);
  assert.equal(result.me.dollars, 1000000000 - PRICES.rare.ten + 20 * 3000000);
});
