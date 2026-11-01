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
import * as pop from './npc-pop.js';
import * as text from './npc-text.js';
import { createAi } from './npc-ai.js';
import { LISTED_IDS } from './npc-market.js';
import { fmtKnob } from './npc-politics.js';
import { peopleSpent } from './corp-model.js';

const MIN = 60000;
const MAX_TICKS = 240;               // minutes worked out in one wake at most (the rest the next)
const SAVE_EVERY = 5;                // the people's money kept every this many minutes
const WATCH_MS = 70000;              // a 街ライブ watcher's word holds its frames this long
const LOOKS = 30;                    // a player's looks at a person's card an hour
const KEEP_NEWS = 120, KEEP_MEETINGS = 400, KEEP_REPORTS = 600, KEEP_DAYS = 800;
const DEPTHS = ['shallow', 'standard', 'deep', 'deepest'];
const b64 = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');

export function createNpc({ q, tx, afterCommit, clock = Date.now, secret, config = {}, corp, stocks = () => null, live = null, opsIds = () => [], playersHeld = () => ({}), ai: binding = null, usage = () => 0, opsLog = null }) {
  const on = config.npc !== false;
  const N = Math.max(500, Math.min(NPC.nation.population, Number(config.npcPopulation) || NPC.nation.population));
  const key = keyFrom(secret, 'npc');
  const ai = createAi({ binding, q, clock, daily: Number(config.npcAiNeurons) || 10000, share: 0.9, model: config.npcAiModel || undefined });
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
    const w = Object.assign(m, { P, key });
    model.attach(w);
    return w;
  }
  function get() {
    if (stale) {
      W = load();
      stale = false;
      if (W) { policy(W); homecoming(W); }
    }
    return W;
  }
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
    const rows = pop.pack(w.P, kind !== 'all');
    rows.forEach((r, k) => q('INSERT INTO npc_blob (part, data) VALUES (?, ?) ON CONFLICT(part) DO UPDATE SET data = excluded.data').run(`${prefix}:${String(k).padStart(3, '0')}`, r));
    q('DELETE FROM npc_blob WHERE part >= ? AND part < ?').run(`${prefix}:${String(rows.length).padStart(3, '0')}`, prefix + ';');
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
  function policy(w) {
    const k = w.nation.knobs;
    RULES.casino.winFee = (k.winFee ?? 6) / 100;
    RULES.casino.exchangeFee = k.exchangeFee ?? 40000;
    STOCKS.feeBp = Math.round((k.tradeFee ?? 1.8) * 100);
    CORP.players.jobFee = (k.jobFee ?? 25) / 100;
    CORP.magita.surcharge.amount = Math.min(3000000, k.magitaSurcharge ?? 3000000);
  }
  const policyDto = () => ({ winFee: RULES.casino.winFee, exchangeFee: RULES.casino.exchangeFee, feeBp: STOCKS.feeBp, jobFee: CORP.players.jobFee, surcharge: CORP.magita.surcharge.amount });

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
  }

  /* ---------------------------------------------------------------- the minutes --- */
  function ctx() {
    const w = corp.world(), now = clock(), sale = carSale(now);
    const fair = {};
    if (w) for (const id of LISTED_IDS) { const s = w.co[id]; if (s && s.mkt) fair[id] = s.mkt.fair; }
    return {
      corp: w, fair,
      carPrice: (id) => { const c = RULES.cars.find((x) => x.id === id); return c ? carPrice(c, sale, 0, corp.surcharge(id)).price : 0; },
      stockPrice: (id) => prices.get(id) || 0,
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
      if (w.paused || !NPC.activeAt(m * MIN, w.first)) {
        const next = w.paused ? target + 1 : Math.floor(NPC.nextActive(m * MIN, w.first) / MIN);
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
    tune();
  }
  // when the host should wake next: the next minute the people are about
  function due(now = clock()) {
    if (!on) return Infinity;
    const w = get();
    // (not begun: as soon as the companies are, never before)
    if (!w) return corp.booted() ? now + 1000 : Infinity;
    return Math.max(now + 1000, NPC.nextActive(now + 1000, w.first) + 2000);
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
    policy(w);
    q('INSERT INTO npc_days (day, data) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data').run(d + 1, JSON.stringify({
      stats: w.stats, nation: { cash: w.nation.cash, debt: w.nation.debt, bank: w.nation.bank, fund: w.nation.fund, in: w.nation.day.in, out: w.nation.day.out },
      districts: w.districts.map((x) => ({ cash: x.cash, approval: Math.round(x.approval), mayor: x.mayor, economy: x.economy })), sector: w.sector.cash, sum: w.sum
    }));
    // (the thoughts of a few of those the town talks about, for the AI to write while it has room)
    if (ai.on) for (const o of Object.values(w.orgs).slice(0, 10)) if (o.ceo >= 0 && (d + o.ceo) % 3 === 0) w.ai.push({ kind: 'voice', i: o.ceo });
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
    return { acts: Array.from(acts), mood: w.stats.mood, unemployment: w.stats.unemployment, homeless: w.stats.homeless, economy: w.stats.economy, prices: w.stats.prices, active: NPC.activeAt(clock(), w.first) };
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
      on, started: true, now, minute: w.minute, first: w.first, active: NPC.activeAt(now, w.first), next: NPC.nextActive(now, w.first),
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
      out.life = memories(w, i, day).slice(0, deep ? 16 : 5);
      const voice = ai.text('voice', `${c.id}`);
      if (voice) out.voice = voice;
    }
    if (deep) Object.assign(out, details(w, i, day));
    return out;
  }
  const MEMS = { 1: 'カジノで大勝ち', 2: 'カジノで大負け', 3: '車を買った', 4: '仕事を失った', 5: '就職した', 6: '大切な人を亡くした', 7: '結婚した', 8: '選挙に当選', 9: 'ストライキに参加', 10: '路上生活になった',
    11: 'ローンを組んだ', 12: '昇進した', 13: '株で儲けた', 14: '株で損をした', 15: '名作ゲームに出会った', 16: '新しいサービスを使った', 17: '引っ越した', 18: 'デモに参加', 19: '新しい人生が始まった', 20: '暮らしを立て直した', 21: '選挙に落選', 22: '投票に行った', 23: '会社を辞めた', 24: '定年を迎えた' };
  function memories(w, i, day) {
    const P = w.P, out = [];
    for (let k = 0; k < pop.MEM; k++) {
      const v = P.mem[i * pop.MEM + k];
      if (!v) continue;
      const kind = (v >> 8) & 0xff, ago = ((day & 0xffff) - (v >>> 16) + 65536) % 65536;
      out.push({ what: MEMS[kind] || '出来事', ago, power: v & 0xff });
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
      traits: tr, skills: sk, needs: need, feelings: emo, discontent: disc, lean: { size: P.lean[i * 2], change: P.lean[i * 2 + 1] }, health: P.health[i],
      money: { cash: P.cash[i], debt: P.debt[i], loan: ['', '通常', 'クイックローン'][P.dkind[i]], credit: P.credit[i], budget: P.budget[i], funds: Array.from(P.fund.subarray(i * 4, i * 4 + 4)), income: P.inc[i], spent: P.spent[i], tokens: P.tokens[i] },
      work: { job: NPC.jobNames[P.job[i]], rank: NPC.ranks[P.rank[i]].name, salary: P.salary[i], tenure: P.tenure[i], satisfaction: P.jsat[i], union: !!(P.flags[i] & pop.FL.union), striking: !!(P.flags[i] & pop.FL.striking) },
      pension: { months: P.penM[i], pay: P.penPay[i], exempt: P.penHalf[i], monthly: P.penAmt[i], deferring: !!(P.flags[i] & pop.FL.defer) },
      home: { kind: ['賃貸', '持ち家', '家族と同居', '居候', '路上'][P.home[i]], rent: P.rent[i], host: P.host[i] >= 0 ? w.card(P.host[i], day).name : null },
      car: P.car[i] ? (RULES.cars.filter((c) => c.price > 0 && !c.ended)[P.car[i] - 1] || {}).name : null, vip: P.vip[i] > day, phone: P.phone[i] ? '停止中' : '利用中', holds, relations: rel, reasons
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
    'GET /api/ops/npc': (req, u) => {
      see(u);
      const w = get(), now = clock();
      if (!w) return { started: false, on, now, population: N };
      const days = q('SELECT day, data FROM npc_days WHERE day >= ? ORDER BY day').all(w.day - 90).map((r) => ({ day: r.day, ...JSON.parse(r.data) }));
      const all = { ...town(now), frame: undefined, days, knobs: NPC.knobs.map((k) => ({ ...k, value: NPC.knobOf(w, k.id), range: w.nation.ranges[k.id] || [k.min, k.max], locked: !!w.nation.locks[k.id], changed: w.nation.changed[k.id] || 0 })),
        nationFull: { cash: w.nation.cash, debt: w.nation.debt, bank: w.nation.bank, fund: w.nation.fund, day: w.nation.day, month: w.nation.month, hist: w.nation.hist.slice(-60) },
        sector: w.sector, sum: w.sum, cal: w.cal, rates: w.bankRates, stock: w.stock, depth: w.depth, paused: !!w.paused,
        usage: { ticks, tickMs: ticks ? Math.round(tickMs / ticks * 10) / 10 : 0, saves, ai: { ...ai.used(now), on: ai.on }, server: usage() } };
      return { ...partOf(all, req.query.get('rev')), now };
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
        ventures: o.ventures.map((v) => ({ ...v, staff: v.staff.length, lead: nm(v.lead), announce: ai.text('venture', v.id) })),
        think: o.think.slice(-30).reverse().map((t) => ({ ...t, name: w.card(t.i, day).name })),
        union: w.lab.unions[id], terms: (w.terms || {})[id] || null, lend: (w.lend || {})[id] || null,
        meetings: q('SELECT id, data FROM npc_meetings WHERE company = ? AND id < ? ORDER BY id DESC LIMIT 30').all(id, before).map((r) => ({ rid: r.id, ...JSON.parse(r.data) })),
        reports: q('SELECT id, data FROM npc_reports WHERE company = ? ORDER BY id DESC LIMIT 30').all(id).map((r) => ({ rid: r.id, ...JSON.parse(r.data) }))
      };
      return { ...partOf(all, req.query.get('rev')), now: clock() };
    },
    // 運営 sets what the council and the people may change (a knob's range, a lock, or its value from next month)
    'POST /api/ops/npc/knob': async (req, u) => {
      need(u);
      if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', 'この操作は開発者だけができます');
      const body = await req.json();
      started();
      const k = NPC.knob[String(body.id || '')];
      if (!k) throw new ApiError(400, 'bad_knob', '項目を選んでください');
      const w = get();
      tx(() => {
        const ww = get();
        if (body.range) {
          const lo = Number(body.range[0]), hi = Number(body.range[1]);
          if (!(lo <= hi) || lo < k.min - (k.player ? 0 : k.max) || (k.player && lo < k.start / 2)) throw new ApiError(400, 'bad_range', '範囲が正しくありません');
          ww.nation.ranges[k.id] = [lo, hi];
        }
        if (body.lock !== undefined) ww.nation.locks[k.id] = !!body.lock;
        if (body.value !== undefined) {
          const v = Number(body.value);
          if (!Number.isFinite(v)) throw new ApiError(400, 'bad_value', '値が正しくありません');
          ww.nation.pending = ww.nation.pending.filter((p) => p.id !== k.id);
          if (body.now) {
            // (at once: the knob as it is from now, what it rescales rescaled)
            // (運営 may go past the range; a level no lower than −95%, money and rates not below 0, the players' fees not
            // below half of where they began)
            const floor = k.player ? k.start / 2 : k.unit === '%' && (k.id.startsWith('pay:') || k.id === 'livingCost' || k.id === 'rentLevel') ? -95 : k.unit === '$' || k.id === 'quickRate' ? 0 : -Infinity;
            const was = NPC.knobOf(ww, k.id), to = Math.round(Math.max(floor, v) / k.step) * k.step;
            ww.nation.knobs[k.id] = to;
            if (ww.knobChanged && to !== was) ww.knobChanged(k.id, was, to);
            ww.nation.changed[k.id] = ww.day;
            ww.nation.log.push({ day: ww.day, id: k.id, from: was, to, by: 'ops' });
            ww.news.push({ day: ww.day, kind: 'knob', district: -1, text: `今日から${k.name}が${fmtKnob(k.id, was)}→${fmtKnob(k.id, to)}に（運営）`, data: { id: k.id } });
            policy(ww);
          } else {
            const t = CORP.ymd(ww.day);
            ww.nation.pending.push({ id: k.id, to: v, from: t.m === 12 ? CORP.dayAt(t.y + 1, 1, 1) : CORP.dayAt(t.y, t.m + 1, 1), by: 'ops', day: ww.day });
          }
        }
        save('hot');
        if (opsLog) opsLog.add({ action: 'npc_knob', summary: `NPCの国：${k.name}の設定を変更${body.now && body.value !== undefined ? '（今すぐ）' : ''}`, detail: { id: k.id, range: body.range, lock: body.lock, value: body.value, now: !!body.now } });
      });
      void w;
      return { ok: true, now: clock() };
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

  // the Cloudflare host's AI, after a wake (outside the transaction): what the country asked to have written
  async function writeAi(now = clock()) {
    const w = get();
    if (!w || !ai.on || !w.ai.length) return 0;
    const jobs = w.ai.splice(0).map((j) => jobOf(w, j)).filter(Boolean);
    return ai.run(jobs, now);
  }
  function jobOf(w, j) {
    const day = w.day;
    if (j.kind === 'speech') { const c = w.card(j.i, day), d = w.districts[j.district]; return { kind: 'speech', ref: `${j.district}:${d.since}`, district: d.name, name: c.name, platform: (j.platform || []).map((id) => (NPC.platforms.find((p) => p.id === id) || {}).name).join('・') }; }
    if (j.kind === 'voice') { const c = w.card(j.i, day); return { kind: 'voice', ref: `${c.id}`, name: c.name, age: c.age, job: c.posts[0] || c.job, mood: c.voice }; }
    if (j.kind === 'venture') { const o = w.orgs[j.company], v = o && o.ventures.find((x) => x.id === j.venture); return v ? { kind: 'venture', ref: v.id, company: o.name, name: v.name } : null; }
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
    // (the tests: the minutes and the days worked out now, and what was kept)
    runTo: (m) => tx(() => { runTo(m, Infinity); save('hot'); })
  };
}
