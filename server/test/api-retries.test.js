import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const reply = (status, json) => ({ status, json: async () => json });
function setup(session = new Map(), auth = 'old-session-token') {
  let fetcher = async () => reply(200, {}); const calls = [], storage = new Map([['blockbuster-reels/auth', auth]]);
  const ctx = { crypto: crypto.webcrypto, location: { protocol: 'https:' }, document: { querySelector: () => ({ getAttribute: key => key === 'content' ? 'online' : 'ws' }) },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    sessionStorage: { getItem: k => session.get(k), setItem: (k, v) => session.set(k, v), removeItem: k => session.delete(k) },
    fetch: (path, options) => { const call = { path, options, body: options.body && JSON.parse(options.body) }; calls.push(call); return fetcher(call); } };
  ctx.window = ctx; ctx.BR = { live: { call: () => null, close() {}, connect() {} }, held: { param: () => '', merge: x => x } };
  vm.runInNewContext(fs.readFileSync(new URL('../../js/net/api.js', import.meta.url), 'utf8'), ctx);
  return { BR: ctx.BR, calls, storage, respond: fn => { fetcher = fn; } };
}

for (const method of ['login', 'oauthPoll']) test(`a ${method} reply started while signed out cannot replace a newer login and retires its unused session`, async () => {
  const s = setup(new Map(), null); let finish;
  s.respond(call => call.path === '/api/logout' ? Promise.resolve(reply(200, { ok: true })) : new Promise(resolve => { finish = resolve; }));
  const pending = method === 'login' ? s.BR.api.login('Former', 'pass1234') : s.BR.api.oauthPoll('former-flow');
  s.BR.api.setToken('active-new-account'); finish(reply(200, { token: 'unused-old-result', me: { id: 1 } }));
  await assert.rejects(pending, e => e.code === 'session_changed');
  assert.equal(s.storage.get('blockbuster-reels/auth'), 'active-new-account');
  assert.equal(s.calls.at(-1).path, '/api/logout'); assert.equal(s.calls.at(-1).options.headers.Authorization, 'Bearer unused-old-result');
});

test('explicit session invalidation retires a pending password result even if the token value is unchanged', async () => {
  const s = setup(); let finish;
  s.respond(call => call.path === '/api/password' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(reply(200, { ok: true })));
  const pending = s.BR.api.password('old', 'new-password'); s.BR.api.setToken('old-session-token');
  finish(reply(200, { token: 'retired-password-session' }));
  await assert.rejects(pending, e => e.code === 'session_changed');
  assert.equal(s.storage.get('blockbuster-reels/auth'), 'old-session-token');
  assert.equal(s.calls.at(-1).options.headers.Authorization, 'Bearer retired-password-session');
});

for (const type of ['spin', 'gacha']) test(`password rotation preserves the uncertain ${type} receipt and its saved reload recovery`, async () => {
  const session = new Map(), s = setup(session), api = s.BR.api;
  const draw = () => type === 'spin' ? api.spin(100) : api.gachaSpin('rare', 1, 10000000);
  s.respond(async () => { throw Error('lost committed answer'); }); await assert.rejects(draw());
  const original = s.calls[0].body;
  s.respond(async call => reply(200, call.path === '/api/password' ? { token: 'rotated-session-token' } : { result: {} }));
  await api.password('old', 'new-password');
  assert.equal(type === 'spin' ? api.pendingSpinBet() : api.pendingGacha()?.count, type === 'spin' ? 100 : 1);
  const saved = JSON.parse(session.get('blockbuster-reels/pending-' + type));
  assert.equal(saved.owner, 'rotated-session-token'.slice(-16)); assert.deepEqual(saved.body, original);
  const restored = setup(session, 'rotated-session-token');
  assert.equal(type === 'spin' ? restored.BR.api.pendingSpinBet() : restored.BR.api.pendingGacha()?.count, type === 'spin' ? 100 : 1);
  if (type === 'spin') await restored.BR.api.spin(100); else await restored.BR.api.gachaSpin('rare', 1, 10000000);
  assert.deepEqual(restored.calls.at(-1).body, original); assert.equal(session.has('blockbuster-reels/pending-' + type), false);
});

for (const type of ['spin', 'gacha']) test(`a late old-session ${type} answer cannot erase the receipt migrated during password rotation`, async () => {
  const session = new Map(), s = setup(session), api = s.BR.api; let finish;
  const draw = () => type === 'spin' ? api.spin(100) : api.gachaSpin('rare', 1, 10000000);
  s.respond(call => call.path === '/api/password' ? Promise.resolve(reply(200, { token: 'rotated-session-token' })) : new Promise(resolve => { finish = resolve; }));
  const pending = draw(), original = s.calls[0].body;
  await api.password('old', 'new-password'); finish(reply(200, { result: {} }));
  await assert.rejects(pending, e => e.code === 'session_changed');
  s.respond(async () => reply(200, { result: {} })); await draw();
  assert.deepEqual(s.calls.at(-1).body, original);
});

test('auction actions carry the auction identity while legacy calls remain compatible', async () => {
  const s = setup(); await s.BR.api.auctionBid(3, 42); await s.BR.api.auctionLeave(42);
  assert.deepEqual(s.calls[0].body, { steps: 3, id: 42 }); assert.deepEqual(s.calls[1].body, { id: 42 });
  await s.BR.api.auctionBid(1); assert.deepEqual(s.calls[2].body, { steps: 1 });
});

test('the browser reuses one immutable spin key for in-flight/lost responses and issues a fresh one after success', async () => {
  const s = setup(); s.respond(async () => { throw Error('lost response'); });
  const one = s.BR.api.spin(100), two = s.BR.api.spin(100);
  assert.equal(one, two); await assert.rejects(one, e => e.status === 0);
  const original = s.calls[0].body;
  assert.equal(s.BR.api.pendingSpinBet(), 100);
  s.respond(async () => reply(200, { result: {} }));
  await s.BR.api.spin(200);
  assert.equal(s.BR.api.pendingSpinBet(), null);
  assert.deepEqual(s.calls[1].body, original, 'an uncertain spin is recovered before starting a different bet');
  await s.BR.api.spin(200);
  assert.notEqual(s.calls[2].body.key, original.key); assert.equal(s.calls[2].body.bet, 200);
  assert.match(original.key, /^\d{13}-[a-f0-9]{32}$/);
});

test('invalid successful JSON is uncertain and preserves the spin receipt; non-JSON maintenance errors still surface', async () => {
  const s = setup();
  s.respond(async () => ({ status: 200, json: async () => { throw SyntaxError('truncated'); } }));
  await assert.rejects(s.BR.api.me(), e => e.code === 'network');
  await assert.rejects(s.BR.api.spin(100), e => e.status === 0);
  const original = s.calls.at(-1).body;
  s.respond(async () => reply(200, { result: {} })); await s.BR.api.spin(100);
  assert.deepEqual(s.calls.at(-1).body, original);
  for (const value of [null, [], 'bad JSON envelope']) {
    s.respond(async () => reply(200, value)); await assert.rejects(s.BR.api.me(), e => e.code === 'network');
  }
  s.respond(async () => ({ status: 503, json: async () => { throw SyntaxError('html'); } }));
  await assert.rejects(s.BR.api.me(), e => e.code === 'maintenance');
});

test('a lost gacha answer retries the same receipt and quote; a reload preserves uncertain game draws', async () => {
  const storage = new Map(), a = setup(storage);
  a.respond(async () => { throw Error('lost'); });
  const first = a.BR.api.gachaSpin('rare', 3, 27000000);
  assert.equal(first, a.BR.api.gachaSpin('rare', 3, 27000000)); await assert.rejects(first);
  await assert.rejects(a.BR.api.gachaSpin('secret', 1, 50000000), e => e.code === 'gacha_pending');
  const b = setup(storage);
  assert.equal(b.BR.api.pendingGacha().kind, 'rare');
  await b.BR.api.gachaSpin('rare', 3, 27000000);
  assert.deepEqual(b.calls[0].body, a.calls[0].body); assert.equal(b.BR.api.pendingGacha(), null);
  await assert.rejects(a.BR.api.spin(100));
  const c = setup(storage); assert.equal(c.BR.api.pendingSpinBet(), 100); await c.BR.api.spin(100);
  assert.deepEqual(c.calls[0].body, a.calls.at(-1).body); assert.equal(c.BR.api.pendingSpinBet(), null);
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

test('a delayed password result cannot replace another account or reconnect over its password change', async () => {
  for (const successful of [true, false]) {
    const s = setup(); let finish, connects = 0;
    s.BR.live.connect = () => connects++;
    s.respond(call => call.path === '/api/password' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(reply(200, { ok: true })));
    const change = s.BR.api.password('old', 'new-password');
    s.BR.api.setToken('another-account-token');
    finish(reply(successful ? 200 : 401, successful ? { token: 'unused-rotated-token' } : { error: { code: 'auth' } }));
    await assert.rejects(change);
    assert.equal(s.storage.get('blockbuster-reels/auth'), 'another-account-token'); assert.equal(connects, 0);
    if (successful) assert.equal(s.calls.at(-1).options.headers.Authorization, 'Bearer unused-rotated-token');
  }
});
