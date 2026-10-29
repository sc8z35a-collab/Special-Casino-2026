import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
async function fixture(t) {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('BlockOwner'), b = await s.register('BlockPeer'); await s.befriend(a, b);
  const events = [], send = s.app.live.send;
  t.mock.method(s.app.live, 'send', function (...args) { events.push(args); return send.apply(this, args); });
  const block = on => s.call('POST', '/api/block', { token: a.token, body: { user: b.me.id, blocked: on } });
  return { s, a, b, events, block };
}
for (const socket of [false, true]) for (const reverse of [false, true]) test(`blocked direct typing stays silent over ${socket ? 'socket' : 'HTTP'} (${reverse ? 'owner sends' : 'peer sends'})`, async t => {
  const { s, a, b, events, block } = await fixture(t); await block(true); events.length = 0;
  const from = reverse ? a : b, to = reverse ? b : a, body = { to: to.me.id };
  if (socket) s.app.api.socketTyping(from.me.id, body); else assert.equal((await s.call('POST', '/api/typing', { token: from.token, body })).status, 200);
  assert.equal(events.some(([, event]) => event === 'typing'), false);
  await block(false); events.length = 0;
  if (socket) s.app.api.socketTyping(from.me.id, body); else await s.call('POST', '/api/typing', { token: from.token, body });
  assert.equal(events.filter(([id, event]) => id === to.me.id && event === 'typing').length, 1);
});

for (const socket of [false, true]) for (const group of [false, true]) test(`chat suspension stops ${group ? 'group' : 'direct'} typing over ${socket ? 'socket' : 'HTTP'}`, async t => {
  const { s, a, b, events } = await fixture(t);
  const created = group ? await s.call('POST', '/api/groups', { token: a.token, body: { name: 'Privacy', members: [b.me.id] } }) : null;
  const body = group ? { group: created.group.id } : { to: b.me.id };
  s.setUser(a.me.id, { chat_ban: Date.now() }); events.length = 0;
  if (socket) s.app.api.socketTyping(a.me.id, body); else assert.equal((await s.call('POST', '/api/typing', { token: a.token, body })).status, 403);
  assert.equal(events.some(([, event]) => event === 'typing'), false);
});

for (const socket of [false, true]) for (const reverse of [false, true]) test(`home call signalling obeys blocks over ${socket ? 'socket' : 'HTTP'} (${reverse ? 'owner sends' : 'peer sends'})`, async t => {
  const { s, a, b, events, block } = await fixture(t);
  await s.call('POST', '/api/watch', { token: b.token, body: { user: a.me.id, on: true } });
  await s.call('POST', '/api/watch/voice', { token: a.token, body: { user: b.me.id, on: true } });
  await block(true); events.length = 0;
  const from = reverse ? a : b, to = reverse ? b : a, body = { to: to.me.id, type: 'home', callId: 'block-call-123', data: { op: 'hello', room: a.me.id } };
  if (socket) s.app.api.socketCall(from.me.id, body); else assert.equal((await s.call('POST', '/api/call', { token: from.token, body })).status, 200);
  assert.equal(events.some(([, event]) => event === 'call'), false);
  await block(false); events.length = 0;
  if (socket) s.app.api.socketCall(from.me.id, body); else await s.call('POST', '/api/call', { token: from.token, body });
  assert.equal(events.filter(([id, event]) => id === to.me.id && event === 'call').length, 1);
});

test('block updates reach only the owner devices and reconnect snapshots carry only their own list', async t => {
  const { s, a, b, events, block } = await fixture(t); await block(true);
  const updates = events.filter(([, event]) => event === 'block');
  assert.equal(updates.length, 1); assert.equal(updates[0][0], a.me.id);
  assert.equal(updates[0][2].user, b.me.id); assert.equal(updates[0][2].blocked, true);
  assert.deepEqual((await s.call('GET', '/api/me', { token: a.token })).blocked, [b.me.id]);
  assert.deepEqual(s.app.api.hello(a.me.id).blocked, [b.me.id]);
  assert.deepEqual(s.app.api.hello(b.me.id).blocked, []);
});

test('a failed legacy held-payment release cannot remove the block or notify other devices', async t => {
  const { s, a, b, events, block } = await fixture(t); await block(true);
  const q = sql => s.app.db.prepare(sql), now = Date.now();
  const message = Number(q("INSERT INTO messages(channel,sender_id,recipient_id,kind,amount,currency,held,pending,created_at) VALUES(?,?,?,'transfer',1,'dollars',1,0,?)")
    .run(`dm:${Math.min(a.me.id, b.me.id)}:${Math.max(a.me.id, b.me.id)}`, b.me.id, a.me.id, now).lastInsertRowid);
  s.setUser(a.me.id, { dollars: Number.MAX_SAFE_INTEGER }); events.length = 0;
  const failed = await block(false); assert.equal(failed.status, 409); assert.equal(failed.error.code, 'balance_limit');
  assert.ok(q('SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=?').get(a.me.id, b.me.id));
  assert.equal(q('SELECT held FROM messages WHERE id=?').get(message).held, 1);
  assert.equal(events.some(([, event]) => event === 'block' || event === 'balance'), false);
  s.setUser(a.me.id, { dollars: Number.MAX_SAFE_INTEGER - 1 });
  assert.equal((await block(false)).status, 200); assert.equal(q('SELECT dollars FROM users WHERE id=?').get(a.me.id).dollars, Number.MAX_SAFE_INTEGER);
  assert.equal(q('SELECT held FROM messages WHERE id=?').get(message).held, 0);
});
