// The operator site's login (POST /api/ops/login): a name and password like
// the game's, but only operators get in (and 閲覧者, with a session that can
// only look: scope 'view').
//
// Waits after wrong tries, all kept in the database (a restart keeps them) and counted by the
// server alone: the page only shows what the server says is left (POST /api/ops/login-wait), so
// reloading it, or opening it somewhere else, does not make a wait go away.
//   - the ACCOUNT (the name typed, whether or not it exists): two wrong tries in a row, from
//     anywhere, and that name waits 5 minutes; two more after that, 10; then 20, 40, an hour at
//     most. A stranger can start this wait, so a browser the account has really been logged in
//     with (ops_devices, 90 days) is not held by it: the owner is not shut out by someone guessing.
//   - the BROWSER on one address (the operator site keeps an id of its own): the same two tries,
//     5 minutes, then doubling. This is what holds a known browser that gets it wrong itself.
//   - the ADDRESS: ten in a row from one address make the whole address wait the same way (a new
//     browser id does not get round it, and someone else on the same network does not shut an
//     operator out with two).
// A login that works starts the account and the browser over, and a day with no wrong try starts it
// all over. A password too easy for staff (short, digits only) works too, and the site is told to
// ask for a better one. One from the operator site itself (`enter`) is also that day's ログイン in
// the ログインログ (server/core/opsentry.js); security HOME's is not.
//
// Every wrong try (and every try during a wait) is written to the operators' log, with what the
// request shows of where it came from and what the page reported of the device (server/core/
// reqinfo.js): never the password. So that a flood of wrong tries cannot fill a log that only
// grows, it takes only so many an hour (from one address, and in all): past that, one line says
// so, the rest are only counted, and the count goes into the first line of the next hour.
import { ApiError } from './errors.js';
import { sha256, hashPassword, verifyPassword, staffPasswordWeakness, nameKey, keyFrom } from './auth.js';
import { agentOf } from './opsentry.js';
import { requestProfile, cleanClient } from './reqinfo.js';

const ACCOUNT_TRIES = 2;
const DEVICE_TRIES = 2;
const ADDRESS_TRIES = 10;
const FIRST_MS = 5 * 60000;
// (5 minutes × 2^12: about two weeks at most; an account's wait, which a stranger can start, an hour)
const MAX_STEP = 12;
const ACCOUNT_MAX_MS = 60 * 60000;
const FORGET_MS = 86400000;
const KNOWN_MS = 90 * 86400000;
const KNOWN_PER_ACCOUNT = 20;
const NAME_MAX = 60;
// what the log takes of the wrong tries: from one address and in all, in an hour
const LOG_PER_ADDRESS = 8;
const LOG_IN_ALL = 60;
const LOG_WINDOW_MS = 3600000;

const REASON = {
  bad_password: 'パスワードが違いました', no_account: 'その名前のアカウントはありません', not_staff: '運営でも閲覧者でもないアカウントです',
  mfa_invalid: '追加認証のコードが違いました', locked: '入力制限中に入ろうとしました'
};
const ROLE = { developer: '開発者', operator: '運営者', viewer: '閲覧者', player: 'プレイヤー', none: '' };
const SCOPE_NAME = { account: 'このアカウント', device: 'このブラウザ', address: 'この接続' };

const cut = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const minutes = (ms) => Math.max(1, Math.ceil(ms / 60000));
const ipHash = (req) => sha256(String(req.ip || '-')).slice(0, 40);
// the operator site's own id for this browser ('' when it did not send a good one)
const deviceId = (req) => { const d = String(req.header('x-ops-device') || ''); return /^[A-Za-z0-9_-]{16,64}$/.test(d) ? d : ''; };
const deviceHash = (id) => sha256('opsdev:' + id).slice(0, 40);

// allow(u): may this operator come in now (while the server is stopped for
// an emergency, the developer only; stoppedBody() is what the rest get);
// entered(u, req, how): the day's entry in the ログインログ
export function createOpsLogin({
  q, findByName, isOperator, isViewer = () => false, isDeveloper = () => false, createSession, seenOn, rate, rateWait = rate, opsLog = null, secret = '',
  allow = () => true, stoppedBody = null, entered = () => {}, verifyMfa = async () => 0, clock = Date.now
}) {
  /* -------------------------------------------------------------- the waits --- */
  const rowOf = (key) => q('SELECT * FROM ops_locks WHERE key = ?').get(key);
  const put = (key, fails, step, until, at) => q(`INSERT INTO ops_locks (key, fails, step, until, at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, step = excluded.step, until = excluded.until, at = excluded.at`).run(key, fails, step, until, at);
  const fresh = (r, now) => !r || now - r.at > FORGET_MS;
  const stepMs = (step, cap) => Math.min(cap || Infinity, FIRST_MS * 2 ** Math.min(step, MAX_STEP));

  // the waits a try can meet, widest first: the address, this browser, the name typed (none for no name)
  function keysOf(req, nk) {
    const ip = ipHash(req), dev = deviceId(req);
    const keys = [{ scope: 'address', key: `ip:${ip}`, tries: ADDRESS_TRIES }, { scope: 'device', key: `dev:${ip}:${dev || '-'}`, tries: DEVICE_TRIES }];
    if (nk) keys.push({ scope: 'account', key: `acct:${nk}`, tries: ACCOUNT_TRIES, cap: ACCOUNT_MAX_MS });
    return keys;
  }
  // the wait this requester is under: the latest end among the waits that hold it (when two end together, the
  // narrower one is the one told: the account's, then the browser's, then the address's)
  function waitOf(keys, known, now) {
    let until = 0, scope = '';
    for (const k of keys) {
      // (a browser the account has been logged in with is not held by the account's wait: a stranger starts that one)
      if (k.scope === 'account' && known) continue;
      const r = rowOf(k.key);
      if (r && r.until > now && r.until >= until) { until = r.until; scope = k.scope; }
    }
    return { until, scope };
  }
  // a wrong try, counted against each wait; what each says now
  function strike(keys, now) {
    const out = {};
    for (const k of keys) {
      const r = rowOf(k.key), old = fresh(r, now);
      let fails = (old ? 0 : r.fails) + 1, step = old ? 0 : r.step, lock = old ? 0 : r.until, started = 0;
      if (fails >= k.tries) {
        started = stepMs(step, k.cap);
        lock = now + started;
        step++;
        fails = 0;
      }
      put(k.key, fails, step, lock, now);
      out[k.scope] = { fails, tries: k.tries, started, lock: lock > now ? lock : 0, next: stepMs(step, k.cap) };
    }
    return out;
  }
  const left = (w, now) => Math.max(0, w.until - now);
  const locked = (w, now) => new ApiError(429, 'ops_locked',
    `${w.scope === 'account' ? 'このアカウントは入力制限中です' : 'この接続からの入力が制限されています'}。${minutes(w.until - now)}分後にもう一度入力してください`,
    { until: w.until, left: left(w, now), scope: w.scope });

  /* -------------------------------------------------------- browsers known --- */
  function knownRow(nk, id, now) {
    if (!nk || !id) return null;
    const r = q('SELECT * FROM ops_devices WHERE name_key = ? AND dev = ?').get(nk, deviceHash(id));
    return r && now - r.at < KNOWN_MS ? r : null;
  }
  // (the accounts this browser has been logged in with: for the log, when it gets another one wrong)
  const knownFor = (id) => (id ? q('SELECT name_key FROM ops_devices WHERE dev = ? ORDER BY at DESC LIMIT 5').all(deviceHash(id)).map((r) => r.name_key) : []);
  function remember(u, req, now) {
    const id = deviceId(req);
    if (!id) return;
    q(`INSERT INTO ops_devices (name_key, dev, first_at, at, uses, ip_hash, agent) VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(name_key, dev) DO UPDATE SET at = excluded.at, uses = ops_devices.uses + 1, ip_hash = excluded.ip_hash, agent = excluded.agent`)
      .run(u.name_key, deviceHash(id), now, now, ipHash(req).slice(0, 16), agentOf(req.header('user-agent')).slice(0, 60));
    q('DELETE FROM ops_devices WHERE name_key = ? AND dev NOT IN (SELECT dev FROM ops_devices WHERE name_key = ? ORDER BY at DESC LIMIT ?)').run(u.name_key, u.name_key, KNOWN_PER_ACCOUNT);
  }

  /* ----------------------------------------------------------------- the log --- */
  // Room in the log for one more line (an hour's worth from one address, and in all): 'write'; or 'burst'
  // for the last line there is room for, which says that the rest are only counted; or '' (only counted).
  // `dropped`: what the hour before left out, for the first line of the next one.
  function room(req, now) {
    const rows = [{ key: `logw:ip:${ipHash(req)}`, cap: LOG_PER_ADDRESS }, { key: 'logw:all', cap: LOG_IN_ALL }].map((x) => {
      let r = rowOf(x.key);
      const dropped = r && r.until <= now ? r.step : 0;
      if (!r || r.until <= now) r = { fails: 0, step: 0, until: now + LOG_WINDOW_MS };
      return { ...x, r, dropped };
    });
    const open = rows.every((x) => x.r.fails < x.cap);
    const last = open && rows.some((x) => x.r.fails === x.cap - 1);
    for (const x of rows) {
      if (open) x.r.fails++; else x.r.step++;
      put(x.key, x.r.fails, x.r.step, x.r.until, now);
    }
    return { how: open ? (last ? 'burst' : 'write') : '', dropped: Math.max(...rows.map((x) => x.dropped)) };
  }
  const roleOf = (u) => (!u ? 'none' : isDeveloper(u) ? 'developer' : isOperator(u) ? 'operator' : isViewer(u) ? 'viewer' : 'player');
  // The name as the log shows it. An account's own name, as it is; a name that is nobody's only in part
  // (its first two letters, its length, and a tag the same name always gets): the log only grows and
  // cannot be cleaned, and now and then a password is typed where the name goes.
  const tagKey = keyFrom(secret || 'opslogin', 'login-name-tag');
  const tagOf = (typed) => sha256(`${tagKey.toString('hex')}:${nameKey(typed)}`).slice(0, 8);
  const nameShown = (c) => (c.user ? c.user.name : `（存在しない名前・先頭「${Array.from(cut(c.typed, NAME_MAX)).slice(0, 2).join('')}」・${Array.from(cut(c.typed, 200)).length}文字・#${tagOf(c.typed)}）`);

  // one wrong try (or one made during a wait) as a line of the log
  function report(req, body, c, now) {
    if (!opsLog) return;
    let slot;
    try { slot = room(req, now); } catch { return; }
    if (!slot.how) return;
    const net = requestProfile(req), edge = net.edge || {};
    const agent = agentOf(req.header('user-agent'));
    const where = [agent, edge.country].filter(Boolean).join('・');
    const role = roleOf(c.user);
    const label = nameShown(c);
    const who = `${c.user ? `「${label}」` : label}${ROLE[role] ? `（${ROLE[role]}）` : ''}`;
    const first = c.strike && (c.strike.account || c.strike.device);
    // (a wait that this try started: the account's first, then the browser's, then the address's)
    const began = c.strike ? ['account', 'device', 'address'].map((k) => [k, c.strike[k]]).filter(([, v]) => v && v.started)[0] : null;
    let action = 'login_fail', summary;
    if (slot.how === 'burst') {
      action = 'login_burst';
      summary = `ログイン失敗が多すぎます：この接続からの失敗は、1時間に${LOG_PER_ADDRESS - 1}件（全体で${LOG_IN_ALL - 1}件）までしか個別に書きません。このあとの失敗は数だけ数えます（次の1時間の最初の行に件数を書きます）`;
    } else if (began) {
      action = 'login_lock';
      summary = `${who}へのログインを${began[1].tries}回続けて間違えたため、${SCOPE_NAME[began[0]]}を${minutes(began[1].started)}分間ロックしました（${where || '端末不明'}）`;
    } else {
      const count = first ? `・${first.fails}/${first.tries}回目` : '';
      const wait = c.wait && c.wait.until ? `・あと${minutes(c.wait.until - now)}分` : '';
      summary = `ログイン失敗：${who}${REASON[c.reason]}${c.reason === 'locked' ? wait : count}（${where || '端末不明'}）`;
    }
    const login = {
      name: c.user ? c.user.name : label, reason: c.reason, account: { exists: !!c.user, role },
      tries: c.strike ? Object.fromEntries(Object.entries(c.strike).map(([k, v]) => [k, { fails: v.fails, of: v.tries, waitMs: v.started || 0 }])) : undefined,
      wait: c.wait && c.wait.until ? { scope: c.wait.scope, until: c.wait.until, ms: c.wait.until - now } : undefined,
      knownBrowser: c.known ? { firstAt: c.known.first_at, lastAt: c.known.at, uses: c.known.uses, agent: c.known.agent } : false,
      browserKnownFor: knownFor(deviceId(req)), agent, browserTag: deviceId(req) ? deviceHash(deviceId(req)).slice(0, 12) : '',
      net,
      // (what the page said of the device: it can be made up, so it is kept apart from what the connection shows)
      reported: cleanClient(body && body.client),
      droppedBefore: slot.dropped || undefined
    };
    try {
      opsLog.add({ actorName: '未ログイン', action, target: c.user && c.user.id ? c.user : null, summary, detail: { login }, req });
    } catch (e) { console.error('login log failed', e); }
  }

  // a stand-in password hash, so a name that does not exist takes as long to answer as one that does
  let stand = null;
  const standIn = () => (stand ||= hashPassword('a stand-in that is nobody\'s password'));

  return {
    routes: {
      'POST /api/ops/login': async (req) => {
        rate(req);
        const body = await req.json();
        const now = clock();
        const typed = String(body.name ?? '');
        const nk = nameKey(typed).slice(0, NAME_MAX);
        const id = deviceId(req);
        const known = knownRow(nk, id, now);
        const keys = keysOf(req, nk);
        const held = waitOf(keys, !!known, now);
        if (held.until) {
          report(req, body, { typed, user: findByName(typed), reason: 'locked', wait: held, known }, now);
          throw locked(held, now);
        }
        const u = findByName(typed);
        const password = String(body.password ?? '');
        const hasLogin = !!u && !u.npc && !!u.password_hash;
        const passwordOk = hasLogin ? await verifyPassword(password, u.password_hash) : (await verifyPassword(password, await standIn()), false);
        const ok = passwordOk && (isOperator(u) || isViewer(u));
        // a wrong try: counted against the waits, written to the log, and the answer is the same whatever was wrong
        const wrong = (reason, error) => {
          const s = strike(keys, now);
          const w = waitOf(keys, !!known, now);
          report(req, body, { typed, user: u, reason, strike: s, wait: w, known }, now);
          if (w.until) throw locked(w, now);
          if (error) throw error;
          // (how many more it takes to start a wait for this requester: the nearest of the waits that would hold it, the account's first)
          const near = ['account', 'device', 'address'].filter((k) => s[k] && !(k === 'account' && known)).map((k) => [k, s[k]]).sort((a, b) => (a[1].tries - a[1].fails) - (b[1].tries - b[1].fails))[0];
          throw new ApiError(401, 'bad_login', `名前かパスワードが違います（あと${near[1].tries - near[1].fails}回間違えると、${SCOPE_NAME[near[0]]}は${minutes(near[1].next)}分間入力できません）`);
        };
        if (!ok) wrong(!hasLogin ? (u ? 'not_staff' : 'no_account') : !passwordOk ? 'bad_password' : 'not_staff');
        let mfaVersion = 0;
        if (isOperator(u)) {
          try { mfaVersion = await verifyMfa(u, body); }
          catch (e) {
            if (e.code !== 'mfa_required') wrong('mfa_invalid', e);
            throw e;
          }
        }
        const fresh = findByName(typed);
        if (!fresh || fresh.id !== u.id || fresh.password_hash !== u.password_hash || !(isOperator(fresh) || isViewer(fresh))) wrong('bad_password');
        // (this browser and this account start over; the address's count does not, nor does it go up)
        for (const k of keys) if (k.scope !== 'address') q('DELETE FROM ops_locks WHERE key = ?').run(k.key);
        if (!allow(u)) {
          const b = stoppedBody ? stoppedBody().error : { code: 'maintenance', message: 'メンテナンス中です' };
          throw new ApiError(503, b.code, b.message, b);
        }
        remember(u, req, now);
        seenOn(u.id, req);
        if (body.enter === true) entered(u, req, 'password');
        const viewer = !isOperator(u);
        // (the password is in hand only here: its weakness, if any, goes with the session)
        return { token: createSession(u.id, viewer ? 'view' : '', mfaVersion, true, staffPasswordWeakness(body.password)), name: u.name, viewer };
      },

      // How long this requester must still wait to try the name given (none: 0), counted here, so a page
      // that is reloaded shows the same wait. The same answer whether or not the account exists. (A POST:
      // what is typed where the name goes is sometimes a password, and a URL is written down along the way.)
      'POST /api/ops/login-wait': async (req) => {
        rateWait(req);
        const body = await req.json();
        const now = clock();
        const nk = nameKey(cut(body.name, 200)).slice(0, NAME_MAX);
        const w = waitOf(keysOf(req, nk), !!knownRow(nk, deviceId(req), now), now);
        return { left: left(w, now), until: w.until || 0, scope: w.scope, now };
      }
    },
    // old waits go (from the housekeeping)
    prune() {
      const now = clock();
      q('DELETE FROM ops_locks WHERE at < ? AND until < ?').run(now - 2 * FORGET_MS, now);
      q('DELETE FROM ops_devices WHERE at < ?').run(now - KNOWN_MS);
    },
    // the waits cleared by hand (the admin command login-unlock): one name's, or all of them
    unlock(name = '') {
      const nk = nameKey(name).slice(0, NAME_MAX);
      return Number(nk
        ? q('DELETE FROM ops_locks WHERE key = ?').run(`acct:${nk}`).changes
        : q("DELETE FROM ops_locks WHERE key LIKE 'ip:%' OR key LIKE 'dev:%' OR key LIKE 'acct:%'").run().changes);
    }
  };
}
