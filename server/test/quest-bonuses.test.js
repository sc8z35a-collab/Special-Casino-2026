// The lottery belongs to a completed STEP; claiming never draws again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { QUESTS, LEVEL, evaluate } from '../core/rules.js';
import { stepQuests, claimQuests, questView, readQuests, questBonuses } from '../core/quests.js';

const NOW = Date.UTC(2026, 9, 22, 1);
const view = (state, id, now = NOW) => questView(state, now).flatMap(p => p.quests).find(q => q.id === id);

test('bonus draw is exclusive: exactly 0.1% ULTRA, 5% PRO and 94.9% normal', () => {
  const counts = { normal: 0, pro: 0, ultra: 0 };
  for (let roll = 0; roll < 1000; roll++) {
    const state = {};
    let draws = 0;
    stepQuests(state, [['spin', 1]], NOW, null, () => { draws++; return roll; });
    assert.equal(draws, 1);
    const quest = view(state, '5h-spin1');
    const mode = quest.reward?.mode || 'normal';
    const multiplier = mode === 'ultra' ? 6 : mode === 'pro' ? 3 : 1;
    counts[mode]++;
    assert.equal(quest.state, 'ready');
    if (mode !== 'normal') {
      assert.equal(quest.reward.dollars, 7000 * multiplier, 'actual reward is visible before claiming');
      assert.equal(quest.reward.coins, mode === 'ultra' ? 8 : 0);
    }
    const paid = claimQuests(state, null, NOW);
    assert.equal(paid.dollars, 7000 * multiplier);
    assert.equal(paid.coins, mode === 'ultra' ? 8 : 0);
  }
  assert.deepEqual(counts, { normal: 949, pro: 50, ultra: 1 });
});

test('each STEP gets its own saved result, including several completed by one boosted action', () => {
  const state = {};
  const rolls = [1, 0, 999];
  let draws = 0;
  const draw = () => rolls[draws++];
  stepQuests(state, [['spin', 1]], NOW, { '5h': 2 }, draw);
  assert.equal(view(state, '5h-spin1').reward.mode, 'pro');
  assert.equal(view(state, '5h-spin2').reward.mode, 'ultra');
  assert.equal(view(state, '5h-spin5').reward, undefined, 'next open step does not inherit a bonus');
  stepQuests(state, [['spin', 1]], NOW, null, draw);
  assert.equal(draws, 2, 'progress and already finished steps never draw again');
  const restored = readQuests(JSON.stringify(state));
  assert.deepEqual(questView(restored, NOW), questView(state, NOW));
  const paid = claimQuests(restored, null, NOW);
  assert.equal(paid.dollars, 105000);
  assert.equal(paid.coins, 8);
  assert.deepEqual(paid.rewards.map(r => r.mode), ['pro', 'ultra']);
  assert.equal(claimQuests(restored, null, NOW).coins, 0);
  stepQuests(restored, [['spin', 2]], NOW, null, draw);
  assert.equal(view(restored, '5h-spin5').reward, undefined, 'normal next step has no prior multiplier');
  assert.equal(claimQuests(restored, ['5h-spin5'], NOW).dollars, 20000);
  assert.equal(draws, 3);
});

test('bonuses cover every quest period, legacy completions stay normal, and expired bonuses pay nothing', () => {
  const state = {};
  stepQuests(state, [['spin', 1], ['sent', 100000], ['watermelon', 3], ['coopEarn', 1000000], ['earn', 1000000]], NOW, null, () => 1);
  for (const period of questView(state, NOW)) {
    const completed = period.quests.filter(q => q.state === 'ready');
    assert.ok(completed.length > 0, period.id);
    assert.ok(completed.every(q => q.reward.mode === 'pro'), period.id);
  }
  const legacy = { '5h': { k: QUESTS.range('5h', NOW).k, m: { spin: 1 }, c: ['5h-spin1'], d: [] } };
  const base = claimQuests(legacy, null, NOW);
  assert.deepEqual([base.dollars, base.coins, base.rewards[0].mode], [7000, 0, 'normal']);
  const expired = {};
  stepQuests(expired, [['spin', 1]], NOW, null, () => 0);
  const later = NOW + 5 * 3600000;
  const paid = claimQuests(expired, null, later);
  assert.deepEqual([paid.dollars, paid.coins], [0, 0]);
  stepQuests(expired, [['spin', 1]], later, null, () => 999);
  assert.equal(view(expired, '5h-spin1', later).reward, undefined, 'period reset clears the old ULTRA');
});

for (const bulk of [false, true]) {
  test(`API ${bulk ? 'bulk' : 'individual'} claims use saved bonuses and pay royal coins once`, async t => {
    let draws = 0;
    const s = await startServer({ quests: true, questRewardRoll: () => [1, 0, 999][draws++] ?? 999 });
    t.after(() => s.stop());
    const a = await s.register(bulk ? 'BulkBonus' : 'SoloBonus');
    s.setUser(a.me.id, { tokens: 10000, dollars: 1000000 });
    const line = ['bar', 'revolver', 'gold', 'diamond', 'star'];
    t.mock.method(globalThis.BR.engine, 'spin', bet => ({ ...evaluate(line, bet), line, grid: line.map(s => [s, s, s]), bet }));
    const spin = () => s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
    await spin(); await spin();
    const getQuests = () => s.call('GET', '/api/quests', { token: a.token });
    const snapshot = await getQuests();
    assert.deepEqual(snapshot.bonuses['5h'], { pro: 1, ultra: 1 });
    const pending = snapshot.periods.find(p => p.id === '5h').quests;
    assert.equal(pending.find(q => q.id === '5h-spin1').reward.mode, 'pro');
    assert.equal(pending.find(q => q.id === '5h-spin2').reward.mode, 'ultra');
    assert.equal((await s.call('GET', '/api/me', { token: a.token })).me.coins, a.me.coins, 'no coins before claiming');
    const claim = ids => s.call('POST', '/api/quests/claim', { token: a.token, body: { ids, multiplier: 99, coins: 9999 } });
    if (bulk) {
      const replies = await Promise.all([claim(null), claim(null)]);
      assert.deepEqual(replies.map(r => r.dollars).sort((a, b) => a - b), [0, 105000]);
      assert.deepEqual(replies.map(r => r.coins).sort((a, b) => a - b), [0, 8]);
      assert.deepEqual(replies.find(r => r.claimed.length).rewards.map(r => r.mode), ['pro', 'ultra']);
    } else {
      const pro = await claim(['5h-spin1']);
      assert.deepEqual([pro.dollars, pro.coins], [21000, 0]);
      const ultra = await claim(['5h-spin2']);
      assert.deepEqual([ultra.dollars, ultra.coins], [84000, 8]);
    }
    const duplicate = await claim(null);
    assert.deepEqual([duplicate.dollars, duplicate.coins], [0, 0]);
    assert.equal(duplicate.bonuses['5h'], undefined);
    assert.equal(draws, 2, 'GET, claim and retries do not draw again');
    const me = (await s.call('GET', '/api/me', { token: a.token })).me;
    assert.deepEqual([me.dollars, me.coins, me.xp], [1105000, a.me.coins + 8, 2 * LEVEL.spinXp + 2 * LEVEL.questXp]);
    await spin(); await spin(); await spin();
    const normal = await claim(['5h-spin5']);
    assert.deepEqual([normal.dollars, normal.coins], [20000, 0]);
    assert.equal(draws, 3, 'only the new STEP draws');
  });
}

test('bulk claims add eight royal coins for every ULTRA STEP', () => {
  const state = {};
  stepQuests(state, [['spin', 1], ['chat', 1]], NOW, null, () => 0);
  const paid = claimQuests(state, null, NOW);
  assert.equal(paid.dollars, (7000 + 5000) * 6);
  assert.equal(paid.coins, 16);
  assert.equal(claimQuests(state, null, NOW).coins, 0);
});


test('quest bonus badge counts include only waiting STEPs in each current period, and clear after claims or rollover', () => {
  const state = {};
  stepQuests(state, [['spin', 1]], NOW, null, () => 1);
  stepQuests(state, [['sent', 100000]], NOW, null, () => 0);
  let summary = questBonuses(state, NOW);
  assert.deepEqual(summary['5h'], { pro: 1 });
  assert.ok(summary.day.ultra > 0);
  const day = summary.day.ultra;
  claimQuests(state, ['5h-spin1'], NOW);
  summary = questBonuses(state, NOW);
  assert.equal(summary['5h'], undefined, 'none: left out');
  assert.equal(summary.day.ultra, day);
  const later = NOW + 32 * 86400000;
  assert.equal(questBonuses(state, later).day, undefined);
  claimQuests(state, null, NOW);
  assert.deepEqual(questBonuses(state, NOW), {});
});
