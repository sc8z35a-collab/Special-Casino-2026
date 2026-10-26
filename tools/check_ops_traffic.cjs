/* Optional real-browser check of what the operator site asks the server for (ops/ops.js, ops/beat.js, ops/cdw.js, ops/ops-sw.js, sec/sec.js)
   against the real Node server:
     node tools/check_ops_traffic.cjs
   Requires Playwright and a Chromium install (OPS_BROWSER_EXECUTABLE can select a browser). Disposable data. It checks that
     - the poll is one request (POST /api/ops/batch carrying GET /api/ops/tick); a changed player, a new one, an archived one, a search, and the
       tabs' numbers (reports, DEV UNIT, the team's, the payments', the archive) all follow, and no page error comes of the list being drawn
       again only where it changed,
     - the team's tab is told over the live connection (a message reaches the other operator in a moment) and does not ask on a timer,
     - the reports list is not drawn again while it is the same (what is open on a card stays open),
     - the security base in its frame asks for nothing while its window is put away, and at once when it is brought back,
     - the desktop's windows (CDW) are asked for with the rest in one request at the site's pace, each drawn, and a window drawn again (the
       browser's window resized) asks nothing more,
     - a visit to the operator site after the second asks the server for none of its ~23 scripts and styles. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '..');
const BIG = [1e6, 1e4];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { startServer } = await import(REPO + '/server/test/helpers.js');
  const browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [];
  const server = (operators = ['taku', 'mod']) => startServer({ operators, limits: { general: BIG, login: BIG } });
  // an operator's page, logged in, with its requests to /api/ noted
  async function open(s, name, { context = null } = {}) {
    const ctx = context || await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    await ctx.addInitScript(() => { try { localStorage.setItem('two-state-ops/ui/autohide', 'no'); } catch (e) { /* none */ } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    const calls = [];
    // (a batch is noted with what it carried: ops/batch[ops/tick?…|ops/reports?…])
    page.on('request', (r) => {
      const u = r.url().replace(s.base, '');
      if (!u.startsWith('/api/')) return;
      let asks = '';
      if (u === '/api/ops/batch') { try { asks = '[' + JSON.parse(r.postData()).asks.map((a) => a.p.replace('/api/', '') + (a.rev !== undefined ? '#rev' : '')).join('|') + ']'; } catch (e) { /* none */ } }
      calls.push(u.replace('/api/', '') + asks);
    });
    await page.goto(s.base + '/ops/');
    await page.locator('#login-name').fill(name);
    await page.locator('#login-pass').fill('pass1234');
    await page.locator('#login-go').click();
    await page.locator('#app').waitFor({ state: 'visible' });
    await page.waitForTimeout(1500);
    return { page, calls, tab: (v) => page.locator(`.tab[data-view="${v}"]`).click({ force: true }) };
  }

  // ---- the poll
  {
    const s = await server();
    try {
      await s.register('taku');
      const mod = await s.register('mod');
      const ps = [];
      for (let i = 0; i < 30; i++) ps.push(await s.register('player' + String(i).padStart(2, '0')));
      const { page, calls, tab } = await open(s, 'taku');
      await tab('players');
      await page.waitForTimeout(1200);
      const rows = () => page.locator('#rows > tr').count();
      const poll = async () => { await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(900); };
      const count = (id) => page.evaluate((x) => { const b = document.getElementById('count-' + x); return b && !b.hidden ? b.textContent : ''; }, id);
      const rowText = (n) => page.evaluate((x) => { const tr = [...document.querySelectorAll('#rows > tr')].find((r) => r.textContent.includes(x)); return tr ? tr.textContent : null; }, 'player' + n);
      assert.equal(await rows(), 32, 'everyone is drawn (taku, mod and 30 players)');
      s.app.db.prepare('UPDATE users SET coins = 777777 WHERE id = ?').run(ps[3].me.id);
      calls.length = 0;
      await poll();
      assert.match(await rowText('03'), /777,?777/, 'a changed row follows');
      assert.deepEqual(calls.filter((c) => c.startsWith('ops/')).map((c) => c.split('[')[0]), ['ops/batch'], 'one request for the whole poll: ' + calls.join(' '));
      assert.match(calls.find((c) => c.startsWith('ops/batch')), /\[ops\/tick\?/, 'carrying the tick');
      await s.register('latecomer');
      s.app.db.prepare("UPDATE users SET archived_at = 1, archive_reason = 'perma' WHERE id = ?").run(ps[5].me.id);
      await poll();
      assert.equal(await rows(), 32);
      assert.equal(await rowText('05'), null, 'an archived player is gone');
      assert.equal(await count('archive'), '1', 'the archive tab\'s number');
      await s.call('POST', '/api/report', { token: ps[0].token, body: { user: ps[1].me.id, kind: 'abuse', text: '暴言を言われました', place: 'search' } });
      await s.call('POST', '/api/ops/devunit/comments', { token: mod.token, body: { text: 'テスト' } });
      await s.call('POST', '/api/ops/team/messages', { token: mod.token, body: { to: 0, text: 'こんにちは' } });
      const now = Date.now();
      s.app.db.prepare("INSERT INTO pay_orders (id, user_id, plan, qty, amount, coins, method, status, created_at, updated_at, paid_at, session_id) VALUES ('o1', ?, 'support3', 1, 30, 34, 'card', 'paid', ?, ?, ?, 'cs_1')").run(ps[2].me.id, now, now, now);
      await poll();
      assert.deepEqual([await count('reports'), await count('devunit'), await count('team'), await count('pay')], ['1', '1', '1', '1'], 'the tabs\' numbers');
      await page.locator('#search').fill('player1');
      await page.waitForTimeout(800);
      await poll();
      await poll();
      assert.equal(await rows(), 10, 'a search stays narrowed across polls');
      await page.locator('#search').fill('');
      await page.waitForTimeout(800);
      assert.equal(await rows(), 32);
      await tab('pay');
      await page.waitForTimeout(1200);
      assert.match(await page.locator('#pay-sum').textContent(), /返信待ち/, 'the payments tab is drawn');
      await tab('team');
      await page.waitForTimeout(1500);
      assert.equal(await count('team'), '', 'the team\'s number is read in its tab');
      calls.length = 0;
      await poll();
      const ticks = calls.filter((c) => c.startsWith('ops/batch'));
      assert.ok(ticks.length && ticks.every((c) => /ops\/tick\?[^|\]]*[?&]t=-/.test(c)), 'in the team\'s tab the poll leaves the team out: ' + ticks.join(' '));
      console.log('ok  the poll');
    } finally { await s.stop(); }
  }

  // ---- the team's tab is told, and does not ask on a timer
  {
    const s = await server();
    try {
      await s.register('taku');
      await s.register('mod');
      const a = await open(s, 'taku');
      const b = await open(s, 'mod');
      for (const x of [a, b]) { await x.tab('team'); await x.page.waitForTimeout(1500); }
      a.calls.length = 0;
      await b.page.locator('#team-text').fill('こんにちは、リアルタイムです');
      await b.page.locator('#team-text').press('Control+Enter');
      const t0 = Date.now();
      let seen = false;
      while (!seen && Date.now() - t0 < 3000) {
        await sleep(100);
        seen = (await a.page.locator('#team-msgs').textContent()).includes('リアルタイムです');
      }
      assert.ok(seen, 'the message reaches the other operator within 3 seconds');
      await sleep(500);
      a.calls.length = 0;
      await sleep(12000);
      assert.deepEqual(a.calls.filter((c) => /ops\/team/.test(c)), [], 'no timer asking in 12 seconds: ' + a.calls.join(' '));
      console.log('ok  the team\'s tab is told over the live connection');
    } finally { await s.stop(); }
  }

  // ---- a list that did not change is not drawn again
  {
    const s = await server();
    try {
      const taku = await s.register('taku');
      await s.register('mod');
      const alice = await s.register('alice');
      const bob = await s.register('bob');
      assert.equal((await s.call('POST', '/api/ops/speed', { token: taku.token, body: { speed: 'max' } })).speed, 'max');
      const { page, calls, tab } = await open(s, 'taku');
      await tab('reports');
      await page.waitForTimeout(1200);
      await s.call('POST', '/api/report', { token: alice.token, body: { user: bob.me.id, kind: 'abuse', text: '暴言を言われました', place: 'search' } });
      let n = 0;
      for (let i = 0; i < 40 && !n; i++) { await page.waitForTimeout(250); n = await page.locator('#report-list article.card').count(); }
      assert.equal(n, 1, 'a new report appears by itself');
      await page.evaluate(() => { document.querySelector('#report-list article.card').dataset.mark = 'kept'; });
      calls.length = 0;
      await page.waitForTimeout(8000);
      assert.equal(await page.locator('#report-list article.card[data-mark="kept"]').count(), 1, 'not drawn again while the list is the same');
      const asked = calls.filter((c) => /ops\/reports/.test(c));
      assert.ok(asked.length >= 2 && asked.every((c) => /ops\/reports[^|\]]*#rev/.test(c)), 'asked with the rev it was given: ' + asked.join(' | '));
      console.log('ok  the lists answer "the same"');
    } finally { await s.stop(); }
  }

  // ---- the desktop's windows
  {
    const s = await server();
    try {
      await s.register('taku');
      const mod = await s.register('mod');
      const layout = [
        { id: 'server', x: 0, y: 0, w: 20, h: 13 }, { id: 'reports', x: 20, y: 0, w: 16, h: 12 }, { id: 'detections', x: 36, y: 0, w: 16, h: 12 }, { id: 'feedback', x: 52, y: 0, w: 16, h: 12 },
        { id: 'log', x: 0, y: 14, w: 22, h: 11 }, { id: 'security', x: 22, y: 14, w: 16, h: 12 }, { id: 'team', x: 38, y: 14, w: 18, h: 15 }, { id: 'vault', x: 56, y: 14, w: 14, h: 13 },
        { id: 'profile', x: 0, y: 26, w: 14, h: 9 }
      ];
      assert.equal((await s.call('POST', '/api/ops/cdw', { token: mod.token, body: { layout: { v: 1, items: layout } } })).status, 200);
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
      const { page, calls } = await open(s, 'mod', { context: ctx });
      calls.length = 0;
      await page.evaluate(() => OpsCDW.toggle());
      await page.waitForSelector('.cdw-widget');
      await page.waitForTimeout(2000);
      const first = calls.filter((c) => c.startsWith('ops/'));
      assert.equal(first.filter((c) => c.startsWith('ops/batch')).length, 1, 'the windows are asked for in one request: ' + first.join(' '));
      const drawn = await page.evaluate(() => [...document.querySelectorAll('.cdw-widget')].filter((w) => w.querySelector('.cdw-body').textContent.trim()).length);
      assert.equal(drawn, 9, 'every window drawn');
      assert.equal(await page.locator('.cdw-widget[data-id="log"] .cdw-lines li').count() <= 6, true);
      calls.length = 0;
      await page.waitForTimeout(12000);
      const steady = calls.filter((c) => c.startsWith('ops/'));
      assert.ok(steady.every((c) => c.startsWith('ops/batch')) && steady.length <= 4, 'at the live pace, one request at a time (12 s): ' + steady.join(' '));
      // the browser's window resized step by step: drawn again from what each window has, nothing asked for that
      calls.length = 0;
      for (let w = 1900; w >= 1700; w -= 20) await page.setViewportSize({ width: w, height: 1080 });
      await page.waitForTimeout(600);
      assert.ok(calls.filter((c) => c.startsWith('ops/')).length <= 1, 'a resize asks nothing more: ' + calls.join(' '));
      assert.equal(await page.locator('.cdw-widget').count() >= 6, true);
      console.log('ok  the desktop\'s windows are asked for in one request at the site\'s pace');
    } finally { await s.stop(); }
  }

  // ---- the security base in its frame
  {
    const s = await server();
    try {
      const taku = await s.register('taku');
      await s.register('mod');
      await s.call('POST', '/api/ops/speed', { token: taku.token, body: { speed: 'high' } });
      const { page, tab } = await open(s, 'taku');
      const sec = [];
      page.on('request', (r) => { const u = r.url().replace(s.base, ''); if (u.startsWith('/api/sec/')) sec.push(u); });
      await tab('securityhome');
      await page.waitForTimeout(3000);
      const frame = page.frameLocator('#securityhome-frame');
      await frame.locator('#login-name').fill('taku');
      await frame.locator('#login-pass').fill('pass1234');
      await frame.locator('#login-go').click();
      await frame.locator('#app').waitFor({ state: 'visible' });
      await page.waitForTimeout(1500);
      sec.length = 0;
      await page.waitForTimeout(12000);
      assert.ok(sec.length >= 4, `in sight it asks (${sec.length} requests in 12 s)`);
      await tab('players');
      await page.waitForTimeout(1500);
      sec.length = 0;
      await page.waitForTimeout(12000);
      assert.equal(sec.length, 0, 'put away it asks for nothing: ' + sec.join(' | '));
      await tab('securityhome');
      await page.waitForTimeout(1500);
      assert.ok(sec.length >= 1, 'brought back it asks at once');
      console.log('ok  the security base asks for nothing while its window is put away');
    } finally { await s.stop(); }
  }

  // ---- the second and third visit
  {
    const s = await server(['taku']);
    try {
      await s.register('taku');
      const hits = [];
      s.app.server.on('request', (req) => hits.push(req.url));
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const code = (u) => /\.(js|css)(\?|$)/.test(u) && !u.startsWith('/api/') && !/ops-sw\.js|vault-upload\.js$/.test(u.split('?')[0]) || /\?v=/.test(u);
      const counts = [];
      for (let visit = 1; visit <= 3; visit++) {
        hits.length = 0;
        await page.goto(s.base + '/ops/', { waitUntil: 'load' });
        await page.waitForTimeout(1500);
        await page.evaluate(() => navigator.serviceWorker.ready.then(() => 1));
        await page.waitForTimeout(500);
        counts.push(hits.filter(code).length);
      }
      assert.ok(counts[0] >= 23, 'the first visit asks for all of them: ' + counts);
      assert.equal(counts[2], 0, 'the third visit asks the server for none: ' + counts);
      console.log('ok  repeat visits ask for no script or style (' + counts.join(' → ') + ')');
    } finally { await s.stop(); }
  }

  await browser.close();
  assert.deepEqual(errors, [], 'no page error: ' + errors.join(' | '));
  console.log('OPS TRAFFIC OK');
})().catch((e) => { console.error(e); process.exit(1); });
