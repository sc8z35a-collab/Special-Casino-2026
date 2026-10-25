// Extensions (server/core/ext.js): a part this deployment adds — tables, routes under the
// operator site's gate, a say in what goes into the vault and the diary, and files for the
// operator site that come by a ticket — and what happens when one that guarded the uploads
// is not there any more. The part here is a sample made for the test; the game has none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.js';
import { createAdmin } from '../core/admin.js';

const CODE = '987654321098';
const LIMITS = { general: [100000, 1000], login: [100000, 1000], vaultWork: [100000, 1000], vaultPull: [100000, 1000], vaultOpen: [100000, 1000] };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// a sample part: a table, two routes, a rule for the vault and the diary, two files for the operator site
const sample = (log = [], mood = { bad: false }) => ({
  id: 'sample', version: '1.2', guards: ['upload'],
  migrations: [['CREATE TABLE x_sample (id INTEGER PRIMARY KEY, note TEXT NOT NULL)'], ['ALTER TABLE x_sample ADD COLUMN at INTEGER NOT NULL DEFAULT 0']],
  routes: (ctx) => ({
    'GET /api/ops/x/ticket': (req, u) => ({ held: ctx.holdsTicket(req, u) }),
    'GET /api/ops/x/sample': (req, u) => {
      if (!ctx.isDeveloper(u)) throw new ctx.ApiError(403, 'not_developer', 'no');
      return { rows: ctx.q('SELECT * FROM x_sample ORDER BY id').all() };
    },
    'POST /api/ops/x/sample': async (req, u) => {
      if (!ctx.isDeveloper(u)) throw new ctx.ApiError(403, 'not_developer', 'no');
      const b = await req.json();
      ctx.q('INSERT INTO x_sample (note) VALUES (?)').run(String(b.note));
      return { ok: true };
    }
  }),
  // the patrol looks at what a part says of itself
  checks: () => [{ id: 'self', label: 'sample part', fn: async () => (mood.bad ? [{ id: 'sample-bad', level: 'high', text: 'the sample part is not well' }] : []) }],
  hooks: {
    create(info, ctx) { log.push(['create', info.name, info.size, info.user.name]); if (info.name.endsWith('.nope')) throw new ctx.ApiError(403, 'refused', 'refused at the door'); },
    finish(info, ctx) { log.push(['finish', info.file.name, info.fingerprint.length, info.digests.length]); if (info.file.name.startsWith('bad-')) throw new ctx.ApiError(403, 'refused', 'refused at the end'); },
    refused(info) { log.push(['refused', info.file.name, info.user.name]); },
    restart(info, ctx) { log.push(['restart', info.file.name, info.restarts]); if (info.file.name.startsWith('no-again-')) throw new ctx.ApiError(403, 'refused', 'not again'); },
    inline(info, ctx) { log.push(['inline', info.kind, info.bytes ? info.bytes.length : 0]); if (info.kind === 'diary' && info.refuse) throw new ctx.ApiError(403, 'refused', 'refused'); }
  },
  assets: {
    'a.js': { body: 'window.__sample = 1;', kind: 'script' },
    'w.js': { body: 'self.onmessage = () => {};', kind: 'worker', headers: { 'Content-Security-Policy': "default-src 'none'; connect-src 'none'" } },
    'secret.js': { body: 'window.__secret = 1;', kind: 'script' }
  },
  boot: (u, ctx) => (ctx.isDeveloper(u) ? ['a.js', 'w.js'] : ctx.ops.isOperator(u) ? ['a.js'] : [])
});

async function developer(s) {
  const taku = await s.register('taku');
  const call = (method, url, body, headers = {}) => s.call(method, url, { token: taku.token, body, headers });
  await call('POST', '/api/ops/dev-code', { code: CODE });
  const ticket = (await call('POST', '/api/vault/open', { code: CODE })).ticket;
  return { ...taku, call, ticket, vcall: (method, url, body) => call(method, url, body, { 'X-Vault-Ticket': ticket }) };
}
async function putFile(who, name, data) {
  const r = await who.vcall('POST', '/api/vault/files', { name, size: data.length, type: 'application/octet-stream' });
  if (!r.file) return r;
  for (let n = 0; n < r.file.chunks; n++) {
    const part = data.subarray(n * r.file.piece, (n + 1) * r.file.piece);
    const c = await who.vcall('POST', '/api/vault/chunk', { id: r.file.id, n, sha256: sha(part), data: part.toString('base64') });
    if (c.status !== 200) return { ...c, id: r.file.id };
  }
  return who.vcall('POST', '/api/vault/finish', { id: r.file.id });
}

test('with no extension nothing is there: no files for the site, no ticket works', async (t) => {
  const s = await startServer({ operators: ['taku'], limits: LIMITS });
  t.after(() => s.stop());
  const dev = await developer(s);
  assert.deepEqual(await dev.call('GET', '/api/ops/ext').then(({ assets, missing }) => ({ assets, missing })), { assets: [], missing: false });
  assert.equal((await s.call('GET', '/api/ext/asset?n=a.js&t=1.1792908351390.' + 'A'.repeat(43))).status, 404);
  assert.equal((await putFile(dev, 'plain.bin', Buffer.from('hello'))).done, true, 'uploads are as they were');
});

test('a part brings tables, routes under the gate, files by ticket, and a say in what comes in', async (t) => {
  const log = [];
  const s = await startServer({ operators: ['taku', 'mod'], limits: LIMITS, extensions: [sample(log)] });
  t.after(() => s.stop());
  const dev = await developer(s);
  const mod = await s.register('mod');
  const player = await s.register('Plainone');

  // its tables (each group once), its routes (the developer's; others refused)
  assert.equal((await dev.call('POST', '/api/ops/x/sample', { note: 'hello' })).ok, true);
  assert.deepEqual((await dev.call('GET', '/api/ops/x/sample')).rows.map((r) => r.note), ['hello']);
  assert.equal(s.app.db.prepare("SELECT value FROM meta WHERE key = 'ext_schema:sample'").get().value, '2');
  assert.equal((await s.call('GET', '/api/ops/x/sample', { token: mod.token })).error.code, 'not_developer');
  assert.equal((await s.call('GET', '/api/ops/x/sample', { token: player.token })).error.code, 'not_operator', 'a plain player never reaches it');
  assert.equal((await s.call('GET', '/api/ops/x/sample')).status, 401);
  // a route may ask whether the request holds the developer's code ticket
  assert.equal((await dev.call('GET', '/api/ops/x/ticket')).held, false);
  assert.equal((await dev.vcall('GET', '/api/ops/x/ticket')).held, true);
  assert.equal((await s.call('GET', '/api/ops/x/ticket', { token: mod.token })).held, true, 'for anyone else the question has no ticket to ask for');

  // files for the site: by person, each with a ticket that is good for two minutes
  const boot = await dev.call('GET', '/api/ops/ext');
  assert.deepEqual(boot.assets.map((a) => [a.name, a.kind]), [['a.js', 'script'], ['w.js', 'worker']]);
  assert.deepEqual((await s.call('GET', '/api/ops/ext', { token: mod.token })).assets.map((a) => a.name), ['a.js']);
  assert.deepEqual((await s.call('GET', '/api/ops/ext', { token: player.token })).status, 403);
  const get = (a) => fetch(s.base + a.url);
  const js = await get(boot.assets[0]);
  assert.equal(js.status, 200);
  assert.equal(await js.text(), 'window.__sample = 1;');
  assert.match(js.headers.get('content-type'), /^text\/javascript/);
  assert.equal(js.headers.get('cache-control'), 'no-store');
  const worker = await get(boot.assets[1]);
  assert.equal(worker.headers.get('content-security-policy'), "default-src 'none'; connect-src 'none'", 'a worker comes with its own policy: no network');
  // a ticket for another file, a changed one, an old one: nothing
  const url = new URL(s.base + boot.assets[0].url);
  assert.equal((await fetch(s.base + '/api/ext/asset?n=secret.js&t=' + url.searchParams.get('t'))).status, 404);
  assert.equal((await fetch(s.base + '/api/ext/asset?n=a.js&t=' + url.searchParams.get('t').replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).status, 404);
  const [id, , sig] = url.searchParams.get('t').split('.');
  assert.equal((await fetch(s.base + `/api/ext/asset?n=a.js&t=${id}.${Date.now() - 1000}.${sig}`)).status, 404);
  // …and one for a person who is not allowed it (the mod has no worker)
  const modTicket = new URL(s.base + (await s.call('GET', '/api/ops/ext', { token: mod.token })).assets[0].url).searchParams.get('t');
  assert.equal((await fetch(s.base + '/api/ext/asset?n=w.js&t=' + modTicket)).status, 404);

  // the vault: asked at the door and at the end; a refused file is taken out again
  const ok = await putFile(dev, 'fine.bin', Buffer.from('fine'));
  assert.equal(ok.done, true);
  assert.deepEqual(log.filter((x) => x[0] !== 'inline').map((x) => x.slice(0, 2)), [['create', 'fine.bin'], ['finish', 'fine.bin']]);
  const door = await dev.vcall('POST', '/api/vault/files', { name: 'x.nope', size: 4, type: 'application/octet-stream' });
  assert.deepEqual([door.status, door.error.code], [403, 'refused']);
  const end = await putFile(dev, 'bad-one.bin', Buffer.from('badbadbad'));
  assert.deepEqual([end.status, end.error.code], [403, 'refused']);
  assert.deepEqual(log.filter((x) => x[0] === 'refused'), [['refused', 'bad-one.bin', 'taku']], 'and the part is told once it is taken out');
  const left = (await dev.vcall('GET', '/api/vault/files')).files.map((f) => f.name);
  assert.deepEqual(left, ['fine.bin'], 'the refused file is not kept');
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM vault_chunks').get().n, 1, 'nor its pieces');

  // the diary's picture comes in whole
  const diary = (refuse) => dev.call('POST', '/api/ops/diary', { title: 't', text: 'x', image: '', reward: 0, refuse });
  assert.equal((await diary(false)).status, 200);
  assert.ok(log.some((x) => x[0] === 'inline' && x[1] === 'diary'));
});

test('a part that guarded the uploads and is gone shuts them, the patrol says so, and the developer can let it go', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-ext-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let s = await startServer({ operators: ['taku'], limits: LIMITS, dataDir, extensions: [sample()] });
  let dev = await developer(s);
  assert.equal((await putFile(dev, 'one.bin', Buffer.from('1'))).done, true);
  await s.stop();

  // the same data, the part left out of the deploy
  s = await startServer({ operators: ['taku'], limits: LIMITS, dataDir, extensions: [] });
  dev = await s.call('POST', '/api/login', { body: { name: 'taku', password: 'pass1234' } });
  const call = (method, url, body, headers = {}) => s.call(method, url, { token: dev.token, body, headers });
  const ticket = (await call('POST', '/api/vault/open', { code: CODE })).ticket;
  const shut = await call('POST', '/api/vault/files', { name: 'two.bin', size: 1, type: 'application/octet-stream' }, { 'X-Vault-Ticket': ticket });
  assert.deepEqual([shut.status, shut.error.code], [503, 'unavailable']);
  assert.equal((await call('GET', '/api/ops/ext')).missing, true);
  const patrol = (await call('POST', '/api/ops/patrol/run', {})).patrol;
  assert.ok(patrol.findings.some((f) => f.id === 'parts:sample' && f.level === 'high'), JSON.stringify(patrol.findings));
  // meant: the developer says so (the command line), and after a restart the uploads are open
  const admin = createAdmin(s.app.db, { isDeveloper: () => true });
  assert.deepEqual(await admin.command('ext-forget', ['sample']), { id: 'sample', removed: true });
  await s.stop();
  s = await startServer({ operators: ['taku'], limits: LIMITS, dataDir, extensions: [] });
  dev = await s.call('POST', '/api/login', { body: { name: 'taku', password: 'pass1234' } });
  const open = (await s.call('POST', '/api/vault/open', { token: dev.token, body: { code: CODE } })).ticket;
  const again = await s.call('POST', '/api/vault/files', { token: dev.token, body: { name: 'two.bin', size: 1, type: 'application/octet-stream' }, headers: { 'X-Vault-Ticket': open } });
  assert.equal(again.status, 200);
  await s.stop();
});

test('a file sent again from its beginning (by itself, five times at most): what arrived goes, a refusal at the gate is final, 上限速 is a speed', async (t) => {
  const log = [];
  const s = await startServer({ operators: ['taku'], limits: LIMITS, extensions: [sample(log)], vaultPieceMb: 1 });
  t.after(() => s.stop());
  const dev = await developer(s);
  const unfinished = async (name) => {
    const data = crypto.randomBytes(2.5 * 1048576), r = await dev.vcall('POST', '/api/vault/files', { name, size: data.length, type: 'application/octet-stream' });
    const part = data.subarray(0, r.file.piece);
    assert.equal((await dev.vcall('POST', '/api/vault/chunk', { id: r.file.id, n: 0, sha256: sha(part), data: part.toString('base64') })).status, 200);
    return r.file;
  };
  const f = await unfinished('again.bin');
  assert.deepEqual((await dev.vcall('GET', `/api/vault/missing?id=${f.id}`)).missing, [[1, 2]]);
  for (let i = 1; i <= 5; i++) {
    const r = await dev.vcall('POST', '/api/vault/restart', { id: f.id });
    assert.deepEqual([r.ok, r.restarts], [true, i]);
  }
  assert.deepEqual((await dev.vcall('GET', `/api/vault/missing?id=${f.id}`)).missing, [[0, 2]], 'every piece again');
  const sixth = await dev.vcall('POST', '/api/vault/restart', { id: f.id });
  assert.deepEqual([sixth.status, sixth.error.code], [409, 'restarts_used']);
  assert.ok(log.filter((e) => e[0] === 'restart' && e[1] === 'again.bin').length >= 5, 'the part at the gate was asked each time');
  // what the part refuses is final (the page does not send it again), and what it lets pass is checked at the end as ever
  const refused = await unfinished('no-again-' + 'x.bin');
  const no = await dev.vcall('POST', '/api/vault/restart', { id: refused.id });
  assert.deepEqual([no.status, no.error.code, no.error.final], [403, 'refused', true]);
  assert.equal((await dev.vcall('POST', '/api/vault/restart', { id: 'f'.repeat(32) })).status, 404);
  // the speed above 最速
  const top = await dev.call('POST', '/api/vault/speed', { speed: 'limit' });
  assert.deepEqual([top.speed.id, top.speed.name, top.speed.files], ['limit', '上限速', 5]);
});

test('a part\'s own check is looked at by the patrol, and what it finds is told once', async (t) => {
  const mood = { bad: false };
  const s = await startServer({ operators: ['taku'], limits: LIMITS, extensions: [sample([], mood)] });
  t.after(() => s.stop());
  const dev = await developer(s);
  const run = async () => (await dev.call('POST', '/api/ops/patrol/run', {})).patrol;
  const calm = await run();
  assert.equal(calm.findings.length, 0);
  assert.ok(calm.checks.some((c) => c.id === 'sample:self'), JSON.stringify(calm.checks));
  mood.bad = true;
  const bad = await run();
  assert.deepEqual(bad.findings.map((f) => [f.level, f.text]), [['high', 'the sample part is not well']]);
  assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM ops_log WHERE action = 'patrol_alert'").get().n, 1);
  await run();
  assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM ops_log WHERE action = 'patrol_alert'").get().n, 1, 'once, not at every look');
});
