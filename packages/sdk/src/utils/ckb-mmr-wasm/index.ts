import { hasWindow, isNode } from "std-env"

async function loadModule() {
	if (hasWindow) return await import("./dist/web/ckb_mmr_wasm")

	if (isNode) return await import("./dist/node/ckb_mmr_wasm")

	throw new Error("Unknown environment")
}

export default loadModule
