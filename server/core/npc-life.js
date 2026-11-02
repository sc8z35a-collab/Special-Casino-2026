// A person's day (server/core/npc-model.js): what they must do now (sleep, work, class) by their timetable, and in
// their own time what they most want to do, chosen as a game's utility AI chooses (each thing worth the product of
// what speaks for it: their needs, their money, their character, what they remember of it, what they learned it
// does for them, who asked them along, the time and the place), with the draw of an impulsive person looser. The big
// things (a car, another job) are thought through a year ahead: npc-mind.js.
import { NPC, RULES, CORP, ASUKA } from './rules.js';
import { T, S, N, E, FL, HOME, NN, NT, REL, MEM, OWN, LEARN, ageOf, remember, addRelation, clampB, viewOf, setView, FIT } from './npc-pop.js';
import { hash32 } from './npc-rand.js';
import * as econ from './npc-econ.js';
import { thinkCar, thinkJob } from './npc-mind.js';
import * as asuka from './asuka.js';

const A = NPC.act;
const PL = Object.fromEntries(NPC.places.map((p, k) => [p, k]));
// what a company's people do at work, and where (the place on the map)
const WORKPLACE = { tenesice: 'bank', magita: 'factory', carowner: 'dealer', jinx: 'store', daizin: 'lounge', citywork: 'office', speedeed: 'office', dtrade: 'office', riru: 'studio', ice: 'studio', yosida: 'factory', wazima: 'factory', myway: 'studio' };
// the learned worth of each kind of free time (P.learn)
export const L = { casino: 0, game: 1, shop: 2, car: 3, lounge: 4, friends: 5, outing: 6, invest: 7, politics: 8, venture: 9, walk: 10, home: 11 };
// memories (P.mem): kind codes
export const M = { bigWin: 1, bigLoss: 2, car: 3, fired: 4, hired: 5, death: 6, married: 7, elected: 8, strike: 9, street: 10, loan: 11, promoted: 12, stockUp: 13, stockDown: 14, goodGame: 15, venture: 16, moved: 17, demo: 18, born: 19, recovered: 20, lostElection: 21, voted: 22, quit: 23, retired: 24 };

const tr = (P, i, k) => P.tr[i * NT + k] / 255;
const need = (P, i, k) => 1 - P.need[i * NN + k] / 255;           // how short of it (0: met, 1: wanting)
const fill = (P, i, k, v) => { const x = i * NN + k; P.need[x] = clampB(P.need[x] + v); };
const feel = (P, i, k, v) => { const x = i * 5 + k; P.emo[x] = clampB(P.emo[x] + v); };
const mood = (P, i) => P.emo[i * 5 + E.mood] / 255;
const learnt = (P, i, k) => P.learn[i * LEARN + k] / 128;          // 1: as expected; above: it does them good
function learn(P, i, k, sat) {
  const x = i * LEARN + k, rate = 0.08 + 0.12 * tr(P, i, T.learn);
  P.learn[x] = clampB(P.learn[x] + rate * (128 + 127 * sat - P.learn[x]));
}
// the last memory of a kind, its power and how many days ago (or null)
export function recall(P, i, kind, day) {
  let best = null;
  for (let k = 0; k < MEM; k++) {
    const v = P.mem[i * MEM + k];
    if (!v || ((v >> 8) & 0xff) !== kind) continue;
    const ago = ((day & 0xffff) - (v >>> 16) + 65536) % 65536;
    if (!best || ago < best.ago) best = { ago, power: v & 0xff };
  }
  return best;
}

/* ---------------------------------------------------------------- the timetable --- */
// what a person must be doing at minute `t` of a day (`off`: a day off): { kind, end } (end: the minute it ends)
export function obliged(W, i, t, off, day, jdow) {
  const P = W.P, job = P.job[i], h = hash32(i, 7);
  // sleep: most from about midnight to 6:30, the night owls later
  const owl = (h % 100) < 18, wake = 360 + (h % 90) + (owl ? 120 : 0) + (off ? 60 : 0), bed = owl ? 1500 : 1380 + (h % 60);
  if (t < wake && t >= (bed - 1440)) return { kind: 'sleep', end: wake };
  if (t >= bed) return { kind: 'sleep', end: 1440 + wake };
  if (P.flags[i] & FL.striking) return { kind: 'free', end: 1440 };
  if (P.health[i] < 60 && !(P.flags[i] & FL.student)) return { kind: 'sick', end: t + 120 };
  let sched = null, shift = P.shift[i];
  if (NPC.isCompanyJob(job)) sched = NPC.schedules[NPC.companySchedule[NPC.companyOf(job)]];
  else if (job === NPC.job.civil) sched = NPC.schedules.civil;
  else if (job === NPC.job.other) sched = NPC.schedules.other;
  else if (job === NPC.job.self) sched = NPC.schedules.self;
  else if (job === NPC.job.part) sched = NPC.schedules.part;
  else if (job === NPC.job.student) sched = NPC.schedules.student;
  if (!sched) return { kind: 'free', end: 1440 };
  // days off: a shop's people two weekdays of their own; everyone else the days off
  // (the weekday in Japan: its days begin at midnight there, not at 9:00)
  const dow = jdow !== undefined ? jdow : (day + 4) % 7;
  if (sched.off) { if (sched.days && ((h >>> 8) + dow) % 7 < sched.days) return { kind: 'free', end: 1440 }; }
  else if (off && !(job === 2 && W.overtime && W.overtime.magita)) return { kind: 'free', end: 1440 };
  const blk = sched.shifts ? sched.shifts[shift % sched.shifts.length] : sched.blocks[0];
  const flex = sched.flex ? ((h >>> 4) % sched.flex) - sched.flex / 2 : 0;
  const from = blk[0] + flex, to = blk[1] + flex + (W.crunch && W.crunch[job] ? 90 : 0);
  if (t >= from && t < to) {
    // the lunch hour of the offices and the bank
    if ((sched === NPC.schedules.office || sched === NPC.schedules.bank || sched === NPC.schedules.civil) && t >= 720 && t < 780) return { kind: 'lunch', end: 780 };
    return { kind: job === NPC.job.student ? 'study' : 'work', end: Math.min(to, t >= 720 || to <= 720 ? to : 720) };
  }
  return { kind: 'free', end: t < from ? from : 1440 };
}

/* ---------------------------------------------------------------- one person --- */
// A person whose time has come at minute `m` (index since 1970; `t` the minute of the day): what they do next, and
// how long for (P.due). Spending and its effects happen as they begin.
export function decide(W, i, m, t, j, r, ctx) {
  const P = W.P, day = Math.floor(m / 1440);
  // needs fall with time (a minute's worth for each minute since they were last looked at, within the hours about)
  const dt = Math.min(240, Math.max(1, m - P.upd[i]));
  P.upd[i] = m;
  decay(P, i, dt);
  const ob = obliged(W, i, t, j.off, day, j.w);
  const home = P.home[i] === HOME.street ? PL.street : PL.home;
  if (ob.kind === 'sleep') { set(W, i, A.sleep, home, P.dist[i], m, Math.min(ob.end - t, 600)); fill(P, i, N.rest, dt * 0.6); return; }
  if (ob.kind === 'sick') { set(W, i, A.hospital, PL.hospital, P.dist[i], m, 120); hospital(W, i, day, r); return; }
  if (ob.kind === 'work') return work(W, i, m, t, ob.end, r, ctx);
  if (ob.kind === 'study') { set(W, i, A.study, PL.school, 2, m, Math.min(ob.end - t, 120)); fill(P, i, N.achieve, 18); return; }
  if (ob.kind === 'lunch') return lunch(W, i, m, day, r);
  free(W, i, m, t, j, day, r, ctx);
}

function decay(P, i, dt) {
  const k = dt / 60;
  // (each need falls by its own pace an hour)
  const rate = [10, 6 + 6 * tr(P, i, T.gamble), 3 + 4 * tr(P, i, T.vanity), 2, 4, 6 + 6 * tr(P, i, T.extra), 9, 4, 1];
  for (let n = 0; n < NN; n++) { const x = i * NN + n; P.need[x] = Math.max(0, P.need[x] - Math.round(rate[n] * k)); }
  // feelings drift back towards how the person usually is
  const base = 150 + (P.emo[i * 5 + E.happy] - 128) * 0.3;
  const x = i * 5;
  P.emo[x + E.mood] = clampB(P.emo[x + E.mood] + (base - P.emo[x + E.mood]) * Math.min(1, 0.05 * k));
  P.emo[x + E.anger] = clampB(P.emo[x + E.anger] * Math.pow(0.97, k));
  P.emo[x + E.stress] = clampB(P.emo[x + E.stress] - 2 * k);
}

function set(W, i, act, place, dist, m, minutes) {
  const P = W.P;
  P.act[i] = act;
  P.place[i] = place;
  P.ldist[i] = dist;
  P.due[i] = m + Math.max(5, Math.round(minutes));
}

/* ------------------------------------------------------------------ at work --- */
function work(W, i, m, t, end, r, ctx) {
  const P = W.P, job = P.job[i];
  let place = PL.office, dist = P.wdist[i];
  if (NPC.isCompanyJob(job)) place = PL[WORKPLACE[NPC.companyOf(job)]];
  else if (job === NPC.job.civil) place = [PL.hall, PL.hospital, PL.school][hash32(i, 3) % 3];
  else if (job === NPC.job.other) place = hash32(i, 3) % 2 ? PL.office : PL.store;
  else if (job === NPC.job.self || job === NPC.job.part) place = PL.store;
  const len = Math.min(end - t, 90 + r.int(60));
  // managers spend part of their day in the meeting rooms
  const meet = P.rank[i] >= 2 && r.u() < 0.12 + 0.05 * P.rank[i];
  set(W, i, meet ? A.meeting : A.work, place, dist, m, len);
  // what an hour's work gives: the company's output (its 働き指数) and the person's tiredness and pride
  const sat = P.jsat[i] / 255;
  if (NPC.isCompanyJob(job)) {
    const id = NPC.companyOf(job);
    const k = (0.7 + 0.6 * skillFor(P, i, id)) * (0.75 + 0.5 * sat) * (0.85 + 0.3 * P.health[i] / 255) * (len / 60);
    W.work[id] = (W.work[id] || 0) + k;
    W.workHours[id] = (W.workHours[id] || 0) + len / 60;
  }
  fill(P, i, N.achieve, 10 * (0.5 + sat));
  fill(P, i, N.rest, -8);
  feel(P, i, E.stress, Math.round(4 * (1 - sat) - 1));
  fill(P, i, N.security, 3);
  // a word with a colleague now and then
  if (r.u() < 0.25) talk(W, i, m, r, true);
}
// (the skills each company wants: server/core/npc-pop.js FIT)
export function skillFor(P, i, id) { const s = FIT[id] || [S.manage, S.tech]; return (P.sk[i * 8 + s[0]] + P.sk[i * 8 + s[1]]) / 510; }

function lunch(W, i, m, day, r) {
  const P = W.P;
  set(W, i, A.lunch, PL.store, P.wdist[i], m, 45 + r.int(20));
  // (a lunch out: the local restaurants; now and then a snack from ジンクス)
  const n = Math.round(W.cal.lunch * (0.6 + 0.8 * r.u()) * (1 - 0.4 * tr(P, i, T.thrift)) * (1 + NPC.knobOf(W, 'livingCost') / 100));
  econ.toSector(W, i, n, false, 'food');
  if (r.u() < 0.3) econ.buy(W, i, day, 'jinx', 'goods', econ.spendAt(W, 'jinx:goods', n * 0.4), false);
  fill(P, i, N.rest, 25);
  fill(P, i, N.fun, 8);
  if (r.u() < 0.6) talk(W, i, m, r, true);
}

/* --------------------------------------------------------------- free time --- */
// what each thing in one's own time is worth now (the product of what speaks for it), drawn by those worths: the
// impulsive more by chance, the careful mostly the best
const OPTIONS = ['home', 'shop', 'car', 'casino', 'game', 'invest', 'lounge', 'friends', 'jobhunt', 'politics', 'parttime', 'demo', 'venture', 'walk', 'outing', 'bank'];
function free(W, i, m, t, j, day, r, ctx) {
  const P = W.P, age = ageOf(P, i, day), cash = P.cash[i], late = t >= 1260, evening = t >= 1080, off = j.off;
  const wealth = Math.max(0.05, cash / 60000000);
  const scores = new Float64Array(OPTIONS.length);
  const street = P.home[i] === HOME.street;
  const imp = tr(P, i, T.impulse), md = mood(P, i);
  // (what is open: the shops 10:00–21:00, the dealer 10:00–20:00, the casino and the games always)
  const shops = t >= 600 && t < 1260, dealer = t >= 600 && t < 1200;
  const fund = (k) => P.fund[i * 4 + k];
  scores[0] = 0.25 + need(P, i, N.rest) * 0.9 + (late ? 0.5 : 0) + 0.2 * (1 - tr(P, i, T.extra)) + (street ? -0.2 : 0);
  scores[1] = shops ? (0.15 + need(P, i, N.fun) * 0.35 + (off ? 0.2 : 0)) * Math.min(1.4, fund(2) / Math.max(1, W.cal.leisure) + 0.2) * learnt(P, i, L.shop) * (1 + econ.appealOf(W, 'jinx', 'goods')) / Math.sqrt(econ.priceOf(W, 'jinx:goods')) : 0;
  scores[2] = dealer ? (0.01 + 0.25 * tr(P, i, T.car) * (need(P, i, N.status) + need(P, i, N.move)) / 2) * (P.car[i] ? Math.min(1.5, (day - P.carDay[i]) / 1800) : 1.2) * Math.min(1.5, wealth) * learnt(P, i, L.car) * (off ? 1.4 : 0.6) : 0;
  const lossMem = recall(P, i, M.bigLoss, day);
  const burnt = lossMem && lossMem.ago < 10 ? (tr(P, i, T.gamble) > 0.75 ? 1.3 : 0.4) : 1;
  // (the first spin of a month costs the month's slot charge, $1M: only those who mean to play a lot start)
  const firstSpin = !P.spun[i] && fund(0) < NPC.life.casinoMonthly;
  // (the slots draw them more: NPC.life.casinoPull)
  scores[3] = !firstSpin && (fund(0) > W.cal.minBet || P.tokens[i] > W.cal.minBet) ? NPC.life.casinoPull * (0.05 + need(P, i, N.thrill) * 0.8 * tr(P, i, T.gamble)) * (0.6 + md) * (evening ? 1.4 : 0.8) * burnt * learnt(P, i, L.casino) * (W.boycott.dtrade ? 1 - 0.6 * P.disc[i * 8 + 6] / 255 : 1) * (1 + econ.appealOf(W, 'dtrade', 'casino')) : 0;
  scores[4] = (0.1 + need(P, i, N.fun) * 0.7 * tr(P, i, T.game)) * (evening ? 1.3 : 0.9) * learnt(P, i, L.game) * (age < 40 ? 1.2 : age > 65 ? 0.5 : 1);
  const stir = 1 + 15 * ((W.marketState && W.marketState.move) || 0);
  const holds = P.sh[i * 4] + P.sh[i * 4 + 1] + P.sh[i * 4 + 2] + P.sh[i * 4 + 3] > 0;
  scores[5] = fund(3) > 100000 || (holds && stir > 2) ? (0.03 + 0.4 * tr(P, i, T.risk) * tr(P, i, T.news)) * Math.min(1.5, wealth) * learnt(P, i, L.invest) * (t >= 540 && t < 600 || t >= 720 && t < 780 || t >= 1230 && t < 1290 ? 1.8 : 1) * stir : 0;
  scores[6] = P.vip[i] > day ? (0.15 + need(P, i, N.status) * 0.5 + need(P, i, N.social) * 0.3) * learnt(P, i, L.lounge) * (evening ? 1.3 : 1) * (1 + econ.appealOf(W, 'daizin', 'lounge')) : 0;
  scores[7] = (0.15 + need(P, i, N.social) * 0.9 * (0.5 + tr(P, i, T.extra))) * (off ? 1.5 : 1) * learnt(P, i, L.friends);
  const seeking = P.job[i] === NPC.job.none || (P.job[i] >= 1 && P.job[i] <= 12 && P.jsat[i] < 70);
  scores[8] = seeking && age < 66 && t < 1140 ? (P.job[i] === NPC.job.none ? 0.9 : 0.15) * (0.5 + need(P, i, N.security)) : 0;
  const angry = P.disc.subarray(i * 8, i * 8 + 8).reduce((a, b) => Math.max(a, b), 0) / 255;
  scores[9] = (0.01 + 0.5 * Math.max(0, angry - 0.45) * tr(P, i, T.justice) + (W.politics.campaign && P.flags[i] & FL.candidate ? 1.2 : 0) + (W.politics.campaign ? 0.04 : 0)) * learnt(P, i, L.politics);
  scores[10] = (cash < 2000000 || (age >= 18 && age <= 22)) && shops && P.job[i] !== NPC.job.retired ? 0.35 + (cash < 500000 ? 0.6 : 0) : 0;
  scores[11] = W.demoToday && W.demoToday[P.dist[i]] && (P.flags[i] & FL.moving) && t >= 600 && t < 1080 ? 0.9 : 0;
  scores[12] = shops && P.subs[i] ? 0.15 * learnt(P, i, L.venture) : 0;
  scores[13] = (0.12 + need(P, i, N.rest) * 0.2 + (age >= 60 ? 0.35 : 0)) * learnt(P, i, L.walk) * (t < 1140 ? 1 : 0.3);
  scores[14] = off && t >= 600 && t < 1200 ? (0.1 + need(P, i, N.fun) * 0.5) * Math.min(1.4, fund(2) / Math.max(1, W.cal.leisure) + 0.2) * learnt(P, i, L.outing) : 0;
  scores[15] = t >= 540 && t < 900 && !off && (P.debt[i] > 0 && cash > P.debt[i] * 0.3 || cash < 0) ? 0.08 : 0;
  if (street) for (const k of [1, 2, 5, 6, 12, 14]) scores[k] *= 0.1;
  // the draw: by the worths, raised to a power (the careful pick the best)
  const pow = 1.5 + 4 * (1 - imp);
  let total = 0;
  for (let k = 0; k < scores.length; k++) { scores[k] = Math.pow(Math.max(0, scores[k]), pow); total += scores[k]; }
  let x = r.u() * total, pick = 0;
  for (let k = 0; k < scores.length; k++) { x -= scores[k]; if (x <= 0) { pick = k; break; } }
  ACTIONS[OPTIONS[pick]](W, i, m, t, day, r, ctx, street);
}

const ACTIONS = {
  home(W, i, m, t, day, r, ctx, street) {
    const P = W.P;
    set(W, i, street ? A.homeless : A.home, street ? PL.street : PL.home, P.dist[i], m, 60 + r.int(90));
    fill(P, i, N.rest, 40);
    learn(P, i, L.home, 0.5 * need(P, i, N.rest));
    // a call or a message to someone close
    if (r.u() < 0.4) talk(W, i, m, r, false);
  },
  shop(W, i, m, t, day, r) {
    const P = W.P;
    const d = nearest(W, P.dist[i], 'store');
    set(W, i, A.shop, PL.store, d, m, 40 + r.int(60));
    const want = W.cal.leisure * (0.15 + 0.3 * r.u()) * (0.6 + 0.8 * tr(P, i, T.vanity)) * (1 - 0.5 * tr(P, i, T.thrift)) * Math.sqrt(econ.priceOf(W, 'jinx:goods'));
    const n = Math.round(Math.min(econ.allowance(W, i, 2, day) * 0.6, want));
    if (n > 1000 && econ.buy(W, i, day, 'jinx', 'goods', n, false)) P.fund[i * 4 + 2] -= n;
    shopItems(W, i, day, r);
    fill(P, i, N.fun, 30);
    fill(P, i, N.status, 10);
    feel(P, i, E.mood, 8);
    learn(P, i, L.shop, 0.4 + 0.3 * r.u() - 0.3 * tr(P, i, T.thrift));
  },
  car(W, i, m, t, day, r, ctx) {
    const P = W.P, d = nearest(W, P.dist[i], 'dealer');
    set(W, i, A.car, PL.dealer, d, m, 50 + r.int(70));
    fill(P, i, N.status, 12);
    // a look at the cars: the big decision, thought a year ahead (npc-mind.js)
    const got = thinkCar(W, i, day, r, ctx);
    learn(P, i, L.car, got ? 0.9 : 0.35);
    if (P.car[i]) econ.buy(W, i, day, 'carowner', 'service', econ.spendAt(W, 'carowner:service', W.cal.service * (0.3 + 0.7 * r.u())), false);
  },
  casino(W, i, m, t, day, r) {
    const P = W.P, d = nearest(W, P.dist[i], 'casino');
    set(W, i, A.casino, PL.casino, d, m, 60 + r.int(120));
    const budget = Math.min(econ.allowance(W, i, 0, day) * (0.6 + 0.8 * r.u()), Math.max(0, P.cash[i]) * 0.2);
    if (budget < W.cal.minBet) { fill(P, i, N.thrill, 10); return; }
    const out = econ.casinoSession(W, i, day, budget, r);
    if (!out) return;
    P.fund[i * 4] -= Math.min(P.fund[i * 4], out.cash);
    fill(P, i, N.thrill, 80);
    const rel = out.net / Math.max(1, budget);
    feel(P, i, E.mood, Math.round(30 * Math.max(-1, Math.min(1, rel))));
    if (out.best >= 100) { remember(P, i, day, M.bigWin, Math.min(255, Math.round(out.best / 4))); W.events.push({ kind: 'bigwin', i, n: out.net, mult: out.best }); }
    if (rel < -0.7) remember(P, i, day, M.bigLoss, Math.min(255, Math.round(-rel * 160)));
    learn(P, i, L.casino, Math.max(0, Math.min(1, 0.5 + rel * 0.6 + 0.2 * tr(P, i, T.gamble))));
    // (a regular buys the セーフティースロット now and then)
    if (r.u() < W.cal.charm) econ.buyProduct(W, i, day, 'items', 'omamori', 1, itemPrice('omamori'), false);
  },
  game(W, i, m, t, day, r, ctx) {
    const P = W.P;
    set(W, i, A.game, P.home[i] === HOME.street ? PL.street : PL.home, P.dist[i], m, 60 + r.int(120));
    fill(P, i, N.fun, 60);
    games(W, i, day, r, ctx);
    learn(P, i, L.game, 0.5 + 0.3 * tr(P, i, T.game));
  },
  invest(W, i, m, t, day, r, ctx) {
    const P = W.P;
    set(W, i, A.invest, PL.home, P.dist[i], m, 20 + r.int(30));
    W.market.think(W, i, day, r, ctx);
    fill(P, i, N.thrill, 15);
  },
  lounge(W, i, m, t, day, r) {
    const P = W.P;
    set(W, i, A.lounge, PL.lounge, 3, m, 80 + r.int(90));
    const n = Math.min(econ.allowance(W, i, 2, day), W.cal.lounge * (0.5 + r.u()));
    if (n > 0 && econ.buy(W, i, day, 'daizin', 'lounge', n, false)) P.fund[i * 4 + 2] -= n;
    fill(P, i, N.status, 60);
    fill(P, i, N.social, 40);
    learn(P, i, L.lounge, 0.7);
    if (r.u() < 0.5) talk(W, i, m, r, false);
  },
  friends(W, i, m, t, day, r) {
    const P = W.P;
    set(W, i, A.friends, r.u() < 0.5 ? PL.park : PL.store, P.dist[i], m, 60 + r.int(120));
    const n = W.cal.lunch * (0.5 + r.u());
    econ.toSector(W, i, n, false, 'food');
    fill(P, i, N.social, 80);
    fill(P, i, N.fun, 20);
    feel(P, i, E.mood, 10);
    talk(W, i, m, r, false);
    talk(W, i, m, r, false);
    learn(P, i, L.friends, 0.7);
  },
  jobhunt(W, i, m, t, day, r, ctx) {
    const P = W.P;
    set(W, i, A.jobhunt, PL.station, P.dist[i], m, 60 + r.int(60));
    thinkJob(W, i, day, r, ctx);
    fill(P, i, N.security, 5);
  },
  politics(W, i, m, t, day, r) {
    const P = W.P;
    set(W, i, A.politics, r.u() < 0.5 ? PL.hall : PL.square, P.dist[i], m, 60 + r.int(60));
    W.politics.act(W, i, day, r);
    fill(P, i, N.fair, 50);
    learn(P, i, L.politics, 0.6 * tr(P, i, T.justice));
  },
  parttime(W, i, m, t, day, r) {
    const P = W.P;
    set(W, i, A.parttime, PL.store, nearest(W, P.dist[i], 'store'), m, 180 + r.int(60));
    // バイト: the local businesses pay by the hour, out of their takings
    const pay = Math.round(Math.min(W.sector.cash * 0.0001, W.cal.hourly * 3.5));
    if (pay > 0) { W.sector.cash -= pay; W.sector.outPeople += pay; P.cash[i] += pay; P.inc[i] += pay; }
    fill(P, i, N.security, 15);
    fill(P, i, N.rest, -15);
  },
  demo(W, i, m, t, day, r) {
    const P = W.P;
    set(W, i, A.demo, PL.square, P.dist[i], m, 120 + r.int(60));
    W.politics.march(W, i, day);
    fill(P, i, N.fair, 80);
    feel(P, i, E.anger, -10);
    remember(P, i, day, M.demo, 120);
  },
  venture(W, i, m, t, day, r, ctx) {
    const P = W.P;
    set(W, i, A.venture, PL.store, nearest(W, P.dist[i], 'store'), m, 40 + r.int(40));
    W.ventureUse(W, i, day, r);
    fill(P, i, N.fun, 20);
  },
  walk(W, i, m, t, day, r) {
    const P = W.P;
    set(W, i, A.walk, PL.park, P.dist[i], m, 40 + r.int(50));
    fill(P, i, N.rest, 25);
    feel(P, i, E.stress, -8);
    learn(P, i, L.walk, 0.55);
    if (r.u() < 0.3) talk(W, i, m, r, false);
  },
  outing(W, i, m, t, day, r) {
    const P = W.P;
    set(W, i, A.outing, PL.park, r.int(5), m, 120 + r.int(120));
    const n = Math.round(Math.min(econ.allowance(W, i, 2, day) * 0.8, W.cal.leisure * (0.2 + 0.4 * r.u())));
    // (some outings are trips to アスカ・リゾート: its money, ATSUKA Vision's)
    if (n > 0 && W.asuka && r.u() < ASUKA.rules.tourism) { if (econ.pay(W, i, n, false)) { asuka.earned(W, n, 'resort'); P.fund[i * 4 + 2] -= n; } }
    else if (n > 0 && econ.toSector(W, i, n, false, 'leisure')) P.fund[i * 4 + 2] -= n;
    // (a little from the shops on the way)
    if (r.u() < 0.5) econ.buy(W, i, day, 'jinx', 'goods', econ.spendAt(W, 'jinx:goods', n * 0.25), false);
    fill(P, i, N.fun, 70);
    fill(P, i, N.social, 30);
    feel(P, i, E.mood, 15);
    learn(P, i, L.outing, 0.75);
  },
  bank(W, i, m, t, day, r) {
    const P = W.P;
    set(W, i, A.bank, PL.bank, P.dist[i], m, 30);
    // paying back what can be paid (the dear loan first)
    const back = Math.min(P.debt[i], Math.max(0, P.cash[i] - Math.max(1000000, (P.salary[i] || 1200000) / 6)));
    if (back > 0) { P.cash[i] -= back; P.debt[i] -= back; W.sum.repaid += back; if (P.debt[i] <= 0) { P.debt[i] = 0; P.dkind[i] = 0; } }
    fill(P, i, N.security, 30);
  }
};

// the district nearest one's own with a place of that kind (one's own if it has one)
function nearest(W, d, kind) {
  const D = NPC.districts;
  if (D[d].places[kind] && D[d].places[kind].length) return d;
  for (let k = 1; k < 5; k++) for (const x of [d + k, d - k]) if (x >= 0 && x < 5 && D[x].places[kind] && D[x].places[kind].length) return x;
  return d;
}

function hospital(W, i, day, r) {
  const P = W.P;
  // the bill: three tenths (two for the old) for the patient, the rest the country's health insurance
  const age = ageOf(P, i, day), bill = W.cal.medical * (0.5 + 2 * r.u()) * (age > 70 ? 2 : 1);
  const share = (age >= NPC.safety.oldFrom ? NPC.safety.medicalOld : NPC.safety.medical) * (1 + (W.nation.knobs.medical || 0) / 100);
  const own = Math.round(bill * share);
  econ.toSector(W, i, own, true, 'medical');
  const rest = Math.round(bill - own);
  econ.nationOut(W, 'medical', rest);
  W.sector.cash += rest;
  W.sector.inNation += rest;
  P.health[i] = clampB(P.health[i] + 15 + r.int(20));
}

// the Shop's items a person needs now and then (a car's petrol, oil and repairs; an engine for the keen)
const ITEM_PRICE = new Map(RULES.shop.map((x) => [x.id, x.price]));
export const itemPrice = (id) => ITEM_PRICE.get(id) || 0;
function shopItems(W, i, day, r) {
  const P = W.P;
  if (!P.car[i]) return;
  const c = W.cal.items;
  for (const id of ['gasoline-full', 'car-oil-medium', 'repair-kit']) {
    const n = r.poisson(c[id] || 0);
    if (n) econ.buyProduct(W, i, day, 'items', id, n, itemPrice(id), false);
  }
  if (tr(P, i, T.car) > 0.7) for (const id of ['engine-v1', 'engine-v2', 'engine-v3']) if (r.u() < (c[id] || 0)) econ.buyProduct(W, i, day, 'items', id, 1, itemPrice(id), false);
}

// The games: a new one from the studios (by its genre, how good it is said to be, how new, what friends say), now and
// then an older one, and what the people of the running games spend in them (the whales a lot).
function games(W, i, day, r, ctx) {
  const P = W.P, budget = Math.min(P.fund[i * 4 + 1], econ.allowance(W, i, 1, day) * 2);
  if (budget <= 0) return;
  const g = tr(P, i, T.game);
  const titles = W.titles || [];
  let spent = 0;
  for (const t of titles) {
    if (spent >= budget) break;
    const age = day - t.day;
    if (age < 0 || age > 400) continue;
    let own = false;
    for (let k = 0; k < OWN; k++) if (P.owned[i * OWN + k] === t.key) { own = true; break; }
    if (own) continue;
    const fans = t.buzz || 0.5;
    const p = W.cal.gameBuy * g * Math.exp((t.q - 72) / 12) * Math.exp(-age / 45) * (0.5 + fans) * (age < 7 ? 2 : 1);
    if (r.u() >= p) continue;
    // (an edition by what they can spend: the standard, the deluxe, the collector's)
    const ed = budget > t.price * 30 && r.u() < 0.4 ? 30 : budget > t.price * 3 && r.u() < 0.4 ? 3 : 1;
    const n = t.price * ed;
    if (n > budget - spent || !econ.pay(W, i, econ.withTax(W, n), false)) continue;
    const tax = econ.withTax(W, n) - n;
    if (tax) econ.nationIn(W, 'consumption', tax);
    econ.toTitle(W, day, t.company, t.id, 1, n);
    spent += n;
    // (kept in a free slot, else in place of an older one)
    let slot = -1;
    for (let k = 0; k < OWN; k++) if (!P.owned[i * OWN + k]) { slot = k; break; }
    P.owned[i * OWN + (slot >= 0 ? slot : (t.key + day) % OWN)] = t.key;
    if (t.q >= 85) remember(P, i, day, M.goodGame, t.q);
  }
  // the running games: a month's spending of a player of one, in pieces
  if (P.live[i]) {
    const l = (W.liveGames || [])[P.live[i] - 1];
    if (l) {
      // (in whole dollars, once: the game's money and the tax exactly what was paid)
      const n = Math.round(Math.min(budget - spent, W.cal.livePlay * Math.pow(Math.max(0.05, P.cash[i] / 60000000), 0.7) * g * g * (0.4 + 1.2 * r.u())));
      if (n > 1000 && econ.pay(W, i, econ.withTax(W, n), false)) {
        const tax = econ.withTax(W, n) - n;
        if (tax) econ.nationIn(W, 'consumption', tax);
        econ.toLive(W, day, l.company, l.id, n);
        spent += n;
      }
    }
  } else if (r.u() < 0.02 * g && W.liveGames && W.liveGames.length) P.live[i] = 1 + r.int(W.liveGames.length);
  // the older games (the catalogue)
  if (r.u() < W.cal.catalog * g) {
    const co = r.u() < 0.85 ? 'ice' : 'riru', n = 3000 + r.int(4) * 1000;
    if (n < budget - spent && econ.pay(W, i, econ.withTax(W, n), false)) {
      const tax = econ.withTax(W, n) - n;
      if (tax) econ.nationIn(W, 'consumption', tax);
      econ.toCatalog(W, day, co, n);
      spent += n;
    }
  }
  P.fund[i * 4 + 1] -= spent;
}

/* ---------------------------------------------------------------- talking --- */
// A word with someone (a colleague at work, a friend, the family at home; a message to one far away): their moods
// touch, their discontents and their views of the companies come a little nearer (more for the trusted, against for
// one far from them), news one of them knows passes on, and they get closer.
export function talk(W, i, m, r, work) {
  const P = W.P;
  let k = r.int(REL), j = P.rel[i * REL + k];
  if (work) {
    // (at work: a colleague, if one is known)
    for (let tries = 0; tries < 4 && (j < 0 || P.job[j] !== P.job[i]); tries++) { k = r.int(REL); j = P.rel[i * REL + k]; }
  }
  if (j < 0) return;
  const t = P.rtrust[i * REL + k] / 255;
  const xm = i * 5 + E.mood, ym = j * 5 + E.mood;
  const dm = (P.emo[ym] - P.emo[xm]) * 0.1;
  P.emo[xm] = clampB(P.emo[xm] + dm);
  P.emo[ym] = clampB(P.emo[ym] - dm * 0.5);
  // the subject: the theme one of them minds most
  let theme = 0, most = -1;
  for (let x = 0; x < 8; x++) { const v = Math.max(P.disc[i * 8 + x], P.disc[j * 8 + x]); if (v > most) { most = v; theme = x; } }
  const a = i * 8 + theme, b = j * 8 + theme;
  const far = Math.abs(P.lean[i * 2] - P.lean[j * 2]) > 90;
  const pull = (far ? -0.05 : 0.15) * t;
  const da = (P.disc[b] - P.disc[a]) * pull;
  P.disc[a] = clampB(P.disc[a] + da);
  P.disc[b] = clampB(P.disc[b] - da * 0.6);
  // a company spoken of
  const c = r.int(NPC.companies.length), va = viewOf(P, i, c);
  const dv = (viewOf(P, j, c) - va) * 0.1 * t;
  setView(P, i, c, Math.max(-127, Math.min(127, Math.round(va + dv))));
  // news passes on (what one of them knows, the other may now)
  const know = P.aware[j] & ~P.aware[i];
  if (know && r.u() < 0.35 + 0.4 * tr(P, i, T.news)) P.aware[i] |= know & (r.u() < 0.5 ? know : (know & -know));
  // closer, and the trust found or lost
  P.close[i * REL + k] = Math.min(255, P.close[i * REL + k] + 2);
  fill(P, i, N.social, 15);
  W.talks++;
  if (W.talkLog && r.u() < W.talkLog) W.convos.push({ i, j, theme, work: !!work, m });
  // a friend of a friend now and then
  if (!work && r.u() < 0.02) {
    const f = P.rel[j * REL + r.int(REL)];
    if (f >= 0 && f !== i) addRelation(P, i, f, 40, 100);
  }
}
