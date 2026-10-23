import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { QUESTS, LEVEL, RULES, evaluate } from '../core/rules.js';
import { stepQuests, claimQuests, questView, readQuests } from '../core/quests.js';

const HOUR = 3600000, DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 22, 12);
const advance = (s, e, now = NOW, roll = () => 999) => stepQuests(s, e, now, null, roll);
const quest = (view, id) => view.flatMap(p => p.quests).find(q => q.id === id);
const getQuests = (s, a) => s.call('GET', '/api/quests', { token: a.token });

test('daily income accumulates dollar payouts within one day and all eight new thresholds pay their specified rewards', () => {
  const state = {};
  advance(state, [['earn', 2e6]]);
  assert.equal(quest(questView(state, NOW), 'day-earn2.5m').progress, 2e6);
  advance(state, [['earn', 499999]]);
  assert.equal(quest(questView(state, NOW), 'day-earn2.5m').state, 'open');
  advance(state, [['earn', 1]]);
  assert.equal(quest(questView(state, NOW), 'day-earn2.5m').state, 'ready');
  advance(state, [['earn', 7.5e6]]);
  const ids = ['2.5m', '3m', '3.5m', '4m', '5m', '7m', '9m', '10m'].map(x => 'day-earn' + x);
  const paid = claimQuests(state, ids, NOW);
  assert.deepEqual(paid.rewards.map(x => x.dollars), [7000, 10000, 16000, 26000, 35000, 46000, 56000, 60000]);
  assert.equal(claimQuests(state, ids, NOW).dollars, 0);
  advance(state, [['earn', 100]], QUESTS.range('day', NOW).end);
  assert.equal(quest(questView(state, QUESTS.range('day', NOW).end), ids[0]).progress, 100);
  assert.equal(state.special.m.earn, 10000100, 'lifetime income survives a daily reset');
});

test('new fruit and friend daily STEPs share existing chains and retain completion-time PRO/ULTRA rewards', () => {
  const state = {};
  advance(state, [['watermelon', 1], ['melon', 1], ['friend', 1]]);
  const goals = { watermelon: [2, 3, 5], melon: [2, 3, 5], friend: [2, 3] };
  const rewards = { watermelon: [40000, 50000, 60000], melon: [60000, 70000, 80000], friend: [200000, 300000] };
  for (const metric of Object.keys(goals)) {
    advance(state, [[metric, metric === 'friend' ? 2 : 4]], NOW, () => metric === 'watermelon' ? 0 : 1);
    const ids = goals[metric].map(n => 'day-' + metric + n);
    const multiplier = metric === 'watermelon' ? 6 : 3;
    const result = claimQuests(state, ids, NOW);
    assert.deepEqual(result.rewards.map(x => x.dollars), rewards[metric].map(x => x * multiplier));
    assert.equal(result.coins, metric === 'watermelon' ? 24 : 0);
  }
});

test('daily fruit and friend additions count only completed actions through their existing APIs', async t => {
  const s = await startServer({ quests: true }); t.after(() => s.stop());
  const a = await s.register('FruitQuests');
  const friends = [];
  for (let i = 0; i < 3; i++) {
    const b = await s.register('FruitFriend' + i); friends.push(b); await s.befriend(a, b);
  }
  s.setUser(a.me.id, { tokens: 100000 });
  const to = friends[0].me.id;
  const invalid = await s.call('POST', '/api/tip', { token: a.token, body: { to, fruits: { watermelon: 5, melon: 5 } } });
  assert.equal(invalid.error.code, 'not_watching');
  assert.equal(quest((await getQuests(s, a)).periods, 'day-watermelon2').progress, 0);
  await s.call('POST', '/api/watch', { token: a.token, body: { user: to, on: true } });
  const sent = await s.call('POST', '/api/tip', { token: a.token, body: { to, fruits: { watermelon: 5, melon: 5 } } });
  assert.equal(sent.status, 200, JSON.stringify(sent));
  const view = await getQuests(s, a);
  for (const metric of ['melon', 'watermelon']) for (const n of [2, 3, 5]) assert.equal(quest(view.periods, 'day-' + metric + n).state, 'ready');
  for (const n of [2, 3]) assert.equal(quest(view.periods, 'day-friend' + n).state, 'ready');
});

test('casino API converts payouts to dollars, excludes bets and quest rewards, and preserves lifetime totals across days', async t => {
  const s = await startServer({ quests: true }); t.after(() => s.stop());
  const a = await s.register('DailyIncome');
  let now = NOW; t.mock.method(Date, 'now', () => now);
  s.setUser(a.me.id, { tokens: 1e7 });
  const line = ['bar', 'bar', 'gold', 'diamond', 'revolver'];
  t.mock.method(globalThis.BR.engine, 'spin', bet => ({ ...evaluate(line, bet), line, grid: line.map(x => [x, x, x]), total: 125000, bet }));
  for (let i = 0; i < 2; i++) assert.equal((await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } })).status, 200);
  let view = await getQuests(s, a);
  assert.equal(quest(view.periods, 'day-earn2.5m').state, 'ready');
  assert.equal(quest(view.periods, 'day-earn3m').progress, 2500000);
  await s.call('POST', '/api/quests/claim', { token: a.token, body: { ids: ['day-earn2.5m'] } });
  assert.equal(quest((await getQuests(s, a)).periods, 'day-earn3m').progress, 2500000);
  now = QUESTS.range('day', now).end;
  view = await getQuests(s, a);
  assert.equal(quest(view.periods, 'day-earn2.5m').progress, 0, 'GET reconciliation never credits historical income to daily');
  assert.equal(quest(view.periods, 'special-earn50m').progress, 2500000);
});

test('existing level, earned VIP ranks and lifetime income qualify once; all VIP rank STEPs form one chain', async t => {
  const s = await startServer({ quests: true }); t.after(() => s.stop());
  const a = await s.register('Milestones');
  s.setUser(a.me.id, { xp: LEVEL.at(50), vip_exp: 14800, vip_until: NOW - DAY, total_won: 500e6 / RULES.tokenPrice });
  let view = await getQuests(s, a);
  const groups = [
    [['level10', 'level20', 'level30', 'level40', 'level50'], [125000, 220000, 650000, 1200000, 3000000]],
    [['vip1', 'vip2', 'vip3', 'vip3.1', 'vip4'], [250000, 500000, 750000, 1000000, 2000000]],
    [['earn50m', 'earn200m', 'earn500m'], [300000, 1000000, 3000000]]
  ];
  for (const [suffixes, rewards] of groups) {
    const ids = suffixes.map(x => 'special-' + x);
    for (const id of ids) assert.equal(quest(view.periods, id).state, 'ready');
    const paid = await s.call('POST', '/api/quests/claim', { token: a.token, body: { ids } });
    assert.deepEqual(paid.rewards.map(x => x.dollars), rewards);
  }
  const vip = QUESTS.chainOf(QUESTS.get('special-vip1'));
  assert.deepEqual(vip.map(x => x.id), ['special-vip1', 'special-vip2', 'special-vip3', 'special-vip3.1', 'special-vip4']);
  assert.equal(quest(view.periods, 'day-earn2.5m').progress, 0);
  view = await getQuests(s, a);
  assert.equal(quest(view.periods, 'special-vip4').state, 'received');
  assert.deepEqual(view.tickets, { '5h': 0, day: 0 }, 'existing levels do not grant retroactive reset tickets');
});

test('first VIP use is achieved by trial but the borrowed trial rank never qualifies as an earned VIP rank', async t => {
  const s = await startServer({ quests: true, questRewardRoll: () => 0 }); t.after(() => s.stop());
  const a = await s.register('TrialQuest');
  const trial = await s.call('POST', '/api/vip/trial', { token: a.token });
  assert.equal(trial.status, 200);
  const view = await getQuests(s, a);
  assert.equal(quest(view.periods, 'special-vip-first').state, 'ready');
  assert.equal(quest(view.periods, 'special-vip-first').reward.mode, 'ultra');
  assert.equal(quest(view.periods, 'special-vip1').state, 'open');
  assert.equal(QUESTS.get('special-vip-first').text, 'VIPを初めて使う');
  const paid = await s.call('POST', '/api/quests/claim', { token: a.token, body: { ids: ['special-vip-first'] } });
  assert.deepEqual([paid.dollars, paid.coins], [270000, 8]);
  await s.call('GET', '/api/me', { token: a.token });
  assert.equal(quest((await getQuests(s, a)).periods, 'special-vip-first').state, 'received');
});

test('level milestones become ready immediately after XP from a spin or reward claim crosses a threshold', async t => {
  const s = await startServer({ quests: true }); t.after(() => s.stop());
  const a = await s.register('LevelSpin');
  s.setUser(a.me.id, { xp: LEVEL.at(10) - 1, tokens: 1000 });
  const line = ['bar', 'revolver', 'gold', 'diamond', 'star'];
  t.mock.method(globalThis.BR.engine, 'spin', bet => ({ ...evaluate(line, bet), line, grid: line.map(x => [x, x, x]), bet }));
  await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
  let stored = readQuests(s.app.db.prepare('SELECT quests FROM users WHERE id = ?').get(a.me.id).quests);
  assert.ok(stored.special.c.includes('special-level10'));
  s.setUser(a.me.id, { xp: LEVEL.at(20) - LEVEL.questXp });
  const paid = await s.call('POST', '/api/quests/claim', { token: a.token, body: { ids: ['special-level10'] } });
  assert.equal(quest(paid.periods, 'special-level20').state, 'ready');
  assert.ok(!paid.claimed.includes('special-level20'), 'newly achieved STEP waits for a subsequent claim');
});

test('successful car purchases accumulate through five STEPs; errors and gifts never count as a purchase', async t => {
  const s = await startServer({ quests: true }); t.after(() => s.stop());
  const a = await s.register('CarQuests'), b = await s.register('CarReceiver');
  await s.befriend(a, b);
  s.setUser(a.me.id, { dollars: 1000e6, garage_extra: 5 });
  const bad = await s.call('POST', '/api/cars/buy', { token: a.token, body: { model: 'two-state-sedan', price: 1 } });
  assert.equal(bad.error.code, 'price_changed');
  const cars = [];
  for (let i = 0; i < 5; i++) {
    const bought = await s.call('POST', '/api/cars/buy', { token: a.token, body: { model: 'two-state-sedan' } });
    assert.equal(bought.status, 200, JSON.stringify(bought)); cars.push(bought.car.id);
  }
  const view = await getQuests(s, a);
  for (let n = 1; n <= 5; n++) assert.equal(quest(view.periods, 'special-car' + n).state, 'ready');
  const paid = await s.call('POST', '/api/quests/claim', { token: a.token, body: { ids: [1, 2, 3, 4, 5].map(n => 'special-car' + n) } });
  assert.deepEqual(paid.rewards.map(x => x.dollars), [100000, 250000, 500000, 750000, 750000]);
  const gift = await s.call('POST', '/api/cars/gift', { token: a.token, body: { car: cars[0], to: b.me.id } });
  assert.equal(gift.status, 200, JSON.stringify(gift));
  assert.equal(quest((await getQuests(s, b)).periods, 'special-car1').progress, 0);
  s.setUser(b.me.id, { dollars: 1000e6 });
  const cost = s.app.db.prepare('SELECT paid FROM cars WHERE id = ?').get(cars[1]).paid;
  const offer = await s.call('POST', '/api/cars/offer', { token: a.token, body: { car: cars[1], to: b.me.id, price: cost } });
  assert.equal(offer.status, 200, JSON.stringify(offer));
  const purchase = await s.call('POST', '/api/cars/offer/buy', { token: b.token, body: { id: offer.message.id } });
  assert.equal(purchase.status, 200, JSON.stringify(purchase));
  assert.equal(quest((await getQuests(s, b)).periods, 'special-car1').state, 'ready');
  assert.equal((await s.call('POST', '/api/cars/offer/buy', { token: b.token, body: { id: offer.message.id } })).error.code, 'done');
  assert.equal(quest((await getQuests(s, b)).periods, 'special-car2').progress, 1);
});
