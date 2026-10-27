// The game as an app: build stamp, service worker, version file and the
// Android app download are served; private files are not. npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { startServer } from './helpers.js';
import { computeBuild, stampedBuild, plainHtml } from '../../tools/stamp.mjs';
import { ROOT } from '../node/config.js';

let s;
const probe = path.join(ROOT, 'download', `test-${process.pid}.apk`);

before(async () => {
  s = await startServer();
  fs.mkdirSync(path.dirname(probe), { recursive: true });
  fs.writeFileSync(probe, Buffer.from('PK\u0003\u0004 test'));
});

after(async () => {
  fs.rmSync(probe, { force: true });
  try { fs.rmdirSync(path.dirname(probe)); } catch { /* holds the real app */ }
  await s.stop();
});

test('only static code with its actual content hash receives immutable caching', async () => {
  const file = '/js/core/util.js', body = fs.readFileSync(path.join(ROOT, file));
  const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 10);
  assert.match((await fetch(s.base + file + '?v=' + hash)).headers.get('cache-control'), /max-age=31536000, immutable/);
  assert.doesNotMatch((await fetch(s.base + file + '?v=0000000000')).headers.get('cache-control'), /immutable/);
  for (const url of ['/', '/index.html', '/version.json', '/ops/']) assert.doesNotMatch((await fetch(s.base + url)).headers.get('cache-control'), /immutable/);
});

test('the build stamp matches the game files (run node tools/stamp.mjs after changing them)', () => {
  const build = computeBuild();
  assert.equal(stampedBuild(), build);
  assert.match(fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8'), new RegExp(`BR.BUILD = '${build}'`));
  assert.match(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), new RegExp(`const BUILD = '${build}'`));
});

test('index.html names every script and style by the hash of its file, and the server serves exactly that file at that address', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)(\?v=[0-9a-f]+)?"/g)];
  assert.ok(refs.length > 50 && refs.length < 80, 'boot retains core scripts while optional screens are deferred');
  const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
  for (const [, file, v] of refs) assert.equal(v, '?v=' + sha(fs.readFileSync(path.join(ROOT, file))), file + ' is named by the hash of its file');
  // the same address from the server: the file, to the byte (what the service worker checks before it keeps it)
  for (const [, file, v] of [refs[0], refs.at(-1), refs.find((r) => r[1].startsWith('css/'))]) {
    const res = await fetch(s.base + '/' + file + v);
    assert.equal(res.status, 200, file);
    assert.equal('?v=' + sha(Buffer.from(await res.arrayBuffer())), v, file);
  }
  // the scripts loaded later (js/vendor) are named in js/version.js, and the code that loads them asks for those addresses
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8'), { window: win });
  const lazy = JSON.parse(fs.readFileSync(path.join(ROOT, 'js/lazy-screens.json'), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(win.BR.LAZY)), lazy);
  const resources = JSON.parse(fs.readFileSync(path.join(ROOT, 'js/resources.json'), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(win.BR.RESOURCES)), resources);
  assert.deepEqual(Object.keys(win.BR.CODE).sort(), [...new Set(['js/vendor/three-bundle.js', 'js/vendor/tree-physics.js', ...Object.values(lazy).flat(), ...Object.values(resources).flat()])].sort());
  for (const [file, h] of Object.entries(win.BR.CODE)) assert.equal(h, sha(fs.readFileSync(path.join(ROOT, file))), file);
  const ctx = vm.createContext({ BR: { CODE: win.BR.CODE } });
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/core/util.js'), 'utf8'), ctx);
  const { codeUrl } = ctx.BR.util;
  assert.equal(codeUrl('js/vendor/three-bundle.js'), 'js/vendor/three-bundle.js?v=' + win.BR.CODE['js/vendor/three-bundle.js']);
  assert.equal(codeUrl('js/other.js'), 'js/other.js', 'a file without a hash keeps its plain address');
  for (const file of ['js/render/win3d.js', 'js/render/tree3d.js']) assert.match(fs.readFileSync(path.join(ROOT, file), 'utf8'), /BR\.util\.codeUrl\(/, file);
});

test('the build id does not depend on the hashes written into index.html', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const other = html.replace(/\?v=[0-9a-f]{10}"/g, '?v=0000000000"');
  assert.notEqual(other, html);
  assert.equal(plainHtml(other), plainHtml(html));
  assert.ok(!/\?v=/.test(plainHtml(html).replace(/icons\/[^"]*\?v=[^"]*"/g, '')), 'only the hashes go (the icons keep their own ?v=)');
});

test('service worker, version file and the Android app are served', async () => {
  let r = await fetch(s.base + '/sw.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  r = await fetch(s.base + '/version.json');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal((await r.json()).build, stampedBuild());
  r = await fetch(s.base + '/download/' + path.basename(probe));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.match(r.headers.get('content-disposition'), /attachment/);
  const m = await (await fetch(s.base + '/manifest.webmanifest')).json();
  assert.equal(m.start_url, './');
  assert.ok(m.icons.some((i) => i.sizes === '512x512'));
  assert.ok(m.shortcuts.length >= 1);
});

test('private files stay private', async () => {
  for (const p of ['/app/android/app/build.gradle', '/app/android/signing/keystore.py', '/app/app-url.txt',
    '/.github/workflows/android.yml', '/tools/stamp.mjs', '/server/core/api.js', '/wrangler.jsonc', '/package.json']) {
    assert.equal((await fetch(s.base + p)).status, 404, p);
  }
});
