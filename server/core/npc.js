// NPCの国 on the server (server/core/npc-model.js is the country itself): kept in the database (its plain data as
// JSON, the people's columns as blobs: the money and what they own every few minutes, the rest with each hour and
// each day), worked out a minute at a time while its people are about (the launch day all day; then 11:00–22:00 on
// weekdays and 9:00–22:00 on days off, Japan time) and a day at a time with the companies (server/core/corp.js asks
// for the people's money of a day as it closes it, and hands back what the companies paid out), and shown: to the
// players, the 街ライブ (only to look at: nothing a player does reaches the country, nor does any player take part in
// its votes or petitions; the companies' prices and fees the country may change reach them as the plan says), and
// to the operator site, everything.
//
// What wakes it: the host's alarm each minute the people are about (server/cloudflare/casino.js; the Node server's
// timer), and the companies' days closing. A minute not worked out when it came (the server asleep) is worked out
// when it wakes, a few at a time if many; a day closing works out what is left of it first.
import { NPC, CORP, RULES, STOCKS, carSale, carPrice } from './rules.js';
import { keyFrom } from './auth.js';
import { ApiError } from './errors.js';
import { partOf } from './hash.js';
import * as model from './npc-model.js';
import * as econ from './npc-econ.js';
import { view as localView, detail as localDetail, reportOf as localReport } from './npc-local.js';
import { view as dealsView } from './npc-ipdeals.js';
import { view as wagesView } from './npc-wages.js';
import { view as hachiView } from './hachi.js';
import * as pop from './npc-pop.js';
import * as asukaModel from './asuka.js';
import * as text from './npc-text.js';
import * as heart from './npc-heart.js';
import { carByIndex } from './npc-mind.js';
import * as research from './npc-research.js';
import { createAi, aiYen } from './npc-ai.js';
import * as alphaModel from './npc-alpha.js';
import * as elite from './npc-elite.js';
import * as boss from './npc-boss.js';
import { seeded } from './npc-rand.js';
import { view as welfareView } from './npc-welfare.js';
import crypto from 'node:crypto';
import { LISTED_IDS } from './npc-market.js';
import { fmtKnob } from './npc-politics.js';
import { peopleSpent, feesOf } from './corp-model.js';
import { playersMoney, playersLedgerDay } from './money.js';

const MIN = 60000;
const MAX_TICKS = 240;               // minutes worked out in one wake at most (the rest the next)
const SAVE_EVERY = 5;                // the people's money kept every this many minutes
const WATCH_MS = 70000;              // a 街ライブ watcher's word holds its frames this long
const LOOKS = 30;                    // a player's looks at a person's card an hour
const KEEP_NEWS = 120, KEEP_MEETINGS = 400, KEEP_REPORTS = 600, KEEP_DAYS = 800;
const DEPTHS = ['shallow', 'standard', 'deep', 'deepest'];
const b64 = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');

export function createNpc({ q, tx, afterCommit, clock = Date.now, secret, config = {}, corp, stocks = () => null, live = null, opsIds = () => [], playersHeld = () => ({}), ai: binding = null, usage = () => 0, opsLog = null, alert = null, alertPlayers = null, blobs = () => null }) {
  const on = config.npc !== false;
  const N = Math.max(500, Math.min(NPC.nation.population, Number(config.npcPopulation) || NPC.nation.population));
  // the people's hours: by the new rules 17:00 to 22:00 every day (NPC.hours.window), unless NPC_WINDOW is 'off'
  const winOn = String(config.npcWindow || 'off') !== 'off';
  const hw = (w) => (w && w.life2 && winOn ? NPC.hours.window : null);
  const key = keyFrom(secret, 'npc');
  const ai = createAi({ binding, q, clock, daily: Number(config.npcAiNeurons) || NPC.elite.free, yen: Number(config.npcAiYen) >= 0 ? Number(config.npcAiYen) : aiYen(Number(config.npcRooms) || 0), model: config.npcAiModel || undefined });
  let W = null, stale = true, last = null;
  const prices = new Map(STOCKS.companies.map((c) => [c.id, c.base]));
  const watchers = new Map();
  const looks = new Map();
  let tickMs = 0, ticks = 0, saves = 0;

  /* ---------------------------------------------------------------- kept --- */
  function load() {
    const meta = q("SELECT data FROM npc_state WHERE id = 'meta'").get();
    if (!meta) return null;
    const m = JSON.parse(meta.data);
    const P = pop.alloc(m.n);
    const rows = (prefix) => q('SELECT data FROM npc_blob WHERE part >= ? AND part < ? ORDER BY part').all(prefix + ':', prefix + ';').map((r) => r.data);
    const all = rows('all');
    if (!all.length) return null;
    pop.unpack(P, all, false);
    if ((m.hotAt || 0) > (m.allAt || 0)) { const hot = rows('hot'); if (hot.length) pop.unpack(P, hot, true); }
    // (アスカ国's people: their own blobs, all of them as each day closed and what moved since)
    let AP;
    if (m.asuka) {
      const ar = rows('asuka');
      if (ar.length) {
        AP = asukaModel.unpack(asukaModel.alloc(m.asuka.n), ar);
        if ((m.hotAt || 0) > (m.allAt || 0)) { const hot = rows('asukahot'); if (hot.length) asukaModel.unpack(AP, hot, true); }
      }
    }
    const w = Object.assign(m, { P, key, ...(AP ? { AP } : {}) });
    model.attach(w);
    return w;
  }
  function get() {
    if (stale) {
      W = load();
      stale = false;
      if (W) { policy(W); homecoming(W); adviser(W); }
    }
    return W;
  }
  // the AI 経営アドバイザー's answer to a company's choices asked on `day` (npc-org.js askAdvice; null: no AI here)
  function adviser(w) { w.aiAdvice = ai.on ? (company, day) => ai.text('decide', company + ':' + day) : null; w.alphaAi = ai.on; }
  // the companies that came home since the country was kept (YOSIDA, WAZIMA): each hires its people once (model.welcome),
  // and the country is kept with them at once
  function homecoming(w) {
    const c = corp.world();
    if (!c || !model.toWelcome(w, c).length) return;
    tx(() => {
      const came = model.welcome(w, c, w.day);
      if (!came.length) return;
      console.log('npc: came home', came.map((x) => `${x.id} ${x.hired}/${x.want}`).join(', '));
      save('all');
    });
  }
  const booted = () => !!get();
  // what is kept: the plain data, and the people's money (`hot`) or all of them; what the country wrote since, into
  // its tables (the news, the meetings, the reports)
  function save(kind) {
    const w = W;
    if (!w) return;
    drain(w);
    w.hotAt = w.minute;
    if (kind === 'all') { w.allAt = w.minute; w.dirtyAll = false; }
    q("INSERT INTO npc_state (id, data) VALUES ('meta', ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(JSON.stringify(model.metaOf(w)));
    const prefix = kind === 'all' ? 'all' : 'hot';
    // (a row at a time as it is made: npc-pop.js packRows)
    const put = (pre, rows) => { let k = 0; for (const r of rows) { q('INSERT INTO npc_blob (part, data) VALUES (?, ?) ON CONFLICT(part) DO UPDATE SET data = excluded.data').run(`${pre}:${String(k).padStart(3, '0')}`, r); k++; } q('DELETE FROM npc_blob WHERE part >= ? AND part < ?').run(`${pre}:${String(k).padStart(3, '0')}`, pre + ';'); };
    put(prefix, pop.packRows(w.P, kind !== 'all'));
    // (アスカ国's people: all of them as each day closes, what moves within a day — their money, what they are doing —
    // with every save between: they spend through the day as ヴェルノア's people do)
    if (w.AP) {
      put(kind === 'all' ? 'asuka' : 'asukahot', asukaModel.packRows(w.AP, kind !== 'all'));
    }
    saves++;
    // (a transaction that fails takes its minutes back: read again before the next use)
    stale = true;
    afterCommit(() => { stale = false; });
  }
  function drain(w) {
    const now = clock();
    for (const n of w.news.splice(0)) q('INSERT INTO npc_news (day, at, kind, district, text, data) VALUES (?, ?, ?, ?, ?, ?)').run(n.day || w.day, now, n.kind || 'news', n.district ?? -1, n.text, JSON.stringify(n.data || {}));
    for (const m of w.meetings.splice(0)) q('INSERT INTO npc_meetings (company, day, data) VALUES (?, ?, ?)').run(m.company, m.day, JSON.stringify(m));
    for (const r of w.reports.splice(0)) q('INSERT INTO npc_reports (company, kind, day, data) VALUES (?, ?, ?, ?)').run(r.company, r.kind, r.day, JSON.stringify(r));
    for (const x of w.reasons.splice(0)) {
      const c = w.card(x.i, x.day);
      q('INSERT INTO npc_reports (company, kind, day, data) VALUES (?, ?, ?, ?)').run('', 'reason', x.day, JSON.stringify({ i: x.i, id: c.id, name: c.name, kind: x.kind, text: text.reason(w, x) }));
    }
    // 少数精鋭集団アルファ's days: kept here (70 of them), and copied to R2 after (alphaR2)
    if (w.alpha && w.alpha.out && w.alpha.out.length) {
      for (const r of w.alpha.out.splice(0)) q('INSERT INTO npc_alpha (day, data, r2) VALUES (?, ?, 0) ON CONFLICT(day) DO UPDATE SET data = excluded.data, r2 = 0').run(r.day, JSON.stringify(r));
      q('DELETE FROM npc_alpha WHERE day < ?').run(w.day - NPC.alpha.keep);
    }
    // the town's talk: the latest lines, kept with the country
    w.talkFeed = w.talkFeed || [];
    for (const c of w.convos.splice(0)) w.talkFeed.push(text.line(w, c, null));
    if (w.talkFeed.length > 60) w.talkFeed.splice(0, w.talkFeed.length - 60);
    // the people's trades of these minutes: their volume and their move on each price (from this second)
    const ms = w.marketState;
    if (ms && ms.nudges.length) {
      const by = {};
      for (const x of ms.nudges.splice(0)) { const b = by[x.company] || (by[x.company] = { shares: 0, value: 0 }); b.shares += x.shares; b.value += x.value; }
      const at = Math.floor(now / 1000);
      for (const [id, b] of Object.entries(by)) {
        const depth = corp.depth(id);
        // (a rush of the people's orders one way — a panic, a mania — can move a price a long way)
        const impact = Math.max(-0.25, Math.min(0.25, 0.01 * b.value / depth));
        q('INSERT INTO stock_npc (company, at, shares, impact) VALUES (?, ?, ?, ?) ON CONFLICT(company, at) DO UPDATE SET shares = shares + excluded.shares, impact = impact + excluded.impact').run(id, at, b.shares, impact);
      }
    }
  }

  // The rules the country's knobs reach in the game itself (the players' fees and MAGITA's surcharge): set on the
  // shared rules (js/game/config.js, stocks.js, corp.js) as they are now; the game is told them too (hello).
  // what the companies charge the players, as they set it themselves (server/core/corp-model.js fees: Dtrade's, the
  // job sites'); MAGITA's surcharge is its own too (its world's)
  function policy() {
    const cw = corp.world(), f = feesOf(cw);
    RULES.casino.winFee = f.winFee;
    RULES.casino.exchangeFee = f.exchangeFee;
    STOCKS.feeBp = Math.round(f.tradeFee * 10000);
    CORP.players.jobFee = f.jobFee;
  }
  const policyDto = () => ({ winFee: RULES.casino.winFee, exchangeFee: RULES.casino.exchangeFee, feeBp: STOCKS.feeBp, jobFee: CORP.players.jobFee,
    surcharge: (() => { const cw = corp.world(), s = cw && cw.co.magita; return s && s.surcharge ? (s.surchargeAmt || CORP.magita.surcharge.amount) : CORP.magita.surcharge.amount; })() });

  /* ---------------------------------------------------------------- the beginning --- */
  // The country begins (once): its people made up, the companies set to live on its money from the day they close next.
  function ensure(now) {
    if (!on) return;
    // (a country already there: any company come home since it was loaded hires now — the companies may only have
    // been added to their world after the country was read)
    if (get()) { homecoming(W); return; }
    const w = corp.world();
    if (!w) return;
    tx(() => {
      W = model.boot(key, now, w, { n: N, held: playersHeld() });
      corp.startCirculation(W.day, N / NPC.nation.population);
      save('all');
    });
    policy(W);
    adviser(W);
  }

  /* ---------------------------------------------------------------- the minutes --- */
  function ctx() {
    const w = corp.world(), now = clock(), sale = carSale(now);
    const fair = {};
    if (w) for (const id of LISTED_IDS) { const s = w.co[id]; if (s && s.mkt) fair[id] = s.mkt.fair; }
    return {
      corp: w, fair,
      carPrice: (id) => { const c = RULES.cars.find((x) => x.id === id); return c ? carPrice(c, sale, 0, corp.surcharge(id)).price : 0; },
      // (a company struck off the market — failed, or a bank put under the state: nobody trades its shares)
      stockPrice: (id) => (corp.delisted(id) ? 0 : prices.get(id) || 0),
      lastMonth: (id) => { const r = q("SELECT data FROM corp_periods WHERE company = ? AND kind = 'm' ORDER BY day DESC LIMIT 1").get(id); return r ? JSON.parse(r.data) : null; }
    };
  }
  // the minutes from the last one worked out up to `target` (within the day not yet closed), those the people are
  // about; `stride`: a catching up after a long sleep looks at every few minutes only
  function runTo(target, max = MAX_TICKS, stride = 1) {
    const w = W, c = ctx();
    let m = w.minute + 1, n = 0;
    const t0 = Date.now();
    while (m <= target && n < max) {
      if (Math.floor(m / 1440) > w.day) break;
      w.hoursWin = hw(w);
      if (w.paused || !NPC.activeAt(m * MIN, w.first, w.hoursWin)) {
        const next = w.paused ? target + 1 : Math.floor(NPC.nextActive(m * MIN, w.first, w.hoursWin) / MIN);
        w.minute = Math.min(target, Math.min(next, (w.day + 1) * 1440) - 1);
        m = w.minute + 1;
        continue;
      }
      model.tick(w, m, c);
      n++;
      m += stride;
      w.minute = m - 1;
    }
    if (n) { tickMs += Date.now() - t0; ticks += n; }
    return n;
  }
  // the host's wake (every minute while the people are about): the companies' days closed up to now (the people's
  // minutes of each first), then today's minutes; kept every few minutes; the 街ライブ's watchers told
  function wake(now = clock()) {
    if (!on) return;
    const st = stocks();
    if (st) { const s = st.advance(now); for (const [id, x] of s) prices.set(id, x.price); }
    ensure(now);
    const w = get();
    if (!w) return;
    tx(() => {
      const w2 = get();
      const n = runTo(Math.floor(now / MIN) - 0);
      if (n && (w2.minute - (w2.hotAt || 0) >= SAVE_EVERY || w2.dirtyAll)) save(w2.dirtyAll ? 'all' : 'hot');
      if (n) afterCommit(() => push(now));
    });
    // (the hour's end: six companies' 本当のリアルタイム稼ぎ kept — server/core/corp.js)
    if (corp.hourTick) { try { corp.hourTick(now); } catch (e) { console.error('corp hours failed', e); } }
    tune();
  }
  // when the host should wake next: the next minute the people are about
  function due(now = clock()) {
    if (!on) return Infinity;
    const w = get();
    // (not begun: as soon as the companies are, never before)
    if (!w) return corp.booted() ? now + 1000 : Infinity;
    return Math.max(now + 1000, NPC.nextActive(now + 1000, w.first, hw(w)) + 2000);
  }
  // the depth the people think at: shallower when the server is busy (its month's usage high, the minutes slow)
  function tune() {
    const w = W;
    if (!w || w.depthFixed) return;
    const per = ticks ? tickMs / ticks : 0, pct = usage() || 0;
    let k = DEPTHS.indexOf(w.depth || 'standard');
    if (pct >= 80 || per > 400) k = 0;
    else if (pct >= 75 || per > 150) k = Math.max(0, k - 1);
    else if (pct < 60 && per < 40) k = Math.min(DEPTHS.length - 1, k + 1);
    w.depth = DEPTHS[k] === 'deepest' && pct >= 50 ? 'deep' : DEPTHS[k];
  }

  /* ---------------------------------------------------------------- the days --- */
  // the companies' day `d` is closing (server/core/corp.js): the people's last minutes of it, their money for it
  function beforeClose(d) {
    const w = get();
    if (!w || !w.P) return null;
    homecoming(w);
    const end = (d + 1) * 1440 - 1;
    const left = Math.max(0, end - w.minute);
    runTo(end, Infinity, left > 600 ? 5 : 1);
    w.minute = Math.max(w.minute, end);
    w.playerShares = playersHeld();
    return model.flowsFor(w, d);
  }
  // …and closed: what they paid out to the country, and the country's next day
  function afterClose(d, out) {
    const w = get();
    if (!w) return;
    model.nextDay(w, d, out.ext, ctx());
    // (the money ledger: every $ from someone to someone — told at once if not)
    const cw = corp.world();
    if (cw) {
      const L = model.ledgerDay(w, cw, d, alert);
      // (and the players' side: their money, and what of it is held for them, against what crossed between them and
      // the country — what the country has booked, and what it books with the days still open: server/core/money.js)
      const un = corp.unbooked ? corp.unbooked(d) : { in: 0, out: 0 };
      playersLedgerDay(L, d, playersMoney(q, RULES.tokenPrice), w.sum.toPlayers - w.sum.fromPlayers + un.out - un.in, alertPlayers);
    }
    policy(w);
    q('INSERT INTO npc_days (day, data) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data').run(d + 1, JSON.stringify({
      stats: w.stats, nation: { cash: w.nation.cash, debt: w.nation.debt, bank: w.nation.bank, fund: w.nation.fund, in: w.nation.day.in, out: w.nation.day.out },
      districts: w.districts.map((x) => ({ cash: x.cash, approval: Math.round(x.approval), mayor: x.mayor, economy: x.economy })), sector: w.sector.cash, sum: w.sum
    }));
    // (the thoughts of a few of those the town talks about — CEOs of the 300 only: the citizens think without AI)
    if (ai.on) for (const o of Object.values(w.orgs).slice(0, 10)) if (o.ceo >= 0 && w.P.flags[o.ceo] & pop.FL.elite && (d + o.ceo) % 3 === 0) w.ai.push({ kind: 'voice', i: o.ceo });
    save('all');
    afterCommit(() => {
      for (const id of opsIds()) if (live) live.sendOps(id, 'npc', { day: d + 1 });
      for (const id of watchers.keys()) if (live) live.send(id, 'town', { day: d + 1 });
    });
  }

  /* ---------------------------------------------------------------- the market --- */
  // a player's order in a listed company: the people's waiting orders on the other side take what they can of it (they
  // are kept at once); returns the shares the people took
  function cross(id, side, shares, price) {
    const w = get();
    if (!w || !LISTED_IDS.includes(id)) return 0;
    const [n] = w.market.cross(w, id, side, shares, price);
    if (n > 0) save('hot');
    return n;
  }
  // what the people have spent at a company so far on the companies' day `day` (their money waiting for its close)
  function spentToday(day, id) {
    const w = get();
    if (!w || !w.fl) return 0;
    let n = 0;
    for (const [k, f] of Object.entries(w.fl)) if (Number(k) <= day) n += peopleSpent(f.co[id], id === 'tenesice' ? f.bank : null);
    return n;
  }
  // a player bought a car: one fewer for the people (the players buy first: never refused for it)
  function carBought(id) {
    const w = get();
    if (!w || !w.stock.cars[id]) return;
    if (w.carSold) w.carSold(id); else w.stock.cars[id]--;
    save('hot');
  }
  // Car Owner's stock as the players see it: how many of each car are there now (null: no country yet, no limit), and
  // the lots on their way (when they arrive, ms)
  function carStock() {
    const w = get();
    if (!w || !w.stock) return null;
    const coming = {};
    for (const o of w.stock.orders) coming[o.id] = { n: (coming[o.id] ? coming[o.id].n : 0) + o.n, at: Math.min(coming[o.id] ? coming[o.id].at : Infinity, o.at * 86400000) };
    return { cars: { ...w.stock.cars }, coming };
  }

  /* ---------------------------------------------------------------- the 街ライブ --- */
  // the frame of everyone now: 5 bytes a person (district and place, what they do, their mood, marks, their age)
  function frame(w) {
    const P = w.P, out = new Uint8Array(P.n * 5), day = w.day;
    for (let i = 0; i < P.n; i++) {
      const f = P.flags[i];
      out[i * 5] = ((P.ldist[i] & 7) << 5) | (P.place[i] & 31);
      out[i * 5 + 1] = P.act[i];
      out[i * 5 + 2] = P.emo[i * 5];
      out[i * 5 + 3] = (NPC.working(P.job[i]) ? 1 : 0) | (P.cash[i] > 1e9 ? 2 : 0) | (P.home[i] === 4 ? 4 : 0) | (f & (pop.FL.famous | pop.FL.mayor | pop.FL.exec) ? 8 : 0) | (f & pop.FL.moving ? 16 : 0) | (f & pop.FL.striking ? 32 : 0);
      out[i * 5 + 4] = Math.min(255, Math.max(0, Math.floor((day - P.birth[i]) / 365.25)));
    }
    return out;
  }
  function push(now) {
    const w = W;
    if (!w || !live) return;
    for (const [id, until] of watchers) if (until < now) watchers.delete(id);
    if (!watchers.size) { last = null; return; }
    const f = frame(w);
    let diff = null;
    if (last && last.length === f.length) {
      const changed = [];
      for (let i = 0; i < w.P.n; i++) {
        const a = i * 5;
        if (f[a] !== last[a] || f[a + 1] !== last[a + 1] || Math.abs(f[a + 2] - last[a + 2]) > 8 || f[a + 3] !== last[a + 3]) changed.push(i);
      }
      diff = new Uint8Array(changed.length * 8);
      changed.forEach((i, k) => { diff[k * 8] = i >> 16; diff[k * 8 + 1] = (i >> 8) & 255; diff[k * 8 + 2] = i & 255; diff.set(f.subarray(i * 5, i * 5 + 5), k * 8 + 3); });
    }
    last = f;
    const data = { t: w.minute, n: w.P.n, stats: liveStats(w), ...(diff ? { d: b64(diff) } : { f: b64(f) }) };
    for (const id of watchers.keys()) live.send(id, 'town', data);
  }
  function liveStats(w) {
    const P = w.P, acts = new Uint32Array(NPC.acts.length);
    for (let i = 0; i < P.n; i++) acts[P.act[i]]++;
    return { acts: Array.from(acts), mood: w.stats.mood, unemployment: w.stats.unemployment, homeless: w.stats.homeless, economy: w.stats.economy, prices: w.stats.prices, active: NPC.activeAt(clock(), w.first, hw(w)) };
  }
  function watch(userId, onOff) {
    if (onOff) watchers.set(userId, clock() + WATCH_MS);
    else watchers.delete(userId);
    if (onOff) last = null;
  }

  // what the players see of the country (everything public; nothing to change)
  function town(now = clock()) {
    const w = get();
    if (!w) return { on, started: false, now, nation: NPC.nation };
    const P = w.P, day = w.day;
    const person = (i) => (i >= 0 ? { i, name: w.card(i, day).name } : null);
    const news = q('SELECT day, at, kind, district, text FROM npc_news ORDER BY id DESC LIMIT 40').all();
    const spent = corp && corp.npcSpent ? corp.npcSpent(now) : {};
    return {
      on, started: true, now, minute: w.minute, first: w.first, active: NPC.activeAt(now, w.first, hw(w)), next: NPC.nextActive(now, w.first, hw(w)),
      nation: { ...NPC.nation, cash: w.nation.cash, debt: w.nation.debt, fund: w.nation.fund.cash + w.nation.fund.bonds, knobs: w.nation.knobs, pending: w.nation.pending, log: w.nation.log.slice(-12), month: w.nation.month, budget: w.cal.publicWorks },
      stats: { ...w.stats, population: P.n },
      districts: w.districts.map((d, k) => ({ id: k, name: d.name, look: NPC.districts[k].look, mayor: person(d.mayor), approval: Math.round(d.approval), platform: d.platform, since: d.since, until: d.until, economy: Math.round(d.economy * 1000) / 1000, people: w.stats.byDistrict ? w.stats.byDistrict[k] : 0, speech: d.mayor >= 0 ? ai.text('speech', `${k}:${d.since}`) : null })),
      politics: {
        campaign: w.pol.campaign ? { from: w.pol.campaign.from, to: w.pol.campaign.to, cands: w.pol.campaign.cands.map((c) => ({ ...person(c.i), district: c.district, platform: c.platform, incumbent: c.incumbent })) } : null,
        elections: w.pol.elections.slice(-10).reverse(), petitions: w.pol.petitions.filter((p) => p.state === 'open' || p.state === 'won').map((p) => ({ id: p.id, title: p.title, scope: p.scope, district: p.district, count: p.count, start: p.start, state: p.state, leader: person(p.leader) })),
        votes: w.pol.votes.slice(-8).reverse(), council: w.pol.council.slice(-3).reverse(), marches: w.pol.marches.slice(-6)
      },
      labor: { unions: Object.fromEntries(Object.entries(w.lab.unions).map(([id, u]) => [id, { members: u.members, state: u.state, demand: u.demand, offer: u.offer, raise: u.raise, days: u.days, rep: person(u.rep) }])) },
      // (and what the people spent at each in the last 30 days the companies closed: server/core/corp.js npcSpent)
      companies: NPC.companies.map((id) => { const o = w.orgs[id]; return { id, name: CORP.company(id).name, ceo: person(o ? o.ceo : -1), president: person(o ? o.president : -1), staff: w.staffOf(id).length, spent: spent[id] || 0, ventures: o ? o.ventures.filter((v) => v.stage !== 'closed').map((v) => ({ name: v.name, customers: v.customers, stage: v.stage })) : [] }; }),
      // (the 32 local companies: server/core/npc-local.js)
      locals: localView(w),
      news, talk: (w.talkFeed || []).slice(-20).reverse(), live: liveStats(w), frame: b64(frame(w)), n: P.n
    };
  }
  // a person's card (the famous with their posts and a part of their life's book)
  function personCard(i, deep = false) {
    const w = get();
    if (!w || !(i >= 0 && i < w.P.n)) throw new ApiError(404, 'no_person', 'この人は見つかりません');
    const P = w.P, day = w.day, c = w.card(i, day);
    const out = { ...c, district: NPC.districts[c.district].name, at: NPC.districts[c.at] ? NPC.districts[c.at].name : '' };
    const famous = P.flags[i] & (pop.FL.famous | pop.FL.mayor | pop.FL.exec | pop.FL.rich);
    if (famous || deep) {
      out.life = memories(w, i, day).slice(0, deep ? 32 : 5);
      const voice = ai.text('voice', `${c.id}`);
      if (voice) out.voice = voice;
    }
    if (deep) Object.assign(out, details(w, i, day));
    return out;
  }
  const MEMS = { 1: 'カジノで大勝ち', 2: 'カジノで大負け', 3: '車を買った', 4: '仕事を失った', 5: '就職した', 6: '大切な人を亡くした', 7: '結婚した', 8: '選挙に当選', 9: 'ストライキに参加', 10: '路上生活になった',
    11: 'ローンを組んだ', 12: '昇進した', 13: '株で儲けた', 14: '株で損をした', 15: '名作ゲームに出会った', 16: '新しいサービスを使った', 17: '引っ越した', 18: 'デモに参加', 19: '新しい人生が始まった', 20: '暮らしを立て直した', 21: '選挙に落選', 22: '投票に行った', 23: '会社を辞めた', 24: '定年を迎えた', 25: '気晴らしに買いまくった', 26: '買いすぎを後悔した', 27: '日用品を買いだめした', 28: '自分へのご褒美', 29: '友だちの新車がうらやましかった' };
  function memories(w, i, day) {
    const P = w.P, out = [];
    for (let k = 0; k < pop.MEMS; k++) {
      const v = pop.memoryAt(P, i, k);
      if (!v) continue;
      const ago = ((day & 0xffff) - v.day + 65536) % 65536;
      out.push({ what: MEMS[v.kind] || '出来事', ago, power: v.power });
    }
    return out.sort((a, b) => a.ago - b.ago);
  }
  function details(w, i, day) {
    const P = w.P, tr = {}, sk = {}, need = {}, emo = {}, disc = {};
    for (const [k, x] of Object.entries(pop.T)) tr[k] = P.tr[i * pop.NT + x];
    for (const [k, x] of Object.entries(pop.S)) sk[k] = P.sk[i * 8 + x];
    for (const [k, x] of Object.entries(pop.N)) need[k] = P.need[i * pop.NN + x];
    for (const [k, x] of Object.entries(pop.E)) emo[k] = P.emo[i * 5 + x];
    NPC.themes.forEach((t, k) => { disc[t.id] = P.disc[i * 8 + k]; });
    const rel = [];
    for (let k = 0; k < pop.REL; k++) { const j = P.rel[i * pop.REL + k]; if (j >= 0) rel.push({ i: j, name: w.card(j, day).name, close: P.close[i * pop.REL + k], trust: P.rtrust[i * pop.REL + k], family: P.hh[j] === P.hh[i] && P.hh[i] >= 0 }); }
    const holds = {};
    LISTED_IDS.forEach((id, k) => { if (P.sh[i * pop.LISTED + k]) holds[id] = P.sh[i * pop.LISTED + k]; });
    for (const [id, list] of Object.entries(w.priv)) for (const [j, s] of list) if (j === i) holds[id] = s;
    const reasons = q("SELECT data FROM npc_reports WHERE company = '' AND kind = 'reason' ORDER BY id DESC LIMIT 200").all().map((r) => JSON.parse(r.data)).filter((x) => x.i === i && x.id === pop.pid(P, i)).slice(0, 8);
    return {
      traits: tr, skills: sk, needs: need, feelings: emo, discontent: disc, lean: { size: P.lean[i * 2], change: P.lean[i * 2 + 1] }, health: Math.round(P.health[i] / 1.275 - 100),
      money: { cash: P.cash[i], debt: P.debt[i], loan: ['', '通常', 'クイックローン'][P.dkind[i]], credit: P.credit[i], budget: P.budget[i], funds: Array.from(P.fund.subarray(i * 4, i * 4 + 4)), income: P.inc[i], spent: P.spent[i], tokens: P.tokens[i] },
      work: { job: NPC.jobNames[P.job[i]], rank: NPC.ranks[P.rank[i]].name, salary: P.salary[i], tenure: P.tenure[i], satisfaction: P.jsat[i], union: !!(P.flags[i] & pop.FL.union), striking: !!(P.flags[i] & pop.FL.striking) },
      pension: { months: P.penM[i], pay: P.penPay[i], exempt: P.penHalf[i], monthly: P.penAmt[i], deferring: !!(P.flags[i] & pop.FL.defer) },
      home: { kind: ['賃貸', '持ち家', '家族と同居', '居候', '路上'][P.home[i]], rent: P.rent[i], host: P.host[i] >= 0 ? w.card(P.host[i], day).name : null },
      car: P.car[i] ? (carByIndex(P.car[i]) || {}).name : null, vip: P.vip[i] > day, phone: P.phone[i] ? '停止中' : '利用中', holds, relations: rel, reasons,
      // (the mind: its feelings, what they expect and have learnt, today's plan, the five ways, 消費観 — npc-heart.js)
      mind: heart.view(w, i),
      // (one of the 300: what their AI chose last and why — npc-elite.js)
      ai: elite.viewOf(w, i)
    };
  }

  /* ---------------------------------------------------------------- the routes --- */
  const started = () => { if (!get()) throw new ApiError(409, 'npc_not_started', 'NPCの国はまだ始まっていません'); };
  const playerRoutes = {
    // the 街ライブ: the country now (only to look at)
    'GET /api/town': () => town(),
    'GET /api/town/person': (req, u) => {
      started();
      const now = clock(), k = u.id, l = looks.get(k);
      if (l && l.at > now - 3600000 && l.n >= LOOKS) throw new ApiError(429, 'too_many', `人のカードを見られるのは1時間に${LOOKS}回までです`);
      looks.set(k, l && l.at > now - 3600000 ? { at: l.at, n: l.n + 1 } : { at: now, n: 1 });
      if (looks.size > 5000) looks.clear();
      return { person: personCard(Number(req.query.get('i'))), now };
    },
    'POST /api/town/watch': async (req, u) => { const body = await req.json(); watch(u.id, !!body.on); return { ok: true, now: clock() }; }
  };
  const routes = (see, need, isDeveloper) => ({
    // アスカ国 now: what its people are doing, by district, and the day's money so far (asked every few seconds while
    // its page is open: small, never in the 街's `rev`)
    'GET /api/ops/npc/asuka': (req, u) => {
      see(u);
      const w = get(), now = clock();
      if (!w || !w.asuka) return { live: null, now };
      return { live: asukaModel.liveView(w), minute: w.minute, now };
    },
    'GET /api/ops/npc': (req, u) => {
      see(u);
      const w = get(), now = clock();
      if (!w) return { started: false, on, now, population: N };
      const days = q('SELECT day, data FROM npc_days WHERE day >= ? ORDER BY day').all(w.day - 90).map((r) => ({ day: r.day, ...JSON.parse(r.data) }));
      const all = { ...town(now), frame: undefined, days, knobs: NPC.knobs.map((k) => ({ ...k, value: NPC.knobOf(w, k.id), changed: w.nation.changed[k.id] || 0 })),
        // (what the companies decided themselves: their fees, MAGITA's surcharge, Tenesice's rates and phone bill)
        decided: { fees: feesOf(corp.world()), surcharge: policyDto().surcharge, rates: w.bankRates, quick: econ.quickRate(w), phone: Math.round(NPC.life.phone * econ.priceOf(w, 'tenesice:mobile')), cpi: econ.cpi(w), rentIdx: econ.rentIdx(w) },
        nationFull: { cash: w.nation.cash, debt: w.nation.debt, bank: w.nation.bank, fund: w.nation.fund, day: w.nation.day, month: w.nation.month, hist: w.nation.hist.slice(-60) },
        sector: w.sector, sum: w.sum, cal: w.cal, rates: w.bankRates, stock: w.stock, depth: w.depth, paused: !!w.paused,
        usage: { ticks, tickMs: ticks ? Math.round(tickMs / ticks * 10) / 10 : 0, saves, ai: { ...ai.used(now), on: ai.on, elite: elite.summary(w) }, server: usage() },
        // (the two countries' GDP: server/core/npc-gdp.js)
        gdp: model.gdpView(w),
        // (the times' mood and the prices: server/core/npc-macro.js)
        macro: model.macroView(w),
        // (アスカ国, and the money ledger: every $ from someone to someone)
        asuka: asukaModel.view(w), research: research.view(w), hachi: hachiView(w), welfare: welfareView(w), fund: (corp.world() || {}).fund || null, ipDeals: dealsView(w), wages: wagesView(w), ledger: w.ledger ? { base: w.ledger.base, founded: w.ledger.founded || 0, drift: w.ledger.drift, worst: w.ledger.worst || 0, at: w.ledger.at, days: w.ledger.days.slice(-30),
          players: w.ledger.players ? { drift: w.ledger.players.drift, worst: w.ledger.players.worst || 0, days: w.ledger.players.days.slice(-30) } : null } : null };
      return { ...partOf(all, req.query.get('rev')), now };
    },
    // 地方企業 (the operator site's 企業 folder): the 32 local companies, their specs and their state now (server/core/npc-local.js)
    'GET /api/ops/npc/locals': (req, u) => {
      see(u);
      const w = get(), now = clock();
      if (!w) return { started: false, now };
      return { ...partOf({ started: true, day: w.day, locals: localDetail(w) }, req.query.get('rev')), now };
    },
    // the people: by name (kanji or kana), district, employer
    'GET /api/ops/npc/people': (req, u) => {
      see(u);
      started();
      const w = get(), P = w.P, day = w.day;
      const qs = String(req.query.get('q') || '').trim(), dist = req.query.get('d'), job = req.query.get('j'), page = Math.max(0, Number(req.query.get('p')) || 0);
      const out = [];
      let found = 0;
      for (let i = 0; i < P.n; i++) {
        if (dist !== null && dist !== '' && P.dist[i] !== Number(dist)) continue;
        if (job !== null && job !== '' && P.job[i] !== Number(job)) continue;
        if (qs) { const nm = pop.nameOf(P, i); if (!nm.name.replace(' ', '').includes(qs.replace(/\s/g, '')) && !nm.kana.replace(' ', '').includes(qs.replace(/\s/g, ''))) continue; }
        if (found++ < page * 50 || out.length >= 50) continue;
        out.push(w.card(i, day));
      }
      return { people: out, found, now: clock() };
    },
    'GET /api/ops/npc/person': (req, u) => { see(u); started(); return { person: personCard(Number(req.query.get('i')), true), now: clock() }; },
    // 少数精鋭集団アルファ (the operator site's アルファ app): its members, today's talk and orders, its days (one in full
    // with ?day=: kept here, else from R2)
    'GET /api/ops/npc/alpha': async (req, u) => {
      see(u);
      const w = get(), now = clock();
      if (!w) return { started: false, now };
      const day = req.query.get('day');
      if (day !== null && day !== '') return { day: await alphaDay(Number(day)), now };
      const kept = q('SELECT day, r2 FROM npc_alpha ORDER BY day DESC LIMIT ?').all(NPC.alpha.keep).map((r) => ({ day: r.day, r2: !!r.r2 }));
      return { ...partOf({ ...alphaModel.view(w, ctx()), kept, ai: ai.on, r2: !!(blobs && blobs()) }, req.query.get('rev')), now };
    },
    // a company's people: its executives, departments, named posts, meetings, reports, new businesses, labs, union
    'GET /api/ops/npc/org': (req, u) => {
      see(u);
      started();
      const id = String(req.query.get('c') || '');
      if (!NPC.companies.includes(id)) throw new ApiError(400, 'bad_company', '会社を選んでください');
      const w = get(), o = w.orgs[id], day = w.day, nm = (i) => (i >= 0 ? { i, name: w.card(i, day).name } : null);
      const before = Number(req.query.get('before')) || Number.MAX_SAFE_INTEGER;
      const all = {
        id, name: o.name, ceo: nm(o.ceo), president: nm(o.president), officers: o.officers.map(nm), staff: w.staffOf(id).length,
        depts: o.depts.map((d, k) => ({ key: d.key, name: d.name, kind: d.kind, size: w.staffOf(id).filter((i) => w.P.dept[i] === k).length, head: nm(d.head), managers: d.managers.slice(0, 6).map(nm), named: d.roles.map(([key, name]) => ({ key, name, who: nm(d.named[key] ?? -1) })) })),
        labs: o.labs.map((l) => ({ ...l, head: nm(l.head), theme: (NPC.labThemes.find((t) => t.id === l.theme) || { name: l.theme }).name })),
        ventures: o.ventures.map((v) => ({ ...v, staff: v.staff.length, lead: nm(v.lead), announce: `${o.name}の新事業「${v.name}」が始まりました。` })),
        think: o.think.slice(-30).reverse().map((t) => ({ ...t, name: w.card(t.i, day).name })),
        union: w.lab.unions[id], terms: (w.terms || {})[id] || null, lend: (w.lend || {})[id] || null,
        // (a 社長 of the 300: run by its AI — its last 社長決裁 and why: npc-boss.js)
        boss: { ai: boss.aiBoss(w, id), last: boss.lastOf(w, id) },
        meetings: q('SELECT id, data FROM npc_meetings WHERE company = ? AND id < ? ORDER BY id DESC LIMIT 30').all(id, before).map((r) => ({ rid: r.id, ...JSON.parse(r.data) })),
        reports: q('SELECT id, data FROM npc_reports WHERE company = ? ORDER BY id DESC LIMIT 30').all(id).map((r) => ({ rid: r.id, ...JSON.parse(r.data) }))
      };
      return { ...partOf(all, req.query.get('rev')), now: clock() };
    },
    // (運営 once set the knobs' ranges and values here: no more — refused)
    'POST /api/ops/npc/knob': async (req, u) => {
      need(u);
      // (the country's taxes and budgets are its council's and its people's, the companies' prices and pay their own:
      // 運営 sets none of them, and no range on any)
      throw new ApiError(410, 'autonomous', '税・予算は国（議会と市民投票）が、給与・料金・金利は各企業が自分で決めます。運営は変更できません');
    },
    // 運営's switches: the country paused (its people still, the companies' days going on), the depth of its thinking
    'POST /api/ops/npc/control': async (req, u) => {
      need(u);
      if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', 'この操作は開発者だけができます');
      const body = await req.json();
      started();
      tx(() => {
        const w = get();
        if (body.paused !== undefined) w.paused = !!body.paused;
        if (body.depth !== undefined) { if (body.depth === 'auto') w.depthFixed = false; else if (DEPTHS.includes(body.depth)) { w.depth = body.depth; w.depthFixed = true; } }
        save('hot');
        if (opsLog) opsLog.add({ action: 'npc_control', summary: `NPCの国：${body.paused !== undefined ? (body.paused ? '一時停止' : '再開') : `考える深さ＝${body.depth}`}`, detail: body });
      });
      return { ok: true, now: clock() };
    }
  });

  // the Cloudflare host's AI, after a wake (outside the transaction), for the 300 alone (NPC.elite): アルファ's 10's talk
  // a few messages a wake; what the country asked to have written (a new mayor's speech, a CEO's advice); the 300's own
  // choices, a batch at a time as far as the day's AI money goes; アルファ's days copied to R2
  async function writeAi(now = clock()) {
    let n = 0;
    if (ai.on) { try { n += await alphaTalk(now); } catch (e) { console.error('alpha talk failed', e); } }
    try { await alphaR2(now); } catch (e) { console.error('alpha r2 failed', e); }
    if (!ai.on) return n;
    const w = get();
    if (w && w.ai.length) { const jobs = w.ai.splice(0).map((j) => jobOf(w, j)).filter(Boolean); n += await ai.run(jobs, now); }
    try { n += await eliteThink(now); } catch (e) { console.error('elite ai failed', e); }
    try { n += await bossThink(now); } catch (e) { console.error('boss ai failed', e); }
    return n;
  }
  // 社長のAI (server/core/npc-boss.js): a company whose 社長 is one of the 300, once a day, told of its company as it is
  // that moment and choosing its 社長決裁 with the stronger model — two companies a wake at most, within the paced money
  async function bossThink(now) {
    let n = 0;
    for (let step = 0; step < 2; step++) {
      const w = get();
      if (!w) break;
      const room = ai.cap * paced(now, w) - ai.used(now).neurons, c = ctx();
      const id = room > 0 ? boss.due(w, c, w.day) : null;
      if (!id) break;
      const list = boss.options(w, id, c, w.day, seeded(w.key, `boss:${w.day}:${id}`)), p = boss.prompt(w, id, c, w.day, list);
      const said = await ai.ask(NPC.elite.topModel, 'boss', `${w.day}:${id}`, p.system, p.user, p.max, now, room);
      const w2 = get();
      if (!w2) break;
      tx(() => {
        // (no answer: its turn tomorrow — the 社長 decides without the AI today, at its meetings)
        boss.decide(w2, id, list, said || '', ctx(), w2.day, seeded(w2.key, `boss!:${w2.day}:${id}`));
        save('hot');
      });
      if (!said) break;
      n++;
    }
    return n;
  }
  // what the AI may have spent of the (UTC) day by now: a share of it as the people's hours go (NPC.elite.pace minutes
  // ahead), all of it by their end — nothing before they begin
  function paced(now, w) {
    const h = NPC.hoursOf(now, w.first, hw(w)), t = NPC.jst(now).min;
    if (t < h[0]) return 0;
    return Math.min(1, (t - h[0] + NPC.elite.pace) / Math.max(1, h[1] - h[0]));
  }
  // 選ばれし300人's choices (server/core/npc-elite.js): those whose turn it is, a batch of one tier a call (the 10 first,
  // then the 90, then the rest), up to six calls a wake, as far as the paced money goes
  async function eliteThink(now) {
    let n = 0;
    for (let step = 0; step < 6; step++) {
      const w = get();
      if (!w) break;
      const room = ai.cap * paced(now, w) - ai.used(now).neurons;
      // (their turns as often as the day's money allows: npc-elite.js speed)
      if (step === 0) { const h = NPC.hoursOf(now, w.first, hw(w)); elite.speed(w, ai.cap, h[1] - h[0]); }
      const job = room > 0 ? elite.due(w, w.minute) : null;
      if (!job) break;
      const gens = job.list.map((i) => w.P.gen[i]);
      const board = job.tier !== 'elite' && w.alpha && w.alpha.today ? w.alpha.today.board : null;
      const p = elite.prompt(w, job.tier, job.list, w.day, board);
      const said = await ai.ask(NPC.elite.model, 'elite', `${w.day}:${job.tier}:${job.list[0]}`, p.system, p.user, p.max, now, room);
      const w2 = get();
      if (!w2) break;
      tx(() => {
        // (what they chose to do at once, done by the engine with the day's prices and a draw of the minute's)
        if (said) elite.apply(w2, job.tier, job.list, said, w2.day, w2.minute, NPC.elite.model, gens, { ctx: ctx(), r: seeded(w2.key, `elite:${w2.minute}:${job.list[0]}`) });
        else elite.later(w2, job.list, w2.minute, 10);
        save('hot');
      });
      if (!said) break;
      n++;
    }
    return n;
  }
  // 少数精鋭集団アルファ's talk (server/core/npc-alpha.js): its 10, each in their way, a message at a time (up to four a
  // wake) until the 15〜25 are said, the one with the most last with the conclusion. Each kept at once; the first order
  // in before it is done: the model's own words and plan stand (and what the AI had said is kept with them)
  const ALPHA_SYSTEM = 'あなたは架空の国「ヴェルノア共和国」の株式投資家集団「アルファ」の会議で発言するメンバーです。実在の人物・企業・市場は扱わず、ゲームの中の架空の話として書きます。グループの決まり（最大2社・売買は合計2回まで・上限の範囲で資産の比率で拠出）を守り、株価・理論株価・配当・値動き・メンバーの見通し・これまでの損益を根拠に、自分の投資スタイルで考えてください。日本語の話し言葉で、1〜2文・40〜120文字、数字に触れて発言してください。前の人の発言に答えても構いません。発言の本文だけを書いてください。';
  const ALPHA_WAY = { value: '配当と理論株価から見た割安さ（ファンダメンタル）を重んじます。', swing: '短期の値動きと下げた後のリバウンド（反発）を狙います。', infra: '国の土台を支える企業の安定性と、値動きの小ささを重んじます。' };
  function alphaPrompt(j) {
    const pc = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`, $ = (x) => CORP.fmt.money(Math.round(x));
    const cap = NPC.alpha.cap * ((get() || {}).scale || 1);
    const lines = j.board.map((b) => `- ${b.name}（id: ${b.id}）株価${$(b.price)}・前日比${pc(b.r1)}・5日${pc(b.r5)}・20日${pc(b.r20)}・日々の変動${(b.vol * 100).toFixed(1)}%・理論株価${$(b.fair)}・配当利回り${(b.yield * 100).toFixed(1)}%・アルファの保有${b.held ? `${$(b.held * b.price)}（含み${pc(b.gain)}）` : 'なし'}`);
    const who = j.talkers.map((t) => `${t.rank}. ${t.name}（${t.styleName}）`).join('、');
    const said = j.msgs.slice(-10).map((x) => `${x.name}：${x.text}`).join('\n') || '（まだ誰も発言していません）';
    // (what the 90 think of each company — their own AI's view, npc-elite.js — and the group's record so far)
    const w0 = get(), G = w0 && w0.alpha, views = {};
    if (w0 && w0.eliteAi && G) for (const m of G.members) { const x = w0.eliteAi.last[m.i]; if (x && x.view) for (const [id, v] of Object.entries(x.view)) (views[id] || (views[id] = [])).push(v); }
    const mood = Object.entries(views).map(([id, vs]) => `${id} ${(vs.reduce((a, b) => a + b, 0) / vs.length >= 0 ? '+' : '')}${(vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(1)}（${vs.length}人）`).join('・');
    const record = G && G.sum ? `アルファのこれまで：${G.sum.days}日・確定損益${$(G.sum.realized)}・手数料${$(G.sum.fees)}` : '';
    let ask = `あなたは${j.who.name}（${j.who.styleName}）です。${ALPHA_WAY[j.who.style] || ''}次の発言をしてください。`;
    if (j.k === 0) ask = `あなたは議長の${j.who.name}（${j.who.styleName}）です。今日の議題を短く切り出し、あなたの考えを一言添えてください。`;
    if (j.last) ask = `あなたは議長の${j.who.name}です。議論をまとめて最終結論を出してください。最後の行は必ず「結論：買い magita 60、買い tenesice 40」のように、買い/売り・銘柄のid・割合(%)の形で書いてください（最大2社・合計2件まで。売りはアルファが保有している銘柄だけ。割合は買いならその日の資金の何%、売りなら保有の何%か）。`;
    return `今日の議題：今日・今週に重点的に投資する企業を決める（最大2社・売買は全員で合計2回まで・投資しない日はなし・1日の上限は全体で${$(cap)}を資産の比率で拠出）。\n銘柄：\n${lines.join('\n')}\n${mood ? `メンバー90人の見通し（−2〜+2の平均）：${mood}\n` : ''}${record ? `${record}\n` : ''}参加者（資産順）：${who}\nこれまでの発言（${j.k}件目まで、全${j.target}件の予定）：\n${said}\n\n${ask}`;
  }
  const alphaClean = (t) => String(t || '').replace(/^[「『"]|[」』"]$/g, '').replace(/^[^：:\n]{1,12}[：:]\s*/, (m) => (/結論/.test(m) ? m : '')).trim().slice(0, 300);
  async function alphaTalk(now) {
    let n = 0;
    for (let step = 0; step < 4; step++) {
      const w = get(), job = w && alphaModel.talkJob(w);
      if (!job) break;
      const said = await ai.say('alpha', `${job.day}:${job.k}`, ALPHA_SYSTEM, alphaPrompt(job), job.last ? 220 : 140, now);
      if (!said) break;
      const w2 = get(), j2 = w2 && alphaModel.talkJob(w2);
      if (!j2 || j2.day !== job.day || j2.k !== job.k) break;
      tx(() => {
        const d = w2.alpha.today;
        d.talk.status = 'talking';
        d.talk.msgs.push({ i: job.who.i, name: job.who.name, style: job.who.style, text: alphaClean(said), ai: true, ...(job.last ? { last: true } : {}) });
        if (job.last) alphaModel.heard(w2, job.day, d.talk.msgs, said);
        save('hot');
      });
      n++;
    }
    return n;
  }
  // its days to R2 (the bucket the host has: none, kept here only), 70 of them there too — the older taken out once a day
  let alphaPruned = -1;
  async function alphaR2(now) {
    const b = blobs && blobs();
    if (!b) return;
    const rows = q('SELECT day, data FROM npc_alpha WHERE r2 = 0 ORDER BY day LIMIT 3').all();
    for (const r of rows) {
      const bytes = new TextEncoder().encode(r.data), sha = crypto.createHash('sha256').update(bytes).digest('hex');
      if (await b.put(`npc-alpha/${r.day}.json`, bytes, sha)) q('UPDATE npc_alpha SET r2 = 1 WHERE day = ? AND data = ?').run(r.day, r.data);
    }
    const w = get(), today = w ? w.day : Math.floor(now / 86400000);
    if (alphaPruned === today || !b.list || !b.del) return;
    alphaPruned = today;
    const old = (await b.list('npc-alpha/')).map((o) => o.key).filter((k) => Number(k.slice(10, -5)) < today - NPC.alpha.keep);
    if (old.length) await b.del(old);
  }
  // one of its days in full: here, else from R2
  async function alphaDay(day) {
    const r = q('SELECT data FROM npc_alpha WHERE day = ?').get(day);
    if (r) return JSON.parse(r.data);
    const b = blobs && blobs(), o = b ? await b.get(`npc-alpha/${day}.json`) : null;
    return o ? JSON.parse(new TextDecoder().decode(o.bytes)) : null;
  }
  function jobOf(w, j) {
    const day = w.day;
    // (the AI writes for the 300 alone: a mayor or a CEO of theirs — server/core/npc-elite.js)
    const of300 = (i) => i >= 0 && i < w.P.n && !!(w.P.flags[i] & pop.FL.elite);
    if ((j.kind === 'speech' || j.kind === 'voice') && !of300(j.i)) return null;
    if (j.kind === 'decide' && !(w.orgs[j.company] && of300(w.orgs[j.company].ceo))) return null;
    if (j.kind === 'speech') { const c = w.card(j.i, day), d = w.districts[j.district]; return { kind: 'speech', ref: `${j.district}:${d.since}`, district: d.name, name: c.name, platform: (j.platform || []).map((id) => (NPC.platforms.find((p) => p.id === id) || {}).name).join('・') }; }
    if (j.kind === 'voice') { const c = w.card(j.i, day); return { kind: 'voice', ref: `${c.id}`, name: c.name, age: c.age, job: c.posts[0] || c.job, mood: c.voice }; }
    if (j.kind === 'decide') return { kind: 'decide', ref: `${j.company}:${j.day}`, company: j.name, state: j.state, options: j.options };
    return null;
  }

  function housekeep(now = clock()) {
    const w = get();
    q('DELETE FROM npc_news WHERE at < ?').run(now - KEEP_NEWS * 86400000);
    q('DELETE FROM npc_meetings WHERE id < (SELECT COALESCE(MAX(id), 0) FROM npc_meetings) - ?').run(KEEP_MEETINGS * 10);
    q('DELETE FROM npc_reports WHERE id < (SELECT COALESCE(MAX(id), 0) FROM npc_reports) - ?').run(KEEP_REPORTS * 10);
    q('DELETE FROM stock_npc WHERE at < ?').run(Math.floor(now / 1000) - 3 * 86400);
    q('DELETE FROM npc_ai WHERE at < ?').run(now - 60 * 86400000);
    if (w) q('DELETE FROM npc_days WHERE day < ?').run(w.day - KEEP_DAYS);
  }

  return {
    on, booted, ensure, wake, due, beforeClose, afterClose, cross, spentToday, carBought, carStock, watch, town, personCard, policy: policyDto, housekeep, writeAi,
    playerRoutes, routes, world: get,
    // (the 32 local companies' days in brief: 運営's report of the 45, server/core/corp.js)
    localReport: () => { const w = get(); return w ? localReport(w) : null; },
    // (MY WAY's contracts with the local companies and the two countries: the people's side keeps them)
    ipDeals: () => { const w = get(); return w ? dealsView(w) : null; },
    // (a company's pay against the market's and its 引き抜き: the people's side keeps them — npc-wages.js)
    wageOf: (id) => { const w = get(), v = w ? wagesView(w) : null; if (!v || !v.companies[id]) return null; const by = (v.poach.last && v.poach.last.by) || {}, mb = v.poach.month.by || {};
      const sum = (o, side) => Object.entries(o).reduce((n, [k, x]) => n + (k.split('>')[side] === id ? x : 0), 0);
      return { ...v.companies[id], idx: v.idx, aim: v.aim, took: { last: sum(by, 0), month: sum(mb, 0) }, lost: { last: sum(by, 1), month: sum(mb, 1) } }; },
    // (the tests: the minutes and the days worked out now, and what was kept)
    runTo: (m) => tx(() => { runTo(m, Infinity); save('hot'); })
  };
}
