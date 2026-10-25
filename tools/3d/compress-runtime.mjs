// Compress every shipped model while preserving node hierarchies and clips.
// Usage: node tools/3d/compress-runtime.mjs /path/to/gltf-transform
// Run from a clean source revision. Re-running against this report is a no-op.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = path.resolve(new URL('../..', import.meta.url).pathname);
const cli = process.argv[2]; if (!cli) throw Error('Pass gltf-transform 4.1.1');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-models-'));
const reportPath = path.join(root, 'docs/model-compression.json');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const previous = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath)).models : [];
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]); }
function stats(b) {
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  return {
    triangles: (j.meshes || []).reduce((n, m) => n + m.primitives.reduce((s, p) => s + j.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0), 0),
    animations: (j.animations || []).map(a => ({ name: a.name || '', channels: a.channels.length, duration: Math.max(0, ...a.samplers.map(s => j.accessors[s.input].max?.[0] || 0)) })),
    joints: (j.skins || []).map(s => s.joints.length),
    morphTargets: (j.meshes || []).flatMap(m => m.primitives.map(p => (p.targets || []).length))
  };
}
const catalogFile = path.join(root, 'img/3d/auction/assets.json');
const catalog = JSON.parse(fs.readFileSync(catalogFile));
const jobs = walk(path.join(root, 'img/3d')).filter(p => p.endsWith('.glb')).map(p => ({ name: path.relative(root, p), files: [p] }));
for (const [id, entry] of Object.entries(catalog)) if (entry.files.length > 1) jobs.push({ name: 'auction/' + id, files: entry.files.map(f => path.join(root, 'img/3d/auction', f)), entry });
const rows = [];
try {
  for (const job of jobs) {
    const current = Buffer.concat(job.files.map(f => fs.readFileSync(f)));
    const old = previous.find(r => r.name === job.name && r.sha256 === hash(current));
    if (old) { rows.push(old); continue; }
    const before = Buffer.concat(job.files.map(f => execFileSync('git', ['show', 'HEAD:' + path.relative(root, f)], { cwd: root, maxBuffer: 64 * 1024 * 1024 })));
    const input = path.join(work, 'in.glb'), output = path.join(work, 'out.glb'); fs.writeFileSync(input, before);
    execFileSync(cli, ['optimize', input, output, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '512', '--simplify', 'true', '--simplify-ratio', '.45', '--simplify-error', '.0006', '--flatten', 'false', '--join', 'false', '--instance', 'false', '--palette', 'false'], { stdio: 'ignore' });
    const quantized = path.join(work, 'quantized.glb');
    execFileSync(cli, ['meshopt', output, quantized, '--level', 'high', '--quantize-position', '12', '--quantize-normal', '8', '--quantize-texcoord', '10'], { stdio: 'ignore' });
    if (fs.statSync(quantized).size < fs.statSync(output).size) fs.copyFileSync(quantized, output);
    const candidate = fs.readFileSync(output), a = stats(before), b = stats(candidate);
    if (JSON.stringify(a.animations) !== JSON.stringify(b.animations) || JSON.stringify(a.joints) !== JSON.stringify(b.joints)) throw Error('Animation/skeleton changed: ' + job.name);
    const after = candidate.length < before.length ? candidate : before;
    if (job.entry) {
      // Keep part names stable; the loader uses the byte count in the catalog.
      const chunk = Math.ceil(after.length / job.files.length);
      job.files.forEach((file, i) => fs.writeFileSync(file, after.subarray(i * chunk, Math.min(after.length, (i + 1) * chunk))));
      job.entry.bytes = after.length;
    } else fs.writeFileSync(job.files[0], after);
    // Two small auction models are direct GLBs and also occur in the index.
    for (const entry of Object.values(catalog)) if (entry.files.length === 1 && path.basename(job.files[0]) === entry.files[0]) entry.bytes = after.length;
    const row = { name: job.name, files: job.files.map(f => path.relative(root, f)), before: before.length, after: after.length, beforeTriangles: a.triangles, afterTriangles: stats(after).triangles, animations: a.animations, joints: a.joints, sha256: hash(after) };
    rows.push(row); console.log(JSON.stringify({ name: row.name, before: row.before, after: row.after }));
  }
  for (const entry of Object.values(catalog)) entry.bytes = entry.files.reduce((n, file) => n + fs.statSync(path.join(root, 'img/3d/auction', file)).size, 0);
  fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
  const report = { tool: '@gltf-transform/cli 4.1.1', textureMax: 512, simplifyRatio: .45, simplifyError: .0006, quantization: { position: 12, normal: 8, texcoord: 10 }, models: rows, before: rows.reduce((n, r) => n + r.before, 0), after: rows.reduce((n, r) => n + r.after, 0) };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ count: rows.length, before: report.before, after: report.after }));
} finally { fs.rmSync(work, { recursive: true, force: true }); }
