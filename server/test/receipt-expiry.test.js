import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RECEIPTS, RULES } from '../core/rules.js';
const DAY = 86400000;

function seedMessage(s, from, to, fields = {}) {
  const m = { kind: 'transfer', amount: 1000, currency: 'dollars', body: '', pending: 1, created_at: Date.now(), ...fields };
  const channel = `dm:${Math.min(from, to)}:${Math.max(from, to)}`;
  return Number(s.app.db.prepare('INSERT INTO messages (channel, sender_id, recipient_id, kind, body, amount, currency, pending, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(channel, from, to, m.kind, m.body, m.amount, m.currency, m.pending, m.created_at).lastInsertRowid);
}

test('receipt deadlines use the sent date: money 30 days, cars/items 90, with the exact boundary excluded', () => {
  const at = Date.UTC(2026, 9, 22);
  for (const [kind, pending, days] of [['transfer', true, 30], ['gift', true, 90], ['item', true, 90], ['present', false, 30], ['car_sold', false, 30]]) {
    const m = { kind, pending, at };
    assert.equal(RECEIPTS.deadline(m), at + days * DAY);
    assert.equal(RECEIPTS.expired(m, at + days * DAY - 1), false);
    assert.equal(RECEIPTS.expired(m, at + days * DAY), true);
    assert.equal(RECEIPTS.expired({ ...m, claimed: true }, at + 1000 * DAY), false);
  }
  assert.equal(RECEIPTS.deadline({ kind: 'text', at }), 0);
  assert.equal(RECEIPTS.deadline({ kind: 'transfer', pending: false, at }), 0, 'old immediately credited transfers remain history');
});

test('player dollar/token transfers expire server-side without credit, replay or sender refunds', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('ExpiryFrom'), b = await s.register('ExpiryTo');
  await s.befriend(a, b);
  s.setUser(a.me.id, { dollars: 10000, tokens: 10000 });
  const now = Date.now(); t.mock.method(Date, 'now', () => now);
  for (const currency of ['dollars', 'tokens']) {
    const sent = await s.call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 1000, currency } });
    assert.equal(sent.status, 200);
    assert.equal(sent.message.expiresAt, now + 30 * DAY);
    s.app.db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(now - 30 * DAY, sent.message.id);
    const get = () => s.call('POST', '/api/messages/claim', { token: b.token, body: { message: sent.message.id } });
    for (let n = 0; n < 2; n++) assert.equal((await get()).error.code, 'expired');
    const rows = await s.call('GET', `/api/messages?with=${a.me.id}`, { token: b.token });
    assert.equal(rows.messages.find(m => m.id === sent.message.id).expired, true);
  }
  const after = (await s.call('GET', '/api/me', { token: b.token })).me;
  assert.equal(after.dollars, b.me.dollars);
  assert.equal(after.tokens, b.me.tokens);
  const from = (await s.call('GET', '/api/me', { token: a.token })).me;
  assert.equal(from.dollars, 9000); assert.equal(from.tokens, 9000);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM transfers').get().n, 0);
});

test('NPC and operator money obey the same deadline; a receipt just before it can still be claimed only once', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const b = await s.register('NpcExpiry');
  const bots = await s.call('GET', '/api/me', { token: b.token });
  const now = Date.now(); t.mock.method(Date, 'now', () => now);
  for (const from of [bots.johnson.id, bots.official.id]) {
    for (const currency of ['dollars', 'tokens']) {
      const late = seedMessage(s, from, b.me.id, { currency, created_at: now - 30 * DAY });
      const r = await s.call('POST', '/api/messages/claim', { token: b.token, body: { message: late } });
      assert.deepEqual([r.status, r.error.code], [410, 'expired']);
    }
  }
  const valid = seedMessage(s, bots.johnson.id, b.me.id, { created_at: now - 30 * DAY + 1 });
  const r = await s.call('POST', '/api/messages/claim', { token: b.token, body: { message: valid } });
  assert.equal(r.status, 200); assert.equal(r.me.dollars, b.me.dollars + 1000);
  assert.equal((await s.call('POST', '/api/messages/claim', { token: b.token, body: { message: valid } })).error.code, 'claimed');
});

test('cars and items stay receivable after day 30, expire at day 90, and expired item reservations no longer fill inventory', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('GiftFrom'), b = await s.register('GiftTo'); await s.befriend(a, b);
  s.setUser(a.me.id, { dollars: 100000000 });
  const bought = await s.call('POST', '/api/cars/buy', { token: a.token, body: { model: 'ferrari-325' } });
  assert.equal(bought.status, 200);
  const car = s.app.db.prepare('SELECT id FROM cars WHERE owner_id = ?').get(a.me.id);
  const sent = await s.call('POST', '/api/cars/gift', { token: a.token, body: { to: b.me.id, car: car.id } });
  assert.equal(sent.status, 200);
  const now = Date.now(); t.mock.method(Date, 'now', () => now);
  s.app.db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(now - 90 * DAY, sent.message.id);
  const late = await s.call('POST', '/api/messages/claim', { token: b.token, body: { message: sent.message.id } });
  assert.equal(late.error.code, 'expired');
  assert.equal(s.app.db.prepare('SELECT owner_id FROM cars WHERE id = ?').get(car.id).owner_id, 0);
  s.app.db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(now - 90 * DAY + 1, sent.message.id);
  assert.equal((await s.call('POST', '/api/messages/claim', { token: b.token, body: { message: sent.message.id } })).status, 200);
  const full = seedMessage(s, a.me.id, b.me.id, { kind: 'item', body: 'omamori', amount: RULES.shop[0].max, created_at: now - 90 * DAY });
  assert.equal((await s.call('POST', '/api/messages/claim', { token: b.token, body: { message: full } })).error.code, 'expired');
  s.app.db.prepare('INSERT INTO items (user_id, item, count) VALUES (?, ?, ?)').run(a.me.id, 'omamori', 1);
  const item = await s.call('POST', '/api/items/give', { token: a.token, body: { to: b.me.id, id: 'omamori', count: 1 } });
  assert.equal(item.status, 200, JSON.stringify(item));
  s.app.db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(now - 45 * DAY, item.message.id);
  assert.equal((await s.call('POST', '/api/messages/claim', { token: b.token, body: { message: item.message.id } })).status, 200);
});

test('present cash and car-sale proceeds cannot bypass the 30-day money deadline through their own claim routes', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('OtherMoney'), b = await s.register('OtherTo');
  const now = Date.now(); t.mock.method(Date, 'now', () => now);
  for (const [kind, route, key] of [['present', '/api/present/claim', 'message'], ['car_sold', '/api/cars/sold/claim', 'id']]) {
    const id = seedMessage(s, a.me.id, b.me.id, { kind, pending: 0, body: kind === 'present' ? 'snowman' : '{}', created_at: now - 30 * DAY });
    const r = await s.call('POST', route, { token: b.token, body: { [key]: id } });
    assert.deepEqual([r.status, r.error.code], [410, 'expired']);
  }
  assert.equal((await s.call('GET', '/api/me', { token: b.token })).me.dollars, b.me.dollars);
});

// (money is never lost: what was sent comes back to the friend who sent it, its time run out or not — a car or an item
// whose time ran out lapses)
test('deleting a recipient returns the money sent to them, expired or not, and removes their permanent VIP data', async t => {
  const { purgePlayer } = await import('../core/purge.js');
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('RefundFrom'), b = await s.register('DeletedTo');
  const now = Date.now();
  seedMessage(s, a.me.id, b.me.id, { amount: 1000, created_at: now - 31 * DAY });
  seedMessage(s, a.me.id, b.me.id, { amount: 50, created_at: now - DAY });
  s.setUser(b.me.id, { vip_exp: 14800, vip_permanent_at: now, vip_modes: JSON.stringify([{ start: now, end: now + DAY, mode: 'ultra' }]) });
  const q = sql => s.app.db.prepare(sql);
  purgePlayer(q, fn => s.app.db.tx(fn), b.me.id, now);
  assert.equal(s.app.db.prepare('SELECT dollars FROM users WHERE id = ?').get(a.me.id).dollars, a.me.dollars + 1050);
  const gone = s.app.db.prepare('SELECT vip_exp, vip_modes, vip_permanent_at FROM users WHERE id = ?').get(b.me.id);
  assert.deepEqual({ ...gone }, { vip_exp: 0, vip_modes: '[]', vip_permanent_at: 0 });
});
