// MY WAY's contracts beyond the thirteen (CORP.myway.locals, .nations): with the local companies (the 32, not the
// banks) and with the two countries (国の公式キャラクター). Kept on the country's side, for their money is the
// country's: each fee paid day by day to MY WAY (its 'ipLocal', 'ipNation' and 'ipAsuka' streams: the companies'
// side books them, server/core/corp-model.js), talked over each day by MY WAY's 交渉係 as the thirteen's are
// (CORP.mywayTalk), and each side decides at the month's start what last month told it: it signs, takes the
// contract up or down a size (契約規模), gives it up, or signs again.
// - a local company's: its fee a year `share` of its sales (at a country of 50,000, × the country's size), its goods
//   of the characters sold to the people as fans (`lift` times the fee at full pull, `cost` of their price bought of
//   others as all its costs are); it signs while the characters pull and it has the money, gives up after months of
//   losing on it
// - a country's: paid out of its treasury (ヴェルノア's, アスカ国's), signed while it has years of the fee to spare;
//   what it brings: its people's love of the characters (ヴェルノア: their pull), アスカ国's the trips to アスカ・リゾート
import { CORP, LOCAL, NPC } from './rules.js';
import * as econ from './npc-econ.js';
import * as local from './npc-local.js';
import * as asuka from './asuka.js';

const MW = CORP.myway, LC = MW.locals, NA = MW.nations, YEAR = 365;
const ALL_FROM = CORP.dayAt(...MW.allFrom);
const scaleOf = (W) => W.P.n / NPC.nation.population;
const mwOf = (ctx) => { const s = ctx && ctx.corp && ctx.corp.co && ctx.corp.co.myway; return s && !s.dead && s.ip ? s : null; };
const pullOf = (s) => Math.max(0, s.ip.heat * s.ip.brand);
const sizeOf = (k) => (k && k.scale) || 1;

export function state(W) { return W.ipDeals || (W.ipDeals = { list: {}, events: [], talks: { day: -1, n: 0, deals: 0, all: 0, gained: 0 } }); }
// the contract's fee a year, at its size and the size of whoever pays it
export const feeOf = (k) => Math.round(k.fee * sizeOf(k) * (k.size || 1));
function event(W, day, text, id) {
  const D = state(W);
  D.events.push({ day, text, id });
  if (D.events.length > 40) D.events.shift();
}
// a local company's fee a year at size 1 (at a country of 50,000)
const localFee = (f) => Math.max(LC.min, Math.round(f.sales * LC.share / 1e6) * 1e6);
const firmOf = (W, id) => (W.locals && W.locals.firms[id]) || null;
const canSign = (f, c) => f.sphere !== 'bank' && c && !c.dead && !c.yamato;
function blank(kind, id, name, fee, size, day) {
  return { kind, id, name, fee, base: fee, scale: 1, size, on: true, from: day, until: null, bad: 0, m: { fee: 0, sales: 0, cost: 0 }, last: null, talk: null };
}
function sign(W, key, k, day, why) {
  k.on = true; k.from = day; k.bad = 0; k.m = { fee: 0, sales: 0, cost: 0 };
  event(W, day, `${k.name}とIP契約（年${NPC.money(feeOf(k))}）${why ? '・' + why : ''}`, key);
  W.news.push({ day, kind: 'company', district: 3, text: `${k.name}がMY WAYとIP契約を締結（年${NPC.money(feeOf(k))}）${why ? '：' + why : ''}`, data: { ip: key } });
}
function cancel(W, key, k, day, why) {
  k.on = false; k.until = day; k.bad = 0;
  event(W, day, `${k.name}が契約を打ち切り${why ? '（' + why + '）' : ''}`, key);
  W.news.push({ day, kind: 'company', district: 3, text: `${k.name}がMY WAYとのIP契約を打ち切り${why ? '（' + why + '）' : ''}`, data: { ip: key } });
}
function resize(W, key, k, mult, day, why) {
  const [lo, hi] = MW.scale.range, was = sizeOf(k);
  const to = Math.round(Math.max(lo, Math.min(hi, was * mult)) * 1000) / 1000;
  if (Math.abs(to - was) < 1e-6) return false;
  k.scale = to;
  event(W, day, `${k.name}との契約規模を${to > was ? '拡大' : '縮小'}（×${was.toFixed(2)}→×${to.toFixed(2)}・年${NPC.money(feeOf(k))}）${why ? '・' + why : ''}`, key);
  return true;
}

/* ---------------------------------------------------------------- the day --- */
// The day (as it begins): the contracts' month weighed on its second day, each fee paid, and the day's talks
export function day(W, day, r, ctx) {
  const s = mwOf(ctx), D = state(W);
  if (!s) {
    // (MY WAY gone: every contract with it ends)
    for (const [key, k] of Object.entries(D.list)) if (k.on) cancel(W, key, k, day, 'MY WAYの破産');
    return;
  }
  if (day < ALL_FROM || !W.locals) return;
  const pull = pullOf(s);
  // (on the month's second day: the first its month is closed — npc-local.js month — and its pay and bills of the
  // month's end behind it)
  if (CORP.ymd(day).d === 2 || !D.seen) month(W, day, r, pull);
  D.seen = true;
  for (const [key, k] of Object.entries(D.list)) {
    if (!k.on) continue;
    const n = Math.round(feeOf(k) / YEAR);
    if (n <= 0) continue;
    if (k.kind === 'local') {
      const c = firmOf(W, k.id);
      if (!c || c.dead) { cancel(W, key, k, day, '倒産'); continue; }
      c.cash -= n; c.m.cost += n;
      W.sector.cash -= n;
      econ.toStream(W, day, 'myway', 'ipLocal', n);
    } else if (k.id === 'vernoa') {
      econ.nationOut(W, 'myway', n);
      econ.toStream(W, day, 'myway', 'ipNation', n);
    } else if (k.id === 'asuka') {
      if (!asuka.payMyway(W, n)) continue;
    }
    k.m.fee += n;
  }
  talks(W, day, r, pull);
}
// What last month told each side (the month's second day): a local company that loses on it for months gives it up, one that
// earns well on it takes a bigger one, one barely earning a smaller; one without signs while the characters pull and
// it has the money; a country by what its treasury can spare
function month(W, day, r, pull) {
  const D = state(W), sc = scaleOf(W);
  for (const f of LOCAL.firms) {
    const c = firmOf(W, f.id), key = 'local:' + f.id;
    let k = D.list[key];
    if (!canSign(f, c)) continue;
    // (its month's costs and pay; before its first month is done, what its plan's costs are a month: its sales less its profit)
    const costs = Math.max(1, c.last ? (c.last.cost || 0) + (c.last.pay || 0) : (f.sales - (f.op || 0)) * sc / 12);
    if (k && k.on) {
      const last = k.last = { ...k.m, margin: Math.round(k.m.sales - k.m.cost - k.m.fee) };
      k.m = { fee: 0, sales: 0, cost: 0 };
      k.bad = last.margin < 0 ? k.bad + 1 : 0;
      const share = last.margin / Math.max(1, last.fee);
      if (k.bad >= LC.badMonths || pull < LC.pull * 0.6) cancel(W, key, k, day, k.bad >= LC.badMonths ? '採算割れが続いたため' : 'キャラクター人気の低下');
      else if (share > 0.6 && pull >= 1 && c.cash > costs * LC.months && r.u() < 0.5) resize(W, key, k, MW.scale.step, day, '売れ行き好調');
      else if (share < 0.05 && sizeOf(k) > MW.scale.range[0] && r.u() < 0.5) resize(W, key, k, 1 / MW.scale.step, day, '採算の改善');
      continue;
    }
    // (not one that just gave it up; signing again asks more of the characters)
    if (k && k.until !== null && day - k.until < 60) continue;
    if (pull < LC.pull * (k ? LC.again : 1) || c.cash < costs * LC.months || r.u() >= 0.3) continue;
    if (!k) k = D.list[key] = blank('local', f.id, f.name, localFee(f), sc, day);
    else k.size = sc;
    sign(W, key, k, day, k.until !== null ? '再契約' : '');
  }
  // the countries
  for (const id of ['vernoa', 'asuka']) {
    const N = NA[id], key = 'nation:' + id, a = W.asuka;
    if (id === 'asuka' && !a) continue;
    const size = id === 'asuka' ? a.scale || 1 : sc, cash = id === 'asuka' ? a.treasury : W.nation.cash;
    let k = D.list[key];
    const year = N.fee * sizeOf(k) * size, years = cash / Math.max(1, year);
    if (k && k.on) {
      k.last = { ...k.m, margin: 0 };
      k.m = { fee: 0, sales: 0, cost: 0 };
      if (years < 1 || pull < 0.5) cancel(W, key, k, day, years < 1 ? '国庫の悪化' : 'キャラクター人気の低下');
      else if (years > 20 && pull >= 1 && r.u() < 0.4) resize(W, key, k, MW.scale.step, day, '国庫に余裕');
      else if (years < 3 && sizeOf(k) > MW.scale.range[0]) resize(W, key, k, 1 / MW.scale.step, day, '国庫の節約');
      continue;
    }
    if (k && k.until !== null && day - k.until < 90) continue;
    if (pull < 0.8 || years < N.months + 2) continue;
    const name = id === 'asuka' ? 'アスカ国' : 'ヴェルノア国';
    if (!k) k = D.list[key] = blank('nation', id, name, N.fee, size, day);
    else k.size = size;
    sign(W, key, k, day, '国の公式キャラクターに');
  }
}
// MY WAY's 交渉係 with each of them, each day (as with the thirteen: CORP.mywayTalk)
function talks(W, day, r, pull) {
  const D = state(W), T = D.talks;
  if (T.day !== day) { T.day = day; T.n = 0; T.deals = 0; }
  for (const [key, k] of Object.entries(D.list)) {
    if (!k.on || !k.last) continue;
    T.n++;
    const share = k.kind === 'nation' ? 0.5 : k.last.margin / Math.max(1, k.last.fee);
    const res = CORP.mywayTalk(k, { share, pull, tie: k.kind === 'nation' ? 60 : 50, range: MW.scale.range, u: [r.u(), r.u(), r.u()] });
    if (res.fee === 1 && res.scale === 1) continue;
    const was = feeOf(k);
    if (res.fee !== 1) k.fee = Math.round(Math.max(k.base * MW.talks.floor, Math.min(k.base * MW.talks.cap, k.fee * res.fee)) / 1e5) * 1e5;
    if (res.scale !== 1) resize(W, key, k, res.scale, day, res.said);
    const now = feeOf(k);
    if (now === was) continue;
    T.deals++; T.all++; T.gained += now - was;
    k.talk = { day, said: res.said, from: was, to: now };
    if (res.fee !== 1) event(W, day, `${k.name}と契約料 ${NPC.money(was)}→${NPC.money(now)}（年）：${res.said}`, key);
  }
}

/* -------------------------------------------------------- what they bring --- */
// what the people buy of the characters at the local companies with a contract (their share of what all the partners
// sell, against `all`: npc-state.js collabOf)
export function collabList(W, all) {
  const D = W.ipDeals, out = [];
  if (!D) return out;
  for (const k of Object.values(D.list)) if (k.on && k.kind === 'local') out.push(['local:' + k.id, null, k.fee * sizeOf(k) * LC.lift / all]);
  return out;
}
// a person buys of the characters at local company `id` (its sale; its goods' cost bought as its costs are)
export function sell(W, i, id, n) {
  const k = W.ipDeals && W.ipDeals.list['local:' + id], c = firmOf(W, id);
  if (!k || !k.on || !c || c.dead || !(n > 0)) return false;
  if (!econ.pay(W, i, n, false)) return false;
  W.sector.cash += n; W.sector.inPeople += n;
  c.cash += n; c.m.sales += n;
  c.m.by.myway = (c.m.by.myway || 0) + n;
  (c.m.what || (c.m.what = {})).myway = 'MY WAYコラボ商品';
  k.m.sales += n;
  const cost = Math.round(n * LC.cost);
  local.spendOf(W, id, cost);
  k.m.cost += cost;
  return true;
}
// how much more the people love the characters with ヴェルノア's contract on; the trips to アスカ・リゾート with アスカ国's
export function pullLift(W) {
  const k = W.ipDeals && W.ipDeals.list['nation:vernoa'];
  return k && k.on ? 1 + NA.vernoa.pull * sizeOf(k) : 1;
}
export function tripLift(W) {
  const k = W.ipDeals && W.ipDeals.list['nation:asuka'];
  return k && k.on ? 1 + NA.asuka.trips * sizeOf(k) : 1;
}

/* --------------------------------------------------------------- the view --- */
// For 運営's MY WAY: every contract beyond the thirteen, its fee and size, last month's, the last talk; the talks' tally
export function view(W) {
  const D = W.ipDeals;
  if (!D) return null;
  const list = Object.entries(D.list).map(([key, k]) => ({ key, kind: k.kind, id: k.id, name: k.name, on: k.on, fee: feeOf(k), base: Math.round(k.base * (k.size || 1)), scale: sizeOf(k), from: k.from, until: k.until, last: k.last, m: k.m, talk: k.talk }));
  const on = list.filter((k) => k.on);
  return { list, on: on.length, locals: on.filter((k) => k.kind === 'local').length, nations: on.filter((k) => k.kind === 'nation').map((k) => k.id), fees: on.reduce((a, k) => a + k.fee, 0), talks: D.talks, events: D.events.slice(-20) };
}
