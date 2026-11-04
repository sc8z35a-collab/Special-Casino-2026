// 株式会社HACHI and 株式会社FIGMA (docs/HACHI_FIGMA.md): the rules as given, its founding on 2026-11-04, its wards and
// what they do, who pays, the 医療税 and its six tenths, the checkups the law asks for, Tenesice's line, its failure
// and アスカ国's buyout — and every $ still from someone to someone: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as hachi from '../core/hachi.js';
import * as health from '../core/npc-health.js';
import * as pop from '../core/npc-pop.js';
import * as asuka from '../core/asuka.js';
import { NPC, CORP, RULES, STOCKS, ASUKA } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0), MIN = 60000;
const FOUNDED = CORP.dayAt(2026, 11, 4);
function country(n = 800, seed = 21) {
  const key = Buffer.alloc(32, seed), ch = corpModel.chance(key), launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const ctx = { corp: w, stockPrice: () => 10000, carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  const c = {
    w, W, ch, ctx, worst: 0,
    get m() { return m; },
    days(k) {
      for (let d = 0; d < k; d++) {
        const day = Math.floor(m / 1440);
        for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
        const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
        npc.nextDay(W, day, out.ext, ctx);
        const L = npc.ledgerDay(W, w, day);
        c.worst = Math.max(c.worst, Math.abs(L.days[L.days.length - 1].moved));
      }
    },
    money: () => npc.moneyOf(W, w)
  };
  return c;
}
const even = { u: () => 0.5, int: () => 0, z: () => 0, poisson: () => 0, byte: () => 128, weighted: () => 0, pick: (a) => a[0] };
// an adult with money, not in a bed, not on 生活保護
function adult(W, skip = []) {
  const P = W.P, day = W.day;
  for (let i = 0; i < P.n; i++) if (!skip.includes(i) && pop.ageOf(P, i, day) >= 25 && P.cash[i] > 20000000 && !(P.flags[i] & pop.FL.welfare) && !P.care[i] && !P.crit[i]) return i;
  throw new Error('nobody fits');
}

test('the rules as given: 14th company, listed, founded 2026-11-04; its fees, wards, people at $5M/$6M/$10M a month; the 医療税 4% (2〜8%) six tenths its; the 医療保険; 健康度 ±100 and its bands', () => {
  const p = CORP.company('hachi'), R = CORP.hachi;
  assert.equal(CORP.companies.length, 14);
  assert.equal(CORP.companies[13].id, 'hachi');
  assert.deepEqual([p.founded, p.listed, p.retained, p.capital], [[2026, 11, 4], true, 20000000000, 0]);
  assert.ok(STOCKS.companies.some((c) => c.id === 'hachi' && c.ticker === 'HCH'));
  assert.deepEqual(R.fees, { checkup: 700000, consult: 850000, medicine: 850000, rehab: 850000, inpatient: 500000, surgery: 3000000 });
  assert.deepEqual(R.cap, { consult: 400, inpatient: 800, surgery: 20, rehab: 100 });
  assert.equal(R.minutes.surgery, 10);
  assert.deepEqual([R.wards.vernoa, R.wards.asuka, R.wards.min, R.wards.max, R.wards.state, R.wards.land, R.wards.admin], [5, 15, 7, 45, 20, 35000000, 600000000]);
  assert.deepEqual(R.staff, { medical: 3500, exec: 500, research: 500 });
  assert.equal(R.perWard, 3500 / 20);
  assert.deepEqual(R.pay, { medical: 5000000, exec: 6000000, research: 10000000 });
  // (its people here — ヴェルノア's five wards' 875, its 経営陣 and researchers — at those, a year)
  assert.equal(p.staff, 875 + 500 + 500);
  assert.equal(p.salary, (875 * 5000000 + 500 * 6000000 + 500 * 10000000) * 12 / 1875);
  assert.deepEqual([R.tax.hachi, R.tax.state], [0.6, 0.4]);
  assert.deepEqual(R.buyout, { mult: 2, ceo: 0.2, staff: 0.5, related: 0.3 });
  assert.equal(R.seed, 20000000000);
  assert.equal(CORP.wardName('ソレイユ区', 2), 'HACHI ソレイユ区 第2病院');
  assert.equal(CORP.myway.partners.hachi.term, 5);
  assert.ok(CORP.breakeven('hachi') < 1);
  const k = NPC.knob.medicalTax;
  assert.deepEqual([k.start, k.floor, k.cap], [4, 2, 8]);
  assert.deepEqual(NPC.insurance.map((x) => [x.week, x.cover]), [[0, 0], [60000, 0.5], [120000, 0.7]]);
  // 健康度 and what it does
  const band = (h) => NPC.healthBand(h).id;
  assert.deepEqual([-100, -95, -80, -50, -10, 20, 40, 60, 80, 90].map(band), ['terminal', 'critical', 'severe', 'urgent', 'leave', 'unwell', 'tired', 'healthy', 'fit', 'peak']);
  assert.deepEqual([health.output(0), health.output(20), health.output(60), health.output(80)], [0, 0.6, 1, 2]);
  assert.deepEqual([health.earn(85), health.earn(100)], [1, 1.7]);
  assert.equal(NPC.health.timer, 60);
  assert.deepEqual(NPC.health.care, { bed: 35, consult: 25, upTo: 75, checkup: 2, rehab: 15 });
  assert.deepEqual([NPC.health.healed, NPC.health.missed, NPC.health.surgeryFrom], [65, -20, -30]);
  // FIGMA: アスカ国's, not listed; 1,100 people from $30M a month ($40M each to it), $10B of retained earnings
  assert.deepEqual([ASUKA.figma.staff, ASUKA.figma.pay, ASUKA.figma.cost, ASUKA.figma.retained], [1100, 30000000, 40000000, 10000000000]);
  assert.ok(!STOCKS.companies.some((c) => c.id === 'figma'));
});

test('the 医療税 moved by the state: up step by step towards 5〜8% in a crisis or under the state, down towards 2〜3.5% when well ahead in good times, a step short; never outside 2〜8%', () => {
  const run = (x, from = 4, k = 12) => { const seen = []; let r = from; for (let i = 0; i < k; i++) { r = hachi.taxTarget(r, x); seen.push(r); } return seen; };
  const crisis = run({ inn: 100, out: 100, boom: 1, crisis: 1, state: false });
  assert.equal(crisis[0], 4.5);
  assert.ok(crisis.every((r, i) => i === 0 || r - crisis[i - 1] <= 0.5 + 1e-9));
  assert.equal(crisis[crisis.length - 1], 8);
  const state = run({ inn: 100, out: 100, boom: 1, crisis: 0, state: true });
  assert.ok(state[state.length - 1] >= 5 && state[state.length - 1] <= 8, String(state));
  const good = run({ inn: 300, out: 100, boom: 1.05, crisis: 0, state: false });
  assert.deepEqual(good.slice(0, 5), [3.5, 3, 2.5, 2, 2]);
  // (short in ordinary times: a step up, as far as 5%; nothing wrong: back towards 4%)
  assert.equal(hachi.taxTarget(4, { inn: 100, out: 200, boom: 1, crisis: 0, state: false }), 4.5);
  assert.deepEqual(run({ inn: 100, out: 200, boom: 1, crisis: 0, state: false }).slice(0, 4), [4.5, 5, 5, 5]);
  assert.deepEqual(run({ inn: 100, out: 100, boom: 1, crisis: 0, state: false }, 8).slice(0, 5), [7.5, 7, 6.5, 6, 5.5]);
  assert.equal(hachi.taxTarget(3, { inn: 100, out: 100, boom: 0.9, crisis: 0, state: false }), 3.5);
  assert.equal(hachi.taxTarget(8, { inn: 100, out: 200, boom: 1, crisis: 1, state: true }), 8);
  assert.equal(hachi.taxTarget(2, { inn: 900, out: 100, boom: 1.2, crisis: 0, state: false }), 2);
});

test('a month of it: founded on 2026-11-04 with the treasury\'s $20B, Tenesice\'s loan, its 20 wards named, its people taken on; FIGMA in アスカ国; MY WAY\'s five years; the checkups, the penalty, the 医療税\'s six tenths and the companies\' profits taxed; FIGMA\'s sales 4 : 6; every $ kept', () => {
  const c = country(800), { w, W } = c;
  c.days(2);
  assert.equal(w.co.hachi, undefined);
  c.days(1);
  const s = w.co.hachi, h = s.hachi, sc = 800 / 50000;
  assert.ok(s && h.founded === FOUNDED);
  // (its 利益剰余金 the treasury's, once)
  assert.ok(Math.abs(W.nation.month.out.hachiSeed - CORP.hachi.seed * sc) <= 1, String(W.nation.month.out.hachiSeed));
  // (Tenesice's loan that day, kept ten years, at its friend's rate)
  assert.ok(s.loans.some((l) => l.keep && l.rate === CORP.hachi.loan.rate && l.until === FOUNDED + 10 * 365));
  // its wards: five in ヴェルノア (one a district), fifteen in アスカ国 (three a district), each HACHI ○○区 第○病院
  const V = h.wards.filter((x) => x.country === 'vernoa'), A = h.wards.filter((x) => x.country === 'asuka');
  assert.deepEqual([V.length, A.length], [5, 15]);
  assert.deepEqual(V.map((x) => x.district).sort(), [0, 1, 2, 3, 4]);
  // (アスカ国's フリーコマースゾーン is a zone, not a 区: HACHI フリーコマースゾーン 第1病院)
  assert.ok(h.wards.every((x) => /^HACHI .+(区|ゾーン) 第\d+病院$/.test(x.name)), h.wards.map((x) => x.name).join(','));
  c.days(1);
  const AP = W.AP, J = asuka.JOB;
  let there = 0, fig = 0;
  for (let i = 0; i < AP.n; i++) { if (AP.job[i] === J.hachi) there++; if (AP.job[i] === J.figma) fig++; }
  assert.ok(Math.abs(there - Math.round(175 * W.asuka.scale * 15)) <= 1, `${there}`);
  assert.ok(W.asuka.figma && fig === Math.max(1, Math.round(1100 * W.asuka.scale)), `${fig}`);
  // MY WAY's characters for its checkups: five years
  const mw = w.co.myway.ip.contracts.hachi;
  assert.ok(mw && mw.on && mw.term === 5 && mw.until === FOUNDED + 5 * 365);
  // a month on: its people here (175 a ward, its 経営陣 and researchers — those out of work first, then through the job
  // sites: in a country this small nearly everyone already works) at their departments' pay; the checkups, the
  // penalty for the missed, the tax shared, the companies' profits taxed
  c.days(28);
  assert.ok(CORP.ymd(W.day).m === 12);
  const staff = W.staffOf('hachi'), want = Math.round(sc * (175 * 5 + 500 + 500));
  assert.ok(staff.length >= want * 0.6 && staff.length <= want + 2, `${staff.length} of ${want}`);
  for (const i of staff) {
    const role = NPC.hachiRoles[hachi.deptKey(W, W.P.dept[i])];
    if (role === 'medical' && !W.P.rank[i]) assert.ok(W.P.salary[i] >= 5000000 * 12 * 0.9 && W.P.salary[i] <= 5000000 * 12 * 1.4, `${W.P.salary[i]}`);
  }
  const last = W.hachi.last;
  assert.ok(last && last.due > 0 && last.done >= last.due * 0.5, JSON.stringify({ due: last.due, done: last.done }));
  // (those who missed it: −20 and their share stopped at the month's start — most go at once: the share back)
  assert.ok(last.missed >= 0 && last.done + last.missed <= last.due, JSON.stringify({ missed: last.missed, done: last.done, due: last.due }));
  const med = last.med;
  assert.ok(med.toHachi > 0 && Math.abs(med.toHachi / med.tax - 1.5) < 0.01, JSON.stringify(med));
  assert.ok(Object.values(w.co).some((x) => x.id !== 'hachi' && (x.per.y.tMedical || 0) > 0), 'a company paid the 医療税 on its profit');
  assert.ok((s.per.y['r:tax'] || 0) > 0, 'HACHI had its six tenths');
  // FIGMA: HACHI's equipment and research, and アスカ国's research half as much again — 4 : 6
  const f = W.asuka.figma.sales;
  assert.ok(f.hachi > 0 && Math.abs(f.asuka / f.hachi - 1.5) < 0.01, JSON.stringify(f));
  assert.equal(c.worst, 0);
});

test('a ward\'s day: the bills by the 医療保険 (none, half, three tenths; stopped while a checkup is owed; 生活保護 none), what each service does, the least healthy first and the gravely ill before all, the hour that kills, capacity by its staff', () => {
  const c = country(600, 22), { W, w } = c;
  c.days(4);
  assert.ok(hachi.isOpen(W));
  const P = W.P, day = W.day + 1, H = W.hachi;
  // the bills: the patient's share by their insurance, the rest the treasury's — all of it HACHI's
  const i = adult(W);
  const pays = (ins, welfare = false) => {
    P.ins[i] = ins;
    if (welfare) P.flags[i] |= pop.FL.welfare; else P.flags[i] &= ~pop.FL.welfare;
    const cash = P.cash[i], nation = W.nation.cash, money = c.money();
    assert.ok(hachi.bill(W, i, day, 'consult', 850000));
    assert.equal(c.money(), money, 'every $ to someone');
    return [cash - P.cash[i], nation - W.nation.cash];
  };
  assert.deepEqual(pays(0), [850000, 0]);
  assert.deepEqual(pays(1), [425000, 425000]);
  assert.deepEqual(pays(2), [255000, 595000]);
  assert.deepEqual(pays(1 | hachi.SUSPENDED), [850000, 0]);
  assert.deepEqual(pays(0, true), [0, 850000]);
  P.flags[i] &= ~pop.FL.welfare;
  P.ins[i] = 1;
  // what each does (desks free): a 診察 +25 as far as 75, its medicine for the unwell; リハビリ +15 into 76〜100; an
  // operation +65 at once
  let m = c.m + 30;
  const visit = (j, hp, kind) => { health.setHp(P, j, hp); P.act[j] = NPC.act.hospital; m += 30; hachi.arrive(W, j, m, kind, c.ctx, even); return health.hpOf(P, j); };
  assert.equal(visit(i, 20, 'doctor'), 45);
  assert.equal(P.med[i], 1);
  assert.equal(visit(i, 60, 'doctor'), 75);
  assert.equal(visit(i, 80, 'rehab'), 95);
  assert.equal(visit(i, -80, 'surgery'), 65);
  assert.equal(P.care[i], hachi.CARE.rehab);
  P.care[i] = 0;
  const saved = H.saved;
  P.crit[i] = 30;
  assert.equal(visit(i, -95, 'emergency'), 65);
  assert.deepEqual([P.crit[i], H.saved], [0, saved + 1]);
  // a day in a bed: +35, stress and the work's load gone
  health.setHp(P, i, -50);
  P.care[i] = hachi.CARE.bed;
  P.emo[i * 5 + pop.E.stress] = 250;
  hachi.day(W, day, even);
  assert.equal(health.hpOf(P, i), -15);
  assert.equal(P.emo[i * 5 + pop.E.stress], 0);
  P.care[i] = 0;
  health.setHp(P, i, 60);
  // the least healthy first, the gravely ill (−90 and below) before anyone: a ward's 診察 desks all taken, three wait
  const ward = hachi.wardFor(W, 'vernoa', P.dist[i]);
  const k = [adult(W, [i])];
  k.push(adult(W, [i, ...k]));
  k.push(adult(W, [i, ...k]));
  for (const j of k) P.dist[j] = P.dist[i];
  m += 30;
  const wr = W.hosp.wards[ward];
  wr.slots.consult = Array.from({ length: hachi.capacity(W, 'consult') }, () => m + 600);
  const hp = [10, -20, -92];
  k.forEach((j, n) => { health.setHp(P, j, hp[n]); P.act[j] = NPC.act.hospital; hachi.arrive(W, j, m, 'doctor', c.ctx, even); });
  assert.deepEqual(wr.queue.map((q) => q.i), [k[2], k[1], k[0]]);
  // the hour: at −90 and below, no operation within it — dead
  const died = [];
  const j = k[2];
  wr.queue = [];
  P.crit[j] = 2;
  W.hosp.crit.add(j);
  hachi.tick(W, m + 1, c.ctx, (x) => died.push(x));
  assert.deepEqual(died, []);
  hachi.tick(W, m + 2, c.ctx, (x) => died.push(x));
  assert.deepEqual(died, [j]);
  // a ward's capacity by its medical staff against 175 a ward: half the people, half of everything
  const info = W.hachiInfo, was = info.staffRatio;
  info.staffRatio = 1;
  const full = hachi.capacity(W, 'consult');
  info.staffRatio = 0.5;
  assert.ok(Math.abs(hachi.capacity(W, 'consult') - full / 2) <= 1, `${hachi.capacity(W, 'consult')} of ${full}`);
  info.staffRatio = was;
  void w;
});

test('the month\'s checkup is the law\'s: missed, −20 at the next month\'s start and the insurance\'s share stopped; the checkup done, at once back', () => {
  const c = country(600, 23), { W } = c;
  c.days(4);
  const P = W.P, a = adult(W), b = adult(W, [a]);
  P.chk[a] = 0;
  const nov = ((2026 - 2026) * 12 + 11) & 0xffff;
  P.chk[b] = nov;
  health.setHp(P, a, 60); health.setHp(P, b, 60);
  P.ins[a] = 1; P.ins[b] = 1;
  hachi.day(W, CORP.dayAt(2026, 12, 1), even);
  assert.equal(health.hpOf(P, a), 40);
  assert.ok(P.ins[a] & hachi.SUSPENDED);
  assert.equal(health.hpOf(P, b), 60);
  assert.ok(!(P.ins[b] & hachi.SUSPENDED));
  assert.equal(hachi.idCard(W, a).suspended, true);
  // the checkup done: the share back (this bill too)
  P.act[a] = NPC.act.hospital;
  const cash = P.cash[a];
  hachi.arrive(W, a, c.m + 60, 'checkup', c.ctx, even);
  assert.ok(!(P.ins[a] & hachi.SUSPENDED));
  assert.equal(cash - P.cash[a], CORP.hachi.fees.checkup * 0.5);
});

test('the 医療税 shared: six tenths HACHI\'s, the rest the treasury\'s; and Tenesice\'s line: short of half a month\'s costs, lent at once at its friend\'s rate', () => {
  const c = country(600, 24), { W, w } = c;
  c.days(4);
  const nation = W.nation.cash, money = c.money(), day = W.day + 1;
  hachi.taxed(W, 1000000, day);
  assert.equal(W.nation.cash - nation, 400000);
  assert.equal(W.fl[day].co.hachi.s.tax, 600000);
  assert.equal(c.money() - money, 1000000, 'what was taken of a pay, now the treasury\'s and HACHI\'s');
  // the line: its cash down to almost nothing (moved to its bonds), then a day
  // (its money put into its bonds by the test itself — its books the same, the country's money that much less that day)
  const s = w.co.hachi, cash = s.bal.cash, moved = cash - 1000;
  s.bal.bonds = (s.bal.bonds || 0) + moved;
  s.bal.cash = 1000;
  const loans = s.loans.length;
  c.days(1);
  assert.ok(s.loans.length > loans && s.loans.some((l) => l.line && l.rate === CORP.hachi.loan.rate), JSON.stringify(s.loans));
  assert.ok(s.bal.cash > 0);
  const L = W.ledger.days;
  // (and the $1M of 医療税 above, taken of no one's pay)
  assert.equal(L[L.length - 1].moved, -moved + 1000000, 'only what the test moved');
});

test('its failure: アスカ国 alone buys the whole business at twice its market value — 20% its 社長\'s, 50% its people\'s, 30% FIGMA\'s —; the state runs it: 20 wards, nobody let go, no land rent; every $ kept', () => {
  const c = country(600, 25), { W, w } = c;
  c.days(10);
  const s = w.co.hachi, P = W.P, AP = W.AP, J = asuka.JOB;
  const value = Math.round(Math.exp(s.mkt.e) * corpModel.outstanding(s) * 2);
  const o = W.orgs.hachi, boss = o.president >= 0 ? o.president : o.ceo;
  assert.ok(boss >= 0, 'its 社長 named from its people');
  const before = { boss: P.cash[boss], staff: W.staffOf('hachi').reduce((n, i) => n + P.cash[i], 0), figma: 0, asukaStaff: 0 };
  for (let i = 0; i < AP.n; i++) { if (AP.job[i] === J.figma) before.figma += AP.cash[i]; if (AP.job[i] === J.hachi) before.asukaStaff += AP.cash[i]; }
  const out = corpModel.hachiFail(w, W.day, '資金繰りに行き詰まり');
  assert.ok(out.news.some((n) => n.kind === 'buyout'));
  assert.ok(s.hachi.state && s.hachi.state.price === value && s.reorg && s.div.dps === 0);
  const staffN = W.staffOf('hachi').length;
  c.days(1);
  const a = W.asuka, B = a.hachiBought;
  assert.ok(B && B.price === value, JSON.stringify(B));
  assert.equal(B.paid + (a.hachiOwed || 0), value);
  const paid = B.paid;
  // (its 社長 a fifth; its people half, both countries'; FIGMA's people three tenths)
  assert.ok(P.cash[boss] - before.boss >= paid * 0.2 * 0.9, `${P.cash[boss] - before.boss} of ${paid}`);
  let figma = 0, asukaStaff = 0;
  for (let i = 0; i < AP.n; i++) { if (AP.job[i] === J.figma) figma += AP.cash[i]; if (AP.job[i] === J.hachi) asukaStaff += AP.cash[i]; }
  assert.ok(figma - before.figma >= paid * 0.3 * 0.9, `${figma - before.figma} of ${paid}`);
  const staffGot = W.staffOf('hachi').reduce((n, i) => n + P.cash[i], 0) - before.staff + asukaStaff - before.asukaStaff;
  assert.ok(staffGot >= paid * 0.5 * 0.9, `${staffGot} of ${paid}`);
  // the state's: no land rent, 20 wards, nobody let go — a month on
  const land = W.nation.month.in.hachiLand || 0;
  c.days(30);
  assert.equal(s.hachi.wards.length, 20);
  assert.ok(!s.cut);
  assert.ok(W.staffOf('hachi').length >= staffN - 1, `${W.staffOf('hachi').length} of ${staffN}`);
  assert.ok((W.nation.month.in.hachiLand || 0) === 0 || (W.nation.lastMonth && (W.nation.lastMonth.in.hachiLand || 0) <= land), 'no land rent under the state');
  assert.ok(!s.dead);
  assert.equal(c.worst, 0);
});
