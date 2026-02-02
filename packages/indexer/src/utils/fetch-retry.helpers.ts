import fetch, { RequestInfo, RequestInit, Response } from "node-fetch"
import stringify from "safe-stable-stringify"

const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 100

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoff(attempt: number): number {
	return INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1)
}

/**
 * Fetch with automatic retry and exponential backoff
 * - Max retries: 3
 * - Initial backoff: 100ms (exponential: 100ms, 200ms, 400ms)
 * - Retries on: all errors
 * 
 * @param url - URL to fetch
 * @param init - Fetch options
 * @returns Promise with Response
 * 
 * @example
 * ```typescript
 * const response = await fetchWithRetry('https://api.example.com/data', {
 *   method: 'POST',
 *   body: JSON.stringify({ key: 'value' })
 * })
 * ```
 */
export async function fetchWithRetry(url: RequestInfo, init?: RequestInit): Promise<Response> {
	let lastError: Error | Response | undefined

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const response = await fetch(url, init)

			// If response is not ok, retry
			if (!response.ok) {
				lastError = response

				// Don't retry if this was the last attempt
				if (attempt === MAX_RETRIES) {
					logger.error(
						`[fetchWithRetry] Max retries (${MAX_RETRIES}) reached for ${url}. Last status: ${response.status}`
					)
					return response
				}

				// Calculate backoff and retry
				const delayMs = calculateBackoff(attempt + 1)
				logger.warn(
					`[fetchWithRetry] Retry attempt ${attempt + 1} after ${delayMs}ms due to: HTTP ${response.status} ${response.statusText}`
				)
				await sleep(delayMs)
				continue
			}

			// Success or non-retryable error
			if (attempt > 0) {
				logger.info(`[fetchWithRetry] Request succeeded after ${attempt} retry attempt(s) for ${url}`)
			}
			return response

		} catch (error) {
			lastError = error as Error

			// Don't retry if this was the last attempt
			if (attempt === MAX_RETRIES) {
				logger.error(
					`[fetchWithRetry] Max retries (${MAX_RETRIES}) reached for ${url}. Last error: ${stringify(error)}`
				)
				throw error
			}

			// Calculate backoff and retry
			const delayMs = calculateBackoff(attempt + 1)
			const errorMessage = (error as Error).message
			logger.warn(`[fetchWithRetry] Retry attempt ${attempt + 1} after ${delayMs}ms due to: ${errorMessage}`)
			await sleep(delayMs)
		}
	}

	// Should not reach here, but just in case
	if (lastError instanceof Response) {
		return lastError
	}
	throw lastError || new Error("Unknown error in fetchWithRetry")
}
