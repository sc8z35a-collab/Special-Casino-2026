// Quests, the player level, バイト and the update bonus: npm test (from the repository root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { QUESTS, LEVEL, RELEASE, RULES } from '../core/rules.js';
import { stepQuests as advanceQuests, claimQuests, questsReady } from '../core/quests.js';

// Normal draws isolate progress/reward assertions from the bonus lottery.
const stepQuests = (state, events, now, boost) => advanceQuests(state, events, now, boost, () => 999);

const H = 3600000;
const ids = (r) => r.done.map((q) => q.id).sort();

test('quest periods start 2026-10-18 9:00 Japan time: every 5 h, day, week (協力 too), month (18th); 特別 never', () => {
  const t = Date.UTC(2026, 9, 18, 6, 30);   // 15:30 in Japan
  assert.deepEqual(QUESTS.range('5h', t), { k: 1, start: Date.UTC(2026, 9, 18, 5), end: Date.UTC(2026, 9, 18, 10) });
  assert.equal(QUESTS.range('day', t).end, Date.UTC(2026, 9, 19));
  assert.equal(QUESTS.range('week', t).end, Date.UTC(2026, 9, 25));
  assert.deepEqual(QUESTS.range('coop', t), QUESTS.range('week', t));
  assert.equal(QUESTS.range('month', Date.UTC(2026, 10, 17, 23)).end, Date.UTC(2026, 10, 18));
  assert.deepEqual(QUESTS.range('special', Date.UTC(2031, 0, 18)), { k: 0, start: QUESTS.epoch, end: 0 });
  // every quest pays $; ids are unique
  assert.equal(new Set(QUESTS.list.map((q) => q.id)).size, QUESTS.list.length);
  assert.deepEqual([2000, 5000, 10000, 20000, 50000, 100000, 1000000].map(QUESTS.tier), ['green', 'green', 'green', 'blue', 'purple', 'gold', 'aqua-purple']);
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
  // one transfer counts for the daily and the monthly quests, all paid in $
  // (with the four before them that is five finished: クエストを5回クリアする as well)
  r = stepQuests(st, [['sent', 100000]], now);
  assert.deepEqual(ids(r), ['day-clear5', 'day-send100k', 'day-send1k', 'month-send100k']);
  c = claimQuests(st, ['day-send1k', 'day-send100k', 'month-send100k'], now);
  assert.equal(c.dollars, 5000 + 10000 + 30000);
  assert.equal(st.special.m.clear, 8, 'every finished quest counts towards クエストを100個クリアする');
  claimQuests(st, null, now);
  // five hours on, the 5時間 quests start over (what was not received is gone); the day's do not
  r = stepQuests(st, [['spin', 1], ['sent', 1000]], now + 5 * H);
  assert.deepEqual(ids(r), ['5h-spin1']);
  assert.equal(questsReady(st, now + 5 * H), 1);
});

test('quests: chains of one metric, the longest combo, 特別 clears, 臨時緊急 weeks, never-ending 特別', () => {
  const st = {};
  const now = Date.UTC(2026, 9, 18, 1);
  // a chain: the same count goes on towards every step
  const chain = QUESTS.chainOf(QUESTS.get('5h-online10'));
  assert.deepEqual(chain.map((q) => q.goal), [300, 600, 900, 1200, 1800, 3600, 5400, 7200, 9000, 10800, 12000, 15000]);
  // (finishing quests also counts クエストを5回クリアする: left out here)
  const fiveH = (r) => ids(r).filter((id) => id.startsWith('5h-'));
  assert.deepEqual(fiveH(stepQuests(st, [['online', 650]], now)), ['5h-online10', '5h-online5']);
  // combos keep the longest run, they do not add up
  assert.deepEqual(fiveH(stepQuests(st, [['combo', 2]], now)), ['5h-combo2']);
  assert.equal(stepQuests(st, [['combo', 1]], now).changed, false);
  assert.deepEqual(fiveH(stepQuests(st, [['combo', 4]], now)), ['5h-combo3', '5h-combo4']);
  // a 特別 quest finished: 特別クエストをひとつクリアする (デイリー)
  const r = stepQuests(st, [['borrow', 1]], now);
  assert.ok(ids(r).includes('special-borrow') && ids(r).includes('day-special'), JSON.stringify(ids(r)));
  // 特別 never starts over: done stays done years later
  assert.equal(stepQuests(st, [['borrow', 1]], now + 900 * 24 * H).done.length, 0);
  // 臨時緊急クエスト: on in some weeks only (the first one is one of them)
  const weeks = Array.from({ length: 52 }, (_, k) => QUESTS.emergencyWeek(k));
  assert.equal(weeks[0], true);
  assert.ok(weeks.filter(Boolean).length > 15 && weeks.filter(Boolean).length < 37, String(weeks.filter(Boolean).length));
  const on = weeks.indexOf(true), off = weeks.indexOf(false);
  const at = (k) => QUESTS.epoch + k * 7 * 24 * H + H;
  assert.deepEqual(ids(stepQuests({}, [['watermelon', 3]], at(on))), ['day-watermelon', 'day-watermelon2', 'day-watermelon3', 'week-melon3']);
  assert.deepEqual(ids(stepQuests({}, [['watermelon', 3]], at(off))), ['day-watermelon', 'day-watermelon2', 'day-watermelon3']);
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
    assert.deepEqual([c.balance.tokens, c.balance.dollars, c.tokens], [990, c.dollars, 0], 'every quest pays $');
    assert.ok(c.dollars >= 1000000);
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

test('バイト: one more at once every 3 levels; in 友達と稼ぐ the best paid one pays x1.5', async () => {
  assert.deepEqual([1, 2, 3, 5, 6, 9, 12].map((l) => LEVEL.jobSlots(l)), [1, 1, 2, 2, 3, 4, 5]);
  const { call, register, setUser, befriend, listen, stop } = await startServer();
  try {
    const a = await register('JobHubA'), b = await register('JobHubB');
    let r = await call('GET', '/api/jobs', { token: a.token });
    assert.deepEqual([r.slots, r.every], [1, 3]);
    setUser(a.me.id, { xp: LEVEL.at(3) });
    assert.equal((await call('GET', '/api/jobs', { token: a.token })).slots, 2);
    assert.equal((await call('POST', '/api/jobs/start', { token: a.token, body: { id: 'garage' } })).status, 200);
    await befriend(a, b);
    const la = await listen(a), lb = await listen(b);
    try {
      // no hub: a minute of play is just a minute of wages
      setUser(a.me.id, { beat_at: Date.now() - 60000 });
      await call('POST', '/api/beat', { token: a.token, body: { idle: 0 } });
      assert.equal((await call('GET', '/api/jobs', { token: a.token })).working[0].boost || 0, 0);
      // a hub with its benefits on: the time counts once more at half the wage
      await call('POST', '/api/hub/invite', { token: a.token, body: { to: b.me.id } });
      assert.equal((await call('POST', '/api/hub/join', { token: b.token, body: { from: a.me.id } })).status, 200);
      setUser(a.me.id, { beat_at: Date.now() - 60000 });
      const beat = await call('POST', '/api/beat', { token: a.token, body: { idle: 0 } });
      assert.ok(beat.counted >= 59, String(beat.counted));
      assert.equal((await call('GET', '/api/jobs', { token: a.token })).working[0].boost, beat.counted * 1000);
      setUser(a.me.id, { jobs: JSON.stringify([{ id: 'garage', since: Date.now() - H, boost: H }]) });
      r = await call('POST', '/api/jobs/collect', { token: a.token });
      assert.ok(r.paid >= 30000 && r.paid < 30010, 'an hour x1.5: ' + r.paid);
      assert.equal(r.working[0].boost, 0);
    } finally {
      la.close(); lb.close();
    }
  } finally {
    await stop();
  }
});

test('update bonus: $250 000 for every release a player updates past; new players start on the newest', async () => {
  const { call, register, setUser, stop } = await startServer();
  try {
    const a = await register('Updater');
    const release = () => call('POST', '/api/release', { token: a.token, body: { release: RELEASE } });
    assert.deepEqual(await release().then((r) => [r.bonus, r.updates, r.outdated]), [0, 0, false]);
    // when each release went live here (Dev News shows it): the server's own start
    const { released } = await release();
    assert.deepEqual(Object.keys(released), [String(RELEASE)]);
    assert.ok(Math.abs(released[RELEASE] - Date.now()) < 60000);
    setUser(a.me.id, { release_seen: RELEASE - 1 });
    assert.equal((await call('POST', '/api/release', { token: a.token, body: { release: RELEASE - 1 } })).outdated, true);
    const claim = () => call('POST', '/api/release/claim', { token: a.token, body: {} });
    let before = (await call('GET', '/api/me', { token: a.token })).me.dollars;
    let r = await release();
    // it waits for the tap on the thanks (DEV9), also after a reload, and is paid once
    assert.deepEqual([r.bonus, r.updates, r.me.dollars], [250000, 1, before]);
    assert.equal((await release()).bonus, 250000);
    let c = await claim();
    assert.deepEqual([c.paid, c.me.dollars], [250000, before + 250000]);
    assert.equal((await claim()).paid, 0);
    assert.equal((await release()).bonus, 0);
    // two updates at once (the game was not opened in between): paid twice, in one go
    setUser(a.me.id, { release_seen: RELEASE - 2 });
    before = c.me.dollars;
    r = await release();
    assert.deepEqual([r.bonus, r.updates], [500000, 2]);
    c = await claim();
    assert.equal(c.me.dollars, before + 500000);
    assert.deepEqual(await release().then((x) => [x.bonus, x.updates]), [0, 0]);
    // registered before there was an update bonus: every release so far
    setUser(a.me.id, { release_seen: 0 });
    before = c.me.dollars;
    r = await release();
    assert.deepEqual([r.bonus, r.updates], [RELEASE * 250000, RELEASE]);
    assert.equal((await claim()).me.dollars, before + RELEASE * 250000);
  } finally {
    await stop();
  }
});
