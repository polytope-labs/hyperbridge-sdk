import type { HexString } from "@/types"
import type { IntentOrderStatusUpdate, ExecuteIntentOrderOptions, FillerBid, SelectBidResult } from "@/types"
import { sleep, DEFAULT_POLL_INTERVAL, hexToString } from "@/utils"
import type { Hex } from "viem"
import type { IntentsV2Context } from "./types"
import { BidManager } from "./BidManager"

const MAX_PARTIAL_ATTEMPTS = 5

const USED_USEROPS_STORAGE_KEY = (commitment: HexString) => `used-userops:${commitment.toLowerCase()}`

export class OrderExecutor {
	constructor(
		private readonly ctx: IntentsV2Context,
		private readonly bidManager: BidManager,
		private readonly crypto: import("./CryptoUtils").CryptoUtils,
	) {}

	async *executeIntentOrder(options: ExecuteIntentOrderOptions): AsyncGenerator<IntentOrderStatusUpdate, void> {
		const {
			order,
			sessionPrivateKey,
			minBids = 1,
			bidTimeoutMs = 60_000,
			pollIntervalMs = DEFAULT_POLL_INTERVAL,
		} = options

		const commitment = order.id as HexString
		const isSameChain = order.source === order.destination

		if (!this.ctx.intentsCoprocessor) {
			yield {
				status: "FAILED",
				metadata: { error: "IntentsCoprocessor required for order execution" },
			}
			return
		}

		if (!this.ctx.bundlerUrl) {
			yield {
				status: "FAILED",
				metadata: { error: "Bundler URL not configured" },
			}
			return
		}

		// Load or initialize persistent dedup set for this commitment from storage
		const usedUserOps = new Set<string>()
		const storageKey = USED_USEROPS_STORAGE_KEY(commitment)
		const persisted = await this.ctx.usedUserOpsStorage.getItem(storageKey)
		if (persisted) {
			try {
				const parsed = JSON.parse(persisted) as string[]
				for (const key of parsed) {
					usedUserOps.add(key)
				}
			} catch {
				// Ignore corrupt entries and start fresh
			}
		}

		const persistUsedUserOps = async () => {
			await this.ctx.usedUserOpsStorage.setItem(storageKey, JSON.stringify([...usedUserOps]))
		}

		// Precompute UserOp hashing context for this order
		const entryPointAddress = this.ctx.dest.configService.getEntryPointV08Address(hexToString(order.destination))
		const chainId = BigInt(
			this.ctx.dest.client.chain?.id ?? Number.parseInt(this.ctx.dest.config.stateMachineId.split("-")[1]),
		)

		const userOpHashKey = (userOp: SelectBidResult["userOp"] | FillerBid["userOp"]): string =>
			this.crypto.computeUserOpHash(userOp, entryPointAddress, chainId)

		// For partial fill tracking, take the total desired output amount as the sum of all output asset amounts
		const targetAmount = order.output.assets.reduce((acc, asset) => acc + asset.amount, 0n)

		let totalFilledAmount = 0n
		let remainingAmount = targetAmount
		let partialAttempts = 0

		try {
			while (true) {
				yield {
					status: "AWAITING_BIDS",
					metadata: { commitment, totalFilledAmount, remainingAmount },
				}

				const startTime = Date.now()
				let bids: FillerBid[] = []

				while (Date.now() - startTime < bidTimeoutMs) {
					try {
						bids = await this.ctx.intentsCoprocessor!.getBidsForOrder(commitment)

						if (bids.length >= minBids) {
							break
						}
					} catch {
						// Continue polling on errors
					}

					await sleep(pollIntervalMs)
				}

				const freshBids = bids.filter((bid) => {
					const key = userOpHashKey(bid.userOp)
					return !usedUserOps.has(key)
				})

				if (freshBids.length === 0) {
					const isPartiallyFilled = totalFilledAmount > 0n

					yield {
						status: isPartiallyFilled ? "PARTIAL_FILL_EXHAUSTED" : "FAILED",
						metadata: {
							commitment,
							...(isPartiallyFilled && {
								totalFilledAmount,
								remainingAmount,
								partialAttempts,
							}),
							error: isPartiallyFilled
								? `No new bids after partial fill (${partialAttempts} attempt(s), ${totalFilledAmount.toString()} filled, ${remainingAmount.toString()} remaining)`
								: `No new bids available within ${bidTimeoutMs}ms timeout`,
						},
					}

					return
				}

				yield {
					status: "BIDS_RECEIVED",
					metadata: {
						commitment,
						bidCount: freshBids.length,
						bids: freshBids,
					},
				}

				let result: SelectBidResult
				try {
					result = await this.bidManager.selectBid(order, freshBids, sessionPrivateKey)
				} catch (err) {
					yield {
						status: "FAILED",
						metadata: {
							commitment,
							totalFilledAmount,
							remainingAmount,
							error: `Failed to select bid and submit: ${err instanceof Error ? err.message : String(err)}`,
						},
					}
					return
				}

				const usedKey = userOpHashKey(result.userOp)
				usedUserOps.add(usedKey)
				await persistUsedUserOps()

				yield {
					status: "BID_SELECTED",
					metadata: {
						commitment,
						selectedSolver: result.solverAddress,
						userOpHash: result.userOpHash,
						userOp: result.userOp,
					},
				}

				yield {
					status: "USEROP_SUBMITTED",
					metadata: {
						commitment,
						userOpHash: result.userOpHash,
						selectedSolver: result.solverAddress,
						transactionHash: result.txnHash,
					},
				}

				if (!isSameChain) {
					return
				}

				if (result.fillStatus === "full") {
					// On a full fill, treat the order as completely satisfied
					totalFilledAmount = targetAmount
					remainingAmount = 0n

					yield {
						status: "FILLED",
						metadata: {
							commitment,
							userOpHash: result.userOpHash,
							selectedSolver: result.solverAddress,
							transactionHash: result.txnHash,
							totalFilledAmount,
							remainingAmount,
							partialAttempts,
						},
					}
					return
				}

				if (result.fillStatus === "partial") {
					partialAttempts++

					if (result.filledAmount !== undefined) {
						totalFilledAmount += result.filledAmount

						if (totalFilledAmount >= targetAmount) {
							totalFilledAmount = targetAmount
							remainingAmount = 0n
						} else {
							remainingAmount = targetAmount - totalFilledAmount
						}
					}

					yield {
						status: "PARTIAL_FILL",
						metadata: {
							commitment,
							userOpHash: result.userOpHash,
							selectedSolver: result.solverAddress,
							transactionHash: result.txnHash,
							filledAmount: result.filledAmount,
							totalFilledAmount,
							remainingAmount,
							partialAttempts,
						},
					}

					if (partialAttempts >= MAX_PARTIAL_ATTEMPTS) {
						yield {
							status: "PARTIAL_FILL_EXHAUSTED",
							metadata: {
								commitment,
								totalFilledAmount,
								remainingAmount,
								partialAttempts,
								error: `Max partial fill attempts (${MAX_PARTIAL_ATTEMPTS}) reached`,
							},
						}
						return
					}
				}
			}
		} catch (err) {
			yield {
				status: "FAILED",
				metadata: {
					commitment,
					error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
				},
			}
		}
	}
}
