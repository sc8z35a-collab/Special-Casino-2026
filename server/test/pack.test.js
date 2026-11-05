// The people kept as blobs a row at a time (server/core/npc-pop.js packRows, server/core/asuka.js packRows): the rows
// the same bytes as they always were, read back from rows cut anywhere, a column added later left at 0: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as pop from '../core/npc-pop.js';
import * as asuka from '../core/asuka.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0);
function country(n = 800) {
  const key = Buffer.alloc(32, 31), launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  return npc.boot(key, START, w, { n });
}
// the columns' bytes one after another (what the rows always were)
const joined = (cols, X) => Buffer.concat(cols.map((a) => Buffer.from(X[a].buffer, X[a].byteOffset, X[a].byteLength)));
const cut = (buf, size) => { const out = []; for (let k = 0; k < buf.length; k += size) out.push(new Uint8Array(buf.subarray(k, Math.min(buf.length, k + size)))); return out; };

test('ヴェルノア\'s people: the same bytes as before, read back from rows cut anywhere, hot and all', () => {
  const W = country(), P = W.P;
  for (const hot of [false, true]) {
    const names = pop.COLUMNS.filter((c) => !hot || c.hot).map((c) => c.name);
    const rows = pop.pack(P, hot);
    assert.ok(Buffer.concat(rows.map((r) => Buffer.from(r))).equals(joined(names, P)));
    for (const size of [1500000, 4096, 777]) {
      const Q = pop.unpack(pop.alloc(P.n), cut(joined(names, P), size), hot);
      for (const nm of names) assert.ok(Buffer.from(Q[nm].buffer).equals(Buffer.from(P[nm].buffer)), nm);
    }
  }
  // (a country kept before a column added later: it stays at 0)
  const late = pop.COLUMNS.filter((c) => c.late).map((c) => c.name), before = pop.COLUMNS.filter((c) => !c.late).map((c) => c.name);
  const lastEarly = pop.COLUMNS.findIndex((c) => c.late);
  const head = pop.COLUMNS.slice(0, lastEarly).map((c) => c.name);
  const Q = pop.unpack(pop.alloc(P.n), cut(joined(head, P), 9999));
  for (const nm of head) assert.ok(Buffer.from(Q[nm].buffer).equals(Buffer.from(P[nm].buffer)));
  assert.ok(Q[late[0]].every((x) => x === 0));
  assert.throws(() => pop.unpack(pop.alloc(P.n), cut(joined(before.slice(0, 3), P), 999)), /shorter/);
});

test('アスカ国\'s people: the same, a million bytes a row', () => {
  const W = country(), A = W.AP;
  const rows = asuka.pack(A);
  const B = asuka.unpack(asuka.alloc(A.n), cut(Buffer.concat(rows.map((r) => Buffer.from(r))), 5000));
  for (const k of Object.keys(A)) if (k !== 'n') assert.ok(Buffer.from(B[k].buffer).equals(Buffer.from(A[k].buffer)), k);
  for (const r of rows.slice(0, -1)) assert.equal(r.byteLength, 1000000);
});
