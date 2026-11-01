import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { RELEASE, RELEASE_NAME } from '../core/rules.js';
import { releaseInfo, stampedBuild } from '../../tools/stamp.mjs';

test('server, client and public version metadata share the canonical Dev News release and generated build', () => {
  const info = JSON.parse(fs.readFileSync(new URL('../../version.json', import.meta.url), 'utf8'));
  const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(new URL('../../js/version.js', import.meta.url), 'utf8'), ctx);
  assert.equal(info.release, RELEASE); assert.equal(info.label, RELEASE_NAME); assert.equal(info.build, stampedBuild());
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.window.BR.VERSION)), info);
  assert.deepEqual(releaseInfo(), { release: RELEASE, label: RELEASE_NAME });
  const ids = globalThis.BR.NEWS.map(n => n.id);
  assert.equal(new Set(ids).size, ids.length); assert.equal(Math.max(...ids), RELEASE);
});

test('Android publication uses the built APK metadata for its version instead of rebuilding the CI formula', t => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/android.yml', import.meta.url), 'utf8');
  const section = workflow.slice(workflow.indexOf('          cp app/android/'));
  const code = section.match(/python3 - <<'PY'\n([\s\S]+?)^          PY/m)[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-version-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'download')); fs.mkdirSync(path.join(dir, 'app/android/app/build/outputs/apk/release'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'download/two-state-casino.apk'), 'fake apk');
  fs.writeFileSync(path.join(dir, 'app/android/app/build/outputs/apk/release/output-metadata.json'), JSON.stringify({ elements: [{ versionName: '9.8.7', versionCode: 987 }] }));
  const result = spawnSync('python3', ['-c', code], { cwd: dir, env: { ...process.env, APP_URL: 'https://example.invalid/', APP_CERT_SHA256: '00', GITHUB_RUN_NUMBER: '123' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const info = JSON.parse(fs.readFileSync(path.join(dir, 'download/app.json'), 'utf8'));
  assert.equal(info.versionName, '9.8.7'); assert.equal(info.versionCode, 987);
  assert.match(workflow, /git commit -m "Android app \$APP_RELEASE"/);
});
