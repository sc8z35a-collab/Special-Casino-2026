// User-reported mobile UI regressions, using disposable local accounts only.
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { chromium } = require('playwright');
(async () => {
  const { startServer, PASSWORD } = await import(path.resolve(__dirname, '../server/test/helpers.js'));
  const s = await startServer(); let browser;
  try {
    const player = await s.register('MobileRepair'); s.setUser(player.me.id, { guide_done: 1, age_ok: 1, coins: 10000 });
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage(), errors = [], requests = [];
    page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(new URL(r.url()).pathname));
    await page.addInitScript(token => { localStorage.setItem('blockbuster-reels/auth', token); Element.prototype.requestFullscreen = () => Promise.resolve(); }, player.token);
    await page.goto(s.base); await page.waitForFunction(() => window.BR?.bank?.ready() && BR.launch.done());
    await page.evaluate(() => BR.screens.show('slot')); await page.locator('#screen-slot.active').waitFor();
    assert.equal(requests.some(p => p.endsWith('/css/tree.css')), false, 'the tree screen remains lazy');
    const hit = await page.evaluate(() => ['btn-tree', 'btn-gacha'].map(id => {
      const node = document.getElementById(id), r = node.getBoundingClientRect();
      return { id, left: r.left, top: r.top, width: r.width, hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button')?.id };
    }));
    for (const button of hit) assert.equal(button.hit, button.id, JSON.stringify(button));
    await page.locator('#btn-gacha').click(); await page.locator('#gacha-modal').waitFor({ state: 'visible' });
    await page.locator('#gacha-modal > .gacha-shop > [data-close]').click();
    await page.evaluate(() => BR.screens.show('tokens')); await page.locator('#screen-tokens.active').waitFor();
    assert.equal(await page.locator('#screen-tokens .chip-pile').count(), 0);
    await page.evaluate(() => BR.screens.show('slot'));

    await page.evaluate(() => BR.account.openPassword()); await page.locator('#ov-password').waitFor({ state: 'visible' });
    const turned = () => page.evaluate(() => ({ portrait: BR.app.view.portrait, rotation: new DOMMatrix(getComputedStyle(document.getElementById('welcome')).transform).b }));
    assert.deepEqual(await turned(), { portrait: true, rotation: 1 });
    await page.evaluate(() => document.activeElement.blur());
    for (const [width, height, portrait, rotation] of [[851, 393, false, 0], [393, 851, true, 1]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(expected => BR.app.view.portrait === expected, portrait);
      assert.deepEqual(await turned(), { portrait, rotation }, 'forms must follow the current view in both orientations');
    }
    await page.locator('#ov-pw-current').fill(PASSWORD);
    for (const height of [500, 300]) {
      await page.setViewportSize({ width: 393, height });
      assert.deepEqual(await turned(), { portrait: true, rotation: 1 }, 'keyboard resizing must preserve the landscape form even below the viewport width');
    }
    await page.locator('#ov-pw-new').fill('mobile-fixed-123'); await page.locator('#ov-password button[type=submit]').click();
    await page.locator('#ov-codecard').waitFor({ state: 'visible' }); await page.locator('#ov-done').click();
    await page.setViewportSize({ width: 393, height: 851 });
    const old = await s.call('GET', '/api/me', { token: player.token }); assert.equal(old.status, 401);
    await page.waitForFunction(() => BR.social.me() && !BR.account.isOpen());

    // The reward layout must exist before VIP CSS; opening another feature
    // while it is showing cannot move the level-up presentation.
    await page.evaluate(async () => { await BR.resources.load('reward3d'); await BR.reward3d.preload(); });
    await page.evaluate(() => { BR.quests.setXp(0, true); BR.quests.setXp(BR.LEVEL.info(0).need + 1); });
    await page.waitForFunction(() => {
      // Capture the real presentation atomically: it may end between browser calls.
      // Keep its layout probe after the 2.7s animation ends on slow CI GPUs.
      const node = document.querySelector('.reward3d, .jc-banner.level');
      if (!node) return false;
      const probe = node.cloneNode(false);
      probe.id = 'audit-reward-anchor'; document.getElementById('stage').appendChild(probe);
      return true;
    });
    const rewardCenter = () => page.evaluate(() => {
      const node = document.getElementById('audit-reward-anchor'), a = node.getBoundingClientRect(), b = document.getElementById('stage').getBoundingClientRect();
      return { x: a.x + a.width / 2 - (b.x + b.width / 2), y: a.y + a.height / 2 - (b.y + b.height / 2) };
    });
    const center = await rewardCenter(); assert.ok(Math.abs(center.x) < 2 && Math.abs(center.y) < 2, JSON.stringify(center));
    await page.locator('#btn-gacha').click(); await page.locator('#gacha-modal').waitFor({ state: 'visible' });
    const moved = await rewardCenter(); assert.ok(Math.abs(moved.x) < 2 && Math.abs(moved.y) < 2, JSON.stringify(moved));
    await page.evaluate(() => document.getElementById('audit-reward-anchor').remove());
    await page.locator('#gacha-modal > .gacha-shop > [data-close]').click();

    const blurFallback = await page.evaluate(() => {
      const r = BR.app.reels, sp = r.sprites, previous = r.reels.map(reel => [reel.v, reel.phase]);
      const b1 = sp.blur1, b2 = sp.blur2; sp.blur1 = {}; sp.blur2 = {};
      try { r.reels.forEach(reel => { reel.v = 4600; reel.phase = 'run'; }); r.draw(performance.now()); return true; }
      finally { sp.blur1 = b1; sp.blur2 = b2; r.reels.forEach((reel, i) => { [reel.v, reel.phase] = previous[i]; }); }
    });
    assert.equal(blurFallback, true);
    await page.evaluate(() => BR.bonus.show({ day: 1, amount: 45000 })); await page.locator('#bonus').waitFor({ state: 'visible' });
    const board = await page.evaluate(async () => { const img = new Image(); img.src = BR.SOCIAL_IMG.loginBonus; await img.decode(); return { width: img.naturalWidth, height: img.naturalHeight }; });
    assert.ok(board.width >= 1400 && board.height >= 460, JSON.stringify(board)); await page.locator('#bonus-ok').click();

    const tree = s.app.db.prepare('SELECT id FROM trees WHERE user_id=? LIMIT 1').get(player.me.id);
    s.app.db.prepare("UPDATE trees SET given=100000,cycle='30m',cycle_at=?,cycle_end=? WHERE id=?").run(Date.now() - 1800000, Date.now() - 1, tree.id);
    await s.app.api.housekeeping();
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('収穫できます'));
    await page.locator('#toast').click(); await page.locator('#screen-tree.active').waitFor();
    await page.waitForFunction(() => !!document.querySelector('[data-act=harvest]'));

    await page.evaluate(() => BR.vip.open()); await page.locator('#screen-vip.active').waitFor();
    await page.locator('#vp-trial-go').click(); await page.locator('#confirm-yes').click();
    await page.waitForFunction(() => BR.social.me().vip.trialUntil > Date.now());
    const until = s.app.db.prepare('SELECT vip_until FROM users WHERE id=?').get(player.me.id).vip_until;
    await page.locator('#vp-go').click();
    await page.waitForFunction(old => BR.social.me().vip.until > old, until);
    assert.equal(s.app.db.prepare('SELECT vip_until FROM users WHERE id=?').get(player.me.id).vip_until, until + 86400000);
    const version = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../version.json'), 'utf8'));
    await page.route('**/version.json*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...version, build: 'aaaaaaaaaaaa' }) }));
    await page.evaluate(() => BR.install.check());
    await page.waitForFunction(() => !document.getElementById('update-note').hidden);
    assert.deepEqual(errors, []);
    console.log('PASS mobile: home tree/gacha hit targets, password rotation/landscape/keyboard, anchored level reward, sharp login bonus, no coin pile, blur fallback, harvest notice, VIP trial/extension and update detection');
    await context.close();

    const signup = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
    const fresh = await signup.newPage(); await fresh.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.resolve(); });
    await fresh.goto(s.base); await fresh.waitForFunction(() => window.BR?.account && BR.launch.done());
    await fresh.evaluate(() => BR.account.open('register')); await fresh.locator('#ov-register').waitFor({ state: 'visible' });
    assert.equal(await fresh.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('welcome')).transform).b), 1);
    await fresh.locator('#ov-name').fill('MobileNew'); await fresh.locator('#ov-pass').fill(PASSWORD); await fresh.locator('#ov-register button[type=submit]').click();
    await fresh.locator('#ov-avatar').waitFor({ state: 'visible' }); await fresh.locator('#ov-create').click(); await fresh.locator('#ov-codecard').waitFor({ state: 'visible' });
    assert.equal(await fresh.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('welcome')).transform).b), 1);
    await signup.close(); console.log('PASS first registration stays landscape through name, avatar and recovery-code steps');
  } finally { if (browser) await browser.close(); await s.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
