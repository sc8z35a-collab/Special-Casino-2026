// Makes the models in img/3d smaller still, in place (they are the ones already
// made by build.sh: meshopt geometry + WebP textures). Their originals are not
// in the repository, so this works on what is shipped: the textures go down a
// size and a little in quality, and the triangles are cut again where there are
// many (the error limit keeps the shapes). Skinned and animated models (the
// auction's buyers) only get their textures smaller.
//   sh tools/3d/shrink.sh           (installs what it needs in a temporary folder)
// then `node tools/stamp.mjs`. Run it once: every run makes them a little worse.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, dequantize, weld, simplify, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const ROOT = path.resolve(process.argv[2] || '.');
const R = path.join(ROOT, 'img/3d');
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// [texture size, WebP quality, how many triangles stay (1: all)]
const CLASS = [
  [/^effects-lite\//, [320, 68, 0.85]],
  [/^cars\//, [640, 70, 0.7]],
  [/^garage\//, [1536, 70, 0.7]],
  [/^studio\//, [768, 70, 0.7]],
  [/^tree\/preview/, [768, 70, 0.55]],
  [/^tree\//, [768, 70, 0.7]],
  [/^auction\//, [768, 70, 0.75]],
  [/^[^/]+\.glb$/, [768, 70, 0.7]]
];
async function shrink(doc, [size, quality, keep], skinned) {
  const root = doc.getRoot();
  await doc.transform(dedup(), dequantize());
  if (!skinned && keep < 1) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: keep, error: 0.01 }));
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality }),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' })
  );
  return root;
}

const out = [];
for (const rel of fs.readdirSync(R, { recursive: true }).filter((f) => f.endsWith('.glb')).sort()) {
  if (/fertilizer/.test(rel)) continue;
  const file = path.join(R, rel);
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  const skinned = doc.getRoot().listSkins().length > 0 || doc.getRoot().listAnimations().length > 0;
  await shrink(doc, CLASS.find(([re]) => re.test(rel))[1], skinned);
  await io.write(file, doc);
  out.push([rel, before, fs.statSync(file).size]);
  console.log(rel.padEnd(34), String(before >> 10).padStart(5), '->', String(fs.statSync(file).size >> 10).padStart(5), 'KB');
}

// the auction's buyers: whole files cut into 240 KB parts (assets.json lists them)
const dir = path.join(R, 'auction'), index = JSON.parse(fs.readFileSync(path.join(dir, 'assets.json'), 'utf8'));
const PART = 245760;
for (const [id, entry] of Object.entries(index)) {
  if (entry.files.length === 1 && entry.files[0].endsWith('.glb')) { entry.bytes = fs.statSync(path.join(dir, entry.files[0])).size; continue; }
  const whole = Buffer.concat(entry.files.map((f) => fs.readFileSync(path.join(dir, f))));
  const doc = await io.readBinary(new Uint8Array(whole));
  await shrink(doc, CLASS.find(([re]) => re.test('auction/x'))[1], true);
  const bin = Buffer.from(await io.writeBinary(doc));
  entry.files.forEach((f) => fs.rmSync(path.join(dir, f)));
  entry.files = [];
  for (let i = 0; i * PART < bin.length; i++) {
    const name = `${id}.${i}.bin`;
    fs.writeFileSync(path.join(dir, name), bin.subarray(i * PART, (i + 1) * PART));
    entry.files.push(name);
  }
  console.log(('auction/' + id).padEnd(34), String(entry.bytes >> 10).padStart(5), '->', String(bin.length >> 10).padStart(5), 'KB');
  entry.bytes = bin.length;
}
fs.writeFileSync(path.join(dir, 'assets.json'), JSON.stringify(index, null, 2) + '\n');
