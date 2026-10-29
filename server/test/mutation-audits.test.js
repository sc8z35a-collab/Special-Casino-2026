import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
async function fixture(t) {
  const s = await startServer({ operators: ['taku'], startTokens: 10000 }); t.after(() => s.stop());
  t.mock.method(console, 'error', () => {});
  const op = await s.register('taku'), a = await s.register('AuditSender'), b = await s.register('AuditRecv'); await s.befriend(a, b);
  return { s, op, a, b };
}
function failAudit(s, action) {
  s.app.db.exec(`CREATE TRIGGER fail_mutation_audit BEFORE INSERT ON ops_log WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END`);
  return () => s.app.db.exec('DROP TRIGGER fail_mutation_audit');
}
for (const staff of [false, true]) for (const password of [false, true]) test(`${staff ? 'operator' : 'player'} ${password ? 'password' : 'recovery'} changes preserve credentials on audit failure`, async t => {
  const { s, op, a } = await fixture(t);
  const action = (staff ? '' : 'player_') + (password ? 'password' : 'recovery');
  const path = '/api/' + (staff ? 'ops/' : '') + (password ? 'password' : 'recovery');
  const body = password ? { id: a.me.id, current: PASSWORD, password: 'new-audited-pass' } : { id: a.me.id };
  const fields = () => s.app.db.prepare('SELECT password_hash,recovery_hash,recovery_enc FROM users WHERE id=?').get(a.me.id);
  const before = fields(), repair = failAudit(s, action);
  assert.equal((await s.call('POST', path, { token: staff ? op.token : a.token, body })).status, 500);
  assert.deepEqual(fields(), before);
  assert.equal((await s.call('GET', '/api/me', { token: a.token })).status, 200);
  assert.equal((await s.call('POST', '/api/login', { body: { code: a.recoveryCode } })).status, 200);
  repair(); const retry = await s.call('POST', path, { token: staff ? op.token : a.token, body }); assert.equal(retry.status, 200);
  if (password) {
    assert.equal((await s.call('GET', '/api/me', { token: a.token })).status, 401);
    assert.equal((await s.call('POST', '/api/login', { body: { name: a.me.name, password: body.password } })).status, 200);
  } else assert.equal((await s.call('POST', '/api/login', { body: { code: retry.code || retry.recoveryCode } })).status, 200);
});

for (const currency of ['tokens', 'dollars']) test(`a failed ${currency} transfer audit cannot debit the sender or publish a card`, async t => {
  const { s, a, b } = await fixture(t), repair = failAudit(s, 'player_transfer');
  const money = () => s.app.db.prepare('SELECT dollars,tokens,rev FROM users WHERE id=?').get(a.me.id), before = money();
  const events = [], send = s.app.live.send;
  t.mock.method(s.app.live, 'send', function (...args) { events.push(args); return send.apply(this, args); });
  const body = { to: b.me.id, currency, amount: 1000 };
  assert.equal((await s.call('POST', '/api/transfer', { token: a.token, body })).status, 500);
  assert.deepEqual(money(), before); assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE sender_id=? AND kind='transfer'").get(a.me.id).n, 0);
  assert.equal(events.some(([, name]) => ['balance', 'msg'].includes(name)), false);
  repair(); assert.equal((await s.call('POST', '/api/transfer', { token: a.token, body })).status, 200);
  assert.equal(money()[currency], before[currency] - 1000);
});

for (const kind of ['transfer', 'item', 'gift']) test(`a failed ${kind} claim audit preserves the unclaimed card and its asset`, async t => {
  const { s, a, b } = await fixture(t); let sent, carId;
  if (kind === 'transfer') sent = await s.call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, currency: 'dollars', amount: 1000 } });
  else if (kind === 'item') {
    s.app.db.prepare("INSERT INTO items(user_id,item,count) VALUES(?,'repair-kit',2)").run(a.me.id);
    sent = await s.call('POST', '/api/items/give', { token: a.token, body: { to: b.me.id, id: 'repair-kit', count: 1 } });
  } else {
    carId = Number(s.app.db.prepare("INSERT INTO cars(owner_id,model,from_id,created_at,acquired_at,paid) VALUES(?,'two-state-sedan',0,?,?,0)").run(a.me.id, Date.now(), Date.now()).lastInsertRowid);
    sent = await s.call('POST', '/api/cars/gift', { token: a.token, body: { to: b.me.id, car: carId } });
  }
  assert.equal(sent.status, 200); const id = sent.message.id, repair = failAudit(s, 'player_claim');
  const snapshot = () => ({ user: s.app.db.prepare('SELECT dollars,tokens,rev FROM users WHERE id=?').get(b.me.id),
    items: s.app.db.prepare('SELECT * FROM items WHERE user_id=?').all(b.me.id),
    cars: s.app.db.prepare('SELECT * FROM cars WHERE owner_id=?').all(b.me.id) });
  const before = snapshot(), body = { message: id };
  assert.equal((await s.call('POST', '/api/messages/claim', { token: b.token, body })).status, 500);
  assert.deepEqual(snapshot(), before); assert.equal(s.app.db.prepare('SELECT claimed_at FROM messages WHERE id=?').get(id).claimed_at, 0);
  repair(); assert.equal((await s.call('POST', '/api/messages/claim', { token: b.token, body })).status, 200);
  assert.equal((await s.call('POST', '/api/messages/claim', { token: b.token, body })).status, 409);
});
