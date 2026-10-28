// Failure injection against real UI code and disposable local accounts only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const { startServer } = await import(path.resolve(__dirname, '../server/test/helpers.js'));
  const s = await startServer({ operators: ['taku'] }); let browser;
  try {
    await s.register('taku'); const player = await s.register('AuditUI');
    s.setUser(player.me.id, { tokens: 100000, dollars: 1000000000, garage_extra: 100, guide_done: 1, age_ok: 1 });
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const game = await ctx.newPage(), errors = [];
    for (const page of [game]) { page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message)); }
    await game.addInitScript(t => { Element.prototype.requestFullscreen = () => Promise.resolve(); localStorage.setItem('blockbuster-reels/auth', t); }, player.token);
    await game.goto(s.base); await game.waitForFunction(() => window.BR?.bank?.ready());
    await game.evaluate(() => BR.screens.show('slot'));
    let spins = 0;
    await game.route('**/api/spin', async route => {
      if (++spins !== 1) return route.continue();
      await route.fetch(); await route.fulfill({ status: 200, contentType: 'application/json', body: '{"truncated":' });
    });
    const bet = await game.evaluate(() => BR.app.bet());
    await game.locator('#btn-spin').click();
    await game.waitForFunction(() => BR.api.pendingSpinBet() !== null && !BR.game.spinning);
    assert.equal(await game.locator('#bet-plus').isDisabled(), true);
    assert.equal(await game.evaluate(() => BR.app.setBet(BR.CONFIG.bets.find(x => x !== BR.app.bet()))), false);
    assert.equal(await game.evaluate(() => BR.app.bet()), bet);
    await game.locator('#btn-spin').click(); await game.waitForFunction(() => BR.api.pendingSpinBet() === null && !BR.game.spinning);
    assert.equal(s.app.db.prepare('SELECT spins FROM users WHERE id = ?').get(player.me.id).spins, 1);
    await game.evaluate(() => { if (BR.game.presenting) BR.app.fx.skip(); });
    await game.evaluate(() => BR.gacha.open()); await game.locator('.gc-pull-button').first().waitFor();
    let gachas = 0;
    await game.route('**/api/gacha/spin', async route => {
      if (++gachas !== 1) return route.continue();
      await route.fetch(); await route.fulfill({ status: 200, contentType: 'application/json', body: '{"truncated":' });
    });
    const money = () => s.app.db.prepare('SELECT dollars FROM users WHERE id = ?').get(player.me.id).dollars;
    const before = money();
    async function pull() { await game.locator('.gc-pull-button[data-count="1"]').click(); await game.locator('#confirm-yes').click(); }
    await pull(); await game.waitForFunction(() => BR.api.pendingGacha() && document.getElementById('gacha-reveal').hidden);
    assert.equal(await game.locator('.gc-tier[data-kind="secret"]').isDisabled(), true);
    await pull(); await game.waitForFunction(() => document.querySelectorAll('.gc-reward').length === 3);
    assert.equal(money(), before - 10000000); assert.equal(await game.evaluate(() => BR.api.pendingGacha()), null);
    console.log('PASS lost spin/gacha responses preserve BET, quote, one settlement and every reward');

    const ops = await ctx.newPage(); ops.setDefaultTimeout(30000); ops.on('pageerror', e => errors.push(e.message));
    async function login() { await ops.locator('#login-name').fill('taku'); await ops.locator('#login-pass').fill('pass1234'); await ops.locator('#login-go').click(); await ops.locator('#app').waitFor({ state: 'visible' }); }
    await ops.goto(s.base + '/ops/'); await login(); await ops.waitForFunction(() => !!OpsExt.io().request);
    await ops.route('**/api/audit-json', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"bad":' }));
    assert.equal(await ops.evaluate(() => OpsExt.io().request('GET', '/api/audit-json').then(() => 'success', e => e.status)), 0);
    let delayed;
    await ops.route('**/api/audit-stale', route => { delayed = route; });
    await ops.evaluate(() => { window.auditStale = OpsExt.io().request('GET', '/api/audit-stale').catch(e => e.status); });
    await ops.waitForTimeout(100); assert.ok(delayed);
    await ops.evaluate(() => document.getElementById('logout').click()); await login();
    const newToken = await ops.evaluate(() => localStorage.getItem('two-state-ops/token'));
    await delayed.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"code":"auth"}}' });
    assert.equal(await ops.evaluate(() => window.auditStale), 401);
    assert.equal(await ops.evaluate(() => localStorage.getItem('two-state-ops/token')), newToken);
    assert.equal(await ops.locator('#app').isVisible(), true);
    console.log('PASS invalid operator JSON fails and a delayed old-session 401 preserves the new login');

    const sec = await ctx.newPage(); sec.setDefaultTimeout(30000); sec.on('pageerror', e => errors.push(e.message));
    await sec.route('**/api/ops/login', route => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
    await sec.goto(s.base + '/sec/'); await sec.locator('#login-name').fill('taku'); await sec.locator('#login-pass').fill('pass1234'); await sec.locator('#login-go').click();
    await sec.waitForFunction(() => document.getElementById('login-error').textContent.includes('通信できませんでした'));
    assert.equal(await sec.locator('#login-go').isDisabled(), false);
    assert.deepEqual(errors, []);
    console.log('PASS invalid security HOME JSON remains a recoverable network failure');
  } finally { if (browser) await browser.close(); await s.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
