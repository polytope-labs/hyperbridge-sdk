#!/usr/bin/env bash
rm -rf dist

pwd

wasm-pack build -t web -d dist/web --release --no-default-features $1
wasm-pack build -t bundler -d dist/bundler --release --no-default-features $1
wasm-pack build -t nodejs -d dist/node --release --no-default-features $1

rm dist/bundler/.gitignore dist/bundler/package.json dist/bundler/README.md # dist/bundler/hyperclient.d.ts
rm dist/node/.gitignore dist/node/package.json dist/node/README.md # dist/node/hyperclient.d.ts
