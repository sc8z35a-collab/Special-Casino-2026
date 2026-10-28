import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code = name => fs.readFileSync(new URL('../../js/net/' + name + '.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function liveScene(mode = 'ws') {
  const tickets = [], sockets = [], events = [], timers = new Map(); let seq = 0;
  class Socket {
    constructor(url) { this.url = url; this.readyState = 1; sockets.push(this); this.listeners = {}; }
    send() {} close() { this.closed = true; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
  }
  const ctx = { location: { protocol: 'https:', host: 'example.invalid' }, document: { addEventListener() {} },
    WebSocket: Socket, EventSource: Socket, setTimeout: fn => { timers.set(++seq, fn); return seq; }, clearTimeout: id => timers.delete(id), console };
  ctx.window = ctx; ctx.addEventListener = () => {};
  ctx.BR = { api: { liveMode: mode, hasToken: () => true, heldParam: () => '', fromHeld: x => x,
    ticket: () => new Promise((resolve, reject) => tickets.push({ resolve, reject })) },
    wire: () => ({ reply: () => false, drop() {}, call() {} }), keepAlive: () => ({ sent() {}, received() {}, failed() {}, stop() {} }) };
  vm.runInNewContext(code('live'), ctx); ctx.BR.live.on('msg', x => events.push(x));
  return { live: ctx.BR.live, tickets, sockets, events, timers,
    message(socket, event, data) { if (mode === 'ws') socket.onmessage?.({ data: JSON.stringify({ event, data }) }); else socket.listeners[event]?.({ data: JSON.stringify(data) }); } };
}

test('an abandoned ticket request cannot block or open a connection for the next login', async () => {
  const s = liveScene(); s.live.connect(); s.live.close(); s.live.connect();
  assert.equal(s.tickets.length, 2, 'the new login must not wait for the old ticket');
  s.tickets[1].resolve({ ticket: 'new-login' }); await flush();
  s.tickets[0].resolve({ ticket: 'old-login' }); await flush();
  assert.equal(s.sockets.length, 1); assert.match(s.sockets[0].url, /new-login/);
});

test('closed WebSocket and SSE callbacks cannot deliver private events into a new login', async () => {
  for (const mode of ['ws', 'sse']) {
    const s = liveScene(mode); s.live.connect(); s.tickets[0].resolve({ ticket: 'old-login' }); await flush();
    const old = s.sockets[0]; const oldMessage = mode === 'ws' ? old.onmessage : old.listeners.msg;
    const oldError = mode === 'ws' ? old.onclose : old.onerror;
    s.live.close(); s.live.connect(); s.tickets[1].resolve({ ticket: 'new-login' }); await flush();
    s.message(s.sockets[1], 'hello', {});
    oldMessage({ data: JSON.stringify(mode === 'ws' ? { event: 'msg', data: { text: 'old private message' } } : { text: 'old private message' }) });
    oldError();
    assert.deepEqual(s.events, [], mode); assert.equal(s.live.isConnected(), true, mode);
    assert.equal(s.sockets[1].closed, undefined, mode);
  }
});

function apiScene({ stored = 'old-token', indexedDB } = {}) {
  const storage = new Map(stored ? [['blockbuster-reels/auth', stored]] : []), requests = [], merged = [];
  const ctx = { document: { querySelector: () => ({ getAttribute: k => k === 'content' ? 'online' : 'ws' }) }, location: { protocol: 'https:' }, indexedDB,
    localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    fetch: () => new Promise(resolve => requests.push(resolve)) };
  ctx.window = ctx; ctx.BR = { live: { call: () => null }, held: { param: () => '', merge: x => { merged.push(x); return x; } } };
  vm.runInNewContext(code('api'), ctx);
  return { api: ctx.BR.api, storage, requests, merged };
}

test('a late IndexedDB restore cannot undo an explicit logout', async () => {
  const opens = [], indexedDB = { open: () => { const req = {}; opens.push(req); return req; } };
  const s = apiScene({ stored: null, indexedDB }); s.api.setToken(null);
  const get = {}; opens[0].result = { close() {}, transaction: () => ({ objectStore: () => ({ get: () => get }) }) };
  opens[0].onsuccess(); await flush(); get.result = 'abandoned-session'; get.onsuccess(); await s.api.restored;
  assert.equal(s.api.hasToken(), false); assert.equal(s.storage.get('blockbuster-reels/auth'), undefined);
});

test('responses for an old account cannot restore its profile cache or ban a different account', async () => {
  for (const status of [200, 403]) {
    const s = apiScene(), banned = []; s.api.on('banned', e => banned.push(e));
    const pending = s.api.me(); s.api.setToken('new-token');
    s.requests[0]({ status, json: async () => status === 200 ? { me: { id: 1 }, revs: { me: 'old' } } : { error: { code: 'banned' } } });
    await assert.rejects(pending, e => e.code === 'session_changed');
    assert.equal(s.merged.length, 0); assert.equal(banned.length, 0);
  }
});
