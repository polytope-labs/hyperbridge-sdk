#!/usr/bin/env bash
rm -rf dist

pwd

wasm-pack build -t web -d dist/web --release --mode="normal" --no-default-features --out-name=web $1
wasm-pack build -t nodejs -d dist/node --release --mode="normal" --no-default-features --out-name=node $1

rm ./dist/**/.gitignore ./dist/**/README.md ./dist/**/package.json
