// Generate catalog/garage/chat fallback pictures from the imported GLBs.
// Needs Playwright (with Chromium) and sharp; see tools/3d/cars.md.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(process.env.CAR_TOOLS_NODE_MODULES
  ? path.join(process.env.CAR_TOOLS_NODE_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright'), sharp = require('sharp');
const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'));
await import(pathToFileURL(path.join(root, 'js/game/config.js')));
const cars = globalThis.BR.CONFIG.cars.filter(c => c.model && c.id !== 'blue-lightning');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(root, url);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' })[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(0, '127.0.0.1');
await new Promise(ok => server.once('listening', ok));
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.CAR_CHROMIUM ? { executablePath: process.env.CAR_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
  const page = await browser.newPage();
  fs.mkdirSync(path.join(root, 'img/cars'), { recursive: true });
  for (const car of cars) {
    // Reset per model so temporary render targets/textures are released.
    await page.goto(`http://127.0.0.1:${server.address().port}/tools/3d/art/model.html`);
    await page.waitForFunction(() => window.ready);
    const data = await page.evaluate(o => window.renderModel(o), {
      url: `/img/3d/cars/${car.id}.glb`, size: 1600, aspect: 1.8,
      yaw: 35, pitch: 12, pad: 1.06, exposure: 1
    });
    const out = path.join(root, 'img/cars', car.id + '.webp');
    await sharp(Buffer.from(data.split(',')[1], 'base64')).trim()
      .resize(1200, 564, { fit: 'contain', background: '#00000000' })
      .webp({ quality: 90, alphaQuality: 100 }).toFile(out);
    console.log(path.relative(root, out));
  }
} finally {
  if (browser) await browser.close();
  await new Promise(ok => server.close(ok));
}
