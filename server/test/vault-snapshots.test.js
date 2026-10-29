import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer } from './helpers.js';
import { statements } from '../core/db.js';
import { createVaultSnapshots } from '../core/vault-snapshots.js';
const DAY = 86400000, CODE = '987654321098';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function bucket() {
  const data = new Map(), writes = [], deletes = [];
  return { data, writes, deletes,
    async put(key, bytes, sha256, options = {}) {
      if (options.onlyIfAbsent && data.has(key)) return false;
      data.set(key, { bytes: Buffer.from(bytes), sha256 }); writes.push(key); return true;
    },
    async get(key) { const row = data.get(key); return row ? { bytes: new Uint8Array(row.bytes), sha256: row.sha256 } : null; },
    async list(prefix) { return [...data].filter(([key]) => key.startsWith(prefix)).map(([key, row]) => ({ key, sha256: row.sha256 })); },
    async del(keys) { for (const key of keys) { data.delete(key); deletes.push(key); } }
  };
}
async function fixture(t, options = {}) {
  const blobs = bucket(), server = await startServer({ blobs, vaultSnapshots: false, operators: ['taku', 'mod'] }); t.after(() => server.stop());
  const developer = await server.register('taku'), mod = await server.register('mod');
  assert.equal((await server.call('POST', '/api/ops/dev-code', { token: developer.token, body: { code: CODE } })).status, 200);
  const ticket = (await server.call('POST', '/api/vault/open', { token: developer.token, body: { code: CODE } })).ticket;
  const call = (method, path, body) => server.call(method, path, { token: developer.token, body, headers: { 'X-Vault-Ticket': ticket } });
  const q = statements(server.app.db); let now = Date.now();
  const make = () => createVaultSnapshots({ q, tx: (fn) => server.app.db.tx(fn), blobs, authorize() {}, clock: () => now, batch: 2, keep: 2, ...options });
  async function put(name, bytes, folder = '') {
    const created = await call('POST', '/api/vault/files', { name, size: bytes.length, type: 'text/plain', folder }); assert.equal(created.status, 200, JSON.stringify(created));
    for (let n = 0; n < created.file.chunks; n++) {
      const data = bytes.subarray(n * created.file.piece, (n + 1) * created.file.piece);
      assert.equal((await call('POST', '/api/vault/chunk', { id: created.file.id, n, sha256: sha(data), data: data.toString('base64') })).status, 200);
    }
    const done = await call('POST', '/api/vault/finish', { id: created.file.id }); assert.equal(done.status, 200); return done.file;
  }
  return { blobs, server, q, make, put, call, developer, mod, advance(ms) { now += ms; } };
}
async function drain(api, options = {}) {
  let result = await api.tick(options);
  for (let i = 0; result.job && i < 200; i++) result = await api.tick();
  assert.equal(result.job, null, 'job completes within its bounded steps'); return result;
}

test('daily vault snapshots restore files, metadata and folders after live deletion without changing the live vault', async (t) => {
  const f = await fixture(t), folder = (await f.call('POST', '/api/vault/folders', { name: 'Archive' })).folder;
  const bytes = Buffer.from('recoverable private file'), file = await f.put('original.txt', bytes, folder.id);
  f.q('UPDATE vault_files SET info=? WHERE id=?').run(JSON.stringify({ text: 'metadata'.repeat(200) }), file.id);
  const before = f.q('SELECT * FROM vault_files').all(), api = f.make();
  assert.equal((await api.tick()).snapshots.length, 0, 'not due yet'); f.advance(60001);
  const saved = await drain(api); assert.equal(saved.error, ''); assert.equal(saved.snapshots.length, 1);
  assert.deepEqual([saved.snapshots[0].files, saved.snapshots[0].folders, saved.snapshots[0].bytes, saved.snapshots[0].check], [1, 1, bytes.length, 'full']);
  assert.deepEqual(f.q('SELECT * FROM vault_files').all(), before, 'creating the snapshot never rewrites original metadata');
  assert.equal((await f.call('POST', '/api/vault/delete', { id: file.id })).status, 200);
  assert.equal(f.q('SELECT COUNT(*) AS n FROM vault_files').get().n, 0); assert.equal(f.blobs.data.has('vault/' + file.id + '/0'), false);
  const proof = await drain(api, { verify: saved.snapshots[0].id });
  assert.equal(proof.error, ''); assert.equal(proof.snapshots[0].check, 'full'); assert.equal(proof.snapshots[0].files, 1);
  assert.equal(f.q('SELECT COUNT(*) AS n FROM vault_files').get().n, 0, 'recovery verification does not recreate/overwrite live files');
});

test('snapshot progress survives a restart and its lease prevents a second worker from racing it', async (t) => {
  const f = await fixture(t, { batch: 1 }); await f.put('a.txt', Buffer.from('same')); await f.put('b.txt', Buffer.from('same'));
  const first = f.make(), pending = await first.tick({ force: true }); assert.ok(pending.job);
  const resumed = f.make(), cursor = resumed.status().job.cursor;
  assert.equal((await resumed.tick()).job.cursor, cursor, 'the live lease is respected');
  f.advance(120001); const completed = await drain(resumed); assert.equal(completed.error, ''); assert.equal(completed.snapshots[0].files, 2);
  assert.equal([...f.blobs.data.keys()].filter((key) => key.startsWith('vault-snapshots/objects/')).length, 1, 'equal content shares an archived object');
});

test('unchanged data is reused, weekly full checks recur, and retention never deletes live files or unrelated backups', async (t) => {
  const f = await fixture(t), file = await f.put('old.txt', Buffer.from('old data')), api = f.make();
  const first = await drain(api, { force: true }); const firstId = first.snapshots[0].id;
  await f.call('POST', '/api/vault/delete', { id: file.id }); await f.put('new.txt', Buffer.from('new data'));
  await f.blobs.put('backups/keep', Buffer.from('keep'), sha('keep')); await f.blobs.put('oplog/keep', Buffer.from('keep'), sha('keep'));
  f.blobs.deletes.length = 0; // Exclude the explicit live deletion above; observe snapshot collection only.
  f.advance(DAY); await drain(api);
  const writes = f.blobs.writes.filter((key) => key.startsWith('vault-snapshots/objects/')).length;
  f.advance(DAY); const third = await drain(api);
  assert.equal(f.blobs.writes.filter((key) => key.startsWith('vault-snapshots/objects/')).length, writes, 'an unchanged file is not copied again');
  assert.equal(third.snapshots.length, 2); assert.ok(!third.snapshots.some((entry) => entry.id === firstId));
  assert.ok(f.blobs.deletes.every((key) => key.startsWith('vault-snapshots/')));
  assert.ok(f.blobs.data.has('backups/keep')); assert.ok(f.blobs.data.has('oplog/keep'));
  assert.equal([...f.blobs.data.keys()].filter((key) => key.startsWith('vault/')).length, 1);
  f.advance(7 * DAY); assert.equal((await drain(api)).snapshots[0].check, 'full');
});

test('corruption is reported by recovery checks and a later full snapshot repairs an archived copy from a valid source', async (t) => {
  const f = await fixture(t); await f.put('integrity.txt', Buffer.from('must survive')); const api = f.make();
  const saved = await drain(api, { force: true }), id = saved.snapshots[0].id;
  const key = [...f.blobs.data.keys()].find((key) => key.startsWith('vault-snapshots/objects/'));
  f.blobs.data.get(key).bytes = Buffer.from('damaged');
  const failed = await drain(api, { verify: id }); assert.match(failed.error, /missing or damaged/); assert.equal(failed.snapshots[0].check, 'failed');
  const repaired = await drain(api, { force: true }); assert.equal(repaired.error, ''); assert.equal(repaired.snapshots[0].check, 'full');
  assert.equal(f.blobs.data.get(key).bytes.toString(), 'must survive');
  assert.equal((await drain(api, { verify: id })).error, '');
});

test('snapshot APIs require the developer and the current vault-code ticket, and disabled/R2-less hosts schedule no work', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.server.call('GET', '/api/vault/snapshots', { token: f.mod.token })).status, 404);
  assert.equal((await f.server.call('GET', '/api/vault/snapshots', { token: f.developer.token })).status, 403);
  assert.equal((await f.call('GET', '/api/vault/snapshots')).enabled, false);
  assert.equal((await f.call('POST', '/api/vault/snapshots/run', {})).status, 503);
  const none = createVaultSnapshots({ q: f.q, tx: (fn) => f.server.app.db.tx(fn), blobs: null, authorize() {} });
  assert.equal(none.nextDue(), 0); assert.equal((await none.tick({ force: true })).enabled, false);
});

test('snapshots preserve restarted bucket generations and legacy completed files with nonzero restart counts', async t => {
  const f = await fixture(t), bytes = Buffer.from('generation-aware recovery');
  const legacy = await f.put('legacy.txt', Buffer.from('legacy object'));
  f.q('UPDATE vault_files SET restarts=3 WHERE id=?').run(legacy.id);
  const created = await f.call('POST', '/api/vault/files', { name: 'restarted.txt', size: bytes.length });
  assert.equal((await f.call('POST', '/api/vault/restart', { id: created.file.id })).status, 200);
  assert.equal((await f.call('POST', '/api/vault/chunk', { id: created.file.id, n: 0, sha256: sha(bytes), data: bytes.toString('base64') })).status, 200);
  assert.equal((await f.call('POST', '/api/vault/finish', { id: created.file.id })).done, true);
  assert.ok(f.blobs.data.has(`vault/${created.file.id}/g1/0`));
  const api = f.make(), saved = await drain(api, { force: true });
  assert.equal(saved.error, ''); assert.equal(saved.snapshots[0].files, 2);
  for (const id of [legacy.id, created.file.id]) assert.equal((await f.call('POST', '/api/vault/delete', { id })).status, 200);
  assert.equal([...f.blobs.data.keys()].some(key => key.startsWith('vault/')), false);
  const proof = await drain(api, { verify: saved.snapshots[0].id });
  assert.equal(proof.error, ''); assert.equal(proof.snapshots[0].check, 'full'); assert.equal(proof.snapshots[0].files, 2);
});
