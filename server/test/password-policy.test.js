import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
import { hashPassword, verifyPassword } from '../core/auth.js';
import { createAdmin } from '../core/admin.js';

async function setup(t, overrides) {
  const s = await startServer(overrides);
  t.after(() => s.stop());
  return s;
}
const stored = (s, id) => s.app.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id).password_hash;

test('registration rejects every length below eight and accepts eight Unicode characters', async t => {
  const s = await setup(t);
  for (let n = 0; n < 8; n++) {
    const r = await s.call('POST', '/api/register', { body: { name: 'ShortNew', password: 'x'.repeat(n) } });
    assert.equal(r.status, 400, `length ${n}`);
    assert.equal(r.error.code, 'password_short');
    assert.equal(s.app.db.prepare("SELECT count(*) AS n FROM users WHERE name_key = 'shortnew'").get().n, 0);
  }
  const password = '😀'.repeat(8);
  const p = await s.register('EightNew', { password });
  assert.equal((await s.call('POST', '/api/login', { body: { name: p.me.name, password } })).status, 200);
});

test('password changes and first-time settings reject short values without changing credentials', async t => {
  const s = await setup(t);
  const p = await s.register('ChangePass');
  for (const old of [stored(s, p.me.id), '']) {
    s.setUser(p.me.id, { password_hash: old });
    for (let n = 0; n < 8; n++) {
      const r = await s.call('POST', '/api/password', { token: p.token,
        body: { current: PASSWORD, password: 'x'.repeat(n) } });
      assert.equal(r.status, 400, `length ${n}, existing password ${!!old}`);
      assert.equal(r.error.code, 'password_short');
      assert.equal(stored(s, p.me.id), old);
    }
  }
  assert.equal((await s.call('POST', '/api/password', { token: p.token, body: { password: 'eight888' } })).status, 200);
  assert.equal(await verifyPassword('eight888', stored(s, p.me.id)), true);
});

test('legacy four-to-seven-character passwords still verify, log in to both sites and authorize changes', async t => {
  const s = await setup(t, { operators: ['Legacy4', 'Legacy5', 'Legacy6', 'Legacy7'] });
  for (let n = 4; n <= 7; n++) {
    const p = await s.register('Legacy' + n), password = 'x'.repeat(n);
    // Model an account already stored before the new-password policy changed.
    const hash = await hashPassword(password);
    s.setUser(p.me.id, { password_hash: hash });
    assert.equal(await verifyPassword(password, hash), true);
    assert.equal(await verifyPassword(password + 'wrong', hash), false);
    const login = await s.call('POST', '/api/login', { body: { name: p.me.name, password } });
    assert.equal(login.status, 200);
    assert.equal(login.me.id, p.me.id);
    const ops = await s.call('POST', '/api/ops/login', { body: { name: p.me.name, password } });
    assert.equal(ops.status, 200);
    assert.equal(ops.name, p.me.name);
    assert.equal((await s.call('POST', '/api/password', { token: login.token,
      body: { current: password, password: 'eight888' } })).status, 200);
    assert.equal((await s.call('POST', '/api/login', { body: { name: p.me.name, password: 'eight888' } })).status, 200);
  }
});

test('operator and command-line password resets enforce the same eight-character boundary', async t => {
  const s = await setup(t, { operators: ['ResetStaff'] });
  const staff = await s.register('ResetStaff'), p = await s.register('ResetUser');
  const admin = createAdmin(s.app.db);
  for (let n = 0; n < 8; n++) {
    const before = stored(s, p.me.id), password = 'x'.repeat(n);
    const r = await s.call('POST', '/api/ops/password', { token: staff.token, body: { id: p.me.id, password } });
    assert.equal(r.status, 400);
    assert.equal(r.error.code, 'password_short');
    await assert.rejects(admin.password(p.me.name, password), e => e.code === 'password_short');
    assert.equal(stored(s, p.me.id), before);
  }
  assert.equal((await s.call('POST', '/api/ops/password', { token: staff.token,
    body: { id: p.me.id, password: 'eight888' } })).status, 200);
  assert.equal(await verifyPassword('eight888', stored(s, p.me.id)), true);
  await admin.password(p.me.name, 'other888');
  assert.equal(await verifyPassword('other888', stored(s, p.me.id)), true);
});

test('a password too easy for staff is named, and the operator site is told at login', async t => {
  const { staffPasswordWeakness } = await import('../core/auth.js');
  for (const [pw, why] of [['', 'short'], ['25209', 'short'], ['elevenchars', 'short'], ['123456789012', 'digits'], ['aaaaaaaaaaaaaaa', 'repeat'], ['abababababab', 'repeat'],
    ['correct horse battery', ''], ['Tw0-State-Casino!', ''], ['日本語のながいあいことば', '']]) {
    assert.equal(staffPasswordWeakness(pw), why, JSON.stringify(pw));
  }
  const s = await setup(t);
  await s.register('taku', { password: '123456789012' });
  const login = (password, device) => s.call('POST', '/api/ops/login', { body: { name: 'taku', password }, headers: { 'X-Ops-Device': device } });
  const weak = await login('123456789012', 'browser-weak0000000000');
  assert.equal(weak.status, 200);
  assert.equal((await s.call('GET', '/api/ops/me', { token: weak.token })).weakPassword, 'digits');
  // a better password (set the way the game does) is not named
  s.app.db.prepare('UPDATE users SET password_hash = ? WHERE name_key = ?').run(await hashPassword('Tw0-State-Casino!'), 'taku');
  const strong = await login('Tw0-State-Casino!', 'browser-strong00000000');
  assert.equal(strong.status, 200);
  assert.equal((await s.call('GET', '/api/ops/me', { token: strong.token })).weakPassword, '');
  // each login keeps its own word
  assert.equal((await s.call('GET', '/api/ops/me', { token: weak.token })).weakPassword, 'digits');
});
