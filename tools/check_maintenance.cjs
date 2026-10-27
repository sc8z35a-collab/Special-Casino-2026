/* Current maintenance contracts in a disposable server and a real browser. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const { startServer, PASSWORD } = await import(path.resolve(__dirname, '../server/test/helpers.js'));
  const s = await startServer(); let browser;
  try {
    const player = await s.register('MaintUI');
    s.setUser(player.me.id, { guide_done: 1, age_ok: 1, tokens: 10000 });
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(60000);
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.addInitScript(token => { Element.prototype.requestFullscreen = () => Promise.resolve(); if (!localStorage.getItem('blockbuster-reels/auth')) localStorage.setItem('blockbuster-reels/auth', token); }, player.token);
    await page.goto(s.base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.BR && BR.social && BR.social.me());
    await page.evaluate(() => BR.effects.open());
    await page.locator('label:has(#fx-lite)').click();
    assert.equal(await page.evaluate(() => BR.fx.lite()), true);
    assert.ok(await page.locator('#reel-canvas').evaluate(c => c.width <= Math.round(1006 * 0.8)));
    await page.evaluate(() => { BR.kit.closeModal('fx-settings'); BR.screens.show('slot'); });
    await page.evaluate(() => {
      var spin = BR.bank.spin;
      BR.bank.spin = function () { return spin.apply(this, arguments).then(function (r) { window.maintenanceSpin = JSON.parse(JSON.stringify(r)); return r; }); };
    });
    await page.locator('#btn-spin').click();
    await page.waitForFunction(() => !!window.maintenanceSpin).catch(async e => {
      console.error('spin state', await page.evaluate(() => ({ screen: BR.screens.current(), busy: BR.game.busy(), tokens: BR.store.state.tokens, guide: BR.guide.active(), button: document.getElementById('btn-spin').disabled, toast: document.getElementById('toast').textContent })), errors); throw e;
    });
    const result = await page.evaluate(() => window.maintenanceSpin);
    assert.equal(s.app.db.prepare('SELECT spins FROM users WHERE id=?').get(player.me.id).spins, 1, 'exactly one server settlement over HTTP or socketapi');
    assert.ok(result.result && result.balance, JSON.stringify(result));
    await page.waitForFunction(() => !BR.game.spinning);
    assert.deepEqual(await page.evaluate(() => BR.app.reels.getGrid()), await page.evaluate(r => BR.engine.whole(r).grid, result.result));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.BR && BR.social && BR.social.me());
    assert.equal(await page.evaluate(() => BR.fx.lite()), true, 'light mode survives reload');
    await page.evaluate(() => BR.account.openPassword());
    await page.locator('#ov-pw-current').fill(PASSWORD);
    await page.locator('#ov-pw-new').fill('changed-browser-123');
    await page.locator('#ov-password button[type="submit"]').click();
    await page.locator('#ov-codecard').waitFor({ state: 'visible' });
    const code = await page.locator('#ov-code-value').textContent();
    const token = await page.evaluate(() => localStorage.getItem('blockbuster-reels/auth'));
    assert.notEqual(token, player.token); assert.notEqual(code, player.recoveryCode);
    assert.equal((await s.call('GET', '/api/me', { token: player.token })).status, 401);
    assert.equal((await s.call('GET', '/api/me', { token })).status, 200);
    await page.locator('#ov-done').click();
    await page.waitForFunction(() => BR.live.isConnected());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(id => window.BR && BR.social && BR.social.me() && BR.social.me().id === id, player.me.id);
    assert.deepEqual(errors, []);
    console.log('PASS maintenance browser: light rendering/persistence, rotated login/code, live reconnect and reload');
  } finally { if (browser) await browser.close(); await s.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
