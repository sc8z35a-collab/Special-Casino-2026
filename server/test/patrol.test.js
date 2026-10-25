import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.js';
import { openDb } from '../node/sqlite.js';
import { statements } from '../core/db.js';
import { createOpsLog } from '../core/opslog.js';
import { createPatrol } from '../core/patrol.js';

async function setup(t, overrides = {}) {
  const s = await startServer({ operators: ['taku', 'Mod'], ...overrides });
  t.after(() => s.stop());
  const dev = await s.register('taku');
  const run = async () => (await s.call('POST', '/api/ops/patrol/run', { token: dev.token, body: {} })).patrol;
  const logs = (action) => s.app.db.prepare('SELECT * FROM ops_log WHERE action = ? ORDER BY id').all(action);
  const sql = (text, ...args) => s.app.db.prepare(text).run(...args);
  return { s, dev, run, logs, sql };
}

test('nothing wrong: the patrol finds nothing, says nothing, and the developer can ask for it any time', async (t) => {
  const { s, dev, run, logs } = await setup(t);
  assert.equal((await s.call('GET', '/api/ops/patrol', { token: dev.token })).patrol, null, 'not yet looked');
  const first = await run();
  assert.deepEqual(first.findings, []);
  assert.deepEqual(first.checks.map((c) => c.ok), [true, true, true, true, true]);
  assert.equal(logs('patrol_alert').length + logs('patrol_notice').length, 0);
  const again = await run();
  assert.ok(again.at >= first.at && again.findings.length === 0);
  // the server tab carries it, and the housekeeping looks too
  assert.equal((await s.call('GET', '/api/ops/server', { token: dev.token })).patrol.at, again.at);
  await s.app.api.housekeeping();
  assert.ok((await s.call('GET', '/api/ops/patrol', { token: dev.token })).patrol.at >= again.at);
});

test('only the developer asks for a look; operators and viewers read the result', async (t) => {
  const { s, dev, run } = await setup(t);
  const mod = await s.register('Mod');
  await run();
  assert.equal((await s.call('POST', '/api/ops/patrol/run', { token: mod.token, body: {} })).error.code, 'not_developer');
  assert.equal((await s.call('GET', '/api/ops/patrol', { token: mod.token })).patrol.findings.length, 0);
  const plain = await s.register('Plainone');
  assert.equal((await s.call('GET', '/api/ops/patrol', { token: plain.token })).status, 403);
});

test('rights that came from nowhere are news; rights older than the log are not', async (t) => {
  const { s, dev, run, logs, sql } = await setup(t);
  const bob = await s.register('Bobby');
  // a grant already there before the first look (older than the log, say): taken as it is
  sql('INSERT INTO ops_access (name_key, granted, at, by_id) VALUES (?, 1, ?, ?)', 'oldie', Date.now() - 86400000, dev.me.id);
  assert.deepEqual((await run()).findings, []);
  // …and one that appears afterwards, with no word of it in the log
  sql('INSERT INTO ops_access (name_key, granted, at, by_id) VALUES (?, 1, ?, ?)', 'bobby', Date.now(), 0);
  const second = await run();
  assert.equal(second.findings.length, 1);
  assert.match(second.findings[0].text, /運営権の付与（bobby）が、運営ログに残っていません/);
  assert.equal(logs('patrol_alert').length, 1);
  assert.equal((await run()).findings.length, 1, 'still there');
  assert.equal(logs('patrol_alert').length, 1, 'told once');
  // a viewer and an extra login the same way
  sql('INSERT INTO ops_viewers (user_id, granted, at, by_id) VALUES (?, 1, ?, 0)', bob.me.id, Date.now());
  sql("INSERT INTO ops_mfa (user_id, mode, version) VALUES (?, 2, 1)", bob.me.id);
  const third = await run();
  assert.deepEqual(third.findings.map((f) => f.id.split(':')[0]).sort(), ['ops_access', 'ops_mfa', 'ops_viewers']);
  // gone: told so
  sql("DELETE FROM ops_access WHERE name_key = 'bobby'");
  sql('DELETE FROM ops_viewers WHERE user_id = ?', bob.me.id);
  sql('DELETE FROM ops_mfa WHERE user_id = ?', bob.me.id);
  assert.deepEqual((await run()).findings, []);
  assert.equal(logs('patrol_clear').length, 3);
});

test('rights given the proper way leave no finding', async (t) => {
  const { s, dev, run, logs } = await setup(t);
  await s.register('Bobby');
  await s.register('Viewy');
  await run();
  const CODE = '987654321098';
  assert.equal((await s.call('POST', '/api/ops/dev-code', { token: dev.token, body: { code: CODE } })).status, 200);
  assert.equal((await s.call('POST', '/api/ops/operator', { token: dev.token, body: { action: 'grant', name: 'Bobby', code: CODE } })).status, 200);
  assert.equal((await s.call('POST', '/api/ops/viewer', { token: dev.token, body: { action: 'grant', name: 'Viewy', code: CODE } })).status, 200);
  assert.equal((await s.call('POST', '/api/ops/operator', { token: dev.token, body: { action: 'revoke', name: 'Bobby', code: CODE } })).status, 200);
  assert.deepEqual((await run()).findings, []);
  assert.equal(logs('patrol_alert').length, 0);
});

test('a developer code changed behind the server\'s back is news', async (t) => {
  const { s, dev, run, sql } = await setup(t);
  const CODE = '987654321098';
  await s.call('POST', '/api/ops/dev-code', { token: dev.token, body: { code: CODE } });
  assert.deepEqual((await run()).findings, []);
  sql("UPDATE meta SET value = 'pbkdf2$1$AAAA$BBBB' WHERE key = 'dev_code'");
  const r = await run();
  assert.match(r.findings[0].text, /開発者コードが、運営ログに残らないまま変わっています/);
});

test('the log: the triggers are put back, and a changed row is found', async (t) => {
  const { s, dev, run, logs, sql } = await setup(t);
  assert.deepEqual((await run()).findings, []);
  sql('DROP TRIGGER ops_log_no_update');
  const r = await run();
  assert.match(r.findings[0].text, /ops_log_no_update/);
  assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'ops_log_no_update'").get().n, 1, 'put back');
  assert.equal(logs('patrol_alert').length, 1);
  // a row rewritten (the trigger is out of the way, as it would be for someone with the database)
  sql('DROP TRIGGER ops_log_no_update');
  sql("UPDATE ops_log SET summary = 'rewritten' WHERE id = 1");
  const full = s.app.db.prepare('SELECT value FROM meta WHERE key = ?').get('patrol');
  const state = JSON.parse(full.value); state.logFullAt = 0; // (the daily full look is due)
  sql('UPDATE meta SET value = ? WHERE key = ?', JSON.stringify(state), 'patrol');
  const broken = await run();
  assert.ok(broken.findings.some((f) => f.id === 'log-chain' && /書き換えられています/.test(f.text)), JSON.stringify(broken.findings));
});

test('accounts made to pass for the game\'s own, and a site login that is no one\'s to have', async (t) => {
  const { s, dev, run, sql } = await setup(t);
  const eve = await s.register('Evee');
  await run();
  sql("UPDATE users SET npc = 'boss' WHERE id = ?", eve.me.id);
  sql("INSERT INTO sessions (token_hash, user_id, created_at, last_used, ops) VALUES ('h1', ?, ?, ?, 1)", eve.me.id, Date.now(), Date.now());
  const r = await run();
  assert.ok(r.findings.some((f) => f.id === 'npc:boss'));
  sql("UPDATE users SET npc = '' WHERE id = ?", eve.me.id);
  const again = await run();
  assert.ok(again.findings.some((f) => f.id.startsWith('staff-session:')) || r.findings.some((f) => f.id.startsWith('staff-session:')));
  assert.equal(s.app.db.prepare("SELECT ended FROM sessions WHERE token_hash = 'h1'").get().ended.length > 0, true, 'the login was ended');
});

test('the server\'s settings: the admin token that came and the operators that changed are news', async (t) => {
  const { s, run, logs } = await setup(t);
  assert.deepEqual((await run()).findings, []);
  s.app.config.adminToken = 'a'.repeat(40);
  const r = await run();
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].text, /管理用トークン/);
  assert.equal(logs('patrol_alert').length, 1);
  s.app.config.operators = ['taku', 'Mod', 'Newcomer'];
  assert.ok((await run()).findings.some((f) => f.level === 'high' && /運営の名前の一覧/.test(f.text)));
  // something minor: a notice only
  s.app.config.stripeSecretKey = 'sk_test_' + 'x'.repeat(24);
  const minor = await run();
  assert.ok(minor.findings.some((f) => f.level === 'low' && /決済の鍵/.test(f.text)));
  assert.equal(logs('patrol_notice').length, 1);
});

test('a secret that was there and is gone is news (the passkey\'s key, the notices)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-patrol-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = openDb(dir);
  const q = statements(db);
  const added = [];
  const opsLog = createOpsLog({ q, onAdd: (row) => added.push(row.action) });
  const now = { gateKey: true, discord: true, line: false, adminToken: false, operators: 'abc' };
  const patrol = createPatrol({ q, opsLog, config: {}, settings: () => ({ ...now }), isStaff: () => true });
  assert.deepEqual((await patrol.run()).findings, []);
  now.gateKey = false;
  now.line = true;
  const r = await patrol.run();
  assert.equal(r.findings.length, 2);
  assert.deepEqual(r.findings.map((f) => f.level).sort(), ['high', 'low']);
  assert.match(r.findings.find((f) => f.level === 'high').text, /パスキーの鍵/);
  assert.deepEqual(added.filter((a) => a.startsWith('patrol')), ['patrol_alert', 'patrol_notice']);
  db.close();
});

test('a lockdown changes the passkey at once, and its lifting ends the staff\'s logins', async (t) => {
  const { s, dev } = await setup(t);
  const mod = await s.register('Mod');
  const plain = await s.register('Plainone');
  assert.equal((await s.call('GET', '/api/ops/me', { token: mod.token })).status, 200);
  const epoch = s.app.api.pk.epoch();
  assert.equal((await s.call('POST', '/api/sec/lockdown', { token: dev.token, body: { reason: 'a test' } })).locked, true);
  assert.equal(s.app.api.pk.epoch(), epoch + 1, 'every gate ends and the day\'s passkey is another');
  assert.equal((await s.call('POST', '/api/sec/release', { token: dev.token, body: {} })).locked, false);
  // the operators\' logins (and the developer\'s own) are over; a player\'s is not
  assert.deepEqual([(await s.call('GET', '/api/ops/me', { token: mod.token })).error.code, (await s.call('GET', '/api/ops/me', { token: dev.token })).error.code], ['ended', 'ended']);
  assert.equal((await s.call('GET', '/api/me', { token: plain.token })).status, 200);
  assert.equal((await s.call('POST', '/api/login', { body: { name: 'Mod', password: 'pass1234' } })).status, 200, 'and they can log in again');
});
