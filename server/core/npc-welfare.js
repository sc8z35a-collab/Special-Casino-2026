// 最貧困層 and 給付型経済成長 (js/game/npc.js NPC.poorest, NPC.gift): the state's money to its poorest.
//
// 最貧困層 (both countries, from 2026-11-05): at each month's start the adults with the least — what they have (cash,
// shares at today's price, tokens) less what they owe — are counted again, the poorest 1,000 of a full country (its
// share of them at a country's size; 3,000 in a dangerous bust), and each is paid $5M of the state's money, theirs to use
// as they like: work or none, the 医療保険 or none. The same people as often as they are still the poorest.
//
// 給付型経済成長 (ヴェルノア, once a year from 2026-12-01): $5M to each of the poorest 40% of its adults; for a week from
// that day they want to buy three times as much (npc-econ.js buy, npc-mind.js thinkCar, npc-life.js: FL.gift).
//
// Every $ from the treasury to the people: never made, never lost.
import { NPC, CORP } from './rules.js';
import { FL, ageOf, LISTED } from './npc-pop.js';
import { LISTED_IDS } from './npc-market.js';
import * as econ from './npc-econ.js';
import * as heart from './npc-heart.js';
import { ageOf as asukaAge, JOB } from './asuka.js';

const R = NPC.poorest, G = NPC.gift;
const FROM = CORP.dayAt(...R.from), GIFT_FIRST = CORP.dayAt(...G.first);

// what person `i` has, all of it, less what they owe (ヴェルノア)
export function wealthOf(W, i, px) {
  const P = W.P;
  let x = P.cash[i] + (P.tokens ? P.tokens[i] : 0) - P.debt[i];
  for (let k = 0; k < LISTED; k++) x += P.sh[i * LISTED + k] * (px[k] || 0);
  return x;
}
const pricesOf = (ctx) => LISTED_IDS.map((id) => (ctx && ctx.stockPrice ? ctx.stockPrice(id) || 0 : 0));
// a dangerous bust: 恐慌 by the mood, or a bust with one in ten out of work
export function crisisOf(W, jobless) {
  const mood = (W.macro && W.macro.mood) || 0, C = R.crisis;
  return mood <= C.mood || (mood <= C.bust && jobless >= C.jobless);
}
// the poorest `n` of a list of [index, wealth] (the least first; ties by index, the same every time): their indices,
// and what the richest of them has (the line)
function poorest(list, n) {
  list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const top = list.slice(0, n);
  return { who: top.map((x) => x[0]), line: top.length ? Math.round(top[top.length - 1][1]) : 0 };
}

/* ---------------------------------------------------------------- 最貧困層 --- */
// ヴェルノア's month (or its first day, 2026-11-05): chosen, paid
function vernoaMonth(W, day, ctx) {
  const P = W.P, px = pricesOf(ctx), jobless = (W.stats && W.stats.unemployment) || 0, crisis = crisisOf(W, jobless);
  const n = Math.max(1, Math.round((crisis ? R.crisis.n : R.n) * (W.scale || P.n / NPC.nation.population)));
  const list = [];
  for (let i = 0; i < P.n; i++) { P.flags[i] &= ~FL.poorest; if (ageOf(P, i, day) >= NPC.life.adult) list.push([i, wealthOf(W, i, px)]); }
  const { who, line } = poorest(list, n);
  let paid = 0;
  for (const i of who) {
    P.flags[i] |= FL.poorest;
    econ.nationOut(W, 'poorest', R.pay);
    P.cash[i] += R.pay;
    // (their own to use: counted as the month's income and, at first, as money beyond the usual)
    P.inc[i] += R.pay;
    heart.windfall(P, i, R.pay);
    paid += R.pay;
  }
  const was = W.poorest || { hist: [] }, before = new Set(was.who || []);
  const again = who.filter((i) => before.has(i)).length;
  W.poorest = { day, n: who.length, crisis, paid, budget: n * R.pay, line, again, who, hist: (was.hist || []).concat([{ day, n: who.length, crisis, paid, line, again }]).slice(-R.hist) };
  W.news.push({ day, kind: 'welfare', district: -1, text: `最貧困層の生活保護：資産が下位${who.length}人に1人$5,000,000を支給（${crisis ? '危険な不況のため3,000人規模に拡大・' : ''}計${CORP.fmt.money(paid)}）`, data: { n: who.length, crisis, paid } });
}
// アスカ国's, the same (its treasury's money; its people's cash less what they owe)
function asukaMonth(W, day) {
  const a = W.asuka, A = W.AP;
  if (!a || !A) return;
  let jobless = 0, adults = 0;
  const list = [];
  for (let i = 0; i < A.n; i++) {
    const age = asukaAge(A, i, day);
    if (age < NPC.life.adult) continue;
    list.push([i, A.cash[i] - A.debt[i]]);
    if (age < 65) { adults++; if (A.job[i] === JOB.none) jobless++; }
  }
  const crisis = crisisOf(W, adults ? jobless / adults : 0);
  const n = Math.max(1, Math.round((crisis ? R.crisis.n : R.n) * (a.scale || 1)));
  const { who, line } = poorest(list, n);
  for (const i of who) A.cash[i] += R.pay;
  const paid = who.length * R.pay;
  a.treasury -= paid;
  if (paid) a.month.out.poorest = (a.month.out.poorest || 0) + paid;
  const was = a.poorest || { hist: [] }, before = new Set(was.who || []);
  const again = who.filter((i) => before.has(i)).length;
  a.poorest = { day, n: who.length, crisis, paid, budget: n * R.pay, line, again, who, hist: (was.hist || []).concat([{ day, n: who.length, crisis, paid, line, again }]).slice(-R.hist) };
}

/* -------------------------------------------------------- 給付型経済成長 --- */
// the year's gift: the poorest 40% of the adults, $5M each; their week of wanting three times as much
function gift(W, day, ctx) {
  const P = W.P, px = pricesOf(ctx), list = [];
  for (let i = 0; i < P.n; i++) if (ageOf(P, i, day) >= NPC.life.adult) list.push([i, wealthOf(W, i, px)]);
  const { who } = poorest(list, Math.round(list.length * G.share));
  for (const i of who) {
    econ.nationOut(W, 'gift', G.pay);
    P.cash[i] += G.pay;
    P.inc[i] += G.pay;
    heart.windfall(P, i, G.pay);
    P.flags[i] |= FL.gift;
  }
  const paid = who.length * G.pay, y = CORP.ymd(day).y;
  W.gift = { day, until: day + G.days, year: y, n: who.length, of: list.length, paid, hist: ((W.gift && W.gift.hist) || []).concat([{ day, year: y, n: who.length, paid }]).slice(-10) };
  W.news.push({ day, kind: 'welfare', district: -1, text: `給付型経済成長：資産が下位40%の国民${who.length}人に1人$5,000,000を支給（計${CORP.fmt.money(paid)}）。1週間、購買意欲が3倍に`, data: { n: who.length, paid } });
}
// one of this week's: three times as keen to buy
export const keen = (W, i) => (W.gift && W.day < W.gift.until && (W.P.flags[i] & FL.gift) ? G.boost : 1);

/* ---------------------------------------------------------------- the day --- */
// The new day `day` (npc-model.js nextDay): the month's poorest chosen and paid on its first day (and on 2026-11-05),
// the year's gift on its day, its week ended
export function day(W, day, ctx) {
  if (day < FROM) return;
  const ymd = CORP.ymd(day);
  if (day === FROM || ymd.d === 1 || !W.poorest) {
    if (!W.poorest || W.poorest.day !== day) { vernoaMonth(W, day, ctx); asukaMonth(W, day); }
  }
  if (day >= GIFT_FIRST && ymd.m === G.at[0] && ymd.d === G.at[1] && !(W.gift && W.gift.year === ymd.y)) gift(W, day, ctx);
  if (W.gift && day >= W.gift.until && !W.gift.ended) {
    const P = W.P;
    for (let i = 0; i < P.n; i++) P.flags[i] &= ~FL.gift;
    W.gift.ended = day;
  }
}

/* ---------------------------------------------------------------- 運営 --- */
export function view(W) {
  const v = (x) => x && { day: x.day, n: x.n, crisis: x.crisis, paid: x.paid, budget: x.budget, line: x.line, again: x.again, hist: x.hist };
  return { vernoa: v(W.poorest), asuka: v(W.asuka && W.asuka.poorest), gift: W.gift ? { ...W.gift, on: W.day < W.gift.until } : null, rules: { poorest: R, gift: G } };
}
