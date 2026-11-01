// NPCの国 (js/game/npc.js; the plan: docs/npc-plan.md): 50,000 people in five districts, worked out a minute at a time
// while they are about and a day at a time with the companies (server/core/corp-model.js). Nothing here touches the
// database (server/core/npc.js keeps it): a world is the people's columns (npc-pop.js) and a plain object of the rest,
// and the same world with the same minutes and days always comes to the same next world, from the server's key.
//
// Every $ moves from someone to someone in the country: the people pay the companies (their sales, waiting in the
// day's flows until the company's day closes), the local businesses and the country; the companies pay the people,
// the country and each other; the country pays the people and the companies. What comes in from outside is only the
// players' money (and the companies' imports go out): server/test/npc.test.js counts it to the dollar.
import { NPC, CORP, RULES, STOCKS } from './rules.js';
import { seeded, hash32 } from './npc-rand.js';
import * as pop from './npc-pop.js';
import { T, FL, HOME, NT, LISTED, ageOf, remember } from './npc-pop.js';
import * as econ from './npc-econ.js';
import { decide, skillFor, talk, M } from './npc-life.js';
import * as mind from './npc-mind.js';
import * as state from './npc-state.js';
import { createPolitics } from './npc-politics.js';
import { createLabor } from './npc-labor.js';
import * as org from './npc-org.js';
import { createMarket, LISTED_IDS } from './npc-market.js';
import * as text from './npc-text.js';

const MIN = 60000, DAY_MIN = 1440;
export { LISTED_IDS };

/* ---------------------------------------------------------------- the beginning --- */
// The country on minute `now` (ms): its people made up from the key, set in the companies as the companies are
// (`corp`: the companies' world, server/core/corp.js), holding the listed companies' shares the players and the
// companies do not (`held`: { company: shares the players hold }); the first day (Japan's date) its people are about
// all day long.
export function boot(key, now, corp, { n = NPC.nation.population, held = {} } = {}) {
  const r = seeded(key, 'boot');
  const day = Math.floor(now / 86400000), first = NPC.jst(now).date;
  const scale = n / NPC.nation.population;
  const view = { companies: {} };
  for (const id of NPC.companies) { const s = corp.co[id]; view.companies[id] = { staff: Math.round(s.n * scale), pay: s.pay }; }
  const { P, ages } = pop.makePeople(n, day, view, r);
  pop.makeHomes(P, ages, day, r);
  const W = blank(key, n, scale, first, day, Math.floor(now / MIN) - 1);
  W.P = P;
  attach(W);
  org.assign(W, ages, r);
  pop.makeMoney(P, ages, day, view, r);
  pop.makeRelations(P, ages, r);
  own(W, ages, day, corp, held, r);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < NPC.companies.length; k++) pop.setView(P, i, k, Math.round(r.z() * 25));
    P.jsat[i] = r.byte(160, 35);
    P.shift[i] = r.int(2);
    P.upd[i] = W.minute;
    P.due[i] = W.minute + 1 + (hash32(i, 11) % 15);
  }
  W.labor.first(W);
  calibrate(W, corp, day);
  for (let i = 0; i < n; i++) state.budgetOf(W, i, ageOf(P, i, day), r);
  state.owners(W);
  W.politics.first(W, day, r);
  refresh(W, day, { corp });
  stats(W, day);
  W.news.push({ day, kind: 'nation', district: -1, text: `${NPC.nation.name}が始まりました（人口${n.toLocaleString('en-US')}人・5つの区）`, data: {} });
  return W;
}
// A company that failed (倒産: server/core/corp-model.js bankrupt): every one of its people out of work at once — with
// the unemployment benefit, no severance (there is no money for it) —, its union gone, its organisation kept only as it
// was (its meetings stop: server/core/npc-org.js), and the country hears of it
export function failed(W, id, day) {
  const P = W.P, staff = W.staffOf(id).slice();
  for (const i of staff) W.labor.leave(W, i, day, 'fired');
  W._staff = null;
  if (W.lab.unions[id]) { W.lab.unions[id].members = 0; W.lab.unions[id].state = 'idle'; }
  if (W.orgs[id]) W.orgs[id].dead = day;
  const hq = NPC.districts.find((d) => d.hq.includes(id));
  W.news.push({ day, kind: 'labor', district: hq ? hq.id : -1, text: `${CORP.company(id).name}が倒産し、社員${staff.length.toLocaleString('en-US')}人が職を失いました`, data: { company: id } });
  void P;
  return staff.length;
}
// A company that has come home (its head office moved into the country: YOSIDA, WAZIMA) to a country that was already
// living: it puts out its openings (募集) and takes at once, by their skills, those of working age who are out of work
// or in work of another kind (part time, another workplace, their own business), up to what it plans to have; its
// posts are given, its pay set about its average, its union begun; the rest it hires through the job sites as they
// come (server/core/npc-labor.js openings). Returns the companies that came, with how many they took.
// which companies are still to make their welcome: in the companies' world and alive, and either without an
// organisation in the country or with one made empty (the country began before the company had come home) and never
// welcomed — else such a company never had its people (WAZIMA, MY WAY)
export function toWelcome(W, corp) {
  return NPC.companies.filter((id) => {
    const c = corp && corp.co[id], o = W.orgs[id];
    if (!c || c.dead) return false;
    return !o || (!o.came && !W.staffOf(id).length);
  });
}
export function welcome(W, corp, day) {
  const P = W.P, came = [];
  const ids = toWelcome(W, corp);
  if (!ids.length) return came;
  const ages = new Int16Array(P.n);
  for (let i = 0; i < P.n; i++) ages[i] = ageOf(P, i, day);
  // those who may come: of working age, out of work or in work of another kind (never a civil servant, a student or a mayor)
  const J = NPC.job, first = { [J.none]: 2, [J.part]: 1.5, [J.other]: 1, [J.self]: 0.5, [J.home]: 0.2 };
  const pool = [];
  for (let i = 0; i < P.n; i++) if (first[P.job[i]] !== undefined && ages[i] >= 20 && ages[i] < 60 && !(P.flags[i] & (FL.student | FL.mayor))) pool.push(i);
  // (what each plans to have — already for the country's size once the companies live on it, never more than its size
  // for the country by a third —, all the same share of it when there are not enough people)
  const wants = ids.map((id) => { const c = corp.co[id], size = CORP.company(id).staff * W.scale; return Math.max(1, Math.round(Math.min(c.target || c.n || size, size * 1.3))); });
  const total = wants.reduce((a, b) => a + b, 0), share = total > pool.length ? pool.length / total : 1;
  const taken = new Uint8Array(P.n);
  ids.forEach((id, k) => {
    const c = corp.co[id], r = seeded(W.key, 'welcome:' + id), want = wants[k], f = pop.FIT[id] || [0, 1];
    const cand = pool.filter((i) => !taken[i]).map((i) => [i, first[P.job[i]] + (P.sk[i * 8 + f[0]] + P.sk[i * 8 + f[1]]) / 255 + r.u()]);
    cand.sort((a, b) => b[1] - a[1]);
    const hired = cand.slice(0, Math.floor(want * share)).map((x) => x[0]), code = NPC.jobOf(id), site = NPC.sites[id] || [[0, 1]];
    for (const i of hired) {
      taken[i] = 1;
      P.job[i] = code;
      P.flags[i] &= ~(FL.student | FL.rehired);
      P.rank[i] = 0;
      P.tenure[i] = 0;
      P.jsat[i] = 175;
      P.jobless[i] = 0;
      P.joblessPay[i] = 0;
      P.wdist[i] = site[r.weighted(site.map((s) => s[1]))][0];
      P.shift[i] = r.int(2);
    }
    W._staff = null;
    org.assignOne(W, id, ages, r);
    W.orgs[id].came = day;
    pop.payStaff(P, hired, c.pay || CORP.company(id).salary, ages, r, id);
    W.labor.join(W, id, hired, r);
    for (const i of hired) remember(P, i, day, M.hired, 150);
    const hq = NPC.districts.find((d) => d.hq.includes(id));
    W.news.push({ day, kind: 'labor', district: hq ? hq.id : -1, text: `${CORP.company(id).name}が本社を${hq ? hq.name : '国内'}に構え、社員${hired.length.toLocaleString('en-US')}人を採用しました${hired.length < want ? `（募集はあと${(want - hired.length).toLocaleString('en-US')}人）` : ''}`, data: { company: id } });
    came.push({ id, hired: hired.length, want });
  });
  W._staff = null;
  return came;
}
function blank(key, n, scale, first, day, minute) {
  const stockCars = {};
  for (const c of RULES.cars) if (c.price > 0 && !c.ended) stockCars[c.id] = CORP.firstLot(c.id, scale);
  return {
    v: 1, key, n, scale, first, start: day, minute, day,
    cal: {}, sum: { toCo: 0, imports: 0, fromPlayers: 0, toPlayers: 0, divRest: 0, lent: 0, repaid: 0, bets: 0, traded: 0, marketSlip: 0, quickLoans: 0, staying: 0, homeless: 0, deaths: 0, born: 0, hired: 0, month: 0, made: 0 },
    nation: { cash: 0, debt: 0, bank: 0, fund: { cash: 0, bonds: 0, paid: 0 }, knobs: Object.fromEntries(NPC.knobs.map((k) => [k.id, k.start])), ranges: {}, locks: {}, pending: [], changed: {}, log: [],
      day: { in: {}, out: {} }, month: { in: {}, out: {} }, year: { days: 0 }, hist: [] },
    districts: NPC.districts.map((d) => ({ id: d.id, name: d.name, cash: 0, mayor: -1, mayorGen: 0, platform: [], approval: 50, since: 0, until: 0, promises: [], economy: 1, day: { in: {}, out: {} }, hist: [] })),
    sector: { cash: 0, inPeople: 0, inCompanies: 0, inNation: 0, outPeople: 0 },
    stats: {}, orgs: {}, priv: {}, fl: {}, flowsDone: null,
    bankRates: { person: 0.025, auto: 0.02, deposit: 0.002 },
    priceIdx: {}, priceUntil: {}, appeal: {}, appealUntil: {}, boycott: {}, siteShare: 0.65, raises: {},
    coShare: {}, coSharePrev: {}, coTrend: {}, coWeek: {}, segment: {}, titles: [], liveGames: [], stock: { cars: stockCars, orders: [], lots: {} },
    outlook: { jobLoss: 0.004, market: 1 }, depth: 'standard', work: {}, workHours: {}, capacity: {}, crunch: {}, overtime: {},
    news: [], meetings: [], reports: [], events: [], reasons: [], convos: [], ai: [], corpOps: [], talks: 0,
    reasonLog: 0.02, talkLog: 0.002, demoToday: {}, richest: 0, frameAt: 0
  };
}
// what holds the world's functions (not kept): the people's helpers and the parts made of its plain data
export function attach(W) {
  // (a knob added after the country began starts where the rules say)
  for (const k of NPC.knobs) if (W.nation.knobs[k.id] === undefined) W.nation.knobs[k.id] = k.start;
  W.knobChanged = (id, was, now) => state.knobChanged(W, id, was, now);
  W.market = createMarket(W);
  W.politics = createPolitics(W);
  W.labor = createLabor(W);
  W.org = { vacate: org.vacate, deptFor: (id, r) => org.deptFor(W, id, r), boss: (id) => org.boss(W, id) };
  W.ventureUse = org.ventureUse;
  W.fitFor = (P, i, id) => skillFor(P, i, id);
  W.hire = (i, o, day, r) => { W.labor.hire(W, i, o, day, r); W._staff = null; };
  W.staffOf = (id) => {
    if (!W._staff) {
      W._staff = {};
      for (const c of NPC.companies) W._staff[c] = [];
      const P = W.P;
      for (let i = 0; i < P.n; i++) { const c = NPC.companyOf(P.job[i]); if (c) W._staff[c].push(i); }
    }
    return W._staff[id] || [];
  };
  W.card = (i, day) => card(W, i, day);
  // one of a car sold (to a person or a player): one fewer at Car Owner, and the last one ordered again at once
  W.carSold = (id) => { if (W.stock.cars[id] > 0) W.stock.cars[id]--; if (W.stock.cars[id] === 0) orderCar(W, id, W.day); };
  // a company's money to another company (a placement fee) or out to the local businesses or to a person: with the day's flows
  W.charge = (from, to, stream, n, person = -1) => {
    if (!(n > 0)) return;
    econ.flowsOf(W, W.day).charges.push({ from, to, stream, n: Math.round(n), person });
    W._staff = null;
  };
  // a car traded in: MAGITA Robert buys it (the used-car trade is MAGITA's)
  W.flowsBuyback = (day, n) => {
    const f = econ.flowsOf(W, W.day), c = f.co.magita || (f.co.magita = { s: {}, p: {}, t: {}, l: {}, cat: 0 });
    c.buyback = (c.buyback || 0) + n;
    W.sum.toCo -= n;
  };
  return W;
}

// what the people own at the start: cars (by what they can afford and how keen they are), VIP (the rich and vain),
// the games they own and play, the listed companies' shares (the founders' and the investors'), the unlisted ones'
// (their founders and backers)
function own(W, ages, day, corp, held, r) {
  const P = W.P, n = P.n, cars = mind.carList({});
  for (let i = 0; i < n; i++) {
    if (ages[i] < 20) continue;
    const keen = P.tr[i * NT + T.car] / 255, money = P.cash[i];
    if (r.u() > 0.25 + 0.45 * keen) continue;
    const fit = cars.filter((c) => c.price < money * 0.6);
    if (!fit.length) continue;
    const c = fit[r.weighted(fit.map((x) => x.npc))];
    P.car[i] = c.k;
    P.carDay[i] = day - r.int(8 * 365);
  }
  const rich = [];
  for (let i = 0; i < n; i++) if (P.cash[i] > 300000000) rich.push([i, P.cash[i] * (0.5 + P.tr[i * NT + T.vanity] / 255)]);
  rich.sort((a, b) => b[1] - a[1]);
  const vips = Math.round(600 * W.scale);
  for (let k = 0; k < vips && k < rich.length; k++) P.vip[rich[k][0]] = day + 30 + r.int(300);
  for (let i = 0; i < n; i++) if (P.tr[i * NT + T.game] > 180 && r.u() < 0.35) P.live[i] = 1 + r.int(2);
  // the richest of all (an estate with no heirs, its shares, go to the market through them)
  let top = 0;
  for (let i = 1; i < n; i++) if (P.cash[i] > P.cash[top]) top = i;
  W.richest = top;
  // shares: each company's founders (a rich family of the older people) hold their part; the rest of what is not
  // the players' or a company's is the investors', by their money and their taste for risk
  const investors = [];
  for (let i = 0; i < n; i++) if (P.cash[i] > 30000000 && P.tr[i * NT + T.risk] > 90) investors.push(i);
  const wsum = investors.reduce((s, i) => s + Math.pow(P.cash[i], 1.05) * P.tr[i * NT + T.risk], 0);
  const founders = rich.map((x) => x[0]).filter((i) => ages[i] >= 50);
  NPC.companies.forEach((id, ci) => {
    const s = corp.co[id], p = CORP.company(id);
    const out = s.sh.issued - s.sh.treasury;
    const byCo = Object.values(s.hold.by || {}).reduce((a, b) => a + b, 0);
    const playersHeld = held[id] || 0;
    const people = Math.max(0, out - byCo - playersHeld);
    const fam = founders.length ? founders[ci % founders.length] : W.richest;
    P.flags[fam] |= FL.founder | FL.famous;
    const fShares = Math.min(people, Math.round(out * (p.founders || 0)));
    const k = LISTED_IDS.indexOf(id);
    const give = (i, x) => {
      if (x <= 0) return;
      if (k >= 0) P.sh[i * LISTED + k] += x;
      else { const l = W.priv[id] || (W.priv[id] = []); const h = l.find((y) => y[0] === i); if (h) h[1] += x; else l.push([i, x]); }
    };
    give(fam, fShares);
    let left = people - fShares;
    // (the unlisted ones are held by the few: the richest investors)
    const pool = k >= 0 ? investors : investors.filter((i) => P.cash[i] > 500000000).slice(0, 60);
    const ps = pool.reduce((a, i) => a + Math.pow(P.cash[i], 1.05) * P.tr[i * NT + T.risk], 0) || 1;
    for (const i of pool) {
      if (left <= 0) break;
      const x = Math.min(left, Math.floor((people - fShares) * Math.pow(P.cash[i], 1.05) * P.tr[i * NT + T.risk] / ps));
      give(i, x);
      left -= x;
    }
    give(pool.length ? pool[0] : fam, left);
  });
  void wsum;
}

/* ---------------------------------------------------------------- the calibration --- */
// What the people's habits are scaled by, once, at the start: so that what they would spend at each company, by their
// own weights and money, comes to about what it sells today (its streams as its books know them). From then on what
// they spend is theirs: their money, their moods, the prices, the news.
function calibrate(W, corp, day) {
  const P = W.P, c = W.cal, sc = W.scale;
  const co = (id) => corp.co[id], prof = (id) => CORP.company(id);
  const flex = (id, stream) => prof(id).sales * ((co(id).share && co(id).share[stream]) || 0);
  let households = 0, carOwners = 0, gamblers = 0;
  for (let i = 0; i < P.n; i++) {
    if (P.hh[i] === i) households += Math.pow(pop.memberList(P, i).length, 0.75) * Math.pow(Math.max(0.02, (P.cash[i] + 1) / 60000000), 0.22) * (1 - 0.35 * P.tr[i * NT + T.thrift] / 255);
    if (P.car[i]) carOwners++;
    if (P.tr[i * NT + T.gamble] > 115) gamblers++;
  }
  // daily living: ジンクス's goods (80% of its 一般商品売上 at the start), the local shops' the rest
  c.living = Math.round(flex('jinx', 'goods') * sc * 0.3 / 0.62 / 365 / Math.max(1, households));
  c.service = Math.round(flex('carowner', 'service') * sc / 12 / Math.max(1, carOwners) / 1.3);
  // the Shop's items: what the customers outside bought a year, now by the car owners on their trips (some 40 a year)
  c.items = {};
  for (const [id, pr] of Object.entries(CORP.products.items)) {
    if (id === 'omamori') continue;
    c.items[id] = pr.npc * sc / Math.max(1, carOwners * 95);
  }
  c.charm = Math.min(0.5, CORP.products.items.omamori.npc * sc / Math.max(1, gamblers * 30));
  c.vipFee = Math.round(prof('daizin').sales * 0.7 * sc / 12 / Math.max(1, Math.round(600 * sc)));
  c.lounge = 40000;
  c.lunch = 1500;
  c.medical = 30000;
  c.hourly = 1300;
  c.minBet = RULES.bets[0] * RULES.tokenPrice * 10;
  c.carUrge = 0.004;
  c.gameBuy = 0.2;
  c.catalog = 0.04;
  // the shares of a month's budget: worked out from the people's own budgets and weights at these scales
  c.casino = 1; c.games = 1; c.leisureShare = 0.22; c.invest = 1;
  let bud = { casino: 0, games: 0, invest: 0, leisure: 0 };
  for (let i = 0; i < P.n; i++) {
    state.budgetOf(W, i, ageOf(P, i, day), { u: () => 0.5 });
    bud.casino += P.fund[i * 4];
    bud.games += P.fund[i * 4 + 1];
    bud.leisure += P.fund[i * 4 + 2];
    bud.invest += P.fund[i * 4 + 3];
  }
  const dtrade = prof('dtrade').sales * sc;
  const betsYear = dtrade * 0.55 / (1 - econ.slotMean());
  c.casino = Math.min(8, betsYear / 12 / Math.max(1, bud.casino) * 1.1);
  const studios = (2800000000 + 26000000000) * sc;
  c.games = Math.min(8, studios / 12 / Math.max(1, bud.games) * 4);
  c.livePlay = Math.round(studios * 0.11 / 12 / Math.max(1, P.n * 0.06));
  // the market: a twelfth of a year's trading (what Dtrade's 受入手数料 says it was) each month, as buys
  const tradeYear = dtrade * 0.3 / (STOCKS.feeBp / 10000) / 2;
  c.invest = Math.min(0.5, tradeYear / 12 / Math.max(1, bud.invest) * 2.5);
  c.leisure = Math.round(bud.leisure / Math.max(1, P.n));
  c.publicWorks = Math.round(12000000000 * sc);
  c.grants = [3e9, 3e9, 3.2e9, 2e9, 5e9].map((x) => Math.round(x * sc));
  c.sectorCushion = Math.round(5e9 * sc);
  c.nationFloor = Math.round(20e9 * sc);
  c.districtCushion = Math.round(5e8 * sc);
  // the country's money at the start: its account, the pension fund (some 4 years of its payments, half in its
  // bonds), the districts' accounts, the local businesses'; and its debt: the bonds the companies, the fund and Tenesice hold
  let pensions = 0;
  for (let i = 0; i < P.n; i++) pensions += P.penAmt[i] * 12;
  W.nation.cash = Math.round(60e9 * sc);
  W.nation.fund.cash = Math.round(pensions * 2);
  W.nation.fund.bonds = Math.round(pensions * 2);
  let bonds = 0;
  for (const id of NPC.companies) if (id !== 'tenesice') bonds += corp.co[id].bal.bonds || 0;
  W.nation.debt = bonds + W.nation.fund.bonds;
  // the country's old debt, held by Tenesice (its bonds: what the bank's book abroad became), at its rate
  W.nation.bank = Math.round(3e12 * sc);
  c.bank0 = W.nation.bank;
  W.nation.debt += W.nation.bank;
  W.nation.bankRate = 0.01;
  W.districts.forEach((d, k) => { d.cash = Math.round(c.grants[k] * 0.5); });
  W.sector.cash = c.sectorCushion;
  // (what the country began with, in money: the people's, the country's, the districts', the local businesses')
  let people = 0;
  for (let i = 0; i < P.n; i++) people += P.cash[i] - P.debt[i];
  W.sum.made = people + W.nation.cash + W.nation.fund.cash + W.districts.reduce((a, d) => a + d.cash, 0) + W.sector.cash;
}

/* ---------------------------------------------------------------- the minutes --- */
// The minute `m` (minutes since 1970): everyone whose time has come decides what next; the people's orders on the
// market are matched. `ctx`: { corp (the companies' world, read only), carPrice(id), stockPrice(id), fair { id: worth a share } }.
export function tick(W, m, ctx) {
  const P = W.P, j = NPC.jst(m * MIN), t = j.min, r = seeded(W.key, 'm:' + m);
  W.minute = m;
  // (after a rest, everyone takes up their day again over a quarter of an hour)
  if (W.lastTick !== m - 1) for (let i = 0; i < P.n; i++) if (P.due[i] < m) P.due[i] = m + (hash32(i, m) % 15);
  W.lastTick = m;
  for (let i = 0; i < P.n; i++) if (P.due[i] <= m) decide(W, i, m, t, j, r, ctx);
  W.market.auction(W, m, ctx);
}

/* ---------------------------------------------------------------- the days --- */
// What the companies' day `day` takes from the country (server/core/corp-model.js closeDay's flows.npc): the people's
// money waiting for them, how many work for each and at what pay, the people's money and debts at the bank, what
// their people decided (budgets, hiring, research), the terms MAGITA agreed, Tenesice's lending, the raises.
export function flowsFor(W, day) {
  const P = W.P, f = econ.takeFlows(W, day);
  W.flowsDone = f;
  // (those out on strike are not paid for it: the company counts only those at work)
  const staff = {};
  for (const id of NPC.companies) {
    const st = W.staffOf(id);
    let pay = 0, n = 0, all = 0;
    for (const i of st) { all += P.salary[i]; if (P.flags[i] & FL.striking) continue; pay += P.salary[i]; n++; }
    staff[id] = { n, pay: n ? pay / n : st.length ? all / st.length : 0 };
  }
  // (the raises the unions settled in this year's talks: the companies give them from April)
  const raises = {}, year = CORP.ymd(day).y;
  for (const [id, u] of Object.entries(W.lab.unions || {})) if (u.state === 'settled' && W.lab.talks && W.lab.talks.year === year) raises[id] = u.raise;
  let deposits = W.nation.cash + W.nation.fund.cash + W.districts.reduce((a, d) => a + d.cash, 0) + W.sector.cash, loans = W.nation.bank;
  for (let i = 0; i < P.n; i++) { deposits += P.cash[i] + P.tokens[i]; loans += P.debt[i]; }
  const ops = [];
  for (const o of W.corpOps.splice(0)) {
    if (o.kind === 'terms') { W.terms = W.terms || {}; W.terms[o.buyer] = Math.round((W.terms[o.buyer] || 1) * o.mult * 10000) / 10000; }
    else if (o.kind === 'lend') { W.lend = W.lend || {}; W.lend[o.company] = { rate: o.rate, cap: o.cap, rank: o.rank || 'A' }; }
    else ops.push(o);
  }
  return { co: f.co, bank: { ...f.bank, deposits: Math.max(0, deposits), loans, rate: W.bankRates.deposit }, charges: f.charges, staff, raises, terms: W.terms || {}, lend: W.lend || {}, ops };
}
// The companies' day `day` closed (`ext`: what it paid out, server/core/corp-model.js); the country's next day begins
// (its money from the companies, its bills and benefits, lives, work, politics, the companies' people's minds).
export function nextDay(W, day, ext, ctx) {
  const r = seeded(W.key, 'd:' + (day + 1));
  W._staff = null;
  state.fromCompanies(W, ext, day);
  // a company that failed (MY WAY): its people let go
  for (const id of (ext && ext.bankrupt) || []) failed(W, id, day + 1);
  const next = day + 1;
  W.day = next;
  refresh(W, next, ctx);
  state.dayStart(W, next, r, ctx);
  W.politics.day(W, next, r);
  org.orgDay(W, next, r, ctx);
  restock(W, next);
  W._staff = null;
  stats(W, next);
  W.nation.hist.push({ day: next, prices: W.stats.prices, cash: W.nation.cash, debt: W.nation.debt, fund: W.nation.fund.cash + W.nation.fund.bonds, in: W.nation.day.in, out: W.nation.day.out });
  if (W.nation.hist.length > 400) W.nation.hist.shift();
  for (const d of W.districts) { d.hist.push({ day: next, cash: d.cash, approval: Math.round(d.approval), economy: Math.round(d.economy * 1000) / 1000 }); if (d.hist.length > 200) d.hist.shift(); }
  for (const e of W.events.splice(0)) { const nw = text.eventNews(W, e, next); if (nw) W.news.push({ day: next, ...nw, data: {} }); }
}
// what the people see of the companies today: the games on sale, the running games, the time-limited prices and
// appeals that ended, the bank's rates, each company's work of yesterday against usual (its capacity)
function refresh(W, day, ctx) {
  const corp = ctx.corp;
  if (corp) {
    W.titles = [];
    for (const id of ['riru', 'ice']) {
      const s = corp.co[id];
      if (!s) continue;
      for (const t of s.titles || []) W.titles.push({ key: (hash32(t.id.length + id.length * 7, t.day) & 0xffff) || 1, company: id, id: t.id, name: t.name, genre: t.genre, q: t.q, day: t.day, price: t.price, buzz: (W.appeal[id + ':games'] || 0) + (W.appeal[id + ':all'] || 0) + (W.appeal['jinx:games'] || 0) + (t.hit > 0 ? 0.4 : 0) });
      if (id === 'ice') W.liveGames = (s.live || []).map((l) => ({ company: id, id: l.id, name: l.name }));
    }
    W.surchargeOn = !!(corp.co.magita && corp.co.magita.surcharge);
    // the economy (the people choose MAGITA's dear cars in good times, YOSHIDA's cheap ones in bad) and what each
    // carmaker's development work has won it
    W.econX = corp.econ ? corp.econ.x || 0 : 0;
    W.makerEdge = Object.fromEntries(Object.keys(CORP.makers).map((id) => [id, corp.co[id] && corp.co[id].rnd ? corp.co[id].rnd.edge : 1]));
    // a studio's last weeks before a release: longer days (クランチ), unless the country's overtime limit is low
    W.crunch = {};
    for (const id of ['riru', 'ice']) {
      const s = corp.co[id];
      if (s && (W.nation.knobs.overtime || 45) >= 40 && (s.projects || []).some((p) => p.due > day && p.due - day <= 60)) W.crunch[NPC.jobOf(id)] = 1;
    }
  }
  // (campaigns' prices end on their day; a world from before kept them with the prices themselves)
  W.priceTemp = W.priceTemp || {};
  for (const [k, until] of Object.entries(W.priceUntil || {})) { W.priceTemp[k] = { mult: W.priceIdx[k] || 1, until }; delete W.priceIdx[k]; delete W.priceUntil[k]; }
  for (const [k, t] of Object.entries(W.priceTemp)) if (t.until <= day) delete W.priceTemp[k];
  for (const [k, until] of Object.entries(W.appealUntil)) if (until <= day) { delete W.appeal[k]; delete W.appealUntil[k]; }
  for (const id of NPC.companies) {
    const staff = W.staffOf(id).length;
    const h = W.workHours[id] || 0;
    W.capacity[id] = staff ? Math.max(0.3, Math.min(1.1, h / Math.max(1, staff * 5))) : 1;
    if (!W.workSeen) W.capacity[id] = 1;
  }
  W.workSeen = true;
  W.work = {};
  W.workHours = {};
  org.segments(W, day);
}
// Car Owner's stock of each car, for the people and the players alike (the players buy first): MAGITA's few, YOSHIDA's
// many (CORP.firstLot). A car sold out is ordered again from its maker in a lot bigger than the last (MAGITA's a
// little, YOSHIDA's far more: CORP.makers), arriving `lead` days later (MAGITA by its special contract the next day,
// YOSHIDA in five) and paid for by Car Owner as it arrives (the lots go to the companies' day with the flows).
function restock(W, day) {
  const s = W.stock;
  s.lots = s.lots || {};
  // (a car the stock does not know yet — one added later — starts with its first lot)
  for (const c of RULES.cars) if (c.price > 0 && !c.ended && s.cars[c.id] === undefined) s.cars[c.id] = CORP.firstLot(c.id, W.scale);
  const arrived = [];
  for (const o of s.orders.filter((x) => x.at <= day)) { s.cars[o.id] = (s.cars[o.id] || 0) + o.n; arrived.push({ id: o.id, n: o.n }); }
  s.orders = s.orders.filter((x) => x.at > day);
  if (arrived.length) {
    const f = econ.flowsOf(W, day), c = f.co.carowner || (f.co.carowner = { s: {}, p: {}, t: {}, l: {}, cat: 0 });
    c.restock = (c.restock || []).concat(arrived);
  }
  for (const [id, have] of Object.entries(s.cars)) if (have <= 0) orderCar(W, id, day);
}
// a car sold out: its next lot ordered (once: nothing more while one is on its way)
export function orderCar(W, id, day) {
  const s = W.stock, pr = CORP.products.cars[id], m = pr && CORP.makers[pr.maker];
  if (!m || s.orders.some((x) => x.id === id)) return;
  s.lots = s.lots || {};
  const first = CORP.firstLot(id, W.scale), last = s.lots[id] || first;
  const lot = Math.min(first * m.maxGrow, Math.max(last + 1, Math.ceil(last * m.grow)));
  s.lots[id] = lot;
  s.orders.push({ id, n: lot, at: day + m.lead, from: day });
}

/* ---------------------------------------------------------------- the numbers --- */
function stats(W, day) {
  const P = W.P, s = { day };
  let adults = 0, work = 0, jobless = 0, homeless = 0, staying = 0, debt = 0, cash = 0, mood = 0;
  const byDistrict = [0, 0, 0, 0, 0];
  const sample = [];
  for (let i = 0; i < P.n; i++) {
    byDistrict[P.dist[i]]++;
    const j = P.job[i], age = ageOf(P, i, day);
    if (age < 65 && j !== NPC.job.student && j !== NPC.job.home) { adults++; if (j === NPC.job.none) jobless++; else if (j !== NPC.job.retired) work++; }
    if (P.home[i] === HOME.street) homeless++;
    if (P.home[i] === HOME.stay) staying++;
    debt += P.debt[i];
    cash += P.cash[i];
    mood += P.emo[i * 5];
    if (i % 25 === 0) sample.push(Math.max(0, P.cash[i]));
  }
  sample.sort((a, b) => a - b);
  let cum = 0, g = 0;
  for (let k = 0; k < sample.length; k++) { cum += sample[k]; g += (2 * (k + 1) - sample.length - 1) * sample[k]; }
  s.gini = cum ? Math.round(g / (sample.length * cum) * 1000) / 1000 : 0;
  s.unemployment = Math.round(jobless / Math.max(1, adults) * 1000) / 1000;
  s.homeless = homeless;
  s.staying = staying;
  s.byDistrict = byDistrict;
  s.cash = cash;
  s.debt = debt;
  s.mood = Math.round(mood / P.n);
  s.median = sample.length ? sample[sample.length >> 1] : 0;
  // prices: the consumption tax and the companies' own changes to them; inflation: against a year (or since the start)
  const keys = new Set([...Object.keys(W.priceIdx), ...Object.keys(W.priceTemp || {})]);
  s.prices = (1 + (W.nation.knobs.consumptionTax || 0) / 100) * [...keys].reduce((a, k) => a * Math.pow(econ.priceOf(W, k), 0.1), 1) * (W.surchargeOn ? 1.005 : 1)
    * Math.pow(1 + NPC.knobOf(W, 'livingCost') / 100, 0.35) * Math.pow(1 + NPC.knobOf(W, 'rentLevel') / 100, 0.2);
  const past = W.nation.hist.length ? W.nation.hist[Math.max(0, W.nation.hist.length - 365)] : null;
  s.inflation = Math.round(((s.prices / ((past && past.prices) || W.stats.prices0 || s.prices)) - 1) * 1000) / 1000;
  s.prices0 = W.stats.prices0 || s.prices;
  // the economy: the people's spending against what it was at the start (their money moving)
  const spentToday = W.flowsDone ? Object.values(W.flowsDone.co).reduce((a, c) => a + Object.values(c.s).reduce((x, y) => x + y, 0) + Object.values(c.p).reduce((x, k) => x + Object.values(k).reduce((p, q) => p + q[1], 0), 0), 0) : 0;
  s.spent = spentToday;
  // the economy: the people's spending of the last quarter or so against that of the last year or so (the first day,
  // only part of a day, and the days before a whole one are not a measure of anything)
  const seen = (W.stats.spentDays || 0) + (spentToday > 0 ? 1 : 0);
  s.spentDays = seen;
  // (its first two months only make the measure: the plain average of the whole days so far)
  if (seen <= 1) { s.spentFast = 0; s.spentSlow = 0; }
  else if (spentToday > 0 && seen <= 61) { s.spentFast = s.spentSlow = ((W.stats.spentSlow || 0) * (seen - 2) + spentToday) / (seen - 1); }
  // (the last quarter, as an economy is measured: a month's swung with a few cars bought and the bonus months, 1.1 to
  // 1.9 within a year, and the bank's rate and the mayors' standing with it)
  else if (spentToday > 0) { s.spentFast = W.stats.spentFast * 89 / 90 + spentToday / 90; s.spentSlow = W.stats.spentSlow * 364 / 365 + spentToday / 365; }
  s.economy = s.spentSlow > 0 ? Math.max(0.2, Math.min(5, s.spentFast / s.spentSlow)) : 1;
  // each company's part of what the people spent, and its move this week
  if (W.flowsDone) {
    const tot = {};
    let all = 0;
    for (const [id, c] of Object.entries(W.flowsDone.co)) {
      let x = Object.values(c.s).reduce((a, b) => a + b, 0) + (c.cas || 0) + c.cat;
      for (const k of Object.values(c.p)) for (const v of Object.values(k)) x += v[1];
      for (const v of Object.values(c.t)) x += v[1];
      for (const v of Object.values(c.l)) x += v;
      tot[id] = Math.max(0, x);
      all += Math.max(0, x);
    }
    for (const id of NPC.companies) {
      const w = W.coWeek[id] || (W.coWeek[id] = { now: 0, prev: 0, days: 0 });
      w.now += tot[id] || 0;
      w.days++;
      if (w.days >= 7) { W.coTrend[id] = w.prev ? w.now / w.prev - 1 : 0; w.prev = w.now; w.now = 0; w.days = 0; }
      W.coShare[id] = all ? (tot[id] || 0) / all : 0;
      // (and the longer view: its last 30 days against the 30-day average of its last half year — sums, so that a
      // company that bills once a month is not read as falling for the rest of it)
      const h = (W.coDays || (W.coDays = {}))[id] || (W.coDays[id] = []);
      h.push(Math.round(tot[id] || 0));
      if (h.length > 180) h.shift();
      const last30 = h.slice(-30).reduce((a, b) => a + b, 0), usual30 = h.reduce((a, b) => a + b, 0) / h.length * 30;
      (W.coTrendLong || (W.coTrendLong = {}))[id] = h.length >= 90 && usual30 > 0 ? last30 / usual30 - 1 : 0;
    }
  }
  s.mood = Math.round(mood / P.n);
  W.districts.forEach((d, k) => { d.economy = 0.95 * d.economy + 0.05 * s.economy; });
  W.outlook.jobLoss = 0.003 + s.unemployment * 0.05;
  W.stats = { ...W.stats, ...s };
}

/* ---------------------------------------------------------------- a person --- */
export function card(W, i, day) {
  const P = W.P, nm = pop.nameOf(P, i), age = ageOf(P, i, day), j = P.job[i];
  const posts = org.posts(W, i);
  const co = NPC.companyOf(j), job = co ? `${NPC.jobNames[j]} ${NPC.org[co][P.dept[i]] ? NPC.org[co][P.dept[i]][1] : ''} ${NPC.ranks[P.rank[i]].name}`.trim() : NPC.jobNames[j] || '';
  return {
    id: pop.pid(P, i), i, name: nm.name, kana: nm.kana, sex: P.sex[i], age, district: P.dist[i], at: P.ldist[i], job, posts,
    act: NPC.acts[P.act[i]] ? NPC.acts[P.act[i]].name : '', place: NPC.placeNames[NPC.places[P.place[i]]] || '', mood: P.emo[i * 5],
    home: ['賃貸', '持ち家', '家族と同居', '居候', '路上'][P.home[i]] || '', famous: !!(P.flags[i] & (FL.famous | FL.mayor | FL.exec)), voice: text.voice(W, i, day)
  };
}

// the plain data of a world (what is kept besides the people's columns)
const SKIP = new Set(['P', 'key', 'market', 'politics', 'labor', 'org', 'ventureUse', 'fitFor', 'hire', 'staffOf', 'card', 'charge', 'flowsBuyback', '_staff', 'carList', 'owners', 'knobChanged', 'carSold']);
export function metaOf(W) {
  const out = {};
  for (const [k, v] of Object.entries(W)) if (!SKIP.has(k) && typeof v !== 'function') out[k] = v;
  return out;
}
export { pop, econ, state, org, text };
