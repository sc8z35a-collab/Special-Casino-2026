// パスキー認証: every time the operator site (/ops/) or the security base
// (/sec/) is opened — and again after an hour on it — its people (the
// developer, an operator, a 閲覧者) type today's six digits, which a Discord
// bot gives only to those who hold the staff role there (server/core/discordbot.js).
//
// Today's passkey is not kept anywhere: it is HMAC(GATE_KEY, epoch, the day in
// Japan), six digits, new at 0:00 (JST). GATE_KEY is a secret of the host's
// settings and is not in the database, so a copy of the database tells nothing
// of it. Until it is set the whole thing is off (nobody is shut out).
//
// A wrong passkey is logged and keeps that account from trying again for an
// hour. It is asked after the password (and the authenticator's code) has been
// accepted, so only someone who has that much can lock an account.
//
// A right passkey opens a gate for one page: the page made a key pair of its
// own when it opened (kept nowhere, not even in the browser's storage, and it
// cannot be read out of it), sent the public half, and from then on signs every
// request to the operator site, the security base, the vault, the backups and
// the emergency routes with the other half. A page that is closed, reloaded or
// left has lost its key: the passkey is asked again. A gate is good for an
// hour at most; a stolen login token alone is good for nothing.
//
// epoch: one number in the database that only goes up. Raising it (the
// incident mode) ends every gate and changes every passkey at once.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ApiError } from './errors.js';
import { Limiter } from './ratelimit.js';
import { sha256, keyFrom } from './auth.js';
import { jstDay, agentOf } from './opsentry.js';

export const GATE_MS = 60 * 60000;
export const LOCK_MS = 60 * 60000;
// yesterday's passkey is still taken for a moment after midnight (a clock that is a little behind)
const GRACE_MS = 3 * 60000;
const SKEW_MS = 60000;
const NONCE_MS = 120000;
// the pages one login may have open at once
const GATES_MAX = 4;
// a gate that ran out is kept this long, to tell its page why it is asked again
const KEEP_MS = 10 * 60000;
const BREAKGLASS_PER_DAY = 3;
const GATE_RE = /^([0-9a-f]{32})\.(\d{13})\.([\w-]{16,32})\.([\w-]{80,100})$/;
const B64U43 = /^[\w-]{43}$/;
// what a gate guards: the same prefixes as the authenticator's code (server/core/api.js)
export const GATED = /^\/api\/(?:ops\/|sec\/|vault\/|backup(?:\/|$)|emergency(?:\/|$))/;

// today's six digits (`day`: 'YYYY-MM-DD' in Japan)
export function passkeyFor(gateKey, day, epoch = 0) {
  const mac = crypto.createHmac('sha256', keyFrom(gateKey, 'pk-passkey')).update(`pk|v1|${epoch}|${day}|*`).digest();
  return String(mac.readUInt32BE(0) % 1000000).padStart(6, '0');
}
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const hhmm = (ms) => {
  const d = new Date(ms + 9 * 3600000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

// ops: server/core/ops.js; mfa: server/core/opsmfa.js; entered(u, req, how): the
// day's entry in the ログインログ; revokeStreams(userId): the live connections of
// the operator site end
export function createPk({ q, tx, config, opsLog, ops, isDeveloper, mfa, entered = () => {}, revokeStreams = () => {}, clock = Date.now }) {
  const secretKey = String(config.gateKey || '');
  const active = () => secretKey.length >= 32;
  const subtle = () => globalThis.crypto.subtle;

  /* ---------------------------------------------------------------- epoch --- */
  function readEpoch() {
    const r = q("SELECT value FROM meta WHERE key = 'pk_epoch'").get();
    const n = r ? Number(r.value) : 0;
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  }
  let epochNow = readEpoch();

  /* ---------------------------------------------------------------- people --- */
  const staff = (u) => !!u && (isDeveloper(u) || ops.isOperator(u) || ops.isViewer(u));
  const roleOf = (u) => (isDeveloper(u) ? 'developer' : ops.isOperator(u) ? 'operator' : 'viewer');
  const roleName = (u) => ({ developer: '開発者', operator: '運営者', viewer: '閲覧者' })[roleOf(u)];
  const ipHash = (req) => sha256(`ip:${(req && req.ip) || '-'}`).slice(0, 16);

  /* ------------------------------------------------------------ passkeys --- */
  const today = (now = clock()) => ({ day: jstDay(now), code: active() ? passkeyFor(secretKey, jstDay(now), epochNow) : '' });
  // whether `code` is today's (or, for a moment after midnight, yesterday's): every one is worked out, whichever is right
  function accepts(code, now) {
    let ok = false;
    for (const day of new Set([jstDay(now), jstDay(now - GRACE_MS)])) ok = same(code, passkeyFor(secretKey, day, epochNow)) || ok;
    return ok;
  }

  /* ---------------------------------------------------------------- locks --- */
  const lockOf = (id) => q('SELECT until FROM pk_locks WHERE user_id = ?').get(id);
  const locked = (until) => new ApiError(429, 'pk_locked', `このアカウントは、${hhmm(until)}までパスキーを入力できません（間違えると1時間入力できなくなります）`, { until });
  // a wrong try: the account waits an hour (kept in the database), logged
  function wrongTry(req, u, now, via = '') {
    const until = now + LOCK_MS;
    q(`INSERT INTO pk_locks (user_id, until, at, ip_hash, wrong) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(user_id) DO UPDATE SET until = excluded.until, at = excluded.at, ip_hash = excluded.ip_hash, wrong = pk_locks.wrong + 1`)
      .run(u.id, until, now, ipHash(req));
    opsLog.add({
      actor: u, action: 'pk_fail', req,
      summary: `${u.name}（${roleName(u)}）のパスキーの入力が違っていた${via ? `（${via}）` : ''}。${hhmm(until)}まで入力できません`,
      detail: { role: roleOf(u), until, via: via || 'passkey' }
    });
    return new ApiError(403, 'pk_wrong', `パスキーが違います。このアカウントは${hhmm(until)}まで、パスキーを入力できません`, { until });
  }

  /* ----------------------------------------------------------------- gates --- */
  const gates = new Map();      // gid -> row
  const keys = new Map();       // gid -> the page's public key, ready to check with
  const nonces = new Map();     // `${gid}:${nonce}` -> when it can be forgotten
  const gateRow = (gid) => {
    let g = gates.get(gid);
    if (!g) { g = q('SELECT * FROM pk_gates WHERE gid = ?').get(gid); if (g) gates.set(gid, g); }
    return g || null;
  };
  const bad = (message = 'パスキーの確認に使う鍵の形が正しくありません。ページを読み込み直してください') => new ApiError(400, 'pk_key', message);
  // the public half of the page's key (a P-256 point in JWK form)
  async function importPub(jwk) {
    if (!jwk || typeof jwk !== 'object' || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !B64U43.test(String(jwk.x || '')) || !B64U43.test(String(jwk.y || ''))) throw bad();
    const clean = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
    try {
      const key = await subtle().importKey('jwk', clean, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      return { clean, key };
    } catch { throw bad(); }
  }
  function openGate(req, u, pub, now, how) {
    const gid = crypto.randomBytes(16).toString('hex');
    const until = now + GATE_MS;
    tx(() => {
      // (a login keeps four pages open at most: the oldest one goes)
      const mine = q('SELECT gid FROM pk_gates WHERE token_hash = ? ORDER BY opened_at').all(u.tokenHash);
      for (const g of mine.slice(0, Math.max(0, mine.length - GATES_MAX + 1))) { q('DELETE FROM pk_gates WHERE gid = ?').run(g.gid); gates.delete(g.gid); keys.delete(g.gid); }
      q('INSERT INTO pk_gates (gid, token_hash, user_id, pub, opened_at, until, epoch, ip_hash, agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(gid, u.tokenHash, u.id, JSON.stringify(pub.clean), now, until, epochNow, ipHash(req), agentOf(req.header('user-agent')).slice(0, 60));
    });
    keys.set(gid, pub.key);
    // (the first time today it counts as the day's ログイン: the developer's ログインログ)
    try { entered(u, req, how); } catch (e) { console.error('login log failed', e); }
    return { gid, until, day: jstDay(now), role: roleOf(u) };
  }
  function closeGate(gid) {
    q('DELETE FROM pk_gates WHERE gid = ?').run(gid);
    gates.delete(gid);
    keys.delete(gid);
  }
  const required = (message = '今日のパスキーを入力してください') => new ApiError(403, 'pk_required', message, { day: jstDay(clock()) });
  const expired = () => new ApiError(403, 'pk_expired', 'パスキーの有効時間（1時間）が過ぎました。もう一度入力してください', { day: jstDay(clock()) });

  // Whether a request carries a good signature from an open gate of this login.
  // The signed text is the method and the path (not the body or the query: they
  // are the route's to check; what is proved is that the page that opened the gate
  // sent it, just now, and only once).
  async function guard(req, u) {
    if (!active() || !staff(u)) return;
    const m = GATE_RE.exec(String(req.header('x-gate') || ''));
    if (!m) throw required();
    const [, gid, tsText, nonce, sig] = m;
    const g = gateRow(gid);
    const now = clock();
    if (!g || g.user_id !== u.id || g.token_hash !== u.tokenHash || g.epoch !== epochNow) throw required();
    if (g.until <= now) { closeGate(gid); revokeIfNone(u.id, now); throw expired(); }
    const ts = Number(tsText);
    if (Math.abs(now - ts) > SKEW_MS) throw new ApiError(403, 'pk_clock', 'この端末の時計がずれています。時刻を合わせてから、ページを読み込み直してください');
    const id = `${gid}:${nonce}`;
    if (nonces.has(id)) throw required('同じ要求がもう一度送られました。ページを読み込み直してください');
    nonces.set(id, now + NONCE_MS);
    let ok = false;
    try {
      let key = keys.get(gid);
      if (!key) { key = (await importPub(JSON.parse(g.pub))).key; keys.set(gid, key); }
      const text = `v1\n${req.method}\n${req.path}\n${tsText}\n${nonce}\n${gid}`;
      ok = await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(sig, 'base64url'), Buffer.from(text, 'utf8'));
    } catch { ok = false; }
    if (!ok) { nonces.delete(id); throw required('パスキーの確認ができませんでした。ページを読み込み直してください'); }
  }
  // a person with no gate open (any more): their live connections end
  function revokeIfNone(userId, now = clock()) {
    if (!q('SELECT 1 AS x FROM pk_gates WHERE user_id = ? AND until > ? LIMIT 1').get(userId, now)) revokeStreams(userId);
  }

  // once a minute at most: the live connections of those whose gates ran out
  // end, and what is no longer needed is forgotten
  let swept = 0;
  function sweep(now = clock()) {
    if (now - swept < 60000) return;
    swept = now;
    for (const r of q('SELECT DISTINCT user_id FROM pk_gates WHERE until <= ?').all(now)) revokeIfNone(r.user_id, now);
    q('DELETE FROM pk_gates WHERE until <= ?').run(now - KEEP_MS);
    q('DELETE FROM pk_gates WHERE token_hash NOT IN (SELECT token_hash FROM sessions)').run();
    q('DELETE FROM pk_locks WHERE until < ?').run(now - 86400000);
    for (const [id, t] of nonces) if (t <= now) nonces.delete(id);
    for (const [gid, g] of gates) if (g.until <= now - KEEP_MS) { gates.delete(gid); keys.delete(gid); }
  }

  /* ---------------------------------------------------------------- routes --- */
  const tries = new Limiter(30, 10);
  const needStaff = (u) => { if (!staff(u)) throw new ApiError(403, 'not_operator', 'この画面は運営者・閲覧者・開発者だけが使えます'); };

  const routes = {
    // what this login's pages have: for the page that has just opened
    'GET /api/pk/state': (req, u) => {
      needStaff(u);
      const now = clock();
      const lock = lockOf(u.id);
      return { active: active(), day: jstDay(now), role: roleOf(u), name: u.name, locked: lock && lock.until > now ? lock.until : 0 };
    },

    // today's passkey and the page's public key: the gate opens
    'POST /api/pk/open': async (req, u) => {
      if (!active()) throw new ApiError(409, 'pk_off', 'パスキー認証は設定されていません');
      needStaff(u);
      if (!tries.take(req.ip || '-')) throw new ApiError(429, 'rate_limited', '操作が速すぎます。少し待ってください');
      const body = await req.json(4096);
      const code = String(body.passkey ?? '').replace(/[\s-]/g, '');
      // (a number of another shape is a typing slip, not a try)
      if (!/^\d{6}$/.test(code)) throw new ApiError(400, 'pk_format', '6桁の数字を入力してください');
      const pub = await importPub(body.pub);
      const now = clock();
      const lock = lockOf(u.id);
      if (lock && lock.until > now) throw locked(lock.until);
      if (!accepts(code, now)) throw wrongTry(req, u, now);
      return openGate(req, u, pub, now, 'passkey');
    },

    // this page is done (or the login is): its gate closes
    'POST /api/pk/close': async (req, u) => {
      await req.json(1024);
      const mine = q('SELECT gid, user_id FROM pk_gates WHERE token_hash = ?').all(u.tokenHash);
      for (const g of mine) closeGate(g.gid);
      revokeIfNone(u.id);
      return { closed: mine.length };
    },

    // Discord is out of reach: the developer alone, with the authenticator's
    // code they must have set up, opens the gate (three times a day at most,
    // and every one is logged and told on Discord)
    'POST /api/pk/breakglass': async (req, u) => {
      if (!active()) throw new ApiError(409, 'pk_off', 'パスキー認証は設定されていません');
      if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', 'この操作は開発者だけができます');
      const body = await req.json(4096);
      if (!mfa.status(u).mode) throw new ApiError(409, 'mfa_unset', '非常口を使うには、先に認証アプリ（追加認証）を設定してください');
      const pub = await importPub(body.pub);
      const now = clock();
      const lock = lockOf(u.id);
      if (lock && lock.until > now) throw locked(lock.until);
      const used = q("SELECT COUNT(*) AS n FROM ops_log WHERE action = 'pk_breakglass' AND actor_id = ? AND at > ?").get(u.id, now - 86400000).n;
      if (used >= BREAKGLASS_PER_DAY) throw new ApiError(429, 'pk_breakglass_limit', '非常口は1日3回までです');
      try {
        await mfa.verify(u, body);
      } catch (e) {
        // (nothing given yet is not a try; a wrong code is one)
        if (e.code === 'mfa_required') throw e;
        throw wrongTry(req, u, now, '非常口');
      }
      const gate = openGate(req, u, pub, now, 'breakglass');
      opsLog.add({ actor: u, action: 'pk_breakglass', req, summary: `${u.name}が非常口（認証アプリ）でパスキー認証を開いた`, detail: { role: 'developer' } });
      return gate;
    }
  };

  return {
    routes, guard, sweep, active,
    epoch: () => epochNow,
    today,
    // incident mode: every gate ends and every passkey changes (the numbers only go up)
    bump() {
      epochNow += 1;
      q("INSERT INTO meta (key, value) VALUES ('pk_epoch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(epochNow));
      const users = q('SELECT DISTINCT user_id FROM pk_gates').all();
      q('DELETE FROM pk_gates').run();
      gates.clear(); keys.clear(); nonces.clear();
      for (const r of users) revokeStreams(r.user_id);
      return epochNow;
    },
    // an account's gates end (its rights taken away, its password changed)
    closeFor(userId) {
      for (const g of q('SELECT gid FROM pk_gates WHERE user_id = ?').all(userId)) closeGate(g.gid);
      revokeStreams(userId);
    },
    lockOf: (id) => lockOf(id),
    // the developer lets an account try again before its hour is up
    unlock(userId) { return Number(q('DELETE FROM pk_locks WHERE user_id = ?').run(userId).changes) > 0; },
    staff
  };
}
