const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
fs.copyFileSync(path.join(root, 'README.md'), path.join(root, 'ops/assets/readme-dev.txt'));
