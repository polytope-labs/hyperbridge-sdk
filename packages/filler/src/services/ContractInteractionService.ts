import {
	getContract,
	toHex,
	encodePacked,
	keccak256,
	maxUint256,
	PublicClient,
	encodeAbiParameters,
	parseAbiParameters,
	formatUnits,
	parseUnits,
} from "viem"
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts"
import {
	ADDRESS_ZERO,
	Order,
	PaymentInfo,
	HexString,
	FillOptions,
	DispatchPost,
	bytes32ToBytes20,
	bytes20ToBytes32,
	estimateGasForPost,
	constructRedeemEscrowRequestBody,
	IPostRequest,
	getStorageSlot,
	ERC20Method,
	fetchPrice,
} from "@hyperbridge/sdk"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { ChainClientManager } from "./ChainClientManager"
import { FillerConfigService } from "./FillerConfigService"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { EVM_HOST } from "@/config/abis/EvmHost"
import { orderCommitment } from "@hyperbridge/sdk"
import { ApiPromise, WsProvider } from "@polkadot/api"
import { keccakAsU8a } from "@polkadot/util-crypto"
import { CacheService } from "./CacheService"
import { UNISWAP_V2_FACTORY_ABI } from "@/config/abis/UniswapV2Factory"
import { UNISWAP_ROUTER_V2_ABI } from "@/config/abis/UniswapRouterV2"
import { UNISWAP_V3_FACTORY_ABI } from "@/config/abis/UniswapV3Factory"
import { UNISWAP_V3_POOL_ABI } from "@/config/abis/UniswapV3Pool"
import { UNISWAP_V3_QUOTER_V2_ABI } from "@/config/abis/UniswapV3QuoterV2"
import { UNISWAP_V4_QUOTER_ABI } from "@/config/abis/UniswapV4Quoter"
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
	) {
		this.configService = configService
		this.cacheService = new CacheService()
	}

	/**
	 * Gets the balance of a token for a wallet
	 */
	async getTokenBalance(tokenAddress: string, walletAddress: string, chain: string): Promise<bigint> {
		const client = this.clientManager.getPublicClient(chain)

		if (tokenAddress === ADDRESS_ZERO) {
			return await client.getBalance({ address: walletAddress as HexString })
		}

		const tokenContract = getContract({
			address: tokenAddress as HexString,
			abi: ERC20_ABI,
			client,
		})

		const balance = await tokenContract.read.balanceOf([walletAddress as HexString])

		return balance
	}

	/**
	 * Gets the decimals for a token
	 */
	async getTokenDecimals(tokenAddress: string, chain: string): Promise<number> {
		const bytes20Address = tokenAddress.length === 66 ? bytes32ToBytes20(tokenAddress) : tokenAddress

		if (bytes20Address === ADDRESS_ZERO) {
			return 18 // Native token (ETH, MATIC, etc.)
		}

		const client = this.clientManager.getPublicClient(chain)

		try {
			const decimals = await client.readContract({
				address: bytes20Address as HexString,
				abi: ERC20_ABI,
				functionName: "decimals",
			})

			return decimals
		} catch (error) {
			this.logger.warn({ err: error }, "Error getting token decimals, defaulting to 18")
			return 18 // Default to 18 if we can't determine
		}
	}

	/**
	 * Checks if we have sufficient token balances to fill the order
	 */
	async checkTokenBalances(outputs: PaymentInfo[], destChain: string): Promise<boolean> {
		try {
			let totalNativeTokenNeeded = BigInt(0)
			const fillerWalletAddress = privateKeyToAddress(this.privateKey)
			const destClient = this.clientManager.getPublicClient(destChain)

			// Check all token balances
			for (const output of outputs) {
				const tokenAddress = bytes32ToBytes20(output.token)
				const amount = output.amount

				if (tokenAddress === ADDRESS_ZERO) {
					// Native token
					totalNativeTokenNeeded = totalNativeTokenNeeded + amount
				} else {
					// ERC20 token
					const balance = await this.getTokenBalance(tokenAddress, fillerWalletAddress, destChain)

					if (balance < amount) {
						this.logger.debug(
							{ tokenAddress, balance: balance.toString(), need: amount.toString() },
							"Insufficient token balance",
						)
						return false
					}
				}
			}

			// Check if we have enough native token
			if (totalNativeTokenNeeded > 0n) {
				const nativeBalance = await destClient.getBalance({ address: fillerWalletAddress })

				if (BigInt(nativeBalance.toString()) < totalNativeTokenNeeded) {
					this.logger.debug(
						{ have: nativeBalance.toString(), need: totalNativeTokenNeeded.toString() },
						"Insufficient native token balance",
					)
					return false
				}
			}

			return true
		} catch (error) {
			this.logger.error({ err: error }, "Error checking token balances")
			return false
		}
	}

	/**
	 * Approves ERC20 tokens for the contract if needed
	 */
	async approveTokensIfNeeded(order: Order): Promise<void> {
		const wallet = privateKeyToAccount(this.privateKey)
		const destClient = this.clientManager.getPublicClient(order.destChain)
		const walletClient = this.clientManager.getWalletClient(order.destChain)
		const intentGateway = this.configService.getIntentGatewayAddress(order.destChain)

		const tokens = [
			...new Set(order.outputs.map((o) => bytes32ToBytes20(o.token)).filter((addr) => addr !== ADDRESS_ZERO)),
			(await this.getFeeTokenWithDecimals(order.destChain)).address,
		].map((address) => ({
			address,
			amount: order.outputs.find((o) => bytes32ToBytes20(o.token) === address)?.amount || maxUint256 / 2n,
		}))

		for (const token of tokens) {
			const allowance = await destClient.readContract({
				abi: ERC20_ABI,
				address: token.address as HexString,
				functionName: "allowance",
				args: [wallet.address, intentGateway],
			})

			if (allowance < token.amount) {
				this.logger.info({ token: token.address }, "Approving token")
				const gasPrice = await destClient.getGasPrice()

				const tx = await walletClient.writeContract({
					abi: ERC20_ABI,
					address: token.address as HexString,
					functionName: "approve",
					args: [intentGateway, maxUint256],
					account: wallet,
					chain: walletClient.chain,
					gasPrice: gasPrice + (gasPrice * 2000n) / 10000n,
				})

				await destClient.waitForTransactionReceipt({ hash: tx })
				this.logger.info({ token: token.address }, "Approved token")
			}
		}
	}

	/**
	 * Calculates the ETH value to send with the transaction
	 */
	calculateRequiredEthValue(outputs: PaymentInfo[]): bigint {
		let totalEthValue = 0n

		for (const output of outputs) {
			const bytes20Address = bytes32ToBytes20(output.token)
			if (bytes20Address === ADDRESS_ZERO) {
				// Native token output
				totalEthValue = totalEthValue + output.amount
			}
		}

		return totalEthValue
	}

	/**
	 * Transforms the order object to match the contract's expected format
	 */
	transformOrderForContract(order: Order) {
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
	 * Checks if an order is already filled by querying contract storage
	 */
	async checkIfOrderFilled(order: Order): Promise<boolean> {
		try {
			const commitment = orderCommitment(order)
			const sourceClient = this.clientManager.getPublicClient(order.sourceChain)
			const intentGatewayAddress = this.configService.getIntentGatewayAddress(order.sourceChain)

			const mappingSlot = 5n

			const filledSlot = keccak256(encodePacked(["bytes32", "uint256"], [commitment, mappingSlot]))

			const filledStatus = await sourceClient.getStorageAt({
				address: intentGatewayAddress,
				slot: filledSlot,
			})
			return filledStatus !== "0x0000000000000000000000000000000000000000000000000000000000000000"
		} catch (error) {
			this.logger.error({ err: error, orderId: order.id }, "Error checking if order filled")
			// Default to assuming it's not filled if we can't check
			return false
		}
	}

	/**
	 * Estimates gas for filling an order
	 */
	async estimateGasFillPost(
		order: Order,
	): Promise<{ fillGas: bigint; postGas: bigint; relayerFeeInFeeToken: bigint; relayerFeeInNativeToken: bigint }> {
		try {
			// Check cache first
			const cachedEstimate = this.cacheService.getGasEstimate(order.id!)
			if (cachedEstimate) {
				this.logger.debug({ orderId: order.id }, "Using cached gas estimate for order")
				return cachedEstimate
			}

			const { sourceClient, destClient } = this.clientManager.getClientsForOrder(order)
			const postRequest: IPostRequest = {
				source: order.destChain,
				dest: order.sourceChain,
				body: constructRedeemEscrowRequestBody(order, privateKeyToAddress(this.privateKey)),
				timeoutTimestamp: 0n,
				nonce: await this.getHostNonce(order.sourceChain),
				from: this.configService.getIntentGatewayAddress(order.destChain),
				to: this.configService.getIntentGatewayAddress(order.sourceChain),
			}

			let { gas_fee: postGasEstimate } = await estimateGasForPost({
				postRequest: postRequest,
				sourceClient: sourceClient as any,
				hostLatestStateMachineHeight: 6291991n,
				hostAddress: this.configService.getHostAddress(order.sourceChain),
			})

			const { decimals: destFeeTokenDecimals, address: destFeeTokenAddress } = await this.getFeeTokenWithDecimals(
				order.destChain,
			)

			let postGasEstimateInDestFeeToken = await this.convertGasToFeeToken(
				postGasEstimate,
				order.sourceChain,
				destFeeTokenDecimals,
			)

			// Add 25 cents on top of execution fees

			postGasEstimateInDestFeeToken += 25n * 10n ** BigInt(destFeeTokenDecimals - 2)

			this.logger.debug(
				{
					orderId: order.id,
					postGasWei: postGasEstimate.toString(),
					postGasInDestFeeToken: postGasEstimateInDestFeeToken.toString(),
					destFeeTokenDecimals,
				},
				"Relayer fee estimates",
			)

			const fillOptions: FillOptions = {
				relayerFee: postGasEstimateInDestFeeToken,
			}

			const ethValue = this.calculateRequiredEthValue(order.outputs)
			const userAddress = privateKeyToAddress(this.privateKey)
			const testValue = toHex(maxUint256 / 2n)
			const intentGatewayAddress = this.configService.getIntentGatewayAddress(order.destChain)

			const overrides = (
				await Promise.all(
					order.outputs.map(async (output) => {
						const tokenAddress = bytes32ToBytes20(output.token)
						if (tokenAddress === ADDRESS_ZERO) return null

						try {
							const balanceData = ERC20Method.BALANCE_OF + bytes20ToBytes32(userAddress).slice(2)
							const balanceSlot = await getStorageSlot(
								destClient as any,
								tokenAddress,
								balanceData as HexString,
							)
							const stateDiffs = [{ slot: balanceSlot as HexString, value: testValue }]

							try {
								const allowanceData =
									ERC20Method.ALLOWANCE +
									bytes20ToBytes32(userAddress).slice(2) +
									bytes20ToBytes32(intentGatewayAddress).slice(2)
								const allowanceSlot = await getStorageSlot(
									destClient as any,
									tokenAddress,
									allowanceData as HexString,
								)
								stateDiffs.push({ slot: allowanceSlot as HexString, value: testValue })
							} catch (e) {
								this.logger.warn({ tokenAddress, err: e }, "Could not find allowance slot for token")
							}

							return { address: tokenAddress, stateDiff: stateDiffs }
						} catch (e) {
							this.logger.warn({ tokenAddress, err: e }, "Could not find balance slot for token")
							return null
						}
					}),
				)
			).filter(Boolean)

			const stateOverride = [
				{
					address: userAddress,
					balance: maxUint256,
				},
				...overrides.map((override) => ({
					address: override!.address,
					stateDiff: override!.stateDiff,
				})),
			]

			let gas = 0n
			let relayerFeeInNativeToken = 0n

			try {
				let protocolFeeInNativeToken = await this.quoteNative(
					postRequest,
					postGasEstimateInDestFeeToken,
					order.destChain,
				)

				// Add 0.5% markup
				protocolFeeInNativeToken = protocolFeeInNativeToken + (protocolFeeInNativeToken * 50n) / 10000n

				gas = await destClient.estimateContractGas({
					abi: INTENT_GATEWAY_ABI,
					address: this.configService.getIntentGatewayAddress(order.destChain),
					functionName: "fillOrder",
					args: [this.transformOrderForContract(order), fillOptions as any],
					account: privateKeyToAccount(this.privateKey),
					value: ethValue + protocolFeeInNativeToken,
					stateOverride: stateOverride as any,
				})
				this.logger.debug(
					{ orderId: order.id, fillGas: gas.toString(), feeMode: "native" },
					"Estimated fill gas",
				)
				relayerFeeInNativeToken = protocolFeeInNativeToken
			} catch {
				this.logger.warn(
					{ chain: order.destChain },
					"Could not estimate gas with native token fees; trying fee token",
				)
				const destChainFeeTokenAddress = (await this.getFeeTokenWithDecimals(order.destChain)).address

				// Check if fee token matches any order output
				const feeTokenMatchesOrderOutput = order.outputs.some(
					(output) => bytes32ToBytes20(output.token.toLowerCase()) === destChainFeeTokenAddress.toLowerCase(),
				)

				if (!feeTokenMatchesOrderOutput) {
					// Only create fee token overrides if it doesn't match any order output
					const destFeeTokenBalanceData = ERC20Method.BALANCE_OF + bytes20ToBytes32(userAddress).slice(2)
					const destFeeTokenBalanceSlot = await getStorageSlot(
						destClient as any,
						destChainFeeTokenAddress,
						destFeeTokenBalanceData as HexString,
					)
					const destFeeTokenAllowanceData =
						ERC20Method.ALLOWANCE +
						bytes20ToBytes32(userAddress).slice(2) +
						bytes20ToBytes32(intentGatewayAddress).slice(2)
					const destFeeTokenAllowanceSlot = await getStorageSlot(
						destClient as any,
						destChainFeeTokenAddress,
						destFeeTokenAllowanceData as HexString,
					)
					const feeTokenStateDiffs = [
						{ slot: destFeeTokenBalanceSlot, value: testValue },
						{ slot: destFeeTokenAllowanceSlot, value: testValue },
					]

					stateOverride.push({
						address: destChainFeeTokenAddress,
						stateDiff: feeTokenStateDiffs as any,
					})
				}

				gas = await destClient.estimateContractGas({
					abi: INTENT_GATEWAY_ABI,
					address: this.configService.getIntentGatewayAddress(order.destChain),
					functionName: "fillOrder",
					args: [this.transformOrderForContract(order), fillOptions as any],
					account: privateKeyToAccount(this.privateKey),
					value: ethValue,
					stateOverride: stateOverride as any,
				})
				this.logger.debug(
					{ orderId: order.id, fillGas: gas.toString(), feeMode: "feeToken" },
					"Estimated fill gas",
				)
			}

			// Cache the results
			this.cacheService.setGasEstimate(
				order.id!,
				gas,
				postGasEstimate,
				postGasEstimateInDestFeeToken,
				relayerFeeInNativeToken,
			)

			return {
				fillGas: gas,
				postGas: postGasEstimate,
				relayerFeeInFeeToken: postGasEstimateInDestFeeToken,
				relayerFeeInNativeToken,
			}
		} catch (error) {
			this.logger.error({ err: error }, "Error estimating gas")
			// Return a conservative estimate if we can't calculate precisely
			return { fillGas: 3000000n, postGas: 270000n, relayerFeeInFeeToken: 10000000n, relayerFeeInNativeToken: 0n }
		}
	}

	/**
	 * Gets a quote for the native token cost of dispatching a post request.
	 *
	 * @param postRequest - The post request to quote
	 * @param fee - The fee amount in fee token
	 * @param chain - The chain identifier where the quote will be executed
	 * @returns The native token amount required
	 */
	async quoteNative(postRequest: IPostRequest, fee: bigint, chain: string): Promise<bigint> {
		const client = this.clientManager.getPublicClient(chain)

		const dispatchPost: DispatchPost = {
			dest: toHex(postRequest.dest),
			to: postRequest.to,
			body: postRequest.body,
			timeout: postRequest.timeoutTimestamp,
			fee: fee,
			payer: postRequest.from,
		}

		const quoteNative = await client
			.readContract({
				abi: INTENT_GATEWAY_ABI,
				address: this.configService.getIntentGatewayAddress(postRequest.dest),
				functionName: "quoteNative",
				args: [dispatchPost] as any,
			})
			.catch(async () => {
				const quoteInFeeToken = await client.readContract({
					abi: INTENT_GATEWAY_ABI,
					address: this.configService.getIntentGatewayAddress(postRequest.dest),
					functionName: "quote",
					args: [dispatchPost] as any,
				})
				const feeToken = (await this.getFeeTokenWithDecimals(chain)).address
				const routerAddr = this.configService.getUniswapRouterV2Address(chain)
				const WETH = this.configService.getWrappedNativeAssetWithDecimals(chain).asset
				const quote = await client.simulateContract({
					abi: UNISWAP_ROUTER_V2_ABI,
					address: routerAddr,
					// @ts-ignore
					functionName: "getAmountsIn",
					// @ts-ignore
					args: [quoteInFeeToken, [WETH, feeToken]],
				})

				return quote.result[0]
			})
		return quoteNative
	}

	/**
	 * Gets the current native token price in USD with 18 decimal precision.
	 *
	 * @param chain - The chain identifier to get native token price for
	 * @returns The native token price in USD scaled to 18 decimals (e.g., $3000.50 becomes 3000500000000000000000n)
	 */
	async getNativeTokenPrice(chain: string): Promise<bigint> {
		let client = this.clientManager.getPublicClient(chain)
		const nativeToken = client.chain?.nativeCurrency
		const chainId = client.chain?.id

		if (!nativeToken?.symbol || !nativeToken?.decimals) {
			throw new Error("Chain native currency information not available")
		}

		const nativeTokenPriceUsd = await fetchPrice(
			nativeToken.symbol,
			chainId,
			this.configService.getCoinGeckoApiKey(),
		)

		return BigInt(Math.floor(nativeTokenPriceUsd * Math.pow(10, 18)))
	}

	/**
	 * Converts gas costs to the equivalent amount in the fee token.
	 * Uses USD pricing to convert between native token gas costs and fee token amounts.
	 *
	 * @param gasEstimate - The estimated gas units
	 * @param chain - The chain identifier to get gas prices and native token info
	 * @param targetDecimals - The decimal places of the target fee token
	 * @returns The gas cost converted to fee token amount
	 */
	async convertGasToFeeToken(gasEstimate: bigint, chain: string, targetDecimals: number): Promise<bigint> {
		const client = this.clientManager.getPublicClient(chain)
		const gasPrice = await client.getGasPrice()
		const gasCostInWei = gasEstimate * gasPrice
		const nativeToken = client.chain?.nativeCurrency
		const chainId = client.chain?.id

		if (!nativeToken?.symbol || !nativeToken?.decimals) {
			throw new Error("Chain native currency information not available")
		}

		const gasCostInToken = new Decimal(formatUnits(gasCostInWei, nativeToken.decimals))
		const tokenPriceUsd = new Decimal(
			await fetchPrice(nativeToken.symbol, chainId, this.configService.getCoinGeckoApiKey()),
		)
		const gasCostUsd = gasCostInToken.times(tokenPriceUsd)

		const feeTokenPriceUsd = new Decimal(1) // DAI/USDC/USDT ≈ $1 (stable coin)
		const gasCostInFeeToken = gasCostUsd.dividedBy(feeTokenPriceUsd)

		return parseUnits(gasCostInFeeToken.toFixed(targetDecimals), targetDecimals)
	}

	/**
	 * Gets the fee token address and decimals for a given chain.
	 *
	 * @param chain - The chain identifier to get fee token info for
	 * @returns An object containing the fee token address and its decimal places
	 */
	async getFeeTokenWithDecimals(chain: string): Promise<{ address: HexString; decimals: number }> {
		const client = this.clientManager.getPublicClient(chain)
		const feeTokenAddress = await client.readContract({
			abi: EVM_HOST,
			address: this.configService.getHostAddress(chain),
			functionName: "feeToken",
		})
		const feeTokenDecimals = await client.readContract({
			address: feeTokenAddress,
			abi: ERC20_ABI,
			functionName: "decimals",
		})
		return { address: feeTokenAddress, decimals: feeTokenDecimals }
	}

	/**
	 * Calculates the fee required to send a post request to the destination chain.
	 * The fee is calculated based on the per-byte fee for the destination chain
	 * multiplied by the size of the request body.
	 *
	 * @param order - The order to calculate the fee for
	 * @returns The total fee in fee token required to send the post request
	 */
	async quote(order: Order): Promise<bigint> {
		const { destClient } = this.clientManager.getClientsForOrder(order)
		const postRequest: IPostRequest = {
			source: order.destChain,
			dest: order.sourceChain,
			body: constructRedeemEscrowRequestBody(order, privateKeyToAddress(this.privateKey)),
			timeoutTimestamp: 0n,
			nonce: await this.getHostNonce(order.sourceChain),
			from: this.configService.getIntentGatewayAddress(order.destChain),
			to: this.configService.getIntentGatewayAddress(order.sourceChain),
		}
		const perByteFee = await destClient.readContract({
			address: this.configService.getHostAddress(order.destChain),
			abi: EVM_HOST,
			functionName: "perByteFee",
			args: [toHex(order.sourceChain)],
		})

		// Exclude 0x prefix from the body length, and get the byte length
		const bodyByteLength = Math.floor((postRequest.body.length - 2) / 2)
		const length = bodyByteLength < 32 ? 32 : bodyByteLength

		return perByteFee * BigInt(length)
	}

	/**
	 * Gets the current nonce from the host contract.
	 *
	 * @param chain - The chain identifier to get the host nonce for
	 * @returns The current nonce value
	 */
	async getHostNonce(chain: string): Promise<bigint> {
		const client = this.clientManager.getPublicClient(chain)
		const nonce = await client.readContract({
			abi: EVM_HOST,
			address: this.configService.getHostAddress(chain),
			functionName: "nonce",
		})

		return nonce
	}

	/**
	 * Gets the latest state machine height from the host.
	 * If a chain is specified, gets the height for that chain's state machine.
	 * Otherwise, gets the current block number from the Hyperbridge API.
	 *
	 * @param chain - Optional chain identifier to get specific state machine height
	 * @returns The latest state machine height or current block number
	 */
	async getHostLatestStateMachineHeight(chain?: string): Promise<bigint> {
		if (!this.api) {
			// Get hyperbridge RPC URL from config service
			const hyperbridgeRpcUrl = this.configService.getHyperbridgeRpcUrl()

			this.api = await ApiPromise.create({
				provider: new WsProvider(hyperbridgeRpcUrl),
				typesBundle: {
					spec: {
						gargantua: {
							hasher: keccakAsU8a,
						},
					},
				},
			})
			if (!(await this.api.isConnected)) {
				await this.api.connect()
			}
		}
		let latestHeight: any

		if (chain) {
			latestHeight = await this.api.query.ismp.latestStateMachineHeight({
				stateId: {
					Evm: this.configService.getChainId(chain),
				},
				consensusStateId: this.configService.getConsensusStateId(chain),
			})

			return BigInt(latestHeight.toString())
		}

		latestHeight = await this.api.query.system.number()

		return BigInt(latestHeight.toString())
	}

	/**
	 * Calculates the total USD value of tokens in an order's inputs and outputs.
	 *
	 * @param order - The order to calculate token values for
	 * @returns An object containing the total USD values of outputs and inputs
	 */
	async getTokenUsdValue(order: Order): Promise<{ outputUsdValue: Decimal; inputUsdValue: Decimal }> {
		const { destClient, sourceClient } = this.clientManager.getClientsForOrder(order)
		let outputUsdValue = new Decimal(0)
		let inputUsdValue = new Decimal(0)
		const outputs = order.outputs
		const inputs = order.inputs

		for (const output of outputs) {
			let tokenAddress = bytes32ToBytes20(output.token)
			let decimals = 18
			let amount = output.amount
			let priceIdentifier: string

			if (tokenAddress === ADDRESS_ZERO) {
				priceIdentifier = destClient.chain?.nativeCurrency?.symbol!
				decimals = destClient.chain?.nativeCurrency?.decimals!
			} else {
				decimals = await this.getTokenDecimals(tokenAddress, order.destChain)
				priceIdentifier = tokenAddress
			}

			const pricePerToken = await fetchPrice(
				priceIdentifier,
				destClient.chain?.id!,
				this.configService.getCoinGeckoApiKey(),
			)

			// Use Decimal for precise calculations
			const tokenAmount = new Decimal(formatUnits(amount, decimals))
			const tokenPrice = new Decimal(pricePerToken)
			const tokenAmountValue = tokenAmount.times(tokenPrice)
			outputUsdValue = outputUsdValue.plus(tokenAmountValue)
		}

		for (const input of inputs) {
			let tokenAddress = bytes32ToBytes20(input.token)
			let decimals = 18
			let amount = input.amount
			let priceIdentifier: string

			if (tokenAddress === ADDRESS_ZERO) {
				priceIdentifier = sourceClient.chain?.nativeCurrency?.symbol!
				decimals = sourceClient.chain?.nativeCurrency?.decimals!
			} else {
				decimals = await this.getTokenDecimals(tokenAddress, order.sourceChain)
				priceIdentifier = tokenAddress
			}

			const pricePerToken = await fetchPrice(
				priceIdentifier,
				sourceClient.chain?.id!,
				this.configService.getCoinGeckoApiKey(),
			)

			const tokenAmount = new Decimal(formatUnits(amount, decimals))
			const tokenPrice = new Decimal(pricePerToken)
			const tokenAmountValue = tokenAmount.times(tokenPrice)
			inputUsdValue = inputUsdValue.plus(tokenAmountValue)
		}

		return {
			outputUsdValue: outputUsdValue,
			inputUsdValue: inputUsdValue,
		}
	}

	/**
	 * Gets the filler's token balances and their total USD value on a specific chain.
	 * Includes native token, DAI, USDT, and USDC balances.
	 *
	 * @param chain - The chain identifier to get balances for
	 * @returns An object containing individual token balances and total USD value
	 */
	async getFillerBalanceUSD(chain: string): Promise<{
		nativeTokenBalance: bigint
		daiBalance: bigint
		usdtBalance: bigint
		usdcBalance: bigint
		totalBalanceUsd: Decimal
	}> {
		const fillerWalletAddress = privateKeyToAddress(this.privateKey)
		const destClient = this.clientManager.getPublicClient(chain)
		const chainId = destClient.chain?.id!

		const nativeTokenBalance = await destClient.getBalance({ address: fillerWalletAddress })
		const nativeToken = destClient.chain?.nativeCurrency
		if (!nativeToken?.symbol || !nativeToken?.decimals) {
			throw new Error("Chain native currency information not available")
		}

		const nativeTokenPriceUsd = await fetchPrice(
			nativeToken.symbol,
			chainId,
			this.configService.getCoinGeckoApiKey(),
		)

		// Use Decimal for precise calculations
		const nativeTokenAmount = new Decimal(formatUnits(nativeTokenBalance, nativeToken.decimals))
		const nativeTokenPrice = new Decimal(nativeTokenPriceUsd)
		const nativeTokenUsdValue = nativeTokenAmount.times(nativeTokenPrice)

		// DAI Balance
		const daiAddress = this.configService.getDaiAsset(chain)
		const daiBalance = await destClient.readContract({
			abi: ERC20_ABI,
			address: daiAddress,
			functionName: "balanceOf",
			args: [fillerWalletAddress],
		})
		const daiDecimals = await this.getTokenDecimals(daiAddress, chain)
		const daiAmount = new Decimal(formatUnits(daiBalance, daiDecimals))
		const daiBalanceUsd = daiAmount // DAI ≈ $1

		// USDT Balance
		const usdtAddress = this.configService.getUsdtAsset(chain)
		const usdtBalance = await destClient.readContract({
			abi: ERC20_ABI,
			address: usdtAddress,
			functionName: "balanceOf",
			args: [fillerWalletAddress],
		})
		const usdtDecimals = await this.getTokenDecimals(usdtAddress, chain)
		const usdtAmount = new Decimal(formatUnits(usdtBalance, usdtDecimals))
		const usdtBalanceUsd = usdtAmount // USDT ≈ $1

		// USDC Balance
		const usdcAddress = this.configService.getUsdcAsset(chain)
		const usdcBalance = await destClient.readContract({
			abi: ERC20_ABI,
			address: usdcAddress,
			functionName: "balanceOf",
			args: [fillerWalletAddress],
		})
		const usdcDecimals = await this.getTokenDecimals(usdcAddress, chain)
		const usdcAmount = new Decimal(formatUnits(usdcBalance, usdcDecimals))
		const usdcBalanceUsd = usdcAmount // USDC ≈ $1

		const totalBalanceUsd = nativeTokenUsdValue.plus(daiBalanceUsd).plus(usdtBalanceUsd).plus(usdcBalanceUsd)

		return {
			nativeTokenBalance,
			daiBalance,
			usdtBalance,
			usdcBalance,
			totalBalanceUsd,
		}
	}

	async getV2QuoteWithAmountOut(
		tokenIn: HexString,
		tokenOut: HexString,
		amountOut: bigint,
		destChain: string,
	): Promise<bigint> {
		try {
			const v2Router = this.configService.getUniswapRouterV2Address(destChain)
			const v2Factory = this.configService.getUniswapV2FactoryAddress(destChain)
			const destClient = this.clientManager.getPublicClient(destChain)

			// For V2/V3, convert native addresses to WETH for quotes
			const wethAsset = this.configService.getWrappedNativeAssetWithDecimals(destChain).asset
			const tokenInForQuote = tokenIn === ADDRESS_ZERO ? wethAsset : tokenIn
			const tokenOutForQuote = tokenOut === ADDRESS_ZERO ? wethAsset : tokenOut

			const v2AmountIn = (await destClient.readContract({
				address: v2Router,
				abi: UNISWAP_ROUTER_V2_ABI,
				functionName: "getAmountsIn",
				args: [amountOut, [tokenInForQuote, tokenOutForQuote]],
			})) as bigint[]

			return v2AmountIn[0]
		} catch (error) {
			this.logger.warn({ err: error }, "V2 quote failed")
			return maxUint256
		}
	}

	async getV3QuoteWithAmountOut(
		tokenIn: HexString,
		tokenOut: HexString,
		amountOut: bigint,
		destChain: string,
	): Promise<{ amountIn: bigint; fee: number }> {
		const commonFees = [100, 500, 3000, 10000]
		let bestAmountIn = maxUint256
		let bestFee = 0

		const v3Factory = this.configService.getUniswapV3FactoryAddress(destChain)
		const v3Quoter = this.configService.getUniswapV3QuoterAddress(destChain)
		const destClient = this.clientManager.getPublicClient(destChain)

		// For V2/V3, convert native addresses to WETH for quotes
		const wethAsset = this.configService.getWrappedNativeAssetWithDecimals(destChain).asset
		const tokenInForQuote = tokenIn === ADDRESS_ZERO ? wethAsset : tokenIn
		const tokenOutForQuote = tokenOut === ADDRESS_ZERO ? wethAsset : tokenOut

		for (const fee of commonFees) {
			try {
				const pool = await destClient.readContract({
					address: v3Factory,
					abi: UNISWAP_V3_FACTORY_ABI,
					functionName: "getPool",
					args: [tokenInForQuote, tokenOutForQuote, fee],
				})

				if (pool !== ADDRESS_ZERO) {
					const liquidity = await destClient.readContract({
						address: pool,
						abi: UNISWAP_V3_POOL_ABI,
						functionName: "liquidity",
					})

					if (liquidity > BigInt(0)) {
						// Use simulateContract for V3 quoter (handles revert-based returns)
						const quoteResult = (
							await destClient.simulateContract({
								address: v3Quoter,
								abi: UNISWAP_V3_QUOTER_V2_ABI,
								functionName: "quoteExactOutputSingle",
								args: [
									{
										tokenIn: tokenInForQuote,
										tokenOut: tokenOutForQuote,
										fee: fee,
										amount: amountOut,
										sqrtPriceLimitX96: BigInt(0),
									},
								],
							})
						).result as [bigint, bigint, number, bigint] // [amountIn, sqrtPriceX96After, initializedTicksCrossed, gasEstimate]

						const amountIn = quoteResult[0]

						if (amountIn < bestAmountIn) {
							bestAmountIn = amountIn
							bestFee = fee
						}
					}
				}
			} catch (error) {
				this.logger.warn({ fee }, "V3 quote failed; continuing")
			}
		}

		return { amountIn: bestAmountIn, fee: bestFee }
	}

	async getV4QuoteWithAmountOut(
		tokenIn: HexString,
		tokenOut: HexString,
		amountOut: bigint,
		destChain: string,
	): Promise<{ amountIn: bigint; fee: number }> {
		const commonFees = [100, 500, 3000, 10000]
		let bestAmountIn = maxUint256
		let bestFee = 0

		const v4Quoter = this.configService.getUniswapV4QuoterAddress(destChain)
		const destClient = this.clientManager.getPublicClient(destChain)

		for (const fee of commonFees) {
			try {
				const currency0 = tokenIn.toLowerCase() < tokenOut.toLowerCase() ? tokenIn : tokenOut
				const currency1 = tokenIn.toLowerCase() < tokenOut.toLowerCase() ? tokenOut : tokenIn

				const zeroForOne = tokenIn.toLowerCase() === currency0.toLowerCase()

				const poolKey = {
					currency0: currency0,
					currency1: currency1,
					fee: fee,
					tickSpacing: this.getTickSpacing(fee),
					hooks: ADDRESS_ZERO, // No hooks
				}

				const quoteResult = (
					await destClient.simulateContract({
						address: v4Quoter,
						abi: UNISWAP_V4_QUOTER_ABI,
						functionName: "quoteExactOutputSingle",
						args: [
							{
								poolKey: poolKey,
								zeroForOne: zeroForOne,
								exactAmount: amountOut,
								hookData: "0x", // Empty hook data
							},
						],
					})
				).result as [bigint, bigint] // [amountIn, gasEstimate]

				const amountIn = quoteResult[0]

				if (amountIn < bestAmountIn) {
					this.logger.debug({ amountIn: amountIn.toString(), fee }, "Found a better V4 quote")
					bestAmountIn = amountIn
					bestFee = fee
				}
			} catch (error) {
				this.logger.warn({ fee }, "V4 quote failed; continuing")
			}
		}

		return { amountIn: bestAmountIn, fee: bestFee }
	}

	createV2SwapCalldata(
		sourceTokenAddress: HexString,
		targetTokenAddress: HexString,
		amountOut: bigint,
		amountInMax: bigint,
		recipient: HexString,
		assets: TokenAssets,
	): { commands: HexString; inputs: HexString[] } {
		const V2_SWAP_EXACT_OUT = 0x09
		const isPermit2 = false

		const swapSourceAddress = sourceTokenAddress === ADDRESS_ZERO ? assets.wethAsset : sourceTokenAddress
		const swapTargetAddress = targetTokenAddress === ADDRESS_ZERO ? assets.wethAsset : targetTokenAddress

		const path = [swapSourceAddress, swapTargetAddress]
		const commands = encodePacked(["uint8"], [V2_SWAP_EXACT_OUT])
		const inputs = [
			encodeAbiParameters(
				parseAbiParameters(
					"address recipient, uint256 amountOut, uint256 amountInMax, address[] path, bool isPermit2",
				),
				[recipient, amountOut, amountInMax, path, isPermit2],
			),
		]

		return { commands, inputs }
	}

	createV3SwapCalldata(
		sourceTokenAddress: HexString,
		targetTokenAddress: HexString,
		amountOut: bigint,
		amountInMax: bigint,
		fee: number,
		recipient: HexString,
		assets: TokenAssets,
	): { commands: HexString; inputs: HexString[] } {
		const V3_SWAP_EXACT_OUT = 0x01
		const isPermit2 = false

		const swapSourceAddress = sourceTokenAddress === ADDRESS_ZERO ? assets.wethAsset : sourceTokenAddress
		const swapTargetAddress = targetTokenAddress === ADDRESS_ZERO ? assets.wethAsset : targetTokenAddress

		const pathV3 = encodePacked(["address", "uint24", "address"], [swapTargetAddress, fee, swapSourceAddress])
		const commands = encodePacked(["uint8"], [V3_SWAP_EXACT_OUT])
		const inputs = [
			encodeAbiParameters(
				parseAbiParameters(
					"address recipient, uint256 amountOut, uint256 amountInMax, bytes path, bool isPermit2",
				),
				[recipient, amountOut, amountInMax, pathV3, isPermit2],
			),
		]

		return { commands, inputs }
	}

	createV4SwapCalldata(
		sourceTokenAddress: HexString,
		targetTokenAddress: HexString,
		amountOut: bigint,
		amountInMax: bigint,
		fee: number,
	): { commands: HexString; inputs: HexString[] } {
		const V4_SWAP = 0x10

		const currency0 =
			sourceTokenAddress.toLowerCase() < targetTokenAddress.toLowerCase()
				? sourceTokenAddress
				: targetTokenAddress
		const currency1 =
			sourceTokenAddress.toLowerCase() < targetTokenAddress.toLowerCase()
				? targetTokenAddress
				: sourceTokenAddress

		const zeroForOne = sourceTokenAddress.toLowerCase() === currency0.toLowerCase()

		const poolKey = {
			currency0: currency0,
			currency1: currency1,
			fee: fee,
			tickSpacing: this.getTickSpacing(fee),
			hooks: ADDRESS_ZERO,
		}

		const SWAP_EXACT_OUT_SINGLE = 0x08
		const SETTLE_ALL = 0x0c
		const TAKE_ALL = 0x0f

		const actions = encodePacked(["uint8", "uint8", "uint8"], [SWAP_EXACT_OUT_SINGLE, SETTLE_ALL, TAKE_ALL])

		const swapParams = encodeAbiParameters(
			parseAbiParameters(
				"((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountOut, uint128 amountInMaximum, bytes hookData)",
			),
			[
				{
					poolKey,
					zeroForOne,
					amountOut,
					amountInMaximum: amountInMax,
					hookData: "0x",
				},
			],
		)

		const settleParams = encodeAbiParameters(parseAbiParameters("address currency, uint128 amount"), [
			sourceTokenAddress,
			amountInMax,
		])

		const takeParams = encodeAbiParameters(parseAbiParameters("address currency, uint128 amount"), [
			targetTokenAddress,
			amountOut,
		])

		const params = [swapParams, settleParams, takeParams]

		const commands = encodePacked(["uint8"], [V4_SWAP])
		const inputs = [encodeAbiParameters(parseAbiParameters("bytes actions, bytes[] params"), [actions, params])]

		return { commands, inputs }
	}

	getTickSpacing(fee: number): number {
		switch (fee) {
			case 100: // 0.01%
				return 1
			case 500: // 0.05%
				return 10
			case 3000: // 0.30%
				return 60
			case 10000: // 1.00%
				return 200
			default:
				return 60 // Default to medium
		}
	}
}

export interface TokenBalances {
	dai: bigint
	usdt: bigint
	usdc: bigint
	native: bigint
}

export interface TokenAssets {
	daiAsset: HexString
	usdtAsset: HexString
	usdcAsset: HexString
	wethAsset: HexString
}

export interface TokenDecimals {
	daiDecimals: number
	usdtDecimals: number
	usdcDecimals: number
}

export interface SwapContext {
	contractService: ContractInteractionService
	fillerWalletAddress: HexString
	destClient: PublicClient
	destChain: string
	assets: TokenAssets
	decimals: TokenDecimals
	initialBalances: TokenBalances
	universalRouterAddress: HexString
}

export interface SwapContextWithRequirements extends SwapContext {
	remainingBalances: TokenBalances
	shortfalls: TokenBalances
}

export interface BestProtocol {
	protocol: "v2" | "v3" | "v4" | null
	amountIn: bigint
	fee?: number
}

export type TokenType = keyof TokenBalances
