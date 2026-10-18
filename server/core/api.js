// The game's JSON API, independent of the host. Every balance change happens
// inside one SQLite transaction and bumps the player's `rev`, so clients can
// drop stale balance updates. Nothing here ever resets a balance.
//
//   const api = createApi({ db, live, config, secret, hostAdmin })
//   await api.handle(req)  // req: { method, path, query, header(name), ip, json(limit) }
//                          // -> { status, body }
//
// `live` pushes events to connected players: send(userId, event, data),
// broadcast(event, data, filter), isOnline(userId), onlineCount().
// `hostAdmin(cmd, args)` may answer operator commands only one host has
// (it returns undefined for the rest).
import { ApiError, posInt } from './errors.js';
import { statements } from './db.js';
import {
  newToken, sha256, newRecoveryCode, normalizeRecoveryCode, nameKey, cleanName, cleanText,
  cleanPassword, hashPassword, verifyPassword, signTicket, verifyTicket
} from './auth.js';
import { Limiter } from './ratelimit.js';
import { RULES, AVATARS, CARS, SHOP, FRUITS, spin as spinReels, iconSale, itemSale, utcDay, nextUtcMidnight, loginDay, nextLoginReset, fmt } from './rules.js';
import { createAdmin } from './admin.js';
import { createPeter, reservedName } from './peter.js';
import { createQuota, isQuotaError, maintenanceBody } from './quota.js';

const PAGE = 50;
const LOBBY_KEEP = 500;
const CURRENCIES = ['tokens', 'dollars'];
// 1:1 calls (稼ぎに招待) and "home" (the voice call of a player and everyone watching them)
const CALL_TYPES = new Set(['invite', 'accept', 'decline', 'busy', 'cancel', 'hangup', 'signal', 'home']);
const MAX_PENDING_REQUESTS = 50;
const CHARM = RULES.charm;

function randomInt(lo, hi) {
  const r = new Uint32Array(1);
  globalThis.crypto.getRandomValues(r);
  return lo + (r[0] % (hi - lo + 1));
}

export function createApi({ db, live: hostLive, config, secret, hostAdmin = null }) {
  const q = statements(db);
  const tx = (fn) => db.tx(fn);
  const quota = createQuota(db, { requests: config.dailyRequestLimit, megabytes: config.dailyMbLimit });
  // live pushes count towards the bytes sent (only when a cap is set)
  const live = !quota.on ? hostLive : {
    ...hostLive,
    send(userId, event, data) { quota.sent(JSON.stringify(data).length + 32); return hostLive.send(userId, event, data); },
    broadcast(event, data, filter) { quota.sent((JSON.stringify(data).length + 32) * hostLive.onlineCount()); return hostLive.broadcast(event, data, filter); },
    isOnline: (id) => hostLive.isOnline(id),
    onlineCount: () => hostLive.onlineCount()
  };
  const start = {
    tokens: config.startTokens ?? RULES.start.tokens,
    dollars: config.startDollars ?? RULES.start.dollars,
    coins: config.startCoins ?? RULES.start.coins
  };
  // [refills per minute, burst]
  const LIMITS = {
    register: [config.registerPerMinute, Math.max(1, Math.ceil(config.registerPerMinute / 2))],
    login: [10, 5],
    nameCheck: [60, 20],
    spin: [120, 6],
    shop: [60, 10],
    lobby: [20, 4],
    dm: [40, 8],
    transfer: [10, 5],
    friend: [30, 10],
    call: [600, 120],
    tip: [240, 40],
    read: [240, 30],
    general: [600, 60],
    ...config.limits
  };
  const limit = {};
  for (const [k, [perMinute, burst]] of Object.entries(LIMITS)) limit[k] = new Limiter(perMinute, burst);

  /* ---------------------------------------------------------------- helpers */

  const getUser = (id) => q('SELECT * FROM users WHERE id = ?').get(id);
  const findByName = (raw) => q('SELECT * FROM users WHERE name_key = ?').get(nameKey(raw));
  const dmChannel = (a, b) => `dm:${Math.min(a, b)}:${Math.max(a, b)}`;
  const isBlocked = (userId, otherId) => !!q('SELECT 1 AS x FROM blocks WHERE user_id = ? AND blocked_id = ?').get(userId, otherId);
  const areFriends = (a, b) => !!q('SELECT 1 AS x FROM friends WHERE user_id = ? AND friend_id = ?').get(a, b);
  const hasRequest = (from, to) => !!q('SELECT 1 AS x FROM friend_requests WHERE from_id = ? AND to_id = ?').get(from, to);
  const ownedAvatars = (u) => (u.avatars ? u.avatars.split(',') : []);
  const carCount = (id) => q('SELECT COUNT(*) AS n FROM cars WHERE owner_id = ?').get(id).n;
  const itemCount = (userId, item) => { const r = q('SELECT count FROM items WHERE user_id = ? AND item = ?').get(userId, item); return r ? r.count : 0; };
  function addItems(userId, item, n) {
    q(`INSERT INTO items (user_id, item, count) VALUES (?, ?, ?)
       ON CONFLICT(user_id, item) DO UPDATE SET count = items.count + excluded.count`).run(userId, item, n);
    q('DELETE FROM items WHERE user_id = ? AND count <= 0').run(userId);
  }
  function itemsOf(userId) {
    const out = {};
    for (const r of q('SELECT item, count FROM items WHERE user_id = ?').all(userId)) out[r.item] = r.count;
    return out;
  }
  // the watchers of `hostId` (everyone in their home)
  const watcherIds = (hostId) => q('SELECT watcher_id FROM watchers WHERE target_id = ?').all(hostId).map((r) => r.watcher_id);
  const watching = (userId) => { const r = q('SELECT target_id FROM watchers WHERE watcher_id = ?').get(userId); return r ? r.target_id : 0; };
  // in a home: watching someone, or watched by someone
  const inHome = (userId) => !!watching(userId) || !!q('SELECT 1 AS x FROM watchers WHERE target_id = ? LIMIT 1').get(userId);

  const peter = createPeter({ q, tx, getUser, insertMessage, msgDto, touchConversations, unreadTotal, live, balanceChanged, dmChannel });
  peter.id();

  function balance(u) { return { tokens: u.tokens, dollars: u.dollars, coins: u.coins, rev: u.rev }; }
  function mini(u) { return { id: u.id, name: u.name, avatar: u.avatar }; }

  function meDto(u) {
    const today = utcDay();
    return {
      id: u.id,
      name: u.name,
      avatar: u.avatar,
      avatars: AVATARS.size ? [...AVATARS.values()].filter((a) => a.price === 0 || ownedAvatars(u).includes(a.id)).map((a) => a.id) : [],
      ...balance(u),
      totalWon: u.total_won,
      totalBet: u.total_bet,
      biggestWin: u.biggest_win,
      spins: u.spins,
      dayWon: u.won_day === today ? u.day_won : 0,
      boughtToday: u.bought_day === today ? u.bought_today : 0,
      dailyReady: u.free_day !== today,
      hasPassword: !!u.password_hash,
      cars: carCount(u.id),
      items: itemsOf(u.id),
      charm: u.charm > 0,
      debt: peter.owed(u.id),
      createdAt: u.created_at
    };
  }

  // Being logged in for any moment of a day (6:00 to 6:00 Japan time) counts
  // as a login day; the first one of each day pays that day's bonus in spin
  // tokens (1st..4th day, then over again). Returns what was paid, once a day.
  function loginBonus(userId) {
    if (!config.loginBonus) return null;
    const day = loginDay();
    const days = RULES.loginBonus.days;
    const paid = tx(() => {
      const cur = getUser(userId);
      if (!cur || cur.npc || cur.login_day === day) return null;
      const n = cur.login_days + 1;
      const step = (n - 1) % days.length;
      q('UPDATE users SET login_day = ?, login_days = ?, tokens = tokens + ?, rev = rev + 1 WHERE id = ?').run(day, n, days[step], cur.id);
      return { day: step + 1, amount: days[step], days, loginDays: n, next: nextLoginReset() };
    });
    if (paid) balanceChanged(userId);
    return paid;
  }

  // Today's prices in the Shop (always on sale too).
  function itemShop() {
    const day = utcDay();
    return {
      day,
      until: nextUtcMidnight(),
      items: [...SHOP.values()].map((i) => {
        const s = itemSale(i, day);
        return { id: i.id, price: i.price, salePrice: s.price, pct: s.pct, max: i.max };
      })
    };
  }

  // Today's prices of the paid icons (always on sale, see js/game/sale.js).
  function iconShop() {
    const day = utcDay();
    return {
      day,
      until: nextUtcMidnight(),
      items: [...AVATARS.values()].filter((a) => a.price > 0).map((a) => {
        const s = iconSale(a, day);
        return { id: a.id, price: a.price, salePrice: s.price, pct: s.pct };
      })
    };
  }

  function friendship(me, otherId) {
    if (me === otherId) return 'self';
    if (areFriends(me, otherId)) return 'friends';
    if (hasRequest(me, otherId)) return 'outgoing';
    if (hasRequest(otherId, me)) return 'incoming';
    return 'none';
  }

  function publicDto(u, viewerId) {
    const today = utcDay();
    return {
      id: u.id,
      name: u.name,
      avatar: u.avatar,
      npc: u.npc || null,
      totalWon: u.total_won,
      biggestWin: u.biggest_win,
      spins: u.spins,
      dayWon: u.won_day === today ? u.day_won : 0,
      createdAt: u.created_at,
      online: isOnline(u),
      rank: u.npc ? null : rankOf('total_won', u.total_won, u.id),
      cars: carCount(u.id),
      friendship: friendship(viewerId, u.id)
    };
  }

  // Peter is always there
  function isOnline(u) { return u.npc ? true : live.isOnline(u.id); }

  function rankOf(col, value, id) {
    return q(`SELECT COUNT(*) AS n FROM users WHERE banned = 0 AND npc = '' AND (${col} > ? OR (${col} = ? AND id < ?))`).get(value, value, id).n + 1;
  }

  function msgDto(m) {
    return {
      id: m.id,
      channel: m.channel,
      kind: m.kind,
      from: m.sender_id ? { id: m.sender_id, name: m.sender_name ?? null, avatar: m.sender_avatar ?? null } : null,
      to: m.recipient_id ?? null,
      text: m.body,
      amount: m.amount ?? null,
      currency: m.currency ?? null,
      at: m.created_at
    };
  }

  function insertMessage({ channel, sender, recipient = null, kind, body = '', amount = null, currency = null }) {
    const now = Date.now();
    const r = q('INSERT INTO messages (channel, sender_id, recipient_id, kind, body, amount, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(channel, sender ? sender.id : 0, recipient, kind, body, amount, currency, now);
    return {
      id: Number(r.lastInsertRowid), channel, sender_id: sender ? sender.id : 0, sender_name: sender ? sender.name : null,
      sender_avatar: sender ? sender.avatar : null, recipient_id: recipient, kind, body, amount, currency, created_at: now
    };
  }

  // A message in the conversation of a and b; `unreadFor` gets the unread mark.
  function touchConversations(a, b, msgId, unreadFor = b) {
    const now = Date.now();
    const up = q(`INSERT INTO conversations (user_id, other_id, last_id, unread, updated_at) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(user_id, other_id) DO UPDATE SET last_id = excluded.last_id,
                  unread = conversations.unread + excluded.unread, updated_at = excluded.updated_at`);
    up.run(a, b, msgId, unreadFor === a ? 1 : 0, now);
    up.run(b, a, msgId, unreadFor === b ? 1 : 0, now);
  }

  function unreadTotal(userId) {
    return q('SELECT COALESCE(SUM(unread), 0) AS n FROM conversations WHERE user_id = ?').get(userId).n;
  }
  function pendingRequests(userId) {
    return q('SELECT COUNT(*) AS n FROM friend_requests WHERE to_id = ?').get(userId).n;
  }

  // Delivers a direct-message row to both players (with the receiver's unread count).
  function deliverDm(m, from, to) {
    const dto = msgDto(m);
    live.send(to, 'msg', { ...dto, unread: unreadTotal(to) });
    live.send(from, 'msg', dto);
    return dto;
  }

  function rate(limiter, key, message) {
    if (!limiter.take(String(key))) throw new ApiError(429, 'rate_limited', message || '操作が速すぎます。少し待ってからもう一度お試しください');
  }

  function requireFriend(u, otherId, what) {
    if (!areFriends(u.id, otherId)) throw new ApiError(403, 'not_friends', `フレンドになると${what || '利用'}できます`);
  }

  function liveTarget(id) {
    const t = getUser(id);
    if (!t || t.banned) throw new ApiError(404, 'not_found', 'ユーザーが見つかりません');
    return t;
  }

  // Board refresh hint, at most every 2 seconds.
  let boardTimer = null;
  function boardChanged() {
    if (boardTimer) return;
    boardTimer = setTimeout(() => { boardTimer = null; live.broadcast('board', { at: Date.now() }); }, 2000);
    if (boardTimer.unref) boardTimer.unref();
  }

  // The other people in `hostId`'s home hear about a watcher coming or going.
  function homeChanged(hostId, who, on) {
    live.send(hostId, 'watch', { type: 'watched', by: who, on });
    for (const id of watcherIds(hostId)) if (id !== who.id) live.send(id, 'watch', { type: 'member', user: hostId, by: who, on });
  }

  function postLobbySystem(text) {
    const m = insertMessage({ channel: 'lobby', sender: null, kind: 'system', body: text });
    live.broadcast('msg', msgDto(m));
  }

  // Players watching `targetId`'s screen.
  function notifyWatchers(targetId, payload) {
    for (const w of q('SELECT watcher_id FROM watchers WHERE target_id = ?').all(targetId)) live.send(w.watcher_id, 'watch', payload);
  }

  // After any balance change: the player's other devices and their spectators follow.
  function balanceChanged(userId) {
    const u = getUser(userId);
    live.send(userId, 'balance', balance(u));
    notifyWatchers(userId, { type: 'balance', user: userId, balance: balance(u) });
    return u;
  }

  /* ---------------------------------------------------------------- auth */

  function authUser(req) {
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(String(req.header('authorization') || ''));
    if (!m) throw new ApiError(401, 'auth', 'ログインが必要です');
    const u = userForToken(m[1]);
    u.tokenHash = sha256(m[1]);
    return u;
  }

  // Also used by the live connection.
  function userForToken(token) {
    const h = sha256(token);
    const s = q('SELECT user_id, last_used FROM sessions WHERE token_hash = ?').get(h);
    if (!s) throw new ApiError(401, 'auth', 'ログインの有効期限が切れました');
    const u = getUser(s.user_id);
    if (!u) throw new ApiError(401, 'auth', 'アカウントが見つかりません');
    if (u.banned) throw new ApiError(403, 'banned', 'このアカウントは利用停止されています');
    const now = Date.now();
    if (now - u.last_seen > 60000) q('UPDATE users SET last_seen = ? WHERE id = ?').run(now, u.id);
    if (now - s.last_used > 3600000) q('UPDATE sessions SET last_used = ? WHERE token_hash = ?').run(now, h);
    return u;
  }

  function createSession(userId) {
    const token = newToken();
    const now = Date.now();
    q('INSERT INTO sessions (token_hash, user_id, created_at, last_used) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now, now);
    return token;
  }

  function nameProblem(raw) {
    let key;
    try { ({ key } = cleanName(raw)); } catch (e) { return e.message; }
    if (reservedName(key)) return 'この名前は使えません';
    if (q('SELECT 1 AS x FROM users WHERE name_key = ?').get(key)) return 'このユーザー名はすでに使われています';
    return null;
  }

  /* ---------------------------------------------------------------- ICE (voice chat) */

  let iceCache = null;
  async function iceServers() {
    const servers = [];
    if (config.stunUrls.length) servers.push({ urls: config.stunUrls });
    if (config.turnUrls.length) servers.push({ urls: config.turnUrls, username: config.turnUsername, credential: config.turnCredential });
    if (config.cfTurnKeyId && config.cfTurnToken) {
      if (iceCache && iceCache.until > Date.now()) return [...servers, ...iceCache.servers];
      try {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${config.cfTurnKeyId}/credentials/generate-ice-servers`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.cfTurnToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 86400 })
        });
        const j = await r.json();
        const list = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [];
        iceCache = { until: Date.now() + 3600000, servers: list };
        return [...servers, ...list];
      } catch (e) {
        console.error('TURN credentials failed', e);
      }
    }
    return servers;
  }

  /* ---------------------------------------------------------------- routes */

  const routes = {
    'GET /api/health': () => ({ ok: true, online: live.onlineCount() }),

    'GET /api/name-check': (req) => {
      rate(limit.nameCheck, req.ip);
      const problem = nameProblem(req.query.get('name'));
      return { available: !problem, problem };
    },

    'POST /api/register': async (req) => {
      if (config.registration !== 'open') throw new ApiError(403, 'closed', '現在、新規登録は受け付けていません');
      rate(limit.register, req.ip, '登録の試行が多すぎます。しばらく待ってからお試しください');
      const body = await req.json();
      const { name, key } = cleanName(body.name);
      const password = cleanPassword(body.password);
      const avatar = String(body.avatar || 'bald');
      const choice = AVATARS.get(avatar);
      if (!choice) throw new ApiError(400, 'bad_avatar', 'アイコンを選んでください');
      if (choice.price > 0) throw new ApiError(403, 'locked', 'このアイコンはレアのため、今は選べません');
      if (config.registrationsPerIp > 0) {
        const n = q('SELECT COUNT(*) AS n FROM users WHERE created_ip = ? AND created_at > ?').get(req.ip, Date.now() - 86400000).n;
        if (n >= config.registrationsPerIp) throw new ApiError(429, 'too_many_accounts', 'この接続からはこれ以上アカウントを作成できません');
      }
      if (reservedName(key)) throw new ApiError(409, 'name_taken', 'この名前は使えません');
      if (q('SELECT 1 AS x FROM users WHERE name_key = ?').get(key)) throw new ApiError(409, 'name_taken', 'このユーザー名はすでに使われています');
      const passwordHash = await hashPassword(password);
      const code = newRecoveryCode();
      let token, user;
      try {
        ({ token, user } = tx(() => {
          const now = Date.now();
          const r = q(`INSERT INTO users (name, name_key, recovery_hash, password_hash, avatar, tokens, dollars, coins, created_ip, created_at, last_seen)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(name, key, sha256(normalizeRecoveryCode(code)), passwordHash, avatar, start.tokens, start.dollars, start.coins, req.ip, now, now);
          const id = Number(r.lastInsertRowid);
          return { token: createSession(id), user: getUser(id) };
        }));
      } catch (e) {
        if (/UNIQUE/i.test(String(e && e.message))) throw new ApiError(409, 'name_taken', 'このユーザー名はすでに使われています');
        throw e;
      }
      boardChanged();
      return { token, recoveryCode: code, me: meDto(user) };
    },

    // name + password, or the recovery code
    'POST /api/login': async (req) => {
      rate(limit.login, req.ip, '試行回数が多すぎます。しばらく待ってからお試しください');
      const body = await req.json();
      let u;
      if (body.code !== undefined) {
        const code = normalizeRecoveryCode(body.code);
        if (code.length !== 16) throw new ApiError(400, 'bad_code', '引き継ぎコードは16文字です');
        u = q('SELECT * FROM users WHERE recovery_hash = ?').get(sha256(code));
        if (!u) throw new ApiError(404, 'bad_code', '引き継ぎコードが正しくありません');
      } else {
        u = findByName(body.name);
        const ok = u && u.password_hash && await verifyPassword(body.password, u.password_hash);
        if (!ok) {
          if (u && !u.password_hash) throw new ApiError(401, 'no_password', 'このアカウントはパスワードが未設定です。引き継ぎコードでログインしてください');
          throw new ApiError(401, 'bad_login', 'ユーザー名かパスワードが違います');
        }
      }
      if (u.banned) throw new ApiError(403, 'banned', 'このアカウントは利用停止されています');
      return { token: createSession(u.id), me: meDto(u) };
    },

    'POST /api/logout': (req, u) => {
      q('DELETE FROM sessions WHERE token_hash = ?').run(u.tokenHash);
      return { ok: true };
    },

    'POST /api/recovery': (req, u) => {
      const code = newRecoveryCode();
      q('UPDATE users SET recovery_hash = ? WHERE id = ?').run(sha256(normalizeRecoveryCode(code)), u.id);
      return { recoveryCode: code };
    },

    'POST /api/password': async (req, u) => {
      rate(limit.login, req.ip, '試行回数が多すぎます。しばらく待ってからお試しください');
      const body = await req.json();
      const password = cleanPassword(body.password);
      if (u.password_hash && !(await verifyPassword(body.current, u.password_hash))) {
        throw new ApiError(403, 'bad_password', '今のパスワードが違います');
      }
      q('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), u.id);
      return { me: meDto(getUser(u.id)) };
    },

    'GET /api/me': (req, u) => ({
      loginBonus: loginBonus(u.id),
      loginReset: nextLoginReset(),
      me: meDto(getUser(u.id)),
      unread: unreadTotal(u.id),
      friendRequests: pendingRequests(u.id),
      iconShop: iconShop(),
      itemShop: itemShop(),
      peter: peter.me(),
      online: live.onlineCount(),
      now: Date.now(),
      nextReset: nextUtcMidnight(),
      rules: {
        bets: RULES.bets, tokenPrice: RULES.tokenPrice, dailyLimit: RULES.dailyLimit, dailyFree: RULES.dailyFree,
        maxTransfer: { tokens: config.maxTransferTokens, dollars: config.maxTransferDollars }
      }
    }),

    'POST /api/spin': async (req, u) => {
      const body = await req.json();
      const bet = Number(body.bet);
      if (!RULES.bets.includes(bet)) throw new ApiError(400, 'bad_bet', 'ベット額が正しくありません');
      rate(limit.spin, u.id, 'スピンが速すぎます');
      const today = utcDay();
      const result = tx(() => {
        const cur = getUser(u.id);
        if (cur.tokens < bet) throw new ApiError(409, 'insufficient', 'スピントークンが不足しています');
        const r = spinReels(bet);
        // an お守り加護 that is on softens the first losing spin, then it is used up
        if (cur.charm > 0 && r.total < bet) {
          const pct = randomInt(1, 10000) <= CHARM.fullChance * 10000 ? 100 : randomInt(CHARM.min, CHARM.max);
          r.charm = { pct, back: Math.floor((bet - r.total) * pct / 100) };
        }
        const back = r.charm ? r.charm.back : 0;
        const dayWon = (cur.won_day === today ? cur.day_won : 0) + r.total;
        const last = JSON.stringify({ grid: r.grid, total: r.total, tier: r.tier, bet, at: Date.now() });
        q(`UPDATE users SET tokens = tokens - ? + ?, total_bet = total_bet + ?, total_won = total_won + ?,
           biggest_win = MAX(biggest_win, ?), spins = spins + 1, won_day = ?, day_won = ?, last_spin = ?, charm = ?, rev = rev + 1 WHERE id = ?`)
          .run(bet, r.total + back, bet, r.total, r.total, today, dayWon, last, r.charm ? 0 : cur.charm, cur.id);
        if (config.logSpins) {
          q('INSERT INTO spins (user_id, bet, payout, line, created_at) VALUES (?, ?, ?, ?, ?)').run(cur.id, bet, r.total + back, r.line.join(','), Date.now());
        }
        return r;
      });
      const after = getUser(u.id);
      const out = { grid: result.grid, line: result.line, wins: result.wins, total: result.total, tier: result.tier, mult: result.mult, bet, charm: result.charm || null };
      if (result.total > 0) boardChanged();
      if (result.tier >= 3) {
        postLobbySystem(`${after.name}さんが SUPER BIG WIN！ ${fmt(result.total)} トークン獲得（${Math.round(result.mult * 10) / 10}倍）`);
      }
      notifyWatchers(u.id, { type: 'spin', user: u.id, result: out, balance: balance(after) });
      peter.check(u.id);
      return {
        result: out,
        balance: balance(after),
        charm: after.charm > 0,
        stats: { totalWon: after.total_won, biggestWin: after.biggest_win, spins: after.spins }
      };
    },

    'POST /api/buy': async (req, u) => {
      const body = await req.json();
      const amount = posInt(body.amount, '購入数');
      rate(limit.shop, u.id);
      const today = utcDay();
      tx(() => {
        const cur = getUser(u.id);
        const bought = cur.bought_day === today ? cur.bought_today : 0;
        const max = Math.min(Math.floor(cur.dollars / RULES.tokenPrice), RULES.dailyLimit - bought);
        if (amount > max) {
          throw new ApiError(409, 'limit', bought + amount > RULES.dailyLimit ? '本日の購入上限を超えています' : '$が足りません');
        }
        q('UPDATE users SET dollars = dollars - ?, tokens = tokens + ?, bought_day = ?, bought_today = ?, rev = rev + 1 WHERE id = ?')
          .run(amount * RULES.tokenPrice, amount, today, bought + amount, cur.id);
      });
      return { me: meDto(balanceChanged(u.id)) };
    },

    'POST /api/sell': async (req, u) => {
      const body = await req.json();
      const amount = posInt(body.amount, '交換数');
      rate(limit.shop, u.id);
      tx(() => {
        const cur = getUser(u.id);
        if (amount > cur.tokens) throw new ApiError(409, 'insufficient', 'スピントークンが足りません');
        q('UPDATE users SET tokens = tokens - ?, dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(amount, amount * RULES.tokenPrice, cur.id);
      });
      return { me: meDto(balanceChanged(u.id)) };
    },

    'POST /api/daily': (req, u) => {
      rate(limit.shop, u.id);
      const today = utcDay();
      tx(() => {
        const cur = getUser(u.id);
        if (cur.free_day === today) throw new ApiError(409, 'claimed', '今日の無料トークンは受け取り済みです');
        q('UPDATE users SET tokens = tokens + ?, free_day = ?, rev = rev + 1 WHERE id = ?').run(RULES.dailyFree, today, cur.id);
      });
      return { me: meDto(balanceChanged(u.id)), amount: RULES.dailyFree, nextReset: nextUtcMidnight() };
    },

    'GET /api/board': (req, u) => {
      const type = req.query.get('type') || 'total';
      const today = utcDay();
      let rows, value, rank;
      if (type === 'today') {
        rows = q(`SELECT id, name, avatar, day_won AS value FROM users WHERE banned = 0 AND npc = '' AND won_day = ? AND day_won > 0
                  ORDER BY day_won DESC, id LIMIT 100`).all(today);
        value = u.won_day === today ? u.day_won : 0;
        rank = value > 0
          ? q("SELECT COUNT(*) AS n FROM users WHERE banned = 0 AND npc = '' AND won_day = ? AND (day_won > ? OR (day_won = ? AND id < ?))").get(today, value, value, u.id).n + 1
          : null;
      } else if (type === 'biggest') {
        rows = q("SELECT id, name, avatar, biggest_win AS value FROM users WHERE banned = 0 AND npc = '' ORDER BY biggest_win DESC, id LIMIT 100").all();
        value = u.biggest_win;
        rank = rankOf('biggest_win', value, u.id);
      } else if (type === 'total') {
        rows = q("SELECT id, name, avatar, total_won AS value FROM users WHERE banned = 0 AND npc = '' ORDER BY total_won DESC, id LIMIT 100").all();
        value = u.total_won;
        rank = rankOf('total_won', value, u.id);
      } else {
        throw new ApiError(400, 'bad_type', 'ランキングの種類が正しくありません');
      }
      return {
        type,
        rows: rows.map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, avatar: r.avatar, value: r.value, online: live.isOnline(r.id) })),
        me: { rank, value },
        players: q("SELECT COUNT(*) AS n FROM users WHERE banned = 0 AND npc = ''").get().n,
        online: live.onlineCount()
      };
    },

    // by id, or by exact name (names are unique)
    'GET /api/user': (req, u) => {
      let t;
      if (req.query.get('name') !== null) {
        t = findByName(req.query.get('name'));
        if (!t || t.banned) throw new ApiError(404, 'not_found', 'その名前のプレイヤーは見つかりません');
      } else {
        t = liveTarget(posInt(req.query.get('id'), 'ユーザーID'));
      }
      return { user: publicDto(t, u.id), blocked: isBlocked(u.id, t.id), self: t.id === u.id };
    },

    /* ----- friends ----- */

    'GET /api/friends': (req, u) => {
      const friends = q(`SELECT o.id, o.name, o.avatar, f.created_at AS since FROM friends f JOIN users o ON o.id = f.friend_id
                         WHERE f.user_id = ? AND o.banned = 0 ORDER BY o.name_key`).all(u.id);
      const incoming = q(`SELECT o.id, o.name, o.avatar, r.created_at AS at FROM friend_requests r JOIN users o ON o.id = r.from_id
                          WHERE r.to_id = ? AND o.banned = 0 ORDER BY r.created_at DESC`).all(u.id);
      const outgoing = q(`SELECT o.id, o.name, o.avatar, r.created_at AS at FROM friend_requests r JOIN users o ON o.id = r.to_id
                          WHERE r.from_id = ? AND o.banned = 0 ORDER BY r.created_at DESC`).all(u.id);
      const on = (r) => ({ ...r, online: live.isOnline(r.id) });
      return { friends: friends.map(on), incoming: incoming.map(on), outgoing: outgoing.map(on) };
    },

    'POST /api/friends/request': async (req, u) => {
      const body = await req.json();
      rate(limit.friend, u.id);
      const t = body.user !== undefined ? liveTarget(posInt(body.user, 'ユーザーID')) : findByName(body.name);
      if (!t || t.banned) throw new ApiError(404, 'not_found', 'その名前のプレイヤーは見つかりません');
      if (t.id === u.id) throw new ApiError(400, 'self', '自分には申請できません');
      if (t.npc) throw new ApiError(403, 'npc', `${t.name}にはフレンド申請できません`);
      if (areFriends(u.id, t.id)) throw new ApiError(409, 'already', 'すでにフレンドです');
      if (isBlocked(t.id, u.id) || isBlocked(u.id, t.id)) throw new ApiError(403, 'blocked', 'このプレイヤーには申請できません');
      // they already asked us: that makes us friends
      if (hasRequest(t.id, u.id)) return { friendship: 'friends', user: mini(t), ...makeFriends(t, u) };
      if (hasRequest(u.id, t.id)) throw new ApiError(409, 'pending', 'すでに申請しています。承認されるまでお待ちください');
      if (q('SELECT COUNT(*) AS n FROM friend_requests WHERE from_id = ?').get(u.id).n >= MAX_PENDING_REQUESTS) {
        throw new ApiError(429, 'too_many', '承認待ちの申請が多すぎます');
      }
      q('INSERT INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)').run(u.id, t.id, Date.now());
      live.send(t.id, 'friend', { type: 'request', user: mini(u), pending: pendingRequests(t.id) });
      return { friendship: 'outgoing', user: mini(t) };
    },

    'POST /api/friends/respond': async (req, u) => {
      const body = await req.json();
      rate(limit.friend, u.id);
      const t = liveTarget(posInt(body.user, 'ユーザーID'));
      if (!hasRequest(t.id, u.id)) throw new ApiError(404, 'no_request', 'フレンド申請が見つかりません');
      if (body.accept) return { friendship: 'friends', user: mini(t), ...makeFriends(t, u) };
      q('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(t.id, u.id);
      live.send(t.id, 'friend', { type: 'declined', user: mini(u) });
      return { friendship: 'none', user: mini(t), pending: pendingRequests(u.id) };
    },

    'POST /api/friends/cancel': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.user, 'ユーザーID');
      q('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(u.id, id);
      live.send(id, 'friend', { type: 'cancelled', user: mini(u), pending: pendingRequests(id) });
      return { friendship: 'none' };
    },

    'POST /api/friends/remove': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.user, 'ユーザーID');
      unfriend(u.id, id);
      live.send(id, 'friend', { type: 'removed', user: mini(u) });
      return { friendship: 'none' };
    },

    /* ----- chat ----- */

    'GET /api/conversations': (req, u) => {
      const rows = q(`SELECT c.other_id AS id, c.unread, c.updated_at, o.name, o.avatar, o.banned, o.npc, m.kind, m.body, m.amount, m.currency, m.sender_id
                      FROM conversations c JOIN users o ON o.id = c.other_id JOIN messages m ON m.id = c.last_id
                      WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT 100`).all(u.id);
      return {
        conversations: rows.filter((r) => !r.banned).map((r) => ({
          user: { id: r.id, name: r.name, avatar: r.avatar, online: isOnline(r), npc: r.npc || null },
          friend: areFriends(u.id, r.id),
          unread: r.unread,
          at: r.updated_at,
          last: { kind: r.kind, text: r.body, amount: r.amount, currency: r.currency, mine: r.sender_id === u.id }
        })),
        unread: unreadTotal(u.id)
      };
    },

    'GET /api/messages': (req, u) => {
      const withId = req.query.get('with');
      const channel = withId ? dmChannel(u.id, posInt(withId, 'ユーザーID')) : 'lobby';
      const beforeRaw = Number(req.query.get('before'));
      const before = Number.isSafeInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : Number.MAX_SAFE_INTEGER;
      const rows = q(`SELECT m.*, s.name AS sender_name, s.avatar AS sender_avatar FROM messages m LEFT JOIN users s ON s.id = m.sender_id
                      WHERE m.channel = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`).all(channel, before, PAGE);
      let list = rows.reverse();
      if (channel === 'lobby') {
        const blocked = new Set(q('SELECT blocked_id FROM blocks WHERE user_id = ?').all(u.id).map((r) => r.blocked_id));
        list = list.filter((m) => !blocked.has(m.sender_id));
      }
      return { channel, messages: list.map(msgDto), hasMore: rows.length === PAGE };
    },

    'POST /api/messages': async (req, u) => {
      const body = await req.json();
      const text = cleanText(body.text);
      if (body.to === 'lobby') {
        rate(limit.lobby, u.id, '連続して送信できません。少し待ってください');
        const dto = msgDto(insertMessage({ channel: 'lobby', sender: u, kind: 'text', body: text }));
        live.broadcast('msg', dto, (uid) => uid === u.id || !isBlocked(uid, u.id));
        return { message: dto };
      }
      const to = posInt(body.to, '宛先');
      if (to === u.id) throw new ApiError(400, 'self', '自分にはメッセージを送れません');
      if (peter.is(to)) {
        rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
        return peter.chat(u, text);
      }
      liveTarget(to);
      requireFriend(u, to, 'メッセージを送れるように');
      if (isBlocked(to, u.id)) throw new ApiError(403, 'blocked', 'このユーザーにはメッセージを送れません');
      rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
      const m = tx(() => {
        const row = insertMessage({ channel: dmChannel(u.id, to), sender: u, recipient: to, kind: 'text', body: text });
        touchConversations(u.id, to, row.id);
        return row;
      });
      return { message: deliverDm(m, u.id, to) };
    },

    'POST /api/read': async (req, u) => {
      const body = await req.json();
      const other = posInt(body.with, 'ユーザーID');
      rate(limit.read, u.id);
      q('UPDATE conversations SET unread = 0 WHERE user_id = ? AND other_id = ?').run(u.id, other);
      return { unread: unreadTotal(u.id) };
    },

    /* ----- money and gifts between friends ----- */

    'POST /api/transfer': async (req, u) => {
      const body = await req.json();
      const to = posInt(body.to, '宛先');
      const currency = String(body.currency || '');
      if (!CURRENCIES.includes(currency)) throw new ApiError(400, 'bad_currency', '送金する通貨が正しくありません');
      const amount = posInt(body.amount, '送金額');
      const max = currency === 'tokens' ? config.maxTransferTokens : config.maxTransferDollars;
      if (amount > max) throw new ApiError(400, 'too_much', `1回に送れるのは ${fmt(max)} ${currency === 'tokens' ? 'トークン' : '$'} までです`);
      if (to === u.id) throw new ApiError(400, 'self', '自分には送金できません');
      liveTarget(to);
      requireFriend(u, to, '送金');
      if (isBlocked(to, u.id)) throw new ApiError(403, 'blocked', 'このユーザーには送金できません');
      rate(limit.transfer, u.id, '送金が続いています。少し待ってからお試しください');
      const m = tx(() => {
        const cur = getUser(u.id);
        if (cur[currency] < amount) {
          throw new ApiError(409, 'insufficient', currency === 'tokens' ? 'スピントークンが足りません' : '$が足りません');
        }
        // `currency` is one of CURRENCIES, so it is safe as a column name
        q(`UPDATE users SET ${currency} = ${currency} - ?, rev = rev + 1 WHERE id = ?`).run(amount, u.id);
        q(`UPDATE users SET ${currency} = ${currency} + ?, rev = rev + 1 WHERE id = ?`).run(amount, to);
        q('INSERT INTO transfers (from_id, to_id, currency, amount, created_at) VALUES (?, ?, ?, ?, ?)').run(u.id, to, currency, amount, Date.now());
        const row = insertMessage({ channel: dmChannel(u.id, to), sender: u, recipient: to, kind: 'transfer', amount, currency });
        touchConversations(u.id, to, row.id);
        return row;
      });
      balanceChanged(to);
      const mine = balanceChanged(u.id);
      const dto = deliverDm(m, u.id, to);
      peter.check(u.id);
      return { balance: balance(mine), message: dto };
    },

    /* ----- icons ----- */

    'POST /api/avatar': async (req, u) => {
      const body = await req.json();
      const a = AVATARS.get(String(body.id || ''));
      if (!a) throw new ApiError(400, 'bad_avatar', 'アイコンが見つかりません');
      if (a.price > 0 && !ownedAvatars(u).includes(a.id)) throw new ApiError(403, 'locked', 'このアイコンはまだ持っていません');
      q('UPDATE users SET avatar = ? WHERE id = ?').run(a.id, u.id);
      return { me: meDto(getUser(u.id)) };
    },

    // Charged at today's sale price. `price` is what the player was shown: if
    // the sale changed at midnight in between, nothing is charged.
    'POST /api/avatar/buy': async (req, u) => {
      const body = await req.json();
      rate(limit.shop, u.id);
      const a = AVATARS.get(String(body.id || ''));
      if (!a || !(a.price > 0)) throw new ApiError(400, 'bad_avatar', 'このアイコンは購入できません');
      const sale = iconSale(a, utcDay());
      if (body.price !== undefined && Number(body.price) !== sale.price) {
        throw new ApiError(409, 'price_changed', `セール価格が変わりました（今日は $${fmt(sale.price)}）`, { iconShop: iconShop() });
      }
      tx(() => {
        const cur = getUser(u.id);
        const owned = ownedAvatars(cur);
        if (owned.includes(a.id)) throw new ApiError(409, 'owned', 'すでに持っています');
        if (cur.dollars < sale.price) throw new ApiError(409, 'insufficient', '$が足りません');
        q('UPDATE users SET dollars = dollars - ?, avatars = ?, avatar = ?, rev = rev + 1 WHERE id = ?')
          .run(sale.price, [...owned, a.id].join(','), a.id, cur.id);
      });
      const me = meDto(balanceChanged(u.id));
      peter.check(u.id);
      return { me, paid: sale.price, pct: sale.pct };
    },

    /* ----- cars ----- */

    'GET /api/cars': (req, u) => {
      const rows = q(`SELECT c.id, c.model, c.acquired_at, c.from_id, f.name AS from_name FROM cars c LEFT JOIN users f ON f.id = c.from_id
                      WHERE c.owner_id = ? ORDER BY c.acquired_at DESC, c.id DESC`).all(u.id);
      return {
        catalog: RULES.cars,
        cars: rows.map((r) => ({ id: r.id, model: r.model, acquiredAt: r.acquired_at, from: r.from_id ? { id: r.from_id, name: r.from_name } : null }))
      };
    },

    'POST /api/cars/buy': async (req, u) => {
      const body = await req.json();
      rate(limit.shop, u.id);
      const car = CARS.get(String(body.model || ''));
      if (!car) throw new ApiError(400, 'bad_model', 'この車は販売していません');
      const id = tx(() => {
        const cur = getUser(u.id);
        if (cur.dollars < car.price) throw new ApiError(409, 'insufficient', '$が足りません');
        q('UPDATE users SET dollars = dollars - ?, rev = rev + 1 WHERE id = ?').run(car.price, cur.id);
        const now = Date.now();
        return Number(q('INSERT INTO cars (owner_id, model, from_id, created_at, acquired_at) VALUES (?, ?, 0, ?, ?)').run(cur.id, car.id, now, now).lastInsertRowid);
      });
      const me = meDto(balanceChanged(u.id));
      peter.check(u.id);
      return { me, car: { id, model: car.id, acquiredAt: Date.now(), from: null } };
    },

    'POST /api/cars/gift': async (req, u) => {
      const body = await req.json();
      const to = posInt(body.to, '宛先');
      const carId = posInt(body.car, '車');
      if (to === u.id) throw new ApiError(400, 'self', '自分にはあげられません');
      liveTarget(to);
      requireFriend(u, to, '車をあげる');
      if (isBlocked(to, u.id)) throw new ApiError(403, 'blocked', 'このユーザーにはあげられません');
      rate(limit.transfer, u.id, '少し待ってからお試しください');
      const m = tx(() => {
        const car = q('SELECT * FROM cars WHERE id = ? AND owner_id = ?').get(carId, u.id);
        if (!car) throw new ApiError(404, 'no_car', 'この車は持っていません');
        q('UPDATE cars SET owner_id = ?, from_id = ?, acquired_at = ? WHERE id = ?').run(to, u.id, Date.now(), car.id);
        const row = insertMessage({ channel: dmChannel(u.id, to), sender: u, recipient: to, kind: 'gift', body: car.model, amount: car.id });
        touchConversations(u.id, to, row.id);
        return row;
      });
      return { message: deliverDm(m, u.id, to) };
    },

    /* ----- blocking ----- */

    'GET /api/blocks': (req, u) => ({
      blocks: q('SELECT b.blocked_id AS id, o.name, o.avatar FROM blocks b JOIN users o ON o.id = b.blocked_id WHERE b.user_id = ? ORDER BY b.created_at DESC').all(u.id)
    }),

    'POST /api/block': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.user, 'ユーザーID');
      if (id === u.id) throw new ApiError(400, 'self', '自分はブロックできません');
      const target = getUser(id);
      if (!target) throw new ApiError(404, 'not_found', 'ユーザーが見つかりません');
      if (target.npc) throw new ApiError(400, 'npc', `${target.name}はブロックできません`);
      if (body.blocked) {
        q('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)').run(u.id, id, Date.now());
        // blocking also ends a friendship and any pending request
        if (unfriend(u.id, id)) live.send(id, 'friend', { type: 'removed', user: mini(u) });
      } else {
        q('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').run(u.id, id);
      }
      return { blocked: !!body.blocked };
    },

    /* ----- voice chat signalling (稼ぎに招待) ----- */

    'GET /api/call/ice': async () => ({ iceServers: await iceServers() }),

    'POST /api/call': async (req, u) => {
      relayCall(u, await req.json(32 * 1024));
      return { ok: true };
    },

    // 稼ぎに参加要請: asks a friend to come and join one's home (watch and talk)
    'POST /api/home/invite': async (req, u) => {
      const body = await req.json();
      const to = posInt(body.to, '宛先');
      if (to === u.id) throw new ApiError(400, 'self', '自分には送れません');
      const t = liveTarget(to);
      requireFriend(u, to, '稼ぎに参加要請');
      if (isBlocked(to, u.id)) throw new ApiError(403, 'blocked', 'このユーザーには送れません');
      rate(limit.friend, u.id, '少し待ってからお試しください');
      if (!live.isOnline(to)) throw new ApiError(409, 'offline', `${t.name}さんは今オフラインです`);
      if (watching(u.id)) throw new ApiError(409, 'watching', '観戦中は参加要請を送れません。観戦をやめてからお試しください');
      if (watching(to) === u.id) throw new ApiError(409, 'already', `${t.name}さんはすでにあなたの稼ぎに参加しています`);
      if (watcherIds(u.id).length >= RULES.maxWatchers) throw new ApiError(409, 'full', `あなたのホームは満員です（最大${RULES.maxWatchers}人）`);
      live.send(to, 'home', { type: 'invite', from: mini(u) });
      return { ok: true };
    },

    /* ----- watching a friend's screen ----- */

    // 稼ぎに参加: watching a friend's screen puts one in their home (and its voice call)
    'POST /api/watch': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.user, 'ユーザーID');
      if (!body.on) {
        const host = watching(u.id);
        q('DELETE FROM watchers WHERE watcher_id = ?').run(u.id);
        if (host) homeChanged(host, mini(u), false);
        return { on: false };
      }
      const t = liveTarget(id);
      if (id === u.id) throw new ApiError(400, 'self', '自分の画面は見られません');
      requireFriend(u, id, '稼ぎに参加');
      const prev = watching(u.id);
      const others = watcherIds(id).filter((w) => w !== u.id);
      if (others.length >= RULES.maxWatchers) throw new ApiError(409, 'full', `${t.name}さんのホームは満員です（最大${RULES.maxWatchers}人）`);
      if (prev && prev !== id) {
        q('DELETE FROM watchers WHERE watcher_id = ?').run(u.id);
        homeChanged(prev, mini(u), false);
      }
      q(`INSERT INTO watchers (watcher_id, target_id, since) VALUES (?, ?, ?)
         ON CONFLICT(watcher_id) DO UPDATE SET target_id = excluded.target_id, since = excluded.since`).run(u.id, id, Date.now());
      if (prev !== id) homeChanged(id, mini(u), true);
      let last = null;
      try { last = t.last_spin ? JSON.parse(t.last_spin) : null; } catch { last = null; }
      const members = others.map((w) => getUser(w)).filter(Boolean).map(mini);
      return { on: true, user: { ...mini(t), online: live.isOnline(id) }, balance: balance(t), last, members, charm: t.charm > 0 };
    },

    // who is watching me (shown as a small eye on my screen)
    'GET /api/watchers': (req, u) => ({
      watchers: q('SELECT o.id, o.name, o.avatar FROM watchers w JOIN users o ON o.id = w.watcher_id WHERE w.target_id = ?').all(u.id)
    }),

    /* ----- Shop, 所有 (what one owns) and the お守り加護 ----- */

    'GET /api/items': (req, u) => ({ items: itemsOf(u.id), charm: u.charm > 0, shop: itemShop() }),

    // Charged at today's sale price (`price` per piece, as shown).
    'POST /api/shop/buy': async (req, u) => {
      const body = await req.json();
      rate(limit.shop, u.id);
      const item = SHOP.get(String(body.id || ''));
      if (!item) throw new ApiError(400, 'bad_item', 'この商品は販売していません');
      const count = body.count === undefined ? 1 : posInt(body.count, '個数');
      const sale = itemSale(item, utcDay());
      if (body.price !== undefined && Number(body.price) !== sale.price) {
        throw new ApiError(409, 'price_changed', `セール価格が変わりました（今日は $${fmt(sale.price)}）`, { itemShop: itemShop() });
      }
      tx(() => {
        const cur = getUser(u.id);
        const have = itemCount(cur.id, item.id);
        if (have + count > item.max) {
          throw new ApiError(409, 'max', have >= item.max ? `${item.name}は一人${item.max}個までです` : `${item.name}は一人${item.max}個まで（あと${item.max - have}個買えます）`);
        }
        const cost = sale.price * count;
        if (cur.dollars < cost) throw new ApiError(409, 'insufficient', '$が足りません');
        q('UPDATE users SET dollars = dollars - ?, rev = rev + 1 WHERE id = ?').run(cost, cur.id);
        addItems(cur.id, item.id, count);
      });
      const me = meDto(balanceChanged(u.id));
      peter.check(u.id);
      return { me, paid: sale.price * count, pct: sale.pct };
    },

    // Everything from the Shop can be given to a friend.
    'POST /api/items/give': async (req, u) => {
      const body = await req.json();
      const to = posInt(body.to, '宛先');
      const item = SHOP.get(String(body.id || ''));
      if (!item) throw new ApiError(400, 'bad_item', 'このアイテムは譲れません');
      const count = body.count === undefined ? 1 : posInt(body.count, '個数');
      if (to === u.id) throw new ApiError(400, 'self', '自分には譲れません');
      const t = liveTarget(to);
      requireFriend(u, to, 'アイテムを譲る');
      if (isBlocked(to, u.id)) throw new ApiError(403, 'blocked', 'このユーザーには譲れません');
      rate(limit.transfer, u.id, '少し待ってからお試しください');
      const m = tx(() => {
        const have = itemCount(u.id, item.id);
        if (have < count) throw new ApiError(409, 'insufficient', `${item.name}が足りません（${have}個）`);
        const theirs = itemCount(to, item.id);
        if (theirs + count > item.max) {
          throw new ApiError(409, 'their_max', theirs >= item.max
            ? `${t.name}さんは${item.name}を上限（${item.max}個）まで持っています`
            : `${t.name}さんに譲れるのはあと${item.max - theirs}個までです`);
        }
        addItems(u.id, item.id, -count);
        addItems(to, item.id, count);
        const row = insertMessage({ channel: dmChannel(u.id, to), sender: u, recipient: to, kind: 'item', body: item.id, amount: count });
        touchConversations(u.id, to, row.id);
        return row;
      });
      live.send(to, 'items', { items: itemsOf(to) });
      return { me: meDto(getUser(u.id)), message: deliverDm(m, u.id, to) };
    },

    // One tap on the slot screen, before spinning: the お守り加護 is on until a spin is lost.
    'POST /api/charm': (req, u) => {
      rate(limit.shop, u.id);
      tx(() => {
        const cur = getUser(u.id);
        if (cur.charm > 0) throw new ApiError(409, 'active', 'お守り加護はもう発動中です');
        if (itemCount(cur.id, CHARM.item) < 1) throw new ApiError(409, 'none', 'お守り加護を持っていません（Shop で買えます）');
        addItems(cur.id, CHARM.item, -1);
        q('UPDATE users SET charm = 1 WHERE id = ?').run(cur.id);
      });
      notifyWatchers(u.id, { type: 'charm', user: u.id, on: true });
      return { me: meDto(getUser(u.id)) };
    },

    /* ----- fruits for the friend one is watching ----- */

    'POST /api/tip': async (req, u) => {
      const body = await req.json();
      const to = posInt(body.to, '宛先');
      if (watching(u.id) !== to) throw new ApiError(409, 'not_watching', '観戦中の友達にだけ送れます');
      const t = liveTarget(to);
      if (isBlocked(to, u.id)) throw new ApiError(403, 'blocked', 'このユーザーには送れません');
      const fruits = {};
      let count = 0, amount = 0;
      for (const [id, n] of Object.entries(body.fruits || {})) {
        const f = FRUITS.get(id);
        if (!f) throw new ApiError(400, 'bad_fruit', 'このフルーツは送れません');
        if (n === 0) continue;
        const k = posInt(n, '個数');
        fruits[id] = k;
        count += k;
        amount += k * f.tokens;
      }
      if (!count) throw new ApiError(400, 'bad_amount', '送るフルーツを選んでください');
      if (count > 200) throw new ApiError(400, 'too_many', '一度に送れるのは200個までです');
      rate(limit.tip, u.id, 'フルーツが速すぎます。少し待ってください');
      tx(() => {
        const cur = getUser(u.id);
        if (cur.tokens < amount) throw new ApiError(409, 'insufficient', 'スピントークンが足りません');
        q('UPDATE users SET tokens = tokens - ?, rev = rev + 1 WHERE id = ?').run(amount, u.id);
        q('UPDATE users SET tokens = tokens + ?, rev = rev + 1 WHERE id = ?').run(amount, to);
        q('INSERT INTO transfers (from_id, to_id, currency, amount, created_at) VALUES (?, ?, ?, ?, ?)').run(u.id, to, 'tokens', amount, Date.now());
      });
      const tip = { from: mini(u), fruits, amount };
      live.send(to, 'tip', tip);
      // everyone in the home sees the fruit fly
      notifyWatchers(to, { type: 'tip', user: to, ...tip });
      balanceChanged(to);
      const mine = balanceChanged(u.id);
      peter.check(u.id);
      return { balance: balance(mine), amount, to: t.id };
    },

    /* ----- ピーター ----- */

    'GET /api/peter': (req, u) => peter.state(u.id),

    'POST /api/peter/borrow': async (req, u) => {
      const body = await req.json();
      const n = Number(body.offer);
      if (!(n === 1 || n === 2)) throw new ApiError(400, 'bad_offer', '話が見つかりません');
      rate(limit.transfer, u.id, '少し待ってからお試しください');
      return { ...peter.takeOffer(u, n), me: meDto(getUser(u.id)) };
    },

    'POST /api/peter/repay': async (req, u) => {
      const body = await req.json();
      const amount = posInt(body.amount, '返済額');
      rate(limit.transfer, u.id, '少し待ってからお試しください');
      return { ...peter.repay(u, amount), me: meDto(getUser(u.id)) };
    },

    // still playing when the day turns (6:00 Japan time): that day counts too
    'POST /api/login-bonus': (req, u) => ({ loginBonus: loginBonus(u.id), next: nextLoginReset(), me: meDto(getUser(u.id)) }),

    'POST /api/stream-ticket': (req, u) => ({ ticket: signTicket(secret, u.id) })
  };

  // Voice chat signalling between friends: 1:1 calls (稼ぎに招待, two people;
  // a player already in a call or a home is busy) and the home call of a
  // player and their watchers (type "home": everyone in the home can reach
  // everyone else). Used by POST /api/call and by the WebSocket.
  function relayCall(u, body) {
    const type = String(body.type || '');
    if (!CALL_TYPES.has(type)) throw new ApiError(400, 'bad_type', '通話の操作が正しくありません');
    const callId = String(body.callId || '');
    if (!/^[\w-]{6,64}$/.test(callId)) throw new ApiError(400, 'bad_call', '通話IDが正しくありません');
    const to = posInt(body.to, '宛先');
    const t = liveTarget(to);
    rate(limit.call, u.id);
    if (type === 'home') {
      const room = Number(body.data && body.data.room);
      const member = (id) => id === room || watching(id) === room;
      if (!room || !member(u.id) || !member(to)) throw new ApiError(409, 'not_home', 'ホームにいません');
    } else {
      requireFriend(u, to, '通話');
    }
    if (type === 'invite') {
      if (isBlocked(to, u.id)) throw new ApiError(403, 'blocked', 'このユーザーは呼び出せません');
      if (inHome(u.id)) throw new ApiError(409, 'in_home', 'ホーム通話中は稼ぎに招待できません（稼ぎに参加要請なら送れます）');
      if (!live.isOnline(to)) throw new ApiError(409, 'offline', '相手がオフラインのため呼び出せません');
      if (inHome(to)) throw new ApiError(409, 'busy', `${t.name}さんは今ホーム通話中です`);
    }
    live.send(to, 'call', { type, callId, from: mini(u), data: body.data ?? null });
  }

  // Signalling over the WebSocket (no HTTP request per message): errors are dropped.
  function socketCall(userId, body) {
    try {
      const u = getUser(userId);
      if (!u || u.banned) return;
      if (body.type === 'invite') return;   // invitations go over HTTP, where the answer is seen
      relayCall(u, body);
    } catch (e) {
      if (!(e instanceof ApiError)) console.error(e);
    }
  }

  // Friendship both ways, the request(s) gone, a note in their conversation.
  function makeFriends(requester, accepter) {
    const m = tx(() => {
      const now = Date.now();
      q('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)').run(requester.id, accepter.id, accepter.id, requester.id);
      q('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(requester.id, accepter.id, now);
      q('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(accepter.id, requester.id, now);
      const row = insertMessage({ channel: dmChannel(requester.id, accepter.id), sender: null, kind: 'system', body: 'フレンドになりました！' });
      touchConversations(requester.id, accepter.id, row.id, requester.id);
      return row;
    });
    live.send(requester.id, 'friend', { type: 'accepted', user: mini(accepter) });
    live.send(accepter.id, 'friend', { type: 'added', user: mini(requester), pending: pendingRequests(accepter.id) });
    const dto = msgDto(m);
    live.send(requester.id, 'msg', { ...dto, to: requester.id, peer: accepter.id, unread: unreadTotal(requester.id) });
    live.send(accepter.id, 'msg', { ...dto, to: accepter.id, peer: requester.id });
    return { pending: pendingRequests(accepter.id) };
  }

  // Returns true when there was a friendship to end.
  function unfriend(a, b) {
    return tx(() => {
      const r = q('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(a, b, b, a);
      q('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)').run(a, b, b, a);
      q('DELETE FROM watchers WHERE (watcher_id = ? AND target_id = ?) OR (watcher_id = ? AND target_id = ?)').run(a, b, b, a);
      return Number(r.changes) > 0;
    });
  }

  const PUBLIC = new Set(['GET /api/health', 'GET /api/name-check', 'POST /api/register', 'POST /api/login']);

  /* ---------------------------------------------------------------- live connection hooks */

  // First payload of a live connection.
  function hello(userId) {
    const bonus = loginBonus(userId);
    const u = getUser(userId);
    return {
      loginBonus: bonus,
      loginReset: nextLoginReset(),
      me: meDto(u), unread: unreadTotal(userId), friendRequests: pendingRequests(userId), iconShop: iconShop(), itemShop: itemShop(),
      peter: peter.me(), online: live.onlineCount()
    };
  }

  function presence(userId, online) {
    live.broadcast('presence', { id: userId, online, count: live.onlineCount() });
    if (online) {
      // back nearly broke: Peter may have something to say
      try { peter.check(userId); } catch (e) { console.error('peter', e); }
      return;
    }
    // a player who left stops watching, and the rest of that home is told
    const host = watching(userId);
    if (host) {
      q('DELETE FROM watchers WHERE watcher_id = ?').run(userId);
      const u = getUser(userId);
      if (u) homeChanged(host, mini(u), false);
    }
    // their own home closes
    notifyWatchers(userId, { type: 'offline', user: userId });
    q('DELETE FROM watchers WHERE target_id = ?').run(userId);
  }

  // Periodic clean-up: trim the lobby, old spin records, stale sessions and watchers.
  function housekeeping() {
    try {
      q(`DELETE FROM messages WHERE channel = 'lobby' AND id <= COALESCE(
           (SELECT id FROM messages WHERE channel = 'lobby' ORDER BY id DESC LIMIT 1 OFFSET ${LOBBY_KEEP}), 0)`).run();
      q('DELETE FROM spins WHERE created_at < ?').run(Date.now() - 30 * 86400000);
      q('DELETE FROM sessions WHERE last_used < ?').run(Date.now() - 365 * 86400000);
      q('DELETE FROM watchers WHERE since < ?').run(Date.now() - 12 * 3600000);
      for (const l of Object.values(limit)) l.prune();
      quota.flush();
    } catch (e) {
      console.error('housekeeping failed', e);
    }
  }

  // Stream tickets are signed and expire within a minute; each opens one connection.
  const usedTickets = new Map();
  function consumeTicket(ticket) {
    const userId = verifyTicket(secret, ticket);
    if (!userId) return null;
    const now = Date.now();
    for (const [t, until] of usedTickets) if (until < now) usedTickets.delete(t);
    if (usedTickets.has(ticket)) return null;
    usedTickets.set(ticket, now + 70000);
    const u = getUser(userId);
    return u && !u.banned ? userId : null;
  }

  const admin = createAdmin(db);

  async function handle(req) {
    const out = await answer(req);
    if (quota.on) quota.request(out.body ? JSON.stringify(out.body).length : 0);
    return out;
  }

  async function answer(req) {
    const key = `${req.method} ${req.path}`;
    try {
      if (key === 'POST /api/admin') return { status: 200, body: await adminCall(req) };
      // a day's cap is reached: the same notice for everyone until 00:00 UTC
      if (quota.over()) return { status: 503, body: maintenanceBody() };
      const route = routes[key];
      if (!route) throw new ApiError(404, 'not_found', 'APIが見つかりません');
      let user = null;
      if (!PUBLIC.has(key)) {
        user = authUser(req);
        rate(limit.general, user.id);
      }
      return { status: 200, body: await route(req, user) };
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.extra || {}) } } };
      // the host's daily quota ran out (e.g. database writes on the free plan)
      if (isQuotaError(e)) return { status: 503, body: maintenanceBody() };
      console.error(e);
      return { status: 500, body: { error: { code: 'internal', message: 'サーバーでエラーが発生しました。少し待ってからもう一度お試しください' } } };
    }
  }

  // Operator commands over HTTP (needed on Cloudflare, where there is no shell).
  async function adminCall(req) {
    const given = String(req.header('x-admin-token') || '');
    if (!config.adminToken || !given || sha256(given) !== sha256(config.adminToken)) {
      throw new ApiError(403, 'forbidden', 'ADMIN_TOKEN が必要です');
    }
    const body = await req.json(8 * 1024 * 1024);
    const cmd = String(body.cmd || '');
    const args = Array.isArray(body.args) ? body.args : [];
    try {
      if (cmd === 'quota') return { ok: true, result: quota.state() };
      const own = hostAdmin ? await hostAdmin(cmd, args) : undefined;
      return { ok: true, result: own !== undefined ? own : admin.command(cmd, args) };
    } catch (e) {
      if (e && e.name === 'AdminError') throw new ApiError(400, 'admin', e.message);
      throw e;
    }
  }

  return {
    handle,
    hello,
    presence,
    housekeeping,
    userForToken,
    consumeTicket,
    socketCall,
    quota,
    close: () => { quota.flush(); if (boardTimer) clearTimeout(boardTimer); }
  };
}
