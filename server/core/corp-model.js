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
const M = CORP.money;
// a game's sales: `fast` of them in the first weeks (half-life `h1` days), the rest over its life (half-life by its scale)
const CURVE = { fast: 0.45, h1: 12, h2: { AAA: 240, '大型': 200, '中型': 150 }, years: 3 };
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
  if (CORP.companies.some((o) => (o.streams || []).some((x) => x.from === p.id))) return 3;
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
  // the rest of the equity is cash (and, for the companies outside the bank, half of what is free in bonds)
  const free = equityOf(s) + liabilitiesOf(s) - assetsOf(s);
  if (p.model !== 'bank') {
    const bonds = Math.max(0, Math.round(free * 0.45 / 1e6) * 1e6);
    s.bal.bonds = (s.bal.bonds || 0) + bonds;
    s.bal.cash = free - bonds;
  } else s.bal.cash = (s.bal.cash || 0) + free;
  return s;
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
  const salary = take(s, 'salary', s.n * s.pay * 12 / 16 / YEAR);
  const bonus = take(s, 'bonus', s.n * s.pay * 4 / 16 / YEAR);
  const welfare = take(s, 'welfare', s.n * (s.unit - s.pay) / YEAR);
  const total = salary + bonus + welfare;
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
// the year's costs a day: the buildings, research, advertising and the rest (paid at the month's end)
function running(s, p, d) {
  const place = take(s, 'place', s.budget.place / YEAR), rd = take(s, 'rd', s.budget.rd / YEAR);
  const ads = take(s, 'ads', s.budget.ads / YEAR), other = take(s, 'other', s.budget.other / YEAR);
  const all = place + rd + ads + other;
  post(s, [[p.model === 'maker' ? 'c:plant' : 'sPlace', place], ['sRd', rd], ['sAds', ads], ['sOther', other], ['ap', -all]]);
  s.exp += all;
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
// money paid in at once (the players): a sale for cash, its cost owed as above
function sellCash(w, s, code, n, cost) {
  if (n <= 0) return;
  post(s, [['cash', n], ['r:' + code, -n]], 'receipts');
  if (cost > 0) {
    post(s, [['c:' + code, cost], ['ap', -cost]]);
    s.owe['*'] = (s.owe['*'] || 0) + cost;
  }
}
// a car's or a Shop item's price in the catalogue (null: not sold)
const PRICES = { cars: new Map(RULES.cars.filter((c) => c.price > 0 && !c.ended).map((c) => [c.id, c.price])), items: new Map(RULES.shop.map((i) => [i.id, i.price])) };
export const listPrice = (kind, id) => PRICES[kind].get(id) || 0;
// `n` of a product sold for `paid` in all (to customers outside at its list price, the players for what they paid):
// the sale; its cost (made here: its materials, bought outside; made by another company: bought from it at its
// 仕入れ価格 with its 専売特別費用, which becomes that company's sale); and what selling them cost (販売費).
function sellProducts(w, s, code, kind, id, n, paid, cash) {
  if (n <= 0) return;
  const pr = CORP.products[kind][id];
  if (cash) post(s, [['cash', paid], ['r:' + code, -paid]], 'receipts');
  else { post(s, [['ar', paid], ['r:' + code, -paid]]); s.recv += paid; }
  let cost;
  if (pr.maker === s.id) {
    cost = n * pr.cost;
    s.owe['*'] = (s.owe['*'] || 0) + cost;
  } else {
    const buy = n * pr.buy, excl = n * (pr.excl || 0);
    cost = buy + excl;
    s.owe[pr.maker] = (s.owe[pr.maker] || 0) + cost;
    w.b2b.push({ from: pr.maker, to: s.id, kind, id, n, buy, excl, cost: n * pr.cost });
  }
  const selling = n * CORP.products.sell[kind];
  post(s, [['c:' + code, cost], ['sSelling', selling], ['ap', -(cost + selling)]]);
  s.exp += selling;
  const row = s.sold[id] || (s.sold[id] = { npc: 0, players: 0, sales: 0, margin: 0 });
  row[cash ? 'players' : 'npc'] += n;
  row.sales += paid;
  row.margin += paid - cost;
  // (a car sold for less than it cost the dealer: a loss taken on the maker's terms)
  if (paid < cost) w.mon[s.id + ':loss'] = (w.mon[s.id + ':loss'] || 0) + cost - paid;
}

// a trade's day: its streams (the economy, the season and its own ups and downs), the players' money on top
function tradeDay(w, s, p, d, flows, ch) {
  payroll(s, p, d);
  running(s, p, d);
  const lift = trend(p, d, w.launch), season = seasonOf(p, d);
  if (d % 7 === 0) for (const x of p.streams) s.noise[x.id] = 0.8 * (s.noise[x.id] || 0) + 0.6 * (x.noise || 0.04) * ch.z(`${p.id}:${x.id}:${d}`);
  const mine = flows[p.id] || {};
  s.pday = 0;
  for (const x of p.streams) {
    if (x.to) continue;
    const f = lift * season * econOf(w, x.beta ?? p.beta) * Math.exp(s.noise[x.id] || 0);
    if (x.products) {
      // each model's or item's customers outside the game
      for (const [id, pr] of Object.entries(CORP.products[x.products])) {
        const price = listPrice(x.products, id);
        if (!pr.npc || !price) continue;
        const n = take(s, 'u:' + id, pr.npc * f / YEAR);
        sellProducts(w, s, x.id, x.products, id, n, n * price, false);
      }
    } else {
      const share = s.share && s.share[x.id] !== undefined ? s.share[x.id] : (x.share || 0);
      if (share) {
        const n = take(s, 'sale:' + x.id, p.sales * share * f * (s.scale && s.scale[x.id] || 1) / YEAR);
        const cost = s.cost && s.cost[x.id] !== undefined ? s.cost[x.id] : (x.cost || 0);
        sell(w, s, x.id, n, take(s, 'cost:' + x.id, n * cost));
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
    if (s.pr[x.id]) s.pr[x.id] *= 29 / 30;
  }
  if (s.pday) w.mon[s.id + ':players'] = (w.mon[s.id + ':players'] || 0) + s.pday;
  // the materials of what the maker sold abroad today (its sales to the other companies come in after theirs: ORDER)
  if (p.materials) materials(s, s.per.d['r:export'] || 0);
  // the used cars bought back from players go to dealers outside within weeks, for a little more
  if (s.used && s.used.length) {
    const due = s.used.filter((u) => u.due <= d);
    s.used = s.used.filter((u) => u.due > d);
    for (const u of due) {
      const n = Math.round(u.cost * 1.08);
      post(s, [['ar', n], ['r:used', -n], ['c:used', u.cost], ['stock', -u.cost]]);
      s.recv += n;
    }
  }
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
  const n = take(s, 'materials', sold * s.materials);
  if (n <= 0) return;
  post(s, [['c:materials', n], ['ap', -n]]);
  s.owe['*'] = (s.owe['*'] || 0) + n;
}

// the bank's day: its trade's streams, what goes bad of its loans, its books growing with its deposits
function bankDay(w, s, p, d, ch) {
  payroll(s, p, d);
  running(s, p, d);
  const lift = trend(p, d, w.launch);
  if (d % 7 === 0) for (const x of p.streams) s.noise[x.id] = 0.8 * (s.noise[x.id] || 0) + 0.6 * (x.noise || 0.04) * ch.z(`${p.id}:${x.id}:${d}`);
  for (const x of p.streams) {
    const n = take(s, 'sale:' + x.id, p.sales * x.share * lift * econOf(w, x.beta ?? p.beta) * Math.exp(s.noise[x.id] || 0) / YEAR);
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

/* ------------------------------------------------------------- a studio's day --- */
function studioDay(w, s, p, d, ch, out) {
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
  const expected = line.base * rivals(w, day) * budgetMult(pr.spent / ref) * Math.exp((q - 72) / QUALITY) * Math.pow(s.brand, 0.6) * econOf(w, p.beta);
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
  w.bank.paid += dep;
  let owed = 0;
  for (const l of s.loans) owed += l.amt * l.rate / YEAR;
  const n = take(s, 'loanInt', owed);
  if (n) post(s, [['eInterest', n], ['cash', -n]], 'interestOut');
  w.bank.got += n;
}
// the rate a rank-A company borrows at: lower the more of its own money it runs on
function rateFor(w, s) {
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
    if (sell > 0) { post(s, [['cash', sell], ['bonds', -sell]], 'bondsSell'); cash += sell; }
    if (cash < floor) {
      const amt = Math.ceil((want - cash) / M.unit) * M.unit, rate = rateFor(w, s);
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
    }
  }
  // loans that come due are rolled over at today's rate
  for (const l of s.loans) if (d >= l.until) { l.until = d + M.years * YEAR; l.rate = rateFor(w, s); }
}
const monthlyCosts = (s) => Math.round(s.n * s.unit / 12 + (s.budget.place + s.budget.rd + s.budget.ads + s.budget.other) / 12);

// What is owed paid, day by day and at the month's end: the suppliers within weeks (each to whom it is owed), the
// customers' money in, the pay and the bills of the month.
function settle(w, s, p, d) {
  const isEnd = CORP.isMonthEnd(d);
  for (const [to, owed] of Object.entries(s.owe)) {
    if (owed <= 0) continue;
    const n = Math.min(owed, Math.max(1, Math.trunc(owed / (to === '*' ? 30 : termsDays(w, to, s.id)))));
    s.owe[to] = owed - n;
    post(s, [['ap', n], ['cash', -n]], 'purchases');
    if (to !== '*') w.paid.push({ to, n });
  }
  if (s.recv > 0) {
    const n = Math.min(s.recv, Math.max(1, Math.trunc(s.recv / (p.model === 'studio' ? 40 : 15))));
    s.recv -= n;
    post(s, [['cash', n], ['ar', -n]], 'receipts');
  }
  if (!isEnd) return;
  const accrued = s.bal.accrued || 0;
  if (accrued) post(s, [['accrued', accrued], ['cash', -accrued]], 'payroll');
  if (s.exp) { post(s, [['ap', s.exp], ['cash', -s.exp]], 'expenses'); s.exp = 0; }
  if (p.capex) {
    const buy = Math.round(s.budget.capex / 12);
    post(s, [['ppe', buy], ['cash', -buy]], 'capex');
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
  if (d >= w.launch && t.d === 1) {
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
    s.morale = Math.max(0.2, Math.min(0.95, s.morale + 0.08 * (mult - 1)));
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
  const raise = p.raise * (1 + 0.6 * perf);
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
  const fee = deal.fee;
  const base = Math.max(0, (b.budget - b.paid) / monthsLeft - fee);
  const runway = (st.bal.cash || 0) / Math.max(1, monthlyCosts(st));
  const need = Math.max(-0.5, Math.min(1, (18 - runway) / 18));
  const soon = st.projects.some((pr) => pr.due - d < 60) ? 0.3 : 0;
  const mine = s.guide && s.guide.ytdOp ? Math.max(-0.4, Math.min(0.4, opOf(s.per.y) / Math.max(1, Math.abs(s.guide.ytdOp)) - 1)) : 0;
  const f = Math.max(0.4, Math.min(2.2, (1 + 0.6 * need + soon + 0.5 * mine + 0.15 * ch.z(`${p.id}:support:${d}`)) * (0.8 + 0.4 * tieOf(w, p.id, deal.with) / 100)));
  const support = Math.round(Math.max(deal.support[0], Math.min(deal.support[1], base * f)) / 100000) * 100000;
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
  for (const [holder, shares] of Object.entries(s.hold.by || {})) {
    const h = w.co[holder], part = Math.round(n * shares / Math.max(1e-9, out));
    if (part > 0) post(h, [['cash', part], ['affil', -part]], 'interestIn');
  }
}

/* ------------------------------------------------------------- the quarters --- */
// A quarter's taxes: the year's so far, at the rate the year is expected to pay (its last quarter: the year's own)
function taxes(w, s, p, d, final) {
  const fy = CORP.fyOf(d);
  const pretax = CORP.plOf(s.per.y).pretax;
  // (the profit of a company held by the equity method is not income yet; half the dividends from it are not taxed)
  const income = pretax - (s.per.y.nEquity || 0) + (s.per.y.eEquity || 0);
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
// paid: half of last year's in advance in the year's 8th month (中間納付), the rest in the 2nd month after it ended
function payTaxes(w, s, p, d) {
  if (!CORP.isMonthEnd(d)) return;
  const m = CORP.ymd(d).m, fyMonth = ((m - 4 + 12) % 12) + 1;
  if (fyMonth === CORP.tax.interimMonth && s.tax.last.total > 0) {
    const n = Math.floor(s.tax.last.total / 2);
    post(s, [['taxdue', n], ['cash', -n]], 'taxes');
    s.tax.interim = n;
  }
  if (fyMonth === CORP.tax.finalMonths) {
    const left = (s.tax.last.total || 0) - (s.tax.last.interim || 0);
    if (left) post(s, [['taxdue', left], ['cash', -left]], 'taxes');
    // (the 事業税 of that year is a cost of this one)
    s.tax.bizPaid = s.tax.last.business || 0;
  }
}

/* ------------------------------------------------------------ the forecast --- */
// What a day is expected to bring and cost, as the managers see it now: the trade's streams at their rate (with the
// players' money as of late), the studio's games by their estimates and its projects by their plans, the year's
// costs by its budgets, interest on what it holds.
function expectDay(w, s, p, d) {
  const e = {};
  const add = (k, v) => { e[k] = (e[k] || 0) + v; };
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
      const f = lift * season * econOf(w, x.beta ?? p.beta) / YEAR;
      const players = s.pr && s.pr[x.id] || 0;
      if (x.products) {
        const k = productsYear(x.products, s.id);
        add('r:' + x.id, k.sales * f + players);
        add('c:' + x.id, k.cost * f + players * k.cost / Math.max(1, k.sales));
        add('sSelling', k.selling * f + players * k.selling / Math.max(1, k.sales));
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
  add(p.model === 'maker' ? 'c:plant' : 'sPlace', s.budget.place / YEAR);
  add('sRd', s.budget.rd / YEAR);
  add('sAds', s.budget.ads / YEAR);
  add('sOther', s.budget.other / YEAR);
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
  const income = pl.pretax - (sums.nEquity || 0);
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
  let v = cash + 0.5 * Math.max(0, ni) * p.per + 0.5 * book * p.pbr + 0.5 * Math.min(0, ni) * 4;
  // a studio: what its games under way and on sale are expected to earn beyond what they cost, after tax
  if (p.model === 'studio' && w) v += Math.max(-eq / 2, 0.67 * pipeline(w, s, p));
  return Math.max(eq / 3, v);
}
// what a studio's projects are expected to earn when done (as their budgets and the studio stand now, the nearer
// done the surer) and its games on sale still to earn, beyond their costs
function pipeline(w, s, p) {
  let v = 0;
  for (const pr of s.projects) {
    const line = lineOf(p, pr.line), ref = budgetRef(p, line), done = Math.max(0.05, Math.min(1, pr.prog));
    const final = pr.spent / done;
    const q = 72 + p.skill + 6 * Math.log(s.tech) + 8 * Math.log(Math.max(0.2, final / ref));
    const est = line.base * rivals(w, pr.due) * budgetMult(final / ref) * Math.exp((q - 72) / QUALITY) * Math.pow(s.brand, 0.6);
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
    e.fade = d < w.launch ? Math.min(1, (d - w.start) / Math.max(1, (e.last || d) - w.start)) : (e.fade || 0) * ECON_KEEP;
    e.x = e.raw - (e.bridge || 0) * e.fade;
  }
  const live = d >= w.launch;
  for (const id of ORDER) {
    const s = w.co[id], p = PROFILES.get(id);
    s.today = 0;
    s.per.d = {};
    if (!live) { people(s, p, d, w.launch); budgets(s, p, d, w.launch); }
    if (p.model === 'studio') studioDay(w, s, p, d, ch, out);
    else if (p.model === 'bank') bankDay(w, s, p, d, ch);
    else {
      tradeDay(w, s, p, d, flows, ch);
      if (p.materials) supply(w, s, p);
    }
    interest(w, s, p);
    dividends(w, s, p, d);
  }
  for (const id of ORDER) {
    const s = w.co[id], p = PROFILES.get(id);
    settle(w, s, p, d);
    for (const x of w.paid.splice(0)) received(w.co[x.to], x.n);
    payTaxes(w, s, p, d);
    backing(w, s, p, d, ch, out);
    month(w, s, p, d, ch, out);
    if (p.model === 'studio') titlesLook(w, s, p, d, out);
    if (CORP.isMonthEnd(d)) treasury(w, s, p, d, out);
  }
  // the maker's rebates at a quarter's end, and the month's moves of the ties
  if (CORP.isQuarterEnd(d)) for (const id of ORDER) if (PROFILES.get(id).materials) rebates(w, w.co[id], PROFILES.get(id), d, out);
  if (CORP.isMonthEnd(d)) moveTies(w, d, ch, out);
  // the bank: the interest it was paid and paid, and every company's money and loans as its deposits and loans
  const bank = w.co.tenesice;
  if (bank) {
    const net = w.bank.got - w.bank.paid;
    if (net) post(bank, [['cash', net], ['r:nii', -net]], 'receipts');
    let cash = 0, lent = 0;
    for (const id of ORDER) if (id !== 'tenesice') { cash += w.co[id].bal.cash || 0; lent += debtOf(w.co[id]); }
    const dc = cash - (bank.inGame || { cash }).cash, dl = lent - (bank.inGame || { lent }).lent;
    if (bank.inGame) {
      if (dc) post(bank, [['cash', dc], ['deposits', -dc]], 'deposits');
      if (dl) post(bank, [['lent', dl], ['cash', -dl]], 'lending');
    }
    bank.inGame = { cash, lent };
  }
  // the day closes: its profit into the retained earnings, the share-days counted
  for (const id of ORDER) {
    const s = w.co[id], p = PROFILES.get(id);
    if (CORP.isQuarterEnd(d)) {
      if (p.model === 'studio') impair(s, p, d);
      // the backer's part of its studio's quarter (持分法)
      for (const [held, shares] of Object.entries(s.hold.own || {})) {
        const t = w.co[held];
        const part = Math.round((t.qNet || 0) * shares / Math.max(1e-9, outstanding(t)));
        if (part > 0) post(s, [['affil', part], ['nEquity', -part]]);
        else if (part < 0) post(s, [['eEquity', -part], ['affil', part]]);
      }
      taxes(w, s, p, d, CORP.isFyEnd(d));
    }
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
  delete w.b2b;
  delete w.paid;
  delete w.bank;
  return out;
}
// (assets are always liabilities and equity: a day that would break it is a fault of the model)
function check(s, d) {
  const gap = assetsOf(s) - liabilitiesOf(s) - equityOf(s);
  if (gap !== 0) throw new Error(`corp ${s.id}: the books do not balance on day ${d} by ${gap}`);
}
function dayRow(w, s, p, d) {
  const pl = CORP.plOf(Object.fromEntries(Object.entries(s.per.d).filter(([k]) => !/^cf:/.test(k))));
  return { company: s.id, day: d, sales: Math.round(pl.sales), op: Math.round(pl.op), net: Math.round(pl.net), cash: s.bal.cash || 0, bonds: s.bal.bonds || 0, debt: debtOf(s),
    equity: equityOf(s), staff: s.n, fair: s.mkt ? Math.round(s.mkt.fair) : 0, econ: Math.round(Math.exp(w.econ.x) * 1000) / 1000, players: s.players || 0 };
}

// The announcements of the next day (決算発表 two weeks after the quarter: the results, against the same quarter a
// year before and against what the guidance expected; with the fourth, the new year's guidance; with the others, a
// revision when the year is far from it), and the market's view for the next day.
function announce(w, s, p, d, out, ch) {
  const next = d + 1;
  const due = s.pend.filter((x) => x.day === next);
  s.pend = s.pend.filter((x) => x.day !== next);
  const at = CORP.announce.hour * 3600;
  for (const x of due) {
    if (x.kind !== 'results') continue;
    const yoy = x.prev && x.prev.sales ? ` (前年同期比${CORP.fmt.pct(x.pl.sales / x.prev.sales - 1)})` : '';
    const surprise = x.expected !== null && x.expected !== undefined ? (x.pl.op - x.expected) / Math.max(1, Math.abs(s.guide ? s.guide.op : x.expected * 4) / 4) : 0;
    news(out, s, p, next, at, 'results', `${CORP.quarterLabel(CORP.quarterEnd(x.fy, x.q))}決算：売上高${CORP.fmt.money(x.pl.sales)}${yoy}、営業利益${CORP.fmt.money(x.pl.op)}、純利益${CORP.fmt.money(x.pl.net)}`,
      { key: x.key, surprise }, 0.06 * Math.max(-1.5, Math.min(1.5, surprise)), true);
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
      e1 = e0 + Math.max(-0.015, Math.min(0.015, step));
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
  for (const p of CORP.companies) {
    const s = w.co[p.id], v = fairValue(s, p, w), price = prices[p.id] || p.price || 10000;
    s.sh.issued = Math.max(1000, Math.round(v / price));
    s.sh.founders = Math.round(s.sh.issued * (p.founders || 0));
    s.sh.out = s.sh.issued;
    s.sh.at = launch * DAY;
    const fy = CORP.fyOf(launch - 1), q = CORP.quarterOf(launch - 1);
    s.sd = { m: s.sh.issued * (launch - CORP.monthStart(launch - 1)), q: s.sh.issued * (launch - CORP.quarterStart(fy, q)), y: s.sh.issued * (launch - CORP.fyStart(fy)) };
    s.mkt = { e: Math.log(price), fair: price };
    if (s.guide) { s.guide.eps = Math.round(s.guide.net / s.sh.issued); s.guide.dps = Math.max(0, Math.round(p.payout * Math.max(0, s.guide.expected.net * 0.95) / s.sh.issued)); setDividend(s, p, s.guide); }
  }
  // the backer's stake in its studio
  for (const p of CORP.companies) {
    const deal = p.partner;
    if (!deal || deal.role !== 'backer') continue;
    const st = w.co[deal.with], s = w.co[p.id];
    const shares = Math.round(st.sh.issued * deal.stake);
    s.hold.own = { [deal.with]: shares };
    st.hold.by = { [p.id]: shares };
  }
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
function productsYear(kind, seller) {
  const out = { sales: 0, cost: 0, selling: 0, makers: {} };
  for (const [id, pr] of Object.entries(CORP.products[kind])) {
    const price = listPrice(kind, id);
    if (!pr.npc || !price) continue;
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
    if (has('magita') && (has('carowner') || has('jinx'))) {
      const buyer = has('carowner') ? 'carowner' : 'jinx', usual = w.b2b0['magita:' + buyer];
      const traded = m[`b2b:magita:${buyer}`] || 0;
      if (usual) delta += 3 * Math.max(-1, Math.min(1, traded / ((usual.buy + usual.excl) / 12) - 1));
      delta -= 1.5 * Math.min(1, (m[buyer + ':loss'] || 0) / Math.max(1, traded * 0.1));
      if (m['rebate:' + buyer]) delta += 3;
    } else if (has('ice') && has('riru')) {
      delta += 2 * Math.max(-1, Math.min(1, (m['support:ice'] || 1) - 1)) + (m['riru:hit'] ? 2 : 0) + (m['ice:hit'] ? 1 : 0);
    } else if (has('citywork') && has('speedeed')) {
      delta -= 0.8;
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
