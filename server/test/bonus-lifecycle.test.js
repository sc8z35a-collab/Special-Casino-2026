import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../../js/ui/bonus.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function scene() {
  let ready = true, modal = false, seq = 0, now = 100000;
  const timers = [], requests = [], applied = [], effects = [], opened = [], events = {}, listeners = {}, nodes = new Map();
  const node = key => { if (!nodes.has(key)) nodes.set(key, { style: {}, textContent: '', addEventListener() {} }); return nodes.get(key); };
  const BR = {
    util: { $: node, $$: () => [], fmt: String }, SOCIAL_IMG: {},
    api: { online: true, hasToken: () => true, loginBonus() {
      let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
      requests.push({ resolve, reject }); return promise;
    } },
    launch: { done: () => ready, maintenance: () => false }, account: { isOpen: () => false },
    kit: { registerModal() {}, sfx() {}, showModal: id => { modal = true; opened.push(id); }, closeModal: () => { modal = false; }, isOpen: () => modal },
    social: { setMe: me => applied.push(me) }, app: { renderWallet: () => effects.push('wallet') },
    juice: { reward: () => effects.push('reward'), rain: () => effects.push('rain'), payout: (type, amount) => effects.push(amount) },
    live: { on: (name, fn) => { events[name] = fn; } }
  };
  const document = { hidden: false, addEventListener: (name, fn) => { listeners[name] = fn; } };
  vm.runInNewContext(source, { window: { BR }, document, Date: { now: () => now }, Promise,
    setTimeout: (fn, ms) => { const id = ++seq, timer = { id, ms, fn: () => { timer.ran = true; fn(); } }; timers.push(timer); return id; },
    clearTimeout: id => { const timer = timers.find(t => t.id === id); if (timer) timer.canceled = true; }
  });
  BR.bonus.init();
  return { BR, timers, requests, applied, effects, opened, node, events,
    ready: value => { ready = value; }, visible: () => listeners.visibilitychange(),
    reset: () => { if (BR.bonus.reset) BR.bonus.reset(); else modal = false; },
    due: () => { BR.bonus.schedule(now - 1); return timers.at(-1); },
    bonus: { day: 1, amount: 100, next: now + 86400000 }
  };
}

test('a login board queued behind setup cannot open after logout into another account', () => {
  const s = scene(); s.ready(false); s.BR.bonus.show(s.bonus); const retry = s.timers.at(-1);
  s.reset(); s.ready(true); retry.fn();
  assert.deepEqual(s.opened, []); assert.equal(s.BR.bonus.busy(), false);
});

test('a retired reward animation cannot alter the wallet or a new account board', () => {
  const s = scene(); s.BR.bonus.show(s.bonus); const oldEffect = s.timers.at(-1);
  s.reset(); s.BR.bonus.show({ ...s.bonus, amount: 200 }); const newEffect = s.timers.at(-1);
  oldEffect.fn(); assert.deepEqual(s.effects, []);
  newEffect.fn(); assert.deepEqual(s.effects, ['reward', 'rain', 'wallet', 200]);
});

test('a delayed daily-bonus response cannot apply the previous account after reset', async () => {
  const s = scene(); s.due().fn(); assert.equal(s.requests.length, 1); s.reset();
  s.requests[0].resolve({ me: { id: 1 }, loginBonus: s.bonus, next: s.bonus.next }); await flush();
  assert.deepEqual(s.applied, []); assert.deepEqual(s.opened, []);
  assert.equal(s.timers.filter(t => !t.canceled && !t.ran).length, 0);
});

test('visibility and deadline checks share one request and allow a retry after failure', async () => {
  const s = scene(); s.due().fn(); s.visible(); s.visible();
  assert.equal(s.requests.length, 1);
  s.requests[0].reject(new Error('offline')); await flush(); s.visible();
  assert.equal(s.requests.length, 2);
});

test('a canceled next-day timer cannot request a reward for a later login', () => {
  const s = scene(), timer = s.due(); s.reset(); timer.fn();
  assert.equal(s.requests.length, 0);
});

test('normal live login and daily renewal still display and update the correct reward', async () => {
  const s = scene(); s.events.hello({ loginBonus: s.bonus, loginReset: s.bonus.next });
  assert.deepEqual(s.opened, ['bonus']); assert.match(s.node('#bonus-text').textContent, /100/);
  s.timers.find(t => t.ms === 650).fn(); assert.ok(s.effects.includes(100));
  s.due().fn(); s.requests[0].resolve({ me: { id: 2 }, loginBonus: { ...s.bonus, day: 2, amount: 300 }, next: s.bonus.next });
  await flush(); assert.equal(s.applied[0].id, 2); assert.match(s.node('#bonus-text').textContent, /300/);
});
