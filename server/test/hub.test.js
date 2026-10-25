// 友達と稼ぐ (hubs), the activity beat of the time quests and the odds:
// npm test (from the repository root)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES, evaluate } from '../core/rules.js';

const HUB = RULES.hub;
let s, call, register, setUser, befriend, listen;

before(async () => {
  s = await startServer({ quests: true, limits: { spin: [100000, 1000], shop: [100000, 1000], general: [100000, 1000], login: [100000, 1000], friend: [100000, 1000], transfer: [100000, 1000], dm: [100000, 1000] } });
  ({ call, register, setUser, befriend, listen } = s);
});

after(() => s.stop());

const hubRow = (id) => s.app.db.prepare('SELECT * FROM hubs WHERE id = ?').get(id);
const xpOf = async (p) => (await call('GET', '/api/me', { token: p.token })).me.xp;
const mult = (n) => (n > 1 ? Math.round(Math.pow(HUB.comboStep, n - 1) * 10000) / 10000 : 1);
// what a spin in a hub pays: the line's pay, 777 x1.5, then x1.1 for every win before it in the combo
function pays(res, combo) {
  const base = evaluate(res.line, res.bet);
  let total = base.total;
  const sevens = base.wins.find((w) => w.symbol === 'seven' && w.count >= 3);
  if (sevens) total += Math.floor(sevens.amount * (HUB.sevens - 1));
  total = Math.floor(total * mult(combo));
  // from the fifth win in a row, double
  return combo >= RULES.comboDouble ? total * 2 : total;
}
async function friends(...names) {
  const ps = [];
  for (const n of names) ps.push(await register(n));
  for (let i = 1; i < ps.length; i++) await befriend(ps[0], ps[i]);
  return ps;
}
async function hubOf(host, guest) {
  const r = await call('POST', '/api/hub/invite', { token: host.token, body: { to: guest.me.id } });
  assert.equal(r.status, 200, JSON.stringify(r));
  const j = await call('POST', '/api/hub/join', { token: guest.token, body: { from: host.me.id } });
  assert.equal(j.status, 200, JSON.stringify(j));
  return j.hub;
}

test('友達と稼ぐ: invitations between friends who are online; joining forms a hub, more join it', async () => {
  const [a, b, c] = await friends('HubA', 'HubB', 'HubC');
  const stranger = await register('HubX');
  assert.equal((await call('POST', '/api/hub/invite', { token: a.token, body: { to: stranger.me.id } })).error.code, 'not_friends');
  assert.equal((await call('POST', '/api/hub/invite', { token: a.token, body: { to: b.me.id } })).error.code, 'offline');
  const la = await listen(a), lb = await listen(b), lc = await listen(c);
  try {
    const inv = await call('POST', '/api/hub/invite', { token: a.token, body: { to: b.me.id } });
    assert.ok(inv.until > Date.now());
    assert.equal((await lb.waitFor('hub', (e) => e.type === 'invite')).from.id, a.me.id);
    assert.deepEqual((await call('GET', '/api/hub', { token: b.token })).invites.map((i) => i.from.id), [a.me.id]);
    assert.equal((await call('GET', '/api/hub', { token: a.token })).hub, null, 'no hub before someone joins');
    const hub = (await call('POST', '/api/hub/join', { token: b.token, body: { from: a.me.id } })).hub;
    assert.deepEqual(hub.members.map((m) => m.id), [a.me.id, b.me.id]);
    assert.equal((await la.waitFor('hub', (e) => e.type === 'join')).user.id, b.me.id);
    assert.equal((await call('POST', '/api/hub/join', { token: b.token, body: { from: a.me.id } })).error.code, 'no_invite', 'an invitation is used once');
    assert.equal((await call('POST', '/api/hub/invite', { token: a.token, body: { to: b.me.id } })).error.code, 'same');
    // a third player joins the same hub; everyone already in it hears it
    await call('POST', '/api/hub/invite', { token: a.token, body: { to: c.me.id } });
    const h3 = (await call('POST', '/api/hub/join', { token: c.token, body: { from: a.me.id } })).hub;
    assert.equal(h3.id, hub.id);
    assert.equal(h3.members.length, 3);
    assert.equal((await lb.waitFor('hub', (e) => e.type === 'join')).user.id, c.me.id);
    // 即席チャット: to the one tapped; the server's record keeps it
    assert.equal((await call('POST', '/api/hub/say', { token: c.token, body: { to: b.me.id, text: 'ナイス！' } })).line.text, 'ナイス！');
    assert.equal((await lb.waitFor('hub', (e) => e.type === 'say')).text, 'ナイス！');
    const said = s.app.db.prepare("SELECT room, sender_id, recipient_id, body FROM live_chats WHERE place = 'hub'").all();
    assert.deepEqual(said.map((x) => ({ ...x })), [{ room: hub.id, sender_id: c.me.id, recipient_id: b.me.id, body: 'ナイス！' }]);
    // saying no: the sender is told
    const d = await register('HubD');
    await befriend(a, d);
    const ld = await listen(d);
    await call('POST', '/api/hub/invite', { token: a.token, body: { to: d.me.id } });
    await call('POST', '/api/hub/decline', { token: d.token, body: { from: a.me.id } });
    assert.equal((await la.waitFor('hub', (e) => e.type === 'declined')).by.id, d.me.id);
    ld.close();
  } finally {
    la.close(); lb.close(); lc.close();
  }
});

test('友達と稼ぐ: invitations that cross and players joining at once end up in one hub', async () => {
  const [a, b, c] = await friends('CrossA', 'CrossB', 'CrossC');
  await befriend(b, c);
  const ls = [await listen(a), await listen(b), await listen(c)];
  try {
    await call('POST', '/api/hub/invite', { token: a.token, body: { to: b.me.id } });
    await call('POST', '/api/hub/invite', { token: b.token, body: { to: a.me.id } });
    const [x, y] = await Promise.all([
      call('POST', '/api/hub/join', { token: b.token, body: { from: a.me.id } }),
      call('POST', '/api/hub/join', { token: a.token, body: { from: b.me.id } })
    ]);
    assert.equal(x.status, 200, JSON.stringify(x));
    assert.equal(y.status, 200, JSON.stringify(y));
    assert.equal(x.hub.id, y.hub.id);
    // two invitations accepted at the same moment: one hub of three
    await call('POST', '/api/hub/leave', { token: a.token });
    const d = await register('CrossD');
    await befriend(d, b);
    await befriend(d, c);
    ls.push(await listen(d));
    await call('POST', '/api/hub/invite', { token: d.token, body: { to: b.me.id } });
    await call('POST', '/api/hub/invite', { token: d.token, body: { to: c.me.id } });
    const [p, q] = await Promise.all([
      call('POST', '/api/hub/join', { token: b.token, body: { from: d.me.id } }),
      call('POST', '/api/hub/join', { token: c.token, body: { from: d.me.id } })
    ]);
    assert.equal(p.status, 200, JSON.stringify(p));
    assert.equal(q.status, 200, JSON.stringify(q));
    const h = (await call('GET', '/api/hub', { token: d.token })).hub;
    assert.deepEqual(h.members.map((m) => m.id).sort((u, v) => u - v), [b.me.id, c.me.id, d.me.id].sort((u, v) => u - v));
  } finally {
    ls.forEach((l) => l.close());
  }
});

test('友達と稼ぐ: at most five players', async () => {
  const ps = await friends('Full0', 'Full1', 'Full2', 'Full3', 'Full4', 'Full5');
  const ls = [];
  for (const p of ps) ls.push(await listen(p));
  try {
    for (let i = 1; i <= 4; i++) await hubOf(ps[0], ps[i]);
    assert.equal((await call('GET', '/api/hub', { token: ps[0].token })).hub.members.length, HUB.max);
    assert.equal((await call('POST', '/api/hub/invite', { token: ps[0].token, body: { to: ps[5].me.id } })).error.code, 'full');
  } finally {
    ls.forEach((l) => l.close());
  }
});

test('友達と稼ぐ: spins share one combo (x1.1 a win, three misses end it), 777 x1.5, XP x1.2', async () => {
  const [a, b] = await friends('SpinA', 'SpinB');
  const solo = await register('SpinSolo');
  setUser(solo.me.id, { tokens: 100000 });
  assert.equal((await call('POST', '/api/spin', { token: solo.token, body: { bet: 100 } })).result.hub, null, 'on one\'s own: no hub');
  const la = await listen(a), lb = await listen(b);
  try {
    const hub = await hubOf(a, b);
    setUser(a.me.id, { tokens: 10000000 });
    setUser(b.me.id, { tokens: 10000000 });
    let wins = 0, misses = 0;
    for (let i = 0; i < 80; i++) {
      const p = i % 2 ? b : a;
      const before = hubRow(hub.id);
      const r = await call('POST', '/api/spin', { token: p.token, body: { bet: 100 } });
      assert.equal(r.status, 200, JSON.stringify(r));
      const res = r.result;
      assert.ok(res.hub, 'a spin in a hub');
      if (res.total > 0) {
        wins++;
        assert.equal(res.hub.combo, before.combo + 1);
        assert.equal(res.hub.misses, 0);
        assert.equal(res.total, pays(res, before.combo + 1), JSON.stringify(res));
      } else {
        misses++;
        if (before.misses + 1 >= HUB.misses) { assert.deepEqual([res.hub.combo, res.hub.misses], [0, 0]); } else {
          assert.deepEqual([res.hub.combo, res.hub.misses], [before.combo, before.misses + 1], 'a miss alone does not end it');
        }
      }
      if (res.hub.diamonds) assert.deepEqual(res.line, ['diamond', 'diamond', 'diamond', 'diamond', 'diamond']);
      const after = hubRow(hub.id);
      assert.deepEqual([after.combo, after.misses], [res.hub.combo, res.hub.misses]);
    }
    assert.ok(wins > 0 && misses > 0, `${wins} wins, ${misses} misses`);
    // the others in the hub hear every spin with the combo
    const ev = await lb.waitFor('hub', (e) => e.type === 'spin' && e.user.id === a.me.id);
    assert.equal(typeof ev.combo, 'number');
    // a long run: the 8th win in a row pays x1.1^7
    s.app.db.prepare('UPDATE hubs SET combo = 7, misses = 2 WHERE id = ?').run(hub.id);
    for (let i = 0; i < 60; i++) {
      const before = hubRow(hub.id);
      const res = (await call('POST', '/api/spin', { token: a.token, body: { bet: 100 } })).result;
      if (res.total > 0) { assert.equal(res.total, pays(res, before.combo + 1)); break; }
      s.app.db.prepare('UPDATE hubs SET combo = 7, misses = 2 WHERE id = ?').run(hub.id);
    }
    // XP x1.2: five spins give six
    s.app.db.prepare('UPDATE hub_members SET spins = 0 WHERE user_id = ?').run(a.me.id);
    const xp0 = await xpOf(a);
    for (let i = 0; i < 5; i++) await call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
    assert.equal(await xpOf(a) - xp0, 6);
  } finally {
    la.close(); lb.close();
  }
});

test('友達と稼ぐ: nobody leaves by going away; leaving leaves one player and the hub closes', async () => {
  const [a, b, c] = await friends('LeaveA', 'LeaveB', 'LeaveC');
  const la = await listen(a), lb = await listen(b), lc = await listen(c);
  try {
    const hub = await hubOf(a, b);
    // b's connection goes: a sees it, but b stays in the hub (for days too)
    lb.close();
    assert.equal((await la.waitFor('hub', (e) => e.type === 'away')).user.id, b.me.id);
    s.app.db.prepare('UPDATE users SET active_at = ? WHERE id = ?').run(Date.now() - 3 * 86400000, b.me.id);
    s.app.api.housekeeping();
    const still = (await call('GET', '/api/hub', { token: a.token })).hub;
    assert.deepEqual(still.members.map((m) => m.id), [a.me.id, b.me.id]);
    assert.equal(still.on, false, 'one of the two is idle: no benefits');
    // 抜ける: one player left, the hub closes
    await call('POST', '/api/hub/leave', { token: b.token });
    assert.equal((await la.waitFor('hub', (e) => e.type === 'closed')).why, 'alone');
    assert.equal((await call('GET', '/api/hub', { token: a.token })).hub, null);
    assert.equal(hubRow(hub.id), undefined);
    // an invitation starts a new one
    const again = await hubOf(a, c);
    assert.deepEqual(again.members.map((m) => m.id), [a.me.id, c.me.id]);
  } finally {
    la.close(); lc.close();
  }
});

test('友達と稼ぐ: the benefits are on while two or more are active (4 minutes); the 5時間 booster x2, x1.1 a player more', async () => {
  const [a, b, c] = await friends('ActA', 'ActB', 'ActC');
  const la = await listen(a), lb = await listen(b), lc = await listen(c);
  const spins5h = async (p) => (await call('GET', '/api/quests', { token: p.token })).periods.find((x) => x.id === '5h').quests.find((x) => x.id === '5h-spin10').progress;
  const idleFor = (p, ms) => s.app.db.prepare('UPDATE users SET active_at = ? WHERE id = ?').run(Date.now() - ms, p.me.id);
  try {
    await hubOf(a, b);
    for (const p of [a, b, c]) setUser(p.me.id, { tokens: 10000000 });
    let h = (await call('GET', '/api/hub', { token: a.token })).hub;
    assert.deepEqual([h.active, h.on, h.booster], [2, true, HUB.booster]);
    // a spin counts twice in the 5時間 quests
    let r = await call('POST', '/api/spin', { token: a.token, body: { bet: 100, idle: 0 } });
    assert.ok(r.result.hub, 'benefits on');
    assert.equal(r.result.hub.booster, 2);
    assert.equal(await spins5h(a), 2);
    // b has done nothing for over 4 minutes: everything stops for both
    idleFor(b, 4 * 60000 + 5000);
    h = (await call('GET', '/api/hub', { token: a.token })).hub;
    assert.deepEqual([h.active, h.on], [1, false]);
    r = await call('POST', '/api/spin', { token: a.token, body: { bet: 100, idle: 0 } });
    assert.equal(r.result.hub, null, 'no hub odds, combo or boosts');
    assert.equal(await spins5h(a), 3, 'no booster');
    // AUTO spins of a player who does nothing are not activity
    r = await call('POST', '/api/spin', { token: b.token, body: { bet: 100, idle: 5 * 60000 } });
    assert.equal(r.result.hub, null);
    // b taps again (the beat says so): back on, and a hears it
    await call('POST', '/api/beat', { token: b.token, body: { idle: 1000 } });
    assert.equal((await la.waitFor('hub', (e) => e.type === 'activity' && e.user === b.me.id)).idle < 60000, true);
    h = (await call('GET', '/api/hub', { token: a.token })).hub;
    assert.deepEqual([h.active, h.on], [2, true]);
    assert.ok((await call('POST', '/api/spin', { token: a.token, body: { bet: 100, idle: 0 } })).result.hub);
    assert.equal(await spins5h(a), 5);
    // a third active player: x2.2 (x1.1 more), and back to x2 when one goes idle
    await call('POST', '/api/hub/invite', { token: a.token, body: { to: c.me.id } });
    await call('POST', '/api/hub/join', { token: c.token, body: { from: a.me.id } });
    h = (await call('GET', '/api/hub', { token: a.token })).hub;
    assert.deepEqual([h.active, h.booster], [3, 2.2]);
    r = await call('POST', '/api/spin', { token: a.token, body: { bet: 100, idle: 0 } });
    assert.equal(r.result.hub.booster, 2.2);
    assert.equal(await spins5h(a), 7, '5 + 2.2 = 7.2');
    idleFor(c, 10 * 60000);
    r = await call('POST', '/api/spin', { token: a.token, body: { bet: 100, idle: 0 } });
    assert.equal(r.result.hub.booster, 2);
    assert.equal(await spins5h(a), 9, '7.2 + 2 = 9.2');
    // XP x1.2 from quests and 週間協力 only while on: an idle player gets no co-op time
    idleFor(b, 10 * 60000);
    setUser(c.me.id, { beat_at: Date.now() - 60000 });
    idleFor(c, 0);
    const coop = await call('POST', '/api/beat', { token: c.token, body: { idle: 0 } });
    assert.ok(coop.counted > 0);
    const cq = await call('GET', '/api/quests', { token: c.token });
    assert.equal(cq.periods.find((p) => p.id === 'coop').quests.find((x) => x.id === 'coop-time10').progress, coop.counted, 'a and c are active');
    idleFor(a, 10 * 60000);
    setUser(c.me.id, { beat_at: Date.now() - 60000 });
    const alone = await call('POST', '/api/beat', { token: c.token, body: { idle: 0 } });
    const cq2 = await call('GET', '/api/quests', { token: c.token });
    assert.ok(alone.counted > 0);
    assert.equal(cq2.periods.find((p) => p.id === 'coop').quests.find((x) => x.id === 'coop-time10').progress, coop.counted, 'only c is active: no co-op time');
  } finally {
    la.close(); lb.close(); lc.close();
  }
});

test('SUPER BIG WIN: the friends who are online hear it (not the ones blocked)', async () => {
  const [a, b, c] = await friends('BigA', 'BigB', 'BigC');
  const lb = await listen(b), lc = await listen(c);
  await call('POST', '/api/block', { token: c.token, body: { user: a.me.id, blocked: true } });
  const U = globalThis.BR.util, real = U.random;
  try {
    setUser(a.me.id, { tokens: 100000000 });
    // five statues on the line
    U.random = () => 0.99999;
    let r;
    try { r = (await call('POST', '/api/spin', { token: a.token, body: { bet: 100 } })).result; } finally { U.random = real; }
    assert.equal(r.tier, 3, JSON.stringify(r));
    const ev = await lb.waitFor('bigwin');
    assert.equal(ev.user.id, a.me.id);
    assert.equal(ev.win, r.total);
    await assert.rejects(lc.waitFor('bigwin', () => true, 300), 'blocked: not told');
  } finally {
    U.random = real;
    lb.close(); lc.close();
  }
});

test('time quests: online / in a hub / talking count while active, up to 4 minutes after the last tap', async () => {
  const [a, b] = await friends('BeatA', 'BeatB');
  const progress = async (p, period, id) => (await call('GET', '/api/quests', { token: p.token })).periods.find((x) => x.id === period).quests.find((x) => x.id === id).progress;
  const beat = (p, body) => call('POST', '/api/beat', { token: p.token, body });
  const la = await listen(a), lb = await listen(b);
  try {
    assert.equal((await beat(a, { idle: 0 })).counted, 0, 'the first beat only starts the clock');
    setUser(a.me.id, { beat_at: Date.now() - 60000 });
    let r = await beat(a, { idle: 1000 });
    assert.ok(r.counted >= 59 && r.counted <= 61, String(r.counted));
    assert.equal(await progress(a, '5h', '5h-online5'), r.counted);
    // idle for 3m20s at the beat: still within 4 minutes the whole minute
    setUser(a.me.id, { beat_at: Date.now() - 60000 });
    assert.ok((await beat(a, { idle: 200000 })).counted >= 59);
    // idle for 4m30s: only the first half of the minute was within 4 minutes
    setUser(a.me.id, { beat_at: Date.now() - 60000 });
    r = await beat(a, { idle: 270000 });
    assert.ok(r.counted >= 29 && r.counted <= 31, String(r.counted));
    // idle for 5 minutes: nothing; beats too far apart: nothing in between
    setUser(a.me.id, { beat_at: Date.now() - 60000 });
    assert.equal((await beat(a, { idle: 300000 })).counted, 0);
    setUser(a.me.id, { beat_at: Date.now() - 200000 });
    assert.equal((await beat(a, { idle: 0 })).counted, 0);
    // in a hub with a friend who is active: 友達と稼ぐ time; with a voice on:
    // talking (x2 in the 5時間 quests: the hub's booster)
    await hubOf(a, b);
    setUser(a.me.id, { beat_at: Date.now() - 60000 });
    r = await beat(a, { idle: 0, voice: 1 });
    assert.equal(await progress(a, 'coop', 'coop-time10'), r.counted);
    const talked = await progress(a, '5h', '5h-talk5');
    assert.equal(talked, 2 * r.counted);
    setUser(a.me.id, { beat_at: Date.now() - 60000 });
    r = await beat(a, { idle: 0 });
    assert.ok(r.counted > 0);
    assert.equal(await progress(a, '5h', '5h-talk5'), talked, 'no voice: not talking');
  } finally {
    la.close(); lb.close();
  }
});

test('週間協力: what anyone in the hub wins counts for everyone in it', async () => {
  const [a, b] = await friends('CoopA', 'CoopB');
  const la = await listen(a), lb = await listen(b);
  try {
    await hubOf(a, b);
    setUser(b.me.id, { tokens: 10000000 });
    let won = 0;
    for (let i = 0; i < 60 && !won; i++) won += (await call('POST', '/api/spin', { token: b.token, body: { bet: 1000 } })).result.total;
    assert.ok(won > 0);
    const q = await call('GET', '/api/quests', { token: a.token });
    assert.equal(q.periods.find((p) => p.id === 'coop').quests.find((x) => x.id === 'coop-earn1m').progress, Math.min(1e6, won * RULES.tokenPrice));
  } finally {
    la.close(); lb.close();
  }
});

test('odds: RTP 82.0 % (a win on about 33.5 % of the spins); the hub raises the statue, the 7 and lowers the revolver', () => {
  const W = RULES.weights, S = RULES.symbols;
  const sum = (w) => S.reduce((a, k) => a + w[k], 0);
  assert.ok(Math.abs(sum(W) - 1) < 1e-9 && Math.abs(sum(HUB.weights) - 1) < 1e-9);
  assert.deepEqual([HUB.weights.statue, HUB.weights.seven, HUB.weights.revolver], [0.01, 0.04, 0.35]);
  assert.ok(HUB.weights.statue > W.statue && HUB.weights.seven > W.seven && HUB.weights.revolver < W.revolver);
  // every centre line, weighted
  let rtp = 0, hit = 0;
  const line = [];
  (function rec(i, p) {
    if (i === 5) {
      const r = evaluate(line, 1);
      if (r.total > 0) { hit += p; rtp += p * r.mult; }
      return;
    }
    for (const k of S) { line[i] = k; rec(i + 1, p * W[k]); }
  })(0, 1);
  assert.ok(Math.abs(rtp - 0.82) < 0.0005, String(rtp));
  assert.ok(hit > 0.33 && hit < 0.338, String(hit));
});
