// テネシスリサーチ (server/core/corp-model.js researchDay: Tenesice's books, its members' fees and loans): Tenesice's research
// business, from 2026-11-03 for five years — the world's biggest research facilities, 10 in アスカ国 and 5 in ヴェルノア (no
// more are built), 350 researchers each at $3M to $12M a year, found and taken on first and fastest through シティーワーク
// (the biggest job site: $1.6M to it for each one taken on, the good ones drawn from where they work). Each facility's
// land rented of its country by the day ($4M in アスカ — a vast country, and Tenesice's capital before it —, $15M in
// ヴェルノア), its power, gas and water YAMATO's (billed each month, by the times). What it costs Tenesice pays day by
// day out of its own money (`need`, told to the companies' day with the flows: npc-model.js flowsFor); every $ of it from
// Tenesice to someone: the researchers (their pay, taxed as anyone's), the countries, YAMATO, シティーワーク.
import { NPC, CORP } from './rules.js';
import { T, S, FL, NT, ageOf, remember } from './npc-pop.js';
import * as econ from './npc-econ.js';
import * as asuka from './asuka.js';
import { M } from './npc-life.js';

export const RESEARCH_DAY = CORP.dayAt(2026, 11, 3);
export const LAB = {
  name: 'テネシスリサーチ', years: 5,
  sites: { asuka: 10, vernoa: 5 }, perSite: 350, pay: [3000000, 12000000],
  land: { asuka: 4000000, vernoa: 15000000 },
  referral: 1600000, site: 'citywork',
  // (taken on a day: a share of the places still open — the job site's fastest —, at least one)
  fill: 0.06
};
const YEAR = 365;
const scaleOf = (W) => W.scale || W.P.n / NPC.nation.population;

// a facility's researchers wanted in each country (a full country's, by its size)
const wantV = (W) => Math.max(1, Math.round(LAB.perSite * scaleOf(W)));
const wantA = (W) => (W.asuka ? Math.max(1, Math.round(LAB.perSite * W.asuka.scale)) : 0);

// The day (npc-state.js dayStart): founded on its day while Tenesice lives; its five years; who it takes on; the land's
// rent; the 25th's pay; the month's YAMATO bills; then what it owes paid of what Tenesice sent
export function day(W, d, r, ctx) {
  const corp = ctx && ctx.corp, bank = corp && corp.co && corp.co.tenesice;
  const alive = !!(bank && !bank.dead);
  if (!W.research && d >= RESEARCH_DAY && alive) found(W, d);
  const R = W.research;
  if (!R) return;
  if (R.on && (!alive || d >= R.until)) close(W, d, alive ? '5年の契約期間が終わりました' : 'テネシスが事業を撤廃しました');
  if (!R.on) return;
  hire(W, d, r);
  // (the land's rent, a day of it: to each country — ヴェルノア's treasury, アスカ国's)
  owe(R, 'landV', LAB.land.vernoa * LAB.sites.vernoa * scaleOf(W));
  if (W.asuka) owe(R, 'landA', LAB.land.asuka * LAB.sites.asuka * W.asuka.scale);
  const t = CORP.ymd(d);
  if (t.d === 25) payday(W, d);
  // (each facility's power, gas and water: YAMATO's month, dearer or cheaper with the times as the homes')
  if (CORP.isMonthEnd(d) && asuka.yamatoOn(W)) owe(R, 'yamato', asuka.YAMATO.lab * asuka.billLevel(W) * (LAB.sites.vernoa * scaleOf(W) + LAB.sites.asuka * (W.asuka ? W.asuka.scale : 0)));
  settle(W, d);
}
const owe = (R, k, n) => { R.owed[k] = (R.owed[k] || 0) + Math.round(n); };
function found(W, d) {
  const R = W.research = { since: d, until: d + LAB.years * YEAR, on: true, cash: 0, owed: {}, paid: {}, pay: LAB.pay.slice(),
    vernoaSites: [0, 1, 2, 3, 4].slice(0, LAB.sites.vernoa).map(() => wantV(W)), vernoaDist: [0, 1, 2, 3, 4].slice(0, LAB.sites.vernoa),
    asukaSites: Array.from({ length: LAB.sites.asuka }, () => wantA(W)), hired: 0, hiredHere: 0, feesPaid: 0, month: {} };
  W.news.push({ day: d, kind: 'nation', district: -1, text: `テネシスの新事業「テネシスリサーチ」が始まりました：アスカ国に${LAB.sites.asuka}か所・ヴェルノアに${LAB.sites.vernoa}か所の研究施設（各${LAB.perSite}人・年収$3M〜$12M）。シティーワークで研究者を最優先で募集します`, data: {} });
  return R;
}
// the five years over, or Tenesice gone: its researchers let go (the benefit), アスカ's too
function close(W, d, why) {
  const R = W.research, P = W.P;
  R.on = false; R.closed = d;
  for (let i = 0; i < P.n; i++) if (P.flags[i] & FL.research) W.labor.leave(W, i, d, 'fired');
  if (W.AP) for (let i = 0; i < W.AP.n; i++) if (W.AP.job[i] === asuka.JOB.research) { W.AP.job[i] = asuka.JOB.none; W.AP.pay[i] = 0; }
  W.news.push({ day: d, kind: 'nation', district: -1, text: `テネシスリサーチが終了しました（${why}）。研究者は職を離れます`, data: {} });
}
// ヴェルノア's researchers: the best of those of working age (by their technical and creative skills) taken on through
// シティーワーク — from wherever they work, the better pay drawing them —, at $3M to $12M by how good they are; a facility
// in each district. (アスカ's: asuka.js hire, a month at a time, the fee the same.)
function hire(W, d, r) {
  const R = W.research, P = W.P, sites = R.vernoaSites.length;
  const have = new Array(sites).fill(0);
  let all = 0;
  for (let i = 0; i < P.n; i++) if (P.flags[i] & FL.research) { have[P.wdist[i] % sites]++; all++; }
  const want = R.vernoaSites.reduce((a, b) => a + b, 0);
  let gap = want - all;
  if (gap <= 0) return;
  let take = Math.max(1, Math.ceil(gap * LAB.fill));
  const cand = [];
  for (let i = 0; i < P.n; i++) {
    if (P.flags[i] & (FL.research | FL.student | FL.mayor | FL.exec)) continue;
    const j = P.job[i], age = ageOf(P, i, d);
    if (age < 22 || age >= 60 || j === NPC.job.civil || j === NPC.job.retired || P.health[i] < 100) continue;
    const skill = (P.sk[i * 8 + S.tech] + P.sk[i * 8 + S.create]) / 510 + 0.15 * P.tr[i * NT + T.learn] / 255;
    if (skill < 0.55) continue;
    cand.push([i, skill + 0.1 * r.u()]);
  }
  cand.sort((a, b) => b[1] - a[1]);
  for (const [i, skill] of cand) {
    if (take <= 0) break;
    const k = have.indexOf(Math.min(...have));
    const pay = Math.round(LAB.pay[0] + (LAB.pay[1] - LAB.pay[0]) * Math.max(0, Math.min(1, (skill - 0.55) / 0.5)));
    // (drawn from their work only by a better pay)
    if (P.salary[i] >= pay && NPC.employed(P.job[i])) continue;
    if (NPC.working(P.job[i])) W.labor.leave(W, i, d, 'quit');
    P.job[i] = NPC.job.other; P.firm[i] = 0;
    P.flags[i] |= FL.research;
    P.jobless[i] = 0; P.joblessPay[i] = 0;
    P.salary[i] = pay; P.tenure[i] = 0; P.jsat[i] = 200; P.rank[i] = 0;
    P.wdist[i] = R.vernoaDist[k]; have[k]++;
    remember(P, i, d, M.hired, 170);
    owe(R, 'citywork', LAB.referral);
    R.hired++;
    take--; gap--;
  }
  W._staff = null;
}
// the 25th: a month's pay (taxed as anyone's) to each of them here and there, as far as its money goes
function payday(W, d) {
  const R = W.research, P = W.P;
  for (let i = 0; i < P.n; i++) if (P.flags[i] & FL.research) owe(R, 'payV', P.salary[i] / 12);
  if (W.AP) for (let i = 0; i < W.AP.n; i++) if (W.AP.job[i] === asuka.JOB.research) owe(R, 'payA', W.AP.pay[i] / 12);
  void d;
}
// what it owes paid of what Tenesice sent, the pay first: its researchers, the countries' rent, YAMATO, シティーワーク
function settle(W, d) {
  const R = W.research, P = W.P;
  // (アスカ's hires of the month, their fees: asuka.js)
  if (R.hiredHere) { owe(R, 'citywork', LAB.referral * R.hiredHere); R.hired += R.hiredHere; R.hiredHere = 0; }
  const paid = (k, n) => { R.cash -= n; R.owed[k] -= n; R.paid[k] = (R.paid[k] || 0) + n; R.month[k] = (R.month[k] || 0) + n; };
  if (R.owed.payV > 0 && R.cash > 0) {
    // (as far as what it owes and holds go: never a $ more than it has — those taken on since the 25th paid with them)
    const budget = Math.min(R.cash, R.owed.payV);
    let due = 0;
    for (let i = 0; i < P.n; i++) if (P.flags[i] & FL.research) due += P.salary[i] / 12;
    const ratio = due > 0 ? Math.min(1, budget / due) : 0;
    let n = 0;
    for (let i = 0; i < P.n; i++) if (P.flags[i] & FL.research) { const g = Math.floor(P.salary[i] / 12 * ratio); if (g > 0) { W.stateTake(i, g, d); n += g; } }
    paid('payV', n);
    if (R.owed.payV < 1 || !due) R.owed.payV = 0;
  }
  if (R.owed.payA > 0 && R.cash > 0 && W.AP) {
    const n = asuka.payResearch(W, Math.min(R.cash, R.owed.payA));
    paid('payA', n);
    if (R.owed.payA < 1) R.owed.payA = 0;
  }
  const part = (k, to) => { const n = Math.min(Math.max(0, R.cash), Math.max(0, R.owed[k] || 0)); if (n > 0) { paid(k, n); to(n); } };
  part('landV', (n) => econ.nationIn(W, 'landRent', n));
  // (アスカ's land and YAMATO's bills: paid abroad — ヴェルノア's imports, アスカ's exports)
  part('landA', (n) => { asuka.landRent(W, n); W.sum.imports += n; econ.gdpAcc(W).m += n; });
  part('yamato', (n) => { asuka.yamatoEarn(W, n, 'research'); W.sum.imports += n; econ.gdpAcc(W).m += n; });
  part('citywork', (n) => { econ.toStream(W, d, LAB.site, 'placement', n); R.feesPaid += n; });
}
// what it asks of Tenesice today: what it owes, and the pay coming on the 25th a day at a time
export function need(W) {
  const R = W.research;
  if (!R || !R.on) return 0;
  const P = W.P;
  let month = 0;
  for (let i = 0; i < P.n; i++) if (P.flags[i] & FL.research) month += P.salary[i] / 12;
  if (W.AP) for (let i = 0; i < W.AP.n; i++) if (W.AP.job[i] === asuka.JOB.research) month += W.AP.pay[i] / 12;
  const owed = Object.values(R.owed).reduce((a, b) => a + Math.max(0, b), 0);
  return Math.max(0, Math.round(owed + month / 30 - R.cash));
}
// what Tenesice sent (npc-state.js fromCompanies)
export function funded(W, n) { if (W.research && n > 0) W.research.cash += Math.round(n); }
export const cashOf = (W) => (W.research ? W.research.cash : 0);
// what 運営 sees
export function view(W) {
  const R = W.research;
  if (!R) return null;
  const P = W.P;
  let here = 0, pay = 0;
  for (let i = 0; i < P.n; i++) if (P.flags[i] & FL.research) { here++; pay += P.salary[i]; }
  let there = 0;
  if (W.AP) for (let i = 0; i < W.AP.n; i++) if (W.AP.job[i] === asuka.JOB.research) there++;
  return { name: LAB.name, on: R.on, since: R.since, until: R.until, cash: Math.round(R.cash), sites: { vernoa: R.vernoaSites.length, asuka: R.asukaSites.length },
    researchers: { vernoa: here, asuka: there, wanted: R.vernoaSites.reduce((a, b) => a + b, 0) + R.asukaSites.reduce((a, b) => a + b, 0) },
    avgPay: here ? Math.round(pay / here) : 0, hired: R.hired, feesPaid: R.feesPaid, paid: R.paid, owed: R.owed };
}
