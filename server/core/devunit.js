// Shared operator/developer discussion; viewers and players have no access.
import { ApiError } from './errors.js';

export function createDevUnit({ q, ops, live, getUser, isDeveloper }) {
  const last = () => Number(q('SELECT COALESCE(MAX(id), 0) AS id FROM devunit_comments').get().id);
  const cursor = (raw) => {
    const n = Number(raw || 0);
    if (!Number.isSafeInteger(n) || n < 0) throw new ApiError(400, 'bad_cursor', 'コメントの位置が正しくありません');
    return n;
  };
  const dto = (r) => {
    const u = getUser(r.user_id);
    return { id: r.id, from: { id: r.user_id, name: u ? u.name : '削除された運営者', developer: !!u && isDeveloper(u) }, text: r.body, at: r.created_at };
  };
  return { routes: {
    'GET /api/ops/devunit/counts': (req, u) => {
      ops.need(u);
      const read = q('SELECT last_id FROM devunit_reads WHERE user_id = ?').get(u.id);
      return { latest: last(), unread: q('SELECT COUNT(*) AS n FROM devunit_comments WHERE id > ? AND user_id != ?').get(read ? read.last_id : 0, u.id).n };
    },
    'GET /api/ops/devunit/comments': (req, u) => {
      ops.need(u);
      const before = cursor(req.query.get('before'));
      const rows = before
        ? q('SELECT * FROM devunit_comments WHERE id < ? ORDER BY id DESC LIMIT 101').all(before)
        : q('SELECT * FROM devunit_comments ORDER BY id DESC LIMIT 101').all();
      return { more: rows.length > 100, comments: rows.slice(0, 100).reverse().map(dto) };
    },
    'POST /api/ops/devunit/comments': async (req, u) => {
      ops.need(u);
      const body = await req.json(12 * 1024);
      if (typeof body.text !== 'string') throw new ApiError(400, 'bad_text', 'コメントを入力してください');
      const text = body.text.replace(/\r\n?/g, '\n').trim();
      if (!text || Array.from(text).length > 2000) throw new ApiError(400, 'bad_text', 'コメントは1〜2000文字で入力してください');
      const at = Date.now();
      const r = q('INSERT INTO devunit_comments (user_id, body, created_at) VALUES (?, ?, ?)').run(u.id, text, at);
      const comment = dto({ id: Number(r.lastInsertRowid), user_id: u.id, body: text, created_at: at });
      for (const o of ops.operatorList()) if (o.operator && o.id && o.id !== u.id) live.sendOps(o.id, 'devunit', { id: comment.id, from: comment.from });
      return { comment };
    },
    'POST /api/ops/devunit/read': async (req, u) => {
      ops.need(u);
      const body = await req.json(1024), id = Math.min(cursor(body.id), last());
      q('INSERT INTO devunit_reads (user_id, last_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)').run(u.id, id);
      return { ok: true };
    }
  } };
}
