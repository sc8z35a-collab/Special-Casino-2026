/* Optional real-browser check of the extension host's page side (ops/ext.js,
   server/core/ext.js) against the real Node server, with a sample part made for
   the check (the game has none):
     node tools/check_ext.cjs
   Requires Playwright and a Chromium install (OPS_BROWSER_EXECUTABLE can select a
   browser). Disposable data. It checks that
     - the part's script comes into the page by a ticket and registers its hooks,
     - a file picked for the vault is held for the hook (nothing is sent, the sending
       engine passes it by) and goes on only when the hook lets it,
     - a file the hook refuses ends there, for good, with the hook's words,
     - the server holds a file back that was not cleared (the end of the upload),
     - the part's item in the account menu is there and works,
     - a log out starts the page over. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '..');
const CODE = '987654321098';

// what the part's script does in the page
const SCRIPT = `(function () {
  window.__seen = [];
  window.__releases = [];
  OpsExt.hook('beforeSend', function (job, file, io) {
    window.__seen.push(job.name);
    if (/blocked/.test(job.name)) return Promise.reject(new Error('refused by the sample'));
    return new Promise(function (ok) {
      window.__releases.push(function () { io.request('POST', '/api/ops/x/clear', { file: job.id }).then(ok); });
    });
  });
  OpsExt.menu('サンプルの項目', function () { window.__menu = (window.__menu || 0) + 1; });
})();`;

const sample = {
  id: 'sample', version: '1', guards: ['upload'],
  migrations: [['CREATE TABLE x_clear (file_id TEXT PRIMARY KEY, at INTEGER NOT NULL)']],
  routes: ({ q }) => ({
    'POST /api/ops/x/clear': async (req) => { const b = await req.json(); q('INSERT OR IGNORE INTO x_clear (file_id, at) VALUES (?, ?)').run(String(b.file), Date.now()); return { ok: true }; }
  }),
  hooks: { finish(info, ctx) { if (!ctx.q('SELECT 1 AS x FROM x_clear WHERE file_id = ?').get(info.file.id)) throw new ctx.ApiError(403, 'refused', 'not cleared'); } },
  assets: { 'check.js': { body: SCRIPT } },
  boot: () => ['check.js']
};

(async () => {
  const { startServer } = await import(REPO + '/server/test/helpers.js');
  const s = await startServer({ operators: ['taku'], extensions: [sample], limits: { general: [100000, 1000], vaultWork: [100000, 1000], vaultPull: [100000, 1000] } });
  let browser;
  const errors = [];
  const row = (name) => s.app.db.prepare('SELECT * FROM vault_files WHERE name = ?').get(name);
  const pieces = () => s.app.db.prepare('SELECT COUNT(*) AS n FROM vault_chunks').get().n;
  try {
    await s.register('taku');
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(s.base + '/ops/');
    await page.locator('#login-name').fill('taku');
    await page.locator('#login-pass').fill('pass1234');
    await page.locator('#login-go').click();
    await page.locator('#app').waitFor({ state: 'visible' });
    // the part's script came in by its ticket and registered
    await page.waitForFunction(() => Array.isArray(window.__seen));
    console.log('PASS the part\'s script is in the page and has registered its hooks');

    // the developer's vault open, two files picked
    assert.equal((await s.call('POST', '/api/ops/dev-code', { token: (await s.call('POST', '/api/login', { body: { name: 'taku', password: 'pass1234' } })).token, body: { code: CODE } })).devCodeSet, true);
    await page.locator('#tabs [data-view="vault"]').click();
    await page.locator('#mac-window-vault').waitFor();
    await page.locator('#vault-unlock').click();
    await page.locator('#dialog-input').fill(CODE);
    await page.locator('#dialog-ok').click();
    await page.locator('#dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => /編集できます/.test(document.querySelector('#mac-window-vault').innerText));
    await page.locator('#vault-file').setInputFiles([
      { name: 'fine.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('fine bytes') },
      { name: 'blocked.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('blocked bytes') }
    ]);
    await page.waitForFunction(() => window.__seen.length === 2 && window.__releases.length === 1).catch(async (e) => {
      console.log('DEBUG seen:', await page.evaluate(() => JSON.stringify(window.__seen)), 'errors:', errors);
      console.log('DEBUG vault text:', (await page.locator('#mac-window-vault').innerText()).slice(0, 600));
      await page.screenshot({ path: process.env.CHECK_SHOT || '/tmp/check_ext.png' });
      throw e;
    });
    // held: on the server as unfinished files, nothing sent
    await new Promise((r) => setTimeout(r, 1500));
    assert.ok(row('fine.bin') && !row('fine.bin').done_at, 'the file has its place');
    assert.equal(pieces(), 0, 'nothing is sent while the hook has not answered');
    console.log('PASS a picked file is held for the hook: nothing is sent');

    // the refused one ends there, with the hook\'s words
    await page.waitForFunction(() => /refused by the sample/.test(document.body.textContent));
    console.log('PASS a file the hook refuses ends there with its words');

    // released: it goes on and is whole
    let attemptedPieces = 0, restarted = 0;
    await page.route('**/api/vault/piece?*', route => {
      if (++attemptedPieces === 1) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"truncated":' });
      return route.continue();
    });
    page.on('request', r => { if (new URL(r.url()).pathname === '/api/vault/restart') restarted++; });
    await page.evaluate(() => window.__releases.forEach((f) => f()));
    await page.waitForFunction((n) => true, null);
    for (let i = 0; i < 100 && !(row('fine.bin') && row('fine.bin').done_at); i++) await new Promise((r) => setTimeout(r, 200));
    assert.ok(row('fine.bin').done_at, 'released: whole');
    assert.ok(!row('blocked.bin') || !row('blocked.bin').done_at, 'the refused one was never finished');
    assert.equal(attemptedPieces, 2, 'an uncertain piece is retried instead of being acknowledged');
    assert.equal(restarted, 0, 'a malformed success must not force a complete upload restart');
    console.log('PASS released, the file is sent and finished (the server found it cleared)');

    // the part\'s item in the account menu
    await page.locator('.mac-profile').evaluate((n) => n.click());
    await page.locator('.mac-account-item', { hasText: 'サンプルの項目' }).evaluate((n) => n.click());
    assert.equal(await page.evaluate(() => window.__menu), 1);
    console.log('PASS the part\'s item is in the account menu and works');

    // a log out starts the page over (the login says why)
    await page.locator('.mac-profile').evaluate((n) => n.click());
    await page.locator('#logout').evaluate((n) => n.click());
    await page.locator('#login').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => typeof window.__seen), 'undefined', 'a new page: nothing of the last person\'s is left');
    console.log('PASS a log out starts the page over');
    assert.deepEqual(errors, []);
    console.log('EXT OK');
  } finally {
    if (browser) await browser.close();
    await s.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
