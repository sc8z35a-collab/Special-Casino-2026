// Dedicated pay.js integration tests. Stripe is a disposable local stand-in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer } from './helpers.js';
import { fakeStripe } from './fake-stripe.js';

const KEY = 'sk_test_' + 'x'.repeat(24);
const WHSEC = 'whsec_' + crypto.randomBytes(16).toString('hex');
const LIMITS = {
  spin: [100000, 1000], shop: [100000, 1000], general: [100000, 1000], login: [100000, 1000], friend: [100000, 1000], transfer: [100000, 1000], dm: [100000, 1000],
  payCheckout: [100000, 1000], payCheckoutIp: [100000, 1000], payLook: [100000, 1000]
};

let s, call, register, stripe, taku, sub;

before(async () => {
  stripe = fakeStripe(KEY);
  await new Promise((r) => stripe.server.listen(0, '127.0.0.1', r));
  s = await startServer({
    operators: ['taku', 'sub'], limits: LIMITS,
    stripeSecretKey: KEY, stripeWebhookSecret: WHSEC, publicUrl: 'https://casino.example', stripeApi: `http://127.0.0.1:${stripe.server.address().port}`
  });
  ({ call, register } = s);
  taku = await register('TAKU');
  sub = await register('Sub');
});
after(async () => {
  await s.stop();
  stripe.server.close();
});

const coins = (id) => s.app.db.prepare('SELECT coins FROM users WHERE id = ?').get(id).coins;
const event = (type, object) => ({ id: 'evt_test_' + crypto.randomBytes(8).toString('hex'), object: 'event', type, livemode: false, data: { object } });
// a notice the way Stripe signs it: HMAC-SHA256 of "<t>.<body>"
async function hook(ev, { secret = WHSEC, t = Math.floor(Date.now() / 1000), body = JSON.stringify(ev) } = {}) {
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const res = await fetch(s.base + '/api/pay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Stripe-Signature': `t=${t},v1=${sig}` }, body });
  return { status: res.status, ...(await res.json()) };
}
async function buyer(name) {
  const p = await register(name);
  await call('POST', '/api/age', { token: p.token, body: { adult: true } });
  return p;
}
const checkout = (p, body) => call('POST', '/api/pay/checkout', { token: p.token, body });
async function fromBot(p) {
  const id = s.app.db.prepare("SELECT id FROM users WHERE npc = 'official'").get().id;
  return (await call('GET', `/api/messages?with=${id}`, { token: p.token })).messages.filter((m) => m.from && m.from.id === id).map((m) => m.text);
}

test('payments stay off until Stripe is set up', async () => {
  const off = await startServer();
  try {
    const p = await off.register('Off1');
    await off.call('POST', '/api/age', { token: p.token, body: { adult: true } });
    assert.equal((await off.call('GET', '/api/pay/info', { token: p.token })).on, false);
    assert.equal((await off.call('POST', '/api/pay/checkout', { token: p.token, body: { plan: 'support3', qty: 2, method: 'paypay' } })).status, 503);
    assert.equal((await off.call('GET', '/api/pay/seller')).on, false);
  } finally {
    await off.stop();
  }
});

test('a purchase: the server sets the price, and coins come only for what Stripe says, once', async () => {
  const p = await register('Buyer1');
  assert.equal((await checkout(p, { plan: 'support3', qty: 2, method: 'paypay' })).error.code, 'age');
  await call('POST', '/api/age', { token: p.token, body: { adult: true } });
  assert.equal((await checkout(p, { plan: 'support1', qty: 1, method: 'paypay' })).error.code, 'too_small');
  assert.equal((await checkout(p, { plan: 'support1', qty: 11, method: 'konbini' })).error.code, 'too_small');
  assert.equal((await checkout(p, { plan: 'support3', qty: 101, method: 'paypay' })).error.code, 'bad_qty');
  assert.equal((await checkout(p, { plan: 'support9', qty: 2, method: 'paypay' })).error.code, 'bad_plan');
  const start = coins(p.me.id);
  // the browser's own numbers are never used
  const r = await checkout(p, { plan: 'support3', qty: 2, method: 'paypay', amount: 1, coins: 9999 });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.match(r.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.deepEqual([r.order.status, r.order.amount, r.order.coins, r.order.bonus], ['open', 60, 68, 8]);
  const made = stripe.seen.filter((x) => x.path === '/v1/checkout/sessions').pop();
  assert.deepEqual([made.form.get('line_items[0][price_data][unit_amount]'), made.form.get('line_items[0][quantity]'), made.form.get('payment_method_types[0]'), made.form.get('client_reference_id')], ['30', '2', 'paypay', r.order.id]);
  assert.equal(made.idem, `two-state-order-${r.order.id}`);
  assert.equal(made.version, '2025-09-30.clover');
  const session = [...stripe.sessions.values()].find((x) => x.client_reference_id === r.order.id);

  // not signed by Stripe: refused
  const ev = event('checkout.session.completed', { ...session, payment_status: 'paid' });
  assert.equal((await hook(ev, { secret: 'whsec_' + 'f'.repeat(32) })).status, 400);
  assert.equal((await hook(ev, { t: Math.floor(Date.now() / 1000) - 600 })).status, 400);
  // signed, but Stripe itself says it is not paid yet: nothing
  assert.equal((await hook(ev)).status, 200);
  assert.equal(coins(p.me.id), start);
  assert.equal((await call('GET', `/api/pay/order?id=${r.order.id}`, { token: p.token })).order.status, 'open');

  // paid: the coins, the official bot's thanks, the meters
  stripe.pay(session.id);
  const paid = event('checkout.session.completed', stripe.sessions.get(session.id));
  assert.equal((await hook(paid)).status, 200);
  assert.equal(coins(p.me.id), start + 68);
  const o = await call('GET', `/api/pay/order?id=${r.order.id}`, { token: p.token });
  assert.equal(o.order.status, 'paid');
  assert.ok(o.meters.recover.have >= 60);
  assert.match((await fromBot(p)).pop(), /【ご支援ありがとうございます】[\s\S]*「開発者支援III」を2口（60円）[\s\S]*ロイヤルコイン 68枚（感謝料 8枚を含む）/);
  // the same notice again, another notice for the same payment, the player asking: once only
  await hook(paid);
  await hook(event('checkout.session.async_payment_succeeded', stripe.sessions.get(session.id)));
  await call('GET', `/api/pay/order?id=${r.order.id}`, { token: p.token });
  assert.equal(coins(p.me.id), start + 68);
  // someone else's order: not found
  const other = await buyer('Buyer1b');
  assert.equal((await call('GET', `/api/pay/order?id=${r.order.id}`, { token: other.token })).status, 404);
  const log = (await call('GET', '/api/ops/log', { token: taku.token })).entries.map((e) => e.action);
  assert.ok(log.includes('pay_order') && log.includes('pay_paid') && log.includes('pay_bad_signature'));
});

test('a payment that does not match its order is never paid out', async () => {
  const p = await buyer('Buyer2');
  const r = await checkout(p, { plan: 'support2', qty: 3, method: 'paypay' });
  const session = [...stripe.sessions.values()].find((x) => x.client_reference_id === r.order.id);
  stripe.pay(session.id);
  session.amount_total = 1;
  const start = coins(p.me.id);
  assert.equal((await hook(event('checkout.session.completed', session))).status, 200);
  assert.equal(coins(p.me.id), start);
  assert.equal((await call('GET', `/api/pay/order?id=${r.order.id}`, { token: p.token })).order.status, 'review');
  assert.ok((await call('GET', '/api/ops/log', { token: taku.token })).entries.some((e) => e.action === 'pay_review'));
});

test('konbini: the payment slip first, the coins when the cash comes', async () => {
  const p = await buyer('Buyer3');
  const r = await checkout(p, { plan: 'support2', qty: 6, method: 'konbini' });
  assert.equal(r.order.amount, 120);
  const made = stripe.seen.filter((x) => x.path === '/v1/checkout/sessions').pop();
  assert.deepEqual([made.form.get('payment_method_types[0]'), made.form.get('payment_method_options[konbini][expires_after_days]')], ['konbini', '3']);
  const session = [...stripe.sessions.values()].find((x) => x.client_reference_id === r.order.id);
  stripe.slip(session.id);
  await hook(event('checkout.session.completed', session));
  const info = await call('GET', '/api/pay/info', { token: p.token });
  assert.equal(info.orders[0].status, 'pending');
  assert.match(info.orders[0].voucher.url, /^https:\/\/payments\.stripe\.com\//);
  const start = coins(p.me.id);
  stripe.cash(session.id);
  await hook(event('checkout.session.async_payment_succeeded', session));
  assert.equal(coins(p.me.id), start + 120);
});

test('the developer answers a player who paid: that player leaves the 課金 list', async () => {
  assert.equal((await call('GET', '/api/ops/pay', { token: sub.token })).error.code, 'not_developer');
  let list = await call('GET', '/api/ops/pay', { token: taku.token });
  assert.equal(list.setup.mode, 'test');
  const w = list.waiting.find((x) => x.player.name === 'Buyer1');
  assert.deepEqual(w.items.map((i) => [i.plan, i.qty, i.amount]), [['support3', 2, 60]]);
  assert.deepEqual([w.amount, w.coins], [60, 68]);
  assert.ok(list.waiting.some((x) => x.player.name === 'Buyer3'));
  const r = await call('POST', '/api/ops/pay/reply', { token: taku.token, body: { id: w.player.id, text: 'ご支援、本当にありがとうございます！これからも全力で開発します！' } });
  assert.equal(r.replied, 1);
  list = await call('GET', '/api/ops/pay', { token: taku.token });
  assert.ok(!list.waiting.some((x) => x.player.name === 'Buyer1'));
  assert.ok(list.waiting.some((x) => x.player.name === 'Buyer3'));
  assert.equal((await call('POST', '/api/ops/pay/reply', { token: taku.token, body: { id: w.player.id, text: 'もう一度' } })).status, 409);
  const p = { token: (await call('POST', '/api/login', { body: { name: 'Buyer1', password: 'pass1234' } })).token };
  assert.match((await fromBot(p)).pop(), /^【開発者からのメッセージ】\n\nBuyer1様\n\nご支援、本当にありがとうございます！/);
});

test('a refund takes the coins back and the meters go down', async () => {
  const p = await buyer('Buyer4');
  const r = await checkout(p, { plan: 'support1', qty: 5, method: 'paypay' });
  const session = [...stripe.sessions.values()].find((x) => x.client_reference_id === r.order.id);
  stripe.pay(session.id);
  await hook(event('checkout.session.completed', session));
  const before = (await call('GET', '/api/pay/info', { token: p.token })).meters.recover.have;
  const start = coins(p.me.id);
  stripe.refund(session.id);
  const pi = stripe.intents.get(session.payment_intent);
  await hook(event('charge.refunded', { id: pi.latest_charge.id, object: 'charge', payment_intent: pi.id, amount_refunded: 50 }));
  assert.equal(coins(p.me.id), start - 50);
  assert.equal((await call('GET', `/api/pay/order?id=${r.order.id}`, { token: p.token })).order.status, 'refunded');
  assert.equal((await call('GET', '/api/pay/info', { token: p.token })).meters.recover.have, before - 50);
});

test('the meters: 開発費回収 first, then this month goes to 来月の開発費確保', async () => {
  const p = await buyer('Buyer5');
  const paid = s.app.db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM pay_orders WHERE status = 'paid'").get().n;
  const longAgo = Date.now() - 60 * 86400000;
  s.app.db.prepare(`INSERT INTO pay_orders (id, user_id, plan, qty, coins, amount, method, status, created_at, updated_at, paid_at)
                    VALUES (?, ?, 'support3', 330, 9900, 9900, 'paypay', 'paid', ?, ?, ?)`).run(crypto.randomBytes(16).toString('hex'), p.me.id, longAgo, longAgo, longAgo);
  const m = (await call('GET', '/api/pay/info', { token: p.token })).meters;
  assert.deepEqual([m.recover.have, m.recover.goal], [9900, 9900]);
  assert.deepEqual([m.monthly.have, m.monthly.goal, m.monthly.open], [paid, 3400, true]);
});


test('concurrent duplicate notices and late failure/expiry cannot credit twice or undo a completed payment', async () => {
  const p = await buyer('PayParallel'), start = coins(p.me.id);
  const r = await checkout(p, { plan: 'support3', qty: 2, method: 'paypay' });
  const session = [...stripe.sessions.values()].find(x => x.client_reference_id === r.order.id);
  stripe.pay(session.id);
  const paid = event('checkout.session.completed', session);
  const results = await Promise.all(Array.from({ length: 6 }, () => hook(paid)));
  assert.ok(results.every(r => r.status === 200));
  await hook(event('checkout.session.async_payment_failed', session));
  await hook(event('checkout.session.expired', session));
  assert.equal(coins(p.me.id), start + r.order.coins);
  assert.equal(s.app.db.prepare('SELECT status FROM pay_orders WHERE id = ?').get(r.order.id).status, 'paid');
  assert.equal(s.app.db.prepare('SELECT count(*) AS n FROM pay_events WHERE id = ?').get(paid.id).n, 1);
  stripe.refund(session.id);
  const refunded = event('charge.refunded', { object: 'charge', payment_intent: session.payment_intent });
  await Promise.all([hook(refunded), hook(refunded)]);
  await hook(event('checkout.session.async_payment_succeeded', session));
  assert.equal(coins(p.me.id), start);
  assert.equal(s.app.db.prepare('SELECT status FROM pay_orders WHERE id = ?').get(r.order.id).status, 'refunded');
});

test('currency, mode, order identity and user metadata mismatches stay in review without granting coins', async () => {
  const changes = [s => { s.currency = 'usd'; }, s => { s.livemode = true; },
    s => { s.client_reference_id = 'f'.repeat(32); }, s => { s.metadata.user = '999999999'; }];
  for (let i = 0; i < changes.length; i++) {
    const p = await buyer('PayMismatch' + i), start = coins(p.me.id);
    const r = await checkout(p, { plan: 'support3', qty: 2, method: 'paypay' });
    const session = [...stripe.sessions.values()].find(x => x.client_reference_id === r.order.id);
    stripe.pay(session.id); changes[i](session);
    assert.equal((await hook(event('checkout.session.completed', session))).status, 200);
    assert.equal(coins(p.me.id), start);
    const order = s.app.db.prepare('SELECT status FROM pay_orders WHERE id = ?').get(r.order.id);
    assert.notEqual(order.status, 'paid');
  }
});

test('webhook authentication binds the exact bytes and rejects future timestamps and malformed signed JSON', async () => {
  const ev = event('checkout.session.completed', { object: 'checkout.session', id: 'cs_test_nonexistent' });
  const body = JSON.stringify(ev), t = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', WHSEC).update(`${t}.${body}`).digest('hex');
  const res = await fetch(s.base + '/api/pay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${signature}` }, body: body + ' ' });
  assert.equal(res.status, 400);
  assert.equal((await hook(ev, { t: t + 600 })).status, 400);
  assert.equal((await hook(ev, { body: '{broken json' })).status, 400);
  assert.equal(s.app.db.prepare('SELECT 1 FROM pay_events WHERE id = ?').get(ev.id), undefined);
});

test('a full refund delivered before the paid event never grants coins, including duplicate and concurrent notices', async () => {
  const p = await buyer('RefundFirst'), start = coins(p.me.id);
  const r = await checkout(p, { plan: 'support3', qty: 2, method: 'paypay' });
  const session = [...stripe.sessions.values()].find(x => x.client_reference_id === r.order.id);
  stripe.pay(session.id); stripe.refund(session.id);
  const refund = event('charge.refunded', { object: 'charge', payment_intent: session.payment_intent });
  assert.equal((await hook(refund)).status, 200);
  assert.equal(coins(p.me.id), start);
  const paid = event('checkout.session.completed', session);
  await Promise.all([hook(paid), hook(refund), hook(event('charge.refunded', refund.data.object))]);
  assert.equal(coins(p.me.id), start);
  const row = s.app.db.prepare('SELECT * FROM pay_orders WHERE id = ?').get(r.order.id);
  assert.equal(row.status, 'refunded'); assert.equal(row.refunded_amount, row.amount); assert.equal(row.coins_revoked, row.coins);
  assert.equal(row.coins_back, 0, 'coins were withheld rather than recovered from another purchase');
  assert.equal((await fromBot(p)).some(t => t.includes('ご支援ありがとうございます')), false);
});

test('partial refunds revoke only cumulative proportional coins and account for the actual yen once', async () => {
  const p = await buyer('PartialBack'), start = coins(p.me.id);
  const r = await checkout(p, { plan: 'support3', qty: 2, method: 'paypay' });
  const session = [...stripe.sessions.values()].find(x => x.client_reference_id === r.order.id);
  stripe.pay(session.id); await hook(event('checkout.session.completed', session));
  const pi = stripe.intents.get(session.payment_intent), charge = pi.latest_charge;
  const totalsBefore = (await call('GET', '/api/ops/pay', { token: taku.token })).totals;
  assert.equal(r.order.amount, 60); assert.equal(r.order.coins, 68);
  charge.amount_refunded = 1;
  const refund = event('charge.refunded', { object: 'charge', payment_intent: pi.id });
  await Promise.all([hook(refund), hook(refund), hook(event('charge.refunded', refund.data.object))]);
  assert.equal(coins(p.me.id), start + 67);
  let order = (await call('GET', `/api/pay/order?id=${r.order.id}`, { token: p.token })).order;
  assert.equal(order.status, 'paid'); assert.equal(order.statusName, '一部返金済み'); assert.equal(order.refundedAmount, 1);
  const totalsAfter = (await call('GET', '/api/ops/pay', { token: taku.token })).totals;
  assert.equal(totalsAfter.yen, totalsBefore.yen - 1); assert.equal(totalsAfter.refundYen, totalsBefore.refundYen + 1);
  charge.amount_refunded = 30; await hook(event('charge.refunded', refund.data.object));
  assert.equal(coins(p.me.id), start + 34);
  charge.amount_refunded = 1; await hook(event('charge.refunded', refund.data.object));
  assert.equal(coins(p.me.id), start + 34, 'a stale provider response cannot reduce cumulative refunds or refund coins twice');
  charge.amount_refunded = 60; await hook(event('charge.refunded', refund.data.object));
  assert.equal(coins(p.me.id), start);
  order = (await call('GET', `/api/pay/order?id=${r.order.id}`, { token: p.token })).order;
  assert.equal(order.status, 'refunded'); assert.equal(order.refundedAmount, 60);
});

test('a partially refunded payment first grants only its remaining entitlement and later refunds remain bounded', async () => {
  const p = await buyer('PartialFirst'), start = coins(p.me.id);
  const r = await checkout(p, { plan: 'support3', qty: 2, method: 'paypay' });
  const session = [...stripe.sessions.values()].find(x => x.client_reference_id === r.order.id);
  stripe.pay(session.id); const pi = stripe.intents.get(session.payment_intent); pi.latest_charge.amount_refunded = 30;
  await hook(event('charge.refunded', { object: 'charge', payment_intent: pi.id }));
  assert.equal(coins(p.me.id), start + 34);
  s.app.db.prepare('UPDATE users SET coins = 5 WHERE id = ?').run(p.me.id);
  pi.latest_charge.amount_refunded = 60;
  await hook(event('charge.refunded', { object: 'charge', payment_intent: pi.id }));
  assert.equal(coins(p.me.id), 0);
  s.app.db.prepare('UPDATE users SET coins = 100 WHERE id = ?').run(p.me.id);
  await hook(event('charge.refunded', { object: 'charge', payment_intent: pi.id }));
  assert.equal(coins(p.me.id), 100, 'an identical cumulative refund never collects from future income');
});

function failAudit(t, action) {
  t.mock.method(console, 'error', () => {});
  s.app.db.exec(`CREATE TRIGGER fail_payment_audit BEFORE INSERT ON ops_log WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END`);
  let active = true;
  const repair = () => { if (active) { active = false; s.app.db.exec('DROP TRIGGER fail_payment_audit'); } };
  t.after(repair); return repair;
}
function pauseProvider(t, predicate) {
  const original = globalThis.fetch, prefix = `http://127.0.0.1:${stripe.server.address().port}`;
  let entered, release, paused = false;
  const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async function (input, options) {
    const response = await original(input, options), url = String(input);
    if (!paused && url.startsWith(prefix) && predicate(new URL(url), options)) { paused = true; entered(); await gate; }
    return response;
  });
  t.after(() => release()); return { ready, release };
}
const paymentRow = id => s.app.db.prepare('SELECT * FROM pay_orders WHERE id=?').get(id);
const paymentLog = (id, action) => s.app.db.prepare('SELECT COUNT(*) AS n FROM ops_log WHERE action=? AND detail LIKE ?').get(action, '%' + id + '%').n;

for (const failThanks of [false, true]) test(`a paid notice rolls back coins and status when ${failThanks ? 'thanks' : 'audit'} storage fails`, async t => {
  const p = await buyer(failThanks ? 'ThanksFail' : 'PayLogFail'), start = coins(p.me.id);
  const r = await checkout(p, { plan: 'support3', qty: 2, method: 'paypay' });
  const session = [...stripe.sessions.values()].find(x => x.client_reference_id === r.order.id); stripe.pay(session.id);
  let repair;
  if (failThanks) {
    t.mock.method(console, 'error', () => {});
    s.app.db.exec("CREATE TRIGGER fail_payment_thanks BEFORE INSERT ON messages WHEN NEW.kind='text' BEGIN SELECT RAISE(ABORT,'simulated thanks failure'); END");
    repair = () => s.app.db.exec('DROP TRIGGER fail_payment_thanks');
    t.after(() => s.app.db.exec('DROP TRIGGER IF EXISTS fail_payment_thanks'));
  } else repair = failAudit(t, 'pay_paid');
  const events = [], send = s.app.live.send;
  t.mock.method(s.app.live, 'send', function (...args) { events.push(args); return send.apply(this, args); });
  const ev = event('checkout.session.completed', session);
  assert.equal((await hook(ev)).status, 503);
  assert.equal(coins(p.me.id), start); assert.equal(paymentRow(r.order.id).status, 'open');
  assert.equal(events.some(([id, name]) => id === p.me.id && ['pay', 'balance', 'msg'].includes(name)), false);
  repair(); assert.equal((await hook(ev)).status, 200); assert.equal((await hook(ev)).status, 200);
  assert.equal(coins(p.me.id), start + 68); assert.equal(paymentLog(r.order.id, 'pay_paid'), 1);
  assert.equal((await fromBot(p)).filter(text => text.includes('【ご支援ありがとうございます】')).length, 1);
});

test('refunds remain retryable and never remove coins without their audit record', async t => {
  const p = await buyer('RefundLog'), start = coins(p.me.id), r = await checkout(p, { plan: 'support3', qty: 2, method: 'paypay' });
  const session = [...stripe.sessions.values()].find(x => x.client_reference_id === r.order.id); stripe.pay(session.id);
  await hook(event('checkout.session.completed', session)); stripe.refund(session.id);
  const before = paymentRow(r.order.id), repair = failAudit(t, 'pay_refund');
  const ev = event('charge.refunded', { object: 'charge', payment_intent: session.payment_intent });
  assert.equal((await hook(ev)).status, 503); assert.equal(coins(p.me.id), start + 68);
  const after = paymentRow(r.order.id); for (const key of ['status', 'refunded_amount', 'coins_revoked', 'coins_back']) assert.equal(after[key], before[key]);
  repair(); assert.equal((await hook(ev)).status, 200); assert.equal((await hook(ev)).status, 200);
  assert.equal(coins(p.me.id), start); assert.equal(paymentLog(r.order.id, 'pay_refund'), 1);
});

test('a konbini slip audit failure does not permanently mark the order pending', async t => {
  const p = await buyer('SlipLogFail'), r = await checkout(p, { plan: 'support2', qty: 6, method: 'konbini' });
  const session = [...stripe.sessions.values()].find(x => x.client_reference_id === r.order.id); stripe.slip(session.id);
  const repair = failAudit(t, 'pay_slip'), ev = event('checkout.session.completed', session);
  assert.equal((await hook(ev)).status, 503); assert.equal(paymentRow(r.order.id).status, 'open');
  repair(); assert.equal((await hook(ev)).status, 200); assert.equal(paymentRow(r.order.id).status, 'pending');
  assert.equal(paymentLog(r.order.id, 'pay_slip'), 1);
});

test('a developer payment reply is not marked or delivered if its audit cannot be saved', async t => {
  const p = await buyer('ReplyLogFail'), r = await checkout(p, { plan: 'support3', qty: 2, method: 'paypay' });
  const session = [...stripe.sessions.values()].find(x => x.client_reference_id === r.order.id); stripe.pay(session.id); await hook(event('checkout.session.completed', session));
  const repair = failAudit(t, 'pay_reply'), body = { id: p.me.id, text: 'reply audit retry' };
  assert.equal((await call('POST', '/api/ops/pay/reply', { token: taku.token, body })).status, 500);
  assert.equal(paymentRow(r.order.id).replied_at, 0);
  assert.equal((await fromBot(p)).filter(text => text.includes('reply audit retry')).length, 0);
  repair(); assert.equal((await call('POST', '/api/ops/pay/reply', { token: taku.token, body })).status, 200);
  assert.equal((await call('POST', '/api/ops/pay/reply', { token: taku.token, body })).status, 409);
  assert.equal((await fromBot(p)).filter(text => text.includes('reply audit retry')).length, 1);
});

test('checkout rechecks age after a delayed body rather than using the original adult flag', async () => {
  const p = await buyer('AgeBodyRace'); let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const result = s.app.api.handle({ method: 'POST', path: '/api/pay/checkout', query: new URLSearchParams(), ip: '127.0.0.1',
    header: name => name.toLowerCase() === 'authorization' ? 'Bearer ' + p.token : '',
    json: () => { entered(); return new Promise(resolve => { release = () => resolve({ plan: 'support3', qty: 2, method: 'paypay' }); }); } });
  await ready; s.setUser(p.me.id, { age_ok: 0 }); release();
  assert.equal((await result).status, 403);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM pay_orders WHERE user_id=?').get(p.me.id).n, 0);
});

for (const changed of ['logout', 'ban', 'age']) test(`a checkout delayed at the provider cannot return a usable page after ${changed}`, async t => {
  const p = await buyer('PR' + changed), gate = pauseProvider(t, (url, opts) => url.pathname === '/v1/checkout/sessions' && opts.method === 'POST');
  const pending = checkout(p, { plan: 'support3', qty: 2, method: 'paypay' }); await gate.ready;
  if (changed === 'logout') await call('POST', '/api/logout', { token: p.token });
  else if (changed === 'ban') s.setUser(p.me.id, { banned: 1, ban_kind: 'perma' });
  else s.setUser(p.me.id, { age_ok: 0 });
  gate.release(); const result = await pending; assert.equal(result.status, changed === 'logout' ? 401 : 403); assert.equal(result.url, undefined);
  const session = [...stripe.sessions.values()].find(x => x.metadata.user === String(p.me.id)); assert.equal(session.status, 'expired');
  assert.equal(paymentRow(session.client_reference_id).status, 'error');
});

for (const cancel of [false, true]) test(`a delayed payment ${cancel ? 'cancel' : 'look'} cannot return private order data to a revoked session`, async t => {
  const p = await buyer(cancel ? 'CancelLogout' : 'LookLogout'), r = await checkout(p, { plan: 'support3', qty: 2, method: 'paypay' });
  const gate = pauseProvider(t, (url, opts) => cancel ? url.pathname.endsWith('/expire') : url.pathname.includes('/checkout/sessions/') && opts.method === 'GET');
  const pending = cancel ? call('POST', '/api/pay/cancel', { token: p.token, body: { order: r.order.id } }) : call('GET', '/api/pay/order?id=' + r.order.id, { token: p.token });
  await gate.ready; await call('POST', '/api/logout', { token: p.token }); gate.release();
  const result = await pending; assert.equal(result.status, 401); assert.equal(result.order, undefined);
});

test('a checkout audit failure closes its provider page and releases the unused daily allowance', async t => {
  const p = await buyer('OpenLogFail'), repair = failAudit(t, 'pay_order');
  assert.equal((await checkout(p, { plan: 'support3', qty: 2, method: 'paypay' })).status, 500);
  const session = [...stripe.sessions.values()].find(x => x.metadata.user === String(p.me.id));
  assert.equal(session.status, 'expired'); assert.equal(paymentRow(session.client_reference_id).status, 'error');
  assert.equal(paymentRow(session.client_reference_id).session_id, session.id);
  repair(); assert.equal((await checkout(p, { plan: 'support3', qty: 2, method: 'paypay' })).status, 200);
});

test('checkout cleanup preserves a payment completed before the session was revoked', async t => {
  const p = await buyer('PaidCleanup'), before = coins(p.me.id);
  const gate = pauseProvider(t, (url, opts) => url.pathname === '/v1/checkout/sessions' && opts.method === 'POST');
  const pending = checkout(p, { plan: 'support3', qty: 2, method: 'paypay' }); await gate.ready;
  const session = [...stripe.sessions.values()].find(x => x.metadata.user === String(p.me.id)); stripe.pay(session.id);
  const ev = event('checkout.session.completed', session); assert.equal((await hook(ev)).status, 200);
  await call('POST', '/api/logout', { token: p.token }); gate.release();
  assert.equal((await pending).status, 401);
  assert.equal(paymentRow(session.client_reference_id).status, 'paid'); assert.equal(coins(p.me.id), before + 68);
  assert.equal((await hook(ev)).status, 200); assert.equal(coins(p.me.id), before + 68);
});
