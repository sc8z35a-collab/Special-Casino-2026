#!/bin/sh
# The 3D models of the game and the three.js they need, made small for phones
# (meshopt geometry, WebP textures, fewer triangles):
#   the win titles (js/render/win3d.js)   img/3d/{win,big,super,ultra}.glb
#   the cars (js/render/garage3d.js)      img/3d/cars/<car id>.glb
#   the car studio                        img/3d/studio/{base,moving-head,spotlight}.glb
#   three.js (one bundle for both)        js/vendor/three-bundle.js
# The originals (Meshy AI exports, 10-30 MB each) are not kept in the
# repository: put them in tools/3d/source/ (win.glb, big.glb, super.glb,
# ultra.glb, car-<car id>.glb, studio-base.glb, studio-moving-head.glb,
# studio-spotlight.glb: any of them) and run
#   sh tools/3d/build.sh
# then `node tools/stamp.mjs`. Needs Node.js 18+; the tools come from npm.
set -e
cd "$(dirname "$0")/../.."
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
npm install --prefix "$T" --no-audit --no-fund --silent three@0.170.0 esbuild@0.24.0 @gltf-transform/cli@4.1.1

cp tools/3d/three-entry.js "$T/entry.js"
mkdir -p js/vendor
"$T/node_modules/.bin/esbuild" "$T/entry.js" --bundle --format=iife --global-name=BR3D --minify --legal-comments=none --target=es2018 \
  --banner:js="/*! three.js r170 (MIT License, Copyright 2010-2024 Three.js Authors, https://threejs.org) and meshoptimizer's decoder (MIT License, Copyright 2016-2024 Arseny Kapoulkine), bundled with esbuild for the game's 3D (js/render/win3d.js, js/render/garage3d.js). */" \
  --outfile=js/vendor/three-bundle.js

# source:output:how far the triangles are cut:texture size (the error limit keeps the shapes)
mkdir -p img/3d/cars img/3d/studio
for job in win:win:0.18:1024 big:big:0.14:1024 super:super:0.09:1024 ultra:ultra:0.12:1024 \
    car-blue-lightning:cars/blue-lightning:0.16:2048 \
    studio-base:studio/base:0.12:1024 studio-moving-head:studio/moving-head:0.08:1024 studio-spotlight:studio/spotlight:0.12:1024; do
  src=${job%%:*}; rest=${job#*:}; out=${rest%%:*}; rest=${rest#*:}; ratio=${rest%%:*}; tex=${rest#*:}
  [ -f "tools/3d/source/$src.glb" ] || continue
  "$T/node_modules/.bin/gltf-transform" optimize "tools/3d/source/$src.glb" "img/3d/$out.glb" \
    --compress meshopt --texture-compress webp --texture-size "$tex" \
    --simplify true --simplify-ratio "$ratio" --simplify-error 0.0008
  echo "img/3d/$out.glb: $(wc -c < "img/3d/$out.glb") bytes"
done
