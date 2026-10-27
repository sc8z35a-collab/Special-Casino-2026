/* Optional check of the API over the live WebSocket (server/core/socketapi.js, js/net/wire.js) on the real Worker runtime (workerd), with
   its own local Durable Object, in a real browser:
     node tools/check_live_api.cjs
   It starts `wrangler dev --local` with disposable data and the passkey on (GATE_KEY), and checks that
     - the game's spins go as messages on its connection (no request of their own), are settled (the balance follows) and land on the reels,
     - gacha uses that connection too: NO buys nothing, double YES buys once, and the server's three rewards are shown,
     - the operator site, after today's passkey, asks for what it keeps asking for on its connection too, every message signed (X-Gate) and
       answered — the passkey's checks are the same as for a request,
     - neither page asks the server anything over HTTP once its connection is up (but what is kept for HTTP).
   Requires Playwright and a Chromium install (OPS_BROWSER_EXECUTABLE can select a browser), and the repository's node_modules. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '..');
const KEY = 'check-live-key-0123456789abcdef0123456789';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

(async () => {
  const { passkeyFor } = await import(path.join(REPO, 'server/core/pk.js'));
  const { jstDay } = await import(path.join(REPO, 'server/core/opsentry.js'));
  const port = await freePort(), BASE = `http://127.0.0.1:${port}`;
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'live-api-'));
  const vars = { GATE_KEY: KEY, OPERATORS: 'taku', REGISTRATIONS_PER_IP: 0, ACCOUNTS_PER_DEVICE: 0, START_TOKENS: 1000000, START_DOLLARS: 1000000000 };
  const child = spawn(path.join(REPO, 'node_modules/.bin/wrangler'), ['dev', '--local', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', state, ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])],
    { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  let log = '';
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  let browser;
  const errors = [];
  try {
    for (let i = 0; i < 90 && !/Ready on/.test(log); i++) await sleep(1000);
    assert.match(log, /Ready on/, 'the Worker did not start:\n' + log.slice(-600));
    const call = async (method, url, { token, body, headers = {} } = {}) => {
      const h = { ...headers };
      if (token) h.Authorization = `Bearer ${token}`;
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      return { ...(await res.json().catch(() => ({}))), status: res.status };
    };
    const register = (name) => call('POST', '/api/register', { body: { name, password: 'pass1234', avatar: 'traveler-green' }, headers: { 'X-Device': crypto.randomBytes(16).toString('hex') } });
    await register('taku');
    const player = await register('spinner');
    const peer = await register('chatpeer');
    assert.equal((await call('POST', '/api/friends/request', { token: player.token, body: { user: peer.me.id } })).status, 200);
    assert.equal((await call('POST', '/api/friends/respond', { token: peer.token, body: { user: player.me.id, accept: true } })).status, 200);
    for (const u of ['/api/guide', '/api/age']) await call('POST', u, { token: player.token, body: u === '/api/age' ? { adult: true } : {} });
    // Three free garage places let every possible single-pull result settle.
    assert.equal((await call('POST', '/api/garage/expand', { token: player.token, body: {} })).status, 200);
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });

    // a page whose requests and messages on its connection are noted
    async function open(ctx, url, init) {
      const page = await ctx.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', (e) => errors.push(e.message));
      if (init) await page.addInitScript(init.fn, init.arg);
      const http = [], up = [], down = [];
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable');
      cdp.on('Network.requestWillBeSent', (e) => { const u = e.request.url.replace(BASE, ''); if (u.startsWith('/api/') && !u.startsWith('/api/live?')) http.push(e.request.method + ' ' + u.split('?')[0]); });
      cdp.on('Network.webSocketFrameSent', (e) => { try { up.push(JSON.parse(e.response.payloadData)); } catch { /* ping */ } });
      cdp.on('Network.webSocketFrameReceived', (e) => { try { down.push(JSON.parse(e.response.payloadData)); } catch { /* pong */ } });
      await page.goto(BASE + url);
      return { page, http, up, down };
    }

    // ---- the game
    {
      const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true });
      const { page, http, up, down } = await open(ctx, '/', { fn: (t) => { Element.prototype.requestFullscreen = () => Promise.resolve(); try { localStorage.setItem('blockbuster-reels/auth', t); } catch (e) { /* none */ } }, arg: player.token });
      for (let i = 0; i < 100 && !(await page.evaluate(() => window.BR && BR.live && BR.live.isConnected()).catch(() => false)); i++) await sleep(150);
      await page.evaluate(() => BR.screens.show('slot'));
      await sleep(2500);
      http.length = 0;
      const before = await page.evaluate(() => BR.store.state.tokens);
      const spinsSent = () => up.filter((m) => m.op === 'api' && m.p === '/api/spin');
      // Wait for actual reel state: a fixed delay can sample an unfinished spin on software-rendered or slow browsers.
      for (let i = 0; i < 4; i++) {
        await page.waitForFunction(() => !BR.game.spinning);
        await page.evaluate(() => { if (BR.game.presenting) BR.app.fx.skip(); });
        await page.waitForFunction(() => !BR.game.busy());
        await page.evaluate(() => document.querySelector('#btn-spin').click());
        for (let n = 0; n < 60 && spinsSent().length < i + 1; n++) await sleep(100);
        assert.equal(spinsSent().length, i + 1, 'one request per press');
        await page.waitForFunction(() => !BR.game.spinning, null, { timeout: 30000 });
      }
      const spins = spinsSent();
      assert.equal(spins.length, 4, 'four spins on the connection');
      assert.ok(spins.every((m) => m.h.authorization === 'Bearer ' + player.token), 'each with the login, as a request carries it');
      const replies = down.filter((m) => m.re !== undefined && spins.some((s) => s.id === m.re));
      assert.equal(replies.length, 4);
      assert.ok(replies.every((m) => m.s === 200 && m.b.result && /^[0-6]{15}$/.test(m.b.result.grid) && !m.b.result.line), 'answered as it is sent: the grid as digits, no line');
      assert.deepEqual(http.filter((x) => !/^POST \/api\/(stream-ticket|release)$/.test(x)), [], 'no request of their own');
      const last = replies.find((m) => m.re === spins[spins.length - 1].id).b.result;
      assert.deepEqual(await page.evaluate(() => BR.app.reels.getGrid()), await page.evaluate((r) => BR.engine.whole(r).grid, last), 'the reels stop on the grid sent');
      const after = await page.evaluate(() => BR.store.state.tokens);
      // (what is none is not sent)
      const sum = replies.reduce((n, m) => n - m.b.result.bet + (m.b.result.total || 0) + (m.b.result.charm ? m.b.result.charm.back : 0), 0);
      assert.equal(after, before + sum, 'the balance follows the spins');
      const me = await call('GET', '/api/me', { token: player.token });
      assert.equal(me.me.tokens, after, 'and the server has the same');
      assert.equal(new Set(spins.map(m => m.b.key)).size, 4, 'a fresh idempotency key per logical spin');
      assert.ok(spins.every(m => /^\d{13}-[a-f0-9]{32}$/.test(m.b.key)), 'keys include their expiry origin');
      const retried = await Promise.all(Array.from({ length: 3 }, () => call('POST', '/api/spin', { token: player.token, body: spins.at(-1).b })));
      assert.ok(retried.every(r => r.status === 200));
      for (const r of retried) assert.deepEqual(r.result, last, 'HTTP replays return the original live result');
      const afterReplay = await call('GET', '/api/me', { token: player.token });
      assert.equal(afterReplay.me.tokens, me.me.tokens);
      assert.equal(afterReplay.me.spins, me.me.spins, 'cross-transport retries never bet twice');
      console.log('ok  the game\'s spins go on its connection, settled and landed; HTTP replays settle once');

      await page.evaluate(() => { if (BR.game.presenting) BR.app.fx.skip(); BR.gacha.open(); });
      await page.locator('.gc-pull-button[data-count="1"]').waitFor();
      const purchases = () => up.filter((m) => m.op === 'api' && m.p === '/api/gacha/spin');
      const beforePurchase = purchases().length;
      await page.locator('.gc-pull-button[data-count="1"]').click();
      await page.locator('#confirm').waitFor({ state: 'visible' });
      assert.equal(purchases().length, beforePurchase, 'the final confirmation does not buy');
      await page.locator('#confirm-no').click();
      await page.waitForFunction(() => !document.querySelector('.gc-pull-button').disabled);
      assert.equal(purchases().length, beforePurchase, 'NO does not buy');
      await page.locator('.gc-pull-button[data-count="1"]').click();
      await page.locator('#confirm').waitFor({ state: 'visible' });
      await page.evaluate(() => { document.querySelector('#confirm-yes').click(); document.querySelector('#confirm-yes').click(); });
      await page.waitForFunction(() => document.querySelectorAll('.gc-reward').length === 3);
      assert.equal(purchases().length, beforePurchase + 1, 'double YES buys once');
      const purchase = purchases().at(-1);
      const settled = down.find((m) => m.re === purchase.id);
      assert.equal(settled.s, 200);
      assert.equal(settled.b.pulls.flatMap((p) => p.rewards).length, 3);
      assert.equal(settled.b.me.dollars, me.me.dollars - settled.b.paid);
      assert.deepEqual(http.filter((p) => /\/api\/gacha/.test(p)), [], 'gacha has no request of its own');
      console.log('ok  gacha uses the live connection; final confirmation, cancellation and double YES settle once');
      const text = 'ライブ接続のチャット';
      await page.evaluate(async ({ peer, text }) => { await BR.api.send({ with: peer }, text); }, { peer: peer.me.id, text });
      const chats = up.filter((message) => message.op === 'api' && message.p === '/api/messages');
      assert.equal(chats.length, 1, 'one chat frame');
      for (let i = 0; i < 100 && !down.some((message) => message.re === chats[0].id); i++) await sleep(20);
      assert.equal(down.find((message) => message.re === chats[0].id).s, 200);
      assert.deepEqual(http.filter((path) => /\/api\/messages/.test(path)), [], 'chat has no HTTP request of its own');
      const received = await call('GET', '/api/messages?with=' + player.me.id, { token: peer.token });
      assert.equal(received.messages.filter((message) => message.text === text).length, 1);
      const blocked = await page.evaluate(async ({ peer, token }) => BR.live.call('POST', '/api/messages', { Authorization: 'Bearer ' + token },
        { to: peer, text: 'data:application/octet-stream;base64,' + 'AbCd0123456789'.repeat(20) }), { peer: peer.me.id, token: player.token });
      assert.equal(blocked.status, 400); assert.equal(blocked.body.error.code, 'filtered');
      const refused = await page.evaluate(async ({ peer, token }) => BR.live.call('POST', '/api/messages', { Authorization: 'Bearer ' + token },
        { to: peer, text: 'stopped' }), { peer: peer.me.id, token: player.token });
      assert.equal(refused.status, 403); assert.equal(refused.body.error.code, 'chat_banned');
      console.log('ok  chat uses one live frame, delivers once, rejects attachments and preserves the chat ban');
      await ctx.close();
    }

    // ---- the operator site, with today's passkey
    {
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' });
      const { page, http, up, down } = await open(ctx, '/ops/', { fn: () => { try { localStorage.setItem('two-state-ops/ui/autohide', 'no'); } catch (e) { /* none */ } } });
      await page.locator('#login-name').fill('taku');
      await page.locator('#login-pass').fill('pass1234');
      await page.locator('#login-go').click();
      await page.locator('#pk').waitFor({ state: 'visible' });
      await page.locator('#pk-code').fill(passkeyFor(KEY, jstDay(Date.now()), 0));
      await page.locator('#pk-go').click();
      await page.locator('#app').waitFor({ state: 'visible' });
      await page.locator('.tab[data-view="server"]').click({ force: true });
      await sleep(4000);
      http.length = 0; up.length = 0; down.length = 0;
      await sleep(16000);
      const asked = up.filter((m) => m.op === 'api');
      assert.ok(asked.length >= 3, 'the site asks on its connection: ' + asked.length);
      assert.ok(asked.every((m) => m.p === '/api/ops/batch' && /^[0-9a-f]{32}\.\d{13}\.[\w-]{16,32}\.[\w-]{80,100}$/.test(m.h['x-gate'] || '')), 'every message signed with the passkey');
      assert.equal(new Set(asked.map((m) => m.h['x-gate'].split('.')[2])).size, asked.length, 'each with a number of its own');
      const answers = down.filter((m) => m.re !== undefined);
      assert.ok(answers.length >= asked.length - 1 && answers.every((m) => m.s === 200), 'and answered: ' + JSON.stringify(answers.map((m) => m.s)));
      assert.match(await page.locator('#view-server').textContent(), /サーバー/);
      assert.deepEqual(http, [], 'nothing over HTTP meanwhile');
      assert.ok(asked.every((m) => /^Bearer /.test(m.h.authorization || '')), 'the login rides with each message');
      console.log('ok  the operator site asks on its connection, every message signed with the passkey');
      await ctx.close();
    }
    assert.deepEqual(errors, [], 'no page error: ' + errors.join(' | '));
    console.log('LIVE API ON THE WORKER OK');
  } finally {
    if (browser) await browser.close();
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
    await sleep(1000);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
    fs.rmSync(state, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
