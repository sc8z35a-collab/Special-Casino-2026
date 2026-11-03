// The big decisions (server/core/npc-life.js asks): a car, another job, a loan, a vote. Each is thought through a
// year ahead: the person's own guess of their months to come is drawn many times over (their pay and the chance of
// losing it, a raise or a strike, the family's costs, an illness, what the market and the slots may do), each future
// scored by what they care about (the status, the getting about, the safety of money in hand), with a loss weighing
// some 2.25 times a gain and the careful weighting the bad futures more; the family has its say; the impulsive stop
// thinking early. What decided it is kept, in words (the reason, server/core/npc-text.js).
import { NPC, RULES, CORP } from './rules.js';
import { T, S, N, E, E2, BL, NB, LS, NL, FL, HOME, NN, NT, REL, ageOf, remember, memberList, clampB, viewOf } from './npc-pop.js';
import * as econ from './npc-econ.js';
import * as heart from './npc-heart.js';

const tr = (P, i, k) => P.tr[i * NT + k] / 255;
const LOSS = 2.25;
// how many futures a decision draws, by the depth the country thinks at now (server/core/npc.js sets it)
export const DEPTHS = { shallow: 64, standard: 256, deep: 1024, deepest: 4096 };

// A year ahead (two for 選ばれし300人), month by month, for person `i` with option `o` ({ cost: paid now, monthly: paid
// each month, joy: a month's worth of it, pay: the monthly pay with it }): the score of the average future and of the
// worst tenth. Each future is drawn by what the person expects (npc-heart.js: losing their work, the market, the
// prices eating their money), and the bad things come together (a bad year: work lost the more often, the market down,
// the bills higher) as often as they fear it; the worried weigh the worst futures the more.
export function ahead(W, i, o, futures, r) {
  const P = W.P;
  const net = (o.pay !== undefined ? o.pay : (P.salary[i] || 0) / 12 + (P.penAmt[i] || 0)) * 0.78;
  const spend = Math.max(80000, P.budget[i] || 200000);
  const safe = Math.max(500000, spend * 3);
  const mind = !!P.emo2, wo = mind ? heart.worry(P, i) : 0;
  const careful = Math.min(0.9, tr(P, i, T.consc) + 0.3 * wo), risk = tr(P, i, T.risk);
  const lose = (mind ? Math.max(0.0005, P.belief[i * NB + BL.job] / 2000) : W.outlook.jobLoss) * (NPC.isCompanyJob(P.job[i]) ? 1 : 0.5);
  const drift = mind ? P.belief[i * NB + BL.mkt] / 127 * 0.3 / 12 : 0, infl = mind ? Math.max(0, P.belief[i * NB + BL.infl]) / 1000 / 12 : 0;
  const months = mind && P.flags[i] & FL.elite ? 24 : 12, badOdds = mind ? 0.1 + 0.25 * wo : 0;
  const scores = new Float64Array(futures);
  let total = 0;
  for (let f = 0; f < futures; f++) {
    let cash = P.cash[i] - o.cost, s = 0, job = 1;
    const bad = badOdds > 0 && r.u() < badOdds;
    const lost = bad ? lose * 2.5 : lose, shocks = bad ? 0.06 : 0.04, down = bad ? -0.02 : 0;
    for (let mth = 0; mth < months; mth++) {
      if (job && r.u() < lost) job = 0;
      else if (!job && r.u() < (bad ? 0.15 : 0.25)) job = 1;
      const shock = r.u() < shocks ? spend * (1 + 3 * r.u()) : 0;
      const luck = cash * ((drift + down) * risk + W.outlook.market * 0.01 * r.z() * risk);
      cash += (job ? net : net * 0.55) - spend * (1 + infl * mth) - (o.monthly || 0) - shock + luck;
      let u = (o.joy || 0);
      if (cash < safe) u -= LOSS * (safe - cash) / safe;
      else u += 0.15 * Math.log(1 + (cash - safe) / safe);
      s += u;
    }
    scores[f] = s * 12 / months;
    total += s * 12 / months;
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
  // (and by the person's own means and mind: what they let themselves spend against most people, a low sense of
  // themselves made up for with a car to be seen in — 代償消費 —, a car they were glad of before, a plan to go and look)
  const status = P.emo2 ? heart.tendency(P, i, 'compensate') * heart.lowEsteem(P, i) : 0;
  const means = P.emo2 ? Math.max(0.5, Math.min(2, Math.pow((Math.max(0, P.fund[i * 4 + 2]) + Math.max(0, P.wind[i]) * 0.3) / Math.max(1, W.cal.leisure), 0.3))) : 1;
  const urge = W.cal.carUrge * (have ? Math.min(2.5, years / 6) : 1.6) * (1 + ((W.appeal['magita:cars'] || 0) + econ.appealOf(W, 'carowner', 'cars') + (W.appeal['magita:all'] || 0) + (W.appeal['yosida:all'] || 0)) * 3) * (0.5 + tr(P, i, T.car)) * (0.6 + tr(P, i, T.vanity) * 0.8)
    * means * (1 + 1.5 * status) * (P.emo2 ? (1 + Math.max(0, P.lesson[i * NL + LS.luxury]) / 127 * 0.5) * (1 + Math.max(0, P.belief[i * NB + BL.infl] - 30) / 100) : 1);
  if (r.u() > urge) return false;
  const cars = W.carList || (W.carList = carList(ctx));
  const cap = Math.max(0, P.cash[i]) + loanRoom(W, i);
  // the models within reach, by how much they are wanted (the popular ones, and the dear ones for the vain)
  const cand = cars.filter((c) => c.price * 1.1 < cap && (!have || c.k !== have || years > 8));
  if (!cand.length) return false;
  // (in good times the dear cars, in bad the cheap ones: each maker's way with the economy, and what its development won it)
  // (and what they think of its maker, and the friends who drive one: what is seen about one is wanted — 流行)
  const friends = P.emo2 ? friendsCars(P, i) : null;
  const ws = cand.map((c) => c.npc * Math.pow(c.price / 30000000, 0.6 * tr(P, i, T.vanity) - 0.3) * (W.stock.cars[c.id] === 0 ? 0 : 1) * makerPull(W, c.id)
    * (friends ? (1 + 0.35 * (friends.get(c.k) || 0)) * Math.max(0.5, 1 + makerView(P, i, c.id) / 200) : 1));
  let pick = cand[r.weighted(ws)];
  if (!pick || ws[cand.indexOf(pick)] <= 0) return false;
  const tradeIn = have ? Math.round((carByIndex(have) ? carByIndex(have).price : 0) * Math.max(0.15, 0.6 - years * 0.05)) : 0;
  const base = DEPTHS[W.depth] || DEPTHS.standard;
  // (選ばれし300人 think deeper: four times the futures, two years ahead — npc-heart.js chooseElite)
  const futures = P.emo2 && P.flags[i] & FL.elite ? Math.min(DEPTHS.deepest, base * 4) : base;
  const n = tr(P, i, T.impulse) > 0.75 ? Math.max(16, futures >> 3) : futures;
  // (debt one has learnt to fear weighs on each month's payment)
  const dread = P.emo2 ? 1 + Math.max(0, -P.lesson[i * NL + LS.debt]) / 127 : 1;
  const optionFor = (c) => {
    const price = econ.withTax(W, c.price);
    const joy = 0.4 * tr(P, i, T.car) + 0.5 * tr(P, i, T.vanity) * Math.min(2, c.price / 30000000) + (have ? 0 : 0.6) + 0.6 * status * Math.min(2, c.price / 30000000);
    const cashPart = Math.min(price - tradeIn, Math.max(0, P.cash[i] - (P.budget[i] || 200000) * 2));
    const loan = Math.max(0, price - tradeIn - cashPart);
    return { id: c.id, car: c, price, loan, cost: cashPart, monthly: loan ? loan * (1 + W.bankRates.auto * 2.5) / 60 * dread : 0, joy };
  };
  // the choices: not now, the one wanted, and a cheaper one of those within reach (the careful's way out)
  const cheap = P.emo2 ? cand.filter((c, k) => ws[k] > 0 && c.price < pick.price * 0.7).sort((a, b) => b.price - a.price)[0] : null;
  const opts = [{ id: 'no', cost: 0, joy: 0 }, optionFor(pick)];
  if (cheap) opts.push(optionFor(cheap));
  const s = opts.map((o) => ahead(W, i, o, n, r));
  // the family's say (a careful spouse holds back a dear car)
  const sp = P.spouse[i];
  const say = (c) => (sp >= 0 ? (0.5 - tr(P, sp, T.thrift)) * 0.6 * Math.min(2, c.price / 30000000) : 0);
  const boycott = W.boycott.magita ? -0.8 * P.disc[i * 8 + 5] / 255 : 0;
  let best = 1, gain = s[1] - s[0] + say(pick) + boycott;
  if (cheap) { const g2 = s[2] - s[0] + say(cheap) + boycott; if (g2 > gain) { best = 2; gain = g2; } }
  const chosen = opts[best];
  pick = chosen.car;
  const price = chosen.price, loan = chosen.loan, cashPart = chosen.cost;
  if (gain <= 0) {
    if (r.u() < W.reasonLog) W.reasons.push({ i, day, kind: 'car-no', car: opts[1].id, price: opts[1].price, gain, loan: opts[1].loan, futures: n });
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
  if (W.carSold) W.carSold(pick.id); else if (W.stock.cars[pick.id] > 0) W.stock.cars[pick.id]--;
  P.car[i] = pick.k;
  P.carDay[i] = day;
  remember(P, i, day, 3, Math.min(255, Math.round(pick.price / 1000000)));
  econ_feel(P, i, 30);
  // (those close to them who mind such things see it: 見栄 — npc-heart.js envy)
  if (P.emo2) heart.envy(W, i, day, CORP.products.cars[pick.id] ? CORP.products.cars[pick.id].maker : null, Math.min(255, 60 + Math.round(pick.price / 1000000)));
  W.events.push({ kind: 'car', i, car: pick.id, price: pick.price, loan });
  if (r.u() < W.reasonLog * 4) W.reasons.push({ i, day, kind: 'car', car: pick.id, price, gain, loan, futures: n, tradeIn, cheaper: best === 2 ? opts[1].id : null, status: Math.round(status * 100) / 100, elite: !!(P.flags[i] & FL.elite) });
  return true;
}
// the cars those close to one drive (by model), and what one thinks of a car's maker
function friendsCars(P, i) {
  const out = new Map();
  for (let k = 0; k < REL; k++) { const j = P.rel[i * REL + k]; if (j >= 0 && P.close[i * REL + k] > 110 && P.car[j]) out.set(P.car[j], (out.get(P.car[j]) || 0) + 1); }
  return out;
}
function makerView(P, i, id) {
  const pr = CORP.products.cars[id], k = pr ? NPC.companies.indexOf(pr.maker) : -1;
  return k >= 0 ? viewOf(P, i, k) : 0;
}
function makerPull(W, id) {
  const pr = CORP.products.cars[id], m = pr && CORP.makers[pr.maker];
  if (!m) return 1;
  return Math.exp(m.beta * 3 * (W.econX || 0)) * ((W.makerEdge && W.makerEdge[pr.maker]) || 1);
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
  const opts = jobs.filter((o) => o.left > 0 && o.company !== (NPC.companyOf(now) || '')).map((o) => {
    const fit = W.fitFor(P, i, o.company);
    return { o, fit, worth: o.pay * (0.6 + 0.8 * fit) * (1 + viewOf(P, i, NPC.companies.indexOf(o.company)) / 400) };
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
  // the company's pick: most likely the fit and the skilled (and it may say no) — after its 書類選考 and 面接, which take
  // weeks: a day's asking an offer seldom (about 2-3 months out of work on average, as in Japan; before, two days, and
  // no one was ever out of work). One in work moving on looks for longer but is offered sooner when it comes.
  const screen = now === NPC.job.none || now === NPC.job.part ? NPC.labor.offerDaily : NPC.labor.offerDaily * 2;
  if (r.u() > screen) return false;
  if (r.u() > 0.25 + 0.6 * best.fit) { econ_feel(P, i, -6); return false; }
  W.hire(i, best.o, day, r);
  return true;
}
