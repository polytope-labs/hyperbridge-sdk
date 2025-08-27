/**
 * safeArray is a utility function that returns an array from an array-like object or an empty array if the input is undefined or null.
 * @param array - The array-like object to convert to an array.
 */
export const safeArray = <T>(array: T[] | undefined | null) => {
	return Array.isArray(array) ? array : []
}

type PickResult<T, K, D> = K extends keyof T
	? T[K] | (D extends undefined ? undefined : D)
	: K extends ReadonlyArray<keyof T>
		? T[K[number]] | (D extends undefined ? undefined : D)
		: D extends undefined
			? undefined
			: D

/**
 * A type-safe utility function that extracts values from an object using a key or array of keys.
 * Supports fallback selection and optional default values with full type inference.
 *
 * @param object - The source object to extract values from
 * @param selector - A single key or readonly array of keys to attempt selection from
 * @param defaultValue - Optional default value returned when no keys match
 * @returns The first matching value, or default value, or undefined
 */
export const pick = <
	T extends Record<string | number, unknown>,
	K extends keyof T | ReadonlyArray<keyof T>,
	D = undefined,
>(
	object: T,
	selector: K,
	defaultValue?: D,
): PickResult<T, K, D> => {
	if (typeof selector === "string" || typeof selector === "number" || typeof selector === "symbol") {
		const value = object[selector as string]
		return (value !== undefined ? value : defaultValue) as PickResult<T, K, D>
	}

	if (Array.isArray(selector)) {
		for (const key of selector) {
			const value = object[key]
			if (value !== undefined) {
				return value as PickResult<T, K, D>
			}
		}
	}

	return defaultValue as PickResult<T, K, D>
}
