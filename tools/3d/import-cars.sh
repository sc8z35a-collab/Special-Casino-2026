#!/bin/sh
# Import the nine supplied cars without putting the large originals in git.
# Usage: sh tools/3d/import-cars.sh /path/to/source-glbs
set -eu
SOURCE=$(cd "${1:?Pass the folder containing the nine supplied GLBs}" && pwd)
cd "$(dirname "$0")/../.."
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
npm install --prefix "$T" --no-audit --no-fund --silent @gltf-transform/cli@4.1.1
node tools/3d/import-cars.mjs "$SOURCE" "$PWD" "$T/node_modules/.bin/gltf-transform"
