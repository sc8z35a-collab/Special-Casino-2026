const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'dist', 'check-' + process.pid);
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const sources = ['css', 'js', 'ops', 'sec', 'link'].flatMap(d => walk(path.join(root, d))).filter(p => /\.(css|js|html)$/.test(p));
const fingerprint = () => crypto.createHash('sha256').update(Buffer.concat(sources.map(p => fs.readFileSync(p)))).digest('hex');
const before = fingerprint();
try {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'build-dist.mjs'), '--out', path.relative(root, out)], { cwd: root, encoding: 'utf8', maxBuffer: 2e6 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fingerprint(), before, 'authoring source stays byte-identical');
  const report = JSON.parse(fs.readFileSync(path.join(out, 'build-report.json')));
  assert.ok(report.after < report.before);
  const source = JSON.parse(fs.readFileSync(path.join(root, 'version.json')));
  const compiled = JSON.parse(fs.readFileSync(path.join(out, 'version.json')));
  assert.equal(compiled.sourceBuild, source.build);
  assert.equal(compiled.sourceCommit, require('node:child_process').execFileSync('git', ['rev-parse','HEAD'], {cwd:root,encoding:'utf8'}).trim());
  const sourceConfig = require('jsonc-parser').parse(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'));
  const compiledConfig = JSON.parse(fs.readFileSync(path.join(out, 'wrangler.jsonc')));
  for (const key of ['name','durable_objects','migrations','r2_buckets','vars','keep_vars']) assert.deepEqual(compiledConfig[key], sourceConfig[key], 'deployment preserves ' + key);
  assert.equal(compiledConfig.build, undefined, 'no recursive build');
  assert.equal(sourceConfig.assets.directory, 'dist/release');
  assert.ok(report.files.every(f => f.after <= f.before));
  for (const name of ['title.mp4','title-lite.mp4','studio.mp4','title.webm','title-lite.webm']) assert.equal(fs.existsSync(path.join(out,'video',name)),false);
  const ops = fs.readFileSync(path.join(out, 'ops/index.html'), 'utf8');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, 'ops/vault3d.js'))).digest('hex').slice(0, 10);
  assert.ok(ops.includes('content="/immutable/' + hash + '/ops/vault3d.js"'));
  assert.ok(!/<script[^>]+src="vault3d/.test(ops), '3D preview stays lazy');
  const script = `import assert from 'node:assert/strict';
    import {startServer} from ${JSON.stringify(path.join(root, 'server/test/helpers.js'))};
    const s=await startServer({startTokens:10000});
    try {
      const p=await s.register('DistGuard');
      const body={bet:100,key:Date.now()+'-'+'a'.repeat(32)};
      const a=await s.call('POST','/api/spin',{token:p.token,body,raw:true});
      const b=await s.call('POST','/api/spin',{token:p.token,body,raw:true});
      assert.equal(a.status,200);assert.deepEqual(a,b);
      const v=await(await fetch(s.base+'/version.json')).json();assert.equal(v.build,${JSON.stringify(report.build)});
      for(const url of ['/','/ops/','/sec/']) assert.equal((await fetch(s.base+url)).status,200);
      assert.equal((await fetch(s.base+'/server/core/api.js')).status,404);
    } finally {await s.stop();}`;
  const runtime = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', script], { cwd: root,
    env: { ...process.env, CASINO_TEST_APP: path.join(out, 'server/node/server.js') }, encoding: 'utf8', maxBuffer: 2e6 });
  assert.equal(runtime.status, 0, runtime.stderr + runtime.stdout);
  console.log(`PASS distribution: ${report.files.length} files, ${report.before - report.after} bytes saved; original source, asset hashes, minified runtime and spin replay verified`);
} finally { fs.rmSync(out, { recursive: true, force: true }); }
