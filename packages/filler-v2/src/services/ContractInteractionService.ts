import { getContract, toHex, encodePacked, keccak256, maxUint256, formatUnits, parseUnits } from "viem"
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts"
import {
	ADDRESS_ZERO,
	Order,
	PaymentInfo,
	HexString,
	bytes32ToBytes20,
	getGasPriceFromEtherscan,
	USE_ETHERSCAN_CHAINS,
	retryPromise,
	OrderV2,
	IntentGatewayV2,
	EvmChain,
	getChainId,
} from "@hyperbridge/sdk"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { ChainClientManager } from "./ChainClientManager"
import { FillerConfigService } from "./FillerConfigService"
import { EVM_HOST } from "@/config/abis/EvmHost"
import { ApiPromise } from "@polkadot/api"
import { CacheService } from "./CacheService"
import { getLogger } from "@/services/Logger"
import { Decimal } from "decimal.js"

// Configure for financial precision
Decimal.config({ precision: 28, rounding: 4 })
/**
 * Handles contract interactions for tokens and other contracts
 */
export class ContractInteractionService {
	private configService: FillerConfigService
	private api: ApiPromise | null = null
	public cacheService: CacheService
	private logger = getLogger("contract-service")

	constructor(
		private clientManager: ChainClientManager,
		private privateKey: HexString,
		configService: FillerConfigService,
		sharedCacheService?: CacheService,
	) {
		this.configService = configService
		this.cacheService = sharedCacheService || new CacheService()
		this.initCache()
	}

	/**
	 * Gets the SDK helper for a given source and destination chain
	 * @dev TODO: This creates a new EvmChain instance for each call, which is inefficient.
	 * @note: We should cache the EvmChain instances and reuse them.
	 */

	async getSdkHelper(source: string, destination: string): Promise<IntentGatewayV2> {
		const sourceClient = this.clientManager.getPublicClient(source)
		const destinationClient = this.clientManager.getPublicClient(destination)
		const sourceEvmChain = new EvmChain({
			chainId: getChainId(source)!,
			host: this.configService.getHostAddress(source),
			rpcUrl: sourceClient.transport.url,
		})
		const destinationEvmChain = new EvmChain({
			chainId: getChainId(destination)!,
			host: this.configService.getHostAddress(destination),
			rpcUrl: destinationClient.transport.url,
		})
		return new IntentGatewayV2(sourceEvmChain, destinationEvmChain)
	}

	async initCache(): Promise<void> {
		const chainIds = this.configService.getConfiguredChainIds()
		const chainNames = chainIds.map((id) => `EVM-${id}`)
		for (const chainName of chainNames) {
			await this.getFeeTokenWithDecimals(chainName)
		}

		for (const destChain of chainNames) {
			const destClient = this.clientManager.getPublicClient(destChain)
			const usdc = this.configService.getUsdcAsset(destChain)
			const usdt = this.configService.getUsdtAsset(destChain)
			await this.getTokenDecimals(usdc, destChain)
			await this.getTokenDecimals(usdt, destChain)
			for (const sourceChain of chainNames) {
				if (sourceChain === destChain) continue
				// Check cache before making RPC call to avoid duplicate requests when cache is shared
				const cachedPerByteFee = this.cacheService.getPerByteFee(destChain, sourceChain)
				if (cachedPerByteFee === null) {
					const perByteFee = await retryPromise(
						() =>
							destClient.readContract({
								address: this.configService.getHostAddress(destChain),
								abi: EVM_HOST,
								functionName: "perByteFee",
								args: [toHex(sourceChain)],
							}),
						{
							maxRetries: 3,
							backoffMs: 250,
							logMessage: "Failed to load perByteFee for cache initialization",
						},
					)
					this.cacheService.setPerByteFee(destChain, sourceChain, perByteFee)
				}
			}
		}
	}

	/**
	 * Gets the decimals for a token
	 */
	async getTokenDecimals(tokenAddress: string, chain: string): Promise<number> {
		const bytes20Address = tokenAddress.length === 66 ? bytes32ToBytes20(tokenAddress) : tokenAddress

		if (bytes20Address === ADDRESS_ZERO) {
			return 18 // Native token (ETH, MATIC, etc.)
		}

		const cachedTokenDecimals = this.cacheService.getTokenDecimals(chain, bytes20Address as HexString)
		if (cachedTokenDecimals) {
			return cachedTokenDecimals
		}

		const client = this.clientManager.getPublicClient(chain)

		try {
			const decimals = await retryPromise(
				() =>
					client.readContract({
						address: bytes20Address as HexString,
						abi: ERC20_ABI,
						functionName: "decimals",
					}),
				{
					maxRetries: 3,
					backoffMs: 250,
					logMessage: "Failed to get token decimals",
				},
			)

			this.cacheService.setTokenDecimals(chain, bytes20Address as HexString, decimals)
			return decimals
		} catch (error) {
			this.logger.warn({ err: error }, "Error getting token decimals, defaulting to 18")
			return 18 // Default to 18 if we can't determine
		}
	}

	/**
	 * Approves ERC20 tokens for the contract if needed
	 */
	async approveTokensIfNeeded(order: OrderV2): Promise<void> {
		const wallet = privateKeyToAccount(this.privateKey)
		const destClient = this.clientManager.getPublicClient(order.destination)
		const walletClient = this.clientManager.getWalletClient(order.destination)
		const intentGateway = this.configService.getIntentGatewayV2Address(order.destination)

		const tokens = [
			...new Set(
				order.output.assets.map((o) => bytes32ToBytes20(o.token)).filter((addr) => addr !== ADDRESS_ZERO),
			),
			(await this.getFeeTokenWithDecimals(order.destination)).address,
		].map((address) => ({
			address,
			amount: order.output.assets.find((o) => bytes32ToBytes20(o.token) === address)?.amount || maxUint256 / 2n,
		}))

		for (const token of tokens) {
			const allowance = await retryPromise(
				() =>
					destClient.readContract({
						abi: ERC20_ABI,
						address: token.address as HexString,
						functionName: "allowance",
						args: [wallet.address, intentGateway],
					}),
				{
					maxRetries: 3,
					backoffMs: 250,
					logMessage: "Failed to get token allowance",
				},
			)

			if (allowance < token.amount) {
				this.logger.info({ token: token.address }, "Approving token")
				const etherscanApiKey = this.configService.getEtherscanApiKey()
				const chain = order.destination
				const useEtherscan = USE_ETHERSCAN_CHAINS.has(chain)
				const gasPrice =
					useEtherscan && etherscanApiKey
						? await retryPromise(() => getGasPriceFromEtherscan(order.destination, etherscanApiKey), {
								maxRetries: 3,
								backoffMs: 250,
							}).catch(async () => {
								this.logger.warn(
									{ chain: order.destination },
									"Error getting gas price from etherscan, using client's gas price",
								)
								return await destClient.getGasPrice()
							})
						: await destClient.getGasPrice()
				const tx = await walletClient.writeContract({
					abi: ERC20_ABI,
					address: token.address as HexString,
					functionName: "approve",
					args: [intentGateway, maxUint256],
					account: wallet,
					chain: walletClient.chain,
					gasPrice: gasPrice + (gasPrice * 2000n) / 10000n,
				})

				await retryPromise(() => destClient.waitForTransactionReceipt({ hash: tx }), {
					maxRetries: 3,
					backoffMs: 250,
					logMessage: "Failed while waiting for approval transaction receipt",
				})
				this.logger.info({ token: token.address }, "Approved token")
			}
		}
	}

	/**
	 * Transforms the order object to match the contract's expected format
	 */
	transformOrderForContract(order: OrderV2) {
		return {
			source: toHex(order.source),
			destination: toHex(order.destination),
			deadline: order.deadline,
			nonce: order.nonce,
			fees: order.fees,
			session: order.session,
			predispatch: order.predispatch,
			output: {
				beneficiary: order.output.beneficiary,
				assets: order.output.assets,
				call: order.output.call,
			},
			inputs: order.inputs,
			user: order.user,
		}
	}

	/**
	 * Estimates gas for filling an order
	 */
	async estimateGasFillPost(order: OrderV2): Promise<{
		totalCostInSourceFeeToken: bigint
		dispatchFee: bigint
		nativeDispatchFee: bigint
		callGasLimit: bigint
	}> {
		try {
			const cachedEstimate = this.cacheService.getGasEstimate(order.id!)
			if (cachedEstimate) {
				return cachedEstimate
			}
			const sdkHelper = await this.getSdkHelper(order.source, order.destination)
			const estimate = await sdkHelper.estimateFillOrderV2({
				order,
				solverAccountAddress: privateKeyToAddress(this.privateKey),
			})
			this.cacheService.setGasEstimate(
				order.id!,
				estimate.totalGasInFeeToken,
				estimate.fillOptions.relayerFee,
				estimate.fillOptions.nativeDispatchFee,
				estimate.callGasLimit,
			)
			return {
				totalCostInSourceFeeToken: estimate.totalGasInFeeToken,
				dispatchFee: estimate.fillOptions.relayerFee,
				nativeDispatchFee: estimate.fillOptions.nativeDispatchFee,
				callGasLimit: estimate.callGasLimit,
			}
		} catch (error) {
			this.logger.error({ err: error }, "Error estimating gas")
			// Return a conservative estimate if we can't calculate precisely
			return { totalCostInSourceFeeToken: 6000000n, dispatchFee: 0n, nativeDispatchFee: 0n, callGasLimit: 0n }
		}
	}

	/**
	 * Gets the fee token address and decimals for a given chain.
	 *
	 * @param chain - The chain identifier to get fee token info for
	 * @returns An object containing the fee token address and its decimal places
	 */
	async getFeeTokenWithDecimals(chain: string): Promise<{ address: HexString; decimals: number }> {
		const cachedFeeToken = this.cacheService.getFeeTokenWithDecimals(chain)
		if (cachedFeeToken) {
			return cachedFeeToken
		}
		const client = this.clientManager.getPublicClient(chain)
		const feeTokenAddress = await retryPromise(
			() =>
				client.readContract({
					abi: EVM_HOST,
					address: this.configService.getHostAddress(chain),
					functionName: "feeToken",
				}),
			{
				maxRetries: 3,
				backoffMs: 250,
				logMessage: "Failed to get fee token address",
			},
		)
		const feeTokenDecimals = await retryPromise(
			() =>
				client.readContract({
					address: feeTokenAddress,
					abi: ERC20_ABI,
					functionName: "decimals",
				}),
			{
				maxRetries: 3,
				backoffMs: 250,
				logMessage: "Failed to get fee token decimals",
			},
		)
		this.cacheService.setFeeTokenWithDecimals(chain, feeTokenAddress, feeTokenDecimals)
		return { address: feeTokenAddress, decimals: feeTokenDecimals }
	}

	/**
	 * Calculates the total USD value of tokens in an order's inputs and outputs.
	 *
	 * @param order - The order to calculate token values for
	 * @returns An object containing the total USD values of outputs and inputs
	 */
	async getTokenUsdValue(order: OrderV2): Promise<{ outputUsdValue: Decimal; inputUsdValue: Decimal }> {
		let outputUsdValue = new Decimal(0)
		let inputUsdValue = new Decimal(0)
		const outputs = order.output.assets
		const inputs = order.inputs

		// Restrict to only USDC and USDT on both sides; otherwise throw error
		const destUsdc = this.configService.getUsdcAsset(order.destination)
		const destUsdt = this.configService.getUsdtAsset(order.destination)
		const sourceUsdc = this.configService.getUsdcAsset(order.source)
		const sourceUsdt = this.configService.getUsdtAsset(order.source)

		const outputsAreStableOnly = outputs.every((o) => {
			const addr = bytes32ToBytes20(o.token).toLowerCase()
			return addr === destUsdc || addr === destUsdt
		})
		const inputsAreStableOnly = inputs.every((i) => {
			const addr = bytes32ToBytes20(i.token).toLowerCase()
			return addr === sourceUsdc || addr === sourceUsdt
		})

		if (!outputsAreStableOnly || !inputsAreStableOnly) {
			throw new Error("Only USDC and USDT are supported for token value calculation")
		}

		// For stables, USD value equals the normalized token amount (peg ~ $1)
		for (const output of outputs) {
			const tokenAddress = bytes32ToBytes20(output.token)
			const decimals = await this.getTokenDecimals(tokenAddress, order.destination)
			const amount = output.amount
			const tokenAmount = new Decimal(formatUnits(amount, decimals))
			outputUsdValue = outputUsdValue.plus(tokenAmount)
		}

		for (const input of inputs) {
			const tokenAddress = bytes32ToBytes20(input.token)
			const decimals = await this.getTokenDecimals(tokenAddress, order.source)
			const amount = input.amount
			const tokenAmount = new Decimal(formatUnits(amount, decimals))
			inputUsdValue = inputUsdValue.plus(tokenAmount)
		}

		return { outputUsdValue, inputUsdValue }
	}
}
