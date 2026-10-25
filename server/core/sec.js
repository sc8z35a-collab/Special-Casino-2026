// security HOME (/sec/): the operators' final safety base, apart from TWO STATE itself. It does nothing operational — no players, no
// money, no vault — it lets the operators see, in one look, how TWO STATE's server stands and what threatens the operators' site,
// read the same log the operator site shows, reach one another over a channel whose messages are sealed at rest, and raise or lift
// the lockdown. It keeps working during a lockdown, when everything else is shut: that is the point of it.
//
// Every route here goes through the secure channel (server/core/seccomm.js): a request that does not come sealed is turned away
// before the route runs, and what is answered is sealed.
//
// WHO MAY SEE WHAT is decided here, on the server, and nowhere else:
//   - PANELS lists every panel with the least a person must be. `GET /api/sec/me` tells a person only theirs, so a 閲覧者 is never
//     told that the channel or the lockdown exist, nor an operator that the developer's panels do.
//   - Each route asks for the same itself (ops.see / ops.need / developer()), whatever the page shows. The developer's routes
//     answer anyone else exactly as a route that does not exist does (404), so even their names tell nothing.
//   - A 閲覧者 reads the status, the threats, the posture and the log (the log without its requests and details); never the sealed
//     channel, never the lockdown. Their rights taken away, they are out at once.
// The tests call every route as each kind of person (server/test/sec.test.js) and hold this list to what they get.
import { ApiError } from './errors.js';
import { sealText, openText, keyFrom } from './auth.js';
import { transportOf } from './seccomm.js';

const PAGE = 200;
const TEXT_MAX = 4000;
const RANK = { viewer: 1, operator: 2, developer: 3 };
const HOUR = 3600000;

// role: the least a person must be to have it
export const PANELS = [
  { id: 'overview', name: '全体の状況', role: 'viewer' },
  { id: 'threats', name: '脅威情報', role: 'viewer' },
  { id: 'posture', name: '守りの状態', role: 'viewer' },
  { id: 'log', name: 'ログ', role: 'viewer' },
  { id: 'chat', name: '連絡チャンネル', role: 'operator' },
  { id: 'lockdown', name: 'ロックダウン', role: 'operator' },
  { id: 'dev-patrol', name: '自動点検', role: 'developer' },
  { id: 'dev-stele', name: '石碑', role: 'developer' },
  { id: 'dev-channels', name: 'セキュア通信の接続', role: 'developer' },
  { id: 'dev-access', name: '権限と認証', role: 'developer' }
];

// what the operators' log says of threats to the operator site: each a kind of event, how heavy it weighs, and what it is called
export const SIGNALS = [
  { id: 'login', name: 'ログインの失敗・制限', actions: ['login_fail', 'login_lock', 'login_burst'], weight: 2 },
  { id: 'passkey', name: 'パスキー・開発者コードの失敗', actions: ['pk_fail', 'dev_code_fail'], weight: 3 },
  { id: 'channel', name: 'セキュア通信・窓の不正な要求', actions: ['sec_channel_denied', 'sec_cdw_denied'], weight: 3 },
  { id: 'block', name: 'ブロック', actions: ['shield_auto_block', 'shield_block'], weight: 2 },
  { id: 'patrol', name: '自動点検の警告', actions: ['patrol_alert'], weight: 3 },
  { id: 'rights', name: '権限・名前の変化', actions: ['ops_grant', 'ops_revoke', 'viewer_grant', 'viewer_revoke', 'staff_name_reused'], weight: 2 },
  { id: 'pay', name: '支払いの異常', actions: ['pay_bad_signature', 'pay_unknown'], weight: 2 },
  { id: 'stop', name: '緊急停止・ロックダウン', actions: ['emergency_stop', 'lockdown'], weight: 3 }
];
const SIGNAL_ACTIONS = SIGNALS.flatMap((s) => s.actions);

const KEYS = {
  // [route key, the least a person must be]
  viewer: ['GET /api/sec/me', 'GET /api/sec/status', 'GET /api/sec/threats', 'GET /api/sec/posture', 'GET /api/sec/log', 'GET /api/sec/log/entries', 'GET /api/sec/verify', 'POST /api/sec/channel/close'],
  operator: ['GET /api/sec/messages', 'POST /api/sec/messages', 'POST /api/sec/lockdown', 'POST /api/sec/release'],
  developer: ['GET /api/sec/dev/patrol', 'POST /api/sec/dev/patrol/run', 'GET /api/sec/dev/stele', 'POST /api/sec/dev/stele/run', 'GET /api/sec/dev/channels', 'POST /api/sec/dev/channels/close', 'GET /api/sec/dev/access']
};
export const SEC_KEYS = { open: 'POST /api/sec/channel', ...KEYS };

// ops: server/core/ops.js; emergency, shield, opsLog: the security pieces; health(): the server's vital signs; lean(): the figures of
// the サーバー tab; seen: when each operator was last on a site (shared with the operator site); comm: the secure channel;
// facts: what the server can say of how it is set (see 'GET /api/sec/posture'); the developer's panels: patrol, stele
export function createSec({ q, getUser, ops, emergency, shield, opsLog, health, lean, secret, isDeveloper, live, seen, comm, facts, patrol, stele }) {
  const KEY = keyFrom(secret, 'sec-channel');
  // when each operator was last here, on the base itself (`seen` counts the operator site too, so it cannot tell the two apart)
  const here = new Map();
  const roleOf = (u) => (isDeveloper(u) ? 'developer' : ops.isOperator(u) ? 'operator' : ops.isViewer(u) ? 'viewer' : '');
  const may = (role, least) => !!role && RANK[role] >= RANK[least];
  const needOperator = (u) => { ops.need(u); here.set(u.id, Date.now()); return u; };
  // an operator or a viewer (only the reads)
  const needSee = (u) => { ops.see(u); here.set(u.id, Date.now()); return u; };
  // the developer's panels: anyone else is told what a route that does not exist says
  const developer = (u) => {
    ops.see(u);
    if (!isDeveloper(u)) throw new ApiError(404, 'not_found', 'APIが見つかりません');
    here.set(u.id, Date.now());
    return u;
  };
  const viewing = (u) => !ops.isOperator(u);
  const bare = (e) => ({ id: e.id, at: e.at, jst: e.jst, actor: e.actor, action: e.action, kind: e.kind, target: e.target, summary: e.summary, prevHash: e.prevHash, hash: e.hash });
  // (the figures of the サーバー tab, without the minute-by-minute history: the base draws its own chart from the shield's)
  const leanNow = () => { const v = lean(); return { ...v, rate: { last10: v.rate.last10, last60: v.rate.last60 } }; };
  const panelsFor = (role) => PANELS.filter((p) => may(role, p.role)).map((p) => ({ id: p.id, name: p.name }));

  function channelMessage(r) {
    return { id: r.id, from: { id: r.from_id, name: r.from_name }, text: openText(KEY, r.body) || '（読み取れません）', at: r.created_at };
  }
  // the operators and whether each is on the security base now (seen in the last 40 seconds), on the operator site / in the game, or when last online
  function operatorsNow() {
    const now = Date.now();
    return ops.operatorList().filter((o) => o.operator && o.id).map((o) => {
      const p = getUser(o.id);
      const at = (seen && seen.get(o.id)) || 0;
      return {
        id: o.id, name: o.name, avatar: o.avatar, developer: o.developer,
        base: now - (here.get(o.id) || 0) < 40000, site: now - at < 40000, game: live.isOnline(o.id), seenAt: Math.max(at, p ? p.last_seen : 0)
      };
    });
  }

  // how threatening it is, in one word: the shield's pressure and the emergency state (the base shows this at the top)
  function levelOf(sh, em) {
    if (em && em.level === 'lockdown') return 'lockdown';
    const p = sh.pressure || {}, m = sh.last5m || {};
    if (p.attackers >= (p.breachAt || 8) || p.criticals >= (p.criticalAt || 40)) return 'breach';
    if (m.attacks >= 20 || (sh.blocks || []).length >= 8) return 'high';
    if (m.attacks >= 3 || m.floods >= 1 || (sh.blocks || []).length >= 1) return 'elevated';
    if (m.authFails >= 5) return 'watch';
    return 'safe';
  }
  const ORDER = ['safe', 'watch', 'elevated', 'high', 'breach', 'lockdown'];

  // what threatens the operator site, from the operators' own log: counts of each kind of event in the last hour and day, and an
  // hour-by-hour line for the day; with a score and a word (the log is the record of what happened: nothing is guessed)
  // (asked on every look of every open base; the answer moves slowly, so it is made again every 10 seconds at most)
  let made = null;
  function threats(now = Date.now()) {
    if (made && now - made.at < 10000) return made.value;
    const value = compute(now);
    made = { at: now, value };
    return value;
  }
  function compute(now) {
    const since = now - 24 * HOUR;
    const marks = SIGNAL_ACTIONS.map(() => '?').join(',');
    const per = new Map();
    for (const r of q(`SELECT action, COUNT(*) AS n, SUM(at >= ?) AS h, MAX(at) AS last FROM ops_log WHERE at >= ? AND action IN (${marks}) GROUP BY action`).all(now - HOUR, since, ...SIGNAL_ACTIONS)) per.set(r.action, r);
    let score = 0;
    const signals = SIGNALS.map((s) => {
      let n24 = 0, n1 = 0, last = 0;
      for (const a of s.actions) { const r = per.get(a); if (r) { n24 += r.n; n1 += r.h || 0; last = Math.max(last, r.last); } }
      score += Math.min(n1, 10) * s.weight + (Math.min(n24, 30) * s.weight) / 6;
      return { id: s.id, name: s.name, n1h: n1, n24h: n24, last, level: n1 ? (s.weight >= 3 ? 'high' : 'warn') : n24 ? 'low' : 'none' };
    });
    const buckets = new Array(24).fill(0);
    const base = Math.floor(now / HOUR) * HOUR;
    for (const r of q(`SELECT at / ? AS h, COUNT(*) AS n FROM ops_log WHERE at >= ? AND action IN (${marks}) GROUP BY h`).all(HOUR, since, ...SIGNAL_ACTIONS)) {
      const i = 23 - (Math.floor(base / HOUR) - r.h);
      if (i >= 0 && i < 24) buckets[i] = r.n;
    }
    score = Math.round(score);
    const level = score >= 40 ? 'high' : score >= 15 ? 'elevated' : score >= 4 ? 'watch' : 'safe';
    return { level, score, signals, hours: buckets.map((n, i) => [base - (23 - i) * HOUR, n]) };
  }

  const routes = {
    'GET /api/sec/me': (req, u) => {
      needSee(u);
      if (seen) seen.set(u.id, Date.now());
      const role = roleOf(u);
      return { id: u.id, name: u.name, role, developer: isDeveloper(u), viewer: viewing(u), panels: panelsFor(role), speed: ops.speedNow(), now: Date.now() };
    },

    // the realtime view of TWO STATE's server and of what threatens it
    'GET /api/sec/status': (req, u) => {
      needSee(u);
      if (seen) seen.set(u.id, Date.now());
      const sh = shield.snapshot(), em = emergency.info(), site = threats();
      const own = levelOf(sh, em), level = ORDER[Math.max(ORDER.indexOf(own), ORDER.indexOf(site.level))];
      const common = {
        now: Date.now(), speed: ops.speedNow(), level, emergency: em, shield: sh, health: health(), server: leanNow(), operators: operatorsNow(), site: { level: site.level, score: site.score },
        // the most recent security and emergency log lines, for the panel (the full tamper check is GET /api/sec/verify, so it never waits)
        // (lines only: a line's detail comes when it is opened, GET /api/sec/log/entries; so it is the same for an operator and a viewer)
        security: opsLog.list({ kind: 'security', limit: 12, slim: true }), emergencyLog: opsLog.list({ kind: 'emergency', limit: 12, slim: true })
      };
      return viewing(u) ? { ...common, viewer: true } : common;
    },

    // what threatens the operator site: the signals, the day hour by hour, who attacks, what is blocked
    'GET /api/sec/threats': (req, u) => {
      needSee(u);
      const sh = shield.snapshot(), t = threats();
      return { now: Date.now(), ...t, blocks: sh.blocks || [], attackers: (sh.topAttackers || []).filter((x) => x.score > 0).slice(0, 12), recent: opsLog.list({ kind: 'security', limit: 10, slim: true }) };
    },

    // how the server says it is set, and how this very connection arrived (what the page weighs before it shows the lock)
    'GET /api/sec/posture': async (req, u) => {
      needSee(u);
      const id = await comm.identity();
      const t = transportOf(req), em = emergency.info(), last = patrol.last();
      const high = last ? (last.findings || []).filter((f) => f.level === 'high').length : null;
      const st = stele.status();
      const items = [
        { id: 'tls', name: 'この接続の暗号化', ok: !!t.tls, detail: t.tls ? `${t.tls}${t.http ? '・' + t.http : ''}` : 'サーバーには暗号化されていない接続に見えています' },
        { id: 'channel', name: 'セキュア通信（本ページの全通信を封印）', ok: true, detail: '封印されていない要求はサーバーが断ります' },
        { id: 'hsts', name: 'HTTPSの強制（HSTS）', ok: facts.hsts(), detail: facts.hsts() ? '1年間' : '送っていません' },
        { id: 'passkey', name: '毎回のパスキー認証', ok: facts.passkey(), detail: facts.passkey() ? '有効' : '無効' },
        { id: 'mfa', name: '開発者の追加認証の必須', ok: facts.devMfa(), detail: facts.devMfa() ? '必須' : '任意' },
        { id: 'log', name: '運営ログの鎖と石碑', ok: !!st.on && !st.diverged && !st.failSince, detail: !st.on ? '石碑の保管先がありません' : st.diverged ? '石碑と食い違いがあります' : st.failSince ? '刻めていません' : `${st.sealed}件を刻んであります` },
        { id: 'patrol', name: '自動点検', ok: last ? high === 0 : null, detail: last ? (high ? `重大な指摘 ${high} 件` : '異常なし') : 'まだ点検していません', at: last ? last.at : 0 },
        { id: 'shield', name: '攻撃の遮断（シールド）', ok: !!shield.on, detail: shield.on ? '動作中' : '停止中' },
        { id: 'emergency', name: '緊急システム', ok: !em.level, detail: em.level === 'lockdown' ? 'ロックダウン中' : em.level === 'stop' ? '緊急停止中' : '通常' }
      ];
      return { now: Date.now(), identity: { fp: id.fp, since: id.at }, transport: t, items };
    },

    // the operators' log, the same the operator site shows (read-only here)
    // slim=1: the lines only (a list); since=N: only the lines after number N (a page that has the older ones keeps up with this)
    'GET /api/sec/log': (req, u) => {
      needSee(u);
      const before = Number(req.query.get('before')) || 0, since = Number(req.query.get('since')) || 0, slim = req.query.get('slim') === '1';
      const entries = opsLog.list({ before, since, find: req.query.get('q') || '', kind: req.query.get('kind') || '', slim });
      return { entries: viewing(u) && !slim ? entries.map(bare) : entries, counts: before || since ? null : opsLog.counts(), now: Date.now() };
    },
    // some lines in full (at most 100, by number): what a list leaves out, for the lines that are opened
    'GET /api/sec/log/entries': (req, u) => {
      needSee(u);
      const entries = opsLog.many(String(req.query.get('ids') || '').split(',').slice(0, 100));
      return { entries: viewing(u) ? entries.map(bare) : entries };
    },
    // the log's integrity (the tamper check), asked on its own so it never slows the status panel
    'GET /api/sec/verify': async (req, u) => {
      needSee(u);
      return opsLog.verify();
    },
    // the page is leaving: its channel ends with it
    'POST /api/sec/channel/close': async (req, u) => {
      needSee(u);
      await req.json();
      return { ok: true };
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

    // the lockdown: raised or lifted by hand from the base (any operator, any time)
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
    },

    /* ---- the developer's alone ---- */

    // the automatic inspection: its last result, and one made now
    'GET /api/sec/dev/patrol': (req, u) => {
      developer(u);
      return { patrol: patrolOf(), now: Date.now() };
    },
    'POST /api/sec/dev/patrol/run': async (req, u) => {
      developer(u);
      await req.json();
      await patrol.run({ by: u });
      return { patrol: patrolOf(), now: Date.now() };
    },
    // the 石碑 (the log's copy outside the database): how it stands, and carved and looked over now
    'GET /api/sec/dev/stele': (req, u) => {
      developer(u);
      return { stele: stele.status(), now: Date.now() };
    },
    'POST /api/sec/dev/stele/run': async (req, u) => {
      developer(u);
      await req.json();
      const r = await stele.tick({ deep: true });
      return { stele: stele.status(), ran: { sealed: r.sealed, ok: r.check ? r.check.ok : true }, now: Date.now() };
    },
    // every open secure channel (never its keys), and ending one
    'GET /api/sec/dev/channels': async (req, u) => {
      developer(u);
      const id = await comm.identity();
      return { channels: comm.list(), identity: { fp: id.fp, spki: id.spki, since: id.at }, now: Date.now() };
    },
    'POST /api/sec/dev/channels/close': async (req, u) => {
      developer(u);
      const body = await req.json();
      const n = comm.close(String(body.id || ''));
      if (n) opsLog.add({ actor: u, action: 'sec_channel_closed', req, summary: `${u.name}がセキュア通信の接続を終了させました`, detail: { id: String(body.id).slice(0, 8) } });
      return { closed: n, channels: comm.list() };
    },
    // who holds which rights and how each signs in (names and facts, never a secret)
    'GET /api/sec/dev/access': (req, u) => {
      developer(u);
      return {
        operators: ops.operatorList().map((o) => ({ id: o.id, name: o.name, developer: o.developer, operator: o.operator, reused: o.reused, mfaMode: o.mfaMode, site: o.site, seenAt: o.seenAt })),
        viewers: ops.viewerList().map((v) => ({ id: v.id, name: v.name, site: v.site, at: v.at, by: v.by })),
        facts: { passkey: facts.passkey(), devMfa: facts.devMfa(), devCode: facts.devCode() },
        now: Date.now()
      };
    }
  };
  const patrolOf = () => { const r = patrol.last(); return r && { at: r.at, ms: r.ms, by: r.by, checks: r.checks, findings: r.findings }; };

  return { routes, panelsFor, roleOf, threats };
}
