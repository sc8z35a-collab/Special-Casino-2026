import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
import { RULES } from '../core/rules.js';

async function fixture(t) {
  const s = await startServer({ operators: ['taku'] }), cleanup = [];
  t.after(async () => { cleanup.forEach(fn => fn()); await s.stop(); });
  const a = await s.register('BoundaryA'), b = await s.register('BoundaryB'); await s.befriend(a, b);
  return { s, a, b, cleanup: fn => cleanup.push(fn) };
}
function pauseHash(cleanup) {
  const subtle = globalThis.crypto.subtle, original = subtle.deriveBits;
  let enter, release, paused = false;
  const ready = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  subtle.deriveBits = async function (...args) {
    const value = await original.apply(this, args);
    if (!paused) { paused = true; enter(); await gate; }
    return value;
  };
  cleanup(() => { subtle.deriveBits = original; release(); });
  return { ready, release };
}

for (const change of ['session-ended', 'account-banned']) test(`password hashing cannot rotate credentials after ${change}`, async t => {
  const { s, a, cleanup } = await fixture(t), gate = pauseHash(cleanup);
  const before = s.app.db.prepare('SELECT password_hash,recovery_hash FROM users WHERE id=?').get(a.me.id);
  const pending = s.call('POST', '/api/password', { token: a.token, body: { current: PASSWORD, password: 'must-not-be-saved' } });
  await gate.ready;
  if (change === 'session-ended') s.app.db.prepare("UPDATE sessions SET ended='revoked by operator' WHERE user_id=?").run(a.me.id);
  else s.setUser(a.me.id, { banned: 1, ban_kind: 'suspend', ban_until: Date.now() + 86400000, ban_at: Date.now() });
  gate.release();
  const result = await pending; assert.equal(result.status, change === 'session-ended' ? 401 : 403);
  assert.deepEqual(s.app.db.prepare('SELECT password_hash,recovery_hash FROM users WHERE id=?').get(a.me.id), before);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(a.me.id).n, change === 'session-ended' ? 0 : 1);
});

test('a delayed diary comment respects a newly applied chat ban', async t => {
  const { s, a, cleanup } = await fixture(t), dev = await s.register('taku');
  const post = await s.call('POST', '/api/ops/diary', { token: dev.token, body: { title: 'News', text: 'Body', reward: 0 } });
  assert.equal(post.status, 200);
  let enter, release;
  const ready = new Promise(resolve => { enter = resolve; });
  const pending = s.app.api.handle({ method: 'POST', path: '/api/diary/comments', query: new URLSearchParams(), ip: '127.0.0.1',
    header: name => name.toLowerCase() === 'authorization' ? `Bearer ${a.token}` : '',
    json: () => { enter(); return new Promise(resolve => { release = () => resolve({ post: post.id, text: 'late comment' }); }); } });
  await ready; cleanup(release); s.setUser(a.me.id, { chat_ban: Date.now() }); release();
  assert.equal((await pending).status, 403);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM diary_comments').get().n, 0);
  s.setUser(a.me.id, { chat_ban: 0 });
  assert.equal((await s.call('POST', '/api/diary/comments', { token: a.token, body: { post: post.id, text: 'allowed comment' } })).status, 200);
});

for (const kind of ['suspend', 'deleted']) test(`an existing car offer cannot sell assets of a ${kind} seller`, async t => {
  const { s, a, b } = await fixture(t); s.setUser(a.me.id, { dollars: 100000000 }); s.setUser(b.me.id, { dollars: 100000000 });
  const bought = await s.call('POST', '/api/cars/buy', { token: a.token, body: { model: 'two-state-sedan' } }); assert.equal(bought.status, 200);
  const price = bought.car.paid;
  const offer = await s.call('POST', '/api/cars/offer', { token: a.token, body: { car: bought.car.id, to: b.me.id, price } }); assert.equal(offer.status, 200);
  s.setUser(a.me.id, { banned: 1, ban_kind: kind, ban_at: Date.now() });
  const purchase = await s.call('POST', '/api/cars/offer/buy', { token: b.token, body: { id: offer.message.id } });
  assert.equal(purchase.status, 404);
  assert.equal(s.app.db.prepare('SELECT dollars FROM users WHERE id=?').get(b.me.id).dollars, 100000000);
  assert.equal(s.app.db.prepare('SELECT owner_id FROM cars WHERE id=?').get(bought.car.id).owner_id, a.me.id);
  assert.equal(s.app.db.prepare('SELECT state FROM messages WHERE id=?').get(offer.message.id).state, '');
});

for (const change of ['unfriended', 'banned']) test(`a battle invitation cannot start after the inviter is ${change}`, async t => {
  const { s, a, b } = await fixture(t);
  const id = Number(s.app.db.prepare("INSERT INTO battles(a_id,b_id,spins,bet,state,created_at) VALUES(?,?,?,?, 'invite',?)")
    .run(a.me.id, b.me.id, 10, RULES.bets[0], Date.now()).lastInsertRowid);
  if (change === 'unfriended') assert.equal((await s.call('POST', '/api/friends/remove', { token: a.token, body: { user: b.me.id } })).status, 200);
  else s.setUser(a.me.id, { banned: 1, ban_kind: 'suspend' });
  const r = await s.call('POST', '/api/battle/respond', { token: b.token, body: { id, accept: true } });
  assert.equal(r.status, change === 'unfriended' ? 403 : 404);
  assert.equal(s.app.db.prepare('SELECT state FROM battles WHERE id=?').get(id).state, 'invite');
  assert.equal(s.app.db.prepare('SELECT battle_id FROM users WHERE id=?').get(b.me.id).battle_id, 0);
});

test('unfriending notifies the host, removed watcher and remaining home members to close their peers', async t => {
  const { s, a, b } = await fixture(t), c = await s.register('BoundaryC'); await s.befriend(a, c);
  for (const p of [b, c]) assert.equal((await s.call('POST', '/api/watch', { token: p.token, body: { user: a.me.id, on: true } })).status, 200);
  assert.equal((await s.call('POST', '/api/watch/voice', { token: a.token, body: { user: b.me.id, on: true } })).status, 200);
  const events = [], send = s.app.live.send;
  s.app.live.send = function (id, event, data) { events.push({ id, event, data }); return send.call(this, id, event, data); };
  assert.equal((await s.call('POST', '/api/friends/remove', { token: a.token, body: { user: b.me.id } })).status, 200);
  const seen = (id, type) => events.some(e => e.id === id && e.event === 'watch' && e.data.type === type && (e.data.on === false || type === 'removed'));
  assert.ok(seen(a.me.id, 'watched'), 'host must immediately close the removed peer');
  assert.ok(seen(b.me.id, 'removed'), 'removed watcher must stop media and exit the watched screen');
  assert.ok(seen(c.me.id, 'member'), 'other home members must close the removed peer');
  assert.deepEqual(s.app.db.prepare('SELECT watcher_id FROM watchers WHERE target_id=?').all(a.me.id).map(r => r.watcher_id), [c.me.id]);
});

test('re-adding a friend does not restore voice consent from before the friendship ended', async t => {
  const { s, a, b } = await fixture(t);
  await s.call('POST', '/api/watch', { token: b.token, body: { user: a.me.id, on: true } });
  await s.call('POST', '/api/watch/voice', { token: a.token, body: { user: b.me.id, on: true } });
  s.app.api.presence(b.me.id, false);
  await s.call('POST', '/api/friends/remove', { token: a.token, body: { user: b.me.id } });
  await s.befriend(a, b);
  const again = await s.call('POST', '/api/watch', { token: b.token, body: { user: a.me.id, on: true } });
  assert.equal(again.status, 200); assert.equal(again.voice, false);
});
