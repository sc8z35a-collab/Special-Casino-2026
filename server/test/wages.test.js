// 賃金相場 and the companies' fight for people (server/core/npc-wages.js): the market's pay towards what the country's
// wealth carries, a step at a time; every employer's review; 引き抜き and counter-offers; the tax brackets and the
// pensions keeping up with the pay; a company with money to spare holding on to its people; every $ kept: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as wages from '../core/npc-wages.js';
import { incomeTax } from '../core/npc-state.js';
import * as local from '../core/npc-local.js';
import { NPC, RULES, CORP } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0);
const MIN = 60000;

function country(n = 900, seed = 11) {
  const key = Buffer.alloc(32, seed), ch = corpModel.chance(key);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const prices = { riru: 12000, ice: 30000, magita: 18000, tenesice: 60000, myway: 50000 };
  const ctx = { corp: w, stockPrice: (id) => prices[id], carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  let worst = 0;
  return {
    w, W, ctx, ch,
    days(k) {
      for (let d = 0; d < k; d++) {
        const day = Math.floor(m / 1440);
        for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
        const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
        npc.nextDay(W, day, out.ext, ctx);
        const L = npc.ledgerDay(W, w, day);
        worst = Math.max(worst, Math.abs(L.days[L.days.length - 1].moved));
      }
    },
    get worst() { return worst; }
  };
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

test('three months of it: the market\'s pay towards what the country\'s wealth carries, a step of at most a tenth a month; the pay of the thirteen, the civil servants and アスカ国 up with it; 引き抜き and counter-offers; every $ kept', () => {
  const c = country();
  const { W } = c;
  const P = W.P, payOf = () => { const x = []; for (let i = 0; i < P.n; i++) if (P.salary[i] > 0) x.push(P.salary[i]); return mean(x); };
  const before = payOf();
  c.days(92);
  const S = W.wage, v = wages.view(W);
  assert.ok(S && S.hist.length >= 3, 'three reviews');
  // (the aim: the people's money a head over ten years of the pay of then — far above it in this country)
  assert.ok(S.aim > 2, `aim ${S.aim}`);
  for (let k = 1; k < S.hist.length; k++) assert.ok(S.hist[k].idx <= S.hist[k - 1].idx * (1 + wages.WAGE.up) + 1e-6);
  assert.ok(S.idx > 1.2 && S.idx <= Math.pow(1 + wages.WAGE.up, S.hist.length) + 1e-6, String(S.idx));
  assert.ok(payOf() > before * 1.15, `${payOf()} ${before}`);
  // (each of the thirteen near its market's pay; the civil servants behind it; アスカ国's own market)
  for (const [id, x] of Object.entries(v.companies)) assert.ok(x.avg > 0 && x.market > 0, id);
  assert.ok(v.civil && v.civil.avg > 0);
  assert.ok(v.asuka && v.asuka.idx > 1);
  // (the companies short of people took others' people, and the others held some of theirs)
  assert.ok(S.poach.total > 0, 'some poached');
  assert.ok(c.worst <= 1000, `ledger ${c.worst}`);
});

test('the tax brackets and the deductions keep up with the market\'s pay: everyone\'s pay doubled, everyone\'s tax doubled — no more', () => {
  const at = (k, gross) => incomeTax({ nation: { knobs: {} }, wage: { idx: k } }, gross, gross * 0.15);
  for (const g of [3e6, 8e6, 25e6]) {
    const one = at(1, g), two = at(2, g * 2);
    assert.ok(Math.abs(two.tax - one.tax * 2) <= 2, `${g}: ${one.tax} ${two.tax}`);
    assert.ok(Math.abs(two.resident - one.resident * 2) <= 2);
  }
  // (without the index, the same doubled pay would have paid more than twice the tax: bracket creep)
  assert.ok(at(1, 16e6).tax > at(1, 8e6).tax * 2);
});

test('引き抜き: a company short of people takes another\'s at a premium over their pay, or the other holds them with a counter-offer', () => {
  const c = country(900, 12);
  const { W, ctx } = c;
  c.days(3);
  const P = W.P;
  // (MAGITA short of people for days, the others' people long enough at work)
  W.lab.short = { ...(W.lab.short || {}), magita: 10 };
  W.lab.openings = [{ company: 'magita', left: 120, pay: ctx.corp.co.magita.pay, site: 'citywork' }];
  for (let i = 0; i < P.n; i++) if (NPC.companyOf(P.job[i])) { P.tenure[i] = 24; P.jsat[i] = 90; }
  const seq = [];
  let k = 0;
  const r = { u: () => { k = (k * 9301 + 49297) % 233280; return k / 233280; }, int: (n) => Math.floor(r.u() * n), z: () => 0, weighted: () => 0 };
  const hired = [];
  wages.poach(W, W.day, r, ctx, (W2, i, o) => { hired.push([i, P.salary[i], NPC.companyOf(P.job[i])]); P.job[i] = NPC.jobOf(o.company); seq.push(i); });
  const S = W.wage.poach;
  assert.ok(S.m.n + S.m.countered > 0, JSON.stringify(S.m));
  for (const [i, was, from] of hired) {
    assert.notEqual(from, 'magita');
    assert.ok(P.salary[i] > was, 'at a premium');
    assert.equal(NPC.companyOf(P.job[i]), 'magita');
  }
});

test('運営\'s screens as the country is: its GDP not against a 30 days before it had them; a meeting never cuts again within weeks; the local companies\' pay as their people are paid', () => {
  const c = country(700, 13);
  const { W } = c;
  c.days(34);
  // (a country of 34 days: its last 30 against the four before — part of its first day — is no comparison)
  const g = npc.gdpView(W);
  assert.equal(g.vernoa.pace.growth, null);
  // (a restructuring passed: no cut on the tables for 45 days)
  for (const o of Object.values(W.orgs)) {
    const cuts = W.meetings.filter((m) => m.company === o.id && m.kind === 'cut' && m.pass).map((m) => m.day).sort((a, b) => a - b);
    for (let k = 1; k < cuts.length; k++) assert.ok(cuts[k] - cuts[k - 1] >= 45, `${o.id} ${cuts}`);
  }
  // (each local company's 年収 its people's, not the rules' starting pay)
  const v = local.view(W), P = W.P;
  for (const f of v.firms) {
    const pays = [];
    for (let i = 0; i < P.n; i++) if (P.firm[i] === f.no && P.salary[i] > 0) pays.push(P.salary[i]);
    if (pays.length) assert.equal(f.pay, Math.round(mean(pays)), f.id);
  }
});
