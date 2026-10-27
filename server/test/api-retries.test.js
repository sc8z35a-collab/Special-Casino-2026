import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const reply = (status, json) => ({ status, json: async () => json });
function setup() {
  let fetcher = async () => reply(200, {}); const calls = [], storage = new Map([['blockbuster-reels/auth', 'old-session-token']]);
  const ctx = { crypto: crypto.webcrypto, location: { protocol: 'https:' }, document: { querySelector: () => ({ getAttribute: key => key === 'content' ? 'online' : 'ws' }) },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    fetch: (path, options) => { const call = { path, options, body: options.body && JSON.parse(options.body) }; calls.push(call); return fetcher(call); } };
  ctx.window = ctx; ctx.BR = { live: { call: () => null, close() {}, connect() {} }, held: { param: () => '', merge: x => x } };
  vm.runInNewContext(fs.readFileSync(new URL('../../js/net/api.js', import.meta.url), 'utf8'), ctx);
  return { BR: ctx.BR, calls, storage, respond: fn => { fetcher = fn; } };
}

test('the browser reuses one immutable spin key for in-flight/lost responses and issues a fresh one after success', async () => {
  const s = setup(); s.respond(async () => { throw Error('lost response'); });
  const one = s.BR.api.spin(100), two = s.BR.api.spin(100);
  assert.equal(one, two); await assert.rejects(one, e => e.status === 0);
  const original = s.calls[0].body;
  s.respond(async () => reply(200, { result: {} }));
  await s.BR.api.spin(200);
  assert.deepEqual(s.calls[1].body, original, 'an uncertain spin is recovered before starting a different bet');
  await s.BR.api.spin(200);
  assert.notEqual(s.calls[2].body.key, original.key); assert.equal(s.calls[2].body.bet, 200);
  assert.match(original.key, /^\d{13}-[a-f0-9]{32}$/);
});

test('a lost live spin answer falls back to HTTP with the same key, while unrelated POSTs stay non-retryable', async () => {
  const s = setup(); let liveBody;
  s.BR.live.call = (method, path, headers, body) => { liveBody = body; return Promise.reject(Error('closed')); };
  await s.BR.api.spin(100);
  assert.deepEqual(s.calls[0].body, JSON.parse(JSON.stringify(liveBody)));
  await assert.rejects(s.BR.api.buy(1), e => e.status === 0);
  assert.equal(s.calls.length, 1);
});

test('password rotation persists the fresh token and a delayed 401 for the old token cannot log it out', async () => {
  const s = setup(); let finish, lost = 0, close = 0, connect = 0;
  s.BR.live.close = () => close++; s.BR.live.connect = () => connect++;
  s.respond(call => call.path.startsWith('/api/me') ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(reply(200, { token: 'new-session-token', recoveryCode: 'new-code' })));
  s.BR.api.on('auth-lost', () => lost++);
  const old = s.BR.api.me();
  await s.BR.api.password('old', 'new-password');
  assert.equal(s.storage.get('blockbuster-reels/auth'), 'new-session-token'); assert.equal(close, 1); assert.equal(connect, 1);
  finish(reply(401, { error: { code: 'auth' } })); await assert.rejects(old);
  assert.equal(lost, 0);
  s.respond(async () => reply(401, { error: { code: 'auth' } })); await assert.rejects(s.BR.api.me()); assert.equal(lost, 1);
});

test('an old request failing during password rotation cannot tear down the active password form', async () => {
  const s = setup(); let finishOld, finishChange, lost = 0;
  s.respond(call => new Promise(resolve => { if (call.path.startsWith('/api/me')) finishOld = resolve; else finishChange = resolve; }));
  s.BR.api.on('auth-lost', () => lost++);
  const old = s.BR.api.me(), change = s.BR.api.password('old', 'new-password');
  finishOld(reply(401, { error: { code: 'auth' } })); await assert.rejects(old);
  assert.equal(lost, 0);
  finishChange(reply(200, { token: 'rotated-session' })); await change;
  assert.equal(s.storage.get('blockbuster-reels/auth'), 'rotated-session');
});
