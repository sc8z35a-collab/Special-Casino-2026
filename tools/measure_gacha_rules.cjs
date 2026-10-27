/* Compare shared draw rules with a git revision: node tools/measure_gacha_rules.cjs <before-ref>.
   Pure calculation only; no accounts, payments, transport or animation are involved. */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ref = process.argv[2];
if (!ref) throw new Error('Pass the git revision to compare');
function load(source) { const context = vm.createContext({}); vm.runInContext(source, context); return context.BR.GACHA; }
const before = load(execFileSync('git', ['show', ref + ':js/game/gacha.js'], { cwd: ROOT, encoding: 'utf8' }));
const after = load(fs.readFileSync(path.join(ROOT, 'js/game/gacha.js'), 'utf8'));
const kinds = ['rare', 'legendary', 'secret'];
function random(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
let scenarios = 0;
for (const kind of kinds) for (const count of [1, 3, 10]) for (const boost of [false, true]) for (const bonus of [false, true]) for (let seed = 1; seed <= 25; seed++) {
  assert.equal(JSON.stringify(after.draw(kind, count, boost, bonus, random(seed))), JSON.stringify(before.draw(kind, count, boost, bonus, random(seed)))); scenarios++;
}
function run(rules, count) {
  const rand = random(123), start = performance.now();
  for (let i = 0; i < count; i++) rules.draw(kinds[i % 3], 10, !!(i % 2), i % 7 === 0, rand);
  return performance.now() - start;
}
run(before, 500); run(after, 500);
const times = { before: [], after: [] };
for (let i = 0; i < 7; i++) {
  for (const key of i % 2 ? ['after', 'before'] : ['before', 'after']) times[key].push(run(key === 'before' ? before : after, 10000));
}
const median = (values) => [...values].sort((a, b) => a - b)[3];
const report = { baselineCommit: ref, equivalentSeededScenarios: scenarios, bundlesPerSample: 10000, slotsPerBundle: 30, samples: 7,
  beforeMs: median(times.before), afterMs: median(times.after) };
report.fasterPercent = (1 - report.afterMs / report.beforeMs) * 100;
console.log(JSON.stringify(report, null, 2));
