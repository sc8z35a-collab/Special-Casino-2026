/* Optional real-browser check of the vault's small pictures (ops/vault-thumbnails.js, ops/ops.js)
   against the real Node server:
     node tools/check_vault_previews.cjs
   Requires Playwright and a Chromium install (OPS_BROWSER_EXECUTABLE can select a browser). Disposable data.
   It checks that
     - every kind of file (an image, a video, a sound, a text, a program, a zip, an APK with an icon, an
       office file with its own thumbnail, a PDF, a file nobody knows, one that is broken) gets a small picture
       and a medium one in a few KB, from the file in hand: never a failure, a card at worst,
     - files put into the vault from the page all end with their pictures saved on the server,
     - the list shows a picture for each one by asking for them in one request, and downloads no file,
     - the enlarged view shows the medium picture (a few KB), not the original, which comes only on the button. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const REPO = path.resolve(__dirname, '..');
const CODE = '987654321098';

// what the page is asked to make (run in the page)
async function makeFiles() {
  const png = (w, h, a, b) => new Promise((ok) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, a); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(w / 4, h / 4, w / 2, h / 2); c.toBlob(ok, 'image/png'); });
  const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const deflate = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  // a zip by hand: stored (method 0) or deflated (method 8)
  const zip = async (entries) => {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.name), packed = e.deflate ? await deflate(e.data) : e.data, method = e.deflate ? 8 : 0;
      const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, method, true); lh.setUint32(18, packed.length, true); lh.setUint32(22, e.data.length, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, packed);
      const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(10, method, true); ch.setUint32(20, packed.length, true); ch.setUint32(24, e.data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + packed.length;
    }
    const size = central.reduce((n, p) => n + p.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)]);
  };
  const wav = () => { const n = 8000, d = new DataView(new ArrayBuffer(44 + n * 2)); const w = (o, s) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0))); w(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, n, true); d.setUint32(28, n * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, n * 2, true); for (let i = 0; i < n; i++) d.setInt16(44 + i * 2, Math.sin(i / 20) * 12000 * Math.sin(i / 1500), true); return new Blob([d.buffer], { type: 'audio/wav' }); };
  const video = () => new Promise((ok, no) => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d'); const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' }); const out = []; rec.ondataavailable = (e) => out.push(e.data); rec.onstop = () => ok(new Blob(out, { type: 'video/webm' })); rec.onerror = no; rec.start(); let i = 0; const t = setInterval(() => { x.fillStyle = `hsl(${i * 30},70%,50%)`; x.fillRect(0, 0, 320, 180); x.fillStyle = '#fff'; x.fillRect(20 + i * 8, 60, 60, 60); if (++i > 14) { clearInterval(t); rec.stop(); } }, 70); });
  const icon = await bytes(await png(96, 96, '#e63', '#36c'));
  return [
    ['photo.png', await png(1600, 1000, '#08f', '#f80'), 'kimg'],
    ['clip.webm', await video(), 'kvid'],
    ['tone.wav', wav(), 'kaud'],
    ['notes.txt', new Blob(['first line\nsecond line\nthird line\n'.repeat(5)], { type: 'text/plain' }), 'ktext'],
    ['main.js', new Blob(['export function main() {\n  return 42;\n}\n'], { type: 'text/javascript' }), 'kcode'],
    ['pack.zip', await zip([{ name: 'a/one.txt', data: new TextEncoder().encode('1') }, { name: 'b/two.txt', data: new TextEncoder().encode('2') }]), 'kzip'],
    ['app.apk', await zip([{ name: 'AndroidManifest.xml', data: new Uint8Array(40) }, { name: 'res/mipmap-xxxhdpi/ic_launcher.png', data: icon, deflate: true }, { name: 'classes.dex', data: new Uint8Array(100) }]), 'kapk'],
    ['report.docx', await zip([{ name: '[Content_Types].xml', data: new Uint8Array(10) }, { name: 'docProps/thumbnail.png', data: icon }]), 'koth'],
    ['paper.pdf', new Blob(['%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF'], { type: 'application/pdf' }), 'koth'],
    ['mystery.bin', new Blob([new Uint8Array(3000).map((_, i) => i * 7)]), 'koth'],
    ['broken.png', new Blob([new Uint8Array(500).fill(7)], { type: 'image/png' }), 'kimg']
  ].map(([name, blob, kind]) => ({ name, blob, kind }));
}

(async () => {
  const { startServer } = await import(REPO + '/server/test/helpers.js');
  const s = await startServer({ operators: ['taku'], limits: { general: [100000, 1000], vaultWork: [100000, 1000], vaultPull: [100000, 1000], loginWait: [100000, 1000] } });
  let browser;
  const errors = [], requests = [];
  try {
    await s.register('taku');
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    page.on('request', (r) => requests.push(r.url().replace(s.base, '')));
    if (process.env.CHECK_DEBUG) page.on('response', async (r) => { if (/\/api\/vault\/(meta|finish)/.test(r.url())) console.log('DEBUG', r.status(), r.url().replace(s.base, ''), (await r.text()).slice(0, 200)); });
    await page.goto(s.base + '/ops/');
    await page.locator('#login-name').waitFor({ state: 'visible' });

    // 1. every kind of file: pictures in a few KB, never a failure
    const made = await page.evaluate(async (src) => {
      const files = await (new Function('return (' + src + ')')())();
      const out = [];
      for (const f of files) {
        const t0 = performance.now();
        const p = await VaultThumbnails.fromFile(new File([f.blob], f.name, { type: f.blob.type }), f.kind);
        out.push({ name: f.name, thumbnail: p.thumbnail.length, preview: p.preview.length, card: !!p.card, ms: Math.round(performance.now() - t0), head: p.thumbnail.slice(0, 22) });
      }
      return out;
    }, makeFiles.toString());
    for (const m of made) {
      assert.ok(/^data:image\/(webp|jpeg)/.test(m.head), m.name + ': a picture');
      assert.ok(m.thumbnail > 100 && m.thumbnail <= 8 * 1024, `${m.name}: the list's picture is ${m.thumbnail} characters`);
      assert.ok(m.preview > 100 && m.preview <= 64 * 1024, `${m.name}: the enlarged picture is ${m.preview} characters`);
    }
    const real = made.filter((m) => !m.card).map((m) => m.name);
    for (const name of ['photo.png', 'clip.webm', 'tone.wav', 'app.apk', 'report.docx']) assert.ok(real.includes(name), name + ' shows something of its own, not a card (' + real.join(', ') + ')');
    for (const name of ['notes.txt', 'main.js', 'pack.zip', 'paper.pdf', 'mystery.bin', 'broken.png']) assert.ok(!real.includes(name), name + ' has a card');
    console.log('PASS every kind of file gets pictures (' + made.map((m) => `${m.name} ${(m.thumbnail / 1024).toFixed(1)}K/${(m.preview / 1024).toFixed(1)}K${m.card ? ' card' : ''}`).join(', ') + ')');

    // 2. put some into the vault from the page
    await page.locator('#login-name').fill('taku'); await page.locator('#login-pass').fill('pass1234'); await page.locator('#login-go').click();
    await page.locator('#app').waitFor({ state: 'visible' });
    assert.equal((await s.call('POST', '/api/ops/dev-code', { token: (await s.call('POST', '/api/login', { body: { name: 'taku', password: 'pass1234' } })).token, body: { code: CODE } })).devCodeSet, true);
    await page.locator('#tabs [data-view="vault"]').click({ force: true });
    await page.locator('#mac-window-vault').waitFor();
    await page.locator('#vault-unlock').click();
    await page.locator('#dialog-input').fill(CODE);
    await page.locator('#dialog-ok').click();
    await page.locator('#dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => /編集できます/.test(document.querySelector('#mac-window-vault').innerText));
    const names = ['photo.png', 'notes.txt', 'paper.pdf', 'app.apk', 'mystery.bin'];
    const files = await page.evaluate(async (src) => {
      const list = await (new Function('return (' + src + ')')())();
      window.__files = list.filter((f) => ['photo.png', 'notes.txt', 'paper.pdf', 'app.apk', 'mystery.bin'].includes(f.name));
      return window.__files.map((f) => f.name);
    }, makeFiles.toString());
    assert.deepEqual(files.sort(), names.slice().sort());
    // (the page's own file input takes what the page made: through the browser's own file chooser)
    const buffers = await page.evaluate(async () => Promise.all(window.__files.map(async (f) => ({ name: f.name, type: f.blob.type, data: Array.from(new Uint8Array(await f.blob.arrayBuffer())) }))));
    await page.locator('#vault-file').setInputFiles(buffers.map((b) => ({ name: b.name, mimeType: b.type || 'application/octet-stream', buffer: Buffer.from(b.data) })));
    const pictured = () => s.app.db.prepare("SELECT name, length(thumbnail) AS t, length(preview) AS p, done_at FROM vault_files WHERE parent = '' OR parent IS NULL").all();
    for (let i = 0; i < 150 && !(pictured().length === names.length && pictured().every((r) => r.done_at && r.t > 0 && r.p > 0)); i++) await new Promise((r) => setTimeout(r, 400));
    const rows = pictured();
    if (process.env.CHECK_DEBUG) { console.log('DEBUG rows', JSON.stringify(rows)); console.log('DEBUG jobs', await page.locator('#vault-jobs').innerText()); console.log('DEBUG requests', requests.filter((u) => /vault/.test(u)).slice(-25).join(' ')); }
    assert.equal(rows.length, names.length);
    for (const r of rows) { assert.ok(r.done_at && r.t > 0 && r.t <= 16 * 1024 && r.p > 0 && r.p <= 160 * 1024, `${r.name}: saved with its pictures (${r.t}/${r.p})`); }
    console.log('PASS files put in from the page are saved with their pictures (' + rows.map((r) => `${r.name} ${(r.t / 1024).toFixed(1)}K/${(r.p / 1024).toFixed(1)}K`).join(', ') + ')');

    // 3. the list: one request for the pictures, no file downloaded
    requests.length = 0;
    await page.reload();
    await page.locator('#login-name').waitFor({ state: 'visible' }).catch(() => {});
    if (await page.locator('#login').isVisible()) { await page.locator('#login-name').fill('taku'); await page.locator('#login-pass').fill('pass1234'); await page.locator('#login-go').click(); }
    await page.locator('#app').waitFor({ state: 'visible' });
    // (the vault is closed again after a reload: opened with the developer's code; the bar rises when the pointer is at the bottom)
    await page.mouse.move(720, 985);
    await page.waitForTimeout(800);
    await page.locator('#tabs [data-view="vault"]').click({ force: true });
    await page.locator('#mac-window-vault').waitFor();
    await page.locator('#vault-unlock').click();
    await page.locator('#dialog-input').fill(CODE);
    await page.locator('#dialog-ok').click();
    await page.locator('#dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelectorAll('#vault-list .vitem').length >= 5).catch(async (e) => { console.log('DEBUG vault text:', (await page.locator('#mac-window-vault').innerText()).slice(0, 700)); await page.screenshot({ path: process.env.CHECK_SHOT || '/tmp/check_vault_previews.png' }); throw e; });
    await page.waitForFunction(() => document.querySelectorAll('#vault-list .vault-thumb.has-thumbnail img').length >= 5);
    await page.waitForFunction(() => document.querySelectorAll('#vault-list .vault-thumb.has-thumbnail:not(.is-card) img').length >= 5, null, { timeout: 15000 });
    assert.ok(requests.filter((u) => /\/api\/vault\/thumbnails\?/.test(u)).length >= 1 && requests.filter((u) => /\/api\/vault\/thumbnails\?/.test(u)).length <= 2, 'the pictures in one or two requests: ' + requests.filter((u) => /thumbnail/.test(u)).join(' '));
    assert.ok(!requests.some((u) => /\/api\/vault\/(chunk|pull)|vault3d\.js/.test(u)), 'no file is downloaded for the list');
    assert.ok(!requests.some((u) => /\/api\/vault\/thumbnail\?id=/.test(u)), 'one by one is no more');
    console.log('PASS the list shows a picture of each file with no file downloaded (' + requests.filter((u) => /thumbnail/.test(u)).length + ' request)');

    // 4. the enlarged view: the medium picture, not the original
    requests.length = 0;
    const big = page.locator('#vault-list .vitem', { hasText: 'photo.png' }).first();
    await big.locator('[data-vopen]').first().click();
    await page.locator('#viewer-box .viewer-look img').waitFor();
    await page.waitForFunction(() => { const i = document.querySelector('#viewer-box .viewer-look img'); return i && i.complete && i.naturalWidth > 0; });
    const shown = await page.evaluate(() => { const i = document.querySelector('#viewer-box .viewer-look img'); return { w: i.naturalWidth, src: i.src.length, note: document.querySelector('#viewer-note').textContent, buttons: [...document.querySelectorAll('#viewer-box .viewer-acts button')].map((b) => b.textContent) }; });
    assert.ok(shown.w <= 640, 'the enlarged picture is at most 640 px wide (the original is 1600): ' + shown.w);
    assert.match(shown.note, /低解像度/);
    assert.ok(shown.buttons.some((t) => /元の画像を表示/.test(t)) && shown.buttons.some((t) => /ダウンロード/.test(t)), shown.buttons.join('|'));
    assert.ok(requests.some((u) => /\/api\/vault\/preview\?id=/.test(u)) && !requests.some((u) => /\/api\/vault\/(chunk|pull)/.test(u)), 'the picture came, the file did not: ' + requests.join(' '));
    console.log('PASS the enlarged view shows the medium picture (' + shown.w + ' px wide, ' + (shown.src / 1024).toFixed(1) + ' KB) and the original only on its button');
    await page.locator('#viewer-box .viewer-acts button', { hasText: '元の画像を表示' }).click();
    await page.waitForFunction(() => { const i = document.querySelector('#viewer-box .viewer-img'); return i && i.complete && i.naturalWidth === 1600; });
    console.log('PASS the original comes when it is asked for');

    assert.deepEqual(errors, []);
    console.log('VAULT PREVIEWS OK');
  } finally {
    if (browser) await browser.close();
    await s.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
