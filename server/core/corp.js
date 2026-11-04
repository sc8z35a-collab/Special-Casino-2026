// 企業 on the server: the world of companies (server/core/corp-model.js) kept in the database and worked out a day
// at a time as the share prices pass each day's end (server/core/stocks.js: ensure, closesAt, close), taking in the
// players' money of each day as it is spent (flow, sold: a row a day) and the 投資's trades as they fill (traded:
// new shares issued, shares bought back, Dtrade's fee); what the 投資 screen shows of the listed ones (view) and
// everything for the operator site's 株式 app (the routes, answered with `{ same: true }` while nothing changed).
//
// Nothing here wakes the server or asks anything of the page: a day is closed when the prices are worked out past
// its end (a look at the market, a second's tick while someone watches, an order waiting, the housekeeping), and
// what changed goes out on the live connections that are open (free to send).
//
// The world in memory is the one in the database: a transaction that fails takes back what it changed (`stale`
// until it commits: read again before the next use).
import { CORP, STOCKS, RULES, NPC, LOCAL, GACHA } from './rules.js';
import { keyFrom } from './auth.js';
import { ApiError } from './errors.js';
import { partOf } from './hash.js';
import * as model from './corp-model.js';

const DAY = 86400;
const KEEP_DAYS = 800;          // a company's days kept (its months, quarters and years are kept for good)
const KEEP_FLOWS = 60;          // the players' money by the day
const KEEP_ANCHORS = 800;    // (the dividends a share: a holding not looked at for long is paid by them)
const PUBLIC_NEWS = 4;
const FLUSH_MS = 5 * 60000;     // the casino's money kept in memory at most this long

export function createCorp({ q, tx, afterCommit, clock = Date.now, secret, history = 2, opsIds = () => [], live = null, onDay = () => {} }) {
  // the country of people (server/core/npc.js), once it is there: its money of each day, and what the day paid out to it
  let npc = null;
  const key = keyFrom(secret, 'corp'), ch = model.chance(key);
  const listed = CORP.listed().map((c) => c.id);
  const base = new Map(STOCKS.companies.map((c) => [c.id, c.base]));
  let world = null, stale = true;
  const anchors = new Map();

  /* ------------------------------------------------------------- the world --- */
  function load() {
    const rows = q('SELECT id, data FROM corp_state').all();
    if (!rows.length) return null;
    const w = { co: {} };
    for (const r of rows) {
      if (r.id === 'world') Object.assign(w, JSON.parse(r.data));
      else w.co[r.id] = JSON.parse(r.data);
    }
    w.co = w.co || {};
    return w;
  }
  function get() {
    if (stale) { world = load(); stale = false; }
    return world;
  }
  // a change to the world: kept in the database in the same transaction, and in memory once that commits
  function change(fn, ids) {
    const w = get();
    stale = true;
    const out = fn(w);
    const { co, ...rest } = w;
    q('INSERT INTO corp_state (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run('world', JSON.stringify(rest));
    for (const id of ids || Object.keys(co)) q('INSERT INTO corp_state (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(id, JSON.stringify(co[id]));
    afterCommit(() => { stale = false; });
    return out;
  }
  const booted = () => !!get();

  // The beginning, on the day of second `sec`: the made-up past written once (its months, quarters and years, its
  // games and news, its last days), a listed company's shares counted so that its book price is the market's
  // starting price (so the price goes on from where it is: server/core/stocks.js), and that day's dividend a share.
  function ensure(sec) {
    if (booted()) { migrate(); return; }
    const launch = Math.floor(sec / DAY);
    const { world: w, history: h } = model.boot(key, launch, { years: history, prices: Object.fromEntries(base) });
    world = w;
    stale = true;
    const { co, ...rest } = w;
    q('INSERT INTO corp_state (id, data) VALUES (?, ?)').run('world', JSON.stringify(rest));
    for (const id of Object.keys(co)) q('INSERT INTO corp_state (id, data) VALUES (?, ?)').run(id, JSON.stringify(co[id]));
    write({ ...h, anchors: [], days: h.days.filter((r) => r.day >= launch - KEEP_DAYS) });
    for (const id of listed) {
      const s = co[id];
      if (!s) continue; // (founded later — HACHI —: its first anchor its founding day's close)
      const b = Math.log(base.get(id));
      q('INSERT OR REPLACE INTO corp_anchor (company, day, e0, e1, ev, dps) VALUES (?, ?, ?, ?, ?, ?)').run(id, launch, b, b, '[]', s.div.daily || 0);
    }
    afterCommit(() => { stale = false; });
  }
  // A company the rules have that the world kept does not (one added later: YOSIDA): set in from its own made-up
  // past, the others' terms with it found again, its rows written, a listed one's price centre where its base is.
  function migrate() {
    const w0 = get();
    if (!w0.fixes || !w0.fixes.tax) {
      const fixed = change((w) => model.repairTaxes(w));
      if (fixed.length) console.log('corp: taxes put right', fixed.map((x) => `${x.id} ${x.n}`).join(', '));
    }
    if (!w0.fixes || !w0.fixes.affil) {
      const fixed = change((w) => model.repairStakes(w));
      if (fixed.length) console.log('corp: stakes carried', fixed.map((x) => `${x.id} ${x.n}`).join(', '));
    }
    // (a company founded on its day — HACHI —: never added with a made-up past, corp-model closeDay founds it)
    if (CORP.companies.every((p) => p.founded || w0.co[p.id])) return;
    const r = change((w) => model.addCompanies(key, w, Object.fromEntries(base)));
    if (!r) return;
    write({ ...r.history, anchors: [] });
    const w = get() || world;
    for (const id of r.added) {
      if (!listed.includes(id)) continue;
      const b = Math.log(base.get(id) || 10000);
      q('INSERT OR REPLACE INTO corp_anchor (company, day, e0, e1, ev, dps) VALUES (?, ?, ?, ?, ?, ?)').run(id, w.day + 1, b, b, '[]', w.co[id].div.daily || 0);
    }
    console.log('corp: added', r.added.join(', '));
  }
  function write(out) {
    const put = {
      day: q('INSERT INTO corp_days (company, day, data) VALUES (?, ?, ?) ON CONFLICT(company, day) DO UPDATE SET data = excluded.data'),
      period: q('INSERT INTO corp_periods (company, kind, key, day, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(company, kind, key) DO UPDATE SET day = excluded.day, data = excluded.data'),
      title: q('INSERT INTO corp_titles (company, id, data) VALUES (?, ?, ?) ON CONFLICT(company, id) DO UPDATE SET data = excluded.data'),
      news: q('INSERT INTO corp_news (company, at, kind, text, data, public) VALUES (?, ?, ?, ?, ?, ?)'),
      anchor: q('INSERT OR REPLACE INTO corp_anchor (company, day, e0, e1, ev, dps) VALUES (?, ?, ?, ?, ?, ?)')
    };
    for (const r of out.days) { const { company, day, ...data } = r; put.day.run(company, day, JSON.stringify(data)); }
    for (const r of out.periods) put.period.run(r.company, r.kind, r.key, r.to, JSON.stringify(r));
    for (const r of out.titles) put.title.run(r.company, r.id, JSON.stringify(r));
    for (const r of out.news) put.news.run(r.company, r.at, r.kind, r.text, JSON.stringify(r.data || {}), r.public ? 1 : 0);
    for (const a of out.anchors) {
      put.anchor.run(a.company, a.day, a.e0, a.e1, JSON.stringify(a.ev), a.dps);
      anchors.delete(a.company + ':' + a.day);
    }
  }

  /* ------------------------------------------------------------- the days --- */
  // the second the next day closes at (its end), and its closing: the day's own players' money, every company's
  // operations, what it writes, and the word to whoever has the 投資 screen or the operator site open
  const closesAt = () => (get() ? (get().day + 2) * DAY : Infinity);
  // (`extra`: the day's flows the players' side settles as it closes — their dividends of it, '@div':
  // server/core/stocks.js settleDay)
  function close(extra = null) {
    let d = 0;
    flush();
    const day = get().day + 1;
    // (the people's last minutes of the day first, and their money of it)
    const c0 = get().circ;
    const people = npc && c0 && day >= c0.from ? npc.beforeClose(day) : null;
    const out = change((w) => {
      d = w.day + 1;
      const row = q('SELECT data FROM corp_flows WHERE day = ?').get(d);
      const flows = row ? JSON.parse(row.data) : {};
      if (extra) Object.assign(flows, extra);
      if (people) flows.npc = people;
      // (everyone's money as the day closes: the players' $ and the people's deposits; the economy follows it)
      flows.wealth = (q("SELECT COALESCE(SUM(MAX(dollars, 0)), 0) AS n FROM users WHERE npc = ''").get().n || 0) + (people && people.bank ? Math.max(0, Math.round(people.bank.deposits || 0)) : 0);
      return model.closeDay(w, d, flows, ch);
    });
    write(out);
    if (npc && out.ext) npc.afterClose(d, out);
    afterCommit(() => {
      try {
        for (const id of opsIds()) if (live) live.sendOps(id, 'corp', { day: d });
        onDay(out);
      } catch (e) { console.error('corp notice failed', e); }
    });
    return out;
  }
  // the share price's centre on day `day` (the log of it at the day's start and end, the moves of the day: [second,
  // jump]), and the dividend a share for each second of it (null before the company system began)
  function anchor(id, day) {
    const k = id + ':' + day;
    if (anchors.has(k)) return anchors.get(k);
    const r = q('SELECT e0, e1, ev, dps FROM corp_anchor WHERE company = ? AND day = ?').get(id, day);
    const a = r ? { e0: r.e0, e1: r.e1, ev: JSON.parse(r.ev), dps: r.dps } : null;
    if (anchors.size > 64) anchors.clear();
    anchors.set(k, a);
    return a;
  }
  const dps = (id, day) => { const a = anchor(id, day); return a ? a.dps : null; };

  /* ------------------------------------------------------ the players' money --- */
  // the day's row of what the players spent where ({ company: { kind: $ or { item: [count, $] } }, job: $ })
  function bump(fn) {
    flush();
    const day = Math.floor(clock() / 86400000);
    const row = q('SELECT data FROM corp_flows WHERE day = ?').get(day);
    const data = row ? JSON.parse(row.data) : {};
    fn(data);
    q('INSERT INTO corp_flows (day, data) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data').run(day, JSON.stringify(data));
  }
  // money spent at a company (the バイト's wages: company '*'), and products bought (cars, Shop items)
  function flow(company, kind, amount) {
    if (!(amount > 0)) return;
    bump((data) => {
      if (company === '*') { data[kind] = (data[kind] || 0) + amount; return; }
      const c = data[company] || (data[company] = {});
      c[kind] = (c[kind] || 0) + amount;
    });
  }
  // Money that comes with every spin (the casino's: Dtrade's), kept in memory once the spin is saved and written
  // into its day's row with the next of the above, or every few minutes, and always before the day closes: a spin
  // writes no row of its own. (What a restart loses is at most those minutes of it, never a player's money.)
  const pending = new Map();   // day -> { company: { kind: $ } }
  let pendingSince = 0;
  function tally(company, kind, amount) {
    if (!(amount > 0)) return;
    const day = Math.floor(clock() / 86400000);
    const data = pending.get(day) || (pending.set(day, {}), pending.get(day));
    const c = data[company] || (data[company] = {});
    c[kind] = (c[kind] || 0) + amount;
    if (!pendingSince) pendingSince = clock();
    else if (clock() - pendingSince >= FLUSH_MS) tx(flush);
  }
  function flush() {
    if (!pending.size) return;
    const days = [...pending.entries()];
    pending.clear();
    pendingSince = 0;
    for (const [day, add] of days) {
      const row = q('SELECT data FROM corp_flows WHERE day = ?').get(day);
      const data = row ? JSON.parse(row.data) : {};
      for (const [company, kinds] of Object.entries(add)) {
        const c = data[company] || (data[company] = {});
        for (const [k, v] of Object.entries(kinds)) c[k] = (c[k] || 0) + v;
      }
      q('INSERT INTO corp_flows (day, data) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data').run(day, JSON.stringify(data));
    }
  }
  // What crossed between the players and the country that the country has not booked yet (the money ledger's, as
  // a day `day` closes): the flows of the days after it (their rows and the spins' kept in memory) and the shares
  // traded since (server/core/corp-model.js crossingsOf)
  function unbooked(day) {
    let inn = 0, out = 0;
    const add = (data) => { const c = model.crossingsOf(data); inn += c.in; out += c.out; };
    for (const r of q('SELECT data FROM corp_flows WHERE day > ?').all(day)) add(JSON.parse(r.data));
    for (const [d, data] of pending) if (d > day) add(data);
    const w = get(), c = (w && w.cross) || { in: 0, out: 0 };
    return { in: inn + (c.in || 0), out: out + (c.out || 0) };
  }
  function sold(company, kind, id, count, paid) {
    if (!(count > 0)) return;
    bump((data) => {
      const c = data[company] || (data[company] = {}), k = c[kind] || (c[kind] = {});
      const was = k[id] || [0, 0];
      k[id] = [was[0] + count, was[1] + paid];
    });
  }
  // What YOSIDA's gacha gave away (server/core/gacha.js: { lot: tokens, royal, garage, vip, tree, cars: { id: n } }),
  // what it costs YOSIDA booked as the day closes (server/core/corp-model.js prizes)
  function prize(got) {
    const any = Object.entries(got || {}).some(([k, v]) => (k === 'cars' ? Object.values(v).some((n) => n > 0) : v > 0));
    if (!any) return;
    bump((data) => {
      const p = data['@prize'] || (data['@prize'] = {});
      for (const [k, v] of Object.entries(got)) {
        if (k === 'cars') { const c = p.cars || (p.cars = {}); for (const [id, n] of Object.entries(v)) if (n > 0) c[id] = (c[id] || 0) + n; }
        else if (v > 0) p[k] = (p[k] || 0) + v;
      }
    });
  }
  // what a company bought back of the gacha's prizes from a player (server/core/gacha.js sell): { company: { kind: [n, $] } }
  function rebuy(company, kind, n, paid) {
    if (!(paid > 0)) return;
    bump((data) => { const r = data['@rebuy'] || (data['@rebuy'] = {}), c = r[company] || (r[company] = {}), was = c[kind] || [0, 0]; c[kind] = [was[0] + n, was[1] + paid]; });
  }
  // the ロイヤルコイン DAIZIN bought back from a player, and what it paid for them
  function coinsBought(n, paid) {
    if (!(n > 0)) return;
    bump((data) => { const c = data['@coins'] || (data['@coins'] = { n: 0, paid: 0 }); c.n += n; c.paid += paid; });
  }
  // YOSIDA's fee on the quests' rewards this month (CORP.yosida.quest)
  const questFee = () => model.questFeeOf(get());
  // MAGITA's surcharge on each car while it struggles (the Car Owner price: server/core/api.js), { carId: $ }
  const surcharges = () => { const w = get(); return w ? model.surcharges(w) : {}; };
  const surcharge = (id) => surcharges()[id] || 0;
  // MAGITA Garage's fee a garage place this month (MAGITA sets it at each month's end: server/core/corp-model.js), and
  // whether that month has closed into the world yet (a bill waits for it)
  const garageFee = () => model.garageFeeOf(get());
  const garageReady = (day) => { const w = get(); return !w || w.day >= day - 1; };
  // MY WAY now (its characters, its contracts, whether it failed), for the screens; and whether a company was struck
  // off (it failed: its shares are no longer traded)
  function ipView(w) {
    const s = w && w.co.myway;
    if (!s || !s.ip) return null;
    const ip = s.ip;
    return {
      heat: Math.round(ip.heat * 1000) / 1000, brand: Math.round(ip.brand * 1000) / 1000, fakes: Math.round(ip.fakes * 1000) / 1000,
      pull: Math.round(ip.heat * ip.brand * 1000) / 1000, lastNew: ip.lastNew, chars: ip.chars.slice(-8), ideas: ip.ideas, events: ip.events.slice(-20),
      // (each one's fee a year at its size — 契約規模 —, the size, Tenesice's 超大型, the day's last talk)
      contracts: Object.entries(ip.contracts).map(([id, c]) => ({ id, name: CORP.company(id).name, what: CORP.myway.partners[id].what, fee: model.contractFee(c), base: c.base, scale: c.scale || 1, huge: !!c.huge, range: CORP.scaleRange(id), on: c.on, from: c.from, until: c.until || null,
        last: c.last, talk: c.talk || null, breakeven: Math.round(CORP.breakeven(id, c.fee) * 1000) / 1000 })),
      talks: ip.talks || null,
      // (its contracts with the local companies and the two countries: server/core/npc-ipdeals.js)
      deals: npc && npc.ipDeals ? npc.ipDeals() : null,
      // (its growth: what it put beyond its equity's aim into its economy, its bubble's loans, its ads, YAMATO)
      grow: s.grow ? { ...s.grow, hist: s.grow.hist.slice(-12), bubble: model.mywayBubble(w, s) } : { bubble: model.mywayBubble(w, s), hist: [] },
      careCut: s.careCut || 0, dead: s.dead || null
    };
  }
  // the game's businesses: each with who runs it now ('local:<firm>': a local company; null: a failed company's trustee,
  // or nobody until it is sold again), since when, what it was bought for, its bids, who ran it before
  // a runner's name: one of the thirteen's ids as it is, a local company's ('local:<id>') its name
  const runnerName = (by) => (by && by.startsWith('local:') ? ((LOCAL && LOCAL.firm(by.slice(6))) || {}).name || by.slice(6) : null);
  function opsView(w) {
    const ops = model.opsOf(w);
    return CORP.features.map((f) => { const o = ops[f.id]; return { id: f.id, name: f.name, owner: f.owner, by: o.by, byName: runnerName(o.by), since: o.since, price: o.price || 0, from: o.from || null, estate: o.estate || null,
      orphan: o.orphan || null, bids: o.bids || [], history: o.history || [], day: Math.round((w.opRev || {})[f.id] || 0) }; });
  }
  // (failed, or a bank put under the state — 一時国有化: its shares struck off, worth nothing)
  const delisted = (id) => { const w = get(); return !!(w && w.co[id] && (w.co[id].dead || w.co[id].reorg)); };
  // a listed company's shares traded by a player at second `sec` (new shares or its own bought back), and the
  // fee, Dtrade's
  // (all of it the company's: a buy is new shares, the money into its funds; a sale its own bought back, the money
  // out of its funds — never the people's waiting orders)
  // (a company not founded yet — HACHI before 2026-11-04 —: not listed yet)
  const notYet = (id) => { const w = get(); return !!(w && !w.co[id]); };
  function traded(id, side, shares, price, fee, sec) {
    if (!booted() || !listed.includes(id) || delisted(id) || notYet(id)) return;
    change((w) => model.trade(w, id, side, shares, price, sec), [id]);
    flow('dtrade', 'trade', fee);
  }
  // the day the companies begin to live on the country's money (the next they close)
  function startCirculation(day, scale) {
    change((w) => model.startCirculation(w, Math.max(day, w.day + 1), scale));
  }

  /* -------------------------------------------------------------- what is shown --- */
  const latestQuarter = (id, now) => {
    for (const r of q("SELECT data FROM corp_periods WHERE company = ? AND kind = 'q' ORDER BY day DESC LIMIT 3").all(id)) {
      const p = JSON.parse(r.data);
      if (!p.announce || p.announce * 1000 <= now) return p;
    }
    return null;
  };
  const publicNews = (id, now, n) => q('SELECT at, kind, text FROM corp_news WHERE company = ? AND public = 1 AND at <= ? ORDER BY at DESC, id DESC LIMIT ?').all(id, Math.floor(now / 1000), n);
  // The 投資 screen's view of the listed companies: the last published quarter (against a year before), the year's
  // guidance and the dividend it carries, the per-share figures, the next 決算発表, and the latest news.
  function view(now = clock()) {
    const w = get();
    if (!w) return null;
    const out = {};
    for (const id of listed) {
      // (founded on its day — HACHI before 2026-11-04 —: its listing to come, no trading until then)
      if (!w.co[id]) {
        const p = model.PROFILES.get(id);
        if (p && p.founded) out[id] = { name: p.name, full: p.full, rank: p.rank, kind: p.kind, staff: 0, shares: 0, eps: 0, bps: 0, dps: 0, last: null, guide: null, next: null, news: [], soon: { day: CORP.dayAt(...p.founded) } };
        continue;
      }
      const s = w.co[id], p = model.PROFILES.get(id), last = latestQuarter(id, now);
      const quarters = q("SELECT data FROM corp_periods WHERE company = ? AND kind = 'q' ORDER BY day DESC LIMIT 6").all(id).map((r) => JSON.parse(r.data)).filter((x) => !x.announce || x.announce * 1000 <= now).slice(0, 4);
      const shares = model.outstanding(s);
      // (the next 決算発表: one waiting, or the running quarter's, two weeks after it ends)
      const fy = CORP.fyOf(w.day + 1), qn = CORP.quarterOf(w.day + 1);
      const next = s.pend.filter((x) => x.kind === 'results').map((x) => x.day * DAY + CORP.announce.hour * 3600).sort((a, b) => a - b)[0] ||
        (CORP.quarterEnd(fy, qn) + CORP.announce.days) * DAY + CORP.announce.hour * 3600;
      out[id] = {
        name: p.name, full: p.full, rank: p.rank, kind: p.kind, staff: s.n, shares,
        eps: Math.round(quarters.reduce((n, x) => n + x.pl.net, 0) / Math.max(1, shares)),
        bps: Math.round(model.equityOf(s) / Math.max(1, shares)), dps: s.div.dps,
        last: last ? { key: last.key, label: last.label, sales: last.pl.sales, op: last.pl.op, ord: last.pl.ord, net: last.pl.net, eps: Math.round(last.eps), prev: last.prev } : null,
        guide: s.guide ? { fy: s.guide.fy, sales: s.guide.sales, op: s.guide.op, ord: s.guide.ord, net: s.guide.net, eps: s.guide.eps, dps: s.guide.dps } : null,
        next, news: publicNews(id, now, PUBLIC_NEWS),
        // (struck off: it failed; MY WAY's partner: its contract with it)
        ...(s.dead ? { delisted: { day: s.dead.day, why: s.dead.why } } : s.reorg ? { delisted: { day: s.reorg.day, why: s.reorg.why } } : {}),
        ...(id === 'myway' && s.ip ? { ip: { heat: Math.round(s.ip.heat * 100) / 100, brand: Math.round(s.ip.brand * 100) / 100, partners: Object.values(s.ip.contracts).filter((c) => c.on).length } } : {}),
        ...(w.co.myway && w.co.myway.ip && w.co.myway.ip.contracts[id] && w.co.myway.ip.contracts[id].on && !w.co.myway.dead ? { collab: true } : {})
      };
    }
    return out;
  }

  /* ----------------------------------------------------- the operator site --- */
  const rows = (sql, ...args) => q(sql).all(...args).map((r) => JSON.parse(r.data));
  function summary(id, now) {
    const w = get(), s = w.co[id], p = model.PROFILES.get(id);
    const shares = model.outstanding(s), fair = model.fairValue(s, p, w) / Math.max(1, shares);
    const years = rows("SELECT data FROM corp_periods WHERE company = ? AND kind = 'y' ORDER BY day DESC LIMIT 1", id);
    const quarters = rows("SELECT data FROM corp_periods WHERE company = ? AND kind = 'q' ORDER BY day DESC LIMIT 4", id);
    const ttm = { sales: 0, op: 0, net: 0 };
    for (const x of quarters) { ttm.sales += x.pl.sales; ttm.op += x.pl.op; ttm.net += x.pl.net; }
    const players = q('SELECT data FROM corp_flows WHERE day >= ?').all(Math.floor(now / 86400000) - 30)
      .reduce((n, r) => n + spentAt(JSON.parse(r.data), id), 0);
    // (what the people spent there in the last 30 days closed)
    const people = peopleSpent(id, now);
    return {
      id, name: p.name, full: p.full, en: p.en, kind: p.kind, rank: p.rank, model: p.model, listed: !!p.listed,
      staff: s.n, cash: s.bal.cash || 0, bonds: s.bal.bonds || 0, debt: s.loans.reduce((n, l) => n + l.amt, 0), equity: model.equityOf(s),
      retained: s.bal.retained, capital: s.bal.capital, ttm, year: years[0] ? { key: years[0].key, label: years[0].label, pl: years[0].pl } : null,
      fair: Math.round(fair), shares, dps: s.div.dps, guide: s.guide ? { fy: s.guide.fy, sales: s.guide.sales, op: s.guide.op, net: s.guide.net } : null,
      players, people, parent: p.parent || null, abroad: !!p.abroad, dead: s.dead || null, bk: s.bk ? { ...s.bk, sold: (s.bk.sold || []).map((x) => ({ ...x, toName: runnerName(x.to) })) } : null, runs: model.runs(w, id), goodwill: s.goodwill || [],
      // (Tenesice's rank for it as its lending desk last read its books)
      creditRank: (w.lend && w.lend[id] && w.lend[id].rank) || p.rank, loanRate: w.lend && w.lend[id] ? w.lend[id].rate : null,
      collab: !!(w.co.myway && w.co.myway.ip && w.co.myway.ip.contracts[id] && w.co.myway.ip.contracts[id].on && !w.co.myway.dead),
      // (the district of the country its head office is in)
      hq: ((NPC.districts.find((d) => d.hq.includes(id)) || {}).name) || '',
      news: q('SELECT at, kind, text FROM corp_news WHERE company = ? AND at <= ? ORDER BY at DESC, id DESC LIMIT 3').all(id, Math.floor(now / 1000))
    };
  }
  // what the people spent at a company in the last `n` days closed (the day rows', server/core/corp-model.js)
  function peopleSpent(id, now, n = 30) {
    return q('SELECT data FROM corp_days WHERE company = ? AND day >= ?').all(id, Math.floor(now / 86400000) - n)
      .reduce((a, r) => a + (JSON.parse(r.data).npc || 0), 0);
  }
  // …every company's, for the players' 街ライブ ({ company: $ })
  function npcSpent(now = clock(), n = 30) {
    const w = get(), out = {};
    if (!w) return out;
    for (const c of CORP.companies) if (w.co[c.id]) out[c.id] = peopleSpent(c.id, now, n);
    return out;
  }
  // what the players spent at a company on a day's row
  function spentAt(data, id) {
    const c = data[id] || {};
    let n = 0;
    for (const v of Object.values(c)) n += typeof v === 'number' ? v : Object.values(v).reduce((a, x) => a + x[1], 0);
    if (CORP.company(id).jobs && data.job) n += Math.round(data.job * CORP.players.jobFee);
    return n;
  }
  function tiesOf(w, id) {
    return model.ties().filter((t) => !id || t.a === id || t.b === id).map((t) => ({ a: t.a, b: t.b, start: t.start, why: t.why, now: model.tieOf(w, t.a, t.b) }));
  }
  // The products a seller sells or a maker makes: each at its price, what it costs, the 仕入れ価格 and the
  // 専売特別費用, what the seller keeps (販売店側純利益) and the maker (材料のみの原価 against what it is paid), with
  // what sold of it in the last month and the last year.
  function products(id) {
    const out = [];
    const months = rows("SELECT data FROM corp_periods WHERE company = ? AND kind = 'm' ORDER BY day DESC LIMIT 12", id);
    const tally = (pid) => months.reduce((t, m, i) => {
      const x = (m.products || {})[pid];
      if (x) { t.year.npc += x.npc; t.year.players += x.players; t.year.sales += x.sales; if (i === 0) t.month = { ...x }; }
      return t;
    }, { month: null, year: { npc: 0, players: 0, sales: 0 } });
    // (MAGITA's research cuts what its products cost it; its surcharge, while it struggles, is on the 仕入れ価格 and
    // the price both)
    const w = get(), lab = w && w.co.magita && w.co.magita.lab ? w.co.magita.lab.mult : 1, extra = surcharges();
    for (const kind of ['cars', 'items']) {
      const list = kind === 'cars' ? RULES.cars : RULES.shop;
      for (const item of list) {
        const pr = CORP.products[kind][item.id];
        if (!pr) {
          if (kind === 'cars' && id === 'carowner') out.push({ kind, id: item.id, name: item.name, price: item.price, ended: !!item.ended, maker: 'magita' });
          continue;
        }
        const seller = kind === 'cars' ? 'carowner' : 'jinx';
        if (id !== seller && id !== pr.maker) continue;
        const own = pr.maker === seller, add = extra[item.id] || 0;
        const cost = pr.maker === 'magita' ? Math.round(pr.cost * lab) : pr.cost, buy = pr.buy + add;
        out.push({
          kind, id: item.id, name: item.name, price: item.price + add, ended: !!item.ended, maker: pr.maker, seller, cost, baseCost: pr.cost, surcharge: add,
          buy: own ? null : buy, excl: own ? null : (pr.excl || 0), sellerNet: item.price + add - (own ? cost : buy + (pr.excl || 0)),
          // (a collaboration car: MY WAY's share of the maker's profit on it off the maker's — MAGITA 4:6, YOSIDA 3:7)
          makerNet: own ? null : Math.round((buy + (pr.excl || 0) - cost) * (1 - (pr.collab ? pr.collab.share : 0))),
          collab: pr.collab ? { with: pr.collab.with, share: pr.collab.share, n: Math.round(Math.max(0, buy + (pr.excl || 0) - cost) * pr.collab.share) } : null,
          selling: CORP.products.sell[kind], npc: pr.npc, ...tally(item.id)
        });
      }
    }
    return out;
  }
  // a company's days as columns (the charts)
  function days(id, from) {
    const list = q('SELECT day, data FROM corp_days WHERE company = ? AND day >= ? ORDER BY day').all(id, from);
    const cols = { day: [], sales: [], op: [], net: [], other: [], invest: [], back: [], cash: [], debt: [], equity: [], staff: [], fair: [], econ: [], players: [], npc: [] };
    for (const r of list) {
      const x = JSON.parse(r.data);
      cols.day.push(r.day);
      for (const k of Object.keys(cols)) if (k !== 'day') cols[k].push(x[k] || 0);
    }
    return cols;
  }
  function detail(id, now) {
    const w = get(), s = w.co[id], p = model.PROFILES.get(id);
    const studio = p.model === 'studio';
    return {
      profile: p,
      summary: summary(id, now),
      state: {
        bal: s.bal, staff: s.n, pay: s.pay, unit: s.unit, morale: Math.round(s.morale * 100) / 100, target: s.target, budget: s.budget,
        tech: studio ? Math.round(s.tech * 1000) / 1000 : null, brand: studio ? Math.round(s.brand * 1000) / 1000 : null,
        loans: s.loans, shares: { issued: s.sh.issued, treasury: s.sh.treasury, founders: s.sh.founders, out: model.outstanding(s) },
        holders: s.hold, dividend: s.div, guide: s.guide, tax: { carry: s.tax.carry, last: s.tax.last, year: s.tax.year || null, booked: s.tax.booked },
        backing: s.backing || null, used: (s.used || []).length
      },
      quarters: rows("SELECT data FROM corp_periods WHERE company = ? AND kind = 'q' ORDER BY day", id),
      years: rows("SELECT data FROM corp_periods WHERE company = ? AND kind = 'y' ORDER BY day", id),
      months: rows("SELECT data FROM corp_periods WHERE company = ? AND kind = 'm' ORDER BY day DESC LIMIT 24", id).reverse(),
      days: days(id, Math.floor(now / 86400000) - 400),
      products: products(id),
      projects: studio ? s.projects.map((pr) => ({ id: pr.id, name: pr.name, genre: pr.genre, line: pr.line, start: pr.start, due: pr.due, prog: Math.round(pr.prog * 1000) / 1000, spent: pr.spent, delays: pr.delays, sequel: pr.sequel })) : [],
      titles: studio ? s.titles.map((t) => ({ id: t.id, name: t.name, genre: t.genre, line: t.line, day: t.day, q: t.q, cost: t.cost, book: t.book, sold: t.sold, units: t.units, est: Math.round(t.est), first: Math.round(t.first), hit: t.hit })) : [],
      archive: studio ? rows('SELECT data FROM corp_titles WHERE company = ?', id).filter((t) => t.ended).sort((a, b) => b.day - a.day).slice(0, 40) : [],
      live: studio ? (s.live || []).map((l) => ({ name: l.name, genre: l.genre, rate: Math.round(l.rate), until: l.until, next: l.next })) : [],
      catalog: studio ? Math.round(s.catalog) : 0,
      lab: s.lab ? { mult: s.lab.mult, speed: s.lab.speed, list: s.lab.list.map((r) => ({ ...r, ...CORP.magita.research.find((x) => x.id === r.id) })) } : null,
      surcharge: id === 'magita' ? (s.surcharge || 0) : undefined,
      garageFee: id === 'magita' ? model.garageFeeOf(w) : undefined,
      // MAGITA's child and what its research cut; WAZIMA's research and its months paid up to its parent
      save: s.save || null, children: (p.children || []).filter((c) => w.co[c]).map((c) => ({ id: c, name: CORP.company(c).name, toParent: w.co[c].toParent || null })),
      subAvg: s.subAvg || 0, parent: p.parent || null, toParent: s.toParent || null,
      wlab: s.wlab ? { list: s.wlab.list, save: (w.co[p.parent] && w.co[p.parent].save) || null } : null,
      // YOSIDA's businesses in the game and the money tree seeds; DAIZIN's buying back (by the month)
      biz: s.biz || null, seeds: s.seeds || null,
      questFee: id === 'yosida' ? model.questFeeOf(w) : undefined, vipWeek: id === 'yosida' ? model.vipWeekOf(w) : undefined,
      // (what the site says as it is now, not as the rules began: the dividends' share of the profit this year, the
      // gacha's slots and what a VIP1週間券 is bought back for, MAGITA's surcharge, Tenesice's terms with each company)
      facts: {
        payout: s.guide && s.guide.payout !== undefined ? s.guide.payout : model.payoutOf(p, w),
        gachaSlots: GACHA.slots, vipSell: GACHA.sell['vip-week'], sell: GACHA.sell, coinBuy: RULES.vip.buyback.each,
        surchargeAmt: id === 'magita' ? (s.surchargeAmt || CORP.magita.surcharge.amount) : undefined,
        lend: p.model === 'bank' ? Object.entries(w.lend || {}).filter(([c]) => w.co[c] && !w.co[c].dead).map(([c, x]) => ({ id: c, name: CORP.company(c).name, rate: x.rate, cap: x.cap, rank: x.rank || 'A', owed: w.co[c].loans.reduce((n, l) => n + l.amt, 0) })) : undefined,
        bubble: id === 'myway' ? model.mywayBubble(w, s) : undefined
      },
      gov: id === 'yosida' ? (w.gov || null) : undefined,
      // its people's pay against the market's, its last review, the people it took from others and lost to them
      wage: npc && npc.wageOf ? npc.wageOf(id) : null,
      // its development work (技術開発): the one under way, the last done, and what they have won it
      tech: s.rnd ? { edge: Math.round(s.rnd.edge * 1000) / 1000, ok: s.rnd.ok, n: s.rnd.n, cur: s.rnd.cur, last: s.rnd.last || null, chance: techChance(s, p) } : { edge: 1, ok: 0, n: 0, cur: null, last: null, chance: techChance(s, p) },
      cut: s.cut || null, target: s.target, abroad: !!p.abroad,
      // MY WAY's characters and licences (its own site), or this partner's contract with it
      ip: id === 'myway' ? ipView(w) : null,
      // HACHI's wards (both countries'), its months, its research with アスカ国 and FIGMA's equipment, the state's hand
      hachi: id === 'hachi' && s.hachi ? { wards: s.hachi.wards, last: s.hachi.last, hist: s.hachi.hist, state: s.hachi.state, research: s.hachi.research, figma: s.hachi.figma, busy: s.hachi.busy || 0, patients: s.hachi.patients || {}, asukaStaff: s.hachi.asukaStaff || 0, asukaPay: s.hachi.asukaPay || 0, opened: s.hachi.opened, closed: s.hachi.closed, founded: s.hachi.founded, rules: CORP.hachi,
        credit: s.hachi.credit || 0, line: s.loans.filter((l) => l.line).reduce((n, l) => n + l.amt, 0), tax: Math.round(s.per.y['r:tax'] || 0) } : null,
      license: w.co.myway && w.co.myway.ip && w.co.myway.ip.contracts[id] ? { ...w.co.myway.ip.contracts[id], fee: model.contractFee(w.co.myway.ip.contracts[id]), scale: w.co.myway.ip.contracts[id].scale || 1, name: CORP.company('myway').name, what: CORP.myway.partners[id].what, breakeven: CORP.breakeven(id, w.co.myway.ip.contracts[id].fee), dead: !!w.co.myway.dead } : null,
      news: q('SELECT at, kind, text, public FROM corp_news WHERE company = ? AND at <= ? ORDER BY at DESC, id DESC LIMIT 100').all(id, Math.floor(now / 1000)),
      ties: tiesOf(w, id),
      flows: q('SELECT day, data FROM corp_flows WHERE day >= ? ORDER BY day').all(Math.floor(now / 86400000) - 30).map((r) => ({ day: r.day, spent: spentAt(JSON.parse(r.data), id) }))
    };
  }

  // A company's business day so far (9:00 to 9:00 Japan time, closed at its end): what the whole day is expected to
  // bring as its managers see it now (server/core/corp-model.js expectDay), what the players and the people usually
  // spend there in a day (the last 30 closed), and what they have actually spent today — the day's row, what waits in
  // memory, the people's money waiting for the close. The site works the running figures out from them every second.
  function today(id, now = clock()) {
    const w = get();
    if (!w || !w.co[id]) return null;
    const s = w.co[id], p = model.PROFILES.get(id), day = Math.floor(now / 86400000);
    const pl = CORP.plOf(model.expectDay(w, s, p, day));
    const recent = q('SELECT data FROM corp_days WHERE company = ? AND day >= ?').all(id, day - 30).map((r) => JSON.parse(r.data));
    const usual = recent.length ? Math.round(recent.reduce((n, x) => n + (x.players || 0) + (x.npc || 0), 0) / recent.length) : 0;
    const row = q('SELECT data FROM corp_flows WHERE day = ?').get(day), mem = pending.get(day);
    const players = (row ? spentAt(JSON.parse(row.data), id) : 0) + (mem ? spentAt(mem, id) : 0);
    const people = npc && npc.spentToday ? npc.spentToday(day, id) : 0;
    // the money put into it today (the players' buying of its shares: new ones or its own sold again) and taken out
    // (their selling: its own bought back), as it came; its other gains (営業外収益・特別利益: interest and dividends
    // received, its child's profit, support, gains on what it sold) as a usual day of the last 30 brings them
    const live = s.liveIn && s.liveIn.day === day ? s.liveIn : null;
    const seen = recent.filter((x) => x.other !== undefined);
    const other = seen.length ? Math.round(seen.reduce((n, x) => n + x.other, 0) / seen.length) : Math.round((pl.noi || 0) + (pl.xi || 0));
    return { day, start: day * 86400000, plan: { sales: Math.round(pl.sales), op: Math.round(pl.op), net: Math.round(pl.net), other: Math.round((pl.noi || 0) + (pl.xi || 0)) }, usual, players, people,
      invest: live ? live.in : 0, back: live ? live.out : 0, other, closed: w.day };
  }
  // 企業の本当のリアルタイム稼ぎ: six companies' hours (MY WAY, ICE SMOKER, RIRU, MAGITA, YOSIDA, Tenesice), each as it
  // ends — what the players and the people actually paid it in that hour (their money of the day so far against the
  // hour before's), and its trade with the other companies (IP fees, sales to the dealer …) and its costs, which the
  // books only know as the day closes, at an hour of the last day closed; what it earned the hour, all of them
  // together. Hours the server slept through share what came in them evenly. Kept two weeks.
  const HOURLY = ['myway', 'ice', 'riru', 'magita', 'yosida', 'tenesice'];
  const HOUR = 3600000, KEEP_HOURS = 14 * 24;
  let hourAt = null;
  function hourTick(now = clock()) {
    const w = get(), h = Math.floor(now / HOUR);
    if (!w || hourAt === h) return;
    tx(() => {
      for (const id of HOURLY) {
        if (!w.co[id]) continue;
        // (each company's hour on its own: one that cannot be worked out keeps none of the others from theirs)
        try { hourOf(id, h, now); } catch (e) { console.error('corp hours failed', id, e); }
      }
      q('DELETE FROM corp_hours WHERE hour < ?').run(h - KEEP_HOURS);
    });
    hourAt = h;
  }
  function hourOf(id, h, now) {
    const last = q('SELECT hour, data FROM corp_hours WHERE company = ? ORDER BY hour DESC LIMIT 1').get(id);
    const prev = last ? JSON.parse(last.data) : null;
    if (last && last.hour >= h - 1) return;
    const t = today(id, now), cum = (t.players || 0) + (t.people || 0), cumP = t.players || 0;
    // (the day just closed: what it ended at, for a snapshot of it before its end)
    const ended = (d) => { const r = q('SELECT data FROM corp_days WHERE company = ? AND day = ?').get(id, d); const x = r ? JSON.parse(r.data) : null; return x ? { all: (x.players || 0) + (x.npc || 0), players: x.players || 0 } : null; };
    // (the first hour kept: where the counting starts, nothing in it known yet)
    let direct = 0, players = 0;
    if (prev && prev.day === t.day) { direct = cum - prev.cum; players = cumP - prev.cumP; }
    else if (prev) { const e = ended(prev.day); direct = cum + Math.max(0, (e ? e.all : prev.cum) - prev.cum); players = cumP + Math.max(0, (e ? e.players : prev.cumP) - prev.cumP); }
    // (the last day closed: its trade with the companies and its costs, an hour of them)
    const r = q('SELECT data FROM corp_days WHERE company = ? AND day <= ? ORDER BY day DESC LIMIT 1').get(id, t.day - 1);
    const x = r ? JSON.parse(r.data) : null;
    const trade = x ? Math.max(0, x.sales - (x.players || 0) - (x.npc || 0)) / 24 : 0, cost = x ? (x.sales - x.op) / 24 : 0, other = x ? (x.other || 0) / 24 : 0;
    const from = prev ? Math.max(prev.hour + 1, h - 24) : h - 1, hours = Math.max(1, h - from);
    for (let k = from; k < h; k++) {
      const d = Math.round(Math.max(0, direct) / hours), pl = Math.round(Math.max(0, players) / hours);
      q('INSERT OR REPLACE INTO corp_hours (company, hour, data) VALUES (?, ?, ?)').run(id, k, JSON.stringify({
        hour: k, day: t.day, cum, cumP, players: pl, people: d - pl, direct: d, trade: Math.round(trade), cost: Math.round(cost), other: Math.round(other),
        earned: Math.round(d + trade + other - cost), slept: hours > 1, first: !prev }));
    }
  }
  // a company's last `n` hours (null: not one of the six) and the hour under way so far
  function hoursOf(id, now = clock(), n = 48) {
    if (!HOURLY.includes(id) || !get()) return null;
    const h = Math.floor(now / HOUR);
    const rows = q('SELECT data FROM corp_hours WHERE company = ? AND hour >= ? ORDER BY hour').all(id, h - n).map((r) => JSON.parse(r.data));
    const t = today(id, now), last = rows[rows.length - 1], cum = (t.players || 0) + (t.people || 0);
    const so = last && last.day === t.day ? Math.max(0, cum - last.cum) : cum;
    const part = (now - h * HOUR) / HOUR, x = last || { trade: 0, cost: 0, other: 0 };
    return { hours: rows, now: { hour: h, part, direct: so, trade: Math.round(x.trade * part), cost: Math.round(x.cost * part), other: Math.round(x.other * part), earned: Math.round(so + (x.trade + x.other - x.cost) * part) } };
  }

  // 日次収支レポート: each of the 45 companies' last days in brief — the thirteen's day rows (sales, what they cost,
  // the operating result, the net, the other gains, the money put into them, their cash), the 32 local companies' own
  // (server/core/npc-local.js report) — with a line on the last day closed against the one before
  function report(n = 14) {
    const w = get();
    if (!w) return null;
    const from = w.day - n + 1, byCo = {};
    for (const r of q('SELECT company, day, data FROM corp_days WHERE day >= ? ORDER BY day').all(from)) {
      const x = JSON.parse(r.data);
      (byCo[r.company] || (byCo[r.company] = [])).push({ day: r.day, sales: x.sales, cost: x.sales - x.op, op: x.op, net: x.net, other: x.other || 0, invest: x.invest || 0, cash: x.cash, staff: x.staff });
    }
    const companies = CORP.companies.filter((c) => w.co[c.id]).map((c) => {
      const days = byCo[c.id] || [];
      return { id: c.id, name: c.name, kind: 'corp', dead: !!w.co[c.id].dead, abroad: !!c.abroad, days, line: lineOf(days) };
    });
    const loc = npc && npc.localReport ? npc.localReport() : null;
    const locals = loc ? loc.map((f) => { const days = f.days.filter((d) => d.day >= from); return { ...f, kind: 'local', days, line: f.yamato ? '株式会社YAMATOに統合' : lineOf(days, f.dead) }; }) : null;
    return { day: w.day, companies, locals };
  }
  // the last day in a line: 増収・減収 against the day before, in the black or the red
  function lineOf(days, dead = false) {
    if (dead) return '倒産・破産手続中';
    const d = days[days.length - 1], b = days[days.length - 2];
    if (!d) return 'まだ締めた日がありません';
    const up = b && b.sales > 0 ? d.sales / b.sales - 1 : null;
    const move = up === null ? '' : Math.abs(up) < 0.005 ? '売上は前日並み' : (up > 0 ? '増収' : '減収') + '（' + CORP.fmt.pct(up) + '）';
    const res = d.op > 0 ? '営業黒字 ' + CORP.fmt.money(d.op) : d.op < 0 ? '営業赤字 ' + CORP.fmt.money(d.op) : '営業損益ゼロ';
    const extra = [d.invest ? '投資の入金 ' + CORP.fmt.money(d.invest) : '', d.support ? 'MY WAYからの支援 ' + CORP.fmt.money(d.support) : ''].filter(Boolean).join('・');
    return [move, res, extra].filter(Boolean).join('、');
  }
  // how likely its development is to succeed now (as server/core/corp-model.js tech works it out)
  function techChance(s, p) {
    const sc = model.sizeScale(get(), p);
    const size = Math.max(0.2, Math.min(3, s.n / Math.max(1, p.staff * sc))), spend = Math.max(0.2, Math.min(3, (s.budget.rd || 0) / Math.max(1, p.rd.amount * sc)));
    return Math.round(Math.max(0.05, Math.min(0.95, CORP.tech.chance * Math.pow(size, 0.8) * (0.6 + 0.7 * s.morale) * Math.pow(spend, 0.3))) * 1000) / 1000;
  }
  const routes = (see) => ({
    // every company at a glance, and the ties between them
    'GET /api/ops/corp': (req, u) => {
      see(u);
      const now = clock(), w = get();
      if (!w) return { started: false, now };
      const all = { started: true, day: w.day, launch: w.launch, econ: Math.round(Math.exp(w.econ.x) * 1000) / 1000, boom: w.boom || 1, garageFee: model.garageFeeOf(w),
        questFee: model.questFeeOf(w), vipWeek: model.vipWeekOf(w), gov: w.gov || null,
        companies: CORP.companies.filter((c) => w.co[c.id]).map((c) => summary(c.id, now)), ties: tiesOf(w).filter((t) => w.co[t.a] && w.co[t.b]),
        // (the game's businesses and who runs each: CORP.features; a day of each one's money of late)
        ops: opsView(w),
        // (the local companies as they are now: how many there are, still in business, their economies, MY WAY's partners)
        locals: (() => { const loc = npc && npc.localReport ? npc.localReport() : null, deals = npc && npc.ipDeals ? npc.ipDeals() : null;
          return { n: LOCAL.firms.length, alive: loc ? loc.filter((f) => !f.dead).length : LOCAL.firms.length, merged: loc ? loc.filter((f) => f.yamato).length : 0, spheres: new Set(LOCAL.firms.map((f) => f.sphere)).size, ip: deals ? deals.locals : 0 }; })() };
      return { ...partOf(all, req.query.get('rev')), now };
    },
    // 日次収支レポート: the 45 companies' last two weeks in brief (changes as a day closes)
    'GET /api/ops/corp/report': (req, u) => {
      see(u);
      const now = clock(), r = report();
      if (!r) return { started: false, now };
      return { ...partOf({ started: true, ...r }, req.query.get('rev')), now };
    },
    // a company's day so far, asked again every half minute while its site is open (small: never in the site's `rev`);
    // the six's hours of 企業の本当のリアルタイム稼ぎ with it
    'GET /api/ops/corp/today': (req, u) => {
      see(u);
      const id = String(req.query.get('c') || '');
      if (!CORP.company(id)) throw new ApiError(400, 'bad_company', '会社を選んでください');
      const now = clock();
      if (get()) hourTick(now);
      return { today: get() ? today(id, now) : null, hourly: hoursOf(id, now), now };
    },
    // one company's official site: everything about it
    'GET /api/ops/corp/company': (req, u) => {
      see(u);
      const id = String(req.query.get('c') || '');
      if (!CORP.company(id)) throw new ApiError(400, 'bad_company', '会社を選んでください');
      const now = clock();
      if (!get() || !get().co[id]) return { started: false, now };
      return { ...partOf(detail(id, now), req.query.get('rev')), now };
    }
  });

  // the housekeeping: old days, anchors and the players' money by the day out
  function housekeep(now = clock()) {
    const day = Math.floor(now / 86400000);
    flush();
    q('DELETE FROM corp_days WHERE day < ?').run(day - KEEP_DAYS);
    q('DELETE FROM corp_anchor WHERE day < ?').run(day - KEEP_ANCHORS);
    q('DELETE FROM corp_flows WHERE day < ?').run(day - KEEP_FLOWS);
    hourTick(now);
  }

  return { ensure, booted, closesAt, close, unbooked, anchor, dps, flow, tally, flush, sold, prize, rebuy, coinsBought, questFee, npcSpent, today, hourTick, hoursOf, traded, surcharge, surcharges, garageFee, garageReady, view, routes, housekeep, world: get, startCirculation, setNpc: (n) => { npc = n; }, depth: (id) => (model.PROFILES.get(id) || {}).depth || 1e8,
    delisted, notYet, ip: () => ipView(get()) };
}
