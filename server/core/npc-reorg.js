// 人口の再編 (docs/npc-rooms-plan.md 8章): once, a country kept from before brought under the new rules (NPC.life2).
// Those beyond them (62 and over) are gone from it with all they were, and its people brought down to NPC.reorg's —
// whole households kept, the companies' executives, the mayors and the unions' reps first —, アスカ国's to twice
// ヴェルノア's. What leaves with them (their money: what they owed paid of it first, the rest the bank's loss), and the
// countries' own money cut as their people are, is told to the money ledger once (W.ledger.out); their shares stay
// in the country, shared out among those who hold the same; the people are renumbered, every reference to them with
// them. The companies and the countries' economies are made smaller as NPC.reorg says (their plans for people, their
// budgets), the five companies whose people were cut to their new numbers.
import { NPC, CORP, LOCAL } from './rules.js';
import { alloc, COLUMNS, ageOf, leaveHousehold, FL, REL, LISTED, HOME } from './npc-pop.js';
import * as econ from './npc-econ.js';
import * as asukaModel from './asuka.js';
import { passHome, richestOf, owners, rentFor } from './npc-state.js';

// the richest of those staying
function richestStaying(P, keep) {
  let top = -1;
  for (let i = 0; i < P.n; i++) if (keep[i] && (top < 0 || P.cash[i] > P.cash[top])) top = i;
  return Math.max(0, top);
}

const L = NPC.life2;

// the people of 18 to 61 (the new rules' ages)
const fits = (age) => age >= L.adult && age < L.max;
function shuffle(list, r) {
  for (let k = list.length - 1; k > 0; k--) { const j = r.int(k + 1); const t = list[k]; list[k] = list[j]; list[j] = t; }
  return list;
}

/* ------------------------------------------------------------ who stays --- */
// `n` of those who fit, by whole households: those with an executive, a mayor or a union's rep first, the rest in a
// random order (so the ages, the districts and the rich and the poor keep their shape); the last places one by one
export function chooseKeep(W, day, n, r) {
  const P = W.P, keep = new Uint8Array(P.n), groups = new Map();
  for (let i = 0; i < P.n; i++) {
    if (!fits(ageOf(P, i, day))) continue;
    const h = P.hh[i] >= 0 ? P.hh[i] : i;
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h).push(i);
  }
  const must = [], rest = [];
  for (const g of groups.values()) (g.some((i) => P.flags[i] & (FL.exec | FL.mayor | FL.unionRep)) ? must : rest).push(g);
  shuffle(rest, r);
  let k = 0;
  for (const g of must.concat(rest)) { if (k >= n) break; if (k + g.length <= n) { for (const i of g) keep[i] = 1; k += g.length; } }
  for (const g of rest) for (const i of g) { if (k >= n) break; if (!keep[i]) { keep[i] = 1; k++; } }
  return keep;
}

/* ------------------------------------------------------------ the money --- */
// one leaving: what they owed paid of what they had (the rest the bank's loss, as at a death: npc-state.js die), the
// slots' tokens changed back first; what is left leaves with them. Returns it.
function settle(W, i, day) {
  const P = W.P;
  if (P.tokens[i] > 0) { P.cash[i] += P.tokens[i]; P.tokens[i] = 0; }
  if (P.cash[i] < 0) { P.debt[i] += -P.cash[i]; W.sum.lent += -P.cash[i]; P.cash[i] = 0; }
  if (P.debt[i] > 0) {
    const back = Math.min(P.debt[i], P.cash[i]);
    P.cash[i] -= back;
    W.sum.repaid += back;
    const lost = P.debt[i] - back;
    if (lost > 0) { econ.toBank(W, day, 'credit', lost); W.sum.lent -= lost; W.sum.toCo -= lost; }
    P.debt[i] = 0;
    P.dkind[i] = 0;
  }
  const out = P.cash[i];
  P.cash[i] = 0;
  return out;
}
// the shares of those leaving, to those staying who hold the same (by what they hold, a share at a time: the largest
// remainders first), else to the richest staying
function shareOut(W, keep) {
  const P = W.P, top = richestStaying(P, keep);
  for (let k = 0; k < LISTED; k++) {
    let gone = 0, held = 0;
    for (let i = 0; i < P.n; i++) { const s = Math.max(0, P.sh[i * LISTED + k]); if (!s) continue; if (keep[i]) held += s; else { gone += s; P.sh[i * LISTED + k] = 0; } }
    if (!gone) continue;
    if (!held) { P.sh[top * LISTED + k] += gone; continue; }
    const parts = [];
    let given = 0;
    for (let i = 0; i < P.n; i++) {
      const s = keep[i] ? Math.max(0, P.sh[i * LISTED + k]) : 0;
      if (!s) continue;
      const x = gone * s / held, g = Math.floor(x);
      P.sh[i * LISTED + k] += g;
      given += g;
      parts.push([i, x - g]);
    }
    parts.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    for (let x = 0; given < gone; x = (x + 1) % parts.length) { P.sh[parts[x][0] * LISTED + k]++; given++; }
  }
  return top;
}
// the countries' own money cut as their people are: what it held beyond `ratio` of it leaves (Returns it.)
const cut = (x, ratio) => (x > 0 ? x - Math.round(x * ratio) : 0);

/* ------------------------------------------------------------ the remap --- */
// every reference to a person in the world's records, renumbered by `re` (−1: gone)
const ONE = new Set(['i', 'j', 'by', 'lead', 'leader', 'head', 'judge', 'host', 'parent']);
const MANY = new Set(['people', 'staff', 'who', 'members']);
function remapLog(x, re, depth = 0) {
  if (!x || typeof x !== 'object' || depth > 6) return;
  if (Array.isArray(x)) { for (const y of x) remapLog(y, re, depth + 1); return; }
  for (const [k, v] of Object.entries(x)) {
    if (ONE.has(k) && typeof v === 'number' && Number.isInteger(v) && v >= 0) x[k] = re(v);
    else if (MANY.has(k) && Array.isArray(v) && v.every((y) => typeof y === 'number')) x[k] = v.map(re).filter((y) => y >= 0);
    else if (v && typeof v === 'object') remapLog(v, re, depth + 1);
  }
}
const rekey = (obj, re) => { if (!obj) return obj; const out = {}; for (const [k, v] of Object.entries(obj)) { const j = re(Number(k)); if (j >= 0) out[j] = v; } return out; };
function remapWorld(W, re) {
  for (const o of Object.values(W.orgs || {})) {
    o.ceo = re(o.ceo); o.president = re(o.president);
    o.officers = (o.officers || []).map(re).filter((x) => x >= 0);
    for (const d of o.depts || []) {
      d.head = re(d.head);
      d.managers = (d.managers || []).map(re).filter((x) => x >= 0);
      for (const k of Object.keys(d.named || {})) d.named[k] = re(d.named[k]);
    }
    for (const l of o.labs || []) l.head = re(l.head);
    for (const v of o.ventures || []) { v.staff = (v.staff || []).map(re).filter((x) => x >= 0); v.lead = re(v.lead); if (v.lead < 0 && v.staff.length) v.lead = v.staff[0]; }
    o.think = (o.think || []).filter((t) => re(t.i) >= 0).map((t) => ({ ...t, i: re(t.i) }));
  }
  for (const d of W.districts || []) d.mayor = re(d.mayor);
  if (W.pol) {
    if (W.pol.campaign) W.pol.campaign.cands = W.pol.campaign.cands.filter((c) => re(c.i) >= 0).map((c) => ({ ...c, i: re(c.i) }));
    for (const p of W.pol.petitions || []) { p.leader = re(p.leader); if (p.leader < 0 && p.state === 'open') p.state = 'closed'; }
    remapLog(W.pol.council, re);
    remapLog(W.pol.elections, re);
  }
  for (const u of Object.values((W.lab && W.lab.unions) || {})) u.rep = re(u.rep);
  const m = W.marketState;
  if (m) {
    for (const b of Object.values(m.book || {})) {
      b.buy = b.buy.filter((o) => re(o[0]) >= 0).map((o) => { const x = o.slice(); x[0] = re(o[0]); return x; });
      b.sell = b.sell.filter((o) => re(o[0]) >= 0).map((o) => { const x = o.slice(); x[0] = re(o[0]); return x; });
    }
    for (const id of Object.keys(m.cost || {})) m.cost[id] = rekey(m.cost[id], re);
  }
  for (const list of Object.values(W.priv || {})) for (const h of list) h[0] = re(h[0]);
  if (W.alpha) {
    const G = W.alpha;
    G.members = G.members.filter((x) => re(x.i) >= 0).map((x) => ({ ...x, i: re(x.i) }));
    for (const k of ['pos', 'cost', 'put', 'got']) G[k] = rekey(G[k], re);
    remapLog(G.out, re);
    if (G.today) { remapLog(G.today, re); for (const o of G.today.orders || []) if (o.by) o.by = rekey(o.by, re); }
  }
  if (W.eliteAi) { W.eliteAi.next = rekey(W.eliteAi.next, re); W.eliteAi.last = rekey(W.eliteAi.last, re); }
  if (W.poorest && W.poorest.who) W.poorest.who = W.poorest.who.map(re).filter((x) => x >= 0);
  if (W.hosp) {
    for (const wr of W.hosp.wards || []) if (wr && wr.queue) wr.queue = wr.queue.filter((q) => re(q.i) >= 0).map((q) => ({ ...q, i: re(q.i) }));
    if (W.hosp.crit) W.hosp.crit = new Set([...W.hosp.crit].map(re).filter((x) => x >= 0));
  }
  for (const k of ['events', 'reasons', 'convos', 'ai', 'meetings', 'reports', 'corpOps', 'news']) remapLog(W[k], re);
  // (a record about someone gone is of no one now)
  for (const k of ['events', 'reasons', 'convos', 'ai']) if (Array.isArray(W[k])) W[k] = W[k].filter((e) => !('i' in e) || e.i >= 0);
}

/* ------------------------------------------------------------ ヴェルノア --- */
function vernoa(W, w, day, n, r) {
  const P = W.P, keep = chooseKeep(W, day, n, r), from = P.n;
  let out = 0;
  // the holdings of those leaving: the shares to those who hold the same, a private holding to the richest staying
  const top = shareOut(W, keep);
  for (const list of Object.values(W.priv || {})) for (const h of list) if (!keep[h[0]]) h[0] = top;
  // their places: at work (a successor from those staying), in office (a by-election), in a union (another rep)
  W._staff = {};
  for (const c of NPC.companies) W._staff[c] = [];
  for (let i = 0; i < P.n; i++) { const c = NPC.companyOf(P.job[i]); if (c && keep[i]) W._staff[c].push(i); }
  for (let i = 0; i < P.n; i++) {
    if (keep[i]) continue;
    const id = NPC.companyOf(P.job[i]);
    if (id && P.flags[i] & FL.union && W.lab && W.lab.unions[id]) W.lab.unions[id].members = Math.max(0, W.lab.unions[id].members - 1);
    if (id) W.org.vacate(W, i, day);
  }
  W._staff = null;
  W.districts.forEach((d, k) => {
    if (d.mayor < 0 || keep[d.mayor]) return;
    d.mayor = -1;
    const po = W.pol || (W.pol = {});
    (po.byElection || (po.byElection = [])).push({ district: k, day: day + 30 });
    W.news.push({ day, kind: 'politics', district: k, text: `${d.name}の区長が国を離れ、30日後に補欠選挙`, data: {} });
  });
  for (const u of Object.values((W.lab && W.lab.unions) || {})) if (u.rep >= 0 && !keep[u.rep]) u.rep = -1;
  // their homes and families: the home passed on, the household left; a spouse alone, a guest of theirs back to renting
  for (let i = 0; i < P.n; i++) {
    if (keep[i]) continue;
    out += settle(W, i, day);
    passHome(W, i);
    leaveHousehold(P, i);
  }
  for (let i = 0; i < P.n; i++) {
    if (!keep[i]) continue;
    if (P.spouse[i] >= 0 && !keep[P.spouse[i]]) P.spouse[i] = -1;
    if (P.host[i] >= 0 && !keep[P.host[i]]) { P.host[i] = -1; P.stay[i] = 0; P.home[i] = HOME.rent; P.rent[i] = rentFor(W, P.dist[i]); if (P.hh[i] < 0) { P.hh[i] = i; P.hnext[i] = -1; } }
  }
  // the renumbering: those staying in their order, and their columns copied over
  const map = new Int32Array(from).fill(-1);
  let k = 0;
  for (let i = 0; i < from; i++) if (keep[i]) map[i] = k++;
  const re = (i) => (Number.isInteger(i) && i >= 0 && i < from ? map[i] : -1);
  const Q = alloc(k);
  for (const c of COLUMNS) {
    const src = P[c.name], dst = Q[c.name], wd = c.width;
    for (let i = 0; i < from; i++) if (map[i] >= 0) dst.set(src.subarray(i * wd, i * wd + wd), map[i] * wd);
  }
  for (let x = 0; x < k; x++) {
    Q.hh[x] = re(Q.hh[x]); Q.hnext[x] = re(Q.hnext[x]); Q.spouse[x] = re(Q.spouse[x]); Q.host[x] = re(Q.host[x]);
    for (let y = x * REL; y < x * REL + REL; y++) { const j = re(Q.rel[y]); Q.rel[y] = j; if (j < 0) { Q.close[y] = 0; Q.rtrust[y] = 0; } }
  }
  W.P = Q;
  W.n = k;
  W._roster = null;
  remapWorld(W, re);
  W._staff = null;
  // the new rules for those staying: nobody studies or keeps house (they look for work), nobody works after 60
  for (let i = 0; i < k; i++) {
    if (Q.job[i] === NPC.job.student || Q.job[i] === NPC.job.home) { Q.job[i] = NPC.job.none; Q.flags[i] &= ~FL.student; }
    if (ageOf(Q, i, day) >= L.retire && NPC.working(Q.job[i])) W.labor.leave(W, i, day, 'retire');
    Q.flags[i] &= ~FL.rehired;
  }
  W._staff = null;
  W.richest = richestOf(Q);
  owners(W);
  return { from, to: k, out };
}

/* ------------------------------------------------------------ アスカ国 --- */
function asuka(W, day, n, r) {
  const a = W.asuka, A = W.AP;
  if (!a || !A) return { from: 0, to: 0, out: 0 };
  const from = A.n, list = [];
  for (let i = 0; i < from; i++) if (fits(asukaModel.ageOf(A, i, day))) list.push(i);
  shuffle(list, r);
  const keep = new Uint8Array(from);
  for (let x = 0; x < Math.min(n, list.length); x++) keep[list[x]] = 1;
  let out = 0;
  for (let i = 0; i < from; i++) {
    if (keep[i]) continue;
    // (what they owed paid of what they had, the rest the national bank's loss — as at a death: asuka.js die)
    let cash = Math.max(0, A.cash[i]);
    const back = Math.min(A.debt[i], cash);
    cash -= back; a.bank.own += back; a.bank.lent -= back;
    if (A.debt[i] > back) a.bank.lent -= A.debt[i] - back;
    // (a cash below nothing: a shortfall nobody lent, gone with them as the debt is)
    out += cash + Math.min(0, A.cash[i]);
  }
  const map = new Int32Array(from).fill(-1);
  let k = 0;
  for (let i = 0; i < from; i++) if (keep[i]) map[i] = k++;
  const B = asukaModel.alloc(k);
  for (const name of Object.keys(B)) {
    if (name === 'n') continue;
    const src = A[name], dst = B[name], wd = src.length / from;
    for (let i = 0; i < from; i++) if (map[i] >= 0) dst.set(src.subarray(i * wd, i * wd + wd), map[i] * wd);
  }
  W.AP = B;
  a.n = k;
  // (the new rules: nobody studies, nobody works after 60)
  const J = asukaModel.JOB;
  for (let i = 0; i < k; i++) {
    if (B.job[i] === J.student) B.job[i] = J.none;
    if (asukaModel.ageOf(B, i, day) >= L.retire && B.job[i] !== J.retired) { B.job[i] = J.retired; B.pay[i] = 0; }
  }
  return { from, to: k, out };
}

/* ------------------------------------------------------------ the economies --- */
// the companies made smaller with the country (their plans for people and their budgets, as a smaller country's are
// from its start: corp-model.js startCirculation), the five cut to their new numbers; the local companies', the
// research facilities' and the country's posts by the new size
function economy(W, w, f) {
  W.scale = (W.scale || 1) * f;
  if (w && w.circ) w.circ.scale = (w.circ.scale || 1) * f;
  for (const s of Object.values((w && w.co) || {})) {
    if (s.dead || (s.scale && s.scale.export) || !CORP.company(s.id)) continue;
    s.target = Math.max(1, Math.round(NPC.reorg.staff[s.id] !== undefined ? NPC.reorg.staff[s.id] * W.scale : (s.target || s.n) * f));
    for (const k of ['place', 'rd', 'ads', 'other', 'capex']) if (s.budget && s.budget[k]) s.budget[k] = Math.round(s.budget[k] * f);
    s.backingScale = (s.backingScale || 1) * f;
  }
  if (W.locals) for (const fm of LOCAL.firms) { const c = W.locals.firms[fm.id]; if (c && !c.dead) c.target = Math.max(1, Math.round(fm.staff * W.scale)); }
  if (W.research && W.research.vernoaSites) W.research.vernoaSites = W.research.vernoaSites.map(() => Math.max(1, Math.round(350 * W.scale)));
}
function asukaEconomy(W, f, people) {
  const a = W.asuka, A = W.AP;
  if (!a || !A) return;
  a.scale = (a.scale || 1) * f;
  // (the posts: the local trade's for its people, ATSUKA Vision's the rest of those of working age at work — at least
  // its least, by its size —, a few in a hundred looking for work)
  const day = W.day, work = (() => { let x = 0; for (let i = 0; i < A.n; i++) if (asukaModel.ageOf(A, i, day) < L.retire) x++; return x; })();
  const trade = Math.round(NPC.reorg.asukaTrade * people);
  let others = 0;
  for (let i = 0; i < A.n; i++) { const j = A.job[i]; if (j !== asukaModel.JOB.none && j !== asukaModel.JOB.atsuka && j !== asukaModel.JOB.trade && j !== asukaModel.JOB.retired && j !== asukaModel.JOB.student) others++; }
  const least = Math.round(NPC.reorg.atsukaLeast * a.scale / NPC.reorg.asukaEconomy);
  a.posts = { atsuka: Math.max(least, Math.round(work * (1 - NPC.reorg.jobless)) - others - trade), trade };
  if (W.research && W.research.asukaSites) W.research.asukaSites = W.research.asukaSites.map(() => Math.max(1, Math.round(350 * a.scale)));
  if (a.branches) asukaModel.branchesSet(W, a.branches);
}

/* ------------------------------------------------------------ the whole --- */
// The 人口再編 of a country kept from before (W.life2 not yet): returns what was done (null: nothing to do)
export function reorganize(W, w, day, r, opts = {}) {
  if (W.life2) return null;
  const R = NPC.reorg, v = Math.max(1, Math.round(opts.vernoa || R.vernoa)), aN = Math.round(v * R.ratio);
  const V = vernoa(W, w, day, Math.min(v, W.P.n), r);
  const A = asuka(W, day, aN, r);
  // the countries' own money as their people now are
  const rv = V.to / Math.max(1, V.from), ra = A.to / Math.max(1, A.from);
  let state = 0;
  for (const [o, k] of [[W.nation, 'cash'], [W.nation.fund, 'cash'], [W.sector, 'cash']]) { const x = cut(o[k], rv); o[k] -= x; state += x; }
  for (const d of W.districts) { const x = cut(d.cash, rv); d.cash -= x; state += x; }
  if (W.locals) for (const c of Object.values(W.locals.firms)) if (c.cash > 0) c.cash = Math.round(c.cash * rv);
  const a = W.asuka;
  if (a) {
    for (const [o, k] of [[a, 'treasury'], [a.atsuka, 'cash'], [a.bank, 'own'], [a.boost, 'cash'], [a.pension, 'cash'], [a.trade, 'cash']]) { const x = cut(o[k], ra); o[k] -= x; state += x; }
  }
  economy(W, w, opts.economy || R.economy);
  asukaEconomy(W, opts.asukaEconomy || R.asukaEconomy, A.to);
  const out = V.out + A.out + state;
  if (W.ledger) W.ledger.out = (W.ledger.out || 0) + out;
  W.life2 = true;
  W.reorg = { day, vernoa: [V.from, V.to], asuka: [A.from, A.to], people: V.out + A.out, state, out };
  W.news.push({ day, kind: 'nation', district: -1, text: `人口の再編：ヴェルノア${V.from.toLocaleString('en-US')}人→${V.to.toLocaleString('en-US')}人、アスカ国${A.from.toLocaleString('en-US')}人→${A.to.toLocaleString('en-US')}人。新しい暮らしの決まり（18歳から59歳まで全員が働き、60歳で引退、寿命は平均60歳・最長62歳）が始まりました`, data: { ...W.reorg } });
  return W.reorg;
}
