// The サーバー tab: how full the month's allowances are (a colour past 10 /
// 30 / 50 / 70 %) and where the sent bytes went (play, the screen view /
// 観戦 stream, call signalling). server/core/stats.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageTier, createStats } from '../core/stats.js';
import { startServer } from './helpers.js';

test('usage colour: green past 10%, blue past 30%, purple past 50%, red past 70%', () => {
  assert.equal(usageTier(0), '');
  assert.equal(usageTier(10), '');
  assert.equal(usageTier(10.1), 'green');
  assert.equal(usageTier(30), 'green');
  assert.equal(usageTier(30.1), 'blue');
  assert.equal(usageTier(50), 'blue');
  assert.equal(usageTier(50.1), 'purple');
  assert.equal(usageTier(70), 'purple');
  assert.equal(usageTier(70.1), 'red');
  assert.equal(usageTier(250), 'red');
  assert.equal(usageTier(undefined), '');
});

// a throw-away in-memory host for the counters alone
function memoryStats(plan = 'paid') {
  const meta = new Map();
  const db = {
    prepare: (sql) => ({
      get: () => (meta.has('stats') ? { value: meta.get('stats') } : undefined),
      run: (v) => { if (/INSERT INTO meta/.test(sql)) meta.set('stats', v); }
    })
  };
  const q = () => ({ get: () => ({ n: 0 }) });
  return createStats({ db, q, config: { plan }, host: { dbBytes: () => 0 } });
}

test('the breakdown splits the bytes: play, the screen view / 観戦 stream, call signalling', () => {
  const st = memoryStats();
  st.sent(1000);              // an ordinary answer: play
  st.pushed(4000, 'video');   // a screen-view frame
  st.pushed(250, 'voice');    // call signalling
  st.pushed(50);              // anything else pushed: play
  const snap = st.snapshot({ online: 0, operatorsOnline: 0, vault: null });
  assert.deepEqual(snap.breakdown.month, { game: 1050, video: 4000, voice: 250, total: 5300 });
  assert.deepEqual(snap.breakdown.today, { game: 1050, video: 4000, voice: 250, total: 5300 });
  // the live per-second figure counts the stream's bytes on their own
  assert.equal(snap.rate.last10.video, 4000);
  // the month's share and its colour come with the estimate
  assert.equal(typeof snap.estimate.usagePercent, 'number');
  assert.equal(snap.estimate.usageTier, usageTier(snap.estimate.usagePercent));
  assert.ok(Array.isArray(snap.estimate.usageShares));
});

test('GET /api/ops/server carries the usage share, its colour and the breakdown', async () => {
  const s = await startServer();
  try {
    const taku = await s.register('TAKU');
    const r = await s.call('GET', '/api/ops/server', { token: taku.token });
    assert.equal(r.status, 200, JSON.stringify(r).slice(0, 300));
    assert.equal(typeof r.estimate.usagePercent, 'number');
    assert.ok(['', 'green', 'blue', 'purple', 'red'].includes(r.estimate.usageTier));
    for (const k of ['game', 'video', 'voice', 'total']) assert.equal(typeof r.breakdown.month[k], 'number', k);
    // the tab bar's poll carries the colour too (so the button shows it from every tab)
    const c = await s.call('GET', '/api/ops/counts', { token: taku.token });
    assert.equal(c.status, 200, JSON.stringify(c));
    assert.equal(typeof c.usage.percent, 'number');
    assert.equal(c.usage.tier, r.estimate.usageTier);
    // a player cannot read it
    const p = await s.register('ふつうの人');
    assert.equal((await s.call('GET', '/api/ops/server', { token: p.token })).status, 403);
  } finally {
    await s.stop();
  }
});

test('the breakdown counts what is pushed live: a friend\'s 観戦 as 映像通信, the rest as the game\'s own', async () => {
  const s = await startServer();
  try {
    const taku = await s.register('TAKU');
    const a = await s.register('みる人');
    const b = await s.register('みられる人');
    await s.befriend(a, b);
    s.setUser(b.me.id, { tokens: 100000 });
    const la = await s.listen(a), lb = await s.listen(b);
    const read = async () => (await s.call('GET', '/api/ops/server', { token: taku.token })).breakdown.month;
    const before = await read();
    const joined = await s.call('POST', '/api/watch', { token: a.token, body: { user: b.me.id, on: true } });
    assert.equal(joined.status, 200, JSON.stringify(joined));
    for (let i = 0; i < 3; i++) {
      assert.equal((await s.call('POST', '/api/spin', { token: b.token, body: { bet: 100 } })).status, 200);
      await new Promise((r) => setTimeout(r, 1100));
    }
    await la.waitFor('watch', (d) => d.type === 'spin');
    const after = await read();
    assert.ok(after.video > before.video, `映像通信 ${before.video} → ${after.video}`);
    assert.ok(after.video - before.video < 20000, 'a few spins are a few KB, not a video');
    assert.ok(after.game > before.game);
    la.close();
    lb.close();
  } finally {
    await s.stop();
  }
});
