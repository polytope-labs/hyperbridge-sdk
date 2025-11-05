import stringify from "safe-stable-stringify"
import { createStorage } from "unstorage"
// @ts-expect-error failed to resolve types
import inMemoryDriver from "unstorage/drivers/memory"
import { loadDriver } from "@/storage/load-driver"

import type { CancellationStorageOptions, StorageDriverKey } from "@/storage/types"

const convertBigIntsToSerializable = (value: unknown): unknown => {
	if (value === null || value === undefined) return value
	if (typeof value === "bigint") return { __type: "bigint", value: value.toString() }
	if (Array.isArray(value)) return value.map(convertBigIntsToSerializable)
	if (typeof value === "object") {
		return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [k, v]) => {
			acc[k] = convertBigIntsToSerializable(v)
			return acc
		}, {})
	}
	return value
}

const convertSerializableToBigInts = (value: unknown): unknown => {
	if (value === null || value === undefined) return value
	if (Array.isArray(value)) return value.map(convertSerializableToBigInts)
	if (typeof value === "object" && value !== null) {
		const obj = value as Record<string, unknown>
		if (obj.__type === "bigint" && typeof obj.value === "string") {
			return BigInt(obj.value)
		}
		return Object.entries(obj).reduce<Record<string, unknown>>((acc, [k, v]) => {
			acc[k] = convertSerializableToBigInts(v)
			return acc
		}, {})
	}
	return value
}

const detectEnvironment = (): StorageDriverKey => {
	if (typeof process !== "undefined" && !!process.versions?.node) return "node"
	if (typeof globalThis !== "undefined" && "localStorage" in globalThis) return "localstorage"
	if (typeof globalThis !== "undefined" && "indexedDB" in globalThis) return "indexeddb"
	return "memory"
}

export function createCancellationStorage(options: CancellationStorageOptions = {}) {
	const key = options.env ?? detectEnvironment()

	const driver = loadDriver({ key, options }) ?? inMemoryDriver

	const baseStorage = createStorage({ driver })

	const getItem = async <T>(key: string): Promise<T | null> => {
		const value = await baseStorage.getItem<string>(key)
		if (!value) return null
		try {
			return convertSerializableToBigInts(JSON.parse(value)) as T
		} catch {
			return value as T
		}
	}

	const setItem = async (key: string, value: unknown): Promise<void> => {
		const serializable = convertBigIntsToSerializable(value)
		const stringified = stringify(serializable) ?? "null"
		await baseStorage.setItem(key, stringified)
	}

	const removeItem = async (key: string): Promise<void> => {
		baseStorage.removeItem(key)
	}

	return Object.freeze({
		...baseStorage,
		getItem,
		setItem,
		removeItem,
	})
}

export const STORAGE_KEYS = Object.freeze({
	destProof: (orderId: string) => `cancel-order:${orderId}:destProof`,
	getRequest: (orderId: string) => `cancel-order:${orderId}:getRequest`,
	sourceProof: (orderId: string) => `cancel-order:${orderId}:sourceProof`,
})
