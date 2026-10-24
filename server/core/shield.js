// The security shield: the first thing every API request meets. It turns away
// the traffic a game never sends — path traversal, SQL/script/template
// injection, scanner tools, probes for other software, oversized or malformed
// requests — and it watches each address, giving it a threat score that goes
// up with every such attempt, every burst far faster than a person could tap,
// and every failed login, password or developer-code guess. An address (or an
// account, or a device) over the line is blocked for a while, longer each time
// it comes back. Blocks are kept in the database, so a restart does not forget
// them. Nothing here is written to the database per request: the scoring is in
// memory, only placing or lifting a block touches the database and the log.
//
// It sits in front of the two defenses that were already here — the per-route
// rate limits (server/core/ratelimit.js) and the emergency stop that halts the
// whole server under a flood (server/core/emergency.js). When a great many
// different addresses attack at once, or someone hammers the keys to the
// server (the admin token, the developer code) far past their own limits, the
// shield judges the perimeter breached and calls for the lockdown — the final
// measure — through `onBreach`.
import { ApiError } from './errors.js';

const MINUTES = 15;
const KEYS_MAX = 20000;      // addresses remembered at once (an attacker rotates them)
const SCORE_HALFLIFE_MS = 10 * 60000;
// what each kind of attempt adds to an address's score
const POINTS = { attack: 10, probe: 6, badMethod: 2, oversize: 4, flood: 5, authFail: 2, critical: 6, notFound: 1 };
// at or above this an address is blocked; an outright attack signature
// (injection, a scanner tool) blocks at once, whatever the score. Set so that
// many players behind one carrier address are never mistaken for an attacker,
// while a brute-force run crosses it within a minute or two.
const BLOCK_SCORE = 30;
const BLOCK_MS = 10 * 60000; // the first block; it doubles each time (capped)
const BLOCK_STEP_MAX = 10;   // 10 min << 10 ≈ 7 days at most
const CRITICAL_BAN_MS = 6 * 3600000;
// generic answers: an attacker learns nothing from them
const BLOCKED = { status: 429, code: 'blocked', message: 'アクセスが制限されています。しばらく待ってからお試しください' };
const FORBIDDEN = { status: 403, code: 'forbidden', message: 'このリクエストは受け付けられません' };

// Paths and queries a legitimate client never sends. High-signal only, so an
// ordinary search or a Japanese username is never mistaken for an attack.
const ATTACK = [
  /\.\.(?:\/|\\|%2f|%5c|%252e)/i,         // path traversal
  /%2e%2e/i,
  /\x00|%00/i,                            // null byte
  /\/etc\/passwd|\/bin\/(?:sh|bash)|\/proc\/self/i,
  /<script|<\/script|javascript:|onerror\s*=|onload\s*=/i,     // XSS
  /union\s+select|select\s.+\sfrom\s|insert\s+into\s|drop\s+table|;\s*shutdown|information_schema|sleep\(\d|benchmark\(|pg_sleep/i, // SQLi
  /\$where|\$ne\b|\$gt\b|\$regex|\{\s*"\$/i,                    // NoSQL injection
  /\$\{jndi:|\$\{env:|\$\{sys:/i,                               // JNDI / template
  /\{\{.*\}\}|<%.*%>|#\{.*\}/,                                  // template injection
  /\b(?:wget|curl)\s+http|\|\s*(?:sh|bash)\b|%0d|%0a|\bchmod\s/i, // command injection / CRLF
  /\beval\(|base64_decode\(|system\(|exec\(|passthru\(/i
];
// requests probing for other software (should never appear under /api/)
const PROBE = /(?:^|\/)(?:wp-(?:admin|login|content|includes)|xmlrpc\.php|phpmyadmin|\.env(?:\.|$)|\.git(?:\/|$)|\.aws|\.ssh|id_rsa|config\.(?:php|json|ya?ml)|actuator|vendor\/phpunit|\.well-known\/(?!acme)|cgi-bin|boaform|hnap1|solr\/|struts|jenkins|\.svn)/i;
// the tools attackers scan with (an ordinary browser or the app never matches)
const SCANNER = /sqlmap|nikto|nmap|masscan|zgrab|nessus|acunetix|dirbuster|gobuster|wpscan|hydra|fimap|havij|netsparker|libwww-perl|python-requests\/|curl\/[0-9]|go-http-client|semrush|censys|httrack/i;
const METHODS = new Set(['GET', 'HEAD', 'POST']);
// loopback, private, link-local and carrier-grade NAT: the proxy, health
// checks and the local machine — infrastructure, never a client to block (the
// real client's address arrives through cf-connecting-ip / X-Forwarded-For).
const INTERNAL = /^(?:::ffff:)?(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)|^(?:::1|f[cd][0-9a-f]{2}:|fe80:)|^-?$/i;
const isExempt = (ip) => INTERNAL.test(String(ip || ''));

const minuteOf = (t) => Math.floor(t / 60000);
const blankMinute = (m) => ({ minute: m, requests: 0, attacks: 0, probes: 0, floods: 0, authFails: 0, blocked: 0 });

// config: shield 'off' turns it off; shieldConfig overrides the numbers above.
// opsLog: notable events (blocks, breach) go to the セキュリティ log, never one
// per request. onBreach({reason, detail}): the perimeter looks breached — the
// controller may lock the server down. clock: the time (tests move it).
// bulk(req): requests that come many a second by design (a vault's pieces,
// each under its own per-account limit, from a signed-in operator): checked
// like any other, but each counts a fifth against the address's volumetric
// ceiling (a flood of them is still a flood).
export function createShield({ q, config, opsLog, onBreach = () => {}, clock = Date.now, bulk = () => false }) {
  const on = config.shield !== 'off';
  const C = {
    blockScore: BLOCK_SCORE, blockMs: BLOCK_MS, perIpPerMinute: 1500,
    breachAttackers: 8, breachWindowMs: 3 * 60000, breachCritical: 40, breachCriticalWindowMs: 5 * 60000,
    ...(config.shieldConfig || {})
  };

  // active blocks, in memory (loaded once; the database is the lasting copy)
  const blocks = new Map();
  const ips = new Map();            // ip -> { score, at, hits, firstAt, flags:Set }
  const history = [];               // the last MINUTES minutes of counters
  let cur = blankMinute(minuteOf(clock()));
  const totals = { requests: 0, allowed: 0, attacks: 0, probes: 0, floods: 0, authFails: 0, blocked: 0, critical: 0 };
  const byCategory = {};
  const perMinuteIp = new Map();    // ip -> { minute, n } (the volumetric ceiling)
  const attackers = new Map();      // ip -> last attack time (distinct-attacker pressure)
  const criticals = [];             // times of key-guessing (admin token, developer code)
  let breachedAt = 0, savedBase = 0;

  function loadBlocks() {
    try {
      for (const r of q('SELECT * FROM security_blocks WHERE until = 0 OR until > ?').all(clock())) blocks.set(r.key, r);
    } catch { /* table not here yet (an old database mid-migration): from now on */ }
  }
  if (on) loadBlocks();

  function tickMinute(now) {
    const m = minuteOf(now);
    if (m === cur.minute) return;
    history.push(cur);
    while (history.length > MINUTES) history.shift();
    cur = blankMinute(m);
  }

  /* ---------------------------------------------------------------- scoring */

  function ipState(ip, now) {
    let s = ips.get(ip);
    if (!s) {
      if (ips.size >= KEYS_MAX) {
        // full (an attacker is rotating addresses): forget the lowest, decayed
        let worst = null, low = Infinity;
        for (const [k, v] of ips) { const d = decayed(v, now); if (d < low) { low = d; worst = k; } }
        if (worst) ips.delete(worst);
      }
      s = { score: 0, at: now, hits: 0, firstAt: now, flags: new Set() };
      ips.set(ip, s);
    }
    return s;
  }
  function decayed(s, now) {
    return s.score * Math.pow(0.5, (now - s.at) / SCORE_HALFLIFE_MS);
  }
  // add points to an address; returns its score now
  function score(ip, kind, now, flag) {
    const s = ipState(ip, now);
    s.score = decayed(s, now) + (POINTS[kind] || 1);
    s.at = now;
    s.hits++;
    if (flag) s.flags.add(flag);
    return s.score;
  }

  /* ---------------------------------------------------------------- blocks */

  function activeBlock(key, now) {
    const b = blocks.get(key);
    if (!b) return null;
    if (b.until && b.until <= now) { blocks.delete(key); return null; }
    return b;
  }
  function placeBlock(scope, target, reason, now, { manual = false, byId = 0, ms = 0 } = {}) {
    const key = `${scope}:${target}`;
    const existing = blocks.get(key) || (() => { try { return q('SELECT * FROM security_blocks WHERE key = ?').get(key); } catch { return null; } })();
    const step = existing ? Math.min(existing.step + 1, BLOCK_STEP_MAX) : 0;
    const dur = ms || Math.min(C.blockMs * 2 ** step, 7 * 86400000);
    const until = manual && ms === 0 ? 0 : now + dur;    // a hand block with no time given: until lifted
    const row = {
      key, scope, target, reason: String(reason || '').slice(0, 200),
      score: existing ? existing.score : 0, hits: existing ? existing.hits + 1 : 1,
      first_at: existing ? existing.first_at : now, at: now, until, step, by_id: byId, manual: manual ? 1 : 0
    };
    try {
      q(`INSERT INTO security_blocks (key, scope, target, reason, score, hits, first_at, at, until, step, by_id, manual)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET reason = excluded.reason, hits = security_blocks.hits + 1, at = excluded.at,
           until = excluded.until, step = excluded.step, by_id = excluded.by_id, manual = excluded.manual`)
        .run(row.key, row.scope, row.target, row.reason, row.score, row.hits, row.first_at, row.at, row.until, row.step, row.by_id, row.manual);
    } catch { /* database busy or gone: the memory copy still holds this run */ }
    blocks.set(key, row);
    cur.blocked++;
    totals.blocked++;
    return row;
  }
  // notable, so the operators can see it — at most one log line a minute per address
  const loggedBlock = new Map();
  function logBlock(row, detail) {
    const last = loggedBlock.get(row.key) || 0;
    if (row.at - last < 60000) return;
    loggedBlock.set(row.key, row.at);
    const names = { ip: 'アドレス', account: 'アカウント', fp: '端末' };
    opsLog.add({
      actorName: 'セキュリティ', action: row.manual ? 'shield_block' : 'shield_auto_block',
      summary: `${names[row.scope] || row.scope} ${row.target} を${row.manual ? '手動で' : '自動で'}ブロック（${row.reason}${row.until ? `・${Math.round((row.until - row.at) / 60000)}分` : '・解除するまで'}）`,
      detail: { ...row, ...detail }
    });
  }

  /* ---------------------------------------------------------------- breach */

  function pressure(now) {
    for (const [ip, at] of attackers) if (now - at > C.breachWindowMs) attackers.delete(ip);
    while (criticals.length && now - criticals[0] > C.breachCriticalWindowMs) criticals.shift();
    return { attackers: attackers.size, criticals: criticals.length };
  }
  function maybeBreach(now, why) {
    if (!on || now - breachedAt < 10 * 60000) return;
    const p = pressure(now);
    if (p.attackers < C.breachAttackers && p.criticals < C.breachCritical) return;
    breachedAt = now;
    onBreach({
      reason: p.attackers >= C.breachAttackers
        ? `多数のアドレス（${p.attackers}）からの同時攻撃を検知`
        : `サーバーの鍵（管理トークン・開発者コード）への総当たりを検知（${p.criticals}回）`,
      trigger: why, pressure: p, forensic: forensic(now)
    });
  }

  /* ---------------------------------------------------------------- inspect */

  // The gate. Returns a reason string when it lets the request through (for the
  // counters), or throws the generic refusal when it does not.
  function inspect(req) {
    const now = clock();
    tickMinute(now);
    cur.requests++;
    totals.requests++;
    if (!on) { totals.allowed++; return null; }
    const ip = req.ip || '-';
    // infrastructure (loopback, the proxy, health checks): never scored or blocked
    if (isExempt(ip)) { totals.allowed++; return null; }
    const path = String(req.path || '');

    // already blocked?
    const b = activeBlock(`ip:${ip}`, now);
    if (b) { cur.blocked++; throw refuse(BLOCKED); }

    // what does the request look like? (the query decoded, and "+" — an encoded
    // space — read as a space, so "union+select" is seen for what it is)
    let raw = path;
    try { raw += '?' + decodeURIComponent(String(req.query && req.query.toString ? req.query.toString() : '').replace(/\+/g, ' ')); } catch { raw += '?' + String(req.query || ''); }
    const ua = String((req.header && req.header('user-agent')) || '');

    if (SCANNER.test(ua)) return attack(ip, 'scanner', 'スキャナ／攻撃ツール', now, FORBIDDEN);
    if (PROBE.test(path)) return attack(ip, 'probe', '他ソフトへの探索', now, FORBIDDEN, 'probe');
    for (const re of ATTACK) if (re.test(raw)) return attack(ip, 'injection', '攻撃パターン（インジェクション等）', now, FORBIDDEN);
    if (!METHODS.has(req.method)) { score(ip, 'badMethod', now); countCat('badMethod'); return 'method'; }

    // volumetric: far more from one address than a person could ever tap
    let pm = perMinuteIp.get(ip);
    const m = minuteOf(now);
    if (!pm || pm.minute !== m) { pm = { minute: m, n: 0 }; perMinuteIp.set(ip, pm); if (perMinuteIp.size > KEYS_MAX) trimPerMinute(m); }
    pm.n += bulk(req) ? 0.2 : 1;
    if (pm.n > C.perIpPerMinute) {
      const sc = score(ip, 'flood', now, 'flood');
      cur.floods++; totals.floods++; countCat('flood');
      if (sc >= C.blockScore) logBlock(placeBlock('ip', ip, '短時間に多数のリクエスト（フラッド）', now), { perMinute: pm.n });
      throw refuse(BLOCKED);
    }
    totals.allowed++;
    return null;
  }

  function attack(ip, cat, reason, now, how, kind = 'attack') {
    cur.attacks++;
    totals.attacks++;
    countCat(cat);
    const sc = score(ip, kind, now, cat);
    attackers.set(ip, now);
    if (kind === 'probe') { cur.probes++; totals.probes++; }
    if (sc >= C.blockScore || kind === 'attack') logBlock(placeBlock('ip', ip, reason, now), { category: cat });
    maybeBreach(now, cat);
    throw refuse(how);
  }
  const refuse = (x) => new ApiError(x.status, x.code, x.message);
  function countCat(cat) { byCategory[cat] = (byCategory[cat] || 0) + 1; }
  function trimPerMinute(m) { for (const [k, v] of perMinuteIp) if (v.minute !== m) perMinuteIp.delete(k); }

  /* ------------------------------------------- after the answer (its status) */

  // what the outcome tells us: a failed login or guess scores the address; the
  // keys to the server being hammered is a critical signal towards a breach.
  function request({ path, ip, userId, status, code }) {
    if (!on || isExempt(ip)) return;
    const now = clock();
    const a = String(path || '');
    if (status === 401 && (a === '/api/login' || a === '/api/ops/login')) {
      score(ip || '-', 'authFail', now, 'authFail');
      cur.authFails++; totals.authFails++; countCat('authFail');
    }
    // the server's keys: wrong admin token, or wrong developer code
    if ((a === '/api/admin' && status === 403) || code === 'dev_code' || code === 'dev_code_locked') {
      criticals.push(now);
      totals.critical++;
      const sc = score(ip || '-', 'critical', now, 'keyGuess');
      countCat('keyGuess');
      if (sc >= C.blockScore) logBlock(placeBlock('ip', ip || '-', 'サーバーの鍵への総当たり', now, { ms: CRITICAL_BAN_MS }));
      maybeBreach(now, 'keyGuess');
    }
    // a blocked account also follows the address it comes from
    if (userId && status === 403 && code === 'banned') score(ip || '-', 'authFail', now);
  }

  /* ---------------------------------------------------------------- views */

  function topIps(now, n = 20) {
    return [...ips].map(([ip, s]) => ({ ip, score: Math.round(decayed(s, now)), hits: s.hits, flags: [...s.flags], firstAt: s.firstAt, at: s.at }))
      .filter((x) => x.score > 0 || x.flags.length)
      .sort((a, b) => b.score - a.score).slice(0, n);
  }
  function blockList(now = clock()) {
    const out = [];
    for (const [, b] of blocks) if (!b.until || b.until > now) out.push({ ...b, manual: !!b.manual });
    return out.sort((a, b) => b.at - a.at);
  }
  function forensic(now = clock()) {
    const p = pressure(now);
    return {
      pressure: p, totals: { ...totals }, byCategory: { ...byCategory },
      minutes: history.slice(-MINUTES).concat(cur).map((x) => ({ ...x, at: new Date(x.minute * 60000).toISOString() })),
      topAttackers: topIps(now, 30), blocks: blockList(now).slice(0, 100)
    };
  }
  // the realtime security view (the operator site's セキュリティ tab and /sec/)
  function snapshot(now = clock()) {
    const p = pressure(now);
    const recent = history.slice(-5).concat(cur);
    const sum = (f) => recent.reduce((n, x) => n + x[f], 0);
    return {
      on, now,
      totals: { ...totals }, byCategory: { ...byCategory },
      last5m: { requests: sum('requests'), attacks: sum('attacks'), probes: sum('probes'), floods: sum('floods'), authFails: sum('authFails'), blocked: sum('blocked') },
      minute: { ...cur },
      history: history.slice(-MINUTES).concat(cur).map((x) => [x.minute, x.requests, x.attacks, x.floods, x.authFails]),
      pressure: { ...p, breachAt: C.breachAttackers, criticalAt: C.breachCritical, windowMs: C.breachWindowMs },
      blocks: blockList(now), topAttackers: topIps(now, 20),
      thresholds: { perIpPerMinute: C.perIpPerMinute, blockScore: C.blockScore }
    };
  }

  /* ----- operators acting on attacks that did not reach the lockdown ----- */

  function block(scope, target, reason, by, req) {
    if (!['ip', 'account', 'fp'].includes(scope)) throw new ApiError(400, 'bad_scope', '対象の種類が正しくありません');
    const t = String(target || '').trim().slice(0, 120);
    if (!t) throw new ApiError(400, 'bad_target', '対象を入力してください');
    const row = placeBlock(scope, t, reason ? String(reason).slice(0, 200) : '運営が手動でブロック', clock(), { manual: true, byId: by ? by.id : 0 });
    logBlock(row, { by: by ? { id: by.id, name: by.name } : null });
    return row;
  }
  function unblock(key, by, req) {
    const row = blocks.get(key) || (() => { try { return q('SELECT * FROM security_blocks WHERE key = ?').get(String(key)); } catch { return null; } })();
    blocks.delete(key);
    try { q('DELETE FROM security_blocks WHERE key = ?').run(String(key)); } catch { /* gone */ }
    if (row) opsLog.add({ actor: by, action: 'shield_unblock', req, summary: `${row.scope}:${row.target} のブロックを解除`, detail: { key, was: { reason: row.reason, until: row.until } } });
    return !!row;
  }
  // whether a known account or device is blocked (checked once the user is known)
  function accountBlocked(userId) { return !!activeBlock(`account:${userId}`, clock()); }

  return {
    on,
    inspect, request, snapshot, forensic, blockList, block, unblock, accountBlocked,
    // how many addresses attack and how hard the keys are hammered right now, and
    // where that becomes a breach (the operators' screen view stops well before)
    threat: (now = clock()) => ({ ...pressure(now), breachAt: C.breachAttackers, criticalAt: C.breachCritical }),
    // old blocks and decayed addresses go (from the housekeeping)
    prune() {
      const now = clock();
      try { q('DELETE FROM security_blocks WHERE until > 0 AND until <= ? AND manual = 0').run(now); } catch { /* ignore */ }
      for (const [k, b] of blocks) if (b.until && b.until <= now) blocks.delete(k);
      for (const [ip, s] of ips) if (decayed(s, now) < 0.5 && now - s.at > SCORE_HALFLIFE_MS) ips.delete(ip);
      const m = minuteOf(now);
      for (const [k, v] of perMinuteIp) if (v.minute !== m) perMinuteIp.delete(k);
      if (now - savedBase > 0) savedBase = now;
    }
  };
}
