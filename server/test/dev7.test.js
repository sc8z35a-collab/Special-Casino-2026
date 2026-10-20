// DEV7 on the server: an adopted 意見案 pays spin tokens, bans told by the
// official bot (and a banned login kept for the locked title screen), the
// developer taking an operator's rights away. npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';

let s, call, register, setUser;
let taku, sub;

before(async () => {
  s = await startServer({ operators: ['taku', 'sub'], limits: { spin: [100000, 1000], shop: [100000, 1000], general: [100000, 1000], login: [100000, 1000], friend: [100000, 1000], transfer: [100000, 1000], dm: [100000, 1000] } });
  ({ call, register, setUser } = s);
  taku = await register('TAKU');
  sub = await register('Sub');
});
after(() => s.stop());

const ops = (method, url, body, who = taku) => call(method, url, { token: who.token, body });
const dollars = (id) => s.app.db.prepare('SELECT dollars FROM users WHERE id = ?').get(id).dollars;
const tokens = (id) => s.app.db.prepare('SELECT tokens FROM users WHERE id = ?').get(id).tokens;
async function fromBot(p) {
  const bot = (await call('GET', '/api/me', { token: p.token })).official;
  const id = bot ? bot.id : s.app.db.prepare("SELECT id FROM users WHERE npc = 'official'").get().id;
  return (await call('GET', `/api/messages?with=${id}`, { token: p.token })).messages.filter((m) => m.from && m.from.id === id);
}

test('an adopted 意見案: 50,000 spin tokens from Ice Smoker公式 with its thanks, once', async () => {
  const p = await register('Idea1');
  await call('POST', '/api/official/feedback', { token: p.token, body: { kind: 'idea', text: 'ガチャを追加してほしい' } });
  await call('POST', '/api/official/feedback', { token: p.token, body: { kind: 'bug', text: '表示がずれる' } });
  const list = (await ops('GET', '/api/ops/feedback')).feedback;
  const idea = list.find((f) => f.kind === 'idea' && f.user.id === p.me.id), bug = list.find((f) => f.kind === 'bug' && f.user.id === p.me.id);
  const before = tokens(p.me.id);
  assert.equal((await ops('POST', '/api/ops/feedback/adopt', { id: idea.id })).reward, 50000);
  assert.equal(tokens(p.me.id), before + 50000);
  const said = await fromBot(p);
  assert.ok(said.some((m) => m.kind === 'transfer' && m.amount === 50000 && m.currency === 'tokens'));
  assert.match(said[said.length - 1].text, /意見案（「ガチャを追加してほしい」）を採用/);
  assert.equal((await ops('POST', '/api/ops/feedback/adopt', { id: idea.id })).status, 409);
  assert.equal((await ops('POST', '/api/ops/feedback/adopt', { id: bug.id })).status, 404);
  const after = (await ops('GET', '/api/ops/feedback')).feedback.find((f) => f.id === idea.id);
  assert.ok(after.adoptedAt && after.handledAt);
  assert.equal(tokens(p.me.id), before + 50000);
  assert.ok((await ops('GET', '/api/ops/log')).entries.some((e) => e.action === 'idea_adopt'));
});

test('bans: the official bot says when (and when it ends); the login stays for the locked title screen', async () => {
  const p = await register('Ban7');
  await ops('POST', '/api/ops/ban', { id: p.me.id, kind: 'suspend' });
  let r = await call('GET', '/api/ban', { token: p.token });
  assert.deepEqual([r.ban.code, r.ban.kind], ['banned', 'suspend']);
  assert.match(r.ban.notice, /^あなたは\d{4}\/\d\d\/\d\d \d\d:\d\dに公式よりアクセス禁止されました。$/);
  // lifted by the operators: the game opens again, the bot says so
  await ops('POST', '/api/ops/ban', { id: p.me.id, kind: 'none' });
  assert.equal((await call('GET', '/api/ban', { token: p.token })).ban, null);
  let said = (await fromBot(p)).map((m) => m.text);
  assert.match(said[0], /【アクセス禁止のお知らせ】[\s\S]*公式よりアクセス禁止されました。\n期間：.* まで/);
  assert.match(said[1], /【アクセス禁止解除のお知らせ】[\s\S]*公式により解除されました/);
  // run out: lifted when next looked at, with the bot's word
  await ops('POST', '/api/ops/ban', { id: p.me.id, kind: 'ban' });
  setUser(p.me.id, { ban_until: Date.now() - 1000 });
  assert.equal((await call('GET', '/api/ban', { token: p.token })).ban, null);
  said = (await fromBot(p)).map((m) => m.text);
  assert.match(said[said.length - 1], /【BAN解除のお知らせ】[\s\S]*期間が終わり、解除されました/);
  assert.equal(said.length, 4);
});

test('operator rights given and taken away with the developer code; the developer is never banned', async () => {
  const CODE = '987654321098';   // (a test code: the real one is never written anywhere)
  assert.equal((await ops('GET', '/api/ops/me')).developer, true);
  assert.equal((await ops('POST', '/api/ops/dev-code', { code: CODE }, sub)).error.code, 'not_developer');
  assert.equal((await ops('POST', '/api/ops/operator', { name: 'Sub', action: 'revoke', code: CODE })).error.code, 'dev_code_unset');
  assert.equal((await ops('POST', '/api/ops/dev-code', { code: CODE })).devCodeSet, true);
  // the developer: never
  assert.equal((await ops('POST', '/api/ops/operator', { name: 'TAKU', action: 'revoke', code: CODE }, sub)).error.code, 'developer');
  assert.equal((await ops('POST', '/api/ops/ban', { id: taku.me.id, kind: 'perma' }, sub)).error.code, 'operator');
  // a wrong code
  assert.equal((await ops('POST', '/api/ops/operator', { name: 'Sub', action: 'revoke', code: '111111111111' })).error.code, 'dev_code');
  // taken away: every login of theirs ends, saying why (once), and the site keeps them out
  const r = await ops('POST', '/api/ops/operator', { name: 'Sub', action: 'revoke', code: CODE });
  assert.equal(r.operators.find((o) => o.key === 'sub').operator, false);
  const gone = await call('GET', '/api/me', { token: sub.token });
  assert.deepEqual([gone.status, gone.error.code], [401, 'ended']);
  assert.match(gone.error.message, /運営権が剥奪/);
  assert.equal((await call('GET', '/api/me', { token: sub.token })).error.code, 'auth');
  const again = await call('POST', '/api/login', { body: { name: 'Sub', password: PASSWORD } });
  assert.equal(again.me.operator, false);
  const site = await call('GET', '/api/ops/me', { token: again.token });
  assert.deepEqual([site.status, site.error.code], [403, 'not_operator']);
  assert.match(site.error.message, /運営権が剥奪/);
  // given (back, or to anyone)
  await ops('POST', '/api/ops/operator', { name: 'Sub', action: 'grant', code: CODE });
  assert.equal((await call('GET', '/api/ops/me', { token: again.token })).name, 'Sub');
  const helper = await register('Helper7');
  await ops('POST', '/api/ops/operator', { name: 'Helper7', action: 'grant', code: CODE }, again);
  assert.equal((await call('GET', '/api/ops/me', { token: helper.token })).name, 'Helper7');
  const log = (await ops('GET', '/api/ops/log')).entries.map((e) => e.action);
  for (const a of ['dev_code_set', 'dev_code_fail', 'ops_revoke', 'ops_grant']) assert.ok(log.includes(a), a);
});

test('wins in a row: from the fifth, every win pays double', async () => {
  const { evaluate } = await import('../core/rules.js');
  const p = await register('Combo7');
  let checked = false;
  for (let i = 0; i < 400 && !checked; i++) {
    setUser(p.me.id, { tokens: 1000000, streak: 4 });
    const r = (await call('POST', '/api/spin', { token: p.token, body: { bet: 100 } })).result;
    if (r.total > 0) {
      assert.deepEqual([r.combo, r.double, r.total], [5, true, evaluate(r.line, 100).total * 2]);
      checked = true;
    } else assert.equal(r.combo, 0);
  }
  assert.ok(checked);
  // the fourth: as before
  for (let i = 0; i < 400; i++) {
    setUser(p.me.id, { streak: 3 });
    const r = (await call('POST', '/api/spin', { token: p.token, body: { bet: 100 } })).result;
    if (r.total > 0) { assert.deepEqual([r.combo, !!r.double, r.total], [4, false, evaluate(r.line, 100).total]); break; }
  }
});

test('アクセス日数: $250,000 from the official bot at 5, 10 … 35 days, by itself', async () => {
  const p = await register('Days7');
  setUser(p.me.id, { login_days: 12 });
  const before = dollars(p.me.id);
  const l = await s.listen(p);
  await l.waitFor('hello');
  l.close();
  const said = await fromBot(p);
  assert.equal(dollars(p.me.id), before + 500000);
  assert.deepEqual(said.filter((m) => m.kind === 'transfer').map((m) => m.amount), [250000, 250000]);
  const texts = said.filter((m) => m.kind === 'text').map((m) => m.text);
  assert.match(texts[0], /^【自動送信】\nおめでとうございます！アクセス日数5日を達成しました！！記念して250Kを送金します！/);
  assert.match(texts[1], /アクセス日数10日/);
  // once each
  const l2 = await s.listen(p);
  await l2.waitFor('hello');
  l2.close();
  assert.equal(dollars(p.me.id), before + 500000);
});

test('the garage: two cars, one more place for $1,000,000 each (for good); a full garage takes no more', async () => {
  const { RULES } = await import('../core/rules.js');
  const [a, b] = [await register('Garage7a'), await register('Garage7b')];
  await s.befriend(a, b);
  setUser(a.me.id, { dollars: 100000000 });
  let g = await call('GET', '/api/cars', { token: a.token });
  assert.deepEqual([g.capacity, g.slotPrice], [2, 1000000]);
  const buy = async (who) => call('POST', '/api/cars/buy', { token: who.token, body: { model: 'two-state-sedan' } });
  assert.equal((await buy(a)).status, 200);
  assert.equal((await buy(a)).status, 200);
  assert.equal((await buy(a)).error.code, 'garage_full');
  const before = dollars(a.me.id);
  const x = await call('POST', '/api/garage/expand', { token: a.token, body: {} });
  assert.deepEqual([x.capacity, x.me.garage, dollars(a.me.id)], [3, 3, before - 1000000]);
  assert.equal((await buy(a)).status, 200);
  // the price of the moment (a sale may be on)
  g = await call('GET', '/api/cars', { token: a.token });
  const sedan = RULES.cars.find((c) => c.id === 'two-state-sedan');
  const pct = g.sale && g.sale.pct[sedan.id] || 0;
  assert.equal((await call('POST', '/api/cars/buy', { token: a.token, body: { model: sedan.id, price: 1 } })).error.code, 'price_changed');
  assert.ok(pct >= 0 && pct <= 45);
  // a friend's full garage
  setUser(b.me.id, { dollars: 100000000 });
  await buy(b);
  await buy(b);
  const car = g.cars[0].id;
  assert.equal((await call('POST', '/api/cars/gift', { token: a.token, body: { to: b.me.id, car } })).error.code, 'their_garage_full');
});

test('buy-back and renting out: the day\'s price, customers every 5 hours, back after the block', async () => {
  const { RULES, carBuyback } = await import('../core/rules.js');
  const p = await register('Rent7');
  setUser(p.me.id, { dollars: 100000000, garage_extra: 3 });
  const buy = async () => (await call('POST', '/api/cars/buy', { token: p.token, body: { model: 'blue-lightning' } })).car.id;
  const [a, b] = [await buy(), await buy()];
  let g = await call('GET', '/api/cars', { token: p.token });
  const offer = g.buyback['blue-lightning'];
  assert.deepEqual(offer, carBuyback(RULES.cars.find((c) => c.id === 'blue-lightning')));
  assert.ok(offer.disposal ? offer.pct >= 2.5 && offer.pct <= 10 : offer.pct >= 10 && offer.pct <= 35);
  // rent both out (as many as one has)
  for (const id of [a, b]) assert.ok((await call('POST', '/api/cars/rent', { token: p.token, body: { car: id, action: 'start' } })).car.rent);
  assert.equal((await call('POST', '/api/cars/sell', { token: p.token, body: { car: a } })).error.code, 'rented');
  // 11 hours later: two blocks of customers (one at the least each), waiting
  const db = s.app.db;
  db.prepare('UPDATE cars SET rent_start = ? WHERE id IN (?, ?)').run(Date.now() - 11 * 3600000, a, b);
  g = await call('GET', '/api/cars', { token: p.token });
  const ca = g.cars.find((c) => c.id === a);
  assert.ok(ca.earned >= 2 * 10000 && ca.last.n >= 1, JSON.stringify(ca));
  // asked back: home at the end of its block (here: at once, the 3rd block runs till 15 h)
  const stop = (await call('POST', '/api/cars/rent', { token: p.token, body: { car: a, action: 'stop' } })).car;
  assert.equal(stop.rent.until, stop.rent.start + 15 * 3600000);
  db.prepare('UPDATE cars SET rent_start = ?, rent_until = ? WHERE id = ?').run(Date.now() - 16 * 3600000, Date.now() - 3600000, a);
  g = await call('GET', '/api/cars', { token: p.token });
  assert.equal(g.cars.find((c) => c.id === a).rent, null);
  // the takings, then the buy-back
  const before = dollars(p.me.id);
  const got = await call('POST', '/api/cars/collect', { token: p.token, body: {} });
  assert.equal(dollars(p.me.id), before + got.paid);
  const offer2 = (await call('GET', '/api/cars', { token: p.token })).buyback['blue-lightning'];
  assert.equal((await call('POST', '/api/cars/sell', { token: p.token, body: { car: a, price: offer2.price + 100 } })).error.code, 'price_changed');
  const sold = await call('POST', '/api/cars/sell', { token: p.token, body: { car: a, price: offer2.price } });
  assert.equal(sold.paid, offer2.price);
  assert.equal(dollars(p.me.id), before + got.paid + offer2.price);
});
