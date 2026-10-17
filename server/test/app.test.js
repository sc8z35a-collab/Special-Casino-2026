// The game as an app: build stamp, service worker, version file and the
// Android app download are served; private files are not. npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers.js';
import { computeBuild, stampedBuild } from '../../tools/stamp.mjs';
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

test('the build stamp matches the game files (run node tools/stamp.mjs after changing them)', () => {
  const build = computeBuild();
  assert.equal(stampedBuild(), build);
  assert.match(fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8'), new RegExp(`BR.BUILD = '${build}'`));
  assert.match(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), new RegExp(`const BUILD = '${build}'`));
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
