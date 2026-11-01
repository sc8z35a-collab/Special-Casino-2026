// MAGITA Garage (the monthly contract fee, its cut of the rentals), MAGITA Robert (the buy-back), YOSIDA (MAGITA's
// rival, its cars and engines, its money abroad), Car Owner's stock in lots, the economy and the share prices of the
// car trade, the companies' people and their development work, and a world begun before YOSIDA was: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import * as model from '../core/corp-model.js';
import { orderCar } from '../core/npc-model.js';
import { CORP, RULES, STOCKS } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 20, 0, 0);
const launch = Math.floor(START / 86400000);
const MONTH0 = Date.UTC(2026, 10, 1);
const flows = (s) => s.app.db.prepare('SELECT data FROM corp_flows').all().map((r) => JSON.parse(r.data))
  .reduce((a, d) => { for (const [k, v] of Object.entries(d.magita || {})) a[k] = (a[k] || 0) + v; return a; }, {});

test('the rules: YOSIDA with its numbers, its six cars and two engines (no 専売特別費用, the dealer keeps price − 仕入れ価格), listed with Car Owner', () => {
  const y = CORP.company('yosida');
  assert.deepEqual([y.staff, y.salary, y.cost, y.place.amount, y.rd.amount, y.capital, y.retained, y.listed, y.model],
    [4500, 2400000, 3800000, 6500000000, 1700000000, 1200000000, 35000000000, true, 'maker']);
  const want = { 'yoshida-zx4': [8500000, 2800000, 4500000, 4000000], 'yoshida-p100w': [6400000, 2100000, 2400000, 4000000], 'yoshida-h9c': [10500000, 4300000, 3000000, 7500000],
    'yoshida-s5': [4000000, 1500000, 1500000, 2500000], 'yoshida-s6': [3600000, 1000000, 2000000, 1600000], 'yoshida-k10e': [6000000, 3000000, 1500000, 4500000] };
  for (const [id, [price, cost, net, buy]] of Object.entries(want)) {
    const car = RULES.cars.find((c) => c.id === id), pr = CORP.products.cars[id];
    assert.deepEqual([car.price, pr.cost, car.price - pr.buy - pr.excl, pr.buy, pr.maker], [price, cost, net, buy, 'yosida'], id);
  }
  for (const [id, price, cost, net, buy] of [['yoshida-er10', 2000000, 1100000, 600000, 1400000], ['yoshida-er20', 6500000, 3200000, 2500000, 4000000]]) {
    const item = RULES.shop.find((i) => i.id === id), pr = CORP.products.items[id];
    assert.deepEqual([item.price, item.kind, pr.cost, item.price - pr.buy, pr.buy, pr.excl], [price, 'engine', cost, net, buy, 0], id);
  }
  // YOSHIDA's cars sell to more people than MAGITA's, start in bigger lots, grow far faster when sold out, and take 5 days
  const units = (m) => Object.values(CORP.products.cars).filter((p) => p.maker === m).reduce((n, p) => n + p.npc, 0);
  assert.ok(units('yosida') > units('magita'));
  assert.ok(CORP.firstLot('yoshida-s6', 1) > CORP.firstLot('onvoro', 1) / 4 && CORP.firstLot('yoshida-zx4', 1) > CORP.firstLot('nissan-gt-r', 1));
  assert.deepEqual([CORP.makers.magita.lead, CORP.makers.yosida.lead], [1, 5]);
  assert.ok(CORP.makers.yosida.grow > CORP.makers.magita.grow && CORP.makers.yosida.maxGrow > CORP.makers.magita.maxGrow);
  assert.ok(CORP.makers.magita.beta > 0 && CORP.makers.yosida.beta < 0);
  assert.deepEqual(STOCKS.companies.map((c) => c.id), ['riru', 'ice', 'magita', 'tenesice', 'yosida', 'carowner']);
  assert.equal(STOCKS.dayCap, 80000000);
  assert.deepEqual([CORP.magita.garage.base, CORP.magita.garage.min, CORP.magita.garage.max, CORP.magita.garage.rentCut], [100000, 110000, 200000, 0.1]);
});

test('Car Owner orders a sold-out car again in a bigger lot: MAGITA\'s by the next day, YOSHIDA\'s five days later and far more of them', () => {
  const W = { scale: 1, stock: { cars: { 'nissan-gt-r': 0, 'yoshida-s6': 0 }, orders: [], lots: {} } };
  orderCar(W, 'nissan-gt-r', 100);
  orderCar(W, 'yoshida-s6', 100);
  orderCar(W, 'yoshida-s6', 100);   // (once: one already on its way)
  const gtr = W.stock.orders.find((o) => o.id === 'nissan-gt-r'), s6 = W.stock.orders.filter((o) => o.id === 'yoshida-s6');
  assert.equal(s6.length, 1);
  assert.equal(gtr.at, 101);
  assert.equal(s6[0].at, 105);
  const f1 = CORP.firstLot('nissan-gt-r', 1), f2 = CORP.firstLot('yoshida-s6', 1);
  assert.equal(gtr.n, Math.max(f1 + 1, Math.ceil(f1 * 1.25)));
  assert.equal(s6[0].n, f2 * 2);
  // sold out again: the lots grow again (up to their caps)
  W.stock.orders = [];
  orderCar(W, 'yoshida-s6', 110);
  assert.equal(W.stock.orders[0].n, Math.min(f2 * 32, f2 * 4));
});

test('the economy: in bad times YOSHIDA\'s cars sell more and MAGITA\'s less, in good times the other way; Car Owner sells both', () => {
  const key = Buffer.alloc(32, 9), ch = model.chance(key);
  const sold = (x) => {
    const { world: w } = model.boot(key, launch, { years: 0 });
    const by = { magita: 0, yosida: 0 };
    for (let d = launch; d < launch + 28; d++) {
      w.econ.x = x;
      model.closeDay(w, d, {}, ch);
      for (const [id, r] of Object.entries(w.co.carowner.sold || {})) { const pr = CORP.products.cars[id]; if (pr) by[pr.maker] += r.sales; }
    }
    return by;
  };
  const bad = sold(-0.15), good = sold(0.15);
  assert.ok(bad.yosida > good.yosida, JSON.stringify({ bad, good }));
  assert.ok(good.magita > bad.magita, JSON.stringify({ bad, good }));
});

test('YOSIDA lives as a carmaker: its sales to the dealer and the shop and abroad, its books balance; no MAGITA research or surcharge of its own', () => {
  const key = Buffer.alloc(32, 4), ch = model.chance(key);
  const { world: w } = model.boot(key, launch, { years: 0 });
  w.co.magita.surcharge = launch;
  assert.equal(model.surcharges(w)['yoshida-zx4'], undefined);
  assert.ok(model.surcharges(w)['nissan-gt-r'] > 0);
  for (let d = launch; d < launch + 40; d++) model.closeDay(w, d, {}, ch);
  const y = w.co.yosida;
  assert.ok(!y.lab);
  assert.ok((y.per.y['r:dealer'] || 0) > 0 && (y.per.y['r:retail'] || 0) > 0 && (y.per.y['r:export'] || 0) > 0);
  assert.equal(model.assetsOf(y), model.liabilitiesOf(y) + model.equityOf(y));
});

test('MAGITA raises the garage fee to $110,000〜$200,000 a place while it does badly, and back to $100,000 when well; the companies cut and hire by their year; every one develops', () => {
  const key = Buffer.alloc(32, 6), ch = model.chance(key);
  const { world: w } = model.boot(key, launch, { years: 0 });
  assert.equal(model.garageFeeOf(w), 100000);
  // (a plan far beyond what it can do: a bad quarter)
  for (const id of ['magita', 'jinx']) w.co[id].guide.expected.quarters = w.co[id].guide.expected.quarters.map((x) => Math.abs(x) * 20 + 1e9);
  const news = [];
  const n0 = w.co.jinx.n;
  for (let d = launch; d <= CORP.quarterEnd(CORP.fyOf(launch), CORP.quarterOf(launch)) + 1; d++) news.push(...model.closeDay(w, d, {}, ch).news);
  const fee = model.garageFeeOf(w);
  assert.ok(fee >= 110000 && fee <= 200000, String(fee));
  assert.ok(news.some((n) => n.kind === 'garage' && n.company === 'magita' && n.public));
  const cut = news.find((n) => n.kind === 'staff' && n.company === 'jinx');
  assert.ok(cut && cut.data.cut > 0, 'a cut');
  assert.ok(w.co.jinx.n < n0);
  assert.ok((w.co.jinx.per.y.sSeverance || 0) > 0);
  // well again: the plan put right, the next month's end sets the fee back
  w.co.magita.surcharge = 0;
  w.co.magita.guide.expected.quarters = [-1e12, -1e12, -1e12, -1e12];
  const end = CORP.monthEnd(w.day + 1);
  for (let d = w.day + 1; d <= end; d++) model.closeDay(w, d, {}, ch);
  assert.equal(model.garageFeeOf(w), 100000);
  // development work (技術開発): begun by all, on the month's first day
  for (const p of CORP.companies) assert.ok(w.co[p.id].rnd && w.co[p.id].rnd.n >= 1, p.id);
});

test('more people, likelier success: a development\'s chance grows with the staff', () => {
  const key = Buffer.alloc(32, 8), ch = model.chance(key);
  const tries = (scale) => {
    let ok = 0, all = 0;
    for (let k = 0; k < 6; k++) {
      const { world: w } = model.boot(Buffer.alloc(32, 20 + k), launch, { years: 0 });
      for (const s of Object.values(w.co)) s.n = Math.max(1, Math.round(s.n * scale));
      for (let d = launch; d < launch + 400; d++) {
        for (const s of Object.values(w.co)) s.target = s.n;
        model.closeDay(w, d, {}, ch);
        for (const s of Object.values(w.co)) s.n = Math.max(1, Math.round(model.PROFILES.get(s.id).staff * scale));
      }
      for (const s of Object.values(w.co)) { ok += s.rnd.ok; all += s.rnd.n - (s.rnd.cur ? 1 : 0); }
    }
    return ok / Math.max(1, all);
  };
  assert.ok(tries(2) > tries(0.4));
});

test('a world begun before YOSIDA: it is set in from its own made-up past, and the days go on with it', () => {
  const key = Buffer.alloc(32, 12), ch = model.chance(key);
  const { world: w } = model.boot(key, launch, { years: 0 });
  delete w.co.yosida;
  for (const k of Object.keys(w.ties)) if (k.includes('yosida')) delete w.ties[k];
  const r = model.addCompanies(key, w, { yosida: 12000 });
  assert.deepEqual(r.added, ['yosida']);
  assert.ok(r.history.periods.every((x) => x.company === 'yosida'));
  assert.ok(w.co.yosida && w.ties['carowner|yosida'] !== undefined);
  const from = w.day + 1;
  for (let d = from; d < from + 20; d++) model.closeDay(w, d, {}, ch);
  assert.ok(w.co.yosida.per.y['r:dealer'] > 0);
  assert.equal(model.addCompanies(key, w), null);
});

test('the server: MAGITA Garage takes each garage place\'s fee once a month (even below $0) and tells the player; its 10% of rentals; MAGITA Robert buys cars back', async (t) => {
  let now = START;
  const s = await startServer({ clock: () => now });
  t.after(() => s.stop());
  const a = await s.register('GaragePayer'), b = await s.register('NewThisMonth');
  t.mock.method(Date, 'now', () => now);
  s.setUser(a.me.id, { created_at: MONTH0 - 86400000, dollars: 150000, garage_extra: 1 });
  s.setUser(b.me.id, { created_at: MONTH0 + 3600000 });
  let g = await s.call('GET', '/api/cars', { token: a.token });
  assert.equal(g.status, 200);
  assert.equal(g.garageFee.fee, 100000);
  assert.deepEqual(g.garageFee.bills.map((x) => [x.month, x.slots, x.fee, x.amount]), [['2026-11', 3, 100000, 300000]]);
  const me = s.app.db.prepare('SELECT dollars FROM users WHERE id = ?');
  assert.equal(me.get(a.me.id).dollars, 150000 - 300000);
  // once a month
  await s.call('GET', '/api/cars', { token: a.token });
  assert.equal(me.get(a.me.id).dollars, -150000);
  // an account begun this month pays from the next
  g = await s.call('GET', '/api/cars', { token: b.token });
  assert.equal(g.garageFee.bills.length, 0);
  const bot = s.app.db.prepare("SELECT id FROM users WHERE npc = 'magita'").get();
  assert.ok(bot);
  assert.ok(s.app.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND recipient_id = ?').get(bot.id, a.me.id).n >= 1);
  // the rentals: 10% to MAGITA Garage
  s.setUser(a.me.id, { dollars: 0 });
  const car = Number(s.app.db.prepare(`INSERT INTO cars (owner_id, model, created_at, acquired_at, rent_start, rent_earned) VALUES (?, 'yoshida-s5', ?, ?, ?, 1000000)`)
    .run(a.me.id, now, now, now - 3600000).lastInsertRowid);
  const got = await s.call('POST', '/api/cars/collect', { token: a.token, body: {} });
  assert.deepEqual([got.gross, got.paid, got.fee], [1000000, 900000, 100000]);
  void car;
  // the buy-back: MAGITA Robert's
  const old = Number(s.app.db.prepare(`INSERT INTO cars (owner_id, model, created_at, acquired_at) VALUES (?, 'yoshida-zx4', ?, ?)`).run(a.me.id, now, now).lastInsertRowid);
  g = await s.call('GET', '/api/cars', { token: a.token });
  const price = g.cars.find((c) => c.id === old).buyback.price;
  const sold = await s.call('POST', '/api/cars/sell', { token: a.token, body: { car: old, price } });
  assert.equal(sold.status, 200, JSON.stringify(sold));
  const f = flows(s);
  assert.deepEqual([f.garagefee, f.rentfee, f.buyback], [300000, 100000, price]);
  // the next month: again, at the fee MAGITA set for it
  now = Date.UTC(2026, 11, 1, 1);
  await s.call('GET', '/api/cars', { token: a.token });
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM garage_bills WHERE user_id = ?').get(a.me.id).n, 2);
});
