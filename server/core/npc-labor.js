// Work (server/core/npc-model.js): each company's openings (what it wants, server/core/corp-model.js's target, less
// whom it has), put out through the two job sites (the hiring company pays the site its placement fee); leaving (more
// when unhappy, many at once when the mood is bad and the openings elsewhere good: 大量退職); 60 (定年: a severance,
// most kept on to 65 at 60% of their pay) and 65; the new graduates in April. And the unions: their members, their
// rep, the spring wage talks (春闘) in February and March, and a strike when the talks fail.
import { NPC, CORP, LOCAL as BR_LOCAL } from './rules.js';
import { T, S, FL, E, NT, ageOf, remember, clampB, OTHER_PAY } from './npc-pop.js';
import { M, skillFor } from './npc-life.js';
import * as local from './npc-local.js';
import * as econ from './npc-econ.js';
import { boomOf } from './npc-macro.js';
import * as wages from './npc-wages.js';

const tr = (P, i, k) => P.tr[i * NT + k] / 255;
const RATES = { tenesice: 0.35, magita: 0.75, carowner: 0.4, jinx: 0.45, daizin: 0.2, citywork: 0.15, speedeed: 0.05, dtrade: 0.1, riru: 0.25, ice: 0.3, yosida: 0.6, wazima: 0.65 };
export { RATES };

export function createLabor(W) {
  const lb = W.lab || (W.lab = { openings: [], unions: {}, talks: null, hires: {}, quits: {}, log: [] });
  for (const id of NPC.companies) if (!lb.unions[id]) lb.unions[id] = { members: 0, rep: -1, strength: 0.5, state: 'idle', demand: 0, offer: 0, raise: 0, strike: 0, days: 0 };
  const api = {
    get openings() { return lb.openings; },
    state: lb,
    // a person joins company `o.company` (from a job site)
    hire(W, i, o, day, r) { hire(W, i, o, day, r); },
    leave(W, i, day, why) { leave(W, i, day, why); },
    retire(W, i, day, r) { retire(W, i, day, r); },
    // the people a company took at once as it came to the country: in its union by its rate
    join(W, id, list, r) { const u = lb.unions[id]; for (const i of list) if (RATES[id] && r.u() < RATES[id]) { W.P.flags[i] |= FL.union; u.members++; } },
    day(W, day, r, ctx) { laborDay(W, day, r, ctx); },
    first(W) { unionsAtStart(W); }
  };
  return api;
}

/* ---------------------------------------------------------------- openings --- */
// the openings of the day: each company's target (its plan, server/core/corp-model.js) less its people, at its pay
function openings(W, ctx) {
  const lb = W.lab, out = [];
  for (const id of NPC.companies) {
    const c = ctx.corp && ctx.corp.co[id];
    if (!c) continue;
    const have = W.staffOf(id).length, want = Math.round(c.target || c.n);
    const left = Math.max(0, want - have);
    if (left > 0) out.push({ company: id, left, pay: c.pay, site: siteFor(W, id) });
  }
  lb.openings = out;
}
// A company that decided to let people go (server/core/corp-model.js staffing: `cut` on its day): the least settled
// of its people first (the newest, the least happy at work; never its executives), each paid its severance
// (退職金) by the company, then out of work with the unemployment benefit.
function dismiss(W, day, ctx) {
  const lb = W.lab, P = W.P;
  lb.cutDone = lb.cutDone || {};
  for (const id of NPC.companies) {
    const c = ctx.corp && ctx.corp.co[id];
    if (!c || !c.cut || c.cut.day > day || lb.cutDone[id] === c.cut.day) continue;
    lb.cutDone[id] = c.cut.day;
    const staff = W.staffOf(id).filter((i) => !(P.flags[i] & FL.exec));
    staff.sort((a, b) => (P.tenure[a] - P.tenure[b]) || (P.jsat[a] - P.jsat[b]) || (a - b));
    const n = Math.min(c.cut.n, Math.max(0, staff.length - 1));
    for (let k = 0; k < n; k++) {
      const i = staff[k];
      W.charge(id, null, 'severance', c.cut.each, i);
      leave(W, i, day, 'fired');
    }
    W._staff = null;
    if (n) W.news.push({ day, kind: 'labor', district: -1, text: `${CORP.company(id).name}が業績不振で社員${n}人を削減（退職金を支給）`, data: { company: id } });
  }
}
// which of the two sites a company's opening goes through: by their shares of the market (シティーワークが1位、スピーディードが追う)
function siteFor(W, id) { return (W.lab.siteTurn = (W.lab.siteTurn || 0) + 1) % 100 < 100 * (W.siteShare || 0.65) ? 'citywork' : 'speedeed'; }

function hire(W, i, o, day, r) {
  const P = W.P;
  if (NPC.isCompanyJob(P.job[i])) leave(W, i, day, 'move');
  P.job[i] = NPC.jobOf(o.company);
  // (a researcher of テネシスリサーチ moving to a company: its no longer)
  P.flags[i] &= ~(FL.student | FL.research);
  P.rank[i] = 0;
  P.dept[i] = W.org.deptFor(o.company, r);
  P.salary[i] = Math.round(o.pay * (0.78 + 0.1 * r.u()));
  P.tenure[i] = 0;
  P.jsat[i] = 170;
  P.jobless[i] = 0;
  const site = NPC.sites[o.company];
  P.wdist[i] = site[r.weighted(site.map((s) => s[1]))][0];
  P.shift[i] = r.int(2);
  o.left--;
  // the site's placement fee (初年度年収の30%), the hiring company's
  W.charge(o.company, o.site, 'placement', Math.round(P.salary[i] * 0.3 * econ.feeOf(W, 'jobFee', 0.25) / 0.25));
  if (RATES[o.company] && r.u() < RATES[o.company]) { P.flags[i] |= FL.union; W.lab.unions[o.company].members++; }
  remember(P, i, day, M.hired, 150);
  W.lab.hires[o.company] = (W.lab.hires[o.company] || 0) + 1;
  W.sum.hired++;
}
// leaving a job (moving on, dismissed, retiring, a death): the company has one fewer; the unemployment benefit for
// those who lost it
function leave(W, i, day, why) {
  const P = W.P, j = P.job[i];
  if (!NPC.working(j)) return;
  const id = NPC.companyOf(j);
  if (id) {
    if (P.flags[i] & FL.union) W.lab.unions[id].members = Math.max(0, W.lab.unions[id].members - 1);
    W.lab.quits[id] = (W.lab.quits[id] || 0) + 1;
    W.org.vacate(W, i, day);
  }
  const months = P.tenure[i];
  if (why === 'quit' || why === 'fired' || why === 'strike') {
    // (the benefit: half to four fifths of the pay, from 90 to 330 days by the years worked and the age)
    const age = ageOf(P, i, day), years = months / 12;
    const days = Math.round(Math.min(NPC.safety.joblessDays[1], NPC.safety.joblessDays[0] + years * 8 + (age > 45 ? 60 : 0)) * (why === 'quit' ? 0.7 : 1));
    P.jobless[i] = days;
    P.joblessPay[i] = Math.round(P.salary[i] / 12 * (P.salary[i] > 6000000 ? NPC.safety.jobless[0] : NPC.safety.jobless[1]));
    remember(P, i, day, why === 'quit' ? M.quit : M.fired, 160);
  }
  P.job[i] = why === 'retire' || why === 'death' ? NPC.job.retired : NPC.job.none;
  P.flags[i] &= ~(FL.union | FL.rehired | FL.striking | FL.exec | FL.research);
  P.salary[i] = 0;
  P.rank[i] = 0;
  P.tenure[i] = 0;
}
// 60: the severance (two months of pay for each year at most), then most are kept on at 60% to 65
function retire(W, i, day, r) {
  const P = W.P, j = P.job[i];
  const id = NPC.companyOf(j);
  const pay = P.salary[i], years = Math.min(38, P.tenure[i] / 12);
  const sev = Math.round(pay / 12 * NPC.retire.severance * years);
  if (id) W.charge(id, null, 'severance', sev, i);
  else if (j === NPC.job.civil) { econ.nationOut(W, 'civil', sev); P.cash[i] += sev; }
  remember(P, i, day, M.retired, 180);
  if (id && r.u() < 0.55 + 0.3 * (1 - P.cash[i] / 200000000)) {
    // kept on: the same company, 60% of the pay, no longer in a post
    W.org.vacate(W, i, day);
    P.flags[i] |= FL.rehired;
    P.rank[i] = 0;
    P.salary[i] = Math.round(pay * 0.6);
    return;
  }
  leave(W, i, day, 'retire');
}

/* ------------------------------------------------------------- the local jobs --- */
// The local businesses' jobs (the shops, restaurants, builders — その他・自営業・パート): they end now and then (a shop
// closing, a contract over: NPC.labor.localEnd a month, the self-employed less, twice as often while the local trade is
// short of money), and those out of work find them as they find the companies' (at NPC.labor.offerDaily a day, the
// local trade wanting more people the more it has). Before, no local job ever ended and the out of work could only
// be hired by the thirteen companies: no one was ever out of work.
function localJobs(W, day, r) {
  const P = W.P, L = NPC.labor, J = NPC.job, shops = W.sector.cash - local.held(W), hard = shops < 0 ? 2 : 1;
  const want = Math.max(0.3, Math.min(1.2, 1 + shops / Math.max(1, (W.cal.nationFloor || 1) * 2)));
  if (!W.locals) local.init(W, day);
  // (each one's people as they are today: some left it since)
  local.count(W);
  // (the 32 local companies short of people, by how short: js/game/local.js)
  const open = local.openings(W), gaps = open.reduce((n, x) => n + x[1], 0);
  const pick = () => { let k = r.u() * gaps; for (const [f, g] of open) { k -= g; if (k < 0) return f; } return open.length ? open[open.length - 1][0] : null; };
  const taken = (f) => { const x = open.find((y) => y[0] === f); if (x) x[1]--; W.locals.firms[f.id].staff++; };
  for (let i = 0; i < P.n; i++) {
    const j = P.job[i];
    if (j === J.other || j === J.part || j === J.self) {
      // (テネシスリサーチ's researchers: not the small shops' to let go)
      if (P.flags[i] & FL.research) continue;
      const age = ageOf(P, i, day);
      // (the old who worked on part time: at 75 for good)
      if (age >= 75 && local.firmOf(P, i)) { leave(W, i, day, 'retire'); continue; }
      const end = (j === J.self ? L.localEnd * L.selfShare : L.localEnd) * hard / 30;
      // (MY WAY's economy's companies never let their people go: only those who retire leave them)
      const kept = local.firmOf(P, i) && local.sphereOf(local.firmOf(P, i));
      if (r.u() < end && (!kept || age >= 65)) { leave(W, i, day, age >= 65 ? 'retire' : j === J.self ? 'quit' : 'fired'); }
      continue;
    }
    // the retired of 60-74 the local companies take on part time (シニアの再雇用: Japan's are half at work to 69)
    if (j === J.retired) {
      if (!gaps || r.u() >= L.offerDaily * L.seniors) continue;
      const age = ageOf(P, i, day);
      if (age < 60 || age >= 75 || P.health[i] < 120) continue;
      const f = pick();
      if (!f) continue;
      P.job[i] = J.part;
      local.join(W, i, f, wages.atMarket(W, f.pay * (0.45 + 0.2 * r.u())), () => r.u());
      P.tenure[i] = 0; P.jsat[i] = 170;
      remember(P, i, day, M.hired, 120);
      taken(f);
      continue;
    }
    if (j !== J.none || P.flags[i] & (FL.student | FL.mayor)) continue;
    const age = ageOf(P, i, day);
    if (age < 18 || age >= 65 || r.u() >= L.offerDaily * L.localShare * want) continue;
    // (a local company short of people first, else one of the small shops)
    const f = gaps > 0 && r.u() < 0.8 ? pick() : null;
    const kind = f || r.u() < 0.7 ? J.other : J.part;
    P.job[i] = kind;
    if (f) { local.join(W, i, f, wages.atMarket(W, f.pay * (0.85 + 0.3 * r.u())), () => r.u()); taken(f); }
    else { P.firm[i] = 0; P.salary[i] = wages.atMarket(W, OTHER_PAY[kind] * (0.8 + 0.4 * r.u())); P.wdist[i] = P.dist[i]; }
    P.tenure[i] = 0;
    P.jsat[i] = 160;
    P.jobless[i] = 0;
    P.joblessPay[i] = 0;
    remember(P, i, day, M.hired, 120);
  }
}

/* ---------------------------------------------------------------- MY WAY's pay --- */
// MY WAY's philosophy (CORP.myway.philosophy): each month its sales grew, its people's pay up by `raiseBy` of the growth,
// and more in a boom — each their own share of it (`spread`); never down. Its economy's local companies do the same
// by their own sales.
function mywayRaises(W, day, r, ctx) {
  const P = W.P, PH = CORP.myway.philosophy, mw = ctx.corp && ctx.corp.co.myway;
  if (!PH) return;
  // (the times: in a boom faster still — server/core/npc-macro.js)
  const boom = Math.max(0, boomOf(W) - 1) * PH.boom * 10;
  const growth = (h) => (h && h.length >= 3 && h[0].sales + h[1].sales > 0 ? h[2].sales / ((h[0].sales + h[1].sales) / 2) - 1 : 0);
  const lift = (i, g) => { const k = PH.spread[0] + (PH.spread[1] - PH.spread[0]) * r.u(); P.salary[i] = Math.round(P.salary[i] * (1 + g * k)); };
  if (mw && !mw.dead) {
    const g = Math.max(0, PH.raiseBy * growth(mw.mHist)) + boom;
    if (g > 0) for (const i of W.staffOf('myway')) lift(i, g);
  }
  if (!W.locals) return;
  for (const f of BR_LOCAL.firms) {
    const c = W.locals.firms[f.id];
    if (!local.sphereOf(f.no) || c.dead || !c.last || !c.before) continue;
    const g = Math.max(0, PH.raiseBy * (c.last.sales / Math.max(1, c.before) - 1)) + boom;
    if (g > 0) for (let i = 0; i < P.n; i++) if (local.firmOf(P, i) === f.no) lift(i, g);
  }
}

/* ---------------------------------------------------------------- 人手不足 --- */
// A company or a local company that stays short of its people raises what it offers new ones the longer it stays
// short (中途採用の上乗せ: `perDay` of its pay for each day — no cap: what it takes to fill), and takes them from where
// they are, a month's gap at most a day: the small shops' people, the self-employed and part-timers (as far as it pays
// them better than now), those at home and the retired still able to (再雇用, to 69), who take less. In a country where
// everyone works, a new employer fills only so (the companies that came later, MY WAY's and WAZIMA's, never did before).
const SHORT = { perDay: 0.002, better: 1.1, take: 0.5, homeAge: [22, 60], seniorAge: [60, 70], seniorHealth: 120, seniorPay: 0.65 };
function shortage(W, day, r, ctx) {
  const P = W.P, J = NPC.job, lb = W.lab, short = lb.short || (lb.short = {}), lshort = lb.lshort || (lb.lshort = {});
  const opens = lb.openings.filter((o) => o.left > 0);
  for (const id of NPC.companies) short[id] = opens.some((o) => o.company === id) ? (short[id] || 0) + 1 : 0;
  if (!W.locals) return;
  const lopen = local.openings(W);
  for (const f of LOCAL_FIRMS()) lshort[f.id] = lopen.some((x) => x[0] === f) ? (lshort[f.id] || 0) + 1 : 0;
  if (!opens.length && !lopen.length) return;
  // (who might move: their pay now, 0 for those at home and the retired)
  const pool = [];
  for (let i = 0; i < P.n; i++) {
    const j = P.job[i];
    if (P.flags[i] & (FL.student | FL.mayor | FL.exec | FL.research)) continue;
    if (j === J.other || j === J.self || j === J.part) { pool.push(i); continue; }
    if (j !== J.home && j !== J.retired) continue;
    const age = ageOf(P, i, day);
    if (j === J.home ? age >= SHORT.homeAge[0] && age < SHORT.homeAge[1] : age >= SHORT.seniorAge[0] && age < SHORT.seniorAge[1] && P.health[i] >= SHORT.seniorHealth) pool.push(i);
  }
  if (!pool.length) return;
  const used = new Set();
  const draw = () => { for (let k = 0; k < 6; k++) { const i = pool[r.int(pool.length)]; if (!used.has(i)) return i; } return -1; };
  const wants = (i, offer) => {
    const j = P.job[i], senior = j === J.retired;
    const pay = senior ? offer * SHORT.seniorPay : offer;
    // (those at home and the retired come for a fair wage; the others as far as it is better than theirs)
    return (j === J.home || senior ? true : pay > (P.salary[i] || 0) * SHORT.better) && r.u() < SHORT.take;
  };
  const moved = (i) => { used.add(i); if (local.firmOf(P, i)) P.firm[i] = 0; };
  // the companies
  for (const o of opens) {
    const offer = o.pay * (1 + SHORT.perDay * (short[o.company] || 0)), n = Math.max(1, Math.ceil(o.left / 30));
    for (let k = 0; k < n && o.left > 0; k++) {
      const i = draw();
      if (i < 0 || !wants(i, offer)) continue;
      const senior = P.job[i] === J.retired;
      moved(i);
      P.job[i] = J.none;
      hire(W, i, { ...o, pay: senior ? offer * SHORT.seniorPay : offer, left: 1 }, day, r);
      o.left--;
      if (senior) P.flags[i] |= FL.rehired;
    }
  }
  // the local companies
  for (const [f, gap] of lopen) {
    const c = W.locals.firms[f.id], offer = wages.atMarket(W, f.pay) * (1 + SHORT.perDay * (lshort[f.id] || 0)), n = Math.max(1, Math.ceil(gap / 30));
    for (let k = 0; k < n; k++) {
      const i = draw();
      if (i < 0 || local.firmOf(P, i) === f.no || !wants(i, offer)) continue;
      const senior = P.job[i] === J.retired;
      moved(i);
      P.job[i] = senior ? J.part : J.other;
      local.join(W, i, f, Math.round((senior ? offer * SHORT.seniorPay : offer) * (0.85 + 0.3 * r.u())), () => r.u());
      P.tenure[i] = 0; P.jsat[i] = 170; P.jobless[i] = 0; P.joblessPay[i] = 0;
      remember(P, i, day, M.hired, 120);
      c.staff++;
    }
  }
}
const LOCAL_FIRMS = () => BR_LOCAL.firms;

/* ---------------------------------------------------------------- a working day --- */
function laborDay(W, day, r, ctx) {
  const P = W.P, t = CORP.ymd(day);
  // April: the year's raise for everyone at each company (its union's, or what the company gave) and a step up for
  // the years worked (定期昇給); a union still out on strike gets its raise when it settles
  if (t.m === 4 && t.d === 1) for (const id of NPC.companies) {
    const u = W.lab.unions[id], c = ctx.corp && ctx.corp.co[id];
    if (u && u.state === 'strike') continue;
    const raise = u && u.state === 'settled' && W.lab.talks && W.lab.talks.year === t.y ? u.raise : c && c.yearRaise && c.yearRaise.fy === CORP.fyOf(day) ? c.yearRaise.raise : 0;
    payRaise(W, id, CORP.fyOf(day), raise);
  }
  dismiss(W, day, ctx);
  openings(W, ctx);
  localJobs(W, day, r);
  shortage(W, day, r, ctx);
  // 引き抜き: the companies short of people make offers to the others' (npc-wages.js)
  wages.poach(W, day, r, ctx, hire);
  if (t.d === 1) mywayRaises(W, day, r, ctx);
  // the market's pay moved by the country's wealth, and every employer's review of its people's (npc-wages.js)
  if (t.d === 1) wages.month(W, day, r, ctx);
  // the month in work: a month more of it, the mood at work (the pay against what others pay, the company's
  // fortunes, the boss, the hours), and who leaves today
  for (let i = 0; i < P.n; i++) {
    const j = P.job[i];
    const id = NPC.companyOf(j);
    if (!id) continue;
    const c = ctx.corp && ctx.corp.co[id];
    if (t.d === 1) P.tenure[i] = Math.min(65535, P.tenure[i] + 1);
    if (!c) continue;
    const fair = P.salary[i] / Math.max(1, c.pay * NPC.rankPay(id, P.rank[i]));
    const target = 120 + 60 * Math.min(1.3, fair) - 40 * Math.max(0, (W.stats.prices || 1) - 1) * 10 + (c.morale - 0.6) * 120 - (W.crunch && W.crunch[j] ? 25 : 0);
    P.jsat[i] = clampB(P.jsat[i] + (target - P.jsat[i]) * 0.02 + r.z() * 2);
    const p = CORP.company(id);
    // (the happier, the less — but never below 60% of the company's rate: people move on for their own reasons too, a
    // family, a town, a better offer; at a fifth of it, one in eighty a year left and no one was out of work)
    const quit = (p ? p.quit : 0.06) / 365 * Math.max(0.6, (1.8 - P.jsat[i] / 150)) * (W.lab.wave && W.lab.wave[id] ? 3 : 1);
    if (!(P.flags[i] & (FL.exec)) && r.u() < quit) {
      // (some only to another company, others out of work for a while)
      leave(W, i, day, 'quit');
    }
  }
  // 最低賃金 (the country's knob): on the 1st, no one employed is paid a year below it
  if (t.d === 1) {
    const floor = W.nation.knobs.minWage || 0;
    for (let i = 0; i < P.n; i++) if (P.job[i] >= 1 && P.job[i] <= 14 && P.salary[i] > 0 && P.salary[i] < floor) P.salary[i] = floor;
  }
  // 大量退職: a company where the mood fell and others are hiring — the leaving catches
  if (t.d === 1) for (const id of NPC.companies) {
    const staff = W.staffOf(id);
    if (staff.length < 10) continue;
    let sat = 0;
    for (const i of staff) sat += P.jsat[i];
    sat /= staff.length;
    const others = W.lab.openings.filter((o) => o.company !== id).reduce((n, o) => n + o.left, 0);
    W.lab.wave = W.lab.wave || {};
    if (sat < 105 && others > staff.length * 0.05) {
      if (!W.lab.wave[id]) W.news.push({ day, kind: 'labor', district: -1, text: `${CORP.company(id).name}で退職者が相次ぐ（社員の満足度${Math.round(sat / 2.55)}）`, data: { company: id } });
      W.lab.wave[id] = 1;
    } else delete W.lab.wave[id];
  }
  // April: the new graduates — the students of 22 and 23 that the companies' plans want
  if (t.m === 4 && t.d === 1) {
    for (let i = 0; i < P.n; i++) {
      if (P.job[i] !== NPC.job.student || ageOf(P, i, day) < 21) continue;
      const o = W.lab.openings.filter((x) => x.left > 0).sort((a, b) => b.left - a.left)[0];
      if (!o) { P.job[i] = NPC.job.none; P.flags[i] &= ~FL.student; continue; }
      hire(W, i, o, day, r);
    }
  }
  // the young who finished their studies look for work
  for (let i = 0; i < P.n; i++) if (P.job[i] === NPC.job.student && ageOf(P, i, day) >= 24) { P.job[i] = NPC.job.none; P.flags[i] &= ~FL.student; }
  shunto(W, day, r, ctx);
}

// A company's raise for fiscal year `fy` on its people's pay (once a year), with the step for the years worked
const STEP = 0.015;
function payRaise(W, id, fy, raise) {
  const P = W.P, lb = W.lab;
  lb.raised = lb.raised || {};
  if (lb.raised[id] === fy) return;
  lb.raised[id] = fy;
  for (const i of W.staffOf(id)) {
    if (!(P.salary[i] > 0)) continue;
    // (MY WAY never lowers its people's pay: its philosophy)
    const r0 = id === 'myway' ? Math.max(0, raise) : Math.max(-0.1, raise);
    P.salary[i] = Math.round(P.salary[i] * (1 + r0 + (P.tenure[i] >= 12 && !(P.flags[i] & FL.rehired) ? STEP : 0)));
  }
}

/* ---------------------------------------------------------------- the unions --- */
function unionsAtStart(W) {
  const P = W.P, lb = W.lab;
  for (const id of NPC.companies) lb.unions[id].members = 0;
  for (let i = 0; i < P.n; i++) {
    const j = P.job[i];
    const id = NPC.companyOf(j);
    if (!id) continue;
    if ((Math.imul(i + 1, 2654435761) >>> 0) / 4294967296 < RATES[id]) { P.flags[i] |= FL.union; lb.unions[id].members++; }
  }
  for (const id of NPC.companies) pickRep(W, id);
}
// the members' rep: the most outgoing and sure among them
function pickRep(W, id) {
  const P = W.P, u = W.lab.unions[id];
  let best = -1, bv = -1;
  for (const i of W.staffOf(id)) {
    if (!(P.flags[i] & FL.union)) continue;
    const v = tr(P, i, T.extra) + tr(P, i, T.justice) + P.sk[i * 8 + S.speech] / 255 + P.sk[i * 8 + S.negotiate] / 255;
    if (v > bv) { bv = v; best = i; }
  }
  if (u.rep >= 0) W.P.flags[u.rep] &= ~FL.unionRep;
  u.rep = best;
  if (best >= 0) P.flags[best] |= FL.unionRep | FL.famous;
}
// 春闘: on 1 February the unions ask (prices, the company's profit, what the members mind, how hard their rep is);
// each Monday of February and March the company (its 社長) answers and the two move towards each other, each by
// its own patience; by 31 March it is settled (the raise from April: server/core/corp-model.js), or a strike begins.
// the company's last fiscal year as its books closed it (its net profit and sales), for the wage talks
function lastYear(c) {
  const y = (c && c.hist || []).filter((h) => h.kind === 'y').slice(-1)[0];
  return y ? { net: y.net, sales: y.sales } : { net: 0, sales: 0 };
}
function shunto(W, day, r, ctx) {
  const P = W.P, t = CORP.ymd(day), lb = W.lab;
  if (t.m === 2 && t.d === 1) {
    lb.talks = { year: t.y, from: day, rows: [] };
    for (const id of NPC.companies) {
      const u = lb.unions[id], c = ctx.corp && ctx.corp.co[id];
      if (!c || u.members < 3) { u.state = 'idle'; continue; }
      if (u.rep < 0 || !(P.flags[u.rep] & FL.union)) pickRep(W, id);
      const rep = u.rep >= 0 ? u.rep : 0;
      const ly = lastYear(c);
      const grow = ly.net > 0 ? Math.min(0.03, ly.net / Math.max(1, ly.sales) * 0.3) : 0;
      u.demand = Math.round(Math.max(0.01, Math.min(0.09, (W.stats.inflation || 0.01) + 0.015 + grow + 0.02 * tr(P, rep, T.justice))) * 1000) / 1000;
      u.offer = 0;
      u.state = 'talks';
      u.strength = Math.min(1, u.members / Math.max(1, W.staffOf(id).length) + 0.2 * tr(P, rep, T.extra));
      W.news.push({ day, kind: 'labor', district: -1, text: `${CORP.company(id).name}の労働組合が${(u.demand * 100).toFixed(1)}%の賃上げを要求（春闘）`, data: { company: id } });
    }
  }
  if (!lb.talks) return;
  const monday = (day + 4) % 7 === 1;
  if (monday && (t.m === 2 || t.m === 3)) {
    for (const id of NPC.companies) {
      const u = lb.unions[id], c = ctx.corp && ctx.corp.co[id];
      if (u.state !== 'talks' || !c) continue;
      const boss = W.org.boss(id);
      const tight = boss >= 0 ? tr(P, boss, T.thrift) : 0.5;
      const ly = lastYear(c);
      const room = ly.net > 0 ? Math.min(0.06, 0.01 + ly.net / Math.max(1, ly.sales) * 0.25) : 0.005;
      u.offer = Math.min(u.demand, Math.max(u.offer, room * (1.2 - tight * 0.6) * (0.6 + 0.1 * lb.talks.rows.filter((x) => x.id === id).length)));
      const give = 0.3 * (1 - tr(P, u.rep >= 0 ? u.rep : 0, T.patience));
      u.demand = Math.max(u.offer, u.demand - (u.demand - u.offer) * give);
      lb.talks.rows.push({ day, id, demand: u.demand, offer: u.offer });
      if (u.demand - u.offer < 0.002) settle(W, id, day, (u.demand + u.offer) / 2);
    }
  }
  if (t.m === 3 && CORP.isMonthEnd(day)) {
    for (const id of NPC.companies) {
      const u = lb.unions[id];
      if (u.state !== 'talks') continue;
      const anger = u.strength * (u.demand - u.offer) * 40;
      if (anger > 0.45 && r.u() < anger) {
        u.state = 'strike';
        u.strike = day + 1;
        u.days = 0;
        for (const i of W.staffOf(id)) if (P.flags[i] & FL.union && r.u() < 0.85) { P.flags[i] |= FL.striking; remember(P, i, day, M.strike, 150); }
        W.news.push({ day, kind: 'strike', district: NPC.sites[id][0][0], text: `${CORP.company(id).name}の労働組合がストライキに突入（要求${(u.demand * 100).toFixed(1)}%・回答${(u.offer * 100).toFixed(1)}%）`, data: { company: id } });
      } else settle(W, id, day, u.offer);
    }
  }
  // a strike's days: the work stops (the company's capacity and sales fall), the pay of those out is not paid; it
  // ends as the company gives way (the public's support, its losses) or the strikers tire
  for (const id of NPC.companies) {
    const u = lb.unions[id];
    if (u.state !== 'strike') continue;
    u.days++;
    const giveIn = 0.08 * u.days * (0.5 + u.strength), tire = 0.05 * u.days;
    if (r.u() < giveIn) settle(W, id, day, u.offer + (u.demand - u.offer) * 0.6);
    else if (r.u() < tire) settle(W, id, day, u.offer);
  }
}
function settle(W, id, day, raise) {
  const P = W.P, u = W.lab.unions[id];
  const was = u.state;
  u.state = 'settled';
  u.raise = Math.round(raise * 10000) / 10000;
  W.raises[id] = u.raise;
  for (const i of W.staffOf(id)) P.flags[i] &= ~FL.striking;
  // (settled after April began, the strike over: the raise from now on)
  const t = CORP.ymd(day);
  if (t.m >= 4 && W.lab.talks && W.lab.talks.year === t.y) payRaise(W, id, CORP.fyOf(day), u.raise);
  W.news.push({ day, kind: 'labor', district: -1, text: `${CORP.company(id).name}の春闘が妥結：賃上げ${(u.raise * 100).toFixed(2)}%（4月から）${was === 'strike' ? `、ストライキは${u.days}日で終了` : ''}`, data: { company: id, raise: u.raise } });
}
