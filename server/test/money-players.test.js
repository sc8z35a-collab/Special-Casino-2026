// The money ledger, the players' side: everything a player can do with money, through the server, a country of
// people and companies living beside them — and the players' money (their $, their tokens, what is held for them)
// moves by exactly what crossed between them and the country, day after day (server/core/money.js). No $ made or lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES } from '../core/rules.js';
import { playersMoney } from '../core/money.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0), DAY = 86400000;

test('every way a player\'s money moves, through the server: the players\' ledger and the country\'s never move', async (t) => {
  let now = START;
  const s = await startServer({ clock: () => now, corpHistory: 0, npc: true, npcPopulation: 500, loginBonus: true, quests: true, medals: true, npcGifts: true, milestones: true });
  t.after(() => s.stop());
  const a = await s.register('払う人'), b = await s.register('受け取る人');
  await s.befriend(a, b);
  // (their money to play with: set before the ledger's first day — the only $ not paid by anyone)
  s.setUser(a.me.id, { dollars: 3000000000, tokens: 200000 });
  s.setUser(b.me.id, { dollars: 1000000000, tokens: 100000 });
  const W = () => s.app.api.npc.world();
  const q = (sql) => s.app.db.prepare(sql);
  const look = () => s.call('GET', '/api/stocks', { token: a.token });
  // a day closed: the clock past its end, the market looked at (the companies' day, the country's)
  async function close(label) {
    now += DAY;
    await look();
    await s.app.api.npcWake();
    const L = W().ledger, P = L && L.players;
    assert.ok(P, `${label}: the players' ledger counted`);
    const last = P.days[P.days.length - 1];
    assert.equal(last.moved, 0, `${label}: the players' money moved by ${last.moved} beyond what crossed (${JSON.stringify(last)})`);
    assert.equal(L.days[L.days.length - 1].moved, 0, `${label}: the country's ledger moved`);
    return last;
  }
  await look();
  await s.app.api.npcWake();
  await close('the first day');

  // the bank: tokens bought with $ and sold back (Dtrade's fee), the day's free tokens (the treasury's)
  assert.equal((await s.call('POST', '/api/buy', { token: a.token, body: { amount: 1000 } })).status, 200);
  assert.equal((await s.call('POST', '/api/sell', { token: a.token, body: { amount: 50000 } })).status, 200);
  assert.equal((await s.call('POST', '/api/daily', { token: b.token })).status, 200);
  // spins: what a bet lost Dtrade's, a win beyond it the treasury's
  for (let i = 0; i < 40; i++) {
    const r = await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
    assert.equal(r.status, 200, JSON.stringify(r).slice(0, 200));
  }
  await close('the bank and the slots');

  // between friends: a transfer of each money, a present, fruit — taken, or still waiting (held for them)
  const tr = await s.call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, currency: 'dollars', amount: 1000000 } });
  assert.equal(tr.status, 200, JSON.stringify(tr).slice(0, 200));
  assert.equal((await s.call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, currency: 'tokens', amount: 3000 } })).status, 200);
  const pr = RULES.presents[0];
  const present = await s.call('POST', '/api/present', { token: a.token, body: { to: b.me.id, id: pr.id } });
  assert.equal(present.status, 200, JSON.stringify(present).slice(0, 200));
  const waiting = q("SELECT id FROM messages WHERE kind = 'transfer' AND pending = 1 AND claimed_at = 0 AND recipient_id = ?").all(b.me.id);
  assert.equal(waiting.length, 2);
  await close('sent, not taken yet');
  assert.equal((await s.call('POST', '/api/messages/claim', { token: b.token, body: { message: waiting[0].id } })).status, 200);
  const presentId = q("SELECT id FROM messages WHERE kind = 'present' AND recipient_id = ?").get(b.me.id).id;
  assert.equal((await s.call('POST', '/api/present/claim', { token: b.token, body: { message: presentId } })).status, 200);
  await close('taken');

  // a transfer never taken: back to the friend who sent it when its time runs out (never lost)
  q('UPDATE messages SET created_at = ? WHERE id = ?').run(Date.now() - (RULES.receiveDays.money + 1) * DAY, waiting[1].id);
  const before = playersMoney((sql) => s.app.db.prepare(sql), RULES.tokenPrice).total;
  await s.app.api.housekeeping();
  assert.equal(q('SELECT state FROM messages WHERE id = ?').get(waiting[1].id).state, 'lapsed');
  assert.equal(playersMoney((sql) => s.app.db.prepare(sql), RULES.tokenPrice).total, before);
  await close('a transfer lapsed');

  // the market: shares bought and sold, a day's dividends paid as it closes and taken
  for (const company of ['magita', 'tenesice', 'myway']) {
    const r = await s.call('POST', '/api/stocks/order', { token: a.token, body: { key: 'test-key-buy-' + company, company, side: 'buy', type: 'market', shares: 2000 } });
    assert.equal(r.status, 200, JSON.stringify(r).slice(0, 300));
  }
  await close('shares bought');
  await close('a day of dividends');
  const got = q('SELECT pending FROM stock_accounts WHERE user_id = ?').get(a.me.id);
  assert.ok(got && got.pending > 0, 'dividends paid as the days closed');
  assert.equal((await s.call('POST', '/api/stocks/claim', { token: a.token, body: {} })).status, 200);
  const sell = await s.call('POST', '/api/stocks/order', { token: a.token, body: { key: 'test-key-sell-magita', company: 'magita', side: 'sell', type: 'market', shares: 1000 } });
  assert.equal(sell.status, 200, JSON.stringify(sell).slice(0, 300));
  await close('dividends taken, shares sold');

  // the companies' sales: the shop, an icon (MY WAY's), a bigger garage, the money trees' fertilizer, the gacha
  const ok = async (label, r) => { const x = await r; assert.equal(x.status, 200, `${label}: ${JSON.stringify(x).slice(0, 300)}`); return x; };
  await ok('shop', s.call('POST', '/api/shop/buy', { token: a.token, body: { id: 'omamori', count: 1 } }));
  await ok('icon', s.call('POST', '/api/avatar/buy', { token: a.token, body: { id: 'adventurer-blue' } }));
  await ok('garage', s.call('POST', '/api/garage/expand', { token: a.token, body: {} }));
  const tree = (await s.call('GET', '/api/tree', { token: a.token })).trees[0].id;
  await ok('tree', s.call('POST', '/api/tree/give', { token: a.token, body: { tree, amount: RULES.tree.amounts[0] } }));
  await ok('gacha', s.call('POST', '/api/gacha/spin', { token: a.token, body: { kind: 'rare', count: 1 } }));
  // ロイヤルコイン bought back by DAIZIN with its own $ (the coins themselves are not money)
  s.setUser(b.me.id, { coins: 20 });
  await ok('coins', s.call('POST', '/api/coins/sell', { token: b.token, body: { amount: 10 } }));
  await close('the shop, an icon, the garage, a tree, the gacha, coins bought back');

  // cars: one bought of the dealer, sold back to it; one sold to a friend, its price taken; one whose price was never
  // taken — the seller's when its time runs out
  // (whichever is in stock: a small country's dealer has a few of each)
  const models = RULES.cars.filter((c) => c.price > 0 && !c.ended).sort((x, y) => x.price - y.price);
  async function buyCar(p) {
    for (const m of models) {
      const r = await s.call('POST', '/api/cars/buy', { token: p.token, body: { model: m.id } });
      if (r.status === 200) return r;
    }
    assert.fail('no car to buy');
  }
  const bought = await buyCar(a);
  await ok('sold back', s.call('POST', '/api/cars/sell', { token: a.token, body: { car: bought.car.id } }));
  for (const take of [true, false]) {
    const c = await buyCar(b);
    const offer = await ok('offer', s.call('POST', '/api/cars/offer', { token: b.token, body: { to: a.me.id, car: c.car.id, price: 9000000 } }));
    await ok('bought of a friend', s.call('POST', '/api/cars/offer/buy', { token: a.token, body: { id: offer.message.id } }));
    const sold = q("SELECT id FROM messages WHERE kind = 'car_sold' AND recipient_id = ? AND claimed_at = 0 ORDER BY id DESC").get(b.me.id);
    if (take) await ok('its price taken', s.call('POST', '/api/cars/sold/claim', { token: b.token, body: { id: sold.id } }));
    else {
      await close('a car\'s price waiting');
      q('UPDATE messages SET created_at = ? WHERE id = ?').run(Date.now() - (RULES.receiveDays.money + 1) * DAY, sold.id);
      const was = q('SELECT dollars FROM users WHERE id = ?').get(b.me.id).dollars;
      await s.app.api.housekeeping();
      assert.equal(q('SELECT dollars FROM users WHERE id = ?').get(b.me.id).dollars, was + 9000000, 'the seller\'s at its time');
    }
  }
  await close('cars');

  // 観戦ベット: a stake on the spins of a friend — lost to the casino, or won beyond it of the treasury (as a spin)
  await ok('watch', s.call('POST', '/api/watch', { token: b.token, body: { user: a.me.id, on: true } }));
  for (const side of ['miss', 'hit']) {
    await ok('bet', s.call('POST', '/api/watch/bet', { token: b.token, body: { side, stake: RULES.watchBet.stakes[0] } }));
    for (let i = 0; i < RULES.watchBet.spins; i++) await ok('spin', s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } }));
  }
  assert.equal(q("SELECT COUNT(*) AS n FROM watch_bets WHERE state = 'open'").get().n, 0);
  await close('watch bets');

  // the game's own rewards, the treasury's (a バイト's pay the local businesses'): the login bonus, the quests (YOSIDA's
  // fee kept), the medals, the update's thanks, three hours of a バイト
  await s.call('POST', '/api/login-bonus', { token: b.token, body: {} });
  const quests = await s.call('POST', '/api/quests/claim', { token: a.token, body: {} });
  for (const m of q('SELECT medal FROM medals WHERE user_id = ? AND claimed_at = 0').all(a.me.id)) await s.call('POST', '/api/medals/claim', { token: a.token, body: { medal: m.medal } });
  await s.call('POST', '/api/release/claim', { token: a.token, body: {} });
  await ok('a バイト', s.call('POST', '/api/jobs/start', { token: b.token, body: { id: 'garage' } }));
  q('UPDATE users SET jobs = ? WHERE id = ?').run(JSON.stringify([{ id: 'garage', since: Date.now() - 3 * 3600000 }]), b.me.id);
  const job = await ok('its pay', s.call('POST', '/api/jobs/collect', { token: b.token }));
  assert.ok(job.paid > 0 || (quests.paid || 0) > 0, JSON.stringify([job, quests]).slice(0, 300));
  await close('the game\'s rewards');

  // an account taken out (90 days in the archive): what it held — its $ and tokens, a transfer it sent still waiting
  // for its friend — never lost: its money the treasury's, the transfer still its friend's
  const c = await s.register('去る人');
  await s.befriend(c, a);
  await ok('a last transfer', s.call('POST', '/api/transfer', { token: c.token, body: { to: a.me.id, currency: 'dollars', amount: 100000 } }));
  await close('a third player');
  q('UPDATE users SET purge_at = 1 WHERE id = ?').run(c.me.id);
  await s.app.api.housekeeping();
  assert.equal(q('SELECT dollars, tokens FROM users WHERE id = ?').get(c.me.id).dollars, 0);
  await close('an account taken out');
  const last = q("SELECT id FROM messages WHERE kind = 'transfer' AND sender_id = ? AND claimed_at = 0").get(c.me.id);
  await ok('taken after', s.call('POST', '/api/messages/claim', { token: a.token, body: { message: last.id } }));
  await close('its transfer taken after');

  // the whole country's money, the players' too: all of it accounted for
  const P = W().ledger.players;
  assert.equal(P.drift, 0, JSON.stringify(P.days.slice(-3)));
});
