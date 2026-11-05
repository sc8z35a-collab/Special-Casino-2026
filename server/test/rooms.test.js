// 人の部屋 (server/core/npc-brain.js, npc-room.js, npc-rooms.js; docs/npc-rooms-plan.md): each person's mind of some
// 33KB in a room of its own — memories, what each thing brought them, their decisions reckoned at night, their own
// rules —, told of their body each minute and answering with what they mean to do, done by the engine (the 300's AI
// first); opened at the people's hours' start and closed at their end, profiles kept; no money ever crossing: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as brain from '../core/npc-brain.js';
import { createRoom, memoryStore } from '../core/npc-room.js';
import * as rooms from '../core/npc-rooms.js';
import { seeded } from '../core/npc-rand.js';
import { FL } from '../core/npc-pop.js';
import { NPC, RULES } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0);
const body = (o) => { const p = new Float32Array(brain.K); p[brain.P_.gen] = 1; p[brain.P_.age] = 35; p[brain.P_.salary] = 400; p[brain.P_.cash] = 500; p[brain.P_.net] = 500; p[brain.P_.mood] = 150; p[brain.P_.stress] = 60; for (let k = 0; k < 9; k++) p[brain.P_.needs + k] = 120; for (const [k, v] of Object.entries(o || {})) p[brain.P_[k]] = v; return p; };

test('a mind: some 33KB; it remembers, chooses its plans and a big thing by looking ahead, reckons at night, makes its own rules; kept and read back the same', () => {
  assert.ok(brain.BYTES > 30000 && brain.BYTES < 40000, String(brain.BYTES));
  const B = brain.alloc(3), tr = new Uint8Array(brain.TRAITS).fill(128);
  brain.reset(B, 0, 1, 100, tr);
  brain.perceive(B, 0, body(), [[5, 150, 0], [1, 200, 0]], { day: 100, off: false, cpi: 1, moves: [0.01, 0, 0, 0] });
  assert.equal(brain.memories(B, 0, 5)[0].kind, 1);
  const x = brain.think(B, 0, body({ needs: 10 }), { day: 100, off: false, cpi: 1, moves: [0.01, 0, 0, 0] }, 5000, 256);
  assert.ok(x && x.plans.length >= 1 && x.view.length === 4);
  // (the night: a decision that cost them, reckoned again and again, becomes a rule against it in such a moment)
  for (let d = 0; d < 6; d++) { brain.think(B, 0, body({ needs: 10 }), { day: 101 + d, off: false, cpi: 1, moves: [] }, 6000 + d, 64); brain.reflect(B, 0, body({ net: 500 - 300 * (d + 1), mood: 40 }), 102 + d); }
  const pf = brain.profile(B, 0);
  assert.ok(pf.memories >= 2 && pf.decisions.length >= 1 && pf.learnt.length >= 1);
  assert.ok(pf.rules.length >= 1, JSON.stringify(pf));
  const rows = Array.from(brain.packRows(B)), C = brain.unpack(brain.alloc(3), rows);
  for (const k of ['val', 'mem', 'dec', 'rule']) assert.deepEqual(Array.from(C[k]), Array.from(B[k]));
});

test('a room: opened with its people\'s minds (new lives made anew), a minute\'s intents, closed with their profiles and kept; opened again as it was', () => {
  const store = memoryStore(), n = 12, R = createRoom({ id: 0, n, store });
  const gens = new Uint16Array(n).fill(1), traits = new Uint8Array(n * brain.TRAITS).fill(140);
  assert.equal(R.open({ day: 200, gens, traits }).fresh, n);
  const b = new Float32Array(n * brain.K);
  for (let s = 0; s < n; s++) b.set(body({ needs: 20 }), s * brain.K);
  const out = R.tick({ minute: 1000, body: b, events: [[3, 5, 150, 0]], g: { day: 200, off: true, cpi: 1, moves: [0, 0, 0, 0] } });
  assert.ok(out.intents.length > 0 && out.intents.every((x) => x.length === 12));
  const c = R.close({ day: 200, body: b });
  assert.equal(c.profiles.length, n);
  assert.ok(!R.isOpen && store.rows().length >= 1);
  const R2 = createRoom({ id: 0, n, store });
  assert.equal(R2.open({ day: 201, gens, traits }).fresh, 0, 'the same minds read back');
  gens[2] = 2;
  const R3 = createRoom({ id: 0, n, store });
  assert.equal(R3.open({ day: 201, gens, traits }).fresh, 1, 'a new life: a new mind');
});

function country(n = 1000) {
  const key = Buffer.alloc(32, 41), launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  return { w, W, ctx: { corp: w, stockPrice: () => 10000, carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {} } };
}

test('the main room\'s side: fifteen rooms opened, a minute\'s minds done by the engine (the 300\'s own AI first), closed at the hours\' end with the profiles kept — and not a $ moved by it', async () => {
  const c = country(1000), W = c.W;
  const t = rooms.localTransport(() => memoryStore()), kept = [];
  let hours = [0, 1440];
  const host = rooms.createHost({ transport: t, get: () => W, tx: (f) => f(), save: () => {}, ctx: () => c.ctx, seeded, hours: () => hours, profiles: (rows) => kept.push(...rows) });
  // (one of the 300 whose AI chose today: theirs stands)
  const ai = Array.from({ length: W.P.n }, (_, i) => i).find((i) => W.P.flags[i] & FL.elite);
  W.eliteAi = { next: {}, last: { [ai]: { day: W.day, gen: W.P.gen[ai], plans: [4] } }, asked: 0, answered: 0, days: {} };
  W.P.plan[ai * 2] = 4;
  const before = npc.moneyOf(W, c.w);
  const now = Date.UTC(2026, 10, 2, 9, 0, 0);
  await host.step(now);
  assert.ok(W.rooms.open);
  assert.equal(t.rooms.filter(Boolean).length, rooms.COUNT);
  const sizes = Array.from({ length: rooms.COUNT }, (_, r) => rooms.sizeOf(W, r));
  assert.equal(sizes.slice(0, 5).reduce((a, b) => a + b, 0), W.P.n);
  assert.equal(sizes.slice(5).reduce((a, b) => a + b, 0), W.AP.n);
  const done = await host.step(now + 60000);
  assert.ok(done > 0, 'minds done');
  assert.equal(W.P.plan[ai * 2], 4, 'the AI first');
  // (borrowing and paying back move cash and debt alike, orders money only when they fill: the ledger the same)
  assert.equal(npc.moneyOf(W, c.w), before);
  hours = [0, 1];
  await host.step(now + 120000);
  assert.equal(W.rooms.open, false);
  assert.ok(kept.length === W.P.n + W.AP.n && kept.some(([id]) => id.startsWith('v:')) && kept.some(([id]) => id.startsWith('a:')));
  assert.ok(W.rooms.seconds > 0 && W.rooms.projected >= 0);
});

test('what the rooms cost: fifteen of them five hours a day, the month\'s included part first; the AI the rest of ¥1,450', () => {
  const host = rooms.createHost({ transport: null, get: () => null, tx: () => {}, save: () => {}, ctx: () => null, seeded, hours: () => [0, 0], profiles: () => {} });
  const month = 5 * 3600 * 31;
  const yen = host.yenOf(month);
  assert.ok(yen > 1300 && yen < 1450, String(yen));
});
