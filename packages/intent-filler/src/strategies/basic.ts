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
import { encodePacked, keccak256, toHex } from "viem"
import { ADDRESS_ZERO, fetchTokenUsdPriceOnchain, getOrderCommitment } from "@/utils"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { addresses, assets } from "@/config/chain"
import { hexConcat } from "ethers/lib/utils"

export class BasicFiller implements FillerStrategy {
	name = "BasicFiller"

	private wallet: ethers.Wallet
	private provider: ethers.providers.Provider
	private contract: ethers.Contract
	private chain: string

	constructor(chain: string, privateKey: string, provider: ethers.providers.Provider, contractAddress: string) {
		this.chain = toHex(chain)
		this.provider = provider
		this.wallet = new ethers.Wallet(privateKey, provider)
		this.contract = new ethers.Contract(contractAddress, INTENT_GATEWAY_ABI, this.wallet)
	}

	/**
	 * Determines if this strategy can fill the given order
	 * @param order The order to check
	 * @param config The filler configuration
	 * @returns True if the strategy can fill the order
	 */
	async canFill(order: Order, config: FillerConfig): Promise<boolean> {
		try {
			const currentChain = this.chain
			const destChain = toHex(order.destChain)

			if (!destChain.includes(currentChain)) {
				console.debug(`Order destined for chain ${destChain}, we're on ${currentChain}`)
				return false
			}

			const currentBlock = await this.provider.getBlockNumber()
			const deadline = BigInt(order.deadline)

			if (deadline < currentBlock) {
				console.debug(`Order expired at block ${deadline}, current block ${currentBlock}`)
				return false
			}

			const isAlreadyFilled = await this.checkIfOrderFilled(order)
			if (isAlreadyFilled) {
				console.debug(`Order is already filled`)
				return false
			}

			const hasEnoughTokens = await this.checkTokenBalances(order.outputs)
			if (!hasEnoughTokens) {
				console.debug(`Insufficient token balances for order`)
				return false
			}

			const orderValue = this.calculateOrderValue(order)
			const requiredConfirmations = config.confirmationPolicy.getConfirmationBlocks(
				this.chain,
				orderValue.toString(),
			)

			// If the order is close to expiry and we need many confirmations, we might not want to fill
			const blocksRemaining = Number(deadline - BigInt(currentBlock))
			if (blocksRemaining < requiredConfirmations * 2) {
				console.debug(
					`Order too close to expiry for comfort: ${blocksRemaining} blocks remaining, ${requiredConfirmations} confirmations required`,
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
	async calculateProfitability(order: Order): Promise<number> {
		try {
			// Get the gas cost to fill the order
			const gasPrice = await this.provider.getGasPrice()

			const gasEstimate = await this.estimateGasForFill(order)

			const gasCostWei = BigInt(gasPrice.toString()) * BigInt(gasEstimate.toString())
			const gasCostEth = parseFloat(ethers.utils.formatEther(gasCostWei.toString()))

			const ethPriceUsd = await this.getEthPriceUsd()

			const relayerFeeEth = 0.001 // Fixed fee in ETH, change this

			// Get the HyperBridge protocol fee
			const protocolFeeEth = await this.getProtocolFeeEth(order)

			// Estimate the gas for handling POST requests in the source chain
			const postGasEstimate = await this.estimateGasForPost(order)

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
	async executeOrder(order: Order): Promise<ExecutionResult> {
		const startTime = Date.now()

		try {
			// Prepare the order for the contract
			// Note: We need to transform our TypeScript order to match the contract's expected format
			const contractOrder = this.transformOrderForContract(order)

			const fillOptions: FillOptions = {
				relayerFee: ethers.utils.parseEther("0.001").toString(), // Hardcoded it for now
			}

			const ethValue = await this.calculateRequiredEthValue(order.outputs)

			let gasPrice = await this.provider.getGasPrice()

			await this.approveTokensIfNeeded(order.outputs)

			// Estimate gas with buffer
			const gasEstimate = await this.contract.estimateGas.fillOrder(contractOrder, fillOptions, {
				value: ethValue,
			})
			const gasLimit = gasEstimate.mul(120).div(100) // Add 20% buffer

			console.log(`Executing fill for order with nonce ${order.nonce}`)
			console.log(`Sending ${ethers.utils.formatEther(ethValue)} ETH with transaction`)

			// Execute the fill transaction
			const tx = await this.contract.fillOrder(contractOrder, fillOptions, {
				value: ethValue,
				gasLimit,
				gasPrice,
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
	private async checkIfOrderFilled(order: Order): Promise<boolean> {
		try {
			const commitment = getOrderCommitment(order)

			const filledSlot = keccak256(encodePacked(["bytes32", "uint256"], [commitment as HexString, 5n]))

			const filledStatus = await this.provider.getStorageAt(this.contract.address, filledSlot)
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
	private async checkTokenBalances(outputs: PaymentInfo[]): Promise<boolean> {
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
					const tokenContract = new ethers.Contract(
						tokenAddress,
						["function balanceOf(address owner) view returns (uint256)"],
						this.provider,
					)

					const balance = await tokenContract.balanceOf(this.wallet.address)

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
				const nativeBalance = await this.provider.getBalance(this.wallet.address)

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
	private async calculateOrderValue(order: Order): Promise<BigInt> {
		let totalUSDValue = BigInt(0)

		for (const input of order.inputs) {
			const tokenUsdPrice = await fetchTokenUsdPriceOnchain(
				input.token,
				this.provider,
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
	private async estimateGasForFill(order: Order): Promise<BigInt> {
		try {
			const contractOrder = this.transformOrderForContract(order)

			const fillOptions: FillOptions = {
				relayerFee: ethers.utils.parseEther("0.001").toString(),
			}

			const ethValue = await this.calculateRequiredEthValue(order.outputs)

			const gasEstimate = await this.contract.estimateGas.fillOrder(contractOrder, fillOptions, {
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
	private async getEthPriceUsd(): Promise<number> {
		const ethPriceUsd = await fetchTokenUsdPriceOnchain(
			assets[this.chain as keyof typeof assets].WETH,
			this.provider,
			addresses.UniswapV2Router[this.chain as keyof typeof addresses.UniswapV2Router]!,
			assets[this.chain as keyof typeof assets].WETH,
			assets[this.chain as keyof typeof assets].USDC,
		)

		return ethPriceUsd
	}

	/**
	 * Gets the HyperBridge protocol fee in ETH
	 */
	private async getProtocolFeeEth(order: Order): Promise<number> {
		const requestBody = this.constructRedeemEscrowRequest(order)

		const dispatchPost: DispatchPost = {
			dest: order.sourceChain,
			to: addresses.IntentGateway[order.sourceChain as keyof typeof addresses.IntentGateway]!,
			body: requestBody,
			timeout: order.deadline,
			fee: order.fees,
			payer: order.user,
		}

		const protocolFeeEth = await this.contract.quote(dispatchPost)

		return protocolFeeEth
	}

	/**
	 * Constructs the redeem escrow request body
	 */
	private constructRedeemEscrowRequest(order: Order): HexString {
		const commitment = getOrderCommitment(order)

		// RequestKind.RedeemEscrow is 0 as defined in the contract
		const requestKind = encodePacked(["uint8"], [RequestKind.RedeemEscrow])

		const requestBody = encodePacked(
			["bytes32", "bytes32", "tuple(bytes32 token, uint256 amount)[]"],
			[commitment as HexString, this.wallet.address as HexString, order.inputs],
		)

		return hexConcat([requestKind, requestBody]) as HexString
	}

	/**
	 * Estimates gas for handling POST requests in the source chain
	 */
	private async estimateGasForPost(order: Order): Promise<number> {
		// TODO: Implement this
		return 0
	}

	/**
	 * Calculates the USD value of tokens
	 */
	private async calculateTokensValueUsd(tokens: any[]): Promise<number> {
		let totalValueUsd = 0

		for (const token of tokens) {
			const tokenAddress = token.token
			const amount = ethers.BigNumber.from(token.amount)

			const tokenPriceUsd = await fetchTokenUsdPriceOnchain(
				tokenAddress,
				this.provider,
				addresses.UniswapV2Router[this.chain as keyof typeof addresses.UniswapV2Router]!,
				assets[this.chain as keyof typeof assets].WETH,
				assets[this.chain as keyof typeof assets].USDC,
			)

			// Calculate decimals based on token
			const decimals = await this.getTokenDecimals(tokenAddress)

			// Calculate value
			const tokenValueUsd = parseFloat(ethers.utils.formatUnits(amount, decimals)) * tokenPriceUsd
			totalValueUsd += tokenValueUsd
		}

		return totalValueUsd
	}

	/**
	 * Gets the decimals for a token
	 */
	private async getTokenDecimals(tokenAddress: string): Promise<number> {
		if (tokenAddress === "0x0000000000000000000000000000000000000000") {
			return 18 // Native token (ETH, MATIC, etc.)
		}

		try {
			const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider)
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
	private async approveTokensIfNeeded(outputs: any[]): Promise<void> {
		const uniqueTokens = new Set<string>()

		// Collect unique ERC20 tokens
		for (const output of outputs) {
			if (output.token !== "0x0000000000000000000000000000000000000000") {
				uniqueTokens.add(output.token)
			}
		}

		// Approve each token
		for (const tokenAddress of uniqueTokens) {
			const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet)

			const currentAllowance = await tokenContract.allowance(this.wallet.address, this.contract.address)

			// If allowance is too low, approve a very large amount
			if (currentAllowance.lt(ethers.constants.MaxUint256)) {
				console.log(`Approving ${tokenAddress} for the contract`)

				const tx = await tokenContract.approve(this.contract.address, ethers.constants.MaxUint256)

				await tx.wait(1)
				console.log(`Approval confirmed for ${tokenAddress}`)
			}
		}
	}
}
