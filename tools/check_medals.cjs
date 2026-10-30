/* 功績 in real Chromium on a disposable Node/SSE server: the medal screen loads only when opened (the 功績 button, its number
   the medals waiting), shows four medals to a row and two rows to a page with the next page at the edge, keeps the hidden
   medals out until they are the player's, pages with the arrows, a mouse swipe and — the stage turned on a phone held
   upright — a swipe down the screen; a reward is received once; a free gacha ticket pulls the gacha without $.
   Requires Playwright and a browser; OPS_BROWSER_EXECUTABLE selects a browser. No production data is used. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const { startServer } = await import(path.join(ROOT, 'server/test/helpers.js'));
  const s = await startServer({ medals: true });
  let browser;
  try {
    const player = await s.register('MedalCheck');
    // medals already reached: 小金持ち, ノーマルウィン, ルーキートレジャーハンター, 達人精神, コズミック, and the hidden メニメニトレジャーハンター
    s.setUser(player.me.id, { dollars: 20000000, age_ok: 1, guide_done: 1, total_won: 15000000, wins: 640, login_days: 12, harvests: 7, gacha_pulls: 40, best_combo: 8 });
    s.app.db.prepare("INSERT INTO items (user_id, item, count) VALUES (?, 'gacha-ticket:rare', 1)").run(player.me.id);
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'] });

    async function game(viewport) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      const page = await context.newPage(), errors = [], missing = [], requests = [];
      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(60000);
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('response', (r) => { if (r.status() === 404) missing.push(new URL(r.url()).pathname); });
      page.on('request', (r) => requests.push(new URL(r.url()).pathname.replace(/^\/immutable\/[a-f0-9]{10}/, '')));
      await page.addInitScript((token) => {
        Element.prototype.requestFullscreen = () => Promise.resolve();
        localStorage.setItem('blockbuster-reels/auth', token);
        localStorage.setItem('blockbuster-reels/push-asked', JSON.stringify({ n: 9, at: Date.now() }));
      }, player.token);
      await page.goto(s.base, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.BR && BR.social && BR.social.me() && BR.feats.ready() > 0);
      await page.evaluate(() => BR.screens.show('slot'));
      await page.evaluate(() => { document.querySelectorAll('.modal:not([hidden]), .ov:not([hidden])').forEach((m) => { m.hidden = true; }); });
      return { context, page, errors, missing, requests };
    }

    const { page, errors, missing, requests } = await game({ width: 1600, height: 740 });
    const lazy = JSON.parse(fs.readFileSync(path.join(ROOT, 'js/lazy-screens.json'), 'utf8')).medals;
    for (const file of [...lazy, 'css/medals.css']) assert.equal(requests.includes('/' + file), false, file + ' stays unloaded until the screen opens');
    // the button's number: the medals waiting for their tap (first, pioneer and the six above)
    const waiting = await page.evaluate(() => BR.feats.ready());
    assert.ok(waiting >= 7, 'medals waiting: ' + waiting);
    assert.equal(await page.locator('#medal-badge').textContent(), String(waiting));

    await page.locator('#btn-medals').click();
    await page.locator('#medals-modal').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelectorAll('#md-track .md-cell').length > 0);
    for (const file of [...lazy, 'css/medals.css']) assert.equal(requests.filter((p) => p === '/' + file).length, 1, file + ' loads once');
    // opened on the collection (there are medals to receive); the hidden one is there, and not on the other side
    const mine = await page.evaluate(() => Array.from(document.querySelectorAll('#md-track .md-cell')).map((c) => c.dataset.id));
    assert.ok(mine.includes('many-many-hunter') && mine.includes('normal-win'), mine.join());
    await page.locator('.md-tab').first().click();
    const open = await page.evaluate(() => Array.from(document.querySelectorAll('#md-track .md-cell')).map((c) => c.dataset.id));
    assert.ok(!open.includes('many-many-hunter') && !open.includes('normal-win') && open.includes('many-friends'));
    assert.ok(open.length > 8);

    // four to a row, two rows to a page, the next page's first medal at the edge (partly in sight)
    const look = await page.evaluate(() => {
      const view = document.getElementById('md-view').getBoundingClientRect();
      const pages = Array.from(document.querySelectorAll('.md-page'));
      const cells = Array.from(pages[0].children).map((c) => c.getBoundingClientRect());
      // (rows by their top, a few px either way: the medal chosen stands a little higher)
      const rows = cells.map((r) => r.top).sort((a, b) => a - b).filter((t, i, a) => !i || t - a[i - 1] > 20);
      const next = pages[1].children[0].getBoundingClientRect();
      const detail = document.getElementById('md-detail').getBoundingClientRect();
      return { perPage: cells.length, rows: rows.length, perRow: cells.filter((r) => Math.abs(r.top - rows[0]) <= 20).length,
        inside: cells.every((r) => r.left >= view.left - 1 && r.right <= view.right + 1 && r.top >= view.top - 1 && r.bottom <= view.bottom + 1),
        peek: next.left < view.right - 20 && next.right > view.right, clear: view.right <= detail.left };
    });
    assert.deepEqual(look, { perPage: 8, rows: 2, perRow: 4, inside: true, peek: true, clear: true });

    // paging: the arrow, then a mouse swipe back
    const shift = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('md-track')).transform).m41);
    const x0 = await shift();
    await page.locator('#md-next').click();
    await page.waitForTimeout(450);
    const x1 = await shift();
    assert.ok(x1 < x0 - 300, 'the next page: ' + x0 + ' -> ' + x1);
    const box = await page.locator('#md-view').boundingBox();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 8 });
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(450);
    assert.equal(Math.round(await shift()), Math.round(x0), 'swiped back to the first page');
    assert.equal(await page.locator('.md-dot[aria-current="true"]').count(), 1);

    // a reward, once: ファーストインプレッション's $100K
    await page.locator('.md-tab').nth(1).click();
    await page.locator('.md-cell[data-id="first"]').click();
    const before = await page.evaluate(() => BR.store.state.dollars);
    await page.locator('.md-claim').click();
    await page.waitForFunction((d) => BR.store.state.dollars === d + 100000, before);
    await page.waitForFunction((n) => BR.feats.ready() === n - 1, waiting);
    assert.equal(await page.locator('.md-claim').count(), 0, 'nothing left to receive on it');
    assert.match(await page.locator('#md-detail').textContent(), /獲得/);

    // a free ticket: the gacha shows it and pulls with it, $ untouched
    await page.locator('#medals-modal [data-close]').click();
    await page.evaluate(() => BR.gacha.open());
    await page.locator('.gc-free').waitFor({ state: 'visible' });
    assert.match(await page.locator('.gc-free').textContent(), /無料券 ×1/);
    assert.match(await page.locator('.gc-tier[data-kind="rare"] .gc-tier-ticket').textContent(), /×1/);
    const cash = await page.evaluate(() => BR.store.state.dollars);
    await page.locator('.gc-free-button').click();
    await page.locator('#confirm').waitFor({ state: 'visible' });
    assert.match(await page.locator('#confirm-text').textContent(), /無料券 ×1/);
    await page.locator('#confirm-yes').click();
    await page.locator('#gacha-results .gc-reward').first().waitFor();
    assert.match(await page.locator('#gacha-result-name').textContent(), /無料券/);
    assert.equal(await page.evaluate(() => BR.store.state.dollars), cash, 'no $ paid');
    await page.locator('#gacha-result-close').click();
    assert.equal(await page.locator('.gc-free').isVisible(), false, 'no ticket left');
    assert.deepEqual(errors, []);
    assert.deepEqual(missing, []);

    // a phone held upright: the stage is turned, a swipe down the screen moves the pages along
    const tall = await game({ width: 412, height: 915 });
    await tall.page.evaluate(() => BR.medals.open());
    await tall.page.waitForFunction(() => document.querySelectorAll('#md-track .md-cell').length > 0);
    await tall.page.locator('.md-tab').first().click();
    const shiftTall = () => tall.page.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('md-track')).transform).m41);
    const t0 = await shiftTall();
    const vb = await tall.page.locator('#md-view').boundingBox();
    // (the stage's x runs down the screen: a drag up the screen is a swipe to the left, to the next page)
    await tall.page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height * 0.75);
    await tall.page.mouse.down();
    await tall.page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height * 0.5, { steps: 8 });
    await tall.page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height * 0.25, { steps: 8 });
    await tall.page.mouse.up();
    await tall.page.waitForTimeout(450);
    assert.ok(await shiftTall() < t0 - 100, 'a swipe up the turned stage goes to the next page');
    assert.deepEqual(tall.errors, []);
    console.log('medals check: ok');
  } finally {
    if (browser) await browser.close();
    await s.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
