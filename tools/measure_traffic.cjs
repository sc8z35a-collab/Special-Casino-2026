/* What the game and the operator site ask the server for, per minute, in the same scenes every time (so a change can be measured against the
   code before it):
     node tools/measure_traffic.cjs [--host node|cf] [--repo DIR] [--only game|ops] [--seconds N] [--out FILE.json]
   --host: the Node server (server/node, live connection by Server-Sent Events) or Cloudflare's own runtime on this machine (`wrangler dev
           --local`: the Worker, the Durable Object and its SQLite, and the WebSocket production has);
   --repo: the checkout whose server and pages are measured (default: this one; a `git worktree` of an older commit gives "before").
   Requires Playwright and a Chromium install (OPS_BROWSER_EXECUTABLE can select a browser). Disposable data.
   For each scene: the API requests (count, the bytes sent and the bytes of the answers as the page reads them) and the live connection's
   messages each way (count, bytes), per minute; a start-up or a tour is counted whole. Headers are left out (HTTP/2 sends a repeated header
   once a connection). On Cloudflare a message to the server over the WebSocket is billed as 1/20 of a request: "billed" adds them so. */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const HOST = arg('host', 'node');
const REPO = path.resolve(arg('repo', path.resolve(__dirname, '..')));
const ONLY = arg('only', '');
const SECONDS = Number(arg('seconds', 60));
const OUT = arg('out', '');
const BIG = [1e6, 1e4];
const LIMITS = { general: BIG, login: BIG, spin: BIG, shop: BIG, friend: BIG, transfer: BIG, typing: BIG, dm: BIG, read: BIG, vaultWork: BIG, vaultPull: BIG, vaultOpen: BIG };
const PASSWORD = 'pass1234';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- the two hosts, one face */
// { base, call(method, url, { token, body }), register(name), befriend(a, b), listen(player) → { close }, rich(player), stop() }
async function nodeHost(opts) {
  const { startServer } = await import(path.join(REPO, 'server/test/helpers.js'));
  const s = await startServer({ operators: ['taku', 'mod'], limits: LIMITS, ...opts });
  return { ...s, rich: (p) => s.setUser(p.me.id, { tokens: 1e7 }) };
}
const freePort = () => new Promise((resolve) => { const srv = net.createServer(); srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); }); });
async function cfHost() {
  const port = await freePort();
  const state = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'measure-wr-'));
  const vars = { REGISTRATIONS_PER_IP: 0, REGISTER_PER_MINUTE: 100000, OPERATORS: 'taku,mod', ACCOUNTS_PER_DEVICE: 0, START_TOKENS: 10000000 };
  const args = ['wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', state, ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])];
  const child = spawn('npx', args, { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  let log = '';
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    if (i > 120) throw new Error('wrangler dev did not start:\n' + log.slice(-2000));
    await sleep(500);
    try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not yet */ }
  }
  async function call(method, url, { token, body, headers = {} } = {}) {
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (url === '/api/register' && !('X-Device' in h)) h['X-Device'] = crypto.randomBytes(16).toString('hex');
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ...(await res.json().catch(() => ({}))), status: res.status };
  }
  async function register(name) {
    const r = await call('POST', '/api/register', { body: { name, password: PASSWORD, avatar: 'traveler-green' } });
    if (r.status !== 200) throw new Error('register ' + name + ': ' + JSON.stringify(r));
    return r;
  }
  async function befriend(a, b) {
    await call('POST', '/api/friends/request', { token: a.token, body: { user: b.me.id } });
    await call('POST', '/api/friends/respond', { token: b.token, body: { user: a.me.id, accept: true } });
  }
  async function listen(player) {
    const { ticket } = await call('POST', '/api/stream-ticket', { token: player.token });
    const ws = new WebSocket(base.replace('http', 'ws') + '/api/live?ticket=' + encodeURIComponent(ticket));
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    return { close: () => { try { ws.close(); } catch { /* closed */ } } };
  }
  async function stop() {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
    await sleep(1500);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
    fs.rmSync(state, { recursive: true, force: true });
  }
  return { base, call, register, befriend, listen, rich: () => {}, stop };
}
const host = (opts) => (HOST === 'cf' ? cfHost() : nodeHost(opts));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const results = [];
  const errors = [];

  // a page whose API requests and live messages are counted while `rec.on`
  async function recorder(ctx, page, base) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    const rec = { on: false, http: [], up: [], down: [], byId: new Map() };
    cdp.on('Network.requestWillBeSent', (e) => {
      const url = e.request.url.replace(base, '');
      // (the live connection itself is counted by its messages)
      if (!rec.on || !url.startsWith('/api/') || url.startsWith('/api/stream?') || url.startsWith('/api/live?')) return;
      const r = { key: e.request.method + ' ' + url.split('?')[0], sent: e.request.postData ? Buffer.byteLength(e.request.postData) : 0, got: 0 };
      rec.byId.set(e.requestId, r); rec.http.push(r);
    });
    cdp.on('Network.dataReceived', (e) => { const r = rec.byId.get(e.requestId); if (r) r.got += e.dataLength; });
    const kind = (text) => { try { const m = JSON.parse(text); return m.event || m.op || (m.re !== undefined ? 'reply' : '?'); } catch { return text.slice(0, 8); } };
    cdp.on('Network.eventSourceMessageReceived', (e) => { if (rec.on) rec.down.push({ name: e.eventName, bytes: Buffer.byteLength(e.data || '') }); });
    cdp.on('Network.webSocketFrameReceived', (e) => { if (rec.on) rec.down.push({ name: kind(e.response.payloadData || ''), bytes: Buffer.byteLength(e.response.payloadData || '') }); });
    cdp.on('Network.webSocketFrameSent', (e) => { if (rec.on) rec.up.push({ name: kind(e.response.payloadData || ''), bytes: Buffer.byteLength(e.response.payloadData || '') }); });
    page.on('pageerror', (e) => errors.push(e.message));
    return rec;
  }
  function report(scene, rec, seconds, whole = false) {
    const per = whole ? 1 : 60 / seconds;
    const group = (list, key, size) => { const g = {}; for (const r of list) { const k = g[r[key]] || (g[r[key]] = { n: 0, bytes: 0 }); k.n++; k.bytes += size(r); } return g; };
    const keys = group(rec.http, 'key', (r) => r.sent + r.got), up = group(rec.up, 'name', (r) => r.bytes), down = group(rec.down, 'name', (r) => r.bytes);
    const total = (list, size) => list.reduce((n, r) => n + size(r), 0);
    const kb = (total(rec.http, (r) => r.sent + r.got) + total(rec.up, (r) => r.bytes) + total(rec.down, (r) => r.bytes)) / 1024;
    const row = {
      scene, unit: whole ? 'total' : 'per minute', requests: +(rec.http.length * per).toFixed(1), sent: +(rec.up.length * per).toFixed(1),
      billed: +((rec.http.length + rec.up.length / 20) * per).toFixed(2), kb: +(kb * per).toFixed(2), received: +(rec.down.length * per).toFixed(1), keys, up, down
    };
    results.push(row);
    console.log(`\n${scene} (${row.unit}): ${row.requests} requests, ${row.sent} messages sent on the live connection, ${row.received} received; ${row.kb} KB; billed ${row.billed}`);
    const line = (label, k, v) => console.log(`   ${label}${k.padEnd(36)} x${(v.n * per).toFixed(1).padStart(6)}  ${(v.bytes * per / 1024).toFixed(2).padStart(7)} KB`);
    for (const [k, v] of Object.entries(keys).sort((a, b) => b[1].n - a[1].n)) line('', k, v);
    for (const [k, v] of Object.entries(up).sort((a, b) => b[1].n - a[1].n)) line('live ↑ ', k, v);
    for (const [k, v] of Object.entries(down).sort((a, b) => b[1].n - a[1].n)) line('live ↓ ', k, v);
    return row;
  }

  /* ---------------------------------------------------------------- the game */
  if (!ONLY || ONLY === 'game') {
    const s = await host({ loginBonus: true, quests: true, milestones: true, npcGifts: false });
    try {
      const ready = async (u) => { await s.call('POST', '/api/guide', { token: u.token, body: {} }); await s.call('POST', '/api/age', { token: u.token, body: { adult: true } }); };
      async function player(name, friends = 3) {
        const me = await s.register(name);
        await ready(me);
        const list = [];
        for (let i = 0; i < friends; i++) { const f = await s.register(name + 'f' + i); await ready(f); await s.befriend(me, f); list.push(f); }
        return { me, friends: list };
      }
      async function open(me, on) {
        const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
        const page = await ctx.newPage();
        page.setDefaultTimeout(15000);
        await page.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.resolve(); });
        await page.addInitScript((t) => { try { localStorage.setItem('blockbuster-reels/auth', t); } catch (e) { /* none */ } }, me.token);
        const rec = await recorder(ctx, page, s.base);
        rec.on = !!on;
        await page.goto(s.base + '/');
        for (let i = 0; i < 100 && !(await page.evaluate(() => window.BR && BR.screens && BR.screens.current() === 'start').catch(() => false)); i++) await page.waitForTimeout(150);
        // (the live connection up)
        for (let i = 0; i < 60 && !(await page.evaluate(() => BR.live && BR.live.isConnected()).catch(() => false)); i++) await page.waitForTimeout(100);
        return { ctx, page, rec };
      }
      const screen = (page) => page.evaluate(() => BR.screens.current());

      // start-up: from the address to the title screen, and five seconds on it
      {
        const { me, friends } = await player('start');
        const live = await Promise.all(friends.map((f) => s.listen(f)));
        const { ctx, page, rec } = await open(me, true);
        await page.waitForTimeout(5000);
        report('game: start-up', rec, 0, true);
        live.forEach((l) => l.close()); await ctx.close();
      }
      // on the title screen, three friends online; one of them goes and comes back, one writes
      {
        const { me, friends } = await player('idle');
        const live = await Promise.all(friends.map((f) => s.listen(f)));
        const { ctx, page, rec } = await open(me, false);
        await page.waitForTimeout(4000);
        rec.on = true;
        const t0 = Date.now();
        live[2].close();
        await sleep(SECONDS * 400);
        live[2] = await s.listen(friends[2]);
        await s.call('POST', '/api/messages', { token: friends[0].token, body: { to: me.me.id, text: 'やあ、元気？' } });
        await sleep(Math.max(0, SECONDS * 1000 - (Date.now() - t0)));
        rec.on = false;
        report('game: idle on the title (friends online)', rec, (Date.now() - t0) / 1000);
        live.forEach((l) => l.close()); await ctx.close();
      }
      // the slot: a spin every 4 seconds (as a player who keeps pressing it does)
      {
        const { me, friends } = await player('spinner');
        const live = await Promise.all(friends.map((f) => s.listen(f)));
        s.rich(me);
        const { ctx, page, rec } = await open(me, false);
        await page.evaluate(() => BR.screens.show('slot'));
        await page.waitForTimeout(4000);
        rec.on = true;
        const t0 = Date.now();
        let spins = 0;
        while (Date.now() - t0 < SECONDS * 1000) {
          const at = Date.now();
          if (await page.evaluate(() => { const b = document.querySelector('#btn-spin'); if (!b || b.disabled) return false; b.click(); return true; })) spins++;
          await page.waitForTimeout(Math.max(0, 4000 - (Date.now() - at)));
        }
        await page.waitForTimeout(1500);
        rec.on = false;
        const row = report(`game: the slot, a spin every 4 s (${spins} spins, on '${await screen(page)}')`, rec, (Date.now() - t0) / 1000);
        row.spins = spins;
        live.forEach((l) => l.close()); await ctx.close();
      }
      // a conversation open: the friend writes every 15 seconds, the player answers twice
      {
        const { me, friends } = await player('talker', 2);
        const live = await Promise.all(friends.map((f) => s.listen(f)));
        const { ctx, page, rec } = await open(me, false);
        await page.evaluate(() => BR.screens.show('board'));
        await page.waitForTimeout(2500);
        const opened = await page.evaluate((f) => { BR.social.openDm({ id: f.id, name: f.name, avatar: 'traveler-green', online: true }); return true; }, { id: friends[0].me.id, name: friends[0].me.name }).catch(() => false);
        await page.waitForTimeout(2500);
        rec.on = true;
        const t0 = Date.now();
        for (let i = 0; Date.now() - t0 < SECONDS * 1000; i++) {
          await s.call('POST', '/api/messages', { token: friends[0].token, body: { to: me.me.id, text: 'メッセージ ' + i } });
          await sleep(15000);
        }
        rec.on = false;
        report(`game: a conversation open (${opened ? 'opened' : 'list'}, on '${await screen(page)}')`, rec, (Date.now() - t0) / 1000);
        live.forEach((l) => l.close()); await ctx.close();
      }
      // a tour of the menus: each screen once, five seconds each
      {
        const { me, friends } = await player('tourist', 2);
        const live = await Promise.all(friends.map((f) => s.listen(f)));
        const { ctx, page, rec } = await open(me, false);
        await page.waitForTimeout(3000);
        rec.on = true;
        const shown = [];
        for (const sc of ['board', 'garage', 'shop', 'tree', 'quests', 'jobs', 'vip', 'diary', 'start', 'slot', 'board', 'start']) {
          const ok = await page.evaluate((x) => { try { BR.screens.show(x); return BR.screens.current() === x; } catch (e) { return false; } }, sc);
          if (ok) shown.push(sc);
          await page.waitForTimeout(5000);
        }
        rec.on = false;
        report(`game: a tour of the screens (${shown.join(' ')})`, rec, 0, true);
        live.forEach((l) => l.close()); await ctx.close();
      }
    } finally { await s.stop(); }
  }

  /* ---------------------------------------------------------------- the operator site */
  if (!ONLY || ONLY === 'ops') {
    const s = await host({});
    try {
      await s.register('taku');
      const mod = await s.register('mod');
      const ps = [];
      for (let i = 0; i < 40; i++) ps.push(await s.register('player' + String(i).padStart(2, '0')));
      for (let i = 0; i < 6; i++) await s.call('POST', '/api/report', { token: ps[i].token, body: { user: ps[i + 10].me.id, kind: 'abuse', text: '暴言を言われました ' + i, place: 'search' } });
      for (let i = 0; i < 4; i++) await s.call('POST', '/api/feedback', { token: ps[i].token, body: { ratings: { fun: 4 }, comment: 'とても楽しいです ' + i } });
      for (let i = 0; i < 3; i++) await s.call('POST', '/api/ops/team/messages', { token: mod.token, body: { to: 0, text: 'こんにちは ' + i } });
      // a living game behind it: a few players spin while the site is watched
      const busy = ps.slice(20, 24);
      busy.forEach((p) => s.rich(p));
      let playing = true;
      const play = (async () => { while (playing) { for (const p of busy) await s.call('POST', '/api/spin', { token: p.token, body: { bet: 10 } }).catch(() => {}); await sleep(3000); } })();

      async function site() {
        const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
        await ctx.addInitScript(() => { try { localStorage.setItem('two-state-ops/ui/autohide', 'no'); } catch (e) { /* none */ } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(15000);
        const rec = await recorder(ctx, page, s.base);
        await page.goto(s.base + '/ops/');
        await page.locator('#login-name').fill('mod');
        await page.locator('#login-pass').fill(PASSWORD);
        await page.locator('#login-go').click();
        await page.locator('#app').waitFor({ state: 'visible' });
        await page.waitForTimeout(2000);
        return { ctx, page, rec };
      }
      for (const view of ['players', 'server', 'team', 'security', 'reports', 'log', 'vault']) {
        const { ctx, page, rec } = await site();
        await page.locator(`.tab[data-view="${view}"]`).click({ force: true });
        await page.waitForTimeout(3000);
        rec.on = true;
        const t0 = Date.now();
        await sleep(SECONDS * 1000);
        rec.on = false;
        report(`ops: the ${view} tab open`, rec, (Date.now() - t0) / 1000);
        await ctx.close();
      }
      // the desktop windows (CDW): every window an operator may have
      {
        const layout = [
          { id: 'server', x: 0, y: 0, w: 20, h: 13 }, { id: 'reports', x: 20, y: 0, w: 16, h: 12 }, { id: 'detections', x: 36, y: 0, w: 16, h: 12 }, { id: 'feedback', x: 52, y: 0, w: 16, h: 12 },
          { id: 'log', x: 0, y: 14, w: 22, h: 11 }, { id: 'security', x: 22, y: 14, w: 16, h: 12 }, { id: 'team', x: 38, y: 14, w: 18, h: 15 }, { id: 'vault', x: 56, y: 14, w: 14, h: 13 },
          { id: 'profile', x: 0, y: 26, w: 14, h: 9 }
        ];
        await s.call('POST', '/api/ops/cdw', { token: mod.token, body: { layout: { v: 1, items: layout } } });
        const { ctx, page, rec } = await site();
        await page.evaluate(() => OpsCDW.toggle());
        await page.waitForSelector('.cdw-widget');
        await page.waitForTimeout(3000);
        rec.on = true;
        const t0 = Date.now();
        await sleep(SECONDS * 1000);
        rec.on = false;
        report(`ops: the desktop windows (CDW, ${await page.locator('.cdw-widget').count()} windows)`, rec, (Date.now() - t0) / 1000);
        await ctx.close();
      }
      playing = false; await play;
    } finally { await s.stop(); }
  }

  await browser.close();
  const sum = (pre) => results.filter((r) => r.scene.startsWith(pre) && r.unit === 'per minute').reduce((a, r) => ({ requests: a.requests + r.requests, sent: a.sent + r.sent, billed: a.billed + r.billed, kb: a.kb + r.kb }), { requests: 0, sent: 0, billed: 0, kb: 0 });
  console.log(`\nper-minute scenes summed (${HOST}):`);
  for (const pre of ['game', 'ops']) { const t = sum(pre); console.log(`  ${pre}: ${t.requests.toFixed(1)} requests/min + ${t.sent.toFixed(1)} live messages/min (billed ${t.billed.toFixed(2)}), ${t.kb.toFixed(1)} KB/min`); }
  if (errors.length) console.log('\npage errors:', [...new Set(errors)].slice(0, 10));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ host: HOST, repo: REPO, seconds: SECONDS, results }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
