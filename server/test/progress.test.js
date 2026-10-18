// Quests, the player level, バイト and the update bonus: npm test (from the repository root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { QUESTS, LEVEL, RELEASE, RULES } from '../core/rules.js';
import { stepQuests, claimQuests, questsReady } from '../core/quests.js';

const H = 3600000;
const ids = (r) => r.done.map((q) => q.id).sort();

test('quest periods start 2026-10-18 9:00 Japan time: every 5 h, day, week, month (18th), 3 months', () => {
  const t = Date.UTC(2026, 9, 18, 6, 30);   // 15:30 in Japan
  assert.deepEqual(QUESTS.range('5h', t), { k: 1, start: Date.UTC(2026, 9, 18, 5), end: Date.UTC(2026, 9, 18, 10) });
  assert.equal(QUESTS.range('day', t).end, Date.UTC(2026, 9, 19));
  assert.equal(QUESTS.range('week', t).end, Date.UTC(2026, 9, 25));
  assert.equal(QUESTS.range('month', Date.UTC(2026, 10, 17, 23)).end, Date.UTC(2026, 10, 18));
  assert.equal(QUESTS.range('special', Date.UTC(2027, 0, 17)).end, Date.UTC(2027, 0, 18));
  assert.equal(QUESTS.range('special', Date.UTC(2027, 0, 18)).end, Date.UTC(2027, 3, 18));
  assert.deepEqual([2000, 5000, 10000, 20000, 50000, 100000, 1000000].map(QUESTS.tier), ['gray', 'blue', 'purple', 'gold', 'red', 'aqua', 'prism']);
  assert.deepEqual([0, 99, 100, 299, 300, 600].map(LEVEL.of), [1, 1, 2, 2, 3, 4]);
});

test('quests: progress shared between periods; finished ones wait to be received, once a period', () => {
  const st = {};
  const now = Date.UTC(2026, 9, 18, 1);
  let r = stepQuests(st, [['spin', 1], ['earn', 15000]], now);
  assert.deepEqual(ids(r), ['5h-earn10k', '5h-spin1']);
  assert.equal(questsReady(st, now), 2);
  assert.deepEqual(ids(stepQuests(st, [['spin', 1]], now)), ['5h-spin2']);
  // 受け取る: one, then the rest (一括受け取り)
  let c = claimQuests(st, ['5h-spin1'], now);
  assert.deepEqual([c.claimed.map((q) => q.id), c.dollars], [['5h-spin1'], 7000]);
  c = claimQuests(st, null, now);
  assert.deepEqual([c.claimed.length, c.dollars], [2, 15000 + 14000]);
  assert.equal(claimQuests(st, null, now).claimed.length, 0, 'never twice');
  assert.equal(stepQuests(st, [['peek', 1]], now).done.length, 1);
  assert.equal(stepQuests(st, [['peek', 1]], now).changed, false, 'finished: not counted again');
  // one transfer counts for the daily and the monthly quest ($ and spin tokens)
  r = stepQuests(st, [['sent', 100000]], now);
  assert.deepEqual(ids(r), ['day-send1k', 'month-send100k']);
  c = claimQuests(st, ['day-send1k', 'month-send100k'], now);
  assert.deepEqual([c.dollars, c.tokens], [5000, 30000]);
  assert.equal(st.special.m.clear, 6, 'every finished quest counts towards クエストを100個クリアする');
  // five hours on, the 5時間 quests start over (what was not received is gone); the day's do not
  r = stepQuests(st, [['spin', 1], ['sent', 1000]], now + 5 * H);
  assert.deepEqual(ids(r), ['5h-spin1']);
  assert.equal(questsReady(st, now + 5 * H), 1);
});

test('server: quests finish on spins, 送金 and 無一文, and pay when received', async () => {
  const m = await startServer({ quests: true });
  try {
    const a = await m.register('Quester'), b = await m.register('Questee');
    await m.befriend(a, b);
    m.setUser(a.me.id, { tokens: 10000, dollars: 1000000 });
    const spun = await m.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
    assert.equal(spun.status, 200, JSON.stringify(spun));
    assert.equal(spun.xp, LEVEL.spinXp);
    let q = await m.call('GET', '/api/quests', { token: a.token });
    const five = q.periods.find((p) => p.id === '5h');
    assert.equal(five.quests.find((x) => x.id === '5h-spin1').state, 'ready');
    assert.equal(five.quests.find((x) => x.id === '5h-spin2').progress, 1);
    assert.ok(q.ready >= 1);
    assert.equal((await m.call('GET', '/api/me', { token: a.token })).me.dollars, 1000000, 'nothing paid before 受け取る');
    let c = await m.call('POST', '/api/quests/claim', { token: a.token, body: { ids: ['5h-spin1'] } });
    assert.deepEqual([c.claimed, c.dollars, c.xp, c.balance.dollars], [['5h-spin1'], 7000, LEVEL.spinXp + LEVEL.questXp, 1007000]);
    // 送金 in tokens counts at the token price
    await m.call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 100, currency: 'tokens' } });
    q = await m.call('GET', '/api/quests', { token: a.token });
    assert.equal(q.periods.find((p) => p.id === 'day').quests.find((x) => x.id === 'day-send1k').state, 'ready');
    // nearly broke (tokens counted at their price): 無一文になってしまう, once
    m.setUser(a.me.id, { dollars: 0, tokens: 1000 });
    await m.call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 10, currency: 'tokens' } });
    c = await m.call('POST', '/api/quests/claim', { token: a.token, body: {} });
    assert.ok(c.claimed.includes('special-broke'), JSON.stringify(c.claimed));
    assert.equal(c.balance.tokens, 990 + 1000000);
    m.setUser(a.me.id, { dollars: 0, tokens: 1000 });
    await m.call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 10, currency: 'tokens' } });
    assert.ok(!(await m.call('POST', '/api/quests/claim', { token: a.token, body: {} })).claimed.includes('special-broke'));
    // other players see the level
    const me = (await m.call('GET', '/api/me', { token: a.token })).me;
    assert.equal((await m.call('GET', `/api/user?id=${a.me.id}`, { token: b.token })).user.level, LEVEL.of(me.xp));
  } finally {
    await m.stop();
  }
});

test('beginner guide: everyone under 30 minutes of play, until they finish it', async () => {
  const { call, register, setUser, stop } = await startServer();
  try {
    const a = await register('Newbie');
    assert.equal(a.me.guide, true);
    setUser(a.me.id, { play_ms: 31 * 60000 });
    assert.equal((await call('GET', '/api/me', { token: a.token })).me.guide, false);
    setUser(a.me.id, { play_ms: 0 });
    assert.equal((await call('POST', '/api/guide', { token: a.token })).me.guide, false);
    assert.equal((await call('GET', '/api/me', { token: a.token })).me.guide, false);
  } finally {
    await stop();
  }
});

test('バイト: $20 000 an hour, paid for the time worked; switching pays up', async () => {
  const { call, register, setUser, stop } = await startServer();
  try {
    const a = await register('Worker');
    assert.equal((await call('POST', '/api/jobs/start', { token: a.token, body: { id: 'nope' } })).error.code, 'bad_job');
    let r = await call('POST', '/api/jobs/start', { token: a.token, body: { id: 'garage' } });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.deepEqual(r.working.map((j) => j.id), ['garage']);
    assert.equal((await call('POST', '/api/jobs/start', { token: a.token, body: { id: 'garage' } })).error.code, 'working');
    const before = (await call('GET', '/api/me', { token: a.token })).me.dollars;
    setUser(a.me.id, { jobs: JSON.stringify([{ id: 'garage', since: Date.now() - 1.5 * H }]) });
    r = await call('POST', '/api/jobs/collect', { token: a.token });
    assert.ok(r.paid >= 30000 && r.paid < 30050, String(r.paid));
    assert.equal((await call('GET', '/api/me', { token: a.token })).me.dollars, before + r.paid);
    assert.equal((await call('POST', '/api/jobs/collect', { token: a.token })).paid, 0);
    r = await call('POST', '/api/jobs/stop', { token: a.token, body: { id: 'garage' } });
    assert.deepEqual(r.working, []);
    assert.equal(RULES.jobs[0].wage, 20000);
  } finally {
    await stop();
  }
});

test('update bonus: $250 000 once per release for players who update; new players start on it', async () => {
  const { call, register, setUser, stop } = await startServer();
  try {
    const a = await register('Updater');
    assert.deepEqual(await call('POST', '/api/release', { token: a.token, body: { release: RELEASE } }).then((r) => [r.bonus, r.outdated]), [0, false]);
    setUser(a.me.id, { release_seen: RELEASE - 1 });
    assert.equal((await call('POST', '/api/release', { token: a.token, body: { release: RELEASE - 1 } })).outdated, true);
    const before = (await call('GET', '/api/me', { token: a.token })).me.dollars;
    const r = await call('POST', '/api/release', { token: a.token, body: { release: RELEASE } });
    assert.deepEqual([r.bonus, r.me.dollars], [250000, before + 250000]);
    assert.equal((await call('POST', '/api/release', { token: a.token, body: { release: RELEASE } })).bonus, 0);
  } finally {
    await stop();
  }
});
