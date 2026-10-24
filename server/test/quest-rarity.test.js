import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUESTS } from '../core/rules.js';
import { stepQuests, questView } from '../core/quests.js';

const bands = [
  ['green', 1, 19999], ['blue', 20000, 39999], ['purple', 40000, 69999],
  ['orange', 70000, 99999], ['gold', 100000, 299999], ['red', 300000, 699999],
  ['red-gold', 700000, 999999], ['aqua-purple', 1000000, 1999999], ['dark', 2000000, Number.MAX_SAFE_INTEGER]
];
test('all nine rarity bands cover each exact dollar boundary without gaps', () => {
  for (const [tier, min, max] of bands) {
    assert.equal(QUESTS.tier(min), tier, String(min));
    assert.equal(QUESTS.tier(max), tier, String(max));
  }
  for (const q of QUESTS.list) {
    const expected = bands.find(([, min, max]) => q.reward >= min && q.reward <= max);
    assert.ok(expected, q.id); assert.equal(QUESTS.tier(q.reward), expected[0], q.id);
  }
});
test('normal, PRO and ULTRA tiers use dollar rewards, excluding royal coins and progress', () => {
  const now = Date.now();
  for (const [roll, dollars, tier] of [[999, 7000, 'green'], [1, 21000, 'blue'], [0, 42000, 'purple']]) {
    const state = {}; stepQuests(state, [['spin', 1]], now, null, () => roll);
    const reward = questView(state, now).find(p => p.id === '5h').quests.find(q => q.id === '5h-spin1').reward;
    const payout = reward ? reward.dollars : QUESTS.get('5h-spin1').reward;
    assert.equal(payout, dollars); assert.equal(QUESTS.tier(payout), tier);
  }
});
