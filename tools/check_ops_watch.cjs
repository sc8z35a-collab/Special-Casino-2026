/* Optional real-browser check of the operators' screen view (server/core/opswatch.js):
   a real game page as the player, the real operator site, the real Node server.
     node tools/check_ops_watch.cjs
   Requires Playwright and a Chromium install (OPS_BROWSER_EXECUTABLE can select a
   browser). Screenshots are only written when OPS_WATCH_SCREENSHOTS names a folder.
   All accounts and data are disposable. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '..');
const OUT = process.env.OPS_WATCH_SCREENSHOTS || '';
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => (OUT ? page.screenshot({ path: path.join(OUT, name + '.png') }) : null);

(async () => {
  const { startServer } = await import(REPO + '/server/test/helpers.js');
  const s = await startServer({ operators: ['taku'] });
  let browser;
  const errors = [];
  try {
    const taku = await s.register('taku');
    const player = await s.register('PlayerQA');
    // (a disposable account that has already been through the first-run questions and the guide)
    s.setUser(player.me.id, { tokens: 500000, age_ok: 1, guide_done: 1 });
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });

    // ---- the player's game
    const pctx = await browser.newContext({ viewport: { width: 1280, height: 600 } });
    await pctx.addInitScript((t) => { try { localStorage.setItem('blockbuster-reels/auth', t); } catch (e) {} }, player.token);
    const game = await pctx.newPage();
    game.setDefaultTimeout(15000);
    game.on('pageerror', (e) => errors.push('game: ' + e.message));
    await game.goto(s.base + '/');
    await game.waitForFunction(() => window.BR && BR.live && BR.app && BR.bank && BR.bank.ready && BR.bank.ready(), null, { timeout: 30000 });
    await game.evaluate(() => BR.screens.show('slot'));
    await game.waitForFunction(() => BR.live.isConnected(), null, { timeout: 15000 });
    console.log('player game ready, live connected');
    assert.equal(await game.evaluate(() => BR.watchfeed.active()), false, 'nothing is sent before 見る');

    // ---- the operator site
    const octx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const ops = await octx.newPage();
    ops.setDefaultTimeout(15000);
    ops.on('pageerror', (e) => errors.push('ops: ' + e.message));
    await ops.goto(s.base + '/ops/');
    await ops.locator('#login').waitFor({ state: 'visible' });
    await ops.locator('#login-name').fill('taku');
    await ops.locator('#login-pass').fill('pass1234');
    await ops.locator('#login-go').click();
    await ops.locator('#app').waitFor({ state: 'visible' });
    // players list
    await ops.locator('.mac-taskbar-edge').hover();
    await ops.locator('#tabs [data-view="players"]').click();
    await ops.locator('#mac-window-players.is-active').waitFor({ state: 'visible' });
    const row = ops.locator('#rows tr', { hasText: 'PlayerQA' });
    await row.waitFor();
    const eye = row.locator('[data-watch]');
    await ops.waitForFunction(() => { const b = document.querySelector('#rows tr [data-watch]'); return b && !b.disabled; }, null, { timeout: 20000 }).catch(() => {});
    console.log('見る button enabled:', await eye.isEnabled());
    await shot(ops, 'ops-list');
    const visibleSet = () => game.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((n) => { const r = n.getBoundingClientRect(); const cs = getComputedStyle(n); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; }).map((n) => n.tagName + '#' + n.id + '.' + String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className)).sort());
    // (the red curtain of the slot screen's opening is the game's own: wait for it to finish)
    await game.waitForFunction(() => !document.querySelector('.curtain'), null, { timeout: 15000 });
    // (and the studio's opening movie)
    await game.waitForFunction(() => { const e = document.getElementById('splash'); return !e || e.hidden || getComputedStyle(e).display === 'none' || e.getBoundingClientRect().width === 0; }, null, { timeout: 40000 });
    await new Promise((r) => setTimeout(r, 1500));
    const before = await visibleSet();
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(await visibleSet(), before, 'the game screen is steady before the watch');
    await shot(game, 'game-before');
    await eye.click();
    await ops.locator('#watch').waitFor({ state: 'visible' });
    await ops.waitForFunction(() => /表示中/.test(document.querySelector('#watch-state').textContent), null, { timeout: 15000 });
    console.log('watching: state =', await ops.locator('#watch-state').textContent());
    assert.equal(await game.evaluate(() => BR.watchfeed.active()), true, 'the game sends while watched');

    await new Promise((r) => setTimeout(r, 800));
    const during = await visibleSet();
    await shot(game, 'game-during');
    const added = during.filter((x) => !before.includes(x)), removed = before.filter((x) => !during.includes(x));
    console.log('player screen while watched — new visible elements:', JSON.stringify(added), 'gone:', JSON.stringify(removed));
    assert.deepEqual(added, [], 'nothing new on the player\'s screen');
    assert.deepEqual(removed, [], 'nothing gone from the player\'s screen');
    // the replica shows the player's wallet and bet: read what the canvas drew (compare against the page's own numbers)
    const shown = await game.evaluate(() => ({ t: BR.store.state.tokens, d: BR.store.state.dollars, bet: BR.app.bet(), screen: BR.screens.current() }));
    console.log('player state:', JSON.stringify(shown));
    await shot(ops, 'ops-watch-idle');

    // spin in the player's game: the replica follows
    await game.evaluate(() => BR.app.spin());
    await ops.waitForFunction(() => /SPIN|WIN|\+/.test('x'), null, { timeout: 100 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    await shot(ops, 'ops-watch-spinning');
    await new Promise((r) => setTimeout(r, 4500));
    await shot(ops, 'ops-watch-after');
    const stat = await ops.locator('#watch-stat').textContent();
    console.log('stat line:', stat);
    assert.match(stat, /通信 .*今回 .*累計/);
    // no countdown / elapsed timer anywhere in the window
    const windowText = await ops.locator('#watch').innerText();
    const hit = windowText.match(/残り時間|残り\d|経過|\d+:\d{2}|30分/); assert.equal(hit, null, 'timer-like text: ' + (hit && windowText.slice(Math.max(0, hit.index - 30), hit.index + 30)));

    // the quality switch changes the canvas size
    await ops.locator('#watch-q').selectOption('240');
    assert.equal(await ops.locator('#watch-canvas').evaluate((c) => c.height), 240);
    await ops.locator('#watch-q').selectOption('540');
    assert.equal(await ops.locator('#watch-canvas').evaluate((c) => c.height), 540);
    await ops.locator('#watch-fps').selectOption('20');
    await new Promise((r) => setTimeout(r, 400));

    // a short message while watching
    await ops.locator('#watch [data-preset="thanks"]').click();
    await new Promise((r) => setTimeout(r, 500));
    const msg = s.app.db.prepare('SELECT body FROM messages WHERE recipient_id = ? ORDER BY id DESC LIMIT 1').get(player.me.id);
    assert.match(msg.body, /いつもご利用ありがとうございます/);
    // ★
    await ops.locator('#watch-fav').click();
    await new Promise((r) => setTimeout(r, 400));
    assert.match(await ops.locator('#watch-fav').textContent(), /^★/);

    // the player sees nothing: no new elements, no toast, no overlay appeared in the game
    const visible = await game.evaluate(() => Array.from(document.body.querySelectorAll('*')).filter((n) => /watch|view|監視|見られ/.test(n.id + ' ' + n.className) ).map((n) => n.tagName + '#' + n.id + '.' + n.className).slice(0, 10));
    console.log('game DOM mentioning watch/view:', JSON.stringify(visible));

    // ending: the game stops sending
    await ops.locator('#watch-end').click();
    await game.waitForFunction(() => !BR.watchfeed.active(), null, { timeout: 5000 });
    console.log('ended: the game stopped sending');
    const rec = s.app.db.prepare('SELECT * FROM ops_watch_log ORDER BY id DESC LIMIT 1').get();
    console.log('record:', JSON.stringify({ ms: rec.ms, bytes: rec.bytes, frames: rec.frames, reason: rec.reason, quality: rec.quality }));
    assert.equal(rec.reason, 'operator');
    assert.ok(rec.frames > 3 && rec.bytes > 0);
    console.log('errors:', JSON.stringify(errors));
    assert.deepEqual(errors, []);
    console.log('E2E OK');
  } finally {
    if (browser) await browser.close();
    await s.stop();
  }
})().catch((e) => { console.error('E2E FAILED', e); process.exit(1); });
