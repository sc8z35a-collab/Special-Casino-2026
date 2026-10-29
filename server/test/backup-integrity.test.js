import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { startServer } from './helpers.js';
import { statements, SCHEMA_VERSION } from '../core/db.js';
import { createBackup } from '../core/backup.js';

const subtle = globalThis.crypto.subtle;
async function keyPair(label) {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = await subtle.exportKey('jwk', pair.publicKey);
  // Opaque locked-key fixtures; real browser PBKDF2/AES-GCM wrapping is covered in security.test.js.
  const locked = { salt: Buffer.alloc(16, 1).toString('base64'), iv: Buffer.alloc(12, 2).toString('base64'), data: Buffer.alloc(160, label).toString('base64'), rounds: 600000 };
  return { pair, public: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y }, locked };
}
function deferred() { let enter, release; return { ready: new Promise(r => { enter = r; }), gate: new Promise(r => { release = r; }), enter: () => enter(), release: () => release() }; }
async function fixture(t, options = {}) {
  const s = await startServer(), cleanup = [];
  t.after(async () => { cleanup.forEach(fn => fn()); await s.stop(); });
  const baseQ = statements(s.app.db), q = options.q ? options.q(baseQ) : baseQ;
  let exports = 0, ticket;
  const backup = createBackup({ q, tx: fn => s.app.db.tx(fn), secret: 'disposable-backup-test-secret',
    opsLog: { add() {} }, devCode: { async check() {} }, isDeveloper: u => u?.id === 1,
    exportAll: () => { exports++; return { format: 'two-state-casino', schema: SCHEMA_VERSION, tables: { users: [{ id: 1, name: 'recover me' }] } }; }, blobs: options.blobs || null });
  const call = (path, body = {}, revalidate) => backup.routes['POST /api/backup/' + path]({ json: async () => body,
    header: key => key === 'x-backup-ticket' ? ticket : '', revalidate }, { id: 1, name: 'Test developer' });
  ticket = (await call('open')).ticket;
  const key = await keyPair(3); await call('key', key);
  return { s, q: baseQ, backup, call, key, exports: () => exports, cleanup: fn => cleanup.push(fn) };
}
async function decrypt(reply, key) {
  const pub = await subtle.importKey('jwk', reply.envelope.epk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: pub }, key.pair.privateKey, 256);
  const base = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const aes = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('TWO STATE backup v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return JSON.parse(gunzipSync(Buffer.from(await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(reply.envelope.iv, 'base64') }, aes, Buffer.from(reply.data, 'base64')))).toString());
}

test('a key replacement cannot make existing encrypted backups impossible to open', async t => {
  const f = await fixture(t), saved = (await f.call('run')).backup, replacement = await keyPair(4);
  await assert.rejects(f.call('key', replacement), e => e.status === 409 && e.code === 'backup_key_in_use');
  const reply = await f.call('get', { id: saved.id }); assert.deepEqual(reply.locked, f.key.locked);
  assert.equal((await decrypt(reply, f.key)).tables.users[0].name, 'recover me');
  // Rewrapping the same private key for a new developer code remains supported.
  await f.call('key', { public: f.key.public, locked: replacement.locked, rewrap: true });
  assert.deepEqual((await f.call('get', { id: saved.id })).locked, replacement.locked);
});

test('a key replacement cannot race a backup whose encrypted data is still being stored', async t => {
  const gate = deferred(), data = new Map();
  const blobs = { async put(key, bytes) { gate.enter(); await gate.gate; data.set(key, bytes); }, async del(keys) { keys.forEach(k => data.delete(k)); } };
  const f = await fixture(t, { blobs }); f.cleanup(gate.release);
  const pending = f.call('run'); await gate.ready;
  const replacement = await keyPair(5);
  await assert.rejects(f.call('key', replacement), e => e.status === 409 && e.code === 'backup_busy');
  gate.release(); await pending;
  assert.deepEqual(JSON.parse(f.q("SELECT value FROM meta WHERE key='backup_key'").get().value).public, f.key.public);
});

test('overlapping automatic backup checks capture and store one backup', async t => {
  const f = await fixture(t); await f.call('settings', { every: '5h', keep: 10 });
  const results = await Promise.all(Array.from({ length: 12 }, () => f.backup.due()));
  assert.equal(f.exports(), 1); assert.equal(new Set(results.map(r => r.id)).size, 1);
  assert.equal(f.q('SELECT COUNT(*) AS n FROM backups').get().n, 1);
});

for (const inBucket of [false, true]) test(`a failed backup metadata write leaves no orphan ${inBucket ? 'bucket objects' : 'database parts'}`, async t => {
  const data = new Map(), f = await fixture(t, { blobs: inBucket ? { async put(key, bytes) { data.set(key, bytes); }, async del(keys) { keys.forEach(k => data.delete(k)); } } : null,
    q: base => sql => /^INSERT INTO backups\b/.test(sql) ? { run() { throw Error('simulated database capacity error'); } } : base(sql) });
  await assert.rejects(f.call('run'), /simulated database capacity/);
  assert.equal(f.q('SELECT COUNT(*) AS n FROM backup_parts').get().n, 0);
  assert.equal(f.q('SELECT COUNT(*) AS n FROM backups').get().n, 0); assert.equal(data.size, 0);
});

test('invalid curve points cannot replace the usable backup key', async t => {
  const f = await fixture(t);
  await assert.rejects(f.call('key', { public: { ...f.key.public, x: 'A'.repeat(43), y: 'A'.repeat(43) }, locked: f.key.locked }), e => e.status === 400 && e.code === 'bad_key');
  assert.deepEqual(JSON.parse(f.q("SELECT value FROM meta WHERE key='backup_key'").get().value).public, f.key.public);
});

for (const fields of [{ rounds: 'Infinity' }, { rounds: 'not-a-number' }, { rounds: 600000.5 }, { salt: 'YQ==' }, { iv: 'YQ==' }, { data: 'YQ==' }]) test(`malformed wrapped backup key is rejected: ${Object.keys(fields)[0]}=${Object.values(fields)[0]}`, async t => {
  const f = await fixture(t);
  await assert.rejects(f.call('key', { public: f.key.public, locked: { ...f.key.locked, ...fields }, rewrap: true }), e => e.status === 400 && e.code === 'bad_key');
  assert.deepEqual(JSON.parse(f.q("SELECT value FROM meta WHERE key='backup_key'").get().value).locked, f.key.locked);
});
