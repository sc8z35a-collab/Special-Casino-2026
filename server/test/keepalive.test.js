import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function fixture(saveData = false) {
  let now = 1000000, next = 0, lost = 0, serial = 0; const timers = new Map(), sent = [], handlers = new Map();
  const events = { addEventListener: (e, fn) => handlers.set(e, fn), removeEventListener: (e, fn) => { if (handlers.get(e) === fn) handlers.delete(e); } };
  const ctx = { document: { ...events, hidden: false }, navigator: { connection: { ...events, saveData } },
    Date: { now: () => now }, setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, at: now + ms }); return id; }, clearTimeout: id => timers.delete(id) };
  ctx.window = { ...events };
  vm.runInNewContext(fs.readFileSync(new URL('../../js/net/keepalive.js', import.meta.url), 'utf8'), ctx);
  function make() { return ctx.window.BR.keepAlive(text => { sent.push({ text, at: now }); return true; }, () => lost++); }
  let p = make();
  return { ctx, timers, sent, awake: () => handlers.get('visibilitychange')(), listeners: () => handlers.size, lost: () => lost, p, make, advance(ms) { next = now + ms;
    for (;;) { const entry = [...timers].filter(([, t]) => t.at <= next).sort((a, b) => a[1].at - b[1].at)[0]; if (!entry) break; now = entry[1].at; timers.delete(entry[0]); entry[1].fn(); } now = next;
  } };
}

test('stable pongs extend idle probes, traffic replaces them, and missing replies reconnect once', () => {
  const f = fixture();
  f.advance(25000); assert.equal(f.sent.length, 1);
  f.advance(50); f.p.received('pong');
  f.advance(29999); assert.equal(f.sent.length, 1);
  f.advance(1); assert.equal(f.sent.length, 2);
  f.advance(50); f.p.received('pong');
  for (let i = 0; i < 8; i++) { f.advance(10000); f.p.sent(); f.p.received('ordinary event'); }
  assert.equal(f.sent.length, 2, 'busy connections send no redundant probes');
  f.advance(35000); assert.equal(f.sent.length, 3);
  f.advance(10000); assert.equal(f.lost(), 1); assert.equal(f.timers.size, 0);
  f.advance(100000); assert.equal(f.lost(), 1);
});

test('resume probes a stale connection; stop releases listeners/timers and slow links stay conservative', () => {
  const f = fixture(true);
  f.advance(20000); assert.equal(f.sent.length, 0);
  f.ctx.document.hidden = false; f.awake(); assert.equal(f.sent.length, 1);
  f.p.stop(); assert.equal(f.timers.size, 0); assert.equal(f.listeners(), 0);
  const p = f.make(); f.advance(25000); f.advance(2000); p.received('pong');
  const n = f.sent.length; f.advance(19999); assert.equal(f.sent.length, n);
  f.advance(1); assert.equal(f.sent.length, n + 1, 'high RTT shortens the next interval');
  p.stop(); assert.equal(f.timers.size, 0);
});


test('an unexpectedly short idle path teaches the next connection a conservative interval', () => {
  const f = fixture();
  f.advance(25000); f.advance(50); f.p.received('pong');
  f.advance(30000); f.advance(50); f.p.received('pong');
  f.advance(28000); f.p.failed();
  const count = f.sent.length, next = f.make();
  f.advance(22999); assert.equal(f.sent.length, count);
  f.advance(1); assert.equal(f.sent.length, count + 1);
  next.stop();
});
