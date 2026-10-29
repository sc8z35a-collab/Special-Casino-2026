// Failure injection against real UI code and disposable local accounts only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
async function holdBriefTimers(page) {
  await page.addInitScript(() => {
    const schedule = window.setTimeout, cancel = window.clearTimeout, held = new Map();
    window.setTimeout = function (fn, delay, ...args) {
      if (delay !== 50 || typeof fn !== 'function') return schedule(fn, delay, ...args);
      const id = schedule(() => {}, 60000); held.set(id, () => fn(...args)); return id;
    };
    window.clearTimeout = function (id) { held.delete(id); return cancel(id); };
    window.auditReleaseTimers = () => {
      window.setTimeout = schedule; window.clearTimeout = cancel;
      const jobs = Array.from(held); held.clear();
      jobs.forEach(([id, fn]) => { cancel(id); fn(); });
      return { count: jobs.length, active: document.activeElement.id };
    };
  });
}
(async () => {
  const { startServer } = await import(path.resolve(__dirname, '../server/test/helpers.js'));
  const s = await startServer({ operators: ['taku', 'AuditMod'] }); let browser;
  try {
    const developer = await s.register('taku'); await s.register('AuditMod'); const player = await s.register('AuditUI');
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

    const friend = await s.register('AuditHost'); await s.befriend(player, friend);
    const hostLive = await s.listen(friend);
    try {
      await game.evaluate(() => { BR.kit.closeModals(); BR.screens.show('slot'); });
      const canvas = () => game.evaluate(() => { const c = document.getElementById('reel-canvas'); return [c.width, c.height]; });
      const ownCanvas = await canvas();
      await game.evaluate(id => BR.watch.start({ id, name: 'AuditHost', online: true, avatar: 'traveler-green' }), friend.me.id);
      await game.waitForFunction(() => BR.watch.active() && BR.watchQuality.active());
      assert.equal((await s.call('POST', '/api/watch/voice', { token: friend.token, body: { user: player.me.id, on: true } })).status, 200);
      await game.waitForFunction(() => BR.call.active());
      await game.evaluate(id => { BR.call.syncHub(999, [{ id, name: 'AuditHost' }]); BR.call.syncHub(0, []); }, friend.me.id);
      assert.equal(await game.evaluate(() => BR.call.room()), friend.me.id, 'a valid home still resumes after a hub call');
      assert.equal((await s.call('POST', '/api/friends/remove', { token: friend.token, body: { user: player.me.id } })).status, 200);
      await game.waitForFunction(() => !BR.watch.active() && !BR.watchQuality.active() && !BR.call.active());
      await game.waitForFunction(() => !document.getElementById('btn-spin').disabled);
      // watchQuality.exit queues layout on rAF, after the state/button changes above.
      await game.waitForFunction(([width, height]) => {
        const c = document.getElementById('reel-canvas'); return c.width === width && c.height === height;
      }, ownCanvas);
      assert.deepEqual(await canvas(), ownCanvas);
      assert.equal(await game.locator('#watch-bar').isVisible(), false);
      assert.equal(await game.evaluate(() => BR.call.room()), 0);
      // A later hub call must not restore cached voice consent from the ended watch.
      await game.evaluate(id => {
        BR.call.syncHub(999, [{ id, name: 'AuditHost' }]);
        BR.call.syncHub(0, []);
      }, friend.me.id);
      assert.equal(await game.evaluate(() => BR.call.active()), false, 'ending a hub call cannot revive the removed home');
      console.log('PASS unfriending ends the real watch and voice room, restores own reels and enables spinning');
    } finally { hostLive.close(); }

    const nextPlayer = await s.register('SwitchUI');
    s.setUser(nextPlayer.me.id, { guide_done: 1, age_ok: 1 });
    nextPlayer.me = (await s.call('GET', '/api/me', { token: nextPlayer.token })).me;
    const accountContext = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
    const accountPage = await accountContext.newPage(); accountPage.setDefaultTimeout(30000); accountPage.on('pageerror', e => errors.push(e.message));
    await accountPage.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.resolve(); });
    await accountPage.goto(s.base);
    let heldLogin, enterLogin; const loginEntered = new Promise(resolve => { enterLogin = resolve; }); let loginCount = 0;
    await accountPage.route('**/api/login', route => { if (++loginCount !== 1) return route.continue(); heldLogin = route; enterLogin(); });
    await accountPage.evaluate(() => BR.account.open('login'));
    await accountPage.locator('#ov-login-name').fill(player.me.name); await accountPage.locator('#ov-login-pass').fill('pass1234');
    await accountPage.locator('#ov-login button[type="submit"]').click(); await loginEntered;
    const oldLogin = await heldLogin.fetch(), unusedSession = (await oldLogin.json()).token; assert.ok(unusedSession);
    await accountPage.evaluate(() => { BR.account.close(); BR.account.open('login'); });
    const retired = accountPage.waitForResponse(r => r.url().endsWith('/api/logout') && r.request().headers().authorization === 'Bearer ' + unusedSession);
    await heldLogin.fulfill({ response: oldLogin }); await retired;
    assert.equal(await accountPage.evaluate(() => BR.api.hasToken()), false); assert.equal(await accountPage.locator('#ov-login').isVisible(), true);
    assert.equal((await s.call('GET', '/api/me', { token: unusedSession })).status, 401);
    await accountPage.locator('#ov-login-name').fill(nextPlayer.me.name); await accountPage.locator('#ov-login-pass').fill('pass1234');
    await accountPage.locator('#ov-login button[type="submit"]').click(); await accountPage.waitForFunction(id => BR.bank.ready() && BR.social.me()?.id === id, nextPlayer.me.id);
    await accountPage.evaluate(() => { BR.kit.closeModals(); BR.quests.setXp(1000000, true); BR.account.open('code-login'); });
    await accountPage.locator('#ov-code').fill(player.recoveryCode); await accountPage.locator('#ov-code-login button[type="submit"]').click();
    await accountPage.waitForFunction(id => BR.bank.ready() && BR.social.me()?.id === id, player.me.id);
    assert.equal(await accountPage.evaluate(() => BR.quests.xp()), s.app.db.prepare('SELECT xp FROM users WHERE id=?').get(player.me.id).xp);
    const orderedProfile = await accountPage.evaluate(async () => {
      const before = structuredClone(BR.social.me()), purchased = await BR.api.buy(1);
      BR.social.setMe(purchased.me); BR.app.serverBalance(purchased.me); BR.social.setMe(before); BR.app.serverBalance(before);
      return { expected: purchased.me.rev, profile: BR.social.me().rev, bank: BR.bank.me().rev, bought: BR.bank.me().boughtToday, expectedBought: purchased.me.boughtToday };
    });
    assert.equal(orderedProfile.profile, orderedProfile.expected); assert.equal(orderedProfile.bank, orderedProfile.expected); assert.equal(orderedProfile.bought, orderedProfile.expectedBought);
    await accountPage.evaluate(() => { BR.kit.closeModals(); BR.social.openProfile(BR.social.me()); });
    await accountPage.locator('#profile [data-act="logout"]').waitFor();
    await accountPage.evaluate(() => { BR.push.forget = () => new Promise(resolve => { window.auditFinishLogout = resolve; }); });
    await accountPage.locator('#profile [data-act="logout"]').click(); await accountPage.locator('#confirm-yes').click();
    await accountPage.waitForFunction(() => typeof window.auditFinishLogout === 'function');
    let wrongLogouts = 0; accountPage.on('request', r => { if (r.url().endsWith('/api/logout')) wrongLogouts++; });
    await accountPage.evaluate(p => { BR.social.signIn(p.token, p.me); window.auditFinishLogout(); }, nextPlayer);
    await accountPage.waitForTimeout(200); await accountPage.waitForFunction(id => BR.bank.ready() && BR.social.me()?.id === id, nextPlayer.me.id);
    assert.equal(wrongLogouts, 0); assert.equal((await s.call('GET', '/api/me', { token: nextPlayer.token })).status, 200);
    await accountContext.close();
    console.log('PASS real account forms retire canceled sessions, reset switched-account XP, reject stale profiles and preserve a replacement login during delayed logout');

    const ops = await ctx.newPage(); ops.setDefaultTimeout(30000); ops.on('pageerror', e => errors.push(e.message));
    async function login(releaseTimers, name = 'taku') {
      await ops.locator('#login-name').fill(name); await ops.locator('#login-pass').fill('pass1234');
      if (releaseTimers) {
        const focus = await ops.evaluate(() => window.auditReleaseTimers());
        assert.ok(focus.count > 0); assert.equal(focus.active, 'login-pass', 'late startup cannot steal the operator password field');
      }
      await ops.locator('#login-go').click(); await ops.locator('#app').waitFor({ state: 'visible' });
    }
    await holdBriefTimers(ops); await ops.goto(s.base + '/ops/'); await login(true); await ops.waitForFunction(() => !!OpsExt.io().request);
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
    let oldSuccess;
    await ops.route('**/api/audit-old-data', route => { oldSuccess = route; });
    await ops.evaluate(() => { window.auditOldData = OpsExt.io().request('GET', '/api/audit-old-data').then(() => 'accepted', e => e.code); });
    await ops.waitForTimeout(100); assert.ok(oldSuccess);
    await ops.evaluate(() => document.getElementById('logout').click()); await login();
    await oldSuccess.fulfill({ status: 200, contentType: 'application/json', body: '{"private":"previous login"}' });
    assert.equal(await ops.evaluate(() => window.auditOldData), 'session_changed');
    console.log('PASS invalid operator JSON fails and a delayed old-session 401 preserves the new login');

    await ops.evaluate(() => document.getElementById('logout').click()); await login(false, 'AuditMod');
    await ops.evaluate(() => OpsDesktop.open('players'));
    await ops.locator('#mac-window-players').waitFor({ state: 'visible' });
    await ops.locator(`tr[data-id="${developer.me.id}"]`).click();
    await ops.locator('#detail .code').first().waitFor();
    assert.equal(await ops.locator('#detail [data-act="password"]').count(), 0);
    assert.equal(await ops.locator('#detail [data-act="recovery"]').count(), 0);
    assert.ok((await ops.locator('#detail .code').textContent()).includes('非公開'));
    assert.ok(!(await ops.locator('#detail').textContent()).includes(developer.recoveryCode));
    await ops.locator('#drawer-close').click();
    await ops.locator(`tr[data-id="${player.me.id}"]`).click();
    await ops.locator('#detail [data-act="password"]').waitFor();
    assert.equal(await ops.locator('#detail [data-act="recovery"]').count(), 1);
    assert.ok((await ops.locator('#detail .code').textContent()).includes(player.recoveryCode));
    console.log('PASS operator UI hides other staff credentials/actions and retains ordinary player recovery support');

    const sec = await ctx.newPage(); sec.setDefaultTimeout(30000); sec.on('pageerror', e => errors.push(e.message));
    await sec.route('**/api/ops/login', route => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
    await holdBriefTimers(sec); await sec.goto(s.base + '/sec/'); await sec.locator('#login-name').fill('taku'); await sec.locator('#login-pass').fill('pass1234');
    const secFocus = await sec.evaluate(() => window.auditReleaseTimers());
    assert.ok(secFocus.count > 0); assert.equal(secFocus.active, 'login-pass', 'late startup cannot steal the security password field');
    const invalidLogin = sec.waitForResponse(r => new URL(r.url()).pathname === '/api/ops/login' && r.request().method() === 'POST');
    await sec.locator('#login-go').click();
    assert.equal(await (await invalidLogin).text(), 'null', 'the malformed login response must actually be received');
    await sec.waitForFunction(() => document.getElementById('login-error').textContent.includes('通信できませんでした'));
    assert.equal(await sec.locator('#login-go').isDisabled(), false);
    const bonus = await game.evaluate(async () => {
      const done = BR.launch.done, request = BR.api.loginBonus, me = BR.social.me();
      let reply, calls = 0;
      try {
        BR.kit.closeModals(); BR.launch.done = () => false;
        BR.bonus.show({ day: 1, amount: 100, days: [100, 200, 300, 400] });
        BR.api.loginBonus = () => { calls++; return new Promise(resolve => { reply = resolve; }); };
        BR.bonus.schedule(Date.now() - 1);
        document.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
        BR.social.lockDown(); BR.launch.done = done;
        reply({ me, loginBonus: { day: 2, amount: 200 }, next: Date.now() + 86400000 });
        await new Promise(resolve => setTimeout(resolve, 900));
        return { calls, me: BR.social.me(), hidden: document.getElementById('bonus').hidden, busy: BR.bonus.busy() };
      } finally { BR.launch.done = done; BR.api.loginBonus = request; }
    });
    assert.deepEqual(bonus, { calls: 1, me: null, hidden: true, busy: false });
    console.log('PASS real logout clears queued login bonus and rejects its delayed account response');
    assert.deepEqual(errors, []);
    console.log('PASS deferred login focus preserves active password fields; invalid security HOME JSON remains a recoverable network failure');
  } finally { if (browser) await browser.close(); await s.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
