import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('display tasks share one timer, pause hidden tabs, resume once and release the last timer', () => {
  let now = 0, sequence = 0, resume; const timers = new Map(), calls = [];
  const document = { hidden: false, addEventListener: (event, fn) => { resume = fn; } };
  const c = { window: {}, document, Map, console, Date: { now: () => now }, setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
  vm.runInNewContext(fs.readFileSync(new URL('../../js/core/clock.js', import.meta.url), 'utf8'), c);
  const clock = c.window.BR.clock, a = clock.every(() => calls.push('a'), 1000), b = clock.every(() => calls.push('b'), 1000);
  assert.equal(timers.size, 1); now = 1000; const first = [...timers.values()][0]; timers.clear(); first.fn();
  assert.deepEqual(calls, ['a', 'b']); assert.equal(timers.size, 1);
  document.hidden = true; resume(); assert.equal(timers.size, 0);
  now = 60000; document.hidden = false; resume(); assert.deepEqual(calls, ['a', 'b', 'a', 'b']); assert.equal(timers.size, 1);
  clock.drop(a); clock.drop(b); assert.equal(timers.size, 0);
});
