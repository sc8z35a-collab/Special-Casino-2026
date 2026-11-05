// 人の部屋 as a Cloudflare Worker of its own (docs/npc-rooms-plan.md 3章): one Durable Object, its people's minds
// (server/core/npc-room.js) kept in its own SQLite storage a row of up to a million bytes at a time. Fifteen of these
// Workers (npc-room-1 … npc-room-15: tools/rooms/deploy.mjs), each alone in its own isolate with its own 128MB — rooms of
// one Worker could share one. The main Worker calls it over RPC (open at 17:00, tick a minute, close at 22:00); nothing
// else can reach it (no route of its own). Between close and open it holds nothing: it sleeps and costs nothing.
import { DurableObject } from 'cloudflare:workers';
import { createRoom } from '../core/npc-room.js';

export class NpcRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS brain (part INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    this.room = null;
  }
  store() {
    const sql = this.ctx.storage.sql;
    return {
      // (read a row at a time from the cursor: never all of them beside the minds)
      get: () => (sql.exec('SELECT COUNT(*) AS n FROM brain').one().n ? (function* () { for (const r of sql.exec('SELECT data FROM brain ORDER BY part')) yield new Uint8Array(r.data); })() : null),
      put: (rows) => { let k = 0; for (const r of rows) sql.exec('INSERT OR REPLACE INTO brain (part, data) VALUES (?, ?)', k++, r); sql.exec('DELETE FROM brain WHERE part >= ?', k); }
    };
  }
  async open(msg) { this.room = createRoom({ id: msg.room, n: msg.n, store: this.store() }); return this.room.open(msg); }
  async tick(msg) { return this.room ? this.room.tick(msg) : { closed: true, intents: [] }; }
  async close(msg) { if (!this.room) return { profiles: [] }; const out = this.room.close(msg); this.room = null; return out; }
}
// (no way in from outside: only the main Worker, by its binding)
export default { fetch: () => new Response('Not found', { status: 404 }) };
