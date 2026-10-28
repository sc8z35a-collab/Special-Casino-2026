import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { statements } from '../core/db.js';
import { createTrees } from '../core/tree.js';

test('harvest readiness is scheduled once per cycle and survives restarts without granting any reward', async t => {
  const s = await startServer(); t.after(() => s.stop()); const p = await s.register('HarvestNote');
  const q = statements(s.app.db), tx = f => s.app.db.tx(f), notices = [];
  let now = Date.now();
  const service = () => createTrees({ q, tx, getUser: id => q('SELECT * FROM users WHERE id=?').get(id),
    balance: u => u, balanceChanged() {}, clock: () => now, onReady: n => notices.push(n) });
  let trees = service(); const tree = trees.treesOf(p.me.id)[0];
  q("UPDATE trees SET given=100000,cycle='30m',cycle_at=?,cycle_end=? WHERE id=?").run(now, now + 1800000, tree.id);
  assert.equal(trees.nextDue(), now + 1800000); assert.equal(trees.notifyDue(), 0);
  now += 1800000; assert.equal(trees.notifyDue(), 1); assert.equal(notices.length, 1);
  trees = service(); assert.equal(trees.notifyDue(), 0); assert.equal(trees.nextDue(), 0);
  assert.equal(q('SELECT dollars FROM users WHERE id=?').get(p.me.id).dollars, p.me.dollars);
  q('UPDATE trees SET cycle_at=?,cycle_end=? WHERE id=?').run(now + 1, now + 1800000, tree.id);
  assert.equal(trees.nextDue(), now + 1800000); now += 1800000;
  assert.equal(trees.notifyDue(), 1); assert.equal(notices.length, 2);
});

test('housekeeping sends a private harvest event once and includes the next harvest deadline', async t => {
  const s = await startServer(); t.after(() => s.stop()); const p = await s.register('HarvestLive');
  const row = (await s.call('GET', '/api/tree', { token: p.token })).trees[0], now = Date.now();
  const events = [], original = s.app.live.send.bind(s.app.live);
  s.app.live.send = (id, event, data) => { if (event === 'tree') events.push({ id, data }); return original(id, event, data); };
  s.app.db.prepare("UPDATE trees SET cycle='30m',given=100000,cycle_at=?,cycle_end=? WHERE id=?").run(now - 1800000, now - 1, row.id);
  await s.app.api.housekeeping(); await s.app.api.housekeeping();
  assert.equal(events.length, 1); assert.equal(events[0].id, p.me.id); assert.equal(events[0].data.type, 'ready');
  const harvested = await s.call('POST', '/api/tree/harvest', { token: p.token, body: { tree: row.id, next: '30m' } });
  assert.equal(harvested.status, 200); assert.ok(harvested.paid > 0);
  assert.ok(s.app.api.nextHousekeeping() <= harvested.tree.cycle.end + 1000);
  assert.equal(s.app.db.prepare('SELECT notified_cycle,cycle_at FROM trees WHERE id=?').get(row.id).notified_cycle, now - 1800000);
});
