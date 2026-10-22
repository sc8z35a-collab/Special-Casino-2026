import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES, VIP, JOBS, LEVEL, evaluate } from '../core/rules.js';

const DAY = 86400000, HOUR = 3600000;

test('30/40-day VIP packs grant one five-hour ticket each; custom days and smaller packs do not', async t => {
  const s = await startServer();
  t.after(() => s.stop());
  const a = await s.register('PackTickets');
  s.setUser(a.me.id, { coins: 1000, quests: JSON.stringify({ tickets: { '5h': 3, day: 2 } }) });
  let gifts = 0;
  for (const pack of [10, 20, 30, 40]) {
    const r = await s.call('POST', '/api/vip/extend', { token: a.token, body: { pack, resetTickets: 999 } });
    assert.equal(r.status, 200, JSON.stringify(r));
    const gift = pack >= 30 ? 1 : 0;
    gifts += gift;
    assert.equal(r.resetTickets, gift);
    assert.deepEqual(r.me.questTickets, { '5h': 3 + gifts, day: 2 });
  }
  const custom = await s.call('POST', '/api/vip/extend', { token: a.token, body: { days: 30 } });
  assert.equal(custom.status, 200);
  assert.equal(custom.resetTickets, 0);
  assert.deepEqual(custom.me.questTickets, { '5h': 5, day: 2 });
});

test('VIP cart quotes all plans server-side and buys their days, free days and ticket gifts atomically', async t => {
  const s = await startServer();
  t.after(() => s.stop());
  const a = await s.register('CartBuyer');
  s.setUser(a.me.id, { coins: 1000 });
  const packs = [{ days: 30, qty: 1 }, { days: 40, qty: 1 }, { days: 30, qty: 1 }, { days: 10, qty: 1 }];
  const quote = VIP.cart(packs, 0);
  assert.deepEqual([quote.bought, quote.bonus, quote.days, quote.coins, quote.resetTickets], [110, 51, 161, 440, 3]);
  const started = Date.now();
  const r = await s.call('POST', '/api/vip/extend', { token: a.token, body: { packs, coins: 1, bonus: 999, resetTickets: 999 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual([r.days, r.bonus, r.coins, r.resetTickets, r.me.coins], [161, 51, 440, 3, 560]);
  assert.deepEqual(r.packs, [{ days: 10, qty: 1 }, { days: 30, qty: 2 }, { days: 40, qty: 1 }]);
  assert.ok(Math.abs(r.me.vip.until - started - 161 * DAY) < 3000);
  assert.deepEqual(r.me.questTickets, { '5h': 3, day: 0 });
});

test('invalid, unaffordable and overlong carts never charge coins or grant tickets', async t => {
  const s = await startServer();
  t.after(() => s.stop());
  const a = await s.register('BadCart');
  s.setUser(a.me.id, { coins: 100 });
  const buy = body => s.call('POST', '/api/vip/extend', { token: a.token, body });
  for (const packs of [[], null, [{ days: 15, qty: 1 }], [{ days: 30, qty: 0 }], [{ days: 30, qty: -1 }],
    [{ days: 30, qty: 1.5 }], [{ days: 30, qty: '1' }], [{ days: 30, qty: 366 }]]) {
    assert.equal((await buy({ packs })).error.code, 'vip_cart');
  }
  assert.equal((await buy({ packs: [{ days: 30, qty: 1 }], days: 1 })).error.code, 'vip_cart');
  assert.equal((await buy({ packs: [{ days: 30, qty: 1 }] })).error.code, 'insufficient');
  assert.equal((await buy({ packs: [{ days: 40, qty: 6 }] })).error.code, 'too_long');
  const me = (await s.call('GET', '/api/me', { token: a.token })).me;
  assert.equal(me.coins, 100);
  assert.equal(me.vip.until, 0);
  assert.deepEqual(me.questTickets, { '5h': 0, day: 0 });
});

test('VIP cart refunds paid days at the player own VIP level, without refunding free days', async t => {
  const s = await startServer();
  t.after(() => s.stop());
  const a = await s.register('CartRefund');
  s.setUser(a.me.id, { coins: 1000, vip_exp: RULES.vip.levels[1] });
  const r = await s.call('POST', '/api/vip/extend', { token: a.token, body: { packs: [{ days: 30, qty: 1 }, { days: 40, qty: 1 }] } });
  assert.deepEqual([r.days, r.coins, r.back, r.me.coins, r.resetTickets], [107, 280, 140, 860, 2]);
});

test('VIP casino wins give one EXP; misses give none and ULTRA keeps its separate bonus', async t => {
  const s = await startServer();
  t.after(() => s.stop());
  const a = await s.register('WinExp');
  s.setUser(a.me.id, { tokens: 100000, vip_until: Date.now() + DAY });
  const lines = [['bar', 'bar', 'gold', 'diamond', 'revolver'], ['bar', 'revolver', 'gold', 'diamond', 'star'], Array(5).fill('seven')];
  t.mock.method(globalThis.BR.engine, 'spin', bet => {
    const line = lines.shift();
    return { ...evaluate(line, bet), line, grid: line.map(s => [s, s, s]), bet };
  });
  assert.equal(RULES.vip.exp.win, 1);
  for (const exp of [1, 1, 252]) {
    const r = await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
    assert.equal(r.vip.exp, exp);
  }
});

test('offline salary caps each job at 15 million including VIP/hub, and collecting discards excess accrual', async t => {
  const s = await startServer();
  t.after(() => s.stop());
  assert.equal(RULES.jobMaxPay, 15000000);
  for (const [i, settings] of [
    { hours: 1000 },
    { hours: 1000, vip_until: Date.now() + DAY, vip_exp: RULES.vip.levels[3] },
    { hours: 500, boost: 600 * HOUR }
  ].entries()) {
    const a = await s.register('SalaryCap' + i);
    s.setUser(a.me.id, { jobs: JSON.stringify([{ id: 'garage', since: Date.now() - settings.hours * HOUR, boost: settings.boost || 0 }]),
      vip_until: settings.vip_until || 0, vip_exp: settings.vip_exp || 0 });
    const r = await s.call('POST', '/api/jobs/collect', { token: a.token });
    assert.equal(r.paid, 15000000);
    assert.equal(r.balance.dollars, a.me.dollars + 15000000);
    const again = await s.call('POST', '/api/jobs/collect', { token: a.token });
    assert.ok(again.paid < 10, 'a second collection cannot take the discarded overflow');
  }
});

test('the salary cap is per job, and VIP purchase also settles capped wages', async t => {
  const s = await startServer();
  t.after(() => s.stop());
  JOBS.set('second-test-job', { id: 'second-test-job', wage: 50000, level: 1 });
  t.after(() => JOBS.delete('second-test-job'));
  const a = await s.register('TwoJobs');
  s.setUser(a.me.id, { xp: LEVEL.at(3), coins: 1000,
    jobs: JSON.stringify(['garage', 'second-test-job'].map(id => ({ id, since: Date.now() - 2000 * HOUR }))) });
  const r = await s.call('POST', '/api/vip/extend', { token: a.token, body: { pack: 30 } });
  assert.equal(r.paid, 30000000);
  assert.equal(r.me.dollars, a.me.dollars + 30000000);
  assert.equal(r.me.questTickets['5h'], 1);
});
