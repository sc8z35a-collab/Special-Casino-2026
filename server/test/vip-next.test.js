import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES, VIP, CARS, carPrice, carSale, evaluate } from '../core/rules.js';
const DAY = 86400000, HOUR = 3600000;
const win = bet => {
  const line = ['bar', 'bar', 'gold', 'diamond', 'revolver'];
  return { ...evaluate(line, bet), line, grid: line.map(x => [x, x, x]), bet };
};
const buy = (s, p, body) => s.call('POST', '/api/vip/extend', { token: p.token, body });
const me = async (s, p) => (await s.call('GET', '/api/me', { token: p.token })).me;

test('VIP3.1 and VIP4 have distinct labels, exact EXP thresholds and separate active/permanent benefits', () => {
  assert.deepEqual(RULES.vip.levels, [0, 1200, 2100, 4500, 8800, 14800]);
  for (const [exp, expected] of [[8799.999, 3], [8800, 4], [14799.999, 4], [14800, 5]]) assert.equal(VIP.level(exp), expected);
  assert.equal(VIP.label(4), '3.1'); assert.equal(VIP.label(5), '4');
  const now = Date.now();
  assert.equal(VIP.current(now + 1000, 8800, 0, now), 4);
  assert.equal(VIP.current(now - 1, 8800, 0, now), null);
  assert.equal(VIP.current(now - 1, 14800, 0, now), 2);
  assert.equal(VIP.badge({ until: now - 1, exp: 14800 }, now), 5);
  assert.equal(VIP.current(now + 1000, 14800, now + 1000, now), 5, 'a trial never downgrades a higher earned level');
  assert.equal(VIP.carDiscount(4), 15); assert.equal(VIP.carDiscount(5), 15); assert.equal(VIP.carDiscount(2), 3);
  assert.equal(VIP.kbps(VIP.tier(4)), 256); assert.equal(VIP.kbps(VIP.tier(5)), 256);
  assert.ok(VIP.kbps(VIP.tier(4)) > VIP.kbps(VIP.boost()));
  assert.equal(VIP.earlyAccess(4), 2); assert.equal(VIP.earlyAccess(2), 1);
  assert.equal(VIP.carOpen({ vip: 4 }, 4), true); assert.equal(VIP.carOpen({ vip: 4 }, 3), false);
});

test('VIP3.1 applies a 15 percent discount server-side and exposes unconfigured special rewards without inventing payouts', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('Tier31');
  const now = Date.now(); t.mock.method(Date, 'now', () => now);
  s.setUser(a.me.id, { dollars: 100000000, vip_until: now + DAY, vip_exp: 8800 });
  const before = await me(s, a);
  assert.deepEqual(before.vip.exclusive31, { unlocked: true, configured: false });
  assert.deepEqual(before.vip.specialLogin, { eligible: true, days: 60, configured: false });
  assert.equal(before.vip.earlyAccess, 2);
  const price = carPrice(CARS.get('ferrari-325'), carSale(now), 15).price;
  const forged = await s.call('POST', '/api/cars/buy', { token: a.token, body: { model: 'ferrari-325', price: 1 } });
  assert.equal(forged.error.code, 'price_changed');
  const r = await s.call('POST', '/api/cars/buy', { token: a.token, body: { model: 'ferrari-325', price } });
  assert.equal(r.status, 200); assert.equal(r.me.dollars, 100000000 - price);
});

test('VIP4 retains exactly VIP2 benefits after expiration, while the earned VIP4 badge stays visible', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('Forever4'), b = await s.register('Observer4');
  const now = Date.now(); t.mock.method(Date, 'now', () => now);
  s.setUser(a.me.id, { vip_exp: 14800, vip_until: now - HOUR, vip_permanent_at: now - 2 * HOUR,
    dollars: 100000000, jobs: JSON.stringify([{ id: 'garage', since: now - HOUR }]), tokens: 10000 });
  const before = await me(s, a);
  assert.deepEqual([before.vip.on, before.vip.paid, before.vip.permanent], [true, false, true]);
  assert.equal(before.vip.specialLogin.eligible, false); assert.equal(before.vip.exclusive31.unlocked, false);
  assert.equal(before.vip.earlyAccess, 1);
  const viewed = await s.call('GET', '/api/user?id=' + a.me.id, { token: b.token });
  assert.deepEqual([viewed.user.vip, viewed.user.vipBadge], [2, 5]);
  const paid = await s.call('POST', '/api/jobs/collect', { token: a.token });
  assert.equal(paid.paid, 20000 * 2.5);
  t.mock.method(globalThis.BR.engine, 'spin', win);
  const spun = await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
  assert.equal(spun.vip.exp, 14801, 'permanent VIP2 continues win EXP');
  const price = carPrice(CARS.get('ferrari-325'), carSale(now), 3).price;
  const r = await s.call('POST', '/api/cars/buy', { token: a.token, body: { model: 'ferrari-325' } });
  assert.equal(r.me.dollars, before.dollars + paid.paid - price, 'expired VIP4 has the VIP2 discount, not the paid 15%');
});

test('earning VIP4 records its permanent start and offline wages do not apply that benefit retroactively', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('Cross4');
  const now = Date.now(); t.mock.method(Date, 'now', () => now);
  s.setUser(a.me.id, { tokens: 10000, vip_exp: 14799, vip_until: now + DAY });
  t.mock.method(globalThis.BR.engine, 'spin', win);
  const r = await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
  assert.equal(r.vip.exp, 14800); assert.equal(r.vip.permanentAt, now);
  assert.equal(VIP.earned(1000, now - HOUR, now + HOUR, now - 2 * HOUR, 3, 0, 3, now), 1000 + 2500);
});

test('PRO has one fixed 8-coin fee and multiplies wins and car EXP by 1.6, including fractional EXP', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('ProBuyer');
  const now = Date.now(); t.mock.method(Date, 'now', () => now);
  s.setUser(a.me.id, { coins: 1000, dollars: 100000000, tokens: 10000 });
  const r = await buy(s, a, { days: 7, mode: 'pro', multiplier: 999, coins: 0 });
  assert.deepEqual([r.coins, r.back, r.days, r.me.coins, r.me.vip.mode], [36, 0, 7, 964, 'pro']);
  assert.deepEqual(r.me.vip.modes, [{ start: now, end: now + 7 * DAY, mode: 'pro' }]);
  t.mock.method(globalThis.BR.engine, 'spin', win);
  const spin = await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
  assert.equal(spin.vip.exp, 1.6);
  const car = await s.call('POST', '/api/cars/buy', { token: a.token, body: { model: 'ferrari-325' } });
  assert.equal(car.me.vip.exp, 49.6);
});

test('ULTRA cart adds 12 coins once for all packs, including free days; the fee is never included in refunds', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('UltraCart'); s.setUser(a.me.id, { coins: 1000, vip_exp: 1200 });
  const r = await buy(s, a, { packs: [{ days: 30, qty: 1 }, { days: 40, qty: 1 }], mode: 'ultra' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.days, r.coins, r.back, r.me.coins, r.resetTickets], [107, 292, 140, 848, 2]);
  assert.equal(r.endsAt - r.startsAt, 107 * DAY);
  assert.deepEqual(r.me.vip.modes, [{ start: r.startsAt, end: r.endsAt, mode: 'ultra' }]);
});

test('scheduled upgrades start after existing days and end exactly at their own boundary; later normal purchases do not inherit a multiplier', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('Scheduled'); const start = Date.now(); let now = start;
  t.mock.method(Date, 'now', () => now);
  s.setUser(a.me.id, { coins: 1000, tokens: 100000, vip_until: start + DAY });
  const pro = await buy(s, a, { days: 2, mode: 'pro' });
  assert.equal(pro.startsAt, start + DAY); assert.equal(pro.me.vip.mode, 'normal');
  const ultra = await buy(s, a, { days: 1, mode: 'ultra' });
  const normal = await buy(s, a, { days: 1 });
  assert.equal(normal.endsAt, start + 5 * DAY);
  t.mock.method(globalThis.BR.engine, 'spin', win);
  let exp = 0;
  for (const [at, gain, mode] of [[start + DAY - 1, 1, 'normal'], [start + DAY, 1.6, 'pro'], [pro.endsAt, 2, 'ultra'], [ultra.endsAt, 1, 'normal']]) {
    now = at;
    const r = await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
    exp = Math.round((exp + gain) * 1000) / 1000;
    assert.equal(r.vip.exp, exp, JSON.stringify(r)); assert.equal(r.vip.mode, mode);
  }
});

test('quest VIP EXP gains retain 0.16 precision under PRO and ULTRA BIG WIN receives twice its entire VIP EXP', async t => {
  const s = await startServer({ quests: true }); t.after(() => s.stop());
  const a = await s.register('ProQuest'); s.setUser(a.me.id, { coins: 1000, tokens: 10000 });
  await buy(s, a, { days: 1, mode: 'pro' });
  t.mock.method(globalThis.BR.engine, 'spin', win);
  const r = await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
  assert.equal(r.vip.exp, 2.56, 'one win (1.6) plus six achievements, including first VIP use and the daily clear chain (6 × 0.16)');
  assert.equal((await me(s, a)).vip.exp, 2.56);
  const b = await s.register('UltraWin'); s.setUser(b.me.id, { coins: 1000, tokens: 10000 });
  await buy(s, b, { days: 1, mode: 'ultra' });
  t.mock.method(globalThis.BR.engine, 'spin', bet => { const line = Array(5).fill('seven'); return { ...evaluate(line, bet), line, grid: line.map(x => [x, x, x]), bet }; });
  const spun = await s.call('POST', '/api/spin', { token: b.token, body: { bet: 100 } });
  const state = JSON.parse(s.app.db.prepare('SELECT quests FROM users WHERE id = ?').get(b.me.id).quests);
  const count = Object.values(state).filter(x => x && Array.isArray(x.c)).reduce((n, x) => n + x.c.length, 0);
  assert.equal(spun.vip.exp, Math.round((251 + 0.1 * count) * 2 * 1000) / 1000);
});

test('trial days keep their original multiplier; a PRO extension starts only after the trial ends', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('TrialPro'); s.setUser(a.me.id, { coins: 1000 });
  const trial = await s.call('POST', '/api/vip/trial', { token: a.token });
  const r = await buy(s, a, { days: 1, mode: 'pro' });
  assert.equal(r.startsAt, trial.until); assert.equal(r.me.vip.mode, 'normal');
  assert.equal(r.coins, 12);
});

test('invalid modes and insufficient premium balances cannot charge, extend, or create multiplier schedules', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('BadMode'); s.setUser(a.me.id, { coins: 11 });
  for (const mode of ['PRO', 'VIP4', '__proto__', null, 2, {}]) assert.equal((await buy(s, a, { days: 1, mode })).error.code, 'vip_mode');
  assert.equal((await buy(s, a, { days: 1, mode: 'pro' })).error.code, 'insufficient');
  const after = await me(s, a);
  assert.equal(after.coins, 11); assert.equal(after.vip.until, 0); assert.deepEqual(after.vip.modes, []);
});
