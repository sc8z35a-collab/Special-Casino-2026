// The emergency stop and the lockdown, one controller: the server's many
// emergency systems, merged. The stop is the first level — outside the
// developer's vault, the server counts each minute what it answers (requests
// let through: a flood the limits turn away does not count), the bytes it
// sends, the live messages it gets and how much its database grows, for the
// whole game and for the operator site on its own, against what is usual for
// it (an average that follows the last day or so). When a minute is far above
// that (10 times, and above a floor, so a quiet server's small burst does not
// count) and the next one is too, it writes all it knows to the 緊急 log and
// stops: every request gets the maintenance notice, the live connections
// close, and only the developer comes in, sees why, and starts it again with
// the developer code.
//
// The lockdown is the final measure, for when the defences have been
// breached. The security shield (server/core/shield.js) calls for it when a
// great many addresses attack at once or the server's keys are hammered; an
// operator can also raise it by hand. In a lockdown EVERYONE is shut out —
// players (「緊急メンテナンス」), operators and the developer alike — and only
// the security base (/sec/) stays reachable, to read the logs, watch the
// server and reach the operators. The server writes everything it could learn
// about the attack to the 緊急 log, checks the operators' log has not been
// tampered with, protects what it can (an encrypted backup if there is a key,
// no more reads or writes of anyone's data) and cuts off outbound
// communication. It lifts itself after a month; an operator can lift it by
// hand at any time.
import { ApiError } from './errors.js';

const MINUTES = 15;
const RUN = 2;
const FACTOR = 10;
// a half-day half-life, a minute at a time
const ALPHA = 1 / 720;
const GRACE_MS = 30 * 60000;
const LOCKDOWN_MS = 30 * 86400000;   // a month, then it lifts itself
const TOP = 15;
const KEYS_MAX = 5000;
const MB = 1048576;
// per minute: the game, and the operator site on its own
export const FLOORS = { requests: 20000, bytes: 500 * MB, wsIn: 30000, dbGrowth: 30 * MB, opsRequests: 3000, opsBytes: 150 * MB };
const NAMES = {
  requests: 'リクエスト', bytes: '送信量', wsIn: 'ライブ通信（受信）', dbGrowth: 'データベースの増加', opsRequests: '運営サイトのリクエスト', opsBytes: '運営サイトの送信量'
};
const UNIT = { bytes: 'MB', dbGrowth: 'MB', opsBytes: 'MB' };

const minuteOf = (t) => Math.floor(t / 60000);
const blank = (m) => ({ minute: m, requests: 0, bytes: 0, wsIn: 0, dbGrowth: 0, opsRequests: 0, opsBytes: 0, rejected: 0, vaultDb: 0, ips: new Map(), users: new Map(), routes: new Map() });
function bump(map, key) {
  if (map.has(key)) map.set(key, map.get(key) + 1);
  else if (map.size < KEYS_MAX) map.set(key, 1);
}
const top = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([k, n]) => ({ key: k, n }));
const show = (k, v) => (UNIT[k] ? `${(v / MB).toFixed(1)}MB` : Math.round(v).toLocaleString('en-US'));

// host: { dbBytes() -> number | null, stop() (close the live connections) };
// shield: server/core/shield.js (its forensic report goes into a lockdown);
// verifyLog(): the operators' log's integrity (checked on a lockdown);
// protect(reason): best-effort, keep the important data safe (an encrypted
// backup); clock: the time (tests move it).
export function createEmergency({ q, config, opsLog, host = {}, devCode, isDeveloper, getUser, shield = null, verifyLog = null, protect = null, defer = (p) => p, clock = Date.now }) {
  const floors = { ...FLOORS, ...(config.emergencyFloors || {}) };
  const on = config.emergency !== 'off';
  const read = (key, fallback) => {
    try { const r = q('SELECT value FROM meta WHERE key = ?').get(key); return r ? JSON.parse(r.value) : fallback; } catch { return fallback; }
  };
  const write = (key, value) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  let state = read('emergency', { stopped: false });
  const base = { requests: 0, bytes: 0, wsIn: 0, dbGrowth: 0, opsRequests: 0, opsBytes: 0, minutes: 0, ...read('emergency_base', {}) };
  let cur = blank(minuteOf(clock()));
  const history = [];
  let run = 0, lastDb = null, graceUntil = state.releasedAt ? state.releasedAt + GRACE_MS : 0, savedAt = 0;

  const isLocked = () => !!state.stopped && state.level === 'lockdown';

  // a minute is over: is it far above the usual?
  function close(now) {
    const m = cur;
    const db = host.dbBytes ? host.dbBytes() : null;
    if (db !== null && lastDb !== null) m.dbGrowth = Math.max(0, db - lastDb - m.vaultDb);
    if (db !== null) lastDb = db;
    history.push(m);
    if (history.length > MINUTES) history.shift();
    const over = Object.keys(floors).filter((k) => m[k] > floors[k] && m[k] > FACTOR * base[k]);
    if (over.length) run++;
    else {
      run = 0;
      // (the usual follows the quiet minutes only)
      for (const k of Object.keys(floors)) base[k] += ALPHA * (m[k] - base[k]);
      base.minutes++;
      if (now - savedAt > 10 * 60000) { savedAt = now; write('emergency_base', base); }
    }
    if (on && !state.stopped && run >= RUN && now > graceUntil) stop(over, m, now);
  }
  function tick(now = clock()) {
    // a lockdown lifts itself after a month
    if (isLocked() && state.releaseAt && now >= state.releaseAt) release({ auto: true, now });
    const mm = minuteOf(now);
    if (mm === cur.minute) return;
    close(now);
    cur = blank(mm);
  }

  function report(over, m) {
    const mins = history.slice(-MINUTES).map((x) => ({
      minute: new Date(x.minute * 60000).toISOString(), requests: x.requests, bytes: x.bytes, wsIn: x.wsIn, dbGrowth: x.dbGrowth,
      opsRequests: x.opsRequests, opsBytes: x.opsBytes, rejected: x.rejected
    }));
    const recent = history.slice(-3);
    const merge = (field) => {
      const all = new Map();
      for (const x of recent) for (const [k, n] of x[field]) all.set(k, (all.get(k) || 0) + n);
      return top(all);
    };
    const users = merge('users').map((x) => { const u = getUser(Number(x.key)); return { id: Number(x.key), name: u ? u.name : '?', n: x.n }; });
    return {
      over: over.map((k) => ({ what: NAMES[k], key: k, value: m[k], usual: Math.round(base[k]), floor: floors[k], times: base[k] ? +(m[k] / base[k]).toFixed(1) : null })),
      minutes: mins, usual: { ...base }, floors, factor: FACTOR, run: RUN,
      busiest: { addresses: merge('ips'), accounts: users, apis: merge('routes') },
      database: { bytes: lastDb }
    };
  }
  function stop(over, m, now, by = null, why = '') {
    const detail = by ? { manual: true, why, ...report([], cur) } : report(over, m);
    const what = by ? `開発者（${by.name}）が手動で緊急停止${why ? `：${why}` : ''}`
      : `異常な使用量を検知したため、サーバーを緊急停止（${over.map((k) => `${NAMES[k]} ${show(k, m[k])}/分・ふだんの${base[k] ? Math.round(m[k] / base[k]) + '倍' : '数十倍以上'}`).join('、')}）`;
    const entry = opsLog.add({ actor: by, actorName: 'システム', action: 'emergency_stop', summary: what, detail });
    state = { stopped: true, level: 'stop', at: now, by: by ? by.id : 0, reason: what, entry: entry.id };
    write('emergency', state);
    if (host.stop) host.stop();
  }

  // The lockdown — the final measure. `why`: 'breach' (the shield), 'manual'.
  function lockdown({ by = null, reason = '', why = 'manual', trigger = null, forensic = null, req = null, now = clock() } = {}) {
    if (isLocked()) return state;
    const integrity = verifyLog ? safe(() => verifyLog(), null) : null;
    const detail = {
      why, trigger, manual: why !== 'breach',
      reason: reason || (why === 'breach' ? '防御の突破を検知' : '手動でロックダウン'),
      usage: report([], cur),
      shield: forensic || (shield && shield.forensic ? safe(() => shield.forensic(now), null) : null),
      logIntegrity: integrity && typeof integrity.then === 'function' ? null : integrity,
      releaseAt: { ms: now + LOCKDOWN_MS, days: LOCKDOWN_MS / 86400000 }
    };
    const summary = why === 'breach'
      ? `防御の突破を検知し、ロックダウンを発動（${detail.reason}）。全ユーザーを締め出し、外部通信を遮断、ログ以外を停止`
      : `${by ? `${by.name}が` : ''}ロックダウンを手動で発動（${detail.reason}）`;
    const entry = opsLog.add({ actor: by, actorName: by ? undefined : 'システム', action: 'lockdown', summary, detail, req });
    state = { stopped: true, level: 'lockdown', at: now, by: by ? by.id : 0, reason: detail.reason, entry: entry.id, releaseAt: now + LOCKDOWN_MS, why };
    write('emergency', state);
    if (host.stop) host.stop();
    // protect what we can, without letting a failure hold up the lockdown
    if (protect) defer(Promise.resolve().then(() => protect('lockdown')).catch((e) => {
      opsLog.add({ actorName: 'システム', action: 'lockdown', summary: `ロックダウン時の保護処理に失敗：${String((e && e.message) || e).slice(0, 200)}`, detail: { step: 'protect' } });
    }));
    // the integrity check, if it was a promise, once it settles
    if (integrity && typeof integrity.then === 'function') {
      defer(integrity.then((r) => opsLog.add({ actorName: 'システム', action: 'lockdown', summary: `ロックダウン時のログ整合性チェック：${r && r.ok ? '異常なし' : '異常あり（' + ((r && r.reason) || '?') + '）'}`, detail: { logIntegrity: r } })).catch(() => {}));
    }
    return state;
  }
  const safe = (fn, fb) => { try { return fn(); } catch { return fb; } };

  function release({ by = null, req = null, auto = false, now = clock() } = {}) {
    if (!state.stopped) return { stopped: false };
    const was = state;
    state = { stopped: false, level: '', releasedAt: now, releasedBy: by ? by.id : 0 };
    graceUntil = now + GRACE_MS;
    run = 0;
    write('emergency', state);
    const kind = was.level === 'lockdown' ? 'ロックダウン' : '緊急停止';
    opsLog.add({
      actor: by, actorName: by ? undefined : 'システム', action: was.level === 'lockdown' ? 'lockdown_release' : 'emergency_release', req,
      summary: `${auto ? '自動で' : by ? `${by.name}が` : ''}${kind}を解除（${auto ? '発動から1か月' : by ? '手動' : ''}・停止していた時間 ${Math.round((now - (was.at || now)) / 60000)}分）`,
      detail: { level: was.level, stoppedAt: was.at, reason: was.reason, entry: was.entry, auto, graceMinutes: GRACE_MS / 60000 }
    });
    return { stopped: false };
  }

  // what everyone but the developer gets while stopped (the game shows its
  // maintenance notice; a lockdown says 緊急メンテナンス to all)
  const body = () => (isLocked()
    ? { error: { code: 'maintenance', message: 'ただいま緊急メンテナンスを行っています。復旧までしばらくお待ちください。', until: Date.now() + 30 * 60000, emergency: true, lockdown: true } }
    : { error: { code: 'maintenance', message: 'サーバーを緊急停止しています。復旧までお待ちください', until: Date.now() + 15 * 60000, emergency: true } });
  function needDeveloper(u) {
    if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', 'この操作は開発者だけができます');
  }

  const routes = {
    // the state, and (the developer) the 緊急 entries
    'GET /api/emergency': (req, u) => {
      needDeveloper(u);
      return { stopped: !!state.stopped, level: state.level || '', at: state.at || 0, reason: state.reason || '', releaseAt: state.releaseAt || 0, entries: opsLog.list({ kind: 'emergency', limit: 50 }), floors, factor: FACTOR, usual: { ...base }, now: Date.now() };
    },
    'POST /api/emergency/release': async (req, u) => {
      needDeveloper(u);
      const b = await req.json();
      await devCode.check(b.code, req, u);
      if (!state.stopped) return { stopped: false };
      return release({ by: u, req });
    },
    'POST /api/emergency/stop': async (req, u) => {
      needDeveloper(u);
      const b = await req.json();
      await devCode.check(b.code, req, u);
      if (state.stopped) return { stopped: true };
      const why = Array.from(String(b.reason ?? '').trim()).slice(0, 300).join('');
      stop([], cur, clock(), u, why);
      return { stopped: true };
    }
  };

  return {
    routes,
    stopped: () => !!state.stopped,
    locked: isLocked,
    level: () => state.level || '',
    // outbound calls (push, Stripe, Cloudflare, TURN) are cut during a lockdown
    outboundAllowed: () => !isLocked(),
    body,
    // what the operators see without the developer code (security base, ops tab)
    info: () => ({ stopped: !!state.stopped, level: state.level || '', at: state.at || 0, reason: state.reason || '', by: state.by || 0, releaseAt: state.releaseAt || 0, now: Date.now() }),
    // the shield decided the perimeter is breached
    breach: (info = {}) => lockdown({ why: 'breach', reason: info.reason || '', trigger: info.trigger || null, forensic: info.forensic || null }),
    // an operator raises or lifts the lockdown by hand (allowed at any time)
    lockdownByOperator: (by, req, reason) => lockdown({ by, req, why: 'manual', reason: Array.from(String(reason || '').trim()).slice(0, 300).join('') }),
    releaseByOperator: (by, req) => release({ by, req }),
    // one request answered (the vault's are not counted); `rejected`: turned away
    request({ path, ip, userId, status }) {
      tick();
      if (path.startsWith('/api/vault/')) return;
      if (status === 429 || status === 403) { cur.rejected++; return; }
      cur.requests++;
      if (path.startsWith('/api/ops/') || path.startsWith('/api/sec/')) cur.opsRequests++;
      bump(cur.ips, ip || '-');
      if (userId) bump(cur.users, String(userId));
      bump(cur.routes, path);
    },
    sent(bytes, path) {
      if (path.startsWith('/api/vault/')) return;
      cur.bytes += bytes;
      if (path.startsWith('/api/ops/') || path.startsWith('/api/sec/')) cur.opsBytes += bytes;
    },
    wsIn() { tick(); cur.wsIn++; },
    vaultDb(bytes) { cur.vaultDb += bytes; },
    tick
  };
}
