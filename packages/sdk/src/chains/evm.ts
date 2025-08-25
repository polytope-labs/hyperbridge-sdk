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
	hexToString,
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
	calculateMMRSize,
	constructRedeemEscrowRequestBody,
	EvmStateProof,
	fetchTokenUsdPrice,
	generateRootWithProof,
	getStorageSlot,
	mmrPositionToKIndex,
	MmrProof,
	MOCK_ADDRESS,
	SubstrateStateProof,
} from "@/utils"
import {
	DispatchPost,
	HostParams,
	type FillOptions,
	type HexString,
	type IMessage,
	type IPostRequest,
	type Order,
	type StateMachineHeight,
	type StateMachineIdParams,
} from "@/types"
import evmHost from "@/abis/evmHost"
import { ChainConfigService } from "@/configs/ChainConfigService"

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
	private chainConfigService: ChainConfigService

	constructor(private readonly params: EvmChainParams) {
		// @ts-ignore
		this.publicClient = createPublicClient({
			// @ts-ignore
			chain: chains[params.chainId],
			transport: http(params.url),
		})
		this.chainConfigService = new ChainConfigService()
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
	 * This function estimates the gas required to fill the order, including the gas required to post the request to the destination chain.
	 *
	 * @param order - The order to fill
	 * @param fillerWalletAddress - The address of the wallet that will fill the order
	 * @param destChain - The destination chain to fill the order on
	 * @returns The estimated gas amount in fee token (DAI)
	 */
	async estimateFillOrder(order: Order, destChain: EvmChain): Promise<bigint> {
		const postRequest: IPostRequest = {
			source: order.destChain,
			dest: order.sourceChain,
			body: constructRedeemEscrowRequestBody(order, MOCK_ADDRESS),
			timeoutTimestamp: 0n,
			nonce: await this.getHostNonce(),
			from: this.chainConfigService.getIntentGatewayAddress(order.destChain),
			to: this.chainConfigService.getIntentGatewayAddress(order.sourceChain),
		}

		const { decimals: sourceChainFeeTokenDecimals } = await this.getFeeTokenWithDecimals()
		const { address: destChainFeeTokenAddress, decimals: destChainFeeTokenDecimals } =
			await destChain.getFeeTokenWithDecimals()

		// Get source post gas estimate directly in source chain decimals
		const postGasEstimate = await this.estimateGas(postRequest)
		const postGasEstimateInSourceFeeToken = await this.convertGasToFeeToken(
			postGasEstimate,
			this.publicClient,
			sourceChainFeeTokenDecimals,
		)

		// 2% markup
		const RELAYER_FEE_BPS = 200n
		const relayerFeeInSourceFeeToken =
			postGasEstimateInSourceFeeToken + (postGasEstimateInSourceFeeToken * RELAYER_FEE_BPS) / 10000n

		// Convert relayer fee to dest chain decimals for fillOrder call
		const relayerFeeInDestFeeToken = this.adjustFeeDecimals(
			relayerFeeInSourceFeeToken,
			sourceChainFeeTokenDecimals,
			destChainFeeTokenDecimals,
		)

		const fillOptions: FillOptions = {
			relayerFee: relayerFeeInDestFeeToken,
		}

		const totalEthValue = order.outputs
			.filter((output) => bytes32ToBytes20(output.token) === ADDRESS_ZERO)
			.reduce((sum, output) => sum + output.amount, 0n)

		const intentGatewayAddress = this.chainConfigService.getIntentGatewayAddress(order.destChain)
		const testValue = toHex(maxUint256)

		const orderOverrides = await Promise.all(
			order.outputs.map(async (output) => {
				const tokenAddress = bytes32ToBytes20(output.token)

				try {
					const stateDiffs = []

					const balanceSlot = await getStorageSlot(destChain.publicClient, tokenAddress, 0, MOCK_ADDRESS)
					stateDiffs.push({ slot: balanceSlot as HexString, value: testValue })

					try {
						const allowanceSlot = await getStorageSlot(
							destChain.publicClient,
							tokenAddress,
							1,
							MOCK_ADDRESS,
							intentGatewayAddress,
						)
						stateDiffs.push({ slot: allowanceSlot as HexString, value: testValue })
					} catch (e) {
						console.warn(`Could not find allowance slot for token ${tokenAddress}:`, e)
					}

					return { address: tokenAddress, stateDiff: stateDiffs }
				} catch (e) {
					console.warn(`Could not find balance slot for token ${tokenAddress}:`, e)
					return null
				}
			}),
		).then((results) => results.filter(Boolean))

		const destFeeTokenBalanceSlot = await getStorageSlot(
			destChain.publicClient,
			destChainFeeTokenAddress,
			0,
			MOCK_ADDRESS,
		)
		const destFeeTokenAllowanceSlot = await getStorageSlot(
			destChain.publicClient,
			destChainFeeTokenAddress,
			1,
			MOCK_ADDRESS,
			intentGatewayAddress,
		)
		const feeTokenStateDiffs = [
			{ slot: destFeeTokenBalanceSlot, value: testValue },
			{ slot: destFeeTokenAllowanceSlot, value: testValue },
		]

		orderOverrides.push({
			address: destChainFeeTokenAddress,
			stateDiff: feeTokenStateDiffs as any,
		})

		const destChainFillGas = await destChain.publicClient.estimateContractGas({
			abi: IntentGateway.ABI,
			address: intentGatewayAddress,
			functionName: "fillOrder",
			args: [transformOrderForContract(order), fillOptions as any],
			account: MOCK_ADDRESS,
			value: totalEthValue,
			stateOverride: orderOverrides as any,
		})

		// Convert dest chain gas directly to source chain decimals
		const fillGasInSourceFeeToken = await this.convertGasToFeeToken(
			destChainFillGas,
			destChain.publicClient,
			sourceChainFeeTokenDecimals,
		)

		const destProtocolFee = await this.getProtocolFee(order, relayerFeeInDestFeeToken)

		const protocolFeeInSourceFeeToken = this.adjustFeeDecimals(
			destProtocolFee,
			destChainFeeTokenDecimals,
			sourceChainFeeTokenDecimals,
		)

		// All values now in source chain fee token decimals
		const totalEstimate = fillGasInSourceFeeToken + protocolFeeInSourceFeeToken + relayerFeeInSourceFeeToken

		const SWAP_OPERATIONS_BPS = 1000n // 10% buffer for potential swaps
		const swapOperationsInFeeToken = (totalEstimate * SWAP_OPERATIONS_BPS) / 10000n
		return totalEstimate + swapOperationsInFeeToken
	}

	/**
	 * Converts a gas estimate to a fee token amount.
	 * This function converts a gas estimate to a fee token amount, taking into account the gas price, the native token decimals, and the target fee token decimals.
	 *
	 * @param gasEstimate - The gas estimate to convert
	 * @param publicClient - The public client to use
	 * @param targetDecimals - The decimals of the target fee token
	 * @returns The fee token amount
	 */
	private async convertGasToFeeToken(
		gasEstimate: bigint,
		publicClient: PublicClient,
		targetDecimals: number,
	): Promise<bigint> {
		const gasPrice = await publicClient.getGasPrice()
		const gasCostInWei = gasEstimate * gasPrice
		const nativeToken = publicClient.chain?.nativeCurrency

		if (!nativeToken?.symbol || !nativeToken?.decimals) {
			throw new Error("Chain native currency information not available")
		}

		const gasCostInToken = Number(gasCostInWei) / Math.pow(10, nativeToken.decimals)
		const tokenPriceUsd = await fetchTokenUsdPrice(nativeToken.symbol)
		const gasCostUsd = gasCostInToken * tokenPriceUsd

		const feeTokenPriceUsd = await fetchTokenUsdPrice("DAI") // Using DAI as default
		const gasCostInFeeToken = gasCostUsd / feeTokenPriceUsd

		return BigInt(Math.floor(gasCostInFeeToken * Math.pow(10, targetDecimals)))
	}

	/**
	 * Convert relayer fee amount between tokens with different decimals.
	 *
	 * @param relayerFeeInFeeToken The fee amount in source token units
	 * @param fromDecimals Decimals the relayerFeeInFeeToken is currently in
	 * @param toDecimals Decimals the relayerFeeInFeeToken should be converted to
	 * @returns Fee amount adjusted to destination token decimals
	 */
	adjustFeeDecimals(feeInFeeToken: bigint, fromDecimals: number, toDecimals: number): bigint {
		if (fromDecimals === toDecimals) {
			return feeInFeeToken
		}

		if (fromDecimals < toDecimals) {
			// Scale UP (no precision loss)
			const scaleFactor = BigInt(10 ** (toDecimals - fromDecimals))
			return feeInFeeToken * scaleFactor
		} else {
			// Scale DOWN (ceil division to avoid undercharging)
			const scaleFactor = BigInt(10 ** (fromDecimals - toDecimals))
			return (feeInFeeToken + scaleFactor - 1n) / scaleFactor
		}
	}

	async getFeeTokenWithDecimals(): Promise<{ address: HexString; decimals: number }> {
		const hostParams = await this.publicClient.readContract({
			abi: EvmHost.ABI,
			address: this.params.host,
			functionName: "hostParams",
		})
		const feeTokenAddress = hostParams.feeToken
		const feeTokenDecimals = await this.publicClient.readContract({
			address: feeTokenAddress,
			abi: erc20Abi,
			functionName: "decimals",
		})
		return { address: feeTokenAddress, decimals: feeTokenDecimals }
	}

	/**
	 * Finds the best protocol to use for a swap.
	 * This function finds the best protocol to use for a swap, including the best fee and gas estimate.
	 *
	 * @param chain - The chain to use for the swap
	 * @param tokenIn - The address of the input token
	 * @param tokenOut - The address of the output token
	 * @param amountOut - The amount of output tokens to swap
	 * @returns The best protocol to use for the swap
	 */
	async findBestProtocolWithAmountOut(
		chain: string,
		tokenIn: HexString,
		tokenOut: HexString,
		amountOut: bigint,
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

		const v2Router = this.chainConfigService.getUniswapRouterV2Address(chain)
		const v2Factory = this.chainConfigService.getUniswapV2FactoryAddress(chain)
		const v3Factory = this.chainConfigService.getUniswapV3FactoryAddress(chain)
		const v3Quoter = this.chainConfigService.getUniswapV3QuoterAddress(chain)

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
	 * @param chain - The chain to use for the swap
	 * @param tokenIn - The address of the input token
	 * @param tokenOut - The address of the output token
	 * @param amountIn - The amount of input tokens to swap
	 * @returns The best protocol to use for the swap
	 */
	async findBestProtocolWithAmountIn(
		chain: string,
		tokenIn: HexString,
		tokenOut: HexString,
		amountIn: bigint,
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

		const v2Router = this.chainConfigService.getUniswapRouterV2Address(chain)
		const v2Factory = this.chainConfigService.getUniswapV2FactoryAddress(chain)
		const v3Factory = this.chainConfigService.getUniswapV3FactoryAddress(chain)
		const v3Quoter = this.chainConfigService.getUniswapV3QuoterAddress(chain)

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

	/**
	 * Gets the nonce of the host.
	 * This function gets the nonce of the host.
	 *
	 * @returns The nonce of the host
	 */
	async getHostNonce(): Promise<bigint> {
		const nonce = await this.publicClient.readContract({
			abi: evmHost.ABI,
			address: this.params.host,
			functionName: "nonce",
		})

		return nonce
	}

	/**
	 * Gets the HyperBridge protocol fee in fee token
	 */
	async getProtocolFee(order: Order, relayerFee: bigint): Promise<bigint> {
		const destClient = this.publicClient
		const requestBody = constructRedeemEscrowRequestBody(order, MOCK_ADDRESS)

		const dispatchPost: DispatchPost = {
			dest: toHex(order.sourceChain),
			to: this.chainConfigService.getIntentGatewayAddress(order.sourceChain),
			body: requestBody,
			timeout: 0n,
			fee: relayerFee,
			payer: MOCK_ADDRESS,
		}

		const protocolFee = await destClient.readContract({
			abi: IntentGateway.ABI,
			address: this.chainConfigService.getIntentGatewayAddress(order.destChain),
			functionName: "quote",
			args: [dispatchPost as any],
		})

		return protocolFee
	}

	/**
	 * Checks if an order has been filled.
	 * This function checks if an order has been filled by checking the filled status of the order commitment.
	 *
	 * @param orderCommitment - The commitment of the order
	 * @param intentGatewayAddress - The address of the intent gateway
	 * @returns True if the order has been filled, false otherwise
	 */
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
		sourceChain: toHex(order.sourceChain),
		destChain: toHex(order.destChain),
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
