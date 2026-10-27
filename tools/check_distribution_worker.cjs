const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process'), { startWorker } = require('./worker-fixture.cjs');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'dist', 'worker-' + process.pid);
(async () => {
  let s;
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'build-dist.mjs'), '--out', out], { cwd: root, stdio: 'pipe' });
    s = await startWorker({ config: path.join(out, 'wrangler.jsonc') });
    for (const name of ['/', '/ops/', '/sec/']) {
      const res = await fetch(s.base + name), html = await res.text(); assert.equal(res.status, 200);
      assert.doesNotMatch(res.headers.get('cache-control') || '', /immutable/);
      const url = html.match(/(?:src|href)="(\/immutable\/[a-f0-9]{10}\/[^"?]+)"/)[1];
      const code = await fetch(s.base + url), body = Buffer.from(await code.arrayBuffer()); assert.equal(code.status, 200);
      assert.match(code.headers.get('cache-control'), /max-age=31536000, immutable/);
      assert.equal(crypto.createHash('sha256').update(body).digest('hex').slice(0, 10), url.split('/')[2]);
    }
    assert.doesNotMatch((await fetch(s.base + '/version.json')).headers.get('cache-control') || '', /immutable/);
    for (const name of ['title.mp4', 'title-lite.mp4', 'studio.mp4', 'title.webm', 'title-lite.webm']) {
      const res = await fetch(s.base + '/video/' + name);
      // Static Assets can apply the configured SPA fallback to missing files;
      // either way, the legacy movie itself must not be distributed.
      assert.ok(!/^video\//.test(res.headers.get('content-type') || ''), name);
    }
    assert.equal((await fetch(s.base + '/server/core/api.js')).status, 404);
    const registered = await fetch(s.base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': crypto.randomBytes(16).toString('hex') }, body: JSON.stringify({ name: 'WorkerDist', password: 'pass1234', avatar: 'traveler-green' }) });
    assert.equal(registered.status, 200, await registered.text());
    console.log('PASS real workerd distribution: immutable body hashes/headers, fresh HTML/version, excluded legacy movies, private sources and account API');
  } finally { if (s) await s.stop(); fs.rmSync(out, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
