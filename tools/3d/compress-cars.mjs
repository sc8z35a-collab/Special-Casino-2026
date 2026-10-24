// Usage: node tools/3d/compress-cars.mjs /path/to/gltf-transform
// Recompress the shipped cars. Meshopt stays compatible with our bundled loader.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const cli = process.argv[2];
if (!cli) throw new Error('Pass the gltf-transform 4.1.1 executable');
const root = new URL('../../', import.meta.url).pathname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-cars-'));
const rows = [];
function triangles(file) {
  const b = fs.readFileSync(file);
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  return (j.meshes || []).reduce((n, m) => n + m.primitives.reduce((s, p) =>
    s + j.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0), 0);
}
try {
  for (const name of fs.readdirSync(path.join(root, 'img/3d/cars')).filter(n => n.endsWith('.glb'))) {
    const file = path.join(root, 'img/3d/cars', name), out = path.join(tmp, name);
    const before = fs.statSync(file).size, beforeTriangles = triangles(file);
    execFileSync(cli, ['optimize', file, out, '--compress', 'meshopt', '--texture-compress', 'webp',
      '--texture-size', '768', '--simplify', 'true', '--simplify-ratio', '.55',
      '--simplify-error', '.001'], { stdio: 'ignore' });
    if (fs.statSync(out).size < before) fs.copyFileSync(out, file);
    const row = { path: 'img/3d/cars/' + name, before, after: fs.statSync(file).size,
      beforeTriangles, afterTriangles: triangles(file) };
    rows.push(row); console.log(JSON.stringify(row));
  }
  fs.writeFileSync(path.join(root, 'docs/car-compression.json'), JSON.stringify(rows, null, 2) + '\n');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
