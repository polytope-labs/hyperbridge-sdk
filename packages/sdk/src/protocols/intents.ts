import {
	bytes32ToBytes20,
	bytes20ToBytes32,
	constructRedeemEscrowRequestBody,
	getStorageSlot,
	ADDRESS_ZERO,
	MOCK_ADDRESS,
	ERC20Method,
	adjustFeeDecimals,
	fetchPrice,
	parseStateMachineId,
	orderCommitment,
	sleep,
	getRequestCommitment,
	waitForChallengePeriod,
	retryPromise,
} from "@/utils"
import {
	encodeFunctionData,
	formatUnits,
	hexToString,
	maxUint256,
	pad,
	parseUnits,
	toHex,
	encodePacked,
	encodeAbiParameters,
	parseAbiParameters,
} from "viem"
import {
	DispatchPost,
	IGetRequest,
	IHyperbridgeConfig,
	RequestStatus,
	type FillOptions,
	type HexString,
	type IPostRequest,
	type Order,
	type Transaction,
} from "@/types"
import IntentGatewayABI from "@/abis/IntentGateway"
import UniswapRouterV2 from "@/abis/uniswapRouterV2"
import UniswapV3Quoter from "@/abis/uniswapV3Quoter"
import { UNISWAP_V4_QUOTER_ABI } from "@/abis/uniswapV4Quoter"
import type { EvmChain } from "@/chains/evm"
import { Decimal } from "decimal.js"
import { getChain, IGetRequestMessage, IProof, requestCommitmentKey, SubstrateChain } from "@/chain"
import { IndexerClient } from "@/client"

/**
 * IntentGateway handles cross-chain intent operations between EVM chains.
 * It provides functionality for estimating fill orders, finding optimal swap protocols,
 * and checking order statuses across different chains.
 */
export class IntentGateway {
	/**
	 * Creates a new IntentGateway instance for cross-chain operations.
	 * @param source - The source EVM chain
	 * @param dest - The destination EVM chain
	 */
	constructor(
		public readonly source: EvmChain,
		public readonly dest: EvmChain,
	) {}

	/**
	 * Estimates the total cost required to fill an order, including gas fees, relayer fees,
	 * protocol fees, and swap operations.
	 *
	 * @param order - The order to estimate fill costs for
	 * @returns An object containing the estimated cost in both fee token and native token, plus the post request calldata
	 */
	async estimateFillOrder(
		order: Order,
	): Promise<{ feeTokenAmount: bigint; nativeTokenAmount: bigint; postRequestCalldata: HexString }> {
		const postRequest: IPostRequest = {
			source: order.destChain,
			dest: order.sourceChain,
			body: constructRedeemEscrowRequestBody(order, MOCK_ADDRESS),
			timeoutTimestamp: 0n,
			nonce: await this.source.getHostNonce(),
			from: this.source.config.getIntentGatewayAddress(order.destChain),
			to: this.source.config.getIntentGatewayAddress(order.sourceChain),
		}

		const { decimals: sourceChainFeeTokenDecimals } = await this.source.getFeeTokenWithDecimals()

		const { address: destChainFeeTokenAddress, decimals: destChainFeeTokenDecimals } =
			await this.dest.getFeeTokenWithDecimals()

		const { gas: postGasEstimate, postRequestCalldata } = await this.source.estimateGas(postRequest)

		const postGasEstimateInSourceFeeToken = await this.convertGasToFeeToken(
			postGasEstimate,
			"source",
			order.sourceChain,
		)

		const relayerFeeInSourceFeeToken =
			postGasEstimateInSourceFeeToken + 25n * 10n ** BigInt(sourceChainFeeTokenDecimals - 2)

		const relayerFeeInDestFeeToken = adjustFeeDecimals(
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

		const intentGatewayAddress = this.source.config.getIntentGatewayAddress(order.destChain)
		const testValue = toHex(maxUint256 / 2n)

		const orderOverrides = await Promise.all(
			order.outputs.map(async (output) => {
				const tokenAddress = bytes32ToBytes20(output.token)

				if (tokenAddress === ADDRESS_ZERO) {
					return null
				}

				try {
					const stateDiffs = []

					const balanceData = ERC20Method.BALANCE_OF + bytes20ToBytes32(MOCK_ADDRESS).slice(2)
					const balanceSlot = await getStorageSlot(this.dest.client, tokenAddress, balanceData as HexString)
					stateDiffs.push({ slot: balanceSlot as HexString, value: testValue })

					try {
						const allowanceData =
							ERC20Method.ALLOWANCE +
							bytes20ToBytes32(MOCK_ADDRESS).slice(2) +
							bytes20ToBytes32(intentGatewayAddress).slice(2)
						const allowanceSlot = await getStorageSlot(
							this.dest.client,
							tokenAddress,
							allowanceData as HexString,
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

		const stateOverrides = [
			// Mock address with ETH balance so that any chain estimation runs
			// even when the address doesn't hold any native token in that chain
			{
				address: MOCK_ADDRESS,
				balance: maxUint256,
			},
			...orderOverrides.map((override) => ({
				address: override!.address,
				stateDiff: override!.stateDiff,
			})),
		]

		let destChainFillGas = 0n
		try {
			let protocolFeeInNativeToken = await this.quoteNative(postRequest, relayerFeeInDestFeeToken).catch(() =>
				this.dest.quoteNative(postRequest, relayerFeeInDestFeeToken).catch(() => 0n),
			)
			protocolFeeInNativeToken = protocolFeeInNativeToken + (protocolFeeInNativeToken * 50n) / 10000n

			destChainFillGas = await this.dest.client.estimateContractGas({
				abi: IntentGatewayABI.ABI,
				address: intentGatewayAddress,
				functionName: "fillOrder",
				args: [transformOrderForContract(order), fillOptions as any],
				account: MOCK_ADDRESS,
				value: totalEthValue + protocolFeeInNativeToken,
				stateOverride: stateOverrides as any,
			})
		} catch {
			console.warn(
				`Could not estimate gas for fill order with native token as fees for chain ${order.destChain}, now trying with fee token as fees`,
			)

			const destFeeTokenBalanceData = ERC20Method.BALANCE_OF + bytes20ToBytes32(MOCK_ADDRESS).slice(2)
			const destFeeTokenBalanceSlot = await getStorageSlot(
				this.dest.client,
				destChainFeeTokenAddress,
				destFeeTokenBalanceData as HexString,
			)
			const destFeeTokenAllowanceData =
				ERC20Method.ALLOWANCE +
				bytes20ToBytes32(MOCK_ADDRESS).slice(2) +
				bytes20ToBytes32(intentGatewayAddress).slice(2)
			const destFeeTokenAllowanceSlot = await getStorageSlot(
				this.dest.client,
				destChainFeeTokenAddress,
				destFeeTokenAllowanceData as HexString,
			)
			const feeTokenStateDiffs = [
				{ slot: destFeeTokenBalanceSlot, value: testValue },
				{ slot: destFeeTokenAllowanceSlot, value: testValue },
			]

			stateOverrides.push({
				address: destChainFeeTokenAddress,
				stateDiff: feeTokenStateDiffs as any,
			})

			destChainFillGas = await this.dest.client.estimateContractGas({
				abi: IntentGatewayABI.ABI,
				address: intentGatewayAddress,
				functionName: "fillOrder",
				args: [transformOrderForContract(order), fillOptions as any],
				account: MOCK_ADDRESS,
				value: totalEthValue,
				stateOverride: stateOverrides as any,
			})
		}

		const fillGasInDestFeeToken = await this.convertGasToFeeToken(destChainFillGas, "dest", order.destChain)
		const fillGasInSourceFeeToken = adjustFeeDecimals(
			fillGasInDestFeeToken,
			destChainFeeTokenDecimals,
			sourceChainFeeTokenDecimals,
		)

		const protocolFeeInSourceFeeToken = adjustFeeDecimals(
			await this.dest.quote(postRequest),
			destChainFeeTokenDecimals,
			sourceChainFeeTokenDecimals,
		)

		let totalEstimateInSourceFeeToken =
			fillGasInSourceFeeToken + protocolFeeInSourceFeeToken + relayerFeeInSourceFeeToken

		let totalNativeTokenAmount = await this.convertFeeTokenToNative(
			totalEstimateInSourceFeeToken,
			"source",
			order.sourceChain,
		)

		if ([order.destChain, order.sourceChain].includes("EVM-1")) {
			totalEstimateInSourceFeeToken =
				totalEstimateInSourceFeeToken + (totalEstimateInSourceFeeToken * 3000n) / 10000n
			totalNativeTokenAmount = totalNativeTokenAmount + (totalNativeTokenAmount * 3200n) / 10000n
		} else {
			totalEstimateInSourceFeeToken =
				totalEstimateInSourceFeeToken + (totalEstimateInSourceFeeToken * 250n) / 10000n
			totalNativeTokenAmount = totalNativeTokenAmount + (totalNativeTokenAmount * 350n) / 10000n
		}
		return {
			feeTokenAmount: totalEstimateInSourceFeeToken,
			nativeTokenAmount: totalNativeTokenAmount,
			postRequestCalldata,
		}
	}

	/**
	 * Converts fee token amounts back to the equivalent amount in native token.
	 * Uses USD pricing to convert between fee token amounts and native token costs.
	 *
	 * @param feeTokenAmount - The amount in fee token (DAI)
	 * @param getQuoteIn - Whether to use "source" or "dest" chain for the conversion
	 * @param evmChainID - The EVM chain ID in format "EVM-{id}"
	 * @returns The fee token amount converted to native token amount
	 * @private
	 */
	private async convertFeeTokenToNative(
		feeTokenAmount: bigint,
		getQuoteIn: "source" | "dest",
		evmChainID: string,
	): Promise<bigint> {
		const client = this[getQuoteIn].client
		const wethAsset = this[getQuoteIn].config.getWrappedNativeAssetWithDecimals(evmChainID).asset
		const feeToken = await this[getQuoteIn].getFeeTokenWithDecimals()

		try {
			const { amountOut } = await this.findBestProtocolWithAmountIn(
				getQuoteIn,
				feeToken.address,
				wethAsset,
				feeTokenAmount,
				evmChainID,
				{ selectedProtocol: "v2" },
			)

			if (amountOut === 0n) {
				throw new Error()
			}
			return amountOut
		} catch {
			// Testnet block
			const nativeCurrency = client.chain?.nativeCurrency
			const chainId = Number.parseInt(evmChainID.split("-")[1])
			const feeTokenAmountDecimal = new Decimal(formatUnits(feeTokenAmount, feeToken.decimals))
			const nativeTokenPriceUsd = new Decimal(await fetchPrice(nativeCurrency?.symbol!, chainId))
			const totalCostInNativeToken = feeTokenAmountDecimal.dividedBy(nativeTokenPriceUsd)
			return parseUnits(totalCostInNativeToken.toFixed(nativeCurrency?.decimals!), nativeCurrency?.decimals!)
		}
	}

	/**
	 * Converts gas costs to the equivalent amount in the fee token (DAI).
	 * Uses USD pricing to convert between native token gas costs and fee token amounts.
	 *
	 * @param gasEstimate - The estimated gas units
	 * @param gasEstimateIn - Whether to use "source" or "dest" chain for the conversion
	 * @param evmChainID - The EVM chain ID in format "EVM-{id}"
	 * @returns The gas cost converted to fee token amount
	 * @private
	 */
	private async convertGasToFeeToken(
		gasEstimate: bigint,
		gasEstimateIn: "source" | "dest",
		evmChainID: string,
	): Promise<bigint> {
		const client = this[gasEstimateIn].client
		const gasPrice = await client.getGasPrice()
		const gasCostInWei = gasEstimate * gasPrice
		const wethAddr = this[gasEstimateIn].config.getWrappedNativeAssetWithDecimals(evmChainID).asset
		const feeToken = await this[gasEstimateIn].getFeeTokenWithDecimals()

		try {
			const { amountOut } = await this.findBestProtocolWithAmountIn(
				gasEstimateIn,
				wethAddr,
				feeToken.address,
				gasCostInWei,
				evmChainID,
				{ selectedProtocol: "v2" },
			)
			if (amountOut === 0n) {
				console.log("Amount out not found")
				throw new Error()
			}
			return amountOut
		} catch {
			// Testnet block
			const nativeCurrency = client.chain?.nativeCurrency
			const chainId = Number.parseInt(evmChainID.split("-")[1])
			const gasCostInToken = new Decimal(formatUnits(gasCostInWei, nativeCurrency?.decimals!))
			const tokenPriceUsd = await fetchPrice(nativeCurrency?.symbol!, chainId)
			const gasCostUsd = gasCostInToken.times(tokenPriceUsd)
			const feeTokenPriceUsd = new Decimal(1) // stable coin
			const gasCostInFeeToken = gasCostUsd.dividedBy(feeTokenPriceUsd)
			return parseUnits(gasCostInFeeToken.toFixed(feeToken.decimals), feeToken.decimals)
		}
	}

	/**
	 * Gets a quote for the native token cost of dispatching a post request.
	 *
	 * @param postRequest - The post request to quote
	 * @param fee - The fee amount in fee token
	 * @returns The native token amount required
	 */
	async quoteNative(postRequest: IPostRequest, fee: bigint): Promise<bigint> {
		const dispatchPost: DispatchPost = {
			dest: toHex(postRequest.dest),
			to: postRequest.to,
			body: postRequest.body,
			timeout: postRequest.timeoutTimestamp,
			fee: fee,
			payer: postRequest.from,
		}

		const quoteNative = await this.dest.client.readContract({
			address: this.dest.config.getIntentGatewayAddress(postRequest.dest),
			abi: IntentGatewayABI.ABI,
			functionName: "quoteNative",
			args: [dispatchPost] as any,
		})

		return quoteNative
	}

	/**
	 * Gets V2 quote for exact output swap.
	 * @private
	 */
	private async getV2QuoteWithAmountOut(
		getQuoteIn: "source" | "dest",
		tokenIn: HexString,
		tokenOut: HexString,
		amountOut: bigint,
		evmChainID: string,
	): Promise<bigint> {
		const client = this[getQuoteIn].client
		const v2Router = this[getQuoteIn].config.getUniswapRouterV2Address(evmChainID)

		const wethAsset = this[getQuoteIn].config.getWrappedNativeAssetWithDecimals(evmChainID).asset
		const tokenInForQuote = tokenIn === ADDRESS_ZERO ? wethAsset : tokenIn
		const tokenOutForQuote = tokenOut === ADDRESS_ZERO ? wethAsset : tokenOut

		try {
			const v2AmountIn = await client.simulateContract({
				address: v2Router,
				abi: UniswapRouterV2.ABI,
				// @ts-ignore
				functionName: "getAmountsIn",
				// @ts-ignore
				args: [amountOut, [tokenInForQuote, tokenOutForQuote]],
			})

			return v2AmountIn.result[0]
		} catch (error) {
			console.warn("V2 quote failed:", error)
			return maxUint256
		}
	}

	/**
	 * Gets V2 quote for exact input swap.
	 * @private
	 */
	private async getV2QuoteWithAmountIn(
		getQuoteIn: "source" | "dest",
		tokenIn: HexString,
		tokenOut: HexString,
		amountIn: bigint,
		evmChainID: string,
	): Promise<bigint> {
		const client = this[getQuoteIn].client
		const v2Router = this[getQuoteIn].config.getUniswapRouterV2Address(evmChainID)

		const wethAsset = this[getQuoteIn].config.getWrappedNativeAssetWithDecimals(evmChainID).asset
		const tokenInForQuote = tokenIn === ADDRESS_ZERO ? wethAsset : tokenIn
		const tokenOutForQuote = tokenOut === ADDRESS_ZERO ? wethAsset : tokenOut

		try {
			const v2AmountOut = await client.simulateContract({
				address: v2Router,
				abi: UniswapRouterV2.ABI,
				// @ts-ignore
				functionName: "getAmountsOut",
				// @ts-ignore
				args: [amountIn, [tokenInForQuote, tokenOutForQuote]],
			})

			return v2AmountOut.result[1]
		} catch (error) {
			console.warn("V2 quote failed:", error)
			return BigInt(0)
		}
	}

	/**
	 * Gets V3 quote for exact output swap.
	 * @private
	 */
	private async getV3QuoteWithAmountOut(
		getQuoteIn: "source" | "dest",
		tokenIn: HexString,
		tokenOut: HexString,
		amountOut: bigint,
		evmChainID: string,
	): Promise<{ amountIn: bigint; fee: number }> {
		const client = this[getQuoteIn].client
		const commonFees = [100, 500, 3000, 10000]
		let bestAmountIn = maxUint256
		let bestFee = 0

		const v3Quoter = this[getQuoteIn].config.getUniswapV3QuoterAddress(evmChainID)

		const wethAsset = this[getQuoteIn].config.getWrappedNativeAssetWithDecimals(evmChainID).asset
		const tokenInForQuote = tokenIn === ADDRESS_ZERO ? wethAsset : tokenIn
		const tokenOutForQuote = tokenOut === ADDRESS_ZERO ? wethAsset : tokenOut

		for (const fee of commonFees) {
			try {
				const quoteResult = (
					await client.simulateContract({
						address: v3Quoter,
						abi: UniswapV3Quoter.ABI,
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
				).result as [bigint, bigint, number, bigint]

				const amountIn = quoteResult[0]

				if (amountIn < bestAmountIn) {
					bestAmountIn = amountIn
					bestFee = fee
				}
			} catch (error) {
				console.warn(`V3 quote failed for fee ${fee}, continuing to next fee tier`)
			}
		}

		return { amountIn: bestAmountIn, fee: bestFee }
	}

	/**
	 * Gets V3 quote for exact input swap.
	 * @private
	 */
	private async getV3QuoteWithAmountIn(
		getQuoteIn: "source" | "dest",
		tokenIn: HexString,
		tokenOut: HexString,
		amountIn: bigint,
		evmChainID: string,
	): Promise<{ amountOut: bigint; fee: number }> {
		const client = this[getQuoteIn].client
		const commonFees = [100, 500, 3000, 10000]
		let bestAmountOut = BigInt(0)
		let bestFee = 0

		const v3Quoter = this[getQuoteIn].config.getUniswapV3QuoterAddress(evmChainID)

		const wethAsset = this[getQuoteIn].config.getWrappedNativeAssetWithDecimals(evmChainID).asset
		const tokenInForQuote = tokenIn === ADDRESS_ZERO ? wethAsset : tokenIn
		const tokenOutForQuote = tokenOut === ADDRESS_ZERO ? wethAsset : tokenOut

		for (const fee of commonFees) {
			try {
				const quoteResult = (
					await client.simulateContract({
						address: v3Quoter,
						abi: UniswapV3Quoter.ABI,
						functionName: "quoteExactInputSingle",
						args: [
							{
								tokenIn: tokenInForQuote,
								tokenOut: tokenOutForQuote,
								fee: fee,
								amountIn: amountIn,
								sqrtPriceLimitX96: BigInt(0),
							},
						],
					})
				).result as [bigint, bigint, number, bigint]

				const amountOut = quoteResult[0]

				if (amountOut > bestAmountOut) {
					bestAmountOut = amountOut
					bestFee = fee
				}
			} catch (error) {
				console.warn(`V3 quote failed for fee ${fee}, continuing to next fee tier`)
			}
		}

		return { amountOut: bestAmountOut, fee: bestFee }
	}

	/**
	 * Gets V4 quote for exact output swap.
	 * @private
	 */
	private async getV4QuoteWithAmountOut(
		getQuoteIn: "source" | "dest",
		tokenIn: HexString,
		tokenOut: HexString,
		amountOut: bigint,
		evmChainID: string,
	): Promise<{ amountIn: bigint; fee: number }> {
		const client = this[getQuoteIn].client
		const commonFees = [100, 500, 3000, 10000]
		let bestAmountIn = maxUint256
		let bestFee = 0

		const v4Quoter = this[getQuoteIn].config.getUniswapV4QuoterAddress(evmChainID)

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
					hooks: ADDRESS_ZERO,
				}

				const quoteResult = (
					await client.simulateContract({
						address: v4Quoter,
						abi: UNISWAP_V4_QUOTER_ABI,
						functionName: "quoteExactOutputSingle",
						args: [
							{
								poolKey: poolKey,
								zeroForOne: zeroForOne,
								exactAmount: amountOut,
								hookData: "0x",
							},
						],
					})
				).result as [bigint, bigint]

				const amountIn = quoteResult[0]

				if (amountIn < bestAmountIn) {
					bestAmountIn = amountIn
					bestFee = fee
				}
			} catch (error) {
				console.warn(`V4 quote failed for fee ${fee}, continuing to next fee tier`)
			}
		}

		return { amountIn: bestAmountIn, fee: bestFee }
	}

	/**
	 * Gets V4 quote for exact input swap.
	 * @private
	 */
	private async getV4QuoteWithAmountIn(
		getQuoteIn: "source" | "dest",
		tokenIn: HexString,
		tokenOut: HexString,
		amountIn: bigint,
		evmChainID: string,
	): Promise<{ amountOut: bigint; fee: number }> {
		const client = this[getQuoteIn].client
		const commonFees = [100, 500, 3000, 10000]
		let bestAmountOut = BigInt(0)
		let bestFee = 0

		const v4Quoter = this[getQuoteIn].config.getUniswapV4QuoterAddress(evmChainID)

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
					hooks: ADDRESS_ZERO,
				}

				const quoteResult = (
					await client.simulateContract({
						address: v4Quoter,
						abi: UNISWAP_V4_QUOTER_ABI,
						functionName: "quoteExactInputSingle",
						args: [
							{
								poolKey: poolKey,
								zeroForOne: zeroForOne,
								exactAmount: amountIn,
								hookData: "0x",
							},
						],
					})
				).result as [bigint, bigint]

				const amountOut = quoteResult[0]

				if (amountOut > bestAmountOut) {
					bestAmountOut = amountOut
					bestFee = fee
				}
			} catch (error) {
				console.warn(`V4 quote failed for fee ${fee}, continuing to next fee tier`)
			}
		}

		return { amountOut: bestAmountOut, fee: bestFee }
	}

	/**
	 * Creates transaction structure for V2 exact input swap.
	 * @private
	 */
	private createV2SwapCalldataExactIn(
		sourceTokenAddress: HexString,
		targetTokenAddress: HexString,
		amountIn: bigint,
		amountOutMinimum: bigint,
		recipient: HexString,
		evmChainID: string,
		getQuoteIn: "source" | "dest",
	): Transaction {
		const V2_SWAP_EXACT_IN = 0x08
		const isPermit2 = false

		const wethAsset = this[getQuoteIn].config.getWrappedNativeAssetWithDecimals(evmChainID).asset
		const swapSourceAddress = sourceTokenAddress === ADDRESS_ZERO ? wethAsset : sourceTokenAddress
		const swapTargetAddress = targetTokenAddress === ADDRESS_ZERO ? wethAsset : targetTokenAddress

		const path = [swapSourceAddress, swapTargetAddress]
		const commands = encodePacked(["uint8"], [V2_SWAP_EXACT_IN])
		const inputs = [
			encodeAbiParameters(
				parseAbiParameters(
					"address recipient, uint256 amountIn, uint256 amountOutMinimum, address[] path, bool isPermit2",
				),
				[recipient, amountIn, amountOutMinimum, path, isPermit2],
			),
		]

		const data = encodeFunctionData({
			abi: [
				{
					name: "execute",
					type: "function",
					stateMutability: "payable",
					inputs: [
						{ name: "commands", type: "bytes" },
						{ name: "inputs", type: "bytes[]" },
					],
					outputs: [],
				},
			],
			functionName: "execute",
			args: [commands, inputs],
		})

		return {
			to: this[getQuoteIn].config.getUniversalRouterAddress(evmChainID),
			value: sourceTokenAddress === ADDRESS_ZERO ? amountIn : 0n,
			data,
		}
	}

	/**
	 * Creates transaction structure for V2 exact output swap.
	 * @private
	 */
	private createV2SwapCalldataExactOut(
		sourceTokenAddress: HexString,
		targetTokenAddress: HexString,
		amountOut: bigint,
		amountInMax: bigint,
		recipient: HexString,
		evmChainID: string,
		getQuoteIn: "source" | "dest",
	): Transaction {
		const V2_SWAP_EXACT_OUT = 0x09
		const isPermit2 = false

		const wethAsset = this[getQuoteIn].config.getWrappedNativeAssetWithDecimals(evmChainID).asset
		const swapSourceAddress = sourceTokenAddress === ADDRESS_ZERO ? wethAsset : sourceTokenAddress
		const swapTargetAddress = targetTokenAddress === ADDRESS_ZERO ? wethAsset : targetTokenAddress

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

		const data = encodeFunctionData({
			abi: [
				{
					name: "execute",
					type: "function",
					stateMutability: "payable",
					inputs: [
						{ name: "commands", type: "bytes" },
						{ name: "inputs", type: "bytes[]" },
					],
					outputs: [],
				},
			],
			functionName: "execute",
			args: [commands, inputs],
		})

		return {
			to: this[getQuoteIn].config.getUniversalRouterAddress(evmChainID),
			value: sourceTokenAddress === ADDRESS_ZERO ? amountInMax : 0n,
			data,
		}
	}

	/**
	 * Creates transaction structure for V3 exact input swap.
	 * @private
	 */
	private createV3SwapCalldataExactIn(
		sourceTokenAddress: HexString,
		targetTokenAddress: HexString,
		amountIn: bigint,
		amountOutMinimum: bigint,
		fee: number,
		recipient: HexString,
		evmChainID: string,
		getQuoteIn: "source" | "dest",
	): Transaction {
		const V3_SWAP_EXACT_IN = 0x00
		const isPermit2 = false

		const wethAsset = this[getQuoteIn].config.getWrappedNativeAssetWithDecimals(evmChainID).asset
		const swapSourceAddress = sourceTokenAddress === ADDRESS_ZERO ? wethAsset : sourceTokenAddress
		const swapTargetAddress = targetTokenAddress === ADDRESS_ZERO ? wethAsset : targetTokenAddress

		const pathV3 = encodePacked(["address", "uint24", "address"], [swapSourceAddress, fee, swapTargetAddress])
		const commands = encodePacked(["uint8"], [V3_SWAP_EXACT_IN])
		const inputs = [
			encodeAbiParameters(
				parseAbiParameters(
					"address recipient, uint256 amountIn, uint256 amountOutMinimum, bytes path, bool isPermit2",
				),
				[recipient, amountIn, amountOutMinimum, pathV3, isPermit2],
			),
		]

		const data = encodeFunctionData({
			abi: [
				{
					name: "execute",
					type: "function",
					stateMutability: "payable",
					inputs: [
						{ name: "commands", type: "bytes" },
						{ name: "inputs", type: "bytes[]" },
					],
					outputs: [],
				},
			],
			functionName: "execute",
			args: [commands, inputs],
		})

		return {
			to: this[getQuoteIn].config.getUniversalRouterAddress(evmChainID),
			value: sourceTokenAddress === ADDRESS_ZERO ? amountIn : 0n,
			data,
		}
	}

	/**
	 * Creates transaction structure for V3 exact output swap.
	 * @private
	 */
	private createV3SwapCalldataExactOut(
		sourceTokenAddress: HexString,
		targetTokenAddress: HexString,
		amountOut: bigint,
		amountInMax: bigint,
		fee: number,
		recipient: HexString,
		evmChainID: string,
		getQuoteIn: "source" | "dest",
	): Transaction {
		const V3_SWAP_EXACT_OUT = 0x01
		const isPermit2 = false

		const wethAsset = this[getQuoteIn].config.getWrappedNativeAssetWithDecimals(evmChainID).asset
		const swapSourceAddress = sourceTokenAddress === ADDRESS_ZERO ? wethAsset : sourceTokenAddress
		const swapTargetAddress = targetTokenAddress === ADDRESS_ZERO ? wethAsset : targetTokenAddress

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

		const data = encodeFunctionData({
			abi: [
				{
					name: "execute",
					type: "function",
					stateMutability: "payable",
					inputs: [
						{ name: "commands", type: "bytes" },
						{ name: "inputs", type: "bytes[]" },
					],
					outputs: [],
				},
			],
			functionName: "execute",
			args: [commands, inputs],
		})

		return {
			to: this[getQuoteIn].config.getUniversalRouterAddress(evmChainID),
			value: sourceTokenAddress === ADDRESS_ZERO ? amountInMax : 0n,
			data,
		}
	}

	/**
	 * Creates transaction structure for V4 exact input swap.
	 * @private
	 */
	private createV4SwapCalldataExactIn(
		sourceTokenAddress: HexString,
		targetTokenAddress: HexString,
		amountIn: bigint,
		amountOutMinimum: bigint,
		fee: number,
		evmChainID: string,
		getQuoteIn: "source" | "dest",
	): Transaction {
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

		const SWAP_EXACT_IN_SINGLE = 0x06
		const SETTLE_ALL = 0x0c
		const TAKE_ALL = 0x0f

		const actions = encodePacked(["uint8", "uint8", "uint8"], [SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL])

		const swapParams = encodeAbiParameters(
			parseAbiParameters(
				"((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)",
			),
			[
				{
					poolKey,
					zeroForOne,
					amountIn,
					amountOutMinimum,
					hookData: "0x",
				},
			],
		)

		const settleParams = encodeAbiParameters(parseAbiParameters("address currency, uint128 amount"), [
			sourceTokenAddress,
			amountIn,
		])

		const takeParams = encodeAbiParameters(parseAbiParameters("address currency, uint128 amount"), [
			targetTokenAddress,
			amountOutMinimum,
		])

		const params = [swapParams, settleParams, takeParams]

		const commands = encodePacked(["uint8"], [V4_SWAP])
		const inputs = [encodeAbiParameters(parseAbiParameters("bytes actions, bytes[] params"), [actions, params])]

		const data = encodeFunctionData({
			abi: [
				{
					name: "execute",
					type: "function",
					stateMutability: "payable",
					inputs: [
						{ name: "commands", type: "bytes" },
						{ name: "inputs", type: "bytes[]" },
					],
					outputs: [],
				},
			],
			functionName: "execute",
			args: [commands, inputs],
		})

		return {
			to: this[getQuoteIn].config.getUniversalRouterAddress(evmChainID),
			value: sourceTokenAddress === ADDRESS_ZERO ? amountIn : 0n,
			data,
		}
	}

	/**
	 * Creates transaction structure for V4 exact output swap.
	 * @private
	 */
	private createV4SwapCalldataExactOut(
		sourceTokenAddress: HexString,
		targetTokenAddress: HexString,
		amountOut: bigint,
		amountInMax: bigint,
		fee: number,
		evmChainID: string,
		getQuoteIn: "source" | "dest",
	): Transaction {
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

		const data = encodeFunctionData({
			abi: [
				{
					name: "execute",
					type: "function",
					stateMutability: "payable",
					inputs: [
						{ name: "commands", type: "bytes" },
						{ name: "inputs", type: "bytes[]" },
					],
					outputs: [],
				},
			],
			functionName: "execute",
			args: [commands, inputs],
		})

		return {
			to: this[getQuoteIn].config.getUniversalRouterAddress(evmChainID),
			value: sourceTokenAddress === ADDRESS_ZERO ? amountInMax : 0n,
			data,
		}
	}

	/**
	 * Finds the best Uniswap protocol (V2, V3, or V4) for swapping tokens given a desired output amount.
	 * Compares liquidity and pricing across different protocols and fee tiers.
	 *
	 * @param getQuoteIn - Whether to use "source" or "dest" chain for the swap
	 * @param tokenIn - The address of the input token
	 * @param tokenOut - The address of the output token
	 * @param amountOut - The desired output amount
	 * @returns Object containing the best protocol, required input amount, fee tier (for V3/V4), and transaction structure
	 */
	async findBestProtocolWithAmountOut(
		getQuoteIn: "source" | "dest",
		tokenIn: HexString,
		tokenOut: HexString,
		amountOut: bigint,
		evmChainID: string,
		options?: {
			selectedProtocol?: "v2" | "v3" | "v4"
			generateCalldata?: boolean
			recipient?: HexString
		},
	): Promise<{
		protocol: "v2" | "v3" | "v4" | null
		amountIn: bigint
		fee?: number
		transaction?: Transaction
	}> {
		const amountInV2 = await this.getV2QuoteWithAmountOut(getQuoteIn, tokenIn, tokenOut, amountOut, evmChainID)

		if (options?.selectedProtocol === "v2" && amountInV2 !== maxUint256) {
			let transaction: Transaction | undefined
			if (options?.generateCalldata) {
				const recipient = options?.recipient || ADDRESS_ZERO
				transaction = this.createV2SwapCalldataExactOut(
					tokenIn,
					tokenOut,
					amountOut,
					amountInV2,
					recipient,
					evmChainID,
					getQuoteIn,
				)
			}
			return { protocol: "v2", amountIn: amountInV2, transaction }
		}

		const { amountIn: amountInV3, fee: bestV3Fee } = await this.getV3QuoteWithAmountOut(
			getQuoteIn,
			tokenIn,
			tokenOut,
			amountOut,
			evmChainID,
		)

		if (options?.selectedProtocol === "v3" && amountInV3 !== maxUint256) {
			let transaction: Transaction | undefined
			if (options?.generateCalldata) {
				const recipient = options?.recipient || ADDRESS_ZERO
				transaction = this.createV3SwapCalldataExactOut(
					tokenIn,
					tokenOut,
					amountOut,
					amountInV3,
					bestV3Fee,
					recipient,
					evmChainID,
					getQuoteIn,
				)
			}
			return { protocol: "v3", amountIn: amountInV3, fee: bestV3Fee, transaction }
		}

		const { amountIn: amountInV4, fee: bestV4Fee } = await this.getV4QuoteWithAmountOut(
			getQuoteIn,
			tokenIn,
			tokenOut,
			amountOut,
			evmChainID,
		)

		if (options?.selectedProtocol === "v4" && amountInV4 !== maxUint256) {
			let transaction: Transaction | undefined
			if (options?.generateCalldata) {
				transaction = this.createV4SwapCalldataExactOut(
					tokenIn,
					tokenOut,
					amountOut,
					amountInV4,
					bestV4Fee,
					evmChainID,
					getQuoteIn,
				)
			}
			return { protocol: "v4", amountIn: amountInV4, fee: bestV4Fee, transaction }
		}

		// If no liquidity found in any protocol
		if (amountInV2 === maxUint256 && amountInV3 === maxUint256 && amountInV4 === maxUint256) {
			return {
				protocol: null,
				amountIn: maxUint256,
			}
		}

		// Prefer V4 when V4 is close to the best of V2/V3 (within thresholdBps)
		if (amountInV4 !== maxUint256) {
			const thresholdBps = 100n // 1%
			if (amountInV3 !== maxUint256 && this.isWithinThreshold(amountInV4, amountInV3, thresholdBps)) {
				let transaction: Transaction | undefined
				if (options?.generateCalldata) {
					transaction = this.createV4SwapCalldataExactOut(
						tokenIn,
						tokenOut,
						amountOut,
						amountInV4,
						bestV4Fee,
						evmChainID,
						getQuoteIn,
					)
				}
				return { protocol: "v4", amountIn: amountInV4, fee: bestV4Fee, transaction }
			}
			if (amountInV2 !== maxUint256 && this.isWithinThreshold(amountInV4, amountInV2, thresholdBps)) {
				let transaction: Transaction | undefined
				if (options?.generateCalldata) {
					transaction = this.createV4SwapCalldataExactOut(
						tokenIn,
						tokenOut,
						amountOut,
						amountInV4,
						bestV4Fee,
						evmChainID,
						getQuoteIn,
					)
				}
				return { protocol: "v4", amountIn: amountInV4, fee: bestV4Fee, transaction }
			}
		}

		const minAmount = [
			{ protocol: "v2" as const, amountIn: amountInV2 },
			{ protocol: "v3" as const, amountIn: amountInV3, fee: bestV3Fee },
			{ protocol: "v4" as const, amountIn: amountInV4, fee: bestV4Fee },
		].reduce((best, current) => (current.amountIn < best.amountIn ? current : best))

		let transaction: Transaction | undefined
		if (options?.generateCalldata) {
			const recipient = options?.recipient || ADDRESS_ZERO
			if (minAmount.protocol === "v2") {
				transaction = this.createV2SwapCalldataExactOut(
					tokenIn,
					tokenOut,
					amountOut,
					amountInV2,
					recipient,
					evmChainID,
					getQuoteIn,
				)
			} else if (minAmount.protocol === "v3") {
				transaction = this.createV3SwapCalldataExactOut(
					tokenIn,
					tokenOut,
					amountOut,
					amountInV3,
					bestV3Fee,
					recipient,
					evmChainID,
					getQuoteIn,
				)
			} else {
				transaction = this.createV4SwapCalldataExactOut(
					tokenIn,
					tokenOut,
					amountOut,
					amountInV4,
					bestV4Fee,
					evmChainID,
					getQuoteIn,
				)
			}
		}

		if (minAmount.protocol === "v2") {
			return {
				protocol: "v2",
				amountIn: amountInV2,
				transaction,
			}
		} else if (minAmount.protocol === "v3") {
			return {
				protocol: "v3",
				amountIn: amountInV3,
				fee: bestV3Fee,
				transaction,
			}
		} else {
			return {
				protocol: "v4",
				amountIn: amountInV4,
				fee: bestV4Fee,
				transaction,
			}
		}
	}

	/**
	 * Finds the best Uniswap protocol (V2, V3, or V4) for swapping tokens given an input amount.
	 * Compares liquidity and pricing across different protocols and fee tiers.
	 *
	 * @param getQuoteIn - Whether to use "source" or "dest" chain for the swap
	 * @param tokenIn - The address of the input token
	 * @param tokenOut - The address of the output token
	 * @param amountIn - The input amount to swap
	 * @param evmChainID - The EVM chain ID in format "EVM-{id}"
	 * @param selectedProtocol - Optional specific protocol to use ("v2", "v3", or "v4")
	 * @returns Object containing the best protocol, expected output amount, fee tier (for V3/V4), and transaction structure
	 */
	async findBestProtocolWithAmountIn(
		getQuoteIn: "source" | "dest",
		tokenIn: HexString,
		tokenOut: HexString,
		amountIn: bigint,
		evmChainID: string,
		options?: {
			selectedProtocol?: "v2" | "v3" | "v4"
			generateCalldata?: boolean
			recipient?: HexString
		},
	): Promise<{
		protocol: "v2" | "v3" | "v4" | null
		amountOut: bigint
		fee?: number
		transaction?: Transaction
	}> {
		// Get quotes from all protocols
		const amountOutV2 = await this.getV2QuoteWithAmountIn(getQuoteIn, tokenIn, tokenOut, amountIn, evmChainID)

		// If a specific protocol is requested, return that
		if (options?.selectedProtocol === "v2" && amountOutV2 !== BigInt(0)) {
			let transaction: Transaction | undefined
			if (options?.generateCalldata) {
				const recipient = options?.recipient || ADDRESS_ZERO
				transaction = this.createV2SwapCalldataExactIn(
					tokenIn,
					tokenOut,
					amountIn,
					amountOutV2,
					recipient,
					evmChainID,
					getQuoteIn,
				)
			}
			return { protocol: "v2", amountOut: amountOutV2, transaction }
		}

		const { amountOut: amountOutV3, fee: bestV3Fee } = await this.getV3QuoteWithAmountIn(
			getQuoteIn,
			tokenIn,
			tokenOut,
			amountIn,
			evmChainID,
		)

		if (options?.selectedProtocol === "v3" && amountOutV3 !== BigInt(0)) {
			let transaction: Transaction | undefined
			if (options?.generateCalldata) {
				const recipient = options?.recipient || ADDRESS_ZERO
				transaction = this.createV3SwapCalldataExactIn(
					tokenIn,
					tokenOut,
					amountIn,
					amountOutV3,
					bestV3Fee,
					recipient,
					evmChainID,
					getQuoteIn,
				)
			}
			return { protocol: "v3", amountOut: amountOutV3, fee: bestV3Fee, transaction }
		}

		const { amountOut: amountOutV4, fee: bestV4Fee } = await this.getV4QuoteWithAmountIn(
			getQuoteIn,
			tokenIn,
			tokenOut,
			amountIn,
			evmChainID,
		)

		if (options?.selectedProtocol === "v4" && amountOutV4 !== BigInt(0)) {
			let transaction: Transaction | undefined
			if (options?.generateCalldata) {
				transaction = this.createV4SwapCalldataExactIn(
					tokenIn,
					tokenOut,
					amountIn,
					amountOutV4,
					bestV4Fee,
					evmChainID,
					getQuoteIn,
				)
			}
			return { protocol: "v4", amountOut: amountOutV4, fee: bestV4Fee, transaction }
		}

		// If no liquidity found in any protocol
		if (amountOutV2 === BigInt(0) && amountOutV3 === BigInt(0) && amountOutV4 === BigInt(0)) {
			return {
				protocol: null,
				amountOut: BigInt(0),
			}
		}

		// Prefer V4 when V4 is close to the best of V2/V3 (within thresholdBps)
		if (amountOutV4 !== BigInt(0)) {
			const thresholdBps = 100n // 1%
			if (amountOutV3 !== BigInt(0) && this.isWithinThreshold(amountOutV4, amountOutV3, thresholdBps)) {
				let transaction: Transaction | undefined
				if (options?.generateCalldata) {
					transaction = this.createV4SwapCalldataExactIn(
						tokenIn,
						tokenOut,
						amountIn,
						amountOutV4,
						bestV4Fee,
						evmChainID,
						getQuoteIn,
					)
				}
				return { protocol: "v4", amountOut: amountOutV4, fee: bestV4Fee, transaction }
			}
			if (amountOutV2 !== BigInt(0) && this.isWithinThreshold(amountOutV4, amountOutV2, thresholdBps)) {
				let transaction: Transaction | undefined
				if (options?.generateCalldata) {
					transaction = this.createV4SwapCalldataExactIn(
						tokenIn,
						tokenOut,
						amountIn,
						amountOutV4,
						bestV4Fee,
						evmChainID,
						getQuoteIn,
					)
				}
				return { protocol: "v4", amountOut: amountOutV4, fee: bestV4Fee, transaction }
			}
		}

		// Find the best protocol by maximum amount out
		const maxAmount = [
			{ protocol: "v2" as const, amountOut: amountOutV2 },
			{ protocol: "v3" as const, amountOut: amountOutV3, fee: bestV3Fee },
			{ protocol: "v4" as const, amountOut: amountOutV4, fee: bestV4Fee },
		].reduce((best, current) => (current.amountOut > best.amountOut ? current : best))

		let transaction: Transaction | undefined
		if (options?.generateCalldata) {
			const recipient = options?.recipient || ADDRESS_ZERO
			if (maxAmount.protocol === "v2") {
				transaction = this.createV2SwapCalldataExactIn(
					tokenIn,
					tokenOut,
					amountIn,
					amountOutV2,
					recipient,
					evmChainID,
					getQuoteIn,
				)
			} else if (maxAmount.protocol === "v3") {
				transaction = this.createV3SwapCalldataExactIn(
					tokenIn,
					tokenOut,
					amountIn,
					amountOutV3,
					bestV3Fee,
					recipient,
					evmChainID,
					getQuoteIn,
				)
			} else {
				transaction = this.createV4SwapCalldataExactIn(
					tokenIn,
					tokenOut,
					amountIn,
					amountOutV4,
					bestV4Fee,
					evmChainID,
					getQuoteIn,
				)
			}
		}

		if (maxAmount.protocol === "v2") {
			return {
				protocol: "v2",
				amountOut: amountOutV2,
				transaction,
			}
		} else if (maxAmount.protocol === "v3") {
			return {
				protocol: "v3",
				amountOut: amountOutV3,
				fee: bestV3Fee,
				transaction,
			}
		} else {
			return {
				protocol: "v4",
				amountOut: amountOutV4,
				fee: bestV4Fee,
				transaction,
			}
		}
	}

	/**
	 * Checks if an order has been filled by verifying the commitment status on-chain.
	 * Reads the storage slot corresponding to the order's commitment hash.
	 *
	 * @param order - The order to check
	 * @returns True if the order has been filled, false otherwise
	 */
	async isOrderFilled(order: Order): Promise<boolean> {
		const intentGatewayAddress = this.source.config.getIntentGatewayAddress(order.destChain)

		const filledSlot = await this.dest.client.readContract({
			abi: IntentGatewayABI.ABI,
			address: intentGatewayAddress,
			functionName: "calculateCommitmentSlotHash",
			args: [order.id as HexString],
		})

		const filledStatus = await this.dest.client.getStorageAt({
			address: intentGatewayAddress,
			slot: filledSlot,
		})
		return filledStatus !== "0x0000000000000000000000000000000000000000000000000000000000000000"
	}

	async submitAndConfirmReceipt(hyperbridge: SubstrateChain, commitment: HexString, message: IGetRequestMessage) {
		let storageValue = await hyperbridge.queryRequestReceipt(commitment)

		if (!storageValue) {
			console.log("No receipt found. Attempting to submit...")
			try {
				await hyperbridge.submitUnsigned(message)
			} catch {
				console.warn("Submission failed. Awaiting network confirmation...")
			}

			console.log("Waiting for network state update...")
			await sleep(30000)

			storageValue = await retryPromise(
				async () => {
					const value = await hyperbridge.queryRequestReceipt(commitment)
					if (!value) throw new Error("Receipt not found")
					return value
				},
				{ maxRetries: 10, backoffMs: 5000, logMessage: "Checking for receipt" },
			)
		}

		console.log("Hyperbridge Receipt confirmed.")
	}

	async *cancelOrder(
		order: Order,
		hyperbridgeConfig: IHyperbridgeConfig,
		indexerClient: IndexerClient,
		storedData?: StoredCancellationData,
	) {
		const hyperbridge = (await getChain({ ...hyperbridgeConfig, hasher: "Keccak" })) as SubstrateChain
		const sourceStateMachine = hexToString(order.sourceChain as HexString)
		const destStateMachine = hexToString(order.destChain as HexString)

		const sourceConsensusStateId = this.source.config.getConsensusStateId(sourceStateMachine)
		const destConsensusStateId = this.dest.config.getConsensusStateId(destStateMachine)

		let destIProof: IProof

		if (storedData?.destIProof) {
			destIProof = storedData.destIProof
			yield { status: "DESTINATION_FINALIZED", data: { proof: destIProof } }
		} else {
			let latestHeight = 0n
			let lastFailedHeight: bigint | null = null
			let proofHex: HexString | null = null

			while (!proofHex) {
				latestHeight = await retryPromise(
					() =>
						hyperbridge.latestStateMachineHeight({
							stateId: parseStateMachineId(destStateMachine).stateId,
							consensusStateId: destConsensusStateId,
						}),
					{ maxRetries: 5, backoffMs: 500, logMessage: "Failed to fetch latest state machine height" },
				)

				const shouldFetchProof =
					lastFailedHeight === null ? latestHeight > order.deadline : latestHeight > lastFailedHeight

				if (!shouldFetchProof) {
					yield {
						status: "AWAITING_DESTINATION_FINALIZED",
						data: {
							currentHeight: latestHeight,
							deadline: order.deadline,
							...(lastFailedHeight && { lastFailedHeight }),
						},
					}
					await sleep(10000)
					continue
				}

				try {
					const intentGatewayAddress = this.dest.config.getIntentGatewayAddress(destStateMachine)
					const orderId = orderCommitment(order)
					const slotHash = await this.dest.client.readContract({
						abi: IntentGatewayABI.ABI,
						address: intentGatewayAddress,
						functionName: "calculateCommitmentSlotHash",
						args: [orderId],
					})
					proofHex = await this.dest.queryStateProof(latestHeight, [slotHash], intentGatewayAddress)
				} catch (error) {
					lastFailedHeight = latestHeight
					yield {
						status: "PROOF_FETCH_FAILED",
						data: {
							failedHeight: latestHeight,
							error: error instanceof Error ? error.message : String(error),
							deadline: order.deadline,
						},
					}
					await sleep(10000)
				}
			}

			destIProof = {
				consensusStateId: destConsensusStateId,
				height: latestHeight,
				proof: proofHex,
				stateMachine: destStateMachine,
			}

			yield { status: "DESTINATION_FINALIZED", data: { proof: destIProof } }
		}

		const getRequest = storedData?.getRequest ?? ((yield { status: "AWAITING_GET_REQUEST" }) as IGetRequest)
		if (!getRequest) throw new Error("[Cancel Order]: Get Request not provided")

		const commitment = getRequestCommitment({ ...getRequest, keys: [...getRequest.keys] })

		const sourceStatusStream = indexerClient.getRequestStatusStream(commitment)
		for await (const statusUpdate of sourceStatusStream) {
			yield statusUpdate

			if (statusUpdate.status !== RequestStatus.SOURCE_FINALIZED) {
				continue
			}

			let sourceHeight = BigInt(statusUpdate.metadata.blockNumber)
			let proof: HexString | undefined
			// Check if request was delivered while waiting for proof
			const checkIfAlreadyDelivered = async () => {
				const currentStatus = await indexerClient.queryGetRequestWithStatus(commitment)
				return (
					currentStatus?.statuses.some((status) => status.status === RequestStatus.HYPERBRIDGE_DELIVERED) ??
					false
				)
			}

			const { slot1, slot2 } = requestCommitmentKey(commitment)

			while (true) {
				try {
					proof = await this.source.queryStateProof(sourceHeight, [slot1, slot2])
					break
				} catch {
					const failedHeight = sourceHeight
					while (sourceHeight <= failedHeight) {
						if (await checkIfAlreadyDelivered()) {
							break
						}

						const nextHeight = await retryPromise(
							() =>
								hyperbridge.latestStateMachineHeight({
									stateId: parseStateMachineId(sourceStateMachine).stateId,
									consensusStateId: sourceConsensusStateId,
								}),
							{
								maxRetries: 5,
								backoffMs: 5000,
								logMessage: "Failed to fetch latest state machine height (post-source-proof failure)",
							},
						)

						if (nextHeight <= failedHeight) {
							await sleep(10000)
							continue
						}

						sourceHeight = nextHeight
					}

					if (await checkIfAlreadyDelivered()) {
						break
					}
				}
			}

			if (proof) {
				const sourceIProof: IProof = {
					height: sourceHeight,
					stateMachine: sourceStateMachine,
					consensusStateId: sourceConsensusStateId,
					proof,
				}

				yield { status: "SOURCE_PROOF_RECEIVED", data: sourceIProof }

				const getRequestMessage: IGetRequestMessage = {
					kind: "GetRequest",
					requests: [getRequest],
					source: sourceIProof,
					response: destIProof,
					signer: pad("0x"),
				}

				await waitForChallengePeriod(hyperbridge, {
					height: sourceHeight,
					id: {
						stateId: parseStateMachineId(sourceStateMachine).stateId,
						consensusStateId: sourceConsensusStateId,
					},
				})

				await this.submitAndConfirmReceipt(hyperbridge, commitment, getRequestMessage)
			}
		}
	}

	/**
	 * Returns the tick spacing for a given fee tier in Uniswap V4
	 * @param fee - The fee tier in basis points
	 * @returns The tick spacing value
	 */
	private getTickSpacing(fee: number): number {
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

	/**
	 * Returns true if candidate <= reference * (1 + thresholdBps/10000)
	 * @param candidate - The candidate amount to compare
	 * @param reference - The reference amount
	 * @param thresholdBps - The threshold in basis points
	 * @returns True if candidate is within threshold of reference
	 */
	private isWithinThreshold(candidate: bigint, reference: bigint, thresholdBps: bigint): boolean {
		const basisPoints = 10000n
		return candidate * basisPoints <= reference * (basisPoints + thresholdBps)
	}
}

/**
 * Transforms an Order object into the format expected by the smart contract.
 * Converts chain IDs to hex format and restructures input/output arrays.
 *
 * @param order - The order to transform
 * @returns The order in contract-compatible format
 */
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

interface StoredCancellationData {
	destIProof?: IProof
	getRequest?: IGetRequest
	sourceIProof?: IProof
}
