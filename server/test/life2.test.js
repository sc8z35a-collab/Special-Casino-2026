// 新しい暮らしの決まり (js/game/npc.js NPC.life2, docs/npc-rooms-plan.md): lives begin at 18 and end by 62 (60 on
// average), everyone of 18 to 59 works (nobody studies or keeps house), all retire at 60 — in both countries, for a new
// country from its start (W.life2): npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as pop from '../core/npc-pop.js';
import * as asuka from '../core/asuka.js';
import { obliged } from '../core/npc-life.js';
import { NPC, RULES } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0); // a Monday, 11:00 in Japan
const MIN = 60000;
const L = NPC.life2;

function country(n = 1500) {
  const key = Buffer.alloc(32, 7), ch = corpModel.chance(key);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / NPC.nation.population);
  const prices = { riru: 12000, ice: 30000, magita: 18000, tenesice: 60000 };
  const ctx = { corp: w, stockPrice: (id) => prices[id], carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  return {
    w, W,
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

test('the chances: nothing of age below 58, a year\'s chance of its own to 61, certain at 62; 60 years on average', () => {
  assert.equal(NPC.lateDeath(30), 0);
  assert.equal(NPC.lateDeath(57), 0);
  assert.equal(NPC.lateDeath(62), 1);
  assert.equal(NPC.lateDeath(70), 1);
  for (let a = 58; a < 61; a++) assert.ok(NPC.lateDeath(a) > 0 && NPC.lateDeath(a) < NPC.lateDeath(a + 1));
  // (a year of a day's chance comes to the year's)
  assert.ok(Math.abs(1 - Math.pow(1 - NPC.lateDeath(60), 365) - L.yearly[2]) < 1e-9);
  // the average life from 18: the illnesses' small part below 58 (npc-state.js, at an average 健康度), then the year's
  // chances
  let alive = 1, sum = 0;
  for (let a = 18; a < 62; a++) { const q = a < L.from ? 5.3e-5 * Math.exp(0.085 * a) : L.yearly[a - L.from]; sum += alive * q * (a + 0.5); alive *= 1 - q; }
  sum += alive * 62;
  assert.ok(Math.abs(sum - L.mean) < 0.1, `on average ${sum}`);
});

test('a new country: everyone 18 to 61, nobody studies or keeps house, all of working age at work or looking, the rest retired', () => {
  const c = country(1500);
  const P = c.W.P, day = c.W.day;
  assert.equal(c.W.life2, true);
  let work = 0, sumAge = 0;
  for (let i = 0; i < P.n; i++) {
    const a = pop.ageOf(P, i, day), j = P.job[i];
    sumAge += a;
    assert.ok(a >= L.adult && a < L.max, `age ${a}`);
    assert.notEqual(j, NPC.job.student);
    assert.notEqual(j, NPC.job.home);
    assert.equal(P.flags[i] & pop.FL.student, 0);
    if (a >= L.retire) assert.equal(j, NPC.job.retired, `${a} retired`);
    else { assert.notEqual(j, NPC.job.retired, `${a} at work`); work++; }
  }
  // (most are of working age: lives end around 60)
  assert.ok(work / P.n > 0.9, `${work} of ${P.n} at work`);
  assert.ok(sumAge / P.n > 35 && sumAge / P.n < 42);
  // アスカ国 the same
  const A = c.W.AP;
  for (let i = 0; i < A.n; i++) {
    const a = asuka.ageOf(A, i, day);
    assert.ok(a >= L.adult && a < L.max, `アスカ ${a}`);
    assert.notEqual(A.job[i], asuka.JOB.student);
    if (a >= L.retire) assert.equal(A.job[i], asuka.JOB.retired);
  }
});

test('the days: nobody reaches 62, a new life begins at 18 looking for work, the people as many; at 60 everyone retires', () => {
  const c = country(1500);
  const W = c.W, P = W.P, A = W.AP;
  // (some a day short of 62, some a day short of 60 and at work)
  const old = [], sixty = [];
  for (let i = 0; i < P.n && (old.length < 20 || sixty.length < 20); i++) {
    if (old.length < 20 && i % 3 === 0) { P.birth[i] = W.day - Math.ceil(62 * 365.25) + 1; old.push([i, P.gen[i]]); }
    else if (sixty.length < 20 && NPC.working(P.job[i]) && !(P.flags[i] & (pop.FL.exec | pop.FL.mayor))) { P.birth[i] = W.day - 60 * 365.25 + 1; sixty.push([i, P.gen[i]]); }
  }
  const aOld = [];
  for (let i = 0; i < 20; i++) { A.birth[i] = W.day - Math.ceil(62 * 365.25) + 1; aOld.push([i, A.gen[i]]); }
  c.days(3);
  for (const [i, gen] of old) {
    assert.notEqual(P.gen[i], gen, 'a life at 62 has ended');
    assert.equal(pop.ageOf(P, i, W.day), 18);
    assert.notEqual(P.job[i], NPC.job.student);
  }
  for (const [i, gen] of sixty) if (P.gen[i] === gen) assert.equal(P.job[i], NPC.job.retired, 'retired at 60');
  for (let i = 0; i < P.n; i++) assert.ok(pop.ageOf(P, i, W.day) < L.max);
  for (const [i, gen] of aOld) { assert.notEqual(A.gen[i], gen); assert.notEqual(A.job[i], asuka.JOB.student); }
  for (let i = 0; i < A.n; i++) assert.ok(asuka.ageOf(A, i, W.day) < L.max);
  assert.equal(P.n, 1500);
  // (nobody kept on after 60)
  for (let i = 0; i < P.n; i++) assert.equal(P.flags[i] & pop.FL.rehired, 0);
});

test('the working day: four of the people\'s hours — forty minutes of each at work, twenty a break —; the companies at their capacity', () => {
  const c = country(1500);
  const W = c.W, P = W.P, D = L.workDay, wk = NPC.hours.weekday;
  // (a weekday: an office's person from the people's start)
  const day = W.day + 2, i = Array.from({ length: P.n }, (_, k) => k).find((k) => NPC.companyOf(P.job[k]) === 'citywork');
  let work = 0, rest = 0;
  for (let t = wk[0]; t < wk[1]; t++) { const o = obliged(W, i, t, false, day, 3); if (o.kind === 'work') work++; else if (o.kind === 'break') rest++; }
  assert.equal(work, D.hours * D.work);
  assert.equal(rest, D.hours * (60 - D.work));
  assert.equal(obliged(W, i, wk[0] + 45, false, day, 3).kind, 'break');
  assert.equal(obliged(W, i, wk[0] + D.hours * 60, false, day, 3).kind, 'free');
  // (a day off: none)
  assert.equal(obliged(W, i, wk[0] + 10, true, day, 6).kind, 'free');
  // (to a weekday's close: 11/3 is 文化の日, the offices shut)
  c.days(3);
  for (const id of ['tenesice', 'jinx', 'citywork']) assert.ok(W.capacity[id] >= 0.6 && W.capacity[id] <= 1.1, `${id} ${W.capacity[id]}`);
});

test('the five hours: kept so, the people are about from 17:00 to 22:00 every day, and work from 17:00 to 21:00', () => {
  const win = NPC.hours.window, at = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);
  assert.ok(!NPC.activeAt(at(2026, 11, 4, 16, 59), null, win));
  assert.ok(NPC.activeAt(at(2026, 11, 4, 17), null, win));
  assert.ok(!NPC.activeAt(at(2026, 11, 4, 22), null, win));
  assert.ok(!NPC.activeAt(at(2026, 11, 7, 10), null, win), 'a Saturday morning too');
  assert.equal(NPC.nextActive(at(2026, 11, 4, 23), null, win), at(2026, 11, 5, 17));
  const c = country(1500), W = c.W, P = W.P;
  W.hoursWin = win;
  const i = Array.from({ length: P.n }, (_, k) => k).find((k) => NPC.companyOf(P.job[k]) === 'citywork');
  assert.equal(obliged(W, i, 16 * 60 + 30, false, W.day + 2, 3).kind, 'free');
  assert.equal(obliged(W, i, 17 * 60 + 5, false, W.day + 2, 3).kind, 'work');
  assert.equal(obliged(W, i, 20 * 60 + 50, false, W.day + 2, 3).kind, 'break');
  assert.equal(obliged(W, i, 21 * 60 + 5, false, W.day + 2, 3).kind, 'free');
});
