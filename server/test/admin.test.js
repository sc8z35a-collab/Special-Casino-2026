// Operator commands and client address handling: node --test server/test/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { createAdmin, run, AdminError } from '../admin.js';
import { clientIp } from '../http.js';

let app, base, dataDir, admin;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-admin-'));
  app = createApp({ dataDir, logRequests: false, registrationsPerIp: 0, registerPerMinute: 100000 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  admin = createAdmin(app.db);
});

after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(method, url, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, ...(await res.json()) };
}

test('ban / unban locks a player out and back in', async () => {
  const p = await call('POST', '/api/register', { body: { name: 'banme' } });
  admin.ban('banme');
  const r = await call('GET', '/api/me', { token: p.token });
  assert.equal(r.status, 403);
  assert.equal(r.error.code, 'banned');
  admin.ban(`#${p.me.id}`, false);
  assert.equal((await call('GET', '/api/me', { token: p.token })).status, 200);
});

test('grant changes balances and bumps the revision, never below zero', async () => {
  const p = await call('POST', '/api/register', { body: { name: 'granted' } });
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
  const a = await call('POST', '/api/register', { body: { name: 'oldname' } });
  await call('POST', '/api/register', { body: { name: 'taken' } });
  assert.throws(() => admin.rename('oldname', 'TAKEN'), AdminError);
  assert.equal(admin.rename('oldname', 'newname').after, 'newname');
  assert.equal((await call('GET', '/api/me', { token: a.token })).me.name, 'newname');
  const { recoveryCode } = admin.recovery('newname');
  assert.equal((await call('POST', '/api/login', { body: { code: a.recoveryCode } })).status, 404);
  const login = await call('POST', '/api/login', { body: { code: recoveryCode } });
  assert.equal(login.status, 200);
  assert.equal(login.me.id, a.me.id);
  assert.equal(admin.logout('newname').sessions, 2);
  assert.equal((await call('GET', '/api/me', { token: login.token })).status, 401);
});

test('messages can be redacted, transfer records cannot', async () => {
  const a = await call('POST', '/api/register', { body: { name: 'talker' } });
  const b = await call('POST', '/api/register', { body: { name: 'listener' } });
  const m = await call('POST', '/api/messages', { token: a.token, body: { to: 'lobby', text: 'ひどい発言' } });
  admin.redact(m.message.id);
  const lobby = await call('GET', '/api/messages', { token: b.token });
  assert.equal(lobby.messages.find((x) => x.id === m.message.id).text, '（このメッセージは削除されました）');
  const t = await call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 10, currency: 'dollars' } });
  assert.throws(() => admin.redact(t.message.id), AdminError);
});

test('backup writes a consistent copy; the CLI prints and reports errors', () => {
  const file = path.join(dataDir, 'backups', 'copy.db');
  const r = admin.backup(file);
  assert.ok(r.bytes > 0 && fs.existsSync(file));
  assert.throws(() => admin.backup(file), AdminError);
  const out = [];
  assert.equal(run(['stats'], app.db, (s) => out.push(s)), 0);
  assert.match(out.join('\n'), /players/);
  assert.equal(run(['nonsense'], app.db, () => {}), 1);
  assert.throws(() => run(['show', 'ghost'], app.db, () => {}), AdminError);
});

test('client address: forged X-Forwarded-For entries are ignored', () => {
  const req = (xff, remote = '10.0.0.5', extra = {}) => ({ headers: { 'x-forwarded-for': xff, ...extra }, socket: { remoteAddress: remote } });
  // without a proxy the header means nothing
  assert.equal(clientIp(req('1.2.3.4'), false), '10.0.0.5');
  // the proxy appends the address it saw; a client-supplied value sits to the left
  assert.equal(clientIp(req('1.2.3.4, 203.0.113.9'), true), '203.0.113.9');
  // internal hops behind the edge are skipped
  assert.equal(clientIp(req('203.0.113.9, 10.1.2.3, 172.20.0.4'), true), '203.0.113.9');
  assert.equal(clientIp(req('192.168.1.20'), true), '192.168.1.20');
  // a trusted edge header wins
  assert.equal(clientIp(req('1.2.3.4, 198.51.100.7', '10.0.0.5', { 'cf-connecting-ip': '198.51.100.99' }), true, 'cf-connecting-ip'), '198.51.100.99');
});
