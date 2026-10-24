// The operator site's login (POST /api/ops/login): a name and password like
// the game's, but only operators get in (and 閲覧者, with a session that can
// only look: scope 'view'), and two wrong tries in a row (a
// wrong name or password, or an account that is not an operator) make this
// browser wait 5 minutes; two more after that, 10 minutes; then 20, 40 …
// A login that works starts this browser over, and a day with no wrong try starts it all over.
// One from the operator site itself (`enter`) is also that day's ログイン in
// the ログインログ (server/core/opsentry.js); security HOME's is not.
// Ten in a row from one address make the whole address wait the same way
// (a new browser id does not get round it, and someone else on the same
// network does not shut an operator out with two). The waits are kept in
// the database (a restart keeps them) and, as asked, are not written to the log.
import { ApiError } from './errors.js';
import { sha256, verifyPassword } from './auth.js';

const TRIES = 2;
const TRIES_ADDRESS = 10;
const FIRST_MS = 5 * 60000;
// (5 minutes × 2^12: about two weeks at most)
const MAX_STEP = 12;
const FORGET_MS = 86400000;

// allow(u): may this operator come in now (while the server is stopped for
// an emergency, the developer only; stoppedBody() is what the rest get);
// entered(u, req, how): the day's entry in the ログインログ
export function createOpsLogin({ q, findByName, isOperator, isViewer = () => false, createSession, seenOn, rate, allow = () => true, stoppedBody = null, entered = () => {}, verifyMfa = async () => 0 }) {
  // this browser on this address (the operator site keeps an id of its own), and the address
  function keysOf(req) {
    const ip = sha256(String(req.ip || '-')).slice(0, 40);
    const d = String(req.header('x-ops-device') || '');
    return [{ key: `dev:${ip}:${/^[A-Za-z0-9_-]{16,64}$/.test(d) ? d : '-'}`, tries: TRIES }, { key: `ip:${ip}`, tries: TRIES_ADDRESS }];
  }
  const rowOf = (key) => q('SELECT * FROM ops_locks WHERE key = ?').get(key);
  const fresh = (r, now) => !r || now - r.at > FORGET_MS;
  function waitUntil(keys, now) {
    return keys.reduce((m, k) => { const r = rowOf(k.key); return r && r.until > now ? Math.max(m, r.until) : m; }, 0);
  }
  // a wrong try: the wait it starts (0: none yet), and how long this browser's next one would be
  function wrong(keys, now) {
    let until = 0, next = FIRST_MS;
    for (const { key: k, tries } of keys) {
      const r = rowOf(k), old = fresh(r, now);
      let fails = (old ? 0 : r.fails) + 1, step = old ? 0 : r.step, lock = old ? 0 : r.until;
      if (fails >= tries) {
        lock = now + FIRST_MS * 2 ** Math.min(step, MAX_STEP);
        step++;
        fails = 0;
      }
      q(`INSERT INTO ops_locks (key, fails, step, until, at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, step = excluded.step, until = excluded.until, at = excluded.at`).run(k, fails, step, lock, now);
      if (lock > now) until = Math.max(until, lock);
      if (tries === TRIES) next = FIRST_MS * 2 ** Math.min(step, MAX_STEP);
    }
    return { until, next };
  }
  const minutes = (ms) => Math.max(1, Math.ceil(ms / 60000));
  const locked = (until, now) => new ApiError(429, 'ops_locked', `入力制限中です。${minutes(until - now)}分後にもう一度入力してください`, { until });

  return {
    routes: {
      'POST /api/ops/login': async (req) => {
        rate(req);
        const body = await req.json();
        const keys = keysOf(req);
        const until = waitUntil(keys, Date.now());
        if (until) throw locked(until, Date.now());
        const u = findByName(String(body.name ?? ''));
        const ok = !!u && !u.npc && !!u.password_hash && await verifyPassword(String(body.password ?? ''), u.password_hash) && (isOperator(u) || isViewer(u));
        const now = Date.now();
        if (!ok) {
          const w = wrong(keys, now);
          if (w.until) throw locked(w.until, now);
          throw new ApiError(401, 'bad_login', `名前かパスワードが違います（あと1回間違えると${minutes(w.next)}分間入力できません）`);
        }
        let mfaVersion = 0;
        if (isOperator(u)) {
          try { mfaVersion = await verifyMfa(u, body); }
          catch (e) {
            if (e.code !== 'mfa_required') {
              const w = wrong(keys, now);
              if (w.until) throw locked(w.until, now);
            }
            throw e;
          }
        }
        // (this browser starts over; the address's count does not, nor does it go up)
        q('DELETE FROM ops_locks WHERE key = ?').run(keys[0].key);
        if (!allow(u)) {
          const b = stoppedBody ? stoppedBody().error : { code: 'maintenance', message: 'メンテナンス中です' };
          throw new ApiError(503, b.code, b.message, b);
        }
        seenOn(u.id, req);
        if (body.enter === true) entered(u, req, 'password');
        const viewer = !isOperator(u);
        return { token: createSession(u.id, viewer ? 'view' : '', mfaVersion), name: u.name, viewer };
      }
    },
    // old waits go (from the housekeeping)
    prune: () => q('DELETE FROM ops_locks WHERE at < ? AND until < ?').run(Date.now() - 30 * FORGET_MS, Date.now())
  };
}
