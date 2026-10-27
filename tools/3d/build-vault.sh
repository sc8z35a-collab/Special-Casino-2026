#!/bin/sh
# The vault's 3D previews on the operator site (tools/3d/vault-entry.js):
# three.js, its loaders and exporter and meshoptimizer's simplifier, bundled
# into ops/vault3d.js (window.VAULT3D). Needs Node.js 18+; the tools come from npm.
#   sh tools/3d/build-vault.sh
set -e
cd "$(dirname "$0")/../.."
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
npm install --prefix "$T" --no-audit --no-fund --silent three@0.170.0 esbuild@0.28.2 meshoptimizer@0.22.0
node tools/3d/build-vault.mjs "$T"
