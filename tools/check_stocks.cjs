/* 投資 in real Chromium on a disposable Node/SSE server: the screen loads only when opened (from the 詳細 card), fits the
   stage, says nothing beyond its labels and numbers, draws its chart and moves with each second's tick; an order needs the
   button held (a tap trades nothing), a market buy and a limit order go through, and the limit order is cancelled; the
   企業 tab shows the company behind the share.
   Requires Playwright and a browser; OPS_BROWSER_EXECUTABLE selects a browser. No production data is used. */
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
    const player = await s.register('StockCheck');
    s.setUser(player.me.id, { dollars: 20000000, age_ok: 1, guide_done: 1 });
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1600, height: 740 }, reducedMotion: 'reduce' });
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
    const lazy = JSON.parse(fs.readFileSync(path.join(ROOT, 'js/lazy-screens.json'), 'utf8')).stocks;
    for (const file of lazy) assert.equal(requests.includes('/' + file), false, file + ' stays unloaded until the screen opens');

    // from the 詳細 card
    await page.evaluate(() => { BR.social.open('more'); document.querySelector('[data-act="stocks"]').click(); });
    await page.locator('#stocks-modal').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#sk-head .sk-price') && document.querySelector('.sk-tab-price').textContent);
    for (const file of lazy) assert.equal(requests.filter((p) => p === '/' + file).length, 1, file + ' loads once');

    // labels and numbers only, every part inside its panel
    const look = await page.evaluate(() => {
      const leaves = Array.from(document.querySelectorAll('#stocks-modal *')).filter((n) => !n.children.length && n.offsetParent !== null && n.textContent.trim());
      const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
      const spill = [];
      for (const p of document.querySelectorAll('#stocks-modal .sk-top, #stocks-modal .sk-chart-pane, #stocks-modal .sk-hold, #stocks-modal .sk-order, #stocks-modal .sk-foot')) {
        const pr = p.getBoundingClientRect();
        for (const c of p.querySelectorAll('*')) { const r = c.getBoundingClientRect(); if (c.offsetParent !== null && r.width && r.height && !c.closest('.sk-list') && !inside(r, pr)) spill.push(c.className); }
      }
      return { long: leaves.map((n) => n.textContent.trim()).filter((t) => t.length > 24 || /[。、]/.test(t)), spill };
    });
    assert.deepEqual(look.long, [], 'no sentences on the screen');
    assert.deepEqual(look.spill, []);
    // the chart is drawn, and moves with the seconds
    const inked = () => page.evaluate(() => { const c = document.getElementById('sk-chart'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
    assert.ok(await inked() > 1000);
    const ticks = await page.evaluate(() => new Promise((resolve) => { let n = 0; BR.live.on('stock', (e) => { if (e.q) n++; }); setTimeout(() => resolve(n), 2600); }));
    assert.ok(ticks >= 2, 'a tick each second: ' + ticks);

    // a tap is not an order; a press held is
    const holdOn = async (ms) => {
      const b = await page.locator('.sk-go').boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(ms);
      await page.mouse.up();
    };
    await page.getByRole('button', { name: '+10', exact: true }).click();
    const before = await page.evaluate(() => BR.store.state.dollars);
    await holdOn(120);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => BR.store.state.dollars), before, 'a tap trades nothing');
    await holdOn(700);
    await page.waitForFunction((d) => BR.store.state.dollars < d, before);
    await page.waitForFunction(() => /11株/.test(document.getElementById('sk-hold').textContent));
    // a limit order, shown waiting, then cancelled (its money back)
    await page.locator('.sk-order .sk-chip[data-v="limit"]').click();
    const mid = await page.evaluate(() => BR.store.state.dollars);
    await holdOn(700);
    await page.locator('.sk-line.sk-open').waitFor();
    await page.waitForFunction((d) => BR.store.state.dollars < d, mid);
    await page.locator('.sk-line.sk-open .sk-x').click();
    await page.waitForFunction(() => !document.querySelector('.sk-line.sk-open'));
    await page.waitForFunction((d) => BR.store.state.dollars === d, mid);
    // the other views
    for (const v of ['candle', 'ma']) await page.locator(`#sk-modes .sk-chip[data-v="${v}"]`).click();
    for (const p of ['1h', '1w', '1m', '1y', 'all', '1d']) {
      await Promise.all([page.waitForResponse((r) => r.url().includes('/api/stocks/chart') && r.url().includes('p=' + p) && r.ok()), page.locator(`#sk-periods .sk-chip[data-v="${p}"]`).click()]);
      await page.waitForTimeout(100);
      assert.ok(await inked() > 1000, p);
    }
    await page.locator('#sk-tabs .sk-tab[data-v="ice"]').click();
    await page.locator('#sk-list-tabs .sk-chip[data-v="history"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#sk-list .sk-line').length >= 2);
    assert.ok(await inked() > 1000);
    // the company behind the share: its last quarter, its guidance and dividend, the per-share figures, its news
    await page.locator('#sk-list-tabs .sk-chip[data-v="corp"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#sk-list .sk-corp').length >= 3);
    const corp = await page.locator('#sk-list').textContent();
    for (const label of ['ICE SMOKER株式会社', '次の決算発表', '営業利益', '純利益', '配当', 'PER', 'PBR']) assert.ok(corp.includes(label), label);
    if (process.env.STOCKS_SCREENSHOT) await page.screenshot({ path: process.env.STOCKS_SCREENSHOT });
    await page.locator('#stocks-modal [data-close]').first().click();
    await page.locator('#stocks-modal').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    assert.deepEqual(missing, []);
    console.log(JSON.stringify({ ok: true, lazy: lazy.length, ticks, holdToTrade: true, limitCancelled: true }));
    await context.close();
  } finally {
    if (browser) await browser.close();
    await s.stop();
  }
})().catch((error) => { console.error(error); process.exit(1); });
