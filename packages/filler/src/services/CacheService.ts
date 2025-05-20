import fs from "fs"
import path from "path"

interface GasEstimateCache {
	fillGas: string
	postGas: string
	timestamp: number
}

interface SwapOperationsCache {
	calls: {
		to: string
		data: string
		value: string
	}[]
	totalGasEstimate: string
	timestamp: number
}

interface CacheData {
	gasEstimates: Record<string, GasEstimateCache>
	swapOperations: Record<string, SwapOperationsCache>
}

export class CacheService {
	private cacheFile: string
	private cacheData: CacheData
	private readonly CACHE_EXPIRY_MS = 10 * 1000 // 10 seconds

	constructor() {
		this.cacheFile = path.join(process.cwd(), "cache", "filler-cache.json")
		this.cacheData = this.loadCache()
	}

	private loadCache(): CacheData {
		try {
			if (fs.existsSync(this.cacheFile)) {
				const data = fs.readFileSync(this.cacheFile, "utf-8")
				return JSON.parse(data)
			}
		} catch (error) {
			console.warn("Error loading cache:", error)
		}
		return { gasEstimates: {}, swapOperations: {} }
	}

	private saveCache() {
		try {
			const dir = path.dirname(this.cacheFile)
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true })
			}
			fs.writeFileSync(this.cacheFile, JSON.stringify(this.cacheData, null, 2))
		} catch (error) {
			console.warn("Error saving cache:", error)
		}
	}

	private isCacheValid(timestamp: number): boolean {
		return Date.now() - timestamp < this.CACHE_EXPIRY_MS
	}

	getGasEstimate(orderId: string): { fillGas: bigint; postGas: bigint } | null {
		const cache = this.cacheData.gasEstimates[orderId]
		if (cache && this.isCacheValid(cache.timestamp)) {
			return {
				fillGas: BigInt(cache.fillGas),
				postGas: BigInt(cache.postGas),
			}
		}
		return null
	}

	setGasEstimate(orderId: string, fillGas: bigint, postGas: bigint) {
		this.cacheData.gasEstimates[orderId] = {
			fillGas: fillGas.toString(),
			postGas: postGas.toString(),
			timestamp: Date.now(),
		}
		this.saveCache()
	}

	getSwapOperations(
		orderId: string,
	): { calls: { to: string; data: string; value: string }[]; totalGasEstimate: bigint } | null {
		const cache = this.cacheData.swapOperations[orderId]
		if (cache && this.isCacheValid(cache.timestamp)) {
			return {
				calls: cache.calls,
				totalGasEstimate: BigInt(cache.totalGasEstimate),
			}
		}
		return null
	}

	setSwapOperations(orderId: string, calls: { to: string; data: string; value: string }[], totalGasEstimate: bigint) {
		this.cacheData.swapOperations[orderId] = {
			calls,
			totalGasEstimate: totalGasEstimate.toString(),
			timestamp: Date.now(),
		}
		this.saveCache()
	}

	clearExpiredCache() {
		const now = Date.now()
		Object.keys(this.cacheData.gasEstimates).forEach((key) => {
			if (!this.isCacheValid(this.cacheData.gasEstimates[key].timestamp)) {
				delete this.cacheData.gasEstimates[key]
			}
		})
		Object.keys(this.cacheData.swapOperations).forEach((key) => {
			if (!this.isCacheValid(this.cacheData.swapOperations[key].timestamp)) {
				delete this.cacheData.swapOperations[key]
			}
		})
		this.saveCache()
	}
}
