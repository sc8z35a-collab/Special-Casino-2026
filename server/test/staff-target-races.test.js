import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
const CODE = '987654321098';
async function fixture(t) {
  const s = await startServer({ operators: ['taku'] }); t.after(() => s.stop());
  const dev = await s.register('taku'), p = await s.register('StaffTarget');
  assert.equal((await s.call('POST', '/api/ops/dev-code', { token: dev.token, body: { code: CODE } })).status, 200);
  const change = (kind, action = 'grant') => s.call('POST', '/api/ops/' + kind, { token: dev.token, body: { name: p.me.name, action, code: CODE } });
  return { s, dev, p, change };
}
function pauseHash(t) {
  const subtle = globalThis.crypto.subtle, original = subtle.deriveBits;
  let release, entered, paused = false;
  const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  subtle.deriveBits = async function (...args) {
    const result = await original.apply(this, args);
    if (!paused) { paused = true; entered(); await gate; }
    return result;
  };
  t.after(() => { subtle.deriveBits = original; release(); });
  return { ready, release };
}

test('a viewer grant cannot leave dormant access on a target promoted during code verification', async t => {
  const { s, p, change } = await fixture(t), gate = pauseHash(t), pending = change('viewer');
  await gate.ready; assert.equal((await change('operator')).status, 200); gate.release();
  assert.equal((await pending).error?.code, 'operator');
  assert.equal(s.app.db.prepare('SELECT granted FROM ops_viewers WHERE user_id=?').get(p.me.id)?.granted || 0, 0);
  assert.equal((await change('operator', 'revoke')).status, 200);
  const relog = await s.call('POST', '/api/login', { body: { name: p.me.name, password: 'pass1234' } });
  assert.equal((await s.call('GET', '/api/ops/me', { token: relog.token })).status, 403);
});

for (const kind of ['operator', 'viewer']) test(`${kind} grants refuse a target deleted while the code is checked`, async t => {
  const { s, p, change } = await fixture(t), gate = pauseHash(t), pending = change(kind);
  await gate.ready; s.setUser(p.me.id, { ban_kind: 'deleted', banned: 1, archived_at: Date.now() }); gate.release();
  assert.equal((await pending).status, 404);
  assert.equal(s.app.db.prepare('SELECT granted FROM ops_access WHERE name_key=?').get(p.me.name.toLowerCase())?.granted || 0, 0);
  assert.equal(s.app.db.prepare('SELECT granted FROM ops_viewers WHERE user_id=?').get(p.me.id)?.granted || 0, 0);
});

test('operator grants reject deleted accounts before any rights are written', async t => {
  const { s, p, change } = await fixture(t); s.setUser(p.me.id, { ban_kind: 'deleted', banned: 1, archived_at: Date.now() });
  assert.equal((await change('operator')).status, 404);
});

test('a target rename and name reuse during verification cannot bind rights to a stale identity', async t => {
  const { s, p, change } = await fixture(t), gate = pauseHash(t), pending = change('operator');
  await gate.ready;
  s.setUser(p.me.id, { name: 'RenamedUser', name_key: 'renameduser' });
  const replacement = await s.register(p.me.name);
  gate.release(); assert.equal((await pending).status, 409);
  assert.equal(s.app.db.prepare('SELECT user_id FROM staff_pins WHERE name_key=?').get(p.me.name.toLowerCase()), undefined);
  assert.equal((await s.call('GET', '/api/ops/me', { token: replacement.token })).status, 403);
});
