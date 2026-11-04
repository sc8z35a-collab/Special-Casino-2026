// アスカ国's people minute by minute (server/core/asuka.js tick): at work on a working day, a lunch out, school, the
// shops, their pleasures, home — paying what they need and buying as they go, every $ as it is spent; what they needed
// and did not go out for paid at the day's close; what moves within a day kept with every save, and back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as asuka from '../core/asuka.js';
import { NPC, RULES } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0), MIN = 60000;

test('アスカ国\'s people through the day as ヴェルノア\'s: at work and at lunch on a working day, out shopping in the evening, spending as they go; the day closed, what they needed paid all the same; the ledger never moves', () => {
  const key = Buffer.alloc(32, 41), ch = corpModel.chance(key), launch = Math.floor(START / 86400000), n = 1200;
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const ctx = { corp: w, stockPrice: () => 10000, carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  const seen = {};
  for (let d = 0; d < 6; d++) {
    const day = Math.floor(m / 1440);
    for (; m < (day + 1) * 1440; m++) {
      if (!NPC.activeAt(m * MIN, W.first)) continue;
      npc.tick(W, m, ctx);
      const j = NPC.jst(m * MIN);
      if (d >= 2 && !j.off && [750, 900, 1170].includes(j.min)) seen[j.min] = seen[j.min] || { v: asuka.liveView(W), money: asuka.moneyOf(W) };
    }
    const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
    npc.nextDay(W, day, out.ext, ctx);
    npc.ledgerDay(W, w, day);
    assert.equal(W.ledger.days[W.ledger.days.length - 1].moved, 0, `day ${d}`);
  }
  const A = W.AP, ACT = asuka.ACT;
  // a working day: lunch at 12:30, at work at 15:00, shopping and on the way home in the evening
  const at = (min, k) => seen[min].v.all[k];
  assert.ok(at(750, ACT.lunch) > at(750, ACT.work), JSON.stringify(seen[750].v.all));
  assert.ok(at(900, ACT.work) > at(900, ACT.shop));
  assert.ok(at(1170, ACT.shop) + at(1170, ACT.leisure) + at(1170, ACT.commute) > at(1170, ACT.work));
  for (const x of Object.values(seen)) assert.equal(x.v.all.reduce((a, b) => a + b, 0), A.n);
  // spending through the day: more by the evening than at noon
  assert.ok(seen[1170].v.today.living >= seen[750].v.today.living && seen[1170].v.today.bought > seen[750].v.today.bought, JSON.stringify([seen[750].v.today, seen[1170].v.today]));
  // the day closed: everyone's needs paid, what they meant to spend and did not kept; the day's record
  assert.ok(W.asuka.last && W.asuka.last.living > 0 && W.asuka.last.trips > A.n);
  assert.ok(W.asuka.today && W.asuka.today.day === W.day);
  // (what moves within a day kept with every save, and back)
  const hot = asuka.pack(A, true), all = asuka.pack(A, false);
  assert.ok(hot.reduce((x, r) => x + r.byteLength, 0) < all.reduce((x, r) => x + r.byteLength, 0));
  const B = asuka.unpack(asuka.alloc(A.n), all);
  B.cash.fill(0); B.act.fill(0);
  asuka.unpack(B, hot, true);
  assert.deepEqual([Array.from(B.cash.subarray(0, 50)), Array.from(B.act.subarray(0, 50)), Array.from(B.left.subarray(0, 50))], [Array.from(A.cash.subarray(0, 50)), Array.from(A.act.subarray(0, 50)), Array.from(A.left.subarray(0, 50))]);
  // (a country kept before its people went out: its blobs without the day's columns — nor the later ones: 消費観, and
  // 健康度 with HACHI's — still read)
  const old = asuka.pack(A, false), cut = old.reduce((x, r) => x + r.byteLength, 0) - A.n * (1 + 4 + 8 + 8 + 1 + (1 + 1 + 1 + 1 + 1 + 2));
  const flat = new Uint8Array(cut); let k = 0;
  for (const r of old) { const take = Math.min(r.byteLength, cut - k); if (take > 0) flat.set(r.subarray(0, take), k); k += take; }
  const C = asuka.unpack(asuka.alloc(A.n), [flat]);
  assert.equal(C.act[0], 0);
  assert.equal(C.cash[7], A.cash[7]);
});
