import { copyFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname } from "node:path"

import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["src/index.ts"],
	outDir: "dist",
	format: ["cjs", "esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	splitting: false,
	treeshake: true,
	async onSuccess() {
		// Copy WebAssembly files to dist directory
		const wasmSourcePath = new URL("src/utils/ckb-mmr-wasm/dist/node/ckb_mmr_wasm_bg.wasm", import.meta.url)
			.pathname
		const wasmDestPath = new URL("dist/ckb_mmr_wasm_bg.wasm", import.meta.url).pathname

		// Ensure the destination directory exists
		const destDir = dirname(wasmDestPath)
		if (!existsSync(destDir)) {
			mkdirSync(destDir, { recursive: true })
		}

		// Copy the file
		copyFileSync(wasmSourcePath, wasmDestPath)
		console.log("Copied WebAssembly file to dist directory")
	},
})
