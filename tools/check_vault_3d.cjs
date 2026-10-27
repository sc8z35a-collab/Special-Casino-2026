const assert = require('node:assert/strict'), path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const { startServer } = await import(path.resolve(__dirname, '../server/test/helpers.js'));
  const s = await startServer(); let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.OPS_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage(); await page.goto(s.base + '/ops/');
    const result = await page.evaluate(async () => {
      if (window.VAULT3D) throw Error('vault renderer was eager');
      await OpsLoad.load('../js/vendor/three-bundle.js'); const core = window.BR3D;
      await OpsLoad.load('vault3d.js');
      const rows = [];
      for (const name of ['preview', 'seed']) {
        const buf = await (await fetch('/img/3d/tree/' + name + '.glb')).arrayBuffer();
        const file = new File([buf], name + '.glb'), report = await VAULT3D.analyze(file);
        const host = document.createElement('div'); host.style.width = '300px'; host.style.height = '200px'; document.body.appendChild(host);
        const view = await VAULT3D.view(host, buf, file.name); const canvas = !!host.querySelector('canvas'); view.stop(); host.remove();
        rows.push({ name, info: report.info, preview: report.preview.startsWith('data:image/'), canvas });
        if (name === 'seed') {
          // A valid unknown GLB chunk makes the same small geometry a >4 MiB
          // upload, exercising the existing lightweight-copy/exporter path.
          const pad = 5 * 1048576, large = new Uint8Array(buf.byteLength + 8 + pad); large.set(new Uint8Array(buf));
          const v = new DataView(large.buffer); v.setUint32(8, large.byteLength, true); v.setUint32(buf.byteLength, pad, true); v.setUint32(buf.byteLength + 4, 0x54534554, true);
          const exported = await VAULT3D.analyze(new File([large], 'large.glb'));
          rows.push({ name: 'large', light: !!exported.light && exported.light.size > 100, triangles: exported.info.triangles });
        }
      }
      return { shared: core === window.BR3D, rows, formats: ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply'].map(k => VAULT3D.kindOf('x.' + k)) };
    });
    assert.ok(result.shared); assert.deepEqual(result.formats, ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply']);
    for (const row of result.rows) if (row.name === 'large') assert.ok(row.light && row.triangles > 0); else assert.ok(row.info.triangles > 0 && row.preview && row.canvas, JSON.stringify(row));
    console.log('PASS shared Three core: both remaining Meshopt models analyze/render, four-side pictures and large-upload GLB export retain all six formats');
  } finally { if (browser) await browser.close(); await s.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
