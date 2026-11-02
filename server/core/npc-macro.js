// 景気の波と物価 (the country's mood and its prices), a day at a time. Nothing here moves money: it is what everyone
// feels of the times and what things cost, read by those who spend.
//
// The mood (`mood`, −1 to 1; `boom`, its effect: about 0.7 in a deep bust to 1.65 in a bubble): what the people, the
// companies and the country feel of the times — pulled up by their spending growing faster than it has over the year
// (W.stats.economy), the market rising (the listed companies' prices against 90 days before), more borrowing, fewer out
// of work than over the year, and by itself (the herd: a boom feeds on its own talk); pulled down by dear money
// (Tenesice's rate over its neutral one) and the opposite of each. Nothing sets it: it rises with a boom that feeds on
// itself until the money runs short, the rates bite and the market turns, and falls the same way.
//
// The prices (`W.cpi`, 1 at the beginning; `W.rentIdx` the rents): up by the inflation everyone expects (it follows what
// was seen, slowly — and slower still toward the country's target), more when spending runs ahead and few are out of
// work, more in a boom (the sellers raise their prices while they can) and with アルタス's prices for raw materials; down
// the other way (デフレ). The rents more in a boom (the land), less in a bust.
import { LISTED_IDS } from './npc-market.js';
import { altasPrice } from './asuka.js';

const YEAR = 365;
const push = (a, v, n) => { a.push(v); if (a.length > n) a.shift(); };
const ago = (a, n) => (a.length > n ? a[a.length - 1 - n] : a[0]);
// (the mood's pull: each driver as far as it goes — a little of it counts, much of it no more than so much —, the herd,
// and the weariness of a long boom or a long bust (`tire`: what the mood has been of late, about four months of it)
const MOOD = { keep: 0.985, step: 0.02, herd: 0.3, tire: 1.2, memory: 120, econ: [0.6, 0.2], market: [0.5, 0.25], credit: [0.2, 0.15], jobs: [0.4, 0.01], rate: 4 };
// (the prices: what is expected follows what is seen over about a year and is drawn back to the target as fast; the
// pressures each as far as they go)
const PRICE = { expect: 1 / 365, anchor: 1 / 365, demand: [0.06, 0.2], jobs: 0.5, mood: 0.02, altas: 0.05, rentMood: 0.03 };
const pressure = (k, x) => k[0] * Math.tanh(x / k[1]);

export const boomOf = (W) => (W.macro && W.macro.boom) || 1;
export const moodOf = (W) => (W.macro && W.macro.mood) || 0;
// a word for it (運営's 街, the companies' folder)
export function moodName(mood) {
  return mood >= 0.6 ? 'バブル' : mood >= 0.25 ? '好景気' : mood > -0.25 ? '平常' : mood > -0.6 ? '不景気' : '恐慌';
}

// the day: `ctx.stockPrice` the market's prices now (none: the market not counted)
export function macroDay(W, day, ctx) {
  const target = (W.nation.knobs.inflation ?? 2) / 100;
  const M = W.macro || (W.macro = { L: 0, mood: 0, boom: 1, expInfl: target, pi: target, idx: [], debt: [], u: [], altas: [], hist: [] });
  const s = W.stats || {};
  // the market: the listed companies' prices together (their geometric mean)
  let lg = 0, k = 0;
  if (ctx && ctx.stockPrice) for (const id of LISTED_IDS) { const p = ctx.stockPrice(id); if (p > 0) { lg += Math.log(p); k++; } }
  const idx = k ? Math.exp(lg / k) : 0;
  if (idx > 0) push(M.idx, idx, 120);
  push(M.debt, Math.max(1, s.debt || 0), 120);
  push(M.u, s.unemployment || 0, YEAR);
  push(M.altas, altasPrice(W) || 1, 60);
  const market = M.idx.length > 1 && ago(M.idx, 90) > 0 ? Math.log(M.idx[M.idx.length - 1] / ago(M.idx, 90)) : 0;
  const credit = Math.log(M.debt[M.debt.length - 1] / ago(M.debt, 90));
  const uAvg = M.u.reduce((a, b) => a + b, 0) / M.u.length, jobs = uAvg - (s.unemployment || 0);
  // (the people's spending against its year's, less what the prices alone added: its fast measure is about a third
  // of a year nearer than its slow one)
  // (and only as far as a year of it has been seen: before that, its year's is no measure yet)
  const econ = (Math.log(Math.max(0.2, s.economy || 1)) - 0.375 * (M.pi || 0)) * Math.min(1, (s.spentDays || 0) / YEAR);
  const rate = (W.bankRates && W.bankRates.person) || 0.03, neutral = 0.02 + target;
  // the mood: the times' pull on it, its own talk among it, and the weariness of how it has been
  M.heat = (M.heat || 0) + (M.mood - (M.heat || 0)) / MOOD.memory;
  const pull = pressure(MOOD.econ, econ) + pressure(MOOD.market, market) + pressure(MOOD.credit, credit) + pressure(MOOD.jobs, jobs) - MOOD.rate * (rate - neutral)
    + MOOD.herd * M.mood - MOOD.tire * M.heat;
  M.L = M.L * MOOD.keep + MOOD.step * pull;
  M.mood = Math.round(Math.tanh(M.L) * 10000) / 10000;
  // (what it does to spending: more in a boom than it takes away in a bust — what one needs is bought all the same)
  M.boom = Math.round(Math.exp((M.mood >= 0 ? 0.5 : 0.35) * M.mood) * 10000) / 10000;
  // the prices: what everyone expects, the gaps, the mood, the raw materials' prices of late (a year's pace)
  const altas = Math.log(M.altas[M.altas.length - 1] / ago(M.altas, 30)) * YEAR / 30;
  const pi = M.expInfl + pressure(PRICE.demand, econ) + PRICE.jobs * jobs + PRICE.mood * M.mood + PRICE.altas * Math.tanh(altas);
  M.expInfl += PRICE.expect * (pi - M.expInfl) + PRICE.anchor * (target - M.expInfl);
  M.pi = Math.round(pi * 100000) / 100000;
  W.cpi = Math.round((W.cpi || 1) * Math.exp(pi / YEAR) * 1e6) / 1e6;
  W.rentIdx = Math.round((W.rentIdx || 1) * Math.exp((pi + PRICE.rentMood * M.mood) / YEAR) * 1e6) / 1e6;
  M.parts = { econ: round4(econ), market: round4(market), credit: round4(credit), jobs: round4(jobs), rate: round4(rate - neutral), altas: round4(altas), tired: round4(M.heat) };
  push(M.hist, { day, mood: M.mood, boom: M.boom, pi: M.pi, exp: round4(M.expInfl), cpi: W.cpi, rent: W.rentIdx }, 400);
  return M;
}
const round4 = (x) => Math.round(x * 10000) / 10000;

// What 運営 sees of it
export function macroView(W) {
  const M = W.macro;
  if (!M) return null;
  return { mood: M.mood, boom: M.boom, name: moodName(M.mood), pi: M.pi, expInfl: round4(M.expInfl), cpi: W.cpi || 1, rentIdx: W.rentIdx || 1, parts: M.parts || {},
    hist: M.hist.slice(-120).map((h) => [h.day, h.mood, h.pi, h.cpi]) };
}
