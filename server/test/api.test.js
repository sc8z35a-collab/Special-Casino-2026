// API tests: npm test (from the repository root)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
import { evaluate, RULES, AVATARS, iconSale, utcDay } from '../core/rules.js';

let s, call, register, setUser, befriend, listen;

before(async () => {
  s = await startServer();
  ({ call, register, setUser, befriend, listen } = s);
});

after(() => s.stop());

test('health is public', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.ok, true);
});

test('registration validates names, passwords and icons', async () => {
  for (const [name, code] of [['a', 'name_length'], ['あいうえおかきくけこさしす', 'name_length'], ['bad name', 'name_chars'],
    ['<script>', 'name_chars'], ['😀😀', 'name_chars'], ['___', 'name_chars'], ['Admin', 'name_reserved'], ['運営さん', 'name_reserved']]) {
    const r = await call('POST', '/api/register', { body: { name, password: PASSWORD } });
    assert.equal(r.status, 400, name);
    assert.equal(r.error.code, code, name);
  }
  assert.equal((await call('POST', '/api/register', { body: { name: 'NoPass' } })).error.code, 'password_short');
  assert.equal((await call('POST', '/api/register', { body: { name: 'NoPass', password: 'abc' } })).error.code, 'password_short');
  assert.equal((await call('POST', '/api/register', { body: { name: 'NoPass', password: 'x'.repeat(65) } })).error.code, 'password_long');
  assert.equal((await call('POST', '/api/register', { body: { name: 'NoPass', password: PASSWORD, avatar: 'ghost' } })).error.code, 'bad_avatar');
  // paid icons are chained at sign-up
  for (const a of [...AVATARS.values()].filter((x) => x.price > 0)) {
    const r = await call('POST', '/api/register', { body: { name: 'Chained', password: PASSWORD, avatar: a.id } });
    assert.equal(r.status, 403, a.id);
    assert.equal(r.error.code, 'locked', a.id);
  }
  for (const id of ['bald', 'beard', 'curly', 'blond', 'witch']) {
    assert.equal(AVATARS.get(id).price, 0, `${id} is free from the start`);
  }
  const ok = await register('Taro_01', { avatar: 'witch' });
  assert.match(ok.recoveryCode, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  assert.equal(ok.me.name, 'Taro_01');
  assert.equal(ok.me.avatar, 'witch');
  assert.equal(ok.me.hasPassword, true);
  assert.equal(ok.me.tokens, RULES.start.tokens);
  assert.equal(ok.me.dollars, RULES.start.dollars);
});

test('names are unique: case, width and look-alike forms count as the same name', async () => {
  await register('Hanako');
  for (const name of ['hanako', 'HANAKO', 'Ｈａｎａｋｏ', ' Hanako ']) {
    const r = await call('POST', '/api/register', { body: { name, password: PASSWORD } });
    assert.equal(r.status, 409, name);
    assert.equal(r.error.code, 'name_taken', name);
  }
  let r = await call('GET', '/api/name-check?name=hanako');
  assert.deepEqual([r.available, typeof r.problem], [false, 'string']);
  r = await call('GET', '/api/name-check?name=Hanako2');
  assert.deepEqual([r.available, r.problem], [true, null]);
  r = await call('GET', '/api/name-check?name=a');
  assert.equal(r.available, false);
});

test('login: name + password, recovery code, new code, password change, logout', async () => {
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/me', { token: 'x'.repeat(43) })).status, 401);
  const u = await register('LoginUser');
  const me = await call('GET', '/api/me', { token: u.token });
  assert.equal(me.status, 200);
  assert.equal(me.me.id, u.me.id);
  // name + password, name in any case or width
  let login = await call('POST', '/api/login', { body: { name: 'ｌｏｇｉｎｕｓｅｒ', password: PASSWORD } });
  assert.equal(login.status, 200);
  assert.equal(login.me.id, u.me.id);
  assert.notEqual(login.token, u.token);
  assert.equal((await call('POST', '/api/login', { body: { name: 'LoginUser', password: 'wrong-pass' } })).error.code, 'bad_login');
  assert.equal((await call('POST', '/api/login', { body: { name: 'nobody-here', password: PASSWORD } })).error.code, 'bad_login');
  // recovery code, typed sloppily
  const messy = u.recoveryCode.toLowerCase().replace(/-/g, ' ');
  login = await call('POST', '/api/login', { body: { code: messy } });
  assert.equal(login.status, 200);
  assert.equal((await call('GET', '/api/me', { token: login.token })).me.id, u.me.id);
  assert.equal((await call('POST', '/api/login', { body: { code: '0000-0000-0000-0000' } })).status, 404);
  // a new recovery code replaces the old one
  const rc = await call('POST', '/api/recovery', { token: u.token });
  assert.equal((await call('POST', '/api/login', { body: { code: u.recoveryCode } })).status, 404);
  assert.equal((await call('POST', '/api/login', { body: { code: rc.recoveryCode } })).status, 200);
  // password change needs the current one
  assert.equal((await call('POST', '/api/password', { token: u.token, body: { current: 'nope', password: 'newpass99' } })).status, 403);
  assert.equal((await call('POST', '/api/password', { token: u.token, body: { current: PASSWORD, password: 'newpass99' } })).status, 200);
  assert.equal((await call('POST', '/api/login', { body: { name: 'LoginUser', password: PASSWORD } })).status, 401);
  assert.equal((await call('POST', '/api/login', { body: { name: 'LoginUser', password: 'newpass99' } })).status, 200);
  // logout ends only that session
  assert.equal((await call('POST', '/api/logout', { token: login.token })).status, 200);
  assert.equal((await call('GET', '/api/me', { token: login.token })).status, 401);
  assert.equal((await call('GET', '/api/me', { token: u.token })).status, 200);
});

test('accounts made before passwords existed log in with their code and can add one', async () => {
  const u = await register('OldTimer');
  setUser(u.me.id, { password_hash: '' });
  const r = await call('POST', '/api/login', { body: { name: 'OldTimer', password: PASSWORD } });
  assert.equal(r.status, 401);
  assert.equal(r.error.code, 'no_password');
  const set = await call('POST', '/api/password', { token: u.token, body: { password: 'fresh-pass' } });
  assert.equal(set.status, 200);
  assert.equal(set.me.hasPassword, true);
  assert.equal((await call('POST', '/api/login', { body: { name: 'OldTimer', password: 'fresh-pass' } })).status, 200);
});

test('shop: buy, sell, limits and the daily gift', async () => {
  const u = await register();
  const price = RULES.tokenPrice;
  let r = await call('POST', '/api/buy', { token: u.token, body: { amount: 1000 } });
  assert.equal(r.status, 200);
  assert.equal(r.me.tokens, u.me.tokens + 1000);
  assert.equal(r.me.dollars, u.me.dollars - 1000 * price);
  assert.equal(r.me.boughtToday, 1000);
  assert.ok(r.me.rev > u.me.rev);
  assert.equal((await call('POST', '/api/buy', { token: u.token, body: { amount: Math.floor(r.me.dollars / price) + 1 } })).status, 409);
  for (const bad of [0, -5, 1.5, '10', 'abc', null]) {
    const res = await call('POST', '/api/buy', { token: u.token, body: { amount: bad } });
    assert.equal(res.status, bad === '10' ? 200 : 400, String(bad));
  }
  setUser(u.me.id, { dollars: 10 ** 12 });
  const today = (await call('GET', '/api/me', { token: u.token })).me;
  const left = RULES.dailyLimit - today.boughtToday;
  assert.equal((await call('POST', '/api/buy', { token: u.token, body: { amount: left + 1 } })).status, 409);
  assert.equal((await call('POST', '/api/buy', { token: u.token, body: { amount: left } })).status, 200);
  assert.equal((await call('POST', '/api/buy', { token: u.token, body: { amount: 1 } })).status, 409);
  const before = (await call('GET', '/api/me', { token: u.token })).me;
  assert.equal((await call('POST', '/api/sell', { token: u.token, body: { amount: before.tokens + 1 } })).status, 409);
  r = await call('POST', '/api/sell', { token: u.token, body: { amount: 500 } });
  assert.equal(r.me.tokens, before.tokens - 500);
  assert.equal(r.me.dollars, before.dollars + 500 * price);
  r = await call('POST', '/api/daily', { token: u.token });
  assert.equal(r.status, 200);
  assert.equal(r.me.tokens, before.tokens - 500 + RULES.dailyFree);
  assert.equal(r.me.dailyReady, false);
  assert.equal((await call('POST', '/api/daily', { token: u.token })).status, 409);
});

test('spins are settled on the server and add up', async () => {
  const u = await register();
  assert.equal((await call('POST', '/api/spin', { token: u.token, body: { bet: 100 } })).status, 409, 'no tokens yet');
  assert.equal((await call('POST', '/api/spin', { token: u.token, body: { bet: 150 } })).status, 400, 'bet not on the ladder');
  setUser(u.me.id, { tokens: 1000000 });
  let tokens = 1000000, won = 0, biggest = 0, rev = 0;
  for (let i = 0; i < 150; i++) {
    const bet = RULES.bets[i % 4];
    const r = await call('POST', '/api/spin', { token: u.token, body: { bet } });
    assert.equal(r.status, 200, JSON.stringify(r));
    const res = r.result;
    assert.equal(res.grid.length, 5);
    res.grid.forEach((col, k) => { assert.equal(col.length, 3); assert.equal(col[1], res.line[k]); });
    const check = evaluate(res.line, bet);
    assert.equal(res.total, check.total);
    assert.equal(res.tier, check.tier);
    tokens = tokens - bet + res.total;
    won += res.total;
    biggest = Math.max(biggest, res.total);
    assert.equal(r.balance.tokens, tokens);
    assert.ok(r.balance.rev > rev);
    rev = r.balance.rev;
  }
  const me = (await call('GET', '/api/me', { token: u.token })).me;
  assert.equal(me.tokens, tokens);
  assert.equal(me.totalWon, won);
  assert.equal(me.biggestWin, biggest);
  assert.equal(me.spins, 150);
  assert.equal(me.dayWon, won);
});

test('profiles: no ranking any more; when a player was last online', async () => {
  const a = await register('ボードA', { avatar: 'curly' });
  const b = await register('ボードB');
  assert.equal((await call('GET', '/api/board?type=total', { token: b.token })).status, 404);
  setUser(b.me.id, { last_seen: 1234567 });
  const prof = await call('GET', `/api/user?id=${b.me.id}`, { token: a.token });
  assert.equal(prof.user.name, 'ボードB');
  assert.equal(prof.user.rank, undefined);
  assert.equal(prof.user.lastSeen, 1234567);
  assert.equal(prof.user.friendship, 'none');
  assert.equal(prof.self, false);
});

test('friends: everyone starts with none; request by exact name; accept; notice and chat', async () => {
  const a = await register('FriendA');
  const b = await register('FriendB');
  assert.deepEqual((await call('GET', '/api/friends', { token: a.token })).friends, []);
  const bLive = await listen(b);
  const aLive = await listen(a);
  // search is by exact name (case/width-insensitive), never a partial match
  assert.equal((await call('GET', '/api/user?name=friend', { token: a.token })).status, 404);
  const found = await call('GET', '/api/user?name=friendb', { token: a.token });
  assert.equal(found.user.id, b.me.id);
  assert.equal(found.user.friendship, 'none');
  assert.equal((await call('POST', '/api/friends/request', { token: a.token, body: { name: 'FriendA' } })).error.code, 'self');
  assert.equal((await call('POST', '/api/friends/request', { token: a.token, body: { name: 'nobody-x' } })).status, 404);
  let r = await call('POST', '/api/friends/request', { token: a.token, body: { name: 'ＦＲＩＥＮＤＢ' } });
  assert.equal(r.status, 200);
  assert.equal(r.friendship, 'outgoing');
  assert.equal((await call('POST', '/api/friends/request', { token: a.token, body: { name: 'FriendB' } })).error.code, 'pending');
  const req = await bLive.waitFor('friend', (d) => d.type === 'request');
  assert.equal(req.user.name, 'FriendA');
  assert.equal(req.pending, 1);
  let lists = await call('GET', '/api/friends', { token: b.token });
  assert.deepEqual(lists.incoming.map((x) => x.id), [a.me.id]);
  assert.equal((await call('GET', '/api/me', { token: b.token })).friendRequests, 1);
  assert.equal((await call('GET', `/api/user?id=${a.me.id}`, { token: b.token })).user.friendship, 'incoming');
  // not friends yet: no chat, money, cars, calls or watching
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'hi' } })).error.code, 'not_friends');
  // B accepts: A is told "B accepted", both get the note in their chat
  r = await call('POST', '/api/friends/respond', { token: b.token, body: { user: a.me.id, accept: true } });
  assert.equal(r.friendship, 'friends');
  assert.equal(r.pending, 0);
  const accepted = await aLive.waitFor('friend', (d) => d.type === 'accepted');
  assert.equal(accepted.user.name, 'FriendB');
  const note = await aLive.waitFor('msg', (d) => d.kind === 'system');
  assert.equal(note.peer, b.me.id);
  assert.equal(note.unread, 1);
  lists = await call('GET', '/api/friends', { token: a.token });
  assert.deepEqual(lists.friends.map((x) => x.id), [b.me.id]);
  assert.equal(lists.friends[0].online, true);
  assert.equal((await call('GET', `/api/user?id=${b.me.id}`, { token: a.token })).user.friendship, 'friends');
  const conv = await call('GET', '/api/conversations', { token: a.token });
  assert.equal(conv.conversations[0].user.id, b.me.id);
  assert.equal(conv.conversations[0].friend, true);
  assert.equal(conv.conversations[0].last.kind, 'system');
  r = await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'よろしく！' } });
  assert.equal(r.status, 200);
  assert.equal((await bLive.waitFor('msg', (d) => d.kind === 'text')).text, 'よろしく！');
  // removing ends it for both
  await call('POST', '/api/friends/remove', { token: b.token, body: { user: a.me.id } });
  assert.equal((await aLive.waitFor('friend', (d) => d.type === 'removed')).user.id, b.me.id);
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'あれ？' } })).status, 403);
  aLive.close();
  bLive.close();
});

test('friend requests: decline, cancel, crossing requests, blocking', async () => {
  const a = await register();
  const b = await register();
  const c = await register();
  await call('POST', '/api/friends/request', { token: a.token, body: { user: b.me.id } });
  let r = await call('POST', '/api/friends/respond', { token: b.token, body: { user: a.me.id, accept: false } });
  assert.equal(r.friendship, 'none');
  assert.equal((await call('GET', `/api/user?id=${b.me.id}`, { token: a.token })).user.friendship, 'none');
  assert.equal((await call('POST', '/api/friends/respond', { token: b.token, body: { user: a.me.id, accept: true } })).status, 404);
  await call('POST', '/api/friends/request', { token: a.token, body: { user: b.me.id } });
  await call('POST', '/api/friends/cancel', { token: a.token, body: { user: b.me.id } });
  assert.deepEqual((await call('GET', '/api/friends', { token: b.token })).incoming, []);
  // both asked each other: that is a friendship
  await call('POST', '/api/friends/request', { token: a.token, body: { user: c.me.id } });
  r = await call('POST', '/api/friends/request', { token: c.token, body: { user: a.me.id } });
  assert.equal(r.friendship, 'friends');
  assert.equal((await call('POST', '/api/friends/request', { token: a.token, body: { user: c.me.id } })).error.code, 'already');
  // a block is silent: the friendship stays, and a request to the one who
  // blocked seems to go out but never reaches them
  await call('POST', '/api/block', { token: c.token, body: { user: a.me.id, blocked: true } });
  assert.equal((await call('GET', `/api/user?id=${c.me.id}`, { token: a.token })).user.friendship, 'friends');
  await call('POST', '/api/block', { token: c.token, body: { user: a.me.id, blocked: false } });
  await call('POST', '/api/block', { token: c.token, body: { user: b.me.id, blocked: true } });
  assert.equal((await call('POST', '/api/friends/request', { token: b.token, body: { user: c.me.id } })).friendship, 'outgoing');
  assert.deepEqual((await call('GET', '/api/friends', { token: c.token })).incoming, []);
});

test('direct messages between friends: text is cleaned, unread counts, blocking', async () => {
  const a = await register();
  const b = await register();
  await befriend(a, b);
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: a.me.id, text: 'hi' } })).status, 400);
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: 999999, text: 'hi' } })).status, 404);
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: '   ' } })).status, 400);
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'あ'.repeat(301) } })).status, 400);
  const rlo = String.fromCharCode(0x202e), bell = String.fromCharCode(7), zwsp = String.fromCharCode(0x200b);
  const sent = await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: `<img src=x onerror=alert(1)>${rlo}こんに${zwsp}ちは${bell}` } });
  assert.equal(sent.status, 200);
  assert.equal(sent.message.text, '<img src=x onerror=alert(1)>こんにちは', 'stored as plain text, controls stripped');
  let conv = await call('GET', '/api/conversations', { token: b.token });
  assert.equal(conv.unread, 1, 'the message (the friendship note is unread for the one who asked)');
  assert.equal(conv.conversations[0].user.id, a.me.id);
  assert.equal(conv.conversations[0].last.mine, false);
  await call('POST', '/api/messages', { token: b.token, body: { to: a.me.id, text: 'やあ' } });
  const thread = await call('GET', `/api/messages?with=${a.me.id}`, { token: b.token });
  assert.deepEqual(thread.messages.map((m) => m.from && m.from.id), [null, a.me.id, b.me.id]);
  assert.equal((await call('POST', '/api/read', { token: b.token, body: { with: a.me.id } })).unread, 0);
  // blocked: a still sends, b gets nothing until unblocking
  await call('POST', '/api/block', { token: b.token, body: { user: a.me.id, blocked: true } });
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'まだ？' } })).status, 200);
  assert.equal((await call('GET', `/api/user?id=${a.me.id}`, { token: b.token })).blocked, true);
  assert.equal((await call('GET', '/api/conversations', { token: b.token })).unread, 0);
  assert.equal((await call('POST', '/api/block', { token: b.token, body: { user: a.me.id, blocked: false } })).released, 1);
  conv = await call('GET', '/api/conversations', { token: b.token });
  assert.equal(conv.conversations[0].friend, true);
  assert.equal(conv.unread, 1);
});

test('read receipts and 入力中 in a conversation', async () => {
  const a = await register();
  const b = await register();
  await befriend(a, b);
  const la = await listen(a), lb = await listen(b);
  const sent = await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: '読んだ？' } });
  let thread = await call('GET', `/api/messages?with=${b.me.id}`, { token: a.token });
  assert.ok(thread.readUpTo < sent.message.id, 'not read yet');
  await call('POST', '/api/read', { token: b.token, body: { with: a.me.id } });
  const read = await la.waitFor('read', (e) => e.dm === b.me.id);
  assert.equal(read.upto, sent.message.id);
  thread = await call('GET', `/api/messages?with=${b.me.id}`, { token: a.token });
  assert.equal(thread.readUpTo, sent.message.id);
  assert.equal((await call('POST', '/api/typing', { token: a.token, body: { to: b.me.id } })).status, 200);
  assert.equal((await lb.waitFor('typing')).from.id, a.me.id);
  assert.equal((await call('GET', '/api/messages', { token: a.token })).status, 400, 'there is no lobby any more');
  la.close();
  lb.close();
});

test('group chats: friends only; messages, unread, 既読 and typing reach every member', async () => {
  const a = await register();
  const b = await register();
  const c = await register();
  const stranger = await register();
  await befriend(a, b);
  await befriend(a, c);
  assert.equal((await call('POST', '/api/groups', { token: a.token, body: { name: 'なかま', members: [stranger.me.id] } })).error.code, 'not_friends');
  assert.equal((await call('POST', '/api/groups', { token: a.token, body: { name: 'なかま', members: [] } })).error.code, 'no_members');
  const lb = await listen(b), lc = await listen(c);
  const made = await call('POST', '/api/groups', { token: a.token, body: { name: 'なかま', members: [b.me.id, c.me.id] } });
  assert.equal(made.status, 200, JSON.stringify(made));
  const gid = made.group.id;
  assert.deepEqual(made.group.members.map((m) => m.id), [a.me.id, b.me.id, c.me.id]);
  const msg = await call('POST', '/api/messages', { token: b.token, body: { group: gid, text: 'よろしく' } });
  assert.equal(msg.message.group, gid);
  assert.equal((await lc.waitFor('msg', (m) => m.group === gid && m.kind === 'text')).text, 'よろしく');
  const conv = await call('GET', '/api/conversations', { token: c.token });
  const g = conv.groups.find((x) => x.id === gid);
  assert.deepEqual([g.name, g.unread, g.last.text], ['なかま', 2, 'よろしく']);
  await call('POST', '/api/read', { token: c.token, body: { group: gid } });
  assert.equal((await lb.waitFor('read', (e) => e.group === gid && e.by === c.me.id)).upto, msg.message.id);
  const thread = await call('GET', `/api/messages?group=${gid}`, { token: b.token });
  assert.ok(thread.reads.some((r) => r.id === c.me.id && r.upto === msg.message.id));
  await call('POST', '/api/typing', { token: c.token, body: { group: gid } });
  assert.equal((await lb.waitFor('typing', (e) => e.group === gid)).from.id, c.me.id);
  assert.equal((await call('GET', `/api/messages?group=${gid}`, { token: stranger.token })).status, 404);
  assert.equal((await call('POST', '/api/groups/leave', { token: c.token, body: { group: gid } })).left, gid);
  assert.equal((await call('POST', '/api/messages', { token: c.token, body: { group: gid, text: 'まだいる？' } })).status, 404);
  lb.close();
  lc.close();
});

test('transfers: friends only, atomic, shown in the chat', async () => {
  const a = await register();
  const b = await register();
  setUser(a.me.id, { tokens: 5000, dollars: 100 });
  const no = await call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 1, currency: 'tokens' } });
  assert.equal(no.error.code, 'not_friends');
  await befriend(a, b);
  const bad = [
    [{ to: a.me.id, amount: 1, currency: 'tokens' }, 400],
    [{ to: b.me.id, amount: 1, currency: 'coins' }, 400],
    [{ to: b.me.id, amount: 0, currency: 'tokens' }, 400],
    [{ to: b.me.id, amount: 5001, currency: 'tokens' }, 409],
    [{ to: b.me.id, amount: 101, currency: 'dollars' }, 409],
    [{ to: 424242, amount: 1, currency: 'tokens' }, 404]
  ];
  for (const [body, status] of bad) assert.equal((await call('POST', '/api/transfer', { token: a.token, body })).status, status, JSON.stringify(body));
  const bBefore = (await call('GET', '/api/me', { token: b.token })).me;
  const r = await call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 1234, currency: 'tokens' } });
  assert.equal(r.status, 200);
  assert.equal(r.balance.tokens, 5000 - 1234);
  assert.equal(r.message.kind, 'transfer');
  assert.equal(r.message.amount, 1234);
  const bAfter = (await call('GET', '/api/me', { token: b.token })).me;
  assert.equal(bAfter.tokens, bBefore.tokens + 1234);
  assert.ok(bAfter.rev > bBefore.rev);
  assert.equal(bAfter.totalWon, bBefore.totalWon, 'received money is not winnings');
  const d = await call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 100, currency: 'dollars' } });
  assert.equal(d.balance.dollars, 0);
});

test('icons: free ones anytime; paid ones at the daily sale price, once', async () => {
  const u = await register('IconBuyer', { avatar: 'blond' });
  let r = await call('POST', '/api/avatar', { token: u.token, body: { id: 'witch' } });
  assert.equal(r.me.avatar, 'witch');
  assert.equal((await call('POST', '/api/avatar', { token: u.token, body: { id: 'vampire' } })).error.code, 'locked');
  const shop = (await call('GET', '/api/me', { token: u.token })).iconShop;
  assert.equal(shop.day, utcDay());
  assert.deepEqual(shop.items.map((i) => i.id).sort(), ['pumpkin', 'red', 'vampire']);
  const full = { pumpkin: 100000, red: 350000, vampire: 800000 };
  for (const item of shop.items) {
    assert.equal(item.price, full[item.id]);
    assert.ok(item.pct >= 10 && item.pct <= 40, `${item.id} ${item.pct}% off`);
    assert.equal(item.salePrice, Math.round(full[item.id] * (100 - item.pct) / 100));
    assert.deepEqual(iconSale(AVATARS.get(item.id), shop.day), { price: item.salePrice, pct: item.pct });
  }
  // the discount moves between 10 and 40 % from day to day
  const seen = new Set();
  for (let d = 1; d <= 60; d++) seen.add(iconSale(AVATARS.get('red'), `2027-1-${d}`).pct);
  assert.ok(seen.size >= 5 && Math.min(...seen) === 10 && Math.max(...seen) === 40, [...seen].join(','));
  const vamp = shop.items.find((i) => i.id === 'vampire');
  setUser(u.me.id, { dollars: vamp.salePrice - 1 });
  assert.equal((await call('POST', '/api/avatar/buy', { token: u.token, body: { id: 'vampire', price: vamp.salePrice } })).error.code, 'insufficient');
  setUser(u.me.id, { dollars: 2000000 });
  r = await call('POST', '/api/avatar/buy', { token: u.token, body: { id: 'vampire', price: vamp.price } });
  assert.equal(r.error.code, 'price_changed', 'a price the player was not shown is never charged');
  assert.equal((await call('GET', '/api/me', { token: u.token })).me.dollars, 2000000);
  r = await call('POST', '/api/avatar/buy', { token: u.token, body: { id: 'vampire', price: vamp.salePrice } });
  assert.equal(r.status, 200);
  assert.equal(r.paid, vamp.salePrice);
  assert.equal(r.me.dollars, 2000000 - vamp.salePrice);
  assert.equal(r.me.avatar, 'vampire');
  assert.ok(r.me.avatars.includes('vampire'));
  assert.equal((await call('POST', '/api/avatar/buy', { token: u.token, body: { id: 'vampire' } })).error.code, 'owned');
  assert.equal((await call('POST', '/api/avatar/buy', { token: u.token, body: { id: 'bald' } })).error.code, 'bad_avatar');
  // owned icons can be switched back and forth for free
  assert.equal((await call('POST', '/api/avatar', { token: u.token, body: { id: 'curly' } })).me.avatar, 'curly');
  r = await call('POST', '/api/avatar', { token: u.token, body: { id: 'vampire' } });
  assert.equal(r.me.avatar, 'vampire');
  assert.equal(r.me.dollars, 2000000 - vamp.salePrice);
});

test('cars: Car Owner sells for $1,200,000; garage; gifts go to friends only', async () => {
  const a = await register();
  const b = await register();
  const c = await register();
  await befriend(a, b);
  setUser(a.me.id, { dollars: 1199999 });
  assert.equal((await call('POST', '/api/cars/buy', { token: a.token, body: { model: 'two-state-sedan' } })).error.code, 'insufficient');
  assert.equal((await call('POST', '/api/cars/buy', { token: a.token, body: { model: 'tank' } })).status, 400);
  setUser(a.me.id, { dollars: 2500000 });
  let r = await call('POST', '/api/cars/buy', { token: a.token, body: { model: 'two-state-sedan' } });
  assert.equal(r.status, 200);
  assert.equal(r.me.dollars, 1300000);
  assert.equal(r.me.cars, 1);
  const car = r.car;
  let garage = await call('GET', '/api/cars', { token: a.token });
  assert.equal(garage.catalog[0].price, 1200000);
  assert.deepEqual(garage.cars.map((x) => x.id), [car.id]);
  assert.equal((await call('POST', '/api/cars/gift', { token: a.token, body: { to: c.me.id, car: car.id } })).error.code, 'not_friends');
  assert.equal((await call('POST', '/api/cars/gift', { token: b.token, body: { to: a.me.id, car: car.id } })).error.code, 'no_car');
  r = await call('POST', '/api/cars/gift', { token: a.token, body: { to: b.me.id, car: car.id } });
  assert.equal(r.status, 200);
  assert.equal(r.message.kind, 'gift');
  assert.equal(r.message.text, 'two-state-sedan');
  assert.deepEqual((await call('GET', '/api/cars', { token: a.token })).cars, []);
  garage = await call('GET', '/api/cars', { token: b.token });
  assert.equal(garage.cars[0].id, car.id);
  assert.equal(garage.cars[0].from.id, a.me.id);
  assert.equal((await call('GET', `/api/user?id=${b.me.id}`, { token: a.token })).user.cars, 1);
  assert.equal((await call('POST', '/api/cars/gift', { token: a.token, body: { to: b.me.id, car: car.id } })).error.code, 'no_car');
});

test('voice: only in a home, and only with the watchers the watched player picked', async () => {
  const a = await register();
  const b = await register();
  await befriend(a, b);
  const ice = await call('GET', '/api/call/ice', { token: a.token });
  assert.ok(ice.iceServers[0].urls.length >= 1);
  const callId = `home-${a.me.id}`;
  const hello = (from, to) => call('POST', '/api/call', { token: from.token, body: { to: to.me.id, type: 'home', callId, data: { room: a.me.id, op: 'hello' } } });
  assert.equal((await call('POST', '/api/call', { token: a.token, body: { to: b.me.id, type: 'invite', callId } })).status, 400);
  assert.equal((await hello(a, b)).error.code, 'not_home');
  const w = await call('POST', '/api/watch', { token: b.token, body: { user: a.me.id, on: true } });
  assert.equal(w.voice, false, 'nobody talks at first');
  assert.equal((await hello(a, b)).error.code, 'not_home');
  // only the watched player picks who they talk with
  assert.equal((await call('POST', '/api/watch/voice', { token: b.token, body: { user: b.me.id, on: true } })).error.code, 'host_only');
  const bLive = await listen(b);
  assert.deepEqual((await call('POST', '/api/watch/voice', { token: a.token, body: { user: b.me.id, on: true } })).voice, [b.me.id]);
  assert.deepEqual((await bLive.waitFor('watch', (d) => d.type === 'voice')).voice, [b.me.id]);
  assert.equal((await hello(a, b)).status, 200);
  assert.equal((await bLive.waitFor('call', (d) => d.type === 'home')).from.id, a.me.id);
  // the watcher stops talking
  assert.deepEqual((await call('POST', '/api/watch/voice', { token: b.token, body: { user: b.me.id, on: false } })).voice, []);
  assert.equal((await hello(b, a)).error.code, 'not_home');
  bLive.close();
});

test('watching a friend\'s screen: friends only, spins and balance pushed live', async () => {
  const a = await register('Watched');
  const b = await register('Watcher');
  const c = await register();
  assert.equal((await call('POST', '/api/watch', { token: b.token, body: { user: a.me.id, on: true } })).error.code, 'not_friends');
  await befriend(a, b);
  setUser(a.me.id, { tokens: 10000 });
  await call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
  const aLive = await listen(a);
  const bLive = await listen(b);
  let r = await call('POST', '/api/watch', { token: b.token, body: { user: a.me.id, on: true } });
  assert.equal(r.on, true);
  assert.equal(r.user.name, 'Watched');
  assert.equal(r.user.online, true);
  assert.equal(r.last.bet, 100);
  assert.equal(r.last.grid.length, 5);
  const told = await aLive.waitFor('watch', (d) => d.type === 'watched');
  assert.deepEqual([told.by.name, told.on], ['Watcher', true]);
  assert.deepEqual((await call('GET', '/api/watchers', { token: a.token })).watchers.map((w) => w.id), [b.me.id]);
  const spin = await call('POST', '/api/spin', { token: a.token, body: { bet: 200 } });
  const seen = await bLive.waitFor('watch', (d) => d.type === 'spin');
  assert.deepEqual(seen.result.grid, spin.result.grid);
  assert.equal(seen.balance.tokens, spin.balance.tokens);
  await call('POST', '/api/daily', { token: a.token });
  assert.equal((await bLive.waitFor('watch', (d) => d.type === 'balance')).balance.tokens, spin.balance.tokens + RULES.dailyFree);
  // C is not a friend and hears nothing; B stops watching
  assert.equal((await call('GET', '/api/watchers', { token: c.token })).watchers.length, 0);
  r = await call('POST', '/api/watch', { token: b.token, body: { user: a.me.id, on: false } });
  assert.equal(r.on, false);
  assert.deepEqual(await aLive.waitFor('watch', (d) => d.type === 'watched' && !d.on).then((d) => d.by.id), b.me.id);
  // a watched player going offline ends the session for the watcher
  await call('POST', '/api/watch', { token: b.token, body: { user: a.me.id, on: true } });
  aLive.close();
  await bLive.waitFor('watch', (d) => d.type === 'offline');
  bLive.close();
});

test('banned players are locked out', async () => {
  const u = await register('BannedOne');
  setUser(u.me.id, { banned: 1 });
  assert.equal((await call('GET', '/api/me', { token: u.token })).status, 403);
  assert.equal((await call('POST', '/api/login', { body: { code: u.recoveryCode } })).status, 403);
  assert.equal((await call('POST', '/api/login', { body: { name: 'BannedOne', password: PASSWORD } })).status, 403);
});

test('live stream: tickets open one connection; messages and transfers are pushed', async () => {
  const a = await register();
  const b = await register();
  await befriend(a, b);
  setUser(a.me.id, { tokens: 100 });
  const live = await listen(b);
  const hello = await live.waitFor('hello');
  assert.equal(hello.me.id, b.me.id);
  assert.equal(hello.iconShop.items.length, 3);
  await assert.rejects(s.openStream(live.ticket, () => {}), 'a ticket works once');
  await assert.rejects(s.openStream('1.2.3', () => {}));
  await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'ライブ' } });
  const msg = await live.waitFor('msg', (d) => d.kind === 'text');
  assert.equal(msg.text, 'ライブ');
  assert.equal(msg.unread, 1);
  await call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 60, currency: 'tokens' } });
  const bal = await live.waitFor('balance');
  assert.equal(bal.tokens, RULES.start.tokens + 60);
  live.close();
});
