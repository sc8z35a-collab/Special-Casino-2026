// Added 5-hour chains: exact rewards, server-authoritative actions and resets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { QUESTS, LEVEL, RULES, evaluate } from '../core/rules.js';
import { stepQuests as advanceQuests, claimQuests, questView } from '../core/quests.js';

const stepQuests = (state, events, now, boost) => advanceQuests(state, events, now, boost, () => 999);

const NOW = Date.UTC(2026, 9, 22, 1);
const FIVE_HOURS = 5 * 3600000;
const CHAINS = [
  { metric: 'spin', prefix: 'spin', previous: 4,
    goals: [20, 30, 40, 50, 60, 70, 80, 90, 100],
    rewards: [25000, 35000, 50000, 75000, 80000, 80000, 80000, 100000, 100000],
    tiers: ['gold', 'gold', 'red', 'red', 'red', 'red', 'red', 'aqua', 'aqua'] },
  { metric: 'snowman', prefix: 'snowman', previous: 0,
    goals: [1, 2, 3, 5, 10], rewards: [10000, 20000, 30000, 50000, 120000],
    tiers: ['purple', 'gold', 'gold', 'red', 'aqua'] },
  { metric: 'barWin', prefix: 'bar', previous: 0,
    goals: [1, 2, 3], rewards: [10000, 15000, 20000], tiers: ['purple', 'purple', 'gold'] },
  { metric: 'revolver5', prefix: 'revolver5-', previous: 0,
    goals: [1, 2, 3, 4, 5], rewards: [5000, 6000, 7000, 8000, 9000],
    tiers: ['blue', 'blue', 'blue', 'blue', 'blue'] },
  { metric: 'casinoSpend', prefix: 'spend', previous: 0,
    goals: [30000, 100000, 200000, 500000, 1000000, 2000000, 3000000],
    rewards: [10000, 20000, 30000, 35000, 65000, 85000, 115000],
    tiers: ['purple', 'gold', 'gold', 'gold', 'red', 'red', 'aqua'] }
];
const questId = (chain, goal) => '5h-' + chain.prefix + (chain.metric === 'casinoSpend'
  ? goal >= 1000000 ? goal / 1000000 + 'm' : goal / 1000 + 'k' : goal);
const fiveHour = (state, now = NOW) => questView(state, now).find(p => p.id === '5h').quests;

test('5-hour chains retain earlier spins and add all 29 requested goals, rewards and tiers', () => {
  assert.deepEqual(QUESTS.chainOf(QUESTS.get('5h-spin1')).slice(0, 4).map(q => [q.goal, q.reward]),
    [[1, 7000], [2, 14000], [5, 20000], [10, 20000]]);
  for (const chain of CHAINS) {
    const steps = QUESTS.chainOf(QUESTS.get(questId(chain, chain.goals[0]))).slice(chain.previous);
    assert.deepEqual(steps.map(q => [q.goal, q.reward]), chain.goals.map((goal, i) => [goal, chain.rewards[i]]));
    assert.deepEqual(steps.map(q => QUESTS.tier(q.reward)), chain.tiers);
    assert.ok(steps.every(q => q.period === '5h' && q.metric === chain.metric && !q.emergency));
  }
});

for (const chain of CHAINS) {
  test(`5-hour ${chain.metric}: cumulative steps, claim once, reset and existing hub multiplier`, () => {
    const state = {};
    let reward = 0;
    let previous = 0;
    const checkpoints = [...new Set(chain.goals.flatMap(goal => [goal - 1, goal]))].filter(n => n > 0).sort((a, b) => a - b);
    for (const count of checkpoints) {
      stepQuests(state, [[chain.metric, count - previous]], NOW);
      previous = count;
      const quests = fiveHour(state);
      for (const goal of chain.goals) {
        const q = quests.find(q => q.id === questId(chain, goal));
        assert.equal(q.progress, Math.min(count, goal));
        assert.equal(q.state, count < goal ? 'open' : count === goal ? 'ready' : 'received');
      }
      const index = chain.goals.indexOf(count);
      if (index < 0) continue;
      const id = questId(chain, count);
      const received = claimQuests(state, [id], NOW);
      assert.deepEqual(received.claimed.map(q => q.id), [id]);
      assert.equal(received.dollars, chain.rewards[index]);
      reward += received.dollars;
      assert.equal(claimQuests(state, [id], NOW).dollars, 0);
    }
    assert.equal(reward, chain.rewards.reduce((sum, n) => sum + n, 0));
    const ids = chain.goals.map(goal => questId(chain, goal));
    assert.ok(fiveHour(state, NOW + FIVE_HOURS).filter(q => ids.includes(q.id))
      .every(q => q.state === 'open' && q.progress === 0));

    const unclaimed = {};
    stepQuests(unclaimed, [[chain.metric, chain.goals[0]]], NOW);
    assert.equal(claimQuests(unclaimed, ids, NOW + FIVE_HOURS).dollars, 0, 'expired rewards cannot be claimed');
    stepQuests(unclaimed, [[chain.metric, 1]], NOW + FIVE_HOURS);
    assert.equal(unclaimed['5h'].m[chain.metric], 1, 'the new period starts its own count');

    const boosted = {};
    stepQuests(boosted, [[chain.metric, 1]], NOW, { '5h': 2.2 });
    assert.equal(boosted['5h'].m[chain.metric], 2.2);
    const last = fiveHour(boosted).find(q => q.id === ids.at(-1));
    assert.equal(last.progress, 2, 'fractional boosted progress is shown as a whole number');
    stepQuests(boosted, [[chain.metric, 1]], NOW, { '5h': 2.2 });
    assert.equal(boosted['5h'].m[chain.metric], 4.4, 'boosted fractions accumulate');
  });
}

test('spin API counts paying BAR once, five guns only, and extends spins through 100', async t => {
  const s = await startServer({ quests: true });
  t.after(() => s.stop());
  const a = await s.register('SpinQuests'), b = await s.register('OtherQuests');
  s.setUser(a.me.id, { tokens: 1000000, dollars: 10000000 });
  const miss = ['bar', 'revolver', 'gold', 'diamond', 'star'];
  const lines = [
    miss,
    ['revolver', 'revolver', 'revolver', 'revolver', 'gold'],
    ['bar', 'gold', 'bar', 'diamond', 'revolver'],
    ['bar', 'bar', 'bar', 'gold', 'diamond'],
    Array(5).fill('bar'),
    ...Array.from({ length: 5 }, () => Array(5).fill('revolver'))
  ];
  t.mock.method(globalThis.BR.engine, 'spin', bet => {
    const line = lines.shift() || miss;
    // BAR on the decorative top/bottom rows never counts as a paying match.
    return { ...evaluate(line, bet), line, grid: line.map(symbol => ['bar', symbol, 'bar']), bet };
  });
  const view = async player => (await s.call('GET', '/api/quests', { token: player.token })).periods.find(p => p.id === '5h').quests;
  for (let n = 1; n <= 100; n++) {
    const r = await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
    assert.equal(r.status, 200, JSON.stringify(r));
    if (n <= 10) {
      const quests = await view(a);
      assert.equal(quests.find(q => q.id === '5h-bar3').progress, Math.max(0, Math.min(3, n - 2)));
      assert.equal(quests.find(q => q.id === '5h-revolver5-5').progress, Math.max(0, n - 5));
    }
    if (CHAINS[0].goals.includes(n)) {
      assert.equal((await view(a)).find(q => q.id === '5h-spin' + n).state, 'ready');
    }
  }
  const ids = CHAINS.filter(c => ['spin', 'barWin', 'revolver5'].includes(c.metric)).flatMap(c => c.goals.map(goal => questId(c, goal)));
  const other = await view(b);
  assert.ok(other.filter(q => ids.includes(q.id)).every(q => q.state === 'open' && q.progress === 0));
  const reward = await s.call('POST', '/api/quests/claim', { token: a.token, body: { ids } });
  assert.equal(reward.status, 200);
  assert.deepEqual(reward.claimed.sort(), ids.sort());
  assert.equal(reward.dollars, 705000);
  assert.equal(reward.balance.dollars, 10705000);
  assert.equal(reward.xp, 100 * LEVEL.spinXp + 17 * LEVEL.questXp);
  assert.equal((await s.call('POST', '/api/quests/claim', { token: a.token, body: { ids } })).dollars, 0);
});

test('snowman API counts only successful sends by the sender, with each specified reward', async t => {
  const s = await startServer({ quests: true });
  t.after(() => s.stop());
  const a = await s.register('SnowSender'), b = await s.register('SnowFriend');
  const send = (to, id = 'snowman') => s.call('POST', '/api/present', { token: a.token, body: { to, id } });
  const snow = async player => (await s.call('GET', '/api/quests', { token: player.token }))
    .periods.find(p => p.id === '5h').quests.find(q => q.id === '5h-snowman10');
  assert.equal((await send(b.me.id)).error.code, 'not_friends');
  await s.befriend(a, b);
  assert.equal((await send(a.me.id)).error.code, 'self');
  assert.equal((await send(b.me.id, 'missing')).error.code, 'bad_present');
  s.setUser(a.me.id, { dollars: 0 });
  assert.equal((await send(b.me.id)).error.code, 'insufficient');
  s.setUser(a.me.id, { dollars: 2000000 });
  assert.equal((await send(b.me.id, 'cookie')).status, 200);
  assert.equal((await snow(a)).progress, 0, 'other presents and failed sends do not count');

  const chain = CHAINS.find(c => c.metric === 'snowman');
  for (let n = 1; n <= 10; n++) {
    const r = await send(b.me.id);
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal((await snow(a)).progress, n, 'count at send time, before the recipient claims');
    if (n === 1) {
      assert.equal((await s.call('POST', '/api/present/claim', { token: b.token, body: { message: r.message.id } })).status, 200);
      assert.equal((await snow(a)).progress, 1, 'claiming the present does not count another send');
    }
    const index = chain.goals.indexOf(n);
    if (index < 0) continue;
    const id = questId(chain, n);
    const reward = await s.call('POST', '/api/quests/claim', { token: a.token, body: { ids: [id] } });
    assert.equal(reward.status, 200, JSON.stringify(reward));
    assert.deepEqual(reward.claimed, [id]);
    assert.equal(reward.dollars, chain.rewards[index]);
    assert.equal(reward.balance.dollars, r.balance.dollars + chain.rewards[index]);
    assert.equal((await s.call('POST', '/api/quests/claim', { token: a.token, body: { ids: [id] } })).dollars, 0);
  }
  assert.equal((await snow(a)).state, 'received');
  assert.equal((await snow(b)).progress, 0, 'receiving a snowman does not count as sending one');
});

test('casino spending counts only successful bets, converted to dollars regardless of payouts', async t => {
  const s = await startServer({ quests: true });
  t.after(() => s.stop());
  const a = await s.register('SpendQuests'), b = await s.register('SpendFriend');
  await s.befriend(a, b);
  s.setUser(a.me.id, { tokens: 1000000, dollars: 10000000 });
  const view = async () => (await s.call('GET', '/api/quests', { token: a.token })).periods.find(p => p.id === '5h').quests;
  assert.equal((await s.call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, currency: 'dollars', amount: 30000 } })).status, 200);
  assert.equal((await s.call('POST', '/api/buy', { token: a.token, body: { amount: 10000 } })).status, 200);
  assert.equal((await view()).find(q => q.id === '5h-spend30k').progress, 0, 'transfers and token purchases are not casino bets');
  const line = Array(5).fill('gold');
  t.mock.method(globalThis.BR.engine, 'spin', bet => ({ ...evaluate(line, bet), line, grid: line.map(s => [s, s, s]), bet }));
  const bets = [1000, 1000, 1000, 5000, 2000, 10000, 20000, 10000, 50000, 100000, 100000];
  let spent = 0;
  for (const bet of bets) {
    const r = await s.call('POST', '/api/spin', { token: a.token, body: { bet, casinoSpend: 999999999 } });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.ok(r.result.total > bet, 'even a profitable spin spends its bet');
    spent += bet * RULES.tokenPrice;
    const quests = await view();
    for (const goal of CHAINS.at(-1).goals) {
      const q = quests.find(q => q.id === questId(CHAINS.at(-1), goal));
      assert.equal(q.progress, Math.min(spent, goal));
      assert.equal(q.state, spent >= goal ? 'ready' : 'open');
    }
  }
  assert.equal(spent, 3000000);
  const ids = CHAINS.at(-1).goals.map(goal => questId(CHAINS.at(-1), goal));
  const paid = await s.call('POST', '/api/quests/claim', { token: a.token, body: { ids } });
  assert.equal(paid.dollars, 360000);
});
