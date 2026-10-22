// The game's 2D art made from 3D (DEV12): the reel symbols and their 3D
// turns, the reel window, the wallet icons, the chip pile, COMBO, the app's 7
// (from the vault's 3D models), FEVER (3D lettering made here) and the fire
// (a volume of flames, ray-marched here), rendered in Chromium with WebGL:
//
//   1. put the models in tools/3d/source/ (from the vault):
//        revolver gold diamond star bar seven statue frame chip coin dollar
//        chip-pile combo combo-rainbow app-seven   (.glb)
//   2. node tools/3d/render-art.mjs <out folder>
//      (needs Playwright and its Chromium; three.js for the lettering comes
//       from npm like tools/3d/build.sh)
//   3. python3 tools/art/symbol_3d.py <out>          img/symbols/*.webp, img/symbols/turn/*.webp
//      python3 tools/art/reel_frame_3d.py <out>/frame.png   img/ui/reel-frame.webp, reel-back.webp
//      python3 tools/art/art_3d.py <out>             the icons' sources, COMBO, FEVER, the fire
//      then tools/art/ui_images.py (icons, chip pile) and tools/art/icons.py (the app icons)
//
// tools/3d/art/model.html renders a model (the game's own three.js bundle),
// word.html 3D lettering, fire.html the fire.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.resolve(process.argv[2] || 'art-out');
fs.mkdirSync(path.join(OUT, 'fire'), { recursive: true });
const SYMS = ['revolver', 'gold', 'diamond', 'star', 'bar', 'seven', 'statue'];
// the reel's view: turned 22 degrees, a little from above (the revolver aslant, the gold bars more from above)
const VIEW = { revolver: { roll: -32 }, gold: { pitch: 24, exposure: 1.25 } };

// three.js from npm for the lettering (TextGeometry and its fonts)
const T = fs.mkdtempSync('/tmp/render-art-');
execSync(`npm install --prefix "${T}" --no-audit --no-fund --silent three@0.170.0`, { stdio: 'inherit' });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = u.startsWith('/node_modules/') ? path.join(T, u) : u.startsWith('/models/') ? path.join(ROOT, 'tools/3d/source', u.slice(8)) : path.join(ROOT, u);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
const save = (file, data) => fs.writeFileSync(path.join(OUT, file), Buffer.from(data.split(',')[1], 'base64'));
async function open(name) {
  await page.goto(`${BASE}/tools/3d/art/${name}.html`);
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
}

// the models
await open('model');
const jobs = [];
for (const n of SYMS) {
  const v = { url: `/models/${n}.glb`, yaw: -22, pitch: 10, sphere: true, pad: 1.0, exposure: 1.0, ...VIEW[n] };
  jobs.push({ ...v, out: `${n}-base.png`, size: 1024 });
  for (let k = 0; k < 24; k++) jobs.push({ ...v, out: `${n}-turn${String(k).padStart(2, '0')}.png`, size: 512, yaw: v.yaw + k * 15 });
}
jobs.push({ url: '/models/frame.glb', out: 'frame.png', size: 2400, aspect: 1.875, ortho: true, pad: 1.0 });
jobs.push({ url: '/models/chip.glb', out: 'ui-chip.png', size: 1024, yaw: -20, pitch: 22, pad: 1.02 });
jobs.push({ url: '/models/coin.glb', out: 'ui-coin.png', size: 1024, yaw: -16, pitch: 8, pad: 1.02 });
jobs.push({ url: '/models/dollar.glb', out: 'ui-dollar.png', size: 1024, yaw: -16, pitch: 8, pad: 1.02 });
jobs.push({ url: '/models/chip-pile.glb', out: 'ui-chip-pile.png', size: 1600, aspect: 2.2, yaw: -12, pitch: 14, pad: 1.02 });
jobs.push({ url: '/models/app-seven.glb', out: 'ui-app-seven.png', size: 1024, yaw: -10, pitch: 4, pad: 1.02 });
jobs.push({ url: '/models/combo.glb', out: 'combo-front.png', size: 2000, aspect: 3.2, yaw: 0, pitch: 4, pad: 1.02 });
jobs.push({ url: '/models/combo-rainbow.glb', out: 'combo-rainbow-front.png', size: 2000, aspect: 3.2, yaw: 0, pitch: 4, pad: 1.02 });
for (const j of jobs) { save(j.out, await page.evaluate((o) => window.renderModel(o), j)); console.log(j.out); }

// FEVER in 3D lettering
await open('word');
const FIRE = [[0, '#7a0000'], [0.4, '#d81200'], [0.72, '#ff5a00'], [1, '#ff9a00']];
for (const j of [{ text: 'FEVER', out: 'fever-word.png', size: 2000, aspect: 2.9, yaw: -12, pitch: 6, stops: FIRE },
  { text: 'FEVER!!', out: 'fever-banner.png', size: 2400, aspect: 3.6, yaw: 0, pitch: 6, stops: FIRE }]) {
  save(j.out, await page.evaluate((o) => window.renderWord(o), j));
  console.log(j.out);
}

// the fire: 24 frames of one loop
await open('fire');
for (let i = 0; i < 24; i++) save(`fire/f${String(i).padStart(2, '0')}.png`, await page.evaluate((o) => window.frame(o), { t: i / 24, w: 512, h: 256, tongues: 4, seed: 0.37 }));
console.log('fire: 24 frames');

await browser.close();
server.close();
fs.rmSync(T, { recursive: true, force: true });
