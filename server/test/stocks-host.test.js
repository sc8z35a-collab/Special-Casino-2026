// 投資 on the Cloudflare Durable Object (server/cloudflare/casino.js), on a stand-in for Cloudflare as in
// awake.test.js: the 投資 screen's word ({ op: 'stocks' }) starts the second's ticks without the awake alarm (its
// ticks hold the object up by themselves), and an order waiting brings the object back within minutes to look.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const STUB = 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(STUB)}), shortCircuit: true };
  return next(spec, ctx);
}`));
globalThis.WebSocketRequestResponsePair ??= class { constructor(a, b) { this.request = a; this.response = b; } };

function fakeCtx() {
  const db = new DatabaseSync(':memory:');
  const kv = new Map(), sent = [];
  const ctx = {
    alarm: null, sockets: [], kv, sent, db,
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
    waitUntil() {}
  };
  return ctx;
}

test('the Durable Object: 投資 — the screen open ticks without the awake alarm, and a waiting order brings a look within 5 minutes', async (t) => {
  const ctx = fakeCtx();
  const { Casino } = await import('../cloudflare/casino.js');
  const o = new Casino(ctx, {});
  await ctx.ready;
  o.live.authorize = () => true;
  t.after(() => o.api.stocks.close());
  const json = async (path, body, token) => (await o.fetch(new Request('https://x' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-device': crypto.randomBytes(16).toString('hex'), ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }))).json();
  const me = await json('/api/register', { name: 'Cloud', password: 'pass1234', avatar: 'traveler-green' });
  assert.ok(me.token, JSON.stringify(me));
  const socket = { readyState: 1, send: (text) => ctx.sent.push(JSON.parse(text)), deserializeAttachment: () => ({ u: me.me.id }) };
  ctx.sockets.push(socket);

  // the screen open: the ticks start, the object is not kept up by the alarm for it
  o.activeAt = 0;
  const alarm = ctx.alarm;
  await o.webSocketMessage(socket, JSON.stringify({ op: 'stocks', on: 1 }));
  assert.equal(o.api.stocks.watching(), 1);
  assert.equal(o.activeAt, 0);
  assert.equal(ctx.alarm, alarm);
  await new Promise((r) => setTimeout(r, 2300));
  const ticks = ctx.sent.filter((m) => m.event === 'stock' && m.data.q);
  assert.ok(ticks.length >= 1, JSON.stringify(ctx.sent.slice(-3)));
  await o.webSocketMessage(socket, JSON.stringify({ op: 'stocks', on: 0 }));
  assert.equal(o.api.stocks.watching(), 0);

  // nothing waits: the market never wakes the object by itself
  assert.equal(o.api.stocksDue(), Infinity);
  // a limit order waits: the alarm within 5 minutes, and again after each look
  const r = await json('/api/stocks', null, me.token);
  const price = r.market.find((q) => q.id === 'riru').price;
  const placed = await json('/api/stocks/order', { key: 'cloud-order-1', company: 'riru', side: 'buy', type: 'limit', shares: 1, price: price - 500 }, me.token);
  assert.equal(placed.order.status, 'open', JSON.stringify(placed));
  assert.ok(ctx.alarm <= Date.now() + 5 * 60000, 'the alarm within 5 minutes');
  o.activeAt = 0;
  await o.alarm();
  assert.ok(ctx.alarm <= Date.now() + 5 * 60000 + 1000, 'after the look, again within 5 minutes');
  // cancelled (and the player gone quiet): back to the housekeeping alone
  await json('/api/stocks/cancel', { id: placed.order.id }, me.token);
  o.activeAt = 0;
  await o.alarm();
  assert.equal(ctx.alarm, o.housekeepAt);
});
