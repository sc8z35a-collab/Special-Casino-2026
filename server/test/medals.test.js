// 功績 (server/core/medals.js): the medals each player earns and the counts behind them, a player from
// before the medals counted at their next visit, the hidden medals unseen until they are theirs, the
// rewards (once each: $, ロイヤルコイン, ガレージコイン, free gacha tickets, シークレットアイコン and the
// シークレットオーラ, the login bonus +25%), the free tickets pulling the gacha, and a car handed back and
// forth counting once. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer } from './helpers.js';
import { MEDALS, PIONEER_UNTIL, TICKET } from '../core/medals.js';
import { keyFrom } from '../core/auth.js';
import { TABLES } from '../core/db.js';
import { PLAYER_ROWS } from '../core/purge.js';
import { RULES } from '../core/rules.js';

const M = 1e6;
const OPEN = MEDALS.filter((m) => !m.hidden).map((m) => m.id);
const HIDDEN = MEDALS.filter((m) => m.hidden).map((m) => m.id);
const key = () => Date.now() + '-' + crypto.randomBytes(16).toString('hex');

async function server(t, overrides = {}) {
  const s = await startServer({ medals: true, limits: { spin: [100000, 1000], shop: [100000, 1000], general: [100000, 1000], login: [100000, 1000], friend: [100000, 1000], transfer: [100000, 1000], read: [100000, 1000] }, ...overrides });
  t.after(() => s.stop());
  const db = s.app.db;
  const call = (method, url, p, body) => s.call(method, url, { token: p.token, body });
  const list = async (p) => { const r = await call('GET', '/api/medals', p); assert.equal(r.status, 200, JSON.stringify(r)); return r; };
  const earned = async (p) => (await list(p)).medals.filter((m) => m.earned).map((m) => m.id).sort();
  const row = (p) => db.prepare('SELECT * FROM users WHERE id = ?').get(p.me.id);
  const claim = (p, id) => call('POST', '/api/medals/claim', p, { medal: id });
  const secret = () => db.prepare("SELECT value FROM meta WHERE key = 'ticket_secret'").get().value;
  return { s, db, call, list, earned, row, claim, secret };
}
const sorted = (a) => [...a].sort();

test('the medals: 39 in all, ranked by colour, each a picture or none yet, the hidden ones with names that say nothing', () => {
  assert.equal(MEDALS.length, 39);
  assert.equal(OPEN.length, 25);
  assert.equal(new Set(MEDALS.map((m) => m.id)).size, 39);
  assert.ok(!MEDALS.some((m) => m.name.includes('有志')), '有志あるベンチャー is left out');
  for (const m of MEDALS) {
    assert.ok(['green', 'blue', 'purple', 'gold', 'red', 'secret'].includes(m.rank), m.id);
    if (m.hidden) assert.match(m.img, /^[0-9a-f]{12}$/, m.id);
  }
  assert.deepEqual(MEDALS.filter((m) => m.img === '').map((m) => m.id).sort(), ['invest-talent', 'loser', 'pioneer']);
  assert.deepEqual(MEDALS.filter((m) => m.glow).map((m) => m.id).sort(), ['certified', 'developer', 'pioneer', 'top-trader']);
  assert.ok(TABLES.includes('medals'));
  assert.ok(PLAYER_ROWS.some(([table]) => table === 'medals'));
});

test('a new player: the first medal at once, 先駆者 only for the release month, nothing hidden shown', async (t) => {
  const { s, list, earned } = await server(t);
  const early = await s.register('Early'), late = await s.register('Late');
  s.setUser(early.me.id, { created_at: PIONEER_UNTIL - 1000 });
  s.setUser(late.me.id, { created_at: PIONEER_UNTIL });
  assert.deepEqual(await earned(early), ['first', 'pioneer']);
  assert.deepEqual(await earned(late), ['first']);
  const r = await list(late);
  assert.deepEqual(sorted(r.medals.map((m) => m.id)), sorted(OPEN), 'the open medals, and none of the hidden ones');
  assert.equal(r.ready, 1);
  assert.equal(r.medals.find((m) => m.id === 'pioneer').closed, true);
  assert.equal(JSON.stringify(r).match(new RegExp(HIDDEN.map((id) => MEDALS.find((m) => m.id === id).img).join('|'))), null, 'no hidden picture named');
  // rarest last
  const ranks = r.medals.map((m) => ['green', 'blue', 'purple', 'gold', 'red', 'secret'].indexOf(m.rank));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  // a hidden medal that is not theirs cannot be claimed (the same word as for no medal at all)
  const none = await s.call('POST', '/api/medals/claim', { token: late.token, body: { medal: 'user-30' } });
  const fake = await s.call('POST', '/api/medals/claim', { token: late.token, body: { medal: 'nothing' } });
  assert.equal(none.status, 404);
  assert.deepEqual(none.error, fake.error);
});

test('a player from before the medals: what was kept counts once, and the medals already reached are theirs', async (t) => {
  const { s, db, earned, row } = await server(t);
  const p = await s.register('OldTimer'), friend = await s.register('OldFriend');
  const quests = { special: { k: 0, m: { win: 500, clear: 200, carBuy: 3 }, c: [], d: [] }, '5h': { k: 1, m: { combo: 8 }, c: [], d: [] } };
  s.setUser(p.me.id, { created_at: PIONEER_UNTIL, total_won: 12 * M, total_bet: 100 * M, login_days: 150, quests: JSON.stringify(quests) });
  const now = Date.now();
  // two trees harvested, two cars (and 3 bought before), $300M and 15M tokens given to a player, a car bought from them that is not a gift
  db.prepare("INSERT INTO trees (user_id, name, harvested, created_at) VALUES (?, 'a', 5, ?), (?, 'b', 9, ?), (?, 'c', 0, ?)").run(p.me.id, now, p.me.id, now, p.me.id, now);
  db.prepare("INSERT INTO transfers (id, from_id, to_id, currency, amount, created_at) VALUES (9001, ?, ?, 'dollars', ?, ?), (9002, ?, ?, 'tokens', ?, ?), (9003, ?, ?, 'dollars', ?, ?)")
    .run(p.me.id, friend.me.id, 300 * M, now, p.me.id, friend.me.id, 15 * M, now, p.me.id, friend.me.id, 5 * M, now);
  db.prepare("INSERT INTO messages (channel, sender_id, recipient_id, kind, amount, currency, created_at, claimed_at) VALUES ('dm:x', ?, ?, 'car_sold', ?, 'dollars', ?, ?)")
    .run(p.me.id, friend.me.id, 5 * M, now, now);
  const got = await earned(p);
  for (const id of ['first', 'rookie-hunter', 'small-rich', 'normal-win', 'cosmic', 'special-user']) assert.ok(got.includes(id), id);
  for (const id of ['tycoon', 'rookie-guild', 'super-win', 'basic-income', 'loser', 'master-spirit']) assert.ok(!got.includes(id), id);
  const u = row(p);
  assert.equal(u.wins, 500);
  assert.equal(u.best_combo, 8);
  assert.equal(u.casino_lost, (100 - 12) * M * RULES.tokenPrice);
  assert.equal(u.cars_got, 3);
  assert.equal(u.harvests, 2);
  assert.equal(u.given, 300 * M + 15 * M * RULES.tokenPrice);
  assert.equal(u.medal_init, 1);
  // counted once: what was counted since stays when it is more
  s.setUser(p.me.id, { wins: 777 });
  await earned(p);
  assert.equal(row(p).wins, 777);
});

test('spins count the wins, the ULTRA BIG WINs, the best combo and the $ lost; a goal reached is earned at once', async (t) => {
  const { s, call, earned, row } = await server(t);
  const p = await s.register('Spinner');
  s.setUser(p.me.id, { tokens: 1000000, wins: 499 });
  await earned(p);
  const live = await s.listen(p);
  t.after(() => live.close());
  const before = row(p);
  let lost = 0, wins = 0, best = before.best_combo;
  for (let i = 0; i < 80 && wins === 0; i++) {
    const r = await call('POST', '/api/spin', p, { key: key(), bet: 100 });
    assert.equal(r.status, 200, JSON.stringify(r));
    const total = r.result.total || 0;
    lost += Math.max(0, 100 - total) * RULES.tokenPrice;
    if (total > 0) wins++;
    if (r.result.combo) best = Math.max(best, r.result.combo);
  }
  assert.equal(wins, 1, 'a win came');
  const after = row(p);
  assert.equal(after.wins, 500);
  assert.equal(after.casino_lost - before.casino_lost, lost);
  assert.equal(after.best_combo, best);
  const e = await live.waitFor('medal', (d) => d.got.some((m) => m.id === 'normal-win'));
  assert.equal(e.got[0].name, 'ノーマルウィン');
  assert.ok((await earned(p)).includes('normal-win'));
});

test('a reward is received once: $, ロイヤルコイン, ガレージコイン and free gacha tickets', async (t) => {
  const { s, db, earned, row, claim } = await server(t);
  const p = await s.register('Collector');
  s.setUser(p.me.id, { coins_spent: 100, wins: 500 });
  const now = Date.now();
  for (let i = 0; i < 5; i++) db.prepare("INSERT INTO cars (owner_id, model, from_id, created_at, acquired_at, owners) VALUES (?, 'onvoro', 0, ?, ?, ?)").run(p.me.id, now, now, `,${p.me.id},`);
  const got = await earned(p);
  for (const id of ['first', 'consumer', 'car-owner-1', 'normal-win']) assert.ok(got.includes(id), id);
  const u0 = row(p);
  const a = await claim(p, 'first');
  assert.equal(a.status, 200);
  assert.deepEqual(a.reward, [{ type: 'dollars', n: 100000 }]);
  assert.equal(a.medal.claimed > 0, true);
  assert.equal(row(p).dollars, u0.dollars + 100000);
  const again = await claim(p, 'first');
  assert.equal(again.again, true);
  assert.deepEqual(again.reward, []);
  assert.equal(row(p).dollars, u0.dollars + 100000, 'not twice');
  await claim(p, 'consumer');
  assert.equal(row(p).coins, u0.coins + 12);
  await claim(p, 'car-owner-1');
  assert.equal(row(p).garage_extra, u0.garage_extra + 1);
  const ticket = await claim(p, 'normal-win');
  assert.deepEqual(ticket.reward, [{ type: 'ticket', kind: 'rare', n: 1 }]);
  assert.equal(db.prepare('SELECT count FROM items WHERE user_id = ? AND item = ?').get(p.me.id, TICKET + 'rare').count, 1);
  assert.equal(ticket.ready, (await s.call('GET', '/api/medals', { token: p.token })).ready);
});

test('a free ticket pulls the gacha without $; every pull counts, the hidden メニメニトレジャーハンター comes at 35', async (t) => {
  const { s, db, call, list, row } = await server(t);
  const p = await s.register('Puller');
  s.setUser(p.me.id, { dollars: 10 * M, gacha_pulls: 33 });
  db.prepare('INSERT INTO items (user_id, item, count) VALUES (?, ?, 1)').run(p.me.id, TICKET + 'secret');
  const g = await call('GET', '/api/gacha', p);
  assert.deepEqual(g.items.tickets, { rare: 0, legendary: 0, secret: 1 });
  assert.equal((await call('POST', '/api/gacha/spin', p, { key: key(), kind: 'rare', count: 1, ticket: true })).error.code, 'no_ticket');
  const free = await call('POST', '/api/gacha/spin', p, { key: key(), kind: 'secret', count: 1, ticket: true });
  assert.equal(free.status, 200, JSON.stringify(free));
  assert.equal(free.free, true);
  assert.equal(free.paid, 0);
  assert.equal(free.items.tickets.secret, 0);
  assert.equal(row(p).gacha_pulls, 34);
  assert.ok(!(await list(p)).medals.some((m) => m.id === 'many-many-hunter'));
  const paid = await call('POST', '/api/gacha/spin', p, { key: key(), kind: 'rare', count: 1 });
  assert.equal(paid.status, 200, JSON.stringify(paid));
  assert.equal(row(p).gacha_pulls, 35);
  const m = (await list(p)).medals.find((x) => x.id === 'many-many-hunter');
  assert.ok(m && m.earned && m.hidden, 'the hidden medal, now shown');
  assert.match(m.img, /^[0-9a-f]{12}$/);
});

test('the 30th player, the draws (0.1% and 0.01%) decided by the server key, and the developer', async (t) => {
  const { s, db, earned, secret } = await server(t);
  const players = [];
  for (let i = 1; i <= 31; i++) players.push(await s.register('Player' + i));
  const got = [];
  for (const p of players) got.push(await earned(p));
  assert.ok(got[29].includes('user-30'), 'the 30th');
  assert.ok(!got[28].includes('user-30') && !got[30].includes('user-30'));
  // the draw is the player's for good: find the next ids that win them, and make players with them
  const k = keyFrom(secret(), 'medals');
  const draw = (id, label) => crypto.createHmac('sha256', k).update(label + ':' + id).digest().readUIntBE(0, 6) / 2 ** 48;
  for (const [label, chance, id] of [['minor', 0.001, 'minor-booster'], ['ultra-minor', 0.0001, 'ultra-minor-booster']]) {
    for (const p of players) assert.equal((await earned(p)).includes(id), draw(p.me.id, label) < chance, `${id} for ${p.me.id}`);
    let next = db.prepare('SELECT MAX(id) AS n FROM users').get().n + 1;
    while (draw(next, label) >= chance) next++;
    // (an NPC row just below it: the next player gets that id, and is not counted as a player)
    db.prepare("INSERT INTO users (id, name, name_key, recovery_hash, tokens, dollars, coins, npc, created_at, last_seen) VALUES (?, ?, ?, ?, 0, 0, 0, 'gap', 1, 1)")
      .run(next - 1, 'gap' + next, 'gap' + next, 'gap' + next);
    const lucky = await s.register('Lucky' + label.length);
    assert.equal(lucky.me.id, next);
    assert.ok((await earned(lucky)).includes(id), id);
  }
  const dev = await s.register('TAKU');
  assert.ok((await earned(dev)).includes('developer'));
  assert.ok(!(await earned(players[0])).includes('developer'));
});

test('the 周年 medals come on their day, to whoever had registered by its end', async (t) => {
  let now = Date.UTC(2027, 3, 17, 14, 0);
  const { s, earned } = await server(t, { clock: () => now });
  const p = await s.register('Anniversary'), late = await s.register('Latecomer');
  s.setUser(late.me.id, { created_at: Date.UTC(2027, 3, 18, 15, 0) });
  assert.ok(!(await earned(p)).includes('anniv-0.5'));
  now = Date.UTC(2027, 3, 17, 15, 0);   // 2027/4/18 0:00 in Japan
  assert.ok((await earned(p)).includes('anniv-0.5'));
  assert.ok(!(await earned(late)).includes('anniv-0.5'));
  now = Date.UTC(2029, 9, 18);
  for (const id of ['anniv-0.5', 'anniv-1', 'anniv-1.5', 'anniv-2.0', 'anniv-3']) assert.ok((await earned(p)).includes(id), id);
});

test('エクセレントワーク: every other open medal (先駆者 not asked of one who came after its month)', async (t) => {
  const { s, db, call, earned, row } = await server(t);
  const make = async (name, created) => {
    const p = await s.register(name);
    s.setUser(p.me.id, { created_at: created, login_days: 200, total_won: 120 * M, wins: 1800, ultra_wins: 10, best_combo: 8, quests: JSON.stringify({ cleared: 3500 }),
      cars_got: 10, harvests: 6, given: 500 * M, casino_lost: 900 * M, coins_spent: 100 });
    const now = Date.now();
    for (let i = 0; i < 5; i++) db.prepare("INSERT INTO cars (owner_id, model, from_id, created_at, acquired_at) VALUES (?, 'onvoro', 0, ?, ?)").run(p.me.id, now, now);
    db.prepare("INSERT INTO stock_holdings (user_id, company, gains, dividends) VALUES (?, 'riru', ?, ?)").run(p.me.id, 900 * M, 100 * M);
    return p;
  };
  const early = await make('AllEarly', PIONEER_UNTIL - 1), late = await make('AllLate', PIONEER_UNTIL);
  const others = [];
  for (let i = 0; i < 5; i++) others.push(await s.register('Pal' + i));
  for (const p of [early, late]) for (const o of others) await s.befriend(p, o);
  assert.deepEqual((await earned(early)).filter((id) => OPEN.includes(id)).sort(), sorted(OPEN));
  assert.deepEqual((await earned(late)).filter((id) => OPEN.includes(id)).sort(), sorted(OPEN.filter((id) => id !== 'pioneer')));
  // an operator (the developer is one) is not counted among the friends
  const op = await s.register('TAKU');
  const lone = await s.register('Lone');
  for (const o of others.slice(0, 4)) await s.befriend(lone, o);
  await s.befriend(lone, op);
  assert.ok(!(await earned(lone)).includes('many-friends'));
  assert.equal(row(early).medal_init, 1);
  assert.equal((await call('GET', '/api/me', early)).me.medals, (await call('GET', '/api/medals', early)).ready);
});

test('最強トレーダー: three シークレットアイコン the player does not have yet, the シークレットオーラ, two free secret pulls and 公認メダル', async (t) => {
  const { s, db, call, earned, row, claim } = await server(t);
  const p = await s.register('Trader'), friend = await s.register('Watcher');
  await s.befriend(p, friend);
  s.setUser(p.me.id, { avatars: 'sage-secret' });
  db.prepare("INSERT INTO stock_holdings (user_id, company, gains, dividends) VALUES (?, 'riru', ?, ?), (?, 'ice', ?, ?)").run(p.me.id, 8000 * M, 300 * M, p.me.id, 100 * M, 100 * M);
  const got = await earned(p);
  assert.ok(got.includes('invest-talent') && got.includes('top-trader'));
  assert.ok(!got.includes('certified'));
  const r = await claim(p, 'top-trader');
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.icons.length, 3);
  assert.equal(new Set(r.icons).size, 3);
  const given = RULES.avatars.filter((a) => a.given).map((a) => a.id);
  for (const id of r.icons) assert.ok(given.includes(id) && id !== 'sage-secret', id);
  const u = row(p);
  assert.equal(u.aura, 1);
  assert.deepEqual(sorted(u.avatars.split(',')), sorted(['sage-secret', ...r.icons]));
  assert.equal(db.prepare('SELECT count FROM items WHERE user_id = ? AND item = ?').get(p.me.id, TICKET + 'secret').count, 2);
  assert.ok((await earned(p)).includes('certified'));
  // the icons are theirs to use (never sold, never free), the aura shows to the others
  assert.ok(r.me.avatars.includes(r.icons[0]) && r.me.aura === 1);
  assert.equal((await call('POST', '/api/avatar', p, { id: r.icons[0] })).status, 200);
  assert.equal((await call('POST', '/api/avatar', friend, { id: r.icons[0] })).error.code, 'locked');
  assert.equal((await call('POST', '/api/avatar/buy', friend, { id: r.icons[0] })).status, 400);
  assert.ok(!(await call('GET', '/api/me', friend)).me.avatars.includes(r.icons[0]));
  assert.ok(!(await call('GET', '/api/me', friend)).iconShop.items.some((i) => given.includes(i.id)));
  assert.equal((await call('GET', `/api/user?id=${p.me.id}`, friend)).user.aura, 1);
  assert.equal((await call('GET', '/api/friends', friend)).friends.find((f) => f.id === p.me.id).aura, 1);
  // a register cannot pick one
  assert.equal((await s.call('POST', '/api/register', { body: { name: 'Picker', password: 'pass1234', avatar: r.icons[0] } })).error.code, 'locked');
});

test('a car handed back and forth counts once for カーオーナーII', async (t) => {
  const { s, db, call, row } = await server(t);
  const a = await s.register('CarA'), b = await s.register('CarB');
  await s.befriend(a, b);
  s.setUser(a.me.id, { dollars: 50 * M });
  const bought = await call('POST', '/api/cars/buy', a, { model: 'onvoro' });
  assert.equal(bought.status, 200, JSON.stringify(bought));
  assert.equal(row(a).cars_got, 1);
  const hand = async (from, to) => {
    assert.equal((await call('POST', '/api/cars/gift', from, { to: to.me.id, car: bought.car.id })).status, 200);
    const m = db.prepare("SELECT id FROM messages WHERE recipient_id = ? AND kind = 'gift' AND claimed_at = 0 ORDER BY id DESC").get(to.me.id);
    assert.equal((await call('POST', '/api/messages/claim', to, { message: m.id })).status, 200);
  };
  await hand(a, b);
  assert.equal(row(b).cars_got, 1);
  await hand(b, a);
  await hand(a, b);
  assert.equal(row(a).cars_got, 1);
  assert.equal(row(b).cars_got, 1);
  assert.equal(db.prepare('SELECT owners FROM cars WHERE id = ?').get(bought.car.id).owners, `,${a.me.id},${b.me.id},`);
});

test('バイタルトレジャーハンター: once received, the login bonus is 25% more', async (t) => {
  const { s, call, claim, row } = await server(t, { loginBonus: true });
  const p = await s.register('Vital');
  await call('GET', '/api/me', p);
  s.setUser(p.me.id, { login_days: 199, login_day: '' });
  const first = await call('GET', '/api/me', p);
  assert.equal(first.loginBonus.loginDays, 200);
  assert.equal(first.loginBonus.boost, undefined);
  assert.equal((await claim(p, 'vital-hunter')).status, 200);
  const tokens = row(p).tokens;
  s.setUser(p.me.id, { login_day: '' });
  const next = await call('GET', '/api/me', p);
  const base = RULES.loginBonus.days[(201 - 1) % RULES.loginBonus.days.length];
  assert.equal(next.loginBonus.amount, Math.round(base * 1.25));
  assert.equal(next.loginBonus.boost, 25);
  assert.equal(row(p).tokens, tokens + Math.round(base * 1.25));
});

test('quests cleared add up past 特別 (it stops at 200): the 600th is ルーキーギルドマスター', async (t) => {
  const { s, call, earned, row } = await server(t, { quests: true });
  const p = await s.register('Quester');
  s.setUser(p.me.id, { tokens: 100000, quests: JSON.stringify({ cleared: 599 }) });
  assert.ok(!(await earned(p)).includes('rookie-guild'));
  assert.equal((await call('POST', '/api/spin', p, { key: key(), bet: 100 })).status, 200);
  assert.ok(JSON.parse(row(p).quests).cleared >= 600);
  assert.ok((await earned(p)).includes('rookie-guild'));
});

test('with the medals off, nothing is earned and the game is told there are none waiting', async (t) => {
  const s = await startServer({ medals: false });
  t.after(() => s.stop());
  const p = await s.register('Off');
  const r = await s.call('GET', '/api/medals', { token: p.token });
  assert.equal(r.medals.filter((m) => m.earned).length, 0);
  assert.equal((await s.call('GET', '/api/me', { token: p.token })).me.medals, 0);
  assert.equal((await s.call('POST', '/api/medals/claim', { token: p.token, body: { medal: 'first' } })).status, 404);
});
