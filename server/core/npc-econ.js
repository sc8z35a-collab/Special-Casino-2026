// The people's money (server/core/npc-model.js): what they pay and where it goes. Every $ a person spends goes to
// someone in the country (a company's sale, the country's tax, the local businesses' takings, another person), and
// every $ they get comes from someone: nothing is made up but where the country began. A company's sale waits in the
// day's flows until its day closes (server/core/corp-model.js takes it in then).
import { NPC, RULES, CORP } from './rules.js';
import { T, FL, HOME, ageOf } from './npc-pop.js';
import * as asuka from './asuka.js';

/* ----------------------------------------------------------------- the flows --- */
// the day's money for the companies: { co: { company: { s: { stream: $ }, p: { cars|items: { id: [n, $] } }, t: { title: [n, $] },
// l: { live: $ }, cat: $ } }, bank: { nii, fees, credit } }
// (kept by the day: a company's day takes all that is waiting up to it, so nothing is ever dropped)
export function flowsOf(W, day) {
  const fl = W.fl || (W.fl = {});
  return fl[day] || (fl[day] = { day, co: {}, bank: { nii: 0, fees: 0, credit: 0 }, charges: [] });
}
// the flows waiting for the companies' day `day` (and any older still waiting), as one, taken out
export function takeFlows(W, day) {
  const out = { day, co: {}, bank: { nii: 0, fees: 0, credit: 0 }, charges: [] };
  for (const k of Object.keys(W.fl || {})) {
    if (Number(k) > day) continue;
    const f = W.fl[k];
    delete W.fl[k];
    for (const key of ['nii', 'fees', 'credit']) out.bank[key] += f.bank[key] || 0;
    out.charges.push(...(f.charges || []));
    for (const [id, n] of Object.entries(f.estates || {})) { out.estates = out.estates || {}; out.estates[id] = (out.estates[id] || 0) + n; }
    for (const [id, c] of Object.entries(f.co)) {
      const o = out.co[id] || (out.co[id] = { s: {}, p: {}, t: {}, l: {}, cat: 0 });
      for (const [k2, v] of Object.entries(c.s)) o.s[k2] = (o.s[k2] || 0) + v;
      for (const [kind, m] of Object.entries(c.p)) { const t = o.p[kind] || (o.p[kind] = {}); for (const [x, v] of Object.entries(m)) { const was = t[x] || [0, 0]; t[x] = [was[0] + v[0], was[1] + v[1]]; } }
      for (const [x, v] of Object.entries(c.t)) { const was = o.t[x] || [0, 0]; o.t[x] = [was[0] + v[0], was[1] + v[1]]; }
      for (const [x, v] of Object.entries(c.l)) o.l[x] = (o.l[x] || 0) + v;
      o.cat += c.cat || 0;
      if (c.cas) o.cas = (o.cas || 0) + c.cas;
      if (c.buyback) o.buyback = (o.buyback || 0) + c.buyback;
      // (Car Owner's lots of cars that arrived: npc-model.js restock)
      if (c.restock) o.restock = (o.restock || []).concat(c.restock);
    }
  }
  return out;
}
// what is on its way to the companies now (for the count of the country's money)
export function pending(W) {
  let x = 0;
  for (const f of Object.values(W.fl || {})) {
    for (const c of Object.values(f.co)) {
      x += Object.values(c.s).reduce((a, y) => a + y, 0) + (c.cas || 0) + (c.cat || 0) - (c.buyback || 0);
      for (const k of Object.values(c.p)) for (const v of Object.values(k)) x += v[1];
      for (const v of Object.values(c.t)) x += v[1];
      for (const v of Object.values(c.l)) x += v;
    }
    x += f.bank.nii + f.bank.fees - f.bank.credit;
    for (const n of Object.values(f.estates || {})) x += n;
  }
  return x;
}
function coFlow(W, day, company) {
  const f = flowsOf(W, day);
  return f.co[company] || (f.co[company] = { s: {}, p: {}, t: {}, l: {}, cat: 0 });
}
export function toStream(W, day, company, stream, n) {
  if (!(n > 0)) return;
  const c = coFlow(W, day, company);
  c.s[stream] = (c.s[stream] || 0) + n;
  W.sum.toCo += n;
}
export function toProduct(W, day, company, kind, id, count, n) {
  if (!(n > 0)) return;
  const c = coFlow(W, day, company), k = c.p[kind] || (c.p[kind] = {});
  const was = k[id] || [0, 0];
  k[id] = [was[0] + count, was[1] + n];
  W.sum.toCo += n;
}
export function toTitle(W, day, company, title, count, n) {
  if (!(n > 0)) return;
  const c = coFlow(W, day, company), was = c.t[title] || [0, 0];
  c.t[title] = [was[0] + count, was[1] + n];
  W.sum.toCo += n;
}
export function toLive(W, day, company, id, n) {
  if (!(n > 0)) return;
  const c = coFlow(W, day, company);
  c.l[id] = (c.l[id] || 0) + n;
  W.sum.toCo += n;
}
export function toCatalog(W, day, company, n) {
  if (!(n > 0)) return;
  coFlow(W, day, company).cat += n;
  W.sum.toCo += n;
}
// to a failed company's trustee (破産財団): what a local company pays for a business it bought from it
export function toEstate(W, day, company, n) {
  if (!(n > 0)) return;
  const f = flowsOf(W, day);
  f.estates = f.estates || {};
  f.estates[company] = (f.estates[company] || 0) + n;
  W.sum.toCo += n;
}
// 海外: what the country pays abroad (its imports) is all the money the world outside has, to buy what the country sells
// abroad with (server/core/corp-model.js abroadBuys): nothing comes in from outside but what went out
export function toAbroad(W, n, division = 'altas', by = 'other') {
  n = Math.round(n);
  if (!(n > 0)) return;
  W.sum.imports += n;
  // (the world outside is アスカ国 once it is founded: what is bought there is ATSUKA Vision's sale — raw materials,
  // fuel and food アルタス's)
  if (!asuka.earned(W, n, division, by)) W.abroad.cash += n;
}
export function toBank(W, day, kind, n) {
  if (!(n > 0)) return;
  flowsOf(W, day).bank[kind] += n;
  W.sum.toCo += n;
}

/* ------------------------------------------------------------ prices and pull --- */
// what a company's own price decisions have done to a price (its sales and discounts, its fees raised: npc-org.js),
// and how much more the people want what it sells for its campaigns and its advertising (its own and for all it does)
export const priceOf = (W, key) => (W.priceIdx[key] || 1) * ((W.priceTemp && W.priceTemp[key] && W.priceTemp[key].mult) || 1);
export const appealOf = (W, id, key) => (W.appeal[id + ':' + key] || 0) + (W.appeal[id + ':all'] || 0);
// what is spent on something whose price moved: the people buy a little less of it when dearer (spending by the
// square root of the price)
export const spendAt = (W, key, n) => Math.round(n * Math.sqrt(priceOf(W, key)));

/* ------------------------------------------------------------------- paying --- */
// A person pays `n` for something of `company`'s (its stream): with the consumption tax on top (the country's), out
// of their money; short of it, only what is needed to live is borrowed for (Tenesice's クイックローン, as far as it
// lends), the rest is not bought — and what nobody will lend for is not paid at all (a day missed: the trouble
// ladder's sign). Returns whether it was paid.
export function pay(W, i, n, essential = false) {
  const P = W.P;
  n = Math.round(n);
  if (n <= 0) return true;
  if (P.cash[i] < n) {
    if (!essential) return false;
    borrowFor(W, i, n - P.cash[i]);
    if (P.cash[i] < n) { P.miss[i] = Math.min(255, P.miss[i] + 1); return false; }
  }
  P.cash[i] -= n;
  P.spent[i] += n;
  return true;
}
// what the consumption tax adds to a price now (the people only: the players pay none)
export const withTax = (W, n) => Math.round(n * (1 + (W.nation.knobs.consumptionTax || 0) / 100));
export function buy(W, i, day, company, stream, n, essential = false) {
  // (in whole dollars, once: what the buyer pays is exactly what the company and the country get — not a cent lost)
  n = Math.round(n);
  const tax = Math.round(n * (W.nation.knobs.consumptionTax || 0) / 100);
  if (!pay(W, i, n + tax, essential)) return false;
  toStream(W, day, company, stream, n);
  if (tax) nationIn(W, 'consumption', tax);
  return true;
}
export function buyProduct(W, i, day, kind, id, count, unit, essential = false) {
  const n = unit * count, tax = Math.round(n * (W.nation.knobs.consumptionTax || 0) / 100);
  if (!pay(W, i, n + tax, essential)) return false;
  toProduct(W, day, kind === 'cars' ? 'carowner' : 'jinx', kind, id, count, n);
  if (tax) nationIn(W, 'consumption', tax);
  return true;
}
// to the local businesses (家賃・外食・病院・交通…): their takings, paid out again to their people (server/core/npc-state.js)
// (`what` it was for — food, living, rent, leisure, medical, other —: the local companies' sales of it, js/game/local.js)
export function toSector(W, i, n, essential = true, what = 'other') {
  if (!pay(W, i, n, essential)) return false;
  W.sector.cash += Math.round(n);
  W.sector.inPeople += Math.round(n);
  const by = W.sector.today || (W.sector.today = {});
  by['people:' + what] = (by['people:' + what] || 0) + Math.round(n);
  return true;
}
export function nationIn(W, kind, n) {
  n = Math.round(n);
  if (!n) return;
  W.nation.cash += n;
  const b = W.nation.day, mo = W.nation.month || (W.nation.month = { in: {}, out: {} });
  b.in[kind] = (b.in[kind] || 0) + n;
  mo.in[kind] = (mo.in[kind] || 0) + n;
}
export function nationOut(W, kind, n) {
  n = Math.round(n);
  if (!n) return;
  W.nation.cash -= n;
  const b = W.nation.day, mo = W.nation.month || (W.nation.month = { in: {}, out: {} });
  b.out[kind] = (b.out[kind] || 0) + n;
  mo.out[kind] = (mo.out[kind] || 0) + n;
}
export function districtIn(W, d, kind, n) {
  n = Math.round(n);
  if (!n) return;
  const x = W.districts[d];
  x.cash += n;
  x.day.in[kind] = (x.day.in[kind] || 0) + n;
}
export function districtOut(W, d, kind, n) {
  n = Math.round(n);
  if (!n) return;
  const x = W.districts[d];
  x.cash -= n;
  x.day.out[kind] = (x.day.out[kind] || 0) + n;
}
// money given from one person to another (a household's help, an inheritance)
export function give(W, from, to, n) {
  n = Math.round(Math.min(n, Math.max(0, W.P.cash[from])));
  if (n <= 0) return 0;
  W.P.cash[from] -= n;
  W.P.cash[to] += n;
  return n;
}

/* ------------------------------------------------------------- the money troubles --- */
// Short of money for what one must pay: テネシスのクイックローン (a high rate, up to what their pay and credit allow),
// lent out of Tenesice's own money (`W.bankRoom`: what it has of its own not lent yet, as of the last close, less
// what it lent since — a bank lends only its own money: no money is made by lending). Beyond that nothing: the payment
// is not made, and the trouble ladder (staying with someone, the street) is climbed each day by npc-state.js.
export function borrowFor(W, i, need) {
  const P = W.P;
  need = Math.ceil(need);
  const room = Math.max(0, Math.min(quickCap(P, i) - P.debt[i], bankRoom(W)));
  const take = Math.min(room, Math.max(need, Math.min(room, 1000000)));
  if (take > 0) {
    P.debt[i] += take;
    P.cash[i] += take;
    W.bankRoom -= take;
    if (P.dkind[i] !== 2) { P.dkind[i] = 2; W.sum.quickLoans++; }
    W.sum.lent += take;
  }
  return take;
}
// what Tenesice can still lend today (its own money not lent yet, server/core/corp-model.js: `bankFree` as of the last
// close, less what it lent since); before the companies live on the country, as much as is asked
export const bankRoom = (W) => (W.bankRoom === undefined || W.bankRoom === null ? Infinity : Math.max(0, W.bankRoom));
export const quickCap = (P, i) => Math.round(Math.max(NPC.trouble.quickBase, Math.min(NPC.trouble.quickMax, (P.salary[i] || 0) * 0.5)) * (0.5 + P.credit[i] / 255));
// the rate a person's loan pays a year: the usual (the bank's own rate for people) or the クイックローン
export const loanRate = (W, P, i) => (P.dkind[i] === 2 ? NPC.knobOf(W, 'quickRate') / 100 : W.bankRates.person);

/* ------------------------------------------------------------- the month's money --- */
// what of a month's fund (0 the slots, 1 the games, 2 the pleasures, 3 the market) a person lets themselves use today:
// the rest of it over the days left, the impulsive more at once
export function allowance(W, i, k, day) {
  const P = W.P, t = CORP.ymd(day), left = Math.max(1, CORP.monthEnd(day) - day + 1);
  const imp = P.tr[i * 18 + T.impulse] / 255;
  return Math.max(0, P.fund[i * 4 + k]) / left * (1.2 + 3 * imp * imp);
}

/* ------------------------------------------------------------- the casino --- */
// A session at the slots: `spins` spins of `bet` $, each paying back by the pay table's own odds (RTP 82%: the
// exact distribution of a centre line, from js/game/config.js). What is lost is Dtrade's; a big bet's win pays its
// fee; changing the tokens back costs the exchange fee. (A person's month of the slots: the monthly charge.)
let SLOT = null;
function slotTable() {
  if (SLOT) return SLOT;
  const C = RULES, syms = C.symbols, w = syms.map((s) => C.weights[s]);
  const dist = new Map();
  const line = [0, 0, 0, 0, 0];
  const walk = (k, p) => {
    if (k === 5) {
      let mult = 0;
      for (let s = 0; s < syms.length; s++) {
        let c = 0;
        for (const x of line) if (x === s) c++;
        const m = C.pays[syms[s]][c];
        if (m) mult += m;
      }
      dist.set(mult, (dist.get(mult) || 0) + p);
      return;
    }
    for (let s = 0; s < syms.length; s++) { line[k] = s; walk(k + 1, p * w[s]); }
  };
  walk(0, 1);
  const list = [...dist.entries()].sort((a, b) => a[0] - b[0]);
  const cum = [];
  let acc = 0, mean = 0;
  for (const [m, p] of list) { acc += p; cum.push([acc, m]); mean += m * p; }
  cum[cum.length - 1][0] = 1;
  SLOT = { cum, mean };
  return SLOT;
}
export function slotMean() { return slotTable().mean; }
function spinOnce(r) {
  const c = slotTable().cum, x = r.u();
  let lo = 0, hi = c.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c[mid][0] < x) lo = mid + 1; else hi = mid; }
  return c[lo][1];
}
export function casinoSession(W, i, day, budget, r) {
  const P = W.P, tp = RULES.tokenPrice;
  const bets = RULES.bets;
  // the bet: about a hundredth of what they brought, at a step of the game's own
  let bet = bets[0];
  for (const b of bets) if (b * tp <= budget / 60) bet = b;
  const unit = bet * tp;
  const spins = Math.max(5, Math.min(400, Math.round(budget / unit)));
  let staked = 0, back = 0, fee = 0, best = 0;
  const stop = budget * (0.5 + 0.5 * P.tr[i * 18 + T.patience] / 255);
  for (let k = 0; k < spins; k++) {
    if (staked - back > stop) break;
    staked += unit;
    const m = spinOnce(r), win = Math.floor(unit * m);
    back += win;
    if (m > best) best = m;
    if (bet >= RULES.casino.bigBet && win > 0) fee += Math.floor(win * (W.nation.knobs.winFee || 6) / 100);
    // (a big win is often where one stops)
    if (m >= 100 && r.u() < 0.6) break;
  }
  // (the tokens left are changed back to $ only when it is worth the fee; else kept for next time)
  const ex = W.nation.knobs.exchangeFee || RULES.casino.exchangeFee;
  const had = P.tokens[i];
  const left = had - Math.min(had, staked) + back - fee;
  const change = left > ex * 8 ? ex : 0;
  const fromCash = Math.max(0, staked - had);
  if (!pay(W, i, fromCash, false)) return null;
  if (change) { P.cash[i] += left - change; P.tokens[i] = 0; }
  else P.tokens[i] = left;
  const net = back - fee - staked;
  // (what the bets lost is Dtrade's; what was won beyond them, the country's treasury pays: 国庫)
  if (staked >= back) {
    const c = coFlow(W, day, 'dtrade');
    c.cas = (c.cas || 0) + staked - back;
    W.sum.toCo += staked - back;
  } else nationOut(W, 'casinoWins', back - staked);
  if (fee) toStream(W, day, 'dtrade', 'winfee', fee);
  if (change) toStream(W, day, 'dtrade', 'exchange', change);
  P.spun[i] = 1;
  W.sum.bets += staked;
  return { staked, back, net, best, bet: unit, cash: fromCash };
}
