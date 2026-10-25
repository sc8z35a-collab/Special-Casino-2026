import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
import { sealedCall } from './secure.js';
import { base32, totp } from '../core/opsmfa.js';

const NOW = Date.UTC(2026, 9, 25, 0, 0, 10);
const code = (s, offset = 0) => totp(s, Math.floor(NOW / 30000) + offset);
const prefix = '/api/ops/profile/mfa/';
test('TOTP matches the RFC 6238 SHA-1 reference vectors', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  for (const [seconds, value] of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']]) assert.equal(totp(secret, Math.floor(seconds / 30), 8), value);
});

test('staff MFA enrollment rejects players, verifies setup, encrypts seeds and blocks game-token bypass', async () => {
  const s = await startServer({ operators: ['taku', 'Mod'], clock: () => NOW });
  try {
    const dev = await s.register('taku'), mod = await s.register('Mod'), a = await s.register('Alice');
    const call = (u, method, path, body) => s.call(method, path, { token: u.token, body });
    assert.equal((await call(a, 'GET', '/api/ops/profile')).status, 403);
    assert.equal((await call(a, 'POST', prefix + 'begin', { password: PASSWORD })).status, 403);
    assert.equal((await call(mod, 'GET', '/api/ops/profile')).mfa.mode, 0);
    assert.equal((await call(dev, 'POST', prefix + 'begin', { password: 'wrong' })).status, 403);
    const setup = await call(dev, 'POST', prefix + 'begin', { password: PASSWORD }); assert.equal(setup.status, 200); assert.match(setup.secret, /^[A-Z2-7]{32}$/);
    assert.equal((await call(dev, 'POST', prefix + 'enable', { password: PASSWORD, mode: 2, otp: 'no' })).status, 403);
    assert.equal((await call(dev, 'GET', '/api/ops/profile')).mfa.mode, 0, 'unconfirmed setup must not enable MFA');
    const older = await s.call('POST', '/api/login', { body: { name: 'taku', password: PASSWORD } });
    const enabled = await call(dev, 'POST', prefix + 'enable', { password: PASSWORD, mode: 2, otp: code(setup.secret) });
    assert.equal(enabled.status, 200); assert.equal(enabled.mfa.mode, 2); assert.equal(enabled.recovery.length, 10);
    const stored = s.app.db.prepare('SELECT * FROM ops_mfa WHERE user_id = ?').get(dev.me.id);
    assert.notEqual(stored.secret, setup.secret); assert.ok(!stored.recovery.includes(enabled.recovery[0])); assert.equal(stored.pending_secret, '');
    assert.equal((await call(dev, 'GET', '/api/ops/me')).status, 200, 'current session is upgraded');
    assert.equal((await call(older, 'GET', '/api/ops/me')).error.code, 'mfa_required');
    assert.equal((await call(older, 'GET', '/api/sec/me')).error.code, 'mfa_required');
    assert.equal((await call(older, 'GET', '/api/ops/diary')).error.code, 'mfa_required');
    assert.equal((await call(older, 'GET', '/api/vault/spaces')).error.code, 'mfa_required');
    assert.equal((await call(older, 'GET', '/api/backup')).error.code, 'mfa_required');
    assert.equal((await call(older, 'GET', '/api/me')).status, 200, 'the game itself still works');
    const passwordOnly = await s.call('POST', '/api/ops/login', { body: { name: 'taku', password: PASSWORD } });
    assert.equal(passwordOnly.error.code, 'mfa_required'); assert.equal(passwordOnly.token, undefined);
    const replay = await s.call('POST', '/api/ops/login', { body: { name: 'taku', password: PASSWORD, otp: code(setup.secret) } }); assert.equal(replay.error.code, 'mfa_invalid');
    const recovered = await s.call('POST', '/api/ops/login', { body: { name: 'taku', password: PASSWORD, recovery: enabled.recovery[0] } }); assert.equal(recovered.status, 200);
    assert.equal((await sealedCall(s)('GET', '/api/sec/me', { token: recovered.token })).status, 200);
    assert.equal((await call(recovered, 'GET', '/api/ops/profile')).mfa.recoveryLeft, 9);
    const reuse = await s.call('POST', '/api/ops/login', { body: { name: 'taku', password: PASSWORD, recovery: enabled.recovery[0] } }); assert.equal(reuse.error.code, 'mfa_invalid');
    const disabled = await call(recovered, 'POST', prefix + 'disable', { password: PASSWORD, recovery: enabled.recovery[1] }); assert.equal(disabled.status, 200); assert.equal(disabled.mfa.mode, 0);
    assert.equal((await call(older, 'GET', '/api/ops/me')).status, 200);
  } finally { await s.stop(); }
});

test('three-stage verification requires its separate phrase and expired setup cannot enroll', async () => {
  const s = await startServer({ operators: ['taku', 'Mod'], clock: () => NOW });
  try {
    const mod = await s.register('Mod');
    const call = (path, body) => s.call('POST', prefix + path, { token: mod.token, body });
    let setup = await call('begin', { password: PASSWORD });
    s.app.db.prepare('UPDATE ops_mfa SET pending_until = 1 WHERE user_id = ?').run(mod.me.id);
    assert.equal((await call('enable', { password: PASSWORD, mode: 2, otp: code(setup.secret) })).error.code, 'setup_expired');
    setup = await call('begin', { password: PASSWORD });
    assert.equal((await call('enable', { password: PASSWORD, mode: 3, otp: code(setup.secret), newPhrase: 'short' })).status, 400);
    const phrase = '別の確認フレーズ123456';
    const enabled = await call('enable', { password: PASSWORD, mode: 3, otp: code(setup.secret), newPhrase: phrase }); assert.equal(enabled.status, 200);
    const login = (fields) => s.call('POST', '/api/ops/login', { body: { name: 'Mod', password: PASSWORD, ...fields } });
    const noPhrase = await login({ otp: code(setup.secret, 1) }); assert.equal(noPhrase.error.code, 'mfa_invalid');
    const good = await login({ otp: code(setup.secret, 1), phrase, recovery: '' }); assert.equal(good.status, 200, 'browser forms submit an empty optional recovery field');
    assert.equal((await s.call('GET', '/api/ops/profile', { token: good.token })).mfa.mode, 3);
    const hash = s.app.db.prepare('SELECT phrase_hash FROM ops_mfa WHERE user_id = ?').get(mod.me.id).phrase_hash; assert.ok(!hash.includes(phrase));
    assert.equal((await s.call('POST', prefix + 'disable', { token: good.token, body: { password: PASSWORD, recovery: enabled.recovery[0] } })).status, 403);
    assert.equal((await s.call('POST', prefix + 'disable', { token: good.token, body: { password: PASSWORD, phrase, recovery: enabled.recovery[0] } })).status, 200);
  } finally { await s.stop(); }
});

test('wrong MFA codes trigger the existing operator lock and unused tickets are invalidated on enrollment', async () => {
  const s = await startServer({ clock: () => NOW });
  try {
    const dev = await s.register('taku');
    const oldTicket = await s.call('POST', '/api/ops/live-ticket', { token: dev.token });
    const setup = await s.call('POST', prefix + 'begin', { token: dev.token, body: { password: PASSWORD } });
    const enabled = await s.call('POST', prefix + 'enable', { token: dev.token, body: { password: PASSWORD, mode: 2, otp: code(setup.secret) } }); assert.equal(enabled.status, 200);
    assert.equal(s.app.api.consumeOpsTicket(oldTicket.ticket), null);
    const fresh = await s.call('POST', '/api/ops/live-ticket', { token: dev.token }); assert.equal(fresh.status, 200); assert.equal(s.app.api.consumeOpsTicket(fresh.ticket), dev.me.id);
    const args = { body: { name: 'taku', password: PASSWORD, otp: 'xxxxxx' } };
    assert.equal((await s.call('POST', '/api/ops/login', args)).error.code, 'mfa_invalid');
    assert.equal((await s.call('POST', '/api/ops/login', args)).error.code, 'ops_locked');
  } finally { await s.stop(); }
});

test('parallel logins consume each TOTP or recovery code only once', async () => {
  const s = await startServer({ clock: () => NOW });
  try {
    const dev = await s.register('taku');
    const setup = await s.call('POST', prefix + 'begin', { token: dev.token, body: { password: PASSWORD } });
    const enabled = await s.call('POST', prefix + 'enable', { token: dev.token, body: { password: PASSWORD, mode: 2, otp: code(setup.secret) } });
    const login = (i, fields) => s.call('POST', '/api/ops/login', { body: { name: 'taku', password: PASSWORD, ...fields }, headers: { 'X-Ops-Device': 'parallel-device-' + String(i).padStart(4, '0') } });
    const otpResults = await Promise.all([0,1,2].map(i => login(i, { otp: code(setup.secret, 1) })));
    assert.equal(otpResults.filter(r => r.token).length, 1);
    s.app.db.prepare('DELETE FROM ops_locks').run();   // (the replays were wrong tries on the account: its wait is not what this tests)
    const backupResults = await Promise.all([3,4,5].map(i => login(i, { recovery: enabled.recovery[0] })));
    assert.equal(backupResults.filter(r => r.token).length, 1);
    assert.equal((await s.call('GET', '/api/ops/profile', { token: dev.token })).mfa.recoveryLeft, 9);
  } finally { await s.stop(); }
});

test('REQUIRE_DEV_MFA: the developer reaches the profile to set an extra login up, and nothing else before', async () => {
  const s = await startServer({ operators: ['taku', 'Mod'], clock: () => NOW, requireDevMfa: true });
  try {
    const dev = await s.register('taku'), mod = await s.register('Mod');
    const call = (u, method, path, body) => s.call(method, path, { token: u.token, body });
    for (const path of ['/api/ops/players', '/api/ops/log', '/api/sec/me', '/api/vault/spaces', '/api/backup']) {
      const r = await call(dev, 'GET', path);
      assert.deepEqual([r.status, r.error.code], [403, 'mfa_setup_required'], path);
    }
    assert.equal((await call(dev, 'GET', '/api/ops/me')).status, 200);
    assert.equal((await call(dev, 'GET', '/api/ops/profile')).status, 200);
    assert.equal((await call(mod, 'GET', '/api/ops/players')).status, 200, 'an operator is not asked');
    const setup = await call(dev, 'POST', prefix + 'begin', { password: PASSWORD });
    const enabled = await call(dev, 'POST', prefix + 'enable', { password: PASSWORD, mode: 2, otp: code(setup.secret) });
    assert.equal(enabled.status, 200);
    assert.equal((await call(dev, 'GET', '/api/ops/players')).status, 200, 'with the extra login set up, the site opens');
  } finally { await s.stop(); }
});
