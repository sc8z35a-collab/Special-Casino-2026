// The people's politics (server/core/npc-model.js): each district's mayor (区長), elected for six months in April
// and October; the council of the five, which each month may move the country's knobs (the consumption tax among
// them) within what 運営 allows; what the people mind growing into talk, a petition, a march, a boycott, and with
// enough names a citizens' vote that changes a knob (or recalls a mayor). Only the people sign and vote: the players
// can watch, never take part.
import { NPC, CORP } from './rules.js';
import { T, FL, E, NT, REL, ageOf, remember, clampB } from './npc-pop.js';
import * as econ from './npc-econ.js';
import { M } from './npc-life.js';

const tr = (P, i, k) => P.tr[i * NT + k] / 255;
const THEME = Object.fromEntries(NPC.themes.map((t, k) => [t.id, k]));

export function createPolitics(W) {
  const po = W.pol || (W.pol = { petitions: [], votes: [], council: [], elections: [], marches: [], seq: 0 });
  return {
    get campaign() { return !!po.campaign; },
    // a person's time on it: for a candidate the campaign, for the rest a petition to sign or to start
    act(W, i, day, r) {
      const P = W.P;
      if (po.campaign && P.flags[i] & FL.candidate) { po.campaign.speeches = (po.campaign.speeches || 0) + 1; const c = po.campaign.cands.find((x) => x.i === i); if (c) c.reach += 40 + P.sk[i * 8 + 7] / 4; return; }
      for (const p of po.petitions) {
        if (p.state !== 'open') continue;
        if (p.scope !== 'national' && p.district !== P.dist[i]) continue;
        const bit = 1 << p.slot;
        if (P.sign[i] & bit) continue;
        if (P.disc[i * 8 + p.theme] > 110 - tr(P, i, T.justice) * 40) { P.sign[i] |= bit; p.count++; P.flags[i] |= FL.moving; }
        return;
      }
      // none for what they mind: maybe theirs
      startPetition(W, i, day, r);
    },
    march(W, i, day) { const m = po.marches.find((x) => x.day === day && x.district === W.P.dist[i]); if (m) m.people++; },
    spend: (W, k, day, r) => districtSpend(W, k, day, r),
    vacate(W, i, day) {
      W.districts.forEach((d, k) => { if (d.mayor === i) { d.mayor = -1; po.byElection = po.byElection || []; po.byElection.push({ district: k, day: day + 30 }); W.news.push(news(day, 'politics', k, `${d.name}の区長が亡くなり、30日後に補欠選挙`)); } });
    },
    day: (W, day, r) => politicsDay(W, day, r),
    first: (W, day, r) => { for (let k = 0; k < 5; k++) election(W, k, day, r, true); },
    state: po
  };
}

function news(day, kind, district, text, data) { return { day, kind, district, text, data: data || {} }; }

/* -------------------------------------------------------------- the calendar --- */
// the second Sunday of a month (the election and the votes are held on Sundays)
function secondSunday(y, m) { const d1 = CORP.dayAt(y, m, 1), w = (d1 + 4) % 7; return d1 + ((7 - w) % 7) + 7; }
function politicsDay(W, day, r) {
  const P = W.P, t = CORP.ymd(day), po = W.pol;
  // discontent: once a week, by what each has lived (taxes, prices, the pension, pay, the gap, MAGITA, Dtrade, the mayor)
  if ((day + 4) % 7 === 1) moods(W, day, r);
  // the elections: two weeks of campaign, the vote on the second Sunday of April and October
  for (const m of NPC.votes.months) {
    const vote = secondSunday(t.y, m);
    if (day === vote - NPC.votes.campaign) campaign(W, day, r);
    if (day === vote) for (let k = 0; k < 5; k++) election(W, k, day, r, false);
  }
  // (a by-election in a district whose regular one is under way is that one)
  for (const b of po.byElection || []) if (b.day === day && !(po.campaign && po.campaign.cands.some((c) => c.district === b.district) && NPC.votes.months.some((mm) => secondSunday(t.y, mm) >= day && secondSunday(t.y, mm) - day <= NPC.votes.campaign))) election(W, b.district, day, r, false, true);
  po.byElection = (po.byElection || []).filter((b) => b.day > day);
  // the council: on the 5th, the five mayors
  if (t.d === 5) council(W, day, r);
  // petitions: the names grow by word of mouth; enough of them in time, a vote two Sundays on
  petitions(W, day, r);
  for (const v of po.votes) if (v.day === day && v.state === 'set') referendum(W, v, day, r);
  // marches (on days off) and boycotts fade
  W.demoToday = {};
  for (const m of po.marches) if (m.day === day) W.demoToday[m.district] = true;
  for (const m of po.marches) if (m.day === day - 1 && !m.told) { m.told = true; W.news.push(news(day, 'march', m.district, `${NPC.districts[m.district].name}で「${m.title}」のデモ（${m.people}人）`, { people: m.people })); }
  po.marches = po.marches.filter((m) => m.day >= day - 7);
  for (const k of Object.keys(W.boycott)) { W.boycott[k] *= 0.97; if (W.boycott[k] < 0.05) delete W.boycott[k]; }
  // the knobs that change on the 1st
  if (t.d === 1) applyPending(W, day);
}

/* -------------------------------------------------------------- discontent --- */
function moods(W, day, r) {
  const P = W.P, k = W.nation.knobs;
  const gini = W.stats.gini || 0.6, prices = W.stats.prices || 1;
  const magita = (k.magitaSurcharge || 0) > 0 && W.surchargeOn ? 1 : 0;
  for (let i = 0; i < P.n; i++) {
    const age = ageOf(P, i, day), b = i * 8, poor = P.cash[i] < 20000000 ? 1 : 0;
    const drift = (x, target) => { P.disc[b + x] = clampB(P.disc[b + x] + (target - P.disc[b + x]) * 0.06 + r.z() * 3); };
    drift(0, 50 + (k.consumptionTax || 0) * 6 + (k.incomeShift || 0) * 8 + (k.residentTax - 10) * 8);
    drift(1, (age >= 55 ? 60 + (k.pensionLevel < 0 ? -k.pensionLevel * 8 : 0) + (W.nation.fund.cash + W.nation.fund.bonds < 0 ? 50 : 0) : 40) + (k.pensionRate - 18.3) * 10 + (W.nation.broke ? 90 : 0));
    drift(2, 45 + (prices - 1) * 300 + (k.consumptionTax || 0) * 7);
    drift(3, P.job[i] >= 1 && P.job[i] <= 14 ? 40 + (200 - P.jsat[i]) * 0.5 : P.job[i] === NPC.job.none ? 140 : 40);
    drift(4, 40 + (gini - 0.55) * 300 + poor * 50 + tr(P, i, T.justice) * 30);
    drift(5, magita && P.tr[i * NT + T.car] > 120 ? 150 : 45);
    drift(6, P.spun[i] || P.sh[i * 4] + P.sh[i * 4 + 1] + P.sh[i * 4 + 2] + P.sh[i * 4 + 3] > 0 ? 70 + ((6 - (k.winFee || 6)) < 0 ? 0 : (k.winFee || 6) * 6) : 35);
    drift(7, 160 - W.districts[P.dist[i]].approval * 1.4 + (W.nation.broke ? 40 : 0));
    P.emo[i * 5 + E.anger] = clampB(P.emo[i * 5 + E.anger] + (Math.max(...P.disc.subarray(b, b + 8)) - 150) * 0.05);
  }
}

/* ---------------------------------------------------------------- elections --- */
function campaign(W, day, r) {
  const P = W.P, po = W.pol;
  po.campaign = { from: day, to: day + NPC.votes.campaign, cands: [] };
  for (let k = 0; k < 5; k++) candidates(W, k, day, r);
  W.news.push(news(day, 'election', -1, `区長選挙の選挙運動が始まりました（投票は${NPC.votes.campaign}日後）`));
}
// those who stand: the ambitious, outgoing, well-thought-of who can run things (and the mayor again, if liked enough)
function candidates(W, k, day, r) {
  const P = W.P, po = W.pol, d = W.districts[k];
  const list = [];
  for (let s = 0; s < 400; s++) {
    const i = r.int(P.n);
    if (P.dist[i] !== k || P.flags[i] & (FL.candidate | FL.mayor)) continue;
    const age = ageOf(P, i, day);
    if (age < 30 || age > 78) continue;
    const score = tr(P, i, T.ambition) * 2 + tr(P, i, T.extra) + P.sk[i * 8 + 2] / 255 + P.sk[i * 8 + 7] / 255 + r.u() * 0.3;
    list.push([i, score]);
  }
  list.sort((a, b) => b[1] - a[1]);
  const n = 2 + r.int(2) - (d.mayor >= 0 && d.approval > 30 ? 1 : 0);
  const cands = list.slice(0, Math.max(1, n)).map(([i]) => i);
  if (d.mayor >= 0 && d.approval > 30) cands.unshift(d.mayor);
  // their promises: what the district minds most, by their own leaning
  const worst = districtWorries(W, k);
  for (const i of cands) {
    P.flags[i] |= FL.candidate | FL.famous;
    const plat = pickPlatform(W, i, worst, r);
    po.campaign.cands.push({ i, district: k, platform: plat, reach: 0, incumbent: i === d.mayor });
  }
}
function districtWorries(W, k) {
  const P = W.P, sum = new Float64Array(8);
  let n = 0;
  for (let i = 0; i < P.n; i += 7) if (P.dist[i] === k) { for (let x = 0; x < 8; x++) sum[x] += P.disc[i * 8 + x]; n++; }
  return Array.from(sum).map((v, x) => [x, v / Math.max(1, n)]).sort((a, b) => b[1] - a[1]);
}
function pickPlatform(W, i, worst, r) {
  const P = W.P, big = P.lean[i * 2] > 0;
  const want = worst.slice(0, 3).map(([x]) => NPC.themes[x].id);
  const fits = NPC.platforms.filter((p) => want.includes(p.fix) || (big ? ['welfare', 'works', 'rent'].includes(p.id) : ['taxcut', 'firms', 'shops'].includes(p.id)));
  const out = [];
  for (const p of (fits.length ? fits : NPC.platforms)) { if (out.length < 3 && r.u() < 0.7) out.push(p.id); }
  if (!out.length) out.push(r.pick(NPC.platforms).id);
  return out;
}
// The vote of a district: each person's own (whether to go: their interest, the weather of the day; for whom: what
// the promises do for what they mind, their leaning, the candidate's name, the mayor's record, their friends' word)
function election(W, k, day, r, first, by = false) {
  const P = W.P, po = W.pol, d = W.districts[k];
  if (first || !po.campaign) { if (!po.campaign) po.campaign = { from: day, to: day, cands: [] }; candidates(W, k, day, r); }
  else if (by && !po.campaign.cands.some((c) => c.district === k)) candidates(W, k, day, r);
  const cands = po.campaign.cands.filter((c) => c.district === k);
  if (!cands.length) return;
  const votes = new Float64Array(cands.length);
  const weather = 0.9 + 0.2 * r.u();
  let voters = 0, adults = 0;
  const pick = new Int8Array(P.n).fill(-1);
  for (let i = 0; i < P.n; i++) {
    if (P.dist[i] !== k) continue;
    adults++;
    const age = ageOf(P, i, day);
    const go = (0.28 + 0.35 * tr(P, i, T.news) + 0.2 * tr(P, i, T.justice) + Math.min(0.25, (age - 18) * 0.006)) * weather;
    if (r.u() > go) continue;
    voters++;
    let best = 0, bv = -Infinity;
    cands.forEach((c, x) => {
      let v = 0;
      for (const id of c.platform) { const pl = NPC.platforms.find((p) => p.id === id); const th = NPC.themes.findIndex((t) => t.id === pl.fix); v += P.disc[i * 8 + th] / 255; }
      v += 0.5 * (1 - Math.abs(P.lean[i * 2] - P.lean[c.i * 2]) / 127);
      v += 0.3 * (P.sk[c.i * 8 + 7] / 255) + c.reach / 2000;
      if (c.incumbent) v += (d.approval - 50) / 60;
      // (what friends will vote)
      for (let s = 0; s < REL; s += 3) { const j = P.rel[i * REL + s]; if (j >= 0 && pick[j] === x) v += 0.15 * P.rtrust[i * REL + s] / 255; }
      v += 0.35 * r.z();
      if (v > bv) { bv = v; best = x; }
    });
    votes[best]++;
    pick[i] = best;
    P.vote[i] = best + 1;
    remember(P, i, day, M.voted, 40);
  }
  let win = 0;
  for (let x = 1; x < votes.length; x++) if (votes[x] > votes[win]) win = x;
  const c = cands[win];
  if (d.mayor >= 0 && d.mayor !== c.i) P.flags[d.mayor] &= ~FL.mayor;
  d.mayor = c.i;
  d.mayorGen = P.gen[c.i];
  d.platform = c.platform;
  d.since = day;
  d.until = day + Math.round(NPC.votes.term * 30.44);
  d.approval = 55 + 10 * r.u();
  d.promises = c.platform.map((id) => ({ id, done: 0 }));
  P.flags[c.i] |= FL.mayor | FL.famous;
  P.flags[c.i] &= ~FL.candidate;
  remember(P, c.i, day, M.elected, 230);
  for (const o of cands) if (o !== c) { P.flags[o.i] &= ~FL.candidate; remember(P, o.i, day, M.lostElection, 180); }
  const row = { day, district: k, turnout: voters / Math.max(1, adults), cands: cands.map((x, n) => ({ i: x.i, name: W.card(x.i, day).name, votes: votes[n], platform: x.platform, incumbent: x.incumbent })), winner: c.i, first: !!first };
  po.elections.push(row);
  po.elections = po.elections.slice(-60);
  const share = votes[win] / Math.max(1, voters);
  W.news.push(news(day, 'election', k, `${d.name}の区長選：${W.card(c.i, day).name}氏が当選（得票率${Math.round(share * 100)}%・投票率${Math.round(row.turnout * 100)}%）`, { winner: c.i }));
  W.events.push({ kind: 'elected', i: c.i, district: k });
  W.ai.push({ kind: 'speech', i: c.i, district: k, platform: c.platform, day });
  if (po.campaign) {
    po.campaign.cands = po.campaign.cands.filter((x) => x.district !== k);
    if (!po.campaign.cands.length) po.campaign = null;
  }
}

/* ---------------------------------------------------------------- a district --- */
// the mayor's day: the district's money on the promises (the budget a 365th each day, the cushion kept), the mood and
// the approval following what was done
function districtSpend(W, k, day, r) {
  const P = W.P, d = W.districts[k];
  if (d.mayor < 0) return;
  const skill = P.sk[d.mayor * 8 + 2] / 255, honest = P.tr[d.mayor * NT + T.consc] / 255;
  const pot = Math.max(0, d.cash - W.cal.districtCushion) / 120;
  if (pot <= 0) return;
  // (a mayor less than honest lets some of it go astray; found out, it is a scandal)
  if (honest < 0.25 && r.u() < 0.002) { d.approval = Math.max(5, d.approval - 20); W.news.push(news(day, 'scandal', k, `${d.name}の区長に不正支出の疑い`)); }
  const each = pot / Math.max(1, d.platform.length);
  for (const id of d.platform) {
    const n = Math.round(each * (0.6 + 0.6 * skill));
    if (n <= 0) continue;
    if (id === 'works' || id === 'firms') {
      econ.districtOut(W, k, 'works', n);
      const co = NPC.districts[k].hq.length ? NPC.districts[k].hq[r.int(NPC.districts[k].hq.length)] : 'magita';
      econ.toStream(W, day, co, 'public', n);
    } else if (id === 'shops') {
      econ.districtOut(W, k, 'shops', n);
      econ.toStream(W, day, 'jinx', 'public', Math.round(n * 0.6));
      W.sector.cash += n - Math.round(n * 0.6); W.sector.inNation += n - Math.round(n * 0.6);
    } else if (id === 'welfare' || id === 'rent' || id === 'taxcut') {
      // to the district's people who most need it (the old, the jobless, the renters), a little each
      econ.districtOut(W, k, id, n);
      let left = n;
      for (let s = 0; s < 40 && left > 0; s++) {
        const i = r.int(P.n);
        if (P.dist[i] !== k) continue;
        const ok = id === 'welfare' ? (P.job[i] === NPC.job.none || P.job[i] === NPC.job.retired) : id === 'rent' ? P.home[i] === 0 : true;
        if (!ok) continue;
        const g = Math.min(left, Math.ceil(n / 20));
        P.cash[i] += g;
        left -= g;
      }
      W.sector.cash += left; W.sector.inNation += left;
    } else {
      // festivals and safety: the local businesses do them
      econ.districtOut(W, k, id, n);
      W.sector.cash += n; W.sector.inNation += n;
      if (id === 'festival' && r.u() < 0.01) W.news.push(news(day, 'festival', k, `${d.name}でお祭り（区の主催）`));
    }
    const pr = d.promises.find((p) => p.id === id);
    if (pr) pr.done += n;
  }
  d.approval = Math.max(3, Math.min(97, d.approval + (skill - 0.5) * 0.08 + (d.economy - 1) * 2 + r.z() * 0.3));
}

/* ---------------------------------------------------------------- the council --- */
// The five mayors on the 5th: each brings a change their district and their leaning want (a knob within its range,
// not changed this quarter, not locked by 運営), and each votes by their own district's good; three of five carry it,
// with deals between them (my vote for yours). From the 1st of the next month.
function council(W, day, r) {
  const P = W.P, po = W.pol, kn = W.nation.knobs;
  const ms = W.districts.map((d, k) => ({ k, i: d.mayor })).filter((x) => x.i >= 0);
  if (ms.length < 3) return;
  // (short of money, or last month spent well beyond what came in)
  const lm = W.nation.lastMonth || W.nation.month || {};
  const deficit = W.nation.cash < W.cal.nationFloor * 2 || (lm.out && sumOf(lm.out) > sumOf(lm.in || {}) * 1.1);
  const motions = [];
  for (const m of ms) {
    const [worry, how] = districtWorries(W, m.k)[0], theme = NPC.themes[worry].id;
    if (how < 115 && !deficit) continue;
    const big = P.lean[m.i * 2] > 0;
    let id = null, dir = 0;
    if (deficit && r.u() < 0.5) { id = big ? 'consumptionTax' : 'publicWorks'; dir = big ? 1 : -1; }
    else if (NPC.demands[theme]) { [id, dir] = NPC.demands[theme]; }
    else if (theme === 'mayor') { id = 'grants'; dir = 1; }
    if (!id) continue;
    const k = NPC.knob[id];
    if (!canChange(W, id, day)) continue;
    const to = clampKnob(W, id, kn[id] + dir * k.step * (1 + (r.u() < 0.3 ? 1 : 0)));
    if (to === kn[id]) continue;
    if (!motions.some((x) => x.id === id)) motions.push({ id, from: kn[id], to, by: m.i, district: m.k });
  }
  const minutes = [];
  for (const mo of motions.slice(0, 3)) {
    let yes = 0;
    const votes = [];
    for (const m of ms) {
      const worries = districtWorries(W, m.k).slice(0, 3).map(([x]) => NPC.themes[x].id);
      let v = m.i === mo.by ? 2 : 0;
      for (const w of worries) { const dm = NPC.demands[w]; if (dm && dm[0] === mo.id) v += Math.sign(mo.to - mo.from) === dm[1] ? 1 : -1; }
      v += (P.lean[m.i * 2] > 0 ? 0.3 : -0.3) * (['consumptionTax', 'welfare', 'jobless', 'pensionLevel', 'grants', 'publicWorks'].includes(mo.id) ? Math.sign(mo.to - mo.from) : 0);
      // (a deal: the one whose own motion this one backed backs it back)
      if (minutes.some((x) => x.by === m.i && x.votes.some((y) => y.i === mo.by && y.yes))) v += 0.8;
      v += 0.4 * r.z();
      votes.push({ i: m.i, district: m.k, yes: v > 0 });
      if (v > 0) yes++;
    }
    const pass = yes >= 3;
    const row = { day, ...mo, votes, pass, name: NPC.knob[mo.id].name };
    minutes.push(row);
    if (pass) schedule(W, mo.id, mo.to, day, 'council');
    W.news.push(news(day, 'council', -1, `街の議会：${NPC.knob[mo.id].name}を${fmtKnob(mo.id, mo.from)}→${fmtKnob(mo.id, mo.to)}にする案を${pass ? '可決' : '否決'}（賛成${yes}・反対${ms.length - yes}）`, { id: mo.id, pass }));
  }
  po.council.push({ day, minutes });
  po.council = po.council.slice(-36);
}
const sumOf = (o) => Object.values(o).reduce((a, b) => a + b, 0);
export function fmtKnob(id, v) { const k = NPC.knob[id]; return k.unit === '$' ? NPC.money(v) : k.unit === '%' || k.unit === 'pt' ? v + k.unit : v + k.unit; }
export function clampKnob(W, id, v) {
  const k = NPC.knob[id], range = (W.nation.ranges && W.nation.ranges[id]) || [k.min, k.max];
  return Math.round(Math.max(range[0], Math.min(range[1], v)) / k.step) * k.step;
}
// whether a knob may change now: not locked, not changed (or set to change) this quarter
export function canChange(W, id, day) {
  if (W.nation.locks && W.nation.locks[id]) return false;
  if (W.nation.pending.some((p) => p.id === id)) return false;
  const last = W.nation.changed[id];
  return !(last && CORP.quarterKey(last) === CORP.quarterKey(day));
}
export function schedule(W, id, to, day, by) {
  const t = CORP.ymd(day);
  const from = t.m === 12 ? CORP.dayAt(t.y + 1, 1, 1) : CORP.dayAt(t.y, t.m + 1, 1);
  W.nation.pending.push({ id, to, from, by, day });
  W.nation.changed[id] = day;
}
function applyPending(W, day) {
  const due = W.nation.pending.filter((p) => p.from <= day);
  W.nation.pending = W.nation.pending.filter((p) => p.from > day);
  for (const p of due) {
    if (W.nation.locks && W.nation.locks[p.id]) continue;
    const was = W.nation.knobs[p.id];
    W.nation.knobs[p.id] = clampKnob(W, p.id, p.to);
    if (W.knobChanged && was !== W.nation.knobs[p.id]) W.knobChanged(p.id, was, W.nation.knobs[p.id]);
    W.nation.log.push({ day, id: p.id, from: was, to: W.nation.knobs[p.id], by: p.by });
    W.news.push(news(day, 'knob', -1, `今日から${NPC.knob[p.id].name}が${fmtKnob(p.id, was)}→${fmtKnob(p.id, W.nation.knobs[p.id])}に（${p.by === 'vote' ? '市民投票' : p.by === 'ops' ? '運営' : '街の議会'}）`, { id: p.id }));
  }
  W.nation.log = W.nation.log.slice(-120);
}

/* ---------------------------------------------------------------- petitions --- */
// Someone who minds a theme most of all (and is outgoing, sure of what is right, known to many) starts a petition
// for what it asks; its names come by word of mouth; with a tenth of the country (a district's fifth; a third for a
// recall) in 60 days, a citizens' vote is held two weeks on.
function startPetition(W, i, day, r) {
  const P = W.P, po = W.pol;
  if (po.petitions.filter((p) => p.state === 'open').length >= 6) return;
  let theme = 0, most = 0;
  for (let x = 0; x < 8; x++) if (P.disc[i * 8 + x] > most) { most = P.disc[i * 8 + x]; theme = x; }
  if (most < 175 || tr(P, i, T.justice) < 0.55 || tr(P, i, T.extra) < 0.45) return;
  if (po.petitions.some((p) => p.state === 'open' && p.theme === theme && (p.scope === 'national' || p.district === P.dist[i]))) return;
  const id = NPC.themes[theme].id;
  let scope = 'national', knob = null, dir = 0;
  if (id === 'mayor') scope = 'recall';
  else if (NPC.demands[id]) [knob, dir] = NPC.demands[id];
  else return;
  if (knob && !canChange(W, knob, day)) return;
  const used = po.petitions.filter((p) => p.state === 'open' || p.state === 'won').map((p) => p.slot);
  let slot = 0;
  while (used.includes(slot) && slot < 31) slot++;
  const titles = { tax: '消費税を下げて', pension: '年金を上げて', prices: '物価をなんとかして', wages: '最低賃金を上げて', gap: 'お金持ちにもっと税を', magita: 'MAGITAの値上げを下げて', dtrade: 'Dtradeの手数料を下げて', mayor: `${W.districts[P.dist[i]].name}の区長にリコールを` };
  const p = { id: ++po.seq, slot, theme, knob, dir, scope, district: P.dist[i], leader: i, start: day, count: 1, state: 'open', title: titles[id] };
  P.sign[i] |= 1 << slot;
  P.flags[i] |= FL.leader | FL.famous | FL.moving;
  po.petitions.push(p);
  W.news.push(news(day, 'petition', p.scope === 'national' ? -1 : p.district, `署名「${p.title}」が始まりました（呼びかけ人：${W.card(i, day).name}）`, { id: p.id }));
}
function petitions(W, day, r) {
  const P = W.P, po = W.pol;
  for (const p of po.petitions) {
    if (p.state !== 'open') continue;
    const bit = 1 << p.slot, need = needOf(W, p);
    // word of mouth: those who signed ask those close to them (a sample a day)
    const asks = Math.min(3000, p.count * 2 + 20);
    for (let s = 0; s < asks; s++) {
      const i = r.int(P.n);
      if (!(P.sign[i] & bit)) continue;
      const slot = r.int(REL), j = P.rel[i * REL + slot];
      if (j < 0 || P.sign[j] & bit || (p.scope !== 'national' && P.dist[j] !== p.district)) continue;
      const mind = P.disc[j * 8 + p.theme] / 255 + 0.3 * P.rtrust[i * REL + slot] / 255 - 0.45;
      if (r.u() < Math.max(0, mind)) { P.sign[j] |= bit; p.count++; P.flags[j] |= FL.moving; }
    }
    // a march on a day off when it is big enough (and a boycott of a company it is about)
    if (p.count > need * 0.25 && (day + 4) % 7 === 6 && !po.marches.some((m) => m.petition === p.id && m.day > day - 14)) {
      po.marches.push({ petition: p.id, day: day + 1, district: p.district, title: p.title, people: 0 });
      if (p.theme === 5) W.boycott.magita = Math.min(1, (W.boycott.magita || 0) + 0.3);
      if (p.theme === 6) W.boycott.dtrade = Math.min(1, (W.boycott.dtrade || 0) + 0.3);
    }
    if (p.count >= need) {
      p.state = 'won';
      const vote = day + 14 + ((7 - ((day + 14 + 4) % 7)) % 7);
      po.votes.push({ id: p.id, petition: p.id, day: vote, scope: p.scope, district: p.district, knob: p.knob, dir: p.dir, title: p.title, state: 'set' });
      W.news.push(news(day, 'petition', p.scope === 'national' ? -1 : p.district, `署名「${p.title}」が${p.count}人に達し、${CORP.dateLabel(vote)}に市民投票`, { id: p.id }));
    } else if (day - p.start > NPC.votes.national.days) {
      p.state = 'lost';
      W.news.push(news(day, 'petition', -1, `署名「${p.title}」は${p.count}人で期限切れ（必要${need}人）`, { id: p.id }));
    }
  }
  // (the bits of finished ones free for new)
  for (const p of po.petitions) if (p.state === 'lost' || p.state === 'done') {
    const bit = ~(1 << p.slot);
    if (!p.cleared) { for (let i = 0; i < P.n; i++) P.sign[i] &= bit; p.cleared = true; }
  }
  po.petitions = po.petitions.filter((p) => p.state === 'open' || p.state === 'won' || day - p.start < 120);
}
function needOf(W, p) {
  const n = W.P.n;
  if (p.scope === 'national') return Math.ceil(n * NPC.votes.national.share);
  const d = Math.max(1, W.stats.byDistrict ? W.stats.byDistrict[p.district] : n / 5);
  return Math.ceil(d * (p.scope === 'recall' ? NPC.votes.recall.share : NPC.votes.district.share));
}
// the citizens' vote: each person's own, for what it would do for them and what they mind
function referendum(W, v, day, r) {
  const P = W.P, po = W.pol, p = po.petitions.find((x) => x.id === v.petition);
  let yes = 0, no = 0, adults = 0;
  for (let i = 0; i < P.n; i++) {
    if (v.scope !== 'national' && P.dist[i] !== v.district) continue;
    adults++;
    if (r.u() > 0.3 + 0.35 * tr(P, i, T.news) + 0.25 * tr(P, i, T.justice)) continue;
    const mind = (p ? P.disc[i * 8 + p.theme] : 128) / 255 - 0.42 + 0.25 * r.z() + (p && P.sign[i] & (1 << p.slot) ? 0.3 : 0);
    if (mind > 0) yes++; else no++;
  }
  const turnout = (yes + no) / Math.max(1, adults), pass = turnout >= 0.4 && yes > no;
  v.state = 'done';
  v.result = { yes, no, turnout, pass };
  if (p) p.state = 'done';
  if (pass && v.scope === 'recall') {
    const d = W.districts[v.district];
    if (d.mayor >= 0) P.flags[d.mayor] &= ~FL.mayor;
    d.mayor = -1;
    po.byElection = po.byElection || [];
    po.byElection.push({ district: v.district, day: day + 21 });
  } else if (pass && v.knob && canChange(W, v.knob, day)) {
    const k = NPC.knob[v.knob];
    schedule(W, v.knob, clampKnob(W, v.knob, W.nation.knobs[v.knob] + v.dir * k.step * 2), day, 'vote');
  }
  W.news.push(news(day, 'vote', v.scope === 'national' ? -1 : v.district, `市民投票「${v.title}」：${pass ? '可決' : '否決'}（賛成${Math.round(yes / Math.max(1, yes + no) * 100)}%・投票率${Math.round(turnout * 100)}%）`, { pass }));
}
