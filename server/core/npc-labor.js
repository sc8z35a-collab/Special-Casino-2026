// Work (server/core/npc-model.js): each company's openings (what it wants, server/core/corp-model.js's target, less
// whom it has), put out through the two job sites (the hiring company pays the site its placement fee); leaving (more
// when unhappy, many at once when the mood is bad and the openings elsewhere good: 大量退職); 60 (定年: a severance,
// most kept on to 65 at 60% of their pay) and 65; the new graduates in April. And the unions: their members, their
// rep, the spring wage talks (春闘) in February and March, and a strike when the talks fail.
import { NPC, CORP } from './rules.js';
import { T, S, FL, E, NT, ageOf, remember, clampB } from './npc-pop.js';
import { M, skillFor } from './npc-life.js';

const tr = (P, i, k) => P.tr[i * NT + k] / 255;
const RATES = { tenesice: 0.35, magita: 0.75, carowner: 0.4, jinx: 0.45, daizin: 0.2, citywork: 0.15, speedeed: 0.05, dtrade: 0.1, riru: 0.25, ice: 0.3 };

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
  const P = W.P, ci = NPC.companies.indexOf(o.company);
  if (P.job[i] >= 1 && P.job[i] <= 10) leave(W, i, day, 'move');
  P.job[i] = ci + 1;
  P.flags[i] &= ~FL.student;
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
  W.charge(o.company, o.site, 'placement', Math.round(P.salary[i] * 0.3 * (W.nation.knobs.jobFee || 25) / 25));
  if (RATES[o.company] && r.u() < RATES[o.company]) { P.flags[i] |= FL.union; W.lab.unions[o.company].members++; }
  remember(P, i, day, M.hired, 150);
  W.lab.hires[o.company] = (W.lab.hires[o.company] || 0) + 1;
  W.sum.hired++;
}
// leaving a job (moving on, dismissed, retiring, a death): the company has one fewer; the unemployment benefit for
// those who lost it
function leave(W, i, day, why) {
  const P = W.P, j = P.job[i];
  if (!(j >= 1 && j <= 14)) return;
  const id = j <= 10 ? NPC.companies[j - 1] : null;
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
  P.flags[i] &= ~(FL.union | FL.rehired | FL.striking | FL.exec);
  P.salary[i] = 0;
  P.rank[i] = 0;
  P.tenure[i] = 0;
}
// 60: the severance (two months of pay for each year at most), then most are kept on at 60% to 65
function retire(W, i, day, r) {
  const P = W.P, j = P.job[i];
  const id = j >= 1 && j <= 10 ? NPC.companies[j - 1] : null;
  const pay = P.salary[i], years = Math.min(38, P.tenure[i] / 12);
  const sev = Math.round(pay / 12 * NPC.retire.severance * years);
  if (id) W.charge(id, null, 'severance', sev, i);
  else if (j === NPC.job.civil) { W.nation.cash -= sev; W.nation.day.out.civil = (W.nation.day.out.civil || 0) + sev; P.cash[i] += sev; }
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

/* ---------------------------------------------------------------- a working day --- */
function laborDay(W, day, r, ctx) {
  const P = W.P, t = CORP.ymd(day);
  dismiss(W, day, ctx);
  openings(W, ctx);
  // the month in work: a month more of it, the mood at work (the pay against what others pay, the company's
  // fortunes, the boss, the hours), and who leaves today
  for (let i = 0; i < P.n; i++) {
    const j = P.job[i];
    if (!(j >= 1 && j <= 10)) continue;
    const id = NPC.companies[j - 1], c = ctx.corp && ctx.corp.co[id];
    if (t.d === 1) P.tenure[i] = Math.min(65535, P.tenure[i] + 1);
    if (!c) continue;
    const fair = P.salary[i] / Math.max(1, c.pay * (NPC.ranks[P.rank[i]] ? NPC.ranks[P.rank[i]].pay : 1));
    const target = 120 + 60 * Math.min(1.3, fair) - 40 * Math.max(0, (W.stats.prices || 1) - 1) * 10 + (c.morale - 0.6) * 120 - (W.crunch && W.crunch[j] ? 25 : 0);
    P.jsat[i] = clampB(P.jsat[i] + (target - P.jsat[i]) * 0.02 + r.z() * 2);
    const p = CORP.company(id);
    const quit = (p ? p.quit : 0.06) / 365 * Math.max(0.2, (1.6 - P.jsat[i] / 160)) * (W.lab.wave && W.lab.wave[id] ? 3 : 1);
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

/* ---------------------------------------------------------------- the unions --- */
function unionsAtStart(W) {
  const P = W.P, lb = W.lab;
  for (const id of NPC.companies) lb.unions[id].members = 0;
  for (let i = 0; i < P.n; i++) {
    const j = P.job[i];
    if (!(j >= 1 && j <= 10)) continue;
    const id = NPC.companies[j - 1];
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
function shunto(W, day, r, ctx) {
  const P = W.P, t = CORP.ymd(day), lb = W.lab;
  if (t.m === 2 && t.d === 1) {
    lb.talks = { year: t.y, from: day, rows: [] };
    for (const id of NPC.companies) {
      const u = lb.unions[id], c = ctx.corp && ctx.corp.co[id];
      if (!c || u.members < 3) { u.state = 'idle'; continue; }
      if (u.rep < 0 || !(P.flags[u.rep] & FL.union)) pickRep(W, id);
      const rep = u.rep >= 0 ? u.rep : 0;
      const grow = c.lastNet > 0 ? Math.min(0.03, c.lastNet / Math.max(1, c.lastSales) * 0.3) : 0;
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
      const room = c.lastNet > 0 ? Math.min(0.06, 0.01 + c.lastNet / Math.max(1, c.lastSales) * 0.25) : 0.005;
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
  W.news.push({ day, kind: 'labor', district: -1, text: `${CORP.company(id).name}の春闘が妥結：賃上げ${(u.raise * 100).toFixed(2)}%（4月から）${was === 'strike' ? `、ストライキは${u.days}日で終了` : ''}`, data: { company: id, raise: u.raise } });
}
