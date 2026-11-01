// The game's own businesses behind the companies and the country's treasury (国庫): what a spin wins beyond its bet
// and the quests' rewards come out of the treasury; YOSIDA keeps a fee of each reward (10%, up to 21% while it does
// badly or wants more), sells the gacha and bills the country half of it, pays for every prize, ships its money
// tree seeds and sells the fertilizer and the trees; DAIZIN buys ロイヤルコイン back; WAZIMA, MAGITA's own, cuts
// MAGITA's costs and its profit is MAGITA's each month; and what the people spent at each company: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import * as model from '../core/corp-model.js';
import { CORP, RULES, GACHA } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 20, 0, 0);
const launch = Math.floor(START / 86400000);
const P = RULES.tokenPrice;
// the books of a company: assets against liabilities and equity
const books = (s) => {
  let a = 0, le = 0;
  for (const [k, v] of Object.entries(s.bal)) { const kind = CORP.account(k)[1]; if (kind === 'a') a += v; else le += v; }
  return [a, le];
};
const world = (seed = 31) => {
  const key = Buffer.alloc(32, seed), ch = model.chance(key);
  return { ...model.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } }), ch };
};
const yearSum = (s, code) => s.per.y[code] || 0;

test('the rules: WAZIMA as given, all MAGITA\'s; WAZIMA and YOSIDA at home, selling abroad; YOSIDA\'s fees, prizes and seeds; DAIZIN\'s price', () => {
  const z = CORP.company('wazima'), y = CORP.company('yosida');
  assert.deepEqual([z.staff, z.salary, z.cost, z.place.amount, z.rd.amount, z.capital, z.retained, z.parent, !!z.abroad, z.payout, !!z.listed],
    [2250, 2900000, 4300000, 2400000000, 1800000000, 800000000, 22000000000, 'magita', false, 0, false]);
  assert.ok(!y.abroad && y.streams.find((x) => x.id === 'export').abroad && y.streams.find((x) => x.id === 'seeds').abroad && z.streams.find((x) => x.id === 'export').abroad);
  assert.equal(CORP.yosida.seeds.cap, 21000000000);
  assert.deepEqual(CORP.company('magita').children, ['wazima']);
  const Y = CORP.yosida;
  assert.deepEqual([Y.quest.base, Y.quest.max, Y.gacha.claim, Y.gacha.royal, Y.gacha.garage, Y.gacha.vipWeek, Y.tree, Y.seeds.month, Y.seeds.price, Y.seeds.cost, Y.fertilizer],
    [0.1, 0.21, 0.5, 100000, 1400000, [1200000, 3500000], 1000000, [5000, 10000], [10000000, 12000000], 1000000, 0.4]);
  assert.deepEqual([CORP.questFee(7000), CORP.questFee(7005), CORP.questFee(7000, 0.21)], [700, 700, 1470]);
  assert.deepEqual(RULES.vip.buyback, { each: 50000, max: 100000 });
  // every car the gacha gives has a price for YOSIDA to pay its maker
  for (const c of GACHA.cars) assert.ok(CORP.products.cars[c.id] || RULES.cars.some((x) => x.id === c.id) || CORP.yosida.gacha.worth[c.id], c.id);
});

test('the game\'s money as a day closes: the treasury\'s bill, YOSIDA\'s sale, claim and prizes, DAIZIN\'s buying back; the books balance', () => {
  const { world: w, ch } = world();
  const before = {
    ys: { cash: w.co.yosida.bal.cash, retained: w.co.yosida.bal.retained },
    dz: w.co.daizin.per.y['r:coins'] || 0, mg: { garage: w.co.magita.per.y['r:garage'] || 0, gacha: w.co.magita.per.y['r:gacha'] || 0 }
  };
  const d = launch;
  const flows = {
    '@state': { slots: 5000000, quests: 1000000, gacha: 15000000 },
    yosida: { gacha: 30000000, questfee: 100000, fertilizer: 40000, trees: { seed: [1, 10500000] } },
    '@prize': { lot: 20000, royal: 10, garage: 2, vip: 1, tree: 1, cars: { onvoro: 1, 'porsche-kuia-spyder': 1 } },
    '@coins': { n: 4, paid: 200000 }
  };
  model.closeDay(w, d, flows, ch);
  for (const s of Object.values(w.co)) { const [a, le] = books(s); assert.equal(a, le, s.id); }
  const ys = w.co.yosida, dz = w.co.daizin, mg = w.co.magita;
  // YOSIDA: the players' gacha money, its claim on the treasury, its fees, the fertilizer and the auction's tree
  assert.deepEqual([yearSum(ys, 'r:gacha'), yearSum(ys, 'r:claim'), yearSum(ys, 'r:quest'), yearSum(ys, 'r:tree')], [30000000, 15000000, 100000, 40000 + 10500000]);
  // the prizes: coins and the VIP ticket bought of DAIZIN, the garage coins and cars of MAGITA, its own tree at cost
  const [, onvoro] = [0, CORP.products.cars.onvoro.buy + CORP.products.cars.onvoro.excl];
  const gt = Math.round(CORP.yosida.gacha.worth['porsche-kuia-spyder'] * CORP.yosida.gacha.carShare);
  const vip = model.vipWeekOf(w);
  assert.equal(yearSum(ys, 'c:gacha'), 10 * 100000 + vip + 2 * 1400000 + onvoro + gt + 1000000);
  assert.equal(yearSum(ys, 'c:tree'), 1000000);
  assert.equal((dz.per.y['r:coins'] || 0) - before.dz, 10 * 100000 + vip);
  assert.equal((mg.per.y['r:garage'] || 0) - before.mg.garage, 2 * 1400000);
  assert.equal((mg.per.y['r:gacha'] || 0) - before.mg.gacha, onvoro + gt);
  // the lot coins: tokens at their $, straight out of its retained earnings, not a cost of the day
  assert.equal(ys.biz[CORP.monthKey(d)].lot, 20000 * P);
  // DAIZIN's buying back: its own money
  assert.equal(yearSum(dz, 'c:coinbuy'), 200000);
  assert.deepEqual([dz.biz[CORP.monthKey(d)].coins, dz.biz[CORP.monthKey(d)].coinPaid], [4, 200000]);
  // the treasury's ledger
  assert.deepEqual(w.gov.all, { slots: 5000000, quests: 1000000, gacha: 15000000, questfee: 100000 });
  // (a day with nothing of the game's: nothing more in the ledger)
  model.closeDay(w, d + 1, {}, ch);
  assert.deepEqual(w.gov.all, { slots: 5000000, quests: 1000000, gacha: 15000000, questfee: 100000 });
  void before;
});

test('YOSIDA ships 5,000〜10,000 seeds a month at $10M〜$12M, sets its quest fee (10%, up to 21% when it does badly) and the VIP ticket\'s price with DAIZIN', () => {
  const { world: w, ch } = world(32);
  let d = launch;
  const monthEnd = CORP.monthEnd(d);
  for (; d <= monthEnd; d++) model.closeDay(w, d, {}, ch);
  const ys = w.co.yosida;
  // (it would ship 5,000〜10,000, but no more than $21B a year at its size and technology: some 150 a month)
  assert.ok(ys.seeds.want >= 5000 && ys.seeds.want <= 10000 && ys.seeds.price >= 10000000 && ys.seeds.price <= 12000000);
  assert.equal(ys.seeds.cap, model.seedsCap(ys));
  assert.ok(ys.seeds.cap >= 21e9 * 0.9 && ys.seeds.n === Math.min(ys.seeds.want, Math.floor(ys.seeds.cap / 12 / ys.seeds.price)), JSON.stringify(ys.seeds));
  assert.ok(Math.abs(ys.seeds.sold - ys.seeds.n * (monthEnd - launch + 1) / 30) <= Math.max(2, ys.seeds.n * 0.05), `${ys.seeds.sold} of ${ys.seeds.n}`);
  // more people and better technology: more of them
  const at = { n: ys.n, rnd: ys.rnd };
  ys.n = model.PROFILES.get('yosida').staff * 2;
  ys.rnd = { ...(ys.rnd || {}), edge: 1.2 };
  assert.equal(model.seedsCap(ys), Math.round(21e9 * 2 * 1.2));
  Object.assign(ys, at);
  const v = model.vipWeekOf(w);
  assert.ok(v >= 1200000 && v <= 3500000 && v % 10000 === 0);
  assert.ok(model.questFeeOf(w) >= 0.1 && model.questFeeOf(w) <= 0.21);
  // a quarter far short of its plan: the fee goes up (the worse, the higher), at most 21%
  ys.guide.expected.quarters = ys.guide.expected.quarters.map((x) => Math.abs(x) * 100 + 1e12);
  const next = CORP.monthEnd(d);
  for (; d <= next; d++) model.closeDay(w, d, {}, ch);
  const high = model.questFeeOf(w);
  assert.ok(high > 0.1 && high <= 0.21, String(high));
  // well again: back to 10% (or, wanting more, a few months at 11%〜15%)
  ys.guide.expected.quarters = ys.guide.expected.quarters.map(() => 1);
  const after = CORP.monthEnd(d);
  for (; d <= after; d++) model.closeDay(w, d, {}, ch);
  const fee = model.questFeeOf(w);
  assert.ok(fee === 0.1 || (fee >= 0.11 && fee <= 0.15), String(fee));
});

test('WAZIMA: MAGITA\'s share of research its sale, its own research cutting MAGITA\'s costs, its sales on MAGITA\'s books and its profit MAGITA\'s each month', () => {
  const { world: w, ch } = world(33);
  const z = w.co.wazima, m = w.co.magita, start = z.bal.retained;
  let paid = 0, sub = 0, kept = null;
  for (let d = launch; d < launch + 400; d++) {
    const out = model.closeDay(w, d, {}, ch);
    for (const s of Object.values(w.co)) { const [a, le] = books(s); assert.equal(a, le, `${s.id} on ${d}`); }
    if (CORP.isMonthEnd(d)) {
      // its retained earnings stay where they were from one month's end to the next: each month's profit went to
      // MAGITA (the first month's had a few made-up days before the launch in it too)
      if (kept === null) { kept = z.bal.retained; assert.ok(Math.abs(kept - start) < 5e7); }
      else assert.equal(z.bal.retained, kept, `on ${d}`);
      paid += z.toParent ? z.toParent.net : 0;
    }
    // (MAGITA's part of WAZIMA's month: its sales less its costs, day by day, and the rest of its profit at the end)
    for (const r of out.periods) if (r.company === 'magita' && r.kind === 'm') sub += (r.accounts['r:wazima'] || 0) - (r.accounts['c:wazima'] || 0) + (r.accounts.nSubsidiary || 0) - (r.accounts.eSubsidiary || 0);
  }
  assert.ok(paid > 1e9, String(paid));
  assert.equal(sub, paid);
  // WAZIMA's sales to others are MAGITA's (what MAGITA paid it for the joint development left out); nothing owed between
  // them at a month's end
  assert.ok(m.per.y['r:wazima'] > 0 && Math.abs(m.per.y['r:wazima'] - ((z.per.y['r:export'] || 0))) < 1e6, `${m.per.y['r:wazima']} ${z.per.y['r:export']}`);
  // the joint development: a share of MAGITA's research is WAZIMA's sale
  assert.ok((z.per.y['r:codev'] || 0) > 0);
  // its research done: MAGITA's costs besides materials lower, never below the floor
  assert.ok(z.wlab.list.filter((r) => r.done && r.ok).length >= 2);
  assert.ok(m.save.place < 1 && m.save.place >= CORP.wazima.next.floor);
  assert.ok(Object.values(m.save).every((x) => x >= CORP.wazima.next.floor && x <= 1));
  // (and MAGITA's research is its own: the A1 and the rest)
  assert.ok(m.lab && m.lab.mult < 1);
});

test('a world begun before WAZIMA: it is set in from its own made-up past and works for MAGITA from then on', () => {
  const key = Buffer.alloc(32, 34), ch = model.chance(key);
  const { world: w } = model.boot(key, launch, { years: 0 });
  delete w.co.wazima;
  for (const k of Object.keys(w.ties)) if (k.includes('wazima')) delete w.ties[k];
  const r = model.addCompanies(key, w, {});
  assert.deepEqual(r.added, ['wazima']);
  assert.ok(w.co.wazima && w.ties['magita|wazima'] !== undefined);
  const from = w.day + 1;
  for (let d = from; d < from + 45; d++) model.closeDay(w, d, {}, ch);
  assert.ok(w.co.wazima.per.y['r:export'] > 0 && w.co.wazima.wlab);
  assert.ok(w.co.wazima.toParent && w.co.magita.per.y.nSubsidiary > 0);
});

test('the people\'s money at each company is in its day\'s row', () => {
  const { world: w, ch } = world(35);
  w.circ = { from: launch, games: {} };
  w.co.tenesice.ext = { lent: 0, deposits: 0 };
  const npc = { co: { jinx: { s: { goods: 1000 }, p: { items: { omamori: [2, 160000] } }, t: {}, l: {}, cat: 0 }, dtrade: { s: {}, p: {}, t: {}, l: {}, cat: 0, cas: 50000 } },
    bank: { nii: 0, fees: 300, credit: 0, deposits: 1e9, loans: 0 }, staff: {}, charges: [] };
  const out = model.closeDay(w, launch, { npc }, ch);
  const row = (id) => out.days.find((r) => r.company === id);
  assert.deepEqual([row('jinx').npc, row('dtrade').npc, row('tenesice').npc, row('magita').npc], [161000, 50000, 300, 0]);
});

test('the server: a spin\'s win beyond its bet is the treasury\'s, a reward pays YOSIDA its fee, the gacha its sale and claim, the fertilizer its 40%; DAIZIN buys coins back', async (t) => {
  let now = START;
  const s = await startServer({ clock: () => now, corpHistory: 0 });
  t.after(() => s.stop());
  const a = await s.register('Treasury');
  const rows = () => s.app.db.prepare('SELECT data FROM corp_flows').all().map((r) => JSON.parse(r.data));
  const sum = (id, k) => rows().reduce((n, d) => n + (((d[id] || {})[k]) || 0), 0);
  // the slots: what the bets lost is Dtrade's, what a win paid beyond its bet the treasury's
  s.setUser(a.me.id, { tokens: 10000000 });
  let lost = 0, won = 0, tokens = 10000000;
  for (let i = 0; i < 60; i++) {
    const r = await s.call('POST', '/api/spin', { token: a.token, body: { bet: 1000 } });
    assert.equal(r.status, 200);
    const total = r.result.total || 0, back = r.result.charm ? r.result.charm.back : 0, fee = r.result.fee || 0;
    tokens += total + back - fee - 1000;
    lost += Math.max(0, 1000 - total - back) * P;
    won += Math.max(0, total + back - 1000) * P;
  }
  assert.ok(won > 0 && lost > 0);
  s.app.api.corp.flush();
  assert.deepEqual([sum('dtrade', 'casino'), sum('@state', 'slots')], [lost, won]);
  // DAIZIN's buying back: $50,000 a coin, out of its own money (never more than one has)
  s.setUser(a.me.id, { coins: 30, dollars: 0 });
  assert.equal((await s.call('POST', '/api/coins/sell', { token: a.token, body: { amount: 31 } })).error.code, 'insufficient');
  assert.equal((await s.call('POST', '/api/coins/sell', { token: a.token, body: { amount: 0 } })).status, 400);
  const sold = await s.call('POST', '/api/coins/sell', { token: a.token, body: { amount: 12 } });
  assert.deepEqual([sold.sold, sold.paid, sold.me.coins, sold.me.dollars], [12, 600000, 18, 600000]);
  assert.deepEqual(rows().find((d) => d['@coins'])['@coins'], { n: 12, paid: 600000 });
  // the gacha: its price YOSIDA's sale, half of it claimed of the treasury, the prizes counted
  s.setUser(a.me.id, { dollars: 100000000, tokens: 0, coins: 0 });
  const g = await s.call('POST', '/api/gacha/spin', { token: a.token, body: { kind: 'rare', count: 1 } });
  assert.equal(g.status, 200, JSON.stringify(g));
  assert.equal(sum('yosida', 'gacha'), g.paid);
  assert.equal(sum('@state', 'gacha'), Math.floor(g.paid * 0.5));
  const prize = rows().find((d) => d['@prize'])['@prize'], rewards = g.pulls.flatMap((p) => p.rewards);
  const count = (type) => rewards.filter((r) => r.type === type).reduce((n, r) => n + (r.amount || 1), 0);
  assert.equal(prize.lot || 0, count('lot'));
  assert.equal(prize.royal || 0, count('royal') + g.pulls.reduce((n, p) => n + (p.bonus || 0), 0));
  assert.equal(prize.garage || 0, count('garage'));
  // the money trees: YOSIDA's fertilizer, 40% of what is given
  const tree = (await s.call('GET', '/api/tree', { token: a.token })).trees[0].id;
  assert.equal((await s.call('POST', '/api/tree/give', { token: a.token, body: { tree, amount: 100000 } })).status, 200);
  assert.equal(sum('yosida', 'fertilizer'), 40000);
  // the operator site's 企業 shows WAZIMA, YOSIDA's fee and the treasury
  const q = await s.call('GET', '/api/quests', { token: a.token });
  assert.equal(q.feeRate, 0.1);
});

test('the operator site: a company\'s day so far — the day\'s plan, and the players\' money of today as it comes, operators only', async (t) => {
  let now = START;
  const s = await startServer({ clock: () => now, operators: ['boss'], corpHistory: 0 });
  t.after(() => s.stop());
  const boss = await s.register('boss'), p = await s.register('Spender');
  assert.equal((await s.call('GET', '/api/ops/corp/today?c=dtrade', { token: p.token })).status, 403);
  assert.equal((await s.call('GET', '/api/ops/corp/today?c=nope', { token: boss.token })).error.code, 'bad_company');
  await s.call('GET', '/api/ops/corp', { token: boss.token });
  let r = await s.call('GET', '/api/ops/corp/today?c=dtrade', { token: boss.token });
  assert.equal(r.today.day, Math.floor(START / 86400000));
  assert.equal(r.today.start, r.today.day * 86400000);
  assert.ok(r.today.plan.sales > 0 && r.today.plan.op > 0, JSON.stringify(r.today.plan));
  assert.equal(r.today.players, 0);
  // the players' money of today, as it comes: the exchange fee at once, the spins' lost bets from memory
  s.setUser(p.me.id, { tokens: 1000000, dollars: 0 });
  await s.call('POST', '/api/sell', { token: p.token, body: { amount: 10000 } });
  let lost = 0;
  for (let i = 0; i < 10; i++) {
    const x = await s.call('POST', '/api/spin', { token: p.token, body: { bet: 1000 } });
    lost += Math.max(0, 1000 - (x.result.total || 0) - (x.result.charm ? x.result.charm.back : 0)) * P;
  }
  now += 60000;
  r = await s.call('GET', '/api/ops/corp/today?c=dtrade', { token: boss.token });
  assert.ok(r.today.players >= RULES.casino.exchangeFee + lost, `${r.today.players}`);
  assert.equal(r.now, now);
});
