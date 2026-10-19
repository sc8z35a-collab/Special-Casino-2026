// ジョンソン, a friend NPC (server/core/johnson.js): money for the 金の生る木
// every 2 days, one rescue when the player is nearly broke, kind answers; and
// the lender's new name, マイクソン. npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES } from '../core/rules.js';

const J = RULES.johnson;
let s, call, register, setUser;

before(async () => {
  s = await startServer({ npcGifts: true, limits: { spin: [100000, 1000], shop: [100000, 1000], general: [100000, 1000], login: [100000, 1000], friend: [100000, 1000], transfer: [100000, 1000], dm: [100000, 1000] } });
  ({ call, register, setUser } = s);
});
after(() => s.stop());

const db = () => s.app.db;
const dollars = (id) => db().prepare('SELECT dollars FROM users WHERE id = ?').get(id).dollars;
async function chatWith(token, id) { return (await call('GET', `/api/messages?with=${id}`, { token })).messages; }

test('ジョンソン: a friend from the start; his first gift comes when the player first comes by', async () => {
  const a = await register('Jfriend1');
  const me = await call('GET', '/api/me', { token: a.token });
  assert.equal(me.johnson.name, 'ジョンソン');
  assert.equal(me.peter.name, 'マイクソン');
  const jid = me.johnson.id;
  // an NPC: no friend requests, no blocking, always online, no player may take the names
  assert.equal((await call('POST', '/api/friends/request', { token: a.token, body: { user: jid } })).error.code, 'npc');
  assert.equal((await call('GET', `/api/user?id=${jid}`, { token: a.token })).user.online, true);
  for (const name of ['ジョンソン', 'マイクソン', 'ピーター', 'Johnson']) {
    assert.equal((await call('POST', '/api/register', { body: { name, password: 'pass1234' } })).error.code, 'name_taken', name);
  }

  const before = dollars(a.me.id);
  const r = await call('GET', '/api/johnson', { token: a.token });
  assert.equal(r.status, 200);
  assert.equal(r.gifts, 1);
  const got = dollars(a.me.id) - before;
  assert.ok(got >= J.gift[0] && got <= J.gift[1] && got % 1000 === 0, String(got));
  assert.equal(r.given, got);
  assert.ok(Math.abs(r.next - (Date.now() + J.every)) < 5000);
  // his words and the money, in his chat (the money like a friend's transfer)
  const list = await chatWith(a.token, jid);
  assert.equal(list.length, 2);
  assert.equal(list[0].kind, 'text');
  assert.match(list[0].text, /ジョンソン/);
  assert.equal(list[1].kind, 'transfer');
  assert.equal(list[1].amount, got);
  assert.equal(list[1].currency, 'dollars');

  // nothing more until two days have passed
  await call('GET', '/api/johnson', { token: a.token });
  assert.equal(dollars(a.me.id), before + got);
  db().prepare("UPDATE npc_friends SET gift_at = gift_at - ? WHERE user_id = ? AND npc = 'johnson'").run(J.every, a.me.id);
  const r2 = await call('GET', '/api/johnson', { token: a.token });
  assert.equal(r2.gifts, 2);
  const got2 = dollars(a.me.id) - before - got;
  assert.ok(got2 >= J.gift[0] && got2 <= J.gift[1], String(got2));
  assert.equal((await chatWith(a.token, jid)).length, 4);
});

test('ジョンソン: once ever, he helps a player whose money (tokens counted) falls under the line', async () => {
  const a = await register('Jbroke1');
  await call('GET', '/api/johnson', { token: a.token });       // the first gift
  const jid = (await call('GET', '/api/me', { token: a.token })).johnson.id;
  // tokens count at their price: over the line, nothing
  setUser(a.me.id, { dollars: 0, tokens: J.rescueBelow / RULES.tokenPrice + 100 });
  await call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
  let st = await call('GET', '/api/johnson', { token: a.token });
  assert.equal(st.rescued, false);
  // under it: the rescue (and only one)
  setUser(a.me.id, { dollars: 1000, tokens: 200 });
  await call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
  st = await call('GET', '/api/johnson', { token: a.token });
  assert.equal(st.rescued, true);
  assert.ok(dollars(a.me.id) >= J.rescue, String(dollars(a.me.id)));
  const list = await chatWith(a.token, jid);
  const rescue = list.filter((m) => m.kind === 'transfer' && m.amount === J.rescue);
  assert.equal(rescue.length, 1);
  assert.match(list[list.indexOf(rescue[0]) - 1].text, /一度きり/);
  setUser(a.me.id, { dollars: 0, tokens: 100 });
  await call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
  await call('GET', '/api/johnson', { token: a.token });
  assert.equal((await chatWith(a.token, jid)).filter((m) => m.kind === 'transfer' && m.amount === J.rescue).length, 1);
});

test('ジョンソン: answers what is written to him; nothing is ever asked back', async () => {
  const a = await register('Jtalk1');
  const jid = (await call('GET', '/api/me', { token: a.token })).johnson.id;
  const r = await call('POST', '/api/messages', { token: a.token, body: { to: jid, text: 'ありがとう！' } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.message.text, 'ありがとう！');
  assert.ok(r.reply && r.reply.text, JSON.stringify(r));
  assert.ok(/友達|どういたしまして/.test(r.reply.text), r.reply.text);
  const r2 = await call('POST', '/api/messages', { token: a.token, body: { to: jid, text: '木の育て方を教えて' } });
  assert.match(r2.reply.text, /木|収穫|オークション/);
  // a transfer to him is refused (he is no friend to pay)
  const t = await call('POST', '/api/transfer', { token: a.token, body: { to: jid, amount: 100, currency: 'dollars' } });
  assert.notEqual(t.status, 200);
});
