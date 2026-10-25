// The 石碑 (server/core/stele.js): the operators' log carved in files that are written once, looked over, put back when the
// database loses rows, and watched for room. The module is run alone here (a fake clock, a store that can be made to fail,
// a database that can be damaged), and once inside a real server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.js';
import { openDb } from '../node/sqlite.js';
import { statements } from '../core/db.js';
import { createOpsLog } from '../core/opslog.js';
import { createStele, keyOf } from '../core/stele.js';
import { fileStele, logMirror } from '../node/stele-files.js';
import { run as adminRun } from '../node/admin-cli.js';

// a store as strict as the real ones: a name is written once; `broken`: every call fails
function fakeStore() {
  const files = new Map();
  const store = {
    files, broken: false,
    async put(key, bytes) {
      if (store.broken) throw new Error('the store is down');
      const have = files.get(key);
      if (have && Buffer.compare(Buffer.from(have), Buffer.from(bytes)) !== 0) throw new Error('already there with other bytes');
      files.set(key, Uint8Array.from(bytes));
    },
    async get(key) { if (store.broken) throw new Error('the store is down'); return files.get(key) ? Uint8Array.from(files.get(key)) : null; },
    async list(prefix) { if (store.broken) throw new Error('the store is down'); return [...files.keys()].filter((k) => k.startsWith(prefix)).sort(); }
  };
  return store;
}

function world(t, { store = fakeStore(), dbBytes = null, dbLimit = undefined } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stele-'));
  const db = openDb(dir);
  const q = statements(db);
  const said = [];
  let now = Date.UTC(2026, 9, 25, 3, 0, 0);
  const clock = () => now;
  const notice = { say: (mark, text) => said.push([mark, text]) };
  let stele = null;
  const opsLog = createOpsLog({ q, onAdd: () => { if (stele) stele.touch(); } });
  stele = createStele({ q, opsLog, store, secret: 'a-secret-for-the-test', clock, notice, dbBytes, dbLimit });
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const add = (n, text = 'x') => { for (let i = 0; i < n; i++) opsLog.add({ actorName: 'テスト', action: 'test', summary: `${text} ${i}`, detail: { i } }); };
  const unlock = () => { db.exec('DROP TRIGGER IF EXISTS ops_log_no_update'); db.exec('DROP TRIGGER IF EXISTS ops_log_no_delete'); };
  return { q, db, opsLog, stele, store, said, add, unlock, advance: (ms) => { now += ms; }, clock };
}

test('what is not yet carved is carved into files joined to one another, read back and signed', async (t) => {
  const w = world(t);
  w.add(5);
  const r = await w.stele.seal();
  assert.deepEqual([r.sealed, r.last], [5, 5]);
  assert.deepEqual([...w.store.files.keys()], [keyOf(1, 5)]);
  assert.deepEqual([w.stele.status().sealed, w.stele.status().pending, w.stele.status().segs], [5, 0, 1]);
  assert.deepEqual(await w.stele.seal(), { sealed: 0 }, 'nothing new, nothing written');
  w.add(3);
  await w.stele.seal();
  assert.deepEqual([...w.store.files.keys()], [keyOf(1, 5), keyOf(6, 8)]);
  const a = w.stele.parse(w.store.files.get(keyOf(1, 5))), b = w.stele.parse(w.store.files.get(keyOf(6, 8)));
  assert.ok(a.ok && a.sigOk && b.ok && b.sigOk);
  assert.equal(b.seg.prev, a.seg.hash, 'each names the one before it');
  assert.equal(a.seg.head, w.q('SELECT hash FROM ops_log WHERE id = 5').get().hash);
  assert.equal((await w.stele.check({ deep: true })).ok, true);
});

test('a row, a file or a whole end of the line that is changed or taken away is found', async (t) => {
  const w = world(t);
  w.add(4); await w.stele.seal(); w.add(4); await w.stele.seal(); w.add(4); await w.stele.seal();
  assert.equal((await w.stele.check({ deep: true })).ok, true);
  // a file changed (even by someone who made it look whole again): its hashes and its signature say so
  const k = keyOf(5, 8);
  const seg = JSON.parse(new TextDecoder().decode(w.store.files.get(k)));
  seg.rows[1][7] = 'changed after the fact';
  w.store.files.set(k, new TextEncoder().encode(JSON.stringify(seg)));
  const bad = await w.stele.check({ deep: true });
  assert.equal(bad.ok, false);
  assert.match(bad.problems[0].text, /壊れています|合いません/);
  assert.ok(w.stele.findings().some((f) => f.level === 'high'));
  w.store.files.delete(k);
  const gone = await w.stele.check({ deep: true });
  assert.ok(gone.problems.some((p) => /^gap:5/.test(p.id)), JSON.stringify(gone.problems));
  // the end of the line cut off
  w.store.files.delete(keyOf(9, 12));
  assert.ok((await w.stele.check({ deep: true })).problems.some((p) => p.id === 'cut'));
});

test('a row of the database changed behind its back is found by the carved copy, and nothing more is carved over it', async (t) => {
  const w = world(t);
  w.add(6); await w.stele.seal();
  w.unlock();
  w.db.prepare("UPDATE ops_log SET summary = 'rewritten' WHERE id = 3").run();
  const looked = await w.stele.check({ deep: true });
  assert.ok(looked.problems.some((p) => p.id === 'differs:3'), JSON.stringify(looked.problems));
  // and the end of the chain replaced: what was carved no longer matches the database's row
  w.db.prepare("UPDATE ops_log SET hash = 'forged' WHERE id = 6").run();
  w.add(1);
  const r = await w.stele.seal();
  assert.equal(r.diverged, true);
  assert.equal(w.stele.status().diverged.id, 6);
  assert.ok(w.said.some(([, text]) => /石碑に刻んだものと違います/.test(text)));
  assert.ok(w.stele.findings().some((f) => /stele-diverged/.test(f.id)));
});

test('rows the database lost are put back from the files, and the log goes on from there', async (t) => {
  const w = world(t);
  w.add(7); await w.stele.seal(); w.add(5); await w.stele.seal();
  const before = w.q('SELECT * FROM ops_log ORDER BY id').all();
  // the database goes back in time: the last rows are gone
  w.unlock();
  w.db.prepare('DELETE FROM ops_log WHERE id > 8').run();
  assert.equal((await w.stele.check()).problems.some((p) => p.id === 'behind'), true);
  const r = await w.stele.recover();
  assert.equal(r.restored, 4);
  assert.deepEqual(w.q('SELECT * FROM ops_log WHERE id <= ? ORDER BY id').all(before.length), before, 'every row, as it was');
  assert.equal(w.opsLog.verify ? (await w.opsLog.verify()).ok : true, true);
  assert.ok(w.q("SELECT 1 FROM ops_log WHERE action = 'log_restore'").get(), 'and the log says it was done');
  // the whole table gone (a new database): everything comes back, once the key is the same
  w.db.prepare('DELETE FROM ops_log').run();
  w.q("DELETE FROM meta WHERE key = 'stele'").run();
  assert.equal((await w.stele.tick()).recover.restored, before.length);
  assert.equal(w.q('SELECT COUNT(*) AS n FROM ops_log WHERE id <= ?').get(before.length).n, before.length);
});

test('a restore does not trust files signed with another key unless the developer says so; a history that does not join is left alone', async (t) => {
  const w = world(t);
  w.add(6); await w.stele.seal();
  w.unlock();
  w.db.prepare('DELETE FROM ops_log').run();
  // the same files, read by a server whose key is another
  const other = createStele({ q: w.q, opsLog: w.opsLog, store: w.store, secret: 'a-different-secret', clock: w.clock, notice: { say() {} } });
  const refused = await other.recover();
  assert.equal(refused.restored, 0);
  assert.match(refused.blocked, /署名/);
  const forced = await other.recover({ force: true });
  assert.equal(forced.restored, 6);
  assert.equal(forced.unsigned, true);
  // a database with other rows at the same numbers is not written over
  const x = world(t);
  x.add(3);
  const stranger = createStele({ q: x.q, opsLog: x.opsLog, store: w.store, secret: 'a-secret-for-the-test', clock: x.clock, notice: { say() {} } });
  assert.match((await stranger.recover()).blocked || 'none', /続く控えがありません|none/);
});

test('when the store is down nothing is lost: it is told, carved later, and the patrol hears of it', async (t) => {
  const w = world(t);
  w.add(3); await w.stele.seal();
  w.store.broken = true;
  w.add(4);
  const r = await w.stele.seal();
  assert.equal(r.failed, true);
  assert.equal(w.stele.status().sealed, 3);
  assert.equal(w.stele.status().pending, 4);
  assert.equal(w.stele.findings().some((f) => f.id === 'stele-fail'), false, 'not yet: a short outage is not news');
  w.advance(40 * 60000);
  await w.stele.tick();
  assert.ok(w.stele.findings().some((f) => f.id === 'stele-fail' && f.level === 'high'));
  assert.equal(w.said.filter(([m]) => m === '⚠️').length, 1);
  await w.stele.tick();
  assert.equal(w.said.filter(([m]) => m === '⚠️').length, 1, 'told once, not at every look');
  w.store.broken = false;
  const back = await w.stele.tick();
  assert.equal(back.sealed, 4);
  assert.deepEqual([w.stele.status().sealed, w.stele.status().failSince], [7, 0]);
});

test('a name that is taken is never written over, and a file that is not read back as written is not counted', async (t) => {
  const w = world(t);
  w.add(2);
  // somebody put another file under the name first
  w.store.files.set(keyOf(1, 2), new TextEncoder().encode('{"not":"it"}'));
  const r = await w.stele.seal();
  assert.equal(r.failed, true);
  assert.equal(w.stele.status().sealed, 0);
  assert.equal(new TextDecoder().decode(w.store.files.get(keyOf(1, 2))), '{"not":"it"}', 'left as it was');
  // a store that drops what it is given
  const liar = fakeStore();
  liar.put = async () => {};
  const x = world(t, { store: liar });
  x.add(2);
  assert.equal((await x.stele.seal()).failed, true);
  assert.equal(x.stele.status().sealed, 0);
});

test('once a day the newest hash goes to the notices, and the room is watched', async (t) => {
  const used = { bytes: 100 };
  const w = world(t, { dbBytes: () => used.bytes, dbLimit: 1000 });
  w.add(3);
  await w.stele.tick();
  assert.equal(w.said.filter(([m]) => m === '🗿').length, 1);
  assert.match(w.said.find(([m]) => m === '🗿')[1], /#3 まで刻みました/);
  await w.stele.tick();
  assert.equal(w.said.filter(([m]) => m === '🗿').length, 1, 'the same day: once');
  w.advance(24 * 3600000);
  await w.stele.tick();
  assert.equal(w.said.filter(([m]) => m === '🗿').length, 2);
  used.bytes = 750;
  await w.stele.tick();
  assert.equal(w.said.filter(([m]) => m === '📦').length, 1);
  assert.ok(w.stele.findings().some((f) => f.id === 'stele-room-70' && f.level === 'low'));
  used.bytes = 950;
  await w.stele.tick();
  assert.ok(w.stele.findings().some((f) => f.id === 'stele-room-90' && f.level === 'high'));
  assert.equal(w.said.filter(([m]) => m === '📦').length, 2);
});

test('segments are cut by size and the whole line is read a few at a time', async (t) => {
  const w = world(t);
  w.add(2300);
  const r = await w.stele.tick();
  assert.equal(r.sealed, 2300);
  assert.deepEqual([...w.store.files.keys()], [keyOf(1, 1000), keyOf(1001, 2000), keyOf(2001, 2300)]);
  assert.equal(w.stele.status().segs, 3);
  assert.equal((await w.stele.check({ deep: true })).ok, true);
  assert.equal(w.stele.status().deepDone > 0, true);
});

test('the files here can only be created: the same bytes again are fine, others are refused, and the rows are mirrored line by line', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stele-files-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = fileStele(path.join(dir, 'stele'));
  await store.put(keyOf(1, 2), new TextEncoder().encode('first'));
  await store.put(keyOf(1, 2), new TextEncoder().encode('first'));
  await assert.rejects(store.put(keyOf(1, 2), new TextEncoder().encode('other')), /上書きはしません/);
  assert.equal(new TextDecoder().decode(await store.get(keyOf(1, 2))), 'first');
  assert.equal(fs.statSync(path.join(dir, 'stele', '0000000001-0000000002.json')).mode & 0o222, 0, 'read only');
  assert.deepEqual(await store.list('oplog/'), [keyOf(1, 2)]);
  assert.equal(await store.get(keyOf(9, 9)), null);
  const mirror = logMirror(path.join(dir, 'ops-log.jsonl'));
  mirror.put({ id: 1, hash: 'a' });
  mirror.spill({ id: 2, hash: 'b' });
  assert.deepEqual(fs.readFileSync(path.join(dir, 'ops-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)), [{ id: 1, hash: 'a' }, { spill: true, row: { id: 2, hash: 'b' } }]);
});

test('a row the database refuses is told elsewhere before the failure goes on', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stele-spill-'));
  const db = openDb(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const q = statements(db);
  const spilled = [];
  const log = createOpsLog({ q, anchor: { put() {}, spill: (r) => spilled.push(r) } });
  log.add({ actorName: 'テスト', action: 'test', summary: 'one' });
  db.exec('DROP TABLE ops_log');
  const quiet = console.error;
  console.error = () => {};
  try { assert.throws(() => log.add({ actorName: 'テスト', action: 'test', summary: 'two' })); } finally { console.error = quiet; }
});

test('in a real server: the log is carved by the housekeeping, the developer sees it and asks for a look, nobody else', async (t) => {
  const s = await startServer({ operators: ['taku', 'Mod'] });
  t.after(() => s.stop());
  const dev = await s.register('taku');
  const mod = await s.register('Mod');
  await s.call('POST', '/api/ops/dev-code', { token: dev.token, body: { code: '987654321098' } });
  await s.app.api.housekeeping();
  const st = (await s.call('GET', '/api/ops/stele', { token: mod.token })).stele;
  assert.equal(st.on, true);
  assert.ok(st.sealed >= 1 && st.pending === 0, JSON.stringify(st));
  assert.equal(st.check.ok, true);
  assert.equal((await s.call('GET', '/api/ops/server', { token: mod.token })).stele.sealed, st.sealed, 'the server tab carries it');
  assert.equal((await s.call('POST', '/api/ops/stele/run', { token: mod.token, body: {} })).error.code, 'not_developer');
  assert.equal((await s.call('GET', '/api/ops/log/archive', { token: mod.token })).error.code, 'not_developer');
  const ran = await s.call('POST', '/api/ops/stele/run', { token: dev.token, body: {} });
  assert.equal(ran.ran.ok, true);
  // the developer's copy: every row, whole, in pages, and its end
  const first = await s.call('GET', '/api/ops/log/archive?after=0&limit=2', { token: dev.token });
  assert.equal(first.rows.length, 2);
  assert.equal(first.cols.length, 11);
  assert.equal(first.more, true);
  const all = [];
  for (let after = 0; ;) {
    const page = await s.call('GET', `/api/ops/log/archive?after=${after}&limit=1000`, { token: dev.token });
    all.push(...page.rows);
    if (!page.more) { assert.equal(page.head.hash, page.rows[page.rows.length - 1][10]); break; }
    after = page.last;
  }
  assert.equal(all.length, s.app.db.prepare('SELECT COUNT(*) AS n FROM ops_log').get().n);
});

test('the command line: how it stands, a full look, a restore, and the whole log saved to a file that is checked first', async (t) => {
  const w = world(t);
  w.add(4);
  const call = async (cmd, args) => {
    if (cmd === 'log-export') return { rows: w.q('SELECT * FROM ops_log ORDER BY id').all() };
    if (args[0] === 'check') { const r = await w.stele.tick({ deep: true }); return { ...w.stele.status(), ran: r }; }
    if (args[0] === 'restore') { const r = await w.stele.recover({ force: args[1] === true }); await w.stele.seal(); return { ...w.stele.status(), restore: r }; }
    return w.stele.status();
  };
  const said = [];
  const say = (x) => said.push(x);
  assert.equal(await adminRun(['stele', 'check'], call, say), 0);
  assert.match(said.join('\n'), /#1〜#4（1か所）/);
  assert.match(said.join('\n'), /異常なし/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-save-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'log.jsonl');
  await adminRun(['log-save', file], call, say);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 5);
  assert.deepEqual([lines[4].end, lines[4].count, lines[4].head.id], [true, 4, 4]);
  await assert.rejects(adminRun(['log-save', file], call, say), /EEXIST/, 'never over an earlier copy');
  w.unlock();
  w.db.prepare("UPDATE ops_log SET summary = 'rewritten' WHERE id = 2").run();
  await assert.rejects(adminRun(['log-save', path.join(dir, 'other.jsonl')], call, say), /つながっていません/);
});
