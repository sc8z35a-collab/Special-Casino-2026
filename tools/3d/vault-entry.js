// The 3D models in the developer's vault (ops/ops.js), as one global
// (window.VAULT3D), bundled into ops/vault3d.js by tools/3d/build-vault.sh.
// Everything happens in the developer's browser; the server only keeps what
// comes out of it:
// - analyze(): what is in a model (meshes, triangles, materials, textures,
//   size, animations), one picture of it from four sides (front, right, top,
//   3/4: the same light and background every time, a grid under it, for a
//   person or an AI to see it at a glance), and a light copy of it (at most
//   LIGHT_TRIS triangles, textures LIGHT_TEX px) to turn around in 3D.
// - view(): a model turning in a box (drag to turn, pinch or wheel to zoom).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer/meshopt_simplifier.module.js';

const KINDS = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply'];
const SIDE = 320;             // one view of the picture (px); the picture is 2 x 2 of them
const LIGHT_TRIS = 60000;
const LIGHT_TEX = 512;
const LIGHT_FROM = 4 * 1048576;   // smaller models are their own light copy

export function kindOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  const k = m ? m[1].toLowerCase() : '';
  return KINDS.includes(k) ? k : '';
}

const grey = () => new THREE.MeshStandardMaterial({ color: 0xb8bcc6, roughness: 0.6, metalness: 0.1 });

async function load(buf, kind) {
  if (kind === 'glb' || kind === 'gltf') {
    const l = new GLTFLoader();
    l.setMeshoptDecoder(MeshoptDecoder);
    const g = await l.parseAsync(kind === 'gltf' ? new TextDecoder().decode(buf) : buf, '');
    return { root: g.scene, animations: g.animations || [] };
  }
  if (kind === 'obj') return { root: new OBJLoader().parse(new TextDecoder().decode(buf)), animations: [] };
  if (kind === 'fbx') {
    const o = new FBXLoader().parse(buf, '');
    return { root: o, animations: o.animations || [] };
  }
  if (kind === 'stl') return { root: new THREE.Mesh(new STLLoader().parse(buf), grey()), animations: [] };
  if (kind === 'ply') {
    const g = new PLYLoader().parse(buf);
    if (!g.index && g.attributes.position.count % 3) {
      return { root: new THREE.Points(g, new THREE.PointsMaterial({ size: 0.01, vertexColors: !!g.attributes.color })), animations: [] };
    }
    g.computeVertexNormals();
    const mat = grey();
    mat.vertexColors = !!g.attributes.color;
    return { root: new THREE.Mesh(g, mat), animations: [] };
  }
  throw new Error('この形式は3Dプレビューに対応していません（glb・gltf・obj・fbx・stl・ply）');
}

function materialsOf(o) { return (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean); }

function infoOf(root, animations) {
  root.updateMatrixWorld(true);
  let meshes = 0, tris = 0, verts = 0, skinned = 0, morphs = 0;
  const mats = new Set(), texs = new Map();
  root.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return;
    const g = o.geometry, pos = g && g.attributes.position;
    if (!pos) return;
    meshes++;
    verts += pos.count;
    if (o.isMesh) tris += (g.index ? g.index.count : pos.count) / 3;
    if (o.isSkinnedMesh) skinned++;
    if (g.morphAttributes && g.morphAttributes.position) morphs++;
    materialsOf(o).forEach((m) => {
      mats.add(m);
      Object.keys(m).forEach((k) => {
        const t = m[k];
        if (t && t.isTexture && t.image) texs.set(t, Math.max(t.image.width || 0, t.image.height || 0));
      });
    });
  });
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  let maxTex = 0;
  texs.forEach((s) => { maxTex = Math.max(maxTex, s); });
  return {
    meshes, triangles: Math.round(tris), vertices: verts, materials: mats.size, textures: texs.size, maxTexture: maxTex,
    size: [size.x, size.y, size.z].map((v) => Number(v.toPrecision(4))), skinned, morphs,
    animations: animations.slice(0, 20).map((a) => ({ name: a.name || '', seconds: Number((a.duration || 0).toFixed(2)) }))
  };
}

function lights(scene, renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a44, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  return pmrem;
}

// the four sides on one picture (WebP, JPEG where WebP cannot be made)
function picture(root) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIDE, SIDE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2c3038);
  const pmrem = lights(scene, renderer);
  scene.add(root);
  const box = new THREE.Box3().setFromObject(root), sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius || 1;
  const grid = new THREE.GridHelper(r * 4, 16, 0x8a90a0, 0x4a505c);
  grid.position.set(sphere.center.x, box.min.y, sphere.center.z);
  scene.add(grid);
  const cam = new THREE.PerspectiveCamera(30, 1, r / 100, r * 100);
  const dist = r / Math.sin(THREE.MathUtils.degToRad(15)) * 1.04;
  // (glTF: +Y up, +Z front)
  const views = [['FRONT +Z', [0, 0, 1]], ['RIGHT +X', [1, 0, 0]], ['TOP +Y', [0, 1, 0]], ['3/4', [1, 0.7, 1]]];
  const out = document.createElement('canvas');
  out.width = SIDE * 2;
  out.height = SIDE * 2;
  const ctx = out.getContext('2d');
  views.forEach(([label, d], i) => {
    const v = new THREE.Vector3(d[0], d[1], d[2]).normalize();
    cam.position.copy(sphere.center).addScaledVector(v, dist);
    if (d[1] === 1) cam.up.set(0, 0, -1); else cam.up.set(0, 1, 0);
    cam.lookAt(sphere.center);
    renderer.render(scene, cam);
    const x = (i % 2) * SIDE, y = Math.floor(i / 2) * SIDE;
    ctx.drawImage(renderer.domElement, x, y);
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = 'rgba(0, 0, 0, .55)';
    ctx.fillRect(x + 6, y + 6, ctx.measureText(label).width + 12, 22);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 12, y + 22);
  });
  ctx.strokeStyle = 'rgba(255, 255, 255, .25)';
  ctx.beginPath();
  ctx.moveTo(SIDE, 0); ctx.lineTo(SIDE, SIDE * 2);
  ctx.moveTo(0, SIDE); ctx.lineTo(SIDE * 2, SIDE);
  ctx.stroke();
  scene.remove(root);
  pmrem.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  const webp = out.toDataURL('image/webp', 0.8);
  return webp.indexOf('data:image/webp') === 0 ? webp : out.toDataURL('image/jpeg', 0.82);
}

// a mesh with only the vertices its triangles use
function compact(geo, index) {
  const remap = new Int32Array(geo.attributes.position.count).fill(-1);
  const out = new Uint32Array(index.length);
  let n = 0;
  for (let i = 0; i < index.length; i++) {
    const v = index[i];
    if (remap[v] < 0) remap[v] = n++;
    out[i] = remap[v];
  }
  const g = new THREE.BufferGeometry();
  Object.keys(geo.attributes).forEach((name) => {
    const a = geo.attributes[name], size = a.itemSize;
    const arr = new (a.array.constructor)(n * size);
    for (let v = 0; v < remap.length; v++) {
      const to = remap[v];
      if (to < 0) continue;
      for (let k = 0; k < size; k++) arr[to * size + k] = a.getComponent(v, k);
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, size, a.normalized));
  });
  g.setIndex(new THREE.BufferAttribute(n > 65535 ? out : new Uint16Array(out), 1));
  return g;
}

// fewer triangles (one model: at most LIGHT_TRIS), textures LIGHT_TEX px: a GLB
async function lightCopy(root, animations, total) {
  const ratio = Math.min(1, LIGHT_TRIS / Math.max(1, total));
  if (ratio < 0.95) {
    await MeshoptSimplifier.ready;
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const g0 = o.geometry;
      if ((g0.groups && g0.groups.length > 1) || (g0.morphAttributes && g0.morphAttributes.position)) return;
      const g = mergeVertices(g0.index ? g0 : g0.clone(), 1e-4);
      if (!g.index) return;
      const index = new Uint32Array(g.index.array);
      const pos = g.attributes.position;
      const xyz = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) { xyz[v * 3] = pos.getX(v); xyz[v * 3 + 1] = pos.getY(v); xyz[v * 3 + 2] = pos.getZ(v); }
      const target = Math.max(3, Math.floor(index.length * ratio / 3) * 3);
      const [cut] = MeshoptSimplifier.simplify(index, xyz, 3, target, 0.02, ['LockBorder']);
      if (cut.length && cut.length < index.length) o.geometry = compact(g, cut);
    });
  }
  const glb = await new GLTFExporter().parseAsync(root, { binary: true, maxTextureSize: LIGHT_TEX, animations, onlyVisible: true });
  return new Blob([glb], { type: 'model/gltf-binary' });
}

// what is in it, its picture, and its light copy (null: the model is light already)
export async function analyze(file, name) {
  const kind = kindOf(name || file.name);
  if (!kind) throw new Error('3Dモデルではありません');
  const buf = await file.arrayBuffer();
  const { root, animations } = await load(buf, kind);
  const info = infoOf(root, animations);
  info.format = kind;
  const preview = picture(root);
  const light = file.size > LIGHT_FROM ? await lightCopy(root, animations, info.triangles) : null;
  return { info, preview, light };
}

// the model turning in `host`; { stop() }
export async function view(host, buf, name) {
  const { root } = await load(buf, kindOf(name) || 'glb');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2c3038);
  const pmrem = lights(scene, renderer);
  scene.add(root);
  const box = new THREE.Box3().setFromObject(root), sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius || 1;
  const grid = new THREE.GridHelper(r * 4, 16, 0x8a90a0, 0x4a505c);
  grid.position.set(sphere.center.x, box.min.y, sphere.center.z);
  scene.add(grid);
  const cam = new THREE.PerspectiveCamera(35, 1, r / 100, r * 100);
  cam.position.copy(sphere.center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(r / Math.sin(THREE.MathUtils.degToRad(17.5)) * 1.05));
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.target.copy(sphere.center);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;
  controls.addEventListener('start', () => { controls.autoRotate = false; });
  function size() {
    const w = host.clientWidth || 320, h = host.clientHeight || 320;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }
  size();
  const ro = new ResizeObserver(size);
  ro.observe(host);
  let on = true;
  (function frame() {
    if (!on) return;
    controls.update();
    renderer.render(scene, cam);
    requestAnimationFrame(frame);
  })();
  return {
    stop() {
      on = false;
      ro.disconnect();
      controls.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  };
}
