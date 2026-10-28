/* Optional real-browser check of the passkey (server/core/pk.js, ops/pk.js, sec/pk.js):
   the real operator site and the real security base against the real Node server.
     node tools/check_pk.cjs
   Requires Playwright and a Chromium install (OPS_BROWSER_EXECUTABLE can select a
   browser). All accounts and data are disposable. It checks that
     - after the login the page asks for today's six digits and shows nothing else,
     - a wrong passkey says an hour has to pass (and is not asked again meanwhile),
     - the right one opens the page, and from then on every request to the operator
       site is signed, with no key or passkey left in the browser's storage,
     - a page that is reloaded asks again,
     - the security base does the same. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '..');
const KEY = 'check-pk-key-0123456789abcdef0123456789';

(async () => {
  const { startServer } = await import(REPO + '/server/test/helpers.js');
  const { passkeyFor } = await import(REPO + '/server/core/pk.js');
  const { jstDay } = await import(REPO + '/server/core/opsentry.js');
  const s = await startServer({ operators: ['taku'], gateKey: KEY });
  let browser;
  const errors = [];
  try {
    await s.register('taku');
    const right = () => passkeyFor(KEY, jstDay(Date.now()), 0);
    const wrong = () => (right() === '123456' ? '654321' : '123456');
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    async function run(site, appId, loginGo) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', (e) => errors.push(site + ': ' + e.message));
      const calls = [];
      page.on('request', (r) => { if (/\/api\//.test(r.url())) calls.push({ url: new URL(r.url()).pathname, gate: r.headers()['x-gate'] || '' }); });

      await page.goto(s.base + site);
      await page.locator('#login').waitFor({ state: 'visible' });
      await page.locator('#login-name').fill('taku');
      await page.locator('#login-pass').fill('pass1234');
      await page.locator(loginGo).click();

      // the passkey, and nothing of the site behind it
      await page.locator('#pk').waitFor({ state: 'visible' }).catch(async error => {
        console.error('gate entry state', await page.evaluate(() => ({ loginError: document.getElementById('login-error').textContent,
          login: !document.getElementById('login').hidden, gate: !document.getElementById('pk').hidden, app: !document.getElementById('app').hidden })), errors,
          calls.map(c => ({ url: c.url, signed: !!c.gate })));
        throw error;
      });
      assert.equal(await page.locator(appId).isHidden(), true, site + ': the site stays away until the passkey is in');
      assert.match(await page.locator('#pk-day').textContent(), /今日（\d{4}\/\d{2}\/\d{2}）のパスキー/);
      assert.ok((await page.locator('#pk-name').textContent()).toLowerCase().includes('taku'));
      const gated = calls.filter((c) => /^\/api\/(ops|sec|vault|backup|emergency)\//.test(c.url));
      assert.ok(gated.length > 0 && gated.every((c) => !c.gate), site + ': nothing is signed before the passkey');

      // a slip of the fingers is not a try
      await page.locator('#pk-code').fill('12');
      await page.locator('#pk-go').click();
      assert.match(await page.locator('#pk-error').textContent(), /6桁/);
      assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM pk_locks').get().n, 0);

      // a wrong one: an hour
      await page.locator('#pk-code').fill(wrong());
      await page.locator('#pk-go').click();
      await page.waitForFunction(() => /入力できません/.test(document.querySelector('#pk-error').textContent));
      assert.equal(await page.locator('#pk-go').isDisabled(), true);
      assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM pk_locks').get().n, 1);
      assert.equal(await page.locator(appId).isHidden(), true);

      // (the hour is up: the page is opened again, the login is still there)
      s.app.db.prepare('DELETE FROM pk_locks').run();
      await page.reload();
      await page.locator('#pk').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.querySelector('#pk-go').disabled);

      // the right one
      await page.locator('#pk-code').fill(right());
      await page.locator('#pk-go').click();
      await page.locator(appId).waitFor({ state: 'visible' });
      assert.equal(await page.locator('#pk').isHidden(), true);
      await page.waitForTimeout(1200);
      const lastOpen = calls.map((c) => c.url).lastIndexOf('/api/pk/open');
      const after = calls.slice(lastOpen + 1).filter((c) => /^\/api\/(ops|sec|vault|backup|emergency)\//.test(c.url));
      assert.ok(after.length > 0, site + ': the page asks the server for its things');
      assert.ok(after.every((c) => /^[0-9a-f]{32}\.\d{13}\.[\w-]{16,32}\.[\w-]{80,100}$/.test(c.gate)), site + ': every one of them is signed: ' + JSON.stringify(after.filter((c) => !c.gate)));
      assert.equal(new Set(after.map((c) => c.gate.split('.')[2])).size, after.length, 'each with a number of its own');
      assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM pk_gates').get().n >= 1, true);

      // nothing of the passkey or the key is kept in the browser
      const kept = await page.evaluate(async () => {
        const out = { local: Object.assign({}, localStorage), session: Object.assign({}, sessionStorage), idb: [] };
        if (indexedDB.databases) out.idb = (await indexedDB.databases()).map((d) => d.name);
        return out;
      });
      const blob = JSON.stringify(kept);
      assert.ok(!blob.includes(right()) && !/ECDSA|privateKey|"d":/.test(blob), site + ': no passkey or key in storage: ' + blob.slice(0, 300));

      // the page left: the key is lost with it, and the passkey is asked again
      await page.reload();
      await page.locator('#pk').waitFor({ state: 'visible' });
      assert.equal(await page.locator(appId).isHidden(), true, site + ': a reloaded page asks again');

      // another account
      await page.locator('#pk-other').click();
      await page.locator('#login').waitFor({ state: 'visible' });
      await ctx.close();
      console.log(site, 'OK');
    }

    await run('/ops/', '#app', '#login-go');
    s.app.db.prepare('DELETE FROM pk_gates').run();
    await run('/sec/', '#app', '#login-go');
    assert.deepEqual(errors, [], 'no script errors: ' + errors.join(' | '));
    console.log('E2E OK');
  } finally {
    if (browser) await browser.close();
    await s.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
