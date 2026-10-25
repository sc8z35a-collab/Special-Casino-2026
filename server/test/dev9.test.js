// DEV9 on the server: the developer's vault in a bucket (a stand-in for R2
// here), its folders, pieces moving from the database into the bucket, the
// sizes on each plan, an AI's link (labels, 実装済み); the operators' chat
// and the operator site's サーバー tab. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { startServer } from './helpers.js';

const CODE = '987654321098';   // (a test code: the real one is never written anywhere)
const LIMITS = { general: [100000, 1000], login: [100000, 1000], vaultWork: [100000, 1000], vaultPull: [100000, 1000] };
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const whole = (parts) => hash(Buffer.concat(parts.map((b) => Buffer.from(hash(b), 'hex'))));

// R2 as far as the vault uses it (server/cloudflare/casino.js: bucketBlobs)
function memoryBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, bytes, sha256) { objects.set(key, { bytes: Buffer.from(bytes), sha256 }); },
    async get(key) { const o = objects.get(key); return o ? { bytes: new Uint8Array(o.bytes), sha256: o.sha256 } : null; },
    async list(prefix) { return [...objects].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, sha256: o.sha256 })); },
    async del(keys) { for (const k of keys) objects.delete(k); }
  };
}

// the developer (TAKU) with the vault open
async function developer(s) {
  const taku = await s.register('TAKU');
  const call = (method, url, body, ticket) => s.call(method, url, { token: taku.token, body, headers: ticket ? { 'X-Vault-Ticket': ticket } : {} });
  assert.equal((await call('POST', '/api/ops/dev-code', { code: CODE })).devCodeSet, true);
  const open = await call('POST', '/api/vault/open', { code: CODE });
  return { taku, open, vault: (method, url, body) => call(method, url, body, open.ticket) };
}

async function upload(vault, { name, data, piece, folder, parent }) {
  const { file } = await vault('POST', '/api/vault/files', { name, size: data.length, type: 'model/gltf-binary', folder, parent });
  const parts = [];
  for (let n = 0; n < file.chunks; n++) parts.push(data.subarray(n * piece, (n + 1) * piece));
  return { file, parts, put: (n) => vault('POST', '/api/vault/chunk', { id: file.id, n, sha256: hash(parts[n]), data: parts[n].toString('base64') }) };
}

test('the vault in a bucket: 50GB, bigger pieces, nothing written to the database per piece', async () => {
  const bucket = memoryBucket();
  const s = await startServer({ operators: ['taku'], limits: LIMITS, blobs: bucket, vaultPieceMb: 2 });
  try {
    const { open, vault } = await developer(s);
    assert.deepEqual([open.store, open.maxBytes, open.fileBytes, open.chunk], ['bucket', 50 * 1024 ** 3, 2000 * 1024 ** 2, 2 * 1024 * 1024]);

    const data = crypto.randomBytes(2 * open.chunk + 1234);
    const up = await upload(vault, { name: 'garage.glb', data, piece: open.chunk });
    assert.deepEqual([up.file.chunks, up.file.piece], [3, open.chunk]);
    assert.equal((await up.put(0)).stored, true);
    assert.equal((await up.put(2)).stored, true);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM vault_chunks').get().n, 0, 'the pieces are in the bucket only');
    assert.deepEqual((await vault('GET', `/api/vault/missing?id=${up.file.id}`)).missing, [[1, 1]]);
    const early = await vault('POST', '/api/vault/finish', { id: up.file.id });
    assert.deepEqual([early.done, early.missing, early.file.received], [false, [[1, 1]], 2]);
    await up.put(1);
    const done = await vault('POST', '/api/vault/finish', { id: up.file.id });
    assert.deepEqual([done.done, done.sha256], [true, whole(up.parts)]);
    assert.equal((await up.put(1)).error.code, 'done');

    // back out of the bucket, to the developer and through a link
    assert.equal((await vault('GET', `/api/vault/chunk?id=${up.file.id}&n=2`)).data, up.parts[2].toString('base64'));
    const link = await vault('POST', '/api/vault/link', { id: '*', hours: 1 });
    const list = await s.call('GET', link.path);
    assert.deepEqual([list.files.length, list.files[0].chunk, list.files[0].sha256], [1, open.chunk, whole(up.parts)]);
    const got = Buffer.concat(await Promise.all([0, 1, 2].map(async (n) => Buffer.from((await s.call('GET', `${link.path}&f=${up.file.id}&n=${n}`)).data, 'base64'))));
    assert.ok(got.equals(data));

    await vault('POST', '/api/vault/delete', { id: up.file.id });
    assert.equal(bucket.objects.size, 0, 'its pieces leave the bucket');
  } finally {
    await s.stop();
  }
});

test('the vault\'s folders: made, nested, renamed, moved, files into them, deleted with the files going up', async () => {
  const s = await startServer({ operators: ['taku'], limits: LIMITS });
  try {
    const { open, vault } = await developer(s);
    const cars = (await vault('POST', '/api/vault/folders', { name: '車' })).folder;
    const fresh = (await vault('POST', '/api/vault/folders', { name: '新車', parent: cars.id })).folder;
    assert.equal((await vault('POST', '/api/vault/folders', { name: '車' })).error.code, 'exists');
    assert.equal((await vault('POST', '/api/vault/folders', { name: ' / ' })).folder.name, '_');
    assert.equal((await vault('POST', '/api/vault/folders', { name: '  ' })).error.code, 'bad_name');
    assert.equal((await vault('POST', '/api/vault/folders/update', { id: cars.id, parent: fresh.id })).error.code, 'inside');

    // a file straight into a folder, its light copy follows the model
    const model = await upload(vault, { name: 'sedan.glb', data: crypto.randomBytes(1000), piece: open.chunk, folder: fresh.id });
    await model.put(0);
    const light = await upload(vault, { name: 'sedan.light.glb', data: crypto.randomBytes(500), piece: open.chunk, parent: model.file.id });
    await light.put(0);
    const other = await upload(vault, { name: 'garage.glb', data: crypto.randomBytes(800), piece: open.chunk });
    await other.put(0);
    const where = async () => Object.fromEntries((await vault('GET', '/api/vault/files')).files.map((f) => [f.name, f.folder]));
    assert.deepEqual(await where(), { 'sedan.glb': fresh.id, 'sedan.light.glb': fresh.id, 'garage.glb': '' });

    assert.equal((await vault('POST', '/api/vault/move', { ids: [other.file.id, light.file.id], folder: cars.id })).moved, 1, 'a light copy only moves with its model');
    assert.equal((await vault('POST', '/api/vault/move', { ids: [model.file.id], folder: '' })).moved, 1);
    assert.deepEqual(await where(), { 'sedan.glb': '', 'sedan.light.glb': '', 'garage.glb': cars.id });

    // renamed and moved to the top, then 車 goes: what was in it moves up
    assert.equal((await vault('POST', '/api/vault/folders/update', { id: fresh.id, name: 'スポーツカー', parent: '' })).folder.parent, '');
    await vault('POST', '/api/vault/move', { ids: [model.file.id], folder: fresh.id });
    await vault('POST', '/api/vault/folders', { name: '旧車', parent: cars.id });
    await vault('POST', '/api/vault/folders/delete', { id: cars.id });
    const after = await vault('GET', '/api/vault/files');
    assert.deepEqual(after.folders.map((d) => [d.name, d.parent]).sort(), [['_', ''], ['スポーツカー', ''], ['旧車', '']]);
    assert.equal(after.files.find((f) => f.name === 'garage.glb').folder, '');

    // a whole-vault link shows the folders too
    const link = await vault('POST', '/api/vault/link', { id: '*', hours: 1 });
    const list = await s.call('GET', link.path);
    assert.equal(list.folders.length, 3);
    assert.equal(list.files.find((f) => f.name === 'sedan.glb').folder, fresh.id);
    const log = (await s.call('GET', '/api/ops/log', { token: (await s.call('POST', '/api/login', { body: { name: 'TAKU', password: 'pass1234' } })).token })).entries.map((e) => e.action);
    for (const a of ['vault_folder', 'vault_move']) assert.ok(log.includes(a), a);
  } finally {
    await s.stop();
  }
});

test('pieces kept in the database move into the bucket once there is one', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-test-'));
  try {
    const before = await startServer({ operators: ['taku'], limits: LIMITS, dataDir });
    const dev = await developer(before);
    const data = crypto.randomBytes(2 * dev.open.chunk + 77);
    const up = await upload(dev.vault, { name: 'old.glb', data, piece: dev.open.chunk });
    for (let n = 0; n < 3; n++) await up.put(n);
    await before.stop();

    const bucket = memoryBucket();
    const s = await startServer({ operators: ['taku'], limits: LIMITS, dataDir, blobs: bucket });
    try {
      const login = await s.call('POST', '/api/login', { body: { name: 'TAKU', password: 'pass1234' } });
      const open = await s.call('POST', '/api/vault/open', { token: login.token, body: { code: CODE } });
      const vault = (method, url, body) => s.call(method, url, { token: login.token, body, headers: { 'X-Vault-Ticket': open.ticket } });
      assert.equal((await vault('GET', '/api/vault/files')).inDb, 3);
      // (a few at a time: the site asks until none is left)
      let r;
      do r = await vault('POST', '/api/vault/to-bucket'); while (r.left);
      assert.equal(bucket.objects.size, 3);
      assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM vault_chunks').get().n, 0);
      const got = Buffer.concat(await Promise.all([0, 1, 2].map(async (n) => Buffer.from((await vault('GET', `/api/vault/chunk?id=${up.file.id}&n=${n}`)).data, 'base64'))));
      assert.ok(got.equals(data));
      const log = (await s.call('GET', '/api/ops/log', { token: login.token })).entries.map((e) => e.action);
      assert.ok(log.includes('vault_bucket'));
    } finally {
      await s.stop();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the vault\'s sizes follow the plan: 3GB in the database on Workers Paid, 16MB pieces with a bucket at 最速 (8MB at 標準)', async () => {
  const paid = await startServer({ operators: ['taku'], limits: LIMITS, plan: 'paid' });
  try {
    const { open } = await developer(paid);
    assert.deepEqual([open.store, open.maxBytes, open.fileBytes, open.chunk], ['db', 3 * 1024 ** 3, 2000 * 1024 ** 2, 1024 * 1024]);
  } finally {
    await paid.stop();
  }
  const both = await startServer({ operators: ['taku'], limits: LIMITS, plan: 'paid', blobs: memoryBucket() });
  try {
    const { open, vault } = await developer(both);
    assert.deepEqual([open.store, open.chunk, open.speed.id], ['bucket', 16 * 1024 * 1024, 'max']);
    const slow = await vault('POST', '/api/vault/speed', { speed: 'normal' });
    assert.deepEqual([slow.speed.name, slow.chunk], ['標準', 8 * 1024 * 1024]);
  } finally {
    await both.stop();
  }
});

test('an AI\'s link looks, takes and comments, nothing more; the developer, signed in, says a file is in the game: it leaves the links but stays', async () => {
  const s = await startServer({ operators: ['taku'], limits: LIMITS });
  try {
    const { open, vault } = await developer(s);
    const data = crypto.randomBytes(1500);
    const up = await upload(vault, { name: 'car.glb', data, piece: open.chunk });
    await up.put(0);
    const keep = await upload(vault, { name: 'garage.glb', data: crypto.randomBytes(900), piece: open.chunk });
    await keep.put(0);
    const plain = await vault('POST', '/api/vault/link', { id: '*', hours: 1 });
    const ai = await vault('POST', '/api/vault/link', { id: '*', hours: 6, ai: true });
    assert.deepEqual([plain.ai, ai.ai], [false, true]);
    assert.deepEqual([plain.caps, ai.caps], [['view', 'get', 'note'], ['view', 'get', 'note']], 'every link is the same now');
    const labels = async (id) => (await vault('GET', `/api/vault/file?id=${id}`)).file.labels;

    // taking is looked at but never written onto the file: no labels, for either link
    await s.call('GET', `${plain.path}&f=${up.file.id}&n=0`);
    const list = await s.call('GET', ai.path);
    assert.equal(list.ai, true);
    assert.ok(list.files.every((f) => f.sentAt > 0 && f.doneAt >= f.sentAt), 'when each was sent');
    await s.call('GET', `${ai.path}&f=${up.file.id}`);
    await s.call('GET', `${ai.path}&f=${up.file.id}&n=0`);
    assert.deepEqual(await labels(up.file.id), []);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM vault_link_files WHERE file_id = ?').get(up.file.id).n, 2, 'which link took the file is kept apart');

    // a link cannot label or say "in the game"
    const say = (t, body) => s.call('POST', '/api/vault/ai', { body: { t, ...body } });
    const tokenOf = (l) => l.path.split('t=')[1];
    assert.equal((await say(tokenOf(plain), { f: up.file.id, comment: '変換中' })).ok, true, 'every link may comment now');
    assert.equal((await say(tokenOf(ai), { f: up.file.id, text: '車のモデルに変換中' })).error.code, 'not_allowed');
    assert.equal((await say(tokenOf(ai), { f: up.file.id, text: 'img/3d/cars/car.glb', implemented: true })).error.code, 'not_allowed');
    assert.equal((await say(tokenOf(ai), { f: up.file.id, comment: '車のモデルに変換中' })).ok, true);
    assert.deepEqual(await labels(up.file.id), []);
    assert.equal((await vault('GET', '/api/vault/files')).files.find((f) => f.id === up.file.id).implementedAt, 0);

    // the developer says it is in the game: out of every link at once, 実装済み in the vault
    const done = await vault('POST', '/api/vault/implemented', { id: up.file.id, text: 'img/3d/cars/car.glb（DEV9）' });
    assert.ok(done.file.implementedAt > 0);
    assert.deepEqual((await s.call('GET', ai.path)).files.map((f) => f.name), ['garage.glb']);
    assert.equal((await s.call('GET', `${ai.path}&f=${up.file.id}&n=0`)).status, 404);
    assert.equal((await say(tokenOf(ai), { f: up.file.id, comment: 'もう一度' })).status, 404);
    const mine = (await vault('GET', '/api/vault/files')).files.find((f) => f.id === up.file.id);
    assert.ok(mine.implementedAt > 0);
    assert.equal(mine.labelCount, 1);
    assert.deepEqual((await labels(up.file.id)).map((l) => l.kind), ['implemented']);

    // the developer brings it back; it goes again, and nothing ever deletes it on its own
    assert.equal((await vault('POST', '/api/vault/restore', { id: up.file.id })).file.implementedAt, 0);
    await vault('POST', '/api/vault/implemented', { id: up.file.id, text: 'img/3d/cars/car.glb' });
    s.app.db.prepare('UPDATE vault_files SET implemented_at = ? WHERE id = ?').run(Date.now() - 400 * 86400000, up.file.id);
    await s.app.api.housekeeping();
    assert.deepEqual((await vault('GET', '/api/vault/files')).files.map((f) => f.name).sort(), ['car.glb', 'garage.glb']);
    const log = (await s.call('GET', '/api/ops/log', { token: (await s.call('POST', '/api/login', { body: { name: 'TAKU', password: 'pass1234' } })).token })).entries.map((e) => e.action);
    for (const a of ['vault_ai_comment', 'vault_implemented', 'vault_restore']) assert.ok(log.includes(a), a);
    assert.ok(!log.includes('vault_ai_label') && !log.includes('vault_ai_done'), 'a link no longer labels');
  } finally {
    await s.stop();
  }
});

test('運営チャット: who is on, one to one and all together, unread and 既読; not for players', async () => {
  const s = await startServer({ operators: ['taku', 'mod1', 'mod2'], limits: LIMITS });
  try {
    const taku = await s.register('TAKU'), m1 = await s.register('Mod1'), m2 = await s.register('Mod2'), player = await s.register('Player9');
    const as = (p) => (method, url, body) => s.call(method, url, { token: p.token, body });
    const t = as(taku), a = as(m1), b = as(m2);
    assert.equal((await as(player)('GET', '/api/ops/team')).error.code, 'not_operator');
    await a('GET', '/api/ops/team');
    const team = await t('GET', '/api/ops/team');
    assert.deepEqual(team.operators.map((o) => o.name).sort(), ['Mod1', 'Mod2', 'TAKU']);
    assert.equal(team.operators.find((o) => o.name === 'Mod1').site, true, 'Mod1 is on the site');
    assert.equal(team.operators.find((o) => o.name === 'Mod2').site, false);

    // one to one
    const hi = await t('POST', '/api/ops/team/messages', { to: m1.me.id, text: 'おつかれさまです' });
    assert.equal(hi.message.text, 'おつかれさまです');
    assert.equal((await t('POST', '/api/ops/team/messages', { to: player.me.id, text: 'やあ' })).error.code, 'not_operator');
    assert.equal((await a('GET', '/api/ops/team')).operators.find((o) => o.name === 'TAKU').unread, 1);
    assert.equal((await b('GET', `/api/ops/team/messages?with=${taku.me.id}`)).messages.length, 0, 'Mod2 does not see it');
    const dm = await a('GET', `/api/ops/team/messages?with=${taku.me.id}`);
    assert.deepEqual(dm.messages.map((m) => [m.from.name, m.text]), [['TAKU', 'おつかれさまです']]);
    await a('POST', '/api/ops/team/read', { with: taku.me.id, upTo: dm.messages[0].id });
    assert.equal((await a('GET', '/api/ops/team')).operators.find((o) => o.name === 'TAKU').unread, 0);
    assert.equal((await t('GET', `/api/ops/team/messages?with=${m1.me.id}`)).theirRead, dm.messages[0].id, '既読');

    // all together
    await b('POST', '/api/ops/team/messages', { to: 0, text: '全体連絡：今夜メンテ' });
    const all = await t('GET', '/api/ops/team');
    assert.equal(all.all.unread, 1);
    assert.equal(all.all.last.text, '全体連絡：今夜メンテ');
    const after = await a('GET', `/api/ops/team/messages?with=0&after=${hi.message.id}`);
    assert.deepEqual(after.messages.map((m) => m.text), ['全体連絡：今夜メンテ']);
    assert.equal((await t('POST', '/api/ops/team/messages', { to: 0, text: 'あ'.repeat(2001) })).error.code, 'too_long');
  } finally {
    await s.stop();
  }
});

test('the サーバー tab: live requests, the database, the vault, the plan and the bill; every operator, no player', async () => {
  const s = await startServer({ operators: ['taku', 'mod1'], limits: LIMITS, plan: 'paid' });
  try {
    await s.register('TAKU');
    const mod = await s.register('Mod1'), player = await s.register('Player8');
    assert.equal((await s.call('GET', '/api/ops/server', { token: player.token })).error.code, 'not_operator');
    for (let i = 0; i < 5; i++) await s.call('GET', '/api/health');
    const r = await s.call('GET', '/api/ops/server', { token: mod.token });
    assert.equal(r.host, 'node');
    assert.equal(r.plan.id, 'paid');
    assert.equal(r.plan.base, 5);
    assert.ok(r.rate.last60.requests >= 5, 'requests in the last minute');
    assert.ok(r.rate.last60.bytes > 0, 'bytes sent');
    assert.equal(r.rate.history.length, 300);
    assert.ok(r.today.requests >= 5 && r.month.requests >= 5);
    assert.ok(r.database.bytes > 0);
    assert.ok(r.database.rows.find((t) => t.name === 'users').rows >= 3);
    assert.equal(r.vault.store, 'db');
    assert.equal(r.estimate.lines[0].cost, 5);
    assert.ok(r.estimate.total >= 5 && r.estimate.yen >= 750);
    assert.deepEqual(r.cloudflare, { configured: false });
    assert.ok(r.machine.rss > 0 && r.machine.cpus > 0);
  } finally {
    await s.stop();
  }
});
