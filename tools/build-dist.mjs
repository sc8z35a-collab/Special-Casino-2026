// Minify copies only. Authoring files, data and Git history are never rewritten.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { transform } from 'esbuild';
import { parse } from 'jsonc-parser';
import { computeBuild } from './stamp.mjs';
const sourceBuild = computeBuild();
let sourceCommit = '';
try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: new URL('../', import.meta.url) }).trim(); } catch {}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.indexOf('--out');
const out = path.resolve(root, arg >= 0 ? process.argv[arg + 1] : 'dist/release');
if (!out.startsWith(path.join(root, 'dist') + path.sep)) throw Error('distribution output must be inside dist/');
const excluded = new Set(['video/title.mp4', 'video/title-lite.mp4', 'video/studio.mp4', 'video/title.webm', 'video/title-lite.webm']);
const dirs = ['css', 'js', 'fonts', 'icons', 'img', 'sounds', 'video', 'download', 'ops', 'sec', 'link', 'server'];
const files = ['index.html', 'law.html', 'exit.html', 'sw.js', 'version.json', 'manifest.webmanifest', '_headers', '.assetsignore', 'wrangler.jsonc', 'package.json'];
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
for (const name of [...dirs, ...files]) if (fs.existsSync(path.join(root, name))) fs.cpSync(path.join(root, name), path.join(out, name), { recursive: true,
  filter: src => !src.startsWith(path.join(root, 'server/test')) && !excluded.has(path.relative(root, src)) });
const htmlPath = path.join(out, 'index.html');
fs.writeFileSync(htmlPath, fs.readFileSync(htmlPath, 'utf8').replace('<head>', '<head>\n<meta name="br-immutable" content="true">\n<meta name="br-source-build" content="' + sourceBuild + '">\n<meta name="br-source-commit" content="' + sourceCommit + '">'));
const configErrors = [], config = parse(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'), configErrors);
if (configErrors.length) throw Error('invalid Wrangler source configuration');
config.main = 'server/cloudflare/worker.js'; config.assets.directory = '.'; delete config.build;
fs.writeFileSync(path.join(out, 'wrangler.jsonc'), JSON.stringify(config, null, 2) + '\n');
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
const candidates = ['css', 'js', 'ops', 'sec', 'link'].flatMap(d => walk(path.join(out, d))).filter(p => /\.(css|js)$/.test(p) && !p.endsWith('/js/version.js'));
const report = { sourceBuild, sourceCommit, tool: 'esbuild 0.28.2', files: [], before: 0, after: 0 };
for (const file of candidates) {
  const before = fs.readFileSync(file), rel = path.relative(out, file), css = file.endsWith('.css');
  const inputWithImports = css ? before.toString().replace(/@import url\(["']([^"']*box-model\.css)["']\);/g, (_, ref) => fs.readFileSync(path.resolve(path.dirname(file), ref), 'utf8')) : before.toString();
  const input = css ? inputWithImports.replace(/url\((['"]?)([^)'"]+)\1\)/g, (all, quote, ref) => /^(?:[a-z]+:|\/|#)/i.test(ref) ? all : 'url(' + quote + '/' + path.posix.normalize(path.posix.join(path.posix.dirname(rel), ref)) + quote + ')') : inputWithImports;
  const result = await transform(input, { loader: css ? 'css' : 'js', minify: css, minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false, keepNames: !css,
    legalComments: 'eof', target: css ? ['chrome109', 'firefox115', 'safari16.4'] : 'es2020', sourcefile: rel });
  // Already-minified bundles may be smaller than a second pass.
  const after = css || Buffer.byteLength(result.code) < before.length ? Buffer.from(result.code) : before;
  fs.writeFileSync(file, after);
  report.files.push({ path: rel, before: before.length, after: after.length }); report.before += before.length; report.after += after.length;
}
// Hashes name the bytes actually served, including late-loaded modules and ops previews.
execFileSync(process.execPath, [path.join(root, 'tools/stamp.mjs')], { env: { ...process.env, CASINO_STAMP_ROOT: out }, stdio: 'pipe' });
// Content-addressed aliases allow free Workers Static Assets to set immutable
// headers without inspecting a query string or invoking a Worker per file.
for (const file of [...candidates, path.join(out, 'js/version.js')]) {
  const bytes = fs.readFileSync(file), hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 10);
  const target = path.join(out, 'immutable', hash, path.relative(out, file)); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
}
fs.appendFileSync(path.join(out, '_headers'), '\n/immutable/*\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable\n');
fs.appendFileSync(path.join(out, '.assetsignore'), '\n!immutable/\n!immutable/**\n');
const sw = path.join(out, 'sw.js');
fs.writeFileSync(sw, (await transform(fs.readFileSync(sw, 'utf8'), { loader: 'js', minify: true, legalComments: 'eof', target: 'es2020' })).code);
execFileSync(process.execPath, [path.join(root, 'tools/stamp.mjs'), '--check'], { env: { ...process.env, CASINO_STAMP_ROOT: out }, stdio: 'pipe' });
report.build = JSON.parse(fs.readFileSync(path.join(out, 'version.json'))).build;
report.sourceHash = crypto.createHash('sha256').update(JSON.stringify(report.files.map(r => [r.path, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, r.path))).digest('hex')]))).digest('hex');
fs.writeFileSync(path.join(out, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(root, out), files: report.files.length, before: report.before, after: report.after, saved: report.before - report.after, build: report.build }));
