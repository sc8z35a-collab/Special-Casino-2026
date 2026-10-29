import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES } from '../core/rules.js';

async function fixture(t) {
  const s = await startServer({ limits: { dm: [100000, 1000] } }); t.after(() => s.stop());
  t.mock.method(console, 'error', () => {});
  const a = await s.register('ChatAtomic'), b = await s.register('ReadAtomic'); await s.befriend(a, b);
  const q = sql => s.app.db.prepare(sql), events = [], send = s.app.live.send;
  t.mock.method(s.app.live, 'send', function (...args) { events.push(args); return send.apply(this, args); });
  const fail = (table, when = '1') => {
    s.app.db.exec(`CREATE TRIGGER fail_chat_write BEFORE INSERT ON ${table} WHEN ${when} BEGIN SELECT RAISE(ABORT,'simulated chat storage failure'); END`);
    return () => s.app.db.exec('DROP TRIGGER fail_chat_write');
  };
  const chatState = () => ({ messages: q('SELECT * FROM messages').all(), conversations: q('SELECT * FROM conversations').all(),
    groups: q('SELECT * FROM chat_groups').all(), members: q('SELECT * FROM chat_members').all(),
    seats: q('SELECT id,coop_group FROM users').all(), detections: q('SELECT * FROM detections').all() });
  return { s, a, b, q, events, fail, chatState };
}

test('group creation rolls back its members and notifications if the first system message cannot be saved', async t => {
  const { s, a, b, q, events, fail, chatState } = await fixture(t), before = chatState();
  const repair = fail('messages', "NEW.kind='system'"), body = { name: 'Atomic group', members: [b.me.id] };
  assert.equal((await s.call('POST', '/api/groups', { token: a.token, body })).status, 500);
  assert.deepEqual(chatState(), before); assert.equal(events.length, 0);
  repair(); const r = await s.call('POST', '/api/groups', { token: a.token, body }); assert.equal(r.status, 200);
  assert.equal(q('SELECT COUNT(*) AS n FROM chat_groups').get().n, 1);
  assert.equal(r.group.members.length, 2); assert.match(r.group.last.text, /グループ/);
});

test('a failed group-leave announcement preserves membership and the cooperative seat until a successful retry', async t => {
  const { s, a, b, q, events, fail, chatState } = await fixture(t);
  const g = (await s.call('POST', '/api/groups', { token: a.token, body: { name: 'Leave group', members: [b.me.id] } })).group;
  assert.equal((await s.call('POST', '/api/coop', { token: a.token, body: { group: g.id, on: true } })).status, 200);
  events.length = 0; const before = chatState(), repair = fail('messages', "NEW.kind='system'"), body = { group: g.id };
  assert.equal((await s.call('POST', '/api/groups/leave', { token: a.token, body })).status, 500);
  assert.deepEqual(chatState(), before); assert.equal(events.length, 0);
  repair(); assert.equal((await s.call('POST', '/api/groups/leave', { token: a.token, body })).status, 200);
  assert.equal(q('SELECT coop_group FROM users WHERE id=?').get(a.me.id).coop_group, 0);
  assert.equal(q('SELECT COUNT(*) AS n FROM chat_members WHERE group_id=?').get(g.id).n, 1);
  assert.equal(q("SELECT COUNT(*) AS n FROM messages WHERE body LIKE '%グループを抜けました'").get().n, 1);
});

for (const group of [false, true]) test(`${group ? 'group' : 'direct'} filtered messages and unread state cannot commit without their moderation evidence`, async t => {
  const { s, a, b, events, fail, chatState } = await fixture(t);
  const target = group ? { group: (await s.call('POST', '/api/groups', { token: a.token, body: { name: 'Moderated', members: [b.me.id] } })).group.id } : { to: b.me.id };
  events.length = 0; const before = chatState(), repair = fail('detections'), body = { ...target, text: '消えろ' };
  assert.equal((await s.call('POST', '/api/messages', { token: a.token, body })).status, 500);
  assert.deepEqual(chatState(), before); assert.equal(events.length, 0);
  repair(); const r = await s.call('POST', '/api/messages', { token: a.token, body }); assert.equal(r.status, 200);
  assert.equal(r.message.text, '***'); assert.equal(chatState().detections.length, 1);
  assert.equal(chatState().messages.length, before.messages.length + 1);
});

for (const npc of ['peter', 'johnson']) test(`${npc} chat keeps the player's message and NPC answer together on a reply-write failure`, async t => {
  const { s, a, q, events, fail, chatState } = await fixture(t);
  const bot = q('SELECT id FROM users WHERE npc=?').get(npc).id, before = chatState();
  const repair = fail('messages', `NEW.sender_id=${bot}`), body = { to: bot, text: 'こんにちは' };
  assert.equal((await s.call('POST', '/api/messages', { token: a.token, body })).status, 500);
  assert.deepEqual(chatState(), before); assert.equal(events.length, 0);
  repair(); assert.equal((await s.call('POST', '/api/messages', { token: a.token, body })).status, 200);
  assert.equal(chatState().messages.length, before.messages.length + 2);
});

test('a failed NPC loan reply cannot leave a player message, partial debt, balance or live notification behind', async t => {
  const { s, a, q, events, fail, chatState } = await fixture(t), bot = q("SELECT id FROM users WHERE npc='peter'").get().id;
  const before = chatState(), wallet = q('SELECT dollars,rev FROM users WHERE id=?').get(a.me.id), repair = fail('messages', `NEW.sender_id=${bot}`);
  const body = { to: bot, text: '100万貸して' };
  assert.equal((await s.call('POST', '/api/messages', { token: a.token, body })).status, 500);
  assert.deepEqual(chatState(), before); assert.deepEqual(q('SELECT dollars,rev FROM users WHERE id=?').get(a.me.id), wallet);
  assert.equal(q('SELECT * FROM debts WHERE user_id=?').get(a.me.id), undefined); assert.equal(events.length, 0);
  repair(); assert.equal((await s.call('POST', '/api/messages', { token: a.token, body })).status, 200);
  assert.equal(q('SELECT dollars FROM users WHERE id=?').get(a.me.id).dollars, wallet.dollars + 1000000);
  assert.equal(q('SELECT lent FROM debts WHERE user_id=?').get(a.me.id).lent, 1000000);
  assert.equal(chatState().messages.length, before.messages.length + 3);
});

test('a failed retraction audit leaves the visible message and live conversation unchanged', async t => {
  const { s, a, b, q, events, fail, chatState } = await fixture(t);
  const sent = await s.call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'retract atomically' } });
  events.length = 0; const before = chatState(), repair = fail('ops_log', "NEW.action='player_retract'"), body = { message: sent.message.id };
  assert.equal((await s.call('POST', '/api/messages/retract', { token: a.token, body })).status, 500);
  assert.deepEqual(chatState(), before); assert.equal(events.length, 0);
  repair(); assert.equal((await s.call('POST', '/api/messages/retract', { token: a.token, body })).status, 200);
  assert.ok(q('SELECT retracted_at FROM messages WHERE id=?').get(sent.message.id).retracted_at > 0);
  assert.equal(events.filter(([, name]) => name === 'retract').length, 2);
});

test('a failed message-report audit cannot consume the reporting quota or make a retry look duplicated', async t => {
  const { s, a, b, q, fail } = await fixture(t);
  const sent = await s.call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'message for reporting' } });
  const repair = fail('ops_log', "NEW.action='player_report'"), body = { message: sent.message.id, kind: RULES.reportKinds[0].id, text: 'Please inspect' };
  assert.equal((await s.call('POST', '/api/report/message', { token: b.token, body })).status, 500);
  assert.equal(q('SELECT COUNT(*) AS n FROM reports WHERE reporter_id=?').get(b.me.id).n, 0);
  repair(); assert.equal((await s.call('POST', '/api/report/message', { token: b.token, body })).status, 200);
  assert.equal(q('SELECT COUNT(*) AS n FROM reports WHERE reporter_id=?').get(b.me.id).n, 1);
});
