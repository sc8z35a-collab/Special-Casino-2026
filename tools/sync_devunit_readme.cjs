const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Canonical chapters are edited once; DEV UNIT receives a generated reading copy.
const handbook = path.join(root, 'docs/handbook');
const chapters = JSON.parse(fs.readFileSync(path.join(handbook, 'manifest.json'), 'utf8'));
const outputs = {
  'ops/assets/readme-dev.txt': chapters.map(({ file }) => {
    if (!/^\d{2}\.md$/.test(file)) throw new Error('Invalid handbook chapter');
    return fs.readFileSync(path.join(handbook, file), 'utf8');
  }).join(''),
  'ops/assets/readme-dev-news.txt': fs.readFileSync(path.join(root, 'README_DEV_NEWS.md'), 'utf8')
};
for (const [file, content] of Object.entries(outputs)) {
  const target = path.join(root, file);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
      console.error(file + ' is out of date; run node tools/sync_devunit_readme.cjs'); process.exitCode = 1;
    }
  } else fs.writeFileSync(target, content);
}
