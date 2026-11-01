// 企業: the world of companies, worked out a day at a time (server/core/corp.js keeps it and brings it what the
// players spend; js/game/corp.js has the companies and the rules). Nothing here touches the database: a world is a
// plain object, and the same world, the same day and the same money spent always give the same next world, from
// the server's key (every chance is an HMAC of what it is for, like the share prices: server/core/stock-model.js).
//
// Every company keeps real books (複式簿記): each day's sales, costs, pay, interest and dividends are balanced
// entries in its accounts; the months, the quarters (四半期) and the fiscal years close into statements (損益計算書,
// 貸借対照表, キャッシュ・フロー計算書 by the direct method); its taxes are worked out as in Japan
// (server/core/corp-tax.js), estimated each quarter and settled at the year's end, paid half in advance in November
// and the rest in May. Around the books: its people (new graduates in April, hiring and leaving through the year,
// raises with the year's results, bonuses in June and December, a mood that makes them stay and work well), its
// money (at the bank, in bonds, or borrowed from Tenesice at its rank's rate), its dividends (a share of the profit
// it expects: 配当性向), its guidance (業績予想, revised when the year goes far from it) and its 決算発表 two weeks after
// each quarter, which the market answers.
//
// What each one sells: a studio makes games, in lines of projects (each released when done, late when behind, now
// and then stopped; how good it is comes from its budget, the studio's research, its people's mood and luck; it
// sells most at first and less and less, then joins the older games; what it cost is kept as an asset and written
// off as it sells, or at once when it sells far less than hoped); the others sell streams of their trade that grow,
// follow the economy and the season, and take in the players' own money spent on them. What the car dealer and
// the shop sell comes from the carmaker, whose sale it becomes; Ice Smoker pays RIRU STUDIO for its work and backs
// it month by month, and holds a fifth of it; and the bank holds every company's money and lends it to them.
import crypto from 'node:crypto';
import { CORP, RULES } from './rules.js';
import { yearTax } from './corp-tax.js';

const YEAR = 365;
const DAY = 86400;
const MONTH_DAYS = 30.44;
export const PROFILES = new Map(CORP.companies.map((p) => [p.id, p]));
const SEASONS = Object.fromEntries(Object.entries(CORP.seasons).map(([k, v]) => {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return [k, v.map((x) => x / mean)];
}));
const ECON_KEEP = Math.pow(0.5, 1 / CORP.economy.half);
// how far a month's change in everyone's money (the players' and the people's) moves the economy's log
const WEALTH_PULL = 0.3;
const M = CORP.money;
// a game's sales: `fast` of them in the first weeks (half-life `h1` days), the rest over its life (half-life by its scale)
const CURVE = { fast: 0.45, h1: 12, h2: { AAA: 240, '大型': 200, '中型': 150 }, years: 3 };
// what the studio expects its games to sell once the country lives, against what they sold to the world outside
const gameScale = (w, p) => (w.circ && w.circ.games && w.circ.games[p.id]) || 1;
// a game's points against its sales (every QUALITY points more, e times as much) and its luck (log spread)
const QUALITY = 18, LUCK = 0.25;
// what a game sells for its budget against the line's usual (`r`): more than its share up to half again as much
// (a bigger team makes a better game), less beyond (the market is only so big)
const budgetMult = (r) => (r <= 1.5 ? Math.max(0.05, r) : 1.5 * Math.pow(r / 1.5, 0.5));
// the games' market grows harder every year (others make games too): what a game of the usual budget and points
// sells falls by this much a year from the launch, unless the studio's research and money keep it ahead
const RIVALS = 0.025;
const rivals = (w, d) => Math.exp(-RIVALS * Math.max(0, d - w.launch) / YEAR);
const PERIODS = ['d', 'm', 'q', 'y'];
const CREDIT = new Set(['r', 'ni', 'xi']);
const EQUITY = ['capital', 'reserve', 'othercap', 'legal', 'retained', 'treasury'];

// who is worked out first: the buyers before the maker they buy from, a studio before its backer, the bank last
function rankOf(p) {
  if (p.model === 'bank') return 4;
  if (CORP.companies.some((o) => (o.streams || []).some((x) => [].concat(x.from || []).includes(p.id)))) return 3;
  if (p.partner && p.partner.role === 'backer') return 2;
  return p.model === 'studio' ? 1 : 0;
}
export const ORDER = CORP.companies.slice().sort((a, b) => rankOf(a) - rankOf(b)).map((p) => p.id);

/* ------------------------------------------------------------------- chance --- */
function chance(key) {
  const h = (label) => crypto.createHmac('sha256', key).update(label).digest();
  return {
    u: (label) => (h(label).readUInt32BE(0) + 0.5) / 4294967296,
    z: (label) => {
      const b = h(label), u1 = (b.readUInt32BE(0) + 1) / 4294967297, u2 = b.readUInt32BE(4) / 4294967296;
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    pick: (label, list) => list[h(label).readUInt32BE(0) % list.length]
  };
}

/* -------------------------------------------------------------------- books --- */
const kinds = new Map();
function kindOf(code) {
  let k = kinds.get(code);
  if (!k) { k = CORP.account(code)[1]; kinds.set(code, k); }
  return k;
}
function bump(s, key, v) { for (const p of PERIODS) { const o = s.per[p]; o[key] = (o[key] || 0) + v; } }
// A balanced entry: [account, $] with debits positive and credits negative, adding up to nothing. Balances keep
// their natural sign (assets, liabilities and equity all positive); the P/L's sums too (sales and costs positive);
// cash moved is kept by what it was for (`cf`, js/game/corp.js CF), in positive and out negative.
function post(s, lines, cf) {
  let sum = 0;
  for (const [code, n] of lines) {
    if (!Number.isSafeInteger(n)) throw new Error(`corp ${s.id}: ${code} is ${n}`);
    sum += n;
  }
  if (sum !== 0) throw new Error(`corp ${s.id}: an entry that does not balance ${JSON.stringify(lines)}`);
  for (const [code, n] of lines) {
    if (!n) continue;
    const k = kindOf(code);
    if (k === 'a') s.bal[code] = (s.bal[code] || 0) + n;
    else if (k === 'l' || k === 'e') s.bal[code] = (s.bal[code] || 0) - n;
    else {
      const v = CREDIT.has(k) ? -n : n;
      bump(s, code, v);
      s.today += CREDIT.has(k) ? v : -v;
    }
    if (code === 'cash') {
      if (!cf) throw new Error(`corp ${s.id}: cash moved for nothing`);
      bump(s, 'cf:' + cf, n);
    }
  }
}
// a whole $ of an amount that comes in fractions, the rest kept for the next time
function take(s, key, x) {
  const t = (s.fr[key] || 0) + x, n = Math.trunc(t);
  s.fr[key] = t - n;
  return n;
}
// split a whole amount into whole parts by weights, the rounding left on the last
function split(n, weights) {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const out = weights.map((w) => Math.trunc(n * w / total));
  out[out.length - 1] += n - out.reduce((a, b) => a + b, 0);
  return out;
}
const sumOf = (s, kind) => Object.keys(s.bal).reduce((n, k) => n + (kindOf(k) === kind ? s.bal[k] : 0), 0);
export const assetsOf = (s) => sumOf(s, 'a');
export const liabilitiesOf = (s) => sumOf(s, 'l');
export const equityOf = (s) => EQUITY.reduce((n, k) => n + (s.bal[k] || 0), 0);
export const outstanding = (s) => s.sh.issued - s.sh.treasury;
const debtOf = (s) => s.loans.reduce((n, l) => n + l.amt, 0);

/* ---------------------------------------------------------------- the years --- */
const seasonOf = (p, d) => SEASONS[p.season || 'flat'][CORP.ymd(d).m - 1];
// how much bigger a trade is on day `d` than at the launch: before it, growing at the starting rate; after it, the
// rate easing towards 3% a year (half the gap every 4 years)
function trend(p, d, launch) {
  const t = (d - launch) / YEAR, g0 = Math.log(1 + (p.growth || 0)), gl = Math.log(1.03);
  if (t <= 0 || g0 <= gl) return Math.exp(g0 * t);
  return Math.exp(gl * t + (g0 - gl) * (4 / Math.LN2) * (1 - Math.pow(2, -t / 4)));
}
const econOf = (w, beta) => Math.exp((beta || 0) * w.econ.x);

/* -------------------------------------------------------- the made-up past --- */
// A company as it was on day `b`, the start of the made-up past (the launch `launch` and its numbers then: the
// people and the budgets grown back by its rates, its retained earnings `retained` there, found so that the launch
// day has the profile's own). Its money: what is not in its buildings, games, stock and bonds is cash.
function newCompany(p, b, launch, retained, ch) {
  const s = {
    id: p.id, bal: {}, fr: {}, per: { d: {}, m: {}, q: {}, y: {} }, today: 0,
    cash0: {}, sd: { m: 0, q: 0, y: 0 }, morale: 0.62,
    sh: { issued: 0, treasury: 0, founders: 0, sec: 0, at: 0 }, hold: {}, exp: 0, owe: {}, recv: 0, loans: [],
    tax: { carry: [], interim: 0, last: { total: 0, business: 0 }, bizPaid: 0, booked: 0 },
    div: { dps: 0, total: 0 }, guide: null, plan: null, hist: [], mkt: null, pend: [], spent: [], seq: 0
  };
  people(s, p, b, launch);
  budgets(s, p, b, launch);
  s.bal.capital = p.capital;
  s.bal.reserve = p.reserve;
  s.bal.retained = retained;
  s.bal.ppe = p.ppe;
  if (p.model === 'studio') startStudio(s, p, b, launch, ch);
  else if (p.model === 'bank') startBank(s, p, b, launch);
  else startTrade(s, p, b, launch);
  if (p.id === 'myway') startIp(s, b);
  // the rest of the equity is cash (and, for the companies outside the bank, half of what is free in bonds)
  const free = equityOf(s) + liabilitiesOf(s) - assetsOf(s);
  if (p.model !== 'bank') {
    const bonds = Math.max(0, Math.round(free * 0.45 / 1e6) * 1e6);
    s.bal.bonds = (s.bal.bonds || 0) + bonds;
    s.bal.cash = free - bonds;
  } else s.bal.cash = (s.bal.cash || 0) + free;
  return s;
}
/* ------------------------------------------------------------ the country --- */
// From the day the country of people begins (server/core/npc-model.js), the companies live on its money alone: what
// the people, the players, the other companies and the country pay them. Their own streams' formulas stop (no more
// customers from outside), and what they pay goes to someone in the country too: the pay to their people (on the
// 25th, the taxes and contributions taken by the country), their taxes to the country and their head office's
// district, their dividends to their holders, their bills to the companies that serve them (MAGITA's facilities,
// Dtrade's data centres, the job sites' advertising, ジンクス's game shelves) or to the local businesses; only what
// is bought from abroad leaves (MAGITA's materials). `out.ext` says it all for the people's side.
const circOn = (w, d) => !!(w.circ && d >= w.circ.from);
// a company whose home is outside the country (YOSIDA): once the country lives its money is not the country's — its
// people, suppliers, taxes, bank and holders are abroad, its sales abroad go on — and only what passes between it and
// the country counts (what Car Owner and ジンクス pay it for its cars and engines: money going out)
const abroad = (s) => !!(PROFILES.get(s.id) || {}).abroad;
// what a company's development work (技術開発) has lifted its trade by (1: nothing yet)
const edgeOf = (w, id) => (w.co[id] && w.co[id].rnd ? w.co[id].rnd.edge : 1);
// how a product sells with the economy: a carmaker's by the maker (MAGITA's when people are rich, YOSHIDA's when they
// are not), the rest by the stream it is sold in; and lifted by its maker's development work
function productLift(w, pr, beta) {
  const m = pr && CORP.makers[pr.maker];
  return econOf(w, m ? m.beta : beta) * (m ? edgeOf(w, pr.maker) : 1);
}
// where each kind of a company's running costs goes: [company or '@sector', its stream, share]
const ROUTE = {
  place: [['magita', 'facility', 0.35], ['@sector', null, 0.65]],
  rd: [['speedeed', 'it', 0.1], ['dtrade', 'it', 0.15], ['@sector', null, 0.75]],
  ads: [['dtrade', 'it', 0.35], ['citywork', 'listings', 0.35], ['speedeed', 'search', 0.3]],
  other: [['@sector', null, 1]],
  servers: [['dtrade', 'it', 1]],
  selling: [['@sector', null, 1]],
  capex: [['magita', 'facility', 0.6], ['@sector', null, 0.4]]
};
// (the people's own words for money that reaches a company, on its streams)
const ALIAS = { dtrade: { winfee: 'casino', exchange: 'casino', slotfee: 'casino', cas: 'casino' } };
function route(w, s, kind, n) {
  if (n <= 0) return;
  const parts = ROUTE[kind] || ROUTE.other;
  const ns = split(n, parts.map((x) => x[2]));
  parts.forEach(([to, stream], k) => {
    if (!ns[k]) return;
    if (to === '@sector' || to === s.id || !w.co[to]) w.ext.sector += ns[k];
    else w.b2bCash.push({ to, stream, n: ns[k], from: s.id });
  });
}
// a company's sale of `n` paid in cash on account `code` (its stream's, or the country's own names: js/game/corp.js)
function cashSale(s, code, n) { if (n > 0) post(s, [['cash', n], ['r:' + code, -n]], 'receipts'); }
// The day the companies begin to live on the country (once): Tenesice's own loans and deposits outside wound up
// (what it had lent and its bonds come back as money, the deposits outside paid out), so that its books hold the
// country's money from then on (the people's deposits, its loans to them and to the companies).
// A company abroad once the country lives: the dealers outside it are its own market now (the country's dealer is a
// small part of the world's), so all of its sales but what the country buys are its sales abroad.
function goAbroad(s) { s.scale = { ...(s.scale || {}), export: 1 }; }
export function startCirculation(w, d, scale = 1) {
  if (w.circ) return;
  w.circ = { from: d, games: {}, scale };
  // (a country smaller than the full 50,000 — the tests' — has its companies' plans for people by its size)
  // (and its budgets: a smaller country's companies are that much smaller in all they spend, not only in people)
  for (const s of Object.values(w.co)) {
    s.payAll = true;
    if (abroad(s)) { goAbroad(s); continue; }
    s.target = Math.max(1, Math.round((s.target || s.n) * scale));
    if (scale !== 1) {
      for (const k of ['place', 'rd', 'ads', 'other', 'capex']) if (s.budget[k]) s.budget[k] = Math.round(s.budget[k] * scale);
      s.backingScale = (s.backingScale || 1) * scale;
    }
  }
  const bank = w.co.tenesice;
  if (bank && bank.ext) {
    const lent = Math.min(bank.ext.lent, bank.bal.lent || 0), deps = Math.min(bank.ext.deposits, bank.bal.deposits || 0), bonds = bank.bal.bonds || 0;
    bank.today = 0;
    post(bank, [['cash', lent + bonds - deps], ['lent', -lent], ['bonds', -bonds], ['deposits', deps]], 'lending');
    bank.ext = { lent: 0, deposits: 0 };
    bank.today = 0;
  }
}

// the staff, their pay and what they cost on day `d` of the made-up past (exactly the profile's on the launch day)
function people(s, p, d, launch) {
  const t = (d - launch) / YEAR;
  s.n = Math.round(p.staff * Math.pow(1 + p.hire, t));
  s.pay = Math.round(p.salary * Math.pow(1 + p.raise, t));
  s.unit = Math.round(p.cost * Math.pow(1 + p.raise, t));
  s.target = s.n;
}
function budgets(s, p, d, launch) {
  const g = p.model === 'studio' ? Math.pow(1 + p.hire, (d - launch) / YEAR) : trend(p, d, launch);
  s.budget = {
    place: Math.round(p.place.amount * (p.model === 'studio' ? 1 : g)),
    rd: Math.round(p.rd.amount * g), ads: Math.round((p.ads || 0) * g), other: Math.round((s.otherBase || p.other || 0) * g),
    capex: Math.round((p.capex || 0) * g)
  };
}
function startTrade(s, p, b, launch) {
  s.noise = {};
  s.used = [];
  s.pr = {};
  s.sold = {};
  for (const x of p.streams) s.noise[x.id] = 0;
  // stock to sell, and what customers owe: a few weeks of it
  const daily = p.sales * trend(p, b, launch) / YEAR;
  if (p.inventoryDays) s.bal.stock = Math.round(daily * 0.7 * p.inventoryDays);
  s.recv = Math.round(daily * 20);
  s.bal.ar = s.recv;
}
function startBank(s, p) {
  s.noise = {};
  for (const x of p.streams) s.noise[x.id] = 0;
  // the balance sheet of a bank: its equity many times over in loans, bonds and cash, deposits for the rest
  const eq = p.capital + p.reserve + p.retained, assets = eq * p.bank.assets;
  s.bal.lent = Math.round(assets * p.bank.loans);
  s.bal.bonds = Math.round(assets * p.bank.bonds);
  s.bal.deposits = assets - eq;
  s.ext = { lent: s.bal.lent, deposits: s.bal.deposits };
  s.bal.cash = 0;
}

/* -------------------------------------------------------------- the studios --- */
const lineOf = (p, id) => p.lines.find((l) => l.id === id);
// the part of a studio's game makers on the contract: as many people as at the launch, however many it has since
const contractShare = (s, p) => (p.contract ? Math.min(0.9, p.staff * p.makers * p.contract.team / Math.max(1, s.n * p.makers)) : 0);
const concurrent = (line) => Math.max(1, Math.round(line.months / line.every));
// what one project of the line usually costs: its share of the makers for its months, at the profile's numbers
const budgetRef = (p, line) => p.staff * p.makers * line.team / concurrent(line) * p.cost * line.months / 12;
const h2Of = (line) => CURVE.h2[line.scale] || 200;
// the share of a game's life sales made by the end of day `age` (0: its first day)
function soldShare(line, age) {
  if (age < 0) return 0;
  const k1 = Math.pow(0.5, 1 / CURVE.h1), k2 = Math.pow(0.5, 1 / h2Of(line));
  return 1 - CURVE.fast * Math.pow(k1, age + 1) - (1 - CURVE.fast) * Math.pow(k2, age + 1);
}
// …and of what it cost written off by then: by its sales, and at least evenly over its years
const writtenShare = (line, age) => Math.min(1, Math.max(soldShare(line, age), (age + 1) / (CURVE.years * YEAR)));
function gameName(ch, s, label) {
  const lang = ch.u(label + ':lang') < 0.5 ? 'jp' : 'en', parts = CORP.names[lang];
  return lang === 'jp' ? ch.pick(label + ':a', parts[0]) + ch.pick(label + ':b', parts[1]) : ch.pick(label + ':a', parts[0]) + ' ' + ch.pick(label + ':b', parts[1]);
}
function startStudio(s, p, b, launch, ch) {
  s.tech = 1;
  s.brand = 1;
  s.titles = [];
  s.projects = [];
  s.catalog = p.catalog;
  s.live = (p.live ? p.live.titles : []).map((t, i) => ({ id: 'L' + i, name: t.name, genre: t.genre, rate: t.sales, next: b + 240 + 270 * i, boost: 0, until: 0 }));
  s.license = p.license || 0;
  for (const line of p.lines) {
    if (line.kind === 'live') continue;
    const k = concurrent(line), span = Math.round(line.months * MONTH_DAYS), ref = budgetRef(p, line);
    // the projects under way, a release apart
    for (let i = 0; i < k; i++) {
      const prog = (i + 0.5) / k, spent = Math.round(ref * prog);
      const pr = newProject(s, p, line, Math.round(b - prog * span), ch);
      pr.prog = prog;
      pr.spent = spent;
      pr.due = Math.round(b + (1 - prog) * span);
      s.projects.push(pr);
      s.bal.wip = (s.bal.wip || 0) + spent;
    }
    // the games of the last three years, still selling (as they were expected to)
    const every = Math.round(line.every * MONTH_DAYS);
    for (let at = b - Math.round(every / 2); b - at < CURVE.years * YEAR; at -= every) {
      const age = b - at, q = 72 + p.skill, life = line.base * Math.exp((q - 72) / QUALITY);
      const t = { id: 't' + (++s.seq), line: line.id, name: gameName(ch, s, `${p.id}:old:${line.id}:${at}`), genre: ch.pick(`${p.id}:oldg:${at}`, CORP.genres),
        day: at, q, life, est: life, first: life, cost: ref, sold: Math.round(life * soldShare(line, age - 1)), units: 0, price: line.price, hit: 0 };
      t.units = Math.round(t.sold / t.price);
      t.book = Math.round(ref * (1 - writtenShare(line, age - 1)));
      s.titles.push(t);
      s.bal.content = (s.bal.content || 0) + t.book;
    }
  }
  s.bal.ar = Math.round(studioDaily(s, p, b) * 40);
  s.recv = s.bal.ar;
}
function newProject(s, p, line, start, ch) {
  const label = `${p.id}:project:${line.id}:${start}`;
  // (after a hit, its sequel)
  const last = s.titles.filter((t) => t.line === line.id).sort((a, b) => b.day - a.day)[0];
  const sequel = last && last.hit > 0 && ch.u(label + ':seq') < 0.6;
  const name = sequel ? (/ (\d+)$/.test(last.name) ? last.name.replace(/ (\d+)$/, (m, n) => ' ' + (Number(n) + 1)) : last.name + ' 2') : gameName(ch, s, label);
  return {
    id: 'p' + (++s.seq), line: line.id, name, genre: sequel ? last.genre : ch.pick(label + ':genre', CORP.genres), start,
    due: start + Math.round(line.months * MONTH_DAYS), prog: 0, spent: 0, delays: 0, polish: 0,
    // how well it is going: its own pace and its own quality, unknown until it shows
    pace: 1.025 + 0.035 * ch.z(label + ':pace'), z: ch.z(label + ':quality'), luck: ch.z(label + ':luck'), sequel: !!sequel
  };
}
// a studio's sales a day as they stand on day `d` (for what its stores owe it at the start)
function studioDaily(s, p, d) {
  let n = s.catalog / YEAR + s.live.reduce((a, l) => a + l.rate / YEAR, 0) + s.license / YEAR;
  for (const t of s.titles) {
    const line = lineOf(p, t.line), age = d - t.day;
    n += t.life * (soldShare(line, age) - soldShare(line, age - 1));
  }
  return n * (1 - p.platform);
}

/* ---------------------------------------------------------------- one day --- */
// People cost every day: pay (12 of 16 parts of the year's salary), the bonus put by (the other 4), and what the
// company pays besides (社会保険 and the rest). Where it goes: the game makers' to their games (kept as an asset
// until the game sells), to the contract work or to the live games; a factory's to its cost of sales; the rest to 販管費.
function payroll(s, p, d, makersTo) {
  // (once the country lives, the year's pay comes a twelfth each month and a bonus only for a year that beat its
  // plan: no bonus put by)
  const salary = take(s, 'salary', s.n * s.pay * (s.payAll ? 1 : 12 / 16) / YEAR);
  const bonus = s.payAll ? 0 : take(s, 'bonus', s.n * s.pay * 4 / 16 / YEAR);
  const welfare = take(s, 'welfare', s.n * (s.unit - s.pay) / YEAR);
  const total = salary + bonus + welfare;
  // (what of what is accrued is pay and what the company's own costs of its people: for the people's side)
  s.acc = s.acc || { salary: 0, welfare: 0 };
  s.acc.salary += salary;
  s.acc.welfare += welfare;
  const share = p.model === 'studio' ? p.makers : p.model === 'maker' ? p.factory : 0;
  const made = Math.round(total * share), rest = total - made;
  const [sSalary, sBonus, sWelfare] = split(rest, [salary, bonus, welfare]);
  const lines = [['sSalary', sSalary], ['sBonus', sBonus], ['sWelfare', sWelfare], ['accrued', -(salary + welfare)], ['bonus', -bonus]];
  if (made) {
    if (p.model === 'maker') lines.push(['c:factory', made]);
    else for (const [code, n] of makersTo(made)) lines.push([code, n]);
  }
  post(s, lines);
}
// a year's budget of a kind as it is spent: what its child's research has cut of it (MAGITA's by WAZIMA's: `save`)
const spend = (s, k) => (s.budget[k] || 0) * ((s.save && s.save[k]) || 1);
// the year's costs a day: the buildings, research, advertising and the rest (paid at the month's end)
function running(s, p, d) {
  const place = take(s, 'place', spend(s, 'place') / YEAR), rd = take(s, 'rd', spend(s, 'rd') / YEAR);
  const ads = take(s, 'ads', spend(s, 'ads') / YEAR), other = take(s, 'other', spend(s, 'other') / YEAR);
  const all = place + rd + ads + other;
  post(s, [[p.model === 'maker' ? 'c:plant' : 'sPlace', place], ['sRd', rd], ['sAds', ads], ['sOther', other], ['ap', -all]]);
  s.exp += all;
  const by = s.expBy || (s.expBy = {});
  by.place = (by.place || 0) + place; by.rd = (by.rd || 0) + rd; by.ads = (by.ads || 0) + ads; by.other = (by.other || 0) + other;
  if (p.life) {
    const dep = take(s, 'dep', s.bal.ppe / (p.life * YEAR));
    post(s, [['sDepr', dep], ['ppe', -dep]]);
  }
}
// a sale to a customer outside (paid later) and its cost (paid later to the supplier, or to one outside)
function sell(w, s, code, n, cost) {
  if (n <= 0) return;
  post(s, [['ar', n], ['r:' + code, -n]]);
  s.recv += n;
  if (cost > 0) {
    post(s, [['c:' + code, cost], ['ap', -cost]]);
    s.owe['*'] = (s.owe['*'] || 0) + cost;
  }
}
// money paid in at once (the players, the people): a sale for cash, its cost owed as above (once the country lives,
// to the local businesses that supply it)
function sellCash(w, s, code, n, cost) {
  if (n <= 0) return;
  post(s, [['cash', n], ['r:' + code, -n]], 'receipts');
  if (cost > 0) {
    post(s, [['c:' + code, cost], ['ap', -cost]]);
    const to = w.ext ? '@sector' : '*';
    s.owe[to] = (s.owe[to] || 0) + cost;
  }
}
// the 仕入れ価格 as the buyer's and the maker's people last agreed it (server/core/npc-org.js talks: MAGITA's only)
const termsOf = (w, buyer, maker) => (maker === 'magita' && w.terms && w.terms[buyer]) || 1;
// a car's or a Shop item's price in the catalogue (null: not sold)
const PRICES = { cars: new Map(RULES.cars.filter((c) => c.price > 0 && !c.ended).map((c) => [c.id, c.price])), items: new Map(RULES.shop.map((i) => [i.id, i.price])) };
export const listPrice = (kind, id) => PRICES[kind].get(id) || 0;
// `n` of a product sold for `paid` in all (to customers outside at its list price, the players for what they paid):
// the sale; its cost (made here: its materials, bought outside; made by another company: bought from it at its
// 仕入れ価格 with its 専売特別費用, which becomes that company's sale); and what selling them cost (販売費).
function sellProducts(w, s, code, kind, id, n, paid, cash, who) {
  if (n <= 0) return;
  const pr = CORP.products[kind][id];
  if (cash) post(s, [['cash', paid], ['r:' + code, -paid]], 'receipts');
  else { post(s, [['ar', paid], ['r:' + code, -paid]]); s.recv += paid; }
  let cost, fromStock = false;
  if (pr.maker === s.id) {
    cost = n * pr.cost;
    const to = w.ext ? '@sector' : '*';
    s.owe[to] = (s.owe[to] || 0) + cost;
  } else if (w.ext && kind === 'cars') {
    // (once the country lives, Car Owner's cars come out of the stock it bought in lots and paid for: restockIn)
    const each = (s.lotCost && s.lotCost[id]) || Math.round(pr.buy * termsOf(w, s.id, pr.maker)) + (pr.excl || 0) + surchargeOf(w, kind, id);
    cost = n * each;
    fromStock = true;
  } else {
    // (MAGITA's surcharge while it struggles, on its 仕入れ価格: the dealer's customers outside pay it too)
    const extra = n * surchargeOf(w, kind, id);
    if (!cash && extra) { post(s, [['ar', extra], ['r:' + code, -extra]]); s.recv += extra; paid += extra; }
    // (the 仕入れ価格 as the two companies' people last agreed it: server/core/npc-org.js talks)
    const terms = termsOf(w, s.id, pr.maker);
    const buy = Math.round(n * pr.buy * terms) + extra, excl = n * (pr.excl || 0);
    cost = buy + excl;
    s.owe[pr.maker] = (s.owe[pr.maker] || 0) + cost;
    w.b2b.push({ from: pr.maker, to: s.id, kind, id, n, buy, excl, cost: Math.round(n * pr.cost * labMult(w, pr.maker)) });
  }
  const selling = n * CORP.products.sell[kind];
  if (fromStock) post(s, [['c:' + code, cost], ['stock', -cost], ['sSelling', selling], ['ap', -selling]]);
  else post(s, [['c:' + code, cost], ['sSelling', selling], ['ap', -(cost + selling)]]);
  s.exp += selling;
  s.expBy = s.expBy || {};
  s.expBy.selling = (s.expBy.selling || 0) + selling;
  const row = s.sold[id] || (s.sold[id] = { npc: 0, players: 0, sales: 0, margin: 0 });
  row[(who || (cash ? 'players' : 'npc'))] += n;
  row.sales += paid;
  row.margin += paid - cost;
  // (a car sold for less than it cost the dealer: a loss taken on the maker's terms)
  if (paid < cost) w.mon[s.id + ':loss'] = (w.mon[s.id + ':loss'] || 0) + cost - paid;
}

// Car Owner's lots of cars that arrived today (once the country lives: its stock for the people and the players,
// server/core/npc-model.js restock), bought from their makers at their 仕入れ価格 (MAGITA's 専売特別費用 and, while it
// is on, its surcharge on top) and paid within the maker's terms: its stock, and the makers' sales of the day.
function restockIn(w, s, list) {
  for (const { id, n } of list || []) {
    const pr = CORP.products.cars[id];
    if (!pr || !(n > 0) || pr.maker === s.id) continue;
    const terms = termsOf(w, s.id, pr.maker);
    const buy = Math.round(n * pr.buy * terms) + n * surchargeOf(w, 'cars', id), excl = n * (pr.excl || 0), cost = buy + excl;
    post(s, [['stock', cost], ['ap', -cost]]);
    s.owe[pr.maker] = (s.owe[pr.maker] || 0) + cost;
    w.b2b.push({ from: pr.maker, to: s.id, kind: 'cars', id, n, buy, excl, cost: Math.round(n * pr.cost * labMult(w, pr.maker)) });
    (s.lotCost || (s.lotCost = {}))[id] = Math.round(cost / n);
    w.mon[s.id + ':restock'] = (w.mon[s.id + ':restock'] || 0) + cost;
  }
}

// a trade's day: its streams (the economy, the season and its own ups and downs, what its development work won it),
// the players' money on top
function tradeDay(w, s, p, d, flows, ch) {
  payroll(s, p, d);
  running(s, p, d);
  const lift = trend(p, d, w.launch), season = seasonOf(p, d);
  if (d % 7 === 0) for (const x of p.streams) s.noise[x.id] = 0.8 * (s.noise[x.id] || 0) + 0.6 * (x.noise || 0.04) * ch.z(`${p.id}:${x.id}:${d}`);
  const mine = flows[p.id] || {};
  const circ = !!w.ext, npc = circ && flows.npc ? flows.npc.co[p.id] : null, edge = s.rnd ? s.rnd.edge : 1;
  s.pday = 0;
  if (npc && npc.restock) restockIn(w, s, npc.restock);
  for (const x of p.streams) {
    if (x.to) continue;
    // (YOSIDA's money tree seeds, shipped to the market abroad from the launch on — its profile is what it was
    // before them —, once the country lives as before)
    if (x.seeds) { if (d >= w.launch) seedsDay(w, s, x, d, ch); continue; }
    const g = lift * season * Math.exp(s.noise[x.id] || 0) * edge, f = g * econOf(w, x.beta ?? p.beta);
    // (a company abroad, or a trade whose customers are abroad — YOSIDA's and WAZIMA's exports — still sells abroad
    // once the country lives: money coming into it)
    if (circ && !p.abroad && !x.abroad) {
      // the people's own purchases of each product (no customers from outside any more)
      if (x.products && npc) for (const [id, got] of Object.entries((npc.p || {})[x.products] || {})) {
        if (!CORP.products[x.products][id]) continue;
        sellProducts(w, s, x.id, x.products, id, got[0], got[1], true, 'npc');
        s.pr[x.id] = (s.pr[x.id] || 0) + got[1] / 30;
      }
    } else if (x.products) {
      // each model's or item's customers outside the game
      for (const [id, pr] of Object.entries(CORP.products[x.products])) {
        const price = listPrice(x.products, id);
        if (!pr.npc || !price) continue;
        const n = take(s, 'u:' + id, pr.npc * g * productLift(w, pr, x.beta ?? p.beta) / YEAR);
        sellProducts(w, s, x.id, x.products, id, n, n * price, false);
      }
    } else {
      const share = s.share && s.share[x.id] !== undefined ? s.share[x.id] : (x.share || 0);
      if (share) {
        const n = take(s, 'sale:' + x.id, p.sales * share * f * (s.scale && s.scale[x.id] || 1) / YEAR);
        const cost = s.cost && s.cost[x.id] !== undefined ? s.cost[x.id] : (x.cost || 0);
        sell(w, s, x.id, n, take(s, 'cost:' + x.id, n * cost));
        // (what a day abroad brings, for the managers' expectations once the country lives)
        if (circ && !p.abroad) s.pr[x.id] = (s.pr[x.id] || 0) + n / 30;
      }
    }
    // the players' own money spent here today
    for (const kind of x.player || []) {
      if (kind === 'car' || kind === 'shop') {
        for (const [id, got] of Object.entries(mine[kind] || {})) {
          if (!CORP.products[x.products][id]) continue;
          sellProducts(w, s, x.id, x.products, id, got[0], got[1], true);
          s.pday += got[1];
          s.pr[x.id] = (s.pr[x.id] || 0) + got[1] / 30;
        }
        continue;
      }
      let paid = mine[kind] || 0;
      if (kind === 'job') paid = take(s, 'job', (flows.job || 0) * CORP.players.jobFee * jobShare(p, d, w.launch));
      if (!paid) continue;
      if (kind === 'buyback') { buyBack(s, d, paid); continue; }
      const cost = s.cost && s.cost[x.id] !== undefined ? s.cost[x.id] : (x.cost || 0);
      sellCash(w, s, x.id, paid, take(s, 'pcost:' + x.id, paid * cost));
      s.pday += paid;
      s.pr[x.id] = (s.pr[x.id] || 0) + paid / 30;
    }
    // (the players' money on an average day, as of the last month or so)
    if (s.pr[x.id] && !circ) s.pr[x.id] *= 29 / 30;
  }
  if (s.pday) w.mon[s.id + ':players'] = (w.mon[s.id + ':players'] || 0) + s.pday;
  s.players = s.pday;
  if (npc) peopleMoney(w, s, p, d, npc);
  // the materials of what the maker sold abroad today (its sales to the other companies come in after theirs: ORDER)
  if (p.materials) materials(s, s.per.d['r:export'] || 0);
  // the used cars bought back from players go to dealers outside within weeks, for a little more (once the country
  // lives, to its own used-car trade: the local businesses pay)
  if (s.used && s.used.length) {
    const due = s.used.filter((u) => u.due <= d);
    s.used = s.used.filter((u) => u.due > d);
    for (const u of due) {
      const n = Math.round(u.cost * 1.08);
      if (circ) { post(s, [['cash', n], ['r:used', -n], ['c:used', u.cost], ['stock', -u.cost]], 'receipts'); w.ext.fromSector += n; continue; }
      post(s, [['ar', n], ['r:used', -n], ['c:used', u.cost], ['stock', -u.cost]]);
      s.recv += n;
    }
  }
}
// The people's money of the day at a company (server/core/npc-econ.js flows: by stream, or the country's own
// names — 官公庁・公共事業, 新規事業, 通信, the casino's wins and losses — and the cars traded in), each as a sale for
// cash with its cost as its stream's.
function peopleMoney(w, s, p, d, npc) {
  for (const [key, n0] of Object.entries(npc.s || {})) {
    const n = Math.round(n0);
    if (n <= 0) continue;
    const id = (ALIAS[p.id] && ALIAS[p.id][key]) || key;
    const x = (p.streams || []).find((y) => y.id === id && !y.to);
    if (x) {
      const cost = s.cost && s.cost[x.id] !== undefined ? s.cost[x.id] : (x.cost || 0);
      sellCash(w, s, x.id, n, take(s, 'ncost:' + x.id, n * cost));
      s.pr[x.id] = (s.pr[x.id] || 0) + n / 30;
    } else cashSale(s, id, n);
  }
  // the casino: what the people's bets lost, or (a day the people won) what it paid them
  if (npc.cas) {
    const n = Math.round(npc.cas);
    if (n > 0) { sellCash(w, s, 'casino', n, 0); s.pr.casino = (s.pr.casino || 0) + n / 30; }
    else post(s, [['c:payout', -n], ['cash', n]], 'expenses');
  }
  if (npc.buyback) buyBack(s, d, Math.round(npc.buyback));
}
// What the people spent at a company on a day (their flows of it, server/core/npc-econ.js: its streams, the products,
// games and running games bought of it, its older games, what their bets lost at the casino; the bank's interest
// and fees too), for the companies' books to show
export function peopleSpent(co, bank) {
  let n = 0;
  if (co) {
    for (const v of Object.values(co.s || {})) n += v;
    for (const k of Object.values(co.p || {})) for (const v of Object.values(k)) n += v[1];
    for (const v of Object.values(co.t || {})) n += v[1];
    for (const v of Object.values(co.l || {})) n += v;
    n += (co.cat || 0) + Math.max(0, co.cas || 0);
  }
  if (bank) n += Math.max(0, bank.nii || 0) + Math.max(0, bank.fees || 0);
  return Math.round(n);
}
// YOSIDA's money tree seeds (CORP.yosida.seeds): each month, how many it ships to the market and at what price on
// average, decided as the month begins; a day's share of them sold (paid within weeks) and made at their cost.
const YS = CORP.yosida;
function seedsDay(w, s, x, d, ch) {
  const key = CORP.monthKey(d), sd = YS.seeds;
  if (!s.seeds || s.seeds.m !== key) {
    const want = Math.round(sd.month[0] + (sd.month[1] - sd.month[0]) * ch.u(`seeds:n:${key}`));
    const price = Math.round((sd.price[0] + (sd.price[1] - sd.price[0]) * ch.u(`seeds:p:${key}`)) / 10000) * 10000;
    const cap = seedsCap(s), n = Math.max(0, Math.min(want, Math.floor(cap / 12 / price)));
    s.seeds = { m: key, n, want, price, cap, sold: 0, last: s.seeds ? { m: s.seeds.m, n: s.seeds.sold, price: s.seeds.price } : null };
  }
  const days = CORP.monthEnd(d) - CORP.monthStart(d) + 1;
  const k = Math.min(s.seeds.n - s.seeds.sold, take(s, 'seeds', s.seeds.n / days));
  if (k <= 0) return;
  s.seeds.sold += k;
  sell(w, s, x.id, k * s.seeds.price, k * sd.cost);
  // (once the country lives, the managers expect a day of them as of late)
  if (w.ext) { s.pr[x.id] = (s.pr[x.id] || 0) + k * s.seeds.price / 30; (s.pc || (s.pc = {}))[x.id] = (s.pc[x.id] || 0) + k * sd.cost / 30; }
}
// how many $ of seeds a year YOSIDA can ship: `cap`, more as it grows (its people against its size at the start) and
// as its development work improves its technology
export function seedsCap(s) {
  const p = PROFILES.get(s.id), size = Math.max(0, (s.n || 0) / Math.max(1, p.staff)), tech = s.rnd ? s.rnd.edge : 1;
  return Math.round(YS.seeds.cap * Math.min(3, size) * tech);
}
// the share of the game's バイト a job site has (its share drifting year by year, the two together always all)
function jobShare(p, d, launch) {
  const sites = CORP.companies.filter((c) => c.jobs);
  const t = Math.max(0, (d - launch) / YEAR);
  const raw = sites.map((c) => Math.max(0.05, c.jobs.share + c.jobs.drift * t));
  const total = raw.reduce((a, b) => a + b, 0);
  return raw[sites.indexOf(p)] / total;
}
function buyBack(s, d, paid) {
  post(s, [['stock', paid], ['cash', -paid]], 'purchases');
  s.used.push({ due: d + 20, cost: paid });
}

// the maker's sales to the other companies today: each product at its 仕入れ価格, its 専売特別費用 a sale of its
// own, and the materials it took to make them
function supply(w, s, p) {
  let made = 0;
  for (const b of w.b2b.filter((x) => x.from === p.id)) {
    const stream = p.streams.find((x) => x.to === b.to);
    post(s, [['ar', b.buy + b.excl], ['r:' + (stream ? stream.id : 'export'), -b.buy], ['r:excl', -b.excl]]);
    made += b.cost;
    if (w.ext) { const k = stream ? stream.id : 'export'; s.pr[k] = (s.pr[k] || 0) + b.buy / 30; s.pr.excl = (s.pr.excl || 0) + b.excl / 30; }
    const row = s.sold[b.id] || (s.sold[b.id] = { npc: 0, players: 0, sales: 0, margin: 0 });
    row.npc += b.n;
    row.sales += b.buy + b.excl;
    row.margin += b.buy + b.excl - b.cost;
    w.mon[`b2b:${p.id}:${b.to}`] = (w.mon[`b2b:${p.id}:${b.to}`] || 0) + b.buy + b.excl;
    s.exclQ = s.exclQ || {};
    s.exclQ[b.to] = (s.exclQ[b.to] || 0) + b.excl;
  }
  if (made) {
    post(s, [['c:materials', made], ['ap', -made]]);
    s.owe['*'] = (s.owe['*'] || 0) + made;
  }
}
function materials(s, sold) {
  const n = take(s, 'materials', sold * s.materials * (s.lab ? s.lab.mult : 1));
  if (n <= 0) return;
  post(s, [['c:materials', n], ['ap', -n]]);
  s.owe['*'] = (s.owe['*'] || 0) + n;
}

// the bank's day: its trade's streams, what goes bad of its loans, its books growing with its deposits
function bankDay(w, s, p, d, ch, flows) {
  if (w.ext) return bankCountry(w, s, p, d, flows);
  payroll(s, p, d);
  running(s, p, d);
  const lift = trend(p, d, w.launch);
  if (d % 7 === 0) for (const x of p.streams) s.noise[x.id] = 0.8 * (s.noise[x.id] || 0) + 0.6 * (x.noise || 0.04) * ch.z(`${p.id}:${x.id}:${d}`);
  for (const x of p.streams) {
    const n = take(s, 'sale:' + x.id, p.sales * x.share * lift * econOf(w, x.beta ?? p.beta) * Math.exp(s.noise[x.id] || 0) * (s.rnd ? s.rnd.edge : 1) / YEAR);
    post(s, [['cash', n], ['r:' + x.id, -n]], 'receipts');
  }
  const bad = take(s, 'credit', p.sales * p.credit.share * lift * econOf(w, p.credit.beta) / YEAR);
  post(s, [['sCredit', bad], ['lent', -bad]]);
  // its own loans and deposits outside grow with its trade (lent out of what is deposited)
  const g = Math.log(1 + (p.growth || 0)) / YEAR;
  const more = take(s, 'grow', s.ext.lent * g);
  s.ext.lent += more;
  s.ext.deposits += more;
  post(s, [['lent', more], ['deposits', -more]]);
}

// The bank once the country lives: its sales are what the people and the country pay it (the interest on their loans,
// テネシス・モバイル's phones, its fees and new businesses, the public works), its funding cost the interest it pays on
// their deposits (to them: out.ext.depositInterest), its credit costs what the people never paid back.
function bankCountry(w, s, p, d, flows) {
  payroll(s, p, d);
  running(s, p, d);
  const npc = flows.npc || {}, b = npc.bank || {}, mine = npc.co ? npc.co.tenesice : null;
  if (b.nii > 0) cashSale(s, 'nii', Math.round(b.nii));
  if (b.fees > 0) cashSale(s, 'fees', Math.round(b.fees));
  if (mine) peopleMoney(w, s, p, d, mine);
  const deposits = Math.max(0, Math.round(b.deposits || 0));
  const int = take(s, 'funding', deposits * (b.rate || 0.002) / YEAR);
  if (int > 0) { post(s, [['c:funding', int], ['cash', -int]], 'interestOut'); w.ext.depositInterest += int; }
  if (b.credit > 0) { const n = Math.round(b.credit); post(s, [['sCredit', n], ['lent', -n]]); }
  // (the players' trading fee was Dtrade's; nothing of theirs here)
  s.pr.nii = (s.pr.nii || 0) * 29 / 30 + (b.nii || 0) / 30;
}

/* ------------------------------------------------------------- a studio's day --- */
function studioDay(w, s, p, d, ch, out, flows) {
  if (w.ext) return studioCountry(w, s, p, d, ch, out, flows);
  // who makes what: the lines' projects, the contract, the live games
  // (the contract team stays the size it was: the fee does not grow with it; whoever joins makes the studio's own)
  const makers = s.n * p.makers, contract = contractShare(s, p), shares = [];
  for (const line of p.lines) {
    if (line.kind === 'live') { shares.push(['c:live', line.team * (1 - contract)]); continue; }
    const mine = s.projects.filter((pr) => pr.line === line.id);
    for (const pr of mine) shares.push([pr, line.team * (1 - contract) / Math.max(1e-9, 1 - (p.contract ? p.contract.team : 0)) / mine.length]);
  }
  if (p.contract) shares.push(['c:contract', contract]);
  void makers;
  payroll(s, p, d, (made) => {
    const parts = split(made, shares.map((x) => x[1])), lines = [];
    shares.forEach((x, i) => {
      if (typeof x[0] === 'string') lines.push([x[0], parts[i]]);
      else { x[0].spent += parts[i]; lines.push(['wip', parts[i]]); }
    });
    return lines;
  });
  running(s, p, d);
  // (what the studio's research has built up: its technology, slowly)
  s.tech += (Math.sqrt(Math.max(0.1, s.budget.rd / p.rd.amount)) - s.tech) * (1 - Math.pow(0.5, 1 / (2 * YEAR)));
  const season = seasonOf(p, d), econ = econOf(w, p.beta);
  let game = 0, live = 0, license = 0;
  // the games on sale
  for (const t of s.titles) {
    const line = lineOf(p, t.line), age = d - t.day;
    const n = take(s, 'title:' + t.id, t.life * (soldShare(line, age) - soldShare(line, age - 1)) * season);
    t.sold += n;
    t.units += Math.max(0, Math.round(t.sold / t.price) - t.units);
    game += n;
    // its cost written off as it sells (and evenly at least)
    const target = Math.round(t.cost * (1 - writtenShare(line, age)));
    if (t.book > target) {
      const off = t.book - Math.max(0, target);
      t.book -= off;
      post(s, [['c:amort', off], ['content', -off]]);
    }
  }
  // the older games, the games run for years, the licences
  game += take(s, 'catalog', s.catalog * season * Math.sqrt(econ) / YEAR);
  s.catalog *= Math.pow(0.5, 1 / (p.catalogHalf * YEAR));
  for (const l of s.live) {
    const boost = d < l.until ? 1.3 : 1;
    live += take(s, 'live:' + l.id, l.rate * season * econ * boost / YEAR);
    l.rate *= Math.pow(0.5, 1 / (p.live.half * YEAR));
    // a big update now and then: more players for weeks, and a few of them stay
    if (d >= l.next) {
      l.until = d + 45;
      l.rate *= 1.06 + 0.06 * ch.u(`${p.id}:${l.id}:update:${d}`);
      l.next = d + 420 + Math.round(240 * ch.u(`${p.id}:${l.id}:next:${d}`));
      news(out, s, p, d + 1, 2 * 3600, 'update', `${l.name}の大型アップデートを配信`, { title: l.name }, 0.01);
    }
  }
  if (s.license) license = take(s, 'license', s.license * Math.sqrt(s.brand * econ) / YEAR);
  const stores = take(s, 'platform', (game + live) * p.platform);
  const servers = take(s, 'servers', live * (p.live ? p.live.server : 0));
  if (game) post(s, [['ar', game], ['r:game', -game]]);
  if (live) post(s, [['ar', live], ['r:live', -live]]);
  if (license) post(s, [['ar', license], ['r:license', -license]]);
  s.recv += game + live + license;
  // (the stores keep their cut of what they pay over; the servers are paid with the month's bills)
  if (stores) post(s, [['c:platform', stores], ['ar', -stores]]);
  s.recv -= stores;
  if (servers) { post(s, [['c:live', servers], ['ap', -servers]]); s.exp += servers; }
  // the games of the past three years: older ones join the catalogue
  for (const t of s.titles.filter((x) => d - x.day >= CURVE.years * YEAR)) {
    const line = lineOf(p, t.line), age = d - t.day;
    s.catalog += t.life * (soldShare(line, age + 1) - soldShare(line, age)) * YEAR;
    if (t.book > 0) { post(s, [['c:amort', t.book], ['content', -t.book]]); t.book = 0; }
    out.titles.push({ ...titleRow(s, t, p), ended: d });
  }
  s.titles = s.titles.filter((x) => d - x.day < CURVE.years * YEAR);
  projects(w, s, p, d, ch, out);
}
// A studio once the country lives: its games sell to whoever of the people buys them (each one counted), its running
// games take what their players spend, its older games what is bought of them; the shops' cut (ジンクス's game
// shelves) and the servers (Dtrade's data centres) are paid out of it.
function studioCountry(w, s, p, d, ch, out, flows) {
  const makers = s.n * p.makers, contract = contractShare(s, p), shares = [];
  for (const line of p.lines) {
    if (line.kind === 'live') { shares.push(['c:live', line.team * (1 - contract)]); continue; }
    const mine = s.projects.filter((pr) => pr.line === line.id);
    for (const pr of mine) shares.push([pr, line.team * (1 - contract) / Math.max(1e-9, 1 - (p.contract ? p.contract.team : 0)) / mine.length]);
  }
  if (p.contract) shares.push(['c:contract', contract]);
  void makers;
  payroll(s, p, d, (made) => {
    const parts = split(made, shares.map((x) => x[1])), lines = [];
    shares.forEach((x, i) => {
      if (typeof x[0] === 'string') lines.push([x[0], parts[i]]);
      else { x[0].spent += parts[i]; lines.push(['wip', parts[i]]); }
    });
    return lines;
  });
  running(s, p, d);
  s.tech += (Math.sqrt(Math.max(0.1, s.budget.rd / p.rd.amount)) - s.tech) * (1 - Math.pow(0.5, 1 / (2 * YEAR)));
  const npc = (flows.npc && flows.npc.co[p.id]) || { s: {}, t: {}, l: {}, cat: 0 };
  let game = 0, live = 0;
  for (const t of s.titles) {
    const line = lineOf(p, t.line), age = d - t.day, got = npc.t[t.id];
    if (got) { t.sold += got[1]; t.units += got[0]; game += got[1]; }
    const target = Math.round(t.cost * (1 - writtenShare(line, age)));
    if (t.book > target) {
      const off = t.book - Math.max(0, target);
      t.book -= off;
      post(s, [['c:amort', off], ['content', -off]]);
    }
  }
  game += Math.round(npc.cat || 0);
  s.catalog *= Math.pow(0.5, 1 / (p.catalogHalf * YEAR));
  for (const v of Object.values(npc.l || {})) live += Math.round(v);
  for (const l of s.live) {
    if (d >= l.next) {
      l.until = d + 45;
      l.next = d + 420 + Math.round(240 * ch.u(`${p.id}:${l.id}:next:${d}`));
      news(out, s, p, d + 1, 2 * 3600, 'update', `${l.name}の大型アップデートを配信`, { title: l.name }, 0.01);
    }
    l.rate = (l.rate || 0) * 29 / 30 + ((npc.l || {})[l.id] || 0) * YEAR / 30;
  }
  cashSale(s, 'game', game);
  cashSale(s, 'live', live);
  s.pr.game = (s.pr.game || 0) * 29 / 30 + game / 30;
  s.pr.live = (s.pr.live || 0) * 29 / 30 + live / 30;
  for (const [key, n] of Object.entries(npc.s || {})) cashSale(s, key, Math.round(n));
  const stores = take(s, 'platform', (game + live) * p.platform);
  const servers = take(s, 'servers', live * (p.live ? p.live.server : 0));
  if (stores) { post(s, [['c:platform', stores], ['cash', -stores]], 'purchases'); w.b2bCash.push({ to: 'jinx', stream: 'platform', n: stores, from: s.id }); }
  if (servers) { post(s, [['c:live', servers], ['ap', -servers]]); s.exp += servers; s.expBy = s.expBy || {}; s.expBy.servers = (s.expBy.servers || 0) + servers; }
  for (const t of s.titles.filter((x) => d - x.day >= CURVE.years * YEAR)) {
    if (t.book > 0) { post(s, [['c:amort', t.book], ['content', -t.book]]); t.book = 0; }
    out.titles.push({ ...titleRow(s, t, p), ended: d });
  }
  s.titles = s.titles.filter((x) => d - x.day < CURVE.years * YEAR);
  projects(w, s, p, d, ch, out);
}

// The projects: each moves on at its own pace; released when done (not before it is due: the time left is polish),
// late when not done when due (or stopped after being late again), and a new one begins in its place.
function projects(w, s, p, d, ch, out) {
  for (const pr of s.projects.slice()) {
    const line = lineOf(p, pr.line), span = line.months * MONTH_DAYS;
    pr.prog += pr.pace * (0.92 + 0.16 * s.morale) * Math.pow(s.tech, 0.1) / span;
    if (pr.prog >= 1 && d < pr.due) pr.polish++;
    if (d + 1 < pr.due) continue;
    if (pr.prog >= 1) { release(w, s, p, pr, d + 1, ch, out); continue; }
    // not done when due: late (by the months it still needs), or, already late, stopped now and then
    const label = `${p.id}:${pr.id}:late:${d}`;
    if (pr.delays >= 1 && ch.u(label) < 0.12 * pr.delays) {
      cancel(s, p, pr, d + 1, out, ch);
      continue;
    }
    const months = Math.max(1, Math.ceil((1 - pr.prog) * span / MONTH_DAYS / (pr.pace * 0.95)));
    pr.due = d + 1 + Math.round(months * MONTH_DAYS);
    pr.delays++;
    news(out, s, p, d + 1, 6 * 3600, 'delay', `『${pr.name}』の発売を${months}か月延期`, { project: pr.id, months }, -0.02, true);
  }
}
function release(w, s, p, pr, day, ch, out) {
  const line = lineOf(p, pr.line), ref = budgetRef(p, line);
  const q = Math.max(30, Math.min(97, Math.round(72 + p.skill + 6 * Math.log(s.tech) + 8 * Math.log(Math.max(0.2, pr.spent / ref))
    + 10 * (s.morale - 0.6) + 5 * pr.z - 1.5 * pr.delays + Math.min(3, pr.polish / 20) + (pr.sequel ? 2 : 0))));
  const expected = line.base * rivals(w, day) * budgetMult(pr.spent / ref) * Math.exp((q - 72) / QUALITY) * Math.pow(s.brand, 0.6) * econOf(w, p.beta) * gameScale(w, p);
  const life = expected * Math.exp(LUCK * pr.luck - LUCK * LUCK / 2);
  const t = { id: 't' + (++s.seq), line: line.id, name: pr.name, genre: pr.genre, day, q, life, est: expected, first: expected, cost: pr.spent, book: pr.spent,
    sold: 0, units: 0, price: line.price, hit: 0, delays: pr.delays };
  // what was being made is now a game on sale
  post(s, [['content', pr.spent], ['wip', -pr.spent]]);
  s.titles.push(t);
  s.brand = Math.max(0.5, Math.min(2.5, s.brand * Math.exp(0.02 * (q - 75) / 5)));
  news(out, s, p, day, 3600, 'release', `新作『${t.name}』（${t.genre}）を発売　評価${q}点`, { title: t.id, q }, 0.03 * Math.max(-2, Math.min(2, (q - 76) / 8)), true);
  out.titles.push(titleRow(s, t, p));
  s.projects = s.projects.filter((x) => x !== pr);
  begin(s, p, line, day, ch, out);
}
function cancel(s, p, pr, day, out, ch) {
  post(s, [['xCancel', pr.spent], ['wip', -pr.spent]]);
  news(out, s, p, day, 6 * 3600, 'cancel', `開発中の『${pr.name}』を中止（特別損失${CORP.fmt.money(pr.spent)}）`, { project: pr.id, loss: pr.spent }, -0.04, true);
  s.projects = s.projects.filter((x) => x !== pr);
  begin(s, p, lineOf(p, pr.line), day, ch, out);
}
function begin(s, p, line, day, ch, out) {
  const pr = newProject(s, p, line, day, ch);
  s.projects.push(pr);
  news(out, s, p, day, 7 * 3600, 'start', `${pr.sequel ? '続編' : '新作'}『${pr.name}』の開発を開始（${line.name}）`, { project: pr.id }, 0.005, false);
}
function titleRow(s, t, p) {
  return { company: s.id, id: t.id, name: t.name, genre: t.genre, line: t.line, day: t.day, q: t.q, cost: t.cost, sold: t.sold, units: t.units, est: Math.round(t.est), first: Math.round(t.first), ended: 0 };
}

// how a game is doing, a month on: news of a hit or a flop, and the studio's name with it; the managers' new estimate
function titlesLook(w, s, p, d, out) {
  for (const t of s.titles) {
    const line = lineOf(p, t.line), age = d - t.day;
    if (age === 6) news(out, s, p, d + 1, 2 * 3600, 'week', `『${t.name}』発売1週間で${CORP.fmt.group(t.units)}本（売上${CORP.fmt.money(t.sold)}）`, { title: t.id }, 0, true);
    if (age >= 14) t.est = Math.max(t.sold, t.sold / Math.max(0.05, soldShare(line, age)));
    if (age === 29) {
      const r = t.est / t.first;
      // (once the country lives, what its people buy of a studio's games teaches the studio what to expect of the next)
      if (w.circ && t.day >= w.circ.from) { const g = w.circ.games || (w.circ.games = {}); g[p.id] = Math.max(0.01, Math.min(3, (g[p.id] || 1) * Math.pow(Math.max(0.05, r), 0.5))); }
      if (r >= 1.4) { t.hit = 1; w.mon[s.id + ':hit'] = 1; news(out, s, p, d + 1, 2 * 3600, 'hit', `『${t.name}』が大ヒット：累計${CORP.fmt.group(t.units)}本`, { title: t.id }, 0.04, true); }
      else if (r <= 0.65) { t.hit = -1; news(out, s, p, d + 1, 2 * 3600, 'flop', `『${t.name}』の販売が計画を下回る`, { title: t.id }, -0.03, true); }
      s.brand = Math.max(0.5, Math.min(2.5, s.brand * Math.exp(0.06 * Math.log(Math.max(0.2, r)))));
    }
  }
}
// at a quarter's end: a game that will not earn back what is left of its cost is written down to what it will
function impair(s, p, d) {
  for (const t of s.titles) {
    const line = lineOf(p, t.line), age = d - t.day;
    if (age < 30) continue;
    const left = Math.max(0, t.est - t.sold) * (1 - p.platform);
    if (t.book > left + 1000000) {
      const off = Math.round(t.book - left);
      t.book -= off;
      // (what is left is written off from here as before: its cost as if it had been this much)
      t.cost = Math.round(t.book / Math.max(0.01, 1 - writtenShare(line, age)));
      post(s, [['xImpair', off], ['content', -off]]);
    }
  }
}

/* ------------------------------------------------------- money and interest --- */
// interest a day: on the money at the bank and on the bonds (paid in), on the loans (paid out)
function interest(w, s, p) {
  if (p.model === 'bank') return;
  const dep = take(s, 'dep', Math.max(0, s.bal.cash || 0) * M.deposit / YEAR), bond = take(s, 'bond', (s.bal.bonds || 0) * M.bonds / YEAR);
  if (dep + bond) post(s, [['cash', dep + bond], ['nInterest', -(dep + bond)]], 'interestIn');
  // (a company abroad once the country lives: its bank and its bonds are abroad too)
  const out = !!w.ext && abroad(s);
  if (!out) w.bank.paid += dep;
  // (the bonds are the country's: their interest is the country's to pay)
  if (w.ext && !out) w.ext.bondInterest += bond;
  let owed = 0;
  for (const l of s.loans) owed += l.amt * l.rate / YEAR;
  const n = take(s, 'loanInt', owed);
  if (n) post(s, [['eInterest', n], ['cash', -n]], 'interestOut');
  if (!out) w.bank.got += n;
}
// the rate a rank-A company borrows at: lower the more of its own money it runs on
function rateFor(w, s) {
  if (s.ip) return MW.loanRate;
  const [lo, hi] = CORP.ranks.A.rate, eq = equityOf(s) / Math.max(1, assetsOf(s));
  const health = hi - (hi - lo) * Math.max(0, Math.min(1, (eq - 0.2) / 0.6));
  // (and a little lower the better it gets on with the bank)
  const rate = health - 0.001 * (tieOf(w, 'tenesice', s.id) - 60) / 40;
  return Math.round(Math.max(lo, Math.min(hi, rate)) * 10000) / 10000;
}
// At a month's end: what it owes paid, and its money put right — `months` of its costs at hand, the rest in bonds;
// short of `floor` months, bonds sold, then borrowed from Tenesice; with plenty again, the loans paid back.
function treasury(w, s, p, d, out) {
  if (p.model === 'bank') return;
  const monthly = monthlyCosts(s);
  const want = monthly * M.months, floor = monthly * M.floor;
  let cash = s.bal.cash || 0;
  if (cash < floor) {
    const sell = Math.min(s.bal.bonds || 0, want - cash);
    if (sell > 0) { post(s, [['cash', sell], ['bonds', -sell]], 'bondsSell'); cash += sell; if (w.ext && !abroad(s)) w.ext.bonds.push({ company: s.id, n: -sell }); }
    if (cash < floor) {
      // (once the country lives, what Tenesice's lending desk allows it: its rate, and its line beyond what it owes,
      // never less than what keeps it paying: server/core/npc-org.js lendingDesk)
      const pol = w.lend && w.lend[s.id];
      let amt = Math.ceil((want - cash) / M.unit) * M.unit, rate = rateFor(w, s);
      if (s.ip) {
        // (MY WAY: Tenesice's 15%, and no more than its line — half its equity, or what the lending desk set: what it
        // will not lend, it does not; out of money then, it fails, at the end of this month: ipFail)
        rate = MW.loanRate;
        const line = pol ? Math.min(pol.cap, Math.max(0, equityOf(s)) * MW.line) : Math.max(0, equityOf(s)) * MW.line;
        const room = Math.max(0, line - debtOf(s));
        amt = Math.min(amt, Math.floor(room / M.unit) * M.unit);
      } else if (pol) {
        rate = pol.rate;
        const room = Math.max(0, pol.cap - debtOf(s));
        amt = Math.max(Math.ceil((floor - cash) / M.unit) * M.unit, Math.min(amt, Math.floor(room / M.unit) * M.unit));
      }
      if (amt <= 0) return;
      s.loans.push({ id: 'L' + (++s.seq), amt, rate, from: d, until: d + M.years * YEAR });
      post(s, [['cash', amt], ['loan', -amt]], 'borrow');
      w.mon[s.id + ':borrowed'] = (w.mon[s.id + ':borrowed'] || 0) + amt;
      news(out, s, p, d + 1, 5 * 3600, 'loan', `テネシスから${CORP.fmt.money(amt)}を借入（年${(rate * 100).toFixed(2)}%）`, { amt, rate }, -0.005, true);
      cash += amt;
    }
  } else if (cash > want * 1.5) {
    // paid back first, then into bonds
    let spare = cash - want;
    for (const l of s.loans) {
      const pay = Math.min(l.amt, spare);
      if (pay <= 0) continue;
      l.amt -= pay;
      spare -= pay;
      post(s, [['loan', pay], ['cash', -pay]], 'repay');
      w.mon[s.id + ':repaid'] = (w.mon[s.id + ':repaid'] || 0) + pay;
    }
    s.loans = s.loans.filter((l) => l.amt > 0);
    if (spare > M.unit) {
      const buy = Math.floor(spare / M.unit) * M.unit;
      post(s, [['bonds', buy], ['cash', -buy]], 'bondsBuy');
      if (w.ext && !abroad(s)) w.ext.bonds.push({ company: s.id, n: buy });
    }
  }
  // loans that come due are rolled over at today's rate
  for (const l of s.loans) if (d >= l.until) { l.until = d + M.years * YEAR; l.rate = rateFor(w, s); }
}
const monthlyCosts = (s) => Math.round(s.n * s.unit / 12 + (spend(s, 'place') + spend(s, 'rd') + spend(s, 'ads') + spend(s, 'other')) / 12);

// What is owed paid, day by day and at the month's end: the suppliers within weeks (each to whom it is owed), the
// customers' money in, the pay and the bills of the month.
function settle(w, s, p, d) {
  const isEnd = CORP.isMonthEnd(d), x = abroad(s) ? null : w.ext;
  for (const [to, owed] of Object.entries(s.owe)) {
    if (owed <= 0) continue;
    const local = to === '*' || to === '@sector';
    const n = Math.min(owed, Math.max(1, Math.trunc(owed / (local ? 30 : termsDays(w, to, s.id)))));
    s.owe[to] = owed - n;
    post(s, [['ap', n], ['cash', -n]], 'purchases');
    if (!local) w.paid.push({ to, n });
    // (once the country lives: to the local businesses, or abroad — only MAGITA's materials and the like)
    else if (x) { if (to === '@sector') x.sector += n; else x.imports += n; }
  }
  if (s.recv > 0) {
    const n = Math.min(s.recv, Math.max(1, Math.trunc(s.recv / (p.model === 'studio' ? 40 : 15))));
    s.recv -= n;
    post(s, [['cash', n], ['ar', -n]], 'receipts');
    // (what customers outside still owed from before the country: theirs, from abroad)
    if (x) x.exports += n;
  }
  // the pay: at the month's end, or (once the country lives) on the 25th, to the people by their pay
  const payday = x ? CORP.ymd(d).d === 25 : isEnd;
  if (payday) {
    const accrued = s.bal.accrued || 0;
    if (accrued) {
      post(s, [['accrued', accrued], ['cash', -accrued]], 'payroll');
      if (x) {
        const acc = s.acc || { salary: accrued, welfare: 0 };
        const salary = Math.min(accrued, Math.round(acc.salary));
        x.pay.push({ company: s.id, n: salary, kind: 'salary' });
        x.welfare.push({ company: s.id, n: accrued - salary, days: 30 });
      }
    }
    s.acc = { salary: 0, welfare: 0 };
  }
  if (!isEnd) return;
  if (s.exp) {
    post(s, [['ap', s.exp], ['cash', -s.exp]], 'expenses');
    // (a share of a parent's research is its child's, for the joint development: MAGITA's to WAZIMA)
    const by0 = s.expBy || {};
    let sent = 0;
    for (const child of p.children || []) {
      const c = w.co[child], n = c && by0.rd > 0 ? Math.min(by0.rd, Math.round(by0.rd * CORP.wazima.codev)) : 0;
      if (!n) continue;
      by0.rd -= n;
      sent += n;
      w.b2bCash.push({ to: child, stream: 'codev', n, from: s.id });
    }
    if (x && s.exp - sent > 0) {
      const by = s.expBy || {}, keys = Object.keys(by).filter((k) => by[k] > 0);
      const parts = keys.length ? split(s.exp - sent, keys.map((k) => by[k])) : [s.exp - sent];
      (keys.length ? keys : ['other']).forEach((k, i) => route(w, s, k, parts[i]));
    }
    s.exp = 0;
  }
  s.expBy = {};
  if (p.capex) {
    const buy = Math.round(s.budget.capex / 12);
    post(s, [['ppe', buy], ['cash', -buy]], 'capex');
    if (x) route(w, s, 'capex', buy);
  }
}
// the money owed to a supplier comes in as the buyer pays it
function received(s, n) { post(s, [['cash', n], ['ar', -n]], 'receipts'); }

/* ---------------------------------------------------------------- people --- */
// The month's comings and goings: some leave (more when the mood is low), new people come to keep to the year's
// plan, and in April the new graduates; June and December pay the bonus, more or less with the year's results.
function month(w, s, p, d, ch, out) {
  // (on the 1st: who leaves and who joins that day)
  const t = CORP.ymd(d);
  // (once the country lives, its people come and go by themselves: server/core/npc-labor.js; s.n is theirs — but a
  // company abroad hires and loses its own people as before)
  if (w.ext && !abroad(s) && t.d === 1) {
    s.morale += 0.05 * (0.62 - s.morale);
    if (s.brand) s.brand += (1 - s.brand) * (1 - Math.pow(0.5, 1 / 36));
  } else if (d >= w.launch && t.d === 1) {
    const label = `${p.id}:people:${d}`;
    const quitRate = p.quit / 12 * (1.6 - s.morale);
    const leave = Math.max(0, Math.round(s.n * quitRate + Math.sqrt(s.n * quitRate) * 0.8 * ch.z(label + ':quit')));
    s.n -= leave;
    const monthsLeft = Math.max(1, Math.round((CORP.fyStart(CORP.fyOf(d) + 1) - d) / MONTH_DAYS));
    let join = Math.max(0, Math.round((s.target - s.n) / monthsLeft));
    if (t.m === 4) {
      // 新卒: most of the year's planned growth at once
      join = Math.max(0, Math.round((s.target - s.n) * 0.6));
      if (join) news(out, s, p, d, 3600, 'hire', `新卒${CORP.fmt.group(join)}人が入社（社員${CORP.fmt.group(s.n + join)}人）`, { join }, 0, false);
    }
    s.n += join;
    s.morale += 0.05 * (0.62 - s.morale);
    // (a studio's name fades back towards the usual between its games)
    if (s.brand) s.brand += (1 - s.brand) * (1 - Math.pow(0.5, 1 / 36));
  }
  // bonuses: what was put by, times how the year is going (0.7〜1.3)
  const m = CORP.ymd(d).m;
  if (CORP.isMonthEnd(d) && (m === 6 || m === 12)) {
    const put = s.bal.bonus || 0, mult = d >= w.launch ? bonusMult(s) : 1;
    const paid = Math.round(put * mult);
    const diff = paid - put;
    post(s, [['bonus', put], ['sBonus', diff], ['cash', -paid]], 'payroll');
    if (w.ext && paid > 0 && !abroad(s)) w.ext.pay.push({ company: s.id, n: paid, kind: 'bonus' });
    s.morale = Math.max(0.2, Math.min(0.95, s.morale + 0.08 * (mult - 1)));
  }
  // 特別賞与 (once the country lives): at June's end, for a year that beat its guidance, up to three months' pay
  if (w.ext && s.payAll && CORP.isMonthEnd(d) && m === 6) {
    const last = s.hist.filter((h) => h.kind === 'y').slice(-1)[0];
    if (last && last.guideNet > 0 && last.net > last.guideNet) {
      const share = Math.min(0.25, (last.net / last.guideNet - 1) * 0.5);
      const n = Math.round(s.n * s.pay * share);
      if (n > 0) {
        post(s, [['sBonus', n], ['cash', -n]], 'payroll');
        if (!abroad(s)) w.ext.pay.push({ company: s.id, n, kind: 'bonus' });
        s.morale = Math.min(0.95, s.morale + 0.05);
        news(out, s, p, d + 1, 3 * 3600, 'bonus', `前年度の業績が予想を上回ったため、社員に特別賞与（${CORP.fmt.money(n)}）を支給`, { n }, 0, false);
      }
    }
  }
}
const bonusMult = (s) => {
  const g = s.guide;
  if (!g || !g.ytdOp) return 1;
  return Math.max(0.7, Math.min(1.3, 1 + 0.6 * (opOf(s.per.y) / Math.max(1, Math.abs(g.ytdOp)) - 1)));
};
const opOf = (sums) => CORP.plOf(sums).op;

/* ------------------------------------------------------------ the year's plan --- */
// A new fiscal year: pay rises with how the last one went, the year's headcount target, and the budgets.
function newYear(w, s, p, d) {
  if (d < w.launch) return;
  const last = s.hist.filter((h) => h.kind === 'y').slice(-1)[0];
  const perf = last && last.guideNet ? Math.max(-1, Math.min(1, last.net / Math.abs(last.guideNet) - 1)) : 0;
  // (the raise its union settled in the spring talks, once the country lives: server/core/npc-labor.js)
  const settled = w.raises && w.raises[s.id];
  const raise = settled !== undefined && settled !== null ? settled : p.raise * (1 + 0.6 * perf);
  // (kept for the country's side: its people's pay rises by it from April, server/core/npc-labor.js)
  s.yearRaise = { fy: CORP.fyOf(d), raise };
  s.pay = Math.round(s.pay * (1 + raise));
  s.unit = Math.round(s.unit * (1 + raise));
  // (a trade hires as fast as its sales are growing now, against how fast they grew at the start)
  const pace = p.model !== 'studio' && p.growth > 0 ? Math.max(0, trend(p, d, w.launch) / trend(p, d - YEAR, w.launch) - 1) / p.growth : 1;
  let growth = p.hire * pace * Math.max(0, Math.min(1.5, 1 + perf));
  if (last && last.net < 0) growth = Math.min(growth, 0);
  // money raised from new shares (the players' buying) goes into more people and more research
  const raised = s.raised || 0;
  growth += Math.max(0, Math.min(0.3, raised * 0.5 / Math.max(1, s.unit * s.n)));
  s.target = Math.round(s.n * (1 + growth));
  const g = p.model === 'studio' ? (last && last.prevSales ? Math.max(0.92, Math.min(1.08, last.sales / last.prevSales)) : 1) : trend(p, d, w.launch) / trend(p, d - YEAR, w.launch);
  s.budget.rd = Math.round(s.budget.rd * g + raised * 0.2);
  s.budget.ads = Math.round(s.budget.ads * g);
  s.budget.other = Math.round(s.budget.other * g);
  if (p.model !== 'studio') s.budget.place = Math.round(s.budget.place * g);
  else s.budget.place = Math.round(s.budget.place * Math.pow(Math.max(0.8, s.n / Math.max(1, s.yearStartN || s.n)), 0.6));
  s.budget.capex = Math.round(s.budget.capex * g);
  s.yearStartN = s.n;
  s.raised = 0;
  s.morale = Math.max(0.2, Math.min(0.95, s.morale + 0.1 * perf));
}

/* ------------------------------------------------------- ICE and RIRU STUDIO --- */
// At the month's end the backer pays its studio: the 業務委託 fee (the studio's sales) and the 開発援助金, more when
// the studio's money runs low or a game is close, less when the backer's year goes badly, within the year's budget.
function backing(w, s, p, d, ch, out) {
  const deal = p.partner;
  if (!deal || deal.role !== 'backer' || !CORP.isMonthEnd(d)) return;
  const st = w.co[deal.with], sp = PROFILES.get(deal.with);
  const fy = CORP.fyOf(d), monthsLeft = Math.max(1, Math.round((CORP.fyEnd(fy) - d) / MONTH_DAYS) + 1);
  if (!s.backing || s.backing.fy !== fy) s.backing = { fy, budget: Math.round(deal.budget * (s.backingScale || 1)), paid: 0 };
  const b = s.backing;
  const fee = Math.round(deal.fee * (s.backingScale || 1));
  const base = Math.max(0, (b.budget - b.paid) / monthsLeft - fee);
  const runway = (st.bal.cash || 0) / Math.max(1, monthlyCosts(st));
  const need = Math.max(-0.5, Math.min(1, (18 - runway) / 18));
  const soon = st.projects.some((pr) => pr.due - d < 60) ? 0.3 : 0;
  const mine = s.guide && s.guide.ytdOp ? Math.max(-0.4, Math.min(0.4, opOf(s.per.y) / Math.max(1, Math.abs(s.guide.ytdOp)) - 1)) : 0;
  const f = Math.max(0.4, Math.min(2.2, (1 + 0.6 * need + soon + 0.5 * mine + 0.15 * ch.z(`${p.id}:support:${d}`)) * (0.8 + 0.4 * tieOf(w, p.id, deal.with) / 100)));
  const support = Math.round(Math.max(deal.support[0] * (s.backingScale || 1), Math.min(deal.support[1] * (s.backingScale || 1), base * f)) / 100000) * 100000;
  b.paid += fee + support;
  w.mon[`support:${p.id}`] = support / Math.max(1, base);
  post(s, [['sPartner', fee + support], ['cash', -(fee + support)]], 'expenses');
  post(st, [['cash', fee], ['r:contract', -fee]], 'receipts');
  post(st, [['cash', support], ['nSupport', -support]], 'support');
  news(out, st, sp, d + 1, 3 * 3600, 'support', `ICE SMOKERから業務委託料${CORP.fmt.money(fee)}・開発援助金${CORP.fmt.money(support)}`, { fee, support }, 0, false);
}

/* --------------------------------------------------------------- dividends --- */
// A day's dividend: a listed company's dividend a share for the day (set at its announcements) on its shares out
// (by the second, as the players' own are counted), another's the year's planned dividends a day; to its holders
// that are companies here their part (as a return of what they hold: 持分法), to the rest outside.
function dividends(w, s, p, d) {
  const out = s.sh.out || outstanding(s);
  let n;
  if (p.listed) {
    const sec = s.sh.sec + out * (Math.max(0, (d + 1) * DAY - Math.max(d * DAY, s.sh.at)));
    n = take(s, 'div', (s.div.daily || 0) * sec / DAY);
  } else n = take(s, 'div', (s.div.total || 0) / YEAR);
  s.sh.sec = 0;
  s.sh.at = (d + 1) * DAY;
  if (n <= 0) return;
  post(s, [['retained', n], ['cash', -n]], 'dividends');
  let held = 0;
  for (const [holder, shares] of Object.entries(s.hold.by || {})) {
    const h = w.co[holder], part = Math.round(n * shares / Math.max(1e-9, out));
    // (a return of the investment as far as it goes; beyond it, 受取配当金)
    const back = Math.min(part, Math.max(0, h.bal.affil || 0));
    if (part > 0) post(h, [['cash', part], ['affil', -back], ['nDividend', -(part - back)]], 'interestIn');
    held += Math.max(0, part);
  }
  // the rest to the people holding it (and the players, whose part their side pays: server/core/stocks.js)
  if (w.ext && n - held > 0 && !abroad(s)) w.ext.dividends.push({ company: s.id, n: n - held, out: Math.max(1, out - Object.values(s.hold.by || {}).reduce((a, b) => a + b, 0)) });
}

/* ------------------------------------------------------------- the quarters --- */
// A quarter's taxes: the year's so far, at the rate the year is expected to pay (its last quarter: the year's own)
function taxes(w, s, p, d, final) {
  const fy = CORP.fyOf(d);
  const pretax = CORP.plOf(s.per.y).pretax;
  // (the profit of a company held by the equity method is not income yet; half the dividends from it are not taxed;
  // a wholly owned child's dividends are not taxed at all: 完全子法人株式等)
  const income = pretax - (s.per.y.nEquity || 0) + (s.per.y.eEquity || 0) - childIncome(s.per.y);
  const args = { fy, paidBusiness: s.tax.bizPaid, carry: s.tax.carry, capital: s.bal.capital, capitalEtc: s.bal.capital + s.bal.reserve, staff: s.n,
    value: (s.per.y.sSalary || 0) + (s.per.y.sWelfare || 0) + (s.per.y.sPlace || 0) + Math.max(0, income) };
  let due;
  if (final) {
    const y = yearTax({ ...args, income });
    due = y.total;
    s.tax.carry = y.carry;
    s.tax.year = { total: y.total, business: y.businessAll, corporate: y.corporate, local: y.local, inhabitant: y.inhabitant, flat: y.flat, used: y.used, taxable: y.taxable };
  } else {
    // the year as guided (or as the quarters so far, by four, if more): the rate it would pay on its income, and the
    // fixed parts (均等割, a 大法人's capital levy) by the quarter
    const q = CORP.quarterOf(d);
    const year = Math.max(s.guide && s.guide.fy === fy ? s.guide.pretax : 0, income * 4 / q, 1);
    const y = yearTax({ ...args, income: year });
    const fixed = y.flat + (y.small ? 0 : Math.floor(args.capitalEtc * CORP.tax.large.capital));
    const rate = Math.max(0, Math.min(0.5, (y.total - fixed) / year));
    due = Math.round(Math.max(0, income) * rate) + Math.round(fixed * q / 4);
  }
  const n = due - s.tax.booked;
  if (n) post(s, [['tax', n], ['taxdue', -n]]);
  s.tax.booked = due;
}
// what a company's 未払法人税等 should be on day `d` (closed): this year's booked less its advance, and last year's
// rest while it is still to be paid (to the end of the year's second month)
export function taxOwed(s, d) {
  const fyMonth = ((CORP.ymd(d).m - 4 + 12) % 12) + 1;
  const last = s.tax.last || {};
  const owed = last.fy && (fyMonth < CORP.tax.finalMonths || (fyMonth === CORP.tax.finalMonths && !CORP.isMonthEnd(d)));
  return (s.tax.booked || 0) - (s.tax.interim || 0) + (owed ? (last.total || 0) - (last.interim || 0) : 0);
}
// a holding's part of a company's net assets (what the 持分法 carries it at)
function stakeValue(t, shares) { return Math.max(0, Math.round(equityOf(t) * shares / Math.max(1e-9, outstanding(t)))); }
// Once, for a world kept before the backer's stake was carried: its investment set at its part of the studio's net
// assets (the difference from what it carried, a 過年度 correction of the retained earnings; no cash moves)
export function repairStakes(w) {
  const fixed = [];
  for (const s of Object.values(w.co)) {
    for (const [held, shares] of Object.entries((s.hold && s.hold.own) || {})) {
      const t = w.co[held];
      if (!t) continue;
      const gap = stakeValue(t, shares) - (s.bal.affil || 0);
      if (!gap) continue;
      post(s, [['affil', gap], ['retained', -gap]]);
      fixed.push({ id: s.id, n: gap });
    }
  }
  (w.fixes || (w.fixes = {})).affil = true;
  return fixed;
}
// Once, for a world kept before the made-up year's tax was no longer paid: what it paid of a tax never booked put
// right (the 未払法人税等 back to what is owed, the same off the retained earnings: a 過年度 correction, no cash moves)
export function repairTaxes(w) {
  const fixed = [];
  for (const s of Object.values(w.co)) {
    if (s.dead || !s.tax) continue;
    const gap = taxOwed(s, w.day) - (s.bal.taxdue || 0);
    if (gap <= 0) continue;
    post(s, [['retained', gap], ['taxdue', -gap]]);
    fixed.push({ id: s.id, n: gap });
  }
  (w.fixes || (w.fixes = {})).tax = true;
  return fixed;
}
// what of a parent's income is its child's (consolidated, paid up or made good): the child pays its own taxes on it
const childIncome = (sums) => (sums['r:wazima'] || 0) - (sums['c:wazima'] || 0) + (sums.nSubsidiary || 0) - (sums.eSubsidiary || 0);
// paid: half of last year's in advance in the year's 8th month (中間納付), the rest in the 2nd month after it ended
function payTaxes(w, s, p, d) {
  if (!CORP.isMonthEnd(d)) return;
  const m = CORP.ymd(d).m, fyMonth = ((m - 4 + 12) % 12) + 1;
  if (fyMonth === CORP.tax.interimMonth && s.tax.last.total > 0) {
    const n = Math.floor(s.tax.last.total / 2);
    post(s, [['taxdue', n], ['cash', -n]], 'taxes');
    if (w.ext && !abroad(s)) w.ext.taxes.push({ company: s.id, n });
    s.tax.interim = n;
  }
  if (fyMonth === CORP.tax.finalMonths) {
    // (a year the books never had — the one made up before the first, its `total` only for the first advance — owes
    // nothing: paying it took cash for a tax never booked, a 未払法人税等 below nothing kept for good)
    const left = s.tax.last.fy ? (s.tax.last.total || 0) - (s.tax.last.interim || 0) : 0;
    if (left) post(s, [['taxdue', left], ['cash', -left]], 'taxes');
    // (a refund, when the advance was more than the year's: the country pays it back)
    if (w.ext && left && !abroad(s)) w.ext.taxes.push({ company: s.id, n: left });
    // (the 事業税 of that year is a cost of this one)
    s.tax.bizPaid = s.tax.last.business || 0;
  }
}

/* ------------------------------------------------------------ the forecast --- */
// What a day is expected to bring and cost, as the managers see it now: the trade's streams at their rate (with the
// players' money as of late), the studio's games by their estimates and its projects by their plans, the year's
// costs by its budgets, interest on what it holds.
function expectDay(w, s, p, d) {
  if (w.circ && d >= w.circ.from && !p.abroad) return expectCountry(w, s, p, d);
  const e = {};
  const add = (k, v) => { e[k] = (e[k] || 0) + v; };
  ipExpect(w, s, p, d, add);
  const people = s.n * s.unit / YEAR, season = seasonOf(p, d);
  if (p.model === 'studio') {
    let game = 0, live = 0;
    for (const t of s.titles) {
      const line = lineOf(p, t.line), age = d - t.day;
      if (age >= CURVE.years * YEAR) continue;
      game += t.est * (soldShare(line, age) - soldShare(line, age - 1)) * season;
      add('c:amort', t.cost * (writtenShare(line, age) - writtenShare(line, age - 1)));
    }
    for (const pr of s.projects) {
      const line = lineOf(p, pr.line), age = d - Math.max(pr.due, w.day + 1);
      if (age < 0) continue;
      const ref = budgetRef(p, line), spent = Math.max(pr.spent, ref);
      const est = line.base * rivals(w, d) * budgetMult(spent / ref) * Math.exp((p.skill + 6 * Math.log(s.tech)) / QUALITY) * Math.pow(s.brand, 0.6);
      game += est * (soldShare(line, age) - soldShare(line, age - 1)) * season;
      add('c:amort', spent * (writtenShare(line, age) - writtenShare(line, age - 1)));
    }
    const years = (d - w.day) / YEAR;
    game += s.catalog * Math.pow(0.5, years / p.catalogHalf) * season / YEAR;
    for (const l of s.live) live += l.rate * Math.pow(0.5, years / p.live.half) * season / YEAR;
    add('r:game', game);
    add('r:live', live);
    add('r:license', s.license / YEAR);
    add('c:platform', (game + live) * p.platform);
    if (p.live) add('c:live', live * p.live.server + people * p.makers * lineOf(p, 'live').team);
    if (p.contract) { add('c:contract', people * p.makers * contractShare(s, p)); add('r:contract', PROFILES.get(p.partner.with).partner.fee * 12 / YEAR); }
    if (p.partner && p.partner.role === 'studio') add('nSupport', (PROFILES.get(p.partner.with).partner.budget - PROFILES.get(p.partner.with).partner.fee * 12) / YEAR);
    if (p.partner && p.partner.role === 'backer') add('sPartner', p.partner.budget / YEAR);
    add('sSalary', people * (1 - p.makers));
    add('sDepr', s.bal.ppe / (p.life * YEAR));
  } else if (p.model === 'bank') {
    for (const x of p.streams) add('r:' + x.id, p.sales * x.share * trend(p, d, w.launch) * econOf(w, x.beta ?? p.beta) / YEAR);
    add('sCredit', p.sales * p.credit.share * trend(p, d, w.launch) * econOf(w, p.credit.beta) / YEAR);
    add('sSalary', people);
  } else {
    const lift = trend(p, d, w.launch);
    for (const x of p.streams) {
      if (x.to) continue;
      // (YOSIDA's seeds: this month's shipments, or an average month's — from the launch on, and only as seen from
      // then: the made-up past's plans and dividends knew nothing of them)
      if (x.seeds) {
        if (d < w.launch || w.day + 1 < w.launch) continue;
        const sd = YS.seeds, price = s.seeds ? s.seeds.price : (sd.price[0] + sd.price[1]) / 2;
        const n = s.seeds ? s.seeds.n : Math.min((sd.month[0] + sd.month[1]) / 2, seedsCap(s) / 12 / price);
        add('r:' + x.id, n * price / MONTH_DAYS);
        add('c:' + x.id, n * sd.cost / MONTH_DAYS);
        continue;
      }
      const edge = s.rnd ? s.rnd.edge : 1, f = lift * season * edge * econOf(w, x.beta ?? p.beta) / YEAR;
      const players = s.pr && s.pr[x.id] || 0;
      if (x.products) {
        // (each product as its maker sells with the economy: productLift)
        const k = productsYear(x.products, s.id, (pr) => productLift(w, pr, x.beta ?? p.beta)), g = lift * season * edge / YEAR;
        add('r:' + x.id, k.sales * g + players);
        add('c:' + x.id, k.cost * g + players * k.cost / Math.max(1, k.sales));
        add('sSelling', k.selling * g + players * k.selling / Math.max(1, k.sales));
      } else {
        const share = s.share && s.share[x.id] !== undefined ? s.share[x.id] : (x.share || 0);
        const cost = s.cost && s.cost[x.id] !== undefined ? s.cost[x.id] : (x.cost || 0);
        const base = p.sales * share * f * (s.scale && s.scale[x.id] || 1) + players;
        add('r:' + x.id, base);
        add('c:' + x.id, base * cost);
      }
    }
    if (p.materials) {
      // what the dealer and the shop are expected to buy of it, at their own rates
      let made = 0;
      for (const x of p.streams) {
        if (!x.to || x.to === '*') continue;
        const k = w.b2b0[p.id + ':' + x.to] || { buy: 0, excl: 0, cost: 0 }, g = trend(PROFILES.get(x.to), d, w.launch) * seasonOf(PROFILES.get(x.to), d) / YEAR;
        add('r:' + x.id, k.buy * g);
        add('r:excl', k.excl * g);
        made += k.cost * g;
      }
      add('c:materials', (e['r:export'] || 0) * s.materials + made);
      add('c:factory', people * p.factory);
      add('sSalary', people * (1 - p.factory));
    } else add('sSalary', people);
  }
  add(p.model === 'maker' ? 'c:plant' : 'sPlace', spend(s, 'place') / YEAR);
  add('sRd', spend(s, 'rd') / YEAR);
  add('sAds', spend(s, 'ads') / YEAR);
  add('sOther', spend(s, 'other') / YEAR);
  // (what the game's prizes and buy-backs cost it of late, and its child's month: CORP.yosida, CORP.daizin, WAZIMA)
  for (const [k, v] of Object.entries(s.pc || {})) if (v) add('c:' + k, v);
  if (s.subAvg) add(s.subAvg > 0 ? 'nSubsidiary' : 'eSubsidiary', Math.abs(s.subAvg));
  if (p.model !== 'bank') {
    add('nInterest', Math.max(0, s.bal.cash || 0) * M.deposit / YEAR + (s.bal.bonds || 0) * M.bonds / YEAR);
    add('eInterest', s.loans.reduce((n, l) => n + l.amt * l.rate, 0) / YEAR);
  }
  return e;
}
// Once the country lives, the managers expect each day to bring what an average day of late brought (by stream:
// the people's, the players', the other companies', the country's money), and its costs as its budgets and its
// streams' costs say.
function expectCountry(w, s, p, d) {
  const e = {};
  const add = (k, v) => { e[k] = (e[k] || 0) + v; };
  ipExpect(w, s, p, d, add);
  const people = s.n * s.unit / YEAR;
  for (const [k, v] of Object.entries(s.pr || {})) {
    if (!v) continue;
    add('r:' + k, v);
    const x = (p.streams || []).find((y) => y.id === k);
    const cost = x ? (s.cost && s.cost[k] !== undefined ? s.cost[k] : (x.cost || 0)) : 0;
    if (cost) add('c:' + k, v * cost);
  }
  if (p.model === 'studio') {
    add('c:platform', ((s.pr.game || 0) + (s.pr.live || 0)) * p.platform);
    for (const t of s.titles) { const line = lineOf(p, t.line), age = d - t.day; if (age < CURVE.years * YEAR) add('c:amort', t.cost * (writtenShare(line, age) - writtenShare(line, age - 1))); }
    if (p.contract) { add('c:contract', people * p.makers * contractShare(s, p)); add('r:contract', PROFILES.get(p.partner.with).partner.fee * 12 / YEAR); }
    if (p.partner && p.partner.role === 'backer') add('sPartner', p.partner.budget / YEAR);
    add('sSalary', people * (1 - p.makers));
    add('sDepr', s.bal.ppe / (p.life * YEAR));
  } else if (p.model === 'maker') {
    add('c:factory', people * p.factory);
    add('sSalary', people * (1 - p.factory));
    add('c:materials', ((s.pr.dealer || 0) + (s.pr.retail || 0)) * 0.25);
  } else add('sSalary', people);
  add(p.model === 'maker' ? 'c:plant' : 'sPlace', spend(s, 'place') / YEAR);
  add('sRd', spend(s, 'rd') / YEAR);
  add('sAds', spend(s, 'ads') / YEAR);
  add('sOther', spend(s, 'other') / YEAR);
  // (what the game's prizes and buy-backs cost it of late, and its child's month: CORP.yosida, CORP.daizin, WAZIMA)
  for (const [k, v] of Object.entries(s.pc || {})) if (v) add('c:' + k, v);
  if (s.subAvg) add(s.subAvg > 0 ? 'nSubsidiary' : 'eSubsidiary', Math.abs(s.subAvg));
  if (p.model !== 'bank') {
    add('nInterest', Math.max(0, s.bal.cash || 0) * M.deposit / YEAR + (s.bal.bonds || 0) * M.bonds / YEAR);
    add('eInterest', s.loans.reduce((n, l) => n + l.amt * l.rate, 0) / YEAR);
  }
  return e;
}
// The year as the managers expect it: what is done, and the rest of it day by day. Taxes at the year's rate.
function forecast(w, s, p, from) {
  const fy = CORP.fyOf(from), sums = { ...s.per.y };
  for (const k of Object.keys(sums)) if (/^cf:/.test(k)) delete sums[k];
  const qs = [{}, {}, {}, {}];
  for (let d = from; d <= CORP.fyEnd(fy); d++) {
    const e = expectDay(w, s, p, d), qsum = qs[CORP.quarterOf(d) - 1];
    for (const k in e) { sums[k] = (sums[k] || 0) + e[k]; qsum[k] = (qsum[k] || 0) + e[k]; }
  }
  const quarters = qs.map((q) => CORP.plOf(q).op);
  const pl = CORP.plOf(sums);
  const income = pl.pretax - (sums.nEquity || 0) - childIncome(sums);
  const y = yearTax({ fy, income, paidBusiness: s.tax.bizPaid, carry: s.tax.carry, capital: s.bal.capital, capitalEtc: s.bal.capital + s.bal.reserve, staff: s.n,
    value: (sums.sSalary || 0) + (sums.sPlace || 0) + Math.max(0, income) });
  const net = pl.pretax - y.total;
  return { fy, sales: Math.round(pl.sales), op: Math.round(pl.op), ord: Math.round(pl.ord), pretax: Math.round(pl.pretax), net: Math.round(net), quarters: quarters.map(Math.round) };
}

// The guidance (業績予想) as published: a little under what is expected (as companies in Japan do), and the
// dividends that go with it: a share of the profit (none when a loss is expected).
function guidance(w, s, p, d, f) {
  const shy = (x, by) => Math.round(x > 0 ? x * by : x * (2 - by));
  const out = Math.max(1, outstanding(s));
  const g = {
    fy: f.fy, pub: d, sales: shy(f.sales, 0.98), op: shy(f.op, 0.95), ord: shy(f.ord, 0.95), pretax: shy(f.pretax, 0.95), net: shy(f.net, 0.95),
    quarters: f.quarters.map((x) => shy(x, 0.95)), expected: f
  };
  g.eps = Math.round(g.net / out);
  g.dps = Math.max(0, Math.round(p.payout * Math.max(0, f.net * 0.95) / out));
  return g;
}
function setDividend(s, p, g) {
  s.div.dps = g.dps;
  s.div.daily = g.dps / YEAR;
  s.div.total = Math.max(0, Math.round(p.payout * Math.max(0, g.net)));
}

/* --------------------------------------------------- closing the periods --- */
function statement(s, p, kind, from, to, key, label) {
  const sums = {};
  for (const [k, v] of Object.entries(s.per[kind])) if (!/^cf:/.test(k)) sums[k] = v;
  const pl = CORP.plOf(sums);
  const cf = {};
  for (const [k, v] of Object.entries(s.per[kind])) if (/^cf:/.test(k)) cf[k.slice(3)] = v;
  const shares = Math.max(1, s.sd[kind] / Math.max(1, to - from + 1));
  return {
    company: s.id, kind, key, label, from, to,
    pl: Object.fromEntries(Object.entries(pl).map(([k, v]) => [k, Math.round(v)])),
    accounts: Object.fromEntries(Object.entries(sums).filter(([, v]) => v).map(([k, v]) => [k, Math.round(v)])),
    bs: { ...s.bal }, cf, cash0: s.cash0[kind] || 0, cash: s.bal.cash || 0,
    shares: Math.round(shares), eps: pl.net / shares, bps: equityOf(s) / Math.max(1, outstanding(s)), dps: s.div.dps,
    staff: s.n, pay: s.pay, unit: s.unit, debt: debtOf(s), tax: kind === 'y' ? s.tax.year : undefined
  };
}
function resetPeriod(s, kind) {
  s.per[kind] = {};
  s.cash0[kind] = s.bal.cash || 0;
  s.sd[kind] = 0;
}
// the month, the quarter and the year that ended with day `d`
function closePeriods(w, s, p, d, out, ch) {
  if (!CORP.isMonthEnd(d)) return;
  const ms = statement(s, p, 'm', CORP.monthStart(d), d, CORP.monthKey(d), CORP.monthLabel(d));
  // (what each product sold that month: to customers outside and to players, its sales and margin)
  if (s.sold) { ms.products = s.sold; s.sold = {}; }
  out.periods.push(ms);
  resetPeriod(s, 'm');
  if (!CORP.isQuarterEnd(d)) return;
  const fy = CORP.fyOf(d), q = CORP.quarterOf(d);
  const qs = statement(s, p, 'q', CORP.quarterStart(fy, q), d, CORP.quarterKey(d), CORP.quarterLabel(d));
  const ann = d + CORP.announce.days;
  qs.announce = ann * DAY + CORP.announce.hour * 3600;
  // (the same quarter a year before, and what the year's guidance expected of it)
  const before = s.hist.find((h) => h.kind === 'q' && h.key === 'FY' + (fy - 1) + 'Q' + q);
  qs.prev = before ? { sales: before.sales, op: before.op, ord: before.ord, net: before.net } : null;
  qs.expected = s.guide && s.guide.fy === fy ? s.guide.expected.quarters[q - 1] : null;
  out.periods.push(qs);
  surchargeCheck(s, p, d, qs, out);
  s.hist.push({ kind: 'q', key: qs.key, sales: qs.pl.sales, op: qs.pl.op, ord: qs.pl.ord, net: qs.pl.net, eps: qs.eps, d });
  resetPeriod(s, 'q');
  s.pend.push({ day: ann, kind: 'results', key: qs.key, q, fy, pl: qs.pl, prev: qs.prev, expected: qs.expected, eps: qs.eps });
  if (!CORP.isFyEnd(d)) return;
  const ys = statement(s, p, 'y', CORP.fyStart(fy), d, CORP.fyKey(d), CORP.fyLabel(d));
  const before2 = s.hist.find((h) => h.kind === 'y' && h.key === 'FY' + (fy - 1));
  out.periods.push(ys);
  s.hist.push({ kind: 'y', key: ys.key, sales: ys.pl.sales, op: ys.pl.op, ord: ys.pl.ord, net: ys.pl.net, eps: ys.eps, d,
    prevSales: before2 ? before2.sales : 0, guideNet: s.guide && s.guide.fy === fy ? s.guide.net : 0 });
  s.hist = s.hist.slice(-16);
  // the year's taxes settle: what is still owed is paid in two months; the 事業税 of it is next year's cost
  s.tax.last = { total: s.tax.year.total, business: s.tax.year.business, interim: s.tax.interim, fy };
  s.tax.interim = 0;
  s.tax.booked = 0;
  resetPeriod(s, 'y');
  void ch;
}

/* ----------------------------------------------------- the market's view --- */
// What a company's shares are worth by its books: its expected profit at the market's multiple and its equity at
// its book multiple, together (a loss counts against it); never less than a third of its equity.
export function fairValue(s, p, w) {
  const eq = equityOf(s), g = s.guide;
  // (its profit as the market sees it: half what is guided for the year, half the last two years' average)
  const qs = s.hist.filter((h) => h.kind === 'q').slice(-8);
  const avg = qs.length ? qs.reduce((n, h) => n + h.net, 0) * 4 / qs.length : 0;
  const ni = g ? 0.5 * g.expected.net + 0.5 * avg : avg;
  // its money (cash and bonds less loans) counts as itself; the rest by its profit and its book
  const cash = p.model === 'bank' ? 0 : Math.max(0, (s.bal.cash || 0) + (s.bal.bonds || 0) - debtOf(s));
  const book = Math.max(0, eq - cash);
  // (投資熱: a partner of MY WAY's is priced the more while its contract runs, as much as the characters pull)
  const mw = w ? contractOf(w, s.id) : null, per = p.per * (mw ? 1 + MW.per * Math.min(1.5, pullOf(w.co.myway.ip)) : 1);
  let v = cash + 0.5 * Math.max(0, ni) * per + 0.5 * book * p.pbr + 0.5 * Math.min(0, ni) * 4;
  // a studio: what its games under way and on sale are expected to earn beyond what they cost, after tax
  if (p.model === 'studio' && w) v += Math.max(-eq / 2, 0.67 * pipeline(w, s, p));
  return Math.max(eq / 8, v);
}
// what a studio's projects are expected to earn when done (as their budgets and the studio stand now, the nearer
// done the surer) and its games on sale still to earn, beyond their costs
function pipeline(w, s, p) {
  let v = 0;
  for (const pr of s.projects) {
    const line = lineOf(p, pr.line), ref = budgetRef(p, line), done = Math.max(0.05, Math.min(1, pr.prog));
    const final = pr.spent / done;
    const q = 72 + p.skill + 6 * Math.log(s.tech) + 8 * Math.log(Math.max(0.2, final / ref));
    const est = line.base * rivals(w, pr.due) * budgetMult(final / ref) * Math.exp((q - 72) / QUALITY) * Math.pow(s.brand, 0.6) * gameScale(w, p);
    v += (est * (1 - p.platform) - final) * Math.sqrt(done);
  }
  for (const t of s.titles) v += Math.max(0, t.est - t.sold) * (1 - p.platform) - t.book;
  return v;
}

/* -------------------------------------------------------------------- news --- */
// A piece of news on day `day`, `at` seconds into it (the 投資 screen and the operator site show it from then); a
// listed company's shares move by `jump` (log) at that second when `market`.
function news(out, s, p, day, at, kind, text, data, jump = 0, market = false) {
  out.news.push({ company: s.id, at: day * DAY + at, kind, text: (p.name ? p.name + '：' : '') + text, data: data || {}, public: market || kind === 'results' || kind === 'revise' });
  if (p.listed && jump && market) out.jumps.push({ company: s.id, day, at: day * DAY + at, jump });
}

/* ------------------------------------------------------- MAGITA's research --- */
// what MAGITA's research has cut its materials to (1: nothing yet), and its surcharge on a car while it struggles
const MG = CORP.magita;
const labMult = (w, maker) => (maker === 'magita' && w.co.magita && w.co.magita.lab ? w.co.magita.lab.mult : 1);
function surchargeOf(w, kind, id) {
  const s = w.co.magita;
  const pr = kind === 'cars' && CORP.products.cars[id];
  return pr && pr.maker === 'magita' && s && s.surcharge && !MG.surcharge.except.includes(id) ? MG.surcharge.amount : 0;
}
export const surcharges = (w) => Object.fromEntries(RULES.cars.filter((c) => surchargeOf(w, 'cars', c.id) && CORP.products.cars[c.id]).map((c) => [c.id, MG.surcharge.amount]));
const MONTH = YEAR / 12;
// the research begun (on the first live day; a world begun before it had research begins it then)
function startLab(s, d) {
  s.lab = { mult: 1, speed: 1, list: MG.research.map((r) => ({ id: r.id, start: d, due: d + Math.round(r.months * MONTH), done: 0, ok: null })) };
}
// the day's research: what is due is done (succeeding by its chance), its cut taken; RIMU TAG done, what is left of
// the rest shortened
function labDay(w, s, p, d, ch, out) {
  if (!s.lab) startLab(s, d);
  for (const r of s.lab.list) {
    if (r.done || r.due > d) continue;
    const spec = MG.research.find((x) => x.id === r.id);
    r.done = d;
    r.ok = spec.chance >= 1 || ch.u(`magita:lab:${r.id}`) < spec.chance;
    if (!r.ok) { news(out, s, p, d + 1, 3 * 3600, 'lab', `${spec.name}の開発は目標に届かず終了しました`, { id: r.id, ok: false }, 0, true); continue; }
    if (spec.cut) s.lab.mult *= 1 - spec.cut;
    if (spec.speed) {
      s.lab.speed *= 1 - spec.speed;
      for (const o of s.lab.list) if (!o.done) o.due = d + Math.ceil((o.due - d) * (1 - spec.speed));
    }
    news(out, s, p, d + 1, 3 * 3600, 'lab', spec.cut ? `${spec.name}の開発に成功：製造原価を${Math.round(spec.cut * 100)}%削減` : `${spec.name}の開発に成功：ほかの研究期間を${Math.round(spec.speed * 100)}%短縮`,
      { id: r.id, ok: true }, 0, true);
  }
}
// at a quarter's end: struggling (below `on` of the plan, or a loss), the surcharge on; back at `off`, off
function surchargeCheck(s, p, d, qs, out) {
  if (s.id !== 'magita' || !s.launchDay || d < s.launchDay) return;
  const op = qs.pl.op, plan = qs.expected;
  const bad = op < 0 || (plan > 0 && op < plan * MG.surcharge.on), good = op >= 0 && (!(plan > 0) || op >= plan * MG.surcharge.off);
  if (!s.surcharge && bad) {
    s.surcharge = d + 1;
    news(out, s, p, d + 1, 2 * 3600, 'surcharge', `経営悪化のため、オンヴォーロ以外の全車種の仕入れ価格に手数料${CORP.fmt.money(MG.surcharge.amount)}を上乗せします`, { on: true }, 0, true);
  } else if (s.surcharge && good) {
    s.surcharge = 0;
    news(out, s, p, d + 1, 2 * 3600, 'surcharge', '業績が回復したため、車両の仕入れ価格への手数料の上乗せを終了します', { on: false }, 0, true);
  }
}

/* ------------------------------------------------------------- MAGITA Garage --- */
// At a month's end MAGITA sets the next month's garage fee (a place, a month: server/core/garagebill.js takes it):
// `base` while it does well; while it does badly (the quarter so far short of 90% of its plan, the month a loss, or
// its surcharge on) `min`〜`max`, the worse the dearer.
const GF = MG.garage;
function garageFee(w, s, p, d, out) {
  const fy = CORP.fyOf(d), qn = CORP.quarterOf(d), qs = CORP.quarterStart(fy, qn);
  const qOp = opOf(s.per.q), mPl = CORP.plOf(s.per.m);
  const planQ = s.guide && s.guide.fy === fy ? s.guide.expected.quarters[qn - 1] * (d - qs + 1) / (CORP.quarterEnd(fy, qn) - qs + 1) : 0;
  let sev = 0;
  if (qOp < 0) sev = 1;
  else if (planQ > 0 && qOp < planQ * 0.9) sev = Math.min(1, (0.9 - qOp / planQ) / 0.9 * 1.5);
  if (mPl.op < 0) sev = Math.max(sev, Math.min(1, 0.4 + -mPl.op / Math.max(1, Math.abs(mPl.sales)) * 4));
  if (s.surcharge) sev = Math.max(sev, 0.5);
  const fee = sev > 0 ? Math.max(GF.min, Math.min(GF.max, Math.round((GF.min + (GF.max - GF.min) * sev) / 10000) * 10000)) : GF.base;
  const was = s.garageFee || GF.base;
  s.garageFee = fee;
  if (fee === was) return;
  const next = CORP.monthLabel(d + 1);
  news(out, s, p, d + 1, 2 * 3600, 'garage', fee > GF.base
    ? `経営状況により、${next}のMAGITA Garage契約料をガレージ1台あたり${CORP.fmt.money(was)}→${CORP.fmt.money(fee)}に改定します`
    : `業績が回復したため、${next}のMAGITA Garage契約料をガレージ1台あたり${CORP.fmt.money(fee)}に戻します`, { from: was, to: fee }, 0, true);
}
// the garage fee a place for this month
export const garageFeeOf = (w) => (w && w.co.magita && w.co.magita.garageFee) || GF.base;

/* --------------------------------------------------------- people and research --- */
// At a quarter's end: a company that did badly (its operating profit of the year so far under `cutBelow` of what its
// plan expected of it, or a loss) lets some of its people go — the worse, the more — with `severance` months of pay each
// (once the country lives its own people leave: server/core/npc-labor.js dismisses them and pays it); one that did
// well (over `growAbove`) hires more.
const ST = CORP.staffing;
function staffing(w, s, p, d, out) {
  // (the year so far against what the plan expected of it: a studio's quarters swing with its releases)
  const fy = CORP.fyOf(d), qn = CORP.quarterOf(d);
  const op = opOf(s.per.y), plan = s.guide && s.guide.fy === fy ? s.guide.expected.quarters.slice(0, qn).reduce((a, b) => a + b, 0) : null;
  const ratio = plan > 0 ? op / plan : null;
  const people = !!(w.circ && d >= w.circ.from && !p.abroad);
  if (op < 0 || (ratio !== null && ratio < ST.cutBelow)) {
    const sev = op < 0 ? 1 : Math.max(0, Math.min(1, (ST.cutBelow - ratio) / ST.cutBelow));
    const n = Math.min(s.n - 1, Math.round(s.n * (ST.cut[0] + (ST.cut[1] - ST.cut[0]) * sev)));
    if (n <= 0) return;
    const each = Math.round(s.pay / 12 * ST.severance), all = n * each;
    if (people) s.cut = { n, day: d + 1, each };
    else {
      s.n -= n;
      post(s, [['sSeverance', all], ['cash', -all]], 'payroll');
    }
    s.target = Math.max(1, s.n - (people ? n : 0));
    s.morale = Math.max(0.2, s.morale - 0.06);
    news(out, s, p, d + 1, 3 * 3600, 'staff', `業績不振のため、社員${CORP.fmt.group(n)}人の削減を決定（退職金 1人${CORP.fmt.money(each)}・計${CORP.fmt.money(all)}）`, { cut: n, each }, 0.01, true);
  } else if (ratio !== null && ratio > ST.growAbove) {
    const share = ST.grow[0] + (ST.grow[1] - ST.grow[0]) * Math.min(1, (ratio - ST.growAbove) / ST.growAbove);
    const add = Math.max(1, Math.round(s.n * share));
    s.target = Math.max(s.target || s.n, s.n) + add;
    news(out, s, p, d + 1, 3 * 3600, 'staff', `好業績のため採用を拡大（採用計画 +${CORP.fmt.group(add)}人）`, { grow: add }, 0, true);
  }
}
// 技術開発: one development at a time, begun on a month's first day and done after its months; it succeeds the likelier
// the more people the company has (against its size at the start), the better their mood and the more it spends on
// research, and lifts its trade the more the bigger it is (`edge`: its sales a day; a studio's research instead, which
// makes its games better). What it won fades a little month by month (the others catch up).
const TC = CORP.tech;
// how big a company is meant to be in this world: a country of fewer people than the full one has smaller companies
export const sizeScale = (w, p) => (w && w.circ && !p.abroad ? w.circ.scale || 1 : 1);
function tech(w, s, p, d, ch, out) {
  const r = s.rnd || (s.rnd = { n: 0, ok: 0, cur: null, edge: 1 });
  r.edge = 1 + (r.edge - 1) * 0.985;
  if (!r.cur) {
    const months = TC.months[0] + Math.floor(ch.u(`${p.id}:tech:len:${d}`) * (TC.months[1] - TC.months[0] + 1));
    const name = `${ch.pick(`${p.id}:tech:name:${d}`, TC.names)}${TC.kinds[p.model] || '技術'}`;
    r.cur = { id: ++r.n, name, start: d, due: d + Math.round(months * MONTH) };
    news(out, s, p, d + 1, 2 * 3600, 'tech', `${name}の開発を開始（${months}か月の予定・社員${CORP.fmt.group(s.n)}人）`, { id: r.cur.id }, 0, false);
    return;
  }
  if (d < r.cur.due) return;
  // (against its size at the start, in a country of the size it is)
  const sc = sizeScale(w, p);
  const size = Math.max(0.2, Math.min(3, s.n / Math.max(1, p.staff * sc)));
  const spend = Math.max(0.2, Math.min(3, (s.budget.rd || 0) / Math.max(1, p.rd.amount * sc)));
  const chance = Math.max(0.05, Math.min(0.95, TC.chance * Math.pow(size, 0.8) * (0.6 + 0.7 * s.morale) * Math.pow(spend, 0.3)));
  const cur = r.cur;
  r.cur = null;
  cur.chance = Math.round(chance * 1000) / 1000;
  if (ch.u(`${p.id}:tech:${cur.id}`) >= chance) {
    r.last = { ...cur, ok: false, day: d };
    news(out, s, p, d + 1, 3 * 3600, 'tech', `${cur.name}の開発は成果が出ず終了しました`, { id: cur.id, ok: false }, -0.01, true);
    return;
  }
  const lift = (TC.edge[0] + (TC.edge[1] - TC.edge[0]) * ch.u(`${p.id}:tech:q:${cur.id}`)) * Math.min(1.5, Math.sqrt(size));
  r.ok++;
  if (p.model === 'studio') s.tech *= 1 + lift * 2;
  else r.edge = Math.min(TC.maxEdge, r.edge * (1 + lift));
  r.last = { ...cur, ok: true, lift: Math.round(lift * 1000) / 1000, day: d };
  news(out, s, p, d + 1, 3 * 3600, 'tech', `${cur.name}の開発に成功：${p.model === 'studio' ? 'ゲームの品質' : '売上'}が約${(lift * (p.model === 'studio' ? 2 : 1) * 100).toFixed(1)}%向上`, { id: cur.id, ok: true }, 0.02 + lift, true);
}

/* ------------------------------------------- the game's businesses and the treasury --- */
// The players' money of the game's own businesses on a day (server/core/api.js, gacha.js, tree.js send it), booked
// once every company's day is done:
// - '@state': what the country's treasury paid ({ slots: what the spins won beyond their bets, quests: the quests'
//   rewards — YOSIDA's fee in them too —, gacha: YOSIDA's bill for the gacha }), kept in the world's ledger (w.gov)
//   and, once the country lives, taken out of its treasury (out.ext.state, server/core/npc-state.js)
// - '@prize': what YOSIDA's gacha gave away ({ lot: tokens, royal, garage, vip, tree: how many, cars: { id: how many } })
// - yosida.trees: the trees won at the players' auctions ({ market: [how many, $] })
// - '@coins': the ロイヤルコイン DAIZIN bought back ({ n, paid })
const GOV_KEEP = 24;
function gameDay(w, d, flows) {
  for (const s of Object.values(w.co)) if (s.pc) for (const k of Object.keys(s.pc)) s.pc[k] *= 29 / 30;
  const ys = w.co.yosida, dz = w.co.daizin;
  const st = flows['@state'] || {}, pz = flows['@prize'] || {}, coins = flows['@coins'] || null, mine = flows.yosida || {};
  // the treasury
  const paid = { slots: Math.round(st.slots || 0), quests: Math.round(st.quests || 0), gacha: Math.round(st.gacha || 0) };
  const fee = Math.round(mine.questfee || 0);
  if (paid.slots || paid.quests || paid.gacha) {
    const g = w.gov || (w.gov = { all: {}, months: {} }), mk = CORP.monthKey(d), m = g.months[mk] || (g.months[mk] = {});
    for (const [k, n] of Object.entries(paid)) { g.all[k] = (g.all[k] || 0) + n; m[k] = (m[k] || 0) + n; }
    g.all.questfee = (g.all.questfee || 0) + fee;
    m.questfee = (m.questfee || 0) + fee;
    const keys = Object.keys(g.months).sort();
    while (keys.length > GOV_KEEP) delete g.months[keys.shift()];
    if (w.ext) {
      const away = ys && abroad(ys) ? fee + paid.gacha : 0;
      w.ext.state = { by: { slotWins: paid.slots, questRewards: paid.quests, gachaClaims: paid.gacha }, players: paid.slots + paid.quests - fee, abroad: away };
    }
  }
  if (ys && paid.gacha > 0) {
    cashSale(ys, 'claim', paid.gacha);
    ys.pr.claim = (ys.pr.claim || 0) + paid.gacha / 30;
    bizCount(ys, d, 'claim', paid.gacha);
  }
  if (ys) {
    if (fee) bizCount(ys, d, 'questfee', fee);
    if (mine.gacha) bizCount(ys, d, 'gacha', mine.gacha);
    if (mine.fertilizer) bizCount(ys, d, 'fertilizer', mine.fertilizer);
    prizes(w, ys, d, pz);
    // the trees the players won at the auctions: its sale, each made at its cost
    for (const [, got] of Object.entries(mine.trees || {})) {
      const [n, money] = got;
      if (!(n > 0)) continue;
      cashSale(ys, 'tree', money);
      const cost = n * YS.tree;
      post(ys, [['c:tree', cost], ['ap', -cost]]);
      ys.owe['*'] = (ys.owe['*'] || 0) + cost;
      ys.pr.tree = (ys.pr.tree || 0) + money / 30;
      (ys.pc || (ys.pc = {})).tree = (ys.pc.tree || 0) + cost / 30;
      ys.players = (ys.players || 0) + money;
      bizCount(ys, d, 'trees', n);
      bizCount(ys, d, 'treeSales', money);
    }
  }
  // DAIZIN's buying back of the players' coins, out of its own money (to the players: out of the country)
  if (dz && coins && coins.paid > 0) {
    post(dz, [['c:coinbuy', coins.paid], ['cash', -coins.paid]], 'purchases');
    (dz.pc || (dz.pc = {})).coinbuy = (dz.pc.coinbuy || 0) + coins.paid / 30;
    bizCount(dz, d, 'coins', coins.n || 0);
    bizCount(dz, d, 'coinPaid', coins.paid);
    if (w.ext && !abroad(dz)) w.ext.toPlayers = (w.ext.toPlayers || 0) + coins.paid;
  }
}
// a business's count kept by the month (for the operator site: the last 13 months)
function bizCount(s, d, k, n) {
  if (!n) return;
  const b = s.biz || (s.biz = {}), mk = CORP.monthKey(d), m = b[mk] || (b[mk] = {});
  m[k] = (m[k] || 0) + n;
  const keys = Object.keys(b).sort();
  while (keys.length > 13) delete b[keys.shift()];
}
// what a car given away in the gacha is worth to its maker: [its maker, what the buyer pays, what making it cost]
function gachaCar(w, id) {
  const pr = CORP.products.cars[id];
  if (pr) {
    if (pr.maker === 'yosida') return ['yosida', pr.buy, pr.cost];
    return [pr.maker, pr.buy + (pr.excl || 0) + surchargeOf(w, 'cars', id), Math.round(pr.cost * labMult(w, pr.maker))];
  }
  const car = RULES.cars.find((c) => c.id === id);
  const worth = Math.round(((car && car.price) || YS.gacha.worth[id] || YS.gacha.worth['porsche-kuia-spyder']) * YS.gacha.carShare);
  return ['magita', worth, Math.round(worth * 0.25)];
}
// The gacha's prizes, what each costs YOSIDA (CORP.yosida.gacha): the lot coins out of its retained earnings; the
// coins, tickets and cars bought of their makers (paid at once: their sales); its own trees and cars made at cost.
function prizes(w, ys, d, pz) {
  const G = YS.gacha;
  let cost = 0;
  const buy = (to, stream, n, extra = {}) => {
    if (!(n > 0)) return;
    post(ys, [['c:gacha', n], ['cash', -n]], 'purchases');
    cost += n;
    if (w.co[to]) w.b2bCash.push({ to, stream, n, from: ys.id, ...extra });
    else if (w.ext && !abroad(ys)) w.ext.sector += n;
  };
  // ロットコイン: tokens at their $, straight out of its retained earnings (not a cost of the day)
  const lot = Math.round((pz.lot || 0) * RULES.tokenPrice);
  if (lot > 0) {
    post(ys, [['retained', lot], ['cash', -lot]], 'expenses');
    bizCount(ys, d, 'lot', lot);
    if (w.ext && !abroad(ys)) w.ext.toPlayers = (w.ext.toPlayers || 0) + lot;
  }
  if (pz.royal > 0) { buy('daizin', 'coins', pz.royal * G.royal); bizCount(ys, d, 'royal', pz.royal); }
  if (pz.vip > 0) {
    const each = vipWeekOf(w);
    buy('daizin', 'coins', pz.vip * each);
    bizCount(ys, d, 'vip', pz.vip);
    bizCount(ys, d, 'vipPaid', pz.vip * each);
    w.mon['yosida:daizin'] = (w.mon['yosida:daizin'] || 0) + pz.vip * each;
  }
  if (pz.garage > 0) { buy('magita', 'garage', pz.garage * G.garage); bizCount(ys, d, 'garage', pz.garage); }
  for (const [id, n] of Object.entries(pz.cars || {})) {
    if (!(n > 0)) continue;
    const [maker, each, made] = gachaCar(w, id);
    bizCount(ys, d, 'cars', n);
    if (maker === ys.id) {
      // its own car: a sale of its cars to its gacha (in the house), made at its cost
      const v = n * each, m = n * made;
      post(ys, [['c:gacha', v], ['r:gachacar', -v], ['c:materials', m], ['ap', -m]]);
      ys.owe['*'] = (ys.owe['*'] || 0) + m;
      cost += v;
      continue;
    }
    buy(maker, 'gacha', n * each, { cost: n * made, item: { id, n } });
  }
  // the money trees: its own, each made at its cost (paid to its suppliers abroad within weeks)
  if (pz.tree > 0) {
    const n = pz.tree * YS.tree;
    post(ys, [['c:gacha', n], ['ap', -n]]);
    ys.owe['*'] = (ys.owe['*'] || 0) + n;
    cost += n;
    bizCount(ys, d, 'tree', pz.tree);
  }
  if (cost) {
    (ys.pc || (ys.pc = {})).gacha = (ys.pc.gacha || 0) + cost / 30;
    bizCount(ys, d, 'prizeCost', cost);
  }
}

/* ------------------------------------------------------------ YOSIDA's month --- */
// At a month's end YOSIDA sets next month's fee on the quests' rewards (CORP.yosida.quest): the worse it does the
// higher (its quarter short of 90% of its plan, or the month a loss: `min`〜`max`); doing well, now and then it wants
// more for a few months (`min`〜`greedMax`); else `base`.
const YQ = YS.quest;
function questFeeSet(w, s, p, d, out, ch) {
  const fy = CORP.fyOf(d), qn = CORP.quarterOf(d), qs = CORP.quarterStart(fy, qn);
  const qOp = opOf(s.per.q), mPl = CORP.plOf(s.per.m);
  const planQ = s.guide && s.guide.fy === fy ? s.guide.expected.quarters[qn - 1] * (d - qs + 1) / (CORP.quarterEnd(fy, qn) - qs + 1) : 0;
  let sev = 0;
  if (qOp < 0) sev = 1;
  else if (planQ > 0 && qOp < planQ * 0.9) sev = Math.min(1, (0.9 - qOp / planQ) / 0.9 * 1.5);
  if (mPl.op < 0) sev = Math.max(sev, Math.min(1, 0.4 + -mPl.op / Math.max(1, Math.abs(mPl.sales)) * 4));
  const was = s.questFee || YQ.base, key = CORP.monthKey(d);
  let fee, why;
  if (sev > 0) { fee = YQ.min + (YQ.max - YQ.min) * sev; why = 'bad'; }
  else if (s.greedUntil && d < s.greedUntil) { fee = s.greedFee; why = 'greed'; }
  else if (ch.u(`yosida:greed:${key}`) < YQ.greed) {
    s.greedUntil = CORP.monthEnd(d + 1 + Math.round((YQ.months - 1) * MONTH));
    s.greedFee = YQ.min + (YQ.greedMax - YQ.min) * ch.u(`yosida:greedFee:${key}`);
    fee = s.greedFee;
    why = 'greed';
  } else { fee = YQ.base; why = 'base'; s.greedUntil = 0; }
  fee = Math.max(YQ.base, Math.min(YQ.max, Math.round(fee * 100) / 100));
  s.questFee = fee;
  if (fee === was) return;
  const next = CORP.monthLabel(d + 1), pct = (x) => Math.round(x * 100) + '%';
  news(out, s, p, d + 1, 2 * 3600, 'quest', fee > was
    ? `${why === 'bad' ? '経営状況により' : '収益の強化のため'}、${next}からクエスト報酬の手数料を${pct(was)}→${pct(fee)}に引き上げます`
    : `${next}からクエスト報酬の手数料を${pct(was)}→${pct(fee)}に${fee === YQ.base ? '戻します' : '引き下げます'}`, { from: was, to: fee, why }, 0, true);
}
// the fee on the quests' rewards this month
export const questFeeOf = (w) => (w && w.co.yosida && w.co.yosida.questFee) || YQ.base;
// At a month's end YOSIDA and DAIZIN agree next month's price of a VIP1週間券 (CORP.yosida.gacha.vipWeek): DAIZIN
// asks more while it does badly, YOSIDA gives less while it does; the better they get on, the less it costs.
function vipWeekSet(w, s, p, d, out, ch) {
  const dz = w.co.daizin;
  if (!dz) return;
  const [lo, hi] = YS.gacha.vipWeek, key = CORP.monthKey(d);
  const hurt = (c) => { const m = CORP.plOf(c.per.m); return m.op < 0 ? 1 : 0; };
  const tie = tieOf(w, 'yosida', 'daizin');
  let f = 0.5 + 0.2 * hurt(dz) - 0.2 * hurt(s) - (tie - 50) / 200 + 0.12 * ch.z(`vipweek:${key}`);
  f = Math.max(0, Math.min(1, f));
  const was = s.vipWeek || 0, price = Math.round((lo + (hi - lo) * f) / 10000) * 10000;
  s.vipWeek = price;
  if (price === was) return;
  news(out, s, p, d + 1, 3 * 3600, 'deal', `DAIZINとの交渉で、${CORP.monthLabel(d + 1)}のVIP1週間券の買い取り価格を1枚${CORP.fmt.money(price)}に決めました（ビジネス友好度${Math.round(tie)}）`, { from: was, to: price }, 0, false);
}
// what YOSIDA pays DAIZIN for a VIP1週間券 now (before the first talks: the middle of the range)
export const vipWeekOf = (w) => (w && w.co.yosida && w.co.yosida.vipWeek) || Math.round((YS.gacha.vipWeek[0] + YS.gacha.vipWeek[1]) / 2 / 10000) * 10000;

/* ------------------------------------------------------------ WAZIMA's work --- */
// WAZIMA's research (CORP.wazima, its `wlab`), begun on the first live day it has: each done cuts its parent's costs
// besides materials (MAGITA's `save`: place, rd, other), never below `next.floor` of what they were.
const WZ = CORP.wazima;
function wazimaLab(w, s, p, d, ch, out) {
  const parent = w.co[p.parent];
  if (!parent) return;
  if (!s.wlab) s.wlab = { list: WZ.research.map((r) => ({ id: r.id, name: r.name, of: r.of, cut: r.cut, chance: r.chance, start: d, due: d + Math.round(r.months * MONTH), done: 0, ok: null })), n: 0 };
  const save = parent.save || (parent.save = { place: 1, rd: 1, other: 1 });
  for (const r of s.wlab.list) {
    if (r.done || r.due > d) continue;
    r.done = d;
    r.ok = ch.u(`wazima:lab:${r.id}`) < r.chance;
    if (!r.ok) { news(out, s, p, d + 1, 3 * 3600, 'lab', `${r.name}の研究は目標に届かず終了しました`, { id: r.id, ok: false }, 0, false); continue; }
    const cut = {};
    for (const k of r.of) {
      const to = Math.max(WZ.next.floor, (save[k] || 1) * (1 - r.cut));
      cut[k] = Math.round(((save[k] || 1) - to) * 1000) / 1000;
      save[k] = Math.round(to * 10000) / 10000;
    }
    const what = r.of.map((k) => WZ.of[k]).join('・');
    news(out, s, p, d + 1, 3 * 3600, 'lab', `${r.name}の研究に成功：MAGITAの${what}を${Math.round(r.cut * 100)}%削減`, { id: r.id, ok: true, cut }, 0, false);
  }
  // the list done: one more at a time
  if (s.wlab.list.every((r) => r.done)) {
    const n = ++s.wlab.n, N = WZ.next, k = Object.keys(WZ.of)[Math.floor(ch.u(`wazima:next:of:${n}`) * 3)];
    const months = N.months[0] + (N.months[1] - N.months[0]) * ch.u(`wazima:next:m:${n}`);
    const cut = Math.round((N.cut[0] + (N.cut[1] - N.cut[0]) * ch.u(`wazima:next:c:${n}`)) * 1000) / 1000;
    const name = `${N.names[(n - 1) % N.names.length]}「W-${n + WZ.research.length}」`;
    s.wlab.list.push({ id: 'W' + (n + WZ.research.length), name, of: [k], cut, chance: N.chance, start: d, due: d + Math.round(months * MONTH), done: 0, ok: null });
    s.wlab.list = s.wlab.list.slice(-12);
  }
}
// A child's day on its parent's books (連結): its sales to others (what its parent paid it, the joint development,
// left out) as the parent's sales, its costs of them as the parent's costs, its operating profit owed to the parent
// until the month is paid up (関係会社株式, as the equity method keeps it).
function consolidate(w, s, p, d) {
  const parent = w.co[p.parent];
  if (!parent) return;
  const pl = CORP.plOf(s.per.d), inside = s.per.d['r:codev'] || 0;
  const sales = Math.round(pl.sales - inside), op = Math.round(pl.op - inside);
  if (!sales && !op) return;
  post(parent, [['affil', op], ['r:wazima', -sales], ['c:wazima', sales - op]]);
  parent.pr = parent.pr || {};
  parent.pr.wazima = (parent.pr.wazima || 0) + sales / 30;
  (parent.pc || (parent.pc = {})).wazima = (parent.pc.wazima || 0) + (sales - op) / 30;
  const mk = CORP.monthKey(d);
  if (!s.mirror || s.mirror.m !== mk) s.mirror = { m: mk, op: 0, sales: 0 };
  s.mirror.op += op;
  s.mirror.sales += sales;
}
// At a month's end a child's month is its parent's: its profit paid up (子会社からの受取配当金), or its loss made good
// (子会社の損失負担); what its operating profit already brought the parent this month (consolidate) comes off the
// part of it the parent was owed, the rest (its non-operating part and its taxes) on the parent's non-operating
// lines. Its own retained earnings stay where they are.
function toParent(w, s, p, d) {
  const parent = w.co[p.parent];
  if (!parent) return;
  const net = Math.round(CORP.plOf(s.per.m).net), mk = CORP.monthKey(d);
  const opM = s.mirror && s.mirror.m === mk ? s.mirror.op : 0;
  if (!net && !opM) return;
  const rest = opM - net;
  post(parent, [['cash', net], ['affil', -opM], [rest < 0 ? 'nSubsidiary' : 'eSubsidiary', rest]], net >= 0 ? 'interestIn' : 'expenses');
  if (net > 0) post(s, [['retained', net], ['cash', -net]], 'dividends');
  else if (net < 0) post(s, [['cash', -net], ['retained', net]], 'support');
  if (w.ext && abroad(s) !== abroad(parent)) { if (abroad(s)) w.ext.exports += net; else w.ext.imports += net; }
  const days = CORP.monthEnd(d) - CORP.monthStart(d) + 1;
  parent.subAvg = Math.round((0.75 * (parent.subAvg || 0) + 0.25 * (net - opM) / days) * 100) / 100;
  s.toParent = { m: CORP.monthKey(d), net, all: ((s.toParent && s.toParent.all) || 0) + net };
}

/* ---------------------------------------------------------------- MY WAY --- */
// MY WAY's characters and licences (CORP.myway): their 流行 (heat), their 信用 (brand), the copies about (fakes), each
// partner's contract (its fee now, on or off, how its months went), the new characters, the ideas taken up; and the
// day it fails. Its people's measures come as decisions (decided: 'ip'), the partners' as theirs ('license').
const MW = CORP.myway;
function startIp(s, d) {
  s.ip = { heat: 1, brand: 1, fakes: MW.brand.fakes, lastNew: d, chars: [], ideas: { m: '', n: 0, all: 0, paid: 0 }, events: [], contracts: {}, seq: 0 };
  for (const [id, x] of Object.entries(MW.partners)) s.ip.contracts[id] = { fee: x.fee, base: x.fee, on: true, from: d, bad: 0, good: 0, m: { sales: 0, cost: 0, fee: 0 }, last: null, avg: 0 };
}
// MY WAY's state (null: not in this world), and a partner's contract that is on (null: none, or MY WAY gone)
export const ipOf = (w) => (w && w.co.myway && w.co.myway.ip) || null;
function contractOf(w, id) {
  const s = w.co.myway;
  if (!s || s.dead || !s.ip) return null;
  const c = s.ip.contracts[id];
  return c && c.on ? c : null;
}
// how much the characters pull now (what the partners sell of them goes with it)
const pullOf = (ip) => Math.max(0, ip.heat * ip.brand);
function ipEvent(s, d, kind, text, data = {}) {
  s.ip.events.push({ day: d, kind, text, ...data });
  if (s.ip.events.length > 40) s.ip.events.splice(0, s.ip.events.length - 40);
}
// The day's licences: each partner's fee (its cost, owed to MY WAY and paid within its terms; MY WAY's sale), and
// what it sold of the characters — to its customers outside before the country lives, or (once it does) what the
// people paid for them (their flows: its sale already, by its own day) — with their cost.
function licenseDay(w, d, flows) {
  const s = w.co.myway;
  if (!s || s.dead || !s.ip) return;
  const ip = s.ip, circ = !!w.ext;
  for (const [id, c] of Object.entries(ip.contracts)) {
    const t = w.co[id], x = MW.partners[id];
    if (!t || !x || t.dead) continue;
    let sold = 0;
    if (c.on) {
      const fee = take(t, 'mwfee', c.fee / YEAR);
      if (fee > 0) {
        post(t, [['sLicense', fee], ['ap', -fee]]);
        t.owe.myway = (t.owe.myway || 0) + fee;
        post(s, [['ar', fee], ['r:' + id, -fee]]);
        c.m.fee += fee;
      }
      if (!circ) {
        sold = take(t, 'mwsale', x.fee * x.lift * pullOf(ip) * econOf(w, PROFILES.get(id).beta) / YEAR);
        if (sold > 0) { post(t, [['ar', sold], ['r:myway', -sold]]); t.recv += sold; }
      }
    }
    // (the people's purchases of a contract that ended today still came: theirs, as sold)
    if (circ) sold = Math.round((flows.npc && flows.npc.co[id] && flows.npc.co[id].s && flows.npc.co[id].s.myway) || 0);
    const cost = take(t, 'mwcost', sold * x.cost);
    if (cost > 0) {
      post(t, [['c:myway', cost], ['ap', -cost]]);
      const to = circ ? '@sector' : '*';
      t.owe[to] = (t.owe[to] || 0) + cost;
    }
    c.m.sales += sold;
    c.m.cost += cost;
    c.avg = c.avg * 29 / 30 + sold / 30;
  }
}
// What the licences add to a day's expectations: a partner's fee and what it sells of the characters, MY WAY's fees
function ipExpect(w, s, p, d, add) {
  const ip = ipOf(w);
  if (!ip) return;
  if (s.id === 'myway') {
    if (s.dead) return;
    for (const [id, c] of Object.entries(ip.contracts)) if (c.on) add('r:' + id, c.fee / YEAR);
    return;
  }
  const c = contractOf(w, s.id), x = MW.partners[s.id];
  if (!c || !x) return;
  add('sLicense', c.fee / YEAR);
  const sales = w.ext || (w.circ && d >= w.circ.from) ? c.avg : x.fee * x.lift * pullOf(ip) * econOf(w, p.beta) / YEAR;
  add('r:myway', sales);
  add('c:myway', sales * x.cost);
}
// MY WAY's day: its characters' heat worn down (faster with no new character for a year), the copies about; from the
// launch on (the made-up past knew its characters as they were)
function ipDay(w, s, p, d) {
  const ip = s.ip;
  if (!ip || s.dead || d < w.launch) return;
  const H = MW.heat, since = Math.max(0, d - ip.lastNew) / YEAR;
  ip.heat = Math.max(H.min, ip.heat * Math.exp(-(H.fatigue + H.stale * Math.min(1, since)) / YEAR));
  // (信用 comes back by itself towards what the copies allow)
  const target = Math.max(0.1, 1 - MW.brand.fakeHurt * ip.fakes);
  ip.brand += (target - ip.brand) * MW.brand.back / 30;
  ip.brand = Math.max(0.02, Math.min(1, ip.brand));
}
// MY WAY's month (at its end): a new character out of its research (or not), the copies spreading (a flood now and
// then), a scandal or a cold spell now and then, the ideas taken up (by its people's review once the country lives:
// server/core/npc-org.js), each partner's month weighed (with nobody in the country to decide, a partner losing on it
// two months running gives it up, and one whose breakeven is well passed again comes back), and the obvious measures
// taken by itself when nobody is there to take them.
function ipMonth(w, s, p, d, ch, out) {
  const ip = s.ip;
  if (!ip || s.dead) return;
  // (the made-up past: each partner's month only)
  if (d < w.launch) {
    for (const c of Object.values(ip.contracts)) { c.last = { m: CORP.monthKey(d), sales: c.m.sales, cost: c.m.cost, fee: c.m.fee, margin: c.m.sales - c.m.cost - c.m.fee, on: c.on }; c.m = { sales: 0, cost: 0, fee: 0 }; }
    return;
  }
  const live = !!(w.circ && d >= w.circ.from);
  const R = (k) => ch.u(`myway:${k}:${d}`);
  // a new character, as often as the research budget allows, more of them the better the people's mood
  const C = MW.chars, rd = Math.max(0.1, (s.budget.rd || 0) / Math.max(1, p.rd.amount * sizeScale(w, p)));
  if (R('char') < C.perYear / 12 * Math.sqrt(rd) * (0.6 + 0.7 * s.morale)) newCharacter(w, s, p, d, ch, out, 'research');
  // the copies
  const B = MW.brand;
  ip.fakes = Math.min(1, ip.fakes + B.fakeGrow * (0.5 + R('fakes')));
  if (R('flood') < B.flood) {
    const by = B.floodBy[0] + (B.floodBy[1] - B.floodBy[0]) * R('floodBy');
    ip.fakes = Math.min(1, ip.fakes + by);
    ip.brand = Math.max(0.02, ip.brand - by * 0.5);
    ipEvent(s, d, 'fakes', `精巧な違法コピー品が大量に出回っています（コピー品 ${Math.round(ip.fakes * 100)}%）`);
    news(out, s, p, d + 1, 2 * 3600, 'ip', `精巧な違法コピー品が市場に氾濫（ブランドの信用が低下）`, { fakes: ip.fakes }, -0.06, true);
  }
  if (R('scandal') < B.scandal) {
    const by = B.scandalBy[0] + (B.scandalBy[1] - B.scandalBy[0]) * R('scandalBy');
    ip.brand = Math.max(0.02, ip.brand - by);
    ipEvent(s, d, 'scandal', `スキャンダルで「持つと恥ずかしい」の声（信用 −${Math.round(by * 100)}%）`);
    news(out, s, p, d + 1, 3 * 3600, 'ip', `キャラクターをめぐるスキャンダルが拡散、「持つと恥ずかしい」との声も`, { brand: ip.brand }, -0.12, true);
  }
  if (R('chill') < MW.heat.chill) {
    const by = MW.heat.chillBy[0] + (MW.heat.chillBy[1] - MW.heat.chillBy[0]) * R('chillBy');
    ip.heat = Math.max(MW.heat.min, ip.heat * by);
    ipEvent(s, d, 'chill', `流行が冷え込み、マンネリ化で飽きられ始めています（流行 ×${by.toFixed(2)}）`);
    news(out, s, p, d + 1, 3 * 3600, 'ip', `キャラクター人気に陰り：流行の冷え込み`, { heat: ip.heat }, -0.1, true);
  }
  // the ideas taken up (with nobody in the country to review them, about as many as its people would have)
  const mk = CORP.monthKey(d);
  if (!live) {
    const n = Math.round(s.n * MW.ideaRate * (0.6 + 0.7 * s.morale) * (0.8 + 0.4 * R('ideas')));
    if (n > 0) ideasPaid(w, s, n, null);
  }
  ip.ideas.last = { m: mk, n: ip.ideas.m === mk ? ip.ideas.n : 0 };
  ip.ideas.m = '';
  ip.ideas.n = 0;
  // each partner's month
  for (const [id, c] of Object.entries(ip.contracts)) {
    const x = MW.partners[id], t = w.co[id];
    if (!x || !t) continue;
    const margin = c.m.sales - c.m.cost - c.m.fee;
    c.last = { m: mk, sales: c.m.sales, cost: c.m.cost, fee: c.m.fee, margin, on: c.on };
    c.m = { sales: 0, cost: 0, fee: 0 };
    if (live) continue;
    const pull = pullOf(ip), be = CORP.breakeven(id, c.fee);
    if (c.on) {
      c.bad = margin < 0 ? c.bad + 1 : 0;
      if (c.bad >= MW.badMonths) license(w, id, 'cancel', d, out, ch, '採算割れが続いたため');
    } else {
      c.good = pull >= be * MW.again ? c.good + 1 : 0;
      if (c.good >= MW.badMonths) license(w, id, 'sign', d, out, ch, 'キャラクター人気の回復を受けて');
    }
  }
  if (!live) autoMeasures(w, s, p, d, ch, out);
}
// a new character out (`why`: its research, or a push its people decided): it catches on (heat up) or flops
function newCharacter(w, s, p, d, ch, out, why, lift = null) {
  const ip = s.ip, C = MW.chars, n = ++ip.seq;
  const name = C.names[(n - 1) % C.names.length] + (n > C.names.length ? Math.ceil(n / C.names.length) : '');
  const hit = ch.u(`myway:hit:${n}`) >= C.flop;
  const range = lift || C.lift, by = hit ? range[0] + (range[1] - range[0]) * ch.u(`myway:lift:${n}`) : 0.01;
  ip.heat = Math.min(MW.heat.max, ip.heat + by);
  ip.lastNew = d;
  ip.chars.push({ day: d, name, hit, by: Math.round(by * 1000) / 1000, why });
  if (ip.chars.length > 24) ip.chars.splice(0, ip.chars.length - 24);
  ipEvent(s, d, 'char', `新キャラクター「${name}」${hit ? 'が大ヒット' : 'は不発'}（流行 ${hit ? '+' : ''}${Math.round(by * 100)}%）`);
  news(out, s, p, d + 1, 2 * 3600, 'char', hit ? `新キャラクター「${name}」が発表と同時に大ヒット` : `新キャラクター「${name}」を発表（反応は今ひとつ）`, { name, hit }, hit ? 0.03 + by * 0.3 : -0.02, true);
}
// `n` ideas taken up this month, $500K each: to whoever had them (`people`: the people's indexes, once the country
// lives: its review's), else to its people in all
function ideasPaid(w, s, n, people) {
  const each = MW.idea, all = n * each, ip = s.ip;
  if (!people) {
    post(s, [['sIdea', all], ['cash', -all]], 'payroll');
    if (w.ext) w.ext.pay.push({ company: s.id, n: all, kind: 'bonus' });
  }
  ip.ideas.m = CORP.monthKey(w.day + 1);
  ip.ideas.n += n;
  ip.ideas.all += n;
  ip.ideas.paid = (ip.ideas.paid || 0) + all;
  ip.heat = Math.min(MW.heat.max, ip.heat + n * MW.ideaHeat);
}
// A partner's contract signed again or given up (its people's decision, or by itself with nobody to decide); a listed
// partner's shares jump the day it signs (投資熱), and fall a little the day it leaves; MY WAY's the other way.
function license(w, id, action, d, out, ch, why = '', fee = null) {
  const s = w.co.myway, c = s && s.ip && s.ip.contracts[id], t = w.co[id];
  if (!c || !t || s.dead) return;
  const p = PROFILES.get('myway'), tp = PROFILES.get(id);
  if (action === 'cancel' && c.on) {
    c.on = false;
    c.bad = 0;
    c.good = 0;
    c.until = d;
    ipEvent(s, d, 'cancel', `${tp.name}が契約を打ち切り${why ? '（' + why + '）' : ''}`, { partner: id });
    news(out, s, p, d + 1, 4 * 3600, 'license', `${tp.name}がMY WAYとのIP契約を打ち切り${why ? '（' + why + '）' : ''}`, { partner: id }, -0.08, true);
    news(out, t, tp, d + 1, 4 * 3600, 'license', `MY WAYとのIP契約を終了（${MW.partners[id].what}）`, { partner: 'myway' }, -0.02, true);
  } else if (action === 'sign' && !c.on) {
    c.on = true;
    c.bad = 0;
    c.good = 0;
    c.from = d;
    if (fee) c.fee = fee;
    const jump = Math.log(1 + MW.hype[0] + (MW.hype[1] - MW.hype[0]) * ch.u(`myway:hype:${id}:${d}`));
    ipEvent(s, d, 'sign', `${tp.name}と契約（年${CORP.fmt.money(c.fee)}）${why ? '・' + why : ''}`, { partner: id });
    news(out, s, p, d + 1, 4 * 3600, 'license', `${tp.name}とIP契約を締結（${MW.partners[id].what}・年${CORP.fmt.money(c.fee)}）`, { partner: id }, 0.04, true);
    news(out, t, tp, d + 1, 4 * 3600, 'license', `MY WAYの審査を通過しコラボ契約を締結：発表と同時に買いが殺到`, { partner: 'myway' }, jump, true);
  }
}
// the fee of a partner's contract changed (its talks): within the band of the fee it began at
function feeTo(w, id, mult, d, out) {
  const s = w.co.myway, c = s && s.ip && s.ip.contracts[id];
  if (!c || s.dead) return;
  const T = MW.talks, was = c.fee;
  c.fee = Math.round(Math.max(c.base * T.floor, Math.min(c.base * T.cap, c.fee * Math.max(1 - T.step, Math.min(1 + T.step, mult)))) / 1e6) * 1e6;
  if (c.fee === was) return;
  ipEvent(s, d, 'fee', `${PROFILES.get(id).name}の契約料 ${CORP.fmt.money(was)}→${CORP.fmt.money(c.fee)}（年）`, { partner: id });
}
// with nobody in the country to decide: a new character when the heat is low, the copies fought when they spread, a
// campaign when the name is hurt (each once a quarter at most, and only with the money for it)
function autoMeasures(w, s, p, d, ch, out) {
  const ip = s.ip, monthly = monthlyCosts(s), free = (s.bal.cash || 0) - monthly * 2;
  if (CORP.ymd(d).m % 3 !== 0) return;
  if (ip.heat < 0.75 && free > MW.newChar.cost) measure(w, s, { action: 'newchar' }, d, ch, out);
  if (ip.fakes > 0.3 && free > MW.legal.cost) measure(w, s, { action: 'legal' }, d, ch, out);
  if (ip.brand < 0.7 && free > MW.pr.cost) measure(w, s, { action: 'pr' }, d, ch, out);
}
// One of MY WAY's measures (its people's decision, server/core/npc-org.js, or its own: autoMeasures). Their costs are
// paid now (the local businesses', the studio's and the lawyers' work).
function measure(w, s, o, d, ch, out) {
  if (!s || s.dead || !s.ip) return;
  const ip = s.ip, p = PROFILES.get('myway'), pay = (n) => { if (n > 0) { post(s, [['sMeasure', n], ['cash', -n]], 'expenses'); if (w.ext) w.ext.sector += n; } };
  const u = (k) => ch.u(`myway:${o.action}:${k}:${d}:${ip.seq}:${Math.round(ip.heat * 1000)}`);
  if (o.action === 'newchar') {
    const N = MW.newChar;
    pay(N.cost);
    if (u('ok') < N.chance) newCharacter(w, s, p, d, ch, out, 'push', N.lift);
    else { ip.lastNew = d; ipEvent(s, d, 'char', '新キャラクターを緊急投入したが話題にならず'); }
  } else if (o.action === 'legal') {
    const L = MW.legal;
    pay(L.cost);
    ip.fakes = Math.max(0, ip.fakes * (1 - L.cut));
    ip.brand = Math.min(1, ip.brand + L.brand);
    ipEvent(s, d, 'legal', `違法コピー品を一斉摘発・国際訴訟（コピー品 ${Math.round(ip.fakes * 100)}%）`);
    news(out, s, p, d + 1, 3 * 3600, 'ip', '違法コピー品の一斉摘発と国際訴訟に踏み切る', {}, 0.02, true);
  } else if (o.action === 'pr') {
    const R = MW.pr, by = R.brand[0] + (R.brand[1] - R.brand[0]) * u('by');
    pay(R.cost);
    ip.brand = Math.min(1, ip.brand + by);
    ipEvent(s, d, 'pr', `ブランド回復キャンペーン・謝罪会見（信用 +${Math.round(by * 100)}%）`);
    news(out, s, p, d + 1, 3 * 3600, 'ip', 'ブランドの信用回復へ：会見とキャンペーンを実施', {}, 0.02, true);
  } else if (o.action === 'care') {
    // (the costs of caring for its people, never their pay: what it spends a head beyond the pay, down a tenth, never
    // under half of what it was)
    const C = MW.care, extra = s.unit - s.pay, floor = (p.cost - p.salary) * C.floor;
    const to = Math.max(Math.min(extra, floor), Math.round(extra * (1 - C.cut)));
    if (to < extra) {
      s.careCut = (s.careCut || 0) + (extra - to);
      s.unit = s.pay + to;
      s.morale = Math.max(0.2, s.morale - 0.03);
      ipEvent(s, d, 'care', `社員管理・福利厚生費を1人あたり${CORP.fmt.money(extra - to)}削減（基本給と月次ボーナスは減額できません）`);
    }
  } else if (o.action === 'retire') {
    // (a voluntary retirement: some of its people leave with months of pay; once the country lives they go by its
    // own leaving, server/core/npc-labor.js dismiss)
    const R = MW.retire, n = Math.max(1, Math.round(s.n * R.share)), each = Math.round(s.pay / 12 * R.severance);
    if (w.ext || (w.circ && d >= w.circ.from)) s.cut = { n, day: d + 1, each };
    else { s.n -= n; post(s, [['sSeverance', n * each], ['cash', -n * each]], 'payroll'); }
    s.target = Math.max(1, s.n - (s.cut ? n : 0));
    ipEvent(s, d, 'retire', `希望退職を募集（${CORP.fmt.group(n)}人・退職金 1人${CORP.fmt.money(each)}）`);
    news(out, s, p, d + 1, 3 * 3600, 'staff', `希望退職${CORP.fmt.group(n)}人を募集（固定費の削減）`, { n }, 0.01, true);
  } else if (o.action === 'win' && o.partner) {
    // (the fee offered lower to a partner that left: it may come back when the characters pull enough for it)
    const c = ip.contracts[o.partner];
    if (c && !c.on) {
      c.fee = Math.round(Math.max(c.base * MW.talks.floor, c.fee * (1 - MW.win.off)) / 1e6) * 1e6;
      c.offered = d;
      ipEvent(s, d, 'fee', `${PROFILES.get(o.partner).name}に契約料${CORP.fmt.money(c.fee)}で再契約を提案`, { partner: o.partner });
    }
  } else if (o.action === 'fee' && o.partner) feeTo(w, o.partner, o.mult, d, out);
  else if (o.action === 'ideas') ideasPaid(w, s, o.n, o.people || []);
}
// MY WAY fails (倒産): out of money with nothing more Tenesice will lend. What it is owed comes in; its bonds are sold;
// what it has pays its people what is owed them, then its bills and its taxes, then the bank; the bank loses what is
// left of its loans (its 与信関係費用), MY WAY's books keep the rest as a gain on the debt forgiven; what it had besides
// (its buildings, its stock) is written off. Its contracts end, its people are let go (once the country lives: its
// people's side lets them go), its shares are struck off (上場廃止): worth nothing from then on.
function bankrupt(w, s, p, d, out, why) {
  const x = w.ext;
  // what the partners owed it, paid at once (the trustee's first work)
  for (const [id, t] of Object.entries(w.co)) {
    const n = (t.owe && t.owe.myway) || 0;
    if (!n || id === s.id) continue;
    t.owe.myway = 0;
    post(t, [['ap', n], ['cash', -n]], 'purchases');
    received(s, n);
  }
  if (s.recv > 0) { const n = s.recv; s.recv = 0; post(s, [['cash', n], ['ar', -n]], 'receipts'); if (x) x.exports += n; }
  const bonds = s.bal.bonds || 0;
  if (bonds) { post(s, [['cash', bonds], ['bonds', -bonds]], 'bondsSell'); if (x) x.bonds.push({ company: s.id, n: -bonds }); }
  const cash = () => Math.max(0, s.bal.cash || 0);
  // the people first: their pay owed
  const accrued = Math.min(s.bal.accrued || 0, cash());
  if (accrued > 0) { post(s, [['accrued', accrued], ['cash', -accrued]], 'payroll'); if (x) x.pay.push({ company: s.id, n: accrued, kind: 'salary' }); }
  const bonus = Math.min(s.bal.bonus || 0, cash());
  if (bonus > 0) { post(s, [['bonus', bonus], ['cash', -bonus]], 'payroll'); if (x) x.pay.push({ company: s.id, n: bonus, kind: 'bonus' }); }
  // then its bills (to the companies, to the local businesses) and its running costs
  for (const [to, owed] of Object.entries(s.owe)) {
    const n = Math.min(owed, cash());
    if (n <= 0) continue;
    s.owe[to] = owed - n;
    post(s, [['ap', n], ['cash', -n]], 'purchases');
    if (to !== '*' && to !== '@sector' && w.co[to]) received(w.co[to], n);
    else if (x) { if (to === '@sector') x.sector += n; else x.imports += n; }
  }
  if (s.exp) {
    const n = Math.min(s.exp, cash());
    if (n > 0) { post(s, [['ap', n], ['cash', -n]], 'expenses'); if (x) x.sector += n; }
    s.exp = 0;
  }
  const tax = Math.min(s.bal.taxdue || 0, cash());
  if (tax > 0) { post(s, [['taxdue', tax], ['cash', -tax]], 'taxes'); if (x) x.taxes.push({ company: s.id, n: tax }); }
  // then the bank
  const debt = debtOf(s), repay = Math.min(debt, cash()), loss = debt - repay;
  if (repay > 0) post(s, [['loan', repay], ['cash', -repay]], 'repay');
  if (loss > 0) post(s, [['loan', loss], ['xRelief', -loss]]);
  s.loans = [];
  w.creditLoss = (w.creditLoss || 0) + loss;
  // what is left of what it owes besides is forgiven; what it had besides is written off
  const rest = (s.bal.ap || 0) + (s.bal.accrued || 0) + (s.bal.bonus || 0) + (s.bal.taxdue || 0);
  const lines = [];
  for (const k of ['ap', 'accrued', 'bonus', 'taxdue']) if (s.bal[k]) lines.push([k, s.bal[k]]);
  if (rest) { lines.push(['xRelief', -rest]); post(s, lines); }
  s.owe = {};
  const assets = ['ar', 'stock', 'wip', 'ppe', 'content', 'affil', 'lent'].filter((k) => s.bal[k]);
  const gone = assets.reduce((n, k) => n + s.bal[k], 0);
  if (gone) post(s, [['xBankrupt', gone], ...assets.map((k) => [k, -s.bal[k]])]);
  for (const c of Object.values(s.ip ? s.ip.contracts : {})) { if (c.on) c.until = d; c.on = false; }
  s.dead = { day: d, why, debt, repaid: repay, loss, staff: s.n };
  s.n = 0;
  s.target = 0;
  for (const k of Object.keys(s.budget)) s.budget[k] = 0;
  s.div = { dps: 0, daily: 0, total: 0 };
  s.pend = [];
  s.cut = null;
  if (s.ip) ipEvent(s, d, 'bankrupt', `倒産（負債 ${CORP.fmt.money(debt)}・テネシスの損失 ${CORP.fmt.money(loss)}）：${why}`);
  news(out, s, p, d + 1, 2 * 3600, 'bankrupt', `倒産：${why}。全契約を終了し、社員${CORP.fmt.group(s.dead.staff)}人は解雇、株式は上場廃止に（負債 ${CORP.fmt.money(debt)}）`, { debt, loss }, -3, true);
  if (x) (x.bankrupt || (x.bankrupt = [])).push(s.id);
  (out.bankrupt || (out.bankrupt = [])).push(s.id);
}

/* ---------------------------------------------------------------- the day --- */
// The world's day `d`, closed at its end: every company's operations in ORDER, then what passes between them,
// then the bank's books following everyone's money, then the periods that end, and the next day's announcements,
// guidance and the market's view. `flows`: the players' money of the day ({ company: { kind: $ }, job: $ }).
export function closeDay(w, d, flows, ch) {
  const out = { days: [], periods: [], titles: [], news: [], jumps: [], anchors: [] };
  w.b2b = [];
  w.paid = [];
  w.bank = { got: 0, paid: 0 };
  w.mon = w.mon || {};
  // the economy moves at each month's start (its made-up past bridged so that it is at its middle at the launch,
  // what it was off by there fading after as the economy's own moves do)
  if (CORP.ymd(d).d === 1) {
    const e = w.econ;
    e.raw = (e.raw || 0) * ECON_KEEP + CORP.economy.sd * ch.z(`economy:${d}`);
    // (好景気 is everyone getting richer: once live, the players' and the people's money against a month before moves it)
    if (flows.wealth > 0 && d >= w.launch) {
      if (e.w0 > 0) e.raw += WEALTH_PULL * Math.max(-0.15, Math.min(0.15, Math.log(flows.wealth / e.w0)));
      e.w0 = flows.wealth;
    }
    e.fade = d < w.launch ? Math.min(1, (d - w.start) / Math.max(1, (e.last || d) - w.start)) : (e.fade || 0) * ECON_KEEP;
    e.x = e.raw - (e.bridge || 0) * e.fade;
  }
  const live = d >= w.launch;
  // the country's money (once it lives): what goes out to it, gathered for the people's side; the companies' people
  // as many as the country has working for them, at their pay; the raises their unions settled
  const circ = circOn(w, d), npc = (circ && flows.npc) || null;
  w.ext = circ ? { pay: [], welfare: [], taxes: [], dividends: [], sector: 0, imports: 0, exports: 0, fromSector: 0, bonds: [], bondInterest: 0, depositInterest: 0, toPeople: [] } : null;
  w.b2bCash = [];
  if (npc && npc.staff) for (const [id, st] of Object.entries(npc.staff)) {
    const s = w.co[id], p = PROFILES.get(id);
    if (!s || !p) continue;
    s.n = st.n;
    if (st.pay > 0) { s.pay = Math.round(st.pay); s.unit = Math.round(st.pay * p.cost / p.salary); }
  }
  if (npc && npc.raises) w.raises = npc.raises;
  if (npc && npc.terms) w.terms = npc.terms;
  if (npc && npc.lend) w.lend = npc.lend;
  // what each company's people decided in their meetings (server/core/npc-org.js): their budgets, their hiring, their
  // mood, their research
  if (npc && npc.ops) for (const o of npc.ops) decided(w, o, d, out, ch);
  // (every company's day begun before any posts to another's: a studio's dividends to its backer, a day's trade)
  for (const id of ORDER) { w.co[id].today = 0; w.co[id].per.d = {}; }
  for (const id of ORDER) {
    const s = w.co[id], p = PROFILES.get(id);
    // (a company that failed: its books are closed, nothing more happens to it — what the country still sent it, its
    // public works and the like, the local businesses take instead)
    if (s.dead) {
      s.npcDay = 0;
      const c = npc && npc.co[id];
      if (c && w.ext) {
        let n = (c.cat || 0) + Math.max(0, c.cas || 0) - (c.buyback || 0);
        for (const v of Object.values(c.s || {})) n += v;
        for (const k of Object.values(c.p || {})) for (const v of Object.values(k)) n += v[1];
        for (const v of Object.values(c.t || {})) n += v[1];
        for (const v of Object.values(c.l || {})) n += v;
        if (n) w.ext.sector += Math.round(n);
      }
      continue;
    }
    // (what came in on an average day of late, by stream: the country's money is all of it now)
    if (circ) { s.pr = s.pr || {}; for (const k of Object.keys(s.pr)) s.pr[k] *= 29 / 30; }
    if (!live) { people(s, p, d, w.launch); budgets(s, p, d, w.launch); }
    if (s.ip) ipDay(w, s, p, d);
    if (p.model === 'studio') studioDay(w, s, p, d, ch, out, flows);
    else if (p.model === 'bank') bankDay(w, s, p, d, ch, flows);
    else {
      if (p.id === 'magita' && live) { s.launchDay = s.launchDay || w.launch; labDay(w, s, p, d, ch, out); }
      // (WAZIMA's research for its parent)
      if (p.parent && live) wazimaLab(w, s, p, d, ch, out);
      tradeDay(w, s, p, d, flows, ch);
      if (p.materials) supply(w, s, p);
    }
    // (what the people spent here today)
    s.npcDay = npc ? peopleSpent(npc.co[id], id === 'tenesice' ? npc.bank : null) : 0;
    interest(w, s, p);
    dividends(w, s, p, d);
  }
  // the game's own businesses (YOSIDA's quests, gacha and trees, DAIZIN's buying back) and the treasury's part
  gameDay(w, d, flows);
  // MY WAY's licences: the partners' fees and what they sold of its characters; the measures its people decided
  licenseDay(w, d, flows);
  for (const o of (w.ipOps || []).splice(0)) measure(w, w.co[o.company], o, d, ch, out);
  delete w.ipOps;
  // what the companies' people decided to pay for (a placement fee, a severance, a new business's costs)
  if (npc && npc.charges) for (const c of npc.charges) charge(w, c);
  for (const id of ORDER) {
    const s = w.co[id], p = PROFILES.get(id);
    if (s.dead) continue;
    settle(w, s, p, d);
    for (const x of w.paid.splice(0)) {
      received(w.co[x.to], x.n);
      // (paid to a company abroad: money out of the country)
      if (w.ext && abroad(w.co[x.to]) && !abroad(s)) w.ext.imports += x.n;
    }
    payTaxes(w, s, p, d);
    backing(w, s, p, d, ch, out);
    month(w, s, p, d, ch, out);
    if (CORP.ymd(d).d === 1 && d >= w.launch) tech(w, s, p, d, ch, out);
    if (p.model === 'studio') titlesLook(w, s, p, d, out);
    if (CORP.isMonthEnd(d)) treasury(w, s, p, d, out);
    // (MY WAY out of money at a month's end with nothing more Tenesice will lend: it fails)
    if (s.ip && CORP.isMonthEnd(d) && d >= w.launch && (s.bal.cash || 0) < 0) bankrupt(w, s, p, d, out, '資金繰りに行き詰まり、テネシスからの追加融資も受けられず');
  }
  // what one company paid another for its services (MAGITA's facilities, Dtrade's data centres, the job sites'
  // advertising and placements, ジンクス's game shelves): each a sale of the one paid
  for (const b of w.b2bCash.splice(0)) {
    const s = w.co[b.to];
    if (!s || s.dead) { if (w.ext) w.ext.sector += b.n; continue; }
    cashSale(s, b.stream, b.n);
    s.pr[b.stream] = (s.pr[b.stream] || 0) + b.n / 30;
    // (what it took to make what was sold: its materials, bought outside — MAGITA's cars for YOSIDA's gacha)
    if (b.cost > 0) { post(s, [['c:materials', b.cost], ['ap', -b.cost]]); s.owe['*'] = (s.owe['*'] || 0) + b.cost; }
    if (b.item) {
      const row = s.sold[b.item.id] || (s.sold[b.item.id] = { npc: 0, players: 0, sales: 0, margin: 0 });
      row.players += b.item.n;
      row.sales += b.n;
      row.margin += b.n - (b.cost || 0);
    }
    // (between the country and a company abroad: money coming in, or going out)
    if (w.ext && b.from && w.co[b.from]) {
      const fa = abroad(w.co[b.from]), ta = abroad(s);
      if (fa && !ta) w.ext.exports += b.n;
      else if (!fa && ta) w.ext.imports += b.n;
    }
  }
  // the maker's rebates at a quarter's end, and the month's moves of the ties
  if (CORP.isQuarterEnd(d)) for (const id of ORDER) if (PROFILES.get(id).materials) rebates(w, w.co[id], PROFILES.get(id), d, out);
  if (CORP.isMonthEnd(d)) moveTies(w, d, ch, out);
  // the bank: the interest it was paid and paid, and every company's money and loans as its deposits and loans (once
  // the country lives, the people's and the country's too: what the people never paid back is a loss, not money in)
  const bank = w.co.tenesice;
  if (bank) {
    const net = w.bank.got - w.bank.paid;
    if (net) post(bank, [['cash', net], ['r:nii', -net]], 'receipts');
    let cash = npc ? Math.round(npc.bank.deposits || 0) : 0, lent = npc ? Math.round(npc.bank.loans || 0) : 0;
    for (const id of ORDER) if (id !== 'tenesice' && !(npc && abroad(w.co[id]))) { cash += w.co[id].bal.cash || 0; lent += debtOf(w.co[id]); }
    // (and what a company that failed never paid back: MY WAY's, its 与信関係費用)
    const failed = Math.round(w.creditLoss || 0);
    w.creditLoss = 0;
    if (failed > 0) post(bank, [['sCredit', failed], ['lent', -failed]]);
    const lost = (npc ? Math.round(npc.bank.credit || 0) : 0) + failed;
    const dc = cash - (bank.inGame || { cash }).cash, dl = lent - (bank.inGame || { lent }).lent + lost;
    if (bank.inGame) {
      if (dc) post(bank, [['cash', dc], ['deposits', -dc]], 'deposits');
      if (dl) post(bank, [['lent', dl], ['cash', -dl]], 'lending');
    }
    bank.inGame = { cash, lent };
  }
  // the day closes: its profit into the retained earnings, the share-days counted
  for (const id of ORDER) {
    const s = w.co[id], p = PROFILES.get(id);
    // (the month's end: MAGITA sets next month's garage fee; the quarter's: who goes and who is hired)
    if (CORP.isMonthEnd(d) && id === 'magita' && d >= w.launch) garageFee(w, s, p, d, out);
    // (and YOSIDA its fee on the quests' rewards and, with DAIZIN, the VIP1週間券's price)
    if (CORP.isMonthEnd(d) && id === 'yosida' && d >= w.launch) { questFeeSet(w, s, p, d, out, ch); vipWeekSet(w, s, p, d, out, ch); }
    // (MY WAY's month: its characters, its partners)
    if (CORP.isMonthEnd(d) && s.ip && !s.dead) ipMonth(w, s, p, d, ch, out);
    // (MY WAY keeps its people whatever its year: what it cannot cut is its trouble — its own measures aside)
    if (CORP.isQuarterEnd(d) && d >= w.launch && !s.dead && !s.ip) staffing(w, s, p, d, out);
    if (CORP.isQuarterEnd(d) && !s.dead) {
      if (p.model === 'studio') impair(s, p, d);
      // the backer's part of its studio's quarter (持分法)
      for (const [held, shares] of Object.entries(s.hold.own || {})) {
        const t = w.co[held];
        let part = Math.round((t.qNet || 0) * shares / Math.max(1e-9, outstanding(t)));
        // (a loss takes the investment to nothing at most: 持分法's losses stop there)
        if (part < 0) part = -Math.min(-part, Math.max(0, s.bal.affil || 0));
        if (part > 0) post(s, [['affil', part], ['nEquity', -part]]);
        else if (part < 0) post(s, [['eEquity', -part], ['affil', part]]);
      }
      taxes(w, s, p, d, CORP.isFyEnd(d));
    }
    // (a child's day and month: its parent's — WAZIMA's, MAGITA's, which closes after it)
    if (p.parent) consolidate(w, s, p, d);
    // (and, its month's profit paid up after its cash was seen to, that seen to again: else it ran the month below
    // nothing — WAZIMA paying MAGITA more than it kept)
    if (CORP.isMonthEnd(d) && p.parent) { toParent(w, s, p, d); treasury(w, s, p, d, out); }
    s.bal.retained += s.today;
    for (const k of ['m', 'q', 'y']) s.sd[k] += outstanding(s);
    if (CORP.isQuarterEnd(d)) s.qNet = CORP.plOf(s.per.q).net;
    out.days.push(dayRow(w, s, p, d));
    closePeriods(w, s, p, d, out, ch);
    check(s, d);
  }
  // the next day: announcements due, the guidance, the dividends, the market's view
  for (const id of ORDER) announce(w, w.co[id], PROFILES.get(id), d, out, ch);
  w.day = d;
  if (w.ext) out.ext = w.ext;
  delete w.ext;
  delete w.b2bCash;
  delete w.b2b;
  delete w.paid;
  delete w.bank;
  return out;
}
function decided(w, o, d, out, ch) {
  const s = w.co[o.company];
  if (!s || s.dead) return;
  // (MY WAY's measures, taken once its day is under way: what they cost is that day's; a partner's contract signed
  // again or given up)
  if (o.kind === 'ip') { (w.ipOps || (w.ipOps = [])).push(o); return; }
  if (o.kind === 'license') return license(w, o.company, o.action, d, out, ch, o.why || '', o.fee || null);
  if (o.kind === 'budget' && s.budget[o.key] !== undefined) s.budget[o.key] = Math.max(0, Math.round(s.budget[o.key] * o.mult));
  else if (o.kind === 'target') s.target = Math.max(1, Math.round((s.target || s.n) * o.mult));
  else if (o.kind === 'morale') s.morale = Math.max(0.2, Math.min(0.95, s.morale + o.add));
  else if (o.kind === 'lab' && s.lab) s.lab.mult *= 1 - o.cut;
}
// one payment the companies' people decided (a company's to another company, to a person, or to the local businesses)
const CHARGE_ACCOUNT = { placement: 'sRecruit', severance: 'sSeverance', ventureLaunch: 'sVenture', ventureCost: 'sVenture', idea: 'sIdea' };
function charge(w, c) {
  const s = w.co[c.from], n = Math.round(c.n);
  // (nothing from a company that has failed)
  if (!s || s.dead || !(n > 0)) return;
  post(s, [[CHARGE_ACCOUNT[c.stream] || 'sOther', n], ['cash', -n]], 'expenses');
  if (c.to && w.co[c.to] && !w.co[c.to].dead && c.to !== c.from) w.b2bCash.push({ to: c.to, stream: c.stream, n, from: c.from });
  else if (c.person >= 0) w.ext.toPeople.push({ i: c.person, n });
  else w.ext.sector += n;
}
// (assets are always liabilities and equity: a day that would break it is a fault of the model)
function check(s, d) {
  const gap = assetsOf(s) - liabilitiesOf(s) - equityOf(s);
  if (gap !== 0) throw new Error(`corp ${s.id}: the books do not balance on day ${d} by ${gap}`);
}
function dayRow(w, s, p, d) {
  const pl = CORP.plOf(Object.fromEntries(Object.entries(s.per.d).filter(([k]) => !/^cf:/.test(k))));
  return { company: s.id, day: d, sales: Math.round(pl.sales), op: Math.round(pl.op), net: Math.round(pl.net), cash: s.bal.cash || 0, bonds: s.bal.bonds || 0, debt: debtOf(s),
    equity: equityOf(s), staff: s.n, fair: s.mkt ? Math.round(s.mkt.fair) : 0, econ: Math.round(Math.exp(w.econ.x) * 1000) / 1000, players: s.players || 0, npc: s.npcDay || 0 };
}

// The announcements of the next day (決算発表 two weeks after the quarter: the results, against the same quarter a
// year before and against what the guidance expected; with the fourth, the new year's guidance; with the others, a
// revision when the year is far from it), and the market's view for the next day.
function announce(w, s, p, d, out, ch) {
  const next = d + 1;
  // (a company that failed: struck off, worth nothing — its price's centre at $1 from the day after)
  if (s.dead) {
    s.mkt = { e: 0, fair: 1 };
    if (p.listed) out.anchors.push({ company: s.id, day: next, e0: 0, e1: 0, ev: out.jumps.filter((j) => j.company === s.id && j.day === next).map((j) => [j.at, j.jump]), dps: 0 });
    return;
  }
  const due = s.pend.filter((x) => x.day === next);
  s.pend = s.pend.filter((x) => x.day !== next);
  const at = CORP.announce.hour * 3600;
  for (const x of due) {
    if (x.kind !== 'results') continue;
    const yoy = x.prev && x.prev.sales ? ` (前年同期比${CORP.fmt.pct(x.pl.sales / x.prev.sales - 1)})` : '';
    const surprise = x.expected !== null && x.expected !== undefined ? (x.pl.op - x.expected) / Math.max(1, Math.abs(s.guide ? s.guide.op : x.expected * 4) / 4) : 0;
    news(out, s, p, next, at, 'results', `${CORP.quarterLabel(CORP.quarterEnd(x.fy, x.q))}決算：売上高${CORP.fmt.money(x.pl.sales)}${yoy}、営業利益${CORP.fmt.money(x.pl.op)}、純利益${CORP.fmt.money(x.pl.net)}`,
      { key: x.key, surprise }, 0.06 * Math.max(-4, Math.min(4, surprise)), true);
    const fy = CORP.fyOf(next);
    if (x.q === 4) {
      // the new year's guidance (planned on its first day) and its dividends
      const g = s.plan || guidance(w, s, p, next, forecast(w, s, p, next));
      s.guide = g;
      s.plan = null;
      setDividend(s, p, g);
      // (the made-up past's shares are not counted yet: its news says nothing a share)
      const dps = next >= w.launch ? `、年間配当1株$${CORP.fmt.group(g.dps)}` : '';
      news(out, s, p, next, at + 60, 'guidance', `${fy}年度の業績予想：売上高${CORP.fmt.money(g.sales)}、営業利益${CORP.fmt.money(g.op)}、純利益${CORP.fmt.money(g.net)}${dps}`, { fy }, 0, true);
    } else if (s.guide && s.guide.fy === fy) {
      const f = forecast(w, s, p, next), g = s.guide;
      const off = Math.abs(f.sales / Math.max(1, g.sales) - 1) >= 0.1 || (Math.abs(f.net - g.net) >= 0.3 * Math.abs(g.net) && Math.abs(f.net - g.net) > 0.01 * equityOf(s));
      if (off) {
        const ng = guidance(w, s, p, next, f);
        const up = ng.net > g.net;
        const move = Math.max(-0.5, Math.min(0.5, (ng.net - g.net) / Math.max(1, Math.abs(g.net))));
        news(out, s, p, next, at + 60, 'revise', `${fy}年度の業績予想を${up ? '上方' : '下方'}修正：純利益${CORP.fmt.money(g.net)}→${CORP.fmt.money(ng.net)}`, { from: g.net, to: ng.net }, 0.3 * move, true);
        if (ng.dps !== g.dps && next >= w.launch) news(out, s, p, next, at + 120, 'dividend', `年間配当予想を1株$${CORP.fmt.group(g.dps)}→$${CORP.fmt.group(ng.dps)}に修正`, { from: g.dps, to: ng.dps }, 0, true);
        s.guide = ng;
        setDividend(s, p, ng);
      }
    }
  }
  // a new year: its pay, people and budgets, and its plan (published with the last year's results)
  if (CORP.ymd(next).d === 1 && CORP.ymd(next).m === 4) {
    newYear(w, s, p, next);
    s.plan = guidance(w, s, p, next, forecast(w, s, p, next));
  }
  if (s.guide) s.guide.ytdOp = expectedSoFar(s, next);
  // the market's view
  const fair = fairValue(s, p, w) / Math.max(1, outstanding(s));
  s.mkt = s.mkt || { e: Math.log(fair), fair };
  s.mkt.fair = fair;
  if (p.listed) {
    const e0 = s.mkt.e;
    let e1 = e0;
    if (next > w.launch) {
      const step = (Math.log(fair) - e0) * (1 - Math.pow(0.5, 1 / 30));
      // (a company whose worth moved far moves the market fast: up to 8% a day, so crashes and booms can happen)
      e1 = e0 + Math.max(-0.08, Math.min(0.08, step));
    }
    s.mkt.e = e1;
    out.anchors.push({ company: s.id, day: next, e0, e1, ev: out.jumps.filter((j) => j.company === s.id && j.day === next).map((j) => [j.at, j.jump]), dps: s.div.daily || 0 });
  }
  void ch;
}
// what the guidance expected of the year up to day `d` (for the bonus and the backing)
function expectedSoFar(s, d) {
  const g = s.guide;
  if (!g) return 0;
  const q = CORP.quarterOf(d - 1), fy = CORP.fyOf(d - 1);
  if (fy !== g.fy) return 0;
  let n = 0;
  for (let i = 0; i < q - 1; i++) n += g.quarters[i];
  const qs = CORP.quarterStart(fy, q), qe = CORP.quarterEnd(fy, q);
  return n + g.quarters[q - 1] * (d - qs) / (qe - qs + 1);
}

/* ------------------------------------------------------------ the shares --- */
// A listed company's shares traded by a player at second `sec`: bought, the company issues them (its treasury
// shares first) and has the money (half of it 資本金, half 資本準備金; a treasury share sold for more than it cost
// adds the difference to その他資本剰余金); sold, it buys them back as treasury shares (自己株式).
export function trade(w, id, side, shares, price, sec) {
  const s = w.co[id];
  const out = outstanding(s);
  s.sh.sec += out * Math.max(0, sec - s.sh.at);
  s.sh.at = Math.max(s.sh.at, sec);
  const amount = shares * price;
  if (side === 'buy') {
    const fromTreasury = Math.min(shares, s.sh.treasury);
    let cash = 0;
    if (fromTreasury) {
      const cost = Math.round(-(s.bal.treasury || 0) * fromTreasury / s.sh.treasury), got = fromTreasury * price;
      s.sh.treasury -= fromTreasury;
      post(s, [['cash', got], ['treasury', -cost], ['othercap', cost - got]], 'treasurySale');
      cash += got;
    }
    const fresh = shares - fromTreasury;
    if (fresh) {
      const got = fresh * price, half = Math.ceil(got / 2);
      s.sh.issued += fresh;
      post(s, [['cash', got], ['capital', -half], ['reserve', -(got - half)]], 'issue');
      cash += got;
    }
    s.raised = (s.raised || 0) + amount;
    s.flowIssued = (s.flowIssued || 0) + shares;
  } else {
    s.sh.treasury += shares;
    post(s, [['treasury', amount], ['cash', -amount]], 'buyback');
    s.raised = (s.raised || 0) - amount;
    s.flowBought = (s.flowBought || 0) + shares;
  }
  s.sh.out = outstanding(s);
}

/* ------------------------------------------------------------ the beginning --- */
// The world on day `launch`: made up from `years` years back (to the start of that fiscal year), the companies'
// retained earnings there found so that each has its profile's own on the launch day exactly (what the made-up
// days leave over is the last day's 雑収入/雑損失), and its shares counted so that a listed one's book price is the
// market's (`prices`), another's the profile's.
export function boot(key, launch, { years = 2, prices = {}, onDay = null } = {}) {
  const ch = chance(key);
  const start = Math.min(launch - 30, CORP.fyStart(CORP.fyOf(launch) - years));
  let shift = Object.fromEntries(CORP.companies.map((p) => [p.id, 0]));
  let w, hist;
  // (a company's retained earnings on the launch day move with where they start, by a little more than one for one:
  // what the bonds and the bank pay on the money; a second guess along that line usually lands to the dollar)
  const ends = {};
  for (let round = 0; round < 3; round++) {
    ({ w, hist } = run(ch, start, launch, shift, onDay));
    let off = 0;
    for (const p of CORP.companies) {
      const end = w.co[p.id].bal.retained, gap = p.retained - end, last = ends[p.id];
      off = Math.max(off, Math.abs(gap));
      const slope = last && shift[p.id] !== last.shift ? (end - last.end) / (shift[p.id] - last.shift) : 1;
      ends[p.id] = { end, shift: shift[p.id] };
      shift[p.id] += Math.round(gap / (slope > 0.5 && slope < 2 ? slope : 1));
    }
    if (off < 1000) break;
  }
  // what is left over to the dollar: the last made-up day's odd income or loss
  for (const p of CORP.companies) {
    const s = w.co[p.id], gap = p.retained - s.bal.retained;
    s.today = 0;
    if (gap) post(s, [['cash', gap], [gap > 0 ? 'nOther' : 'eOther', -gap]], 'receipts');
    s.bal.retained += s.today;
    s.today = 0;
  }
  // the shares: a listed company's book price is its market price (or else the profile's)
  const count = (p) => {
    const s = w.co[p.id], v = fairValue(s, p, w), price = prices[p.id] || p.price || 10000;
    s.sh.issued = Math.max(1000, Math.round(v / price));
    s.sh.founders = Math.round(s.sh.issued * (p.founders || 0));
    s.sh.out = s.sh.issued;
    s.sh.at = launch * DAY;
    const fy = CORP.fyOf(launch - 1), q = CORP.quarterOf(launch - 1);
    s.sd = { m: s.sh.issued * (launch - CORP.monthStart(launch - 1)), q: s.sh.issued * (launch - CORP.quarterStart(fy, q)), y: s.sh.issued * (launch - CORP.fyStart(fy)) };
    s.mkt = { e: Math.log(price), fair: price };
    if (s.guide) { s.guide.eps = Math.round(s.guide.net / s.sh.issued); s.guide.dps = Math.max(0, Math.round(p.payout * Math.max(0, s.guide.expected.net * 0.95) / s.sh.issued)); setDividend(s, p, s.guide); }
  };
  for (const p of CORP.companies) count(p);
  // the backer's stake in its studio
  for (const p of CORP.companies) {
    const deal = p.partner;
    if (!deal || deal.role !== 'backer') continue;
    const st = w.co[deal.with], s = w.co[p.id];
    const shares = Math.round(st.sh.issued * deal.stake);
    s.hold.own = { [deal.with]: shares };
    st.hold.by = { [p.id]: shares };
    // (bought: at its part of the studio's net assets, the 持分法's 投資有価証券 from the first day — else what the studio
    // paid it and what it lost were taken off nothing, below nothing)
    const v = stakeValue(st, shares);
    if (v > 0) post(s, [['affil', v], ['cash', -v]], 'bondsBuy');
    // (its own shares counted again with the stake in its books: its book price still the market's)
    count(p);
  }
  w.fixes = { tax: true, affil: true };
  // the per-share figures of the made-up periods, now that the shares are counted
  for (const r of hist.periods) {
    const s = w.co[r.company];
    r.shares = s.sh.issued;
    r.eps = r.pl.net / s.sh.issued;
    // (the dividends the period paid, a share)
    r.dps = Math.round(-(r.cf.dividends || 0) / s.sh.issued);
    r.bps = (r.bs.capital + r.bs.reserve + (r.bs.othercap || 0) + (r.bs.legal || 0) + r.bs.retained + (r.bs.treasury || 0)) / s.sh.issued;
  }
  for (const p of CORP.companies) w.co[p.id].hist.forEach((h) => { h.eps = h.net / w.co[p.id].sh.issued; });
  // (and on the launch day its people, their pay and its budgets are the profile's own exactly)
  for (const p of CORP.companies) { const s = w.co[p.id]; people(s, p, launch, launch); budgets(s, p, launch, launch); }
  w.day = launch - 1;
  return { world: w, history: hist };
}
// the made-up days from `start` to the day before `launch`
function run(ch, start, launch, shift, onDay) {
  // (the economy's made-up path, worked out first: where it would end, which the bridge takes away)
  let raw = 0, last = start;
  for (let d = start; d < launch; d++) if (CORP.ymd(d).d === 1) { raw = raw * ECON_KEEP + CORP.economy.sd * ch.z(`economy:${d}`); last = d; }
  const w = { v: 1, day: start - 1, launch, start, econ: { x: 0, raw: 0, bridge: raw, last, fade: 0 }, co: {} };
  for (const p of CORP.companies) {
    // (the made-up past adds the sum of its days' profits less dividends to where it starts)
    w.co[p.id] = newCompany(p, start, launch, p.retained + shift[p.id] - 0, ch);
  }
  calibrate(w, start);
  startTies(w);
  w.mon = {};
  // the first year's guidance and dividends, as if published at its start
  for (const id of ORDER) {
    const s = w.co[id], p = PROFILES.get(id);
    s.sh.issued = 1;
    for (const k of ['m', 'q', 'y']) { s.cash0[k] = s.bal.cash || 0; }
    s.guide = guidance(w, s, p, start, forecast(w, s, p, start));
    setDividend(s, p, s.guide);
    s.tax.last = { total: Math.round(Math.max(0, s.guide.pretax) * 0.33), business: Math.round(Math.max(0, s.guide.pretax) * 0.07), interim: 0 };
    s.tax.bizPaid = s.tax.last.business;
  }
  const hist = { periods: [], titles: [], news: [], days: [] };
  for (let d = start; d < launch; d++) {
    const out = closeDay(w, d, {}, ch);
    hist.periods.push(...out.periods);
    hist.titles.push(...out.titles);
    hist.news.push(...out.news);
    hist.days.push(...out.days);
    if (onDay) onDay(d);
  }
  // the titles still on sale and the projects under way are in the companies themselves
  for (const p of CORP.companies) {
    const s = w.co[p.id];
    if (s.titles) for (const t of s.titles) hist.titles.push(titleRow(s, t, p));
  }
  return { w, hist };
}
// A year of a seller's products to customers outside at the start ({ sales, cost, selling, margin }: at their list
// prices, what they cost it, what selling them costs, and for each maker what it sells it { buy, excl, cost })
// (`weight`: each product's customers that many times as many, the economy's say on it)
function productsYear(kind, seller, weight = null) {
  const out = { sales: 0, cost: 0, selling: 0, makers: {} };
  for (const [id, pr0] of Object.entries(CORP.products[kind])) {
    const price = listPrice(kind, id);
    if (!pr0.npc || !price) continue;
    const pr = weight ? { ...pr0, npc: pr0.npc * weight(pr0) } : pr0;
    out.sales += pr.npc * price;
    out.selling += pr.npc * CORP.products.sell[kind];
    if (pr.maker === seller) out.cost += pr.npc * pr.cost;
    else {
      out.cost += pr.npc * (pr.buy + (pr.excl || 0));
      const m = out.makers[pr.maker] || (out.makers[pr.maker] = { buy: 0, excl: 0, cost: 0 });
      m.buy += pr.npc * pr.buy;
      m.excl += pr.npc * (pr.excl || 0);
      m.cost += pr.npc * pr.cost;
    }
  }
  return out;
}
// The trades' costs not given, found so that each makes its profile's 営業利益 on its profile's sales at the launch:
// a seller's other trade (flex) takes what its products leave of its sales, at the margin that makes the profit;
// the maker's sales abroad what the dealer and the shop leave of its sales, with the materials that make its
// profit; the others the rest of 販管費. (A little of every trade's sales is 販管費 besides: `other`.)
function calibrate(w, start) {
  w.b2b0 = {};
  for (const p of CORP.companies) {
    if (!p.streams) continue;
    for (const x of p.streams) if (x.products) {
      for (const [maker, k] of Object.entries(productsYear(x.products, p.id).makers)) {
        const key = maker + ':' + p.id, have = w.b2b0[key] || { buy: 0, excl: 0, cost: 0 };
        w.b2b0[key] = { buy: have.buy + k.buy, excl: have.excl + k.excl, cost: have.cost + k.cost };
      }
    }
  }
  for (const p of CORP.companies) {
    const s = w.co[p.id];
    if (p.model === 'studio') continue;
    const people = p.staff * p.cost, fixed = p.place.amount + p.rd.amount + (p.ads || 0);
    s.share = {};
    s.cost = {};
    if (p.model === 'bank') {
      s.otherBase = Math.max(0, p.sales - p.op - people - fixed - p.sales * p.credit.share);
    } else if (p.materials) {
      let sold = 0, made = 0;
      for (const [key, k] of Object.entries(w.b2b0)) if (key.startsWith(p.id + ':')) { sold += k.buy + k.excl; made += k.cost; }
      s.scale = { export: Math.max(0.05, (p.sales - sold) / p.sales) };
      s.otherBase = Math.round(p.sales * 0.05);
      const exportSales = p.sales - sold;
      s.materials = Math.max(0.02, (p.sales - p.op - people - fixed - s.otherBase - made) / Math.max(1, exportSales));
    } else if (p.streams.some((x) => x.products)) {
      let sales = 0, margin = 0, selling = 0;
      for (const x of p.streams) if (x.products) {
        const k = productsYear(x.products, p.id);
        sales += k.sales;
        margin += k.sales - k.cost;
        selling += k.selling;
      }
      const flex = p.streams.find((x) => x.flex);
      s.otherBase = Math.round(p.sales * 0.005);
      const rest = Math.max(0, p.sales - sales), need = p.op + people + fixed + selling + s.otherBase - margin;
      s.share[flex.id] = rest / p.sales;
      s.cost[flex.id] = Math.max(0, Math.min(0.95, 1 - need / Math.max(1, rest)));
    } else {
      const cogs = p.streams.reduce((n, x) => n + p.sales * (x.share || 0) * (x.cost || 0), 0);
      s.otherBase = Math.max(0, p.sales - p.op - people - fixed - cogs);
    }
    s.budget.other = Math.round(s.otherBase * trend(p, start, w.launch));
  }
}

/* ------------------------------------------------------ a company added later --- */
// A company the rules have that a world begun before it does not (YOSIDA, MAGITA's rival, came later): made up as
// the world would have had it — a world begun on the day after the last one closed, from the same key, with its own
// made-up past — and set in, already living on the country's money if the others are; and the others' terms with it
// found again (the trades' costs that its products change, the usual trade between the companies, the ties). What
// it returns: the ones added and their made-up past (the rows to keep).
export function addCompanies(key, w, prices = {}) {
  const added = CORP.companies.filter((p) => !w.co[p.id]).map((p) => p.id);
  if (!added.length) return null;
  const { world: f, history: h } = boot(key, w.day + 1, { years: 1, prices });
  for (const id of added) {
    const s = f.co[id];
    if (w.circ) { s.payAll = true; if (abroad(s)) goAbroad(s); }
    w.co[id] = s;
  }
  for (const [id, s] of Object.entries(f.co)) {
    if (added.includes(id) || !w.co[id]) continue;
    for (const k of ['share', 'cost', 'scale', 'materials']) if (s[k] !== undefined) w.co[id][k] = s[k];
  }
  w.b2b0 = { ...(w.b2b0 || {}), ...f.b2b0 };
  w.ties = w.ties || {};
  for (const t of ties()) if (w.ties[t.key] === undefined) w.ties[t.key] = f.ties[t.key];
  const keep = (r) => added.includes(r.company);
  return { added, history: { periods: h.periods.filter(keep), titles: h.titles.filter(keep), news: h.news.filter(keep), days: h.days.filter(keep) } };
}

/* ---------------------------------------------------------------- the ties --- */
// ビジネス友好度: every pair the rules name (Tenesice with each of the others), kept in the world
const TIE_PAIRS = CORP.ties.flatMap((t) => t.b === '*' ? CORP.companies.filter((c) => c.id !== t.a).map((c) => ({ ...t, b: c.id })) : [t]);
const tieKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
export function tieOf(w, a, b) {
  const v = w.ties && w.ties[tieKey(a, b)];
  return v === undefined ? 50 : v;
}
export const ties = () => TIE_PAIRS.map((t) => ({ a: t.a, b: t.b, start: t.start, why: t.why, key: tieKey(t.a, t.b) }));
function startTies(w) {
  w.ties = {};
  for (const t of TIE_PAIRS) w.ties[tieKey(t.a, t.b)] = t.start;
}
// how long the maker lets a buyer take to pay: longer the better they get on, less when they do not
function termsDays(w, maker, buyer) {
  const f = tieOf(w, maker, buyer);
  return f >= 70 ? 60 : f < 30 ? 30 : 45;
}
// The month's moves: back a tenth of the way to where it began, a little chance, and what passed between them
// (the maker: its trade with the buyer up or down against usual, the buyer's losses on its terms, its rebates;
// Ice Smoker and RIRU: the backing against plan and their hits; the rivals: drifting apart; the bank: loans
// paid back or taken; the rest: the players' money passing through them).
function moveTies(w, d, ch, out) {
  const m = w.mon;
  for (const t of TIE_PAIRS) {
    const k = tieKey(t.a, t.b), f = w.ties[k], has = (x) => t.a === x || t.b === x;
    let delta = 0.1 * (t.start - f) + 0.6 * ch.z(`tie:${k}:${d}`);
    const maker = Object.keys(CORP.makers).find(has), buyer = ['carowner', 'jinx'].find(has);
    if (maker && buyer) {
      const usual = w.b2b0[maker + ':' + buyer];
      const traded = m[`b2b:${maker}:${buyer}`] || 0;
      if (usual) delta += 3 * Math.max(-1, Math.min(1, traded / ((usual.buy + usual.excl) / 12) - 1));
      if (maker === 'magita') delta -= 1.5 * Math.min(1, (m[buyer + ':loss'] || 0) / Math.max(1, traded * 0.1));
      if (m['rebate:' + buyer]) delta += 3;
    } else if (has('magita') && has('yosida')) {
      delta -= 0.6;
    } else if (has('ice') && has('riru')) {
      delta += 2 * Math.max(-1, Math.min(1, (m['support:ice'] || 1) - 1)) + (m['riru:hit'] ? 2 : 0) + (m['ice:hit'] ? 1 : 0);
    } else if (has('citywork') && has('speedeed')) {
      delta -= 0.8;
    } else if (has('yosida') && has('daizin')) {
      // (the gacha's VIP1週間券 bought of DAIZIN: a month of them brings them closer)
      delta += m['yosida:daizin'] ? 1 : -0.3;
    } else if (has('yosida') && has('wazima')) {
      delta -= 0.4;
    } else if (has('tenesice')) {
      const o = t.a === 'tenesice' ? t.b : t.a;
      delta += (m[o + ':repaid'] ? 2 : 0) - (m[o + ':borrowed'] ? 1 : 0);
    } else {
      for (const x of [t.a, t.b]) if (m[x + ':players']) delta += 0.5;
    }
    const v = Math.max(0, Math.min(100, Math.round((f + delta) * 10) / 10));
    if (Math.floor(v / 20) !== Math.floor(f / 20)) {
      const pa = PROFILES.get(t.a), pb = PROFILES.get(t.b);
      out.news.push({ company: t.a, at: (d + 1) * DAY + 4 * 3600, kind: 'tie', text: `${pa.name}と${pb.name}のビジネス友好度が${v > f ? '上がりました' : '下がりました'}（${Math.round(v)}）`, data: { with: t.b, from: f, to: v }, public: false });
    }
    w.ties[k] = v;
  }
  w.mon = {};
}
// At a quarter's end MAGITA gives a buyer it gets on well with (70 and over) a rebate (販売奨励金) out of the
// 専売特別費用 it took from it that quarter: up to a fifth of it, at 100.
function rebates(w, s, p, d, out) {
  for (const [buyer, excl] of Object.entries(s.exclQ || {})) {
    const f = tieOf(w, p.id, buyer), n = f >= 70 && excl > 0 ? Math.round(excl * 0.2 * (f - 70) / 30) : 0;
    if (n <= 0) continue;
    const b = w.co[buyer], bp = PROFILES.get(buyer), stream = bp.streams.find((x) => x.products);
    post(s, [['c:rebate', n], ['cash', -n]], 'expenses');
    post(b, [['cash', n], ['c:' + stream.id, -n]], 'receipts');
    w.mon['rebate:' + buyer] = n;
    news(out, s, p, d + 1, 4 * 3600, 'rebate', `${bp.name}に販売奨励金${CORP.fmt.money(n)}を支払い（ビジネス友好度${Math.round(f)}）`, { to: buyer, n }, 0, false);
  }
  s.exclQ = {};
}

export { chance, post, take, forecast, expectDay, guidance, statement, productsYear };
