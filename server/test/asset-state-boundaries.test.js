import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer } from './helpers.js';
import { createGacha } from '../core/gacha.js';
import { purgePlayer } from '../core/purge.js';
import { GACHA, RULES } from '../core/rules.js';
const key = () => Date.now() + '-' + crypto.randomBytes(16).toString('hex');
async function fixture(t) {
  const s = await startServer({ startTokens: 10000, startDollars: 100000000 }); t.after(() => s.stop());
  const a = await s.register('AssetOwner'), b = await s.register('AssetFriend'); await s.befriend(a, b);
  return { s, a, b, q: sql => s.app.db.prepare(sql) };
}

for (const item of ['seed', 'gacha-grown-tree']) test(`claiming ${item} before opening the tree screen preserves the free starter tree`, async t => {
  const { s, a, q } = await fixture(t);
  q('INSERT INTO items(user_id,item,count) VALUES(?,?,1)').run(a.me.id, item === 'seed' ? 'gacha-seed' : item);
  assert.equal(q('SELECT COUNT(*) AS n FROM trees WHERE user_id=?').get(a.me.id).n, 0);
  assert.equal((await s.call('POST', '/api/gacha/use', { token: a.token, body: { item } })).status, 200);
  const trees = (await s.call('GET', '/api/tree', { token: a.token })).trees;
  assert.equal(trees.length, 2); assert.equal(trees.filter(x => x.given === 0).length, item === 'seed' ? 2 : 1);
  assert.equal((await s.call('GET', '/api/tree', { token: a.token })).trees.length, 2);
});

for (const count of [1, 10]) test(`a ${count}-pull mature-tree draw reserves the starter and preserves every prize at capacity`, async t => {
  const { s, a, q } = await fixture(t), getUser = id => q('SELECT * FROM users WHERE id=?').get(id);
  const itemsOf = id => Object.fromEntries(q('SELECT item,count FROM items WHERE user_id=?').all(id).map(r => [r.item, r.count]));
  const addItems = (id, item, n) => q('INSERT INTO items(user_id,item,count) VALUES(?,?,?) ON CONFLICT(user_id,item) DO UPDATE SET count=count+excluded.count').run(id, item, n);
  let now = Date.parse('2026-10-26T00:00:00Z');
  while (GACHA.events(now).boost.on || GACHA.events(now).sale.on) now += 3600000;
  let before = 0, roll;
  for (const reward of GACHA.odds('rare', false)) { if (reward.id === 'grown-tree') { roll = (before + reward.chance / 2) / 100; break; } before += reward.chance; }
  assert.ok(roll > 0);
  const gacha = createGacha({ q, tx: fn => s.app.db.tx(fn), getUser, meDto: u => u, itemsOf, addItems, balanceChanged: getUser, afterSpend() {}, now: () => now, rand: () => roll });
  const result = await gacha.routes['POST /api/gacha/spin']({ json: async () => ({ kind: 'rare', count }) }, a.me);
  const trees = q('SELECT * FROM trees WHERE user_id=?').all(a.me.id), planted = Math.min(count * 3, RULES.tree.max - 1);
  assert.equal(trees.length, planted + 1); assert.equal(trees.filter(x => x.given === 0).length, 1);
  assert.equal(trees.filter(x => x.given === GACHA.grownGiven).length, planted);
  assert.equal(itemsOf(a.me.id)['gacha-grown-tree'] || 0, count * 3 - planted);
  assert.equal(result.pulls.flatMap(p => p.rewards).length, count * 3);
});

test('gifting a car with rental earnings publishes the new sender balance once', async t => {
  // (what reaches the giver: the takings less MAGITA Garage's 15%)
  const { s, a, b, q } = await fixture(t), earned = 12345 - Math.floor(12345 * 0.15);
  const car = Number(q("INSERT INTO cars(owner_id,model,from_id,created_at,acquired_at,paid,rent_earned) VALUES(?,'two-state-sedan',0,?,?,1,?)").run(a.me.id, Date.now(), Date.now(), 12345).lastInsertRowid);
  const events = [], send = s.app.live.send;
  t.mock.method(s.app.live, 'send', function (...args) { events.push(args); return send.apply(this, args); });
  const body = { car, to: b.me.id }, r = await s.call('POST', '/api/cars/gift', { token: a.token, body }); assert.equal(r.status, 200);
  assert.equal(q('SELECT dollars FROM users WHERE id=?').get(a.me.id).dollars, a.me.dollars + earned);
  const balances = events.filter(([id, event]) => id === a.me.id && event === 'balance');
  assert.equal(balances.length, 1); assert.equal(balances[0][2].dollars, a.me.dollars + earned);
  assert.equal((await s.call('POST', '/api/cars/gift', { token: a.token, body })).status, 404);
  assert.equal(events.filter(([id, event]) => id === a.me.id && event === 'balance').length, 1);
});

test('a failed gift cannot publish or collect the car rental earnings', async t => {
  const { s, a, b, q } = await fixture(t); t.mock.method(console, 'error', () => {});
  const car = Number(q("INSERT INTO cars(owner_id,model,from_id,created_at,acquired_at,paid,rent_earned) VALUES(?,'two-state-sedan',0,?,?,1,12345)").run(a.me.id, Date.now(), Date.now()).lastInsertRowid);
  const events = [], send = s.app.live.send; t.mock.method(s.app.live, 'send', function (...args) { events.push(args); return send.apply(this, args); });
  s.app.db.exec("CREATE TRIGGER reject_car_gift BEFORE INSERT ON messages WHEN NEW.kind='gift' BEGIN SELECT RAISE(ABORT,'simulated gift failure'); END");
  assert.equal((await s.call('POST', '/api/cars/gift', { token: a.token, body: { car, to: b.me.id } })).status, 500);
  assert.equal(q('SELECT dollars FROM users WHERE id=?').get(a.me.id).dollars, a.me.dollars);
  assert.equal(q('SELECT owner_id FROM cars WHERE id=?').get(car).owner_id, a.me.id);
  assert.equal(events.some(([, event]) => event === 'balance'), false);
});

test('purging account data removes both spin receipt snapshots and preserves other accounts', async t => {
  const { s, a, b, q } = await fixture(t);
  for (const p of [a, b]) {
    assert.equal((await s.call('POST', '/api/spin', { token: p.token, body: { key: key(), bet: 100 } })).status, 200);
    assert.equal((await s.call('POST', '/api/gacha/spin', { token: p.token, body: { key: key(), kind: 'rare', count: 1 } })).status, 200);
  }
  assert.ok(q('SELECT response FROM gacha_requests WHERE user_id=?').get(a.me.id).response.includes(a.me.name));
  purgePlayer(q, fn => s.app.db.tx(fn), a.me.id);
  for (const table of ['spin_requests', 'gacha_requests']) {
    assert.equal(q(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=?`).get(a.me.id).n, 0);
    assert.equal(q(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=?`).get(b.me.id).n, 1);
  }
});

for (const action of ['bid', 'leave']) test(`a delayed ${action} for an old auction cannot change its replacement`, async t => {
  const { s, a, q } = await fixture(t), token = a.token;
  const first = await s.call('POST', '/api/tree/auction/start', { token, body: { market: 'seed' } }); assert.equal(first.status, 200);
  await s.call('POST', '/api/tree/auction/leave', { token, body: { id: first.auction.id } });
  const next = await s.call('POST', '/api/tree/auction/start', { token, body: { market: 'seed' } }); assert.equal(next.status, 200);
  const state = JSON.parse(q('SELECT state FROM tree_auctions WHERE id=?').get(next.auction.id).state);
  state.starts = Date.now() - 1; state.next = 0;
  q('UPDATE tree_auctions SET state=? WHERE id=?').run(JSON.stringify(state), next.auction.id);
  const before = q('SELECT * FROM tree_auctions WHERE id=?').get(next.auction.id);
  const late = await s.call('POST', '/api/tree/auction/' + action, { token, body: { id: first.auction.id, steps: 1 } });
  assert.equal(late.status, 409); assert.equal(late.error.code, 'auction_changed');
  assert.deepEqual(q('SELECT * FROM tree_auctions WHERE id=?').get(next.auction.id), before);
  assert.equal((await s.call('POST', '/api/tree/auction/' + action, { token, body: { id: next.auction.id, steps: 1 } })).status, 200);
});
