// Shop, お守り加護, fruits, homes (watching + group voice), Peter and the
// maintenance notice: npm test (from the repository root)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES, SHOP, itemSale, utcDay } from '../core/rules.js';
import { OFFER_LINES, parseAmount, readRequest } from '../core/peter.js';

let s, call, register, setUser, befriend, listen;

before(async () => {
  s = await startServer({ limits: { spin: [100000, 1000], shop: [100000, 1000], general: [100000, 1000], login: [100000, 1000], friend: [100000, 1000], transfer: [100000, 1000], dm: [100000, 1000], tip: [100000, 1000] } });
  ({ call, register, setUser, befriend, listen } = s);
});

after(() => s.stop());

const omamori = SHOP.get('omamori');
const price = () => itemSale(omamori, utcDay()).price;

test('Shop: お守り加護 at the daily sale price, ten per player at most', async () => {
  const a = await register('ShopA');
  assert.equal(omamori.price, 90000);
  const p = price();
  assert.ok(p >= 90000 * 0.6 && p <= 90000 * 0.9, `on sale: ${p}`);
  const me = await call('GET', '/api/me', { token: a.token });
  assert.deepEqual(me.itemShop.items.map((i) => [i.id, i.salePrice, i.max]), [['omamori', p, 10]]);
  assert.deepEqual(me.me.items, {});
  assert.equal(me.me.charm, false);

  let r = await call('POST', '/api/shop/buy', { token: a.token, body: { id: 'omamori', price: p + 100 } });
  assert.equal(r.error.code, 'price_changed');
  r = await call('POST', '/api/shop/buy', { token: a.token, body: { id: 'omamori', price: p, count: 3 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.me.items.omamori, 3);
  assert.equal(r.me.dollars, RULES.start.dollars - p * 3);
  r = await call('POST', '/api/shop/buy', { token: a.token, body: { id: 'omamori', price: p, count: 8 } });
  assert.equal(r.error.code, 'max');
  r = await call('POST', '/api/shop/buy', { token: a.token, body: { id: 'omamori', price: p, count: 7 } });
  assert.equal(r.me.items.omamori, 10);
  assert.equal((await call('POST', '/api/shop/buy', { token: a.token, body: { id: 'omamori', price: p } })).error.code, 'max');
  // not enough $
  const b = await register('ShopB');
  setUser(b.me.id, { dollars: p - 1 });
  assert.equal((await call('POST', '/api/shop/buy', { token: b.token, body: { id: 'omamori', price: p } })).error.code, 'insufficient');
  assert.equal((await call('POST', '/api/shop/buy', { token: b.token, body: { id: 'sword', price: 1 } })).error.code, 'bad_item');
});

test('Shop items can be given to friends (up to their limit)', async () => {
  const a = await register('GiveA');
  const b = await register('GiveB');
  const c = await register('GiveC');
  await call('POST', '/api/shop/buy', { token: a.token, body: { id: 'omamori', price: price(), count: 4 } });
  let r = await call('POST', '/api/items/give', { token: a.token, body: { to: b.me.id, id: 'omamori', count: 1 } });
  assert.equal(r.error.code, 'not_friends');
  await befriend(a, b);
  const lb = await listen(b);
  r = await call('POST', '/api/items/give', { token: a.token, body: { to: b.me.id, id: 'omamori', count: 3 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.me.items.omamori, 1);
  assert.equal(r.message.kind, 'item');
  assert.deepEqual([r.message.text, r.message.amount], ['omamori', 3]);
  const msg = await lb.waitFor('msg', (m) => m.kind === 'item');
  assert.equal(msg.amount, 3);
  await lb.waitFor('items', (e) => e.items.omamori === 3);
  lb.close();
  assert.equal((await call('GET', '/api/me', { token: b.token })).me.items.omamori, 3);
  assert.equal((await call('POST', '/api/items/give', { token: a.token, body: { to: b.me.id, id: 'omamori', count: 2 } })).error.code, 'insufficient');
  // the receiver's limit counts
  await befriend(c, b);
  await call('POST', '/api/shop/buy', { token: c.token, body: { id: 'omamori', price: price(), count: 9 } });
  r = await call('POST', '/api/items/give', { token: c.token, body: { to: b.me.id, id: 'omamori', count: 8 } });
  assert.equal(r.error.code, 'their_max');
  assert.match(r.error.message, /あと7個/);
  assert.equal((await call('POST', '/api/items/give', { token: c.token, body: { to: b.me.id, id: 'omamori', count: 7 } })).status, 200);
});

test('お守り加護: switched on before a spin, softens the next lost spin, then it is gone', async () => {
  const a = await register('CharmA');
  setUser(a.me.id, { tokens: 10000000 });
  let r = await call('POST', '/api/charm', { token: a.token });
  assert.equal(r.error.code, 'none');
  await call('POST', '/api/shop/buy', { token: a.token, body: { id: 'omamori', price: price(), count: 2 } });
  r = await call('POST', '/api/charm', { token: a.token });
  assert.equal(r.status, 200);
  assert.equal(r.me.charm, true);
  assert.equal(r.me.items.omamori, 1);
  assert.equal((await call('POST', '/api/charm', { token: a.token })).error.code, 'active');
  // spin until a losing one uses it up
  const bet = 10000;
  let used = null;
  for (let i = 0; i < 200 && !used; i++) {
    const before = (await call('GET', '/api/me', { token: a.token })).me.tokens;
    const sp = await call('POST', '/api/spin', { token: a.token, body: { bet } });
    assert.equal(sp.status, 200);
    if (sp.result.total >= bet) {
      assert.equal(sp.result.charm, null);
      assert.equal(sp.charm, true, 'still on after a winning spin');
      continue;
    }
    used = sp.result.charm;
    assert.ok(used, 'a lost spin uses it');
    assert.ok(used.pct === 100 || (used.pct >= 5 && used.pct <= 20), `pct ${used.pct}`);
    assert.equal(used.back, Math.floor((bet - sp.result.total) * used.pct / 100));
    assert.equal(sp.balance.tokens, before - bet + sp.result.total + used.back);
    assert.equal(sp.charm, false);
  }
  assert.ok(used);
  const sp = await call('POST', '/api/spin', { token: a.token, body: { bet } });
  assert.equal(sp.result.charm, null, 'only one spin');
  assert.equal((await call('GET', '/api/me', { token: a.token })).me.items.omamori, 1);
});

test('homes: ten watchers at most; members hear about each other; fruits go to the one watched', async () => {
  const host = await register('HomeHost');
  setUser(host.me.id, { tokens: 0 });
  const lh = await listen(host);
  const fans = [];
  for (let i = 0; i < 11; i++) {
    const f = await register(`Fan${i}`);
    await befriend(f, host);
    setUser(f.me.id, { tokens: 100000 });
    fans.push(f);
  }
  const l0 = await listen(fans[0]);
  // tips need watching
  let r = await call('POST', '/api/tip', { token: fans[0].token, body: { to: host.me.id, fruits: { strawberry: 1 } } });
  assert.equal(r.error.code, 'not_watching');
  for (let i = 0; i < 10; i++) {
    r = await call('POST', '/api/watch', { token: fans[i].token, body: { user: host.me.id, on: true } });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.members.length, i);
  }
  await lh.waitFor('watch', (e) => e.type === 'watched' && e.by.id === fans[9].me.id && e.on);
  await l0.waitFor('watch', (e) => e.type === 'member' && e.by.id === fans[9].me.id && e.on && e.user === host.me.id);
  r = await call('POST', '/api/watch', { token: fans[10].token, body: { user: host.me.id, on: true } });
  assert.equal(r.status, 409);
  assert.equal(r.error.code, 'full');
  // somebody leaves: room for one more
  await call('POST', '/api/watch', { token: fans[9].token, body: { user: host.me.id, on: false } });
  await l0.waitFor('watch', (e) => e.type === 'member' && e.by.id === fans[9].me.id && !e.on);
  assert.equal((await call('POST', '/api/watch', { token: fans[10].token, body: { user: host.me.id, on: true } })).status, 200);

  // fruits: strawberry 1000, watermelon 2000, melon 5000 spin tokens from the thrower
  r = await call('POST', '/api/tip', { token: fans[0].token, body: { to: host.me.id, fruits: { strawberry: 2, watermelon: 1, melon: 1 } } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.amount, 2 * 1000 + 2000 + 5000);
  assert.equal(r.balance.tokens, 100000 - 9000);
  const tip = await lh.waitFor('tip');
  assert.deepEqual([tip.from.id, tip.amount, tip.fruits.melon], [fans[0].me.id, 9000, 1]);
  assert.equal((await call('GET', '/api/me', { token: host.token })).me.tokens, 9000);
  await l0.waitFor('watch', (e) => e.type === 'tip' && e.amount === 9000);
  setUser(fans[1].me.id, { tokens: 500 });
  assert.equal((await call('POST', '/api/tip', { token: fans[1].token, body: { to: host.me.id, fruits: { strawberry: 1 } } })).error.code, 'insufficient');
  assert.equal((await call('POST', '/api/tip', { token: fans[2].token, body: { to: host.me.id, fruits: { banana: 1 } } })).error.code, 'bad_fruit');

  // home voice: the watchers the host talks with reach each other, the rest do not
  await call('POST', '/api/watch/voice', { token: host.token, body: { user: fans[0].me.id, on: true } });
  await call('POST', '/api/watch/voice', { token: host.token, body: { user: fans[1].me.id, on: true } });
  r = await call('POST', '/api/call', { token: fans[0].token, body: { to: fans[1].me.id, type: 'home', callId: `home-${host.me.id}`, data: { room: host.me.id, op: 'hello' } } });
  assert.equal(r.status, 200, JSON.stringify(r));
  r = await call('POST', '/api/call', { token: fans[0].token, body: { to: host.me.id, type: 'home', callId: `home-${host.me.id}`, data: { room: host.me.id, op: 'hello' } } });
  assert.equal(r.status, 200);
  await lh.waitFor('call', (e) => e.type === 'home' && e.from.id === fans[0].me.id);
  r = await call('POST', '/api/call', { token: fans[9].token, body: { to: fans[0].me.id, type: 'home', callId: `home-${host.me.id}`, data: { room: host.me.id, op: 'hello' } } });
  assert.equal(r.error.code, 'not_home');
  // the home chat: everyone in the home, nobody else
  r = await call('POST', '/api/home/chat', { token: fans[2].token, body: { room: host.me.id, text: 'がんばれ！' } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal((await lh.waitFor('homechat')).text, 'がんばれ！');
  await l0.waitFor('homechat', (e) => e.from.id === fans[2].me.id);
  const outsider = await register('Outsider');
  assert.equal((await call('POST', '/api/home/chat', { token: outsider.token, body: { room: host.me.id, text: 'やあ' } })).error.code, 'not_home');
  assert.equal((await call('GET', '/api/watchers', { token: host.token })).chat.length, 1);
  // the home call is the only voice: no 1:1 invitations, no 参加要請
  r = await call('POST', '/api/call', { token: host.token, body: { to: fans[9].me.id, type: 'invite', callId: 'c-123457' } });
  assert.equal(r.error.code, 'bad_type');
  assert.equal((await call('POST', '/api/home/invite', { token: host.token, body: { to: fans[9].me.id } })).status, 404);

  // the host leaves: the home closes
  lh.close();
  await l0.waitFor('watch', (e) => e.type === 'offline' && e.user === host.me.id);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM watchers WHERE target_id = ?').get(host.me.id).n, 0);
  l0.close();
});

test('Peter reads loan requests in Japanese', () => {
  assert.equal(parseAmount('300万貸して'), 3000000);
  assert.equal(parseAmount('三百万かして'), 3000000);
  assert.equal(parseAmount('１０００万円'), 10000000);
  assert.equal(parseAmount('1億5000万'), 150000000);
  assert.equal(parseAmount('万が一のため100万'), 1000000);
  assert.deepEqual(readRequest('500万貸してほしい'), { intent: 'borrow', amount: 5000000 });
  assert.deepEqual(readRequest('100万返す'), { intent: 'repay', amount: 1000000 });
  assert.equal(readRequest('こんにちは').intent, 'other');
  assert.equal(readRequest('今日は3回負けた').intent, 'other');
});

test('Peter: offers money when a player is nearly broke, twice; debts stack up; repayment', async () => {
  const a = await register('Broke1');
  const me0 = await call('GET', '/api/me', { token: a.token });
  const peterId = me0.peter.id;
  assert.equal(me0.peter.name, 'マイクソン');
  // he is no player: no friend requests, always online
  assert.equal((await call('POST', '/api/friends/request', { token: a.token, body: { user: peterId } })).error.code, 'npc');
  assert.equal((await call('GET', `/api/user?id=${peterId}`, { token: a.token })).user.online, true);
  assert.equal((await call('POST', '/api/register', { body: { name: 'ピーター', password: 'pass1234' } })).error.code, 'name_taken');
  // ジョンソン's one rescue has been used: the lender is the one who answers going broke here
  s.app.db.prepare("INSERT INTO npc_friends (user_id, npc, gift_at, rescued_at) VALUES (?, 'johnson', ?, 1)").run(a.me.id, Date.now());

  const la = await listen(a);
  // nearly broke after a spin (a rare big win lifts the player over the line: then again)
  async function goBroke(offerNo) {
    for (let i = 0; i < 10; i++) {
      setUser(a.me.id, { dollars: 0, tokens: 100 });
      await call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
      if ((await call('GET', '/api/peter', { token: a.token })).debt.offer === offerNo) return;
    }
  }
  await goBroke(1);
  let offer = await la.waitFor('msg', (m) => m.kind === 'offer');
  assert.deepEqual([offer.from.id, offer.amount, offer.text], [peterId, 1, OFFER_LINES[0]]);
  assert.ok(offer.unread >= 1);
  // no second offer while this one is open
  await call('POST', '/api/spin', { token: a.token, body: { bet: 100 } }).catch(() => {});
  let st = await call('GET', '/api/peter', { token: a.token });
  assert.equal(st.debt.offer, 1);
  assert.equal(st.peter.online, true);

  let r = await call('POST', '/api/peter/borrow', { token: a.token, body: { offer: 2 } });
  assert.equal(r.error.code, 'offer_gone');
  r = await call('POST', '/api/peter/borrow', { token: a.token, body: { offer: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.amount, 5000000);
  assert.ok(r.rate >= 2 && r.rate <= 5);
  assert.equal(r.owed, 5000000 + 5000000 * r.rate / 100);
  assert.equal(r.me.dollars, 5000000);
  assert.equal(r.me.debt, r.owed);
  const owed1 = r.owed;
  assert.equal((await call('POST', '/api/peter/borrow', { token: a.token, body: { offer: 1 } })).error.code, 'offer_gone');

  // spent it all: the second offer, 600万 at 10 %
  await goBroke(2);
  offer = await la.waitFor('msg', (m) => m.kind === 'offer' && m.amount === 2);
  assert.equal(offer.text, OFFER_LINES[1]);
  r = await call('POST', '/api/peter/borrow', { token: a.token, body: { offer: 2 } });
  assert.equal(r.rate, 10);
  assert.equal(r.debt.owed, owed1 + 6600000);
  assert.equal(r.debt.principal, 11000000);
  // that is all he lends: no third offer, no more in the chat
  setUser(a.me.id, { dollars: 0, tokens: 100 });
  await call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
  st = await call('GET', '/api/peter', { token: a.token });
  assert.equal(st.debt.offer, 0);
  r = await call('POST', '/api/messages', { token: a.token, body: { to: peterId, text: '100万貸して' } });
  assert.match(r.reply.text, /累計1100万円までなんだ/);
  assert.equal(r.debt.available, 0);

  // repaying: partly, then all of it (a clean slate)
  setUser(a.me.id, { dollars: 20000000 });
  r = await call('POST', '/api/peter/repay', { token: a.token, body: { amount: 1000000 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.paid, 1000000);
  assert.equal(r.debt.owed, owed1 + 6600000 - 1000000);
  assert.match(r.reply.text, /残りは/);
  r = await call('POST', '/api/peter/repay', { token: a.token, body: { amount: 99999999 } });
  assert.equal(r.paid, owed1 + 6600000 - 1000000);
  assert.deepEqual([r.debt.owed, r.debt.principal, r.debt.stage], [0, 0, 0]);
  assert.match(r.reply.text, /全額返済/);
  assert.equal(r.me.dollars, 20000000 - owed1 - 6600000);
  assert.equal((await call('POST', '/api/peter/repay', { token: a.token, body: { amount: 1 } })).error.code, 'no_debt');
  // 累計1100万円: paying back does not open his purse again
  assert.deepEqual([r.debt.lent, r.debt.available], [11000000, 0]);
  r = await call('POST', '/api/messages', { token: a.token, body: { to: peterId, text: '100万貸して' } });
  assert.match(r.reply.text, /もう貸せない/);
  setUser(a.me.id, { dollars: 0, tokens: 100 });
  await call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
  assert.equal((await call('GET', '/api/peter', { token: a.token })).debt.offer, 0);
  la.close();
});

test('Peter: loans asked for in the chat stop his own offers until repaid', async () => {
  const a = await register('Chatty');
  const peterId = (await call('GET', '/api/me', { token: a.token })).peter.id;
  let r = await call('POST', '/api/messages', { token: a.token, body: { to: peterId, text: 'こんにちは' } });
  assert.equal(r.status, 200);
  assert.match(r.reply.text, /100万貸して/);
  r = await call('POST', '/api/messages', { token: a.token, body: { to: peterId, text: '2000万貸してほしい' } });
  assert.match(r.reply.text, /累計1100万円まで、あと1100万円/);
  r = await call('POST', '/api/messages', { token: a.token, body: { to: peterId, text: '0.5万貸して' } });
  assert.match(r.reply.text, /はした金/);
  const before = (await call('GET', '/api/me', { token: a.token })).me.dollars;
  r = await call('POST', '/api/messages', { token: a.token, body: { to: peterId, text: '300万貸して' } });
  assert.match(r.reply.text, /300万円貸すよ/);
  // every loan leaves this line in his chat
  assert.deepEqual([r.lent.kind, r.lent.text], ['system', '300万円貸しました']);
  assert.equal(r.debt.principal, 3000000);
  assert.equal(r.debt.chat, true);
  const rate = Number(/利息は(\d+)%/.exec(r.reply.text)[1]);
  assert.ok(rate >= 2 && rate <= 5);
  assert.equal((await call('GET', '/api/me', { token: a.token })).me.dollars, before + 3000000);
  // a second one costs 10 %
  r = await call('POST', '/api/messages', { token: a.token, body: { to: peterId, text: '100万' } });
  assert.match(r.reply.text, /利息は10%/);
  // broke now, but no offer of his own
  setUser(a.me.id, { dollars: 0, tokens: 100 });
  await call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
  assert.equal((await call('GET', '/api/peter', { token: a.token })).debt.offer, 0);
  const conv = await call('GET', '/api/conversations', { token: a.token });
  const withPeter = conv.conversations.find((c) => c.user.id === peterId);
  assert.ok(withPeter && withPeter.user.online && withPeter.user.npc === 'peter');
  const thread = await call('GET', `/api/messages?with=${peterId}`, { token: a.token });
  assert.ok(!thread.messages.some((m) => m.kind === 'offer'));
  // repaid in the chat: his offers can come again
  setUser(a.me.id, { dollars: 50000000 });
  r = await call('POST', '/api/messages', { token: a.token, body: { to: peterId, text: '全部返す 5000万' } });
  assert.match(r.reply.text, /全額返済/);
  setUser(a.me.id, { dollars: 0, tokens: 100 });
  await call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
  assert.equal((await call('GET', '/api/peter', { token: a.token })).debt.offer, 1);
});

test('maintenance: past a daily cap every request gets the notice until 00:00 UTC', async () => {
  const m = await startServer({ dailyRequestLimit: 5 });
  try {
    const a = await m.register('Capped');
    let r;
    for (let i = 0; i < 6; i++) r = await m.call('GET', '/api/me', { token: a.token });
    assert.equal(r.status, 503);
    assert.equal(r.error.code, 'maintenance');
    assert.match(r.error.message, /サーバーのメンテナンス中です/);
    const d = new Date();
    assert.equal(r.error.until, Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
    assert.equal((await m.call('GET', '/api/health')).error.code, 'maintenance');
  } finally {
    await m.stop();
  }
});

test('login bonus: once per day (6:00 to 6:00 Japan time), 45 000 / 50 000 / 65 000 / 90 000 tokens, then over again', async () => {
  const { loginDay } = await import('../core/rules.js');
  // 5:59 and 6:00 in Japan are different days; 6:00 is 21:00 UTC
  assert.notEqual(loginDay(Date.UTC(2026, 9, 18, 20, 59)), loginDay(Date.UTC(2026, 9, 18, 21, 0)));
  assert.equal(loginDay(Date.UTC(2026, 9, 18, 21, 0)), loginDay(Date.UTC(2026, 9, 19, 20, 59)));
  const m = await startServer({ loginBonus: true });
  try {
    const a = await m.register('Loginer');
    const seen = [];
    for (let i = 0; i < 5; i++) {
      const r = await m.call('GET', '/api/me', { token: a.token });
      seen.push(r.loginBonus && r.loginBonus.amount);
      assert.equal((await m.call('GET', '/api/me', { token: a.token })).loginBonus, null, 'only the first login of the day');
      m.setUser(a.me.id, { login_day: '' });   // the next day
    }
    assert.deepEqual(seen, [45000, 50000, 65000, 90000, 45000]);
    assert.equal((await m.call('GET', '/api/me', { token: a.token })).me.tokens, 45000 + 50000 + 65000 + 90000 + 45000 + 50000);
  } finally {
    await m.stop();
  }
});
