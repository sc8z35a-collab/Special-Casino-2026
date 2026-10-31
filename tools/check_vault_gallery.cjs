/* Real-browser regression: compact previews, selection, folder totals and the
   narrowly scoped sharing clipboard exception. All data is disposable. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { chromium } = require('playwright');
(async () => {
  const { startServer } = await import('../server/test/helpers.js');
  const s = await startServer({ limits: { general: [100000, 1000], vaultWork: [100000, 1000], vaultPull: [100000, 1000] } });
  let browser, checks = 0;
  const code = '987654321098', errors = [], requests = [];
  const pic = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhYQAAAAASUVORK5CYII=';
  try {
    const dev = await s.register('taku');
    const call = (method, url, body) => s.call(method, url, { token: dev.token, body, headers: ticket ? { 'X-Vault-Ticket': ticket } : {} });
    let ticket = '';
    assert.equal((await call('POST', '/api/ops/dev-code', { code })).status, 200);
    ticket = (await call('POST', '/api/vault/open', { code })).ticket;
    async function put(name, data, folder = '', extra = {}) {
      const r = await call('POST', '/api/vault/files', { name, size: data.length, type: 'application/octet-stream', folder, ...extra }); assert.equal(r.status, 200);
      const sha256 = crypto.createHash('sha256').update(data).digest('hex');
      assert.equal((await call('POST', '/api/vault/chunk', { id: r.file.id, n: 0, sha256, data: data.toString('base64') })).status, 200);
      assert.equal((await call('POST', '/api/vault/finish', { id: r.file.id })).status, 200);
      return r.file;
    }
    const folder = (await call('POST', '/api/vault/folders', { name: 'Gallery folder' })).folder;
    const child = (await call('POST', '/api/vault/folders', { name: 'Nested', parent: folder.id })).folder;
    const model = await put('Folder model.glb', Buffer.alloc(15), folder.id);
    await put('Folder model.light.glb', Buffer.alloc(10), '', { parent: model.id });
    await put('nested.txt', Buffer.alloc(25), child.id);
    for (let i = 0; i < 61; i++) await put('item-' + String(i).padStart(2, '0') + '.txt', Buffer.from('a'));
    const f = await put('preview-model.glb', Buffer.from('glTF'));
    assert.equal((await call('POST', '/api/vault/meta', { id: f.id, preview: pic, thumbnail: pic, info: { triangles: 1 } })).status, 200);
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
    await page.goto(s.base + '/ops/');
    await page.locator('#login-name').fill('taku'); await page.locator('#login-pass').fill('pass1234'); await page.locator('#login-go').click();
    await page.locator('#app').waitFor({ state: 'visible' });
    // Isolate the gallery from the hot-corner notification pane, as closing it from its own button does.
    await page.evaluate(() => document.querySelector('.mac-notice-close').click());
    await page.locator('#tabs [data-view="vault"]').click(); await page.locator('#mac-window-vault').waitFor();
    await page.locator('#mac-window-vault .mac-zoom').click();
    await page.locator('#vault-unlock').click(); await page.locator('#dialog-input').fill(code); await page.locator('#dialog-ok').click();
    await page.locator('#dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelectorAll('#vault-list .vitem').length === 60);
    async function check(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
    await check('the list packs at least six square previews across and never downloads a model', async () => {
      const rects = await page.locator('#vault-list .vicon').evaluateAll(ns => ns.map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
      assert.ok(new Set(rects.map(r => Math.round(r.x))).size >= 6);
      rects.forEach(r => assert.ok(Math.abs(r.width - r.height) < 1));
      assert.equal(await page.locator('#vault-list canvas').count(), 0);
      assert.ok(!requests.some(url => /vault3d\.js|\/api\/vault\/chunk/.test(url)));
    });
    await check('select all checks every visible file and folder, survives paging, and toggles off', async () => {
      await page.locator('#vault-pick-all').check();
      assert.equal(await page.locator('#vault-list [data-vpick]:checked').count(), 60);
      assert.equal(await page.locator('#vault-folders [data-vpick]:checked').count(), 1);
      assert.equal(await page.locator('#vault-list .picked').count(), 60);
      const alpha = await page.locator('#vault-list .vault-check i').first().evaluate(n => getComputedStyle(n, '::after').opacity); assert.equal(alpha, '1');
      await page.locator('#vault-pager [data-page="1"]').first().click();
      assert.equal(await page.locator('#vault-list [data-vpick]:checked').count(), 2);
      await page.locator('#vault-pick-all').uncheck();
      assert.equal(await page.locator('#vault-list [data-vpick]:checked').count(), 0);
      await page.locator('#vault-pager [data-page="0"]').first().click();
      assert.equal(await page.locator('#vault-list [data-vpick]:checked').count(), 0);
      await page.locator('#vault-list [data-vpick]').first().check(); assert.equal(await page.locator('#vault-pick-all').evaluate(n => n.indeterminate), true);
      await page.locator('#vault-pick-all').check(); await page.locator('#vault-pick-all').uncheck();
    });
    await check('folder details include nested files and light versions exactly once', async () => {
      await page.locator('#vault-folders [data-vact="details"]').click();
      const details = page.locator('#vault-work-panes .vault-work-pane:not([hidden])');
      await details.waitFor({ state: 'visible' });
      assert.match(await details.textContent(), /50バイト/);
      const facts = await details.locator('.facts > div').evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => [node.querySelector('span').textContent, node.querySelector('b').textContent])));
      assert.equal(facts['ファイル'], '3件');
      assert.equal(facts['サブフォルダ'], '1件');
      // a tap anywhere that is not a control puts the details away (back to the list)
      await details.locator('h3').click();
      await details.waitFor({ state: 'detached' });
      assert.equal(await page.locator('#vault-main').isVisible(), true);
      assert.equal(await page.locator('#vault-work-tabs [role="tab"]').count(), 1);
    });
    await check('only the generated sharing URL can be copied, including the fallback clipboard path', async () => {
      const card = page.locator('#vault-list .vitem').first();
      await card.locator('.vmore').click(); await page.locator('#vmenu [data-mact="link"]').click();
      await page.locator('#dialog-ok').click();
      await page.locator('#dialog-input[data-vault-share-url]').waitFor();
      const url = await page.locator('#dialog-input').inputValue(); const shared = new URL(url); assert.equal(shared.origin, s.base); assert.equal(shared.pathname, '/link/'); assert.equal(shared.search, ''); assert.ok(shared.hash.length > 20);
      await page.evaluate(() => {
        window.copiedURL = '';
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedURL = text; } } });
      });
      await page.locator('.vault-share-copy').click(); assert.equal(await page.evaluate(() => window.copiedURL), url);
      assert.equal(await page.locator('#dialog-input').evaluate(n => n.dispatchEvent(new Event('copy', { bubbles: true, cancelable: true }))), true);
      assert.equal(await page.locator('#vault-title').evaluate(n => n.dispatchEvent(new Event('copy', { bubbles: true, cancelable: true }))), false);
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('denied'); } } });
        window.fallbackCopyAllowed = false;
        document.execCommand = cmd => { window.fallbackCopyAllowed = cmd === 'copy' && document.activeElement.dispatchEvent(new Event('copy', { bubbles: true, cancelable: true })); return window.fallbackCopyAllowed; };
      });
      await page.locator('.vault-share-copy').click(); assert.equal(await page.evaluate(() => window.fallbackCopyAllowed), true);
      await page.locator('#dialog-ok').click();
      assert.equal(await page.locator('#dialog-input').getAttribute('data-vault-share-url'), null);
    });
    await check('thumbnail encoding stays at most 144 square pixels and below 24KB', async () => {
      const result = await page.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = c.height = 1024;
        const ctx = c.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 1024, 1024);
        const src = await VaultThumbnails.make(c.toDataURL()); const image = new Image(); image.src = src; await image.decode();
        return { size: src.length, width: image.naturalWidth, height: image.naturalHeight };
      }); assert.ok(result.size < 24 * 1024); assert.ok(result.width <= 144); assert.equal(result.width, result.height);
      await page.locator('#vault-list [data-file="' + f.id + '"] .has-thumbnail').waitFor();
    });
    await check('phone gallery stays within its viewport with square static pictures', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.querySelector('#mac-windows').clientWidth === 390);
      const r = await page.locator('#vault-list .vicon').first().boundingBox(); assert.ok(Math.abs(r.width - r.height) < 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator('#vault-list canvas').count(), 0);
    });
    if (process.env.OPS_VAULT_SCREENSHOTS) {
      fs.mkdirSync(process.env.OPS_VAULT_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: process.env.OPS_VAULT_SCREENSHOTS + '/phone.png' });
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: process.env.OPS_VAULT_SCREENSHOTS + '/desktop.png' });
    }
    assert.deepEqual(errors, []); console.log('PASS ' + checks + ' vault gallery checks; no browser errors');
  } finally { if (browser) await browser.close(); await s.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
