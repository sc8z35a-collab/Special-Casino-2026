#!/bin/sh
# The vault's 3D previews on the operator site (tools/3d/vault-entry.js):
# three.js, its loaders and exporter and meshoptimizer's simplifier, bundled
# into ops/vault3d.js (window.VAULT3D). Needs Node.js 18+; the tools come from npm.
#   sh tools/3d/build-vault.sh
set -e
cd "$(dirname "$0")/../.."
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
npm install --prefix "$T" --no-audit --no-fund --silent three@0.170.0 esbuild@0.24.0 meshoptimizer@0.22.0
cp tools/3d/vault-entry.js "$T/entry.js"
"$T/node_modules/.bin/esbuild" "$T/entry.js" --bundle --format=iife --global-name=VAULT3D --minify --legal-comments=none --target=es2020 \
  --banner:js="/*! three.js r170 (MIT License, Copyright 2010-2024 Three.js Authors, https://threejs.org) and meshoptimizer 0.22 (MIT License, Copyright 2016-2024 Arseny Kapoulkine), bundled with esbuild for the vault's 3D previews (tools/3d/vault-entry.js). */" \
  --outfile=ops/vault3d.js
