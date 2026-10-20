// 金の生る木: giving money, the $ a second, harvest cycles, SUPER trees and the auctions: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES, TREE } from '../core/rules.js';

const T = RULES.tree;
let s, call, register, setUser;

before(async () => {
  s = await startServer();
  ({ call, register, setUser } = s);
});
after(() => s.stop());

const tree = (id) => s.app.db.prepare('SELECT * FROM trees WHERE id = ?').get(id);
const setTree = (id, f) => {
  const cols = Object.keys(f);
  s.app.db.prepare(`UPDATE trees SET ${cols.map((c) => c + ' = ?').join(', ')} WHERE id = ?`).run(...cols.map((c) => f[c]), id);
};

test('金の生る木: the $ a second climbs smoothly through the given points, the look has 9 stages', () => {
  assert.deepEqual([0, 150000, 200000, 500000, 1500000, 3000000, 6000000, 10000000, 99000000].map((g) => TREE.rateOf(g)), [5, 10, 12, 14, 15, 18, 20, 21, 21]);
  // no jumps: half way between two points, half way between their rates
  assert.equal(TREE.rateOf(8000000), 20.5);
  assert.equal(TREE.rateOf(75000), 7.5);
  for (let g = 0; g < 12000000; g += 5000) assert.ok(TREE.rateOf(g + 5000) >= TREE.rateOf(g));
  assert.deepEqual([0, 149999, 150000, 9999999, 10000000, 20000000].map((g) => TREE.stageOf(g)), [1, 1, 2, 7, 8, 9]);
  assert.equal(TREE.stages, 9);
  assert.deepEqual(T.cycles.map((c) => [c.id, c.ms, c.mult]), [['30m', 1800000, 1], ['2h', 7200000, 1.1], ['1d', 86400000, 1.2], ['1w', 604800000, 1.6]]);
});

test('金の生る木: one free tree, money given in one tap, a cycle that cannot be cut short, the harvest', async () => {
  const p = await register('Gardener');
  let r = await call('GET', '/api/tree', { token: p.token });
  assert.equal(r.trees.length, 1);
  const id = r.trees[0].id;
  assert.equal(r.trees[0].name, '金の生る木');
  assert.equal((await call('POST', '/api/tree/start', { token: p.token, body: { tree: id, cycle: '30m' } })).error.code, 'no_money', 'give first');
  assert.equal((await call('POST', '/api/tree/give', { token: p.token, body: { tree: id, amount: 12345 } })).error.code, 'bad_amount');
  const before0 = (await call('GET', '/api/me', { token: p.token })).me.dollars;
  for (const a of T.amounts) assert.equal((await call('POST', '/api/tree/give', { token: p.token, body: { tree: id, amount: a } })).status, 200);
  const given = T.amounts.reduce((x, y) => x + y, 0);
  assert.equal(tree(id).given, given);
  assert.equal((await call('GET', '/api/me', { token: p.token })).me.dollars, before0 - given);
  r = await call('POST', '/api/tree/start', { token: p.token, body: { tree: id, cycle: '2h' } });
  assert.equal(r.tree.cycle.id, '2h');
  assert.equal((await call('POST', '/api/tree/start', { token: p.token, body: { tree: id, cycle: '30m' } })).error.code, 'growing', 'picked once');
  assert.equal((await call('POST', '/api/tree/harvest', { token: p.token, body: { tree: id } })).error.code, 'not_ready');
  // two hours later: rate x 7200 s x 1.1
  const now = Date.now();
  setTree(id, { cycle_at: now - 7200000 - 5000, cycle_end: now - 5000, grown: 0, grown_at: now - 7200000 - 5000 });
  const rate = TREE.rateOf(given);
  r = await call('GET', '/api/tree', { token: p.token });
  assert.equal(r.trees[0].ready, true);
  const want = Math.floor(rate * 7200 * 1.1);
  assert.ok(Math.abs(r.trees[0].value - want) <= 1, `${r.trees[0].value} vs ${want}`);
  const before1 = (await call('GET', '/api/me', { token: p.token })).me.dollars;
  r = await call('POST', '/api/tree/harvest', { token: p.token, body: { tree: id, next: '1w' } });
  assert.ok(Math.abs(r.paid - want) <= 1);
  assert.equal(r.balance.dollars, before1 + r.paid);
  assert.equal(r.tree.cycle.id, '1w', 'the next cycle starts at once');
  assert.equal(r.tree.grown, 0);
  // money given while growing: what grew so far stays at the old rate
  setTree(id, { cycle_at: now - 3600000, cycle_end: now + 6 * 86400000, grown: 0, grown_at: now - 3600000 });
  await call('POST', '/api/tree/give', { token: p.token, body: { tree: id, amount: 100000 } });
  const g = tree(id).grown;
  assert.ok(Math.abs(g - rate * 3600) < rate * 2, `${g} vs ${rate * 3600}`);
  assert.ok(TREE.rateOf(tree(id).given) > rate);
});

test('金の生る木: a SUPER tree pays x1.1 for good', async () => {
  const p = await register('SuperGrow');
  const id = (await call('GET', '/api/tree', { token: p.token })).trees[0].id;
  setTree(id, { super: 1, given: 150000, cycle: '1d', cycle_at: Date.now() - 86400000 - 1000, cycle_end: Date.now() - 1000, grown: 0, grown_at: Date.now() - 86400000 - 1000 });
  const r = await call('POST', '/api/tree/harvest', { token: p.token, body: { tree: id } });
  const want = Math.floor(10 * 86400 * 1.2 * 1.1);
  assert.ok(Math.abs(r.paid - want) <= 1, `${r.paid} vs ${want}`);
});

test('金の生る木 auctions: NPC bidders, leaving, winning (SUPER shows only then), losing', async () => {
  const p = await register('Bidder');
  setUser(p.me.id, { dollars: 500000000 });
  await call('GET', '/api/tree', { token: p.token });
  assert.equal((await call('POST', '/api/tree/auction/start', { token: p.token, body: { market: 'nope' } })).error.code, 'bad_market');
  let r = await call('POST', '/api/tree/auction/start', { token: p.token, body: { market: 'seed' } });
  assert.equal(r.auction.status, 'live');
  assert.equal(r.auction.avg, T.markets.seed.second, 'the 2nd tree');
  assert.equal(r.auction.lot.super, undefined, 'not told while bidding');
  assert.equal((await call('POST', '/api/tree/auction/start', { token: p.token, body: { market: 'grown' } })).error.code, 'busy');
  // leave: nothing paid
  const before = (await call('GET', '/api/me', { token: p.token })).me.dollars;
  r = await call('POST', '/api/tree/auction/leave', { token: p.token });
  assert.equal(r.auction.status, 'left');
  assert.equal((await call('GET', '/api/me', { token: p.token })).me.dollars, before);
  // win: the NPCs' limits made low, my bid stands until the hammer
  r = await call('POST', '/api/tree/auction/start', { token: p.token, body: { market: 'grown' } });
  const row = s.app.db.prepare("SELECT * FROM tree_auctions WHERE user_id = ? AND status = 'live'").get(p.me.id);
  const st = JSON.parse(row.state);
  st.npcs.forEach((n) => { n.limit = st.price; });
  st.lot.super = true;
  s.app.db.prepare('UPDATE tree_auctions SET state = ? WHERE id = ?').run(JSON.stringify(st), row.id);
  r = await call('POST', '/api/tree/auction/bid', { token: p.token, body: {} });
  assert.equal(r.auction.leader, 'me');
  const price = r.auction.price;
  assert.equal((await call('POST', '/api/tree/auction/bid', { token: p.token, body: {} })).error.code, 'leading');
  // the hammer falls
  const s2 = JSON.parse(s.app.db.prepare('SELECT state FROM tree_auctions WHERE id = ?').get(row.id).state);
  s2.close = Date.now() - 10;
  s.app.db.prepare('UPDATE tree_auctions SET state = ? WHERE id = ?').run(JSON.stringify(s2), row.id);
  r = await call('GET', '/api/tree/auction', { token: p.token });
  assert.equal(r.auction.status, 'won');
  assert.equal(r.auction.lot.super, true);
  assert.ok(r.auction.tree.name.startsWith('SUPER '));
  assert.ok(r.auction.tree.stage >= 2, 'grown: at least one look on');
  assert.equal(r.balance.dollars, before - price);
  const ts = (await call('GET', '/api/tree', { token: p.token })).trees;
  assert.equal(ts.length, 2);
  // the 3rd tree costs more
  r = await call('POST', '/api/tree/auction/start', { token: p.token, body: { market: 'seed' } });
  assert.equal(r.auction.avg, T.markets.seed.more);
  // nobody else wants it: the NPCs bid it up among themselves and one wins
  const row3 = s.app.db.prepare("SELECT * FROM tree_auctions WHERE user_id = ? AND status = 'live'").get(p.me.id);
  const st3 = JSON.parse(row3.state);
  st3.next = Date.now() - 60000;
  st3.close = Date.now() - 60000 + 6000;
  s.app.db.prepare('UPDATE tree_auctions SET state = ? WHERE id = ?').run(JSON.stringify(st3), row3.id);
  r = await call('GET', '/api/tree/auction', { token: p.token });
  assert.equal(r.auction.status, 'lost');
  assert.ok(r.auction.winner);
  assert.equal((await call('GET', '/api/tree', { token: p.token })).trees.length, 2);
});

test('金の生る木 auctions: the average winning price is about the market price', () => {
  // the price a player who always bids again pays: about the highest NPC limit
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let sum = 0;
  const N = 40000;
  for (let i = 0; i < N; i++) {
    const n = 3 + Math.floor(Math.random() * 3);
    const lim = [];
    for (let k = 0; k < n; k++) lim.push(Math.exp(-0.21 + 0.13 * gauss()));
    if (Math.random() < 0.12) lim[0] = Math.max(lim[0], 1.25 + Math.random() * 0.5);
    sum += Math.max(...lim) + 0.01;
  }
  const mean = sum / N;
  assert.ok(mean > 0.97 && mean < 1.04, String(mean));
});
