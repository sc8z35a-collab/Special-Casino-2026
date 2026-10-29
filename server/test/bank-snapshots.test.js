import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../js/game/bank.js', import.meta.url), 'utf8');
function scene() {
  const pending = [], state = {};
  function ApiError(status, code, message) { Object.assign(this, { status, code, message }); }
  const api = { online: true, ApiError };
  for (const name of ['spin', 'buy', 'sell', 'daily', 'me']) api[name] = () => new Promise((resolve, reject) => pending.push({ name, resolve, reject }));
  const BR = { api, util: { secondsToUtcMidnight: () => 123 }, CONFIG: { tokenPrice: 1000, dailyLimit: 100 },
    store: { state }, engine: { whole() {} } };
  vm.runInNewContext(source, { window: { BR }, Date, Promise });
  const profile = (rev = 2, id = 1) => ({ id, rev, tokens: 2000, dollars: 100000, coins: 3, dailyReady: false, boughtToday: 80 });
  return { bank: BR.bank, pending, state, profile };
}

test('an older complete profile cannot restore spent daily allowance or a claimed daily gift', () => {
  const s = scene(), latest = s.profile(); s.bank.applyMe(latest);
  s.bank.applyMe({ ...latest, rev: 1, dailyReady: true, boughtToday: 0, dollars: 1 });
  assert.equal(s.state.dollars, latest.dollars);
  assert.equal(s.bank.me(), latest); assert.equal(s.bank.maxBuy(), 20); assert.equal(s.bank.dailyReady(), false);
});

test('a newer complete profile is retained even when a more recent balance-only push already arrived', () => {
  const s = scene(); s.bank.applyMe(s.profile(1));
  s.bank.applyBalance({ tokens: 5000, dollars: 500000, coins: 9, rev: 10 });
  const me = s.profile(5); s.bank.applyMe(me);
  assert.equal(s.bank.me(), me); assert.equal(s.state.rev, 10); assert.equal(s.state.dollars, 500000);
  assert.equal(s.bank.maxBuy(), 20);
});

test('a complete profile passed as a balance cannot apply another account wallet', () => {
  const s=scene(), me=s.profile();s.bank.applyMe(me);s.bank.applyBalance({...s.profile(99,2),dollars:999999});
  assert.equal(s.state.dollars,me.dollars);assert.equal(s.state.rev,me.rev);
});

test('bank reset clears the former account reset deadline, daily counters and cached rules', async () => {
  const s = scene(), request = s.bank.refresh();
  s.pending[0].resolve({ me: { ...s.profile(), dailyReady: true }, now: Date.now(), nextReset: Date.now() + 60000, rules: { dailyLimit: 100 } }); await request;
  s.bank.reset();
  assert.equal(s.bank.ready(), false); assert.equal(s.bank.me(), null); assert.equal(s.bank.rules(), null);
  assert.equal(s.bank.dailyReady(), false); assert.equal(s.bank.secondsToReset(), 123);
});

for (const action of ['refresh', 'buy', 'sell', 'claimDaily', 'spin']) test(`a ${action} callback already queued at logout cannot restore the former account`, async () => {
  const s = scene(), request = s.bank[action](100);
  s.pending[0].resolve({ me: { ...s.profile(50), dollars: 900000 }, balance: { ...s.profile(50), dollars: 900000 }, result: {},
    amount: 100, now: Date.now(), nextReset: Date.now() + 60000, rules: { old: true } });
  // The API already completed, but the bank's continuation has not run yet.
  s.bank.reset(); const next = { ...s.profile(1, 2), dollars: 200000 }; s.bank.applyMe(next);
  await assert.rejects(request, error => error.code === 'session_changed');
  assert.equal(s.bank.me(), next); assert.equal(s.state.dollars, next.dollars); assert.equal(s.bank.ready(), false);
});

test('normal bank actions still update the active account after a reset', async () => {
  const s = scene(); s.bank.applyMe(s.profile(99)); s.bank.reset();
  const fresh = s.profile(1, 2), request = s.bank.refresh();
  s.pending[0].resolve({ me: fresh, now: Date.now(), nextReset: Date.now() + 60000, rules: { fresh: true } });
  await request; assert.equal(s.bank.ready(), true); assert.equal(s.bank.me(), fresh); assert.equal(s.state.rev, 1);
});
