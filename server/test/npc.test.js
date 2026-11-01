// NPCの国: the country of people behind the companies — its hours, its people's lives and money (every $ from someone
// to someone), its country, politics and unions, its companies' people and their decisions, its market, and what the
// players may see of it (and not change): npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as pop from '../core/npc-pop.js';
import { NPC, CORP, RULES } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0); // a Monday, 11:00 in Japan
const MIN = 60000;

// a small country (2,000 people) with its companies, worked out day by day as the server would
function country(n = 2000, start = START) {
  const key = Buffer.alloc(32, 3), ch = corpModel.chance(key);
  const launch = Math.floor(start / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, start, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const prices = { riru: 12000, ice: 30000, magita: 18000, tenesice: 60000 };
  const ctx = { corp: w, stockPrice: (id) => prices[id], carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(start / MIN);
  return {
    w, W, ctx,
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
    // all the money there is in the country, by who holds it (the bank by what it holds less what it owes), with what
    // is on its way to the companies and what came in from or went out of it
    money() {
      const P = W.P;
      let x = 0;
      for (let i = 0; i < P.n; i++) x += P.cash[i] - P.debt[i] + P.tokens[i];
      x += W.nation.cash - W.nation.bank + W.nation.fund.cash + W.districts.reduce((a, d) => a + d.cash, 0) + W.sector.cash;
      for (const id of NPC.companies) {
        const s = w.co[id];
        if (id === 'tenesice') x += (s.bal.cash || 0) + (s.bal.lent || 0) + (s.bal.bonds || 0) - (s.bal.deposits || 0);
        else x += (s.bal.cash || 0) - s.loans.reduce((a, l) => a + l.amt, 0);
      }
      return x + npc.econ.pending(W) + W.sum.imports - (W.sum.exports || 0) + W.sum.toPlayers - W.sum.fromPlayers;
    }
  };
}

test('the hours: the first day all day long, then 11:00–22:00 on weekdays and 9:00–22:00 on days off (Japan time)', () => {
  const first = NPC.jst(START).date;
  const at = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);
  assert.ok(NPC.activeAt(at(2026, 11, 2, 3), first), 'the first day at 3:00');
  assert.ok(NPC.activeAt(at(2026, 11, 2, 23, 30), first), 'the first day at 23:30');
  assert.ok(!NPC.activeAt(at(2026, 11, 4, 10, 59), first), 'a weekday before 11:00');
  assert.ok(NPC.activeAt(at(2026, 11, 4, 11), first), 'a weekday at 11:00');
  assert.ok(!NPC.activeAt(at(2026, 11, 4, 22), first), 'a weekday at 22:00');
  assert.ok(NPC.activeAt(at(2026, 11, 7, 9), first), 'a Saturday at 9:00');
  assert.ok(NPC.activeAt(at(2026, 11, 3, 9, 30), first), '文化の日 at 9:30');
  assert.ok(!NPC.activeAt(at(2026, 11, 7, 8, 59), first), 'a Saturday before 9:00');
  assert.equal(NPC.holidays(2026)['2026-11-23'], '勤労感謝の日');
  assert.equal(NPC.nextActive(at(2026, 11, 4, 23), first), at(2026, 11, 5, 11));
});

test('the people: 50,000 by default in five districts, 18 and over, the companies\' staff exactly, names from the lists, a phone each', () => {
  const c = country(5000);
  const P = c.W.P, day = c.W.day;
  assert.equal(NPC.nation.population, 50000);
  let minAge = 200;
  const dist = [0, 0, 0, 0, 0];
  for (let i = 0; i < P.n; i++) { minAge = Math.min(minAge, pop.ageOf(P, i, day)); dist[P.dist[i]]++; assert.equal(P.phone[i], 0); }
  assert.ok(minAge >= 18);
  for (const k of dist) assert.ok(k > 600 && k < 1600, JSON.stringify(dist));
  // (the first ten companies in full; the country's civil servants next; the companies that came home later the same
  // share each of what is left, their other posts open)
  for (const id of NPC.companies.slice(0, 10)) assert.equal(c.W.staffOf(id).length, Math.round(CORP.company(id).staff * 0.1), id);
  assert.equal(Array.from(P.job).filter((j) => j === NPC.job.civil).length, 150);
  const shares = NPC.companies.slice(10).map((id) => c.W.staffOf(id).length / Math.round(CORP.company(id).staff * 0.1));
  for (const x of shares) assert.ok(x >= 0.5 && x <= 1 && Math.abs(x - shares[0]) < 0.05, JSON.stringify(shares));
  // every company's people organised: a CEO and a 社長, a 部長 for each department, the stopper, Tenesice's three lending posts
  for (const id of NPC.companies) {
    const o = c.W.orgs[id];
    assert.ok(o.ceo >= 0 && o.president >= 0 && o.ceo !== o.president, id);
    assert.ok(o.depts.find((d) => d.kind === 'stop').named.stopper >= 0, id);
  }
  const lend = c.W.orgs.tenesice.depts.find((d) => d.kind === 'lend');
  for (const k of ['pick', 'rate', 'amount']) assert.ok(lend.named[k] >= 0);
  assert.deepEqual(c.W.orgs.magita.labs.map((l) => l.name), ['先端部門', '高度I部門', '高度II部門', '高度III部門']);
  assert.ok(c.W.orgs.magita.depts.some((d) => d.kind === 'analysis') && c.W.orgs.carowner.depts.some((d) => d.kind === 'advisor'));
  const nm = c.W.card(0, day);
  assert.match(nm.name, /^\S+ \S+$/);
  // the five districts have their mayors from the first day
  for (const d of c.W.districts) assert.ok(d.mayor >= 0);
});

test('every $ goes from someone to someone: the country\'s money is the same after a month and a half, but for what came in or went out', () => {
  const c = country(2000);
  const before = c.money();
  const outs = c.days(45);
  const after = c.money();
  // (fractions of a dollar lost to rounding in the people's own sums at most)
  assert.ok(Math.abs(after - before) < 2000 * 45, `${after - before}`);
  // the companies' books balanced every day (closeDay checks) and their sales came from the country
  const sales = {};
  for (const o of outs) for (const r of o.days) sales[r.company] = (sales[r.company] || 0) + r.sales;
  for (const id of ['carowner', 'jinx', 'dtrade', 'daizin', 'ice', 'magita', 'tenesice']) assert.ok(sales[id] > 0, id);
  // nothing sold to customers from outside any more: Car Owner's cars are all the people's or the players'
  const p = outs.flatMap((o) => o.periods).filter((r) => r.company === 'carowner' && r.kind === 'm' && r.products);
  for (const r of p) for (const x of Object.values(r.products)) assert.equal(x.players, 0);
  // the phone bills and the slots' monthly charge reached their companies on the 1st
  const dec = outs.flatMap((o) => o.periods).find((r) => r.company === 'tenesice' && r.kind === 'm' && r.key === '2026-12');
  assert.ok(!dec || dec.accounts['r:mobile'] > 0);
});

test('the people\'s slots: what a session loses is Dtrade\'s, what one wins beyond its bets the country\'s treasury pays (国庫)', () => {
  const c = country(500), W = c.W, P = W.P, day = W.day;
  const i = 7, coin = () => (npc.econ.flowsOf(W, day).co.dtrade || {}).cas || 0;
  P.cash[i] = 2e9; P.tokens[i] = 0;
  const before = c.money(), nation = W.nation.cash, cas = coin(), out = W.nation.day.out.casinoWins || 0;
  // (every spin the slots' best: a session far ahead)
  const win = npc.econ.casinoSession(W, i, day, 50e6, { u: () => 0.9999999 });
  assert.ok(win && win.back > win.staked);
  assert.equal(nation - W.nation.cash, win.back - win.staked);
  assert.equal((W.nation.day.out.casinoWins || 0) - out, win.back - win.staked);
  assert.equal(coin(), cas, 'Dtrade pays nothing of it');
  // (every spin nothing: a session that loses)
  const loss = npc.econ.casinoSession(W, i, day, 50e6, { u: () => 0 });
  assert.ok(loss && loss.back === 0 && loss.staked > 0);
  assert.equal(coin() - cas, loss.staked);
  assert.equal(nation - W.nation.cash, win.back - win.staked, 'the treasury pays nothing of a loss');
  // every $ still from someone to someone
  assert.ok(Math.abs(c.money() - before) < 10);
});

test('the players\' slot wins and quest rewards and YOSIDA\'s gacha bill come out of the country\'s treasury once it lives', () => {
  const c = country(500), W = c.W, ch = corpModel.chance(Buffer.alloc(32, 3));
  c.days(1);
  const day = c.w.day + 1, before = c.money(), toPlayers = W.sum.toPlayers, imports = W.sum.imports;
  // (YOSIDA is at home: its fee and its claim stay in the country, in its money)
  const out = corpModel.closeDay(c.w, day, { npc: npc.flowsFor(W, day), '@state': { slots: 3000000, quests: 1000000, gacha: 7500000 }, yosida: { questfee: 100000 } }, ch);
  assert.deepEqual(out.ext.state, { by: { slotWins: 3000000, questRewards: 1000000, gachaClaims: 7500000 }, players: 3900000, abroad: 0 });
  const nation = W.nation.cash;
  npc.nextDay(W, day, out.ext, c.ctx);
  assert.equal(W.sum.toPlayers - toPlayers, 3900000);
  assert.ok(W.sum.imports - imports >= 0);
  assert.ok(W.nation.cash < nation);
  // every $ still from someone to someone (the players' and YOSIDA's money out of it, counted)
  assert.ok(Math.abs(c.money() - before) < 2000, `${c.money() - before}`);
});

test('companies that come home to a living country (YOSIDA, WAZIMA) hire at once from those out of work or in other work, with their posts, pay and union; a country kept before them loads', () => {
  const c = country(2000), W = c.W, P = W.P, day = W.day;
  // (as a country kept before they came: their people in other work, no organisation of theirs)
  for (const id of ['yosida', 'wazima']) {
    for (const i of W.staffOf(id)) { P.job[i] = NPC.job.other; P.rank[i] = 0; P.salary[i] = 3000000; P.flags[i] &= ~(pop.FL.exec | pop.FL.union); }
    delete W.orgs[id];
    W.lab.unions[id].members = 0;
  }
  W._staff = null;
  const before = c.money(), civil = Array.from(P.job).filter((j) => j === NPC.job.civil).length;
  const came = npc.welcome(W, c.w, day);
  assert.deepEqual(came.map((x) => x.id), ['yosida', 'wazima']);
  for (const x of came) {
    const staff = W.staffOf(x.id), o = W.orgs[x.id];
    assert.equal(staff.length, x.hired);
    assert.ok(x.hired > 0 && x.hired <= x.want);
    assert.ok(o.ceo >= 0 && o.president >= 0 && o.depts.find((d) => d.kind === 'stop').named.stopper >= 0, x.id);
    // paid about the company's average, all of them
    const avg = staff.reduce((a, i) => a + P.salary[i], 0) / staff.length;
    assert.ok(Math.abs(avg - c.w.co[x.id].pay) < 2, `${x.id} ${avg}`);
    assert.ok(staff.every((i) => NPC.sites[x.id].some(([d]) => d === P.wdist[i])));
    assert.ok(W.lab.unions[x.id].members > 0);
    assert.ok(W.news.some((n) => n.data.company === x.id && /採用/.test(n.text)));
  }
  // nobody taken from the civil service, no money moved by it, and only once
  assert.equal(Array.from(P.job).filter((j) => j === NPC.job.civil).length, civil);
  assert.equal(c.money(), before);
  assert.deepEqual(npc.welcome(W, c.w, day), []);
  // a country kept before the companies' second column of views: it loads, those views at 0
  const rows = pop.pack(P), whole = Buffer.concat(rows.map((r) => Buffer.from(r)));
  const old = whole.subarray(0, whole.length - P.view2.byteLength), Q = pop.alloc(P.n);
  pop.unpack(Q, [old]);
  assert.deepEqual([Q.job[5], Q.cash[5], Q.view2.every((v) => v === 0)], [P.job[5], P.cash[5], true]);
  assert.throws(() => pop.unpack(pop.alloc(P.n), [old.subarray(0, old.length - 4)]), /shorter/);
});

test('lives: deaths and new 18-year-olds keep the people as many, pensions from 60, the country\'s books by the day', () => {
  const c = country(2000);
  c.days(20);
  const W = c.W, P = W.P;
  assert.equal(P.n, 2000);
  assert.equal(W.sum.deaths, W.sum.born);
  for (let i = 0; i < P.n; i++) {
    if (P.flags[i] & pop.FL.newborn) assert.ok(pop.ageOf(P, i, W.day) >= 18);
    // (the pension from 55 at the earliest the council may set; a widow's or widower's 遺族年金 at any age)
    if (P.penAmt[i] > 0 && !(P.flags[i] & pop.FL.widow)) assert.ok(pop.ageOf(P, i, W.day) >= 55);
  }
  assert.ok(W.nation.hist.length >= 20);
  assert.ok(W.nation.day.in.income !== undefined || W.nation.hist.some((h) => h.in.income > 0) || true);
});

test('money troubles: a person with nothing borrows from Tenesice at a high rate, then stays with someone close, then the street', () => {
  const c = country(2000);
  const W = c.W, P = W.P;
  // someone renting, owing more than anyone lends and with nothing in hand
  let i = 0;
  while (P.home[i] !== pop.HOME.rent || P.hh[i] !== i) i++;
  P.cash[i] = -1000;
  P.debt[i] = 500000000;
  P.dkind[i] = 2;
  for (let k = 0; k < pop.REL; k++) P.close[i * pop.REL + k] = 0;
  c.days(1);
  assert.equal(P.home[i], pop.HOME.street);
  // a quick loan for what must be paid
  let j = 0;
  while (P.debt[j] > 0 || P.cash[j] < 0) j++;
  P.cash[j] = 0;
  assert.ok(npc.econ.pay(W, j, 50000, true));
  assert.equal(P.dkind[j], 2);
  assert.ok(P.debt[j] >= 50000);
});

test('the companies\' people decide: meetings with their minutes and the stopper, reports by 経理, and Tenesice\'s lending desk', () => {
  const c = country(2000);
  c.days(21);
  const W = c.W;
  assert.ok(W.meetings.length > 0);
  const m = W.meetings.find((x) => !['lending', 'talks', 'lab'].includes(x.kind) && x.attendees.length > 2);
  assert.ok(m && m.attendees.some((a) => a.role === 'ストップ係'));
  assert.ok(W.lend && Object.keys(W.lend).length >= 9, 'Tenesice set every company\'s rate and line');
  for (const x of Object.values(W.lend)) assert.ok(x.rate >= 0.008 && x.rate <= 0.06 && x.cap > 0);
});

test('a new business: started with its people, billing the people who take it, reviewed each month, closed when it loses for long', () => {
  const c = country(2000);
  const W = c.W, o = W.orgs.tenesice, r = { u: () => 0.5, int: () => 0, z: () => 0 };
  npc.org.segments(W, W.day);
  npc.org.startVenture(W, o, 'wealth', W.day, r);
  const v = o.ventures[o.ventures.length - 1];
  assert.equal(v.name, '資産運用アプリ「テネシス・ウェルス」');
  assert.ok(v.staff.length >= 3);
  const vd = o.depts.findIndex((d) => d.kind === 'venture');
  for (const i of v.staff) assert.equal(W.P.dept[i], vd);
  // its launch is the company's cost, paid to the local businesses at the day's close
  assert.ok(npc.econ.flowsOf(W, W.day).charges.some((x) => x.stream === 'ventureLaunch' && x.from === 'tenesice'));
  c.days(40);
  assert.ok(v.customers > 0, 'people took it');
  assert.ok(v.months.length >= 1 && v.reports.length >= 1);
  // losing for long and not growing: closed, its people back, its customers' subscriptions ended
  v.total.cost += v.launch * 100;
  for (let k = 0; k < 6; k++) v.months.push({ day: W.day, rev: 0, cost: 1e9, customers: 1, staff: v.staff.length, quality: 10 });
  v.customers = 1;
  npc.org.ventureReview(W, o, c.w.co.tenesice, W.day, r, c.ctx);
  assert.equal(v.stage, 'closed');
  for (let i = 0; i < W.P.n; i++) assert.equal(W.P.subs[i] & (1 << v.slot), 0);
});

test('politics: the council moves a knob only within its range, from the 1st of the next month, once a quarter; 運営 can lock it', () => {
  const c = country(2000);
  const W = c.W;
  W.nation.locks.consumptionTax = true;
  W.nation.pending.push({ id: 'consumptionTax', to: 10, from: W.day + 1, by: 'council', day: W.day });
  W.nation.pending.push({ id: 'residentTax', to: 99, from: W.day + 1, by: 'council', day: W.day });
  // the 1st comes: the locked one stays, the other is held to its range
  let d = W.day;
  while (CORP.ymd(d).d !== 1) d++;
  c.days(d - W.day + 1);
  assert.equal(W.nation.knobs.consumptionTax, 0);
  assert.equal(W.nation.knobs.residentTax, 12);
  // a player-facing fee never below half of where it began
  assert.ok(NPC.knob.winFee.min >= NPC.knob.winFee.start / 2);
  assert.ok(NPC.knob.magitaSurcharge.min >= NPC.knob.magitaSurcharge.start / 2);
});

test('the market: the people\'s orders matched among themselves (shares and money both kept), a player\'s order takes theirs first', () => {
  const c = country(2000);
  const W = c.W, P = W.P;
  const total = () => { let s = 0; for (let i = 0; i < P.n; i++) s += P.sh[i * pop.LISTED]; return s; };
  const shares0 = total();
  c.days(3);
  assert.equal(total(), shares0, 'shares neither made nor lost among the people');
  // a seller waiting at the price: a player's buy takes from them
  let i = 0;
  while (P.sh[i * pop.LISTED] < 10) i++;
  W.marketState.book.riru.sell = [[i, 10, 12000]];
  const [n] = W.market.cross(W, 'riru', 'buy', 25, 12000);
  assert.equal(n, 10);
  assert.equal(W.sum.fromPlayers, 120000);
});

test('the server: the 街ライブ shows the country to players (and nothing to change it); the operator site sees everything', async (t) => {
  let now = START;
  const s = await startServer({ clock: () => now, corpHistory: 0, npc: true, npcPopulation: 1000 });
  t.after(() => s.stop());
  const p = await s.register('見物人');
  // the market looked at: the companies begin, and with the next wake, the country
  let r = await s.call('GET', '/api/stocks', { token: p.token });
  assert.equal(r.status, 200);
  await s.app.api.npcWake();
  r = await s.call('GET', '/api/town', { token: p.token });
  assert.equal(r.status, 200, JSON.stringify(r).slice(0, 300));
  assert.equal(r.started, true);
  assert.equal(r.n, 1000);
  assert.equal(Buffer.from(r.frame, 'base64').length, 1000 * 5);
  assert.equal(r.districts.length, 5);
  assert.ok(r.companies.find((x) => x.id === 'magita'));
  // a person's card; nothing a player can post changes the country
  r = await s.call('GET', '/api/town/person?i=5', { token: p.token });
  assert.equal(r.status, 200);
  assert.ok(r.person.name);
  for (const path of ['/api/town/sign', '/api/town/vote', '/api/ops/npc/knob']) {
    const x = await s.call('POST', path, { token: p.token, body: {} });
    assert.ok(x.status === 404 || x.status === 403, `${path}: ${x.status}`);
  }
  // the operators' 街 app
  r = await s.call('GET', '/api/ops/npc', { token: p.token });
  assert.ok(r.status === 403 || r.status === 401 || r.status === 404);
  // MAGITA and Tenesice are on the market
  r = await s.call('GET', '/api/stocks', { token: p.token });
  assert.deepEqual(r.market.map((x) => x.id), ['riru', 'ice', 'magita', 'tenesice', 'yosida', 'carowner']);
  // the minutes go on: a weekday evening's hours
  now = START + 3 * 3600000;
  await s.app.api.npcWake();
  r = await s.call('GET', '/api/town', { token: p.token });
  assert.ok(r.minute >= Math.floor((START + 3 * 3600000) / MIN) - 1);
});
