// 保管庫のアップデート on the server: the vaults two operators share (private
// to the two of them, the developer looks into the others' without changing
// them, nothing of them ever leaves through a link), one room with the
// developer's vault, 1GB a person (here 1MB) and past it only with the
// developer's approval and the limit they set, a partner who is no longer an
// operator, and the checked files and folders moved or deleted at once. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { register } from 'node:module';
import { startServer } from './helpers.js';

// 'cloudflare:workers' as far as the Worker (server/cloudflare/worker.js → casino.js) needs it
const STUB = 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(STUB)}), shortCircuit: true };
  return next(spec, ctx);
}`));
globalThis.WebSocketRequestResponsePair ??= class { constructor(a, b) { this.request = a; this.response = b; } };

const CODE = '987654321098';   // (a test code: the real one is never written anywhere)
const LIMITS = { general: [100000, 1000], login: [100000, 1000], vaultWork: [100000, 1000], vaultPull: [100000, 1000], vaultOpen: [100000, 1000] };
const MB = 1024 * 1024;
const mbs = (x) => Math.round(x * MB);
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');

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

// an account and its calls (`ticket`: the developer's, once the vault is open)
async function person(s, name) {
  const r = await s.register(name);
  const me = { id: r.me.id, name, token: r.token, ticket: '' };
  me.call = (method, url, body) => s.call(method, url, { token: me.token, body, headers: me.ticket ? { 'X-Vault-Ticket': me.ticket } : {} });
  return me;
}
// TAKU with the developer code set and the vault open
async function developer(s) {
  const taku = await person(s, 'TAKU');
  assert.equal((await taku.call('POST', '/api/ops/dev-code', { code: CODE })).devCodeSet, true);
  taku.ticket = (await taku.call('POST', '/api/vault/open', { code: CODE })).ticket;
  return taku;
}
const pair = (a, b) => (a.id < b.id ? `p:${a.id}:${b.id}` : `p:${b.id}:${a.id}`);

// a whole file into a vault (every piece, then finished): its row, or the refusal
async function put(who, { space, name, data, folder, parent }) {
  const r = await who.call('POST', '/api/vault/files', { space, name, size: data.length, type: 'application/octet-stream', folder, parent });
  if (!r.file) return r;
  for (let n = 0; n < r.file.chunks; n++) {
    const part = data.subarray(n * r.file.piece, (n + 1) * r.file.piece);
    const c = await who.call('POST', '/api/vault/chunk', { id: r.file.id, n, sha256: hash(part), data: part.toString('base64') });
    assert.ok(c.status === 200, JSON.stringify(c));
  }
  const done = await who.call('POST', '/api/vault/finish', { id: r.file.id });
  assert.equal(done.done, true);
  return done.file;
}
const actions = async (who) => (await who.call('GET', '/api/ops/log')).entries;

test('a vault two operators share: only the two of them, the developer looks without changing, no link ever reaches it', async () => {
  const s = await startServer({ operators: ['taku', 'mod1', 'mod2', 'mod3'], limits: LIMITS, blobs: memoryBucket() });
  try {
    const taku = await developer(s);
    const a = await person(s, 'Mod1'), b = await person(s, 'Mod2'), c = await person(s, 'Mod3');
    const player = await person(s, 'Player1');
    const ab = pair(a, b);

    // every operator has one with each of the others (the developer too), no code needed
    const list = await a.call('GET', '/api/vault/spaces');
    assert.deepEqual(list.spaces.map((x) => x.with.name).sort(), ['Mod2', 'Mod3', 'TAKU']);
    assert.equal(list.spaces.find((x) => x.with.name === 'TAKU').with.developer, true);
    assert.ok(!('others' in list) && !('people' in list) && !('requests' in list), 'an operator sees no one else\'s');
    assert.deepEqual([list.me.used, list.me.limit, list.me.free], [0, 1024 * MB, 1024 * MB]);

    // one sends, the other sees it and takes it back whole
    const data = crypto.randomBytes(1500);
    const f = await put(a, { space: ab, name: '企画書.pdf', data });
    assert.deepEqual([f.space, f.by.name], [ab, 'Mod1']);
    const seen = await b.call('GET', `/api/vault/files?space=${ab}`);
    assert.deepEqual(seen.files.map((x) => x.name), ['企画書.pdf']);
    assert.deepEqual([seen.space.shared, seen.space.mine, seen.space.write], [true, true, true]);
    assert.equal(Buffer.from((await b.call('GET', `/api/vault/chunk?id=${f.id}&n=0`)).data, 'base64').equals(data), true);

    // anyone else: not there at all
    assert.equal((await c.call('GET', `/api/vault/files?space=${ab}`)).error.code, 'no_space');
    for (const [m, url, body] of [['GET', `/api/vault/chunk?id=${f.id}&n=0`], ['GET', `/api/vault/preview?id=${f.id}`], ['POST', '/api/vault/delete', { id: f.id }],
      ['POST', '/api/vault/notes', { id: f.id, text: 'x', days: 1 }], ['POST', '/api/vault/move', { ids: [f.id], folder: '' }]]) {
      assert.equal((await c.call(m, url, body)).status, 404, `${m} ${url}`);
    }
    assert.equal((await c.call('POST', '/api/vault/files', { space: ab, name: 'x', size: 10 })).error.code, 'no_space');
    assert.equal((await player.call('GET', `/api/vault/files?space=${ab}`)).error.code, 'not_operator');
    // the developer's own vault stays the developer's
    assert.equal((await a.call('GET', '/api/vault/files')).error.code, 'not_developer');
    assert.equal((await a.call('POST', '/api/vault/files', { name: 'x', size: 10 })).error.code, 'not_developer');
    assert.equal((await a.call('POST', '/api/vault/open', { code: CODE })).error.code, 'not_developer');

    // the developer: looks into it (with the code or without), changes nothing
    const closed = { ...taku, ticket: '' };
    closed.call = (method, url, body) => s.call(method, url, { token: taku.token, body });
    const peek = await closed.call('GET', `/api/vault/files?space=${ab}`);
    assert.deepEqual([peek.files.length, peek.locked, peek.space.write], [1, true, false]);
    const look = await taku.call('GET', '/api/vault/spaces');
    assert.deepEqual(look.others.map((x) => [x.id, x.files, x.bytes]), [[ab, 1, 1500]]);
    assert.deepEqual(look.spaces.map((x) => x.with.name).sort(), ['Mod1', 'Mod2', 'Mod3']);
    const dev = await taku.call('GET', `/api/vault/files?space=${ab}`);
    assert.deepEqual([dev.files.length, dev.space.mine, dev.space.write], [1, false, false]);
    assert.equal(Buffer.from((await taku.call('GET', `/api/vault/chunk?id=${f.id}&n=0`)).data, 'base64').equals(data), true);
    for (const [m, url, body] of [['POST', '/api/vault/files', { space: ab, name: 'x', size: 10 }], ['POST', '/api/vault/delete', { id: f.id }],
      ['POST', '/api/vault/folders', { space: ab, name: '資料' }], ['POST', '/api/vault/notes', { id: f.id, text: '見ました', days: 1 }],
      ['POST', '/api/vault/move', { ids: [f.id], folder: '' }]]) {
      assert.equal((await taku.call(m, url, body)).error.code, 'read_only', `${m} ${url}`);
    }

    // links are the developer's vault's only: a whole-vault link never lists or gives a shared file
    assert.equal((await taku.call('POST', '/api/vault/link', { id: f.id, hours: 1 })).error.code, 'not_here');
    assert.equal((await taku.call('POST', '/api/vault/link/stop', { id: f.id })).error.code, 'not_here');
    assert.equal((await a.call('POST', '/api/vault/link', { id: '*', hours: 1 })).error.code, 'not_developer');
    const own = await put(taku, { name: 'garage.glb', data: crypto.randomBytes(900) });
    const link = await taku.call('POST', '/api/vault/link', { id: '*', hours: 1, ai: true });
    const pulled = await s.call('GET', link.path);
    assert.deepEqual(pulled.files.map((x) => x.name), ['garage.glb']);
    assert.equal((await s.call('GET', `${link.path}&f=${f.id}`)).status, 404);
    assert.equal((await s.call('GET', `${link.path}&f=${f.id}&n=0`)).status, 404);
    assert.equal((await s.call('POST', '/api/vault/ai', { body: { t: link.path.split('t=')[1], f: f.id, text: 'x' } })).status, 404);
    assert.equal((await s.call('GET', `${link.path}&f=${own.id}&n=0`)).status, 200);

    // the log (every operator reads it) never names what two operators keep
    const log = await actions(c);
    const shared = log.filter((e) => e.action === 'vault_upload' && e.summary.includes('共有保管庫'));
    assert.equal(shared.length, 1);
    assert.equal(shared[0].summary, '共有保管庫（Mod1⇄Mod2）にファイル（1KB）を保存');
    assert.ok(!JSON.stringify(log).includes('企画書'), 'no shared file name anywhere in the log');
    assert.ok(log.some((e) => e.action === 'vault_upload' && e.summary.includes('garage.glb')), 'the developer\'s files are named as before');
  } finally {
    await s.stop();
  }
});

test('the shared vaults and the developer\'s vault are one room', async () => {
  const s = await startServer({ operators: ['taku', 'mod1', 'mod2'], limits: LIMITS, vaultMaxMb: 2 });
  try {
    const taku = await developer(s);
    const a = await person(s, 'Mod1'), b = await person(s, 'Mod2');
    await put(taku, { name: 'big.glb', data: crypto.randomBytes(mbs(1.5)) });
    const full = await a.call('POST', '/api/vault/files', { space: pair(a, b), name: 'x.zip', size: mbs(0.6) });
    assert.deepEqual([full.status, full.error.code], [413, 'vault_full']);
    const small = await put(a, { space: pair(a, b), name: 'y.zip', data: crypto.randomBytes(mbs(0.4)) });
    const room = await taku.call('GET', '/api/vault/spaces');
    assert.equal(room.pool.used, mbs(1.5) + mbs(0.4));
    assert.equal((await a.call('GET', '/api/vault/spaces')).pool.used, mbs(1.5) + mbs(0.4));
    // the developer's own vault is full for the developer too
    assert.equal((await taku.call('POST', '/api/vault/files', { name: 'z.glb', size: mbs(0.2) })).error.code, 'vault_full');
    // the サーバー tab: the shared ones counted apart (no names)
    const srv = (await taku.call('GET', '/api/ops/server')).vault;
    assert.deepEqual([srv.used, srv.files, srv.shared.files, srv.shared.bytes, srv.shared.vaults], [mbs(1.5) + mbs(0.4), 1, 1, mbs(0.4), 1]);
    // gone from a shared vault: room again for everyone
    await b.call('POST', '/api/vault/delete', { id: small.id });
    assert.equal((await taku.call('GET', '/api/vault/spaces')).pool.used, mbs(1.5));
  } finally {
    await s.stop();
  }
});

test('1GB a person (here 1MB): past it only once the developer approves, always with a limit', async () => {
  const s = await startServer({ operators: ['taku', 'mod1', 'mod2'], limits: LIMITS, vaultFreeMb: 1, vaultMaxMb: 10 });
  try {
    const taku = await developer(s);
    const a = await person(s, 'Mod1'), b = await person(s, 'Mod2');
    const ab = pair(a, b);

    // what each one sent counts for them, in all their shared vaults
    await put(a, { space: ab, name: 'a1.bin', data: crypto.randomBytes(mbs(0.7)) });
    const over = await a.call('POST', '/api/vault/files', { space: pair(a, taku), name: 'a2.bin', size: mbs(0.4) });
    assert.deepEqual([over.status, over.error.code], [413, 'need_approval']);
    assert.match(over.error.message, /開発者の承認/);
    await put(b, { space: ab, name: 'b1.bin', data: crypto.randomBytes(mbs(0.9)) });
    assert.deepEqual((await a.call('GET', '/api/vault/spaces')).me.used, mbs(0.7));
    // the developer has no limit (their files in a shared vault count for the room only)
    await put(taku, { space: pair(a, taku), name: 'dev.bin', data: crypto.randomBytes(mbs(1.5)) });

    // the request: more than now, at most the whole vault; one open at a time
    assert.equal((await a.call('POST', '/api/vault/quota/request', { bytes: MB })).error.code, 'bad_bytes');
    assert.equal((await a.call('POST', '/api/vault/quota/request', { bytes: 11 * MB })).error.code, 'bad_bytes');
    assert.equal((await taku.call('POST', '/api/vault/quota/request', { bytes: 5 * MB })).error.code, 'developer');
    await a.call('POST', '/api/vault/quota/request', { bytes: 4 * MB, reason: '3Dモデルの素材' });
    const asked = await a.call('POST', '/api/vault/quota/request', { bytes: 5 * MB, reason: '3Dモデルの素材（追加）' });
    assert.deepEqual([asked.me.request.bytes, asked.me.request.reason, asked.me.limit], [5 * MB, '3Dモデルの素材（追加）', MB]);
    // the developer is told: the 保管庫 tab's count, everyone's use, the open requests
    assert.equal((await taku.call('GET', '/api/ops/players')).vaultRequests, 1);
    assert.equal((await a.call('GET', '/api/ops/players')).vaultRequests, 0);
    const look = await taku.call('GET', '/api/vault/spaces');
    assert.deepEqual(look.requests.map((r) => [r.user.name, r.bytes]), [['Mod1', 5 * MB]]);
    assert.deepEqual(look.people.map((p) => [p.name, p.used, p.limit]), [['Mod2', mbs(0.9), MB], ['Mod1', mbs(0.7), MB]]);
    const id = look.requests[0].id;

    // only the developer decides, and an approval needs the limit (more than 1MB here)
    assert.equal((await a.call('POST', '/api/vault/quota/decide', { id, approve: true, limit: 5 * MB })).error.code, 'not_developer');
    assert.equal((await taku.call('POST', '/api/vault/quota/decide', { id, approve: true })).error.code, 'need_limit');
    assert.equal((await taku.call('POST', '/api/vault/quota/decide', { id, approve: true, limit: MB })).error.code, 'need_limit');
    assert.equal((await taku.call('POST', '/api/vault/quota/decide', { id, approve: true, limit: 20 * MB })).error.code, 'need_limit');
    const ok = await taku.call('POST', '/api/vault/quota/decide', { id, approve: true, limit: 2 * MB });
    assert.deepEqual([ok.requests.length, ok.people.find((p) => p.name === 'Mod1').limit], [0, 2 * MB]);
    assert.equal((await taku.call('POST', '/api/vault/quota/decide', { id, approve: false })).error.code, 'done');
    const me = (await a.call('GET', '/api/vault/spaces')).me;
    assert.deepEqual([me.limit, me.approved.bytes, me.approved.by.name, me.request, me.last.status, me.last.limit], [2 * MB, 2 * MB, 'TAKU', null, 'approved', 2 * MB]);
    await put(a, { space: pair(a, taku), name: 'a2.bin', data: crypto.randomBytes(mbs(0.4)) });
    const past = await a.call('POST', '/api/vault/files', { space: ab, name: 'a3.bin', size: MB });
    assert.deepEqual([past.status, past.error.code], [413, 'over_limit']);

    // declined, and taken back
    await b.call('POST', '/api/vault/quota/request', { bytes: 3 * MB });
    const bid = (await taku.call('GET', '/api/vault/spaces')).requests[0].id;
    await taku.call('POST', '/api/vault/quota/decide', { id: bid, approve: false });
    const bme = (await b.call('GET', '/api/vault/spaces')).me;
    assert.deepEqual([bme.limit, bme.last.status, bme.request], [MB, 'declined', null]);
    await b.call('POST', '/api/vault/quota/request', { bytes: 3 * MB });
    assert.equal((await b.call('POST', '/api/vault/quota/cancel', {})).me.request, null);
    assert.equal((await b.call('POST', '/api/vault/quota/cancel', {})).error.code, 'no_request');
    assert.equal((await taku.call('GET', '/api/ops/players')).vaultRequests, 0);

    // the developer sets a limit by themselves, and takes it back to the standard
    assert.equal((await taku.call('POST', '/api/vault/quota/set', { user: b.id, limit: 3 * MB })).people.find((p) => p.name === 'Mod2').limit, 3 * MB);
    assert.equal((await b.call('GET', '/api/vault/spaces')).me.limit, 3 * MB);
    assert.equal((await taku.call('POST', '/api/vault/quota/set', { user: b.id, limit: 0 })).people.find((p) => p.name === 'Mod2').approved, null);
    assert.equal((await b.call('GET', '/api/vault/spaces')).me.limit, MB);
    assert.equal((await a.call('POST', '/api/vault/quota/set', { user: b.id, limit: 3 * MB })).error.code, 'not_developer');
    assert.equal((await taku.call('POST', '/api/vault/quota/set', { user: taku.id, limit: 3 * MB })).error.code, 'not_found');

    const log = (await actions(taku)).map((e) => e.action);
    for (const x of ['vault_quota_request', 'vault_quota_approve', 'vault_quota_decline', 'vault_quota_cancel', 'vault_quota_set']) assert.ok(log.includes(x), x);
  } finally {
    await s.stop();
  }
});

test('a partner who is no longer an operator: the other keeps the shared vault, nothing new goes in', async () => {
  const s = await startServer({ operators: ['taku', 'mod1'], limits: LIMITS });
  try {
    const taku = await developer(s);
    const a = await person(s, 'Mod1'), b = await person(s, 'Mod2');
    assert.equal((await taku.call('POST', '/api/ops/operator', { name: 'Mod2', action: 'grant', code: CODE })).status, 200);
    const ab = pair(a, b);
    const f = await put(b, { space: ab, name: 'b.bin', data: crypto.randomBytes(500) });
    assert.equal((await taku.call('POST', '/api/ops/operator', { name: 'Mod2', action: 'revoke', code: CODE })).status, 200);

    // Mod2 is out; Mod1 still has the vault, marked, and may look, tidy and delete, not add
    const list = await a.call('GET', '/api/vault/spaces');
    const shared = list.spaces.find((x) => x.id === ab);
    assert.deepEqual([shared.with.name, shared.with.operator, shared.files], ['Mod2', false, 1]);
    const there = await a.call('GET', `/api/vault/files?space=${ab}`);
    assert.deepEqual([there.space.write, there.space.add], [true, false]);
    assert.equal((await a.call('POST', '/api/vault/files', { space: ab, name: 'a.bin', size: 100 })).error.code, 'partner_gone');
    assert.equal((await a.call('POST', '/api/vault/folders', { space: ab, name: '整理' })).status, 200);
    assert.equal((await a.call('POST', '/api/vault/delete', { id: f.id })).deleted, 1);
    const login = await s.call('POST', '/api/login', { body: { name: 'Mod2', password: 'pass1234' } });
    assert.equal((await s.call('GET', `/api/vault/files?space=${ab}`, { token: login.token })).error.code, 'not_operator');
  } finally {
    await s.stop();
  }
});

test('checked items: files and folders moved or deleted together, in the developer\'s vault and a shared one', async () => {
  const bucket = memoryBucket();
  const s = await startServer({ operators: ['taku', 'mod1', 'mod2'], limits: LIMITS, blobs: bucket });
  try {
    const taku = await developer(s);
    const a = await person(s, 'Mod1'), b = await person(s, 'Mod2');
    for (const [who, space] of [[taku, ''], [a, pair(a, b)]]) {
      const folder = async (name, parent) => (await who.call('POST', '/api/vault/folders', { space, name, parent })).folder;
      const cars = await folder('車'), tracks = await folder('コース'), more = await folder('車', tracks.id);
      const model = await put(who, { space, name: 'sedan.glb', data: crypto.randomBytes(3000) });
      const light = await put(who, { space, name: 'sedan.light.glb', data: crypto.randomBytes(1000), parent: model.id });
      const memo = await put(who, { space, name: 'memo.txt', data: crypto.randomBytes(200) });
      const where = async () => {
        const r = await who.call('GET', `/api/vault/files${space ? '?space=' + space : ''}`);
        return { files: Object.fromEntries(r.files.map((f) => [f.name, f.folder])), folders: Object.fromEntries(r.folders.map((d) => [d.id, d.parent])) };
      };

      // files (a light copy goes with its model) and a folder, into one folder
      assert.equal((await who.call('POST', '/api/vault/move', { ids: [model.id, memo.id], folders: [tracks.id], folder: cars.id })).moved, 3);
      let now = await where();
      assert.deepEqual([now.files['sedan.glb'], now.files['sedan.light.glb'], now.files['memo.txt'], now.folders[tracks.id]], [cars.id, cars.id, cars.id, cars.id]);
      // never into itself, never two of one name side by side
      assert.equal((await who.call('POST', '/api/vault/move', { folders: [cars.id], folder: more.id })).error.code, 'inside');
      assert.equal((await who.call('POST', '/api/vault/move', { folders: [more.id], folder: '' })).error.code, 'exists');
      assert.equal((await who.call('POST', '/api/vault/move', { folders: [], ids: [], folder: '' })).error.code, 'no_files');

      // folders deleted together: what was in them goes up
      assert.equal((await who.call('POST', '/api/vault/folders/delete', { ids: [cars.id, tracks.id] })).deleted, 2);
      now = await where();
      assert.deepEqual([now.files['sedan.glb'], now.files['memo.txt'], now.folders[more.id]], ['', '', '']);
      assert.deepEqual(Object.keys(now.folders), [more.id]);

      // files deleted together (the light copy checked too goes once, with its model)
      const r = await who.call('POST', '/api/vault/delete', { ids: [model.id, light.id, memo.id, 'f'.repeat(32)] });
      assert.equal(r.deleted, 2);
      assert.deepEqual(Object.keys((await where()).files), []);
      await who.call('POST', '/api/vault/folders/delete', { id: more.id });
    }
    assert.equal(bucket.objects.size, 0, 'every piece left the bucket');

    // never two vaults in one go
    const mine = await put(taku, { name: 'own.bin', data: crypto.randomBytes(100) });
    const theirs = await put(taku, { space: pair(taku, a), name: 'with-mod1.bin', data: crypto.randomBytes(100) });
    assert.equal((await taku.call('POST', '/api/vault/delete', { ids: [mine.id, theirs.id] })).error.code, 'mixed');
    // an operator never reaches a file of the developer's vault, even among their own
    const ours = await put(a, { space: pair(a, b), name: 'ours.bin', data: crypto.randomBytes(100) });
    assert.equal((await a.call('POST', '/api/vault/delete', { ids: [ours.id, mine.id] })).status, 404);
    assert.equal((await b.call('POST', '/api/vault/delete', { ids: [ours.id] })).deleted, 1, 'either of the two may delete');

    const log = await actions(taku);
    assert.ok(log.some((e) => e.action === 'vault_delete' && /保管庫の2件（.+）を削除：「sedan\.glb」、「memo\.txt」/.test(e.summary)));
    assert.ok(log.some((e) => e.action === 'vault_delete' && /共有保管庫（Mod1⇄Mod2）のファイル2件（.+）を削除$/.test(e.summary)));
    assert.ok(log.some((e) => e.action === 'vault_folder' && e.summary.includes('共有保管庫（Mod1⇄Mod2）のフォルダ2個を削除')));
    assert.ok(log.some((e) => e.action === 'vault_move' && e.summary === '共有保管庫（Mod1⇄Mod2）で3件を移動'));
  } finally {
    await s.stop();
  }
});

test('each operator\'s own vault: only theirs (the developer looks), files of any kind made in it, counted in their 1GB', async () => {
  const s = await startServer({ operators: ['taku', 'mod1', 'mod2'], limits: LIMITS, vaultFreeMb: 1, vaultMaxMb: 10 });
  try {
    const taku = await developer(s);
    const a = await person(s, 'Mod1'), b = await person(s, 'Mod2');
    const mine = `u:${a.id}`;
    const sp = await a.call('GET', '/api/vault/spaces');
    assert.deepEqual([sp.personal.id, sp.personal.files], [mine, 0]);
    assert.ok(!sp.spaces.some((x) => x.id === mine), 'not among the shared ones');
    // an APK and a program, kept as they are
    const apk = await put(a, { space: mine, name: 'two-state-1.2.apk', data: crypto.randomBytes(3000) });
    const code = Buffer.from('print("hello")\n');
    const py = await a.call('POST', '/api/vault/files', { space: mine, name: 'main.py', size: code.length, type: 'text/x-python' });
    assert.deepEqual([py.file.name, py.file.type, apk.name], ['main.py', 'text/x-python', 'two-state-1.2.apk']);
    const f = await a.call('GET', `/api/vault/files?space=${mine}`);
    assert.deepEqual([f.space.kind, f.space.mine, f.space.write, f.space.add], ['own', true, true, true]);
    assert.ok(f.files.some((x) => x.name === 'two-state-1.2.apk'));
    // a folder, a new name
    assert.equal((await a.call('POST', '/api/vault/folders', { space: mine, name: 'アプリ' })).folder.space, mine);
    const renamed = await a.call('POST', '/api/vault/rename', { id: apk.id, name: 'two-state-1.3.apk' });
    assert.equal(renamed.file.name, 'two-state-1.3.apk');
    // nobody else's: another operator never sees it, the developer looks without changing
    assert.equal((await b.call('GET', `/api/vault/files?space=${mine}`)).error.code, 'no_space');
    assert.equal((await b.call('POST', '/api/vault/rename', { id: apk.id, name: 'x.apk' })).status, 404);
    const look = await taku.call('GET', `/api/vault/files?space=${mine}`);
    assert.deepEqual([look.files.length, look.space.write, look.space.kind], [2, false, 'own']);
    assert.equal((await taku.call('POST', '/api/vault/rename', { id: apk.id, name: 'x.apk' })).error.code, 'read_only');
    assert.deepEqual((await taku.call('GET', '/api/vault/spaces')).others.filter((x) => x.personal).map((x) => [x.id, x.members[0].name]), [[mine, 'Mod1']]);
    // the 1GB of each person (here 1MB) counts their own vault too
    const big = await a.call('POST', '/api/vault/files', { space: mine, name: 'big.bin', size: mbs(1) });
    assert.equal(big.error.code, 'need_approval');
    // the log names no file of it
    const log = await actions(taku);
    assert.ok(log.some((e) => e.action === 'vault_rename' && e.summary === '個人保管庫（Mod1）のファイル（3KB）の名前を変更'));
    assert.ok(!log.some((e) => e.summary.includes('two-state')));
  } finally {
    await s.stop();
  }
});

test('the developer\'s backups: any file of any vault (or a folder\'s), a badge on it, deleted it waits in the backups, back or gone for good', async () => {
  const bucket = memoryBucket();
  const s = await startServer({ operators: ['taku', 'mod1', 'mod2'], limits: LIMITS, blobs: bucket });
  try {
    const taku = await developer(s);
    const a = await person(s, 'Mod1'), b = await person(s, 'Mod2');
    const ab = pair(a, b);
    const theirs = await put(a, { space: ab, name: 'design.psd', data: crypto.randomBytes(5000) });
    const own = await put(a, { space: `u:${a.id}`, name: 'notes.txt', data: Buffer.from('メモ') });
    const dir = (await taku.call('POST', '/api/vault/folders', { name: '車' })).folder;
    const inner = (await taku.call('POST', '/api/vault/folders', { name: '新車', parent: dir.id })).folder;
    const car = await put(taku, { name: 'car.glb', data: crypto.randomBytes(2000), folder: inner.id });

    // the developer only, with the code
    assert.equal((await a.call('POST', '/api/vault/backup', { ids: [theirs.id] })).error.code, 'not_developer');
    const locked = { ...taku, ticket: '' };
    locked.call = (method, url, body) => s.call(method, url, { token: taku.token, body });
    assert.equal((await locked.call('POST', '/api/vault/backup', { ids: [theirs.id] })).error.code, 'vault_locked');
    const r = await taku.call('POST', '/api/vault/backup', { ids: [theirs.id, own.id], folders: [dir.id] });
    assert.equal(r.changed, 3, JSON.stringify(r));
    // the badge, everyone who sees the file sees it
    const seen = (await a.call('GET', `/api/vault/files?space=${ab}`)).files.find((x) => x.id === theirs.id);
    assert.deepEqual([!!seen.backup, seen.backup.by.name, seen.backup.removed], [true, 'TAKU', null]);
    const list = await taku.call('GET', '/api/vault/files?space=backup');
    assert.deepEqual(list.files.map((x) => x.name).sort(), ['car.glb', 'design.psd', 'notes.txt']);
    assert.equal(list.space.kind, 'backup');
    assert.deepEqual((await taku.call('GET', '/api/vault/spaces')).backups, { files: 3, removed: 0, bytes: 0 });

    // deleted from its vault (by the operators): gone for them, waiting in the backups
    const del = await a.call('POST', '/api/vault/delete', { id: theirs.id });
    assert.deepEqual([del.deleted, del.kept], [1, 1]);
    assert.ok(!(await a.call('GET', `/api/vault/files?space=${ab}`)).files.some((x) => x.id === theirs.id));
    assert.equal((await a.call('GET', '/api/vault/spaces')).me.used, 6, 'no longer theirs to count (the personal one\'s 6 bytes left)');
    const waiting = (await taku.call('GET', '/api/vault/files?space=backup')).files.find((x) => x.id === theirs.id);
    assert.deepEqual([waiting.space, waiting.backup.removed.from, waiting.backup.removed.by.name], ['backup', ab, 'Mod1']);
    assert.ok([...bucket.objects.keys()].some((k) => k.startsWith(`vault/${theirs.id}/`)), 'its pieces stay');
    // nothing new goes into the backups directly
    assert.equal((await taku.call('POST', '/api/vault/files', { space: 'backup', name: 'x', size: 10 })).error.code, 'not_here');
    // back where it was
    const back = await taku.call('POST', '/api/vault/backups/restore', { id: theirs.id });
    assert.deepEqual([back.file.space, back.file.backup.removed], [ab, null]);
    assert.ok((await b.call('GET', `/api/vault/files?space=${ab}`)).files.some((x) => x.id === theirs.id));

    // the developer's own, deleted, then deleted from the backups: gone for good
    await taku.call('POST', '/api/vault/delete', { id: car.id });
    assert.equal((await taku.call('GET', `/api/vault/files`)).files.length, 0);
    const gone = await taku.call('POST', '/api/vault/delete', { id: car.id });
    assert.deepEqual([gone.deleted, gone.kept], [1, 0]);
    assert.ok(![...bucket.objects.keys()].some((k) => k.startsWith(`vault/${car.id}/`)), 'out of the bucket');
    // no longer backed up: deleting it takes it for good
    await taku.call('POST', '/api/vault/backup', { ids: [own.id], on: false });
    assert.equal((await a.call('GET', `/api/vault/files?space=u:${a.id}`)).files[0].backup, null);
    assert.equal((await a.call('POST', '/api/vault/delete', { id: own.id })).kept, 0);

    const log = await actions(taku);
    assert.ok(log.some((e) => e.action === 'vault_backup' && e.summary === '共有保管庫（Mod1⇄Mod2）・個人保管庫（Mod1）・保管庫の3件（7KB）をバックアップ'));
    assert.ok(log.some((e) => e.action === 'vault_delete' && e.summary === '共有保管庫（Mod1⇄Mod2）のファイル（5KB）を削除（開発者のバックアップに残ります）'));
    assert.ok(log.some((e) => e.action === 'vault_delete' && e.summary === 'バックアップの「car.glb」（2KB）を削除（完全に削除）'));
    assert.ok(log.some((e) => e.action === 'vault_backup_restore'));
  } finally {
    await s.stop();
  }
});

test('an AI comments on a file through its link; the developer sees it as by AI', async () => {
  const s = await startServer({ operators: ['taku'], limits: LIMITS });
  try {
    const taku = await developer(s);
    const f = await put(taku, { name: 'sedan.glb', data: crypto.randomBytes(500) });
    const { token } = await taku.call('POST', '/api/vault/link', { id: f.id, hours: 1, ai: true });
    const ai = (body) => s.call('POST', '/api/vault/ai', { body: { t: token, f: f.id, ...body } });
    assert.equal((await ai({ comment: '' })).error.code, 'empty');
    assert.equal((await ai({ comment: 'x', days: 2 })).error.code, 'bad_days');
    const r = await ai({ comment: 'テクスチャが重いので軽量版を使います' });
    assert.deepEqual(r.notes.map((n) => [n.text, n.by]), [['テクスチャが重いので軽量版を使います', 'AI']]);
    const mine = (await taku.call('GET', '/api/vault/files')).files[0].notes;
    assert.deepEqual(mine.map((n) => [n.text, n.by.name, !!n.by.ai, n.until]), [['テクスチャが重いので軽量版を使います', 'AI', true, 0]]);
    const pulled = await s.call('GET', `/api/vault/pull?t=${token}`);
    assert.deepEqual(pulled.notes.map((n) => n.by), ['AI']);
    assert.ok(pulled.how.comment.includes('comment'));
    // a plain link cannot comment
    const plain = (await taku.call('POST', '/api/vault/link', { id: f.id, hours: 1 })).token;
    assert.equal((await s.call('POST', '/api/vault/ai', { body: { t: plain, f: f.id, comment: 'x' } })).status, 404);
  } finally {
    await s.stop();
  }
});

// a piece sent as it is (POST /api/vault/piece), with its SHA-256
const sendPiece = (s, who, f, n, part, headers = {}) => fetch(`${s.base}/api/vault/piece?id=${f.id}&n=${n}`, {
  method: 'POST', body: part,
  headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/octet-stream', 'X-Piece-SHA256': hash(part), ...headers }
}).then(async (r) => ({ ...(await r.json()), status: r.status }));

test('big uploads: pieces sent as they are, the upload\'s own pass goes on with the vault closed, clear refusals', async () => {
  for (const blobs of [null, memoryBucket()]) {
    const s = await startServer({ operators: ['taku', 'mod1'], limits: LIMITS, blobs, vaultPieceMb: 1 });
    try {
      const taku = await developer(s);
      const mod = await person(s, 'Mod1');
      const data = crypto.randomBytes(mbs(2.5));
      const r = await taku.call('POST', '/api/vault/files', { name: 'big.glb', size: data.length, type: 'model/gltf-binary' });
      assert.equal(r.file.chunks, 3);
      assert.match(r.upload, /^\d+\.[0-9a-f]{32}\.\d{13}\.[\w-]{43}$/, 'the upload\'s own pass');
      const f = r.file, part = (n) => data.subarray(n * f.piece, (n + 1) * f.piece);
      // the first piece with the ticket
      assert.equal((await sendPiece(s, taku, f, 0, part(0), { 'X-Vault-Ticket': taku.ticket })).status, 200);
      // the vault closed (no ticket): the pass alone is enough for this file's pieces and its end
      const pass = { 'X-Vault-Upload': r.upload };
      assert.equal((await sendPiece(s, taku, f, 1, part(1))).error.code, 'vault_locked', 'neither ticket nor pass');
      assert.equal((await sendPiece(s, taku, f, 1, part(1), pass)).status, 200);
      // a broken or short piece: told plainly, and nothing kept
      const bad = Buffer.from(part(2)); bad[0] ^= 1;
      const broken = await fetch(`${s.base}/api/vault/piece?id=${f.id}&n=2`, { method: 'POST', body: bad, headers: { Authorization: `Bearer ${taku.token}`, 'X-Piece-SHA256': hash(part(2)), ...pass } }).then((x) => x.json());
      assert.equal(broken.error.code, 'bad_hash');
      assert.match(broken.error.message, /自動でもう一度送ります/);
      const short = await sendPiece(s, taku, f, 2, part(2).subarray(0, 100), pass);
      assert.equal(short.error.code, 'piece_size');
      const missing = await s.call('GET', `/api/vault/missing?id=${f.id}`, { token: taku.token, headers: pass });
      assert.deepEqual(missing.missing, [[2, 2]]);
      assert.match(missing.upload, /^\d+\./, 'a new pass with it');
      assert.equal((await sendPiece(s, taku, f, 2, part(2), pass)).status, 200);
      const done = await s.call('POST', '/api/vault/finish', { token: taku.token, body: { id: f.id }, headers: pass });
      assert.equal(done.done, true, JSON.stringify(done));
      // the whole file comes back the same
      const back = [];
      for (let n = 0; n < 3; n++) back.push(Buffer.from((await taku.call('GET', `/api/vault/chunk?id=${f.id}&n=${n}`)).data, 'base64'));
      assert.ok(Buffer.concat(back).equals(data));
      // the pass is that file's and that person's only: another file still needs the ticket
      const other = await taku.call('POST', '/api/vault/files', { name: 'other.bin', size: 10 });
      assert.equal((await sendPiece(s, taku, other.file, 0, Buffer.alloc(10, 1), pass)).error.code, 'vault_locked');
      // a model's light copy may come with the model's pass (the vault closed meanwhile)
      const light = await s.call('POST', '/api/vault/files', { token: taku.token, body: { name: 'big.light.glb', size: 5, parent: f.id }, headers: pass });
      assert.equal(light.status, 200, JSON.stringify(light));
      assert.equal((await s.call('POST', '/api/vault/files', { token: taku.token, body: { name: 'x.bin', size: 5 }, headers: pass })).error.code, 'vault_locked', 'not a new file of its own');
      // an operator's own upload needs no code; someone else's pass is nothing to them
      const own = await mod.call('POST', '/api/vault/files', { space: `u:${mod.id}`, name: 'a.bin', size: 4 });
      assert.equal((await sendPiece(s, mod, own.file, 0, Buffer.from('abcd'))).status, 200);
      assert.equal((await sendPiece(s, mod, f, 0, part(0), pass)).error.code, 'no_file');
      // an empty file: what to do about it, said plainly
      const empty = await taku.call('POST', '/api/vault/files', { name: 'empty.txt', size: 0 });
      assert.equal(empty.error.code, 'bad_size');
      assert.match(empty.error.message, /0バイト/);
    } finally {
      await s.stop();
    }
  }
});

test('Cloudflare: a vault piece goes from the Worker straight into R2 (the object is only asked), R2 checks its hash', async () => {
  const bucket = memoryBucket();
  const s = await startServer({ operators: ['taku'], limits: LIMITS, blobs: bucket, vaultPieceMb: 1 });
  try {
    const taku = await developer(s);
    // the object: here, the Node server (the same core); R2: the bucket the server reads, checking SHA-256 as R2 does
    const asked = [];
    const casino = { fetch: async (req) => {
      const u = new URL(req.url);
      asked.push(u.pathname);
      const body = req.method === 'GET' ? undefined : await req.arrayBuffer();
      return fetch(s.base + u.pathname + u.search, { method: req.method, headers: req.headers, body });
    } };
    const VAULT = {
      async put(key, stream, opts) {
        const bytes = Buffer.from(await new Response(stream).arrayBuffer());
        if (hash(bytes) !== opts.sha256) throw new Error('put: The SHA-256 checksum you specified did not match what we received.');
        await bucket.put(key, bytes, opts.customMetadata.sha256);
      },
      async delete(key) { await bucket.del([key]); }
    };
    const env = { VAULT, ASSETS: { fetch: () => new Response('') }, CASINO: { idFromName: () => 'main', get: () => casino } };
    const { default: worker } = await import('../cloudflare/worker.js');
    const data = crypto.randomBytes(mbs(1.5));
    const r = await taku.call('POST', '/api/vault/files', { name: 'car.glb', size: data.length });
    const f = r.file, part = (n) => data.subarray(n * f.piece, (n + 1) * f.piece);
    const put = (n, body, sha = hash(part(n)), extra = {}) => worker.fetch(new Request(`https://x/api/vault/piece?id=${f.id}&n=${n}`, {
      method: 'POST', body, headers: { Authorization: `Bearer ${taku.token}`, 'X-Vault-Upload': r.upload, 'X-Piece-SHA256': sha, 'Content-Length': String(body.length), ...extra }
    }), env).then(async (x) => ({ ...(await x.json()), status: x.status }));
    const a = await put(0, part(0));
    assert.deepEqual([a.status, a.stored], [200, true], JSON.stringify(a));
    assert.deepEqual(asked, ['/api/vault/permit', '/api/vault/stored'], 'the object only asked, never sent the piece');
    assert.ok(bucket.objects.has(`vault/${f.id}/0`));
    // broken on the way: R2 refuses it, said plainly
    const bad = Buffer.from(part(1)); bad[5] ^= 1;
    const b = await put(1, bad, hash(part(1)));
    assert.deepEqual([b.status, b.error.code], [400, 'bad_hash']);
    // the wrong size: the object says no before anything is stored
    const c = await put(1, part(1).subarray(0, 10));
    assert.equal(c.error.code, 'piece_size');
    assert.equal((await put(1, part(1))).status, 200);
    const done = await s.call('POST', '/api/vault/finish', { token: taku.token, body: { id: f.id }, headers: { 'X-Vault-Upload': r.upload } });
    assert.equal(done.done, true, JSON.stringify(done));
    // a file deleted while its piece was on the way: the piece does not stay
    const g = await taku.call('POST', '/api/vault/files', { name: 'gone.bin', size: 100 });
    const gonePut = VAULT.put;
    VAULT.put = async (key, stream, opts) => { await gonePut(key, stream, opts); await taku.call('POST', '/api/vault/delete', { id: g.file.id }); };
    const gone = await worker.fetch(new Request(`https://x/api/vault/piece?id=${g.file.id}&n=0`, {
      method: 'POST', body: Buffer.alloc(100, 7), headers: { Authorization: `Bearer ${taku.token}`, 'X-Vault-Upload': g.upload, 'X-Piece-SHA256': hash(Buffer.alloc(100, 7)), 'Content-Length': '100' }
    }), env);
    assert.equal(gone.status, 404);
    assert.ok(![...bucket.objects.keys()].some((k) => k.startsWith(`vault/${g.file.id}/`)));
  } finally {
    await s.stop();
  }
});
