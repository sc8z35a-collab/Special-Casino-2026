// The companies' people and their minds (server/core/npc-model.js): every company's departments with their 部長 and
// 課長 and the posts named in them (js/game/npc.js ORG), its CEO, 社長 and 役員 — citizens like any other — and what
// they do with the company: each department sees its part of the books and of the market and brings proposals to the
// 会議室; the attendees argue each by their own character and their department's good; 経理 says what it can afford;
// the ストップ係 may stop it; the CEO and the 社長 decide. What is decided changes the company (its budgets, its
// people, its prices to the people, its terms with MAGITA, its research, its new businesses, Tenesice's rates and
// loans), and everything is kept: the meetings with their minutes, each one's thinking, the reports.
import { NPC, CORP } from './rules.js';
import { T, S, FL, E, NT, ageOf, remember, clampB } from './npc-pop.js';
import * as econ from './npc-econ.js';
import { M, skillFor } from './npc-life.js';
import * as text from './npc-text.js';

const tr = (P, i, k) => P.tr[i * NT + k] / 255;
const sk = (P, i, k) => P.sk[i * 8 + k] / 255;
const YEAR = 365;

/* ---------------------------------------------------------------- at the start --- */
// Each company's people put in its departments by their shares (the big ones first), their posts given by skill and
// years: a CEO and a 社長, a few 役員, a 部長 for each department, a 課長 for about 30 people, a 主任 for 10, and the
// named posts (融資先選定担当, 交渉係, ストップ係 …).
export function assign(W, ages, r) {
  W.orgs = {};
  for (const id of NPC.companies) assignOne(W, id, ages, r);
}
// one company's organisation from the people who work for it (also for one that comes to a living country)
export function assignOne(W, id, ages, r) {
  const P = W.P;
  {
    const staff = [];
    const code = NPC.jobOf(id);
    for (let i = 0; i < P.n; i++) if (P.job[i] === code) staff.push(i);
    const spec = NPC.org[id].map(([key, name, kind, share, roles]) => ({ key, name, kind, share, roles: roles || [] }));
    const o = { id, name: CORP.company(id).name, ceo: -1, president: -1, officers: [], depts: [], seq: 0, ventures: [], labs: [], plan: {}, think: [], lastMeet: 0 };
    W.orgs[id] = o;
    if (!staff.length) { o.depts = spec.map((d) => ({ ...d, head: -1, managers: [], named: {}, size: 0 })); return; }
    // the executives: the most able of the older ones (not those kept on after 60)
    const able = staff.filter((i) => !(P.flags[i] & FL.rehired) && ages[i] >= 45).map((i) => [i, sk(P, i, S.manage) * 2 + tr(P, i, T.ambition) + ages[i] / 60 + r.u() * 0.4]).sort((a, b) => b[1] - a[1]);
    // (a company that names its executives — MY WAY's CCO, CFO, COO and 執行役員 — has as many as it names)
    const named = NPC.officers[id], nOff = named ? Math.min(named.length, Math.max(2, staff.length - 2)) : Math.max(2, Math.min(8, Math.round(staff.length / 2500) + 2));
    const execs = able.slice(0, 2 + nOff).map((x) => x[0]);
    // (a small company with few of the older: the ablest of the rest — all the executives it names, for one that names them)
    const wantExecs = named ? 2 + nOff : 2;
    for (const i of staff.slice().sort((a, b) => P.sk[b * 8 + S.manage] - P.sk[a * 8 + S.manage])) { if (execs.length >= wantExecs) break; if (!execs.includes(i)) execs.push(i); }
    if (execs.length) { o.ceo = execs[0]; P.rank[o.ceo] = 6; }
    if (execs.length > 1) { o.president = execs[1]; P.rank[o.president] = 5; }
    o.officers = execs.slice(2);
    for (const i of o.officers) P.rank[i] = 4;
    for (const i of execs) P.flags[i] |= FL.exec | FL.famous;
    // the departments by their shares (exec is the executives alone)
    const rest = staff.filter((i) => !execs.includes(i));
    const deps = spec.filter((d) => d.kind !== 'exec');
    const total = deps.reduce((n, d) => n + d.share, 0);
    let at = 0;
    const order = rest.slice();
    for (let k = order.length - 1; k > 0; k--) { const j = r.int(k + 1); const t = order[k]; order[k] = order[j]; order[j] = t; }
    o.depts = spec.map((d) => ({ key: d.key, name: d.name, kind: d.kind, share: d.share, roles: d.roles, head: -1, managers: [], named: {}, size: 0 }));
    const execDept = o.depts.findIndex((d) => d.kind === 'exec');
    for (const i of execs) P.dept[i] = execDept;
    o.depts[execDept].size = execs.length;
    // (each department's people by its share, at least one in each when there are enough: the remainders to the largest)
    const sizes = deps.map((d) => Math.max(order.length >= deps.length ? 1 : 0, Math.floor(order.length * d.share / total)));
    let extra = order.length - sizes.reduce((a, b) => a + b, 0);
    const byRest = deps.map((d, k) => [k, order.length * d.share / total - Math.floor(order.length * d.share / total)]).sort((a, b) => b[1] - a[1]);
    for (let x = 0; extra > 0; x = (x + 1) % deps.length) { sizes[byRest[x][0]]++; extra--; }
    while (extra < 0) { const k = sizes.indexOf(Math.max(...sizes)); sizes[k]--; extra++; }
    deps.forEach((d, k) => {
      const di = o.depts.findIndex((x) => x.key === d.key);
      const n = sizes[k];
      const mem = order.slice(at, at + n);
      at += n;
      for (const i of mem) P.dept[i] = di;
      setPosts(W, o, di, mem, ages, r);
    });
    if (id === 'magita') startLabs(W, o, r);
  }
}
function setPosts(W, o, di, mem, ages, r) {
  const P = W.P, d = o.depts[di];
  d.size = mem.length;
  if (!mem.length) return;
  const ranked = mem.map((i) => [i, sk(P, i, S.manage) + Math.min(1, (ages ? ages[i] : 40) / 60) + 0.3 * r.u() - (P.flags[i] & FL.rehired ? 2 : 0)]).sort((a, b) => b[1] - a[1]);
  d.head = ranked[0][0];
  P.rank[d.head] = 3;
  const nMgr = mem.length >= 6 ? Math.max(1, Math.round(mem.length / 30)) : 0;
  d.managers = ranked.slice(1, 1 + nMgr).map((x) => x[0]);
  for (const i of d.managers) P.rank[i] = 2;
  const nLead = Math.round(mem.length / 10);
  for (const [i] of ranked.slice(1 + nMgr, 1 + nMgr + nLead)) P.rank[i] = 1;
  // the named posts: the one with the skill for it among the department's leads
  d.named = {};
  for (const [key] of d.roles) {
    const want = key === 'negotiator' || key === 'buyer' || key === 'liaison' ? S.negotiate : key === 'analyst' || key === 'pick' || key === 'rate' || key === 'amount' ? S.manage : key === 'stopper' ? -1 : key === 'cto' ? S.tech : key === 'clerk' ? S.sales : key === 'director' || key === 'producer' ? S.create : S.manage;
    const pool = ranked.map((x) => x[0]).filter((i) => i !== d.head && !Object.values(d.named).includes(i));
    if (!pool.length) { d.named[key] = d.head; continue; }
    const best = pool.map((i) => [i, (want < 0 ? tr(P, i, T.consc) * 2 + tr(P, i, T.agree) * -0.5 : sk(P, i, want) * 2) + 0.2 * r.u()]).sort((a, b) => b[1] - a[1])[0][0];
    d.named[key] = best;
    P.flags[best] |= FL.famous;
    if (P.rank[best] < 1) P.rank[best] = 1;
  }
}
// MAGITA's research departments: 先端部門 (RIMU TAG), 高度I (A1), 高度II (T1), 高度III (MOL1) — the research the
// companies' books already run (server/core/corp-model.js labDay) — and later the ones it makes itself
function startLabs(W, o, r) {
  const P = W.P, hub = o.depts.findIndex((d) => d.kind === 'rdhub');
  const people = [];
  for (let i = 0; i < P.n; i++) if (P.job[i] === 2 && P.dept[i] === hub) people.push(i);
  let at = 0;
  o.labs = NPC.labs.map((l, k) => {
    const n = k === NPC.labs.length - 1 ? people.length - at : Math.round(people.length * l.share);
    const mem = people.slice(at, at + n);
    at += n;
    const head = mem.slice().sort((a, b) => P.sk[b * 8 + S.tech] - P.sk[a * 8 + S.tech])[0];
    if (head !== undefined) P.flags[head] |= FL.famous;
    return { id: l.id, name: l.name, theme: l.theme, builtin: true, head: head === undefined ? -1 : head, size: mem.length, start: 0, due: 0, done: 0, ok: null, reports: [] };
  });
}

/* ---------------------------------------------------------------- who is who --- */
export function posts(W, i) {
  const out = [];
  for (const o of Object.values(W.orgs)) {
    if (o.ceo === i) out.push(`${o.name} CEO`);
    if (o.president === i) out.push(`${o.name} 社長`);
    if (o.officers.includes(i)) { const t = NPC.officers[o.id]; out.push(`${o.name} ${t && t[o.officers.indexOf(i)] ? t[o.officers.indexOf(i)] : '役員'}`); }
    for (const d of o.depts) {
      if (d.head === i && d.kind !== 'exec') out.push(`${o.name} ${d.name}部長`.replace('部部長', '部長'));
      for (const [key, name] of d.roles) if (d.named[key] === i) out.push(`${o.name} ${name}`);
    }
    for (const l of o.labs) if (l.head === i) out.push(`${o.name} ${l.name}長`);
    for (const v of o.ventures) if (v.lead === i && v.stage !== 'closed') out.push(`${v.name} 事業責任者`);
  }
  return out;
}
// someone in a post is gone (left, retired, died): the next in line takes it
export function vacate(W, i, day) {
  const P = W.P;
  for (const o of Object.values(W.orgs)) {
    const staff = () => W.staffOf(o.id).filter((j) => j !== i && P.job[j] === P.job[i]);
    const best = (list, k) => list.map((j) => [j, sk(P, j, k) + P.rank[j] * 0.3]).sort((a, b) => b[1] - a[1])[0];
    if (o.ceo === i || o.president === i) {
      const cand = o.officers.length ? o.officers : staff().filter((j) => P.rank[j] >= 3);
      const pick = best(cand.length ? cand : staff(), S.manage);
      if (pick) {
        const j = pick[0];
        if (o.ceo === i) { o.ceo = j; P.rank[j] = 6; } else { o.president = j; P.rank[j] = 5; }
        o.officers = o.officers.filter((x) => x !== j);
        P.flags[j] |= FL.exec | FL.famous;
        W.news.push({ day, kind: 'exec', district: -1, text: `${o.name}の${o.ceo === j ? 'CEO' : '社長'}に${W.card(j, day).name}氏が就任`, data: { company: o.id } });
      }
    }
    o.officers = o.officers.filter((x) => x !== i);
    o.depts.forEach((d, di) => {
      const mem = () => staff().filter((j) => P.dept[j] === di);
      if (d.head === i) { const p = best(mem().filter((j) => P.rank[j] >= 1), S.manage) || best(mem(), S.manage); d.head = p ? p[0] : -1; if (d.head >= 0) P.rank[d.head] = 3; }
      d.managers = d.managers.filter((x) => x !== i);
      for (const [key] of d.roles) if (d.named[key] === i) { const p = best(mem(), key === 'negotiator' ? S.negotiate : S.manage); d.named[key] = p ? p[0] : d.head; if (d.named[key] >= 0) P.flags[d.named[key]] |= FL.famous; }
    });
    for (const l of o.labs) if (l.head === i) l.head = -1;
    for (const v of o.ventures) { v.staff = v.staff.filter((x) => x !== i); if (v.lead === i) v.lead = v.staff[0] !== undefined ? v.staff[0] : -1; }
  }
}
// the department a new hire joins: the one most short against its share
export function deptFor(W, id, r) {
  const o = W.orgs[id];
  if (!o) return 0;
  let best = 0, gap = -Infinity;
  const total = Math.max(1, o.depts.reduce((n, d) => n + d.size, 0));
  o.depts.forEach((d, k) => { if (d.kind === 'exec') return; const g = d.share - d.size / total + 0.01 * r.u(); if (g > gap) { gap = g; best = k; } });
  o.depts[best].size++;
  return best;
}
export const boss = (W, id) => { const o = W.orgs[id]; return o ? (o.president >= 0 ? o.president : o.ceo) : -1; };

/* ---------------------------------------------------------------- the days --- */
// what the companies' people do with them today: Tenesice's lending desk every day, each company's meeting once a
// week (a day of its own), the month's reports, reviews and research on the 1st working day, the talks with MAGITA
// each quarter
export function orgDay(W, day, r, ctx) {
  const t = CORP.ymd(day), dow = (day + 4) % 7;
  if (!ctx.corp) return;
  for (const id of NPC.companies) {
    const o = W.orgs[id], s = ctx.corp.co[id];
    // (a company that failed meets no more)
    if (!o || !s || s.dead) continue;
    if (dow >= 1 && dow <= 5 && (hashDay(id) + day) % 5 === 0) meeting(W, o, s, day, r, ctx);
    if (t.d === 2) { accounts(W, o, s, day, r, ctx); ventureReview(W, o, s, day, r, ctx); }
  }
  lendingDesk(W, day, r, ctx);
  if (t.d === 2) ideaReview(W, day, r, ctx);
  if (t.d === 3) { analysis(W, day, r, ctx); labsMonth(W, day, r, ctx); }
  if (t.d === 10 && t.m % 3 === 1) { talks(W, day, r, ctx); licenseTalks(W, day, r, ctx); }
  ventureMonth(W, day, r, ctx);
}
const hashDay = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997; return h; };

/* ---------------------------------------------------------------- proposals --- */
// What a department sees and wants, as a proposal: { title, kind, effect, cost, risk, gain, by, why }
function proposals(W, o, s, day, r, ctx) {
  const P = W.P, id = o.id, out = [];
  const pl = CORP.plOf(Object.fromEntries(Object.entries(s.per.m || {}).filter(([k]) => !/^cf:/.test(k))));
  const ytd = CORP.plOf(Object.fromEntries(Object.entries(s.per.y || {}).filter(([k]) => !/^cf:/.test(k))));
  const monthly = Math.max(1, (s.n * s.unit + s.budget.place + s.budget.rd + s.budget.ads + s.budget.other) / 12);
  const runway = (s.bal.cash || 0) / monthly;
  const guideOp = s.guide && s.guide.ytdOp ? s.guide.ytdOp : 0;
  const behind = guideOp ? ytd.op / Math.max(1, Math.abs(guideOp)) : 1;
  const trend = W.coTrend[id] || 0;
  const dept = (kind) => o.depts.find((d) => d.kind === kind);
  const by = (kind) => { const d = dept(kind); return d ? (d.head >= 0 ? d.head : o.president) : o.president; };
  // 経営企画・経理: the year against the plan
  // (the month's operating result against its sales: deep in the red, a restructuring)
  const monthOp = pl.op, deep = monthOp < 0 && -monthOp > Math.max(1, pl.sales) * 0.15;
  if (deep) {
    const cut = 0.25;
    out.push({ kind: 'cut', title: `構造改革（その他経費を${Math.round(cut * 100)}%・施設費と研究費を10%削減、採用を凍結）`, effect: [{ kind: 'budget', key: 'other', mult: 1 - cut }, { kind: 'budget', key: 'place', mult: 0.9 }, { kind: 'budget', key: 'rd', mult: 0.9 }, { kind: 'budget', key: 'ads', mult: 0.85 }, { kind: 'target', mult: 0.97 }], cost: 0, risk: 0.2, gain: 0.2, by: by('plan') >= 0 ? by('plan') : by('acct'), why: { op: monthOp, sales: pl.sales } });
  } else if (ytd.op < 0 || behind < 0.85) {
    const cut = Math.min(0.15, 0.04 + Math.max(0, 0.9 - behind) * 0.2);
    out.push({ kind: 'cut', title: `経費の見直し（その他経費・広告を${Math.round(cut * 100)}%削減）`, effect: [{ kind: 'budget', key: 'other', mult: 1 - cut }, { kind: 'budget', key: 'ads', mult: 1 - cut * 0.8 }], cost: 0, risk: 0.15, gain: cut, by: by('plan') >= 0 ? by('plan') : by('acct'), why: { behind, op: ytd.op } });
  }
  if (behind > 1.15 && runway > 6) out.push({ kind: 'grow', title: '人員の増強（採用目標を5%引き上げ）', effect: [{ kind: 'target', mult: 1.05 }], cost: s.n * s.unit * 0.05, risk: 0.3, gain: 0.08, by: by('admin'), why: { behind } });
  if (trend < -0.08 && runway > 3) out.push({ kind: 'ads', title: '広告の強化（広告宣伝費を15%増）', effect: [{ kind: 'budget', key: 'ads', mult: 1.15 }, { kind: 'appeal', key: 'all', add: 0.04, days: 60 }], cost: s.budget.ads * 0.15, risk: 0.25, gain: 0.06, by: by(['store', 'sales', 'branch', 'publish', 'casino', 'concierge'].find((k) => dept(k)) || 'plan'), why: { trend } });
  if (s.morale < 0.5) out.push({ kind: 'morale', title: '社内イベントと働き方の改善', effect: [{ kind: 'morale', add: 0.06 }], cost: s.n * 50000, risk: 0.05, gain: 0.03, by: by('admin'), why: { morale: s.morale } });
  // their own trade
  if (dept('venture') && o.ventures.filter((v) => v.stage !== 'closed').length < 2 && runway > 4 && r.u() < 0.35) {
    const v = pickVenture(W, o, r);
    if (v) out.push({ kind: 'venture', title: `新事業「${v.name}」の立ち上げ`, effect: [{ kind: 'venture', action: 'start', type: v.id }], cost: v.launch, risk: 0.45, gain: 0.1, by: dept('venture').named.scout >= 0 ? dept('venture').named.scout : by('venture'), why: { fit: v.fit, market: v.market } });
  }
  if (id === 'tenesice') {
    const rate = W.bankRates.person, want = policyRate(W);
    if (Math.abs(want - rate) > 0.0025) out.push({ kind: 'rate', title: `個人向け金利の改定（年${(rate * 100).toFixed(2)}%→${(want * 100).toFixed(2)}%）`, effect: [{ kind: 'rate', key: 'person', to: want }, { kind: 'rate', key: 'auto', to: Math.max(0.01, want - 0.005) }], cost: 0, risk: 0.1, gain: 0.04, by: dept('lend').named.rate, why: { inflation: W.stats.inflation, target: W.nation.knobs.inflation } });
  }
  if (id === 'magita' && dept('product') && r.u() < 0.3) {
    out.push({ kind: 'product', title: '人気車種のマイナーチェンジ（魅力の向上）', effect: [{ kind: 'appeal', key: 'cars', add: 0.05, days: 365 }, { kind: 'budget', key: 'rd', mult: 1.03 }], cost: s.budget.rd * 0.03, risk: 0.25, gain: 0.05, by: by('product') });
  }
  if (id === 'carowner' && trend < 0) out.push({ kind: 'campaign', title: '週末の来店キャンペーン（整備料金5%引き）', effect: [{ kind: 'price', key: 'service', mult: 0.95, days: 30 }, { kind: 'appeal', key: 'cars', add: 0.03, days: 30 }], cost: 0, risk: 0.2, gain: 0.04, by: dept('store').named.clerk });
  if (id === 'jinx' && trend < 0) out.push({ kind: 'campaign', title: '日用品の特売（5%引き・30日）', effect: [{ kind: 'price', key: 'goods', mult: 0.95, days: 30 }], cost: 0, risk: 0.2, gain: 0.04, by: by('store') });
  if (id === 'daizin' && r.u() < 0.2) {
    const up = trend > 0.05;
    out.push({ kind: 'price', title: `VIP会費の${up ? '値上げ（+5%）' : '据え置きと会員イベント'}`, effect: up ? [{ kind: 'price', key: 'vipFee', mult: 1.05 }] : [{ kind: 'appeal', key: 'lounge', add: 0.05, days: 60 }], cost: 0, risk: up ? 0.3 : 0.1, gain: 0.04, by: by('plan') });
  }
  if (id === 'dtrade' && trend < 0) out.push({ kind: 'event', title: 'カジノの週末イベント（来場の呼び込み）', effect: [{ kind: 'appeal', key: 'casino', add: 0.06, days: 14 }, { kind: 'budget', key: 'ads', mult: 1.05 }], cost: s.budget.ads * 0.05, risk: 0.2, gain: 0.05, by: by('casino') });
  if ((id === 'riru' || id === 'ice') && s.projects && s.projects.some((p) => p.due - day < 45 && p.due > day)) out.push({ kind: 'promo', title: '発売前の宣伝強化', effect: [{ kind: 'appeal', key: 'games', add: 0.08, days: 60 }, { kind: 'budget', key: 'ads', mult: 1.1 }], cost: s.budget.ads * 0.1, risk: 0.15, gain: 0.06, by: by('publish') });
  if ((id === 'citywork' || id === 'speedeed') && r.u() < 0.25) out.push({ kind: 'tech', title: 'マッチングの改善（求人の取り扱いを伸ばす）', effect: [{ kind: 'share', delta: id === 'citywork' ? 0.01 : -0.01 }, { kind: 'budget', key: 'rd', mult: 1.04 }], cost: s.budget.rd * 0.04, risk: 0.2, gain: 0.04, by: by('tech') });
  // カーオーナーのビジネスアドバイザー (the customers' experience) and 計画立案者 (the year's plan for the shops)
  if (id === 'carowner' && dept('advisor') && r.u() < 0.25) out.push({ kind: 'advice', title: '店員の接客研修と試乗会（来店客の購入率を上げる）', effect: [{ kind: 'appeal', key: 'cars', add: 0.04, days: 90 }, { kind: 'budget', key: 'other', mult: 1.02 }], cost: s.budget.other * 0.02, risk: 0.15, gain: 0.05, by: dept('advisor').named.advisor });
  if (id === 'carowner' && dept('plan') && behind < 1 && r.u() < 0.3) out.push({ kind: 'plan', title: '下期の販売計画の見直し（在庫を絞り、整備と中古車に重点）', effect: [{ kind: 'budget', key: 'place', mult: 0.97 }, { kind: 'price', key: 'service', mult: 1.03 }], cost: 0, risk: 0.2, gain: 0.04, by: dept('plan').named.planner });
  // MAGITAの法人営業部: the country's and the companies' orders (公用車, 設備)
  if (id === 'magita' && dept('sales') && r.u() < 0.3) out.push({ kind: 'sales', title: '官公庁・法人への提案営業の強化', effect: [{ kind: 'appeal', key: 'public', add: 0.1, days: 120 }, { kind: 'budget', key: 'ads', mult: 1.05 }], cost: s.budget.ads * 0.05, risk: 0.15, gain: 0.05, by: by('sales') });
  // テネシスのシステム技術部 (技術者): the systems renewed, the running costs down after
  if (id === 'tenesice' && dept('tech') && r.u() < 0.2) out.push({ kind: 'tech', title: '勘定系システムの刷新（運用費の削減）', effect: [{ kind: 'budget', key: 'rd', mult: 1.05 }, { kind: 'budget', key: 'other', mult: 0.96 }], cost: s.budget.rd * 0.05, risk: 0.3, gain: 0.05, by: dept('tech').named.cto });
  // pricing power: what the people cannot get elsewhere (ジンクス's shelves, Car Owner's service, DAIZIN's membership)
  // is raised while they keep buying more of it, and cut when they buy much less (値上げ・値下げ: for good)
  const PRICED = { jinx: 'goods', carowner: 'service', daizin: 'vipFee' };
  if (PRICED[id]) {
    const key = PRICED[id], now = W.priceIdx[id + ':' + key] || 1, greed = o.ceo >= 0 ? tr(P, o.ceo, T.ambition) : 0.5;
    const long = (W.coTrendLong || {})[id] || 0;
    if (long > 0.05 && r.u() < 0.2 + 0.3 * greed) { const up = Math.round((1.04 + 0.08 * greed * r.u()) * 100) / 100; out.push({ kind: 'price', title: `値上げ（${key === 'vipFee' ? 'VIP会費' : key === 'goods' ? '商品' : '整備料金'}を${Math.round((up - 1) * 100)}%）：需要が強いうちに`, effect: [{ kind: 'price', key, mult: up }], cost: 0, risk: 0.2 + 0.1 * Math.max(0, now - 1), gain: 0.06, by: by('plan') >= 0 ? by('plan') : by('acct'), why: { trend: long, price: now } }); }
    else if (long < -0.1 && now > 0.5) out.push({ kind: 'price', title: `値下げ（${key === 'vipFee' ? 'VIP会費' : key === 'goods' ? '商品' : '整備料金'}を8%）：客離れを止める`, effect: [{ kind: 'price', key, mult: 0.92 }], cost: 0, risk: 0.15, gain: 0.05, by: by('plan') >= 0 ? by('plan') : by('acct'), why: { trend: long, price: now } });
  }
  if (id === 'jinx' && r.u() < 0.15) out.push({ kind: 'partner', title: 'スタジオとの連携：店頭でのゲーム販売の強化', effect: [{ kind: 'appeal', key: 'games', add: 0.03, days: 90 }], cost: 0, risk: 0.1, gain: 0.03, by: dept('partner').named.liaison });
  // MY WAY: what its people do for its characters, its partners and its costs; and a partner's contract with it
  if (id === 'myway' && s.ip) mywayProposals(W, o, s, out, { pl, runway, dept, by });
  const mw = ctx.corp.co.myway;
  if (mw && mw.ip && !mw.dead && mw.ip.contracts[id]) partnerProposals(W, o, mw, out, { dept, by });
  return out.filter((p) => p.by !== undefined && p.by >= 0);
}
// the rate the 金利決定担当 thinks right (テイラー則: neutral, plus half the inflation over the target and half the
// economy's gap), for the people's loans
export function policyRate(W) {
  const target = (W.nation.knobs.inflation || 2) / 100, infl = W.stats.inflation || 0.01, gap = (W.stats.economy || 1) - 1;
  return Math.max(0.005, Math.min(0.12, Math.round((0.02 + target + 0.5 * (infl - target) + 0.5 * gap) * 400) / 400));
}

/* ---------------------------------------------------------------- the meeting --- */
// One proposal in the 会議室: who comes (the CEO, the 社長, the proposer's department, 経理, the ストップ係, a 役員), what
// each says, the ストップ係's veto, the vote (the CEO three, the 社長 two, the rest one), the minutes.
function meeting(W, o, s, day, r, ctx) {
  const P = W.P, list = proposals(W, o, s, day, r, ctx);
  if (!list.length) return;
  // (a restructuring comes first when it is on the table)
  // (when there are several, one of them: MY WAY's own measures besides a company's usual restructuring)
  const cuts = list.filter((x) => x.kind === 'cut' && x.gain >= 0.2);
  const p = cuts.length > 1 ? cuts[r.int(cuts.length)] : cuts[0] || list[r.int(list.length)];
  const acct = o.depts.find((d) => d.kind === 'acct'), stop = o.depts.find((d) => d.kind === 'stop');
  const stopper = stop ? (stop.named.stopper >= 0 ? stop.named.stopper : stop.head) : -1;
  const who = [[o.ceo, 'CEO', 3], [o.president, '社長', 2], [p.by, roleOf(o, p.by), 1], [acct ? acct.head : -1, '経理部長', 1], [stopper, 'ストップ係', 1]];
  if (o.officers.length) who.push([o.officers[r.int(o.officers.length)], '役員', 1]);
  const seen = new Set(), att = [];
  for (const [i, role, w] of who) if (i >= 0 && !seen.has(i)) { seen.add(i); att.push({ i, role, w }); }
  const monthly = Math.max(1, (s.n * s.unit + s.budget.place + s.budget.rd + s.budget.ads + s.budget.other) / 12);
  const runway = (s.bal.cash || 0) / monthly;
  const afford = p.cost <= Math.max(0, (s.bal.cash || 0) - monthly * 2);
  let yes = 0, no = 0, veto = null;
  const lines = [];
  for (const a of att) {
    const i = a.i;
    let v = p.gain * 6 - p.risk * (2 - tr(P, i, T.risk) * 1.6) + (tr(P, i, T.ambition) - 0.5) * 0.6 + r.z() * 0.4;
    if (a.role === '経理部長') v += afford ? 0.2 : -1.5;
    if (i === p.by) v += 1;
    if (p.kind === 'cut') v += (runway < 4 ? 0.8 : 0) - (tr(P, i, T.ambition) - 0.5);
    let stance = v > 0.15 ? 'for' : v < -0.15 ? 'against' : 'neutral';
    if (a.role === 'ストップ係') {
      // the stopper: stops what risks too much for where the company stands, or what it cannot afford
      const strict = 0.5 + 0.8 * tr(P, i, T.consc);
      const danger = p.risk * strict + (afford ? 0 : 0.6) + (runway < 2 && p.cost > 0 ? 0.5 : 0) + (p.kind === 'rate' && p.effect.some((e) => e.to > 0.15) ? 1 : 0);
      if (danger > 0.55 && p.kind !== 'cut' && p.kind !== 'morale') { veto = { i, why: !afford ? '資金が足りない' : runway < 2 ? '手元資金が2か月分を切っている' : 'リスクが大きすぎる' }; stance = 'stop'; }
    }
    lines.push({ i, role: a.role, stance, text: text.remark(W, o, p, a.role, stance, { runway, afford, i }, r) });
    if (stance === 'for') yes += a.w; else if (stance === 'against') no += a.w;
  }
  let pass = yes > no && !veto;
  // (a CEO set on it may overrule the stopper, now and then, and say why)
  if (veto && yes > no + 2 && o.ceo >= 0 && tr(P, o.ceo, T.ambition) > 0.8 && r.u() < 0.25) { pass = true; lines.push({ i: o.ceo, role: 'CEO', stance: 'overrule', text: 'ストップ係の懸念は理解するが、責任は私が取る。実行する。' }); }
  const m = { id: ++o.seq, company: o.id, day, room: `第${1 + (o.seq % 4)}会議室`, title: p.title, kind: p.kind, by: p.by, attendees: att.map((a) => ({ i: a.i, role: a.role, name: W.card(a.i, day).name })), lines: lines.map((l) => ({ ...l, name: W.card(l.i, day).name })), yes, no, veto: veto ? { ...veto, name: W.card(veto.i, day).name } : null, pass, why: p.why || null };
  W.meetings.push(m);
  // the thinking of those who carried or stopped it, kept as their own
  think(W, o, p.by, day, `${p.title}を提案した。${pass ? '会議で承認された。' : veto ? `ストップ係に止められた（${veto.why}）。` : '会議で否決された。'}`);
  if (pass) {
    for (const e of p.effect) apply(W, o, e, day, r, ctx);
    W.news.push({ day, kind: 'company', district: -1, text: `${o.name}：${p.title}を決定`, data: { company: o.id, meeting: m.id } });
  }
  o.lastMeet = day;
}
function roleOf(o, i) {
  for (const d of o.depts) {
    if (d.head === i) return d.kind === 'exec' ? '役員' : `${d.name.replace(/（.*）/, '')}長`.replace('部長長', '部長').replace('室長長', '室長');
    for (const [key, name] of d.roles) if (d.named[key] === i) return name;
  }
  return '担当者';
}
function think(W, o, i, day, line) {
  if (i < 0) return;
  o.think.push({ i, day, text: line });
  if (o.think.length > 60) o.think.splice(0, o.think.length - 60);
}

// what a decision does: the company's books (its budgets, its target, its morale, its terms, Tenesice's lending: by
// the server, server/core/npc.js, on the companies' world), and the people's side (prices to them, how much they want
// it, the job sites' shares, the new businesses)
function apply(W, o, e, day, r, ctx) {
  if (e.kind === 'budget' || e.kind === 'target' || e.kind === 'morale' || e.kind === 'terms' || e.kind === 'lab' || e.kind === 'lend' || e.kind === 'ip' || e.kind === 'license') { W.corpOps.push({ company: o.id, ...e }); return; }
  // (a price: changed for good, or for a campaign's days on top of it — a campaign ends by itself, the price stays)
  if (e.kind === 'price') {
    const k = o.id + ':' + e.key;
    if (e.days) { W.priceTemp = W.priceTemp || {}; W.priceTemp[k] = { mult: e.mult, until: day + e.days }; }
    else W.priceIdx[k] = Math.max(0.3, Math.min(5, (W.priceIdx[k] || 1) * e.mult));
    return;
  }
  if (e.kind === 'appeal') { const k = o.id + ':' + e.key; W.appeal[k] = Math.min(0.5, (W.appeal[k] || 0) + e.add); W.appealUntil[k] = day + (e.days || 60); return; }
  if (e.kind === 'rate') { W.bankRates[e.key] = e.to; return; }
  if (e.kind === 'share') { W.siteShare = Math.max(0.3, Math.min(0.85, (W.siteShare || 0.65) + e.delta)); return; }
  if (e.kind === 'venture' && e.action === 'start') { startVenture(W, o, e.type, day, r); }
}

/* ---------------------------------------------------------------- 経理 --- */
// The month's accounts by 経理: last month against the one before, the year against the plan, the money in hand in
// months, what it warns of
function accounts(W, o, s, day, r, ctx) {
  const acct = o.depts.find((d) => d.kind === 'acct');
  if (!acct) return;
  const m = ctx.lastMonth ? ctx.lastMonth(o.id) : null;
  const monthly = Math.max(1, (s.n * s.unit + s.budget.place + s.budget.rd + s.budget.ads + s.budget.other) / 12);
  const runway = (s.bal.cash || 0) / monthly;
  const warn = [];
  if (runway < 3) warn.push(`手元資金が固定費の${runway.toFixed(1)}か月分`);
  if (m && m.pl.op < 0) warn.push('営業赤字');
  if ((s.loans || []).length) warn.push(`借入${s.loans.length}件`);
  const rep = { company: o.id, kind: 'accounts', day, by: acct.head, title: `${CORP.monthLabel(day - 2)}の月次報告（経理部）`, data: { sales: m ? m.pl.sales : 0, op: m ? m.pl.op : 0, net: m ? m.pl.net : 0, cash: s.bal.cash || 0, runway: Math.round(runway * 10) / 10, warn }, text: text.accounts(o, m, runway, warn) };
  W.reports.push(rep);
  think(W, o, acct.head, day, warn.length ? `${warn.join('、')}。支出は慎重にすべきだ。` : '数字は落ち着いている。');
}

/* ---------------------------------------------------------------- the market's watchers --- */
// 競合他社分析室 (MAGITA) and 市場調査室 (シティーワーク): who takes how much of the people's money, how it moved, what
// it means for them
function analysis(W, day, r, ctx) {
  const share = W.coShare || {}, prev = W.coSharePrev || {};
  for (const id of ['magita', 'citywork']) {
    const o = W.orgs[id], d = o && o.depts.find((x) => x.kind === 'analysis');
    if (!d) continue;
    const rows = NPC.companies.map((c) => ({ id: c, name: CORP.company(c).name, share: share[c] || 0, move: (share[c] || 0) - (prev[c] || 0) })).sort((a, b) => b.share - a.share);
    const threats = rows.filter((x) => x.id !== id && x.move > 0.004).slice(0, 3);
    const ventures = Object.values(W.orgs).flatMap((x) => x.ventures.filter((v) => v.stage !== 'closed' && v.company !== id).map((v) => ({ company: x.name, name: v.name, customers: v.customers })));
    const rep = { company: id, kind: 'analysis', day, by: d.named.analyst >= 0 ? d.named.analyst : d.head, title: `${CORP.monthLabel(day)} ${d.name}レポート`, data: { rows, threats, ventures: ventures.slice(0, 8) }, text: text.analysis(W, o, rows, threats, ventures) };
    W.reports.push(rep);
    think(W, o, rep.by, day, threats.length ? `${threats.map((t) => t.name).join('・')}が市民の支出を伸ばしている。手を打つべきだ。` : '市場の勢力図に大きな変化はない。');
  }
  W.coSharePrev = { ...share };
}

/* ---------------------------------------------------------------- MAGITA's labs --- */
// each department's research of the month (the four the books run, then its own); one done frees it for a new
// theme — and MAGITA may make a new department (高度IV …) when its research budget allows
function labsMonth(W, day, r, ctx) {
  const o = W.orgs.magita, s = ctx.corp && ctx.corp.co.magita;
  if (!o || !s) return;
  const P = W.P;
  const lab = s.lab;
  for (const l of o.labs) {
    if (l.builtin && lab) {
      const x = lab.list.find((y) => y.id === l.theme);
      if (x) { l.start = x.start; l.due = x.due; l.done = x.done; l.ok = x.ok; }
      if (l.done && !l.next) l.next = 'free';
    }
    if (!l.builtin && l.due && !l.done && day >= l.due) {
      const spec = NPC.labThemes.find((t) => t.id === l.theme);
      l.done = day;
      l.ok = r.u() < spec.chance * (0.8 + 0.4 * (l.head >= 0 ? P.sk[l.head * 8 + S.tech] / 255 : 0.5));
      if (l.ok) {
        if (spec.cut) W.corpOps.push({ company: 'magita', kind: 'lab', cut: spec.cut, name: `${l.name}「${spec.name}」` });
        if (spec.appeal) { W.appeal['magita:cars'] = Math.min(0.5, (W.appeal['magita:cars'] || 0) + spec.appeal); W.appealUntil['magita:cars'] = day + 720; }
      }
      W.news.push({ day, kind: 'lab', district: 1, text: `MAGITA ${l.name}：「${spec.name}」の研究が${l.ok ? '成功' : '目標に届かず終了'}`, data: { lab: l.id, ok: l.ok } });
    }
    // a free department takes up a new theme
    if ((l.done || l.next === 'free') && (l.builtin ? l.done : true) && r.u() < 0.5) {
      const used = new Set(o.labs.filter((x) => !x.done).map((x) => x.theme));
      const theme = NPC.labThemes.filter((t) => !used.has(t.id))[r.int(Math.max(1, NPC.labThemes.length - used.size))];
      if (theme) {
        Object.assign(l, { theme: theme.id, builtin: false, start: day, due: day + Math.round(theme.months * 30.44), done: 0, ok: null, next: null });
        W.news.push({ day, kind: 'lab', district: 1, text: `MAGITA ${l.name}が新テーマ「${theme.name}」の研究を開始`, data: { lab: l.id } });
      }
    }
    l.reports.push({ day, text: text.lab(l, day) });
    if (l.reports.length > 12) l.reports.shift();
  }
  // a new department, when the research money is ahead of what the departments use
  const perLab = s.budget.rd / Math.max(1, o.labs.length);
  if (o.labs.length < 9 && perLab > 1.8e9 && r.u() < 0.25) {
    const n = o.labs.length - 3;
    const name = `高度${['IV', 'V', 'VI', 'VII', 'VIII'][Math.max(0, n - 1)] || n}部門`;
    const theme = NPC.labThemes[r.int(NPC.labThemes.length)];
    const hub = o.depts.findIndex((d) => d.kind === 'rdhub');
    const people = W.staffOf('magita').filter((i) => P.dept[i] === hub);
    const head = people.sort((a, b) => P.sk[b * 8 + S.tech] - P.sk[a * 8 + S.tech])[0];
    o.labs.push({ id: 'lab' + o.labs.length, name, theme: theme.id, builtin: false, head: head === undefined ? -1 : head, size: Math.round(people.length / (o.labs.length + 1)), start: day, due: day + Math.round(theme.months * 30.44), done: 0, ok: null, reports: [], made: day });
    W.news.push({ day, kind: 'lab', district: 1, text: `MAGITAが研究開発本部に${name}を新設（テーマ「${theme.name}」）`, data: {} });
    W.meetings.push({ id: ++o.seq, company: 'magita', day, room: '第1会議室', title: `${name}の新設`, kind: 'lab', by: head, attendees: [], lines: [{ i: o.ceo, role: 'CEO', stance: 'for', name: W.card(o.ceo, day).name, text: `研究費に余力がある。${theme.name}に賭ける。` }], yes: 3, no: 0, veto: null, pass: true });
  }
}

/* ---------------------------------------------------------------- the talks --- */
// Each quarter MAGITA's 交渉係 meets Car Owner's 値段交渉係 and ジンクスの取引担当 on the 仕入れ価格: each starts from
// what their books want (MAGITA's margin, the buyer's), and they move towards each other by their own patience and
// skill until they meet or one walks away; the price moves for what is bought from then on.
function talks(W, day, r, ctx) {
  const P = W.P, mg = W.orgs.magita;
  if (!mg) return;
  const seller = (mg.depts.find((d) => d.kind === 'nego') || {}).named || {};
  const s = ctx.corp.co.magita;
  for (const buyer of ['carowner', 'jinx']) {
    const o = W.orgs[buyer], b = ctx.corp.co[buyer];
    if (!o || !b) continue;
    const d = o.depts.find((x) => x.kind === 'nego' || x.kind === 'trade');
    const them = d ? (d.named.negotiator !== undefined ? d.named.negotiator : d.named.buyer) : -1;
    const us = seller.negotiator;
    if (us === undefined || us < 0 || them === undefined || them < 0) continue;
    const mgWant = s.guide && s.guide.ytdOp && CORP.plOf(s.per.y || {}).op < s.guide.ytdOp ? 0.03 : 0.01;
    const byWant = b.guide && b.guide.ytdOp && CORP.plOf(b.per.y || {}).op < b.guide.ytdOp ? -0.04 : -0.015;
    let a = mgWant, c = byWant;
    const rows = [];
    for (let round = 1; round <= 5; round++) {
      a -= (a - c) * 0.25 * (1.2 - tr(P, us, T.patience) * 0.6 - P.sk[us * 8 + S.negotiate] / 255 * 0.4);
      c += (a - c) * 0.25 * (1.2 - tr(P, them, T.patience) * 0.6 - P.sk[them * 8 + S.negotiate] / 255 * 0.4);
      rows.push({ round, magita: Math.round(a * 1000) / 10, buyer: Math.round(c * 1000) / 10 });
      if (a - c < 0.004) break;
    }
    const deal = a - c < 0.01;
    const move = deal ? Math.round((a + c) / 2 * 1000) / 1000 : 0;
    if (deal && move) W.corpOps.push({ company: 'magita', kind: 'terms', buyer, mult: 1 + move });
    const m = { id: ++mg.seq, company: 'magita', day, room: '交渉室', title: `${o.name}との仕入れ価格交渉`, kind: 'talks', by: us,
      attendees: [{ i: us, role: 'MAGITA 交渉係', name: W.card(us, day).name }, { i: them, role: `${o.name} ${buyer === 'carowner' ? '値段交渉係' : '取引担当'}`, name: W.card(them, day).name }],
      lines: rows.map((x) => ({ i: us, role: `第${x.round}回`, stance: 'neutral', name: '', text: `MAGITA案 ${x.magita >= 0 ? '+' : ''}${x.magita}%／${o.name}案 ${x.buyer >= 0 ? '+' : ''}${x.buyer}%` })), yes: deal ? 1 : 0, no: deal ? 0 : 1, veto: null, pass: deal, result: { move } };
    W.meetings.push(m);
    W.news.push({ day, kind: 'company', district: 1, text: deal ? `MAGITAと${o.name}が仕入れ価格で合意（${move >= 0 ? '+' : ''}${(move * 100).toFixed(1)}%）` : `MAGITAと${o.name}の仕入れ価格交渉は物別れ`, data: { meeting: m.id } });
    think(W, mg, us, day, deal ? `${o.name}と${(move * 100).toFixed(1)}%で合意した。` : `${o.name}は譲らなかった。次の四半期にまた話す。`);
  }
}

/* ---------------------------------------------------------------- MY WAY --- */
// What MY WAY's people bring to its 会議室 (CORP.myway): the 世界観・IP設定プランナー (or the design chief) a new
// character when the characters cool (流行の冷え込み), the IP lawyers the copies fought in court, the PR director a
// campaign when the name is hurt (信用崩壊), the alliance manager the fee offered lower to a partner that left, and the
// CFO's planners the costs (固定費の地獄: the care for its people cut, never their pay, and a voluntary retirement when the
// money runs short).
function mywayProposals(W, o, s, out, { pl, runway, dept, by }) {
  const ip = s.ip, M = CORP.myway, pct = (x) => `${Math.round(x * 100)}%`;
  const named = (k, role) => { const d = dept(k); return d ? (d.named[role] >= 0 ? d.named[role] : d.head) : -1; };
  const cfo = o.officers[1] >= 0 ? o.officers[1] : by('plan');
  if (ip.heat < 0.85) {
    const who = named('world', 'planner') >= 0 ? named('world', 'planner') : named('design', 'chief');
    out.push({ kind: 'ip', title: `新キャラクターの緊急投入（流行${pct(ip.heat)}：マンネリ化への対策）`, effect: [{ kind: 'ip', action: 'newchar' }], cost: M.newChar.cost, risk: 0.3, gain: 0.12 + (0.85 - ip.heat) * 0.5, by: who, why: { heat: ip.heat } });
  }
  if (ip.fakes > 0.2) out.push({ kind: 'ip', title: `違法コピー品の一斉摘発・国際訴訟（コピー品${pct(ip.fakes)}）`, effect: [{ kind: 'ip', action: 'legal' }], cost: M.legal.cost, risk: 0.15, gain: 0.08 + ip.fakes * 0.3, by: named('legal', 'ip'), why: { fakes: ip.fakes } });
  if (ip.brand < 0.8) out.push({ kind: 'ip', title: `ブランド回復キャンペーンと記者会見（信用${pct(ip.brand)}）`, effect: [{ kind: 'ip', action: 'pr' }], cost: M.pr.cost, risk: 0.2, gain: 0.06 + (0.8 - ip.brand) * 0.4, by: named('pr', 'pr'), why: { brand: ip.brand } });
  for (const [pid, c] of Object.entries(ip.contracts)) {
    if (c.on || c.fee <= c.base * M.talks.floor + 1e6 || (c.offered && W.day - c.offered < 60)) continue;
    out.push({ kind: 'ip', title: `${CORP.company(pid).name}への再契約の提案（契約料を${pct(M.win.off)}引き下げ）`, effect: [{ kind: 'ip', action: 'win', partner: pid }], cost: 0, risk: 0.1, gain: 0.07, by: named('alliance', 'negotiator'), why: { partner: pid } });
  }
  // (the fixed costs: what it cannot cut is the pay)
  if (pl.op < 0 || runway < 6) {
    out.push({ kind: 'cut', title: '固定費の見直し（社員管理・福利厚生費を10%削減。基本給と月次ボーナスは維持）', effect: [{ kind: 'ip', action: 'care' }, { kind: 'budget', key: 'other', mult: 0.85 }, { kind: 'target', mult: 0.98 }], cost: 0, risk: 0.2, gain: 0.2, by: cfo, why: { op: pl.op, runway } });
    if (runway < 4) out.push({ kind: 'cut', title: `希望退職の募集（社員の${pct(M.retire.share)}・退職金${M.retire.severance}か月分）`, effect: [{ kind: 'ip', action: 'retire' }], cost: s.n * M.retire.share * s.pay / 12 * M.retire.severance, risk: 0.35, gain: 0.25, by: cfo, why: { runway } });
  }
}
// A partner of MY WAY's weighs its contract (its 交渉係, its buyer or its planners): given up when it lost on it last
// month or the characters became something to be ashamed of (信用 under a third); taken up again when they pull well
// past what the fee asks of them.
function partnerProposals(W, o, mw, out, { dept, by }) {
  const c = mw.ip.contracts[o.id], M = CORP.myway, x = M.partners[o.id];
  if (!c || !x) return;
  const d = dept('nego') || dept('trade') || dept('partner');
  const who = d ? (d.named.negotiator >= 0 ? d.named.negotiator : d.named.buyer >= 0 ? d.named.buyer : d.named.liaison >= 0 ? d.named.liaison : d.head) : by('plan');
  const pull = Math.max(0, mw.ip.heat * mw.ip.brand), be = CORP.breakeven(o.id, c.fee), last = c.last;
  if (c.on) {
    const losing = last && last.on && last.margin < 0, shame = mw.ip.brand < 0.33;
    if (losing || shame) out.push({ kind: 'license', title: `MY WAYとのIP契約の打ち切り（${shame ? 'ブランドの信用が失墜し「持つと恥ずかしい」状態' : `コラボの採算割れ：先月${NPC.money(last.margin)}`}）`,
      effect: [{ kind: 'license', action: 'cancel', why: shame ? 'ブランドの信用失墜のため' : '採算割れのため' }], cost: 0, risk: 0.15, gain: 0.08 + (losing ? Math.min(0.3, -last.margin / Math.max(1, last.fee)) : 0.15), by: who, why: { margin: last ? last.margin : 0, brand: mw.ip.brand } });
  } else if (pull >= be * 1.1) {
    out.push({ kind: 'license', title: `MY WAYとのIP契約の再締結（キャラクター人気の回復：年${NPC.money(c.fee)}）`, effect: [{ kind: 'license', action: 'sign', why: 'キャラクター人気の回復を受けて' }], cost: 0, risk: 0.25, gain: 0.06 + Math.min(0.2, (pull / be - 1) * 0.3), by: who, why: { pull, breakeven: be } });
  }
}
// Each quarter MY WAY's 交渉係 meets each partner's on its fee: MY WAY asks more while its characters pull well and
// the partner earns on them, less to keep a partner that barely does; the partner wants less while it earns little on
// them. They move towards each other by their patience and skill until they meet (the fee moves, within MY WAY's band)
// or part.
function licenseTalks(W, day, r, ctx) {
  const P = W.P, o = W.orgs.myway, mw = ctx.corp && ctx.corp.co.myway;
  if (!o || !mw || mw.dead || !mw.ip) return;
  const d0 = o.depts.find((d) => d.kind === 'nego'), us = d0 ? (d0.named.negotiator >= 0 ? d0.named.negotiator : d0.head) : -1;
  if (us < 0) return;
  const pull = Math.max(0, mw.ip.heat * mw.ip.brand);
  for (const [id, c] of Object.entries(mw.ip.contracts)) {
    const t = W.orgs[id];
    if (!c.on || !t || !c.last) continue;
    const d = t.depts.find((x) => x.kind === 'nego' || x.kind === 'trade' || x.kind === 'partner');
    const them = d ? (d.named.negotiator >= 0 ? d.named.negotiator : d.named.buyer >= 0 ? d.named.buyer : d.named.liaison >= 0 ? d.named.liaison : d.head) : -1;
    if (them === undefined || them < 0) continue;
    const share = c.last.margin / Math.max(1, c.last.fee);
    let a = pull > 1.05 && share > 0.3 ? 0.05 : pull < 0.9 || share < 0.05 ? -0.05 : 0.01;
    let b = share < 0.1 ? -0.08 : share < 0.4 ? -0.03 : 0.02;
    const rows = [];
    for (let round = 1; round <= 5; round++) {
      a -= (a - b) * 0.25 * (1.2 - tr(P, us, T.patience) * 0.6 - P.sk[us * 8 + S.negotiate] / 255 * 0.4);
      b += (a - b) * 0.25 * (1.2 - tr(P, them, T.patience) * 0.6 - P.sk[them * 8 + S.negotiate] / 255 * 0.4);
      rows.push({ round, us: Math.round(a * 1000) / 10, them: Math.round(b * 1000) / 10 });
      if (a - b < 0.004) break;
    }
    const deal = a - b < 0.01, move = deal ? Math.round((a + b) / 2 * 1000) / 1000 : 0;
    if (deal && move) W.corpOps.push({ company: 'myway', kind: 'ip', action: 'fee', partner: id, mult: 1 + move });
    const m = { id: ++o.seq, company: 'myway', day, room: '交渉室', title: `${t.name}とのIP契約料の交渉`, kind: 'talks', by: us,
      attendees: [{ i: us, role: 'MY WAY 交渉係', name: W.card(us, day).name }, { i: them, role: `${t.name} 交渉担当`, name: W.card(them, day).name }],
      lines: rows.map((x) => ({ i: us, role: `第${x.round}回`, stance: 'neutral', name: '', text: `MY WAY案 ${x.us >= 0 ? '+' : ''}${x.us}%／${t.name}案 ${x.them >= 0 ? '+' : ''}${x.them}%` })), yes: deal ? 1 : 0, no: deal ? 0 : 1, veto: null, pass: deal, result: { move } };
    W.meetings.push(m);
    W.news.push({ day, kind: 'company', district: 3, text: deal ? `MY WAYと${t.name}がIP契約料で合意（${move >= 0 ? '+' : ''}${(move * 100).toFixed(1)}%）` : `MY WAYと${t.name}の契約料交渉は物別れ`, data: { meeting: m.id } });
    think(W, o, us, day, deal ? `${t.name}と契約料${(move * 100).toFixed(1)}%で合意した。` : `${t.name}は譲らなかった。次の四半期にまた話す。`);
  }
}
// MY WAY's アイデア審査・成果報酬査定委員会, each month: the ideas its creative people brought, the ones taken up paid
// $500K each (成果報酬) to whoever had them — the more creative and the happier at work, the likelier — and the
// characters freshened by them
function ideaReview(W, day, r, ctx) {
  const P = W.P, o = W.orgs.myway, s = ctx.corp && ctx.corp.co.myway;
  if (!o || !s || s.dead || !s.ip) return;
  const M = CORP.myway, staff = W.staffOf('myway');
  if (!staff.length) return;
  const n = Math.round(staff.length * M.ideaRate * (0.6 + 0.7 * s.morale) * (0.8 + 0.4 * r.u()));
  if (n <= 0) return;
  const pool = staff.map((i) => [i, P.sk[i * 8 + S.create] / 255 + P.jsat[i] / 510 + r.u()]).sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
  for (const i of pool) { W.charge('myway', null, 'idea', M.idea, i); remember(P, i, day, M_PRIZE, 140); }
  W.corpOps.push({ company: 'myway', kind: 'ip', action: 'ideas', n: pool.length, people: pool.slice(0, 50) });
  const rev = o.depts.find((d) => d.kind === 'review'), judge = rev ? (rev.named.judge >= 0 ? rev.named.judge : rev.head) : o.president;
  W.reports.push({ company: 'myway', kind: 'ideas', day, by: judge, title: `${CORP.monthLabel(day)} アイデア審査・成果報酬査定`, data: { n: pool.length, each: M.idea, all: pool.length * M.idea, people: pool.slice(0, 12) },
    text: `今月は${pool.length}件の企画を採用しました。発案者には1件あたり${NPC.money(M.idea)}の成果報酬（合計${NPC.money(pool.length * M.idea)}）を支給します。` });
  think(W, o, judge, day, `今月は${pool.length}件を採用した。社員の発想こそが最大の資産だ。`);
}
// (a person whose idea was taken up remembers it as a good day at work)
const M_PRIZE = M.promoted;

/* ---------------------------------------------------------------- Tenesice's lending desk --- */
// The lending desk every day: the 融資先選定担当 looks at each company's books (its money in months, its losses, its
// loans), the 融資額決定担当 says how much it may borrow, the 金利決定担当 at what rate (its rank's band and more for
// the weak). What it decides is what the company may borrow when it must (server/core/corp-model.js treasury).
function lendingDesk(W, day, r, ctx) {
  const P = W.P, o = W.orgs.tenesice;
  if (!o || (day + 4) % 7 !== 3) return;
  const d = o.depts.find((x) => x.kind === 'lend');
  if (!d) return;
  const pick = d.named.pick, rateBy = d.named.rate, amountBy = d.named.amount;
  const rows = [];
  for (const id of NPC.companies) {
    if (id === 'tenesice') continue;
    const s = ctx.corp.co[id];
    if (!s || s.dead) continue;
    const monthly = Math.max(1, (s.n * s.unit + s.budget.place + s.budget.rd + s.budget.ads + s.budget.other) / 12);
    const eq = (s.bal.capital || 0) + (s.bal.reserve || 0) + (s.bal.retained || 0);
    const debt = (s.loans || []).reduce((n, l) => n + l.amt, 0);
    const lossy = CORP.plOf(s.per.y || {}).op < 0;
    const health = Math.max(0, Math.min(1, (eq / Math.max(1, eq + debt)) * 0.7 + Math.min(1, (s.bal.cash || 0) / monthly / 6) * 0.3 - (lossy ? 0.2 : 0)));
    const strict = pick >= 0 ? tr(P, pick, T.consc) : 0.5;
    // its rank by its health (A; B under `below`; C, at 10%, under its own), and its rate in the rank's band (never
    // under its floor, however kind the 金利決定担当)
    const R = CORP.ranks, rank = health < R.C.below ? 'C' : health < R.B.below ? 'B' : 'A';
    const [lo, hi] = R[rank].rate, within = rank === 'A' ? health : rank === 'B' ? (health - R.C.below) / (R.B.below - R.C.below) : 0;
    let rate = Math.round(Math.max(lo, Math.min(hi, hi - (hi - lo) * within + (rank === 'A' && health < 0.3 ? 0.01 * (1 + strict) : 0) + (rateBy >= 0 ? (0.5 - tr(P, rateBy, T.agree)) * 0.002 : 0))) * 10000) / 10000;
    let cap = Math.round(Math.max(monthly * 6, eq * (0.2 + 0.6 * health) * (amountBy >= 0 ? 0.8 + 0.4 * tr(P, amountBy, T.risk) : 1)) / 1e7) * 1e7;
    // (MY WAY: its pace frightens the bank — 15% a year whatever its rank, and no more than half its equity)
    if (s.ip) { rate = CORP.myway.loanRate; cap = Math.round(Math.max(0, eq) * CORP.myway.line / 1e7) * 1e7; }
    rows.push({ id, name: CORP.company(id).name, health: Math.round(health * 100), rank, rate, cap, debt });
    W.corpOps.push({ company: id, kind: 'lend', rate, cap, rank });
  }
  if ((day + 4) % 28 === 3 || !W.lendLog) {
    W.meetings.push({ id: ++o.seq, company: 'tenesice', day, room: '融資審査室', title: '融資審査会議（各社の与信と条件）', kind: 'lending', by: pick,
      attendees: [[pick, '融資先選定担当'], [rateBy, '金利決定担当'], [amountBy, '融資額決定担当'], [d.head, '融資本部長']].filter(([i]) => i >= 0).map(([i, role]) => ({ i, role, name: W.card(i, day).name })),
      lines: rows.map((x) => ({ i: pick, role: x.name, stance: x.health > 50 ? 'for' : 'neutral', name: '', text: `与信${x.health}点（ランク${x.rank}）／金利 年${(x.rate * 100).toFixed(2)}%／融資枠${NPC.money(x.cap)}${x.debt ? `（残高${NPC.money(x.debt)}）` : ''}` })), yes: 1, no: 0, veto: null, pass: true });
    W.lendLog = day;
  }
}

/* ---------------------------------------------------------------- new businesses --- */
// the business a company's 新事業 people would start: the one with the most people it suits that it does not run yet
function pickVenture(W, o, r) {
  const list = NPC.ventures[o.id] || [];
  const running = new Set(o.ventures.filter((v) => v.stage !== 'closed').map((v) => v.type));
  const out = list.filter((v) => !running.has(v.id)).map((v) => {
    const market = W.segment[v.fit] || 0;
    return { ...v, market, score: market * (v.fee || v.use / 4) * (1 - v.cost) * (0.7 + 0.6 * r.u()) };
  }).sort((a, b) => b.score - a.score)[0];
  if (!out) return null;
  out.launch = Math.round(out.staff * 12 * 6000000 * 0.25 + 50000000);
  return out;
}
export function startVenture(W, o, type, day, r) {
  const P = W.P, spec = (NPC.ventures[o.id] || []).find((v) => v.id === type);
  if (!spec) return;
  const slot = freeSlot(W);
  if (slot < 0) return;
  // its people: moved from the company's biggest departments, its lead the 新事業 department's planner
  const vd = o.depts.find((d) => d.kind === 'venture');
  const di = o.depts.indexOf(vd);
  const want = Math.max(3, Math.round(spec.staff * 1.5 * W.scale * 10));
  const staff = W.staffOf(o.id).filter((i) => P.rank[i] <= 1 && !(P.flags[i] & FL.exec) && P.dept[i] !== di).sort((a, b) => skillFor(P, b, o.id) - skillFor(P, a, o.id)).slice(0, want);
  for (const i of staff) { if (o.depts[P.dept[i]]) o.depts[P.dept[i]].size = Math.max(0, o.depts[P.dept[i]].size - 1); P.dept[i] = di; }
  if (vd) vd.size += staff.length;
  const lead = vd && vd.named.scout >= 0 ? vd.named.scout : staff[0];
  const v = { id: `${o.id}-${type}-${day}`, slot, company: o.id, type, name: spec.name, fee: spec.fee || 0, use: spec.use || 0, cost: spec.cost, fit: spec.fit, start: day, stage: 'trial',
    staff, lead, customers: 0, uses: 0, month: { rev: 0, cost: 0 }, total: { rev: 0, cost: 0 }, months: [], reports: [], quality: 0.5, launch: Math.round(spec.staff * 12 * 6000000 * 0.25 + 50000000), log: [] };
  o.ventures.push(v);
  // the launch: what it costs (fitting out, the first advertising) — the company's, to the local businesses
  W.charge(o.id, null, 'ventureLaunch', v.launch);
  v.total.cost += v.launch;
  v.log.push({ day, text: `事業開始。担当${staff.length}人、立ち上げ費用${NPC.money(v.launch)}。` });
  W.news.push({ day, kind: 'venture', district: -1, text: `${o.name}が新事業「${spec.name}」を開始`, data: { venture: v.id } });
  if (lead >= 0) { P.flags[lead] |= FL.famous; remember(P, lead, day, M.promoted, 160); }
  W.ai.push({ kind: 'venture', venture: v.id, company: o.id, day });
}
function freeSlot(W) {
  const used = new Set();
  for (const o of Object.values(W.orgs)) for (const v of o.ventures) if (v.stage !== 'closed') used.add(v.slot);
  for (let k = 0; k < 32; k++) if (!used.has(k)) return k;
  return -1;
}
// The new businesses' people each day: who they reach (word of mouth among those it suits: new customers by the Bass
// model, more for a business that serves them well), who leaves; a fee business bills its customers each month (in
// npc-state's month), a pay-as-you-go one when they use it (W.ventureUse); its costs go out as it serves.
function ventureMonth(W, day, r, ctx) {
  const P = W.P, t = CORP.ymd(day);
  for (const o of Object.values(W.orgs)) for (const v of o.ventures) {
    if (v.stage === 'closed') continue;
    const bit = 1 << v.slot;
    const staffOk = Math.min(1.2, v.staff.length / Math.max(1, (v.customers / 1000) * (NPC.ventures[o.id].find((x) => x.id === v.type) || { staff: 5 }).staff * W.scale + 2));
    v.quality = Math.max(0.1, Math.min(1, v.quality + (0.5 * staffOk + 0.25 - v.quality) * 0.05));
    const potential = W.segment[v.fit] || 0;
    const share = potential ? v.customers / potential : 0;
    const price = W.priceIdx[o.id + ':v:' + v.type] || 1;
    const want = (0.0015 + 0.04 * share) * Math.max(0, potential - v.customers) * v.quality * (v.stage === 'grow' ? 1.6 : v.stage === 'shrink' ? 0.4 : 1) / Math.pow(price, 1.5);
    const newOnes = Math.floor(want) + (r.u() < want % 1 ? 1 : 0);
    for (let s = 0, got = 0; s < newOnes * 6 && got < newOnes; s++) {
      const i = r.int(P.n);
      if (P.subs[i] & bit || !fits(W, i, v.fit, day)) continue;
      P.subs[i] |= bit;
      v.customers++;
      got++;
    }
    // churn: a little each day, more when it serves them badly (each customer by that chance: found by looking through
    // everyone, not by luck — a few customers among many would hardly ever be met)
    const rate = 0.004 + 0.01 * (1 - v.quality);
    if (v.customers > 0) for (let i = 0; i < P.n; i++) {
      if (!(P.subs[i] & bit) || r.u() >= rate) continue;
      P.subs[i] &= ~bit;
      v.customers--;
    }
    // the month's fee from each customer (on the 1st)
    if (t.d === 1 && v.fee) {
      let got = 0;
      for (let i = 0; i < P.n; i++) {
        if (!(P.subs[i] & bit)) continue;
        const n = Math.round(v.fee * price);
        if (econ.buy(W, i, day, o.id, 'ventures', n, false)) got += n;
        else { P.subs[i] &= ~bit; v.customers--; }
      }
      v.month.rev += got;
      v.total.rev += got;
      const cost = Math.round(got * v.cost);
      W.charge(o.id, null, 'ventureCost', cost);
      v.month.cost += cost;
      v.total.cost += cost;
    }
  }
}
// a customer of a pay-as-you-go business uses it
export function ventureUse(W, i, day, r) {
  const P = W.P;
  if (!P.subs[i]) return;
  for (const o of Object.values(W.orgs)) for (const v of o.ventures) {
    if (v.stage === 'closed' || !v.use || !(P.subs[i] & (1 << v.slot))) continue;
    const n = Math.round(v.use * (W.priceIdx[o.id + ':v:' + v.type] || 1) * (0.7 + 0.6 * r.u()));
    if (!econ.buy(W, i, day, o.id, 'ventures', n, false)) continue;
    v.uses++;
    v.month.rev += n;
    v.total.rev += n;
    const cost = Math.round(n * v.cost);
    W.charge(o.id, null, 'ventureCost', cost);
    v.month.cost += cost;
    v.total.cost += cost;
    P.need[i * 9] = clampB(P.need[i * 9] + 25);
    return;
  }
}
function fits(W, i, fit, day) {
  const P = W.P, age = ageOf(P, i, day), cash = P.cash[i];
  switch (fit) {
    case 'saver': return cash > 80000000 && P.tr[i * NT + T.thrift] > 120;
    case 'rich': return cash > 600000000;
    case 'family': return P.spouse[i] >= 0 && age >= 28 && age <= 60;
    case 'young': return age < 32;
    case 'ambitious': return P.tr[i * NT + T.ambition] > 170 && age < 50;
    case 'carless': return !P.car[i] && age >= 20 && age < 70;
    case 'car': return !!P.car[i];
    case 'busy': return NPC.isCompanyJob(P.job[i]) || P.job[i] === NPC.job.civil || P.job[i] === NPC.job.other;
    case 'social': return P.tr[i * NT + T.extra] > 140;
    case 'seeker': return P.job[i] === NPC.job.none || P.jsat[i] < 90;
    case 'gamer': return P.tr[i * NT + T.game] > 160;
    default: return true;
  }
}
export function segments(W, day) {
  const P = W.P, out = {};
  const kinds = ['saver', 'rich', 'family', 'young', 'ambitious', 'carless', 'car', 'busy', 'social', 'seeker', 'gamer'];
  for (const k of kinds) out[k] = 0;
  for (let i = 0; i < P.n; i += 4) for (const k of kinds) if (fits(W, i, k, day)) out[k] += 4;
  W.segment = out;
}
// The month's review of each business (on the 2nd): its numbers, its customers' trend, its people's say; grown when it
// earns and grows, cut back when it loses, closed when it loses for long (its people back to the company), and a
// report of it all.
export function ventureReview(W, o, s, day, r, ctx) {
  const P = W.P;
  for (const v of o.ventures) {
    if (v.stage === 'closed') continue;
    // its people's pay is its cost too (their share of the company's)
    const pay = v.staff.reduce((n, i) => n + (P.salary[i] || 0), 0) / 12;
    v.month.pay = Math.round(pay);
    v.total.cost += Math.round(pay);
    const row = { day, rev: v.month.rev, cost: v.month.cost + Math.round(pay), customers: v.customers, uses: v.uses, staff: v.staff.length, quality: Math.round(v.quality * 100) };
    v.months.push(row);
    if (v.months.length > 36) v.months.shift();
    const age = v.months.length, profit = row.rev - row.cost;
    const prev = v.months.length > 1 ? v.months[v.months.length - 2] : null;
    const growing = prev ? row.customers > prev.customers * 1.03 : true;
    const lost = v.total.rev - v.total.cost;
    let action = 'keep';
    const lead = v.lead;
    const bold = lead >= 0 ? tr(P, lead, T.risk) : 0.5;
    if (age >= 4 && profit > row.rev * 0.1 && growing) action = 'grow';
    else if (age >= 6 && lost < -v.launch * (2 + bold * 2) && !growing) action = 'close';
    else if (age >= 3 && profit < 0 && !growing) action = 'shrink';
    const was = v.stage;
    if (action === 'grow') {
      v.stage = 'grow';
      const more = W.staffOf(o.id).filter((i) => P.rank[i] === 0 && !v.staff.includes(i)).slice(0, Math.max(1, Math.round(v.staff.length * 0.3)));
      const di = o.depts.findIndex((d) => d.kind === 'venture');
      for (const i of more) { if (o.depts[P.dept[i]]) o.depts[P.dept[i]].size = Math.max(0, o.depts[P.dept[i]].size - 1); P.dept[i] = di; v.staff.push(i); }
      if (o.depts[di]) o.depts[di].size += more.length;
      W.charge(o.id, null, 'ventureCost', Math.round(v.launch * 0.3));
      v.total.cost += Math.round(v.launch * 0.3);
    } else if (action === 'shrink') {
      v.stage = 'shrink';
      const back = v.staff.splice(Math.max(1, Math.round(v.staff.length * 0.7)));
      for (const i of back) P.dept[i] = W.org.deptFor(o.id, r);
    } else if (action === 'close') {
      v.stage = 'closed';
      v.closed = day;
      for (const i of v.staff) P.dept[i] = W.org.deptFor(o.id, r);
      const bit = ~(1 << v.slot);
      for (let i = 0; i < P.n; i++) P.subs[i] &= bit;
      v.customers = 0;
      W.news.push({ day, kind: 'venture', district: -1, text: `${o.name}が新事業「${v.name}」から撤退（累計損益${NPC.money(lost)}）`, data: { venture: v.id } });
    } else if (v.stage === 'trial' && age >= 3) v.stage = 'run';
    if (was !== v.stage && v.stage === 'grow') W.news.push({ day, kind: 'venture', district: -1, text: `${o.name}の「${v.name}」が好調、事業を拡大（顧客${v.customers}人）`, data: { venture: v.id } });
    v.reports.push({ day, action, text: text.venture(o, v, row, action, lost) });
    if (v.reports.length > 24) v.reports.shift();
    v.log.push({ day, text: text.ventureThought(o, v, row, action) });
    if (v.log.length > 40) v.log.shift();
    W.reports.push({ company: o.id, kind: 'venture', day, by: v.lead, title: `${v.name} 月次レポート`, data: { venture: v.id, ...row, stage: v.stage, total: v.total }, text: v.reports[v.reports.length - 1].text });
    v.month = { rev: 0, cost: 0 };
    v.uses = 0;
  }
}
