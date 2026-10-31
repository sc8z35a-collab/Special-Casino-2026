import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

test('a token exchange cannot leave an unreadable currency balance or debit the other currency', async t => {
  const s = await startServer(); t.after(() => s.stop()); const p = await s.register('RangeSell');
  // (enough tokens to come to more than the exchange fee: the balance limit is what refuses it)
  s.setUser(p.me.id, { dollars: Number.MAX_SAFE_INTEGER, tokens: 10000 });
  const r = await s.call('POST', '/api/sell', { token: p.token, body: { amount: 5000 } });
  assert.equal(r.status, 409); assert.equal(r.error.code, 'balance_limit');
  const me = await s.call('GET', '/api/me', { token: p.token });
  assert.equal(me.status, 200); assert.equal(me.me.dollars, Number.MAX_SAFE_INTEGER); assert.equal(me.me.tokens, 10000);
});

test('an overflowing gift claim remains pending and can later be claimed exactly at the boundary', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('RangeGiver'), b = await s.register('RangeTaker'); await s.befriend(a, b);
  const sent = await s.call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, currency: 'dollars', amount: 1000 } });
  assert.equal(sent.status, 200); s.setUser(b.me.id, { dollars: Number.MAX_SAFE_INTEGER });
  const claim = () => s.call('POST', '/api/messages/claim', { token: b.token, body: { message: sent.message.id } });
  const refused = await claim(); assert.equal(refused.status, 409); assert.equal(refused.error.code, 'balance_limit');
  assert.equal(s.app.db.prepare('SELECT claimed_at FROM messages WHERE id=?').get(sent.message.id).claimed_at, 0);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM transfers WHERE to_id=?').get(b.me.id).n, 0);
  s.setUser(b.me.id, { dollars: Number.MAX_SAFE_INTEGER - 1000 });
  const accepted = await claim(); assert.equal(accepted.status, 200); assert.equal(accepted.me.dollars, Number.MAX_SAFE_INTEGER);
  assert.equal((await claim()).error.code, 'claimed');
});

test('a daily bonus that cannot fit does not consume the bonus or corrupt tokens', async t => {
  const s = await startServer(); t.after(() => s.stop()); const p = await s.register('RangeDaily');
  s.setUser(p.me.id, { tokens: Number.MAX_SAFE_INTEGER });
  const r = await s.call('POST', '/api/daily', { token: p.token }); assert.equal(r.error.code, 'balance_limit');
  assert.equal(s.app.db.prepare('SELECT free_day FROM users WHERE id=?').get(p.me.id).free_day, '');
  s.setUser(p.me.id, { tokens: 0 }); assert.equal((await s.call('POST', '/api/daily', { token: p.token })).status, 200);
});
