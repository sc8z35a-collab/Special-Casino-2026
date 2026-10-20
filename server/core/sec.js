// security HOME (/sec/): the operators' final safety base, apart from TWO
// STATE itself. It does nothing operational — no players, no money, no vault —
// it only lets the operators watch the server from a cyber-security point of
// view in real time, read the same log the operator site shows, reach one
// another over a channel whose messages are sealed at rest, and raise or lift
// the lockdown. It keeps working during a lockdown, when everything else is
// shut: that is the point of it.
import { ApiError } from './errors.js';
import { sealText, openText, keyFrom } from './auth.js';

const PAGE = 200;
const TEXT_MAX = 4000;

// ops: server/core/ops.js (need(u), operatorList); emergency:
// server/core/emergency.js; shield: server/core/shield.js; health(): the
// server's vital signs; opsLog: the log; seen: when each operator was last on
// a site (shared with the operator site).
export function createSec({ q, getUser, ops, emergency, shield, opsLog, health, secret, isDeveloper, live, seen }) {
  const KEY = keyFrom(secret, 'sec-channel');
  const needOperator = (u) => { ops.need(u); return u; };

  function channelMessage(r) {
    return { id: r.id, from: { id: r.from_id, name: r.from_name }, text: openText(KEY, r.body) || '（読み取れません）', at: r.created_at };
  }
  // the operators and whether each is on the security base now (seen in the
  // last 40 seconds), on the operator site / in the game, or when last online
  function operatorsNow() {
    const now = Date.now();
    return ops.operatorList().filter((o) => o.operator && o.id).map((o) => {
      const p = getUser(o.id);
      const at = (seen && seen.get(o.id)) || 0;
      return { id: o.id, name: o.name, avatar: o.avatar, developer: o.developer, site: now - at < 40000, game: live.isOnline(o.id), seenAt: Math.max(at, p ? p.last_seen : 0) };
    });
  }

  const routes = {
    'GET /api/sec/me': (req, u) => {
      needOperator(u);
      if (seen) seen.set(u.id, Date.now());
      return { id: u.id, name: u.name, developer: isDeveloper(u), now: Date.now() };
    },

    // the realtime cyber-security view of the server and of TWO STATE
    'GET /api/sec/status': (req, u) => {
      needOperator(u);
      if (seen) seen.set(u.id, Date.now());
      return {
        now: Date.now(),
        emergency: emergency.info(),
        shield: shield.snapshot(),
        health: health(),
        operators: operatorsNow(),
        // the most recent security and emergency log lines, for the panel
        // (the full tamper check is GET /api/sec/verify, so it never waits)
        security: opsLog.list({ kind: 'security', limit: 12 }),
        emergencyLog: opsLog.list({ kind: 'emergency', limit: 12 })
      };
    },

    // the operators' log, the same the operator site shows (read-only here)
    'GET /api/sec/log': (req, u) => {
      needOperator(u);
      const before = Number(req.query.get('before')) || 0;
      return { entries: opsLog.list({ before, find: req.query.get('q') || '', kind: req.query.get('kind') || '' }), counts: before ? null : opsLog.counts(), now: Date.now() };
    },

    // the log's integrity (the tamper check), asked on its own so it never
    // slows the status panel
    'GET /api/sec/verify': async (req, u) => {
      needOperator(u);
      return opsLog.verify();
    },

    // the sealed channel: the operators reaching one another from the base
    'GET /api/sec/messages': (req, u) => {
      needOperator(u);
      if (seen) seen.set(u.id, Date.now());
      const after = Number(req.query.get('after') || 0);
      const rows = after > 0
        ? q('SELECT * FROM sec_messages WHERE id > ? ORDER BY id LIMIT ?').all(after, PAGE)
        : q('SELECT * FROM sec_messages ORDER BY id DESC LIMIT ?').all(PAGE).reverse();
      return { messages: rows.map(channelMessage), now: Date.now() };
    },
    'POST /api/sec/messages': async (req, u) => {
      needOperator(u);
      const body = await req.json(16 * 1024);
      const text = String(body.text ?? '').replace(/\r\n?/g, '\n').trim();
      if (!text) throw new ApiError(400, 'empty', 'メッセージを入力してください');
      if (Array.from(text).length > TEXT_MAX) throw new ApiError(400, 'too_long', `メッセージは${TEXT_MAX}文字までです`);
      const r = q('INSERT INTO sec_messages (from_id, from_name, body, created_at) VALUES (?, ?, ?, ?)').run(u.id, u.name, sealText(KEY, text), Date.now());
      // not the message itself (it is sealed): only that one was sent
      opsLog.add({ actor: u, action: 'sec_message', req, summary: `${u.name}がセキュリティ基地のチャンネルにメッセージ（暗号化保存）`, detail: { id: Number(r.lastInsertRowid), chars: Array.from(text).length } });
      if (seen) seen.set(u.id, Date.now());
      return { message: channelMessage(q('SELECT * FROM sec_messages WHERE id = ?').get(Number(r.lastInsertRowid))) };
    },

    // the lockdown: raised or lifted by hand from the base (any operator, any
    // time). This is the base's one power; nothing else operational is here.
    'POST /api/sec/lockdown': async (req, u) => {
      needOperator(u);
      const body = await req.json();
      if (emergency.locked()) return { locked: true, emergency: emergency.info() };
      emergency.lockdownByOperator(u, req, body.reason);
      return { locked: true, emergency: emergency.info() };
    },
    'POST /api/sec/release': async (req, u) => {
      needOperator(u);
      if (!emergency.locked()) return { locked: false, emergency: emergency.info() };
      emergency.releaseByOperator(u, req);
      return { locked: false, emergency: emergency.info() };
    }
  };

  return { routes };
}
