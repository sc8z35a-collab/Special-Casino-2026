#!/bin/sh
# The 3D models of the game and the three.js they need, made small for phones
# (meshopt geometry, WebP textures, fewer triangles):
#   the win titles (js/render/win3d.js)   img/3d/{win,big,super,ultra}.glb
#   the cars (js/render/garage3d.js)      img/3d/cars/<car id>.glb
#   the car studio                        img/3d/studio/{base,moving-head,spotlight,bookshelf}.glb
#   the garage (ガレージ3D)                img/3d/garage/garage.glb
#   three.js (one bundle for both)        js/vendor/three-bundle.js
# The originals (Meshy AI exports, 10-30 MB each) are not kept in the
# repository: put them in tools/3d/source/ (win.glb, big.glb, super.glb,
# ultra.glb, car-<car id>.glb, studio-base.glb, studio-moving-head.glb,
# studio-spotlight.glb, studio-bookshelf.glb, garage.glb: any of them) and run
#   sh tools/3d/build.sh
# then `node tools/stamp.mjs`. Needs Node.js 18+; the tools come from npm.
set -e
cd "$(dirname "$0")/../.."
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
npm install --prefix "$T" --no-audit --no-fund --silent three@0.170.0 esbuild@0.24.0 @gltf-transform/cli@4.1.1 cannon-es@0.20.0

cp tools/3d/three-entry.js "$T/entry.js"
mkdir -p js/vendor
"$T/node_modules/.bin/esbuild" "$T/entry.js" --bundle --format=iife --global-name=BR3D --minify --legal-comments=none --target=es2018 \
  --banner:js="/*! three.js r170 (MIT License, Copyright 2010-2024 Three.js Authors, https://threejs.org) and meshoptimizer's decoder (MIT License, Copyright 2016-2024 Arseny Kapoulkine), bundled with esbuild for the game's 3D (js/render/win3d.js, js/render/garage3d.js). */" \
  --outfile=js/vendor/three-bundle.js

cp tools/3d/tree-physics-entry.js "$T/tree-physics-entry.js"
"$T/node_modules/.bin/esbuild" "$T/tree-physics-entry.js" --bundle --format=iife --global-name=BRTreePhysics --minify --legal-comments=inline --target=es2018 \
  --banner:js="/*! cannon-es 0.20.0 (MIT License, Copyright 2020 cannon-es contributors). */" \
  --outfile=js/vendor/tree-physics.js
cp "$T/node_modules/cannon-es/LICENSE" js/vendor/cannon-es.LICENSE.txt

# source:output:how far the triangles are cut:texture size (the error limit keeps the shapes)
mkdir -p img/3d/effects-lite img/3d/cars img/3d/studio img/3d/garage img/3d/tree
for job in win:effects-lite/win:0.06:384 big:effects-lite/big:0.05:384 super:effects-lite/super:0.03:384 ultra:effects-lite/ultra:0.04:384 level-up:effects-lite/level-up:0.06:384 vip-extend:effects-lite/vip-extend:0.05:384 \
    car-blue-lightning:cars/blue-lightning:0.16:2048 \
    studio-base:studio/base:0.12:1024 studio-moving-head:studio/moving-head:0.08:1024 studio-spotlight:studio/spotlight:0.12:1024 \
    studio-bookshelf:studio/bookshelf:0.08:1024 garage:garage/garage:0.1:2048 \
    tree-stage-1:tree/stage-1:0.6:1024 tree-stage-2:tree/stage-2:0.6:1024 tree-stage-3:tree/stage-3:0.6:1024 \
    tree-stage-4:tree/stage-4:0.6:1024 tree-stage-5:tree/stage-5:0.6:1024 tree-stage-6:tree/stage-6:0.6:1024 \
    tree-stage-7:tree/stage-7:0.6:1024 tree-stage-8:tree/stage-8:0.6:1024 tree-stage-9:tree/stage-9:0.6:1024 \
    tree-seed:tree/seed:0.6:768 tree-preview:tree/preview:0.4:1024 tree-soil:tree/soil:0.6:1024 \
    tree-fertilizer:tree/fertilizer:0.6:768; do
  src=${job%%:*}; rest=${job#*:}; out=${rest%%:*}; rest=${rest#*:}; ratio=${rest%%:*}; tex=${rest#*:}
  [ -f "tools/3d/source/$src.glb" ] || continue
  "$T/node_modules/.bin/gltf-transform" optimize "tools/3d/source/$src.glb" "img/3d/$out.glb" \
    --compress meshopt --texture-compress webp --texture-size "$tex" \
    --simplify true --simplify-ratio "$ratio" --simplify-error 0.0008
  echo "img/3d/$out.glb: $(wc -c < "img/3d/$out.glb") bytes"
done
# Preserve the supplied fertilizer model on future builds. Generate the
# temporary bag only when no original or previously imported model exists.
if [ ! -f img/3d/tree/fertilizer.glb ]; then
  cp tools/3d/make-fertilizer.mjs "$T/make-fertilizer.mjs"
  node "$T/make-fertilizer.mjs" "$PWD/img/3d/tree/fertilizer.glb"
fi
node tools/3d/compress-previews.cjs
node tools/3d/tree-manifest.mjs
