// Quests, the player level, バイト and the update bonus: npm test (from the repository root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { QUESTS, LEVEL, RELEASE, RULES } from '../core/rules.js';
import { stepQuests } from '../core/quests.js';

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

test('quests: progress shared between periods, each pays once until its period starts over', () => {
  const st = {};
  const now = Date.UTC(2026, 9, 18, 1);
  let r = stepQuests(st, [['spin', 1], ['earn', 15000]], now);
  assert.deepEqual(ids(r), ['5h-earn10k', '5h-spin1']);
  assert.deepEqual([r.dollars, r.tokens], [7000 + 15000, 0]);
  assert.deepEqual(ids(stepQuests(st, [['spin', 1]], now)), ['5h-spin2']);
  assert.equal(stepQuests(st, [['peek', 1]], now).done.length, 1);
  assert.equal(stepQuests(st, [['peek', 1]], now).changed, false, 'done: not counted again');
  // one transfer counts for the daily and the monthly quest
  r = stepQuests(st, [['sent', 100000]], now);
  assert.deepEqual(ids(r), ['day-send1k', 'month-send100k']);
  assert.deepEqual([r.dollars, r.tokens], [5000, 30000]);
  assert.equal(st.special.m.clear, 6, 'every finished quest counts towards クエストを100個クリアする');
  // five hours on, the 5時間 quests start over; the day's do not
  r = stepQuests(st, [['spin', 1], ['sent', 1000]], now + 5 * H);
  assert.deepEqual(ids(r), ['5h-spin1']);
});

test('server: quests and XP on spins, 送金 and 無一文, the quest list', async () => {
  const m = await startServer({ quests: true });
  try {
    const a = await m.register('Quester'), b = await m.register('Questee');
    await m.befriend(a, b);
    m.setUser(a.me.id, { tokens: 10000, dollars: 1000000 });
    let r = await m.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
    assert.equal(r.status, 200, JSON.stringify(r));
    const q = await m.call('GET', '/api/quests', { token: a.token });
    const five = q.periods.find((p) => p.id === '5h');
    assert.equal(five.quests.find((x) => x.id === '5h-spin1').done, true);
    assert.equal(five.quests.find((x) => x.id === '5h-spin2').progress, 1);
    assert.equal(q.xp, r.xp);
    assert.ok(r.xp >= LEVEL.spinXp + LEVEL.questXp);
    let me = (await m.call('GET', '/api/me', { token: a.token })).me;
    assert.ok(me.dollars >= 1000000 + 7000, 'カジノを回す pays $7 000');
    // 送金 in tokens counts at the token price
    r = await m.call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 100, currency: 'tokens' } });
    assert.equal(r.status, 200);
    const day = (await m.call('GET', '/api/quests', { token: a.token })).periods.find((p) => p.id === 'day');
    assert.equal(day.quests.find((x) => x.id === 'day-send1k').done, true);
    // nearly broke (tokens counted at their price): 無一文になってしまう pays 1 000 000 tokens once
    m.setUser(a.me.id, { dollars: 0, tokens: 1000 });
    await m.call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 10, currency: 'tokens' } });
    me = (await m.call('GET', '/api/me', { token: a.token })).me;
    assert.equal(me.tokens, 990 + 1000000);
    m.setUser(a.me.id, { dollars: 0, tokens: 1000 });
    await m.call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 10, currency: 'tokens' } });
    assert.equal((await m.call('GET', '/api/me', { token: a.token })).me.tokens, 990);
    // other players see the level
    assert.equal((await m.call('GET', `/api/user?id=${a.me.id}`, { token: b.token })).user.level, LEVEL.of(me.xp));
  } finally {
    await m.stop();
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
