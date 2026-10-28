import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { statements, nextRecordId } from '../core/db.js';
import { createRetention } from '../core/retention.js';
import { createAdmin } from '../core/admin.js';
const DAY = 86400000;

test('chat/transfers move atomically, remain readable, expire by policy and never reuse retired IDs', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('ArchiveA'), b = await s.register('ArchiveB');
  const q = statements(s.app.db), tx = fn => s.app.db.tx(fn), now = Date.now();
  const channel = `dm:${a.me.id}:${b.me.id}`;
  function message(age, kind = 'text', pending = 0) {
    const id = nextRecordId(q, 'messages');
    q('INSERT INTO messages (id, channel, sender_id, recipient_id, kind, body, pending, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, channel, a.me.id, b.me.id, kind, 'old text', pending, now - age * DAY);
    return id;
  }
  const archived = message(100), expired = message(400), pending = message(400, 'gift', 1), open = message(400, 'car_offer'), present = message(400, 'present');
  const tid = nextRecordId(q, 'transfers');
  q('INSERT INTO transfers VALUES (?, ?, ?, ?, ?, ?)').run(tid, a.me.id, b.me.id, 'tokens', 100, now - 400 * DAY);
  const oldTid = nextRecordId(q, 'transfers');
  q('INSERT INTO transfers VALUES (?, ?, ?, ?, ?, ?)').run(oldTid, a.me.id, b.me.id, 'tokens', 100, now - 1100 * DAY);
  const policy = createRetention({ q, tx, clock: () => now });
  const result = policy.sweep();
  assert.equal(result.messages.archived, 2); assert.equal(result.messages.deleted, 1);
  assert.equal(result.transfers.archived, 2); assert.equal(result.transfers.deleted, 1);
  assert.ok(q('SELECT id FROM message_archive WHERE id = ?').get(archived));
  assert.equal(q('SELECT id FROM message_history WHERE id = ?').get(expired), undefined);
  for (const id of [pending, open, present]) assert.ok(q('SELECT id FROM messages WHERE id = ?').get(id));
  const page = await s.call('GET', '/api/messages?with=' + a.me.id, { token: b.token });
  assert.equal(page.status, 200); assert.ok(page.messages.some(m => m.id === archived && m.text === 'old text'));
  createAdmin(s.app.db).redact(archived);
  assert.match(q('SELECT body FROM message_archive WHERE id = ?').get(archived).body, /削除/);
  assert.equal(q('SELECT COUNT(*) AS n FROM transfer_history').get().n, 1);
  assert.ok(nextRecordId(q, 'transfers') > oldTid);
  assert.ok(nextRecordId(q, 'messages') > present);
  // A full export/import retains the cold records and high-water counters.
  const admin = createAdmin(s.app.db), backup = admin.export();
  admin.import(backup, { replace: true });
  assert.ok(q('SELECT id FROM message_history WHERE id = ?').get(archived));
  assert.ok(nextRecordId(q, 'transfers') > oldTid);
  assert.deepEqual(policy.sweep(), { skipped: true });
});

test('unread, conversation previews and moderation references stay writable; a failed move cannot lose data', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('RetainA'), b = await s.register('RetainB'); await s.befriend(a, b);
  const sent = await s.call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'keep unread' } });
  const q = statements(s.app.db), tx = fn => s.app.db.tx(fn), now = Date.now();
  q('UPDATE messages SET created_at = ? WHERE id = ?').run(now - 500 * DAY, sent.message.id);
  const policy = createRetention({ q, tx }); policy.sweep({ force: true });
  assert.ok(q('SELECT id FROM messages WHERE id = ?').get(sent.message.id));
  const id = nextRecordId(q, 'messages');
  q('INSERT INTO messages (id, channel, sender_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, 'test', a.me.id, 'text', 'rollback', now - 100 * DAY);
  s.app.db.exec("CREATE TRIGGER reject_archive BEFORE INSERT ON message_archive BEGIN SELECT RAISE(ABORT, 'simulate storage failure'); END");
  assert.throws(() => policy.sweep({ force: true }), /simulate storage failure/);
  assert.ok(q('SELECT id FROM messages WHERE id = ?').get(id));
  assert.equal(q('SELECT id FROM message_archive WHERE id = ?').get(id), undefined);
});

test('the host scheduler drains a retention backlog in bounded one-minute batches', async t => {
  const s = await startServer(); t.after(() => s.stop()); const p = await s.register('RetainQueue');
  const now = Date.now(), put = s.app.db.prepare('INSERT INTO messages (id, channel, sender_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (let i = 1; i <= 501; i++) put.run(i, 'old', p.me.id, 'text', 'read', now - 100 * DAY);
  await s.app.api.housekeeping();
  assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE channel = 'old'").get().n, 1);
  const next = s.app.api.nextHousekeeping();
  assert.ok(next >= now + 60000 && next < now + 90000, `backlog next sweep: ${next - now}ms`);
});
