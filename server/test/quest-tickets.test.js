import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { QUESTS, LEVEL } from '../core/rules.js';
import { stepQuests, claimQuests, questView, questTickets, grantLevelTickets, resetQuestPeriod, readQuests } from '../core/quests.js';

const NOW = Date.UTC(2026, 9, 22, 1);
const advance = (state, events, now = NOW) => stepQuests(state, events, now, null, () => 999);

test('additional combo, hub, clear and daily transfer stages have the requested rewards', () => {
  const cases = [
    ['5h-combo2', [[2, 5000], [3, 10000], [4, 20000], [5, 100000], [6, 250000], [7, 400000], [8, 950000]]],
    ['5h-join', [[1, 5000], [2, 10000], [3, 15000], [4, 20000], [5, 25000], [6, 35000]]],
    ['5h-clear10', [[10, 10000], [20, 15000], [30, 25000], [40, 35000], [50, 40000], [60, 60000]]],
    ['day-send1k', [[1000, 5000], [100000, 10000], [300000, 30000], [500000, 35000], [850000, 55000],
      [1100000, 65000], [1850000, 78000], [2100000, 89000]]]
  ];
  for (const [id, expected] of cases) {
    assert.deepEqual(QUESTS.chainOf(QUESTS.get(id)).map(q => [q.goal, q.reward]), expected);
  }
  const state = {};
  advance(state, [['combo', 5]]);
  assert.ok(state['5h'].c.includes('5h-combo5'));
  advance(state, [['combo', 3]]);
  assert.equal(state['5h'].m.combo, 5, 'combos keep the longest streak, not the sum');
  advance(state, [['combo', 8]]);
  const combo = claimQuests(state, ['5h-combo5', '5h-combo6', '5h-combo7', '5h-combo8'], NOW);
  assert.equal(combo.dollars, 1700000);
  advance(state, [['hub', 6], ['clear', 60]]);
  const completed = state['5h'].c;
  assert.ok(['5h-join2', '5h-join6', '5h-clear10', '5h-clear60'].every(id => completed.includes(id)));
});

test('winning level draws include every crossed level and every multiple of five, including 25 and above', () => {
  const state = {};
  assert.deepEqual(questTickets(state), { '5h': 0, day: 0 });
  for (let level = 2; level <= 100; level++) {
    const gain = grantLevelTickets(state, LEVEL.at(level - 1), LEVEL.at(level), () => 0);
    assert.deepEqual(gain, { '5h': 1, day: level % 5 === 0 ? 1 : 0 });
    assert.deepEqual(questTickets(state), { '5h': level - 1, day: Math.floor(level / 5) });
  }
  const jumped = {};
  assert.deepEqual(grantLevelTickets(jumped, LEVEL.at(4), LEVEL.at(31), () => 0), { '5h': 27, day: 6 });
  grantLevelTickets(jumped, LEVEL.at(31), LEVEL.at(31), () => { throw new Error('no new level'); });
  grantLevelTickets(jumped, LEVEL.at(31), LEVEL.at(2), () => { throw new Error('no new level'); });
  assert.deepEqual(questTickets(readQuests(JSON.stringify(jumped))), { '5h': 27, day: 6 });
  advance(jumped, [['spin', 1]], NOW + 5 * 3600000);
  assert.deepEqual(questTickets(jumped), { '5h': 27, day: 6 }, 'natural period changes preserve tickets');
});

test('daily transfer extensions use cumulative dollars, including converted tokens', async t => {
  const s = await startServer({ quests: true });
  t.after(() => s.stop());
  const a = await s.register('DailySender'), b = await s.register('DailyFriend');
  await s.befriend(a, b);
  s.setUser(a.me.id, { dollars: 10000000, tokens: 1000000 });
  const goals = [500000, 850000, 1100000, 1850000, 2100000];
  const ids = ['day-send500k', 'day-send850k', 'day-send1.1m', 'day-send1.85m', 'day-send2.1m'];
  const transfer = (amount, currency) => s.call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount, currency } });
  assert.equal((await transfer(499000, 'dollars')).status, 200);
  let quests = await s.call('GET', '/api/quests', { token: a.token });
  assert.equal(quests.periods.find(p => p.id === 'day').quests.find(q => q.id === ids[0]).state, 'open');
  for (const [i, [amount, currency]] of [[100, 'tokens'], [350000, 'dollars'], [25000, 'tokens'], [750000, 'dollars'], [250000, 'dollars']].entries()) {
    assert.equal((await transfer(amount, currency)).status, 200);
    quests = await s.call('GET', '/api/quests', { token: a.token });
    const daily = quests.periods.find(p => p.id === 'day').quests;
    assert.equal(daily.find(q => q.id === ids[i]).state, 'ready');
    assert.equal(daily.find(q => q.id === ids.at(-1)).progress, goals[i]);
  }
  const reward = await s.call('POST', '/api/quests/claim', { token: a.token, body: { ids } });
  assert.equal(reward.dollars, 322000);
});

test('spin XP grants tickets at the actual level boundary, with no retroactive or login rewards', async t => {
  const s = await startServer({ quests: true });
  t.after(() => s.stop());
  const a = await s.register('SpinTickets');
  const get = () => s.call('GET', '/api/quests', { token: a.token });
  assert.deepEqual((await get()).tickets, { '5h': 0, day: 0 });
  s.setUser(a.me.id, { xp: LEVEL.at(2) - 1, tokens: 10000 });
  let r = await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100, xp: 9999999 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.xp, LEVEL.at(2));
  assert.deepEqual(r.questTickets, { '5h': 1, day: 0 });
  s.setUser(a.me.id, { xp: LEVEL.at(5) - 1 });
  r = await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
  assert.deepEqual(r.questTickets, { '5h': 2, day: 1 });
  for (let i = 0; i < 3; i++) assert.deepEqual((await get()).tickets, { '5h': 2, day: 1 });
  const legacy = await s.register('LegacyLevel');
  s.setUser(legacy.me.id, { xp: LEVEL.at(25) });
  assert.deepEqual((await s.call('GET', '/api/me', { token: legacy.token })).me.questTickets, { '5h': 0, day: 0 });
});

for (const bulk of [false, true]) {
  test(`${bulk ? 'bulk' : 'individual'} quest XP grants milestone tickets once`, async t => {
    const s = await startServer({ quests: true });
    t.after(() => s.stop());
    const a = await s.register(bulk ? 'BulkTickets' : 'SoloTickets');
    const state = {};
    advance(state, [['spin', 2]], Date.now());
    s.setUser(a.me.id, { xp: LEVEL.at(5) - 30, quests: JSON.stringify(state) });
    const claim = ids => s.call('POST', '/api/quests/claim', { token: a.token, body: { ids } });
    if (bulk) {
      const replies = await Promise.all([claim(null), claim(null)]);
      assert.deepEqual(replies.map(r => r.claimed.length).sort(), [0, 2]);
    } else {
      assert.deepEqual((await claim(['5h-spin1'])).tickets, { '5h': 0, day: 0 });
      assert.deepEqual((await claim(['5h-spin2'])).tickets, { '5h': 1, day: 1 });
    }
    const duplicate = await claim(null);
    assert.deepEqual(duplicate.tickets, { '5h': 1, day: 1 });
    assert.equal(duplicate.xp, LEVEL.at(5) + 10);
  });
}

test('winning draws during bulk XP grant a five-hour ticket for each crossed level', async t => {
  const s = await startServer({ quests: true });
  t.after(() => s.stop());
  const a = await s.register('JumpTickets');
  const state = { '5h': { k: QUESTS.range('5h', Date.now()).k, m: {}, c: QUESTS.list.filter(q => q.period === '5h').slice(0, 20).map(q => q.id), d: [] } };
  s.setUser(a.me.id, { xp: LEVEL.at(2) - 1, quests: JSON.stringify(state) });
  const r = await s.call('POST', '/api/quests/claim', { token: a.token, body: {} });
  assert.equal(r.claimed.length, 20);
  assert.equal(LEVEL.of(r.xp), 3);
  assert.deepEqual(r.tickets, { '5h': 2, day: 0 });
});

test('ticket use rejects pending rewards, resets only its period, and cannot spend twice on retries', async t => {
  const s = await startServer({ quests: true });
  t.after(() => s.stop());
  const a = await s.register('ResetTickets'), other = await s.register('NoTickets');
  const state = { tickets: { '5h': 3, day: 2 } };
  stepQuests(state, [['spin', 1], ['sent', 1000]], Date.now(), null, () => 0);
  s.setUser(a.me.id, { quests: JSON.stringify(state), tokens: 10000, xp: LEVEL.at(5) });
  const get = () => s.call('GET', '/api/quests', { token: a.token });
  const snapshot = await get();
  const five = snapshot.periods.find(p => p.id === '5h');
  const body = { period: '5h', start: five.start, version: five.resetVersion };
  const reset = (request = body, token = a.token) => s.call('POST', '/api/quests/reset', { token, body: request });
  assert.equal((await reset(body, null)).status, 401);
  assert.equal((await reset(body, other.token)).error.code, 'quest_ticket');
  assert.equal((await reset({ ...body, period: 'week' })).status, 400);
  assert.equal((await reset()).error.code, 'quests_pending');
  assert.deepEqual((await get()).tickets, { '5h': 3, day: 2 });
  const reward = await s.call('POST', '/api/quests/claim', { token: a.token, body: { ids: ['5h-spin1'] } });
  assert.equal(reward.coins, 8, 'the pending ULTRA is received before resetting');
  const dailyBefore = reward.periods.find(p => p.id === 'day');
  const replies = await Promise.all([reset(), reset()]);
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
  const result = replies.find(r => r.status === 200);
  assert.deepEqual(result.tickets, { '5h': 2, day: 2 });
  const fresh = result.periods.find(p => p.id === '5h');
  assert.deepEqual([fresh.start, fresh.end], [five.start, five.end]);
  assert.equal(fresh.resetVersion, five.resetVersion + 1);
  assert.ok(fresh.quests.every(q => q.state === 'open' && q.progress === 0 && !q.reward));
  assert.deepEqual(result.periods.find(p => p.id === 'day'), dailyBefore, 'other periods keep progress and ULTRA');
  assert.deepEqual([result.balance.dollars, result.balance.coins, result.xp], [reward.balance.dollars, reward.balance.coins, reward.xp]);
  assert.equal((await reset({ ...body, version: fresh.resetVersion })).error.code, 'quests_empty');
  assert.equal((await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } })).status, 200);
  assert.equal((await reset()).error.code, 'quests_changed', 'even new progress cannot make the old request spend another ticket');
  const replayed = await s.call('POST', '/api/quests/claim', { token: a.token, body: { ids: ['5h-spin1'] } });
  assert.deepEqual([replayed.dollars, replayed.coins], [7000, 0], 'the replayed STEP draws anew without inheriting ULTRA');
  const daily = replayed.periods.find(p => p.id === 'day');
  assert.equal((await reset({ period: 'day', start: daily.start, version: daily.resetVersion })).error.code, 'quests_pending');
  await s.call('POST', '/api/quests/claim', { token: a.token, body: { ids: ['day-send1k'] } });
  const dayReset = await reset({ period: 'day', start: daily.start, version: daily.resetVersion });
  assert.equal(dayReset.status, 200);
  assert.deepEqual(dayReset.tickets, { '5h': 2, day: 1 });
  assert.deepEqual(dayReset.periods.find(p => p.id === '5h'), replayed.periods.find(p => p.id === '5h'));
});

test('period rollover invalidates stale reset requests while preserving both ticket inventories', () => {
  const state = { tickets: { '5h': 2, day: 3 } };
  advance(state, [['spin', 1]]);
  claimQuests(state, null, NOW);
  const p = questView(state, NOW).find(p => p.id === '5h');
  const later = NOW + 5 * 3600000;
  assert.throws(() => resetQuestPeriod(state, '5h', { start: p.start, version: p.resetVersion }, later), e => e.code === 'quests_changed');
  assert.deepEqual(questTickets(state), { '5h': 2, day: 3 });
});

test('ticket draws have exact 10/100 and 30/100 boundaries and remain independent', () => {
  const totals = { '5h': 0, day: 0 };
  for (let draw = 0; draw < 100; draw++) {
    const state = {};
    const gain = grantLevelTickets(state, LEVEL.at(4), LEVEL.at(5), () => draw);
    assert.deepEqual(gain, { '5h': draw < 10 ? 1 : 0, day: draw < 30 ? 1 : 0 });
    totals['5h'] += gain['5h']; totals.day += gain.day;
    assert.deepEqual(questTickets(state), gain);
  }
  assert.deepEqual(totals, { '5h': 10, day: 30 });
  const state = {}, draws = [99, 29];
  assert.deepEqual(grantLevelTickets(state, LEVEL.at(4), LEVEL.at(5), () => draws.shift()), { '5h': 0, day: 1 });
  assert.deepEqual(questTickets(state), { '5h': 0, day: 1 });
  assert.equal(draws.length, 0);
  let calls = 0;
  assert.deepEqual(grantLevelTickets({}, LEVEL.at(5), LEVEL.at(6), () => { calls++; return 0; }), { '5h': 1, day: 0 });
  assert.equal(calls, 1, 'nonmilestone levels do not draw daily tickets');
});

test('missed draws do not change inventory, including when jumping levels', () => {
  const state = { tickets: { '5h': 3, day: 4 } };
  let calls = 0;
  assert.deepEqual(grantLevelTickets(state, LEVEL.at(4), LEVEL.at(16), () => { calls++; return 99; }), { '5h': 0, day: 0 });
  assert.equal(calls, 15, '12 level draws and three milestone draws');
  assert.deepEqual(questTickets(state), { '5h': 3, day: 4 });
});

test('a daily-only draw persists on spin XP even with quest progress disabled', async t => {
  const draws = [99, 29];
  const s = await startServer({ quests: false, questTicketRoll: () => {
    assert.ok(draws.length > 0, 'draws must not repeat on reads/retries'); return draws.shift();
  } });
  t.after(() => s.stop());
  const p = await s.register('DailyOnly');
  s.setUser(p.me.id, { xp: LEVEL.at(5) - 1, tokens: 10000 });
  const spin = await s.call('POST', '/api/spin', { token: p.token, body: { bet: 100 } });
  assert.equal(spin.status, 200);
  assert.deepEqual(spin.questTickets, { '5h': 0, day: 1 });
  assert.deepEqual((await s.call('GET', '/api/me', { token: p.token })).me.questTickets, { '5h': 0, day: 1 });
  assert.equal(draws.length, 0);
});

test('losing quest-claim draws cannot be rerolled by claiming or refreshing again', async t => {
  let calls = 0;
  const s = await startServer({ quests: true, questTicketRoll: () => { calls++; return 99; } });
  t.after(() => s.stop());
  const p = await s.register('NoReroll'), state = {};
  advance(state, [['spin', 2]], Date.now());
  s.setUser(p.me.id, { xp: LEVEL.at(5) - 30, quests: JSON.stringify(state) });
  const claim = () => s.call('POST', '/api/quests/claim', { token: p.token, body: {} });
  assert.deepEqual((await claim()).tickets, { '5h': 0, day: 0 });
  assert.equal(calls, 2);
  assert.deepEqual((await claim()).tickets, { '5h': 0, day: 0 });
  await s.call('GET', '/api/quests', { token: p.token });
  assert.equal(calls, 2);
});
