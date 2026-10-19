// 金の生る木 on the server: every player's trees (the first one comes free),
// the money given to them, the harvest cycles and the auctions for more trees.
// Everything is decided here; the game only shows it (js/ui/tree.js).
//
// A tree earns TREE.rateOf(given) $ a second while a harvest cycle runs; the
// money grown stops at the end of the cycle and waits to be harvested (times
// the cycle's multiplier, times RULES.tree.superMult for a SUPER tree). The
// cycle cannot be changed or harvested before it is over. Money can be given
// at any time (what grew so far is counted at the old rate first).
//
// Auctions are English auctions against NPC bidders, each with a hidden
// limit around the market's average price (now and then one who wants it
// badly): a player who keeps bidding pays about the highest limit, so the
// average winning price is the market's, but it may be well below it or far
// above. The NPCs' moves are worked out when the auction is looked at (the
// game asks twice a second while it is open), so nothing runs in between.
import { ApiError, posInt } from './errors.js';
import { RULES, TREE } from './rules.js';

const T = RULES.tree;
const CLOSE_MS = 6000;              // no new bid for this long: sold (going, going, gone)
const FIRST_MS = 1500;              // the first NPC bid after the start
const DELAY = [600, 2000];          // an NPC answers a bid after this long (ms)
const OPEN = 0.55;                  // the opening price, of the average
// the NPCs' limits, of the average: exp(N(MU, SIGMA)), now and then a big buyer
const MU = -0.21, SIGMA = 0.13, WHALE = 0.12;

const KINDS = ['ガジュマル', 'パキラ', 'オリーブ', 'カネノナルキ', 'モンステラ', 'オーク', 'メープル', 'イチョウ', 'バオバブ', 'サクラ'];
const ADJ = ['幸運の', '黄金の', '大富豪の', '星降る', '夜明けの', '王様の', '虹色の', '伝説の', '月光の', '宝石の'];
const BIDDERS = ['ゴールド伯爵', 'ミセス・リッチ', '株王タナカ', '謎の投資家X', 'マダム・ジュエル', '石油王アリ', 'ロイヤル佐藤', 'ミスター・ダイヤ', 'カジノ王ベガス', '富豪エリザベス', '若社長ケンジ', 'ドクター・マネー'];

// (getRandomValues: the same on Node and Cloudflare Workers)
function rand() {
  const r = new Uint32Array(1);
  globalThis.crypto.getRandomValues(r);
  return r[0] / 4294967296;
}
const pick = (a) => a[Math.floor(rand() * a.length)];
function gauss() {
  let u = 0, v = 0;
  while (!u) u = rand();
  while (!v) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function createTrees({ q, tx, getUser, balance, balanceChanged }) {
  const treeRows = (userId) => q('SELECT * FROM trees WHERE user_id = ? ORDER BY id').all(userId);
  // everyone has one tree to start with
  function treesOf(userId) {
    let rows = treeRows(userId);
    if (!rows.length) {
      q("INSERT INTO trees (user_id, name, created_at) VALUES (?, '金の生る木', ?)").run(userId, Date.now());
      rows = treeRows(userId);
    }
    return rows;
  }
  function treeOf(userId, id) {
    const t = q('SELECT * FROM trees WHERE id = ? AND user_id = ?').get(posInt(id, '木'), userId);
    if (!t) throw new ApiError(404, 'no_tree', 'この木は見つかりません');
    return t;
  }

  // the money grown up to `now` (none after the cycle is over)
  function grownNow(t, now) {
    if (!t.cycle) return t.grown;
    const until = Math.min(now, t.cycle_end);
    return t.grown + Math.max(0, until - t.grown_at) / 1000 * TREE.rateOf(t.given);
  }
  const boostOf = (t) => (t.super ? T.superMult : 1);
  function dto(t, now = Date.now()) {
    const c = TREE.cycleOf(t.cycle);
    const grown = grownNow(t, now);
    const rate = TREE.rateOf(t.given);
    const stage = TREE.stageOf(t.given);
    const mult = c ? c.mult * boostOf(t) : boostOf(t);
    return {
      id: t.id,
      name: t.name,
      super: !!t.super,
      given: t.given,
      rate,
      stage,
      next: stage < T.stages.length ? T.stages[stage] : 0,
      cycle: c ? { id: c.id, at: t.cycle_at, end: t.cycle_end, mult: c.mult } : null,
      // grown so far, and what the harvest will pay now / at the end of the cycle
      grown,
      value: Math.floor(grown * mult),
      expected: c ? Math.floor((grown + Math.max(0, t.cycle_end - now) / 1000 * rate) * mult) : 0,
      ready: !!c && now >= t.cycle_end,
      harvested: t.harvested,
      price: t.price,
      at: now            // the server time all this is for (the game counts on from it)
    };
  }
  function saveGrowth(t, now) {
    if (!t.cycle) return;
    const g = grownNow(t, now);
    q('UPDATE trees SET grown = ?, grown_at = ? WHERE id = ?').run(g, Math.min(now, t.cycle_end), t.id);
  }
  function startCycle(t, id, now) {
    const c = TREE.cycleOf(id);
    if (!c) throw new ApiError(400, 'bad_cycle', '収穫の時期を選んでください');
    q('UPDATE trees SET cycle = ?, cycle_at = ?, cycle_end = ?, grown = 0, grown_at = ? WHERE id = ?').run(c.id, now, now + c.ms, now, t.id);
  }

  /* ------------------------------------------------------------ auctions --- */
  const liveRow = (userId) => q("SELECT * FROM tree_auctions WHERE user_id = ? AND status = 'live' ORDER BY id DESC LIMIT 1").get(userId);
  const lastRow = (userId) => q('SELECT * FROM tree_auctions WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);
  const willing = (s) => s.npcs.map((n, i) => (i + 1 !== s.leader && n.limit >= s.price + s.step ? i : -1)).filter((i) => i >= 0);
  const delay = () => DELAY[0] + Math.floor(rand() * (DELAY[1] - DELAY[0]));
  function bid(s, who, price, at) {
    s.price = price;
    s.leader = who;
    s.close = at + CLOSE_MS;
    s.bids.push({ who, price, at });
    if (s.bids.length > 14) s.bids.splice(0, s.bids.length - 14);
    s.next = willing(s).length ? at + delay() : 0;
  }
  // an NPC raises: a few steps while the price is low, one step near its limit
  function npcMove(s, at) {
    const who = pick(willing(s));
    const n = s.npcs[who];
    const k = s.price < s.avg * 0.8 ? 1 + Math.floor(rand() * 3) : 1;
    const top = Math.floor(n.limit / s.step) * s.step;
    bid(s, who + 1, Math.max(s.price + s.step, Math.min(top, s.price + k * s.step)), at);
  }
  // The auction up to `now`: the NPCs' bids, and the hammer when nobody bids for CLOSE_MS.
  function advance(row, now) {
    if (row.status !== 'live') return row;
    const s = JSON.parse(row.state);
    let status = 'live';
    for (;;) {
      const npcAt = s.next && willing(s).length ? s.next : Infinity;
      if (npcAt <= now && npcAt <= s.close) { npcMove(s, npcAt); continue; }
      if (s.close <= now) { status = s.leader === 0 ? 'won' : 'lost'; s.ended = s.close; break; }
      break;
    }
    if (status === 'won') return finish(row, s);
    if (status === 'lost') s.winner = s.leader > 0 ? s.npcs[s.leader - 1].name : '';
    q('UPDATE tree_auctions SET state = ?, status = ?, price = ?, ended_at = ? WHERE id = ?')
      .run(JSON.stringify(s), status, s.price, status === 'live' ? 0 : s.ended, row.id);
    return { ...row, state: JSON.stringify(s), status, price: s.price, settled: status !== 'live' };
  }
  // the hammer fell on my bid: pay and plant (the SUPER mark shows now)
  function finish(row, s) {
    const cur = getUser(row.user_id);
    let status = 'won';
    if (!cur || cur.dollars < s.price) {
      status = 'unpaid';
    } else if (treeRows(cur.id).length >= T.max) {
      status = 'full';
    } else {
      q('UPDATE users SET dollars = dollars - ?, rev = rev + 1 WHERE id = ?').run(s.price, cur.id);
      const name = (s.lot.super ? 'SUPER ' : '') + s.lot.name;
      const id = Number(q('INSERT INTO trees (user_id, name, super, given, price, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(cur.id, name, s.lot.super ? 1 : 0, s.lot.given, s.price, s.ended).lastInsertRowid);
      s.tree = id;
      s.paid = s.price;
      s.bought = true;
    }
    q('UPDATE tree_auctions SET state = ?, status = ?, price = ?, ended_at = ? WHERE id = ?').run(JSON.stringify(s), status, s.price, s.ended, row.id);
    return { ...row, state: JSON.stringify(s), status, price: s.price, settled: true };
  }
  function auctionDto(row, now = Date.now()) {
    if (!row) return null;
    const s = JSON.parse(row.state);
    const done = row.status !== 'live';
    const won = row.status === 'won';
    const t = won && s.tree ? q('SELECT * FROM trees WHERE id = ?').get(s.tree) : null;
    return {
      id: row.id,
      market: row.market,
      status: row.status,
      // what is sold: the look and the name (SUPER only once it is mine)
      lot: { name: won && s.lot.super ? 'SUPER ' + s.lot.name : s.lot.name, stage: TREE.stageOf(s.lot.given), given: s.lot.given, super: won ? !!s.lot.super : undefined },
      avg: s.avg,
      step: s.step,
      price: s.price,
      leader: s.leader === 0 ? 'me' : s.leader > 0 ? s.npcs[s.leader - 1].name : null,
      bidders: s.npcs.map((n) => n.name),
      bids: s.bids.slice(-8).map((b) => ({ who: b.who === 0 ? 'me' : s.npcs[b.who - 1].name, price: b.price, at: b.at })),
      closeIn: done ? 0 : Math.max(0, s.close - now),
      closeMs: CLOSE_MS,
      winner: s.winner || null,
      tree: t ? dto(t, now) : null,
      now
    };
  }
  function open(userId, market) {
    const m = T.markets[market];
    if (!m) throw new ApiError(400, 'bad_market', '市場を選んでください');
    const owned = treesOf(userId).length;
    if (owned >= T.max) throw new ApiError(409, 'full', `金の生る木は${T.max}本までです`);
    const avg = TREE.averagePrice(market, owned);
    const step = Math.max(10000, Math.round(avg * 0.01 / 10000) * 10000);
    // grown trees come at least one look further on
    let given = 0;
    if (market === 'grown') {
      const st = 1 + 1 + Math.floor(rand() * 3);                       // looks 2..4
      const lo = T.stages[st - 1], hi = T.stages[st];
      given = Math.round((lo + rand() * (hi - lo) * 0.9) / 1000) * 1000;
    }
    const lot = { name: pick(ADJ) + pick(KINDS) + (market === 'seed' ? 'の種' : ''), given, super: rand() < T.superChance };
    const npcs = shuffle(BIDDERS.slice()).slice(0, 3 + Math.floor(rand() * 3)).map((name) => ({ name, limit: Math.round(avg * Math.exp(MU + SIGMA * gauss())) }));
    if (rand() < WHALE) npcs[0].limit = Math.max(npcs[0].limit, Math.round(avg * (1.25 + rand() * 0.5)));
    const now = Date.now();
    const s = { avg, step, price: Math.round(avg * OPEN / step) * step, leader: -1, npcs, lot, bids: [], next: now + FIRST_MS, close: now + FIRST_MS + CLOSE_MS };
    const id = Number(q('INSERT INTO tree_auctions (user_id, market, state, price, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, market, JSON.stringify(s), s.price, now).lastInsertRowid);
    return q('SELECT * FROM tree_auctions WHERE id = ?').get(id);
  }
  // the auction I am in (or the last one, to show how it ended)
  function current(userId, now = Date.now()) {
    const row = liveRow(userId);
    return row ? advance(row, now) : null;
  }
  function after(userId, row) {
    const cur = getUser(userId);
    return { auction: auctionDto(row), balance: balance(cur) };
  }

  const routes = {
    'GET /api/tree': (req, u) => {
      const now = Date.now();
      const r = tx(() => {
        const a = current(u.id, now);
        return { trees: treesOf(u.id).map((t) => dto(t, now)), auction: a ? auctionDto(a, now) : null, paid: !!(a && a.settled && a.status === 'won') };
      });
      if (r.paid) balanceChanged(u.id);
      return { trees: r.trees, auction: r.auction, now };
    },

    // one tap: give `amount` (one of RULES.tree.amounts) to a tree
    'POST /api/tree/give': async (req, u) => {
      const body = await req.json();
      const amount = Number(body.amount);
      if (!T.amounts.includes(amount)) throw new ApiError(400, 'bad_amount', 'あげる金額を選んでください');
      const now = Date.now();
      const r = tx(() => {
        const t = treeOf(u.id, body.tree);
        const cur = getUser(u.id);
        if (cur.dollars < amount) throw new ApiError(409, 'insufficient', '$が足りません');
        saveGrowth(t, now);
        q('UPDATE trees SET given = given + ? WHERE id = ?').run(amount, t.id);
        q('UPDATE users SET dollars = dollars - ?, rev = rev + 1 WHERE id = ?').run(amount, cur.id);
        return { tree: dto(q('SELECT * FROM trees WHERE id = ?').get(t.id), now), balance: balance(getUser(u.id)) };
      });
      balanceChanged(u.id, true);
      return r;
    },

    // the harvest cycle starts (picked once; harvested when it is over)
    'POST /api/tree/start': async (req, u) => {
      const body = await req.json();
      const now = Date.now();
      return tx(() => {
        const t = treeOf(u.id, body.tree);
        if (t.cycle) throw new ApiError(409, 'growing', 'この木は育成中です。収穫の時期まで待ってください');
        if (t.given <= 0) throw new ApiError(409, 'no_money', '先にお金をあげて育ててください');
        startCycle(t, String(body.cycle || ''), now);
        return { tree: dto(q('SELECT * FROM trees WHERE id = ?').get(t.id), now) };
      });
    },

    // the cycle is over: the money comes in and the next cycle starts (`next`, else the same)
    'POST /api/tree/harvest': async (req, u) => {
      const body = await req.json();
      const now = Date.now();
      const r = tx(() => {
        const t = treeOf(u.id, body.tree);
        const c = TREE.cycleOf(t.cycle);
        if (!c) throw new ApiError(409, 'not_growing', 'まだ育てはじめていません');
        if (now < t.cycle_end) throw new ApiError(409, 'not_ready', 'まだ収穫できません（収穫の時期まで待ってください）');
        const paid = Math.floor(grownNow(t, now) * c.mult * boostOf(t));
        q('UPDATE users SET dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(paid, u.id);
        q('UPDATE trees SET harvested = harvested + ? WHERE id = ?').run(paid, t.id);
        startCycle(t, TREE.cycleOf(String(body.next || '')) ? String(body.next) : c.id, now);
        return { paid, tree: dto(q('SELECT * FROM trees WHERE id = ?').get(t.id), now), balance: balance(getUser(u.id)) };
      });
      balanceChanged(u.id, true);
      return r;
    },

    /* ----- auctions ----- */
    'GET /api/tree/auction': (req, u) => {
      const now = Date.now();
      const row = tx(() => current(u.id, now) || lastRow(u.id));
      const r = after(u.id, row);
      if (row && row.settled && row.status === 'won') balanceChanged(u.id);
      return r;
    },

    'POST /api/tree/auction/start': async (req, u) => {
      const body = await req.json();
      const row = tx(() => {
        if (current(u.id)) throw new ApiError(409, 'busy', '参加中の競りがあります');
        return open(u.id, String(body.market || ''));
      });
      return after(u.id, row);
    },

    // one more step (or `steps` of them) over the current price
    'POST /api/tree/auction/bid': async (req, u) => {
      const body = await req.json();
      const steps = Math.min(10, Math.max(1, Math.floor(Number(body.steps) || 1)));
      const now = Date.now();
      const row = tx(() => {
        const a = current(u.id, now);
        if (!a || a.status !== 'live') throw new ApiError(409, 'over', 'この競りは終わりました');
        const s = JSON.parse(a.state);
        if (s.leader === 0) throw new ApiError(409, 'leading', 'いまあなたが最高額です');
        const price = s.price + steps * s.step;
        if (getUser(u.id).dollars < price) throw new ApiError(409, 'insufficient', '$が足りません（入札には $' + price.toLocaleString('ja-JP') + ' 必要です）');
        bid(s, 0, price, now);
        q('UPDATE tree_auctions SET state = ?, price = ? WHERE id = ?').run(JSON.stringify(s), s.price, a.id);
        return { ...a, state: JSON.stringify(s), price: s.price };
      });
      return after(u.id, row);
    },

    // dropping out (nothing is paid)
    'POST /api/tree/auction/leave': (req, u) => {
      const now = Date.now();
      const row = tx(() => {
        const a = current(u.id, now);
        if (!a || a.status !== 'live') return lastRow(u.id);
        q("UPDATE tree_auctions SET status = 'left', ended_at = ? WHERE id = ?").run(now, a.id);
        return { ...a, status: 'left' };
      });
      return after(u.id, row);
    }
  };

  return { routes, treesOf, dto };
}
