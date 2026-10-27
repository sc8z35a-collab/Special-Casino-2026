import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
import { createAdmin } from '../core/admin.js';

async function setup(t) { const s = await startServer({ operators: ['StaffRotate'] }); t.after(() => s.stop()); return s; }

test('password changes revoke every old session, recovery code and live ticket atomically', async t => {
  const s = await setup(t), p = await s.register('Rotate');
  const other = await s.call('POST', '/api/login', { body: { name: p.me.name, password: PASSWORD } });
  const ticket = await s.call('POST', '/api/stream-ticket', { token: p.token });
  const change = await s.call('POST', '/api/password', { token: p.token, body: { current: PASSWORD, password: 'changed123' } });
  assert.equal(change.status, 200);
  assert.notEqual(change.token, p.token); assert.notEqual(change.recoveryCode, p.recoveryCode);
  for (const token of [p.token, other.token]) assert.equal((await s.call('GET', '/api/me', { token })).status, 401);
  assert.equal((await s.call('GET', '/api/me', { token: change.token })).status, 200);
  assert.equal(s.app.api.consumeTicket(ticket.ticket), null);
  assert.equal((await s.call('POST', '/api/login', { body: { code: p.recoveryCode } })).status, 404);
  assert.equal((await s.call('POST', '/api/login', { body: { code: change.recoveryCode } })).status, 200);
  assert.equal((await s.call('POST', '/api/login', { body: { name: p.me.name, password: PASSWORD } })).status, 401);
});

test('failed and racing password changes cannot revoke the winning credentials', async t => {
  const s = await setup(t), p = await s.register('RaceRotate');
  const bad = await s.call('POST', '/api/password', { token: p.token, body: { current: 'wrong', password: 'changed123' } });
  assert.equal(bad.status, 403);
  assert.equal((await s.call('POST', '/api/login', { body: { code: p.recoveryCode } })).status, 200);
  const results = await Promise.all(['newpass001', 'newpass002'].map(password => s.call('POST', '/api/password', { token: p.token, body: { current: PASSWORD, password } })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 401]);
  const winner = results.find(r => r.status === 200);
  assert.equal((await s.call('GET', '/api/me', { token: winner.token })).status, 200);
  assert.equal((await s.call('POST', '/api/login', { body: { code: winner.recoveryCode } })).status, 200);
});

test('operator and CLI resets also revoke credentials and outstanding operator tickets', async t => {
  const s = await setup(t), staff = await s.register('StaffRotate'), p = await s.register('ResetRotate');
  const oldOps = await s.call('POST', '/api/ops/login', { body: { name: staff.me.name, password: PASSWORD } });
  const ticket = await s.call('POST', '/api/ops/live-ticket', { token: oldOps.token });
  const r = await s.call('POST', '/api/ops/password', { token: staff.token, body: { id: p.me.id, password: 'reset0001' } });
  assert.equal(r.status, 200);
  assert.equal((await s.call('GET', '/api/me', { token: p.token })).status, 401);
  assert.equal((await s.call('POST', '/api/login', { body: { code: p.recoveryCode } })).status, 404);
  await createAdmin(s.app.db).password(staff.me.name, 'reset0002');
  assert.equal((await s.call('GET', '/api/me', { token: staff.token })).status, 401);
  assert.equal(s.app.api.consumeOpsTicket(ticket.ticket), null);
});

test('the Node heartbeat disconnects a live connection after credentials change through the separate CLI path', async t => {
  const s = await setup(t), p = await s.register('CliStream');
  const { ticket } = await s.call('POST', '/api/stream-ticket', { token: p.token });
  const request = await s.openStream(ticket, () => {}); t.after(() => request.destroy());
  const closed = new Promise(resolve => request.once('close', resolve));
  await createAdmin(s.app.db).password(p.me.name, 'new-cli-password');
  s.app.live.heartbeat();
  await closed;
  assert.equal((await s.call('GET', '/api/me', { token: p.token })).status, 401);
});

test('a password verified before an operator reset cannot issue a session after an asynchronous MFA check', async t => {
  const { createOpsLogin } = await import('../core/opslogin.js');
  const { statements } = await import('../core/db.js');
  const s = await setup(t), p = await s.register('StaffRotate'), q = statements(s.app.db);
  let release, entered;
  const paused = new Promise(resolve => { entered = resolve; });
  const login = createOpsLogin({ q, findByName: () => q('SELECT * FROM users WHERE id = ?').get(p.me.id),
    isOperator: () => true, createSession: () => { throw Error('stale login issued'); }, seenOn() {}, rate() {},
    verifyMfa: () => { entered(); return new Promise(resolve => { release = resolve; }); } });
  const req = { ip: '192.0.2.1', header: () => '', json: async () => ({ name: p.me.name, password: PASSWORD }) };
  const pending = login.routes['POST /api/ops/login'](req);
  await paused; await createAdmin(s.app.db).password(p.me.name, 'new-staff-password'); release(0);
  await assert.rejects(pending, e => e.code === 'bad_login');
});
