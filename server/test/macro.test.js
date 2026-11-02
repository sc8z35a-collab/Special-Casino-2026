// The times' mood and the prices (server/core/npc-macro.js), and what they do: the people spend more in a boom and
// keep it in a bust, the companies put their spare money into equipment in a boom (never a bank's depositors' money),
// Tenesice moves its rates a step a month by its rule; and the people's market never sells more than one has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import { macroDay, boomOf, moodName } from '../core/npc-macro.js';
import { budgetOf } from '../core/npc-state.js';
import { rateReview, policyRate } from '../core/npc-org.js';
import { LISTED_IDS } from '../core/npc-market.js';
import { NPC, RULES } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0), MIN = 60000;
const country0 = () => ({ nation: { knobs: { inflation: 2 } }, stats: { economy: 1, unemployment: 0.02, debt: 1e9 }, bankRates: { person: 0.04 } });

test('the mood: spending running ahead, a rising market and cheap money make a boom (and the prices rise faster); it tires, and dear money and falling spending turn it to a bust (and the prices fall)', () => {
  const W = country0();
  let px = 10000;
  const ctx = { stockPrice: () => px };
  for (let d = 0; d < 150; d++) { W.stats.economy = 1.25; px *= 1.004; macroDay(W, d, ctx); }
  const up = W.macro;
  assert.ok(up.mood > 0.3 && boomOf(W) > 1.15, JSON.stringify(up.parts));
  assert.ok(['好景気', 'バブル'].includes(moodName(up.mood)));
  assert.ok(W.cpi > 1 + 0.02 * 150 / 365, `${W.cpi}`);
  assert.ok(up.expInfl > 0.02 && W.rentIdx > W.cpi);
  // (held up long enough, it tires of itself: lower than at its height with nothing else changed)
  const peak = Math.max(...up.hist.map((h) => h.mood));
  for (let d = 150; d < 400; d++) { px *= 1.0005; macroDay(W, d, ctx); }
  assert.ok(W.macro.mood < peak, `${W.macro.mood} < ${peak}`);
  // dear money, spending falling behind, the market falling: a bust, and the prices falling
  W.bankRates.person = 0.14;
  for (let d = 400; d < 700; d++) { W.stats.economy = 0.75; W.stats.unemployment = 0.02 + (d - 400) / 6000; px *= 0.997; macroDay(W, d, ctx); }
  assert.ok(W.macro.mood < -0.3 && boomOf(W) < 0.9, JSON.stringify(W.macro.parts));
  assert.ok(W.macro.pi < 0, `${W.macro.pi}`);
  // (a bust takes less away than a boom adds: what one needs is bought all the same)
  assert.ok(boomOf(W) > Math.exp(0.5 * W.macro.mood));
});

test('a person\'s month in a boom and in a bust: more of what comes in and of what they have spent, more on the casino, pleasures and the market in a boom; less of all of it in a bust', () => {
  const key = Buffer.alloc(32, 31), launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0 });
  const W = npc.boot(key, START, w, { n: 400 });
  const P = W.P, day = Math.floor(START / 86400000);
  // (the bold who follow the news: the times carry them)
  let i = -1;
  for (let k = 0; k < P.n; k++) if (P.salary[k] > 0 && P.cash[k] > 1e6 && P.tr[k * 18 + 5] > 150) { i = k; break; }
  if (i < 0) for (let k = 0; k < P.n; k++) if (P.salary[k] > 0 && P.cash[k] > 1e6) { i = k; break; }
  assert.ok(i >= 0);
  const at = (boom) => {
    W.macro = { boom, mood: Math.log(boom) / 0.5 };
    budgetOf(W, i, 40, null);
    return { budget: P.budget[i], casino: P.fund[i * 4], leisure: P.fund[i * 4 + 2], invest: P.fund[i * 4 + 3] };
  };
  const calm = at(1), boom = at(1.5), bust = at(0.75);
  assert.ok(boom.budget > calm.budget && calm.budget > bust.budget, JSON.stringify({ calm, boom, bust }));
  assert.ok(boom.leisure > calm.leisure && boom.invest >= calm.invest && boom.casino >= calm.casino);
  assert.ok(bust.invest <= calm.invest && bust.leisure < calm.leisure);
  void day;
});

test('Tenesice\'s rates: each month a step of up to a point toward its rule (high inflation: up; a slump and falling prices: down to nothing), the クイックローン its people\'s rate and a spread', () => {
  const W = { nation: { knobs: { inflation: 2 } }, stats: { inflation: 0.12, economy: 1.2 }, bankRates: { person: 0.025, auto: 0.02, deposit: 0.002, spread: 0.153 }, macro: { pi: 0.14, mood: 0.5 }, P: { n: 0 }, news: [] };
  assert.ok(policyRate(W) > 0.15);
  const r = rateReview(W, 1);
  assert.equal(r.to, 0.035);
  assert.equal(W.bankRates.auto, 0.03);
  assert.equal(W.bankRates.quick, Math.round((0.035 + W.bankRates.spread) * 1000) / 1000);
  assert.ok(W.news.length === 1 && /金利を改定/.test(W.news[0].text));
  W.stats = { inflation: -0.05, economy: 0.7 }; W.macro = { pi: -0.04, mood: -0.7 };
  for (let k = 0; k < 6; k++) rateReview(W, 2 + k);
  assert.equal(W.bankRates.person, 0);
});

test('the people\'s market: one person\'s several sell orders together never sell more than they hold (nor buys spend more than they have) — no holding below nothing', () => {
  const key = Buffer.alloc(32, 32), launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0 });
  const W = npc.boot(key, START, w, { n: 300 });
  const P = W.P, L = LISTED_IDS.length, k = 0, id = LISTED_IDS[k], price = 10000;
  const seller = 5, buyer = 6;
  P.sh[seller * L + k] = 10;
  P.cash[buyer] = 1e9;
  const book = W.marketState.book[id];
  book.sell.push([seller, 8, price], [seller, 8, price], [seller, 8, price]);
  book.buy.push([buyer, 50, price], [buyer, 50, price]);
  W.market.auction(W, Math.floor(START / MIN), { stockPrice: (x) => (x === id ? price : 0) });
  assert.equal(P.sh[seller * L + k], 0);
  assert.equal(P.sh[buyer * L + k] - 0 >= 10, true);
  assert.ok(P.cash[buyer] >= 0 && P.sh.every((x) => x >= 0));
});

test('in a boom the companies put their spare money into equipment at the month\'s end (their own money only: never a bank\'s depositors\'), pay out more of their profit; the money ledger never moves', () => {
  const key = Buffer.alloc(32, 33), ch = corpModel.chance(key), launch = Math.floor(START / 86400000), n = 800;
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const ctx = { corp: w, stockPrice: () => 10000, carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  // (the times held at a boom)
  macroDay(W, launch, ctx);
  const was = new Map(W.staffOf('myway').map((i) => [i, W.P.salary[i]]));
  for (let d = 0; d < 32; d++) {
    const day = Math.floor(m / 1440);
    for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
    W.macro.boom = 1.5; W.macro.mood = 0.81;
    const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
    npc.nextDay(W, day, out.ext, ctx);
    npc.ledgerDay(W, w, day);
  }
  assert.equal(w.boom, 1.5);
  const spent = Object.values(w.co).filter((s) => (s.boomSpent || 0) > 0);
  assert.ok(spent.length >= 3, spent.map((s) => s.id).join(','));
  assert.ok(!w.co.tenesice.boomSpent);
  for (const s of spent) assert.ok(s.boomSpent <= Math.max(0, corpModel.equityOf(s)) * 0.1 * 2);
  // (more of the profit paid out in a boom, less in a bust; MY WAY's its philosophy's whatever the times)
  const p = { id: 'magita', payout: 0.3 };
  assert.ok(corpModel.payoutOf(p, { boom: 1.5 }) > 0.3 && corpModel.payoutOf(p, { boom: 0.8 }) < 0.3);
  assert.equal(corpModel.payoutOf({ id: 'myway', payout: 0.9 }, { boom: 0.7 }), 0.9);
  // MY WAY raises its people's pay the faster in a boom (at the month's start, each a little differently)
  const still = W.staffOf('myway').filter((i) => was.has(i));
  assert.ok(still.length > 0 && still.filter((i) => W.P.salary[i] > was.get(i)).length >= still.length * 0.8);
  assert.ok(new Set(still.map((i) => Math.round(W.P.salary[i] / was.get(i) * 1000))).size > 3);
  assert.equal(W.ledger.drift, 0);
});
