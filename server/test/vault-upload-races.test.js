import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, migrate } from '../core/db.js';
import { pieceKey } from '../core/vault-pieces.js';
import { startServer } from './helpers.js';

// The edge streaming path uses real Request/Response streams with a disposable R2 stand-in.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true };
  return next(spec, ctx);
}`));

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function setup(t, overrides = {}) {
  const s = await startServer({ operators: ['VaultWriter'], vaultSnapshots: false, ...overrides });
  const releases = [];
  t.after(async () => { releases.forEach(release => release()); await s.stop(); });
  const p = await s.register('VaultWriter');
  const call = (method, url, body) => s.call(method, url, { token: p.token, body });
  const r = await call('POST', '/api/vault/files', { name: 'important.bin', size: 64, space: 'u:' + p.me.id });
  assert.equal(r.status, 200);
  const original = Buffer.alloc(64, 1), stale = Buffer.alloc(64, 2), f = r.file;
  const send = bytes => call('POST', '/api/vault/chunk', { id: f.id, n: 0, sha256: hash(bytes), data: bytes.toString('base64') });
  return { s, p, call, f, original, stale, send, cleanup: fn => releases.push(fn) };
}

function delayedPiece({ s, p, f, stale }) {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const headers = { authorization: `Bearer ${p.token}`, 'content-type': 'application/octet-stream', 'x-piece-sha256': hash(stale) };
  const result = s.app.api.handle({ method: 'POST', path: '/api/vault/piece', query: new URLSearchParams({ id: f.id, n: '0' }), ip: '127.0.0.1',
    header: name => headers[name.toLowerCase()] || '',
    bytes: () => { entered(); return new Promise(resolve => { release = () => resolve(stale); }); } });
  return { ready, result, release: () => release() };
}

test('a delayed raw upload cannot replace bytes of a completed database file', async t => {
  const ctx = await setup(t), pending = delayedPiece(ctx);
  await pending.ready;
  assert.equal((await ctx.send(ctx.original)).status, 200);
  const done = await ctx.call('POST', '/api/vault/finish', { id: ctx.f.id }); assert.equal(done.done, true);
  pending.release();
  assert.equal((await pending.result).status, 409);
  const piece = await ctx.call('GET', `/api/vault/chunk?id=${ctx.f.id}&n=0`);
  assert.equal(piece.sha256, hash(ctx.original));
  assert.deepEqual(Buffer.from(piece.data, 'base64'), ctx.original);
  assert.equal((await ctx.call('GET', `/api/vault/file?id=${ctx.f.id}`)).file.sha256, done.sha256);
});

test('a delayed raw upload cannot resurrect chunks after the file was deleted', async t => {
  const ctx = await setup(t), pending = delayedPiece(ctx);
  await pending.ready;
  assert.equal((await ctx.call('POST', '/api/vault/delete', { id: ctx.f.id })).status, 200);
  pending.release();
  assert.equal((await pending.result).status, 404);
  assert.equal(ctx.s.app.db.prepare('SELECT COUNT(*) AS n FROM vault_chunks WHERE file_id=?').get(ctx.f.id).n, 0);
});

test('a raw piece begun before restart cannot be counted in the replacement upload', async t => {
  const ctx = await setup(t), pending = delayedPiece(ctx);
  await pending.ready;
  assert.equal((await ctx.call('POST', '/api/vault/restart', { id: ctx.f.id })).status, 200);
  pending.release();
  assert.equal((await pending.result).status, 409);
  assert.equal(ctx.s.app.db.prepare('SELECT COUNT(*) AS n FROM vault_chunks WHERE file_id=?').get(ctx.f.id).n, 0);
  assert.equal((await ctx.send(ctx.original)).status, 200);
  assert.equal((await ctx.call('POST', '/api/vault/finish', { id: ctx.f.id })).done, true);
});

function bucket() {
  const data = new Map();
  return { data,
    async put(key, bytes, sha256, options = {}) {
      if (options.onlyIfAbsent && data.has(key)) return false;
      data.set(key, { bytes: Buffer.from(bytes), sha256 }); return true;
    },
    async get(key) { const p = data.get(key); return p ? { bytes: new Uint8Array(p.bytes), sha256: p.sha256 } : null; },
    async list(prefix) { return [...data].filter(([key]) => key.startsWith(prefix)).map(([key, p]) => ({ key, sha256: p.sha256 })); },
    async del(keys) { keys.forEach(key => data.delete(key)); }
  };
}
function deferred() {
  let release, enter;
  return { ready: new Promise(resolve => { enter = resolve; }), gate: new Promise(resolve => { release = resolve; }),
    enter: () => enter(), release: () => release() };
}

test('a bucket write started first cannot replace the piece that completed the file', async t => {
  const blobs = bucket(), ctx = await setup(t, { blobs }), gate = deferred(), put = blobs.put;
  ctx.cleanup(gate.release);
  blobs.put = async (...args) => { if (args[2] === hash(ctx.stale)) { gate.enter(); await gate.gate; } return put(...args); };
  const pending = ctx.send(ctx.stale); await gate.ready;
  assert.equal((await ctx.send(ctx.original)).status, 200);
  const done = await ctx.call('POST', '/api/vault/finish', { id: ctx.f.id }); assert.equal(done.done, true);
  gate.release(); assert.equal((await pending).status, 409);
  assert.deepEqual(blobs.data.get(`vault/${ctx.f.id}/0`).bytes, ctx.original);
  assert.equal((await ctx.call('POST', '/api/vault/finish', { id: ctx.f.id })).sha256, done.sha256);
});

test('an identical bucket piece retry is accepted without writing new bytes', async t => {
  const blobs = bucket(), ctx = await setup(t, { blobs });
  assert.equal((await ctx.send(ctx.original)).status, 200);
  const first = blobs.data.get(`vault/${ctx.f.id}/0`);
  assert.equal((await ctx.send(ctx.original)).status, 200);
  assert.equal(blobs.data.get(`vault/${ctx.f.id}/0`), first);
  assert.equal((await ctx.send(ctx.stale)).error.code, 'piece_conflict');
  assert.deepEqual(first.bytes, ctx.original);
});

test('restart cleanup cannot delete pieces from a replacement bucket upload', async t => {
  const blobs = bucket(), ctx = await setup(t, { blobs }), gate = deferred(), del = blobs.del;
  ctx.cleanup(gate.release);
  assert.equal((await ctx.send(ctx.stale)).status, 200);
  blobs.del = async keys => { gate.enter(); await gate.gate; return del(keys); };
  const pending = ctx.call('POST', '/api/vault/restart', { id: ctx.f.id }); await gate.ready;
  assert.equal((await ctx.send(ctx.original)).status, 200);
  const done = await ctx.call('POST', '/api/vault/finish', { id: ctx.f.id }); assert.equal(done.done, true);
  gate.release(); assert.equal((await pending).status, 200);
  const piece = await ctx.call('GET', `/api/vault/chunk?id=${ctx.f.id}&n=0`);
  assert.equal(piece.status, 200); assert.deepEqual(Buffer.from(piece.data, 'base64'), ctx.original);
  assert.equal(blobs.data.has(`vault/${ctx.f.id}/0`), false);
  assert.equal(blobs.data.has(`vault/${ctx.f.id}/g1/0`), true);
});

for (const path of ['finish', 'missing']) test(`a stale bucket ${path} response cannot change a restarted upload`, async t => {
  const blobs = bucket(), ctx = await setup(t, { blobs }), gate = deferred(), list = blobs.list;
  ctx.cleanup(gate.release);
  assert.equal((await ctx.send(ctx.stale)).status, 200);
  let once = false;
  blobs.list = async prefix => {
    const result = await list(prefix);
    if (!once) { once = true; gate.enter(); await gate.gate; }
    return result;
  };
  const pending = path === 'finish' ? ctx.call('POST', '/api/vault/finish', { id: ctx.f.id }) : ctx.call('GET', `/api/vault/missing?id=${ctx.f.id}`);
  await gate.ready;
  assert.equal((await ctx.call('POST', '/api/vault/restart', { id: ctx.f.id })).status, 200);
  assert.equal((await ctx.send(ctx.original)).status, 200);
  const done = await ctx.call('POST', '/api/vault/finish', { id: ctx.f.id }); assert.equal(done.done, true);
  gate.release();
  const stale = await pending; assert.equal(stale.status, 409); assert.equal(stale.error.code, 'upload_restarted');
  const current = await ctx.call('POST', '/api/vault/finish', { id: ctx.f.id }); assert.equal(current.sha256, done.sha256);
});

test('a late bucket write after restart is removed only from its obsolete generation', async t => {
  const blobs = bucket(), ctx = await setup(t, { blobs }), gate = deferred(), put = blobs.put;
  ctx.cleanup(gate.release);
  blobs.put = async (...args) => { if (args[2] === hash(ctx.stale)) { gate.enter(); await gate.gate; } return put(...args); };
  const pending = ctx.send(ctx.stale); await gate.ready;
  assert.equal((await ctx.call('POST', '/api/vault/restart', { id: ctx.f.id })).status, 200);
  assert.equal((await ctx.send(ctx.original)).status, 200);
  assert.equal((await ctx.call('POST', '/api/vault/finish', { id: ctx.f.id })).done, true);
  gate.release(); assert.equal((await pending).error.code, 'upload_restarted');
  assert.equal(blobs.data.has(`vault/${ctx.f.id}/0`), false);
  assert.deepEqual(blobs.data.get(`vault/${ctx.f.id}/g1/0`).bytes, ctx.original);
});

for (const status of [401, 403, 404, 409, 503]) test(`the edge upload preserves a ${status} final refusal and leaves current file bytes intact`, async () => {
  const { default: worker } = await import('../cloudflare/worker.js');
  const bytes = Buffer.alloc(64, 3), key = 'vault/test/g1/0', objects = new Map();
  const casino = { async fetch(req) {
    if (new URL(req.url).pathname.endsWith('/permit')) return Response.json({ n: 0, key, generation: 1 });
    assert.deepEqual(await req.json(), { generation: 1 });
    return Response.json({ error: { code: 'denied' } }, { status });
  } };
  const VAULT = {
    async put(k, stream, options) { assert.deepEqual(options.onlyIf, { etagDoesNotMatch: '*' }); objects.set(k, Buffer.from(await new Response(stream).arrayBuffer())); return { key: k }; },
    async delete(k) { objects.delete(k); }
  };
  const result = await worker.fetch(new Request('https://casino.test/api/vault/piece?id=test&n=0', {
    method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '64', 'X-Piece-Sha256': hash(bytes) }
  }), { VAULT, CASINO: { idFromName: () => 'main', get: () => casino } });
  assert.equal(result.status, status); assert.deepEqual(objects.get(key), bytes);
});

test('the edge upload discards only an explicitly obsolete generation', async () => {
  const { default: worker } = await import('../cloudflare/worker.js');
  const bytes = Buffer.alloc(64, 3), old = 'vault/test/0', current = 'vault/test/g1/0', objects = new Map([[current, bytes]]);
  const casino = { async fetch(req) {
    return new URL(req.url).pathname.endsWith('/permit') ? Response.json({ n: 0, key: old, generation: 0 })
      : Response.json({ error: { code: 'upload_restarted', discard: true } }, { status: 409 });
  } };
  const result = await worker.fetch(new Request('https://casino.test/api/vault/piece?id=test&n=0', {
    method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '64', 'X-Piece-Sha256': hash(bytes) }
  }), { VAULT: {
    async put(k, stream) { objects.set(k, Buffer.from(await new Response(stream).arrayBuffer())); return { key: k }; },
    async delete(k) { objects.delete(k); }
  }, CASINO: { idFromName: () => 'main', get: () => casino } });
  assert.equal(result.status, 409); assert.equal(objects.has(old), false); assert.equal(objects.get(current), bytes);
});

for (const identical of [false, true]) test(`the edge conditional conflict ${identical ? 'accepts identical retries' : 'rejects different bytes'}`, async () => {
  const { default: worker } = await import('../cloudflare/worker.js');
  const bytes = Buffer.alloc(64, 3); let stored = 0;
  const casino = { async fetch(req) {
    if (new URL(req.url).pathname.endsWith('/permit')) return Response.json({ n: 0, key: 'vault/test/0', generation: 0 });
    stored++; return Response.json({ ok: true });
  } };
  const result = await worker.fetch(new Request('https://casino.test/api/vault/piece?id=test&n=0', {
    method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '64', 'X-Piece-Sha256': hash(bytes) }
  }), { VAULT: {
    async put() { return null; },
    async head() { return { size: 64, customMetadata: { sha256: hash(identical ? bytes : Buffer.alloc(64, 4)) } }; }
  }, CASINO: { idFromName: () => 'main', get: () => casino } });
  assert.equal(result.status, identical ? 200 : 409); assert.equal(stored, identical ? 1 : 0);
});

test('the storage migration preserves existing file metadata, chunks and legacy R2 addresses', () => {
  const raw = new DatabaseSync(':memory:');
  try {
    const version = MIGRATIONS.findIndex(batch => batch.some(sql => sql.includes('ADD COLUMN storage_generation')));
    raw.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    for (const sql of MIGRATIONS.slice(0, version).flat()) raw.exec(sql);
    raw.prepare("INSERT INTO meta VALUES ('schema', ?)").run(String(version));
    const bytes = Buffer.from('legacy vault'), id = 'a'.repeat(32);
    raw.prepare(`INSERT INTO vault_files(id,name,size,chunks,piece,created_by,created_at,done_at,sha256,restarts)
      VALUES(?,'original.bin',?,1,?,7,1,2,?,4)`).run(id, bytes.length, bytes.length, hash(bytes));
    raw.prepare('INSERT INTO vault_chunks(file_id,n,sha256,data) VALUES(?,0,?,?)').run(id, hash(bytes), bytes.toString('base64'));
    const before = { ...raw.prepare('SELECT * FROM vault_files').get() }, chunk = raw.prepare('SELECT * FROM vault_chunks').get();
    const db = { exec: sql => raw.exec(sql), prepare: sql => raw.prepare(sql), tx: fn => fn() };
    migrate(db); migrate(db);
    const after = { ...raw.prepare('SELECT * FROM vault_files').get() };
    assert.equal(after.storage_generation, 0); assert.equal(pieceKey(after, 0), `vault/${id}/0`);
    delete after.storage_generation; assert.deepEqual(after, before);
    assert.deepEqual(raw.prepare('SELECT * FROM vault_chunks').get(), chunk);
  } finally { raw.close(); }
});

for (const length of [null, '1']) test(`the edge bounds streamed API bodies even with ${length ? 'a false' : 'no'} content length`, async () => {
  const { default: worker } = await import('../cloudflare/worker.js');
  let sent = 0, cancelled = false, forwarded = false;
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream({
    pull(controller) { if (sent === 16) controller.close(); else { sent++; controller.enqueue(chunk); } },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 });
  const result = await worker.fetch(new Request('https://casino.test/api/messages', { method: 'POST', body: stream, duplex: 'half',
    headers: { 'Content-Type': 'application/json', ...(length ? { 'Content-Length': length } : {}) } }), {
    CASINO: { idFromName: () => 'main', get: () => ({ fetch() { forwarded = true; throw Error('oversized data reached the object'); } }) }
  });
  assert.equal(result.status, 413); assert.equal((await result.json()).error.code, 'too_large');
  assert.equal(forwarded, false); assert.equal(cancelled, true); assert.ok(sent <= 11, 'stop reading as soon as the 9MiB bound is exceeded');
});
