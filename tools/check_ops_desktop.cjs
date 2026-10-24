/* Optional real-browser smoke check. Requires Playwright and a Chromium install:
     node tools/check_ops_desktop.cjs
   OPS_BROWSER_EXECUTABLE can select an installed browser. Screenshots are only
   written when OPS_DESKTOP_SCREENSHOTS is set. All accounts/data are disposable. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const { startServer } = await import('../server/test/helpers.js');
  const s = await startServer({ operators: ['taku', 'OperatorQA'] });
  let browser, checks = 0;
  const errors = [];
  const shotDir = process.env.OPS_DESKTOP_SCREENSHOTS;
  const code = '987654321098';
  const ids = ['players', 'archive', 'reports', 'detections', 'feedback', 'log', 'operators', 'team', 'security', 'server', 'pay', 'vault'];
  async function check(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
  async function shot(page, name) {
    if (!shotDir) return;
    fs.mkdirSync(shotDir, { recursive: true });
    await page.evaluate(() => Promise.all(Array.from(document.images).map(i => i.decode().catch(() => {}))));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(shotDir, name + '.png') });
  }
  async function signIn(page, name) {
    await page.locator('#login').waitFor({ state: 'visible' });
    await page.locator('#login-name').fill(name); await page.locator('#login-pass').fill('pass1234');
    await page.locator('#login-go').click(); await page.locator('#app').waitFor({ state: 'visible' });
  }
  async function open(page, id) {
    await page.locator('#tabs [data-view="' + id + '"]').click();
    await page.locator('#mac-window-' + id + '.is-active').waitFor({ state: 'visible' });
  }
  async function menu(page, item) {
    await page.locator('.mac-menu-trigger[data-menu="window"]').click();
    await page.locator('#mac-menu').getByText(item, { exact: true }).click();
  }
  async function out(page) {
    await page.locator('.mac-profile').click(); await page.locator('#logout').click();
    await page.locator('#login').waitFor({ state: 'visible' });
  }
  try {
    const dev = await s.register('taku');
    const player = await s.register('PlayerQA');
    await s.register('OperatorQA'); await s.register('ViewerQA');
    const devCall = (method, url, body) => s.call(method, url, { token: dev.token, body });
    browser = await chromium.launch({
      executablePath: process.env.OPS_BROWSER_EXECUTABLE || undefined,
      headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: process.env.OPS_DESKTOP_MOTION === 'full' ? 'no-preference' : 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(s.base + '/ops/');
    await check('first login uses the supplied landscape and keeps the real form', async () => {
      await page.locator('#login').waitFor({ state: 'visible' });
      assert.match(await page.locator('#login').evaluate(n => getComputedStyle(n).backgroundImage), /wallpaper-login/);
      await page.locator('#login-go').click(); assert.match(await page.locator('#login-error').textContent(), /名前とパスワード/);
      await shot(page, 'login');
    });
    await signIn(page, 'taku');
    await check('desktop has all 12 authorized apps and the supplied home background', async () => {
      assert.equal(await page.locator('.mac-desktop-app:visible').count(), 12);
      assert.equal(await page.locator('.mac-window.is-open').count(), 0);
      assert.match(await page.locator('#app').evaluate(n => getComputedStyle(n).backgroundImage), /wallpaper-desktop/);
      await shot(page, 'desktop');
    });
    for (const id of ids) await check('original ' + id + ' app opens in its own window', async () => {
      await open(page, id); assert.equal(await page.locator('#view-' + id).isVisible(), true);
    });
    await check('all app windows and original DOM IDs stay unique', async () => {
      assert.equal(await page.locator('.mac-window.is-open').count(), 12);
      const duplicates = await page.evaluate(() => { const ids = Array.from(document.querySelectorAll('[id]')).map(n => n.id); return ids.filter((id, i) => ids.indexOf(id) !== i); });
      assert.deepEqual(duplicates, []);
    });
    await open(page, 'players');
    await check('player search and filters still use the existing handlers', async () => {
      await page.locator('#search').fill('PlayerQA');
      await page.waitForFunction(() => document.querySelectorAll('#rows tr').length === 1 && document.querySelector('#rows').textContent.includes('PlayerQA'));
      await page.locator('#filters [data-filter="online"]').click(); await page.locator('#empty').waitFor({ state: 'visible' });
      await page.locator('#filters [data-filter="all"]').click();
      await page.locator('#rows tr').waitFor();
    });
    await check('player details and official chat still open and close', async () => {
      await page.locator('#rows tr[data-id="' + player.me.id + '"] td').nth(1).click();
      await page.locator('#drawer').waitFor({ state: 'visible' }); await page.locator('#drawer-close').click();
      await page.locator('#rows [data-chat="' + player.me.id + '"]').click();
      await page.locator('#chat').waitFor({ state: 'visible' }); await page.locator('#chat-close').click();
    });
    await check('dragging and resizing move the window within the desktop', async () => {
      const win = page.locator('#mac-window-players'), bar = win.locator('.mac-titlebar');
      let before = await win.boundingBox(), b = await bar.boundingBox();
      await page.mouse.move(b.x + 180, b.y + 23); await page.mouse.down(); await page.mouse.move(b.x + 220, b.y + 53, { steps: 5 }); await page.mouse.up();
      let after = await win.boundingBox(); assert.ok(Math.abs(after.x - before.x) > 20 || Math.abs(after.y - before.y) > 20);
      before = after; b = await win.locator('.mac-resize').boundingBox();
      await page.mouse.move(b.x + 12, b.y + 12); await page.mouse.down(); await page.mouse.move(b.x - 60, b.y - 50, { steps: 5 }); await page.mouse.up();
      after = await win.boundingBox(); assert.ok(after.width < before.width - 30 && after.height < before.height - 30);
    });
    await check('minimize, Dock restore and close retain the search field', async () => {
      await page.locator('#mac-window-players .mac-minimize').click();
      await page.locator('#mac-window-players').waitFor({ state: 'hidden' });
      await open(page, 'players'); assert.equal(await page.locator('#search').inputValue(), 'PlayerQA');
      await page.locator('#mac-window-players .mac-close').click(); await page.locator('#mac-window-players').waitFor({ state: 'hidden' });
      await open(page, 'players'); assert.equal(await page.locator('#search').inputValue(), 'PlayerQA');
    });
    await check('maximize and restore fit within the desktop work area', async () => {
      const win = page.locator('#mac-window-players');
      await win.evaluate(n => Promise.all(n.getAnimations().map(a => a.finished.catch(() => {}))));
      const before = await win.boundingBox();
      await win.locator('.mac-zoom').click();
      await page.waitForFunction(() => Math.abs(document.querySelector('#mac-window-players').getBoundingClientRect().width - (document.querySelector('#mac-windows').clientWidth - 12)) < 2);
      const max = await win.boundingBox(), area = await page.locator('#mac-windows').boundingBox();
      assert.ok(Math.abs(max.width - (area.width - 12)) < 2); assert.ok(max.y >= area.y);
      await win.locator('.mac-zoom').click();
      await page.waitForFunction(width => Math.abs(document.querySelector('#mac-window-players').getBoundingClientRect().width - width) < 2, before.width);
      const back = await win.boundingBox(); assert.ok(Math.abs(back.width - before.width) < 2);
      await shot(page, 'windows');
    });
    await check('grouped tabs switch the original app and support closing a tab', async () => {
      await menu(page, 'ウインドウをタブにまとめる');
      await page.locator('body.mac-grouped').waitFor({ state: 'attached' }); assert.equal(await page.locator('.mac-window:visible').count(), 1);
      await page.locator('.mac-window.is-active .mac-tab-switch[aria-label="ログ"]').click();
      await page.locator('#mac-window-log.is-active').waitFor();
      await page.keyboard.press('ArrowRight');
      await page.locator('#mac-window-operators.is-active').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement.matches('.mac-tab-switch[aria-selected="true"]')), true);
      await page.locator('.mac-window.is-active .mac-tab-switch[aria-label="ログ"]').click();
      await shot(page, 'tabs');
      await page.locator('.mac-window.is-active .mac-tab-close[aria-label="ログのタブを閉じる"]').click();
      await page.locator('#mac-window-log').waitFor({ state: 'hidden' });
      await menu(page, 'ウインドウをタブにまとめる');
    });
    await check('overview, desktop hiding and restoring work without destroying windows', async () => {
      await page.locator('.mac-mission-icon').click(); await page.locator('body.mac-overview').waitFor({ state: 'attached' });
      const count = await page.locator('.mac-window.is-open').count();
      await page.locator('.mac-window.is-open .mac-window-shade').first().click();
      assert.equal(await page.locator('body.mac-overview').count(), 0);
      await page.locator('.mac-dock-home').click(); assert.equal(await page.locator('.mac-window:visible').count(), 0);
      await page.locator('.mac-dock-home').click(); assert.equal(await page.locator('.mac-window:visible').count(), count);
    });
    await check('keyboard search launches only the matching authorized app', async () => {
      await page.keyboard.press('Control+k'); await page.locator('#mac-launchpad').waitFor({ state: 'visible' });
      await page.locator('.mac-launch-search').fill('サーバー'); assert.equal(await page.locator('.mac-launch-app:visible').count(), 1);
      await page.locator('.mac-launch-search').press('Enter'); await page.locator('#mac-window-server.is-active').waitFor();
      assert.equal(await page.locator('#mac-launchpad').isVisible(), false);
    });
    await check('developer-code confirmation preserves real validation and submission', async () => {
      await open(page, 'operators'); await page.locator('#op-devcode-btn').click();
      await page.locator('#dialog.mac-auth-dialog').waitFor({ state: 'visible' });
      assert.match(await page.locator('#dialog').evaluate(n => getComputedStyle(n).backgroundImage), /wallpaper-login/);
      assert.equal(await page.locator('#dialog-cancel').evaluate(n => getComputedStyle(n).backgroundImage), 'none');
      await shot(page, 'confirmation');
      await page.locator('#dialog-input').fill(code); await page.locator('#dialog-ok').click();
      await page.locator('#dialog').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.querySelector('#op-devcode-btn').textContent.includes('変更'));
      assert.equal((await devCall('POST', '/api/ops/viewer', { name: 'ViewerQA', action: 'grant', code })).status, 200);
    });
    await check('log details and internal navigation remain available', async () => {
      await open(page, 'log'); await page.locator('#log-list .entry-more').first().click();
      await page.locator('#log-list .entry-detail').first().waitFor({ state: 'visible' });
      assert.ok((await page.locator('#log-list .entry-detail').first().textContent()).includes('記録番号'));
      await page.locator('#log-list .entry-line[title="運営者を開く"]').first().click();
      await page.locator('#mac-window-operators.is-active').waitFor({ state: 'visible' });
    });
    await check('every attached icon and wallpaper decodes in Chromium', async () => {
      const paths = await page.evaluate(() => Array.from(new Set(Array.from(document.images).map(n => n.src))));
      for (const file of fs.readdirSync(path.resolve(__dirname, '../ops/assets'))) paths.push(new URL('assets/' + file, page.url()).href);
      const failures = await page.evaluate(async paths => {
        const bad = []; for (const src of paths) { const im = new Image(); im.src = src; try { await im.decode(); } catch { bad.push(src); } } return bad;
      }, paths); assert.deepEqual(failures, []);
      await page.locator('.mac-menu-trigger[data-menu="view"]').click();
      await page.locator('#mac-menu').getByText('予備の背景を使う', { exact: true }).click();
      assert.match(await page.locator('#app').evaluate(n => getComputedStyle(n).backgroundImage), /wallpaper-reserve/);
      await page.locator('.mac-menu-trigger[data-menu="view"]').click();
      await page.locator('#mac-menu').getByText('予備の背景を使う', { exact: true }).click();
    });
    await check('daily login retains the existing once-per-day recording', async () => {
      s.app.db.prepare('DELETE FROM ops_entries WHERE user_id = ?').run(dev.me.id);
      await page.reload(); await page.locator('#enter').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#enter-name').textContent(), 'taku'); await shot(page, 'daily-login');
      await page.locator('#enter-go').click(); await page.locator('#app').waitFor({ state: 'visible' });
      assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM ops_entries WHERE user_id = ?').get(dev.me.id).n, 1);
    });
    await check('normal operators retain their original permissions', async () => {
      await out(page); await signIn(page, 'OperatorQA');
      assert.equal(await page.locator('.mac-desktop-app:visible').count(), 11);
      assert.equal(await page.locator('#tab-pay').isVisible(), false); assert.equal(await page.locator('#speed').isDisabled(), true);
      await open(page, 'vault'); assert.equal(await page.locator('#view-vault').isVisible(), true);
    });
    await check('viewers see exactly their 7 original allowed apps', async () => {
      await out(page); await signIn(page, 'ViewerQA');
      assert.equal(await page.locator('.mac-desktop-app:visible').count(), 7);
      for (const id of ['players', 'archive', 'team', 'pay', 'vault']) {
        assert.equal(await page.locator('#tabs [data-view="' + id + '"]').isVisible(), false);
        assert.equal(await page.locator('#mac-window-' + id).isVisible(), false);
      }
      await page.keyboard.press('Control+k'); assert.equal(await page.locator('.mac-launch-app:visible').count(), 7); await page.keyboard.press('Escape');
      await shot(page, 'viewer');
    });
    await check('revoking viewer access still signs out the existing session', async () => {
      assert.equal((await devCall('POST', '/api/ops/viewer', { name: 'ViewerQA', action: 'revoke', code })).status, 200);
      await page.locator('#login').waitFor({ state: 'visible', timeout: 10000 }); assert.equal(await page.locator('#app').isVisible(), false);
    });
    await check('touch portrait retains the existing landscape rotation and usable windows', async () => {
      const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
      const p = await phone.newPage(); p.on('pageerror', e => errors.push(e.message));
      await p.goto(s.base + '/ops/'); await p.locator('#frame.turned').waitFor(); await shot(p, 'phone-login');
      await signIn(p, 'taku'); await open(p, 'players');
      const box = await p.locator('#mac-window-players').boundingBox(); assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 391 && box.y + box.height <= 845);
      await shot(p, 'phone-desktop'); await phone.close();
    });
    await check('no uncaught browser errors', async () => assert.deepEqual(errors, []));
    console.log('PASS ' + checks + ' browser checks; developer, operator and viewer; real local API.');
  } catch (e) {
    console.error('FAIL after ' + checks + ' browser checks:', e);
    throw e;
  } finally { if (browser) await browser.close(); await s.stop(); }
})().catch(() => { process.exitCode = 1; });
