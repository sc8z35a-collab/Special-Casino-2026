import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer } from './helpers.js';
import { createSpinRequests, SPIN_RETRY_MS } from '../core/spin-requests.js';
import { statements } from '../core/db.js';
import { answerOnSocket } from '../core/socketapi.js';
const key = () => Date.now() + '-' + crypto.randomBytes(16).toString('hex');

test('simultaneous spin retries on HTTP/live settle, log, advance quests and publish only once', async t => {
  const s = await startServer({ startTokens: 10000, quests: true, limits: { spin: [1, 1], general: [100000, 10000] } }); t.after(() => s.stop());
  const p = await s.register('SpinRetry');
  const body = { key: key(), bet: 100, idle: 0 };
  const out = await Promise.all(Array.from({ length: 4 }, () => s.call('POST', '/api/spin', { token: p.token, body, raw: true })));
  assert.ok(out.every(r => r.status === 200), JSON.stringify(out));
  for (const r of out) assert.deepEqual(r, out[0]);
  const row = () => s.app.db.prepare('SELECT spins, tokens, quests, rev FROM users WHERE id = ?').get(p.me.id);
  const after = row(); assert.equal(after.spins, 1);
  const live = JSON.parse(await answerOnSocket(s.app.api, { ip: '127.0.0.1' }, { id: 12, m: 'POST', p: '/api/spin', h: { authorization: 'Bearer ' + p.token }, b: body }));
  assert.equal(live.s, 200); assert.deepEqual(live.b.result, out[0].result); assert.deepEqual(row(), after);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM spins WHERE user_id = ?').get(p.me.id).n, 1);
  assert.equal((await s.call('POST', '/api/spin', { token: p.token, body: { ...body, bet: 200 } })).error.code, 'spin_conflict');
  assert.equal((await s.call('POST', '/api/spin', { token: p.token, body: { ...body, key: key() } })).status, 429);
});

test('spin deduplication persists across instances; failures roll back; expired keys cannot bet again after pruning', async t => {
  const s = await startServer({ startTokens: 10000 }); t.after(() => s.stop()); const p = await s.register('SpinPersist');
  const q = statements(s.app.db), tx = fn => s.app.db.tx(fn); let now = Date.now(), settles = 0;
  const make = () => createSpinRequests({ q, tx, clock: () => now }), body = { key: now + '-' + 'a'.repeat(32), bet: 100 };
  const settle = () => { settles++; return { result: { total: 12 } }; };
  assert.deepEqual(make().run(p.me.id, body, settle), make().run(p.me.id, body, settle)); assert.equal(settles, 1);
  const bad = { ...body, key: key() };
  assert.throws(() => make().run(p.me.id, bad, () => { q('UPDATE users SET tokens = 0 WHERE id = ?').run(p.me.id); throw Error('fail'); }), /fail/);
  assert.ok(q('SELECT tokens FROM users WHERE id = ?').get(p.me.id).tokens > 0);
  assert.equal(q('SELECT 1 FROM spin_requests WHERE key = ?').get(bad.key), undefined);
  now += SPIN_RETRY_MS + 1; make().prune();
  assert.throws(() => make().run(p.me.id, body, settle), e => e.code === 'spin_expired'); assert.equal(settles, 1);
});
