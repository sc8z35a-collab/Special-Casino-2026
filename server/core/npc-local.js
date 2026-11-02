// 地元の企業 (js/game/local.js): the 32 local companies of the country, a part of its local trade (W.sector) with books
// of their own. The money is the local trade's still (W.sector.cash holds theirs too: each company's `cash` is its part
// of it, the rest the countless small shops'), so nothing is made or lost by them: what the thirteen and the people
// paid the local trade today (W.sector.today, by who paid it and for what) is in part their sales — each takes of a kind
// of spending what its plan expects of it, against that spending's usual day (so a parent's good month is theirs too,
// its bad one theirs) —; their costs go to the utilities, to the others they buy from, abroad (their materials) and the
// rest to the small shops; their people (P.firm) are paid by them on the 25th (server/core/npc-state.js sectorDay),
// their month's profit taxed (the country's), a part of a month beyond the plan their people's (決算賞与), the rest kept.
import { NPC, CORP, LOCAL } from './rules.js';
import * as econ from './npc-econ.js';

const YEAR = 365;
const J = NPC.job;
const BYNO = new Map(LOCAL.firms.map((f) => [f.no, f]));
export const firmByNo = (no) => BYNO.get(no) || null;
// the local company person `i` works for (its number; 0: none, the small shops)
export function firmOf(P, i) {
  const j = P.job[i];
  return j === J.other || j === J.part ? P.firm[i] : 0;
}
const districtOf = (f) => Math.max(0, NPC.districts.findIndex((d) => d.name === f.hq));
// how big the companies are in this country (a smaller one's are that much smaller)
const scaleOf = (W) => W.P.n / NPC.nation.population;
// its capital in a country of this size (its retained earnings begin so too: a smaller country, smaller companies)
const capitalOf = (W, f) => Math.round(f.capital * scaleOf(W));

/* ---------------------------------------------------------------- the beginning --- */
// Once (a country kept before them too): their books, and the people in the local jobs taken on by them, the
// eldest of each its 社長 and CEO; the rest of their people they hire (server/core/npc-labor.js localJobs).
export function init(W, day) {
  const P = W.P, sc = scaleOf(W);
  W.locals = { firms: {}, ema: {}, since: day };
  for (const f of LOCAL.firms) {
    W.locals.firms[f.id] = { cash: 0, retained: Math.round(f.retained * sc), target: Math.max(1, Math.round(f.staff * sc)), staff: 0,
      m: blankMonth(day), last: null, year: { sales: 0, op: 0, net: 0, tax: 0, bonus: 0 }, by: {} };
  }
  const pool = [];
  for (let i = 0; i < P.n; i++) if (P.job[i] === J.other || P.job[i] === J.part) { P.firm[i] = 0; pool.push(i); }
  pool.sort((a, b) => P.birth[a] - P.birth[b]);
  const left = Object.fromEntries(LOCAL.firms.map((f) => [f.id, W.locals.firms[f.id].target]));
  const head = {};
  for (const i of pool) {
    // (the one most short of people takes the next)
    let best = null, gap = 0;
    for (const f of LOCAL.firms) { const g = left[f.id] / W.locals.firms[f.id].target; if (left[f.id] > 0 && g > gap) { gap = g; best = f; } }
    if (!best) break;
    left[best.id]--;
    const k = head[best.id] = (head[best.id] || 0) + 1;
    join(W, i, best, k <= 2 ? best.ceo[k - 1] : 0, () => ((i * 2654435761) >>> 0) % 1000 / 1000);
  }
  count(W);
}
function blankMonth(day) { return { key: CORP.monthKey(day), sales: 0, cost: 0, pay: 0, by: {} }; }
// person `i` works for `f` from now (at `salary`, or its pay give or take 15%)
export function join(W, i, f, salary, rand) {
  const P = W.P;
  P.firm[i] = f.no;
  P.salary[i] = Math.round(salary || f.pay * (0.85 + 0.3 * rand()));
  P.wdist[i] = districtOf(f);
}
// each company's people now
export function count(W) {
  const P = W.P, n = {};
  for (let i = 0; i < P.n; i++) { const no = firmOf(P, i); if (no) n[no] = (n[no] || 0) + 1; }
  for (const f of LOCAL.firms) W.locals.firms[f.id].staff = n[f.no] || 0;
}
// the companies short of people: [firm, how many]
export function openings(W) {
  return LOCAL.firms.filter((f) => !W.locals.firms[f.id].dead).map((f) => [f, W.locals.firms[f.id].target - W.locals.firms[f.id].staff]).filter((x) => x[1] > 0);
}
// a company's businesses: its own and those it took over from others that failed ([the firm whose it was])
const businesses = (c, f) => [f, ...(c.extra || []).map((id) => LOCAL.firm(id)).filter(Boolean)];

/* ---------------------------------------------------------------- the day --- */
// what each wants of each kind of spending a day by its plan: [firm, source, $ a day, its label]; a link to any
// company's cost of a kind ('co:*:place') shared out over each company's by how much each spends (so a company's cost
// is never taken twice over: MAGITA's 施設費 the steel maker's, the haulier's and the power company's together)
function wants(W) {
  const sc = scaleOf(W), L = W.locals, out = [];
  const avg = (k) => (L.ew > 0 ? (L.ema[k] || 0) / L.ew : 0);
  for (const f of LOCAL.firms) for (const b of L.firms[f.id].dead ? [] : businesses(L.firms[f.id], f)) for (const [src, part, label] of b.from) {
    const w = b.sales * part * sc / YEAR, m = /^co:\*:(\w+)$/.exec(src);
    if (!m) { out.push([f, src, w, label]); continue; }
    const keys = Object.keys(L.ema).filter((k) => k.startsWith('co:') && k.endsWith(':' + m[1]) && !k.startsWith('co:*:'));
    const total = keys.reduce((n, k) => n + avg(k), 0);
    for (const k of keys) if (total > 0 && avg(k) > 0) out.push([f, k, w * avg(k) / total, label]);
  }
  return out;
}
export function day(W, day) {
  if (!W.locals) init(W, day);
  const L = W.locals, today = W.sector.today || {};
  W.sector.today = {};
  // (a kind's usual day: over every day since the companies began, the days nothing came too — the thirteen pay theirs
  // at the month's end —, its early days made good: what was seen against the days there were, not a year not yet seen)
  const k1 = (YEAR - 1) / YEAR;
  L.ew = (L.ew || 0) * k1 + 1 / YEAR;
  for (const k of new Set([...Object.keys(L.ema), ...Object.keys(today)])) {
    if (k.startsWith('co:*:')) { delete L.ema[k]; continue; }
    const e = Array.isArray(L.ema[k]) ? L.ema[k][0] : (L.ema[k] || 0);
    L.ema[k] = e * k1 + (today[k] || 0) / YEAR;
  }
  // their sales: each its plan's part of a kind's day against that kind's usual day — all of them together never more
  // than 90% of it (the small shops have their part)
  const want = wants(W), sum = {};
  for (const [, src, w] of want) sum[src] = (sum[src] || 0) + w;
  const got = {};
  for (const [f, src, w, label] of want) {
    const avg = L.ew > 0 ? (L.ema[src] || 0) / L.ew : 0;
    if (!(avg > 0)) continue;
    const n = Math.round((today[src] || 0) * w * Math.min(0.9, sum[src] / avg) / sum[src]);
    const g = got[f.id] || (got[f.id] = { got: 0, plan: 0 });
    g.plan += w;
    if (n <= 0) continue;
    g.got += n;
    const c = L.firms[f.id];
    c.m.by[src] = (c.m.by[src] || 0) + n;
    (c.m.what || (c.m.what = {}))[src] = label;
  }
  for (const f of LOCAL.firms) {
    const c = L.firms[f.id], g = got[f.id] || { got: 0, plan: f.sales * scaleOf(W) / YEAR };
    if (c.dead) { c.today = { got: 0, plan: 0 }; continue; }
    c.cash += g.got;
    c.m.sales += g.got;
    c.m.days = (c.m.days || 0) + 1;
    c.today = g;
  }
  // their costs beyond their people: three tenths fixed, the rest with what they sold (the month's money from the
  // thirteen comes in a day: its costs with it)
  const sc = scaleOf(W);
  for (const f of LOCAL.firms) {
    const c = L.firms[f.id];
    if (c.dead) continue;
    const other = businesses(c, f).reduce((a, b) => a + Math.max(0, b.sales - b.op - b.staff * b.unit), 0) * sc / YEAR;
    const n = Math.round(other * 0.3 + 0.7 * other * (c.today.plan > 0 ? c.today.got / c.today.plan : 1));
    if (n <= 0) continue;
    spend(W, f, c, n);
  }
  if (CORP.isMonthEnd(day)) count(W);
  // the failed ones' procedures
  for (const f of LOCAL.firms) { const c = L.firms[f.id]; if (c.bk) bkDay(W, f, c, day); }
}
function spend(W, f, c, n) {
  const L = W.locals, U = LOCAL.utilities;
  c.cash -= n;
  c.m.cost += n;
  const pay = (id, x) => {
    const t = L.firms[id];
    if (!t || x <= 0 || id === f.id) return 0;
    t.cash += x; t.m.sales += x; t.m.by['local:' + f.id] = (t.m.by['local:' + f.id] || 0) + x;
    return x;
  };
  for (const [id, share] of U.to) pay(id, Math.round(n * U.share * share));
  for (const [id, share] of f.costs.to || []) pay(id, Math.round(n * share));
  // (bought abroad: money leaving the country; the rest the small shops', still in the local trade)
  const out = Math.round(n * (f.costs.imports || 0));
  if (out > 0) { W.sector.cash -= out; econ.toAbroad(W, out); }
}

/* ---------------------------------------------------------------- the month --- */
// At a month's end: the profit, its taxes (the country's), its people's bonus for a month beyond the plan (`bonus`:
// how one is paid, server/core/npc-state.js), an overdrawn one's interest to its bank; the year's sums.
export function month(W, day, bonus) {
  const L = W.locals, R = LOCAL.rules, sc = scaleOf(W), P = W.P;
  const staff = {};
  for (let i = 0; i < P.n; i++) { const no = firmOf(P, i); if (no) (staff[no] || (staff[no] = [])).push(i); }
  for (const f of LOCAL.firms) {
    const c = L.firms[f.id], m = c.m;
    if (c.dead) { c.m = blankMonth(day + 1); continue; }
    // (overdrawn: its bank's loan, at its rate — the local bank still standing, else Tenesice)
    if (c.cash < 0) {
      const int = Math.round(-c.cash * R.overdraft / 12), bank = bankOf(W, f.id);
      c.cash -= int; m.cost += int;
      if (bank) { bank.cash += int; bank.m.sales += int; bank.m.by['local:interest'] = (bank.m.by['local:interest'] || 0) + int; }
      else { W.sector.cash -= int; econ.toBank(W, day, 'nii', int); }
    }
    // (what it owes Tenesice for a business it bought: the month's interest and its part of the loan)
    for (const l of c.loans || []) {
      const int = Math.round(l.left * l.rate / 12), back = Math.min(l.left, l.month);
      c.cash -= int + back; W.sector.cash -= int + back; m.cost += int;
      econ.toBank(W, day, 'nii', int);
      l.left -= back; c.debt = Math.max(0, (c.debt || 0) - back);
    }
    if (c.loans) c.loans = c.loans.filter((l) => l.left > 0);
    const op = m.sales - m.cost - m.pay;
    const tax = Math.max(0, Math.round(op * R.tax));
    if (tax > 0) { c.cash -= tax; W.sector.cash -= tax; econ.nationIn(W, 'corporate', tax); }
    const plan = f.op * sc / 12;
    let paid = 0;
    const people = staff[f.no] || [];
    if (op > plan * 1.1 && people.length) {
      const pool = Math.round((op - plan) * R.bonus), each = Math.floor(pool / people.length);
      if (each > 0) for (const i of people) { bonus(i, each); paid += each; }
      c.cash -= paid; W.sector.cash -= paid;
    }
    const net = op - tax - paid;
    c.retained += net;
    c.last = { key: m.key, sales: m.sales, cost: m.cost, pay: m.pay, op, tax, bonus: paid, net, staff: people.length, by: m.by, what: m.what || {}, plan: Math.round(f.sales * sc / 12), planOp: Math.round(plan), days: m.days || 0 };
    const y = c.year;
    y.sales += m.sales; y.op += op; y.net += net; y.tax += tax; y.bonus += paid;
    if (CORP.ymd(day).m === 3) { c.lastYear = { ...y }; c.year = { sales: 0, op: 0, net: 0, tax: 0, bonus: 0 }; }
    c.m = blankMonth(day + 1);
    // (below water too long, its bank out of patience: 破産)
    const equity = capitalOf(W, f) + c.retained;
    c.under = equity < 0 ? (c.under || 0) + 1 : 0;
    if (c.under >= BKL.months && c.cash < -BKL.overdraft * f.sales * sc / 12) file(W, f, c, day + 1, `債務超過が${c.under}か月続き、取引銀行からの追加融資も受けられず`);
  }
}
/* ---------------------------------------------------------------- 破産 --- */
const BKL = CORP.bankruptcy.local, BK = CORP.bankruptcy;
// the local bank that lends to the others: 第一地域銀行, else セントラル信用金庫 (null: none left, Tenesice's)
function bankOf(W, id) {
  for (const b of [LOCAL.rules.bank, 'central']) { const c = W.locals.firms[b]; if (c && !c.dead && b !== id) return c; }
  return null;
}
const say = (W, day, f, text) => W.news.push({ day, kind: 'labor', district: Math.max(0, NPC.districts.findIndex((d) => d.name === f.hq)), text, data: { local: f.id } });
// 破産申立て: it stops, its people go (the unemployment benefit), its procedure begins; the game's businesses it ran
// are sold again (server/core/corp-model.js)
export function file(W, f, c, day, why) {
  const P = W.P, debt = Math.max(0, -c.cash) + (c.debt || 0);
  let staff = 0;
  for (let i = 0; i < P.n; i++) if (firmOf(P, i) === f.no) { W.labor.leave(W, i, day, 'fired'); staff++; }
  W._staff = null;
  c.dead = { day, why, debt, staff };
  c.bk = { filed: day, why, debt, staff, open: day + BK.open, distribute: day + BK.distribute, close: day + BK.close, stage: 'filed' };
  c.staff = 0; c.target = 0;
  for (const [fid, by] of Object.entries(W.locals.ops || {})) if (by === f.id) { delete W.locals.ops[fid]; (W.locals.failed || (W.locals.failed = [])).push(f.id); }
  say(W, day, f, `地元の${f.name}が破産を申請（負債総額${CORP.fmt.money(debt)}）：${why}。社員${staff}人が職を失いました`);
}
// its days: the court's decision; its trustee's payout (what the bank lent it lost, Tenesice's too), its business to
// the strongest of its own economy (else of all of them); the end
function bkDay(W, f, c, day) {
  const b = c.bk;
  if (day === b.open) { b.stage = 'opened'; say(W, day, f, `${f.name}の破産手続開始決定。破産管財人が選任されました`); }
  if (day === b.distribute) {
    b.stage = 'distributed';
    // (its overdraft: its bank's loss; what it had left: to those it owed, the small shops)
    const short = Math.max(0, -c.cash), bank = bankOf(W, f.id);
    // (its bank's money it was lent: the bank's loss — none left, the small shops' it came from —; Tenesice's loan for
    // a business: Tenesice's)
    if (short > 0 && bank) { bank.cash -= short; bank.m.cost += short; bank.m.by['local:loss'] = (bank.m.by['local:loss'] || 0) - short; }
    if (c.debt > 0) econ.toBank(W, day, 'credit', c.debt);
    b.loss = { bank: short, tenesice: c.debt || 0 };
    c.cash = 0; c.debt = 0; c.loans = [];
    // (its business: the strongest company of its economy takes it on, and its plan for people with it)
    const alive = LOCAL.firms.filter((x) => !W.locals.firms[x.id].dead);
    const eq = (x) => capitalOf(W, x) + W.locals.firms[x.id].retained;
    const to = alive.filter((x) => x.sphere === f.sphere).sort((a, b2) => eq(b2) - eq(a))[0] || alive.sort((a, b2) => eq(b2) - eq(a))[0];
    if (to && eq(to) > 0) {
      const t = W.locals.firms[to.id];
      t.extra = [...(t.extra || []), f.id, ...(c.extra || [])];
      t.target += Math.round(f.staff * scaleOf(W) * 0.7);
      b.to = to.id;
    }
    say(W, day, f, `${f.name}の破産管財人が配当（取引銀行の損失${CORP.fmt.money(short)}）${b.to ? `。事業は${LOCAL.firm(b.to).name}が引き継ぎます` : ''}`);
  }
  if (day === b.close) { b.stage = 'closed'; say(W, day, f, `${f.name}の破産手続が終結し、会社は消滅しました`); }
}
// the game's businesses the local companies run (server/core/corp-model.js: what came to them today), and one bought
// at a failed company's auction (Tenesice lends all of it, paid at once to that company's trustee)
export function operated(W, e, day) {
  // (the money is the local trade's in any case: its company's part if it is still there)
  // (the players' part of it is counted where it came in: server/core/corp-model.js playersCross)
  W.sector.cash += e.n;
  const c = W.locals && W.locals.firms[e.firm], f = LOCAL.firm(e.firm);
  if (!c || c.dead) return;
  const ft = e.feature ? CORP.feature(e.feature) : null, cost = e.n > 0 && ft ? Math.round(e.n * (1 - ft.margin)) : 0;
  c.cash += e.n - cost;
  c.m.sales += Math.max(0, e.n); c.m.cost += cost + Math.max(0, -e.n);
  const k = 'op:' + (e.feature || 'game');
  c.m.by[k] = (c.m.by[k] || 0) + e.n;
  (c.m.what || (c.m.what = {}))[k] = ft ? `${ft.name}の運営` : 'ゲームの事業の運営';
  void f; void day;
}
export function won(W, e, day) {
  if (!W.locals) return;
  const c = W.locals.firms[e.firm], f = LOCAL.firm(e.firm);
  if (!c || c.dead) return;
  // (Tenesice lends it: money made by the loan, as its loans to the people)
  c.debt = (c.debt || 0) + e.price;
  (c.loans || (c.loans = [])).push({ feature: e.feature, n: e.price, left: e.price, rate: e.rate, month: Math.ceil(e.price / (BK.localYears * 12)) });
  (W.locals.ops || (W.locals.ops = {}))[e.feature] = e.firm;
  if (e.estate) econ.toEstate(W, day, e.estate, e.price);
  else econ.toBank(W, day, 'fees', e.price);
  say(W, day, f, `${f.name}がテネシスから${CORP.fmt.money(e.price)}を借り入れ、${CORP.feature(e.feature).name}の運営権を取得しました`);
}
// as a bidder sees each
export function summary(W) {
  if (!W.locals) return [];
  return LOCAL.firms.map((f) => { const c = W.locals.firms[f.id]; return { id: f.id, name: f.name, sphere: f.sphere, equity: Math.round(capitalOf(W, f) + c.retained), cash: Math.round(c.cash), staff: c.staff, dead: !!c.dead }; });
}
// the money the local companies hold (their part of the local trade's)
export function held(W) {
  if (!W.locals) return 0;
  let n = 0;
  for (const c of Object.values(W.locals.firms)) n += c.cash;
  return n;
}
// For the 街ライブ: each company (its plan for this country, its month, its people, who pays it for what), and what each
// of the thirteen paid them last month.
export function view(W) {
  if (!W.locals) return null;
  const sc = scaleOf(W), K = LOCAL.kinds, out = [], paidBy = {};
  const label = (f, src, what) => { if (what && what[src]) return what[src]; const l = f.from.find((x) => x[0] === src); return l ? l[2] : src.startsWith('local:') ? (src === 'local:interest' ? '地元企業への融資の利息' : (LOCAL.firm(src.slice(6)) || {}).name || src) : src; };
  for (const f of LOCAL.firms) {
    const c = W.locals.firms[f.id], m = c.last || c.m;
    const by = Object.entries(m.by || {}).sort((a, b) => b[1] - a[1]).map(([src, n]) => ({ src, n, label: label(f, src, m.what) }));
    out.push({ no: f.no, id: f.id, name: f.name, sphere: f.sphere, role: f.role, hq: f.hq, staff: c.staff, target: c.target, pay: f.pay, ceo: f.ceo,
      plan: { sales: Math.round(f.sales * sc), op: Math.round(f.op * sc) }, capital: capitalOf(W, f), retained: Math.round(c.retained), cash: Math.round(c.cash),
      month: { key: m.key, sales: m.sales, op: c.last ? c.last.op : m.sales - m.cost - m.pay, bonus: c.last ? c.last.bonus : 0 }, year: c.lastYear || null, by: by.slice(0, 6) });
    for (const x of by) {
      const k = /^co:([^:*]+):(\w+)$/.exec(x.src);
      if (!k) continue;
      (paidBy[k[1]] || (paidBy[k[1]] = [])).push({ firm: f.name, n: x.n, what: x.label || K[k[2]] });
    }
  }
  for (const k of Object.keys(paidBy)) paidBy[k].sort((a, b) => b.n - a.n);
  return { spheres: LOCAL.spheres, firms: out, paidBy };
}

// The operator site's 地方企業: every company's spec (js/game/local.js, for the full country and for this one), its
// month so far and the last, what it sold a day of late (its page counts the day on by it), its people, its loans,
// the game's businesses it runs, the businesses it took over, and a failed one's procedure.
// a company's sales a day of late (the thirteen pay what they owe it at the month's end, so not the last day's but the
// last month's, or this month's so far, by its days)
function pace(c) {
  if (c.dead) return 0;
  if (c.last && c.last.days > 0) return Math.round(c.last.sales / c.last.days);
  return c.m.days > 0 ? Math.round(c.m.sales / c.m.days) : 0;
}
export function detail(W) {
  if (!W.locals) return null;
  const v = view(W), sc = scaleOf(W);
  const ops = {};
  for (const [fid, id] of Object.entries(W.locals.ops || {})) (ops[id] || (ops[id] = [])).push({ id: fid, name: (CORP.feature(fid) || {}).name || fid });
  return { scale: sc, spheres: LOCAL.spheres, utilities: LOCAL.utilities, rules: LOCAL.rules,
    firms: LOCAL.firms.map((f, k) => {
      const c = W.locals.firms[f.id];
      return { ...v.firms[k], spec: { staff: f.staff, pay: f.pay, unit: f.unit, ceo: f.ceo, sales: f.sales, op: f.op, capital: f.capital, retained: f.retained, from: f.from, costs: f.costs },
        m: { key: c.m.key, sales: c.m.sales, cost: c.m.cost, pay: c.m.pay, days: c.m.days || 0 }, last: c.last || null, day: c.today || null, pace: pace(c), debt: c.debt || 0, loans: c.loans || [],
        runs: ops[f.id] || [], extra: (c.extra || []).map((id) => LOCAL.firm(id).name), dead: c.dead || null, bk: c.bk || null, under: c.under || 0 };
    }) };
}
