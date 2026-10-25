/* Preview-only GLBs, using the meshoptimizer already shipped in our bundles.
   No npm installation. Texture resizing uses Pillow, as tools/art already does.
   Run: node tools/3d/compress-previews.cjs
   Main tree stages and the auction's actual lots are deliberately excluded. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const FILES = ['img/3d/tree/seed.glb', 'img/3d/tree/preview.glb'];
const MAX_BYTES = 300000, MAX_TRIANGLES = 8000, MAX_TEXTURE = 512;

async function meshoptimizer() {
  const context = vm.createContext({ WebAssembly, TextDecoder, TextEncoder, console, atob, setTimeout,
    Uint8Array, Uint16Array, Uint32Array, Int16Array, Int32Array, Float32Array });
  // vault-entry.js uses MeshoptSimplifier but exposes only the browser UI.
  // Expose its existing instance in an in-memory copy; never edit the bundle.
  const bundle = fs.readFileSync(path.join(ROOT, 'ops/vault3d.js'), 'utf8');
  const calls = [...bundle.matchAll(/\b([\w$]+)\.simplify\(/g)];
  const end = bundle.lastIndexOf('return ');
  assert.equal(calls.length, 1, 'Check the rebuilt vault bundle before compressing previews');
  assert.match(bundle.slice(end), /^return [\w$]+\([\w$]+\);\}\)\(\);\s*$/);
  vm.runInContext(bundle.slice(0, end) + `globalThis.previewSimplifier=${calls[0][1]};` + bundle.slice(end), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/vendor/three-bundle.js'), 'utf8'), context);
  const decoder = context.BR3D.MeshoptDecoder, simplifier = context.previewSimplifier;
  await Promise.all([decoder.ready, simplifier.ready]);
  return { decoder, simplifier };
}

function read(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12), offset = 20 + jsonLength;
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  assert.equal(bytes.readUInt32LE(offset + 4), 0x004e4942);
  return { bytes, doc: JSON.parse(bytes.subarray(20, offset).toString()), bin: bytes.subarray(offset + 8) };
}
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TYPES = { 5120: ['readInt8', 1, 127], 5121: ['readUInt8', 1, 255],
  5122: ['readInt16LE', 2, 32767], 5123: ['readUInt16LE', 2, 65535],
  5125: ['readUInt32LE', 4, 4294967295], 5126: ['readFloatLE', 4, 1] };
const round4 = n => (n + 3) & ~3;

function compress(input, decoder, simplifier) {
  const { doc, bin } = input, decoded = new Map();
  assert.ok(!doc.skins?.length && !doc.animations?.length, 'Only static previews are supported');
  function view(id) {
    if (decoded.has(id)) return decoded.get(id);
    const v = doc.bufferViews[id], ext = v.extensions?.EXT_meshopt_compression;
    let data;
    if (ext) {
      assert.equal(ext.buffer, 0);
      const out = new Uint8Array(ext.count * ext.byteStride);
      decoder.decodeGltfBuffer(out, ext.count, ext.byteStride,
        bin.subarray(ext.byteOffset || 0, (ext.byteOffset || 0) + ext.byteLength), ext.mode, ext.filter || 'NONE');
      data = Buffer.from(out);
    } else {
      assert.equal(v.buffer, 0);
      data = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    }
    decoded.set(id, data);
    return data;
  }
  function accessor(id) {
    const a = doc.accessors[id];
    assert.ok(!a.sparse && COMPONENTS[a.type] && TYPES[a.componentType]);
    const [method, bytes, divisor] = TYPES[a.componentType], components = COMPONENTS[a.type];
    const stride = doc.bufferViews[a.bufferView].byteStride || bytes * components;
    const data = view(a.bufferView), offset = a.byteOffset || 0;
    const value = (v, k = 0) => data[method](offset + v * stride + k * bytes);
    return { a, data, offset, stride, bytes, components, divisor, value };
  }
  const out = structuredClone(doc), chunks = [], views = [], accessors = [];
  let length = 0, triangles = 0;
  function addView(data, options = {}) {
    const id = views.length;
    views.push({ buffer: 0, byteOffset: length, byteLength: data.length, ...options });
    chunks.push(data, Buffer.alloc(round4(data.length) - data.length));
    length += round4(data.length);
    return id;
  }
  for (const mesh of out.meshes || []) for (const primitive of mesh.primitives) {
    assert.equal(primitive.mode ?? 4, 4);
    assert.ok(!primitive.targets, 'Morph targets are not preview-only geometry');
    const index = accessor(primitive.indices), pos = accessor(primitive.attributes.POSITION);
    const indices = Uint32Array.from({ length: index.a.count }, (_, i) => index.value(i));
    const xyz = new Float32Array(pos.a.count * 3);
    for (let v = 0; v < pos.a.count; v++) for (let k = 0; k < 3; k++) {
      const raw = pos.value(v, k);
      xyz[v * 3 + k] = pos.a.normalized ? Math.max(-1, raw / pos.divisor) : raw;
    }
    const cut = indices.length > MAX_TRIANGLES * 3
      ? simplifier.simplify(indices, xyz, 3, MAX_TRIANGLES * 3, 0.05, ['LockBorder'])[0] : indices;
    assert.ok(cut.length > 0 && cut.length % 3 === 0);
    triangles += cut.length / 3;
    const used = [...new Set(cut)], remap = new Map(used.map((v, i) => [v, i]));
    const size = used.length > 65535 ? 4 : 2, data = Buffer.alloc(cut.length * size);
    for (let i = 0; i < cut.length; i++) data[size === 4 ? 'writeUInt32LE' : 'writeUInt16LE'](remap.get(cut[i]), i * size);
    primitive.indices = accessors.length;
    accessors.push({ type: 'SCALAR', componentType: size === 4 ? 5125 : 5123, count: cut.length,
      bufferView: addView(data, { target: 34963 }) });
    for (const [name, id] of Object.entries(primitive.attributes)) {
      const attr = accessor(id), stride = round4(attr.bytes * attr.components), data = Buffer.alloc(used.length * stride);
      used.forEach((v, i) => attr.data.copy(data, i * stride, attr.offset + v * attr.stride,
        attr.offset + v * attr.stride + attr.bytes * attr.components));
      const a = { ...attr.a, count: used.length, byteOffset: 0, bufferView: addView(data, { target: 34962, byteStride: stride }) };
      if (a.min || a.max) {
        a.min = Array.from({ length: attr.components }, (_, k) => used.reduce((n, v) => Math.min(n, attr.value(v, k)), Infinity));
        a.max = Array.from({ length: attr.components }, (_, k) => used.reduce((n, v) => Math.max(n, attr.value(v, k)), -Infinity));
      }
      primitive.attributes[name] = accessors.length;
      accessors.push(a);
    }
  }
  for (const image of out.images || []) {
    assert.equal(image.mimeType, 'image/webp');
    const data = execFileSync('python3', ['-c',
      'import io,sys; from PIL import Image; im=Image.open(io.BytesIO(sys.stdin.buffer.read())); ' +
      `im.thumbnail((${MAX_TEXTURE},${MAX_TEXTURE}),Image.Resampling.LANCZOS); ` +
      'im.save(sys.stdout.buffer,format="WEBP",quality=80,method=6)'], { input: view(image.bufferView) });
    image.bufferView = addView(data);
  }
  out.accessors = accessors; out.bufferViews = views; out.buffers = [{ byteLength: length }];
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (out[key]) out[key] = out[key].filter(e => e !== 'EXT_meshopt_compression');
  }
  const json = Buffer.from(JSON.stringify(out)), padded = Buffer.concat([json, Buffer.alloc(round4(json.length) - json.length, 32)]);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + padded.length + length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(length); binHeader.writeUInt32LE(0x004e4942, 4);
  return { bytes: Buffer.concat([header, padded, binHeader, ...chunks]), triangles };
}

(async () => {
  const { decoder, simplifier } = await meshoptimizer();
  const pending = FILES.filter(rel => fs.existsSync(path.join(ROOT, rel))).map(rel => {
    const input = read(path.join(ROOT, rel));
    const triangles = (input.doc.meshes || []).reduce((n, m) => n + m.primitives.reduce((s, p) =>
      s + input.doc.accessors[p.indices].count / 3, 0), 0);
    // Already produced by this tool: preserve its textures byte-for-byte on reruns.
    if (input.bytes.length <= MAX_BYTES && triangles <= MAX_TRIANGLES &&
        !(input.doc.extensionsUsed || []).includes('EXT_meshopt_compression')) {
      const sizes = (input.doc.images || []).map(image => {
        const view = input.doc.bufferViews[image.bufferView];
        return Number(execFileSync('python3', ['-c',
          'import io,sys; from PIL import Image; print(max(Image.open(io.BytesIO(sys.stdin.buffer.read())).size))'],
        { input: input.bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength) }).toString());
      });
      if (sizes.every(size => size <= MAX_TEXTURE)) return { rel, input, result: { bytes: input.bytes, triangles } };
    }
    const result = compress(input, decoder, simplifier);
    assert.ok(result.bytes.length <= MAX_BYTES, `${rel}: ${result.bytes.length} bytes exceeds preview budget`);
    return { rel, input, result };
  });
  // Check every result before replacing either file. Never replace with a larger copy.
  for (const { rel, input, result } of pending) {
    const smaller = result.bytes.length < input.bytes.length;
    if (smaller) fs.writeFileSync(path.join(ROOT, rel), result.bytes);
    console.log(JSON.stringify({ path: rel, before: input.bytes.length,
      after: smaller ? result.bytes.length : input.bytes.length, triangles: result.triangles, maxTexture: MAX_TEXTURE }));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
