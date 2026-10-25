// Ice Smoker公式: the operators' account in every player's messages
// (always at the top, always online). Players can write to it, send a 報告
// (a bug, an error, something odd) or a 意見案 (an idea for the game) of any
// length; it cannot be blocked, reported or called. The operators answer
// through it from the operator site (server/core/ops.js): messages (taken
// back within the hour if need be), money (it arrives with the player's tap),
// thanks for an accepted report. A player who waited two days without an
// answer gets an automatic one (and their messages are marked read).
import { newRecoveryCode, sha256 } from './auth.js';

export const NAME = 'Ice Smoker公式';
export const WAIT_MS = 2 * 86400000;
export const AUTO_TEXT = '（自動返信）ただいま大変混み合っております。すべてのメッセージに担当者が手動で返信しているため、返信まで数日かかる場合がございます。ご迷惑をおかけし、申し訳ございません。';
const LONG = 20000;   // 報告 and 意見案: no limit a player would reach

// ctx: { q, tx, getUser, insertMessage, msgDto, touchConversations, unreadTotal, live, balanceChanged, dmChannel, onDelivered }
export function createOfficial(ctx) {
  const { q, tx, getUser, live } = ctx;
  let botId = 0;

  function id() {
    const cached = botId && q('SELECT npc FROM users WHERE id = ?').get(botId);
    if (cached && cached.npc === 'official') return botId;
    let row = q("SELECT id FROM users WHERE npc = 'official' LIMIT 1").get();
    if (!row) {
      const now = Date.now();
      q(`INSERT INTO users (name, name_key, recovery_hash, avatar, tokens, dollars, coins, npc, created_at, last_seen)
         VALUES (?, ?, ?, 'official', 0, 0, 0, 'official', ?, ?)`)
        .run(NAME, 'npc:official', sha256(newRecoveryCode() + ':official'), now, now);
      row = q("SELECT id FROM users WHERE npc = 'official' LIMIT 1").get();
    }
    q('UPDATE users SET name = ? WHERE id = ? AND name != ?').run(NAME, row.id, NAME);
    botId = row.id;
    return botId;
  }
  function me() { const b = q('SELECT id, name, avatar FROM users WHERE id = ?').get(id()); return { id: b.id, name: b.name, avatar: b.avatar, npc: 'official' }; }
  const thread = (userId) => q('SELECT * FROM bot_threads WHERE user_id = ?').get(userId) || { user_id: userId, waiting_since: 0, ops_at: 0, auto_at: 0 };
  function saveThread(t) {
    q(`INSERT INTO bot_threads (user_id, waiting_since, ops_at, auto_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET waiting_since = excluded.waiting_since, ops_at = excluded.ops_at, auto_at = excluded.auto_at`)
      .run(t.user_id, t.waiting_since, t.ops_at, t.auto_at);
  }

  function deliver(userId, row) {
    const dto = ctx.msgDto(row);
    live.send(userId, 'msg', { ...dto, unread: ctx.unreadTotal(userId) });
    if (ctx.onDelivered) ctx.onDelivered(userId, dto);
    return dto;
  }

  // From the bot to a player (unread for them).
  function say(userId, text) {
    const bid = id();
    const row = tx(() => {
      const r = ctx.insertMessage({ channel: ctx.dmChannel(userId, bid), sender: getUser(bid), recipient: userId, kind: 'text', body: String(text).slice(0, LONG) });
      ctx.touchConversations(userId, bid, r.id, userId);
      return r;
    });
    return deliver(userId, row);
  }
  // Money (or spin tokens) from the operators: a card in the chat like a
  // transfer, and it arrives when the player taps it (POST /api/messages/claim).
  function pay(userId, amount, currency = 'dollars') {
    const bid = id();
    const col = currency === 'tokens' ? 'tokens' : 'dollars';
    const row = tx(() => {
      const r = ctx.insertMessage({ channel: ctx.dmChannel(userId, bid), sender: getUser(bid), recipient: userId, kind: 'transfer', amount, currency: col, pending: true });
      ctx.touchConversations(userId, bid, r.id, userId);
      return r;
    });
    return deliver(userId, row);
  }

  // A player wrote to the bot (a message, a 報告 or a 意見案): it waits for the operators.
  function fromPlayer(u, text) {
    const bid = id();
    const row = tx(() => {
      const r = ctx.insertMessage({ channel: ctx.dmChannel(u.id, bid), sender: u, recipient: bid, kind: 'text', body: String(text).slice(0, LONG) });
      ctx.touchConversations(u.id, bid, r.id, bid);
      const t = thread(u.id);
      if (!t.waiting_since) t.waiting_since = r.created_at;
      saveThread(t);
      return r;
    });
    const dto = ctx.msgDto(row);
    live.send(u.id, 'msg', dto);
    return dto;
  }

  // The operators answered (or sent something): nothing waits any more.
  function answered(userId) {
    const t = thread(userId);
    t.waiting_since = 0;
    t.ops_at = Date.now();
    saveThread(t);
  }

  // The operators looked at the conversation: the player sees 既読.
  function markRead(userId) {
    const bid = id();
    const c = q('SELECT last_id, read_id FROM conversations WHERE user_id = ? AND other_id = ?').get(bid, userId);
    if (!c) return 0;
    q('UPDATE conversations SET unread = 0, read_id = last_id WHERE user_id = ? AND other_id = ?').run(bid, userId);
    if (c.last_id > c.read_id) live.send(userId, 'read', { dm: bid, upto: c.last_id });
    return c.last_id;
  }

  const waiting = (userId) => thread(userId).waiting_since > 0;
  function waitingIds() { return new Set(q('SELECT user_id FROM bot_threads WHERE waiting_since > 0').all().map((r) => r.user_id)); }

  // Two days without an answer: the messages are read and the bot answers on its own (once per wait).
  function autoReplies(now = Date.now()) {
    const due = q('SELECT * FROM bot_threads WHERE waiting_since > 0 AND waiting_since <= ? AND auto_at < waiting_since').all(now - WAIT_MS);
    const done = [];
    for (const t of due) {
      const u = getUser(t.user_id);
      if (!u || u.npc) continue;
      markRead(u.id);
      say(u.id, AUTO_TEXT);
      t.auto_at = now;
      saveThread(t);
      done.push(u);
    }
    return done;
  }

  // the messages of the conversation, oldest first (the operator site's chat;
  // a message taken back still shows what it said: `original`)
  function conversation(userId, limit = 300) {
    const bid = id();
    const rows = q(`SELECT m.*, s.name AS sender_name, s.avatar AS sender_avatar FROM messages m LEFT JOIN users s ON s.id = m.sender_id
                    WHERE m.channel = ? ORDER BY m.id DESC LIMIT ?`).all(ctx.dmChannel(userId, bid), limit).reverse();
    const read = q('SELECT read_id FROM conversations WHERE user_id = ? AND other_id = ?').get(userId, bid);
    return { messages: rows.map((r) => (r.retracted_at ? { ...ctx.msgDto(r), original: r.body } : ctx.msgDto(r))), playerReadUpTo: read ? read.read_id : 0, thread: thread(userId) };
  }

  return { id, me, is: (userId) => userId === id(), say, pay, fromPlayer, answered, markRead, waiting, waitingIds, autoReplies, conversation, LONG };
}
