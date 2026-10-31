/* 街ライブ and the operator site's 街 app in real Chromium on a disposable Node/SSE server with a small country (1,000
   people): the screen loads only when opened (from the 詳細 card), draws the map with everyone on it, shows its panels
   (the districts, the country, politics, unions, companies, news), opens a person's card when a dot is touched, and
   offers nothing that changes the country; the operator app shows the country, finds a person and opens a company's
   people and meetings. Requires Playwright and a browser; OPS_BROWSER_EXECUTABLE selects a browser. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const { startServer } = await import(path.join(ROOT, 'server/test/helpers.js'));
  const s = await startServer({ npc: true, npcPopulation: 1000, operators: ['TownCheck'], developer: 'TownCheck' });
  let browser;
  try {
    const player = await s.register('TownCheck');
    s.setUser(player.me.id, { age_ok: 1, guide_done: 1 });
    // the companies begin with a look at the market, the country with the next wake
    await s.call('GET', '/api/stocks', { token: player.token });
    await s.app.api.npcWake();
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1600, height: 740 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], requests = [];
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => requests.push(new URL(r.url()).pathname.replace(/^\/immutable\/[a-f0-9]{10}/, '')));
    await page.addInitScript((token) => { Element.prototype.requestFullscreen = () => Promise.resolve(); localStorage.setItem('blockbuster-reels/auth', token); }, player.token);
    await page.goto(s.base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.BR && BR.social && BR.social.me());
    const lazy = JSON.parse(fs.readFileSync(path.join(ROOT, 'js/lazy-screens.json'), 'utf8')).town;
    for (const file of lazy) assert.equal(requests.includes('/' + file), false, file + ' stays unloaded until the screen opens');
    await page.evaluate(() => { BR.social.open('more'); document.querySelector('[data-act="town"]').click(); });
    await page.locator('#town-modal').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#tw-status .tw-pop'));
    const inked = await page.evaluate(() => { const c = document.getElementById('tw-map'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
    assert.ok(inked > 5000, 'the map is drawn: ' + inked);
    for (const tab of ['区', '国', '政治', '労働', '企業', 'ニュース', '今']) {
      await page.locator('#tw-tabs button', { hasText: tab }).first().click();
      await page.waitForFunction(() => document.querySelectorAll('#tw-side .tw-sec').length > 0);
    }
    // nothing to change it with: no inputs, no sign or vote buttons
    const inputs = await page.evaluate(() => document.querySelectorAll('#town-modal input, #town-modal textarea, #town-modal select').length);
    assert.equal(inputs, 0);
    // a dot touched: its person
    const box = await page.locator('#tw-map').boundingBox();
    for (let k = 0; k < 6; k++) {
      await page.mouse.click(box.x + box.width * (0.4 + k * 0.03), box.y + box.height * (0.2 + k * 0.05));
      if (await page.locator('#tw-card').isVisible()) break;
    }
    await page.locator('#tw-card').waitFor({ state: 'visible' });
    assert.match(await page.locator('#tw-card').innerText(), /心の声/);
    await page.screenshot({ path: path.join(process.env.SHOT_DIR || ROOT, 'town-check.png') });
    // the operator site's 街 app: the country, a person found, a company's people and meetings
    const ops = await context.newPage();
    ops.on('pageerror', (e) => errors.push('ops: ' + e.message));
    await ops.goto(s.base + '/ops/', { waitUntil: 'domcontentloaded' });
    await ops.locator('#login').waitFor({ state: 'visible' });
    await ops.locator('#login-name').fill('TownCheck');
    await ops.locator('#login-pass').fill('pass1234');
    await ops.locator('#login-go').click();
    await ops.locator('#app').waitFor({ state: 'visible' });
    await ops.evaluate(() => OpsDesktop.open('town'));
    await ops.waitForFunction(() => document.querySelectorAll('#view-town .town-panel').length >= 5);
    await ops.locator('#view-town .town-tabs .chip', { hasText: '住民' }).click();
    await ops.locator('#view-town .town-search button').click();
    await ops.waitForFunction(() => document.querySelectorAll('#view-town .town-table tbody tr').length > 0);
    await ops.locator('#view-town .town-table tbody tr').first().click();
    await ops.waitForFunction(() => /心の声/.test(document.querySelector('#view-town').textContent) && /人間関係/.test(document.querySelector('#view-town').textContent));
    await ops.locator('#view-town .town-tabs .chip', { hasText: '会社の人と会議' }).click();
    await ops.waitForFunction(() => /リスク管理室|融資本部/.test(document.querySelector('#view-town').textContent));
    await ops.screenshot({ path: path.join(process.env.SHOT_DIR || ROOT, 'town-ops-check.png'), fullPage: false });
    assert.deepEqual(errors, []);
    console.log('街ライブ: OK');
  } finally {
    if (browser) await browser.close();
    await s.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
