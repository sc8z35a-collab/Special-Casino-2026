// Real entry points: no eager optional assets, then existing UI still opens.
const assert = require('node:assert/strict'), path = require('node:path');
const { chromium } = require('playwright');
const launch = () => chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
const clean = u => new URL(u).pathname.replace(/^\/immutable\/[a-f0-9]{10}/, '');
async function hold(page, pattern) {
  let entered; const arrived = new Promise(resolve => { entered = resolve; });
  await page.route(pattern, route => entered(route));
  return async () => {
    let timer;
    try { return await Promise.race([arrived, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('request did not arrive: ' + pattern)), 30000); })]); }
    finally { clearTimeout(timer); }
  };
}
(async () => {
  const { startServer, PASSWORD } = await import(path.resolve(__dirname, '../server/test/helpers.js'));
  const s = await startServer({ operators: ['taku'] }); let browser;
  try {
    const player = await s.register('LazyPlayer'); s.setUser(player.me.id, { guide_done: 1, age_ok: 1 });
    browser = await launch(); let page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const errors = [], requests = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(clean(r.url())));
    await page.addInitScript(token => { localStorage.setItem('blockbuster-reels/auth', token); Element.prototype.requestFullscreen = () => Promise.resolve(); }, player.token);
    const online = await hold(page, '**/css/online.css*');
    await page.goto(s.base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.BR && BR.social && BR.social.me() && BR.launch.done());
    for (const file of ['/js/ui/cars.js', '/js/ui/carsale.js', '/js/render/garage3d.js', '/js/ui/guide.js', '/js/ui/support.js', '/js/ui/watch.js', '/js/ui/profile-custom.js', '/css/gacha.css', '/css/tree.css']) assert.ok(!requests.includes(file), file + ' is deferred');
    assert.ok(!requests.some(u => /^\/sounds\/(?:click|reels|coins|win|money|register|spin-button)/.test(u)), 'recordings wait for audio unlock');
    await page.evaluate(() => { window.auditConfirmation = BR.kit.confirmBox(p => { p.textContent = '取り消せる確認'; }); });
    const onlineRequest = await online(); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.auditConfirmation), false);
    await onlineRequest.continue(); await page.evaluate(() => BR.resources.load('online'));
    assert.equal(await page.locator('#confirm').isVisible(), false, 'canceled loading cannot restore a confirmation');
    await page.unroute('**/css/online.css*');

    const gacha = await hold(page, '**/css/gacha.css*');
    await page.evaluate(() => { window.auditOptional = BR.gacha.open(); }); const gachaRequest = await gacha();
    await page.evaluate(() => BR.screens.show('rules')); await page.locator('#screen-rules.active').waitFor();
    await gachaRequest.continue(); await page.evaluate(() => window.auditOptional);
    assert.equal(await page.locator('#gacha-modal').isVisible(), false, 'a late optional module cannot replace the chosen screen');
    await page.evaluate(() => BR.gacha.open()); await page.locator('#gacha-modal').waitFor({ state: 'visible' });
    await page.locator('#gacha-modal > .gacha-shop > [data-close]').click();

    const cars = await hold(page, '**/js/ui/carsale.js*');
    await page.evaluate(() => { window.auditController = BR.cars.showShop(); }); const carsRequest = await cars();
    await page.evaluate(() => BR.screens.show('rules')); await carsRequest.continue(); await page.evaluate(() => window.auditController);
    assert.equal(await page.evaluate(() => BR.screens.current()), 'rules', 'a late resource controller cannot reopen its screen');
    await page.evaluate(() => BR.social.open('cars'));
    await page.waitForFunction(() => !!BR.garage3d && !!BR.carsaleDialog && BR.cars.showShop.name === 'showShop');
    await page.locator('#car-name').waitFor({ state: 'visible' });
    await page.evaluate(() => BR.social.openProfile(BR.social.me()));
    await page.locator('#profile').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !!BR.PROFILE_IMG);
    await page.evaluate(() => { BR.kit.closeModal('profile'); BR.guide.start(true); });
    await page.waitForFunction(() => BR.guide.active());
    assert.ok(requests.includes('/js/ui/guide.js')); assert.deepEqual(errors, []);
    assert.equal(requests.filter(p => p === '/js/ui/carsale.js').length, 1, 'canceled controller loads stay cached');
    await browser.close(); browser = null;
    console.log('PASS game lazy entry points, deferred confirmation cancellation, latest navigation and cached retries; recordings stay deferred');
    await s.register('taku');
    browser = await launch(); page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const opsErrors = [], opsRequests = []; page.on('pageerror', e => opsErrors.push(e.message)); page.on('request', r => opsRequests.push(clean(r.url())));
    await page.addInitScript(() => { localStorage.setItem('two-state-ops/ui/glass', 'off'); localStorage.setItem('two-state-ops/ui/tabs', 'yes'); localStorage.setItem('two-state-ops/ui/autohide', 'no'); });
    await page.goto(s.base + '/ops/'); await page.locator('#login-name').fill('taku'); await page.locator('#login-pass').fill(PASSWORD); await page.locator('#login-form button[type="submit"]').click();
    await page.waitForFunction(() => !document.getElementById('app').hidden);
    for (const file of ['cdw.js', 'cdw.css', 'calendar.js', 'watch.js', 'glass.js', 'glass.css', 'phone.css', 'vault-thumbnails.js', 'vault3d.js', 'diary-profile.js']) assert.ok(!opsRequests.includes('/ops/' + file), file + ' is deferred');
    await page.locator('[data-desk="site"]').click({ force: true });
    await page.waitForFunction(() => OpsCDW.on());
    await page.locator('.cdw-palette').waitFor({ state: 'visible' });
    await page.locator('.cdw-pick').first().click(); await page.locator('.cdw-widget').first().waitFor({ state: 'visible' });
    await page.locator('.cdw-done').click(); assert.equal(await page.evaluate(() => OpsCDW.on()), false);
    await page.evaluate(() => OpsDesktop.open('calendar')); await page.waitForFunction(() => !!document.querySelector('#view-calendar .cal-grid'));
    await page.evaluate(() => OpsDesktop.open('profile')); await page.waitForFunction(() => !!window.OpsDiaryProfile && document.getElementById('view-profile').textContent.trim().length > 0);
    assert.ok(opsRequests.includes('/ops/calendar.js')); assert.ok(opsRequests.includes('/ops/diary-profile.js'));
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForFunction(() => !!document.querySelector('link[media*="max-width: 700px"]'));
    assert.deepEqual(opsErrors, []);
    console.log('PASS operator lazy entry points: CDW icon/empty layout/add/done, calendar, profile, saved glass-off and responsive phone CSS');
  } finally { if (browser) await browser.close(); await s.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
