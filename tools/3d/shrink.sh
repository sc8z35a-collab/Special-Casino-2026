#!/bin/sh
# Makes the shipped 3D models smaller still (see tools/3d/shrink.mjs). Needs Node.js 18+.
set -e
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
npm install --prefix "$T" --no-audit --no-fund --silent @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 @gltf-transform/functions@4.1.1 meshoptimizer@0.22.0 sharp
cp tools/3d/shrink.mjs "$T/shrink.mjs"
(cd "$T" && node shrink.mjs "$ROOT")
