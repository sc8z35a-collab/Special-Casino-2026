// 株式会社YAMATO (server/core/asuka.js), テネシスリサーチ (server/core/npc-research.js, corp-model.js researchDay) and
// テネシスファンド (corp-model.js fundMonth, npc-local.js), and the companies keeping less of their money: founded on their
// day, their money from someone (YAMATO's once from the treasury), every $ from someone to someone: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as pop from '../core/npc-pop.js';
import * as asuka from '../core/asuka.js';
import * as research from '../core/npc-research.js';
import { NPC, RULES, CORP, LOCAL } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0);
const MIN = 60000;

function country(n = 600, seed = 9) {
  const key = Buffer.alloc(32, seed), ch = corpModel.chance(key);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const prices = { riru: 12000, ice: 30000, magita: 18000, tenesice: 60000 };
  const ctx = { corp: w, stockPrice: (id) => prices[id], carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  let worst = 0;
  return {
    w, W, ctx, ch,
    days(k, each = () => {}) {
      for (let d = 0; d < k; d++) {
        const day = Math.floor(m / 1440);
        for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
        const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
        each(day, out);
        npc.nextDay(W, day, out.ext, ctx);
        const L = npc.ledgerDay(W, w, day);
        worst = Math.max(worst, Math.abs(L.days[L.days.length - 1].moved));
      }
    },
    get worst() { return worst; }
  };
}

test('株式会社YAMATO: founded on 2026-11-03 with its capital and retained earnings from アスカ\'s treasury once, its posts at their pays, ヴェルノア\'s power, gas and water companies closed into it', () => {
  const c = country();
  const { W } = c;
  const a = W.asuka, treasury = a.treasury;
  assert.equal(a.yamato, undefined);
  c.days(2);
  const Y = a.yamato, sc = a.scale;
  assert.ok(Y && Y.founded === asuka.YAMATO_DAY);
  assert.equal(Y.capital, Math.round(5.0e9 * sc));
  assert.ok(Math.abs(Y.retained - Math.round(35.0e9 * sc)) <= 1);
  assert.ok(treasury - a.treasury >= Y.capital + Y.retained - 1e9 * sc, 'out of the treasury');
  // its posts: each at its pay, no bonus
  const A = W.AP, staff = asuka.YAMATO.roles.map(() => 0);
  for (let i = 0; i < A.n; i++) if (A.job[i] === asuka.JOB.yamato) { staff[A.emp[i]]++; assert.equal(A.pay[i], asuka.YAMATO.roles[A.emp[i]][2]); }
  assert.deepEqual(staff, asuka.YAMATO.roles.map(([, n]) => Math.max(1, Math.round(n * sc))));
  assert.equal(asuka.YAMATO.roles.reduce((n, r) => n + r[1], 0), 5500);
  assert.equal(Math.round(asuka.YAMATO.roles.reduce((n, r) => n + r[1] * r[2], 0) / 5500), 2400000);
  for (const id of ['power', 'gas', 'aqua']) assert.ok(W.locals.firms[id].yamato && W.locals.firms[id].dead);
  assert.ok(c.worst <= 1000, `ledger ${c.worst}`);
});

test('YAMATO\'s bills: a household of two about three times what ヴェルノア\'s homes paid (in the plan\'s proportions of power, gas and water), dearer in inflation and good times, cheaper in deflation', () => {
  const B = asuka.YAMATO.bills, usual = (k) => B[k][0];
  assert.ok(Math.abs(usual('power') / usual('gas') - 550 / 200) < 0.1 && Math.abs(usual('power') / usual('water') - 550 / 150) < 0.2);
  const at = (pi, boom = 1) => asuka.homeBill({ macro: { pi, boom } }, 2, 0.5);
  const old = NPC.life.utilities * Math.sqrt(2);
  assert.ok(Math.abs(at(0.02) / old - 3) < 0.1, `${at(0.02)} against ${old}`);
  assert.ok(at(0.06) > at(0.02) && at(0.02) > at(-0.02));
  assert.ok(at(0.02, 1.5) > at(0.02, 1));
  assert.ok(asuka.homeBill({ macro: { pi: 0.02, boom: 1 } }, 4) > at(0.02));
});

test('a month of YAMATO: the homes of both countries, the companies\' energy, ATSUKA Vision and the research facilities pay it; its people paid without a bonus; its tax and dividends the treasury\'s; every $ kept', () => {
  const c = country(800);
  c.days(32);
  const Y = c.W.asuka.yamato;
  const by = Y.hist.reduce((o, h) => { for (const [k, v] of Object.entries(h.by)) o[k] = (o[k] || 0) + v; return o; }, { ...Y.m.rev });
  for (const k of ['vernoa:homes', 'vernoa:companies', 'asuka:homes', 'atsuka']) assert.ok(by[k] > 0, k + ' ' + JSON.stringify(by));
  const last = Y.hist[Y.hist.length - 1];
  assert.ok(last.pay > 0 && last.upkeep > 0);
  if (last.profit > 0) assert.ok(last.tax > 0 && last.dividend > 0);
  assert.equal(Y.total.emergency % asuka.YAMATO.emergency.pay, 0);
  assert.ok(c.worst <= 1000, `ledger ${c.worst}`);
});

test('テネシスリサーチ: its researchers taken on through シティーワーク ($1.6M each) at $3M–$12M, the land\'s rent to each country, its members\' fees and daily loans (kept for its five years), their developments the faster; every $ from Tenesice', () => {
  const c = country(1500);
  const { W, w } = c;
  const nation0 = W.nation.cash;
  c.days(30);
  const R = W.research, P = W.P;
  assert.ok(R && R.on && R.until === R.since + 5 * 365);
  let n = 0;
  for (let i = 0; i < P.n; i++) if (P.flags[i] & pop.FL.research) { n++; assert.ok(P.salary[i] >= 3e6 && P.salary[i] <= 12e6 * 1.1 && P.job[i] === NPC.job.other, `${P.salary[i]} ${P.job[i]}`); }
  assert.ok(n > 0 && n <= R.vernoaSites.reduce((a, b) => a + b, 0));
  assert.ok(R.feesPaid > 0 && R.feesPaid + Math.max(0, R.owed.citywork || 0) === R.hired * research.LAB.referral, `fees ${R.feesPaid}`);
  assert.ok((R.paid.landV || 0) > 0 && (R.paid.landA || 0) > 0);
  assert.ok((W.nation.month.in.landRent || W.nation.lastMonth.in.landRent || 0) > 0 || W.nation.cash !== nation0);
  // the members: their fees and loans; theirs to pay back at the end, not before
  const C = w.research;
  assert.ok(C.fees > 0 && C.lent.magita > C.lent.yosida && C.lent.yosida > C.lent.wazima);
  const loans = w.co.magita.loans.filter((l) => l.research);
  assert.ok(loans.length >= 25 && loans.every((l) => l.until === C.until));
  assert.ok(corpModel.researchMember(w, 'magita') && !corpModel.researchMember(w, 'dtrade'));
  assert.ok(c.worst <= 1000, `ledger ${c.worst}`);
});

test('テネシスファンド: a company short of money applies at the month\'s end and is lent by Tenesice (twice a fiscal year at most); a local company too, never a local bank', () => {
  const c = country(800);
  const { w, W } = c;
  c.days(3);
  // (Car Owner short of money as the month ends: what it holds beyond a little moved to ジンクス, both books balanced)
  const s = w.co.carowner, t = w.co.jinx;
  c.days(24);
  const x = Math.max(0, (s.bal.cash || 0) - 1e6);
  corpModel.post(s, [['cash', -x], ['retained', x]], 'expenses');
  corpModel.post(t, [['cash', x], ['retained', -x]], 'receipts');
  const fundLoans = () => s.loans.filter((l) => l.fund).length;
  c.days(2);
  assert.ok(fundLoans() >= 1, JSON.stringify(w.fund));
  assert.ok(w.fund.by.carowner.count <= 2);
  // a local company in trouble
  // (its money gone to the small shops' as the month ends: the local trade's money all the same)
  const f = LOCAL.firms.find((x) => x.sphere !== 'bank' && !W.locals.firms[x.id].dead && W.locals.firms[x.id].staff > 0).id;
  c.days(29);
  W.locals.firms[f].cash = -1;
  c.days(2);
  assert.ok((W.locals.firms[f].loans || []).some((l) => l.fund) || W.locals.firms[f].fund, 'the local company was lent');
  for (const x of LOCAL.firms.filter((y) => y.sphere === 'bank')) assert.ok(!(W.locals.firms[x.id].loans || []).some((l) => l.fund));
  assert.ok(c.worst <= 1000, `ledger ${c.worst}`);
});

test('the companies keep less of their money: five months of their costs, a twelfth of what is beyond it into equipment in ordinary times, a tenth more of their profit paid out', () => {
  const p = { id: 'magita', payout: 0.3 };
  assert.ok(Math.abs(corpModel.payoutOf(p, { boom: 1 }) - 0.33) < 1e-9);
  const c = country(800);
  const { w } = c;
  // (ジンクス with far more money than it keeps: Tenesice's, both books balanced)
  const x = (w.co.jinx.bal.cash || 0) * 3;
  corpModel.post(w.co.tenesice, [['cash', -x], ['retained', x]], 'expenses');
  corpModel.post(w.co.jinx, [['cash', x], ['retained', -x]], 'receipts');
  c.days(30);
  assert.ok((w.co.jinx.boomSpent || 0) > 0, 'invested in ordinary times');
  assert.ok(c.worst <= 1000, `ledger ${c.worst}`);
});
