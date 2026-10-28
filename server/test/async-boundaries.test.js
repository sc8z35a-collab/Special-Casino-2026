import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

function pauseBody(s, player, path, body) {
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const result = s.app.api.handle({ method: 'POST', path, query: new URLSearchParams(), ip: '127.0.0.1',
    header: name => name.toLowerCase() === 'authorization' ? `Bearer ${player.token}` : '',
    json: () => { entered(); return new Promise(resolve => { release = () => resolve(body); }); } });
  return { ready, result, release: () => release() };
}

test('a delayed request body cannot spend after its session was logged out', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('SlowSender'), b = await s.register('SlowReceiver'); await s.befriend(a, b);
  const pending = pauseBody(s, a, '/api/transfer', { to: b.me.id, currency: 'dollars', amount: 1000 });
  await pending.ready;
  await s.call('POST', '/api/logout', { token: a.token }); pending.release();
  assert.equal((await pending.result).status, 401);
  assert.equal(s.app.db.prepare('SELECT dollars FROM users WHERE id=?').get(a.me.id).dollars, a.me.dollars);
  assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE sender_id=? AND kind='transfer'").get(a.me.id).n, 0);
});

test('a delayed body uses current chat restrictions, not the pre-read account snapshot', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('SlowChatter'), b = await s.register('SlowReader'); await s.befriend(a, b);
  const pending = pauseBody(s, a, '/api/messages', { to: b.me.id, text: 'must not be sent' });
  await pending.ready; s.setUser(a.me.id, { chat_ban: Date.now() }); pending.release();
  assert.equal((await pending.result).status, 403);
  assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE body='must not be sent'").get().n, 0);
});

test('overlapping activity beats cannot count the same online minute more than once', async t => {
  const s = await startServer({ quests: true }); t.after(() => s.stop()); const p = await s.register('Overlapping');
  s.setUser(p.me.id, { beat_at: Date.now() - 60000 });
  const beats = Array.from({ length: 12 }, () => pauseBody(s, p, '/api/beat', { idle: 0, voice: 0 }));
  await Promise.all(beats.map(b => b.ready)); beats.forEach(b => b.release());
  const results = await Promise.all(beats.map(b => b.result));
  assert.ok(results.every(r => r.status === 200));
  const seconds = results.reduce((sum, r) => sum + r.body.counted, 0);
  assert.ok(seconds >= 60 && seconds <= 61, `one minute was counted as ${seconds}s`);
});

test('password hashing cannot finish an MFA enrollment after the authorizing session ends', async t => {
  const s = await startServer({ operators: ['SlowMfa'] }); t.after(() => s.stop()); const p = await s.register('SlowMfa');
  const subtle = globalThis.crypto.subtle, derive = subtle.deriveBits;
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  subtle.deriveBits = async function (...args) { const result = await derive.apply(this, args); entered(); await gate; return result; };
  t.after(() => { subtle.deriveBits = derive; release(); });
  const pending = s.call('POST', '/api/ops/profile/mfa/begin', { token: p.token, body: { password: 'pass1234' } });
  await ready; await s.call('POST', '/api/logout', { token: p.token }); release();
  assert.equal((await pending).status, 401);
  assert.equal(s.app.db.prepare('SELECT pending_secret FROM ops_mfa WHERE user_id=?').get(p.me.id), undefined);
});
