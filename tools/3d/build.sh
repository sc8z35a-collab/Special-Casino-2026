#!/bin/sh
# The 3D win titles (js/render/win3d.js): three.js for the game
# (js/vendor/three-win.js) and the models made small for phones (img/3d/*.glb:
# meshopt geometry, WebP textures of 1024 px at most, fewer triangles).
# The originals (Meshy AI exports, 10-30 MB each) are not kept in the
# repository: put them in tools/3d/source/ as win.glb, big.glb, super.glb and
# ultra.glb (any of them) and run
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
  --banner:js="/*! three.js r170 (MIT License, Copyright 2010-2024 Three.js Authors, https://threejs.org) and meshoptimizer's decoder (MIT License, Copyright 2016-2024 Arseny Kapoulkine): only the parts the 3D win titles use (js/render/win3d.js), bundled with esbuild. */" \
  --outfile=js/vendor/three-win.js

# how far each model's triangles are cut (the error limit keeps the shapes)
mkdir -p img/3d
for pair in win:0.18 big:0.14 super:0.09 ultra:0.12; do
  name=${pair%%:*}; ratio=${pair#*:}
  [ -f "tools/3d/source/$name.glb" ] || continue
  "$T/node_modules/.bin/gltf-transform" optimize "tools/3d/source/$name.glb" "img/3d/$name.glb" \
    --compress meshopt --texture-compress webp --texture-size 1024 \
    --simplify true --simplify-ratio "$ratio" --simplify-error 0.0008
  echo "img/3d/$name.glb: $(wc -c < "img/3d/$name.glb") bytes"
done
