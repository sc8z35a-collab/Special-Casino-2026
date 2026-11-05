// 心 (docs/ai-economy-plan.md 11.3): what the people feel, expect and have learnt, and what it does to what they buy.
// Nothing here moves money but through npc-econ.js (every $ from someone to someone): it is what makes a person want
// to spend, and how much.
//
// - The feelings (npc-pop.js E, E2): stress and anger (a spree: ストレス買い), worry (saving, or stocking up: パニック
//   消費), how much one thinks of oneself (自己肯定感: low, one buys status — 代償消費), how worn out (疲れ: the
//   convenience store, the running games — 無気力消費) and how much one feels one has earned a treat (免罪符: the
//   payday, the bonus — ご褒美消費). Memories touch them at once (npc-pop.js FEEL).
// - What one expects of the times (`belief`): the prices, losing one's work, the market — from what one reads (the more
//   one follows the news, the sooner), hears (talk: a rumour spreads, npc-life.js talk) and lives (one's company's
//   sales, being let go). The big decisions think ahead with one's own (npc-mind.js ahead).
// - What one has learnt (`lesson`): each night the day's memories make lessons (the slots lose, debt is to be feared, a
//   car was worth it), slowly forgotten; the decisions read them.
// - 心の財布: money that came as a windfall (`wind`: a bonus, a win, an inheritance) is spent the more freely; the
//   month's spending one is used to (`ref`) is hard to come down from (the habit: 参照点), so a fall in what comes in
//   is met with savings and then debt.
// - Today's plan (`plan`): each morning one or two things one means to do (a treat on payday, the dealer on a day
//   off, rest when tired); the minutes' choices lean to them (npc-life.js free).
// - 消費観 (`ethos`): the sense that one's own spending keeps the country going — ヴェルノア's people high, アスカ's
//   from middling to as high (asuka.js) —: in hard times, and where the mayor promised the shops, they spend to
//   support them (応援消費), as far as they can afford it.
// - The five ways of spending (5つの消費傾向) are each person's own strengths of them (from their character, a little
//   of their own), set off by the state they are in: the feelings, the beliefs, the windfall, the habit.
import { NPC, CORP } from './rules.js';
import { T, E, E2, NE2, BL, NB, LS, NL, N, NN, NT, REL, FL, HOME, MEMS, MEM2, memoryAt, clampB, ageOf, remember, memberList, setView, viewOf } from './npc-pop.js';
import { hash32 } from './npc-rand.js';
import { boomOf } from './npc-macro.js';
import * as econ from './npc-econ.js';

// the mind's version: a country kept before it is given it once (migrate)
export const VERSION = 1;
// the memories it adds (npc-life.js M has them too)
export const K = { splurge: 25, regret: 26, hoard: 27, treat: 28, envy: 29 };
// today's plan
export const PLAN = { none: 0, treat: 1, shop: 2, car: 3, rest: 4, friends: 5, save: 6, outing: 7, stock: 8, local: 9 };
export const PLAN_NAMES = ['', 'ご褒美', '買い物', '車を見に行く', '休む', '友だちに会う', '節約', 'お出かけ', '投資', '地元で買う'];
// what a plan does to the free time's choices (npc-life.js OPTIONS by name: × its worth)
export const PLAN_PULL = {
  [PLAN.treat]: { outing: 1.7, friends: 1.5, lounge: 1.6, shop: 1.2 },
  [PLAN.shop]: { shop: 1.6 },
  [PLAN.car]: { car: 3 },
  [PLAN.rest]: { home: 1.6, walk: 1.5, casino: 0.7, outing: 0.7 },
  [PLAN.friends]: { friends: 1.9 },
  [PLAN.save]: { shop: 0.6, outing: 0.6, casino: 0.5, lounge: 0.6, bank: 3, splurge: 0.5 },
  [PLAN.outing]: { outing: 1.6 },
  [PLAN.stock]: { invest: 2 },
  [PLAN.local]: { shop: 1.4, friends: 1.3, outing: 1.2 }
};
// which option carries out which plan (done: the plan is crossed off)
export const PLAN_DONE = { outing: [PLAN.treat, PLAN.outing, PLAN.local], friends: [PLAN.friends, PLAN.treat, PLAN.local], lounge: [PLAN.treat], shop: [PLAN.shop, PLAN.local], car: [PLAN.car], home: [PLAN.rest], walk: [PLAN.rest], invest: [PLAN.stock], bank: [PLAN.save] };

const tr = (P, i, k) => P.tr[i * NT + k] / 255;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const clampS = (x) => Math.max(-127, Math.min(127, Math.round(x)));
export const feel2 = (P, i, k) => P.emo2[i * NE2 + k];
export function add2(P, i, k, v) { const x = i * NE2 + k; P.emo2[x] = clampB(P.emo2[x] + v); }
export const belief = (P, i, k) => P.belief[i * NB + k];
export const lesson = (P, i, k) => P.lesson[i * NL + k];
export function teach(P, i, k, v) { const x = i * NL + k; P.lesson[x] = clampS(P.lesson[x] + v); }
export const ethosOf = (P, i) => P.ethos[i] / 255;
// how low one thinks of oneself (0: fine, 1: at the bottom)
export const lowEsteem = (P, i) => clamp01((125 - P.emo2[i * NE2 + E2.esteem]) / 125);
// how worried (0: not at all, 1: as much as one can be)
export const worry = (P, i) => clamp01((P.emo[i * 5 + E.anxiety] - 90) / 150);
// how stressed or angry (0: calm, 1: beside oneself)
export const strain = (P, i) => Math.max(P.emo[i * 5 + E.stress], P.emo[i * 5 + E.anger]) / 255;
// how worn out and low together (無気力)
export const apathyNow = (P, i) => clamp01(((P.emo2[i * NE2 + E2.tired] - 140) / 115 + (115 - P.emo[i * 5 + E.mood]) / 115) / 2);

/* ------------------------------------------------------------ the five ways --- */
// each person's own strengths of the five ways of spending (0..1): from their character, and a little of their own
export function tendencies(P, i) {
  const n = tr(P, i, T.neuro), im = tr(P, i, T.impulse), th = tr(P, i, T.thrift), v = tr(P, i, T.vanity), am = tr(P, i, T.ambition);
  const nw = tr(P, i, T.news), op = tr(P, i, T.open), c = tr(P, i, T.consc), ex = tr(P, i, T.extra);
  const h = hash32(i * 131 + P.gen[i], 77);
  const j = (k) => (((h >>> (k * 6)) & 63) - 32) / 320;
  return {
    stress: clamp01(0.35 * n + 0.35 * im + 0.3 * (1 - th) + j(0)),
    compensate: clamp01(0.4 * v + 0.3 * n + 0.3 * am + j(1)),
    panic: clamp01(0.4 * n + 0.35 * nw + 0.25 * (1 - op) + j(2)),
    apathy: clamp01(0.4 * n + 0.3 * (1 - c) + 0.3 * (1 - ex) + j(3)),
    reward: clamp01(0.35 * ex + 0.35 * v + 0.3 * (1 - th) + j(4))
  };
}
// one of them alone (the minutes' choices ask for one at a time)
export const tendency = (P, i, k) => tendencies(P, i)[k];

/* ------------------------------------------------------------ the beginning --- */
// a person's mind as they come into the country (the country's first people, a new life at 18, a country kept before
// the mind was): feelings at ease, what the times say, nothing learnt yet but from what they remember, the habit their
// budget, 消費観 by their character (ヴェルノア's: from 0.65 to 0.95)
export function init(W, i, parent = -1) {
  const P = W.P, x = i * NE2;
  P.emo2[x + E2.esteem] = clampB(135 + (P.emo[i * 5 + E.happy] - 128) * 0.3 + (hash32(i, P.gen[i], 5) % 30));
  P.emo2[x + E2.tired] = 70;
  P.emo2[x + E2.license] = 40;
  const M = W.macro || {};
  P.belief[i * NB + BL.infl] = clampS(((M.expInfl ?? M.pi ?? 0.02) * 1000));
  P.belief[i * NB + BL.job] = clampS((W.outlook ? W.outlook.jobLoss : 0.004) * 2000);
  P.belief[i * NB + BL.mkt] = 0;
  P.lesson.fill(0, i * NL, i * NL + NL);
  P.plan[i * 2] = 0; P.plan[i * 2 + 1] = 0;
  const u = (hash32(i * 7 + 3, P.gen[i], 41) % 1000) / 1000;
  const own = 0.65 + 0.3 * (0.7 * u + 0.3 * tr(P, i, T.agree));
  P.ethos[i] = clampB(255 * (parent >= 0 && hash32(i, 9) % 2 ? (own + P.ethos[parent] / 255) / 2 : own));
  P.ref[i] = Math.max(0, P.budget[i] || 0);
  P.wind[i] = 0;
  P.hoard[i] = 0;
  // (their worry as things are)
  expect(W, i, M.pi ?? 0.02, (M.parts && M.parts.market) || 0, 0, true);
  // (what they remember already makes their first lessons)
  for (let k = 0; k < MEMS; k++) { const m = memoryAt(P, i, k); if (m) learnFrom(W, i, m.kind, m.power); }
}
// the country's people given the mind (a country kept before it, once: its version kept with it)
export function migrate(W) {
  const P = W.P;
  if (!P || !P.emo2) return;
  for (let i = 0; i < P.n; i++) init(W, i);
  W.brain = VERSION;
}
// a new life at 18 in an old one's place (npc-state.js reborn): the mind afresh, 消費観 half the parent's
export function newLife(W, i, parent) {
  const P = W.P;
  P.mem2.fill(0, i * MEM2, i * MEM2 + MEM2);
  P.flags[i] &= ~FL.elite;
  init(W, i, parent);
}

/* ---------------------------------------------------------------- the day --- */
// the country's day for the mind (npc-state.js dayStart, before anything is bought): how much the local businesses
// need support (by district), the news' shocks to what people expect, then each person's night: the lessons of
// yesterday, the feelings settling, what they expect now, and today's plan
export function day(W, d, r) {
  const P = W.P, H = W.heart || (W.heart = { support: [0, 0, 0, 0, 0], shock: 0, panic: 0, buzz: {}, alarm: 0 });
  H.support = supportOf(W);
  // (the news of the last days: prices raised, a strike where one buys one's food, the bank in trouble — fading)
  H.alarm = Math.max(0, (H.alarm || 0) * 0.8);
  news(W, d, H);
  for (const k of Object.keys(H.buzz)) { H.buzz[k] *= 0.97; if (Math.abs(H.buzz[k]) < 0.005) delete H.buzz[k]; }
  const M = W.macro || {}, pi = M.pi ?? 0.02, mkt = (M.parts && M.parts.market) || 0;
  const yd = (d - 1) & 0xffff, t = CORP.ymd(d), off = NPC.jst(d * 86400000 + 3 * 3600000).off;
  for (let i = 0; i < P.n; i++) {
    reflect(W, i, yd, d);
    settle(P, i);
    expect(W, i, pi, mkt, H.alarm);
    // (one of the 300 whose AI chose their plan yesterday or today keeps it: npc-elite.js)
    if (aiPlanned(W, i, d)) continue;
    choosePlan(W, i, d, t, off, r);
  }
}
// What frightens people of dearer times (H.alarm, fading by a fifth a day): ジンクス's people out on strike (where
// the country buys its food and goods), its everyday goods made dearer, the bank rescued by the country, prices rising
// fast; and many stocking up yesterday — itself the news, which feeds it (the herd)
function news(W, d, H) {
  const P = W.P, seen = H.seen || (H.seen = {});
  const u = W.lab && W.lab.unions && W.lab.unions.jinx;
  if (u && u.state === 'strike') { H.alarm += seen.strike ? 0.08 : 0.5; seen.strike = 1; } else seen.strike = 0;
  const goods = econ.priceOf(W, 'jinx:goods');
  if (seen.goods && goods > seen.goods * 1.03) H.alarm += Math.min(0.8, (goods / seen.goods - 1) * 8);
  seen.goods = goods;
  const rescued = (W.nation.stakes && W.nation.stakes.tenesice) || 0;
  if (seen.bank !== undefined && rescued > seen.bank) H.alarm += 0.8;
  seen.bank = rescued;
  if (W.macro && W.macro.pi > 0.05) H.alarm += 0.05;
  if ((H.panic || 0) > P.n * 0.01) {
    W.news.push({ day: d, kind: 'nation', district: -1, text: `値上がりや品不足を心配して、日用品の買いだめが広がっています（昨日${H.panic.toLocaleString('en-US')}世帯）`, data: {} });
    H.alarm += 0.1;
  }
  H.alarm = Math.min(1.5, H.alarm);
  H.panic = 0;
}
// how much the local businesses of each district need the people's support (0..1): hard times (the mood below
// usual), the local companies selling short of their plans, a mayor who promised the shops
export function supportOf(W) {
  const boom = boomOf(W);
  let short = 0, all = 0;
  if (W.locals) for (const c of Object.values(W.locals.firms)) { if (c.dead) { short++; all++; continue; } if (c.today && c.today.plan > 0) { all++; if (c.today.got < c.today.plan * 0.8) short++; } }
  // (more of them short of their plans than usual — its own usual, over about two months —: the local trade in trouble)
  const H = W.heart, now = all ? short / all : null;
  let local = 0;
  if (H && now !== null) {
    H.localBase = H.localBase === undefined || H.localBase === null ? now : H.localBase + (now - H.localBase) / 60;
    local = Math.max(0, now - H.localBase - 0.1) * 2;
  }
  return W.districts.map((d) => Math.round(clamp01(Math.max(0, 1 - boom) * 2.5 + local + ((d.platform || []).includes('shops') ? 0.15 : 0)) * 1000) / 1000);
}
// the news has frightened people (a strike where they shop, prices raised, the bank in trouble): those who follow it
// expect dearer times for a while (`n`: how much, 0..1)
export function alarm(W, n) {
  const H = W.heart || (W.heart = { support: [0, 0, 0, 0, 0], shock: 0, panic: 0, buzz: {}, alarm: 0 });
  H.alarm = Math.min(1.5, (H.alarm || 0) + n);
}

// the night: yesterday's memories made into lessons (and a spree that left one short, regretted)
function reflect(W, i, yd, d) {
  const P = W.P;
  let spree = false;
  for (let k = 0; k < MEMS; k++) {
    const v = k < 16 ? P.mem[i * 16 + k] : P.mem2[i * MEM2 + k - 16];
    if (!v) continue;
    const at = v >>> 16, kind = (v >> 8) & 0xff;
    if (at === yd) learnFrom(W, i, kind, v & 0xff);
    if (kind === K.splurge && ((d & 0xffff) - at + 65536) % 65536 <= 14) spree = true;
  }
  // (a spree in the last two weeks, and now short of money or in debt for it: regret — the careful learn from it)
  if (spree && (P.miss[i] > 0 || P.cash[i] < 0 || (P.dkind[i] === 2 && P.debt[i] > 0)) && hash32(i, d, 3) % 4 === 0) remember(P, i, d, K.regret, 120 + Math.round(100 * tr(P, i, T.consc)));
  // (slowly forgotten: a lesson halves in about a year and a half)
  for (let k = 0; k < NL; k++) { const x = i * NL + k; const v = P.lesson[x]; if (v && hash32(i, d, k) % 8 === 0) P.lesson[x] = v - Math.sign(v); }
}
// what a memory teaches (the more one learns from things, the more)
export function learnFrom(W, i, kind, power) {
  const P = W.P, w = (0.5 + tr(P, i, T.learn)) * Math.min(1.5, Math.max(0.3, power / 150));
  const L = (k, v) => teach(P, i, k, v * w);
  switch (kind) {
    case 1: L(LS.gamble, 12); break;
    case 2: L(LS.gamble, tr(P, i, T.gamble) > 0.75 ? -5 : -16); break;
    case 3: L(LS.luxury, 8); break;
    case 4: L(LS.job, -25); P.belief[i * NB + BL.job] = clampS(belief(P, i, BL.job) + 20 * w); break;
    case 5: L(LS.job, 10); break;
    case 7: L(LS.friends, 10); break;
    case 9: L(LS.job, -6); break;
    case 10: L(LS.debt, -50); L(LS.save, 40); break;
    case 11: L(LS.debt, -4); break;
    case 13: L(LS.market, 12); P.belief[i * NB + BL.mkt] = clampS(belief(P, i, BL.mkt) + 10 * w); break;
    case 14: L(LS.market, -16); P.belief[i * NB + BL.mkt] = clampS(belief(P, i, BL.mkt) - 12 * w); break;
    case 20: L(LS.friends, 20); L(LS.save, 20); break;
    case 25: L(LS.spend, 8); break;
    case 26: L(LS.spend, -20); L(LS.save, 12); L(LS.debt, -10); break;
    case 28: L(LS.spend, 6); L(LS.luxury, 4); break;
    default: break;
  }
}
// the feelings settling overnight: the treat's license fading, one's sense of oneself back toward one's usual, a day
// off's rest; the windfall no more than one has
function settle(P, i) {
  const x = i * NE2;
  P.emo2[x + E2.license] = clampB(P.emo2[x + E2.license] * 0.85);
  const base = 140 + (P.emo[i * 5 + E.happy] - 128) * 0.4;
  P.emo2[x + E2.esteem] = clampB(P.emo2[x + E2.esteem] + (base - P.emo2[x + E2.esteem]) * 0.04);
  P.emo2[x + E2.tired] = clampB(P.emo2[x + E2.tired] - 12);
  if (P.wind[i] > Math.max(0, P.cash[i])) P.wind[i] = Math.max(0, P.cash[i]);
}
// what one expects now: the prices by what the country's prices did (the news' followers sooner) and what scared
// people of late; one's work by the country's and one's company's (its sales falling, a strike); the market by how it
// went. Worry follows: losing one's work, dear times ahead, debt, little in hand.
function expect(W, i, pi, mkt, alarmNow, fast = false) {
  const P = W.P, nw = tr(P, i, T.news), b = i * NB;
  const tInfl = pi * 1000 + alarmNow * 40 * (0.3 + nw);
  P.belief[b + BL.infl] = clampS(P.belief[b + BL.infl] + (tInfl - P.belief[b + BL.infl]) * (0.01 + 0.08 * nw));
  const co = NPC.companyOf(P.job[i]);
  let risk = (W.outlook ? W.outlook.jobLoss : 0.004) * 2000;
  if (co) {
    const trend = (W.coTrendLong && W.coTrendLong[co]) || 0;
    risk *= 1 + Math.max(0, -trend) * 4;
    if (P.flags[i] & FL.striking) risk *= 1.5;
  }
  P.belief[b + BL.job] = clampS(P.belief[b + BL.job] + (risk - P.belief[b + BL.job]) * (0.02 + 0.06 * nw));
  const tMkt = Math.max(-127, Math.min(127, mkt * 4 / 0.3 * 127));
  P.belief[b + BL.mkt] = clampS(P.belief[b + BL.mkt] + (tMkt - P.belief[b + BL.mkt]) * (0.01 + 0.1 * nw * tr(P, i, T.risk)));
  const working = NPC.employed(P.job[i]);
  const income = Math.max(1, (P.salary[i] || 0) + (P.penAmt[i] || 0) * 12);
  const debt = clamp01(P.debt[i] / income * (P.dkind[i] === 2 ? 2 : 0.07));
  const cushion = P.cash[i] < Math.max(300000, (P.budget[i] || 200000) * 1.5) ? 1 : 0;
  const a = 50 + 120 * clamp01(P.belief[b + BL.job] / 40) * (working ? 1 : 0.3) + 70 * clamp01((P.belief[b + BL.infl] - 30) / 60) + 100 * debt + 50 * cushion + 40 * tr(P, i, T.neuro);
  const x = i * 5 + E.anxiety;
  P.emo[x] = clampB(P.emo[x] + (Math.min(255, a) - P.emo[x]) * (fast ? 1 : 0.12));
}
// today's plan: one thing one means to do (and a second, near as much)
function choosePlan(W, i, d, t, off, r) {
  const P = W.P, td = tendencies(P, i), lic = feel2(P, i, E2.license) / 255, tired = feel2(P, i, E2.tired) / 255;
  const fun = 1 - P.need[i * NN + N.fun] / 255, social = 1 - P.need[i * NN + N.social] / 255;
  const support = W.heart ? W.heart.support[P.dist[i]] || 0 : 0;
  const s = new Float64Array(10);
  s[PLAN.treat] = lic * 1.3 * (0.4 + td.reward) + (P.wind[i] > (P.budget[i] || 1) * 0.2 ? 0.35 : 0);
  s[PLAN.shop] = fun * 0.15 + strain(P, i) * td.stress * 0.7 + lowEsteem(P, i) * td.compensate * 0.6 + (P.fund[i * 4 + 2] > (W.cal.leisure || 1) * 1.5 ? 0.1 : 0);
  const years = P.car[i] ? (d - P.carDay[i]) / 365 : 9;
  s[PLAN.car] = (P.car[i] ? (years > 6 ? 0.3 : 0.03) : 0.2) * tr(P, i, T.car) * (off ? 1.5 : 0.5) + lowEsteem(P, i) * td.compensate * 0.25;
  s[PLAN.rest] = tired * 1.1;
  s[PLAN.friends] = social * 0.6 * (0.5 + tr(P, i, T.extra)) + Math.max(0, lesson(P, i, LS.friends)) / 127 * 0.2;
  s[PLAN.save] = worry(P, i) * 0.9 + Math.max(0, lesson(P, i, LS.save)) / 127 * 0.5 + Math.max(0, -lesson(P, i, LS.debt)) / 127 * 0.3;
  s[PLAN.outing] = off ? fun * 0.25 + lic * 0.6 * td.reward + (P.wind[i] > 0 ? 0.15 : 0) : 0;
  s[PLAN.stock] = P.fund[i * 4 + 3] > 100000 ? tr(P, i, T.risk) * tr(P, i, T.news) * 0.5 * (1 + belief(P, i, BL.mkt) / 127) : 0;
  s[PLAN.local] = ethosOf(P, i) * support * 0.6;
  let best = 0, second = 0;
  for (let k = 1; k < s.length; k++) { s[k] *= 0.85 + 0.3 * r.u(); if (s[k] > s[best]) { second = best; best = k; } else if (s[k] > s[second]) second = k; }
  P.plan[i * 2] = s[best] > 0.2 ? best : 0;
  P.plan[i * 2 + 1] = second && s[second] > 0.2 && s[second] > s[best] * 0.6 ? second : 0;
  void t;
}
// how today's plan pulls an option of the free time (1: not at all)
export function planPull(P, i, option) {
  let x = 1;
  for (let k = 0; k < 2; k++) { const p = P.plan[i * 2 + k]; if (p && PLAN_PULL[p] && PLAN_PULL[p][option]) x *= PLAN_PULL[p][option]; }
  return x;
}
// an option done: the plans it carries out crossed off
export function planDone(P, i, option) {
  const done = PLAN_DONE[option];
  if (!done) return;
  for (let k = 0; k < 2; k++) if (done.includes(P.plan[i * 2 + k])) P.plan[i * 2 + k] = 0;
}

/* --------------------------------------------------------- the month's budget --- */
// What the mind does to a month's budget (npc-state.js budgetOf, `b` what income and savings allow): worry keeps it
// (but for those who stock up instead), a low sense of oneself spends on status (代償消費: up to twice as much),
// 消費観 supports the local businesses in hard times (as far as one can afford it), what one has learnt (that
// spending did one good, that debt is to be feared, that saving matters), the windfall, and the habit of what one is
// used to spending (参照点: hard to come down from — the careless the less). Returns { b, status } (status: the part
// of it for status).
export function budgetMind(W, i, b) {
  const P = W.P;
  // (not before the mind is given: a country being made counts its budgets first)
  if (!P.emo2 || !W.brain || !(b > 0)) return { b: Math.max(0, b), status: 0 };
  const td = tendencies(P, i);
  const cash = Math.max(0, P.cash[i]);
  let k = 1;
  k *= 1 - 0.25 * worry(P, i) * (1 - td.panic);
  const status = td.compensate * lowEsteem(P, i);
  k *= 1 + status;
  const support = W.heart ? W.heart.support[P.dist[i]] || 0 : 0;
  const afford = clamp01(cash / Math.max(1, b * 3) - 0.3);
  k *= 1 + 0.35 * ethosOf(P, i) * support * afford;
  k *= 1 + lesson(P, i, LS.spend) / 127 * 0.12;
  k *= 1 + Math.min(0, lesson(P, i, LS.debt)) / 127 * 0.15;
  k *= 1 - Math.max(0, lesson(P, i, LS.save)) / 127 * 0.15;
  k = Math.max(0.5, Math.min(2.2, k));
  let out = b * k + Math.min(P.wind[i], cash) * 0.15 * (0.4 + td.reward);
  const ref = P.ref[i] || 0;
  if (ref > out) out += (ref - out) * (0.2 + 0.4 * (1 - tr(P, i, T.thrift)));
  return { b: out, status: Math.min(1, status) };
}
// the habit at the month's end: up quickly to what one spent, down slowly
export function habit(P, i) {
  const b = P.budget[i] || 0, ref = P.ref[i] || 0;
  P.ref[i] = ref + (b - ref) * (b > ref ? 0.3 : 0.06);
}

/* ------------------------------------------------------- the money one has --- */
// What one lets oneself spend on pleasures now: today's share of the month's fund for them, and a part of the
// windfall (the freer the more)
// — and no more than one's money in hand allows: short of it before payday, the careful hold back the most (the
// careless less: they find out at the till)
export function pocket(W, i, day) {
  const P = W.P;
  const w = P.wind ? Math.max(0, Math.min(P.wind[i], P.cash[i])) * (0.04 + 0.12 * tendency(P, i, 'reward')) : 0;
  const n = econ.allowance(W, i, 2, day) + w;
  const hand = Math.max(0, P.cash[i]) / Math.max(1, n * 6);
  return n * (hand >= 1 ? 1 : hand + (1 - hand) * (1 - tr(P, i, T.thrift)) * 0.5);
}
// the month's end: what was set aside for pleasures and not spent — the careless count a part of it as extra money
// for the next (心の財布: 来月へ回す), the careful leave it in their savings (no money moves either way)
export function leftover(P, i) {
  if (!P.wind) return;
  const left = Math.max(0, P.fund[i * 4 + 1]) * 0.3 + Math.max(0, P.fund[i * 4 + 2]);
  const keep = 0.15 + 0.45 * (1 - tr(P, i, T.thrift)) * (0.5 + tr(P, i, T.impulse));
  if (left > 0) P.wind[i] = Math.min(Math.max(0, P.cash[i]), P.wind[i] + left * keep);
}
// a pleasure bought: out of the month's fund for them, then out of the windfall
export function spent(P, i, n) {
  const f = i * 4 + 2, from = Math.min(Math.max(0, P.fund[f]), n);
  P.fund[f] -= from;
  if (P.wind && n > from) P.wind[i] = Math.max(0, P.wind[i] - (n - from));
}
// a windfall: a bonus's part one counts as extra, a win, an inheritance
export function windfall(P, i, n) {
  if (!P.wind || !(n > 0)) return;
  P.wind[i] += n;
}

/* ------------------------------------------------------------ the others --- */
// One bought something to be seen with (a car, VIP, the dear things): those close to them who mind such things feel
// the lack (見栄: their need of status falls; the vainest remember it) and hear of the company (its name a little
// better with them)
export function envy(W, i, day, company = null, power = 120) {
  const P = W.P;
  for (let k = 0; k < REL; k++) {
    const j = P.rel[i * REL + k];
    if (j < 0 || P.close[i * REL + k] < 120) continue;
    const v = tr(P, j, T.vanity);
    const x = j * NN + N.status;
    P.need[x] = clampB(P.need[x] - 30 * v);
    if (v > 0.65) remember(P, j, day, K.envy, power);
    if (company) { const c = NPC.companies.indexOf(company); if (c >= 0) setView(P, j, c, Math.max(-127, Math.min(127, viewOf(P, j, c) + 2))); }
  }
}
// a game's name among the people: those who bought it say what they think (the good ones talked up, the poor ones
// down: a hit or a flop, npc-model.js refresh adds it to its buzz)
export function word(W, title, q) {
  const H = W.heart || (W.heart = { support: [0, 0, 0, 0, 0], shock: 0, panic: 0, buzz: {}, alarm: 0 });
  H.buzz[title] = Math.max(-1, Math.min(2, (H.buzz[title] || 0) + (q - 70) / 30 * 0.004));
}
export const buzzOf = (W, title) => (W.heart && W.heart.buzz[title]) || 0;

/* ---------------------------------------------------------------- the 300 --- */
// 選ばれし300人 (NPC.elite, server/core/npc-elite.js): 300 of a country of 10,000 (fewer in a smaller one) by their
// standing — the companies' officers, the mayors, the unions' representatives — and their money, chosen again each
// month (those already in it stay unless they fall well behind); they think deeper and further ahead (npc-mind.js),
// and they alone think with AI
export const eliteWant = (n) => Math.max(1, Math.min(NPC.elite.n, Math.round(NPC.elite.n * n / NPC.elite.per)));
// (an AI's plan of theirs from yesterday or today, by the same person: npc-elite.js)
const aiPlanned = (W, i, d) => { const x = W.eliteAi && W.eliteAi.last[i]; return !!x && x.gen === W.P.gen[i] && d - x.day <= 1; };
export function chooseElite(W) {
  const P = W.P, want = eliteWant(P.n);
  const score = new Float64Array(P.n);
  for (let i = 0; i < P.n; i++) {
    const f = P.flags[i];
    score[i] = (P.rank[i] >= 4 ? 4 : P.rank[i] >= 3 ? 2 : 0) + (f & FL.mayor ? 4 : 0) + (f & FL.exec ? 2 : 0) + (f & FL.unionRep ? 1.5 : 0) + Math.log10(Math.max(1, P.cash[i])) / 2.5 + (f & FL.elite ? 0.4 : 0);
  }
  const order = Array.from({ length: P.n }, (_, k) => k).sort((a, b) => score[b] - score[a]);
  for (let i = 0; i < P.n; i++) P.flags[i] &= ~FL.elite;
  for (let k = 0; k < want && k < order.length; k++) P.flags[order[k]] |= FL.elite;
  return want;
}

/* ---------------------------------------------------------------- what 運営 sees --- */
export function view(W, i) {
  const P = W.P;
  if (!P.emo2) return null;
  const td = tendencies(P, i);
  const lessons = {};
  for (const [k, x] of Object.entries(LS)) lessons[k] = lesson(P, i, x);
  return {
    esteem: feel2(P, i, E2.esteem), tired: feel2(P, i, E2.tired), license: feel2(P, i, E2.license),
    beliefs: { inflation: belief(P, i, BL.infl) / 10, jobLoss: Math.round(belief(P, i, BL.job) / 2000 * 10000) / 100, market: Math.round(belief(P, i, BL.mkt) / 127 * 30) },
    lessons, plan: [P.plan[i * 2], P.plan[i * 2 + 1]].filter(Boolean).map((p) => PLAN_NAMES[p]), ethos: Math.round(ethosOf(P, i) * 100) / 100,
    habit: Math.round(P.ref[i] || 0), windfall: Math.round(P.wind[i] || 0), stocked: P.hoard[i] || 0, elite: !!(P.flags[i] & FL.elite), alpha: !!(P.flags[i] & FL.alpha), poorest: !!(P.flags[i] & FL.poorest), gift: !!(P.flags[i] & FL.gift),
    ways: Object.fromEntries(Object.entries(td).map(([k, v]) => [k, Math.round(v * 100) / 100]))
  };
}
void ageOf; void memberList; void HOME;
