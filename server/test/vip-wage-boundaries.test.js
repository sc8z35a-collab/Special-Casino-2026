import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES, VIP, evaluate } from '../core/rules.js';
const HOUR = 3600000, DAY = 86400000, WAGE = RULES.jobs.find(j => j.id === 'garage').wage;
async function fixture(t, fields) {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const s = await startServer(); t.after(() => s.stop()); const p = await s.register('WageBoundary');
  s.setUser(p.me.id, { dollars: 100000000, tokens: 10000, ...fields(now) });
  return { s, p, now: () => now, advance: ms => { now += ms; } };
}
const win = bet => { const line = ['bar', 'bar', 'gold', 'diamond', 'revolver']; return { ...evaluate(line, bet), line, grid: line.map(x => [x, x, x]), bet }; };

for (const expired of [false, true]) test(`VIP-week ticket checkpoints wages before extending ${expired ? 'expired' : 'inactive'} VIP`, async t => {
  const level = expired ? 3 : 1;
  const f = await fixture(t, now => ({ vip_exp: RULES.vip.levels[level], vip_until: expired ? now - HOUR : 0,
    jobs: JSON.stringify([{ id: 'garage', since: now - 2 * HOUR }]) }));
  const { s, p } = f;
  s.app.db.prepare("INSERT INTO items(user_id,item,count) VALUES(?,'gacha-vip-week',1)").run(p.me.id);
  const beforePay = WAGE * (expired ? VIP.wage(level) + 1 : 2);
  const used = await s.call('POST', '/api/gacha/use', { token: p.token, body: { item: 'vip-week' } });
  assert.equal(used.status, 200); assert.equal(used.me.dollars, 100000000 + beforePay);
  f.advance(HOUR);
  const collected = await s.call('POST', '/api/jobs/collect', { token: p.token });
  assert.equal(collected.status, 200); assert.equal(collected.paid, WAGE * VIP.wage(level));
  assert.equal(collected.balance.dollars, 100000000 + beforePay + WAGE * VIP.wage(level));
});

for (const [from, to] of [[0, 1], [2, 3]]) test(`VIP level ${from} to ${to} does not reprice the past hour of work`, async t => {
  const f = await fixture(t, now => ({ vip_exp: RULES.vip.levels[to] - 1, vip_until: now + DAY,
    jobs: JSON.stringify([{ id: 'garage', since: now - HOUR }]) }));
  const { s, p } = f; t.mock.method(globalThis.BR.engine, 'spin', win);
  const spun = await s.call('POST', '/api/spin', { token: p.token, body: { bet: 100 } });
  assert.equal(spun.status, 200); assert.equal(spun.vip.level, to);
  assert.equal(spun.balance.dollars, 100000000 + WAGE * VIP.wage(from));
  f.advance(HOUR);
  const collected = await s.call('POST', '/api/jobs/collect', { token: p.token });
  assert.equal(collected.paid, WAGE * VIP.wage(to));
});

test('car EXP that increases the VIP wage also settles past work at the old rate', async t => {
  const { s, p } = await fixture(t, now => ({ vip_exp: RULES.vip.levels[1] - RULES.vip.exp.car, vip_until: now + DAY,
    jobs: JSON.stringify([{ id: 'garage', since: now - HOUR }]) }));
  const bought = await s.call('POST', '/api/cars/buy', { token: p.token, body: { model: 'ferrari-325' } });
  assert.equal(bought.status, 200); assert.equal(bought.me.vip.level, 1);
  assert.equal(bought.me.dollars, 100000000 - bought.paid + WAGE);
  assert.equal((await s.call('POST', '/api/jobs/collect', { token: p.token })).paid, 0);
});

test('an overflowing wage checkpoint cannot consume a VIP ticket or advance its expiry', async t => {
  const { s, p } = await fixture(t, now => ({ dollars: Number.MAX_SAFE_INTEGER, vip_exp: RULES.vip.levels[1],
    jobs: JSON.stringify([{ id: 'garage', since: now - HOUR }]) }));
  s.app.db.prepare("INSERT INTO items(user_id,item,count) VALUES(?,'gacha-vip-week',1)").run(p.me.id);
  const before = s.app.db.prepare('SELECT jobs,vip_until,dollars FROM users WHERE id=?').get(p.me.id);
  const r = await s.call('POST', '/api/gacha/use', { token: p.token, body: { item: 'vip-week' } });
  assert.equal(r.status, 409); assert.equal(r.error.code, 'balance_limit');
  assert.deepEqual(s.app.db.prepare('SELECT jobs,vip_until,dollars FROM users WHERE id=?').get(p.me.id), before);
  assert.equal(s.app.db.prepare("SELECT count FROM items WHERE user_id=? AND item='gacha-vip-week'").get(p.me.id).count, 1);
});
