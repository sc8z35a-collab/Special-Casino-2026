// The whole game server as one Durable Object: every player, balance, message
// and friendship lives in this object's own SQLite database, which Cloudflare
// keeps (and replicates) for good. Deploying new code never touches it.
//
// Live updates go over WebSockets with hibernation: idle connections cost
// nothing and the object can sleep while players are connected.
import { DurableObject } from 'cloudflare:workers';
import { createApi } from '../core/api.js';
import { configFrom } from '../core/config.js';
import { migrate, metaValue } from '../core/db.js';
import { ApiError } from '../core/errors.js';
import { newToken } from '../core/auth.js';
import { nextAlarm, monthOf } from './awake.js';

const HOUSEKEEPING_EVERY = 6 * 3600000;
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

// The adapter the shared core expects, on top of the object's SQL storage.
function sqlAdapter(ctx) {
  const sql = ctx.storage.sql;
  let depth = 0;
  const first = (cursor) => { for (const row of cursor) return row; return undefined; };
  return {
    prepare(query) {
      return {
        get: (...args) => first(sql.exec(query, ...args)),
        all: (...args) => sql.exec(query, ...args).toArray(),
        run: (...args) => {
          sql.exec(query, ...args).toArray();
          const r = sql.exec('SELECT changes() AS changes, last_insert_rowid() AS id').one();
          return { changes: r.changes, lastInsertRowid: r.id };
        }
      };
    },
    exec: (query) => { sql.exec(query).toArray(); },
    // nested calls join the outer transaction
    tx(fn) {
      if (depth > 0) return fn();
      depth++;
      try {
        return ctx.storage.transactionSync(fn);
      } finally {
        depth--;
      }
    }
  };
}

// The developer's vault keeps its files' pieces in R2 when the Worker has the
// bucket (wrangler.jsonc: r2_buckets, binding VAULT), each with its SHA-256
// (server/core/vault.js).
function bucketBlobs(bucket) {
  return {
    put: (key, bytes, sha256) => bucket.put(key, bytes, { customMetadata: { sha256 } }),
    async get(key) {
      const o = await bucket.get(key);
      return o ? { bytes: new Uint8Array(await o.arrayBuffer()), sha256: (o.customMetadata || {}).sha256 || '' } : null;
    },
    async list(prefix) {
      const out = [];
      let cursor;
      do {
        const r = await bucket.list({ prefix, cursor, include: ['customMetadata'] });
        for (const o of r.objects) out.push({ key: o.key, sha256: (o.customMetadata || {}).sha256 || '' });
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor);
      return out;
    },
    async del(keys) {
      for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
    }
  };
}

// Pushes events to connected players. Each socket is tagged "u:<user id>";
// an operator site's own one "o:<user id>" (no game events, not a player
// online: the 運営チャット's call and the developer called).
class SocketHub {
  constructor(ctx) { this.ctx = ctx; }

  static isOpen(ws) { return ws.readyState === 1; }

  sockets(userId) { return this.ctx.getWebSockets(`u:${userId}`).filter(SocketHub.isOpen); }

  sendOps(userId, event, data) {
    const text = JSON.stringify({ event, data });
    for (const ws of this.ctx.getWebSockets(`o:${userId}`)) if (SocketHub.isOpen(ws)) this.write(ws, text);
  }

  opsOnline(userId) { return this.ctx.getWebSockets(`o:${userId}`).some(SocketHub.isOpen); }

  dropOps(userId) {
    for (const ws of this.ctx.getWebSockets(`o:${userId}`)) {
      try { ws.close(1000, 'Authentication settings changed'); } catch { /* already closed */ }
    }
  }

  write(ws, text) {
    try { ws.send(text); } catch { /* closing */ }
  }

  send(userId, event, data) {
    const text = JSON.stringify({ event, data });
    for (const ws of this.sockets(userId)) this.write(ws, text);
  }

  broadcast(event, data, filter) {
    const text = JSON.stringify({ event, data });
    for (const ws of this.ctx.getWebSockets()) {
      if (!SocketHub.isOpen(ws)) continue;
      const a = ws.deserializeAttachment();
      if (!a || a.ops || (filter && !filter(a.u))) continue;
      this.write(ws, text);
    }
  }

  isOnline(userId) { return this.sockets(userId).length > 0; }

  onlineCount() {
    const users = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      if (!SocketHub.isOpen(ws)) continue;
      const a = ws.deserializeAttachment();
      if (a && !a.ops) users.add(a.u);
    }
    return users.size;
  }
}

// The host-independent request the core API understands.
function coreRequest(request, url) {
  return {
    method: request.method,
    path: url.pathname,
    query: url.searchParams,
    ip: request.headers.get('cf-connecting-ip') || '',
    header: (name) => request.headers.get(name),
    async json(limit = 16 * 1024) {
      if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) {
        throw new ApiError(415, 'content_type', 'Content-Type は application/json にしてください');
      }
      if (Number(request.headers.get('content-length') || 0) > limit) throw new ApiError(413, 'too_large', '送信できません。大きすぎます。');
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > limit) throw new ApiError(413, 'too_large', '送信できません。大きすぎます。');
      try {
        const text = new TextDecoder().decode(bytes);
        const body = text ? JSON.parse(text) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
        return body;
      } catch {
        throw new ApiError(400, 'bad_json', 'リクエストの形式が正しくありません');
      }
    },
    // the body exactly as it came (a payment company's signed notice)
    async bytes(limit = 64 * 1024) {
      if (Number(request.headers.get('content-length') || 0) > limit) throw new ApiError(413, 'too_large', '送信できません。大きすぎます。');
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength > limit) throw new ApiError(413, 'too_large', '送信できません。大きすぎます。');
      return bytes;
    }
  };
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export class Casino extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.db = sqlAdapter(ctx);
    this.live = new SocketHub(ctx);
    // staying awake while played (server/cloudflare/awake.js): the last
    // player's action (0: none since this wake-up), the alarm set, the ticks
    this.activeAt = 0;
    this.alarmAt = null;
    this.awake = { month: monthOf(Date.now()), ticks: 0 };
    // spins are not logged one by one here: it keeps the free plan's daily row writes for players
    this.config = configFrom({ LOG_SPINS: 'false', ...env });
    // "ping" is answered by Cloudflare itself, without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      migrate(this.db);
      const secret = metaValue(this.db, 'ticket_secret', () => newToken());
      // (phone notifications go out after the answer: the object waits for them)
      const defer = (p) => { if (ctx.waitUntil) ctx.waitUntil(p); return p; };
      this.api = createApi({
        db: this.db, live: this.live, config: this.config, secret, defer, hostAdmin: (cmd, args) => this.hostAdmin(cmd, args),
        blobs: env.VAULT ? bucketBlobs(env.VAULT) : null,
        host: {
          // for the operator site's サーバー tab
          name: 'cloudflare', dbBytes: () => ctx.storage.sql.databaseSize, sockets: () => ctx.getWebSockets().length,
          // which version of the Worker this is (wrangler.jsonc: version_metadata): a new one is told to Discord
          version: env.CF_VERSION_METADATA ? { id: String(env.CF_VERSION_METADATA.id || ''), tag: String(env.CF_VERSION_METADATA.tag || '') } : null,
          // the operators' log's newest hash, in the object's own storage (SQL cannot reach it) and in Workers Logs
          anchor: {
            put: (row) => { ctx.storage.put('ops_log_anchor', row); console.log(`[ops-log] #${row.id} ${row.hash}`); },
            get: () => ctx.storage.get('ops_log_anchor')
          },
          // the emergency stop: every live connection closes
          stop: () => { for (const ws of ctx.getWebSockets()) { try { ws.close(1012, 'emergency'); } catch { /* closing */ } } },
          // the housekeeping sooner (a backup due)
          reschedule: (at) => this.housekeepSoon(at)
        }
      });
      // the housekeeping's time (the alarm also rings in between to stay awake;
      // an alarm from before that was for the housekeeping)
      const alarm = await ctx.storage.getAlarm();
      this.housekeepAt = (await ctx.storage.get('housekeep_at')) || alarm || Date.now() + HOUSEKEEPING_EVERY;
      await ctx.storage.put('housekeep_at', this.housekeepAt);
      this.awake.ticks = (await ctx.storage.get(`awake:${this.awake.month}`)) || 0;
      this.alarmAt = alarm;
      if (alarm === null || alarm > this.housekeepAt) await this.setAlarm(this.housekeepAt);
    });
  }

  setAlarm(at) {
    this.alarmAt = at;
    return this.ctx.storage.setAlarm(at);
  }
  housekeepSoon(at) {
    if (at >= this.housekeepAt) return null;
    this.housekeepAt = at;
    return Promise.all([this.ctx.storage.put('housekeep_at', at), this.alarmAt === null || this.alarmAt > at ? this.setAlarm(at) : null]);
  }
  // a player did something: stay awake for a while (the alarm sooner, once)
  touch() {
    this.activeAt = Date.now();
    const at = nextAlarm({ now: this.activeAt, housekeepAt: this.housekeepAt, sockets: this.ctx.getWebSockets().length, activeAt: this.activeAt, ticks: this.awake.ticks });
    if (this.alarmAt === null || at < this.alarmAt - 1000) this.setAlarm(at);
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.touch();
    if (url.pathname === '/api/live') return this.connect(request, url);
    // the automatic filter's note about a request it stopped (from the Worker
    // only: it hands on nothing but /api/*)
    if (url.pathname === '/internal/filter') {
      let note = {};
      try { note = await request.json(); } catch { /* left empty */ }
      this.api.filtered(coreRequest(request, url), note || {});
      return json(200, { ok: true });
    }
    const out = await this.api.handle(coreRequest(request, url));
    const bytes = new TextEncoder().encode(JSON.stringify(out.body));
    this.api.sent(bytes.byteLength, url.pathname);
    return new Response(bytes, { status: out.status, headers: JSON_HEADERS });
  }

  // GET /api/live?ticket=... (WebSocket). The ticket comes from POST /api/stream-ticket.
  connect(request, url) {
    if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') {
      return json(426, { error: { code: 'upgrade', message: 'WebSocket で接続してください' } });
    }
    if (this.api.stopped()) return json(503, this.api.stoppedBody());
    // the operator site's own connection (an operator's ticket of its own)
    if (url.searchParams.has('ops')) {
      const opsId = this.api.consumeOpsTicket(url.searchParams.get('ops'));
      if (!opsId) return json(401, { error: { code: 'ticket', message: '接続の有効期限が切れました' } });
      const [c, sv] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(sv, [`o:${opsId}`]);
      sv.serializeAttachment({ u: opsId, ops: true });
      sv.send(JSON.stringify({ event: 'hello', data: { ops: true } }));
      return new Response(null, { status: 101, webSocket: c });
    }
    const userId = this.api.consumeTicket(url.searchParams.get('ticket'));
    if (!userId) return json(401, { error: { code: 'ticket', message: '接続の有効期限が切れました' } });
    const first = !this.live.isOnline(userId);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [`u:${userId}`]);
    server.serializeAttachment({ u: userId });
    server.send(JSON.stringify({ event: 'hello', data: { ...this.api.hello(userId), online: this.live.onlineCount() } }));
    if (first) this.api.presence(userId, true);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Players mostly listen: what they do goes through the HTTP API, except
  // voice chat signalling ({ op: "call", ... }), 入力中 ({ op: "typing" }) and
  // the activity beat of the time quests ({ op: "beat" }), which are chatty.
  async webSocketMessage(ws, message) {
    if (message === 'ping') { this.live.write(ws, 'pong'); return; }
    if (typeof message !== 'string' || message.length > 32 * 1024) return;
    const a = ws.deserializeAttachment();
    if (!a) return;
    // (the operator site's connection only listens)
    if (a.ops) return;
    let body;
    try { body = JSON.parse(message); } catch { return; }
    // (a beat from a game nobody touched for a minute is not someone playing)
    if (body && body.op !== 'sight' && !(body.op === 'beat' && Number(body.idle) > 60000)) this.touch();
    if (body && body.op === 'call') this.api.socketCall(a.u, body);
    else if (body && body.op === 'typing') this.api.socketTyping(a.u, body);
    else if (body && body.op === 'beat') this.api.socketBeat(a.u, body);
    else if (body && body.op === 'sight') this.api.socketSight(a.u, body);
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch { /* already closed */ }
    this.left(ws);
  }

  async webSocketError(ws) {
    this.left(ws);
  }

  left(ws) {
    const a = ws.deserializeAttachment();
    if (!a) return;
    if (a.ops) {
      if (!this.ctx.getWebSockets(`o:${a.u}`).some((other) => other !== ws && SocketHub.isOpen(other))) this.api.opsGone(a.u);
      return;
    }
    const still = this.ctx.getWebSockets(`u:${a.u}`).some((other) => other !== ws && SocketHub.isOpen(other));
    if (!still) this.api.presence(a.u, false);
  }

  // the housekeeping: every 6 hours, or sooner when the developer's backup is
  // due; in between, while played, a tick to stay awake (counted by the month)
  async alarm() {
    const now = Date.now();
    if (now >= this.housekeepAt - 1000) {
      await this.api.housekeeping();
      this.housekeepAt = this.api.nextHousekeeping();
      await this.ctx.storage.put('housekeep_at', this.housekeepAt);
    }
    const month = monthOf(now);
    if (this.awake.month !== month) this.awake = { month, ticks: 0 };
    const at = nextAlarm({ now, housekeepAt: this.housekeepAt, sockets: this.ctx.getWebSockets().length, activeAt: this.activeAt, ticks: this.awake.ticks });
    if (at < this.housekeepAt && ++this.awake.ticks % 50 === 0) await this.ctx.storage.put(`awake:${month}`, this.awake.ticks);
    await this.setAlarm(at);
  }

  // Operator commands that only exist here (see README): point-in-time recovery.
  // Cloudflare keeps 30 days of history of this database.
  async hostAdmin(cmd, args) {
    try {
      return await this.pointInTime(cmd, args);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(400, 'admin', `巻き戻しできませんでした: ${e && e.message}`);
    }
  }

  async pointInTime(cmd, args) {
    if (cmd === 'bookmark') {
      const at = args[0] ? Date.parse(args[0]) : Date.now();
      if (!Number.isFinite(at)) throw new ApiError(400, 'admin', '日時は 2026-10-17T12:00:00Z の形式で指定してください');
      return { at: new Date(at).toISOString(), bookmark: await this.ctx.storage.getBookmarkForTime(at) };
    }
    if (cmd === 'restore-time') {
      const at = Date.parse(args[0] || '');
      if (!Number.isFinite(at) || at > Date.now()) throw new ApiError(400, 'admin', '戻したい日時を 2026-10-17T12:00:00Z の形式で指定してください');
      const bookmark = await this.ctx.storage.getBookmarkForTime(at);
      const undo = await this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
      // restart now; the next request opens the database as it was at `at`
      setTimeout(() => this.ctx.abort('restoring'), 50);
      return { restoredTo: new Date(at).toISOString(), undoBookmark: undo };
    }
    return undefined;
  }
}
