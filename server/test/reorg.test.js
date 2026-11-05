// 人口の再編 (server/core/npc-reorg.js, docs/npc-rooms-plan.md 8章): a country kept from before brought under the new
// rules once — those of 62 and over gone, its people brought down by whole households, アスカ国 to twice as many, every
// reference to a person renumbered with them, the money that left told to the ledger: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as pop from '../core/npc-pop.js';
import * as asuka from '../core/asuka.js';
import { reorganize } from '../core/npc-reorg.js';
import { seeded } from '../core/npc-rand.js';
import { NPC, RULES } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0); // a Monday, 11:00 in Japan
const MIN = 60000;
const L = NPC.life2;

function country(n = 1600) {
  const key = Buffer.alloc(32, 9), ch = corpModel.chance(key);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / NPC.nation.population);
  const prices = { riru: 12000, ice: 30000, magita: 18000, tenesice: 60000 };
  const ctx = { corp: w, stockPrice: (id) => prices[id], carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  return {
    w, W, ctx, ch,
    days(k) {
      for (let d = 0; d < k; d++) {
        const day = Math.floor(m / 1440);
        for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
        const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
        npc.nextDay(W, day, out.ext, ctx);
      }
    }
  };
}
// a country as one kept from before the new rules: some of 62 and over, some at their studies
function oldCountry() {
  const c = country(1600);
  c.days(2);
  const W = c.W, P = W.P, A = W.AP;
  W.life2 = false;
  for (let i = 0; i < P.n; i += 4) P.birth[i] = W.day - Math.ceil((63 + (i % 20)) * 365.25);
  for (let i = 1; i < P.n; i += 50) if (P.job[i] === NPC.job.none) { P.job[i] = NPC.job.student; P.flags[i] |= pop.FL.student; }
  for (let i = 0; i < A.n; i += 5) A.birth[i] = W.day - Math.ceil(70 * 365.25);
  return c;
}
const sharesOf = (P) => { const t = [0, 0, 0, 0]; for (let i = 0; i < P.n; i++) for (let k = 0; k < pop.LISTED; k++) t[k] += P.sh[i * pop.LISTED + k]; return t; };

test('the 人口再編: those of 62 and over gone, the people down to the target by households, アスカ国 twice as many, every reference in range', () => {
  const c = oldCountry();
  const W = c.W, day = W.day, before = npc.moneyOf(W, c.w), shares = sharesOf(W.P), wasA = W.AP.n;
  const done = reorganize(W, c.w, day, seeded(W.key, 'test-reorg'), { vernoa: 900 });
  const P = W.P, A = W.AP;
  assert.ok(done && W.life2);
  assert.equal(P.n, 900);
  assert.equal(W.n, 900);
  assert.equal(A.n, Math.min(1800, wasA));
  assert.equal(W.asuka.n, A.n);
  // (the money left with them and the countries' own cut as their people: told to the ledger, nothing else moved)
  assert.equal(npc.moneyOf(W, c.w), before - done.out);
  assert.ok(done.people > 0 && done.state > 0);
  // (their shares stayed in the country)
  assert.deepEqual(sharesOf(P), shares);
  const ok = (i) => i === -1 || (Number.isInteger(i) && i >= 0 && i < P.n);
  for (let i = 0; i < P.n; i++) {
    const a = pop.ageOf(P, i, day);
    assert.ok(a >= L.adult && a < L.max, `age ${a}`);
    for (const k of ['hh', 'hnext', 'spouse', 'host']) assert.ok(ok(P[k][i]), `${k} ${P[k][i]}`);
    for (let x = i * pop.REL; x < i * pop.REL + pop.REL; x++) assert.ok(ok(P.rel[x]));
    if (P.spouse[i] >= 0) assert.equal(P.spouse[P.spouse[i]], i);
    if (P.hh[i] >= 0) assert.ok(pop.memberList(P, P.hh[i]).includes(i), 'in their household');
  }
  for (let i = 0; i < A.n; i++) { const a = asuka.ageOf(A, i, day); assert.ok(a >= L.adult && a < L.max); }
  for (const o of Object.values(W.orgs)) {
    for (const i of [o.ceo, o.president, ...o.officers]) assert.ok(ok(i));
    for (const d of o.depts) { assert.ok(ok(d.head)); for (const i of d.managers) assert.ok(ok(i)); for (const i of Object.values(d.named)) assert.ok(ok(i)); }
    for (const v of o.ventures) { assert.ok(ok(v.lead)); for (const i of v.staff) assert.ok(ok(i)); }
  }
  for (const d of W.districts) assert.ok(ok(d.mayor));
  for (const u of Object.values(W.lab.unions)) assert.ok(ok(u.rep));
  for (const list of Object.values(W.priv)) for (const h of list) assert.ok(ok(h[0]) && h[0] >= 0);
  if (W.alpha) for (const m of W.alpha.members) assert.ok(ok(m.i) && m.i >= 0);
  if (W.marketState) for (const b of Object.values(W.marketState.book)) for (const o of [...b.buy, ...b.sell]) assert.ok(ok(o[0]) && o[0] >= 0);
  assert.ok(ok(W.richest) && W.richest >= 0);
  // (the companies smaller with the country; the five cut to their new numbers)
  assert.equal(c.w.co.tenesice.target, Math.max(1, Math.round(NPC.reorg.staff.tenesice * W.scale)));
  // once only
  assert.equal(reorganize(W, c.w, day, seeded(W.key, 'again')), null);
});

test('after the 人口再編 the country lives on by the new rules: the ledger keeps, nobody reaches 62, nobody studies', () => {
  const c = oldCountry();
  const W = c.W;
  npc.ledgerDay(W, c.w, W.day);
  reorganize(W, c.w, W.day, seeded(W.key, 'test-reorg'), { vernoa: 900 });
  c.days(3);
  const L2 = npc.ledgerDay(W, c.w, W.day);
  assert.ok(Math.abs(L2.drift) <= 1000, `the ledger drifted ${L2.drift}`);
  const P = W.P;
  assert.equal(P.n, 900);
  for (let i = 0; i < P.n; i++) {
    assert.ok(pop.ageOf(P, i, W.day) < L.max);
    assert.notEqual(P.job[i], NPC.job.student);
    assert.notEqual(P.job[i], NPC.job.home);
    if (pop.ageOf(P, i, W.day) >= L.retire) assert.ok(!NPC.working(P.job[i]), 'nobody works after 60');
  }
  for (let i = 0; i < W.AP.n; i++) { assert.notEqual(W.AP.job[i], asuka.JOB.student); if (asuka.ageOf(W.AP, i, W.day) >= L.retire) assert.equal(W.AP.job[i], asuka.JOB.retired); }
});
