import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
import { createGameLogin } from '../core/game-login.js';
import { statements } from '../core/db.js';

test('game login locks a normalized account across addresses and instances, then expires or recovers safely', async t => {
  let now = Date.now(); const s = await startServer({ clock: () => now }); t.after(() => s.stop());
  const a = await s.register('AccountLock'), b = await s.register('OtherLock');
  const login = (name, password, ip) => s.call('POST', '/api/login', { body: { name, password }, headers: { 'X-Forwarded-For': ip } });
  for (let i = 0; i < 5; i++) {
    const r = await login('ＡＣＣＯＵＮＴＬＯＣＫ', 'bad-password', '192.0.2.' + i);
    assert.equal(r.status, i === 4 ? 429 : 401);
  }
  assert.equal((await login(a.me.name, PASSWORD, '198.51.100.1')).error.code, 'account_locked');
  assert.equal((await login(b.me.name, PASSWORD)).status, 200);
  const restarted = createGameLogin({ q: statements(s.app.db), tx: fn => s.app.db.tx(fn), clock: () => now });
  await assert.rejects(restarted.verify(a.me.name, PASSWORD), e => e.code === 'account_locked');
  now += 15 * 60000 + 1;
  assert.equal((await login(a.me.name, PASSWORD)).status, 200);
  for (let i = 0; i < 5; i++) await login(a.me.name, 'bad-password');
  assert.equal((await s.call('POST', '/api/login', { body: { code: a.recoveryCode } })).status, 200);
  assert.equal((await login(a.me.name, PASSWORD)).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await login('NoSuchAccount', PASSWORD)).status, i === 4 ? 429 : 401);
});

test('parallel password guesses cannot lose strikes or create sessions after a lock', async t => {
  const s = await startServer(); t.after(() => s.stop()); const a = await s.register('ParallelLock');
  const out = await Promise.all(Array.from({ length: 10 }, () => s.call('POST', '/api/login', { body: { name: a.me.name, password: 'bad-password' } })));
  assert.equal(out.filter(r => r.status === 401).length, 4);
  assert.equal(out.filter(r => r.status === 429).length, 6);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(a.me.id).n, 1);
});
