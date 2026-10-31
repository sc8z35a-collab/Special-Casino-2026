/* Real-browser checks for desktop/vault navigation and wallpaper scheduling.
   BASELINE_REF optionally measures the same actions against an older commit.
   OPS_WORKSPACES_UI_ONLY=1 checks just current apps, roles and the phone layout.
   Uses only a disposable local server/account. Requires Playwright + Chromium. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const { startServer } = await import(path.join(ROOT, 'server/test/helpers.js'));
  const server = await startServer({ operators: ['taku', 'OperatorQA'] });
  let browser;
  try {
    const dev = await server.register('taku');
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
    async function contextFor(ref) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      if (ref) for (const file of ['desktop.js', 'vault-tabs.js']) {
        const source = execFileSync('git', ['show', ref + ':ops/' + file], { cwd: ROOT, encoding: 'utf8' });
        await context.route('**/ops/' + file + '*', (route) => route.fulfill({ contentType: 'text/javascript', body: source }));
      }
      return context;
    }
    async function navigation(ref) {
      const context = await contextFor(ref), page = await context.newPage(), errors = [];
      page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(60000);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(() => {
        localStorage.setItem('two-state-ops/ui/tabs', 'yes');
        localStorage.setItem('two-state-ops/ui/autohide', 'no');
        localStorage.setItem('two-state-ops/ui/glass', 'off');
      });
      await page.goto(server.base + '/ops/', { waitUntil: 'domcontentloaded' });
      await page.locator('#login-name').fill('taku'); await page.locator('#login-pass').fill('pass1234');
      await page.locator('#login-go').click(); await page.locator('#app').waitFor({ state: 'visible' });
      await page.evaluate(() => { OpsBeat.stop(); ['players', 'archive', 'reports'].forEach((id) => OpsDesktop.open(id)); });
      await page.locator('#mac-window-reports.is-active').waitFor({ state: 'visible' });
      const strips = await page.evaluate(async () => {
        const hosts = Array.from(document.querySelectorAll('.mac-window.is-open .mac-window-tabs'));
        const original = hosts.flatMap((host) => Array.from(host.children));
        let addedElements = 0;
        const observer = new MutationObserver((records) => {
          for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) addedElements++;
        });
        hosts.forEach((host) => observer.observe(host, { childList: true, subtree: true }));
        for (let i = 0; i < 20; i++) OpsDesktop.open(i % 2 ? 'players' : 'archive');
        await Promise.resolve(); observer.disconnect();
        const result = { switches: 20, addedElements, retained: original.every((node) => node.isConnected) };
        for (const host of hosts) {
          const tabs = Array.from(host.querySelectorAll('[role="tab"]'));
          if (tabs.length !== 3 || tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true' && tab.tabIndex === 0).length !== 1) throw new Error('invalid desktop tab selection');
          if (tabs.some((tab) => !document.getElementById(tab.getAttribute('aria-controls')))) throw new Error('missing tab panel');
        }
        return result;
      });
      // Navigation must move focus to the selected strip in the newly active window.
      await page.locator('#mac-window-players .mac-tab-switch[aria-selected="true"]').focus();
      await page.keyboard.press('End');
      await page.locator('#mac-window-reports.is-active').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#mac-window-reports [aria-selected="true"]').evaluate((n) => document.activeElement === n), true);
      await page.keyboard.press('ArrowRight');
      await page.locator('#mac-window-players.is-active').waitFor({ state: 'visible' });
      await page.keyboard.press('ArrowLeft');
      await page.locator('#mac-window-reports.is-active').waitFor({ state: 'visible' });
      await page.keyboard.press('Home');
      await page.locator('#mac-window-players.is-active').waitFor({ state: 'visible' });
      await page.locator('#mac-window-players .mac-tab-close[aria-label="アーカイブのタブを閉じる"]').click();
      assert.equal(await page.locator('#mac-window-archive').evaluate((n) => n.classList.contains('is-open')), false);
      await page.evaluate(() => OpsDesktop.open('archive'));
      assert.equal(await page.locator('#mac-window-archive .mac-tab-switch').count(), 3);
      const vault = await page.evaluate(async () => {
        // Exercise the component in a visible fixture, without unlocking a real vault.
        const nav = document.getElementById('vault-work-tabs'), panes = document.getElementById('vault-work-panes'), list = document.getElementById('vault-main');
        const fixture = document.createElement('section'); document.body.appendChild(fixture);
        const positions = [nav, list, panes].map((node) => { const marker = document.createComment('workspace fixture'); node.before(marker); fixture.appendChild(node); return { marker, node }; });
        const api = createVaultTabs(), calls = [];
        function open(key, title = key) {
          return api.open(key, title, {
            show(pane) { calls.push('show:' + key); if (!pane.firstChild) { const input = document.createElement('textarea'); input.value = '下書き'; pane.appendChild(input); } },
            hide() { calls.push('hide:' + key); }, close() { calls.push('close:' + key); }
          });
        }
        const a = open('a'), b = open('b'); open('c');
        const original = Array.from(nav.children); let addedElements = 0;
        const observer = new MutationObserver((records) => {
          for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) addedElements++;
        });
        observer.observe(nav, { childList: true, subtree: true });
        for (let i = 0; i < 20; i++) nav.querySelectorAll('[role="tab"]')[i % 2 + 1].click();
        await Promise.resolve(); observer.disconnect();
        const result = { switches: 20, addedElements, retained: original.every((node) => node.isConnected) };
        function check(value, message) { if (!value) throw new Error(message); }
        check(open('a', '新しい名前') === a, 'opening a tab twice must reuse its panel');
        check(nav.textContent.includes('新しい名前'), 'renamed title missing');
        check(a.querySelector('textarea').value === '下書き', 'draft lost after tab switch');
        for (const button of nav.querySelectorAll('[role="tab"]')) {
          const pane = document.getElementById(button.getAttribute('aria-controls'));
          check(pane.getAttribute('aria-labelledby') === button.id, 'broken vault ARIA panel link');
        }
        let selected = nav.querySelector('[aria-selected="true"]'); selected.focus(); api.refresh();
        result.focusRetainedOnRefresh = document.activeElement === nav.querySelector('[aria-selected="true"]');
        selected = nav.querySelector('[aria-selected="true"]');
        selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        check(!document.getElementById('vault-main').hidden, 'left from first file must select list');
        nav.querySelector('[aria-selected="true"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        check(nav.querySelector('[aria-selected="true"]').textContent === 'c', 'vault keyboard wrapping failed');
        check(document.activeElement === nav.querySelector('[aria-selected="true"]'), 'vault keyboard focus lost');
        const start = calls.length; nav.querySelector('[aria-selected="true"]').nextElementSibling.click();
        check(calls.slice(start).join(',') === 'hide:c,close:c', 'active close must hide and dispose once');
        check(!api.has('c') && !document.getElementById('vault-main').hidden, 'closing active tab did not return to list');
        api.close('b'); check(!b.isConnected, 'closed panel retained');
        check(open('b').id !== b.id, 'reopened panel reused an old DOM id');
        const resetAt = calls.length; api.reset();
        check(calls.slice(resetAt).filter((c) => c.startsWith('close:')).sort().join(',') === 'close:a,close:b', 'reset disposed a tab twice');
        check(nav.querySelectorAll('[role="tab"]').length === 1 && !document.getElementById('vault-work-panes').children.length, 'reset left file tabs behind');
        positions.forEach(({ marker, node }) => marker.replaceWith(node)); fixture.remove();
        return result;
      });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const pointer = await page.evaluate(async () => {
        const dock = document.querySelector('.mac-dock'), buttons = Array.from(dock.querySelectorAll('.tab:not([hidden]), .mac-dock-home, .mac-dock-tool'));
        const target = buttons[0].getBoundingClientRect(); let positionReads = 0;
        const saved = buttons.map((b) => b.getBoundingClientRect);
        buttons.forEach((b, i) => { b.getBoundingClientRect = function () { positionReads++; return saved[i].call(this); }; });
        for (let i = 0; i < 100; i++) dock.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: target.left + target.width / 2, clientY: target.top + target.height / 2 }));
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
        const result = { events: 100, buttons: buttons.length, positionReads, peakScale: Math.max(...buttons.map((b) => Number(b.style.getPropertyValue('--dock-scale')))) };
        dock.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: target.left, clientY: target.top }));
        dock.dispatchEvent(new PointerEvent('pointerleave'));
        await new Promise(requestAnimationFrame);
        if (buttons.some((b) => b.style.getPropertyValue('--dock-scale'))) throw new Error('pending hover restored magnification after leaving');
        buttons.forEach((b) => delete b.getBoundingClientRect);
        return result;
      });
      const resizing = await page.evaluate(async () => {
        const area = document.getElementById('mac-windows'), read = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth').get;
        let widthReads = 0;
        Object.defineProperty(area, 'clientWidth', { configurable: true, get() { widthReads++; return read.call(this); } });
        for (let i = 0; i < 20; i++) dispatchEvent(new Event('resize'));
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
        delete area.clientWidth;
        return { events: 20, openWindows: document.querySelectorAll('.mac-window.is-open').length, widthReads };
      });
      assert.ok(pointer.peakScale >= 1.45 && pointer.peakScale <= 1.5);
      if (!ref) {
        assert.equal(strips.addedElements, 0); assert.equal(strips.retained, true);
        assert.equal(vault.addedElements, 0); assert.equal(vault.retained, true); assert.equal(vault.focusRetainedOnRefresh, true);
        assert.equal(pointer.positionReads, pointer.buttons);
        assert.equal(resizing.widthReads, resizing.openWindows + 1);
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => document.querySelector('.mac-dock').dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 100 })));
      assert.equal(await page.locator('.mac-dock button[style*="--dock-scale"]').count(), 0);
      assert.deepEqual(errors, []);
      await context.close(); return { strips, vault, pointer, resizing };
    }
    async function wallpapers(ref) {
      const context = await contextFor(ref), page = await context.newPage(), errors = [];
      page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(60000); page.on('pageerror', (e) => errors.push(e.message));
      const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, 'ops/assets/wallpapers.json'), 'utf8')).slice(0, 2);
      await context.route('**/ops/assets/wallpapers.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalogue) }));
      await page.clock.install({ time: new Date('2026-10-27T00:00:00Z') });
      await page.addInitScript(({ catalogue }) => {
        const prefix = 'two-state-ops/ui/', current = catalogue[0].id;
        localStorage.setItem(prefix + 'wallmode', 'random'); localStorage.setItem(prefix + 'wallpaper', current);
        localStorage.setItem(prefix + 'wallbag', JSON.stringify({ bag: ['desktop', 'reserve', catalogue[1].id], last: current, at: Date.now(), cycle: 0 }));
        window.wallProbe = { reads: 0, images: 0, hidden: false };
        const read = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) { if (/^two-state-ops\/ui\/(wallmode|wallpaper|wallbag)$/.test(key)) wallProbe.reads++; return read.call(this, key); };
        window.Image = new Proxy(window.Image, { construct(target, args) { wallProbe.images++; return Reflect.construct(target, args); } });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => wallProbe.hidden });
      }, { catalogue });
      await page.goto(server.base + '/ops/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.body.classList.contains('mac-custom-wallpaper'));
      const now = await page.evaluate(() => Date.now()); await page.clock.pauseAt(new Date(now + 1000));
      const remaining = await page.evaluate(() => {
        wallProbe.reads = wallProbe.images = 0;
        return JSON.parse(localStorage.getItem('two-state-ops/ui/wallbag')).at + 600000 - Date.now();
      });
      await page.evaluate(() => { wallProbe.reads = 0; });
      await page.clock.runFor(remaining - 1);
      const quiet = await page.evaluate(() => ({ reads: wallProbe.reads, images: wallProbe.images }));
      if (!ref) assert.deepEqual(quiet, { reads: 0, images: 0 });
      const sequence = [catalogue[0].id];
      await page.clock.runFor(15001);
      sequence.push(await page.evaluate(() => JSON.parse(localStorage.getItem('two-state-ops/ui/wallbag')).last));
      for (let i = 0; i < 3; i++) {
        await page.clock.runFor(600000);
        sequence.push(await page.evaluate(() => JSON.parse(localStorage.getItem('two-state-ops/ui/wallbag')).last));
      }
      assert.equal(new Set(sequence.slice(0, 4)).size, 4, 'each picture must appear once per cycle');
      assert.notEqual(sequence[3], sequence[4], 'a cycle boundary must not repeat a picture');
      const hiddenStart = await page.evaluate(() => {
        wallProbe.hidden = true; document.dispatchEvent(new Event('visibilitychange')); wallProbe.reads = wallProbe.images = 0;
        return localStorage.getItem('two-state-ops/ui/wallbag');
      });
      await page.evaluate(() => { wallProbe.reads = 0; });
      await page.clock.runFor(1200000);
      const hidden = await page.evaluate(() => ({ reads: wallProbe.reads, images: wallProbe.images, bag: localStorage.getItem('two-state-ops/ui/wallbag') }));
      if (!ref) { assert.equal(hidden.bag, hiddenStart); assert.equal(hidden.reads, 0); assert.equal(hidden.images, 0); }
      await page.evaluate(() => { wallProbe.hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
      if (!ref) assert.notEqual(await page.evaluate(() => localStorage.getItem('two-state-ops/ui/wallbag')), hidden.bag, 'returning to the tab must advance an overdue wallpaper');
      // A manual selection in another tab must stop random rotation immediately.
      await page.evaluate(() => {
        localStorage.setItem('two-state-ops/ui/wallmode', 'manual'); localStorage.setItem('two-state-ops/ui/wallpaper', 'reserve');
        dispatchEvent(new StorageEvent('storage', { key: 'two-state-ops/ui/wallmode' }));
      });
      if (!ref) assert.equal(await page.evaluate(() => document.body.classList.contains('mac-reserve-wallpaper')), true);
      const manualStart = await page.evaluate(() => localStorage.getItem('two-state-ops/ui/wallbag'));
      await page.clock.runFor(1200000);
      assert.equal(await page.evaluate(() => localStorage.getItem('two-state-ops/ui/wallbag')), manualStart);
      const staleImageIgnored = await page.evaluate(({ catalogue }) => {
        const pending = []; window.Image = function () { pending.push(this); };
        localStorage.setItem('two-state-ops/ui/wallpaper', catalogue[1].id);
        dispatchEvent(new StorageEvent('storage', { key: 'two-state-ops/ui/wallpaper' }));
        localStorage.setItem('two-state-ops/ui/wallpaper', 'desktop');
        dispatchEvent(new StorageEvent('storage', { key: 'two-state-ops/ui/wallpaper' }));
        for (const image of pending) image.onload();
        return pending.length === 1 && !document.body.classList.contains('mac-custom-wallpaper') && !document.body.classList.contains('mac-reserve-wallpaper');
      }, { catalogue });
      if (!ref) assert.equal(staleImageIgnored, true, 'a slow previous image must not overwrite the latest choice');
      if (!ref) {
        // A corrupt saved timestamp must recover, rather than create a 1ms timer loop.
        const recovered = await page.evaluate(() => {
          localStorage.setItem('two-state-ops/ui/wallmode', 'random');
          localStorage.setItem('two-state-ops/ui/wallbag', JSON.stringify({ bag: [], last: 'desktop', at: 'invalid', cycle: 0 }));
          dispatchEvent(new StorageEvent('storage', { key: 'two-state-ops/ui/wallbag' }));
          return JSON.parse(localStorage.getItem('two-state-ops/ui/wallbag'));
        });
        assert.equal(Number.isFinite(recovered.at), true);
        const futureClock = await page.evaluate(() => {
          const bag = JSON.parse(localStorage.getItem('two-state-ops/ui/wallbag')); bag.at = Date.now() + 600000;
          localStorage.setItem('two-state-ops/ui/wallbag', JSON.stringify(bag));
          document.dispatchEvent(new Event('visibilitychange'));
          return JSON.parse(localStorage.getItem('two-state-ops/ui/wallbag')).at === Date.now();
        });
        assert.equal(futureClock, true, 'clock rollback must recover the next wallpaper deadline');
      }
      assert.deepEqual(errors, []); await context.close();
      return { quietBeforeDeadline: quiet, hiddenTwentyMinutes: { reads: hidden.reads, images: hidden.images, bagUnchanged: hidden.bag === hiddenStart }, cycleUnique: true, staleImageIgnored };
    }
    async function check(ref) {
      const nav = await navigation(ref); console.log('PASS ' + (ref || 'current') + ' desktop/vault navigation and pointer batching');
      const walls = await wallpapers(ref); console.log('PASS ' + (ref || 'current') + ' wallpaper cycles, deadlines and lifecycle');
      return { navigation: nav, wallpapers: walls };
    }
    async function surfaces() {
      await server.register('OperatorQA'); await server.register('ViewerQA');
      const code = '987654321098';
      assert.equal((await server.call('POST', '/api/ops/dev-code', { token: dev.token, body: { code } })).status, 200);
      assert.equal((await server.call('POST', '/api/ops/viewer', { token: dev.token, body: { code, name: 'ViewerQA', action: 'grant' } })).status, 200);
      const all = ['players', 'archive', 'reports', 'detections', 'feedback', 'log', 'operators', 'team', 'security', 'server', 'pay', 'vault', 'devunit', 'securityhome', 'diary', 'profile', 'calendar', 'devapp', 'corp'];
      const result = [];
      for (const [name, allowed] of [
        ['taku', all],
        ['OperatorQA', all.filter((id) => !['pay', 'diary', 'devapp'].includes(id))],
        ['ViewerQA', ['reports', 'detections', 'feedback', 'log', 'operators', 'security', 'server', 'securityhome', 'calendar', 'corp']]
      ]) {
        const context = await contextFor(null), page = await context.newPage(), errors = [];
        page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(60000); page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(() => { localStorage.setItem('two-state-ops/ui/autohide', 'no'); localStorage.setItem('two-state-ops/ui/glass', 'off'); });
        await page.goto(server.base + '/ops/', { waitUntil: 'domcontentloaded' });
        await page.locator('#login-name').fill(name); await page.locator('#login-pass').fill('pass1234');
        await page.locator('#login-go').click(); await page.locator('#app').waitFor({ state: 'visible' });
        const permitted = await page.locator('#tabs .tab:not([hidden])').evaluateAll((tabs) => tabs.map((tab) => tab.dataset.view).sort());
        assert.deepEqual(permitted, [...allowed].sort(), name + ' permissions');
        for (const id of allowed) {
          await page.evaluate((id) => OpsDesktop.open(id), id);
          await page.locator('#mac-window-' + id + '.is-active').waitFor({ state: 'visible' });
          assert.equal(await page.locator('#view-' + id).isVisible(), true, name + ' opens ' + id);
        }
        for (const id of all.filter((id) => !allowed.includes(id))) {
          await page.evaluate((id) => OpsDesktop.open(id), id);
          assert.equal(await page.locator('#mac-window-' + id).isVisible(), false, name + ' cannot open ' + id);
        }
        assert.deepEqual(await page.evaluate(() => {
          const ids = Array.from(document.querySelectorAll('[id]')).map((n) => n.id);
          return ids.filter((id, i) => ids.indexOf(id) !== i);
        }), [], 'every original DOM ID remains unique');
        if (name === 'taku') {
          await page.evaluate(() => OpsDesktop.open('players')); await page.locator('#search').fill('未送信の検索');
          await page.evaluate(() => OpsDesktop.open('archive')); await page.evaluate(() => OpsDesktop.open('players'));
          await page.locator('#mac-window-players .mac-minimize').click();
          await page.locator('#mac-window-players').waitFor({ state: 'hidden' });
          await page.evaluate(() => OpsDesktop.open('players'));
          assert.equal(await page.locator('#search').inputValue(), '未送信の検索');
          await page.locator('#mac-window-players .mac-zoom').click();
          await page.waitForFunction(() => Math.abs(document.querySelector('#mac-window-players').getBoundingClientRect().width - (document.getElementById('mac-windows').clientWidth - 12)) < 2);
          await page.locator('#mac-window-players .mac-zoom').click();
          await page.setViewportSize({ width: 390, height: 844 }); await page.locator('body.mac-phone').waitFor({ state: 'attached' });
          await page.locator('.mac-nav-home').click(); await page.locator('body.mac-phone-home').waitFor({ state: 'attached' });
          await page.locator('.mac-home-grid [data-view="players"]').click();
          await page.locator('#mac-window-players.is-active').waitFor({ state: 'visible' });
          const bounds = await page.locator('#mac-window-players').boundingBox();
          assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845);
          assert.equal(await page.locator('#search').evaluate((n) => getComputedStyle(n).fontSize), '16px');
          await page.locator('.mac-nav-switch').click(); await page.locator('.mac-switch-go').first().click();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await page.setViewportSize({ width: 1440, height: 900 }); await page.locator('body.mac-phone').waitFor({ state: 'detached' });
          assert.equal(await page.locator('.mac-dock #tabs').count(), 1, 'desktop restores its original app navigation after a phone resize');
        }
        await page.evaluate(() => document.getElementById('logout').click()); await page.locator('#login').waitFor({ state: 'visible' });
        assert.equal(await page.locator('.mac-window.is-open').count(), 0, 'logout clears the previous session windows');
        assert.deepEqual(errors, []); await context.close();
        result.push({ role: name, authorizedApps: allowed.length, unauthorizedAppsBlocked: all.length - allowed.length, uniqueIds: true, logoutClearsWindows: true });
        console.log('PASS ' + name + ' current apps, permissions and session lifecycle');
      }
      return { roles: result, desktopPhoneRoundTrip: true, draftRetained: true, minimizeRestore: true, maximizeRestore: true };
    }
    const onlyUI = process.env.OPS_WORKSPACES_UI_ONLY === '1';
    const before = !onlyUI && process.env.BASELINE_REF ? await check(process.env.BASELINE_REF) : null;
    const after = onlyUI ? null : await check(null);
    const ui = await surfaces();
    const report = { baselineCommit: process.env.BASELINE_REF || null, before, after, surfaces: ui };
    if (process.env.OPS_WORKSPACES_REPORT) fs.writeFileSync(process.env.OPS_WORKSPACES_REPORT, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { if (browser) await browser.close(); await server.stop(); }
})().catch((error) => { console.error(error); process.exit(1); });
