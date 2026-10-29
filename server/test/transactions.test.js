import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../node/sqlite.js';
import { statements } from '../core/db.js';
import { createTransactions } from '../core/transactions.js';
import { createOpsLog } from '../core/opslog.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-commit-')), db = openDb(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const q = statements(db), { run: tx, afterCommit } = createTransactions(db);
  const put = () => q("INSERT INTO meta(key,value) VALUES('commit-test','saved')").run();
  const saved = () => q("SELECT value FROM meta WHERE key='commit-test'").get();
  return { q, tx, afterCommit, put, saved };
}

test('nested effects run in order only after durable writes can be read outside the transaction', t => {
  const { tx, afterCommit, put, saved } = fixture(t), effects = [];
  assert.equal(tx(() => {
    put(); afterCommit(() => effects.push(saved().value));
    tx(() => afterCommit(() => effects.push('nested')));
    assert.deepEqual(effects, []); return 7;
  }), 7);
  assert.deepEqual(effects, ['saved', 'nested']);
  afterCommit(() => effects.push('immediate'));
  assert.equal(effects.at(-1), 'immediate');
});

test('rollback discards queued effects and allows a clean retry', t => {
  const { tx, afterCommit, put, saved } = fixture(t), effects = [];
  assert.throws(() => tx(() => { put(); afterCommit(() => effects.push('ghost')); throw new Error('abort'); }), /abort/);
  assert.equal(saved(), undefined); assert.deepEqual(effects, []);
  tx(() => { put(); afterCommit(() => effects.push('committed')); });
  assert.deepEqual(effects, ['committed']);
});

test('a caught nested failure still rolls back joined work on both transaction hosts', t => {
  const { tx, afterCommit, put, saved } = fixture(t), effects = [];
  assert.throws(() => tx(() => {
    try { tx(() => { put(); afterCommit(() => effects.push('ghost')); throw new Error('nested abort'); }); } catch { /* optional caller */ }
    afterCommit(() => effects.push('also ghost'));
  }), /nested abort/);
  assert.equal(saved(), undefined); assert.deepEqual(effects, []);
});

test('a falsy thrown value cannot bypass the rollback-only state', t => {
  const { tx, put, saved } = fixture(t);
  let failed = false;
  try { tx(() => { try { tx(() => { put(); throw null; }); } catch { /* joined failure */ } }); }
  catch (e) { failed = true; assert.equal(e, null); }
  assert.equal(failed, true); assert.equal(saved(), undefined);
});

test('a failed delivery cannot turn a committed financial action into a retryable server failure', t => {
  const { tx, afterCommit, put, saved } = fixture(t), delivered = [];
  t.mock.method(console, 'error', () => {});
  assert.equal(tx(() => {
    put(); afterCommit(() => { throw new Error('offline receiver'); });
    afterCommit(() => delivered.push('next receiver')); return 'ok';
  }), 'ok');
  assert.equal(saved().value, 'saved'); assert.deepEqual(delivered, ['next receiver']);
});

test('an aborted operator log never enters external anchors, mirrors or notices', async t => {
  const { q, tx, afterCommit } = fixture(t), copies = [];
  const log = createOpsLog({ q, afterCommit, anchor: { put: r => copies.push(r), mirror: r => copies.push(r), get: async () => copies[0] || null }, onAdd: r => copies.push(r) });
  assert.throws(() => tx(() => { log.add({ action: 'test', summary: 'rolled back' }); throw new Error('abort'); }), /abort/);
  assert.deepEqual(copies, []); assert.equal(q('SELECT COUNT(*) AS n FROM ops_log').get().n, 0);
  tx(() => { log.add({ action: 'test', summary: 'saved' }); assert.deepEqual(copies, []); });
  assert.equal(copies.length, 3); assert.ok(copies.every(r => r.id === 1));
  assert.equal((await log.verify()).ok, true);
});
