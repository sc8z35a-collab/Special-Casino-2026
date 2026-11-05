// 心 (server/core/npc-heart.js, docs/ai-economy-plan.md 11.3): what the people feel, expect and have learnt, and what
// it does to what they buy — checked as scenes (賢さを測るテスト): a bigger budget is spent, a blow to one's sense of
// oneself is made up for with status, a big loss at the slots teaches (most of them), a rumour spreads, dearer times
// feared stock the shelves at home and then the buying stops, a spree put on a loan is regretted, a bonus is a treat,
// the habit of a month's spending is hard to come down from, today's plan, a country kept before the mind is given it,
// アスカ's 消費観 and its local trade standing in for missing branches, and a country read back finds its owners again;
// every $ still from someone to someone: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as pop from '../core/npc-pop.js';
import * as heart from '../core/npc-heart.js';
import * as state from '../core/npc-state.js';
import * as asuka from '../core/asuka.js';
import { act, talk, M } from '../core/npc-life.js';
import { NPC, RULES } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0);
const MIN = 60000;
const DAY = Math.floor(START / 86400000);
const { T, E, E2, NE2, BL, NB, LS, NL, NT, REL } = pop;

function country(n = 400, seed = 7) {
  const key = Buffer.alloc(32, seed), ch = corpModel.chance(key);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
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
        npc.ledgerDay(W, w, day);
      }
    },
    money() { return npc.moneyOf(W, w); }
  };
}
// a draw that is always the middle (the scenes are the person's, not luck's)
const even = { u: () => 0.5, int: () => 0, poisson: () => 0, z: () => 0, byte: () => 128, weighted: () => 0, pick: (a) => a[0] };
const setTrait = (P, i, k, v) => { P.tr[i * NT + k] = v; };
const tend = (P, i, k) => heart.tendency(P, i, k);
// a person with money and no household quarrels: the first adult with some cash
function someone(W, test = () => true) {
  const P = W.P;
  for (let i = 0; i < P.n; i++) if (P.cash[i] > 50000000 && P.home[i] !== pop.HOME.street && test(i)) return i;
  throw new Error('nobody fits');
}

test('a bigger budget is spent: twice the month\'s pleasures, about twice what a shopping trip spends — the rest beyond the everyday goods on the dear things', () => {
  const { W, ctx } = country();
  const P = W.P, i = someone(W), m = Math.floor(START / MIN) + 600, day = DAY;
  const trip = (fund) => {
    P.fund[i * 4 + 2] = fund;
    P.wind[i] = 0;
    P.cash[i] = 500000000;
    act(W, 'shop', i, m, day, even, ctx);
    return 500000000 - P.cash[i];
  };
  const one = trip(W.cal.leisure * 2), two = trip(W.cal.leisure * 4);
  assert.ok(one > 0, 'a trip buys something');
  assert.ok(two > one * 1.6, `twice the fund: ${one} → ${two}`);
});

test('a blow to one\'s sense of oneself: losing one\'s work lowers it at once, and the vain make up for it with a bigger month (代償消費); worry keeps the careful\'s smaller', () => {
  const { W } = country();
  const P = W.P, i = someone(W);
  setTrait(P, i, T.vanity, 250); setTrait(P, i, T.neuro, 230); setTrait(P, i, T.ambition, 230);
  P.emo2[i * NE2 + E2.esteem] = 150;
  P.emo[i * 5 + E.anxiety] = 60;
  P.ref[i] = 0;
  const before = heart.budgetMind(W, i, 1000000).b;
  const esteem = P.emo2[i * NE2 + E2.esteem];
  pop.remember(P, i, DAY, M.fired, 200);
  assert.ok(P.emo2[i * NE2 + E2.esteem] < esteem - 50, 'fired: one thinks less of oneself');
  const after = heart.budgetMind(W, i, 1000000).b;
  assert.ok(after > before * 1.3, `a vain one spends to be seen: ${before} → ${after}`);
  P.emo[i * 5 + E.anxiety] = 255;
  setTrait(P, i, T.neuro, 0); setTrait(P, i, T.news, 0);
  P.emo2[i * NE2 + E2.esteem] = 150;
  assert.ok(heart.budgetMind(W, i, 1000000).b < 1000000, 'the worried keep their money');
});

test('a big loss at the slots teaches: the next night the slots are learnt to lose; the chasers learn less', () => {
  const { W } = country();
  const P = W.P, a = someone(W), b = someone(W, (k) => k !== a);
  setTrait(P, a, T.gamble, 120); setTrait(P, b, T.gamble, 250);
  setTrait(P, a, T.learn, 200); setTrait(P, b, T.learn, 200);
  for (const i of [a, b]) { P.lesson.fill(0, i * NL, i * NL + NL); pop.remember(P, i, DAY, M.bigLoss, 200); }
  heart.day(W, DAY + 1, even);
  const la = P.lesson[a * NL + LS.gamble], lb = P.lesson[b * NL + LS.gamble];
  assert.ok(la < -10, `the careful one learnt: ${la}`);
  assert.ok(lb > la, `the chaser less: ${lb} against ${la}`);
});

test('a rumour spreads: one who expects dearer times tells a trusted friend, and one stocking up makes them fear it the more', () => {
  const { W } = country();
  const P = W.P, i = someone(W), j = someone(W, (k) => k !== i);
  P.rel[i * REL] = j; P.rtrust[i * REL] = 255; P.close[i * REL] = 200;
  P.belief[i * NB + BL.infl] = 20; P.belief[j * NB + BL.infl] = 110;
  talk(W, i, Math.floor(START / MIN) + 700, even, false);
  const heard = P.belief[i * NB + BL.infl];
  assert.ok(heard > 20, `heard: ${heard}`);
  P.hoard[j] = 20;
  talk(W, i, Math.floor(START / MIN) + 701, even, false);
  assert.ok(P.belief[i * NB + BL.infl] - heard > (110 - heard) * 0.08, 'a friend stocking up: more than the words alone');
});

test('dearer times feared: a household stocks two to four weeks of living goods (paid for), then buys only the fresh food until it is used up', () => {
  const c = country();
  const { W, ctx } = c;
  const P = W.P, i = someone(W, (k) => P.hh[k] === k);
  const m = Math.floor(START / MIN) + 700;
  const money0 = c.money(), cash = P.cash[i];
  act(W, 'stockup', i, m, DAY, even, ctx);
  assert.ok(P.hoard[i] >= 14 && P.hoard[i] <= 28, `stocked: ${P.hoard[i]} days`);
  assert.ok(P.cash[i] < cash, 'paid for');
  assert.equal(c.money(), money0, 'every $ to someone');
  // the next days: the household buys much less of its living goods
  // (what the country's households spent on their living goods that day — the local shops' part —: the others' the same
  // each time, the rest of this one's day — its pleasures, its plans — its own as its feelings move)
  // (the day's own counts: handed to the local companies as the day starts, so kept by hand here)
  const living = (stocked) => { P.hoard[i] = stocked; P.cash[i] = 500000000; const by = W.sector.today = {}; state.dayStart(W, DAY + 1, even, ctx); return by['people:living'] || 0; };
  const usual = living(0), after = living(10), again = living(0);
  assert.ok(after < Math.min(usual, again), `stocked at home: ${after} against ${usual} and ${again}`);
});

test('a spree when stressed: the careless put it on a loan (the bank\'s own money), feel better for now — and regret it within the fortnight, learning of debt and spending', () => {
  const c = country();
  const { W, ctx } = c;
  const P = W.P, i = someone(W);
  for (const [k, v] of [[T.neuro, 250], [T.impulse, 250], [T.thrift, 0], [T.consc, 250]]) setTrait(P, i, k, v);
  assert.ok(tend(P, i, 'stress') > 0.55);
  P.emo[i * 5 + E.stress] = 240;
  P.cash[i] = 0; P.debt[i] = 0; P.dkind[i] = 0; P.credit[i] = 200; P.salary[i] = 6000000;
  P.fund[i * 4 + 2] = W.cal.leisure * 3;
  P.lesson.fill(0, i * NL, i * NL + NL);
  const money0 = c.money();
  act(W, 'splurge', i, Math.floor(START / MIN) + 700, DAY, even, ctx);
  assert.ok(P.debt[i] > 0 && P.dkind[i] === 2, 'on a quick loan');
  assert.ok(P.emo[i * 5 + E.stress] < 240, 'feels better for now');
  assert.ok(heart.lesson(P, i, LS.spend) === 0, 'nothing learnt yet');
  assert.equal(c.money(), money0, 'the loan is the bank\'s money, the spree the companies\' sales');
  P.cash[i] = -1;
  for (let d = 1; d <= 15 && heart.lesson(P, i, LS.spend) >= 0; d++) heart.day(W, DAY + d, even);
  assert.ok(heart.lesson(P, i, LS.debt) < 0 && heart.lesson(P, i, LS.spend) < 0, `regretted: debt ${heart.lesson(P, i, LS.debt)}, spending ${heart.lesson(P, i, LS.spend)}`);
});

test('a bonus is a treat: a part of it counted as extra money (心の財布), the treat felt earned, and today\'s plan a treat or a day out', () => {
  const { W } = country();
  const P = W.P, i = someone(W, (k) => P.salary[k] > 0);
  setTrait(P, i, T.extra, 250); setTrait(P, i, T.vanity, 250); setTrait(P, i, T.thrift, 0);
  P.wind[i] = 0; P.emo2[i * NE2 + E2.license] = 0;
  state.take(W, i, 3000000, 'bonus', DAY);
  assert.ok(P.wind[i] > 1000000, `windfall: ${P.wind[i]}`);
  assert.ok(P.emo2[i * NE2 + E2.license] > 60, 'a treat earned');
  P.need[i * pop.NN + pop.N.fun] = 0;
  heart.day(W, DAY + 1, even);
  const plans = [P.plan[i * 2], P.plan[i * 2 + 1]];
  assert.ok(plans.includes(heart.PLAN.treat) || plans.includes(heart.PLAN.outing), `plans: ${plans}`);
});

test('the habit: a month\'s spending one is used to is hard to come down from — the careless the least able — and up quickly', () => {
  const { W } = country();
  const P = W.P, a = someone(W), b = someone(W, (k) => k !== a);
  for (const i of [a, b]) { P.ref[i] = 2000000; P.wind[i] = 0; P.emo[i * 5 + E.anxiety] = 0; P.emo2[i * NE2 + E2.esteem] = 200; P.lesson.fill(0, i * NL, i * NL + NL); }
  setTrait(P, a, T.thrift, 0); setTrait(P, b, T.thrift, 255);
  const ba = heart.budgetMind(W, a, 1000000).b, bb = heart.budgetMind(W, b, 1000000).b;
  assert.ok(ba > bb && bb > 1000000 * 0.99, `${ba} ${bb}`);
  P.budget[a] = 3000000; heart.habit(P, a);
  assert.ok(P.ref[a] > 2200000, 'up quickly');
  P.budget[a] = 500000; const was = P.ref[a]; heart.habit(P, a);
  assert.ok(P.ref[a] > was * 0.9, 'down slowly');
});

test('a country kept before the mind: read back from its old blobs, everyone is given it once (消費観 0.65–0.95, the habit their budget), and 300 of standing are chosen', () => {
  const { W } = country(600);
  const P = W.P;
  // (its blobs as the country kept them before: the columns up to the mind's)
  const first = pop.COLUMNS.findIndex((c) => c.name === 'emo2');
  const old = pop.COLUMNS.slice(0, first);
  let total = 0;
  for (const c of old) total += P[c.name].byteLength;
  const blob = new Uint8Array(total);
  let at = 0;
  for (const c of old) { const a = P[c.name]; blob.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at); at += a.byteLength; }
  const meta = JSON.parse(JSON.stringify(npc.metaOf(W)));
  delete meta.brain;
  const P2 = pop.unpack(pop.alloc(P.n), [blob], false);
  assert.equal(P2.ethos[5], 0);
  const W2 = Object.assign(meta, { P: P2, AP: W.AP, key: W.key });
  npc.attach(W2);
  assert.equal(W2.brain, heart.VERSION);
  for (let i = 0; i < P2.n; i++) assert.ok(P2.ethos[i] >= 160 && P2.ethos[i] <= 245, `ethos ${P2.ethos[i]}`);
  assert.ok(P2.ref[3] === Math.fround(P2.budget[3]));
  let elite = 0;
  for (let i = 0; i < P2.n; i++) if (P2.flags[i] & pop.FL.elite) elite++;
  // (300 of a country of 10,000, fewer in a smaller one: NPC.elite)
  assert.equal(elite, heart.eliteWant(P2.n));
  assert.ok(W2.owners && W2.owners.list, 'who owns the local businesses, made again');
});

test('a country read back mid-month: its next day closes (who owns the local businesses made again), every $ from someone to someone', () => {
  const c = country(400);
  c.days(2);
  const W = c.W;
  const meta = JSON.parse(JSON.stringify(npc.metaOf(W)));
  const P2 = pop.unpack(pop.alloc(W.P.n), pop.pack(W.P, false), false);
  const AP2 = asuka.unpack(asuka.alloc(W.AP.n), asuka.pack(W.AP, false), false);
  const W2 = Object.assign(meta, { P: P2, AP: AP2, key: W.key });
  npc.attach(W2);
  const before = npc.moneyOf(W2, c.w);
  const out = corpModel.closeDay(c.w, W2.day, { npc: npc.flowsFor(W2, W2.day) }, c.ch);
  npc.nextDay(W2, W2.day, out.ext, c.ctx);
  const L = npc.ledgerDay(W2, c.w, W2.day - 1);
  assert.ok(Math.abs(npc.moneyOf(W2, c.w) - before) >= 0 && Math.abs(L.days[L.days.length - 1].moved) <= 1000, 'the ledger holds');
});

test('アスカ\'s 消費観 from middling to ヴェルノア\'s (0.5–0.85); what its missing branches cannot sell is partly bought at its local trade instead; the ledger never moves', () => {
  const c = country(1000);
  const A = c.W.AP;
  for (let i = 0; i < A.n; i++) assert.ok(A.ethos[i] >= 127 && A.ethos[i] <= 218, `ethos ${A.ethos[i]}`);
  const m0 = c.money();
  c.days(3);
  assert.ok(c.W.asuka.last.instead > 0, 'bought at the local trade instead');
  assert.ok(Math.abs(c.W.ledger.drift) <= 1000, `drift ${c.W.ledger.drift}`);
  void m0;
});

test('a month of the country with the mind: plans made, the 300 kept, every $ from someone to someone', () => {
  const c = country(500);
  c.days(8);
  const P = c.W.P;
  let planned = 0, elite = 0;
  for (let i = 0; i < P.n; i++) { if (P.plan[i * 2]) planned++; if (P.flags[i] & pop.FL.elite) elite++; }
  assert.ok(planned > P.n * 0.3, `planned: ${planned}`);
  assert.ok(elite >= 1);
  assert.ok(Math.abs(c.W.ledger.drift) <= 1000, `drift ${c.W.ledger.drift}`);
});
