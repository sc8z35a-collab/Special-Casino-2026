// Stamps the game files with a build id, so open pages and the apps can tell
// that a newer version is on the server ("アップデート" button).
//
//   node tools/stamp.mjs           writes version.json, js/version.js, sw.js and the addresses in index.html and ops/index.html
//   node tools/stamp.mjs --check   exits 1 when the stamp is out of date
//
// The id is a hash of every file the browser loads (the generated files
// themselves excluded), so it changes exactly when the game changes.
//
// index.html asks for each script and style by the hash of that file
// (js/main.js?v=0123456789): the address is the file, so the service worker
// keeps it for ever and a phone asks the server nothing about the ~90 files
// of a start that did not change (sw.js). The hashes are not part of the id
// above (the id covers the files themselves).
//
// The operator site's page (ops/index.html) names its scripts and styles the same way (ops/ops.js?v=…, and the shared
// ../js/net/x.js?v=…), and its worker (ops/ops-sw.js) keeps them. They are not in the id: the operator site has no "newer version"
// button, its page is read afresh every time and names whatever is on the server.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.CASINO_STAMP_ROOT ? path.resolve(process.env.CASINO_STAMP_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['css', 'js', 'fonts', 'icons', 'img', 'sounds', 'video'];
const FILES = ['index.html', 'exit.html', 'manifest.webmanifest'];
const GENERATED = new Set(['js/version.js']);
// the addresses in index.html that carry a file's hash: <script src="js/x.js?v=…"> and <link href="css/x.css?v=…">
const CODE_REF = /((?:src|href)="((?:js|css)\/[^"?]+))(?:\?v=[0-9a-f]+)?"/g;
// scripts that are not in index.html but loaded later (js/core/util.js codeUrl): their hashes are written to js/version.js
const LAZY = JSON.parse(fs.readFileSync(path.join(ROOT, 'js/lazy-screens.json'), 'utf8'));
const STYLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'js/style-order.json'), 'utf8'));
const RESOURCES = JSON.parse(fs.readFileSync(path.join(ROOT, 'js/resources.json'), 'utf8'));
const LATER = [...new Set(Object.values(RESOURCES).flat()), 'js/vendor/three-bundle.js', 'js/vendor/tree-physics.js', ...new Set(Object.values(LAZY).flat())];
const HASH_LEN = 10;
const IMMUTABLE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes('<meta name="br-immutable" content="true">');
const SOURCE_BUILD = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/<meta name="br-source-build" content="([a-f0-9]{12})">/)?.[1];
const SOURCE_COMMIT = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/<meta name="br-source-commit" content="([a-f0-9]{40})">/)?.[1];
const versionMeta = build => ({ ...releaseInfo(), build, ...(SOURCE_BUILD ? { sourceBuild: SOURCE_BUILD } : {}), ...(SOURCE_COMMIT ? { sourceCommit: SOURCE_COMMIT } : {}) });
const codeAddress = (rel, original = rel) => IMMUTABLE ? '/immutable/' + fileHash(rel) + '/' + rel : original + '?v=' + fileHash(rel);
function normalRefs(html, base = '') {
  return html.replace(/((?:src|href)=")\/immutable\/[a-f0-9]{10}\/([^"]+)(")/g, (m, head, rel, tail) => head + (base === 'sec' ? '/' + rel : base ? path.posix.relative(base, rel) : rel) + tail);
}
// the operator site's page: <script src="ops.js?v=…">, <link href="ops.css?v=…"> and the shared files it uses (../js/net/x.js?v=…)
const OPS_PAGE = 'ops/index.html';
const SEC_PAGE = 'sec/index.html';
const SEC_SHARED = /((?:src|href)="(\/js\/net\/[A-Za-z0-9._-]+\.js))(?:\?v=[0-9a-f]+)?"/g;
const OPS_REF = /((?:src|href)="((?:\.\.\/(?:js\/(?:net|core)|css)\/)?[A-Za-z0-9._-]+\.(?:js|css)))(?:\?v=[0-9a-f]+)?"/g;

export const fileHash = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, HASH_LEN);

function walk(dir, out) {
  for (const name of fs.readdirSync(path.join(ROOT, dir)).sort()) {
    const rel = dir + '/' + name;
    const st = fs.statSync(path.join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (!GENERATED.has(rel)) out.push(rel);
  }
  return out;
}

export function gameFiles() {
  const out = [...FILES];
  for (const d of DIRS) walk(d, out);
  return out.sort();
}

// index.html without the hashes of the files it names
export const plainHtml = (html) => normalRefs(html).replace(CODE_REF, '$1"');

export function computeBuild() {
  const h = crypto.createHash('sha256');
  for (const rel of gameFiles()) {
    h.update(rel + '\0');
    h.update(rel === 'index.html' ? plainHtml(fs.readFileSync(path.join(ROOT, rel), 'utf8')) : fs.readFileSync(path.join(ROOT, rel)));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

// index.html with every script and style named by the hash of its file
function stampedHtml(html) {
  return normalRefs(html).replace(CODE_REF, (m, head, rel) => head.slice(0, -rel.length) + codeAddress(rel) + '"');
}

// ops/index.html with every script and style named by the hash of its file (the paths are those of the file that names them)
export const opsRef = (ref) => path.posix.normalize('ops/' + ref);
export function stampedOps(html) {
  html = html.replace(/(<meta name="ops-lazy" data-ops-file="([^"]+)" content=")[^"]*(">)/g, (m, head, file, tail) => head + codeAddress(opsRef(file), file) + tail);
  html = html.replace(/(<meta name="ops-vault3d" content=")[^"]*(">)/, (m, head, tail) => head + codeAddress('ops/vault3d.js', 'vault3d.js') + tail);
  return normalRefs(html, 'ops').replace(OPS_REF, (m, head, ref) => head.slice(0, -ref.length) + codeAddress(opsRef(ref), ref) + '"');
}
export const stampedSec = (html) => normalRefs(html, 'sec').replace(SEC_SHARED, (m, head, ref) => head.slice(0, -ref.length) + codeAddress(ref.slice(1), ref) + '"');

// The human DEV number remains sourced from the canonical Dev News entry.
export function releaseInfo() {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/game/news.js'), 'utf8'), context);
  const release = context.BR.RELEASE;
  if (!Number.isSafeInteger(release) || release < 1) throw new Error('invalid release number');
  return { release, label: 'DEV' + release };
}

function versionJs(build) {
  const later = Object.fromEntries(LATER.map((rel) => [rel, fileHash(rel)]));
  return "/* Generated by tools/stamp.mjs: the build this page belongs to, and the hashes of the scripts that are loaded later (BR.util.codeUrl). */\n" +
    "(function (BR) { BR.BUILD = '" + build + "'; BR.VERSION = " + JSON.stringify(versionMeta(build)) + "; BR.CODE = " + JSON.stringify(later) + "; BR.IMMUTABLE = " + IMMUTABLE + "; BR.RELEASE = " + releaseInfo().release + "; BR.STYLES = " + JSON.stringify(STYLES) + "; BR.RESOURCES = " + JSON.stringify(RESOURCES) + "; BR.LAZY = " + JSON.stringify(LAZY) + "; })(window.BR = window.BR || {});\n";
}

export function stampedBuild() {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
    const json = info.build, release = releaseInfo();
    if (info.release !== release.release || info.label !== release.label || info.sourceBuild !== SOURCE_BUILD || info.sourceCommit !== SOURCE_COMMIT) return null;
    const js = fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8').match(/BR\.BUILD = '([^']+)'/)?.[1];
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/const BUILD\s*=\s*['"]([^'"]+)['"]/)?.[1];
    // A partially stamped release looks permanently outdated to players.
    if (!(json && json === js && js === sw)) return null;
    // ...and so does one whose addresses or hashes in js/version.js do not belong to the files
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    if (stampedHtml(html) !== html) return null;
    const ops = fs.readFileSync(path.join(ROOT, OPS_PAGE), 'utf8');
    if (stampedOps(ops) !== ops) return null;
    const sec = fs.readFileSync(path.join(ROOT, SEC_PAGE), 'utf8');
    if (stampedSec(sec) !== sec) return null;
    if (fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8') !== versionJs(json)) return null;
    return json;
  } catch {
    return null;
  }
}

function write(build) {
  fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify(versionMeta(build)) + '\n');
  fs.writeFileSync(path.join(ROOT, 'js/version.js'), versionJs(build));
  // (js/version.js is written first: index.html names it by its hash)
  const index = path.join(ROOT, 'index.html');
  fs.writeFileSync(index, stampedHtml(fs.readFileSync(index, 'utf8')));
  const ops = path.join(ROOT, OPS_PAGE);
  fs.writeFileSync(ops, stampedOps(fs.readFileSync(ops, 'utf8')));
  const sec = path.join(ROOT, SEC_PAGE);
  fs.writeFileSync(sec, stampedSec(fs.readFileSync(sec, 'utf8')));
  const sw = path.join(ROOT, 'sw.js');
  const src = fs.readFileSync(sw, 'utf8');
  fs.writeFileSync(sw, src.replace(/const BUILD\s*=\s*['"][^'"]*['"];/, "const BUILD = '" + build + "';"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const build = computeBuild();
  if (process.argv.includes('--check')) {
    const ok = stampedBuild() === build;
    console.log(ok ? `build ${build} is up to date` : `build is out of date (${stampedBuild()} -> ${build}): run node tools/stamp.mjs`);
    process.exitCode = ok ? 0 : 1;
  } else {
    write(build);
    console.log(`stamped build ${build}`);
  }
}
