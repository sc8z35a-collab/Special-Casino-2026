// 企業: the companies' books, their days, the players' money reaching them, their shares, their taxes, their ties
// and the operator site's apps: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.js';
import { openDb } from '../node/sqlite.js';
import { statements } from '../core/db.js';
import { createTransactions } from '../core/transactions.js';
import { createCorp } from '../core/corp.js';
import * as model from '../core/corp-model.js';
import { yearTax, flatTax } from '../core/corp-tax.js';
import { CORP, RULES, carPrice } from '../core/rules.js';

const DAY = 86400;
const START = Date.UTC(2026, 10, 2, 20, 0, 0);
const launch = Math.floor(START / 86400000);
const books = (s) => [model.assetsOf(s), model.liabilitiesOf(s) + model.equityOf(s)];

test('the made-up past ends on every profile\'s own numbers, and its books balance and add up', () => {
  const { world: w, history: h } = model.boot(Buffer.alloc(32, 5), launch, { years: 1, prices: { riru: 12000, ice: 30000 } });
  assert.equal(w.day, launch - 1);
  for (const p of CORP.companies) {
    const s = w.co[p.id];
    assert.deepEqual([s.bal.retained, s.bal.capital, s.bal.reserve, s.n, s.pay, s.unit], [p.retained, p.capital, p.reserve, p.staff, p.salary, p.cost], p.id);
    const [a, le] = books(s);
    assert.equal(a, le, `${p.id}: assets and liabilities with equity`);
    assert.ok(s.sh.issued > 0 && s.sh.treasury === 0);
    assert.ok(s.guide && s.guide.fy === CORP.fyOf(launch));
  }
  // the listed ones are priced by their books at the market's price, the backer holds its part of its studio
  for (const id of ['riru', 'ice']) {
    const s = w.co[id], v = model.fairValue(s, model.PROFILES.get(id), w) / s.sh.issued;
    assert.ok(Math.abs(v / (id === 'riru' ? 12000 : 30000) - 1) < 0.001, `${id}: ${v}`);
  }
  assert.equal(w.co.ice.hold.own.riru, Math.round(w.co.riru.sh.issued * 0.2));
  // every period: the P/L's totals from its lines, the cash flows to the cash it ended with
  for (const r of h.periods) {
    const pl = r.pl;
    assert.equal(pl.gross, pl.sales - pl.cogs, r.key);
    assert.equal(pl.op, pl.gross - pl.sga, r.key);
    assert.equal(pl.net, pl.op + pl.noi - pl.noe + pl.xi - pl.xl - pl.tax, r.key);
    const moved = Object.values(r.cf).reduce((a, b) => a + b, 0);
    assert.equal(r.cash0 + moved, r.cash, `${r.company} ${r.key}: cash flows`);
  }
  // the quarters carry their 決算発表 two weeks on, at 15:00 Japan time
  const q = h.periods.find((r) => r.kind === 'q');
  assert.equal(q.announce, (q.to + 14) * DAY + 6 * 3600);
  // taxes over a year at the rates of Japan (a share of the pre-tax income near the 30-odd % they come to)
  const y = h.periods.find((r) => r.kind === 'y' && r.company === 'tenesice');
  if (y) assert.ok(y.pl.tax / y.pl.pretax > 0.25 && y.pl.tax / y.pl.pretax < 0.4, `${y.pl.tax / y.pl.pretax}`);
});

test('the companies run on: every day balances, and their sales and profits stay in reason for a year', () => {
  const key = Buffer.alloc(32, 9), ch = model.chance(key);
  const { world: w } = model.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const years = [];
  for (let d = launch; d < launch + 400; d++) {
    const out = model.closeDay(w, d, {}, ch);
    for (const s of Object.values(w.co)) { const [a, le] = books(s); assert.equal(a, le, `${s.id} on ${d}`); }
    years.push(...out.periods.filter((r) => r.kind === 'y'));
    // a listed company's next day: its centre moves at most 1.5% a day
    for (const a of out.anchors) assert.ok(Math.abs(a.e1 - a.e0) <= 0.015 + 1e-12);
  }
  for (const r of years) {
    const p = model.PROFILES.get(r.company);
    // (YOSIDA's money tree seeds come on top of the carmaker its profile is, from the launch, up to $21B a year at its
    // size and technology: CORP.yosida.seeds; MAGITA's books carry WAZIMA's sales too)
    const seeds = r.accounts['r:seeds'] || 0, child = r.accounts['r:wazima'] || 0, months = Math.max(1, Math.round((r.to - Math.max(r.from, launch) + 1) / 30.44));
    if (seeds) assert.ok(seeds > 0 && seeds < CORP.yosida.seeds.cap * 1.4 * (months + 1) / 12, `${r.company} seeds ${seeds} in ${months} months`);
    else assert.ok(r.company !== 'yosida' || r.to < launch);
    if (p.sales) assert.ok(r.pl.sales - seeds - child > p.sales * 0.6 && r.pl.sales - seeds - child < p.sales * 1.6, `${r.company} ${r.pl.sales}`);
    assert.ok(r.staff > 0);
  }
});

test('the taxes: a 中小法人\'s lower rate, a 大法人\'s 外形標準課税, losses carried and set against later income', () => {
  assert.deepEqual([flatTax(100000000, 450), flatTax(90000000, 30), flatTax(100e9, 12000)], [200000, 180000, 3800000]);
  const small = yearTax({ fy: 2026, income: 1000000000, capital: 50000000, capitalEtc: 100000000, staff: 450 });
  assert.equal(small.small, true);
  assert.equal(small.corporate, Math.floor(8000000 * 0.15 + 992000000 * 0.232));
  assert.equal(small.local, Math.floor(small.corporate * 0.103));
  assert.equal(small.business, 70000000);
  const large = yearTax({ fy: 2026, income: 1000000000, capital: 2000000000, capitalEtc: 4000000000, staff: 6000, value: 3000000000 });
  assert.equal(large.small, false);
  assert.equal(large.corporate, 232000000);
  assert.equal(large.sizeTax, Math.floor(3000000000 * 0.012) + Math.floor(4000000000 * 0.005));
  const loss = yearTax({ fy: 2026, income: -300000000, capital: 50000000, capitalEtc: 100000000, staff: 450 });
  assert.equal(loss.total, 200000);
  assert.deepEqual(loss.carry, [[2026, 300000000]]);
  const next = yearTax({ fy: 2027, income: 500000000, capital: 50000000, capitalEtc: 100000000, staff: 450, carry: loss.carry });
  assert.deepEqual([next.taxable, next.carry], [200000000, []]);
  // (a 大法人 sets losses against half its income only; a year's 事業税 paid comes off the next year's)
  const big = yearTax({ fy: 2027, income: 500000000, capital: 2000000000, capitalEtc: 4000000000, staff: 6000, carry: [[2026, 400000000]], paidBusiness: 100000000 });
  assert.deepEqual([big.base, big.used, big.taxable, big.carry], [400000000, 200000000, 200000000, [[2026, 200000000]]]);
});

// a company engine of its own on a database of its own (`secret` the same for two of them)
function engine(t, secret) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corp-test-'));
  const db = openDb(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const { run: tx, afterCommit } = createTransactions(db);
  let now = START;
  const corp = createCorp({ q: statements(db), tx, afterCommit, secret, history: 0, clock: () => now });
  const to = (ms) => {
    now = ms;
    tx(() => {
      corp.ensure(Math.floor(START / 1000));
      while (corp.closesAt() <= Math.floor(now / 1000)) corp.close();
    });
  };
  return { db, corp, to, tx };
}

test('a company system worked out day by day or after weeks asleep comes to the same world', (t) => {
  const a = engine(t, 'same-secret'), b = engine(t, 'same-secret');
  for (let d = 1; d <= 40; d++) a.to(START + d * 86400000);
  b.to(START + 40 * 86400000);
  const state = (e) => e.db.prepare('SELECT id, data FROM corp_state ORDER BY id').all();
  assert.deepEqual(state(a), state(b));
  const anchors = (e) => e.db.prepare('SELECT * FROM corp_anchor ORDER BY company, day').all();
  assert.deepEqual(anchors(a), anchors(b));
  assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM corp_days').get().n, b.db.prepare('SELECT COUNT(*) AS n FROM corp_days').get().n);
});

test('the players\' money: a car is Car Owner\'s sale at what was paid and MAGITA\'s at its 仕入れ価格 and 専売特別費用; the Shop is ジンクス\'s; VIP DAIZIN\'s; the バイト the job sites\'; the fee Dtrade\'s', (t) => {
  const e = engine(t, 'money');
  e.to(START);
  const gtr = CORP.products.cars['nissan-gt-r'], v3 = CORP.products.items['engine-v3'];
  e.tx(() => {
    e.corp.sold('carowner', 'car', 'nissan-gt-r', 1, 34000000);
    e.corp.sold('jinx', 'shop', 'engine-v3', 2, 16400000);
    e.corp.sold('jinx', 'shop', 'omamori', 3, 240000);
    e.corp.flow('carowner', 'garage', 1000000);
    e.corp.flow('daizin', 'vip', 4 * CORP.players.coin);
    e.corp.flow('*', 'job', 1000000);
  });
  const w0 = JSON.parse(JSON.stringify(e.corp.world()));
  // the same day closed without them, for what the rest of the day brought
  const ch = model.chance(Buffer.from('x'));
  void ch;
  e.to(START + 86400000);
  const w = e.corp.world();
  const dealer = w.co.carowner.sold['nissan-gt-r'], maker = w.co.magita.sold['nissan-gt-r'];
  assert.equal(dealer.players, 1);
  assert.ok(maker.npc >= dealer.players + dealer.npc - 0);
  assert.equal(w.co.jinx.sold['engine-v3'].players, 2);
  assert.equal(w.co.jinx.sold.omamori.players, 3);
  // (the dealer keeps the price less what MAGITA took: 34M − 30M − 2M on this car, before selling it)
  assert.equal(gtr.buy + gtr.excl + 2000000, 34000000);
  assert.equal(dealer.margin, dealer.sales - (dealer.npc + dealer.players) * (gtr.buy + gtr.excl));
  assert.equal(v3.buy + v3.excl + 300000, 8200000);
  // the flows were the day's own
  const row = JSON.parse(e.db.prepare('SELECT data FROM corp_flows').get().data);
  assert.deepEqual(row.carowner, { car: { 'nissan-gt-r': [1, 34000000] }, garage: 1000000 });
  assert.equal(row.daizin.vip, 400000);
  assert.equal(row.job, 1000000);
  assert.ok(w0.co.carowner && w.day === w0.day + 1);
});

test('a listed company\'s shares: a buy is new shares (half 資本金, half 資本準備金), a sale is bought back, and its treasury shares go out first', (t) => {
  const e = engine(t, 'shares');
  e.to(START);
  const s0 = JSON.parse(JSON.stringify(e.corp.world().co.riru));
  const sec = Math.floor(START / 1000) + 10;
  e.tx(() => e.corp.traded('riru', 'buy', 500, 12001, 36003, sec));
  let s = e.corp.world().co.riru;
  assert.equal(s.sh.issued, s0.sh.issued + 500);
  assert.equal(s.bal.capital + s.bal.reserve, s0.bal.capital + s0.bal.reserve + 500 * 12001);
  assert.equal(s.bal.capital - s0.bal.capital, Math.ceil(500 * 12001 / 2));
  assert.equal(s.bal.cash, s0.bal.cash + 500 * 12001);
  e.tx(() => e.corp.traded('riru', 'sell', 200, 12500, 15000, sec + 5));
  s = e.corp.world().co.riru;
  assert.deepEqual([s.sh.treasury, s.bal.treasury], [200, -2500000]);
  e.tx(() => e.corp.traded('riru', 'buy', 150, 12600, 11340, sec + 9));
  s = e.corp.world().co.riru;
  assert.deepEqual([s.sh.issued, s.sh.treasury], [s0.sh.issued + 500, 50]);
  // (sold for more than they cost: the difference is その他資本剰余金)
  assert.equal(s.bal.othercap, 150 * (12600 - 12500));
  const [a, le] = books(s);
  assert.equal(a, le);
  // the fees are Dtrade's
  assert.equal(JSON.parse(e.db.prepare('SELECT data FROM corp_flows').get().data).dtrade.trade, 36003 + 15000 + 11340);
});

test('business ties: MAGITA gets on badly with the dealer it squeezes; one that gets on well is paid a rebate at the quarter\'s end', () => {
  const key = Buffer.alloc(32, 4), ch = model.chance(key);
  const { world: w } = model.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  // (they start where the rules put them and have moved a little in the made-up month before the launch)
  const start = (a, b) => model.ties().find((t) => t.key === [a, b].sort().join('|')).start;
  assert.deepEqual([start('magita', 'carowner'), start('ice', 'riru')], [35, 90]);
  assert.equal(model.tieOf(w, 'magita', 'carowner'), model.tieOf(w, 'carowner', 'magita'));
  assert.ok(Math.abs(model.tieOf(w, 'magita', 'carowner') - 35) < 10 && model.tieOf(w, 'ice', 'riru') > 75);
  assert.equal(model.ties().filter((t) => t.a === 'tenesice').length, CORP.companies.length - 1);
  w.ties[['jinx', 'magita'].sort().join('|')] = 100;
  let rebate = null;
  for (let d = launch; d < launch + 120 && !rebate; d++) {
    const out = model.closeDay(w, d, {}, ch);
    rebate = out.news.find((n) => n.kind === 'rebate');
  }
  assert.ok(rebate && rebate.data.to === 'jinx' && rebate.data.n > 0, 'a rebate within the quarter');
});

test('the operator site: the 企業 folder\'s apps answer operators only, with every company, its products and its ties; the same again is { same: true }', async (t) => {
  let now = START;
  const s = await startServer({ clock: () => now, operators: ['boss'], corpHistory: 0 });
  t.after(() => s.stop());
  const boss = await s.register('boss'), player = await s.register('player');
  assert.equal((await s.call('GET', '/api/ops/corp', { token: player.token })).status, 403);
  // (an operator's look begins them, as a look at the market would)
  const all = await s.call('GET', '/api/ops/corp', { token: boss.token });
  assert.equal(all.started, true);
  assert.equal(all.companies.length, 13);
  assert.ok(all.ties.length >= 17);
  assert.deepEqual(all.companies.map((c) => c.id).sort(), CORP.companies.map((c) => c.id).sort());
  assert.equal((await s.call('GET', `/api/ops/corp?rev=${all.rev}`, { token: boss.token })).same, true);
  const dealer = await s.call('GET', '/api/ops/corp/company?c=carowner', { token: boss.token });
  const one = dealer.products.find((x) => x.id === 'mercedes-amg-one-white');
  assert.deepEqual([one.price, one.cost, one.buy, one.excl, one.sellerNet, one.selling], [300000000, 120000000, 280000000, 10000000, 10000000, 150000]);
  assert.equal(dealer.products.find((x) => x.id === 'two-state-sedan').ended, true);
  const maker = await s.call('GET', '/api/ops/corp/company?c=magita', { token: boss.token });
  assert.ok(maker.products.some((x) => x.id === 'engine-v3' && x.makerNet === 7900000 - 800000));
  const studio = await s.call('GET', '/api/ops/corp/company?c=riru', { token: boss.token });
  assert.ok(studio.projects.length >= 3 && studio.quarters.length >= 1);
  assert.equal((await s.call('GET', '/api/ops/corp/company?c=nope', { token: boss.token })).error.code, 'bad_company');
  assert.ok(RULES.cars.every((c) => !CORP.products.cars[c.id] || CORP.products.cars[c.id].buy + CORP.products.cars[c.id].excl <= c.price + 10000000));
});

test('MAGITA\'s research: A1 in a year, T1 in nine months (by its chance), RIMU TAG in two years shortening MOL1; each cut taken on what it makes', () => {
  const key = Buffer.alloc(32, 2), ch = model.chance(key);
  const { world: w } = model.boot(key, launch, { years: 0 });
  const due = {};
  let mult = 1;
  for (let d = launch; d < launch + 4 * 365; d++) {
    const out = model.closeDay(w, d, {}, ch);
    for (const n of out.news) if (n.kind === 'lab') due[n.data.id] = { d, ok: n.data.ok };
    if (d === launch) assert.equal(w.co.magita.lab.list.length, 4);
  }
  const months = (n) => Math.round(n * 365 / 12);
  assert.equal(due.A1.d, launch + months(12));
  assert.equal(due.T1.d, launch + months(9));
  assert.equal(due.RIMU.d, launch + months(24));
  // (MOL1's 42 months: what was left of it at RIMU TAG's end, 35% shorter)
  assert.equal(due.MOL1.d, due.RIMU.d + Math.ceil((launch + months(42) - due.RIMU.d) * 0.65));
  for (const r of CORP.magita.research) if (r.cut && due[r.id].ok) mult *= 1 - r.cut;
  assert.ok(Math.abs(w.co.magita.lab.mult - mult) < 1e-12);
  assert.ok(due.A1.ok && due.MOL1.ok && due.RIMU.ok);
});

test('MAGITA struggling: $3M more on every car but the オンヴォーロ, on its 仕入れ価格 and Car Owner\'s price to the players', async (t) => {
  const s = await startServer({ operators: ['boss'], corpHistory: 0 });
  t.after(() => s.stop());
  const p = await s.register('buyer');
  await s.call('GET', '/api/stocks', { token: p.token });
  let cars = await s.call('GET', '/api/cars', { token: p.token });
  assert.deepEqual(cars.surcharge, {});
  s.app.api.corp.world().co.magita.surcharge = 1;
  cars = await s.call('GET', '/api/cars', { token: p.token });
  assert.equal(cars.surcharge['nissan-gt-r'], CORP.magita.surcharge.amount);
  assert.equal(cars.surcharge.onvoro, undefined);
  s.setUser(p.me.id, { dollars: 100000000 });
  const gtr = RULES.cars.find((c) => c.id === 'nissan-gt-r');
  const sale = cars.sale && cars.sale.pct && cars.sale.pct[gtr.id] ? cars.sale : null;
  const price = carPrice(gtr, sale, 0, CORP.magita.surcharge.amount).price;
  const r = await s.call('POST', '/api/cars/buy', { token: p.token, body: { model: 'nissan-gt-r' } });
  assert.equal(r.paid, price);
  const boss = await s.register('boss');
  const site = await s.call('GET', '/api/ops/corp/company?c=carowner', { token: boss.token });
  const row = site.products.find((x) => x.id === 'nissan-gt-r');
  assert.deepEqual([row.surcharge, row.buy, row.price], [3000000, 33000000, 37000000]);
});

test('the year made up before the first is never paid as if booked; a world that paid it has it put right once, off its retained earnings', () => {
  const key = Buffer.alloc(32, 7), launch = Math.floor(Date.UTC(2026, 10, 2) / 86400000);
  const { world: w } = model.boot(key, launch, { years: 0, prices: {} });
  // (its first May passed: what it owes is this year's booked tax, nothing of the made-up year's)
  for (const s of Object.values(w.co)) assert.equal(s.bal.taxdue || 0, model.taxOwed(s, w.day), s.id);
  // as a world kept before: the made-up year's tax paid in May, below nothing since
  const s = w.co.magita, paid = s.tax.last.total, cash = s.bal.cash, retained = s.bal.retained;
  s.bal.taxdue -= paid; s.bal.cash -= paid;
  const fixed = model.repairTaxes(w);
  assert.deepEqual(fixed, [{ id: 'magita', n: paid }]);
  assert.equal(s.bal.taxdue, model.taxOwed(s, w.day));
  assert.equal(s.bal.retained, retained - paid);
  assert.equal(s.bal.cash, cash - paid);
  assert.equal(model.assetsOf(s), model.liabilitiesOf(s) + model.equityOf(s));
  assert.equal(w.fixes.tax, true);
  assert.deepEqual(model.repairTaxes(w), []);
});

test('ICE carries its RIRU stake from the first day (持分法), never below nothing; a world kept before has it carried once', () => {
  const key = Buffer.alloc(32, 7), launch = Math.floor(Date.UTC(2026, 10, 2) / 86400000), ch = model.chance(key);
  const { world: w } = model.boot(key, launch, { years: 0, prices: {} });
  const ice = w.co.ice, riru = w.co.riru, shares = ice.hold.own.riru;
  const part = (t) => Math.round(model.equityOf(t) * shares / model.outstanding(t));
  assert.ok(Math.abs(ice.bal.affil - part(riru)) <= 1);
  assert.deepEqual(w.fixes, { tax: true, affil: true });
  // carried at nothing: the studio's dividends are 受取配当金 then, the investment never below nothing
  ice.bal.retained -= ice.bal.affil; ice.bal.affil = 0;
  for (let d = launch; d < launch + 40; d++) { model.closeDay(w, d, {}, ch); assert.ok((ice.bal.affil || 0) >= 0, `day ${d}: ${ice.bal.affil}`); }
  assert.ok((ice.per.y.nDividend || 0) > 0);
  // as a world kept before: nothing carried
  ice.bal.retained -= ice.bal.affil || 0; ice.bal.affil = 0; delete w.fixes.affil;
  const before = ice.bal.retained, fixed = model.repairStakes(w);
  assert.equal(fixed.length, 1);
  assert.equal(ice.bal.affil, part(riru));
  assert.equal(ice.bal.retained, before + part(riru));
  assert.equal(model.assetsOf(ice), model.liabilitiesOf(ice) + model.equityOf(ice));
  assert.deepEqual(model.repairStakes(w), []);
});
