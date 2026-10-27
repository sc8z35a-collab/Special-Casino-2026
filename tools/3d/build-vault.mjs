// npm install --prefix <tools> three@0.170.0 meshoptimizer@0.22.0 esbuild@0.28.2
// node tools/3d/build-vault.mjs <tools>
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(path.resolve(process.argv[2] || '.', 'package.json'));
const { build } = require('esbuild'), THREE = require('three');
const shared = ['GLTFLoader', 'MeshoptDecoder', 'RoomEnvironment', 'OrbitControls'];
await build({ entryPoints: [path.join(root, 'tools/3d/vault-entry.js')], outfile: path.join(root, 'ops/vault3d.js'),
  bundle: true, format: 'iife', globalName: 'VAULT3D', minify: true, target: 'es2020', legalComments: 'none',
  nodePaths: [path.resolve(process.argv[2], 'node_modules')],
  banner: { js: '/*! three.js r170 addons and meshoptimizer 0.22 (MIT); core shared with js/vendor/three-bundle.js. */' },
  plugins: [{ name: 'shared-three-core', setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: 'core', namespace: 'shared-three' }));
    b.onResolve({ filter: /^three\/examples\/jsm\// }, args => {
      const name = path.basename(args.path).replace(/(?:\.module)?\.js$/, '');
      return shared.includes(name) || name === 'meshopt_decoder' ? { path: name === 'meshopt_decoder' ? 'MeshoptDecoder' : name, namespace: 'shared-three' } : undefined;
    });
    b.onLoad({ filter: /.*/, namespace: 'shared-three' }, args => ({ contents: args.path === 'core'
      ? Object.keys(THREE).filter(k => /^[$\w]+$/.test(k)).map(k => 'export const ' + k + '=window.BR3D.' + k + ';').join('\n')
      : 'export const ' + args.path + '=window.BR3D.' + args.path + ';', loader: 'js' }));
  } }]
});
