// 株式会社HACHI on the companies' side (js/game/corp.js HACHI): its founding on 2026-11-04 — no made-up past, its
// 利益剰余金 the treasury's $20B once, Tenesice's loan that day —, its wards (HACHI ○○区 第○病院, 5 in ヴェルノア and 15
// in アスカ国 at the start, 7 to 45 in all) and what each costs a month (land, 管理費, FIGMA's equipment), its joint
// research with アスカ国, MY WAY's five-year contract, and its failure: アスカ国 alone buys the whole business at twice its
// market value and the state runs it from then on (国の管理下: no one let go, 20 wards, no land rent). Its patients and
// what they pay: server/core/hachi.js (the people's side). Every $ from someone to someone.
//
// (corp-model.js hands it its own helpers — `H` —: its books' postings, the news, Tenesice's lending.)
import { CORP, NPC, ASUKA } from './rules.js';

const R = CORP.hachi, YEAR = 365;
export const FOUNDED = R ? CORP.dayAt(...R.founded) : Infinity;
const DN = (k) => NPC.districts[k].name, AN = (k) => ASUKA.districts[k].name;

// the wards it starts with: one in each of ヴェルノア's districts, three in each of アスカ国's
function startWards(d) {
  const list = [];
  for (let k = 0; k < NPC.districts.length && list.length < R.wards.vernoa; k++) list.push({ id: 'v' + k + '-1', country: 'vernoa', district: k, k: 1, name: CORP.wardName(DN(k), 1), opened: d });
  for (let n = 0; n < R.wards.asuka; n++) {
    const k = n % ASUKA.districts.length, no = Math.floor(n / ASUKA.districts.length) + 1;
    list.push({ id: 'a' + k + '-' + no, country: 'asuka', district: k, k: no, name: CORP.wardName(AN(k), no), opened: d });
  }
  return list;
}
export const wardsOf = (s, country) => ((s && s.hachi && s.hachi.wards) || []).filter((x) => !country || x.country === country);
export const stateRun = (s) => !!(s && s.hachi && s.hachi.state);
// what's paid to アスカ国 today (land, 管理費, FIGMA, the joint research, a buyout): taken into its books by
// corp-model asukaDay with the rest of what the companies paid it
const xOf = (w) => w.hachiX || (w.hachiX = { land: 0, admin: 0, figma: 0, research: 0, owner: 0, social: 0, need: 0, buyout: null });

/* ------------------------------------------------------------- the founding --- */
// The day it is founded (once): its books fresh — its 利益剰余金 the treasury's (out of it today: the people's side),
// no capital, its shares counted at its price —, its wards, Tenesice's loan, its ties, MY WAY's contract.
export function found(H, w, d, out, ch) {
  const p = H.PROFILES.get('hachi');
  if (!p || w.co.hachi || d < FOUNDED) return null;
  const sc = H.sizeScale(w, p), seed = Math.round(R.seed * sc);
  const s = H.newCompany(p, d, d, seed, ch);
  // (nothing owed to it and nothing in stock: a company of a day; its money the treasury's seed alone)
  s.bal = { capital: 0, reserve: 0, retained: seed, ppe: 0, cash: seed };
  s.recv = 0;
  s.n = Math.max(1, Math.round(p.staff * sc));
  s.target = s.n;
  s.payAll = true;
  s.hachi = { founded: d, wards: startWards(d), state: null, m: blankMonth(), last: null, hist: [], research: 0, figma: 0, red: 0, opened: 0, closed: 0 };
  w.co.hachi = s;
  budgetsOf(w, s);
  // (what it expects to take a day: everyone's monthly checkup in both countries — what it guides by until its own
  // days are there; without the country, its profile's sales as the others': `alone`)
  const people = (NPC.nation.population + ASUKA.rules.population) * sc;
  s.pr = w.ext ? { checkup: people * R.fees.checkup / 30, consult: people * 0.05 * R.fees.consult / 30, medicine: people * 0.05 * R.fees.medicine / 30 } : {};
  // (its shares: its value at its price, a fifth its founders')
  s.sh.issued = 1;
  s.guide = H.guidance(w, s, p, d, H.forecast(w, s, p, d));
  const price = p.price, v = H.fairValue(s, p, w);
  s.sh.issued = Math.max(1000, Math.round(v / price));
  s.sh.founders = Math.round(s.sh.issued * (p.founders || 0));
  s.sh.out = s.sh.issued;
  s.sh.at = d * 86400;
  const fy = CORP.fyOf(d);
  s.sd = { m: 0, q: 0, y: 0 };
  s.mkt = { e: Math.log(price), fair: price };
  s.guide = H.guidance(w, s, p, d, H.forecast(w, s, p, d));
  H.setDividend(s, p, s.guide);
  void fy;
  // (the treasury's seed: out of it with the people's side's day)
  if (w.ext) { const st = w.ext.stateIn || (w.ext.stateIn = {}); void st; (w.ext.hachiSeed = (w.ext.hachiSeed || 0) + seed); }
  // Tenesice's loan that day: three months of its costs, at its friend's rate, kept ten years
  const want = Math.ceil(monthly(w, s) * R.loan.months / H.M.unit) * H.M.unit, amt = H.lendable(w, s, want);
  if (amt > 0) {
    s.loans.push({ id: 'L' + (++s.seq), amt, rate: R.loan.rate, from: d, until: d + R.loan.years * YEAR, keep: true });
    H.post(s, [['cash', amt], ['loan', -amt]], 'borrow');
    w.mon['hachi:borrowed'] = (w.mon['hachi:borrowed'] || 0) + amt;
  }
  // its ties (Tenesice's the warmest), and MY WAY's contract for its checkups' advertising (five years)
  w.ties = w.ties || {};
  for (const t of H.ties()) if (w.ties[t.key] === undefined) w.ties[t.key] = t.start;
  const mw = w.co.myway, x = CORP.myway.partners.hachi;
  if (mw && !mw.dead && mw.ip && x && !mw.ip.contracts.hachi) {
    mw.ip.contracts.hachi = { ...H.newContract(x, d), until: d + (x.term || R.myway.years) * YEAR, term: x.term || R.myway.years };
    H.news(out, mw, H.PROFILES.get('myway'), d + 1, 4 * 3600, 'license', `HACHIとキャラクター使用権の契約を締結（${x.what}・年${CORP.fmt.money(x.fee)}）`, { partner: 'hachi' }, 0.01, true);
  }
  const V = wardsOf(s, 'vernoa').length, A = wardsOf(s, 'asuka').length;
  H.news(out, s, p, d + 1, 1 * 3600, 'found', `株式会社HACHIが設立（世界最大の医療企業）。ヴェルノアに${V}病棟・アスカ国に${A}病棟を開設、全国民の月1回の定期検診が始まります。利益剰余金${CORP.fmt.money(seed)}は国庫から、テネシスから${CORP.fmt.money(amt)}を借入`, { wards: V + A, seed, loan: amt }, 0, true);
  return s;
}
const blankMonth = () => ({ sales: 0, cost: 0, visits: {}, asuka: 0, vernoa: 0 });

// a year's budgets as its wards stand (what the month's costs and the guidance count): their land and 管理費, FIGMA's
// equipment — booked by `day` as they go, not by the budgets themselves (corp-model running skips them)
export function budgetsOf(w, s) {
  const sc = H0.sizeScale(w, H0.PROFILES.get('hachi')), n = wardsOf(s).length, land = stateRun(s) ? 0 : R.wards.land;
  s.budget = s.budget || {};
  s.budget.place = Math.round(n * (land + R.wards.admin) * 12 * sc);
  s.budget.other = Math.round(n * R.equipment * 12 * sc);
  s.budget.rd = s.budget.rd || 0;
  s.budget.ads = 0;
  s.budget.capex = 0;
}
// (the helpers of its last call: budgetsOf is called from where `H` is not passed)
let H0 = null;
// what a month costs it: its people here and there, its wards, its equipment
export function monthly(w, s) {
  const asukaPay = (s.hachi && s.hachi.asukaPay) || 0;
  return Math.round(s.n * s.unit / 12 + asukaPay * R.burden / 12 + ((s.budget.place || 0) + (s.budget.other || 0)) / 12);
}

/* --------------------------------------------------------------- its days --- */
// A day's costs of its wards (a day's share of their month): the land (to the country it stands in — none under the
// state), the 管理費 (the local businesses' work: ヴェルノア's, アスカ国's trade), FIGMA's equipment and its upkeep.
export function day(H, w, s, p, d) {
  H0 = H;
  if (!s.hachi) return;
  const sc = H.sizeScale(w, p), state = stateRun(s);
  const V = wardsOf(s, 'vernoa').length, A = wardsOf(s, 'asuka').length;
  const per = (x) => x * 12 / YEAR * sc;
  const landV = H.take(s, 'hLandV', state ? 0 : per(R.wards.land) * V), landA = H.take(s, 'hLandA', state ? 0 : per(R.wards.land) * A);
  const adminV = H.take(s, 'hAdminV', per(R.wards.admin) * V), adminA = H.take(s, 'hAdminA', per(R.wards.admin) * A);
  const equip = H.take(s, 'hEquip', per(R.equipment) * (V + A));
  const all = landV + landA + adminV + adminA + equip;
  if (all <= 0) return;
  H.post(s, [['sPlace', landV + landA + adminV + adminA], ['sOther', equip], ['cash', -all]], 'expenses');
  const by = s.expBy || (s.expBy = {});
  by.place = (by.place || 0) + landV + landA + adminV + adminA;
  by.other = (by.other || 0) + equip;
  s.hachi.figma += equip;
  if (!w.ext) return;
  if (landV) { const st = w.ext.stateIn || (w.ext.stateIn = {}); st.hachiLand = (st.hachiLand || 0) + landV; }
  if (adminV) { w.ext.sector += adminV; const b = w.ext.sectorBy || (w.ext.sectorBy = {}); b['hachi:admin'] = (b['hachi:admin'] || 0) + adminV; }
  const X = xOf(w);
  X.land += landA; X.admin += adminA; X.figma += equip;
}
// Tenesice's special line (非常に友好的: CORP.hachi.loan.credit): any day its money at hand falls below `credit` days of
// its costs — more going out than its windows take in —, lent at once what brings it back to a month's, at its friend's
// rate, as far as `line` months of its costs owed in all (its wards and its people kept). Paid back as any loan once
// it has plenty again (corp-model treasury). Not under the state (the state's to put in).
export function credit(H, w, s, p, d, out) {
  if (!s.hachi || s.dead || stateRun(s)) return 0;
  const cost = monthly(w, s), cash = s.bal.cash || 0;
  if (cash >= cost * R.loan.credit / 30) return 0;
  const owed = s.loans.reduce((n, l) => n + l.amt, 0), room = Math.max(0, cost * R.loan.line - owed);
  const want = Math.min(Math.ceil((cost - cash) / H.M.unit) * H.M.unit, Math.floor(room / H.M.unit) * H.M.unit);
  const amt = H.lendable(w, s, want);
  if (amt <= 0) return 0;
  s.loans.push({ id: 'L' + (++s.seq), amt, rate: R.loan.rate, from: d, until: d + 5 * YEAR, line: true });
  H.post(s, [['cash', amt], ['loan', -amt]], 'borrow');
  w.mon['hachi:borrowed'] = (w.mon['hachi:borrowed'] || 0) + amt;
  s.hachi.credit = (s.hachi.credit || 0) + amt;
  H.news(out, s, p, d + 1, 5 * 3600, 'loan', `テネシスの特別融資枠から運転資金${CORP.fmt.money(amt)}を借入（年${(R.loan.rate * 100).toFixed(1)}%・病棟と社員を維持）`, { amt, rate: R.loan.rate }, -0.002, true);
  return amt;
}

/* -------------------------------------------------------------- its month --- */
// At a month's end: what it made beyond its cushion into the joint research with アスカ国 (アスカ国's medical research,
// FIGMA's other customer); its wards reviewed (its 経営陣's, never under the state); MY WAY's contract at its term;
// under the state, what it made beyond its cushion the state's, what it lacks the state's to put in.
export function month(H, w, s, p, d, out) {
  H0 = H;
  if (!s.hachi || s.dead) return;
  const h = s.hachi, state = stateRun(s), pl = CORP.plOf(s.per.m), cost = monthly(w, s);
  const cash = (s.bal.cash || 0) + (s.bal.bonds || 0);
  h.red = pl.op < 0 ? h.red + 1 : 0;
  let research = 0, owner = 0;
  if (!state) {
    research = Math.max(0, Math.round(R.research.share * Math.max(0, pl.op) + Math.max(0, cash - cost * R.research.cushion) / 12));
    research = Math.min(research, Math.max(0, (s.bal.cash || 0) - cost));
  } else {
    owner = Math.max(0, Math.round((cash - cost * R.research.cushion) / 12));
    owner = Math.min(owner, Math.max(0, (s.bal.cash || 0) - cost));
    // (short of a month of its costs: the state puts in what it lacks — アスカ国's treasury, its next day)
    if ((s.bal.cash || 0) < cost) xOf(w).need += Math.round(cost * 2 - (s.bal.cash || 0));
  }
  if (research > 0) { H.post(s, [['sRd', research], ['cash', -research]], 'expenses'); h.research += research; if (w.ext) xOf(w).research += research; }
  if (owner > 0) { H.dpost(s, [['eOther', owner], ['cash', -owner]], 'expenses'); if (w.ext) xOf(w).owner += owner; }
  const visits = { ...h.m.visits };
  h.last = { day: d, key: CORP.monthKey(d), sales: pl.sales, op: pl.op, research, owner, wards: h.wards.length, vernoa: wardsOf(s, 'vernoa').length, asuka: wardsOf(s, 'asuka').length, visits, busy: h.busy || 0, staff: s.n, asukaStaff: h.asukaStaff || 0 };
  h.hist.push(h.last);
  if (h.hist.length > 24) h.hist.shift();
  if (!state) review(H, w, s, p, d, out, pl);
  else settleState(H, w, s, p, d, out);
  renewal(H, w, s, d, out);
  h.m = blankMonth();
  budgetsOf(w, s);
}
// its wards for the next month (its 経営陣): busier than `busy` of what they can do and in the black, one more where
// the patients are most a ward (its equipment FIGMA's); quieter than `quiet`, or two months in the red, one fewer
// where they are fewest — within 7 and 45 in all
function review(H, w, s, p, d, out, pl) {
  const h = s.hachi, n = h.wards.length;
  const per = { vernoa: (h.patients && h.patients.vernoa) || 0, asuka: (h.patients && h.patients.asuka) || 0 };
  const load = (c) => per[c] / Math.max(1, wardsOf(s, c).length);
  // (a ward's share of everyone's visits: both countries' people at this world's size, over the wards it began with)
  const sc = H.sizeScale(w, p), standard = (NPC.nation.population + ASUKA.rules.population) * sc * R.review.visits / (R.wards.vernoa + R.wards.asuka);
  const busy = (per.vernoa + per.asuka) / Math.max(1, n) / Math.max(1, standard);
  h.busy = busy;
  if (busy > R.review.busy && pl.op > 0 && n < R.wards.max) {
    const where = load('asuka') >= load('vernoa') ? 'asuka' : 'vernoa';
    const cost = Math.round(R.wards.open * H.sizeScale(w, p));
    if ((s.bal.cash || 0) > cost + monthly(w, s) * 2) {
      const x = open(s, where, d);
      H.post(s, [['ppe', cost], ['cash', -cost]], 'capex');
      if (w.ext) xOf(w).figma += cost;
      h.figma += cost; h.opened++;
      H.news(out, s, p, d + 1, 4 * 3600, 'ward', `${x.name}を開設（病棟${h.wards.length}か所・医療機器はFIGMAから${CORP.fmt.money(cost)}）`, { wards: h.wards.length }, 0.004, true);
    }
  } else if (n > R.wards.min && (busy < R.review.quiet || h.red >= 2)) {
    const where = load('asuka') >= load('vernoa') ? 'vernoa' : 'asuka';
    const x = close(s, where);
    if (x) { h.closed++; H.news(out, s, p, d + 1, 4 * 3600, 'ward', `${x.name}を閉鎖（病棟${h.wards.length}か所：${h.red >= 2 ? '赤字が続くため' : '患者が少ないため'}）`, { wards: h.wards.length }, -0.004, true); }
  }
}
// a new ward in a country: in its district with the fewest, numbered after the last there
function open(s, country, d) {
  const h = s.hachi, D = country === 'vernoa' ? NPC.districts : ASUKA.districts;
  const count = D.map((_, k) => h.wards.filter((x) => x.country === country && x.district === k).length);
  const k = count.indexOf(Math.min(...count)), no = Math.max(0, ...h.wards.filter((x) => x.country === country && x.district === k).map((x) => x.k)) + 1;
  const x = { id: (country === 'vernoa' ? 'v' : 'a') + k + '-' + no, country, district: k, k: no, name: CORP.wardName(country === 'vernoa' ? DN(k) : AN(k), no), opened: d };
  h.wards.push(x);
  return x;
}
// a ward closed: the last opened in its country's district with the most (never a country's last)
function close(s, country) {
  const h = s.hachi, mine = h.wards.filter((x) => x.country === country);
  if (mine.length <= 1) return null;
  const D = country === 'vernoa' ? NPC.districts : ASUKA.districts;
  const count = D.map((_, k) => mine.filter((x) => x.district === k).length);
  const k = count.indexOf(Math.max(...count)), x = mine.filter((y) => y.district === k).sort((a, b) => b.k - a.k)[0];
  h.wards = h.wards.filter((y) => y !== x);
  return x;
}
// under the state: its wards brought to 20 (two a month), no land rent
function settleState(H, w, s, p, d, out) {
  const h = s.hachi;
  for (let k = 0; k < 2 && h.wards.length !== R.wards.state; k++) {
    if (h.wards.length < R.wards.state) open(s, wardsOf(s, 'asuka').length / 3 <= wardsOf(s, 'vernoa').length ? 'asuka' : 'vernoa', d);
    else close(s, wardsOf(s, 'asuka').length / 3 > wardsOf(s, 'vernoa').length ? 'asuka' : 'vernoa');
  }
  void H; void p; void out;
}
// MY WAY's contract at its term (five years): renewed — its fee talked to what the checkups' advertising was worth —
// or cut; one cut, signed again when it is doing well (one chance in six a month)
function renewal(H, w, s, d, out) {
  const mw = w.co.myway, c = mw && mw.ip && mw.ip.contracts.hachi, x = CORP.myway.partners.hachi;
  if (!c || !x || mw.dead) return;
  const term = (c.term || x.term || R.myway.years) * YEAR;
  if (c.on && d >= (c.until || c.from + term)) {
    const worth = (c.last && c.last.sales) || 0, fee = H.contractFee(c) / 12;
    const tie = H.tieOf(w, 'myway', 'hachi');
    if (worth >= fee * 0.5 || tie >= 65) {
      const mult = Math.max(0.8, Math.min(1.2, worth > 0 ? worth / Math.max(1, fee) : 0.9));
      c.fee = Math.round(c.fee * mult / 1e6) * 1e6;
      c.from = d; c.until = d + term;
      H.news(out, mw, H.PROFILES.get('myway'), d + 1, 4 * 3600, 'license', `HACHIとのキャラクター使用権の契約を5年更新（年${CORP.fmt.money(H.contractFee(c))}・${mult >= 1 ? '増額' : '減額'}）`, { partner: 'hachi' }, 0.005, true);
    } else {
      c.on = false; c.until = d;
      H.news(out, mw, H.PROFILES.get('myway'), d + 1, 4 * 3600, 'license', 'HACHIとのキャラクター使用権の契約が満了し、更新されず終了', { partner: 'hachi' }, -0.005, true);
    }
  } else if (!c.on && (s.hachi.last && s.hachi.last.op > 0) && d - (c.until || d) >= 90 && H.ch(`hachi:resign:${d}`) < 1 / 6) {
    Object.assign(c, { on: true, from: d, until: d + term, fee: x.fee, base: x.fee, scale: 1, bad: 0, good: 0 });
    H.news(out, mw, H.PROFILES.get('myway'), d + 1, 4 * 3600, 'license', `HACHIとキャラクター使用権の契約を再締結（年${CORP.fmt.money(x.fee)}・5年）`, { partner: 'hachi' }, 0.01, true);
  }
}

/* --------------------------------------------------------------- its failure --- */
// Out of money (or below nothing too long): アスカ国 alone buys the whole business — the contract it holds —, at twice
// its market value as it is that day; paid out to its 社長 (20%), its people (50%) and FIGMA's (30%: its 関連社員) on
// アスカ国's side. Its shares struck off (上場廃止: worth nothing), its debts and everything else the state's to carry on
// with; from then on 国の管理下 (no one let go, 20 wards, no land rent).
export function buyout(H, w, s, p, d, out, why) {
  if (stateRun(s)) return;
  const price = Math.round(Math.exp((s.mkt && s.mkt.e) || Math.log(p.price)) * Math.max(1, H.outstanding(s)) * R.buyout.mult);
  s.hachi.state = { day: d, by: 'asuka', price, why };
  s.reorg = { day: d, why: `アスカ国が事業を買収（株価の時価総額の${R.buyout.mult}倍・${CORP.fmt.money(price)}）、国の管理下へ：${why}`, by: 'asuka', staff: s.n, cut: 0 };
  s.div = { dps: 0, daily: 0, total: 0 };
  s.cut = null;
  // (アスカ国's to pay, with the next day's money between the countries — once the country lives)
  if (w.ext || w.circ) xOf(w).buyout = { price, day: d };
  budgetsOf(w, s);
  H.news(out, s, p, d + 1, 2 * 3600, 'buyout', `経営破綻：${why}。契約によりアスカ国が事業そのものを${CORP.fmt.money(price)}（時価総額の${R.buyout.mult}倍）で買収し、まるごと継承。社長に20%・社員に50%・関連社員（FIGMA）に30%を支払い。株式は上場廃止、今後は国の管理下で人員削減なし・20病棟・土地代なし`, { price }, -3, true);
}

/* -------------------------------------------------------------- its people --- */
// When it must cut (経営難): the least needed first by CORP.hachi.cut (researchers, then the 経営陣, the medical staff
// last), never under the state; how many by how far in the red. The people's side picks them by that order.
export function staffing(H, w, s, p, d, out) {
  if (stateRun(s)) { s.cut = null; return true; }
  const h = s.hachi, cash = (s.bal.cash || 0) + (s.bal.bonds || 0), cost = monthly(w, s);
  if (h && h.red >= 2 && cash < cost * 3) {
    const n = Math.min(s.n - 1, Math.max(1, Math.round(s.n * 0.05)));
    const each = Math.round(s.pay / 12 * CORP.staffing.severance);
    s.cut = { n, day: d + 1, each, order: R.cut };
    s.target = Math.max(1, s.n - n);
    H.news(out, s, p, d + 1, 3 * 3600, 'staff', `経営難のため社員${CORP.fmt.group(n)}人の削減を決定（研究者・経営陣・医療従事者の順）`, { cut: n, each }, 0.005, true);
  }
  return true;
}
// how many it wants here (ヴェルノア's): its wards' medical staff, its 経営陣 and its researchers, for this world's size
export function targetHere(w, s) {
  const sc = H0 ? H0.sizeScale(w, H0.PROFILES.get('hachi')) : (w.circ && w.circ.scale) || 1, all = Math.max(1, wardsOf(s).length);
  void all;
  // (175 medical staff a ward — CORP.hachi.perWard —, its 経営陣 and its researchers here)
  return Math.max(1, Math.round(sc * (R.perWard * wardsOf(s, 'vernoa').length + R.staff.exec + R.staff.research)));
}
export function setHelpers(H) { H0 = H; }
