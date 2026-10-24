/* Optional real-browser check of watching a friend's spins (js/ui/watchquality.js):
   the 720P / 460P switch and the 24 fps ceiling, and that everything goes back after.
     node tools/check_friend_watch_quality.cjs
   Requires Playwright and a Chromium install (OPS_BROWSER_EXECUTABLE can select a
   browser). Screenshots are only written when OPS_WATCH_SCREENSHOTS names a folder.
   All accounts and data are disposable. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const fs = require('node:fs');
const REPO = path.resolve(__dirname, '..');
const OUT = process.env.OPS_WATCH_SCREENSHOTS || '';
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => (OUT ? page.screenshot({ path: path.join(OUT, name + '.png') }) : null);
(async () => {
  const { startServer } = await import(REPO + '/server/test/helpers.js');
  const s = await startServer({});
  let browser; const errors = [];
  try {
    const a = await s.register('Watcher');
    const b = await s.register('Friend');
    s.setUser(a.me.id, { age_ok: 1, guide_done: 1 });
    await s.befriend(a, b);
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 600 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('blockbuster-reels/auth', t); } catch (e) {} }, a.token);
    const page = await ctx.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(s.base + '/');
    await page.waitForFunction(() => window.BR && BR.bank && BR.bank.ready && BR.bank.ready() && BR.app, null, { timeout: 30000 });
    await page.evaluate(() => BR.screens.show('slot'));
    await page.waitForFunction(() => !document.querySelector('.curtain'), null, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1200));
    const fps = () => page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); (function f(ts) { n++; if (ts - t0 < 2000) requestAnimationFrame(f); else res(n / ((ts - t0) / 1000)); })(t0); }));
    const size = () => page.evaluate(() => { const c = document.getElementById('reel-canvas'); return [c.width, c.height]; });
    const before = { fps: await fps(), size: await size() };
    console.log('not watching: rAF', before.fps.toFixed(1), '/s, reel canvas', before.size.join('x'));
    assert.equal(await page.evaluate(() => BR.watchQuality.active()), false);

    // watching the friend: the real flow (the server puts us in the friend's home)
    // the friend must be online to be watched
    const lb = await s.listen(b);
    await page.evaluate((id) => BR.watch.start({ id, name: 'Friend', online: true, avatar: 'traveler-green' }), b.me.id);
    await page.waitForFunction(() => BR.watchQuality.active(), null, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await page.locator('#watch-quality-btn').isVisible(), true, 'the quality button shows while watching');
    const q720 = { fps: await fps(), size: await size(), label: await page.locator('#watch-quality-btn').textContent() };
    console.log('watching 720P: rAF', q720.fps.toFixed(1), '/s, reel canvas', q720.size.join('x'), q720.label);
    assert.ok(q720.fps <= 27, 'at most about 24 frames a second while watching: ' + q720.fps);
    assert.ok(q720.fps >= 18, 'and not stalled: ' + q720.fps);
    await shot(page, 'friend-720');

    await page.locator('#watch-quality-btn').click();
    await new Promise((r) => setTimeout(r, 900));
    const q460 = { size: await size(), label: await page.locator('#watch-quality-btn').textContent() };
    console.log('watching 460P: reel canvas', q460.size.join('x'), q460.label);
    assert.match(q460.label, /460P/);
    assert.ok(q460.size[0] < q720.size[0] * 0.8, 'a smaller picture at 460P: ' + q460.size + ' vs ' + q720.size);
    await shot(page, 'friend-460');

    // stopping returns the game to its own quality and frame rate
    await page.evaluate(() => BR.app.watchExit());
    await new Promise((r) => setTimeout(r, 900));
    const after = { fps: await fps(), size: await size() };
    console.log('after: rAF', after.fps.toFixed(1), '/s, reel canvas', after.size.join('x'));
    assert.equal(await page.evaluate(() => BR.watchQuality.active()), false);
    assert.deepEqual(after.size, before.size);
    assert.ok(after.fps > q720.fps + 8 || after.fps >= 40, 'back to the full rate: ' + after.fps);
    // cancelAnimationFrame still works through the wrapper
    const cancelled = await page.evaluate(() => new Promise((res) => { let ran = false; const id = requestAnimationFrame(() => { ran = true; }); cancelAnimationFrame(id); setTimeout(() => res(!ran), 200); }));
    assert.equal(cancelled, true);
    lb.close();
    assert.deepEqual(errors, []);
    console.log('QUALITY OK');
  } finally { if (browser) await browser.close(); await s.stop(); }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
