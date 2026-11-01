// The country's days (server/core/npc-model.js): what the companies paid out reaching the people (pay with its taxes
// and contributions taken, dividends, the local businesses' takings, the deposits' interest), the country's and the
// districts' books (taxes, the pension and its fund, the health insurance, the safety nets, the civil servants, the
// public works, bonds), the month's bills, lives ending and new ones beginning at 18, the money troubles, work
// (hiring, leaving, 60 and 65), and the people's politics and unions (npc-politics.js).
import { NPC, CORP } from './rules.js';
import { T, S, N, E, FL, HOME, NN, NT, REL, MEM, OWN, LISTED, ageOf, remember, memberList, joinHousehold, leaveHousehold, addRelation, pensionMonthly, clampB, clearView } from './npc-pop.js';
import * as econ from './npc-econ.js';
import { M } from './npc-life.js';
import { LISTED_IDS } from './npc-market.js';
import * as local from './npc-local.js';

const tr = (P, i, k) => P.tr[i * NT + k] / 255;
const YEAR = 365;
const isEmployee = (j) => NPC.employed(j);

/* -------------------------------------------------------------- income tax --- */
// a year's income tax on a year's pay (給与所得控除・基礎控除・社会保険料を引いて、段階の税率で)
export function incomeTax(W, gross, social) {
  const TX = NPC.tax;
  const ded = Math.min(TX.employment[1], gross * TX.employment[0]);
  const taxable = Math.max(0, gross - ded - social - TX.basic);
  let tax = 0, lo = 0;
  const shift = (W.nation.knobs.incomeShift || 0) / 100;
  for (const [hi, rate] of TX.income) {
    if (taxable <= lo) break;
    tax += (Math.min(taxable, hi) - lo) * Math.max(0, rate + shift);
    lo = hi;
  }
  return { tax: Math.round(tax), resident: Math.round(taxable * (W.nation.knobs.residentTax || 10) / 100) };
}
// a person's own part of the social insurance on a month's pay (厚生年金・健康保険・雇用保険・介護保険)
export function socialOf(W, monthly, age) {
  const SO = NPC.social, pr = (W.nation.knobs.pensionRate || 18.3) / 100;
  const pension = monthly * pr / 2, health = monthly * SO.health / 2, emp = monthly * SO.employment[1], care = age >= SO.careFrom ? monthly * SO.care / 2 : 0;
  return { pension: Math.round(pension), rest: Math.round(health + emp + care) };
}

/* ---------------------------------------------------------------- 運営's knobs --- */
// A knob that rescales what people have now: a pay level (everyone's pay there at once, by the new level against the
// old), the rents. (The rest are read where they apply.)
const LOCAL = new Set([NPC.job.other, NPC.job.self, NPC.job.part]);
export function knobChanged(W, id, was, now) {
  const P = W.P, ratio = (1 + (now || 0) / 100) / Math.max(0.01, 1 + (was || 0) / 100);
  if (id.startsWith('pay:')) {
    const who = id.slice(4), ci = NPC.companies.indexOf(who);
    for (let i = 0; i < P.n; i++) {
      const j = P.job[i];
      const mine = ci >= 0 ? j === ci + 1 : who === 'civil' ? j === NPC.job.civil : who === 'local' ? LOCAL.has(j) : false;
      if (mine && P.salary[i] > 0) P.salary[i] = Math.round(P.salary[i] * ratio);
    }
  } else if (id === 'rentLevel') {
    for (let i = 0; i < P.n; i++) if (P.rent[i] > 0) P.rent[i] = Math.round(P.rent[i] * ratio);
  }
}
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
  for (const d of ext.dividends || []) dividends(W, d.company, d.n, d.out);
  if (ext.sector) {
    W.sector.cash += ext.sector; W.sector.inCompanies += ext.sector;
    // (who paid it and for what: the local companies' sales of it, server/core/npc-local.js)
    const by = W.sector.today || (W.sector.today = {});
    for (const [k, n] of Object.entries(ext.sectorBy || {})) by['co:' + k] = (by['co:' + k] || 0) + n;
  }
  if (ext.imports) W.sum.imports += ext.imports;
  if (ext.exports) W.sum.exports = (W.sum.exports || 0) + ext.exports;
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
  // (the players' part of the market's money: theirs)
  if (ext.toPlayers) W.sum.toPlayers += ext.toPlayers;
  // what the treasury paid for the game (server/core/corp-model.js gameDay): the players' slot wins beyond their bets
  // and their quests' rewards (theirs, but YOSIDA's fee), YOSIDA's bill for the gacha (abroad)
  if (ext.state) {
    for (const [k, n] of Object.entries(ext.state.by || {})) econ.nationOut(W, k, n);
    W.sum.toPlayers += ext.state.players || 0;
    W.sum.imports += ext.state.abroad || 0;
  }
}

// a company's pay (`kind` 'salary': the month's, on the 25th; 'bonus' in June and December) to its people by their
// pay, with the income tax, the resident tax and their part of the social insurance taken (源泉徴収)
function payStaff(W, company, n, kind, day) {
  const P = W.P, staff = W.staffOf(company).filter((i) => !(P.flags[i] & FL.striking));
  if (!staff.length) { W.sector.cash += n; return; }
  let total = 0;
  for (const i of staff) total += P.salary[i];
  let left = n;
  staff.forEach((i, k) => {
    const g = k === staff.length - 1 ? left : Math.floor(n * P.salary[i] / Math.max(1, total));
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
  econ.nationIn(W, 'social', so.rest);
  econ.nationIn(W, 'income', tax);
  econ.districtIn(W, P.dist[i], 'resident', resident);
  // (rounding: what is left beyond the takings is theirs)
  P.cash[i] += gross - so.pension - so.rest - tax - resident;
  P.inc[i] += net;
  if (kind === 'salary' && age < 60) {
    // the pension's record: a month paid in, on this pay
    P.penM[i] = Math.min(65535, P.penM[i] + 1);
    P.penPay[i] = Math.round(P.penPay[i] + (gross - P.penPay[i]) / Math.max(12, P.penM[i]));
  }
}

// A company's dividends of the day to the people holding its shares (`out`: its shares out): the listed ones' by the
// shares each holds; the others' to those listed as holding them (their founders and backers); a player's part goes
// to the players (server/core/stocks.js pays them), a company's is in its own books already.
function dividends(W, company, n, out) {
  const P = W.P, k = LISTED_IDS.indexOf(company);
  if (n <= 0 || !out) return;
  let paid = 0;
  if (k >= 0) {
    for (let i = 0; i < P.n; i++) {
      const s = P.sh[i * LISTED + k];
      if (s <= 0) continue;
      const d = Math.floor(n * s / out);
      P.cash[i] += d;
      paid += d;
    }
  } else {
    for (const [i, s] of W.priv[company] || []) {
      const d = Math.floor(n * s / out);
      P.cash[i] += d;
      paid += d;
    }
  }
  // the players' part is theirs (their side pays it: server/core/stocks.js); the rounding, the local businesses'
  const players = Math.min(n - paid, Math.floor(n * ((W.playerShares || {})[company] || 0) / out));
  W.sum.toPlayers += players;
  W.sector.cash += n - paid - players;
  W.sum.divRest += n - paid - players;
}

/* ------------------------------------------------------- the local businesses --- */
// The rest of the country's trade (the shops, restaurants, landlords, clinics, builders that are not the ten): what
// it took in today it pays out — its people's pay on the 25th, a バイト's by the hour, the rest to those who own it
// (rent and profit, by what they have), less a cushion of a month.
export function sectorDay(W, day) {
  const P = W.P, s = W.sector, t = CORP.ymd(day);
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
  for (const [id, c] of Object.entries(mw.ip.contracts)) if (c.on && M.partners[id]) list.push([id, 'myway', M.partners[id].fee * M.partners[id].lift / all]);
  if (W.cal.collab === undefined) {
    const P = W.P;
    let households = 0;
    for (let i = 0; i < P.n; i++) if (P.hh[i] === i) households += Math.pow(memberList(P, i).length, 0.75) * Math.pow(Math.max(0.02, (P.cash[i] + 1) / 60000000), 0.22) * (1 - 0.35 * tr(P, i, T.thrift));
    W.cal.collab = Math.round(all * W.scale / YEAR / Math.max(1, households));
  }
  return { list, pull: Math.max(0, mw.ip.heat * mw.ip.brand) };
}
export function dayStart(W, day, r, ctx) {
  const P = W.P, t = CORP.ymd(day), age = (i) => ageOf(P, i, day);
  W.nation.day = { in: {}, out: {} };
  for (const d of W.districts) d.day = { in: {}, out: {} };
  for (let i = 0; i < P.n; i++) { P.buyDay[i] = 0; P.trades[i] = 0; }
  if (t.d === 1) month(W, day, r, ctx);
  const fans = collabOf(W, ctx);
  // living: the day's food and things of the household (ジンクス's goods, the local shops'), by its size and money
  for (let i = 0; i < P.n; i++) {
    if (P.hh[i] !== i && P.home[i] !== HOME.stay && P.home[i] !== HOME.street) continue;
    const size = P.hh[i] === i ? memberList(P, i).length : 1;
    const wealth = Math.pow(Math.max(0.02, (P.cash[i] + 1) / 60000000), 0.22);
    const thrift = 1 - 0.35 * tr(P, i, T.thrift);
    const street = P.home[i] === HOME.street ? 0.15 : 1;
    const n = W.cal.living * Math.pow(size, 0.75) * wealth * thrift * street * (W.capacity.jinx || 1) * (1 + NPC.knobOf(W, 'livingCost') / 100);
    econ.buy(W, i, day, 'jinx', 'goods', econ.spendAt(W, 'jinx:goods', n * 0.62), true);
    econ.toSector(W, i, Math.round(n * 0.38), true, 'living');
    // MY WAY's fans (購入熱): its characters' goods and collaborations at its partners and its own showroom, as much as
    // the characters pull, the impulsive the more
    if (fans) {
      const k = W.cal.collab * Math.pow(size, 0.75) * wealth * thrift * street * (0.4 + 1.2 * tr(P, i, T.impulse)) * fans.pull;
      if (k >= 1) for (const [co, stream, part] of fans.list) econ.buy(W, i, day, co, stream, Math.round(k * part), false);
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
    const cap = (W.cal.bank0 || Math.round(3e12 * W.scale)) * NPC.knobOf(W, 'debtCap') / 100;
    const n = Math.min(Math.ceil((W.cal.nationFloor * 2 - W.nation.cash) / 1e9) * 1e9, Math.max(0, Math.floor((cap - W.nation.bank) / 1e9) * 1e9));
    if (n > 0) {
      W.nation.cash += n;
      W.nation.bank += n;
      W.nation.debt += n;
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
  const P = W.P, phone = NPC.knobOf(W, 'phoneBill'), slot = NPC.life.casinoMonthly, quick = NPC.knobOf(W, 'quickRate') / 100;
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
      const bill = Math.round((W.cal.utilities || NPC.life.utilities) * Math.sqrt(memberList(P, i).length) * (1 + NPC.knobOf(W, 'livingCost') / 100));
      econ.toSector(W, i, bill, true, 'utilities');
    }
    // the phone: everyone has one, at the same $100,000 a month (テネシス・モバイル); unpaid, it is cut off
    if (econ.pay(W, i, phone, P.cash[i] > -NPC.trouble.quickMax)) { econ.toStream(W, day, 'tenesice', 'mobile', phone); P.phone[i] = 0; }
    else P.phone[i] = 1;
    // the slots: a month played, $1,000,000 to Dtrade
    if (P.spun[i]) {
      econ.pay(W, i, slot, true);
      econ.toStream(W, day, 'dtrade', 'slotfee', slot);
      P.spun[i] = 0;
    }
    if (P.home[i] === HOME.rent && P.rent[i] > 0) {
      if (P.flags[i] & FL.welfare) { econ.nationOut(W, 'welfare', P.rent[i]); W.sector.cash += P.rent[i]; W.sector.inNation += P.rent[i]; }
      else econ.toSector(W, i, P.rent[i], true, 'rent');
    }
    // VIP (DAIZIN): a member's year renewed while they can afford it and still care for it (the dearer, the fewer),
    // the month's fee paid; and the rich who are vain enough join
    const vipPrice = econ.priceOf(W, 'daizin:vipFee'), vipFee = Math.round(W.cal.vipFee * vipPrice);
    if (P.vip[i] > 0) {
      if (P.vip[i] <= day + 31 && P.cash[i] > vipFee * 24 && r.u() < 0.55 + 0.4 * tr(P, i, T.vanity) - 0.3 * Math.max(0, vipPrice - 1)) P.vip[i] += 365;
      if (!(P.vip[i] > day) || !econ.buy(W, i, day, 'daizin', 'members', vipFee, false)) P.vip[i] = 0;
    } else if (P.cash[i] > 300000000 && r.u() < 0.02 * (0.3 + tr(P, i, T.vanity)) / Math.max(0.3, vipPrice)) {
      if (econ.buy(W, i, day, 'daizin', 'members', vipFee, false)) P.vip[i] = day + 365;
    }
    if (P.car[i]) econ.buy(W, i, day, 'carowner', 'service', econ.spendAt(W, 'carowner:service', W.cal.service * (0.5 + r.u())), true);
    // the 国民年金 and 国民健康保険 of those not employed (students wait; those with little are let off half)
    if (age >= 18 && age < 60 && !isEmployee(P.job[i]) && P.job[i] !== NPC.job.home) {
      if (P.job[i] === NPC.job.student) { /* 学生納付特例 */ }
      else if (P.cash[i] < 3000000 && !P.salary[i]) { P.penHalf[i]++; P.penM[i]++; }
      else if (econ.pay(W, i, NPC.social.national, true)) { W.nation.fund.cash += NPC.social.national; W.nation.day.in.pensionIn = (W.nation.day.in.pensionIn || 0) + NPC.social.national; P.penM[i]++; }
      const nhi = Math.min(NPC.social.nhiCap, Math.round((P.salary[i] || 0) / 12 * NPC.social.nhi));
      if (nhi && econ.pay(W, i, nhi, true)) econ.nationIn(W, 'social', nhi);
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
        // not paid: added to what is owed, the credit marked down
        P.debt[i] += int;
        W.sum.lent += int;
        econ.toBank(W, day, 'nii', int);
        P.credit[i] = clampB(P.credit[i] - 12);
      }
    }
    // the 生活保護: those it has found, up to what one needs to live
    if (P.flags[i] & FL.welfare) {
      const need = Math.max(0, welfare - Math.max(0, P.inc[i]));
      if (need > 0) { econ.nationOut(W, 'welfare', need); P.cash[i] += need; }
      if (P.cash[i] > welfare * 6 && P.inc[i] > welfare) P.flags[i] &= ~FL.welfare;
    }
    budgetOf(W, i, age, r);
    P.inc[i] = 0;
    P.spent[i] = 0;
  }
  owners(W);
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
// of what they have, more for the old), and its parts: the slots, the games, the pleasures, the market
export function budgetOf(W, i, age, r) {
  const P = W.P, c = W.cal;
  const inc = (P.salary[i] || 0) / 12 * 0.78 + P.penAmt[i] + (P.jobless[i] ? P.joblessPay[i] : 0) + Math.max(0, P.inc[i]) * 0.3;
  const wealth = Math.max(0, P.cash[i]);
  const keep = 0.5 + 0.45 * (1 - tr(P, i, T.thrift));
  const draw = (0.01 + 0.04 * (age >= 60 ? 1 : age / 60)) * (1 - 0.5 * tr(P, i, T.thrift)) / 12;
  const mood = P.emo[i * 5 + E.mood] / 255;
  const b = Math.max(0, inc * keep + wealth * draw) * (0.85 + 0.3 * mood);
  P.budget[i] = Math.round(b);
  const w = weightsOf(P, i, age);
  P.fund[i * 4] = Math.round(b * c.casino * w.casino * NPC.life.casinoSpend);
  P.fund[i * 4 + 1] = Math.round(b * c.games * w.games);
  P.fund[i * 4 + 2] = Math.round(b * c.leisureShare * w.leisure);
  P.fund[i * 4 + 3] = Math.round(wealth * c.invest * w.invest);
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
    let n = P.penAmt[i] * 2 * (1 + level / 100) * paidNow;
    // (working on a big pay: a part of it held back, 在職老齢年金)
    if (P.salary[i] / 12 + P.penAmt[i] > PEN.workCap) n = Math.max(0, n - (P.salary[i] / 12 + P.penAmt[i] - PEN.workCap));
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
  const spare = Math.max(0, W.nation.cash - W.cal.nationFloor * 5);
  const budget = W.cal.publicWorks * (1 + (W.nation.knobs.publicWorks || 0) / 100) / YEAR * solvency(W) + spare / YEAR;
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
      const g = Math.round(W.cal.grants[k] * (1 + (W.nation.knobs.grants || 0) / 100) / 12 * solvency(W));
      econ.nationOut(W, 'grants', g);
      econ.districtIn(W, k, 'grants', g);
    }
    W.politics.spend(W, k, day, r);
  });
}

/* ---------------------------------------------------------------- lives --- */
// a day's chance of dying at an age (Gompertz: half the people gone by about 83, 80 on average), by health
const deathRate = (age, health) => 5.3e-5 * Math.exp(0.085 * age) / YEAR * (1.6 - health / 255);
function lives(W, day, r, ctx) {
  const P = W.P;
  for (let i = 0; i < P.n; i++) {
    const age = ageOf(P, i, day);
    // health: a little lower each year past 50, an illness now and then
    if (r.u() < 0.0015 + age * 0.00005) { P.health[i] = clampB(P.health[i] - 20 - r.int(40)); P.flags[i] |= FL.sick; }
    else if (P.health[i] < 230 - Math.max(0, age - 50) * 2) P.health[i] = clampB(P.health[i] + 1);
    if (P.health[i] > 120) P.flags[i] &= ~FL.sick;
    if (r.u() < deathRate(age, P.health[i])) { die(W, i, day, r, ctx); continue; }
    // birthdays
    if (Math.floor((day - P.birth[i]) % 365.25) === 0) birthday(W, i, age, day, r);
  }
  W.labor.day(W, day, r, ctx);
}
function birthday(W, i, age, day, r) {
  const P = W.P, PEN = NPC.pension, at = W.nation.knobs.pensionAge || PEN.age;
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
    heirs.forEach((j, k) => { const g = k === heirs.length - 1 ? left : Math.floor((estate - tax) * parts[k] / sum); P.cash[j] += g; left -= g; });
    for (let k = 0; k < LISTED; k++) {
      const s = P.sh[i * LISTED + k];
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
      const s = P.sh[i * LISTED + k];
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
// its character from them), the rest young people come to live here; a little money of their own and the family's
// help; a student or looking for work.
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
  P.health[i] = 230 + r.int(20);
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
  P.job[i] = r.u() < 0.6 ? NPC.job.student : NPC.job.none;
  P.dept[i] = 0; P.rank[i] = 0; P.salary[i] = 0; P.tenure[i] = 0; P.jsat[i] = 160; P.shift[i] = r.int(2); P.wdist[i] = P.dist[i];
  P.flags[i] = FL.newborn | (P.job[i] === NPC.job.student ? FL.student : 0);
  P.debt[i] = 0; P.dkind[i] = 0; P.credit[i] = 150; P.car[i] = 0; P.carDay[i] = 0; P.vip[i] = 0; P.phone[i] = 0; P.spun[i] = 0; P.live[i] = 0; P.subs[i] = 0;
  P.penM[i] = 0; P.penPay[i] = 0; P.penHalf[i] = 0; P.penDefer[i] = 0; P.penAmt[i] = 0; P.jobless[i] = 0; P.joblessPay[i] = 0;
  P.aware[i] = 0; P.sign[i] = 0; P.vote[i] = 0; P.grief[i] = 0; P.lastBig[i] = day; P.why[i] = 0; P.budget[i] = 0; P.spent[i] = 0; P.inc[i] = 0;
  P.fund.fill(0, i * 4, i * 4 + 4);
  P.cash[i] = 0;
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
    P.rent[i] = Math.round((80000 + r.int(40) * 1000) * (1 + NPC.knobOf(W, 'rentLevel') / 100));
    // (come from elsewhere with what they saved: the country's start-up grant for the young)
    const n = 1500000 + r.int(2000000);
    econ.nationOut(W, 'youth', n);
    P.cash[i] = n;
  }
  for (let k = 0; k < 4; k++) { const j = r.int(P.n); if (Math.abs(ageOf(P, j, day) - 18) < 6) addRelation(P, i, j, 80, 120); }
  P.upd[i] = W.minute;
  budgetOf(W, i, 18, r);
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
export const rentFor = (W, d) => Math.round((90000 + (d === 3 ? 60000 : 0)) * (1 + NPC.knobOf(W, 'rentLevel') / 100));
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
    const broke = P.cash[i] < 0 || (P.debt[i] > econ.quickCap(P, i) * 1.3 && P.cash[i] < 300000);
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
