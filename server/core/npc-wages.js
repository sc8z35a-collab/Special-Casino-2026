// 賃金相場 and the companies' fight for people. The pay the market expects (`W.wage.idx`: 1 at the start, how many times
// the pay of then it is now) moves each month towards what the country's wealth can carry — its people's money a head
// against `years` of pay (a people holding forty years of their pay is paid far too little: the pay of a country as rich
// as its money says) —, a step of it at a time. Each employer reviews its people's pay against it on the month's first
// day: the thirteen (the more when they are short of people or lost some to others, only as far as their money lets
// them), the 32 local companies and the small shops, the country's civil servants, アスカ国's state, its trade and the
// branches. Every day a company short of people makes offers to other companies' people (引き抜き): at a premium over
// what they are paid, taken by those it tempts the more the less they are paid against the market, the less loyal and
// the less happy; their employer may hold one it values with a counter-offer. New hires everywhere at the market's pay.
import { NPC, CORP, LOCAL, ASUKA } from './rules.js';
import { FL, T, NT } from './npc-pop.js';
import { JOB as AJOB } from './asuka.js';
import { equityOf as localEquity } from './npc-local.js';

export const WAGE = {
  // its people's money a head this many years of the pay (the market's aim), how far towards it a month (a step of at
  // most `up` a month up, `down` down)
  years: 10, speed: 0.25, up: 0.1, down: 0.02,
  // a review: `gap` of what it is short of the market, `short` more when it has been short of people for a month,
  // `lost` of the share of its people taken by others last month; `max` a month; `poor`: a company with less than two
  // months of its costs and a loss gives only that share of it
  review: { gap: 0.5, short: 0.04, lost: 3, max: 0.12, poor: 0.25, others: 0.4, civil: 0.3, asuka: 0.4 },
  // 引き抜き: a company short of people `days` days and more asks `tries` a day for each `per` places it has; the
  // premium over the person's pay (and over its own pay, whichever is more); a counter-offer `counter` of the time from
  // an employer with `runway` months of money in hand, a little above the offer
  poach: { days: 3, per: 20, tries: 6, premium: [0.08, 0.3], fit: 0.35, tenure: 6, counter: 0.45, runway: 3, match: 1.02 },
  // a counter-offer or an offer taken, as each is remembered
  keep: 24
};
const P_OF = (W) => W.P;
const localFirm = (no) => (no ? LOCAL.firms.find((f) => f.no === no) : null) || null;
const J = () => NPC.job;
export const idx = (W) => (W.wage && W.wage.idx) || 1;
export const asukaIdx = (W) => (W.wage && W.wage.asuka && W.wage.asuka.idx) || 1;

function stateOf(W) { return W.wage || (W.wage = { idx: 1, since: W.day, base: {}, hist: [], raised: {}, poach: { m: { n: 0, countered: 0, by: {} }, total: 0, countered: 0, last: null }, events: [] }); }
function event(W, day, text) { const S = stateOf(W); S.events.push({ day, text }); if (S.events.length > 40) S.events.shift(); }

/* ---------------------------------------------------------------- the month --- */
// what each group of a country's people is paid on average now (`key` → [sum, n])
function groups(W) {
  const P = P_OF(W), g = {}, add = (k, x) => { const e = g[k] || (g[k] = [0, 0]); e[0] += x; e[1]++; };
  for (let i = 0; i < P.n; i++) {
    const x = P.salary[i];
    if (!(x > 0) || P.flags[i] & FL.research) continue;
    const j = P.job[i], id = NPC.companyOf(j);
    if (id) add('co:' + id, x);
    else if (j === J().civil) add('civil', x);
    else if (j === J().other || j === J().self || j === J().part) add(P.firm[i] ? 'local:' + P.firm[i] : 'shops:' + j, x);
    add('all', x);
  }
  return g;
}
const avgOf = (e) => (e && e[1] ? e[0] / e[1] : 0);
// the people's money a head (their deposits and tokens, less what they owe)
function wealth(W) {
  const P = P_OF(W);
  let x = 0;
  for (let i = 0; i < P.n; i++) x += P.cash[i] + P.tokens[i] - P.debt[i];
  return P.n ? x / P.n : 0;
}
// the month's first day: the market moved, every employer's review
export function month(W, day, r, ctx) {
  const S = stateOf(W), P = P_OF(W), g = groups(W), R = WAGE.review;
  const avg = avgOf(g.all);
  if (!(avg > 0)) return;
  // (the pay of then, each group's: kept the first month, what the market's index multiplies)
  if (!S.base.all) for (const [k, e] of Object.entries(g)) S.base[k] = Math.round(avgOf(e));
  const rich = wealth(W), aim = rich / WAGE.years / Math.max(1, S.base.all);
  const was = S.idx, step = (aim - was) * WAGE.speed;
  S.idx = Math.round(Math.max(was * (1 - WAGE.down), Math.min(was * (1 + WAGE.up), was + step)) * 10000) / 10000;
  S.aim = Math.round(aim * 1000) / 1000;
  S.wealth = Math.round(rich);
  // (who lost people to the others in the month just ended)
  const lost = S.poach.m.lostBy || {};
  const raise = (key, staff, x, why) => {
    if (!(x > 0.0005) || !staff.length) return 0;
    for (const i of staff) P.salary[i] = Math.round(P.salary[i] * (1 + x));
    S.raised[key] = { day, x: Math.round(x * 1000) / 1000, why };
    return x;
  };
  // the thirteen
  const april = CORP.ymd(day).m === 4, fy = CORP.fyOf(day);
  for (const id of NPC.companies) {
    const c = ctx.corp && ctx.corp.co[id], e = g['co:' + id];
    if (!c || c.dead || !e) continue;
    // (April: its year's raise — its union's or its own, npc-labor.js payRaise — is its review of the month)
    if (april && W.lab.raised && W.lab.raised[id] === fy) continue;
    const base = S.base['co:' + id] || avgOf(e), now = avgOf(e), gap = base * S.idx / Math.max(1, now) - 1;
    const short = Math.min(1, ((W.lab.short && W.lab.short[id]) || 0) / 30), gone = (lost[id] || 0) / Math.max(1, e[1]);
    let x = Math.max(0, gap) * R.gap + (gap > -0.05 ? R.short * short + R.lost * gone : 0);
    // (its money: a company with less than two months of its costs that lost money last month gives little)
    const monthly = Math.max(1, (c.n * c.unit + (c.budget.place || 0) + (c.budget.rd || 0) + (c.budget.ads || 0) + (c.budget.other || 0)) / 12);
    const runway = ((c.bal.cash || 0) + (c.bal.bonds || 0)) / monthly, op = CORP.plOf(c.per.m || {}).op;
    if (runway < 2 && op < 0) x *= R.poor;
    // (MY WAY: its people first)
    if (id === 'myway') x *= 1.3;
    x = Math.min(R.max, x);
    if (raise('co:' + id, W.staffOf(id), x, short > 0 ? '人手不足' : gone > 0 ? '引き抜き対策' : '賃金相場') >= 0.02)
      W.news.push({ day, kind: 'labor', district: -1, text: `${CORP.company(id).name}が全社員の給与を${(x * 100).toFixed(1)}%引き上げ（${short > 0 ? '人手不足' : gone > 0 ? '他社への流出を防ぐ' : '賃金相場の上昇'}）`, data: { company: id } });
  }
  // the 32 local companies (as far as their money goes) and the small shops' people
  if (W.locals) for (const f of LOCAL.firms) {
    const c = W.locals.firms[f.id], e = g['local:' + f.no];
    if (!c || c.dead || !e) continue;
    const base = S.base['local:' + f.no] || f.pay, gap = base * S.idx / Math.max(1, avgOf(e)) - 1;
    // (short of people for a month: more, to keep up with the thirteen; as far as its money goes — less, not none,
    // when it is thin)
    const pay = e[0] / 12, short = Math.min(1, ((W.lab.lshort && W.lab.lshort[f.id]) || 0) / 30);
    const afford = c.cash > pay * 2 ? 1 : c.cash > pay * 0.5 ? 0.7 : c.cash > 0 ? 0.4 : 0.15;
    const x = Math.min(R.max, (Math.max(0, gap) * R.gap + (gap > -0.05 ? R.short * short : 0)) * afford);
    const staff = [];
    for (let i = 0; i < P.n; i++) if (P.firm[i] === f.no && P.salary[i] > 0) staff.push(i);
    raise('local:' + f.no, staff, x, '賃金相場');
  }
  for (const j of [J().other, J().self, J().part]) {
    const e = g['shops:' + j];
    if (!e) continue;
    const gap = (S.base['shops:' + j] || avgOf(e)) * S.idx / Math.max(1, avgOf(e)) - 1, x = Math.min(R.max, Math.max(0, gap) * R.others * (W.sector.cash > 0 ? 1 : 0.3));
    const staff = [];
    for (let i = 0; i < P.n; i++) if (P.job[i] === j && !P.firm[i] && P.salary[i] > 0 && !(P.flags[i] & FL.research)) staff.push(i);
    raise('shops:' + j, staff, x, '賃金相場');
  }
  // the civil servants: the country's, behind the market (and not while it is broke)
  {
    const e = g.civil;
    if (e && !W.nation.broke) {
      const gap = (S.base.civil || avgOf(e)) * S.idx / Math.max(1, avgOf(e)) - 1, x = Math.min(R.max, Math.max(0, gap) * R.civil);
      const staff = [];
      for (let i = 0; i < P.n; i++) if (P.job[i] === J().civil && P.salary[i] > 0) staff.push(i);
      if (raise('civil', staff, x, '人事院勧告') >= 0.02) W.news.push({ day, kind: 'nation', district: -1, text: `公務員の給与を${(x * 100).toFixed(1)}%引き上げ（民間の賃金相場に合わせて）`, data: {} });
    }
  }
  asukaMonth(W, day);
  // the month's 引き抜き, told and kept
  const pm = S.poach.m;
  if (pm.n || pm.countered) {
    const top = Object.entries(pm.by).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => { const [a, b] = k.split('>'); return `${CORP.company(b).name}→${CORP.company(a).name} ${n}人`; });
    W.news.push({ day, kind: 'labor', district: -1, text: `先月の引き抜き${pm.n}人・引き止め${pm.countered}人（${top.join('・')}）`, data: {} });
  }
  S.poach.last = { day, n: pm.n, countered: pm.countered, by: pm.by, localHeld: pm.localHeld || 0, localLost: pm.localLost || 0 };
  S.poach.m = { n: 0, countered: 0, by: {}, lostBy: {} };
  const g2 = groups(W);
  S.hist.push({ day, idx: S.idx, aim: S.aim, wealth: S.wealth, avg: Math.round(avgOf(g2.all)), poached: pm.n, countered: pm.countered, asuka: W.wage.asuka ? W.wage.asuka.idx : null });
  if (S.hist.length > 36) S.hist.shift();
  event(W, day, `賃金相場 ×${was.toFixed(3)}→×${S.idx.toFixed(3)}（目標 ×${S.aim.toFixed(2)}・平均年収 ${NPC.money(Math.round(avgOf(g2.all)))}）`);
}
// アスカ国: its own market by its own people's money; its state's, its trade's and the branches' people's pay
function asukaMonth(W, day) {
  const a = W.asuka, A = W.AP, S = stateOf(W);
  if (!a || !A) return;
  const X = S.asuka || (S.asuka = { idx: 1, base: {} }), JOB = AJOB;
  const sum = {}, add = (k, x) => { const e = sum[k] || (sum[k] = [0, 0]); e[0] += x; e[1]++; };
  let cash = 0;
  for (let i = 0; i < A.n; i++) {
    cash += A.cash[i] - A.debt[i];
    const j = A.job[i], x = A.pay[i];
    if (!(x > 0)) continue;
    if (j === JOB.atsuka) add('atsuka', x); else if (j === JOB.trade) add('trade', x); else if (j === JOB.branch) add('branch', x);
    if (j === JOB.atsuka || j === JOB.trade || j === JOB.branch) add('all', x);
  }
  if (!sum.all) return;
  if (!X.base.all) for (const [k, e] of Object.entries(sum)) X.base[k] = Math.round(avgOf(e));
  const aim = cash / Math.max(1, A.n) / WAGE.years / Math.max(1, X.base.all), was = X.idx;
  X.idx = Math.round(Math.max(was * (1 - WAGE.down), Math.min(was * (1 + WAGE.up), was + (aim - was) * WAGE.speed)) * 10000) / 10000;
  X.aim = Math.round(aim * 1000) / 1000;
  for (const [k, job] of [['atsuka', JOB.atsuka], ['trade', JOB.trade], ['branch', JOB.branch]]) {
    const e = sum[k];
    if (!e) continue;
    const x = Math.min(WAGE.review.max, Math.max(0, (X.base[k] || avgOf(e)) * X.idx / avgOf(e) - 1) * WAGE.review.asuka);
    if (!(x > 0.0005)) continue;
    for (let i = 0; i < A.n; i++) if (A.job[i] === job && A.pay[i] > 0) A.pay[i] = Math.round(A.pay[i] * (1 + x));
    X[k] = Math.round(x * 1000) / 1000;
  }
}

/* ---------------------------------------------------------------- 引き抜き --- */
// Each day: a company short of people for days asks other companies' people to come — the fit for the work, at a
// premium; one tempted by it (the more the less they are paid against the market, the less loyal and the less happy
// they are) is held now and then by a counter-offer, else moves (the job site's fee the new company's, as any hire's)
export function poach(W, day, r, ctx, hire) {
  const P = P_OF(W), S = stateOf(W), Q = WAGE.poach, lb = W.lab, short = lb.short || {};
  const opens = (lb.openings || []).filter((o) => o.left > 0 && (short[o.company] || 0) >= Q.days);
  if (!opens.length) return;
  // (the other companies' people who might be asked: in work six months and more, not their executives)
  const pool = [];
  for (let i = 0; i < P.n; i++) {
    const id = NPC.companyOf(P.job[i]);
    if (!id || P.flags[i] & (FL.exec | FL.striking) || P.tenure[i] < Q.tenure || !(P.salary[i] > 0)) continue;
    pool.push(i);
  }
  if (!pool.length) return;
  const m = S.poach.m;
  for (const o of opens) {
    const tries = Math.min(Q.tries, Math.ceil(o.left / Q.per));
    for (let k = 0; k < tries && o.left > 0; k++) {
      const i = pool[r.int(pool.length)], from = NPC.companyOf(P.job[i]);
      if (!from || from === o.company) continue;
      const fit = W.fitFor(P, i, o.company);
      if (fit < Q.fit) continue;
      const offer = Math.round(Math.max(o.pay, P.salary[i]) * (1 + Q.premium[0] + (Q.premium[1] - Q.premium[0]) * fit * r.u()));
      // (tempted: by the rise, by how far below the market they are paid, by being unhappy; held back by loyalty)
      const market = (S.base['co:' + from] || P.salary[i]) * idx(W);
      const will = (offer / P.salary[i] - 1) * 1.5 + Math.max(0, market / P.salary[i] - 1) * 0.5 + (170 - P.jsat[i]) / 255 * 0.4 - P.tr[i * NT + T.loyalty] / 255 * 0.35;
      if (r.u() > Math.max(0, Math.min(0.85, will))) continue;
      // (a counter-offer: an employer with the money keeps one it values, a little above what was offered)
      const fc = ctx.corp && ctx.corp.co[from];
      if (fc && !fc.dead) {
        const monthly = Math.max(1, (fc.n * fc.unit) / 12 + ((fc.budget.place || 0) + (fc.budget.other || 0)) / 12);
        const valued = P.rank[i] > 0 || W.fitFor(P, i, from) > 0.6;
        if (valued && ((fc.bal.cash || 0) + (fc.bal.bonds || 0)) / monthly > Q.runway && r.u() < Q.counter) {
          P.salary[i] = Math.round(offer * Q.match);
          P.jsat[i] = Math.min(255, P.jsat[i] + 20);
          m.countered++; S.poach.countered++;
          continue;
        }
      }
      hire(W, i, { ...o, left: 1 }, day, r);
      P.salary[i] = offer;
      o.left--;
      m.n++; S.poach.total++;
      const key = o.company + '>' + from;
      m.by[key] = (m.by[key] || 0) + 1;
      (m.lostBy || (m.lostBy = {}))[from] = ((m.lostBy || {})[from] || 0) + 1;
    }
  }
}

// One of the thirteen's offers to a local company's person (npc-labor.js shortage, npc-mind.js thinkJob): the company,
// worth `runway` months of its pay and costs (or with them in hand), holds them `counter` of the time a little above it
// (and they are the happier for it); counted with the 引き抜き
export function localHolds(W, i, offer, r) {
  const P = P_OF(W), Q = WAGE.poach, f = localFirm(P.firm[i]), c = f && W.locals && W.locals.firms[f.id];
  if (!c || c.dead) return false;
  const m = stateOf(W).poach.m;
  const last = c.last || c.m || {}, monthly = Math.max(1, (last.cost || 0) + (last.pay || 0), (c.staff || 1) * P.salary[i] / 12);
  if (Math.max(c.cash, localEquity(W, f)) / monthly > Q.runway && r.u() < Q.counter) {
    P.salary[i] = Math.round(Math.max(P.salary[i], offer) * Q.match);
    P.jsat[i] = Math.min(255, P.jsat[i] + 20);
    m.localHeld = (m.localHeld || 0) + 1;
    return true;
  }
  m.localLost = (m.localLost || 0) + 1;
  return false;
}

/* --------------------------------------------------------------- the view --- */
// For 運営's 町: the market, its aim and the wealth it is set by, each employer's pay against it and its last review,
// the 引き抜き of the month and the last, アスカ国's market
export function view(W) {
  const S = W.wage;
  if (!S) return null;
  const g = groups(W), co = {};
  for (const id of NPC.companies) {
    const e = g['co:' + id];
    if (!e) continue;
    const base = S.base['co:' + id] || avgOf(e);
    co[id] = { name: CORP.company(id).name, staff: e[1], avg: Math.round(avgOf(e)), market: Math.round(base * S.idx), raised: S.raised['co:' + id] || null };
  }
  const civil = g.civil ? { avg: Math.round(avgOf(g.civil)), market: Math.round((S.base.civil || 0) * S.idx), raised: S.raised.civil || null } : null;
  return { idx: S.idx, aim: S.aim || null, wealth: S.wealth || null, years: WAGE.years, avg: Math.round(avgOf(g.all)), base: S.base.all || null, since: S.since,
    companies: co, civil, poach: { month: S.poach.m, last: S.poach.last, total: S.poach.total, countered: S.poach.countered },
    asuka: S.asuka ? { idx: S.asuka.idx, aim: S.asuka.aim || null, base: S.asuka.base.all || null } : null, hist: S.hist.slice(-24), events: S.events.slice(-20) };
}
// a person's pay at hire where it is set by a rule (a local company's, the small shops', アスカ国's): times the market
export const atMarket = (W, pay) => Math.round(pay * idx(W));
export const atAsukaMarket = (W, pay) => Math.round(pay * asukaIdx(W));
