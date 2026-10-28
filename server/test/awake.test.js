// The Cloudflare Durable Object staying awake while the game is played
// (server/cloudflare/awake.js), next to its housekeeping alarm: the object
// runs here on a stand-in for Cloudflare (SQLite from node:sqlite, the alarm
// and storage in memory). npm test (from the repository root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { nextAlarm, monthOf, AWAKE } from '../cloudflare/awake.js';

// 'cloudflare:workers' as far as casino.js needs it
const STUB = 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(STUB)}), shortCircuit: true };
  return next(spec, ctx);
}`));
globalThis.WebSocketRequestResponsePair ??= class { constructor(a, b) { this.request = a; this.response = b; } };

function fakeCtx() {
  const db = new DatabaseSync(':memory:');
  const kv = new Map();
  const ctx = {
    alarm: null, sockets: [], kv, waits: [],
    storage: {
      sql: {
        exec(query, ...args) {
          const rows = db.prepare(query).all(...args);
          return { [Symbol.iterator]: () => rows[Symbol.iterator](), toArray: () => rows, one: () => rows[0] };
        },
        get databaseSize() { return 0; }
      },
      transactionSync(fn) {
        db.exec('BEGIN');
        try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
      },
      async get(k) { return kv.get(k); },
      async put(k, v) { kv.set(k, v); },
      async getAlarm() { return ctx.alarm; },
      async setAlarm(at) { ctx.alarm = at; }
    },
    getWebSockets: () => ctx.sockets,
    setWebSocketAutoResponse() {},
    blockConcurrencyWhile(fn) { ctx.ready = fn(); return ctx.ready; },
    waitUntil(p) { ctx.waits.push(p); }
  };
  return ctx;
}

async function object(ctx) {
  const { Casino } = await import('../cloudflare/casino.js');
  const o = new Casino(ctx, {});
  await ctx.ready;
  // These synthetic sockets test alarm scheduling, not session credentials.
  o.live.authorize = () => true;
  let ran = 0;
  const housekeeping = o.api.housekeeping;
  o.api.housekeeping = () => { ran++; return housekeeping(); };
  return { o, runs: () => ran };
}

const socket = () => ({ readyState: 1, send() {}, deserializeAttachment: () => ({ u: 1 }) });

test('the next alarm: a tick while someone plays, the housekeeping otherwise', () => {
  const now = Date.parse('2026-10-21T00:00:00Z'), housekeepAt = now + 6 * 3600000;
  const at = (o) => nextAlarm({ now, housekeepAt, sockets: 1, activeAt: now - 1000, ticks: 0, ...o });
  assert.equal(at({}), now + AWAKE.every);
  assert.equal(at({ sockets: 0 }), housekeepAt, 'nobody connected');
  assert.equal(at({ activeAt: 0 }), housekeepAt, 'nobody did anything since it woke');
  assert.equal(at({ activeAt: now - AWAKE.idle }), housekeepAt, '10 minutes untouched');
  assert.equal(at({ ticks: AWAKE.month }), housekeepAt, 'the month\'s ticks used up');
  assert.equal(at({ housekeepAt: now + 2000 }), now + 2000, 'the housekeeping first when it is sooner');
  assert.equal(monthOf(now), '2026-10');
});

test('the Durable Object: stays awake while played, keeps its housekeeping, and stops when left alone', async () => {
  const ctx = fakeCtx();
  // an object from before this version: its alarm was the housekeeping
  const before = Date.now() + 3 * 3600000;
  ctx.alarm = before;
  const { o, runs } = await object(ctx);
  assert.equal(ctx.kv.get('housekeep_at'), before, 'the old alarm is the housekeeping\'s time');
  assert.equal(ctx.alarm, before);

  // nobody connected: a request leaves the alarm alone
  await o.fetch(new Request('https://x/api/health'));
  assert.equal(ctx.alarm, before);
  // someone connected and playing: a tick soon
  ctx.sockets.push(socket());
  await o.fetch(new Request('https://x/api/health'));
  assert.ok(ctx.alarm <= Date.now() + AWAKE.every && ctx.alarm > Date.now(), 'awake');
  // the tick: no housekeeping yet, the next tick
  await o.alarm();
  assert.equal(runs(), 0);
  assert.ok(ctx.alarm <= Date.now() + AWAKE.every);
  assert.equal(o.awake.ticks, 1);
  // a beat from a game left alone is not someone playing; one with a tap is
  o.activeAt = Date.now() - AWAKE.idle - 1;
  await o.webSocketMessage(socket(), JSON.stringify({ op: 'beat', idle: 5 * 60000 }));
  await o.alarm();
  assert.equal(ctx.alarm, before, 'left alone: back to the housekeeping alone');
  await o.webSocketMessage(socket(), JSON.stringify({ op: 'beat', idle: 0 }));
  assert.ok(ctx.alarm <= Date.now() + AWAKE.every, 'playing again');

  // The hourly retention sweep is included in the host's housekeeping schedule.
  o.housekeepAt = Date.now() - 1;
  ctx.sockets.length = 0;
  await o.alarm();
  assert.equal(runs(), 1);
  assert.ok(Math.abs(ctx.kv.get('housekeep_at') - (Date.now() + 3600000)) < 60000);
  assert.equal(ctx.alarm, ctx.kv.get('housekeep_at'));
  // a backup due sooner moves both
  const soon = Date.now() + 15 * 60000;
  await o.housekeepSoon(soon);
  assert.deepEqual([ctx.kv.get('housekeep_at'), ctx.alarm], [soon, soon]);

  // a new wake-up remembers the housekeeping's time and the month's ticks
  ctx.kv.set(`awake:${monthOf(Date.now())}`, AWAKE.month);
  const { o: again } = await object(ctx);
  assert.equal(again.housekeepAt, soon);
  ctx.sockets.push(socket());
  await again.fetch(new Request('https://x/api/health'));
  assert.equal(ctx.alarm, soon, 'the month\'s ticks used up: no staying awake');
});
