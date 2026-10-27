// Validate the actual separately minified scripts together in a browser.
const path = require('node:path'), fs = require('node:fs'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'dist', 'browser-' + process.pid);
function run(file, env = process.env, args = []) {
  const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { cwd: root, env, stdio: 'inherit' });
  if (r.status !== 0) throw r.error || new Error(file + ' failed: ' + r.status);
}
try {
  run('build-dist.mjs', process.env, ['--out', out]);
  const env = { ...process.env, CASINO_TEST_APP: path.join(out, 'server/node/server.js') };
  for (const check of ['check_maintenance.cjs', 'check_lazy_loading.cjs', 'check_gacha_optimization.cjs', 'check_media.cjs']) run(check, env);
  console.log('PASS production browser: minified shared globals, immutable URLs, lazy entry points, spin settlement, gacha and codec fallback');
} finally { fs.rmSync(out, { recursive: true, force: true }); }
