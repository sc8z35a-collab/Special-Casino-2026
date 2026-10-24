import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES } from '../core/rules.js';

const send = (s, a, b, amount, currency = 'dollars') => s.call('POST', '/api/transfer', {
  token: a.token, body: { to: b.me.id, amount, currency }
});
async function players(t, overrides = {}) {
  const s = await startServer(overrides); t.after(() => s.stop());
  const a = await s.register('CapSender'), b = await s.register('CapFriend'), c = await s.register('CapOther');
  await s.befriend(a, b); await s.befriend(a, c);
  for (const p of [a, b, c]) s.setUser(p.me.id, { dollars: 20000000, tokens: 2000000 });
  return { s, a, b, c };
}
const me = async (s, p) => (await s.call('GET', '/api/me', { token: p.token })).me;

test('daily cap combines dollars and converted tokens across recipients at send time', async t => {
  const { s, a, b, c } = await players(t, { quests: true });
  const pending = await send(s, a, b, 4000000); assert.equal(pending.status, 200);
  assert.equal(pending.message.pending, true);
  assert.equal((await send(s, a, c, 1000000 / RULES.tokenPrice, 'tokens')).status, 200);
  const before = await me(s, a), messages = s.app.db.prepare('SELECT count(*) AS n FROM messages').get().n;
  for (const currency of ['dollars', 'tokens']) {
    const rejected = await send(s, a, b, 1, currency);
    assert.equal(rejected.error.code, 'transfer_daily_limit');
  }
  const after = await me(s, a);
  assert.equal(after.dollars, before.dollars); assert.equal(after.tokens, before.tokens);
  assert.deepEqual(after.questTickets, before.questTickets);
  assert.equal(s.app.db.prepare('SELECT count(*) AS n FROM messages').get().n, messages);
  assert.equal(s.app.db.prepare('SELECT dollars FROM player_transfer_days WHERE user_id=?').get(a.me.id).dollars, 5000000);
  // Receiver claims neither message: pending transfers already consumed the allowance.
  assert.equal((await send(s, b, a, 5000000)).status, 200, 'each sender has their own allowance');
  assert.equal((await s.call('POST', '/api/messages/claim', { token: b.token, body: { message: pending.message.id } })).status, 200);
  assert.equal((await send(s, a, b, 1)).error.code, 'transfer_daily_limit', 'claiming does not change sending totals');
});

test('held receipts and deleting message history cannot restore the sending allowance', async t => {
  const { s, a, b } = await players(t);
  s.app.db.prepare('INSERT INTO blocks(user_id,blocked_id,created_at) VALUES(?,?,?)').run(b.me.id, a.me.id, Date.now());
  assert.equal((await send(s, a, b, 5000000)).status, 200);
  s.app.db.prepare("DELETE FROM messages WHERE sender_id=? AND kind='transfer'").run(a.me.id);
  assert.equal((await send(s, a, b, 1)).error.code, 'transfer_daily_limit');
});

test('allowance rolls over precisely at midnight Japan time, not UTC or a rolling 24 hours', async t => {
  const { s, a, b } = await players(t);
  let now = Date.UTC(2026, 9, 24, 14, 59, 59, 999); t.mock.method(Date, 'now', () => now);
  assert.equal((await send(s, a, b, 5000000)).status, 200);
  assert.equal((await send(s, a, b, 1)).error.code, 'transfer_daily_limit');
  now++;
  assert.equal((await send(s, a, b, 5000000)).status, 200);
  assert.equal((await send(s, a, b, 1)).error.code, 'transfer_daily_limit');
  now = Date.UTC(2026, 9, 25, 0);
  assert.equal((await send(s, a, b, 1)).error.code, 'transfer_daily_limit', 'UTC midnight grants no additional allowance');
});

test('failed and simultaneous transfers cannot consume or exceed the allowance', async t => {
  const { s, a, b, c } = await players(t);
  s.setUser(a.me.id, { dollars: 0 });
  assert.equal((await send(s, a, b, 100)).error.code, 'insufficient');
  assert.equal(s.app.db.prepare('SELECT count(*) AS n FROM player_transfer_days WHERE user_id=?').get(a.me.id).n, 0);
  s.setUser(a.me.id, { dollars: 20000000 });
  const both = await Promise.all([send(s, a, b, 3000000), send(s, a, c, 3000000)]);
  assert.equal(both.filter(r => r.status === 200).length, 1);
  assert.equal(both.filter(r => r.error?.code === 'transfer_daily_limit').length, 1);
  assert.equal((await me(s, a)).dollars, 17000000);
  assert.equal((await send(s, a, c, 2000000)).status, 200, 'a rejected transfer reserves nothing');
});

test('the first counter includes existing same-day messages but excludes older and incoming messages', async t => {
  const { s, a, b } = await players(t);
  const now = Date.UTC(2026, 9, 24, 12); t.mock.method(Date, 'now', () => now);
  const start = Date.UTC(2026, 9, 23, 15);
  const insert = s.app.db.prepare("INSERT INTO messages(channel,sender_id,recipient_id,kind,amount,currency,created_at) VALUES(?,?,?,'transfer',?,?,?)");
  const channel = [a.me.id, b.me.id].sort((x,y) => x-y).join(':');
  insert.run(channel, a.me.id, b.me.id, 4000000, 'dollars', start);
  insert.run(channel, a.me.id, b.me.id, 500000 / RULES.tokenPrice, 'tokens', now);
  insert.run(channel, a.me.id, b.me.id, 5000000, 'dollars', start - 1);
  insert.run(channel, b.me.id, a.me.id, 5000000, 'dollars', now);
  assert.equal((await send(s, a, b, 500001)).error.code, 'transfer_daily_limit');
  assert.equal((await send(s, a, b, 500000)).status, 200);
  assert.equal(s.app.db.prepare('SELECT dollars FROM player_transfer_days WHERE user_id=?').get(a.me.id).dollars, 5000000);
});
