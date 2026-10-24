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
  const ids = ['players', 'archive', 'reports', 'detections', 'feedback', 'log', 'operators', 'team', 'security', 'server', 'pay', 'vault', 'devunit', 'securityhome', 'diary', 'profile'];
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
    const win = page.locator('#mac-window-' + id);
    if (await win.isVisible()) {
      if (await win.evaluate(n => n.classList.contains('is-active'))) return;
      await page.keyboard.press('Alt+Space');
      await page.locator('#mac-menu').getByText(await win.getAttribute('aria-label'), { exact: true }).click();
    } else { await page.locator('.mac-taskbar-edge').hover(); await page.locator('#tabs [data-view="' + id + '"]').click(); }
    await page.locator('#mac-window-' + id + '.is-active').waitFor({ state: 'visible' });
  }
  async function menu(page, item) {
    await page.keyboard.press('Alt+Space');
    await page.locator('#mac-menu').getByText(item, { exact: true }).click();
  }
  async function out(page) {
    await page.locator('.mac-taskbar-edge').hover(); await page.locator('.mac-profile').click(); await page.locator('#logout').click();
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
    await check('bottom bar has all 16 authorized apps and the desktop stays empty', async () => {
      assert.equal(await page.locator('#tabs .tab:not([hidden])').count(), 16);
      assert.equal(await page.locator('.mac-desktop-app, .mac-launch-search, .mac-menu-buttons').count(), 0);
      const tray = await page.locator('.top').boundingBox(); assert.ok(tray.y > 750);
      assert.equal(await page.locator('.mac-window.is-open').count(), 0);
      assert.match(await page.locator('#app').evaluate(n => getComputedStyle(n).backgroundImage), /wallpaper-desktop/);
      await shot(page, 'desktop');
    });
    await check('diary artwork matches the other icon sizes and Dock magnification is clearly visible', async () => {
      assert.equal(await page.locator('#tabs [data-view="diary"] img').evaluate(n => getComputedStyle(n).scale), '1.42');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const tab = page.locator('#tabs [data-view="players"]'); await tab.hover();
      assert.ok(await tab.evaluate(n => Number(n.style.getPropertyValue('--dock-scale')) > 1.45));
      const fits = await tab.locator('img').evaluate(async n => {
        await Promise.all(n.getAnimations().map(a => a.finished.catch(() => {})));
        const r = n.getBoundingClientRect(), p = document.querySelector('#tabs').getBoundingClientRect();
        return r.top >= p.top && r.bottom <= p.bottom;
      }); assert.equal(fits, true, 'magnified artwork must not be clipped by the Dock scroller');
      await page.mouse.move(5, 5); await page.emulateMedia({ reducedMotion: 'reduce' });
    });
    await check('notification widget minimizes, preserves history and restores after reload', async () => {
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('ops:notice', { detail: { app: 'players', text: 'widget test notification' } })));
      await page.locator('.mac-notice-minimize').click();
      assert.equal(await page.locator('#mac-notice-content').isVisible(), false);
      assert.equal(await page.locator('.mac-notice-minimize').getAttribute('aria-expanded'), 'false');
      assert.ok((await page.locator('#mac-notifications').boundingBox()).height < 100);
      assert.match(await page.locator('.mac-notice-history').textContent(), /widget test notification/);
      await page.locator('.mac-notice-minimize').click();
      assert.equal(await page.locator('#mac-notice-content').isVisible(), true);
      assert.match(await page.locator('.mac-notice-history').textContent(), /widget test notification/);
      await page.locator('.mac-notice-minimize').click(); await page.reload();
      await page.locator('#app').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#mac-notice-content').isVisible(), false);
      await page.locator('.mac-notification-toggle').click();
      assert.equal(await page.locator('#mac-notice-content').isVisible(), true);
    });
    await check('windows cover notifications and Dock while system controls remain recoverable', async () => {
      await open(page, 'players'); await page.locator('#mac-window-players .mac-zoom').click();
      await page.locator('#mac-window-players .mac-window-title').click();
      await page.mouse.move(500, 200);
      const result = await page.evaluate(() => {
        const area = document.querySelector('#mac-windows').getBoundingClientRect();
        const points = ['#mac-notifications', '.mac-dock-home'].map(sel => {
          const r = document.querySelector(sel).getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2).closest('.mac-window')?.id;
        });
        return { width: area.width, points };
      }); assert.equal(result.width, 1440); assert.deepEqual(result.points, ['mac-window-players', 'mac-window-players']);
      await page.locator('.mac-taskbar-edge').hover(); await page.locator('.mac-notification-toggle').click();
      assert.equal(await page.locator('#mac-notifications').isVisible(), true);
      await page.locator('.mac-notice-minimize').click(); await page.locator('.mac-notice-minimize').click();
      await page.locator('#mac-window-players .mac-window-title').click();
      await page.locator('#mac-window-players .mac-zoom').click();
      await page.locator('.mac-taskbar-edge').hover();
      const selected = page.locator('#tabs [data-view="players"]');
      assert.equal(await selected.getAttribute('aria-label'), 'プレイヤー一覧（操作中）');
      assert.equal(await selected.evaluate(n => getComputedStyle(n, '::after').width), '18px');
      await selected.click();
      assert.equal(await selected.getAttribute('aria-label'), 'プレイヤー一覧（最小化）');
      await selected.click();
      await shot(page, 'dock-window-notifications');
    });
    for (const id of ids) await check('original ' + id + ' app opens in its own window', async () => {
      await open(page, id); assert.equal(await page.locator('#view-' + id).isVisible(), true);
    });
    await check('Dock toggles visible background and active windows without losing form state', async () => {
      await open(page, 'players'); await page.locator('#search').fill('PlayerQA');
      await page.locator('#tabs [data-view="players"]').click(); await page.locator('#mac-window-players').waitFor({ state: 'hidden' });
      await page.locator('#tabs [data-view="players"]').click(); await page.locator('#mac-window-players.is-active').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#search').inputValue(), 'PlayerQA');
      await open(page, 'log'); await page.locator('#tabs [data-view="players"]').click();
      await page.locator('#mac-window-players').waitFor({ state: 'hidden' });
      await page.locator('#tabs [data-view="players"]').click();
    });
    await check('DEV UNIT renders README and comments as inert text and persists unread notifications', async () => {
      await open(page, 'devunit'); await page.locator('#devunit-readme summary').first().waitFor();
      assert.match(await page.locator('#devunit-readme').textContent(), /README DEV NEWS/);
      await page.locator('#devunit-doc').selectOption('readme-dev.txt');
      await page.waitForFunction(() => document.querySelector('#devunit-doc-status').textContent.startsWith('README DEV（'));
      await page.locator('#devunit-text').fill('<img src=x onerror=alert(1)> test comment');
      await page.locator('#devunit-form [type="submit"]').click();
      await page.waitForFunction(() => document.querySelector('#devunit-comments').textContent.includes('test comment'));
      assert.equal(await page.locator('#devunit-comments img').count(), 0);
      await open(page, 'log');
      const other = await s.call('POST', '/api/ops/login', { body: { name: 'OperatorQA', password: 'pass1234', device: 'qa-device-devunit-123456' } });
      assert.equal(other.status, 200);
      const posted = await s.call('POST', '/api/ops/devunit/comments', { token: other.token, body: { text: 'new operator comment' } });
      assert.equal(posted.status, 200);
      await page.locator('#count-devunit').waitFor({ state: 'visible' });
      await page.locator('.mac-notice-pending .mac-notice-open[aria-label^="DEV UNIT"]').waitFor();
      await page.locator('.mac-notice-history .mac-notice-open[aria-label^="DEV UNIT"]').waitFor();
      await open(page, 'devunit');
      await page.waitForFunction(() => document.querySelector('#devunit-comments').textContent.includes('new operator comment'));
      await page.locator('#count-devunit').waitFor({ state: 'hidden' });
      await page.locator('#devunit-search').fill('DEV13'); assert.ok(await page.locator('#devunit-readme details').count());
      await shot(page, 'devunit');
    });
    await check('security HOME loads as an independent authenticated page in the app', async () => {
      await open(page, 'securityhome');
      await page.frameLocator('#securityhome-frame').locator('#login').waitFor({ state: 'visible' });
      assert.equal(new URL(page.frames().find(f => f.url().endsWith('/sec/')).url()).pathname, '/sec/');
    });
    await check('all app windows and original DOM IDs stay unique', async () => {
      assert.equal(await page.locator('.mac-window.is-open').count(), 16);
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
    await check('windows move beyond the right and bottom edges and stay recoverable; dragging restores maximized windows', async () => {
      const win = page.locator('#mac-window-players'), bar = win.locator('.mac-titlebar');
      let b = await bar.boundingBox();
      await page.mouse.move(b.x + 180, b.y + 23); await page.mouse.down();
      await page.mouse.move(1370, 760, { steps: 8 }); await page.mouse.up();
      let r = await win.boundingBox(), area = await page.locator('#mac-windows').boundingBox();
      assert.ok(r.x + r.width > area.x + area.width && r.y + r.height > area.y + area.height);
      assert.ok(r.x <= area.x + area.width - 95 && r.y <= area.y + area.height - 50);
      b = await bar.boundingBox(); await page.mouse.move(Math.min(1390, b.x + 110), b.y + 23); await page.mouse.down();
      await page.mouse.move(430, 180, { steps: 8 }); await page.mouse.up();
      await win.locator('.mac-zoom').click();
      await page.waitForFunction(() => Math.abs(document.querySelector('#mac-window-players').getBoundingClientRect().width - (document.querySelector('#mac-windows').clientWidth - 12)) < 2);
      await win.evaluate(n => Promise.all(n.getAnimations().map(a => a.finished.catch(() => {}))));
      b = await bar.boundingBox(); await page.mouse.move(b.x + 200, b.y + 23); await page.mouse.down();
      await page.mouse.move(520, 230, { steps: 8 }); await page.mouse.up();
      assert.equal(await win.evaluate(n => n.classList.contains('is-zoomed')), false);
      assert.ok((await win.boundingBox()).width < area.width - 30);
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
      await menu(page, 'ウインドウを一覧表示'); await page.locator('body.mac-overview').waitFor({ state: 'attached' });
      const count = await page.locator('.mac-window.is-open').count();
      await page.locator('.mac-window.is-open .mac-window-shade').first().click();
      assert.equal(await page.locator('body.mac-overview').count(), 0);
      await page.locator('.mac-dock-home').click(); assert.equal(await page.locator('.mac-window:visible').count(), 0);
      await page.locator('.mac-dock-home').click(); assert.equal(await page.locator('.mac-window:visible').count(), count);
    });
    await check('selection, copying and the native context menu are blocked while typing remains available', async () => {
      await open(page, 'players'); await page.locator('#search').fill('editable input');
      assert.equal(await page.locator('#search').inputValue(), 'editable input');
      const events = await page.evaluate(() => {
        const title = document.querySelector('#mac-window-players .mac-window-title');
        return ['selectstart', 'copy', 'cut', 'contextmenu'].map(type => !title.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })));
      }); assert.deepEqual(events, [true, true, true, true]);
      await page.locator('#search').fill('PlayerQA');
    });
    await check('visible apps have larger dock icons and simple tooltips', async () => {
      await open(page, 'players');
      const scale = await page.locator('#tabs [data-view="players"] img').evaluate(n => getComputedStyle(n).transform);
      assert.notEqual(scale, 'none');
      await page.locator('#tabs [data-view="players"]').hover();
      await page.locator('.mac-tooltip').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.mac-tooltip').textContent(), 'プレイヤー一覧（操作中）');
      await page.mouse.move(5, 5);
    });
    await check('double click enters real browser fullscreen and Escape restores the window', async () => {
      await open(page, 'players');
      const win = page.locator('#mac-window-players');
      await win.locator('.mac-window-title').dblclick();
      await page.waitForFunction(() => document.fullscreenElement === document.querySelector('#app'));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.fullscreenElement && !document.body.classList.contains('mac-fullscreen'));
      assert.equal(await win.evaluate(n => n.classList.contains('is-zoomed')), false);
    });
    await check('background dragging works and does not hijack input interactions', async () => {
      await open(page, 'devunit'); const win = page.locator('#mac-window-devunit');
      const before = await win.boundingBox();
      const text = await win.locator('p.muted').first().boundingBox();
      await page.mouse.move(text.x + 20, text.y + 5); await page.mouse.down(); await page.mouse.move(text.x + 65, text.y + 45, { steps: 5 }); await page.mouse.up();
      const after = await win.boundingBox(); assert.ok(after.x - before.x > 30 && after.y - before.y > 30);
      await page.locator('#devunit-text').fill('draft retained');
      await page.locator('#mac-window-devunit .mac-minimize').click(); await open(page, 'devunit');
      assert.equal(await page.locator('#devunit-text').inputValue(), 'draft retained');
      await page.locator('#devunit-text').fill('');
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
      // Optional upload previews have no resource until a file is selected.
      const paths = await page.evaluate(() => Array.from(new Set(Array.from(document.images).filter(n => n.hasAttribute('src')).map(n => n.src))));
      for (const file of fs.readdirSync(path.resolve(__dirname, '../ops/assets')).filter(f => /\.(png|webp|svg)$/.test(f))) paths.push(new URL('assets/' + file, page.url()).href);
      const failures = await page.evaluate(async paths => {
        const bad = []; for (const src of paths) { const im = new Image(); im.src = src; try { await im.decode(); } catch { bad.push(src); } } return bad;
      }, paths); assert.deepEqual(failures, []);
      await page.keyboard.press('Alt+Space');
      await page.locator('#mac-menu').getByText('予備の背景を使う', { exact: true }).click();
      assert.match(await page.locator('#app').evaluate(n => getComputedStyle(n).backgroundImage), /wallpaper-reserve/);
      await page.keyboard.press('Alt+Space');
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
      assert.equal(await page.locator('#tabs .tab:not([hidden])').count(), 14);
      assert.equal(await page.locator('#tab-pay').isVisible(), false); assert.equal(await page.locator('#speed').isDisabled(), true);
      await open(page, 'vault'); assert.equal(await page.locator('#view-vault').isVisible(), true);
    });
    await check('viewers see their allowed apps including security HOME', async () => {
      await out(page); await signIn(page, 'ViewerQA');
      assert.equal(await page.locator('#tabs .tab:not([hidden])').count(), 8);
      for (const id of ['players', 'archive', 'team', 'pay', 'vault', 'devunit', 'diary', 'profile']) {
        assert.equal(await page.locator('#tabs [data-view="' + id + '"]').isVisible(), false);
        assert.equal(await page.locator('#mac-window-' + id).isVisible(), false);
      }
      assert.equal(await page.locator('.mac-launch-search').count(), 0);
      await shot(page, 'viewer');
    });
    await check('revoking viewer access still signs out the existing session', async () => {
      assert.equal((await devCall('POST', '/api/ops/viewer', { name: 'ViewerQA', action: 'revoke', code })).status, 200);
      await page.locator('#login').waitFor({ state: 'visible', timeout: 10000 }); assert.equal(await page.locator('#app').isVisible(), false);
    });
    await check('touch portrait stays upright with compact windows and readable inputs', async () => {
      const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
      const p = await phone.newPage(); p.on('pageerror', e => errors.push(e.message));
      await p.goto(s.base + '/ops/'); await p.locator('#login').waitFor({ state: 'visible' }); assert.equal(await p.locator('#frame.turned').count(), 0); await shot(p, 'phone-login');
      await signIn(p, 'taku'); await open(p, 'players');
      const box = await p.locator('#mac-window-players').boundingBox(); assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 391 && box.y + box.height <= 845);
      assert.equal(await p.locator('#search').evaluate(n => getComputedStyle(n).fontSize), '16px');
      assert.equal(await p.evaluate(() => document.fullscreenElement), null);
      await p.locator('.mac-notification-toggle').click(); await p.locator('#mac-notifications').waitFor({ state: 'visible' });
      await p.locator('.mac-notice-close').click(); await p.locator('#mac-notifications').waitFor({ state: 'hidden' });
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await shot(p, 'phone-desktop'); await phone.close();
    });
    await check('game rarity artwork is translucent without fading labels; all app icons decode', async () => {
      const game = await context.newPage(); game.on('pageerror', e => errors.push(e.message));
      await game.goto(s.base + '/');
      await game.waitForFunction(() => window.BR && BR.UI_IMG && document.querySelector('style'));
      const result = await game.evaluate(async () => {
        const tierNames = ['green', 'blue', 'purple', 'orange', 'gold', 'red', 'red-gold', 'aqua-purple', 'dark'];
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#34223e;padding:24px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;color:white';
        for (const tier of tierNames) {
          const row = document.createElement('div'); row.className = 'q-row t-' + tier;
          row.style.setProperty('--q-art', 'url("' + BR.UI_IMG.questTiers[tier] + '")');
          const label = document.createElement('strong'); label.textContent = tier; label.style.cssText = 'font-size:22px;opacity:1'; row.appendChild(label); host.appendChild(row);
        }
        document.body.appendChild(host);
        const failures = [];
        const manifest = await fetch('/manifest.webmanifest').then(r => r.json());
        const urls = Object.values(BR.UI_IMG.questTiers).concat(manifest.icons.map(i => i.src), ['icons/icon-180.png']);
        for (const src of urls) { const im = new Image(); im.src = src; try { await im.decode(); } catch { failures.push(src); } }
        return { failures, layers: Array.from(host.children).map(n => ({ art: getComputedStyle(n, '::before').backgroundImage, alpha: getComputedStyle(n, '::before').opacity, label: getComputedStyle(n.firstChild).opacity })) };
      });
      assert.deepEqual(result.failures, []); assert.equal(result.layers.length, 9);
      result.layers.forEach(l => { assert.ok(l.art.includes('.webp')); assert.equal(l.alpha, '0.84'); assert.equal(l.label, '1'); });
      await shot(game, 'quest-rarities'); await game.close();
    });
    await check('no uncaught browser errors', async () => assert.deepEqual(errors, []));
    console.log('PASS ' + checks + ' browser checks; developer, operator and viewer; real local API.');
  } catch (e) {
    console.error('FAIL after ' + checks + ' browser checks:', e);
    throw e;
  } finally { if (browser) await browser.close(); await s.stop(); }
})().catch(() => { process.exitCode = 1; });
