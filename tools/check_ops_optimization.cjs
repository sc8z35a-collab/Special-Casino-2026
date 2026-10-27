/* Real-browser regression/DOM comparison for CDW. Requires Playwright and Chromium.
   Optional BASELINE_REF compares an earlier ops/cdw.js; all accounts and data are local/disposable. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const { startServer } = await import(path.join(ROOT, 'server/test/helpers.js'));
  const s = await startServer();
  let browser;
  try {
    const dev = await s.register('taku'), alice = await s.register('Alice'), bob = await s.register('Bob');
    assert.equal((await s.call('POST', '/api/report', { token: alice.token, body: { user: bob.me.id, kind: 'abuse', text: 'local test', place: 'search' } })).status, 200);
    const layout = { v: 1, items: [
      { id: 'server', x: 0, y: 0, w: 24, h: 14 },
      { id: 'reports', x: 26, y: 0, w: 20, h: 12 },
      { id: 'diary', x: 0, y: 16, w: 24, h: 18 }
    ] };
    assert.equal((await s.call('POST', '/api/ops/cdw', { token: dev.token, body: { layout } })).status, 200);
    const reports = await s.call('GET', '/api/ops/reports', { token: dev.token });
    const stats = await s.call('GET', '/api/ops/server?lean=1', { token: dev.token });
    const fullStats = await s.call('GET', '/api/ops/server', { token: dev.token });
    stats.rate.delta = false;
    stats.rate.history = [[Date.now() - 2000, 1, 200], [Date.now() - 1000, 2, 400], [Date.now(), 3, 600]];
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
    async function check(baseline) {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      if (baseline) {
        const source = execFileSync('git', ['show', baseline + ':ops/cdw.js'], { cwd: ROOT, encoding: 'utf8' });
        await context.route('**/ops/cdw.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: source }));
        const main = execFileSync('git', ['show', baseline + ':ops/ops.js'], { cwd: ROOT, encoding: 'utf8' });
        await context.route('**/ops/ops.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: main }));
      }
      const page = await context.newPage(), errors = [];
      page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(60000);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(() => { localStorage.setItem('two-state-ops/ui/autohide', 'no'); });
      await page.goto(s.base + '/ops/', { waitUntil: 'domcontentloaded' });
      await page.locator('#login-name').fill('taku'); await page.locator('#login-pass').fill('pass1234');
      await page.locator('#login-go').click(); await page.locator('#app').waitFor({ state: 'visible' });
      await page.evaluate(() => {
        document.body.classList.add('mac-flat');
        OpsBeat.stop();
        window.optimizationWidgets = {};
        const want = OpsBeat.want;
        OpsBeat.want = (id, asker) => { optimizationWidgets[id] = asker; want(id, asker); };
      });
      await page.locator('.tab[data-view="server"]').click({ force: true });
      await page.waitForFunction(() => optimizationWidgets.view);
      const serverStatus = await page.evaluate(async (r) => {
        const got = () => optimizationWidgets.view.got(r, {});
        got();
        const cards = ['srv-discord', 'srv-line', 'srv-patrol', 'srv-stele'].map((id) => document.getElementById(id));
        const headings = cards.map((card) => card.querySelector('h3'));
        let addedElements = 0;
        const observer = new MutationObserver((records) => {
          for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) addedElements++;
        });
        cards.forEach((card) => observer.observe(card, { subtree: true, childList: true }));
        for (let i = 0; i < 20; i++) got();
        await Promise.resolve(); observer.disconnect();
        const sameHeadings = cards.every((card, i) => card.querySelector('h3') === headings[i]);
        r.line = { ...r.line, on: true, bot: true, limit: 200, used: 0 }; got();
        const changedStatusFollows = document.getElementById('srv-line').textContent.includes('オン');
        const notificationControlFollows = document.getElementById('srv-discord').textContent.includes('テスト送信');
        return { updates: 20, addedElements, sameHeadings, changedStatusFollows, notificationControlFollows };
      }, fullStats);
      await page.locator('[data-desk="site"]').click({ force: true });
      await page.waitForFunction(() => OpsCDW.on() && optimizationWidgets['cdw:reports'] && optimizationWidgets['cdw:server']);
      await page.evaluate(({ reports, stats }) => {
        optimizationWidgets['cdw:reports'].got(reports);
        optimizationWidgets['cdw:server'].got(stats);
      }, { reports, stats });
      const result = await page.evaluate(async ({ stats }) => {
        const report = document.querySelector('.cdw-widget[data-id="reports"]');
        const server = document.querySelector('.cdw-widget[data-id="server"]');
        const beforeRow = report.querySelector('.cdw-lines li'), beforePath = server.querySelector('.cdw-line-r');
        let addedElements = 0;
        const observer = new MutationObserver((records) => {
          for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) addedElements++;
        });
        observer.observe(report, { childList: true, subtree: true });
        observer.observe(server, { childList: true, subtree: true });
        for (let i = 0; i < 20; i++) {
          optimizationWidgets['cdw:reports'].got({ same: true });
          optimizationWidgets['cdw:server'].got(stats);
        }
        await Promise.resolve(); observer.disconnect();
        const age = report.querySelector('.cdw-line-t').textContent, clock = Date.now;
        Date.now = () => clock() + 120000;
        optimizationWidgets['cdw:reports'].got({ same: true });
        const ageAdvances = report.querySelector('.cdw-line-t').textContent !== age;
        Date.now = clock;
        stats.live.online = 9; optimizationWidgets['cdw:server'].got(stats);
        const liveValueUpdates = server.querySelector('.cdw-stat-v').textContent === '9人';
        window.optimizationDraft = document.querySelector('.cdw-diary textarea');
        optimizationDraft.value = '未送信の下書き';
        window.optimizationServer = server;
        return { updates: 20, addedElements, reportRowReused: beforeRow === report.querySelector('.cdw-lines li'), graphPathReused: beforePath === server.querySelector('.cdw-line-r'),
          graphPaths: Array.from(server.querySelectorAll('.cdw-chart path')).map((path) => path.getAttribute('d')), ageAdvances, liveValueUpdates };
      }, { stats });
      await page.setViewportSize({ width: 1900, height: 1060 });
      await page.waitForTimeout(700);
      result.draftRetainedAfterResize = await page.evaluate(() => document.querySelector('.cdw-diary textarea').value === '未送信の下書き');
      result.windowReusedAfterResize = await page.evaluate(() => optimizationServer === document.querySelector('.cdw-widget[data-id="server"]'));
      await page.evaluate(() => OpsCDW.session(false));
      assert.equal(await page.locator('.cdw-widget').count(), 0, 'logout clears every prior operator widget');
      assert.deepEqual(errors, []);
      if (!baseline) {
        assert.equal(serverStatus.addedElements, 0); assert.equal(serverStatus.sameHeadings, true);
        assert.equal(serverStatus.changedStatusFollows, true); assert.equal(serverStatus.notificationControlFollows, true);
        assert.equal(result.addedElements, 0); assert.equal(result.reportRowReused, true); assert.equal(result.graphPathReused, true);
        assert.equal(result.ageAdvances, true); assert.equal(result.liveValueUpdates, true);
        assert.equal(result.draftRetainedAfterResize, true); assert.equal(result.windowReusedAfterResize, true);
      }
      await context.close();
      return { ...result, serverStatus };
    }
    const before = process.env.BASELINE_REF ? await check(process.env.BASELINE_REF) : null;
    const after = await check(null);
    if (before) assert.deepEqual(after.graphPaths, before.graphPaths, 'the chart keeps exactly the same geometry');
    const report = { baselineCommit: process.env.BASELINE_REF || null, before, after };
    if (process.env.OPS_OPTIMIZATION_REPORT) fs.writeFileSync(process.env.OPS_OPTIMIZATION_REPORT, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally {
    if (browser) await browser.close();
    await s.stop();
  }
})().catch((error) => { console.error(error); process.exit(1); });
