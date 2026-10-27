/* A disposable Node/SSE server and real Chromium. Requires Playwright and a browser;
   OPS_BROWSER_EXECUTABLE selects a browser. No production data or LINE transport is used. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const { startServer } = await import(path.join(ROOT, 'server/test/helpers.js'));
  const s = await startServer();
  let browser;
  try {
    const player = await s.register('GachaOpt');
    s.setUser(player.me.id, { dollars: 10000000000, garage_extra: 200, age_ok: 1, guide_done: 1 });
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], missing = [], requests = [];
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => { if (r.status() === 404) missing.push(new URL(r.url()).pathname); });
    page.on('request', (r) => requests.push(new URL(r.url()).pathname.replace(/^\/immutable\/[a-f0-9]{10}/, '')));
    await page.addInitScript((token) => {
      Element.prototype.requestFullscreen = () => Promise.resolve();
      localStorage.setItem('blockbuster-reels/auth', token);
    }, player.token);
    await page.goto(s.base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.BR && BR.social && BR.social.me());
    const initialGachaImages = requests.filter((p) => p.startsWith('/img/gacha/'));
    assert.deepEqual(initialGachaImages, [], 'hidden gacha artwork is not downloaded at startup');
    const lazy = JSON.parse(fs.readFileSync(path.join(ROOT, 'js/lazy-screens.json'), 'utf8'));
    for (const file of Object.values(lazy).flat()) assert.equal(requests.includes('/' + file), false, file + ' stays unloaded until its screen opens');
    await page.evaluate(() => { BR.social.open('more'); document.querySelector('[data-act="gacha"]').click(); BR.gacha.open(); });
    await page.locator('.gc-tier').first().waitFor();
    assert.equal(requests.filter((p) => p === '/api/gacha').length, 1, 'double open shares one request');
    for (const file of lazy.gacha) assert.equal(requests.filter((p) => p === '/' + file).length, 1, file + ' loads once');

    const controls = await page.evaluate(async () => {
      const root = document.querySelector('#gacha-controls'), button = root.querySelector('.gc-tier');
      let added = 0;
      const observer = new MutationObserver((records) => {
        for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) added++;
      });
      observer.observe(root, { childList: true, subtree: true });
      for (let i = 0; i < 60; i++) root.querySelectorAll('.gc-tier')[i % 3].click();
      await Promise.resolve(); observer.disconnect();
      return { switches: 60, addedElements: added, sameButton: button === root.querySelector('.gc-tier') };
    });
    assert.equal(controls.addedElements, 0); assert.equal(controls.sameButton, true);
    const gachaRequests = () => requests.filter((p) => p.startsWith('/api/gacha')).length;
    const beforeOdds = gachaRequests();
    for (let i = 0; i < 3; i++) {
      await page.locator('#gacha-odds-open').click();
      await page.locator('#gacha-odds-rows tr').first().waitFor();
      assert.deepEqual(await page.locator('.gacha-odds th').allTextContents(), ['アイテム', '確率']);
      await page.locator('[data-close="gacha-odds-modal"]').click();
    }
    assert.equal(gachaRequests(), beforeOdds, 'probability sheets need no request');

    const money = () => s.app.db.prepare('SELECT dollars FROM users WHERE id = ?').get(player.me.id).dollars;
    let expected = money();
    const prices = { rare: [10000000, 27000000, 75000000], legendary: [30000000, 81000000, 225000000], secret: [50000000, 135000000, 375000000] };
    for (const [kind, values] of Object.entries(prices)) {
      await page.locator(`.gc-tier[data-kind="${kind}"]`).click();
      assert.deepEqual((await page.locator('.gc-price').allTextContents()).map((x) => Number(x.replace(/\D/g, ''))), values);
    }
    await page.locator('.gc-pull-button[data-count="3"]').click();
    await page.locator('#confirm').waitFor({ state: 'visible' });
    assert.match(await page.locator('#confirm-text').textContent(), /本当に引きますか？/);
    await page.locator('#confirm-no').click();
    assert.equal(money(), expected);
    assert.equal(requests.filter((p) => p === '/api/gacha/spin').length, 0);
    for (const [kind, count, index] of [['rare', 1, 0], ['legendary', 3, 1], ['secret', 10, 2]]) {
      await page.locator(`.gc-tier[data-kind="${kind}"]`).click();
      await page.locator(`.gc-pull-button[data-count="${count}"]`).click();
      await page.locator('#confirm').waitFor({ state: 'visible' });
      const had = requests.filter((p) => p === '/api/gacha/spin').length;
      await page.evaluate(() => { document.getElementById('confirm-yes').click(); document.getElementById('confirm-yes').click(); });
      await page.waitForFunction((n) => document.querySelectorAll('.gc-reward').length === n, count * 3);
      assert.equal(requests.filter((p) => p === '/api/gacha/spin').length, had + 1);
      expected -= prices[kind][index]; assert.equal(money(), expected);
      await page.locator('#gacha-results').evaluate((n) => { n.scrollTop = n.scrollHeight; });
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.gc-reward-art')).filter((n) => n.getBoundingClientRect().bottom > 0 && n.getBoundingClientRect().top < innerHeight).every((n) => n.complete && n.naturalWidth > 0));
      await page.locator('#gacha-result-close').click();
    }
    await page.setViewportSize({ width: 915, height: 412 });
    await page.locator('.gc-pull-button[data-count="3"]').click();
    await page.locator('#confirm').waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    const style = await page.locator('#confirm').evaluate((n) => ({ blur: getComputedStyle(n).backdropFilter, radius: getComputedStyle(n.querySelector('.confirm-card')).borderRadius }));
    assert.equal(style.blur, 'blur(28px)'); assert.equal(style.radius, '58px');
    for (const id of ['confirm-yes', 'confirm-no']) {
      const box = await page.locator('#' + id).boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 916 && box.y + box.height <= 413);
    }
    if (process.env.GACHA_SCREENSHOT) await page.screenshot({ path: process.env.GACHA_SCREENSHOT });
    await page.locator('#confirm-no').click();

    // The campaign can end while the scene remains open. The server's supplied clock
    // advances locally, without refreshing the full account just to show the odds.
    await page.evaluate(() => {
      BR.kit.closeModal('gacha-modal'); BR.gacha.reset();
      const fetchState = BR.api.gacha;
      BR.api.gacha = () => fetchState().then((r) => { r.now = BR.GACHA.events(Date.now()).boost.end - 600000; r.events = BR.GACHA.events(r.now); return r; });
      window.gachaClock = performance.now.bind(performance);
      window.gachaShift = 0;
      Object.defineProperty(performance, 'now', { configurable: true, value: () => gachaClock() + gachaShift });
      BR.gacha.open();
    });
    await page.waitForFunction(() => !document.getElementById('gacha-controls').hidden);
    await page.locator('.gc-tier[data-kind="rare"]').click();
    const oddsCalls = requests.filter((p) => p === '/api/gacha').length;
    await page.locator('#gacha-odds-open').click();
    const carChance = () => page.locator('#gacha-odds-rows tr').filter({ hasText: /^オンヴォーロ/ }).locator('td').last().textContent();
    assert.equal(await carChance(), '10.5%');
    await page.locator('[data-close="gacha-odds-modal"]').click();
    await page.evaluate(() => { gachaShift = 1200000; });
    await page.locator('#gacha-odds-open').click();
    assert.equal(await carChance(), '7%');
    assert.equal(requests.filter((p) => p === '/api/gacha').length, oddsCalls);
    await page.evaluate(() => { BR.kit.closeModal('gacha-odds-modal'); BR.kit.closeModal('gacha-modal'); BR.diary.open(); });
    await page.locator('#developer-diary').waitFor({ state: 'visible' });
    await page.evaluate(() => { BR.kit.closeModal('developer-diary'); BR.diary.open(); });
    await page.locator('#developer-diary').waitFor({ state: 'visible' });
    for (const file of lazy.diary) assert.equal(requests.filter((p) => p === '/' + file).length, 1, file + ' is reused on a second open');
    assert.deepEqual(errors, []); assert.deepEqual(missing, []);
    console.log(JSON.stringify({ ok: true, initialGachaImageRequests: initialGachaImages.length, controls, oddsExtraRequests: 0, campaignBoundary: true, prices: 9, rewardSlots: [3, 9, 30], doubleCharge: false, phoneConfirmation: true }));
    await context.close();
  } finally {
    if (browser) await browser.close();
    await s.stop();
  }
})().catch((error) => { console.error(error); process.exit(1); });
