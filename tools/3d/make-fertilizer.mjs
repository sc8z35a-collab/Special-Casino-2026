// A small original fertilizer bag, generated without textures. Run from a
// directory with three@0.170.0 installed (tools/3d/build.sh does this).
import fs from 'node:fs';
import * as T from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => { this.result = result; this.onloadend?.(); });
  }
};
const root = new T.Group();
root.name = 'Fertilizer bag';
const green = new T.MeshStandardMaterial({ color: 0x3f8841, roughness: 0.88, flatShading: true });
const cream = new T.MeshStandardMaterial({ color: 0xffe8b3, roughness: 0.9 });
const dark = new T.MeshStandardMaterial({ color: 0x1c612f, roughness: 0.85 });
function mesh(geometry, material, x, y, z) {
  const m = new T.Mesh(geometry, material);
  m.position.set(x, y, z);
  root.add(m);
  return m;
}
mesh(new T.SphereGeometry(1, 10, 8), green, 0, 0.24, 0).scale.set(0.17, 0.22, 0.11);
mesh(new T.CylinderGeometry(0.075, 0.1, 0.08, 8), green, 0, 0.45, 0);
mesh(new T.TorusGeometry(0.08, 0.012, 4, 12), cream, 0, 0.43, 0).rotation.x = Math.PI / 2;
mesh(new T.BoxGeometry(0.21, 0.22, 0.012), cream, 0, 0.25, 0.102);
mesh(new T.BoxGeometry(0.012, 0.11, 0.014), dark, 0, 0.245, 0.117);
mesh(new T.SphereGeometry(1, 8, 4), dark, -0.035, 0.285, 0.119).scale.set(0.048, 0.022, 0.008);
mesh(new T.SphereGeometry(1, 8, 4), dark, 0.035, 0.31, 0.119).scale.set(0.048, 0.022, 0.008);
const out = process.argv[2];
if (!out) throw new Error('Pass the destination .glb path');
fs.writeFileSync(out, Buffer.from(await new GLTFExporter().parseAsync(root, { binary: true })));
console.log('fertilizer.glb: ' + fs.statSync(out).size + ' bytes');
