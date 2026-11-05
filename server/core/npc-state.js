// The country's days (server/core/npc-model.js): what the companies paid out reaching the people (pay with its taxes
// and contributions taken, dividends, the local businesses' takings, the deposits' interest), the country's and the
// districts' books (taxes, the pension and its fund, the health insurance, the safety nets, the civil servants, the
// public works, bonds), the month's bills, lives ending and new ones beginning at 18, the money troubles, work
// (hiring, leaving, 60 and 65), and the people's politics and unions (npc-politics.js).
import { NPC, CORP, ASUKA } from './rules.js';
import { T, S, N, E, FL, HOME, NN, NT, REL, MEM, OWN, LISTED, ageOf, remember, memberList, joinHousehold, leaveHousehold, addRelation, pensionMonthly, clampB, clearView, startMoney } from './npc-pop.js';
import * as econ from './npc-econ.js';
import { M } from './npc-life.js';
import { LISTED_IDS } from './npc-market.js';
import * as local from './npc-local.js';
import * as asukaModel from './asuka.js';
import { boomOf } from './npc-macro.js';
import * as heart from './npc-heart.js';
import * as research from './npc-research.js';
import * as deals from './npc-ipdeals.js';
import * as health from './npc-health.js';
import * as hachi from './hachi.js';

const tr = (P, i, k) => P.tr[i * NT + k] / 255;
const YEAR = 365;
const isEmployee = (j) => NPC.employed(j);

/* -------------------------------------------------------------- income tax --- */
// a year's income tax on a year's pay (給与所得控除・基礎控除・社会保険料を引いて、段階の税率で)
export function incomeTax(W, gross, social) {
  const TX = NPC.tax;
  // (the brackets and the deductions keep up with the market's pay: a raise for everyone is not a tax rise for them)
  const k = econ.wageIdx(W);
  const ded = Math.min(TX.employment[1] * k, gross * TX.employment[0]);
  const taxable = Math.max(0, gross - ded - social - TX.basic * k);
  let tax = 0, lo = 0;
  const shift = (W.nation.knobs.incomeShift || 0) / 100;
  for (const [hi0, rate] of TX.income) {
    const hi = hi0 * k;
    if (taxable <= lo) break;
    tax += (Math.min(taxable, hi) - lo) * Math.max(0, rate + shift);
    lo = hi;
  }
  return { tax: Math.round(tax), resident: Math.round(taxable * (W.nation.knobs.residentTax || 10) / 100) };
}
// a person's own part of the social insurance on a month's pay (厚生年金・雇用保険・介護保険), and the 医療税 (in place of
// the health insurance's own part since HACHI's insurance: server/core/hachi.js)
export function socialOf(W, monthly, age) {
  const SO = NPC.social, pr = (W.nation.knobs.pensionRate || 18.3) / 100;
  const pension = monthly * pr / 2, emp = monthly * SO.employment[1], care = age >= SO.careFrom ? monthly * SO.care / 2 : 0, med = hachi.taxOn(W, monthly);
  return { pension: Math.round(pension), rest: Math.round(emp + care) + med, med };
}

/* ---------------------------------------------------------------- the knobs --- */
// A knob of the country's that rescales what people have now: none any more — the pay at each company is the
// company's own (its talks with its union, how it does), the rents follow the prices (npc-cycle.js). (Read where they
// apply.)
export function knobChanged() {}
// how much of what it owes the country can pay (1: all of it). Beyond what Tenesice will lend it, short of money,
// it pays its pensions, its servants, its works and its benefits only in part: 財政破綻.
export const solvency = (W) => (W.nation.cash >= 0 ? 1 : Math.max(0.2, 1 + W.nation.cash / Math.max(1, W.cal.nationFloor * 5)));

/* ----------------------------------------------- what the companies paid out --- */
// The companies' day just closed (server/core/corp-model.js closeDay's `ext`): its pay to the people, its taxes, its
// dividends and the rest, into the people's and the country's money.
export function fromCompanies(W, ext, day) {
  if (!ext) return;
  const P = W.P;
  for (const p of ext.pay || []) payStaff(W, p.company, p.n, p.kind, day);
  for (const p of ext.welfare || []) {
    // the company's half of the social insurance to the country (its pension part to the fund), the rest the benefits
    // the local businesses provide (研修・福利厚生)
    const staff = W.staffOf(p.company);
    const gross = staff.reduce((n, i) => n + P.salary[i], 0) / 12;
    const share = Math.min(p.n, Math.round(gross * NPC.social.employerShare * (p.days || 30) / 30));
    const pension = Math.round(share * 0.6);
    W.nation.fund.cash += pension;
    W.nation.day.in.pensionIn = (W.nation.day.in.pensionIn || 0) + pension;
    econ.nationIn(W, 'social', share - pension);
    W.sector.cash += p.n - share;
    W.sector.inCompanies += p.n - share;
  }
  for (const t of ext.taxes || []) {
    const nation = Math.round(t.n * NPC.tax.corporate.nation);
    econ.nationIn(W, 'corporate', nation);
    const hq = NPC.districts.findIndex((d) => d.hq.includes(t.company));
    econ.districtIn(W, hq >= 0 ? hq : 4, 'corporate', t.n - nation);
  }
  for (const d of ext.dividends || []) dividends(W, d.company, d.n, d.out, d.players);
  // (a company that failed: what it could not pay its people, the country's 80% — 未払賃金立替払 —, before they go)
  for (const g of ext.guarantee || []) {
    const staff = W.staffOf(g.company), each = staff.length ? Math.floor(g.n / staff.length) : 0;
    if (!each) continue;
    for (const i of staff) { P.cash[i] += each; P.inc[i] += each; }
    econ.nationOut(W, 'guarantee', each * staff.length);
  }
  // (the game's businesses the local companies run, and those they bought: server/core/npc-local.js)
  for (const e of ext.toLocals || []) local.operated(W, e, day);
  for (const e of ext.localWins || []) local.won(W, e, day);
  if (ext.sector) {
    W.sector.cash += ext.sector; W.sector.inCompanies += ext.sector;
    // (who paid it and for what: the local companies' sales of it, server/core/npc-local.js)
    const by = W.sector.today || (W.sector.today = {});
    for (const [k, n] of Object.entries(ext.sectorBy || {})) by['co:' + k] = (by['co:' + k] || 0) + n;
  }
  // (abroad: paid for what came from it, it paid for what it bought of the country — only ever with what it was paid;
  // by the part of ATSUKA Vision that sold it, アルタス's by the company that bought)
  if (ext.imports) {
    const by = ext.importsBy || {}, altasBy = ext.altasBy || {};
    let left = ext.imports;
    if (by.digital) { econ.toAbroad(W, by.digital, 'digital'); left -= by.digital; }
    let named = 0;
    for (const [co, n] of Object.entries(altasBy)) { if (n > 0 && named + n <= left) { econ.toAbroad(W, n, 'altas', 'co:' + co); named += n; } }
    if (left - named > 0) econ.toAbroad(W, left - named, 'altas', 'co:other');
  }
  if (ext.exports) { W.sum.exports = (W.sum.exports || 0) + ext.exports; W.abroad.cash -= ext.exports; }
  // (the used cars the local trade bought from Car Owner)
  if (ext.fromSector) W.sector.cash -= ext.fromSector;
  // the companies' bonds are the country's: bought, the country has the money; sold back, it pays it; and their interest
  for (const b of ext.bonds || []) { W.nation.cash += b.n; W.nation.debt += b.n; }
  if (ext.bondInterest) econ.nationOut(W, 'bondInterest', ext.bondInterest);
  // the deposits' interest the bank paid, to each by their money
  if (ext.depositInterest) {
    let total = 0;
    for (let i = 0; i < P.n; i++) if (P.cash[i] > 0) total += P.cash[i];
    let left = ext.depositInterest;
    if (total > 0) for (let i = 0; i < P.n && left > 0; i++) {
      if (P.cash[i] <= 0) continue;
      const n = Math.min(left, Math.floor(ext.depositInterest * P.cash[i] / total));
      P.cash[i] += n;
      left -= n;
    }
    // (the cents of rounding: the local businesses')
    W.sector.cash += left;
  }
  // a severance or a car bought back from a person: the company's to them
  for (const s of ext.toPeople || []) { if (s.i >= 0 && s.i < P.n) P.cash[s.i] += s.n; else W.sector.cash += s.n; }
  // (the country's money put into the failing bank, for its shares: 公的資金の注入)
  if (ext.bankAid) { econ.nationOut(W, 'bankRescue', ext.bankAid); W.nation.stakes = W.nation.stakes || {}; W.nation.stakes.tenesice = (W.nation.stakes.tenesice || 0) + ext.bankAid; }
  // (what the companies charge for their own services, as they set it: Dtrade's fees, the job sites')
  if (ext.fees) W.fees = { ...ext.fees };
  // (MY WAY's support of the local companies of its economy, shared out among them)
  if (ext.sphere) local.support(W, ext.sphere, day);
  // (what Tenesice has of its own not lent yet, as of this close: what it can lend until the next, borrowFor)
  if (ext.bankFree !== undefined) W.bankRoom = Math.max(0, ext.bankFree);
  // (テネシスリサーチ: what Tenesice sent for its facilities — server/core/npc-research.js)
  if (ext.research) research.funded(W, ext.research);
  // (MY WAY's gift to 株式会社YAMATO, its partner of all the world's: アスカ国's; no YAMATO, the local trade's)
  if (ext.yamato > 0 && !asukaModel.yamatoEarn(W, ext.yamato, 'myway')) W.sector.cash += ext.yamato;
  // (the players' part of the market's money: theirs; and what the players paid the local businesses back)
  if (ext.toPlayers) W.sum.toPlayers += ext.toPlayers;
  if (ext.fromPlayers) W.sum.fromPlayers += ext.fromPlayers;
  // what the treasury paid for the game (server/core/corp-model.js gameDay): the players' slot wins beyond their bets
  // and their quests' rewards (theirs, but YOSIDA's fee), YOSIDA's bill for the gacha (abroad)
  // (what the players paid the treasury: the money trees' fund)
  // (the companies' 医療税 on their profits: shared with HACHI as everyone's is — hachi.js taxed)
  for (const [k, n] of Object.entries(ext.stateIn || {})) { if (k === 'medicalTax') hachi.taxed(W, n, day); else econ.nationIn(W, k, n); }
  // (株式会社HACHI's 利益剰余金 at its founding: the treasury's, once; its wards as they are — server/core/hachi.js)
  if (ext.hachiSeed) econ.nationOut(W, 'hachiSeed', ext.hachiSeed);
  hachi.fromCompanies(W, ext.hachiInfo || null);
  // (MIZUKAWA as its last close had it: its models out, its people's pay and number — null before its founding)
  W.mzInfo = ext.mizukawaInfo || null;
  // (the four of MAGITA's economy it bought: closed into it — npc-local.js)
  if (W.mzInfo && W.mzInfo.buy) { local.closeIntoMizukawa(W, W.mzInfo.buy, day + 1); W.mzInfo.buy = null; }
  // (the car list again: one coming out, one sold out — npc-mind.js carList)
  W.carList = null;
  if (ext.state) {
    for (const [k, n] of Object.entries(ext.state.by || {})) econ.nationOut(W, k, n);
    W.sum.toPlayers += ext.state.players || 0;
    econ.toAbroad(W, ext.state.abroad || 0);
  }
}

// a company's pay (`kind` 'salary': the month's, on the 25th; 'bonus' in June and December) to its people by their
// pay, with the income tax, the resident tax and their part of the social insurance taken (源泉徴収)
function payStaff(W, company, n, kind, day) {
  const P = W.P, staff = W.staffOf(company).filter((i) => !(P.flags[i] & FL.striking));
  if (!staff.length) { W.sector.cash += n; return; }
  // (by their pay — the healthiest's up to 70% more: npc-health.js earn —)
  let total = 0;
  for (const i of staff) total += P.salary[i] * health.earnOf(P, i);
  let left = n;
  staff.forEach((i, k) => {
    const g = k === staff.length - 1 ? left : Math.floor(n * P.salary[i] * health.earnOf(P, i) / Math.max(1, total));
    left -= g;
    take(W, i, g, kind, day);
  });
}
// a person's pay in: what is taken first, the rest into their money
export function take(W, i, gross, kind, day) {
  const P = W.P;
  if (gross <= 0) return;
  const age = ageOf(P, i, day);
  const so = socialOf(W, gross, age);
  const yearly = incomeTax(W, (P.salary[i] || gross * 12), (so.pension + so.rest) * 12);
  const share = gross / Math.max(1, (P.salary[i] || gross * 12) / 12);
  const tax = Math.round(yearly.tax / 12 * share), resident = Math.round(yearly.resident / 12 * Math.min(1, share));
  const net = Math.max(0, gross - so.pension - so.rest - tax - resident);
  W.nation.fund.cash += so.pension;
  W.nation.day.in.pensionIn = (W.nation.day.in.pensionIn || 0) + so.pension;
  econ.nationIn(W, 'social', so.rest - so.med);
  hachi.taxed(W, so.med, day);
  econ.nationIn(W, 'income', tax);
  econ.districtIn(W, P.dist[i], 'resident', resident);
  // (rounding: what is left beyond the takings is theirs)
  P.cash[i] += gross - so.pension - so.rest - tax - resident;
  P.inc[i] += net;
  // (the payday's treat one feels one has earned; a bonus, the more so, and the part of it one counts as extra money:
  // 心の財布, npc-heart.js)
  if (P.emo2) {
    const rw = heart.tendency(P, i, 'reward');
    if (kind === 'bonus') { heart.windfall(P, i, net * (0.25 + 0.5 * rw)); heart.add2(P, i, 2, 60 * (0.5 + rw)); }
    else heart.add2(P, i, 2, 12 * (0.4 + rw));
  }
  if (kind === 'salary' && age < 60) {
    // the pension's record: a month paid in, on this pay
    P.penM[i] = Math.min(65535, P.penM[i] + 1);
    P.penPay[i] = Math.round(P.penPay[i] + (gross - P.penPay[i]) / Math.max(12, P.penM[i]));
  }
}

// A company's dividends of the day to the people holding its shares (`out`: its shares out): the listed ones' by the
// shares each holds; the others' to those listed as holding them (their founders and backers); a company's is in its
// own books already. The players' part is what their side paid them for the day, to the dollar (`players`:
// server/core/stocks.js settleDay — by the second they held them), the people's by their shares out of what that
// leaves (fewer, if the players' seconds came to more than their shares as the day closed); without it (a country of
// its own), the players' by their shares as the day closed. The rounding is the local businesses'.
function dividends(W, company, n, out, players = null) {
  const P = W.P, k = LISTED_IDS.indexOf(company);
  if (n <= 0 || !out) return;
  const pl = players !== null && players !== undefined ? Math.max(0, Math.min(n, Math.round(players))) : null;
  const holders = [];
  if (k >= 0) { for (let i = 0; i < P.n; i++) { const s = P.sh[i * LISTED + k]; if (s > 0) holders.push([i, s]); } }
  else for (const [i, s] of W.priv[company] || []) if (s > 0) holders.push([i, s]);
  const room = pl === null ? n : n - pl;
  let want = 0;
  for (const [, s] of holders) want += Math.floor(n * s / out);
  const all = want > room ? holders.reduce((a, [, s]) => a + s, 0) : 0;
  let paid = 0;
  for (const [i, s] of holders) {
    const d = want > room ? Math.floor(room * s / all) : Math.floor(n * s / out);
    P.cash[i] += d;
    paid += d;
  }
  const toPl = pl !== null ? pl : Math.min(n - paid, Math.floor(n * ((W.playerShares || {})[company] || 0) / out));
  W.sum.toPlayers += toPl;
  W.sector.cash += n - paid - toPl;
  W.sum.divRest += n - paid - toPl;
}

/* ------------------------------------------------------- the local businesses --- */
// The rest of the country's trade (the shops, restaurants, landlords, clinics, builders that are not the ten): what
// it took in today it pays out — its people's pay on the 25th, a バイト's by the hour, the rest to those who own it
// (rent and profit, by what they have), less a cushion of a month.
export function sectorDay(W, day) {
  const P = W.P, s = W.sector, t = CORP.ymd(day);
  // (the small shops' goods and food: アルタス's, of what the people paid them today, at its prices)
  if (W.asuka) {
    const today = s.inPeople - (s.altasSeen ?? s.inPeople);
    s.altasSeen = s.inPeople;
    const n = Math.min(Math.max(0, s.cash - local.held(W)), Math.round(today * ASUKA.altas.shops * asukaModel.altasPrice(W)));
    if (n > 0) { s.cash -= n; econ.toAbroad(W, n, 'altas', 'shops'); }
  }
  // the 32 local companies' day (their part of what came in, their costs: server/core/npc-local.js), and their month
  // on its first day
  local.day(W, day);
  if (t.d === 1) local.month(W, day - 1, (i, g) => take(W, i, g, 'salary', day));
  if (t.d === 25) {
    let pay = 0;
    const shops = s.cash - local.held(W);
    for (let i = 0; i < P.n; i++) {
      const j = P.job[i];
      if (j !== NPC.job.other && j !== NPC.job.self && j !== NPC.job.part) continue;
      // (テネシスリサーチ's researchers: paid by it)
      if (P.flags[i] & FL.research) continue;
      // (a local company's people by it, in full; the small shops' by what they have)
      const no = local.firmOf(P, i), f = no ? local.firmByNo(no) : null;
      const g = Math.round(P.salary[i] / 12 * (f || shops > 0 ? 1 : 0.6));
      take(W, i, g, j === NPC.job.self ? 'self' : 'salary', day);
      if (f) { const c = W.locals.firms[f.id]; c.cash -= g; c.m.pay += g; }
      pay += g;
    }
    s.cash -= pay;
    s.outPeople += pay;
  }
  // the owners' part: what is beyond a cushion, a thirtieth a day, by what they have (capital), taxed 20% at source
  // (of the small shops' alone: the local companies keep theirs)
  const cushion = W.cal.sectorCushion, shops = s.cash - local.held(W);
  if (shops > cushion) {
    const out = Math.floor((shops - cushion) / 30);
    if (out > 0 && W.owners.total > 0) {
      let left = out;
      for (const [i, w] of W.owners.list) {
        const g = Math.floor(out * w / W.owners.total);
        if (g <= 0) continue;
        const tax = Math.round(g * NPC.tax.gains);
        P.cash[i] += g - tax;
        P.inc[i] += g - tax;
        econ.nationIn(W, 'income', tax);
        left -= g;
      }
      s.cash -= out - left;
      s.outPeople += out - left;
    }
  }
}
// who owns the local businesses: everyone with money, by it (the richer more), made again each month
export function owners(W) {
  const P = W.P, list = [];
  let total = 0;
  for (let i = 0; i < P.n; i++) {
    const v = P.cash[i];
    if (v < 20000000) continue;
    const w = Math.pow(v / 20000000, 0.9);
    list.push([i, w]);
    total += w;
  }
  W.owners = { list, total };
}

/* ------------------------------------------------------------ the day --- */
// What the people buy of MY WAY's characters today (CORP.myway): where (each partner with its contract on, its share
// of what all of them sell of them; MY WAY's showroom), and how much they pull (heat × brand). Scaled once (cal.collab)
// so that at full pull the people buy what the partners and the showroom sell of them in a year, by the households as
// they spend (their size and money, as for their living); null: MY WAY not there, or gone.
function collabOf(W, ctx) {
  const mw = ctx && ctx.corp && ctx.corp.co && ctx.corp.co.myway;
  if (!mw || mw.dead || !mw.ip) return null;
  const M = CORP.myway, all = Object.values(M.partners).reduce((n, x) => n + x.fee * x.lift, 0) + M.direct;
  const list = [['myway', 'direct', M.direct / all]];
  // (each partner by the size of its contract: npc-ipdeals.js has the local companies')
  for (const [id, c] of Object.entries(mw.ip.contracts)) if (c.on && M.partners[id]) list.push([id, 'myway', (c.base || M.partners[id].fee) * (c.scale || 1) * M.partners[id].lift / all]);
  for (const x of deals.collabList(W, all)) list.push(x);
  // (a country from before all thirteen were partners: what its people buy of them grows with what the new ones sell —
  // the seven's and the showroom's then, $85.05B a year)
  if (W.cal.collab !== undefined && W.cal.collabAll === undefined) W.cal.collabAll = 85.05e9;
  if (W.cal.collab !== undefined && W.cal.collabAll !== all) { W.cal.collab = Math.round(W.cal.collab * all / W.cal.collabAll); W.cal.collabAll = all; }
  if (W.cal.collab === undefined) {
    const P = W.P;
    let households = 0;
    for (let i = 0; i < P.n; i++) if (P.hh[i] === i) households += Math.pow(memberList(P, i).length, 0.75) * Math.pow(Math.max(0.02, (P.cash[i] + 1) / 60000000), 0.22) * (1 - 0.35 * tr(P, i, T.thrift));
    W.cal.collab = Math.round(all * W.scale / YEAR / Math.max(1, households));
    W.cal.collabAll = all;
  }
  // (ヴェルノア's own contract with MY WAY: its people love the characters the more)
  return { list, pull: Math.max(0, mw.ip.heat * mw.ip.brand) * deals.pullLift(W) };
}
export function dayStart(W, day, r, ctx) {
  const P = W.P, t = CORP.ymd(day), age = (i) => ageOf(P, i, day);
  W.nation.day = { in: {}, out: {} };
  for (const d of W.districts) d.day = { in: {}, out: {} };
  for (let i = 0; i < P.n; i++) { P.buyDay[i] = 0; P.trades[i] = 0; }
  // the people's night (npc-heart.js): yesterday's lessons, their feelings settling, what they expect now, today's plan
  if (P.emo2) heart.day(W, day, r);
  // テネシスリサーチ's day (its researchers taken on, the land's rent, the pay, YAMATO's bills: npc-research.js)
  research.day(W, day, r, ctx);
  // MY WAY's contracts with the local companies and the two countries (npc-ipdeals.js): their fees, their talks
  deals.day(W, day, r, ctx);
  if (t.d === 1) month(W, day, r, ctx);
  const fans = collabOf(W, ctx);
  // living: the day's food and things of the household (ジンクス's goods, the local shops'), by its size and money
  for (let i = 0; i < P.n; i++) {
    if (P.hh[i] !== i && P.home[i] !== HOME.stay && P.home[i] !== HOME.street) continue;
    const size = P.hh[i] === i ? memberList(P, i).length : 1;
    const wealth = Math.pow(Math.max(0.02, (P.cash[i] + 1) / 60000000), 0.22);
    const thrift = 1 - 0.35 * tr(P, i, T.thrift);
    const street = P.home[i] === HOME.street ? 0.15 : 1;
    // (living goods stocked at home — a panic's 買いだめ —: only the fresh food until they run out)
    const stocked = P.hoard && P.hoard[i] > 0 ? (P.hoard[i]--, 0.3) : 1;
    const n = W.cal.living * Math.pow(size, 0.75) * wealth * thrift * street * stocked * (W.capacity.jinx || 1) * econ.cpi(W) * econ.lifeIdx(W);
    econ.buy(W, i, day, 'jinx', 'goods', econ.spendAt(W, 'jinx:goods', n * 0.62), true);
    econ.toSector(W, i, Math.round(n * 0.38), true, 'living');
    // MY WAY's fans (購入熱): its characters' goods and collaborations at its partners and its own showroom, as much as
    // the characters pull, the impulsive the more
    if (fans) {
      // (by what the household lets itself spend on pleasures, and the more for one who buys to be seen: 代償消費)
      const mine = P.emo2 ? Math.max(0.4, Math.min(3, Math.sqrt((Math.max(0, P.fund[i * 4 + 2]) + Math.max(0, P.wind[i]) * 0.1) / Math.max(1, W.cal.leisure)))) * (1 + 0.8 * heart.tendency(P, i, 'compensate') * heart.lowEsteem(P, i)) : 1;
      const k = W.cal.collab * Math.pow(size, 0.75) * wealth * thrift * street * (0.4 + 1.2 * tr(P, i, T.impulse)) * fans.pull * mine * econ.lifeIdx(W);
      if (k >= 1) for (const [co, stream, part] of fans.list) {
        if (co.startsWith('local:')) deals.sell(W, i, co.slice(6), Math.round(k * part));
        else econ.buy(W, i, day, co, stream, Math.round(k * part), false);
      }
    }
  }
  // the unemployment benefit (失業手当), a day of it
  const jl = 1 + (W.nation.knobs.jobless || 0) / 100, paid = solvency(W);
  for (let i = 0; i < P.n; i++) {
    if (!P.jobless[i]) continue;
    P.jobless[i]--;
    const n = Math.round(P.joblessPay[i] * jl / 30 * paid);
    econ.nationOut(W, 'jobless', n);
    P.cash[i] += n;
    P.inc[i] += n;
  }
  // the pension, every even month on the 15th: two months of it
  if (t.d === NPC.pension.payDay && NPC.pension.payMonths.includes(t.m)) pensions(W, day);
  // the civil servants' pay on the 25th, the country's
  if (t.d === 25) {
    for (let i = 0; i < P.n; i++) if (P.job[i] === NPC.job.civil) { const g = Math.round(P.salary[i] / 12 * paid); econ.nationOut(W, 'civil', g); take(W, i, g, 'salary', day); }
  }
  // the public works: the country's and the districts' orders to the companies, a day of their budgets
  publicWorks(W, day, r);
  sectorDay(W, day);
  lives(W, day, r, ctx);
  troubles(W, day, r);
  W.nation.year.days++;
  // (the country short of money: bonds, bought by Tenesice — as far as it will lend: beyond that the country cannot pay
  // all it owes, 財政破綻, until its money comes back)
  if (W.nation.cash < W.cal.nationFloor) {
    // (as far as Tenesice has money of its own to lend: never money made by lending — no cap of anyone's beside it)
    const room = econ.bankRoom(W);
    const n = Math.min(Math.ceil((W.cal.nationFloor * 2 - W.nation.cash) / 1e9) * 1e9, Math.max(0, Math.floor(room / 1e9) * 1e9));
    if (n > 0) {
      W.nation.cash += n;
      W.nation.bank += n;
      W.nation.debt += n;
      if (W.bankRoom !== undefined && W.bankRoom !== null) W.bankRoom -= n;
      W.events.push({ kind: 'bonds', n });
    }
  }
  const broke = W.nation.cash < 0;
  if (broke && !W.nation.broke) W.news.push({ day, kind: 'nation', district: -1, text: `国の財政が破綻：テネシスが国債の引き受けを止め、年金・公務員の給与・公共事業・手当が一部しか払われなくなりました（支払率${Math.round(solvency(W) * 100)}%）`, data: {} });
  else if (!broke && W.nation.broke) W.news.push({ day, kind: 'nation', district: -1, text: '国の財政が持ち直し、年金・給与・手当の支払いが元に戻りました', data: {} });
  W.nation.broke = broke;
}

// the month's start: the bills (the phone, the slots' monthly charge for those who played, rent, VIP, services, the
// pension and health insurance of those not employed), loans' interest and repayments, the safety net, the budgets
function month(W, day, r, ctx) {
  // (the phone bill: Tenesice's own price for it — its starting bill moved by its own decisions, npc-org.js —; the quick
  // loans' rate its own too)
  const P = W.P, phone = Math.round(NPC.life.phone * econ.priceOf(W, 'tenesice:mobile')), slot = NPC.life.casinoMonthly, quick = econ.quickRate(W);
  // (the country's month: the one that ended kept for the council to look at)
  W.nation.lastMonth = W.nation.month;
  W.nation.month = { in: {}, out: {} };
  const welfare = NPC.safety.living * (1 + (W.nation.knobs.welfare || 0) / 100) * solvency(W);
  const rate = W.bankRates;
  for (let i = 0; i < P.n; i++) {
    const age = ageOf(P, i, day);
    // the household's electricity, gas and water (ナショナル・パワー電力・メトロ都市ガス・アクア・ライフ水道公社, js/game/local.js), by
    // how many live in it: a household paid none before
    if (P.hh[i] === i && P.home[i] !== HOME.street) {
      // (株式会社YAMATO's once it is founded: its bill for a household of its size by the times and its own care —
      // server/core/asuka.js homeBill)
      if (asukaModel.yamatoOn(W)) {
        const bill = asukaModel.homeBill(W, memberList(P, i).length, tr(P, i, T.thrift));
        if (econ.pay(W, i, bill, true)) econ.toYamato(W, bill, 'vernoa:homes');
      } else {
        const bill = Math.round((W.cal.utilities || NPC.life.utilities) * Math.sqrt(memberList(P, i).length) * econ.cpi(W));
        econ.toSector(W, i, bill, true, 'utilities');
      }
    }
    // the phone: everyone has one, at the same $100,000 a month (テネシス・モバイル); unpaid, it is cut off
    if (econ.pay(W, i, phone, P.cash[i] > -NPC.trouble.quickMax)) { econ.toStream(W, day, 'tenesice', 'mobile', phone); P.phone[i] = 0; }
    else P.phone[i] = 1;
    // the slots: a month played, $1,000,000 to Dtrade
    if (P.spun[i]) {
      // (paid only if it could be: never Dtrade's money from nowhere)
      if (econ.pay(W, i, slot, true)) econ.toStream(W, day, 'dtrade', 'slotfee', slot);
      P.spun[i] = 0;
    }
    if (P.home[i] === HOME.rent && P.rent[i] > 0) {
      if (P.flags[i] & FL.welfare) { econ.nationOut(W, 'welfare', P.rent[i]); W.sector.cash += P.rent[i]; W.sector.inNation += P.rent[i]; }
      else econ.toSector(W, i, P.rent[i], true, 'rent');
    }
    // VIP (DAIZIN): a member's year renewed while they can afford it and still care for it (the dearer, the fewer),
    // the month's fee paid; and the rich who are vain enough join
    const vipPrice = econ.priceOf(W, 'daizin:vipFee'), vipFee = Math.round(W.cal.vipFee * vipPrice);
    // (one who thinks little of themselves and minds being seen joins sooner and keeps it the longer: 代償消費)
    const status = P.emo2 ? heart.tendency(P, i, 'compensate') * heart.lowEsteem(P, i) : 0;
    if (P.vip[i] > 0) {
      if (P.vip[i] <= day + 31 && P.cash[i] > vipFee * 24 && r.u() < 0.55 + 0.4 * tr(P, i, T.vanity) + 0.3 * status - 0.3 * Math.max(0, vipPrice - 1)) P.vip[i] += 365;
      if (!(P.vip[i] > day) || !econ.buy(W, i, day, 'daizin', 'members', vipFee, false)) P.vip[i] = 0;
    } else if ((P.cash[i] > 300000000 || (P.cash[i] > vipFee * 60 && status > 0.3)) && r.u() < 0.02 * (0.3 + tr(P, i, T.vanity)) * (1 + 3 * status) / Math.max(0.3, vipPrice)) {
      if (econ.buy(W, i, day, 'daizin', 'members', vipFee, false)) { P.vip[i] = day + 365; if (P.emo2) { heart.add2(P, i, 0, 15); heart.envy(W, i, day, 'daizin'); } }
    }
    if (P.car[i]) econ.buy(W, i, day, 'carowner', 'service', econ.spendAt(W, 'carowner:service', W.cal.service * (0.5 + r.u()) * econ.lifeIdx(W)), true);
    // the 国民年金 and 国民健康保険 of those not employed (students wait; those with little are let off half)
    if (age >= 18 && age < 60 && !isEmployee(P.job[i]) && P.job[i] !== NPC.job.home) {
      if (P.job[i] === NPC.job.student) { /* 学生納付特例 */ }
      else if (P.cash[i] < 3000000 && !P.salary[i]) { P.penHalf[i]++; P.penM[i]++; }
      else if (econ.pay(W, i, NPC.social.national, true, 'x')) { W.nation.fund.cash += NPC.social.national; W.nation.day.in.pensionIn = (W.nation.day.in.pensionIn || 0) + NPC.social.national; P.penM[i]++; }
      // (their 医療税 on their income: in place of the 国民健康保険 since HACHI's insurance)
      const nhi = hachi.taxOn(W, (P.salary[i] || 0) / 12);
      if (nhi && econ.pay(W, i, nhi, true, 'x')) hachi.taxed(W, nhi, day);
    }
    // a loan's month: its interest to Tenesice, and a part paid back
    if (P.debt[i] > 0) {
      const lr = P.dkind[i] === 2 ? quick : rate.person;
      const int = Math.round(P.debt[i] * lr / 12);
      const back = Math.round(Math.min(P.debt[i], P.debt[i] / (P.dkind[i] === 2 ? 24 : 240)));
      if (P.cash[i] >= int + back) {
        P.cash[i] -= int + back;
        P.debt[i] -= back;
        econ.toBank(W, day, 'nii', int);
        W.sum.repaid += back;
        P.credit[i] = clampB(P.credit[i] + 2);
        if (P.debt[i] <= 0) { P.debt[i] = 0; P.dkind[i] = 0; }
      } else {
        // not paid: added to what is owed, the credit marked down (and it weighs on them)
        P.debt[i] += int;
        W.sum.lent += int;
        econ.toBank(W, day, 'nii', int);
        P.credit[i] = clampB(P.credit[i] - 12);
        P.emo[i * 5 + E.stress] = clampB(P.emo[i * 5 + E.stress] + 25);
      }
    }
    // the 生活保護: those it has found, up to what one needs to live
    if (P.flags[i] & FL.welfare) {
      const need = Math.max(0, welfare - Math.max(0, P.inc[i]));
      if (need > 0) { econ.nationOut(W, 'welfare', need); P.cash[i] += need; }
      if (P.cash[i] > welfare * 6 && P.inc[i] > welfare) P.flags[i] &= ~FL.welfare;
    }
    // (what was left of last month's pleasures: a part of it extra money for the careless — 心の財布 —; the windfall
    // counted as one's savings again little by little)
    if (P.emo2 && W.brain) { P.wind[i] = Math.round(P.wind[i] * 0.75); heart.leftover(P, i); }
    budgetOf(W, i, age, r);
    // (the month's spending one is used to: 参照点)
    if (P.emo2 && W.brain) heart.habit(P, i);
    P.inc[i] = 0;
    P.spent[i] = 0;
  }
  owners(W);
  // (選ばれし300人: chosen again each month, npc-heart.js)
  if (P.emo2) heart.chooseElite(W);
  // the country's interest to Tenesice on what it owes the bank, and the bank's fee for keeping large deposits
  // (口座管理手数料: 0.1% a year of what is above $100M)
  const owed = Math.round(W.nation.bank * (W.nation.bankRate || 0.01) / 12 * solvency(W));
  if (owed > 0) { econ.nationOut(W, 'debtInterest', owed); econ.toBank(W, day, 'nii', owed); }
  for (let i = 0; i < P.n; i++) {
    if (P.cash[i] <= 100000000) continue;
    const fee = Math.round((P.cash[i] - 100000000) * 0.001 / 12);
    if (econ.pay(W, i, fee, false)) econ.toBank(W, day, 'fees', fee);
  }
  W.sum.month++;
}

// A person's month (their own sense of what they may spend: of what comes in, by how careful they are, and a little
// of what they have, more for the old), and its parts: the slots, the games, the pleasures, the market. (Most of what
// comes in goes out again — three quarters for the most careful, more than all of it for the least —: the money goes
// round.)
// The times (server/core/npc-macro.js boom): in a boom they spend more of what comes in and of what they have — the
// careless and the bold, who follow the talk, the most; the careful hardly — gamble and play more, and buy into the
// market (it is rising); in a bust they keep it (and sell: the market is falling).
export function budgetOf(W, i, age, r) {
  const P = W.P, c = W.cal;
  const inc = (P.salary[i] || 0) / 12 * 0.78 + P.penAmt[i] + (P.jobless[i] ? P.joblessPay[i] : 0) + Math.max(0, P.inc[i]) * 0.3;
  const wealth = Math.max(0, P.cash[i]);
  const thrift = tr(P, i, T.thrift);
  // (how far the times carry this one: by how bold, how much they follow the news, how careful)
  const feel = Math.max(0.2, 0.4 + 0.6 * tr(P, i, T.risk) + 0.4 * tr(P, i, T.news) - 0.6 * thrift), boom = Math.max(0.2, 1 + (boomOf(W) - 1) * feel);
  // (docs/ai-economy-plan.md 2.1: 75% of what comes in for the most careful to 120% for the least, and seven tenths
  // more of what they have — the country's people spend: their spending is the companies' sales)
  const keep = Math.min(1.25, (0.75 + 0.45 * (1 - thrift)) * (1 + 0.2 * (boom - 1)));
  const draw = (0.015 + 0.05 * (age >= 60 ? 1 : age / 60)) * (1 - 0.5 * thrift) / 12 * Math.pow(boom, 1.5) * 1.7;
  const mood = P.emo[i * 5 + E.mood] / 255;
  // (and the mind's say: worry, a low sense of oneself, 消費観, what one has learnt, the windfall, the habit — npc-heart.js)
  const b = heart.budgetMind(W, i, Math.max(0, inc * keep + wealth * draw) * (0.85 + 0.3 * mood)).b;
  P.budget[i] = Math.round(b);
  const w = weightsOf(P, i, age);
  P.fund[i * 4] = Math.round(b * c.casino * w.casino * NPC.life.casinoSpend * Math.pow(boom, 1.3));
  P.fund[i * 4 + 1] = Math.round(b * c.games * w.games);
  // (a quarter more of it for one's pleasures than the country began with: what the people spend is what goes round)
  P.fund[i * 4 + 2] = Math.round(b * c.leisureShare * 1.25 * w.leisure * boom);
  P.fund[i * 4 + 3] = Math.round(wealth * c.invest * w.invest * boom * boom);
}
export function weightsOf(P, i, age) {
  const g = tr(P, i, T.gamble), gm = tr(P, i, T.game), v = tr(P, i, T.vanity), rk = tr(P, i, T.risk), nw = tr(P, i, T.news);
  return {
    casino: g > 0.45 ? Math.pow((g - 0.45) / 0.55, 1.5) * 2 : 0,
    games: Math.pow(gm, 2.2) * (age < 45 ? 1.3 : age > 65 ? 0.4 : 1),
    leisure: 0.5 + v,
    invest: rk > 0.35 ? (rk - 0.35) * (0.4 + nw) : 0
  };
}

/* ---------------------------------------------------------------- the pension --- */
function pensions(W, day) {
  const P = W.P, PEN = NPC.pension, f = W.nation.fund;
  const level = W.nation.knobs.pensionLevel || 0;
  // (the fund empty and the country broke: only part of it)
  const paidNow = f.cash + f.bonds > 0 ? 1 : solvency(W);
  let paid = 0;
  for (let i = 0; i < P.n; i++) {
    if (!P.penAmt[i]) continue;
    // (and as the market's pay rose: the fund's takings rose with it — 賃金スライド)
    const pen = P.penAmt[i] * econ.wageIdx(W), cap = PEN.workCap * econ.wageIdx(W);
    let n = pen * 2 * (1 + level / 100) * paidNow;
    // (working on a big pay: a part of it held back, 在職老齢年金)
    if (P.salary[i] / 12 + pen > cap) n = Math.max(0, n - (P.salary[i] / 12 + pen - cap));
    n = Math.round(n);
    P.cash[i] += n;
    P.inc[i] += n;
    paid += n;
  }
  // the fund pays it; half of the basic part is the country's (国庫負担)
  const state = Math.round(paid * 0.25);
  econ.nationOut(W, 'pension', state);
  f.cash += state - paid;
  f.paid += paid;
  if (f.cash < 0) {
    // (the fund short: its bonds sold back to the country)
    const sell = Math.min(f.bonds, -f.cash);
    f.bonds -= sell; f.cash += sell; W.nation.cash -= sell; W.nation.debt -= sell;
    if (f.cash < 0) { econ.nationOut(W, 'pension', -f.cash); f.cash = 0; }
  }
}

/* ---------------------------------------------------------------- public works --- */
// the country's orders to the companies (公用車, 備品, システム, 整備, 求人…) and each district's own by its mayor's
// promises, a day of each budget
const WORKS = [['magita', 0.3], ['carowner', 0.08], ['jinx', 0.14], ['dtrade', 0.1], ['tenesice', 0.08], ['citywork', 0.08], ['speedeed', 0.06], ['daizin', 0.04], ['ice', 0.08], ['riru', 0.04]];
function publicWorks(W, day, r) {
  // (and a balanced budget's rule: what the country holds beyond five times its floor it spends over about a year on
  // works — it took in the companies' taxes and kept them, half a trillion in two years, out of the people's trade)
  // (the times: in a boom it spends what it holds the sooner and keeps less of it — 国庫のお金をどんどん支出 —, in a bust
  // it keeps more and spends it slowly: server/core/npc-macro.js)
  const boom = boomOf(W);
  const spare = Math.max(0, W.nation.cash - W.cal.nationFloor * 5 / boom);
  const budget = W.cal.publicWorks * (1 + (W.nation.knobs.publicWorks || 0) / 100) / YEAR * solvency(W) * boom + spare * boom / YEAR;
  if (W.nation.cash > 0) {
    for (const [co, s] of WORKS) {
      const n = Math.round(budget * s * (0.6 + 0.8 * r.u()) * (1 + (W.appeal[co + ':public'] || 0)));
      econ.nationOut(W, 'works', n);
      econ.toStream(W, day, co, 'public', n);
    }
  }
  // the districts: the grants from the country at the month's start, the mayor's spending every day
  const t = CORP.ymd(day);
  W.districts.forEach((d, k) => {
    if (t.d === 1) {
      const g = Math.round(W.cal.grants[k] * (1 + (W.nation.knobs.grants || 0) / 100) / 12 * solvency(W) * boom);
      econ.nationOut(W, 'grants', g);
      econ.districtIn(W, k, 'grants', g);
    }
    W.politics.spend(W, k, day, r);
  });
}

/* ---------------------------------------------------------------- lives --- */
// a day's chance of dying at an age (Gompertz: half the people gone by about 83, 80 on average), by health; by the new
// rules (W.life2: NPC.life2) the illnesses' part only below 58, then a year's chance of its own, and 62 the last
const deathRate = (age, health, life2) => (life2 && age >= NPC.life2.from ? NPC.lateDeath(age) : 5.3e-5 * Math.exp(0.085 * age) / YEAR * (1.6 - health / 255));
function lives(W, day, r, ctx) {
  const P = W.P;
  for (let i = 0; i < P.n; i++) {
    const age = ageOf(P, i, day);
    // 健康度: what wore it down today and what brought it back (npc-health.js)
    health.day(W, i, day, age, r);
    if (r.u() < deathRate(age, P.health[i], W.life2)) { die(W, i, day, r, ctx); continue; }
    // birthdays
    if (Math.floor((day - P.birth[i]) % 365.25) === 0) birthday(W, i, age, day, r);
  }
  // HACHI's wards' day: the beds, those fallen to −90 on their way, the month's insurance and 医療税 (hachi.js)
  hachi.day(W, day, r);
  W.labor.day(W, day, r, ctx);
}
function birthday(W, i, age, day, r) {
  const P = W.P, PEN = NPC.pension, at = W.nation.knobs.pensionAge || PEN.age;
  // (by the new rules all who work retire at 60: the employees with their severance, the others leave their work)
  if (W.life2 && age === NPC.life2.retire && NPC.working(P.job[i]) && !NPC.employed(P.job[i])) W.labor.leave(W, i, day, 'retire');
  if (age === NPC.retire.at && NPC.employed(P.job[i])) W.labor.retire(W, i, day, r);
  if (age === NPC.retire.rehire && P.flags[i] & FL.rehired) W.labor.leave(W, i, day, 'retire');
  // the pension from its age (or later, a month at a time: 0.7% more each, to 70)
  if (age >= at && !P.penAmt[i] && P.penM[i] >= PEN.minMonths) {
    const working = P.salary[i] > 0 && P.job[i] !== NPC.job.retired;
    if (working && age < PEN.defer && tr(P, i, T.patience) > 0.6) { P.flags[i] |= FL.defer; P.penDefer[i] = Math.min(120, (age - at) * 12); }
    else {
      const up = Math.min(PEN.defer - at, Math.max(0, age - at)) * 12 * PEN.deferUp;
      P.penAmt[i] = pensionMonthly(P, i, up, 0);
      P.flags[i] &= ~FL.defer;
    }
  }
  if (age >= PEN.defer && !P.penAmt[i] && P.penM[i] >= PEN.minMonths) P.penAmt[i] = pensionMonthly(P, i, (PEN.defer - at) * 12 * PEN.deferUp, 0);
}

// A life ends: the news, the family's grief and the funeral, what was owed paid from what was left (the rest the
// bank's loss), the inheritance (its tax the country's; with no family, all of it), the survivor's pension, the place
// left at work or in office; and in the same place a new life begins at 18.
export function die(W, i, day, r, ctx) {
  const P = W.P;
  const who = W.card(i, day);
  const famous = P.flags[i] & (FL.famous | FL.mayor | FL.exec | FL.rich);
  W.events.push({ kind: 'death', i, name: who.name, age: who.age, famous: !!famous, job: who.job });
  W.sum.deaths++;
  const heirs = memberList(P, P.hh[i] >= 0 ? P.hh[i] : i).filter((j) => j !== i);
  for (let k = 0; k < REL; k++) {
    const j = P.rel[i * REL + k];
    if (j < 0) continue;
    const c = P.close[i * REL + k];
    if (c > 120) { P.emo[j * 5 + E.mood] = clampB(P.emo[j * 5 + E.mood] - c / 4); P.grief[j] = Math.max(P.grief[j], c); remember(P, j, day, M.death, c); }
  }
  // the funeral and what was owed (money they were short of is owed too: the bank's loss if nothing is left)
  econ.toSector(W, i, NPC.safety.burial, true);
  if (P.cash[i] < 0) { P.debt[i] += -P.cash[i]; W.sum.lent += -P.cash[i]; P.cash[i] = 0; }
  if (P.debt[i] > 0) {
    const back = Math.min(P.debt[i], Math.max(0, P.cash[i]));
    P.cash[i] -= back;
    W.sum.repaid += back;
    const lost = P.debt[i] - back;
    if (lost > 0) { econ.toBank(W, day, 'credit', lost); W.sum.lent -= lost; W.sum.toCo -= lost; }
    P.debt[i] = 0;
    P.dkind[i] = 0;
  }
  // the inheritance: the money and the shares, the tax on what is beyond the free part (the slots' tokens they left
  // changed back into it first: they were only struck off, and the money with them)
  if (P.tokens[i] > 0) { P.cash[i] += P.tokens[i]; P.tokens[i] = 0; }
  const estate = Math.max(0, P.cash[i]);
  let tax = 0;
  if (heirs.length) {
    const free = NPC.tax.inheritance.free + NPC.tax.inheritance.perHeir * heirs.length;
    let over = Math.max(0, estate - free), lo = 0;
    for (const [hi, rate] of NPC.tax.inheritance.rates) { if (over <= lo) break; tax += (Math.min(over, hi) - lo) * rate; lo = hi; }
    tax = Math.round(tax);
    econ.nationIn(W, 'inheritance', tax);
    let left = estate - tax;
    const sp = P.spouse[i];
    const parts = heirs.map((j) => (j === sp ? heirs.length : 1));
    const sum = parts.reduce((a, b) => a + b, 0);
    heirs.forEach((j, k) => { const g = k === heirs.length - 1 ? left : Math.floor((estate - tax) * parts[k] / sum); P.cash[j] += g; left -= g; heart.windfall(P, j, g * 0.3); });
    for (let k = 0; k < LISTED; k++) {
      const s = Math.max(0, P.sh[i * LISTED + k]);
      if (!s) continue;
      let rest = s;
      heirs.forEach((j, x) => { const g = x === heirs.length - 1 ? rest : Math.floor(s * parts[x] / sum); P.sh[j * LISTED + k] += g; rest -= g; });
    }
    for (const id of Object.keys(W.priv)) {
      for (const h of W.priv[id]) if (h[0] === i) h[0] = heirs[0];
    }
    if (P.car[i] && !P.car[heirs[0]]) { P.car[heirs[0]] = P.car[i]; P.carDay[heirs[0]] = P.carDay[i]; }
  } else {
    econ.nationIn(W, 'escheat', estate);
    // (shares with no heir: the country's, sold to those who want them on the market as it can; here, to the richest)
    for (let k = 0; k < LISTED; k++) {
      const s = Math.max(0, P.sh[i * LISTED + k]);
      if (s) { P.sh[W.richest * LISTED + k] += s; }
    }
    for (const id of Object.keys(W.priv)) for (const h of W.priv[id]) if (h[0] === i) h[0] = W.richest;
  }
  P.cash[i] = 0;
  P.tokens[i] = 0;
  for (let k = 0; k < LISTED; k++) P.sh[i * LISTED + k] = 0;
  // the survivor's pension (three quarters of the 厚生年金's part)
  const sp = P.spouse[i];
  if (sp >= 0) {
    P.spouse[sp] = -1;
    P.flags[sp] |= FL.widow;
    const add = Math.round(P.penPay[i] * NPC.pension.rate * Math.min(P.penM[i], 504) / 12 * NPC.pension.survivor);
    if (add > 0) P.penAmt[sp] = Math.round(Math.max(P.penAmt[sp], P.penAmt[sp] * 0.5 + add));
  }
  // the place left: at work (a vacancy), in office (a by-election, a successor)
  W.labor.leave(W, i, day, 'death');
  W.politics.vacate(W, i, day);
  W.org.vacate(W, i, day);
  if (P.host[i] >= 0) P.host[i] = -1;
  forget(W, i);
  passHome(W, i);
  leaveHousehold(P, i);
  reborn(W, i, day, r, heirs);
  // (the richest of all, through whom an estate with no heirs goes to the market, may have been them)
  if (W.richest === i) W.richest = richestOf(P);
}

// A new life at 18 in the place of one that ended: most as the grown child of a household that wanted one (some of
// its character from them), the rest young people come to live here; the money a life begins with (as everyone's at
// the country's start, paid by the treasury — no money is made but at the country's founding: its 出生・転入の支度金,
// `newLife` in its books) and the family's help; a student or looking for work.
export function reborn(W, i, day, r, heirs) {
  const P = W.P;
  P.gen[i] = (P.gen[i] + 1) & 0xffff;
  P.sex[i] = r.u() < 0.5 ? 1 : 0;
  P.birth[i] = day - Math.ceil(18 * 365.25) - r.int(300);
  // the parents: a couple of 40–60 somewhere (their district, their name)
  let parent = -1;
  for (let k = 0; k < 40; k++) {
    const j = r.int(P.n), a = ageOf(P, j, day);
    if (j !== i && a >= 40 && a <= 60 && P.spouse[j] >= 0 && P.hh[j] >= 0) { parent = j; break; }
  }
  P.dist[i] = parent >= 0 ? P.dist[parent] : r.int(5);
  P.fam[i] = parent >= 0 ? P.fam[parent] : r.int(NPC.names.family.length);
  P.given[i] = r.int(P.sex[i] ? NPC.names.female.length : NPC.names.male.length);
  for (let k = 0; k < NT; k++) P.tr[i * NT + k] = parent >= 0 && r.u() < 0.4 ? clampB(P.tr[parent * NT + k] + r.z() * 25) : r.byte();
  P.tr[i * NT + T.risk] = clampB(P.tr[i * NT + T.risk] + 18);
  P.tr[i * NT + T.game] = clampB(P.tr[i * NT + T.game] + 25);
  for (let k = 0; k < 8; k++) P.sk[i * 8 + k] = r.byte(100, 30);
  for (let k = 0; k < NN; k++) P.need[i * NN + k] = 170 + r.int(60);
  P.emo.fill(150, i * 5, i * 5 + 5);
  P.emo[i * 5 + E.stress] = 60;
  { const h = health.start(18, r); health.setHp(P, i, h.hp); P.ill[i] = h.ill; }
  P.ins[i] = 0; P.med[i] = 0; P.care[i] = 0; P.ward[i] = 0; P.crit[i] = 0; P.chk[i] = 0;
  P.disc.fill(40, i * 8, i * 8 + 8);
  P.lean[i * 2] = Math.round(r.z() * 40); P.lean[i * 2 + 1] = Math.round(r.z() * 40 + 15);
  P.trust.fill(150, i * 5, i * 5 + 5);
  P.learn.fill(128, i * 12, i * 12 + 12);
  clearView(P, i);
  P.outlook.fill(0, i * LISTED, i * LISTED + LISTED);
  P.mem.fill(0, i * MEM, i * MEM + MEM);
  P.memAt[i] = 0;
  P.rel.fill(-1, i * REL, i * REL + REL);
  P.owned.fill(0, i * OWN, i * OWN + OWN);
  P.spouse[i] = -1; P.host[i] = -1; P.stay[i] = 0;
  // (by the new rules nobody studies: every life begins looking for work)
  P.job[i] = r.u() < 0.6 && !W.life2 ? NPC.job.student : NPC.job.none;
  P.dept[i] = 0; P.rank[i] = 0; P.salary[i] = 0; P.tenure[i] = 0; P.jsat[i] = 160; P.shift[i] = r.int(2); P.wdist[i] = P.dist[i];
  P.flags[i] = FL.newborn | (P.job[i] === NPC.job.student ? FL.student : 0);
  P.debt[i] = 0; P.dkind[i] = 0; P.credit[i] = 150; P.miss[i] = 0; P.car[i] = 0; P.carDay[i] = 0; P.vip[i] = 0; P.phone[i] = 0; P.spun[i] = 0; P.live[i] = 0; P.subs[i] = 0;
  P.penM[i] = 0; P.penPay[i] = 0; P.penHalf[i] = 0; P.penDefer[i] = 0; P.penAmt[i] = 0; P.jobless[i] = 0; P.joblessPay[i] = 0;
  P.aware[i] = 0; P.sign[i] = 0; P.vote[i] = 0; P.grief[i] = 0; P.lastBig[i] = day; P.why[i] = 0; P.budget[i] = 0; P.spent[i] = 0; P.inc[i] = 0;
  P.fund.fill(0, i * 4, i * 4 + 4);
  // (the money a life begins with: as the country's first people had at 18, by where they live — the treasury's)
  const own = startMoney(18, 0, P.dist[i], r.z());
  econ.nationOut(W, 'newLife', own);
  P.cash[i] = own;
  P.tokens[i] = 0;
  P.home[i] = HOME.family;
  P.rent[i] = 0;
  P.act[i] = NPC.act.home; P.place[i] = 0; P.ldist[i] = P.dist[i]; P.due[i] = W.minute + 1;
  if (parent >= 0) {
    joinHousehold(P, i, P.hh[parent] >= 0 ? P.hh[parent] : parent);
    addRelation(P, i, parent, 200, 200);
    addRelation(P, parent, i, 220, 200);
    if (P.spouse[parent] >= 0) { addRelation(P, i, P.spouse[parent], 200, 200); addRelation(P, P.spouse[parent], i, 220, 200); }
    // the family's start for them: a little of the parents' money
    econ.give(W, parent, i, Math.min(5000000, Math.max(0, P.cash[parent]) * 0.03));
  } else {
    joinHousehold(P, i, i);
    P.home[i] = HOME.rent;
    P.rent[i] = Math.round((80000 + r.int(40) * 1000) * econ.rentIdx(W));
  }
  for (let k = 0; k < 4; k++) { const j = r.int(P.n); if (Math.abs(ageOf(P, j, day) - 18) < 6) addRelation(P, i, j, 80, 120); }
  P.upd[i] = W.minute;
  budgetOf(W, i, 18, r);
  if (P.emo2) heart.newLife(W, i, parent);
  W.sum.born++;
  W.events.push({ kind: 'born', i, name: W.card(i, day).name, parent: parent >= 0 ? W.card(parent, day).name : '' });
}

// A life gone from slot `i`: nobody counts them a friend or a family member any more, nobody stays at their home,
// their orders on the market are taken off (the slot is someone new now)
function forget(W, i) {
  const P = W.P;
  for (let x = 0; x < P.n * REL; x++) if (P.rel[x] === i) P.rel[x] = -1;
  for (let j = 0; j < P.n; j++) if (P.host[j] === i) P.host[j] = -1;
  const m = W.marketState;
  if (m) for (const b of Object.values(m.book)) { b.buy = b.buy.filter((o) => o[0] !== i); b.sell = b.sell.filter((o) => o[0] !== i); }
  if (m) for (const c of Object.values(m.cost || {})) delete c[i];
}
// The head of a household leaving it (gone, or out of their home): the next of them takes on the home — the one they
// own, or the rent to pay — instead of living on in it for nothing
export function passHome(W, i) {
  const P = W.P;
  if (P.hh[i] !== i) return;
  const next = P.hnext[i];
  if (next < 0 || P.home[next] !== HOME.family) return;
  if (P.home[i] === HOME.own) { P.home[next] = HOME.own; P.rent[next] = 0; }
  else { P.home[next] = HOME.rent; P.rent[next] = P.rent[i] > 0 ? P.rent[i] : rentFor(W, P.dist[next]); }
}
// a modest home's rent a month in a district, at the rents' level now
export const rentFor = (W, d) => Math.round((90000 + (d === 3 ? 60000 : 0)) * econ.rentIdx(W));
export function richestOf(P) {
  let top = 0;
  for (let i = 1; i < P.n; i++) if (P.cash[i] > P.cash[top]) top = i;
  return top;
}

/* ------------------------------------------------------------ money troubles --- */
// Each day, those in trouble (owing more than they can borrow, nothing in hand): the renters who cannot pay go to
// stay with someone close (居候, up to four months, with the host's say), and failing that or after it, on the street;
// the 生活保護 finds a few on the street each day and puts them in a home of their own again; with money again, they
// go back to renting.
function troubles(W, day, r) {
  const P = W.P, TR = NPC.trouble;
  for (let i = 0; i < P.n; i++) {
    // (broke: owing beyond what anyone lends, or the payments one had to make missed day after day)
    const broke = P.cash[i] < 0 || (P.debt[i] > econ.quickCap(P, i) * 1.3 && P.cash[i] < 300000) || P.miss[i] >= 3;
    if (P.miss[i] && P.cash[i] > 1000000) P.miss[i] = 0;
    const h = P.home[i];
    if (h === HOME.stay) {
      P.stay[i]++;
      const host = P.host[i];
      if (P.cash[i] > 3000000 && P.inc[i] > 0) { setHome(W, i, HOME.rent, day); continue; }
      if (P.stay[i] > TR.stayDays || host < 0) { goStreet(W, i, day); continue; }
      // (the host's patience: and the stay costs the host a little each day)
      econ.give(W, host, i, W.cal.living * 0.3);
      continue;
    }
    if (h === HOME.street) {
      if (!(P.flags[i] & FL.welfare) && r.u() < 0.04) { P.flags[i] |= FL.welfare; setHome(W, i, HOME.rent, day); remember(P, i, day, M.recovered, 160); W.events.push({ kind: 'welfare', i }); }
      else if (P.cash[i] > 5000000) setHome(W, i, HOME.rent, day);
      continue;
    }
    if (!broke || (h !== HOME.rent && h !== HOME.own)) continue;
    // (an owner keeps the home until what they owe is far beyond what anyone would lend them: then it is the bank's —
    // sold, what it brings set against the debt — and they must go)
    if (h === HOME.own) {
      if (!(P.debt[i] > econ.quickCap(P, i) * 4 && P.cash[i] < 300000)) continue;
      // (what it brought pays the debt; anything beyond it is theirs)
      const got = foreclosed(W, i), sold = Math.min(P.debt[i], got);
      P.debt[i] -= sold;
      P.cash[i] += got - sold;
      W.sum.repaid += sold;
      if (P.debt[i] <= 0) { P.debt[i] = 0; P.dkind[i] = 0; }
      // (the family that lived there rents from now on)
      P.home[i] = HOME.rent;
      P.rent[i] = rentFor(W, P.dist[i]);
      W.sum.foreclosed = (W.sum.foreclosed || 0) + 1;
      W.events.push({ kind: 'foreclosed', i });
    }
    // someone close with a home to stay with
    let host = -1;
    for (let k = 0; k < REL; k++) {
      const j = P.rel[i * REL + k];
      if (j >= 0 && P.close[i * REL + k] > 110 && (P.home[j] === HOME.own || P.home[j] === HOME.rent) && P.cash[j] > 5000000 && P.host[j] < 0) { host = j; break; }
    }
    if (host >= 0 && r.u() < 0.7) {
      passHome(W, i);
      leaveHousehold(P, i);
      P.home[i] = HOME.stay; P.host[i] = host; P.stay[i] = 0; P.rent[i] = 0; P.ldist[i] = P.dist[host];
      W.sum.staying++;
      W.events.push({ kind: 'stay', i, host });
    } else goStreet(W, i, day);
  }
}
// what a home taken by the bank brings: the local businesses (the buyers) pay what they can of a modest home's worth
function foreclosed(W, i) {
  const n = Math.max(0, Math.min(Math.round(W.P.rent[i] > 0 ? W.P.rent[i] * 120 : 15000000), Math.round(W.sector.cash * 0.5)));
  W.sector.cash -= n;
  W.sector.outPeople += n;
  return n;
}
function goStreet(W, i, day) {
  const P = W.P;
  if (P.home[i] !== HOME.stay) { passHome(W, i); leaveHousehold(P, i); }
  P.home[i] = HOME.street; P.host[i] = -1; P.rent[i] = 0; P.stay[i] = 0;
  remember(P, i, day, M.street, 200);
  P.emo[i * 5 + E.mood] = clampB(P.emo[i * 5 + E.mood] - 60);
  W.sum.homeless++;
  W.events.push({ kind: 'street', i });
}
function setHome(W, i, h, day) {
  const P = W.P;
  P.home[i] = h; P.host[i] = -1; P.stay[i] = 0;
  P.rent[i] = h === HOME.rent ? rentFor(W, P.dist[i]) : 0;
  if (P.hh[i] < 0) joinHousehold(P, i, i);
}
