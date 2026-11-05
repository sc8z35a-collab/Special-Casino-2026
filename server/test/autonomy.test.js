// What the companies and the country decide themselves (no knob of 運営's, no range): the fees, the loans' rates,
// the pay; a company short of people takes them from where they are; MY WAY's philosophy — its people first, little
// kept, its economy supported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import { NPC, CORP, RULES, LOCAL } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0), MIN = 60000;
function country(n = 3000, seed = 11) {
  const key = Buffer.alloc(32, seed), ch = corpModel.chance(key), launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const ctx = { corp: w, stockPrice: () => 10000, carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  return {
    w, W, ctx,
    days(k) {
      for (let d = 0; d < k; d++) {
        const day = Math.floor(m / 1440);
        for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
        const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
        npc.nextDay(W, day, out.ext, ctx);
        npc.ledgerDay(W, w, day);
      }
    }
  };
}

test('a country where everyone works: the companies short of people take them from the small shops, those at home and the able retired — MY WAY and WAZIMA fill up; MY WAY supports its economy and raises its people\'s pay; the ledger never moves', () => {
  const c = country(3000), { W, w } = c;
  const fill = (id) => W.staffOf(id).length / Math.max(1, w.co[id].target || w.co[id].n);
  const before = { myway: fill('myway'), wazima: fill('wazima') };
  const was = new Map(W.staffOf('myway').map((i) => [i, W.P.salary[i]]));
  c.days(95);
  // (by the new rules — everyone of 18 to 59 at work: NPC.life2 — a company may be full from the start: it stays so)
  assert.ok(fill('myway') >= Math.min(before.myway, 0.9) && fill('myway') >= 0.9, `${before.myway} → ${fill('myway')}`);
  assert.ok(fill('wazima') >= Math.min(before.wazima, 0.9), `${before.wazima} → ${fill('wazima')}`);
  // (the local companies too: most of them near their targets)
  // (the small ones, in a country where hardly anyone is out of work, together most of the way: their people's pay
  // below the big ones', some of them taken by them)
  const firms = Object.values(W.locals.firms).filter((x) => !x.dead);
  // (HACHI too, from 2026-11-04: its 1,875 posts — 3.75% of the people — out of a country already at work; it takes
  // nobody of theirs itself, but those it takes the others would have: the local companies about half way)
  const staff = firms.reduce((a, x) => a + x.staff, 0), target = firms.reduce((a, x) => a + x.target, 0);
  assert.ok(staff >= target * 0.4, `${staff}/${target}`);
  // MY WAY: its support to its economy's local companies, their targets growing; its people's pay never down
  const mw = w.co.myway;
  assert.ok(mw.sphereGiven > 0 && (mw.per.y.sSupport || 0) > 0);
  const sphere = LOCAL.firms.filter((f) => f.sphere === 'myway');
  assert.ok(sphere.some((f) => W.locals.firms[f.id].target > Math.round(f.staff * W.P.n / NPC.nation.population)));
  assert.ok(sphere.every((f) => (W.locals.firms[f.id].last || {}).support >= 0));
  // (those who were there: never paid less — those it took on since, at what it offered; raised as its sales grow and
  // in a boom: server/test/macro.test.js)
  const still = W.staffOf('myway').filter((i) => was.has(i));
  assert.ok(still.length > 0 && still.every((i) => W.P.salary[i] >= was.get(i)));
  assert.equal(W.ledger.drift, 0);
  // (its payout: its philosophy's)
  assert.ok(mw.guide && Math.abs(mw.div.total / Math.max(1, mw.guide.net) - CORP.myway.philosophy.payout) < 0.01);
});

test('Dtrade and the job sites set their own fees by how they do (no range); Tenesice its quick loans\' rate by those who fall behind', () => {
  const key = Buffer.alloc(32, 12), launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0 });
  corpModel.startCirculation(w, launch, 1);
  const s = w.co.dtrade, p = CORP.company('dtrade');
  // (three months far short of its plan (61%): a step up; three far over it: a step down)
  s.mHist = [{ sales: 1e9, op: -1e8 }, { sales: 1e9, op: -1e8 }, { sales: 1e9, op: -1e8 }];
  const out = { news: [] };
  corpModel.feesMonth(w, s, p, launch, out);
  const up = corpModel.feesOf(w);
  assert.ok(up.winFee > 0.06 && up.exchangeFee > 40000 && up.tradeFee > 0.018);
  s.mHist = [{ sales: 1e9, op: 9.6e8 }, { sales: 1e9, op: 9.6e8 }, { sales: 1e9, op: 9.6e8 }];
  corpModel.feesMonth(w, s, p, launch + 30, out);
  const down = corpModel.feesOf(w);
  assert.ok(down.winFee < up.winFee && down.exchangeFee < up.exchangeFee);
  assert.equal(down.jobFee, 0.25);
  // (no range: a struggling Dtrade keeps raising them, a share never past all of it)
  s.mHist = [{ sales: 1e9, op: -1e8 }, { sales: 1e9, op: -1e8 }, { sales: 1e9, op: -1e8 }];
  for (let k = 0; k < 120; k++) corpModel.feesMonth(w, s, p, launch + 60 + k * 30, out);
  assert.ok(corpModel.feesOf(w).winFee > 0.5 && corpModel.feesOf(w).winFee < 1);
  // Tenesice: its people's rate and the spread it keeps for the risk
  const W = { bankRates: { person: 0.03, auto: 0.025, deposit: 0.002 } };
  assert.equal(Math.round(npc.econ.quickRate(W) * 1000), 183);
  W.bankRates.spread = 0.2;
  assert.equal(Math.round(npc.econ.quickRate(W) * 1000), 230);
});
