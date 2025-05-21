#!/usr/bin/env bash
rm -rf dist

pwd

echo ">> Generate Distribution"
wasm-pack build -t web -d dist/web --release --mode="normal" --no-default-features --out-name=web $1
wasm-pack build -t nodejs -d dist/node --release --mode="normal" --no-default-features --out-name=node $1

echo ">> Remove unnecessary files from dist folder"
rm ./dist/**/.gitignore ./dist/**/README.md ./dist/**/package.json

echo ">> Replace CJS with ESM"
cp ./overwrites/node-esm.js ./dist/node/node.js
