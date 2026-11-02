// 投資 on the server: the share prices of RIRU STUDIO and Ice Smoker, the
// players' orders and holdings, and the dividends. Everything is decided here;
// the game only shows it (js/ui/stocks.js), by the rules both share
// (js/game/stocks.js).
//
// The prices come from server/core/stock-model.js: a step every second from
// the server's own key. The path is worked out when the market is looked at
// (a request, a second's tick for the players watching it, a look of its own
// while orders wait, the housekeeping), so the server may sleep and still
// give, second by second, the path it would have shown awake. What is kept is
// the state at the start of the minute the market is in (the seconds after it
// are worked out again from the key when needed, never stored) and the
// candles: by the minute for 3 days, by the hour for 400 days, by the day for
// good. The month before the market opened is made up once, so its charts are
// not empty on the first day.
//
// Orders. A market order trades at once at this second's price. A limit order
// (buy at or below a price, sell at or above it) and a stop order (buy at or
// above, sell at or below) wait until the end of the trading day (9:00 Japan
// time) and trade in the first second that reaches them, at that second's
// price; a buy order holds its money and a sell order its shares while it
// waits. The fee is 1.8% each way (rounded up; Dtrade's), 10% from the order that
// brings the day's trades (buys and sales, before the fee) to $400,000,000 on (an
// active player's: js/game/stocks.js activeAt); every order counts once
// towards the day's 200 (one cancelled or not traded gives its count back);
// buying stops at $800,000,000 a trading day (every company together: what the
// day's filled buys cost, fee included, and the money its buy orders hold), and
// selling at $800,000,000 (the day's filled sales at their price, and its sell
// orders waiting at theirs). An order carries the page's own key:
// the same key again (its answer lost on the way) is the same order, never a
// second one.
//
// Dividends. Each company pays, for each day, the day's average holding (by
// the second) × the day's close × its daily rate: shares bought just before
// the close earn only that part of the day. Worked out when the holding
// changes or is looked at, and kept for the player to claim.
//
// The companies (企業: server/core/corp.js). Once their books run, each day's
// price moves about a centre that is the company's worth by its books (its
// profit, its money, its games under way), moving towards it a little each day,
// with the market's mood besides (sentiment: the jumps of its 決算発表, its games'
// news; fading over months), and with what the players' own orders do to it
// (impact: a buy lifts it, a sale lowers it, fading in hours; a big order pays
// part of its own move: the fill price slips by half of it). A buy is new shares
// the company issues (its money), a sale shares it buys back; the fee is
// Dtrade's. The dividend is the company's own a share, set with its results
// (業績連動: a share of the profit it expects), paid by the second held as before.
import { ApiError, posInt } from './errors.js';
import { STOCKS, fmt } from './rules.js';
import { keyFrom } from './auth.js';
import { pathOf, history, VOL_MEAN, DAY } from './stock-model.js';

const KEEP_IMPACT = Math.pow(0.5, 1 / (6 * 3600));     // an order's move on the price: half gone in 6 hours
const KEEP_MOOD = Math.pow(0.5, 1 / (60 * DAY));       // the market's mood: half gone in 60 days

const S = STOCKS;
const COMPANIES = S.companies;
const MS = 1000;
const LEASE_MS = 70000;                          // a watcher's word holds the second's ticks this long
const LOOK_MS = 5 * 60000;                       // orders waiting: the market looks by itself this often at least
const KEEP = { 60: 3 * DAY, 3600: 400 * DAY };   // candles kept (seconds); the days' for good
const KEEP_ORDERS = 90 * 86400000;               // a finished order's record
const PAGE = 30;
const SIDES = new Set(['buy', 'sell']);
const TYPES = new Set(['market', 'limit', 'stop']);
const ORDER_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const RATE = new Map(COMPANIES.map((c) => [c.id, c.dividend]));
const ZERO = { shares: 0, cost: 0, realized: 0, gains: 0, dividends: 0, frac: 0, acc_day: 0, acc_at: 0, acc: 0 };
// an order that trades on the way down (a limit buy, a stop sell); the others on the way up
const falls = (o) => (o.side === 'buy') === (o.type === 'limit');

export function orderDto(o) {
  return {
    id: o.id, company: o.company, side: o.side, type: o.type, shares: o.shares, price: o.price, status: o.status,
    at: o.created_at, expires: o.expires_at, done: o.done_at, fill: o.fill_price, amount: o.amount, fee: o.fee, profit: o.profit,
    reserved: o.reserved, reason: o.reason
  };
}

export function createStocks({ q, tx, afterCommit, getUser, meDto, balanceChanged, live, secret, rate = () => {}, clock = Date.now, onFill = () => {}, onDue = () => {},
  onTrade = () => {}, paused = () => false, corp = null }) {
  const key = keyFrom(secret, 'stocks');
  const paths = new Map(COMPANIES.map((c) => [c.id, pathOf(key, c)]));
  // each company's path as far as it was worked out, with the checkpoint it came from (set once a transaction commits)
  const mem = new Map();
  // the seconds being worked out now: each company's orders' moves still to come (a fill adds its own)
  const running = new Map();

  function companyOf(id) {
    const c = S.company(String(id || ''));
    if (!c) throw new ApiError(400, 'bad_company', '銘柄を選んでください');
    return c;
  }

  /* ----------------------------------------------------------- the path --- */

  // the market opens (once for each company): the month before it, then the base price
  function open(c, target) {
    const t0 = Math.floor(target / 60) * 60;
    const put = q('INSERT OR IGNORE INTO stock_candles (company, span, at, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?, 0)');
    const big = { 3600: new Map(), [DAY]: new Map() };
    for (const m of history(key, c, t0)) {
      if (m.at >= t0 - KEEP[60]) put.run(c.id, 60, m.at, m.o, m.h, m.l, m.c);
      for (const span of [3600, DAY]) {
        const at = Math.floor(m.at / span) * span, k = big[span].get(at);
        if (!k) big[span].set(at, { o: m.o, h: m.h, l: m.l, c: m.c });
        else { k.h = Math.max(k.h, m.h); k.l = Math.min(k.l, m.l); k.c = m.c; }
      }
    }
    for (const span of [3600, DAY]) for (const [at, k] of big[span]) put.run(c.id, span, at, k.o, k.h, k.l, k.c);
    q('INSERT INTO stock_state (company, tick, x, v, opened) VALUES (?, ?, 0, ?, ?)').run(c.id, t0, VOL_MEAN, t0);
  }
  function checkpoint(c, target) {
    const read = () => q('SELECT tick, x, v, i, s FROM stock_state WHERE company = ?').get(c.id);
    let row = read();
    if (!row) { open(c, target); row = read(); }
    return row;
  }
  function fresh(c, row) {
    const p = priceAt(c, row, row.tick);
    return { tick: row.tick, x: row.x, v: row.v, i: row.i || 0, s: row.s || 0, price: p, from: row, candle: { at: row.tick, o: p, h: p, l: p, c: p } };
  }
  // The price at second `n` for the path's state: the company's centre that second (its base before the companies
  // began), times its noise, its mood and the orders' move.
  const LN = new Map(COMPANIES.map((c) => [c.id, Math.log(c.base)]));
  function centre(c, n) {
    const a = corp && corp.anchor(c.id, Math.floor((n - 1) / DAY));
    if (!a) return 0;
    const day = Math.floor((n - 1) / DAY) * DAY;
    return a.e0 + (a.e1 - a.e0) * (n - day) / DAY - LN.get(c.id);
  }
  const priceAt = (c, st, n) => Math.max(1, Math.round(c.base * Math.exp(centre(c, n) + st.x + (st.s || 0) + (st.i || 0))));
  // what a day's news does to the mood, by the second
  function jumpsOf(c, n) {
    const a = corp && corp.anchor(c.id, Math.floor((n - 1) / DAY));
    return a && a.ev.length ? new Map(a.ev.map(([at, j]) => [at, j])) : null;
  }

  // One company's path up to second `target`: the orders it reaches trade, the
  // minutes it closes are stored, the day's end lets the day's orders go.
  function run(c, target, told) {
    const row = checkpoint(c, target);
    const had = mem.get(c.id);
    const s = had && had.from.tick === row.tick && had.from.x === row.x && had.from.v === row.v && had.from.i === (row.i || 0) && had.from.s === (row.s || 0)
      ? { ...had, candle: { ...had.candle } } : fresh(c, row);
    if (s.tick < target) {
      const path = paths.get(c.id), book = bookOf(c.id);
      // (struck off: what waited of its orders goes, their money back)
      if (book.list.length && corp && corp.delisted && corp.delisted(c.id)) {
        for (const o of book.list) { finish(o, 'canceled', s.tick * MS, 'delisted'); told.push({ userId: o.user_id, id: o.id, waited: false }); }
        book.list = [];
        book.reset();
      }
      // the orders filled in these seconds and how far each moved the price (from the second after it)
      const moves = new Map();
      for (const o of q("SELECT done_at, impact FROM stock_orders WHERE company = ? AND status = 'filled' AND impact != 0 AND done_at >= ? AND done_at < ?").all(c.id, s.tick * MS, target * MS)) {
        const at = Math.floor(o.done_at / MS);
        moves.set(at, (moves.get(at) || 0) + o.impact);
      }
      // (and the people's trades of the country: server/core/npc.js, their imbalance a minute at a time)
      for (const o of q('SELECT at, impact FROM stock_npc WHERE company = ? AND impact != 0 AND at >= ? AND at < ?').all(c.id, s.tick, target)) {
        moves.set(o.at, (moves.get(o.at) || 0) + o.impact);
      }
      running.set(c.id, moves);
      let jumps = null, jumpDay = -1;
      for (let n = s.tick + 1; n <= target; n++) {
        path.step(s, n);
        if (corp) {
          s.i *= KEEP_IMPACT;
          s.s *= KEEP_MOOD;
          const m = moves.get(n - 1);
          if (m) s.i += m;
          const dn = Math.floor((n - 1) / DAY);
          if (dn !== jumpDay) { jumps = jumpsOf(c, n); jumpDay = dn; }
          if (jumps && jumps.has(n)) s.s += jumps.get(n);
        }
        const p = priceAt(c, s, n), k = s.candle;
        s.tick = n;
        s.price = p;
        if (p > k.h) k.h = p;
        if (p < k.l) k.l = p;
        k.c = p;
        if (book.list.length && book.hit(p)) trigger(c, book, n, p, told);
        if (n % 60 === 0) closeMinute(c, s);
        if (n % DAY === 0 && book.list.length) expire(book, n, told);
      }
    }
    running.delete(c.id);
    // (kept only once this is committed: a transaction that fails takes its seconds back with it)
    afterCommit(() => mem.set(c.id, s));
    return s;
  }

  // the minute that just ended: its candle (and the hour's and the day's), and the checkpoint
  function closeMinute(c, s) {
    const k = s.candle, n = s.tick;
    const v = q("SELECT COALESCE(SUM(shares), 0) AS n FROM stock_orders WHERE company = ? AND status = 'filled' AND done_at > ? AND done_at <= ?")
      .get(c.id, k.at * MS, n * MS).n + q('SELECT COALESCE(SUM(shares), 0) AS n FROM stock_npc WHERE company = ? AND at >= ? AND at < ?').get(c.id, k.at, n).n;
    const added = q('INSERT OR IGNORE INTO stock_candles (company, span, at, o, h, l, c, v) VALUES (?, 60, ?, ?, ?, ?, ?, ?)')
      .run(c.id, k.at, k.o, k.h, k.l, k.c, v).changes;
    if (added) {
      for (const span of [3600, DAY]) {
        q(`INSERT INTO stock_candles (company, span, at, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(company, span, at) DO UPDATE SET h = MAX(h, excluded.h), l = MIN(l, excluded.l), c = excluded.c, v = v + excluded.v`)
          .run(c.id, span, Math.floor(k.at / span) * span, k.o, k.h, k.l, k.c, v);
      }
    }
    q('UPDATE stock_state SET tick = ?, x = ?, v = ?, i = ?, s = ? WHERE company = ?').run(n, s.x, s.v, s.i || 0, s.s || 0, c.id);
    s.from = { tick: n, x: s.x, v: s.v, i: s.i || 0, s: s.s || 0 };
    s.candle = { at: n, o: k.c, h: k.c, l: k.c, c: k.c };
  }

  // Every company up to now, in one transaction (nested in the caller's, if any).
  // The states: company → { tick, price, candle, … }.
  function advance(now = clock()) {
    const target = Math.floor(now / MS), told = [], st = new Map();
    tx(() => {
      // (the companies' days close as the prices pass each day's end: the next day's centre comes from it)
      if (corp) {
        corp.ensure(target);
        for (let end = corp.closesAt(); end <= target; end = corp.closesAt()) {
          for (const c of COMPANIES) run(c, end, told);
          // (every player's dividends of the day paid as it closes: the country gives them exactly that)
          corp.close({ '@div': settleDay(end) });
        }
      }
      for (const c of COMPANIES) st.set(c.id, run(c, target, told));
      if (told.length) tell(told);
    });
    return st;
  }

  /* ---------------------------------------------------------- the orders --- */

  // the company's waiting orders, and the two prices that reach any of them
  function bookOf(id) {
    const b = { list: q("SELECT * FROM stock_orders WHERE company = ? AND status = 'open' ORDER BY id").all(id), lo: -Infinity, hi: Infinity };
    b.reset = () => {
      b.lo = -Infinity;
      b.hi = Infinity;
      for (const o of b.list) {
        if (falls(o)) b.lo = Math.max(b.lo, o.price);
        else b.hi = Math.min(b.hi, o.price);
      }
    };
    b.hit = (p) => p <= b.lo || p >= b.hi;
    b.reset();
    return b;
  }
  function trigger(c, book, n, p, told) {
    // (an order trades from the second after the one it was placed in)
    const due = book.list.filter((o) => n >= o.tick && (falls(o) ? p <= o.price : p >= o.price));
    if (!due.length) return;
    for (const o of due) {
      fill(c, o, p, n * MS, n);
      told.push({ userId: o.user_id, id: o.id, waited: true });
    }
    book.list = book.list.filter((o) => !due.includes(o));
    book.reset();
  }
  // the day is over: its orders that did not trade go, their money back
  function expire(book, n, told) {
    const gone = book.list.filter((o) => o.expires_at <= n * MS);
    for (const o of gone) {
      finish(o, 'expired', n * MS);
      told.push({ userId: o.user_id, id: o.id, waited: false });
    }
    book.list = book.list.filter((o) => !gone.includes(o));
    book.reset();
  }
  // an order that does not trade (cancelled, expired, failed): a buy order's money comes back (a sell order's shares are free by themselves)
  function finish(o, status, at, reason = '') {
    const done = q("UPDATE stock_orders SET status = ?, done_at = ?, reason = ? WHERE id = ? AND status = 'open'").run(status, at, reason, o.id).changes;
    if (done && o.side === 'buy' && o.reserved > 0) q('UPDATE users SET dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(o.reserved, o.user_id);
  }

  // An order's move on the price (log: up for a buy, down for a sale; 1% for each `depth` $ of it) and the price it
  // fills at for `p` this second: half its move on top (a limit order never worse than its limit).
  // (the formulas are the shared rules', js/game/stocks.js: the page says the same cost)
  const depthOf = (c) => (corp ? corp.depth(c.id) : Infinity);
  function moveOf(c, side, shares, p) {
    if (!corp) return 0;
    return S.moveOf(depthOf(c), side, shares, p);
  }
  function slipped(c, o, p) {
    if (!corp) return o.type === 'limit' ? (o.side === 'buy' ? Math.min(o.price, p) : Math.max(o.price, p)) : p;
    return S.slipped(depthOf(c), o, p);
  }
  // An order trades: `p` the price, `at` the moment (ms), `n` its second.
  function fill(c, o, p0, at, n) {
    const h = holdingOf(o.user_id, c.id);
    const p = slipped(c, o, p0), move = moveOf(c, o.side, o.shares, p0);
    accrue(h, n, { company: c.id, tick: n, price: p0 });
    // (the fee by what the player traded that day before this one: 10% once it comes to $400,000,000)
    const value = p * o.shares, fee = S.fee(value, tradedOn(o.user_id, o.day));
    let amount, profit = 0;
    if (o.side === 'buy') {
      amount = value + fee;
      // (what the order held, less what it costs: the rest comes back; a market order holds nothing)
      const extra = amount - o.reserved, u = getUser(o.user_id);
      if (!u || (extra > 0 && u.dollars < extra)) { finish(o, 'failed', at, 'funds'); return; }
      if (extra) q('UPDATE users SET dollars = dollars - ?, rev = rev + 1 WHERE id = ?').run(extra, o.user_id);
      h.shares += o.shares;
      h.cost += amount;
    } else {
      if (h.shares < o.shares) { finish(o, 'failed', at, 'shares'); return; }
      amount = value - fee;
      const out = Math.round(h.cost * o.shares / h.shares);
      h.cost -= out;
      h.shares -= o.shares;
      profit = amount - out;
      h.realized += profit;
      // (the profits alone, for the 功績's investing medals: server/core/medals.js)
      if (profit > 0) h.gains += profit;
      q('UPDATE users SET dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(amount, o.user_id);
    }
    save(h);
    q("UPDATE stock_orders SET status = 'filled', done_at = ?, fill_price = ?, amount = ?, fee = ?, profit = ?, impact = ? WHERE id = ?")
      .run(at, p, amount, fee, profit, move, o.id);
    // (in the seconds being worked out now, the move starts with the next one)
    const moves = running.get(c.id);
    if (moves) moves.set(n, (moves.get(n) || 0) + move);
    if (corp) corp.traded(c.id, o.side, o.shares, p, fee, n);
  }

  // after the orders the path reached: each player hears of theirs (their other devices, the phone);
  // (a word that cannot go out never holds the market up)
  function tell(told) {
    const users = new Set();
    for (const t of told) {
      try {
        users.add(t.userId);
        const o = orderDto(q('SELECT * FROM stock_orders WHERE id = ?').get(t.id));
        live.send(t.userId, 'stock', { order: o });
        if (t.waited && o.status === 'filled') onFill(t.userId, o);
      } catch (e) { console.error('stock notice failed', e); }
    }
    for (const id of users) {
      try { if (getUser(id)) { balanceChanged(id, true); onTrade(id); } } catch (e) { console.error('stock notice failed', e); }
    }
  }

  /* -------------------------------------------------- holdings, dividends --- */

  const holdingOf = (userId, company) => q('SELECT * FROM stock_holdings WHERE user_id = ? AND company = ?').get(userId, company) || { user_id: userId, company, ...ZERO };
  function save(h) {
    q(`INSERT INTO stock_holdings (user_id, company, shares, cost, realized, gains, dividends, frac, acc_day, acc_at, acc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, company) DO UPDATE SET shares = excluded.shares, cost = excluded.cost, realized = excluded.realized, gains = excluded.gains, dividends = excluded.dividends,
         frac = excluded.frac, acc_day = excluded.acc_day, acc_at = excluded.acc_at, acc = excluded.acc`)
      .run(h.user_id, h.company, h.shares, h.cost, h.realized, h.gains, h.dividends, h.frac, h.acc_day, h.acc_at, h.acc);
  }
  // The holding's dividends up to second `t`: the share-seconds of the day so
  // far are counted, and each day that ended is paid. (`ctx`: the second being
  // worked out, whose price is a day's close before that close is stored.)
  function accrue(h, t, ctx = null) {
    if (!h.acc_at || (!h.shares && !h.acc)) { h.acc_day = Math.floor(t / DAY); h.acc_at = t; h.acc = 0; return; }
    for (;;) {
      const end = (h.acc_day + 1) * DAY;
      if (t < end) { h.acc += h.shares * (t - h.acc_at); h.acc_at = t; return; }
      const total = h.acc + h.shares * (end - h.acc_at);
      if (total > 0) pay(h, h.acc_day, total / DAY, ctx);
      h.acc_day += 1;
      h.acc_at = end;
      h.acc = 0;
      if (!h.shares) { h.acc_day = Math.floor(t / DAY); h.acc_at = t; return; }
    }
  }
  // a day's dividend: the average holding × the day's close × the rate (the cents carried to the next day)
  function pay(h, d, avg, ctx) {
    // (the companies' days: the dividend a share each company set for that day)
    const per = corp ? corp.dps(h.company, d) : null;
    if (per !== null && per !== undefined) {
      h.frac += avg * per;
      return paid(h, d);
    }
    const end = (d + 1) * DAY;
    const close = ctx && ctx.company === h.company && ctx.tick === end ? ctx.price
      : q('SELECT c FROM stock_candles WHERE company = ? AND span = ? AND at = ?').get(h.company, DAY, d * DAY)?.c;
    if (!close) return;
    h.frac += avg * close * RATE.get(h.company);
    paid(h, d);
  }
  function paid(h, d) {
    const whole = Math.floor(h.frac);
    if (whole <= 0) return;
    h.frac -= whole;
    h.dividends += whole;
    q('INSERT INTO stock_accounts (user_id, pending) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET pending = pending + excluded.pending').run(h.user_id, whole);
    if (settling && d === settling.day) settling.paid[h.company] = (settling.paid[h.company] || 0) + whole;
  }
  // A day the companies close (it ends at second `end`): every player's holding's dividends up to its end, paid now —
  // what each company's holders got of that day, for the country to give them exactly that, out of that company's
  // day of dividends (server/core/corp-model.js dividends; a day before this was counted then, as the shares were)
  let settling = null;
  function settleDay(end) {
    settling = { day: Math.floor(end / DAY) - 1, paid: {} };
    try {
      for (const row of q("SELECT h.* FROM stock_holdings h JOIN users u ON u.id = h.user_id WHERE (h.shares > 0 OR h.acc > 0) AND u.npc = ''").all()) {
        const h = { ...row }, day = h.acc_day;
        accrue(h, end);
        if (h.acc_day !== day) save(h);
      }
      return settling.paid;
    } finally { settling = null; }
  }
  // the player's holdings, their dividends paid up to the second the market is at
  function settle(userId, st) {
    return COMPANIES.map((c) => {
      const h = holdingOf(userId, c.id);
      if (!h.shares && !h.acc) return h;
      const day = h.acc_day;
      accrue(h, st.get(c.id).tick);
      if (h.acc_day !== day) save(h);
      return h;
    });
  }

  const tradesOn = (userId, day) => q("SELECT COUNT(*) AS n FROM stock_orders WHERE user_id = ? AND day = ? AND status IN ('open', 'filled')").get(userId, day).n;
  const openOf = (userId) => q("SELECT * FROM stock_orders WHERE user_id = ? AND status = 'open' ORDER BY id").all(userId);
  // bought on trading day `day`: what its filled buys cost (fee included) and what its buy orders still hold
  const boughtOn = (userId, day) => q(`SELECT COALESCE(SUM(CASE WHEN status = 'filled' THEN amount WHEN status = 'open' THEN reserved ELSE 0 END), 0) AS n
    FROM stock_orders WHERE user_id = ? AND day = ? AND side = 'buy'`).get(userId, day).n;
  // sold on trading day `day`: its filled sales at the price they sold at (before the fee), and its sell orders waiting at theirs
  const soldOn = (userId, day) => q(`SELECT COALESCE(SUM(CASE WHEN status = 'filled' THEN fill_price * shares WHEN status = 'open' THEN price * shares ELSE 0 END), 0) AS n
    FROM stock_orders WHERE user_id = ? AND day = ? AND side = 'sell'`).get(userId, day).n;
  // traded on trading day `day`: every filled order's shares at its price, buys and sales together, before the fee
  // (an active player's 10%: js/game/stocks.js activeAt)
  const tradedOn = (userId, day) => q("SELECT COALESCE(SUM(fill_price * shares), 0) AS n FROM stock_orders WHERE user_id = ? AND day = ? AND status = 'filled'").get(userId, day).n;

  /* ------------------------------------------------------------ the views --- */

  const formingVolume = (id, s) => q("SELECT COALESCE(SUM(shares), 0) AS n FROM stock_orders WHERE company = ? AND status = 'filled' AND done_at > ?").get(id, s.candle.at * MS).n;
  const candleAt = (id, span, at) => q('SELECT o, h, l, c, v FROM stock_candles WHERE company = ? AND span = ? AND at = ?').get(id, span, at);
  // a company now: the price, the day's open, high, low and volume, and the day before's close
  function quote(c, s) {
    const day = Math.floor((s.tick - 1) / DAY) * DAY, k = s.candle;
    const today = candleAt(c.id, DAY, day), before = candleAt(c.id, DAY, day - DAY);
    const open = today ? today.o : k.o;
    return {
      id: c.id, price: s.price, prev: before ? before.c : open, open,
      high: Math.max(today ? today.h : k.h, k.h), low: Math.min(today ? today.l : k.l, k.l),
      volume: (today ? today.v : 0) + formingVolume(c.id, s)
    };
  }
  function mine(userId, st, holdings, now) {
    const open = openOf(userId), a = q('SELECT pending, claimed FROM stock_accounts WHERE user_id = ?').get(userId) || { pending: 0, claimed: 0 };
    let invested = 0, reserved = 0;
    for (const o of open) if (o.side === 'buy') reserved += o.reserved;
    const list = COMPANIES.map((c, i) => {
      const h = holdings[i], s = st.get(c.id);
      const held = open.reduce((n, o) => n + (o.company === c.id && o.side === 'sell' ? o.shares : 0), 0);
      const value = h.shares * s.price;
      invested += value;
      // today's dividend so far (paid at the close): the company's own a share, or (before the companies) the price × its rate
      const per = corp ? corp.dps(c.id, Math.floor((s.tick - 1) / DAY)) : null;
      const today = h.shares || h.acc ? Math.floor((h.acc + h.shares * Math.max(0, s.tick - h.acc_at)) / DAY * (per !== null && per !== undefined ? per : s.price * RATE.get(c.id))) : 0;
      return { id: c.id, shares: h.shares, free: h.shares - held, cost: h.cost, value, realized: h.realized, dividends: h.dividends, today };
    });
    return {
      holdings: list, orders: open.map(orderDto), reserved, invested: invested + reserved, dayCap: S.dayCap, bought: boughtOn(userId, S.dayOf(now)),
      sellCap: S.sellCap, sold: soldOn(userId, S.dayOf(now)), traded: tradedOn(userId, S.dayOf(now)), activeAt: S.activeAt, activeFeeBp: S.activeFeeBp,
      trades: tradesOn(userId, S.dayOf(now)), tradesMax: S.tradesPerDay, dayEnds: S.dayEnd(now),
      dividend: { pending: a.pending, claimed: a.claimed }
    };
  }
  const tickOf = (st) => st.get(COMPANIES[0].id).tick;
  function view(userId, st, now, holdings = settle(userId, st)) {
    return { now, t: tickOf(st), market: COMPANIES.map((c) => quote(c, st.get(c.id))), mine: mine(userId, st, holdings, now), corp: corp ? corp.view(now) : null };
  }

  // A chart: `per`'s candles, the newest the one forming now; from `since` (a
  // candle's start, seconds) when the page has the ones before it. Sent as
  // columns of small numbers (js/game/stocks.js decode).
  function chart(c, per, since, s) {
    const last = S.bucket(s.tick - 1, per.span);
    let first = last - per.span * (per.count - 1);
    if (since !== null && since > first) first = S.bucket(since, per.span);
    const rows = q('SELECT at, o, h, l, c, v FROM stock_candles WHERE company = ? AND span = ? AND at >= ? ORDER BY at').all(c.id, per.from, first);
    // the minute forming now, not stored yet
    const k = s.candle, kAt = Math.floor(k.at / per.from) * per.from, kv = formingVolume(c.id, s);
    const top = rows.length ? rows[rows.length - 1] : null;
    if (top && top.at === kAt) {
      top.h = Math.max(top.h, k.h);
      top.l = Math.min(top.l, k.l);
      top.c = k.c;
      top.v += kv;
    } else if (kAt >= first) rows.push({ at: kAt, o: k.o, h: k.h, l: k.l, c: k.c, v: kv });
    const out = [];
    for (const r of rows) {
      const at = S.bucket(r.at, per.span), b = out[out.length - 1];
      if (b && b.at === at) {
        b.h = Math.max(b.h, r.h);
        b.l = Math.min(b.l, r.l);
        b.c = r.c;
        b.v += r.v;
      } else {
        // (a gap, which the market never leaves: flat candles at the close before)
        while (b && out[out.length - 1].at + per.span < at) {
          const p = out[out.length - 1];
          out.push({ at: p.at + per.span, o: p.c, h: p.c, l: p.c, c: p.c, v: 0 });
        }
        out.push({ at, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });
      }
    }
    const ch = { id: c.id, p: per.id, span: per.span, t0: out.length ? out[0].at : last, base: out.length ? out[0].o : s.price, o: [], c: [], h: [], l: [], v: [] };
    let prev = ch.base;
    for (const b of out) {
      ch.o.push(b.o - prev);
      ch.c.push(b.c - b.o);
      ch.h.push(b.h - Math.max(b.o, b.c));
      ch.l.push(Math.min(b.o, b.c) - b.l);
      ch.v.push(b.v);
      prev = b.c;
    }
    return ch;
  }

  // the second's tick for the players watching: each company's price, and its minute's high and low (so a
  // second the page missed still shows in the candle; the volume comes with the chart, when it is asked again)
  function frame(st) {
    return { t: tickOf(st), q: COMPANIES.map((c) => { const s = st.get(c.id); return [s.price, s.candle.h, s.candle.l]; }) };
  }

  /* --------------------------------------------------- watching, waking --- */

  // the players with the 投資 screen open (their word every 20 seconds or so holds it): a tick every second, sent as it begins
  const watchers = new Map();
  let timer = null;
  function watch(userId, on) {
    if (on) watchers.set(userId, clock() + LEASE_MS);
    else watchers.delete(userId);
    if (watchers.size && !timer) nextBeat();
  }
  function nextBeat() {
    timer = setTimeout(beat, MS - (Date.now() % MS) + 30);
    if (timer && timer.unref) timer.unref();
  }
  function beat() {
    timer = null;
    const now = clock();
    for (const [id, until] of watchers) if (until <= now) watchers.delete(id);
    // (an emergency stop or a lockdown: the connections are closed, and the market keeps still)
    if (paused()) watchers.clear();
    if (!watchers.size) return;
    try {
      const f = frame(advance(now));
      for (const id of watchers.keys()) live.send(id, 'stock', f);
    } catch (e) {
      console.error('stock tick failed', e);
    }
    if (watchers.size && !timer) nextBeat();
  }
  const opened = () => !!q('SELECT 1 AS x FROM stock_state LIMIT 1').get();
  const waiting = () => !!q("SELECT 1 AS x FROM stock_orders WHERE status = 'open' LIMIT 1").get();
  // when the market wants to look by itself: soon while orders wait, else never
  const due = (now = clock()) => (waiting() ? now + LOOK_MS : Infinity);
  function wake(now = clock()) {
    if (waiting()) advance(now);
  }
  // the housekeeping: the path brought up to now (so a waking never has far to go), and the old candles and orders out
  function housekeep(now = clock()) {
    if (!opened()) return;
    advance(now);
    const t = Math.floor(now / MS);
    for (const c of COMPANIES) for (const span of [60, 3600]) q('DELETE FROM stock_candles WHERE company = ? AND span = ? AND at < ?').run(c.id, span, t - KEEP[span]);
    q("DELETE FROM stock_orders WHERE status != 'open' AND done_at < ?").run(now - KEEP_ORDERS);
  }

  /* ------------------------------------------------------------ the routes --- */

  function readOrder(body) {
    const c = companyOf(body.company);
    const side = String(body.side || ''), type = String(body.type || '');
    if (!SIDES.has(side) || !TYPES.has(type)) throw new ApiError(400, 'bad_order', '注文の種類を選んでください');
    const shares = posInt(body.shares, '株数');
    if (shares > S.maxShares) throw new ApiError(400, 'bad_shares', `一度に注文できるのは${fmt(S.maxShares)}株までです`);
    const price = type === 'market' ? 0 : posInt(body.price, '値段');
    const k = String(body.key || '');
    if (!ORDER_KEY.test(k)) throw new ApiError(400, 'bad_key', '注文をやり直してください');
    // (MAX: a buy of at most `shares`, as many of them as the money in hand and the day's room allow at the price then)
    return { c, side, type, shares, price, key: k, fit: side === 'buy' && body.fit === true };
  }
  const sameOrder = (o, r) => o.company === r.c.id && o.side === r.side && o.type === r.type && (o.shares === r.shares || (r.fit && o.shares <= r.shares)) && o.price === r.price;

  function place(u, r, now, st) {
    const { c, side, type, price } = r, s = st.get(c.id), p = s.price, t = s.tick;
    // (a company that failed is struck off: its shares are no longer traded — MY WAY's 倒産)
    if (corp && corp.delisted && corp.delisted(c.id)) throw new ApiError(409, 'delisted', `${c.name}は倒産により上場廃止となりました（売買できません）`);
    const day = S.dayOf(now), traded = tradedOn(u.id, day);
    let shares = r.shares;
    // MAX: trimmed to what fits now (the money in hand, the day's room), at least one share (else refused as any order)
    if (r.fit) {
      const budget = Math.min(getUser(u.id).dollars, S.dayCap - boughtOn(u.id, day));
      const depth = corp ? depthOf(c) : Infinity;
      shares = Math.max(1, Math.min(shares, S.maxBuy(depth, type, price, p, budget, shares, traded)));
    }
    if (tradesOn(u.id, day) >= S.tradesPerDay) throw new ApiError(409, 'trade_limit', `本日の売買は${S.tradesPerDay}回までです`);
    const open = openOf(u.id);
    if (type !== 'market') {
      if (open.length >= S.openOrders) throw new ApiError(409, 'order_limit', `待機中の注文は${S.openOrders}件までです`);
      if (Math.abs(price - p) > p * S.priceRange) throw new ApiError(400, 'price_range', `値段は現在値の±${Math.round(S.priceRange * 100)}%以内で指定してください`);
      const below = falls({ side, type });
      if (below ? price >= p : price <= p) throw new ApiError(400, 'price_side', below ? '現在値より安い値段を指定してください' : '現在値より高い値段を指定してください');
    }
    let reserved = 0;
    if (side === 'buy') {
      const unit = type === 'market' ? slipped(c, { side, type, shares, price }, p) : type === 'limit' ? price : Math.ceil(price * (1 + S.stopMargin));
      const value = unit * shares, need = value + S.fee(value, traded), bought = boughtOn(u.id, day);
      if (bought + need > S.dayCap) throw new ApiError(409, 'cap', `投資は1日（日本時間9:00から）合計$${fmt(S.dayCap)}までです`, { room: Math.max(0, S.dayCap - bought) });
      if (getUser(u.id).dollars < need) throw new ApiError(409, 'insufficient', '$が足りません');
      if (type !== 'market') reserved = need;
    } else {
      const held = open.reduce((n, o) => n + (o.company === c.id && o.side === 'sell' ? o.shares : 0), 0);
      if (shares > holdingOf(u.id, c.id).shares - held) throw new ApiError(409, 'no_shares', '売れる株が足りません');
      // (the day's selling cap: a market sale at the price it slips to, a limit or stop sale at its price)
      const value = type === 'market' ? slipped(c, { side, type, shares, price }, p) * shares : price * shares, sold = soldOn(u.id, day);
      if (sold + value > S.sellCap) throw new ApiError(409, 'sell_cap', `売却は1日（日本時間9:00から）合計$${fmt(S.sellCap)}までです`, { room: Math.max(0, S.sellCap - sold) });
    }
    const id = Number(q(`INSERT INTO stock_orders (user_id, key, company, side, type, shares, price, reserved, status, day, tick, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`).run(u.id, r.key, c.id, side, type, shares, price, reserved, day, t + 1, now, type === 'market' ? 0 : S.dayEnd(now)).lastInsertRowid);
    const o = q('SELECT * FROM stock_orders WHERE id = ?').get(id);
    // (a market order: in this second's minute, even when the second closed the last one)
    if (type === 'market') fill(c, o, p, Math.max(now, t * MS + 1), t);
    else if (reserved) q('UPDATE users SET dollars = dollars - ?, rev = rev + 1 WHERE id = ?').run(reserved, u.id);
    const done = q('SELECT * FROM stock_orders WHERE id = ?').get(id);
    live.send(u.id, 'stock', { order: orderDto(done) });
    return done;
  }

  const routes = {
    // the market and my part in it
    'GET /api/stocks': (req, u) => {
      const now = clock();
      advance(now);
      return tx(() => view(u.id, advance(now), now));
    },

    // a company's chart for a period (`since`: only the candles from that one's start)
    'GET /api/stocks/chart': (req, u) => {
      const c = companyOf(req.query.get('c'));
      const per = S.period(String(req.query.get('p') || ''));
      if (!per) throw new ApiError(400, 'bad_period', '期間を選んでください');
      const raw = req.query.get('since');
      const since = raw === null || raw === '' ? null : Number(raw);
      if (since !== null && (!Number.isSafeInteger(since) || since < 0)) throw new ApiError(400, 'bad_since', '期間を選び直してください');
      const now = clock(), st = advance(now);
      return { now, t: tickOf(st), chart: chart(c, per, since, st.get(c.id)) };
    },

    // my orders that are over, newest first
    'GET /api/stocks/history': (req, u) => {
      const raw = req.query.get('before');
      const before = raw ? posInt(raw, '注文') : Number.MAX_SAFE_INTEGER;
      const rows = q("SELECT * FROM stock_orders WHERE user_id = ? AND status != 'open' AND id < ? ORDER BY id DESC LIMIT ?").all(u.id, before, PAGE + 1);
      return { orders: rows.slice(0, PAGE).map(orderDto), more: rows.length > PAGE, now: clock() };
    },

    'POST /api/stocks/order': async (req, u) => {
      const r = readOrder(await req.json());
      const now = clock();
      const seen = q('SELECT * FROM stock_orders WHERE user_id = ? AND key = ?').get(u.id, r.key);
      if (!seen) rate(u);
      advance(now);
      const out = tx(() => {
        const st = advance(now);
        // the same order again (its answer was lost on the way): what it did, not done twice
        const again = q('SELECT * FROM stock_orders WHERE user_id = ? AND key = ?').get(u.id, r.key);
        if (again && !sameOrder(again, r)) throw new ApiError(409, 'key_reused', '注文をやり直してください');
        const o = again || place(u, r, now, st);
        return { order: orderDto(o), ...view(u.id, st, now) };
      });
      if (out.order.type !== 'market' && out.order.status === 'open') onDue(now + LOOK_MS);
      balanceChanged(u.id, true);
      if (out.order.status === 'filled') onTrade(u.id);
      return { ...out, me: meDto(getUser(u.id)) };
    },

    'POST /api/stocks/cancel': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.id, '注文');
      rate(u);
      const now = clock();
      advance(now);
      const out = tx(() => {
        const st = advance(now);
        const o = q('SELECT * FROM stock_orders WHERE id = ? AND user_id = ?').get(id, u.id);
        if (!o) throw new ApiError(404, 'no_order', 'この注文は見つかりません');
        if (o.status !== 'open') throw new ApiError(409, 'order_done', 'この注文はすでに終わっています', { order: orderDto(o) });
        finish(o, 'canceled', now);
        const done = orderDto(q('SELECT * FROM stock_orders WHERE id = ?').get(id));
        live.send(u.id, 'stock', { order: done });
        return { order: done, ...view(u.id, st, now) };
      });
      balanceChanged(u.id, true);
      return { ...out, me: meDto(getUser(u.id)) };
    },

    // the dividends waiting, into my $
    'POST /api/stocks/claim': async (req, u) => {
      await req.json();
      rate(u);
      const now = clock();
      advance(now);
      const out = tx(() => {
        const st = advance(now), holdings = settle(u.id, st);
        const a = q('SELECT pending FROM stock_accounts WHERE user_id = ?').get(u.id);
        const paid = a ? a.pending : 0;
        if (paid > 0) {
          q('UPDATE stock_accounts SET pending = 0, claimed = claimed + ? WHERE user_id = ?').run(paid, u.id);
          q('UPDATE users SET dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(paid, u.id);
        }
        return { paid, ...view(u.id, st, now, holdings) };
      });
      if (out.paid) balanceChanged(u.id);
      onTrade(u.id);
      return { ...out, me: meDto(getUser(u.id)) };
    },

    // the screen is open (on), or closed (off): the second's ticks over the live connection (an SSE page says so here, a WebSocket by a message)
    'POST /api/stocks/watch': async (req, u) => {
      const body = await req.json();
      watch(u.id, !!body.on);
      return { ok: true, now: clock() };
    }
  };

  // the companies closed a day: whoever has the screen open hears what they now show
  function corpNotice() {
    if (!corp || !watchers.size) return;
    const view = corp.view(clock());
    for (const id of watchers.keys()) live.send(id, 'stock', { corp: view });
  }

  return {
    routes, advance, watch, wake, due, housekeep, corpNotice,
    // (the tests: the path's state, and a player's view)
    view: (userId, now = clock()) => tx(() => view(userId, advance(now), now)),
    watching: () => watchers.size,
    close() { clearTimeout(timer); timer = null; watchers.clear(); }
  };
}
