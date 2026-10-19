// 協力スロット, フレンド対決, 観戦ベット and the feedback to the operator:
// npm test (from the repository root)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES } from '../core/rules.js';

let s, call, register, setUser, befriend, listen;

before(async () => {
  s = await startServer({ limits: { spin: [100000, 1000], shop: [100000, 1000], general: [100000, 1000], login: [100000, 1000], friend: [100000, 1000], transfer: [100000, 1000], dm: [100000, 1000] } });
  ({ call, register, setUser, befriend, listen } = s);
});

after(() => s.stop());

const tokensOf = async (p) => (await call('GET', '/api/me', { token: p.token })).me.tokens;

test('フレンド対決: invitation, the same spins at one bet, the larger total wins, told in the chat', async () => {
  const a = await register('Fighter1'), b = await register('Fighter2');
  assert.equal((await call('POST', '/api/battle', { token: a.token, body: { to: b.me.id, spins: 10, bet: 100 } })).error.code, 'not_friends');
  await befriend(a, b);
  setUser(a.me.id, { tokens: 100000 });
  setUser(b.me.id, { tokens: 100000 });
  assert.equal((await call('POST', '/api/battle', { token: a.token, body: { to: b.me.id, spins: 10, bet: 100 } })).error.code, 'offline');
  const lb = await listen(b), la = await listen(a);
  assert.equal((await call('POST', '/api/battle', { token: a.token, body: { to: b.me.id, spins: 7, bet: 100 } })).error.code, 'bad_spins');
  const inv = await call('POST', '/api/battle', { token: a.token, body: { to: b.me.id, spins: 10, bet: 100 } });
  assert.equal(inv.battle.state, 'invite');
  assert.equal((await lb.waitFor('battle', (e) => e.type === 'invite')).battle.other.id, a.me.id);
  assert.equal((await call('POST', '/api/battle', { token: a.token, body: { to: b.me.id, spins: 10, bet: 100 } })).error.code, 'busy');
  const go = await call('POST', '/api/battle/respond', { token: b.token, body: { id: inv.battle.id, accept: true } });
  assert.equal(go.battle.state, 'live');
  await la.waitFor('battle', (e) => e.type === 'start');
  // a spin at another bet does not count
  await call('POST', '/api/spin', { token: a.token, body: { bet: 200 } });
  assert.equal((await call('GET', '/api/battle', { token: a.token })).battle.me.n, 0);
  let won = { a: 0, b: 0 };
  for (let i = 0; i < 10; i++) {
    won.a += (await call('POST', '/api/spin', { token: a.token, body: { bet: 100 } })).result.total;
    won.b += (await call('POST', '/api/spin', { token: b.token, body: { bet: 100 } })).result.total;
  }
  const done = await la.waitFor('battle', (e) => e.type === 'done');
  assert.deepEqual([done.battle.me.won, done.battle.other.won], [won.a, won.b]);
  assert.equal(done.battle.winner, won.a === won.b ? 0 : won.a > won.b ? a.me.id : b.me.id);
  const chat = await call('GET', `/api/messages?with=${b.me.id}`, { token: a.token });
  assert.match(chat.messages.at(-1).text, /^フレンド対決（10回・ベット100）/);
  assert.equal((await call('GET', '/api/battle', { token: b.token })).battle, null);
  // giving up: the friend wins
  const again = await call('POST', '/api/battle', { token: b.token, body: { to: a.me.id, spins: 20, bet: 100 } });
  await call('POST', '/api/battle/respond', { token: a.token, body: { id: again.battle.id, accept: true } });
  await call('POST', '/api/battle/quit', { token: a.token, body: { id: again.battle.id } });
  assert.equal((await lb.waitFor('battle', (e) => e.type === 'done' && e.battle.id === again.battle.id)).battle.winner, b.me.id);
  la.close();
  lb.close();
});

test('観戦ベット: a watcher stakes tokens on a BIG WIN within the next 10 spins', async () => {
  const host = await register('BetHost'), fan = await register('BetFan');
  await befriend(host, fan);
  setUser(host.me.id, { tokens: 1000000 });
  setUser(fan.me.id, { tokens: 50000 });
  assert.equal((await call('POST', '/api/watch/bet', { token: fan.token, body: { side: 'hit', stake: 1000 } })).error.code, 'not_watching');
  await call('POST', '/api/watch', { token: fan.token, body: { user: host.me.id, on: true } });
  assert.equal((await call('POST', '/api/watch/bet', { token: fan.token, body: { side: 'hit', stake: 777 } })).error.code, 'bad_stake');
  const r = await call('POST', '/api/watch/bet', { token: fan.token, body: { side: 'miss', stake: 10000 } });
  assert.deepEqual([r.bet.side, r.bet.left, r.balance.tokens], ['miss', 10, 40000]);
  assert.equal((await call('POST', '/api/watch/bet', { token: fan.token, body: { side: 'hit', stake: 1000 } })).error.code, 'bet_open');
  const lf = await listen(fan);
  let big = false;
  for (let i = 0; i < 10 && !big; i++) big = (await call('POST', '/api/spin', { token: host.token, body: { bet: 100 } })).result.tier >= 2;
  const end = await lf.waitFor('watch', (e) => e.type === 'bet' && e.bet.state !== 'open');
  assert.equal(end.bet.state, big ? 'lost' : 'won');
  assert.equal(await tokensOf(fan), 40000 + (big ? 0 : Math.floor(10000 * RULES.watchBet.miss)));
  lf.close();
});

test('協力スロット: bets at a group table fill one gauge; a full one pays everyone who bet', async () => {
  const a = await register('Coop1'), b = await register('Coop2');
  await befriend(a, b);
  const g = (await call('POST', '/api/groups', { token: a.token, body: { name: '協力', members: [b.me.id] } })).group;
  setUser(a.me.id, { tokens: 1000000 });
  setUser(b.me.id, { tokens: 1000000 });
  let r = await call('POST', '/api/coop', { token: a.token, body: { group: g.id, on: true } });
  assert.deepEqual([r.coop.gauge, r.coop.goal, r.coop.players.map((p) => p.id)], [0, RULES.coop.goal, [a.me.id]]);
  await call('POST', '/api/coop', { token: b.token, body: { group: g.id, on: true } });
  const sa = await call('POST', '/api/spin', { token: a.token, body: { bet: 50000 } });
  assert.equal((await call('GET', `/api/coop?group=${g.id}`, { token: b.token })).coop.gauge, 50000);
  const before = await tokensOf(a);
  const sb = await call('POST', '/api/spin', { token: b.token, body: { bet: 50000 } });
  // full: 5 % of what each one bet in the round, and a line in the group's chat
  assert.equal(await tokensOf(a), before + 2500);
  assert.equal(sb.balance.tokens, 1000000 - 50000 + sb.result.total + (sb.result.charm ? sb.result.charm.back : 0) + 2500);
  assert.equal((await call('GET', `/api/coop?group=${g.id}`, { token: a.token })).coop.gauge, 0);
  const chat = await call('GET', `/api/messages?group=${g.id}`, { token: a.token });
  assert.match(chat.messages.at(-1).text, /^協力スロットのゲージが満タン！/);
  assert.ok(sa.result);
  // leaving the group leaves its table
  await call('POST', '/api/groups/leave', { token: b.token, body: { group: g.id } });
  assert.equal((await call('GET', '/api/me', { token: b.token })).me.coop, 0);
});

test('feedback: stars (some may be left out) and any comment, read only by the operators', async () => {
  const p = await register('Player1'), taku = await register('taku');
  setUser(p.me.id, { play_ms: 3600000 });
  assert.equal((await call('GET', '/api/me', { token: p.token })).me.feedback, 'ask');
  assert.equal((await call('POST', '/api/feedback', { token: p.token, body: { ratings: {}, comment: '  ' } })).error.code, 'empty');
  assert.equal((await call('POST', '/api/feedback', { token: p.token, body: { ratings: { slot: 6 } } })).error.code, 'bad_rating');
  const long = 'もっと台を増やしてほしい。'.repeat(2000);
  const r = await call('POST', '/api/feedback', { token: p.token, body: { ratings: { slot: 5, looks: 3 }, comment: long } });
  assert.equal(r.me.feedback, 'sent');
  assert.equal((await call('GET', '/api/feedback', { token: p.token })).status, 403);
  const f = await call('GET', '/api/feedback', { token: taku.token });
  assert.deepEqual([f.count, f.feedback[0].user.name, f.feedback[0].ratings.slot, f.feedback[0].ratings.clarity, f.feedback[0].comment.length],
    [1, 'Player1', 5, 0, long.length]);
  assert.equal(f.average.looks, 3);
  assert.equal((await call('GET', '/api/me', { token: taku.token })).me.operator, true);
});
