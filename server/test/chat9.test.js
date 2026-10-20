// DEV9 in the chat: nothing goes to Ice Smoker公式 or the NPCs; words taken
// back within the hour (money never); 通報 of one message; the automatic
// filter stops what is not text, and the sender's chat with it. (Money, cars
// and items waiting for the tap: api.test.js, features.test.js.) npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const FAST = [100000, 1000];
let s, call, register, befriend, setUser, taku;

before(async () => {
  s = await startServer({ limits: { general: FAST, login: FAST, friend: FAST, transfer: FAST, dm: FAST, read: FAST } });
  ({ call, register, befriend, setUser } = s);
  taku = await register('TAKU');
});
after(() => s.stop());

const ops = (method, url, body) => call(method, url, { token: taku.token, body });

test('nothing goes to Ice Smoker公式 or an NPC', async () => {
  const a = await register('Npc9');
  setUser(a.me.id, { dollars: 100000 });
  const me = await call('GET', '/api/me', { token: a.token });
  for (const npc of [me.official, me.johnson, me.peter]) {
    assert.equal((await call('POST', '/api/transfer', { token: a.token, body: { to: npc.id, amount: 10, currency: 'dollars' } })).error.code, 'npc');
    assert.equal((await call('POST', '/api/items/give', { token: a.token, body: { to: npc.id, id: 'omamori', count: 1 } })).error.code, 'npc');
  }
});

test('words taken back within the hour, by their sender; money never', async () => {
  const a = await register('Undo1'), b = await register('Undo2');
  await befriend(a, b);
  setUser(a.me.id, { dollars: 5000 });
  const m = (await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'まちがえた' } })).message;
  assert.equal((await call('POST', '/api/messages/retract', { token: b.token, body: { message: m.id } })).status, 404);
  assert.ok((await call('POST', '/api/messages/retract', { token: a.token, body: { message: m.id } })).retracted > 0);
  const seen = (await call('GET', `/api/messages?with=${a.me.id}`, { token: b.token })).messages.find((x) => x.id === m.id);
  assert.deepEqual([seen.text, !!seen.retracted], ['', true]);
  // the operators still have the words
  const log = (await ops('GET', '/api/ops/log?kind=player')).entries.find((e) => e.action === 'player_retract');
  assert.equal(log.detail.text, 'まちがえた');
  const t = (await call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 100, currency: 'dollars' } })).message;
  assert.equal((await call('POST', '/api/messages/retract', { token: a.token, body: { message: t.id } })).error.code, 'not_text');
  const old = (await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: '昔の話' } })).message;
  s.app.db.prepare('UPDATE messages SET created_at = created_at - 3600001 WHERE id = ?').run(old.id);
  assert.equal((await call('POST', '/api/messages/retract', { token: a.token, body: { message: old.id } })).error.code, 'too_late');
});

test('通報 of one message: with the conversation around it, once each, 8 a day', async () => {
  const a = await register('Rpt1'), b = await register('Rpt2');
  await befriend(a, b);
  const ids = [];
  for (let i = 0; i < 9; i++) ids.push((await call('POST', '/api/messages', { token: b.token, body: { to: a.me.id, text: 'ひどい言葉' + i } })).message.id);
  const mine = (await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: '自分の' } })).message.id;
  const report = (message, extra = {}) => call('POST', '/api/report/message', { token: a.token, body: { message, kind: 'abuse', ...extra } });
  assert.equal((await report(mine)).status, 404);
  assert.equal((await report(ids[0], { text: 'あ'.repeat(1001) })).status, 413);
  assert.equal((await report(ids[0], { text: 'ひどい' })).status, 200);
  assert.equal((await report(ids[0])).error.code, 'reported');
  for (let i = 1; i < 8; i++) assert.equal((await report(ids[i])).status, 200);
  assert.equal((await report(ids[8])).error.code, 'report_limit');
  const rep = (await ops('GET', '/api/ops/reports')).reports.find((x) => x.messageId === ids[0]);
  assert.equal(rep.context.message.text, 'ひどい言葉0');
  assert.ok(rep.context.around.some((m) => m.reported && m.id === ids[0]));
});

test('the automatic filter: what is not text never arrives; the chat stops until an operator lets it go', async () => {
  const a = await register('Atk1'), b = await register('Atk2');
  await befriend(a, b);
  const r = await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'これ見て', file: 'UEsDBBQ' } });
  assert.deepEqual([r.status, r.error.code], [400, 'filtered']);
  assert.ok(!(await call('GET', `/api/messages?with=${a.me.id}`, { token: b.token })).messages.some((m) => m.text === 'これ見て'));
  const e = (await ops('GET', '/api/ops/log?kind=emergency')).entries.find((x) => x.action === 'filter_block');
  assert.equal(e.detail.reason, 'extra_field');
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'ふつうの文' } })).error.code, 'chat_banned');
  const me = await call('GET', '/api/me', { token: a.token });
  assert.ok(me.me.chatBan);
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: me.official.id, text: '解除してください' } })).status, 200);
  assert.ok((await ops('GET', '/api/ops/players')).players.find((p) => p.id === a.me.id).chatBan);
  await ops('POST', '/api/ops/chat-ban', { id: a.me.id });
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'もう一度' } })).status, 200);
});
