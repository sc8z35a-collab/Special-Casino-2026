// Operator commands, durability of player money, client addresses: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, PASSWORD, newDevice } from './helpers.js';
import { createApp } from '../node/server.js';
import { openDb } from '../node/sqlite.js';
import { run } from '../node/admin-cli.js';
import { createAdmin, AdminError } from '../core/admin.js';
import { MIGRATIONS, SCHEMA_VERSION } from '../core/db.js';
import { clientIp } from '../node/http.js';
import { sha256, normalizeRecoveryCode } from '../core/auth.js';

const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';
let s, call, register, admin;

before(async () => {
  s = await startServer({ adminToken: ADMIN_TOKEN });
  ({ call, register } = s);
  admin = createAdmin(s.app.db);
});

after(() => s.stop());

test('ban / unban locks a player out and back in', async () => {
  const p = await register('banme');
  admin.ban('banme');
  const r = await call('GET', '/api/me', { token: p.token });
  assert.equal(r.status, 403);
  assert.equal(r.error.code, 'banned');
  admin.ban(`#${p.me.id}`, false);
  assert.equal((await call('GET', '/api/me', { token: p.token })).status, 200);
});

test('grant changes balances and bumps the revision, never below zero', async () => {
  const p = await register('granted');
  const r = admin.grant('granted', 'tokens', 5000);
  assert.equal(r.after, r.before + 5000);
  const me = await call('GET', '/api/me', { token: p.token });
  assert.equal(me.me.tokens, r.after);
  assert.ok(me.me.rev > p.me.rev);
  assert.throws(() => admin.grant('granted', 'tokens', -1e9), AdminError);
  assert.throws(() => admin.grant('granted', 'gems', 1), AdminError);
  assert.throws(() => admin.grant('nobody-here', 'tokens', 1), AdminError);
});

test('rename keeps names unique; recovery issues a working code; logout ends sessions', async () => {
  const a = await register('oldname');
  await register('taken');
  assert.throws(() => admin.rename('oldname', 'TAKEN'), AdminError);
  assert.equal(admin.rename('oldname', 'newname').after, 'newname');
  assert.equal((await call('GET', '/api/me', { token: a.token })).me.name, 'newname');
  assert.equal((await call('POST', '/api/login', { body: { name: 'newname', password: PASSWORD } })).status, 200);
  const { recoveryCode } = admin.recovery('newname');
  assert.equal((await call('POST', '/api/login', { body: { code: a.recoveryCode } })).status, 404);
  const login = await call('POST', '/api/login', { body: { code: recoveryCode } });
  assert.equal(login.status, 200);
  assert.equal(login.me.id, a.me.id);
  assert.equal(admin.logout('newname').sessions, 3);
  assert.equal((await call('GET', '/api/me', { token: login.token })).status, 401);
});

test('messages can be redacted, transfer records cannot', async () => {
  const a = await register('talker');
  const b = await register('listener');
  await s.befriend(a, b);
  const m = await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'ひどい発言' } });
  admin.redact(m.message.id);
  const thread = await call('GET', `/api/messages?with=${a.me.id}`, { token: b.token });
  assert.equal(thread.messages.find((x) => x.id === m.message.id).text, '（このメッセージは削除されました）');
  const t = await call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 10, currency: 'dollars' } });
  assert.throws(() => admin.redact(t.message.id), AdminError);
});

test('the admin endpoint needs the token; the CLI talks to it the same way', async () => {
  assert.equal((await call('POST', '/api/admin', { body: { cmd: 'stats' } })).status, 403);
  assert.equal((await call('POST', '/api/admin', { body: { cmd: 'stats' }, headers: { 'X-Admin-Token': 'wrong-token-wrong-token-wrong' } })).status, 403);
  const r = await call('POST', '/api/admin', { body: { cmd: 'stats', args: [] }, headers: { 'X-Admin-Token': ADMIN_TOKEN } });
  assert.equal(r.status, 200);
  assert.ok(r.result.players >= 5);
  const bad = await call('POST', '/api/admin', { body: { cmd: 'grant', args: ['granted', 'gems', 1] }, headers: { 'X-Admin-Token': ADMIN_TOKEN } });
  assert.equal(bad.status, 400);
  // the CLI against a callable
  const out = [];
  const local = async (cmd, args) => admin.command(cmd, args);
  assert.equal(await run(['stats'], local, (x) => out.push(x)), 0);
  assert.match(out.join('\n'), /players/);
  assert.equal(await run(['nonsense'], local, () => {}), 1);
  await assert.rejects(run(['show', 'ghost'], local, () => {}), AdminError);
});

test('backup and restore: a full copy; restoring never overwrites players by accident', async () => {
  const dump = admin.export();
  assert.equal(dump.schema, SCHEMA_VERSION);
  assert.ok(dump.tables.users.length >= 5);
  assert.throws(() => admin.import(dump), /replace/);
  // into an empty database
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-restore-'));
  const db = openDb(dir);
  try {
    const counts = createAdmin(db).import(JSON.parse(JSON.stringify(dump)));
    assert.equal(counts.users, dump.tables.users.length);
    const u = dump.tables.users.find((x) => x.name === 'granted');
    assert.equal(db.prepare('SELECT tokens FROM users WHERE id = ?').get(u.id).tokens, u.tokens);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('money survives restarts and redeploys: the database is reopened as it was', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-durable-'));
  const opts = { dataDir: dir, logRequests: false, registrationsPerIp: 0 };
  try {
    let app = createApp(opts);
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    let base = `http://127.0.0.1:${app.server.address().port}`;
    const post = async (b, url, body, token) => {
      const res = await fetch(b + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device': newDevice(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body)
      });
      return res.json();
    };
    const reg = await post(base, '/api/register', { name: 'Durable', password: PASSWORD, avatar: 'beard' });
    app.db.prepare('UPDATE users SET tokens = 777777, dollars = 123456789 WHERE id = ?').run(reg.me.id);
    await app.close();
    app = createApp(opts);
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${app.server.address().port}`;
    const login = await post(base, '/api/login', { name: 'Durable', password: PASSWORD });
    assert.equal(login.me.tokens, 777777);
    assert.equal(login.me.dollars, 123456789);
    assert.equal(login.me.avatar, 'beard');
    // the old session still works too
    const me = await (await fetch(base + '/api/me', { headers: { Authorization: `Bearer ${reg.token}` } })).json();
    assert.equal(me.me.dollars, 123456789);
    await app.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a database from the first release is upgraded in place, balances untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-legacy-'));
  try {
    const raw = new DatabaseSync(path.join(dir, 'blockbuster.db'));
    for (const sql of MIGRATIONS[0]) raw.exec(sql);
    raw.exec('PRAGMA user_version = 1');
    const code = 'ABCD-EFGH-JKMN-PQRS';
    raw.prepare(`INSERT INTO users (name, name_key, recovery_hash, tokens, dollars, coins, total_won, spins, created_at, last_seen)
                 VALUES ('Veteran', 'veteran', ?, 4242, 9876543, 74, 5555, 12, 1, 1)`).run(sha256(normalizeRecoveryCode(code)));
    raw.close();
    const app = createApp({ dataDir: dir, logRequests: false });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const login = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual([login.me.tokens, login.me.dollars, login.me.coins, login.me.totalWon], [4242, 9876543, 74, 5555]);
    assert.equal(login.me.avatar, 'bald');
    assert.equal(login.me.hasPassword, false);
    assert.equal(app.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get().value, String(SCHEMA_VERSION));
    await app.close();
    // opening it again changes nothing
    const db = openDb(dir);
    assert.equal(db.prepare('SELECT dollars FROM users WHERE name_key = ?').get('veteran').dollars, 9876543);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('client address: forged X-Forwarded-For entries are ignored', () => {
  const req = (xff, remote = '10.0.0.5', extra = {}) => ({ headers: { 'x-forwarded-for': xff, ...extra }, socket: { remoteAddress: remote } });
  assert.equal(clientIp(req('1.2.3.4'), false), '10.0.0.5');
  assert.equal(clientIp(req('1.2.3.4, 203.0.113.9'), true), '203.0.113.9');
  assert.equal(clientIp(req('203.0.113.9, 10.1.2.3, 172.20.0.4'), true), '203.0.113.9');
  assert.equal(clientIp(req('192.168.1.20'), true), '192.168.1.20');
  assert.equal(clientIp(req('1.2.3.4, 198.51.100.7', '10.0.0.5', { 'cf-connecting-ip': '198.51.100.99' }), true, 'cf-connecting-ip'), '198.51.100.99');
});
