import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
async function setup(cap = 128000) {
  let poll, stopped = 0, stats = [], reject = false; const values = [];
  const ctx = { window: {}, setInterval: fn => { poll = fn; return 42; }, clearInterval: id => { assert.equal(id, 42); stopped++; } };
  vm.runInNewContext(fs.readFileSync(new URL('../../js/net/voice-quality.js', import.meta.url), 'utf8'), ctx);
  const pc = { connectionState: 'connected', getStats: async () => { if (reject) throw Error('unsupported'); return new Map(stats.map((s, i) => [i, s])); } };
  const sender = { getParameters: () => ({ encodings: [{}] }), setParameters: async p => { values.push(p.encodings[0].maxBitrate); } };
  const control = ctx.window.BR.adaptVoice(pc, sender, cap, true);
  const flush = () => new Promise(resolve => setImmediate(resolve)); await flush();
  return { pc, control, values, stopped: () => stopped, fail: value => { reject = value; },
    async tick(loss, rtt = 0.1) { stats = loss === null ? [] : [{ type: 'remote-inbound-rtp', kind: 'audio', fractionLost: loss, roundTripTime: rtt, jitter: 0.01 }]; poll(); await flush(); } };
}

test('voice adapts downward under sustained loss and gradually returns to the original ceiling without oscillating', async () => {
  const s = await setup(); assert.equal(s.values[0], 128000);
  await s.tick(0.1); assert.equal(s.values.length, 1);
  await s.tick(0.1); assert.equal(s.values.at(-1), 89600);
  await s.tick(0.1); assert.equal(s.values.at(-1), 89600);
  for (let i = 0; i < 5; i++) await s.tick(0.9, 2);
  assert.equal(s.values.at(-1), 16000);
  for (let i = 0; i < 40; i++) await s.tick(0);
  assert.equal(s.values.at(-1), 128000); assert.ok(s.values.every(v => v >= 16000 && v <= 128000));
  s.control.setCap(32000); await new Promise(resolve => setImmediate(resolve)); assert.equal(s.values.at(-1), 32000);
  for (let i = 0; i < 10; i++) await s.tick(0); assert.equal(s.values.at(-1), 32000);
});

test('missing stats do not force a downgrade; a closed/stopped call cannot apply a delayed stats result', async () => {
  const s = await setup(510000);
  await s.tick(null); s.fail(true); await s.tick(0.9);
  assert.deepEqual(s.values, [510000]); s.fail(false);
  s.pc.connectionState = 'closed'; await s.tick(0.9); assert.equal(s.stopped(), 1);
  await s.tick(0.9); assert.deepEqual(s.values, [510000]);
});
