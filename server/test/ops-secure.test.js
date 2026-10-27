import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../ops/secure.js', import.meta.url), 'utf8');
const identity = { secure: true, fp: 'server-key', problems: [] };
const posture = { transport: { tls: 'TLSv1.3' }, identity: { fp: identity.fp } };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function scene(channels) {
  const timers = new Map(), events = {}, shown = [];
  let serial = 0, created = 0;
  const context = {
    document: { hidden: false, addEventListener(name, fn) { events[name] = fn; } },
    addEventListener(name, fn) { events[name] = fn; },
    OpsDesktop: { secure(text) { shown.push(text); } }, OpsExt: { io: () => ({ request() {} }) },
    BR: { secChannel: { available: true, create() { return channels[created++]; } } },
    setTimeout(fn, delay) { timers.set(++serial, { fn, delay, once: true }); return serial; },
    setInterval(fn, delay) { timers.set(++serial, { fn, delay }); return serial; },
    clearTimeout(id) { timers.delete(id); }, clearInterval(id) { timers.delete(id); },
    Date: { now: () => 1000000 }
  };
  context.window = context; vm.runInNewContext(source, context);
  return { api: context.OpsSecure, document: context.document, events, shown, timers, created: () => created,
    start() { const initial = [...timers].find(([, t]) => t.delay === 600); assert.ok(initial); timers.delete(initial[0]); initial[1].fn(); } };
}
function channel(open = Promise.resolve(identity), result = posture) {
  return { calls: 0, drops: 0, open: () => open, call() { this.calls++; return Promise.resolve(result); }, drop() { this.drops++; } };
}

test('secure checks stop after logout, including the delayed initial check and browser resume events', async () => {
  const c = channel(), s = scene([c]);
  s.api.session(true); s.api.session(false);
  assert.equal(s.timers.size, 0, 'logout cancels both timers');
  s.events.online(); s.events.visibilitychange(); s.api.look(); await settle();
  assert.equal(s.created(), 0, 'signed-out events must not open a channel');
  s.api.session(true); s.start(); await settle(); assert.equal(c.calls, 1);
  assert.match(s.shown.at(-1), /確認済み/);
  s.api.session(false); s.events.online(); s.events.visibilitychange(); s.api.look(); await settle();
  assert.equal(c.calls, 1); assert.equal(c.drops, 1); assert.equal(s.shown.at(-1), '');
});

test('a previous session cannot query, drop or unlock a new session channel when it finishes late', async () => {
  for (const failed of [false, true]) {
    const oldOpen = deferred(), newOpen = deferred(), old = channel(oldOpen.promise), current = channel(newOpen.promise), s = scene([old, current]);
    s.api.session(true); s.start(); s.api.session(false); s.api.session(true); s.start();
    if (failed) oldOpen.reject(new Error('old channel disconnected')); else oldOpen.resolve(identity);
    await settle();
    assert.equal(old.calls, 0); assert.equal(current.drops, 0);
    s.events.online(); await settle(); assert.equal(s.created(), 2, 'the new in-flight check stays busy');
    newOpen.resolve(identity); await settle();
    assert.equal(current.calls, 1); assert.match(s.shown.at(-1), /確認済み/);
  }
});

test('hidden pages defer checks until visible and insecure or mismatched answers never show a verified lock', async () => {
  for (const [info, answer, expectedCalls] of [
    [{ ...identity, secure: false, problems: ['identity'] }, posture, 0],
    [identity, { ...posture, transport: {} }, 1],
    [identity, { ...posture, identity: { fp: 'other-key' } }, 1]
  ]) {
    const c = channel(Promise.resolve(info), answer), s = scene([c]); s.document.hidden = true;
    s.api.session(true); s.start(); s.events.online(); await settle(); assert.equal(s.created(), 0);
    s.document.hidden = false; s.events.visibilitychange(); s.events.online(); await settle();
    assert.equal(c.calls, expectedCalls); assert.equal(c.drops, 1); assert.equal(s.shown.at(-1), '');
    assert.equal(s.shown.some((text) => text.includes('確認済み')), false);
  }
});
