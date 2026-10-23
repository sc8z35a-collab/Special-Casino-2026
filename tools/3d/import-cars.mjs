// Run through import-cars.sh. Preserve the supplied source GLBs; distribute
// Meshopt geometry and 2048px WebP textures like the existing car build.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [source, root, cli] = process.argv.slice(2);
if (!source || !root || !cli) throw new Error('Usage: import-cars.mjs <source folder> <repo> <gltf-transform>');
const jobs = [
  ['オンヴォーロ.glb', 'onvoro'],
  ['フェラーリ325.glb', 'ferrari-325'],
  ['メルセデスベンツ one.glb', 'mercedes-benz-one'],
  ['ランボルギーニアベンタドール.glb', 'lamborghini-aventador'],
  ['ランボルギーニウルス.glb', 'lamborghini-urus'],
  ['ランボルギーニクイヤスパイダー.glb', 'lamborghini-kuia-spyder'],
  ['日産　gt-r.glb', 'nissan-gt-r'],
  ['オレンジスポーツカー.glb', 'lamborghini-revuelto'],
  ['ホワイトスポーツカー.glb', 'mercedes-amg-one-white']
];
const output = path.join(root, 'img/3d/cars');
fs.mkdirSync(output, { recursive: true });
function triangles(file) {
  const bytes = fs.readFileSync(file);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return json.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce(
    (n, p) => n + json.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0), 0);
}
for (const [name, id] of jobs) {
  const input = path.join(source, name), destination = path.join(output, id + '.glb');
  execFileSync(cli, ['optimize', input, destination,
    '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '2048',
    '--simplify', 'true', '--simplify-ratio', String(Math.min(0.16, 130000 / triangles(input))),
    '--simplify-error', '0.0008'], { stdio: 'inherit' });
  const count = triangles(destination), bytes = fs.statSync(destination).size;
  if (bytes >= 25 * 1024 * 1024 || count > 260000) throw new Error(`${id} exceeds the car budget; inspect before publishing`);
  console.log(`${id}: ${count.toLocaleString()} triangles, ${bytes.toLocaleString()} bytes`);
}
