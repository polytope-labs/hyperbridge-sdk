import { FillerStrategy } from "@/strategies/base"
import {
	Order,
	FillerConfig,
	ExecutionResult,
	HexString,
	FillOptions,
	PaymentInfo,
	DispatchPost,
	RequestKind,
} from "@/types"
import { ethers } from "ethers"
import { encodePacked } from "viem"
import {
	ADDRESS_ZERO,
	fetchTokenUsdPriceOnchain,
	generateRootWithProof,
	getOrderCommitment,
	getStateCommitmentFieldSlot,
} from "@/utils"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { addresses, assets, rpcUrls, chainId } from "@/config/chain"
import { hexConcat } from "ethers/lib/utils"
import { IPostRequest } from "hyperbridge-sdk"
import { EVM_HOST } from "@/config/abis/EvmHost"

export class BasicFiller implements FillerStrategy {
	name = "BasicFiller"
	private privateKey: HexString

	constructor(privateKey: HexString) {
		this.privateKey = privateKey
	}

	/**
	 * Determines if this strategy can fill the given order
	 * @param order The order to check
	 * @param config The filler configuration
	 * @returns True if the strategy can fill the order
	 */
	async canFill(
		order: Order,
		config: FillerConfig,
		providers: { sourceProvider: ethers.providers.Provider; destProvider: ethers.providers.Provider },
	): Promise<boolean> {
		try {
			const currentBlock = await providers.destProvider.getBlockNumber()
			const deadline = BigInt(order.deadline)

			if (deadline < currentBlock) {
				console.debug(`Order expired at block ${deadline}, current block ${currentBlock}`)
				return false
			}

			const isAlreadyFilled = await this.checkIfOrderFilled(order, providers.sourceProvider)
			if (isAlreadyFilled) {
				console.debug(`Order is already filled`)
				return false
			}

			const hasEnoughTokens = await this.checkTokenBalances(order.outputs, providers.destProvider)
			if (!hasEnoughTokens) {
				console.debug(`Insufficient token balances for order`)
				return false
			}

			const orderValue = await this.calculateOrderValue(order, providers.destProvider)
			const requiredConfirmations = config.confirmationPolicy.getConfirmationBlocks(
				chainId[order.destChain as keyof typeof chainId]!,
				orderValue.toString(),
			)
			const sourceBlock = await providers.sourceProvider.getBlockNumber()
			const sourceReceipt = await providers.sourceProvider.getTransactionReceipt(order.transactionHash)
			if (sourceBlock - sourceReceipt.blockNumber + 1 < requiredConfirmations) {
				console.debug(
					`Insufficient confirmations for order, ${sourceBlock - sourceReceipt.blockNumber + 1} confirmations, ${requiredConfirmations} required`,
				)
				return false
			}

			return true
		} catch (error) {
			console.error(`Error in canFill:`, error)
			return false
		}
	}

	/**
	 * Calculates the expected profitability of filling this order
	 * @param order The order to calculate profitability for
	 * @returns The expected profit in a normalized unit (usually USD value or ETH equivalent)
	 */
	async calculateProfitability(
		order: Order,
		providers: { sourceProvider: ethers.providers.Provider; destProvider: ethers.providers.Provider },
	): Promise<number> {
		try {
			// Get the gas cost to fill the order
			const gasPrice = await providers.destProvider.getGasPrice()

			const gasEstimate = await this.estimateGasForFill(order, providers.destProvider)

			const gasCostWei = BigInt(gasPrice.toString()) * BigInt(gasEstimate.toString())
			const gasCostEth = parseFloat(ethers.utils.formatEther(gasCostWei.toString()))

			const ethPriceUsd = await this.getEthPriceUsd(order, providers.destProvider)

			const relayerFeeEth = 0.001 // Fixed fee in ETH, change this

			// Get the HyperBridge protocol fee
			const protocolFeeEth = await this.getProtocolFeeEth(
				order,
				providers,
				BigInt(relayerFeeEth),
				(await this.getWallet(providers.destProvider)).address as HexString,
			)

			// Estimate the gas for handling POST requests in the source chain
			const postGasEstimate = await this.estimateGasForPost(order, providers)

			const totalCostUsd = (gasCostEth + relayerFeeEth + protocolFeeEth + postGasEstimate) * ethPriceUsd

			return totalCostUsd
		} catch (error) {
			console.error(`Error calculating profitability:`, error)
			return -1 // Negative profitability signals an error
		}
	}

	/**
	 * Executes the order fill
	 * @param order The order to fill
	 * @returns The execution result
	 */
	async executeOrder(
		order: Order,
		providers: { sourceProvider: ethers.providers.Provider; destProvider: ethers.providers.Provider },
	): Promise<ExecutionResult> {
		const startTime = Date.now()

		try {
			// Prepare the order for the contract
			// Note: We need to transform our TypeScript order to match the contract's expected format
			const contractOrder = this.transformOrderForContract(order)

			const fillOptions: FillOptions = {
				relayerFee: ethers.utils.parseEther("0.001").toString(), // Hardcoded it for now
			}

			const ethValue = await this.calculateRequiredEthValue(order.outputs)

			await this.approveTokensIfNeeded(order, providers.destProvider)

			const contract = await this.getContract(providers.destProvider, order.destChain)

			console.log(`Executing fill for order with nonce ${order.nonce}`)
			console.log(`Sending ${ethers.utils.formatEther(ethValue)} ETH with transaction`)

			// Execute the fill transaction
			const tx = await contract.fillOrder(contractOrder, fillOptions, {
				value: ethValue,
			})

			console.log(`Transaction submitted: ${tx.hash}`)

			// Wait for transaction receipt
			const receipt = await tx.wait(1) // Wait for 1 confirmation

			const endTime = Date.now()
			const processingTimeMs = endTime - startTime

			return {
				success: true,
				txHash: receipt.transactionHash,
				gasUsed: receipt.gasUsed.toString(),
				gasPrice: receipt.effectiveGasPrice.toString(),
				txCost: receipt.gasUsed.mul(receipt.effectiveGasPrice).toString(),
				confirmedAtBlock: receipt.blockNumber,
				confirmedAt: new Date(),
				strategyUsed: this.name,
				processingTimeMs,
			}
		} catch (error) {
			console.error(`Error executing order:`, error)

			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			}
		}
	}

	// Helper methods

	/**
	 * Checks if an order is already filled by querying contract storage
	 */
	private async checkIfOrderFilled(order: Order, sourceProvider: ethers.providers.Provider): Promise<boolean> {
		try {
			const commitment = getOrderCommitment(order)
			const sourceContract = this.getContract(sourceProvider, order.sourceChain)

			const filledSlot = await sourceContract.calculateCommitmentSlotHash(commitment as HexString)

			const filledStatus = await sourceProvider.getStorageAt(
				addresses.IntentGateway[order.sourceChain as keyof typeof addresses.IntentGateway]!,
				filledSlot,
			)
			return filledStatus !== "0x0000000000000000000000000000000000000000000000000000000000000000"
		} catch (error) {
			console.error(`Error checking if order filled:`, error)
			// Default to assuming it's not filled if we can't check
			return false
		}
	}

	/**
	 * Checks if we have sufficient token balances to fill the order
	 */
	private async checkTokenBalances(
		outputs: PaymentInfo[],
		destProvider: ethers.providers.Provider,
	): Promise<boolean> {
		const wallet = await this.getWallet(destProvider)

		try {
			let totalNativeTokenNeeded = BigInt(0)

			// Check all token balances
			for (const output of outputs) {
				const tokenAddress = output.token
				const amount = output.amount

				if (tokenAddress === ADDRESS_ZERO) {
					// Native token
					totalNativeTokenNeeded = totalNativeTokenNeeded + amount
				} else {
					// ERC20 token
					const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, destProvider)

					const balance = await tokenContract.balanceOf(wallet.address)

					if (balance < amount) {
						console.debug(
							`Insufficient ${tokenAddress} balance. Have ${balance.toString()}, need ${amount.toString()}`,
						)
						return false
					}
				}
			}

			// Check if we have enough native token
			if (totalNativeTokenNeeded > 0n) {
				const nativeBalance = await destProvider.getBalance(wallet.address)

				// Add some buffer for gas
				const withGasBuffer = totalNativeTokenNeeded + BigInt(0.001 * 10 ** 18) // 0.001 ETH buffer for gas

				if (BigInt(nativeBalance.toString()) < withGasBuffer) {
					console.debug(
						`Insufficient native token balance. Have ${nativeBalance.toString()}, need ${withGasBuffer.toString()}`,
					)
					return false
				}
			}

			return true
		} catch (error) {
			console.error(`Error checking token balances:`, error)
			return false
		}
	}

	/**
	 * Calculates the total order value for confirmation policy
	 */
	private async calculateOrderValue(order: Order, destProvider: ethers.providers.Provider): Promise<BigInt> {
		let totalUSDValue = BigInt(0)

		for (const input of order.inputs) {
			const tokenUsdPrice = await fetchTokenUsdPriceOnchain(
				input.token,
				destProvider,
				addresses.UniswapV2Router[order.destChain as keyof typeof addresses.UniswapV2Router]!,
				assets[order.destChain as keyof typeof assets].WETH,
				assets[order.destChain as keyof typeof assets].USDC,
			)

			totalUSDValue = totalUSDValue + BigInt(input.amount * BigInt(tokenUsdPrice))
		}

		return totalUSDValue
	}

	/**
	 * Estimates gas for filling an order
	 */
	private async estimateGasForFill(order: Order, destProvider: ethers.providers.Provider): Promise<BigInt> {
		try {
			const contract = await this.getContract(destProvider, order.destChain)

			const contractOrder = this.transformOrderForContract(order)

			const fillOptions: FillOptions = {
				relayerFee: ethers.utils.parseEther("0.001").toString(),
			}

			const ethValue = await this.calculateRequiredEthValue(order.outputs)

			const gasEstimate = await contract.estimateGas.fillOrder(contractOrder, fillOptions, {
				value: ethValue,
			})

			return BigInt(gasEstimate.toString())
		} catch (error) {
			console.error(`Error estimating gas:`, error)
			// Return a conservative estimate if we can't calculate precisely
			return BigInt(500000)
		}
	}

	/**
	 * Gets the current ETH price in USD
	 */
	private async getEthPriceUsd(order: Order, destProvider: ethers.providers.Provider): Promise<number> {
		const ethPriceUsd = await fetchTokenUsdPriceOnchain(
			assets[order.destChain as keyof typeof assets].WETH,
			destProvider,
			addresses.UniswapV2Router[order.destChain as keyof typeof addresses.UniswapV2Router]!,
			assets[order.destChain as keyof typeof assets].WETH,
			assets[order.destChain as keyof typeof assets].USDC,
		)

		return ethPriceUsd
	}

	/**
	 * Gets the HyperBridge protocol fee in ETH
	 */
	private async getProtocolFeeEth(
		order: Order,
		providers: { sourceProvider: ethers.providers.Provider; destProvider: ethers.providers.Provider },
		relayerFee: bigint,
		intentFillerAddr: HexString,
	): Promise<number> {
		const requestBody = this.constructRedeemEscrowRequestBody(order, providers.sourceProvider)
		const contract = await this.getContract(providers.destProvider, order.destChain)

		const dispatchPost: DispatchPost = {
			dest: order.sourceChain,
			to: addresses.IntentGateway[order.sourceChain as keyof typeof addresses.IntentGateway]!,
			body: requestBody,
			timeout: 0n,
			fee: relayerFee,
			payer: intentFillerAddr,
		}

		const protocolFeeEth = await contract.quoteNative(dispatchPost)

		return protocolFeeEth
	}

	/**
	 * Constructs the redeem escrow request body
	 */
	private constructRedeemEscrowRequestBody(order: Order, sourceProvider: ethers.providers.Provider): HexString {
		const wallet = this.getWallet(sourceProvider)
		const commitment = getOrderCommitment(order)

		// RequestKind.RedeemEscrow is 0 as defined in the contract
		const requestKind = encodePacked(["uint8"], [RequestKind.RedeemEscrow])

		const requestBody = encodePacked(
			["bytes32", "tuple(bytes32 token, uint256 amount)[]", "bytes32"],
			[commitment as HexString, order.inputs, wallet.address as HexString],
		)

		return hexConcat([requestKind, requestBody]) as HexString
	}

	/**
	 * Estimates gas for handling POST requests in the source chain
	 */
	private async estimateGasForPost(
		order: Order,
		providers: { sourceProvider: ethers.providers.Provider; destProvider: ethers.providers.Provider },
	): Promise<number> {
		const postRequest: IPostRequest = {
			source: order.destChain,
			dest: order.sourceChain,
			body: this.constructRedeemEscrowRequestBody(order, providers.sourceProvider),
			timeoutTimestamp: 0n,
			nonce: await this.getHostNonce(providers.destProvider, order.destChain),
			from: addresses.IntentGateway[order.destChain as keyof typeof addresses.IntentGateway]!,
			to: addresses.IntentGateway[order.sourceChain as keyof typeof addresses.IntentGateway]!,
		}

		const { root, proof } = generateRootWithProof(postRequest)
		const latestStateMachineHeight = await this.getHostLatestStateMachineHeight(
			providers.sourceProvider,
			order.destChain,
		)
		const overlayRootSlot = getStateCommitmentFieldSlot(
			BigInt(Number.parseInt(order.destChain.split("-")[1])),
			latestStateMachineHeight,
			1, // For overlayRoot
		)

		// TODO: Override the overlayRootSlot with the root we have generated

		return 0
	}

	/**
	 * Calculates the USD value of tokens
	 */
	private async calculateTokensValueUsd(
		tokens: any[],
		order: Order,
		destProvider: ethers.providers.Provider,
	): Promise<number> {
		let totalValueUsd = 0

		for (const token of tokens) {
			const tokenAddress = token.token
			const amount = ethers.BigNumber.from(token.amount)

			const tokenPriceUsd = await fetchTokenUsdPriceOnchain(
				tokenAddress,
				destProvider,
				addresses.UniswapV2Router[order.destChain as keyof typeof addresses.UniswapV2Router]!,
				assets[order.destChain as keyof typeof assets].WETH,
				assets[order.destChain as keyof typeof assets].USDC,
			)

			// Calculate decimals based on token
			const decimals = await this.getTokenDecimals(tokenAddress, destProvider)

			// Calculate value
			const tokenValueUsd = parseFloat(ethers.utils.formatUnits(amount, decimals)) * tokenPriceUsd
			totalValueUsd += tokenValueUsd
		}

		return totalValueUsd
	}

	/**
	 * Gets the decimals for a token
	 */
	private async getTokenDecimals(tokenAddress: string, provider: ethers.providers.Provider): Promise<number> {
		if (tokenAddress === "0x0000000000000000000000000000000000000000") {
			return 18 // Native token (ETH, MATIC, etc.)
		}

		try {
			const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
			return await tokenContract.decimals()
		} catch (error) {
			console.warn(`Error getting token decimals, defaulting to 18:`, error)
			return 18 // Default to 18 if we can't determine
		}
	}

	/**
	 * Transforms the order object to match the contract's expected format
	 */
	private transformOrderForContract(order: Order): any {
		// The contract expects a slightly different format than our TypeScript types
		return {
			user: order.user,
			sourceChain: order.sourceChain,
			destChain: order.destChain,
			deadline: order.deadline,
			nonce: order.nonce,
			fees: order.fees,
			outputs: order.outputs,
			inputs: order.inputs,
			callData: order.callData,
		}
	}

	/**
	 * Calculates the ETH value to send with the transaction
	 */
	private async calculateRequiredEthValue(outputs: any[]): Promise<ethers.BigNumber> {
		let totalEthValue = ethers.BigNumber.from(0)

		for (const output of outputs) {
			if (output.token === "0x0000000000000000000000000000000000000000") {
				// Native token output
				totalEthValue = totalEthValue + output.amount
			}
		}

		return totalEthValue
	}

	/**
	 * Approves ERC20 tokens for the contract if needed
	 */
	private async approveTokensIfNeeded(order: Order, provider: ethers.providers.Provider): Promise<void> {
		const uniqueTokens = new Set<string>()
		const wallet = await this.getWallet(provider)
		const contract = await this.getContract(provider, order.destChain)
		const outputs = order.outputs

		// Collect unique ERC20 tokens
		for (const output of outputs) {
			if (output.token !== "0x0000000000000000000000000000000000000000") {
				uniqueTokens.add(output.token)
			}
		}

		// Approve each token
		for (const tokenAddress of uniqueTokens) {
			const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)

			const currentAllowance = await tokenContract.allowance(wallet.address, contract.address)

			// If allowance is too low, approve a very large amount
			if (currentAllowance.lt(ethers.constants.MaxUint256)) {
				console.log(`Approving ${tokenAddress} for the contract`)

				const tx = await tokenContract.approve(contract.address, ethers.constants.MaxUint256)

				await tx.wait(1)
				console.log(`Approval confirmed for ${tokenAddress}`)
			}
		}
	}

	private getContract(provider: ethers.providers.Provider, chain: string): ethers.Contract {
		return new ethers.Contract(
			addresses.IntentGateway[chain as keyof typeof addresses.IntentGateway]!,
			INTENT_GATEWAY_ABI,
			provider,
		)
	}

	private getWallet(provider: ethers.providers.Provider): ethers.Wallet {
		return new ethers.Wallet(this.privateKey, provider)
	}

	private async getHostNonce(provider: ethers.providers.Provider, chain: string): Promise<bigint> {
		const contract = new ethers.Contract(addresses.Host[chain as keyof typeof addresses.Host]!, EVM_HOST, provider)
		const nonce = await contract.nonce()
		return nonce
	}

	private async getHostLatestStateMachineHeight(provider: ethers.providers.Provider, chain: string): Promise<bigint> {
		const contract = new ethers.Contract(addresses.Host[chain as keyof typeof addresses.Host]!, EVM_HOST, provider)
		const height = await contract.latestStateMachineHeight(chainId[chain as keyof typeof chainId])
		return height
	}
}
