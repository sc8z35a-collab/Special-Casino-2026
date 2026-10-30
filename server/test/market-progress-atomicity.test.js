import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES, AVATARS, carSale, carPrice, CARS, shopSale } from '../core/rules.js';

const HOUR = 3600000;
async function fixture(t) {
  const now = Date.now(); t.mock.method(Date, 'now', () => now);
  const s = await startServer({ quests: true }); t.after(() => s.stop());
  t.mock.method(console, 'error', () => {});
  const a = await s.register('AtomicMarket'), b = await s.register('MarketFriend');
  await s.befriend(a, b);
  s.setUser(a.me.id, { dollars: 1000000000, tokens: 10000, coins: 10000, xp: 1000000, quests: '{}' });
  return { s, a, b, now };
}
function snapshot(s) {
  const q = sql => s.app.db.prepare(sql);
  return {
    users: q('SELECT id,dollars,tokens,coins,rev,avatars,avatar,garage_extra,quests,xp,jobs,vip_exp,vip_until,vip_modes,vip_trial_until FROM users ORDER BY id').all(),
    cars: q('SELECT * FROM cars ORDER BY id').all(), items: q('SELECT * FROM items ORDER BY user_id,item').all(),
    messages: q('SELECT * FROM messages ORDER BY id').all(), transfers: q('SELECT * FROM transfers ORDER BY id').all()
  };
}
async function checkRollback(f, path, body, verify) {
  const { s, a } = f, before = snapshot(s), events = [], send = s.app.live.send;
  s.app.live.send = function (...args) { events.push(args); return send.apply(this, args); };
  s.app.db.exec(`CREATE TRIGGER fail_market_progress BEFORE UPDATE OF quests ON users
    WHEN NEW.id=${a.me.id} AND NEW.quests != OLD.quests BEGIN SELECT RAISE(ABORT,'simulated progress save failure'); END`);
  const result = await s.call('POST', path, { token: a.token, body });
  assert.equal(result.status, 500, JSON.stringify(result));
  assert.deepEqual(snapshot(s), before, 'a failed progress save must not commit the purchase, wages or VIP change');
  assert.equal(events.some(([, kind]) => ['balance', 'quest', 'tip', 'msg', 'card', 'watch'].includes(kind)), false, 'failed actions must publish no settlement');
  s.app.db.exec('DROP TRIGGER fail_market_progress');
  const retried = await s.call('POST', path, { token: a.token, body });
  assert.equal(retried.status, 200, JSON.stringify(retried));
  await verify(retried);
}

for (const kind of ['avatar', 'item', 'garage']) test(`${kind} purchase rolls back its charge and asset when broke-quest storage fails`, async t => {
  const f = await fixture(t), { s, a } = f;
  const avatar = [...AVATARS.values()].find(x => x.price > 0), item = RULES.shop.find(x => x.id === 'repair-kit');
  const price = kind === 'avatar' ? avatar.price : kind === 'item' ? shopSale(item).price : RULES.garage.slotPrice;
  assert.ok(price > 0); s.setUser(a.me.id, { dollars: price, tokens: 0, quests: '{}' });
  const path = kind === 'avatar' ? '/api/avatar/buy' : kind === 'item' ? '/api/shop/buy' : '/api/garage/expand';
  const body = { id: kind === 'avatar' ? avatar.id : item.id, price };
  await checkRollback(f, path, body, r => { assert.equal(r.me.dollars, 0); assert.ok(r.me.questsReady > 0); });
});

test('buying a new car keeps payment, ownership, VIP EXP and car quests atomic', async t => {
  const f = await fixture(t), { s, a } = f;
  const model = CARS.get('two-state-sedan'), price = carPrice(model, carSale()).price;
  await checkRollback(f, '/api/cars/buy', { model: model.id, price }, r => {
    assert.equal(r.me.dollars, 1000000000 - price);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM cars WHERE owner_id=?').get(a.me.id).n, 1);
  });
});

test('buying a friend car cannot transfer the car or publish its sale before car progress is durable', async t => {
  const f = await fixture(t), { s, a, b, now } = f;
  const car = Number(s.app.db.prepare('INSERT INTO cars(owner_id,model,created_at,acquired_at,paid) VALUES(?,?,?,?,?)').run(b.me.id, 'two-state-sedan', now, now, 26500000).lastInsertRowid);
  const offer = await s.call('POST', '/api/cars/offer', { token: b.token, body: { to: a.me.id, car, price: 26500000 } });
  assert.equal(offer.status, 200, JSON.stringify(offer));
  await checkRollback(f, '/api/cars/offer/buy', { id: offer.message.id }, r => {
    assert.equal(r.state, 'sold'); assert.equal(s.app.db.prepare('SELECT owner_id FROM cars WHERE id=?').get(car).owner_id, a.me.id);
    assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE kind='car_sold'").get().n, 1);
  });
});

test('fruit tipping rolls back both balances and transfer records if fruit progress fails', async t => {
  const f = await fixture(t), { s, a, b } = f;
  assert.equal((await s.call('POST', '/api/watch', { token: a.token, body: { user: b.me.id, on: true } })).status, 200);
  s.setUser(a.me.id, { quests: '{}' });
  await checkRollback(f, '/api/tip', { to: b.me.id, fruits: { strawberry: 1 } }, r => { assert.equal(r.amount, 1000); assert.equal(r.balance.tokens, 9000); });
});

for (const action of ['collect', 'stop']) test(`job ${action} keeps unpaid wages available if wage progress fails`, async t => {
  const f = await fixture(t), { s, a, now } = f;
  s.setUser(a.me.id, { jobs: JSON.stringify([{ id: 'garage', since: now - HOUR }]), quests: '{}' });
  await checkRollback(f, '/api/jobs/' + action, { id: 'garage' }, r => {
    assert.equal(r.paid, RULES.jobs[0].wage); assert.equal(r.balance.dollars, 1000000000 + r.paid);
  });
});

for (const action of ['trial', 'extend']) test(`VIP ${action} cannot commit its expiry or wage checkpoint before wage progress`, async t => {
  const f = await fixture(t), { s, a, now } = f;
  s.setUser(a.me.id, { jobs: JSON.stringify([{ id: 'garage', since: now - HOUR }]), quests: '{}' });
  await checkRollback(f, '/api/vip/' + action, { days: 1 }, r => {
    assert.equal(r.paid, RULES.jobs[0].wage); assert.equal(r.me.dollars, 1000000000 + r.paid); assert.ok(r.me.vip.until > now);
  });
});

test('VIP purchase without a wage still rolls back its coins and expiry if milestone storage fails', async t => {
  const f = await fixture(t), { s, a, now } = f;
  await checkRollback(f, '/api/vip/extend', { days: 1 }, r => { assert.ok(r.me.vip.until > now); assert.ok(r.me.coins < 10000); });
});

test('a friend car purchase cannot consume its offer when quest VIP EXP overflows the wage balance', async t => {
  const f = await fixture(t), { s, a, b, now } = f;
  s.setUser(a.me.id, { dollars: Number.MAX_SAFE_INTEGER, vip_exp: RULES.vip.levels[1] - RULES.vip.exp.quest,
    vip_until: now + 86400000, jobs: JSON.stringify([{ id: 'garage', since: now - HOUR }]), quests: '{}' });
  const car = Number(s.app.db.prepare('INSERT INTO cars(owner_id,model,created_at,acquired_at,paid) VALUES(?,?,?,?,?)').run(b.me.id, 'two-state-sedan', now, now, 100).lastInsertRowid);
  const offered = await s.call('POST', '/api/cars/offer', { token: b.token, body: { to: a.me.id, car, price: 100 } }); assert.equal(offered.status, 200);
  const before = snapshot(s), body = { id: offered.message.id };
  const result = await s.call('POST', '/api/cars/offer/buy', { token: a.token, body });
  assert.deepEqual([result.status, result.error?.code], [409, 'balance_limit']); assert.deepEqual(snapshot(s), before);
  s.setUser(a.me.id, { dollars: 1000000 });
  const retried = await s.call('POST', '/api/cars/offer/buy', { token: a.token, body }); assert.equal(retried.status, 200);
  assert.equal(s.app.db.prepare('SELECT owner_id FROM cars WHERE id=?').get(car).owner_id, a.me.id);
});
