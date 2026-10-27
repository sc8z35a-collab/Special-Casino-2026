// The original DEV8 vault contracts, independent of the payment fixture.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer } from './helpers.js';
const CODE = '987654321098';
let s, call, taku, sub;
before(async () => {
  s = await startServer({ operators: ['taku', 'sub'] });
  ({ call } = s); taku = await s.register('TAKU'); sub = await s.register('Sub');
});
after(() => s.stop());

test('the vault: the developer code opens it, every piece is checked, a link fetches the file read-only', async () => {
  const vault = (method, url, body, ticket, who = taku) => call(method, url, { token: who.token, body, headers: ticket ? { 'X-Vault-Ticket': ticket } : {} });
  assert.equal((await vault('POST', '/api/vault/open', { code: CODE }, null, sub)).error.code, 'not_developer');
  assert.equal((await vault('POST', '/api/ops/dev-code', { code: CODE })).devCodeSet, true);
  assert.equal((await vault('POST', '/api/vault/open', { code: '111111111111' })).error.code, 'dev_code');
  const { ticket, chunk } = await vault('POST', '/api/vault/open', { code: CODE });
  // without the code (or with a wrong ticket): the developer only looks
  const look = await vault('GET', '/api/vault/files');
  assert.deepEqual([look.locked, look.space.write, look.space.add], [true, false, false]);
  assert.equal((await vault('GET', '/api/vault/files', undefined, ticket + 'x')).locked, true);
  assert.equal((await vault('POST', '/api/vault/files', { name: 'x.txt', size: 10 })).error.code, 'vault_locked');
  assert.equal((await vault('POST', '/api/vault/folders', { name: '資料' }, ticket + 'x')).error.code, 'vault_locked');
  const open = await vault('GET', '/api/vault/files', undefined, ticket);
  assert.deepEqual([open.locked, open.space.write], [false, true]);

  const data = crypto.randomBytes(2 * chunk + 1000);
  const parts = [0, 1, 2].map((n) => data.subarray(n * chunk, (n + 1) * chunk));
  const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const { file } = await vault('POST', '/api/vault/files', { name: '../garage.glb', size: data.length, type: 'model/gltf-binary', note: '3Dガレージ' }, ticket);
  assert.deepEqual([file.name, file.chunks, file.done], ['garage.glb', 3, false]);
  const put = (n, sha = hash(parts[n])) => vault('POST', '/api/vault/chunk', { id: file.id, n, sha256: sha, data: parts[n].toString('base64') }, ticket);
  assert.equal((await put(0, hash(parts[1]))).error.code, 'bad_hash');
  assert.equal((await put(0)).received, 1);
  assert.equal((await put(1)).received, 2);
  assert.deepEqual((await vault('GET', `/api/vault/missing?id=${file.id}`, undefined, ticket)).missing, [[2, 2]]);
  const last = await put(2);
  const whole = hash(Buffer.concat(parts.map((b) => Buffer.from(hash(b), 'hex'))));
  assert.deepEqual([last.done, last.sha256], [true, whole]);
  assert.equal((await vault('GET', `/api/vault/chunk?id=${file.id}&n=1`, undefined, ticket)).data, parts[1].toString('base64'));

  // a link: no login, read-only, until stopped
  const link = await vault('POST', '/api/vault/link', { id: file.id, hours: 1 }, ticket);
  const meta = await call('GET', link.path);
  assert.deepEqual([meta.name, meta.size, meta.chunks, meta.sha256], ['garage.glb', data.length, 3, whole]);
  const got = Buffer.concat(await Promise.all([0, 1, 2].map(async (n) => Buffer.from((await call('GET', `${link.path}&n=${n}`)).data, 'base64'))));
  assert.ok(got.equals(data));
  await vault('POST', '/api/vault/link/stop', { id: file.id }, ticket);
  assert.equal((await call('GET', link.path)).status, 404);
  assert.equal((await call('GET', '/api/vault/pull?t=' + 'a'.repeat(43))).status, 404);

  await vault('POST', '/api/vault/delete', { id: file.id }, ticket);
  assert.equal((await vault('GET', '/api/vault/files', undefined, ticket)).files.length, 0);
  const log = (await call('GET', '/api/ops/log', { token: taku.token })).entries.map((e) => e.action);
  for (const a of ['vault_open', 'vault_upload', 'vault_link', 'vault_pull', 'vault_link_stop', 'vault_delete']) assert.ok(log.includes(a), a);
});
