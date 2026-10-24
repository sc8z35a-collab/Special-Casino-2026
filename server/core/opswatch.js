// The operators' screen view (運営サイトのプレイヤー一覧の「見る」).
//
// An operator can watch a player's game as it is played, to look into cheating
// and trouble. It is built to be the least it can be:
//
//  * It is not a video. The player's game sends only its own state — the reels,
//    the wallet, the bet, the win, which screen it is on (js/net/watchfeed.js) —
//    and the operator's page draws it again in a plain, effect-free way. That
//    is a few hundred bytes a second instead of a video's 300 kbps, and 3D
//    screens need no special case. No audio, no camera, no microphone, no
//    other app, no typed text, no chat, no password ever leaves the player's game.
//  * Nothing flows until an operator presses 見る: the server asks that one
//    player's game to start (an internal event, with nothing on the screen),
//    and tells it to stop when the watch ends. At most 30 minutes a time.
//  * It only goes one way. The operator's page can ask for a different
//    resolution / frame rate and nothing else: there is no message in either
//    direction that carries a tap, a key or a command, so a watching operator
//    cannot play for the player or touch their game in any way.
//  * Every frame is sealed from the player's game to the operator's page
//    (ECDH P-256 → HKDF → AES-256-GCM, a fresh key for each watch, counters
//    that only go up, the watch and its key generation bound into the tag).
//    The server only carries the sealed bytes, enforces the size and the
//    300 kbps ceiling, and cannot be made to show one operator's watch to
//    another. The operator's page treats every frame as untrusted input.
//  * Every watch is written to the operators' log (who, whom, from when to
//    when, how long, how many bytes, how it ended), and to its own table.
//  * Any emergency — the emergency stop, the lockdown, an attack under way, the
//    operator's rights taken away, the player punished or gone — ends every
//    watch at once, and a forced end is reported to Discord with the details.
import { randomBytes } from 'node:crypto';
import { ApiError, posInt } from './errors.js';
import { cleanText } from './auth.js';
import { Limiter } from './ratelimit.js';

export const WATCH = {
  // the longest one watch may last (nothing on the screen counts it down)
  maxMs: 30 * 60000,
  // at most this many watches at once, and one per operator and per player
  maxConcurrent: 3,
  // resolution (the operator's replica is drawn this tall) and frames a second
  qualities: [540, 480, 360, 240],
  fps: [20, 15, 10],
  defaultQuality: 360,
  defaultFps: 10,
  // the ceiling on what one watch may send: 300 kbps = 37,500 bytes a second
  bytesPerSec: 37500,
  // one sealed frame (base64url characters) is never bigger than this
  frameChars: 6000,
  // no first frame for this long: the player's game is not answering (an old version)
  noStartMs: 45000,
  // frames stopped for this long after they had started
  stallMs: 120000,
  // a side gone this long ends the watch (a dropped connection may come back)
  graceMs: 20000,
  // the monthly allowance is nearly all used: no new watches
  budgetPercent: 95
};

// 簡易メッセージ: ready-made lines (the operator may also write a short one)
export const PRESETS = {
  cheat: '不正行為の疑いがあるため、プレイ状況を確認しています。規約に反する行為はおやめください。',
  sub: 'サブアカウントの利用は禁止されています。心当たりのある場合は、利用をおやめください。',
  manners: '他のプレイヤーが不快になる言動はおやめください。',
  contact: '確認したいことがあります。公式チャットで状況をお知らせください。',
  thanks: 'いつもご利用ありがとうございます。引き続きお楽しみください。'
};
const CUSTOM_MAX = 200;

// an uncompressed P-256 public key, base64url (65 bytes)
const PUB = /^[A-Za-z0-9_-]{86,88}$/;
const SEALED = /^[A-Za-z0-9_-]+$/;

// why a watch ended, as the operator is told
export const ENDS = {
  operator: '見るのをやめました',
  replaced: '別の画面を見始めたため終了しました',
  max: '最大の監視時間に達したため終了しました',
  player_left: 'プレイヤーが切断したため終了しました',
  player_gone: 'プレイヤーが処分されたため終了しました',
  no_signal: 'プレイヤーの画面から応答がないため終了しました',
  operator_left: '運営サイトとの接続が切れたため終了しました',
  rights: '運営権がなくなったため終了しました',
  emergency: 'サーバーの緊急停止のため強制終了しました',
  lockdown: 'ロックダウンのため強制終了しました',
  security: '攻撃を検知したため強制終了しました',
  restart: 'サーバーが再起動したため終了しました',
  budget: 'サーバーの使用量が上限に近いため終了しました'
};
// the endings that are an emergency (forced; Discord is told)
const FORCED = new Set(['emergency', 'lockdown', 'security', 'rights', 'budget']);
const DANGEROUS = new Set(['emergency', 'lockdown', 'security']);

const sid = () => randomBytes(16).toString('base64url');
const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)}MB` : n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`);
const fmtTime = (ms) => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒` : `${s}秒`; };

// ops: server/core/ops.js; emergency: server/core/emergency.js; shield:
// server/core/shield.js (threat() → { attackers, criticals, breachAt, criticalAt });
// official: Ice Smoker公式; count(bytes): the サーバー tab's 映像通信;
// usage() → the month's share of the allowances (0-100); clock: the time (tests move it)
export function createOpsWatch({ q, live, ops, opsLog, official, emergency, shield = null, discord = null, getUser, isDeveloper, count = () => {}, usage = () => 0, clock = Date.now }) {
  const sessions = new Map();           // sid → session (memory only: a restart ends them all)
  const limits = {
    start: new Limiter(30, 12), quality: new Limiter(40, 10), message: new Limiter(20, 6),
    favorite: new Limiter(90, 30), hello: new Limiter(30, 6), read: new Limiter(120, 20)
  };
  const rate = (name, key) => {
    if (!limits[name].take(String(key))) throw new ApiError(429, 'rate_limited', '操作が速すぎます。少し待ってください');
  };
  let timer = null;

  /* ------------------------------------------------------------ records --- */

  // watches the server lost track of (it restarted): closed, with what is known
  function recover() {
    const rows = q('SELECT * FROM ops_watch_log WHERE ended_at = 0').all();
    for (const r of rows) {
      const at = clock();
      q('UPDATE ops_watch_log SET ended_at = ?, ms = ?, reason = ? WHERE id = ?').run(at, Math.max(0, Math.min(at - r.started_at, WATCH.maxMs)), 'restart', r.id);
      q(`INSERT INTO ops_watch_usage (op_id, bytes, ms, watches) VALUES (?, ?, ?, 1)
         ON CONFLICT(op_id) DO UPDATE SET bytes = bytes + excluded.bytes, ms = ms + excluded.ms, watches = watches + 1`).run(r.op_id, r.bytes, Math.min(at - r.started_at, WATCH.maxMs));
      const op = getUser(r.op_id), p = getUser(r.player_id);
      opsLog.add({
        actorName: 'システム', action: 'watch_end', target: p, summary: `${op ? op.name : '?'}が${p ? p.name : '?'}さんの画面を見ていた監視は、サーバーの再起動で終了（${fmtBytes(r.bytes)}まで）`,
        detail: { watchId: r.id, op: r.op_id, player: r.player_id, startedAt: r.started_at, bytes: r.bytes, reason: 'restart' }
      });
    }
  }
  recover();

  const usageOf = (opId) => q('SELECT bytes, ms, watches FROM ops_watch_usage WHERE op_id = ?').get(opId) || { bytes: 0, ms: 0, watches: 0 };

  /* ------------------------------------------------------------ sessions --- */

  const byOperator = (opId) => { for (const s of sessions.values()) if (s.opId === opId) return s; return null; };
  const byPlayer = (playerId) => { for (const s of sessions.values()) if (s.playerId === playerId) return s; return null; };
  const brief = (u) => ({ id: u.id, name: u.name, avatar: u.avatar });

  function schedule() {
    if (sessions.size && !timer) {
      timer = setInterval(() => { try { tick(); } catch (e) { console.error('watch tick failed', e); } }, 2000);
      if (timer && timer.unref) timer.unref();
    } else if (!sessions.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // The watch is over: written down, both ends told, the player's game stopped.
  function end(s, reason, { by = null, req = null } = {}) {
    if (!sessions.delete(s.id)) return;
    schedule();
    const now = clock();
    const ms = Math.max(0, Math.min(now - s.startedAt, WATCH.maxMs));
    const forced = FORCED.has(reason);
    q('UPDATE ops_watch_log SET ended_at = ?, ms = ?, bytes = ?, frames = ?, reason = ? WHERE id = ?').run(now, ms, s.bytes, s.frames, reason, s.logId);
    q(`INSERT INTO ops_watch_usage (op_id, bytes, ms, watches) VALUES (?, ?, ?, 1)
       ON CONFLICT(op_id) DO UPDATE SET bytes = bytes + excluded.bytes, ms = ms + excluded.ms, watches = watches + 1`).run(s.opId, s.bytes, ms);
    const total = usageOf(s.opId);
    const op = getUser(s.opId), p = getUser(s.playerId);
    const detail = {
      watchId: s.logId, sid: s.id, startedAt: { ms: s.startedAt }, endedAt: { ms: now }, ms, duration: fmtTime(ms),
      bytes: s.bytes, frames: s.frames, droppedFrames: s.dropped, averageBytesPerSecond: ms ? Math.round(s.bytes / (ms / 1000)) : 0,
      quality: `${s.quality}P・${s.fps}fps`, reason, reasonText: ENDS[reason] || reason, forced,
      operatorTotals: { bytes: total.bytes, ms: total.ms, watches: total.watches }
    };
    // (the operator who stopped it is the actor; when the system ended it, the actor is システム
    // and the operator is in the summary and the detail)
    const byOperator = (reason === 'operator' || reason === 'replaced') && op;
    opsLog.add({
      actor: byOperator ? op : null, actorName: byOperator ? undefined : 'システム', action: forced ? 'watch_force_end' : 'watch_end', target: p, req,
      summary: `${s.opName}が${s.playerName}さんの画面を${fmtTime(ms)}見た（${s.quality}P・${s.fps}fps・通信 ${fmtBytes(s.bytes)}・${ENDS[reason] || reason}）`,
      detail: { operator: { id: s.opId, name: s.opName }, player: { id: s.playerId, name: s.playerName }, ...detail }
    });
    // the player's game stops sending; the operator is told why
    live.send(s.playerId, 'view', { sid: s.id, on: false });
    live.sendOps(s.opId, 'watchend', { sid: s.id, reason, text: ENDS[reason] || '', bytes: s.bytes, ms, total: total.bytes });
    if (DANGEROUS.has(reason) && discord) {
      discord.danger('🛑', `画面を見る機能を緊急事案で強制終了しました（${ENDS[reason]}）`, [
        `・見ていた人：${s.opName}`, `・見られていたプレイヤー：${s.playerName}`, `・監視時間：${fmtTime(ms)}・通信 ${fmtBytes(s.bytes)}`,
        `・画質：${s.quality}P・${s.fps}fps`
      ]);
    }
    return detail;
  }

  // every watch ends (an emergency)
  function terminateAll(reason = 'emergency') {
    for (const s of [...sessions.values()]) end(s, reason);
  }

  // Looks at every watch: its time, the server, the two people on it.
  function tick(now = clock()) {
    if (!sessions.size) { schedule(); return; }
    const stopped = emergency.stopped();
    const threat = shield && shield.threat ? shield.threat(now) : null;
    const attack = !!threat && (threat.attackers >= Math.ceil(threat.breachAt / 2) || threat.criticals >= Math.ceil(threat.criticalAt / 2));
    // the month's allowance is all used: streaming costs money from here on
    const over = usage() >= 100;
    for (const s of [...sessions.values()]) {
      if (stopped) { end(s, emergency.locked() ? 'lockdown' : 'emergency'); continue; }
      if (attack) { end(s, 'security'); continue; }
      if (over) { end(s, 'budget'); continue; }
      if (now >= s.expiresAt) { end(s, 'max'); continue; }
      const op = getUser(s.opId), p = getUser(s.playerId);
      if (!op || op.banned || !ops.isOperator(op)) { end(s, 'rights'); continue; }
      if (!p || p.banned || p.archived_at) { end(s, 'player_gone'); continue; }
      // a side that is not connected: given a moment to come back
      if (!live.isOnline(s.playerId)) { s.playerAway = s.playerAway || now; if (now - s.playerAway > WATCH.graceMs) { end(s, 'player_left'); continue; } } else s.playerAway = 0;
      if (!live.opsOnline(s.opId)) { s.opAway = s.opAway || now; if (now - s.opAway > WATCH.graceMs) { end(s, 'operator_left'); continue; } } else s.opAway = 0;
      if (!s.frames && now - s.startedAt > WATCH.noStartMs) { end(s, 'no_signal'); continue; }
      if (s.frames && now - s.lastFrameAt > WATCH.stallMs) { end(s, 'no_signal'); continue; }
    }
    schedule();
  }

  /* ------------------------------------------------------------ the operator --- */

  function start(u, body, req) {
    rate('start', u.id);
    if (emergency.stopped()) throw new ApiError(503, 'stopped', 'サーバーが緊急停止中のため、画面は見られません');
    const quality = body.quality === undefined ? WATCH.defaultQuality : Number(body.quality);
    const fps = body.fps === undefined ? WATCH.defaultFps : Number(body.fps);
    if (!WATCH.qualities.includes(quality)) throw new ApiError(400, 'bad_quality', '画質は 540P / 480P / 360P / 240P から選んでください');
    if (!WATCH.fps.includes(fps)) throw new ApiError(400, 'bad_fps', 'フレームレートは 20 / 15 / 10 fps から選んでください');
    const pub = String(body.pub || '');
    if (!PUB.test(pub)) throw new ApiError(400, 'bad_key', '暗号鍵が正しくありません。ページを読み込み直してください');
    const p = getUser(posInt(body.player, 'プレイヤー'));
    if (!p || p.npc) throw new ApiError(404, 'not_found', 'プレイヤーが見つかりません');
    if (p.id === u.id) throw new ApiError(400, 'self', '自分の画面は見られません');
    if (p.ban_kind === 'deleted' || p.archived_at) throw new ApiError(409, 'gone', `${p.name}さんのアカウントは利用できません`);
    if (isDeveloper(p) && !isDeveloper(u)) throw new ApiError(403, 'developer', '開発者のアカウントの画面は見られません');
    if (p.banned) throw new ApiError(409, 'banned', `${p.name}さんは処分中のため、画面はありません`);
    if (!live.isOnline(p.id)) throw new ApiError(409, 'offline', `${p.name}さんは今オンラインではありません`);
    const there = byPlayer(p.id);
    if (there && there.opId !== u.id) throw new ApiError(409, 'busy', `${p.name}さんの画面は、ほかの運営者が見ています`);
    if (usage() >= WATCH.budgetPercent) throw new ApiError(503, 'budget', '今月のサーバー使用量が上限に近いため、画面は見られません');
    // one at a time for an operator (a new one replaces the old), and a ceiling for all
    const mine = byOperator(u.id);
    if (sessions.size - (mine ? 1 : 0) >= WATCH.maxConcurrent) throw new ApiError(429, 'too_many', '画面を見られる数の上限です（同時に3人まで）。しばらくしてからもう一度お試しください');
    if (mine) end(mine, 'replaced', { req });
    const now = clock();
    const before = usageOf(u.id);
    const row = q('INSERT INTO ops_watch_log (op_id, player_id, started_at, ended_at, ms, bytes, frames, quality, reason) VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?)')
      .run(u.id, p.id, now, `${quality}P・${fps}fps`, '');
    const s = {
      id: sid(), opId: u.id, opName: u.name, playerId: p.id, playerName: p.name, startedAt: now, expiresAt: now + WATCH.maxMs, quality, fps, opPub: pub,
      playerPub: '', epoch: 0, lastN: -1, frames: 0, dropped: 0, bytes: 0, secBytes: 0, secAt: now, statAt: now, lastFrameAt: 0,
      bucket: { tokens: WATCH.bytesPerSec * 2, at: now }, logId: Number(row.lastInsertRowid), playerAway: 0, opAway: 0
    };
    sessions.set(s.id, s);
    schedule();
    opsLog.add({
      actor: u, action: 'watch_start', target: p, req,
      summary: `${u.name}が${p.name}さんの画面を見始めた（${quality}P・${fps}fps）`,
      detail: { watchId: s.logId, sid: s.id, quality, fps, maxMinutes: WATCH.maxMs / 60000, operatorTotalsBefore: before }
    });
    // the player's game is asked to start sending — nothing is shown to the player
    live.send(p.id, 'view', { sid: s.id, on: true, q: quality, fps, pub });
    return { sid: s.id, quality, fps, player: brief(p), totals: before, limits: { bytesPerSec: WATCH.bytesPerSec } };
  }

  function mineBy(u, id) {
    const s = sessions.get(String(id || ''));
    if (!s || s.opId !== u.id) throw new ApiError(404, 'not_watching', 'この画面はもう見ていません');
    return s;
  }

  function setQuality(u, body) {
    rate('quality', u.id);
    const s = mineBy(u, body.sid);
    const quality = body.quality === undefined ? s.quality : Number(body.quality);
    const fps = body.fps === undefined ? s.fps : Number(body.fps);
    if (!WATCH.qualities.includes(quality)) throw new ApiError(400, 'bad_quality', '画質は 540P / 480P / 360P / 240P から選んでください');
    if (!WATCH.fps.includes(fps)) throw new ApiError(400, 'bad_fps', 'フレームレートは 20 / 15 / 10 fps から選んでください');
    s.quality = quality;
    s.fps = fps;
    q('UPDATE ops_watch_log SET quality = ? WHERE id = ?').run(`${quality}P・${fps}fps`, s.logId);
    live.send(s.playerId, 'view', { sid: s.id, on: true, q: quality, fps });
    return { sid: s.id, quality, fps };
  }

  function stop(u, body, req) {
    const s = mineBy(u, body.sid);
    const detail = end(s, 'operator', { by: u, req });
    return { stopped: true, bytes: detail ? detail.bytes : 0, ms: detail ? detail.ms : 0 };
  }

  // what a page that was reloaded needs: the watch it has, and its totals
  function state(u) {
    const s = byOperator(u.id);
    const t = usageOf(u.id);
    return {
      session: s ? { sid: s.id, quality: s.quality, fps: s.fps, player: brief(getUser(s.playerId) || { id: s.playerId, name: s.playerName, avatar: '' }), bytes: s.bytes, hasKey: !!s.playerPub } : null,
      totals: t, presets: Object.keys(PRESETS).map((k) => ({ id: k, text: PRESETS[k] })), customMax: CUSTOM_MAX,
      qualities: WATCH.qualities, fps: WATCH.fps, limits: { bytesPerSec: WATCH.bytesPerSec }
    };
  }

  // 簡易メッセージ: from Ice Smoker公式, the way the operators' messages always go
  function message(u, body, req) {
    rate('message', u.id);
    const s = mineBy(u, body.sid);
    const p = getUser(s.playerId);
    if (!p) throw new ApiError(404, 'not_found', 'プレイヤーが見つかりません');
    const preset = body.preset ? String(body.preset) : '';
    let text;
    if (preset) {
      if (!PRESETS[preset]) throw new ApiError(400, 'bad_preset', '定型文が正しくありません');
      text = PRESETS[preset];
    } else {
      text = cleanText(body.text, CUSTOM_MAX);
    }
    const full = `【運営からのお知らせ】\n\n${p.name}様\n\n${text}\n\nIce Smoker公式より`;
    const m = official.say(p.id, full);
    opsLog.add({
      actor: u, action: 'bot_message', target: p, req, summary: `${p.name}さんへ公式から簡易メッセージ（画面確認中）`,
      detail: { subject: '運営からのお知らせ', body: text, sent: full, messageId: m.id, watchId: s.logId, preset: preset || null }
    });
    return { sent: true };
  }

  /* ------------------------------------------------------------ the player's game --- */

  // The game answers 'view' with its fresh public key, once for each start.
  function hello(u, body) {
    rate('hello', u.id);
    const s = sessions.get(String(body.sid || ''));
    if (!s || s.playerId !== u.id) throw new ApiError(404, 'not_found', 'リクエストが正しくありません');
    const pub = String(body.pub || '');
    if (!PUB.test(pub)) throw new ApiError(400, 'bad_key', 'リクエストが正しくありません');
    s.playerPub = pub;
    s.epoch += 1;
    s.lastN = -1;
    live.sendOps(s.opId, 'watchhello', { sid: s.id, pub, e: s.epoch });
    return { e: s.epoch, fps: s.fps, q: s.quality };
  }

  // One sealed frame. The server cannot read it: it checks who sent it, how
  // big and how fast, and hands it on.
  function frame(u, body) {
    const s = sessions.get(String(body.sid || ''));
    if (!s || s.playerId !== u.id) return { ok: false };
    const now = clock();
    if (now >= s.expiresAt || emergency.stopped()) { tick(now); return { ok: false }; }
    const e = Number(body.e), n = Number(body.n), d = body.d;
    if (!Number.isSafeInteger(e) || e !== s.epoch || !Number.isSafeInteger(n) || n <= s.lastN || n > 0x7fffffff) return { ok: false };
    if (typeof d !== 'string' || !d.length || d.length > WATCH.frameChars || !SEALED.test(d)) return { ok: false };
    const size = d.length + 40;
    // the 300 kbps ceiling: a frame over it is dropped, not sent
    const b = s.bucket;
    b.tokens = Math.min(WATCH.bytesPerSec * 2, b.tokens + (now - b.at) * WATCH.bytesPerSec / 1000);
    b.at = now;
    if (b.tokens < size) { s.dropped += 1; return { ok: true, dropped: true }; }
    b.tokens -= size;
    s.lastN = n;
    s.frames += 1;
    s.bytes += size;
    s.secBytes += size;
    s.lastFrameAt = now;
    count(size);
    live.sendOps(s.opId, 'watchframe', { sid: s.id, e, n, d });
    // once a second the operator is told what it costs (the server's own count)
    if (now - s.statAt >= 1000) {
      const rate1 = Math.round(s.secBytes * 1000 / Math.max(1, now - s.statAt));
      live.sendOps(s.opId, 'watchstat', { sid: s.id, bytes: s.bytes, perSec: rate1, frames: s.frames, dropped: s.dropped, total: usageOf(s.opId).bytes + s.bytes });
      s.statAt = now;
      s.secBytes = 0;
    }
    return { ok: true };
  }

  /* ------------------------------------------------------------ favourites and the record --- */

  function favoriteIds(opId) {
    return q('SELECT player_id FROM ops_favorites WHERE op_id = ? ORDER BY created_at DESC').all(opId).map((r) => r.player_id);
  }
  function favorite(u, body) {
    rate('favorite', u.id);
    const p = getUser(posInt(body.player, 'プレイヤー'));
    if (!p || p.npc) throw new ApiError(404, 'not_found', 'プレイヤーが見つかりません');
    if (body.on === false) q('DELETE FROM ops_favorites WHERE op_id = ? AND player_id = ?').run(u.id, p.id);
    else q('INSERT OR IGNORE INTO ops_favorites (op_id, player_id, created_at) VALUES (?, ?, ?)').run(u.id, p.id, clock());
    return { player: p.id, on: body.on !== false, favorites: favoriteIds(u.id) };
  }
  // who watched whom, how long and how much (every operator may read it)
  function history(req) {
    const player = Number(req.query.get('player')) || 0;
    const limit = Math.min(200, Math.max(1, Number(req.query.get('limit')) || 50));
    const rows = player
      ? q('SELECT * FROM ops_watch_log WHERE player_id = ? ORDER BY id DESC LIMIT ?').all(player, limit)
      : q('SELECT * FROM ops_watch_log ORDER BY id DESC LIMIT ?').all(limit);
    return rows.map((r) => ({
      id: r.id, startedAt: r.started_at, endedAt: r.ended_at, ms: r.ms, bytes: r.bytes, frames: r.frames, quality: r.quality, reason: r.reason,
      reasonText: ENDS[r.reason] || '', live: !r.ended_at,
      operator: (getUser(r.op_id) || { id: r.op_id, name: '?' }).name, player: (getUser(r.player_id) || { id: r.player_id, name: '?' }).name
    }));
  }

  const routes = {
    'POST /api/ops/watch/start': async (req, u) => { ops.need(u); return start(u, await req.json(), req); },
    'POST /api/ops/watch/quality': async (req, u) => { ops.need(u); return setQuality(u, await req.json()); },
    'POST /api/ops/watch/stop': async (req, u) => { ops.need(u); return stop(u, await req.json(), req); },
    'POST /api/ops/watch/message': async (req, u) => { ops.need(u); return message(u, await req.json(), req); },
    'GET /api/ops/watch/state': (req, u) => { ops.need(u); rate('read', u.id); return state(u); },
    'GET /api/ops/watch/log': (req, u) => { ops.need(u); rate('read', u.id); return { watches: history(req), now: clock() }; },
    'POST /api/ops/favorite': async (req, u) => { ops.need(u); return favorite(u, await req.json()); },
    // the player's game (any logged-in player: only the one being watched is accepted)
    'POST /api/watch/hello': async (req, u) => hello(u, await req.json(8 * 1024)),
    'POST /api/watch/frame': async (req, u) => frame(u, await req.json(16 * 1024))
  };

  return {
    routes, tick, terminateAll, frame, favoriteIds,
    active: () => [...sessions.values()].map((s) => ({ sid: s.id, op: s.opId, player: s.playerId, quality: s.quality, fps: s.fps, bytes: s.bytes, frames: s.frames }))
  };
}
