// アスカ国 (js/game/asuka.js, docs/asuka-plan.md V2): the country beside ヴェルノア, a day at a time. Founded once
// with its money printed that day (found: its people's, its treasury's, ATSUKA Vision's, its national bank's own, the
// drawing fund's, its pensions', its local trade's), never again; from then on every $ goes from someone to someone —
// to and from ヴェルノア too:
// - ヴェルノア → アスカ: what ヴェルノア buys abroad (its imports: ATSUKA Vision's materials, energy, port, platforms:
//   toAbroad, server/core/npc-econ.js), its people's trips (アスカ・リゾート), and what its companies pay for their
//   branches here (their people's pay, the land's rent, their taxes, the buildings ATSUKA Vision puts up for them).
// - アスカ → ヴェルノア: what its people buy at those branches (`toCo`, the companies' sales as their day closes:
//   server/core/corp-model.js asukaDay) and what ATSUKA Vision buys of ヴェルノア's makers (into `W.abroad`, what the
//   world outside buys of the country with: corp-model abroadBuys).
// Its people are lighter than ヴェルノア's: typed arrays (`W.AP`, kept as blobs of their own, server/core/npc.js), a day's
// spending, a month's pay, pensions and jobs, deaths and new lives at 18 (their money the treasury's, as ヴェルノア's).
import { ASUKA, NPC, CORP } from './rules.js';
import { seeded } from './npc-rand.js';

const R = ASUKA.rules, CATS = ASUKA.cats, DIV = ASUKA.atsuka.divisions, YEAR = 365;
export const JOB = { none: 0, atsuka: 1, trade: 2, branch: 3, student: 4, retired: 5 };
const COS = NPC.companies;
const NC = CATS.length;
const COLS = [['birth', Int32Array, 1], ['dist', Uint8Array, 1], ['job', Uint8Array, 1], ['emp', Uint8Array, 1], ['gen', Uint16Array, 1],
  ['taste', Uint8Array, NC], ['pay', Float64Array, 1], ['cash', Float64Array, 1], ['debt', Float64Array, 1], ['miss', Uint8Array, 1]];

/* --------------------------------------------------------------- the people --- */
export function alloc(n) {
  const A = { n };
  for (const [name, T, w] of COLS) A[name] = new T(n * w);
  return A;
}
// the arrays as blobs (of at most ~1MB each) and back
export function pack(A) {
  const parts = COLS.map(([name]) => new Uint8Array(A[name].buffer, A[name].byteOffset, A[name].byteLength));
  const total = parts.reduce((a, p) => a + p.byteLength, 0), all = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  const rows = [], STEP = 1000000;
  for (let k = 0; k < total; k += STEP) rows.push(all.slice(k, Math.min(total, k + STEP)));
  return rows;
}
export function unpack(A, rows) {
  let total = 0;
  for (const r of rows) total += r.byteLength;
  const all = new Uint8Array(total);
  let at = 0;
  for (const r of rows) { all.set(r instanceof Uint8Array ? r : new Uint8Array(r), at); at += r.byteLength; }
  at = 0;
  for (const [name] of COLS) {
    const a = A[name], len = a.byteLength;
    if (at + len > total) throw new Error('asuka: the blobs are shorter than the people');
    new Uint8Array(a.buffer, a.byteOffset, len).set(all.subarray(at, at + len));
    at += len;
  }
  return A;
}
export const ageOf = (A, i, day) => Math.floor((day - A.birth[i]) / 365.25);
// a person's share of the people's founding money: by age, pay and luck (the shape of ヴェルノア's: npc-pop startMoney)
const AGEW = (a) => (a < 30 ? 0.25 : a < 40 ? 0.6 : a < 50 ? 1 : a < 60 ? 1.4 : a < 70 ? 1.7 : a < 80 ? 1.6 : 1.4);
const weightOf = (age, pay, z) => AGEW(age) * (pay > 0 ? Math.pow(pay / R.pay.atsuka, 0.6) : 0.8) * Math.exp(0.9 * z);
const compIdx = (id) => COS.indexOf(id);
// the year's pay of a post (its own, a little either way)
const payFor = (job, r, age) => Math.round((job === JOB.atsuka ? R.pay.atsuka : job === JOB.trade ? R.pay.trade : R.pay.branch) * (0.8 + 0.4 * r.u()) * (1 + Math.max(0, Math.min(35, age - 25)) * 0.01));

/* --------------------------------------------------------------- the founding --- */
// アスカ国 is founded (once): its people (a country of `population`, by ヴェルノア's size), their posts, and its money —
// `founding.total` printed this day and given out by its parts (the people's by their ages and luck). Returns how
// much money was made (the money ledger's `founded`).
export function found(W, day) {
  if (W.asuka) return 0;
  const r = seeded(W.key, 'asuka:found'), sc = W.P.n / NPC.nation.population;
  const n = Math.max(300, Math.round(R.population * sc));
  const A = alloc(n);
  const posts = { atsuka: Math.round(R.jobs.atsuka * sc), trade: Math.round(R.jobs.trade * sc) };
  const order = [];
  for (let i = 0; i < n; i++) {
    // (a young country: most of working age)
    const u = r.u(), age = u < 0.12 ? 18 + r.int(5) : u < 0.86 ? 23 + r.int(42) : 65 + r.int(30);
    A.birth[i] = day - Math.ceil(age * 365.25) - r.int(365);
    A.dist[i] = r.int(ASUKA.districts.length);
    A.gen[i] = 1;
    for (let k = 0; k < NC; k++) A.taste[i * NC + k] = r.int(256);
    if (age < 23 && r.u() < 0.6) A.job[i] = JOB.student;
    else if (age >= 65) A.job[i] = JOB.retired;
    else { A.job[i] = JOB.none; order.push(i); }
  }
  // the posts: the state's first, then the local trade's (the rest looking for work, the branches to come)
  for (let k = order.length - 1; k > 0; k--) { const j = r.int(k + 1); const t = order[k]; order[k] = order[j]; order[j] = t; }
  let a = posts.atsuka, t = posts.trade;
  for (const i of order) {
    const age = ageOf(A, i, day);
    if (a > 0) { A.job[i] = JOB.atsuka; A.emp[i] = pickDivision(r); A.pay[i] = payFor(JOB.atsuka, r, age); a--; }
    else if (t > 0) { A.job[i] = JOB.trade; A.pay[i] = payFor(JOB.trade, r, age); t--; }
  }
  // the money, printed once: its parts (the people's what is left of the whole, to the dollar)
  const F = R.founding, total = Math.round(F.total * sc);
  const part = (k) => Math.round(total * F[k]);
  const atsuka = part('atsuka'), treasury = part('treasury'), bank = part('bank'), boost = part('boost'), pension = part('pension'), trade = part('trade');
  const people = total - atsuka - treasury - bank - boost - pension - trade;
  const w = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) { w[i] = weightOf(ageOf(A, i, day), A.pay[i], r.z()); sum += w[i]; }
  const factor = people / sum;
  let given = 0;
  for (let i = 0; i < n; i++) { A.cash[i] = Math.floor(w[i] * factor); given += A.cash[i]; }
  W.AP = A;
  W.asuka = {
    founded: day, day, n, scale: sc, factor, total, posts,
    treasury: treasury + (people - given), atsuka: { cash: atsuka, rev: {}, month: {}, procured: 0, revDay: 0 },
    bank: { own: bank, lent: 0 }, boost: { cash: boost, paid: 0 }, pension: { cash: pension }, trade: { cash: trade, month: 0 },
    toCo: {}, want: {}, branches: {}, staffCo: {}, month: { in: {}, out: {} }, stats: {}, hist: [], news: [],
    sum: { fromVernoa: 0, toVernoa: 0, born: 0, deaths: 0, hires: 0 }
  };
  say(W, day, `アスカ国が建国されました。建国資金${CORP.fmt.money(total)}を一度だけ発行し、国民${n.toLocaleString('en-US')}人・国庫・ATSUKA Vision・国立銀行・企業誘致の資金・年金・地元の商売に配りました。これからはお金を発行しません`);
  return total;
}
function pickDivision(r) {
  let u = r.u();
  for (let k = 0; k < DIV.length; k++) { u -= DIV[k].part; if (u <= 0) return k; }
  return DIV.length - 1;
}
const say = (W, day, text) => { const a = W.asuka; a.news.push({ day, text }); if (a.news.length > 80) a.news.shift(); if (W.news) W.news.push({ day, kind: 'asuka', district: -1, text: `【アスカ国】${text}`, data: {} }); };
const tin = (a, k, n) => { if (n) a.month.in[k] = (a.month.in[k] || 0) + n; };
const tout = (a, k, n) => { if (n) a.month.out[k] = (a.month.out[k] || 0) + n; };

/* ------------------------------------------------------------ all its money --- */
// アスカ国's money, net of what its people owe its bank (which counts what it lent: the two cancel), and what is on its
// way to ヴェルノア's companies (the money ledger: server/core/npc-model.js moneyOf)
export function moneyOf(W) {
  const a = W.asuka, A = W.AP;
  if (!a || !A) return 0;
  let x = 0;
  for (let i = 0; i < A.n; i++) x += A.cash[i] - A.debt[i];
  x += a.treasury + a.atsuka.cash + a.bank.own + a.bank.lent + a.boost.cash + a.pension.cash + a.trade.cash;
  for (const v of Object.values(a.toCo)) for (const n of Object.values(v)) x += n;
  return x;
}

/* -------------------------------------------------------- from ヴェルノア --- */
// what ヴェルノア pays it: its imports (to ATSUKA Vision: its materials and energy — the platforms' fees its digital
// division's), its people's trips (アスカ・リゾート)
export function earned(W, n, division = 'materials') {
  const a = W.asuka;
  n = Math.round(n);
  if (!a || !(n > 0)) return false;
  a.atsuka.cash += n;
  // (goods shipped from アスカ: the port's fee on them, ATSUKA Vision's harbour's part of it)
  const port = division === 'materials' ? Math.round(n * ASUKA.atsuka.port) : 0;
  if (port) a.atsuka.rev.port = (a.atsuka.rev.port || 0) + port;
  a.atsuka.rev[division] = (a.atsuka.rev[division] || 0) + n - port;
  a.atsuka.revDay += n;
  a.sum.fromVernoa += n;
  tin(a, 'atsuka:' + division, n);
  return true;
}
// what ヴェルノア's companies paid it as their day closed (server/core/corp-model.js asukaDay): their branches' people's
// pay, the land's rent and the buildings put up for them (ATSUKA Vision's zone), their taxes, the stores' fees
export function fromCompanies(W, x, day) {
  const a = W.asuka, A = W.AP;
  if (!a || !x) return;
  for (const [co, n0] of Object.entries(x.pay || {})) {
    const n = Math.round(n0), k = compIdx(co);
    if (!(n > 0)) continue;
    a.sum.fromVernoa += n;
    let total = 0;
    const staff = [];
    for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.branch && A.emp[i] === k) { staff.push(i); total += A.pay[i]; }
    // (nobody there yet: the local trade's, for the work done for it)
    if (!staff.length) { a.trade.cash += n; continue; }
    let left = n;
    staff.forEach((i, j) => { const g = j === staff.length - 1 ? left : Math.floor(n * A.pay[i] / Math.max(1, total)); left -= g; income(W, i, g); });
  }
  for (const [k, div] of [['rent', 'zone'], ['open', 'zone'], ['platform', 'digital']]) if (x[k] > 0) earned(W, x[k], div);
  if (x.tax > 0) { a.treasury += Math.round(x.tax); a.sum.fromVernoa += Math.round(x.tax); tin(a, 'branchTax', Math.round(x.tax)); }
  // (what its people paid a company that failed before its day closed: back to the local trade that served them)
  if (x.refund > 0) { a.trade.cash += Math.round(x.refund); a.sum.fromVernoa += Math.round(x.refund); }
  if (x.branches) branchesSet(W, x.branches);
  // (the drawing fund's part of the new branches' buildings: to ATSUKA Vision's zone)
  if (x.boost > 0) { const n = Math.min(a.boost.cash, Math.round(x.boost)); a.boost.cash -= n; a.boost.paid += n; a.atsuka.cash += n; a.atsuka.rev.zone = (a.atsuka.rev.zone || 0) + n; tout(a, 'boost', n); }
  void day;
}
// a person's pay in: the income tax the treasury's, the rest theirs
function income(W, i, gross) {
  const a = W.asuka, A = W.AP;
  const tax = Math.round(gross * R.tax.income);
  A.cash[i] += gross - tax;
  a.treasury += tax;
  tin(a, 'income', tax);
}

/* --------------------------------------------------------------- the day --- */
// The day of アスカ国 (`day`, after ヴェルノア's companies closed theirs): ATSUKA Vision buys of ヴェルノア's makers, its
// people spend (the local trade, the branches as far as they can serve them), its month on its last day; deaths and
// new lives.
export function day(W, day, ext) {
  const a = W.asuka, A = W.AP;
  if (!a || !A) return;
  if (ext && ext.asuka) fromCompanies(W, ext.asuka, day);
  const r = seeded(W.key, 'asuka:d:' + day), t = CORP.ymd(day);
  a.day = day;
  procure(W);
  spend(W, day);
  lives(W, day, r);
  if (t.d === 15) pensions(W);
  if (t.d === 25) payday(W, day);
  if (CORP.isMonthEnd(day)) month(W, day, r);
}
// ATSUKA Vision buys of ヴェルノア's makers (machines, vehicles, systems, seeds): a part of its money and of what it earns,
// a day of it into what the world outside buys of ヴェルノア with (W.abroad: corp-model abroadBuys)
function procure(W) {
  const a = W.asuka, z = a.atsuka;
  z.revAvg = (z.revAvg || 0) * 29 / 30 + z.revDay / 30;
  z.revDay = 0;
  const n = Math.max(0, Math.min(z.cash, Math.round((z.cash * ASUKA.atsuka.procure + z.revAvg * YEAR * ASUKA.atsuka.procureRevenue) / YEAR)));
  if (n <= 0) return;
  z.cash -= n;
  z.procured += n;
  W.abroad.cash += n;
  a.sum.toVernoa += n;
  tout(a, 'procure', n);
}
// what a person would spend a day: of what they hold and of what they earn a year (net)
const dayBudget = (A, i, yearly) => (Math.max(0, A.cash[i]) * R.spend.wealth + yearly * R.spend.income) / YEAR;
function yearlyOf(A, i) {
  const j = A.job[i];
  if (j === JOB.atsuka || j === JOB.trade || j === JOB.branch) return A.pay[i] * (1 - R.tax.income);
  if (j === JOB.retired) return R.pension;
  return 0;
}
// The people's spending of the day: what they need (the local trade, with the consumption tax), and the rest as their
// tastes go — at ヴェルノア's companies' branches as far as there are branches to serve them (what cannot be bought is
// kept); short of money for what they need, the national bank lends (of its own money), else it is not paid.
function spend(W, day) {
  const a = W.asuka, A = W.AP, taxr = R.tax.consumption;
  // the branches' room today (a category without a branch sells nothing; a digital one, all)
  const room = new Float64Array(NC), want = new Float64Array(NC);
  CATS.forEach((c, k) => {
    if (c.digital) { room[k] = Infinity; return; }
    let cap = 0;
    for (const [co] of ASUKA.companiesOf(c)) cap += ((a.branches && a.branches[co] && a.branches[co][c.id]) || 0) * c.cap * a.scale / YEAR;
    room[k] = cap;
  });
  const disc = 1 - R.spend.living;
  // (first what everyone would buy, then each its part of what can be bought)
  for (let i = 0; i < A.n; i++) {
    const b = dayBudget(A, i, yearlyOf(A, i)) * disc;
    if (b <= 0) continue;
    let tw = 0;
    for (let k = 0; k < NC; k++) tw += CATS[k].share * (0.5 + A.taste[i * NC + k] / 255);
    for (let k = 0; k < NC; k++) want[k] += b * CATS[k].share * (0.5 + A.taste[i * NC + k] / 255) / tw;
  }
  const ratio = new Float64Array(NC);
  for (let k = 0; k < NC; k++) {
    ratio[k] = want[k] > 0 ? Math.min(1, room[k] / want[k]) : 0;
    // (what the people would spend in it a year: what the companies read when they plan their branches)
    a.want[CATS[k].id] = Math.round((a.want[CATS[k].id] || want[k] * YEAR) * 0.97 + want[k] * YEAR * 0.03);
  }
  const bought = new Float64Array(NC);
  let living = 0, tax = 0;
  for (let i = 0; i < A.n; i++) {
    const yearly = yearlyOf(A, i), all = dayBudget(A, i, yearly);
    if (all <= 0) continue;
    // what one needs: food, rent, the rest (the local trade's; with the consumption tax)
    const need = Math.round(all * R.spend.living), needTax = Math.round(need * taxr);
    if (A.cash[i] < need + needTax) borrow(W, i, need + needTax - A.cash[i], yearly);
    if (A.cash[i] >= need + needTax) { A.cash[i] -= need + needTax; living += need; tax += needTax; if (A.miss[i]) A.miss[i] = 0; }
    else { A.miss[i] = Math.min(255, A.miss[i] + 1); continue; }
    let tw = 0;
    for (let k = 0; k < NC; k++) tw += CATS[k].share * (0.5 + A.taste[i * NC + k] / 255);
    const b = all * disc;
    for (let k = 0; k < NC; k++) {
      if (!ratio[k]) continue;
      const n = Math.round(b * CATS[k].share * (0.5 + A.taste[i * NC + k] / 255) / tw * ratio[k]), nt = Math.round(n * taxr);
      if (n <= 0 || A.cash[i] < n + nt) continue;
      A.cash[i] -= n + nt;
      bought[k] += n;
      tax += nt;
    }
  }
  a.trade.cash += living;
  a.trade.month += living;
  tin(a, 'trade', living);
  a.treasury += tax;
  tin(a, 'consumption', tax);
  // what was bought at each company, on its way to it (its sales as the companies' day closes)
  CATS.forEach((c, k) => {
    if (!bought[k]) return;
    const cos = ASUKA.companiesOf(c);
    let left = bought[k];
    cos.forEach(([co, share], j) => {
      const n = j === cos.length - 1 ? left : Math.round(bought[k] * share);
      left -= n;
      const box = a.toCo[co] || (a.toCo[co] = {});
      box[c.id] = (box[c.id] || 0) + n;
      a.sum.toVernoa += n;
    });
    tout(a, 'cat:' + c.id, bought[k]);
  });
}
// the national bank lends what one needs to live (of its own money, up to what their pay allows)
function borrow(W, i, need, yearly) {
  const a = W.asuka, A = W.AP;
  const cap = Math.max(1000000, yearly * R.bank.quickCap) - A.debt[i];
  const n = Math.round(Math.max(0, Math.min(need + 100000, cap, a.bank.own)));
  if (n <= 0) return;
  A.debt[i] += n; A.cash[i] += n;
  a.bank.own -= n; a.bank.lent += n;
}
// the pensions, from their fund (the treasury filling it when it runs dry)
function pensions(W) {
  const a = W.asuka, A = W.AP, each = Math.round(R.pension / 12);
  let n = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.retired) n++;
  const due = n * each;
  if (a.pension.cash < due) { const add = Math.min(Math.max(0, a.treasury), due - a.pension.cash); a.treasury -= add; a.pension.cash += add; tout(a, 'pensionFund', add); }
  const ratio = due > 0 ? Math.min(1, a.pension.cash / due) : 0;
  const paid = Math.floor(each * ratio);
  if (paid <= 0) return;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.retired) A.cash[i] += paid;
  a.pension.cash -= paid * n;
  tout(a, 'pension', paid * n);
}
// the 25th: the state's people (ATSUKA Vision's money; the treasury tops it up), the local trade's; what the local trade
// took beyond its pay and its cushion, to its owners (by what they have); the unemployed's benefit (the treasury's)
function payday(W, day) {
  const a = W.asuka, A = W.AP, z = a.atsuka;
  let due = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.atsuka) due += Math.round(A.pay[i] / 12);
  if (z.cash < due) { const add = Math.min(Math.max(0, a.treasury), due - z.cash); a.treasury -= add; z.cash += add; tout(a, 'atsukaSubsidy', add); }
  const zr = due > 0 ? Math.min(1, z.cash / due) : 0;
  let paid = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.atsuka) { const g = Math.floor(A.pay[i] / 12 * zr); income(W, i, g); paid += g; }
  z.cash -= paid;
  z.month.pay = (z.month.pay || 0) + paid;
  let tdue = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.trade) tdue += Math.round(A.pay[i] / 12);
  const tr = tdue > 0 ? Math.min(1, Math.max(0, a.trade.cash) / tdue) : 0;
  let tpaid = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.trade) { const g = Math.floor(A.pay[i] / 12 * tr); income(W, i, g); tpaid += g; }
  a.trade.cash -= tpaid;
  // (its owners: what is left beyond a cushion of its month, by what each holds)
  const extra = Math.floor(a.trade.cash - a.trade.month * R.tradeKeep);
  if (extra > 0) {
    let held = 0;
    for (let i = 0; i < A.n; i++) if (A.cash[i] > 0) held += A.cash[i];
    let left = extra;
    if (held > 0) for (let i = 0; i < A.n && left > 0; i++) { if (A.cash[i] <= 0) continue; const g = Math.min(left, Math.floor(extra * A.cash[i] / held)); A.cash[i] += g; left -= g; }
    a.trade.cash -= extra - left;
  }
  a.trade.month = 0;
  // (the unemployed of working age: a benefit of 40% of the trade's pay, while the treasury can)
  let jobless = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.none) jobless++;
  const each = Math.round(R.pay.trade * 0.4 / 12), bdue = jobless * each, br = bdue > 0 ? Math.min(1, Math.max(0, a.treasury) / bdue) : 0;
  const g = Math.floor(each * br);
  if (g > 0) { for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.none) A.cash[i] += g; a.treasury -= g * jobless; tout(a, 'jobless', g * jobless); }
  void day;
}
// deaths (by age), their estates (what they owed the bank first, a tenth to the treasury, the rest to someone), and in
// their place a new life at 18 with the money a life begins with — the treasury's, never made
function lives(W, day, r) {
  const a = W.asuka, A = W.AP, M = R.mortality;
  for (let i = 0; i < A.n; i++) {
    const age = ageOf(A, i, day);
    if (age < 40 || r.u() >= M.a * Math.exp(M.b * age) / YEAR) {
      // (retiring at 65: the post left; students at 23 look for work)
      if (age >= 65 && A.job[i] !== JOB.retired) { A.job[i] = JOB.retired; A.pay[i] = 0; }
      else if (A.job[i] === JOB.student && age >= 23) A.job[i] = JOB.none;
      continue;
    }
    a.sum.deaths++;
    let estate = Math.max(0, A.cash[i]);
    const back = Math.min(A.debt[i], estate);
    estate -= back; a.bank.own += back; a.bank.lent -= back;
    // (what was never paid back: the bank's loss)
    if (A.debt[i] > back) a.bank.lent -= A.debt[i] - back;
    const tax = Math.floor(estate * 0.1);
    a.treasury += tax;
    tin(a, 'inheritance', tax);
    let heir = r.int(A.n);
    if (heir === i) heir = (i + 1) % A.n;
    A.cash[heir] += estate - tax;
    // the new life
    A.gen[i] = (A.gen[i] + 1) & 0xffff;
    A.birth[i] = day - Math.ceil(18 * 365.25) - r.int(300);
    A.job[i] = r.u() < 0.6 ? JOB.student : JOB.none;
    A.emp[i] = 0; A.pay[i] = 0; A.debt[i] = 0; A.miss[i] = 0;
    for (let k = 0; k < NC; k++) A.taste[i * NC + k] = r.int(256);
    const own = Math.min(Math.max(0, a.treasury), Math.floor(weightOf(18, 0, r.z()) * a.factor));
    a.treasury -= own;
    A.cash[i] = own;
    tout(a, 'newLife', own);
    a.sum.born++;
  }
}
// The month's end: the bank's interest and what people pay back; the posts filled (the state's, the local trade's, the
// branches' as ヴェルノア's companies want them — the job sites' fee on each hire, the employer's); the treasury tops up
// the state's enterprise when it runs low; the month's record.
function month(W, day, r) {
  const a = W.asuka, A = W.AP, rate = R.bank.rate / 12;
  for (let i = 0; i < A.n; i++) {
    if (!(A.debt[i] > 0)) continue;
    const int = Math.min(Math.max(0, A.cash[i]), Math.round(A.debt[i] * rate));
    A.cash[i] -= int; a.bank.own += int; tin(a, 'bankInterest', int);
    // (what they can spare: three months of their pay beyond, paid back)
    const spare = Math.max(0, A.cash[i] - yearlyOf(A, i) / 4), back = Math.min(A.debt[i], spare);
    if (back > 0) { A.cash[i] -= back; A.debt[i] -= back; a.bank.own += back; a.bank.lent -= back; }
  }
  hire(W, day, r);
  // the record
  let jobless = 0, work = 0, cash = 0, debt = 0;
  for (let i = 0; i < A.n; i++) {
    const j = A.job[i];
    if (j === JOB.none) jobless++;
    if (j === JOB.none || j === JOB.atsuka || j === JOB.trade || j === JOB.branch) work++;
    cash += A.cash[i]; debt += A.debt[i];
  }
  a.stats = { people: A.n, jobless: work ? jobless / work : 0, cash: Math.round(cash), debt: Math.round(debt), treasury: Math.round(a.treasury), atsuka: Math.round(a.atsuka.cash), bank: Math.round(a.bank.own), money: Math.round(moneyOf(W)) };
  a.hist.push({ day, ...a.stats, in: a.month.in, out: a.month.out, fromVernoa: a.sum.fromVernoa, toVernoa: a.sum.toVernoa });
  if (a.hist.length > 36) a.hist.shift();
  a.month = { in: {}, out: {} };
  a.atsuka.month = {};
}
// the posts: the state's (as many as it was founded with), the local trade's (as its takings allow), and each
// company's branches (`staffCo`, what its branches need: corp-model asukaPlan) — filled from those looking for work,
// let go where there are too many
function hire(W, day, r) {
  const a = W.asuka, A = W.AP, want = { [JOB.atsuka]: a.posts.atsuka, [JOB.trade]: a.posts.trade };
  const have = {}, haveCo = {};
  for (let i = 0; i < A.n; i++) {
    const j = A.job[i];
    if (j === JOB.atsuka || j === JOB.trade) have[j] = (have[j] || 0) + 1;
    else if (j === JOB.branch) haveCo[A.emp[i]] = (haveCo[A.emp[i]] || 0) + 1;
  }
  const seekers = [];
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.none && ageOf(A, i, day) < 65) seekers.push(i);
  for (let k = seekers.length - 1; k > 0; k--) { const j = r.int(k + 1); const t = seekers[k]; seekers[k] = seekers[j]; seekers[j] = t; }
  let at = 0, fees = 0;
  const take = (job, emp, n) => {
    for (let x = 0; x < n && at < seekers.length; x++) {
      const i = seekers[at++], age = ageOf(A, i, day);
      A.job[i] = job; A.emp[i] = emp; A.pay[i] = payFor(job, r, age);
      a.sum.hires++;
      // (the job sites' fee on a hire: the state's and the local trade's to pay; a branch's its company's)
      if (job !== JOB.branch) fees += Math.round(A.pay[i] * ASUKA.atsuka.hireFee);
    }
  };
  take(JOB.atsuka, 0, Math.max(0, want[JOB.atsuka] - (have[JOB.atsuka] || 0)));
  take(JOB.trade, 0, Math.max(0, want[JOB.trade] - (have[JOB.trade] || 0)));
  for (const [co, n] of Object.entries(a.staffCo || {})) {
    const k = compIdx(co);
    if (k < 0) continue;
    const gap = n - (haveCo[k] || 0);
    if (gap > 0) take(JOB.branch, k, gap);
    else if (gap < 0) {
      // (fewer branches: their people let go)
      let cut = -gap;
      for (let i = 0; i < A.n && cut > 0; i++) if (A.job[i] === JOB.branch && A.emp[i] === k) { A.job[i] = JOB.none; A.pay[i] = 0; cut--; }
    }
  }
  // (a company that has no branches any more, or failed: everyone of it let go)
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.branch && !(a.staffCo && a.staffCo[COS[A.emp[i]]])) { A.job[i] = JOB.none; A.pay[i] = 0; }
  // the job sites' fees: CITY WORK's and SPEEDEED's, by their shares (on their way to them)
  if (fees > 0) {
    const pay = Math.min(fees, Math.max(0, a.treasury));
    a.treasury -= pay;
    tout(a, 'hireFees', pay);
    const cw = Math.round(pay * 0.65);
    for (const [co, n] of [['citywork', cw], ['speedeed', pay - cw]]) { const box = a.toCo[co] || (a.toCo[co] = {}); box.jobs = (box.jobs || 0) + n; a.sum.toVernoa += n; }
  }
}

/* --------------------------------------------------------- to the companies --- */
// What the companies' day reads of アスカ国 (server/core/npc-model.js flowsFor): what its people bought of each (by
// category; on its way to them now — taken out of its money, into theirs as their day closes), what they would spend
// in each category a year, the branches' people it has for each company, what is left of the drawing fund.
export function flowsFor(W) {
  const a = W.asuka, A = W.AP;
  if (!a || !A) return null;
  const toCo = a.toCo;
  a.toCo = {};
  const staff = {};
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.branch) { const co = COS[A.emp[i]]; staff[co] = (staff[co] || 0) + 1; }
  return { toCo, want: { ...a.want }, staff, boost: Math.max(0, Math.round(a.boost.cash)), branches: a.branches || {}, founded: a.founded, boostUntil: a.founded + R.boost.years * YEAR, pay: R.pay.branch, scale: a.scale };
}
// a branch's people in a country of this size (at least one)
export const branchStaff = (c, scale) => Math.max(1, Math.round(c.staff * (scale || 1)));
// what the companies decided of their branches (corp-model asukaPlan): how many, and the people they need
export function branchesSet(W, branches) {
  const a = W.asuka;
  if (!a || !branches) return;
  a.branches = branches;
  const staffCo = {};
  for (const [co, cats] of Object.entries(branches)) for (const [cat, n] of Object.entries(cats)) { const c = ASUKA.cat(cat); if (c && !c.digital && n > 0) staffCo[co] = (staffCo[co] || 0) + n * branchStaff(c, a.scale); }
  a.staffCo = staffCo;
}

/* --------------------------------------------------------------- the view --- */
// For the operators' アスカ国 (ops/town.js): its people and money, ATSUKA Vision, the branches, the trade with
// ヴェルノア, the month's money in and out, its news
export function view(W) {
  const a = W.asuka, A = W.AP;
  if (!a || !A) return null;
  const jobs = { atsuka: 0, trade: 0, branch: 0, none: 0, student: 0, retired: 0 };
  const names = Object.keys(JOB);
  const byDiv = DIV.map(() => 0), byDist = ASUKA.districts.map(() => 0);
  for (let i = 0; i < A.n; i++) { jobs[names[A.job[i]]]++; if (A.job[i] === JOB.atsuka) byDiv[A.emp[i]]++; byDist[A.dist[i]]++; }
  return {
    founded: a.founded, day: a.day, people: A.n, jobs, stats: a.stats, total: a.total,
    money: { people: a.stats.cash, treasury: Math.round(a.treasury), atsuka: Math.round(a.atsuka.cash), bank: Math.round(a.bank.own), lent: Math.round(a.bank.lent), boost: Math.round(a.boost.cash), boostPaid: a.boost.paid, pension: Math.round(a.pension.cash), trade: Math.round(a.trade.cash), all: Math.round(moneyOf(W)) },
    districts: ASUKA.districts.map((d, k) => ({ ...d, people: byDist[k] })),
    atsuka: DIV.map((d, k) => ({ id: d.id, name: d.name, what: d.what, staff: byDiv[k], rev: Math.round(a.atsuka.rev[d.id] || 0) })), procured: a.atsuka.procured,
    cats: CATS.map((c) => ({ id: c.id, name: c.name, want: a.want[c.id] || 0, digital: !!c.digital, cos: ASUKA.companiesOf(c).map(([co]) => ({ id: co, name: (CORP.company(co) || {}).name || co, branches: (a.branches[co] || {})[c.id] || 0 })) })),
    sum: a.sum, hist: a.hist, news: a.news.slice(-30)
  };
}
