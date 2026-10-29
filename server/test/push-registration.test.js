import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPush } from '../core/push.js';
import { startServer } from './helpers.js';

const subscription = (n = 0) => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/test-device-' + n,
  p256dh: crypto.createECDH('prime256v1').generateKeys().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') });
async function fixture(t) {
  const s = await startServer(); t.after(() => s.stop()); const a = await s.register('PushOwner'), b = await s.register('PushNext');
  const q = sql => s.app.db.prepare(sql), meta = { get: k => q('SELECT value FROM meta WHERE key=?').get(k)?.value,
    set: (k,v) => q('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)').run(k,v) };
  const make = send => createPush({ q, meta, send });
  const seed = (id, sub, at) => q('INSERT INTO push_subs(endpoint,user_id,p256dh,auth,created_at) VALUES(?,?,?,?,?)').run(sub.endpoint, id, sub.p256dh, sub.auth, at);
  const register = (p, sub) => s.call('POST', '/api/push/subscribe', { token: p.token, body: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } } });
  return { s, a, b, q, make, seed, register };
}

for (const transfer of [false, true]) test(`${transfer ? 'moving' : 'refreshing'} an old notification endpoint keeps the currently active phone within the eight-device limit`, async t => {
  const { a, b, q, seed, register } = await fixture(t), active = subscription(), recipient = transfer ? b : a;
  seed(a.me.id, active, 1);
  for (let i=1; i<=(transfer ? 8 : 7); i++) seed(recipient.me.id, subscription(i), i+1);
  assert.equal((await register(recipient, active)).status, 200);
  if (!transfer) assert.equal((await register(recipient, subscription(9))).status, 200);
  const row = q('SELECT * FROM push_subs WHERE endpoint=?').get(active.endpoint);
  assert.ok(row, 'the phone that just registered must remain subscribed'); assert.equal(row.user_id, recipient.me.id);
  assert.equal(q('SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?').get(recipient.me.id).n, 8);
  if (transfer) assert.equal(q('SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?').get(a.me.id).n, 0);
});

test('a failed device-cap cleanup rolls back subscription ownership and leaves the original device set intact', async t => {
  const { s, a, b, q, seed, register } = await fixture(t), active = subscription(); t.mock.method(console, 'error', () => {});
  seed(a.me.id, active, 1); for (let i=1; i<=8; i++) seed(b.me.id, subscription(i), i+1);
  const before = q('SELECT * FROM push_subs ORDER BY endpoint').all();
  s.app.db.exec("CREATE TRIGGER fail_push_cleanup BEFORE DELETE ON push_subs BEGIN SELECT RAISE(ABORT,'simulated push cleanup failure'); END");
  assert.equal((await register(b, active)).status, 500); assert.deepEqual(q('SELECT * FROM push_subs ORDER BY endpoint').all(), before);
  s.app.db.exec('DROP TRIGGER fail_push_cleanup'); assert.equal((await register(b, active)).status, 200);
  assert.equal(q('SELECT user_id FROM push_subs WHERE endpoint=?').get(active.endpoint).user_id, b.me.id);
  assert.equal(q('SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?').get(b.me.id).n, 8);
});

for (const status of [404, 410]) for (const reassigned of [false, true]) test(`a delayed push-service ${status} cannot delete a ${reassigned ? 'reassigned' : 'same-tick refreshed'} endpoint`, async t => {
  const { a, b, q, make, seed } = await fixture(t), sub = subscription(), at = Date.now(); seed(a.me.id, sub, at);
  if (!reassigned) t.mock.method(Date, 'now', () => at);
  let started, finish; const ready = new Promise(resolve => { started = resolve; });
  const push = make(() => { started(); return new Promise(resolve => { finish = () => resolve({ status }); }); });
  const sending = push.notify(a.me.id, { title: 'old owner', body: 'old key', tag: 'test' });
  await ready;
  const replacement = reassigned ? { ...sub, auth: crypto.randomBytes(16).toString('base64url') } : sub;
  push.subscribe(reassigned ? b.me.id : a.me.id, replacement, '');
  const current = q('SELECT * FROM push_subs WHERE endpoint=?').get(sub.endpoint); finish(); await sending;
  assert.deepEqual(q('SELECT * FROM push_subs WHERE endpoint=?').get(sub.endpoint), current);
});

for (const status of [410, 503]) test(`a current push-service ${status} ${status === 410 ? 'removes only the expired' : 'retains the temporary-failure'} subscription`, async t => {
  const { a, q, make, seed } = await fixture(t), sub = subscription(); seed(a.me.id, sub, 1);
  await make(async () => ({ status })).notify(a.me.id, { title: 'current', body: 'test', tag: 'test' });
  assert.equal(!!q('SELECT * FROM push_subs WHERE endpoint=?').get(sub.endpoint), status !== 410);
});

test('concurrent notification-key requests and a new instance reuse the first persisted VAPID key', async t => {
  const { make } = await fixture(t), push = make();
  const keys = await Promise.all(Array.from({ length: 8 }, () => push.publicKey()));
  assert.equal(new Set(keys).size, 1); assert.equal(await make().publicKey(), keys[0]);
});
