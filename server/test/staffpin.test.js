import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
import { createAdmin } from '../core/admin.js';

const CODE = '987654321098';
async function setup(t) {
  const s = await startServer();
  t.after(() => s.stop());
  return s;
}
const opsLogin = (s, name, device) => s.call('POST', '/api/ops/login', { body: { name, password: PASSWORD }, headers: { 'X-Ops-Device': device } });
const pinOf = (s, name) => s.app.db.prepare('SELECT * FROM staff_pins WHERE name_key = ?').get(name);
const logged = (s, action) => s.app.db.prepare('SELECT * FROM ops_log WHERE action = ?').all(action);

test('the first account to use a staff name is bound to it, and keeps the rights through a request', async t => {
  const s = await setup(t);
  assert.equal(pinOf(s, 'taku'), undefined, 'nothing is bound before the name is used');
  const dev = await s.register('taku');
  const me = await s.call('GET', '/api/ops/me', { token: dev.token });
  assert.equal(me.developer, true);
  const pin = pinOf(s, 'taku');
  assert.deepEqual([pin.user_id, pin.by], [dev.me.id, 'first use']);
  assert.equal((await s.call('GET', '/api/ops/players', { token: dev.token })).status, 200);
});

test('a new account under the name of a lost staff account has no rights, and the name is not given out', async t => {
  const s = await setup(t);
  const dev = await s.register('taku');
  await s.call('GET', '/api/ops/me', { token: dev.token });
  // the account goes (here: the row itself, as a restore or a purge would)
  s.app.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(dev.me.id);
  s.app.db.prepare('DELETE FROM users WHERE id = ?').run(dev.me.id);
  // nobody may register the name any more
  const again = await s.call('POST', '/api/register', { body: { name: 'taku', password: PASSWORD, avatar: 'traveler-green' } });
  assert.deepEqual([again.status, again.error.code], [409, 'name_taken']);
  assert.equal((await s.call('GET', '/api/name-check?name=taku')).available, false);
  // …but a row that gets in some other way (a restore of an older copy, a hand edit) is no staff
  s.app.db.prepare("INSERT INTO users (name, name_key, password_hash, recovery_hash, tokens, dollars, coins, created_at, last_seen) VALUES ('taku', 'taku', ?, 'x', 0, 0, 0, ?, ?)").run('', Date.now() + 5, Date.now() + 5);
  const row = s.app.db.prepare("SELECT * FROM users WHERE name_key = 'taku'").get();
  const { hashPassword, newToken, sha256 } = await import('../core/auth.js');
  s.app.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(PASSWORD), row.id);
  const token = newToken();
  s.app.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_used) VALUES (?, ?, ?, ?)').run(sha256(token), row.id, Date.now(), Date.now());
  const imposter = await s.call('GET', '/api/ops/me', { token });
  assert.deepEqual([imposter.status, imposter.error.code], [403, 'not_operator']);
  assert.equal((await s.call('GET', '/api/emergency', { token })).status, 403);
  assert.equal((await opsLogin(s, 'taku', 'browser-imposter00000')).status, 401, 'nor can it log in to the operator site');
  // the operators' log says so, once
  assert.equal(logged(s, 'staff_name_reused').length, 1);
  await s.call('GET', '/api/ops/me', { token });
  assert.equal(logged(s, 'staff_name_reused').length, 1);
});

test('rights the developer gives by name follow the account, and the developer can give them again', async t => {
  const s = await setup(t);
  const dev = await s.register('taku');
  const bob = await s.register('Bobby');
  await s.call('POST', '/api/ops/dev-code', { token: dev.token, body: { code: CODE } });
  const grant = (name) => s.call('POST', '/api/ops/operator', { token: dev.token, body: { action: 'grant', name, code: CODE } });
  assert.equal((await grant('Bobby')).status, 200);
  assert.deepEqual([pinOf(s, 'bobby').user_id, pinOf(s, 'bobby').by], [bob.me.id, 'granted']);
  assert.equal((await s.call('GET', '/api/ops/me', { token: bob.token })).status, 200);
  // Bobby's account is replaced by another with the same name
  s.app.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(bob.me.id);
  s.app.db.prepare('UPDATE users SET name_key = ?, name = ? WHERE id = ?').run('gone-bobby', 'gone-bobby', bob.me.id);
  s.app.db.prepare("INSERT INTO users (name, name_key, password_hash, recovery_hash, tokens, dollars, coins, created_at, last_seen) VALUES ('Bobby', 'bobby', '', 'x', 0, 0, 0, ?, ?)").run(Date.now() + 9, Date.now() + 9);
  const now = s.app.db.prepare("SELECT * FROM users WHERE name_key = 'bobby'").get();
  const listed = (await s.call('GET', '/api/ops/operators', { token: dev.token })).operators.find((o) => o.key === 'bobby');
  assert.deepEqual([listed.operator, listed.reused], [false, true]);
  // the developer's grant (with the code) binds the account that holds the name now
  assert.equal((await grant('Bobby')).status, 200);
  assert.equal(pinOf(s, 'bobby').user_id, now.id);
  assert.equal((await s.call('GET', '/api/ops/operators', { token: dev.token })).operators.find((o) => o.key === 'bobby').operator, true);
});

test('staff-pin and staff-unpin: from the command line the name is bound to another account, or let go', async t => {
  const s = await setup(t);
  const dev = await s.register('taku');
  await s.call('GET', '/api/ops/me', { token: dev.token });
  const other = await s.register('Newtaku');
  const admin = createAdmin(s.app.db, { isDeveloper: () => false });
  // the rights of the name "taku" now belong to Newtaku's account (a person who changed names)
  s.app.db.prepare('UPDATE users SET name_key = ?, name = ? WHERE id = ?').run('old-taku', 'old-taku', dev.me.id);
  s.app.db.prepare('UPDATE users SET name_key = ?, name = ? WHERE id = ?').run('taku', 'taku', other.me.id);
  assert.equal((await s.call('GET', '/api/ops/me', { token: other.token })).status, 403);
  assert.equal((await admin.command('staff-pin', ['taku'])).name, 'taku');
  assert.equal(pinOf(s, 'taku').user_id, other.me.id);
  // (the server reads the bindings again within seconds; the test does not wait)
  assert.equal((await admin.command('staff-unpin', ['taku'])).removed, true);
  assert.equal(pinOf(s, 'taku'), undefined);
  assert.equal((await admin.command('staff-unpin', ['taku'])).removed, false);
  assert.ok(logged(s, 'admin:staff-pin').length === 1 && logged(s, 'admin:staff-unpin').length === 2);
});
