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
import { ASUKA, NPC, CORP, LOCAL } from './rules.js';
import { seeded } from './npc-rand.js';
import * as hachi from './hachi.js';
import { earn as healthEarn } from './npc-health.js';

const R = ASUKA.rules, CATS = ASUKA.cats, DIV = ASUKA.atsuka.divisions, YEAR = 365;
// (yamato: 株式会社YAMATO's people, by their post in `emp`; research: テネシスリサーチ's researchers here, by their
// facility in `emp` — server/core/npc-research.js)
// (hachi: 株式会社HACHI's medical staff at its wards here; figma: 株式会社FIGMA's people — server/core/hachi.js)
export const JOB = { none: 0, atsuka: 1, trade: 2, branch: 3, student: 4, retired: 5, yamato: 6, research: 7, hachi: 8, figma: 9 };
const PAID = (j) => j === JOB.atsuka || j === JOB.trade || j === JOB.branch || j === JOB.yamato || j === JOB.research || j === JOB.hachi || j === JOB.figma;
const COS = NPC.companies;
const NC = CATS.length;
// (each person's: `hot` what moves within a day — kept every few minutes with ヴェルノア's —, `late` what a country kept
// before it does not have: it starts at 0 — what they do now, until when, what they still need and mean to spend today)
const COLS = [['birth', Int32Array, 1], ['dist', Uint8Array, 1], ['job', Uint8Array, 1], ['emp', Uint8Array, 1], ['gen', Uint16Array, 1],
  ['taste', Uint8Array, NC], ['pay', Float64Array, 1], ['cash', Float64Array, 1, 'hot'], ['debt', Float64Array, 1, 'hot'], ['miss', Uint8Array, 1, 'hot'],
  ['act', Uint8Array, 1, 'hot', 'late'], ['due', Int32Array, 1, 'hot', 'late'], ['need', Float64Array, 1, 'hot', 'late'], ['left', Float64Array, 1, 'hot', 'late'],
  // (消費観, docs/ai-economy-plan.md 2.3: the sense that one's own spending keeps the country going — from middling to
  // as high as ヴェルノア's people's, 0.5 to 0.85 —: in hard times they spend to support it, as far as they can afford)
  ['ethos', Uint8Array, 1, 'late'],
  // (健康度 and HACHI's: a long illness's weight, this month's medicine, the 医療保険 on one's 身分証明書, a bed or リハビリ,
  // the month of one's last checkup — server/core/hachi.js)
  ['hp', Int8Array, 1, 'late'], ['ill', Uint8Array, 1, 'late'], ['med', Uint8Array, 1, 'late'], ['ins', Uint8Array, 1, 'late'], ['care', Uint8Array, 1, 'late'], ['chk', Uint16Array, 1, 'late']];
const isHot = (c) => c.includes('hot'), isLate = (c) => c.includes('late');
// what a person is doing (as ヴェルノア's people, minute by minute within the hours the people are about)
export const ACT = { home: 0, sleep: 1, commute: 2, work: 3, lunch: 4, shop: 5, leisure: 6, study: 7 };
export const ACT_NAMES = ['家', '睡眠', '通勤', '仕事', '昼食', '買い物', 'レジャー', '学校'];

/* --------------------------------------------------------------- the people --- */
export function alloc(n) {
  const A = { n };
  for (const [name, T, w] of COLS) A[name] = new T(n * w);
  return A;
}
// the arrays as blobs (of at most ~1MB each) and back (`hot`: only what moves within a day)
export function pack(A, hot = false) {
  const parts = COLS.filter((c) => !hot || isHot(c)).map(([name]) => new Uint8Array(A[name].buffer, A[name].byteOffset, A[name].byteLength));
  const total = parts.reduce((a, p) => a + p.byteLength, 0), all = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  const rows = [], STEP = 1000000;
  for (let k = 0; k < total; k += STEP) rows.push(all.slice(k, Math.min(total, k + STEP)));
  return rows;
}
export function unpack(A, rows, hot = false) {
  let total = 0;
  for (const r of rows) total += r.byteLength;
  const all = new Uint8Array(total);
  let at = 0;
  for (const r of rows) { all.set(r instanceof Uint8Array ? r : new Uint8Array(r), at); at += r.byteLength; }
  at = 0;
  for (const c of COLS.filter((x) => !hot || isHot(x))) {
    const a = A[c[0]], len = a.byteLength;
    if (isLate(c) && at >= total) continue;
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
// a person's 消費観 (0.5 to 0.85, by their own luck: never the country's draws)
const ethosFor = (i, gen) => Math.round(255 * (0.5 + 0.35 * H(i, gen, 9)));
// How much アスカ's own trade needs its people's support (0..1): more out of work than it has been of late, and the
// local trade unable to pay its people in full
function supportOf(a) {
  const j = (a.stats && a.stats.jobless) || 0;
  a.joblessBase = a.joblessBase === undefined ? j : a.joblessBase + (j - a.joblessBase) / 6;
  return Math.max(0, Math.min(1, (j - a.joblessBase) * 6 + (1 - (a.tradePaid ?? 1))));
}
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
    A.ethos[i] = ethosFor(i, 1);
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
  x += a.treasury + a.atsuka.cash + a.bank.own + a.bank.lent + a.boost.cash + a.pension.cash + a.trade.cash + (a.yamato ? a.yamato.cash : 0) + (a.figma ? a.figma.cash : 0) + (a.medResearch || 0);
  for (const v of Object.values(a.toCo)) for (const n of Object.values(v)) x += n;
  return x;
}

/* -------------------------------------------------------- from ヴェルノア --- */
// what ヴェルノア pays it: its imports (to ATSUKA Vision: its materials and energy — the platforms' fees its digital
// division's), its people's trips (アスカ・リゾート)
export function earned(W, n, division = 'altas', by = 'other', internal = false) {
  const a = W.asuka;
  n = Math.round(n);
  if (!a || !(n > 0)) return false;
  a.atsuka.cash += n;
  // (goods shipped from アスカ to ヴェルノア: the port's fee on them, ATSUKA Vision's harbour's part of it)
  const port = division === 'altas' && !internal ? Math.round(n * ASUKA.atsuka.port) : 0;
  if (port) a.atsuka.rev.port = (a.atsuka.rev.port || 0) + port;
  a.atsuka.rev[division] = (a.atsuka.rev[division] || 0) + n - port;
  a.atsuka.revDay += n;
  // (sold to ヴェルノア — its exports —: never its own country's, nor the land and buildings of the branches here)
  if (!internal && division !== 'zone') gdpAcc(a).x += n;
  // (アルタス's month: what it sold, by who bought it — every $ of it what was bought, nothing fixed)
  if (division === 'altas') { const m = altasOf(a).m; m.rev += n - port; m.by[by] = (m.by[by] || 0) + n - port; }
  if (!internal) a.sum.fromVernoa += n;
  tin(a, 'atsuka:' + division, n);
  return true;
}
// アルタス's books within ATSUKA Vision (its money is ATSUKA Vision's): its prices, its month, its months
const altasMonth0 = () => ({ rev: 0, pay: 0, equip: 0, health: 0, sales: 0, days: 0, by: {} });
function altasOf(a) {
  return a.altas || (a.altas = { price: 1, m: altasMonth0(), last: null, hist: [], dividends: 0 });
}
export const altasPrice = (W) => (W.asuka ? altasOf(W.asuka).price : 1);
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
    for (let i = 0; i < A.n; i++) if (co === 'hachi' ? A.job[i] === JOB.hachi : A.job[i] === JOB.branch && A.emp[i] === k) { staff.push(i); total += A.pay[i]; }
    // (nobody there yet: the local trade's, for the work done for it)
    if (!staff.length) { a.trade.cash += n; continue; }
    let left = n;
    staff.forEach((i, j) => { const g = j === staff.length - 1 ? left : Math.floor(n * A.pay[i] / Math.max(1, total)); left -= g; income(W, i, g); });
  }
  for (const [k, div] of [['rent', 'zone'], ['open', 'zone'], ['platform', 'digital']]) if (x[k] > 0) earned(W, x[k], div);
  // (the branches' buildings, put up here: invested — what the drawing fund paid of them too)
  gdpAcc(a).i += Math.max(0, Math.round(x.open || 0)) + Math.max(0, Math.min(a.boost.cash, Math.round(x.boost || 0)));
  if (x.tax > 0) { a.treasury += Math.round(x.tax); a.sum.fromVernoa += Math.round(x.tax); tin(a, 'branchTax', Math.round(x.tax)); }
  // (what its people paid a company that failed before its day closed: back to the local trade that served them)
  if (x.refund > 0) { a.trade.cash += Math.round(x.refund); a.sum.fromVernoa += Math.round(x.refund); }
  if (x.branches) branchesSet(W, x.branches);
  // (HACHI's: its wards' land and 管理費, FIGMA's equipment, the joint research, its surplus and a buyout under the state)
  if (x.hachi) fromHachi(W, x.hachi, day);
  // (the drawing fund's part of the new branches' buildings: to ATSUKA Vision's zone)
  if (x.boost > 0) { const n = Math.min(a.boost.cash, Math.round(x.boost)); a.boost.cash -= n; a.boost.paid += n; a.atsuka.cash += n; a.atsuka.rev.zone = (a.atsuka.rev.zone || 0) + n; tout(a, 'boost', n); }
  void day;
}
// a person's pay in: the income tax the treasury's, the rest theirs
function income(W, i, gross) {
  const a = W.asuka, A = W.AP;
  const tax = Math.round(gross * R.tax.income), med = hachi.asukaTax(W, gross);
  A.cash[i] += gross - tax - med;
  // (the 医療税: six tenths HACHI's — its wards' takings —, the rest the treasury's)
  const toHachi = med ? hachi.asukaTaxed(W, med) : 0;
  a.treasury += tax + med - toHachi;
  tin(a, 'income', tax);
  if (med - toHachi) tin(a, 'medicalTax', med - toHachi);
}
// What HACHI paid アスカ国 today (corp-hachi.js, through corp-model asukaDay): its wards' land (the treasury's), their
// 管理費 (the local trade's work), FIGMA's equipment (its sales — and アスカ国's research buying of it), the joint
// research (アスカ国's medical research money), what the company costs beyond its people's pay (the treasury's social
// insurance), its surplus under the state (the owner's), what it lacks under the state (put in tomorrow), its buyout
function fromHachi(W, x, day) {
  const a = W.asuka, n = (k) => Math.max(0, Math.round(x[k] || 0));
  const all = n('land') + n('admin') + n('figma') + n('research') + n('owner') + n('social');
  a.sum.fromVernoa += all;
  a.treasury += n('land') + n('owner') + n('social');
  tin(a, 'hachiLand', n('land')); tin(a, 'hachiOwner', n('owner')); tin(a, 'hachiSocial', n('social'));
  a.trade.cash += n('admin');
  a.trade.month = (a.trade.month || 0) + n('admin');
  // (its equipment and its research — the joint research, done by FIGMA with アスカ国's materials —: FIGMA's sales, and
  // アスカ国's own research budget buying half as much again of it: 4 : 6)
  if (a.figma) hachi.figmaSales(W, n('figma') + n('research')); else a.trade.cash += n('figma') + n('research');
  if (x.need > 0) a.hachiNeed = (a.hachiNeed || 0) + Math.round(x.need);
  if (x.buyout) buyHachi(W, x.buyout.price, day);
}
// 株式会社HACHI bought by its contract (its failure: CORP.hachi.buyout): its price paid out — 20% its 社長's, 50% its
// people's (both countries', by their pay), 30% FIGMA's (関連社員) —, out of the treasury, then ATSUKA Vision's, then
// the national bank's own; what it cannot pay now it owes, paid month by month
function buyHachi(W, price, day) {
  const a = W.asuka, A = W.AP, P = W.P;
  let have = Math.max(0, a.treasury) + Math.max(0, a.atsuka.cash) + Math.max(0, a.bank.own);
  const now = Math.min(price, have);
  let left = now;
  for (const k of ['treasury', 'atsuka', 'bank']) {
    const box = k === 'treasury' ? a : k === 'atsuka' ? a.atsuka : a.bank, key = k === 'treasury' ? 'treasury' : k === 'atsuka' ? 'cash' : 'own';
    const t = Math.min(left, Math.max(0, box[key]));
    box[key] -= t; left -= t;
  }
  tout(a, 'hachiBuyout', now);
  a.hachiOwed = (a.hachiOwed || 0) + price - now;
  a.hachiBought = { day, price, paid: now };
  payOut(W, now);
  say(W, day, `契約によりHACHIの事業をまるごと買い取りました（${CORP.fmt.money(price)}：時価総額の${CORP.hachi.buyout.mult}倍）。社長に20%・社員に50%・関連社員（FIGMA）に30%を支払い${price > now ? `、残り${CORP.fmt.money(price - now)}は毎月お支払いします` : ''}`);
  void have; void A; void P;
}
// a buyout's money (or a month's part of what is owed of it) to its 社長, HACHI's people and FIGMA's
function payOut(W, n) {
  const a = W.asuka, A = W.AP, P = W.P, B = CORP.hachi.buyout;
  if (!(n > 0)) return;
  const o = W.orgs && W.orgs.hachi, boss = o ? (o.president >= 0 ? o.president : o.ceo) : -1;
  const ceo = Math.floor(n * B.ceo), staff = Math.floor(n * B.staff), rel = n - ceo - staff;
  let spare = 0;
  if (boss >= 0) P.cash[boss] += ceo; else spare += ceo;
  // (its people, both countries', by their pay)
  const here = W.staffOf ? W.staffOf('hachi') : [], there = [];
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.hachi) there.push(i);
  let tot = 0;
  for (const i of here) tot += P.salary[i];
  for (const i of there) tot += A.pay[i];
  let given = 0;
  if (tot > 0) {
    for (const i of here) { const g = Math.floor(staff * P.salary[i] / tot); P.cash[i] += g; given += g; }
    for (const i of there) { const g = Math.floor(staff * A.pay[i] / tot); A.cash[i] += g; given += g; }
  }
  spare += staff - given;
  // (FIGMA's people: 関連社員)
  const fig = [];
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.figma) fig.push(i);
  if (fig.length) { const each = Math.floor(rel / fig.length); for (const i of fig) A.cash[i] += each; spare += rel - each * fig.length; } else spare += rel;
  // (the cents left, and all of it when nobody is there: the treasury's back)
  a.treasury += spare;
}
// a death (asuka.js lives, and HACHI's wards: one at −90 and below not operated on in time — hachi.js): their estate,
// and a new life at 18 in their place
export function die(W, i, day, r) {
  const a = W.asuka, A = W.AP;
  a.sum.deaths++;
  let estate = Math.max(0, A.cash[i]);
  const back = Math.min(A.debt[i], estate);
  estate -= back; a.bank.own += back; a.bank.lent -= back;
  if (A.debt[i] > back) a.bank.lent -= A.debt[i] - back;
  const tax = Math.floor(estate * 0.1);
  a.treasury += tax;
  tin(a, 'inheritance', tax);
  let heir = r.int(A.n);
  if (heir === i) heir = (i + 1) % A.n;
  A.cash[heir] += estate - tax;
  A.gen[i] = (A.gen[i] + 1) & 0xffff;
  A.birth[i] = day - Math.ceil(18 * 365.25) - r.int(300);
  A.job[i] = r.u() < 0.6 ? JOB.student : JOB.none;
  A.emp[i] = 0; A.pay[i] = 0; A.debt[i] = 0; A.miss[i] = 0;
  for (let k = 0; k < NC; k++) A.taste[i * NC + k] = r.int(256);
  A.ethos[i] = ethosFor(i, A.gen[i]);
  if (A.hp) { A.hp[i] = 60 + r.int(12); A.ill[i] = 0; A.med[i] = 0; A.ins[i] = 0; A.care[i] = 0; A.chk[i] = 0; }
  const own = Math.min(Math.max(0, a.treasury), Math.floor(weightOf(18, 0, r.z()) * a.factor));
  a.treasury -= own;
  A.cash[i] = own;
  tout(a, 'newLife', own);
  a.sum.born++;
}
// HACHI's medical staff at its wards here (175 a ward, at its pay), taken on from the state's people, those out of work
// and the local trade's in that order, let go when its wards are fewer (never under the state)
function hachiStaff(W, day) {
  const a = W.asuka, A = W.AP, info = hachi.infoOf(W);
  if (!info) { for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.hachi) { A.job[i] = JOB.none; A.pay[i] = 0; } return; }
  const all = info.wards.length, mine = info.wards.filter((x) => x.country === 'asuka').length;
  // (175 a ward — CORP.hachi.perWard —; under the state its 20 wards' all kept, none let go)
  const want = Math.round(CORP.hachi.perWard * (a.scale || 1) * mine);
  void all;
  let have = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.hachi) have++;
  // (the state's own people first — ATSUKA Vision's posts, the country's medical care now HACHI's: its post goes with
  // them —, then those out of work, the local trade's only when they are not enough; never アルタス's)
  const altas = DIV.findIndex((x) => x.id === 'altas');
  for (const from of [JOB.atsuka, JOB.none, JOB.trade]) for (let i = 0; i < A.n && have < want; i++) {
    if (A.job[i] !== from || (from === JOB.atsuka && A.emp[i] === altas)) continue;
    const age = ageOf(A, i, day);
    if (age < 22 || age >= 62) continue;
    if (from === JOB.atsuka) a.posts.atsuka = Math.max(0, a.posts.atsuka - 1);
    A.job[i] = JOB.hachi; A.emp[i] = 0; A.pay[i] = CORP.hachi.pay.medical * 12; have++; a.sum.hires++;
  }
  // (fewer wards: let go — the state's posts back for them)
  if (!info.state) for (let i = A.n - 1; i >= 0 && have > want; i--) if (A.job[i] === JOB.hachi) { A.job[i] = JOB.none; A.pay[i] = 0; have--; a.posts.atsuka++; }
}

/* --------------------------------------------------------------- the day --- */
// The day of アスカ国 (`day`, after ヴェルノア's companies closed theirs): ATSUKA Vision buys of ヴェルノア's makers, its
// people spend (the local trade, the branches as far as they can serve them), its month on its last day; deaths and
// new lives.
export function day(W, day, ext) {
  const a = W.asuka, A = W.AP;
  if (!a || !A) return;
  if (ext && ext.asuka) fromCompanies(W, ext.asuka, day);
  if (ext && ext.health) altasOf(a).m.health += ext.health;
  if (ext && ext.sales) altasOf(a).m.sales = (altasOf(a).m.sales || 0) + ext.sales;
  altasOf(a).m.days = (altasOf(a).m.days || 0) + 1;
  const r = seeded(W.key, 'asuka:d:' + day), t = CORP.ymd(day);
  a.day = day;
  // (消費観 for a country kept before it: everyone's, once)
  if (!a.ethosSet) { for (let i = 0; i < A.n; i++) if (!A.ethos[i]) A.ethos[i] = ethosFor(i, A.gen[i]); a.ethosSet = 1; }
  procure(W);
  // 株式会社YAMATO: founded on its day (once), its day's upkeep and emergencies
  if (!a.yamato && day >= YAMATO_DAY) foundYamato(W, day, r);
  if (a.yamato) yamatoDay(W, day, r);
  // the day's shopping closed (a country kept before its people went out: the day as one, at its close)
  if (!a.today) prepare(W, day);
  closeShopping(W);
  lives(W, day, r);
  // 株式会社HACHI's wards here: its people, its patients (server/core/hachi.js); 株式会社FIGMA, founded with it
  W.asukaJobs = JOB;
  hachiStaff(W, day);
  hachi.asukaDay(W, day, r, (i) => die(W, i, day, r));
  if (!a.figma && hachi.isOpen(W)) hachi.figmaFound(W, day, r, JOB);
  // (under the state: what HACHI lacks put in by the treasury; and what is still owed of its buyout, month by month)
  if (a.hachiNeed > 0) { const n = Math.min(a.hachiNeed, Math.max(0, a.treasury)); if (n > 0) { a.treasury -= n; const box = a.toCo.hachi || (a.toCo.hachi = {}); box.aid = (box.aid || 0) + n; a.sum.toVernoa += n; tout(a, 'hachiAid', n); } a.hachiNeed = 0; }
  if (t.d === 1 && a.hachiOwed > 0) { const n = Math.min(a.hachiOwed, Math.max(0, Math.round(a.treasury * 0.1))); if (n > 0) { a.treasury -= n; a.hachiOwed -= n; tout(a, 'hachiBuyout', n); payOut(W, n); } }
  if (t.d === 15) pensions(W);
  if (t.d === 25) payday(W, day);
  if (t.d === 25 && a.yamato) yamatoPay(W);
  if (t.d === 25) hachi.figmaPay(W, JOB, (i, g) => income(W, i, g));
  if (CORP.isMonthEnd(day)) { if (a.yamato) yamatoMonth(W, day); hachi.figmaMonth(W, day); month(W, day, r); }
  prepare(W, day + 1);
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
  // (machines from abroad: invested, and imported)
  gdpAcc(a).i += n; gdpAcc(a).m += n;
  // (アルタス's part of it — its people's part of the state's —: the heavy machinery, the trucks and the rest its mines
  // and fields run on, its cost)
  const m = altasOf(a).m;
  m.equip = (m.equip || 0) + Math.round(n * ((ASUKA.atsuka.divisions.find((x) => x.id === 'altas') || {}).part || 0));
  W.abroad.cash += n;
  a.sum.toVernoa += n;
  tout(a, 'procure', n);
}
// what a person would spend a day: of what they hold and of what they earn a year (net)
const dayBudget = (A, i, yearly) => (Math.max(0, A.cash[i]) * R.spend.wealth + yearly * R.spend.income) / YEAR;
function yearlyOf(A, i) {
  const j = A.job[i];
  if (PAID(j)) return A.pay[i] * (1 - R.tax.income);
  if (j === JOB.retired) return R.pension;
  return 0;
}
// The people's spending, through the day: at its start, what each needs (food, rent, the rest: the local trade's, with
// the consumption tax) and what they mean to spend beyond it as their tastes go, and how much of each kind the branches
// of ヴェルノア's companies can serve today (a kind without a branch sells nothing, a digital one all: what cannot be
// bought is kept); then as they go out — at lunch, after work, on a day off — they pay what they need and buy, a part
// each time; at the day's close what they need and did not go out for is paid all the same (short of money, the
// national bank lends of its own money; else it is not paid). Every $ moves as it is spent.
function prepare(W, day) {
  const a = W.asuka, A = W.AP;
  const room = new Float64Array(NC), want = new Float64Array(NC);
  CATS.forEach((c, k) => {
    if (c.digital) { room[k] = Infinity; return; }
    let cap = 0;
    for (const [co] of ASUKA.companiesOf(c)) cap += ((a.branches && a.branches[co] && a.branches[co][c.id]) || 0) * c.cap * a.scale / YEAR;
    room[k] = cap;
  });
  const disc = 1 - R.spend.living, support = supportOf(a);
  a.support = support;
  const util = a.yamato ? homeBill(W, YAMATO.household) / YAMATO.household / 30 : 0;
  for (let i = 0; i < A.n; i++) {
    // (and in hard times what 消費観 adds, as far as they can afford it: half at the local trade, half where its people
    // work — the branches)
    const base = dayBudget(A, i, yearlyOf(A, i));
    const afford = base > 0 ? Math.max(0, Math.min(1, A.cash[i] / (base * 90) - 0.3)) : 0;
    const extra = base * 0.3 * (A.ethos[i] / 255) * support * afford, all = base + extra;
    // (what one needs less the part of it that was the home's water, power and gas — billed by YAMATO at the month's
    // end now, as far as it was in it)
    A.need[i] = all > 0 ? Math.max(0, Math.round(base * R.spend.living + extra * 0.5 - Math.min(base * R.spend.living * 0.3, util))) : 0;
    A.left[i] = all > 0 ? Math.round(base * disc + extra * 0.5) : 0;
    const b = A.left[i];
    if (b <= 0) continue;
    const tw = weightsSum(A, i);
    for (let k = 0; k < NC; k++) want[k] += b * CATS[k].share * (0.5 + A.taste[i * NC + k] / 255) / tw;
  }
  const ratio = [];
  for (let k = 0; k < NC; k++) {
    ratio.push(want[k] > 0 ? Math.min(1, room[k] / want[k]) : 0);
    // (what the people would spend in it a year: what the companies read when they plan their branches)
    a.want[CATS[k].id] = Math.round((a.want[CATS[k].id] || want[k] * YEAR) * 0.97 + want[k] * YEAR * 0.03);
  }
  a.today = { day, ratio, living: 0, tax: 0, bought: CATS.map(() => 0), trips: 0, instead: 0 };
}
const weightsSum = (A, i) => { let tw = 0; for (let k = 0; k < NC; k++) tw += CATS[k].share * (0.5 + A.taste[i * NC + k] / 255); return tw; };
// what one needs today, paid (with the tax): to the local trade
function payNeed(W, i) {
  const a = W.asuka, A = W.AP, T = a.today, need = A.need[i];
  if (!(need > 0)) return true;
  const tax = Math.round(need * R.tax.consumption);
  if (A.cash[i] < need + tax) borrow(W, i, need + tax - A.cash[i], yearlyOf(A, i));
  if (A.cash[i] < need + tax) { A.miss[i] = Math.min(255, A.miss[i] + 1); A.need[i] = 0; return false; }
  A.cash[i] -= need + tax;
  A.need[i] = 0;
  if (A.miss[i]) A.miss[i] = 0;
  a.trade.cash += need; a.trade.month += need;
  a.treasury += tax;
  T.living += need; T.tax += tax;
  gdpAcc(a).c += need + tax;
  return true;
}
// a part (`part`) of what one means to spend today beyond it, as one's tastes go and the branches can serve: to the
// companies (on its way to them: their sales as their day closes)
function buy(W, i, part) {
  const a = W.asuka, A = W.AP, T = a.today, taxr = R.tax.consumption;
  const b = Math.round(A.left[i] * part);
  if (!(b > 0)) return;
  A.left[i] -= b;
  const tw = weightsSum(A, i), g = gdpAcc(a);
  let instead = 0;
  for (let k = 0; k < NC; k++) {
    const meant = b * CATS[k].share * (0.5 + A.taste[i * NC + k] / 255) / tw;
    // (what the branches could not serve: half of it bought at the local trade instead — something else, nearby —, the
    // rest kept)
    instead += meant * (1 - (T.ratio[k] || 0)) * 0.5;
    if (!T.ratio[k]) continue;
    const n = Math.round(meant * T.ratio[k]), nt = Math.round(n * taxr);
    if (n <= 0 || A.cash[i] < n + nt) continue;
    A.cash[i] -= n + nt;
    a.treasury += nt;
    T.bought[k] += n; T.tax += nt;
    g.c += n + nt;
    const c = CATS[k], cos = ASUKA.companiesOf(c);
    let rest = n;
    cos.forEach(([co, share], x) => {
      const v = x === cos.length - 1 ? rest : Math.round(n * share);
      rest -= v;
      if (!v) return;
      const box = a.toCo[co] || (a.toCo[co] = {});
      box[c.id] = (box[c.id] || 0) + v;
      a.sum.toVernoa += v;
    });
  }
  const n = Math.round(instead), nt = Math.round(n * taxr);
  if (n > 0 && A.cash[i] >= n + nt) {
    A.cash[i] -= n + nt;
    a.trade.cash += n; a.trade.month += n;
    a.treasury += nt;
    T.living += n; T.tax += nt; T.instead += n;
    g.c += n + nt;
  }
}
// the day's close: what was needed and not gone out for, paid; the local trade's goods of アルタス for what it sold;
// the month's record of it
function closeShopping(W) {
  const a = W.asuka, A = W.AP, T = a.today;
  if (!T) return;
  for (let i = 0; i < A.n; i++) if (A.need[i] > 0) payNeed(W, i);
  tin(a, 'trade', T.living);
  // (its food and goods: アルタス's, at its prices — アスカ's own money, staying in it)
  const raw = Math.min(Math.max(0, a.trade.cash), Math.round(T.living * ASUKA.altas.trade * altasOf(a).price));
  if (raw > 0) { a.trade.cash -= raw; earned(W, raw, 'altas', 'asuka:trade', true); }
  tin(a, 'consumption', T.tax);
  CATS.forEach((c, k) => { if (T.bought[k]) tout(a, 'cat:' + c.id, T.bought[k]); });
  // (what was meant to be spent and was not: kept)
  for (let i = 0; i < A.n; i++) A.left[i] = 0;
  a.last = { day: T.day, living: T.living, tax: T.tax, bought: T.bought.reduce((x, y) => x + y, 0), trips: T.trips, instead: T.instead || 0 };
  a.today = null;
}

/* ---------------------------------------------------------------- the minutes --- */
// アスカ国's people through the day, minute by minute as ヴェルノア's (within the hours the people are about, its
// clock `j`: server/core/npc-model.js tick): the state's, the local trade's and the branches' people at work on a
// working day (a lunch out, home after), the students at school, everyone else and everyone on a day off out to shop,
// for their pleasures or at home — paying what they need the first time they go out, buying a part of what they mean to
// spend each time they shop or go out for pleasure; home for the night by 22:00.
const H = (i, m, k) => { let h = (Math.imul(i + 1, 2654435761) ^ Math.imul(m + k * 977, 40503)) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; return (h >>> 0) / 4294967296; };
export function tick(W, m, j) {
  const a = W.asuka, A = W.AP;
  if (!a || !A || !a.today) return;
  const t = j.min, off = j.off;
  // (after a rest — the night, a pause — everyone takes up their day again over a quarter of an hour)
  if (a.lastTick !== m - 1) for (let i = 0; i < A.n; i++) if (A.due[i] < m) A.due[i] = m + Math.floor(H(i, m, 1) * 15);
  a.lastTick = m;
  for (let i = 0; i < A.n; i++) if (A.due[i] <= m) act(W, i, m, t, off);
}
function act(W, i, m, t, off) {
  const A = W.AP, T = W.asuka.today, job = A.job[i], u = H(i, m, 2);
  const set = (x, minutes) => { A.act[i] = x; A.due[i] = m + Math.max(5, Math.round(minutes)); };
  // (健康度 below 1, or in a bed of HACHI's: no work today — 休職 —, at home resting)
  const unfit = W.asuka.hpSet && A.hp && (A.hp[i] <= 0 || A.care[i] === hachi.CARE.bed);
  const worker = PAID(job) && !unfit;
  // (each one's hours: the state's from about nine, the shops' from about ten, a little either way)
  const start = (job === JOB.atsuka ? 540 : 600) + Math.floor(H(i, 0, 3) * 60) - 30, end = start + 510 + Math.floor(H(i, 0, 4) * 60);
  if (t >= 1320) return set(ACT.sleep, 1440 - t);
  if (worker && !off) {
    if (t < start) return set(ACT.commute, start - t);
    if (t < 720) return set(ACT.work, 720 - t);
    if (t < 770 && A.act[i] !== ACT.lunch) { set(ACT.lunch, 45 + u * 15); payNeed(W, i); T.trips++; return; }
    if (t < end) return set(ACT.work, end - t);
    if (A.act[i] === ACT.work) return set(ACT.commute, 25 + u * 35);
  } else if (job === JOB.student && !off && t < 930) return set(ACT.study, 930 - t);
  // free: out for what one needs first, then shopping, pleasures, or home
  if (A.need[i] > 0 && u < 0.6) { set(ACT.shop, 30 + u * 40); payNeed(W, i); buy(W, i, 0.3); T.trips++; return; }
  if (A.left[i] > 0 && u < 0.5) { set(ACT.shop, 30 + u * 100); payNeed(W, i); buy(W, i, t >= 1200 ? 1 : 0.4 + 0.5 * u); T.trips++; return; }
  if (A.left[i] > 0 && u < 0.75) { set(ACT.leisure, 60 + u * 120); payNeed(W, i); buy(W, i, 0.25); T.trips++; return; }
  set(ACT.home, 60 + u * 150);
}
// what they are doing now, where (運営's アスカ国, live): each kind of doing by district, the day's money so far
export function liveView(W) {
  const a = W.asuka, A = W.AP;
  if (!a || !A) return null;
  const by = ASUKA.districts.map(() => ACT_NAMES.map(() => 0)), all = ACT_NAMES.map(() => 0);
  let cash = 0, need = 0, left = 0;
  for (let i = 0; i < A.n; i++) { by[A.dist[i]][A.act[i]]++; all[A.act[i]]++; cash += A.cash[i]; need += A.need[i]; left += A.left[i]; }
  const T = a.today;
  return { minute: a.lastTick || 0, acts: ACT_NAMES, all, districts: ASUKA.districts.map((d, k) => ({ name: d.name, acts: by[k] })),
    today: T ? { day: T.day, living: T.living, tax: T.tax, bought: T.bought.reduce((x, y) => x + y, 0), byCat: CATS.map((c, k) => ({ id: c.id, name: c.name, n: T.bought[k] })), trips: T.trips } : null,
    last: a.last || null, left: Math.round(left), need: Math.round(need),
    money: { people: Math.round(cash), treasury: Math.round(a.treasury), atsuka: Math.round(a.atsuka.cash), trade: Math.round(a.trade.cash), toCo: Math.round(Object.values(a.toCo).reduce((x, v) => x + Object.values(v).reduce((p, q) => p + q, 0), 0)), all: Math.round(moneyOf(W)) } };
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
// a month's pay of a person's post at their 健康度 (from 86, up to 70% more: npc-health.js earn — their employer pays it)
const monthPay = (W, i) => { const A = W.AP; return A.pay[i] / 12 * (W.asuka.hpSet && A.hp ? healthEarn(A.hp[i]) : 1); };
// the 25th: the state's people (ATSUKA Vision's money; the treasury tops it up), the local trade's; what the local trade
// took beyond its pay and its cushion, to its owners (by what they have); the unemployed's benefit (the treasury's)
function payday(W, day) {
  const a = W.asuka, A = W.AP, z = a.atsuka;
  let due = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.atsuka) due += Math.round(monthPay(W, i));
  if (z.cash < due) { const add = Math.min(Math.max(0, a.treasury), due - z.cash); a.treasury -= add; z.cash += add; tout(a, 'atsukaSubsidy', add); }
  const zr = due > 0 ? Math.min(1, z.cash / due) : 0;
  let paid = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.atsuka) { const g = Math.floor(monthPay(W, i) * zr); income(W, i, g); paid += g; }
  z.cash -= paid;
  z.month.pay = (z.month.pay || 0) + paid;
  // (アルタス's people: those of its division)
  const ai = DIV.findIndex((x) => x.id === 'altas');
  let apaid = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.atsuka && A.emp[i] === ai) apaid += Math.floor(monthPay(W, i) * zr);
  altasOf(a).m.pay += apaid;
  let tdue = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.trade) tdue += Math.round(monthPay(W, i));
  const tr = tdue > 0 ? Math.min(1, Math.max(0, a.trade.cash) / tdue) : 0;
  a.tradePaid = tdue > 0 ? tr : 1;
  let tpaid = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.trade) { const g = Math.floor(monthPay(W, i) * tr); income(W, i, g); tpaid += g; }
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
    A.ethos[i] = ethosFor(i, A.gen[i]);
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
  policy(W, day);
  altasMonth(W, day);
  // the record
  let jobless = 0, work = 0, cash = 0, debt = 0;
  for (let i = 0; i < A.n; i++) {
    const j = A.job[i];
    if (j === JOB.none) jobless++;
    if (j === JOB.none || PAID(j)) work++;
    cash += A.cash[i]; debt += A.debt[i];
  }
  a.stats = { people: A.n, jobless: work ? jobless / work : 0, cash: Math.round(cash), debt: Math.round(debt), treasury: Math.round(a.treasury), atsuka: Math.round(a.atsuka.cash), bank: Math.round(a.bank.own), money: Math.round(moneyOf(W)) };
  a.hist.push({ day, ...a.stats, in: a.month.in, out: a.month.out, fromVernoa: a.sum.fromVernoa, toVernoa: a.sum.toVernoa });
  if (a.hist.length > 36) a.hist.shift();
  a.month = { in: {}, out: {} };
  a.atsuka.month = {};
}
// アルタス's customers of a month, the biggest first, by kind: ヴェルノア's thirteen, its local companies, its small shops,
// アスカ's own trade
function customers(by) {
  const kinds = { co: 'ヴェルノアの13社', local: 'ヴェルノアの地元企業', shops: 'ヴェルノアの小さな商店', trade: 'アスカの地元の商売' };
  return Object.entries(by || {}).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).map(([k, n]) => {
    const [kind, id] = k.split(':');
    if (kind === 'co') return { kind: 'co', label: (id !== 'other' && CORP.company(id) && CORP.company(id).name) || 'その他の企業', n };
    if (kind === 'local') return { kind: 'local', label: ((LOCAL && LOCAL.firm(id)) || {}).name || id, n };
    if (k === 'shops') return { kind: 'shops', label: kinds.shops, n };
    if (k === 'asuka:trade') return { kind: 'trade', label: kinds.trade, n };
    return { kind: 'other', label: k, n };
  }).map((x) => ({ ...x, group: kinds[x.kind] || 'その他' }));
}
// アルタス's month: its prices set as a monopoly sets them, for as much as it can take — up a step while what was
// bought of it held up (a rise that cost it more in what was not bought than it brought is not repeated: its sales are
// what was bought, never fixed) and its customers (ヴェルノア's thirteen, together) had the margin to bear it
// (`squeeze` of their sales), down a step when theirs fell below `relief` or they lost money (it lives on them) —
// and half its profit to the treasury, for the country's own projects.
export function altasMonth(W, day) {
  const a = W.asuka, L = altasOf(a), P = ASUKA.altas.price, m = L.m;
  const profit = m.rev - m.pay - (m.equip || 0), margin = m.rev > 0 ? profit / m.rev : 0;
  // (what was bought a day, against the month before's: a short month is no fall)
  const perDay = (x) => x.rev / Math.max(1, x.days || 30);
  const was = L.price, prev = L.last ? perDay(L.last) : 0;
  const held = prev > 0 ? perDay(m) >= prev * 0.95 : margin < P.margin;
  // (its customers' margin: what they made of what they sold — none counted: as good as enough)
  const theirs = m.sales > 0 ? m.health / m.sales : (m.health >= 0 ? 1 : -1);
  if (m.health < 0 || theirs < P.relief) L.price = Math.max(P.min, Math.round(L.price * (1 - P.down) * 1000) / 1000);
  else if (held && theirs >= P.squeeze) L.price = Math.min(P.max, Math.round(L.price * (1 + P.up) * 1000) / 1000);
  if (L.price !== was) say(W, day, `アルタスが資源価格を${L.price > was ? '引き上げ' : '引き下げ'}（${was.toFixed(3)}→${L.price.toFixed(3)}：${L.price > was ? `需要が保たれ、取引先の企業の利益率が${Math.round(theirs * 100)}%あるため` : m.health < 0 ? 'ヴェルノアの企業が赤字のため' : `取引先の企業の利益率が${Math.round(theirs * 100)}%に下がったため`}）`);
  let div = 0;
  if (profit > 0) { div = Math.min(Math.max(0, a.atsuka.cash), Math.floor(profit * ASUKA.altas.dividend)); a.atsuka.cash -= div; a.treasury += div; L.dividends += div; tin(a, 'altasDividend', div); }
  L.last = { day, days: m.days || 0, rev: m.rev, pay: m.pay, equip: m.equip || 0, profit, margin: Math.round(margin * 1000) / 1000, health: m.health, sales: m.sales || 0, theirs: Math.round(theirs * 1000) / 1000, by: m.by, price: was, next: L.price, dividend: div };
  L.hist.push(L.last);
  if (L.hist.length > 36) L.hist.shift();
  L.m = altasMonth0();
}
// The month's balance with ヴェルノア, and what the state does about it (its rules: `R.policy`): the branches' land
// rent and the withholding on their profit up a step after `months` of more going out than coming in, down a step
// after `months` of the other way; its prices by its people's money; and what its treasury holds beyond its fund,
// lent to ヴェルノア's government (its bonds, the interest paid each month by ヴェルノア's treasury).
function policy(W, day) {
  const a = W.asuka, A = W.AP, Pol = R.policy;
  const p = a.policy || (a.policy = { rent: R.tax.rent, withhold: R.tax.withhold, out: 0, in: 0, from: a.sum.fromVernoa, to: a.sum.toVernoa, price: 1, bonds: 0 });
  const bal = (a.sum.fromVernoa - p.from) - (a.sum.toVernoa - p.to);
  p.from = a.sum.fromVernoa; p.to = a.sum.toVernoa; p.last = bal;
  if (bal < 0) { p.out++; p.in = 0; } else { p.in++; p.out = 0; }
  if (p.out >= Pol.months && (p.rent < Pol.max.rent || p.withhold < Pol.max.withhold)) {
    p.rent = Math.min(Pol.max.rent, Math.round((p.rent + Pol.step.rent) * 1000) / 1000);
    p.withhold = Math.min(Pol.max.withhold, Math.round((p.withhold + Pol.step.withhold) * 1000) / 1000);
    p.out = 0;
    say(W, day, `ヴェルノアへの支払いが${Pol.months}か月続けて受け取りを上回ったため、支店の地代を売上の${(p.rent * 100).toFixed(1)}%、送金の源泉税を${(p.withhold * 100).toFixed(0)}%に引き上げ`);
  } else if (p.in >= Pol.months && (p.rent > R.tax.rent || p.withhold > R.tax.withhold)) {
    p.rent = Math.max(R.tax.rent, Math.round((p.rent - Pol.step.rent) * 1000) / 1000);
    p.withhold = Math.max(R.tax.withhold, Math.round((p.withhold - Pol.step.withhold) * 1000) / 1000);
    p.in = 0;
    say(W, day, `ヴェルノアとの収支が${Pol.months}か月続けて黒字のため、支店の地代を売上の${(p.rent * 100).toFixed(1)}%、送金の源泉税を${(p.withhold * 100).toFixed(0)}%に引き下げ`);
  }
  // (its prices: its people's money a head against the founding's)
  let cash = 0;
  for (let i = 0; i < A.n; i++) cash += Math.max(0, A.cash[i]);
  const start = a.total * R.founding.people / A.n;
  p.price = Math.round(Math.sqrt(Math.max(0.01, cash / A.n / start)) * 1000) / 1000;
  // (the treasury's surplus into ヴェルノア's government bonds: its money there now, the interest back each month)
  const keep = a.total * R.founding.treasury * Pol.fund;
  if (a.treasury > keep && W.nation) {
    const n = Math.floor((a.treasury - keep) * 0.1);
    if (n > 0) { a.treasury -= n; p.bonds += n; W.nation.cash += n; W.nation.debt += n; W.nation.asuka = (W.nation.asuka || 0) + n; tout(a, 'bonds', n); say(W, day, `国庫の余剰${CORP.fmt.money(n)}をヴェルノアの国債で運用（残高${CORP.fmt.money(p.bonds)}）`); }
  }
  if (p.bonds > 0 && W.nation) {
    const int = Math.round(p.bonds * Pol.bondRate / 12);
    W.nation.cash -= int;
    if (W.nation.day) W.nation.day.out.asukaBonds = (W.nation.day.out.asukaBonds || 0) + int;
    a.treasury += int; a.sum.fromVernoa += int; tin(a, 'bondInterest', int);
  }
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
      // (at the market's pay of the day: server/core/npc-wages.js)
      A.job[i] = job; A.emp[i] = emp; A.pay[i] = Math.round(payFor(job, r, age) * ((W.wage && W.wage.asuka && W.wage.asuka.idx) || 1));
      a.sum.hires++;
      // (the job sites' fee on a hire: the state's and the local trade's to pay; a branch's its company's)
      if (job !== JOB.branch) fees += Math.round(A.pay[i] * ASUKA.atsuka.hireFee);
    }
  };
  // (YAMATO's posts, each at its own pay; テネシスリサーチ's researchers here, through シティーワーク — server/core/npc-research.js)
  if (a.yamato) {
    const by = new Map();
    for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.yamato) by.set(A.emp[i], (by.get(A.emp[i]) || 0) + 1);
    YAMATO.roles.forEach(([, n, pay], k) => {
      for (let x = Math.max(1, Math.round(n * a.scale)) - (by.get(k) || 0); x > 0 && at < seekers.length; x--) { const i = seekers[at++]; A.job[i] = JOB.yamato; A.emp[i] = k; A.pay[i] = pay; a.sum.hires++; }
    });
  }
  if (W.research && W.research.on) {
    const per = W.research.asukaSites || [], have2 = per.map(() => 0);
    for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.research && A.emp[i] < have2.length) have2[A.emp[i]]++;
    per.forEach((w0, k) => {
      for (let x = w0 - have2[k]; x > 0 && at < seekers.length; x--) {
        const i = seekers[at++];
        A.job[i] = JOB.research; A.emp[i] = k; A.pay[i] = Math.round(W.research.pay[0] + (W.research.pay[1] - W.research.pay[0]) * Math.pow(r.u(), 1.6));
        a.sum.hires++;
        W.research.hiredHere = (W.research.hiredHere || 0) + 1;
      }
    });
  }
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
    gdpAcc(a).g += pay;
    const cw = Math.round(pay * 0.65);
    for (const [co, n] of [['citywork', cw], ['speedeed', pay - cw]]) { const box = a.toCo[co] || (a.toCo[co] = {}); box.jobs = (box.jobs || 0) + n; a.sum.toVernoa += n; }
  }
}

/* ------------------------------------------------------------------ its GDP --- */
// the day's spending for its GDP (server/core/npc-gdp.js): its people's (what they need, with the tax, and what they
// bought at the branches and of ヴェルノア's games), the state's (the job sites' fees), what was invested (ATSUKA
// Vision's machines, the branches' buildings), what it sold ヴェルノア and bought of it; read once a day
const gdpAcc = (a) => a.gdp || (a.gdp = { c: 0, g: 0, i: 0, x: 0, m: 0 });
export function gdpOf(W) {
  const a = W.asuka, A = W.AP;
  if (!a || !A) return null;
  const g = gdpAcc(a);
  a.gdp = { c: 0, g: 0, i: 0, x: 0, m: 0 };
  return { ...g, defl: (a.policy && a.policy.price) || 1, people: A.n };
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
  // (the branches' people at their pay of now: the market's raised it — server/core/npc-wages.js; their companies pay it)
  let bpay = 0, bn = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.branch) { const co = COS[A.emp[i]]; staff[co] = (staff[co] || 0) + 1; if (A.pay[i] > 0) { bpay += A.pay[i]; bn++; } }
  // (HACHI's medical staff here, at their own pay: corp-model asukaDay)
  let hn = 0, hp = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.hachi) { hn++; hp += A.pay[i]; }
  const pol = a.policy || {};
  return { toCo, want: { ...a.want }, staff, boost: Math.max(0, Math.round(a.boost.cash)), branches: a.branches || {}, founded: a.founded, boostUntil: a.founded + R.boost.years * YEAR, pay: bn ? Math.round(bpay / bn) : R.pay.branch, scale: a.scale,
    rates: { rent: pol.rent || R.tax.rent, withhold: pol.withhold || R.tax.withhold }, altasPrice: altasOf(a).price, hachi: { staff: hn, pay: hp } };
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
  // (every kind of post counted from nothing: YAMATO's, テネシスリサーチ's, HACHI's wards', FIGMA's too)
  const names = Object.keys(JOB), jobs = Object.fromEntries(names.map((k) => [k, 0]));
  const byDiv = DIV.map(() => 0), byDist = ASUKA.districts.map(() => 0);
  for (let i = 0; i < A.n; i++) { jobs[names[A.job[i]]]++; if (A.job[i] === JOB.atsuka) byDiv[A.emp[i]]++; byDist[A.dist[i]]++; }
  return {
    founded: a.founded, day: a.day, people: A.n, jobs, stats: a.stats, total: a.total,
    money: { people: a.stats.cash, treasury: Math.round(a.treasury), atsuka: Math.round(a.atsuka.cash), bank: Math.round(a.bank.own), lent: Math.round(a.bank.lent), boost: Math.round(a.boost.cash), boostPaid: a.boost.paid, pension: Math.round(a.pension.cash), trade: Math.round(a.trade.cash), all: Math.round(moneyOf(W)) },
    districts: ASUKA.districts.map((d, k) => ({ ...d, people: byDist[k] })),
    atsuka: DIV.map((d, k) => ({ id: d.id, name: d.name, what: d.what, staff: byDiv[k], rev: Math.round(a.atsuka.rev[d.id] || 0) })), procured: a.atsuka.procured,
    cats: CATS.map((c) => ({ id: c.id, name: c.name, want: a.want[c.id] || 0, digital: !!c.digital, cos: ASUKA.companiesOf(c).map(([co]) => ({ id: co, name: (CORP.company(co) || {}).name || co, branches: (a.branches[co] || {})[c.id] || 0 })) })),
    policy: a.policy || null, altas: (() => { const L = altasOf(a); return { price: L.price, staff: byDiv[DIV.findIndex((x) => x.id === 'altas')] || 0, last: L.last, month: L.m, customers: customers(L.last ? L.last.by : L.m.by), dividends: L.dividends, hist: L.hist.slice(-12).map(({ by, ...h }) => h) }; })(),
    yamato: yamatoView(W),
    sum: a.sum, hist: a.hist, news: a.news.slice(-30)
  };
}

/* ------------------------------------------------------------ 株式会社YAMATO --- */
// 株式会社YAMATO (founded 2026-11-03): アスカ国's first company of its own and the world's water, electricity and gas — the
// only one: ヴェルノア's power, gas and water companies close into it (server/core/npc-local.js closeIntoYamato).
// - Its money once from the treasury at its founding (its capital and retained earnings), never again; then what it
//   bills: every household of both countries at the month's end (a household of two's power, gas and water, dearer in
//   inflation, cheaper in deflation, a little more used in good times — 3 times what ヴェルノア's homes paid before),
//   the companies' energy (ヴェルノア's thirteen and its local companies: what they paid the three for it), ATSUKA
//   Vision's (its biggest customer: a part of what it earns), テネシスリサーチ's facilities (by the month, by the times).
// - Its people (5,500 in a full country, by the posts and pays of its plan: no bonus — the months' bonuses abolished to
//   keep its fixed costs down — but a $30K emergency allowance each time a big outage, gas leak or burst main is put
//   right in time), its upkeep (設備維持・インフラ整備・緊急対策・開発: $18B a year — アルタス's materials, the local
//   trade's work, machines from ヴェルノア), the corporate tax of its profit and its dividends to the treasury (its
//   owner); what it holds beyond five months of its costs it puts into its networks (利益を貯めこまない).
export const YAMATO_DAY = CORP.dayAt(2026, 11, 3);
export const YAMATO = {
  name: '株式会社YAMATO', capital: 5.0e9, retained: 35.0e9, upkeep: 18.0e9,
  upkeepTo: { altas: 0.45, trade: 0.35, abroad: 0.2 },
  // a household of two's month: [usual, in inflation, in deflation] (the plan's 550K/200K/150K and its dearer and
  // cheaper ones in proportion, kept to 3 times what ヴェルノア's homes paid before)
  bills: { power: [104000, 141000, 90000], gas: [38000, 57000, 32000], water: [28000, 36000, 25000] },
  household: 2,
  // ATSUKA Vision's share of what it earns a month for its power, gas and water; a research facility's month
  big: 0.05, lab: 150000000,
  // a day's chance of a big outage, gas leak or burst main in a full country; those sent; put right in time
  emergency: { pay: 30000, odds: 0.15, team: 24, inTime: 0.82 },
  keep: 5, dividend: 0.5,
  // its posts: [name, how many in a full country, a year's pay]
  roles: [
    ['代表取締役社長', 1, 50e6], ['最高経営責任者（CEO）', 1, 30e6], ['最高運営・危機管理責任者（COO）', 1, 15e6], ['最高財務・コスト管理責任者（CFO）', 1, 15e6],
    ['最高技術・インフラ整備責任者（CTO）', 1, 15e6], ['執行役員・インフラ事業本部長', 5, 9.0e6], ['広域トラブル対策・緊急災害復旧統括部長', 5, 7.0e6],
    ['インフラ整備・老朽プラント保全統括部長', 5, 6.0e6], ['グローバル資源調達・コスト監査部長', 5, 6.0e6], ['24時間統合指令室センター長', 15, 5.0e6],
    ['大規模プラント統括所長', 30, 4.5e6], ['チーフ・インフラ整備＆老朽化改修エンジニア', 80, 3.9e6], ['国際インフラ整備・海外プラント保守マネージャー', 100, 3.6e6],
    ['緊急出動・重大トラブル特務復旧スペシャリスト', 350, 3.2e6], ['経営管理・徹底コスト査定・IPO準備スタッフ', 60, 3.0e6],
    ['インフラ制御システム・大規模停電・通信トラブル復旧エンジニア', 150, 3.0e6], ['24時間トラブル監視・緊急ディスパッチオペレーター', 240, 2.7e6],
    ['発電所・ガス基地・浄水場 設備稼働＆定常整備エンジニア', 550, 2.6e6], ['送電網・変電設備 定期点検＆トラブル予防整備士', 650, 2.4e6],
    ['高圧ガス導管・パイプライン 漏洩点検＆緊急遮断整備士', 600, 2.3e6], ['上下水道本管・ポンプ場 破損修理＆水質点検スタッフ', 600, 2.2e6],
    ['24時間緊急駆けつけ・現場一次対応パトロール隊員', 850, 2.1e6], ['交換部品・重機管理＆緊急復旧資材輸送スタッフ', 250, 2.0e6],
    ['フィールド定期巡回・老朽設備点検・スマートメーター保守員', 650, 1.8e6], ['24時間トラブル通報受付・料金徴収・事務スタッフ', 300, 1.7e6]
  ],
  // (the posts sent to an emergency: the specialists, the restoration engineers, the patrols)
  responders: [13, 15, 21]
};
const yOf = (W) => (W.asuka && W.asuka.yamato) || null;
export const yamatoOn = (W) => !!yOf(W);
// the times' prices of power, gas and water against the usual (1: the usual; the homes' bills and the facilities')
export function billLevel(W) {
  const usual = Object.values(YAMATO.bills).reduce((n, b) => n + b[0], 0);
  return homeBill(W, YAMATO.household, 0.5) / usual;
}
// テネシスリサーチ's facilities here (server/core/npc-research.js): their land's rent a day, the treasury's; their
// researchers' month (as far as `budget` goes), taxed as anyone's pay here — what it paid
export function landRent(W, n) {
  const a = W.asuka;
  n = Math.round(n);
  if (!a || !(n > 0)) return;
  a.treasury += n; a.sum.fromVernoa += n; gdpAcc(a).x += n;
  tin(a, 'landRent', n);
}
export function payResearch(W, budget) {
  const a = W.asuka, A = W.AP;
  if (!a || !A || !(budget > 0)) return 0;
  let due = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.research) due += monthPay(W, i);
  const ratio = due > 0 ? Math.min(1, budget / due) : 0;
  let paid = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.research) { const g = Math.floor(monthPay(W, i) * ratio); income(W, i, g); paid += g; }
  a.sum.fromVernoa += paid;
  tin(a, 'research', paid);
  return paid;
}
// what a household of `members` pays a month now: the times' prices (inflation: toward the dear ones; deflation: toward
// the cheap) and how much is used (more in good times — less thrift then —, by the household's own care: `care` 0..1)
export function homeBill(W, members = 2, care = 0.5) {
  const M = W.macro || {}, pi = M.pi ?? 0.02, boom = M.boom || 1;
  const level = Math.max(-1, Math.min(1, (pi - 0.02) / (pi >= 0.02 ? 0.03 : 0.03)));
  let n = 0;
  for (const [usual, dear, cheap] of Object.values(YAMATO.bills)) n += level >= 0 ? usual + (dear - usual) * level : usual + (usual - cheap) * level;
  const use = (1 + 0.3 * Math.max(0, boom - 1)) * (1.1 - 0.2 * care);
  return Math.round(n * Math.sqrt(members / YAMATO.household) * use);
}
// money paid YAMATO (`from`: who — 'vernoa:homes', 'vernoa:companies', 'vernoa:locals', 'asuka:homes', 'atsuka',
// 'research'): its takings; what came from ヴェルノア, its exports
// アスカ国's IP契約 with MY WAY (server/core/npc-ipdeals.js): its fee out of the treasury, to MY WAY as its day closes
// (flowsFor `toCo`: the companies' side books it as MY WAY's 'ipAsuka')
export function payMyway(W, n) {
  const a = W.asuka;
  n = Math.round(n);
  if (!a || !(n > 0)) return false;
  a.treasury -= n;
  tout(a, 'myway', n);
  const box = a.toCo.myway || (a.toCo.myway = {});
  box.ip = (box.ip || 0) + n;
  a.sum.toVernoa += n;
  return true;
}
export function yamatoEarn(W, n, from) {
  const a = W.asuka, Y = yOf(W);
  n = Math.round(n);
  if (!Y || !(n > 0)) return false;
  Y.cash += n;
  Y.m.rev[from] = (Y.m.rev[from] || 0) + n;
  Y.total.rev += n;
  if (/^vernoa|^research/.test(from)) { a.sum.fromVernoa += n; gdpAcc(a).x += n; }
  tin(a, 'yamato:' + from, n);
  return true;
}
function foundYamato(W, day, r) {
  const a = W.asuka, A = W.AP, sc = a.scale;
  const capital = Math.round(YAMATO.capital * sc), retained = Math.round(YAMATO.retained * sc);
  const n = Math.min(Math.max(0, a.treasury), capital + retained);
  a.treasury -= n;
  tout(a, 'yamato', n);
  a.yamato = { founded: day, cash: n, capital, retained: retained - (capital + retained - n), m: yMonth(), last: null, hist: [], total: { rev: 0, pay: 0, upkeep: 0, emergency: 0, tax: 0, dividends: 0, invest: 0 }, incidents: 0, restored: 0 };
  // its people: those out of work first, then the local trade's (the posts from the top)
  const pool = [];
  for (let i = 0; i < A.n; i++) { const age = ageOf(A, i, day); if (age >= 20 && age < 65 && A.job[i] === JOB.none) pool.push(i); }
  for (let i = 0; i < A.n; i++) { const age = ageOf(A, i, day); if (age >= 20 && age < 65 && A.job[i] === JOB.trade) pool.push(i); }
  let at = 0, hired = 0;
  YAMATO.roles.forEach(([, k, pay], role) => {
    for (let x = Math.max(1, Math.round(k * sc)); x > 0 && at < pool.length; x--) { const i = pool[at++]; A.job[i] = JOB.yamato; A.emp[i] = role; A.pay[i] = pay; hired++; }
  });
  a.sum.hires += hired;
  a.yamato.staff = hired;
  say(W, day, `株式会社YAMATOが設立されました（アスカ国初のアスカ国籍企業・水道・電気・ガスの世界一の独占インフラ企業）。資本金${CORP.fmt.money(capital)}・利益剰余金${CORP.fmt.money(retained)}は国庫から一度だけ。社員${hired.toLocaleString('en-US')}人を採用しました`);
  if (W.closeIntoYamato) W.closeIntoYamato(day);
  void r;
}
const yMonth = () => ({ rev: {}, pay: 0, upkeep: 0, emergency: 0 });
// a day: its upkeep (a 365th of the year's: アルタス's materials, the local trade's work, machines from ヴェルノア), and the
// big troubles put right (the emergency allowance to those sent, each time in time)
function yamatoDay(W, day, r) {
  const a = W.asuka, A = W.AP, Y = a.yamato, sc = a.scale;
  const n = Math.min(Math.max(0, Y.cash), Math.round(YAMATO.upkeep * sc / YEAR));
  if (n > 0) spendUpkeep(W, n);
  Y.m.upkeep += n; Y.total.upkeep += n;
  if (r.u() < YAMATO.emergency.odds) {
    Y.incidents++;
    if (r.u() < YAMATO.emergency.inTime) {
      Y.restored++;
      const team = [];
      for (let i = 0; i < A.n && team.length < Math.max(2, Math.round(YAMATO.emergency.team * Math.sqrt(sc))); i++) if (A.job[i] === JOB.yamato && YAMATO.responders.includes(A.emp[i]) && r.u() < 0.08) team.push(i);
      for (const i of team) { if (Y.cash < YAMATO.emergency.pay) break; Y.cash -= YAMATO.emergency.pay; income(W, i, YAMATO.emergency.pay); Y.m.emergency += YAMATO.emergency.pay; Y.total.emergency += YAMATO.emergency.pay; }
    }
  }
}
function spendUpkeep(W, n) {
  const a = W.asuka, Y = a.yamato, T = YAMATO.upkeepTo;
  Y.cash -= n;
  const altas = Math.round(n * T.altas), trade = Math.round(n * T.trade), abroad = n - altas - trade;
  earned(W, altas, 'altas', 'yamato', true);
  a.trade.cash += trade; a.trade.month += trade;
  W.abroad.cash += abroad; a.sum.toVernoa += abroad;
  gdpAcc(a).i += n; gdpAcc(a).m += abroad;
  tout(a, 'yamato:upkeep', n);
}
// the 25th: its people's month (no bonus), as far as its money goes
function yamatoPay(W) {
  const a = W.asuka, A = W.AP, Y = a.yamato;
  let due = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.yamato) due += Math.round(monthPay(W, i));
  const ratio = due > 0 ? Math.min(1, Math.max(0, Y.cash) / due) : 0;
  let paid = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.yamato) { const g = Math.floor(monthPay(W, i) * ratio); income(W, i, g); paid += g; }
  Y.cash -= paid; Y.m.pay += paid; Y.total.pay += paid;
}
// the month's end: アスカ's homes billed (a household of two each: half a household's bill a head), ATSUKA Vision's part
// of what it earned; the month's profit, its tax and its dividends to the treasury; and what it holds beyond five
// months of its costs into its networks
function yamatoMonth(W, day) {
  const a = W.asuka, A = W.AP, Y = a.yamato, z = a.atsuka;
  const each = Math.round(homeBill(W, YAMATO.household) / YAMATO.household);
  let homes = 0;
  for (let i = 0; i < A.n; i++) {
    if (A.cash[i] < each) borrow(W, i, each - A.cash[i], yearlyOf(A, i));
    const n = Math.min(each, Math.max(0, Math.floor(A.cash[i])));
    if (n <= 0) { A.miss[i] = Math.min(255, A.miss[i] + 1); continue; }
    A.cash[i] -= n; homes += n;
  }
  if (homes) yamatoEarn(W, homes, 'asuka:homes');
  const big = Math.min(Math.max(0, z.cash), Math.round((z.revAvg || 0) * 30 * YAMATO.big));
  if (big > 0) { z.cash -= big; tout(a, 'atsuka:yamato', big); yamatoEarn(W, big, 'atsuka'); }
  const rev = Object.values(Y.m.rev).reduce((x, v) => x + v, 0), cost = Y.m.pay + Y.m.upkeep + Y.m.emergency, profit = rev - cost;
  let tax = 0, div = 0;
  if (profit > 0) {
    tax = Math.min(Math.max(0, Y.cash), Math.round(profit * R.tax.corporate));
    Y.cash -= tax; a.treasury += tax; tin(a, 'yamatoTax', tax);
    div = Math.min(Math.max(0, Y.cash), Math.round((profit - tax) * YAMATO.dividend));
    Y.cash -= div; a.treasury += div; tin(a, 'yamatoDividend', div);
  }
  Y.retained += profit - tax - div;
  Y.total.tax += tax; Y.total.dividends += div;
  // (利益を貯めこまない: beyond five months of its costs, a quarter of it into its networks)
  const keep = Math.max(1, cost) * YAMATO.keep, more = Math.round(Math.max(0, Y.cash - keep) * 0.25);
  if (more > 0) { spendUpkeep(W, more); Y.total.invest += more; }
  Y.last = { day, rev, by: { ...Y.m.rev }, pay: Y.m.pay, upkeep: Y.m.upkeep, emergency: Y.m.emergency, profit, tax, dividend: div, invest: more, cash: Math.round(Y.cash), bill: homeBill(W, YAMATO.household) };
  Y.hist.push(Y.last);
  if (Y.hist.length > 24) Y.hist.shift();
  Y.m = yMonth();
}
function yamatoView(W) {
  const a = W.asuka, A = W.AP, Y = yOf(W);
  if (!Y) return null;
  const posts = YAMATO.roles.map(([name, , pay]) => ({ name, pay, staff: 0 }));
  for (let i = 0; i < A.n; i++) if (A.job[i] === JOB.yamato && posts[A.emp[i]]) posts[A.emp[i]].staff++;
  return { name: YAMATO.name, founded: Y.founded, cash: Math.round(Y.cash), capital: Y.capital, retained: Math.round(Y.retained), staff: posts.reduce((n, p) => n + p.staff, 0), posts,
    bill: homeBill(W, YAMATO.household), month: Y.m, last: Y.last, total: Y.total, incidents: Y.incidents, restored: Y.restored, hist: Y.hist.slice(-12) };
}
