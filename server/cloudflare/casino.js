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
import { answerOnSocket, connectionOf } from '../core/socketapi.js';
import { terminalEvent } from '../core/live-terminal.js';

const HOUSEKEEPING_EVERY = 6 * 3600000;
const JSON_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // (no search engine or archive keeps an address that carries a link's secret)
  'X-Robots-Tag': 'noindex, nofollow, noarchive'
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
    put: async (key, bytes, sha256, options = {}) => (await bucket.put(key, bytes, {
      customMetadata: { sha256 }, ...(options.onlyIfAbsent ? { onlyIf: { etagDoesNotMatch: '*' } } : {})
    })) !== null,
    async head(key) {
      const o = await bucket.head(key);
      return o ? { size: o.size, sha256: (o.customMetadata || {}).sha256 || '' } : null;
    },
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

// The 石碑 (server/core/stele.js): the operators' log's copies, in a bucket of their own when the Worker has one (binding OPLOG;
// a bucket lock on the prefix oplog/ makes the files impossible to delete or replace), else in the vault's bucket (VAULT) under
// that prefix. A file is made once: a second write under the same name is refused unless the bytes are the same.
function bucketStele(bucket) {
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const read = async (key) => { const o = await bucket.get(key); return o ? new Uint8Array(await o.arrayBuffer()) : null; };
  return {
    async put(key, bytes) {
      const wrote = await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' } });
      if (wrote === null) {
        const have = await read(key);
        if (!have || !same(have, bytes)) throw new Error('その名前の控えがすでにあり、内容が違います（上書きはしません）');
      }
    },
    get: read,
    async list(prefix) {
      const out = [];
      let cursor;
      do {
        const r = await bucket.list({ prefix, cursor });
        for (const o of r.objects) out.push(o.key);
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor);
      return out;
    }
  };
}

// Pushes events to connected players. Each socket is tagged "u:<user id>";
// an operator site's own one "o:<user id>" (no game events, not a player
// online: the 運営チャット's call and the developer called).
class SocketHub {
  constructor(ctx) { this.ctx = ctx; }

  static isOpen(ws) { return ws.readyState === 1; }

  valid(ws) {
    if (!SocketHub.isOpen(ws)) return false;
    if (this.authorize && !this.authorize(ws.deserializeAttachment())) {
      try { ws.close(1000, 'Authentication settings changed'); } catch { /* closing */ }
      return false;
    }
    return true;
  }

  sockets(userId) { return this.ctx.getWebSockets(`u:${userId}`).filter(ws => this.valid(ws)); }

  sendOps(userId, event, data) {
    const text = JSON.stringify({ event, data });
    for (const ws of this.ctx.getWebSockets(`o:${userId}`)) this.write(ws, text, terminalEvent(event, data));
  }

  opsOnline(userId) { return this.ctx.getWebSockets(`o:${userId}`).some(ws => this.valid(ws)); }

  dropOps(userId) {
    for (const ws of this.ctx.getWebSockets(`o:${userId}`)) {
      try { ws.close(1000, 'Authentication settings changed'); } catch { /* already closed */ }
    }
  }

  dropUser(userId) {
    this.dropOps(userId);
    for (const ws of this.sockets(userId)) {
      try { ws.close(1000, 'Authentication settings changed'); } catch { /* already closed */ }
    }
  }

  dropSession(userId, hash) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a?.u === userId && (!a.s || a.s === hash)) {
        try { ws.close(1000, 'Logged out'); } catch { /* closing */ }
      }
    }
  }

  write(ws, text, terminal = false) {
    if (!SocketHub.isOpen(ws)) return;
    if (terminal && this.authorize && !this.authorize(ws.deserializeAttachment())) {
      try { ws.send(text); ws.close(1000, 'Authentication settings changed'); } catch { /* closing */ }
      return;
    }
    if (!this.valid(ws)) return;
    try { ws.send(text); } catch { /* closing */ }
  }

  send(userId, event, data) {
    const text = JSON.stringify({ event, data });
    for (const ws of this.ctx.getWebSockets(`u:${userId}`)) this.write(ws, text, terminalEvent(event, data));
  }

  broadcast(event, data, filter) {
    const text = JSON.stringify({ event, data });
    for (const ws of this.ctx.getWebSockets()) {
      if (!this.valid(ws)) continue;
      const a = ws.deserializeAttachment();
      if (!a || a.ops || (filter && !filter(a.u))) continue;
      this.write(ws, text);
    }
  }

  isOnline(userId) { return this.sockets(userId).length > 0; }

  onlineCount() {
    const users = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      if (!this.valid(ws)) continue;
      const a = ws.deserializeAttachment();
      if (a && !a.ops) users.add(a.u);
    }
    return users.size;
  }
}

// What Cloudflare's edge knows of the connection (request.cf), for the operators' log when a login
// is got wrong (server/core/reqinfo.js). Plain values only; what the plan does not give is not there.
const CF_FIELDS = ['country', 'region', 'regionCode', 'city', 'postalCode', 'timezone', 'latitude', 'longitude', 'continent', 'metroCode', 'isEUCountry', 'asn', 'asOrganization',
  'colo', 'httpProtocol', 'tlsVersion', 'tlsCipher', 'clientTcpRtt', 'clientQuicRtt', 'verifiedBotCategory', 'requestPriority', 'edgeRequestKeepAliveStatus'];
function edgeOf(cf) {
  if (!cf || typeof cf !== 'object') return null;
  const out = {};
  for (const k of CF_FIELDS) if (cf[k] !== undefined && cf[k] !== null && typeof cf[k] !== 'object') out[k] = cf[k];
  const bm = cf.botManagement;
  if (bm && typeof bm === 'object') {
    out.botManagement = {};
    for (const k of ['score', 'verifiedBot', 'staticResource', 'corporateProxy', 'ja3Hash', 'ja4']) if (bm[k] !== undefined && bm[k] !== null && typeof bm[k] !== 'object') out.botManagement[k] = bm[k];
  }
  return out;
}

// The host-independent request the core API understands.
function coreRequest(request, url) {
  return {
    method: request.method,
    path: url.pathname,
    query: url.searchParams,
    host: url.host,
    ip: request.headers.get('cf-connecting-ip') || '',
    // (`scheme`: how the edge was reached, for the secure channel's word on whether the connection was encrypted: server/core/seccomm.js)
    meta: { cf: edgeOf(request.cf), scheme: url.protocol },
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
          stele: env.OPLOG || env.VAULT ? bucketStele(env.OPLOG || env.VAULT) : null,
          // the emergency stop: every live connection closes
          stop: () => { for (const ws of ctx.getWebSockets()) { try { ws.close(1012, 'emergency'); } catch { /* closing */ } } },
          // the housekeeping sooner (a backup due)
          reschedule: (at) => this.housekeepSoon(at)
        }
      });
      this.live.authorize = a => this.api.liveValid(a);
      // the housekeeping's time (the alarm also rings in between to stay awake;
      // an alarm from before that was for the housekeeping)
      const alarm = await ctx.storage.getAlarm();
      this.housekeepAt = Math.min((await ctx.storage.get('housekeep_at')) || alarm || Date.now() + HOUSEKEEPING_EVERY, this.api.lineFeed.nextDue());
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
      const decision = this.api.filtered(coreRequest(request, url), note || {});
      return json(200, decision || {});
    }
    const out = await this.api.handle(coreRequest(request, url));
    // (a script or a file, not JSON: server/core/raw.js)
    if (out.raw) {
      const body = typeof out.raw.body === 'string' ? new TextEncoder().encode(out.raw.body) : out.raw.body;
      this.api.sent(body.byteLength, url.pathname);
      return new Response(body, { status: out.status, headers: { ...JSON_HEADERS, 'Content-Type': out.raw.type, ...out.raw.headers } });
    }
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
      const auth = this.api.consumeOpsTicket(url.searchParams.get('ops'), true);
      if (!auth) return json(401, { error: { code: 'ticket', message: '接続の有効期限が切れました' } });
      const [c, sv] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(sv, [`o:${auth.u}`]);
      sv.serializeAttachment({ ...auth, c: connectionOf(request, url) });
      sv.send(JSON.stringify({ event: 'hello', data: { ops: true } }));
      return new Response(null, { status: 101, webSocket: c });
    }
    const auth = this.api.consumeTicket(url.searchParams.get('ticket'), true);
    if (!auth) return json(401, { error: { code: 'ticket', message: '接続の有効期限が切れました' } });
    const userId = auth.u;
    const first = !this.live.isOnline(userId);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [`u:${userId}`]);
    // (what it was opened from: the address and the browser of the API's requests on it, server/core/socketapi.js)
    server.serializeAttachment({ ...auth, c: connectionOf(request, url) });
    // (`held`: what the page already has of it: server/core/api.js hello)
    server.send(JSON.stringify({ event: 'hello', data: this.api.hello(userId, url.searchParams.get('held')) }));
    if (first) this.api.presence(userId, true);
    return new Response(null, { status: 101, webSocket: client });
  }

  // On a connection: the API's requests (server/core/socketapi.js: answered as over HTTP, from both the game and the operator site) and,
  // from the game, voice chat signalling ({ op: "call", ... }), 入力中 ({ op: "typing" }), the activity beat of the time quests
  // ({ op: "beat" }) and, only while an operator watches, the sealed frames of the game's state ({ op: "view" }).
  async webSocketMessage(ws, message) {
    if (!this.live.valid(ws)) return;
    if (message === 'ping') { this.live.write(ws, 'pong'); return; }
    if (typeof message !== 'string' || message.length > 32 * 1024) return;
    const a = ws.deserializeAttachment();
    if (!a) return;
    let body;
    try { body = JSON.parse(message); } catch { return; }
    if (!body || typeof body !== 'object') return;
    if (body.op === 'api') {
      this.touch();
      const text = await answerOnSocket(this.api, a.c || {}, body);
      if (text) this.live.write(ws, text);
      return;
    }
    // (the operator site's connection asks nothing else)
    if (a.ops) return;
    // (a beat from a game nobody touched for a minute is not someone playing; nor is a
    // frame of the operators' screen view)
    if (body.op !== 'sight' && body.op !== 'view' && !(body.op === 'beat' && Number(body.idle) > 60000)) this.touch();
    if (body.op === 'call') this.api.socketCall(a.u, body);
    else if (body.op === 'typing') this.api.socketTyping(a.u, body);
    else if (body.op === 'beat') this.api.socketBeat(a.u, body);
    else if (body.op === 'sight') this.api.socketSight(a.u, body);
    else if (body.op === 'view') this.api.socketView(a.u, body);
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
