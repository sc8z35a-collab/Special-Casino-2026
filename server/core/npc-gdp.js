// 国内総生産 (GDP) of each country, a day at a time, by what was spent on what it made (支出面):
//   GDP = 民間最終消費支出 (C) + 政府最終消費支出 (G) + 総固定資本形成 (I) + 輸出 (X) − 輸入 (M)
// ヴェルノア:
// - C: what its people paid for what they bought (with the consumption tax; their contributions and their bets are no
//   purchase — the casino's part is what their bets lost and its fees: server/core/npc-econ.js pay, casinoSession), and
//   what the players spent at the companies
// - G: the state's own work (its civil servants' pay), the medical care it pays for, the districts' purchases
// - I: the thirteen's equipment (their アスカ国 branches' buildings are アスカ's) and the games they made (their
//   content, before it is written off), the local companies' investment, the public works (the state's, the districts')
// - X: what the world outside bought (アスカ国's state enterprise's machines among it), the goods アスカ国's branches
//   bought of its makers and local businesses, the games and services sold there straight from home
// - M: what it paid アスカ国 and the world outside (アルタス's raw materials, アスカ・デジタル's fees: but not the raw
//   materials the branches there bought — theirs is アスカ's own trade), its people's trips there
// アスカ国 alike (server/core/asuka.js gdpOf), its imports what ヴェルノア sold it. 実質: at the prices of the country's
// beginning (its price index: server/core/npc-model.js stats, server/core/asuka.js policy). Kept two years and more;
// the day, the month and the year read from it (gdpView: 運営's 街 and アスカ国).
import { CORP } from './rules.js';
import * as asuka from './asuka.js';

const YEAR = 365, KEEP = 400, MONTHS = 60;
const PARTS = ['c', 'g', 'i', 'x', 'm'];
// (kept small, with the country: a day [c, g, i, x, m, the price index ×10000, people]; a month the sums of
// [c, g, i, x, m, real, days])
const pack = (o) => [o.c, o.g, o.i, o.x, o.m, Math.round(o.defl * 10000), o.people];
const unpack = (a) => { const o = { c: a[0], g: a[1], i: a[2], x: a[3], m: a[4], defl: a[5] / 10000, people: a[6] }; o.nominal = o.c + o.g + o.i + o.x - o.m; o.real = Math.round(o.nominal / Math.max(0.01, o.defl)); return o; };

// the day `day` closed (`corp`: the companies' world, their day's books; `x`: what crossed as it closed — its
// exports, its trade with アスカ国's branches —: server/core/corp-model.js closeDay `out.ext`)
export function gdpDay(W, day, corp, x) {
  const G = W.gdp || (W.gdp = { days: [], k: {}, owed: null });
  if (G.days.length && G.days[G.days.length - 1].day >= day) return null;
  const acc = W.gdpAcc || { c: 0, inv: 0, m: 0, trips: 0 };
  W.gdpAcc = { c: 0, inv: 0, m: 0, trips: 0 };
  // (what the companies owe アルタス and アスカ・デジタル: bought now, paid within weeks — the imports are what was
  // bought, the paying of what was owed is no import)
  let owed = 0;
  if (corp) for (const s of Object.values(corp.co)) owed += ((s.owe && s.owe['*']) || 0) + ((s.owe && s.owe['@digital']) || 0);
  const first = G.owed === null || G.owed === undefined, dOwed = first ? 0 : owed - G.owed;
  G.owed = owed;
  const nd = (W.nation.day && W.nation.day.out) || {}, dd = (k) => W.districts.reduce((n, d) => n + ((d.day && d.day.out && d.day.out[k]) || 0), 0);
  const xa = (x && x.asuka) || {}, tr = xa.trade || { goods: 0, direct: 0, altas: 0 };
  let players = 0, capex = 0, content = 0;
  if (corp) for (const s of Object.values(corp.co)) {
    if (!s.per) continue;
    const d = s.per.d || {};
    players += s.players || 0;
    capex += -(d['cf:capex'] || 0);
    // (the games made: their content grown, and what of it was written off or given up today)
    const k = (s.bal.wip || 0) + (s.bal.content || 0), was = G.k[s.id];
    if (was !== undefined) content += k - was + (d['c:amort'] || 0) + (d.xImpair || 0) + (d.xCancel || 0);
    G.k[s.id] = k;
  }
  // (the first day only begins the count: what was owed and made before it is not this day's)
  if (first) { asuka.gdpOf(W); return null; }
  const v = {
    c: Math.round(acc.c + players),
    g: Math.round((nd.civil || 0) + (nd.medical || 0) + dd('shops')),
    i: Math.round(Math.max(0, capex - Math.max(0, xa.open || 0)) + Math.max(0, content) + acc.inv + (nd.works || 0) + dd('works')),
    x: Math.round(((x && x.exports) || 0) + tr.goods + tr.direct),
    m: Math.round(acc.m + dOwed + acc.trips + (xa.platform || 0) - tr.altas),
    defl: W.stats && W.stats.prices0 ? W.stats.prices / W.stats.prices0 : 1, people: W.P.n
  };
  const a = asuka.gdpOf(W);
  const row = { day, v: pack(round(v)), a: a ? pack(round({ ...a, x: a.x + dOwed - tr.altas, m: a.m + tr.goods + tr.direct })) : null };
  G.days.push(row);
  if (G.days.length > KEEP) G.days.splice(0, G.days.length - KEEP);
  // (and its month's sums, kept five years)
  const t = CORP.ymd(day), mk = `${t.y}-${String(t.m).padStart(2, '0')}`, M = G.months || (G.months = {});
  const mo = M[mk] || (M[mk] = {});
  for (const c of ['v', 'a']) {
    if (!row[c]) continue;
    const o = unpack(row[c]), s0 = mo[c] || (mo[c] = [0, 0, 0, 0, 0, 0, 0]);
    PARTS.forEach((k, n) => { s0[n] += o[k]; });
    s0[5] += o.real; s0[6] += 1;
  }
  const keys = Object.keys(M).sort();
  while (keys.length > MONTHS) delete M[keys.shift()];
  return { day, v: unpack(row.v), a: row.a ? unpack(row.a) : null };
}
const round = (o) => { for (const k of PARTS) o[k] = Math.round(o[k] || 0); return o; };

// What 運営 sees of it: for each country the last day closed, this month so far and the one before, this year so far
// (暦年) and the one before, the last 365 days, the last 12 whole months against the 12 before (前年比), the last 30
// days at a year's pace (against the 30 before), a head, and its last 90 days.
export function gdpView(W) {
  const G = W.gdp;
  if (!G || !G.days.length) return null;
  const days = G.days, last = days[days.length - 1], t = CORP.ymd(last.day), M = G.months || {};
  const mkOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
  const of = (c) => {
    const rows = days.filter((r) => r[c]).map((r) => ({ day: r.day, o: unpack(r[c]) }));
    if (!rows.length) return null;
    const sum = (list) => {
      const o = { nominal: 0, real: 0, c: 0, g: 0, i: 0, x: 0, m: 0, days: list.length };
      for (const r of list) for (const k of ['nominal', 'real', ...PARTS]) o[k] += r.o[k];
      return o;
    };
    // (a month's sums, from what was kept of it)
    const month = (key) => { const s0 = M[key] && M[key][c]; if (!s0) return null; const o = { c: s0[0], g: s0[1], i: s0[2], x: s0[3], m: s0[4], real: s0[5], days: s0[6], key }; o.nominal = o.c + o.g + o.i + o.x - o.m; return o; };
    const months = (list) => { const o = { nominal: 0, real: 0, c: 0, g: 0, i: 0, x: 0, m: 0, days: 0 }; let any = false; for (const k of list) { const x = month(k); if (!x) continue; any = true; for (const f of Object.keys(o)) o[f] += x[f]; } return any ? o : null; };
    const pm = t.m === 1 ? { y: t.y - 1, m: 12 } : { y: t.y, m: t.m - 1 };
    const yearKeys = (y) => Array.from({ length: 12 }, (_, k) => mkOf(y, k + 1));
    // (the 12 whole months before this one, and the 12 before those)
    const back = (k) => { let y = t.y, m = t.m - k; while (m < 1) { m += 12; y--; } return mkOf(y, m); };
    const last12 = months(Array.from({ length: 12 }, (_, k) => back(k + 1))), prev12 = months(Array.from({ length: 12 }, (_, k) => back(k + 13)));
    // (a day's or a period's real GDP against another's, a day of each: the months and years are not all as long)
    const rate = (a, b) => (a && b && b.days && b.real > 0 ? (a.real / a.days) / (b.real / b.days) - 1 : null);
    const d30 = rows.slice(-30), p30 = rows.length > 30 ? rows.slice(-60, -30) : [];
    const now = rows[rows.length - 1], before = rows[rows.length - 2];
    const pace = sum(d30), y = sum(rows.slice(-365));
    return {
      day: { ...now.o, day: now.day, growth: before && before.o.real > 0 ? now.o.real / before.o.real - 1 : null },
      month: month(mkOf(t.y, t.m)), prevMonth: month(mkOf(pm.y, pm.m)),
      year: { ...months(yearKeys(t.y)), y: t.y }, lastYear: (() => { const o = months(yearKeys(t.y - 1)); return o ? { ...o, y: t.y - 1 } : null; })(),
      last365: y, yoy: last12 && prev12 && last12.days >= 330 && prev12.days >= 330 ? rate(last12, prev12) : null,
      pace: { nominal: Math.round(pace.nominal / pace.days * YEAR), real: Math.round(pace.real / pace.days * YEAR), growth: p30.length ? rate(pace, sum(p30)) : null },
      head: now.o.people ? Math.round(y.nominal / y.days * YEAR / now.o.people) : 0,
      defl: now.o.defl, people: now.o.people,
      series: rows.slice(-90).map((r) => [r.day, r.o.nominal, r.o.real])
    };
  };
  return { day: last.day, vernoa: of('v'), asuka: of('a') };
}
