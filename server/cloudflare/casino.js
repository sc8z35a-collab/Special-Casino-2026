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

// Pushes events to connected players. Each socket is tagged "u:<user id>".
class SocketHub {
  constructor(ctx) { this.ctx = ctx; }

  static isOpen(ws) { return ws.readyState === 1; }

  sockets(userId) { return this.ctx.getWebSockets(`u:${userId}`).filter(SocketHub.isOpen); }

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
      if (!a || (filter && !filter(a.u))) continue;
      this.write(ws, text);
    }
  }

  isOnline(userId) { return this.sockets(userId).length > 0; }

  onlineCount() {
    const users = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      if (!SocketHub.isOpen(ws)) continue;
      const a = ws.deserializeAttachment();
      if (a) users.add(a.u);
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
        // for the operator site's サーバー tab
        host: { name: 'cloudflare', dbBytes: () => ctx.storage.sql.databaseSize, sockets: () => ctx.getWebSockets().length }
      });
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + HOUSEKEEPING_EVERY);
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/live') return this.connect(request, url);
    const out = await this.api.handle(coreRequest(request, url));
    const bytes = new TextEncoder().encode(JSON.stringify(out.body));
    this.api.sent(bytes.byteLength);
    return new Response(bytes, { status: out.status, headers: JSON_HEADERS });
  }

  // GET /api/live?ticket=... (WebSocket). The ticket comes from POST /api/stream-ticket.
  connect(request, url) {
    if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') {
      return json(426, { error: { code: 'upgrade', message: 'WebSocket で接続してください' } });
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
    let body;
    try { body = JSON.parse(message); } catch { return; }
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
    const still = this.ctx.getWebSockets(`u:${a.u}`).some((other) => other !== ws && SocketHub.isOpen(other));
    if (!still) this.api.presence(a.u, false);
  }

  async alarm() {
    await this.api.housekeeping();
    await this.ctx.storage.setAlarm(Date.now() + HOUSEKEEPING_EVERY);
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
