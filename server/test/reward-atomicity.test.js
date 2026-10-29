import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES } from '../core/rules.js';

async function fixture(t, config = {}) {
  const s = await startServer({ operators: ['taku'], ...config }); t.after(() => s.stop());
  t.mock.method(console, 'error', () => {});
  const op = await s.register('taku'), p = await s.register('AtomicReward');
  return { s, op, p };
}
function failMessages(s, where = "NEW.kind='transfer'") {
  s.app.db.exec(`CREATE TRIGGER fail_reward BEFORE INSERT ON messages WHEN ${where} BEGIN SELECT RAISE(ABORT,'simulated reward storage failure'); END`);
  return () => s.app.db.exec('DROP TRIGGER fail_reward');
}
const transfers = (s, id) => s.app.db.prepare("SELECT * FROM messages WHERE recipient_id=? AND kind='transfer' AND pending=1").all(id);

test('access-day rewards remain retryable when their payment card cannot be saved', async t => {
  const { s, p } = await fixture(t); s.setUser(p.me.id, { login_days: 5, days_paid: 0 });
  const repair = failMessages(s); s.app.api.hello(p.me.id);
  assert.equal(s.app.db.prepare('SELECT days_paid FROM users WHERE id=?').get(p.me.id).days_paid, 0);
  assert.equal(transfers(s, p.me.id).length, 0); repair();
  s.app.api.hello(p.me.id); s.app.api.hello(p.me.id);
  assert.equal(transfers(s, p.me.id).length, 1); assert.equal(transfers(s, p.me.id)[0].amount, RULES.accessDays.amount);
});

for (const failText of [false, true]) test(`report acceptance and its reward roll back if ${failText ? 'the thanks' : 'the payment card'} cannot be saved`, async t => {
  const { s, op, p } = await fixture(t), target = await s.register('ReportTarget');
  const sent = await s.call('POST', '/api/report', { token: p.token, body: { user: target.me.id, kind: 'other', text: 'please review' } }); assert.equal(sent.status, 200);
  const row = s.app.db.prepare('SELECT id FROM reports WHERE reporter_id=?').get(p.me.id);
  const priorCards = transfers(s, p.me.id).length;
  const originalSend = s.app.live.send, events = [];
  s.app.live.send = function (...args) { events.push(args); return originalSend.apply(this, args); };
  const repair = failMessages(s, failText ? "NEW.kind='text'" : "NEW.kind='transfer'");
  const body = { id: row.id, action: 'accept', reward: 600000 };
  assert.equal((await s.call('POST', '/api/ops/report', { token: op.token, body })).status, 500);
  assert.equal(s.app.db.prepare('SELECT status FROM reports WHERE id=?').get(row.id).status, 'open');
  assert.equal(transfers(s, p.me.id).length, priorCards);
  assert.equal(events.some(([id, event, data]) => id === p.me.id && event === 'msg' && data.kind === 'transfer'), false);
  repair(); assert.equal((await s.call('POST', '/api/ops/report', { token: op.token, body })).status, 200);
  assert.equal((await s.call('POST', '/api/ops/report', { token: op.token, body })).status, 409);
  assert.equal(transfers(s, p.me.id).length, priorCards + 1);
});

test('an idea reward does not become adopted before its payment is durable', async t => {
  const { s, op, p } = await fixture(t);
  s.app.db.prepare("INSERT INTO feedback(user_id,ratings,comment,kind,created_at) VALUES(?,'{}','idea','idea',?)").run(p.me.id, Date.now());
  const row = s.app.db.prepare('SELECT id FROM feedback WHERE user_id=?').get(p.me.id);
  const repair = failMessages(s), body = { id: row.id };
  assert.equal((await s.call('POST', '/api/ops/feedback/adopt', { token: op.token, body })).status, 500);
  assert.equal(s.app.db.prepare('SELECT adopted_at FROM feedback WHERE id=?').get(row.id).adopted_at, 0);
  repair(); assert.equal((await s.call('POST', '/api/ops/feedback/adopt', { token: op.token, body })).status, 200);
  assert.equal((await s.call('POST', '/api/ops/feedback/adopt', { token: op.token, body })).status, 409);
  assert.equal(transfers(s, p.me.id).length, 1); assert.equal(transfers(s, p.me.id)[0].currency, 'tokens');
});

test('a failed registration-milestone broadcast cannot fail signup or leave a partial permanent payout', async t => {
  const { s } = await fixture(t, { milestones: true });
  const players = [];
  for (let i = 0; i < 7; i++) players.push(await s.register('Milestone' + i));
  const repair = failMessages(s, `NEW.kind='transfer' AND NEW.recipient_id=${players[0].me.id}`);
  const last = await s.call('POST', '/api/register', { body: { name: 'MileLast', password: 'pass1234', avatar: 'traveler-green' } });
  assert.equal(last.status, 200); assert.ok(last.token);
  assert.equal(s.app.db.prepare("SELECT value FROM meta WHERE key='milestone_10'").get(), undefined);
  assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE kind='transfer' AND amount=?").get(RULES.milestones[0].dollars).n, 0);
  repair(); await s.app.api.housekeeping(); await s.app.api.housekeeping();
  assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE kind='transfer' AND amount=?").get(RULES.milestones[0].dollars).n, 10);
});

test('a failed keyed spin cannot publish a win or balance that the database rolled back', async t => {
  const { s, p } = await fixture(t, { startTokens: 10000 });
  const watcher = await s.register('ReceiptWatch'); await s.befriend(p, watcher);
  assert.equal((await s.call('POST', '/api/watch', { token: watcher.token, body: { user: p.me.id, on: true } })).status, 200);
  const events = [], originalSend = s.app.live.send;
  s.app.live.send = function (...args) { events.push(args); return originalSend.apply(this, args); };
  const before = s.app.db.prepare('SELECT tokens,spins,rev FROM users WHERE id=?').get(p.me.id);
  s.app.db.exec("CREATE TRIGGER fail_spin_receipt BEFORE INSERT ON spin_requests BEGIN SELECT RAISE(ABORT,'simulated receipt failure'); END");
  const body = { key: Date.now() + '-' + 'a'.repeat(32), bet: 100 };
  assert.equal((await s.call('POST', '/api/spin', { token: p.token, body })).status, 500);
  assert.deepEqual(s.app.db.prepare('SELECT tokens,spins,rev FROM users WHERE id=?').get(p.me.id), before);
  assert.equal(events.some(([, event]) => ['watch', 'balance', 'quest', 'msg'].includes(event)), false);
  s.app.db.exec('DROP TRIGGER fail_spin_receipt');
  assert.equal((await s.call('POST', '/api/spin', { token: p.token, body })).status, 200);
  assert.equal(s.app.db.prepare('SELECT spins FROM users WHERE id=?').get(p.me.id).spins, 1);
});

test('a failed report submission cannot occupy a report slot without its promised reward', async t => {
  const { s, p } = await fixture(t), target = await s.register('ReportRetry'), repair = failMessages(s);
  const body = { user: target.me.id, kind: 'other', text: 'please review' };
  assert.equal((await s.call('POST', '/api/report', { token: p.token, body })).status, 500);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id=?').get(p.me.id).n, 0);
  repair(); assert.equal((await s.call('POST', '/api/report', { token: p.token, body })).status, 200);
  assert.equal(transfers(s, p.me.id).length, 1);
});

test('a failed keyed gacha publishes no rolled-back reward and can retry once', async t => {
  const { s, p } = await fixture(t, { startDollars: 100000000 });
  const events = [], originalSend = s.app.live.send;
  s.app.live.send = function (...args) { events.push(args); return originalSend.apply(this, args); };
  const snapshot = () => ({
    wallet: s.app.db.prepare('SELECT dollars,tokens,coins,garage_extra,quests,rev FROM users WHERE id=?').get(p.me.id),
    cars: s.app.db.prepare('SELECT * FROM cars WHERE owner_id=?').all(p.me.id),
    items: s.app.db.prepare('SELECT * FROM items WHERE user_id=?').all(p.me.id),
    trees: s.app.db.prepare('SELECT * FROM trees WHERE user_id=?').all(p.me.id)
  });
  const before = snapshot(), body = { key: Date.now() + '-' + 'b'.repeat(32), kind: 'rare', count: 1 };
  s.app.db.exec("CREATE TRIGGER fail_gacha_receipt BEFORE INSERT ON gacha_requests BEGIN SELECT RAISE(ABORT,'simulated receipt failure'); END");
  assert.equal((await s.call('POST', '/api/gacha/spin', { token: p.token, body })).status, 500);
  assert.deepEqual(snapshot(), before); assert.equal(events.some(([, event]) => event === 'balance'), false);
  s.app.db.exec('DROP TRIGGER fail_gacha_receipt');
  const first = await s.call('POST', '/api/gacha/spin', { token: p.token, body }), after = snapshot();
  assert.equal(first.status, 200); const again = await s.call('POST', '/api/gacha/spin', { token: p.token, body });
  assert.equal(again.status, 200); assert.deepEqual(again.pulls, first.pulls); assert.deepEqual(snapshot(), after);
});

test('a failed first announcement retries on the next request without a permanent sent marker', async t => {
  const s = await startServer({}, { warm: false }); t.after(() => s.stop()); t.mock.method(console, 'error', () => {});
  const repair = failMessages(s, "NEW.kind='text'"); const p = await s.register('NoticeRetry');
  const marker = 'voice_all_' + RULES.vip.voiceAll;
  assert.equal(s.app.db.prepare('SELECT value FROM meta WHERE key=?').get(marker), undefined);
  repair(); await s.call('GET', '/api/health'); await s.call('GET', '/api/health');
  assert.ok(s.app.db.prepare('SELECT value FROM meta WHERE key=?').get(marker));
  assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE recipient_id=? AND body LIKE '%通話品質アップのお知らせ%'").get(p.me.id).n, 1);
});

test('a registration audit failure cannot leave an account whose login was never returned', async t => {
  const { s } = await fixture(t);
  s.app.db.exec("CREATE TRIGGER fail_register_log BEFORE INSERT ON ops_log WHEN NEW.action='player_register' BEGIN SELECT RAISE(ABORT,'simulated audit storage failure'); END");
  const body = { name: 'SignupRetry', password: 'pass1234', avatar: 'traveler-green' };
  assert.equal((await s.call('POST', '/api/register', { body })).status, 500);
  assert.equal(s.app.db.prepare('SELECT id FROM users WHERE name_key=?').get('signupretry'), undefined);
  s.app.db.exec('DROP TRIGGER fail_register_log');
  const retry = await s.call('POST', '/api/register', { body }); assert.equal(retry.status, 200); assert.ok(retry.token);
  assert.equal((await s.call('GET', '/api/me', { token: retry.token })).status, 200);
});
