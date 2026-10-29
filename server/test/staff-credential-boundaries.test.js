import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';

const CODE = '987654321098';
async function setup(t) {
  const s = await startServer({ operators: ['taku', 'HelperOne', 'HelperTwo'] });
  t.after(() => s.stop());
  const dev = await s.register('TAKU'), mod = await s.register('HelperOne'), other = await s.register('HelperTwo');
  return { s, dev, mod, other };
}

test('an operator cannot obtain another staff account recovery code from lists, details or mutation responses', async t => {
  const { s, dev, mod, other } = await setup(t);
  for (const url of ['/api/ops/players', `/api/ops/player?id=${dev.me.id}`, `/api/ops/player?id=${other.me.id}`]) {
    const r = await s.call('GET', url, { token: mod.token });
    assert.equal(r.status, 200);
    const text = JSON.stringify(r);
    assert.ok(!text.includes(dev.recoveryCode), url + ' exposed the developer login');
    assert.ok(!text.includes(other.recoveryCode), url + ' exposed another operator login');
  }
  // Alternate routes also include a player row. A read-only fix to /players alone is insufficient.
  const touched = await s.call('POST', '/api/ops/device-ok', { token: mod.token, body: { id: dev.me.id } });
  assert.equal(touched.status, 200);
  assert.equal(touched.player.code, '');
  assert.equal(touched.player.credentialsEditable, false);
  const full = await s.call('GET', '/api/ops/players', { token: dev.token });
  assert.equal(full.players.find(p => p.id === other.me.id).code, other.recoveryCode);
  const own = await s.call('GET', `/api/ops/player?id=${mod.me.id}`, { token: mod.token });
  assert.equal(own.player.code, mod.recoveryCode);
});

for (const action of ['password', 'recovery']) test(`an operator cannot reset the developer or another operator ${action}`, async t => {
  const { s, dev, mod, other } = await setup(t);
  for (const target of [dev, other]) {
    const before = s.app.db.prepare('SELECT password_hash,recovery_hash FROM users WHERE id=?').get(target.me.id);
    const r = await s.call('POST', '/api/ops/' + action, { token: mod.token, body: { id: target.me.id, password: 'taken-over-password' } });
    assert.equal(r.status, 403, 'staff credential reset must be refused');
    assert.deepEqual(s.app.db.prepare('SELECT password_hash,recovery_hash FROM users WHERE id=?').get(target.me.id), before);
    assert.equal((await s.call('GET', '/api/me', { token: target.token })).status, 200);
    assert.equal((await s.call('POST', '/api/login', { body: { name: target.me.name, password: PASSWORD } })).status, 200);
  }
});

test('operator help for ordinary players and developer recovery for staff still work', async t => {
  const { s, dev, mod, other } = await setup(t), player = await s.register('OrdinaryHelp');
  const r = await s.call('POST', '/api/ops/recovery', { token: mod.token, body: { id: player.me.id } });
  assert.equal(r.status, 200); assert.equal(r.player.code, r.code);
  assert.equal((await s.call('POST', '/api/ops/password', { token: mod.token, body: { id: player.me.id, password: 'helped-password' } })).status, 200);
  assert.equal((await s.call('POST', '/api/login', { body: { name: player.me.name, password: 'helped-password' } })).status, 200);
  assert.equal((await s.call('POST', '/api/ops/password', { token: dev.token, body: { id: other.me.id, password: 'staff-recovery-password' } })).status, 200);
  assert.equal((await s.call('POST', '/api/login', { body: { name: other.me.name, password: 'staff-recovery-password' } })).status, 200);
});

function pauseHash(t) {
  const subtle = globalThis.crypto.subtle, original = subtle.deriveBits;
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  let paused = false;
  subtle.deriveBits = async function (...args) {
    const result = await original.apply(this, args);
    if (!paused) { paused = true; entered(); await gate; }
    return result;
  };
  t.after(() => { subtle.deriveBits = original; release(); });
  return { ready, release };
}

test('a password reset started before staff promotion cannot overwrite the newly protected credentials', async t => {
  const { s, dev, mod } = await setup(t), player = await s.register('PromotedHelp');
  assert.equal((await s.call('POST', '/api/ops/dev-code', { token: dev.token, body: { code: CODE } })).status, 200);
  const gate = pauseHash(t);
  const pending = s.call('POST', '/api/ops/password', { token: mod.token, body: { id: player.me.id, password: 'old-request-password' } });
  await gate.ready;
  assert.equal((await s.call('POST', '/api/ops/operator', { token: dev.token, body: { name: player.me.name, action: 'grant', code: CODE } })).status, 200);
  gate.release();
  assert.equal((await pending).status, 403);
  assert.equal((await s.call('POST', '/api/login', { body: { name: player.me.name, password: PASSWORD } })).status, 200);
});

test('account deletion rechecks staff protection after the developer code verification yields', async t => {
  const { s, dev } = await setup(t), player = await s.register('NewStaffDel');
  assert.equal((await s.call('POST', '/api/ops/dev-code', { token: dev.token, body: { code: CODE } })).status, 200);
  const gate = pauseHash(t);
  const pending = s.call('POST', '/api/ops/delete-account', { token: dev.token, body: { id: player.me.id, code: CODE } });
  await gate.ready;
  assert.equal((await s.call('POST', '/api/ops/operator', { token: dev.token, body: { name: player.me.name, action: 'grant', code: CODE } })).status, 200);
  gate.release();
  assert.equal((await pending).status, 400);
  assert.equal(s.app.db.prepare('SELECT ban_kind FROM users WHERE id=?').get(player.me.id).ban_kind, '');
  assert.equal((await s.call('GET', '/api/ops/me', { token: player.token })).status, 200);
});
