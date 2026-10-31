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
import { CORP, STOCKS, RULES } from './rules.js';
import { keyFrom } from './auth.js';
import { ApiError } from './errors.js';
import { partOf } from './hash.js';
import * as model from './corp-model.js';

const DAY = 86400;
const KEEP_DAYS = 800;          // a company's days kept (its months, quarters and years are kept for good)
const KEEP_FLOWS = 60;          // the players' money by the day
const KEEP_ANCHORS = 800;    // (the dividends a share: a holding not looked at for long is paid by them)
const PUBLIC_NEWS = 4;

export function createCorp({ q, tx, afterCommit, clock = Date.now, secret, history = 2, opsIds = () => [], live = null, onDay = () => {} }) {
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
    if (booted()) return;
    const launch = Math.floor(sec / DAY);
    const { world: w, history: h } = model.boot(key, launch, { years: history, prices: Object.fromEntries(base) });
    world = w;
    stale = true;
    const { co, ...rest } = w;
    q('INSERT INTO corp_state (id, data) VALUES (?, ?)').run('world', JSON.stringify(rest));
    for (const id of Object.keys(co)) q('INSERT INTO corp_state (id, data) VALUES (?, ?)').run(id, JSON.stringify(co[id]));
    write({ ...h, anchors: [], days: h.days.filter((r) => r.day >= launch - KEEP_DAYS) });
    for (const id of listed) {
      const s = co[id], b = Math.log(base.get(id));
      q('INSERT OR REPLACE INTO corp_anchor (company, day, e0, e1, ev, dps) VALUES (?, ?, ?, ?, ?, ?)').run(id, launch, b, b, '[]', s.div.daily || 0);
    }
    afterCommit(() => { stale = false; });
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
  function close() {
    let d = 0;
    const out = change((w) => {
      d = w.day + 1;
      const row = q('SELECT data FROM corp_flows WHERE day = ?').get(d);
      return model.closeDay(w, d, row ? JSON.parse(row.data) : {}, ch);
    });
    write(out);
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
  function sold(company, kind, id, count, paid) {
    if (!(count > 0)) return;
    bump((data) => {
      const c = data[company] || (data[company] = {}), k = c[kind] || (c[kind] = {});
      const was = k[id] || [0, 0];
      k[id] = [was[0] + count, was[1] + paid];
    });
  }
  // a listed company's shares traded by a player at second `sec` (new shares or its own bought back), and the
  // fee, Dtrade's
  function traded(id, side, shares, price, fee, sec) {
    if (!booted() || !listed.includes(id)) return;
    change((w) => model.trade(w, id, side, shares, price, sec), [id]);
    flow('dtrade', 'trade', fee);
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
        next, news: publicNews(id, now, PUBLIC_NEWS)
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
    return {
      id, name: p.name, full: p.full, en: p.en, kind: p.kind, rank: p.rank, model: p.model, listed: !!p.listed,
      staff: s.n, cash: s.bal.cash || 0, bonds: s.bal.bonds || 0, debt: s.loans.reduce((n, l) => n + l.amt, 0), equity: model.equityOf(s),
      retained: s.bal.retained, capital: s.bal.capital, ttm, year: years[0] ? { key: years[0].key, label: years[0].label, pl: years[0].pl } : null,
      fair: Math.round(fair), shares, dps: s.div.dps, guide: s.guide ? { fy: s.guide.fy, sales: s.guide.sales, op: s.guide.op, net: s.guide.net } : null,
      players, news: q('SELECT at, kind, text FROM corp_news WHERE company = ? AND at <= ? ORDER BY at DESC, id DESC LIMIT 3').all(id, Math.floor(now / 1000))
    };
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
        const own = pr.maker === seller;
        out.push({
          kind, id: item.id, name: item.name, price: item.price, ended: !!item.ended, maker: pr.maker, seller, cost: pr.cost,
          buy: own ? null : pr.buy, excl: own ? null : (pr.excl || 0), sellerNet: item.price - (own ? pr.cost : pr.buy + (pr.excl || 0)),
          makerNet: own ? null : pr.buy + (pr.excl || 0) - pr.cost, selling: CORP.products.sell[kind], npc: pr.npc, ...tally(item.id)
        });
      }
    }
    return out;
  }
  // a company's days as columns (the charts)
  function days(id, from) {
    const list = q('SELECT day, data FROM corp_days WHERE company = ? AND day >= ? ORDER BY day').all(id, from);
    const cols = { day: [], sales: [], op: [], net: [], cash: [], debt: [], equity: [], staff: [], fair: [], econ: [], players: [] };
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
      news: q('SELECT at, kind, text, public FROM corp_news WHERE company = ? AND at <= ? ORDER BY at DESC, id DESC LIMIT 100').all(id, Math.floor(now / 1000)),
      ties: tiesOf(w, id),
      flows: q('SELECT day, data FROM corp_flows WHERE day >= ? ORDER BY day').all(Math.floor(now / 86400000) - 30).map((r) => ({ day: r.day, spent: spentAt(JSON.parse(r.data), id) }))
    };
  }

  const routes = (see) => ({
    // every company at a glance, and the ties between them
    'GET /api/ops/corp': (req, u) => {
      see(u);
      const now = clock(), w = get();
      if (!w) return { started: false, now };
      const all = { started: true, day: w.day, launch: w.launch, econ: Math.round(Math.exp(w.econ.x) * 1000) / 1000, companies: CORP.companies.map((c) => summary(c.id, now)), ties: tiesOf(w) };
      return { ...partOf(all, req.query.get('rev')), now };
    },
    // one company's official site: everything about it
    'GET /api/ops/corp/company': (req, u) => {
      see(u);
      const id = String(req.query.get('c') || '');
      if (!CORP.company(id)) throw new ApiError(400, 'bad_company', '会社を選んでください');
      const now = clock();
      if (!get()) return { started: false, now };
      return { ...partOf(detail(id, now), req.query.get('rev')), now };
    }
  });

  // the housekeeping: old days, anchors and the players' money by the day out
  function housekeep(now = clock()) {
    const day = Math.floor(now / 86400000);
    q('DELETE FROM corp_days WHERE day < ?').run(day - KEEP_DAYS);
    q('DELETE FROM corp_anchor WHERE day < ?').run(day - KEEP_ANCHORS);
    q('DELETE FROM corp_flows WHERE day < ?').run(day - KEEP_FLOWS);
  }

  return { ensure, booted, closesAt, close, anchor, dps, flow, sold, traded, view, routes, housekeep, world: get, depth: (id) => (model.PROFILES.get(id) || {}).depth || 1e8 };
}
