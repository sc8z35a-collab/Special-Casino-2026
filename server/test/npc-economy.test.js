// NPCの国's economy, checked where it went wrong before: borrowing what is short (never more), a life ending with
// nothing (the debt the bank's loss, the home passed on, the friendships and the market orders gone), the gains tax
// on a whole holding sold, raises reaching the people's pay, the economy's measure, the country's month, a venture's
// customers leaving, the companies' prices and campaigns reaching the people, MAGITA's terms only on MAGITA's goods,
// a smaller country's companies spending less, a company abroad selling abroad, 運営's knobs (pay levels, the cost of
// living, the country's borrowing and its default) and the brakes loosened (crashes and manias): npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as pop from '../core/npc-pop.js';
import { NPC, CORP, RULES } from '../core/rules.js';
import { seeded } from '../core/npc-rand.js';
import * as state from '../core/npc-state.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0);
const MIN = 60000;

function country(n = 1000, seed = 7) {
  const key = Buffer.alloc(32, seed), ch = corpModel.chance(key);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const prices = { riru: 12000, ice: 30000, magita: 18000, tenesice: 60000 };
  const ctx = { corp: w, stockPrice: (id) => prices[id], carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  return {
    w, W, ctx, ch, prices,
    days(k) {
      const outs = [];
      for (let d = 0; d < k; d++) {
        const day = Math.floor(m / 1440);
        for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
        const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
        npc.nextDay(W, day, out.ext, ctx);
        outs.push(out);
      }
      return outs;
    },
    // (the money ledger: server/core/npc-model.js moneyOf — アスカ国's money with it)
    money() { return npc.moneyOf(W, w); }
  };
}

test('a payment one must make borrows what is short, out of Tenesice\'s own money: beyond what anyone lends it is not paid (a day missed), never paid with money from nowhere', () => {
  const { W } = country(600);
  const P = W.P, i = 3;
  for (const [cash, n] of [[100, 1000], [0, 50000000]]) {
    P.cash[i] = cash; P.credit[i] = 0; P.salary[i] = 0; P.miss[i] = 0;
    // (owing all the quick loan allows already)
    P.debt[i] = npc.econ.quickCap(P, i);
    const debt = P.debt[i];
    assert.equal(npc.econ.pay(W, i, n, true), false);
    assert.equal(P.cash[i], cash, `${cash} paying ${n}`);
    assert.equal(P.debt[i], debt);
    assert.equal(P.miss[i], 1);
  }
  // (with room for a quick loan: at least a million of it, the payment made from it)
  P.cash[i] = 100; P.debt[i] = 0; P.miss[i] = 0;
  assert.equal(npc.econ.pay(W, i, 1000, true), true);
  assert.equal(P.cash[i], 100 + 1000000 - 1000);
  assert.equal(P.debt[i], 1000000);
  // (but no more than the bank has of its own to lend: what it lent counted off it)
  W.bankRoom = 600;
  P.cash[i] = 100; P.debt[i] = 0;
  assert.equal(npc.econ.pay(W, i, 1000, true), false);
  assert.equal(P.cash[i], 700);
  assert.equal(P.debt[i], 600);
  assert.equal(W.bankRoom, 0);
});

test('a life ends: money they were short of is a loss to the bank (not money made), the home passes on, nobody counts them a friend, their orders go', () => {
  const c = country(800);
  const { W } = c;
  const P = W.P, day = W.day, r = seeded(Buffer.alloc(32, 1), 'die');
  // a household head who rents, with someone living with them
  let i = -1;
  for (let x = 0; x < P.n; x++) if (P.hh[x] === x && P.home[x] === pop.HOME.rent && P.hnext[x] >= 0 && P.home[P.hnext[x]] === pop.HOME.family) { i = x; break; }
  assert.ok(i >= 0);
  const heir = P.hnext[i], rent = P.rent[i];
  P.cash[i] = -2000000;
  // someone counting them a friend, someone staying with them, an order of theirs waiting
  const friend = (i + 5) % P.n;
  P.rel[friend * pop.REL] = i;
  const guest = (i + 9) % P.n;
  P.host[guest] = i;
  W.marketState.book.riru.buy.push([i, 10, 12000]);
  W.richest = i;
  const before = c.money();
  npc.state.die(W, i, day, r, c.ctx);
  // (the funeral went to the local businesses: still in the country)
  assert.equal(c.money(), before);
  assert.equal(P.home[heir], pop.HOME.rent);
  assert.equal(P.rent[heir], rent);
  // (only the newborn's own family in the slot count them now)
  for (let x = 0; x < P.n * pop.REL; x++) if (P.rel[x] === i) assert.equal(P.hh[Math.floor(x / pop.REL)], P.hh[i], 'no one else counts the slot a friend');
  assert.equal(P.host[guest], -1);
  assert.equal(W.marketState.book.riru.buy.some((o) => o[0] === i), false);
  assert.notEqual(W.richest, i);
});

test('the market: selling a whole holding at a gain pays its 20% gains tax', () => {
  const c = country(500);
  const { W } = c;
  const P = W.P, i = 11, k = 0;
  P.sh[i * pop.LISTED + k] = 100;
  W.marketState.cost.riru = { [i]: 10000 };
  P.cash[i] = 0;
  const nation = W.nation.cash;
  W.marketState.book.riru.sell = [[i, 100, 11000]];
  W.marketState.book.riru.buy = [[12, 100, 13000]];
  P.cash[12] = 1e10;
  c.prices.riru = 12000;
  W.market.auction(W, W.minute + 1, c.ctx);
  assert.equal(P.sh[i * pop.LISTED + k], 0);
  // (100 shares at 12,000 bought at 10,000: 200,000 gained, 40,000 tax)
  assert.equal(W.nation.cash - nation, 40000);
});

test('the market: a person makes at most 15 orders a day (buys and sales together), afresh the next day', () => {
  const c = country(500);
  const { W } = c;
  const P = W.P, i = 21;
  assert.equal(NPC.life.tradesDay, 15);
  P.cash[i] = 1e9;
  P.fund[i * 4 + 3] = 1e9;
  // (gloomy about all four: a sale each time it looks)
  for (let k = 0; k < pop.LISTED; k++) { P.sh[i * pop.LISTED + k] = 1000; P.outlook[i * pop.LISTED + k] = -127; }
  const orders = () => Object.values(W.marketState.book).reduce((n, b) => n + b.buy.filter((o) => o[0] === i).length + b.sell.filter((o) => o[0] === i).length, 0);
  for (const b of Object.values(W.marketState.book)) { b.buy = []; b.sell = []; }
  const r = seeded(Buffer.alloc(32, 3), 'trades');
  for (let n = 0; n < 400; n++) W.market.think(W, i, 0, r, c.ctx);
  assert.equal(P.trades[i], 15);
  assert.ok(orders() <= 15);
  const was = orders();
  W.market.think(W, i, 0, r, c.ctx);
  assert.equal(orders(), was);
  // (the day's count goes at the next day's start)
  c.days(1);
  assert.ok(P.trades[i] <= 15);
});

test('the slots draw the people more: what they set aside for them a month and how much they want to go', async () => {
  const c = country(300);
  const { W } = c;
  assert.ok(NPC.life.casinoPull > 1 && NPC.life.casinoSpend > 1);
  const i = 5, was = NPC.life.casinoSpend;
  NPC.life.casinoSpend = 1;
  state.budgetOf(W, i, 40, { u: () => 0.5 });
  const plain = W.P.fund[i * 4];
  NPC.life.casinoSpend = was;
  state.budgetOf(W, i, 40, { u: () => 0.5 });
  assert.ok(Math.abs(W.P.fund[i * 4] - Math.round(plain * was)) <= 1, `${W.P.fund[i * 4]} ${plain}`);
});

test('raises reach the people: April\'s raise and the step for the years worked on everyone\'s pay; the talks read last year\'s profit', () => {
  const c = country(1000);
  const { W, w } = c;
  const P = W.P, staff = W.staffOf('magita');
  const before = staff.map((i) => P.salary[i]), tenure = staff.map((i) => P.tenure[i]);
  const april = CORP.dayAt(2027, 4, 1);
  w.co.magita.yearRaise = { fy: 2027, raise: 0.02 };
  W.lab.unions.magita.state = 'idle';
  W.labor.day(W, april, seeded(Buffer.alloc(32, 2), 'x'), c.ctx);
  staff.forEach((i, k) => {
    if (P.job[i] !== 2) return;
    const step = tenure[k] >= 12 && !(P.flags[i] & pop.FL.rehired) ? 0.015 : 0;
    assert.equal(P.salary[i], Math.max(W.nation.knobs.minWage, Math.round(before[k] * (1 + 0.02 + step))));
  });
  // once a year
  const again = staff.map((i) => P.salary[i]);
  W.labor.day(W, april, seeded(Buffer.alloc(32, 2), 'y'), c.ctx);
  assert.deepEqual(staff.map((i) => P.salary[i]), again);
});

test('the economy measure starts at 1 and the country keeps its month\'s books', () => {
  const c = country(600);
  c.days(20);
  assert.equal(c.W.stats.economy, 1);
  const mo = c.W.nation.month;
  assert.ok(Object.keys(mo.in).length > 0 && Object.keys(mo.out).length > 0);
});

test('a venture\'s customers leave at its rate, found among everyone (not by luck)', () => {
  const { W } = country(2000);
  const o = W.orgs.carowner;
  npc.org.startVenture(W, o, 'coating', W.day, seeded(Buffer.alloc(32, 3), 'v'));
  const v = o.ventures[o.ventures.length - 1], bit = 1 << v.slot, P = W.P;
  let k = 0;
  for (let i = 0; i < P.n && k < 200; i++) if (P.car[i]) { P.subs[i] |= bit; k++; }
  v.customers = k;
  v.quality = 0.1;
  W.segment = { car: 0 };
  // (30 days at about 1.3% a day: some 30% of 200 leave; the old way met almost none of them)
  let left = 0;
  const rr = seeded(Buffer.alloc(32, 5), 'days');
  for (let d = 0; d < 30; d++) runVentureDay(W, W.day + d, rr);
  for (let i = 0; i < P.n; i++) if (P.subs[i] & bit) left++;
  assert.equal(left, v.customers);
  assert.ok(v.customers < 180 && v.customers > 80, String(v.customers));
});
function runVentureDay(W, day, r) {
  // (the org's day with no corp view does nothing but the new businesses' day)
  npc.org.orgDay(W, day, r, { corp: { co: {} } });
}

test('the companies\' prices and campaigns reach the people: dearer goods are bought less in number but cost more in all', () => {
  const { W } = country(400);
  assert.equal(npc.econ.spendAt(W, 'jinx:goods', 10000), 10000);
  W.priceIdx['jinx:goods'] = 1.44;
  assert.equal(npc.econ.spendAt(W, 'jinx:goods', 10000), 12000);
  W.appeal['dtrade:all'] = 0.1;
  W.appeal['dtrade:casino'] = 0.05;
  assert.ok(Math.abs(npc.econ.appealOf(W, 'dtrade', 'casino') - 0.15) < 1e-9);
});

test('MAGITA\'s negotiated terms are on MAGITA\'s goods only; a smaller country\'s companies spend less (YOSIDA, at home, too)', () => {
  const key = Buffer.alloc(32, 9), ch = corpModel.chance(key);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0 });
  const place = w.co.jinx.budget.place;
  corpModel.startCirculation(w, launch, 0.1);
  assert.equal(w.co.jinx.budget.place, Math.round(place * 0.1));
  // (YOSIDA is at home now: sized with the country like the others, its exports by its own trade)
  assert.ok(w.co.yosida.budget.place > 0 && w.co.yosida.scale.export < 1);
  // a lot of YOSHIDA cars arriving at Car Owner: at its 仕入れ価格, whatever MAGITA and Car Owner agreed
  w.terms = { carowner: 1.2 };
  const d = launch;
  w.ext = null;
  const out = corpModel.closeDay(w, d, { npc: { co: { carowner: { s: {}, p: {}, t: {}, l: {}, cat: 0, restock: [{ id: 'yoshida-s6', n: 3 }, { id: 'nissan-gt-r', n: 1 }] } }, bank: {}, staff: {}, charges: [], ops: [] } }, ch);
  void out;
  const lot = w.co.carowner.lotCost;
  assert.equal(lot['yoshida-s6'], CORP.products.cars['yoshida-s6'].buy);
  assert.equal(lot['nissan-gt-r'], Math.round(CORP.products.cars['nissan-gt-r'].buy * 1.2) + CORP.products.cars['nissan-gt-r'].excl + (w.co.magita.surcharge ? CORP.magita.surcharge.amount : 0));
});

test('運営\'s knobs: a company\'s pay level rescales its people\'s pay at once; the rents; knobs added later start where the rules say', () => {
  const { W } = country(800);
  const P = W.P, staff = W.staffOf('jinx'), before = staff.map((i) => P.salary[i]);
  assert.equal(NPC.knobOf(W, 'pay:jinx'), 0);
  W.knobChanged('pay:jinx', 0, 20);
  staff.forEach((i, k) => assert.equal(P.salary[i], Math.round(before[k] * 1.2)));
  W.knobChanged('pay:jinx', 20, -10);
  staff.forEach((i, k) => assert.equal(P.salary[i], Math.round(Math.round(before[k] * 1.2) * 0.9 / 1.2)));
  const renter = Array.from({ length: P.n }, (_, i) => i).find((i) => P.rent[i] > 0);
  const rent = P.rent[renter];
  W.knobChanged('rentLevel', 0, 50);
  assert.equal(P.rent[renter], Math.round(rent * 1.5));
  delete W.nation.knobs.phoneBill;
  npc.attach(W);
  assert.equal(W.nation.knobs.phoneBill, 100000);
});

test('the country beyond what Tenesice will lend it: it defaults (財政破綻) and pays its pensions and servants only in part, until its money is back', () => {
  const c = country(800);
  const { W } = c;
  W.nation.knobs.debtCap = 100;
  W.nation.bank = W.cal.bank0;
  W.nation.cash = -W.cal.nationFloor * 2;
  c.days(2);
  assert.equal(W.nation.broke, W.nation.cash < 0);
  assert.ok(npc.state.solvency(W) < 1 || W.nation.cash >= 0);
  const news = [];
  W.nation.cash = -W.cal.nationFloor * 2;
  W.nation.broke = false;
  npc.state.dayStart(W, W.day + 1, seeded(Buffer.alloc(32, 6), 'd'), c.ctx);
  for (const n of W.news) news.push(n.text);
  assert.ok(news.some((t) => t.includes('財政が破綻')), news.join('\n'));
  assert.equal(W.nation.bank <= W.cal.bank0, true);
});

test('crashes and manias can happen: a company\'s price may move 8% a day towards its worth, the people rush with a move', () => {
  const key = Buffer.alloc(32, 10), ch = corpModel.chance(key);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0 });
  const s = w.co.riru, e0 = s.mkt.e;
  // (its worth crashes: a loss expected)
  s.guide.expected.net = -1e11;
  s.hist = s.hist.map((h) => ({ ...h, net: -1e10 }));
  const out = corpModel.closeDay(w, launch, {}, ch);
  const a = out.anchors.find((x) => x.company === 'riru');
  assert.ok(a.e1 - e0 < -0.015 && a.e1 - e0 >= -0.08 - 1e-9, String(a.e1 - e0));
});

test('a home taken by the bank: what it brings pays the debt and the rest is the owner\'s (no money lost); the family rents at the rents\' level', () => {
  const c = country(800);
  const { W } = c;
  const P = W.P;
  let i = -1;
  for (let x = 0; x < P.n; x++) if (P.home[x] === pop.HOME.own && P.hh[x] === x) { i = x; break; }
  assert.ok(i >= 0);
  W.nation.knobs.rentLevel = 20;
  P.cash[i] = 0; P.credit[i] = 0; P.salary[i] = 0; P.rent[i] = 0;
  P.debt[i] = npc.econ.quickCap(P, i) * 4 + 1000;
  P.dkind[i] = 2;
  // (the local businesses with what buying the home takes, not so much more that their owners' payouts rescue them)
  W.sector.cash = W.cal.sectorCushion + 40000000;
  npc.state.owners(W);
  const before = c.money();
  npc.state.dayStart(W, W.day + 1, seeded(Buffer.alloc(32, 8), 'f'), c.ctx);
  assert.equal(W.sum.foreclosed, 1);
  assert.equal(P.debt[i], 0);
  // (a modest home's worth, at most half of what the local businesses have: beyond the debt, theirs)
  assert.ok(P.cash[i] > 0);
  void before;
  assert.equal(npc.state.rentFor(W, 0), 108000);
});

test('a company that bills once a month is not read as falling for the rest of it: its trend is by 30-day sums', () => {
  const { W } = country(400);
  // 120 days of a company paid only on the 1st of each 30 days, the same each month
  W.coDays = { daizin: [] };
  for (let d = 0; d < 120; d++) W.coDays.daizin.push(d % 30 === 0 ? 3000000 : 0);
  const h = W.coDays.daizin, last30 = h.slice(-30).reduce((a, b) => a + b, 0), usual = h.reduce((a, b) => a + b, 0) / h.length * 30;
  assert.equal(last30 / usual - 1, 0);
});

test('VIP is a membership: the rich renew it while they can and care to, and new ones join (DAIZIN\'s members do not simply run out)', () => {
  const c = country(1500);
  const { W } = c;
  const P = W.P;
  const first = CORP.dayAt(2026, 12, 1);
  const members = () => { let n = 0; for (let i = 0; i < P.n; i++) if (P.vip[i] > first) n++; return n; };
  // (every member's year ending this month; the rich and vain)
  for (let i = 0; i < P.n; i++) {
    if (P.vip[i] > 0) P.vip[i] = first + 5;
    if (P.cash[i] > 300000000) P.tr[i * pop.NT + pop.T.vanity] = 255;
  }
  const had = members();
  assert.ok(had > 0);
  npc.state.dayStart(W, first, seeded(Buffer.alloc(32, 12), 'vip'), c.ctx);
  assert.ok(members() >= had * 0.8, `${members()} of ${had}`);
});
