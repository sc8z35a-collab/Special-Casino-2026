// 投資: the price path, the orders, the limits, the dividends and the live ticks: npm test
// Each server's path is worked out again here, second by second, from its own key with the model
// (server/core/stock-model.js) about the companies' centres as their days set them (corp_anchor: the
// companies' own model is server/test/corp.test.js's), with the market's mood and the orders' moves,
// so what the server stored and traded is checked to the dollar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { STOCKS as S, CORP } from '../core/rules.js';
import { keyFrom } from '../core/auth.js';
import { pathOf, history, normals, VOL_MEAN, DAY } from '../core/stock-model.js';
import { TABLES } from '../core/db.js';
import { PLAYER_ROWS, purgePlayer } from '../core/purge.js';
import { statements } from '../core/db.js';

// 20:00 UTC (5:00 in Japan): the trading day ends in 4 hours
const START = Date.UTC(2026, 10, 2, 20, 0, 0) + 123;
const fee = (v) => Math.ceil(v * 180 / 10000);   // 1.8% (Dtrade's)
// (an active player's: 10% from the order that brings the day's trades to $400,000,000)
const feeAfter = (v, traded) => (traded + v >= 400000000 ? Math.ceil(v * 1000 / 10000) : fee(v));
const KEEP_IMPACT = Math.pow(0.5, 1 / (6 * 3600)), KEEP_MOOD = Math.pow(0.5, 1 / (60 * DAY));
// an order's move on the price, and the price it fills at for `p` (half its move on top; a limit never worse)
const moveOf = (id, side, shares, p) => (side === 'buy' ? 1 : -1) * 0.01 * p * shares / CORP.company(id).depth;
function slipped(id, o, p) {
  const at = Math.max(1, Math.round(p * Math.exp(moveOf(id, o.side, o.shares, p) / 2)));
  if (o.type === 'limit') return o.side === 'buy' ? Math.min(o.price, at) : Math.max(o.price, at);
  return at;
}

async function market(t, overrides = {}) {
  let now = START;
  const s = await startServer({ clock: () => now, corpHistory: 0, limits: { stock: [100000, 1000], general: [100000, 1000], login: [100000, 1000] }, ...overrides });
  t.after(() => s.stop());
  const db = s.app.db;
  const key = () => keyFrom(db.prepare("SELECT value FROM meta WHERE key = 'ticket_secret'").get().value, 'stocks');
  const cache = new Map();
  // the model's price at each second from the opening to `to` (seconds): the noise from the key, about the
  // company's centre for the day (its log moving from e0 to e1), its mood (the day's jumps, fading) and the
  // orders' moves (from the second after each fill, fading)
  function sim(id, to) {
    const opened = db.prepare('SELECT opened FROM stock_state WHERE company = ?').get(id).opened;
    const base = S.company(id).base;
    let c = cache.get(id);
    if (!c) { c = { path: pathOf(key(), S.company(id)), s: { x: 0, v: VOL_MEAN, i: 0, m: 0 }, n: opened, prices: new Map([[opened, base]]) }; cache.set(id, c); }
    const moves = new Map();
    for (const o of db.prepare("SELECT done_at, impact FROM stock_orders WHERE company = ? AND status = 'filled'").all(id)) {
      const at = Math.floor(o.done_at / 1000);
      moves.set(at, (moves.get(at) || 0) + o.impact);
    }
    const anchors = new Map(db.prepare('SELECT day, e0, e1, ev FROM corp_anchor WHERE company = ?').all(id).map((a) => [a.day, { ...a, ev: new Map(JSON.parse(a.ev)) }]));
    while (c.n < to) {
      const n = ++c.n;
      c.path.step(c.s, n);
      c.s.i = c.s.i * KEEP_IMPACT + (moves.get(n - 1) || 0);
      c.s.m *= KEEP_MOOD;
      const day = Math.floor((n - 1) / DAY), a = anchors.get(day);
      if (a && a.ev.has(n)) c.s.m += a.ev.get(n);
      const centre = a ? a.e0 + (a.e1 - a.e0) * (n - day * DAY) / DAY - Math.log(base) : 0;
      c.prices.set(n, Math.max(1, Math.round(base * Math.exp(centre + c.s.x + c.s.m + c.s.i))));
    }
    return c.prices;
  }
  const call = (method, url, token, body) => s.call(method, url, { token, body });
  let keys = 0;
  const order = (p, o) => call('POST', '/api/stocks/order', p.token, { key: `test-key-${++keys}`, type: 'market', ...o });
  const dollars = (p) => db.prepare('SELECT dollars FROM users WHERE id = ?').get(p.me.id).dollars;
  // (`fresh`: the path worked out again from the opening, with every fill the server has made since)
  return { s, db, call, order, dollars, sim, key, fresh: () => cache.clear(), set: (ms) => { now = ms; }, at: () => now, sec: () => Math.floor(now / 1000) };
}
async function investor(m, name, money = 50000000) {
  const p = await m.s.register(name);
  m.s.setUser(p.me.id, { dollars: money });
  return p;
}

test('the price path: each company moves its own daily volatility, a minute says nothing of the next, and only the key decides', () => {
  const key = Buffer.alloc(32, 7), t0 = 1795000000 - (1795000000 % DAY);
  for (const c of S.companies) {
    const p = pathOf(key, c), s = { x: 0, v: VOL_MEAN }, mins = [];
    let last = 0;
    for (let n = t0 + 1; n <= t0 + 10 * DAY; n++) {
      p.step(s, n);
      if (n % 60 === 0) { mins.push(s.x - last); last = s.x; }
    }
    const mean = mins.reduce((a, b) => a + b, 0) / mins.length;
    const sd = Math.sqrt(mins.reduce((a, b) => a + (b - mean) ** 2, 0) / mins.length) * Math.sqrt(1440);
    assert.ok(Math.abs(sd / c.vol - 1) < 0.15, `${c.id}: daily volatility ${sd}`);
    let num = 0, den = 0;
    for (let i = 1; i < mins.length; i++) num += (mins[i] - mean) * (mins[i - 1] - mean);
    for (const x of mins) den += (x - mean) ** 2;
    assert.ok(Math.abs(num / den) < 0.05, `${c.id}: autocorrelation ${num / den}`);
  }
  // standard normals, the same for the same key and index, others for another key
  const a = normals(key, 'riru:p'), b = normals(key, 'riru:p'), other = normals(Buffer.alloc(32, 8), 'riru:p');
  let sum = 0, sq = 0;
  for (let n = 0; n < 100000; n++) { const z = a(n); sum += z; sq += z * z; }
  assert.ok(Math.abs(sum / 100000) < 0.02 && Math.abs(sq / 100000 - 1) < 0.03);
  for (const n of [0, 7, 8, 1795000001, 1795000009]) assert.equal(a(n), b(n));
  assert.notEqual(a(1795000001), other(1795000001));
});

test('the price path: outside its band a company is pulled back, and the month before the opening ends at the base price', () => {
  const key = Buffer.alloc(32, 3), t0 = 1795000000 - (1795000000 % DAY);
  for (const c of S.companies) {
    for (const from of [c.band + 0.6, -c.band - 0.6]) {
      const p = pathOf(key, c), s = { x: from, v: VOL_MEAN };
      for (let n = t0 + 1; n <= t0 + 20 * DAY; n++) p.step(s, n);
      assert.ok(Math.abs(s.x) < Math.abs(from) - 0.2, `${c.id} from ${from} to ${s.x}`);
    }
    const h = history(key, c, t0);
    assert.equal(h.length, 30 * 1440);
    assert.equal(h[h.length - 1].c, c.base);
    assert.equal(h[h.length - 1].at, t0 - 60);
    h.forEach((k, i) => {
      assert.ok(k.l <= Math.min(k.o, k.c) && k.h >= Math.max(k.o, k.c));
      if (i) { assert.equal(k.o, h[i - 1].c); assert.equal(k.at, h[i - 1].at + 60); }
    });
  }
});

test('投資: the market opens with a month behind it, and every second comes out as the model says, however the server is woken', async (t) => {
  const m = await market(t);
  const p = await investor(m, 'Opener');
  let r = await m.call('GET', '/api/stocks', p.token);
  assert.equal(r.status, 200, JSON.stringify(r));
  const opened = Math.floor(START / 60000) * 60;
  for (const c of S.companies) assert.equal(m.db.prepare('SELECT opened FROM stock_state WHERE company = ?').get(c.id).opened, opened);
  assert.deepEqual(r.market.map((q) => q.price), S.companies.map((c) => c.base));
  // (the companies began with it: their book price is the market's, and so their first day's centre)
  for (const c of S.companies) assert.deepEqual(Object.values(m.db.prepare('SELECT e0, e1 FROM corp_anchor WHERE company = ? AND day = ?').get(c.id, Math.floor(START / 86400000))), [Math.log(c.base), Math.log(c.base)]);
  assert.equal(r.corp.riru.name, 'RIRU STUDIO');
  assert.equal(m.db.prepare('SELECT COUNT(*) AS n FROM stock_candles WHERE span = 60').get().n, S.companies.length * 3 * 1440);
  assert.equal(m.db.prepare('SELECT COUNT(*) AS n FROM stock_candles WHERE span = ?').get(DAY).n, S.companies.length * 31);
  // woken now and then (seconds apart, minutes, an hour), then after five hours asleep
  for (const step of [1, 1, 37, 60, 61, 3, 599, 1200, 3601, 5 * 3600]) {
    m.set(m.at() + step * 1000);
    r = await m.call('GET', '/api/stocks', p.token);
    const now = m.sec();
    for (const c of S.companies) assert.equal(r.market.find((q) => q.id === c.id).price, m.sim(c.id, now).get(now), `${c.id} at +${step}s`);
  }
  const end = m.sec();
  for (const c of S.companies) {
    const want = m.sim(c.id, end);
    const rows = m.db.prepare('SELECT * FROM stock_candles WHERE company = ? AND span = 60 AND at >= ? ORDER BY at').all(c.id, opened);
    assert.equal(rows.length, Math.floor((end - opened) / 60));
    for (const k of rows) {
      const open = want.get(k.at), ps = [];
      for (let n = k.at + 1; n <= k.at + 60; n++) ps.push(want.get(n));
      assert.deepEqual([k.o, k.h, k.l, k.c, k.v], [open, Math.max(open, ...ps), Math.min(open, ...ps), ps[59], 0], `${c.id} minute ${k.at}`);
    }
    // an hour wholly after the opening is its minutes
    const hour = Math.ceil(opened / 3600) * 3600, hk = m.db.prepare('SELECT * FROM stock_candles WHERE company = ? AND span = 3600 AND at = ?').get(c.id, hour);
    const mins = rows.filter((k) => k.at >= hour && k.at < hour + 3600);
    assert.equal(mins.length, 60);
    assert.deepEqual([hk.o, hk.h, hk.l, hk.c], [mins[0].o, Math.max(...mins.map((k) => k.h)), Math.min(...mins.map((k) => k.l)), mins[59].c]);
    // the checkpoint is the last minute's end; nothing after the second it is now was ever worked out
    const st = m.db.prepare('SELECT tick FROM stock_state WHERE company = ?').get(c.id);
    assert.equal(st.tick, Math.floor(end / 60) * 60);
  }
});

test('投資: market orders trade at this second\'s price, with the 1.8% fee (Dtrade\'s) rounded up, the average cost and the profit taken', async (t) => {
  const m = await market(t);
  const p = await investor(m, 'Trader', 10000000);
  await m.call('GET', '/api/stocks', p.token);
  m.set(m.at() + 4321 * 1000);
  const before = m.dollars(p);
  let r = await m.order(p, { key: 'order-buy-0001', company: 'riru', side: 'buy', shares: 100 });
  assert.equal(r.status, 200, JSON.stringify(r));
  const price = slipped('riru', { side: 'buy', type: 'market', shares: 100 }, m.sim('riru', m.sec()).get(m.sec()));
  assert.equal(r.order.fill, price);
  assert.ok(price > m.sim('riru', m.sec()).get(m.sec()));
  assert.equal(r.order.status, 'filled');
  assert.equal(r.order.fee, fee(price * 100));
  assert.equal(r.order.amount, price * 100 + fee(price * 100));
  assert.equal(m.dollars(p), before - r.order.amount);
  assert.equal(r.me.dollars, before - r.order.amount);
  const h = r.mine.holdings.find((x) => x.id === 'riru');
  // (held at the market's price of the second, not at what the order paid)
  assert.deepEqual([h.shares, h.free, h.cost, h.value], [100, 100, r.order.amount, 100 * m.sim('riru', m.sec()).get(m.sec())]);
  assert.equal(r.mine.trades, 1);
  // the same order again (its answer lost): the same order, nothing paid twice; the same key for another order: refused
  const again = await m.order(p, { key: 'order-buy-0001', company: 'riru', side: 'buy', shares: 100 });
  assert.equal(again.order.id, r.order.id);
  assert.equal(m.dollars(p), before - r.order.amount);
  assert.equal(again.mine.trades, 1);
  assert.equal((await m.order(p, { key: 'order-buy-0001', company: 'riru', side: 'buy', shares: 5 })).error.code, 'key_reused');
  // a sale: the fee taken from what it brings, its share of the cost out, the profit (or loss) taken
  m.set(m.at() + 777 * 1000);
  const cost = r.order.amount, sold = slipped('riru', { side: 'sell', type: 'market', shares: 40 }, m.sim('riru', m.sec()).get(m.sec())), mid = m.dollars(p);
  r = await m.order(p, { company: 'riru', side: 'sell', shares: 40 });
  const brings = sold * 40 - fee(sold * 40), out = Math.round(cost * 40 / 100);
  assert.deepEqual([r.order.fill, r.order.amount, r.order.profit], [sold, brings, brings - out]);
  assert.equal(m.dollars(p), mid + brings);
  const h2 = r.mine.holdings.find((x) => x.id === 'riru');
  assert.deepEqual([h2.shares, h2.cost, h2.realized], [60, cost - out, brings - out]);
  // what there is not: shares, money
  assert.equal((await m.order(p, { company: 'riru', side: 'sell', shares: 61 })).error.code, 'no_shares');
  assert.equal((await m.order(p, { company: 'ice', side: 'sell', shares: 1 })).error.code, 'no_shares');
  m.s.setUser(p.me.id, { dollars: 1000 });
  assert.equal((await m.order(p, { company: 'ice', side: 'buy', shares: 1 })).error.code, 'insufficient');
  // what is asked for: a company, a side, whole shares
  for (const [o, code] of [[{ company: 'nope', side: 'buy', shares: 1 }, 'bad_company'], [{ company: 'riru', side: 'hold', shares: 1 }, 'bad_order'],
    [{ company: 'riru', side: 'buy', shares: 1.5 }, 'bad_amount'], [{ company: 'riru', side: 'buy', shares: 0 }, 'bad_amount'], [{ company: 'riru', side: 'buy', shares: S.maxShares + 1 }, 'bad_shares'],
    [{ company: 'riru', side: 'buy', shares: 1, key: 'bad key' }, 'bad_key']]) assert.equal((await m.order(p, o)).error.code, code);
  assert.equal((await m.call('GET', '/api/stocks', null)).status, 401);
});

test('投資: $800,000,000 bought a trading day across every company (the filled buys with their fee and the money buy orders hold), 200 trades a day, 10 orders waiting', async (t) => {
  const m = await market(t);
  const p = await investor(m, 'Capped', 2000000000);
  let r = await m.call('GET', '/api/stocks', p.token);
  const riru = r.market.find((q) => q.id === 'riru').price;
  assert.equal(S.dayCap, 800000000);
  r = await m.order(p, { company: 'ice', side: 'buy', shares: 100 });
  assert.equal(r.status, 200);
  const first = r.order.amount, firstValue = r.order.fill * 100;
  // a limit buy holds its money, and that counts too
  const lim = riru - 100;
  r = await m.order(p, { company: 'riru', side: 'buy', type: 'limit', shares: 50, price: lim });
  assert.equal(r.order.status, 'open');
  assert.equal(r.order.reserved, lim * 50 + fee(lim * 50));
  assert.equal(r.mine.bought, first + r.order.reserved);
  assert.equal(r.mine.dayCap, S.dayCap);
  // (a market buy is checked at the price it fills at, fee and all: a big one slips a little above the price now; one
  // that brings the day's trades to $400,000,000 pays 10%)
  assert.equal(r.mine.traded, firstValue);
  const traded = r.mine.traded;
  const room = S.dayCap - r.mine.bought, buys = (n) => n * slipped('riru', { side: 'buy', type: 'market', shares: n }, riru), need = (n) => buys(n) + feeAfter(buys(n), traded);
  let most = Math.floor(room / riru);
  while (need(most) > room) most--;
  const over = await m.order(p, { company: 'riru', side: 'buy', shares: most + 1 });
  assert.equal(over.error.code, 'cap');
  assert.equal(over.error.room, room);
  r = await m.order(p, { company: 'riru', side: 'buy', shares: most });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.ok(r.order.amount <= room);
  assert.equal(r.order.fee, Math.ceil(r.order.fill * most * 0.1));
  assert.ok(r.mine.traded >= S.activeAt);
  // selling does not make room: the day's buys are counted, not what is held
  await m.order(p, { company: 'ice', side: 'sell', shares: 10 });
  assert.equal((await m.order(p, { company: 'riru', side: 'buy', shares: Math.floor((S.dayCap - r.mine.bought) / riru) + 1 })).error.code, 'cap');
  // the prices of limit and stop orders: the right side of the price now, within ±30%
  const q = (await m.call('GET', '/api/stocks', p.token)).market.find((x) => x.id === 'ice').price;
  for (const [o, code] of [[{ side: 'buy', type: 'limit', price: q }, 'price_side'], [{ side: 'buy', type: 'limit', price: Math.floor(q * 0.69) }, 'price_range'],
    [{ side: 'sell', type: 'limit', price: q - 1 }, 'price_side'], [{ side: 'buy', type: 'stop', price: q - 1 }, 'price_side'], [{ side: 'sell', type: 'stop', price: q + 1 }, 'price_side'],
    [{ side: 'sell', type: 'stop', price: Math.floor(q * 0.69) }, 'price_range'], [{ side: 'buy', type: 'limit' }, 'bad_amount']]) {
    assert.equal((await m.order(p, { company: 'ice', shares: 1, ...o })).error.code, code, JSON.stringify(o));
  }
  // 200 a day: an order that waits counts, one cancelled gives its count back; the next trading day (9:00 Japan time) starts again
  assert.equal(S.tradesPerDay, 200);
  const p2 = await investor(m, 'Busy', 50000000);
  const low = (await m.call('GET', '/api/stocks', p2.token)).market.find((x) => x.id === 'ice').price - 200;
  const waiting = await m.order(p2, { company: 'ice', side: 'buy', type: 'limit', shares: 1, price: low });
  for (let i = 0; i < S.tradesPerDay - 1; i++) assert.equal((await m.order(p2, { company: 'riru', side: 'buy', shares: 1 })).status, 200);
  const no = await m.order(p2, { company: 'riru', side: 'buy', shares: 1 });
  assert.equal(no.error.code, 'trade_limit');
  r = await m.call('POST', '/api/stocks/cancel', p2.token, { id: waiting.order.id });
  assert.equal(r.order.status, 'canceled');
  assert.equal(r.mine.trades, S.tradesPerDay - 1);
  assert.equal((await m.order(p2, { company: 'riru', side: 'buy', shares: 1 })).status, 200);
  assert.equal((await m.order(p2, { company: 'riru', side: 'sell', shares: 1 })).error.code, 'trade_limit');
  assert.equal((await m.call('POST', '/api/stocks/cancel', p2.token, { id: waiting.order.id })).error.code, 'order_done');
  m.set(S.dayEnd(m.at()) + 5000);
  r = await m.order(p2, { company: 'riru', side: 'sell', shares: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.mine.trades, 1);
  // 10 waiting at once
  const p3 = await investor(m, 'Waiter', 50000000);
  const base = (await m.call('GET', '/api/stocks', p3.token)).market.find((x) => x.id === 'riru').price;
  for (let i = 0; i < S.openOrders; i++) assert.equal((await m.order(p3, { company: 'riru', side: 'buy', type: 'limit', shares: 1, price: base - 300 - i })).status, 200);
  assert.equal((await m.order(p3, { company: 'riru', side: 'buy', type: 'limit', shares: 1, price: base - 400 })).error.code, 'order_limit');
  // somebody else's order is not mine to cancel
  const theirs = m.db.prepare("SELECT id FROM stock_orders WHERE user_id = ? AND status = 'open' LIMIT 1").get(p3.me.id).id;
  assert.equal((await m.call('POST', '/api/stocks/cancel', p2.token, { id: theirs })).error.code, 'no_order');
});

test('投資 MAX: a buy sent as one that fits is taken down to the most the money in hand and the day\'s room allow at the price then — never refused for them; the same again is the same order', async (t) => {
  const m = await market(t);
  // (more money than the day's room: the room decides)
  const p = await investor(m, 'MaxRoom', 5000000000);
  let r = await m.call('GET', '/api/stocks', p.token);
  const riru = r.market.find((q) => q.id === 'riru').price;
  const depth = CORP.company('riru').depth, room = S.dayCap - r.mine.bought;
  // (the day's first trade, but over $400,000,000: at an active player's 10%)
  const want = S.maxBuy(depth, 'market', 0, riru, room, S.maxShares, 0);
  assert.ok(want > 1000 && want < S.maxShares);
  assert.equal((await m.order(p, { company: 'riru', side: 'buy', shares: want + 500 })).error.code, 'cap');
  const key = 'k' + 'm'.repeat(20);
  r = await m.call('POST', '/api/stocks/order', p.token, { company: 'riru', side: 'buy', type: 'market', shares: want + 500, fit: true, key });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.ok(r.order.shares <= want + 500 && r.order.shares >= want - 2, `${r.order.shares} of ${want}`);
  assert.ok(r.order.amount <= room + riru, `${r.order.amount} ${room}`);
  // (its answer lost: the same key again is the same order, not a second one)
  const again = await m.call('POST', '/api/stocks/order', p.token, { company: 'riru', side: 'buy', type: 'market', shares: want + 500, fit: true, key });
  assert.equal(again.order.id, r.order.id);
  // (less money than the room: the money decides)
  const q = await investor(m, 'MaxCash', 30000000);
  r = await m.call('POST', '/api/stocks/order', q.token, { company: 'ice', side: 'buy', type: 'market', shares: S.maxShares, fit: true, key: 'k' + 'q'.repeat(20) });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.ok(r.order.amount <= 30000000 && r.order.amount > 29000000, String(r.order.amount));
  // (a sale is never fitted)
  assert.equal((await m.call('POST', '/api/stocks/order', q.token, { company: 'ice', side: 'sell', type: 'market', shares: r.order.shares + 5, fit: true, key: 'k' + 's'.repeat(20) })).error.code, 'no_shares');
});

// the first second after `from` whose price meets `hit`, by the model
function firstHit(m, id, from, to, hit) {
  const prices = m.sim(id, to);
  for (let n = from; n <= to; n++) if (hit(prices.get(n))) return n;
  return 0;
}

test('投資: $800,000,000 sold a trading day too (the filled sales at their price, the sell orders waiting at theirs); from $400,000,000 traded in the day the fee is 10%', async (t) => {
  const m = await market(t);
  const p = await investor(m, 'Seller', 1000000000);
  assert.equal(S.sellCap, 800000000);
  assert.equal(S.activeAt, 400000000);
  // (shares worth more than the day's selling cap, held from before)
  m.db.prepare('INSERT INTO stock_holdings (user_id, company, shares, cost, realized, gains, dividends, frac, acc_day, acc_at, acc) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0)')
    .run(p.me.id, 'ice', 90000, 90000 * 30000);
  let r = await m.call('GET', '/api/stocks', p.token);
  const ice = r.market.find((q) => q.id === 'ice').price;
  assert.equal(r.mine.sellCap, S.sellCap);
  assert.equal(r.mine.sold, 0);
  // a small sale: the usual 1.8%
  r = await m.order(p, { company: 'ice', side: 'sell', shares: 100 });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.order.fee, fee(r.order.fill * 100));
  assert.equal(r.mine.sold, r.order.fill * 100);
  // a sell order waiting holds its part of the cap
  const lim = ice + 200;
  r = await m.order(p, { company: 'ice', side: 'sell', type: 'limit', shares: 1000, price: lim });
  assert.equal(r.order.status, 'open');
  assert.equal(r.mine.sold, r.order.price * 1000 + m.db.prepare("SELECT fill_price * shares AS v FROM stock_orders WHERE user_id = ? AND type = 'market'").get(p.me.id).v);
  assert.equal(r.mine.traded, r.mine.sold - lim * 1000);
  // the one that brings the day's trades to $400,000,000 pays 10%
  // (a big sale slips below the price now: well past it)
  const before = r.mine.traded;
  let n = Math.ceil((S.activeAt - before) / ice * 1.1);
  r = await m.order(p, { company: 'ice', side: 'sell', shares: n });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.order.fee, Math.ceil(r.order.fill * n * 0.1));
  assert.ok(r.mine.traded >= S.activeAt);
  // and every one after it that day
  r = await m.order(p, { company: 'ice', side: 'sell', shares: 10 });
  assert.equal(r.order.fee, Math.ceil(r.order.fill * 10 * 0.1));
  // beyond the day's selling cap: refused, with the room left
  const room = S.sellCap - r.mine.sold;
  const now = (await m.call('GET', '/api/stocks', p.token)).market.find((q) => q.id === 'ice').price;
  n = Math.ceil(room / now * 1.2);
  const over = await m.order(p, { company: 'ice', side: 'sell', shares: n });
  assert.equal(over.error.code, 'sell_cap');
  assert.equal(over.error.room, room);
  // buying is the buys' own cap: a buy still goes
  assert.equal((await m.order(p, { company: 'riru', side: 'buy', shares: 1 })).status, 200);
  // the next trading day: the caps and the 10% start again
  m.set(S.dayEnd(m.at()) + 5000);
  r = await m.order(p, { company: 'ice', side: 'sell', shares: 100 });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.order.fee, fee(r.order.fill * 100));
  assert.equal(r.mine.sold, r.order.fill * 100);
});

test('投資: limit and stop orders wait and trade in the first second that reaches them, at its price, even while the server sleeps', async (t) => {
  const m = await market(t);
  const p = await investor(m, 'Patient', 20000000);
  await m.call('GET', '/api/stocks', p.token);
  await m.order(p, { company: 'riru', side: 'buy', shares: 300 });
  await m.order(p, { company: 'ice', side: 'buy', shares: 100 });
  m.set(m.at() + 61 * 1000);
  const placed = m.sec(), horizon = placed + 3 * 3600;
  // prices that the next three hours reach, worked out ahead (the two companies held here)
  const plan = [];
  for (const c of S.companies.filter((x) => x.id === 'riru' || x.id === 'ice')) {
    const prices = m.sim(c.id, horizon), now = prices.get(placed);
    let lo = Infinity, hi = -Infinity;
    for (let n = placed + 1; n <= horizon; n++) { lo = Math.min(lo, prices.get(n)); hi = Math.max(hi, prices.get(n)); }
    if (lo < now - 1) {
      const level = Math.ceil((lo + now) / 2);
      plan.push({ company: c.id, side: c.id === 'riru' ? 'buy' : 'sell', type: c.id === 'riru' ? 'limit' : 'stop', price: level, falls: true });
    }
    if (hi > now + 1) {
      const level = Math.floor((hi + now) / 2);
      plan.push({ company: c.id, side: c.id === 'riru' ? 'sell' : 'buy', type: c.id === 'riru' ? 'limit' : 'stop', price: level, falls: false });
    }
  }
  assert.ok(plan.length >= 2);
  const before = m.dollars(p), placedOrders = [];
  for (const o of plan) {
    const r = await m.order(p, { company: o.company, side: o.side, type: o.type, shares: 10, price: o.price });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.order.status, 'open');
    placedOrders.push({ ...o, id: r.order.id, reserved: r.order.reserved, at: firstHit(m, o.company, placed + 1, horizon, o.falls ? (x) => x <= o.price : (x) => x >= o.price) });
  }
  const held = placedOrders.reduce((n, o) => n + o.reserved, 0);
  assert.equal(m.dollars(p), before - held);
  // three hours asleep, then a single look
  m.set((horizon + 1) * 1000);
  const r = await m.call('GET', '/api/stocks', p.token);
  assert.equal(r.mine.orders.length, 0);
  // (each fill moved the price for the seconds after it, so the seconds the others reached are found again on
  // the path as it went, fills and all)
  m.fresh();
  for (const o of placedOrders) o.at = firstHit(m, o.company, placed + 1, horizon, o.falls ? (x) => x <= o.price : (x) => x >= o.price);
  let money = before - held;
  for (const o of placedOrders) {
    const row = m.db.prepare('SELECT * FROM stock_orders WHERE id = ?').get(o.id), second = m.sim(o.company, horizon).get(o.at);
    const price = slipped(o.company, { side: o.side, type: o.type, shares: 10, price: o.price }, second);
    assert.ok(o.at > placed);
    assert.deepEqual([row.status, row.done_at, row.fill_price], ['filled', o.at * 1000, price], JSON.stringify(o));
    assert.ok(o.falls ? second <= o.price : second >= o.price);
    if (o.type === 'limit') assert.ok(o.side === 'buy' ? price <= o.price : price >= o.price);
    if (o.side === 'buy') {
      assert.equal(row.amount, price * 10 + fee(price * 10));
      money += o.reserved - row.amount;
    } else {
      assert.equal(row.amount, price * 10 - fee(price * 10));
      money += row.amount;
    }
  }
  assert.equal(m.dollars(p), money);
  // the volume of the minutes they traded in
  for (const o of placedOrders) {
    const k = m.db.prepare('SELECT v FROM stock_candles WHERE company = ? AND span = 60 AND at = ?').get(o.company, Math.floor((o.at - 1) / 60) * 60);
    assert.ok(k.v >= 10);
  }
});

test('投資: what has not traded by 9:00 Japan time expires, its money back; a sell order\'s shares are held until then', async (t) => {
  const m = await market(t);
  const p = await investor(m, 'Expiring', 5000000);
  const q = (await m.call('GET', '/api/stocks', p.token)).market.find((x) => x.id === 'riru').price;
  await m.order(p, { company: 'riru', side: 'buy', shares: 20 });
  const before = m.dollars(p);
  const buy = await m.order(p, { company: 'riru', side: 'buy', type: 'limit', shares: 10, price: Math.ceil(q * 0.71) });
  const sell = await m.order(p, { company: 'riru', side: 'sell', type: 'limit', shares: 15, price: Math.floor(q * 1.29) });
  assert.equal(m.dollars(p), before - buy.order.reserved);
  assert.equal(sell.mine.holdings.find((h) => h.id === 'riru').free, 5);
  assert.equal((await m.order(p, { company: 'riru', side: 'sell', shares: 6 })).error.code, 'no_shares');
  const end = S.dayEnd(m.at());
  assert.equal(buy.order.expires, end);
  m.set(end + 61000);
  const r = await m.call('GET', '/api/stocks', p.token);
  assert.equal(r.mine.orders.length, 0);
  for (const o of [buy.order, sell.order]) assert.deepEqual(Object.values(m.db.prepare('SELECT status, done_at FROM stock_orders WHERE id = ?').get(o.id)), ['expired', end]);
  assert.equal(m.dollars(p), before);
  assert.equal(r.mine.holdings.find((h) => h.id === 'riru').free, 20);
  const hist = await m.call('GET', '/api/stocks/history', p.token);
  assert.deepEqual(hist.orders.map((o) => o.status), ['expired', 'expired', 'filled']);
});

test('投資: dividends — each day the day\'s average holding by the second × the company\'s dividend a share for the day (業績連動), claimed into $', async (t) => {
  const m = await market(t);
  const p = await investor(m, 'Holder', 20000000);
  await m.call('GET', '/api/stocks', p.token);
  const end = S.dayEnd(m.at()) / 1000;
  // two hours before the close: 200 RIRU and 100 Ice
  m.set((end - 7200) * 1000 + 300);
  await m.order(p, { company: 'riru', side: 'buy', shares: 200 });
  await m.order(p, { company: 'ice', side: 'buy', shares: 100 });
  // a whole day more, and a minute
  m.set((end + DAY + 60) * 1000);
  let r = await m.call('GET', '/api/stocks', p.token);
  // (the dividend a share of each second of a day, as the company set it for that day)
  const dps = (id, endSec) => m.db.prepare('SELECT dps FROM corp_anchor WHERE company = ? AND day = ?').get(id, endSec / DAY - 1).dps;
  const due = 200 * 7200 / DAY * dps('riru', end) + 200 * dps('riru', end + DAY);
  const dueIce = 100 * 7200 / DAY * dps('ice', end) + 100 * dps('ice', end + DAY);
  // (RIRU STUDIO may expect no profit and pay none: 無配; Ice Smoker pays)
  assert.ok(dps('ice', end) > 0);
  const riru = r.mine.holdings.find((h) => h.id === 'riru'), ice = r.mine.holdings.find((h) => h.id === 'ice');
  // (each company keeps its own cents: a day pays its whole dollars, the rest waits for the next)
  assert.equal(riru.dividends, Math.floor(due));
  assert.equal(ice.dividends, Math.floor(dueIce));
  assert.equal(r.mine.dividend.pending, Math.floor(due) + Math.floor(dueIce));
  // (today's so far: the minute into the new day, at its own dividend a share)
  assert.equal(ice.today, Math.floor(100 * 60 / DAY * dps('ice', end + 2 * DAY)));
  assert.equal(riru.today, Math.floor(200 * 60 / DAY * dps('riru', end + 2 * DAY)));
  // looking again changes nothing; claiming pays it into $
  r = await m.call('GET', '/api/stocks', p.token);
  assert.equal(r.mine.dividend.pending, Math.floor(due) + Math.floor(dueIce));
  const before = m.dollars(p);
  r = await m.call('POST', '/api/stocks/claim', p.token, {});
  assert.equal(r.paid, Math.floor(due) + Math.floor(dueIce));
  assert.equal(m.dollars(p), before + r.paid);
  assert.deepEqual(r.mine.dividend, { pending: 0, claimed: r.paid });
  assert.equal((await m.call('POST', '/api/stocks/claim', p.token, {})).paid, 0);
  // a minute before the close in, a minute after it out: a minute's worth of the day, no more
  const q = await investor(m, 'Sniper', 20000000), next = end + 2 * DAY;
  m.set((next - 60) * 1000 + 10);
  await m.call('GET', '/api/stocks', q.token);
  await m.order(q, { company: 'ice', side: 'buy', shares: 200 });
  m.set((next + 60) * 1000 + 10);
  await m.order(q, { company: 'ice', side: 'sell', shares: 200 });
  r = await m.call('GET', '/api/stocks', q.token);
  assert.equal(r.mine.dividend.pending, Math.floor(200 * 60 / DAY * dps('ice', next)));
  assert.ok(r.mine.dividend.pending < 200 * dps('ice', next) / 1000 + 1);
});

test('投資: the charts — every period from its stored candles, the minute forming now on top, as small columns the game decodes', async (t) => {
  const m = await market(t);
  const p = await investor(m, 'Charter');
  await m.call('GET', '/api/stocks', p.token);
  m.set(m.at() + 2 * 3600 * 1000 + 17000);
  await m.order(p, { company: 'riru', side: 'buy', shares: 7 });
  await m.order(p, { company: 'riru', side: 'sell', shares: 3 });
  const now = m.sec(), prices = m.sim('riru', now);
  for (const per of S.periods) {
    const r = await m.call('GET', `/api/stocks/chart?c=riru&p=${per.id}`, p.token);
    assert.equal(r.status, 200);
    const k = S.decode(r.chart);
    assert.ok(k.length > 1 && k.length <= per.count + 1, `${per.id}: ${k.length}`);
    k.forEach((x, i) => {
      assert.ok(x.l <= Math.min(x.o, x.c) && x.h >= Math.max(x.o, x.c));
      if (i) { assert.equal(x.at, k[i - 1].at + per.span); assert.equal(x.o, k[i - 1].c); }
    });
    const last = k[k.length - 1];
    assert.equal(last.c, prices.get(now), per.id);
    assert.equal(last.at, S.bucket(now - 1, per.span));
    assert.ok(last.v >= 10, `${per.id} volume ${last.v}`);
  }
  // the 1H chart is the stored minutes and the one forming
  const r = await m.call('GET', '/api/stocks/chart?c=riru&p=1h', p.token);
  const k = S.decode(r.chart), stored = m.db.prepare('SELECT * FROM stock_candles WHERE company = ? AND span = 60 AND at >= ? ORDER BY at').all('riru', k[0].at);
  assert.deepEqual(k.slice(0, stored.length).map((x) => [x.at, x.o, x.h, x.l, x.c, x.v]), stored.map((x) => [x.at, x.o, x.h, x.l, x.c, x.v]));
  assert.equal(k[k.length - 1].v, 10);
  // from a candle on: only the candles from there
  const since = k[k.length - 3].at, part = S.decode((await m.call('GET', `/api/stocks/chart?c=riru&p=1h&since=${since}`, p.token)).chart);
  assert.deepEqual(part.map((x) => x.at), k.slice(-3).map((x) => x.at));
  for (const [url, code] of [['/api/stocks/chart?c=x&p=1h', 'bad_company'], ['/api/stocks/chart?c=riru&p=2h', 'bad_period'], ['/api/stocks/chart?c=riru&p=1h&since=-1', 'bad_since']]) {
    assert.equal((await m.call('GET', url, p.token)).error.code, code);
  }
});

test('投資: the screen open, a tick every second over the live connection (never a second ahead of the server\'s clock); closed, none', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const p = await s.register('Watcher');
  const live = await s.listen(p);
  t.after(() => live.close());
  assert.equal((await s.call('POST', '/api/stocks/watch', { token: p.token, body: { on: 1 } })).ok, true);
  const a = await live.waitFor('stock', (d) => Array.isArray(d.q), 3000);
  const b = await live.waitFor('stock', (d) => Array.isArray(d.q) && d.t > a.t, 3000);
  for (const f of [a, b]) {
    assert.ok(f.t <= Math.floor(Date.now() / 1000));
    assert.equal(f.q.length, S.companies.length);
    for (const [price, hi, lo] of f.q) assert.ok(lo <= price && price <= hi);
  }
  assert.equal(s.app.api.stocks.watching(), 1);
  await s.call('POST', '/api/stocks/watch', { token: p.token, body: { on: 0 } });
  assert.equal(s.app.api.stocks.watching(), 0);
  await new Promise((r) => setTimeout(r, 1300));
  const seen = live.events.length;
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(live.events.filter((e) => e.name === 'stock').length, live.events.slice(0, seen).filter((e) => e.name === 'stock').length);
});

test('投資: my finished orders page by page; the tables are in backups, a deleted account takes its stock rows, old candles and orders go', async (t) => {
  const m = await market(t);
  const p = await investor(m, 'Recorder');
  await m.call('GET', '/api/stocks', p.token);
  for (let i = 0; i < 31; i++) {
    if (i === 15) m.set(S.dayEnd(m.at()) + 1000);
    assert.equal((await m.order(p, { company: 'ice', side: i % 2 ? 'sell' : 'buy', shares: 1 })).status, 200);
  }
  const first = await m.call('GET', '/api/stocks/history', p.token);
  assert.equal(first.orders.length, 30);
  assert.equal(first.more, true);
  const rest = await m.call('GET', `/api/stocks/history?before=${first.orders[29].id}`, p.token);
  assert.equal(rest.orders.length, 1);
  assert.equal(rest.more, false);
  for (const name of ['stock_state', 'stock_candles', 'stock_holdings', 'stock_accounts', 'stock_orders']) assert.ok(TABLES.includes(name), name);
  for (const name of ['stock_holdings', 'stock_accounts', 'stock_orders']) assert.ok(PLAYER_ROWS.some(([n]) => n === name), name);
  // four days on, the housekeeping: the minutes older than 3 days and the orders older than 90 days go
  m.set(m.at() + 4 * DAY * 1000);
  m.s.app.api.stocks.housekeep();
  const oldest = m.db.prepare('SELECT MIN(at) AS at FROM stock_candles WHERE span = 60').get().at;
  assert.ok(oldest >= m.sec() - 3 * DAY);
  m.db.prepare('UPDATE stock_orders SET done_at = ? WHERE user_id = ?').run(m.at() - 91 * 86400000, p.me.id);
  m.s.app.api.stocks.housekeep();
  assert.equal(m.db.prepare('SELECT COUNT(*) AS n FROM stock_orders WHERE user_id = ?').get(p.me.id).n, 0);
  // a deleted account: its holdings, dividends and orders go with it
  await m.order(p, { company: 'ice', side: 'buy', shares: 2 });
  m.db.prepare('INSERT INTO stock_accounts (user_id, pending) VALUES (?, 5) ON CONFLICT(user_id) DO UPDATE SET pending = 5').run(p.me.id);
  const q = statements(m.db);
  const tx = (fn) => m.db.tx ? m.db.tx(fn) : fn();
  const gone = purgePlayer(q, tx, p.me.id);
  assert.ok(gone.stock_holdings && gone.stock_accounts && gone.stock_orders, JSON.stringify(gone));
});
