import {
	bytesToBigInt,
	bytesToHex,
	createPublicClient,
	encodeFunctionData,
	hexToBytes,
	http,
	type PublicClient,
	toHex,
	keccak256,
	toBytes,
	pad,
	erc20Abi,
	encodePacked,
	encodeAbiParameters,
	maxUint256,
} from "viem"
import {
	mainnet,
	arbitrum,
	arbitrumSepolia,
	optimism,
	optimismSepolia,
	base,
	baseSepolia,
	soneium,
	bsc,
	bscTestnet,
	gnosis,
	gnosisChiado,
} from "viem/chains"

import type { GetProofParameters, Hex } from "viem"
import { zip, flatten } from "lodash-es"
import { match } from "ts-pattern"

import EvmHost from "@/abis/evmHost"
import type { IChain, IIsmpMessage } from "@/chain"
import HandlerV1 from "@/abis/handler"
import UniversalRouter from "@/abis/universalRouter"
import UniswapV2Factory from "@/abis/uniswapV2Factory"
import UniswapRouterV2 from "@/abis/uniswapRouterV2"
import UniswapV3Factory from "@/abis/uniswapV3Factory"
import UniswapV3Pool from "@/abis/uniswapV3Pool"
import UniswapV3Quoter from "@/abis/uniswapV3Quoter"
import IntentGateway from "@/abis/IntentGateway"
import {
	ADDRESS_ZERO,
	bytes32ToBytes20,
	calculateAllowanceMappingLocation,
	calculateBalanceMappingLocation,
	calculateMMRSize,
	EvmStateProof,
	fetchTokenUsdPrice,
	generateRootWithProof,
	mmrPositionToKIndex,
	MmrProof,
	SubstrateStateProof,
} from "@/utils"
import {
	EvmLanguage,
	type FillOptions,
	type HexString,
	type IMessage,
	type IPostRequest,
	type Order,
	type StateMachineHeight,
	type StateMachineIdParams,
} from "@/types"
import evmHost from "@/abis/evmHost"

const chains = {
	[mainnet.id]: mainnet,
	[arbitrum.id]: arbitrum,
	[arbitrumSepolia.id]: arbitrumSepolia,
	[optimism.id]: optimism,
	[optimismSepolia.id]: optimismSepolia,
	[base.id]: base,
	[baseSepolia.id]: baseSepolia,
	[soneium.id]: soneium,
	[bsc.id]: bsc,
	[bscTestnet.id]: bscTestnet,
	[gnosis.id]: gnosis,
	[gnosisChiado.id]: gnosisChiado,
}

/**
 * The default address used as fallback when no address is provided.
 * This represents the zero address in EVM chains.
 */
export const DEFAULT_ADDRESS = "0x0000000000000000000000000000000000000000"

/**
 * Parameters for an EVM chain.
 */
export interface EvmChainParams {
	/**
	 * The chain ID of the EVM chain.
	 */
	chainId: number
	/**
	 * The host address of the EVM chain.
	 */
	host: HexString
	/**
	 * The URL of the EVM chain.
	 */
	url: string
}

/**
 * Encapsulates an EVM chain.
 */
export class EvmChain implements IChain {
	private publicClient: PublicClient

	constructor(private readonly params: EvmChainParams) {
		// @ts-ignore
		this.publicClient = createPublicClient({
			// @ts-ignore
			chain: chains[params.chainId],
			transport: http(params.url),
		})
	}

	/**
	 * Derives the key for the request receipt.
	 * @param {HexString} commitment - The commitment to derive the key from.
	 * @returns {HexString} The derived key.
	 */
	requestReceiptKey(commitment: HexString): HexString {
		return deriveMapKey(hexToBytes(commitment), REQUEST_RECEIPTS_SLOT)
	}

	/**
	 * Queries the request receipt.
	 * @param {HexString} commitment - The commitment to query.
	 * @returns {Promise<HexString | undefined>} The relayer address responsible for delivering the request.
	 */
	async queryRequestReceipt(commitment: HexString): Promise<HexString | undefined> {
		const relayer = await this.publicClient.readContract({
			address: this.params.host,
			abi: EvmHost.ABI,
			functionName: "requestReceipts",
			args: [commitment],
		})

		// solidity returns zeroes if the storage slot is empty
		return relayer === DEFAULT_ADDRESS ? undefined : relayer
	}

	/**
	 * Queries the proof of the commitments.
	 * @param {IMessage} message - The message to query.
	 * @param {string} counterparty - The counterparty address.
	 * @param {bigint} [at] - The block number to query at.
	 * @returns {Promise<HexString>} The proof.
	 */
	async queryProof(message: IMessage, counterparty: string, at?: bigint): Promise<HexString> {
		// for each request derive the commitment key collect into a new array
		const commitmentKeys =
			"Requests" in message
				? message.Requests.map((key) => requestCommitmentKey(key))
				: message.Responses.map((key) => responseCommitmentKey(key))
		const config: GetProofParameters = {
			address: this.params.host,
			storageKeys: commitmentKeys,
		}
		if (!at) {
			config.blockTag = "latest"
		} else {
			config.blockNumber = at
		}
		const proof = await this.publicClient.getProof(config)
		const flattenedProof = Array.from(new Set(flatten(proof.storageProof.map((item) => item.proof))))

		const encoded = EvmStateProof.enc({
			contractProof: proof.accountProof.map((item) => Array.from(hexToBytes(item))),
			storageProof: [
				[Array.from(hexToBytes(this.params.host)), flattenedProof.map((item) => Array.from(hexToBytes(item)))],
			],
		})

		return toHex(encoded)
	}

	/**
	 * Query and return the encoded storage proof for the provided keys at the given height.
	 * @param {bigint} at - The block height at which to query the storage proof.
	 * @param {HexString[]} keys - The keys for which to query the storage proof.
	 * @returns {Promise<HexString>} The encoded storage proof.
	 */
	async queryStateProof(at: bigint, keys: HexString[]): Promise<HexString> {
		const config: GetProofParameters = {
			address: this.params.host,
			storageKeys: keys,
		}
		if (!at) {
			config.blockTag = "latest"
		} else {
			config.blockNumber = at
		}
		const proof = await this.publicClient.getProof(config)
		const flattenedProof = Array.from(new Set(flatten(proof.storageProof.map((item) => item.proof))))

		const encoded = EvmStateProof.enc({
			contractProof: proof.accountProof.map((item) => Array.from(hexToBytes(item))),
			storageProof: [
				[Array.from(hexToBytes(this.params.host)), flattenedProof.map((item) => Array.from(hexToBytes(item)))],
			],
		})

		return toHex(encoded)
	}

	/**
	 * Returns the current timestamp of the chain.
	 * @returns {Promise<bigint>} The current timestamp.
	 */
	async timestamp(): Promise<bigint> {
		const data = await this.publicClient.readContract({
			address: this.params.host,
			abi: EvmHost.ABI,
			functionName: "timestamp",
		})
		return BigInt(data)
	}

	/**
	 * Get the latest state machine height for a given state machine ID.
	 * @param {StateMachineIdParams} stateMachineId - The state machine ID.
	 * @returns {Promise<bigint>} The latest state machine height.
	 */
	async latestStateMachineHeight(stateMachineId: StateMachineIdParams): Promise<bigint> {
		if (!this.publicClient) throw new Error("API not initialized")
		const id = stateMachineId.stateId.Polkadot || stateMachineId.stateId.Kusama
		if (!id)
			throw new Error(
				"Expected Polakdot or Kusama State machine id when reading latest state machine height on evm",
			)
		const data = await this.publicClient.readContract({
			address: this.params.host,
			abi: EvmHost.ABI,
			functionName: "latestStateMachineHeight",
			args: [BigInt(id)],
		})
		return data
	}

	/**
	 * Get the state machine update time for a given state machine height.
	 * @param {StateMachineHeight} stateMachineheight - The state machine height.
	 * @returns {Promise<bigint>} The statemachine update time in seconds.
	 */
	async stateMachineUpdateTime(stateMachineHeight: StateMachineHeight): Promise<bigint> {
		if (!this.publicClient) throw new Error("API not initialized")
		const id = stateMachineHeight.id.stateId.Polkadot || stateMachineHeight.id.stateId.Kusama
		if (!id) throw new Error("Expected Polkadot or Kusama State machine id when reading state machine update time")
		const data = await this.publicClient.readContract({
			address: this.params.host,
			abi: EvmHost.ABI,
			functionName: "stateMachineCommitmentUpdateTime",
			args: [{ stateMachineId: BigInt(id), height: stateMachineHeight.height }],
		})
		return data
	}

	/**
	 * Get the challenge period for a given state machine id.
	 * @param {StateMachineIdParams} stateMachineId - The state machine ID.
	 * @returns {Promise<bigint>} The challenge period in seconds.
	 */
	async challengePeriod(stateMachineId: StateMachineIdParams): Promise<bigint> {
		if (!this.publicClient) throw new Error("API not initialized")
		const id = stateMachineId.stateId.Polkadot || stateMachineId.stateId.Kusama
		if (!id)
			throw new Error(
				"Expected Polkadot or Kusama State machine id when reading latest state machine height on evm",
			)
		const data = await this.publicClient.readContract({
			address: this.params.host,
			abi: EvmHost.ABI,
			functionName: "challengePeriod",
		})
		return data
	}

	/**
	 * Encodes an ISMP message for the EVM chain.
	 * @param {IIsmpMessage} message The ISMP message to encode.
	 * @returns {HexString} The encoded calldata.
	 */
	encode(message: IIsmpMessage): HexString {
		const encoded = match(message)
			.with({ kind: "PostRequest" }, (request) => {
				const mmrProof = MmrProof.dec(request.proof.proof)
				const requests = zip(request.requests, mmrProof.leafIndexAndPos)
					.map(([req, leafIndexAndPos]) => {
						if (!req || !leafIndexAndPos) return
						const [[, kIndex]] = mmrPositionToKIndex(
							[leafIndexAndPos?.pos],
							calculateMMRSize(mmrProof.leafCount),
						)
						return {
							request: {
								source: toHex(req.source),
								dest: toHex(req.dest),
								to: req.to,
								from: req.from,
								nonce: req.nonce,
								timeoutTimestamp: req.timeoutTimestamp,
								body: req.body,
							} as any,
							index: leafIndexAndPos?.leafIndex!,
							kIndex,
						}
					})
					.filter((item) => !!item)

				const proof = {
					height: {
						stateMachineId: BigInt(Number.parseInt(request.proof.stateMachine.split("-")[1])),
						height: request.proof.height,
					},
					multiproof: mmrProof.items.map((item) => bytesToHex(new Uint8Array(item))),
					leafCount: mmrProof.leafCount,
				}
				const encoded = encodeFunctionData({
					abi: HandlerV1.ABI,
					functionName: "handlePostRequests",
					args: [
						this.params.host,
						{
							proof,
							requests,
						},
					],
				})

				return encoded
			})
			.with({ kind: "TimeoutPostRequest" }, (timeout) => {
				const proof = SubstrateStateProof.dec(timeout.proof.proof).value.storageProof.map((item) =>
					toHex(new Uint8Array(item)),
				)
				const encoded = encodeFunctionData({
					abi: HandlerV1.ABI,
					functionName: "handlePostRequestTimeouts",
					args: [
						this.params.host,
						{
							height: {
								stateMachineId: BigInt(Number.parseInt(timeout.proof.stateMachine.split("-")[1])),
								height: timeout.proof.height,
							},
							timeouts: timeout.requests.map((req) => ({
								source: toHex(req.source),
								dest: toHex(req.dest),
								to: req.to,
								from: req.from,
								nonce: req.nonce,
								timeoutTimestamp: req.timeoutTimestamp,
								body: req.body,
							})),
							proof,
						},
					],
				})

				return encoded
			})
			.with({ kind: "GetResponse" }, (request) => {
				const mmrProof = MmrProof.dec(request.proof.proof)
				const responses = zip(request.responses, mmrProof.leafIndexAndPos)
					.map(([req, leafIndexAndPos]) => {
						if (!req || !leafIndexAndPos) return
						const [[, kIndex]] = mmrPositionToKIndex(
							[leafIndexAndPos?.pos],
							calculateMMRSize(mmrProof.leafCount),
						)
						return {
							response: {
								request: {
									source: toHex(req.get.source),
									dest: toHex(req.get.dest),
									from: req.get.from,
									nonce: req.get.nonce,
									timeoutTimestamp: req.get.timeoutTimestamp,
									keys: req.get.keys,
									context: req.get.context,
									height: req.get.height,
								},

								values: req.values,
							} as any,
							index: leafIndexAndPos?.leafIndex!,
							kIndex,
						}
					})
					.filter((item) => !!item)

				const proof = {
					height: {
						stateMachineId: BigInt(Number.parseInt(request.proof.stateMachine.split("-")[1])),
						height: request.proof.height,
					},
					multiproof: mmrProof.items.map((item) => bytesToHex(new Uint8Array(item))),
					leafCount: mmrProof.leafCount,
				}
				const encoded = encodeFunctionData({
					abi: HandlerV1.ABI,
					functionName: "handleGetResponses",
					args: [
						this.params.host,
						{
							proof,
							responses,
						},
					],
				})

				return encoded
			})
			.exhaustive()

		return encoded
	}

	/**
	 * Calculates the fee required to send a post request to the destination chain.
	 * The fee is calculated based on the per-byte fee for the destination chain
	 * multiplied by the size of the request body.
	 *
	 * @param request - The post request to calculate the fee for
	 * @returns The total fee in wei required to send the post request
	 */
	async quote(request: IPostRequest): Promise<bigint> {
		const perByteFee = await this.publicClient.readContract({
			address: this.params.host,
			abi: EvmHost.ABI,
			functionName: "perByteFee",
			args: [toHex(request.dest)],
		})

		return perByteFee * BigInt(request.body.length)
	}

	/**
	 * Estimates the gas required for a post request execution on this chain.
	 * This function generates mock proofs for the post request, creates a state override
	 * with the necessary overlay root, and estimates the gas cost for executing the
	 * handlePostRequests transaction on the handler contract.
	 *
	 * @param request - The post request to estimate gas for
	 * @param paraId - The ID of the parachain (Hyperbridge) that will process the request
	 * @returns The estimated gas amount in gas units
	 */
	async estimateGas(request: IPostRequest): Promise<bigint> {
		const hostParams = await this.publicClient.readContract({
			address: this.params.host,
			abi: EvmHost.ABI,
			functionName: "hostParams",
		})

		const { root, proof, index, kIndex, treeSize } = await generateRootWithProof(request, 2n ** 10n)
		const latestStateMachineHeight = 100n
		const paraId = 4009n
		const overlayRootSlot = getStateCommitmentFieldSlot(
			paraId, // Hyperbridge chain id
			latestStateMachineHeight, // Hyperbridge chain height
			1, // For overlayRoot
		)
		const postParams = {
			height: {
				stateMachineId: BigInt(paraId),
				height: latestStateMachineHeight,
			},
			multiproof: proof,
			leafCount: treeSize,
		}

		const gas = await this.publicClient.estimateContractGas({
			address: hostParams.handler,
			abi: HandlerV1.ABI,
			functionName: "handlePostRequests",
			args: [
				this.params.host,
				{
					proof: postParams,
					requests: [
						{
							request: {
								...request,
								source: toHex(request.source),
								dest: toHex(request.dest),
							},
							index,
							kIndex,
						},
					],
				},
			],
			stateOverride: [
				{
					address: this.params.host,
					stateDiff: [
						{
							slot: overlayRootSlot,
							value: root,
						},
					],
				},
			],
		})

		return gas
	}

	/**
	 * Estimates the gas required to fill an order on the destination chain.
	 * This function estimates the gas required to fill the order, including the gas required to post the request
	 * and the gas required to swap the tokens.
	 *
	 * @param order - The order to estimate gas for
	 * @param venues - The venues to use for the swap
	 * @param fillerWalletAddress - The address of the wallet to use for the swap
	 * @param postRequest - The post request to fill the order
	 * @param intentGatewayAddress - The address of the intent gateway
	 * @param availableAssets - The assets available on the destination chain
	 * @param universalRouterAddress - The address of the universal router
	 * @returns The estimated gas amount in gas units
	 */
	async estimateFillOrderGas(
		order: Order,
		venues: {
			v2Router: HexString
			v2Factory: HexString
			v3Factory: HexString
			v3Quoter: HexString
		},
		fillerWalletAddress: HexString,
		intentGatewayAddress: HexString,
		availableAssets: {
			name: string
			address: HexString
			decimals: number
		}[],
		universalRouterAddress: HexString,
		postGasEstimate: bigint,
		wrappedNativeTokenSourceChain: HexString,
	): Promise<bigint> {
		const nativeTokenPriceUsd = await fetchTokenUsdPrice(wrappedNativeTokenSourceChain)
		const postGasEstimateUsd = (postGasEstimate * nativeTokenPriceUsd) / BigInt(10 ** 18)

		const fillOptions: FillOptions = {
			relayerFee: postGasEstimateUsd + (postGasEstimateUsd * BigInt(2)) / BigInt(100),
		}

		let totalEthValue = 0n

		for (const output of order.outputs) {
			const tokenAddress = bytes32ToBytes20(output.token)
			if (tokenAddress === ADDRESS_ZERO) {
				totalEthValue += output.amount
			}
		}

		// For each output token, generate the storage slot of the token balance and allowance
		// Balance slot depends upon implementation of the token contract
		const overrides = (
			await Promise.all(
				order.outputs.map(async (output) => {
					const tokenAddress = bytes32ToBytes20(output.token)
					if (tokenAddress === ADDRESS_ZERO) return null

					const userAddress = fillerWalletAddress
					const testValue = toHex(maxUint256)

					let balanceSlot: HexString | null = null

					// Find balance slot first
					// Try both Solidity and Vyper implementations, both have different storage slot implementations
					for (const language of [EvmLanguage.Solidity, EvmLanguage.Vyper]) {
						// Check common slots first (0, 1, 3, 51, 140, 151)
						const commonSlots = [0n, 1n, 3n, 51n, 140n, 151n]

						for (const slot of commonSlots) {
							const storageSlot = calculateBalanceMappingLocation(slot, userAddress, language)

							try {
								const balance = await this.publicClient.readContract({
									abi: erc20Abi,
									address: tokenAddress,
									functionName: "balanceOf",
									args: [userAddress],
									stateOverride: [
										{
											address: tokenAddress,
											stateDiff: [{ slot: storageSlot, value: testValue }],
										},
									],
								})

								if (toHex(balance) === testValue) {
									balanceSlot = storageSlot
									break
								}
							} catch (error) {
								continue
							}
						}

						if (balanceSlot) break
					}

					// Start from slot 0 and go up to 200, but skip already checked slots
					if (!balanceSlot) {
						const checkedSlots = new Set([0n, 1n, 3n, 51n, 140n, 151n])

						for (let i = 0n; i < 200n; i++) {
							if (checkedSlots.has(i)) continue

							for (const language of [EvmLanguage.Solidity, EvmLanguage.Vyper]) {
								const storageSlot = calculateBalanceMappingLocation(i, userAddress, language)

								try {
									const balance = await this.publicClient.readContract({
										abi: erc20Abi,
										address: tokenAddress,
										functionName: "balanceOf",
										args: [userAddress],
										stateOverride: [
											{
												address: tokenAddress,
												stateDiff: [{ slot: storageSlot, value: testValue }],
											},
										],
									})

									if (toHex(balance) === testValue) {
										balanceSlot = storageSlot
										break
									}
								} catch (error) {
									continue
								}
							}

							if (balanceSlot) break
						}
					}

					if (!balanceSlot) {
						console.warn(`Could not find balance slot for token ${tokenAddress}`)
						return null
					}

					let allowanceSlot: HexString | null = null

					// Slot 1 covers majority of tokens
					for (const language of [EvmLanguage.Solidity, EvmLanguage.Vyper]) {
						const allowanceStorageSlot = calculateAllowanceMappingLocation(
							1n,
							userAddress,
							intentGatewayAddress,
							language,
						)

						try {
							const allowance = await this.publicClient.readContract({
								abi: erc20Abi,
								address: tokenAddress,
								functionName: "allowance",
								args: [userAddress, intentGatewayAddress],
								stateOverride: [
									{
										address: tokenAddress,
										stateDiff: [{ slot: allowanceStorageSlot, value: testValue }],
									},
								],
							})

							if (toHex(allowance) === testValue) {
								allowanceSlot = allowanceStorageSlot
								break
							}
						} catch (error) {
							continue
						}
					}

					// If slot 1 didn't work, try from 0 to 200
					if (!allowanceSlot) {
						for (let i = 0n; i <= 200n; i++) {
							if (i === 1n) continue // Already checked slot 1

							for (const language of [EvmLanguage.Solidity, EvmLanguage.Vyper]) {
								const allowanceStorageSlot = calculateAllowanceMappingLocation(
									i,
									userAddress,
									intentGatewayAddress,
									language,
								)

								try {
									const allowance = await this.publicClient.readContract({
										abi: erc20Abi,
										address: tokenAddress,
										functionName: "allowance",
										args: [userAddress, intentGatewayAddress],
										stateOverride: [
											{
												address: tokenAddress,
												stateDiff: [{ slot: allowanceStorageSlot, value: testValue }],
											},
										],
									})

									if (toHex(allowance) === testValue) {
										allowanceSlot = allowanceStorageSlot
										break
									}
								} catch (error) {
									continue
								}
							}

							if (allowanceSlot) break
						}
					}

					if (!allowanceSlot) {
						console.warn(`Could not find allowance slot for token ${tokenAddress}`)
					}

					const stateDiffs = [{ slot: balanceSlot, value: testValue }]
					if (allowanceSlot) {
						stateDiffs.push({ slot: allowanceSlot, value: testValue })
					}

					return {
						address: tokenAddress,
						stateDiff: stateDiffs,
					}
				}),
			)
		).filter(Boolean)

		const fillGas = await this.publicClient.estimateContractGas({
			abi: IntentGateway.ABI,
			address: intentGatewayAddress,
			functionName: "fillOrder",
			args: [transformOrderForContract(order), fillOptions as any],
			account: fillerWalletAddress,
			value: totalEthValue,
			stateOverride: overrides as any,
		})

		const swapOperations = await this.calculateSwapOperations({
			order,
			fillerWalletAddress,
			availableAssets,
			universalRouterAddress,
			venues,
		})

		const relayerFeeEth = postGasEstimate + (postGasEstimate * BigInt(200)) / BigInt(10000)

		const totalGasEstimate = fillGas + swapOperations.totalGasEstimate + relayerFeeEth

		return totalGasEstimate
	}

	/**
	 * Calculates the swap operations required to fill an order.
	 * This function calculates the swap operations required to fill the order, including the gas required to swap the tokens.
	 *
	 * @param params - The parameters for the swap operations
	 * @returns The swap operations required to fill the order
	 */
	async calculateSwapOperations(params: {
		order: Order
		fillerWalletAddress: HexString
		availableAssets: {
			name: string
			address: HexString
			decimals: number
		}[]
		universalRouterAddress: HexString
		venues: {
			v2Router: HexString
			v2Factory: HexString
			v3Factory: HexString
			v3Quoter: HexString
		}
	}): Promise<{ calls: { to: HexString; data: HexString; value: bigint }[]; totalGasEstimate: bigint }> {
		const { order, fillerWalletAddress, availableAssets, universalRouterAddress, venues } = params
		const destClient = this.publicClient

		const calls: { to: HexString; data: HexString; value: bigint }[] = []
		let totalGasEstimate = BigInt(0)

		let { address: daiAssetAddress, decimals: daiAssetDecimals } = {
			address: ADDRESS_ZERO,
			decimals: 0,
		}
		let { address: usdtAssetAddress, decimals: usdtAssetDecimals } = {
			address: ADDRESS_ZERO,
			decimals: 0,
		}
		let { address: usdcAssetAddress, decimals: usdcAssetDecimals } = {
			address: ADDRESS_ZERO,
			decimals: 0,
		}

		for (const asset of availableAssets) {
			if (asset.name === "DAI") {
				daiAssetAddress = asset.address
				daiAssetDecimals = asset.decimals
			} else if (asset.name === "USDT") {
				usdtAssetAddress = asset.address
				usdtAssetDecimals = asset.decimals
			} else if (asset.name === "USDC") {
				usdcAssetAddress = asset.address
				usdcAssetDecimals = asset.decimals
			}
		}

		const V2_SWAP_EXACT_OUT = 0x09
		const V3_SWAP_EXACT_OUT = 0x01

		for (const token of order.outputs) {
			const tokenAddress = bytes32ToBytes20(token.token)
			const nativeTokenBalance = await destClient.getBalance({
				address: fillerWalletAddress,
			})

			const daiBalance = await destClient.readContract({
				address: daiAssetAddress,
				abi: erc20Abi,
				functionName: "balanceOf",
				args: [fillerWalletAddress],
			})

			const usdtBalance = await destClient.readContract({
				address: usdtAssetAddress,
				abi: erc20Abi,
				functionName: "balanceOf",
				args: [fillerWalletAddress],
			})

			const usdcBalance = await destClient.readContract({
				address: usdcAssetAddress,
				abi: erc20Abi,
				functionName: "balanceOf",
				args: [fillerWalletAddress],
			})

			const currentBalance =
				tokenAddress == daiAssetAddress
					? daiBalance
					: tokenAddress == usdtAssetAddress
						? usdtBalance
						: tokenAddress == usdcAssetAddress
							? usdcBalance
							: nativeTokenBalance

			const balanceNeeded = token.amount > currentBalance ? token.amount - currentBalance : BigInt(0)

			if (balanceNeeded > BigInt(0)) {
				const normalizedBalances = {
					dai: daiBalance / BigInt(10 ** daiAssetDecimals),
					usdt: usdtBalance / BigInt(10 ** usdtAssetDecimals),
					usdc: usdcBalance / BigInt(10 ** usdcAssetDecimals),
					native: nativeTokenBalance / BigInt(10 ** 18),
				}

				const sortedBalances = Object.entries(normalizedBalances).sort(([, a], [, b]) => Number(b - a))

				// Try to fulfill the requirement using the highest balance first
				let remainingNeeded = balanceNeeded

				for (const [tokenType, normalizedBalance] of sortedBalances) {
					if (remainingNeeded <= BigInt(0)) break

					// Skip if this is the same token we're trying to get
					if (
						(tokenType === "dai" && tokenAddress === daiAssetAddress) ||
						(tokenType === "usdt" && tokenAddress === usdtAssetAddress) ||
						(tokenType === "usdc" && tokenAddress === usdcAssetAddress) ||
						(tokenType === "native" && tokenAddress === ADDRESS_ZERO)
					) {
						continue
					}

					// Get the actual balance with decimals
					const actualBalance =
						tokenType === "dai"
							? daiBalance
							: tokenType === "usdt"
								? usdtBalance
								: tokenType === "usdc"
									? usdcBalance
									: nativeTokenBalance

					// Calculate how much we can swap from this token (in actual uint256 with decimals)
					const swapAmount = actualBalance > remainingNeeded ? remainingNeeded : actualBalance

					if (swapAmount > BigInt(0)) {
						const tokenToSwap =
							tokenType === "dai"
								? daiAssetAddress
								: tokenType === "usdt"
									? usdtAssetAddress
									: tokenType === "usdc"
										? usdcAssetAddress
										: ADDRESS_ZERO

						const bestProtocol = await this.findBestProtocolWithAmountOut(
							tokenToSwap,
							tokenAddress,
							swapAmount,
							venues,
						)

						if (bestProtocol.protocol === null) {
							console.warn(`No liquidity available for swap ${tokenToSwap} -> ${tokenAddress}`)
							continue
						}

						const amountIn = bestProtocol.amountIn

						// Transfer tokens directly to Universal Router (no approval needed)
						const transferData = encodeFunctionData({
							abi: erc20Abi,
							functionName: "transfer",
							args: [universalRouterAddress, amountIn],
						})

						const transferCall = {
							to: tokenToSwap,
							data: transferData,
							value: BigInt(0),
						}

						// Universal Router swap call based on protocol
						let commands: HexString
						let inputs: HexString[]
						const isPermit2 = false

						if (bestProtocol.protocol === "v2") {
							// V2 swap
							const path = [tokenToSwap, tokenAddress]
							commands = encodePacked(["uint8"], [V2_SWAP_EXACT_OUT])

							// Inputs for V2_SWAP_EXACT_OUT: (recipient, amountOut, amountInMax, path, isPermit2)
							inputs = [
								encodeAbiParameters(
									[
										{ type: "address", name: "recipient" },
										{ type: "uint256", name: "amountOut" },
										{ type: "uint256", name: "amountInMax" },
										{ type: "address[]", name: "path" },
										{ type: "bool", name: "isPermit2" },
									],
									[fillerWalletAddress, swapAmount, amountIn, path, isPermit2],
								),
							]
						} else {
							// V3 swap
							// Encode path with fee: tokenIn + fee + tokenOut
							const pathV3 = encodePacked(
								["address", "uint24", "address"],
								[tokenToSwap, bestProtocol.fee!, tokenAddress],
							)

							commands = encodePacked(["uint8"], [V3_SWAP_EXACT_OUT])

							// Inputs for V3_SWAP_EXACT_OUT: (recipient, amountOut, amountInMax, path, isPermit2)
							inputs = [
								encodeAbiParameters(
									[
										{ type: "address", name: "recipient" },
										{ type: "uint256", name: "amountOut" },
										{ type: "uint256", name: "amountInMax" },
										{ type: "bytes", name: "path" },
										{ type: "bool", name: "isPermit2" },
									],
									[fillerWalletAddress, swapAmount, amountIn, pathV3, isPermit2],
								),
							]
						}

						const swapData = encodeFunctionData({
							abi: UniversalRouter.ABI,
							functionName: "execute",
							args: [commands, inputs, order.deadline],
						})

						const call = {
							to: params.universalRouterAddress,
							data: swapData,
							value: BigInt(0),
						}

						try {
							const { results } = await destClient.simulateCalls({
								account: fillerWalletAddress,
								calls: [transferCall, call],
							})

							const operationGasEstimate = results.reduce(
								(acc, result) => acc + result.gasUsed,
								BigInt(0),
							)

							calls.push(transferCall, call)
							totalGasEstimate += operationGasEstimate
							remainingNeeded -= swapAmount

							console.log(
								`Using ${bestProtocol.protocol.toUpperCase()} for swap ${tokenToSwap} -> ${tokenAddress}, amountIn: ${amountIn}${bestProtocol.fee ? `, fee: ${bestProtocol.fee}` : ""}`,
							)
						} catch (simulationError) {
							console.error(
								`Swap simulation failed for ${tokenType} using ${bestProtocol.protocol}:`,
								simulationError,
							)
							continue
						}
					}
				}

				// If we still need more tokens after trying all balances
				if (remainingNeeded > BigInt(0)) {
					throw new Error(`Insufficient balance to fulfill token requirement for ${tokenAddress}`)
				}
			}
		}

		return { calls, totalGasEstimate }
	}

	/**
	 * Finds the best protocol to use for a swap.
	 * This function finds the best protocol to use for a swap, including the best fee and gas estimate.
	 *
	 * @param tokenIn - The address of the input token
	 * @param tokenOut - The address of the output token
	 * @param amountOut - The amount of output tokens to swap
	 * @param venues - The venues to use for the swap
	 * @returns The best protocol to use for the swap
	 */
	async findBestProtocolWithAmountOut(
		tokenIn: HexString,
		tokenOut: HexString,
		amountOut: bigint,
		venues: {
			v2Router: HexString
			v2Factory: HexString
			v3Factory: HexString
			v3Quoter: HexString
		},
	): Promise<{
		protocol: "v2" | "v3" | null
		amountIn: bigint
		fee?: number // For V3
		gasEstimate?: bigint // For V3
	}> {
		const destClient = this.publicClient
		let amountInV2 = maxUint256
		let amountInV3 = maxUint256
		let bestV3Fee = 0
		let v3GasEstimate = BigInt(0)

		const v2Router = venues.v2Router
		const v2Factory = venues.v2Factory
		const v3Factory = venues.v3Factory
		const v3Quoter = venues.v3Quoter

		try {
			const v2PairExists = (await destClient.readContract({
				address: v2Factory,
				abi: UniswapV2Factory.ABI,
				functionName: "getPair",
				args: [tokenIn, tokenOut],
			})) as HexString

			if (v2PairExists !== ADDRESS_ZERO) {
				const v2AmountIn = (await destClient.readContract({
					address: v2Router,
					abi: UniswapRouterV2.ABI,
					functionName: "getAmountsIn",
					args: [amountOut, [tokenIn, tokenOut]],
				})) as bigint[]

				amountInV2 = v2AmountIn[0]
			}
		} catch (error) {
			console.warn("V2 quote failed:", error)
		}

		// Find the best pool in v3 with best quote
		let bestV3AmountIn = maxUint256
		const fees = [500, 3000, 10000] // 0.05%, 0.3%, 1%

		for (const fee of fees) {
			try {
				const pool = await destClient.readContract({
					address: v3Factory,
					abi: UniswapV3Factory.ABI,
					functionName: "getPool",
					args: [tokenIn, tokenOut, fee],
				})

				if (pool !== ADDRESS_ZERO) {
					const liquidity = await destClient.readContract({
						address: pool,
						abi: UniswapV3Pool.ABI,
						functionName: "liquidity",
					})

					if (liquidity > BigInt(0)) {
						// Get quote from quoter
						const quoteResult = (await destClient.readContract({
							address: v3Quoter,
							abi: UniswapV3Quoter.ABI,
							functionName: "quoteExactOutputSingle",
							args: [
								{
									tokenIn: tokenIn,
									tokenOut: tokenOut,
									fee: fee,
									amount: amountOut,
									sqrtPriceLimitX96: BigInt(0),
								},
							],
						})) as [bigint, bigint, number, bigint] // [amountIn, sqrtPriceX96After, initializedTicksCrossed, gasEstimate]

						const [amountIn, , , gasEstimate] = quoteResult

						if (amountIn < bestV3AmountIn) {
							bestV3AmountIn = amountIn
							bestV3Fee = fee
							v3GasEstimate = gasEstimate
						}
					}
				}
			} catch (error) {
				console.warn(`V3 quote failed for fee ${fee}, continuing to next fee tier`)
				// Continue to next fee tier
			}
		}

		amountInV3 = bestV3AmountIn

		if (amountInV2 === maxUint256 && amountInV3 === maxUint256) {
			// No liquidity in either protocol
			return {
				protocol: null,
				amountIn: maxUint256,
			}
		}

		if (amountInV2 <= amountInV3) {
			return {
				protocol: "v2",
				amountIn: amountInV2,
			}
		} else {
			return {
				protocol: "v3",
				amountIn: amountInV3,
				fee: bestV3Fee,
				gasEstimate: v3GasEstimate,
			}
		}
	}

	/**
	 * Finds the best protocol to use for a swap.
	 * This function finds the best protocol to use for a swap, including the best fee and gas estimate.
	 *
	 * @param tokenIn - The address of the input token
	 * @param tokenOut - The address of the output token
	 * @param amountIn - The amount of input tokens to swap
	 * @param venues - The venues to use for the swap
	 * @returns The best protocol to use for the swap
	 */
	async findBestProtocolWithAmountIn(
		tokenIn: HexString,
		tokenOut: HexString,
		amountIn: bigint,
		venues: {
			v2Router: HexString
			v2Factory: HexString
			v3Factory: HexString
			v3Quoter: HexString
		},
	): Promise<{
		protocol: "v2" | "v3" | null
		amountOut: bigint
		fee?: number // For V3
		gasEstimate?: bigint // For V3
	}> {
		const destClient = this.publicClient
		let amountOutV2 = BigInt(0)
		let amountOutV3 = BigInt(0)
		let bestV3Fee = 0
		let v3GasEstimate = BigInt(0)

		const v2Router = venues.v2Router
		const v2Factory = venues.v2Factory
		const v3Factory = venues.v3Factory
		const v3Quoter = venues.v3Quoter

		try {
			const v2PairExists = (await destClient.readContract({
				address: v2Factory,
				abi: UniswapV2Factory.ABI,
				functionName: "getPair",
				args: [tokenIn, tokenOut],
			})) as HexString

			if (v2PairExists !== ADDRESS_ZERO) {
				const v2AmountOut = (await destClient.readContract({
					address: v2Router,
					abi: UniswapRouterV2.ABI,
					functionName: "getAmountsOut",
					args: [amountIn, [tokenIn, tokenOut]],
				})) as bigint[]

				amountOutV2 = v2AmountOut[1] // Second element is the output amount
			}
		} catch (error) {
			console.warn("V2 quote failed:", error)
		}

		// Find the best pool in v3 with best quote
		let bestV3AmountOut = BigInt(0)
		const fees = [500, 3000, 10000] // 0.05%, 0.3%, 1%

		for (const fee of fees) {
			try {
				const pool = await destClient.readContract({
					address: v3Factory,
					abi: UniswapV3Factory.ABI,
					functionName: "getPool",
					args: [tokenIn, tokenOut, fee],
				})

				if (pool !== ADDRESS_ZERO) {
					const liquidity = await destClient.readContract({
						address: pool,
						abi: UniswapV3Pool.ABI,
						functionName: "liquidity",
					})

					if (liquidity > BigInt(0)) {
						// Get quote from quoter
						const quoteResult = (await destClient.readContract({
							address: v3Quoter,
							abi: UniswapV3Quoter.ABI,
							functionName: "quoteExactInputSingle",
							args: [
								{
									tokenIn: tokenIn,
									tokenOut: tokenOut,
									fee: fee,
									amountIn: amountIn,
									sqrtPriceLimitX96: BigInt(0),
								},
							],
						})) as [bigint, bigint, number, bigint] // [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate]

						const [amountOut, , , gasEstimate] = quoteResult

						if (amountOut > bestV3AmountOut) {
							bestV3AmountOut = amountOut
							bestV3Fee = fee
							v3GasEstimate = gasEstimate
						}
					}
				}
			} catch (error) {
				console.warn(`V3 quote failed for fee ${fee}, continuing to next fee tier`)
				// Continue to next fee tier
			}
		}

		amountOutV3 = bestV3AmountOut

		if (amountOutV2 === BigInt(0) && amountOutV3 === BigInt(0)) {
			// No liquidity in either protocol
			return {
				protocol: null,
				amountOut: BigInt(0),
			}
		}

		if (amountOutV2 >= amountOutV3) {
			return {
				protocol: "v2",
				amountOut: amountOutV2,
			}
		} else {
			return {
				protocol: "v3",
				amountOut: amountOutV3,
				fee: bestV3Fee,
				gasEstimate: v3GasEstimate,
			}
		}
	}

	async getHostNonce(): Promise<bigint> {
		const nonce = await this.publicClient.readContract({
			abi: evmHost.ABI,
			address: this.params.host,
			functionName: "nonce",
		})

		return nonce
	}

	async isOrderFilled(orderCommitment: HexString, intentGatewayAddress: HexString): Promise<boolean> {
		let filledSlot = await this.publicClient.readContract({
			abi: IntentGateway.ABI,
			address: intentGatewayAddress,
			functionName: "calculateCommitmentSlotHash",
			args: [orderCommitment],
		})

		const filledStatus = await this.publicClient.getStorageAt({
			address: intentGatewayAddress,
			slot: filledSlot,
		})
		return filledStatus !== "0x0000000000000000000000000000000000000000000000000000000000000000"
	}
}

function transformOrderForContract(order: Order) {
	return {
		sourceChain: order.sourceChain as HexString,
		destChain: order.destChain as HexString,
		fees: order.fees,
		callData: order.callData,
		deadline: order.deadline,
		nonce: order.nonce,
		inputs: order.inputs.map((input) => ({
			token: input.token,
			amount: input.amount,
		})),
		outputs: order.outputs.map((output) => ({
			token: output.token,
			amount: output.amount,
			beneficiary: output.beneficiary,
		})),
		user: order.user,
	}
}

/**
 * Slot for storing request commitments.
 */
export const REQUEST_COMMITMENTS_SLOT = 0n

/**
 * Slot index for response commitments map
 */
export const RESPONSE_COMMITMENTS_SLOT = 1n

/**
 * Slot index for requests receipts map
 */
export const REQUEST_RECEIPTS_SLOT = 2n

/**
 * Slot index for response receipts map
 */
export const RESPONSE_RECEIPTS_SLOT = 3n

/**
 * Slot index for state commitment map
 */
export const STATE_COMMITMENTS_SLOT = 5n

function requestCommitmentKey(key: Hex): Hex {
	// First derive the map key
	const keyBytes = hexToBytes(key)
	const slot = REQUEST_COMMITMENTS_SLOT
	const mappedKey = deriveMapKey(keyBytes, slot)

	// Convert the derived key to BigInt and add 1
	const number = bytesToBigInt(hexToBytes(mappedKey)) + 1n

	// Convert back to 32-byte hex
	return pad(`0x${number.toString(16)}`, { size: 32 })
}

function responseCommitmentKey(key: Hex): Hex {
	// First derive the map key
	const keyBytes = hexToBytes(key)
	const slot = RESPONSE_COMMITMENTS_SLOT
	const mappedKey = deriveMapKey(keyBytes, slot)

	// Convert the derived key to BigInt and add 1
	const number = bytesToBigInt(hexToBytes(mappedKey)) + 1n

	// Convert back to 32-byte hex
	return pad(`0x${number.toString(16)}`, { size: 32 })
}

function deriveMapKey(key: Uint8Array, slot: bigint): Hex {
	// Convert slot to 32-byte big-endian representation
	const slotBytes = pad(`0x${slot.toString(16)}`, { size: 32 })

	// Combine key and slot bytes
	const combined = new Uint8Array([...key, ...toBytes(slotBytes)])

	// Calculate keccak256 hash
	return keccak256(combined)
}

/**
 * Derives the storage slot for a specific field in the StateCommitment struct
 *
 * struct StateCommitment {
 *   uint256 timestamp;     // slot + 0
 *   bytes32 overlayRoot;   // slot + 1
 *   bytes32 stateRoot;     // slot + 2
 * }
 *
 * @param stateMachineId - The state machine ID
 * @param height - The block height
 * @param field - The field index in the struct (0 for timestamp, 1 for overlayRoot, 2 for stateRoot)
 * @returns The storage slot for the specific field
 */
export function getStateCommitmentFieldSlot(stateMachineId: bigint, height: bigint, field: 0 | 1 | 2): HexString {
	const baseSlot = getStateCommitmentSlot(stateMachineId, height)
	const slotNumber = bytesToBigInt(toBytes(baseSlot)) + BigInt(field)
	return pad(`0x${slotNumber.toString(16)}`, { size: 32 })
}

export function getStateCommitmentSlot(stateMachineId: bigint, height: bigint): HexString {
	// First level mapping: keccak256(stateMachineId . STATE_COMMITMENTS_SLOT)
	const firstLevelSlot = deriveFirstLevelSlot(stateMachineId, STATE_COMMITMENTS_SLOT)

	// Second level mapping: keccak256(height . firstLevelSlot)
	return deriveSecondLevelSlot(height, firstLevelSlot)
}

function deriveFirstLevelSlot(key: bigint, slot: bigint): HexString {
	const keyHex = pad(`0x${key.toString(16)}`, { size: 32 })
	const keyBytes = toBytes(keyHex)

	const slotBytes = toBytes(pad(`0x${slot.toString(16)}`, { size: 32 }))

	const combined = new Uint8Array([...keyBytes, ...slotBytes])

	return keccak256(combined)
}

function deriveSecondLevelSlot(key: bigint, firstLevelSlot: HexString): HexString {
	const keyHex = pad(`0x${key.toString(16)}`, { size: 32 })
	const keyBytes = toBytes(keyHex)

	const slotBytes = toBytes(firstLevelSlot)

	const combined = new Uint8Array([...keyBytes, ...slotBytes])

	return keccak256(combined)
}
