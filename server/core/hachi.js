// HACHI's wards on the people's side (js/game/corp.js HACHI, js/game/npc.js HEALTH and INSURANCE): who goes, when, to
// which ward, what is done and what it costs — and who pays it. The companies' side (its books): corp-hachi.js.
//
// - ヴェルノア (a minute at a time, as its people live): each ward does at once at most CORP.hachi.cap of each service
//   (fewer when its medical staff are short), the patients waiting taken the least healthy first. At −90 and below an
//   operation must be done within the hour (`HEALTH.timer` minutes of the country's time) or the patient dies; nobody
//   is fetched (救急救命はやらない): they go themselves. −89〜−70 a bed; −69〜−30 a doctor and medicine at once; −29〜0
//   home, no work; and everyone's 定期検診 once a month (the law's: on their own day of the month or as soon after —
//   missed: −20 at the next month's start and the insurance's share stopped until it is done).
// - アスカ国 (a day at a time): the same, its wards' day's worth of each service.
// - What it costs (the fees are fixed: 100%負担): the patient's share by the 医療保険 on their 身分証明書 (none: all of it;
//   60K a week: half; 120K a week: three tenths), the rest their country's; 生活保護 the country's all; an operation or a
//   bed nobody can pay for — they could not borrow it either — the country's too (高額療養費). The country's medical
//   money: the premiums and the 医療税 (of everyone's pay, taken with it), moved each month by how they stand against
//   what it paid and by the times.
// - 株式会社FIGMA (アスカ国's): its two customers — HACHI's equipment (corp-hachi.js) and アスカ国's research, from what
//   HACHI puts into it — and its people.
import { NPC, CORP, ASUKA } from './rules.js';
import * as econ from './npc-econ.js';
import * as health from './npc-health.js';
import { T, NT, FL, E, E2, ageOf } from './npc-pop.js';
import { hash32 } from './npc-rand.js';

const R = CORP.hachi, F = R.fees, INS = NPC.insurance, HL = NPC.health, FG = ASUKA.figma;
export const CARE = { none: 0, bed: 1, rehab: 2 };
const SERVICES = ['checkup', 'consult', 'medicine', 'inpatient', 'surgery', 'rehab'];
const YEAR = 365;

/* ------------------------------------------------------------ what there is --- */
// HACHI's wards as its last close had them (corp-model ext.hachiInfo): null before its founding or once it is gone
export const infoOf = (W) => (W.hachiInfo && W.hachiInfo.wards && W.hachiInfo.wards.length ? W.hachiInfo : null);
export const isOpen = (W) => !!infoOf(W);
const wardsIn = (W, country) => (infoOf(W) ? W.hachiInfo.wards.filter((x) => x.country === country) : []);
// the ward a person goes to: one in their district, else the nearest
export function wardFor(W, country, dist) {
  const list = wardsIn(W, country);
  if (!list.length) return -1;
  let best = -1, gap = Infinity;
  list.forEach((x, k) => { const g = Math.abs(x.district - dist) * 10 + (x.k - 1); if (g < gap) { gap = g; best = k; } });
  return best;
}
// the country's state of it: the month's, the day's
function st(W) {
  return W.hachi || (W.hachi = { m: blank(), last: null, hist: [], deaths: 0, saved: 0, checkups: 0, campaign: 0, med: { premiums: 0, tax: 0, paid: 0 }, asuka: { m: blank(), med: { premiums: 0, tax: 0, paid: 0 } } });
}
const blank = () => ({ visits: {}, rev: {}, own: 0, state: 0, unpaid: 0, deaths: 0, saved: 0, checkups: 0, due: 0, skipped: 0, beds: 0, waits: 0, used: 0, cap: 0 });
// (the 医療保険 on one's 身分証明書: its plan in the low bits; `SUSPENDED` while the month's checkup is owed — the
// insurance's share stopped, every bill one's own, until it is done)
export const SUSPENDED = 0x80;
const plan = (k) => INS[(k || 0) & 3] || INS[0];
const coverOf = (k) => ((k || 0) & SUSPENDED ? 0 : plan(k).cover);
const CR = HL.care;
// a gain of health by a service that can lift it as far as `upTo` at most (never lower than one is)
const lift = (h, by, upTo = 100) => (h >= upTo ? h : Math.min(upTo, h + by));

/* ---------------------------------------------------------------- the bill --- */
// A service's bill for ヴェルノア's person `i`: their share by their insurance (生活保護: none of it), the rest the
// treasury's — both HACHI's as its day closes. `life`: an operation or a bed (unpaid, the country's: 高額療養費).
// Returns false when they could not pay and it is not their life.
export function bill(W, i, day, service, n, life = false) {
  const P = W.P, H = st(W), cover = P.flags[i] & FL.welfare ? 1 : coverOf(P.ins ? P.ins[i] : 0);
  n = Math.round(n);
  let own = Math.round(n * (1 - cover)), state = n - own;
  if (own > 0 && !econ.pay(W, i, own, life, 'c')) {
    if (!life) return false;
    state += own; H.m.unpaid += own; own = 0;
  }
  if (own > 0) econ.toStream(W, day, 'hachi', service, own);
  if (state > 0) { econ.nationOut(W, 'medical', state); econ.toStream(W, day, 'hachi', service, state); H.med.paid += state; }
  H.m.visits[service] = (H.m.visits[service] || 0) + 1;
  H.m.rev[service] = (H.m.rev[service] || 0) + n;
  H.m.own += own; H.m.state += state;
  return true;
}

/* ------------------------------------------------------------ the wards' day --- */
// a ward's room today (ヴェルノア's, a minute at a time): what it does at once of each, for this world's size, as far as
// its medical staff go (each ward its share of them)
function room(W, ward) {
  const h = W.hosp || (W.hosp = { wards: [], crit: new Set(), seen: new Map() });
  if (!h.wards[ward]) h.wards[ward] = { slots: { consult: [], surgery: [], rehab: [] }, queue: [], beds: 0 };
  return h.wards[ward];
}
// (a ward's medical staff against the standard 175 — CORP.hachi.perWard —: fewer, as much less of everything)
function capOf(W, kind) {
  const sc = W.scale || 1, staff = W.hachiInfo && W.hachiInfo.staffRatio !== undefined ? W.hachiInfo.staffRatio : 1;
  return Math.max(1, Math.round(R.cap[kind] * sc * Math.max(0, Math.min(1, staff))));
}
export const capacity = (W, kind) => capOf(W, kind);
// what each kind takes and which desk does it
const DESK = { checkup: 'consult', consult: 'consult', doctor: 'consult', admit: 'consult', emergency: 'surgery', surgery: 'surgery', rehab: 'rehab' };
const MINUTES = { checkup: R.minutes.checkup, consult: R.minutes.consult, doctor: R.minutes.consult, admit: R.minutes.consult, emergency: R.minutes.surgery, surgery: R.minutes.surgery, rehab: R.minutes.rehab };

// A person arrives at their ward (`kind`: checkup, doctor, admit, emergency, rehab): served now if a desk is free, else
// waiting their turn (the least healthy first). Returns how long they are there for now (their next look at it), or
// 0 when there is no ward (HACHI not founded yet).
export function arrive(W, i, m, kind, ctx, r) {
  if (!isOpen(W)) return 0;
  const P = W.P, ward = wardFor(W, 'vernoa', P.dist[i]);
  if (ward < 0) return 0;
  P.ward[i] = ward + 1;
  const wr = room(W, ward), h = W.hosp;
  // (at −90 and below: the hour begins as they come — or as they fell, if earlier)
  if (kind === 'emergency' && !P.crit[i]) { P.crit[i] = HL.timer; h.crit.add(i); }
  if (!wr.queue.some((q) => q.i === i)) wr.queue.push({ i, kind, at: m });
  serve(W, ward, m, ctx, r);
  // (served: the time it takes; still waiting: a look again in a while)
  return P.due[i] > m ? P.due[i] - m : 15;
}
// the desks of a ward this minute: the finished ones free, the waiting taken by who is least healthy (−100 first; the
// gravely ill — −90 and below, on their hour — before anyone: トリアージ)
function serve(W, ward, m, ctx, r) {
  const P = W.P, wr = room(W, ward), day = Math.floor(m / 1440);
  for (const k of Object.keys(wr.slots)) wr.slots[k] = wr.slots[k].filter((end) => end > m);
  if (!wr.queue.length) return;
  wr.queue = wr.queue.filter((q) => P.ward[q.i] === ward + 1 && P.act[q.i] === NPC.act.hospital);
  const key = (q) => { const h = health.hpOf(P, q.i); return (q.kind === 'emergency' || h <= -90 ? -1000 : 0) + h; };
  wr.queue.sort((a, b) => key(a) - key(b) || a.at - b.at);
  const left = [];
  for (const q of wr.queue) {
    const desk = DESK[q.kind] || 'consult';
    if (wr.slots[desk].length >= capOf(W, desk)) { left.push(q); continue; }
    const len = MINUTES[q.kind] || 25;
    wr.slots[desk].push(m + len);
    P.due[q.i] = m + len;
    done(W, q.i, q.kind, day, ward, r || fallbackR, ctx);
  }
  wr.queue = left;
  const H = st(W);
  H.m.waits += left.length;
}
// what a service does (and costs) as it is done (js/game/npc.js HEALTH.care)
function done(W, i, kind, day, ward, r, ctx) {
  const P = W.P, H = st(W), h = health.hpOf(P, i);
  if (kind === 'checkup') {
    // (the checkup done: the insurance's share back at once, this bill too)
    P.ins[i] &= ~SUSPENDED;
    if (!bill(W, i, day, 'checkup', F.checkup)) return;
    P.chk[i] = monthNo(day);
    H.m.checkups++;
    health.setHp(P, i, lift(h, CR.checkup, CR.upTo));
    // (a long illness found: its medicine for the month)
    if (P.ill[i] && !P.med[i] && bill(W, i, day, 'medicine', F.medicine)) P.med[i] = 1;
    if (W.hachi.campaignOn) H.campaign += F.checkup * R.myway.lift;
    return;
  }
  if (kind === 'emergency' || kind === 'surgery') {
    // (an operation — always a success: +65 at once, the hour stopped; its リハビリ after)
    bill(W, i, day, 'surgery', F.surgery, true);
    health.setHp(P, i, HL.healed);
    if (P.crit[i]) { P.crit[i] = 0; H.m.saved++; H.saved++; }
    if (W.hosp) W.hosp.crit.delete(i);
    P.care[i] = CARE.rehab;
    H.m.surgery = (H.m.surgery || 0) + 1;
    return;
  }
  if (kind === 'admit') {
    const wr = room(W, ward);
    if (wr.beds < capOf(W, 'inpatient')) { wr.beds++; P.care[i] = CARE.bed; H.m.beds++; bill(W, i, day, 'consult', F.consult, true); return; }
    // (no bed: an operation if a table is free — they are within its reach, −30 and below —, else a doctor)
    if (h <= HL.surgeryFrom && wr.slots.surgery.length < capOf(W, 'surgery')) { wr.slots.surgery.push((P.due[i] || 0) + R.minutes.surgery); done(W, i, 'surgery', day, ward, r, ctx); return; }
    kind = 'doctor';
  }
  if (kind === 'doctor' || kind === 'consult') {
    if (!bill(W, i, day, 'consult', F.consult)) return;
    if (W.hosp) W.hosp.seen.set(i, day);
    // (the 診察: +25 as far as 75; its medicine when unwell or ill — the illness treated, a long one eased)
    let to = lift(h, CR.consult, CR.upTo);
    if ((h <= 30 || P.ill[i] || (P.flags[i] & FL.sick)) && bill(W, i, day, 'medicine', F.medicine)) {
      P.med[i] = 1;
      if (P.ill[i]) P.ill[i] = Math.max(0, P.ill[i] - 20);
      P.flags[i] &= ~FL.sick;
    }
    health.setHp(P, i, to);
    return;
  }
  if (kind === 'rehab') {
    if (!bill(W, i, day, 'rehab', F.rehab)) { P.care[i] = CARE.none; return; }
    // (+15: the only way up into 76〜100)
    health.setHp(P, i, lift(h, CR.rehab));
    if (W.hosp) W.hosp.seen.set(i, day);
    if (health.hpOf(P, i) > 50) P.care[i] = CARE.none;
  }
}
// The minute (npc-model tick, while the country is about): every ward's desks, and the hour of those at −90 and below
// — run out before their operation: dead.
export function tick(W, m, ctx, die) {
  if (!isOpen(W)) return;
  const P = W.P;
  // (a country read back: its desks empty again, those at −90 and below still on their hour)
  if (!W.hosp) { W.hosp = { wards: [], crit: new Set(), seen: new Map() }; for (let i = 0; i < P.n; i++) if (P.crit[i] > 0) W.hosp.crit.add(i); }
  W.hosp.wards.forEach((wr, k) => { if (wr && wr.queue.length) serve(W, k, m, ctx, null); });
  for (const i of [...W.hosp.crit]) {
    if (P.crit[i] <= 0 || health.hpOf(P, i) > -90) { P.crit[i] = 0; W.hosp.crit.delete(i); continue; }
    P.crit[i]--;
    if (P.crit[i] <= 0) {
      W.hosp.crit.delete(i);
      const H = st(W);
      H.m.deaths++; H.deaths++;
      W.news.push({ day: Math.floor(m / 1440), kind: 'life', district: P.dist[i], text: `重篤の患者が手術を受けられないまま亡くなりました（${NPC.districts[P.dist[i]].name}）`, data: {} });
      die(i);
    }
  }
}
// (the queue's `r`: an rng for a service done from the minute's loop)
const fallbackR = { u: () => 0.5, int: (n) => Math.floor(n / 2) };

/* ------------------------------------------------------------- one's own day --- */
// What a ヴェルノア person's health obliges them to now (npc-life obliged, before their work): a bed; at −90 and below
// an operation within the hour; −89〜−70 an operation (重症); −69〜−30 a bed to be had (else an operation, else a
// doctor); −29〜0 a doctor once that day, then home (休職); null: nothing — and a checkup or a リハビリ for their free time
export function obliged(W, i, day) {
  if (!isOpen(W)) return null;
  const P = W.P, h = health.hpOf(P, i);
  if (P.care[i] === CARE.bed) return 'bed';
  if (h <= -90) return 'emergency';
  if (h <= -70) return 'surgery';
  if (h <= HL.surgeryFrom) return 'admit';
  if (h <= 0) return W.hosp && W.hosp.seen.get(i) === day ? 'leave' : 'doctor';
  return null;
}
// in their own time: the month's checkup (on their day of the month or as soon after: the law's — owed from a month
// missed, at once), a リハビリ every other day after a bed or an operation, a doctor now and then when unwell; and the
// well-off healthy now and then a リハビリ of their own — the only way up into 76〜100, twice the work and up to 70% more
// pay (the better paid the likelier: what it brings them against its $850K)
export function freeTime(W, i, day, r) {
  if (!isOpen(W)) return null;
  const P = W.P, h = health.hpOf(P, i), t = CORP.ymd(day);
  if (P.care[i] === CARE.rehab && (day + i) % 2 === 0) return 'rehab';
  if ((P.ins[i] & SUSPENDED) && ageOf(P, i, day) >= 18 && r.u() < 0.3) return 'checkup';
  const gap = P.salary[i] > 30000000 ? 3 : P.salary[i] > 12000000 ? 9 : 45;
  if (h > 50 && h < 98 && P.cash[i] > 40 * F.rehab && (day + i) % gap === 0 && !(W.hosp && W.hosp.seen.get(i) === day) && r.u() < 0.35) return 'rehab';
  if (P.chk[i] !== monthNo(day) && t.d >= dueDay(i) && ageOf(P, i, day) >= 18) {
    // (most keep it — the more with MY WAY's characters reminding them —; the careless and the hard-up less)
    const keep = 0.08 + (W.hachi && W.hachi.campaignOn ? R.myway.lift : 0) + 0.1 * P.tr[i * NT + T.consc] / 255;
    if (r.u() < keep) return 'checkup';
  }
  if (h <= 30 && !(W.hosp && W.hosp.seen.get(i) === day) && r.u() < 0.04) return 'doctor';
  return null;
}
const monthNo = (day) => { const t = CORP.ymd(day); return ((t.y - 2026) * 12 + t.m) & 0xffff; };
// one's own day of the month for the checkup (1 to 28)
const dueDay = (i) => 1 + (hash32(i, 41) % 28);

/* ------------------------------------------------------------------- the day --- */
// The day closed (npc-state daily, after everyone's health): the beds (a day each, their recovery, home and to
// リハビリ when well enough), those fallen to −90 sent at once, the month's start (the checkups' record, everyone's
// insurance, the 医療税), the week's premiums.
export function day(W, day, r) {
  if (!isOpen(W)) { W.hosp = null; return; }
  const P = W.P, H = st(W), t = CORP.ymd(day);
  // (the first day of its wards: everyone's insurance chosen at once, as each month's start does)
  if (!H.insStart) { H.insStart = day; for (let i = 0; i < P.n; i++) if (ageOf(P, i, day) >= 18) P.ins[i] = choose(W, i, r); }
  const beds = [];
  for (let i = 0; i < P.n; i++) {
    if (P.care[i] === CARE.bed) {
      // (a day in a bed: +35, its stress and its work's load gone; home once able to work, its リハビリ after)
      bill(W, i, day, 'inpatient', F.inpatient, true);
      health.setHp(P, i, lift(health.hpOf(P, i), CR.bed));
      P.emo[i * 5 + E.stress] = 0;
      if (P.emo2) P.emo2[i * 3 + E2.tired] = 0;
      if (health.hpOf(P, i) >= HL.discharge) { P.care[i] = CARE.rehab; P.ward[i] = 0; }
      else beds.push(i);
      continue;
    }
    // (fallen to −90 and below: on their way now — their hour began when they fell)
    if (health.hpOf(P, i) <= -90 && !P.crit[i] && W.hosp) { P.crit[i] = HL.timer; W.hosp.crit.add(i); P.due[i] = 0; H.m.critical = (H.m.critical || 0) + 1; }
  }
  if (W.hosp) for (const wr of W.hosp.wards) if (wr) wr.beds = 0;
  for (const i of beds) { const k = P.ward[i] - 1; if (k >= 0) room(W, k).beds++; }
  if (t.d === 1) monthStart(W, day, r);
  if ((day - (W.hachiInfo.founded || day)) % 7 === 0) premiums(W, day);
}
// the month's start: the last month's record; the medicines given for it end; everyone's insurance for the month
// (by what they expect to need of the hospital); the 医療税 moved
// — and those who missed last month's checkup (not in a bed): −20, and their insurance's share stopped until they go
function monthStart(W, day, r) {
  const P = W.P, H = st(W), was = monthNo(day - 1), opened = H.insStart !== undefined && H.insStart < day;
  let due = 0, done = 0, missed = 0;
  for (let i = 0; i < P.n; i++) {
    if (ageOf(P, i, day) < 18) continue;
    due++;
    const kept = P.chk[i] === was, owed = (P.ins[i] & SUSPENDED) || (opened && !kept && P.care[i] !== CARE.bed);
    if (kept) done++;
    else if (opened && P.care[i] !== CARE.bed) { health.addHp(P, i, HL.missed); missed++; }
    P.med[i] = 0;
    P.ins[i] = choose(W, i, r) | (owed ? SUSPENDED : 0);
  }
  H.m.due = due; H.m.done = done; H.m.missed = missed;
  H.last = { ...H.m, day, rate: NPC.knobOf(W, 'medicalTax'), med: { ...H.med }, insured: insured(W) };
  H.hist.push(H.last);
  if (H.hist.length > 24) H.hist.shift();
  taxMove(W);
  H.m = blank();
  H.med = { premiums: 0, tax: 0, paid: 0 };
}
// a person's insurance for the month: what each plan would cost them against what they expect to need (their health,
// a long illness's medicine, their age), the anxious the more covered; none if they cannot keep it up
function choose(W, i, r) {
  const P = W.P, h = health.hpOf(P, i);
  const need = F.checkup + (P.ill[i] ? F.medicine + F.consult : 0) + (h <= 0 ? 3 * F.consult + 2 * F.inpatient : h <= 30 ? 1.5 * F.consult : h <= 50 ? 0.4 * F.consult : 0.1 * F.consult);
  const worry = 0.15 * P.tr[i * NT + T.neuro] / 255 + 0.1 * (1 - P.tr[i * NT + T.risk] / 255);
  let best = 0, cost = Infinity;
  for (const x of INS) {
    const month = x.week * 52 / 12;
    if (month * 2 > Math.max(0, P.cash[i])) continue;
    const c = month + need * (1 - x.cover) * (1 + worry) + r.z() * 20000;
    if (c < cost) { cost = c; best = x.id; }
  }
  return best;
}
// the week's premiums: to the treasury; one who cannot pay is out of it until the month's choice (a checkup still owed
// stays owed)
function premiums(W, day) {
  const P = W.P, H = st(W);
  for (let i = 0; i < P.n; i++) {
    const x = plan(P.ins[i]);
    if (!x.week) continue;
    if (econ.pay(W, i, x.week, false, 'x')) { econ.nationIn(W, 'premium', x.week); H.med.premiums += x.week; }
    else P.ins[i] &= SUSPENDED;
  }
  void day;
}
export const insured = (W) => {
  const P = W.P, n = [0, 0, 0];
  for (let i = 0; i < P.n; i++) n[(P.ins[i] || 0) & 3]++;
  return n;
};
// 医療税 (国が一括して, of everyone's pay and every company's profit; six tenths HACHI's): moved each month by the state
// (景気変動型), a step of at most `step` towards where the times put it, never outside 2〜8% —
// - the gravely ill multiplying (those fallen to −90 and below and those lost, against their usual month), or HACHI
//   run by the state (its 20 wards and its people kept): up towards 5〜8%, the more the worse
// - its medical money well ahead (the premiums and its share of the tax against what it paid of the bills) in good
//   times: down towards 2〜3.5%, the lower the further ahead
// - short of what it paid in ordinary times: up a step, as far as 5% (beyond it only for a crisis or the state's
//   running of HACHI; what is still short, the treasury's general budget)
// - else back towards 4% (the ordinary times'), a step a month
export const TAX = { start: 4, low: [2, 3.5], high: [5, 8], step: 0.5 };
export function taxTarget(rate, x) {
  const k = NPC.knob.medicalTax, lo = k.floor, hi = k.cap;
  let aim = TAX.start;
  if (x.crisis > 0 || x.state) aim = Math.max(rate, TAX.high[0] + (TAX.high[1] - TAX.high[0]) * Math.min(1, Math.max(x.state ? 0.25 : 0, x.crisis)));
  else if ((x.out > 0 ? x.inn > x.out * 1.2 : x.inn > 0) && x.boom >= 1) aim = TAX.low[1] - (TAX.low[1] - TAX.low[0]) * Math.min(1, x.out > 0 ? (x.inn / x.out - 1.2) / 1.3 : 1);
  else if (x.out > x.inn * 1.05) aim = Math.min(TAX.high[0], Math.max(rate, TAX.start) + TAX.step);
  const next = rate + Math.max(-TAX.step, Math.min(TAX.step, aim - rate));
  return Math.round(Math.max(lo, Math.min(hi, next)) * 10) / 10;
}
// how far the gravely ill are beyond their usual month (0: no more than usual; 1: three times as many and more)
function crisisOf(H, n, people) {
  // (a handful is no epidemic: at least 3, and one in 5,000 people)
  if (n < Math.max(3, people / 5000)) { H.critAvg = H.critAvg === undefined ? n / Math.max(1, people) : H.critAvg * 0.8 + 0.2 * n / Math.max(1, people); return 0; }
  const per = n / Math.max(1, people);
  const was = H.critAvg === undefined ? per : H.critAvg;
  H.critAvg = was * 0.8 + per * 0.2;
  return was > 0 && per > was * 1.5 ? Math.min(1, (per / was - 1.5) / 1.5) : 0;
}
function taxMove(W) {
  const H = st(W), m = H.hist[H.hist.length - 1];
  if (!m) return;
  const boom = (W.macro && W.macro.boom) || W.boom || 1;
  const crisis = crisisOf(H, (m.critical || 0) + (m.deaths || 0), W.P.n);
  const rate = NPC.knobOf(W, 'medicalTax');
  W.nation.knobs.medicalTax = taxTarget(rate, { inn: m.med.premiums + m.med.tax, out: m.med.paid, boom, crisis, state: !!(W.hachiInfo && W.hachiInfo.state) });
  m.crisis = crisis;
}
// what the 医療税 takes of a pay (npc-state take, socialOf)
export const taxOn = (W, gross) => Math.round(gross * NPC.knobOf(W, 'medicalTax') / 100);
// the 医療税 taken (of a pay, or a company's month's profit): six tenths HACHI's (CORP.hachi.tax: its 'tax' stream, day
// by day as it comes in) once its wards are open, the rest the treasury's
export function taxed(W, n, day) {
  n = Math.round(n || 0);
  if (!(n > 0)) return;
  const H = st(W), mine = isOpen(W) ? Math.round(n * R.tax.hachi) : 0, state = n - mine;
  if (state) { econ.nationIn(W, 'medicalTax', state); H.med.tax += state; }
  if (mine) { econ.toStream(W, day ?? W.day ?? 0, 'hachi', 'tax', mine); H.med.toHachi = (H.med.toHachi || 0) + mine; H.m.taxToHachi = (H.m.taxToHachi || 0) + mine; }
}

/* ------------------------------------------------------- for the companies --- */
// What HACHI's books read of the people's side (corp-model flows.npc.hachi): how busy its wards were (their 診察 desks'
// share used of what they could do), its patients in each country this month, what MY WAY's advertising brought.
export function flowsFor(W) {
  if (!isOpen(W)) return null;
  const H = st(W), A = W.asuka && W.asuka.hachiM;
  const used = H.m.visits.consult || 0, chk = H.m.checkups || 0, aUsed = A ? A.consult + A.checkups : 0, aCap = A ? A.cap : 0;
  const days = Math.max(1, CORP.ymd(W.day || 0).d);
  const capV = wardsIn(W, 'vernoa').length * capOf(W, 'consult') * (660 / R.minutes.consult) * days;
  const busy = (used + chk + aUsed) / Math.max(1, capV + aCap);
  const campaign = Math.round(H.campaign + (A ? A.campaign : 0));
  H.campaign = 0;
  if (A) A.campaign = 0;
  return { busy, patients: { vernoa: used + chk + (H.m.beds || 0), asuka: aUsed }, campaign };
}
// What HACHI's last close said of its wards (corp-model ext.hachiInfo): kept for the day, with how far its medical
// staff in each country are what its wards need (each ward its share of CORP.hachi.staff.medical)
export function fromCompanies(W, x) {
  if (!x) { if (W.hachiInfo && !W.hachiInfo.gone) W.hachiInfo = null; return; }
  W.hachiInfo = x;
  st(W).campaignOn = !!x.campaign;
  const sc = W.scale || 1, all = Math.max(1, x.wards.length), V = x.wards.filter((y) => y.country === 'vernoa').length;
  const P = W.P, staff = W.staffOf('hachi');
  let med = 0;
  for (const i of staff) if (NPC.hachiRoles[deptKey(W, P.dept[i])] === 'medical') med++;
  // (each ward's medical staff against the standard 175 a ward: CORP.hachi.perWard)
  x.staffRatio = med / Math.max(1, R.perWard * sc * V);
  const J = W.asukaJobs, A = W.AP;
  let am = 0;
  if (A && J) for (let i = 0; i < A.n; i++) if (A.job[i] === J.hachi) am++;
  x.asukaStaffRatio = am / Math.max(1, R.perWard * ((W.asuka && W.asuka.scale) || sc) * (all - V));
}
// the kind of a HACHI department (its key in js/game/npc.js ORG.hachi)
export const deptKey = (W, k) => { const o = W.orgs && W.orgs.hachi; return o && o.depts[k] ? o.depts[k].key : 'medical'; };
// what HACHI pays one of its people starting in a department (CORP.hachi.pay: a month)
export const payFor = (W, k) => R.pay[NPC.hachiRoles[deptKey(W, k)] || 'medical'] * 12;

/* -------------------------------------------------------------- アスカ国's --- */
// アスカ国's day of its wards (asuka.js day): its people's health a day, who goes (the least healthy first, its wards'
// day's worth of each), what it costs them and its treasury; those at −90 and below not operated on today: dead;
// the month's checkups; FIGMA's day. `die(i)`: asuka.js's.
export function asukaDay(W, day, r, die) {
  const a = W.asuka, A = W.AP;
  if (!a || !A || !A.hp) return;
  if (!a.hpSet) { for (let i = 0; i < A.n; i++) { const s = health.start(ageOfA(A, i, day), r); A.hp[i] = s.hp; A.ill[i] = s.ill; } a.hpSet = day; }
  const M = a.hachiM || (a.hachiM = { consult: 0, checkups: 0, beds: 0, surgery: 0, deaths: 0, saved: 0, rev: 0, own: 0, state: 0, cap: 0, campaign: 0, due: 0, done: 0 });
  const poorLine = ASUKA.rules.pay.trade / 12;
  for (let i = 0; i < A.n; i++) health.asukaDay(A, i, ageOfA(A, i, day), A.cash[i] < poorLine && A.pay[i] <= 0, r);
  if (!isOpen(W)) return;
  const wards = wardsIn(W, 'asuka');
  if (!wards.length) return;
  // (its wards' first day: everyone's insurance chosen at once, as each month's start does)
  if (a.hachiOpened === undefined) { a.hachiOpened = day; for (let i = 0; i < A.n; i++) if (ageOfA(A, i, day) >= 18) A.ins[i] = asukaChoose(A, i, r); }
  // a ward's day's worth (this world's size; the hours the country is about)
  const mins = 660, sc = a.scale || 1, staff = W.hachiInfo && W.hachiInfo.asukaStaffRatio !== undefined ? W.hachiInfo.asukaStaffRatio : 1, k = Math.max(0, Math.min(1, staff));
  const per = (kind, len) => Math.max(1, Math.round(R.cap[kind] * sc * k * mins / len));
  const room = wards.map(() => ({ consult: per('consult', R.minutes.consult), surgery: per('surgery', R.minutes.surgery), rehab: per('rehab', R.minutes.rehab), beds: Math.max(1, Math.round(R.cap.inpatient * sc * k)), inbed: 0 }));
  M.cap += room.reduce((n, x) => n + x.consult, 0);
  const near = (d) => { let b = 0, g = Infinity; wards.forEach((x, j) => { const gg = Math.abs(x.district - d) * 10 + x.k; if (gg < g) { g = gg; b = j; } }); return b; };
  for (let i = 0; i < A.n; i++) if (A.care[i] === CARE.bed) room[near(A.dist[i])].inbed++;
  // who needs what today, the least healthy first
  const want = [];
  const mno = monthNo(day), t = CORP.ymd(day);
  for (let i = 0; i < A.n; i++) {
    const h = A.hp[i];
    if (A.care[i] === CARE.bed) { want.push([h, i, 'bed']); continue; }
    // (as ヴェルノア's: −90 and below an operation today or death; −89〜−70 an operation; −69〜−30 a bed, else an
    // operation, else a doctor; −29〜0 a doctor; a checkup owed at once)
    if (h <= -90) { want.push([h - 1000, i, 'emergency']); M.critical = (M.critical || 0) + 1; }
    else if (h <= -70) want.push([h, i, 'surgery']);
    else if (h <= HL.surgeryFrom) want.push([h, i, 'admit']);
    else if (h <= 0) want.push([h, i, 'doctor']);
    else if (A.care[i] === CARE.rehab && (day + i) % 2 === 0) want.push([h, i, 'rehab']);
    else if ((A.ins[i] & SUSPENDED) && ageOfA(A, i, day) >= 18 && r.u() < 0.3) want.push([h + 200, i, 'checkup']);
    else if (A.chk[i] !== mno && t.d >= dueDay(i) && ageOfA(A, i, day) >= 18 && r.u() < 0.1 + (W.hachi && W.hachi.campaignOn ? R.myway.lift : 0)) want.push([h + 200, i, 'checkup']);
    else if (h <= 30 && r.u() < 0.04) want.push([h, i, 'doctor']);
    else if (h > 50 && h < 98 && A.cash[i] > 40 * F.rehab && (day + i) % (A.pay[i] > 30000000 ? 3 : A.pay[i] > 12000000 ? 9 : 45) === 0 && r.u() < 0.35) want.push([h + 300, i, 'rehab']);
  }
  want.sort((x, y) => x[0] - y[0]);
  for (let [, i, kind] of want) {
    const w = room[near(A.dist[i])];
    if (kind === 'bed') {
      // (a day in a bed: +35; home once able to work, its リハビリ after)
      if (!abill(W, i, 'inpatient', F.inpatient, true)) continue;
      A.hp[i] = lift(A.hp[i], CR.bed);
      if (A.hp[i] >= HL.discharge) A.care[i] = CARE.rehab;
      continue;
    }
    // (an operation: +65 at once; for one at −90 and below none today is death)
    const operate = () => { w.surgery--; abill(W, i, 'surgery', F.surgery, true); A.hp[i] = HL.healed; A.care[i] = CARE.rehab; M.surgery++; };
    if (kind === 'emergency') {
      if (w.surgery > 0) { operate(); M.saved++; }
      else { M.deaths++; die(i); }
      continue;
    }
    if (kind === 'surgery') { if (w.surgery > 0) { operate(); continue; } kind = 'admit'; }
    if (kind === 'admit') {
      if (w.inbed < w.beds && w.consult > 0) { w.inbed++; w.consult--; A.care[i] = CARE.bed; abill(W, i, 'consult', F.consult, true); M.beds++; continue; }
      if (w.surgery > 0) { operate(); continue; }
    }
    if (kind === 'rehab') {
      if (w.rehab <= 0) continue;
      if (!abill(W, i, 'rehab', F.rehab)) { A.care[i] = CARE.none; continue; }
      w.rehab--; A.hp[i] = lift(A.hp[i], CR.rehab);
      if (A.hp[i] > 50) A.care[i] = CARE.none;
      continue;
    }
    if (w.consult <= 0) continue;
    if (kind === 'checkup') {
      A.ins[i] &= ~SUSPENDED;
      if (!abill(W, i, 'checkup', F.checkup)) continue;
      w.consult--; A.chk[i] = mno; M.checkups++; A.hp[i] = lift(A.hp[i], CR.checkup, CR.upTo);
      if (W.hachi && W.hachi.campaignOn) M.campaign += F.checkup * R.myway.lift;
      if (A.ill[i] && !A.med[i] && abill(W, i, 'medicine', F.medicine)) A.med[i] = 1;
      continue;
    }
    // (a doctor: +25 as far as 75, and medicine when unwell or ill a long time — the illness treated, a long one eased)
    if (!abill(W, i, 'consult', F.consult)) continue;
    w.consult--; M.consult++;
    A.hp[i] = lift(A.hp[i], CR.consult, CR.upTo);
    if ((A.hp[i] <= 30 || A.ill[i]) && abill(W, i, 'medicine', F.medicine)) { A.med[i] = 1; if (A.ill[i]) A.ill[i] = Math.max(0, A.ill[i] - 20); }
  }
  if (t.d === 1) asukaMonth(W, day, r);
  if ((day - (W.hachiInfo.founded || day)) % 7 === 0) asukaPremiums(W);
}
const ageOfA = (A, i, day) => Math.floor((day - A.birth[i]) / 365.25);
// an アスカ国 person's bill: their share (by their insurance), the rest its treasury's — both on their way to HACHI
function abill(W, i, service, n, life = false) {
  const a = W.asuka, A = W.AP, M = a.hachiM, cover = coverOf(A.ins[i]);
  let own = Math.round(n * (1 - cover)), state = n - own;
  if (own > A.cash[i]) {
    if (!life) return false;
    state += own; own = 0;
  }
  state = Math.min(state, Math.max(0, a.treasury));
  A.cash[i] -= own;
  a.treasury -= state;
  const box = a.toCo.hachi || (a.toCo.hachi = {});
  box[service] = (box[service] || 0) + own + state;
  a.sum.toVernoa += own + state;
  a.month.out.medical = (a.month.out.medical || 0) + state;
  // (its GDP: the patient's share their spending, the treasury's the state's — both bought of HACHI: its imports)
  const g = a.gdp || (a.gdp = { c: 0, g: 0, i: 0, x: 0, m: 0 });
  g.c += own; g.g += state;
  const med = a.hachiMed || (a.hachiMed = { premiums: 0, tax: 0, paid: 0 });
  med.paid += state;
  M.rev += own + state; M.own += own; M.state += state;
  return true;
}
// an アスカ国 person's insurance for the month: what each plan costs against what they expect, as ヴェルノア's choose
function asukaChoose(A, i, r) {
  const h = A.hp[i], need = F.checkup + (A.ill[i] ? F.medicine + F.consult : 0) + (h <= 0 ? 3 * F.consult : h <= 30 ? 1.5 * F.consult : 0.1 * F.consult);
  let best = 0, cost = Infinity;
  for (const x of INS) { const mo = x.week * 52 / 12; if (mo * 2 > A.cash[i]) continue; const c = mo + need * (1 - x.cover) + r.z() * 20000; if (c < cost) { cost = c; best = x.id; } }
  return best;
}
function asukaMonth(W, day, r) {
  const a = W.asuka, A = W.AP, M = a.hachiM, was = monthNo(day - 1), opened = a.hachiOpened !== undefined && a.hachiOpened < day;
  let due = 0, done = 0, missed = 0;
  for (let i = 0; i < A.n; i++) {
    if (ageOfA(A, i, day) < 18) continue;
    due++;
    // (last month's checkup missed — not in a bed —: −20, the insurance's share stopped until it is done)
    const kept = A.chk[i] === was, owed = (A.ins[i] & SUSPENDED) || (opened && !kept && A.care[i] !== CARE.bed);
    if (kept) done++;
    else if (opened && A.care[i] !== CARE.bed) { A.hp[i] = Math.max(-100, A.hp[i] + HL.missed); missed++; }
    A.med[i] = 0;
    A.ins[i] = asukaChoose(A, i, r) | (owed ? SUSPENDED : 0);
  }
  const med = a.hachiMed || { premiums: 0, tax: 0, paid: 0 };
  a.hachiLast = { ...M, day, due, done, missed, med: { ...med }, rate: asukaRate(W) };
  (a.hachiHist || (a.hachiHist = [])).push(a.hachiLast);
  if (a.hachiHist.length > 24) a.hachiHist.shift();
  // (its own 医療税, moved as ヴェルノア's is: its medical money, its times, its gravely ill, HACHI under the state)
  const rates = a.rates || (a.rates = {});
  const crisis = crisisOf(a.hachiCrit || (a.hachiCrit = {}), (M.critical || 0) + (M.deaths || 0), A.n);
  rates.medical = taxTarget(asukaRate(W), { inn: med.premiums + med.tax, out: med.paid, boom: (W.macro && W.macro.boom) || 1, crisis, state: !!(W.hachiInfo && W.hachiInfo.state) });
  a.hachiM = { consult: 0, checkups: 0, beds: 0, surgery: 0, deaths: 0, saved: 0, rev: 0, own: 0, state: 0, cap: 0, campaign: 0 };
  a.hachiMed = { premiums: 0, tax: 0, paid: 0 };
}
function asukaPremiums(W) {
  const a = W.asuka, A = W.AP, med = a.hachiMed || (a.hachiMed = { premiums: 0, tax: 0, paid: 0 });
  for (let i = 0; i < A.n; i++) {
    const x = plan(A.ins[i]);
    if (!x.week) continue;
    if (A.cash[i] >= x.week) { A.cash[i] -= x.week; a.treasury += x.week; med.premiums += x.week; a.month.in.premium = (a.month.in.premium || 0) + x.week; }
    else A.ins[i] &= SUSPENDED;
  }
}
// アスカ国's 医療税 on a pay (asuka.js income): its rate (4% at the start, as ヴェルノア's)
const asukaRate = (W) => (W.asuka && W.asuka.rates && W.asuka.rates.medical) ?? NPC.knob.medicalTax.start;
export const asukaTax = (W, gross) => Math.round(gross * asukaRate(W) / 100);
// the 医療税 taken there: six tenths HACHI's (its wards' takings, with its patients' bills), the rest its treasury's.
// Returns HACHI's part (what the treasury does not keep).
export function asukaTaxed(W, n) {
  const a = W.asuka;
  n = Math.round(n || 0);
  if (!a || !(n > 0)) return 0;
  const med = a.hachiMed || (a.hachiMed = { premiums: 0, tax: 0, paid: 0 }), mine = isOpen(W) ? Math.round(n * R.tax.hachi) : 0;
  med.tax += n - mine;
  if (mine) {
    const box = a.toCo.hachi || (a.toCo.hachi = {});
    box.tax = (box.tax || 0) + mine;
    a.sum.toVernoa += mine;
    med.toHachi = (med.toHachi || 0) + mine;
  }
  return mine;
}

/* ----------------------------------------------------------------- FIGMA --- */
// 株式会社FIGMA (ASUKA.figma), アスカ国's medical equipment maker: founded with HACHI (its 利益剰余金 the treasury's once),
// its people taken on (at their pay), its day's sales (HACHI's equipment, アスカ国's research buying `ratio` of what HACHI
// does — out of the research money HACHI put into it, then the treasury as far as it keeps its floor), its pay on the
// 25th, its materials アルタス's.
export function figmaFound(W, day, r, jobs) {
  const a = W.asuka, A = W.AP;
  if (!a || a.figma || !isOpen(W)) return;
  const seed = Math.round(FG.retained * (a.scale || 1)), take = Math.min(seed, Math.max(0, a.treasury));
  a.treasury -= take;
  a.month.out.figma = (a.month.out.figma || 0) + take;
  a.figma = { founded: day, cash: take, retained: take, m: { hachi: 0, asuka: 0, pay: 0, materials: 0 }, last: null, hist: [], sales: { hachi: 0, asuka: 0 } };
  figmaHire(W, day, r, jobs);
  a.news.push({ day, text: `株式会社FIGMA（医療機器の研究開発と製造・非上場）がアカツキ区に設立。利益剰余金${CORP.fmt.money(take)}は国庫から、社員${figmaStaff(W)}人を採用` });
}
export const figmaStaff = (W) => { const A = W.AP, J = W.asukaJobs; let n = 0; if (A && J) for (let i = 0; i < A.n; i++) if (A.job[i] === J.figma) n++; return n; };
function figmaHire(W, day, r, J) {
  const a = W.asuka, A = W.AP, want = Math.max(1, Math.round(FG.staff * (a.scale || 1)));
  let have = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === J.figma) have++;
  // (founded with the state's money: the state's own people first — ATSUKA Vision's posts go with them, never
  // アルタス's —, then those out of work, the local trade's only when they are not enough)
  const altas = ASUKA.atsuka.divisions.findIndex((x) => x.id === 'altas');
  for (const from of [J.atsuka, J.none, J.trade]) for (let i = 0; i < A.n && have < want; i++) {
    if (A.job[i] !== from || (from === J.atsuka && A.emp[i] === altas)) continue;
    const age = ageOfA(A, i, day);
    if (age < 22 || age >= 60) continue;
    if (from === J.atsuka) a.posts.atsuka = Math.max(0, a.posts.atsuka - 1);
    A.job[i] = J.figma; A.emp[i] = 0; A.pay[i] = FG.pay * 12; have++;
  }
}
// FIGMA's day: what HACHI paid it (its equipment: corp ext.asuka.hachi.figma) and what アスカ国's research buys of it
export function figmaSales(W, fromHachi) {
  const a = W.asuka;
  if (!a || !a.figma) return 0;
  const f = a.figma, n = Math.max(0, Math.round(fromHachi || 0));
  f.cash += n; f.m.hachi += n; f.sales.hachi += n;
  // (アスカ国's research: as much again and a half of HACHI's, from its research money, then the treasury above its floor)
  const want = Math.round(n * R.figmaRatio), res = a.medResearch || 0;
  const fromRes = Math.min(want, res), fromTr = Math.min(want - fromRes, Math.max(0, a.treasury - (a.total || 0) * 0.05));
  a.medResearch = res - fromRes;
  a.treasury -= fromTr;
  f.cash += fromRes + fromTr; f.m.asuka += fromRes + fromTr; f.sales.asuka += fromRes + fromTr;
  if (fromTr) a.month.out.figma = (a.month.out.figma || 0) + fromTr;
  // (its materials: アルタス's)
  const mat = Math.round((n + fromRes + fromTr) * FG.materials);
  if (mat > 0 && f.cash >= mat) { f.cash -= mat; a.atsuka.cash += mat; a.atsuka.rev.altas = (a.atsuka.rev.altas || 0) + mat; f.m.materials += mat; }
  return n;
}
// the 25th: its people's pay (as far as its money goes), what each costs it beyond (the treasury's social insurance)
export function figmaPay(W, J, income) {
  const a = W.asuka, A = W.AP, f = a && a.figma;
  if (!f) return;
  // (at their 健康度: from 86, up to 70% more)
  const fit = (i) => (a.hpSet && A.hp ? health.earn(A.hp[i]) : 1);
  let due = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === J.figma) due += A.pay[i] / 12 * fit(i);
  const extra = Math.round(due * (FG.cost / FG.pay - 1)), k = due > 0 ? Math.min(1, Math.max(0, f.cash - extra) / due) : 0;
  let paid = 0;
  for (let i = 0; i < A.n; i++) if (A.job[i] === J.figma) { const g = Math.floor(A.pay[i] / 12 * fit(i) * k); income(i, g); paid += g; }
  const soc = Math.min(extra, Math.max(0, f.cash - paid));
  f.cash -= paid + soc;
  a.treasury += soc;
  f.m.pay += paid + soc;
}
export function figmaMonth(W, day) {
  const a = W.asuka, f = a && a.figma;
  if (!f) return;
  f.last = { day, ...f.m, staff: figmaStaff(W), cash: Math.round(f.cash) };
  f.hist.push(f.last);
  if (f.hist.length > 24) f.hist.shift();
  f.m = { hachi: 0, asuka: 0, pay: 0, materials: 0 };
}

/* ------------------------------------------------------------- the views --- */
// For 運営's 町 and 企業 (ops/town.js, ops/corp.js): the wards, the month, the money, the insurance, everyone's health
// HACHI's wards with what is in them right now (ヴェルノア's: who waits, who is seen, beds; アスカ国's: their share of the
// month so far — its people are kept a day at a time)
function wardsNow(W, info) {
  const h = W.hosp, V = info.wards.filter((x) => x.country === 'vernoa');
  return info.wards.map((x) => {
    if (x.country !== 'vernoa') return { name: x.name, country: x.country, district: x.district };
    const r = h && h.wards[V.indexOf(x)];
    return { name: x.name, country: x.country, district: x.district, waiting: r ? r.queue.length : 0, seen: r ? r.slots.consult.length : 0, surgery: r ? r.slots.surgery.length : 0, rehab: r ? r.slots.rehab.length : 0, beds: r ? r.beds : 0 };
  });
}
export function view(W) {
  const P = W.P, H = W.hachi || null, info = infoOf(W);
  const bands = NPC.health.bands.map((b) => ({ id: b.id, name: b.name, min: b.min, max: b.max, n: 0 }));
  let sum = 0;
  for (let i = 0; i < P.n; i++) { const h = health.hpOf(P, i); sum += h; const b = bands.findIndex((x) => h >= x.min && h <= x.max); if (b >= 0) bands[b].n++; }
  const A = W.AP, a = W.asuka, abands = A && A.hp ? NPC.health.bands.map((b) => ({ id: b.id, n: 0 })) : null;
  let asum = 0;
  if (abands) for (let i = 0; i < A.n; i++) { const h = A.hp[i]; asum += h; const b = NPC.health.bands.findIndex((x) => h >= x.min && h <= x.max); if (b >= 0) abands[b].n++; }
  const ains = A && A.ins ? [0, 0, 0] : null;
  if (ains) for (let i = 0; i < A.n; i++) ains[(A.ins[i] || 0) & 3]++;
  return {
    open: !!info, wards: info ? wardsNow(W, info) : [], state: info ? info.state : null, fees: F, insurance: INS,
    vernoa: { avg: P.n ? Math.round(sum / P.n * 10) / 10 : 0, bands, insured: insured(W), month: H ? H.m : null, last: H ? H.last : null, hist: H ? H.hist.slice(-12) : [], deaths: H ? H.deaths : 0, saved: H ? H.saved : 0, rate: NPC.knobOf(W, 'medicalTax'), med: H ? H.med : null },
    asuka: a && abands ? { avg: A.n ? Math.round(asum / A.n * 10) / 10 : 0, bands: abands, insured: ains, month: a.hachiM || null, last: a.hachiLast || null, rate: (a.rates && a.rates.medical) ?? null, figma: a.figma ? { cash: Math.round(a.figma.cash), staff: figmaStaff(W), last: a.figma.last, sales: a.figma.sales, founded: a.figma.founded } : null } : null
  };
}
// a person's 身分証明書 (ops/town.js and 街ライブ's card): their number, their insurance, their health
export function idCard(W, i) {
  const P = W.P, h = health.hpOf(P, i), b = health.band(h);
  return { no: 'VR-' + String(100000 + i).slice(1) + '-' + String(P.gen[i] % 100).padStart(2, '0'), insurance: plan(P.ins[i]).name, cover: coverOf(P.ins[i]), suspended: !!(P.ins[i] & SUSPENDED), welfare: !!(P.flags[i] & FL.welfare), health: h, band: b.name, care: P.care[i] === CARE.bed ? '入院中' : P.care[i] === CARE.rehab ? 'リハビリ中' : P.crit[i] ? `重篤（手術まで残り${P.crit[i]}分）` : '', chronic: P.ill[i] > 0, checked: P.chk[i] === monthNo(W.day || 0) };
}
void SERVICES; void fallbackR; void YEAR;
