// DEV8 on the server: 開発者支援 paid through Stripe (a stand-in for Stripe's
// API runs on this machine) and the developer's vault. npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer } from './helpers.js';

const KEY = 'sk_test_' + 'x'.repeat(24);
const WHSEC = 'whsec_' + crypto.randomBytes(16).toString('hex');
const CODE = '987654321098';   // (a test code: the real one is never written anywhere)
const LIMITS = {
  spin: [100000, 1000], shop: [100000, 1000], general: [100000, 1000], login: [100000, 1000], friend: [100000, 1000], transfer: [100000, 1000], dm: [100000, 1000],
  payCheckout: [100000, 1000], payCheckoutIp: [100000, 1000], payLook: [100000, 1000]
};

// Stripe's API as far as the game uses it: payment pages, payments, expiry
function fakeStripe() {
  const sessions = new Map(), intents = new Map(), keys = new Map(), seen = [];
  let n = 0;
  function view(s, expand) {
    const out = { ...s };
    if (s.payment_intent && expand) out.payment_intent = intents.get(s.payment_intent);
    return out;
  }
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: { message: 'Invalid API Key provided' } });
      const f = new URLSearchParams(body);
      seen.push({ method: req.method, path: url.pathname, form: f, version: req.headers['stripe-version'], idem: req.headers['idempotency-key'] });
      let m;
      if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
        const key = req.headers['idempotency-key'];
        if (key && keys.has(key)) return send(200, view(sessions.get(keys.get(key))));
        const id = `cs_test_${++n}${crypto.randomBytes(8).toString('hex')}`;
        const s = {
          id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, client_reference_id: f.get('client_reference_id'),
          metadata: { order: f.get('metadata[order]'), user: f.get('metadata[user]') }, mode: f.get('mode'), currency: f.get('line_items[0][price_data][currency]'),
          amount_total: Number(f.get('line_items[0][price_data][unit_amount]')) * Number(f.get('line_items[0][quantity]')),
          livemode: false, status: 'open', payment_status: 'unpaid', payment_intent: null
        };
        sessions.set(id, s);
        if (key) keys.set(key, id);
        return send(200, view(s));
      }
      if (req.method === 'GET' && (m = /^\/v1\/checkout\/sessions\/(cs_\w+)$/.exec(url.pathname))) {
        const s = sessions.get(m[1]);
        return s ? send(200, view(s, url.searchParams.get('expand[0]') === 'payment_intent')) : send(404, { error: { message: 'No such checkout.session' } });
      }
      if (req.method === 'POST' && (m = /^\/v1\/checkout\/sessions\/(cs_\w+)\/expire$/.exec(url.pathname))) {
        const s = sessions.get(m[1]);
        if (!s || s.status !== 'open') return send(400, { error: { message: 'not open' } });
        s.status = 'expired';
        return send(200, view(s));
      }
      if (req.method === 'GET' && (m = /^\/v1\/payment_intents\/(pi_\w+)$/.exec(url.pathname))) {
        const pi = intents.get(m[1]);
        return pi ? send(200, pi) : send(404, { error: { message: 'No such payment_intent' } });
      }
      send(404, { error: { message: 'Unrecognized request URL' } });
    });
  });
  function intent(s, status, extra = {}) {
    const id = `pi_test_${s.id.slice(8)}`;
    intents.set(id, { id, object: 'payment_intent', amount: s.amount_total, currency: 'jpy', status, metadata: { order: s.client_reference_id }, latest_charge: { id: `ch_test_${s.id.slice(8)}`, object: 'charge', amount_refunded: 0 }, ...extra });
    s.payment_intent = id;
    return intents.get(id);
  }
  return {
    server, sessions, intents, seen,
    pay(id) { const s = sessions.get(id); s.status = 'complete'; s.payment_status = 'paid'; intent(s, 'succeeded'); return s; },
    slip(id) {
      const s = sessions.get(id);
      s.status = 'complete';
      intent(s, 'requires_action', { next_action: { type: 'konbini_display_details', konbini_display_details: { hosted_voucher_url: 'https://payments.stripe.com/konbini/voucher/test_abc123', expires_at: Math.floor(Date.now() / 1000) + 3 * 86400 } } });
      return s;
    },
    cash(id) { const s = sessions.get(id); s.payment_status = 'paid'; intents.get(s.payment_intent).status = 'succeeded'; return s; },
    refund(id) { const s = sessions.get(id); intents.get(s.payment_intent).latest_charge.amount_refunded = s.amount_total; return s; }
  };
}

let s, call, register, stripe, taku, sub;

before(async () => {
  stripe = fakeStripe();
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

test('the vault: the developer code opens it, every piece is checked, a link fetches the file read-only', async () => {
  const vault = (method, url, body, ticket, who = taku) => call(method, url, { token: who.token, body, headers: ticket ? { 'X-Vault-Ticket': ticket } : {} });
  assert.equal((await vault('POST', '/api/vault/open', { code: CODE }, null, sub)).error.code, 'not_developer');
  assert.equal((await vault('POST', '/api/ops/dev-code', { code: CODE })).devCodeSet, true);
  assert.equal((await vault('POST', '/api/vault/open', { code: '111111111111' })).error.code, 'dev_code');
  const { ticket, chunk } = await vault('POST', '/api/vault/open', { code: CODE });
  assert.equal((await vault('GET', '/api/vault/files')).error.code, 'vault_locked');
  assert.equal((await vault('GET', '/api/vault/files', undefined, ticket + 'x')).error.code, 'vault_locked');

  const data = crypto.randomBytes(2 * chunk + 1000);
  const parts = [0, 1, 2].map((n) => data.subarray(n * chunk, (n + 1) * chunk));
  const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const { file } = await vault('POST', '/api/vault/files', { name: '../garage.glb', size: data.length, type: 'model/gltf-binary', note: '3Dガレージ' }, ticket);
  assert.deepEqual([file.name, file.chunks, file.done], ['garage.glb', 3, false]);
  const put = (n, sha = hash(parts[n])) => vault('POST', '/api/vault/chunk', { id: file.id, n, sha256: sha, data: parts[n].toString('base64') }, ticket);
  assert.equal((await put(0, hash(parts[1]))).error.code, 'bad_hash');
  assert.equal((await put(0)).received, 1);
  assert.equal((await put(1)).received, 2);
  assert.deepEqual((await vault('GET', `/api/vault/missing?id=${file.id}`, undefined, ticket)).missing, [[2, 2]]);
  const last = await put(2);
  const whole = hash(Buffer.concat(parts.map((b) => Buffer.from(hash(b), 'hex'))));
  assert.deepEqual([last.done, last.sha256], [true, whole]);
  assert.equal((await vault('GET', `/api/vault/chunk?id=${file.id}&n=1`, undefined, ticket)).data, parts[1].toString('base64'));

  // a link: no login, read-only, until stopped
  const link = await vault('POST', '/api/vault/link', { id: file.id, hours: 1 }, ticket);
  const meta = await call('GET', link.path);
  assert.deepEqual([meta.name, meta.size, meta.chunks, meta.sha256], ['garage.glb', data.length, 3, whole]);
  const got = Buffer.concat(await Promise.all([0, 1, 2].map(async (n) => Buffer.from((await call('GET', `${link.path}&n=${n}`)).data, 'base64'))));
  assert.ok(got.equals(data));
  await vault('POST', '/api/vault/link/stop', { id: file.id }, ticket);
  assert.equal((await call('GET', link.path)).status, 404);
  assert.equal((await call('GET', '/api/vault/pull?t=' + 'a'.repeat(43))).status, 404);

  await vault('POST', '/api/vault/delete', { id: file.id }, ticket);
  assert.equal((await vault('GET', '/api/vault/files', undefined, ticket)).files.length, 0);
  const log = (await call('GET', '/api/ops/log', { token: taku.token })).entries.map((e) => e.action);
  for (const a of ['vault_open', 'vault_upload', 'vault_link', 'vault_pull', 'vault_link_stop', 'vault_delete']) assert.ok(log.includes(a), a);
});
