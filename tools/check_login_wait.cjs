/* Optional real-browser check of the operator site's login wait (server/core/opslogin.js, ops/ops.js)
   against the real Node server:
     node tools/check_login_wait.cjs
   Requires Playwright and a Chromium install (OPS_BROWSER_EXECUTABLE can select a browser).
   Disposable data. It checks that
     - two wrong tries on a name show a countdown that the SERVER counts,
     - the countdown is still there after the page is reloaded (it asked the server again),
     - another browser (a new browser id) sees the same wait for that name, and not for another name,
     - the wrong tries are in the operators' log with what the browser reported, and not the password. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '..');

(async () => {
  const { startServer } = await import(REPO + '/server/test/helpers.js');
  const s = await startServer({ operators: ['taku', 'taku2'], limits: { general: [100000, 1000], loginWait: [100000, 1000] } });
  let browser;
  const errors = [];
  try {
    await s.register('taku2');
    await s.register('Other');
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const open = async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
      await page.goto(s.base + '/ops/');
      await page.locator('#login-name').waitFor({ state: 'visible' });
      return page;
    };
    const tryLogin = async (page, name, pass) => {
      await page.locator('#login-name').fill(name);
      await page.locator('#login-pass').fill(pass);
      await page.locator('#login-go').click();
    };
    const shown = (page) => page.locator('#login-error').innerText();
    const waitText = async (page, re) => {
      await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#login-error').textContent), re.source);
      return shown(page);
    };

    const page = await open();
    await tryLogin(page, 'taku2', 'wrong-1');
    assert.match(await waitText(page, /あと1回間違えると/), /5分間/);
    await page.locator('#login-pass').fill('');
    await tryLogin(page, 'taku2', 'wrong-2');
    let text = await waitText(page, /入力制限中です。あと 4分5\d秒/);
    assert.match(text, /このアカウント/);
    assert.equal(await page.locator('#login-go').isDisabled(), true);
    console.log('PASS two wrong tries: the account waits, with a countdown (' + text + ')');

    // the reload that used to make the count disappear
    await page.reload();
    await page.locator('#login-name').waitFor({ state: 'visible' });
    text = await waitText(page, /入力制限中です。あと [34]分\d\d秒/);
    assert.equal(await page.locator('#login-name').inputValue(), 'taku2', 'the name tried in this tab comes back');
    assert.equal(await page.locator('#login-go').isDisabled(), true);
    console.log('PASS after a reload the wait is still there, from the server (' + text + ')');

    // another browser (a new browser id): the same wait for that name…
    const other = await open();
    await other.locator('#login-name').fill('taku2');
    await waitText(other, /このアカウントは入力制限中です/);
    // …and none for another name
    await other.locator('#login-name').fill('Other');
    await other.waitForFunction(() => !document.querySelector('#login-go').disabled);
    assert.equal((await shown(other)).includes('入力制限'), false);
    console.log('PASS another browser sees the same wait for that name only');

    // the log
    const rows = s.app.db.prepare("SELECT * FROM ops_log WHERE action LIKE 'login_%' ORDER BY id").all().map((r) => ({ ...r, detail: JSON.parse(r.detail) }));
    assert.deepEqual(rows.map((r) => r.action), ['login_fail', 'login_lock']);
    const d = rows[1].detail.login;
    assert.equal(d.reported.page, 'ops');
    assert.ok(d.reported.screen && d.reported.screen.w === 1280, 'the screen, as the browser said it');
    assert.ok(d.reported.tz, 'the time zone');
    assert.ok(/Chrom/.test(d.net.headers['user-agent']), 'the browser, as its headers say it');
    assert.equal(d.reported.fresh, true, 'a browser with no id yet');
    assert.ok(!JSON.stringify(rows).includes('wrong-1') && !JSON.stringify(rows).includes('wrong-2'), 'never the password');
    console.log('PASS the wrong tries are in the log with the device\'s details, not the password');

    assert.deepEqual(errors, []);
    console.log('LOGIN WAIT OK');
  } finally {
    if (browser) await browser.close();
    await s.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
