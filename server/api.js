// JSON API. Every balance change happens inside one SQLite transaction and
// bumps the player's `rev`, so clients can drop stale balance updates.
import { ApiError, sendJson, sendError, readJson, clientIp, posInt } from './http.js';
import { tx, statements } from './db.js';
import { newToken, sha256, newRecoveryCode, normalizeRecoveryCode, cleanName, cleanText } from './auth.js';
import { Limiter } from './ratelimit.js';
import { RULES, spin as spinReels, utcDay, nextUtcMidnight, fmt } from './rules.js';

const PAGE = 50;
const LOBBY_KEEP = 500;
const CURRENCIES = ['tokens', 'dollars'];

export function createApi({ db, live, config }) {
  const q = statements(db);
  const start = {
    tokens: config.startTokens ?? RULES.start.tokens,
    dollars: config.startDollars ?? RULES.start.dollars,
    coins: config.startCoins ?? RULES.start.coins
  };
  // [refills per minute, burst]
  const LIMITS = {
    register: [config.registerPerMinute, Math.max(1, Math.ceil(config.registerPerMinute / 2))],
    login: [10, 5],
    spin: [120, 6],
    shop: [60, 10],
    lobby: [20, 4],
    dm: [40, 8],
    transfer: [10, 5],
    read: [240, 30],
    general: [600, 60],
    ...config.limits
  };
  const limit = {};
  for (const [k, [perMinute, burst]] of Object.entries(LIMITS)) limit[k] = new Limiter(perMinute, burst);

  /* ---------------------------------------------------------------- helpers */

  const getUser = (id) => q('SELECT * FROM users WHERE id = ?').get(id);
  const ipOf = (req) => clientIp(req, config.trustProxy, config.clientIpHeader);
  const dmChannel = (a, b) => `dm:${Math.min(a, b)}:${Math.max(a, b)}`;
  const isBlocked = (userId, otherId) => !!q('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?').get(userId, otherId);

  function balance(u) { return { tokens: u.tokens, dollars: u.dollars, coins: u.coins, rev: u.rev }; }

  function meDto(u) {
    const today = utcDay();
    return {
      id: u.id,
      name: u.name,
      ...balance(u),
      totalWon: u.total_won,
      totalBet: u.total_bet,
      biggestWin: u.biggest_win,
      spins: u.spins,
      dayWon: u.won_day === today ? u.day_won : 0,
      boughtToday: u.bought_day === today ? u.bought_today : 0,
      dailyReady: u.free_day !== today,
      createdAt: u.created_at
    };
  }

  function publicDto(u) {
    const today = utcDay();
    return {
      id: u.id,
      name: u.name,
      totalWon: u.total_won,
      biggestWin: u.biggest_win,
      spins: u.spins,
      dayWon: u.won_day === today ? u.day_won : 0,
      createdAt: u.created_at,
      online: live.isOnline(u.id),
      rank: rankOf('total_won', u.total_won, u.id)
    };
  }

  function rankOf(col, value, id) {
    return q(`SELECT COUNT(*) AS n FROM users WHERE banned = 0 AND (${col} > ? OR (${col} = ? AND id < ?))`).get(value, value, id).n + 1;
  }

  function msgDto(m) {
    return {
      id: m.id,
      channel: m.channel,
      kind: m.kind,
      from: m.sender_id ? { id: m.sender_id, name: m.sender_name ?? null } : null,
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
    return { id: Number(r.lastInsertRowid), channel, sender_id: sender ? sender.id : 0, sender_name: sender ? sender.name : null,
      recipient_id: recipient, kind, body, amount, currency, created_at: now };
  }

  function touchConversations(a, b, msgId) {
    const now = Date.now();
    const up = q(`INSERT INTO conversations (user_id, other_id, last_id, unread, updated_at) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(user_id, other_id) DO UPDATE SET last_id = excluded.last_id,
                  unread = conversations.unread + excluded.unread, updated_at = excluded.updated_at`);
    up.run(a, b, msgId, 0, now);
    up.run(b, a, msgId, 1, now);
  }

  function unreadTotal(userId) {
    return q('SELECT COALESCE(SUM(unread), 0) AS n FROM conversations WHERE user_id = ?').get(userId).n;
  }

  function rate(limiter, key, message) {
    if (!limiter.take(String(key))) throw new ApiError(429, 'rate_limited', message || '操作が速すぎます。少し待ってからもう一度お試しください');
  }

  // Board refresh hint, at most every 2 seconds.
  let boardTimer = null;
  function boardChanged() {
    if (boardTimer) return;
    boardTimer = setTimeout(() => { boardTimer = null; live.broadcast('board', { at: Date.now() }); }, 2000);
    boardTimer.unref();
  }

  function postLobbySystem(text) {
    const m = insertMessage({ channel: 'lobby', sender: null, kind: 'system', body: text });
    live.broadcast('msg', msgDto(m));
  }

  live.onPresence = (userId, online) => live.broadcast('presence', { id: userId, online, count: live.onlineCount() });

  /* ---------------------------------------------------------------- auth */

  function authUser(req) {
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(String(req.headers.authorization || ''));
    if (!m) throw new ApiError(401, 'auth', 'ログインが必要です');
    const h = sha256(m[1]);
    const s = q('SELECT user_id, last_used FROM sessions WHERE token_hash = ?').get(h);
    if (!s) throw new ApiError(401, 'auth', 'ログインの有効期限が切れました');
    const u = getUser(s.user_id);
    if (!u) throw new ApiError(401, 'auth', 'アカウントが見つかりません');
    if (u.banned) throw new ApiError(403, 'banned', 'このアカウントは利用停止されています');
    const now = Date.now();
    if (now - u.last_seen > 60000) q('UPDATE users SET last_seen = ? WHERE id = ?').run(now, u.id);
    if (now - s.last_used > 3600000) q('UPDATE sessions SET last_used = ? WHERE token_hash = ?').run(now, h);
    u.tokenHash = h;
    return u;
  }

  function createSession(userId) {
    const token = newToken();
    const now = Date.now();
    q('INSERT INTO sessions (token_hash, user_id, created_at, last_used) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now, now);
    return token;
  }

  /* ---------------------------------------------------------------- routes */

  const routes = {
    'GET /api/health': () => ({ ok: true, online: live.onlineCount() }),

    'POST /api/register': async (req) => {
      if (config.registration !== 'open') throw new ApiError(403, 'closed', '現在、新規登録は受け付けていません');
      const ip = ipOf(req);
      rate(limit.register, ip, '登録の試行が多すぎます。しばらく待ってからお試しください');
      const body = await readJson(req);
      const { name, key } = cleanName(body.name);
      if (config.registrationsPerIp > 0) {
        const n = q('SELECT COUNT(*) AS n FROM users WHERE created_ip = ? AND created_at > ?').get(ip, Date.now() - 86400000).n;
        if (n >= config.registrationsPerIp) throw new ApiError(429, 'too_many_accounts', 'この接続からはこれ以上アカウントを作成できません');
      }
      if (q('SELECT 1 FROM users WHERE name_key = ?').get(key)) throw new ApiError(409, 'name_taken', 'このユーザー名はすでに使われています');
      const code = newRecoveryCode();
      let token, user;
      try {
        ({ token, user } = tx(db, () => {
          const now = Date.now();
          const r = q(`INSERT INTO users (name, name_key, recovery_hash, tokens, dollars, coins, created_ip, created_at, last_seen)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(name, key, sha256(normalizeRecoveryCode(code)), start.tokens, start.dollars, start.coins, ip, now, now);
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

    'POST /api/login': async (req) => {
      rate(limit.login, ipOf(req), '試行回数が多すぎます。しばらく待ってからお試しください');
      const body = await readJson(req);
      const code = normalizeRecoveryCode(body.code);
      if (code.length !== 16) throw new ApiError(400, 'bad_code', '引き継ぎコードは16文字です');
      const u = q('SELECT * FROM users WHERE recovery_hash = ?').get(sha256(code));
      if (!u) throw new ApiError(404, 'bad_code', '引き継ぎコードが正しくありません');
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

    'GET /api/me': (req, u) => ({
      me: meDto(u),
      unread: unreadTotal(u.id),
      online: live.onlineCount(),
      now: Date.now(),
      nextReset: nextUtcMidnight(),
      rules: {
        bets: RULES.bets, tokenPrice: RULES.tokenPrice, dailyLimit: RULES.dailyLimit, dailyFree: RULES.dailyFree,
        maxTransfer: { tokens: config.maxTransferTokens, dollars: config.maxTransferDollars }
      }
    }),

    'POST /api/spin': async (req, u) => {
      const body = await readJson(req);
      const bet = Number(body.bet);
      if (!RULES.bets.includes(bet)) throw new ApiError(400, 'bad_bet', 'ベット額が正しくありません');
      rate(limit.spin, u.id, 'スピンが速すぎます');
      const today = utcDay();
      const result = tx(db, () => {
        const cur = getUser(u.id);
        if (cur.tokens < bet) throw new ApiError(409, 'insufficient', 'スピントークンが不足しています');
        const r = spinReels(bet);
        const dayWon = (cur.won_day === today ? cur.day_won : 0) + r.total;
        q(`UPDATE users SET tokens = tokens - ? + ?, total_bet = total_bet + ?, total_won = total_won + ?,
           biggest_win = MAX(biggest_win, ?), spins = spins + 1, won_day = ?, day_won = ?, rev = rev + 1 WHERE id = ?`)
          .run(bet, r.total, bet, r.total, r.total, today, dayWon, cur.id);
        q('INSERT INTO spins (user_id, bet, payout, line, created_at) VALUES (?, ?, ?, ?, ?)').run(cur.id, bet, r.total, r.line.join(','), Date.now());
        return r;
      });
      const after = getUser(u.id);
      if (result.total > 0) boardChanged();
      if (result.tier >= 3) {
        postLobbySystem(`${after.name}さんが SUPER BIG WIN！ ${fmt(result.total)} トークン獲得（${Math.round(result.mult * 10) / 10}倍）`);
      }
      return {
        result: { grid: result.grid, line: result.line, wins: result.wins, total: result.total, tier: result.tier, mult: result.mult, bet },
        balance: balance(after),
        stats: { totalWon: after.total_won, biggestWin: after.biggest_win, spins: after.spins }
      };
    },

    'POST /api/buy': async (req, u) => {
      const body = await readJson(req);
      const amount = posInt(body.amount, '購入数');
      rate(limit.shop, u.id);
      const today = utcDay();
      tx(db, () => {
        const cur = getUser(u.id);
        const bought = cur.bought_day === today ? cur.bought_today : 0;
        const max = Math.min(Math.floor(cur.dollars / RULES.tokenPrice), RULES.dailyLimit - bought);
        if (amount > max) {
          throw new ApiError(409, 'limit', bought + amount > RULES.dailyLimit
            ? '本日の購入上限を超えています'
            : '$が足りません');
        }
        q('UPDATE users SET dollars = dollars - ?, tokens = tokens + ?, bought_day = ?, bought_today = ?, rev = rev + 1 WHERE id = ?')
          .run(amount * RULES.tokenPrice, amount, today, bought + amount, cur.id);
      });
      return { me: meDto(getUser(u.id)) };
    },

    'POST /api/sell': async (req, u) => {
      const body = await readJson(req);
      const amount = posInt(body.amount, '交換数');
      rate(limit.shop, u.id);
      tx(db, () => {
        const cur = getUser(u.id);
        if (amount > cur.tokens) throw new ApiError(409, 'insufficient', 'スピントークンが足りません');
        q('UPDATE users SET tokens = tokens - ?, dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(amount, amount * RULES.tokenPrice, cur.id);
      });
      return { me: meDto(getUser(u.id)) };
    },

    'POST /api/daily': (req, u) => {
      rate(limit.shop, u.id);
      const today = utcDay();
      tx(db, () => {
        const cur = getUser(u.id);
        if (cur.free_day === today) throw new ApiError(409, 'claimed', '今日の無料トークンは受け取り済みです');
        q('UPDATE users SET tokens = tokens + ?, free_day = ?, rev = rev + 1 WHERE id = ?').run(RULES.dailyFree, today, cur.id);
      });
      return { me: meDto(getUser(u.id)), amount: RULES.dailyFree, nextReset: nextUtcMidnight() };
    },

    'GET /api/board': (req, u, url) => {
      const type = url.searchParams.get('type') || 'total';
      const today = utcDay();
      let rows, value, rank;
      if (type === 'today') {
        rows = q(`SELECT id, name, day_won AS value FROM users WHERE banned = 0 AND won_day = ? AND day_won > 0
                  ORDER BY day_won DESC, id LIMIT 100`).all(today);
        value = u.won_day === today ? u.day_won : 0;
        rank = value > 0
          ? q('SELECT COUNT(*) AS n FROM users WHERE banned = 0 AND won_day = ? AND (day_won > ? OR (day_won = ? AND id < ?))').get(today, value, value, u.id).n + 1
          : null;
      } else if (type === 'biggest') {
        rows = q('SELECT id, name, biggest_win AS value FROM users WHERE banned = 0 ORDER BY biggest_win DESC, id LIMIT 100').all();
        value = u.biggest_win;
        rank = rankOf('biggest_win', value, u.id);
      } else if (type === 'total') {
        rows = q('SELECT id, name, total_won AS value FROM users WHERE banned = 0 ORDER BY total_won DESC, id LIMIT 100').all();
        value = u.total_won;
        rank = rankOf('total_won', value, u.id);
      } else {
        throw new ApiError(400, 'bad_type', 'ランキングの種類が正しくありません');
      }
      return {
        type,
        rows: rows.map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, value: r.value, online: live.isOnline(r.id) })),
        me: { rank, value },
        players: q('SELECT COUNT(*) AS n FROM users WHERE banned = 0').get().n,
        online: live.onlineCount()
      };
    },

    'GET /api/user': (req, u, url) => {
      const id = posInt(url.searchParams.get('id'), 'ユーザーID');
      const t = getUser(id);
      if (!t || t.banned) throw new ApiError(404, 'not_found', 'ユーザーが見つかりません');
      return { user: publicDto(t), blocked: isBlocked(u.id, id), self: id === u.id };
    },

    'GET /api/conversations': (req, u) => {
      const rows = q(`SELECT c.other_id AS id, c.unread, c.updated_at, o.name, o.banned, m.kind, m.body, m.amount, m.currency, m.sender_id
                      FROM conversations c JOIN users o ON o.id = c.other_id JOIN messages m ON m.id = c.last_id
                      WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT 100`).all(u.id);
      return {
        conversations: rows.filter((r) => !r.banned).map((r) => ({
          user: { id: r.id, name: r.name, online: live.isOnline(r.id) },
          unread: r.unread,
          at: r.updated_at,
          last: { kind: r.kind, text: r.body, amount: r.amount, currency: r.currency, mine: r.sender_id === u.id }
        })),
        unread: unreadTotal(u.id)
      };
    },

    'GET /api/messages': (req, u, url) => {
      const withId = url.searchParams.get('with');
      const channel = withId ? dmChannel(u.id, posInt(withId, 'ユーザーID')) : 'lobby';
      const beforeRaw = Number(url.searchParams.get('before'));
      const before = Number.isSafeInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : Number.MAX_SAFE_INTEGER;
      const rows = q(`SELECT m.*, s.name AS sender_name FROM messages m LEFT JOIN users s ON s.id = m.sender_id
                      WHERE m.channel = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`).all(channel, before, PAGE);
      let list = rows.reverse();
      if (channel === 'lobby') {
        const blocked = new Set(q('SELECT blocked_id FROM blocks WHERE user_id = ?').all(u.id).map((r) => r.blocked_id));
        list = list.filter((m) => !blocked.has(m.sender_id));
      }
      return { channel, messages: list.map(msgDto), hasMore: rows.length === PAGE };
    },

    'POST /api/messages': async (req, u) => {
      const body = await readJson(req);
      const text = cleanText(body.text);
      if (body.to === 'lobby') {
        rate(limit.lobby, u.id, '連続して送信できません。少し待ってください');
        const m = insertMessage({ channel: 'lobby', sender: u, kind: 'text', body: text });
        const dto = msgDto(m);
        live.broadcast('msg', dto, (uid) => uid === u.id || !isBlocked(uid, u.id));
        return { message: dto };
      }
      const to = posInt(body.to, '宛先');
      if (to === u.id) throw new ApiError(400, 'self', '自分にはメッセージを送れません');
      const target = getUser(to);
      if (!target || target.banned) throw new ApiError(404, 'not_found', 'ユーザーが見つかりません');
      if (isBlocked(to, u.id)) throw new ApiError(403, 'blocked', 'このユーザーにはメッセージを送れません');
      rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
      const m = tx(db, () => {
        const row = insertMessage({ channel: dmChannel(u.id, to), sender: u, recipient: to, kind: 'text', body: text });
        touchConversations(u.id, to, row.id);
        return row;
      });
      const dto = msgDto(m);
      live.send(to, 'msg', { ...dto, unread: unreadTotal(to) });
      live.send(u.id, 'msg', dto);
      return { message: dto };
    },

    'POST /api/read': async (req, u) => {
      const body = await readJson(req);
      const other = posInt(body.with, 'ユーザーID');
      rate(limit.read, u.id);
      q('UPDATE conversations SET unread = 0 WHERE user_id = ? AND other_id = ?').run(u.id, other);
      return { unread: unreadTotal(u.id) };
    },

    'POST /api/transfer': async (req, u) => {
      const body = await readJson(req);
      const to = posInt(body.to, '宛先');
      const currency = String(body.currency || '');
      if (!CURRENCIES.includes(currency)) throw new ApiError(400, 'bad_currency', '送金する通貨が正しくありません');
      const amount = posInt(body.amount, '送金額');
      const max = currency === 'tokens' ? config.maxTransferTokens : config.maxTransferDollars;
      if (amount > max) throw new ApiError(400, 'too_much', `1回に送れるのは ${fmt(max)} ${currency === 'tokens' ? 'トークン' : '$'} までです`);
      if (to === u.id) throw new ApiError(400, 'self', '自分には送金できません');
      const target = getUser(to);
      if (!target || target.banned) throw new ApiError(404, 'not_found', 'ユーザーが見つかりません');
      if (isBlocked(to, u.id)) throw new ApiError(403, 'blocked', 'このユーザーには送金できません');
      rate(limit.transfer, u.id, '送金が続いています。少し待ってからお試しください');
      const m = tx(db, () => {
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
      const dto = msgDto(m);
      const mine = getUser(u.id);
      const theirs = getUser(to);
      live.send(to, 'balance', balance(theirs));
      live.send(to, 'msg', { ...dto, unread: unreadTotal(to) });
      live.send(u.id, 'balance', balance(mine));
      live.send(u.id, 'msg', dto);
      return { balance: balance(mine), message: dto };
    },

    'GET /api/blocks': (req, u) => ({
      blocks: q('SELECT b.blocked_id AS id, o.name FROM blocks b JOIN users o ON o.id = b.blocked_id WHERE b.user_id = ? ORDER BY b.created_at DESC').all(u.id)
    }),

    'POST /api/block': async (req, u) => {
      const body = await readJson(req);
      const id = posInt(body.user, 'ユーザーID');
      if (id === u.id) throw new ApiError(400, 'self', '自分はブロックできません');
      if (!getUser(id)) throw new ApiError(404, 'not_found', 'ユーザーが見つかりません');
      if (body.blocked) q('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)').run(u.id, id, Date.now());
      else q('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').run(u.id, id);
      return { blocked: !!body.blocked };
    },

    'POST /api/stream-ticket': (req, u) => ({ ticket: live.ticket(u.id) })
  };

  const PUBLIC = new Set(['GET /api/health', 'POST /api/register', 'POST /api/login']);

  function stream(req, res, url) {
    const userId = live.redeem(url.searchParams.get('ticket'));
    if (!userId) throw new ApiError(401, 'ticket', '接続の有効期限が切れました');
    const u = getUser(userId);
    if (!u || u.banned) throw new ApiError(403, 'banned', 'このアカウントは利用停止されています');
    live.attach(req, res, userId, { me: meDto(u), unread: unreadTotal(userId), online: live.onlineCount() + (live.isOnline(userId) ? 0 : 1) });
  }

  // Periodic clean-up: trim the lobby, old spin records and stale sessions.
  function housekeeping() {
    try {
      q(`DELETE FROM messages WHERE channel = 'lobby' AND id <= COALESCE(
           (SELECT id FROM messages WHERE channel = 'lobby' ORDER BY id DESC LIMIT 1 OFFSET ${LOBBY_KEEP}), 0)`).run();
      q('DELETE FROM spins WHERE created_at < ?').run(Date.now() - 30 * 86400000);
      q('DELETE FROM sessions WHERE last_used < ?').run(Date.now() - 180 * 86400000);
      for (const l of Object.values(limit)) l.prune();
    } catch (e) {
      console.error('housekeeping failed', e);
    }
  }
  const hk = setInterval(housekeeping, 3600000);
  hk.unref();

  async function handle(req, res, url) {
    const key = `${req.method} ${url.pathname}`;
    try {
      if (key === 'GET /api/stream') { stream(req, res, url); return; }
      const route = routes[key];
      if (!route) throw new ApiError(404, 'not_found', 'APIが見つかりません');
      let user = null;
      if (!PUBLIC.has(key)) {
        user = authUser(req);
        rate(limit.general, user.id);
      }
      const out = await route(req, user, url);
      sendJson(res, 200, out);
    } catch (e) {
      sendError(res, e);
    }
  }

  return { handle, housekeeping, close: () => { clearInterval(hk); if (boardTimer) clearTimeout(boardTimer); } };
}
