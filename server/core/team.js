// 運営チャット on the operator site: the operators, live (on the site now:
// seen there in the last 40 seconds; in the game; or away since when), and
// their talk, one to one or all together (to 0). Messages stay (nobody can
// take one back); each operator's read point per conversation gives the
// unread counts and 既読. The developer can read the one-to-one talks
// between the other operators too (they are told so on the page).
// A message may name a player (@[p:<id>], shown as the player, a tap opening
// them), call the developer (@[dev]: they hear of it at once, wherever they
// are) and quote any line of the log (@[log:<id>]).
// The 全体チャット has a voice call for every operator, as many as come and
// for as long as they like (ops_call: who is in it), its signalling over the
// operator site's own live connection (server/cloudflare/casino.js,
// server/node/live.js: sendOps). A message, or one read further, is told to the
// others over that connection too (opschat): the site asks for the conversation
// then, and its tab does not ask every few seconds.
import { ApiError, posInt, pageLimit } from './errors.js';
import { kindOf } from './opslog.js';

const ON_SITE_MS = 40000;
const TEXT_MAX = 2000;
const PAGE = 100;
// in a message: a player, the developer, a log line
const TOKEN = /@\[(p:\d{1,15}|dev|log:\d{1,15})\]/g;
const TOKENS_MAX = 20;
// a call's signal (an offer, an answer, a candidate)
const SIGNAL_MAX = 64 * 1024;

// callDeveloper(u, text, to): the developer called (@[dev]); ice(): the call's ICE servers
export function createTeam({ q, getUser, live, ops, seen, isDeveloper, callDeveloper = () => {}, ice = async () => [] }) {
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
  // the players, the developer and the log lines a message names
  function refsOf(text) {
    const players = {}, logs = {};
    let dev = false;
    for (const t of String(text || '').matchAll(TOKEN)) {
      if (t[1] === 'dev') { dev = true; continue; }
      const id = Number(t[1].slice(t[1].indexOf(':') + 1));
      if (t[1][0] === 'p') {
        const p = players[id] ? null : getUser(id);
        if (p) players[id] = { id: p.id, name: p.name, avatar: p.avatar };
      } else if (!logs[id]) {
        const r = q('SELECT id, at, action, summary, actor_name FROM ops_log WHERE id = ?').get(id);
        if (r) logs[id] = { id: r.id, at: r.at, action: r.action, kind: kindOf(r.action), summary: r.summary, actor: r.actor_name };
      }
    }
    return dev || Object.keys(players).length || Object.keys(logs).length ? { dev, players, logs } : undefined;
  }
  // what is sent: only players and log lines that are there (a wrong one goes), so many at most
  function cleanTokens(text) {
    let n = 0;
    return text.replace(TOKEN, (all, t) => {
      if (++n > TOKENS_MAX) return '';
      if (t === 'dev') return all;
      const id = Number(t.slice(t.indexOf(':') + 1));
      if (t[0] === 'p') { const p = getUser(id); return p && !p.npc ? all : '@?'; }
      return q('SELECT 1 AS x FROM ops_log WHERE id = ?').get(id) ? all : '';
    });
  }
  const dto = (m) => ({ id: m.id, from: who(m.from_id), to: m.to_id, text: m.body, at: m.created_at, refs: refsOf(m.body) });

  /* the 全体チャット's call: who is in it now (with the site's live connection still there) */
  function inCall(list = members()) {
    const rows = q('SELECT * FROM ops_call ORDER BY at').all();
    const ids = new Set(list.map((o) => o.id));
    return rows.filter((r) => ids.has(r.user_id) && live.opsOnline(r.user_id)).map((r) => ({ ...who(r.user_id), since: r.at }));
  }
  function tellCall(except, data) {
    for (const r of q('SELECT user_id FROM ops_call').all()) if (r.user_id !== except) live.sendOps(r.user_id, 'opscall', data);
  }
  // A conversation changed (a message came, or was read): the operators in it are told over the site's live connection, and their site asks for it
  // at once instead of on a timer. `with` is the conversation as the one told knows it: 0 for everyone, or the other person.
  function nudge(from, to) {
    if (to === 0) {
      for (const o of members()) if (o.id !== from) live.sendOps(o.id, 'opschat', { with: 0 });
    } else live.sendOps(to, 'opschat', { with: from });
  }
  // one's site connection gone: out of the call (the others are told)
  function gone(userId) {
    if (!Number(q('DELETE FROM ops_call WHERE user_id = ?').run(userId).changes)) return;
    tellCall(userId, { type: 'leave', user: who(userId), members: inCall() });
  }

  const routes = {
    // who is here, and what is unread
    'GET /api/ops/team': (req, u) => {
      needMember(u);
      const now = Date.now();
      const last = q('SELECT * FROM ops_messages WHERE to_id = 0 ORDER BY id DESC LIMIT 1').get();
      const list = members();
      return {
        me: u.id, now,
        operators: list.map((o) => {
          const p = getUser(o.id);
          const at = seen.get(o.id) || 0;
          return {
            id: o.id, name: o.name, avatar: o.avatar, developer: o.developer, me: o.id === u.id,
            site: now - at < ON_SITE_MS, game: live.isOnline(o.id), seenAt: Math.max(at, p ? p.last_seen : 0),
            unread: o.id === u.id ? 0 : unread(u, o.id)
          };
        }),
        all: { unread: unread(u, 0), last: last ? dto(last) : null },
        call: inCall(list)
      };
    },

    // the developer: the one-to-one talks between the other operators
    'GET /api/ops/team/pairs': (req, u) => {
      needMember(u);
      if (!isDeveloper(u)) throw new ApiError(404, 'not_found', 'APIが見つかりません');
      const rows = q(`SELECT MIN(from_id, to_id) AS a, MAX(from_id, to_id) AS b, COUNT(*) AS n, MAX(id) AS last FROM ops_messages
                      WHERE to_id != 0 AND from_id != ? AND to_id != ? GROUP BY a, b ORDER BY last DESC LIMIT 200`).all(u.id, u.id);
      return { pairs: rows.map((r) => ({ a: who(r.a), b: who(r.b), count: r.n, last: dto(q('SELECT * FROM ops_messages WHERE id = ?').get(r.last)) })) };
    },
    // (the developer) one of those talks: ?a=&b=
    'GET /api/ops/team/pair': (req, u) => {
      needMember(u);
      if (!isDeveloper(u)) throw new ApiError(404, 'not_found', 'APIが見つかりません');
      const a = posInt(Number(req.query.get('a')), '運営者'), b = posInt(Number(req.query.get('b')), '運営者');
      const after = Number(req.query.get('after') || 0);
      const rows = q(`SELECT * FROM ops_messages WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND id > ? ORDER BY id DESC LIMIT ?`)
        .all(a, b, b, a, after, PAGE).reverse();
      return { messages: rows.map(dto) };
    },

    // a conversation (with: an operator's id, or 0 for everyone), newest last
    'GET /api/ops/team/messages': (req, u) => {
      needMember(u);
      const peer = peerOf(u, req.query.get('with'));
      const after = Number(req.query.get('after') || 0);
      // limit=N: the newest N alone (a small window on the desktop, ops/cdw.js)
      const page = pageLimit(req.query.get('limit'), PAGE);
      const where = peer === 0 ? 'to_id = 0' : '((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))';
      const args = peer === 0 ? [] : [u.id, peer, peer, u.id];
      const rows = after > 0
        ? q(`SELECT * FROM ops_messages WHERE ${where} AND id > ? ORDER BY id LIMIT ?`).all(...args, after, page)
        : q(`SELECT * FROM ops_messages WHERE ${where} ORDER BY id DESC LIMIT ?`).all(...args, page).reverse();
      // how far the other one has read (one to one: 既読)
      return { with: peer, messages: rows.map(dto), theirRead: peer === 0 ? 0 : readOf(peer, u.id) };
    },

    'POST /api/ops/team/messages': async (req, u) => {
      needMember(u);
      const body = await req.json(16 * 1024);
      const to = peerOf(u, body.to);
      const text = cleanTokens(String(body.text ?? '').replace(/\r\n?/g, '\n').trim()).trim();
      if (!text) throw new ApiError(400, 'empty', 'メッセージを入力してください');
      if (Array.from(text).length > TEXT_MAX) throw new ApiError(400, 'too_long', `メッセージは${TEXT_MAX}文字までです`);
      const r = q('INSERT INTO ops_messages (from_id, to_id, body, created_at) VALUES (?, ?, ?, ?)').run(u.id, to, text, Date.now());
      const id = Number(r.lastInsertRowid);
      q('INSERT INTO ops_reads (user_id, peer_id, read_id) VALUES (?, ?, ?) ON CONFLICT(user_id, peer_id) DO UPDATE SET read_id = MAX(read_id, excluded.read_id)').run(u.id, to, id);
      const message = dto(q('SELECT * FROM ops_messages WHERE id = ?').get(id));
      // @開発者: the developer hears of it at once (not when they wrote it themselves)
      if (message.refs && message.refs.dev && !isDeveloper(u)) callDeveloper(u, message, to);
      nudge(u.id, to);
      return { message };
    },

    // the 全体チャット's call: in (the others in it are told, and connect to
    // the newcomer), out, and the signals between two of them
    'POST /api/ops/call/join': async (req, u) => {
      needMember(u);
      await req.json();
      if (!live.opsOnline(u.id)) throw new ApiError(409, 'no_live', '運営サイトのリアルタイム接続がありません。ページを再読み込みしてください');
      const others = inCall().filter((m) => m.id !== u.id);
      q('INSERT INTO ops_call (user_id, at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET at = excluded.at').run(u.id, Date.now());
      const now = inCall();
      tellCall(u.id, { type: 'join', user: who(u.id), members: now });
      return { members: now, others, ice: await ice() };
    },
    'POST /api/ops/call/leave': async (req, u) => {
      needMember(u);
      await req.json();
      gone(u.id);
      return { members: inCall() };
    },
    'POST /api/ops/call/signal': async (req, u) => {
      needMember(u);
      const body = await req.json(SIGNAL_MAX + 1024);
      const to = posInt(body.to, '相手');
      const ids = new Set(inCall().map((m) => m.id));
      if (!ids.has(u.id) || !ids.has(to)) throw new ApiError(409, 'not_in_call', '通話に参加していません');
      if (JSON.stringify(body.data ?? null).length > SIGNAL_MAX) throw new ApiError(413, 'too_large', '送信できません。大きすぎます。');
      live.sendOps(to, 'opscall', { type: 'signal', from: who(u.id), data: body.data ?? null });
      return { ok: true };
    },
    'GET /api/ops/call': (req, u) => {
      needMember(u);
      return { members: inCall() };
    },

    // read up to a message
    'POST /api/ops/team/read': async (req, u) => {
      needMember(u);
      const body = await req.json();
      const peer = peerOf(u, body.with);
      const upTo = Number(body.upTo);
      if (!Number.isSafeInteger(upTo) || upTo < 0) throw new ApiError(400, 'bad_read', '既読の位置が正しくありません');
      const before = readOf(u.id, peer);
      q('INSERT INTO ops_reads (user_id, peer_id, read_id) VALUES (?, ?, ?) ON CONFLICT(user_id, peer_id) DO UPDATE SET read_id = MAX(read_id, excluded.read_id)').run(u.id, peer, upTo);
      // (a one to one talk read further: the other one's 既読 moves)
      if (peer !== 0 && upTo > before) nudge(u.id, peer);
      return { ok: true };
    }
  };

  return { routes, gone };
}
