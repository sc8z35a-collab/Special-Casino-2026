// Player feedback stays private to its author and the developer. No diary
// comment/original is copied into the operator-visible chat detection tables.
import { Buffer } from 'node:buffer';
import { ApiError, posInt } from './errors.js';
import { cleanText } from './auth.js';
import { screen } from './filter.js';

export const DIARY_REWARDS = Array.from({ length: 25 }, (_, i) => (i + 1) * 10000);
export const DIARY_TTL = 30 * 86400000;
export function createDiary({ q, tx, ops, isDeveloper, getUser, mini, live, balanceChanged, meDto, chatAllowed, commentRate, opsLog, gate = null }) {
  const developer = (u) => {
    ops.need(u);
    if (!isDeveloper(u)) throw new ApiError(403, 'developer_only', '開発者日記の管理・コメント閲覧は開発者だけが利用できます');
  };
  const post = (id, admin = false) => {
    const p = q('SELECT * FROM diary_posts WHERE id = ?').get(posInt(id, '投稿'));
    if (!p || (!admin && p.hidden)) throw new ApiError(404, 'not_found', 'この投稿は表示できません');
    return p;
  };
  const before = (raw) => {
    const n = raw === null ? Number.MAX_SAFE_INTEGER : Number(raw);
    if (!Number.isSafeInteger(n) || n <= 0) throw new ApiError(400, 'bad_cursor', 'ページの位置が正しくありません');
    return n;
  };
  const dto = (p, u, admin) => {
    const r = q('SELECT * FROM diary_reactions WHERE post_id = ? AND user_id = ?').get(p.id, u.id);
    const claimed = !!q('SELECT 1 AS x FROM diary_claims WHERE post_id = ? AND user_id = ?').get(p.id, u.id);
    return { id: p.id, title: p.title, text: p.body, hasImage: !!p.has_image, at: p.created_at,
      reward: p.reward, expiresAt: p.expires_at, claimed, claimable: !!p.reward && !p.hidden && !claimed && p.expires_at > Date.now(),
      liked: !!r?.liked, bookmarked: !!r?.bookmarked,
      likes: q('SELECT COUNT(*) AS n FROM diary_reactions WHERE post_id = ? AND liked = 1').get(p.id).n,
      ...(admin ? { hidden: !!p.hidden, comments: q('SELECT COUNT(*) AS n FROM diary_comments WHERE post_id = ?').get(p.id).n,
        bookmarks: q('SELECT COUNT(*) AS n FROM diary_reactions WHERE post_id = ? AND bookmarked = 1').get(p.id).n,
        claims: q('SELECT COUNT(*) AS n FROM diary_claims WHERE post_id = ?').get(p.id).n } : {}) };
  };
  const list = (req, u, admin) => {
    const cursor = before(req.query.get('before')), saved = !admin && req.query.get('bookmarks') === '1';
    const rows = q(`SELECT p.id, p.title, p.body, p.reward, p.created_at, p.expires_at, p.hidden, (p.image != '') AS has_image
      FROM diary_posts p WHERE p.id < ? ${admin ? '' : 'AND p.hidden = 0'}
      ${saved ? 'AND EXISTS (SELECT 1 FROM diary_reactions r WHERE r.post_id = p.id AND r.user_id = ? AND r.bookmarked = 1)' : ''}
      ORDER BY p.id DESC LIMIT 11`).all(cursor, ...(saved ? [u.id] : []));
    return { posts: rows.slice(0, 10).map(p => dto(p, u, admin)), more: rows.length > 10, rewards: admin ? DIARY_REWARDS : undefined };
  };
  function image(raw) {
    if (raw === undefined || raw === '') return '';
    if (typeof raw !== 'string' || raw.length > 710000) throw new ApiError(400, 'bad_image', '画像は512KB以下のPNG・JPEG・WebPにしてください');
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
    if (!m) throw new ApiError(400, 'bad_image', 'PNG・JPEG・WebP画像を選んでください');
    const b = Buffer.from(m[2], 'base64');
    const valid = m[1] === 'png' ? b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : m[1] === 'jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255
        : b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
    if (!valid || b.length > 512 * 1024 || b.toString('base64') !== m[2]) throw new ApiError(400, 'bad_image', '画像の形式またはサイズが正しくありません');
    return raw;
  }
  const changed = (id) => live.broadcast('diary', { id });
  return { routes: {
    'GET /api/diary': (req, u) => list(req, u, false),
    'GET /api/diary/image': (req) => ({ image: post(req.query.get('post')).image }),
    'POST /api/diary/read': async (req, u) => {
      const p = post((await req.json()).post);
      q('INSERT OR IGNORE INTO diary_reads (post_id, user_id, at) VALUES (?, ?, ?)').run(p.id, u.id, Date.now());
      return { ok: true };
    },
    'POST /api/diary/react': async (req, u) => {
      const b = await req.json(), p = post(b.post);
      if (!['liked', 'bookmarked'].includes(b.kind) || typeof b.on !== 'boolean') throw new ApiError(400, 'bad_reaction', '反応が正しくありません');
      q(`INSERT INTO diary_reactions (post_id, user_id, ${b.kind}) VALUES (?, ?, ?) ON CONFLICT(post_id, user_id) DO UPDATE SET ${b.kind} = excluded.${b.kind}`).run(p.id, u.id, b.on ? 1 : 0);
      return { ok: true };
    },
    'GET /api/diary/comments': (req, u) => {
      const p = post(req.query.get('post')), cursor = before(req.query.get('before'));
      const rows = q('SELECT id, body AS text, created_at AS at FROM diary_comments WHERE post_id = ? AND user_id = ? AND id < ? ORDER BY id DESC LIMIT 51').all(p.id, u.id, cursor);
      return { comments: rows.slice(0, 50), more: rows.length > 50 };
    },
    'POST /api/diary/comments': async (req, u) => {
      chatAllowed(u); commentRate(u);
      const b = await req.json(16 * 1024), p = post(b.post);
      if (typeof b.text !== 'string') throw new ApiError(400, 'bad_text', 'コメントを入力してください');
      const text = cleanText(b.text, 2000), f = screen(text), at = Date.now();
      const r = q('INSERT INTO diary_comments (post_id, user_id, body, original, words, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(p.id, u.id, f.masked, text, JSON.stringify(f.words), at);
      return { comment: { id: Number(r.lastInsertRowid), text: f.masked, at } };
    },
    'POST /api/diary/claim': async (req, u) => {
      const b = await req.json();
      const paid = tx(() => {
        const p = post(b.post);
        if (!p.reward || p.expires_at <= Date.now()) throw new ApiError(409, 'expired', '報酬の受け取り期限が過ぎています');
        const r = q('INSERT OR IGNORE INTO diary_claims (post_id, user_id, amount, at) VALUES (?, ?, ?, ?)').run(p.id, u.id, p.reward, Date.now());
        if (!r.changes) return 0;
        q('UPDATE users SET dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(p.reward, u.id);
        return p.reward;
      });
      if (paid) balanceChanged(u.id);
      return { paid, me: meDto(getUser(u.id)) };
    },
    'GET /api/ops/diary': (req, u) => { developer(u); return list(req, u, true); },
    'GET /api/ops/diary/image': (req, u) => { developer(u); return { image: post(req.query.get('post'), true).image }; },
    'POST /api/ops/diary': async (req, u) => {
      developer(u);
      const b = await req.json(800 * 1024);
      if (typeof b.title !== 'string' || typeof b.text !== 'string') throw new ApiError(400, 'bad_text', 'タイトルと本文を入力してください');
      const title = cleanText(b.title, 100), text = cleanText(b.text, 20000), img = image(b.image), reward = b.reward ?? 0;
      if (reward !== 0 && !DIARY_REWARDS.includes(reward)) throw new ApiError(400, 'bad_reward', '報酬は10k〜250kから選択してください');
      // (a picture comes in whole: an extension may refuse it, server/core/ext.js)
      if (gate) gate.inline({ user: u, req, kind: 'diary', name: 'diary-image', bytes: img ? Buffer.from(img.slice(img.indexOf(',') + 1), 'base64') : null });
      const at = Date.now(), id = tx(() => {
        const r = q('INSERT INTO diary_posts (title, body, image, reward, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(title, text, img, reward, at, at + DIARY_TTL);
        const id = Number(r.lastInsertRowid);
        opsLog.add({ actor: u, action: 'diary_publish', req, summary: `開発者日記 #${id} を公開`, detail: { id, title, reward } });
        return id;
      });
      changed(id); return { id };
    },
    'POST /api/ops/diary/visibility': async (req, u) => {
      developer(u); const b = await req.json(), p = post(b.post, true);
      if (typeof b.hidden !== 'boolean') throw new ApiError(400, 'bad_visibility', '表示状態が正しくありません');
      tx(() => {
        q('UPDATE diary_posts SET hidden = ? WHERE id = ?').run(b.hidden ? 1 : 0, p.id);
        opsLog.add({ actor: u, action: 'diary_visibility', req, summary: `開発者日記 #${p.id} を${b.hidden ? '一時非表示' : '再公開'}` });
      });
      changed(p.id); return { ok: true };
    },
    'POST /api/ops/diary/delete': async (req, u) => {
      developer(u); const b = await req.json(), p = post(b.post, true);
      if (b.confirm !== true) throw new ApiError(400, 'confirmation', '完全削除を確認してください');
      tx(() => {
        for (const table of ['diary_reads', 'diary_reactions', 'diary_comments', 'diary_claims']) q(`DELETE FROM ${table} WHERE post_id = ?`).run(p.id);
        q('DELETE FROM diary_posts WHERE id = ?').run(p.id);
        opsLog.add({ actor: u, action: 'diary_delete', req, summary: `開発者日記 #${p.id} を完全削除` });
      });
      changed(p.id); return { ok: true };
    },
    'GET /api/ops/diary/comments': (req, u) => {
      developer(u); const p = post(req.query.get('post'), true), cursor = before(req.query.get('before'));
      const rows = q('SELECT * FROM diary_comments WHERE post_id = ? AND id < ? ORDER BY id DESC LIMIT 51').all(p.id, cursor);
      return { comments: rows.slice(0, 50).map(c => ({ id: c.id, from: mini(getUser(c.user_id) || { id: c.user_id, name: '削除されたプレイヤー', avatar: '' }), text: c.body, original: c.original, words: JSON.parse(c.words), at: c.created_at })), more: rows.length > 50 };
    }
  } };
}
