/* Put a folder of pictures into the operator site's 背景 list.
     node tools/add_wallpapers.cjs <folder> [prefix]      (prefix: the ids/files get it, default "f2")
   Every .jpg/.jpeg/.png/.webp in the folder is cut to 16:9, shrunk to 960 x 540 and saved as a small WebP in
   ops/assets/wallpapers/, and one entry per picture is added to ops/assets/wallpapers.json (the picture's file
   name, without its extension, is its name in the list). Pictures already added (same file name) are skipped, so
   the command can be run again. Needs ImageMagick (`convert` or `magick`). Only pictures you may use should be put
   in: ask the photographer, and keep their name in the list's names or in the README. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const from = process.argv[2];
const prefix = (process.argv[3] || 'f2').replace(/[^\w-]/g, '');
if (!from || !fs.statSync(from, { throwIfNoEntry: false })?.isDirectory()) {
  console.error('usage: node tools/add_wallpapers.cjs <folder> [prefix]');
  process.exit(2);
}
const magick = ['magick', 'convert'].find((c) => spawnSync(c, ['-version'], { stdio: 'ignore' }).status === 0);
if (!magick) { console.error('ImageMagick (convert / magick) is needed'); process.exit(2); }

const dir = path.join(root, 'ops/assets/wallpapers');
const listFile = path.join(root, 'ops/assets/wallpapers.json');
const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
const have = new Set(list.map((w) => w.source).filter(Boolean));
const names = fs.readdirSync(from).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
let n = list.filter((w) => w.id.startsWith(prefix + '-')).length, added = 0;
for (const f of names) {
  if (have.has(prefix + '/' + f)) continue;
  const id = prefix + '-' + String(++n).padStart(2, '0');
  const out = path.join(dir, id + '.webp');
  const r = spawnSync(magick, [path.join(from, f), '-auto-orient', '-resize', '960x540^', '-gravity', 'center', '-extent', '960x540',
    '-strip', '-quality', '68', '-define', 'webp:method=6', out], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('failed: ' + f); n--; continue; }
  list.push({ id, name: path.basename(f, path.extname(f)), file: id + '.webp', source: prefix + '/' + f });
  added++;
}
fs.writeFileSync(listFile, JSON.stringify(list, null, 1) + '\n');
console.log('added ' + added + ' picture(s); the list now has ' + list.length);
