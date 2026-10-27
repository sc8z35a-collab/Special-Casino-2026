const assert = require('node:assert/strict'), path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const { startServer } = await import(path.resolve(__dirname, '../server/test/helpers.js'));
  const s = await startServer(); let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage(); await page.goto(s.base + '/exit.html');
    const result = await page.evaluate(async (names) => {
      const ctx = new AudioContext(), rows = [];
      for (const file of ['bgm-title.mp3', 'click.wav', 'coins.mp3', 'money.mp3', 'peter-1.mp3', 'peter-2.mp3', 'reels.wav', 'register-high.mp3', 'register.mp3', 'spin-button.wav', 'win.mp3']) {
        const original = await ctx.decodeAudioData(await (await fetch('/sounds/' + file)).arrayBuffer());
        const response = await fetch('/sounds/' + file.replace(/\.[^.]+$/, '.opus'));
        const compact = await ctx.decodeAudioData(await response.arrayBuffer());
        rows.push({ file, difference: Math.abs(original.duration - compact.duration), channels: original.numberOfChannels === compact.numberOfChannels, type: response.headers.get('content-type') });
      }
      await ctx.close();
      for (const name of names) {
        const metadata = async extension => {
          const v = document.createElement('video'); v.muted = true; v.src = '/video/' + name + extension;
          return new Promise((resolve, reject) => { v.onloadedmetadata = () => { const data = [v.videoWidth, v.videoHeight, v.duration]; v.removeAttribute('src'); v.load(); resolve(data); }; v.onerror = reject; });
        };
        const a = await metadata('.mp4'), b = await metadata('.webm');
        rows.push({ file: name, difference: Math.abs(a[2] - b[2]), dimensions: a[0] === b[0] && a[1] === b[1] });
      }
      return rows;
    }, process.env.CASINO_TEST_APP ? ['studio-low'] : ['title','title-lite','studio-low']);
    for (const row of result) { assert.ok(row.difference < .15, JSON.stringify(row)); if ('channels' in row) { assert.ok(row.channels); assert.match(row.type, /audio\/ogg/); } else assert.ok(row.dimensions); }
    const requests = []; page.on('request', r => requests.push(new URL(r.url()).pathname));
    await page.route('**/video/studio-low.webm', r => r.abort());
    const fallback = page.waitForRequest(r => new URL(r.url()).pathname === '/video/studio-low.mp4');
    await page.goto(s.base, { waitUntil: 'domcontentloaded' });
    await fallback;
    await page.waitForFunction(() => window.BR && BR.launch && BR.launch.done());
    assert.ok(requests.includes('/video/studio-low.webm')); assert.ok(requests.includes('/video/studio-low.mp4'), 'video decoder/fetch failure falls back to MP4');
    assert.ok(!requests.some(p => /video\/title/.test(p)), 'the existing static title downloads no title movie');
    console.log('PASS media: 11 Opus recordings decode with original duration/channels, WebM videos preserve dimensions/duration, MP4 fallback and static-title traffic verified');
  } finally { if (browser) await browser.close(); await s.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
