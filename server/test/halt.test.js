// 全停止 (HALT=on, server/core/halt.js): on Cloudflare nothing of the game runs — the Worker answers the API itself
// without waking the Durable Object, and the object, woken by the alarm it had, deletes it and does nothing more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const STUB = 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(STUB)}), shortCircuit: true };
  return next(spec, ctx);
}`));
globalThis.WebSocketRequestResponsePair ??= class { constructor(a, b) { this.request = a; this.response = b; } };

test('HALT: on/1/true/yes stop it, anything else (or nothing) leaves it running', async () => {
  const { isHalted, haltBody } = await import('../core/halt.js');
  for (const v of ['on', 'ON', '1', 'true', 'yes', ' on ']) assert.equal(isHalted({ HALT: v }), true, v);
  for (const v of [undefined, '', 'off', '0', 'false', 'no']) assert.equal(isHalted({ HALT: v }), false, String(v));
  assert.equal(isHalted(null), false);
  // (the game shows 緊急メンテナンス and tries again a day later: js/net/api.js, js/ui/launch.js)
  const b = haltBody(1000);
  assert.equal(b.error.code, 'maintenance');
  assert.equal(b.error.lockdown, true);
  assert.equal(b.error.until, 1000 + 24 * 3600000);
});

test('the Worker, stopped: the API answered 503 without the object, the page itself still served', async () => {
  const { default: worker } = await import('../cloudflare/worker.js');
  let woken = 0, assets = 0;
  const env = {
    HALT: 'on',
    CASINO: { idFromName: () => { woken++; return 'id'; }, get: () => { woken++; return { fetch: () => { throw new Error('woken'); } }; } },
    ASSETS: { fetch: () => { assets++; return new Response('page'); } }
  };
  for (const [method, path] of [['GET', '/api/me'], ['POST', '/api/spin'], ['GET', '/api/live']]) {
    const r = await worker.fetch(new Request('https://x' + path, { method, body: method === 'POST' ? '{}' : undefined }), env);
    assert.equal(r.status, 503, path);
    const body = await r.json();
    assert.equal(body.error.code, 'maintenance');
    assert.equal(body.error.lockdown, true);
  }
  assert.equal(woken, 0);
  assert.equal(await (await worker.fetch(new Request('https://x/index.html'), env)).text(), 'page');
  assert.equal(assets, 1);
});

test('the object, stopped: its alarm deleted at once and again when it rings, nothing opened, every request 503', async () => {
  const { Casino } = await import('../cloudflare/casino.js');
  let opened = 0;
  const ctx = {
    alarm: Date.now() + 60000,
    storage: {
      get sql() { opened++; return null; },
      async getAlarm() { return ctx.alarm; },
      async setAlarm(at) { ctx.alarm = at; },
      async deleteAlarm() { ctx.alarm = null; },
      async get() { opened++; }, async put() { opened++; }
    },
    getWebSockets: () => [],
    setWebSocketAutoResponse() { opened++; },
    blockConcurrencyWhile(fn) { ctx.ready = fn(); return ctx.ready; }
  };
  const o = new Casino(ctx, { HALT: 'on' });
  await ctx.ready;
  assert.equal(ctx.alarm, null);
  assert.equal(o.api, undefined);
  // (an alarm from before rings once more: deleted, nothing done)
  ctx.alarm = Date.now();
  await o.alarm();
  assert.equal(ctx.alarm, null);
  const r = await o.fetch(new Request('https://x/api/me'));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error.lockdown, true);
  // (a connection from before: closed)
  let closed = 0;
  await o.webSocketMessage({ close: () => { closed++; } }, 'ping');
  await o.webSocketClose({ close: () => {} }, 1000);
  assert.equal(closed, 1);
  assert.equal(opened, 0);
});

test('wrangler.jsonc: stopped now (HALT "on"), the checks still run the game (tools/worker-fixture.cjs: HALT off)', async () => {
  const fs = await import('node:fs');
  const text = fs.readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(text, /"HALT":\s*"on"/);
  assert.match(text, /"name":\s*"blockbuster-reels"/);
  assert.match(text, /"migrations":\s*\[\{\s*"tag":\s*"v1",\s*"new_sqlite_classes":\s*\["Casino"\]\s*\}\]/);
  const fixture = fs.readFileSync(new URL('../../tools/worker-fixture.cjs', import.meta.url), 'utf8');
  assert.match(fixture, /HALT: 'off', \.\.\.vars/);
});
