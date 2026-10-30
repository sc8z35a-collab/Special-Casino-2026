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
async function checkMarketDialogs(page, s, player, first, second) {
  await s.befriend(player, first); await s.befriend(player, second);
  const at = Date.now();
  for (let i=0; i<2; i++) s.app.db.prepare('INSERT INTO cars(owner_id,model,paid,created_at,acquired_at) VALUES(?,?,?,?,?)')
    .run(player.me.id, 'two-state-sedan', 26500000, at, at);
  await page.evaluate(async () => {
    BR.kit.closeModals(); BR.live.close(); await BR.resources.load('online'); await BR.resources.load('carsaleDialog');
    window.auditMarket = {};
    for (const method of ['cars', 'carOffer', 'present']) {
      const original = BR.api[method]; window.auditMarket[method] = original;
      BR.api[method] = function (...args) { window.auditMarket[method + 'Done'] = false; return original(...args).then(r => { window.auditMarket[method + 'Done'] = true; return r; }); };
    }
  });
  let enterCars, heldCars; const carsEntered = new Promise(resolve => { enterCars = resolve; });
  await page.route('**/api/cars', route => { heldCars = route; enterCars(); });
  await page.evaluate(u => BR.carsaleDialog.open(u), first.me); await carsEntered;
  const carsReply = await heldCars.fetch(); await page.evaluate(() => BR.kit.closeModals()); await heldCars.fulfill({ response: carsReply });
  await page.waitForFunction(() => window.auditMarket.carsDone); assert.equal(await page.locator('#carsale').isVisible(), false);
  await page.unroute('**/api/cars');

  await page.evaluate(u => BR.carsaleDialog.open(u), first.me); await page.locator('#cs-go').waitFor({ state: 'visible' });
  let enterOffer, heldOffer; const offerEntered = new Promise(resolve => { enterOffer = resolve; });
  await page.route('**/api/cars/offer', route => { heldOffer = route; enterOffer(); });
  await page.locator('#cs-go').click(); await offerEntered;
  const offerReply = await heldOffer.fetch(); assert.equal(offerReply.status(), 200);
  await page.locator('#carsale [data-close]').click(); await page.evaluate(u => BR.carsaleDialog.open(u), second.me);
  await page.locator('#cs-go').waitFor({ state: 'visible' }); assert.equal(await page.locator('#cs-name').textContent(), second.me.name);
  await heldOffer.fulfill({ response: offerReply }); await page.waitForFunction(() => window.auditMarket.carOfferDone);
  assert.equal(await page.locator('#carsale').isVisible(), true); assert.equal(await page.locator('#cs-name').textContent(), second.me.name);
  await page.unroute('**/api/cars/offer');
  await page.locator('#cs-go').click(); await page.waitForFunction(() => document.getElementById('carsale').hidden);
  assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE sender_id=? AND kind='car_offer'").get(player.me.id).n, 2);

  let enterPresent, heldPresent; const presentEntered = new Promise(resolve => { enterPresent = resolve; });
  await page.route('**/api/present', route => { heldPresent = route; enterPresent(); });
  await page.evaluate(u => BR.presents.open(u), first.me); await page.locator('#pr-grid .pr-tile').first().click(); await page.locator('#pr-go').click(); await presentEntered;
  const presentReply = await heldPresent.fetch(); assert.equal(presentReply.status(), 200);
  await page.locator('#present [data-close]').click(); await page.evaluate(u => BR.presents.open(u), second.me);
  await heldPresent.fulfill({ response: presentReply }); await page.waitForFunction(() => window.auditMarket.presentDone);
  assert.equal(await page.locator('#present').isVisible(), true); assert.equal(await page.locator('#pr-name').textContent(), second.me.name);
  await page.unroute('**/api/present'); await page.locator('#pr-grid .pr-tile').first().click(); await page.locator('#pr-go').click();
  await page.waitForFunction(() => document.getElementById('present').hidden);
  assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE sender_id=? AND kind='present'").get(player.me.id).n, 2);
  await page.evaluate(() => { for (const method of ['cars', 'carOffer', 'present']) BR.api[method] = window.auditMarket[method]; delete window.auditMarket; BR.live.connect(); });
  console.log('PASS real sale and present dialogs retire canceled loads and delayed settlements, preserve replacement recipients and still submit current actions once');
}
async function checkDiaryComments(page, s, developer, player, other) {
  const published = await s.call('POST', '/api/ops/diary', { token: developer.token,
    body: { title: 'Audit private comments', text: 'Diary delivery race coverage', reward: 0 } });
  assert.equal(published.status, 200);
  await page.evaluate(async () => {
    BR.kit.closeModals(); BR.live.close(); await BR.resources.load('diary'); await BR.lazy.load('diary');
    const original = BR.api.diaryComments; window.auditDiary = { original, next: 0, completed: [] };
    BR.api.diaryComments = function (...args) { const id = ++window.auditDiary.next; return original(...args).then(r => { window.auditDiary.completed.push(id); return r; }); };
  });
  let heldRead, heldSend, enterRead, enterSend, reads = 0, sends = 0;
  const readEntered = new Promise(resolve => { enterRead = resolve; }), sendEntered = new Promise(resolve => { enterSend = resolve; });
  const routePattern = '**/api/diary/comments*';
  await page.route(routePattern, route => {
    if (route.request().method() === 'GET' && ++reads === 1) { heldRead = route; enterRead(); }
    else if (route.request().method() === 'POST' && ++sends === 1) { heldSend = route; enterSend(); }
    else return route.continue();
  });
  await page.evaluate(() => BR.diary.open());
  const card = page.locator('#diary-list details').filter({ hasText: 'Audit private comments' });
  await card.locator('summary').click(); await readEntered;
  const oldReply = await heldRead.fetch(); assert.deepEqual((await oldReply.json()).comments, []);
  const input = card.locator('textarea'), submit = card.locator('button[type="submit"]');
  await input.fill('first saved comment'); await submit.click(); await sendEntered;
  const sentReply = await heldSend.fetch(); assert.equal(sentReply.status(), 200);
  await input.fill('new unsent draft'); await heldSend.fulfill({ response: sentReply });
  await card.locator('.diary-own-comment').filter({ hasText: 'first saved comment' }).waitFor();
  assert.equal(await input.inputValue(), 'new unsent draft');
  await heldRead.fulfill({ response: oldReply }); await page.waitForFunction(() => window.auditDiary.completed.includes(1));
  assert.equal(await card.locator('.diary-own-comment').count(), 1);
  assert.ok((await card.locator('.diary-own-comments').textContent()).includes('first saved comment'));
  await submit.click(); await page.waitForFunction(() => document.querySelector('#diary-list textarea').value === '');
  await page.waitForFunction(() => document.querySelectorAll('#diary-list .diary-own-comment').length === 2);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM diary_comments WHERE post_id=? AND user_id=?').get(published.id, player.me.id).n, 2);
  const privateReply = await s.call('GET', '/api/diary/comments?post=' + published.id, { token: other.token });
  assert.equal(privateReply.status, 200); assert.deepEqual(privateReply.comments, []);
  const developerReply = await s.call('GET', '/api/ops/diary/comments?post=' + published.id, { token: developer.token });
  assert.equal(developerReply.status, 200); assert.equal(developerReply.comments.length, 2);
  await page.unroute(routePattern);
  await page.evaluate(() => { BR.api.diaryComments = window.auditDiary.original; delete window.auditDiary; BR.kit.closeModals(); BR.live.connect(); });
  console.log('PASS real diary comments preserve new drafts, reject older reads and keep replies private');
}
async function checkTreeQueue(page, s, player) {
  const at=Date.now(),second=Number(s.app.db.prepare('INSERT INTO trees(user_id,name,created_at) VALUES(?,?,?)').run(player.me.id,'Audit second tree',at).lastInsertRowid);
  const first=s.app.db.prepare('SELECT id,given FROM trees WHERE user_id=? ORDER BY id LIMIT 1').get(player.me.id);
  const dollars=s.app.db.prepare('SELECT dollars FROM users WHERE id=?').get(player.me.id).dollars;
  await page.evaluate(async () => {
    BR.kit.closeModals(); BR.live.close(); await BR.resources.load('tree');
    const original=BR.api.treeGive; window.auditTree={original,completed:0};
    BR.api.treeGive=function(...args){return original(...args).then(r=>{window.auditTree.completed++;return r;});};
    BR.tree.open();
  });
  await page.locator('#tree-tabs button[data-tab="'+second+'"]').waitFor();
  await page.locator('#tree-tabs button[data-tab="'+first.id+'"]').click();
  const [amount,changed]=await page.evaluate(()=>BR.TREE.rules.amounts.slice(0,2));
  await page.locator('#tr-amounts button[data-amount="'+amount+'"]').click();
  let held,entered;const ready=new Promise(resolve=>{entered=resolve;});let calls=0;
  await page.route('**/api/tree/give',route=>{if(++calls!==1)return route.continue();held=route;entered();});
  await page.locator('#tr-give').click();await ready;const firstReply=await held.fetch();assert.equal(firstReply.status(),200);
  await page.locator('#tree-tabs button[data-tab="'+second+'"]').click();await page.locator('#tr-give').click();
  await page.locator('#tr-amounts button[data-amount="'+changed+'"]').click();
  await held.fulfill({response:firstReply});await page.waitForFunction(()=>window.auditTree.completed===2);
  const given=id=>s.app.db.prepare('SELECT given FROM trees WHERE id=?').get(id).given;
  assert.equal(given(first.id),first.given+amount);assert.equal(given(second),amount);
  await page.locator('#tr-give').click();await page.waitForFunction(()=>window.auditTree.completed===3);
  assert.equal(given(second),amount+changed);assert.equal(s.app.db.prepare('SELECT dollars FROM users WHERE id=?').get(player.me.id).dollars,dollars-2*amount-changed);
  await page.unroute('**/api/tree/give');
  await page.evaluate(()=>{BR.api.treeGive=window.auditTree.original;delete window.auditTree;BR.screens.show('slot');BR.live.connect();});
  console.log('PASS real tree gift queue preserves each tapped tree and amount across selection changes and charges exactly once per tap');
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
    await checkMarketDialogs(accountPage, s, player, nextPlayer, developer);
    await checkDiaryComments(accountPage, s, developer, player, nextPlayer);
    await checkTreeQueue(accountPage, s, player);
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
