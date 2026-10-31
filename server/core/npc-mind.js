// The big decisions (server/core/npc-life.js asks): a car, another job, a loan, a vote. Each is thought through a
// year ahead: the person's own guess of their months to come is drawn many times over (their pay and the chance of
// losing it, a raise or a strike, the family's costs, an illness, what the market and the slots may do), each future
// scored by what they care about (the status, the getting about, the safety of money in hand), with a loss weighing
// some 2.25 times a gain and the careful weighting the bad futures more; the family has its say; the impulsive stop
// thinking early. What decided it is kept, in words (the reason, server/core/npc-text.js).
import { NPC, RULES, CORP } from './rules.js';
import { T, S, N, E, FL, HOME, NN, NT, REL, ageOf, remember, memberList, clampB } from './npc-pop.js';
import * as econ from './npc-econ.js';

const tr = (P, i, k) => P.tr[i * NT + k] / 255;
const LOSS = 2.25;
// how many futures a decision draws, by the depth the country thinks at now (server/core/npc.js sets it)
export const DEPTHS = { shallow: 64, standard: 256, deep: 1024, deepest: 4096 };

// A year ahead, month by month, for person `i` with option `o` ({ cost: paid now, monthly: paid each month, joy: a
// month's worth of it, pay: the monthly pay with it }): the score of the average future and of the worst tenth.
export function ahead(W, i, o, futures, r) {
  const P = W.P;
  const net = (o.pay !== undefined ? o.pay : (P.salary[i] || 0) / 12 + (P.penAmt[i] || 0)) * 0.78;
  const spend = Math.max(80000, P.budget[i] || 200000);
  const safe = Math.max(500000, spend * 3);
  const careful = tr(P, i, T.consc), risk = tr(P, i, T.risk);
  const lose = W.outlook.jobLoss * (P.job[i] >= 1 && P.job[i] <= 10 ? 1 : 0.5);
  const scores = new Float64Array(futures);
  let total = 0;
  for (let f = 0; f < futures; f++) {
    let cash = P.cash[i] - o.cost, s = 0, job = 1;
    for (let mth = 0; mth < 12; mth++) {
      if (job && r.u() < lose) job = 0;
      else if (!job && r.u() < 0.25) job = 1;
      const shock = r.u() < 0.04 ? spend * (1 + 3 * r.u()) : 0;
      const luck = W.outlook.market * cash * 0.01 * r.z() * risk;
      cash += (job ? net : net * 0.55) - spend - (o.monthly || 0) - shock + luck;
      let u = (o.joy || 0);
      if (cash < safe) u -= LOSS * (safe - cash) / safe;
      else u += 0.15 * Math.log(1 + (cash - safe) / safe);
      s += u;
    }
    scores[f] = s;
    total += s;
  }
  const mean = total / futures;
  scores.sort();
  let worst = 0;
  const k = Math.max(1, Math.round(futures / 10));
  for (let x = 0; x < k; x++) worst += scores[x];
  worst /= k;
  return (1 - 0.5 * careful) * mean + 0.5 * careful * worst;
}

/* ---------------------------------------------------------------- a car --- */
const CARS = RULES.cars.filter((c) => c.price > 0 && !c.ended);
export function carList(ctx) { return CARS.map((c, k) => ({ id: c.id, k: k + 1, name: c.name, price: ctx.carPrice ? ctx.carPrice(c.id) : c.price, npc: CORP.products.cars[c.id] ? CORP.products.cars[c.id].npc : 50 })); }
export const carByIndex = (k) => CARS[k - 1] || null;

export function thinkCar(W, i, day, r, ctx) {
  const P = W.P;
  const have = P.car[i], years = have ? (day - P.carDay[i]) / 365 : 9;
  // only now and then does a look become a decision (an old car, a keen one, a status to keep up)
  const urge = W.cal.carUrge * (have ? Math.min(2.5, years / 6) : 1.6) * (1 + (W.appeal['magita:cars'] || 0) * 3) * (0.5 + tr(P, i, T.car)) * (0.6 + tr(P, i, T.vanity) * 0.8);
  if (r.u() > urge) return false;
  const cars = W.carList || (W.carList = carList(ctx));
  const cap = Math.max(0, P.cash[i]) + loanRoom(W, i);
  // the models within reach, by how much they are wanted (the popular ones, and the dear ones for the vain)
  const cand = cars.filter((c) => c.price * 1.1 < cap && (!have || c.k !== have || years > 8));
  if (!cand.length) return false;
  const ws = cand.map((c) => c.npc * Math.pow(c.price / 30000000, 0.6 * tr(P, i, T.vanity) - 0.3) * (W.stock.cars[c.id] === 0 ? 0 : 1));
  const pick = cand[r.weighted(ws)];
  if (!pick || ws[cand.indexOf(pick)] <= 0) return false;
  const price = econ.withTax(W, pick.price);
  const tradeIn = have ? Math.round((carByIndex(have) ? carByIndex(have).price : 0) * Math.max(0.15, 0.6 - years * 0.05)) : 0;
  const futures = DEPTHS[W.depth] || DEPTHS.standard;
  const n = tr(P, i, T.impulse) > 0.75 ? Math.max(16, futures >> 3) : futures;
  const joy = 0.4 * tr(P, i, T.car) + 0.5 * tr(P, i, T.vanity) * Math.min(2, pick.price / 30000000) + (have ? 0 : 0.6);
  const cashPart = Math.min(price - tradeIn, Math.max(0, P.cash[i] - (P.budget[i] || 200000) * 2));
  const loan = Math.max(0, price - tradeIn - cashPart);
  const opts = [
    { id: 'no', cost: 0, joy: 0 },
    { id: 'buy', cost: cashPart, monthly: loan ? loan * (1 + W.bankRates.auto * 2.5) / 60 : 0, joy }
  ];
  const s = opts.map((o) => ahead(W, i, o, n, r));
  // the family's say (a careful spouse holds back a dear car)
  let family = 0;
  const sp = P.spouse[i];
  if (sp >= 0) family = (0.5 - tr(P, sp, T.thrift)) * 0.6 * Math.min(2, pick.price / 30000000);
  const gain = s[1] - s[0] + family + (W.boycott.magita ? -0.8 * P.disc[i * 8 + 5] / 255 : 0);
  if (gain <= 0) {
    if (r.u() < W.reasonLog) W.reasons.push({ i, day, kind: 'car-no', car: pick.id, price, gain, loan, futures: n });
    return false;
  }
  // bought: the old one traded in (Car Owner pays for it: its used cars), the loan from Tenesice if any
  if (loan > 0) {
    P.debt[i] += loan;
    P.cash[i] += loan;
    if (!P.dkind[i]) P.dkind[i] = 1;
    W.sum.lent += loan;
    remember(P, i, day, 11, 80);
  }
  if (tradeIn) {
    P.cash[i] += tradeIn;
    W.flowsBuyback(day, tradeIn);
  }
  if (!econ.buyProduct(W, i, day, 'cars', pick.id, 1, pick.price, true)) return false;
  if (W.stock.cars[pick.id] > 0) W.stock.cars[pick.id]--;
  P.car[i] = pick.k;
  P.carDay[i] = day;
  remember(P, i, day, 3, Math.min(255, Math.round(pick.price / 1000000)));
  econ_feel(P, i, 30);
  W.events.push({ kind: 'car', i, car: pick.id, price: pick.price, loan });
  if (r.u() < W.reasonLog * 4) W.reasons.push({ i, day, kind: 'car', car: pick.id, price, gain, loan, futures: n, tradeIn });
  return true;
}
function econ_feel(P, i, v) { const x = i * 5 + E.mood; P.emo[x] = clampB(P.emo[x] + v); }
// what Tenesice would lend a person for a car now: by their pay and their credit, less what they owe
export function loanRoom(W, i) {
  const P = W.P;
  if (P.dkind[i] === 2 || P.credit[i] < 90) return 0;
  return Math.max(0, (P.salary[i] || 0) * 3 * (P.credit[i] / 200) - P.debt[i]);
}

/* ---------------------------------------------------------------- a job --- */
// Looking for work (or for better): the openings the companies have put out (through the two job sites), the pay and
// how well one fits, against staying; an offer if the company picks them from those who asked.
export function thinkJob(W, i, day, r, ctx) {
  const P = W.P, jobs = W.labor.openings;
  if (!jobs || !jobs.length) return false;
  const age = ageOf(P, i, day);
  if (age >= 65) return false;
  const now = P.job[i];
  // the openings worth asking at, best first
  const opts = jobs.filter((o) => o.left > 0 && o.company !== (now >= 1 && now <= 10 ? NPC.companies[now - 1] : '')).map((o) => {
    const fit = W.fitFor(P, i, o.company);
    return { o, fit, worth: o.pay * (0.6 + 0.8 * fit) * (1 + (P.view[i * 10 + NPC.companies.indexOf(o.company)] || 0) / 400) };
  }).sort((a, b) => b.worth - a.worth).slice(0, 3);
  if (!opts.length) return false;
  const best = opts[0];
  if (now !== NPC.job.none && now !== NPC.job.part) {
    // weighed a year ahead against staying (more pay, a better mood, the risk of a new place)
    const futures = Math.max(32, (DEPTHS[W.depth] || 256) >> 2);
    const stay = ahead(W, i, { cost: 0, joy: 0.3 * P.jsat[i] / 255 }, futures, r);
    const move = ahead(W, i, { cost: 0, joy: 0.3 * (0.4 + 0.4 * r.u()) - 0.1 * tr(P, i, T.loyalty), pay: best.o.pay / 12 }, futures, r);
    if (move - stay < 0.2) return false;
  }
  // the company's pick: most likely the fit and the skilled (and it may say no)
  if (r.u() > 0.25 + 0.6 * best.fit) { econ_feel(P, i, -6); return false; }
  W.hire(i, best.o, day, r);
  return true;
}
