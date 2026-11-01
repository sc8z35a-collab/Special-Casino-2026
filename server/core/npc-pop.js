// The 50,000 people (server/core/npc-model.js): each a row across columns of typed arrays (every person's same field
// side by side: a few hundred bytes each, some 20MB in all), made up once when the country begins and kept in the
// database as packed blobs (pack/unpack). What changes minute by minute (the money and what they own) is kept every
// few minutes; the rest of the mind with each hour and each day.
import { NPC, CORP } from './rules.js';
import { hash32 } from './npc-rand.js';

// traits (0..255): the Big Five, then the game's own
export const T = { open: 0, consc: 1, extra: 2, agree: 3, neuro: 4, risk: 5, impulse: 6, thrift: 7, vanity: 8, gamble: 9, patience: 10, learn: 11, loyalty: 12, car: 13, game: 14, news: 15, justice: 16, ambition: 17 };
export const NT = 18;
// skills
export const S = { tech: 0, sales: 1, manage: 2, create: 3, service: 4, drive: 5, negotiate: 6, speech: 7 };
// needs (255: met in full)
export const N = { fun: 0, thrill: 1, status: 2, security: 3, move: 4, social: 5, rest: 6, achieve: 7, fair: 8 };
export const NN = 9;
// feelings
export const E = { mood: 0, stress: 1, anger: 2, anxiety: 3, happy: 4 };
// marks
export const FL = { student: 1, famous: 2, candidate: 4, mayor: 8, unionRep: 16, leader: 32, striking: 64, moving: 128, founder: 256, rich: 512, exec: 1024, welfare: 4096, sick: 8192, defer: 16384, widow: 32768, rehired: 65536, union: 131072, newborn: 262144 };
export const MEM = 16, REL = 12, OWN = 8, LEARN = 12, LISTED = 4;
// room for the companies' views beyond the first ten (YOSIDA, WAZIMA and those to come)
const VIEW2 = 6;
// home: 0 rents, 1 owns, 2 lives with family, 3 stays with someone (居候), 4 on the street
export const HOME = { rent: 0, own: 1, family: 2, stay: 3, street: 4 };

// the columns: name, kind, width; `hot`: kept every few minutes (money and what is owned)
const COLS = [
  ['gen', Uint16Array, 1], ['sex', Uint8Array, 1], ['birth', Int32Array, 1], ['dist', Uint8Array, 1], ['hh', Int32Array, 1], ['hnext', Int32Array, 1], ['spouse', Int32Array, 1],
  ['fam', Uint16Array, 1], ['given', Uint16Array, 1], ['tr', Uint8Array, NT], ['sk', Uint8Array, 8],
  ['job', Uint8Array, 1], ['dept', Uint8Array, 1], ['rank', Uint8Array, 1], ['wdist', Uint8Array, 1], ['shift', Uint8Array, 1], ['salary', Float64Array, 1],
  ['tenure', Uint16Array, 1], ['jsat', Uint8Array, 1],
  ['cash', Float64Array, 1, true], ['debt', Float64Array, 1, true], ['dkind', Uint8Array, 1, true], ['credit', Uint8Array, 1, true], ['budget', Float64Array, 1, true],
  ['spent', Float64Array, 1, true], ['fund', Float64Array, 4, true], ['inc', Float64Array, 1, true], ['buyDay', Float64Array, 1, true],
  ['home', Uint8Array, 1, true], ['rent', Float64Array, 1, true], ['host', Int32Array, 1, true], ['stay', Uint16Array, 1, true],
  ['car', Uint8Array, 1, true], ['carDay', Int32Array, 1, true], ['vip', Int32Array, 1, true], ['phone', Uint8Array, 1, true], ['spun', Uint8Array, 1, true],
  ['owned', Uint16Array, OWN, true], ['tokens', Float64Array, 1, true], ['live', Uint8Array, 1, true], ['subs', Uint32Array, 1, true], ['sh', Float64Array, LISTED, true], ['flags', Uint32Array, 1, true],
  ['need', Uint8Array, NN], ['emo', Uint8Array, 5], ['health', Uint8Array, 1], ['disc', Uint8Array, 8], ['lean', Int8Array, 2], ['trust', Uint8Array, 5],
  ['penM', Uint16Array, 1], ['penPay', Float64Array, 1], ['penHalf', Uint16Array, 1], ['penDefer', Uint8Array, 1], ['penAmt', Float64Array, 1],
  ['jobless', Uint16Array, 1], ['joblessPay', Float64Array, 1],
  ['act', Uint8Array, 1], ['place', Uint8Array, 1], ['ldist', Uint8Array, 1], ['due', Int32Array, 1], ['upd', Int32Array, 1],
  ['mem', Uint32Array, MEM], ['memAt', Uint8Array, 1], ['rel', Int32Array, REL], ['close', Uint8Array, REL], ['rtrust', Uint8Array, REL],
  ['learn', Uint8Array, LEARN], ['view', Int8Array, 10], ['outlook', Int8Array, LISTED], ['aware', Uint32Array, 1], ['sign', Uint32Array, 1],
  ['vote', Uint8Array, 1], ['lastBig', Int32Array, 1], ['why', Uint16Array, 1], ['grief', Uint8Array, 1],
  // (columns added later, always last: a country kept before them has none, and they start at 0)
  ['view2', Int8Array, VIEW2, false, true],
  // (the orders a person made in the 投資 market today: at most NPC.life.tradesDay)
  ['trades', Uint8Array, 1, true, true],
  // (the local company one works for, its number in js/game/local.js: a local job's, その他・パート; 0: the small shops)
  ['firm', Uint8Array, 1, false, true]
];
export const COLUMNS = COLS.map(([name, kind, width, hot, late]) => ({ name, kind, width, hot: !!hot, late: !!late }));
// what a person thinks of company `k` (NPC.companies' order: the first ten in `view`, the rest in `view2`)
export const viewOf = (P, i, k) => (k < 10 ? P.view[i * 10 + k] : P.view2[i * VIEW2 + k - 10]) || 0;
export function setView(P, i, k, v) { if (k < 10) P.view[i * 10 + k] = v; else if (k - 10 < VIEW2) P.view2[i * VIEW2 + k - 10] = v; }
export function clearView(P, i) { P.view.fill(0, i * 10, i * 10 + 10); P.view2.fill(0, i * VIEW2, i * VIEW2 + VIEW2); }

export function alloc(n) {
  const P = { n };
  for (const c of COLUMNS) P[c.name] = new c.kind(n * c.width);
  return P;
}

// The people as blobs: every column's bytes one after another (the hot ones only, or all), cut into rows of at most
// `size` bytes for the database; and back.
const ROW = 1500000;
export function pack(P, hot = false) {
  const cols = COLUMNS.filter((c) => !hot || c.hot);
  let total = 0;
  for (const c of cols) total += P[c.name].byteLength;
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of cols) { const a = P[c.name]; all.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at); at += a.byteLength; }
  const rows = [];
  for (let i = 0; i < total; i += ROW) rows.push(all.subarray(i, Math.min(total, i + ROW)));
  return rows;
}
export function unpack(P, rows, hot = false) {
  const cols = COLUMNS.filter((c) => !hot || c.hot);
  let total = 0;
  for (const r of rows) total += r.byteLength;
  const all = new Uint8Array(total);
  let at = 0;
  for (const r of rows) { all.set(r instanceof Uint8Array ? r : new Uint8Array(r), at); at += r.byteLength; }
  at = 0;
  for (const c of cols) {
    const a = P[c.name], len = a.byteLength;
    // (a column added later that a country kept before it does not have: it stays at 0)
    if (c.late && at >= total) continue;
    if (at + len > total) throw new Error('npc: the blobs are shorter than the people');
    new Uint8Array(a.buffer, a.byteOffset, len).set(all.subarray(at, at + len));
    at += len;
  }
  return P;
}

/* ------------------------------------------------------------------ the people --- */
export const ageOf = (P, i, day) => Math.floor((day - P.birth[i]) / 365.25);
export const trait = (P, i, t) => P.tr[i * NT + t];
export const skill = (P, i, s) => P.sk[i * 8 + s];
export function nameOf(P, i) { return NPC.nameOf(P.fam[i], P.given[i], P.sex[i]); }
// the person's stable id: index and generation (a new life in the same place is another person)
export const pid = (P, i) => i * 65536 + P.gen[i];
export function memberList(P, head) {
  const out = [];
  for (let j = head, k = 0; j >= 0 && k < 16; j = P.hnext[j], k++) out.push(j);
  return out;
}
// join and leave a household (a list from its head through hnext)
export function joinHousehold(P, i, head) {
  P.hh[i] = head;
  if (head === i) { P.hnext[i] = -1; return; }
  let j = head;
  for (let k = 0; P.hnext[j] >= 0 && k < 32; k++) j = P.hnext[j];
  P.hnext[j] = i;
  P.hnext[i] = -1;
}
export function leaveHousehold(P, i) {
  const head = P.hh[i];
  if (head < 0) return;
  if (head === i) {
    // the next one in the list heads it now
    const next = P.hnext[i];
    for (let j = next; j >= 0; j = P.hnext[j]) P.hh[j] = next;
  } else {
    let j = head;
    for (let k = 0; j >= 0 && k < 32; k++) { if (P.hnext[j] === i) { P.hnext[j] = P.hnext[i]; break; } j = P.hnext[j]; }
  }
  P.hh[i] = -1;
  P.hnext[i] = -1;
}
export function remember(P, i, day, kind, power) {
  const k = P.memAt[i];
  P.mem[i * MEM + k] = ((day & 0xffff) << 16) | ((kind & 0xff) << 8) | (power & 0xff);
  P.memAt[i] = (k + 1) % MEM;
}
export function addRelation(P, i, j, close = 80, trust = 120) {
  if (i === j || j < 0) return;
  let slot = -1, weakest = 256;
  for (let k = 0; k < REL; k++) {
    const o = P.rel[i * REL + k];
    if (o === j) return;
    if (o < 0) { slot = k; break; }
    if (P.close[i * REL + k] < weakest) { weakest = P.close[i * REL + k]; slot = k; }
  }
  if (slot < 0 || (P.rel[i * REL + slot] >= 0 && weakest >= close)) return;
  P.rel[i * REL + slot] = j;
  P.close[i * REL + slot] = close;
  P.rtrust[i * REL + slot] = trust;
}

/* ---------------------------------------------------------------- the beginning --- */
// how many of each age there are at the start (plan §4.1), by the 50,000
const AGES = [[18, 29, 9700], [30, 39, 8100], [40, 49, 8000], [50, 59, 7800], [60, 69, 7300], [70, 79, 5600], [80, 95, 3500]];
// what everyone does at the start (plan §4.6), by the 50,000
const WORK = { civil: 1500, other: 1800, self: 900, part: 1500, home: 1500, student: 2000, none: 800, rehire: 1750 };
// what living in each district costs a month (rent), and how rich people there are against the country
// The money a person has when their life in the country begins (at its start, by their age and pay; a life begun
// since in the place of one that ended, at 18 with no pay yet): made from nothing, the only money there is besides the
// players' own at their start — every other $ is one somebody paid somebody (`z`: their luck, a normal draw).
const AGEW = (a) => (a < 30 ? 0.25 : a < 40 ? 0.6 : a < 50 ? 1 : a < 60 ? 1.4 : a < 70 ? 1.7 : a < 80 ? 1.6 : 1.4);
export function startMoney(age, salary, dist, z) {
  const inc = salary > 0 ? Math.pow(salary / 3900000, 0.6) : 0.8;
  return Math.round(60000000 * AGEW(age) * inc * Math.pow(DIST[dist].rich, 0.7) * Math.exp(0.9 * z));
}
const DIST = [{ rent: 180000, rich: 1.1, young: 1.1 }, { rent: 105000, rich: 0.8, young: 1 }, { rent: 115000, rich: 0.8, young: 1.6 }, { rent: 260000, rich: 2.2, young: 0.8 }, { rent: 120000, rich: 0.9, young: 0.6 }];
export const OTHER_PAY = { 11: 4000000, 12: 3000000, 13: 3500000, 14: 1300000 };
// the skills each company hires for
export const FIT = { tenesice: [S.manage, S.sales], magita: [S.tech, S.drive], carowner: [S.sales, S.service], jinx: [S.service, S.sales], daizin: [S.service, S.speech],
  citywork: [S.sales, S.speech], speedeed: [S.tech, S.create], dtrade: [S.tech, S.manage], riru: [S.create, S.tech], ice: [S.create, S.tech],
  yosida: [S.tech, S.drive], wazima: [S.tech, S.manage], myway: [S.create, S.sales] };

// The country's people on day `day` (a corp day), from the companies as they are (`corp`: { companies: { id: { staff,
// pay } } }) and the draws of `r`. Returns the people and what the companies' organisation needs (who works where).
export function makePeople(n, day, corp, r) {
  const P = alloc(n), scale = n / NPC.nation.population;
  P.rel.fill(-1);
  P.spouse.fill(-1);
  P.host.fill(-1);
  P.hh.fill(-1);
  P.hnext.fill(-1);
  // ages and the rest of who they are
  const quota = AGES.map(([a, b, k]) => [a, b, k * scale]);
  const sumQ = quota.reduce((s, q) => s + q[2], 0);
  for (let i = 0; i < n; i++) {
    let x = r.u() * sumQ, g = quota[0];
    for (const q of quota) { x -= q[2]; if (x < 0) { g = q; break; } }
    const age = g[0] + r.int(g[1] - g[0] + 1);
    P.birth[i] = day - Math.ceil(age * 365.25) - r.int(365);
    P.sex[i] = r.u() < (age >= 75 ? 0.58 : 0.5) ? 1 : 0;
    P.fam[i] = r.int(NPC.names.family.length);
    P.given[i] = r.int(P.sex[i] ? NPC.names.female.length : NPC.names.male.length);
    // the district: the young towards カナリア, the old towards リヴィエール, a few of the rich up on オーロラの丘
    const ws = DIST.map((d) => (age < 30 ? d.young : age >= 65 ? 2 - d.young : 1));
    P.dist[i] = r.weighted(ws);
    const t = P.tr.subarray(i * NT, i * NT + NT);
    for (let k = 0; k < NT; k++) t[k] = r.byte();
    // (the young take more risks; gamblers are impulsive; age makes careful)
    t[T.risk] = clampB(t[T.risk] + (40 - age) * 0.8);
    t[T.gamble] = clampB(0.6 * t[T.gamble] + 0.25 * t[T.impulse] + 0.15 * t[T.risk]);
    t[T.game] = clampB(t[T.game] + (35 - age) * 1.4);
    t[T.consc] = clampB(t[T.consc] + (age - 40) * 0.4);
    t[T.news] = clampB(t[T.news] + (age - 40) * 0.6);
    const sk = P.sk.subarray(i * 8, i * 8 + 8);
    for (let k = 0; k < 8; k++) sk[k] = clampB(r.byte(110, 35) + Math.min(60, (age - 18) * 1.5));
    for (let k = 0; k < NN; k++) P.need[i * NN + k] = 150 + r.int(80);
    P.emo[i * 5 + E.mood] = 140 + r.int(60);
    P.emo[i * 5 + E.happy] = 130 + r.int(70);
    P.emo[i * 5 + E.stress] = 40 + r.int(60);
    P.health[i] = clampB(235 - Math.max(0, age - 50) * 2.2 + r.z() * 12);
    P.lean[i * 2] = Math.round(r.z() * 40);
    P.lean[i * 2 + 1] = Math.round(r.z() * 40);
    for (let k = 0; k < 5; k++) P.trust[i * 5 + k] = r.byte(140, 30);
    for (let k = 0; k < 8; k++) P.disc[i * 8 + k] = r.byte(50, 25);
    for (let k = 0; k < LEARN; k++) P.learn[i * LEARN + k] = 128;
    P.credit[i] = r.byte(170, 40);
  }
  // students, the retired, and who works for whom
  const ages = new Int16Array(n);
  for (let i = 0; i < n; i++) ages[i] = ageOf(P, i, day);
  const order = shuffled(n, r);
  const want = {}, have = {};
  for (const [k, v] of Object.entries(WORK)) { want[k] = Math.round(v * scale); have[k] = 0; }
  const staff = {};
  let rehireAll = 0;
  for (const id of NPC.companies) { staff[id] = Math.round((corp.companies[id] ? corp.companies[id].staff : 0)); rehireAll += staff[id]; }
  const free = [];
  for (const i of order) {
    const a = ages[i];
    P.job[i] = 255;
    if (a <= 22 && have.student < want.student && r.u() < 0.72) { P.job[i] = NPC.job.student; P.flags[i] |= FL.student; have.student++; continue; }
    if (a >= 65) { P.job[i] = NPC.job.retired; continue; }
    free.push(i);
  }
  // the companies take theirs: the 60-64s first for their re-employed (いちど定年を迎えた再雇用), then by fit — the first
  // ten in full; the country's own civil servants next; then the companies that came home later (YOSIDA, WAZIMA), all
  // of them the same share of what they want when there are not enough people for it (their other posts stay open)
  const rehireShare = want.rehire / Math.max(1, rehireAll);
  const old = free.filter((i) => ages[i] >= 60 && ages[i] <= 64);
  const young = free.filter((i) => ages[i] >= 20 && ages[i] < 60);
  const taken = new Uint8Array(n);
  const fit = FIT;
  const take = (id, total) => {
    if (!total) return;
    const nOld = Math.min(Math.round(total * rehireShare), total);
    const pick = (pool, k, rehired) => {
      const f = fit[id];
      const cand = pool.filter((i) => !taken[i]).map((i) => [i, skill(P, i, f[0]) + skill(P, i, f[1]) + 60 * r.u()]);
      cand.sort((a, b) => b[1] - a[1]);
      let got = 0;
      for (let x = 0; x < k && x < cand.length; x++) {
        const i = cand[x][0];
        taken[i] = 1;
        P.job[i] = NPC.jobOf(id);
        if (rehired) P.flags[i] |= FL.rehired;
        got++;
      }
      return got;
    };
    const got = pick(old, nOld, true);
    const more = total - got - pick(young, total - got, false);
    // (the young run out: the 60-64s, kept on as the re-employed are)
    if (more > 0) pick(old, more, true);
  };
  const first = NPC.companies.slice(0, 10), later = NPC.companies.slice(10);
  for (const id of first) take(id, staff[id]);
  // the country's own servants before the companies that came later
  let civil = 0;
  for (const i of young) {
    if (civil >= want.civil) break;
    if (taken[i] || ages[i] < 22) continue;
    taken[i] = 1;
    P.job[i] = NPC.job.civil;
    civil++;
  }
  have.civil = civil;
  const room = young.filter((i) => !taken[i]).length + old.filter((i) => !taken[i]).length;
  const wantLater = later.reduce((a, id) => a + staff[id], 0), share = wantLater > room ? room / wantLater : 1;
  for (const id of later) take(id, Math.floor(staff[id] * share));
  // the country's own and the rest
  const rest = free.filter((i) => !taken[i]);
  const put = (k, code, test) => {
    for (const i of rest) {
      if (have[k] >= want[k]) return;
      if (P.job[i] !== 255 || !test(ages[i])) continue;
      P.job[i] = code;
      have[k]++;
    }
  };
  put('civil', NPC.job.civil, (a) => a >= 22 && a < 60);
  put('other', NPC.job.other, (a) => a < 60);
  put('self', NPC.job.self, (a) => a >= 25);
  put('home', NPC.job.home, (a) => a >= 25);
  put('none', NPC.job.none, (a) => a < 60);
  put('part', NPC.job.part, () => true);
  for (const i of rest) if (P.job[i] === 255) P.job[i] = ages[i] >= 60 ? NPC.job.retired : NPC.job.other;
  for (let i = 0; i < n; i++) if (P.job[i] === 255) P.job[i] = NPC.job.retired;
  return { P, ages };
}

// Households: couples, their grown-up children, the old with their families, and the ones who live alone (some 2.1
// people a household); then where they live and what it costs.
export function makeHomes(P, ages, day, r) {
  const n = P.n, byDist = [[], [], [], [], []];
  for (const i of shuffled(n, r)) byDist[P.dist[i]].push(i);
  for (const list of byDist) {
    const singles = list.filter((i) => ages[i] >= 24);
    const men = singles.filter((i) => P.sex[i] === 0), women = singles.filter((i) => P.sex[i] === 1);
    // couples: about 55% of the grown-ups, of ages near each other
    women.sort((a, b) => ages[a] - ages[b]);
    men.sort((a, b) => ages[a] - ages[b]);
    let w = 0;
    for (const m of men) {
      while (w < women.length && ages[women[w]] < ages[m] - 8) w++;
      if (w >= women.length) break;
      const f = women[w];
      if (ages[f] > ages[m] + 4 || r.u() > 0.62) continue;
      P.spouse[m] = f;
      P.spouse[f] = m;
      joinHousehold(P, m, m);
      joinHousehold(P, f, m);
      w++;
    }
    // the young living with parents of their district (about 40% of the under-30s), the rest on their own
    const heads = list.filter((i) => P.hh[i] === i && ages[i] >= 45 && ages[i] <= 70);
    for (const i of list) {
      if (P.hh[i] >= 0) continue;
      if (ages[i] < 30 && heads.length && r.u() < 0.42) {
        const h = heads[r.int(heads.length)];
        if (memberList(P, h).length < 5) { joinHousehold(P, i, h); continue; }
      }
      // (a few of the very old live with their children's families)
      if (ages[i] >= 82 && heads.length && r.u() < 0.3) {
        const h = heads[r.int(heads.length)];
        if (memberList(P, h).length < 5) { joinHousehold(P, i, h); continue; }
      }
      joinHousehold(P, i, i);
    }
  }
  return P;
}

// a company's people paid about its average `pay` by their post and years, exactly its average in all
export function payStaff(P, list, pay, ages, r, company = '') {
  if (!list.length) return;
  const ws = list.map((i) => {
    // (by the company's own ladder when it has one: MY WAY's, NPC.rankPay — its executives at their posts' pay exactly)
    const rank = NPC.rankPay(company, P.rank[i]);
    if (P.rank[i] >= 4 && rank !== (NPC.ranks[P.rank[i]] || {}).pay) return rank;
    const years = Math.max(0, Math.min(35, ages[i] - 22));
    return rank * (0.8 + years * 0.012) * (0.92 + 0.16 * r.u()) * (P.flags[i] & FL.rehired ? 0.6 : 1);
  });
  const total = Math.round(pay * list.length), sum = ws.reduce((a, b) => a + b, 0);
  let paid = 0;
  list.forEach((i, k) => { P.salary[i] = Math.round(total * ws[k] / sum); paid += P.salary[i]; });
  // (the cents of rounding on the first)
  P.salary[list[0]] += total - paid;
}
export function makeMoney(P, ages, day, corp, r) {
  const n = P.n;
  // pay: each company's people about its average by their post and years, exactly its average in all
  // (the posts are set by the organisation first: server/core/npc-org.js)
  for (let i = 0; i < n; i++) {
    const j = P.job[i];
    if (j >= 11 && j <= 14) P.salary[i] = Math.round(OTHER_PAY[j] * (0.75 + 0.5 * r.u()) * (1 + Math.max(0, ages[i] - 30) * 0.01));
  }
  NPC.companies.forEach((id, ci) => {
    const c = corp.companies[id];
    if (!c) return;
    const list = [];
    const code = NPC.jobOf(id);
    for (let i = 0; i < n; i++) if (P.job[i] === code) list.push(i);
    if (!list.length) return;
    payStaff(P, list, c.pay, ages, r, id);
    for (const i of list) P.tenure[i] = Math.min(65535, Math.max(1, Math.round((ages[i] - 22) * 12 * (0.3 + 0.7 * r.u()))));
  });
  // what they have: by age and pay, a long tail at the top (2% from $1B to $50B), the very rich mostly older
  for (let i = 0; i < n; i++) P.cash[i] = startMoney(ages[i], P.salary[i], P.dist[i], r.z());
  const top = shuffled(n, r).filter((i) => ages[i] >= 35).sort((a, b) => (P.cash[b] * (1 + r.u())) - (P.cash[a] * (1 + r.u())));
  const nTop = Math.round(n * 0.02);
  for (let k = 0; k < nTop && k < top.length; k++) {
    const i = top[k];
    P.cash[i] = Math.round(Math.min(50e9, 1e9 * Math.pow(1 - r.u(), -1 / 1.25)));
    P.flags[i] |= FL.rich;
  }
  // homes: owners more with age and money; the rest rent (a household's rent its head's)
  for (let i = 0; i < n; i++) {
    if (P.hh[i] !== i) { P.home[i] = HOME.family; continue; }
    const own = Math.max(0.1, Math.min(0.92, 0.18 + (ages[i] - 25) * 0.014 + P.cash[i] / 300000000));
    if (r.u() < own) P.home[i] = HOME.own;
    else { P.home[i] = HOME.rent; P.rent[i] = Math.round(DIST[P.dist[i]].rent * (0.7 + 0.8 * r.u()) * Math.pow(Math.max(0.2, P.cash[i] / 60000000), 0.12) / 1000) * 1000; }
  }
  // mortgages: about half the owners of 30–59 still paying for their home (a few years' pay, more for the rich)
  for (let i = 0; i < n; i++) {
    if (P.home[i] !== HOME.own || ages[i] < 30 || ages[i] >= 60 || r.u() > 0.5) continue;
    P.debt[i] = Math.round(Math.max(20000000, (P.salary[i] || 3000000) * (6 + 6 * r.u())) * (1 - (ages[i] - 30) / 40) / 1000) * 1000;
    P.dkind[i] = 1;
  }
  // loans: about a fifth of the working ages owe something besides (a car, the rest), at the rates of the time
  for (let i = 0; i < n; i++) {
    if (ages[i] < 25 || ages[i] > 64 || P.debt[i] > 0 || r.u() > 0.2) continue;
    P.debt[i] = Math.round(Math.max(1000000, P.salary[i] || 2000000) * (0.5 + 2.5 * r.u()) / 1000) * 1000;
    P.dkind[i] = 1;
  }
  // the pension so far (what was paid in, on what pay) and, for those already taking it, how much a month
  for (let i = 0; i < n; i++) {
    const a = ages[i], years = Math.max(0, Math.min(a, 60) - 18);
    P.penM[i] = Math.min(504, Math.round(years * 12 * (0.82 + 0.18 * r.u())));
    const pay = P.salary[i] > 0 ? P.salary[i] / 12 : 300000 * (0.7 + 0.6 * r.u());
    P.penPay[i] = Math.round(pay * 0.85);
    if (a >= 60 && (P.job[i] === NPC.job.retired || P.flags[i] & FL.rehired || r.u() < 0.6)) P.penAmt[i] = pensionMonthly(P, i, 0);
  }
  for (let i = 0; i < n; i++) {
    P.phone[i] = 0;
    P.lastBig[i] = day - r.int(60);
  }
  return P;
}

// A month of the pension (国民年金 by the months paid; 厚生年金 by the pay and the months worked; `up`: a later start's
// share more; `level`: the council's change in %)
export function pensionMonthly(P, i, up = 0, level = 0) {
  const PEN = NPC.pension;
  const months = P.penM[i] - P.penHalf[i] / 2;
  if (P.penM[i] < PEN.minMonths) return 0;
  const basic = PEN.basic * Math.min(1, months / PEN.fullMonths) / 12;
  const worked = P.flags[i] & FL.rehired || NPC.employed(P.job[i]) || P.penPay[i] > 260000 ? P.penM[i] : P.penM[i] * 0.3;
  const kosei = P.penPay[i] * PEN.rate * worked / 12;
  return Math.round((basic + kosei) * (1 + up) * (1 + level / 100));
}

function shuffled(n, r) {
  const a = new Int32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  for (let i = n - 1; i > 0; i--) { const j = r.int(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return Array.from(a);
}
const clampB = (x) => Math.max(0, Math.min(255, Math.round(x)));
export { clampB, shuffled };

// relations at the start: the household, the colleagues of the same department, neighbours, a few friends anywhere
export function makeRelations(P, ages, r) {
  const n = P.n;
  for (let i = 0; i < n; i++) {
    if (P.spouse[i] >= 0) addRelation(P, i, P.spouse[i], 220, 220);
    for (const j of memberList(P, P.hh[i] >= 0 ? P.hh[i] : i)) if (j !== i) addRelation(P, i, j, 180, 190);
  }
  // colleagues: the same employer and department, by a list of each
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    if (!NPC.working(P.job[i])) continue;
    const k = P.job[i] * 256 + P.dept[i];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (const i of list) for (let k = 0; k < 3; k++) addRelation(P, i, list[r.int(list.length)], 70 + r.int(60), 100 + r.int(60));
  }
  const byDist = [[], [], [], [], []];
  for (let i = 0; i < n; i++) byDist[P.dist[i]].push(i);
  for (let i = 0; i < n; i++) {
    const near = byDist[P.dist[i]];
    for (let k = 0; k < 2; k++) addRelation(P, i, near[r.int(near.length)], 50 + r.int(60), 90 + r.int(60));
    // friends of about the same age, anywhere
    for (let k = 0; k < 3; k++) {
      const j = r.int(n);
      if (Math.abs(ages[j] - ages[i]) < 12) addRelation(P, i, j, 90 + r.int(90), 110 + r.int(80));
    }
  }
  // (and the other way round, mostly)
  for (let i = 0; i < n; i++) for (let k = 0; k < REL; k++) {
    const j = P.rel[i * REL + k];
    if (j >= 0 && hash32(i * 31 + j) % 3) addRelation(P, j, i, P.close[i * REL + k], P.rtrust[i * REL + k]);
  }
}
