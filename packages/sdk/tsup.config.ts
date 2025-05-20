import { defineConfig } from "tsup"
import { dirname } from "node:path"
import { copyFileSync, mkdirSync, existsSync } from "node:fs"

export default defineConfig({
	entry: ["src/index.ts"],
	outDir: "dist",
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	splitting: false,
	treeshake: true,
	async onSuccess() {
		// Copy WebAssembly files to dist directory
		const fullPath = (path: string) => new URL(path, import.meta.url).pathname

		let files = [
			{ from: "src/utils/ckb-mmr-wasm/dist/node/node_bg.wasm", to: "dist/node_bg.wasm" },
			{ from: "src/utils/ckb-mmr-wasm/dist/web/web_bg.wasm", to: "dist/web_bg.wasm" },
		]

		files = files.map((e) => ({
			from: fullPath(e.from),
			to: fullPath(e.to),
		}))

		// Ensure the destination directory exists
		for (const entry of files) {
			const dest_dir = dirname(entry.to)

			if (!existsSync(dest_dir)) {
				mkdirSync(dest_dir, { recursive: true })
			}

			// Copy the file
			copyFileSync(entry.from, entry.to)
		}

		console.log("📦 Copied WebAssembly files to dist directory")
	},
})
