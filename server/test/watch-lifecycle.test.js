import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../js/ui/watch.js', import.meta.url), 'utf8');
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
function deferred() { let resolve, reject; return { promise: new Promise((yes, no) => { resolve = yes; reject = no; }), resolve: value => resolve(value), reject: value => reject(value) }; }
function scene() {
  const nodes = new Map(), requests = [], voices = [], snapshots = [], notices = [], errors = [], calls = [], events = {}, hooks = {};
  let user = { id: 1, name: 'Me' }, screen = 'slot', navigation = 0, busy = false, room = 0;
  class Element {
    constructor() { this.listeners = {}; this.dataset = {}; this.style = {}; this.classList = { toggle() {}, add() {}, remove() {} }; this.hidden = false; this.children = []; this.textContent = ''; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    replaceChild(child, old) { old.parentNode = null; child.parentNode = this; if (child.id) nodes.set('#' + child.id, child); }
  }
  const node = key => { if (!nodes.has(key)) nodes.set(key, new Element()); return nodes.get(key); };
  node('#watch-avatar').parentNode = new Element();
  const api = { online: true,
    watch(id, on) { const job = deferred(); requests.push({ id, on, ...job }); return job.promise; },
    voice(id, on) { const job = deferred(); voices.push({ id, on, ...job }); return job.promise; },
    watchers() { const job = deferred(); snapshots.push(job); return job.promise; }
  };
  const BR = { util: { $: node, $$: () => [], fmt: String }, CONFIG: { fruits: [] }, store: { state: { tokens: 1000 } }, api,
    kit: { el: () => new Element(), avatarEl: () => new Element(), sfx() {}, toast: message => notices.push(message), fail: error => errors.push(error),
      isOpen: () => false, registerModal() {}, closeModals() {}, showModal() {} },
    social: { me: () => user }, game: { busy: () => busy }, entry: { isOpen: () => false }, shop: { watchedCharm() {} },
    app: { watchEnter() {}, watchExit() {}, watchBalance() {} },
    call: { room: () => room, sync(id, host, voice, members, opts) { room = voice.length ? id : 0; calls.push({ id, voice: [...voice], members, mic: !!opts?.mic }); }, leave() { room = 0; } },
    screens: { show(name) { screen = name; navigation++; }, current: () => screen, request: () => ++navigation, isLatest: epoch => epoch === navigation,
      register: (name, hook) => { hooks[name] = hook; } },
    live: { on: (name, fn) => { events[name] = fn; } }
  };
  vm.runInNewContext(source, { window: { BR }, document: {}, Promise, setTimeout: () => 1, clearTimeout() {} }); BR.watch.init();
  const host = id => ({ id, name: 'Host' + id, online: true });
  const answer = id => ({ user: host(id), balance: { tokens: 123 }, members: [], voice: false, chat: [] });
  async function complete(id) { const req = requests.find(r => r.on && r.id === id && !r.done); assert.ok(req, 'watch request ' + id); req.done = true; req.resolve(answer(id)); await flush(); }
  function voice(id, on) {
    const button = { disabled: false, dataset: { voice: on ? 'on' : 'off' } }, row = { dataset: { uid: String(id) } };
    node('#hp-list').listeners.click({ target: { closest: selector => selector === '[data-voice]' ? button : row } });
  }
  return { BR, node, requests, voices, snapshots, notices, errors, calls, events, hooks, host, answer, complete, voice,
    setBusy: value => { busy = value; }, setUser: value => { user = value; } };
}

test('stopping while a watch is loading cannot enter it when the old response arrives', async () => {
  const s = scene(); s.BR.watch.start(s.host(2)); await flush(); s.BR.watch.stop(false);
  await s.complete(2); assert.equal(s.BR.watch.active(), false);
});

test('the latest selected host wins when watch responses arrive in reverse order', async () => {
  const s = scene(); s.BR.watch.start(s.host(2)); await flush(); s.BR.watch.start(s.host(3)); await flush();
  if (s.requests.some(r => r.on && r.id === 3)) { await s.complete(3); await s.complete(2); }
  else { await s.complete(2); await s.complete(3); }
  assert.equal(s.BR.watch.target().id, 3);
});

test('a watch response cannot navigate over a later screen selection', async () => {
  const s = scene(); s.BR.watch.start(s.host(2)); await flush(); s.BR.screens.show('tree'); await s.complete(2);
  assert.equal(s.BR.screens.current(), 'tree'); assert.equal(s.BR.watch.active(), false);
});

test('a watch cannot take over reels that started spinning while its request was pending', async () => {
  const s = scene(); s.BR.watch.start(s.host(2)); await flush(); s.setBusy(true); await s.complete(2);
  assert.equal(s.BR.watch.active(), false);
});

test('a friendship removal received before a watch response prevents that watch from opening', async () => {
  const s = scene(); s.BR.watch.start(s.host(2)); await flush();
  s.events.watch({ type: 'removed', user: 2 }); await s.complete(2);
  assert.equal(s.BR.watch.active(), false);
});

test('an old reconnect failure cannot stop a newly selected host', async () => {
  const s = scene(); s.BR.watch.start(s.host(2)); await flush(); await s.complete(2);
  s.events.hello({ watchers: { watchers: [], chat: [] } }); await flush();
  const retry = s.requests.find(r => r.on && r.id === 2 && !r.done);
  s.BR.watch.start(s.host(3)); await flush();
  if (s.requests.some(r => r.on && r.id === 3)) { await s.complete(3); retry.reject(Error('old connection')); await flush(); }
  else { retry.reject(Error('old connection')); await flush(); s.requests.filter(r => !r.on).forEach(r => r.resolve({ on: false })); await flush(); await s.complete(3); }
  assert.equal(s.BR.watch.target()?.id, 3);
});

test('a delayed microphone permission action cannot restart voice after hang-up', async () => {
  const s = scene(); s.events.watch({ type: 'watched', by: { id: 2, name: 'Watcher' }, on: true });
  await s.voice(2, true); s.BR.watch.endVoice(); s.voices[0].resolve({ voice: [2] }); await flush();
  assert.equal(s.calls.some(c => c.mic), false);
});

test('a delayed voice grant cannot open a microphone for a watcher who already left', async () => {
  const s = scene(); s.events.watch({ type: 'watched', by: { id: 2, name: 'Watcher' }, on: true }); await s.voice(2, true);
  s.events.watch({ type: 'watched', by: { id: 2 }, on: false }); s.voices[0].resolve({ voice: [2] }); await flush();
  assert.equal(s.calls.some(c => c.mic), false);
});

test('an older watcher snapshot cannot replace a newer reconnect snapshot', async () => {
  const s = scene(); s.events.hello({}); s.events.hello({});
  s.snapshots[1].resolve({ watchers: [{ id: 3, name: 'Latest', voice: true }], chat: [] }); await flush();
  s.snapshots[0].resolve({ watchers: [{ id: 2, name: 'Old', voice: true }], chat: [] }); await flush();
  assert.deepEqual(s.calls.at(-1).voice, [3]);
});

test('a watcher leaving during a reconnect snapshot is not restored by that old snapshot', async () => {
  const s = scene(); s.events.hello({}); s.events.watch({ type: 'watched', by: { id: 2 }, on: false });
  s.snapshots[0].resolve({ watchers: [{ id: 2, name: 'Gone', voice: true }, { id: 3, name: 'StillHere', voice: true }], chat: [] }); await flush();
  assert.deepEqual(s.calls.at(-1).voice, [3]);
});

test('ordinary host voice consent still starts the selected microphone once', async () => {
  const s = scene(); s.events.watch({ type: 'watched', by: { id: 2, name: 'Watcher' }, on: true }); await s.voice(2, true);
  s.voices[0].resolve({ voice: [2] }); await flush();
  assert.equal(s.calls.filter(c => c.mic).length, 1); assert.deepEqual(s.calls.at(-1).voice, [2]);
});

const reset = s => { s.BR.call.leave(); if (s.BR.watch.reset) s.BR.watch.reset(); else s.BR.watch.stop(true); };
test('logout removes the old account home controls even when it was not watching anyone', () => {
  const s = scene(); s.events.watch({ type: 'watched', by: { id: 2, name: 'PrivateOldFriend' }, on: true });
  reset(s); assert.equal(s.node('#watched-by').hidden, true);
});

test('an abandoned account snapshot cannot restore its old home after logout', async () => {
  const s = scene(); s.events.hello({}); reset(s); s.setUser({ id: 4, name: 'New account' });
  s.snapshots[0].resolve({ watchers: [{ id: 2, name: 'PrivateOldFriend', voice: true }], chat: [] }); await flush();
  assert.equal(s.node('#watched-by').hidden, true); assert.equal(s.calls.some(c => c.voice.includes(2)), false);
});

test('a new login can start watching while an old account request is still unresolved', async () => {
  const s = scene(); s.BR.watch.start(s.host(2)); await flush(); reset(s); s.setUser({ id: 4, name: 'New account' });
  s.BR.watch.start(s.host(3)); await flush(); assert.ok(s.requests.some(r => r.on && r.id === 3));
  await s.complete(3); await s.complete(2); assert.equal(s.BR.watch.target()?.id, 3);
});

test('a delayed voice answer cannot bring another departed peer back into the room', async () => {
  const s = scene();
  for (const id of [2, 3]) s.events.watch({ type: 'watched', by: { id, name: 'Watcher' + id }, on: true });
  await s.voice(2, true); s.events.watch({ type: 'watched', by: { id: 3 }, on: false });
  s.voices[0].resolve({ voice: [2, 3] }); await flush(); assert.deepEqual(s.calls.at(-1).voice, [2]);
});

test('a live revocation after a grant prevents its delayed reply from enabling the microphone', async () => {
  const s = scene(); s.events.watch({ type: 'watched', by: { id: 2, name: 'Watcher' }, on: true }); await s.voice(2, true);
  s.events.watch({ type: 'voice', user: 1, voice: [2] }); s.events.watch({ type: 'voice', user: 1, voice: [] });
  s.voices[0].resolve({ voice: [2] }); await flush(); assert.equal(s.calls.some(c => c.mic), false);
});

test('a live voice change during a snapshot also applies to members filled by that snapshot', async () => {
  const s = scene(); s.events.hello({}); s.events.watch({ type: 'voice', user: 1, voice: [2] });
  s.snapshots[0].resolve({ watchers: [{ id: 2, name: 'Watcher', voice: false }], chat: [] }); await flush();
  assert.deepEqual(s.calls.at(-1).voice, [2]);
});

test('hang-up before a pending grant is applied also cancels its late live consent event', async () => {
  const s = scene(); s.events.watch({ type: 'watched', by: { id: 2, name: 'Watcher' }, on: true }); await s.voice(2, true);
  s.BR.watch.endVoice(); s.events.watch({ type: 'voice', user: 1, voice: [2] });
  assert.deepEqual(s.calls.at(-1).voice, [], 'hang-up must immediately remain effective');
  s.voices[0].resolve({ voice: [2] }); await flush();
  assert.ok(s.voices.some(r => r.id === 2 && !r.on), 'the pending server grant must be revoked after it completes');
});
