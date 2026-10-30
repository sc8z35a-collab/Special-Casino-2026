/* Run the same deterministic contract against Node and real local workerd. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startWorker } = require('./worker-fixture.cjs');
const { configFrom } = require('../server/core/config.js');

(async () => {
  const { startServer } = await import('../server/test/helpers.js');
  const { fakeStripe } = await import('../server/test/fake-stripe.js');
  const paymentKey = 'sk_test_' + 'p'.repeat(24), webhookSecret = 'whsec_' + crypto.randomBytes(16).toString('hex');
  const stripe = fakeStripe(paymentKey);
  await new Promise(resolve => stripe.server.listen(0, '127.0.0.1', resolve));
  const admin = crypto.randomBytes(24).toString('hex');
  const vars = { START_TOKENS: 10000, START_DOLLARS: 1000000, START_COINS: 100, LOGIN_BONUS: false, QUESTS: false, NPC_GIFTS: false, MILESTONES: false,
    REGISTRATIONS_PER_IP: 0, ACCOUNTS_PER_DEVICE: 0, ADMIN_TOKEN: admin,
    STRIPE_SECRET_KEY: paymentKey, STRIPE_WEBHOOK_SECRET: webhookSecret, STRIPE_API: `http://127.0.0.1:${stripe.server.address().port}`, PUBLIC_URL: 'https://casino.example' };
  const node = await startServer(configFrom(vars));
  let worker;
  try {
    worker = await startWorker({ vars });
    async function contract(base) {
      const trace = [];
      async function call(method, path, actor = null, body, extra = {}) {
        const headers = { ...extra }; if (actor) headers.Authorization = 'Bearer ' + actor.token;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const result = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        assert.match(result.headers.get('content-type'), /^application\/json/);
        const json = await result.json();
        return { status: result.status, ...json };
      }
      function record(label, reply, data = null) { trace.push({ label, status: reply.status, error: reply.error?.code || '', data }); }
      const register = (name, device) => call('POST', '/api/register', null, { name, password: 'pass1234', avatar: 'traveler-green' }, { 'X-Device': device.repeat(32) });
      const a = await register('ParityA', 'a'), b = await register('ParityB', 'b');
      assert.equal(a.status, 200, JSON.stringify(a)); assert.equal(b.status, 200, JSON.stringify(b));
      const wallet = (r) => Object.fromEntries(['tokens', 'dollars', 'coins', 'spins', 'totalWon', 'totalBet'].map((key) => [key, r.me[key]]));
      record('registered wallet', a, wallet(a));
      record('authentication required', await call('GET', '/api/me'));
      record('unknown route', await call('GET', '/api/no-such-contract-route', a));
      record('bad login', await call('POST', '/api/login', null, { name: 'ParityA', password: 'wrong-password' }));
      const login = await call('POST', '/api/login', null, { name: 'ParityA', password: 'pass1234' });
      assert.equal(login.status, 200); record('password login', login, wallet(login));
      for (const actor of [a, b]) assert.equal((await call('POST', '/api/age', actor, { adult: true })).status, 200);
      const bought = await call('POST', '/api/buy', a, { amount: 3 }); assert.equal(bought.status, 200); record('buy', bought, wallet(bought));
      const sold = await call('POST', '/api/sell', a, { amount: 2 }); assert.equal(sold.status, 200); record('sell', sold, wallet(sold));
      record('negative amount', await call('POST', '/api/buy', a, { amount: -1 }));
      record('insufficient balance', await call('POST', '/api/buy', a, { amount: 100000000 }));
      record('operator permissions', await call('GET', '/api/ops/me', a));
      const request = await call('POST', '/api/friends/request', a, { user: b.me.id }); assert.equal(request.status, 200); record('friend request', request, request.friendship);
      const accept = await call('POST', '/api/friends/respond', b, { user: a.me.id, accept: true }); assert.equal(accept.status, 200); record('friend acceptance', accept, accept.friendship);
      const watch = (id, on) => call('POST', '/api/watch', b, { user: id, on });
      const firstWatch = await watch(a.me.id, true); assert.equal(firstWatch.status, 200); assert.ok(Number.isSafeInteger(firstWatch.since));
      const repeated = await watch(a.me.id, true); assert.equal(repeated.since, firstWatch.since); record('stable watch membership', repeated, true);
      const grant = since => call('POST', '/api/watch/voice', a, { user: b.me.id, on: true, since });
      const consent = await grant(firstWatch.since); assert.equal(consent.status, 200); assert.ok(consent.voice.includes(b.me.id)); record('current voice consent', consent, true);
      await call('POST', '/api/block', a, { user: b.me.id, blocked: true });
      const ownerBlocked = await call('GET', '/api/me', a), peerBlocked = await call('GET', '/api/me', b);
      assert.deepEqual(ownerBlocked.blocked, [b.me.id]); assert.deepEqual(peerBlocked.blocked, []); record('block snapshots stay private', ownerBlocked, true);
      await call('POST', '/api/block', a, { user: b.me.id, blocked: false });
      await watch(a.me.id, false);
      const replacement = await watch(a.me.id, true); assert.notEqual(replacement.since, firstWatch.since);
      const stale = await grant(firstWatch.since); assert.equal(stale.status, 409); assert.equal(stale.error.code, 'watch_changed'); record('old membership voice refused', stale);
      const home = await call('GET', '/api/watchers', a); assert.equal(home.watchers.find(w => w.id === b.me.id).voice, false); record('replacement remains muted', home, true);
      const c = await register('ParityC', 'c'); assert.equal(c.status, 200);
      assert.equal((await call('POST', '/api/friends/request', b, { user: c.me.id })).status, 200);
      assert.equal((await call('POST', '/api/friends/respond', c, { user: b.me.id, accept: true })).status, 200);
      await watch(c.me.id, true); await watch(a.me.id, false);
      const latestHome = await call('GET', '/api/watchers', c);
      assert.ok(latestHome.watchers.some(w => w.id === b.me.id)); record('old host exit preserves latest watch', latestHome, true);
      await watch(c.me.id, false);
      const text = 'こんにちは 世界', sent = await call('POST', '/api/messages', a, { to: b.me.id, text });
      assert.equal(sent.status, 200); assert.equal(sent.message.text, text); record('Unicode message', sent, { text: sent.message.text, kind: sent.message.kind });
      const received = await call('GET', '/api/messages?with=' + a.me.id, b);
      assert.equal(received.messages.filter((message) => message.text === text).length, 1); record('delivered once', received, true);
      const retract = await call('POST', '/api/messages/retract', a, { message: sent.message.id }); assert.equal(retract.status, 200); record('retract', retract);
      const after = await call('GET', '/api/messages?with=' + a.me.id, b);
      assert.equal(after.messages.find((message) => message.id === sent.message.id).text, ''); record('retracted text hidden', after, true);
      for (let stage = 1; stage <= 2; stage++) {
        const warned = await call('POST', '/api/messages', a, { to: b.me.id, text: String.fromCharCode(0) });
        if (warned.error?.stage !== stage) console.error('filter contract', base, warned);
        assert.equal(warned.status, 400); assert.equal(warned.error.stage, stage); assert.equal(warned.error.warning, true);
        record('control DM warning ' + stage, warned, { stage: warned.error.stage, warning: warned.error.warning });
      }
      const allowed = await call('POST', '/api/messages', a, { to: b.me.id, text: 'ordinary message after warnings' });
      assert.equal(allowed.status, 200); record('warnings retain ordinary chat', allowed);
      const filtered = await call('POST', '/api/messages', a, { to: b.me.id, text: 'data:application/octet-stream;base64,' + 'AbCd0123456789'.repeat(20) });
      assert.equal(filtered.status, 400); assert.equal(filtered.error.code, 'filtered'); record('attachment filter', filtered);
      const stopped = await call('POST', '/api/messages', a, { to: b.me.id, text: 'ordinary words' });
      assert.equal(stopped.status, 403); assert.equal(stopped.error.code, 'chat_banned'); record('chat ban after filter', stopped);
      const typingStopped = await call('POST', '/api/typing', a, { to: b.me.id });
      assert.equal(typingStopped.status, 403); assert.equal(typingStopped.error.code, 'chat_banned'); record('suspended chat cannot type', typingStopped);
      const exported = await call('POST', '/api/admin', null, { cmd: 'export', args: [] }, { 'X-Admin-Token': admin });
      assert.equal(exported.status, 200);
      record('schema and backup tables', exported, { schema: exported.result.schema, tables: Object.keys(exported.result.tables).sort() });
      // Disposable fixtures only: restore an exact wage boundary and use the
      // real balance guard to force a failure inside each host's transaction.
      const snapshot = exported.result, row = snapshot.tables.users.find(u => u.id === c.me.id);
      row.dollars = Number.MAX_SAFE_INTEGER; row.vip_exp = 1200; row.vip_until = row.vip_trial_until = 0;
      row.jobs = JSON.stringify([{ id: 'garage', since: Date.now() - 3600000 }]);
      snapshot.tables.items.push({ user_id: c.me.id, item: 'gacha-vip-week', count: 1 });
      snapshot.tables.items.push({ user_id: c.me.id, item: 'gacha-seed', count: 1 });
      const restored = await call('POST', '/api/admin', null, { cmd: 'import', args: [snapshot, true] }, { 'X-Admin-Token': admin });
      assert.equal(restored.status, 200, JSON.stringify(restored));
      const refused = await call('POST', '/api/gacha/use', c, { item: 'vip-week' });
      assert.equal(refused.status, 409); assert.equal(refused.error.code, 'balance_limit'); record('VIP overflow refuses ticket', refused);
      const afterFailure = await call('POST', '/api/admin', null, { cmd: 'export', args: [] }, { 'X-Admin-Token': admin });
      const untouched = afterFailure.result.tables.users.find(u => u.id === c.me.id);
      assert.equal(untouched.jobs, row.jobs); assert.equal(untouched.vip_until, 0); assert.equal(untouched.dollars, Number.MAX_SAFE_INTEGER);
      assert.equal(afterFailure.result.tables.items.find(i => i.user_id === c.me.id && i.item === 'gacha-vip-week').count, 1);
      record('VIP rollback retains wages and ticket', afterFailure, true);
      assert.equal((await call('POST', '/api/admin', null, { cmd: 'grant', args: [c.me.id, 'dollars', 1000000 - Number.MAX_SAFE_INTEGER] }, { 'X-Admin-Token': admin })).status, 200);
      const used = await call('POST', '/api/gacha/use', c, { item: 'vip-week' });
      assert.equal(used.status, 200); assert.ok(used.me.dollars >= 1020000); assert.equal(used.items.vipWeek, 0);
      record('VIP ticket settles old wages', used, true);
      const usedAgain = await call('POST', '/api/gacha/use', c, { item: 'vip-week' });
      assert.equal(usedAgain.status, 409); assert.equal(usedAgain.error.code, 'no_item'); record('VIP ticket consumed once', usedAgain);
      const seed = await call('POST', '/api/gacha/use', c, { item: 'seed' }); assert.equal(seed.status, 200);
      assert.equal((await call('GET', '/api/tree', c)).trees.length, 2); record('gacha seed preserves starter tree', seed, true);
      const firstAuction = await call('POST', '/api/tree/auction/start', c, { market: 'seed' }); assert.equal(firstAuction.status, 200);
      assert.equal((await call('POST', '/api/tree/auction/leave', c, { id: firstAuction.auction.id })).status, 200);
      const secondAuction = await call('POST', '/api/tree/auction/start', c, { market: 'seed' }); assert.equal(secondAuction.status, 200);
      const oldBid = await call('POST', '/api/tree/auction/bid', c, { id: firstAuction.auction.id, steps: 1 });
      assert.equal(oldBid.status, 409); assert.equal(oldBid.error.code, 'auction_changed'); record('old auction bid refused', oldBid);
      const oldLeave = await call('POST', '/api/tree/auction/leave', c, { id: firstAuction.auction.id });
      assert.equal(oldLeave.status, 409); assert.equal(oldLeave.error.code, 'auction_changed'); record('old auction exit refused', oldLeave);
      const stillLive = await call('GET', '/api/tree/auction', c); assert.equal(stillLive.auction.id, secondAuction.auction.id); assert.equal(stillLive.auction.status, 'live'); record('replacement auction stays live', stillLive, true);
      const exit = await call('POST', '/api/tree/auction/leave', c, { id: secondAuction.auction.id }); assert.equal(exit.status, 200); assert.equal(exit.auction.status, 'left'); record('current auction exit allowed', exit);
      assert.equal((await call('POST', '/api/age', c, { adult: true })).status, 200);
      const checkout = await call('POST', '/api/pay/checkout', c, { plan: 'support3', qty: 2, method: 'paypay' });
      assert.equal(checkout.status, 200, JSON.stringify(checkout)); record('payment checkout', checkout, [checkout.order.amount, checkout.order.coins, checkout.order.status]);
      const session = [...stripe.sessions.values()].find(s => s.client_reference_id === checkout.order.id); assert.ok(session);
      const beforeCoins = (await call('GET', '/api/me', c)).me.coins;
      assert.equal((await call('POST', '/api/admin', null, { cmd: 'grant', args: [c.me.id, 'coins', Number.MAX_SAFE_INTEGER - beforeCoins] }, { 'X-Admin-Token': admin })).status, 200);
      stripe.pay(session.id);
      const ev = { id: 'evt_test_' + crypto.randomBytes(8).toString('hex'), object: 'event', type: 'checkout.session.completed', livemode: false, data: { object: session } };
      const hook = event => {
        const timestamp = Math.floor(Date.now() / 1000), raw = JSON.stringify(event);
        const signature = crypto.createHmac('sha256', webhookSecret).update(timestamp + '.' + raw).digest('hex');
        return call('POST', '/api/pay/webhook', null, event, { 'Stripe-Signature': `t=${timestamp},v1=${signature}` });
      };
      const overflow = await hook(ev); assert.equal(overflow.status, 503); record('payment balance overflow retries', overflow);
      assert.equal((await call('GET', '/api/pay/order?id=' + checkout.order.id, c)).order.status, 'open');
      assert.equal((await call('GET', '/api/me', c)).me.coins, Number.MAX_SAFE_INTEGER); record('payment overflow preserves order and wallet', overflow, true);
      assert.equal((await call('POST', '/api/admin', null, { cmd: 'grant', args: [c.me.id, 'coins', beforeCoins - Number.MAX_SAFE_INTEGER] }, { 'X-Admin-Token': admin })).status, 200);
      const retried = await hook(ev); assert.equal(retried.status, 200);
      assert.equal((await call('GET', '/api/me', c)).me.coins, beforeCoins + checkout.order.coins); record('payment retry grants coins once', retried, true);
      assert.equal((await hook(ev)).status, 200); assert.equal((await hook({ ...ev, id: 'evt_test_' + crypto.randomBytes(8).toString('hex') })).status, 200);
      assert.equal((await call('GET', '/api/me', c)).me.coins, beforeCoins + checkout.order.coins); record('duplicate payment cannot credit twice', retried, true);
      stripe.refund(session.id);
      const refund = { ...ev, id: 'evt_test_' + crypto.randomBytes(8).toString('hex'), type: 'charge.refunded', data: { object: { object: 'charge', payment_intent: session.payment_intent } } };
      const refunded = await hook(refund); assert.equal(refunded.status, 200); assert.equal((await hook(refund)).status, 200);
      assert.equal((await call('GET', '/api/me', c)).me.coins, beforeCoins);
      assert.equal((await call('GET', '/api/pay/order?id=' + checkout.order.id, c)).order.status, 'refunded'); record('refund revokes only once', refunded, true);
      // Reuse the completed sender fixture so these extra cases do not spend
      // the registration burst needed by the existing WebSocket checks below.
      const d = a;
      const drawBody = { key: Date.now() + '-' + crypto.randomBytes(16).toString('hex'), bet: 100, idle: 0 };
      const drawn = await call('POST', '/api/spin', d, drawBody); assert.equal(drawn.status, 200);
      const shop = await call('GET', '/api/items', d), omamori = shop.shop.items.find(i => i.id === 'omamori');
      assert.equal((await call('POST', '/api/shop/buy', d, { id: 'omamori', price: omamori.salePrice, count: 1 })).status, 200);
      assert.equal((await call('POST', '/api/charm', d, {})).status, 200);
      assert.equal((await call('POST', '/api/vip/trial', d, {})).status, 200);
      const rotated = await call('POST', '/api/password', d, { current: 'pass1234', password: 'new-parity-password' }); assert.equal(rotated.status, 200);
      const oldSession = await call('GET', '/api/me', d); assert.equal(oldSession.status, 401); record('rotation revokes original draw session', oldSession);
      const current = { token: rotated.token }, me = (await call('GET', '/api/me', current)).me;
      const replayed = await call('POST', '/api/spin', current, drawBody); assert.equal(replayed.status, 200);
      assert.deepEqual(replayed.result, drawn.result); record('rotation replay preserves exact draw', replayed, true);
      assert.deepEqual(replayed.balance, { tokens: me.tokens, dollars: me.dollars, coins: me.coins, rev: me.rev });
      assert.equal(replayed.xp, me.xp); assert.equal(replayed.charm, true); assert.deepEqual(replayed.vip, me.vip);
      record('rotation replay returns current account state', replayed, true);
      assert.equal((await call('GET', '/api/me', current)).me.spins, 1); record('rotation replay cannot bet twice', replayed, true);
      const lender = await call('GET', '/api/peter', current), beforeChat = await call('GET', '/api/messages?with=' + lender.peter.id, current);
      assert.equal((await call('POST', '/api/admin', null, { cmd: 'grant', args: [d.me.id, 'dollars', Number.MAX_SAFE_INTEGER - me.dollars] }, { 'X-Admin-Token': admin })).status, 200);
      const loan = await call('POST', '/api/messages', current, { to: lender.peter.id, text: '100万貸して' });
      assert.equal(loan.status, 409); assert.equal(loan.error.code, 'balance_limit'); record('NPC loan overflow refuses whole exchange', loan);
      const afterChat = await call('GET', '/api/messages?with=' + lender.peter.id, current);
      assert.deepEqual(afterChat.messages, beforeChat.messages);
      assert.equal((await call('GET', '/api/peter', current)).debt.lent, 0); assert.equal((await call('GET', '/api/me', current)).me.dollars, Number.MAX_SAFE_INTEGER);
      record('failed NPC loan leaves no message or debt', afterChat, true);
      const pushBackup = await call('POST', '/api/admin', null, { cmd: 'export', args: [] }, { 'X-Admin-Token': admin });
      const browserKey = crypto.createECDH('prime256v1').generateKeys().toString('base64url'), browserAuth = crypto.randomBytes(16).toString('base64url');
      const endpoint = n => 'https://fcm.googleapis.com/fcm/send/parity-phone-' + n;
      for (let n=0; n<9; n++) pushBackup.result.tables.push_subs.push({ endpoint: endpoint(n), user_id: n ? b.me.id : a.me.id,
        p256dh: browserKey, auth: browserAuth, created_at: n + 1 });
      const pushRestored = await call('POST', '/api/admin', null, { cmd: 'import', args: [pushBackup.result, true] }, { 'X-Admin-Token': admin });
      assert.equal(pushRestored.status, 200, JSON.stringify(pushRestored));
      const registered = await call('POST', '/api/push/subscribe', b, { endpoint: endpoint(0), keys: { p256dh: browserKey, auth: browserAuth } }); assert.equal(registered.status, 200);
      const registeredRows = (await call('POST', '/api/admin', null, { cmd: 'export', args: [] }, { 'X-Admin-Token': admin })).result.tables.push_subs;
      assert.equal(registeredRows.find(r => r.endpoint === endpoint(0))?.user_id, b.me.id);
      assert.equal(registeredRows.filter(r => r.user_id === b.me.id).length, 8); record('active notification phone survives device cap', registered, true);
      const logout = await call('POST', '/api/logout', b, { endpoint: endpoint(0) }); assert.equal(logout.status, 200); record('logout', logout);
      const logoutRows = (await call('POST', '/api/admin', null, { cmd: 'export', args: [] }, { 'X-Admin-Token': admin })).result.tables.push_subs;
      assert.equal(logoutRows.some(r => r.endpoint === endpoint(0)), false); assert.equal(logoutRows.filter(r => r.user_id === b.me.id).length, 7);
      record('logout detaches only its notification phone', logout, true);
      const revoked = await call('GET', '/api/me', b); assert.equal(revoked.status, 401); record('revoked session', revoked);
      return trace;
    }
    const expected = await contract(node.base), actual = await contract(worker.base);
    assert.deepEqual(actual, expected, 'Node and Workers must preserve the same contract');
    console.log('PASS runtime parity: ' + expected.length + ' contracts; balances, auth, permissions, watch/voice, VIP wage rollback, payment rollback/retry/refund, password-rotation spin replay, NPC chat rollback, Unicode chat, filtering, backup schema and session revocation');
    // Real hibernating WebSockets must be bound to one session, including
    // unused tickets. A second device of the same account remains connected.
    async function call(path, body, token) {
      const res = await fetch(worker.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': crypto.randomBytes(16).toString('hex'), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
      const r = await res.json(); assert.equal(res.status, 200, path + ': ' + JSON.stringify(r)); return r;
    }
    function open(ticket, operator = false) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(worker.base.replace(/^http/, 'ws') + '/api/live?' + (operator ? 'ops=' : 'ticket=') + encodeURIComponent(ticket));
        ws.addEventListener('message', () => {});
        ws.addEventListener('open', () => resolve(ws), { once: true });
        ws.addEventListener('error', reject, { once: true });
      });
    }
    for (const [name, operator] of [['RevokeWS', false], ['taku', true]]) {
      const p = await call('/api/register', { name, password: 'pass1234', avatar: 'traveler-green' });
      const second = await call('/api/login', { name, password: 'pass1234' });
      const path = operator ? '/api/ops/live-ticket' : '/api/stream-ticket';
      const a = await open((await call(path, {}, p.token)).ticket, operator);
      const b = await open((await call(path, {}, second.token)).ticket, operator);
      try {
        const unused = (await call(path, {}, p.token)).ticket;
        await call('/api/logout', {}, p.token);
        // Miniflare/undici can keep the closing handshake pending. The close
        // frame must already have made the connection unusable for messages.
        const until = Date.now() + 5000;
        while (a.readyState === WebSocket.OPEN && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
        assert.notEqual(a.readyState, WebSocket.OPEN, 'revoked WebSocket must stop accepting messages');
        assert.equal(b.readyState, WebSocket.OPEN, 'another session stays live');
        await assert.rejects(open(unused, operator), 'a logged-out session cannot spend an unused ticket');
      } finally { a.close(); b.close(); }
    }
    console.log('PASS real workerd WebSocket logout: player/operator streams and unused tickets revoked, other devices preserved');
  } finally {
    if (worker) await worker.stop();
    await node.stop();
    await new Promise(resolve => stripe.server.close(resolve));
  }
  // Quest completion can itself settle VIP wages. Keep this boundary in a
  // fresh pair of hosts so existing registration bursts and actors stay intact.
  const { marketContract } = require('./market-contract.cjs');
  const marketVars = { ...vars, QUESTS: true, STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' };
  const marketNode = await startServer(configFrom(marketVars)); let marketWorker;
  try {
    marketWorker = await startWorker({ vars: marketVars });
    const expected = await marketContract(marketNode.base, admin), actual = await marketContract(marketWorker.base, admin);
    assert.deepEqual(actual, expected, 'quest market rollback must agree across both hosts');
    console.log('PASS runtime quest market parity: ' + expected.length + ' contracts; rollback, retained offer, retry and duplicate protection');
    const { vaultAccessContract } = require('./vault-access-contract.cjs');
    const vaultExpected = await vaultAccessContract(marketNode.base), vaultActual = await vaultAccessContract(marketWorker.base);
    assert.deepEqual(vaultActual, vaultExpected, 'vault accounting must agree across both hosts');
    console.log('PASS runtime vault access parity: ' + vaultExpected.length + ' contracts; exact allowance, quota limits, revocation and private notes');
    const { cooperativeContract } = require('./cooperative-contract.cjs');
    const coopExpected = await cooperativeContract(marketNode.base, admin), coopActual = await cooperativeContract(marketWorker.base, admin);
    assert.deepEqual(coopActual, coopExpected, 'cooperative bet settlement must agree across both hosts');
    console.log('PASS runtime cooperative parity: ' + coopExpected.length + ' contracts; VIP wage overflow, retained stake and slot, retry and duplicate protection');
  } finally {
    if (marketWorker) await marketWorker.stop();
    await marketNode.stop();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
