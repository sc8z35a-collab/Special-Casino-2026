// 運営チャット on the operator site: the operators, live (on the site now:
// seen there in the last 40 seconds; in the game; or away since when), and
// their talk, one to one or all together (to 0). Messages stay; each
// operator's read point per conversation gives the unread counts and 既読.
import { ApiError, posInt } from './errors.js';

const ON_SITE_MS = 40000;
const TEXT_MAX = 2000;
const PAGE = 100;

export function createTeam({ q, getUser, live, ops, seen }) {
  // the operators now (the ones whose rights were taken away are not)
  const members = () => ops.operatorList().filter((o) => o.operator && o.id);
  function needMember(u) {
    ops.need(u);
    return u;
  }
  function peerOf(u, raw) {
    const id = Number(raw || 0);
    if (id === 0) return 0;
    const to = posInt(id, '相手');
    if (to === u.id || !members().some((o) => o.id === to)) throw new ApiError(404, 'not_operator', 'その運営者は見つかりません');
    return to;
  }
  const readOf = (userId, peer) => (q('SELECT read_id FROM ops_reads WHERE user_id = ? AND peer_id = ?').get(userId, peer) || { read_id: 0 }).read_id;
  function unread(u, peer) {
    const after = readOf(u.id, peer);
    return peer === 0
      ? q('SELECT COUNT(*) AS n FROM ops_messages WHERE to_id = 0 AND from_id != ? AND id > ?').get(u.id, after).n
      : q('SELECT COUNT(*) AS n FROM ops_messages WHERE to_id = ? AND from_id = ? AND id > ?').get(u.id, peer, after).n;
  }
  function who(id) {
    const p = getUser(id);
    return p ? { id: p.id, name: p.name, avatar: p.avatar } : { id, name: '?', avatar: '' };
  }
  const dto = (m) => ({ id: m.id, from: who(m.from_id), to: m.to_id, text: m.body, at: m.created_at });

  const routes = {
    // who is here, and what is unread
    'GET /api/ops/team': (req, u) => {
      needMember(u);
      const now = Date.now();
      const last = q('SELECT * FROM ops_messages WHERE to_id = 0 ORDER BY id DESC LIMIT 1').get();
      return {
        me: u.id, now,
        operators: members().map((o) => {
          const p = getUser(o.id);
          const at = seen.get(o.id) || 0;
          return {
            id: o.id, name: o.name, avatar: o.avatar, developer: o.developer, me: o.id === u.id,
            site: now - at < ON_SITE_MS, game: live.isOnline(o.id), seenAt: Math.max(at, p ? p.last_seen : 0),
            unread: o.id === u.id ? 0 : unread(u, o.id)
          };
        }),
        all: { unread: unread(u, 0), last: last ? dto(last) : null }
      };
    },

    // a conversation (with: an operator's id, or 0 for everyone), newest last
    'GET /api/ops/team/messages': (req, u) => {
      needMember(u);
      const peer = peerOf(u, req.query.get('with'));
      const after = Number(req.query.get('after') || 0);
      const where = peer === 0 ? 'to_id = 0' : '((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))';
      const args = peer === 0 ? [] : [u.id, peer, peer, u.id];
      const rows = after > 0
        ? q(`SELECT * FROM ops_messages WHERE ${where} AND id > ? ORDER BY id LIMIT ?`).all(...args, after, PAGE)
        : q(`SELECT * FROM ops_messages WHERE ${where} ORDER BY id DESC LIMIT ?`).all(...args, PAGE).reverse();
      // how far the other one has read (one to one: 既読)
      return { with: peer, messages: rows.map(dto), theirRead: peer === 0 ? 0 : readOf(peer, u.id) };
    },

    'POST /api/ops/team/messages': async (req, u) => {
      needMember(u);
      const body = await req.json(16 * 1024);
      const to = peerOf(u, body.to);
      const text = String(body.text ?? '').replace(/\r\n?/g, '\n').trim();
      if (!text) throw new ApiError(400, 'empty', 'メッセージを入力してください');
      if (Array.from(text).length > TEXT_MAX) throw new ApiError(400, 'too_long', `メッセージは${TEXT_MAX}文字までです`);
      const r = q('INSERT INTO ops_messages (from_id, to_id, body, created_at) VALUES (?, ?, ?, ?)').run(u.id, to, text, Date.now());
      const id = Number(r.lastInsertRowid);
      q('INSERT INTO ops_reads (user_id, peer_id, read_id) VALUES (?, ?, ?) ON CONFLICT(user_id, peer_id) DO UPDATE SET read_id = MAX(read_id, excluded.read_id)').run(u.id, to, id);
      return { message: dto(q('SELECT * FROM ops_messages WHERE id = ?').get(id)) };
    },

    // read up to a message
    'POST /api/ops/team/read': async (req, u) => {
      needMember(u);
      const body = await req.json();
      const peer = peerOf(u, body.with);
      const upTo = Number(body.upTo);
      if (!Number.isSafeInteger(upTo) || upTo < 0) throw new ApiError(400, 'bad_read', '既読の位置が正しくありません');
      q('INSERT INTO ops_reads (user_id, peer_id, read_id) VALUES (?, ?, ?) ON CONFLICT(user_id, peer_id) DO UPDATE SET read_id = MAX(read_id, excluded.read_id)').run(u.id, peer, upTo);
      return { ok: true };
    }
  };

  return { routes };
}
