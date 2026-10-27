// Exhaustive, independent arithmetic: five centre-line cells, matches anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, evaluate } from '../core/rules.js';

const choose = [1n, 5n, 10n, 10n, 5n, 1n], D = 1000n ** 5n;
const odds = weights => Object.fromEntries(RULES.symbols.map(s => [s, BigInt(Math.round(weights[s] * 1000))]));
function expected(weights, bet) {
  const w = odds(weights);
  return RULES.symbols.reduce((sum, s) => sum + Object.entries(RULES.pays[s]).reduce((a, [count, mult]) => {
    const n = Number(count);
    return a + choose[n] * w[s] ** BigInt(n) * (1000n - w[s]) ** BigInt(5 - n) * BigInt(Math.floor(bet * mult));
  }, 0n), 0n);
}

for (const [kind, weights, rtp] of [
  ['normal', RULES.weights, 0.819995354206396],
  ['hub', RULES.hub.weights, 1.0774624774111]
]) test(`${kind}: every outcome, payout, tier and exact RTP agree with independent binomial arithmetic`, () => {
  const w = odds(weights);
  assert.equal(Object.values(w).reduce((a, b) => a + b, 0n), 1000n);
  assert.ok(Math.abs(Number(expected(weights, 100)) / Number(D) / 100 - rtp) < 1e-14);
  const sums = RULES.bets.map(() => 0n);
  let mass = 0n;
  for (let i = 0; i < RULES.symbols.length ** 5; i++) {
    let code = i, probability = 1n;
    const line = Array.from({ length: 5 }, () => { const s = RULES.symbols[code % 7]; code = Math.floor(code / 7); probability *= w[s]; return s; });
    mass += probability;
    const wins = RULES.symbols.flatMap(symbol => {
      const cols = line.flatMap((s, index) => s === symbol ? [index] : []), mult = RULES.pays[symbol][cols.length];
      return mult ? [{ symbol, count: cols.length, mult, cols }] : [];
    });
    RULES.bets.forEach((bet, j) => {
      const wanted = wins.map(win => ({ ...win, amount: Math.floor(bet * win.mult) }));
      const total = wanted.reduce((sum, win) => sum + win.amount, 0), mult = wanted.reduce((sum, win) => sum + win.mult, 0);
      const actual = evaluate(line, bet);
      assert.deepEqual(actual.wins, wanted);
      assert.equal(actual.total, total); assert.equal(actual.mult, mult);
      assert.equal(actual.tier, total ? mult >= 15 ? 3 : mult >= 5 ? 2 : 1 : 0);
      sums[j] += BigInt(actual.total) * probability;
    });
  }
  assert.equal(mass, D);
  RULES.bets.forEach((bet, i) => assert.equal(sums[i], expected(weights, bet), `bet ${bet}`));
});

test('draw boundaries and packed grids preserve all symbols without changing payouts', () => {
  const BR = globalThis.BR, original = BR.util.random;
  try {
    for (const weights of [RULES.weights, RULES.hub.weights]) {
      let edge = 0;
      for (const symbol of RULES.symbols) {
        BR.util.random = () => edge + 1e-10;
        assert.equal(BR.engine.drawSymbol(weights), symbol);
        edge += weights[symbol];
        BR.util.random = () => edge - 1e-10;
        assert.equal(BR.engine.drawSymbol(weights), symbol);
      }
    }
    const grid = Array.from({ length: 5 }, (_, i) => [RULES.symbols[i], RULES.symbols[(i + 1) % 7], RULES.symbols[(i + 2) % 7]]);
    const result = BR.engine.whole({ grid: BR.engine.pack(grid) });
    assert.deepEqual(result.grid, grid); assert.deepEqual(result.line, grid.map(col => col[1]));
  } finally { BR.util.random = original; }
});
