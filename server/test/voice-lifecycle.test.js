import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../js/net/call.js', import.meta.url), 'utf8');
async function flush() { for (let i = 0; i < 18; i++) await Promise.resolve(); }
function scene(AudioContext) {
  const nodes = new Map(), peers = [], signals = [], notices = [], events = {}, timers = new Map();
  let clock = 1000000, sequence = 0, resolveMic, rejectMic;
  class Element extends EventTarget {
    constructor() { super(); this.hidden = false; this.dataset = {}; this.children = []; this.style = {}; this.classList = { add() {}, toggle() {} }; this.volume = 1; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    removeChild(child) { this.children = this.children.filter(c => c !== child); child.parentNode = null; }
    setAttribute() {}
    querySelector(selector) { return selector.startsWith('[data-key=') ? this.children.find(n => n.dataset.key === selector.match(/"([^"]+)"/)[1]) || null : new Element(); }
    play() { return Promise.resolve(); }
    set textContent(value) { this.children = []; this.text = value; }
    get textContent() { return this.text || ''; }
  }
  const node = selector => {
    if (selector.startsWith('#call-audios ')) return node('#call-audios').querySelector(selector.slice(13));
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  class Peer {
    constructor() { this.connectionState = 'new'; peers.push(this); }
    addTransceiver() { return { sender: { replaceTrack: () => Promise.resolve() } }; }
    createOffer() { return new Promise(() => {}); }
    close() { this.connectionState = 'closed'; }
  }
  const BR = { util: { $: node }, kit: { el: () => new Element(), avatarEl: () => new Element(), sfx() {}, toast: (...args) => notices.push(args) },
    api: { online: true, iceServers: async () => ({ iceServers: [] }) }, social: { me: () => ({ id: 1 }) },
    live: { on: (name, fn) => { events[name] = fn; }, send: value => { signals.push(value); return true; } },
    sfx: { duck() {}, callLevel: () => 100 }, VIP: { boost: () => 0, tier: () => 0, kbps: () => 64 }, activity: { poke() {} } };
  const context = { window: { BR, RTCPeerConnection: Peer, AudioContext, addEventListener() {} }, RTCPeerConnection: Peer,
    document: { createElement: () => new Element(), addEventListener() {}, querySelectorAll: () => [] },
    navigator: { mediaDevices: { getUserMedia: () => new Promise((yes, no) => { resolveMic = yes; rejectMic = no; }) } },
    localStorage: { getItem: () => null, setItem() {} }, Date: { now: () => clock }, Promise, Uint8Array,
    setTimeout: (fn, delay) => { timers.set(++sequence, { fn, delay }); return sequence; }, clearTimeout: id => timers.delete(id),
    setInterval: () => ++sequence, clearInterval() {} };
  vm.runInNewContext(source, context); BR.call.init();
  const join = (room = 10) => BR.call.syncHub(room, [{ id: 1 }, { id: 2, name: 'peer' }]);
  async function connect() { join(); events.call({ type: 'hub', from: { id: 2 }, data: { room: 10, op: 'hello' } }); await flush(); return peers.at(-1); }
  return { call: BR.call, node, peers, signals, notices, timers, join, connect,
    hello() { events.call({ type: 'hub', from: { id: 2 }, data: { room: 10, op: 'hello' } }); },
    time: value => { clock = value; }, resolveMic: value => resolveMic(value), rejectMic: error => rejectMic(error) };
}

test('a retired peer cannot restore audio after the call has ended', async () => {
  const s = scene(), peer = await s.connect(), delayedTrack = peer.ontrack; s.call.leave();
  delayedTrack({ streams: [{}] });
  assert.equal(s.node('#call-audios').children.length, 0);
});

test('ICE events from a replaced peer are ignored while the replacement can still signal', async () => {
  const s = scene(), old = await s.connect(), delayedIce = old.onicecandidate; s.hello(); await flush();
  const current = s.peers.at(-1); assert.notEqual(current, old);
  delayedIce({ candidate: { toJSON: () => ({ candidate: 'obsolete' }) } });
  for (const [id, timer] of s.timers) if (timer.delay === 160) { s.timers.delete(id); timer.fn(); }
  assert.equal(s.signals.filter(v => v.data.op === 'signal').length, 0);
  current.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'current' }) } });
  for (const [id, timer] of s.timers) if (timer.delay === 160) { s.timers.delete(id); timer.fn(); }
  assert.equal(s.signals.filter(v => v.data.op === 'signal').length, 1);
  assert.equal(s.signals.at(-1).data.candidates[0].candidate, 'current');
});

test('the two-hour deadline still ends its call after the device wall clock moves backwards', () => {
  const s = scene(); s.join(); const deadline = [...s.timers.values()].find(t => t.delay === 7200000);
  s.time(-86400000); deadline.fn(); assert.equal(s.call.active(), false); assert.equal(s.call.paused(), true);
});

test('a retired call deadline cannot end a replacement call after a wall-clock jump', () => {
  const s = scene(); s.join(); const old = [...s.timers.values()].find(t => t.delay === 7200000);
  s.call.leave(); s.join(20); s.time(86400000); old.fn();
  assert.equal(s.call.active(), true); assert.equal(s.call.paused(), false);
});

test('a microphone denial from an ended call cannot display errors in a replacement call', async () => {
  const s = scene(); s.join(); const pending = s.call.setMic(true); s.call.leave(); s.join(20);
  s.rejectMic({ name: 'NotAllowedError' }); await pending;
  assert.equal(s.call.mic(), false); assert.deepEqual(s.notices, []);
});

test('microphone tracks granted after leaving are stopped without enabling a replacement call', async () => {
  const s = scene(); let stopped = 0; s.join(); const pending = s.call.setMic(true); s.call.leave(); s.join(20);
  s.resolveMic({ getTracks: () => [{ stop() { stopped++; } }] }); await pending;
  assert.equal(stopped, 1); assert.equal(s.call.mic(), false);
});

test('optional voice-meter setup failure closes its audio context without ending the microphone', async () => {
  let closed = 0;
  class Meter { createAnalyser() { throw new Error('device disconnected'); } close() { closed++; } }
  const s = scene(Meter); s.join(); const pending = s.call.setMic(true);
  s.resolveMic({ getTracks: () => [], getAudioTracks: () => [{}] }); await pending;
  assert.equal(s.call.mic(), true); assert.equal(closed, 1);
});
